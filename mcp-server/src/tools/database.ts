/**
 * Database Tools - Schema documentation, rules, enums, and validation.
 */

import type { ToolModule, ToolContext } from "../types.js";

export function createDatabaseTools(projectName: string): ToolModule {
  const tools = [
    {
      name: "record_table",
      description: `Record a database table definition with its purpose, columns, and relationships. Use this to document the database schema for ${projectName}.`,
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
            description:
              "Key columns and their purposes (format: 'column_name: description')",
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
      description:
        "Get documented information about a database table including its purpose, columns, relationships, and rules.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tableName: {
            type: "string",
            description:
              "Table name to look up (or 'all' to list all tables)",
          },
        },
        required: ["tableName"],
      },
    },
    {
      name: "record_db_rule",
      description:
        "Record a database rule or constraint that should be followed. Use this for data integrity rules, naming conventions, or query patterns.",
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
      description: `Get database rules and constraints for ${projectName}. Filter by scope or get all rules.`,
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
      description:
        "Record a database enum type with its values and usage. Use this to document allowed values for status fields, types, etc.",
      inputSchema: {
        type: "object" as const,
        properties: {
          enumName: {
            type: "string",
            description:
              "Name of the enum (e.g., 'ClaimStatus', 'DocumentType')",
          },
          values: {
            type: "string",
            description:
              "List of enum values with descriptions (format: 'value: description')",
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
      description: `Get documented enum types for ${projectName} database.`,
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
      description:
        "Check if a proposed database change follows the documented rules and patterns. Use before creating migrations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          change: {
            type: "string",
            description:
              "Description of the proposed change (new table, column, index, etc.)",
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
      description:
        "Get suggestions for database schema design for a new feature or data requirement.",
      inputSchema: {
        type: "object" as const,
        properties: {
          requirement: {
            type: "string",
            description:
              "What data needs to be stored or what feature needs support",
          },
          relatedTables: {
            type: "string",
            description: "Existing tables that might be related",
          },
        },
        required: ["requirement"],
      },
    },
  ];

  const handlers: ToolModule["handlers"] = {
    async record_table(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
      const { tableName, purpose, columns, relationships, indexes, rules } =
        args as {
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

      await ctx.api.post("/api/memory", {
        projectName: ctx.projectName,
        content,
        type: "context",
        tags: ["database", "schema", "table", tableName.toLowerCase()],
        relatedTo: `table:${tableName}`,
        metadata: {
          tableType: "table",
          tableName,
        },
      });

      return `Recorded table **${tableName}** documentation.\n\nUse \`get_table_info "${tableName}"\` to retrieve it later.`;
    },

    async get_table_info(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
      const { tableName } = args as { tableName: string };

      const response = await ctx.api.post("/api/memory/recall", {
        projectName: ctx.projectName,
        query:
          tableName === "all" ? "database table schema" : `table ${tableName}`,
        tag: "table",
        limit: tableName === "all" ? 20 : 5,
      });

      const tables = response.data.results || [];

      if (tables.length === 0) {
        return `No documentation found for ${tableName === "all" ? "any tables" : `table "${tableName}"`}.\n\nUse \`record_table\` to document tables.`;
      }

      let result =
        tableName === "all"
          ? `# Database Tables (${tables.length})\n\n`
          : `# Table: ${tableName}\n\n`;

      tables.forEach((t: any) => {
        result += t.memory.content + "\n\n---\n\n";
      });

      return result;
    },

    async record_db_rule(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
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

      await ctx.api.post("/api/memory", {
        projectName: ctx.projectName,
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

      return `Recorded database rule: **${ruleName}** (scope: ${scope})`;
    },

    async get_db_rules(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
      const { scope = "all" } = args as { scope?: string };

      const response = await ctx.api.post("/api/memory/recall", {
        projectName: ctx.projectName,
        query:
          scope === "all"
            ? "database rule constraint"
            : `database rule ${scope}`,
        tag: "rule",
        limit: 15,
      });

      const rules = response.data.results || [];

      if (rules.length === 0) {
        return `No database rules found${scope !== "all" ? ` for scope "${scope}"` : ""}.\n\nUse \`record_db_rule\` to document rules.`;
      }

      let result = `# Database Rules (${rules.length})\n\n`;

      rules.forEach((r: any) => {
        const m = r.memory;
        result += m.content + "\n\n---\n\n";
      });

      return result;
    },

    async record_enum(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
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

      await ctx.api.post("/api/memory", {
        projectName: ctx.projectName,
        content,
        type: "context",
        tags: ["database", "schema", "enum", enumName.toLowerCase()],
        relatedTo: `enum:${enumName}`,
        metadata: {
          tableType: "enum",
          enumName,
        },
      });

      return `Recorded enum **${enumName}** documentation.`;
    },

    async get_enums(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
      const { enumName } = args as { enumName?: string };

      const response = await ctx.api.post("/api/memory/recall", {
        projectName: ctx.projectName,
        query: enumName
          ? `enum ${enumName}`
          : "database enum type values",
        tag: "enum",
        limit: 15,
      });

      const enums = response.data.results || [];

      if (enums.length === 0) {
        return `No enum documentation found${enumName ? ` for "${enumName}"` : ""}.\n\nUse \`record_enum\` to document enums.`;
      }

      let result = `# Database Enums (${enums.length})\n\n`;

      enums.forEach((e: any) => {
        result += e.memory.content + "\n\n---\n\n";
      });

      return result;
    },

    async check_db_schema(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
      const { change, sql } = args as { change: string; sql?: string };

      // Get relevant rules and existing schema
      const [rulesRes, tablesRes] = await Promise.all([
        ctx.api.post("/api/memory/recall", {
          projectName: ctx.projectName,
          query: "database rule constraint naming convention",
          tag: "rule",
          limit: 10,
        }),
        ctx.api.post("/api/memory/recall", {
          projectName: ctx.projectName,
          query: change,
          tag: "table",
          limit: 5,
        }),
      ]);

      const rules = rulesRes.data.results || [];
      const relatedTables = tablesRes.data.results || [];

      let result = `# Schema Change Review\n\n`;
      result += `**Proposed Change:** ${change}\n\n`;

      if (sql) {
        result += `**SQL/Schema:**\n\`\`\`sql\n${sql}\n\`\`\`\n\n`;
      }

      result += `## Applicable Rules (${rules.length})\n`;
      if (rules.length === 0) {
        result += `_No database rules documented. Consider adding rules with \`record_db_rule\`._\n\n`;
      } else {
        rules.forEach((r: any) => {
          const m = r.memory;
          result += `- **${m.metadata?.ruleName || m.relatedTo}** (${m.metadata?.scope || "general"})\n`;
        });
        result += "\n";
      }

      result += `## Related Tables (${relatedTables.length})\n`;
      if (relatedTables.length === 0) {
        result += `_No documented tables found related to this change._\n\n`;
      } else {
        relatedTables.forEach((t: any) => {
          result += `- ${t.memory.metadata?.tableName || t.memory.relatedTo}\n`;
        });
        result += "\n";
      }

      result += `## Checklist\n`;
      result += `- [ ] Follows naming conventions\n`;
      result += `- [ ] Has appropriate indexes\n`;
      result += `- [ ] Foreign keys properly defined\n`;
      result += `- [ ] NOT NULL constraints where needed\n`;
      result += `- [ ] Default values appropriate\n`;
      result += `- [ ] Multi-tenant (partnerId) considered\n`;
      result += `- [ ] Migration is reversible\n`;

      return result;
    },

    async suggest_db_schema(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<string> {
      const { requirement, relatedTables } = args as {
        requirement: string;
        relatedTables?: string;
      };

      // Get existing schema patterns and rules
      const [rulesRes, tablesRes, enumsRes] = await Promise.all([
        ctx.api.post("/api/memory/recall", {
          projectName: ctx.projectName,
          query: "database rule naming convention pattern",
          tag: "rule",
          limit: 5,
        }),
        ctx.api.post("/api/memory/recall", {
          projectName: ctx.projectName,
          query: relatedTables || requirement,
          tag: "table",
          limit: 5,
        }),
        ctx.api.post("/api/memory/recall", {
          projectName: ctx.projectName,
          query: requirement,
          tag: "enum",
          limit: 3,
        }),
      ]);

      const rules = rulesRes.data.results || [];
      const tables = tablesRes.data.results || [];
      const enums = enumsRes.data.results || [];

      let result = `# Schema Suggestion\n\n`;
      result += `**Requirement:** ${requirement}\n\n`;

      if (relatedTables) {
        result += `**Related Tables:** ${relatedTables}\n\n`;
      }

      result += `## Existing Context\n\n`;

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

      result += `## Suggestions\n\n`;
      result += `Based on the existing schema patterns:\n\n`;
      result += `1. **Table naming**: Use snake_case, plural (e.g., \`notifications\`)\n`;
      result += `2. **Primary key**: UUID with \`gen_random_uuid()\`\n`;
      result += `3. **Timestamps**: Include \`created_at\`, \`updated_at\`\n`;
      result += `4. **Multi-tenant**: Add \`partner_id UUID NOT NULL\` with FK\n`;
      result += `5. **Soft delete**: Consider \`deleted_at\` timestamp\n`;
      result += `6. **Status fields**: Use PostgreSQL ENUMs\n`;

      result += `\n## Next Steps\n`;
      result += `1. Design the schema using suggestions above\n`;
      result += `2. Run \`check_db_schema\` to validate\n`;
      result += `3. Create Prisma migration\n`;
      result += `4. Document with \`record_table\` after creation\n`;

      return result;
    },
  };

  return { tools, handlers };
}
