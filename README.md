# Shared AI Infrastructure

Загальна інфраструктура для RAG та AI агентів, яку можна використовувати в різних проектах без конфліктів контексту.

## Архітектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHARED AI INFRASTRUCTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Qdrant     │  │   Ollama     │  │   BGE-M3     │          │
│  │ (Vector DB)  │  │   (LLM)      │  │ (Embeddings) │          │
│  │  :6333       │  │  :11434      │  │   :8080      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └────────────┬────┴────────────────┘                   │
│                      │                                          │
│              ┌───────┴───────┐                                  │
│              │   RAG API     │                                  │
│              │    :3100      │                                  │
│              └───────┬───────┘                                  │
│                      │                                          │
│    ┌─────────────────┼─────────────────┐                       │
│    │                 │                 │                        │
│    ▼                 ▼                 ▼                        │
│ ┌──────┐         ┌──────┐         ┌──────┐                     │
│ │cypro_│         │proj2_│         │proj3_│   <- Collections    │
│ │*     │         │*     │         │*     │                     │
│ └──────┘         └──────┘         └──────┘                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Швидкий старт

### 1. Запуск інфраструктури

```bash
cd /home/ake/shared-ai-infra/docker
docker-compose up -d
```

### 2. Збірка та запуск RAG API

```bash
cd /home/ake/shared-ai-infra/rag-api
npm install
npm run build

# Створити .env з .env.example і налаштувати
cp .env.example .env

# Запустити
npm start
# або для розробки
npm run dev
```

### 3. Збірка MCP сервера

```bash
cd /home/ake/shared-ai-infra/mcp-server
npm install
npm run build
```

### 3. Налаштування проекту

Додайте до `.mcp.json` вашого проекту:

```json
{
  "mcpServers": {
    "project-rag": {
      "command": "node",
      "args": ["/home/ake/shared-ai-infra/mcp-server/dist/index.js"],
      "env": {
        "PROJECT_NAME": "myproject",
        "PROJECT_PATH": "/path/to/myproject",
        "RAG_API_URL": "http://localhost:3100"
      }
    }
  }
}
```

## Налаштування для різних проектів

### Cypro

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
    }
  }
}
```

### Інший проект

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

## Ізоляція контексту

Кожен проект отримує власний namespace в Qdrant:

| Проект | Колекції в Qdrant |
|--------|-------------------|
| cypro | `cypro_codebase`, `cypro_docs` |
| other | `other_codebase`, `other_docs` |
| myapp | `myapp_codebase`, `myapp_docs` |

Це гарантує, що:
- Пошук по кодовій базі повертає результати тільки з поточного проекту
- RAG відповіді базуються тільки на контексті поточного проекту
- Індексація одного проекту не впливає на інші

## Доступні інструменти

| Інструмент | Опис |
|------------|------|
| `search_codebase` | Пошук по коду проекту |
| `ask_codebase` | Питання про кодову базу (RAG + LLM) |
| `explain_code` | Пояснення фрагменту коду |
| `find_feature` | Пошук реалізації функціоналу |
| `index_codebase` | Індексація/переіндексація проекту |
| `get_index_status` | Статус індексації |
| `search_similar` | Пошук схожого коду |
| `get_project_stats` | Статистика проекту |
| `search_docs` | Пошук по документації |

## RAG API Endpoints

| Endpoint | Method | Опис |
|----------|--------|------|
| `/health` | GET | Health check |
| `/api/search` | POST | Пошук по колекції |
| `/api/search-similar` | POST | Пошук схожого коду |
| `/api/ask` | POST | Питання до кодової бази (RAG) |
| `/api/explain` | POST | Пояснення коду |
| `/api/find-feature` | POST | Пошук реалізації функціоналу |
| `/api/index` | POST | Запуск індексації проекту |
| `/api/index/status/:collection` | GET | Статус індексації |
| `/api/stats/:collection` | GET | Статистика колекції |
| `/api/collections` | GET | Список колекцій |
| `/api/collections/:name` | DELETE | Видалення колекції |
| `/api/collections/:name/clear` | POST | Очищення колекції |

### Приклад запиту

```bash
# Пошук
curl -X POST http://localhost:3100/api/search \
  -H "Content-Type: application/json" \
  -d '{"collection": "cypro_codebase", "query": "authentication", "limit": 5}'

# Індексація
curl -X POST http://localhost:3100/api/index \
  -H "Content-Type: application/json" \
  -H "X-Project-Name: myproject" \
  -H "X-Project-Path: /home/user/myproject" \
  -d '{"force": true}'
```

## Порти

| Сервіс | Порт | Опис |
|--------|------|------|
| Qdrant | 6333 | Vector DB REST API |
| Qdrant gRPC | 6334 | Vector DB gRPC |
| Ollama | 11434 | LLM API |
| BGE-M3 | 8080 | Embedding API |
| Redis | 6380 | Cache (shared) |
| RAG API | 3100 | Unified RAG API |

## Управління

### Перегляд колекцій

```bash
curl http://localhost:6333/collections
```

### Видалення колекції проекту

```bash
curl -X DELETE http://localhost:6333/collections/myproject_codebase
```

### Перевірка статусу

```bash
# Qdrant
curl http://localhost:6333/healthz

# Ollama
curl http://localhost:11434/api/tags

# BGE-M3
curl http://localhost:8080/health
```

## Структура директорії

```
shared-ai-infra/
├── docker/
│   └── docker-compose.yml    # Конфігурація контейнерів
├── mcp-server/               # Universal MCP Server
│   ├── src/index.ts
│   ├── dist/                 # Збілджений код
│   ├── package.json
│   └── tsconfig.json
├── rag-api/                  # Shared RAG API
│   ├── src/
│   │   ├── config.ts
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── search.ts     # Пошук та RAG
│   │   │   └── index.ts      # Індексація
│   │   ├── services/
│   │   │   ├── embedding.ts
│   │   │   ├── vector-store.ts
│   │   │   ├── llm.ts
│   │   │   └── indexer.ts
│   │   └── utils/
│   ├── dist/                 # Збілджений код
│   ├── package.json
│   └── Dockerfile
├── scripts/
│   └── setup-project.sh      # Скрипт налаштування
└── README.md
```

## Міграція з проект-специфічного RAG

Якщо у вас вже є проект-специфічний RAG (як cypro-rag):

1. Переконайтесь, що shared infrastructure запущена
2. Оновіть `.mcp.json` проекту на shared MCP server
3. Виконайте `index_codebase` для створення колекцій
4. Старий cypro-specific RAG можна видалити

## Troubleshooting

### Контейнери не запускаються

```bash
# Перевірити логи
docker-compose logs -f

# Перезапустити
docker-compose down && docker-compose up -d
```

### Помилка GPU для Ollama/BGE-M3

Якщо немає NVIDIA GPU, видаліть секцію `deploy.resources` з docker-compose.yml.

### Конфлікт портів

Змініть порти в docker-compose.yml якщо стандартні зайняті.
