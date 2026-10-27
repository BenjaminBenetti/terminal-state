// Durable project snapshot (tar.gz) inside the shared reference task folder. Excludes the shared
// reference mount itself, node_modules, caches, env/credential files, local Claude settings and
// the 1 GB board snapshot (public/vision-board is reproducible from reference/ by Main).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
// --dir DIR: target folder (default: first slice task); --label NAME: archive prefix suffix;
// --no-qa: skip regenerable qa-artifacts (old QA renders) to keep iteration backups small.
const dir = path.resolve(opt('--dir') ?? path.join(root, 'reference/tasks/vertical-slice-20261025/backup'));
fs.mkdirSync(dir, {recursive: true});
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
const name = `the-last-line-${opt('--label') ?? 'vertical-slice'}-${stamp}.tar.gz`;
const tmp = path.join(dir, name + '.tmp');
const excludes = ['./reference', 'node_modules', './public/vision-board', './.claude/settings.local.json', './.pytest_cache', '.cache', '*.env', '.env.*', '*.pem', '*.key', 'credentials*.json', '_tmp*', 'core.[0-9]*', ...(args.includes('--no-qa') ? ['./qa-artifacts'] : [])];
execFileSync('tar', ['-czf', tmp, ...excludes.map(e => `--exclude=${e}`), '-C', root, '.'], {stdio: 'inherit'});
fs.renameSync(tmp, path.join(dir, name));
const buf = fs.readFileSync(path.join(dir, name));
const list = execFileSync('tar', ['-tzf', path.join(dir, name)], {maxBuffer: 1 << 28}).toString().trim().split('\n');
const leaked = list.filter(f => /(^|\/)(\.env|node_modules|settings\.local\.json)/.test(f) || f.startsWith('./reference/'));
const manifest = {
  schema: 'last-line-backup-v1', createdAt: new Date().toISOString(), archive: path.join(dir, name),
  bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), entries: list.length,
  excludes, leakedCheck: leaked,
  includes: 'project source (game/, tools/, scripts/), configs, package.json + package-lock.json, docs/, .claude/settings.json + skills, runtime asset derivatives, dist/game build, qa-artifacts, .git history',
  restore: `mkdir the-last-line && tar -xzf ${name} -C the-last-line && cd the-last-line && npm ci && npm run game:build`,
};
fs.writeFileSync(path.join(dir, name.replace('.tar.gz', '.manifest.json')), JSON.stringify(manifest, null, 2));
if (leaked.length) { console.error('Backup contains excluded paths:', leaked.slice(0, 10)); process.exit(3); }
console.log(JSON.stringify({archive: manifest.archive, bytes: manifest.bytes, sha256: manifest.sha256, entries: manifest.entries}, null, 2));
