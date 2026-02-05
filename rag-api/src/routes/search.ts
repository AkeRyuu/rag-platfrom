/**
 * Search Routes - Universal search endpoints
 */

import { Router, Request, Response } from 'express';
import { vectorStore } from '../services/vector-store';
import { embeddingService } from '../services/embedding';
import { llm } from '../services/llm';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Search in a collection
 * POST /api/search
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { collection, query, limit = 5, filters, scoreThreshold } = req.body;

    if (!collection || !query) {
      return res.status(400).json({ error: 'collection and query are required' });
    }

    // Get query embedding
    const queryEmbedding = await embeddingService.embed(query);

    // Build filter
    let filter: Record<string, unknown> | undefined;
    if (filters) {
      const conditions: any[] = [];

      if (filters.language) {
        conditions.push({
          key: 'language',
          match: { value: filters.language },
        });
      }

      if (filters.path) {
        conditions.push({
          key: 'file',
          match: { text: filters.path },
        });
      }

      if (conditions.length > 0) {
        filter = { must: conditions };
      }
    }

    // Search with optional score threshold
    const results = await vectorStore.search(collection, queryEmbedding, limit, filter, scoreThreshold);

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
  } catch (error: any) {
    logger.error('Search failed', { error: error.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * Search for similar code
 * POST /api/search-similar
 */
router.post('/search-similar', async (req: Request, res: Response) => {
  try {
    const { collection, code, limit = 5, scoreThreshold = 0.7 } = req.body;

    if (!collection || !code) {
      return res.status(400).json({ error: 'collection and code are required' });
    }

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
  } catch (error: any) {
    logger.error('Similar search failed', { error: error.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * Ask a question about the codebase (RAG)
 * POST /api/ask
 */
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { collection, question } = req.body;

    if (!collection || !question) {
      return res.status(400).json({ error: 'collection and question are required' });
    }

    // Get relevant context
    const queryEmbedding = await embeddingService.embed(question);
    const searchResults = await vectorStore.search(collection, queryEmbedding, 8);

    if (searchResults.length === 0) {
      return res.json({
        answer: 'No relevant code found to answer this question. Please make sure the codebase is indexed.',
      });
    }

    // Build context
    const context = searchResults
      .map(r => `File: ${r.payload.file}\n\`\`\`${r.payload.language}\n${r.payload.content}\n\`\`\``)
      .join('\n\n');

    // Generate answer
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
  } catch (error: any) {
    logger.error('Ask failed', { error: error.message });
    res.status(500).json({ error: 'Failed to generate answer' });
  }
});

/**
 * Explain code
 * POST /api/explain
 */
router.post('/explain', async (req: Request, res: Response) => {
  try {
    const { collection, code, filePath } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }

    // Optionally get related context
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
      // If not valid JSON, return as plain text
      res.json({
        summary: result.text,
        purpose: '',
        keyComponents: [],
        dependencies: [],
      });
    }
  } catch (error: any) {
    logger.error('Explain failed', { error: error.message });
    res.status(500).json({ error: 'Failed to explain code' });
  }
});

/**
 * Find feature implementation
 * POST /api/find-feature
 */
router.post('/find-feature', async (req: Request, res: Response) => {
  try {
    const { collection, description } = req.body;

    if (!collection || !description) {
      return res.status(400).json({ error: 'collection and description are required' });
    }

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
    const fileMap = new Map<string, { score: number; chunks: any[] }>();
    for (const r of results) {
      const file = r.payload.file as string;
      if (!fileMap.has(file)) {
        fileMap.set(file, { score: r.score, chunks: [] });
      }
      fileMap.get(file)!.chunks.push(r.payload);
    }

    // Sort by score
    const sortedFiles = Array.from(fileMap.entries())
      .sort((a, b) => b[1].score - a[1].score);

    const mainFiles = sortedFiles.slice(0, 3).map(([file, data]) => ({
      file,
      score: data.score,
    }));

    const relatedFiles = sortedFiles.slice(3, 6).map(([file, data]) => ({
      file,
      score: data.score,
    }));

    // Generate explanation
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

    res.json({
      explanation: result.text,
      mainFiles,
      relatedFiles,
    });
  } catch (error: any) {
    logger.error('Find feature failed', { error: error.message });
    res.status(500).json({ error: 'Failed to find feature' });
  }
});

export default router;
