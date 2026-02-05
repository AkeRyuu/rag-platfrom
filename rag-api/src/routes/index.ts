/**
 * Index Routes - Indexing and stats endpoints
 */

import { Router, Request, Response } from 'express';
import {
  indexProject,
  getIndexStatus,
  getProjectStats,
  getCollectionName,
  reindexWithZeroDowntime,
  getAliasInfo,
} from '../services/indexer';
import { vectorStore } from '../services/vector-store';
import { confluenceService } from '../services/confluence';
import { usagePatterns } from '../services/usage-patterns';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Start indexing a project
 * POST /api/index
 */
router.post('/index', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const projectPath = req.headers['x-project-path'] as string || req.body.path;
    const { force = false, patterns, excludePatterns } = req.body;

    if (!projectName || !projectPath) {
      return res.status(400).json({
        error: 'projectName and path are required (via headers or body)',
      });
    }

    // Check if already indexing
    const status = getIndexStatus(projectName);
    if (status.status === 'indexing') {
      return res.json({
        status: 'already_indexing',
        progress: status,
      });
    }

    // Start indexing in background
    indexProject({
      projectName,
      projectPath,
      patterns,
      excludePatterns,
      force,
    }).catch(error => {
      logger.error(`Background indexing failed for ${projectName}`, { error: error.message });
    });

    res.json({
      status: 'started',
      message: `Indexing started for ${projectName}`,
      collection: getCollectionName(projectName),
    });
  } catch (error: any) {
    logger.error('Failed to start indexing', { error: error.message });
    res.status(500).json({ error: 'Failed to start indexing' });
  }
});

/**
 * Get indexing status
 * GET /api/index/status/:collection
 */
