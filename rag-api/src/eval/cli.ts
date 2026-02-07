/**
 * Eval CLI - Entry point for running evaluations and comparing reports.
 *
 * Usage:
 *   npx ts-node src/eval/cli.ts run [--project NAME] [--hybrid] [--api-url URL]
 *   npx ts-node src/eval/cli.ts compare <before.json> <after.json>
 */

import { runEval } from './runner';
import { compareReports } from './compare';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
RAG Eval CLI

Usage:
  npx ts-node src/eval/cli.ts run [options]     Run eval against golden queries
  npx ts-node src/eval/cli.ts compare <a> <b>   Compare two eval reports

Run options:
  --project NAME     Project name (default: from golden-queries.json)
  --hybrid           Use hybrid search instead of semantic
  --api-url URL      RAG API base URL (default: http://localhost:3100)
  --golden PATH      Path to golden queries JSON file
    `);
    process.exit(0);
  }

  if (command === 'run') {
    const project = getFlag(args, '--project');
    const hybrid = args.includes('--hybrid');
    const apiUrl = getFlag(args, '--api-url');
    const goldenPath = getFlag(args, '--golden');

    await runEval({ project, hybrid, apiUrl, goldenPath });
  } else if (command === 'compare') {
    const beforePath = args[1];
    const afterPath = args[2];

    if (!beforePath || !afterPath) {
      console.error('Usage: compare <before.json> <after.json>');
      process.exit(1);
    }

    compareReports(beforePath, afterPath);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

main().catch(err => {
  console.error('Eval failed:', err.message);
  process.exit(1);
});
