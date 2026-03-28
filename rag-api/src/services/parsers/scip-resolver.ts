/**
 * SCIP Resolver Service
 *
 * Runs SCIP indexers (scip-typescript, etc.) as subprocesses to get compiler-grade
 * cross-file symbol resolution, then parses the protobuf output to produce accurate
 * GraphEdge instances.
 *
 * Symbol role bitmask (from scip.proto):
 *   Definition   = 1
 *   Import       = 2   (unused in TS indexer; use definition+reference logic instead)
 *   WriteAccess  = 4
 *   ReadAccess   = 8
 *   Generated    = 16
 *   Test         = 32
 *   ForwardDefinition = 64
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as protobuf from 'protobufjs';
import { logger } from '../../utils/logger';
import type { GraphEdge } from './ast-parser';
import pLimitModule from 'p-limit';
const pLimit = (pLimitModule as any).default || pLimitModule;

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SCIPResolvedEdge extends GraphEdge {
  /** Provenance of the edge — SCIP resolution is most accurate. */
  confidence: 'scip' | 'tree-sitter' | 'heuristic';
  /** Raw SCIP symbol descriptor, e.g. `npm @types/node 18.0.0 path/posix.join().` */
  symbolDescriptor?: string;
}

export interface SymbolEntry {
  file: string;
  line: number;
  kind: string;
}

export interface SCIPResolveResult {
  edges: SCIPResolvedEdge[];
  symbolMap: Map<string, SymbolEntry>;
  duration: number;
}

// ---------------------------------------------------------------------------
// Internal protobuf types (mirrors scip.proto — only fields we consume)
// ---------------------------------------------------------------------------

interface SCIPOccurrence {
  range: number[];
  symbol: string;
  symbolRoles: number;
}

interface SCIPRelationship {
  symbol: string;
  isReference: boolean;
  isImplementation: boolean;
  isTypeDefinition: boolean;
  isDefinition: boolean;
}

interface SCIPSymbolInformation {
  symbol: string;
  relationships: SCIPRelationship[];
}

interface SCIPDocument {
  relativePath: string;
  occurrences: SCIPOccurrence[];
  symbols: SCIPSymbolInformation[];
}

interface SCIPIndex {
  documents: SCIPDocument[];
  externalSymbols: SCIPSymbolInformation[];
}

// Symbol role bitmask constants
const ROLE_DEFINITION = 1;

// ---------------------------------------------------------------------------
// Proto loader (cached per process)
// ---------------------------------------------------------------------------

let _messageType: protobuf.Type | null = null;

async function loadIndexType(): Promise<protobuf.Type> {
  if (_messageType) return _messageType;

  const protoPath = path.join(__dirname, 'scip.proto');
  const root = await protobuf.load(protoPath);
  _messageType = root.lookupType('scip.Index');
  return _messageType;
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

const SCIP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_INDEX_BYTES = 100 * 1024 * 1024; // 100 MB
const SCIP_CONCURRENCY = 3; // max parallel scip-typescript processes

/**
 * Discover all tsconfig.json files in a project.
 * Returns relative paths from projectPath, excluding node_modules/dist/build.
 */
function discoverTsconfigs(projectPath: string): string[] {
  const results: string[] = [];
  const exclude = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    'coverage',
    '.next',
    '.nuxt',
    '__pycache__',
    'target',
  ]);

  function walk(dir: string, relativeBase: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !exclude.has(entry.name)) {
        walk(path.join(dir, entry.name), path.join(relativeBase, entry.name));
      } else if (entry.isFile() && entry.name === 'tsconfig.json') {
        results.push(path.join(relativeBase, entry.name));
      }
    }
  }

  // Check root first
  if (fs.existsSync(path.join(projectPath, 'tsconfig.json'))) {
    results.push('tsconfig.json');
  }
  // Walk subdirectories (skip root tsconfig if already found)
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !exclude.has(entry.name)) {
      walk(path.join(projectPath, entry.name), entry.name);
    }
  }

  return results;
}

async function runSCIPTypescript(projectPath: string): Promise<string> {
  const outputPath = path.join(projectPath, 'index.scip');

  // Remove stale output from a previous run
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  await execFileAsync(
    'npx',
    ['--yes', '@sourcegraph/scip-typescript', 'index', '--cwd', projectPath],
    {
      timeout: SCIP_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10 MB stdout/stderr buffer
      env: { ...process.env },
    }
  );

  return outputPath;
}

// ---------------------------------------------------------------------------
// Protobuf parser
// ---------------------------------------------------------------------------

