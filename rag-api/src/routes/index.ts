/**
 * Index Routes - Indexing and stats endpoints
 */

import { Router, Request, Response } from 'express';
import { indexProject, getIndexStatus, getProjectStats, getCollectionName } from '../services/indexer';
import { vectorStore } from '../services/vector-store';
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

export default router;
