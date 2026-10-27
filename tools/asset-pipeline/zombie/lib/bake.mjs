// Texture transfer: for each texel of the new low-poly atlas, find the closest point on the
// high-poly master surface (facing-aware) and sample the master's own textures there.
import os from 'node:os';
import {Worker} from 'node:worker_threads';
import sharp from 'sharp';
import {faceNormalsAreas} from './mesh.mjs';

function sab(typed) {
  const buf = new SharedArrayBuffer(typed.byteLength);
  const out = new typed.constructor(buf);
  out.set(typed);
  return out;
}

/** Uniform grid over high-poly triangles (CSR layout). */
export function buildGrid(pos, idx, cell) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  min = min.map(v => v - cell * 0.5); max = max.map(v => v + cell * 0.5);
  const dims = [0, 1, 2].map(k => Math.max(1, Math.ceil((max[k] - min[k]) / cell)));
  const ncell = dims[0] * dims[1] * dims[2];
  const counts = new Uint32Array(ncell + 1);
  const nt = idx.length / 3;
  const range = (t, cb) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c] * 3; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v + k]); hi[k] = Math.max(hi[k], pos[v + k]); } }
    const a = lo.map((v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - min[k]) / cell))));
    const b = hi.map((v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - min[k]) / cell))));
    for (let z = a[2]; z <= b[2]; z++) for (let y = a[1]; y <= b[1]; y++) for (let x = a[0]; x <= b[0]; x++) cb((z * dims[1] + y) * dims[0] + x);
  };
  for (let t = 0; t < nt; t++) range(t, c => counts[c + 1]++);
  for (let c = 0; c < ncell; c++) counts[c + 1] += counts[c];
  const fill = new Uint32Array(ncell);
  const tris = new Uint32Array(counts[ncell]);
  for (let t = 0; t < nt; t++) range(t, c => { tris[counts[c] + fill[c]++] = t; });
  return {min, dims, cell, start: counts, tris};
}

/** Rasterize low-poly triangles into the bake atlas: per covered texel store (x,y), 3D point and normal. */
function rasterJobs(low, size) {
  const {pos, nrm, uv, idx} = low;
  const px = [], P = [], N = [];
  const owner = new Int32Array(size * size).fill(-1);
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ax = uv[a * 2] * size, ay = uv[a * 2 + 1] * size, bx = uv[b * 2] * size, by = uv[b * 2 + 1] * size, cx = uv[c * 2] * size, cy = uv[c * 2 + 1] * size;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area;
      const w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area;
      const w2 = 1 - w0 - w1;
      const eps = -1e-4;
      if (w0 < eps || w1 < eps || w2 < eps) continue;
      const o = y * size + x;
      if (owner[o] >= 0) continue;
      owner[o] = t;
      px.push(o);
      for (let k = 0; k < 3; k++) P.push(w0 * pos[a * 3 + k] + w1 * pos[b * 3 + k] + w2 * pos[c * 3 + k]);
      let n0 = w0 * nrm[a * 3] + w1 * nrm[b * 3] + w2 * nrm[c * 3], n1 = w0 * nrm[a * 3 + 1] + w1 * nrm[b * 3 + 1] + w2 * nrm[c * 3 + 1], n2 = w0 * nrm[a * 3 + 2] + w1 * nrm[b * 3 + 2] + w2 * nrm[c * 3 + 2];
      const l = Math.hypot(n0, n1, n2) || 1; N.push(n0 / l, n1 / l, n2 / l);
    }
  }
  return {px: Uint32Array.from(px), P: Float32Array.from(P), N: Float32Array.from(N), owner};
}

/** Push-pull fill of uncovered texels so mip levels and bilinear filtering never see background. */
export function pushPullFill(rgba, mask, size) {
  const levels = [{data: new Float32Array(size * size * 4), w: new Float32Array(size * size), size}];
  for (let i = 0; i < size * size; i++) if (mask[i]) { for (let k = 0; k < 4; k++) levels[0].data[i * 4 + k] = rgba[i * 4 + k]; levels[0].w[i] = 1; }
  while (levels[levels.length - 1].size > 1) {
    const src = levels[levels.length - 1], s = src.size >> 1;
    const dst = {data: new Float32Array(s * s * 4), w: new Float32Array(s * s), size: s};
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      let wsum = 0; const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const o = (y * 2 + dy) * src.size + (x * 2 + dx);
        const w = src.w[o]; if (!w) continue;
        wsum += w; for (let k = 0; k < 4; k++) acc[k] += src.data[o * 4 + k] * w;
      }
      const o = y * s + x;
      if (wsum > 0) { for (let k = 0; k < 4; k++) dst.data[o * 4 + k] = acc[k] / wsum; dst.w[o] = 1; }
    }
    levels.push(dst);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], C = levels[l + 1];
    for (let y = 0; y < L.size; y++) for (let x = 0; x < L.size; x++) {
      const o = y * L.size + x;
      if (L.w[o]) continue;
      const co = Math.min(C.size - 1, y >> 1) * C.size + Math.min(C.size - 1, x >> 1);
      for (let k = 0; k < 4; k++) L.data[o * 4 + k] = C.data[co * 4 + k];
      L.w[o] = 1;
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(levels[0].data[i])));
  return out;
}

