/**
 * Indexing tools module - codebase indexing, status, zero-downtime reindex,
 * and alias management.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";

/**
 * Create the indexing tools module with project-specific descriptions.
 */
export function createIndexingTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "index_codebase",
      description: `Index or re-index the ${projectName} codebase for RAG search.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Path to index (default: entire project)",
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
      name: "get_index_status",
      description: `Get the indexing status for ${projectName} codebase.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "reindex_zero_downtime",
      description: `Reindex ${projectName} codebase with zero downtime using alias swap.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Path to index (default: entire project)",
          },
          patterns: {
            type: "array",
            items: { type: "string" },
            description: "File patterns to include (e.g., ['**/*.ts', '**/*.py'])",
          },
          excludePatterns: {
            type: "array",
            items: { type: "string" },
            description: "File patterns to exclude (e.g., ['node_modules/**'])",
          },
        },
      },
    },
    {
      name: "list_aliases",
      description: "List all collection aliases and their mappings.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    index_codebase: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { path, force = false } = args as {
        path?: string;
        force?: boolean;
      };
      const response = await ctx.api.post("/api/index", {
        collection: `${ctx.collectionPrefix}codebase`,
        path: path || ctx.projectPath,
        force,
      });
      const data = response.data;

      let result = `## Indexing ${projectName}\n\n`;
      result += `- **Status:** ${data.status || "started"}\n`;
      result += `- **Files to process:** ${data.filesToProcess ?? "N/A"}\n`;

      return result;
    },

    get_index_status: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get(
        `/api/index/status/${ctx.collectionPrefix}codebase`
      );
      const data = response.data;

      let result = `## Index Status: ${projectName}\n\n`;
      result += `- **Status:** ${data.status || "unknown"}\n`;
      result += `- **Total Files:** ${data.totalFiles ?? "N/A"}\n`;
      result += `- **Indexed Files:** ${data.indexedFiles ?? "N/A"}\n`;
      result += `- **Last Updated:** ${data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : "Never"}\n`;
      result += `- **Vector Count:** ${data.vectorCount ?? "N/A"}\n`;

      return result;
    },

    reindex_zero_downtime: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { path, patterns, excludePatterns } = args as {
        path?: string;
        patterns?: string[];
        excludePatterns?: string[];
      };
      const response = await ctx.api.post("/api/reindex", {
        collection: `${ctx.collectionPrefix}codebase`,
        path: path || ctx.projectPath,
        patterns,
        excludePatterns,
      });
      const data = response.data;

      let result = `## Zero-Downtime Reindex: ${projectName}\n\n`;
      result += `- **Alias:** ${data.alias || "N/A"}\n`;
      result += `- **Status:** ${data.status || "started"}\n`;
      result += `- **Message:** ${data.message || "Reindex initiated"}\n`;

      return result;
    },

    list_aliases: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get("/api/aliases");
      const aliases = response.data.aliases || response.data;

      if (!aliases || (Array.isArray(aliases) && aliases.length === 0)) {
        return "No aliases configured.";
      }

      let result = `## Collection Aliases\n\n`;
      if (Array.isArray(aliases)) {
        for (const a of aliases) {
          result += `- **${a.alias}** -> ${a.collection}\n`;
        }
      } else {
        for (const [alias, collection] of Object.entries(aliases)) {
          result += `- **${alias}** -> ${collection}\n`;
        }
      }

      return result;
    },
  };

  return { tools, handlers };
}
