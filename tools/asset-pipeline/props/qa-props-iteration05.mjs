#!/usr/bin/env node
// Iteration05 visual QA without a browser (adapted from qa-props-iteration04.mjs): CPU z-buffer rasterizer of the runtime derivative GLBs,
// ALL nodes/primitives (baked or atlas base colour x simple Lambert + emissive; untextured primitives use their baseColorFactor), and
// alpha-BLEND primitives (glass) composited over the opaque pass. For open-front cases (--stock) QA-only demo stock (coloured boxes standing
// on the interiorSurfaces recorded in the GLB extras) is added to show the items are visible through the glass; it is NOT in the GLB.
// Usage: node tools/asset-pipeline/props/qa-props-iteration05.mjs key[,key] [--stock]   Writes qa-artifacts/assets/props-iteration05/<key>-derived.png only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTDIR = path.join(REPO, 'qa-artifacts/assets/props-iteration05');
const FILES = {hotdogCart: 'hotdog-cart.glb', janitorCart: 'janitor-cart.glb', magazineRack: 'magazine-rack.glb', techDisplay: 'tech-display.glb', gunLocker: 'gun-locker.glb',
  shopCoolerOpen: 'shop-cooler-open.glb', shopDisplayOpen: 'shop-display-open.glb', shopCooler: 'shop-cooler.glb', shopDisplay: 'shop-display.glb'};
const keys = (process.argv[2] ?? 'shopCoolerOpen,shopDisplayOpen').split(',');
const STOCK = process.argv.includes('--stock');
fs.mkdirSync(OUTDIR, {recursive: true});
const CELL = Number(process.env.QA_CELL ?? 400);

