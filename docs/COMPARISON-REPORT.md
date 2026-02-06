# Shared AI Infra: Competitive Comparison Report

> Updated: February 2026 (post-PIP v2)

## Executive Summary

**shared-ai-infra** is a self-hosted RAG infrastructure for AI coding assistants with per-project isolation. After PIP v2 (6 sprints of architectural improvements), the platform now covers all key capabilities that were previously gaps versus commercial competitors.

| Capability | Pre-PIP v2 | Post-PIP v2 | Closest Competitor |
|---|---|---|---|
| Code Graph / Dependencies | No | **Yes** (regex-based, N-hop expansion) | Greptile, Augment |
| AST-aware Chunking | No | **Yes** (6 parsers: code, config, docs, contracts, AST) | Windsurf |
| Quality Gates | No | **Yes** (tsc, tests, blast radius) | Augment |
| Memory Governance | No | **Yes** (quarantine/durable split, promotion gates) | Mem0 |
| Structured Fact Extraction | No | **Yes** (agent observation parsing, audit log) | - |
| Context Pack Builder | No | **Yes** (faceted retrieval, LLM rerank, token budget) | Augment Context Engine |

---

## Feature Matrix

| Feature | shared-ai-infra | Greptile | Sourcegraph Cody | Cursor | Continue.dev | Augment Code | Windsurf | Aider | LlamaIndex | Mem0 | RAGFlow |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Open Source** | Yes | No | Partial | No | Yes | No | No | Yes | Yes | Partial | Yes |
| **Self-Hosted** | Yes | Paid | Partial | No | Yes | No | No | Yes | Yes | Yes | Yes |
| **MCP Native** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes |
| **Code Search** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Limited | DIY | No | No |
| **Hybrid Search** | Yes | ? | Yes | ? | Yes | Yes | ? | No | DIY | No | Yes |
| **Code Graph** | **Yes** | Yes | Yes | Yes | No | Yes | Yes | Partial | No | No | No |
| **AST Chunking** | **Yes** | ? | Yes | ? | No | Yes | Yes | No | No | No | No |
| **Agent Memory** | Yes | No | No | Yes | No | Yes | Yes | No | Yes | **Yes** | No |
| **Memory Governance** | **Yes** | No | No | No | No | No | No | No | No | No | No |
| **Session Context** | Yes | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Quality Gates** | **Yes** | Yes | No | No | No | Yes | No | No | No | No | Yes |
| **Multi-Project Isolation** | Yes | Partial | Yes | Weak | Limited | Yes | N/A | No | DIY | Yes | Yes |
| **Flexible Embeddings** | Yes | No | No | No | Yes | No | No | N/A | Yes | Partial | Yes |
| **Flexible LLM** | Yes | No | Partial | Partial | Yes | No | No | Yes | Yes | Partial | Partial |
| **Agent Runtime** | Yes | No | No | No | No | No | No | No | Yes | No | Yes |
| **Prometheus Metrics** | Yes | N/A | N/A | No | No | N/A | No | No | No | No | No |
| **Token Budget** | **Yes** | ? | ? | ? | No | Yes | ? | No | No | No | No |

Legend: **Yes** = feature added in PIP v2; Yes = existed before; DIY = possible but requires custom code; N/A = not applicable

---

## Detailed Comparison by Category

### A. Code Understanding

| Aspect | shared-ai-infra (post-PIP v2) | Best-in-Class |
|---|---|---|
| **Indexing** | Multi-collection: `_code`, `_config`, `_docs`, `_contracts` + legacy `_codebase` | Augment: real-time cross-repo, 400K+ files |
| **Chunking** | 6 parsers: code (function/class boundaries), config (top-level keys), docs (headers), contracts (message/service), AST (symbols/imports), fallback (line-based) | Windsurf: full AST with Riptide engine |
| **Code Graph** | Regex-based edge extraction (imports, extends, implements), Qdrant storage, N-hop expansion, blast radius analysis | Greptile: language-agnostic graph with Mermaid diagrams |
| **Search** | Semantic, keyword, hybrid (BM25 + vector), grouped, graph-expanded | Sourcegraph: industry-leading code search at scale |
| **Context Assembly** | Context Pack Builder: faceted retrieval -> hybrid fusion -> LLM rerank -> token budget -> guardrails (ADRs, test commands) | Augment Context Engine: 3x faster with proprietary model |

