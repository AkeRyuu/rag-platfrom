import { Actor, ActorMessage } from './base-actor';
import { logger } from '../utils/logger';

interface IndexActorState {
  lastIndexedAt: string;
  lastDuration: number;
  lastFileCount: number;
  lastChunkCount: number;
  totalIndexRuns: number;
  lastError: string | null;
  isIndexing: boolean;
}

type IndexMessage = {
  projectName: string;
  totalFiles?: number;
  processedFiles?: number;
  stats?: Record<string, unknown>;
  error?: string;
};

export class IndexActor extends Actor<IndexActorState, IndexMessage> {
  constructor() {
    super('index', {
      lastIndexedAt: '',
      lastDuration: 0,
      lastFileCount: 0,
      lastChunkCount: 0,
      totalIndexRuns: 0,
      lastError: null,
      isIndexing: false,
    });
  }

  async handle(
    actorId: string,
    message: ActorMessage<IndexMessage>,
    state: IndexActorState
  ): Promise<IndexActorState> {
    switch (message.type) {
      case 'index:started':
        state.isIndexing = true;
        state.lastError = null;
        logger.debug(`IndexActor: indexing started for ${actorId}`);
        break;

      case 'index:progress':
        // Just track — progress is already emitted via eventBus for SSE
        break;

      case 'index:completed': {
        const stats = message.payload.stats || {};
        state.isIndexing = false;
        state.lastIndexedAt = new Date().toISOString();
        state.lastDuration = (stats.duration as number) || 0;
        state.lastFileCount = (stats.indexedFiles as number) || (stats.totalFiles as number) || 0;
        state.lastChunkCount = (stats.totalChunks as number) || 0;
        state.totalIndexRuns++;
        state.lastError = null;
        logger.debug(`IndexActor: indexing completed for ${actorId}`, {
          files: state.lastFileCount,
          chunks: state.lastChunkCount,
          duration: state.lastDuration,
        });
        break;
      }

      case 'index:failed':
        state.isIndexing = false;
        state.lastError = message.payload.error || 'Unknown error';
        logger.debug(`IndexActor: indexing failed for ${actorId}`, { error: state.lastError });
        break;
    }

    return state;
  }
}

export const indexActor = new IndexActor();
