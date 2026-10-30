#!/usr/bin/env node
// Task studio-model-touchups-20261030-01 (lane GEOM): before / after CPU evidence of the local geometry repairs (no browser / GPU).
// BEFORE = the shipped Meshy T2.5 derivative at the pushed base commit (git show), AFTER = the repaired runtime file in the tree.
// Renders with lib/ortho-render.mjs (base colour x lambert, nearest texel) and writes the lib/local-repair-geom.mjs metrics.
// Usage: node tools/asset-pipeline/props/qa/local-repair-evidence.mjs <out-dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {loadTris, renderView, boundsOf} from '../lib/ortho-render.mjs';
import {cabinetMetrics, benchMetrics} from '../lib/local-repair-geom.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const BASE = '69a6b22ec6e73fbd4e01b9bd73c5e648e05c451b';
const out = path.resolve(process.argv[2] ?? path.join(REPO, 'reference/tasks/model-touchups-20261030/review'));
fs.mkdirSync(out, {recursive: true});

const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Orthographic view from yaw (deg, 0 = from +Z, 90 = from +X) and pitch (deg, + = from above). */
function view(yaw, pitch) {
  const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180, t = [Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)];
  const r = norm(cross([0, 1, 0], t)), u = cross(t, r);
  return p => [p[0] * r[0] + p[1] * r[1] + p[2] * r[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * t[0] + p[1] * t[1] + p[2] * t[2]];
}
const box = (min, max) => ({min, max});

const ASSETS = [
  {id: 'base:cabinetTall', name: 'cabinet-tall', before: 'game/public/assets/models/cabinet-tall-t25.glb', after: 'game/public/assets/models/cabinet-tall-t25r1.glb', metrics: cabinetMetrics,
    views: [
      ['right side (+X)', view(90, 0), null],
      ['top', view(0, 89.9), null],
      ['3/4 front-right, above', view(35, 25), null],
      ['back-left 3/4, above', view(-140, 30), null],
      ['close-up: side panel + post (right, upper half)', view(70, 10), box([0.3, 1.0, -0.3], [0.55, 1.92, 0.3])],
      ['close-up: top-front corner', view(40, 30), box([0.15, 1.55, -0.3], [0.55, 1.92, 0.3])],
    ]},
  {id: 'base:bench', name: 'bench', before: 'game/public/assets/models/bench-t25.glb', after: 'game/public/assets/models/bench-t25r1.glb', metrics: benchMetrics,
    views: [
      ['front (+Z)', view(0, 0), null],
      ['back (-Z)', view(180, 0), null],
      ['3/4 front, above', view(25, 25), null],
      ['3/4 back, above', view(155, 25), null],
      ['close-up: backrest front, left + middle bay', view(20, 15), box([-0.85, 0.3, -0.26], [0.0, 0.78, 0.0])],
      ['close-up: backrest back, right bay', view(160, 20), box([0.25, 0.25, -0.26], [0.9, 0.78, 0.0])],
    ]},
];

const S = 420, LH = 22, TH = 30;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const meshOf = async f => { const p = (await new NodeIO().read(f)).getRoot().listMeshes()[0].listPrimitives()[0]; return {P: p.getAttribute('POSITION').getArray(), N: p.getAttribute('NORMAL').getArray(), UV: p.getAttribute('TEXCOORD_0').getArray(), I: p.getIndices().getArray()}; };
const summary = {task: 'studio-model-touchups-20261030-01', lane: 'GEOM', baseCommit: BASE, tool: 'tools/asset-pipeline/props/qa/local-repair-evidence.mjs', assets: {}};
for (const A of ASSETS) {
  const tmp = path.join(os.tmpdir(), `geom-before-${A.name}.glb`);
  fs.writeFileSync(tmp, execFileSync('git', ['-C', REPO, 'show', `${BASE}:${A.before}`], {maxBuffer: 1 << 28}));
  const files = {BEFORE: tmp, AFTER: path.join(REPO, A.after)};
  const tris = {BEFORE: await loadTris(files.BEFORE), AFTER: await loadTris(files.AFTER)};
  const full = boundsOf(tris.BEFORE);
  const layers = []; let svg = '';
  const W = 2 * S, H = TH + A.views.length * (LH + S);
  svg += `<text x="8" y="21" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#ffd27a">${esc(A.id)}: BEFORE ${esc(path.basename(A.before))} @${BASE.slice(0, 7)} | AFTER ${esc(path.basename(A.after))} (local repair)</text>`;
  for (let r = 0; r < A.views.length; r++) {
    const [label, f, b] = A.views[r], y = TH + r * (LH + S);
    ['BEFORE', 'AFTER'].forEach((k, c) => {
      svg += `<text x="${c * S + 8}" y="${y + 16}" font-family="DejaVu Sans, sans-serif" font-size="13" fill="#e8e8e8">${k}: ${esc(label)}</text>`;
      layers.push({raw: renderView(tris[k], f, S, b ?? full), left: c * S, top: y + LH});
    });
  }
  const comps = [{input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202020"/>${svg}</svg>`), left: 0, top: 0}];
  for (const L of layers) comps.push({input: await sharp(L.raw, {raw: {width: S, height: S, channels: 3}}).png().toBuffer(), left: L.left, top: L.top});
  const sheet = path.join(out, `geom-${A.name}-before-after.png`);
  await sharp({create: {width: W, height: H, channels: 3, background: '#202020'}}).composite(comps).png().toFile(sheet);
  summary.assets[A.id] = {before: {file: A.before, commit: BASE, metrics: A.metrics(await meshOf(files.BEFORE))}, after: {file: A.after, metrics: A.metrics(await meshOf(files.AFTER))}, sheet: path.relative(REPO, sheet)};
  fs.rmSync(tmp);
  console.log('wrote', path.relative(REPO, sheet));
}
fs.writeFileSync(path.join(out, 'geom-metrics.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('wrote', path.relative(REPO, path.join(out, 'geom-metrics.json')));
