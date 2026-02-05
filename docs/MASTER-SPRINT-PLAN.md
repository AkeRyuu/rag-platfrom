# Master Sprint Plan: Shared AI Infrastructure

## Overview

Combined roadmap for all infrastructure improvements.

---

## Sprint Tracks

| Track | Focus | Sprints |
|-------|-------|---------|
| **Q** | Qdrant Performance | Q-Sprint 1-4 |
| **M** | Memory & Claude Integration | M-Sprint 1-6 |

---

## Combined Timeline

| Week | Qdrant Track | Memory Track |
|------|--------------|--------------|
| 1-2 | ✅ **Q-Sprint 1** Foundation | **M-Sprint 1** Auto-Learning |
| 3-4 | **Q-Sprint 2** Advanced Search | **M-Sprint 2** Patterns |
| 5-6 | **Q-Sprint 3** Operations | **M-Sprint 3** Proactive |
| 7-8 | **Q-Sprint 4** Analytics | **M-Sprint 4** Feedback |
| 9-10 | - | **M-Sprint 5** Caching |
| 11-12 | - | **M-Sprint 6** Polish |

---

## Q-Track: Qdrant Performance (4 Sprints)

### Q-Sprint 1: Foundation ✅ DONE
- ✅ Payload indexes
- ✅ Batch embedding
- ✅ Score threshold
- ✅ Faceted counts
- ✅ Collection info

### Q-Sprint 2: Advanced Search
| Task | Tool |
|------|------|
| Search with grouping | `grouped_search` |
| Hybrid BM25 + vector | `hybrid_search` |

### Q-Sprint 3: Operations
| Task | Tool |
|------|------|
| Collection aliases | - |
| Zero-downtime reindex | - |
| Parallel processing | - |
| Semantic clustering | `cluster_code` |

### Q-Sprint 4: Analytics
| Task | Tool |
|------|------|
| Duplicate detection | `find_duplicates` |
| Collection analytics | `get_analytics` |
| Backup/restore | `backup_collection` |
| Scalar quantization | - |

---

## M-Track: Memory & Claude Integration (6 Sprints)

### M-Sprint 1: Foundation & Auto-Learning
| Task | Tool |
|------|------|
| Conversation analyzer | `analyze_conversation` |
| Auto-memory creation | `auto_remember` |
| Tool usage tracking | `get_tool_analytics` |

### M-Sprint 2: Pattern Recognition
| Task | Tool |
|------|------|
| Usage patterns | `get_usage_patterns` |
| Knowledge gaps | `get_knowledge_gaps` |
| Context summary | `summarize_context` |
| Changes summary | `summarize_changes` |
| Learning extraction | `extract_learnings` |

### M-Sprint 3: Proactive Intelligence
| Task | Tool |
|------|------|
| Contextual suggestions | `get_contextual_suggestions` |
| Session start | `start_session` |
| Session context | `get_session_context` |
| Session end | `end_session` |

### M-Sprint 4: Feedback & Quality
| Task | Tool |
|------|------|
| Search feedback | `feedback_search` |
| Memory feedback | `feedback_memory` |
| Query suggestions | `suggest_better_query` |
| Quality metrics | `get_quality_metrics` |

### M-Sprint 5: Smart Caching
| Task | Tool |
|------|------|
| Related code | `suggest_related_code` |
| Implementation refs | `suggest_implementation` |
| Test patterns | `suggest_tests` |

### M-Sprint 6: Advanced Features
| Task | Tool |
|------|------|
| Memory merge | `merge_memories` |
| Completion context | `get_completion_context` |
| Import suggestions | `get_import_suggestions` |
| Type context | `get_type_context` |

---

## All New Tools (32 total)

### Qdrant Track (7 tools)
```
grouped_search       - Results by file
hybrid_search        - BM25 + semantic
cluster_code         - Code patterns
find_duplicates      - Duplicate detection
get_analytics        - Collection stats
backup_collection    - Backup/restore
find_related         - "More like this"
```

### Memory Track (25 tools)
```
# Auto-Learning
analyze_conversation      - Process conversation
auto_remember             - Auto memory creation
get_tool_analytics        - Usage stats

# Patterns
get_usage_patterns        - Tool patterns
get_knowledge_gaps        - Doc gaps
summarize_context         - Quick summary
summarize_changes         - Diff summary
extract_learnings         - AI extraction
batch_remember            - Bulk import

# Proactive
get_contextual_suggestions - Smart suggestions
start_session             - Init context
get_session_context       - Session state
end_session               - Persist learnings

# Feedback
feedback_search           - Rate search
feedback_memory           - Rate memory
suggest_better_query      - Query help
get_quality_metrics       - Quality stats

# Caching
suggest_related_code      - Related code
suggest_implementation    - Similar patterns
suggest_tests             - Test patterns

# Advanced
merge_memories            - Consolidate
get_completion_context    - Code completion
get_import_suggestions    - Import paths
get_type_context          - Type info
get_behavior_patterns     - User patterns
```

---

## Priority Matrix

### P0 - Must Have (Weeks 1-4)
- Q-Sprint 2: grouped_search, hybrid_search
- M-Sprint 1: Auto-learning foundation
- M-Sprint 2: Pattern recognition

### P1 - Should Have (Weeks 5-8)
- Q-Sprint 3: Operations
- M-Sprint 3: Proactive suggestions
- M-Sprint 4: Feedback loops

### P2 - Nice to Have (Weeks 9-12)
- Q-Sprint 4: Analytics
- M-Sprint 5-6: Caching & Polish

---

## Success Metrics

| Category | Metric | Target |
|----------|--------|--------|
| **Search** | Filtered search latency | <100ms |
| **Search** | Hybrid search relevance | +20% MRR |
| **Indexing** | Full codebase time | -40% |
| **Memory** | Auto-memories/day | 50+ |
| **Memory** | Recall accuracy | >80% |
| **Claude** | Tools per session | +30% |
| **Claude** | Search helpfulness | >75% |
| **Cache** | Hit rate | >70% |

---

## Quick Start

```bash
# Current status
Q-Sprint 1: ✅ DONE
M-Sprint 1: ⏳ NOT STARTED

# Next sprint
Option A: Q-Sprint 2 (Advanced Search)
Option B: M-Sprint 1 (Auto-Learning)
Option C: Both in parallel
```
