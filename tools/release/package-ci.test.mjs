import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {packageSite,checkRuntime,reportLines,MAX_FILE,MAX_FILES,STATIC_HOST_ADVISORY_BYTES} from './package-ci.mjs';
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
test('provenance JSON follows the model rule: unreferenced -> tracked + allowlisted, not shipped; referenced by path -> shipped',t=>{
  // Task reactor-surface-ending-20261102 (lead, release capacity)
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'terminal-state-package-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const put=(rel,body)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);};
  const files=[['assets/models/live.glb','live'],['assets/derivatives/live-prov.json','{"a":1}'],['assets/derivatives/old-prov.json','{"provenance":"xxxx"}']];
  for(const [rel,b] of files) {put(`game/public/${rel}`,b);put(`dist/game/${rel}`,b);}
  put('tools/release/public-inputs.json',JSON.stringify({schema:'terminal-state-public-inputs-v1',files:files.map(([rel,b])=>({path:rel,bytes:Buffer.byteLength(b),sha256:sha(b)}))}));
  put('dist/game/index.html','<script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css">');
  put('dist/game/assets/index-test.js','fetch("assets/models/live.glb"); const prov = "assets/derivatives/live-prov.json";');
  put('dist/game/assets/index-test.css','body {color:red}');
  const m=packageSite({root,commit});
  assert.deepEqual(m.excludedUnreferencedProvenance,['assets/derivatives/old-prov.json']);
  assert.equal(m.report.excludedUnreferencedProvenanceBytes,Buffer.byteLength('{"provenance":"xxxx"}'));
  assert(m.files.some(e=>e.path==='assets/derivatives/live-prov.json'));
  assert(!m.files.some(e=>e.path==='assets/derivatives/old-prov.json'));
  assert(!fs.existsSync(path.join(root,'artifacts/terminal-state-web/site/assets/derivatives/old-prov.json')));
  assert(fs.existsSync(path.join(root,'game/public/assets/derivatives/old-prov.json'))); // still a tracked input
  assert.match(reportLines(m).join('\n'),/excluded 1 unreferenced provenance JSON \(\d+ B; tracked provenance, not shipped\)/);
  // a changed provenance input is still rejected (the allowlist / hash review is unchanged)
  put('game/public/assets/derivatives/old-prov.json','{"provenance":"evil"}');
  fs.rmSync(path.join(root,'artifacts'),{recursive:true,force:true});
  assert.throws(()=>packageSite({root,commit}),/Unreviewed/);
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
  // iteration 13 (three r186 WebGPURenderer): exact shader citation line + exact console message only
  checkRuntime('const w=`fn f(){\n\t// https://www.shadertoy.com/view/WtyXRy\n}`; console.error("Renderer: waitForGPU() has been removed. Read https://github.com/mrdoob/three.js/issues/32012 for more information.");','assets/index-test.js',files);
  checkRuntime('const a="/*", b="/* ... */ ", c="/* Recursion detected. */";','assets/index-test.js',files);
  for(const s of ['const a="/* x */"','const a="/assets/x.glb"']) assert.throws(()=>checkRuntime(s,'assets/index-test.js',files),/Root-absolute/);
  for(const s of ['const w=`// https://www.shadertoy.com/view/WtyXRy?x=1`','const w=`x // https://www.shadertoy.com/view/WtyXRy`','fetch("https://www.shadertoy.com/view/WtyXRy")','fetch("https://github.com/mrdoob/three.js/issues/32012")','console.error("Renderer: waitForGPU() has been removed. Read https://github.com/mrdoob/three.js/issues/32012")']) assert.throws(()=>checkRuntime(s,'assets/index-test.js',files),/External/);
});
test('require commit and all copied public inputs',t=>{
  const f=fixture(t);assert.throws(()=>packageSite({root:f.root,commit:'main'}),/40-hex/);
  fs.unlinkSync(path.join(f.root,'dist/game/assets/audio/test.mp3'));assert.throws(f.run,/Missing public copy/);
});

