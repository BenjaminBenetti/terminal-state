// Task mall-round3 CI follow-up (user choice B, 2026-11-01): the required `build` check runs the full Vitest suite as THREE parallel
// shards on the standard runner. Dependency-free, fail-closed proof that the shards together ran every test file exactly once:
//   node tools/release/test-shards.mjs verify <i> <n> <vitest-json-report>
//     (in shard job i) the report must be a complete, successful run: no failed file / test, at least one file; it publishes the
//     executed file list and counts as job outputs ($GITHUB_OUTPUT: files, tests, skipped, skippedFiles).
//   node tools/release/test-shards.mjs inventory <n>
//     (in `build`, after every shard succeeded) SHARD_<i>_FILES / _TESTS / _SKIPPED (the shard outputs) must partition the full test
//     inventory — every game/tests/**/*.test.ts file exactly once (the vitest config's include, checked here) — and the combined
//     summary is printed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GAME = path.join(ROOT, 'game');
/** The vitest config's include, which the inventory walk mirrors (asserted against game/vitest.config.ts). */
export const TEST_INCLUDE = "include: ['tests/**/*.test.ts']";

/** game/tests/**\/*.test.ts, relative to game/ (the vitest root), sorted. */
export function testInventory(gameDir = GAME) {
  const out = [];
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(gameDir, rel), {withFileTypes: true})) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(r); }
      else if (e.isFile() && e.name.endsWith('.test.ts')) out.push(r);
    }
  };
  walk('tests');
  return out.sort();
}

/**
 * A shard's Vitest JSON report -> its executed files (relative to the vitest root) and counts; `errors` lists everything that makes
 * the shard incomplete or failed (empty = good). Skipped files / tests are counted and allowed (the suite's env-gated previews).
 */
export function parseShardReport(report, vitestRoot = GAME) {
  const errors = [];
  if (!report || !Array.isArray(report.testResults)) return {errors: ['not a Vitest JSON report'], files: [], tests: 0, skipped: 0, skippedFiles: 0};
  if (report.success !== true) errors.push('report.success is not true');
  for (const k of ['numFailedTests', 'numFailedTestSuites']) if (report[k] !== 0) errors.push(`${k} = ${report[k]}`);
  if (!report.testResults.length) errors.push('no test file ran');
  const files = [];
  let skippedFiles = 0;
  for (const t of report.testResults) {
    const rel = path.relative(vitestRoot, t.name).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) errors.push(`file outside the vitest root: ${t.name}`);
    files.push(rel);
    if (t.status === 'failed') errors.push(`failed: ${rel}`);
    else if (t.status !== 'passed') skippedFiles++;
    for (const a of t.assertionResults ?? []) if (a.status === 'failed') errors.push(`failed test: ${rel} > ${a.fullName ?? a.title}`);
  }
  if (new Set(files).size !== files.length) errors.push('a file appears twice in the report');
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  return {errors, files: files.sort(), tests: report.numPassedTests ?? 0, skipped, skippedFiles};
}

/** Shard file lists vs the inventory: every inventory file in exactly one shard, nothing else, no empty shard. */
export function checkPartition(inventory, shards) {
  const errors = [], seen = new Map();
  shards.forEach((list, i) => {
    if (!list.length) errors.push(`shard ${i + 1} ran no file`);
    for (const f of list) {
      if (seen.has(f)) errors.push(`${f} ran in shards ${seen.get(f)} and ${i + 1}`);
      else seen.set(f, i + 1);
    }
  });
  const inv = new Set(inventory);
  for (const f of inventory) if (!seen.has(f)) errors.push(`missing from every shard: ${f}`);
  for (const f of seen.keys()) if (!inv.has(f)) errors.push(`not in the test inventory: ${f}`);
  return errors;
}

const fail = msgs => { for (const m of msgs) console.error(`::error::${m}`); process.exit(1); };
const int = (s, name) => { const v = Number(s); if (!Number.isInteger(v) || v < 0) fail([`${name} is not a count: ${JSON.stringify(s)}`]); return v; };

function main([cmd, ...args]) {
  if (cmd === 'verify') {
    const [i, n, file] = args;
    if (!(int(i, 'shard') >= 1 && int(i, 'shard') <= int(n, 'count')) || !file) fail(['usage: verify <i> <n> <report.json>']);
    const r = parseShardReport(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (r.errors.length) fail(r.errors.map(e => `shard ${i}/${n}: ${e}`));
    const out = {files: r.files.join(','), tests: r.tests, skipped: r.skipped, skippedFiles: r.skippedFiles};
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));
    console.log(`shard ${i}/${n}: ${r.files.length} files (${r.skippedFiles} skipped), ${r.tests} tests passed, ${r.skipped} skipped`);
    return;
  }
  if (cmd === 'inventory') {
    const n = int(args[0], 'count');
    const config = fs.readFileSync(path.join(GAME, 'vitest.config.ts'), 'utf8');
    if (!config.includes(TEST_INCLUDE)) fail([`game/vitest.config.ts no longer has ${TEST_INCLUDE}: update the inventory walk`]);
    const shards = [], tot = {tests: 0, skipped: 0, skippedFiles: 0};
    for (let i = 1; i <= n; i++) {
      const files = process.env[`SHARD_${i}_FILES`];
      if (!files) fail([`SHARD_${i}_FILES is empty (shard ${i} did not publish its files)`]);
      shards.push(files.split(','));
      tot.tests += int(process.env[`SHARD_${i}_TESTS`], `SHARD_${i}_TESTS`);
      tot.skipped += int(process.env[`SHARD_${i}_SKIPPED`], `SHARD_${i}_SKIPPED`);
      tot.skippedFiles += int(process.env[`SHARD_${i}_SKIPPED_FILES`], `SHARD_${i}_SKIPPED_FILES`);
    }
    const inventory = testInventory();
    const errors = checkPartition(inventory, shards);
    if (errors.length) fail(errors);
    console.log(`test inventory: ${inventory.length} files, each run exactly once across ${n} shards (${shards.map(s => s.length).join(' + ')}); `
      + `${inventory.length - tot.skippedFiles} files passed, ${tot.skippedFiles} skipped; ${tot.tests} tests passed, ${tot.skipped} skipped`);
    return;
  }
  fail(['usage: test-shards.mjs verify <i> <n> <report.json> | inventory <n>']);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
