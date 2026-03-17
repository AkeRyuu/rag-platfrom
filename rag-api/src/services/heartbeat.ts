/**
 * Heartbeat Detection — Detect and abort stale long-running operations.
 *
 * Monitors the WorkRegistry for items that haven't updated recently.
 * If a work item's `updatedAt` is older than the stale threshold,
 * it gets cancelled automatically.
 *
 * Default: check every 15s, stale after 120s of no updates.
 */

import { workRegistry } from './work-handler';
import { logger } from '../utils/logger';

const CHECK_INTERVAL_MS = parseInt(process.env.HEARTBEAT_CHECK_MS || '15000', 10);
const STALE_THRESHOLD_MS = parseInt(process.env.HEARTBEAT_STALE_MS || '120000', 10);

class HeartbeatMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /**
   * Start the heartbeat monitor.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.timer.unref(); // Don't keep process alive

    logger.info('Heartbeat monitor started', {
      checkIntervalMs: CHECK_INTERVAL_MS,
      staleThresholdMs: STALE_THRESHOLD_MS,
    });
  }

  /**
   * Stop the heartbeat monitor.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /**
   * Run a single heartbeat check.
   */
  check(): { stale: string[]; cancelled: string[] } {
    const now = Date.now();
    const running = workRegistry.list({ state: 'running' });
    const stale: string[] = [];
    const cancelled: string[] = [];

    for (const item of running) {
      const lastUpdate = new Date(item.updatedAt).getTime();
      const age = now - lastUpdate;

      if (age > STALE_THRESHOLD_MS) {
        stale.push(item.id);

        const didCancel = workRegistry.cancel(item.id);
        if (didCancel) {
          cancelled.push(item.id);
          logger.warn('Heartbeat: cancelled stale work item', {
            id: item.id,
            type: item.type,
            projectName: item.projectName,
            staleMs: age,
            description: item.description,
          });
        }
      }
    }

    if (stale.length > 0) {
      logger.info('Heartbeat check', { stale: stale.length, cancelled: cancelled.length });
    }

    return { stale, cancelled };
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig() {
    return {
      running: this.running,
      checkIntervalMs: CHECK_INTERVAL_MS,
      staleThresholdMs: STALE_THRESHOLD_MS,
    };
  }
}

export const heartbeatMonitor = new HeartbeatMonitor();
