import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEmbedding } from '../helpers/fixtures';

// Hoist the mock Qdrant client so it's available in vi.mock factories
const mockQdrantClient = vi.hoisted(() => ({
  scroll: vi.fn(),
  setPayload: vi.fn(),
}));

// Mock dependencies
vi.mock('../../services/vector-store', () => ({
  vectorStore: {
    upsert: vi.fn(),
    search: vi.fn(),
    delete: vi.fn(),
    deleteByFilter: vi.fn(),
    getCollectionInfo: vi.fn(),
    aggregateByField: vi.fn(),
    recommend: vi.fn(),
    ensureCollection: vi.fn(),
    // Expose the mock client as the private 'client' field
    // governance service accesses this via vectorStore['client']
    client: mockQdrantClient,
  },
}));

vi.mock('../../services/embedding', () => ({
  embeddingService: {
    embed: vi.fn(),
    embedBatch: vi.fn(),
  },
}));

vi.mock('../../services/memory', () => ({
  memoryService: {
    remember: vi.fn(),
    recall: vi.fn(),
  },
}));

vi.mock('../../services/quality-gates', () => ({
  qualityGates: {
    runGates: vi.fn(),
  },
}));

vi.mock('../../services/feedback', () => ({
  feedbackService: {
    getMemoryFeedbackCounts: vi.fn(),
  },
}));

vi.mock('../../utils/metrics', () => ({
  memoryGovernanceTotal: { inc: vi.fn() },
  qualityGateResults: { inc: vi.fn() },
  qualityGateDuration: { observe: vi.fn() },
}));

import { vectorStore } from '../../services/vector-store';
import { embeddingService } from '../../services/embedding';
import { memoryService } from '../../services/memory';
import { qualityGates } from '../../services/quality-gates';
import { memoryGovernance } from '../../services/memory-governance';

const mockedVS = vi.mocked(vectorStore);
const mockedEmbed = vi.mocked(embeddingService);
const mockedMemory = vi.mocked(memoryService);
const mockedGates = vi.mocked(qualityGates);

