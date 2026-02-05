/**
 * Usage Tracker Service - Track MCP tool invocations for analytics
 *
 * Tracks:
 * - Tool name, timestamp, duration
 * - Query/input summary
 * - Result count, success/error
 * - Session ID
 * - Patterns and trends
 */

import { v4 as uuidv4 } from 'uuid';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { logger } from '../utils/logger';

export interface ToolUsage {
  id: string;
  projectName: string;
  sessionId: string;
  toolName: string;
  timestamp: string;
  durationMs: number;
  inputSummary: string;
  resultCount: number;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageStats {
  totalCalls: number;
  successRate: number;
  avgDurationMs: number;
  topTools: { tool: string; count: number }[];
  callsByHour: Record<number, number>;
  errorsByTool: Record<string, number>;
}

export interface TrackOptions {
  projectName: string;
  sessionId?: string;
  toolName: string;
  inputSummary: string;
  startTime: number;
  resultCount?: number;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

class UsageTrackerService {
  private getCollectionName(projectName: string): string {
    return `${projectName}_tool_usage`;
  }

  /**
   * Track a tool invocation
   */
  async track(options: TrackOptions): Promise<ToolUsage> {
    const {
      projectName,
      sessionId = 'unknown',
      toolName,
      inputSummary,
      startTime,
      resultCount = 0,
      success,
      errorMessage,
      metadata,
    } = options;

    const collectionName = this.getCollectionName(projectName);
    const now = Date.now();

    const usage: ToolUsage = {
      id: uuidv4(),
      projectName,
      sessionId,
      toolName,
      timestamp: new Date().toISOString(),
      durationMs: now - startTime,
      inputSummary: inputSummary.slice(0, 500), // Limit size
      resultCount,
      success,
      errorMessage,
      metadata,
    };

    try {
      // Create embedding from tool+input for pattern analysis
      const embeddingText = `${toolName}: ${inputSummary}`;
      const embedding = await embeddingService.embed(embeddingText);

      const point: VectorPoint = {
        id: usage.id,
        vector: embedding,
        payload: {
          ...usage,
          hour: new Date().getHours(),
          dayOfWeek: new Date().getDay(),
        },
      };

      await vectorStore.upsert(collectionName, [point]);
      logger.debug(`Tracked tool usage: ${toolName}`, { durationMs: usage.durationMs, success });
    } catch (error: any) {
      // Don't fail the main operation if tracking fails
      logger.warn('Failed to track tool usage', { error: error.message });
    }

    return usage;
  }

  /**
   * Get usage statistics for a project
   */
  async getStats(projectName: string, days: number = 7): Promise<UsageStats> {
    const collectionName = this.getCollectionName(projectName);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    try {
      // Get all usage records (limited to recent)
      const usages: ToolUsage[] = [];
      let offset: string | number | undefined = undefined;

      do {
        const response = await vectorStore['client'].scroll(collectionName, {
          limit: 1000,
          offset,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [{
              key: 'timestamp',
              range: { gte: cutoffDate.toISOString() },
            }],
          },
        });

        for (const point of response.points) {
          usages.push(point.payload as unknown as ToolUsage);
        }

        offset = response.next_page_offset as string | number | undefined;
      } while (offset && usages.length < 10000);

      // Calculate stats
      const totalCalls = usages.length;
      const successCount = usages.filter(u => u.success).length;
      const successRate = totalCalls > 0 ? successCount / totalCalls : 0;
      const avgDurationMs = totalCalls > 0
        ? usages.reduce((sum, u) => sum + u.durationMs, 0) / totalCalls
        : 0;

      // Top tools
      const toolCounts: Record<string, number> = {};
      const errorsByTool: Record<string, number> = {};
      const callsByHour: Record<number, number> = {};

      for (const usage of usages) {
        toolCounts[usage.toolName] = (toolCounts[usage.toolName] || 0) + 1;
        if (!usage.success) {
          errorsByTool[usage.toolName] = (errorsByTool[usage.toolName] || 0) + 1;
        }
        const hour = new Date(usage.timestamp).getHours();
        callsByHour[hour] = (callsByHour[hour] || 0) + 1;
      }

      const topTools = Object.entries(toolCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tool, count]) => ({ tool, count }));

      return {
        totalCalls,
        successRate,
        avgDurationMs,
        topTools,
        callsByHour,
        errorsByTool,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return {
          totalCalls: 0,
          successRate: 0,
          avgDurationMs: 0,
          topTools: [],
          callsByHour: {},
          errorsByTool: {},
        };
      }
      throw error;
    }
  }

  /**
   * Find similar queries (for pattern analysis)
   */
  async findSimilarQueries(
    projectName: string,
    query: string,
    limit: number = 5
  ): Promise<{ usage: ToolUsage; score: number }[]> {
    const collectionName = this.getCollectionName(projectName);

    try {
      const embedding = await embeddingService.embed(query);
      const results = await vectorStore.search(collectionName, embedding, limit);

      return results.map(r => ({
        usage: r.payload as unknown as ToolUsage,
        score: r.score,
      }));
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get knowledge gaps (queries with no/low results)
   */
  async getKnowledgeGaps(projectName: string, limit: number = 20): Promise<{
    query: string;
    toolName: string;
    count: number;
    avgResultCount: number;
  }[]> {
    const collectionName = this.getCollectionName(projectName);
    const gaps: Map<string, { toolName: string; count: number; totalResults: number }> = new Map();

    try {
      let offset: string | number | undefined = undefined;
      let scanned = 0;

      do {
        const response = await vectorStore['client'].scroll(collectionName, {
          limit: 1000,
          offset,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [
              { key: 'resultCount', range: { lte: 2 } },
              { key: 'success', match: { value: true } },
            ],
          },
        });

        for (const point of response.points) {
          const usage = point.payload as unknown as ToolUsage;
          const key = usage.inputSummary.slice(0, 100);
          const existing = gaps.get(key) || { toolName: usage.toolName, count: 0, totalResults: 0 };
          existing.count++;
          existing.totalResults += usage.resultCount;
          gaps.set(key, existing);
        }

        scanned += response.points.length;
        offset = response.next_page_offset as string | number | undefined;
      } while (offset && scanned < 5000);

      return Array.from(gaps.entries())
        .filter(([_, data]) => data.count >= 2) // At least 2 occurrences
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit)
        .map(([query, data]) => ({
          query,
          toolName: data.toolName,
          count: data.count,
          avgResultCount: data.totalResults / data.count,
        }));
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }
}

export const usageTracker = new UsageTrackerService();
export default usageTracker;