**Assessment**: PIP v2 brings shared-ai-infra to parity with mid-tier commercial tools. Regex-based graph extraction covers ~80% of use cases but lacks the accuracy of full AST parsing (Greptile, Windsurf). The Context Pack Builder with LLM reranking and token budgets is a differentiator vs. most open-source alternatives.

### B. Agent Memory

| Aspect | shared-ai-infra (post-PIP v2) | Best-in-Class |
|---|---|---|
| **Memory Types** | 6 types: decision, insight, context, todo, conversation, note | Mem0: automatic entity extraction with graph relationships |
| **Governance** | **Unique**: quarantine/durable split, auto-generated memories go to `_memory_pending`, manual promotion with reason (human_validated, pr_merged, tests_passed) | No competitor has memory governance |
| **Structured Knowledge** | ADRs, patterns, tech debt, enums, DB rules, table definitions | Cursor: flat "Memories"; Augment: style-learning |
| **Fact Extraction** | Agent observations parsed into structured facts with provenance (file, line range), stored via governance pipeline | No direct competitor |
| **Enrichment** | Context enrichment middleware auto-recalls durable memories before tool execution | Augment: real-time learning from interactions |
| **Merge/Dedup** | Memory merge with similarity threshold and LLM consolidation | Mem0: automatic deduplication |

**Assessment**: Memory governance is a **unique differentiator** -- no competitor separates auto-generated memories from validated ones. This prevents the feedback loop where bad auto-memories corrupt future enrichment. Mem0 has better entity extraction and cross-tool sharing (OpenMemory MCP), but lacks governance gates.

### C. Quality & Safety

| Aspect | shared-ai-infra (post-PIP v2) | Best-in-Class |
|---|---|---|
| **Type Checking** | `tsc --noEmit` gate with affected file filtering, 30s timeout | Augment: adaptive code review with 59% F-score |
| **Test Running** | Auto-detects vitest/jest, runs `--related` tests, 60s timeout | Greptile: confidence scores on PR reviews |
| **Blast Radius** | Graph-based transitive impact analysis, warns if >20 files affected | Augment: cross-system dependency tracking |
| **Promotion Gates** | Quality gates run before memory promotion (optional) | No competitor gates memory promotion |
| **Observability** | 30+ Prometheus metrics across all subsystems | RAGFlow: visual chunk quality review |

**Assessment**: Quality gates integrated into the memory promotion workflow is novel. Commercial tools like Augment and Greptile have more sophisticated code review, but they don't gate knowledge management on verification.

### D. Infrastructure & Operations

| Aspect | shared-ai-infra | Competitors |
|---|---|---|
| **Deployment** | Docker Compose (Qdrant + Ollama + BGE-M3 + Redis) | Most commercial: SaaS only |
| **Multi-Project** | Namespaced Qdrant collections per project (`{project}_*`), X-Project-Name header isolation | Augment: multi-repo; Sourcegraph: multi-repo; Cursor: leaky isolation |
| **Embedding Choice** | BGE-M3 (1024d, self-hosted), Ollama, OpenAI -- switchable via env var | Continue.dev: similar flexibility; Commercial: locked |
| **LLM Choice** | Ollama (local), OpenAI, Anthropic -- switchable via env var | Aider: LiteLLM (100+ models); Commercial: locked |
| **Zero-Downtime Reindex** | Qdrant alias swap | Augment: real-time incremental |
| **Caching** | 3-level: L1 in-memory, L2 Redis, L3 Qdrant; session-aware; predictive prefetch | Windsurf: local embedding cache |
| **Cost** | $0 (self-hosted on own hardware) | Greptile: ~$30/user/mo; Cursor: $20-40/mo; Augment: $30/user/mo |

