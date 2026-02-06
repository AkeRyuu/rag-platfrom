/**
 * Agent tools module - run specialized agents and list agent types.
 */

import type { ToolModule, ToolHandler, ToolContext } from "../types.js";

/**
 * Create the agent tools module with project-specific descriptions.
 */
export function createAgentTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "run_agent",
      description: `Run a specialized agent for ${projectName}. Agents autonomously research, review, or analyze using multiple tool calls. Returns result + reasoning trace.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            description:
              "Agent type: research, review, documentation, refactor, or test",
            enum: ["research", "review", "documentation", "refactor", "test"],
          },
          task: {
            type: "string",
            description: "The task for the agent to perform",
          },
          context: {
            type: "string",
            description: "Optional additional context (code, requirements, etc.)",
          },
          maxIterations: {
            type: "number",
            description: "Maximum ReAct iterations (default: varies by agent type)",
          },
        },
        required: ["type", "task"],
      },
    },
    {
      name: "get_agent_types",
      description: `List available agent types for ${projectName} with descriptions.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    run_agent: async (
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const { type, task, context, maxIterations } = args as {
        type: string;
        task: string;
        context?: string;
        maxIterations?: number;
      };

      const response = await ctx.api.post("/api/agent/run", {
        projectName: ctx.projectName,
        agentType: type,
        task,
        context,
        maxIterations,
      });

      const data = response.data;

      // Format result with reasoning trace
      let result = `## Agent Result (${data.type})\n`;
      result += `**Task:** ${data.task}\n`;
      result += `**Status:** ${data.status}`;
      result += ` | **Iterations:** ${data.usage?.iterations || 0}`;
      result += ` | **Tool Calls:** ${data.usage?.toolCalls || 0}`;
      result += ` | **Duration:** ${data.usage?.durationMs ? Math.round(data.usage.durationMs / 1000) + "s" : "N/A"}`;
      result += "\n\n";

      if (data.error) {
        result += `**Error:** ${data.error}\n\n`;
      }

      if (data.result) {
        result += `### Result\n${data.result}\n\n`;
      }

      // Reasoning trace
      if (data.steps && data.steps.length > 0) {
        result += `### Reasoning Trace\n`;
        for (const step of data.steps) {
          result += `**Step ${step.iteration}:** ${step.thought?.slice(0, 200) || "..."}\n`;
          if (step.action) {
            result += `  Action: ${step.action.tool}(${JSON.stringify(step.action.input).slice(0, 100)})\n`;
          }
          if (step.observation) {
            const obsPreview = step.observation.result?.slice(0, 150) || "...";
            result += `  Result: ${obsPreview}${step.observation.truncated ? " [truncated]" : ""}\n`;
          }
        }
      }

      return result;
    },

    get_agent_types: async (
      _args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> => {
      const response = await ctx.api.get("/api/agent/types");
      const data = response.data;

      let result = `## Available Agent Types\n\n`;
      for (const agent of data.agents || []) {
        result += `- **${agent.name}**: ${agent.description}\n`;
      }
      return result;
    },
  };

  return { tools, handlers };
}
