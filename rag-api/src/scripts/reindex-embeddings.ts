/**
 * Re-Index Script — Migrate to Qwen3-Embedding-4B
 *
 * Scrolls all points from existing collections, re-embeds content
 * with the new embedding model, and upserts back.
 *
 * Usage:
 *   npx ts-node src/scripts/reindex-embeddings.ts [--collection name] [--dry-run] [--skip-large]
 *
 * Strategy:
 * - Memory collections: re-embed content field, preserve all payload
 * - Code/codebase/docs: re-embed content field, preserve all payload
 * - Graph/symbols/sessions/tool_usage: skip (no semantic vectors or fixed format)
 * - longmemeval-bench: skip by default (--include-bench to include)
 */

import dotenv from 'dotenv';
dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'qwen3-embedding:4b';
const VECTOR_SIZE = parseInt(process.env.VECTOR_SIZE || '1024', 10);
const BM25_ENABLED = process.env.QDRANT_BM25_ENABLED === 'true';

const SKIP_PATTERNS = ['_graph', '_symbols', '_sessions', '_tool_usage', '_tribunals', '_llm_usage'];
const BATCH_SIZE = 32;

interface QdrantPoint {
  id: string;
  payload: Record<string, unknown>;
  vector?: number[] | Record<string, unknown>;
}

async function qdrantGet(path: string): Promise<any> {
  const res = await fetch(`${QDRANT_URL}${path}`);
  if (!res.ok) throw new Error(`Qdrant ${path}: ${res.status}`);
  return res.json();
}

