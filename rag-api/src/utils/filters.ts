/**
 * Filter Builder - Constructs Qdrant filter objects from search parameters.
 */

export interface SearchFilters {
  language?: string;
  path?: string;
  layer?: string;
  service?: string;
}

interface QdrantCondition {
  key: string;
  match: { value?: string; text?: string };
}

/**
 * Build a Qdrant filter from search parameters.
 * Returns undefined if no filters apply.
 */
export function buildSearchFilter(filters?: SearchFilters): Record<string, unknown> | undefined {
  if (!filters) return undefined;

  const conditions: QdrantCondition[] = [];

  if (filters.language) {
    conditions.push({ key: 'language', match: { value: filters.language } });
  }

  if (filters.path) {
    conditions.push({ key: 'file', match: { text: filters.path } });
  }

  if (filters.layer) {
    conditions.push({ key: 'layer', match: { value: filters.layer } });
  }

  if (filters.service) {
    conditions.push({ key: 'service', match: { value: filters.service } });
  }

  return conditions.length > 0 ? { must: conditions } : undefined;
}
