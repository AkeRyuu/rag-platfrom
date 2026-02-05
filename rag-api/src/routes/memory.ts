/**
 * Memory Routes - Agent memory API endpoints
 */

import { Router, Request, Response } from 'express';
import { memoryService, MemoryType, TodoStatus } from '../services/memory';
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

export default router;
