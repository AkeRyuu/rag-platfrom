/**
 * Analytics Routes - Conversation analysis and tool usage tracking
 */

import { Router, Request, Response } from 'express';
import { conversationAnalyzer } from '../services/conversation-analyzer';
import { usageTracker } from '../services/usage-tracker';
import { predictiveLoader } from '../services/predictive-loader';
import { sessionContext } from '../services/session-context';
import { asyncHandler } from '../middleware/async-handler';
import {
  validate,
  validateProjectName,
  analyzeConversationSchema,
  trackUsageSchema,
  prefetchSchema,
  predictionStatsSchema,
  trackPredictionSchema,
} from '../utils/validation';

const router = Router();

// ============================================
// Conversation Analysis
// ============================================

/**
 * Analyze a conversation and extract learnings
 * POST /api/analyze-conversation
 */
router.post('/analyze-conversation', validateProjectName, validate(analyzeConversationSchema), asyncHandler(async (req: Request, res: Response) => {
  const { projectName, conversation, context, autoSave, minConfidence } = req.body;

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
}));

/**
 * Extract entities from text (fast, no LLM)
 * POST /api/extract-entities
 */
router.post('/extract-entities', asyncHandler(async (req: Request, res: Response) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  const entities = await conversationAnalyzer.extractEntities(text);
  res.json(entities);
}));

// ============================================
// Tool Usage Tracking
// ============================================

/**
 * Track a tool invocation
 * POST /api/track-usage
 */
router.post('/track-usage', validateProjectName, validate(trackUsageSchema), asyncHandler(async (req: Request, res: Response) => {
  const {
    projectName,
    sessionId,
    toolName,
    inputSummary,
    startTime,
    resultCount,
    success,
    errorMessage,
    metadata,
  } = req.body;

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
}));

/**
 * Get tool usage statistics
 * GET /api/tool-analytics
 */
router.get('/tool-analytics', validateProjectName, asyncHandler(async (req: Request, res: Response) => {
  const { projectName } = req.body;
  const days = parseInt(req.query.days as string) || 7;

  const stats = await usageTracker.getStats(projectName, days);
  res.json(stats);
}));

/**
 * Get knowledge gaps (queries with low results)
 * GET /api/knowledge-gaps
 */
router.get('/knowledge-gaps', validateProjectName, asyncHandler(async (req: Request, res: Response) => {
  const { projectName } = req.body;
  const limit = parseInt(req.query.limit as string) || 20;

  const gaps = await usageTracker.getKnowledgeGaps(projectName, limit);
  res.json({ gaps });
}));

/**
 * Find similar past queries
 * POST /api/similar-queries
 */
router.post('/similar-queries', validateProjectName, asyncHandler(async (req: Request, res: Response) => {
  const { projectName, query, limit = 5 } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
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
}));

// ============================================
// Behavior Patterns Routes
// ============================================

/**
 * Get user behavior patterns from tool usage
 * GET /api/behavior-patterns
 */
router.get('/behavior-patterns', validateProjectName, asyncHandler(async (req: Request, res: Response) => {
  const { projectName } = req.body;
  const days = parseInt(req.query.days as string) || 7;
  const sessionId = req.query.sessionId as string | undefined;

  const patterns = await usageTracker.getBehaviorPatterns(projectName, { days, sessionId });
  res.json(patterns);
}));

// ============================================
// Prediction Routes
// ============================================

/**
 * Trigger predictive prefetch for a session
 * POST /api/predictions/prefetch
 */
router.post('/predictions/prefetch', validateProjectName, validate(prefetchSchema), asyncHandler(async (req: Request, res: Response) => {
  const { projectName, sessionId } = req.body;

  // Get session context for predictions
  const session = await sessionContext.getSession(projectName, sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const predictions = await predictiveLoader.predict(projectName, sessionId, {
    currentFiles: session.currentFiles,
    recentQueries: session.recentQueries,
    toolsUsed: session.toolsUsed,
    activeFeatures: session.activeFeatures,
  });

  const result = await predictiveLoader.prefetch(projectName, sessionId, predictions);
  res.json(result);
}));

/**
 * Get prediction accuracy stats
 * GET /api/predictions/stats
 */
router.get('/predictions/stats', validateProjectName, asyncHandler(async (req: Request, res: Response) => {
  const { projectName } = req.body;
  const sessionId = req.query.sessionId as string | undefined;

  const stats = await predictiveLoader.getStats(projectName, sessionId);
  res.json(stats);
}));

/**
 * Track a prediction hit or miss
 * POST /api/predictions/track
 */
router.post('/predictions/track', validateProjectName, validate(trackPredictionSchema), asyncHandler(async (req: Request, res: Response) => {
  const { projectName, sessionId, resource, hit } = req.body;

  if (hit) {
    await predictiveLoader.trackHit(projectName, sessionId, resource);
  } else {
    await predictiveLoader.trackMiss(projectName, sessionId, resource);
  }

  res.json({ success: true });
}));

export default router;
