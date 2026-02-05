/**
 * Indexer Service - Index codebases for any project
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { cacheService } from './cache';
import { logger } from '../utils/logger';

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
      }
      const allChunks: ChunkInfo[] = [];
      const processedFiles: string[] = [];

      for (const filePath of fileBatch) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(projectPath, filePath);
          const language = getLanguage(filePath);
          const hash = computeFileHash(content);

          // Delete existing chunks for this file (if incremental update)
          if (incremental && existingIndex[relativePath]) {
            await vectorStore.deleteByFilter(collectionName, {
              must: [{ key: 'file', match: { value: relativePath } }],
            });
          }

          // Chunk the content
          const chunks = chunkCode(content);
          const validChunks = chunks.filter(c => c.trim().length >= 10);

          for (let chunkIndex = 0; chunkIndex < validChunks.length; chunkIndex++) {
            allChunks.push({
              text: validChunks[chunkIndex],
              relativePath,
              language,
              chunkIndex,
              totalChunks: validChunks.length,
              hash,
            });
          }

          // Update hash index
          newIndex[relativePath] = {
            hash,
            indexedAt: new Date().toISOString(),
            chunkCount: validChunks.length,
          };

          processedFiles.push(relativePath);
          stats.indexedFiles++;
        } catch (error) {
          logger.warn(`Failed to read file: ${filePath}`, { error });
          stats.errors++;
        }
      }

      // Batch embed all chunks for this file batch
      if (allChunks.length > 0) {
        const points: VectorPoint[] = [];

        // Process embeddings in batches
        for (let j = 0; j < allChunks.length; j += embeddingBatchSize) {
          const chunkBatch = allChunks.slice(j, j + embeddingBatchSize);
          const texts = chunkBatch.map(c => c.text);

          try {
            // Use batch embedding for efficiency
            const embeddings = await embeddingService.embedBatch(texts);

            for (let k = 0; k < chunkBatch.length; k++) {
              const chunk = chunkBatch[k];
              points.push({
                vector: embeddings[k],
                payload: {
                  file: chunk.relativePath,
                  content: chunk.text,
                  language: chunk.language,
                  chunkIndex: chunk.chunkIndex,
                  totalChunks: chunk.totalChunks,
                  project: projectName,
                  indexedAt: new Date().toISOString(),
                  fileHash: chunk.hash,
                },
              });
              stats.totalChunks++;
            }
          } catch (error) {
            logger.error(`Batch embedding failed, falling back to sequential`, { error });
            // Fallback to sequential embedding
            for (const chunk of chunkBatch) {
              try {
                const embedding = await embeddingService.embed(chunk.text);
                points.push({
                  vector: embedding,
                  payload: {
                    file: chunk.relativePath,
                    content: chunk.text,
                    language: chunk.language,
                    chunkIndex: chunk.chunkIndex,
                    totalChunks: chunk.totalChunks,
                    project: projectName,
                    indexedAt: new Date().toISOString(),
                    fileHash: chunk.hash,
                  },
                });
                stats.totalChunks++;
              } catch (embError) {
                logger.warn(`Failed to embed chunk`, { error: embError });
                stats.errors++;
              }
            }
          }
        }

        // Upsert batch
        if (points.length > 0) {
          await vectorStore.upsert(collectionName, points);
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
