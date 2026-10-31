// Task track3-eaton-centre-20261031 (lane PACKAGE): zero-dependency static server for the dynamic Docker app. It serves an
// OFFICIAL CI site artifact (tools/release/package-ci.mjs `site/` + `manifest.json`) unchanged, copied into the image —
// never a local or independent build (CONTRACT.md). Node 22 built-ins only; no npm dependencies, database or capabilities.
//
//  - Serves EXACTLY the manifest's files (an allowlist map): no directory listing, no other path on disk is reachable.
//    Requests are matched after strict decoding (no `..` / dot segments, encoded slashes, backslashes or NUL).
//  - PORT (default 8080), HOST (default 0.0.0.0), BASE_PATH (default /): the game uses relative asset URLs, so it works at
//    the site root or under a path prefix; `<BASE_PATH>` redirects to `<BASE_PATH>/` so relative URLs resolve.
//  - Cache: index.html `no-cache`; content-hashed bundles (assets/index-*.js|css) immutable for a year; every other file
//    `no-cache` with a strong ETag (the manifest sha256) and 304 revalidation (models / audio keep stable names).
//  - gzip for text types (html / js / css / json / md / svg / txt), compressed once and cached in memory (bounded).
//  - Security headers on every response (CSP, nosniff, no-referrer, COOP / CORP, Permissions-Policy, frame-ancestors).
//  - GET /healthz (and <BASE_PATH>/healthz): 200 JSON {status, commit, files, bytes}; 503 while draining.
//  - SIGTERM / SIGINT: stop accepting, drain in-flight responses (SHUTDOWN_TIMEOUT_MS, default 10 s), exit 0.
//  - Read-only filesystem friendly: never writes to disk. Startup refuses a site that differs from its manifest.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {pipeline} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {COMMIT, readManifest, safeSitePath, verifySite} from './site-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const MIME = Object.freeze({
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif',
  ktx2: 'image/ktx2', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff',
});
const COMPRESSIBLE = new Set(['html', 'js', 'mjs', 'css', 'json', 'map', 'md', 'txt', 'svg']);
/** Content-hashed bundle names (identical to package-ci.mjs bundlePath): safe to cache forever. */
const HASHED = /^assets\/index-[A-Za-z0-9_-]+\.(?:js|css)$/;
const GZIP_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export const extOf = rel => { const i = rel.lastIndexOf('.'); return i < 0 ? '' : rel.slice(i + 1).toLowerCase(); };
export const mimeOf = rel => MIME[extOf(rel)] ?? 'application/octet-stream';

/** '/' -> '' ; '/play/' -> '/play'. Plain segments only (no dot segments, encoded or empty parts). */
export function normalizeBasePath(v = '/') {
  const s = String(v).trim();
  if (s === '' || s === '/') return '';
  const parts = s.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.some(p => !/^[A-Za-z0-9_~-][A-Za-z0-9_.~-]*$/.test(p))) throw new Error(`Invalid BASE_PATH: ${v}`);
  return `/${parts.join('/')}`;
}

/** Resolves the server configuration from the environment (all optional). Throws on invalid values. */
export function resolveConfig(env = process.env) {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || String(env.PORT ?? '8080').trim() === '') throw new Error(`Invalid PORT: ${env.PORT}`);
  const expectedCommit = env.EXPECTED_COMMIT ? String(env.EXPECTED_COMMIT) : null;
  if (expectedCommit !== null && !COMMIT.test(expectedCommit)) throw new Error('EXPECTED_COMMIT must be a full 40-hex SHA');
  const frameAncestors = env.FRAME_ANCESTORS ?? "'self'";
  if (/[;\r\n,]/.test(frameAncestors)) throw new Error('Invalid FRAME_ANCESTORS');
  const csp = env.CONTENT_SECURITY_POLICY ?? defaultCsp(frameAncestors);
  if (/[\r\n]/.test(csp)) throw new Error('Invalid CONTENT_SECURITY_POLICY');
  const shutdownMs = Number(env.SHUTDOWN_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(shutdownMs) || shutdownMs < 0) throw new Error('Invalid SHUTDOWN_TIMEOUT_MS');
  return {
    port, host: env.HOST || '0.0.0.0', basePath: normalizeBasePath(env.BASE_PATH ?? '/'),
    siteDir: path.resolve(env.SITE_DIR || path.join(HERE, 'site')), manifestPath: path.resolve(env.MANIFEST || path.join(HERE, 'manifest.json')),
    expectedCommit, verifyHashes: env.VERIFY_HASHES_ON_START === '1', frameAncestors, csp, shutdownMs, accessLog: env.ACCESS_LOG === '1',
  };
}

