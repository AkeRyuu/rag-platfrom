/**
 * Filter Builder - Constructs Qdrant filter objects from search parameters.
 */

export interface SearchFilters {
  language?: string;
  path?: string;
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

  return conditions.length > 0 ? { must: conditions } : undefined;
}
