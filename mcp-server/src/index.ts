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

import { createApiClient } from "./api-client.js";
import { ToolRegistry } from "./tool-registry.js";
import { ContextEnricher } from "./context-enrichment.js";
import type { ToolContext } from "./types.js";

// Tool modules
import { createSearchTools } from "./tools/search.js";
import { createAskTools } from "./tools/ask.js";
import { createIndexingTools } from "./tools/indexing.js";
import { createMemoryTools } from "./tools/memory.js";
import { createArchitectureTools } from "./tools/architecture.js";
import { createDatabaseTools } from "./tools/database.js";
import { createConfluenceTools } from "./tools/confluence.js";
import { createPmTools } from "./tools/pm.js";
import { createReviewTools } from "./tools/review.js";
import { createAnalyticsTools } from "./tools/analytics.js";
import { createClusteringTools } from "./tools/clustering.js";
import { createSessionTools } from "./tools/session.js";
import { createFeedbackTools } from "./tools/feedback.js";
import { createSuggestionTools } from "./tools/suggestions.js";
import { createCacheTools } from "./tools/cache.js";
import { createGuidelinesTools } from "./tools/guidelines.js";
import { createAdvancedTools } from "./tools/advanced.js";
import { createAgentTools } from "./tools/agents.js";

// Configuration from environment
const PROJECT_NAME = process.env.PROJECT_NAME || "default";
const PROJECT_PATH = process.env.PROJECT_PATH || process.cwd();
const RAG_API_URL = process.env.RAG_API_URL || "http://localhost:3100";
const COLLECTION_PREFIX = `${PROJECT_NAME}_`;

// API client
const api = createApiClient(RAG_API_URL, PROJECT_NAME, PROJECT_PATH);

// Mutable tool context shared by all handlers (session state updates in-place)
const ctx: ToolContext = {
  api,
  projectName: PROJECT_NAME,
  projectPath: PROJECT_PATH,
  collectionPrefix: COLLECTION_PREFIX,
  enrichmentEnabled: true,
};

// Build tool registry from modules
const registry = new ToolRegistry();

registry.register(createSearchTools(PROJECT_NAME));
registry.register(createAskTools(PROJECT_NAME));
registry.register(createIndexingTools(PROJECT_NAME));
registry.register(createMemoryTools(PROJECT_NAME));
registry.register(createArchitectureTools(PROJECT_NAME));
registry.register(createDatabaseTools(PROJECT_NAME));
registry.register(createConfluenceTools(PROJECT_NAME));
registry.register(createPmTools(PROJECT_NAME));
registry.register(createReviewTools(PROJECT_NAME));
registry.register(createAnalyticsTools(PROJECT_NAME));
registry.register(createClusteringTools(PROJECT_NAME));
registry.register(createSessionTools(PROJECT_NAME, ctx));
registry.register(createFeedbackTools(PROJECT_NAME));
registry.register(createSuggestionTools(PROJECT_NAME));
registry.register(createCacheTools(PROJECT_NAME));
registry.register(createGuidelinesTools(PROJECT_NAME));
registry.register(createAdvancedTools(PROJECT_NAME));
registry.register(createAgentTools(PROJECT_NAME));

// Initialize context enrichment middleware
const enricher = new ContextEnricher({
  maxAutoRecall: 3,
  minRelevance: 0.6,
  timeoutMs: 2000,
});
registry.setEnricher(enricher);

// MCP Server
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
  tools: registry.getTools(),
}));

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await registry.handle(name, args || {}, ctx);
  return {
    content: [{ type: "text", text: result }],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${PROJECT_NAME} RAG MCP server running (collection prefix: ${COLLECTION_PREFIX})`);
  console.error(`Registered ${registry.getTools().length} tools from 18 modules`);
}

main().catch(console.error);
