/**
 * Anchor Context Builder - Prepends contextual metadata to chunks before embedding.
 *
 * The anchor string is prepended to the chunk content before computing the embedding,
 * but the original content is stored in the payload for display. This enriches the
 * embedding with file path, layer, service, and symbol context.
 */

export interface AnchorInput {
  filePath: string;
  language: string;
  chunkType: string;
  symbols?: string[];
  imports?: string[];
  layer?: string;
  service?: string;
  startLine?: number;
  endLine?: number;
}

export function buildAnchorString(input: AnchorInput): string {
  const lines: string[] = [];
  const comment = ['markdown', 'rst', 'yaml', 'json', 'env'].includes(input.language) ? '#' : '//';

  lines.push(`${comment} File: ${input.filePath} [${input.chunkType}]`);

  if (input.layer || input.service) {
    const parts: string[] = [];
    if (input.layer) parts.push(`Layer: ${input.layer}`);
    if (input.service) parts.push(`Service: ${input.service}`);
    lines.push(`${comment} ${parts.join(' | ')}`);
  }

  if (input.symbols?.length) {
    lines.push(`${comment} Defines: ${input.symbols.slice(0, 5).join(', ')}`);
  }

  if (input.imports?.length) {
    lines.push(`${comment} Imports: ${input.imports.slice(0, 5).join(', ')}`);
  }

  return lines.join('\n');
}
