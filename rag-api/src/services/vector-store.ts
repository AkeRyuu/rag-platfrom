/**
 * Vector Store Service - Qdrant client with multi-project support
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import { logger } from '../utils/logger';

export interface VectorPoint {
  id?: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface CollectionInfo {
  name: string;
  vectorsCount: number;
  status: string;
}

class VectorStoreService {
  private client: QdrantClient;
  private initialized: boolean = false;

  constructor() {
    this.client = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
      checkCompatibility: false, // Skip version check (server v1.7.4)
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.client.getCollections();
      this.initialized = true;
      logger.info('Vector store initialized', { url: config.QDRANT_URL });
    } catch (error) {
      logger.error('Failed to connect to Qdrant', { error });
      throw error;
    }
  }

  /**
   * Ensure a collection exists, create if not
   */
  async ensureCollection(name: string): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === name);

      if (!exists) {
        await this.client.createCollection(name, {
          vectors: {
            size: config.VECTOR_SIZE,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
        });
        logger.info(`Created collection: ${name}`);
      }
    } catch (error) {
      logger.error(`Failed to ensure collection: ${name}`, { error });
      throw error;
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<void> {
    try {
      await this.client.deleteCollection(name);
      logger.info(`Deleted collection: ${name}`);
    } catch (error) {
      logger.error(`Failed to delete collection: ${name}`, { error });
      throw error;
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    const collections = await this.client.getCollections();
    return collections.collections.map(c => c.name);
  }

  /**
   * List collections for a specific project
   */
  async listProjectCollections(projectName: string): Promise<string[]> {
    const collections = await this.listCollections();
    const prefix = `${projectName}_`;
    return collections.filter(c => c.startsWith(prefix));
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(name: string): Promise<CollectionInfo> {
    try {
      const info = await this.client.getCollection(name);
      return {
        name,
        vectorsCount: info.points_count || 0,
        status: info.status,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return { name, vectorsCount: 0, status: 'not_found' };
      }
      throw error;
    }
  }

  /**
   * Upsert vectors
   */
  async upsert(collection: string, points: VectorPoint[]): Promise<void> {
    await this.ensureCollection(collection);

    const formattedPoints = points.map(p => ({
      id: p.id || uuidv4(),
      vector: p.vector,
      payload: p.payload,
    }));

    await this.client.upsert(collection, {
      wait: true,
      points: formattedPoints,
    });

    logger.debug(`Upserted ${points.length} points to ${collection}`);
  }

  /**
   * Search vectors
   */
  async search(
    collection: string,
    vector: number[],
    limit: number = 10,
    filter?: Record<string, unknown>
  ): Promise<SearchResult[]> {
    try {
      const results = await this.client.search(collection, {
        vector,
        limit,
        with_payload: true,
        filter: filter as any,
      });

      return results.map(r => ({
        id: r.id as string,
        score: r.score,
        payload: r.payload as Record<string, unknown>,
      }));
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete vectors by IDs
   */
  async delete(collection: string, ids: string[]): Promise<void> {
    await this.client.delete(collection, {
      wait: true,
      points: ids,
    });
  }

  /**
   * Delete vectors by filter
   */
  async deleteByFilter(collection: string, filter: Record<string, unknown>): Promise<void> {
    await this.client.delete(collection, {
      wait: true,
      filter: filter as any,
    });
  }

  /**
   * Count vectors in collection
   */
  async count(collection: string): Promise<number> {
    try {
      const info = await this.client.getCollection(collection);
      return info.points_count || 0;
    } catch (error: any) {
      if (error.status === 404) {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Clear all vectors in a collection (but keep the collection)
   */
  async clearCollection(collection: string): Promise<void> {
    try {
      // Delete all points by scrolling and deleting in batches
      let offset: string | undefined = undefined;

      do {
        const response = await this.client.scroll(collection, {
          limit: 1000,
          offset,
          with_payload: false,
          with_vector: false,
        });

        const ids = response.points.map(p => p.id as string);
        if (ids.length > 0) {
          await this.delete(collection, ids);
        }

        offset = response.next_page_offset as string | undefined;
      } while (offset);

      logger.info(`Cleared collection: ${collection}`);
    } catch (error: any) {
      if (error.status !== 404) {
        throw error;
      }
    }
  }
}

export const vectorStore = new VectorStoreService();
export default vectorStore;
