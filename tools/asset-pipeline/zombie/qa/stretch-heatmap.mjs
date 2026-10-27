#!/usr/bin/env node
// Motion-stretch heat map of a body: triangles whose worst edge stretch over sampled clip frames exceeds 3x are drawn red on the bind pose (4 views).
//   node tools/asset-pipeline/zombie/qa/stretch-heatmap.mjs <modelsDir> <bodyId> <out.png>
import path from 'node:path';
import sharp from 'sharp';
import {loadBody, poseAt, skinMesh} from './render-lib.mjs';
import {Canvas} from '../lib/raster.mjs';
const [dir, id, out] = process.argv.slice(2);
const B = await loadBody(path.join(dir, `zombie-body-${id}.glb`));
const frames = [['Walk',0.1],['Walk',0.3],['Walk',0.6],['Walk',0.9],['Run',0.1],['Run',0.2],['Run',0.4],['Run',0.6],['Attack',0.2],['Attack',0.32],['Attack',0.45],['Attack',0.7],['Hit',0.2],['Death',0.5],['Death',5],['Idle',1]];
const m = B.mesh, idx = m.idx, nt = idx.length/3, P0 = m.pos;
const L=(P,a,b)=>Math.hypot(P[a*3]-P[b*3],P[a*3+1]-P[b*3+1],P[a*3+2]-P[b*3+2]);
const r = new Float32Array(nt);
for (const [c,t] of frames) { const P = skinMesh(m, B, poseAt(B,c,t)); for (let k=0;k<nt;k++){const a=idx[k*3],b=idx[k*3+1],cc=idx[k*3+2]; const s=Math.max(L(P,a,b)/Math.max(2e-3,L(P0,a,b)),L(P,b,cc)/Math.max(2e-3,L(P0,b,cc)),L(P,cc,a)/Math.max(2e-3,L(P0,cc,a))); if(s>r[k]) r[k]=s;} }
// dominant joints of stretched tris
const names = B.names; const cnt = {};
for (let k=0;k<nt;k++) if (r[k]>3) { const js = new Set([0,1,2].map(q=>names[m.joints[idx[k*3+q]*4]])); const key=[...js].sort().join('+'); cnt[key]=(cnt[key]||0)+1; }
console.log(Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,15));
// y distribution
const ys=[]; for (let k=0;k<nt;k++) if (r[k]>3) ys.push(P0[idx[k*3]*3+1]); ys.sort((a,b)=>a-b); console.log('y pct', [0,0.1,0.5,0.9,1].map(q=>ys[Math.floor(q*(ys.length-1))]?.toFixed(2)));
const W=360,H=520, views=[0,90,180,270]; const buf=Buffer.alloc(W*views.length*H*3);
const hot = []; const cold=[]; for (let k=0;k<nt;k++) (r[k]>3?hot:cold).push(idx[k*3],idx[k*3+1],idx[k*3+2]);
for (const [vi,yaw] of views.entries()) { const c=new Canvas(W,H); const cam={yawDeg:yaw,cx:0,cy:1.2,cz:0,height:1.1};
  c.draw({pos:P0, idx:Uint32Array.from(cold), uv:m.uv, tex:B.tex}, cam); c.draw({pos:P0, idx:Uint32Array.from(hot), color:[255,30,30]}, cam);
  for (let y=0;y<H;y++) Buffer.from(c.rgb.buffer,y*W*3,W*3).copy(buf,(y*W*views.length+vi*W)*3); }
await sharp(buf,{raw:{width:W*views.length,height:H,channels:3}}).png().toFile(out);
