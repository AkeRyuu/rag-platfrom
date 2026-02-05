/**
 * Analytics tools module - tool analytics, knowledge gaps, collection analytics,
 * backups, and quantization.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";
import { pct } from "../formatters.js";

/**
 * Create the analytics tools module with project-specific descriptions.
 */
export function createAnalyticsTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "get_tool_analytics",
      description: `Get tool usage analytics for ${projectName}. Shows call counts, success rates, and performance.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "get_knowledge_gaps",
      description: `Get knowledge gaps for ${projectName}. Shows queries that returned few or no results.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "get_analytics",
      description: `Get detailed analytics for a ${projectName} collection. Shows vectors, storage, language breakdown, and more.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          collectionName: {
            type: "string",
            description: "Collection name to get analytics for (e.g., 'codebase', 'docs', 'memory')",
          },
        },
        required: ["collectionName"],
      },
    },
    {
      name: "backup_collection",
      description: `Create a backup snapshot of a ${projectName} collection.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          collectionName: {
            type: "string",
            description: "Collection name to backup",
          },
        },
        required: ["collectionName"],
      },
    },
    {
      name: "list_backups",
      description: `List backup snapshots for a ${projectName} collection.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          collectionName: {
            type: "string",
            description: "Collection name to list backups for",
          },
        },
        required: ["collectionName"],
      },
    },
    {
      name: "enable_quantization",
      description: `Enable scalar quantization on a ${projectName} collection to reduce memory usage.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          collectionName: {
            type: "string",
            description: "Collection name to enable quantization on",
          },
          quantile: {
            type: "number",
            description: "Quantile for quantization (0-1, default: 0.99)",
            default: 0.99,
          },
        },
        required: ["collectionName"],
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    get_tool_analytics: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get("/api/tool-analytics");
      const data = response.data;

      let result = `## Tool Analytics\n\n`;
      result += `- **Total Calls:** ${data.totalCalls ?? "N/A"}\n`;
      result += `- **Success Rate:** ${data.successRate !== undefined ? pct(data.successRate) : "N/A"}\n`;
      result += `- **Avg Duration:** ${data.avgDuration ? data.avgDuration + "ms" : "N/A"}\n\n`;

      if (data.topTools && data.topTools.length > 0) {
        result += `### Top Tools\n`;
        for (const t of data.topTools) {
          result += `- **${t.name}**: ${t.calls} calls`;
          if (t.avgDuration) result += ` (avg ${t.avgDuration}ms)`;
          result += "\n";
        }
        result += "\n";
      }

      if (data.errorsByTool && Object.keys(data.errorsByTool).length > 0) {
        result += `### Errors by Tool\n`;
        for (const [tool, count] of Object.entries(data.errorsByTool)) {
          result += `- **${tool}**: ${count} errors\n`;
        }
      }

      return result;
    },

    get_knowledge_gaps: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get("/api/knowledge-gaps");
      const data = response.data;
      const queries = data.queries || data.gaps || data;

      if (!queries || (Array.isArray(queries) && queries.length === 0)) {
        return "No knowledge gaps identified.";
      }

      let result = `## Knowledge Gaps\n\n`;
      result += `Queries with low or no results:\n\n`;
      for (const q of Array.isArray(queries) ? queries : []) {
        result += `- **"${q.query}"**`;
        if (q.count) result += ` (${q.count} times)`;
        if (q.avgResultCount !== undefined) result += ` - avg results: ${q.avgResultCount}`;
        if (q.toolName) result += ` [${q.toolName}]`;
        result += "\n";
      }

      return result;
    },

    get_analytics: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { collectionName } = args as { collectionName: string };
      const fullName = collectionName.startsWith(ctx.collectionPrefix)
        ? collectionName
        : `${ctx.collectionPrefix}${collectionName}`;
      const response = await ctx.api.get(`/api/analytics/${fullName}`);
      const data = response.data;

      let result = `## Collection Analytics: ${collectionName}\n\n`;
      result += `- **Vectors:** ${data.vectorCount ?? data.vectors ?? "N/A"}\n`;
      result += `- **Files:** ${data.totalFiles ?? data.files ?? "N/A"}\n`;
      result += `- **Segments:** ${data.segments ?? "N/A"}\n`;
      result += `- **Optimizer:** ${data.optimizerStatus || data.optimizer || "N/A"}\n`;
      result += `- **Quantization:** ${data.quantization || "none"}\n`;
      result += `- **RAM Usage:** ${data.ramUsage || "N/A"}\n`;
      result += `- **Disk Usage:** ${data.diskUsage || "N/A"}\n`;

      if (data.languages && Object.keys(data.languages).length > 0) {
        result += `\n### Language Breakdown\n`;
        for (const [lang, count] of Object.entries(data.languages)) {
          result += `- ${lang}: ${count} files\n`;
        }
      }

      result += `\n- **Last Indexed:** ${data.lastIndexed ? new Date(data.lastIndexed).toLocaleString() : "Never"}\n`;

      return result;
    },

    backup_collection: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { collectionName } = args as { collectionName: string };
      const fullName = collectionName.startsWith(ctx.collectionPrefix)
        ? collectionName
        : `${ctx.collectionPrefix}${collectionName}`;
      const response = await ctx.api.post(
        `/api/collections/${fullName}/snapshots`
      );
      const data = response.data;

      let result = `## Backup Created\n\n`;
      result += `- **Collection:** ${fullName}\n`;
      result += `- **Snapshot:** ${data.name || data.snapshotName || "N/A"}\n`;
      result += `- **Created:** ${data.createdAt ? new Date(data.createdAt).toLocaleString() : new Date().toLocaleString()}\n`;

      return result;
    },

    list_backups: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { collectionName } = args as { collectionName: string };
      const fullName = collectionName.startsWith(ctx.collectionPrefix)
        ? collectionName
        : `${ctx.collectionPrefix}${collectionName}`;
      const response = await ctx.api.get(
        `/api/collections/${fullName}/snapshots`
      );
      const snapshots = response.data.snapshots || response.data;

      if (!snapshots || snapshots.length === 0) {
        return `No backups found for ${fullName}.`;
      }

      let result = `## Backups: ${fullName}\n\n`;
      for (const s of snapshots) {
        const sizeMB = s.size ? (s.size / (1024 * 1024)).toFixed(2) : "?";
        result += `- **${s.name}** - ${sizeMB} MB`;
        if (s.createdAt) result += ` (${new Date(s.createdAt).toLocaleString()})`;
        result += "\n";
      }

      return result;
    },

    enable_quantization: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { collectionName, quantile = 0.99 } = args as {
        collectionName: string;
        quantile?: number;
      };
      const fullName = collectionName.startsWith(ctx.collectionPrefix)
        ? collectionName
        : `${ctx.collectionPrefix}${collectionName}`;
      const response = await ctx.api.post(
        `/api/collections/${fullName}/quantization`,
        { quantile }
      );
      const data = response.data;

      let result = `## Quantization Enabled\n\n`;
      result += `- **Collection:** ${fullName}\n`;
      result += `- **Quantile:** ${quantile}\n`;
      result += `- **Expected Reduction:** ${data.expectedReduction || "~4x memory reduction"}\n`;

      return result;
    },
  };

  return { tools, handlers };
}
