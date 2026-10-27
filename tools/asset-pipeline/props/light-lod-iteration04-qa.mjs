#!/usr/bin/env node
// Iteration 04 light-fixture QA without a browser: UV/chart metrics + CPU z-buffer renders (baked base colour x Lambert)
// of ceiling-fixture GLBs from the angles a player actually sees them (from below), side by side.
// Usage: node tools/asset-pipeline/props/light-lod-iteration04-qa.mjs [glb ...]
//   default: light.glb (iteration-01), light-lod.glb (iteration-03 sloppy LOD), light-lod2.glb (iteration-04 fix)
// Writes qa-artifacts/assets/light-lod-iteration04/compare.png and metrics.json only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTDIR = path.join(REPO, 'qa-artifacts/assets/light-lod-iteration04');
const MODELS = path.join(REPO, 'game/public/assets/models');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['light.glb', 'light-lod.glb', 'light-lod2.glb'].map(f => path.join(MODELS, f)).filter(f => fs.existsSync(f));
const CW = 520, CH = 220;

async function load(file) {
  const doc = await new NodeIO().read(file);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray(), I = prim.getIndices().getArray();
  const tex = prim.getMaterial().getBaseColorTexture();
  const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {P, UV, I, tex: {data, w: info.width, h: info.height}};
}

/** UV-chart health: a clean atlas has total UV area <= 1 and a narrow texel-density spread. */
export function uvMetrics(P, UV, I) {
  const nf = I.length / 3, nv = P.length / 3;
  const ratio = new Float64Array(nf), auv = new Float64Array(nf);
  let uvSum = 0, area = 0, uvMin = Infinity, uvMax = -Infinity, used = new Uint8Array(nv);
  for (let f = 0; f < nf; f++) {
    const a = I[3 * f], b = I[3 * f + 1], c = I[3 * f + 2];
    used[a] = used[b] = used[c] = 1;
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
    const a3 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    auv[f] = Math.abs((UV[2 * b] - UV[2 * a]) * (UV[2 * c + 1] - UV[2 * a + 1]) - (UV[2 * c] - UV[2 * a]) * (UV[2 * b + 1] - UV[2 * a + 1])) / 2;
    ratio[f] = auv[f] / (a3 || 1e-12); uvSum += auv[f]; area += a3;
    for (const v of [a, b, c]) for (const k of [0, 1]) { uvMin = Math.min(uvMin, UV[2 * v + k]); uvMax = Math.max(uvMax, UV[2 * v + k]); }
  }
  const med = [...ratio].sort((x, y) => x - y)[nf >> 1];
  let stretched = 0, stretchedUv = 0;
  for (let f = 0; f < nf; f++) if (ratio[f] > 8 * med) { stretched++; stretchedUv += auv[f]; }
  return {
    triangles: nf, vertices: nv, referencedVertices: used.reduce((s, x) => s + x, 0), surfaceM2: +area.toFixed(4),
    uvAreaSum: +uvSum.toFixed(4), uvRange: [+uvMin.toFixed(4), +uvMax.toFixed(4)],
    globalUvPerM2: +(uvSum / area).toFixed(4), medianUvPerM2: +med.toFixed(4),
    trianglesStretched8xMedian: stretched, stretchedUvAreaFraction: +(stretchedUv / (uvSum || 1)).toFixed(4),
  };
}

