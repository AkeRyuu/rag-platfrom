# Master Sprint Plan: Shared AI Infrastructure

## Overview

Combined roadmap for all infrastructure improvements.

---

## Sprint Tracks

| Track | Focus | Sprints | Status |
|-------|-------|---------|--------|
| **Q** | Qdrant Performance | Q-Sprint 1-4 | ✅ Complete |
| **M** | Memory & Claude Integration | M-Sprint 1-6 | ✅ Complete |
| **R** | Refactoring & Code Quality | - | ✅ Complete |
| **L** | Learning & Training | L-Sprint 1-4 | ⏳ Not started |

---

## Combined Timeline

| Week | Qdrant Track | Memory Track | Status |
|------|--------------|--------------|--------|
| 1-2 | ✅ **Q-Sprint 1** Foundation | ✅ **M-Sprint 1** Auto-Learning | Done |
| 3-4 | ✅ **Q-Sprint 2** Advanced Search | ✅ **M-Sprint 2** Patterns | Done |
| 5-6 | ✅ **Q-Sprint 3** Operations | ✅ **M-Sprint 3** Proactive | Done |
| 7-8 | ✅ **Q-Sprint 4** Analytics | ✅ **M-Sprint 4** Feedback | Done |
| 9-10 | - | ✅ **M-Sprint 5** Caching | Done |
| 11-12 | - | ✅ **M-Sprint 6** Advanced | Done |

---

## Q-Track: Qdrant Performance (4 Sprints) — ✅ COMPLETE

### Q-Sprint 1: Foundation ✅ DONE
- ✅ Payload indexes
- ✅ Batch embedding
- ✅ Score threshold
- ✅ Faceted counts
- ✅ Collection info

### Q-Sprint 2: Advanced Search ✅ DONE
- ✅ Search with grouping (`grouped_search`)
- ✅ Hybrid BM25 + vector (`hybrid_search`)

### Q-Sprint 3: Operations ✅ DONE
- ✅ Collection aliases
- ✅ Zero-downtime reindex
- ✅ Parallel processing
- ✅ Semantic clustering (`cluster_code`)

### Q-Sprint 4: Analytics ✅ DONE
- ✅ Duplicate detection (`find_duplicates`)
- ✅ Collection analytics (`get_analytics`)
- ✅ Backup/restore (`backup_collection`)
- ✅ Scalar quantization

---

## M-Track: Memory & Claude Integration (6 Sprints) — ✅ COMPLETE

### M-Sprint 1: Foundation & Auto-Learning ✅ DONE
- ✅ Conversation analyzer (`analyze_conversation`)
- ✅ Auto-memory creation (`auto_remember`)
- ✅ Tool usage tracking (`get_tool_analytics`)

### M-Sprint 2: Pattern Recognition ✅ DONE
- ✅ Usage patterns (`get_usage_patterns`)
- ✅ Knowledge gaps (`get_knowledge_gaps`)
- ✅ Context summary (`summarize_context`)
- ✅ Changes summary (`summarize_changes`)
- ✅ Learning extraction (`extract_learnings`)

### M-Sprint 3: Proactive Intelligence ✅ DONE
- ✅ Contextual suggestions (`get_contextual_suggestions`)
- ✅ Session start (`start_session`)
- ✅ Session context (`get_session_context`)
- ✅ Session end (`end_session`)

### M-Sprint 4: Feedback & Quality ✅ DONE
- ✅ Search feedback (`feedback_search`)
- ✅ Memory feedback (`feedback_memory`)
- ✅ Query suggestions (`suggest_better_query`)
- ✅ Quality metrics (`get_quality_metrics`)

### M-Sprint 5: Smart Caching & Predictive Loading ✅ DONE
| Task | Tool | Status |
|------|------|--------|
| Related code | `suggest_related_code` | ✅ |
| Implementation refs | `suggest_implementation` | ✅ |
| Test patterns | `suggest_tests` | ✅ |
| Predictive loader | `get_prediction_stats` | ✅ |
| Session-aware caching | Multi-level cache (L1/L2/L3) | ✅ |
| Predictive prefetch | Background prefetch on session start/activity | ✅ |

### M-Sprint 6: Advanced Features ✅ DONE
| Task | Tool | Location | Status |
|------|------|----------|--------|
| Memory merge | `merge_memories` | `memory.ts:436-612` | ✅ |
| Completion context | `get_completion_context` | `code-suggestions.ts:334-404` | ✅ |
| Import suggestions | `get_import_suggestions` | `code-suggestions.ts:409-476` | ✅ |
| Type context | `get_type_context` | `code-suggestions.ts:481-549` | ✅ |

