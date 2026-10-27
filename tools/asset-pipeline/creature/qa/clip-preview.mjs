#!/usr/bin/env node
// Dev: preview the CURRENT lib/clips.mjs poses on the last built mesh/skin (no rebuild/bake).
//   node tools/asset-pipeline/creature/qa/clip-preview.mjs --clip=Death --times=0,0.5,1,1.5 --yaws=270,0,90 [--out=...]
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from '../../zombie/lib/master.mjs';
import {Canvas} from '../../zombie/lib/raster.mjs';
import {QRig} from '../lib/rig.mjs';
import {CLIP_SPECS} from '../lib/clips.mjs';
import {skinPositions} from '../lib/glb.mjs';
import {loadCreature, sheet} from './render-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const c = await loadCreature(path.join(REPO, 'game/public/assets/models/creature-ratdog.glb'));
const man = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/creature-ratdog.json'), 'utf8'));
const skel = {joints: man.skeleton.joints, ends: man.skeleton.ends};
const rig = new QRig(skel);
const mesh = {pos: c.mesh.pos, joints: c.mesh.joints, weights: c.mesh.weights};
const clip = args.clip || 'Death';
const spec = CLIP_SPECS[clip];
const times = String(args.times || `0,${spec.duration / 2},${spec.duration}`).split(',').map(Number);
const yaws = String(args.yaws || '270,0,90').split(',').map(v => v === 'top' ? 'top' : Number(v));
let ctx = {};
if (clip === 'Death') {
  let lo = -0.45, hi = 0.0;
  for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; const P = skinPositions(mesh, skel, rig.fk(spec.pose(rig, spec.duration, {deathFinal: {hipsY: mid, hipsX: -0.06}}))); let mn = Infinity; for (let i = 1; i < P.length; i += 3) mn = Math.min(mn, P[i]); if (mn > 0.01) hi = mid; else lo = mid; }
  ctx = {deathFinal: {hipsY: (lo + hi) / 2, hipsX: -0.06}};
  console.log('death hipsY', ctx.deathFinal.hipsY.toFixed(3));
}
const W = 300, H = 220;
const rows = times.map(t => yaws.map(yaw => {
  const pose = spec.pose(rig, t, ctx);
  let P = skinPositions(mesh, skel, rig.fk(pose));
  const cv = new Canvas(W, H, [40, 40, 46]);
  const cam = {yawDeg: yaw === 'top' ? 0 : yaw, cx: 0, cy: 0.3, cz: -0.1, height: 1.0};
  if (yaw === 'top') { const Q = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) { Q[i] = P[i]; Q[i + 1] = -P[i + 2]; Q[i + 2] = P[i + 1]; } P = Q; cam.cy = 0.1; cam.height = 1.5; }
  else { const y = Math.round(H / 2 + cam.cy * H / cam.height); for (let x = 0; x < W; x++) cv.rgb.set([90, 90, 70], (y * W + x) * 3); }
  cv.draw({pos: P, idx: c.mesh.idx, uv: c.mesh.uv, tex: c.tex, cullBack: false}, cam);
  return cv;
}));
const out = args.out || `/tmp/ll-creature/preview-${clip}.png`;
await sheet(out, `${clip} preview (lib/clips.mjs on the built mesh)`, rows, W, H, yaws.map(String), times.map(t => 't=' + t));
console.log('wrote', out);