describe('MemoryGovernanceService', () => {
  const fakeVector = mockEmbedding(1024);

  beforeEach(() => {
    vi.resetAllMocks();
    // Clear the governance service's internal threshold cache to prevent cross-test leaks
    (memoryGovernance as any).thresholdCache.clear();
    mockedEmbed.embed.mockResolvedValue(fakeVector);
    mockedEmbed.embedBatch.mockResolvedValue([fakeVector, fakeVector]);
    // Default: no existing memories for relationship detection
    mockedVS.search.mockResolvedValue([]);
  });

  describe('ingest', () => {
    it('routes manual memory to durable via memoryService.remember', async () => {
      const fakeMemory = {
        id: 'durable-1',
        type: 'decision' as const,
        content: 'use TypeScript',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockedMemory.remember.mockResolvedValue(fakeMemory);

      const result = await memoryGovernance.ingest({
        projectName: 'test',
        content: 'use TypeScript',
        type: 'decision',
      });

      expect(mockedMemory.remember).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'test',
          content: 'use TypeScript',
          type: 'decision',
        })
      );
      expect(result.id).toBe('durable-1');
    });

    it('routes auto-generated memory to quarantine', async () => {
      mockedVS.upsert.mockResolvedValue(undefined);
      // For adaptive threshold: default with < 5 total
      mockQdrantClient.scroll
        .mockResolvedValueOnce({ points: [] })
        .mockResolvedValueOnce({ points: [] });

      const result = await memoryGovernance.ingest({
        projectName: 'test',
        content: 'auto-discovered pattern',
        type: 'insight',
        source: 'auto_pattern',
        confidence: 0.8,
      });

      expect(mockedMemory.remember).not.toHaveBeenCalled();
      expect(mockedVS.upsert).toHaveBeenCalledWith(
        'test_memory_pending',
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              content: 'auto-discovered pattern',
              source: 'auto_pattern',
              validated: false,
            }),
          }),
        ])
      );
      expect(result.source).toBe('auto_pattern');
    });

    it('skips auto-memory below adaptive confidence threshold', async () => {
      // Return enough to compute a threshold > 0.7
      mockQdrantClient.scroll
        .mockResolvedValueOnce({ points: [] }) // promoted
        .mockResolvedValueOnce({ points: Array.from({ length: 10 }, () => ({})) }); // pending (10 items)

      // With 0 promoted / 10 total → successRate=0 → threshold=0.8
      const result = await memoryGovernance.ingest({
        projectName: 'test',
        content: 'low confidence',
        type: 'note',
        source: 'auto_conversation',
        confidence: 0.3,
      });

      expect(result.metadata).toEqual(
        expect.objectContaining({ skipped: true, reason: 'below_threshold' })
      );
      expect(mockedVS.upsert).not.toHaveBeenCalled();
      expect(mockedMemory.remember).not.toHaveBeenCalled();
    });
  });

  describe('promote', () => {
    it('moves memory from quarantine to durable', async () => {
      // Find in quarantine
      mockQdrantClient.scroll.mockResolvedValue({
        points: [{
          id: 'q-1',
          payload: {
            id: 'q-1',
            type: 'insight',
            content: 'promoted content',
            tags: ['test'],
            source: 'auto_pattern',
            confidence: 0.8,
            metadata: {},
          },
        }],
      });
      mockedVS.delete.mockResolvedValue(undefined);
      mockedMemory.remember.mockResolvedValue({
        id: 'durable-2',
        type: 'insight',
        content: 'promoted content',
        tags: ['test'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await memoryGovernance.promote('test', 'q-1', 'human_validated');

      expect(mockedVS.delete).toHaveBeenCalledWith('test_memory_pending', ['q-1']);
      expect(mockedMemory.remember).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'test',
          content: 'promoted content',
          metadata: expect.objectContaining({
            validated: true,
            promoteReason: 'human_validated',
          }),
        })
      );
      expect(result.id).toBe('durable-2');
    });

    it('throws when memory not found in quarantine', async () => {
      mockQdrantClient.scroll.mockResolvedValue({ points: [] });

      await expect(
        memoryGovernance.promote('test', 'nonexistent', 'human_validated')
      ).rejects.toThrow('Memory not found in quarantine');
    });

    it('rejects promotion when quality gates fail', async () => {
      mockedGates.runGates.mockResolvedValue({
        passed: false,
        gates: [
          { gate: 'typecheck', passed: false, details: 'TS2322: Type error', duration: 100 },
        ],
      });

      await expect(
        memoryGovernance.promote('test', 'q-1', 'tests_passed', undefined, {
          runGates: true,
          projectPath: '/project',
        })
      ).rejects.toThrow('Quality gates failed');
    });
  });

  describe('reject', () => {
    it('deletes memory from quarantine', async () => {
      mockedVS.delete.mockResolvedValue(undefined);

      const result = await memoryGovernance.reject('test', 'q-1');

      expect(result).toBe(true);
      expect(mockedVS.delete).toHaveBeenCalledWith('test_memory_pending', ['q-1']);
    });

    it('returns false on error', async () => {
      mockedVS.delete.mockRejectedValue(new Error('fail'));

      const result = await memoryGovernance.reject('test', 'q-1');

      expect(result).toBe(false);
    });
  });

  describe('recallDurable', () => {
    it('delegates to memoryService.recall', async () => {
      mockedMemory.recall.mockResolvedValue([]);

      await memoryGovernance.recallDurable({
        projectName: 'test',
        query: 'search',
        limit: 5,
      });

      expect(mockedMemory.recall).toHaveBeenCalledWith({
        projectName: 'test',
        query: 'search',
        limit: 5,
      });
    });
  });

  describe('getAdaptiveThreshold', () => {
    it('returns default 0.5 when < 5 total memories', async () => {
      mockQdrantClient.scroll
        .mockResolvedValueOnce({ points: [{}] }) // 1 promoted
        .mockResolvedValueOnce({ points: [{}] }); // 1 pending

      const threshold = await memoryGovernance.getAdaptiveThreshold('fresh-proj');

      expect(threshold).toBe(0.5);
    });

    it('computes threshold from success rate', async () => {
      // 8 promoted, 2 pending → successRate=0.8 → threshold = 0.8 - 0.8*0.4 = 0.48
      mockQdrantClient.scroll
        .mockResolvedValueOnce({ points: Array.from({ length: 8 }, () => ({})) })
        .mockResolvedValueOnce({ points: Array.from({ length: 2 }, () => ({})) });

      const threshold = await memoryGovernance.getAdaptiveThreshold('newproj');

      expect(threshold).toBeGreaterThanOrEqual(0.4);
      expect(threshold).toBeLessThanOrEqual(0.8);
      expect(threshold).toBeCloseTo(0.48, 1);
    });
  });
});