---

## R-Track: Refactoring & Code Quality — ✅ COMPLETE

### MCP Server Modularization ✅ DONE
- ✅ Extract 5,587-line monolith into 16 tool modules
- ✅ ToolRegistry for registration and dispatch
- ✅ Shared api-client, formatters, types
- ✅ ESLint configuration

### RAG API Code Quality ✅ DONE
- ✅ asyncHandler middleware (eliminates try/catch)
- ✅ Global error handler (ZodError, AppError, unknown)
- ✅ Zod validation schemas + validate() middleware
- ✅ validateProjectName middleware
- ✅ Shared types (api.ts) and filter builder
- ✅ Vitest config and test setup
- ✅ ESLint + Prettier configuration

---

## L-Track: Learning & Training (4 Sprints) — ⏳ NOT STARTED

Мета: замкнути цикл навчання — фідбек → покращення пошуку → кращий контекст → точніші відповіді.

**Baseline метрики** (eval, 41 запит):
- Recall@10: 91.9%, MRR: 0.846, P50 latency: 46ms
- Cross-file recall: 71.7% (найслабша ланка)

### L-Sprint 1: Feedback → Learning Loop ⏳

**Проблема**: Фідбек збирається (search_feedback, memory_feedback), але не впливає на якість результатів.

| # | Task | Description | Size |
|---|------|-------------|------|
| 1.1 | Feedback-weighted search | Бустити результати з "helpful" фідбеком, понижувати "not_helpful" при пошуку | M |
| 1.2 | Auto-promote memories | 3+ позитивних feedback_memory → автоматичний промоушен quarantine → durable | S |
| 1.3 | Auto-prune memories | 2+ "incorrect" фідбеків → автоматичне видалення/архівація пам'яті | S |
| 1.4 | Query rewriting | Запити схожі на раніше неуспішні → автопереписування через збережені `better_query` | M |

**Файли**: `vector-store.ts` (search boost), `memory-governance.ts` (auto-promote/prune), `query-learning.ts` (rewriting)

### L-Sprint 2: Cross-File Retrieval ⏳

**Проблема**: Cross-file запити мають 71.7% recall проти 100% у exact-match.

| # | Task | Description | Size |
|---|------|-------------|------|
| 2.1 | Graph-boosted search | Розширювати результати через `_graph`: знайшли файл A → додати пов'язані файли | M |
| 2.2 | Cross-file chunks | При індексації створювати "зшиті" чанки з import-ланцюгів (файл + ключові залежності) | L |
| 2.3 | Symbol index | Окремий індекс символів (функції, класи, типи) з посиланнями на файли | L |

**Файли**: `vector-store.ts` (graph boost), `indexer.ts` (cross-file chunks), новий `symbol-index.ts`

### L-Sprint 3: Inter-Session Learning ⏳

**Проблема**: Сесії ізольовані. Навчання лише наприкінці сесії, наступна починає з мінімальним контекстом.

| # | Task | Description | Size |
|---|------|-------------|------|
| 3.1 | Session continuity | При старті нової сесії підтягувати контекст останньої (файли, рішення, незавершені задачі) | M |
| 3.2 | Developer profile | Накопичувати профіль розробника: часті файли, патерни, типові запити | M |
| 3.3 | Memory relationships | Зв'язки між пам'ятями: "supersedes", "relates_to", "contradicts" для ланцюгового recall | L |

**Файли**: `session-context.ts` (continuity), `usage-patterns.ts` (profile), `memory.ts` (relationships)

### L-Sprint 4: Auto-Learning Quality ⏳

**Проблема**: ConversationAnalyzer використовує regex для entity extraction, confidence threshold статичний.

| # | Task | Description | Size |
|---|------|-------------|------|
| 4.1 | AST entity extraction | Замінити regex на ts-morph AST для TypeScript — точніше розпізнавання символів | M |
| 4.2 | Adaptive confidence | Динамічний поріг confidence на основі історії промоушенів | S |
| 4.3 | Periodic memory merge | При старті сесії автоматично мерджити схожі пам'яті через `mergeMemories()` | S |
| 4.4 | Memory aging | Старі пам'яті (>30 днів) без позитивного фідбеку → знижувати в ранкінгу recall | S |

