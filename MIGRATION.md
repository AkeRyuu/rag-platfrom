# Міграція на Shared Infrastructure

## Поточний стан

Зараз запущені контейнери під назвою `cypro-*`:
- cypro-qdrant (6333)
- cypro-ollama (11434)
- cypro-bge-m3 (8080)
- cypro-redis (6379)
- cypro-postgres (5432)

## План міграції

### Варіант 1: Перейменувати існуючі контейнери (рекомендовано)

Оскільки контейнери вже працюють, можна просто перейменувати їх:

```bash
# Зупинити і перейменувати
docker rename cypro-qdrant shared-qdrant
docker rename cypro-ollama shared-ollama
docker rename cypro-bge-m3 shared-bge-m3
docker rename cypro-redis shared-redis
# cypro-postgres залишити для cypro (project-specific)
```

### Варіант 2: Використовувати як є

Залишити контейнери з назвами `cypro-*`, але використовувати їх як shared.
Контейнери вже слухають на стандартних портах.

## Зміни в .mcp.json

### Cypro проект (/home/ake/cypro/.mcp.json)

```json
{
  "mcpServers": {
    "cypro-rag": {
      "command": "node",
      "args": ["/home/ake/shared-ai-infra/mcp-server/dist/index.js"],
      "env": {
        "PROJECT_NAME": "cypro",
        "PROJECT_PATH": "/home/ake/cypro",
        "RAG_API_URL": "http://localhost:3100"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": ""
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://cypro:cypro_dev_password@localhost:5432/cypro"]
    }
  }
}
```

### Інший проект (/home/ake/other-project/.mcp.json)

```json
{
  "mcpServers": {
    "other-rag": {
      "command": "node",
      "args": ["/home/ake/shared-ai-infra/mcp-server/dist/index.js"],
      "env": {
        "PROJECT_NAME": "other",
        "PROJECT_PATH": "/home/ake/other-project",
        "RAG_API_URL": "http://localhost:3100"
      }
    }
  }
}
```

## Колекції в Qdrant

Після міграції, кожен проект матиме окремі колекції:

| Проект | Колекція |
|--------|----------|
| cypro | cypro_codebase |
| other | other_codebase |

Перевірити колекції:
```bash
curl http://localhost:6333/collections | jq
```

## TODO

1. **RAG API** - потрібно оновити RAG API щоб підтримував:
   - Динамічні колекції через параметр `collection`
   - Header `X-Project-Name` для ідентифікації проекту
   - Ендпоінт `/api/index` для індексації

2. **Тестування** - після міграції перевірити:
   - Пошук по cypro не повертає результати з інших проектів
   - Індексація нового проекту не впливає на існуючі