---

## Competitive Positioning

### Where shared-ai-infra WINS

1. **Memory Governance** -- only solution with quarantine/promotion pipeline for auto-generated knowledge. Prevents the "garbage in, garbage out" problem that plagues Cursor's flat memories and Augment's auto-learning.

2. **Full Stack Ownership** -- embedding model, LLM, vector DB, caching all self-hosted and configurable. No vendor lock-in, no per-seat costs, complete data sovereignty. Critical for enterprises with data residency requirements.

3. **Multi-Project Isolation** -- architecturally clean namespace isolation at the Qdrant collection level. Cursor has documented memory bleed between projects; most other tools are single-repo.

4. **Structured Knowledge Model** -- 12+ knowledge types (ADRs, patterns, tech debt, enums, DB rules, table schemas, facts) vs. competitors' flat key-value memories.

5. **Observable by Default** -- 30+ Prometheus metrics covering every subsystem. No competitor offers this level of operational visibility in an open-source package.

6. **Quality-Gated Knowledge** -- tsc + test + blast radius gates can be required before memory promotion. No competitor gates knowledge management on code verification.

### Where shared-ai-infra is EQUAL

1. **Code Search** -- hybrid semantic + keyword search with grouping and graph expansion is comparable to Greptile and Sourcegraph for mid-size codebases (<100K files).

2. **Agent Memory** -- comparable to Mem0 in memory depth, with better type structure but weaker entity extraction.

3. **MCP Support** -- native MCP server with 60+ tools. On par with Augment Context Engine MCP and Cursor's MCP support.

4. **Context Assembly** -- Context Pack Builder (faceted retrieval + LLM rerank + token budget + guardrails) is competitive with Augment's Context Engine for projects under 50K files.

### Where shared-ai-infra LOSES

1. **Code Graph Accuracy** -- regex-based extraction covers imports/extends/implements but misses dynamic calls, type-level references, and cross-language dependencies. Greptile and Augment use full AST/LSP for higher accuracy.

2. **Scale** -- single Qdrant instance, sequential file processing, no distributed indexing. Augment handles 400K+ files in real-time; Sourcegraph scales to millions of files.

3. **Code Review** -- no PR-level review capability. Greptile generates PR briefs and inline review comments; Augment has 59% F-score code review.

4. **UI** -- API/MCP only. RAGFlow and Cognita offer web interfaces for configuration, monitoring, and manual review. No visual dashboard for memory quarantine review.

5. **Community / Ecosystem** -- single-developer project. LlamaIndex has 1000+ integrations; LangChain has the largest community; Mem0 raised $24M.

6. **Real-Time Indexing** -- batch-only indexing (including zero-downtime reindex). Augment and Windsurf index in real-time as files change.

---

## Architecture Comparison

### shared-ai-infra Stack (post-PIP v2)

```
MCP Server (per project)          60+ tools, context enrichment
       |
       | HTTP + X-Project-Name
       v
RAG API (:3100)                   Express, Zod validation, asyncHandler
  |          |          |
  v          v          v
Qdrant    Ollama     BGE-M3       Vector DB, LLM, Embeddings
(:6333)   (:11434)   (:8080)
  |
  v
Redis (:6380)                     Caching (L2), audit logs, session state
```

**Qdrant Collections per project (12):**
```
{project}_codebase      Legacy unified code index
{project}_code          AST-parsed source code        [PIP v2]
{project}_config        YAML/JSON/env configs         [PIP v2]
{project}_docs          Markdown documentation        [PIP v2]
{project}_contracts     OpenAPI/Proto/GraphQL          [PIP v2]
{project}_graph         Import/call/extends edges      [PIP v2]
{project}_agent_memory  Durable validated memories
{project}_memory_pending Quarantine for auto-memories  [PIP v2]
{project}_tool_usage    Analytics
{project}_sessions      Session tracking
{project}_feedback      Search/memory feedback
{project}_query_patterns Learned query patterns
```

