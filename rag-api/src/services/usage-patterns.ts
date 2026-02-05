/**
 * Usage Pattern Service - Analyze tool usage patterns to improve AI effectiveness
 *
 * Features:
 * - Detect repeated query patterns
 * - Identify workflow sequences (tool chains)
 * - Find efficiency opportunities
 * - Generate usage recommendations
 * - Track context switches
 */

import { vectorStore, SearchResult } from './vector-store';
import { embeddingService } from './embedding';
import { llm } from './llm';
import { usageTracker, ToolUsage, UsageStats } from './usage-tracker';
import { logger } from '../utils/logger';

export interface UsagePattern {
  id: string;
  type: 'repeated_query' | 'tool_chain' | 'context_switch' | 'efficiency_opportunity';
  description: string;
  frequency: number;
  tools: string[];
  queries?: string[];
  suggestion?: string;
  confidence: number;
}

export interface WorkflowSequence {
  tools: string[];
  count: number;
  avgDurationMs: number;
  successRate: number;
}

export interface PatternAnalysis {
  patterns: UsagePattern[];
  workflows: WorkflowSequence[];
  insights: string[];
  recommendations: string[];
}

export interface ContextSummary {
  recentTools: { tool: string; count: number }[];
  recentQueries: string[];
  activeFeatures: string[];
  suggestedNextSteps: string[];
}

class UsagePatternService {
  private getCollectionName(projectName: string): string {
    return `${projectName}_tool_usage`;
  }

  /**
   * Analyze usage patterns for a project
   */
  async analyzePatterns(projectName: string, days: number = 7): Promise<PatternAnalysis> {
    const collectionName = this.getCollectionName(projectName);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const patterns: UsagePattern[] = [];
    const workflowMap: Map<string, { count: number; totalDuration: number; successes: number }> = new Map();

    try {
      // Fetch recent usage data
      const usages: ToolUsage[] = [];
      let offset: string | number | undefined = undefined;

      do {
        const response = await vectorStore['client'].scroll(collectionName, {
          limit: 1000,
          offset,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [{
              key: 'timestamp',
              range: { gte: cutoffDate.toISOString() },
            }],
          },
        });

        for (const point of response.points) {
          usages.push(point.payload as unknown as ToolUsage);
        }

        offset = response.next_page_offset as string | number | undefined;
      } while (offset && usages.length < 5000);

      // Sort by timestamp
      usages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Detect repeated queries
      const queryGroups = this.groupSimilarQueries(usages);
      for (const [query, group] of queryGroups) {
        if (group.length >= 3) {
          patterns.push({
            id: `repeated_${query.slice(0, 20)}`,
            type: 'repeated_query',
            description: `Query "${query}" repeated ${group.length} times`,
            frequency: group.length,
            tools: [...new Set(group.map(u => u.toolName))],
            queries: [query],
            confidence: Math.min(group.length / 10, 1),
          });
        }
      }

      // Detect tool chains (sequences used together)
      const sessionGroups = this.groupBySession(usages);
      for (const sessionUsages of sessionGroups.values()) {
        // Look for sequences of 2-4 tools
        for (let len = 2; len <= 4; len++) {
          for (let i = 0; i <= sessionUsages.length - len; i++) {
            const sequence = sessionUsages.slice(i, i + len);
            const timeDiff = new Date(sequence[len - 1].timestamp).getTime() -
                            new Date(sequence[0].timestamp).getTime();

            // Only consider sequences within 5 minutes
            if (timeDiff < 5 * 60 * 1000) {
              const key = sequence.map(s => s.toolName).join('->');
              const existing = workflowMap.get(key) || { count: 0, totalDuration: 0, successes: 0 };
              existing.count++;
              existing.totalDuration += sequence.reduce((sum, s) => sum + s.durationMs, 0);
              existing.successes += sequence.every(s => s.success) ? 1 : 0;
              workflowMap.set(key, existing);
            }
          }
        }
      }

      // Convert workflow map to sequences
      const workflows: WorkflowSequence[] = Array.from(workflowMap.entries())
        .filter(([_, data]) => data.count >= 2)
        .map(([key, data]) => ({
          tools: key.split('->'),
          count: data.count,
          avgDurationMs: data.totalDuration / data.count,
          successRate: data.successes / data.count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // Detect context switches (rapid topic changes)
      const contextSwitches = this.detectContextSwitches(usages);
      for (const cs of contextSwitches) {
        patterns.push({
          id: `context_switch_${cs.count}`,
          type: 'context_switch',
          description: `Frequent context switching detected (${cs.count} times)`,
          frequency: cs.count,
          tools: cs.tools,
          confidence: Math.min(cs.count / 5, 1),
          suggestion: 'Consider grouping related tasks together',
        });
      }

      // Generate insights using LLM
      const insights = await this.generateInsights(patterns, workflows, usages);

      return {
        patterns,
        workflows,
        insights: insights.insights,
        recommendations: insights.recommendations,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return { patterns: [], workflows: [], insights: [], recommendations: [] };
      }
      throw error;
    }
  }

  /**
   * Summarize current context for the agent
   */
  async summarizeContext(projectName: string, sessionId?: string): Promise<ContextSummary> {
    const collectionName = this.getCollectionName(projectName);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const summary: ContextSummary = {
      recentTools: [],
      recentQueries: [],
      activeFeatures: [],
      suggestedNextSteps: [],
    };

    try {
      // Get recent usage
      const filter: any = {
        must: [{
          key: 'timestamp',
          range: { gte: oneHourAgo.toISOString() },
        }],
      };

      if (sessionId) {
        filter.must.push({
          key: 'sessionId',
          match: { value: sessionId },
        });
      }

      const response = await vectorStore['client'].scroll(collectionName, {
        limit: 100,
        with_payload: true,
        with_vector: false,
        filter,
      });

      const usages = (response.points.map(p => p.payload) as unknown[]) as ToolUsage[];

      // Count tool usage
      const toolCounts: Record<string, number> = {};
      const queries: string[] = [];

      for (const usage of usages) {
        toolCounts[usage.toolName] = (toolCounts[usage.toolName] || 0) + 1;
        if (usage.inputSummary) {
          queries.push(usage.inputSummary);
        }
      }

      summary.recentTools = Object.entries(toolCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tool, count]) => ({ tool, count }));

      summary.recentQueries = [...new Set(queries)].slice(0, 10);

      // Extract active features from queries
      summary.activeFeatures = this.extractFeatures(queries);

      // Suggest next steps based on patterns
      summary.suggestedNextSteps = await this.suggestNextSteps(
        projectName,
        summary.recentTools,
        summary.activeFeatures
      );

      return summary;
    } catch (error: any) {
      if (error.status === 404) {
        return summary;
      }
      throw error;
    }
  }

