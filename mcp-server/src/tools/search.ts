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
          layer: {
            type: "string",
            description: "Filter by architectural layer (api, service, util, model, middleware, test, parser, types, config, other)",
          },
          service: {
            type: "string",
            description: "Filter by service/class name (e.g., 'EmbeddingService')",
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
          layer: {
            type: "string",
            description: "Filter by architectural layer (api, service, util, etc.)",
          },
          service: {
            type: "string",
            description: "Filter by service/class name",
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
          layer: {
            type: "string",
            description: "Filter by architectural layer (api, service, util, etc.)",
          },
          service: {
            type: "string",
            description: "Filter by service/class name",
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
    {
      name: "search_graph",
      description: `Search ${projectName} codebase with graph expansion. Finds semantically similar code plus connected files via import/call relationships.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          limit: {
            type: "number",
            description: "Max direct results (default: 5)",
            default: 5,
          },
          expandHops: {
            type: "number",
            description: "Number of graph hops to expand (default: 1)",
            default: 1,
          },
        },
        required: ["query"],
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    search_codebase: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { query, limit = 5, language, path, layer, service } = args as {
        query: string;
        limit?: number;
        language?: string;
        path?: string;
        layer?: string;
        service?: string;
      };
      const response = await ctx.api.post("/api/search", {
        collection: `${ctx.collectionPrefix}codebase`,
        query,
        limit,
        filters: { language, path, layer, service },
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
      const { query, groupBy = "file", limit = 10, language, layer, service } = args as {
        query: string;
        groupBy?: string;
        limit?: number;
        language?: string;
        layer?: string;
        service?: string;
      };
      const filters: Record<string, string | undefined> = { language, layer, service };
      const hasFilters = Object.values(filters).some(v => v !== undefined);
      const response = await ctx.api.post("/api/search-grouped", {
        collection: `${ctx.collectionPrefix}codebase`,
        query,
        groupBy,
        limit,
        filters: hasFilters ? filters : undefined,
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
      const { query, limit = 10, semanticWeight = 0.7, language, layer, service } = args as {
        query: string;
        limit?: number;
        semanticWeight?: number;
        language?: string;
        layer?: string;
        service?: string;
      };
      const filters: Record<string, string | undefined> = { language, layer, service };
      const hasFilters = Object.values(filters).some(v => v !== undefined);
      const response = await ctx.api.post("/api/search-hybrid", {
        collection: `${ctx.collectionPrefix}codebase`,
        query,
        limit,
        semanticWeight,
        filters: hasFilters ? filters : undefined,
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return "No results found.";
      }
      return results
        .map(
          (r: any) =>
            `**${r.file}** (combined: ${pct(r.score)}${r.semanticScore != null ? `, semantic: ${pct(r.semanticScore)}` : ''}${r.keywordScore != null ? `, keyword: ${pct(r.keywordScore)}` : ''})\n` +
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

    search_graph: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { query, limit = 5, expandHops = 1 } = args as {
        query: string;
        limit?: number;
        expandHops?: number;
      };
      const response = await ctx.api.post("/api/search-graph", {
        collection: `${ctx.collectionPrefix}codebase`,
        query,
        limit,
        expandHops,
      });
      const { results, graphExpanded, expandedFiles } = response.data;

      let output = "";

      if (results && results.length > 0) {
        output += "**Direct matches:**\n\n";
        output += results
          .map(
            (r: any) =>
              `**${r.file}** (score: ${pct(r.score)})\n` +
              "```" + (r.language || "") + "\n" +
              truncate(r.content, 300) + "\n```"
          )
          .join("\n\n");
      }

      if (graphExpanded && graphExpanded.length > 0) {
        output += "\n\n---\n\n**Graph-connected files:**\n\n";
        output += graphExpanded
          .map(
            (r: any) =>
              `**${r.file}** (score: ${pct(r.score)})\n` +
              "```" + (r.language || "") + "\n" +
              truncate(r.content, 300) + "\n```"
          )
          .join("\n\n");
      }

      if (!output) {
        return "No results found.";
      }

      if (expandedFiles && expandedFiles.length > 0) {
        output += `\n\n_Graph expanded to ${expandedFiles.length} additional files._`;
      }

      return output;
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
