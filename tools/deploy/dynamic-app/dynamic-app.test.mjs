// Task track3-eaton-centre-20261031 (lane PACKAGE): tests of the dynamic-app wrapper (server, site verification, staging,
// Dockerfile contract). node --test; no Docker, no network beyond 127.0.0.1, no git history needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSiteServer, resolveConfig, normalizeBasePath, mimeOf} from './server.mjs';
import {readManifest, verifySite, verifyWrapper, WRAPPER_FILES} from './site-manifest.mjs';
import {stage, gitSourceCheck} from './stage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const BUNDLE = `console.log("terminal state");${'/* padding */'.repeat(60)}`;
const FILES = {
  'index.html': '<!doctype html><script type="module" src="./assets/index-Ab12_c.js"></script><link rel="stylesheet" href="./assets/index-Ab12_c.css">',
  'assets/index-Ab12_c.js': BUNDLE,
  'assets/index-Ab12_c.css': 'body{color:red}',
  'assets/models/mall-fountain.glb': 'glTF-binary-bytes',
  'assets/audio/step.mp3': 'ID3-mp3-bytes',
  'assets/textures/mall/terrazzo.jpg': 'jpeg-bytes',
  'assets/textures/office/carpet.png': 'png-bytes',
  'assets/derivatives/mall.json': JSON.stringify({provenance: 'x'.repeat(400)}),
  'assets/CREDITS.md': '# Credits',
  'assets/decoder.wasm': '\0asm-bytes',
};

