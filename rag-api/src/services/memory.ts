/**
 * Agent Memory Service - Persistent memory storage for AI agents
 *
 * Stores and retrieves memories using Qdrant vector database for semantic search.
 */

import { v4 as uuidv4 } from 'uuid';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { logger } from '../utils/logger';

export type MemoryType = 'decision' | 'insight' | 'context' | 'todo' | 'conversation' | 'note';
export type MemorySource = 'manual' | 'auto_conversation' | 'auto_pattern' | 'auto_feedback';
export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  relatedTo?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  // For todos
  status?: TodoStatus;
  statusHistory?: { status: TodoStatus; timestamp: string; note?: string }[];
  // Auto-learning fields
  source?: MemorySource;
  confidence?: number; // 0-1 confidence score for auto-extracted memories
  validated?: boolean; // User validation status
  originalContext?: string; // Source conversation/context
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
}

export interface CreateMemoryOptions {
  projectName: string;
  content: string;
  type?: MemoryType;
  tags?: string[];
  relatedTo?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchMemoryOptions {
  projectName: string;
  query: string;
  type?: MemoryType | 'all';
  limit?: number;
  tag?: string;
}

export interface ListMemoryOptions {
  projectName: string;
  type?: MemoryType | 'all';
  tag?: string;
  limit?: number;
}

class MemoryService {
  private getCollectionName(projectName: string): string {
    return `${projectName}_agent_memory`;
  }

  /**
   * Store a new memory
   */
  async remember(options: CreateMemoryOptions): Promise<Memory> {
    const { projectName, content, type = 'note', tags = [], relatedTo, metadata } = options;
    const collectionName = this.getCollectionName(projectName);

    const memory: Memory = {
      id: uuidv4(),
      type,
      content,
      tags,
      relatedTo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata,
    };

    // Add todo-specific fields
    if (type === 'todo') {
      memory.status = 'pending';
      memory.statusHistory = [{ status: 'pending', timestamp: memory.createdAt }];
    }

    // Create embedding for semantic search
    const embedding = await embeddingService.embed(
      `${type}: ${content}${relatedTo ? ` (related to: ${relatedTo})` : ''}${tags.length > 0 ? ` [tags: ${tags.join(', ')}]` : ''}`
    );

    const point: VectorPoint = {
      id: memory.id,
      vector: embedding,
      payload: {
        ...memory,
        project: projectName,
      },
    };

    await vectorStore.upsert(collectionName, [point]);

    logger.info(`Memory stored: ${type}`, { id: memory.id, project: projectName });
    return memory;
  }

