// Packages dist/game into a clean static handoff directory with a SHA-256 manifest.
// Refuses to package if forbidden content slips in (sources, maps, env files, board/master GLBs).
// Usage: node tools/release/package-release.mjs [--out DIR] [--replace] [--task ID] [--drop-unreferenced-models]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = path.resolve(outArg >= 0 ? args[outArg + 1] : path.join(root, 'reference/tasks/vertical-slice-20261025/static-release-01'));
const dist = path.join(root, 'dist/game');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('dist/game missing; run npm run game:build');

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const walk = (dir, base = dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
  const f = path.join(dir, e.name);
  return e.isDirectory() ? walk(f, base) : [path.relative(base, f)];
});

// Hashes that must never ship: packaged board models and the preserved master.
const forbiddenHashes = new Map();
const map = JSON.parse(fs.readFileSync(path.join(root, 'public/vision-board/local-model-map.json')));
for (const m of map.models) forbiddenHashes.set(m.sha256, `board model ${m.id}`);
try {
  const master = JSON.parse(fs.readFileSync(path.join(root, 'reference/assets/masters/zombie-pixal3d.metadata.json')));
  forbiddenHashes.set(master.sha256, 'master zombie-pixal3d');
} catch { /* reference not mounted */ }

let files = walk(dist).sort();
// --drop-unreferenced-models: leave out assets/models/*.glb that no bundled script references
// (superseded derivatives Vite copies from public/, e.g. an older rifle/light that was replaced).
const excludedUnreferenced = [];
if (args.includes('--drop-unreferenced-models')) {
  const code = files.filter(f => /\.(js|html)$/.test(f)).map(f => fs.readFileSync(path.join(dist, f), 'utf8')).join('\n');
  files = files.filter(f => {
    if (!/^assets\/models\/[^/]+\.glb$/.test(f) || code.includes(f)) return true;
    excludedUnreferenced.push(f);
    return false;
  });
}
const problems = [];
const entries = files.map(rel => {
  const buf = fs.readFileSync(path.join(dist, rel));
  const h = sha(buf);
  if (forbiddenHashes.has(h)) problems.push(`${rel} is ${forbiddenHashes.get(h)}`);
  if (/(^|\/)(node_modules|\.git|src)(\/|$)/.test(rel)) problems.push(`${rel}: forbidden directory`);
  if (/\.(ts|map|env|pem|key|blend|fbx|zip)$/i.test(rel) || /(^|\/)\.env/.test(rel)) problems.push(`${rel}: forbidden file type`);
  if (buf.length > 25 * 1024 * 1024) problems.push(`${rel}: larger than 25 MB`);
  return {path: rel, bytes: buf.length, sha256: h};
});
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (/(src|href)="\/(?!\/)/.test(html)) problems.push('index.html uses root-absolute URLs (must be relative for app slugs)');
const remote = new Set();
for (const e of entries.filter(e => /\.(js|html|css)$/.test(e.path))) {
  const text = fs.readFileSync(path.join(dist, e.path), 'utf8');
  for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9.-]+[^\s"'`)]*/g)) remote.add(m[0].slice(0, 120));
}
if (problems.length) {
  console.error('Refusing to package:\n' + problems.join('\n'));
  process.exit(2);
}
if (fs.existsSync(out)) {
  if (!args.includes('--replace')) throw new Error(`${out} exists; pass --replace to rebuild this handoff directory`);
  fs.rmSync(out, {recursive: true});
}
for (const e of entries) {
  const dst = path.join(out, e.path);
  fs.mkdirSync(path.dirname(dst), {recursive: true});
  fs.copyFileSync(path.join(dist, e.path), dst);
  if (sha(fs.readFileSync(dst)) !== e.sha256) throw new Error(`copy mismatch ${e.path}`);
}
const manifest = {
  schema: 'last-line-static-release-v1',
  task: (args.indexOf('--task') >= 0 ? args[args.indexOf('--task') + 1] : 'studio-vertical-slice-20261025-01'),
  createdAt: new Date().toISOString(),
  directory: out,
  entry: 'index.html',
  base: './ (relative; works under any app slug)',
  fileCount: entries.length,
  totalBytes: entries.reduce((s, e) => s + e.bytes, 0),
  checks: {forbiddenHashesChecked: forbiddenHashes.size, problems: [], relativeUrls: true},
  excludedUnreferencedModels: excludedUnreferenced,
  // Literal URL strings inside bundled code (library docs/namespace strings); the game makes no
  // network requests except relative asset fetches from its own directory.
  urlStringsInBundle: [...remote].sort(),
  files: entries,
};
const manifestPath = out.replace(/\/?$/, '') + '.manifest.json';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Packaged ${entries.length} files, ${(manifest.totalBytes / 1e6).toFixed(2)} MB -> ${out}\nManifest: ${manifestPath}`);
