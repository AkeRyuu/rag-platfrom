/**
 * Base Parser - Interfaces for the parser registry.
 */

export interface ParsedChunk {
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  type: 'code' | 'config' | 'docs' | 'contract';
  symbols?: string[];
  imports?: string[];
  metadata?: Record<string, unknown>;
}

export interface FileParser {
  canParse(filePath: string): boolean;
  parse(content: string, filePath: string): ParsedChunk[];
}