**Файли**: `conversation-analyzer.ts` (AST), `memory-governance.ts` (confidence/aging), `session-context.ts` (auto-merge)

### L-Track Execution Order

```
L-Sprint 1 (feedback loop)    ← найбільший ROI, мінімум зусиль
    ↓
L-Sprint 4 (auto-learning)    ← покращує те, що вже працює
    ↓
L-Sprint 2 (cross-file)       ← найбільший вплив на якість пошуку
    ↓
L-Sprint 3 (inter-session)    ← довгострокова цінність
```

---

## All Implemented Tools (33 total) — ✅ COMPLETE

### Qdrant Track (7 tools)
```
grouped_search       ✅ Results by file
hybrid_search        ✅ BM25 + semantic
cluster_code         ✅ Code patterns
find_duplicates      ✅ Duplicate detection
get_analytics        ✅ Collection stats
backup_collection    ✅ Backup/restore
find_related         ✅ "More like this"
```

### Memory Track (26 tools)
```
# Auto-Learning ✅
analyze_conversation      ✅ Process conversation
auto_remember             ✅ Auto memory creation
get_tool_analytics        ✅ Usage stats

# Patterns ✅
get_usage_patterns        ✅ Tool patterns
get_knowledge_gaps        ✅ Doc gaps
summarize_context         ✅ Quick summary
summarize_changes         ✅ Diff summary
extract_learnings         ✅ AI extraction
batch_remember            ✅ Bulk import

# Proactive ✅
get_contextual_suggestions ✅ Smart suggestions
start_session             ✅ Init context
get_session_context       ✅ Session state
end_session               ✅ Persist learnings

# Feedback ✅
feedback_search           ✅ Rate search
feedback_memory           ✅ Rate memory
suggest_better_query      ✅ Query help
get_quality_metrics       ✅ Quality stats

# Caching ✅
suggest_related_code      ✅ Related code
suggest_implementation    ✅ Similar patterns
suggest_tests             ✅ Test patterns
get_prediction_stats      ✅ Prediction accuracy

# Advanced ✅
merge_memories            ✅ Consolidate
get_completion_context    ✅ Code completion
get_import_suggestions    ✅ Import paths
get_type_context          ✅ Type info
get_behavior_patterns     ✅ User patterns
```

---

## Priority Matrix

### P0 - Must Have ✅ DONE
- ✅ Q-Sprint 2: grouped_search, hybrid_search
- ✅ M-Sprint 1: Auto-learning foundation
- ✅ M-Sprint 2: Pattern recognition

### P1 - Should Have ✅ DONE
- ✅ Q-Sprint 3: Operations
- ✅ M-Sprint 3: Proactive suggestions
- ✅ M-Sprint 4: Feedback loops

### P2 - Nice to Have ✅ DONE
- ✅ Q-Sprint 4: Analytics
- ✅ M-Sprint 5: Smart Caching & Predictive Loading
- ✅ M-Sprint 6: Advanced Features

### P3 - Next Phase ⏳
- ⏳ L-Sprint 1: Feedback → Learning Loop
- ⏳ L-Sprint 2: Cross-File Retrieval
- ⏳ L-Sprint 3: Inter-Session Learning
- ⏳ L-Sprint 4: Auto-Learning Quality

---

## Success Metrics

| Category | Metric | Target | Current |
|----------|--------|--------|---------|
| **Search** | Recall@10 | >90% | 91.9% ✅ |
| **Search** | MRR | >0.80 | 0.846 ✅ |
| **Search** | P50 latency | <100ms | 46ms ✅ |
| **Search** | Cross-file recall | >90% | 71.7% ❌ |
| **Memory** | Recall accuracy | >80% | — |
| **Learning** | Feedback utilization | >0% | 0% ❌ |
| **Learning** | Auto-promote rate | >50% | 0% ❌ |
| **Cache** | Hit rate | >70% | — |

---

## Current Status

```
Q-Track:     ████████████████████ 100% (4/4 sprints)
M-Track:     ████████████████████ 100% (6/6 sprints)
R-Track:     ████████████████████ 100% (refactoring complete)
L-Track:     ░░░░░░░░░░░░░░░░░░░░   0% (0/4 sprints)
Tools:       ████████████████████ 100% (33/33 tools)

Overall:     ███████████████░░░░░  75% (3/4 tracks complete)
```

### Next steps
- **L-Sprint 1**: Feedback → Learning Loop (feedback-weighted search, auto-promote, auto-prune, query rewriting)
