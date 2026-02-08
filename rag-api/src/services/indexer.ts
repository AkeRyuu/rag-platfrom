/**
 * Indexer Service - Index codebases for any project
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { vectorStore, VectorPoint, SparseVectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { cacheService } from './cache';
import { logger } from '../utils/logger';
import { parserRegistry, ParsedChunk } from './parsers/index';
import config from '../config';
import { indexingChunksByType } from '../utils/metrics';
import { astParser } from './parsers/ast-parser';
import { graphStore } from './graph-store';
import { buildAnchorString } from './anchor';

export interface IndexOptions {
  projectName: string;
  projectPath: string;
  patterns?: string[];
  excludePatterns?: string[];
  force?: boolean;
  incremental?: boolean; // Only index changed files
}

export interface IndexStats {
  totalFiles: number;
  indexedFiles: number;
  totalChunks: number;
  errors: number;
  duration: number;
}

interface IndexProgress {
  status: 'idle' | 'indexing' | 'completed' | 'error';
  totalFiles: number;
  processedFiles: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

// Track indexing progress per project
const indexProgress: Map<string, IndexProgress> = new Map();

// Default patterns
const DEFAULT_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.vue',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
  '**/*.java',
  '**/*.md',
  '**/*.sql',
  '**/*.yml',
  '**/*.yaml',
  '**/Dockerfile',
];

const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/.nuxt/**',
  '**/.next/**',
  '**/vendor/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/eval/results/**',
  '**/eval/golden-queries.json',
];

// File hash index for incremental indexing
interface FileHashIndex {
  [filePath: string]: {
    hash: string;
    indexedAt: string;
    chunkCount: number;
  };
}

/**
 * Compute MD5 hash of file content
 */
function computeFileHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Get file hash index from cache
 */
async function getFileHashIndex(projectName: string): Promise<FileHashIndex> {
  const key = `file_index:${projectName}`;
  const cached = await cacheService.get<FileHashIndex>(key);
  return cached || {};
}

/**
 * Save file hash index to cache
 */
async function saveFileHashIndex(projectName: string, index: FileHashIndex): Promise<void> {
  const key = `file_index:${projectName}`;
  // Store indefinitely (until force reindex)
  await cacheService.set(key, index);
}

/**
 * Get collection name for a project
 */
export function getCollectionName(projectName: string, type: 'codebase' | 'docs' = 'codebase'): string {
  return `${projectName}_${type}`;
}

/**
 * Chunk code into smaller pieces
 */
function chunkCode(content: string, maxChunkSize: number = 1000): string[] {
  const lines = content.split('\n');
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const line of lines) {
    if (currentSize + line.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
      currentSize = 0;
    }
    currentChunk.push(line);
    currentSize += line.length + 1;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }

  return chunks;
}

/**
 * Get language from file extension
 */
function getLanguage(filePath: string): string {
  const basename = path.basename(filePath);
  if (basename === 'Dockerfile' || basename.startsWith('Dockerfile.')) {
    return 'dockerfile';
  }
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.vue': 'vue',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.sql': 'sql',
    '.md': 'markdown',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
  };
  return langMap[ext] || 'unknown';
}

/**
 * Match file against patterns
 */
function matchesPattern(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    // Simple glob matching - order matters!
    // First escape dots, then replace globs
    const regex = pattern
      .replace(/\./g, '\\.')           // Escape dots first
      .replace(/\*\*/g, '@@DOUBLESTAR@@')  // Placeholder for **
      .replace(/\*/g, '[^/]*')         // Single * = any chars except /
      .replace(/@@DOUBLESTAR@@/g, '.*'); // ** = any chars including /

    if (new RegExp(regex).test(normalizedPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Walk directory and find files
 */
function walkDirectory(
  dir: string,
  patterns: string[],
  excludePatterns: string[],
  basePath: string
): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      // Check exclude patterns
      if (matchesPattern(relativePath, excludePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...walkDirectory(fullPath, patterns, excludePatterns, basePath));
      } else if (entry.isFile() && matchesPattern(relativePath, patterns)) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    logger.warn(`Failed to read directory: ${dir}`);
  }

  return files;
}

/**
 * Get the current git commit hash for the project.
 */
function getGitCommit(projectPath: string): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: projectPath, encoding: 'utf-8' }).trim();
  } catch { return null; }
}

