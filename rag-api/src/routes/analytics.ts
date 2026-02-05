/**
 * Analytics Routes - Conversation analysis and tool usage tracking
 */

import { Router, Request, Response } from 'express';
import { conversationAnalyzer } from '../services/conversation-analyzer';
import { usageTracker } from '../services/usage-tracker';
import { logger } from '../utils/logger';

const router = Router();

// ============================================
// Conversation Analysis
// ============================================

/**
 * Analyze a conversation and extract learnings
 * POST /api/analyze-conversation
 */
router.post('/analyze-conversation', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { conversation, context, autoSave = false, minConfidence = 0.6 } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    if (!conversation) {
      return res.status(400).json({ error: 'conversation is required' });
    }

    const analysis = await conversationAnalyzer.analyze({
      projectName,
      conversation,
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
    logger.error('Conversation analysis failed', { error: error.message });
    res.status(500).json({ error: 'Analysis failed' });
  }
});

/**
 * Extract entities from text (fast, no LLM)
 * POST /api/extract-entities
 */
router.post('/extract-entities', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const entities = await conversationAnalyzer.extractEntities(text);
    res.json(entities);
  } catch (error: any) {
    logger.error('Entity extraction failed', { error: error.message });
    res.status(500).json({ error: 'Extraction failed' });
  }
});

// ============================================
// Tool Usage Tracking
// ============================================

/**
 * Track a tool invocation
 * POST /api/track-usage
 */
router.post('/track-usage', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const {
      sessionId,
      toolName,
      inputSummary,
      startTime,
      resultCount,
      success,
      errorMessage,
      metadata,
    } = req.body;

    if (!projectName || !toolName) {
      return res.status(400).json({ error: 'projectName and toolName are required' });
    }

    const usage = await usageTracker.track({
      projectName,
      sessionId,
      toolName,
      inputSummary: inputSummary || '',
      startTime: startTime || Date.now(),
      resultCount,
      success: success !== false,
      errorMessage,
      metadata,
    });

    res.json({ tracked: true, id: usage.id });
  } catch (error: any) {
    logger.error('Usage tracking failed', { error: error.message });
    res.status(500).json({ error: 'Tracking failed' });
  }
});

/**
 * Get tool usage statistics
 * GET /api/tool-analytics
 */
router.get('/tool-analytics', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const days = parseInt(req.query.days as string) || 7;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const stats = await usageTracker.getStats(projectName, days);
    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get analytics', { error: error.message });
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

/**
 * Get knowledge gaps (queries with low results)
 * GET /api/knowledge-gaps
 */
router.get('/knowledge-gaps', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const gaps = await usageTracker.getKnowledgeGaps(projectName, limit);
    res.json({ gaps });
  } catch (error: any) {
    logger.error('Failed to get knowledge gaps', { error: error.message });
    res.status(500).json({ error: 'Failed to get knowledge gaps' });
  }
});

/**
 * Find similar past queries
 * POST /api/similar-queries
 */
router.post('/similar-queries', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { query, limit = 5 } = req.body;

    if (!projectName || !query) {
      return res.status(400).json({ error: 'projectName and query are required' });
    }

    const similar = await usageTracker.findSimilarQueries(projectName, query, limit);
    res.json({
      similar: similar.map(s => ({
        toolName: s.usage.toolName,
        inputSummary: s.usage.inputSummary,
        resultCount: s.usage.resultCount,
        success: s.usage.success,
        score: s.score,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to find similar queries', { error: error.message });
    res.status(500).json({ error: 'Failed to find similar queries' });
  }
});

export default router;
