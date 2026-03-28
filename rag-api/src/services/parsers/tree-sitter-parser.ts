/**
 * TreeSitterParser - WASM-based AST parser using web-tree-sitter.
 * Provides accurate symbol extraction and graph edge detection
 * as a drop-in enhancement over the regex-based ast-parser.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { QueryMatch } from 'web-tree-sitter';
import type { GraphEdge } from './ast-parser';
import { getQueryForLanguage } from './queries/index';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ASTSymbol {
  name: string;
  kind:
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'method'
    | 'struct'
    | 'trait'
    | 'const';
  startLine: number;
  endLine: number;
  signature: string;
  exported: boolean;
  parent?: string;
}

// ---------------------------------------------------------------------------
// Language configuration
// ---------------------------------------------------------------------------

interface LanguageConfig {
  /** Grammar WASM filename inside the grammars/ directory. */
  wasmFile: string;
  /** File extensions handled by this grammar. */
  extensions: string[];
  /** Query file name inside queries/ directory (without extension). */
  queryFile: string | null;
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  typescript: {
    wasmFile: 'tree-sitter-typescript.wasm',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    queryFile: 'typescript',
  },
  python: {
    wasmFile: 'tree-sitter-python.wasm',
    extensions: ['.py'],
    queryFile: 'python',
  },
  go: {
    wasmFile: 'tree-sitter-go.wasm',
    extensions: ['.go'],
    queryFile: 'go',
  },
  rust: {
    wasmFile: 'tree-sitter-rust.wasm',
    extensions: ['.rs'],
    queryFile: 'rust',
  },
};

const EXT_TO_LANGUAGE: Map<string, string> = new Map();
for (const [lang, cfg] of Object.entries(LANGUAGE_CONFIGS)) {
  for (const ext of cfg.extensions) {
    EXT_TO_LANGUAGE.set(ext, lang);
  }
}

// ---------------------------------------------------------------------------
// Query definitions (inline fallbacks for languages without .scm files)
// ---------------------------------------------------------------------------

const INLINE_QUERIES: Record<string, string> = {
  python: `
; imports
(import_statement (dotted_name) @import.source) @import.statement
(import_from_statement module_name: (dotted_name) @import.source
  name: (dotted_name) @import.name) @import.statement
(import_from_statement module_name: (dotted_name) @import.source
  name: (aliased_import alias: (identifier) @import.name)) @import.statement

; definitions
(function_definition name: (identifier) @definition.name) @definition.node
(class_definition name: (identifier) @definition.name) @definition.node

; inheritance
(class_definition name: (identifier) @definition.name
  bases: (argument_list (identifier) @extends.name))

; method definitions
(function_definition name: (identifier) @definition.name) @definition.node
`,

  go: `
; imports
(import_declaration (import_spec path: (interpreted_string_literal) @import.source)) @import.statement
(import_declaration (import_spec_list (import_spec path: (interpreted_string_literal) @import.source))) @import.statement

; definitions
(function_declaration name: (identifier) @definition.name) @definition.node
(method_declaration name: (field_identifier) @definition.name) @definition.node
(type_declaration (type_spec name: (type_identifier) @definition.name)) @definition.node
`,

  rust: `
; definitions
(function_item name: (identifier) @definition.name) @definition.node
(struct_item name: (type_identifier) @definition.name) @definition.node
(enum_item name: (type_identifier) @definition.name) @definition.node
(trait_item name: (type_identifier) @definition.name) @definition.node
(impl_item type: (type_identifier) @definition.name) @definition.node

; use declarations
(use_declaration argument: (use_as_clause path: (scoped_identifier) @import.source)) @import.statement
(use_declaration argument: (scoped_identifier) @import.source) @import.statement

; inheritance (traits)
(impl_item trait: (type_identifier) @implements.name type: (type_identifier) @definition.name) @definition.node
`,
};

// ---------------------------------------------------------------------------
// TreeSitterParserService
// ---------------------------------------------------------------------------

