/**
 * Search tools module - codebase search, similarity search, grouped/hybrid search,
 * documentation search, and project statistics.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";
import { formatCodeResults, truncate, pct } from "../formatters.js";

/**
 * Create the search tools module with project-specific descriptions.
 */
export function createSearchTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "search_codebase",
      description: `Search the ${projectName} codebase for relevant code. Returns matching files with code snippets and relevance scores.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query for finding code",
          },
          limit: {
            type: "number",
            description: "Max results to return (default: 5)",
            default: 5,
          },
          language: {
            type: "string",
            description: "Filter by language (typescript, python, vue, etc.)",
          },
          path: {
            type: "string",
            description: "Filter by path pattern (e.g., 'src/modules/*')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "search_similar",
      description: "Find code similar to a given snippet.",
      inputSchema: {
        type: "object" as const,
        properties: {
          code: {
            type: "string",
            description: "Code snippet to find similar code for",
          },
          limit: {
            type: "number",
            description: "Max results (default: 5)",
            default: 5,
          },
        },
        required: ["code"],
      },
    },
    {
      name: "grouped_search",
      description: `Search ${projectName} codebase with results grouped by file. Returns one best match per file instead of multiple chunks.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          groupBy: {
            type: "string",
            description: "Field to group by (default: 'file')",
            default: "file",
          },
          limit: {
            type: "number",
            description: "Max groups to return (default: 10)",
            default: 10,
          },
          language: {
            type: "string",
            description: "Filter by language",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "hybrid_search",
      description: `Hybrid search combining keyword matching and semantic similarity for ${projectName}. Better for finding exact terms + related concepts.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          limit: {
            type: "number",
            description: "Max results (default: 10)",
            default: 10,
          },
          semanticWeight: {
            type: "number",
            description: "Weight for semantic vs keyword (0-1, default: 0.7)",
            default: 0.7,
          },
          language: {
            type: "string",
            description: "Filter by language",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "search_docs",
      description: `Search documentation in the ${projectName} project.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          limit: {
            type: "number",
            description: "Max results (default: 5)",
            default: 5,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_project_stats",
      description: `Get statistics about the ${projectName} codebase.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    search_codebase: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { query, limit = 5, language, path } = args as {
        query: string;
        limit?: number;
        language?: string;
        path?: string;
      };
      const response = await ctx.api.post("/api/search", {
        collection: `${ctx.collectionPrefix}codebase`,
        query,
        limit,
        filters: { language, path },
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return "No results found for this query.";
      }
      return formatCodeResults(results, 500);
    },

    search_similar: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { code, limit = 5 } = args as { code: string; limit?: number };
      const response = await ctx.api.post("/api/search-similar", {
        collection: `${ctx.collectionPrefix}codebase`,
        code,
        limit,
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return "No similar code found.";
      }
      return formatCodeResults(results, 400);
    },

    grouped_search: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { query, groupBy = "file", limit = 10, language } = args as {
        query: string;
        groupBy?: string;
        limit?: number;
        language?: string;
      };
      const response = await ctx.api.post("/api/search-grouped", {
        collection: `${ctx.collectionPrefix}codebase`,
        query,
        groupBy,
        limit,
        filters: language ? { language } : undefined,
      });
      const groups = response.data.groups;
      if (!groups || groups.length === 0) {
        return "No results found.";
      }
      return groups
        .map((g: any) => {
          const r = g.results[0];
          return (
            `**${g[groupBy]}** (score: ${pct(r.score)})\n` +
            "```" +
            (r.language || "") +
            "\n" +
            truncate(r.content, 300) +
            "\n```"
          );
        })
        .join("\n\n---\n\n");
    },

    hybrid_search: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { query, limit = 10, semanticWeight = 0.7, language } = args as {
        query: string;
        limit?: number;
        semanticWeight?: number;
        language?: string;
      };
      const response = await ctx.api.post("/api/search-hybrid", {
        collection: `${ctx.collectionPrefix}codebase`,
        query,
        limit,
        semanticWeight,
        filters: language ? { language } : undefined,
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return "No results found.";
      }
      return results
        .map(
          (r: any) =>
            `**${r.file}** (combined: ${pct(r.score)}, semantic: ${pct(r.semanticScore)}, keyword: ${pct(r.keywordScore)})\n` +
            "```" +
            (r.language || "") +
            "\n" +
            truncate(r.content, 300) +
            "\n```"
        )
        .join("\n\n---\n\n");
    },

    search_docs: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { query, limit = 5 } = args as { query: string; limit?: number };
      const response = await ctx.api.post("/api/search", {
        collection: `${ctx.collectionPrefix}docs`,
        query,
        limit,
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return "No documentation found for this query.";
      }
      return results
        .map(
          (r: any) =>
            `**${r.file}**\n` +
            truncate(r.content, 500)
        )
        .join("\n\n---\n\n");
    },

    get_project_stats: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get(
        `/api/stats/${ctx.collectionPrefix}codebase`
      );
      const stats = response.data;
      let result = `**${ctx.projectName} Project Statistics**\n\n`;
      result += `- Total Files: ${stats.totalFiles}\n`;
      result += `- Total Lines: ${stats.totalLines?.toLocaleString() || "N/A"}\n`;
      result += `- Vector Count: ${stats.vectorCount}\n`;
      result += `- Last Indexed: ${stats.lastIndexed ? new Date(stats.lastIndexed).toLocaleString() : "Never"}\n`;
      if (stats.languages) {
        result += `\n**Languages:**\n`;
        for (const [lang, count] of Object.entries(stats.languages)) {
          result += `- ${lang}: ${count} files\n`;
        }
      }
      return result;
    },
  };

  return { tools, handlers };
}