/**
 * Detect the architectural layer from the file path.
 */
function detectLayer(filePath: string): string {
  const p = filePath.toLowerCase().replace(/\\/g, '/');
  if (/\broutes?\b|\bcontrollers?\b/.test(p)) return 'api';
  if (/\bservices?\b/.test(p)) return 'service';
  if (/\butils?\b|\bhelpers?\b|\blib\b/.test(p)) return 'util';
  if (/\bmodels?\b|\bentit/.test(p)) return 'model';
  if (/\bmiddleware\b/.test(p)) return 'middleware';
  if (/\b__tests__\b|\btest\b|\bspec\b/.test(p)) return 'test';
  if (/\bparsers?\b/.test(p)) return 'parser';
  if (/\btypes?\b|\binterfaces?\b/.test(p)) return 'types';
  if (/\bconfig\b/.test(p)) return 'config';
  return 'other';
}

/**
 * Extract a service/class name from symbols or file path.
 */
function extractServiceName(symbols: string[] | undefined): string | null {
  if (symbols?.length) {
    const svc = symbols.find(s => /Service|Store|Parser|Builder|Handler|Controller|Manager/i.test(s));
    if (svc) return svc;
    const cls = symbols.find(s => /^[A-Z][a-zA-Z]+$/.test(s));
    if (cls) return cls;
  }
  return null;
}

/**
 * Index a project's codebase
 */