router.get('/index/status/:collection', async (req: Request, res: Response) => {
  try {
    const { collection } = req.params;

    // Extract project name from collection (e.g., "cypro_codebase" -> "cypro")
    const projectName = collection.replace(/_codebase$|_docs$/, '');

    const status = getIndexStatus(projectName);
    const collectionInfo = await vectorStore.getCollectionInfo(collection);

    res.json({
      ...status,
      vectorCount: collectionInfo.vectorsCount,
      collectionStatus: collectionInfo.status,
    });
  } catch (error: any) {
    logger.error('Failed to get index status', { error: error.message });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * Get project stats
 * GET /api/stats/:collection
 */
router.get('/stats/:collection', async (req: Request, res: Response) => {
  try {
    const { collection } = req.params;

    const projectName = collection.replace(/_codebase$|_docs$/, '');
    const stats = await getProjectStats(projectName);
    const collectionInfo = await vectorStore.getCollectionInfo(collection);

    res.json({
      ...stats,
      vectorCount: collectionInfo.vectorsCount,
      status: collectionInfo.status,
    });
  } catch (error: any) {
    logger.error('Failed to get stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * List all collections
 * GET /api/collections
 */
router.get('/collections', async (req: Request, res: Response) => {
  try {
    const projectFilter = req.query.project as string | undefined;

    let collections: string[];
    if (projectFilter) {
      collections = await vectorStore.listProjectCollections(projectFilter);
    } else {
      collections = await vectorStore.listCollections();
    }

    // Get info for each collection
    const collectionsInfo = await Promise.all(
      collections.map(async name => {
        const info = await vectorStore.getCollectionInfo(name);
        return {
          name,
          vectorsCount: info.vectorsCount,
          status: info.status,
        };
      })
    );

    res.json({ collections: collectionsInfo });
  } catch (error: any) {
    logger.error('Failed to list collections', { error: error.message });
    res.status(500).json({ error: 'Failed to list collections' });
  }
});

/**
 * Delete a collection
 * DELETE /api/collections/:name
 */
router.delete('/collections/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    await vectorStore.deleteCollection(name);
    res.json({ message: `Deleted collection: ${name}` });
  } catch (error: any) {
    logger.error('Failed to delete collection', { error: error.message });
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

/**
 * Clear a collection (keep structure, remove vectors)
 * POST /api/collections/:name/clear
 */
router.post('/collections/:name/clear', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    await vectorStore.clearCollection(name);
    res.json({ message: `Cleared collection: ${name}` });
  } catch (error: any) {
    logger.error('Failed to clear collection', { error: error.message });
    res.status(500).json({ error: 'Failed to clear collection' });
  }
});

/**
 * Create/ensure payload indexes on a collection (migration)
 * POST /api/collections/:name/indexes
 */
router.post('/collections/:name/indexes', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    await vectorStore.ensurePayloadIndexes(name);
    const info = await vectorStore.getCollectionInfo(name);

    res.json({
      message: `Created indexes on collection: ${name}`,
      indexedFields: info.indexedFields,
    });
  } catch (error: any) {
    logger.error('Failed to create indexes', { error: error.message });
    res.status(500).json({ error: 'Failed to create indexes' });
  }
});

/**
 * Create indexes on all existing collections (migration)
 * POST /api/collections/migrate-indexes
 */
router.post('/collections/migrate-indexes', async (req: Request, res: Response) => {
  try {
    const collections = await vectorStore.listCollections();
    const results: Record<string, string[]> = {};

    for (const name of collections) {
      await vectorStore.ensurePayloadIndexes(name);
      const info = await vectorStore.getCollectionInfo(name);
      results[name] = info.indexedFields || [];
    }

    res.json({
      message: `Migrated ${collections.length} collections`,
      collections: results,
    });
  } catch (error: any) {
    logger.error('Failed to migrate indexes', { error: error.message });
    res.status(500).json({ error: 'Failed to migrate indexes' });
  }
});

/**
 * Get detailed collection info with indexes
 * GET /api/collections/:name/info
 */
router.get('/collections/:name/info', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const info = await vectorStore.getCollectionInfo(name);

    res.json(info);
  } catch (error: any) {
    logger.error('Failed to get collection info', { error: error.message });
    res.status(500).json({ error: 'Failed to get collection info' });
  }
});

// ============================================
// Zero-Downtime Reindex Routes
// ============================================

/**
 * Reindex with zero downtime using aliases
 * POST /api/reindex
 */
router.post('/reindex', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const projectPath = req.headers['x-project-path'] as string || req.body.path;
    const { patterns, excludePatterns, aliasName } = req.body;

    if (!projectName || !projectPath) {
      return res.status(400).json({
        error: 'projectName and path are required (via headers or body)',
      });
    }

    // Check if already indexing
    const status = getIndexStatus(projectName);
    if (status.status === 'indexing') {
      return res.json({
        status: 'already_indexing',
        progress: status,
      });
    }

    // Start reindexing in background
    reindexWithZeroDowntime({
      projectName,
      projectPath,
      patterns,
      excludePatterns,
      aliasName,
    }).catch(error => {
      logger.error(`Zero-downtime reindex failed for ${projectName}`, { error: error.message });
    });

    res.json({
      status: 'started',
      message: `Zero-downtime reindexing started for ${projectName}`,
      alias: aliasName || getCollectionName(projectName),
    });
  } catch (error: any) {
    logger.error('Failed to start reindexing', { error: error.message });
    res.status(500).json({ error: 'Failed to start reindexing' });
  }
});

/**
 * Get alias info for a project
 * GET /api/alias/:project
 */
router.get('/alias/:project', async (req: Request, res: Response) => {
  try {
    const { project } = req.params;
    const info = await getAliasInfo(project);
    res.json(info);
  } catch (error: any) {
    logger.error('Failed to get alias info', { error: error.message });
    res.status(500).json({ error: 'Failed to get alias info' });
  }
});

/**
 * List all aliases
 * GET /api/aliases
 */
router.get('/aliases', async (req: Request, res: Response) => {
  try {
    const aliases = await vectorStore.listAliases();
    res.json({ aliases });
  } catch (error: any) {
    logger.error('Failed to list aliases', { error: error.message });
    res.status(500).json({ error: 'Failed to list aliases' });
  }
});

// ============================================
// Clustering & Similarity Routes
// ============================================

/**
 * Find code clusters based on seed IDs
 * POST /api/clusters
 */
router.post('/clusters', async (req: Request, res: Response) => {
  try {
    const { collection, seedIds, limit = 10, threshold = 0.8 } = req.body;

    if (!collection || !seedIds || !Array.isArray(seedIds)) {
      return res.status(400).json({ error: 'collection and seedIds array are required' });
    }

    const clusters = await vectorStore.findClusters(collection, seedIds, limit, threshold);
    res.json({ clusters });
  } catch (error: any) {
    logger.error('Failed to find clusters', { error: error.message });
    res.status(500).json({ error: 'Failed to find clusters' });
  }
});

/**
 * Find duplicate code in a collection
 * POST /api/duplicates
 */
