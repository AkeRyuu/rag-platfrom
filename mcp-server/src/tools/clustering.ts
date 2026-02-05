/**
 * Clustering tools module - code clustering, duplicate detection,
 * similarity recommendations, and learning extraction.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";
import { truncate, pct, PREVIEW } from "../formatters.js";

/**
 * Create the clustering tools module with project-specific descriptions.
 */
export function createClusteringTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "cluster_code",
      description: `Cluster code in the ${projectName} codebase by similarity. Groups related files around seed points.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          seedIds: {
            type: "array",
            items: { type: "string" },
            description: "Seed point IDs to cluster around",
          },
          limit: {
            type: "number",
            description: "Max results per cluster (default: 5)",
            default: 5,
          },
          threshold: {
            type: "number",
            description: "Minimum similarity threshold (0-1, default: 0.7)",
            default: 0.7,
          },
        },
        required: ["seedIds"],
      },
    },
    {
      name: "find_duplicates",
      description: `Find duplicate or near-duplicate code in ${projectName}. Groups similar files by content.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          collection: {
            type: "string",
            description: "Collection to search (default: codebase)",
          },
          limit: {
            type: "number",
            description: "Max duplicate groups to return (default: 10)",
            default: 10,
          },
          threshold: {
            type: "number",
            description: "Minimum similarity threshold (0-1, default: 0.9)",
            default: 0.9,
          },
        },
      },
    },
    {
      name: "recommend_similar",
      description: `Recommend similar code based on positive and negative examples in ${projectName}.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          positiveIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of vectors to find similar code to",
          },
          negativeIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of vectors to avoid (dissimilar)",
          },
          limit: {
            type: "number",
            description: "Max results (default: 5)",
            default: 5,
          },
        },
        required: ["positiveIds"],
      },
    },
    {
      name: "extract_learnings",
      description: `Extract learnings and insights from text for ${projectName}. Identifies decisions, patterns, and concepts.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Text to extract learnings from",
          },
          context: {
            type: "string",
            description: "Additional context about the text",
          },
          autoSave: {
            type: "boolean",
            description: "Automatically save extracted learnings (default: false)",
            default: false,
          },
          minConfidence: {
            type: "number",
            description: "Minimum confidence threshold (0-1, default: 0.7)",
            default: 0.7,
          },
        },
        required: ["text"],
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    cluster_code: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { seedIds, limit = 5, threshold = 0.7 } = args as {
        seedIds: string[];
        limit?: number;
        threshold?: number;
      };
      const response = await ctx.api.post("/api/clusters", {
        collection: `${ctx.projectName}_codebase`,
        seedIds,
        limit,
        threshold,
      });
      const data = response.data;
      const clusters = data.clusters || data;

      if (!clusters || (Array.isArray(clusters) && clusters.length === 0)) {
        return "No clusters found.";
      }

      let result = `## Code Clusters\n\n`;
      for (const cluster of Array.isArray(clusters) ? clusters : [clusters]) {
        result += `### Seed: ${cluster.seedId || cluster.seed || "unknown"}\n`;
        const files = cluster.similar || cluster.files || cluster.results || [];
        for (const f of files) {
          result += `- **${f.file || f.name}** (${pct(f.score || f.similarity)})`;
          if (f.content) result += `\n  ${truncate(f.content, PREVIEW.SHORT)}`;
          result += "\n";
        }
        result += "\n";
      }

      return result;
    },

    find_duplicates: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { collection, limit = 10, threshold = 0.9 } = args as {
        collection?: string;
        limit?: number;
        threshold?: number;
      };
      const fullCollection = collection
        ? (collection.startsWith(ctx.collectionPrefix) ? collection : `${ctx.collectionPrefix}${collection}`)
        : `${ctx.collectionPrefix}codebase`;
      const response = await ctx.api.post("/api/duplicates", {
        collection: fullCollection,
        limit,
        threshold,
      });
      const data = response.data;
      const groups = data.groups || data.duplicates || data;

      if (!groups || (Array.isArray(groups) && groups.length === 0)) {
        return "No duplicates found.";
      }

      let result = `## Duplicate Code Groups\n\n`;
      let groupNum = 1;
      for (const group of Array.isArray(groups) ? groups : [groups]) {
        result += `### Group ${groupNum++}\n`;
        const files = group.files || group.items || group.results || [];
        const similarity = group.similarity || group.score;
        if (similarity) {
          result += `**Similarity:** ${pct(similarity)}\n`;
        }
        for (const f of files) {
          result += `- **${f.file || f.name}**`;
          if (f.content) result += `\n  ${truncate(f.content, 80)}`;
          result += "\n";
        }
        result += "\n";
      }

      return result;
    },

    recommend_similar: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { positiveIds, negativeIds, limit = 5 } = args as {
        positiveIds: string[];
        negativeIds?: string[];
        limit?: number;
      };
      const response = await ctx.api.post("/api/recommend", {
        collection: `${ctx.projectName}_codebase`,
        positiveIds,
        negativeIds,
        limit,
      });
      const results = response.data.results || response.data;

      if (!results || results.length === 0) {
        return "No recommendations found.";
      }

      let result = `## Recommendations\n\n`;
      for (const r of results) {
        result += `- **${r.file || r.name}** (${pct(r.score || r.similarity)})`;
        if (r.content) result += `\n  ${truncate(r.content, PREVIEW.SHORT)}`;
        result += "\n";
      }

      return result;
    },

    extract_learnings: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { text, context, autoSave = false, minConfidence = 0.7 } = args as {
        text: string;
        context?: string;
        autoSave?: boolean;
        minConfidence?: number;
      };
      const response = await ctx.api.post("/api/memory/extract", {
        projectName: ctx.projectName,
        text,
        context,
        autoSave,
        minConfidence,
      });
      const data = response.data;

      let result = `## Extracted Learnings\n\n`;
      result += `**Summary:** ${data.summary || "N/A"}\n\n`;

      if (data.learnings && data.learnings.length > 0) {
        result += `### Learnings\n`;
        for (const l of data.learnings) {
          result += `- **[${l.type}]** (confidence: ${pct(l.confidence)}) ${l.content}\n`;
          if (l.tags && l.tags.length > 0) {
            result += `  Tags: ${l.tags.join(", ")}\n`;
          }
          if (l.reasoning) {
            result += `  *Reasoning: ${l.reasoning}*\n`;
          }
        }
        result += "\n";
      }

      if (data.entities) {
        if (data.entities.files && data.entities.files.length > 0) {
          result += `### Referenced Files\n`;
          for (const f of data.entities.files) {
            result += `- ${f}\n`;
          }
          result += "\n";
        }
        if (data.entities.functions && data.entities.functions.length > 0) {
          result += `### Referenced Functions\n`;
          for (const f of data.entities.functions) {
            result += `- ${f}\n`;
          }
          result += "\n";
        }
        if (data.entities.concepts && data.entities.concepts.length > 0) {
          result += `### Concepts\n`;
          for (const c of data.entities.concepts) {
            result += `- ${c}\n`;
          }
          result += "\n";
        }
      }

      if (data.savedCount !== undefined) {
        result += `**Saved:** ${data.savedCount} learnings\n`;
      }

      return result;
    },
  };

  return { tools, handlers };
}
