// Bake dense-source appearance onto a simplified, re-unwrapped mesh.
// Output: base colour (atlas px), packed metallic-roughness (R=255 unused/occlusion-neutral,
// G=roughness, B=metalness) and a tangent-space normal map encoded for three.js' derivative
// tangent frame as loaded by GLTFLoader (+Y = image up, glTF convention).
import os from 'node:os';
import {Worker} from 'node:worker_threads';

const shared = (Ctor, n) => new Ctor(new SharedArrayBuffer(Ctor.BYTES_PER_ELEMENT * Math.max(1, n)));
const toShared = arr => { const s = shared(arr.constructor, arr.length); s.set(arr); return s; };

export function buildGrid(P, I, pad) {
  const nf = I.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], P[i + c]); max[c] = Math.max(max[c], P[i + c]); }
  for (let c = 0; c < 3; c++) { min[c] -= pad; max[c] += pad; }
  let edgeSum = 0; const step = Math.max(1, Math.floor(nf / 50000)); let cnt = 0;
  for (let f = 0; f < nf; f += step) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1];
    edgeSum += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); cnt++;
  }
  const meanEdge = edgeSum / cnt;
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const h = Math.max(2.5 * meanEdge, Math.cbrt(ext[0] * ext[1] * ext[2] / 6e6));
  const dims = ext.map(e => Math.max(1, Math.ceil(e / h)));
  const ncell = dims[0] * dims[1] * dims[2];
  const counts = new Uint32Array(ncell + 1);
  const range = (f, cb) => {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) { const v = 3 * I[3 * f + k]; for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[v + c]); hi[c] = Math.max(hi[c], P[v + c]); } }
    const a = lo.map((v, c) => Math.min(dims[c] - 1, Math.max(0, Math.floor((v - min[c]) / h))));
    const b = hi.map((v, c) => Math.min(dims[c] - 1, Math.max(0, Math.floor((v - min[c]) / h))));
    for (let z = a[2]; z <= b[2]; z++) for (let y = a[1]; y <= b[1]; y++) for (let x = a[0]; x <= b[0]; x++) cb((z * dims[1] + y) * dims[0] + x);
  };
  for (let f = 0; f < nf; f++) range(f, c => counts[c + 1]++);
  for (let c = 0; c < ncell; c++) counts[c + 1] += counts[c];
  const cellStart = shared(Uint32Array, ncell + 1); cellStart.set(counts);
  const fill = Uint32Array.from(counts.subarray(0, ncell));
  const cellTris = shared(Uint32Array, counts[ncell]);
  for (let f = 0; f < nf; f++) range(f, c => { cellTris[fill[c]++] = f; });
  return {origin: min, h, dims, cellStart, cellTris, meanEdge, refs: counts[ncell]};
}

function faceNormals(P, I) {
  const nf = I.length / 3, FN = shared(Float32Array, nf * 3);
  for (let f = 0; f < nf; f++) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    FN[3 * f] = x / l; FN[3 * f + 1] = y / l; FN[3 * f + 2] = z / l;
  }
  return FN;
}

// 2D closest point on triangle (pixel space) -> barycentrics + squared distance
function closest2(px, py, ax, ay, bx, by, cx, cy) {
  const abx = bx - ax, aby = by - ay, acx = cx - ax, acy = cy - ay, apx = px - ax, apy = py - ay;
  const d1 = abx * apx + aby * apy, d2 = acx * apx + acy * apy;
  let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; } else {
    const bpx = px - bx, bpy = py - by, d3 = abx * bpx + aby * bpy, d4 = acx * bpx + acy * bpy;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0; } else {
        const cpx = px - cx, cpy = py - cy, d5 = abx * cpx + aby * cpy, d6 = acx * cpx + acy * cpy;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t; } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - t; w = t; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
          }
        }
      }
    }
  }
  const qx = ax + abx * v + acx * w - px, qy = ay + aby * v + acy * w - py;
  return [u, v, w, qx * qx + qy * qy];
}

