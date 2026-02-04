/**
 * Indexer Service - Index codebases for any project
 */

import * as fs from 'fs';
import * as path from 'path';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { logger } from '../utils/logger';

export interface IndexOptions {
  projectName: string;
  projectPath: string;
  patterns?: string[];
  excludePatterns?: string[];
  force?: boolean;
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
  const { projectName, projectPath, patterns = DEFAULT_PATTERNS, excludePatterns = DEFAULT_EXCLUDE, force = false } = options;

  const collectionName = getCollectionName(projectName, 'codebase');
  const startTime = Date.now();

  // Initialize progress
  indexProgress.set(projectName, {
    status: 'indexing',
    totalFiles: 0,
    processedFiles: 0,
    startedAt: new Date(),
  });

  logger.info(`Starting indexing for project: ${projectName}`, { path: projectPath });

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
      logger.info(`Cleared existing collection: ${collectionName}`);
    }

    // Find all files
    const files = walkDirectory(projectPath, patterns, excludePatterns, projectPath);
    stats.totalFiles = files.length;

    indexProgress.get(projectName)!.totalFiles = files.length;
    logger.info(`Found ${files.length} files to index`);

    // Process files in batches
    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const points: VectorPoint[] = [];

      for (const filePath of batch) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(projectPath, filePath);
          const language = getLanguage(filePath);

          // Chunk the content
          const chunks = chunkCode(content);

          for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
            if (chunk.trim().length < 10) continue;

            // Get embedding
            const embedding = await embeddingService.embed(chunk);

            points.push({
              vector: embedding,
              payload: {
                file: relativePath,
                content: chunk,
                language,
                chunkIndex,
                totalChunks: chunks.length,
                project: projectName,
                indexedAt: new Date().toISOString(),
              },
            });

            stats.totalChunks++;
          }

          stats.indexedFiles++;
        } catch (error) {
          logger.warn(`Failed to index file: ${filePath}`, { error });
          stats.errors++;
        }
      }

      // Upsert batch
      if (points.length > 0) {
        await vectorStore.upsert(collectionName, points);
      }

      // Update progress
      const progress = indexProgress.get(projectName)!;
      progress.processedFiles = Math.min(i + batchSize, files.length);

      logger.debug(`Progress: ${progress.processedFiles}/${files.length}`);
    }

    stats.duration = Date.now() - startTime;

    // Update progress to completed
    const progress = indexProgress.get(projectName)!;
    progress.status = 'completed';
    progress.completedAt = new Date();

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

  return {
    totalFiles: 0, // Would need to aggregate from payloads
    vectorCount: info.vectorsCount,
    lastIndexed: undefined, // Would need to get from metadata
    languages: {},
  };
}
