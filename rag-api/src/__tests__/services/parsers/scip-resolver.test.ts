import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

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

// Mock child_process so tests never spawn real subprocesses
const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

// Mock util.promisify to return a wrapper around mockExecFile
const mockExecFileAsync = vi.hoisted(() => vi.fn());
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: vi.fn((fn: unknown) => {
      // Only wrap execFile — everything else passes through
      if (fn === mockExecFile) return mockExecFileAsync;
      return actual.promisify(fn as Parameters<typeof actual.promisify>[0]);
    }),
  };
});

// Mock protobufjs — we don't need proto decoding for unit tests
vi.mock('protobufjs', () => ({
  default: {
    load: vi.fn(),
  },
  load: vi.fn(),
}));

// Mock fs to control file-system checks
import * as fs from 'fs';
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync),
    readFileSync: vi.fn(actual.readFileSync),
    unlinkSync: vi.fn(),
  };
});

import { scipResolver } from '../../../services/parsers/scip-resolver';
import type { GraphEdge } from '../../../services/parsers/ast-parser';
import type { SCIPResolvedEdge } from '../../../services/parsers/scip-resolver';

const mockedFs = vi.mocked(fs);

// ---------------------------------------------------------------------------
// isAvailable()
// ---------------------------------------------------------------------------

describe('SCIPResolverService.isAvailable()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for python (not supported)', async () => {
    const result = await scipResolver.isAvailable('python');
    expect(result).toBe(false);
  });

  it('returns false for go (not supported)', async () => {
    const result = await scipResolver.isAvailable('go');
    expect(result).toBe(false);
  });

  it('returns true for typescript when scip-typescript is available', async () => {
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '' });
    const result = await scipResolver.isAvailable('typescript');
    expect(result).toBe(true);
  });

  it('returns false for typescript when scip-typescript subprocess throws', async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error('command not found'));
    const result = await scipResolver.isAvailable('typescript');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeEdges() — pure logic, no subprocess
// ---------------------------------------------------------------------------

