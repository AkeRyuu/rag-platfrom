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
  // Grouped search - one result per file
  {
    name: "grouped_search",
    description: `Search ${PROJECT_NAME} codebase with results grouped by file. Returns one best match per file instead of multiple chunks.`,
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
      },
      required: ["query"],
    },
  },
  // Hybrid search - keyword + semantic
  {
    name: "hybrid_search",
    description: `Hybrid search combining keyword matching and semantic similarity for ${PROJECT_NAME}. Better for finding exact terms + related concepts.`,
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
      },
      required: ["query"],
    },
  },
  // Conversation analysis
  {
    name: "analyze_conversation",
    description: `Analyze a conversation to extract learnings, decisions, and insights for ${PROJECT_NAME}. Optionally auto-saves to memory.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation: {
          type: "string",
          description: "The conversation text to analyze",
        },
        context: {
          type: "string",
          description: "Additional context about the conversation",
        },
        autoSave: {
          type: "boolean",
          description: "Automatically save extracted learnings to memory (default: false)",
          default: false,
        },
        minConfidence: {
          type: "number",
          description: "Minimum confidence score for learnings (0-1, default: 0.6)",
          default: 0.6,
        },
      },
      required: ["conversation"],
    },
  },
  // Auto-remember with classification
  {
    name: "auto_remember",
    description: `Automatically classify and remember information for ${PROJECT_NAME}. Uses AI to determine the best memory type and tags.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "Content to remember",
        },
        context: {
          type: "string",
          description: "Context to help classify the memory",
        },
      },
      required: ["content"],
    },
  },
  // Tool analytics
  {
    name: "get_tool_analytics",
    description: `Get analytics about tool usage in ${PROJECT_NAME}. Shows popular tools, success rates, and performance metrics.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        days: {
          type: "number",
          description: "Number of days to analyze (default: 7)",
          default: 7,
        },
      },
    },
  },
  // Knowledge gaps
  {
    name: "get_knowledge_gaps",
    description: `Identify knowledge gaps in ${PROJECT_NAME} based on queries with low results. Helps identify missing documentation.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Max gaps to return (default: 20)",
          default: 20,
        },
      },
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
  // Confluence tools
  {
    name: "search_confluence",
    description: `Search indexed Confluence documentation for ${PROJECT_NAME}. Returns relevant pages with content snippets.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query for Confluence content",
        },
        limit: {
          type: "number",
          description: "Max results (default: 5)",
          default: 5,
        },
        spaceKey: {
          type: "string",
          description: "Filter by Confluence space key",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "index_confluence",
    description: `Index Confluence spaces/pages for ${PROJECT_NAME}. Requires Confluence credentials in RAG API.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        spaceKeys: {
          type: "array",
          items: { type: "string" },
          description: "Specific space keys to index (indexes all accessible if empty)",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Filter pages by labels",
        },
        maxPages: {
          type: "number",
          description: "Maximum pages to index (default: 500)",
          default: 500,
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
    name: "get_confluence_status",
    description: "Check if Confluence integration is configured and available.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_confluence_spaces",
    description: "List available Confluence spaces that can be indexed.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  // PM Tools - Product Management & Requirements
  {
    name: "search_requirements",
    description: `Search technical requirements and product documentation for ${PROJECT_NAME}. Finds relevant requirements, user stories, and specifications from Confluence.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query for requirements (e.g., 'video inspection flow', 'payment integration')",
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
    name: "analyze_requirements",
    description: `Analyze technical requirements and compare with existing implementation in ${PROJECT_NAME}. Identifies gaps, missing features, and implementation status.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        feature: {
          type: "string",
          description: "Feature or requirement to analyze (e.g., 'video inspection', 'notifications')",
        },
        detailed: {
          type: "boolean",
          description: "Include detailed code references (default: false)",
          default: false,
        },
      },
      required: ["feature"],
    },
  },
  {
    name: "estimate_feature",
    description: `Estimate development effort for a feature based on requirements and codebase analysis. Returns complexity assessment, affected files, and risk factors.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        feature: {
          type: "string",
          description: "Feature description to estimate",
        },
        includeSubtasks: {
          type: "boolean",
          description: "Break down into subtasks (default: true)",
          default: true,
        },
      },
      required: ["feature"],
    },
  },
  {
    name: "get_feature_status",
    description: `Get implementation status of a feature by comparing requirements with codebase. Shows what's implemented, in progress, and missing.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        feature: {
          type: "string",
          description: "Feature name to check status",
        },
      },
      required: ["feature"],
    },
  },
  {
    name: "list_requirements",
    description: `List all documented requirements/features for ${PROJECT_NAME} from Confluence. Groups by category or status.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "Filter by category (optional)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 20)",
          default: 20,
        },
      },
    },
  },
  {
    name: "ask_pm",
    description: `Ask product management questions about ${PROJECT_NAME}. Answers questions about requirements, features, priorities, and project status using both documentation and codebase.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "PM question (e.g., 'What features are planned for video inspection?', 'What's the status of notifications?')",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "generate_spec",
    description: `Generate technical specification from requirements. Creates a structured spec document based on Confluence requirements and existing codebase patterns.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        feature: {
          type: "string",
          description: "Feature to generate spec for",
        },
        format: {
          type: "string",
          enum: ["markdown", "jira", "brief"],
          description: "Output format (default: markdown)",
          default: "markdown",
        },
      },
      required: ["feature"],
    },
  },
  // Agent Memory Tools
  {
    name: "remember",
    description: `Store important information in agent memory. Use this to save decisions, insights, context, todos, or important conversations for future reference.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "Information to remember",
        },
        type: {
          type: "string",
          enum: ["decision", "insight", "context", "todo", "conversation", "note"],
          description: "Type of memory (default: note)",
          default: "note",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization (e.g., ['feature-x', 'important'])",
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
    description: `Retrieve relevant memories based on context. Searches agent memory for past decisions, insights, and notes related to the query.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "What to recall (semantic search)",
        },
        type: {
          type: "string",
          enum: ["decision", "insight", "context", "todo", "conversation", "note", "all"],
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
    description: `List recent memories or filter by type/tags. Shows what the agent has remembered.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["decision", "insight", "context", "todo", "conversation", "note", "all"],
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
    description: `Delete a specific memory by ID or clear memories by type.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        memoryId: {
          type: "string",
          description: "Specific memory ID to delete",
        },
        type: {
          type: "string",
          enum: ["decision", "insight", "context", "todo", "conversation", "note"],
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
    description: `Update status of a todo/task in memory.`,
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
  // Architecture Agent Tools
  {
    name: "record_adr",
    description: `Record an Architecture Decision Record (ADR). Use this to document important architectural decisions, technology choices, and design patterns for ${PROJECT_NAME}.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Short title for the decision (e.g., 'Use WebSocket for real-time updates')",
        },
        context: {
          type: "string",
          description: "Why this decision was needed - the problem or requirement",
        },
        decision: {
          type: "string",
          description: "What was decided",
        },
        consequences: {
          type: "string",
          description: "Positive and negative consequences of this decision",
        },
        alternatives: {
          type: "string",
          description: "What alternatives were considered",
        },
        status: {
          type: "string",
          enum: ["proposed", "accepted", "deprecated", "superseded"],
          description: "Status of the decision (default: accepted)",
          default: "accepted",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization (e.g., ['api', 'security', 'database'])",
        },
      },
      required: ["title", "context", "decision"],
    },
  },
  {
    name: "get_adrs",
    description: `Get Architecture Decision Records for ${PROJECT_NAME}. Search by topic or list all ADRs.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (optional - returns all if empty)",
        },
        status: {
          type: "string",
          enum: ["proposed", "accepted", "deprecated", "superseded", "all"],
          description: "Filter by status",
          default: "all",
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
    name: "record_pattern",
    description: `Record an architectural pattern used in ${PROJECT_NAME}. Patterns define how specific types of code should be structured.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Pattern name (e.g., 'Service Layer', 'Repository Pattern', 'API Endpoint')",
        },
        description: {
          type: "string",
          description: "What this pattern is for and when to use it",
        },
        structure: {
          type: "string",
          description: "How code following this pattern should be structured (file organization, naming, etc.)",
        },
        example: {
          type: "string",
          description: "Example code or file reference demonstrating the pattern",
        },
        appliesTo: {
          type: "string",
          description: "Where this pattern applies (e.g., 'backend/src/modules/*', 'all API endpoints')",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags (e.g., ['backend', 'api', 'module'])",
        },
      },
      required: ["name", "description", "structure"],
    },
  },
  {
    name: "get_patterns",
    description: `Get architectural patterns for ${PROJECT_NAME}. Use to understand how to structure new code.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search for patterns by name or description",
        },
        appliesTo: {
          type: "string",
          description: "Filter by what patterns apply to (e.g., 'api', 'module')",
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
    name: "check_architecture",
    description: `Check if code or a feature follows established architectural patterns. Analyzes code against recorded patterns and ADRs.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description: "Code snippet to check",
        },
        filePath: {
          type: "string",
          description: "File path for context (helps determine which patterns apply)",
        },
        featureDescription: {
          type: "string",
          description: "Description of what the code does (alternative to providing code)",
        },
      },
    },
  },
  {
    name: "suggest_architecture",
    description: `Get architectural guidance for implementing a new feature. Suggests structure, patterns to follow, and relevant ADRs.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        feature: {
          type: "string",
          description: "Feature to implement",
        },
        type: {
          type: "string",
          enum: ["api", "module", "service", "component", "integration", "other"],
          description: "Type of feature",
        },
      },
      required: ["feature"],
    },
  },
  {
    name: "record_tech_debt",
    description: `Record technical debt or architectural violation that needs to be addressed later.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Short description of the tech debt",
        },
        description: {
          type: "string",
          description: "Detailed description of the issue",
        },
        location: {
          type: "string",
          description: "Where in the codebase (file paths, modules)",
        },
        impact: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Impact level",
        },
        suggestedFix: {
          type: "string",
          description: "How to fix this debt",
        },
        relatedAdr: {
          type: "string",
          description: "Related ADR ID if this violates a decision",
        },
      },
      required: ["title", "description", "impact"],
    },
  },
  {
    name: "get_tech_debt",
    description: `List technical debt items for ${PROJECT_NAME}.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        impact: {
          type: "string",
          enum: ["low", "medium", "high", "critical", "all"],
          description: "Filter by impact",
          default: "all",
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
    name: "analyze_project_structure",
    description: `Analyze the current project structure and compare with established patterns. Identifies inconsistencies and suggests improvements.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Specific path to analyze (default: entire project)",
        },
        deep: {
          type: "boolean",
          description: "Perform deep analysis including code patterns (default: false)",
          default: false,
        },
      },
    },
  },
  // Database Architecture Agent Tools
  {
    name: "record_table",
    description: `Record a database table definition with its purpose, columns, and relationships. Use this to document the database schema for ${PROJECT_NAME}.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        tableName: {
          type: "string",
          description: "Name of the table (e.g., 'claims', 'documents')",
        },
        purpose: {
          type: "string",
          description: "What this table is for and when it's used",
        },
        columns: {
          type: "string",
          description: "Key columns and their purposes (format: 'column_name: description')",
        },
        relationships: {
          type: "string",
          description: "Relationships to other tables (FK references)",
        },
        indexes: {
          type: "string",
          description: "Important indexes and their purpose",
        },
        rules: {
          type: "string",
          description: "Business rules and constraints for this table",
        },
      },
      required: ["tableName", "purpose", "columns"],
    },
  },
  {
    name: "get_table_info",
    description: `Get documented information about a database table including its purpose, columns, relationships, and rules.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        tableName: {
          type: "string",
          description: "Table name to look up (or 'all' to list all tables)",
        },
      },
      required: ["tableName"],
    },
  },
  {
    name: "record_db_rule",
    description: `Record a database rule or constraint that should be followed. Use this for data integrity rules, naming conventions, or query patterns.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        ruleName: {
          type: "string",
          description: "Short name for the rule",
        },
        description: {
          type: "string",
          description: "Detailed description of the rule",
        },
        scope: {
          type: "string",
          enum: ["global", "table", "column", "query", "migration"],
          description: "Where this rule applies",
        },
        examples: {
          type: "string",
          description: "Good and bad examples of applying this rule",
        },
      },
      required: ["ruleName", "description", "scope"],
    },
  },
  {
    name: "get_db_rules",
    description: `Get database rules and constraints for ${PROJECT_NAME}. Filter by scope or get all rules.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: {
          type: "string",
          enum: ["global", "table", "column", "query", "migration", "all"],
          description: "Filter by scope (default: all)",
          default: "all",
        },
      },
    },
  },
  {
    name: "record_enum",
    description: `Record a database enum type with its values and usage. Use this to document allowed values for status fields, types, etc.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        enumName: {
          type: "string",
          description: "Name of the enum (e.g., 'ClaimStatus', 'DocumentType')",
        },
        values: {
          type: "string",
          description: "List of enum values with descriptions (format: 'value: description')",
        },
        usedIn: {
          type: "string",
          description: "Tables and columns where this enum is used",
        },
        transitions: {
          type: "string",
          description: "Allowed state transitions (for status enums)",
        },
      },
      required: ["enumName", "values"],
    },
  },
  {
    name: "get_enums",
    description: `Get documented enum types for ${PROJECT_NAME} database.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        enumName: {
          type: "string",
          description: "Specific enum to look up (or empty for all)",
        },
      },
    },
  },
  {
    name: "check_db_schema",
    description: `Check if a proposed database change follows the documented rules and patterns. Use before creating migrations.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        change: {
          type: "string",
          description: "Description of the proposed change (new table, column, index, etc.)",
        },
        sql: {
          type: "string",
          description: "Optional SQL or Prisma schema for the change",
        },
      },
      required: ["change"],
    },
  },
  {
    name: "suggest_db_schema",
    description: `Get suggestions for database schema design for a new feature or data requirement.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        requirement: {
          type: "string",
          description: "What data needs to be stored or what feature needs support",
        },
        relatedTables: {
          type: "string",
          description: "Existing tables that might be related",
        },
      },
      required: ["requirement"],
    },
  },
  // ============================================
  // Code Review & Testing Tools
  // ============================================
  {
    name: "review_code",
    description: "Review code for issues, pattern violations, and improvements. Uses project patterns and ADRs for context.",
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
    description: "Generate unit/integration tests based on code and existing test patterns in the project.",
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

      case "grouped_search": {
        const { query, groupBy = 'file', limit = 10, language } = args as {
          query: string;
          groupBy?: string;
          limit?: number;
          language?: string;
        };
        const response = await api.post("/api/search-grouped", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query,
          groupBy,
          limit,
          filters: language ? { language } : undefined,
        });
        const groups = response.data.groups;
        if (!groups || groups.length === 0) {
          return "No results found.";
        }
        return groups
          .map((g: any) => {
            const r = g.results[0];
            return `**${g[groupBy]}** (score: ${(r.score * 100).toFixed(1)}%)\n` +
              "```" + (r.language || "") + "\n" +
              r.content.slice(0, 300) +
              "\n```";
          })
          .join("\n\n---\n\n");
      }

      case "hybrid_search": {
        const { query, limit = 10, semanticWeight = 0.7, language } = args as {
          query: string;
          limit?: number;
          semanticWeight?: number;
          language?: string;
        };
        const response = await api.post("/api/search-hybrid", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query,
          limit,
          semanticWeight,
          filters: language ? { language } : undefined,
        });
        const results = response.data.results;
        if (!results || results.length === 0) {
          return "No results found.";
        }
        return results
          .map((r: any) =>
            `**${r.file}** (combined: ${(r.score * 100).toFixed(1)}%, semantic: ${(r.semanticScore * 100).toFixed(1)}%, keyword: ${(r.keywordScore * 100).toFixed(1)}%)\n` +
            "```" + (r.language || "") + "\n" +
            r.content.slice(0, 300) +
            "\n```"
          )
          .join("\n\n---\n\n");
      }

      case "analyze_conversation": {
        const { conversation, context, autoSave = false, minConfidence = 0.6 } = args as {
          conversation: string;
          context?: string;
          autoSave?: boolean;
          minConfidence?: number;
        };
        const response = await api.post("/api/analyze-conversation", {
          projectName: PROJECT_NAME,
          conversation,
          context,
          autoSave,
          minConfidence,
        });
        const data = response.data;

        let result = `# Conversation Analysis\n\n`;
        result += `**Summary:** ${data.summary}\n\n`;

        if (data.learnings.length > 0) {
          result += `## Extracted Learnings (${data.learnings.length})\n\n`;
          for (const learning of data.learnings) {
            result += `### ${learning.type.toUpperCase()} (confidence: ${(learning.confidence * 100).toFixed(0)}%)\n`;
            result += `${learning.content}\n`;
            if (learning.tags.length > 0) {
              result += `Tags: ${learning.tags.join(', ')}\n`;
            }
            result += `\n`;
          }
        }

        if (data.entities.files.length > 0 || data.entities.functions.length > 0) {
          result += `## Entities Mentioned\n`;
          if (data.entities.files.length > 0) {
            result += `- Files: ${data.entities.files.join(', ')}\n`;
          }
          if (data.entities.functions.length > 0) {
            result += `- Functions: ${data.entities.functions.join(', ')}\n`;
          }
        }

        if (autoSave && data.savedCount > 0) {
          result += `\n✅ Saved ${data.savedCount} learnings to memory.`;
        }

        return result;
      }

      case "auto_remember": {
        const { content, context } = args as { content: string; context?: string };

        // First analyze to classify
        const analysisResponse = await api.post("/api/analyze-conversation", {
          projectName: PROJECT_NAME,
          conversation: `Context: ${context || 'General note'}\n\nContent to remember: ${content}`,
          autoSave: false,
          minConfidence: 0.3,
        });

        const learnings = analysisResponse.data.learnings;
        if (learnings.length === 0) {
          // Fallback to manual remember
          const rememberResponse = await api.post("/api/remember", {
            projectName: PROJECT_NAME,
            content,
            type: 'note',
            tags: ['auto-classified'],
            metadata: { source: 'auto_remember', context },
          });
          return `Saved as note: ${rememberResponse.data.memory.id}`;
        }

        // Use the best classified learning
        const best = learnings[0];
        const rememberResponse = await api.post("/api/remember", {
          projectName: PROJECT_NAME,
          content: best.content || content,
          type: best.type,
          tags: [...(best.tags || []), 'auto-classified'],
          relatedTo: best.relatedTo,
          metadata: {
            source: 'auto_remember',
            confidence: best.confidence,
            reasoning: best.reasoning,
            context,
          },
        });

        return `Saved as **${best.type}** (confidence: ${(best.confidence * 100).toFixed(0)}%)\n\nID: ${rememberResponse.data.memory.id}\nTags: ${best.tags?.join(', ') || 'none'}`;
      }

      case "get_tool_analytics": {
        const { days = 7 } = args as { days?: number };
        const response = await api.get(`/api/tool-analytics?projectName=${PROJECT_NAME}&days=${days}`);
        const stats = response.data;

        let result = `# Tool Analytics (Last ${days} days)\n\n`;
        result += `- **Total Calls:** ${stats.totalCalls}\n`;
        result += `- **Success Rate:** ${(stats.successRate * 100).toFixed(1)}%\n`;
        result += `- **Avg Duration:** ${stats.avgDurationMs.toFixed(0)}ms\n\n`;

        if (stats.topTools.length > 0) {
          result += `## Top Tools\n`;
          for (const tool of stats.topTools) {
            result += `- ${tool.tool}: ${tool.count} calls\n`;
          }
        }

        if (Object.keys(stats.errorsByTool).length > 0) {
          result += `\n## Errors by Tool\n`;
          for (const [tool, count] of Object.entries(stats.errorsByTool)) {
            result += `- ${tool}: ${count} errors\n`;
          }
        }

        return result;
      }

      case "get_knowledge_gaps": {
        const { limit = 20 } = args as { limit?: number };
        const response = await api.get(`/api/knowledge-gaps?projectName=${PROJECT_NAME}&limit=${limit}`);
        const gaps = response.data.gaps;

        if (!gaps || gaps.length === 0) {
          return "No knowledge gaps identified. The codebase appears well-documented!";
        }

        let result = `# Knowledge Gaps\n\nThese queries frequently return low results, indicating potential documentation gaps:\n\n`;
        for (const gap of gaps) {
          result += `- **"${gap.query}"** (${gap.count} searches, avg ${gap.avgResultCount.toFixed(1)} results)\n`;
          result += `  Tool: ${gap.toolName}\n\n`;
        }

        return result;
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

      // Confluence tools
      case "search_confluence": {
        const { query, limit = 5, spaceKey } = args as {
          query: string;
          limit?: number;
          spaceKey?: string;
        };
        const response = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}confluence`,
          query,
          limit,
          filters: spaceKey ? { spaceKey } : undefined,
        });
        const results = response.data.results;
        if (!results || results.length === 0) {
          return "No Confluence content found for this query. Make sure Confluence is indexed.";
        }
        return results
          .map(
            (r: any) =>
              `**${r.title || r.file}** (${(r.score * 100).toFixed(1)}% match)\n` +
              `Space: ${r.spaceKey || "N/A"} | [View](${r.url || "#"})\n\n` +
              r.content.slice(0, 600) +
              (r.content.length > 600 ? "\n..." : "")
          )
          .join("\n\n---\n\n");
      }

      case "index_confluence": {
        const { spaceKeys, labels, maxPages = 500, force = false } = args as {
          spaceKeys?: string[];
          labels?: string[];
          maxPages?: number;
          force?: boolean;
        };
        const response = await api.post("/api/index/confluence", {
          projectName: PROJECT_NAME,
          spaceKeys,
          labels,
          maxPages,
          force,
        });
        return `Confluence indexing started for ${PROJECT_NAME}.\n\n` +
          `Status: ${response.data.status}\n` +
          `Collection: ${response.data.collection}\n` +
          `Options: ${JSON.stringify(response.data.options, null, 2)}`;
      }

      case "get_confluence_status": {
        const response = await api.get("/api/confluence/status");
        return `**Confluence Status**\n\n` +
          `Configured: ${response.data.configured ? "Yes ✓" : "No ✗"}\n` +
          `Message: ${response.data.message}`;
      }

      case "list_confluence_spaces": {
        const response = await api.get("/api/confluence/spaces");
        const spaces = response.data.spaces;
        if (!spaces || spaces.length === 0) {
          return "No Confluence spaces found or Confluence not configured.";
        }
        return `**Available Confluence Spaces (${spaces.length})**\n\n` +
          spaces
            .map((s: any) => `- **${s.key}**: ${s.name} (${s.type})`)
            .join("\n");
      }

      // PM Tools handlers
      case "search_requirements": {
        const { query, limit = 5 } = args as { query: string; limit?: number };
        const response = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}confluence`,
          query,
          limit,
        });
        const results = response.data.results;
        if (!results || results.length === 0) {
          return "No requirements found. Make sure Confluence documentation is indexed.";
        }
        return `**Requirements Search: "${query}"**\n\n` +
          results
            .map(
              (r: any, i: number) =>
                `### ${i + 1}. ${r.title || "Requirement"}\n` +
                `**Relevance:** ${(r.score * 100).toFixed(1)}%\n` +
                `**Source:** ${r.url || "Confluence"}\n\n` +
                r.content.slice(0, 800) +
                (r.content.length > 800 ? "\n..." : "")
            )
            .join("\n\n---\n\n");
      }

      case "analyze_requirements": {
        const { feature, detailed = false } = args as { feature: string; detailed?: boolean };

        // Search requirements in Confluence
        const reqResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}confluence`,
          query: feature,
          limit: 5,
        });

        // Search implementation in codebase
        const codeResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query: feature,
          limit: detailed ? 10 : 5,
        });

        const requirements = reqResponse.data.results || [];
        const implementations = codeResponse.data.results || [];

        let result = `# Requirements Analysis: ${feature}\n\n`;

        result += `## 📋 Documented Requirements (${requirements.length} found)\n\n`;
        if (requirements.length === 0) {
          result += "_No documented requirements found in Confluence._\n\n";
        } else {
          requirements.forEach((r: any, i: number) => {
            result += `### ${i + 1}. ${r.title || "Requirement"}\n`;
            result += r.content.slice(0, 400) + "\n\n";
          });
        }

        result += `## 💻 Implementation Status (${implementations.length} files found)\n\n`;
        if (implementations.length === 0) {
          result += "_No implementation found in codebase._\n\n";
        } else {
          implementations.forEach((r: any) => {
            result += `- **${r.file}** (${(r.score * 100).toFixed(1)}% match)\n`;
            if (detailed) {
              result += "```" + (r.language || "") + "\n" + r.content.slice(0, 300) + "\n```\n";
            }
          });
        }

        result += `\n## 📊 Summary\n`;
        result += `- Requirements documented: ${requirements.length > 0 ? "Yes ✓" : "No ✗"}\n`;
        result += `- Implementation found: ${implementations.length > 0 ? "Yes ✓" : "No ✗"}\n`;

        if (requirements.length > 0 && implementations.length === 0) {
          result += `\n⚠️ **Gap detected:** Requirements exist but no implementation found.`;
        } else if (requirements.length === 0 && implementations.length > 0) {
          result += `\n⚠️ **Warning:** Implementation exists but no documented requirements.`;
        }

        return result;
      }

      case "estimate_feature": {
        const { feature, includeSubtasks = true } = args as { feature: string; includeSubtasks?: boolean };

        // Search for related requirements
        const reqResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}confluence`,
          query: feature,
          limit: 5,
        });

        // Search for related code
        const codeResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query: feature,
          limit: 15,
        });

        // Search for related tests
        const testResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query: `${feature} test spec`,
          limit: 10,
          filter: { must: [{ key: "file", match: { text: "test" } }] },
        }).catch(() => ({ data: { results: [] } }));

        const requirements = reqResponse.data.results || [];
        const relatedCode = codeResponse.data.results || [];
        const relatedTests = testResponse.data.results || [];

        // Analyze complexity based on findings
        const hasRequirements = requirements.length > 0;
        const hasExistingCode = relatedCode.length > 0;
        const hasTests = relatedTests.length > 0;
        const affectedFiles = Array.from(new Set(relatedCode.map((r: any) => r.payload?.file || r.file))) as string[];
        const testFiles = Array.from(new Set(relatedTests.map((r: any) => r.payload?.file || r.file))) as string[];

        // Advanced code complexity analysis
        let totalComplexityScore = 0;
        let totalIntegrationPoints = 0;
        const integrations = new Set<string>();
        const complexFunctions: string[] = [];

        for (const result of relatedCode) {
          const content = result.payload?.content || result.content || "";

          // Count complexity indicators
          const ifCount = (content.match(/\bif\s*\(/g) || []).length;
          const elseCount = (content.match(/\belse\b/g) || []).length;
          const switchCount = (content.match(/\bswitch\s*\(/g) || []).length;
          const forCount = (content.match(/\bfor\s*\(/g) || []).length;
          const whileCount = (content.match(/\bwhile\s*\(/g) || []).length;
          const tryCount = (content.match(/\btry\s*\{/g) || []).length;
          const asyncCount = (content.match(/\basync\b/g) || []).length;
          const awaitCount = (content.match(/\bawait\b/g) || []).length;

          // Cyclomatic complexity approximation
          const complexity = 1 + ifCount + elseCount + switchCount + forCount + whileCount + tryCount;
          totalComplexityScore += complexity;

          // Track complex functions (rough estimate)
          if (complexity > 10) {
            const funcMatch = content.match(/(?:function|const|async)\s+(\w+)/);
            if (funcMatch) {
              complexFunctions.push(`${result.payload?.file || result.file}: ${funcMatch[1]}() - complexity ~${complexity}`);
            }
          }

          // Analyze integration points
          const imports = content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
          const requires = content.match(/require\s*\(['"]([^'"]+)['"]\)/g) || [];
          const apiCalls = content.match(/(?:axios|fetch|http|api)\.[a-z]+\(/gi) || [];
          const dbOps = content.match(/(?:prisma|mongoose|sequelize|knex|db)\.[a-z]+/gi) || [];
          const externalServices = content.match(/(?:redis|kafka|rabbitmq|queue|cache)\.[a-z]+/gi) || [];

          [...imports, ...requires].forEach(imp => {
            const match = imp.match(/['"]([^'"]+)['"]/);
            if (match && !match[1].startsWith(".")) {
              integrations.add(`Package: ${match[1]}`);
            }
          });

          if (apiCalls.length > 0) integrations.add("HTTP/API calls");
          if (dbOps.length > 0) integrations.add("Database operations");
          if (externalServices.length > 0) integrations.add("External services (cache/queue)");
          if (asyncCount > 3 || awaitCount > 3) integrations.add("Heavy async operations");

          totalIntegrationPoints += imports.length + requires.length + apiCalls.length + dbOps.length;
        }

        // Determine complexity level
        const avgComplexity = affectedFiles.length > 0 ? totalComplexityScore / relatedCode.length : 0;
        let complexity = "Low";
        let complexityScore = 0;

        // Factor 1: File count (0-30 points)
        if (affectedFiles.length > 15) complexityScore += 30;
        else if (affectedFiles.length > 8) complexityScore += 20;
        else if (affectedFiles.length > 3) complexityScore += 10;
        else complexityScore += 5;

        // Factor 2: Code complexity (0-30 points)
        if (avgComplexity > 15) complexityScore += 30;
        else if (avgComplexity > 8) complexityScore += 20;
        else if (avgComplexity > 4) complexityScore += 10;
        else complexityScore += 5;

        // Factor 3: Integration points (0-20 points)
        if (integrations.size > 6) complexityScore += 20;
        else if (integrations.size > 3) complexityScore += 15;
        else if (integrations.size > 1) complexityScore += 10;
        else complexityScore += 5;

        // Factor 4: Test coverage (0-20 points) - less tests = more risk
        const testRatio = affectedFiles.length > 0 ? testFiles.length / affectedFiles.length : 0;
        if (testRatio < 0.2) complexityScore += 20;
        else if (testRatio < 0.5) complexityScore += 15;
        else if (testRatio < 0.8) complexityScore += 10;
        else complexityScore += 5;

        if (complexityScore >= 70) complexity = "Very High";
        else if (complexityScore >= 50) complexity = "High";
        else if (complexityScore >= 30) complexity = "Medium";
        else complexity = "Low";

        // Risk assessment
        const riskFactors: string[] = [];
        let riskScore = 0;

        if (!hasRequirements) {
          riskFactors.push("No documented requirements - scope unclear");
          riskScore += 25;
        }
        if (affectedFiles.length > 10) {
          riskFactors.push(`Wide impact: ${affectedFiles.length} files affected`);
          riskScore += 20;
        }
        if (!hasTests) {
          riskFactors.push("No existing tests found - regression risk");
          riskScore += 20;
        }
        if (integrations.has("Database operations")) {
          riskFactors.push("Database changes - migration complexity");
          riskScore += 15;
        }
        if (integrations.has("External services (cache/queue)")) {
          riskFactors.push("External service dependencies");
          riskScore += 15;
        }
        if (complexFunctions.length > 3) {
          riskFactors.push(`${complexFunctions.length} complex functions to modify`);
          riskScore += 15;
        }
        if (!hasExistingCode) {
          riskFactors.push("New development - no patterns to follow");
          riskScore += 10;
        }

        let riskLevel = "Low";
        if (riskScore >= 60) riskLevel = "Critical";
        else if (riskScore >= 40) riskLevel = "High";
        else if (riskScore >= 20) riskLevel = "Medium";

        // Build result
        let result = `# Feature Estimation: ${feature}\n\n`;

        result += `## 📊 Overview\n`;
        result += `| Metric | Value |\n`;
        result += `|--------|-------|\n`;
        result += `| Complexity | **${complexity}** (score: ${complexityScore}/100) |\n`;
        result += `| Risk Level | **${riskLevel}** (score: ${riskScore}/100) |\n`;
        result += `| Affected Files | ${affectedFiles.length} |\n`;
        result += `| Test Files | ${testFiles.length} (ratio: ${(testRatio * 100).toFixed(0)}%) |\n`;
        result += `| Integration Points | ${integrations.size} |\n`;
        result += `| Avg Cyclomatic Complexity | ${avgComplexity.toFixed(1)} |\n`;
        result += `| Requirements Documented | ${hasRequirements ? "✅ Yes" : "❌ No"} |\n\n`;

        if (integrations.size > 0) {
          result += `## 🔗 Integration Points\n`;
          Array.from(integrations).slice(0, 10).forEach((i: string) => {
            result += `- ${i}\n`;
          });
          result += "\n";
        }

        if (affectedFiles.length > 0) {
          result += `## 📁 Affected Files\n`;
          affectedFiles.slice(0, 15).forEach((f: string) => {
            const hasTest = testFiles.some(t => t.includes(f.replace(/\.(ts|js|py|go)$/, "")));
            result += `- ${f} ${hasTest ? "✓" : "⚠️ no tests"}\n`;
          });
          if (affectedFiles.length > 15) {
            result += `- ... and ${affectedFiles.length - 15} more\n`;
          }
          result += "\n";
        }

        if (complexFunctions.length > 0) {
          result += `## 🔥 Complex Functions (may need refactoring)\n`;
          complexFunctions.slice(0, 5).forEach((f: string) => {
            result += `- ${f}\n`;
          });
          result += "\n";
        }

        result += `## ⚠️ Risk Factors\n`;
        if (riskFactors.length > 0) {
          riskFactors.forEach(r => {
            result += `- ${r}\n`;
          });
        } else {
          result += `- No significant risks identified\n`;
        }
        result += "\n";

        if (includeSubtasks) {
          result += `## 📝 Suggested Subtasks\n`;
          let taskNum = 1;
          result += `${taskNum++}. Review and clarify requirements\n`;
          if (!hasRequirements) {
            result += `${taskNum++}. Document requirements\n`;
          }
          if (hasExistingCode) {
            result += `${taskNum++}. Analyze existing implementation and complexity\n`;
            if (complexFunctions.length > 0) {
              result += `${taskNum++}. Refactor complex functions if needed\n`;
            }
            result += `${taskNum++}. Plan modifications\n`;
          } else {
            result += `${taskNum++}. Design solution architecture\n`;
            result += `${taskNum++}. Implement core functionality\n`;
          }
          if (integrations.has("Database operations")) {
            result += `${taskNum++}. Create database migrations\n`;
          }
          result += `${taskNum++}. Write/update tests (target: >${affectedFiles.length} test cases)\n`;
          if (integrations.has("External services (cache/queue)")) {
            result += `${taskNum++}. Integration testing with external services\n`;
          }
          result += `${taskNum++}. Code review & QA\n`;
          result += `${taskNum++}. Documentation update\n`;
        }

        return result;
      }

      case "get_feature_status": {
        const { feature } = args as { feature: string };

        const reqResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}confluence`,
          query: feature,
          limit: 3,
        });

        const codeResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query: feature,
          limit: 5,
        });

        const requirements = reqResponse.data.results || [];
        const implementations = codeResponse.data.results || [];

        let status = "Unknown";
        let statusEmoji = "❓";

        if (requirements.length > 0 && implementations.length > 0) {
          status = "Implemented";
          statusEmoji = "✅";
        } else if (requirements.length > 0 && implementations.length === 0) {
          status = "Planned (Not Implemented)";
          statusEmoji = "📋";
        } else if (requirements.length === 0 && implementations.length > 0) {
          status = "Implemented (Undocumented)";
          statusEmoji = "⚠️";
        } else {
          status = "Not Found";
          statusEmoji = "❌";
        }

        let result = `# Feature Status: ${feature}\n\n`;
        result += `## ${statusEmoji} Status: ${status}\n\n`;

        if (requirements.length > 0) {
          result += `### 📋 Requirements\n`;
          requirements.forEach((r: any) => {
            result += `- ${r.title || "Requirement"}: ${r.content.slice(0, 150)}...\n`;
          });
          result += "\n";
        }

        if (implementations.length > 0) {
          result += `### 💻 Implementation\n`;
          implementations.forEach((r: any) => {
            result += `- ${r.file}\n`;
          });
        }

        return result;
      }

      case "list_requirements": {
        const { category, limit = 20 } = args as { category?: string; limit?: number };

        const query = category || "requirements features specifications";
        const response = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}confluence`,
          query,
          limit,
        });

        const results = response.data.results || [];

        if (results.length === 0) {
          return "No requirements found in Confluence. Make sure documentation is indexed.";
        }

        let result = `# ${PROJECT_NAME} Requirements\n\n`;
        if (category) {
          result += `**Category filter:** ${category}\n\n`;
        }
        result += `**Found:** ${results.length} items\n\n`;

        results.forEach((r: any, i: number) => {
          result += `${i + 1}. **${r.title || "Untitled"}**\n`;
          result += `   ${r.content.slice(0, 150).replace(/\n/g, " ")}...\n`;
          if (r.url) {
            result += `   [View in Confluence](${r.url})\n`;
          }
          result += "\n";
        });

        return result;
      }

      case "ask_pm": {
        const { question } = args as { question: string };

        // Search both requirements and codebase for context
        const [reqResponse, codeResponse] = await Promise.all([
          api.post("/api/search", {
            collection: `${COLLECTION_PREFIX}confluence`,
            query: question,
            limit: 5,
          }),
          api.post("/api/search", {
            collection: `${COLLECTION_PREFIX}codebase`,
            query: question,
            limit: 3,
          }),
        ]);

        const requirements = reqResponse.data.results || [];
        const code = codeResponse.data.results || [];

        // Use LLM to answer the question with context
        try {
          const response = await api.post("/api/ask", {
            collection: `${COLLECTION_PREFIX}confluence`,
            question: `As a Product Manager, answer this question about the project:\n\n${question}\n\nUse the provided context from requirements documentation.`,
          });

          let result = `# PM Question: ${question}\n\n`;
          result += `## Answer\n${response.data.answer}\n\n`;

          if (requirements.length > 0) {
            result += `## 📚 Related Documentation\n`;
            requirements.slice(0, 3).forEach((r: any) => {
              result += `- ${r.title || "Doc"}: ${r.content.slice(0, 100)}...\n`;
            });
          }

          if (code.length > 0) {
            result += `\n## 💻 Related Code\n`;
            code.slice(0, 3).forEach((r: any) => {
              result += `- ${r.file}\n`;
            });
          }

          return result;
        } catch {
          // Fallback without LLM
          let result = `# PM Question: ${question}\n\n`;
          result += `## Related Information\n\n`;

          if (requirements.length > 0) {
            result += `### From Requirements:\n`;
            requirements.forEach((r: any) => {
              result += `**${r.title || "Doc"}**\n${r.content.slice(0, 300)}\n\n`;
            });
          }

          return result;
        }
      }

      case "generate_spec": {
        const { feature, format = "markdown" } = args as { feature: string; format?: string };

        // Get requirements
        const reqResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}confluence`,
          query: feature,
          limit: 5,
        });

        // Get existing code for patterns
        const codeResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query: feature,
          limit: 5,
        });

        const requirements = reqResponse.data.results || [];
        const code = codeResponse.data.results || [];

        // Build context for LLM
        const requirementsContext = requirements.length > 0
          ? requirements.map((r: any) => r.content).join("\n---\n")
          : "No documented requirements found.";

        const codeContext = code.length > 0
          ? code.map((c: any) => `File: ${c.file}\n${c.content.slice(0, 300)}`).join("\n---\n")
          : "No existing implementation found.";

        // Use LLM to generate real specification
        const specPrompt = `Generate a detailed technical specification for: "${feature}"

