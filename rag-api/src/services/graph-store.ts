/**
 * Graph Store Service - Stores and queries code dependency edges in Qdrant.
 *
 * Each point in {project}_graph represents an edge between code entities.
 * Supports N-hop expansion, dependents/dependencies, and blast radius analysis.
 */

import { v4 as uuidv4 } from 'uuid';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { logger } from '../utils/logger';
import { graphEdgesTotal, graphExpansionDuration } from '../utils/metrics';
import type { GraphEdge } from './parsers/ast-parser';

class GraphStoreService {
  private getCollectionName(projectName: string): string {
    return `${projectName}_graph`;
  }

  /**
   * Index edges for a file (replaces existing edges for that file).
   */
  async indexFileEdges(projectName: string, filePath: string, edges: GraphEdge[]): Promise<void> {
    const collection = this.getCollectionName(projectName);

    // Clear existing edges for this file
    await this.clearFileEdges(projectName, filePath);

    if (edges.length === 0) return;

    // Create points for each edge
    const points: VectorPoint[] = [];

    for (const edge of edges) {
      const edgeText = `${edge.fromFile}:${edge.fromSymbol} ${edge.edgeType} ${edge.toFile}:${edge.toSymbol}`;
      const embedding = await embeddingService.embed(edgeText);

      points.push({
        id: uuidv4(),
        vector: embedding,
        payload: {
          fromFile: edge.fromFile,
          fromSymbol: edge.fromSymbol,
          toFile: edge.toFile,
          toSymbol: edge.toSymbol,
          edgeType: edge.edgeType,
          project: projectName,
        },
      });

      graphEdgesTotal.inc({ project: projectName, edge_type: edge.edgeType });
    }

    await vectorStore.upsert(collection, points);
    logger.debug(`Indexed ${edges.length} edges for ${filePath}`, { project: projectName });
  }

  /**
   * Clear all edges originating from a file.
   */
  async clearFileEdges(projectName: string, filePath: string): Promise<void> {
    const collection = this.getCollectionName(projectName);

    try {
      await vectorStore.deleteByFilter(collection, {
        must: [{ key: 'fromFile', match: { value: filePath } }],
      });
    } catch (error: any) {
      if (error.status !== 404) {
        logger.warn(`Failed to clear edges for ${filePath}`, { error: error.message });
      }
    }
  }

  /**
   * N-hop expansion: given seed files, find connected files up to N hops.
   */
  async expand(projectName: string, files: string[], hops: number = 1): Promise<string[]> {
    const startTime = Date.now();
    const collection = this.getCollectionName(projectName);
    const visited = new Set<string>(files);
    let frontier = [...files];

    try {
      for (let hop = 0; hop < hops && frontier.length > 0; hop++) {
        const nextFrontier: string[] = [];

        for (const file of frontier) {
          // Get outgoing edges
          const deps = await this.getEdgesByFile(collection, 'fromFile', file);
          for (const dep of deps) {
            if (!visited.has(dep)) {
              visited.add(dep);
              nextFrontier.push(dep);
            }
          }

          // Get incoming edges
          const dependents = await this.getEdgesByFile(collection, 'toFile', file);
          for (const dep of dependents) {
            if (!visited.has(dep)) {
              visited.add(dep);
              nextFrontier.push(dep);
            }
          }
        }

        frontier = nextFrontier;
      }
    } catch (error: any) {
      if (error.status !== 404) {
        logger.warn('Graph expansion failed', { error: error.message });
      }
    }

    graphExpansionDuration.observe({ project: projectName }, (Date.now() - startTime) / 1000);
    return [...visited];
  }

  /**
   * Get files that depend on (import/call) the given file.
   */
  async getDependents(projectName: string, filePath: string): Promise<GraphEdge[]> {
    const collection = this.getCollectionName(projectName);
    return this.getEdges(collection, 'toFile', filePath);
  }

  /**
   * Get files that the given file depends on.
   */
  async getDependencies(projectName: string, filePath: string): Promise<GraphEdge[]> {
    const collection = this.getCollectionName(projectName);
    return this.getEdges(collection, 'fromFile', filePath);
  }

  /**
   * Transitive impact analysis: find all files affected by changes to given files.
   */
  async getBlastRadius(
    projectName: string,
    filePaths: string[],
    maxDepth: number = 3
  ): Promise<{ affectedFiles: string[]; depth: number; edgeCount: number }> {
    const collection = this.getCollectionName(projectName);
    const affected = new Set<string>(filePaths);
    let frontier = [...filePaths];
    let depth = 0;
    let edgeCount = 0;

    try {
      for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
        depth = d + 1;
        const nextFrontier: string[] = [];

        for (const file of frontier) {
          // Only follow incoming edges (who depends on this file)
          const results = await vectorStore['client'].scroll(collection, {
            limit: 100,
            with_payload: true,
            filter: {
              must: [{ key: 'toFile', match: { value: file } }],
            },
          });

          for (const point of results.points) {
            const payload = point.payload as Record<string, unknown>;
            const fromFile = payload.fromFile as string;
            edgeCount++;

            if (!affected.has(fromFile)) {
              affected.add(fromFile);
              nextFrontier.push(fromFile);
            }
          }
        }

        frontier = nextFrontier;
      }
    } catch (error: any) {
      if (error.status !== 404) {
        logger.warn('Blast radius analysis failed', { error: error.message });
      }
    }

    return {
      affectedFiles: [...affected],
      depth,
      edgeCount,
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  private async getEdges(
    collection: string,
    field: 'fromFile' | 'toFile',
    filePath: string
  ): Promise<GraphEdge[]> {
    try {
      const results = await vectorStore['client'].scroll(collection, {
        limit: 100,
        with_payload: true,
        filter: {
          must: [{ key: field, match: { value: filePath } }],
        },
      });

      return results.points.map(p => {
        const payload = p.payload as Record<string, unknown>;
        return {
          fromFile: payload.fromFile as string,
          fromSymbol: payload.fromSymbol as string,
          toFile: payload.toFile as string,
          toSymbol: payload.toSymbol as string,
          edgeType: payload.edgeType as GraphEdge['edgeType'],
        };
      });
    } catch (error: any) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  private async getEdgesByFile(
    collection: string,
    field: 'fromFile' | 'toFile',
    filePath: string
  ): Promise<string[]> {
    const otherField = field === 'fromFile' ? 'toFile' : 'fromFile';

    try {
      const results = await vectorStore['client'].scroll(collection, {
        limit: 100,
        with_payload: { include: [otherField] },
        filter: {
          must: [{ key: field, match: { value: filePath } }],
        },
      });

      return results.points
        .map(p => (p.payload as Record<string, unknown>)[otherField] as string)
        .filter(Boolean);
    } catch (error: any) {
      if (error.status === 404) return [];
      throw error;
    }
  }
}

export const graphStore = new GraphStoreService();
export default graphStore;
