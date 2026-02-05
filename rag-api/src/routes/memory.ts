/**
 * Memory Routes - Agent memory API endpoints
 */

import { Router, Request, Response } from 'express';
import { memoryService, MemoryType, TodoStatus } from '../services/memory';
import { conversationAnalyzer } from '../services/conversation-analyzer';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Store a memory
 * POST /api/memory
 */
router.post('/memory', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { content, type, tags, relatedTo, metadata } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const memory = await memoryService.remember({
      projectName,
      content,
      type: type as MemoryType,
      tags,
      relatedTo,
      metadata,
    });

    res.json({ success: true, memory });
  } catch (error: any) {
    logger.error('Failed to store memory', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Recall memories by query
 * POST /api/memory/recall
 */
router.post('/memory/recall', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { query, type, limit, tag } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const results = await memoryService.recall({
      projectName,
      query,
      type: type as MemoryType | 'all',
      limit,
      tag,
    });

    res.json({ results });
  } catch (error: any) {
    logger.error('Failed to recall memories', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * List memories
 * GET /api/memory/list
 */
router.get('/memory/list', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const type = req.query.type as MemoryType | 'all' | undefined;
    const tag = req.query.tag as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const memories = await memoryService.list({
      projectName,
      type,
      tag,
      limit,
    });

    res.json({ memories });
  } catch (error: any) {
    logger.error('Failed to list memories', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a memory
 * DELETE /api/memory/:id
 */
router.delete('/memory/:id', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const { id } = req.params;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const success = await memoryService.forget(projectName, id);
    res.json({ success });
  } catch (error: any) {
    logger.error('Failed to delete memory', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete memories by type
 * DELETE /api/memory/type/:type
 */
router.delete('/memory/type/:type', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const { type } = req.params;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const count = await memoryService.forgetByType(projectName, type as MemoryType);
    res.json({ success: true, deleted: count });
  } catch (error: any) {
    logger.error('Failed to delete memories by type', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update todo status
 * PATCH /api/memory/todo/:id
 */
router.patch('/memory/todo/:id', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { id } = req.params;
    const { status, note } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const memory = await memoryService.updateTodoStatus(
      projectName,
      id,
      status as TodoStatus,
      note
    );

    if (!memory) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.json({ success: true, memory });
  } catch (error: any) {
    logger.error('Failed to update todo status', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get memory stats
 * GET /api/memory/stats
 */
router.get('/memory/stats', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const stats = await memoryService.getStats(projectName);
    res.json({ stats });
  } catch (error: any) {
    logger.error('Failed to get memory stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Batch & Auto-learning Routes
// ============================================

/**
 * Batch store memories
 * POST /api/memory/batch
 */
router.post('/memory/batch', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { items } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const result = await memoryService.batchRemember(projectName, items);
    res.json({
      success: result.errors.length === 0,
      savedCount: result.saved.length,
      memories: result.saved,
      errors: result.errors,
    });
  } catch (error: any) {
    logger.error('Failed to batch store memories', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Extract learnings from text/conversation
 * POST /api/memory/extract
 */
router.post('/memory/extract', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { text, context, autoSave = false, minConfidence = 0.6 } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const analysis = await conversationAnalyzer.analyze({
      projectName,
      conversation: text,
      context,
      autoSave,
      minConfidence,
    });

    res.json({
      learnings: analysis.learnings,
      entities: analysis.entities,
      summary: analysis.summary,
      savedCount: autoSave ? analysis.learnings.length : 0,
    });
  } catch (error: any) {
    logger.error('Failed to extract learnings', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Validate an auto-extracted memory
 * PATCH /api/memory/:id/validate
 */
router.patch('/memory/:id/validate', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { id } = req.params;
    const { validated } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    if (validated === undefined) {
      return res.status(400).json({ error: 'validated (true/false) is required' });
    }

    const memory = await memoryService.validateMemory(projectName, id, validated);

    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ success: true, memory });
  } catch (error: any) {
    logger.error('Failed to validate memory', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get unvalidated auto-extracted memories for review
 * GET /api/memory/unvalidated
 */
router.get('/memory/unvalidated', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const memories = await memoryService.getUnvalidatedMemories(projectName, limit);
    res.json({ memories, count: memories.length });
  } catch (error: any) {
    logger.error('Failed to get unvalidated memories', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