// Rasterize low-poly UV triangles at R x R. Inside pass (pixel centres), then a skirt pass for
// pixels within `skirt` px of a triangle (closest-point barycentrics).
function rasterize(low, R, skirt) {
  const {pos, nrm, uv, idx} = low;
  const nf = idx.length / 3;
  const owner = new Int32Array(R * R).fill(-1);
  const bary = new Float32Array(R * R * 2);
  let overlapInterior = 0;
  for (let f = 0; f < nf; f++) {
    const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
    const ax = uv[2 * a] * R, ay = uv[2 * a + 1] * R, bx = uv[2 * b] * R, by = uv[2 * b + 1] * R, cx = uv[2 * c] * R, cy = uv[2 * c + 1] * R;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(R - 1, Math.ceil(Math.max(ax, bx, cx) + 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(R - 1, Math.ceil(Math.max(ay, by, cy) + 0.5));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
      const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      const p = y * R + x;
      if (owner[p] >= 0) { if (w0 > 0.02 && w1 > 0.02 && w2 > 0.02) overlapInterior++; continue; }
      owner[p] = f; bary[2 * p] = w1; bary[2 * p + 1] = w2;
    }
  }
  const inside = owner.reduce((s, o) => s + (o >= 0 ? 1 : 0), 0);
  // skirt
  const skirtD = new Float32Array(R * R).fill(Infinity);
  const skirtOwner = new Int32Array(R * R).fill(-1);
  const skirtBary = new Float32Array(R * R * 2);
  const S2 = skirt * skirt;
  for (let f = 0; f < nf; f++) {
    const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
    const ax = uv[2 * a] * R, ay = uv[2 * a + 1] * R, bx = uv[2 * b] * R, by = uv[2 * b + 1] * R, cx = uv[2 * c] * R, cy = uv[2 * c + 1] * R;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - skirt - 1)), x1 = Math.min(R - 1, Math.ceil(Math.max(ax, bx, cx) + skirt + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - skirt - 1)), y1 = Math.min(R - 1, Math.ceil(Math.max(ay, by, cy) + skirt + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * R + x;
      if (owner[p] >= 0) continue;
      const [u, v, w, d2] = closest2(x + 0.5, y + 0.5, ax, ay, bx, by, cx, cy);
      if (d2 <= S2 && d2 < skirtD[p]) { skirtD[p] = d2; skirtOwner[p] = f; skirtBary[2 * p] = v; skirtBary[2 * p + 1] = w; }
    }
  }
  let skirtCount = 0;
  for (let p = 0; p < R * R; p++) if (owner[p] < 0 && skirtOwner[p] >= 0) { owner[p] = skirtOwner[p]; bary[2 * p] = skirtBary[2 * p]; bary[2 * p + 1] = skirtBary[2 * p + 1]; skirtCount++; }
  return {owner, bary, inside, skirtCount, overlapInterior};
}

// Per-face surface gradients of u and v (three.js derivative tangent frame is built from these).
function faceGradients(low) {
  const {pos, uv, idx} = low;
  const nf = idx.length / 3;
  const G = new Float64Array(nf * 9); // Gu(3), Gv(3), Nf(3)
  for (let f = 0; f < nf; f++) {
    const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
    const e1 = [pos[3 * b] - pos[3 * a], pos[3 * b + 1] - pos[3 * a + 1], pos[3 * b + 2] - pos[3 * a + 2]];
    const e2 = [pos[3 * c] - pos[3 * a], pos[3 * c + 1] - pos[3 * a + 1], pos[3 * c + 2] - pos[3 * a + 2]];
    const du1 = uv[2 * b] - uv[2 * a], dv1 = uv[2 * b + 1] - uv[2 * a + 1], du2 = uv[2 * c] - uv[2 * a], dv2 = uv[2 * c + 1] - uv[2 * a + 1];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-20) continue;
    const T = [0, 1, 2].map(k => (e1[k] * dv2 - e2[k] * dv1) / det); // dP/du
    const B = [0, 1, 2].map(k => (e2[k] * du1 - e1[k] * du2) / det); // dP/dv
    const cr = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const Nf = [nx, ny, nz];
    const TB = cr(T, B); const s = TB[0] * nx + TB[1] * ny + TB[2] * nz;
    if (Math.abs(s) < 1e-30) continue;
    const Gu = cr(B, Nf).map(x => x / s), Gv = cr(Nf, T).map(x => x / s);
    G.set([...Gu, ...Gv, ...Nf], 9 * f);
  }
  return G;
}

