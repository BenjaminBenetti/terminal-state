// Task track1-siren-blightbelly-20261031 (lane RIGS): analysis helpers on game-space COPIES of a native mesh (never written).
//  - deterministic area-weighted surface samples (fixed barycentric lattice per triangle) so sparse Meshy smart-topology
//    meshes still give dense cross-sections;
//  - per-vertex base-colour luminance (texture read for ANALYSIS only, e.g. the Siren's black hair mask);
//  - polar cross-section profiles used by the dress fit.
import sharp from 'sharp';

/**
 * Samples every triangle on a lattice of k(k+1)/2 points with k = ceil(sqrt(area / dA)) (at least the centroid).
 * Returns {pts: Float32Array xyz, tri: Uint32Array source triangle, bary: Float32Array (3 per sample)}.
 */
export function surfaceSamples(pos, idx, dA = 4e-5, maxK = 12) {
  const P = [], T = [], B = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const area = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    const k = Math.min(maxK, Math.max(1, Math.ceil(Math.sqrt(area / dA))));
    for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) {
      const u = (i + 1 / 3) / k, v = (j + 1 / 3) / k, w = 1 - u - v;
      P.push(w * pos[a] + u * pos[b] + v * pos[c], w * pos[a + 1] + u * pos[b + 1] + v * pos[c + 1], w * pos[a + 2] + u * pos[b + 2] + v * pos[c + 2]);
      T.push(t); B.push(w, u, v);
    }
  }
  return {pts: Float32Array.from(P), tri: Uint32Array.from(T), bary: Float32Array.from(B)};
}

/** Base-colour luminance (0..255, Rec.709) at each vertex UV (nearest texel). Analysis only. */
export async function vertexLuminance(imageBytes, uv) {
  const {data, info} = await sharp(Buffer.from(imageBytes)).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const n = uv.length / 2, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((uv[i * 2] - Math.floor(uv[i * 2])) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1])) * info.height)));
    const o = (y * info.width + x) * 3;
    out[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return out;
}

/** 2D connected clusters (8-neighbour grid cells) of a point subset in the plane (ax0, ax1) — generic version of slices.mjs. */
export function cluster2(pts, ids, ax0, ax1, cell = 0.015, minCount = 4) {
  const cells = new Map();
  for (const i of ids) {
    const cx = Math.floor(pts[i * 3 + ax0] / cell), cz = Math.floor(pts[i * 3 + ax1] / cell);
    const key = cx * 100003 + cz;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = {cx, cz, ids: [], label: -1}));
    c.ids.push(i);
  }
  const out = [];
  for (const c of cells.values()) {
    if (c.label >= 0) continue;
    c.label = out.length;
    const stack = [c], members = [];
    while (stack.length) {
      const cur = stack.pop(); members.push(cur);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const nb = cells.get((cur.cx + dx) * 100003 + (cur.cz + dz));
        if (nb && nb.label < 0) { nb.label = c.label; stack.push(nb); }
      }
    }
    const vids = members.flatMap(m => m.ids);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, sa = 0, sb = 0;
    for (const i of vids) { const a = pts[i * 3 + ax0], b = pts[i * 3 + ax1]; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); sa += a; sb += b; }
    out.push({ids: vids, count: vids.length, min: [a0, b0], max: [a1, b1], c: [(a0 + a1) / 2, (b0 + b1) / 2], mean: [sa / vids.length, sb / vids.length]});
  }
  return out.filter(c => c.count >= minCount).sort((p, q) => p.c[0] - q.c[0]);
}

/** Ids of points within a slab |p[axis] - v| < half. */
export function slab(pts, axis, v, half, filter = null) {
  const out = [];
  for (let i = 0; i < pts.length / 3; i++) if (Math.abs(pts[i * 3 + axis] - v) < half && (!filter || filter(i))) out.push(i);
  return out;
}

export function boundsOfIds(pts, ids) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of ids) for (let k = 0; k < 3; k++) { const v = pts[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return {min, max};
}

/** Mean of a value over sample triangles' vertex attribute (e.g. hair flag per vertex -> per sample, barycentric). */
export function sampleAttribute(samples, idx, perVertex) {
  const n = samples.tri.length, out = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    const t = samples.tri[s];
    out[s] = samples.bary[s * 3] * perVertex[idx[t * 3]] + samples.bary[s * 3 + 1] * perVertex[idx[t * 3 + 1]] + samples.bary[s * 3 + 2] * perVertex[idx[t * 3 + 2]];
  }
  return out;
}
