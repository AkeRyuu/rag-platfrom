/**
 * Memory Governance Service - Routes memories to quarantine or durable storage
 * based on source (manual vs auto-generated).
 */

import { v4 as uuidv4 } from 'uuid';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { memoryService, Memory, MemoryType, MemorySource, CreateMemoryOptions, SearchMemoryOptions, MemorySearchResult } from './memory';
import { qualityGates } from './quality-gates';
import { logger } from '../utils/logger';
import { memoryGovernanceTotal } from '../utils/metrics';

export type PromoteReason = 'human_validated' | 'pr_merged' | 'tests_passed';

export interface IngestOptions extends CreateMemoryOptions {
  source?: MemorySource;
  confidence?: number;
}

class MemoryGovernanceService {
  private getQuarantineCollection(projectName: string): string {
    return `${projectName}_memory_pending`;
  }

  private getDurableCollection(projectName: string): string {
    return `${projectName}_agent_memory`;
  }

  /**
   * Ingest a memory — routes to durable or quarantine based on source.
   * Manual/undefined source → durable; auto_* source → quarantine.
   */
  async ingest(options: IngestOptions): Promise<Memory> {
    const { source, confidence, ...memoryOptions } = options;
    const { projectName } = memoryOptions;

    const isAuto = source && source.startsWith('auto_');

    if (!isAuto) {
      // Manual memory → go straight to durable via existing memoryService
      memoryGovernanceTotal.inc({ operation: 'ingest', tier: 'durable', project: projectName });
      return memoryService.remember(memoryOptions);
    }

    // Auto-generated → quarantine
    memoryGovernanceTotal.inc({ operation: 'ingest', tier: 'quarantine', project: projectName });
    const collectionName = this.getQuarantineCollection(projectName);

    const memory: Memory = {
      id: uuidv4(),
      type: memoryOptions.type || 'note',
      content: memoryOptions.content,
      tags: memoryOptions.tags || [],
      relatedTo: memoryOptions.relatedTo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source,
      confidence: confidence ?? 0.5,
      validated: false,
      metadata: {
        ...memoryOptions.metadata,
        source,
        confidence: confidence ?? 0.5,
      },
    };

    if (memoryOptions.type === 'todo') {
      memory.status = 'pending';
      memory.statusHistory = [{ status: 'pending', timestamp: memory.createdAt }];
    }

    const embedding = await embeddingService.embed(
      `${memory.type}: ${memory.content}${memory.relatedTo ? ` (related to: ${memory.relatedTo})` : ''}${memory.tags.length > 0 ? ` [tags: ${memory.tags.join(', ')}]` : ''}`
    );

    const point: VectorPoint = {
      id: memory.id,
      vector: embedding,
      payload: {
        ...memory,
        project: projectName,
        source,
        validated: false,
      },
    };

    await vectorStore.upsert(collectionName, [point]);
    logger.info(`Memory quarantined: ${memory.type}`, { id: memory.id, project: projectName, source });
    return memory;
  }

  /**
   * Promote a memory from quarantine → durable.
   */
  async promote(
    projectName: string,
    memoryId: string,
    reason: PromoteReason,
    evidence?: string,
    gateOptions?: { runGates?: boolean; projectPath?: string; affectedFiles?: string[] }
  ): Promise<Memory> {
    // Run quality gates if requested
    if (gateOptions?.runGates && gateOptions?.projectPath) {
      const report = await qualityGates.runGates({
        projectName,
        projectPath: gateOptions.projectPath,
        affectedFiles: gateOptions.affectedFiles,
      });

      if (!report.passed) {
        const failedGates = report.gates.filter(g => !g.passed).map(g => g.gate);
        throw new Error(`Quality gates failed: ${failedGates.join(', ')}. Details: ${report.gates.filter(g => !g.passed).map(g => g.details).join('; ')}`);
      }
    }

    memoryGovernanceTotal.inc({ operation: 'promote', tier: 'durable', project: projectName });
    const quarantineCollection = this.getQuarantineCollection(projectName);

    // Find memory in quarantine by scrolling with filter
    const results = await vectorStore['client'].scroll(quarantineCollection, {
      limit: 1,
      with_payload: true,
      filter: {
        must: [{ key: 'id', match: { value: memoryId } }],
      },
    });

    if (results.points.length === 0) {
      throw new Error(`Memory not found in quarantine: ${memoryId}`);
    }

    const point = results.points[0];
    const payload = point.payload as Record<string, unknown>;

    // Delete from quarantine
    await vectorStore.delete(quarantineCollection, [memoryId]);

    // Promote to durable with metadata
    const promotedMemory = await memoryService.remember({
      projectName,
      content: payload.content as string,
      type: payload.type as MemoryType,
      tags: (payload.tags as string[]) || [],
      relatedTo: payload.relatedTo as string | undefined,
      metadata: {
        ...(payload.metadata as Record<string, unknown> || {}),
        validated: true,
        promotedAt: new Date().toISOString(),
        promoteReason: reason,
        promoteEvidence: evidence,
        originalSource: payload.source,
        originalConfidence: payload.confidence,
      },
    });

    logger.info(`Memory promoted: ${memoryId} → ${promotedMemory.id}`, { project: projectName, reason });
    return promotedMemory;
  }