// Encode dense normal n into the tangent-space vector that three's getTangentFrame + GLTFLoader
// (normalScale.y = -1) decodes back to n for a pixel with interpolated normal N on face f.
function encodeNormal(G, f, N, n, out, o) {
  const g = 9 * f;
  const Gu = [G[g], G[g + 1], G[g + 2]], Gv = [G[g + 3], G[g + 4], G[g + 5]], Nf = [G[g + 6], G[g + 7], G[g + 8]];
  const NdNf = N[0] * Nf[0] + N[1] * Nf[1] + N[2] * Nf[2];
  const NdGu = N[0] * Gu[0] + N[1] * Gu[1] + N[2] * Gu[2], NdGv = N[0] * Gv[0] + N[1] * Gv[1] + N[2] * Gv[2];
  const T = [0, 1, 2].map(k => Gu[k] * NdNf - Nf[k] * NdGu), B = [0, 1, 2].map(k => Gv[k] * NdNf - Nf[k] * NdGv);
  const m = Math.max(T[0] ** 2 + T[1] ** 2 + T[2] ** 2, B[0] ** 2 + B[1] ** 2 + B[2] ** 2);
  let x = 0, y = 0, z = 1;
  if (m > 0) {
    const sc = 1 / Math.sqrt(m);
    for (let k = 0; k < 3; k++) { T[k] *= sc; B[k] *= sc; }
    const cr = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const dt = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const BxN = cr(B, N), D = dt(T, BxN);
    if (Math.abs(D) > 1e-12) {
      const a = dt(n, BxN) / D, b = dt(T, cr(n, N)) / D, c = dt(T, cr(B, n)) / D;
      x = a; y = -b; z = Math.max(c, 0.05);
    }
  }
  const l = Math.hypot(x, y, z);
  out[o] = Math.round((x / l * 0.5 + 0.5) * 255); out[o + 1] = Math.round((y / l * 0.5 + 0.5) * 255); out[o + 2] = Math.round((z / l * 0.5 + 0.5) * 255);
}

// Frontier dilation of 3-channel images sharing a coverage mask.
export function dilate(mask, imgs, R, iterations) {
  const stamp = new Uint32Array(R * R);
  let frontier = [];
  let epoch = 1;
  for (let p = 0; p < R * R; p++) {
    if (mask[p]) continue;
    const x = p % R, y = (p / R) | 0;
    let ok = false;
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < R && Y < R && mask[Y * R + X]) { ok = true; break; }
    }
    if (ok) frontier.push(p);
  }
  for (let it = 0; it < iterations && frontier.length; it++) {
    const done = [];
    for (const p of frontier) {
      const x = p % R, y = (p / R) | 0;
      const acc = imgs.map(() => [0, 0, 0]); let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= R || Y >= R) continue;
        const q = Y * R + X; if (!mask[q]) continue;
        n++; imgs.forEach((im, i) => { acc[i][0] += im[3 * q]; acc[i][1] += im[3 * q + 1]; acc[i][2] += im[3 * q + 2]; });
      }
      if (!n) continue;
      imgs.forEach((im, i) => { im[3 * p] = Math.round(acc[i][0] / n); im[3 * p + 1] = Math.round(acc[i][1] / n); im[3 * p + 2] = Math.round(acc[i][2] / n); });
      done.push(p);
    }
    for (const p of done) mask[p] = 1;
    epoch++;
    const next = [];
    for (const p of done) {
      const x = p % R, y = (p / R) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= R || Y >= R) continue;
        const q = Y * R + X;
        if (!mask[q] && stamp[q] !== epoch) { stamp[q] = epoch; next.push(q); }
      }
    }
    next.sort((a, b) => a - b);
    frontier = next;
  }
}

export function fillRemaining(mask, img, R, value) {
  for (let p = 0; p < R * R; p++) if (!mask[p]) { img[3 * p] = value[0]; img[3 * p + 1] = value[1]; img[3 * p + 2] = value[2]; }
}