/**
 * The game's needs (checked against the iteration-13+ bundle): one module script from self, inline <style> / style attributes,
 * blob: images + blob: fetches (GLTFLoader's embedded GLB images), data: favicon, same-origin fetch / XHR (models, audio).
 * No eval, workers, WebAssembly or remote origins. CONTENT_SECURITY_POLICY overrides it if a future build needs more.
 */
export function defaultCsp(frameAncestors = "'self'") {
  return ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "media-src 'self' blob:", "connect-src 'self' blob: data:", "worker-src 'self' blob:", "font-src 'self' data:",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", `frame-ancestors ${frameAncestors}`].join('; ');
}

function securityHeaders(cfg) {
  const h = {
    'Content-Security-Policy': cfg.csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  if (cfg.frameAncestors === "'self'") h['X-Frame-Options'] = 'SAMEORIGIN';
  else if (cfg.frameAncestors === "'none'") h['X-Frame-Options'] = 'DENY';
  return h;
}

const acceptsGzip = v => typeof v === 'string' && v.split(',').some(p => {
  const [name, ...params] = p.trim().toLowerCase().split(';');
  if (name.trim() !== 'gzip' && name.trim() !== '*') return false;
  const q = params.map(s => s.trim()).find(s => s.startsWith('q='));
  return !q || Number(q.slice(2)) > 0;
});
const etagMatches = (header, etag) => typeof header === 'string'
  && header.split(',').some(t => { const v = t.trim().replace(/^W\//, ''); return v === '*' || v === etag; });

/**
 * Creates (does not start) the server. Loads + verifies the site synchronously: a manifest / site mismatch throws, so a
 * wrong image never starts serving. Returns {server, site, config, listen(), close()}.
 */
export function createSiteServer(config, {log = line => console.log(JSON.stringify(line))} = {}) {
  const cfg = config;
  const manifest = readManifest(cfg.manifestPath);
  const site = verifySite(cfg.siteDir, manifest, {hashes: cfg.verifyHashes, expectedCommit: cfg.expectedCommit});
  if (manifest.files.has('healthz')) throw new Error('The site may not contain a root file named healthz (reserved)');
  const base = cfg.basePath, headers = securityHeaders(cfg);
  const gz = new Map();
  let gzBytes = 0, draining = false;

  const gzipOf = rel => {
    let p = gz.get(rel);
    if (!p) {
      p = fs.promises.readFile(path.join(cfg.siteDir, ...rel.split('/')))
        .then(b => new Promise((ok, no) => zlib.gzip(b, {level: 9}, (e, out) => e ? no(e) : ok(out))));
      gz.set(rel, p);
      p.then(b => { gzBytes += b.length; if (gzBytes > GZIP_CACHE_MAX_BYTES) { gz.delete(rel); gzBytes -= b.length; } }, () => gz.delete(rel));
    }
    return p;
  };

  const plain = (res, status, text, extra = {}) => {
    const body = Buffer.from(`${text}\n`);
    res.writeHead(status, {...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length, ...extra});
    res.end(res.req.method === 'HEAD' ? undefined : body);
  };

  const serveFile = (req, res, rel) => {
    const e = manifest.files.get(rel), ext = extOf(rel);
    const zip = COMPRESSIBLE.has(ext) && e.bytes > 256 && acceptsGzip(req.headers['accept-encoding']);
    const etag = `"${e.sha256}${zip ? '.gz' : ''}"`;
    const h = {...headers, 'Content-Type': mimeOf(rel), ETag: etag,
      'Cache-Control': rel === 'index.html' ? 'no-cache' : HASHED.test(rel) ? 'public, max-age=31536000, immutable' : 'public, no-cache'};
    if (COMPRESSIBLE.has(ext)) h.Vary = 'Accept-Encoding';
    if (etagMatches(req.headers['if-none-match'], etag)) { res.writeHead(304, h); res.end(); return; }
    if (zip) {
      gzipOf(rel).then(b => {
        res.writeHead(200, {...h, 'Content-Encoding': 'gzip', 'Content-Length': b.length});
        res.end(req.method === 'HEAD' ? undefined : b);
      }, err => { log({event: 'error', path: rel, error: String(err?.message ?? err)}); if (!res.headersSent) plain(res, 500, 'Internal Server Error'); else res.destroy(); });
      return;
    }
    res.writeHead(200, {...h, 'Content-Length': e.bytes});
    if (req.method === 'HEAD') { res.end(); return; }
    pipeline(fs.createReadStream(path.join(cfg.siteDir, ...rel.split('/'))), res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') log({event: 'error', path: rel, error: String(err.message ?? err)});
    });
  };

  const handle = (req, res) => {
    if (cfg.accessLog) res.on('finish', () => log({event: 'request', method: req.method, url: String(req.url).slice(0, 200), status: res.statusCode}));
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method Not Allowed', {Allow: 'GET, HEAD'});
    const raw = String(req.url ?? '');
    if (!raw.startsWith('/')) return plain(res, 400, 'Bad Request');
    const qi = raw.indexOf('?'), pathname = qi < 0 ? raw : raw.slice(0, qi), search = qi < 0 ? '' : raw.slice(qi);
    if (pathname === '/healthz' || (base && pathname === `${base}/healthz`)) {
      const body = Buffer.from(JSON.stringify({status: draining ? 'draining' : 'ok', commit: manifest.commit, files: site.files, bytes: site.bytes}));
      res.writeHead(draining ? 503 : 200, {...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length});
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    // the app root without its trailing slash (or the bare host under a prefix): relative asset URLs need `<base>/`
    if (base && (pathname === base || pathname === '/')) return plain(res, 308, 'Permanent Redirect', {Location: `${base}/${search}`});
    if (!pathname.startsWith(`${base}/`)) return plain(res, 404, 'Not Found');
    const enc = pathname.slice(base.length + 1);
    if (/%2f|%5c|\\/i.test(enc)) return plain(res, 404, 'Not Found');
    let rel;
    try { rel = decodeURIComponent(enc); } catch { return plain(res, 400, 'Bad Request'); }
    if (rel === '') rel = 'index.html';
    if (!safeSitePath(rel) || !manifest.files.has(rel)) return plain(res, 404, 'Not Found');
    return serveFile(req, res, rel);
  };

  const server = http.createServer(handle);
  server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return {
    server, site, config: cfg,
    get draining() { return draining; },
    listen: () => new Promise((ok, no) => { server.once('error', no); server.listen(cfg.port, cfg.host, () => { server.off('error', no); ok(server.address()); }); }),
    /** Graceful stop: health turns 503, no new connections, idle keep-alives closed, in-flight responses drain (bounded). */
    close: (timeoutMs = cfg.shutdownMs) => new Promise(ok => {
      draining = true;
      const force = setTimeout(() => server.closeAllConnections(), timeoutMs);
      force.unref();
      server.close(() => { clearTimeout(force); ok(); });
      server.closeIdleConnections();
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = line => console.log(JSON.stringify({time: new Date().toISOString(), ...line}));
  let app;
  try {
    app = createSiteServer(resolveConfig(process.env), {log});
  } catch (err) {
    log({event: 'fatal', error: String(err?.message ?? err)});
    process.exit(1);
  }
  const addr = await app.listen();
  log({event: 'listening', host: addr.address, port: addr.port, basePath: app.config.basePath || '/', commit: app.site.commit, files: app.site.files, bytes: app.site.bytes, verifiedHashes: app.site.hashed});
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    log({event: 'shutdown', signal});
    app.close().then(() => { log({event: 'stopped'}); process.exit(0); });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
