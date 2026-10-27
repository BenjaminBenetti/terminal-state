// Iteration 07 (Lane W): garment / body interpenetration measurement in ANY pose (CPU, no GPU).
//
// Everything here works on plain arrays so the same code audits the runtime GLBs (qa/fit-audit.mjs)
// and drives the pose-aware fitting in the builder (lib/fit07.mjs).
//
// Definitions (per pose, after linear-blend skinning of the inner surface and the outer garments):
//  - covered:  an inner vertex (body, or a lower garment under an upper) whose outward ray along its
//              bind normal hits an outer garment within `coverDist` in the BIND pose;
//  - poke:     a covered vertex whose posed outward ray (posed normal) no longer hits any outer
//              garment within `outDist`, while its INWARD ray hits the OUTWARD-facing side of an outer
//              garment within min(maxDepth, 0.45 x the inner surface's own thickness, skipping the first
//              2.5 cm of inner shells): the garment's outer surface lies UNDER the skin there, i.e. the body
//              pokes out through the cloth (skin merely inside a thick garment's walls is not a poke);
//  - visible poke: a poke vertex used by at least one inner triangle that is NOT hidden by the
//              runtime mask (hidden body triangles cannot be seen poking);
//  - exposed hidden: a covered vertex whose every inner triangle is hidden by the mask and which
//              is neither covered nor under cloth in the pose (a see-through hole risk);
//  - outer inside: an outer-garment vertex whose closest inner surface point is > 3 mm inside it
//              (closest-triangle normal sign; approximate in folds) - reported, not gated.
//  - clearance: distance along the posed normal from a covered inner vertex out to the garment.
const EPS = 1e-9;