  /**
   * Summarize changes made during a session
   */
  async summarizeChanges(
    projectName: string,
    sessionId: string,
    options: { includeCode?: boolean } = {}
  ): Promise<{
    summary: string;
    toolsUsed: string[];
    filesAffected: string[];
    keyActions: string[];
    duration: number;
  }> {
    const collectionName = this.getCollectionName(projectName);

    try {
      const response = await vectorStore['client'].scroll(collectionName, {
        limit: 500,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [{
            key: 'sessionId',
            match: { value: sessionId },
          }],
        },
      });

      const usages = (response.points.map(p => p.payload) as unknown[]) as ToolUsage[];

      if (usages.length === 0) {
        return {
          summary: 'No activity recorded for this session',
          toolsUsed: [],
          filesAffected: [],
          keyActions: [],
          duration: 0,
        };
      }

      // Sort by timestamp
      usages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const toolsUsed = [...new Set(usages.map(u => u.toolName))];
      const filesAffected: string[] = [];

      // Extract files from metadata
      for (const usage of usages) {
        if (usage.metadata?.file) {
          filesAffected.push(usage.metadata.file as string);
        }
        if (usage.metadata?.files) {
          filesAffected.push(...(usage.metadata.files as string[]));
        }
      }

      const uniqueFiles = [...new Set(filesAffected)];

      // Calculate duration
      const firstTime = new Date(usages[0].timestamp).getTime();
      const lastTime = new Date(usages[usages.length - 1].timestamp).getTime();
      const duration = lastTime - firstTime;

      // Extract key actions
      const keyActions = usages
        .filter(u => u.success && u.resultCount > 0)
        .map(u => `${u.toolName}: ${u.inputSummary.slice(0, 100)}`)
        .slice(0, 10);

      // Generate summary with LLM
      const summaryPrompt = `Summarize the following coding session actions:\n\n` +
        `Tools used: ${toolsUsed.join(', ')}\n` +
        `Files affected: ${uniqueFiles.slice(0, 10).join(', ')}\n` +
        `Actions:\n${keyActions.join('\n')}\n\n` +
        `Write a brief 2-3 sentence summary of what was accomplished.`;

      const llmResult = await llm.complete(summaryPrompt, {
        systemPrompt: 'You are a concise technical writer. Summarize coding session activities.',
        maxTokens: 200,
        temperature: 0.3,
      });

      return {
        summary: llmResult.text,
        toolsUsed,
        filesAffected: uniqueFiles,
        keyActions,
        duration,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return {
          summary: 'No usage data found',
          toolsUsed: [],
          filesAffected: [],
          keyActions: [],
          duration: 0,
        };
      }
      throw error;
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private groupSimilarQueries(usages: ToolUsage[]): Map<string, ToolUsage[]> {
    const groups = new Map<string, ToolUsage[]>();

    for (const usage of usages) {
      const key = usage.inputSummary.toLowerCase().trim().slice(0, 100);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(usage);
    }

    return groups;
  }

  private groupBySession(usages: ToolUsage[]): Map<string, ToolUsage[]> {
    const groups = new Map<string, ToolUsage[]>();

    for (const usage of usages) {
      const key = usage.sessionId || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(usage);
    }

    // Sort each session by timestamp
    for (const group of groups.values()) {
      group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    return groups;
  }

  private detectContextSwitches(usages: ToolUsage[]): Array<{ count: number; tools: string[] }> {
    const switches: Array<{ count: number; tools: string[] }> = [];
    const sessionGroups = this.groupBySession(usages);

    for (const sessionUsages of sessionGroups.values()) {
      let switchCount = 0;
      const involvedTools = new Set<string>();
      let lastTopic = '';

      for (const usage of sessionUsages) {
        const topic = this.extractTopic(usage.inputSummary);
        if (lastTopic && topic !== lastTopic) {
          switchCount++;
          involvedTools.add(usage.toolName);
        }
        lastTopic = topic;
      }

      if (switchCount >= 3) {
        switches.push({
          count: switchCount,
          tools: [...involvedTools],
        });
      }
    }

    return switches;
  }

  private extractTopic(query: string): string {
    // Simple topic extraction - first significant word
    const words = query.toLowerCase().split(/\s+/);
    const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'of', 'with', 'how', 'what', 'where']);
    return words.find(w => w.length > 3 && !stopWords.has(w)) || 'general';
  }

