#!/usr/bin/env node
// Meshy T2.5 migration (lane CHARS): list superseded character runtime files for removal (contract section 8) in
// reference/tasks/meshy-game-replacement-20261029/lanes/removals.jsonl. Read-only git only: every listed path must be
// tracked in the pushed base commit a7a646a (git cat-file -e) and a remote branch must contain that commit; the live
// manifest must no longer reference it. The PRIMARY performs the git rm. Already-listed paths are not repeated.
//   node tools/asset-pipeline/zombie/t25-removals.mjs --tests=a.test.ts,b.test.ts [--dry]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {REPO} from './lib/master.mjs';
import {T25_BASE_COMMIT} from './lib/t25.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const LOG = path.join(REPO, 'reference/tasks/meshy-game-replacement-20261029/lanes/removals.jsonl');
const git = a => execFileSync('git', ['-C', REPO, ...a], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
const prov = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/meshy-t25-chars-20261029.json'), 'utf8'));
const manifest = fs.readFileSync(path.join(REPO, 'game/src/assets/manifest.ts'), 'utf8');
const listed = new Set(fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).path) : []);
const remotes = git(['branch', '-r', '--contains', T25_BASE_COMMIT]).split('\n').map(s => s.trim()).filter(Boolean);
if (!remotes.length) throw new Error('base commit not contained in any remote branch');
const tests = String(args.tests || '').split(',').filter(Boolean);
if (!tests.length) throw new Error('--tests=<files that passed> required');
const items = [
  ...prov.masters.filter(r => r.status === 'replaced' && r.restore).map(r => ({id: r.asset, path: r.restore.path, replacedBy: r.runtime.path, restore: r.restore})),
  ...prov.rebuiltWithoutSourceChange.filter(r => r.restore).map(r => ({id: r.asset, path: r.restore.path, replacedBy: r.runtime, restore: r.restore, note: 'rebuilt (source unchanged): per-body fits follow replaced bodies / wearables'})),
];
const out = [];
for (const it of items) {
  if (listed.has(it.path)) continue;
  git(['cat-file', '-e', `${T25_BASE_COMMIT}:${it.path}`]);
  const blob = git(['rev-parse', `${T25_BASE_COMMIT}:${it.path}`]).trim();
  if (blob !== it.restore.blob) throw new Error(`${it.path}: blob ${blob} != provenance ${it.restore.blob}`);
  const url = it.path.replace(/^game\/public\//, '');
  if (manifest.includes(`'${url}'`)) throw new Error(`${it.path} is still referenced by the live manifest`);
  if (!fs.existsSync(path.join(REPO, it.replacedBy))) throw new Error(`replacement missing: ${it.replacedBy}`);
  out.push({path: it.path, replacedBy: it.replacedBy, a7a646aBlob: blob, testsPassed: tests, lane: 'CHARS', id: it.id, trackedInPushedBase: true, remoteContainsBase: remotes, liveConsumersSwitched: true, ...(it.note ? {note: it.note} : {})});
}
if (!args.dry && out.length) fs.appendFileSync(LOG, out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log(`${args.dry ? '[dry] ' : ''}${out.length} removal(s)${out.length ? ':\n' + out.map(o => `  ${o.path} -> ${o.replacedBy}`).join('\n') : ''}`);