export async function indexProject(options: IndexOptions): Promise<IndexStats> {
  const {
    projectName,
    projectPath,
    patterns = DEFAULT_PATTERNS,
    excludePatterns = DEFAULT_EXCLUDE,
    force = false,
    incremental = true, // Enable incremental by default
  } = options;

  const collectionName = getCollectionName(projectName, 'codebase');
  const startTime = Date.now();

  // Initialize progress
  indexProgress.set(projectName, {
    status: 'indexing',
    totalFiles: 0,
    processedFiles: 0,
    startedAt: new Date(),
  });

  logger.info(`Starting indexing for project: ${projectName}`, {
    path: projectPath,
    incremental: incremental && !force,
  });

  const stats: IndexStats = {
    totalFiles: 0,
    indexedFiles: 0,
    totalChunks: 0,
    errors: 0,
    duration: 0,
  };

  try {
    // Clear existing collection if force
    if (force) {
      await vectorStore.clearCollection(collectionName);
      await saveFileHashIndex(projectName, {}); // Clear hash index
      logger.info(`Cleared existing collection: ${collectionName}`);
    }

    // Find all files
    const allFiles = walkDirectory(projectPath, patterns, excludePatterns, projectPath);
    stats.totalFiles = allFiles.length;

    // Get existing file hash index for incremental indexing
    const existingIndex = incremental && !force ? await getFileHashIndex(projectName) : {};
    const newIndex: FileHashIndex = {};

    // Determine which files need indexing
    const filesToIndex: string[] = [];
    const filesToRemove: string[] = [];

    for (const filePath of allFiles) {
      const relativePath = path.relative(projectPath, filePath);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const hash = computeFileHash(content);

        // Check if file changed
        const existing = existingIndex[relativePath];
        if (!existing || existing.hash !== hash) {
          filesToIndex.push(filePath);
        }

        // Track in new index (will be updated after indexing)
        newIndex[relativePath] = existing || { hash, indexedAt: '', chunkCount: 0 };
      } catch (error) {
        logger.warn(`Failed to read file: ${filePath}`, { error });
        stats.errors++;
      }
    }

    // Find removed files
    for (const existingPath of Object.keys(existingIndex)) {
      if (!newIndex[existingPath]) {
        filesToRemove.push(existingPath);
      }
    }

    // Remove vectors for deleted files
    if (filesToRemove.length > 0) {
      logger.info(`Removing ${filesToRemove.length} deleted files from index`);
      for (const removedFile of filesToRemove) {
        await vectorStore.deleteByFilter(collectionName, {
          must: [{ key: 'file', match: { value: removedFile } }],
        });
      }
    }

    indexProgress.get(projectName)!.totalFiles = filesToIndex.length;
    logger.info(`Found ${filesToIndex.length} files to index (${allFiles.length - filesToIndex.length} unchanged)`);

    // Process files in batches with batch embedding
    const fileBatchSize = 20; // Files per batch
    const embeddingBatchSize = 100; // Chunks per embedding batch

    for (let i = 0; i < filesToIndex.length; i += fileBatchSize) {
      const fileBatch = filesToIndex.slice(i, i + fileBatchSize);

      // Collect all chunks and metadata first
      interface ChunkInfo {
        text: string;
        relativePath: string;
        language: string;
        chunkIndex: number;
        totalChunks: number;
        hash: string;
        startLine?: number;
        endLine?: number;
        symbols?: string[];
        imports?: string[];
        chunkType?: string;
        layer?: string;
        service?: string | null;
        gitCommit?: string | null;
      }
      const allChunks: ChunkInfo[] = [];
      const processedFiles: string[] = [];
      const gitCommit = getGitCommit(projectPath);
      for (const filePath of fileBatch) {
        const relativePath = path.relative(projectPath, filePath);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const language = getLanguage(filePath);
          const hash = computeFileHash(content);

          // Delete existing chunks for this file (if incremental update)
          if (incremental && existingIndex[relativePath]) {
            await vectorStore.deleteByFilter(collectionName, {
              must: [{ key: 'file', match: { value: relativePath } }],
            });
          }

          // Use parser registry for structured chunking
          const parser = parserRegistry.getParser(filePath);
          let parsedChunks: ParsedChunk[];

          if (parser) {
            parsedChunks = parser.parse(content, filePath);
          } else {
            // Fallback to existing chunkCode for unknown files
            const rawChunks = chunkCode(content);
            parsedChunks = rawChunks.filter(c => c.trim().length >= 10).map((c, idx) => ({
              content: c,
              startLine: 0,
              endLine: 0,
              language,
              type: 'code' as const,
            }));
          }

          const validChunks = parsedChunks.filter(c => c.content.trim().length >= 10);
          const fileType = parserRegistry.classifyFile(filePath);

          for (let chunkIndex = 0; chunkIndex < validChunks.length; chunkIndex++) {
            const pc = validChunks[chunkIndex];
            allChunks.push({
              text: pc.content,
              relativePath,
              language: pc.language || language,
              chunkIndex,
              totalChunks: validChunks.length,
              hash,
              startLine: pc.startLine,
              endLine: pc.endLine,
              symbols: pc.symbols,
              imports: pc.imports,
              chunkType: fileType,
              layer: detectLayer(relativePath),
              service: extractServiceName(pc.symbols),
              gitCommit,
            });

            indexingChunksByType.inc({ project: projectName, chunk_type: fileType });
          }

          // Update hash index
          newIndex[relativePath] = {
            hash,
            indexedAt: new Date().toISOString(),
            chunkCount: validChunks.length,
          };

          processedFiles.push(relativePath);

          // Extract and index graph edges
          try {
            const edges = astParser.extractEdges(content, relativePath);
            if (edges.length > 0) {
              await graphStore.indexFileEdges(projectName, relativePath, edges);
            }
          } catch (edgeError: any) {
            logger.debug(`Edge extraction failed for ${relativePath}`, { error: edgeError.message });
          }

          stats.indexedFiles++;
        } catch (error) {
          logger.warn(`Failed to read file: ${filePath}`, { error });
          stats.errors++;
        }
      }

      // Batch embed all chunks for this file batch
      // Skip oversized chunks (e.g. minified files, lock files)
      const MAX_CHUNK_CHARS = 40000; // ~10K tokens, safety margin for BGE-M3
      const filteredChunks = allChunks.filter(c => {
        if (c.text.length > MAX_CHUNK_CHARS) {
          logger.warn(`Skipping oversized chunk: ${c.relativePath} (${c.text.length} chars)`);
          return false;
        }
        return true;
      });

      if (filteredChunks.length > 0) {
        const points: VectorPoint[] = [];
        const sparsePoints: SparseVectorPoint[] = [];

        // Build anchor-prefixed texts for embedding
        const buildAnchoredTexts = (batch: typeof filteredChunks) =>
          batch.map(c => {
            const anchor = buildAnchorString({
              filePath: c.relativePath,
              language: c.language,
              chunkType: c.chunkType || 'code',
              symbols: c.symbols,
              imports: c.imports,
              layer: c.layer,
              service: c.service || undefined,
              startLine: c.startLine,
              endLine: c.endLine,
            });
            return anchor + '\n' + c.text;
          });

        const buildPayload = (chunk: typeof allChunks[0]) => ({
          file: chunk.relativePath,
          content: chunk.text,
          language: chunk.language,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          project: projectName,
          indexedAt: new Date().toISOString(),
          fileHash: chunk.hash,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          symbols: chunk.symbols,
          imports: chunk.imports,
          chunkType: chunk.chunkType,
          layer: chunk.layer,
          service: chunk.service,
          gitCommit: chunk.gitCommit,
        });

        // Process embeddings in batches
        for (let j = 0; j < filteredChunks.length; j += embeddingBatchSize) {
          const chunkBatch = filteredChunks.slice(j, j + embeddingBatchSize);
          const textsForEmbedding = buildAnchoredTexts(chunkBatch);

          try {
            if (config.SPARSE_VECTORS_ENABLED) {
              const fullEmbeddings = await embeddingService.embedBatchFull(textsForEmbedding);
              for (let k = 0; k < chunkBatch.length; k++) {
                const chunk = chunkBatch[k];
                sparsePoints.push({
                  vectors: {
                    dense: fullEmbeddings[k].dense,
                    sparse: fullEmbeddings[k].sparse,
                  },
                  payload: buildPayload(chunk),
                });
                // Also build a dense-only point for legacy/typed collections
                points.push({
                  vector: fullEmbeddings[k].dense,
                  payload: buildPayload(chunk),
                });
                stats.totalChunks++;
              }
            } else {
              const embeddings = await embeddingService.embedBatch(textsForEmbedding);
              for (let k = 0; k < chunkBatch.length; k++) {
                const chunk = chunkBatch[k];
                points.push({
                  vector: embeddings[k],
                  payload: buildPayload(chunk),
                });
                stats.totalChunks++;
              }
            }
          } catch (error) {
            logger.error(`Batch embedding failed, falling back to sequential`, { error });
            for (const chunk of chunkBatch) {
              try {
                const anchor = buildAnchorString({
                  filePath: chunk.relativePath,
                  language: chunk.language,
                  chunkType: chunk.chunkType || 'code',
                  symbols: chunk.symbols,
                  imports: chunk.imports,
                  layer: chunk.layer,
                  service: chunk.service || undefined,
                });
                const anchoredText = anchor + '\n' + chunk.text;

                if (config.SPARSE_VECTORS_ENABLED) {
                  const full = await embeddingService.embedFull(anchoredText);
                  sparsePoints.push({
                    vectors: { dense: full.dense, sparse: full.sparse },
                    payload: buildPayload(chunk),
                  });
                  points.push({ vector: full.dense, payload: buildPayload(chunk) });
                } else {
                  const embedding = await embeddingService.embed(anchoredText);
                  points.push({ vector: embedding, payload: buildPayload(chunk) });
                }
                stats.totalChunks++;
              } catch (embError) {
                logger.warn(`Failed to embed chunk`, { error: embError });
                stats.errors++;
              }
            }
          }
        }

        // Upsert batch
        if (config.SPARSE_VECTORS_ENABLED && sparsePoints.length > 0) {
          // Sparse-enabled collection uses named vectors
          if (config.LEGACY_CODEBASE_COLLECTION) {
            await vectorStore.upsertSparse(collectionName, sparsePoints);
          }
        } else if (points.length > 0) {
          // Dense-only path (legacy)
          if (config.LEGACY_CODEBASE_COLLECTION) {
            await vectorStore.upsert(collectionName, points);
          }
        }

        // Route to typed collections (always dense-only for typed collections)
        if (config.SEPARATE_COLLECTIONS && points.length > 0) {
          const typeMap: Record<string, VectorPoint[]> = {};
          for (const point of points) {
            const ct = (point.payload as Record<string, unknown>).chunkType as string;
            if (ct && ct !== 'unknown') {
              if (!typeMap[ct]) typeMap[ct] = [];
              typeMap[ct].push(point);
            }
          }
          for (const [type, pts] of Object.entries(typeMap)) {
            const typedCollection = `${projectName}_${type}`;
            await vectorStore.upsert(typedCollection, pts);
          }
        }
      }

      // Update progress
      const progress = indexProgress.get(projectName)!;
      progress.processedFiles = Math.min(i + fileBatchSize, filesToIndex.length);

      logger.debug(`Progress: ${progress.processedFiles}/${filesToIndex.length} files, ${stats.totalChunks} chunks`);
    }

    // Save updated hash index
    await saveFileHashIndex(projectName, newIndex);

    stats.duration = Date.now() - startTime;

    // Update progress to completed
    const progress = indexProgress.get(projectName)!;
    progress.status = 'completed';
    progress.completedAt = new Date();

    // Invalidate search cache for this collection
    await cacheService.invalidateCollection(collectionName);

    logger.info(`Indexing completed for ${projectName}`, { ...stats });
    return stats;
  } catch (error: any) {
    const progress = indexProgress.get(projectName)!;
    progress.status = 'error';
    progress.error = error.message;

    logger.error(`Indexing failed for ${projectName}`, { error: error.message });
    throw error;
  }
}

