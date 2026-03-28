import { createWorker } from '../queues';
import config from '../../config';
import { logger } from '../../utils/logger';
import type { MemoryCreatedPayload, MemoryRecalledPayload } from '../types';
import type { MemoryType } from '../../services/memory';

// Lazy service references to avoid circular dependencies
let memoryServiceRef: { _asyncDetectRelationships: Function } | null = null;
let reconsolidationRef: { onRecall: Function } | null = null;

async function getMemoryService(): Promise<{ _asyncDetectRelationships: Function }> {
  if (!memoryServiceRef) {
    const mod = await import('../../services/memory');
    memoryServiceRef = mod.memoryService;
  }
  return memoryServiceRef!;
}

async function getReconsolidation(): Promise<{ onRecall: Function }> {
  if (!reconsolidationRef) {
    const mod = await import('../../services/reconsolidation');
    reconsolidationRef = mod.reconsolidation;
  }
  return reconsolidationRef!;
}

export function startMemoryEffectsWorker(): void {
  createWorker<MemoryCreatedPayload | MemoryRecalledPayload>(
    'memory-effects',
    async (job) => {
      const { name, data } = job;

      switch (name) {
        case 'memory:created': {
          const payload = data as MemoryCreatedPayload;
          const memService = await getMemoryService();
          try {
            await memService._asyncDetectRelationships(
              payload.projectName,
              payload.memoryId,
              payload.content,
              payload.type as MemoryType,
              payload.embedding
            );
            logger.debug('Async relationship detection completed', {
              memoryId: payload.memoryId,
            });
          } catch (err: any) {
            logger.debug('Async relationship detection failed', {
              error: err.message,
              memoryId: payload.memoryId,
            });
          }
          break;
        }

        case 'memory:recalled': {
          if (!config.RECONSOLIDATION_ENABLED) break;
          const payload = data as MemoryRecalledPayload;
          const recon = await getReconsolidation();
          try {
            await recon.onRecall(payload.projectName, payload.recalledMemories, payload.query);
            logger.debug('Async reconsolidation completed', { query: payload.query });
          } catch (err: any) {
            logger.debug('Async reconsolidation failed', { error: err.message });
          }
          break;
        }

        default:
          logger.debug('memory-effects worker: unhandled job name', { name });
      }
    },
    { concurrency: config.EVENT_QUEUE_CONCURRENCY }
  );

  logger.info('Memory effects worker started');
}
