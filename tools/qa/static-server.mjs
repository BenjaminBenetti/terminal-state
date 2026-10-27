// Minimal read-only static server for QA (127.0.0.1 only). Logs every request for the report.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/markdown'};

export function serveStatic(root, {prefix = '/'} = {}) {
  const log = [];
  const base = fs.realpathSync(root);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (!rel.startsWith(prefix)) { log.push({path: rel, status: 404}); res.writeHead(404).end(); return; }
    rel = rel.slice(prefix.length);
    let file = path.resolve(base, rel || 'index.html');
    if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const data = fs.readFileSync(file);
      log.push({path: url.pathname, status: 200, bytes: data.length});
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store'});
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      log.push({path: url.pathname, status: 404});
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port, log})));
}
