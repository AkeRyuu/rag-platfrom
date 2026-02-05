/**
 * Cache Service - Redis caching for embeddings, search results, and collection info
 */

import Redis from 'ioredis';
import crypto from 'crypto';
import config from '../config';
import { logger } from '../utils/logger';

// TTL values in seconds
const TTL = {
  EMBEDDING: 3600,        // 1 hour
  SEARCH: 300,            // 5 minutes
  COLLECTION_INFO: 30,    // 30 seconds
  CONFLUENCE_PAGE: 3600,  // 1 hour
};

class CacheService {
  private client: Redis | null = null;
  private enabled: boolean = false;

  async initialize(): Promise<void> {
    if (!config.REDIS_URL) {
      logger.info('Cache disabled: REDIS_URL not configured');
      return;
    }

    try {
      this.client = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number): number | null => {
          if (times > 3) {
            logger.warn('Redis connection failed, cache disabled');
            return null;
          }
          return Math.min(times * 200, 1000);
        },
        lazyConnect: true,
      });

      await this.client.connect();
      this.enabled = true;
      logger.info('Cache initialized', { url: config.REDIS_URL.replace(/\/\/.*@/, '//***@') });
    } catch (error) {
      logger.warn('Failed to connect to Redis, cache disabled', { error });
      this.client = null;
      this.enabled = false;
    }
  }

  /**
   * Check if cache is available
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Generate a hash key for caching
   */
  private hash(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isEnabled()) return null;

    try {
      const value = await this.client!.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      logger.debug('Cache get failed', { key, error });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client!.setex(key, ttlSeconds, serialized);
      } else {
        await this.client!.set(key, serialized);
      }
    } catch (error) {
      logger.debug('Cache set failed', { key, error });
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      await this.client!.del(key);
    } catch (error) {
      logger.debug('Cache delete failed', { key, error });
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const keys = await this.client!.keys(pattern);
      if (keys.length > 0) {
        await this.client!.del(...keys);
      }
    } catch (error) {
      logger.debug('Cache delete pattern failed', { pattern, error });
    }
  }

  /**
   * Get or set with callback
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  // ============================================
  // Embedding Cache
  // ============================================

  /**
   * Get cached embedding
   */
  async getEmbedding(text: string): Promise<number[] | null> {
    const key = `emb:${this.hash(text)}`;
    return this.get<number[]>(key);
  }

  /**
   * Cache embedding
   */
  async setEmbedding(text: string, embedding: number[]): Promise<void> {
    const key = `emb:${this.hash(text)}`;
    await this.set(key, embedding, TTL.EMBEDDING);
  }

  /**
   * Get or compute embedding
   */
  async getOrSetEmbedding(
    text: string,
    compute: () => Promise<number[]>
  ): Promise<number[]> {
    const key = `emb:${this.hash(text)}`;
    return this.getOrSet(key, compute, TTL.EMBEDDING);
  }

  // ============================================
  // Search Cache
  // ============================================

  /**
   * Get cached search results
   */
  async getSearchResults<T>(
    collection: string,
    query: string,
    filters?: Record<string, unknown>
  ): Promise<T | null> {
    const filterStr = filters ? JSON.stringify(filters) : '';
    const key = `search:${collection}:${this.hash(query + filterStr)}`;
    return this.get<T>(key);
  }

  /**
   * Cache search results
   */
  async setSearchResults<T>(
    collection: string,
    query: string,
    results: T,
    filters?: Record<string, unknown>
  ): Promise<void> {
    const filterStr = filters ? JSON.stringify(filters) : '';
    const key = `search:${collection}:${this.hash(query + filterStr)}`;
    await this.set(key, results, TTL.SEARCH);
  }

  /**
   * Invalidate search cache for a collection
   */
  async invalidateCollection(collection: string): Promise<void> {
    await this.deletePattern(`search:${collection}:*`);
    await this.deletePattern(`colinfo:${collection}`);
  }

  // ============================================
  // Collection Info Cache
  // ============================================

  /**
   * Get cached collection info
   */
  async getCollectionInfo<T>(collection: string): Promise<T | null> {
    const key = `colinfo:${collection}`;
    return this.get<T>(key);
  }

  /**
   * Cache collection info
   */
  async setCollectionInfo<T>(collection: string, info: T): Promise<void> {
    const key = `colinfo:${collection}`;
    await this.set(key, info, TTL.COLLECTION_INFO);
  }

  // ============================================
  // Stats
  // ============================================

  /**
   * Get cache stats
   */
  async getStats(): Promise<{
    enabled: boolean;
    connected: boolean;
    keys?: number;
    memory?: string;
  }> {
    if (!this.isEnabled()) {
      return { enabled: false, connected: false };
    }

    try {
      const info = await this.client!.info('memory');
      const dbSize = await this.client!.dbsize();
      const memMatch = info.match(/used_memory_human:(.+)/);

      return {
        enabled: true,
        connected: true,
        keys: dbSize,
        memory: memMatch ? memMatch[1].trim() : undefined,
      };
    } catch (error) {
      return { enabled: true, connected: false };
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.enabled = false;
    }
  }
}

export const cacheService = new CacheService();
export default cacheService;