router.post('/duplicates', async (req: Request, res: Response) => {
  try {
    const { collection, limit = 100, threshold = 0.95 } = req.body;

    if (!collection) {
      return res.status(400).json({ error: 'collection is required' });
    }

    const duplicates = await vectorStore.findDuplicates(collection, limit, threshold);
    res.json({
      duplicates: duplicates.map(d => ({
        files: d.group.map(g => ({
          id: g.id,
          file: g.payload.file,
          content: (g.payload.content as string)?.slice(0, 200),
        })),
        similarity: d.similarity,
      })),
      totalGroups: duplicates.length,
    });
  } catch (error: any) {
    logger.error('Failed to find duplicates', { error: error.message });
    res.status(500).json({ error: 'Failed to find duplicates' });
  }
});

/**
 * Get recommendations based on positive/negative examples
 * POST /api/recommend
 */
router.post('/recommend', async (req: Request, res: Response) => {
  try {
    const { collection, positiveIds, negativeIds = [], limit = 10 } = req.body;

    if (!collection || !positiveIds || !Array.isArray(positiveIds)) {
      return res.status(400).json({ error: 'collection and positiveIds array are required' });
    }

    const results = await vectorStore.recommend(collection, positiveIds, negativeIds, limit);
    res.json({
      results: results.map(r => ({
        id: r.id,
        file: r.payload.file,
        content: r.payload.content,
        score: r.score,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to get recommendations', { error: error.message });
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// ============================================
// Usage Patterns Routes
// ============================================

/**
 * Analyze usage patterns
 * GET /api/patterns/:project
 */
router.get('/patterns/:project', async (req: Request, res: Response) => {
  try {
    const { project } = req.params;
    const days = parseInt(req.query.days as string) || 7;

    const analysis = await usagePatterns.analyzePatterns(project, days);
    res.json(analysis);
  } catch (error: any) {
    logger.error('Failed to analyze patterns', { error: error.message });
    res.status(500).json({ error: 'Failed to analyze patterns' });
  }
});

/**
 * Summarize current context
 * GET /api/context/:project
 */
router.get('/context/:project', async (req: Request, res: Response) => {
  try {
    const { project } = req.params;
    const sessionId = req.query.sessionId as string | undefined;

    const summary = await usagePatterns.summarizeContext(project, sessionId);
    res.json(summary);
  } catch (error: any) {
    logger.error('Failed to summarize context', { error: error.message });
    res.status(500).json({ error: 'Failed to summarize context' });
  }
});

/**
 * Summarize changes in a session
 * GET /api/changes/:project/:sessionId
 */
router.get('/changes/:project/:sessionId', async (req: Request, res: Response) => {
  try {
    const { project, sessionId } = req.params;
    const includeCode = req.query.includeCode === 'true';

    const summary = await usagePatterns.summarizeChanges(project, sessionId, { includeCode });
    res.json(summary);
  } catch (error: any) {
    logger.error('Failed to summarize changes', { error: error.message });
    res.status(500).json({ error: 'Failed to summarize changes' });
  }
});

// ============================================
// Quantization Routes
// ============================================

/**
 * Enable scalar quantization on a collection
 * POST /api/collections/:name/quantization
 */
router.post('/collections/:name/quantization', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { quantile = 0.99 } = req.body;

    await vectorStore.enableQuantization(name, quantile);
    res.json({ success: true, message: `Quantization enabled on ${name}` });
  } catch (error: any) {
    logger.error('Failed to enable quantization', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Disable quantization on a collection
 * DELETE /api/collections/:name/quantization
 */
router.delete('/collections/:name/quantization', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    await vectorStore.disableQuantization(name);
    res.json({ success: true, message: `Quantization disabled on ${name}` });
  } catch (error: any) {
    logger.error('Failed to disable quantization', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Snapshot Routes
// ============================================

/**
 * Create a snapshot of a collection
 * POST /api/collections/:name/snapshots
 */
router.post('/collections/:name/snapshots', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    const snapshot = await vectorStore.createSnapshot(name);
    res.json({ success: true, snapshot });
  } catch (error: any) {
    logger.error('Failed to create snapshot', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * List snapshots for a collection
 * GET /api/collections/:name/snapshots
 */
router.get('/collections/:name/snapshots', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    const snapshots = await vectorStore.listSnapshots(name);
    res.json({ snapshots });
  } catch (error: any) {
    logger.error('Failed to list snapshots', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a snapshot
 * DELETE /api/collections/:name/snapshots/:snapshotName
 */
router.delete('/collections/:name/snapshots/:snapshotName', async (req: Request, res: Response) => {
  try {
    const { name, snapshotName } = req.params;

    await vectorStore.deleteSnapshot(name, snapshotName);
    res.json({ success: true, message: `Snapshot ${snapshotName} deleted` });
  } catch (error: any) {
    logger.error('Failed to delete snapshot', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Analytics Routes
// ============================================

/**
 * Get detailed collection analytics
 * GET /api/analytics/:collection
 */
router.get('/analytics/:collection', async (req: Request, res: Response) => {
  try {
    const { collection } = req.params;

    const analytics = await vectorStore.getCollectionAnalytics(collection);
    res.json(analytics);
  } catch (error: any) {
    logger.error('Failed to get analytics', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get cluster-wide health info
 * GET /api/analytics/cluster/health
 */
router.get('/analytics/cluster/health', async (req: Request, res: Response) => {
  try {
    const info = await vectorStore.getClusterInfo();
    res.json(info);
  } catch (error: any) {
    logger.error('Failed to get cluster info', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Proactive Suggestions Routes
// ============================================

import { proactiveSuggestions } from '../services/proactive-suggestions';

/**
 * Get contextual suggestions
 * POST /api/suggestions
 */
router.post('/suggestions', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { text, currentFile, recentFiles, sessionId } = req.body;

    if (!projectName || !text) {
      return res.status(400).json({ error: 'projectName and text are required' });
    }

    const analysis = await proactiveSuggestions.analyzeContext({
      projectName,
      text,
      currentFile,
      recentFiles,
      sessionId,
    });

    res.json(analysis);
  } catch (error: any) {
    logger.error('Failed to get suggestions', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Session Routes
// ============================================

import { sessionContext } from '../services/session-context';

/**
 * Start a new session
 * POST /api/session/start
 */
router.post('/session/start', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { sessionId, initialContext, resumeFrom, metadata } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const session = await sessionContext.startSession({
      projectName,
      sessionId,
      initialContext,
      resumeFrom,
      metadata,
    });

    res.json({ success: true, session });
  } catch (error: any) {
    logger.error('Failed to start session', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get session context
 * GET /api/session/:sessionId
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const { sessionId } = req.params;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const session = await sessionContext.getSession(projectName, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });
  } catch (error: any) {
    logger.error('Failed to get session', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add activity to session
 * POST /api/session/:sessionId/activity
 */
router.post('/session/:sessionId/activity', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { sessionId } = req.params;
    const { type, value } = req.body;

    if (!projectName || !type || !value) {
      return res.status(400).json({ error: 'projectName, type, and value are required' });
    }

    await sessionContext.addActivity(projectName, sessionId, { type, value });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to add activity', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * End a session
 * POST /api/session/:sessionId/end
 */
router.post('/session/:sessionId/end', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { sessionId } = req.params;
    const { summary, autoSaveLearnings = true, feedback } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const result = await sessionContext.endSession({
      projectName,
      sessionId,
      summary,
      autoSaveLearnings,
      feedback,
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Failed to end session', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * List sessions
 * GET /api/sessions
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.query.projectName as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as 'active' | 'ended' | 'all' || 'all';

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    const sessions = await sessionContext.listSessions(projectName, { limit, status });
    res.json({ sessions });
  } catch (error: any) {
    logger.error('Failed to list sessions', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Feedback & Quality Routes
// ============================================

import { feedbackService } from '../services/feedback';
import { queryLearning } from '../services/query-learning';
import { codeSuggestions } from '../services/code-suggestions';

/**
 * Submit search feedback
 * POST /api/feedback/search
 */
router.post('/feedback/search', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { queryId, query, resultId, resultFile, feedbackType, betterQuery, comment, sessionId } = req.body;

    if (!projectName || !queryId || !query || !resultId || !feedbackType) {
      return res.status(400).json({
        error: 'projectName, queryId, query, resultId, and feedbackType are required',
      });
    }

    const feedback = await feedbackService.submitSearchFeedback({
      projectName,
      queryId,
      query,
      resultId,
      resultFile,
      feedbackType,
      betterQuery,
      comment,
      sessionId,
    });

    res.json({ success: true, feedback });
  } catch (error: any) {
    logger.error('Failed to submit search feedback', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Submit memory feedback
 * POST /api/feedback/memory
 */
router.post('/feedback/memory', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { memoryId, memoryContent, feedbackType, correction, comment, sessionId } = req.body;

    if (!projectName || !memoryId || !memoryContent || !feedbackType) {
      return res.status(400).json({
        error: 'projectName, memoryId, memoryContent, and feedbackType are required',
      });
    }

    const feedback = await feedbackService.submitMemoryFeedback({
      projectName,
      memoryId,
      memoryContent,
      feedbackType,
      correction,
      comment,
      sessionId,
    });

    res.json({ success: true, feedback });
  } catch (error: any) {
    logger.error('Failed to submit memory feedback', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get feedback statistics
 * GET /api/feedback/stats/:project
 */
router.get('/feedback/stats/:project', async (req: Request, res: Response) => {
  try {
    const { project } = req.params;
    const days = parseInt(req.query.days as string) || 30;

    const stats = await feedbackService.getStats(project, days);
    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get feedback stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get quality metrics
 * GET /api/quality/:project
 */
router.get('/quality/:project', async (req: Request, res: Response) => {
  try {
    const { project } = req.params;

    const metrics = await feedbackService.getQualityMetrics(project);
    res.json(metrics);
  } catch (error: any) {
    logger.error('Failed to get quality metrics', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Query Learning Routes
// ============================================

/**
 * Suggest better queries
 * POST /api/query/suggest
 */
router.post('/query/suggest', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { query, context } = req.body;

    if (!projectName || !query) {
      return res.status(400).json({ error: 'projectName and query are required' });
    }

    const suggestions = await queryLearning.suggestBetterQuery({
      projectName,
      query,
      context,
    });

    res.json({ suggestions });
  } catch (error: any) {
    logger.error('Failed to suggest query', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Learn a query pattern
 * POST /api/query/learn
 */
router.post('/query/learn', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { originalQuery, betterQuery, wasHelpful } = req.body;

    if (!projectName || !originalQuery || !betterQuery || wasHelpful === undefined) {
      return res.status(400).json({
        error: 'projectName, originalQuery, betterQuery, and wasHelpful are required',
      });
    }

    await queryLearning.learnPattern({
      projectName,
      originalQuery,
      betterQuery,
      wasHelpful,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to learn pattern', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get learned query patterns
 * GET /api/query/patterns/:project
 */
router.get('/query/patterns/:project', async (req: Request, res: Response) => {
  try {
    const { project } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    const patterns = await queryLearning.getPatterns(project, limit);
    res.json({ patterns });
  } catch (error: any) {
    logger.error('Failed to get patterns', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Analyze a query for issues
 * POST /api/query/analyze
 */
router.post('/query/analyze', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const analysis = queryLearning.analyzeQuery(query);
    res.json(analysis);
  } catch (error: any) {
    logger.error('Failed to analyze query', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Code Suggestions Routes
// ============================================

/**
 * Find related code
 * POST /api/code/related
 */
router.post('/code/related', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { code, description, currentFile, limit, minScore } = req.body;

    if (!projectName || (!code && !description)) {
      return res.status(400).json({
        error: 'projectName and either code or description are required',
      });
    }

    const result = await codeSuggestions.findRelatedCode({
      projectName,
      code,
      description,
      currentFile,
      limit,
      minScore,
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Failed to find related code', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Suggest implementation patterns
 * POST /api/code/suggest-implementation
 */
router.post('/code/suggest-implementation', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { targetCode, targetDescription, currentFile, limit } = req.body;

    if (!projectName || !targetCode) {
      return res.status(400).json({
        error: 'projectName and targetCode are required',
      });
    }

    const suggestions = await codeSuggestions.suggestImplementation({
      projectName,
      targetCode,
      targetDescription,
      currentFile,
      limit,
    });

    res.json({ suggestions });
  } catch (error: any) {
    logger.error('Failed to suggest implementation', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Suggest test patterns
 * POST /api/code/suggest-tests
 */
router.post('/code/suggest-tests', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { code, filePath, testType, limit } = req.body;

    if (!projectName || !code) {
      return res.status(400).json({
        error: 'projectName and code are required',
      });
    }

    const suggestions = await codeSuggestions.suggestTests({
      projectName,
      code,
      filePath,
      testType,
      limit,
    });

    res.json({ suggestions });
  } catch (error: any) {
    logger.error('Failed to suggest tests', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get comprehensive code context
 * POST /api/code/context
 */
router.post('/code/context', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { code, includeRelated, includeTests, includeImports } = req.body;

    if (!projectName || !code) {
      return res.status(400).json({
        error: 'projectName and code are required',
      });
    }

    const context = await codeSuggestions.getCodeContext({
      projectName,
      code,
      includeRelated,
      includeTests,
      includeImports,
    });

    res.json(context);
  } catch (error: any) {
    logger.error('Failed to get code context', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Cache Analytics Routes
// ============================================

import { cacheService } from '../services/cache';
import { embeddingService } from '../services/embedding';

/**
 * Get cache analytics
 * GET /api/cache/analytics
 */
router.get('/cache/analytics', async (req: Request, res: Response) => {
  try {
    const analytics = await cacheService.getCacheAnalytics();
    res.json(analytics);
  } catch (error: any) {
    logger.error('Failed to get cache analytics', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get session cache stats
 * GET /api/cache/session/:sessionId
 */
router.get('/cache/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const stats = await embeddingService.getCacheStats(sessionId);
    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get session cache stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Warm session cache
 * POST /api/cache/warm
 */
router.post('/cache/warm', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { sessionId, previousSessionId, recentQueries } = req.body;

    if (!projectName || !sessionId) {
      return res.status(400).json({ error: 'projectName and sessionId are required' });
    }

    const result = await embeddingService.warmSessionCache({
      sessionId,
      projectName,
      previousSessionId,
      recentQueries,
    });

    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('Failed to warm cache', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Prune old session caches
 * POST /api/cache/prune
 */
router.post('/cache/prune', async (req: Request, res: Response) => {
  try {
    const { maxAgeDays = 7 } = req.body;
    const pruned = await cacheService.pruneOldSessions(maxAgeDays);
    res.json({ success: true, prunedCount: pruned });
  } catch (error: any) {
    logger.error('Failed to prune cache', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Confluence Routes
// ============================================

/**
 * Check Confluence configuration status
 * GET /api/confluence/status
 */
router.get('/confluence/status', async (req: Request, res: Response) => {
  try {
    const configured = confluenceService.isConfigured();
    res.json({
      configured,
      message: configured
        ? 'Confluence is configured and ready'
        : 'Confluence not configured. Set CONFLUENCE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * List Confluence spaces
 * GET /api/confluence/spaces
 */
router.get('/confluence/spaces', async (req: Request, res: Response) => {
  try {
    if (!confluenceService.isConfigured()) {
      return res.status(400).json({ error: 'Confluence not configured' });
    }

    const spaces = await confluenceService.getSpaces();
    res.json({ spaces });
  } catch (error: any) {
    logger.error('Failed to get Confluence spaces', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Index Confluence content
 * POST /api/index/confluence
 */
router.post('/index/confluence', async (req: Request, res: Response) => {
  try {
    const projectName = req.headers['x-project-name'] as string || req.body.projectName;
    const { spaceKeys, pageIds, labels, maxPages = 500, force = false } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }

    if (!confluenceService.isConfigured()) {
      return res.status(400).json({ error: 'Confluence not configured' });
    }

    // Start indexing in background
    confluenceService.indexConfluence({
      projectName,
      spaceKeys,
      pageIds,
      labels,
      maxPages,
      force,
    }).catch(error => {
      logger.error(`Confluence indexing failed for ${projectName}`, { error: error.message });
    });

    res.json({
      status: 'started',
      message: `Confluence indexing started for ${projectName}`,
      collection: `${projectName}_confluence`,
      options: { spaceKeys, pageIds, labels, maxPages, force },
    });
  } catch (error: any) {
    logger.error('Failed to start Confluence indexing', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search Confluence pages by CQL
 * POST /api/confluence/search
 */
router.post('/confluence/search', async (req: Request, res: Response) => {
  try {
    if (!confluenceService.isConfigured()) {
      return res.status(400).json({ error: 'Confluence not configured' });
    }

    const { cql, limit = 20 } = req.body;
    if (!cql) {
      return res.status(400).json({ error: 'cql query is required' });
    }

    const pages = await confluenceService.searchPages(cql, limit);
    res.json({ pages, count: pages.length });
  } catch (error: any) {
    logger.error('Failed to search Confluence', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
