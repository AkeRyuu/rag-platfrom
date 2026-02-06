/**
 * Session Context Service - Manage session state and context persistence
 *
 * Features:
 * - Session lifecycle management (start, get, end)
 * - Context persistence across interactions
 * - Session summary and learnings extraction on end
 * - Cross-session context transfer
 */

import { v4 as uuidv4 } from 'uuid';
import { vectorStore, VectorPoint } from './vector-store';
import { embeddingService } from './embedding';
import { memoryService } from './memory';
import { conversationAnalyzer } from './conversation-analyzer';
import { usagePatterns } from './usage-patterns';
import { predictiveLoader } from './predictive-loader';
import { cacheService } from './cache';
import { logger } from '../utils/logger';

export interface SessionContext {
  sessionId: string;
  projectName: string;
  startedAt: string;
  lastActivityAt: string;
  status: 'active' | 'paused' | 'ended';
  // Context data
  currentFiles: string[];
  recentQueries: string[];
  activeFeatures: string[];
  toolsUsed: string[];
  // Accumulated learnings
  pendingLearnings: string[];
  decisions: string[];
  // Metadata
  metadata?: Record<string, unknown>;
}

export interface StartSessionOptions {
  projectName: string;
  sessionId?: string;
  initialContext?: string;
  resumeFrom?: string; // Previous session ID to resume from
  metadata?: Record<string, unknown>;
}

export interface EndSessionOptions {
  projectName: string;
  sessionId: string;
  summary?: string;
  autoSaveLearnings?: boolean;
  feedback?: 'productive' | 'neutral' | 'unproductive';
}

export interface SessionSummary {
  sessionId: string;
  duration: number;
  toolsUsed: string[];
  filesAffected: string[];
  queriesCount: number;
  learningsSaved: number;
  summary: string;
}

class SessionContextService {
  private getCollectionName(projectName: string): string {
    return `${projectName}_sessions`;
  }

  private getCacheKey(projectName: string, sessionId: string): string {
    return `session:${projectName}:${sessionId}`;
  }

  /**
   * Start a new session or resume existing
   */
  async startSession(options: StartSessionOptions): Promise<SessionContext> {
    const {
      projectName,
      sessionId = uuidv4(),
      initialContext,
      resumeFrom,
      metadata,
    } = options;

    let context: SessionContext;

    // Try to resume from previous session
    if (resumeFrom) {
      const previousContext = await this.getSession(projectName, resumeFrom);
      if (previousContext) {
        context = {
          sessionId,
          projectName,
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          status: 'active',
          currentFiles: previousContext.currentFiles,
          recentQueries: previousContext.recentQueries.slice(-5),
          activeFeatures: previousContext.activeFeatures,
          toolsUsed: [],
          pendingLearnings: [],
          decisions: previousContext.decisions,
          metadata: { ...previousContext.metadata, ...metadata, resumedFrom: resumeFrom },
        };
      } else {
        context = this.createNewContext(sessionId, projectName, metadata);
      }
    } else {
      context = this.createNewContext(sessionId, projectName, metadata);
    }

    // Process initial context
    if (initialContext) {
      const extracted = await conversationAnalyzer.extractEntities(initialContext);
      context.currentFiles = [...context.currentFiles, ...extracted.files];
      context.activeFeatures = [...context.activeFeatures, ...extracted.concepts];
    }

    // Store in cache for fast access
    await cacheService.set(
      this.getCacheKey(projectName, sessionId),
      context,
      3600 // 1 hour TTL
    );

    // Also persist to Qdrant for durability
    await this.persistSession(context);

    logger.info(`Session started: ${sessionId}`, { projectName, resumeFrom });

    // Background: generate predictions and prefetch likely-needed resources
    this.triggerPredictivePrefetch(context).catch(err =>
      logger.debug('Background prefetch failed', { error: err.message })
    );

    return context;
  }

  /**
   * Get current session context
   */
  async getSession(projectName: string, sessionId: string): Promise<SessionContext | null> {
    // Try cache first
    const cached = await cacheService.get<SessionContext>(
      this.getCacheKey(projectName, sessionId)
    );
    if (cached) {
      return cached;
    }

    // Fall back to Qdrant
    const collection = this.getCollectionName(projectName);
    try {
      const results = await vectorStore['client'].scroll(collection, {
        limit: 1,
        with_payload: true,
        filter: {
          must: [{ key: 'sessionId', match: { value: sessionId } }],
        },
      });

      if (results.points.length > 0) {
        const context = results.points[0].payload as unknown as SessionContext;
        // Refresh cache
        await cacheService.set(
          this.getCacheKey(projectName, sessionId),
          context,
          3600
        );
        return context;
      }
    } catch (error: any) {
      if (error.status !== 404) {
        logger.error('Failed to get session', { error: error.message });
      }
    }

    return null;
  }

  /**
   * Update session context
   */
  async updateSession(
    projectName: string,
    sessionId: string,
    updates: Partial<SessionContext>
  ): Promise<SessionContext | null> {
    const context = await this.getSession(projectName, sessionId);
    if (!context) {
      return null;
    }

    const updatedContext: SessionContext = {
      ...context,
      ...updates,
      lastActivityAt: new Date().toISOString(),
    };

    // Update cache
    await cacheService.set(
      this.getCacheKey(projectName, sessionId),
      updatedContext,
      3600
    );

    // Persist to Qdrant
    await this.persistSession(updatedContext);

    return updatedContext;
  }

