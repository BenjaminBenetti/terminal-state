// Task mall-round3 CI follow-up: unit tests for the fail-closed test-shard proof (tools/release/test-shards.mjs). Run by npm run ci:test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TEST_INCLUDE, checkPartition, parseShardReport, testInventory} from './test-shards.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./test-shards.mjs', import.meta.url));
const VROOT = '/w/game';
const file = (rel, status = 'passed', tests = ['passed']) => ({name: `${VROOT}/${rel}`, status, assertionResults: tests.map((s, i) => ({status: s, title: `t${i}`}))});
const report = (files, o = {}) => ({success: true, numFailedTests: 0, numFailedTestSuites: 0, numPassedTests: 5, numPendingTests: 1, numTodoTests: 0, testResults: files, ...o});

test('a complete, successful shard report gives its files and counts', () => {
  const r = parseShardReport(report([file('tests/b.test.ts'), file('tests/a.test.ts'), file('tests/p.test.ts', 'skipped', ['skipped'])]), VROOT);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.files, ['tests/a.test.ts', 'tests/b.test.ts', 'tests/p.test.ts']);
  assert.equal(r.tests, 5);
  assert.equal(r.skipped, 1);
  assert.equal(r.skippedFiles, 1);
});

test('any failure, an unsuccessful or empty run, or a foreign / duplicated file fails the shard', () => {
  assert.match(parseShardReport(report([file('tests/a.test.ts', 'failed', ['failed'])], {success: false, numFailedTests: 1, numFailedTestSuites: 1}), VROOT).errors.join('\n'), /failed: tests\/a\.test\.ts/);
  assert.match(parseShardReport(report([file('tests/a.test.ts', 'passed', ['passed', 'failed'])]), VROOT).errors.join('\n'), /failed test/);
  assert.match(parseShardReport(report([file('tests/a.test.ts')], {success: false}), VROOT).errors.join('\n'), /success/);
  assert.match(parseShardReport(report([]), VROOT).errors.join('\n'), /no test file ran/);
  assert.match(parseShardReport(report([{name: '/elsewhere/x.test.ts', status: 'passed', assertionResults: []}]), VROOT).errors.join('\n'), /outside the vitest root/);
  assert.match(parseShardReport(report([file('tests/a.test.ts'), file('tests/a.test.ts')]), VROOT).errors.join('\n'), /twice/);
  assert.deepEqual(parseShardReport(null).errors, ['not a Vitest JSON report']);
});

test('the shards must partition the inventory exactly', () => {
  const inv = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'];
  assert.deepEqual(checkPartition(inv, [['tests/a.test.ts'], ['tests/b.test.ts'], ['tests/c.test.ts']]), []);
  assert.match(checkPartition(inv, [['tests/a.test.ts'], ['tests/b.test.ts'], []]).join('\n'), /shard 3 ran no file[\s\S]*missing from every shard: tests\/c\.test\.ts/);
  assert.match(checkPartition(inv, [['tests/a.test.ts', 'tests/b.test.ts'], ['tests/b.test.ts'], ['tests/c.test.ts']]).join('\n'), /tests\/b\.test\.ts ran in shards 1 and 2/);
  assert.match(checkPartition(inv, [['tests/a.test.ts'], ['tests/b.test.ts'], ['tests/c.test.ts', 'tests/x.test.ts']]).join('\n'), /not in the test inventory: tests\/x\.test\.ts/);
});

test('the inventory walk matches the vitest include and finds the real suite', () => {
  assert(fs.readFileSync(path.join(ROOT, 'game/vitest.config.ts'), 'utf8').includes(TEST_INCLUDE));
  const inv = testInventory();
  assert(inv.length > 150, `only ${inv.length} test files`);
  assert(inv.every(f => f.startsWith('tests/') && f.endsWith('.test.ts')));
  assert.deepEqual(inv, [...inv].sort());
});

test('the CLI fails closed: a missing shard output or a gap stops `inventory`; `verify` publishes outputs', () => {
  const inv = testInventory(), third = Math.ceil(inv.length / 3);
  const env = (lists) => ({...process.env, ...Object.fromEntries(lists.flatMap((l, i) => [[`SHARD_${i + 1}_FILES`, l.join(',')], [`SHARD_${i + 1}_TESTS`, '1'], [`SHARD_${i + 1}_SKIPPED`, '0'], [`SHARD_${i + 1}_SKIPPED_FILES`, '0']]))});
  const parts = [inv.slice(0, third), inv.slice(third, 2 * third), inv.slice(2 * third)];
  assert.match(execFileSync(process.execPath, [SCRIPT, 'inventory', '3'], {env: env(parts), encoding: 'utf8'}), new RegExp(`${inv.length} files, each run exactly once`));
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'inventory', '3'], {env: env([parts[0], parts[1], parts[2].slice(1)]), stdio: 'pipe'}));
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'inventory', '3'], {env: {...env(parts), SHARD_2_FILES: ''}, stdio: 'pipe'}));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shards-')), rep = path.join(dir, 'r.json'), out = path.join(dir, 'out');
  fs.writeFileSync(rep, JSON.stringify(report([{name: path.join(ROOT, 'game', inv[0]), status: 'passed', assertionResults: [{status: 'passed'}]}])));
  execFileSync(process.execPath, [SCRIPT, 'verify', '1', '3', rep], {env: {...process.env, GITHUB_OUTPUT: out}, stdio: 'pipe'});
  assert.match(fs.readFileSync(out, 'utf8'), new RegExp(`^files=${inv[0]}\\ntests=5\\nskipped=1\\nskippedFiles=0\\n$`));
  fs.writeFileSync(rep, JSON.stringify(report([], {success: false})));
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'verify', '1', '3', rep], {stdio: 'pipe'}));
  fs.rmSync(dir, {recursive: true, force: true});
});
