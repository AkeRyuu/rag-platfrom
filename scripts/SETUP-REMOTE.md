# Remote RAG MCP Server Setup

## Prerequisites
- Node.js 18+
- RAG API URL and API key

## Option 1: Claude Code CLI (recommended)

```bash
claude mcp add \
  --env RAG_API_URL=https://rag.akeryuu.com \
  --env RAG_API_KEY=<your-api-key> \
  --env PROJECT_NAME=myproject \
  --env PROJECT_PATH=/path/to/project \
  rag -- npx -y @crowley/rag-mcp
```

## Option 2: Manual `.mcp.json`

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "rag": {
      "command": "npx",
      "args": ["-y", "@crowley/rag-mcp"],
      "env": {
        "PROJECT_NAME": "myproject",
        "PROJECT_PATH": "/path/to/project",
        "RAG_API_URL": "https://rag.akeryuu.com",
        "RAG_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RAG_API_URL` | Yes | RAG API endpoint (e.g., `https://rag.akeryuu.com`) |
| `RAG_API_KEY` | Yes | API key for authentication |
| `PROJECT_NAME` | Yes | Project identifier for collection namespacing |
| `PROJECT_PATH` | Yes | Absolute path to the project on your machine |

## Verify

After setup, start Claude Code in your project directory. You should see RAG tools available (search_codebase, remember, recall, etc.).
