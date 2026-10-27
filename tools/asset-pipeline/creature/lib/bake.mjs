// Texture transfer master -> creature low-poly atlas: base colour + metallic-roughness (same
// closest-facing-point / cage-ray method as tools/asset-pipeline/zombie/lib/bake.mjs, whose grid
// and push-pull helpers are reused) PLUS a tangent-space NORMAL map from the master's own vertex
// normals.
//
// Normal-map convention = what three.js r186 does for a glTF without TANGENT attributes
// (GLTFLoader 'derivative tangents': normalScale.y = -1; shader getTangentFrame()): the per-pixel
// frame is the cotangent frame T ∝ ∇u, B ∝ ∇v (surface gradients of the UVs, projected
// perpendicular to the interpolated normal N, common scale 1/max(|T|,|B|)), and
//   n = normalize(T·x − B·y + N·z),  (x, y, z) = rgb·2 − 1.
// The bake solves that 3x3 system per texel for the master normal n_h (so it decodes back to n_h).
import os from 'node:os';
import {Worker} from 'node:worker_threads';
import sharp from 'sharp';
import {faceNormalsAreas} from '../../zombie/lib/mesh.mjs';
import {buildGrid, pushPullFill} from '../../zombie/lib/bake.mjs';

function sab(typed) {
  const buf = new SharedArrayBuffer(typed.byteLength);
  const out = new typed.constructor(buf);
  out.set(typed);
  return out;
}

/** Per low triangle: surface gradients of u and v (3D vectors in the triangle plane). */
function uvGradients(pos, uv, idx) {
  const nt = idx.length / 3, G = new Float32Array(nt * 6);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
    const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
    if (nn < 1e-20) continue;
    // dual basis: A·e1 = 1, A·e2 = 0 ; Bv·e1 = 0, Bv·e2 = 1 (in the plane)
    const A = [(e2[1] * n[2] - e2[2] * n[1]) / nn, (e2[2] * n[0] - e2[0] * n[2]) / nn, (e2[0] * n[1] - e2[1] * n[0]) / nn];
    const Bv = [(n[1] * e1[2] - n[2] * e1[1]) / nn, (n[2] * e1[0] - n[0] * e1[2]) / nn, (n[0] * e1[1] - n[1] * e1[0]) / nn];
    const du1 = uv[b * 2] - uv[a * 2], du2 = uv[c * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1], dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
    for (let k = 0; k < 3; k++) { G[t * 6 + k] = du1 * A[k] + du2 * Bv[k]; G[t * 6 + 3 + k] = dv1 * A[k] + dv2 * Bv[k]; }
  }
  return G;
}

/** Rasterize low-poly triangles into the atlas: per covered texel (x,y), 3D point, normal and cotangent frame. */
function rasterJobs(low, size) {
  const {pos, nrm, uv, idx} = low;
  const G = uvGradients(pos, uv, idx);
  const px = [], P = [], N = [], TB = [];
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
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const o = y * size + x;
      if (owner[o] >= 0) continue;
      owner[o] = t;
      px.push(o);
      for (let k = 0; k < 3; k++) P.push(w0 * pos[a * 3 + k] + w1 * pos[b * 3 + k] + w2 * pos[c * 3 + k]);
      let n0 = w0 * nrm[a * 3] + w1 * nrm[b * 3] + w2 * nrm[c * 3], n1 = w0 * nrm[a * 3 + 1] + w1 * nrm[b * 3 + 1] + w2 * nrm[c * 3 + 1], n2 = w0 * nrm[a * 3 + 2] + w1 * nrm[b * 3 + 2] + w2 * nrm[c * 3 + 2];
      const l = Math.hypot(n0, n1, n2) || 1; n0 /= l; n1 /= l; n2 /= l;
      N.push(n0, n1, n2);
      // cotangent frame: gradients projected perpendicular to N, common scale
      const gu = [G[t * 6], G[t * 6 + 1], G[t * 6 + 2]], gv = [G[t * 6 + 3], G[t * 6 + 4], G[t * 6 + 5]];
      const du = gu[0] * n0 + gu[1] * n1 + gu[2] * n2, dv = gv[0] * n0 + gv[1] * n1 + gv[2] * n2;
      const T = [gu[0] - n0 * du, gu[1] - n1 * du, gu[2] - n2 * du], B = [gv[0] - n0 * dv, gv[1] - n1 * dv, gv[2] - n2 * dv];
      const s = 1 / (Math.sqrt(Math.max(T[0] ** 2 + T[1] ** 2 + T[2] ** 2, B[0] ** 2 + B[1] ** 2 + B[2] ** 2)) || 1);
      TB.push(T[0] * s, T[1] * s, T[2] * s, B[0] * s, B[1] * s, B[2] * s);
    }
  }
  return {px: Uint32Array.from(px), P: Float32Array.from(P), N: Float32Array.from(N), TB: Float32Array.from(TB), owner};
}

/**
 * @param high {pos, nrm, idx, uv} master geometry (placed, same space as low)
 * @param low {pos, nrm, uv, idx}
 * @param textures {baseColor, metallicRoughness} decoded RGBA
 */
