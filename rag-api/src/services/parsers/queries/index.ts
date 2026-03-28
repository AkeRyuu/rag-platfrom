import * as fs from 'fs';
import * as path from 'path';

function loadQuery(filename: string): string {
  // Try src location first (dev/ts-node), then dist location (compiled)
  const candidates = [
    path.join(__dirname, filename),
    path.join(__dirname, '..', '..', '..', '..', 'src', 'services', 'parsers', 'queries', filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf-8');
    }
  }
  throw new Error(`Tree-sitter query file not found: ${filename}`);
}

export const typescriptQuery: string = loadQuery('typescript.scm');
export const pythonQuery: string = loadQuery('python.scm');
export const goQuery: string = loadQuery('go.scm');
export const rustQuery: string = loadQuery('rust.scm');

const EXTENSION_MAP: Record<string, string> = {
  '.ts': typescriptQuery,
  '.tsx': typescriptQuery,
  '.js': typescriptQuery,
  '.jsx': typescriptQuery,
  '.mjs': typescriptQuery,
  '.cjs': typescriptQuery,
  '.py': pythonQuery,
  '.go': goQuery,
  '.rs': rustQuery,
};

/**
 * Return the tree-sitter query string for the given file extension,
 * or null if no query is registered for that extension.
 */
export function getQueryForLanguage(ext: string): string | null {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return EXTENSION_MAP[normalized] ?? null;
}

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(EXTENSION_MAP));
