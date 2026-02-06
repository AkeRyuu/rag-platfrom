/**
 * Code Parser - Regex-based function/class boundary detection with symbol extraction.
 */

import * as path from 'path';
import type { FileParser, ParsedChunk } from './base-parser';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.go', '.rs',
  '.java', '.c', '.cpp', '.cs', '.php', '.rb', '.swift', '.kt',
  '.scala', '.sh', '.bash',
]);

// Patterns for function/class boundaries
const BOUNDARY_PATTERNS = [
  // TypeScript/JavaScript
  /^(?:export\s+)?(?:async\s+)?function\s+\w+/,
  /^(?:export\s+)?(?:default\s+)?class\s+\w+/,
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/,
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\()/,
  /^(?:export\s+)?interface\s+\w+/,
  /^(?:export\s+)?type\s+\w+\s*=/,
  /^(?:export\s+)?enum\s+\w+/,
  // Python
  /^(?:async\s+)?def\s+\w+/,
  /^class\s+\w+/,
  // Go
  /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+/,
  /^type\s+\w+\s+struct/,
  // Rust
  /^(?:pub\s+)?(?:async\s+)?fn\s+\w+/,
  /^(?:pub\s+)?struct\s+\w+/,
  /^(?:pub\s+)?enum\s+\w+/,
  /^impl\s+/,
  // Java/C#
  /^(?:public|private|protected)\s+(?:static\s+)?(?:class|interface|enum)\s+\w+/,
  /^(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?\w+\s+\w+\s*\(/,
];

// Symbol extraction patterns
const SYMBOL_PATTERNS = [
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
  /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g,
  /(?:export\s+)?interface\s+(\w+)/g,
  /(?:export\s+)?type\s+(\w+)\s*=/g,
  /(?:export\s+)?enum\s+(\w+)/g,
  /(?:async\s+)?def\s+(\w+)/g,
  /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/gm,
  /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g,
  /(?:pub\s+)?struct\s+(\w+)/g,
  /(?:pub\s+)?enum\s+(\w+)/g,
];

// Import extraction patterns
const IMPORT_PATTERNS = [
  /import\s+.*?from\s+['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /from\s+(\S+)\s+import/g, // Python
];

function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.vue': 'vue', '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.php': 'php', '.rb': 'ruby',
    '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala', '.sh': 'shell', '.bash': 'shell',
  };
  return langMap[ext] || 'unknown';
}

export class CodeParser implements FileParser {
  canParse(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  }

  parse(content: string, filePath: string): ParsedChunk[] {
    const language = getLanguage(filePath);
    const lines = content.split('\n');

    // Extract symbols and imports for the whole file
    const allSymbols = this.extractSymbols(content);
    const allImports = this.extractImports(content);

    // Try boundary-based chunking first
    const boundaries = this.findBoundaries(lines);

    if (boundaries.length >= 2) {
      return this.chunkByBoundaries(lines, boundaries, language, allSymbols, allImports);
    }

    // Fallback: line-based chunking (similar to existing chunkCode)
    return this.chunkByLines(lines, language, allSymbols, allImports);
  }

  private findBoundaries(lines: string[]): number[] {
    const boundaries: number[] = [0];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (BOUNDARY_PATTERNS.some(p => p.test(trimmed))) {
        // Don't add if too close to previous boundary
        const last = boundaries[boundaries.length - 1];
        if (i - last >= 5) {
          boundaries.push(i);
        }
      }
    }

    return boundaries;
  }

  private chunkByBoundaries(
    lines: string[],
    boundaries: number[],
    language: string,
    allSymbols: string[],
    allImports: string[]
  ): ParsedChunk[] {
    const chunks: ParsedChunk[] = [];

    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const end = i + 1 < boundaries.length ? boundaries[i + 1] : lines.length;
      const chunkLines = lines.slice(start, end);
      const chunkContent = chunkLines.join('\n');

      if (chunkContent.trim().length < 10) continue;

      // Extract symbols specific to this chunk
      const chunkSymbols = this.extractSymbols(chunkContent);

      chunks.push({
        content: chunkContent,
        startLine: start + 1,
        endLine: end,
        language,
        type: 'code',
        symbols: chunkSymbols.length > 0 ? chunkSymbols : undefined,
        imports: i === 0 ? allImports : undefined, // imports only in first chunk
      });
    }

    return chunks;
  }

  private chunkByLines(
    lines: string[],
    language: string,
    allSymbols: string[],
    allImports: string[]
  ): ParsedChunk[] {
    const chunks: ParsedChunk[] = [];
    const maxChunkSize = 1000;
    let currentStart = 0;
    let currentSize = 0;
    let chunkLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (currentSize + line.length > maxChunkSize && chunkLines.length > 0) {
        const chunkContent = chunkLines.join('\n');
        const chunkSymbols = this.extractSymbols(chunkContent);

        chunks.push({
          content: chunkContent,
          startLine: currentStart + 1,
          endLine: i,
          language,
          type: 'code',
          symbols: chunkSymbols.length > 0 ? chunkSymbols : undefined,
          imports: chunks.length === 0 ? allImports : undefined,
        });

        chunkLines = [];
        currentStart = i;
        currentSize = 0;
      }
      chunkLines.push(line);
      currentSize += line.length + 1;
    }

    if (chunkLines.length > 0) {
      const chunkContent = chunkLines.join('\n');
      const chunkSymbols = this.extractSymbols(chunkContent);

      chunks.push({
        content: chunkContent,
        startLine: currentStart + 1,
        endLine: lines.length,
        language,
        type: 'code',
        symbols: chunkSymbols.length > 0 ? chunkSymbols : undefined,
        imports: chunks.length === 0 ? allImports : undefined,
      });
    }

    return chunks;
  }

  extractSymbols(content: string): string[] {
    const symbols = new Set<string>();

    for (const pattern of SYMBOL_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (match[1] && match[1].length > 1) {
          symbols.add(match[1]);
        }
      }
    }

    return [...symbols];
  }

  extractImports(content: string): string[] {
    const imports = new Set<string>();

    for (const pattern of IMPORT_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (match[1]) {
          imports.add(match[1]);
        }
      }
    }

    return [...imports];
  }
}

export const codeParser = new CodeParser();