async function decode(t) { if (!t) return null; const {data, info} = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, w: info.width, h: info.height}; }
async function load(file) {
  const doc = await new NodeIO().read(file), prims = [];
  let extras = {};
  for (const node of doc.getRoot().listNodes()) {
    if (Object.keys(node.getExtras() ?? {}).length) extras = {...extras, ...node.getExtras()};
    const mesh = node.getMesh(); if (!mesh) continue;
    for (const pr of mesh.listPrimitives()) {
      const m = pr.getMaterial();
      prims.push({P: pr.getAttribute('POSITION').getArray(), UV: pr.getAttribute('TEXCOORD_0')?.getArray(), I: pr.getIndices().getArray(), tex: await decode(m.getBaseColorTexture()), em: await decode(m.getEmissiveTexture()),
        emF: m.getEmissiveFactor(), factor: m.getBaseColorFactor(), blend: m.getAlphaMode() === 'BLEND', double: m.getDoubleSided(), name: node.getName()});
    }
  }
  return {prims, extras};
}
// demo stock: rows of boxes (bottle-ish 6x6 cm, 18-24 cm tall, clipped to the clear height) on each surface
function stockPrims(surfaces) {
  const P = [], I = [], C = []; let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const cols = [[200, 40, 40], [40, 120, 200], [230, 190, 40], [40, 160, 70], [235, 235, 235], [120, 60, 160], [240, 120, 30]];
  for (const sf of surfaces) {
    const hMax = Math.min(0.24, sf.clearM - 0.02);
    for (let x = sf.x0 + 0.04; x < sf.x1 - 0.03; x += 0.075) for (const z of [sf.z1 - 0.06, (sf.z0 + sf.z1) / 2]) {
      if (rnd() < 0.25) continue;
      const h = hMax * (0.6 + 0.4 * rnd()), w = 0.03, c = cols[Math.floor(rnd() * cols.length)];
      const b = P.length / 3, x0 = x - w, x1 = x + w, z0 = z - w, z1 = z + w, y0 = sf.y, y1 = sf.y + h;
      const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      v.forEach(p => { P.push(...p); C.push(c); });
      for (const f of [[4, 5, 6, 4, 6, 7], [1, 0, 3, 1, 3, 2], [5, 1, 2, 5, 2, 6], [0, 4, 7, 0, 7, 3], [3, 7, 6, 3, 6, 2], [0, 1, 5, 0, 5, 4]]) I.push(...f.map(k => b + k));
    }
  }
  return {P: Float32Array.from(P), I: Uint32Array.from(I), vcol: C, name: 'QA-demo-stock'};
}
function render(prims, yawDeg, pitchDeg, label, frame) {
  const cy = Math.cos(yawDeg * Math.PI / 180), sy = Math.sin(yawDeg * Math.PI / 180), cp = Math.cos(pitchDeg * Math.PI / 180), sp = Math.sin(pitchDeg * Math.PI / 180);
  const xf = (x, y, z) => { const x1 = cy * x + sy * z, z1 = -sy * x + cy * z; return [x1, cp * y - sp * z1, sp * y + cp * z1]; };
  let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (const p of frame) for (let i = 0; i < p.P.length; i += 3) { const v = xf(p.P[i], p.P[i + 1], p.P[i + 2]); for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } }
  const span = Math.max(mx[0] - mn[0], mx[1] - mn[1]) * 1.1, sc = CELL / span, cx = (mn[0] + mx[0]) / 2, cyy = (mn[1] + mx[1]) / 2;
  const img = new Float32Array(CELL * CELL * 3).fill(60), zb = new Float32Array(CELL * CELL).fill(-Infinity);
  const L = [0.35, 0.6, 0.72], ll = Math.hypot(...L);
  const raster = (p, pass) => {
    const n = p.P.length / 3, V = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) V.set(xf(p.P[3 * i], p.P[3 * i + 1], p.P[3 * i + 2]), 3 * i);
    for (let f = 0; f < p.I.length; f += 3) {
      const a = p.I[f], b = p.I[f + 1], c = p.I[f + 2];
      const px = [a, b, c].map(v => (V[3 * v] - cx) * sc + CELL / 2), py = [a, b, c].map(v => CELL / 2 - (V[3 * v + 1] - cyy) * sc), pz = [a, b, c].map(v => V[3 * v + 2]);
      const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2], vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (nz <= 0 && !p.double) continue;
      const shade = 0.4 + 0.6 * Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / ll);
      const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(CELL - 1, Math.ceil(Math.max(...px))), y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(CELL - 1, Math.ceil(Math.max(...py)));
      const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]); if (Math.abs(den) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w0 = ((py[1] - py[2]) * (x + 0.5 - px[2]) + (px[2] - px[1]) * (y + 0.5 - py[2])) / den, w1 = ((py[2] - py[0]) * (x + 0.5 - px[2]) + (px[0] - px[2]) * (y + 0.5 - py[2])) / den, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * pz[0] + w1 * pz[1] + w2 * pz[2], k = y * CELL + x; if (z <= zb[k]) continue;
        let col = [255, 255, 255], em = [0, 0, 0];
        if (p.vcol) col = p.vcol[a];
        else if (p.tex && p.UV) {
          const u = w0 * p.UV[2 * a] + w1 * p.UV[2 * b] + w2 * p.UV[2 * c], v = w0 * p.UV[2 * a + 1] + w1 * p.UV[2 * b + 1] + w2 * p.UV[2 * c + 1];
          const tx = Math.min(p.tex.w - 1, Math.max(0, Math.floor(u * p.tex.w))), ty = Math.min(p.tex.h - 1, Math.max(0, Math.floor(v * p.tex.h))), t = 3 * (ty * p.tex.w + tx);
          col = [p.tex.data[t], p.tex.data[t + 1], p.tex.data[t + 2]];
          if (p.em) { const e = 3 * (ty * p.em.w + tx); em = [0, 1, 2].map(ch => p.em.data[e + ch] * p.emF[ch]); }
        } else col = p.factor.slice(0, 3).map(v => v * 255);
        if (pass === 'opaque') { zb[k] = z; for (let ch = 0; ch < 3; ch++) img[3 * k + ch] = Math.min(255, col[ch] * shade + em[ch]); }
        else { const al = p.factor[3]; for (let ch = 0; ch < 3; ch++) img[3 * k + ch] = img[3 * k + ch] * (1 - al) + Math.min(255, col[ch] * shade + 60) * al; }
      }
    }
  };
  for (const p of prims) if (!p.blend) raster(p, 'opaque');
  for (const p of prims) if (p.blend) raster(p, 'blend');
  return {img: Uint8Array.from(img), label};
}
for (const key of keys) {
  const NATIVE = process.argv.includes('--native');   // raw native working copy (.cache/iteration05-native-masters/<key>/asset.glb), source frame
  const file = NATIVE ? path.join(REPO, '.cache/iteration05-native-masters', key, 'asset.glb') : path.join(REPO, 'game/public/assets/models', FILES[key]);
  if (NATIVE && fs.existsSync(file)) {
    const {prims} = await load(file);
    const v = [render(prims, 180, 0, 'native from source -Z (camera side)', prims), render(prims, 90, 0, 'native from source -X', prims), render(prims, 0, 0, 'native from source +Z (back)', prims), render(prims, 180, 60, 'native from above-front', prims)];
    const W = CELL * 4, out = Buffer.alloc(W * CELL * 3);
    v.forEach((r, i) => { for (let y = 0; y < CELL; y++) r.img.subarray(y * CELL * 3, (y + 1) * CELL * 3).forEach((b, j) => { out[(y * W + i * CELL) * 3 + j] = b; }); });
    const svg = Buffer.from(`<svg width="${W}" height="${CELL}">${v.map((r, i) => `<text x="${i * CELL + 8}" y="20" font-size="15" font-family="sans-serif" fill="#ff6">${key}: ${r.label}</text>`).join('')}</svg>`);
    await sharp(out, {raw: {width: W, height: CELL, channels: 3}}).composite([{input: svg}]).png().toFile(path.join(OUTDIR, `${key}-native.png`)); console.log('wrote native', key); continue;
  }
  if (!fs.existsSync(file)) { console.log(key, 'missing'); continue; }
  const {prims, extras} = await load(file);
  const all = STOCK && extras.interiorSurfaces ? [...prims, stockPrims(extras.interiorSurfaces)] : prims;
  const views = [render(all, 0, 0, 'front +Z', prims), render(all, -90, 0, 'right side +X', prims), render(all, 0, 90, 'top (+Z down)', prims),
    render(all, -35, 12, '3/4 front-right', prims), render(all, 145, 25, '3/4 back-left', prims), render(all, 30, -8, '3/4 front-left low', prims)];
  const W = CELL * 3, H = CELL * 2, out = Buffer.alloc(W * H * 3);
  views.forEach((v, i) => { const ox = (i % 3) * CELL, oy = Math.floor(i / 3) * CELL; for (let y = 0; y < CELL; y++) v.img.subarray(y * CELL * 3, (y + 1) * CELL * 3).forEach((b, j) => { out[((oy + y) * W + ox) * 3 + j] = b; }); });
  const svg = Buffer.from(`<svg width="${W}" height="${H}">${views.map((v, i) => `<text x="${(i % 3) * CELL + 8}" y="${Math.floor(i / 3) * CELL + 20}" font-size="15" font-family="sans-serif" fill="#ff6">${key}: ${v.label}${STOCK && extras.interiorSurfaces ? ' (+QA demo stock)' : ''}</text>`).join('')}</svg>`);
  const name = `${key}-derived${STOCK && extras.interiorSurfaces ? '-stock' : ''}.png`;
  await sharp(out, {raw: {width: W, height: H, channels: 3}}).composite([{input: svg}]).png().toFile(path.join(OUTDIR, name));
  console.log('wrote', path.relative(REPO, path.join(OUTDIR, name)));
}
