/**
 * Search tools module - codebase search, similarity search, grouped/hybrid search,
 * documentation search, and project statistics.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";
import { formatCodeResults, formatNavigationResults, truncate, pct } from "../formatters.js";

/**
 * Create the search tools module with project-specific descriptions.
 */
export function createSearchTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "search_codebase",
      description: `Search the ${projectName} codebase. Returns file locations, symbols, and graph connections. Use Read tool to view the actual code at returned locations.`,
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
      description: `Search ${projectName} codebase grouped by file. Returns file locations with symbols and connections. Use Read tool to view the actual code.`,
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
      description: `Hybrid search combining keyword matching and semantic similarity for ${projectName}. Returns file locations with symbols and connections. Use Read tool to view code.`,
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
      name: "find_symbol",
      description: `Find a function, class, type, or interface by name in ${projectName}. Fast symbol lookup without full-text search.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: {
            type: "string",
            description: "Symbol name to find (function, class, type, etc.)",
          },
          kind: {
            type: "string",
            description: "Filter by kind: function, class, interface, type, enum, const",
          },
          limit: {
            type: "number",
            description: "Max results (default: 10)",
            default: 10,
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "search_graph",
      description: `Search ${projectName} codebase with graph expansion. Returns file locations plus connected files via import/call relationships. Use Read tool to view code.`,
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
        mode: "navigate",
        filters: { language, path, layer, service },
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return "No results found for this query.";
      }
      return formatNavigationResults(results);
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
        mode: "navigate",
        filters: hasFilters ? filters : undefined,
      });
      const groups = response.data.groups;
      if (!groups || groups.length === 0) {
        return "No results found.";
      }
      const allResults = groups.flatMap((g: any) => g.results);
      return formatNavigationResults(allResults);
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
        mode: "navigate",
        filters: hasFilters ? filters : undefined,
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return "No results found.";
      }
      return formatNavigationResults(results);
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

    find_symbol: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { symbol, kind, limit = 10 } = args as {
        symbol: string;
        kind?: string;
        limit?: number;
      };
      const response = await ctx.api.post("/api/find-symbol", {
        projectName: ctx.projectName,
        symbol,
        kind,
        limit,
      });
      const results = response.data.results;
      if (!results || results.length === 0) {
        return `No symbol "${symbol}" found.`;
      }
      return results
        .map(
          (r: any) =>
            `**${r.kind} ${r.name}** in \`${r.file}\` (lines ${r.startLine}-${r.endLine})\n` +
            `\`${truncate(r.signature, 150)}\`` +
            (r.exports ? " _(exported)_" : "")
        )
        .join("\n\n");
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
        mode: "navigate",
      });
      const { results, graphExpanded, expandedFiles } = response.data;

      if ((!results || results.length === 0) && (!graphExpanded || graphExpanded.length === 0)) {
        return "No results found.";
      }

      let output = "";

      if (results && results.length > 0) {
        output += "**Direct matches:**\n\n";
        output += formatNavigationResults(results);
      }

      if (graphExpanded && graphExpanded.length > 0) {
        output += "\n\n---\n\n**Graph-connected files:**\n\n";
        output += formatNavigationResults(graphExpanded);
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
