#!/usr/bin/env node
// Iteration 07 (Lane W): headwear BEFORE / AFTER close-ups (CPU raster). Per body x hat: before front |
// before side | after front | after side, framed on the head at the same scale, with the measured item
// width / height printed in the row label.
//   node tools/asset-pipeline/zombie/qa/headwear-compare.mjs --before=DIR --after=DIR [--out=FILE] [--items=hardhat,cap,beanie]
import fs from 'node:fs';
import path from 'node:path';
import {loadBody, loadWearable, skinMesh, maskedIndex, sheet} from './render-lib.mjs';
import {Canvas} from '../lib/raster.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const BEFORE = path.resolve(REPO, args.before), AFTER = path.resolve(REPO, args.after || 'game/public/assets/models');
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/iter07-wardrobe/headwear-before-after.png');
const ITEMS = String(args.items || 'hardhat,cap,beanie').split(',');
const bodies = ['lastshift', 'courier', 'agent', 'heavyset', 'tall'];

function draw(B, W, yaw) {
  const c = new Canvas(190, 200, [44, 44, 50]);
  const world = B.joints.map(j => ({q: j.getRotation().slice(), p: j.getTranslation().slice()}));
  // bind world transforms (identity rotations): accumulate translations
  const wp = [];
  B.joints.forEach((j, i) => { const par = B.joints.indexOf(j.getParentNode?.()); wp[i] = par < 0 ? world[i].p : world[i].p.map((v, k) => v + wp[par][k]); });
  const rw = wp.map(p => ({q: [0, 0, 0, 1], p}));
  const head = wp[B.names.indexOf('Head')];
  const cam = {yawDeg: yaw, cx: head[0], cy: head[1] + 0.07, cz: head[2], height: 0.46};
  const v = W.variants[B.extras.id];
  c.draw({pos: skinMesh(B.mesh, B, rw), idx: maskedIndex(B.mesh.idx, [v.extras.hideBodyTriangles]), uv: B.mesh.uv, tex: B.tex, cullBack: true}, cam);
  c.draw({pos: skinMesh(v.mesh, B, rw), idx: v.mesh.idx, uv: v.mesh.uv, tex: W.tex, cullBack: true}, cam);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; const P = v.mesh.pos;
  for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
  c.dims = {w: x1 - x0, h: y1 - y0};
  return c;
}

const rows = [], labels = [];
for (const item of ITEMS) for (const b of bodies) {
  const fb = path.join(BEFORE, `zombie-body-${b}.glb`), fa = path.join(AFTER, `zombie-body-${b}.glb`);
  const wb = path.join(BEFORE, `outfit-${item}.glb`), wa = path.join(AFTER, `outfit-${item}.glb`);
  if (![fb, fa, wb, wa].every(f => fs.existsSync(f))) continue;
  const Bb = await loadBody(fb), Ba = await loadBody(fa), Wb = await loadWearable(wb), Wa = await loadWearable(wa);
  if (!Wb.variants[b] || !Wa.variants[b]) continue;
  const row = [draw(Bb, Wb, 0), draw(Bb, Wb, 90), draw(Ba, Wa, 0), draw(Ba, Wa, 90)];
  rows.push(row);
  labels.push(`${b} ${item}: ${(row[0].dims.w * 100).toFixed(1)}x${(row[0].dims.h * 100).toFixed(1)} -> ${(row[2].dims.w * 100).toFixed(1)}x${(row[2].dims.h * 100).toFixed(1)} cm`);
}
fs.mkdirSync(path.dirname(OUT), {recursive: true});
await sheet(OUT, 'Headwear before (iteration 06) | after (iteration 07, cranium fit): width x height of the item in cm per row', rows, 190, 200, ['before front', 'before side', 'after front', 'after side'], labels, {labelW: 330});
