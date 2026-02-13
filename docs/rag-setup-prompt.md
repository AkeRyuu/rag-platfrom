# RAG Tools — First-Time Setup & Usage Guide

Paste this section into your project's `CLAUDE.md` when connecting RAG MCP for the first time.

---

## RAG MCP Tools

This project has a RAG (Retrieval-Augmented Generation) MCP server connected. It provides persistent memory, codebase search, and architectural knowledge across sessions.

### First-Time Setup (run once)

When you first connect to this project, perform these steps in order:

1. **Index the codebase:**
   ```
   Use `index_codebase` tool (no parameters needed — it indexes the entire project).
   Wait for completion. For large projects this may take a few minutes.
   ```

2. **Verify indexing:**
   ```
   Use `get_index_status` to confirm indexing completed successfully.
   Use `get_project_stats` to see collection sizes and verify data is present.
   ```

3. **Record initial architectural patterns** (optional but recommended):
   ```
   Use `record_pattern` to document key patterns in the codebase:
   - How API endpoints are structured
   - How services/modules are organized
   - Naming conventions
   - Test patterns
   ```

4. **Record key architectural decisions** (optional but recommended):
   ```
   Use `record_adr` to document known decisions:
   - Framework/library choices and why
   - Database schema design decisions
   - Authentication approach
   - Deployment strategy
   ```

### Daily Workflow

#### Before making ANY code change:

1. `recall` — check if there are relevant memories from previous sessions
2. `hybrid_search` — find existing implementations related to your task (best general search)
3. `get_patterns` — check established architectural patterns to follow
4. `get_adrs` — check architectural decisions that may constrain your approach

#### When exploring the codebase:

| Need | Tool | Example |
|------|------|---------|
| Find a specific file | Glob (built-in) | `**/*.config.ts` |
| Find exact string in code | Grep (built-in) | `className="header"` |
| Conceptual search | `search_codebase` | "how does authentication work" |
| Keyword + semantic search | `hybrid_search` | "user validation middleware" |
| Find a function/class/type | `find_symbol` | symbol: "UserService" |
| Understand file dependencies | `search_graph` | "auth module dependencies" |
| Ask a question about code | `ask_codebase` | "how are errors handled in API routes?" |
| Find where feature lives | `find_feature` | "user registration flow" |

#### Tool selection priority:

1. **Glob/Read** — when you know the file name or path
2. **Grep** — when searching for exact strings or symbols
3. **hybrid_search** — best general-purpose search (combines keyword + semantic)
4. **search_codebase** — pure semantic search by concept
5. **find_symbol** — fast lookup of functions, classes, types, interfaces
6. **search_graph** — understand imports and dependencies between files
7. **ask_codebase** — when you need a synthesized answer, not just code snippets

#### After completing significant work:

- `remember` — save important context, decisions, or insights for future sessions
- `record_adr` — document any architectural decision you made (with context and alternatives)
- `record_pattern` — document any new pattern you established

### Memory System

The RAG server has persistent memory that survives across sessions:

| Tool | Purpose | When to use |
|------|---------|-------------|
| `remember` | Save a piece of knowledge | After learning something important about the codebase |
| `recall` | Retrieve relevant memories | At the start of any task, to get prior context |
| `record_adr` | Save architectural decision | When you choose between alternatives |
| `get_adrs` | List past decisions | Before making decisions that might conflict |
| `record_pattern` | Save code pattern | When establishing a reusable pattern |
| `get_patterns` | List patterns | Before writing new code, to stay consistent |
| `record_tech_debt` | Log tech debt | When you notice something that needs fixing later |
| `get_tech_debt` | List tech debt | When looking for improvement opportunities |

### What to Remember

**DO save:**
- Architectural decisions and their reasoning
- Patterns that should be followed consistently
- Key file paths and their purposes
- Gotchas, workarounds, and non-obvious behaviors
- User preferences for code style or approach

**DON'T save:**
- Temporary debugging state
- Obvious information already in code comments
- Session-specific task details

### Re-indexing

Re-index when significant code changes happen:
- `index_codebase` — incremental index (only changed files)
- `reindex_zero_downtime` — full re-index without downtime (use after major refactors)

### Example: Starting a New Task

```
User: "Add email notification when user registers"

Claude's workflow:
1. recall("email notification registration")     → check prior context
2. hybrid_search("user registration")            → find registration code
3. hybrid_search("email notification sending")   → find email patterns
4. get_patterns(query: "notification")            → check notification patterns
5. get_adrs(query: "email")                       → check email-related decisions
6. find_symbol(symbol: "register")                → find registration function
7. search_graph(query: "registration module")     → understand dependencies
8. ... implement the feature ...
9. remember("Added email notifications on user registration using X service")
10. record_adr(title: "Use X for email notifications", ...)
```