  private extractFeatures(queries: string[]): string[] {
    const features = new Set<string>();
    const featurePatterns = [
      /(?:implement|add|create|build)\s+(\w+(?:\s+\w+)?)/i,
      /(?:fix|debug|resolve)\s+(\w+(?:\s+\w+)?)/i,
      /(?:update|modify|change)\s+(\w+(?:\s+\w+)?)/i,
      /(\w+)\s+(?:feature|component|service|module)/i,
    ];

    for (const query of queries) {
      for (const pattern of featurePatterns) {
        const match = query.match(pattern);
        if (match && match[1]) {
          features.add(match[1].toLowerCase());
        }
      }
    }

    return [...features].slice(0, 5);
  }

  private async suggestNextSteps(
    projectName: string,
    recentTools: { tool: string; count: number }[],
    activeFeatures: string[]
  ): Promise<string[]> {
    const suggestions: string[] = [];

    // Based on tool usage patterns
    const toolNames = recentTools.map(t => t.tool);

    if (toolNames.includes('search_codebase') && !toolNames.includes('ask_codebase')) {
      suggestions.push('Consider using ask_codebase to get contextual answers');
    }

    if (toolNames.includes('remember') && !toolNames.includes('recall')) {
      suggestions.push('Use recall to retrieve your saved memories');
    }

    if (activeFeatures.length > 0 && !toolNames.includes('get_feature_status')) {
      suggestions.push(`Check implementation status of ${activeFeatures[0]} with get_feature_status`);
    }

    if (toolNames.includes('record_adr') || toolNames.includes('record_pattern')) {
      suggestions.push('Run check_architecture to validate code against recorded patterns');
    }

    return suggestions.slice(0, 3);
  }

  private async generateInsights(
    patterns: UsagePattern[],
    workflows: WorkflowSequence[],
    usages: ToolUsage[]
  ): Promise<{ insights: string[]; recommendations: string[] }> {
    if (usages.length < 10) {
      return { insights: [], recommendations: [] };
    }

    const insights: string[] = [];
    const recommendations: string[] = [];

    // Calculate basic stats
    const totalCalls = usages.length;
    const uniqueTools = new Set(usages.map(u => u.toolName)).size;
    const avgDuration = usages.reduce((sum, u) => sum + u.durationMs, 0) / totalCalls;
    const successRate = usages.filter(u => u.success).length / totalCalls;

    // Generate insights
    if (successRate < 0.8) {
      insights.push(`Success rate is ${(successRate * 100).toFixed(0)}% - consider reviewing error patterns`);
    }

    if (avgDuration > 5000) {
      insights.push(`Average tool duration is ${(avgDuration / 1000).toFixed(1)}s - some operations may be slow`);
    }

    const repeatedPatterns = patterns.filter(p => p.type === 'repeated_query');
    if (repeatedPatterns.length > 0) {
      insights.push(`${repeatedPatterns.length} repeated query patterns detected - consider saving to memory`);
      recommendations.push('Use the remember tool to save frequently needed information');
    }

    if (workflows.length > 0) {
      const topWorkflow = workflows[0];
      insights.push(`Most common workflow: ${topWorkflow.tools.join(' → ')} (${topWorkflow.count} times)`);
    }

    const searchTools = usages.filter(u => u.toolName.includes('search'));
    if (searchTools.length > totalCalls * 0.5) {
      recommendations.push('High search usage - ensure codebase is well-indexed');
    }

    return { insights, recommendations };
  }
}

export const usagePatterns = new UsagePatternService();
export default usagePatterns;
