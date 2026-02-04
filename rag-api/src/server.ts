/**
 * Shared RAG API Server
 *
 * Universal RAG API that supports multiple projects with isolated collections.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config';
import { logger } from './utils/logger';
import { vectorStore } from './services/vector-store';
import searchRoutes from './routes/search';
import indexRoutes from './routes/index';

const app: Express = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const projectName = req.headers['x-project-name'] || 'unknown';
    logger.info(`[${projectName}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      embeddingProvider: config.EMBEDDING_PROVIDER,
      llmProvider: config.LLM_PROVIDER,
      vectorSize: config.VECTOR_SIZE,
    },
  });
});

// API routes
app.use('/api', searchRoutes);
app.use('/api', indexRoutes);

// Legacy routes for backward compatibility with cypro-rag MCP
app.use('/api/dev/codebase', (req, res, next) => {
  // Map old endpoints to new ones
  const projectName = 'cypro';
  req.headers['x-project-name'] = projectName;

  if (req.path === '/search') {
    req.body.collection = `${projectName}_codebase`;
    return searchRoutes(req, res, next);
  }
  if (req.path === '/ask') {
    req.body.collection = `${projectName}_codebase`;
    return searchRoutes(req, res, next);
  }
  next();
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
export async function startServer(): Promise<void> {
  try {
    // Initialize vector store
    logger.info('Initializing vector store...');
    await vectorStore.initialize();

    // Start server
    app.listen(config.API_PORT, config.API_HOST, () => {
      logger.info(`Shared RAG API running at http://${config.API_HOST}:${config.API_PORT}`);
      logger.info(`Embedding: ${config.EMBEDDING_PROVIDER}, LLM: ${config.LLM_PROVIDER}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  startServer();
}

export default app;
