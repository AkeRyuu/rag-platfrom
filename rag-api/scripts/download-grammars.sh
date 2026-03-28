#!/usr/bin/env bash
# Download tree-sitter WASM grammar files to rag-api/grammars/
# These are needed by tree-sitter-parser.ts at runtime.
#
# Usage:
#   cd rag-api
#   bash scripts/download-grammars.sh
#
# Sources: GitHub releases for each tree-sitter grammar repo.
# Versions can be bumped by editing the variables below.

set -euo pipefail

GRAMMARS_DIR="$(cd "$(dirname "$0")/.." && pwd)/grammars"
mkdir -p "$GRAMMARS_DIR"

# Grammar release URLs
# Check https://github.com/tree-sitter/tree-sitter-<lang>/releases for latest tags
declare -A GRAMMAR_URLS=(
  ["tree-sitter-typescript.wasm"]="https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm"
  ["tree-sitter-python.wasm"]="https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm"
  ["tree-sitter-go.wasm"]="https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm"
  ["tree-sitter-rust.wasm"]="https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm"
)

echo "Downloading tree-sitter grammar files to $GRAMMARS_DIR"

for filename in "${!GRAMMAR_URLS[@]}"; do
  dest="$GRAMMARS_DIR/$filename"
  url="${GRAMMAR_URLS[$filename]}"

  if [ -f "$dest" ]; then
    echo "  [skip] $filename already exists"
    continue
  fi

  echo "  [download] $filename"
  if command -v curl &>/dev/null; then
    curl -fsSL -o "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget -q -O "$dest" "$url"
  else
    echo "ERROR: neither curl nor wget found" >&2
    exit 1
  fi
  echo "  [ok] $filename"
done

echo ""
echo "Done. Grammar files in $GRAMMARS_DIR:"
ls -lh "$GRAMMARS_DIR"
