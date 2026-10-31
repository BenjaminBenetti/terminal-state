// Task track3-eaton-centre-20261031 (lane PACKAGE): read and verify an OFFICIAL CI site artifact (`site/` + `manifest.json`
// written by tools/release/package-ci.mjs, schema terminal-state-static-ci-v1). Zero dependencies (Node 22 built-ins only).
// Used by:
//  - server.mjs at startup (cheap: manifest shape, exact file set, sizes, no symlinks; sha256 only when asked);
//  - the image build (Dockerfile RUN `verify --hashes`: every sha256, the expected commit, the staged wrapper files);
//  - stage.mjs (Main's staging step before `docker build`).
// It never repairs or rewrites anything: a mismatch is an error, never a reason to serve a different set of files.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const MANIFEST_SCHEMA = 'terminal-state-static-ci-v1';
export const WRAPPER_SCHEMA = 'terminal-state-dynamic-app-wrapper-v1';
/** Wrapper source files staged next to the site (stage.mjs copies exactly these; the image records their sha256). */
export const WRAPPER_FILES = ['Dockerfile', 'server.mjs', 'site-manifest.mjs'];
export const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const fail = m => { throw new Error(m); };

/** Same path rule as the CI packager (tools/release/package-ci.mjs safePath): plain relative segments, no dot files / secrets. */
export function safeSitePath(p) {
  return typeof p === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)
    && !p.split('/').some(s => s.startsWith('.') || /(?:secret|credential|password|token)/i.test(s));
}

/** Streaming sha256 of a file (bounded memory for large files). */
export function sha256File(file) {
  const h = crypto.createHash('sha256'), buf = Buffer.allocUnsafe(1 << 20), fd = fs.openSync(file, 'r');
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/**
 * Parses + validates a CI manifest. Returns {commit, fileCount, totalBytes, files: Map<path, {bytes, sha256}>, sha256}.
 * Rejects an unknown schema, a non-40-hex commit, a missing index.html entry, duplicate / unsafe paths, bad sizes / hashes
 * and counts or totals that disagree with the file list.
 */
export function readManifest(manifestPath) {
  const st = fs.lstatSync(manifestPath);
  if (!st.isFile() || st.isSymbolicLink()) fail(`Manifest is not a regular file: ${manifestPath}`);
  const text = fs.readFileSync(manifestPath);
  let m;
  try { m = JSON.parse(text.toString('utf8')); } catch { fail('Manifest is not valid JSON'); }
  if (m?.schema !== MANIFEST_SCHEMA) fail(`Unknown manifest schema: ${m?.schema}`);
  if (!COMMIT.test(m.commit ?? '')) fail('Manifest commit must be a full 40-hex SHA');
  if (m.entry !== 'index.html' || m.base !== './') fail('Manifest entry/base must be index.html / ./');
  if (!Array.isArray(m.files)) fail('Manifest has no file list');
  const files = new Map();
  let total = 0;
  for (const e of m.files) {
    if (!safeSitePath(e?.path) || files.has(e.path) || !Number.isSafeInteger(e.bytes) || e.bytes < 0 || !SHA256.test(e.sha256 ?? ''))
      fail(`Invalid manifest entry: ${JSON.stringify(e?.path)}`);
    files.set(e.path, {bytes: e.bytes, sha256: e.sha256});
    total += e.bytes;
  }
  if (!files.has('index.html')) fail('Manifest lists no index.html');
  if (m.fileCount !== files.size) fail(`Manifest fileCount ${m.fileCount} != ${files.size} listed files`);
  if (m.totalBytes !== total) fail(`Manifest totalBytes ${m.totalBytes} != ${total} (sum of listed files)`);
  return {commit: m.commit, fileCount: files.size, totalBytes: total, files, sha256: crypto.createHash('sha256').update(text).digest('hex')};
}

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, name), st = fs.lstatSync(f), rel = path.relative(base, f).split(path.sep).join('/');
    if (st.isSymbolicLink()) fail(`Symlink in site: ${rel}`);
    if (st.isDirectory()) walk(f, base, out);
    else if (st.isFile()) out.push(rel);
    else fail(`Not a regular file in site: ${rel}`);
  }
  return out;
}

/**
 * Verifies that `siteDir` holds EXACTLY the manifest's files (no extra, missing, symlinked or resized file). `hashes` also
 * checks every sha256; `expectedCommit` must equal the manifest commit. Returns {commit, files, bytes, hashed}.
 */
export function verifySite(siteDir, manifest, {hashes = false, expectedCommit = null} = {}) {
  const st = fs.lstatSync(siteDir);
  if (!st.isDirectory() || st.isSymbolicLink()) fail(`Site is not a real directory: ${siteDir}`);
  if (expectedCommit !== null && expectedCommit !== manifest.commit) fail(`Artifact commit ${manifest.commit} != expected ${expectedCommit}`);
  const present = walk(siteDir, siteDir, []);
  const extra = present.filter(p => !manifest.files.has(p));
  if (extra.length) fail(`Files not in the manifest: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ' …' : ''}`);
  const have = new Set(present);
  for (const [rel, e] of manifest.files) {
    if (!have.has(rel)) fail(`Missing site file: ${rel}`);
    const file = path.join(siteDir, ...rel.split('/'));
    if (fs.statSync(file).size !== e.bytes) fail(`Size mismatch: ${rel}`);
    if (hashes && sha256File(file) !== e.sha256) fail(`sha256 mismatch: ${rel}`);
  }
  return {commit: manifest.commit, files: manifest.fileCount, bytes: manifest.totalBytes, hashed: hashes};
}

/** The staged wrapper record (stage.mjs): same commit as the artifact, and the wrapper files exactly as recorded. */
export function verifyWrapper(recordPath, appDir, expectedCommit) {
  const w = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (w?.schema !== WRAPPER_SCHEMA) fail(`Unknown wrapper record schema: ${w?.schema}`);
  if (w.commit !== expectedCommit) fail(`Wrapper source commit ${w.commit} != artifact commit ${expectedCommit}`);
  const listed = (w.files ?? []).map(f => f.path).sort();
  if (JSON.stringify(listed) !== JSON.stringify([...WRAPPER_FILES].sort())) fail('Wrapper record must list exactly the wrapper files');
  for (const f of w.files) if (sha256File(path.join(appDir, f.path)) !== f.sha256) fail(`Wrapper file changed after staging: ${f.path}`);
  return w;
}

function args(argv) {
  const o = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hashes') o.hashes = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
    else o._.push(a);
  }
  return o;
}

// CLI (the image build): node site-manifest.mjs verify --site DIR --manifest FILE --commit SHA [--hashes] [--wrapper FILE]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  try {
    if (o._[0] !== 'verify' || !o.site || !o.manifest || !COMMIT.test(o.commit ?? '')) fail('usage: verify --site DIR --manifest FILE --commit <40-hex> [--hashes] [--wrapper FILE]');
    const m = readManifest(o.manifest);
    const r = verifySite(o.site, m, {hashes: !!o.hashes, expectedCommit: o.commit});
    if (o.wrapper) verifyWrapper(o.wrapper, path.dirname(path.resolve(o.wrapper)), o.commit);
    console.log(`Verified official site ${r.commit}: ${r.files} files / ${r.bytes} bytes${r.hashed ? ', every sha256' : ''}${o.wrapper ? ', wrapper files' : ''}.`);
  } catch (err) {
    console.error(`Site verification FAILED: ${err.message}`);
    process.exit(1);
  }
}
