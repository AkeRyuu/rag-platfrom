# Налаштування RAG для beep-services

## Крок 1: Створити .mcp.json в beep-services

```json
{
  "mcpServers": {
    "rag": {
      "command": "node",
      "args": ["/home/ake/shared-ai-infra/mcp-server/dist/index.js"],
      "env": {
        "PROJECT_NAME": "beep-services",
        "PROJECT_PATH": "/path/to/beep-services",
        "RAG_API_URL": "http://localhost:3100"
      }
    }
  }
}
```

## Крок 2: Створити CLAUDE.md в beep-services

```markdown
# beep-services - AI Assistant Rules

## RAG Integration (ОБОВ'ЯЗКОВО)

### Перед будь-якою зміною коду:
1. **Пошук існуючого коду**: Використай `search_codebase` щоб знайти схожі реалізації
2. **Перевірка патернів**: Використай `get_patterns` щоб дізнатися як структурувати код
3. **Архітектурні рішення**: Використай `get_adrs` щоб перевірити прийняті рішення
4. **Пам'ять**: Використай `recall` щоб згадати контекст попередніх сесій

### Під час написання коду:
- `check_architecture` - валідувати новий код проти патернів
- `search_similar` - знайти схожий код для консистентності
- `get_table_info` - перевірити структуру БД перед змінами
- `get_db_rules` - дотримуватись правил роботи з БД

### Після завершення задачі:
- `remember` - зберегти важливі рішення та контекст
- `record_adr` - документувати нові архітектурні рішення
- `record_pattern` - зафіксувати нові патерни коду

### Code Review:
- `review_code` - AI code review перед комітом
- `generate_tests` - згенерувати тести для нового коду

## Приклади використання

### Новий endpoint:
\`\`\`
1. search_codebase("endpoint controller route")
2. get_patterns(query: "api endpoint")
3. get_adrs(query: "api design")
4. ... write code ...
5. check_architecture(code: "...", filePath: "src/routes/...")
6. generate_tests(code: "...")
\`\`\`

### Зміна в БД:
\`\`\`
1. get_table_info(tableName: "affected_table")
2. get_db_rules()
3. check_db_schema(change: "add column...")
4. record_adr(...) якщо це архітектурне рішення
\`\`\`

### Bug fix:
\`\`\`
1. recall(query: "similar bug context")
2. search_codebase("error handling pattern")
3. ... fix ...
4. remember(content: "Fixed X because Y", type: "insight")
\`\`\`
```

## Крок 3: Проіндексувати codebase

```bash
# Запустити RAG API (якщо не запущено)
cd /home/ake/shared-ai-infra/rag-api
npm run dev

# Проіндексувати beep-services через MCP tool або API
curl -X POST http://localhost:3100/api/index \
  -H "Content-Type: application/json" \
  -H "X-Project-Name: beep-services" \
  -d '{"path": "/path/to/beep-services"}'
```

## Крок 4: Записати базові патерни

Через Claude Code в beep-services виконати:

```
# Записати архітектурні патерни
mcp__rag__record_pattern({
  name: "API Endpoint",
  description: "Структура REST endpoint в beep-services",
  structure: "...",
  appliesTo: "backend/src/routes/*"
})

# Записати правила БД
mcp__rag__record_db_rule({
  ruleName: "Soft delete",
  description: "Використовувати deletedAt замість DELETE",
  scope: "global"
})

# Записати таблиці
mcp__rag__record_table({
  tableName: "users",
  purpose: "...",
  columns: "..."
})
```

## Крок 5: Налаштувати auto-memory

Додати в CLAUDE.md:

```markdown
## Auto Memory Rules

При кожному завершенні задачі:
- Якщо прийнято архітектурне рішення → `record_adr`
- Якщо виявлено новий патерн → `record_pattern`
- Якщо є важливий контекст → `remember`
- Якщо є технічний борг → `record_tech_debt`
```

## Результат

Після налаштування Claude буде:
1. **Автоматично шукати** існуючий код перед написанням нового
2. **Дотримуватись патернів** проекту
3. **Пам'ятати контекст** між сесіями
4. **Валідувати код** проти архітектурних рішень
5. **Документувати рішення** автоматично
