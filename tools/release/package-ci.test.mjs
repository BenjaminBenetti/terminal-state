import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {packageSite,checkRuntime} from './package-ci.mjs';
const commit='0123456789abcdef0123456789abcdef01234567';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'terminal-state-package-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const put=(rel,body)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);};
  const files=[['assets/models/live.glb','live'],['assets/models/obsolete.glb','obsolete'],['assets/audio/test.mp3','audio']];
  for(const [rel,b] of files) {put(`game/public/${rel}`,b);put(`dist/game/${rel}`,b);}
  put('tools/release/public-inputs.json',JSON.stringify({schema:'terminal-state-public-inputs-v1',files:files.map(([rel,b])=>({path:rel,bytes:Buffer.byteLength(b),sha256:sha(b)}))}));
  put('dist/game/index.html','<script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css">');
  put('dist/game/assets/index-test.js','fetch("assets/models/live.glb"); fetch("assets/audio/test.mp3");');
  put('dist/game/assets/index-test.css','body {color:red}');
  return {root,put,run:()=>packageSite({root,commit})};
}
test('relative wrapper, exact copied hashes, metadata and same model filter',t=>{
  const f=fixture(t), m=f.run();
  assert.equal(m.commit,commit);assert.equal(m.fileCount,5);
  assert.deepEqual(m.excludedUnreferencedModels,['assets/models/obsolete.glb']);
  assert(fs.existsSync(path.join(f.root,'game/public/assets/models/obsolete.glb')));
  for(const e of m.files) {const b=fs.readFileSync(path.join(f.root,'artifacts/terminal-state-web/site',e.path));assert.equal(sha(b),e.sha256);assert.equal(b.length,e.bytes);}
  assert.throws(f.run,/already exists/);
});
test('reject source, archives, dot files and unexpected outputs',t=>{
  for(const name of ['source.ts','map.js.map','raw.zip','.env','credentials.json']) {
    const f=fixture(t);f.put(`dist/game/assets/${name}`,'secret');assert.throws(f.run,/Unsafe|Unallowlisted/);
  }
});
test('reject changed or added public inputs and changed built copies',t=>{
  const a=fixture(t);a.put('game/public/assets/models/live.glb','evil');assert.throws(a.run,/Unreviewed/);
  const b=fixture(t);b.put('dist/game/assets/models/live.glb','evil');assert.throws(b.run,/Changed public copy/);
  const c=fixture(t);c.put('game/public/assets/models/raw.glb','raw');assert.throws(c.run,/count changed/);
});
test('reject symlink and oversized file',t=>{
  const a=fixture(t);fs.symlinkSync('/etc/passwd',path.join(a.root,'dist/game/assets/extra.glb'));assert.throws(a.run,/Symlink/);
  const b=fixture(t);b.put('dist/game/assets/huge.glb','');fs.truncateSync(path.join(b.root,'dist/game/assets/huge.glb'),26*1024*1024);assert.throws(b.run,/size limit/);
});
test('reject root-absolute, external and missing HTML/CSS/JS asset URLs',()=>{
  const files=new Set(['assets/index-test.js','assets/models/live.glb']);
  for(const s of ['<script src="/assets/index-test.js"></script>','<script src="https://example.com/x.js"></script>','<script src="./assets/missing.js"></script>','<script src=https://example.com/a.js></script>','<img srcset="https://example.com/a.png 2x">','<style>body{background:url(https://example.com/a.png)}</style>']) assert.throws(()=>checkRuntime(s,'index.html',files));
  for(const s of ['fetch("https://example.com/a")','fetch("//example.com/a")','fetch("/assets/models/live.glb")','fetch("assets/models/missing.glb")','import("https://example.com/a.js")','const u="//example.com/a"; fetch(u)','const u="/remote"; fetch(u)']) assert.throws(()=>checkRuntime(s,'assets/index-test.js',files));
  assert.throws(()=>checkRuntime('a{background:url(https://example.com/a.png)}','assets/index-test.css',files));
});
test('allow namespace and shader comment but never external fetch of namespace',()=>{
  const files=new Set();
  checkRuntime('document.createElementNS("http://www.w3.org/1999/xhtml","div"); const shader=`// https://jcgt.org/published/0007/04/01/\nvoid main(){}`;','assets/index-test.js',files);
  assert.throws(()=>checkRuntime('fetch("http://www.w3.org/1999/xhtml")','assets/index-test.js',files),/External/);
});
test('require commit and all copied public inputs',t=>{
  const f=fixture(t);assert.throws(()=>packageSite({root:f.root,commit:'main'}),/40-hex/);
  fs.unlinkSync(path.join(f.root,'dist/game/assets/audio/test.mp3'));assert.throws(f.run,/Missing public copy/);
});