Requirements from documentation:
${requirementsContext}

Existing code context:
${codeContext}

Generate a complete specification including:
1. Overview and objectives
2. Detailed functional requirements with acceptance criteria
3. Technical approach with specific implementation details
4. API contracts (if applicable)
5. Database changes (if applicable)
6. Testing strategy
7. Rollout considerations`;

        try {
          const llmResponse = await api.post("/api/ask", {
            collection: `${COLLECTION_PREFIX}codebase`,
            question: specPrompt,
          });

          let result = `# Technical Specification: ${feature}\n\n`;

          if (format === "jira") {
            // Convert to Jira format
            result = `h1. ${feature}\n\n`;
            result += llmResponse.data.answer
              .replace(/^## /gm, "h2. ")
              .replace(/^### /gm, "h3. ")
              .replace(/^- \[ \]/gm, "* [ ]")
              .replace(/^- /gm, "* ");
          } else if (format === "brief") {
            // Brief summary
            const answer = llmResponse.data.answer;
            const firstParagraph = answer.split("\n\n")[0] || answer.slice(0, 300);
            result = `**${feature}**\n\n${firstParagraph}\n\n`;
            result += `**Files affected:** ${code.map((c: any) => c.file).join(", ") || "New implementation"}`;
          } else {
            // Full markdown
            result += llmResponse.data.answer;

            // Add appendix with source files
            if (code.length > 0) {
              result += `\n\n---\n## Appendix: Related Files\n`;
              code.forEach((c: any) => {
                result += `- \`${c.file}\`\n`;
              });
            }
          }

          return result;
        } catch (llmError) {
          // Fallback to template if LLM fails
          let result = `# Technical Specification: ${feature}\n\n`;
          result += `## 1. Overview\n${requirements[0]?.content.slice(0, 500) || "_Add feature overview_"}\n\n`;
          result += `## 2. Requirements\n_LLM generation failed. Add requirements manually._\n\n`;
          result += `## 3. Affected Files\n`;
          code.forEach((c: any) => { result += `- \`${c.file}\`\n`; });
          return result;
        }
      }

      // Agent Memory Tools handlers
      case "remember": {
        const { content, type = "note", tags = [], relatedTo } = args as {
          content: string;
          type?: string;
          tags?: string[];
          relatedTo?: string;
        };

        const response = await api.post("/api/memory", {
          projectName: PROJECT_NAME,
          content,
          type,
          tags,
          relatedTo,
        });

        const memory = response.data.memory;
        return `✅ **Memory stored**\n\n` +
          `- **ID:** ${memory.id}\n` +
          `- **Type:** ${memory.type}\n` +
          `- **Content:** ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}\n` +
          (tags.length > 0 ? `- **Tags:** ${tags.join(", ")}\n` : "") +
          (relatedTo ? `- **Related to:** ${relatedTo}\n` : "") +
          `- **Created:** ${new Date(memory.createdAt).toLocaleString()}`;
      }

      case "recall": {
        const { query, type = "all", limit = 5 } = args as {
          query: string;
          type?: string;
          limit?: number;
        };

        const response = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query,
          type,
          limit,
        });

        const results = response.data.results || [];
        if (results.length === 0) {
          return `🔍 No memories found for: "${query}"`;
        }

        let result = `🧠 **Recalled Memories** (${results.length} found)\n\n`;
        const typeEmojis: Record<string, string> = {
          decision: "🎯",
          insight: "💡",
          context: "📌",
          todo: "📋",
          conversation: "💬",
          note: "📝",
        };
        results.forEach((r: any, i: number) => {
          const m = r.memory;
          const typeEmoji = m.type === "todo" && m.status === "done" ? "✅" : (typeEmojis[m.type as string] || "📝");

          result += `### ${i + 1}. ${typeEmoji} ${m.type.toUpperCase()}\n`;
          result += `**Relevance:** ${(r.score * 100).toFixed(1)}%\n`;
          result += `${m.content}\n`;
          if (m.relatedTo) result += `*Related to: ${m.relatedTo}*\n`;
          if (m.tags?.length > 0) result += `*Tags: ${m.tags.join(", ")}*\n`;
          if (m.status) result += `*Status: ${m.status}*\n`;
          result += `*${new Date(m.createdAt).toLocaleDateString()}*\n\n`;
        });

        return result;
      }

      case "list_memories": {
        const { type = "all", tag, limit = 10 } = args as {
          type?: string;
          tag?: string;
          limit?: number;
        };

        const params = new URLSearchParams({
          projectName: PROJECT_NAME,
          limit: limit.toString(),
        });
        if (type && type !== "all") params.append("type", type);
        if (tag) params.append("tag", tag);

        const response = await api.get(`/api/memory/list?${params}`);
        const memories = response.data.memories || [];

        if (memories.length === 0) {
          return `📭 No memories found${type !== "all" ? ` of type "${type}"` : ""}`;
        }

        let result = `📚 **Agent Memories** (${memories.length})\n\n`;
        const typeEmojis: Record<string, string> = {
          decision: "🎯",
          insight: "💡",
          context: "📌",
          todo: "📋",
          conversation: "💬",
          note: "📝",
        };

        memories.forEach((m: any, i: number) => {
          const emoji = typeEmojis[m.type] || "📝";
          const statusStr = m.status ? ` [${m.status}]` : "";
          result += `${i + 1}. ${emoji} **${m.type}**${statusStr}: ${m.content.slice(0, 100)}${m.content.length > 100 ? "..." : ""}\n`;
          result += `   ID: \`${m.id}\` | ${new Date(m.createdAt).toLocaleDateString()}\n\n`;
        });

        return result;
      }

      case "forget": {
        const { memoryId, type, olderThanDays } = args as {
          memoryId?: string;
          type?: string;
          olderThanDays?: number;
        };

        if (memoryId) {
          const response = await api.delete(`/api/memory/${memoryId}?projectName=${PROJECT_NAME}`);
          return response.data.success
            ? `🗑️ Memory deleted: ${memoryId}`
            : `❌ Failed to delete memory: ${memoryId}`;
        }

        if (type) {
          const response = await api.delete(`/api/memory/type/${type}?projectName=${PROJECT_NAME}`);
          return `🗑️ Deleted all memories of type: ${type}`;
        }

        return "Please specify memoryId or type to delete.";
      }

      case "update_todo": {
        const { todoId, status, note } = args as {
          todoId: string;
          status: string;
          note?: string;
        };

        const response = await api.patch(`/api/memory/todo/${todoId}`, {
          projectName: PROJECT_NAME,
          status,
          note,
        });

        if (!response.data.memory) {
          return `❌ Todo not found: ${todoId}`;
        }

        const statusEmoji: Record<string, string> = {
          pending: "⏳",
          in_progress: "🔄",
          done: "✅",
          cancelled: "❌",
        };

        return `${statusEmoji[status] || "📋"} **Todo updated**\n\n` +
          `- **ID:** ${todoId}\n` +
          `- **Status:** ${status}\n` +
          (note ? `- **Note:** ${note}\n` : "") +
          `- **Content:** ${response.data.memory.content}`;
      }

      // Architecture Agent Tools handlers
      case "record_adr": {
        const { title, context, decision, consequences, alternatives, status = "accepted", tags = [] } = args as {
          title: string;
          context: string;
          decision: string;
          consequences?: string;
          alternatives?: string;
          status?: string;
          tags?: string[];
        };

        const adrContent = `# ADR: ${title}

## Status
${status.toUpperCase()}

## Context
${context}

## Decision
${decision}

${consequences ? `## Consequences\n${consequences}\n` : ""}
${alternatives ? `## Alternatives Considered\n${alternatives}` : ""}`;

        const response = await api.post("/api/memory", {
          projectName: PROJECT_NAME,
          content: adrContent,
          type: "decision",
          tags: ["adr", ...tags],
          relatedTo: title,
          metadata: { adrTitle: title, adrStatus: status },
        });

        return `📋 **ADR Recorded**\n\n` +
          `- **ID:** ${response.data.memory.id}\n` +
          `- **Title:** ${title}\n` +
          `- **Status:** ${status}\n` +
          `- **Tags:** ${["adr", ...tags].join(", ")}\n\n` +
          `Use \`get_adrs\` to retrieve this decision later.`;
      }

      case "get_adrs": {
        const { query, status = "all", limit = 10 } = args as {
          query?: string;
          status?: string;
          limit?: number;
        };

        const response = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: query || "architecture decision ADR",
          type: "decision",
          limit,
        });

        const results = response.data.results || [];
        const adrs = results.filter((r: any) =>
          r.memory.tags?.includes("adr") &&
          (status === "all" || r.memory.metadata?.adrStatus === status)
        );

        if (adrs.length === 0) {
          return `📭 No ADRs found${query ? ` for "${query}"` : ""}`;
        }

        let result = `📋 **Architecture Decision Records** (${adrs.length})\n\n`;
        const adrStatusIcons: Record<string, string> = {
          proposed: "🟡",
          accepted: "🟢",
          deprecated: "🔴",
          superseded: "⚫",
        };
        adrs.forEach((r: any, i: number) => {
          const m = r.memory;
          const adrStatus = (m.metadata?.adrStatus || "accepted") as string;
          const statusIcon = adrStatusIcons[adrStatus] || "⚪";

          result += `### ${i + 1}. ${statusIcon} ${m.metadata?.adrTitle || m.relatedTo || "ADR"}\n`;
          result += `**Status:** ${adrStatus} | **ID:** \`${m.id}\`\n\n`;
          result += m.content.slice(0, 500) + (m.content.length > 500 ? "\n..." : "") + "\n\n";
        });

        return result;
      }

      case "record_pattern": {
        const { name, description, structure, example, appliesTo, tags = [] } = args as {
          name: string;
          description: string;
          structure: string;
          example?: string;
          appliesTo?: string;
          tags?: string[];
        };

        const patternContent = `# Pattern: ${name}

## Description
${description}

## Structure
${structure}

${example ? `## Example\n\`\`\`\n${example}\n\`\`\`\n` : ""}
${appliesTo ? `## Applies To\n${appliesTo}` : ""}`;

        const response = await api.post("/api/memory", {
          projectName: PROJECT_NAME,
          content: patternContent,
          type: "context",
          tags: ["pattern", ...tags],
          relatedTo: name,
          metadata: { patternName: name, appliesTo },
        });

        return `🏗️ **Pattern Recorded**\n\n` +
          `- **Name:** ${name}\n` +
          `- **ID:** ${response.data.memory.id}\n` +
          (appliesTo ? `- **Applies To:** ${appliesTo}\n` : "") +
          `- **Tags:** ${["pattern", ...tags].join(", ")}`;
      }

      case "get_patterns": {
        const { query, appliesTo, limit = 10 } = args as {
          query?: string;
          appliesTo?: string;
          limit?: number;
        };

        const response = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: query || "architectural pattern structure",
          type: "context",
          limit,
        });

        const results = response.data.results || [];
        const patterns = results.filter((r: any) => {
          const isPattern = r.memory.tags?.includes("pattern");
          const matchesAppliesTo = !appliesTo ||
            r.memory.metadata?.appliesTo?.toLowerCase().includes(appliesTo.toLowerCase());
          return isPattern && matchesAppliesTo;
        });

        if (patterns.length === 0) {
          return `📭 No patterns found${query ? ` for "${query}"` : ""}`;
        }

        let result = `🏗️ **Architectural Patterns** (${patterns.length})\n\n`;
        patterns.forEach((r: any, i: number) => {
          const m = r.memory;
          result += `### ${i + 1}. ${m.metadata?.patternName || m.relatedTo || "Pattern"}\n`;
          if (m.metadata?.appliesTo) {
            result += `**Applies to:** ${m.metadata.appliesTo}\n`;
          }
          result += `**ID:** \`${m.id}\`\n\n`;
          result += m.content.slice(0, 600) + (m.content.length > 600 ? "\n..." : "") + "\n\n";
        });

        return result;
      }

      case "check_architecture": {
        const { code, filePath, featureDescription } = args as {
          code?: string;
          filePath?: string;
          featureDescription?: string;
        };

        // Get relevant patterns
        const patternQuery = filePath || featureDescription || "architectural patterns";
        const patternsResponse = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: patternQuery,
          type: "context",
          limit: 5,
        });

        // Get relevant ADRs
        const adrsResponse = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: patternQuery,
          type: "decision",
          limit: 5,
        });

        // Search similar code in codebase
        let similarCode: any[] = [];
        if (code) {
          const codeResponse = await api.post("/api/search", {
            collection: `${COLLECTION_PREFIX}codebase`,
            query: code.slice(0, 500),
            limit: 3,
          });
          similarCode = codeResponse.data.results || [];
        }

        const patterns = (patternsResponse.data.results || []).filter((r: any) =>
          r.memory.tags?.includes("pattern")
        );
        const adrs = (adrsResponse.data.results || []).filter((r: any) =>
          r.memory.tags?.includes("adr")
        );

        let result = `# 🔍 Architecture Check\n\n`;

        if (filePath) {
          result += `**File:** ${filePath}\n\n`;
        }
        if (featureDescription) {
          result += `**Feature:** ${featureDescription}\n\n`;
        }

        // If we have code and patterns/ADRs, perform actual validation
        if (code && (patterns.length > 0 || adrs.length > 0)) {
          const patternRules = patterns.map((p: any) =>
            `Pattern: ${p.memory.metadata?.patternName || p.memory.relatedTo}\nDescription: ${p.memory.content.slice(0, 300)}`
          ).join("\n\n");

          const adrRules = adrs.map((a: any) =>
            `ADR: ${a.memory.metadata?.adrTitle || a.memory.relatedTo}\nDecision: ${a.memory.content.slice(0, 300)}`
          ).join("\n\n");

          const validationPrompt = `Analyze if this code follows the established architectural patterns and decisions.

Code to validate:
\`\`\`
${code.slice(0, 2000)}
\`\`\`

Patterns to check against:
${patternRules || "None recorded"}

Architectural Decisions (ADRs):
${adrRules || "None recorded"}

Provide a structured analysis:
1. List any violations of patterns or ADRs
2. Rate compliance (1-10)
3. Specific recommendations for improvements`;

          try {
            const validationResponse = await api.post("/api/ask", {
              collection: `${COLLECTION_PREFIX}codebase`,
              question: validationPrompt,
            });

            result += `## 🎯 Validation Results\n\n`;
            result += validationResponse.data.answer;
            result += "\n\n";
          } catch (e) {
            // Continue without LLM validation
          }
        }

        result += `## 📋 Applicable Patterns (${patterns.length})\n`;
        if (patterns.length === 0) {
          result += `_No specific patterns recorded for this area._\n\n`;
        } else {
          patterns.forEach((p: any) => {
            result += `- **${p.memory.metadata?.patternName || p.memory.relatedTo}**: ${p.memory.content.slice(0, 100)}...\n`;
          });
          result += "\n";
        }

        result += `## 📜 Relevant ADRs (${adrs.length})\n`;
        if (adrs.length === 0) {
          result += `_No relevant architectural decisions found._\n\n`;
        } else {
          adrs.forEach((a: any) => {
            result += `- **${a.memory.metadata?.adrTitle || a.memory.relatedTo}** [${a.memory.metadata?.adrStatus || "accepted"}]: ${a.memory.content.slice(0, 100)}...\n`;
          });
          result += "\n";
        }

        if (similarCode.length > 0) {
          result += `## 💻 Similar Existing Code\n`;
          result += `_Review these for consistency:_\n`;
          similarCode.forEach((c: any) => {
            result += `- ${c.file}\n`;
          });
          result += "\n";
        }

        result += `## ✅ Recommendations\n`;
        if (patterns.length > 0) {
          result += `- Follow the patterns listed above for consistency\n`;
        }
        if (adrs.length > 0) {
          result += `- Ensure compliance with recorded architectural decisions\n`;
        }
        if (similarCode.length > 0) {
          result += `- Check similar code for established conventions\n`;
        }
        if (patterns.length === 0 && adrs.length === 0) {
          result += `- Consider recording patterns/ADRs for this area with \`record_pattern\` and \`record_adr\`\n`;
        }

        return result;
      }

      case "suggest_architecture": {
        const { feature, type = "other" } = args as {
          feature: string;
          type?: string;
        };

        // Get patterns for this type
        const patternsResponse = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: `${type} ${feature} pattern structure`,
          type: "context",
          limit: 5,
        });

        // Get relevant ADRs
        const adrsResponse = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: `${type} ${feature}`,
          type: "decision",
          limit: 3,
        });

        // Get similar implementations
        const codeResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query: `${type} ${feature}`,
          limit: 5,
        });

        const patterns = (patternsResponse.data.results || []).filter((r: any) =>
          r.memory.tags?.includes("pattern")
        );
        const adrs = (adrsResponse.data.results || []).filter((r: any) =>
          r.memory.tags?.includes("adr")
        );
        const existingCode = codeResponse.data.results || [];

        let result = `# 🏗️ Architecture Suggestion: ${feature}\n\n`;
        result += `**Type:** ${type}\n\n`;

        result += `## 📋 Recommended Patterns\n`;
        if (patterns.length === 0) {
          result += `_No specific patterns recorded. Consider following existing code conventions._\n\n`;
        } else {
          patterns.forEach((p: any) => {
            result += `### ${p.memory.metadata?.patternName || p.memory.relatedTo}\n`;
            result += p.memory.content.slice(0, 400) + "\n\n";
          });
        }

        result += `## 🎯 Relevant Decisions (ADRs)\n`;
        if (adrs.length === 0) {
          result += `_No specific ADRs found for this area._\n\n`;
        } else {
          adrs.forEach((a: any) => {
            result += `- **${a.memory.metadata?.adrTitle || a.memory.relatedTo}**: `;
            const decision = a.memory.content.match(/## Decision\n([\s\S]*?)(?=\n##|$)/);
            result += decision ? decision[1].slice(0, 150).trim() : "See full ADR";
            result += "\n";
          });
          result += "\n";
        }

        result += `## 💻 Reference Implementations\n`;
        if (existingCode.length === 0) {
          result += `_No similar implementations found._\n\n`;
        } else {
          result += `_Study these for conventions:_\n`;
          existingCode.forEach((c: any) => {
            result += `- \`${c.file}\`\n`;
          });
          result += "\n";
        }

        result += `## 📝 Next Steps\n`;
        result += `1. Review the patterns and ADRs above\n`;
        result += `2. Study reference implementations for conventions\n`;
        result += `3. Create your implementation following established structure\n`;
        result += `4. Use \`check_architecture\` to validate before committing\n`;

        return result;
      }

      case "record_tech_debt": {
        const { title, description, location, impact, suggestedFix, relatedAdr } = args as {
          title: string;
          description: string;
          location?: string;
          impact: string;
          suggestedFix?: string;
          relatedAdr?: string;
        };

        const debtContent = `# Tech Debt: ${title}

## Impact
${impact.toUpperCase()}

## Description
${description}

${location ? `## Location\n${location}\n` : ""}
${suggestedFix ? `## Suggested Fix\n${suggestedFix}\n` : ""}
${relatedAdr ? `## Related ADR\n${relatedAdr}` : ""}`;

        const response = await api.post("/api/memory", {
          projectName: PROJECT_NAME,
          content: debtContent,
          type: "insight",
          tags: ["tech-debt", `impact-${impact}`],
          relatedTo: title,
          metadata: { debtTitle: title, impact, location },
        });

        const impactEmoji = {
          low: "🟢",
          medium: "🟡",
          high: "🟠",
          critical: "🔴",
        }[impact] || "⚪";

        return `${impactEmoji} **Tech Debt Recorded**\n\n` +
          `- **Title:** ${title}\n` +
          `- **Impact:** ${impact}\n` +
          `- **ID:** ${response.data.memory.id}\n` +
          (location ? `- **Location:** ${location}\n` : "");
      }

      case "get_tech_debt": {
        const { impact = "all", limit = 10 } = args as {
          impact?: string;
          limit?: number;
        };

        const response = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: "technical debt violation issue",
          type: "insight",
          limit: limit * 2, // Get more to filter
        });

        const results = response.data.results || [];
        const debts = results.filter((r: any) => {
          const isDebt = r.memory.tags?.includes("tech-debt");
          const matchesImpact = impact === "all" ||
            r.memory.metadata?.impact === impact ||
            r.memory.tags?.includes(`impact-${impact}`);
          return isDebt && matchesImpact;
        }).slice(0, limit);

        if (debts.length === 0) {
          return `✅ No tech debt found${impact !== "all" ? ` with ${impact} impact` : ""}`;
        }

        const impactEmoji: Record<string, string> = {
          low: "🟢",
          medium: "🟡",
          high: "🟠",
          critical: "🔴",
        };

        let result = `⚠️ **Technical Debt** (${debts.length})\n\n`;
        debts.forEach((r: any, i: number) => {
          const m = r.memory;
          const debtImpact = m.metadata?.impact || "medium";
          const emoji = impactEmoji[debtImpact] || "⚪";

          result += `### ${i + 1}. ${emoji} ${m.metadata?.debtTitle || m.relatedTo || "Tech Debt"}\n`;
          result += `**Impact:** ${debtImpact}`;
          if (m.metadata?.location) {
            result += ` | **Location:** ${m.metadata.location}`;
          }
          result += `\n**ID:** \`${m.id}\`\n\n`;

          // Extract description
          const descMatch = m.content.match(/## Description\n([\s\S]*?)(?=\n##|$)/);
          if (descMatch) {
            result += descMatch[1].slice(0, 200).trim() + "\n\n";
          }
        });

        return result;
      }

      case "analyze_project_structure": {
        const { path, deep = false } = args as {
          path?: string;
          deep?: boolean;
        };

        // Get all recorded patterns
        const patternsResponse = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: "pattern structure organization",
          type: "context",
          limit: 10,
        });

        // Get codebase structure
        const codeResponse = await api.post("/api/search", {
          collection: `${COLLECTION_PREFIX}codebase`,
          query: path || "module service controller",
          limit: deep ? 20 : 10,
        });

        const patterns = (patternsResponse.data.results || []).filter((r: any) =>
          r.memory.tags?.includes("pattern")
        );
        const codeFiles = codeResponse.data.results || [];

        // Analyze file organization
        const filesByDir: Record<string, string[]> = {};
        codeFiles.forEach((c: any) => {
          const dir = c.file.split("/").slice(0, -1).join("/") || "/";
          if (!filesByDir[dir]) filesByDir[dir] = [];
          filesByDir[dir].push(c.file.split("/").pop());
        });

        let result = `# 📊 Project Structure Analysis\n\n`;

        if (path) {
          result += `**Scope:** ${path}\n\n`;
        }

        result += `## 📁 Directory Structure\n`;
        Object.entries(filesByDir).slice(0, 10).forEach(([dir, files]) => {
          result += `\n**${dir || "/"}/**\n`;
          files.slice(0, 5).forEach(f => {
            result += `  - ${f}\n`;
          });
          if (files.length > 5) {
            result += `  - ... and ${files.length - 5} more\n`;
          }
        });

        result += `\n## 🏗️ Recorded Patterns (${patterns.length})\n`;
        if (patterns.length === 0) {
          result += `⚠️ _No patterns recorded yet. Consider documenting your architectural patterns._\n\n`;
        } else {
          patterns.forEach((p: any) => {
            result += `- ${p.memory.metadata?.patternName || p.memory.relatedTo}`;
            if (p.memory.metadata?.appliesTo) {
              result += ` → ${p.memory.metadata.appliesTo}`;
            }
            result += "\n";
          });
        }

        result += `\n## 💡 Recommendations\n`;
        if (patterns.length === 0) {
          result += `1. **Record patterns** - Use \`record_pattern\` to document how code should be structured\n`;
        }
        result += `2. **Document decisions** - Use \`record_adr\` for important architectural choices\n`;
        result += `3. **Track tech debt** - Use \`record_tech_debt\` for violations and issues\n`;
        result += `4. **Validate changes** - Use \`check_architecture\` before committing new code\n`;

        return result;
      }

      // Database Architecture Agent Handlers
      case "record_table": {
        const { tableName, purpose, columns, relationships, indexes, rules } = args as {
          tableName: string;
          purpose: string;
          columns: string;
          relationships?: string;
          indexes?: string;
          rules?: string;
        };

        const content = `## Table: ${tableName}

**Purpose:** ${purpose}

### Columns
${columns}

${relationships ? `### Relationships\n${relationships}\n` : ""}
${indexes ? `### Indexes\n${indexes}\n` : ""}
${rules ? `### Business Rules\n${rules}` : ""}`;

        await api.post("/api/memory", {
          projectName: PROJECT_NAME,
          content,
          type: "context",
          tags: ["database", "schema", "table", tableName.toLowerCase()],
          relatedTo: `table:${tableName}`,
          metadata: {
            tableType: "table",
            tableName,
          },
        });

        return `✅ Recorded table **${tableName}** documentation.\n\nUse \`get_table_info "${tableName}"\` to retrieve it later.`;
      }

      case "get_table_info": {
        const { tableName } = args as { tableName: string };

        const response = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: tableName === "all" ? "database table schema" : `table ${tableName}`,
          tag: "table",
          limit: tableName === "all" ? 20 : 5,
        });

        const tables = response.data.results || [];

        if (tables.length === 0) {
          return `📭 No documentation found for ${tableName === "all" ? "any tables" : `table "${tableName}"`}.\n\nUse \`record_table\` to document tables.`;
        }

        let result = tableName === "all"
          ? `# 🗃️ Database Tables (${tables.length})\n\n`
          : `# 🗃️ Table: ${tableName}\n\n`;

        tables.forEach((t: any) => {
          result += t.memory.content + "\n\n---\n\n";
        });

        return result;
      }

      case "record_db_rule": {
        const { ruleName, description, scope, examples } = args as {
          ruleName: string;
          description: string;
          scope: string;
          examples?: string;
        };

        const content = `## DB Rule: ${ruleName}

**Scope:** ${scope}

${description}

${examples ? `### Examples\n${examples}` : ""}`;

        await api.post("/api/memory", {
          projectName: PROJECT_NAME,
          content,
          type: "decision",
          tags: ["database", "rule", scope],
          relatedTo: `db-rule:${ruleName}`,
          metadata: {
            ruleType: "db-rule",
            ruleName,
            scope,
          },
        });

        return `✅ Recorded database rule: **${ruleName}** (scope: ${scope})`;
      }

      case "get_db_rules": {
        const { scope = "all" } = args as { scope?: string };

        const response = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: scope === "all" ? "database rule constraint" : `database rule ${scope}`,
          tag: "rule",
          limit: 15,
        });

        const rules = response.data.results || [];

        if (rules.length === 0) {
          return `📭 No database rules found${scope !== "all" ? ` for scope "${scope}"` : ""}.\n\nUse \`record_db_rule\` to document rules.`;
        }

        let result = `# 📜 Database Rules (${rules.length})\n\n`;

        rules.forEach((r: any) => {
          const m = r.memory;
          result += m.content + "\n\n---\n\n";
        });

        return result;
      }

      case "record_enum": {
        const { enumName, values, usedIn, transitions } = args as {
          enumName: string;
          values: string;
          usedIn?: string;
          transitions?: string;
        };

        const content = `## Enum: ${enumName}

### Values
${values}

${usedIn ? `### Used In\n${usedIn}\n` : ""}
${transitions ? `### State Transitions\n${transitions}` : ""}`;

        await api.post("/api/memory", {
          projectName: PROJECT_NAME,
          content,
          type: "context",
          tags: ["database", "schema", "enum", enumName.toLowerCase()],
          relatedTo: `enum:${enumName}`,
          metadata: {
            tableType: "enum",
            enumName,
          },
        });

        return `✅ Recorded enum **${enumName}** documentation.`;
      }

      case "get_enums": {
        const { enumName } = args as { enumName?: string };

        const response = await api.post("/api/memory/recall", {
          projectName: PROJECT_NAME,
          query: enumName ? `enum ${enumName}` : "database enum type values",
          tag: "enum",
          limit: 15,
        });

        const enums = response.data.results || [];

        if (enums.length === 0) {
          return `📭 No enum documentation found${enumName ? ` for "${enumName}"` : ""}.\n\nUse \`record_enum\` to document enums.`;
        }

        let result = `# 📋 Database Enums (${enums.length})\n\n`;

        enums.forEach((e: any) => {
          result += e.memory.content + "\n\n---\n\n";
        });

        return result;
      }

      case "check_db_schema": {
        const { change, sql } = args as { change: string; sql?: string };

        // Get relevant rules and existing schema
        const [rulesRes, tablesRes] = await Promise.all([
          api.post("/api/memory/recall", {
            projectName: PROJECT_NAME,
            query: "database rule constraint naming convention",
            tag: "rule",
            limit: 10,
          }),
          api.post("/api/memory/recall", {
            projectName: PROJECT_NAME,
            query: change,
            tag: "table",
            limit: 5,
          }),
        ]);

        const rules = rulesRes.data.results || [];
        const relatedTables = tablesRes.data.results || [];

        let result = `# 🔍 Schema Change Review\n\n`;
        result += `**Proposed Change:** ${change}\n\n`;

        if (sql) {
          result += `**SQL/Schema:**\n\`\`\`sql\n${sql}\n\`\`\`\n\n`;
        }

        result += `## 📜 Applicable Rules (${rules.length})\n`;
        if (rules.length === 0) {
          result += `⚠️ _No database rules documented. Consider adding rules with \`record_db_rule\`._\n\n`;
        } else {
          rules.forEach((r: any) => {
            const m = r.memory;
            result += `- **${m.metadata?.ruleName || m.relatedTo}** (${m.metadata?.scope || "general"})\n`;
          });
          result += "\n";
        }

        result += `## 🗃️ Related Tables (${relatedTables.length})\n`;
        if (relatedTables.length === 0) {
          result += `_No documented tables found related to this change._\n\n`;
        } else {
          relatedTables.forEach((t: any) => {
            result += `- ${t.memory.metadata?.tableName || t.memory.relatedTo}\n`;
          });
          result += "\n";
        }

        result += `## ✅ Checklist\n`;
        result += `- [ ] Follows naming conventions\n`;
        result += `- [ ] Has appropriate indexes\n`;
        result += `- [ ] Foreign keys properly defined\n`;
        result += `- [ ] NOT NULL constraints where needed\n`;
        result += `- [ ] Default values appropriate\n`;
        result += `- [ ] Multi-tenant (partnerId) considered\n`;
        result += `- [ ] Migration is reversible\n`;

        return result;
      }

      case "suggest_db_schema": {
        const { requirement, relatedTables } = args as {
          requirement: string;
          relatedTables?: string;
        };

        // Get existing schema patterns and rules
        const [rulesRes, tablesRes, enumsRes] = await Promise.all([
          api.post("/api/memory/recall", {
            projectName: PROJECT_NAME,
            query: "database rule naming convention pattern",
            tag: "rule",
            limit: 5,
          }),
          api.post("/api/memory/recall", {
            projectName: PROJECT_NAME,
            query: relatedTables || requirement,
            tag: "table",
            limit: 5,
          }),
          api.post("/api/memory/recall", {
            projectName: PROJECT_NAME,
            query: requirement,
            tag: "enum",
            limit: 3,
          }),
        ]);

        const rules = rulesRes.data.results || [];
        const tables = tablesRes.data.results || [];
        const enums = enumsRes.data.results || [];

        let result = `# 💡 Schema Suggestion\n\n`;
        result += `**Requirement:** ${requirement}\n\n`;

        if (relatedTables) {
          result += `**Related Tables:** ${relatedTables}\n\n`;
        }

        result += `## 📚 Existing Context\n\n`;

        if (tables.length > 0) {
          result += `### Related Tables\n`;
          tables.forEach((t: any) => {
            result += `- **${t.memory.metadata?.tableName || t.memory.relatedTo}**\n`;
          });
          result += "\n";
        }

        if (enums.length > 0) {
          result += `### Available Enums\n`;
          enums.forEach((e: any) => {
            result += `- ${e.memory.metadata?.enumName || e.memory.relatedTo}\n`;
          });
          result += "\n";
        }

        if (rules.length > 0) {
          result += `### Rules to Follow\n`;
          rules.forEach((r: any) => {
            result += `- ${r.memory.metadata?.ruleName || r.memory.relatedTo}: ${r.memory.content.slice(0, 100)}...\n`;
          });
          result += "\n";
        }

        result += `## 🏗️ Suggestions\n\n`;
        result += `Based on the existing schema patterns:\n\n`;
        result += `1. **Table naming**: Use snake_case, plural (e.g., \`notifications\`)\n`;
        result += `2. **Primary key**: UUID with \`gen_random_uuid()\`\n`;
        result += `3. **Timestamps**: Include \`created_at\`, \`updated_at\`\n`;
        result += `4. **Multi-tenant**: Add \`partner_id UUID NOT NULL\` with FK\n`;
        result += `5. **Soft delete**: Consider \`deleted_at\` timestamp\n`;
        result += `6. **Status fields**: Use PostgreSQL ENUMs\n`;

        result += `\n## 📝 Next Steps\n`;
        result += `1. Design the schema using suggestions above\n`;
        result += `2. Run \`check_db_schema\` to validate\n`;
        result += `3. Create Prisma migration\n`;
        result += `4. Document with \`record_table\` after creation\n`;

        return result;
      }

      // ============================================
      // Code Review & Testing Tools
      // ============================================
      case "review_code": {
        const { code, filePath, reviewType = "general", diff } = args as {
          code: string;
          filePath?: string;
          reviewType?: string;
          diff?: string;
        };

        const response = await api.post("/api/review", {
          code: code || diff,
          filePath,
          reviewType,
          diff,
        });

        const { review, context } = response.data;

        let result = `# 🔍 Code Review\n\n`;

        if (review.score) {
          result += `**Score**: ${review.score}/10\n\n`;
        }

        if (review.summary) {
          result += `## Summary\n${review.summary}\n\n`;
        }

        if (review.issues && review.issues.length > 0) {
          result += `## Issues Found\n`;
          review.issues.forEach((issue: any, i: number) => {
            const icon = issue.severity === 'critical' ? '🚨' :
                        issue.severity === 'high' ? '⚠️' :
                        issue.severity === 'medium' ? '📋' : 'ℹ️';
            result += `\n### ${icon} ${i + 1}. ${issue.type} (${issue.severity})\n`;
            result += `${issue.description}\n`;
            if (issue.line) result += `- Line: ${issue.line}\n`;
            if (issue.suggestion) result += `- Fix: ${issue.suggestion}\n`;
          });
          result += "\n";
        }

        if (review.positives && review.positives.length > 0) {
          result += `## ✅ Positives\n`;
          review.positives.forEach((p: string) => {
            result += `- ${p}\n`;
          });
          result += "\n";
        }

        if (review.suggestions && review.suggestions.length > 0) {
          result += `## 💡 Suggestions\n`;
          review.suggestions.forEach((s: string) => {
            result += `- ${s}\n`;
          });
        }

        result += `\n---\n_Context: ${context.patternsUsed} patterns, ${context.adrsUsed} ADRs, ${context.similarFilesFound} similar files_`;

        return result;
      }

      case "generate_tests": {
        const { code, filePath, framework = "jest", testType = "unit", coverage = "comprehensive" } = args as {
          code: string;
          filePath?: string;
          framework?: string;
          testType?: string;
          coverage?: string;
        };

        const response = await api.post("/api/generate-tests", {
          code,
          filePath,
          framework,
          testType,
          coverage,
        });

        const { tests, analysis, existingPatternsFound } = response.data;

        let result = `# 🧪 Generated Tests\n\n`;
        result += `**Framework**: ${framework}\n`;
        result += `**Type**: ${testType}\n`;
        result += `**Coverage**: ${coverage}\n`;
        result += `**Existing patterns found**: ${existingPatternsFound}\n\n`;

        if (analysis) {
          result += `## Code Analysis\n`;
          result += `- Functions: ${analysis.functions?.join(', ') || 'none'}\n`;
          result += `- Classes: ${analysis.classes?.join(', ') || 'none'}\n`;
          result += `- Complexity: ${analysis.estimatedComplexity}\n\n`;
        }

        result += `## Generated Test Code\n\n`;
        result += "```" + (framework === 'pytest' ? 'python' : 'typescript') + "\n";
        result += tests;
        result += "\n```\n";

        return result;
      }

      case "analyze_tests": {
        const { testCode, sourceCode } = args as {
          testCode: string;
          sourceCode?: string;
        };

        const response = await api.post("/api/analyze-tests", {
          testCode,
          sourceCode,
        });

        const { analysis } = response.data;

        let result = `# 📊 Test Analysis\n\n`;

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
          result += `## ✅ Strengths\n`;
          analysis.strengths.forEach((s: string) => {
            result += `- ${s}\n`;
          });
          result += "\n";
        }

        if (analysis.weaknesses && analysis.weaknesses.length > 0) {
          result += `## ⚠️ Weaknesses\n`;
          analysis.weaknesses.forEach((w: string) => {
            result += `- ${w}\n`;
          });
          result += "\n";
        }

        if (analysis.missingTests && analysis.missingTests.length > 0) {
          result += `## 📝 Missing Tests\n`;
          analysis.missingTests.forEach((t: string) => {
            result += `- ${t}\n`;
          });
        }

        return result;
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