  /**
   * Reject (delete) a memory from quarantine.
   */
  async reject(projectName: string, memoryId: string): Promise<boolean> {
    memoryGovernanceTotal.inc({ operation: 'reject', tier: 'quarantine', project: projectName });
    const quarantineCollection = this.getQuarantineCollection(projectName);

    try {
      await vectorStore.delete(quarantineCollection, [memoryId]);
      logger.info(`Memory rejected: ${memoryId}`, { project: projectName });
      return true;
    } catch (error: any) {
      logger.error(`Failed to reject memory: ${memoryId}`, { error: error.message });
      return false;
    }
  }

  /**
   * Recall ONLY from durable storage — for enrichment use.
   */
  async recallDurable(options: SearchMemoryOptions): Promise<MemorySearchResult[]> {
    return memoryService.recall(options);
  }

  /**
   * Recall from quarantine — for review.
   */
  async recallQuarantine(options: SearchMemoryOptions): Promise<MemorySearchResult[]> {
    const { projectName, query, type = 'all', limit = 20, tag } = options;
    const collectionName = this.getQuarantineCollection(projectName);

    const embedding = await embeddingService.embed(query);

    const mustConditions: Record<string, unknown>[] = [];
    if (type && type !== 'all') {
      mustConditions.push({ key: 'type', match: { value: type } });
    }
    if (tag) {
      mustConditions.push({ key: 'tags', match: { any: [tag] } });
    }

    const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

    const results = await vectorStore.search(collectionName, embedding, limit, filter);

    return results.map(r => ({
      memory: {
        id: r.id,
        type: r.payload.type as MemoryType,
        content: r.payload.content as string,
        tags: (r.payload.tags as string[]) || [],
        relatedTo: r.payload.relatedTo as string | undefined,
        createdAt: r.payload.createdAt as string,
        updatedAt: r.payload.updatedAt as string,
        metadata: r.payload.metadata as Record<string, unknown> | undefined,
        source: r.payload.source as MemorySource | undefined,
        confidence: r.payload.confidence as number | undefined,
        validated: r.payload.validated as boolean | undefined,
      },
      score: r.score,
    }));
  }

  /**
   * List quarantine memories (non-semantic, for review UI).
   */
  async listQuarantine(projectName: string, limit: number = 20): Promise<Memory[]> {
    const collectionName = this.getQuarantineCollection(projectName);

    try {
      const results = await vectorStore['client'].scroll(collectionName, {
        limit,
        with_payload: true,
        with_vector: false,
      });

      return results.points.map(p => {
        const payload = p.payload as Record<string, unknown>;
        return {
          id: p.id as string,
          type: payload.type as MemoryType,
          content: payload.content as string,
          tags: (payload.tags as string[]) || [],
          relatedTo: payload.relatedTo as string | undefined,
          createdAt: payload.createdAt as string,
          updatedAt: payload.updatedAt as string,
          metadata: payload.metadata as Record<string, unknown> | undefined,
          source: payload.source as MemorySource | undefined,
          confidence: payload.confidence as number | undefined,
          validated: payload.validated as boolean | undefined,
        };
      });
    } catch (error: any) {
      if (error.status === 404) return [];
      throw error;
    }
  }
}

export const memoryGovernance = new MemoryGovernanceService();
export default memoryGovernance;
