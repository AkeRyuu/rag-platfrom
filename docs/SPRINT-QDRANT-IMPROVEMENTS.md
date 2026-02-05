# Sprint Plan: Qdrant Vector Search Enhancements

## Executive Summary

Comprehensive improvements to Qdrant vector search capabilities including performance optimization, advanced search features, and new MCP tools.

---

## Current State

### Collections (per project)
| Collection | Purpose | Payload Fields |
|------------|---------|---------------|
| `{project}_codebase` | Source code chunks | file, content, language, chunkIndex, project, indexedAt, fileHash |
| `{project}_confluence` | Confluence pages | pageId, title, spaceKey, content, url, chunkIndex |
| `{project}_agent_memory` | Agent memory | type, content, tags, relatedTo, createdAt, status |

### Identified Gaps
1. **No payload indexes** - filters scan entire collection
2. **No batch embedding optimization** - embeddings computed sequentially
3. **No hybrid search** - pure vector search only
4. **No quantization** - using full precision vectors
5. **No grouping** - can't aggregate results by file/page
6. **No collection aliases** - no zero-downtime reindexing

---

## Sprint 1: Foundation (P0 - Must Have)

**Theme:** Performance & Reliability

| Task ID | Title | Complexity | Description |
|---------|-------|------------|-------------|
| T-P0-1 | Add payload indexes | S | Create indexes for `language`, `file`, `type`, `spaceKey` on collection creation |
| T-P0-2 | Implement batch embedding | M | Batch embed chunks (max 100) using `embedBatch` |
| T-P0-3 | Add score threshold | S | Filter low-relevance results in search |
| T-P0-4 | Fix aggregateStats | M | Replace scroll-based aggregation with faceted counts |
| T-P0-5 | Add collection info endpoint | S | Get detailed collection info (indexed fields, vector count) |

**Goal:** 50% faster filtered search, 40% faster indexing

---

## Sprint 2: Advanced Search (P1 - Should Have)

**Theme:** Enhanced Search Capabilities

| Task ID | Title | Complexity | Description |
|---------|-------|------------|-------------|
| T-P1-1 | Search with grouping | M | Use Qdrant's `search/groups` endpoint |
| T-P1-2 | `grouped_search` MCP tool | S | Group results by file/page |
| T-P1-3 | Hybrid search (BM25 + vector) | L | Combine sparse and dense vectors |
| T-P1-4 | `hybrid_search` MCP tool | S | Keyword + semantic search |

**Goal:** Better search relevance through grouping and hybrid search

---

## Sprint 3: Operations & Scalability (P1)

**Theme:** Zero-Downtime & Clustering

| Task ID | Title | Complexity | Description |
|---------|-------|------------|-------------|
| T-P1-5 | Collection aliases | M | `createAlias`, `updateAlias`, `deleteAlias` |
| T-P1-6 | Zero-downtime reindex | L | Index to new collection, atomic alias swap |
| T-P1-7 | Parallel file processing | M | Worker pool for concurrent indexing |
| T-P1-8 | Semantic clustering | L | Cluster similar code using recommend API |
| T-P1-9 | `cluster_code` MCP tool | M | Find code patterns and duplicates |

**Goal:** Production-grade operations, 3x faster indexing

---

## Sprint 4: Analytics & Deduplication (P2 - Nice to Have)

**Theme:** Insights & Code Quality

| Task ID | Title | Complexity | Description |
|---------|-------|------------|-------------|
| T-P2-1 | Duplicate detection | M | High-threshold similarity search |
| T-P2-2 | `find_duplicates` MCP tool | S | Identify code copies |
| T-P2-3 | Scalar quantization | M | Reduce memory 4x |
| T-P2-4 | Snapshot/backup | M | `createSnapshot`, `restoreSnapshot` |
| T-P2-5 | `backup_collection` MCP tool | S | Backup collections |
| T-P2-6 | Collection analytics | M | Detailed stats using Qdrant telemetry |
| T-P2-7 | `get_analytics` MCP tool | S | Language breakdown, coverage |
| T-P2-8 | Recommendation API | M | "More like this" searches |
| T-P2-9 | `find_related` MCP tool | S | Find code related to vector ID |

**Goal:** Actionable insights and code quality improvements

---

## New MCP Tools Summary

| Tool | Sprint | Description |
|------|--------|-------------|
| `grouped_search` | 2 | Search with results grouped by file |
| `hybrid_search` | 2 | Keyword + semantic search |
| `cluster_code` | 3 | Find code patterns and clusters |
| `find_duplicates` | 4 | Identify duplicate code |
| `backup_collection` | 4 | Backup/restore collections |
| `get_analytics` | 4 | Collection statistics and insights |
| `find_related` | 4 | "More like this" code search |

---

## Implementation Details

### T-P0-1: Payload Indexes

```typescript
// vector-store.ts - after collection creation
const indexFields = [
  { fieldName: 'language', type: 'keyword' },
  { fieldName: 'file', type: 'keyword' },
  { fieldName: 'type', type: 'keyword' },
  { fieldName: 'spaceKey', type: 'keyword' },
  { fieldName: 'project', type: 'keyword' },
];

for (const field of indexFields) {
  await this.client.createPayloadIndex(name, {
    field_name: field.fieldName,
    field_schema: field.type,
    wait: true,
  });
}
```

### T-P1-1: Grouped Search

```typescript
// vector-store.ts
async searchGroups(
  collection: string,
  vector: number[],
  groupBy: string,
  limit: number = 5,
  groupSize: number = 1,
  filter?: Record<string, unknown>
): Promise<GroupedSearchResult[]> {
  const results = await this.client.searchPointGroups(collection, {
    vector,
    group_by: groupBy,
    limit,
    group_size: groupSize,
    with_payload: true,
    filter: filter as any,
  });
  return results;
}
```

### T-P1-3: Hybrid Search Collection Config

```typescript
await this.client.createCollection(name, {
  vectors: {
    dense: { size: config.VECTOR_SIZE, distance: 'Cosine' },
  },
  sparse_vectors: {
    text: { modifier: 'idf' }, // BM25-style weighting
  },
});
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Filtered search latency (100k vectors) | ~500ms | <100ms |
| Full codebase indexing time | ~10 min | ~3 min |
| Memory usage per 100k vectors | ~400MB | ~100MB |

---

## Files to Modify

| File | Changes |
|------|---------|
| `rag-api/src/services/vector-store.ts` | Payload indexing, grouping, hybrid search |
| `rag-api/src/services/indexer.ts` | Batch embedding, parallel processing |
| `rag-api/src/services/embedding.ts` | Batch interface (already has `embedBatch`) |
| `rag-api/src/routes/search.ts` | Grouped search, hybrid search endpoints |
| `mcp-server/src/index.ts` | New MCP tool definitions |

---

## Dependencies Graph

```
T-P0-1 (indexes) ─┬─> T-P0-4 (stats)
                  ├─> T-P1-1 (grouping) ──> T-P1-2 (tool)
                  ├─> T-P2-1 (duplicates) ──> T-P2-2 (tool)
                  └─> T-P2-6 (analytics) ──> T-P2-7 (tool)

T-P0-2 (batch) ──> T-P1-7 (parallel)

T-P1-3 (hybrid) ──> T-P1-4 (tool)

T-P1-5 (aliases) ──> T-P1-6 (reindex)

T-P1-8 (clustering) ──> T-P1-9 (tool)

T-P2-4 (backup) ──> T-P2-5 (tool)

T-P2-8 (recommend) ──> T-P2-9 (tool)
```
