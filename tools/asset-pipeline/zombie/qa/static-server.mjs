// Tiny read-only static file server bound to 127.0.0.1 on a random port.
// Serves the repository root (for node_modules/three and the GLB) and, under /__tmp/,
// the temporary QA directory. Path traversal outside those roots is refused.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.css': 'text/css',
};

export function startServer(repoRoot, tmpRoot) {
  const roots = [['/__tmp/', tmpRoot], ['/', repoRoot]];
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = decodeURIComponent(url.pathname);
      const [prefix, root] = roots.find(([pre]) => p.startsWith(pre));
      const abs = path.resolve(root, '.' + p.slice(prefix.length - 1));
      if (!abs.startsWith(path.resolve(root) + path.sep) && abs !== path.resolve(root)) { res.writeHead(403); res.end(); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      fs.stat(abs, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store'});
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(abs).pipe(res);
      });
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port, close: () => new Promise(r => server.close(r))})));
}