// yaw about Y then pitch about X (positive pitch = seen from above, negative = from below); camera looks along -Z.
function render(m, yawDeg, pitchDeg) {
  const cy = Math.cos(yawDeg * Math.PI / 180), sy = Math.sin(yawDeg * Math.PI / 180), cp = Math.cos(pitchDeg * Math.PI / 180), sp = Math.sin(pitchDeg * Math.PI / 180);
  const n = m.P.length / 3, V = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = m.P[3 * i], y = m.P[3 * i + 1], z = m.P[3 * i + 2];
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    V[3 * i] = x1; V[3 * i + 1] = cp * y - sp * z1; V[3 * i + 2] = sp * y + cp * z1;
  }
  const mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], V[3 * i + k]); mx[k] = Math.max(mx[k], V[3 * i + k]); }
  const sc = Math.min(CW / ((mx[0] - mn[0]) * 1.08), CH / ((mx[1] - mn[1]) * 1.15)), cx = (mn[0] + mx[0]) / 2, cyy = (mn[1] + mx[1]) / 2;
  const img = new Uint8Array(CW * CH * 3).fill(52), zb = new Float32Array(CW * CH).fill(-Infinity);
  const L = [0.3, -0.5, 0.8], ll = Math.hypot(...L);
  for (let f = 0; f < m.I.length; f += 3) {
    const a = m.I[f], b = m.I[f + 1], c = m.I[f + 2];
    const px = [a, b, c].map(v => (V[3 * v] - cx) * sc + CW / 2), py = [a, b, c].map(v => CH / 2 - (V[3 * v + 1] - cyy) * sc), pz = [a, b, c].map(v => V[3 * v + 2]);
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2], vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nz <= 0) continue;
    const shade = 0.5 + 0.5 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
    const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(CW - 1, Math.ceil(Math.max(...px))), y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(CH - 1, Math.ceil(Math.max(...py)));
    const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]); if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w0 = ((py[1] - py[2]) * (x + 0.5 - px[2]) + (px[2] - px[1]) * (y + 0.5 - py[2])) / den, w1 = ((py[2] - py[0]) * (x + 0.5 - px[2]) + (px[0] - px[2]) * (y + 0.5 - py[2])) / den, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * pz[0] + w1 * pz[1] + w2 * pz[2], k = y * CW + x; if (z <= zb[k]) continue; zb[k] = z;
      const u = w0 * m.UV[2 * a] + w1 * m.UV[2 * b] + w2 * m.UV[2 * c], v = w0 * m.UV[2 * a + 1] + w1 * m.UV[2 * b + 1] + w2 * m.UV[2 * c + 1];
      const tx = Math.min(m.tex.w - 1, Math.max(0, Math.floor(u * m.tex.w))), ty = Math.min(m.tex.h - 1, Math.max(0, Math.floor(v * m.tex.h))), t = 3 * (ty * m.tex.w + tx);
      for (let ch = 0; ch < 3; ch++) img[3 * k + ch] = Math.min(255, m.tex.data[t + ch] * shade);
    }
  }
  return img;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('light-lod-iteration04-qa.mjs')) {
  fs.mkdirSync(OUTDIR, {recursive: true});
  const VIEWS = [['front +Z', 0, 0], ['from below, 3/4 front', -25, -40], ['straight below (-Y)', 0, -90]];
  const metrics = {};
  const comps = [];
  const W = CW * VIEWS.length, H = (CH + 24) * files.length;
  const out = Buffer.alloc(W * H * 3, 30);
  for (const [r, file] of files.entries()) {
    const m = await load(file);
    metrics[path.basename(file)] = uvMetrics(m.P, m.UV, m.I);
    VIEWS.forEach(([, yaw, pitch], c) => {
      const img = render(m, yaw, pitch);
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) for (let k = 0; k < 3; k++) out[(((r * (CH + 24) + 24 + y) * W) + c * CW + x) * 3 + k] = img[(y * CW + x) * 3 + k];
    });
    const mm = metrics[path.basename(file)];
    comps.push(`<text x="8" y="${r * (CH + 24) + 17}" font-size="15" font-family="DejaVu Sans" fill="#fff">${path.basename(file)} - ${mm.triangles} tris, UV area sum ${mm.uvAreaSum}, stretched tris ${mm.trianglesStretched8xMedian} | views: ${VIEWS.map(v => v[0]).join(' / ')}</text>`);
  }
  const svg = Buffer.from(`<svg width="${W}" height="${H}">${comps.join('')}</svg>`);
  await sharp(out, {raw: {width: W, height: H, channels: 3}}).composite([{input: svg}]).png().toFile(path.join(OUTDIR, 'compare.png'));
  fs.writeFileSync(path.join(OUTDIR, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify(metrics, null, 1));
  console.log('wrote', path.relative(REPO, path.join(OUTDIR, 'compare.png')));
}
