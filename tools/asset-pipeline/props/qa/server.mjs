// Minimal read-only static server for QA renders. Binds 127.0.0.1 on a random port, GET/HEAD only,
// serves files under the repository root. Never exposed publicly; closed by the caller.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

export function startServer(root) {
  const rootAbs = path.resolve(root);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400); res.end(); return; }
    const file = path.resolve(rootAbs, '.' + rel);
    if (file !== rootAbs && !file.startsWith(rootAbs + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store'});
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port, close: () => new Promise(r => server.close(r))})));
}