// web-tree-sitter ships as ESM but we run CommonJS. We use dynamic import so
// TypeScript is happy and we avoid top-level import issues.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParserModule = any;

// From src/services/parsers/ or dist/services/parsers/ → rag-api root is 3 levels up
const RAG_API_ROOT = path.resolve(__dirname, '..', '..', '..');
const GRAMMARS_DIR = path.join(RAG_API_ROOT, 'grammars');
const WASM_PATH = path.join(
  RAG_API_ROOT,
  'node_modules',
  'web-tree-sitter',
  'web-tree-sitter.wasm'
);

class TreeSitterParserService {
  private Parser: ParserModule = null;
  private Language: ParserModule = null;
  private Query: ParserModule = null;
  private parsers: Map<string, ParserModule> = new Map();
  private languages: Map<string, ParserModule> = new Map();
  private queryStrings: Map<string, string> = new Map();
  private compiledQueries: Map<string, ParserModule> = new Map();

  private initialized = false;
  private initError: Error | null = null;
  private initPromise: Promise<void> | null = null;

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initError) return; // already failed, don't retry

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      // Dynamic import — web-tree-sitter is ESM
      const mod = await import('web-tree-sitter');
      // web-tree-sitter v0.25+ exports Parser and Language as separate named exports
      this.Parser = mod.Parser ?? mod.default ?? mod;
      this.Language = mod.Language;
      this.Query = mod.Query;

      await this.Parser.init({
        locateFile: () => WASM_PATH,
      });

      // Load language grammars (best-effort — skip missing ones)
      for (const [lang, cfg] of Object.entries(LANGUAGE_CONFIGS)) {
        await this._loadLanguage(lang, cfg);
      }

      this._loadQueryStrings();

      this.initialized = true;
      logger.debug('tree-sitter initialized', {
        languages: [...this.languages.keys()],
      });
    } catch (err) {
      this.initError = err as Error;
      logger.warn('tree-sitter failed to initialise — AST features disabled', {
        error: (err as Error).message,
      });
    }
  }

  private async _loadLanguage(lang: string, cfg: LanguageConfig): Promise<void> {
    const wasmPath = path.join(GRAMMARS_DIR, cfg.wasmFile);

    if (!fs.existsSync(wasmPath)) {
      logger.debug(`tree-sitter grammar not found, skipping ${lang}`, { wasmPath });
      return;
    }

    try {
      const wasmBytes = fs.readFileSync(wasmPath);
      const language = await this.Language.load(wasmBytes);
      this.languages.set(lang, language);

      const parser = new this.Parser();
      parser.setLanguage(language);
      this.parsers.set(lang, parser);

      logger.debug(`tree-sitter loaded grammar: ${lang}`);
    } catch (err) {
      logger.warn(`tree-sitter failed to load grammar for ${lang}`, {
        error: (err as Error).message,
      });
    }
  }

  private _loadQueryStrings(): void {
    // Representative extension per language — used only for the query lookup
    const langToExt: Record<string, string> = {
      typescript: '.ts',
      python: '.py',
      go: '.go',
      rust: '.rs',
    };

    for (const lang of Object.keys(LANGUAGE_CONFIGS)) {
      if (!this.languages.has(lang)) continue;

      const ext = langToExt[lang];
      if (ext) {
        const qs = getQueryForLanguage(ext);
        if (qs) {
          this.queryStrings.set(lang, qs);
          continue;
        }
      }

      // Inline fallback
      if (INLINE_QUERIES[lang]) {
        this.queryStrings.set(lang, INLINE_QUERIES[lang]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getLanguageForFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXT_TO_LANGUAGE.get(ext) ?? null;
  }

  private getParser(language: string): ParserModule | null {
    return this.parsers.get(language) ?? null;
  }

  private getCompiledQuery(language: string): ParserModule | null {
    if (this.compiledQueries.has(language)) {
      return this.compiledQueries.get(language)!;
    }

    const lang = this.languages.get(language);
    const queryStr = this.queryStrings.get(language);
    if (!lang || !queryStr) return null;

    try {
      const query = new this.Query(lang, queryStr);
      this.compiledQueries.set(language, query);
      return query;
    } catch (err) {
      logger.warn(`tree-sitter query compilation failed for ${language}`, {
        error: (err as Error).message,
      });
      return null;
    }
  }

  private runMatches(tree: ParserModule, language: string): QueryMatch[] {
    const query = this.getCompiledQuery(language);
    if (!query) return [];
    try {
      return query.matches(tree.rootNode) as QueryMatch[];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async extractEdges(content: string, filePath: string): Promise<GraphEdge[]> {
    await this.init();
    if (!this.initialized) return [];

    const language = this.getLanguageForFile(filePath);
    if (!language) return [];

    const parser = this.getParser(language);
    if (!parser) return [];

    let tree: ParserModule;
    try {
      tree = parser.parse(content);
    } catch {
      return [];
    }

    const matches = this.runMatches(tree, language);
    const edges: GraphEdge[] = [];

    // -- import edges --------------------------------------------------------
    const importStatements = matches.filter((m) =>
      m.captures.some((c: { name: string }) => c.name === 'import.statement')
    );

    for (const match of importStatements) {
      const sourceCapture = match.captures.find(
        (c: { name: string }) => c.name === 'import.source'
      );
      if (!sourceCapture) continue;

      // strip surrounding quotes for Python dotted paths returned as raw text
      let rawSource = sourceCapture.node.text ?? '';
      rawSource = rawSource.replace(/^["']|["']$/g, '');

      const toFile = this.resolveImportPath(rawSource, filePath, path.extname(filePath));

      const nameCaptures = match.captures.filter((c: { name: string }) => c.name === 'import.name');

      if (nameCaptures.length === 0) {
        // Side-effect import — use the module base name as symbol
        const sym = path.basename(rawSource).replace(/\.\w+$/, '');
        edges.push({
          fromFile: filePath,
          fromSymbol: sym,
          toFile,
          toSymbol: sym,
          edgeType: 'imports',
          confidence: 'tree-sitter',
        });
      } else {
        for (const nc of nameCaptures) {
          const sym = nc.node.text ?? '';
          if (sym) {
            edges.push({
              fromFile: filePath,
              fromSymbol: sym,
              toFile,
              toSymbol: sym,
              edgeType: 'imports',
            });
          }
        }
      }
    }

    // -- extends / implements edges ------------------------------------------
    const definitionMatches = matches.filter((m) =>
      m.captures.some((c: { name: string }) => c.name === 'definition.node')
    );

    for (const match of definitionMatches) {
      const defName = match.captures.find((c: { name: string }) => c.name === 'definition.name');
      if (!defName) continue;
      const fromSymbol = defName.node.text ?? '';

      const extendsCaptures = match.captures.filter(
        (c: { name: string }) => c.name === 'extends.name'
      );
      for (const ec of extendsCaptures) {
        edges.push({
          fromFile: filePath,
          fromSymbol,
          toFile: filePath,
          toSymbol: ec.node.text ?? '',
          edgeType: 'extends',
          confidence: 'tree-sitter',
        });
      }

      const implCaptures = match.captures.filter(
        (c: { name: string }) => c.name === 'implements.name'
      );
      for (const ic of implCaptures) {
        edges.push({
          fromFile: filePath,
          fromSymbol,
          toFile: filePath,
          toSymbol: ic.node.text ?? '',
          edgeType: 'implements',
          confidence: 'tree-sitter',
        });
      }
    }

    // -- call edges ----------------------------------------------------------
    const callMatches = matches.filter((m) =>
      m.captures.some((c: { name: string }) => c.name === 'call.node')
    );

    for (const match of callMatches) {
      const fnCapture = match.captures.find((c: { name: string }) => c.name === 'call.function');
      if (!fnCapture) continue;
      const callName = fnCapture.node.text ?? '';
      if (!callName) continue;

      edges.push({
        fromFile: filePath,
        fromSymbol: callName,
        toFile: filePath,
        toSymbol: callName,
        edgeType: 'calls',
        confidence: 'tree-sitter',
      });
    }

    return edges;
  }

  async extractSymbols(content: string, filePath: string): Promise<ASTSymbol[]> {
    await this.init();
    if (!this.initialized) return [];

    const language = this.getLanguageForFile(filePath);
    if (!language) return [];

    const parser = this.getParser(language);
    if (!parser) return [];

    let tree: ParserModule;
    try {
      tree = parser.parse(content);
    } catch {
      return [];
    }

    const matches = this.runMatches(tree, language);
    const symbols: ASTSymbol[] = [];
    const lines = content.split('\n');

    const definitionMatches = matches.filter((m) =>
      m.captures.some((c: { name: string }) => c.name === 'definition.node')
    );

    for (const match of definitionMatches) {
      const defNameCapture = match.captures.find(
        (c: { name: string }) => c.name === 'definition.name'
      );
      const defNodeCapture = match.captures.find(
        (c: { name: string }) => c.name === 'definition.node'
      );

      if (!defNameCapture || !defNodeCapture) continue;

      const name = defNameCapture.node.text ?? '';
      if (!name) continue;

      const node = defNodeCapture.node;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;

      // Determine kind from node type
      const kind = this._kindFromNodeType(node.type ?? '', language);

      // Build a one-line signature from the source
      const firstLine = lines[node.startPosition.row] ?? '';
      const signature = firstLine.trim().replace(/\s*\{?\s*$/, '');

      // Check if exported (TS/JS only: parent is export_statement)
      const exported = this._isExported(node);

      // Determine parent class for methods
      const parent = kind === 'method' ? this._findParentClass(node) : undefined;

      symbols.push({ name, kind, startLine, endLine, signature, exported, parent });
    }

    // Deduplicate by (name + startLine)
    const seen = new Set<string>();
    return symbols.filter((s) => {
      const key = `${s.name}:${s.startLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _kindFromNodeType(nodeType: string, _language: string): ASTSymbol['kind'] {
    const map: Record<string, ASTSymbol['kind']> = {
      function_declaration: 'function',
      function_definition: 'function',
      function_item: 'function',
      method_declaration: 'method',
      method_definition: 'method',
      class_declaration: 'class',
      class_definition: 'class',
      interface_declaration: 'interface',
      type_alias_declaration: 'type',
      type_spec: 'type',
      enum_declaration: 'enum',
      enum_item: 'enum',
      struct_item: 'struct',
      trait_item: 'trait',
      impl_item: 'class',
      lexical_declaration: 'const',
      variable_declarator: 'const',
      arrow_function: 'function',
      function_expression: 'function',
    };
    return map[nodeType] ?? 'function';
  }

  private _isExported(node: ParserModule): boolean {
    const parent = node.parent;
    if (!parent) return false;
    return (
      parent.type === 'export_statement' ||
      parent.type === 'export_named_declaration' ||
      parent.type === 'export_default_declaration'
    );
  }

  private _findParentClass(node: ParserModule): string | undefined {
    let cur = node.parent;
    while (cur) {
      if (cur.type === 'class_declaration' || cur.type === 'class_definition') {
        const nameChild = cur.childForFieldName ? cur.childForFieldName('name') : null;
        return nameChild?.text ?? undefined;
      }
      cur = cur.parent;
    }
    return undefined;
  }

  private resolveImportPath(importPath: string, fromFile: string, ext: string): string {
    if (!importPath.startsWith('.')) {
      return importPath; // external package
    }

    const dir = path.dirname(fromFile);
    let resolved = path.join(dir, importPath);

    if (!path.extname(resolved)) {
      resolved += ext;
    }

    return resolved.replace(/\\/g, '/');
  }
}

export const treeSitterParser = new TreeSitterParserService();
