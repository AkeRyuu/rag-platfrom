/**
 * Event Bus — Centralized event system for SSE streaming.
 *
 * Bridges internal events (work status changes, indexing progress,
 * agent steps) to SSE clients via a typed EventEmitter.
 */

import { EventEmitter } from 'events';

export type EventType =
  | 'work:registered'
  | 'work:updated'
  | 'work:completed'
  | 'work:failed'
  | 'work:cancelled'
  | 'index:progress'
  | 'agent:step'
  | 'heartbeat:stale'
  | 'tribunal:framing'
  | 'tribunal:argument'
  | 'tribunal:rebuttal'
  | 'tribunal:verdict'
  | 'tribunal:completed'
  | 'tribunal:failed';

export interface BusEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Publish an event to all SSE subscribers.
   */
  publish(type: EventType, data: Record<string, unknown>): void {
    const event: BusEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.emit('event', event);
    this.emit(type, event);
  }
}

export const eventBus = new EventBus();