/** Uniform-grid triangle accelerator with nearest-hit ray casting (3D DDA) and closest point. */
export class TriGrid {
  constructor(pos, idx, cell = 0.03) {
    this.pos = pos; this.idx = idx; this.cell = cell;
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const nt = idx.length / 3;
    for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c] * 3; for (let k = 0; k < 3; k++) { const x = pos[v + k]; if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x; } }
    if (!nt) { min = [0, 0, 0]; max = [0, 0, 0]; }
    min = min.map(v => v - cell * 0.5); max = max.map(v => v + cell * 0.5);
    const dims = [0, 1, 2].map(k => Math.max(1, Math.ceil((max[k] - min[k]) / cell)));
    this.min = min; this.dims = dims;
    const ncell = dims[0] * dims[1] * dims[2];
    const counts = new Uint32Array(ncell + 1);
    const lo = [0, 0, 0], hi = [0, 0, 0];
    const range = (t, cb) => {
      for (let k = 0; k < 3; k++) { lo[k] = Infinity; hi[k] = -Infinity; }
      for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c] * 3; for (let k = 0; k < 3; k++) { const x = pos[v + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; } }
      const a0 = Math.min(dims[0] - 1, Math.max(0, Math.floor((lo[0] - min[0]) / cell))), a1 = Math.min(dims[1] - 1, Math.max(0, Math.floor((lo[1] - min[1]) / cell))), a2 = Math.min(dims[2] - 1, Math.max(0, Math.floor((lo[2] - min[2]) / cell)));
      const b0 = Math.min(dims[0] - 1, Math.max(0, Math.floor((hi[0] - min[0]) / cell))), b1 = Math.min(dims[1] - 1, Math.max(0, Math.floor((hi[1] - min[1]) / cell))), b2 = Math.min(dims[2] - 1, Math.max(0, Math.floor((hi[2] - min[2]) / cell)));
      for (let z = a2; z <= b2; z++) for (let y = a1; y <= b1; y++) for (let x = a0; x <= b0; x++) cb((z * dims[1] + y) * dims[0] + x);
    };
    for (let t = 0; t < nt; t++) range(t, c => counts[c + 1]++);
    for (let c = 0; c < ncell; c++) counts[c + 1] += counts[c];
    const fill = new Uint32Array(ncell), tris = new Uint32Array(counts[ncell]);
    for (let t = 0; t < nt; t++) range(t, c => { tris[counts[c] + fill[c]++] = t; });
    this.start = counts; this.tris = tris;
    this.mark = new Int32Array(nt).fill(-1); this.stamp = 0;
  }

  /** Möller-Trumbore; returns t or Infinity. frontOnly: only triangles whose winding normal faces the ray origin. */
  tri(t, ox, oy, oz, dx, dy, dz, frontOnly = false) {
    const P = this.pos, I = this.idx;
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) return Infinity;
    if (frontOnly && det < 0) return Infinity;
    const inv = 1 / det;
    const tx = ox - P[a], ty = oy - P[a + 1], tz = oz - P[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-7 || u > 1 + 1e-7) return Infinity;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < -1e-7 || u + v > 1 + 1e-7) return Infinity;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  /** Nearest hit with tMin < t < tMax along the (unit) direction; {t, tri} or null. `skip(tri)` filters; frontOnly: see tri(). */
  ray(ox, oy, oz, dx, dy, dz, tMax, tMin = 0, skip = null, frontOnly = false) {
    const {min, dims, cell} = this;
    // slab clip to the grid box
    let t0 = tMin, t1 = tMax;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let k = 0; k < 3; k++) {
      const lo = min[k], hi = min[k] + dims[k] * cell;
      if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo || o[k] > hi) return null; continue; }
      let a = (lo - o[k]) / d[k], b = (hi - o[k]) / d[k];
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
    const ix = [0, 0, 0], step = [0, 0, 0], tNext = [0, 0, 0], tDelta = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const p = o[k] + d[k] * t0;
      ix[k] = Math.min(dims[k] - 1, Math.max(0, Math.floor((p - min[k]) / cell)));
      if (d[k] > 1e-12) { step[k] = 1; tNext[k] = (min[k] + (ix[k] + 1) * cell - o[k]) / d[k]; tDelta[k] = cell / d[k]; }
      else if (d[k] < -1e-12) { step[k] = -1; tNext[k] = (min[k] + ix[k] * cell - o[k]) / d[k]; tDelta[k] = -cell / d[k]; }
      else { step[k] = 0; tNext[k] = Infinity; tDelta[k] = Infinity; }
    }
    const stamp = ++this.stamp, mark = this.mark;
    let best = tMax, bestTri = -1;
    for (;;) {
      const ci = (ix[2] * dims[1] + ix[1]) * dims[0] + ix[0];
      for (let q = this.start[ci], e = this.start[ci + 1]; q < e; q++) {
        const t = this.tris[q];
        if (mark[t] === stamp) continue;
        mark[t] = stamp;
        if (skip && skip(t)) continue;
        const h = this.tri(t, ox, oy, oz, dx, dy, dz, frontOnly);
        if (h > tMin && h < best) { best = h; bestTri = t; }
      }
      const k = tNext[0] < tNext[1] ? (tNext[0] < tNext[2] ? 0 : 2) : (tNext[1] < tNext[2] ? 1 : 2);
      const exit = tNext[k];
      if (best <= exit || exit > t1) break;
      ix[k] += step[k];
      if (ix[k] < 0 || ix[k] >= dims[k]) break;
      tNext[k] += tDelta[k];
    }
    return bestTri >= 0 ? {t: best, tri: bestTri} : null;
  }

  /** Closest triangle point within maxR: {d, tri, q:[x,y,z]} or null. */
  closest(px, py, pz, maxR = 0.1) {
    const {min, dims, cell} = this;
    const c = [Math.floor((px - min[0]) / cell), Math.floor((py - min[1]) / cell), Math.floor((pz - min[2]) / cell)];
    const R = Math.ceil(maxR / cell);
    const stamp = ++this.stamp, mark = this.mark;
    let bd = maxR, bt = -1, bq = null;
    const p = [px, py, pz];
    for (let r = 0; r <= R; r++) {
      if (bt >= 0 && bd <= (r - 1) * cell) break;
      for (let z = c[2] - r; z <= c[2] + r; z++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let x = c[0] - r; x <= c[0] + r; x++) {
        if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r) continue;
        if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) continue;
        const ci = (z * dims[1] + y) * dims[0] + x;
        for (let q = this.start[ci], e = this.start[ci + 1]; q < e; q++) {
          const t = this.tris[q];
          if (mark[t] === stamp) continue;
          mark[t] = stamp;
          const cp = closestOnTri(p, this.pos, this.idx[t * 3] * 3, this.idx[t * 3 + 1] * 3, this.idx[t * 3 + 2] * 3);
          const d = Math.hypot(px - cp[0], py - cp[1], pz - cp[2]);
          if (d < bd) { bd = d; bt = t; bq = cp; }
        }
      }
    }
    return bt >= 0 ? {d: bd, tri: bt, q: bq} : null;
  }
}

