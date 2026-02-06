/**
 * Parser Registry - Routes files to appropriate parsers.
 */

import type { FileParser, ParsedChunk } from './base-parser';
import { codeParser } from './code-parser';
import { configParser } from './config-parser';
import { docsParser } from './docs-parser';
import { contractParser } from './contract-parser';

export type { ParsedChunk, FileParser } from './base-parser';

class ParserRegistry {
  private parsers: FileParser[] = [];

  register(parser: FileParser): void {
    this.parsers.push(parser);
  }

  getParser(filePath: string): FileParser | null {
    for (const parser of this.parsers) {
      if (parser.canParse(filePath)) {
        return parser;
      }
    }
    return null;
  }

  classifyFile(filePath: string): 'code' | 'config' | 'docs' | 'contract' | 'unknown' {
    // Check in priority order: contract > config > docs > code
    if (contractParser.canParse(filePath)) return 'contract';
    if (configParser.canParse(filePath)) return 'config';
    if (docsParser.canParse(filePath)) return 'docs';
    if (codeParser.canParse(filePath)) return 'code';
    return 'unknown';
  }
}

export const parserRegistry = new ParserRegistry();

// Register parsers in priority order
parserRegistry.register(contractParser);
parserRegistry.register(configParser);
parserRegistry.register(docsParser);
parserRegistry.register(codeParser);