export async function bakeAll(high, low, textures, {size = 2048, cell = 0.01, maxShell = 5, backfacePenalty = 0.03, cage = 0.012, rayBelow = 0.004, normalBlend = 0.8, workers = Math.min(32, os.cpus().length)} = {}) {
  const t0 = Date.now();
  const grid = buildGrid(high.pos, high.idx, cell);
  const {FN} = faceNormalsAreas(high.pos, high.idx);
  const jobs = rasterJobs(low, size);
  const n = jobs.px.length;
  const shared = {
    hpos: sab(high.pos), hidx: sab(high.idx), huv: sab(high.uv), hfn: sab(FN), hnrm: sab(high.nrm),
    gstart: sab(grid.start), gtris: sab(grid.tris), gmin: grid.min, gdims: grid.dims, cell,
    base: sab(textures.baseColor.data), baseW: textures.baseColor.width, baseH: textures.baseColor.height,
    mr: sab(textures.metallicRoughness.data), mrW: textures.metallicRoughness.width, mrH: textures.metallicRoughness.height,
    jP: sab(jobs.P), jN: sab(jobs.N), jTB: sab(jobs.TB), jpx: sab(jobs.px),
    outBase: new Uint8Array(new SharedArrayBuffer(size * size * 4)),
    outMR: new Uint8Array(new SharedArrayBuffer(size * size * 4)),
    outNrm: new Uint8Array(new SharedArrayBuffer(size * size * 4)),
    outDist: new Float32Array(new SharedArrayBuffer(n * 4)),
    outDev: new Float32Array(new SharedArrayBuffer(n * 4)),
    maxShell, backfacePenalty, cage, rayBelow, normalBlend,
  };
  const chunk = Math.ceil(n / workers);
  const msgs = await Promise.all(Array.from({length: workers}, (_, w) => new Promise((resolve, reject) => {
    const wk = new Worker(new URL('./bake-worker.mjs', import.meta.url), {workerData: {...shared, from: w * chunk, to: Math.min(n, (w + 1) * chunk)}});
    wk.on('message', resolve); wk.on('error', reject);
    wk.on('exit', code => { if (code !== 0) reject(new Error('bake worker exit ' + code)); });
  })));
  const mask = new Uint8Array(size * size);
  let miss = 0, far = 0; const dists = [], devs = [];
  const rayUsed = msgs.reduce((a, m) => a + (m?.rayUsed || 0), 0);
  for (let j = 0; j < n; j++) {
    const d = shared.outDist[j];
    if (d < 0) { miss++; continue; }
    mask[jobs.px[j]] = 1;
    if (d > 0.01) far++;
    dists.push(d); devs.push(shared.outDev[j]);
  }
  dists.sort((a, b) => a - b); devs.sort((a, b) => a - b);
  const base = pushPullFill(shared.outBase, mask, size);
  const mr = pushPullFill(shared.outMR, mask, size);
  // uncovered texels of the normal map: flat (0.5, 0.5, 1)
  const nrmFlat = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    if (mask[i]) nrmFlat.set(shared.outNrm.subarray(i * 4, i * 4 + 4), i * 4); else nrmFlat.set([128, 128, 255, 255], i * 4);
  }
  const nrm = pushPullFill(nrmFlat, mask, size);
  return {
    base, mr, nrm, size, coverage: n / (size * size),
    stats: {texels: n, coverage: +(n / (size * size)).toFixed(3), missed: miss, farOver1cm: far,
      distMedianMm: +(dists[dists.length >> 1] * 1000).toFixed(2), distP99Mm: +(dists[Math.floor(dists.length * 0.99)] * 1000).toFixed(2),
      normalDeviationDeg: {median: +devs[devs.length >> 1].toFixed(1), p90: +devs[Math.floor(devs.length * 0.9)].toFixed(1)},
      cageRayHits: rayUsed, cageM: cage, rayBelowM: rayBelow, normalBlend,
      method: 'closest facing-compatible master point, overridden by the first front-facing hit of a cage ray (P+N*cage -> -N); colour/MR sampled from the master textures there; normal = master vertex normals interpolated there, blended with the low normal (normalBlend), encoded in the three.js derivative-tangent (cotangent) frame',
      gridCells: grid.dims, ms: Date.now() - t0, workers},
  };
}

export async function encodeAll(bk, {baseSize, mrSize, nrmSize, quality = 90}) {
  const raw = (data, s) => sharp(Buffer.from(data.buffer, data.byteOffset, data.length), {raw: {width: s, height: s, channels: 4}});
  const baseJpg = await raw(bk.base, bk.size).removeAlpha().resize(baseSize, baseSize, {kernel: 'lanczos3'}).jpeg({quality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const mrJpg = await raw(bk.mr, bk.size).removeAlpha().resize(mrSize, mrSize, {kernel: 'lanczos3'}).jpeg({quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  // normals: box-filter down (lanczos ringing would bend normals), then renormalise per texel
  const small = await raw(bk.nrm, bk.size).removeAlpha().resize(nrmSize, nrmSize, {kernel: 'cubic'}).raw().toBuffer();
  for (let i = 0; i < small.length; i += 3) {
    const v = [small[i] / 127.5 - 1, small[i + 1] / 127.5 - 1, small[i + 2] / 127.5 - 1];
    const m = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])) || 1;
    for (let k = 0; k < 3; k++) small[i + k] = Math.round((v[k] / m * 0.5 + 0.5) * 255);
  }
  const nrmJpg = await sharp(small, {raw: {width: nrmSize, height: nrmSize, channels: 3}}).jpeg({quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const basePreview = await raw(bk.base, bk.size).removeAlpha().resize(baseSize, baseSize, {kernel: 'lanczos3'}).png().toBuffer();
  const nrmPreview = await sharp(small, {raw: {width: nrmSize, height: nrmSize, channels: 3}}).png().toBuffer();
  return {baseJpg, mrJpg, nrmJpg, basePreview, nrmPreview};
}
