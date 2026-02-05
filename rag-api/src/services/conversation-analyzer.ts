/**
 * Conversation Analyzer Service - Auto-learning from Claude interactions
 *
 * Analyzes conversations to extract:
 * - Decisions made
 * - Insights discovered
 * - Patterns identified
 * - Entities mentioned (files, functions, concepts)
 */

import { llm } from './llm';
import { memoryService, MemoryType } from './memory';
import { logger } from '../utils/logger';

export interface ExtractedLearning {
  type: MemoryType;
  content: string;
  tags: string[];
  relatedTo?: string;
  confidence: number;
  reasoning: string;
}

export interface ConversationAnalysis {
  learnings: ExtractedLearning[];
  entities: {
    files: string[];
    functions: string[];
    concepts: string[];
  };
  summary: string;
}

export interface AnalyzeOptions {
  projectName: string;
  conversation: string;
  context?: string;
  autoSave?: boolean;
  minConfidence?: number;
}

const ANALYSIS_PROMPT = `Analyze this conversation between a developer and AI assistant. Extract valuable learnings that should be remembered for future sessions.

For each learning, provide:
- type: One of "decision", "insight", "context", "note", "workaround", "pattern"
- content: The actual learning (concise but complete)
- tags: Relevant tags for categorization
- relatedTo: Related feature/module if applicable
- confidence: 0-1 score of how valuable this learning is
- reasoning: Why this should be remembered

Also extract:
- files: File paths mentioned
- functions: Function/class names mentioned
- concepts: Technical concepts discussed

Return JSON:
{
  "learnings": [...],
  "entities": { "files": [], "functions": [], "concepts": [] },
  "summary": "Brief summary of the conversation"
}

Focus on:
1. Architectural decisions made
2. Bug fixes and their root causes
3. Code patterns established
4. Workarounds for issues
5. Important context about the codebase
6. Explanations of how things work

Ignore:
- Generic coding advice
- Obvious statements
- Temporary debugging steps`;

class ConversationAnalyzerService {
  /**
   * Analyze a conversation and extract learnings
   */
  async analyze(options: AnalyzeOptions): Promise<ConversationAnalysis> {
    const {
      projectName,
      conversation,
      context = '',
      autoSave = false,
      minConfidence = 0.6,
    } = options;

    try {
      const contextPrefix = context ? `Context: ${context}\n\n` : '';
      const prompt = `${contextPrefix}Conversation:\n${conversation}`;

      const result = await llm.complete(prompt, {
        systemPrompt: ANALYSIS_PROMPT,
        maxTokens: 2000,
        temperature: 0.3,
      });

      let analysis: ConversationAnalysis;
      try {
        analysis = JSON.parse(result.text);
      } catch {
        logger.warn('Failed to parse analysis result, using defaults');
        analysis = {
          learnings: [],
          entities: { files: [], functions: [], concepts: [] },
          summary: result.text.slice(0, 200),
        };
      }

      // Filter by confidence
      analysis.learnings = analysis.learnings.filter(l => l.confidence >= minConfidence);

      // Auto-save if requested
      if (autoSave && analysis.learnings.length > 0) {
        await this.saveLearnings(projectName, analysis.learnings);
      }

      logger.info(`Analyzed conversation: ${analysis.learnings.length} learnings extracted`, {
        projectName,
        entities: analysis.entities,
      });

      return analysis;
    } catch (error: any) {
      logger.error('Conversation analysis failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Save extracted learnings to memory
   */
  async saveLearnings(projectName: string, learnings: ExtractedLearning[]): Promise<string[]> {
    const savedIds: string[] = [];

    for (const learning of learnings) {
      try {
        const memory = await memoryService.remember({
          projectName,
          content: learning.content,
          type: this.mapLearningType(learning.type),
          tags: [...learning.tags, 'auto-extracted'],
          relatedTo: learning.relatedTo,
          metadata: {
            source: 'auto_conversation',
            confidence: learning.confidence,
            reasoning: learning.reasoning,
            validated: false,
          },
        });
        savedIds.push(memory.id);
      } catch (error: any) {
        logger.warn(`Failed to save learning: ${error.message}`);
      }
    }

    logger.info(`Saved ${savedIds.length} learnings to memory`, { projectName });
    return savedIds;
  }

  /**
   * Map learning type to valid MemoryType
   */
  private mapLearningType(type: string): MemoryType {
    const mapping: Record<string, MemoryType> = {
      decision: 'decision',
      insight: 'insight',
      context: 'context',
      note: 'note',
      workaround: 'insight',
      pattern: 'context',
      todo: 'todo',
      conversation: 'conversation',
    };
    return mapping[type] || 'note';
  }

  /**
   * Quick extraction of just the entities from text
   */
  async extractEntities(text: string): Promise<{
    files: string[];
    functions: string[];
    concepts: string[];
  }> {
    // Simple regex-based extraction for speed
    const files = [...text.matchAll(/(?:[\w/-]+\/)?[\w-]+\.(ts|js|tsx|jsx|py|go|rs|vue|json|yaml|yml|md)/g)]
      .map(m => m[0])
      .filter((v, i, a) => a.indexOf(v) === i);

    const functions = [...text.matchAll(/(?:function|const|class|def|func)\s+(\w+)/g)]
      .map(m => m[1])
      .filter((v, i, a) => a.indexOf(v) === i);

    // Extract PascalCase and camelCase identifiers as potential concepts
    const concepts = [...text.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g)]
      .map(m => m[1])
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 10);

    return { files, functions, concepts };
  }
}

export const conversationAnalyzer = new ConversationAnalyzerService();
export default conversationAnalyzer;
