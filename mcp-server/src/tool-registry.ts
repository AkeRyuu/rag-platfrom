/**
 * Tool Registry - Registration and dispatch for tool modules.
 */

import type { ToolDefinition, ToolHandler, ToolModule, ToolContext } from "./types.js";

export class ToolRegistry {
  private tools: ToolDefinition[] = [];
  private handlers = new Map<string, ToolHandler>();

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

  /** Dispatch a tool call */
  async handle(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return `Unknown tool: ${name}`;
    }

    try {
      return await handler(args, ctx);
    } catch (error: unknown) {
      const err = error as { code?: string; response?: { status: number; data: unknown }; message?: string };
      if (err.code === "ECONNREFUSED") {
        return `Error: Cannot connect to RAG API at ${ctx.api.defaults.baseURL}. Is it running?\n` +
          `Start with: cd docker && docker-compose up -d`;
      }
      if (err.response) {
        return `API Error (${err.response.status}): ${JSON.stringify(err.response.data)}`;
      }
      return `Error: ${err.message || String(error)}`;
    }
  }
}
