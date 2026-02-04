#!/usr/bin/env node
/**
 * Universal RAG MCP Server
 *
 * A shared MCP server that can be used by any project.
 * Each project has its own namespace/collection in Qdrant.
 *
 * Environment variables:
 * - PROJECT_NAME: Unique project identifier (e.g., "cypro", "myproject")
 * - PROJECT_PATH: Path to project codebase for indexing
 * - RAG_API_URL: URL of the shared RAG API (default: http://localhost:3100)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// Configuration from environment
const PROJECT_NAME = process.env.PROJECT_NAME || "default";
const PROJECT_PATH = process.env.PROJECT_PATH || process.cwd();
const RAG_API_URL = process.env.RAG_API_URL || "http://localhost:3100";

// Collection names are prefixed with project name to avoid conflicts
const COLLECTION_PREFIX = `${PROJECT_NAME}_`;

// API client
const api = axios.create({
  baseURL: RAG_API_URL,
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
    "X-Project-Name": PROJECT_NAME,
    "X-Project-Path": PROJECT_PATH,
  },
});

// Tool definitions - generic for any project
const TOOLS = [
  {
    name: "search_codebase",
    description: `Search the ${PROJECT_NAME} codebase for relevant code. Returns matching files with code snippets and relevance scores.`,
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
    name: "ask_codebase",
    description: `Ask a question about the ${PROJECT_NAME} codebase. Uses RAG + LLM to provide contextual answers.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "Question about the codebase",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "explain_code",
    description: "Get a detailed explanation of a code snippet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description: "Code snippet to explain",
        },
        filePath: {
          type: "string",
          description: "Optional file path for context",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "find_feature",
    description: `Find where a specific feature is implemented in the ${PROJECT_NAME} codebase.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        description: {
          type: "string",
          description: "Description of the feature to find",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "index_codebase",
    description: `Index or re-index the ${PROJECT_NAME} codebase for RAG search.`,
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
    description: `Get the indexing status for ${PROJECT_NAME} codebase.`,
    inputSchema: {
      type: "object" as const,
      properties: {},
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
    name: "get_project_stats",
    description: `Get statistics about the ${PROJECT_NAME} codebase.`,
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "search_docs",
    description: `Search documentation in the ${PROJECT_NAME} project.`,
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
];

// Tool handlers
async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "search_codebase": {
        const { query, limit = 5, language, path } = args as {
          query: string;
          limit?: number;
          language?: string;
          path?: string;
        };
        const response = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query,
          limit,
          filters: { language, path },
        });
        const results = response.data.results;
        if (!results || results.length === 0) {
          return "No results found for this query.";
        }
        return results
          .map(
            (r: any) =>
              `**${r.file}** (${(r.score * 100).toFixed(1)}% match)\n` +
              `Lines ${r.startLine || "?"}-${r.endLine || "?"}\n` +
              "```" + (r.language || "") + "\n" +
              r.content.slice(0, 500) +
              (r.content.length > 500 ? "\n..." : "") +
              "\n```"
          )
          .join("\n\n---\n\n");
      }

      case "ask_codebase": {
        const { question } = args as { question: string };
        const response = await api.post("/api/ask", {
          collection: `${COLLECTION_PREFIX}codebase`,
          question,
        });
        return response.data.answer;
      }

      case "explain_code": {
        const { code, filePath } = args as { code: string; filePath?: string };
        const response = await api.post("/api/explain", {
          collection: `${COLLECTION_PREFIX}codebase`,
          code,
          filePath,
        });
        const exp = response.data;
        return (
          `**Summary:** ${exp.summary}\n\n` +
          `**Purpose:** ${exp.purpose}\n\n` +
          `**Key Components:**\n${exp.keyComponents?.map((c: string) => `- ${c}`).join("\n") || "N/A"}\n\n` +
          `**Dependencies:**\n${exp.dependencies?.map((d: string) => `- ${d}`).join("\n") || "N/A"}`
        );
      }

      case "find_feature": {
        const { description } = args as { description: string };
        const response = await api.post("/api/find-feature", {
          collection: `${COLLECTION_PREFIX}codebase`,
          description,
        });
        const data = response.data;
        let result = `**Feature:** ${description}\n\n`;
        result += `**Explanation:**\n${data.explanation}\n\n`;
        result += `**Main Files:**\n`;
        result += data.mainFiles
          .map((f: any) => `- ${f.file} (${(f.score * 100).toFixed(1)}%)`)
          .join("\n");
        if (data.relatedFiles?.length) {
          result += `\n\n**Related Files:**\n`;
          result += data.relatedFiles
            .map((f: any) => `- ${f.file}`)
            .join("\n");
        }
        return result;
      }

      case "index_codebase": {
        const { path = PROJECT_PATH, force = false } = args as {
          path?: string;
          force?: boolean;
        };
        const response = await api.post("/api/index", {
          collection: `${COLLECTION_PREFIX}codebase`,
          path,
          force,
        });
        return `Indexing started for ${PROJECT_NAME}.\n` +
          `Status: ${response.data.status}\n` +
          `Files to process: ${response.data.totalFiles || "calculating..."}`;
      }

      case "get_index_status": {
        const response = await api.get(`/api/index/status/${COLLECTION_PREFIX}codebase`);
        const status = response.data;
        return `**Index Status for ${PROJECT_NAME}**\n\n` +
          `- Status: ${status.status}\n` +
          `- Total Files: ${status.totalFiles}\n` +
          `- Indexed Files: ${status.indexedFiles}\n` +
          `- Last Updated: ${status.lastUpdated ? new Date(status.lastUpdated).toLocaleString() : "Never"}\n` +
          `- Vector Count: ${status.vectorCount}`;
      }

      case "search_similar": {
        const { code, limit = 5 } = args as { code: string; limit?: number };
        const response = await api.post("/api/search-similar", {
          collection: `${COLLECTION_PREFIX}codebase`,
          code,
          limit,
        });
        const results = response.data.results;
        if (!results || results.length === 0) {
          return "No similar code found.";
        }
        return results
          .map(
            (r: any) =>
              `**${r.file}** (${(r.score * 100).toFixed(1)}% similar)\n` +
              "```" + (r.language || "") + "\n" +
              r.content.slice(0, 400) +
              "\n```"
          )
          .join("\n\n---\n\n");
      }

      case "get_project_stats": {
        const response = await api.get(`/api/stats/${COLLECTION_PREFIX}codebase`);
        const stats = response.data;
        let result = `**${PROJECT_NAME} Project Statistics**\n\n`;
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
      }

      case "search_docs": {
        const { query, limit = 5 } = args as { query: string; limit?: number };
        const response = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}docs`,
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
              r.content.slice(0, 500) +
              (r.content.length > 500 ? "\n..." : "")
          )
          .join("\n\n---\n\n");
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error: any) {
    if (error.code === "ECONNREFUSED") {
      return `Error: Cannot connect to RAG API at ${RAG_API_URL}. Is it running?\n` +
        `Start with: cd /home/ake/shared-ai-infra/docker && docker-compose up -d`;
    }
    if (error.response) {
      return `API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`;
    }
    return `Error: ${error.message}`;
  }
}

// Main server
const server = new Server(
  {
    name: `${PROJECT_NAME}-rag`,
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleTool(name, args || {});
  return {
    content: [{ type: "text", text: result }],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${PROJECT_NAME} RAG MCP server running (collection prefix: ${COLLECTION_PREFIX})`);
}

main().catch(console.error);