// Task track3-eaton-centre-20261031 (lane PACKAGE): no artificial TOTAL cap (user decision 2026-10-31); the per-file and
// file-count guards and every allowlist / path / URL check stay; sizes are reported exactly.
test('manifest states no total cap, keeps the per-file / count guards and reports exact sizes by type and family',t=>{
  const f=fixture(t);
  f.put('game/public/assets/models/mall-fountain.glb','mall!');f.put('dist/game/assets/models/mall-fountain.glb','mall!');
  f.put('game/public/assets/models/office-desk.glb','office');f.put('dist/game/assets/models/office-desk.glb','office');
  f.put('game/public/assets/textures/mall/terrazzo.jpg','tex');f.put('dist/game/assets/textures/mall/terrazzo.jpg','tex');
  const pol=JSON.parse(fs.readFileSync(path.join(f.root,'tools/release/public-inputs.json'),'utf8'));
  for(const [rel,b] of [['assets/models/mall-fountain.glb','mall!'],['assets/models/office-desk.glb','office'],['assets/textures/mall/terrazzo.jpg','tex']]) pol.files.push({path:rel,bytes:Buffer.byteLength(b),sha256:sha(b)});
  f.put('tools/release/public-inputs.json',JSON.stringify(pol));
  f.put('dist/game/assets/index-test.js','fetch("assets/models/live.glb"); fetch("assets/audio/test.mp3"); fetch("assets/models/mall-fountain.glb"); fetch("assets/models/office-desk.glb"); fetch("assets/textures/mall/terrazzo.jpg");');
  const m=f.run();
  assert.equal(m.checks.maxTotalBytes,null);assert.equal(m.checks.maxFileBytes,MAX_FILE);assert.equal(m.checks.maxFiles,MAX_FILES);
  assert.equal(m.totalBytes,m.files.reduce((s,e)=>s+e.bytes,0));
  const r=m.report;
  assert.equal(Object.values(r.byType).reduce((s,v)=>s+v.bytes,0),m.totalBytes);
  assert.equal(Object.values(r.byType).reduce((s,v)=>s+v.files,0),m.fileCount);
  assert.deepEqual(r.levelFamilies.models,{mall:{files:1,bytes:5},office:{files:1,bytes:6},reactor:{files:0,bytes:0},skyways:{files:0,bytes:0},market:{files:0,bytes:0},bunker:{files:0,bytes:0},shared:{files:1,bytes:4}}); // (reactor-build, lane ARCH: + the reactor family; + skyways; + market; + bunker)
  assert.deepEqual(r.levelFamilies.textures,{mall:{files:1,bytes:3},office:{files:0,bytes:0},reactor:{files:0,bytes:0},skyways:{files:0,bytes:0},market:{files:0,bytes:0},bunker:{files:0,bytes:0},shared:{files:0,bytes:0}});
  assert.deepEqual(r.byType.audio,{files:1,bytes:5});
  assert.equal(r.excludedUnreferencedModelBytes,Buffer.byteLength('obsolete'));
  assert.equal(r.largestFiles[0].path,'assets/index-test.js');
  const lines=reportLines(m).join('\n');
  assert.match(lines,/no total-size cap/);assert.match(lines,/models by family: mall 1 \/ 5 B · office 1 \/ 6 B · reactor 0 \/ 0 B · skyways 0 \/ 0 B · market 0 \/ 0 B · bunker 0 \/ 0 B · shared 1 \/ 4 B/); // (reactor-build, lane ARCH; + bunker)
  assert.match(lines,/advisory \(not a CI limit\).*fits/);
  assert.match(reportLines({...m,totalBytes:STATIC_HOST_ADVISORY_BYTES+1}).join('\n'),/exceeds by 1 B: use the dynamic app/);
});
test('a site above the removed 150 MiB total packages (no total cap) with exact totals; per-file guard unchanged',t=>{
  const f=fixture(t), chunk=23*1024*1024, zero=sha(Buffer.alloc(chunk));
  const pol=JSON.parse(fs.readFileSync(path.join(f.root,'tools/release/public-inputs.json'),'utf8'));
  let refs='fetch("assets/models/live.glb"); fetch("assets/audio/test.mp3");';
  for(let i=0;i<7;i++){ // 7 x 23 MiB = 161 MiB > the old 157,286,400 B cap; sparse inputs keep the fixture cheap
    const rel=`assets/models/big-${i}.glb`;
    for(const base of ['game/public','dist/game']){const p=path.join(f.root,base,rel);fs.writeFileSync(p,'');fs.truncateSync(p,chunk);}
    pol.files.push({path:rel,bytes:chunk,sha256:zero});refs+=` fetch("${rel}");`;
  }
  f.put('tools/release/public-inputs.json',JSON.stringify(pol));f.put('dist/game/assets/index-test.js',refs);
  const m=f.run();
  assert(m.totalBytes>150*1024*1024);assert.equal(m.totalBytes,m.files.reduce((s,e)=>s+e.bytes,0));
  assert.equal(m.report.levelFamilies.models.shared.bytes,7*chunk+Buffer.byteLength('live'));
  for(let i=0;i<7;i++) assert.equal(fs.statSync(path.join(f.root,`artifacts/terminal-state-web/site/assets/models/big-${i}.glb`)).size,chunk);
  const g=fixture(t);const p=path.join(g.root,'dist/game/assets/models/live.glb');fs.truncateSync(p,MAX_FILE+1);assert.throws(g.run,/size limit/);
});
// (task studio-general-armor-20261107-231448-01) the guard bounds the SHIPPED artifact: more than MAX_FILES referenced, allowlisted outputs
// are refused; tracked inputs the packager drops (unreferenced models / provenance) do not count toward it.
function bulk(t,n,{referenced}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'terminal-state-package-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const put=(rel,body)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);};
  const files=[['assets/models/live.glb','live']];
  for(let i=0;i<n;i++) files.push([`assets/derivatives/extra-${i}.json`,`{"i":${i}}`]);
  for(const [rel,b] of files) {put(`game/public/${rel}`,b);put(`dist/game/${rel}`,b);}
  put('tools/release/public-inputs.json',JSON.stringify({schema:'terminal-state-public-inputs-v1',files:files.map(([rel,b])=>({path:rel,bytes:Buffer.byteLength(b),sha256:sha(b)}))}));
  put('dist/game/index.html','<script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css">');
  const refs=referenced?files.map(([rel])=>`fetch("${rel}");`).join(''):'fetch("assets/models/live.glb");';
  put('dist/game/assets/index-test.js',refs);
  put('dist/game/assets/index-test.css','body {color:red}');
  return ()=>packageSite({root,commit});
}
test('file-count guard still rejects more than MAX_FILES shipped outputs',t=>{
  assert.throws(bulk(t,MAX_FILES,{referenced:true}),/too many files/);
});
test('file-count guard counts shipped outputs: unreferenced tracked provenance beyond the cap is dropped, not counted',t=>{
  const m=bulk(t,MAX_FILES,{referenced:false})();
  assert.equal(m.excludedUnreferencedProvenance.length,MAX_FILES);
  assert(m.fileCount<=MAX_FILES);
});
