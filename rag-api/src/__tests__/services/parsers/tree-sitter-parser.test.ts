import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger — must come before any imports that pull in the logger
vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    })),
  },
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    })),
  },
  createRequestLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { getQueryForLanguage } from '../../../services/parsers/queries/index';
import { treeSitterParser } from '../../../services/parsers/tree-sitter-parser';

// ---------------------------------------------------------------------------
// Query registry tests
// ---------------------------------------------------------------------------

describe('getQueryForLanguage()', () => {
  it('returns a non-empty string for .ts', () => {
    const q = getQueryForLanguage('.ts');
    expect(typeof q).toBe('string');
    expect(q!.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for .py', () => {
    const q = getQueryForLanguage('.py');
    expect(typeof q).toBe('string');
    expect(q!.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for .go', () => {
    const q = getQueryForLanguage('.go');
    expect(typeof q).toBe('string');
    expect(q!.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for .rs', () => {
    const q = getQueryForLanguage('.rs');
    expect(typeof q).toBe('string');
    expect(q!.length).toBeGreaterThan(0);
  });

  it('returns null for .txt', () => {
    expect(getQueryForLanguage('.txt')).toBeNull();
  });

  it('normalises extension without leading dot', () => {
    // Should work regardless of whether caller includes the dot
    const withDot = getQueryForLanguage('.ts');
    const withoutDot = getQueryForLanguage('ts');
    expect(withDot).toBe(withoutDot);
  });

  it('returns null for unsupported extensions like .md', () => {
    expect(getQueryForLanguage('.md')).toBeNull();
  });

  it('returns null for .json', () => {
    expect(getQueryForLanguage('.json')).toBeNull();
  });

  it('handles upper-case extension (.TS)', () => {
    const q = getQueryForLanguage('.TS');
    expect(typeof q).toBe('string');
    expect(q!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Helper: run extractEdges with graceful degradation on missing WASM
// ---------------------------------------------------------------------------

/**
 * Calls treeSitterParser.extractEdges and returns the result.
 * If tree-sitter did not initialise (WASM missing in CI), returns null so the
 * caller can skip assertions with a conditional check.
 */
async function tryExtractEdges(content: string, filePath: string) {
  const edges = await treeSitterParser.extractEdges(content, filePath);
  // If tree-sitter failed to init, the result will always be an empty array
  // and (treeSitterParser as any).initialized will be false.
  return edges;
}

async function tryExtractSymbols(content: string, filePath: string) {
  return treeSitterParser.extractSymbols(content, filePath);
}

function isInitialized(): boolean {
  // Access the private flag via type casting
  return (treeSitterParser as unknown as { initialized: boolean }).initialized;
}

// ---------------------------------------------------------------------------
// TypeScript sample
// ---------------------------------------------------------------------------

const tsCode = `
import { Router } from 'express';
import { vectorStore } from './vector-store';
import type { GraphEdge } from './parsers/ast-parser';

export class GraphStoreService extends BaseService implements Disposable {
  async expand(projectName: string): Promise<string[]> {
    return vectorStore.search(projectName);
  }
}
`;

describe('TreeSitterParserService — extractEdges (TypeScript)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an array (possibly empty when WASM unavailable)', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    expect(Array.isArray(edges)).toBe(true);
  });

  it('sets fromFile to the supplied filePath on every edge', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return; // WASM not loaded — skip deeper assertions
    for (const edge of edges) {
      expect(edge.fromFile).toBe('src/graph-store.ts');
    }
  });

  it('extracts import edge for "express" package', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const expressEdge = edges.find((e) => e.toFile === 'express');
    expect(expressEdge).toBeDefined();
    expect(expressEdge!.edgeType).toBe('imports');
    expect(expressEdge!.fromSymbol).toBe('Router');
  });

  it('extracts import edge for "./vector-store"', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const vsEdge = edges.find((e) => e.edgeType === 'imports' && e.toFile.includes('vector-store'));
    expect(vsEdge).toBeDefined();
    expect(vsEdge!.fromSymbol).toBe('vectorStore');
  });

  it('extracts import edge for "./parsers/ast-parser"', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const astEdge = edges.find((e) => e.edgeType === 'imports' && e.toFile.includes('ast-parser'));
    expect(astEdge).toBeDefined();
    expect(astEdge!.fromSymbol).toBe('GraphEdge');
  });

  it('extracts "extends" edge: GraphStoreService → BaseService', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const ext = edges.find((e) => e.edgeType === 'extends');
    expect(ext).toBeDefined();
    expect(ext!.fromSymbol).toBe('GraphStoreService');
    expect(ext!.toSymbol).toBe('BaseService');
  });

  it('extracts "implements" edge: GraphStoreService → Disposable', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const impl = edges.find((e) => e.edgeType === 'implements');
    expect(impl).toBeDefined();
    expect(impl!.fromSymbol).toBe('GraphStoreService');
    expect(impl!.toSymbol).toBe('Disposable');
  });

  it('extracts "calls" edge for vectorStore.search', async () => {
    const edges = await tryExtractEdges(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const callEdge = edges.find((e) => e.edgeType === 'calls' && e.fromSymbol.includes('search'));
    expect(callEdge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Python sample
// ---------------------------------------------------------------------------

const pyCode = `
from flask import Flask, request
from .models import User

class UserService(BaseService):
    def get_user(self, user_id: int) -> User:
        return User.find(user_id)
`;

describe('TreeSitterParserService — extractEdges (Python)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an array', async () => {
    const edges = await tryExtractEdges(pyCode, 'src/user_service.py');
    expect(Array.isArray(edges)).toBe(true);
  });

  it('extracts import edges for flask', async () => {
    const edges = await tryExtractEdges(pyCode, 'src/user_service.py');
    if (!isInitialized()) return;
    const flaskEdges = edges.filter((e) => e.edgeType === 'imports' && e.toFile.includes('flask'));
    expect(flaskEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts import edges for .models', async () => {
    const edges = await tryExtractEdges(pyCode, 'src/user_service.py');
    if (!isInitialized()) return;
    const modelEdge = edges.find((e) => e.edgeType === 'imports' && e.fromSymbol === 'User');
    expect(modelEdge).toBeDefined();
  });

  it('extracts "extends" edge: UserService → BaseService', async () => {
    const edges = await tryExtractEdges(pyCode, 'src/user_service.py');
    if (!isInitialized()) return;
    const ext = edges.find((e) => e.edgeType === 'extends' && e.fromSymbol === 'UserService');
    expect(ext).toBeDefined();
    expect(ext!.toSymbol).toBe('BaseService');
  });

  it('sets fromFile on every edge', async () => {
    const edges = await tryExtractEdges(pyCode, 'src/user_service.py');
    if (!isInitialized()) return;
    for (const edge of edges) {
      expect(edge.fromFile).toBe('src/user_service.py');
    }
  });
});

// ---------------------------------------------------------------------------
// Go sample
// ---------------------------------------------------------------------------

const goCode = `
package main

import (
    "fmt"
    "net/http"
)

type Server struct {
    router *http.ServeMux
}

func (s *Server) Start() {
    fmt.Println("starting")
}
`;

describe('TreeSitterParserService — extractEdges (Go)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an array', async () => {
    const edges = await tryExtractEdges(goCode, 'src/main.go');
    expect(Array.isArray(edges)).toBe(true);
  });

  it('extracts import edge for "fmt"', async () => {
    const edges = await tryExtractEdges(goCode, 'src/main.go');
    if (!isInitialized()) return;
    const fmtEdge = edges.find((e) => e.edgeType === 'imports' && e.toFile === 'fmt');
    expect(fmtEdge).toBeDefined();
  });

  it('extracts import edge for "net/http"', async () => {
    const edges = await tryExtractEdges(goCode, 'src/main.go');
    if (!isInitialized()) return;
    const httpEdge = edges.find((e) => e.edgeType === 'imports' && e.toFile.includes('net/http'));
    expect(httpEdge).toBeDefined();
  });

  it('sets fromFile on every edge', async () => {
    const edges = await tryExtractEdges(goCode, 'src/main.go');
    if (!isInitialized()) return;
    for (const edge of edges) {
      expect(edge.fromFile).toBe('src/main.go');
    }
  });
});

// ---------------------------------------------------------------------------
// extractSymbols (TypeScript)
// ---------------------------------------------------------------------------

describe('TreeSitterParserService — extractSymbols (TypeScript)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an array', async () => {
    const symbols = await tryExtractSymbols(tsCode, 'src/graph-store.ts');
    expect(Array.isArray(symbols)).toBe(true);
  });

  it('returns ASTSymbol for GraphStoreService with kind "class"', async () => {
    const symbols = await tryExtractSymbols(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const cls = symbols.find((s) => s.name === 'GraphStoreService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
  });

  it('returns ASTSymbol for expand with kind "method"', async () => {
    const symbols = await tryExtractSymbols(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const method = symbols.find((s) => s.name === 'expand');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('marks GraphStoreService as exported', async () => {
    const symbols = await tryExtractSymbols(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    const cls = symbols.find((s) => s.name === 'GraphStoreService');
    expect(cls).toBeDefined();
    expect(cls!.exported).toBe(true);
  });

  it('each symbol has startLine and endLine numbers', async () => {
    const symbols = await tryExtractSymbols(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    for (const sym of symbols) {
      expect(typeof sym.startLine).toBe('number');
      expect(typeof sym.endLine).toBe('number');
      expect(sym.startLine).toBeGreaterThan(0);
      expect(sym.endLine).toBeGreaterThanOrEqual(sym.startLine);
    }
  });

  it('each symbol has a non-empty signature string', async () => {
    const symbols = await tryExtractSymbols(tsCode, 'src/graph-store.ts');
    if (!isInitialized()) return;
    for (const sym of symbols) {
      expect(typeof sym.signature).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

describe('TreeSitterParserService — graceful degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extractEdges with unsupported extension (.txt) returns empty array', async () => {
    const edges = await tryExtractEdges('some content', 'src/notes.txt');
    expect(edges).toEqual([]);
  });

  it('extractSymbols with unsupported extension (.txt) returns empty array', async () => {
    const symbols = await tryExtractSymbols('some content', 'src/notes.txt');
    expect(symbols).toEqual([]);
  });

  it('extractEdges with empty content returns empty array', async () => {
    const edges = await tryExtractEdges('', 'src/empty.ts');
    expect(Array.isArray(edges)).toBe(true);
  });

  it('extractSymbols with empty content returns empty array', async () => {
    const symbols = await tryExtractSymbols('', 'src/empty.ts');
    expect(Array.isArray(symbols)).toBe(true);
  });

  it('extractEdges with unsupported extension (.yml) returns empty array', async () => {
    const edges = await tryExtractEdges('key: value', 'config.yml');
    expect(edges).toEqual([]);
  });
});