  /**
   * Recall memories by semantic search
   */
  async recall(options: SearchMemoryOptions): Promise<MemorySearchResult[]> {
    const { projectName, query, type = 'all', limit = 5, tag } = options;
    const collectionName = this.getCollectionName(projectName);

    const embedding = await embeddingService.embed(query);

    // Build Qdrant filter
    const mustConditions: Record<string, unknown>[] = [];
    if (type && type !== 'all') {
      mustConditions.push({ key: 'type', match: { value: type } });
    }
    if (tag) {
      mustConditions.push({ key: 'tags', match: { any: [tag] } });
    }

    const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

    const results = await vectorStore.search(
      collectionName,
      embedding,
      limit,
      filter
    );

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
        status: r.payload.status as TodoStatus | undefined,
        statusHistory: r.payload.statusHistory as Memory['statusHistory'],
      },
      score: r.score,
    }));
  }

  /**
   * List memories with filters
   */
  async list(options: ListMemoryOptions): Promise<Memory[]> {
    const { projectName, type = 'all', tag, limit = 10 } = options;
    const collectionName = this.getCollectionName(projectName);

    // Use a generic query to get recent memories
    const embedding = await embeddingService.embed(
      type !== 'all' ? `${type} memories` : 'recent memories notes decisions'
    );

    // Build Qdrant filter
    const mustConditions: Record<string, unknown>[] = [];
    if (type && type !== 'all') {
      mustConditions.push({ key: 'type', match: { value: type } });
    }
    if (tag) {
      mustConditions.push({ key: 'tags', match: { any: [tag] } });
    }

    const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

    const results = await vectorStore.search(
      collectionName,
      embedding,
      limit,
      filter
    );

    return results.map(r => ({
      id: r.id,
      type: r.payload.type as MemoryType,
      content: r.payload.content as string,
      tags: (r.payload.tags as string[]) || [],
      relatedTo: r.payload.relatedTo as string | undefined,
      createdAt: r.payload.createdAt as string,
      updatedAt: r.payload.updatedAt as string,
      metadata: r.payload.metadata as Record<string, unknown> | undefined,
      status: r.payload.status as TodoStatus | undefined,
      statusHistory: r.payload.statusHistory as Memory['statusHistory'],
    }));
  }

  /**
   * Delete a specific memory
   */
  async forget(projectName: string, memoryId: string): Promise<boolean> {
    const collectionName = this.getCollectionName(projectName);

    try {
      await vectorStore.delete(collectionName, [memoryId]);
      logger.info(`Memory deleted: ${memoryId}`, { project: projectName });
      return true;
    } catch (error) {
      logger.error(`Failed to delete memory: ${memoryId}`, { error });
      return false;
    }
  }

  /**
   * Delete memories by type
   */
  async forgetByType(projectName: string, type: MemoryType): Promise<number> {
    const collectionName = this.getCollectionName(projectName);

    try {
      await vectorStore.deleteByFilter(collectionName, {
        must: [{ key: 'type', match: { value: type } }],
      });
      logger.info(`Memories of type ${type} deleted`, { project: projectName });
      return 1; // Qdrant doesn't return count
    } catch (error) {
      logger.error(`Failed to delete memories by type: ${type}`, { error });
      return 0;
    }
  }

  /**
   * Update todo status
   */
  async updateTodoStatus(
    projectName: string,
    todoId: string,
    status: TodoStatus,
    note?: string
  ): Promise<Memory | null> {
    const collectionName = this.getCollectionName(projectName);

    // First, recall the todo
    const results = await this.recall({
      projectName,
      query: todoId,
      type: 'todo',
      limit: 10,
    });

    const todo = results.find(r => r.memory.id === todoId);
    if (!todo) {
      logger.warn(`Todo not found: ${todoId}`);
      return null;
    }

    // Update the memory
    const updatedMemory: Memory = {
      ...todo.memory,
      status,
      updatedAt: new Date().toISOString(),
      statusHistory: [
        ...(todo.memory.statusHistory || []),
        { status, timestamp: new Date().toISOString(), note },
      ],
    };

    // Re-embed and update
    const embedding = await embeddingService.embed(
      `todo: ${updatedMemory.content} [status: ${status}]${updatedMemory.relatedTo ? ` (related to: ${updatedMemory.relatedTo})` : ''}`
    );

    const point: VectorPoint = {
      id: updatedMemory.id,
      vector: embedding,
      payload: {
        ...updatedMemory,
        project: projectName,
      },
    };

    await vectorStore.upsert(collectionName, [point]);

    logger.info(`Todo status updated: ${todoId} -> ${status}`, { project: projectName });
    return updatedMemory;
  }

  /**
   * Get memory statistics
   */
  async getStats(projectName: string): Promise<{
    total: number;
    byType: Record<MemoryType, number>;
  }> {
    const collectionName = this.getCollectionName(projectName);
    const info = await vectorStore.getCollectionInfo(collectionName);

    // Aggregate real counts by type from collection
    const typeCounts = await vectorStore.aggregateByField(collectionName, 'type');

    return {
      total: info.vectorsCount,
      byType: {
        decision: typeCounts['decision'] || 0,
        insight: typeCounts['insight'] || 0,
        context: typeCounts['context'] || 0,
        todo: typeCounts['todo'] || 0,
        conversation: typeCounts['conversation'] || 0,
        note: typeCounts['note'] || 0,
      },
    };
  }

  /**
   * Batch remember - store multiple memories efficiently
   */
  async batchRemember(
    projectName: string,
    items: Array<Omit<CreateMemoryOptions, 'projectName'>>
  ): Promise<{ saved: Memory[]; errors: string[] }> {
    const collectionName = this.getCollectionName(projectName);
    const saved: Memory[] = [];
    const errors: string[] = [];

    // Create all memories and embeddings in batch
    const memories: Memory[] = [];
    const textsToEmbed: string[] = [];

    for (const item of items) {
      const { content, type = 'note', tags = [], relatedTo, metadata } = item;

      const memory: Memory = {
        id: uuidv4(),
        type,
        content,
        tags,
        relatedTo,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata,
      };

      if (type === 'todo') {
        memory.status = 'pending';
        memory.statusHistory = [{ status: 'pending', timestamp: memory.createdAt }];
      }

      memories.push(memory);
      textsToEmbed.push(
        `${type}: ${content}${relatedTo ? ` (related to: ${relatedTo})` : ''}${tags.length > 0 ? ` [tags: ${tags.join(', ')}]` : ''}`
      );
    }

    try {
      // Batch embed all texts
      const embeddings = await embeddingService.embedBatch(textsToEmbed);

      // Create points
      const points: VectorPoint[] = memories.map((memory, i) => ({
        id: memory.id,
        vector: embeddings[i],
        payload: {
          ...memory,
          project: projectName,
        },
      }));

      // Batch upsert
      await vectorStore.upsert(collectionName, points);
      saved.push(...memories);

      logger.info(`Batch remember: ${saved.length} memories saved`, { projectName });
    } catch (error: any) {
      errors.push(`Batch operation failed: ${error.message}`);
      logger.error('Batch remember failed', { error: error.message, projectName });
    }

    return { saved, errors };
  }

  /**
   * Validate auto-extracted memory (mark as user-validated)
   */
  async validateMemory(projectName: string, memoryId: string, validated: boolean): Promise<Memory | null> {
    const collectionName = this.getCollectionName(projectName);

    // Find the memory
    const results = await this.recall({
      projectName,
      query: memoryId,
      limit: 1,
    });

    if (results.length === 0) {
      return null;
    }

    const memory = results[0].memory;
    const updatedMemory: Memory = {
      ...memory,
      validated,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...memory.metadata,
        validatedAt: new Date().toISOString(),
      },
    };

    // Re-embed and update
    const embedding = await embeddingService.embed(
      `${updatedMemory.type}: ${updatedMemory.content}${updatedMemory.relatedTo ? ` (related to: ${updatedMemory.relatedTo})` : ''}`
    );

    const point: VectorPoint = {
      id: updatedMemory.id,
      vector: embedding,
      payload: {
        ...updatedMemory,
        project: projectName,
      },
    };

    await vectorStore.upsert(collectionName, [point]);
    logger.info(`Memory validated: ${memoryId} = ${validated}`, { projectName });

    return updatedMemory;
  }

  /**
   * Get unvalidated auto-extracted memories for review
   */
  async getUnvalidatedMemories(projectName: string, limit: number = 20): Promise<Memory[]> {
    const collectionName = this.getCollectionName(projectName);

    try {
      // Search for memories that were auto-extracted and not yet validated
      const embedding = await embeddingService.embed('auto extracted memories unvalidated');

      const results = await vectorStore.search(
        collectionName,
        embedding,
        limit * 2, // Get more to filter
        {
          must: [
            { key: 'validated', match: { value: false } },
          ],
        }
      );

      return results
        .filter(r => r.payload.source && (r.payload.source as string).startsWith('auto_'))
        .slice(0, limit)
        .map(r => ({
          id: r.id,
          type: r.payload.type as MemoryType,
          content: r.payload.content as string,
          tags: (r.payload.tags as string[]) || [],
          relatedTo: r.payload.relatedTo as string | undefined,
          createdAt: r.payload.createdAt as string,
          updatedAt: r.payload.updatedAt as string,
          metadata: r.payload.metadata as Record<string, unknown> | undefined,
          source: r.payload.source as MemorySource,
          confidence: r.payload.confidence as number,
          validated: r.payload.validated as boolean,
        }));
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }
}

export const memoryService = new MemoryService();
export default memoryService;