/**
 * Get indexing status for a project
 */
export function getIndexStatus(projectName: string): IndexProgress {
  return indexProgress.get(projectName) || {
    status: 'idle',
    totalFiles: 0,
    processedFiles: 0,
  };
}

/**
 * Get project stats from Qdrant
 */
export async function getProjectStats(projectName: string): Promise<{
  totalFiles: number;
  vectorCount: number;
  lastIndexed?: string;
  languages: Record<string, number>;
}> {
  const collectionName = getCollectionName(projectName, 'codebase');
  const info = await vectorStore.getCollectionInfo(collectionName);

  // Aggregate real stats from collection payloads
  const aggregated = await vectorStore.aggregateStats(collectionName);

  return {
    totalFiles: aggregated.totalFiles,
    vectorCount: info.vectorsCount,
    lastIndexed: aggregated.lastIndexed,
    languages: aggregated.languages,
  };
}

// ============================================
// Zero-Downtime Reindexing
// ============================================

export interface ReindexOptions extends IndexOptions {
  aliasName?: string; // If not provided, uses projectName_codebase
}

export interface ReindexResult extends IndexStats {
  previousCollection?: string;
  newCollection: string;
  aliasSwapped: boolean;
}

/**
 * Reindex a project with zero downtime using aliases
 *
 * Process:
 * 1. Create new collection with timestamp suffix
 * 2. Index all files to new collection
 * 3. Atomically swap alias to new collection
 * 4. Delete old collection
 */
