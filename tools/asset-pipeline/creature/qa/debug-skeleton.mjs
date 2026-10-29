#!/usr/bin/env node
// Dev/QA: place the read-only master, detect the quadruped skeleton and render side / top / front
// views with the joints (red), ends (yellow) and leg-track slices (cyan) overlaid.
//   node tools/asset-pipeline/creature/qa/debug-skeleton.mjs [--out=/tmp/ll-creature/skeleton.png] [--top=0.64]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {loadSource} from '../../zombie/lib/source.mjs';
import {weldByPosition} from '../../zombie/lib/mesh.mjs';
import {Canvas} from '../../zombie/lib/raster.mjs';
import {MASTER} from '../lib/master.mjs';
import {t25Source, loadAnySource} from '../../zombie/lib/t25.mjs';
import {quadrupedPlacement} from '../lib/placement.mjs';
import {detectQuadruped} from '../lib/landmarks.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const OUT = args.out || '/tmp/ll-creature/skeleton.png';
// --t25: the pinned Meshy T2.5 source of build-creature.mjs (densified), instead of the legacy Pixal3D master
const T25 = {asset: 'creature:ratdog', attempt: 'a1', sha256: '62cd6d25a8d4e7843269c038cbd8cf31583459044eefd50fe375cfb7121dc96b', densifyFrac: 0.009};
const m = args.t25 ? await loadAnySource(t25Source(T25.asset, T25, T25.densifyFrac)) : await loadSource(MASTER);
const pl = quadrupedPlacement(m.pos, {topHeight: +(args.top || 0.64)});
console.log(JSON.stringify(pl.report()));
const pos = pl.apply(m.pos), nrm = pl.applyNormals(m.nrm);
const welded = weldByPosition(pos, nrm, m.idx);
console.log('welded verts', welded.pos.length / 3);
const sk = detectQuadruped(welded, pl.paws);
console.log(JSON.stringify({joints: sk.joints, ends: sk.ends, measures: sk.measures, sanity: sk._sanity}, null, 1));
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT.replace(/\.png$/, '.json'), JSON.stringify({joints: sk.joints, ends: sk.ends, measures: sk.measures, placement: pl.report()}, null, 1));

const tex = {...m.baseColor, channels: 4};
const W = 520, H = 360;
function dot(c, p, cam, col, r = 2) {
  const th = (cam.yawDeg || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), k = c.h / cam.height;
  const x = p[0] - (cam.cx || 0), y = p[1] - cam.cy, z = p[2] - (cam.cz || 0);
  const sx = Math.round(c.w / 2 + (cs * x - sn * z) * k), sy = Math.round(c.h / 2 - y * k);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = sx + dx, Y = sy + dy; if (X >= 0 && Y >= 0 && X < c.w && Y < c.h) c.rgb.set(col, (Y * c.w + X) * 3); }
}
const views = [];
const drawAll = (c, cam, P, N) => {
  c.draw({pos: P, idx: m.idx, uv: m.uv, tex, nrm: N}, cam);
  for (const pts of Object.values(sk.debug.legs)) for (const p of pts) dot(c, p, cam, [0, 220, 255], 1);
  for (const p of Object.values(sk.ends)) dot(c, p, cam, [255, 230, 0], 2);
  for (const p of Object.values(sk.joints)) dot(c, p, cam, [255, 40, 40], 3);
};
for (const yaw of [270, 90, 0]) {
  const c = new Canvas(W, H);
  const cam = {yawDeg: yaw, cx: 0, cy: 0.36, cz: 0, height: yaw === 0 ? 0.8 : 1.05};
  // ghost the mesh by drawing it, then overlay; for clarity draw the joints after a dimmed copy
  c.draw({pos, idx: m.idx, uv: m.uv, tex, nrm}, cam);
  for (let i = 0; i < c.rgb.length; i++) c.rgb[i] = c.rgb[i] * 0.55;
  for (const pts of Object.values(sk.debug.legs)) for (const p of pts) dot(c, p, cam, [0, 220, 255], 1);
  for (const p of Object.values(sk.ends)) dot(c, p, cam, [255, 230, 0], 2);
  for (const p of Object.values(sk.joints)) dot(c, p, cam, [255, 40, 40], 3);
  views.push(c);
}
{
  // top view: (x, y, z) -> (x, -z, y)
  const T = v => [v[0], -v[2], v[1]];
  const P = new Float32Array(pos.length), N = new Float32Array(nrm.length);
  for (let i = 0; i < P.length; i += 3) { P[i] = pos[i]; P[i + 1] = -pos[i + 2]; P[i + 2] = pos[i + 1]; N[i] = nrm[i]; N[i + 1] = -nrm[i + 2]; N[i + 2] = nrm[i + 1]; }
  const c = new Canvas(W, H);
  const cam = {yawDeg: 0, cx: 0, cy: 0.0, height: 1.3};
  c.draw({pos: P, idx: m.idx, uv: m.uv, tex, nrm: N}, cam);
  for (let i = 0; i < c.rgb.length; i++) c.rgb[i] = c.rgb[i] * 0.55;
  for (const pts of Object.values(sk.debug.legs)) for (const p of pts) dot(c, T(p), cam, [0, 220, 255], 1);
  for (const p of Object.values(sk.ends)) dot(c, T(p), cam, [255, 230, 0], 2);
  for (const p of Object.values(sk.joints)) dot(c, T(p), cam, [255, 40, 40], 3);
  views.push(c);
}
void drawAll;
const comps = views.map((c, i) => ({input: Buffer.from(c.rgb), raw: {width: W, height: H, channels: 3}, left: (i % 2) * W, top: Math.floor(i / 2) * H}));
await sharp({create: {width: W * 2, height: H * 2, channels: 3, background: '#000'}}).composite(comps).png().toFile(OUT);
console.log('wrote', OUT);
