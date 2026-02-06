/**
 * Fact Extractor Service - Extract structured facts from agent ReAct traces.
 *
 * Parses observations (NOT thoughts) from agent task steps to extract
 * file references, patterns, and findings with provenance.
 * Facts are routed to quarantine via memoryGovernance.
 */

import { cacheService } from './cache';
import { memoryGovernance } from './memory-governance';
import { logger } from '../utils/logger';
import { agentFactsExtracted } from '../utils/metrics';
import type { AgentTask } from './agent-runtime';

export interface StructuredFact {
  content: string;
  provenance: { file: string; startLine?: number; endLine?: number };
  type: 'finding' | 'dependency' | 'pattern' | 'issue';
  confidence: number;
}

class FactExtractorService {
  /**
   * Extract structured facts from agent task observations.
   */
  async extractFacts(task: AgentTask): Promise<StructuredFact[]> {
    const facts: StructuredFact[] = [];

    for (const step of task.steps) {
      if (!step.observation?.result) continue;

      const observation = step.observation.result;

      // Extract file references from observation text
      // Pattern: [N] file/path.ts (score: X.XX)
      const fileMatches = [...observation.matchAll(/\[(\d+)\]\s+([\w./-]+\.\w+)\s*\(score:\s*([\d.]+)\)/g)];

      for (const match of fileMatches) {
        const file = match[2];
        const score = parseFloat(match[3]);

        // Extract the content block following this file reference
        const matchIndex = observation.indexOf(match[0]);
        const nextMatch = observation.indexOf('\n[', matchIndex + 1);
        const contentBlock = nextMatch > -1
          ? observation.slice(matchIndex + match[0].length, nextMatch)
          : observation.slice(matchIndex + match[0].length, matchIndex + match[0].length + 500);

        const content = contentBlock.trim().slice(0, 300);
        if (!content) continue;

        // Determine fact type from content
        const factType = this.classifyFact(content, step.observation.tool);

        facts.push({
          content: `${file}: ${content}`,
          provenance: { file },
          type: factType,
          confidence: Math.min(score, 1),
        });
      }

      // Also extract import/dependency patterns from observations
      const importMatches = [...observation.matchAll(/import\s+.*from\s+['"]([^'"]+)['"]/g)];
      for (const im of importMatches) {
        facts.push({
          content: `Dependency: ${im[0]}`,
          provenance: { file: im[1] },
          type: 'dependency',
          confidence: 0.8,
        });
      }
    }

    // Deduplicate by content
    const seen = new Set<string>();
    return facts.filter(f => {
      const key = f.content.slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Save extracted facts to quarantine and audit log to Redis.
   */
  async saveFacts(
    projectName: string,
    task: AgentTask
  ): Promise<{ factsCount: number; auditLogKey: string }> {
    const facts = await this.extractFacts(task);
    const auditLogKey = await this.saveAuditLog(projectName, task);

    let savedCount = 0;
    for (const fact of facts) {
      try {
        await memoryGovernance.ingest({
          projectName,
          content: fact.content,
          type: 'insight',
          tags: ['agent-extracted', task.type, fact.type],
          relatedTo: fact.provenance.file,
          metadata: {
            provenance: fact.provenance,
            factType: fact.type,
            agentTaskId: task.id,
            agentType: task.type,
          },
          source: 'auto_pattern',
          confidence: fact.confidence,
        });
        savedCount++;

        agentFactsExtracted.inc({
          project: projectName,
          agent_type: task.type,
          fact_type: fact.type,
        });
      } catch (error: any) {
        logger.warn(`Failed to save fact: ${error.message}`);
      }
    }

    logger.info(`Extracted ${savedCount} facts from agent task ${task.id}`, {
      project: projectName,
      agentType: task.type,
    });

    return { factsCount: savedCount, auditLogKey };
  }

  /**
   * Save audit log (actions + observations, no thoughts) to Redis with 24h TTL.
   */
  private async saveAuditLog(projectName: string, task: AgentTask): Promise<string> {
    const key = `audit:${projectName}:${task.id}`;

    const auditEntries = task.steps
      .filter(s => s.action || s.observation)
      .map(s => ({
        iteration: s.iteration,
        timestamp: s.timestamp,
        action: s.action ? { tool: s.action.tool, input: s.action.input } : undefined,
        observation: s.observation ? { tool: s.observation.tool, result: s.observation.result, truncated: s.observation.truncated } : undefined,
        // Deliberately omit s.thought
      }));

    const auditLog = {
      taskId: task.id,
      agentType: task.type,
      projectName,
      status: task.status,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      usage: task.usage,
      entries: auditEntries,
    };

    try {
      await cacheService.set(key, auditLog, 86400); // 24h TTL
    } catch (error: any) {
      logger.warn(`Failed to save audit log: ${error.message}`);
    }

    return key;
  }

  /**
   * Classify fact type from content and tool name.
   */
  private classifyFact(content: string, tool: string): StructuredFact['type'] {
    const lower = content.toLowerCase();

    if (tool === 'get_patterns' || lower.includes('pattern')) return 'pattern';
    if (tool === 'get_adrs' || lower.includes('decision')) return 'pattern';
    if (lower.includes('import') || lower.includes('require') || lower.includes('dependency')) return 'dependency';
    if (lower.includes('error') || lower.includes('bug') || lower.includes('issue') || lower.includes('todo')) return 'issue';

    return 'finding';
  }
}

export const factExtractor = new FactExtractorService();
export default factExtractor;
