import { eventBus, type EventType } from '../services/event-bus';
import { getQueue, type QueueName } from './queues';
import type { DomainEventType, EventPayloadMap } from './types';
import { generateCorrelationId } from './types';
import config from '../config';
import { logger } from '../utils/logger';
import { withSpan } from '../utils/tracing';
import { eventEmittedTotal } from '../utils/metrics';

// Map event types to BullMQ queue names
const EVENT_QUEUE_MAP: Partial<Record<DomainEventType, QueueName>> = {
  'memory:created': 'memory-effects',
  'memory:recalled': 'memory-effects',
  'memory:deleted': 'memory-effects',
  'memory:superseded': 'memory-effects',
  'session:started': 'session-lifecycle',
  'session:ending': 'session-lifecycle',
  'session:ended': 'session-lifecycle',
  'index:started': 'indexing',
  'index:completed': 'indexing',
  'maintenance:cycle.started': 'maintenance',
  'maintenance:dedup.completed': 'maintenance',
  'sensory:appended': 'session-lifecycle',
};

/**
 * Publish a domain event.
 * - Emits to in-process eventBus (for SSE subscribers)
 * - Enqueues to BullMQ for durable async processing
 */
export async function publishEvent<T extends DomainEventType>(
  type: T,
  payload: Omit<EventPayloadMap[T], 'timestamp' | 'correlationId'> & { correlationId?: string }
): Promise<void> {
  const fullPayload = {
    ...payload,
    timestamp: new Date().toISOString(),
    correlationId: payload.correlationId || generateCorrelationId(),
  };

  await withSpan(
    `event:${type}`,
    {
      'event.type': type,
      'event.correlation_id': fullPayload.correlationId,
      'project.name': (payload as any).projectName || 'unknown',
    },
    async () => {
      // Emit in-process for SSE
      eventBus.publish(type as unknown as EventType, fullPayload as Record<string, unknown>);

      // Enqueue to BullMQ
      const queueName = EVENT_QUEUE_MAP[type];
      if (queueName) {
        try {
          const queue = getQueue(queueName);
          await queue.add(type, fullPayload, {
            attempts: config.EVENT_DLQ_MAX_RETRIES,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          });
        } catch (err) {
          logger.warn(`Failed to enqueue event ${type}`, { error: (err as Error).message });
        }
      }

      eventEmittedTotal.inc({ event_type: type });
    }
  );
}
