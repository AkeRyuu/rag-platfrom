/**
 * Search Routes - Universal search endpoints
 */

import { Router, Request, Response } from 'express';
import { vectorStore, SearchResult } from '../services/vector-store';
import { embeddingService } from '../services/embedding';
import { llm } from '../services/llm';
import { contextPackBuilder } from '../services/context-pack';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../utils/validation';
import {
  searchSchema,
  searchSimilarSchema,
  searchGroupedSchema,
  searchHybridSchema,
  askSchema,
  explainSchema,
  findFeatureSchema,
  contextPackSchema,
} from '../utils/validation';
import { buildSearchFilter } from '../utils/filters';
import { graphStore } from '../services/graph-store';
import config from '../config';

const router = Router();

/**
 * Deduplicate search results by file — keep only the highest-scoring chunk per file.
 */
function deduplicateByFile<T extends { payload: Record<string, unknown>; score: number }>(results: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of results) {
    const file = r.payload.file as string;
    if (!file) { seen.set(`__no_file_${seen.size}`, r); continue; }
    const existing = seen.get(file);
    if (!existing || r.score > existing.score) {
      seen.set(file, r);
    }
  }
  return Array.from(seen.values());
}

/**
 * Apply code-type boosting — give a small score boost to code chunks over docs.
 */
const CODE_BOOST = 1.05;
function applyChunkTypeBoost<T extends { payload: Record<string, unknown>; score: number }>(results: T[]): T[] {
  return results.map(r => ({
    ...r,
    score: r.payload?.chunkType === 'code' ? r.score * CODE_BOOST : r.score,
  }));
}

/**
 * Search in a collection
 * POST /api/search
 */
router.post('/search', validate(searchSchema), asyncHandler(async (req: Request, res: Response) => {
  const { collection, query, limit = 5, filters, scoreThreshold } = req.body;

  const queryEmbedding = await embeddingService.embed(query);
  const filter = buildSearchFilter(filters);
  // Over-fetch to allow dedup to still return enough results
  const rawResults = await vectorStore.search(collection, queryEmbedding, limit * 3, filter, scoreThreshold);
  const boosted = applyChunkTypeBoost(rawResults);
  boosted.sort((a, b) => b.score - a.score);
  const results = deduplicateByFile(boosted).slice(0, limit);

  res.json({
    results: results.map(r => ({
      file: r.payload.file,
      content: r.payload.content,
      language: r.payload.language,
      score: r.score,
      startLine: r.payload.startLine,
      endLine: r.payload.endLine,
    })),
  });
}));

/**
 * Search for similar code
 * POST /api/search-similar
 */
router.post('/search-similar', validate(searchSimilarSchema), asyncHandler(async (req: Request, res: Response) => {
  const { collection, code, limit = 5, scoreThreshold = 0.7 } = req.body;

  const codeEmbedding = await embeddingService.embed(code);
  const results = await vectorStore.search(collection, codeEmbedding, limit, undefined, scoreThreshold);

  res.json({
    results: results.map(r => ({
      file: r.payload.file,
      content: r.payload.content,
      language: r.payload.language,
      score: r.score,
    })),
  });
}));

/**
 * Search with grouping (one result per file/group)
 * POST /api/search-grouped
 */
router.post('/search-grouped', validate(searchGroupedSchema), asyncHandler(async (req: Request, res: Response) => {
  const { collection, query, groupBy = 'file', limit = 10, groupSize = 1, filters, scoreThreshold } = req.body;

  const queryEmbedding = await embeddingService.embed(query);
  const filter = buildSearchFilter(filters);

  const groups = await vectorStore.searchGroups(
    collection, queryEmbedding, groupBy, limit, groupSize, filter, scoreThreshold
  );

  res.json({
    groups: groups.map(g => ({
      [groupBy]: g.group,
      results: g.results.map(r => ({
        file: r.payload.file,
        content: r.payload.content,
        language: r.payload.language,
        score: r.score,
      })),
    })),
    totalGroups: groups.length,
  });
}));

/**
 * Hybrid search (keyword + semantic)
 * POST /api/search-hybrid
 */
