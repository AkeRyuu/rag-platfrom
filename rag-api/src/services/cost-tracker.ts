/**
 * Cost Tracker — Per-agent, per-project LLM cost estimation.
 *
 * Uses token counts from llm_usage collections to calculate costs
 * based on a configurable pricing table per provider/model.
 * Prices are per 1M tokens (input/output separately).
 */

import { vectorStore } from './vector-store';
import { logger } from '../utils/logger';

export interface ModelPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

/**
 * Default pricing table. Override via COST_PRICING_JSON env var.
 * Prices as of early 2026 — update when models change.
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-6':      { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-sonnet-4-5':      { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-6':        { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-haiku-4-5':       { inputPer1M: 0.80, outputPer1M: 4.00 },
  // OpenAI
  'gpt-4-turbo-preview':    { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-4o':                 { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini':            { inputPer1M: 0.15, outputPer1M: 0.60 },
  // Ollama (local, zero cost)
  'ollama':                 { inputPer1M: 0, outputPer1M: 0 },
};

function loadPricing(): Record<string, ModelPricing> {
  const override = process.env.COST_PRICING_JSON;
  if (override) {
    try {
      return { ...DEFAULT_PRICING, ...JSON.parse(override) };
    } catch {
      logger.warn('Failed to parse COST_PRICING_JSON, using defaults');
    }
  }
  return DEFAULT_PRICING;
}

export interface CostEntry {
  provider: string;
  model: string;
  caller: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  timestamp: string;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
  byProvider: Record<string, { cost: number; tokens: number; calls: number }>;
  byModel: Record<string, { cost: number; tokens: number; calls: number }>;
  byCaller: Record<string, { cost: number; tokens: number; calls: number }>;
  period: { from: string; to: string };
}

class CostTracker {
  private pricing: Record<string, ModelPricing>;

  constructor() {
    this.pricing = loadPricing();
  }

  /**
   * Calculate cost for a single LLM call.
   */
  calculateCost(provider: string, model: string, promptTokens: number, completionTokens: number): {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  } {
    // For Ollama, any model is free
    if (provider === 'ollama') {
      return { inputCost: 0, outputCost: 0, totalCost: 0 };
    }

    const pricing = this.pricing[model] || this.pricing[provider];
    if (!pricing) {
      return { inputCost: 0, outputCost: 0, totalCost: 0 };
    }

    const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;

    return {
      inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,  // 6 decimal places
      outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
      totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
    };
  }

  /**
   * Get cost summary for a project over a time period.
   * Reads from {project}_llm_usage collection populated by llm-usage-logger.
   */
  async getCostSummary(projectName: string, days: number = 7): Promise<CostSummary> {
    const collectionName = `${projectName}_llm_usage`;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const now = new Date().toISOString();

    const summary: CostSummary = {
      totalCost: 0,
      totalTokens: 0,
      totalCalls: 0,
      byProvider: {},
      byModel: {},
      byCaller: {},
      period: { from: cutoff, to: now },
    };

    try {
      let offset: string | number | undefined = undefined;
      let scanned = 0;

      do {
        const response = await vectorStore['client'].scroll(collectionName, {
          limit: 1000,
          offset,
          with_payload: true,
          with_vector: false,
        });

        for (const point of response.points) {
          const entry = point.payload as Record<string, unknown>;
          const ts = entry.timestamp as string;
          if (ts < cutoff) continue;

          const provider = (entry.provider as string) || 'unknown';
          const model = (entry.model as string) || 'unknown';
          const caller = (entry.caller as string) || 'unknown';
          const promptTokens = (entry.promptTokens as number) || 0;
          const completionTokens = (entry.completionTokens as number) || 0;
          const totalTokens = (entry.totalTokens as number) || 0;

          const { inputCost, outputCost, totalCost } = this.calculateCost(
            provider, model, promptTokens, completionTokens
          );

          summary.totalCost += totalCost;
          summary.totalTokens += totalTokens;
          summary.totalCalls++;

          // By provider
          if (!summary.byProvider[provider]) {
            summary.byProvider[provider] = { cost: 0, tokens: 0, calls: 0 };
          }
          summary.byProvider[provider].cost += totalCost;
          summary.byProvider[provider].tokens += totalTokens;
          summary.byProvider[provider].calls++;

          // By model
          if (!summary.byModel[model]) {
            summary.byModel[model] = { cost: 0, tokens: 0, calls: 0 };
          }
          summary.byModel[model].cost += totalCost;
          summary.byModel[model].tokens += totalTokens;
          summary.byModel[model].calls++;

          // By caller
          if (!summary.byCaller[caller]) {
            summary.byCaller[caller] = { cost: 0, tokens: 0, calls: 0 };
          }
          summary.byCaller[caller].cost += totalCost;
          summary.byCaller[caller].tokens += totalTokens;
          summary.byCaller[caller].calls++;
        }

        scanned += response.points.length;
        offset = response.next_page_offset as string | number | undefined;
      } while (offset && scanned < 50000);

      // Round totals
      summary.totalCost = Math.round(summary.totalCost * 1_000_000) / 1_000_000;
      for (const bucket of [summary.byProvider, summary.byModel, summary.byCaller]) {
        for (const key of Object.keys(bucket)) {
          bucket[key].cost = Math.round(bucket[key].cost * 1_000_000) / 1_000_000;
        }
      }

      return summary;
    } catch (error: any) {
      if (error.status === 404) {
        // Collection doesn't exist yet — no usage data
        return summary;
      }
      logger.error('Cost summary failed', { error: error.message, projectName });
      throw error;
    }
  }

  /**
   * Get the current pricing table.
   */
  getPricing(): Record<string, ModelPricing> {
    return { ...this.pricing };
  }
}

export const costTracker = new CostTracker();
