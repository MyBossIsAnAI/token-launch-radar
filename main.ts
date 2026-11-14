// Token launch radar — entry point.
//
// Reads a frozen DefiLlama snapshot, scores every pre-token protocol with
// the radar-2 model, and writes a self-contained dashboard bundle:
// board.json, data.js, dashboard/, screenshots/ and dossier.json (last).
// Standard library only; runs under plain `node main.ts`.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, type Snapshot } from './lib/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIN_SCREENSHOTS = 3;
const DOSSIER_TEXT_BYTES = 65536;

/** Pull a --flag value out of argv, or fall back to the given default. */
function flagValue(argv: string[], flag: string, fallback: string | undefined): string | undefined {
  const i = argv.indexOf(flag);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}

/** Copy a directory tree, wiping the destination first. */
function copyTree(src: string, dst: string): void {
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

/** The checks the board gate demands, run before anything is written. */
function assertBoardGate(radar: ReturnType<typeof buildRadar>): void {
  const rows = radar.rows;
  if (rows.length !== 200) throw new Error(`board gate: ${rows.length} rows, the brief calls for 200`);
  if (rows.length < 100) throw new Error(`board gate: only ${rows.length} rows, need at least 100`);
  if (radar.watchlist_covered !== radar.watchlist_total) {
    throw new Error(`board gate: watchlist ${radar.watchlist_covered}/${radar.watchlist_total}`);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.rank !== i + 1) throw new Error(`board gate: rank ${row.rank} at position ${i + 1}`);
    if (i > 0 && row.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      throw new Error('board gate: rows are not sorted by implied value descending');
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      throw new Error(`board gate: row ${row.slug} has a bad implied value`);
    }
    if (row.farm_plan.length < 3 || row.farm_plan.length > 12) {
      throw new Error(`board gate: row ${row.slug} has ${row.farm_plan.length} farm steps`);
    }
    for (const step of row.farm_plan) {
      if (step.length < 20 || step.length > 600) {
        throw new Error(`board gate: row ${row.slug} has a farm step of ${step.length} chars`);
      }
    }
  }
  const distinct = new Set(rows.map((r) => r.implied_value_usd));
  if (distinct.size < 2) throw new Error('board gate: all rows carry the same implied value');
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputDir = resolve(flagValue(argv, '--input', undefined) ?? '');
  const outputDir = resolve(
    flagValue(argv, '--output', process.env.MAKEFUN_OUTPUT_DIR) ?? join(HERE, 'out'),
  );
  if (!inputDir) throw new Error('usage: node main.ts --input <snapshot dir> [--output <dir>]');

  const snapshot = JSON.parse(readFileSync(join(inputDir, 'snapshot.json'), 'utf8')) as Snapshot;
  const radar = buildRadar(snapshot);
  assertBoardGate(radar);

  // Screenshots are evidence the dashboard was actually rendered; refuse
  // to build a bundle without them.
  const shotsDir = join(HERE, 'screenshots');
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f) && statSync(join(shotsDir, f)).isFile())
    : [];
  if (shots.length < MIN_SCREENSHOTS) {
    throw new Error(`need at least ${MIN_SCREENSHOTS} screenshots in screenshots/, found ${shots.length}`);
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), JSON.stringify(radar, null, 2) + '\n', 'utf8');
  // data.js carries the same payload the dashboard reads at runtime.
  writeFileSync(
    join(outputDir, 'data.js'),
    `window.RADAR = ${JSON.stringify(radar)};\n`,
    'utf8',
  );
  copyTree(join(HERE, 'dashboard'), join(outputDir, 'dashboard'));
  copyTree(shotsDir, join(outputDir, 'screenshots'));

  // Dossier last, so it describes exactly what was just written.
  writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_BYTES }));

  console.log(
    `radar-2: ${radar.rows.length} rows, watchlist ${radar.watchlist_covered}/${radar.watchlist_total}, ` +
      `combined implied $${radar.combined_implied_usd.toLocaleString('en-US')}, ` +
      `top: ${radar.rows[0]!.name} ($${radar.rows[0]!.implied_value_usd.toLocaleString('en-US')})`,
  );
}

main();