describe('SCIPResolverService.mergeEdges()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const treeSitterEdges: GraphEdge[] = [
    {
      fromFile: 'a.ts',
      fromSymbol: 'Router',
      toFile: 'express',
      toSymbol: 'Router',
      edgeType: 'imports',
    },
    {
      fromFile: 'a.ts',
      fromSymbol: 'foo',
      toFile: './utils',
      toSymbol: 'foo',
      edgeType: 'imports',
    },
  ];

  const scipEdges: SCIPResolvedEdge[] = [
    {
      fromFile: 'a.ts',
      fromSymbol: 'foo',
      toFile: 'src/utils/index.ts',
      toSymbol: 'foo',
      edgeType: 'imports',
      confidence: 'scip',
    },
  ];

  it('merged result has the same number of edges as tree-sitter input when SCIP adds no new edges', () => {
    const merged = scipResolver.mergeEdges(treeSitterEdges, scipEdges);
    expect(merged).toHaveLength(2);
  });

  it('upgrades the "./utils" foo edge to use SCIP-resolved toFile', () => {
    const merged = scipResolver.mergeEdges(treeSitterEdges, scipEdges);
    const fooEdge = merged.find((e) => e.fromSymbol === 'foo');
    expect(fooEdge).toBeDefined();
    expect(fooEdge!.toFile).toBe('src/utils/index.ts');
  });

  it('marks the SCIP-upgraded edge with confidence "scip"', () => {
    const merged = scipResolver.mergeEdges(treeSitterEdges, scipEdges);
    const fooEdge = merged.find((e) => e.fromSymbol === 'foo');
    expect(fooEdge!.confidence).toBe('scip');
  });

  it('keeps the express edge with confidence "tree-sitter"', () => {
    const merged = scipResolver.mergeEdges(treeSitterEdges, scipEdges);
    const expressEdge = merged.find((e) => e.toFile === 'express');
    expect(expressEdge).toBeDefined();
    expect(expressEdge!.confidence).toBe('tree-sitter');
  });

  it('preserves the express edge toFile and toSymbol unchanged', () => {
    const merged = scipResolver.mergeEdges(treeSitterEdges, scipEdges);
    const expressEdge = merged.find((e) => e.toFile === 'express');
    expect(expressEdge!.toFile).toBe('express');
    expect(expressEdge!.toSymbol).toBe('Router');
  });

  it('appends SCIP-only edges that have no tree-sitter counterpart', () => {
    const extraSCIPEdge: SCIPResolvedEdge = {
      fromFile: 'b.ts',
      fromSymbol: 'bar',
      toFile: 'src/bar.ts',
      toSymbol: 'bar',
      edgeType: 'imports',
      confidence: 'scip',
    };
    const merged = scipResolver.mergeEdges(treeSitterEdges, [...scipEdges, extraSCIPEdge]);
    expect(merged).toHaveLength(3);
    const barEdge = merged.find((e) => e.fromFile === 'b.ts');
    expect(barEdge).toBeDefined();
    expect(barEdge!.confidence).toBe('scip');
  });

  it('returns empty array when both inputs are empty', () => {
    const merged = scipResolver.mergeEdges([], []);
    expect(merged).toEqual([]);
  });

  it('keeps all tree-sitter edges as "tree-sitter" confidence when scipEdges is empty', () => {
    const merged = scipResolver.mergeEdges(treeSitterEdges, []);
    expect(merged).toHaveLength(2);
    for (const edge of merged) {
      expect(edge.confidence).toBe('tree-sitter');
    }
  });

  it('returns all SCIP edges when treeSitterEdges is empty', () => {
    const merged = scipResolver.mergeEdges([], scipEdges);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe('scip');
  });

  it('does not mutate the original treeSitterEdges array', () => {
    const original = [...treeSitterEdges];
    scipResolver.mergeEdges(treeSitterEdges, scipEdges);
    expect(treeSitterEdges).toEqual(original);
  });

  it('deduplicates: only one SCIP result per (fromFile, fromSymbol, edgeType)', () => {
    const duplicateSCIP: SCIPResolvedEdge[] = [
      {
        fromFile: 'a.ts',
        fromSymbol: 'foo',
        toFile: 'src/utils/index.ts',
        toSymbol: 'foo',
        edgeType: 'imports',
        confidence: 'scip',
      },
      {
        fromFile: 'a.ts',
        fromSymbol: 'foo',
        toFile: 'src/utils/other.ts',
        toSymbol: 'foo',
        edgeType: 'imports',
        confidence: 'scip',
      },
    ];
    // mergeEdges uses a Map keyed by (fromFile::fromSymbol::edgeType) so second
    // duplicate SCIP edge overwrites the first in the lookup, but only one
    // tree-sitter edge matches → result length is still 2.
    const merged = scipResolver.mergeEdges(treeSitterEdges, duplicateSCIP);
    const fooEdges = merged.filter((e) => e.fromSymbol === 'foo');
    // Only one foo edge should appear (matched to tree-sitter's foo import)
    expect(fooEdges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveProject() — no tsconfig.json guard
// ---------------------------------------------------------------------------

describe('SCIPResolverService.resolveProject()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when tsconfig.json does not exist', async () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = await scipResolver.resolveProject('/tmp/no-project');
    expect(result.edges).toEqual([]);
    expect(result.symbolMap.size).toBe(0);
    expect(typeof result.duration).toBe('number');
  });

  it('returns empty result when scip-typescript subprocess fails', async () => {
    // First call: tsconfig.json exists; second call (index.scip after run): does not
    mockedFs.existsSync
      .mockReturnValueOnce(true) // tsconfig.json check
      .mockReturnValueOnce(false); // stale index.scip cleanup
    mockExecFileAsync.mockRejectedValueOnce(new Error('scip-typescript not found'));

    const result = await scipResolver.resolveProject('/tmp/project');
    expect(result.edges).toEqual([]);
    expect(result.symbolMap.size).toBe(0);
  });

  it('returns empty result when index.scip is not produced after indexer run', async () => {
    // tsconfig exists; no stale scip; subprocess succeeds; but output file absent
    mockedFs.existsSync
      .mockReturnValueOnce(true) // tsconfig.json
      .mockReturnValueOnce(false) // stale index.scip cleanup guard
      .mockReturnValueOnce(false); // index.scip after run

    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await scipResolver.resolveProject('/tmp/project');
    expect(result.edges).toEqual([]);
    expect(result.symbolMap.size).toBe(0);
  });
});
