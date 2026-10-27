import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../public/vision-board');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.glb':'model/gltf-binary','.zip':'application/zip','.txt':'text/plain'};
function contained(file) {
  const real = fs.realpathSync(file), base = fs.realpathSync(root);
  if (!real.startsWith(base + path.sep)) throw Error('Outside package');
  return real;
}
function modelPath(id) {
  const map = JSON.parse(fs.readFileSync(path.join(root, 'local-model-map.json')));
  const entries = map.models ?? map;
  const entry = Array.isArray(entries) ? entries.find(e => e.uploadId === id) : entries[id];
  const relative = typeof entry === 'string' ? entry : entry?.packagePath ?? entry?.path ?? entry?.localPath ?? entry?.file;
  if (relative !== `models/${id}.glb`) throw Error('Unmapped model');
  return path.join(root, relative);
}
export const server = http.createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') { res.writeHead(302,{Location:'/vision-board/'}).end(); return; }
    let file;
    const model = /^\/subway-asset-drop\/files\/([a-zA-Z0-9_-]+)$/.exec(pathname);
    if (model) file = modelPath(model[1]);
    else if (pathname === '/subway-asset-drop/api/asset-reviews') {
      const snapshot = JSON.parse(fs.readFileSync(contained(path.join(root,'reviews-snapshot.json'))));
      const data = Buffer.from(JSON.stringify({...snapshot,readOnly:true,snapshot:true}));
      res.writeHead(200,{'Content-Type':'application/json','Content-Length':data.length,'Cache-Control':'no-store'});
      res.end(req.method === 'HEAD' ? undefined : data); return;
    } else {
      if (!pathname.startsWith('/vision-board/')) throw Error('Unknown route');
      const relative = pathname.slice('/vision-board/'.length);
      if (relative.split('/').some(p => p === '..') || relative.includes('\\') || relative.includes('\0')) throw Error('Invalid path');
      file = path.resolve(root, relative || 'index.html');
      if (!file.startsWith(root + path.sep)) throw Error('Outside package');
      if (fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
    }
    file = contained(file);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw Error('Not a file');
    res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Content-Length':stat.size,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    if (req.method === 'HEAD') res.end();
    else { const stream=fs.createReadStream(file); stream.on('error',()=>res.destroy()); stream.pipe(res); }
  } catch { res.writeHead(404).end(req.method === 'HEAD' ? undefined : 'Packaged file unavailable'); }
});
server.listen(4173,'127.0.0.1',()=>console.log('Read-only Studio snapshot: http://127.0.0.1:4173/vision-board/'));
