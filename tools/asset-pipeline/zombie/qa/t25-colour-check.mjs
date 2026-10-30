#!/usr/bin/env node
// Meshy T2.5 migration (lane CHARS): colour check of every T2.5 body / wearable stage against its ORIGINAL reference image
// (read-only; reads the newest cached stage per id from /tmp/ll-zombie-variants/cache). Reports the albedo's mean linear
// RGB over UV-covered texels vs the reference's alpha-masked pixels, and the chromaticity (G/R, B/R) deviation that a
// wardrobe.config.mjs `grade: {mode: 'reference-chroma'}` would correct.
//   node tools/asset-pipeline/zombie/qa/t25-colour-check.mjs [--threshold=0.08]
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import sharp from 'sharp';
import {REPO} from '../lib/master.mjs';
import {T25} from '../wardrobe.config.mjs';
import {deliveredIndex} from '../lib/t25.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const TH = +(args.threshold ?? 0.08);
const CACHE = '/tmp/ll-zombie-variants/cache';
const toLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const files = fs.readdirSync(CACHE).map(f => ({f, t: fs.statSync(path.join(CACHE, f)).mtimeMs}));
const newest = prefix => files.filter(x => x.f.startsWith(prefix)).sort((a, b) => b.t - a.t)[0]?.f;
async function albedo(st) {
  const src = st.enc.basePreview ?? st.enc.baseJpg;
  const {data, info} = await sharp(Buffer.from(src)).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const S = info.width, uv = st.low.uv, idx = st.low.idx, mask = new Uint8Array(S * S);
  for (let t = 0; t < idx.length; t += 3) {
    const p = [0, 1, 2].map(k => [uv[idx[t + k] * 2] * S, uv[idx[t + k] * 2 + 1] * S]);
    const [a, b, c] = p, area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))); y <= Math.min(S - 1, Math.ceil(Math.max(a[1], b[1], c[1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))); x <= Math.min(S - 1, Math.ceil(Math.max(a[0], b[0], c[0]))); x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const w0 = ((b[0] - qx) * (c[1] - qy) - (c[0] - qx) * (b[1] - qy)) / area, w1 = ((c[0] - qx) * (a[1] - qy) - (a[0] - qx) * (c[1] - qy)) / area;
        if (w0 >= 0 && w1 >= 0 && 1 - w0 - w1 >= 0) mask[y * S + x] = 1;
      }
  }
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i < S * S; i++) if (mask[i]) { for (let c = 0; c < 3; c++) s[c] += toLin(data[i * 3 + c]); n++; }
  return s.map(v => v / n);
}
async function reference(file) {
  const {data} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i < data.length; i += 4) { if (data[i + 3] < 200 || data[i] + data[i + 1] + data[i + 2] < 60) continue; for (let c = 0; c < 3; c++) s[c] += toLin(data[i + c]); n++; }
  return s.map(v => v / n);
}
const D = deliveredIndex().assets;
const rows = [];
for (const [id, pin] of Object.entries(T25)) {
  const kind = pin.asset.startsWith('body:') ? 'body' : null;
  const f = kind ? newest(`body-${id}-`) : newest(`garment-${id}-`) ?? newest(`pants-${id}-`) ?? newest(`rigid-${id}-`);
  if (!f) { rows.push({id, error: 'no cached stage'}); continue; }
  const st = v8.deserialize(fs.readFileSync(path.join(CACHE, f)));
  const A = await albedo(st), R = await reference(D[pin.asset].inputImage);
  const r = m => [m[1] / m[0], m[2] / m[0]];
  const [ag, ab] = r(A), [rg, rb] = r(R);
  const dev = Math.max(Math.abs(ag / rg - 1), Math.abs(ab / rb - 1));
  const luma = m => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  rows.push({id, stage: f, albedoLin: A.map(v => +v.toFixed(4)), referenceLin: R.map(v => +v.toFixed(4)), albedoGR_BR: [+ag.toFixed(3), +ab.toFixed(3)], referenceGR_BR: [+rg.toFixed(3), +rb.toFixed(3)],
    chromaDeviation: +dev.toFixed(3), lumaRatio: +(luma(A) / luma(R)).toFixed(3), graded: !!pin.grade, flag: dev > TH ? 'CHROMA' : ''});
}
for (const r of rows) console.log(JSON.stringify(r));
