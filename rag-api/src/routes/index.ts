/**
 * Index Routes - Indexing and stats endpoints
 */

import { Router, Request, Response } from 'express';
import { indexProject, getIndexStatus, getProjectStats, getCollectionName } from '../services/indexer';
import { vectorStore } from '../services/vector-store';
import { confluenceService } from '../services/confluence';
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
