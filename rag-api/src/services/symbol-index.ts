/**
 * Symbol Index Service - Fast lookup index for exported symbols.
 *
 * Stores one point per exported symbol (function, class, type, interface)
 * with file reference, line number, and signature preview.
 * Used for exact symbol lookups and cross-file context enrichment.
 */

import { v4 as uuidv4 } from 'uuid';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { logger } from '../utils/logger';

export interface SymbolEntry {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'variable';
  file: string;
  startLine: number;
  endLine: number;
  signature: string;
  exports: boolean;
}

class SymbolIndexService {
  private getCollectionName(projectName: string): string {
    return `${projectName}_symbols`;
  }

  /**
   * Extract symbols from a code chunk and index them.
   */
  async indexFileSymbols(
    projectName: string,
    filePath: string,
    content: string,
    symbols: string[],
    startLine: number,
    endLine: number
  ): Promise<number> {
    if (!symbols || symbols.length === 0) return 0;

    const collection = this.getCollectionName(projectName);
    const entries: SymbolEntry[] = [];

    for (const symbol of symbols) {
      const kind = this.inferKind(symbol, content);
      const signature = this.extractSignature(symbol, content);

      entries.push({
        name: symbol,
        kind,
        file: filePath,
        startLine,
        endLine,
        signature,
        exports: content.includes(`export`) && content.includes(symbol),
      });
    }

    if (entries.length === 0) return 0;

    // Batch embed all symbols
    const texts = entries.map(e => `${e.kind} ${e.name} in ${e.file}: ${e.signature}`);
    const embeddings = await embeddingService.embedBatch(texts);

    const points: VectorPoint[] = entries.map((entry, i) => ({
      id: uuidv4(),
      vector: embeddings[i],
      payload: {
        ...entry,
        project: projectName,
        indexedAt: new Date().toISOString(),
      },
    }));

    await vectorStore.upsert(collection, points);
    return entries.length;
  }

  /**
   * Clear all symbols for a file (before re-indexing).
   */
  async clearFileSymbols(projectName: string, filePath: string): Promise<void> {
    const collection = this.getCollectionName(projectName);
    try {
      await vectorStore.deleteByFilter(collection, {
        must: [{ key: 'file', match: { value: filePath } }],
      });
    } catch (error: any) {
      if (error.status !== 404) {
        logger.warn(`Failed to clear symbols for ${filePath}`, { error: error.message });
      }
    }
  }

  /**
   * Search for a symbol by name (exact or fuzzy).
   */
  async findSymbol(
    projectName: string,
    symbolName: string,
    kind?: string,
    limit: number = 10
  ): Promise<SymbolEntry[]> {
    const collection = this.getCollectionName(projectName);

    try {
      const embedding = await embeddingService.embed(`${kind || ''} ${symbolName}`);
      const filter: Record<string, unknown> | undefined = kind
        ? { must: [{ key: 'kind', match: { value: kind } }] }
        : undefined;

      const results = await vectorStore.search(collection, embedding, limit, filter, 0.5);

      return results.map(r => ({
        name: r.payload.name as string,
        kind: r.payload.kind as SymbolEntry['kind'],
        file: r.payload.file as string,
        startLine: r.payload.startLine as number,
        endLine: r.payload.endLine as number,
        signature: r.payload.signature as string,
        exports: r.payload.exports as boolean,
      }));
    } catch (error: any) {
      if (error.status === 404) return [];
      logger.error('Symbol search failed', { error: error.message });
      return [];
    }
  }

  /**
   * Get all exported symbols from a specific file.
   */
  async getFileExports(projectName: string, filePath: string): Promise<SymbolEntry[]> {
    const collection = this.getCollectionName(projectName);

    try {
      const results = await vectorStore['client'].scroll(collection, {
        limit: 100,
        with_payload: true,
        filter: {
          must: [
            { key: 'file', match: { value: filePath } },
            { key: 'exports', match: { value: true } },
          ],
        },
      });

      return results.points.map(p => {
        const payload = p.payload as Record<string, unknown>;
        return {
          name: payload.name as string,
          kind: payload.kind as SymbolEntry['kind'],
          file: payload.file as string,
          startLine: payload.startLine as number,
          endLine: payload.endLine as number,
          signature: payload.signature as string,
          exports: payload.exports as boolean,
        };
      });
    } catch (error: any) {
      if (error.status === 404) return [];
      logger.error('Failed to get file exports', { error: error.message });
      return [];
    }
  }

  /**
   * Build cross-file context: for a file, get signatures of its imported symbols.
   */
  async getCrossFileContext(
    projectName: string,
    filePath: string,
    imports: string[]
  ): Promise<string> {
    if (!imports || imports.length === 0) return '';

    const parts: string[] = [];
    for (const imp of imports.slice(0, 10)) {
      const symbols = await this.findSymbol(projectName, imp, undefined, 1);
      if (symbols.length > 0) {
        const s = symbols[0];
        parts.push(`// from ${s.file}: ${s.signature}`);
      }
    }

    return parts.join('\n');
  }

  // ============================================
  // Private Helpers
  // ============================================

  private inferKind(symbol: string, content: string): SymbolEntry['kind'] {
    // Check patterns in content
    if (new RegExp(`\\binterface\\s+${this.escapeRegex(symbol)}\\b`).test(content)) return 'interface';
    if (new RegExp(`\\btype\\s+${this.escapeRegex(symbol)}\\b`).test(content)) return 'type';
    if (new RegExp(`\\bclass\\s+${this.escapeRegex(symbol)}\\b`).test(content)) return 'class';
    if (new RegExp(`\\benum\\s+${this.escapeRegex(symbol)}\\b`).test(content)) return 'enum';
    if (new RegExp(`\\bfunction\\s+${this.escapeRegex(symbol)}\\b`).test(content)) return 'function';
    if (new RegExp(`\\bconst\\s+${this.escapeRegex(symbol)}\\b`).test(content)) return 'const';
    return 'variable';
  }

  private extractSignature(symbol: string, content: string): string {
    const escaped = this.escapeRegex(symbol);

    // Try to extract function signature
    const funcMatch = content.match(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)[^{]*`, 's'));
    if (funcMatch) return funcMatch[0].trim().slice(0, 200);

    // Try arrow function
    const arrowMatch = content.match(new RegExp(`(?:export\\s+)?(?:const|let)\\s+${escaped}\\s*=\\s*(?:async\\s+)?\\([^)]*\\)[^=]*=>`, 's'));
    if (arrowMatch) return arrowMatch[0].trim().slice(0, 200);

    // Try class/interface/type
    const declMatch = content.match(new RegExp(`(?:export\\s+)?(?:class|interface|type|enum)\\s+${escaped}[^{]*`, 's'));
    if (declMatch) return declMatch[0].trim().slice(0, 200);

    // Try const/variable
    const constMatch = content.match(new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*(?::[^=]+)?=`, 's'));
    if (constMatch) return constMatch[0].trim().slice(0, 200);

    return symbol;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const symbolIndex = new SymbolIndexService();
export default symbolIndex;
