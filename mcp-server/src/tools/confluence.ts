/**
 * Confluence tools module - search, index, status, and space listing
 * for Confluence integration.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";
import { truncate, pct } from "../formatters.js";

/**
 * Create the Confluence tools module with project-specific descriptions.
 */
export function createConfluenceTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "search_confluence",
      description: `Search indexed Confluence documentation for ${projectName}. Returns relevant pages with content snippets.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query for Confluence content",
          },
          limit: {
            type: "number",
            description: "Max results (default: 5)",
            default: 5,
          },
          spaceKey: {
            type: "string",
            description: "Filter by Confluence space key",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "index_confluence",
      description: `Index Confluence spaces/pages for ${projectName}. Requires Confluence credentials in RAG API.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          spaceKeys: {
            type: "array",
            items: { type: "string" },
            description: "Specific space keys to index (indexes all accessible if empty)",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Filter pages by labels",
          },
          maxPages: {
            type: "number",
            description: "Maximum pages to index (default: 500)",
            default: 500,
          },
          force: {
            type: "boolean",
            description: "Force re-index even if already indexed",
            default: false,
          },
        },
      },
    },
    {
      name: "get_confluence_status",
      description: "Check if Confluence integration is configured and available.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "list_confluence_spaces",
      description: "List available Confluence spaces that can be indexed.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    search_confluence: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { query, limit = 5, spaceKey } = args as {
        query: string;
        limit?: number;
        spaceKey?: string;
      };
      const response = await ctx.api.post("/api/search", {
        collection: `${ctx.collectionPrefix}confluence`,
        query,
        limit,
        filters: spaceKey ? { spaceKey } : undefined,
      });
      const results = response.data.results;

      if (!results || results.length === 0) {
        return "No Confluence results found.";
      }

      return results
        .map(
          (r: any) =>
            `### ${r.title || r.file || "Untitled"}\n` +
            `**Score:** ${pct(r.score)}` +
            (r.spaceKey ? ` | **Space:** ${r.spaceKey}` : "") +
            (r.url ? ` | [View](${r.url})` : "") +
            `\n\n${truncate(r.content || "", 600)}`
        )
        .join("\n\n---\n\n");
    },

    index_confluence: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { spaceKeys, labels, maxPages = 500, force = false } = args as {
        spaceKeys?: string[];
        labels?: string[];
        maxPages?: number;
        force?: boolean;
      };
      const response = await ctx.api.post("/api/index/confluence", {
        projectName: ctx.projectName,
        spaceKeys,
        labels,
        maxPages,
        force,
      });
      const data = response.data;

      let result = `## Confluence Indexing\n\n`;
      result += `- **Status:** ${data.status || "started"}\n`;
      result += `- **Collection:** ${data.collection || `${ctx.collectionPrefix}confluence`}\n`;
      result += `- **Options:**\n`;
      if (spaceKeys && spaceKeys.length > 0) {
        result += `  - Spaces: ${spaceKeys.join(", ")}\n`;
      }
      if (labels && labels.length > 0) {
        result += `  - Labels: ${labels.join(", ")}\n`;
      }
      result += `  - Max Pages: ${maxPages}\n`;
      result += `  - Force: ${force}\n`;

      return result;
    },

    get_confluence_status: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get("/api/confluence/status");
      const data = response.data;

      let result = `## Confluence Status\n\n`;
      result += `- **Configured:** ${data.configured ? "Yes" : "No"}\n`;
      result += `- **Message:** ${data.message || "N/A"}\n`;

      return result;
    },

    list_confluence_spaces: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get("/api/confluence/spaces");
      const spaces = response.data.spaces || response.data;

      if (!spaces || spaces.length === 0) {
        return "No Confluence spaces available.";
      }

      let result = `## Confluence Spaces\n\n`;
      for (const s of spaces) {
        result += `- **${s.key}** - ${s.name} (${s.type || "global"})\n`;
      }

      return result;
    },
  };

  return { tools, handlers };
}