router.post('/search-hybrid', validate(searchHybridSchema), asyncHandler(async (req: Request, res: Response) => {
  const { collection, query, limit = 10, semanticWeight = 0.7, filters } = req.body;

  const filter = buildSearchFilter(filters);

  // Native sparse hybrid search (when enabled)
  if (config.SPARSE_VECTORS_ENABLED) {
    const { dense, sparse } = await embeddingService.embedFull(query);
    const rawResults = await vectorStore.searchHybridNative(collection, dense, sparse, limit * 3, filter);
    const boosted = applyChunkTypeBoost(rawResults);
    boosted.sort((a, b) => b.score - a.score);
    const results = deduplicateByFile(boosted).slice(0, limit);

    return res.json({
      results: results.map(r => ({
        file: r.payload.file,
        content: r.payload.content,
        language: r.payload.language,
        score: r.score,
      })),
      query,
      mode: 'native-sparse',
    });
  }

  // Fallback: client-side weighted fusion (dense + text match)

  // 1. Semantic search
  const queryEmbedding = await embeddingService.embed(query);
  const semanticResults = await vectorStore.search(collection, queryEmbedding, limit * 2, filter);

  // 2. Keyword search (using Qdrant text match)
  const keywords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
  let keywordResults: typeof semanticResults = [];

  if (keywords.length > 0 && semanticWeight < 1) {
    const keywordFilter = {
      should: keywords.map((kw: string) => ({
        key: 'content',
        match: { text: kw },
      })),
      ...(filter ? { must: (filter as Record<string, unknown>).must } : {}),
    };

    keywordResults = await vectorStore.search(
      collection, queryEmbedding, limit * 2, keywordFilter
    );
  }

  // 3. Fusion: Combine and re-rank results
  const resultMap = new Map<string, { result: typeof semanticResults[0]; semanticScore: number; keywordScore: number }>();

  for (const r of semanticResults) {
    resultMap.set(r.id, { result: r, semanticScore: r.score, keywordScore: 0 });
  }

  for (const r of keywordResults) {
    const content = String(r.payload.content || '').toLowerCase();
    const matchCount = keywords.filter((kw: string) => content.includes(kw)).length;
    const keywordScore = matchCount / keywords.length;

    if (resultMap.has(r.id)) {
      resultMap.get(r.id)!.keywordScore = keywordScore;
    } else {
      resultMap.set(r.id, {
        result: r,
        semanticScore: r.score * 0.5,
        keywordScore,
      });
    }
  }

  const fusedResults = Array.from(resultMap.values())
    .map(({ result, semanticScore, keywordScore }) => ({
      ...result,
      score: semanticWeight * semanticScore + (1 - semanticWeight) * keywordScore,
      semanticScore,
      keywordScore,
    }));

  // Apply code-type boost, re-sort, dedup, trim
  const boostedFused = applyChunkTypeBoost(fusedResults).map(r => ({
    ...r,
    semanticScore: (r as any).semanticScore as number,
    keywordScore: (r as any).keywordScore as number,
  }));
  boostedFused.sort((a, b) => b.score - a.score);
  const combinedResults = deduplicateByFile(boostedFused).slice(0, limit);

  res.json({
    results: combinedResults.map(r => ({
      file: r.payload.file,
      content: r.payload.content,
      language: r.payload.language,
      score: r.score,
      semanticScore: (r as any).semanticScore,
      keywordScore: (r as any).keywordScore,
    })),
    query,
    semanticWeight,
    mode: 'text-match-fusion',
  });
}));

/**
 * Ask a question about the codebase (RAG)
 * POST /api/ask
 */
router.post('/ask', validate(askSchema), asyncHandler(async (req: Request, res: Response) => {
  const { collection, question } = req.body;

  const queryEmbedding = await embeddingService.embed(question);
  const rawResults = await vectorStore.search(collection, queryEmbedding, 24);
  const searchResults = deduplicateByFile(applyChunkTypeBoost(rawResults).sort((a, b) => b.score - a.score)).slice(0, 8);

  if (searchResults.length === 0) {
    return res.json({
      answer: 'No relevant code found to answer this question. Please make sure the codebase is indexed.',
    });
  }

  const context = searchResults
    .map(r => `File: ${r.payload.file}\n\`\`\`${r.payload.language}\n${r.payload.content}\n\`\`\``)
    .join('\n\n');

  const result = await llm.complete(
    `Based on the following code context, answer this question: ${question}\n\nContext:\n${context}`,
    {
      systemPrompt: `You are a helpful code assistant. Answer questions about the codebase based on the provided context.
Be specific and reference the relevant files when possible. If the context doesn't contain enough information to answer, say so.`,
      maxTokens: 2048,
      temperature: 0.3,
    }
  );

  res.json({ answer: result.text });
}));

/**
 * Explain code
 * POST /api/explain
 */
router.post('/explain', validate(explainSchema), asyncHandler(async (req: Request, res: Response) => {
  const { collection, code, filePath } = req.body;

  let context = '';
  if (collection) {
    const codeEmbedding = await embeddingService.embed(code);
    const related = await vectorStore.search(collection, codeEmbedding, 3);
    if (related.length > 0) {
      context = '\n\nRelated code in the project:\n' +
        related.map(r => `File: ${r.payload.file}\n\`\`\`\n${r.payload.content}\n\`\`\``).join('\n\n');
    }
  }

  const result = await llm.complete(
    `Explain the following code${filePath ? ` from ${filePath}` : ''}:\n\n\`\`\`\n${code}\n\`\`\`${context}`,
    {
      systemPrompt: `You are a code explanation expert. Provide a clear, structured explanation including:
1. A brief summary
2. The purpose of the code
3. Key components and their roles
4. Dependencies used
5. Any potential issues or improvements (if obvious)

Format your response as JSON with keys: summary, purpose, keyComponents (array), dependencies (array), potentialIssues (array, optional)`,
      maxTokens: 1500,
      temperature: 0.3,
    }
  );

  try {
    const parsed = JSON.parse(result.text);
    res.json(parsed);
  } catch {
    res.json({
      summary: result.text,
      purpose: '',
      keyComponents: [],
      dependencies: [],
    });
  }
}));

