import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {SEMVER, settings, successfulRun, prepare} from './release.mjs';

const sha = 'a'.repeat(40);
const env = {RELEASE_TAG: 'v1.2.3', DEPLOY_HOST: 'terminal-state.bbenetti.ca', PUBLIC_DOMAIN: 'terminal-state.bbenetti.ca',
  DEPLOY_USER: 'bbenetti', DEPLOY_PORT: '22', AUTO_CUTOFF_GB: '180'};
test('strict SemVer tags and required, non-injectable deployment settings', () => {
  for (const tag of ['v0.0.0', 'v1.2.3', 'v1.2.3-rc.1+build.4']) assert(SEMVER.test(tag), tag);
  for (const tag of ['1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-01', 'v1.2.3;id', 'v1.2.3\n', 'v1.2.3-a..b']) assert(!SEMVER.test(tag), tag);
  assert.equal(settings(env).cap_bytes, 180_000_000_000);
  for (const value of ['', '0', '-1', '1e3', 'Infinity', '1;id', '1.0001']) assert.throws(() => settings({...env, AUTO_CUTOFF_GB: value}));
  for (const [key, value] of [['DEPLOY_HOST', '-oProxyCommand=id'], ['PUBLIC_DOMAIN', 'a/b'], ['DEPLOY_USER', 'root;id'], ['DEPLOY_PORT', '0'], ['ACME_EMAIL', 'a\nb@example.com']]) assert.throws(() => settings({...env, [key]: value}));
});
test('only a completed, successful main workflow for exactly this commit is releasable', () => {
  const run = {databaseId: 123, headSha: sha, headBranch: 'main', status: 'completed', conclusion: 'success', event: 'push'};
  assert.equal(successfulRun([run], sha), run);
  for (const patch of [{headSha: 'b'.repeat(40)}, {headBranch: 'other'}, {status: 'in_progress'}, {conclusion: 'failure'}, {event: 'pull_request'}]) {
    assert.equal(successfulRun([{...run, ...patch}], sha), undefined);
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-state-release-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const artifact = path.join(root, 'artifact'), site = path.join(artifact, 'site');
  fs.mkdirSync(path.join(site, 'assets'), {recursive: true});
  const files = {'index.html': '<!doctype html>' + '<p>game</p>'.repeat(100), 'assets/model.glb': 'geometry'.repeat(1000),
    'assets/index-abc123.js': 'console.log("game");'.repeat(100)};
  const entries = Object.entries(files).map(([rel, raw]) => {
    fs.writeFileSync(path.join(site, rel), raw);
    return {path: rel, bytes: Buffer.byteLength(raw), sha256: crypto.createHash('sha256').update(raw).digest('hex')};
  });
  fs.writeFileSync(path.join(artifact, 'manifest.json'), JSON.stringify({schema: 'terminal-state-static-ci-v1', commit: sha,
    entry: 'index.html', base: './', files: entries, fileCount: entries.length, totalBytes: entries.reduce((s, e) => s + e.bytes, 0)}));
  return {artifact, out: path.join(root, 'out'), commit: sha, config: settings(env), quality: 4};
}
test('compression preserves all source bytes; VM re-verifies compressed representations', t => {
  const args = fixture(t), result = prepare(args);
  assert(result.files.length > 3);
  const raw = fs.readFileSync(path.join(args.artifact, 'site/assets/model.glb'));
  assert.deepEqual(zlib.brotliDecompressSync(fs.readFileSync(path.join(args.out, 'site/assets/model.glb.br'))), raw);
  assert.deepEqual(zlib.gunzipSync(fs.readFileSync(path.join(args.out, 'site/assets/model.glb.gz'))), raw);
  execFileSync('python3', ['tools/deploy/gcp/verify.py', args.out]);
  const compressed = path.join(args.out, 'site/assets/model.glb.br');
  const damaged = fs.readFileSync(compressed); damaged[0] ^= 1; fs.writeFileSync(compressed, damaged);
  assert.throws(() => execFileSync('python3', ['tools/deploy/gcp/verify.py', args.out], {stdio: 'pipe'}));
});
for (const kind of ['hash mismatch', 'extra file', 'symlink', 'wrong commit']) test(`refuse artifact: ${kind}`, t => {
  const args = fixture(t), index = path.join(args.artifact, 'site/index.html');
  if (kind === 'hash mismatch') { const raw = fs.readFileSync(index); raw[0] ^= 1; fs.writeFileSync(index, raw); }
  if (kind === 'extra file') fs.writeFileSync(path.join(args.artifact, 'site/extra.txt'), 'extra');
  if (kind === 'symlink') { fs.unlinkSync(index); fs.symlinkSync('/etc/passwd', index); }
  if (kind === 'wrong commit') args.commit = 'b'.repeat(40);
  assert.throws(() => prepare(args));
  assert(!fs.existsSync(args.out));
});
