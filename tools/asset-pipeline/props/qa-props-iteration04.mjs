#!/usr/bin/env node
// Iteration04 (copied from iteration03) orientation/visual QA without a browser: CPU z-buffer rasterizer of the runtime derivative GLBs (baked base colour x
// simple Lambert), orthographic views front (+Z), right (+X), top (+Y, +Z = image down), 3/4 front-right and 3/4 back-left.
// Usage: node tools/asset-pipeline/props/qa-props-iteration04.mjs trashCan,shopCounter,... [--native]   Writes qa-artifacts/assets/props-iteration04/<key>-{derived,native}.png only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTDIR = path.join(REPO, 'qa-artifacts/assets/props-iteration04');
const FILES = {trashCan: 'trash-can.glb', shopCounter: 'shop-counter.glb', shopCooler: 'shop-cooler.glb', shopDisplay: 'shop-display.glb', shopBackbar: 'shop-backbar.glb'};
const keys = (process.argv[2] ?? Object.keys(FILES).join(',')).split(',');
fs.mkdirSync(OUTDIR, {recursive: true});
const CELL = Number(process.env.QA_CELL ?? 360);

async function load(file) {
  const doc = await new NodeIO().read(file);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray(), I = prim.getIndices().getArray();
  const tex = prim.getMaterial().getBaseColorTexture();
  const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {P, UV, I, tex: {data, w: info.width, h: info.height}};
}
// view: rotation (yaw about Y then pitch about X) of the model; camera looks along -Z of view space, +Y up.
function render(m, yawDeg, pitchDeg, label) {
  const cy = Math.cos(yawDeg * Math.PI / 180), sy = Math.sin(yawDeg * Math.PI / 180), cp = Math.cos(pitchDeg * Math.PI / 180), sp = Math.sin(pitchDeg * Math.PI / 180);
  const n = m.P.length / 3, V = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = m.P[3 * i], y = m.P[3 * i + 1], z = m.P[3 * i + 2];
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;           // yaw
    V[3 * i] = x1; V[3 * i + 1] = cp * y - sp * z1; V[3 * i + 2] = sp * y + cp * z1;  // pitch (positive = look from above)
  }
  let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], V[3 * i + k]); mx[k] = Math.max(mx[k], V[3 * i + k]); }
  const span = Math.max(mx[0] - mn[0], mx[1] - mn[1]) * 1.1, sc = CELL / span, cx = (mn[0] + mx[0]) / 2, cyy = (mn[1] + mx[1]) / 2;
  const img = new Uint8Array(CELL * CELL * 3).fill(235), zb = new Float32Array(CELL * CELL).fill(-Infinity);
  const L = [0.35, 0.6, 0.72], ll = Math.hypot(...L);
  for (let f = 0; f < m.I.length; f += 3) {
    const a = m.I[f], b = m.I[f + 1], c = m.I[f + 2];
    const px = [a, b, c].map(v => (V[3 * v] - cx) * sc + CELL / 2), py = [a, b, c].map(v => CELL / 2 - (V[3 * v + 1] - cyy) * sc), pz = [a, b, c].map(v => V[3 * v + 2]);
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2], vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nz <= 0) continue; // back-face cull (front faces point toward the viewer, +Z view)
    const shade = 0.45 + 0.55 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
    const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(CELL - 1, Math.ceil(Math.max(...px))), y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(CELL - 1, Math.ceil(Math.max(...py)));
    const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]); if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w0 = ((py[1] - py[2]) * (x + 0.5 - px[2]) + (px[2] - px[1]) * (y + 0.5 - py[2])) / den, w1 = ((py[2] - py[0]) * (x + 0.5 - px[2]) + (px[0] - px[2]) * (y + 0.5 - py[2])) / den, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * pz[0] + w1 * pz[1] + w2 * pz[2], k = y * CELL + x; if (z <= zb[k]) continue; zb[k] = z;
      const u = w0 * m.UV[2 * a] + w1 * m.UV[2 * b] + w2 * m.UV[2 * c], v = w0 * m.UV[2 * a + 1] + w1 * m.UV[2 * b + 1] + w2 * m.UV[2 * c + 1];
      const tx = Math.min(m.tex.w - 1, Math.max(0, Math.floor(u * m.tex.w))), ty = Math.min(m.tex.h - 1, Math.max(0, Math.floor(v * m.tex.h))), t = 3 * (ty * m.tex.w + tx);
      for (let ch = 0; ch < 3; ch++) img[3 * k + ch] = Math.min(255, m.tex.data[t + ch] * shade);
    }
  }
  return {img, label};
}
const NATIVE = process.argv.includes('--native');  // render the uncompressed native working copy (.cache/iteration04-native-masters/<key>/asset.glb) instead
for (const key of keys) {
  const file = NATIVE ? path.join(REPO, '.cache/iteration04-native-masters', key, 'asset.glb') : path.join(REPO, 'game/public/assets/models', FILES[key]);
  if (!fs.existsSync(file)) { console.log(key, 'missing'); continue; }
  const m = await load(file);
  if (NATIVE) { // native masters keep the elevated camera pose: view from source -Z (the conditioning camera side), plus +X/-X
    const v = [render(m, 180, 0, 'native from source -Z'), render(m, 90, 0, 'native from source -X (image right)'), render(m, -90, 0, 'native from source +X (image left)'), render(m, 180, 90, 'native top (from source +Y)')];
    const W = CELL * 4, out = Buffer.alloc(W * CELL * 3);
    v.forEach((r, i) => { for (let y = 0; y < CELL; y++) r.img.subarray(y * CELL * 3, (y + 1) * CELL * 3).forEach((b, j) => { out[(y * W + i * CELL) * 3 + j] = b; }); });
    await sharp(out, {raw: {width: W, height: CELL, channels: 3}}).png().toFile(path.join(OUTDIR, `${key}-native.png`)); console.log('wrote native', key); continue;
  }
  // yaw rotates the model; front (+Z) faces the viewer at yaw 0. Right side (+X) faces the viewer at yaw -90.
  const views = [render(m, 0, 0, 'front +Z'), render(m, -90, 0, 'right side +X'), render(m, 0, 90, 'top (+Z down)'), render(m, -35, 25, '3/4 front-right'), render(m, 145, 25, '3/4 back-left'), render(m, 35, 25, '3/4 front-left')];
  const W = CELL * 3, H = CELL * 2, out = Buffer.alloc(W * H * 3);
  views.forEach((v, i) => { const ox = (i % 3) * CELL, oy = Math.floor(i / 3) * CELL; for (let y = 0; y < CELL; y++) v.img.subarray(y * CELL * 3, (y + 1) * CELL * 3).forEach((b, j) => { out[((oy + y) * W + ox) * 3 + j] = b; }); });
  const svg = Buffer.from(`<svg width="${W}" height="${H}">${views.map((v, i) => `<text x="${(i % 3) * CELL + 8}" y="${Math.floor(i / 3) * CELL + 20}" font-size="16" font-family="sans-serif" fill="#a00">${key}: ${v.label}</text>`).join('')}</svg>`);
  await sharp(out, {raw: {width: W, height: H, channels: 3}}).composite([{input: svg}]).png().toFile(path.join(OUTDIR, `${key}-derived.png`));
  console.log('wrote', path.relative(REPO, path.join(OUTDIR, `${key}-derived.png`)));
}