async function parseSCIPIndex(indexPath: string): Promise<SCIPIndex> {
  const stats = fs.statSync(indexPath);
  if (stats.size > MAX_INDEX_BYTES) {
    logger.warn(
      `index.scip is ${Math.round(stats.size / 1024 / 1024)} MB — skipping (limit 100 MB)`,
      {
        indexPath,
      }
    );
    return { documents: [], externalSymbols: [] };
  }

  const buffer = fs.readFileSync(indexPath);
  const IndexType = await loadIndexType();
  const decoded = IndexType.decode(buffer) as unknown as SCIPIndex;
  return decoded;
}

// ---------------------------------------------------------------------------
// Edge extraction
// ---------------------------------------------------------------------------

/**
 * Extract the "local name" from a SCIP symbol descriptor so we can use it as
 * fromSymbol / toSymbol in GraphEdge.  SCIP symbols look like:
 *   `npm @types/node 18.0.0 path/posix.join().`
 *   `local 42`
 *   `scip-typescript npm mypackage 1.0.0 src/foo.ts/MyClass#`
 * We take the last non-empty segment split on space or `/` and strip trailing
 * punctuation that SCIP uses as kind suffixes (`.`, `#`, `()`).
 */
function localName(symbol: string): string {
  if (!symbol) return '';
  // After trimming local markers, grab last meaningful segment
  const parts = symbol.trim().split(/[\s/]+/);
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/[.#()]+$/, '') || symbol;
}

/**
 * Build a map from SCIP symbol → { file, line } using Definition occurrences.
 */
function buildSymbolMap(documents: SCIPDocument[]): Map<string, SymbolEntry> {
  const map = new Map<string, SymbolEntry>();

  for (const doc of documents) {
    for (const occ of doc.occurrences ?? []) {
      if (!occ.symbol) continue;
      const isDefinition = (occ.symbolRoles & ROLE_DEFINITION) !== 0;
      if (isDefinition) {
        const line = Array.isArray(occ.range) && occ.range.length > 0 ? occ.range[0] : 0;
        if (!map.has(occ.symbol)) {
          map.set(occ.symbol, {
            file: doc.relativePath,
            line,
            kind: inferKind(occ.symbol),
          });
        }
      }
    }
  }

  return map;
}

/**
 * Infer a coarse kind from the SCIP symbol descriptor suffix.
 *   `#`  → class/interface
 *   `()` → function/method
 *   `.`  → field/property
 *   (no suffix) → namespace/module
 */
function inferKind(symbol: string): string {
  if (symbol.endsWith('#')) return 'class';
  if (symbol.endsWith('.')) return 'field';
  if (symbol.endsWith(')')) return 'function';
  if (symbol.endsWith('/')) return 'namespace';
  return 'unknown';
}

/**
 * For each document, look at every non-definition occurrence.  If a symbol is
 * defined in a DIFFERENT file, that is a cross-file reference → import edge.
 */
function extractImportEdges(
  documents: SCIPDocument[],
  symbolMap: Map<string, SymbolEntry>
): SCIPResolvedEdge[] {
  const edges: SCIPResolvedEdge[] = [];
  const seen = new Set<string>();

  for (const doc of documents) {
    const fromFile = doc.relativePath;

    for (const occ of doc.occurrences ?? []) {
      if (!occ.symbol) continue;
      const isDefinition = (occ.symbolRoles & ROLE_DEFINITION) !== 0;
      if (isDefinition) continue; // skip definitions — they are the source

      const defEntry = symbolMap.get(occ.symbol);
      if (!defEntry) continue; // external / unresolvable symbol
      if (defEntry.file === fromFile) continue; // same-file reference

      const dedupeKey = `${fromFile}→${occ.symbol}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      edges.push({
        fromFile,
        fromSymbol: localName(occ.symbol),
        toFile: defEntry.file,
        toSymbol: localName(occ.symbol),
        edgeType: 'imports',
        confidence: 'scip',
        symbolDescriptor: occ.symbol,
      });
    }
  }

  return edges;
}

/**
 * Extract inheritance edges from SymbolInformation.relationships inside each
 * document.  Also handles externalSymbols for cross-package relationships.
 */
function extractInheritanceEdges(
  documents: SCIPDocument[],
  externalSymbols: SCIPSymbolInformation[],
  symbolMap: Map<string, SymbolEntry>
): SCIPResolvedEdge[] {
  const edges: SCIPResolvedEdge[] = [];

  const allSymbolInfos: Array<{ info: SCIPSymbolInformation; sourceFile?: string }> = [
    ...documents.flatMap((doc) =>
      (doc.symbols ?? []).map((info) => ({ info, sourceFile: doc.relativePath }))
    ),
    ...(externalSymbols ?? []).map((info) => ({ info, sourceFile: undefined })),
  ];

  for (const { info, sourceFile } of allSymbolInfos) {
    if (!info.symbol) continue;

    const fromEntry = symbolMap.get(info.symbol);
    const fromFile = fromEntry?.file ?? sourceFile;
    if (!fromFile) continue;

    for (const rel of info.relationships ?? []) {
      if (!rel.symbol) continue;

      let edgeType: GraphEdge['edgeType'] | null = null;
      if (rel.isImplementation) {
        edgeType = 'implements';
      } else if (rel.isTypeDefinition) {
        edgeType = 'extends';
      }
      if (!edgeType) continue;

      const toEntry = symbolMap.get(rel.symbol);
      const toFile = toEntry?.file ?? rel.symbol; // fall back to symbol string as placeholder

      edges.push({
        fromFile,
        fromSymbol: localName(info.symbol),
        toFile,
        toSymbol: localName(rel.symbol),
        edgeType,
        confidence: 'scip',
        symbolDescriptor: info.symbol,
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

/**
 * Merge tree-sitter edges with SCIP-resolved edges.
 *
 * Strategy:
 *   1. Build a lookup from SCIP edges keyed by (fromFile, fromSymbol, edgeType).
 *   2. For each tree-sitter edge, if a SCIP edge matches on fromFile+fromSymbol+edgeType,
 *      replace toFile/toSymbol with the SCIP-resolved values and upgrade confidence.
 *   3. SCIP-only edges (no tree-sitter counterpart) are appended.
 */
function mergeEdges(
  treeSitterEdges: GraphEdge[],
  scipEdges: SCIPResolvedEdge[]
): SCIPResolvedEdge[] {
  // Key: `fromFile::fromSymbol::edgeType`
  const scipByKey = new Map<string, SCIPResolvedEdge>();
  for (const edge of scipEdges) {
    const key = `${edge.fromFile}::${edge.fromSymbol}::${edge.edgeType}`;
    scipByKey.set(key, edge);
  }

  const result: SCIPResolvedEdge[] = [];
  const usedSCIPKeys = new Set<string>();

  for (const tsEdge of treeSitterEdges) {
    const key = `${tsEdge.fromFile}::${tsEdge.fromSymbol}::${tsEdge.edgeType}`;
    const scip = scipByKey.get(key);
    if (scip) {
      // Upgrade tree-sitter edge with SCIP-resolved file/symbol
      result.push({
        fromFile: tsEdge.fromFile,
        fromSymbol: tsEdge.fromSymbol,
        toFile: scip.toFile,
        toSymbol: scip.toSymbol,
        edgeType: tsEdge.edgeType,
        confidence: 'scip',
        symbolDescriptor: scip.symbolDescriptor,
      });
      usedSCIPKeys.add(key);
    } else {
      // No SCIP match — keep tree-sitter edge with downgraded confidence
      result.push({
        ...tsEdge,
        confidence: 'tree-sitter',
      });
    }
  }

  // Append SCIP edges that had no tree-sitter counterpart
  for (const edge of scipEdges) {
    const key = `${edge.fromFile}::${edge.fromSymbol}::${edge.edgeType}`;
    if (!usedSCIPKeys.has(key)) {
      result.push(edge);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

class SCIPResolverService {
  /**
   * Run the SCIP indexer for a project and return resolved edges + symbol map.
   * Supports monorepos with nested tsconfig.json files — discovers all subprojects
   * and runs scip-typescript in parallel with path normalization.
   *
   * @param projectPath  Absolute path to the project root.
   */
  async resolveProject(projectPath: string): Promise<SCIPResolveResult> {
    const start = Date.now();

    // Discover all tsconfig.json files (root + nested)
    const tsconfigs = discoverTsconfigs(projectPath);
    if (tsconfigs.length === 0) {
      logger.info('No tsconfig.json found — skipping SCIP resolution', { projectPath });
      return { edges: [], symbolMap: new Map(), duration: Date.now() - start };
    }

    logger.info('SCIP: discovered tsconfig files', {
      projectPath,
      count: tsconfigs.length,
      tsconfigs: tsconfigs.slice(0, 10),
    });

    // Determine subproject directories to index
    const subprojects = tsconfigs.map((tc) => {
      const subDir = path.dirname(tc); // relative dir from project root
      return {
        tsconfigRelative: tc,
        absolutePath: path.join(projectPath, subDir),
        pathPrefix: subDir === '.' ? '' : subDir, // prefix for normalizing file paths
      };
    });

    // If root tsconfig exists, only index root (it typically covers everything)
    const rootOnly = tsconfigs.includes('tsconfig.json');
    const targets = rootOnly ? subprojects.filter((s) => s.pathPrefix === '') : subprojects;

    if (rootOnly && tsconfigs.length > 1) {
      logger.info('SCIP: root tsconfig.json found — indexing root only', { projectPath });
    }

    // Run SCIP in parallel across subprojects
    const limit = pLimit(SCIP_CONCURRENCY);
    const results = await Promise.all(
      targets.map((sub) =>
        limit(async () => this._resolveSubproject(sub.absolutePath, sub.pathPrefix))
      )
    );

    // Merge all subproject results
    const allEdges: SCIPResolvedEdge[] = [];
    const mergedSymbolMap = new Map<string, SymbolEntry>();
    let totalDocs = 0;

    for (const result of results) {
      if (!result) continue;
      allEdges.push(...result.edges);
      for (const [k, v] of result.symbolMap) {
        if (!mergedSymbolMap.has(k)) mergedSymbolMap.set(k, v);
      }
      totalDocs += result.docCount;
    }

    // Dedup edges by (fromFile, fromSymbol, toFile, toSymbol, edgeType)
    const seen = new Set<string>();
    const dedupedEdges = allEdges.filter((e) => {
      const key = `${e.fromFile}::${e.fromSymbol}::${e.toFile}::${e.toSymbol}::${e.edgeType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const duration = Date.now() - start;

    logger.info('SCIP resolution complete', {
      projectPath,
      subprojects: targets.length,
      documents: totalDocs,
      symbols: mergedSymbolMap.size,
      edges: dedupedEdges.length,
      durationMs: duration,
    });

    return { edges: dedupedEdges, symbolMap: mergedSymbolMap, duration };
  }

  /**
   * Run SCIP on a single subproject directory and return edges with normalized paths.
   */
  private async _resolveSubproject(
    subprojectPath: string,
    pathPrefix: string
  ): Promise<{
    edges: SCIPResolvedEdge[];
    symbolMap: Map<string, SymbolEntry>;
    docCount: number;
  } | null> {
    let indexPath: string;
    try {
      logger.info('Running scip-typescript indexer', { subprojectPath, pathPrefix });
      indexPath = await runSCIPTypescript(subprojectPath);
    } catch (err) {
      logger.warn('scip-typescript failed for subproject', {
        subprojectPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    if (!fs.existsSync(indexPath)) {
      logger.warn('index.scip not produced', { subprojectPath });
      return null;
    }

    let scipIndex: SCIPIndex;
    try {
      scipIndex = await parseSCIPIndex(indexPath);
    } catch (err) {
      logger.warn('Failed to parse index.scip', {
        subprojectPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      try {
        fs.unlinkSync(indexPath);
      } catch {
        // best-effort
      }
    }

    const documents = scipIndex.documents ?? [];

    // Normalize paths: prepend subproject prefix so paths are relative to project root
    if (pathPrefix) {
      for (const doc of documents) {
        doc.relativePath = path.join(pathPrefix, doc.relativePath).replace(/\\/g, '/');
      }
    }

    const symbolMap = buildSymbolMap(documents);

    // Normalize symbolMap file paths too
    if (pathPrefix) {
      for (const [key, entry] of symbolMap) {
        if (!entry.file.startsWith(pathPrefix)) {
          entry.file = path.join(pathPrefix, entry.file).replace(/\\/g, '/');
        }
      }
    }

    const importEdges = extractImportEdges(documents, symbolMap);
    const inheritanceEdges = extractInheritanceEdges(
      documents,
      scipIndex.externalSymbols ?? [],
      symbolMap
    );

    return {
      edges: [...importEdges, ...inheritanceEdges],
      symbolMap,
      docCount: documents.length,
    };
  }

  /**
   * Check whether a SCIP indexer is available for the given language.
   * Currently only TypeScript is supported; the check is fast (which-style).
   */
  async isAvailable(language: 'typescript' | 'python' | 'go'): Promise<boolean> {
    if (language !== 'typescript') return false;

    try {
      await execFileAsync('npx', ['--yes', '@sourcegraph/scip-typescript', '--version'], {
        timeout: 15_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Merge tree-sitter graph edges with SCIP-resolved edges.
   * SCIP edges take precedence for toFile/toSymbol resolution.
   */
  mergeEdges(treeSitterEdges: GraphEdge[], scipEdges: SCIPResolvedEdge[]): SCIPResolvedEdge[] {
    return mergeEdges(treeSitterEdges, scipEdges);
  }
}

export const scipResolver = new SCIPResolverService();
