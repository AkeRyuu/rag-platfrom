/**
 * Memory tools module - Agent memory management tools.
 *
 * Tools: remember, recall, list_memories, forget, update_todo,
 *        batch_remember, validate_memory, review_memories,
 *        promote_memory, run_quality_gates
 */

import type { ToolModule, ToolContext } from "../types.js";
import { formatMemoryResults, truncate, PREVIEW } from "../formatters.js";

const typeEmojis: Record<string, string> = {
  decision: "\u{1F3AF}",
  insight: "\u{1F4A1}",
  context: "\u{1F4CC}",
  todo: "\u{1F4CB}",
  conversation: "\u{1F4AC}",
  note: "\u{1F4DD}",
};

const statusEmojis: Record<string, string> = {
  pending: "\u23F3",
  in_progress: "\u{1F504}",
  done: "\u2705",
  cancelled: "\u274C",
};

export function createMemoryTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "remember",
      description:
        "Store important information in agent memory. Use this to save decisions, insights, context, todos, or important conversations for future reference.",
      inputSchema: {
        type: "object" as const,
        properties: {
          content: {
            type: "string",
            description: "Information to remember",
          },
          type: {
            type: "string",
            enum: [
              "decision",
              "insight",
              "context",
              "todo",
              "conversation",
              "note",
            ],
            description: "Type of memory (default: note)",
            default: "note",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Tags for categorization (e.g., ['feature-x', 'important'])",
          },
          relatedTo: {
            type: "string",
            description: "Related feature or topic",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "recall",
      description:
        "Retrieve relevant memories based on context. Searches agent memory for past decisions, insights, and notes related to the query.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "What to recall (semantic search)",
          },
          type: {
            type: "string",
            enum: [
              "decision",
              "insight",
              "context",
              "todo",
              "conversation",
              "note",
              "all",
            ],
            description: "Filter by memory type (default: all)",
            default: "all",
          },
          limit: {
            type: "number",
            description: "Max memories to retrieve (default: 5)",
            default: 5,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "list_memories",
      description:
        "List recent memories or filter by type/tags. Shows what the agent has remembered.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: [
              "decision",
              "insight",
              "context",
              "todo",
              "conversation",
              "note",
              "all",
            ],
            description: "Filter by type",
            default: "all",
          },
          tag: {
            type: "string",
            description: "Filter by tag",
          },
          limit: {
            type: "number",
            description: "Max results (default: 10)",
            default: 10,
          },
        },
      },
    },
    {
      name: "forget",
      description: "Delete a specific memory by ID or clear memories by type.",
      inputSchema: {
        type: "object" as const,
        properties: {
          memoryId: {
            type: "string",
            description: "Specific memory ID to delete",
          },
          type: {
            type: "string",
            enum: [
              "decision",
              "insight",
              "context",
              "todo",
              "conversation",
              "note",
            ],
            description: "Delete all memories of this type",
          },
          olderThanDays: {
            type: "number",
            description: "Delete memories older than N days",
          },
        },
      },
    },
    {
      name: "update_todo",
      description: "Update status of a todo/task in memory.",
      inputSchema: {
        type: "object" as const,
        properties: {
          todoId: {
            type: "string",
            description: "Todo memory ID",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "done", "cancelled"],
            description: "New status",
          },
          note: {
            type: "string",
            description: "Optional note about the update",
          },
        },
        required: ["todoId", "status"],
      },
    },
    {
      name: "batch_remember",
      description: `Efficiently store multiple memories at once in ${projectName}. Faster than individual remember calls.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                  description: "Content to remember",
                },
                type: {
                  type: "string",
                  enum: [
                    "decision",
                    "insight",
                    "context",
                    "todo",
                    "conversation",
                    "note",
                  ],
                  description: "Memory type (default: note)",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags for categorization",
                },
                relatedTo: {
                  type: "string",
                  description: "Related feature or topic",
                },
              },
              required: ["content"],
            },
            description: "Array of memories to store",
          },
        },
        required: ["items"],
      },
    },
    {
      name: "validate_memory",
      description: `Validate or reject an auto-extracted memory in ${projectName}. Helps improve future extraction accuracy.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          memoryId: {
            type: "string",
            description: "ID of the memory to validate",
          },
          validated: {
            type: "boolean",
            description:
              "true to confirm the memory is valuable, false to reject it",
          },
        },
        required: ["memoryId", "validated"],
      },
    },
    {
      name: "review_memories",
      description: `Get auto-extracted memories pending review in ${projectName}. Shows unvalidated learnings that need human confirmation.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Max memories to return (default: 20)",
            default: 20,
          },
        },
      },
    },
    {
      name: "promote_memory",
      description: `Promote a quarantine memory to durable storage in ${projectName}. Requires a reason for promotion. Optionally runs quality gates before promotion.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          memoryId: {
            type: "string",
            description: "ID of the memory to promote",
          },
          reason: {
            type: "string",
            enum: ["human_validated", "pr_merged", "tests_passed"],
            description: "Reason for promotion",
          },
          evidence: {
            type: "string",
            description: "Optional evidence supporting the promotion",
          },
          runGates: {
            type: "boolean",
            description:
              "Run quality gates before promotion (default: false)",
          },
          affectedFiles: {
            type: "array",
            items: { type: "string" },
            description:
              "Files affected by this memory (for quality gate checking)",
          },
        },
        required: ["memoryId", "reason"],
      },
    },
    {
      name: "run_quality_gates",
      description: `Run quality gates (typecheck, tests, blast radius) for ${projectName}.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          affectedFiles: {
            type: "array",
            items: { type: "string" },
            description:
              "Files to check (for related tests and blast radius)",
          },
          skipGates: {
            type: "array",
            items: { type: "string" },
            description:
              "Gates to skip (typecheck, test, blast_radius)",
          },
        },
      },
    },
  ];

  const handlers: Record<
    string,
    (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
  > = {
    // ----- remember -----
    async remember(args, ctx) {
      const content = args.content as string;
      const type = (args.type as string) || "note";
      const tags = (args.tags as string[]) || [];
      const relatedTo = args.relatedTo as string | undefined;

      const response = await ctx.api.post("/api/memory", {
        projectName: ctx.projectName,
        content,
        type,
        tags,
        relatedTo,
      });

      const memory = response.data.memory;
      return (
        `\u2705 **Memory stored**\n\n` +
        `- **ID:** ${memory.id}\n` +
        `- **Type:** ${memory.type}\n` +
        `- **Content:** ${truncate(content, 200)}\n` +
        (tags.length > 0 ? `- **Tags:** ${tags.join(", ")}\n` : "") +
        (relatedTo ? `- **Related to:** ${relatedTo}\n` : "") +
        `- **Created:** ${new Date(memory.createdAt).toLocaleString()}`
      );
    },

    // ----- recall -----
    async recall(args, ctx) {
      const query = args.query as string;
      const type = (args.type as string) || "all";
      const limit = (args.limit as number) || 5;

      const response = await ctx.api.post("/api/memory/recall", {
        projectName: ctx.projectName,
        query,
        type,
        limit,
      });

      const results = response.data.results || [];
      if (results.length === 0) {
        return `\u{1F50D} No memories found for: "${query}"`;
      }

      const header = `\u{1F9E0} **Recalled Memories** (${results.length} found)\n\n`;
      return header + formatMemoryResults(results);
    },

    // ----- list_memories -----
    async list_memories(args, ctx) {
      const type = (args.type as string) || "all";
      const tag = args.tag as string | undefined;
      const limit = (args.limit as number) || 10;

      const params = new URLSearchParams({
        projectName: ctx.projectName,
        limit: limit.toString(),
      });
      if (type && type !== "all") params.append("type", type);
      if (tag) params.append("tag", tag);

      const response = await ctx.api.get(`/api/memory/list?${params}`);
      const memories = response.data.memories || [];

      if (memories.length === 0) {
        return `\u{1F4ED} No memories found${type !== "all" ? ` of type "${type}"` : ""}`;
      }

      let result = `\u{1F4DA} **Agent Memories** (${memories.length})\n\n`;

      memories.forEach(
        (
          m: {
            id: string;
            type: string;
            status?: string;
            content: string;
            createdAt: string;
          },
          i: number,
        ) => {
          const emoji = typeEmojis[m.type] || "\u{1F4DD}";
          const statusStr = m.status ? ` [${m.status}]` : "";
          result += `${i + 1}. ${emoji} **${m.type}**${statusStr}: ${truncate(m.content, PREVIEW.SHORT)}\n`;
          result += `   ID: \`${m.id}\` | ${new Date(m.createdAt).toLocaleDateString()}\n\n`;
        },
      );

      return result;
    },

    // ----- forget -----
    async forget(args, ctx) {
      const memoryId = args.memoryId as string | undefined;
      const type = args.type as string | undefined;

      if (memoryId) {
        const response = await ctx.api.delete(
          `/api/memory/${memoryId}?projectName=${ctx.projectName}`,
        );
        return response.data.success
          ? `\u{1F5D1}\uFE0F Memory deleted: ${memoryId}`
          : `\u274C Failed to delete memory: ${memoryId}`;
      }

      if (type) {
        await ctx.api.delete(
          `/api/memory/type/${type}?projectName=${ctx.projectName}`,
        );
        return `\u{1F5D1}\uFE0F Deleted all memories of type: ${type}`;
      }

      return "Please specify memoryId or type to delete.";
    },

    // ----- update_todo -----
    async update_todo(args, ctx) {
      const todoId = args.todoId as string;
      const status = args.status as string;
      const note = args.note as string | undefined;

      const response = await ctx.api.patch(`/api/memory/todo/${todoId}`, {
        projectName: ctx.projectName,
        status,
        note,
      });

      if (!response.data.memory) {
        return `\u274C Todo not found: ${todoId}`;
      }

      return (
        `${statusEmojis[status] || "\u{1F4CB}"} **Todo updated**\n\n` +
        `- **ID:** ${todoId}\n` +
        `- **Status:** ${status}\n` +
        (note ? `- **Note:** ${note}\n` : "") +
        `- **Content:** ${response.data.memory.content}`
      );
    },

    // ----- batch_remember -----
    async batch_remember(args, ctx) {
      const items = args.items as Array<{
        content: string;
        type?: string;
        tags?: string[];
        relatedTo?: string;
      }>;

      const response = await ctx.api.post("/api/memory/batch", {
        items,
      });

      const { savedCount, errors, memories } = response.data;

      let result = `# \u{1F4E6} Batch Memory Result\n\n`;
      result += `**Saved**: ${savedCount} memories\n\n`;

      if (memories && memories.length > 0) {
        result += `## Stored Memories\n`;
        memories.forEach(
          (m: { id: string; type: string; content: string }) => {
            result += `- [${m.type}] ${truncate(m.content, 80)}\n`;
            result += `  ID: \`${m.id}\`\n`;
          },
        );
      }

      if (errors && errors.length > 0) {
        result += `\n## \u26A0\uFE0F Errors\n`;
        errors.forEach((e: string) => {
          result += `- ${e}\n`;
        });
      }

      return result;
    },

    // ----- validate_memory -----
    async validate_memory(args, ctx) {
      const memoryId = args.memoryId as string;
      const validated = args.validated as boolean;

      const response = await ctx.api.patch(
        `/api/memory/${memoryId}/validate`,
        {
          validated,
        },
      );

      const { memory } = response.data;

      return (
        `\u2705 Memory ${validated ? "validated" : "rejected"}\n\n` +
        `- **ID**: ${memory.id}\n` +
        `- **Type**: ${memory.type}\n` +
        `- **Content**: ${truncate(memory.content, PREVIEW.SHORT)}\n` +
        `- **Validated**: ${memory.validated}`
      );
    },

    // ----- promote_memory -----
    async promote_memory(args, ctx) {
      const memoryId = args.memoryId as string;
      const reason = args.reason as string;
      const evidence = args.evidence as string | undefined;
      const runGates = args.runGates as boolean | undefined;
      const affectedFiles = args.affectedFiles as string[] | undefined;

      const response = await ctx.api.post("/api/memory/promote", {
        projectName: ctx.projectName,
        memoryId,
        reason,
        evidence,
        runGates: runGates || false,
        projectPath: runGates ? ctx.projectPath : undefined,
        affectedFiles: runGates ? affectedFiles : undefined,
      });

      const { memory } = response.data;

      return (
        `\u2705 **Memory promoted to durable storage**\n\n` +
        `- **ID:** ${memory.id}\n` +
        `- **Type:** ${memory.type}\n` +
        `- **Reason:** ${reason}\n` +
        (evidence ? `- **Evidence:** ${evidence}\n` : "") +
        (runGates ? `- **Quality Gates:** passed\n` : "") +
        `- **Content:** ${truncate(memory.content, 200)}`
      );
    },

    // ----- run_quality_gates -----
    async run_quality_gates(args, ctx) {
      const affectedFiles = args.affectedFiles as string[] | undefined;
      const skipGates = args.skipGates as string[] | undefined;

      const response = await ctx.api.post("/api/quality/run", {
        projectName: ctx.projectName,
        projectPath: ctx.projectPath,
        affectedFiles,
        skipGates,
      });

      const report = response.data;
      let result = `**Quality Report**: ${report.passed ? "\u2705 All gates passed" : "\u274C Some gates failed"}\n\n`;

      for (const gate of report.gates) {
        const icon = gate.passed ? "\u2705" : "\u274C";
        result += `${icon} **${gate.gate}** (${(gate.duration / 1000).toFixed(1)}s)\n`;
        result += `   ${gate.details.slice(0, 500)}\n\n`;
      }

      if (report.blastRadius) {
        result += `\n**Blast Radius**: ${report.blastRadius.affectedFiles.length} files, depth ${report.blastRadius.depth}\n`;
        if (report.blastRadius.affectedFiles.length > 0) {
          result += report.blastRadius.affectedFiles
            .slice(0, 10)
            .map((f: string) => `  - ${f}`)
            .join("\n");
          if (report.blastRadius.affectedFiles.length > 10) {
            result += `\n  ... and ${report.blastRadius.affectedFiles.length - 10} more`;
          }
        }
      }

      return result;
    },

    // ----- review_memories -----
    async review_memories(args, ctx) {
      const limit = (args.limit as number) || 20;

      const response = await ctx.api.get(
        `/api/memory/quarantine?limit=${limit}`,
      );
      const { memories, count } = response.data;

      if (count === 0) {
        return "No unvalidated memories to review. All auto-extracted learnings have been reviewed.";
      }

      let result = `# \u{1F4CB} Memories Pending Review (${count})\n\n`;
      result += `These are auto-extracted learnings that need validation.\n\n`;

      memories.forEach(
        (
          m: {
            id: string;
            type: string;
            content: string;
            confidence: number;
            source: string;
            tags: string[];
          },
          i: number,
        ) => {
          result += `## ${i + 1}. ${m.type.toUpperCase()}\n`;
          result += `**ID**: \`${m.id}\`\n`;
          result += `**Confidence**: ${((m.confidence || 0) * 100).toFixed(0)}%\n`;
          result += `**Source**: ${m.source || "unknown"}\n`;
          result += `**Content**: ${m.content}\n`;
          if (m.tags && m.tags.length > 0) {
            result += `**Tags**: ${m.tags.join(", ")}\n`;
          }
          result += `\nTo validate: \`validate_memory(memoryId="${m.id}", validated=true)\`\n`;
          result += `To reject: \`validate_memory(memoryId="${m.id}", validated=false)\`\n\n`;
        },
      );

      return result;
    },
  };

  return { tools, handlers };
}
