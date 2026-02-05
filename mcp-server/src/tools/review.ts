/**
 * Review & testing tools module - code review, test generation, and test analysis.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";

/**
 * Create the review & testing tools module with project-specific descriptions.
 */
export function createReviewTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "review_code",
      description:
        "Review code for issues, pattern violations, and improvements. Uses project patterns and ADRs for context.",
      inputSchema: {
        type: "object" as const,
        properties: {
          code: {
            type: "string",
            description: "Code to review",
          },
          filePath: {
            type: "string",
            description: "File path for context",
          },
          reviewType: {
            type: "string",
            enum: ["security", "performance", "patterns", "style", "general"],
            description: "Type of review focus (default: general)",
          },
          diff: {
            type: "string",
            description: "Git diff to review instead of full code",
          },
        },
        required: ["code"],
      },
    },
    {
      name: "generate_tests",
      description:
        "Generate unit/integration tests based on code and existing test patterns in the project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          code: {
            type: "string",
            description: "Code to generate tests for",
          },
          filePath: {
            type: "string",
            description: "File path for context",
          },
          framework: {
            type: "string",
            enum: ["jest", "vitest", "pytest", "mocha"],
            description: "Test framework to use (default: jest)",
          },
          testType: {
            type: "string",
            enum: ["unit", "integration", "e2e"],
            description: "Type of tests to generate (default: unit)",
          },
          coverage: {
            type: "string",
            enum: ["minimal", "standard", "comprehensive"],
            description: "Coverage level (default: comprehensive)",
          },
        },
        required: ["code"],
      },
    },
    {
      name: "analyze_tests",
      description: "Analyze existing tests for coverage and quality.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCode: {
            type: "string",
            description: "Test code to analyze",
          },
          sourceCode: {
            type: "string",
            description: "Optional source code being tested",
          },
        },
        required: ["testCode"],
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    review_code: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { code, filePath, reviewType = "general", diff } = args as {
        code: string;
        filePath?: string;
        reviewType?: string;
        diff?: string;
      };

      const response = await ctx.api.post("/api/review", {
        code: code || diff,
        filePath,
        reviewType,
        diff,
      });

      const { review, context } = response.data;

      let result = `# Code Review\n\n`;

      if (review.score) {
        result += `**Score**: ${review.score}/10\n\n`;
      }

      if (review.summary) {
        result += `## Summary\n${review.summary}\n\n`;
      }

      if (review.issues && review.issues.length > 0) {
        result += `## Issues Found\n`;
        review.issues.forEach(
          (
            issue: {
              severity: string;
              type: string;
              description: string;
              line?: number;
              suggestion?: string;
            },
            i: number
          ) => {
            const icon =
              issue.severity === "critical"
                ? "\u{1F6A8}"
                : issue.severity === "high"
                  ? "\u26A0\uFE0F"
                  : issue.severity === "medium"
                    ? "\u{1F4CB}"
                    : "\u2139\uFE0F";
            result += `\n### ${icon} ${i + 1}. ${issue.type} (${issue.severity})\n`;
            result += `${issue.description}\n`;
            if (issue.line) result += `- Line: ${issue.line}\n`;
            if (issue.suggestion) result += `- Fix: ${issue.suggestion}\n`;
          }
        );
        result += "\n";
      }

      if (review.positives && review.positives.length > 0) {
        result += `## Positives\n`;
        review.positives.forEach((p: string) => {
          result += `- ${p}\n`;
        });
        result += "\n";
      }

      if (review.suggestions && review.suggestions.length > 0) {
        result += `## Suggestions\n`;
        review.suggestions.forEach((s: string) => {
          result += `- ${s}\n`;
        });
      }

      result += `\n---\n_Context: ${context.patternsUsed} patterns, ${context.adrsUsed} ADRs, ${context.similarFilesFound} similar files_`;

      return result;
    },

    generate_tests: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const {
        code,
        filePath,
        framework = "jest",
        testType = "unit",
        coverage = "comprehensive",
      } = args as {
        code: string;
        filePath?: string;
        framework?: string;
        testType?: string;
        coverage?: string;
      };

      const response = await ctx.api.post("/api/generate-tests", {
        code,
        filePath,
        framework,
        testType,
        coverage,
      });

      const { tests, analysis, existingPatternsFound } = response.data;

      let result = `# Generated Tests\n\n`;
      result += `**Framework**: ${framework}\n`;
      result += `**Type**: ${testType}\n`;
      result += `**Coverage**: ${coverage}\n`;
      result += `**Existing patterns found**: ${existingPatternsFound}\n\n`;

      if (analysis) {
        result += `## Code Analysis\n`;
        result += `- Functions: ${analysis.functions?.join(", ") || "none"}\n`;
        result += `- Classes: ${analysis.classes?.join(", ") || "none"}\n`;
        result += `- Complexity: ${analysis.estimatedComplexity}\n\n`;
      }

      result += `## Generated Test Code\n\n`;
      result +=
        "```" + (framework === "pytest" ? "python" : "typescript") + "\n";
      result += tests;
      result += "\n```\n";

      return result;
    },

    analyze_tests: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { testCode, sourceCode } = args as {
        testCode: string;
        sourceCode?: string;
      };

      const response = await ctx.api.post("/api/analyze-tests", {
        testCode,
        sourceCode,
      });

      const { analysis } = response.data;

      let result = `# Test Analysis\n\n`;

      if (analysis.quality) {
        result += `**Quality**: ${analysis.quality}`;
        if (analysis.score) result += ` (${analysis.score}/10)`;
        result += "\n\n";
      }

      if (analysis.coverage) {
        result += `## Coverage Estimates\n`;
        Object.entries(analysis.coverage).forEach(([key, value]) => {
          result += `- ${key}: ${value}\n`;
        });
        result += "\n";
      }

      if (analysis.strengths && analysis.strengths.length > 0) {
        result += `## Strengths\n`;
        (analysis.strengths as string[]).forEach((s: string) => {
          result += `- ${s}\n`;
        });
        result += "\n";
      }

      if (analysis.weaknesses && analysis.weaknesses.length > 0) {
        result += `## Weaknesses\n`;
        (analysis.weaknesses as string[]).forEach((w: string) => {
          result += `- ${w}\n`;
        });
        result += "\n";
      }

      if (analysis.missingTests && analysis.missingTests.length > 0) {
        result += `## Missing Tests\n`;
        (analysis.missingTests as string[]).forEach((t: string) => {
          result += `- ${t}\n`;
        });
      }

      return result;
    },
  };

  return { tools, handlers };
}