async function qdrantPut(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant PUT ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function qdrantDelete(path: string): Promise<void> {
  const res = await fetch(`${QDRANT_URL}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Qdrant DELETE ${path}: ${res.status}`);
}

async function qdrantPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant POST ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama embed: ${res.status}`);
  const data = await res.json() as { embeddings: number[][] };
  return data.embeddings.map(e => e.slice(0, VECTOR_SIZE));
}

async function scrollAll(collection: string): Promise<QdrantPoint[]> {
  const points: QdrantPoint[] = [];
  let offset: string | null = null;

  while (true) {
    const body: any = { limit: 100, with_payload: true, with_vector: false };
    if (offset) body.offset = offset;

    const res = await qdrantPost(`/collections/${collection}/points/scroll`, body);
    const result = res.result;
    const batch = result.points || [];
    points.push(...batch);

    if (!result.next_page_offset) break;
    offset = result.next_page_offset;
  }

  return points;
}

async function createCollectionBM25(name: string): Promise<void> {
  const body: any = {
    vectors: BM25_ENABLED
      ? { dense: { size: VECTOR_SIZE, distance: 'Cosine' } }
      : { size: VECTOR_SIZE, distance: 'Cosine' },
  };

  if (BM25_ENABLED) {
    body.sparse_vectors = { bm25: { modifier: 'idf' } };
  }

  body.optimizers_config = { default_segment_number: 2 };

  await qdrantPut(`/collections/${name}`, body);
}

async function upsertPoints(
  collection: string,
  points: Array<{ id: string; vector: any; payload: Record<string, unknown> }>
): Promise<void> {
  const UPSERT_BATCH = 100;
  for (let i = 0; i < points.length; i += UPSERT_BATCH) {
    const batch = points.slice(i, i + UPSERT_BATCH);
    await qdrantPut(`/collections/${collection}/points`, {
      points: batch,
    });
  }
}

async function reindexCollection(collection: string, dryRun: boolean): Promise<{ points: number; duration: number }> {
  const startTime = Date.now();

  // 1. Scroll all points
  console.log(`  Scrolling ${collection}...`);
  const points = await scrollAll(collection);
  if (points.length === 0) {
    console.log(`  Empty collection, skipping`);
    return { points: 0, duration: 0 };
  }
  console.log(`  ${points.length} points loaded`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would re-embed ${points.length} points`);
    return { points: points.length, duration: Date.now() - startTime };
  }

  // 2. Extract content for re-embedding
  const contents = points.map(p => {
    const content = String(p.payload?.content || p.payload?.text || '');
    return content.slice(0, 8000); // Cap at 8K chars
  });

  // 3. Drop old collection
  console.log(`  Dropping old collection...`);
  await qdrantDelete(`/collections/${collection}`);

  // 4. Create new collection (with BM25 if enabled)
  console.log(`  Creating new collection${BM25_ENABLED ? ' (BM25)' : ''}...`);
  await createCollectionBM25(collection);

  // Wait for collection to be ready
  await new Promise(r => setTimeout(r, 1000));

  // 5. Re-embed and upsert in batches
  let processed = 0;
  const newPoints: Array<{ id: string; vector: any; payload: Record<string, unknown> }> = [];

  for (let i = 0; i < contents.length; i += BATCH_SIZE) {
    const batchTexts = contents.slice(i, i + BATCH_SIZE);
    const batchPoints = points.slice(i, i + BATCH_SIZE);

    // Skip empty content
    const validIndices = batchTexts.map((t, j) => t.length > 0 ? j : -1).filter(j => j >= 0);
    if (validIndices.length === 0) {
      processed += batchTexts.length;
      continue;
    }

    const textsToEmbed = validIndices.map(j => batchTexts[j]);

    try {
      const embeddings = await embedBatch(textsToEmbed);

      for (let k = 0; k < validIndices.length; k++) {
        const idx = validIndices[k];
        const point = batchPoints[idx];
        const embedding = embeddings[k];

        const newPoint: any = {
          id: point.id,
          payload: point.payload,
        };

        if (BM25_ENABLED) {
          newPoint.vector = {
            dense: embedding,
            bm25: { text: textsToEmbed[k], model: 'Qdrant/bm25' },
          };
        } else {
          newPoint.vector = embedding;
        }

        newPoints.push(newPoint);
      }

      // Also add points with empty content (no vector, payload only — skip these)
      // Points without content can't be re-embedded, they are lost

    } catch (err: any) {
      console.log(`  BATCH ERROR at ${i}: ${err.message?.slice(0, 80)}`);
      // Continue with next batch
    }

    processed += batchTexts.length;
    if (processed % 200 === 0 || processed >= contents.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = (contents.length - processed) / Math.max(rate, 0.1);
      console.log(`  ${processed}/${contents.length} (${rate.toFixed(0)}/s, ETA ${eta.toFixed(0)}s)`);
    }
  }

  // 6. Upsert all re-embedded points
  if (newPoints.length > 0) {
    console.log(`  Upserting ${newPoints.length} re-embedded points...`);
    await upsertPoints(collection, newPoints);
  }

  const duration = Date.now() - startTime;
  console.log(`  Done: ${newPoints.length}/${points.length} points, ${(duration / 1000).toFixed(0)}s`);
  return { points: newPoints.length, duration };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipLarge = args.includes('--skip-large');
  const includeBench = args.includes('--include-bench');
  const targetCollection = args.find(a => a.startsWith('--collection='))?.split('=')[1];

  console.log(`Re-Index Script`);
  console.log(`  Model: ${OLLAMA_MODEL}`);
  console.log(`  Vector size: ${VECTOR_SIZE}`);
  console.log(`  BM25: ${BM25_ENABLED}`);
  console.log(`  Dry run: ${dryRun}`);

  // List all collections
  const collectionsRes = await qdrantGet('/collections');
  const allCollections: string[] = collectionsRes.result.collections.map((c: any) => c.name);

  // Filter collections
  let collections = allCollections.filter(name => {
    // Skip utility collections
    if (SKIP_PATTERNS.some(p => name.endsWith(p) || name.startsWith('_'))) return false;
    // Skip benchmark unless --include-bench
    if (!includeBench && (name.includes('longmemeval') || name.includes('locomo'))) return false;
    // Skip large collections if --skip-large (>50K points)
    return true;
  });

  if (targetCollection) {
    collections = collections.filter(c => c === targetCollection);
  }

  // Sort: smaller collections first
  const collectionInfos = await Promise.all(
    collections.map(async name => {
      const info = await qdrantGet(`/collections/${name}`);
      return { name, points: info.result.points_count };
    })
  );
  collectionInfos.sort((a, b) => a.points - b.points);

  if (skipLarge) {
    const before = collectionInfos.length;
    const filtered = collectionInfos.filter(c => c.points <= 50000);
    console.log(`  Skipping ${before - filtered.length} large collections (>50K points)`);
    collectionInfos.splice(0, collectionInfos.length, ...filtered);
  }

  const totalPoints = collectionInfos.reduce((s, c) => s + c.points, 0);
  console.log(`\n  Collections to re-index: ${collectionInfos.length}`);
  console.log(`  Total points: ${totalPoints.toLocaleString()}`);
  console.log();

  let totalReindexed = 0;
  let totalDuration = 0;

  for (const { name, points } of collectionInfos) {
    console.log(`\n[${name}] (${points} points)`);
    try {
      const result = await reindexCollection(name, dryRun);
      totalReindexed += result.points;
      totalDuration += result.duration;
    } catch (err: any) {
      console.error(`  FAILED: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Re-index complete:`);
  console.log(`  Collections: ${collectionInfos.length}`);
  console.log(`  Points re-embedded: ${totalReindexed.toLocaleString()}`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(0)}s`);
}

main().catch(err => {
  console.error(`Re-index failed: ${err.message}`);
  process.exit(1);
});