export async function reindexWithZeroDowntime(options: ReindexOptions): Promise<ReindexResult> {
  const {
    projectName,
    projectPath,
    patterns = DEFAULT_PATTERNS,
    excludePatterns = DEFAULT_EXCLUDE,
    aliasName,
  } = options;

  const baseCollectionName = getCollectionName(projectName, 'codebase');
  const alias = aliasName || baseCollectionName;
  const timestamp = Date.now();
  const newCollectionName = `${baseCollectionName}_${timestamp}`;

  const startTime = Date.now();

  logger.info(`Starting zero-downtime reindex for ${projectName}`, {
    alias,
    newCollection: newCollectionName,
  });

  // Initialize progress
  indexProgress.set(projectName, {
    status: 'indexing',
    totalFiles: 0,
    processedFiles: 0,
    startedAt: new Date(),
  });

  const stats: ReindexResult = {
    totalFiles: 0,
    indexedFiles: 0,
    totalChunks: 0,
    errors: 0,
    duration: 0,
    newCollection: newCollectionName,
    aliasSwapped: false,
  };

  try {
    // Find current collection pointed by alias
    const aliases = await vectorStore.listAliases();
    const currentAlias = aliases.find(a => a.alias === alias);
    stats.previousCollection = currentAlias?.collection;

    // Find all files
    const allFiles = walkDirectory(projectPath, patterns, excludePatterns, projectPath);
    stats.totalFiles = allFiles.length;

    indexProgress.get(projectName)!.totalFiles = allFiles.length;
    logger.info(`Found ${allFiles.length} files to index`);

    // Process files in batches with batch embedding
    const fileBatchSize = 20;
    const embeddingBatchSize = 100;
    const gitCommit = getGitCommit(projectPath);

    for (let i = 0; i < allFiles.length; i += fileBatchSize) {
      const fileBatch = allFiles.slice(i, i + fileBatchSize);

      interface ChunkInfo {
        text: string;
        relativePath: string;
        language: string;
        chunkIndex: number;
        totalChunks: number;
        startLine: number;
        endLine: number;
        symbols?: string[];
        imports?: string[];
        chunkType?: string;
        layer?: string;
        service?: string | null;
        gitCommit?: string | null;
      }
      const allChunks: ChunkInfo[] = [];

      for (const filePath of fileBatch) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(projectPath, filePath);
          const language = getLanguage(filePath);

          // Use parser registry for structured chunking
          const parser = parserRegistry.getParser(filePath);
          let parsedChunks: ParsedChunk[];

          if (parser) {
            parsedChunks = parser.parse(content, filePath);
          } else {
            // Fallback to existing chunkCode for unknown files
            const rawChunks = chunkCode(content);
            let lineOffset = 0;
            parsedChunks = rawChunks.filter(c => c.trim().length >= 10).map((c) => {
              const lineCount = c.split('\n').length;
              const chunk: ParsedChunk = {
                content: c,
                startLine: lineOffset + 1,
                endLine: lineOffset + lineCount,
                language,
                type: 'code' as const,
              };
              lineOffset += lineCount;
              return chunk;
            });
          }

          const validChunks = parsedChunks.filter(c => c.content.trim().length >= 10);
          const fileType = parserRegistry.classifyFile(filePath);

          for (let chunkIndex = 0; chunkIndex < validChunks.length; chunkIndex++) {
            const pc = validChunks[chunkIndex];
            allChunks.push({
              text: pc.content,
              relativePath,
              language: pc.language || language,
              chunkIndex,
              totalChunks: validChunks.length,
              startLine: pc.startLine,
              endLine: pc.endLine,
              symbols: pc.symbols,
              imports: pc.imports,
              chunkType: fileType,
              layer: detectLayer(relativePath),
              service: extractServiceName(pc.symbols),
              gitCommit,
            });

            indexingChunksByType.inc({ project: projectName, chunk_type: fileType });
          }

          // Extract and index graph edges
          try {
            const edges = astParser.extractEdges(content, relativePath);
            if (edges.length > 0) {
              await graphStore.indexFileEdges(projectName, relativePath, edges);
            }
          } catch (edgeError: any) {
            logger.debug(`Edge extraction failed for ${relativePath}`, { error: edgeError.message });
          }

          stats.indexedFiles++;
        } catch (error) {
          logger.warn(`Failed to read file: ${filePath}`, { error });
          stats.errors++;
        }
      }

      // Batch embed all chunks
      if (allChunks.length > 0) {
        const points: VectorPoint[] = [];
        const sparsePoints: SparseVectorPoint[] = [];

        const buildAnchoredTexts = (batch: typeof allChunks) =>
          batch.map(c => {
            const anchor = buildAnchorString({
              filePath: c.relativePath,
              language: c.language,
              chunkType: c.chunkType || 'code',
              symbols: c.symbols,
              imports: c.imports,
              layer: c.layer,
              service: c.service || undefined,
              startLine: c.startLine,
              endLine: c.endLine,
            });
            return anchor + '\n' + c.text;
          });

        const buildPayload = (chunk: typeof allChunks[0]) => ({
          file: chunk.relativePath,
          content: chunk.text,
          language: chunk.language,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          project: projectName,
          indexedAt: new Date().toISOString(),
          symbols: chunk.symbols,
          imports: chunk.imports,
          chunkType: chunk.chunkType,
          layer: chunk.layer,
          service: chunk.service,
          gitCommit: chunk.gitCommit,
        });

        for (let j = 0; j < allChunks.length; j += embeddingBatchSize) {
          const chunkBatch = allChunks.slice(j, j + embeddingBatchSize);
          const textsForEmbedding = buildAnchoredTexts(chunkBatch);

          try {
            if (config.SPARSE_VECTORS_ENABLED) {
              const fullEmbeddings = await embeddingService.embedBatchFull(textsForEmbedding);
              for (let k = 0; k < chunkBatch.length; k++) {
                const chunk = chunkBatch[k];
                sparsePoints.push({
                  vectors: { dense: fullEmbeddings[k].dense, sparse: fullEmbeddings[k].sparse },
                  payload: buildPayload(chunk),
                });
                points.push({ vector: fullEmbeddings[k].dense, payload: buildPayload(chunk) });
                stats.totalChunks++;
              }
            } else {
              const embeddings = await embeddingService.embedBatch(textsForEmbedding);
              for (let k = 0; k < chunkBatch.length; k++) {
                const chunk = chunkBatch[k];
                points.push({ vector: embeddings[k], payload: buildPayload(chunk) });
                stats.totalChunks++;
              }
            }
          } catch (error) {
            logger.error(`Batch embedding failed`, { error });
            stats.errors++;
          }
        }

        // Upsert to NEW collection
        if (config.SPARSE_VECTORS_ENABLED && sparsePoints.length > 0) {
          await vectorStore.upsertSparse(newCollectionName, sparsePoints);
        } else if (points.length > 0) {
          await vectorStore.upsert(newCollectionName, points);
        }

        // Route to typed collections (dense-only)
        if (config.SEPARATE_COLLECTIONS && points.length > 0) {
          const typeMap: Record<string, VectorPoint[]> = {};
          for (const point of points) {
            const ct = (point.payload as Record<string, unknown>).chunkType as string;
            if (ct && ct !== 'unknown') {
              if (!typeMap[ct]) typeMap[ct] = [];
              typeMap[ct].push(point);
            }
          }
          for (const [type, pts] of Object.entries(typeMap)) {
            const typedCollection = `${projectName}_${type}`;
            await vectorStore.upsert(typedCollection, pts);
          }
        }
      }

      // Update progress
      const progress = indexProgress.get(projectName)!;
      progress.processedFiles = Math.min(i + fileBatchSize, allFiles.length);
    }

    // Atomic alias swap
    if (stats.indexedFiles > 0) {
      if (currentAlias) {
        // Update existing alias to point to new collection
        await vectorStore.updateAlias(alias, newCollectionName);
      } else {
        // Create new alias
        await vectorStore.createAlias(alias, newCollectionName);
      }
      stats.aliasSwapped = true;

      logger.info(`Alias ${alias} now points to ${newCollectionName}`);

      // Delete old collection (if exists)
      if (stats.previousCollection && stats.previousCollection !== newCollectionName) {
        try {
          await vectorStore.deleteCollection(stats.previousCollection);
          logger.info(`Deleted old collection: ${stats.previousCollection}`);
        } catch (error) {
          logger.warn(`Failed to delete old collection: ${stats.previousCollection}`, { error });
        }
      }
    }

    stats.duration = Date.now() - startTime;

    // Update progress
    const progress = indexProgress.get(projectName)!;
    progress.status = 'completed';
    progress.completedAt = new Date();

    // Invalidate cache
    await cacheService.invalidateCollection(alias);

    logger.info(`Zero-downtime reindex completed for ${projectName}`, { ...stats });
    return stats;
  } catch (error: any) {
    const progress = indexProgress.get(projectName)!;
    progress.status = 'error';
    progress.error = error.message;

    // Cleanup: delete new collection if alias wasn't swapped
    if (!stats.aliasSwapped) {
      try {
        await vectorStore.deleteCollection(newCollectionName);
      } catch {
        // Ignore cleanup errors
      }
    }

    logger.error(`Zero-downtime reindex failed for ${projectName}`, { error: error.message });
    throw error;
  }
}

/**
 * Get alias info for a project
 */
export async function getAliasInfo(projectName: string): Promise<{
  alias: string;
  collection?: string;
  exists: boolean;
}> {
  const alias = getCollectionName(projectName, 'codebase');
  const aliases = await vectorStore.listAliases();
  const found = aliases.find(a => a.alias === alias);

  return {
    alias,
    collection: found?.collection,
    exists: !!found,
  };
}