  /**
   * Add activity to session (file, query, tool)
   */
  async addActivity(
    projectName: string,
    sessionId: string,
    activity: {
      type: 'file' | 'query' | 'tool' | 'learning' | 'decision';
      value: string;
    }
  ): Promise<void> {
    const context = await this.getSession(projectName, sessionId);
    if (!context) {
      logger.warn(`Session not found: ${sessionId}`);
      return;
    }

    switch (activity.type) {
      case 'file':
        if (!context.currentFiles.includes(activity.value)) {
          context.currentFiles = [...context.currentFiles, activity.value].slice(-20);
        }
        break;
      case 'query':
        context.recentQueries = [...context.recentQueries, activity.value].slice(-50);
        break;
      case 'tool':
        if (!context.toolsUsed.includes(activity.value)) {
          context.toolsUsed.push(activity.value);
        }
        break;
      case 'learning':
        context.pendingLearnings.push(activity.value);
        break;
      case 'decision':
        context.decisions.push(activity.value);
        break;
    }

    await this.updateSession(projectName, sessionId, context);

    // Background: update predictions on new activity
    this.triggerPredictivePrefetch(context).catch(err =>
      logger.debug('Background prefetch on activity failed', { error: err.message })
    );
  }

  /**
   * End a session and save learnings
   */
  async endSession(options: EndSessionOptions): Promise<SessionSummary> {
    const { projectName, sessionId, summary, autoSaveLearnings = true, feedback } = options;

    const context = await this.getSession(projectName, sessionId);
    if (!context) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Calculate duration
    const startTime = new Date(context.startedAt).getTime();
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Get usage summary
    let usageSummary: any = { toolsUsed: [], filesAffected: [], keyActions: [] };
    try {
      usageSummary = await usagePatterns.summarizeChanges(projectName, sessionId);
    } catch {
      // Ignore errors
    }

    // Save pending learnings if requested
    let learningsSaved = 0;
    if (autoSaveLearnings && context.pendingLearnings.length > 0) {
      for (const learning of context.pendingLearnings) {
        try {
          await memoryService.remember({
            projectName,
            content: learning,
            type: 'insight',
            tags: ['session', sessionId.slice(0, 8)],
            metadata: { sessionId, source: 'session_end' },
          });
          learningsSaved++;
        } catch {
          // Ignore individual failures
        }
      }
    }

    // Save decisions
    for (const decision of context.decisions) {
      try {
        await memoryService.remember({
          projectName,
          content: decision,
          type: 'decision',
          tags: ['session', sessionId.slice(0, 8)],
          metadata: { sessionId, source: 'session_end' },
        });
        learningsSaved++;
      } catch {
        // Ignore individual failures
      }
    }

    // Update session status
    await this.updateSession(projectName, sessionId, {
      status: 'ended',
      metadata: {
        ...context.metadata,
        endedAt: new Date().toISOString(),
        feedback,
        summary: summary || usageSummary.summary,
      },
    });

    // Clear from active cache
    await cacheService.delete(this.getCacheKey(projectName, sessionId));

    const result: SessionSummary = {
      sessionId,
      duration,
      toolsUsed: usageSummary.toolsUsed || context.toolsUsed,
      filesAffected: usageSummary.filesAffected || context.currentFiles,
      queriesCount: context.recentQueries.length,
      learningsSaved,
      summary: summary || usageSummary.summary || 'Session ended',
    };

    logger.info(`Session ended: ${sessionId}`, {
      duration: Math.round(duration / 1000),
      learningsSaved,
    });

    return result;
  }

  /**
   * List recent sessions for a project
   */
  async listSessions(
    projectName: string,
    options: { limit?: number; status?: 'active' | 'ended' | 'all' } = {}
  ): Promise<Array<{ sessionId: string; startedAt: string; status: string }>> {
    const { limit = 20, status = 'all' } = options;
    const collection = this.getCollectionName(projectName);

    try {
      const filter: any = { must: [] };
      if (status !== 'all') {
        filter.must.push({ key: 'status', match: { value: status } });
      }

      const results = await vectorStore['client'].scroll(collection, {
        limit,
        with_payload: true,
        filter: filter.must.length > 0 ? filter : undefined,
      });

      return results.points.map(p => ({
        sessionId: (p.payload as any).sessionId,
        startedAt: (p.payload as any).startedAt,
        status: (p.payload as any).status,
      }));
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Trigger predictive prefetch in the background (fire-and-forget)
   */
  private async triggerPredictivePrefetch(context: SessionContext): Promise<void> {
    const predictions = await predictiveLoader.predict(
      context.projectName,
      context.sessionId,
      {
        currentFiles: context.currentFiles,
        recentQueries: context.recentQueries,
        toolsUsed: context.toolsUsed,
        activeFeatures: context.activeFeatures,
      }
    );

    if (predictions.length > 0) {
      await predictiveLoader.prefetch(context.projectName, context.sessionId, predictions);
    }
  }

  private createNewContext(
    sessionId: string,
    projectName: string,
    metadata?: Record<string, unknown>
  ): SessionContext {
    return {
      sessionId,
      projectName,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: 'active',
      currentFiles: [],
      recentQueries: [],
      activeFeatures: [],
      toolsUsed: [],
      pendingLearnings: [],
      decisions: [],
      metadata,
    };
  }

  private async persistSession(context: SessionContext): Promise<void> {
    const collection = this.getCollectionName(context.projectName);

    try {
      // Create embedding from session context
      const contextText = [
        ...context.currentFiles,
        ...context.activeFeatures,
        ...context.recentQueries.slice(-5),
      ].join(' ');

      const embedding = await embeddingService.embed(
        contextText || `session ${context.sessionId}`
      );

      const point: VectorPoint = {
        id: context.sessionId,
        vector: embedding,
        payload: context as unknown as Record<string, unknown>,
      };

      await vectorStore.upsert(collection, [point]);
    } catch (error: any) {
      logger.error('Failed to persist session', { error: error.message });
    }
  }
}

export const sessionContext = new SessionContextService();
export default sessionContext;