/**
 * Find feature implementation
 * POST /api/find-feature
 */
router.post('/find-feature', validate(findFeatureSchema), asyncHandler(async (req: Request, res: Response) => {
  const { collection, description } = req.body;

  const queryEmbedding = await embeddingService.embed(description);
  const results = await vectorStore.search(collection, queryEmbedding, 10);

  if (results.length === 0) {
    return res.json({
      explanation: 'No relevant code found for this feature.',
      mainFiles: [],
      relatedFiles: [],
    });
  }

  // Group by file
  const fileMap = new Map<string, { score: number; chunks: Record<string, unknown>[] }>();
  for (const r of results) {
    const file = r.payload.file as string;
    if (!fileMap.has(file)) {
      fileMap.set(file, { score: r.score, chunks: [] });
    }
    fileMap.get(file)!.chunks.push(r.payload);
  }

  const sortedFiles = Array.from(fileMap.entries())
    .sort((a, b) => b[1].score - a[1].score);

  const mainFiles = sortedFiles.slice(0, 3).map(([file, data]) => ({ file, score: data.score }));
  const relatedFiles = sortedFiles.slice(3, 6).map(([file, data]) => ({ file, score: data.score }));

  const context = sortedFiles
    .slice(0, 5)
    .map(([file, data]) => `File: ${file}\n${data.chunks.map(c => c.content).join('\n---\n')}`)
    .join('\n\n');

  const result = await llm.complete(
    `Where is "${description}" implemented in this codebase? Based on the context, explain how it works.\n\nContext:\n${context}`,
    {
      systemPrompt: 'You are a code analyst. Explain where and how the requested feature is implemented. Be specific about file locations and key functions.',
      maxTokens: 1000,
      temperature: 0.3,
    }
  );

  res.json({ explanation: result.text, mainFiles, relatedFiles });
}));

/**
 * Search with graph expansion
 * POST /api/search-graph
 */
router.post('/search-graph', asyncHandler(async (req: Request, res: Response) => {
  const { collection, query, limit = 10, expandHops = 1 } = req.body;

  if (!collection || !query) {
    return res.status(400).json({ error: 'collection and query are required' });
  }

  const projectName = collection.replace(/_codebase$|_code$/, '');

  // 1. Semantic search
  const queryEmbedding = await embeddingService.embed(query);
  const semanticResults = await vectorStore.search(collection, queryEmbedding, limit);

  // 2. Get files from results
  const seedFiles = [...new Set(semanticResults.map(r => r.payload.file as string).filter(Boolean))];

  // 3. Graph expand
  let expandedFiles: string[] = [];
  if (seedFiles.length > 0 && expandHops > 0) {
    expandedFiles = await graphStore.expand(projectName, seedFiles, expandHops);
    // Remove seed files from expanded
    expandedFiles = expandedFiles.filter(f => !seedFiles.includes(f));
  }

  // 4. Get graph-expanded results
  let graphResults: typeof semanticResults = [];
  if (expandedFiles.length > 0) {
    // Search for each expanded file
    for (const file of expandedFiles.slice(0, 10)) {
      const fileResults = await vectorStore.search(collection, queryEmbedding, 2, {
        must: [{ key: 'file', match: { value: file } }],
      });
      graphResults.push(...fileResults);
    }
  }

  res.json({
    results: semanticResults.map(r => ({
      file: r.payload.file,
      content: r.payload.content,
      language: r.payload.language,
      score: r.score,
      source: 'semantic',
    })),
    graphExpanded: graphResults.map(r => ({
      file: r.payload.file,
      content: r.payload.content,
      language: r.payload.language,
      score: r.score,
      source: 'graph',
    })),
    expandedFiles,
  });
}));

/**
 * Build a context pack with faceted retrieval and reranking
 * POST /api/context-pack
 */
router.post('/context-pack', validate(contextPackSchema), asyncHandler(async (req: Request, res: Response) => {
  const { projectName, query, maxTokens, semanticWeight, includeADRs, includeTests, graphExpand } = req.body;

  const pack = await contextPackBuilder.build({
    projectName,
    query,
    maxTokens,
    semanticWeight,
    includeADRs,
    includeTests,
    graphExpand,
  });

  res.json(pack);
}));

export default router;