/**
 * @param high {pos, idx, uv} master geometry (in the same space as low)
 * @param low {pos, nrm, uv, idx} unwrapped low-poly
 * @param textures {baseColor:{data,width,height}, metallicRoughness:{...}}
 */
export async function bake(high, low, textures, {size = 2048, cell = 0.01, maxShell = 5, backfacePenalty = 0.03, cage = 0.015, rayBelow = 0.004, workers = Math.min(32, os.cpus().length)} = {}) {
  const t0 = Date.now();
  const grid = buildGrid(high.pos, high.idx, cell);
  const {FN} = faceNormalsAreas(high.pos, high.idx);
  const jobs = rasterJobs(low, size);
  const n = jobs.px.length;
  const shared = {
    hpos: sab(high.pos), hidx: sab(high.idx), huv: sab(high.uv), hfn: sab(FN),
    gstart: sab(grid.start), gtris: sab(grid.tris), gmin: grid.min, gdims: grid.dims, cell,
    base: sab(textures.baseColor.data), baseW: textures.baseColor.width, baseH: textures.baseColor.height,
    mr: sab(textures.metallicRoughness.data), mrW: textures.metallicRoughness.width, mrH: textures.metallicRoughness.height,
    jP: sab(jobs.P), jN: sab(jobs.N), jpx: sab(jobs.px),
    outBase: new Uint8Array(new SharedArrayBuffer(size * size * 4)),
    outMR: new Uint8Array(new SharedArrayBuffer(size * size * 4)),
    outDist: new Float32Array(new SharedArrayBuffer(n * 4)),
    maxShell, backfacePenalty, cage, rayBelow,
  };
  const chunk = Math.ceil(n / workers);
  const msgs = await Promise.all(Array.from({length: workers}, (_, w) => new Promise((resolve, reject) => {
    const wk = new Worker(new URL('./bake-worker.mjs', import.meta.url), {workerData: {...shared, from: w * chunk, to: Math.min(n, (w + 1) * chunk)}});
    wk.on('message', resolve); wk.on('error', reject);
    wk.on('exit', code => { if (code !== 0) reject(new Error('bake worker exit ' + code)); });
  })));
  const mask = new Uint8Array(size * size);
  let miss = 0, far = 0; const dists = [];
  const rayUsed = msgs.reduce((a, m) => a + (m?.rayUsed || 0), 0);
  for (let j = 0; j < n; j++) {
    const d = shared.outDist[j];
    if (d < 0) { miss++; continue; }
    mask[jobs.px[j]] = 1;
    if (d > 0.01) far++;
    dists.push(d);
  }
  dists.sort((a, b) => a - b);
  const base = pushPullFill(shared.outBase, mask, size);
  const mr = pushPullFill(shared.outMR, mask, size);
  return {
    base, mr, size, coverage: n / (size * size),
    stats: {texels: n, coverage: +(n / (size * size)).toFixed(3), missed: miss, farOver1cm: far,
      distMedianMm: +(dists[dists.length >> 1] * 1000).toFixed(2), distP99Mm: +(dists[Math.floor(dists.length * 0.99)] * 1000).toFixed(2),
      cageRayHits: rayUsed, cageM: cage, rayBelowM: rayBelow, method: 'closest facing-compatible point, overridden by first front-facing hit of a cage ray (P+N*cage -> -N) when within 1.2 cm of it',
      gridCells: grid.dims, ms: Date.now() - t0, workers},
  };
}

export async function encodeTextures(bk, {baseSize, mrSize, quality = 88}) {
  const raw = (data, s) => sharp(Buffer.from(data.buffer, data.byteOffset, data.length), {raw: {width: s, height: s, channels: 4}});
  const baseJpg = await raw(bk.base, bk.size).removeAlpha().resize(baseSize, baseSize, {kernel: 'lanczos3'}).jpeg({quality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const mrJpg = await raw(bk.mr, bk.size).removeAlpha().resize(mrSize, mrSize, {kernel: 'lanczos3'}).jpeg({quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const basePreview = await raw(bk.base, bk.size).removeAlpha().resize(baseSize, baseSize, {kernel: 'lanczos3'}).png().toBuffer();
  return {baseJpg, mrJpg, basePreview};
}
