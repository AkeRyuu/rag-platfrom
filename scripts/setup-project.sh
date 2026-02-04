#!/bin/bash
# Setup script for adding shared RAG to a project

set -e

PROJECT_NAME=""
PROJECT_PATH=""
MCP_CONFIG_PATH=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 -n <project_name> -p <project_path>"
    echo ""
    echo "Options:"
    echo "  -n    Project name (used as collection prefix)"
    echo "  -p    Path to project directory"
    echo "  -h    Show this help"
    echo ""
    echo "Example:"
    echo "  $0 -n myproject -p /home/user/myproject"
    exit 1
}

while getopts "n:p:h" opt; do
    case $opt in
        n) PROJECT_NAME="$OPTARG" ;;
        p) PROJECT_PATH="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

if [ -z "$PROJECT_NAME" ] || [ -z "$PROJECT_PATH" ]; then
    echo -e "${RED}Error: Project name and path are required${NC}"
    usage
fi

# Expand path
PROJECT_PATH=$(realpath "$PROJECT_PATH" 2>/dev/null || echo "$PROJECT_PATH")

if [ ! -d "$PROJECT_PATH" ]; then
    echo -e "${RED}Error: Project path does not exist: $PROJECT_PATH${NC}"
    exit 1
fi

MCP_CONFIG_PATH="$PROJECT_PATH/.mcp.json"

echo -e "${GREEN}Setting up shared RAG for project: $PROJECT_NAME${NC}"
echo "Project path: $PROJECT_PATH"
echo ""

# Check if shared infrastructure is running
echo "Checking shared infrastructure..."
if ! curl -s http://localhost:6333/healthz > /dev/null 2>&1; then
    echo -e "${YELLOW}Warning: Qdrant is not running${NC}"
    echo "Start with: cd /home/ake/shared-ai-infra/docker && docker-compose up -d"
fi

# Create or update .mcp.json
if [ -f "$MCP_CONFIG_PATH" ]; then
    echo "Found existing .mcp.json, will add/update ${PROJECT_NAME}-rag server"

    # Check if jq is available
    if command -v jq &> /dev/null; then
        # Use jq to update the config
        TEMP_FILE=$(mktemp)
        jq --arg name "${PROJECT_NAME}-rag" \
           --arg project_name "$PROJECT_NAME" \
           --arg project_path "$PROJECT_PATH" \
           '.mcpServers[$name] = {
               "command": "node",
               "args": ["/home/ake/shared-ai-infra/mcp-server/dist/index.js"],
               "env": {
                   "PROJECT_NAME": $project_name,
                   "PROJECT_PATH": $project_path,
                   "RAG_API_URL": "http://localhost:3100"
               }
           }' "$MCP_CONFIG_PATH" > "$TEMP_FILE"
        mv "$TEMP_FILE" "$MCP_CONFIG_PATH"
        echo -e "${GREEN}Updated .mcp.json${NC}"
    else
        echo -e "${YELLOW}jq not found. Please manually add the following to .mcp.json:${NC}"
        echo ""
        cat << EOF
"${PROJECT_NAME}-rag": {
    "command": "node",
    "args": ["/home/ake/shared-ai-infra/mcp-server/dist/index.js"],
    "env": {
        "PROJECT_NAME": "$PROJECT_NAME",
        "PROJECT_PATH": "$PROJECT_PATH",
        "RAG_API_URL": "http://localhost:3100"
    }
}
EOF
    fi
else
    echo "Creating new .mcp.json"
    cat > "$MCP_CONFIG_PATH" << EOF
{
  "mcpServers": {
    "${PROJECT_NAME}-rag": {
      "command": "node",
      "args": ["/home/ake/shared-ai-infra/mcp-server/dist/index.js"],
      "env": {
        "PROJECT_NAME": "$PROJECT_NAME",
        "PROJECT_PATH": "$PROJECT_PATH",
        "RAG_API_URL": "http://localhost:3100"
      }
    }
  }
}
EOF
    echo -e "${GREEN}Created .mcp.json${NC}"
fi

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Restart Claude Code to load the new MCP server"
echo "2. Use 'index_codebase' tool to index your project"
echo ""
echo "Collections that will be created:"
echo "  - ${PROJECT_NAME}_codebase"
echo "  - ${PROJECT_NAME}_docs"
