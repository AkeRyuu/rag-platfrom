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
  indexedFields?: string[];
  config?: {
    vectorSize: number;
    distance: string;
  };
  segmentsCount?: number;
  optimizerStatus?: string;
}

// Payload fields to index for fast filtering
const INDEXED_FIELDS: Array<{ fieldName: string; type: 'keyword' | 'integer' | 'float' | 'bool' }> = [
  { fieldName: 'language', type: 'keyword' },
  { fieldName: 'file', type: 'keyword' },
  { fieldName: 'type', type: 'keyword' },
  { fieldName: 'spaceKey', type: 'keyword' },
  { fieldName: 'project', type: 'keyword' },
  { fieldName: 'pageId', type: 'keyword' },
];

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

        // Create payload indexes for fast filtering
        await this.createPayloadIndexes(name);
      }
    } catch (error) {
      logger.error(`Failed to ensure collection: ${name}`, { error });
      throw error;
    }
  }

  /**
   * Create payload indexes on a collection for fast filtering
   */
  async createPayloadIndexes(collection: string): Promise<void> {
    for (const field of INDEXED_FIELDS) {
      try {
        await this.client.createPayloadIndex(collection, {
          field_name: field.fieldName,
          field_schema: field.type,
          wait: true,
        });
        logger.debug(`Created index on ${collection}.${field.fieldName}`);
      } catch (error: any) {
        // Index might already exist, that's ok
        if (!error.message?.includes('already exists')) {
          logger.warn(`Failed to create index on ${collection}.${field.fieldName}`, { error: error.message });
        }
      }
    }
    logger.info(`Created payload indexes on collection: ${collection}`);
  }

  /**
   * Ensure indexes exist on an existing collection (for migrations)
   */
  async ensurePayloadIndexes(collection: string): Promise<void> {
    try {
      const info = await this.client.getCollection(collection);
      if (info.status === 'green') {
        await this.createPayloadIndexes(collection);
      }
    } catch (error: any) {
      if (error.status !== 404) {
        logger.error(`Failed to ensure indexes on ${collection}`, { error });
      }
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

      // Extract indexed field names from payload schema
      const indexedFields: string[] = [];
      if (info.payload_schema) {
        for (const [fieldName, schema] of Object.entries(info.payload_schema)) {
          if (schema && typeof schema === 'object' && 'data_type' in schema) {
            indexedFields.push(fieldName);
          }
        }
      }

      // Extract vector config
      let vectorSize = 0;
      let distance = 'unknown';
      if (info.config?.params?.vectors) {
        const vectors = info.config.params.vectors as any;
        if (typeof vectors === 'object' && 'size' in vectors) {
          vectorSize = vectors.size;
          distance = vectors.distance || 'Cosine';
        }
      }

      return {
        name,
        vectorsCount: info.points_count || 0,
        status: info.status,
        indexedFields,
        config: {
          vectorSize,
          distance,
        },
        segmentsCount: info.segments_count,
        optimizerStatus: typeof info.optimizer_status === 'object' ? (info.optimizer_status as any)?.status : undefined,
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
    filter?: Record<string, unknown>,
    scoreThreshold?: number
  ): Promise<SearchResult[]> {
    try {
      const results = await this.client.search(collection, {
        vector,
        limit,
        with_payload: true,
        filter: filter as any,
        score_threshold: scoreThreshold,
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
  async count(collection: string, filter?: Record<string, unknown>): Promise<number> {
    try {
      if (filter) {
        // Use count endpoint with filter (efficient with indexed fields)
        const result = await this.client.count(collection, {
          filter: filter as any,
          exact: true,
        });
        return result.count;
      }

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
   * Get faceted counts for a field (uses indexed field for efficiency)
   */
  async getFacetCounts(collection: string, field: string, values: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    // Run count queries in parallel for each value
    const promises = values.map(async (value) => {
      const filter = {
        must: [{ key: field, match: { value } }],
      };
      const count = await this.count(collection, filter);
      return { value, count };
    });

    const results = await Promise.all(promises);
    for (const { value, count } of results) {
      if (count > 0) {
        counts[value] = count;
      }
    }

    return counts;
  }

  /**
   * Aggregate counts by a specific payload field
   */
  async aggregateByField(collection: string, field: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    try {
      let offset: string | number | undefined = undefined;

      do {
        const response = await this.client.scroll(collection, {
          limit: 1000,
          offset,
          with_payload: true,
          with_vector: false,
        });

        for (const point of response.points) {
          const payload = point.payload as Record<string, unknown>;
          const value = payload[field];
          if (value && typeof value === 'string') {
            counts[value] = (counts[value] || 0) + 1;
          }
        }

        offset = response.next_page_offset as string | number | undefined;
      } while (offset);

      return counts;
    } catch (error: any) {
      if (error.status === 404) {
        return {};
      }
      throw error;
    }
  }

  /**
   * Get aggregated stats using indexed fields for efficiency
   * Falls back to scroll for unique file count (unavoidable for uniqueness)
   */
  async aggregateStats(collection: string): Promise<{
    totalFiles: number;
    totalVectors: number;
    languages: Record<string, number>;
    lastIndexed?: string;
  }> {
    try {
      // Get total vector count (fast)
      const totalVectors = await this.count(collection);
      if (totalVectors === 0) {
        return { totalFiles: 0, totalVectors: 0, languages: {}, lastIndexed: undefined };
      }

      // Get language counts using indexed facets
      // Common languages to check - uses indexed field
      const commonLanguages = [
        'typescript', 'javascript', 'python', 'vue', 'html', 'css', 'scss',
        'json', 'yaml', 'markdown', 'sql', 'shell', 'dockerfile', 'go',
        'java', 'rust', 'c', 'cpp', 'csharp', 'php', 'ruby', 'swift', 'kotlin'
      ];
      const languages = await this.getFacetCounts(collection, 'language', commonLanguages);

      // For unique files and lastIndexed, we need a limited scroll
      // Only scan first batch to get lastIndexed (newest entries are typically at end)
      let totalFiles = 0;
      let lastIndexed: string | undefined;
      const files = new Set<string>();

      // Scroll to count unique files (limit to 5000 for performance)
      let offset: string | number | undefined = undefined;
      let scanned = 0;
      const maxScan = 5000;

      do {
        const response = await this.client.scroll(collection, {
          limit: 1000,
          offset,
          with_payload: { include: ['file', 'indexedAt'] },
          with_vector: false,
        });

        for (const point of response.points) {
          const payload = point.payload as Record<string, unknown>;

          if (payload.file) {
            files.add(payload.file as string);
          }

          if (payload.indexedAt) {
            const indexedAt = payload.indexedAt as string;
            if (!lastIndexed || indexedAt > lastIndexed) {
              lastIndexed = indexedAt;
            }
          }
        }

        scanned += response.points.length;
        offset = response.next_page_offset as string | number | undefined;
      } while (offset && scanned < maxScan);

      totalFiles = files.size;
      // Estimate if we hit the limit
      if (scanned >= maxScan && totalVectors > maxScan) {
        // Rough estimate: unique files ratio
        const ratio = files.size / scanned;
        totalFiles = Math.round(totalVectors * ratio);
      }

      return {
        totalFiles,
        totalVectors,
        languages,
        lastIndexed,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return { totalFiles: 0, totalVectors: 0, languages: {}, lastIndexed: undefined };
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