**New Services (PIP v2):**
```
memory-governance.ts    Quarantine/promote/reject pipeline
fact-extractor.ts       Agent observation -> structured facts
quality-gates.ts        tsc + test + blast radius verification
context-pack.ts         Faceted retrieval + rerank + token budget
graph-store.ts          N-hop graph expansion, blast radius
parsers/                6 file parsers (code, config, docs, contracts, AST, registry)
```

### Comparison with Augment Context Engine

```
                    shared-ai-infra              Augment Context Engine
Deployment          Self-hosted Docker           SaaS (free MCP server)
Code Indexing       Batch, 6 parsers             Real-time, proprietary
Code Graph          Regex-based edges            Full AST/LSP
Search              Hybrid + graph expand        Proprietary (3x faster claimed)
Memory              Governed, 12+ types          Style-learning
Reranking           LLM-based                    Proprietary model
Token Budget        Configurable (500-32K)       Automatic
Quality Gates       tsc/test/blast-radius        Adaptive code review
Cost                $0 (own hardware)            Free tier, $30/user/mo team
Data Control        Full                         Cloud-processed
```

### Comparison with Mem0 (Memory Layer)

```
                    shared-ai-infra              Mem0
Memory Types        6 typed + ADRs/patterns      Auto-extracted entities
Governance          Quarantine -> promote         No governance
Validation          Quality gates before promote  No validation
Cross-Tool          MCP server per project       OpenMemory MCP (cross-tool)
Entity Extraction   Regex from agent traces      LLM-based (26% more accurate)
Graph               Code dependency graph         Entity relationship graph
Merge/Dedup         LLM-based merge              Automatic dedup
Cost                $0 self-hosted               Open core + paid platform
```

---

## Recommendations

### Short-Term Improvements (High Impact, Low Effort)

1. **Tree-sitter Integration** -- Replace regex-based graph extraction with tree-sitter for higher accuracy. Dependencies already scaffolded in ast-parser.ts. Would close the gap vs. Greptile/Augment.

2. **Memory Quarantine UI** -- Simple web dashboard for reviewing and promoting quarantined memories. Even a basic Express-served HTML page would differentiate vs. all competitors.

3. **File Watcher for Incremental Indexing** -- Use `chokidar` to watch project files and trigger incremental reindexing. Would move from batch-only to near-real-time, closing the gap vs. Augment/Windsurf.

### Medium-Term Improvements (High Impact, Medium Effort)

4. **PR Review Integration** -- GitHub webhook to trigger quality gates + context pack on PR creation. Would compete with Greptile's PR review capability.

5. **Cross-Project Memory Sharing** -- Selectively share validated memories between projects (e.g., company-wide coding standards). Similar to Mem0's OpenMemory but with governance.

6. **Multi-Modal Context** -- Extend parsers for images (diagrams, screenshots) via vision models. Pieces for Developers already captures browser/visual context.

### Long-Term Vision

7. **Distributed Indexing** -- Qdrant cluster mode + worker pool for parallel indexing. Required to compete with Augment at 100K+ file scale.

8. **Real-Time Collaboration** -- Multi-user session sharing with conflict-free memory updates. No competitor has this for RAG infrastructure.

---

## Conclusion

Post-PIP v2, shared-ai-infra occupies a unique position in the market:

- **vs. Commercial tools** (Greptile, Augment, Cursor, Windsurf): Comparable features at zero cost with full data sovereignty. Weaker in code graph accuracy and scale, but compensates with memory governance and structured knowledge that no commercial tool offers.

- **vs. Open-source frameworks** (LlamaIndex, LangChain, Continue.dev): More complete out-of-the-box for code-specific use cases. These frameworks require significant custom development to match shared-ai-infra's feature set.

- **vs. Specialized tools** (Mem0, RAGFlow): Broader scope -- combines code search, memory, graph, quality gates, and agent runtime in one platform. Individual tools may excel in their niche but can't provide the integrated experience.

The primary moat is **memory governance** -- no other tool prevents auto-generated knowledge from corrupting the knowledge base. As AI-assisted development scales, this will become critical for teams that rely on accumulated project intelligence.
