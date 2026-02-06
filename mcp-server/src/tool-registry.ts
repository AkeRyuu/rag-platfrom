/**
 * Tool Registry - Registration and dispatch for tool modules.
 */

import type { ToolDefinition, ToolHandler, ToolModule, ToolContext } from "./types.js";
import type { ContextEnricher } from "./context-enrichment.js";

/** Tools that should NOT be tracked (meta/admin tools, avoid recursive tracking) */
const TRACKING_EXCLUDE = new Set([
  "get_tool_analytics",
  "get_knowledge_gaps",
  "analyze_usage_patterns",
  "get_behavior_patterns",
  "get_quality_metrics",
  "get_cache_stats",
  "get_prediction_stats",
  "get_rag_guidelines",
]);

/** Summarize tool args into a short string for analytics */
function summarizeInput(name: string, args: Record<string, unknown>): string {
  // Common patterns: query, question, content, feature, code, file
  const q = args.query || args.question || args.feature || args.description || args.task || "";
  if (q && typeof q === "string") return q.slice(0, 200);

  const content = args.content || args.code || args.diff || "";
  if (content && typeof content === "string") return content.slice(0, 100);

  const file = args.file || args.filePath || args.currentFile || "";
  if (file && typeof file === "string") return file as string;

  // Fallback: first string arg
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v.length > 0) return v.slice(0, 150);
  }
  return name;
}

/** Count results from a tool response string */
function countResults(result: string): number {
  // Heuristic: count numbered list items, file matches, or "No results" = 0
  if (result.includes("No results") || result.includes("No matches") || result.includes("not found")) return 0;
  const numbered = result.match(/^\d+\./gm);
  if (numbered) return numbered.length;
  const bullets = result.match(/^[-*] /gm);
  if (bullets) return bullets.length;
  return 1;
}

export class ToolRegistry {
  private tools: ToolDefinition[] = [];
  private handlers = new Map<string, ToolHandler>();
  private enricher?: ContextEnricher;

  /** Set the context enricher */
  setEnricher(enricher: ContextEnricher): void {
    this.enricher = enricher;
  }

  /** Register a tool module */
  register(module: ToolModule): void {
    this.tools.push(...module.tools);
    for (const [name, handler] of Object.entries(module.handlers)) {
      this.handlers.set(name, handler);
    }
  }

  /** Get all registered tool definitions */
  getTools(): ToolDefinition[] {
    return this.tools;
  }

  /** Fire-and-forget usage tracking */
  private trackUsage(
    name: string,
    args: Record<string, unknown>,
    startTime: number,
    success: boolean,
    result: string,
    errorMessage: string | undefined,
    ctx: ToolContext
  ): void {
    if (TRACKING_EXCLUDE.has(name)) return;

    ctx.api
      .post("/api/track-usage", {
        projectName: ctx.projectName,
        sessionId: ctx.activeSessionId,
        toolName: name,
        inputSummary: summarizeInput(name, args),
        startTime,
        resultCount: success ? countResults(result) : 0,
        success,
        errorMessage,
      })
      .catch(() => {
        // Silent — tracking must never break tool execution
      });
  }

  /** Dispatch a tool call */
  async handle(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return `Unknown tool: ${name}`;
    }

    const startTime = Date.now();

    try {
      // Before: auto-enrich context
      const contextPrefix =
        ctx.enrichmentEnabled && this.enricher
          ? await this.enricher.before(name, args, ctx)
          : null;

      // Execute original handler
      const result = await handler(args, ctx);

      // After: track interaction (fire-and-forget)
      if (this.enricher) {
        this.enricher.after(name, args, result, ctx);
      }

      // Track usage (fire-and-forget)
      this.trackUsage(name, args, startTime, true, result, undefined, ctx);

      // Prepend context if available
      return contextPrefix ? contextPrefix + "\n\n" + result : result;
    } catch (error: unknown) {
      const err = error as { code?: string; response?: { status: number; data: unknown }; message?: string };
      const errorMessage = err.message || String(error);

      // Track failed usage (fire-and-forget)
      this.trackUsage(name, args, startTime, false, "", errorMessage, ctx);

      if (err.code === "ECONNREFUSED") {
        return `Error: Cannot connect to RAG API at ${ctx.api.defaults.baseURL}. Is it running?\n` +
          `Start with: cd docker && docker-compose up -d`;
      }
      if (err.response) {
        return `API Error (${err.response.status}): ${JSON.stringify(err.response.data)}`;
      }
      return `Error: ${errorMessage}`;
    }
  }
}