function fixture(t, files = FILES, commit = COMMIT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-state-dynamic-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const art = path.join(root, 'artifact'), site = path.join(art, 'site');
  for (const [rel, body] of Object.entries(files)) { const p = path.join(site, rel); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, body); }
  const entries = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([rel, b]) => ({path: rel, bytes: Buffer.byteLength(b), sha256: sha(Buffer.from(b))}));
  const manifest = {schema: 'terminal-state-static-ci-v1', commit, entry: 'index.html', base: './', fileCount: entries.length,
    totalBytes: entries.reduce((s, e) => s + e.bytes, 0), checks: {maxTotalBytes: null}, files: entries};
  fs.writeFileSync(path.join(art, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {root, art, site, manifestPath: path.join(art, 'manifest.json'), manifest};
}

const cfgFor = (f, env = {}) => resolveConfig({PORT: '0', HOST: '127.0.0.1', SITE_DIR: f.site, MANIFEST: f.manifestPath, ...env});

async function started(t, f, env = {}) {
  const app = createSiteServer(cfgFor(f, env), {log: () => {}});
  const {port} = await app.listen();
  t.after(() => app.close(100));
  return {app, port};
}

/** Raw request (the path is sent exactly as given: no client-side normalisation of `..` or encodings). */
function req(port, rawPath, {method = 'GET', headers = {}} = {}) {
  return new Promise((ok, no) => {
    const r = http.request({host: '127.0.0.1', port, path: rawPath, method, headers, agent: false}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => ok({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    r.on('error', no);
    r.end();
  });
}

test('config: PORT / BASE_PATH / commit / frame-ancestors validation and defaults', () => {
  const d = resolveConfig({});
  assert.equal(d.port, 8080); assert.equal(d.host, '0.0.0.0'); assert.equal(d.basePath, ''); assert.equal(d.verifyHashes, false);
  assert.match(d.csp, /frame-ancestors 'self'/); assert.match(d.csp, /script-src 'self';/); assert.match(d.csp, /object-src 'none'/);
  assert.equal(resolveConfig({PORT: '1234'}).port, 1234);
  for (const p of ['abc', '70000', '-1', '', '80.5']) assert.throws(() => resolveConfig({PORT: p}), /PORT/);
  assert.equal(normalizeBasePath('/'), ''); assert.equal(normalizeBasePath('/play/'), '/play'); assert.equal(normalizeBasePath('games/terminal-state'), '/games/terminal-state');
  for (const b of ['/../x', '/a//b', '/a/./b', '/a b', '/%2e%2e', '/.hidden']) assert.throws(() => normalizeBasePath(b), /BASE_PATH/);
  assert.throws(() => resolveConfig({EXPECTED_COMMIT: 'main'}), /40-hex/);
  assert.throws(() => resolveConfig({FRAME_ANCESTORS: "'self'; script-src *"}), /FRAME_ANCESTORS/);
  assert.match(resolveConfig({FRAME_ANCESTORS: 'https://host.example'}).csp, /frame-ancestors https:\/\/host\.example$/);
});

test('MIME types incl. glb / mp3 / wasm', () => {
  const want = {'a.html': 'text/html; charset=utf-8', 'a.js': 'text/javascript; charset=utf-8', 'a.css': 'text/css; charset=utf-8',
    'a.json': 'application/json; charset=utf-8', 'a.glb': 'model/gltf-binary', 'a.mp3': 'audio/mpeg', 'a.wasm': 'application/wasm',
    'a.png': 'image/png', 'a.jpg': 'image/jpeg', 'a.md': 'text/markdown; charset=utf-8', 'a.unknown': 'application/octet-stream', 'noext': 'application/octet-stream'};
  for (const [f, m] of Object.entries(want)) assert.equal(mimeOf(f), m, f);
});

test('serves the site at the root: index, MIME, cache headers, ETag / 304, HEAD, gzip', async t => {
  const f = fixture(t), {port} = await started(t, f);
  const idx = await req(port, '/');
  assert.equal(idx.status, 200); assert.equal(idx.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(idx.headers['cache-control'], 'no-cache'); assert.equal(idx.body.toString(), FILES['index.html']);
  assert.equal((await req(port, '/index.html')).body.toString(), FILES['index.html']);
  const js = await req(port, '/assets/index-Ab12_c.js');
  assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable'); assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.headers.vary, 'Accept-Encoding'); assert.equal(js.body.toString(), BUNDLE);
  for (const [rel, type] of [['assets/models/mall-fountain.glb', 'model/gltf-binary'], ['assets/audio/step.mp3', 'audio/mpeg'], ['assets/decoder.wasm', 'application/wasm'],
    ['assets/textures/mall/terrazzo.jpg', 'image/jpeg'], ['assets/textures/office/carpet.png', 'image/png'], ['assets/index-Ab12_c.css', 'text/css; charset=utf-8'],
    ['assets/derivatives/mall.json', 'application/json; charset=utf-8'], ['assets/CREDITS.md', 'text/markdown; charset=utf-8']]) {
    const r = await req(port, `/${rel}`);
    assert.equal(r.status, 200, rel); assert.equal(r.headers['content-type'], type, rel); assert.equal(r.body.toString(), FILES[rel], rel);
    assert.equal(r.headers.etag, `"${sha(Buffer.from(FILES[rel]))}"`, rel);
    if (!rel.startsWith('assets/index-')) assert.equal(r.headers['cache-control'], 'public, no-cache', rel);
  }
  const glb = await req(port, '/assets/models/mall-fountain.glb');
  assert.equal((await req(port, '/assets/models/mall-fountain.glb', {headers: {'If-None-Match': glb.headers.etag}})).status, 304);
  assert.equal((await req(port, '/assets/models/mall-fountain.glb', {headers: {'If-None-Match': `W/${glb.headers.etag}`}})).status, 304);
  assert.equal((await req(port, '/assets/models/mall-fountain.glb', {headers: {'If-None-Match': '"other"'}})).status, 200);
  const head = await req(port, '/assets/models/mall-fountain.glb', {method: 'HEAD'});
  assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), Buffer.byteLength(FILES['assets/models/mall-fountain.glb']));
  const gz = await req(port, '/assets/index-Ab12_c.js', {headers: {'Accept-Encoding': 'gzip, br'}});
  assert.equal(gz.headers['content-encoding'], 'gzip'); assert.equal(zlib.gunzipSync(gz.body).toString(), BUNDLE);
  assert.equal(gz.headers.etag, `"${sha(Buffer.from(BUNDLE))}.gz"`);
  assert.equal((await req(port, '/assets/index-Ab12_c.js', {headers: {'Accept-Encoding': 'gzip;q=0'}})).headers['content-encoding'], undefined);
  assert.equal((await req(port, '/assets/models/mall-fountain.glb', {headers: {'Accept-Encoding': 'gzip'}})).headers['content-encoding'], undefined);
});

test('BASE_PATH routing: prefix-only serving, trailing-slash redirect with query, health on both paths', async t => {
  const f = fixture(t), {port} = await started(t, f, {BASE_PATH: '/play/'});
  const r1 = await req(port, '/play');
  assert.equal(r1.status, 308); assert.equal(r1.headers.location, '/play/');
  assert.equal((await req(port, '/play?level=mall&warmup=off')).headers.location, '/play/?level=mall&warmup=off');
  assert.equal((await req(port, '/')).headers.location, '/play/');
  const idx = await req(port, '/play/?level=mall');
  assert.equal(idx.status, 200); assert.equal(idx.body.toString(), FILES['index.html']);
  assert.equal((await req(port, '/play/assets/models/mall-fountain.glb')).status, 200);
  for (const p of ['/assets/models/mall-fountain.glb', '/playground/', '/playassets/index-Ab12_c.js', '/index.html']) assert.equal((await req(port, p)).status, 404, p);
  for (const p of ['/healthz', '/play/healthz']) {
    const h = await req(port, p);
    assert.equal(h.status, 200, p); assert.equal(h.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(h.body), {status: 'ok', commit: COMMIT, files: f.manifest.fileCount, bytes: f.manifest.totalBytes});
  }
});

test('path traversal, encodings, dot files, directories and unknown files never leak anything', async t => {
  const f = fixture(t), {port} = await started(t, f);
  fs.writeFileSync(path.join(f.art, 'secret.txt'), 'TOP-SECRET'); // a file next to the site, outside the manifest
  const bad = ['/../manifest.json', '/..%2fmanifest.json', '/%2e%2e/manifest.json', '/%2E%2E/%2E%2E/etc/passwd', '/assets/..%2f..%2fsecret.txt',
    '/assets%2fmodels%2fmall-fountain.glb', '/assets%5cmodels%5cmall-fountain.glb', '/assets\\models\\mall-fountain.glb', '/%00', '/index.html%00.js',
    '//etc/passwd', '/.env', '/manifest.json', '/secret.txt', '/site/index.html', '/assets/', '/assets', '/assets/models/', '/assets/models/./mall-fountain.glb',
    '/assets/models/../models/mall-fountain.glb', '/assets/models/missing.glb', '/%E0%A4%A', '/healthz/../index.html'];
  for (const p of bad) {
    const r = await req(port, p);
    assert(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
    assert(!/TOP-SECRET|terminal-state-static-ci|glTF-binary|<script/.test(r.body.toString()), `${p} leaked content`);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
  }
  assert.equal((await req(port, 'http://evil.example/index.html')).status, 400);
});

test('security headers on every response; only GET / HEAD', async t => {
  const f = fixture(t), {port} = await started(t, f);
  for (const r of [await req(port, '/'), await req(port, '/missing'), await req(port, '/healthz'), await req(port, '/', {method: 'POST'})]) {
    assert.match(r.headers['content-security-policy'], /default-src 'self'.*frame-ancestors 'self'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN'); assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin'); assert.match(r.headers['permissions-policy'], /camera=\(\)/);
    assert.equal(r.headers['x-powered-by'], undefined);
  }
  for (const m of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    const r = await req(port, '/index.html', {method: m});
    assert.equal(r.status, 405, m); assert.equal(r.headers.allow, 'GET, HEAD');
  }
  const nf = await req(port, '/nope');
  assert.equal(nf.status, 404); assert.equal(nf.headers['cache-control'], 'no-store'); assert.equal(nf.body.toString(), 'Not Found\n');
});

test('startup refuses a site that is not exactly its manifest', t => {
  const mk = () => fixture(t);
  const boot = (f, env) => createSiteServer(cfgFor(f, env), {log: () => {}});
  let f = mk(); fs.unlinkSync(path.join(f.site, 'assets/audio/step.mp3')); assert.throws(() => boot(f), /Missing site file/);
  f = mk(); fs.writeFileSync(path.join(f.site, 'assets/extra.js'), 'x'); assert.throws(() => boot(f), /not in the manifest/);
  f = mk(); fs.appendFileSync(path.join(f.site, 'assets/audio/step.mp3'), 'x'); assert.throws(() => boot(f), /Size mismatch/);
  f = mk(); fs.symlinkSync('/etc/hostname', path.join(f.site, 'assets/link.glb')); assert.throws(() => boot(f), /Symlink/);
  f = mk(); fs.writeFileSync(path.join(f.site, 'assets/audio/step.mp3'), 'ID3-mp3-BYTES'); // same size, different bytes
  assert.doesNotThrow(() => boot(f)); assert.throws(() => boot(f, {VERIFY_HASHES_ON_START: '1'}), /sha256 mismatch/);
  f = mk(); assert.throws(() => boot(f, {EXPECTED_COMMIT: 'f'.repeat(40)}), /expected/);
  assert.doesNotThrow(() => boot(f, {EXPECTED_COMMIT: COMMIT}));
  for (const edit of [m => { m.schema = 'other'; }, m => { m.commit = 'main'; }, m => { m.fileCount++; }, m => { m.totalBytes++; },
    m => { m.files.push({...m.files[0]}); m.fileCount++; m.totalBytes += m.files[0].bytes; }, m => { m.files[0].path = '../x'; },
    m => { m.files = m.files.filter(e => e.path !== 'index.html'); m.fileCount = m.files.length; m.totalBytes = m.files.reduce((s, e) => s + e.bytes, 0); }]) {
    f = mk(); const m = JSON.parse(fs.readFileSync(f.manifestPath, 'utf8')); edit(m); fs.writeFileSync(f.manifestPath, JSON.stringify(m));
    assert.throws(() => boot(f));
  }
  f = fixture(t, {...FILES, healthz: 'x'}); assert.throws(() => boot(f), /reserved/);
});

test('process: PORT env listener, health, graceful SIGTERM exit 0; invalid env exits 1', async t => {
  const f = fixture(t);
  const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {env: {PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', BASE_PATH: '/play', SITE_DIR: f.site, MANIFEST: f.manifestPath, EXPECTED_COMMIT: COMMIT}, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => child.kill('SIGKILL'));
  let out = '';
  const listening = await new Promise((ok, no) => {
    child.stdout.on('data', d => { out += d; const line = out.split('\n').find(l => l.includes('"listening"')); if (line) ok(JSON.parse(line)); });
    child.on('exit', c => no(new Error(`server exited ${c}: ${out}`)));
  });
  assert.equal(listening.commit, COMMIT); assert.equal(listening.basePath, '/play'); assert(listening.port > 0);
  assert.equal((await req(listening.port, '/play/healthz')).status, 200);
  assert.equal((await req(listening.port, '/play/assets/index-Ab12_c.js')).body.toString(), BUNDLE);
  const exit = new Promise(ok => child.on('exit', (code, signal) => ok({code, signal})));
  child.kill('SIGTERM');
  assert.deepEqual(await exit, {code: 0, signal: null});
  assert.match(out, /"shutdown".*"SIGTERM"/); assert.match(out, /"stopped"/);
  const bad = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {env: {PATH: process.env.PATH, PORT: 'nope', SITE_DIR: f.site, MANIFEST: f.manifestPath}, stdio: ['ignore', 'pipe', 'pipe']});
  let badOut = ''; bad.stdout.on('data', d => { badOut += d; });
  assert.equal(await new Promise(ok => bad.on('exit', ok)), 1); assert.match(badOut, /"fatal".*PORT/);
});

test('stage: exact official artifact + same-commit wrapper -> build context; refusals', t => {
  const f = fixture(t), ok = () => {};
  const out = path.join(f.root, 'context');
  const r = stage({commit: COMMIT, artifact: f.art, out, sourceCheck: ok});
  assert.equal(r.files, f.manifest.fileCount); assert.equal(r.bytes, f.manifest.totalBytes);
  assert.deepEqual(fs.readdirSync(out).sort(), [...WRAPPER_FILES, 'manifest.json', 'site', 'wrapper-source.json'].sort());
  // readable by the image's non-root user whatever the umask: files 0644, directories 0755
  const modes = dir => fs.readdirSync(dir).flatMap(n => { const p = path.join(dir, n), st = fs.statSync(p); return st.isDirectory() ? [[p, st.mode & 0o777, 0o755], ...modes(p)] : [[p, st.mode & 0o777, 0o644]]; });
  for (const [p, mode, want] of modes(out)) assert.equal(mode, want, `${p} mode ${mode.toString(8)}`);
  for (const w of WRAPPER_FILES) assert(fs.readFileSync(path.join(out, w)).equals(fs.readFileSync(path.join(HERE, w))), w);
  assert.equal(verifyWrapper(path.join(out, 'wrapper-source.json'), out, COMMIT).commit, COMMIT);
  verifySite(path.join(out, 'site'), readManifest(path.join(out, 'manifest.json')), {hashes: true, expectedCommit: COMMIT});
  // the image build's verification command, exactly as the Dockerfile runs it (paths of the staged context)
  execFileSync(process.execPath, [path.join(out, 'site-manifest.mjs'), 'verify', '--site', path.join(out, 'site'), '--manifest', path.join(out, 'manifest.json'),
    '--commit', COMMIT, '--hashes', '--wrapper', path.join(out, 'wrapper-source.json')], {stdio: 'pipe'});
  assert.throws(() => verifyWrapper(path.join(out, 'wrapper-source.json'), out, 'f'.repeat(40)), /commit/);
  fs.appendFileSync(path.join(out, 'server.mjs'), '\n// changed');
  assert.throws(() => verifyWrapper(path.join(out, 'wrapper-source.json'), out, COMMIT), /changed after staging/);
  assert.throws(() => stage({commit: COMMIT, artifact: f.art, out, sourceCheck: ok}), /already exists/);
  const o2 = () => path.join(f.root, `ctx-${crypto.randomUUID()}`);
  assert.throws(() => stage({commit: 'f'.repeat(40), artifact: f.art, out: o2(), sourceCheck: ok}), /expected/);
  assert.throws(() => stage({commit: 'main', artifact: f.art, out: o2(), sourceCheck: ok}), /40-hex/);
  assert.throws(() => stage({commit: COMMIT, artifact: f.art, out: o2(), sourceCheck: () => { throw new Error('Wrapper checkout is at x'); }}), /checkout/);
  const sep = path.join(f.root, 'sep-manifest.json'); fs.writeFileSync(sep, '{}');
  assert.throws(() => stage({commit: COMMIT, artifact: f.art, manifestArtifact: sep, out: o2(), sourceCheck: ok}), /differs/);
  fs.copyFileSync(f.manifestPath, sep);
  assert.doesNotThrow(() => stage({commit: COMMIT, artifact: f.art, manifestArtifact: sep, out: o2(), sourceCheck: ok}));
  fs.writeFileSync(path.join(f.site, 'assets/audio/step.mp3'), 'ID3-mp3-BYTES'); // tampered, same size
  assert.throws(() => stage({commit: COMMIT, artifact: f.art, out: o2(), sourceCheck: ok}), /sha256 mismatch/);
  const g = fixture(t); fs.writeFileSync(path.join(g.art, 'README.txt'), 'x');
  assert.throws(() => stage({commit: COMMIT, artifact: g.art, out: o2(), sourceCheck: ok}), /exactly manifest.json and site/);
});

test('stage source check: a checkout at another commit is refused (skipped without a git checkout)', t => {
  let head;
  try { head = execFileSync('git', ['-C', HERE, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { t.skip('no git checkout'); return; }
  assert.throws(() => gitSourceCheck(head === COMMIT ? 'f'.repeat(40) : COMMIT, HERE), /not the artifact commit/);
});

test('Dockerfile contract: rootless, zero-dependency, verifies the official site, PORT / health / SIGTERM', () => {
  const df = fs.readFileSync(path.join(HERE, 'Dockerfile'), 'utf8'), lines = df.split('\n').filter(l => !l.startsWith('#'));
  const body = lines.join('\n');
  assert.match(body, /^ARG NODE_IMAGE=node:22[.\w-]*$/m); assert.match(body, /^FROM \$\{NODE_IMAGE\}$/m);
  const user = lines.findIndex(l => /^USER /.test(l));
  assert.equal(lines[user], 'USER 1000:1000');
  assert(lines.every((l, i) => !/^(?:RUN|COPY|ADD)\b/.test(l) || i < user), 'every build step runs before USER; nothing after it');
  assert.equal(lines.filter(l => /^USER /.test(l)).length, 1);
  assert.doesNotMatch(body, /\b(?:npm|yarn|pnpm|apt-get|apk|curl|wget)\b/); assert.doesNotMatch(body, /^ADD /m);
  assert.match(body, /site-manifest\.mjs verify --site \/app\/site --manifest \/app\/manifest\.json --commit "\$\{SOURCE_COMMIT\}" --hashes --wrapper \/app\/wrapper-source\.json/);
  assert.match(body, /test -n "\$\{SOURCE_COMMIT\}"/); assert.match(body, /EXPECTED_COMMIT=\$\{SOURCE_COMMIT\}/);
  for (const w of WRAPPER_FILES) assert.match(body, new RegExp(`^COPY .*\\b${w.replace('.', '\\.')}\\b.* /app/$`, 'm'), w);
  assert.match(body, /^EXPOSE 8080$/m); assert.match(body, /PORT=8080/); assert.match(body, /^STOPSIGNAL SIGTERM$/m);
  assert.match(body, /HEALTHCHECK[\s\S]*\/healthz/); assert.match(body, /^CMD \["node", "\/app\/server\.mjs"\]$/m);
  for (const f of ['server.mjs', 'site-manifest.mjs', 'stage.mjs']) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const [, spec] of src.matchAll(/^import .* from '([^']+)';$/gm)) assert(spec.startsWith('node:') || spec.startsWith('./'), `${f} imports ${spec}`);
  }
});
