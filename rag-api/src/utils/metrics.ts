/**
 * Prometheus Metrics - Application monitoring
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create custom registry
export const registry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry });

// ============================================
// HTTP Metrics
// ============================================

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status', 'project'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'project'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ============================================
// Embedding Metrics
// ============================================

export const embeddingRequestsTotal = new Counter({
  name: 'embedding_requests_total',
  help: 'Total number of embedding requests',
  labelNames: ['provider', 'status'],
  registers: [registry],
});

export const embeddingDuration = new Histogram({
  name: 'embedding_duration_seconds',
  help: 'Duration of embedding generation in seconds',
  labelNames: ['provider'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

export const embeddingCacheHits = new Counter({
  name: 'embedding_cache_hits_total',
  help: 'Total number of embedding cache hits',
  registers: [registry],
});

export const embeddingCacheMisses = new Counter({
  name: 'embedding_cache_misses_total',
  help: 'Total number of embedding cache misses',
  registers: [registry],
});

// ============================================
// Vector Search Metrics
// ============================================

export const searchRequestsTotal = new Counter({
  name: 'search_requests_total',
  help: 'Total number of vector search requests',
  labelNames: ['collection', 'status'],
  registers: [registry],
});

export const searchDuration = new Histogram({
  name: 'search_duration_seconds',
  help: 'Duration of vector searches in seconds',
  labelNames: ['collection'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

export const searchResultsCount = new Histogram({
  name: 'search_results_count',
  help: 'Number of results returned per search',
  labelNames: ['collection'],
  buckets: [0, 1, 5, 10, 20, 50],
  registers: [registry],
});

// ============================================
// LLM Metrics
// ============================================

export const llmRequestsTotal = new Counter({
  name: 'llm_requests_total',
  help: 'Total number of LLM requests',
  labelNames: ['provider', 'model', 'status'],
  registers: [registry],
});

export const llmDuration = new Histogram({
  name: 'llm_duration_seconds',
  help: 'Duration of LLM completions in seconds',
  labelNames: ['provider', 'model'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [registry],
});

export const llmTokensUsed = new Counter({
  name: 'llm_tokens_total',
  help: 'Total tokens used in LLM requests',
  labelNames: ['provider', 'model', 'type'],
  registers: [registry],
});

// ============================================
// Indexing Metrics
// ============================================

export const indexingProgress = new Gauge({
  name: 'indexing_progress',
  help: 'Current indexing progress (0-1)',
  labelNames: ['project'],
  registers: [registry],
});

export const indexingFilesTotal = new Counter({
  name: 'indexing_files_total',
  help: 'Total files indexed',
  labelNames: ['project', 'status'],
  registers: [registry],
});

export const indexingDuration = new Histogram({
  name: 'indexing_duration_seconds',
  help: 'Duration of indexing operations in seconds',
  labelNames: ['project'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

// ============================================
// Circuit Breaker Metrics
// ============================================

export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['name'],
  registers: [registry],
});

export const circuitBreakerTrips = new Counter({
  name: 'circuit_breaker_trips_total',
  help: 'Total number of circuit breaker trips',
  labelNames: ['name'],
  registers: [registry],
});

// ============================================
// Memory Metrics
// ============================================

export const memoryOperationsTotal = new Counter({
  name: 'memory_operations_total',
  help: 'Total memory operations',
  labelNames: ['operation', 'type', 'project'],
  registers: [registry],
});

// ============================================
// Helper Functions
// ============================================

/**
 * Record HTTP request metrics
 */
export function recordHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
  project?: string
) {
  const normalizedPath = normalizePath(path);
  httpRequestsTotal.inc({ method, path: normalizedPath, status, project: project || 'unknown' });
  httpRequestDuration.observe({ method, path: normalizedPath, project: project || 'unknown' }, durationMs / 1000);
}

/**
 * Normalize path for metrics (remove IDs)
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

/**
 * Get metrics endpoint handler
 */
export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

/**
 * Get content type for metrics
 */
export function getMetricsContentType(): string {
  return registry.contentType;
}