export function downsample(img, R, f, isNormal = false) {
  const r = R / f, out = new Uint8Array(r * r * 3);
  for (let y = 0; y < r; y++) for (let x = 0; x < r; x++) {
    let a = 0, b = 0, c = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const p = 3 * ((y * f + j) * R + x * f + i);
      if (isNormal) { a += img[p] / 127.5 - 1; b += img[p + 1] / 127.5 - 1; c += img[p + 2] / 127.5 - 1; }
      else { a += img[p]; b += img[p + 1]; c += img[p + 2]; }
    }
    const o = 3 * (y * r + x);
    if (isNormal) {
      const l = Math.hypot(a, b, c) || 1;
      out[o] = Math.round((a / l * 0.5 + 0.5) * 255); out[o + 1] = Math.round((b / l * 0.5 + 0.5) * 255); out[o + 2] = Math.round((c / l * 0.5 + 0.5) * 255);
    } else { out[o] = Math.round(a / (f * f)); out[o + 1] = Math.round(b / (f * f)); out[o + 2] = Math.round(c / (f * f)); }
  }
  return out;
}

export async function bake(dense, low, opts) {
  const {atlas, supersample = 2, mrDiv = 2, normalDiv = 2, searchRadius, workers = Math.max(2, Math.min(16, os.cpus().length - 4)), log = () => {}} = opts;
  const R = atlas * supersample;
  const t0 = Date.now();
  const P = toShared(dense.P), Nn = toShared(dense.N), UVd = toShared(dense.UV), Id = toShared(dense.I);
  const FN = faceNormals(dense.P, dense.I);
  const grid = buildGrid(dense.P, dense.I, searchRadius * 1.05);
  const rmax = Math.max(1, Math.ceil(searchRadius / grid.h));
  log(`grid ${grid.dims.join('x')} h=${grid.h.toExponential(3)} refs=${grid.refs} rmax=${rmax} (${Date.now() - t0} ms)`);
  const BC = toShared(dense.bc.data), MR = toShared(dense.mr.data);
  // opt-in (task food-shelf-production, lane COOK): dense.nm = the source's tangent-space normal map (RGBA, same size as bc). Each
  // sample's dense normal is then perturbed by it through three's derivative tangent frame of the dense face (the exact inverse of
  // encodeNormal), so the source normal-map detail survives the bake. Without dense.nm the output is unchanged.
  const NM = dense.nm ? toShared(dense.nm.data) : null;
  const DG = dense.nm ? toShared(Float32Array.from(faceGradients({pos: dense.P, uv: dense.UV, idx: dense.I}))) : null;
  if (dense.nm && (dense.nm.width !== dense.bc.width || dense.nm.height !== dense.bc.height)) throw new Error('bc/nm size mismatch');

  const ras = rasterize(low, R, 1.5 * supersample);
  log(`raster ${R}^2 inside=${ras.inside} skirt=${ras.skirtCount} overlapInterior=${ras.overlapInterior} (${Date.now() - t0} ms)`);
  // build samples
  const {pos, nrm, idx} = low;
  let nS = 0;
  for (let p = 0; p < R * R; p++) if (ras.owner[p] >= 0) nS++;
  const pixList = new Int32Array(nS);
  for (let p = 0, s = 0; p < R * R; p++) if (ras.owner[p] >= 0) pixList[s++] = p;
  const samples = shared(Float32Array, nS * 6);
  const sFace = new Int32Array(nS);
  const sN = new Float32Array(nS * 3);
  for (let s = 0; s < nS; s++) {
    const p = pixList[s], f = ras.owner[p], v = ras.bary[2 * p], w = ras.bary[2 * p + 1], u = 1 - v - w;
    const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) {
      samples[6 * s + k] = pos[3 * a + k] * u + pos[3 * b + k] * v + pos[3 * c + k] * w;
    }
    nx = nrm[3 * a] * u + nrm[3 * b] * v + nrm[3 * c] * w; ny = nrm[3 * a + 1] * u + nrm[3 * b + 1] * v + nrm[3 * c + 1] * w; nz = nrm[3 * a + 2] * u + nrm[3 * b + 2] * v + nrm[3 * c + 2] * w;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    samples[6 * s + 3] = nx; samples[6 * s + 4] = ny; samples[6 * s + 5] = nz;
    sN[3 * s] = nx; sN[3 * s + 1] = ny; sN[3 * s + 2] = nz;
    sFace[s] = f;
  }
  const outColor = shared(Uint8Array, nS * 4), outMR = shared(Uint8Array, nS * 2), outN = shared(Float32Array, nS * 3), outStatus = shared(Uint8Array, nS), outDist = shared(Float32Array, nS);
  const counter = shared(Int32Array, 1);
  const data = {
    P: P.buffer, N: Nn.buffer, UV: UVd.buffer, I: Id.buffer, FN: FN.buffer, cellStart: grid.cellStart.buffer, cellTris: grid.cellTris.buffer,
    BC: BC.buffer, MR: MR.buffer, samples: samples.buffer, outColor: outColor.buffer, outMR: outMR.buffer, outN: outN.buffer, outStatus: outStatus.buffer, outDist: outDist.buffer, counter: counter.buffer,
    ox: grid.origin[0], oy: grid.origin[1], oz: grid.origin[2], h: grid.h, dx: grid.dims[0], dy: grid.dims[1], dz: grid.dims[2], rmax,
    texW: dense.bc.width, texH: dense.bc.height, nSamples: nS, chunk: 4096, NM: NM ? NM.buffer : null, DG: DG ? DG.buffer : null,
  };
  if (dense.mr.width !== dense.bc.width || dense.mr.height !== dense.bc.height) throw new Error('bc/mr size mismatch');
  await Promise.all(Array.from({length: workers}, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./bake-worker.mjs', import.meta.url), {workerData: data});
    w.on('message', () => resolve()); w.on('error', reject);
    w.on('exit', code => { if (code !== 0) reject(new Error('worker exit ' + code)); });
  })));
  log(`sampled ${nS} texels with ${workers} workers (${Date.now() - t0} ms)`);

  // compose images at R
  const G = faceGradients(low);
  const color = new Uint8Array(R * R * 3), mrImg = new Uint8Array(R * R * 3), nImg = new Uint8Array(R * R * 3);
  const mask = new Uint8Array(R * R);
  let st = [0, 0, 0]; const dists = [];
  const csum = [0, 0, 0], msum = [0, 0];
  for (let s = 0; s < nS; s++) {
    const p = pixList[s], status = outStatus[s];
    st[status]++;
    if (!status) continue;
    if (s % 97 === 0) dists.push(outDist[s]);
    mask[p] = 1;
    for (let k = 0; k < 3; k++) { color[3 * p + k] = outColor[4 * s + k]; csum[k] += outColor[4 * s + k]; }
    mrImg[3 * p] = 255; mrImg[3 * p + 1] = outMR[2 * s]; mrImg[3 * p + 2] = outMR[2 * s + 1];
    msum[0] += outMR[2 * s]; msum[1] += outMR[2 * s + 1];
    encodeNormal(G, sFace[s], [sN[3 * s], sN[3 * s + 1], sN[3 * s + 2]], [outN[3 * s], outN[3 * s + 1], outN[3 * s + 2]], nImg, 3 * p);
  }
  const filled = st[1] + st[2];
  dists.sort((a, b) => a - b);
  const q = k => dists.length ? dists[Math.min(dists.length - 1, Math.floor(k * dists.length))] : null;
  const dilIters = 4 * supersample * 4;
  dilate(mask, [color, mrImg, nImg], R, dilIters);
  fillRemaining(mask, color, R, csum.map(v => Math.round(v / Math.max(1, filled))));
  fillRemaining(mask, mrImg, R, [255, Math.round(msum[0] / Math.max(1, filled)), Math.round(msum[1] / Math.max(1, filled))]);
  fillRemaining(mask, nImg, R, [128, 128, 255]);
  const colorOut = downsample(color, R, supersample);
  const mrOut = downsample(mrImg, R, supersample * mrDiv);
  const nOut = downsample(nImg, R, supersample * normalDiv, true);
  log(`composed (${Date.now() - t0} ms)`);
  return {
    color: {data: colorOut, size: atlas}, mr: {data: mrOut, size: atlas / mrDiv}, normal: {data: nOut, size: atlas / normalDiv},
    stats: {
      bakeResolution: R, supersample, samples: nS, insideTexels: ras.inside, skirtTexels: ras.skirtCount, uvOverlapInteriorTexels: ras.overlapInterior,
      matchedSameFacing: st[1], matchedFallbackAnyFacing: st[2], unmatched: st[0], searchRadiusSourceUnits: searchRadius,
      projectionDistanceSourceUnits: {p50: q(0.5), p90: q(0.9), p99: q(0.99), max: dists.length ? dists[dists.length - 1] : null},
      grid: {dims: grid.dims, cell: grid.h, refs: grid.refs},
    },
  };
}