/** Closest point on triangle (a, b, c = offsets into P). Returns [x, y, z, wa, wb, wc]. */
export function closestOnTri(p, P, a, b, c) {
  const abx = P[b] - P[a], aby = P[b + 1] - P[a + 1], abz = P[b + 2] - P[a + 2];
  const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
  const apx = p[0] - P[a], apy = p[1] - P[a + 1], apz = p[2] - P[a + 2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const out = (wa, wb, wc) => [P[a] * wa + P[b] * wb + P[c] * wc, P[a + 1] * wa + P[b + 1] * wb + P[c + 1] * wc, P[a + 2] * wa + P[b + 2] * wb + P[c + 2] * wc, wa, wb, wc];
  if (d1 <= 0 && d2 <= 0) return out(1, 0, 0);
  const bpx = p[0] - P[b], bpy = p[1] - P[b + 1], bpz = p[2] - P[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return out(0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return out(1 - v, v, 0); }
  const cpx = p[0] - P[c], cpy = p[1] - P[c + 1], cpz = p[2] - P[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return out(0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return out(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return out(0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return out(1 - v - w, v, w);
}

/** Ray-parity inside test against a (roughly closed) surface: majority vote over the 6 axis directions. */
export function insideByParity(grid, x, y, z) {
  let votes = 0;
  for (let k = 0; k < 6; k++) {
    const d = [0, 0, 0]; d[k >> 1] = k & 1 ? -1 : 1;
    let t = 0, cnt = 0;
    for (let h = 0; h < 64; h++) {
      const r = grid.ray(x + d[0] * t, y + d[1] * t, z + d[2] * t, d[0], d[1], d[2], 4, 0.0002);
      if (!r) break;
      cnt++; t += r.t + 0.0002;
    }
    if (cnt & 1) votes++;
  }
  return votes >= 4;
}

const ESCAPE_DIRS = (() => { const out = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { if (!x && !y && !z) continue; const l = Math.hypot(x, y, z); out.push([x / l, y / l, z / l]); } return out; })();

/**
 * Outer-hull (externally visible) vertices of a surface: from the point 2 mm along the vertex normal at
 * least `minEscape` of the rays along the normal and the 26 axis/diagonal directions within 60 deg of it
 * leave the surface's bounds without hitting it (a cone, not the hemisphere: the inside of an open shirt
 * hem faces the skin and only escapes at grazing angles). AI reconstructions contain hollow interiors and inner
 * shells (shirt over skin, the inside of a jacket shoulder) whose vertices face into an enclosed cavity;
 * they are never visible and are neither audited nor fitted against.
 */
export function outerHull(pos, nrm, idx, grid = null, {minEscape = 2} = {}) {
  const g = grid ?? new TriGrid(pos, idx, 0.03);
  const n = pos.length / 3, out = new Uint8Array(n);
  const {remap} = weldMap(pos);
  for (let i = 0; i < n; i++) {
    if (remap[i] !== i) { out[i] = out[remap[i]]; continue; }
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const x = pos[i * 3] + nx * 0.002, y = pos[i * 3 + 1] + ny * 0.002, z = pos[i * 3 + 2] + nz * 0.002;
    let esc = g.ray(x, y, z, nx, ny, nz, 4, 0.0002) ? 0 : 1;
    for (const d of ESCAPE_DIRS) {
      if (esc >= minEscape) break;
      if (d[0] * nx + d[1] * ny + d[2] * nz < 0.5) continue;
      if (!g.ray(x, y, z, d[0], d[1], d[2], 4, 0.0002)) esc++;
    }
    out[i] = esc >= minEscape ? 1 : 0;
  }
  return out;
}

/** Position weld (UV seams): unique representative per vertex + the list of unique ids (exact float match). */
export function weldMap(pos) {
  const n = pos.length / 3, remap = new Uint32Array(n), seen = new Map(), uniq = [];
  const f = pos instanceof Float32Array ? pos : Float32Array.from(pos);
  const u = new Uint32Array(f.buffer, f.byteOffset, f.length);
  for (let i = 0; i < n; i++) {
    const key = u[i * 3] + ',' + u[i * 3 + 1] + ',' + u[i * 3 + 2];
    const r = seen.get(key);
    if (r === undefined) { seen.set(key, i); remap[i] = i; uniq.push(i); } else remap[i] = r;
  }
  return {remap, uniq: Uint32Array.from(uniq)};
}

/** Area-weighted vertex normals over welded positions (winding-based). */
export function weldedNormals(pos, idx, remap) {
  const n = pos.length / 3, acc = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { const r = remap[v] * 3; acc[r] += nx; acc[r + 1] += ny; acc[r + 2] += nz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = remap[i] * 3; const l = Math.hypot(acc[r], acc[r + 1], acc[r + 2]) || 1; out[i * 3] = acc[r] / l; out[i * 3 + 1] = acc[r + 1] / l; out[i * 3 + 2] = acc[r + 2] / l; }
  return out;
}

/**
 * Linear-blend skinning with per-joint world transforms `world[j] = {q:[x,y,z,w], p:[x,y,z], b:[x,y,z] (bind joint position)}`
 * (bind joint rotations are identity in this rig). `wScale` = 255 for normalized-u8 weights, 1 for floats.
 * Returns {pos, nrm} (nrm only if mesh.nrm given: rotated by the blended joint rotations).
 */
export function skin(mesh, world, wScale = 1) {
  const n = mesh.pos.length / 3, P = mesh.pos, N = mesh.nrm, J = mesh.joints, W = mesh.weights;
  const out = new Float32Array(n * 3), on = N ? new Float32Array(n * 3) : null;
  const R = world.map(w => quatMat(w.q));
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
    const vx = P[i * 3], vy = P[i * 3 + 1], vz = P[i * 3 + 2];
    for (let k = 0; k < 4; k++) {
      const w = W[i * 4 + k] / wScale; if (!w) continue;
      const j = J[i * 4 + k], m = R[j], T = world[j];
      const lx = vx - T.b[0], ly = vy - T.b[1], lz = vz - T.b[2];
      x += w * (m[0] * lx + m[1] * ly + m[2] * lz + T.p[0]);
      y += w * (m[3] * lx + m[4] * ly + m[5] * lz + T.p[1]);
      z += w * (m[6] * lx + m[7] * ly + m[8] * lz + T.p[2]);
      if (N) { const ax = N[i * 3], ay = N[i * 3 + 1], az = N[i * 3 + 2]; nx += w * (m[0] * ax + m[1] * ay + m[2] * az); ny += w * (m[3] * ax + m[4] * ay + m[5] * az); nz += w * (m[6] * ax + m[7] * ay + m[8] * az); }
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    if (N) { const l = Math.hypot(nx, ny, nz) || 1; on[i * 3] = nx / l; on[i * 3 + 1] = ny / l; on[i * 3 + 2] = nz / l; }
  }
  return {pos: out, nrm: on};
}

/**
 * Outer-wall vertices of a garment used as an INNER layer (e.g. pants under a jacket): its normal points
 * away from the body (closed-shell reconstructions also have an inner wall facing the skin, which is
 * not a visible surface and must not be audited as poking through the layer above).
 */
export function outerWallMask(garment, body, maxR = 0.12) {
  const g = new TriGrid(body.pos, body.idx, 0.03);
  const P = garment.pos, N = garment.nrm, n = P.length / 3, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = g.closest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], maxR);
    if (!c) { out[i] = 1; continue; }
    out[i] = (P[i * 3] - c.q[0]) * N[i * 3] + (P[i * 3 + 1] - c.q[1]) * N[i * 3 + 1] + (P[i * 3 + 2] - c.q[2]) * N[i * 3 + 2] > 0 ? 1 : 0;
  }
  return out;
}
export function quatMat(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

const bitAt = (bits, t) => !!(bits && (bits[t >> 3] & (1 << (t & 7))));
/** Union of base64 / Uint8Array bitsets -> Uint8Array(nTris) of 0/1. */
export function unionHide(nTris, list) {
  const out = new Uint8Array(nTris);
  for (const b of list || []) {
    if (!b) continue;
    const bits = typeof b === 'string' ? Buffer.from(b, 'base64') : b;
    if (bits.length === nTris) { for (let t = 0; t < nTris; t++) if (bits[t]) out[t] = 1; }
    else for (let t = 0; t < nTris; t++) if (bitAt(bits, t)) out[t] = 1;
  }
  return out;
}

/**
 * Prepare an inner surface for auditing. mesh {pos, idx, nrm (bind), joints, weights}, hide Uint8Array(nTris)
 * (1 = triangle hidden at runtime). Computes welded unique vertices, visibility, adjacency counts.
 */
export function prepareInner(mesh, hide, eligible = null) {
  const {remap, uniq: all} = weldMap(mesh.pos);
  const hull = outerHull(mesh.pos, mesh.nrm ?? weldedNormals(mesh.pos, mesh.idx, remap), mesh.idx);
  const uniq = all.filter(i => hull[i] && (!eligible || eligible[i]));
  const n = mesh.pos.length / 3, nt = mesh.idx.length / 3;
  const visible = new Uint8Array(n), used = new Uint8Array(n);
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) {
    const r = remap[mesh.idx[t * 3 + c]];
    used[r] = 1;
    if (!hide || !hide[t]) visible[r] = 1;
  }
  const nrm = mesh.nrm ?? weldedNormals(mesh.pos, mesh.idx, remap);
  return {mesh: {...mesh, nrm}, remap, uniq, visible, used, hide, nt};
}

/**
 * Bind-pose coverage of the inner vertices by the outer meshes: covered when the outward ray hits an
 * outer mesh within coverDist, OR when the cloth already lies under the skin in the bind pose (inward
 * ray hits within min(maxDepth, 0.45 x local thickness): `bindUnder` = 1 for those).
 */
export function bindCoverage(inner, outers, {coverDist = 0.1, maxDepth = 0.12} = {}) {
  const merged = mergeMeshes(outers.map(o => ({pos: o.pos, idx: o.idx})));
  const g = new TriGrid(merged.pos, merged.idx, 0.03);
  const ig = new TriGrid(inner.mesh.pos, inner.mesh.idx, 0.03);
  const P = inner.mesh.pos, N = inner.mesh.nrm;
  const n = P.length / 3;
  const covered = new Uint8Array(n), bindUnder = new Uint8Array(n), dist = new Float32Array(n).fill(Infinity), owner = new Int16Array(n).fill(-1);
  for (const i of inner.uniq) {
    if (!inner.used[i]) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const h = g.ray(x - nx * 0.001, y - ny * 0.001, z - nz * 0.001, nx, ny, nz, coverDist + 0.001);
    if (h) { covered[i] = 1; dist[i] = h.t - 0.001; owner[i] = merged.owner(h.tri); continue; }
    const back = ig.ray(x, y, z, -nx, -ny, -nz, 0.4, 0.025); // skip internal layers (shirt shells over skin) in the first 2.5 cm
    const lim = Math.min(maxDepth, 0.45 * (back ? back.t : 0.4));
    const u = g.ray(x + nx * 1e-4, y + ny * 1e-4, z + nz * 1e-4, -nx, -ny, -nz, lim, 0.0005, null, true);
    if (u) { covered[i] = 1; bindUnder[i] = 1; dist[i] = -u.t; owner[i] = merged.owner(u.tri); }
  }
  return {covered, bindUnder, dist, owner};
}

export function mergeMeshes(list) {
  const nv = list.reduce((a, m) => a + m.pos.length / 3, 0), ni = list.reduce((a, m) => a + m.idx.length, 0);
  const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  const triStart = [];
  let vb = 0, ib = 0;
  for (const m of list) {
    pos.set(m.pos, vb * 3);
    triStart.push(ib / 3);
    for (let i = 0; i < m.idx.length; i++) idx[ib + i] = m.idx[i] + vb;
    vb += m.pos.length / 3; ib += m.idx.length;
  }
  const owner = t => { let k = 0; while (k + 1 < triStart.length && t >= triStart[k + 1]) k++; return k; };
  return {pos, idx, owner, triStart};
}

/**
 * Audit one pose. innerPosed {pos, nrm} (skinned inner), outerPosed [{pos, idx}] (skinned outers, any number).
 * Returns stats and per-vertex state (0 not covered, 1 covered ok, 2 poke, 3 exposed).
 */
export function auditPose(inner, cover, innerPosed, outerPosed, {outDist = 0.12, maxDepth = 0.12, minDepth = 0.0005, withState = false, innerGrid = null, outerInside = true} = {}) {
  const merged = mergeMeshes(outerPosed);
  const og = new TriGrid(merged.pos, merged.idx, 0.03);
  const ig = innerGrid ?? new TriGrid(innerPosed.pos, inner.mesh.idx, 0.03);
  const P = innerPosed.pos, N = innerPosed.nrm;
  const state = withState ? new Uint8Array(P.length / 3) : null;
  let covered = 0, ok = 0, poke = 0, pokeVis = 0, exposed = 0, exposedHidden = 0;
  const depths = [], clear = [];
  const pokeIds = [];
  for (const i of inner.uniq) {
    if (!cover.covered[i]) continue;
    covered++;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const out = og.ray(x - nx * 1e-4, y - ny * 1e-4, z - nz * 1e-4, nx, ny, nz, outDist);
    if (out) { ok++; clear.push(out.t); if (state) state[i] = 1; continue; }
    const back = ig.ray(x, y, z, -nx, -ny, -nz, 0.4, 0.025); // skip internal layers (shirt shells over skin) in the first 2.5 cm
    const lim = Math.min(maxDepth, 0.45 * (back ? back.t : 0.4));
    const under = og.ray(x + nx * 1e-4, y + ny * 1e-4, z + nz * 1e-4, -nx, -ny, -nz, lim, minDepth, null, true);
    if (under) {
      poke++; depths.push(under.t);
      if (inner.visible[i]) { pokeVis++; pokeIds.push(i); }
      if (state) state[i] = 2;
    } else {
      exposed++;
      if (!inner.visible[i]) exposedHidden++;
      if (state) state[i] = 3;
    }
  }
  // outer vertices inside the inner surface (closest-triangle normal sign; approximate in folds)
  let outerIn = 0, outerTotal = 0;
  if (outerInside) {
    const IP = innerPosed.pos, II = inner.mesh.idx;
    for (let k = 0; k < outerPosed.length; k++) {
      const O = outerPosed[k].pos, step = outerPosed[k].step ?? 1;
      for (let i = 0; i < O.length / 3; i += step) {
        outerTotal++;
        const c = ig.closest(O[i * 3], O[i * 3 + 1], O[i * 3 + 2], 0.05);
        if (!c || c.d < 0.003) continue;
        const a = II[c.tri * 3] * 3, b = II[c.tri * 3 + 1] * 3, cc = II[c.tri * 3 + 2] * 3;
        const e1 = [IP[b] - IP[a], IP[b + 1] - IP[a + 1], IP[b + 2] - IP[a + 2]], e2 = [IP[cc] - IP[a], IP[cc + 1] - IP[a + 1], IP[cc + 2] - IP[a + 2]];
        const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const s = (O[i * 3] - c.q[0]) * fn[0] + (O[i * 3 + 1] - c.q[1]) * fn[1] + (O[i * 3 + 2] - c.q[2]) * fn[2];
        if (s < 0) outerIn++;
      }
    }
  }
  depths.sort((a, b) => a - b); clear.sort((a, b) => a - b);
  const q = (a, f) => a.length ? +a[Math.min(a.length - 1, Math.floor(f * (a.length - 1)))].toFixed(4) : 0;
  return {covered, ok, poke, pokeVisible: pokeVis, exposed, exposedHidden, pokeDepthP50: q(depths, 0.5), pokeDepthMax: q(depths, 1), clearP05: q(clear, 0.05), clearP50: q(clear, 0.5),
    outerInside: outerIn, outerTotal, state, pokeIds};
}
