/**
 * Suggestions tools module - contextual suggestions, related code,
 * implementation suggestions, test suggestions, and code context.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";
import { truncate, pct, PREVIEW } from "../formatters.js";

/**
 * Create the suggestions tools module with project-specific descriptions.
 */
export function createSuggestionTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "get_contextual_suggestions",
      description: `Get contextual suggestions based on current work context for ${projectName}. Returns relevant suggestions, triggers, and related memories.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          currentFile: {
            type: "string",
            description: "Currently active file path",
          },
          currentCode: {
            type: "string",
            description: "Currently selected or visible code",
          },
          recentFiles: {
            type: "array",
            items: { type: "string" },
            description: "Recently opened file paths",
          },
          task: {
            type: "string",
            description: "Current task description",
          },
        },
      },
    },
    {
      name: "suggest_related_code",
      description: `Find code related to a given file or snippet in ${projectName}. Shows similar implementations and related modules.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          file: {
            type: "string",
            description: "File path to find related code for",
          },
          code: {
            type: "string",
            description: "Code snippet to find related code for",
          },
          limit: {
            type: "number",
            description: "Max results (default: 5)",
            default: 5,
          },
        },
      },
    },
    {
      name: "suggest_implementation",
      description: `Get implementation suggestions for a feature in ${projectName}. Shows similar patterns and adaptation hints.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          description: {
            type: "string",
            description: "Description of what to implement",
          },
          currentFile: {
            type: "string",
            description: "Current file for context",
          },
          language: {
            type: "string",
            description: "Target programming language",
          },
        },
        required: ["description"],
      },
    },
    {
      name: "suggest_tests",
      description: `Get test suggestions for code in ${projectName}. Shows recommended test types, frameworks, and example patterns.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          file: {
            type: "string",
            description: "File to suggest tests for",
          },
          code: {
            type: "string",
            description: "Code to suggest tests for",
          },
          framework: {
            type: "string",
            description: "Test framework preference (jest, mocha, pytest, etc.)",
          },
        },
      },
    },
    {
      name: "get_code_context",
      description: `Get full context for a code file in ${projectName}. Shows imports, related code, and test patterns.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          file: {
            type: "string",
            description: "File path to get context for",
          },
          code: {
            type: "string",
            description: "Code snippet for context",
          },
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    get_contextual_suggestions: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { currentFile, currentCode, recentFiles, task } = args as {
        currentFile?: string;
        currentCode?: string;
        recentFiles?: string[];
        task?: string;
      };
      const response = await ctx.api.post("/api/suggestions", {
        projectName: ctx.projectName,
        currentFile,
        currentCode,
        recentFiles,
        task,
      });
      const data = response.data;

      let result = `## Contextual Suggestions\n\n`;

      if (data.relevanceScore !== undefined) {
        result += `**Relevance Score:** ${pct(data.relevanceScore)}\n\n`;
      }

      if (data.triggers && data.triggers.length > 0) {
        result += `### Triggers\n`;
        for (const t of data.triggers) {
          result += `- **${t.type}:** ${t.value}`;
          if (t.confidence) result += ` (${pct(t.confidence)})`;
          result += "\n";
        }
        result += "\n";
      }

      if (data.suggestions && data.suggestions.length > 0) {
        result += `### Suggestions\n`;
        for (const s of data.suggestions) {
          result += `- **${s.title}** [${s.type}]\n`;
          if (s.description) result += `  ${s.description}\n`;
          if (s.reason) result += `  *Reason: ${s.reason}*\n`;
          if (s.relevance !== undefined) result += `  Relevance: ${pct(s.relevance)}\n`;
        }
        result += "\n";
      }

      if (data.relatedMemories && data.relatedMemories.length > 0) {
        result += `### Related Memories\n`;
        for (const m of data.relatedMemories) {
          result += `- ${m.content || m.title || JSON.stringify(m)}\n`;
        }
      }

      return result;
    },

    suggest_related_code: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { file, code, limit = 5 } = args as {
        file?: string;
        code?: string;
        limit?: number;
      };
      const response = await ctx.api.post("/api/code/related", {
        projectName: ctx.projectName,
        file,
        code,
        limit,
      });
      const results = response.data.results || response.data;

      if (!results || results.length === 0) {
        return "No related code found.";
      }

      let result = `## Related Code\n\n`;
      for (const r of results) {
        result += `### ${r.file}\n`;
        result += `**Score:** ${pct(r.score)}`;
        if (r.reason) result += ` | **Reason:** ${r.reason}`;
        if (r.line) result += ` | Line ${r.line}`;
        result += "\n";
        if (r.content || r.code) {
          result += "```\n" + truncate(r.content || r.code, PREVIEW.MEDIUM) + "\n```\n";
        }
        result += "\n";
      }

      return result;
    },

    suggest_implementation: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { description, currentFile, language } = args as {
        description: string;
        currentFile?: string;
        language?: string;
      };
      const response = await ctx.api.post("/api/code/suggest-implementation", {
        projectName: ctx.projectName,
        description,
        currentFile,
        language,
      });
      const data = response.data;
      const patterns = data.patterns || data.results || [];

      if (!patterns || patterns.length === 0) {
        return "No implementation suggestions found.";
      }

      const patternIcons: Record<string, string> = {
        similar_structure: "\ud83d\udcd0",
        same_domain: "\ud83c\udfaf",
        related_import: "\ud83d\udce6",
        test_pattern: "\ud83e\uddea",
      };

      let result = `## Implementation Suggestions\n\n`;
      for (const p of patterns) {
        const icon = patternIcons[p.pattern || p.type] || "\ud83d\udcd0";
        result += `### ${icon} ${p.file || p.name || "Pattern"}\n`;
        if (p.adaptationHints || p.hints) {
          result += `**Adaptation:** ${p.adaptationHints || p.hints}\n`;
        }
        if (p.content || p.code) {
          result += "```\n" + truncate(p.content || p.code, 400) + "\n```\n";
        }
        result += "\n";
      }

      return result;
    },

    suggest_tests: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { file, code, framework } = args as {
        file?: string;
        code?: string;
        framework?: string;
      };
      const response = await ctx.api.post("/api/code/suggest-tests", {
        projectName: ctx.projectName,
        file,
        code,
        framework,
      });
      const data = response.data;
      const tests = data.tests || data.suggestions || data.results || [];

      if (!tests || tests.length === 0) {
        return "No test suggestions found.";
      }

      const typeIcons: Record<string, string> = {
        unit: "\ud83d\udd2c",
        integration: "\ud83d\udd17",
        e2e: "\ud83c\udf10",
      };

      let result = `## Test Suggestions\n\n`;
      for (const t of tests) {
        const icon = typeIcons[t.type] || "\ud83d\udd2c";
        result += `### ${icon} ${t.name || t.title || t.type || "Test"}\n`;
        if (t.framework) result += `**Framework:** ${t.framework}\n`;
        if (t.coverage) result += `**Coverage:** ${t.coverage}\n`;
        if (t.content || t.code) {
          result += "```\n" + truncate(t.content || t.code, PREVIEW.LONG) + "\n```\n";
        }
        result += "\n";
      }

      return result;
    },

    get_code_context: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { file, code } = args as { file?: string; code?: string };
      const response = await ctx.api.post("/api/code/context", {
        projectName: ctx.projectName,
        file,
        code,
      });
      const data = response.data;

      let result = `## Code Context\n\n`;

      if (data.imports && data.imports.length > 0) {
        result += `### Imports\n`;
        for (const imp of data.imports) {
          result += `- ${imp}\n`;
        }
        result += "\n";
      }

      if (data.relatedCode && data.relatedCode.length > 0) {
        result += `### Related Code\n`;
        for (const r of data.relatedCode) {
          result += `- **${r.file}** (${pct(r.score)})`;
          if (r.reason) result += ` - ${r.reason}`;
          result += "\n";
        }
        result += "\n";
      }

      if (data.testPatterns && data.testPatterns.length > 0) {
        result += `### Test Patterns\n`;
        for (const t of data.testPatterns) {
          result += `- **${t.file}**`;
          if (t.type) result += ` [${t.type}]`;
          if (t.framework) result += ` (${t.framework})`;
          result += "\n";
        }
      }

      return result;
    },
  };

  return { tools, handlers };
}
