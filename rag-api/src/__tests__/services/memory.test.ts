import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEmbedding, mockSearchResult } from '../helpers/fixtures';

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
  },
  default: {
    upsert: vi.fn(),
    search: vi.fn(),
    delete: vi.fn(),
    deleteByFilter: vi.fn(),
    getCollectionInfo: vi.fn(),
    aggregateByField: vi.fn(),
    recommend: vi.fn(),
  },
}));

vi.mock('../../services/embedding', () => ({
  embeddingService: {
    embed: vi.fn(),
    embedBatch: vi.fn(),
  },
  default: {
    embed: vi.fn(),
    embedBatch: vi.fn(),
  },
}));

vi.mock('../../services/llm', () => ({
  llm: {
    complete: vi.fn(),
  },
  default: {
    complete: vi.fn(),
  },
}));

import { vectorStore } from '../../services/vector-store';
import { embeddingService } from '../../services/embedding';
import { memoryService } from '../../services/memory';

const mockedVS = vi.mocked(vectorStore);
const mockedEmbed = vi.mocked(embeddingService);

describe('MemoryService', () => {
  const fakeVector = mockEmbedding(1024);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedEmbed.embed.mockResolvedValue(fakeVector);
    mockedEmbed.embedBatch.mockResolvedValue([fakeVector, fakeVector]);
    // Default: no existing similar memories for relationship detection
    mockedVS.search.mockResolvedValue([]);
  });

  describe('remember', () => {
    it('creates memory, embeds content, and upserts to Qdrant', async () => {
      mockedVS.upsert.mockResolvedValue(undefined);

      const memory = await memoryService.remember({
        projectName: 'test',
        content: 'BGE-M3 uses /embed not /embed_batch',
        type: 'decision',
        tags: ['bugfix'],
      });

      expect(memory.id).toBeDefined();
      expect(memory.type).toBe('decision');
      expect(memory.content).toBe('BGE-M3 uses /embed not /embed_batch');
      expect(memory.tags).toEqual(['bugfix']);
      expect(memory.createdAt).toBeDefined();

      expect(mockedEmbed.embed).toHaveBeenCalledWith(
        expect.stringContaining('decision: BGE-M3 uses /embed')
      );
      expect(mockedVS.upsert).toHaveBeenCalledWith(
        'test_agent_memory',
        expect.arrayContaining([
          expect.objectContaining({
            id: memory.id,
            vector: fakeVector,
            payload: expect.objectContaining({
              content: 'BGE-M3 uses /embed not /embed_batch',
              project: 'test',
            }),
          }),
        ])
      );
    });

    it('sets pending status for todo type', async () => {
      mockedVS.upsert.mockResolvedValue(undefined);

      const memory = await memoryService.remember({
        projectName: 'test',
        content: 'fix the bug',
        type: 'todo',
      });

      expect(memory.status).toBe('pending');
      expect(memory.statusHistory).toHaveLength(1);
      expect(memory.statusHistory![0].status).toBe('pending');
    });
  });

  describe('recall', () => {
    it('embeds query, searches, and returns results', async () => {
      const now = new Date().toISOString();
      mockedVS.search.mockResolvedValue([
        mockSearchResult({
          id: 'mem-1',
          score: 0.9,
          payload: {
            type: 'note',
            content: 'found memory',
            tags: ['test'],
            createdAt: now,
            updatedAt: now,
          },
        }),
      ]);

      const results = await memoryService.recall({
        projectName: 'test',
        query: 'find stuff',
        limit: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].memory.content).toBe('found memory');
      expect(results[0].score).toBeCloseTo(0.9, 1);
      expect(mockedVS.search).toHaveBeenCalledWith(
        'test_agent_memory',
        fakeVector,
        10, // limit * 2
        undefined
      );
    });

    it('filters out superseded memories', async () => {
      const now = new Date().toISOString();
      mockedVS.search.mockResolvedValue([
        mockSearchResult({
          id: 'active',
          score: 0.9,
          payload: { type: 'note', content: 'active', tags: [], createdAt: now, updatedAt: now },
        }),
        mockSearchResult({
          id: 'superseded',
          score: 0.85,
          payload: { type: 'note', content: 'old', tags: [], createdAt: now, updatedAt: now, supersededBy: 'active' },
        }),
      ]);

      const results = await memoryService.recall({
        projectName: 'test',
        query: 'anything',
        limit: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].memory.id).toBe('active');
    });

    it('applies aging decay to old unvalidated memories', async () => {
      // Memory 90 days old → 2 periods past first 30 → 10% decay
      const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      mockedVS.search.mockResolvedValue([
        mockSearchResult({
          id: 'old-mem',
          score: 1.0,
          payload: {
            type: 'note',
            content: 'old memory',
            tags: [],
            createdAt: old,
            updatedAt: old,
            validated: false,
          },
        }),
      ]);

      const results = await memoryService.recall({
        projectName: 'test',
        query: 'anything',
        limit: 5,
      });

      expect(results[0].score).toBeLessThan(1.0);
      expect(results[0].score).toBeCloseTo(0.9, 1);
    });

    it('does not apply aging decay to validated memories', async () => {
      const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      mockedVS.search.mockResolvedValue([
        mockSearchResult({
          id: 'validated-mem',
          score: 1.0,
          payload: {
            type: 'note',
            content: 'validated memory',
            tags: [],
            createdAt: old,
            updatedAt: old,
            validated: true,
          },
        }),
      ]);

      const results = await memoryService.recall({
        projectName: 'test',
        query: 'anything',
        limit: 5,
      });

      expect(results[0].score).toBe(1.0);
    });

    it('builds type filter when specified', async () => {
      mockedVS.search.mockResolvedValue([]);

      await memoryService.recall({
        projectName: 'test',
        query: 'decisions',
        type: 'decision',
        limit: 5,
      });

      expect(mockedVS.search).toHaveBeenCalledWith(
        'test_agent_memory',
        fakeVector,
        10,
        { must: [{ key: 'type', match: { value: 'decision' } }] }
      );
    });
  });

  describe('list', () => {
    it('returns memories with proper structure', async () => {
      const now = new Date().toISOString();
      mockedVS.search.mockResolvedValue([
        mockSearchResult({
          id: 'list-1',
          score: 0.8,
          payload: { type: 'insight', content: 'listed', tags: ['a'], createdAt: now, updatedAt: now },
        }),
      ]);

      const memories = await memoryService.list({
        projectName: 'test',
        limit: 10,
      });

      expect(memories).toHaveLength(1);
      expect(memories[0].type).toBe('insight');
      expect(memories[0].content).toBe('listed');
    });
  });

  describe('forget', () => {
    it('deletes memory by ID', async () => {
      mockedVS.delete.mockResolvedValue(undefined);

      const result = await memoryService.forget('test', 'mem-1');

      expect(result).toBe(true);
      expect(mockedVS.delete).toHaveBeenCalledWith(
        'test_agent_memory',
        ['mem-1']
      );
    });

    it('returns false on error', async () => {
      mockedVS.delete.mockRejectedValue(new Error('fail'));

      const result = await memoryService.forget('test', 'mem-1');

      expect(result).toBe(false);
    });
  });

  describe('batchRemember', () => {
    it('embeds all texts in batch and upserts', async () => {
      mockedVS.upsert.mockResolvedValue(undefined);

      const result = await memoryService.batchRemember('test', [
        { content: 'memory 1', type: 'note', tags: [] },
        { content: 'memory 2', type: 'insight', tags: ['important'] },
      ]);

      expect(result.saved).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(mockedEmbed.embedBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('note: memory 1'),
          expect.stringContaining('insight: memory 2'),
        ])
      );
      expect(mockedVS.upsert).toHaveBeenCalledTimes(1);
    });

    it('captures errors without throwing', async () => {
      mockedEmbed.embedBatch.mockRejectedValue(new Error('embed failed'));

      const result = await memoryService.batchRemember('test', [
        { content: 'will fail' },
      ]);

      expect(result.saved).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('embed failed');
    });
  });
});
