/**
 * Shared API Types
 */

/** Standard API response wrapper */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  code?: string;
  details?: unknown;
}

/** Search result from vector store */
export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/** Code search result (typed payload) */
export interface CodeSearchResult {
  file: string;
  content: string;
  language: string;
  score: number;
  startLine?: number;
  endLine?: number;
}

/** Grouped search result */
export interface GroupedSearchResult {
  group: string;
  results: CodeSearchResult[];
}

/** Qdrant filter condition */
export interface QdrantCondition {
  key: string;
  match: { value?: string; text?: string };
}

/** Qdrant filter */
export interface QdrantFilter {
  must?: QdrantCondition[];
  should?: QdrantCondition[];
  must_not?: QdrantCondition[];
}

/** Memory record from vector store */
export interface MemoryRecord {
  id: string;
  type: string;
  content: string;
  tags: string[];
  relatedTo?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  source?: string;
  confidence?: number;
  validated?: boolean;
  status?: string;
}

/** Index status response */
export interface IndexStatus {
  status: 'idle' | 'indexing' | 'completed' | 'error';
  progress?: number;
  filesProcessed?: number;
  totalFiles?: number;
  error?: string;
}

/** Project statistics */
export interface ProjectStats {
  vectorCount: number;
  status: string;
  languages?: Record<string, number>;
  fileCount?: number;
}

/** Vector search result from Qdrant */
export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
  version?: number;
}
