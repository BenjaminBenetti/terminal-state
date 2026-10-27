// Mesh utilities: similarity transform, position welding, meshoptimizer simplification,
// smooth normals, adjacency and small-component pruning. All deterministic.
import {MeshoptSimplifier} from 'meshoptimizer';

/** Apply x' = R*(s*(p - pivot)) + t where R is a rotation about Y by 180deg if flip, else identity. */
export function similarity(pos, {scale, pivot, flipFacing, offset}) {
  const out = new Float32Array(pos.length);
  const sg = flipFacing ? -1 : 1;
  for (let i = 0; i < pos.length; i += 3) {
    out[i] = sg * (pos[i] - pivot[0]) * scale + offset[0];
    out[i + 1] = (pos[i + 1] - pivot[1]) * scale + offset[1];
    out[i + 2] = sg * (pos[i + 2] - pivot[2]) * scale + offset[2];
  }
  return out;
}

export function rotateNormals(nrm, flipFacing) {
  const out = new Float32Array(nrm.length);
  const sg = flipFacing ? -1 : 1;
  for (let i = 0; i < nrm.length; i += 3) { out[i] = sg * nrm[i]; out[i + 1] = nrm[i + 1]; out[i + 2] = sg * nrm[i + 2]; }
  return out;
}

export function bounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return {min, max};
}

/** Weld vertices that share an exact position (UV seams of the master). Returns unique positions,
 *  averaged normals and an index buffer over the unique vertices (degenerates removed). */
export function weldByPosition(pos, nrm, idx) {
  const remap = MeshoptSimplifier.generatePositionRemap(pos, 3);
  const n = pos.length / 3;
  const newId = new Int32Array(n).fill(-1);
  let count = 0;
  for (let i = 0; i < n; i++) if (remap[i] === i) newId[i] = count++;
  const P = new Float32Array(count * 3), N = new Float32Array(count * 3);
  for (let i = 0; i < n; i++) {
    const r = newId[remap[i]];
    if (remap[i] === i) { P[r * 3] = pos[i * 3]; P[r * 3 + 1] = pos[i * 3 + 1]; P[r * 3 + 2] = pos[i * 3 + 2]; }
    N[r * 3] += nrm[i * 3]; N[r * 3 + 1] += nrm[i * 3 + 1]; N[r * 3 + 2] += nrm[i * 3 + 2];
  }
  normalizeAll(N);
  const I = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = newId[remap[idx[t]]], b = newId[remap[idx[t + 1]]], c = newId[remap[idx[t + 2]]];
    if (a !== b && b !== c && a !== c) I.push(a, b, c);
  }
  return {pos: P, nrm: N, idx: Uint32Array.from(I)};
}

export function normalizeAll(N) {
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return N;
}

/** meshoptimizer simplifyWithUpdate on a welded mesh (position-only quadric error by default).
 *  Optional importance: an extra attribute = position * importance(v) (weight 1). Where the
 *  importance is non-zero, every geometric deviation also changes this attribute, so those
 *  regions (head, hands) keep more triangles. Calibrated empirically (see manifest). */
export async function simplifyMesh(mesh, {targetTris, importance = null, flags = ['Prune', 'Regularize'], targetError = 1}) {
  await MeshoptSimplifier.ready;
  const n = mesh.pos.length / 3;
  const P = new Float32Array(mesh.pos);
  const scale = MeshoptSimplifier.getScale(mesh.pos, 3);
  const A = new Float32Array(n * 3);
  if (importance) for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) A[i * 3 + c] = mesh.pos[i * 3 + c] * importance[i];
  const I = new Uint32Array(mesh.idx);
  const [count, error] = importance
    ? MeshoptSimplifier.simplifyWithUpdate(I, P, 3, A, 3, [1, 1, 1], null, targetTris * 3, targetError, flags)
    : MeshoptSimplifier.simplifyWithUpdate(I, P, 3, A, 3, [0, 0, 0], null, targetTris * 3, targetError, flags);
  const tri = I.subarray(0, count);
  const [remap, unique] = MeshoptSimplifier.compactMesh(tri); // tri is rewritten in place
  const pos = new Float32Array(unique * 3);
  for (let i = 0; i < Math.min(n, remap.length); i++) {
    const r = remap[i];
    if (r === 0xffffffff || r >= unique) continue;
    pos[r * 3] = P[i * 3]; pos[r * 3 + 1] = P[i * 3 + 1]; pos[r * 3 + 2] = P[i * 3 + 2];
  }
  const idx = new Uint32Array(tri);
  return {pos, idx, error, triangles: idx.length / 3, vertices: unique, scale};
}

/** Area-weighted smooth vertex normals. */
export function computeNormals(pos, idx) {
  const N = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { N[v] += nx; N[v + 1] += ny; N[v + 2] += nz; }
  }
  return normalizeAll(N);
}

export function faceNormalsAreas(pos, idx) {
  const nt = idx.length / 3;
  const FN = new Float32Array(nt * 3), FA = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    FA[t] = l / 2;
    if (l > 0) { FN[t * 3] = nx / l; FN[t * 3 + 1] = ny / l; FN[t * 3 + 2] = nz / l; }
  }
  return {FN, FA};
}

/** Vertex adjacency (CSR) from triangles. */
export function vertexAdjacency(nv, idx) {
  const sets = Array.from({length: nv}, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const offs = new Uint32Array(nv + 1);
  for (let i = 0; i < nv; i++) offs[i + 1] = offs[i] + sets[i].size;
  const adj = new Uint32Array(offs[nv]);
  for (let i = 0; i < nv; i++) { let k = offs[i]; for (const j of [...sets[i]].sort((x, y) => x - y)) adj[k++] = j; }
  return {offs, adj};
}

/** Face adjacency across shared edges: returns Int32Array(nt*3) neighbour per edge (-1 if border/non-manifold). */
export function faceAdjacency(idx) {
  const nt = idx.length / 3;
  const edges = new Map();
  const nb = new Int32Array(nt * 3).fill(-1);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const a = idx[t * 3 + e], b = idx[t * 3 + (e + 1) % 3];
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const prev = edges.get(key);
    if (prev === undefined) edges.set(key, t * 3 + e);
    else if (prev >= 0) { nb[t * 3 + e] = Math.floor(prev / 3); nb[prev] = t; edges.set(key, -1); }
    else { /* non-manifold edge: leave unlinked */ }
  }
  return nb;
}

/** Connected components over vertices; returns labels and sizes. */
export function components(nv, idx) {
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]);
    if (a !== b) parent[b] = a;
    const a2 = find(a), c2 = find(c);
    if (a2 !== c2) parent[c2] = a2;
  }
  const label = new Int32Array(nv);
  const sizes = new Map();
  for (let i = 0; i < nv; i++) { const r = find(i); label[i] = r; sizes.set(r, (sizes.get(r) || 0) + 1); }
  return {label, sizes};
}
