// Task studio-reactor-surface-ending-20261102 (lane REPAIRS, user: "heavy z-fighting on the nuclear waste area emergency wash stations"):
// coplanar-face census + cleanup of a delivered model's geometry (deterministic processing of the cooked mesh at build time, no new
// asset; the Meshy maps are kept as delivered).
//
// Root cause (the waste repository's decon shower booths, REACTOR_X_KIT.deconShower, reactor-decon-shower.glb): its thin panels (back
// wall, side walls, the screen) are ZERO-THICKNESS DOUBLE SHEETS — the same panel twice, once per facing, in one plane — plus stacked
// same-facing layers within a millimetre (coplanarStats within 1 mm: 16.6 m2 opposite-facing and 3.3 m2 same-facing overlap in 35.5 m2
// of surface; 1.7 m2 same-facing within 0.05 mm, sampling DIFFERENT texels). The GLB's material is double-sided, so both faces
// of every sheet pair rendered at the same depth with different texels / flipped normals: heavy z-fighting. The mesh is otherwise a
// closed, consistently wound shell (signed volume +0.43 m3, 1 inconsistent edge of 14.7 k).
// The fix: render the booth single-sided (its winding is outward: each side of a sheet pair shows only its own face), drop the faces a
// same-facing face in the same plane hides completely (exact ties keep the lower index) and set the partly hidden near-coincident ones
// back behind the face in front (COPLANAR_RECESS) — real geometry offsets, never a depth bias.

import * as THREE from 'three';

export interface CoplanarStats {
  /** Total surface (m2) and the area overlapped by another face in the same plane (within eps): opposite-facing / same-facing. */
  area: number;
  opposite: number;
  same: number;
}

interface Tri { a: number; n: [number, number, number]; d: number; area: number; lo: [number, number, number]; hi: [number, number, number] }

const G = 0.1;

function trisOf(pos: ArrayLike<number>, count: number): (Tri | null)[] {
  const out: (Tri | null)[] = [];
  for (let t = 0; t < count; t++) {
    const a = t * 9;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[a + 3] - ax, by = pos[a + 4] - ay, bz = pos[a + 5] - az, cx = pos[a + 6] - ax, cy = pos[a + 7] - ay, cz = pos[a + 8] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx, L = Math.hypot(nx, ny, nz);
    if (!(L > 1e-12)) { out.push(null); continue; }
    const n: [number, number, number] = [nx / L, ny / L, nz / L];
    const lo: [number, number, number] = [Math.min(ax, pos[a + 3], pos[a + 6]), Math.min(ay, pos[a + 4], pos[a + 7]), Math.min(az, pos[a + 5], pos[a + 8])];
    const hi: [number, number, number] = [Math.max(ax, pos[a + 3], pos[a + 6]), Math.max(ay, pos[a + 4], pos[a + 7]), Math.max(az, pos[a + 5], pos[a + 8])];
    out.push({a, n, d: n[0] * ax + n[1] * ay + n[2] * az, area: L / 2, lo, hi});
  }
  return out;
}

/** Barycentric weights of P (projected on the triangle's plane) or null when degenerate. */
function bary(pos: ArrayLike<number>, a: number, px: number, py: number, pz: number): [number, number, number] | null {
  const v0x = pos[a + 3] - pos[a], v0y = pos[a + 4] - pos[a + 1], v0z = pos[a + 5] - pos[a + 2];
  const v1x = pos[a + 6] - pos[a], v1y = pos[a + 7] - pos[a + 1], v1z = pos[a + 8] - pos[a + 2];
  const v2x = px - pos[a], v2y = py - pos[a + 1], v2z = pz - pos[a + 2];
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z, den = d00 * d11 - d01 * d01;
  if (!den) return null;
  const b = (d11 * d20 - d01 * d21) / den, c = (d00 * d21 - d01 * d20) / den;
  return [1 - b - c, b, c];
}

/** A numeric key of a G m cell (models are a few metres across: +-100 m is plenty). */
const cellKey = (x: number, y: number, z: number) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);

/** A spatial hash of the triangles' boxes (G m cells). */
function hashOf(T: readonly (Tri | null)[]): Map<number, number[]> {
  const grid = new Map<number, number[]>();
  T.forEach((t, i) => {
    if (!t) return;
    for (let x = Math.floor(t.lo[0] / G); x <= Math.floor(t.hi[0] / G); x++) for (let y = Math.floor(t.lo[1] / G); y <= Math.floor(t.hi[1] / G); y++) for (let z = Math.floor(t.lo[2] / G); z <= Math.floor(t.hi[2] / G); z++) {
      const k = cellKey(x, y, z);
      let b = grid.get(k);
      if (!b) grid.set(k, (b = []));
      b.push(i);
    }
  });
  return grid;
}

/** Sample points inside triangle t (barycentric, away from its edges). */
const SAMPLES: readonly [number, number, number][] = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8]];

/**
 * For each sample of each triangle: the other triangles in the same plane (|plane distance| <= eps, normals parallel) whose interior
 * holds it. `visit(t, sample index, u, same-facing, signed offset of u's plane along t's normal)`.
 */
function scan(pos: ArrayLike<number>, T: readonly (Tri | null)[], eps: number, visit: (t: number, k: number, u: number, same: boolean, ahead: number) => void): void {
  const grid = hashOf(T);
  T.forEach((t, i) => {
    if (!t) return;
    SAMPLES.forEach((w, k) => {
      const a = t.a;
      const px = pos[a] * w[0] + pos[a + 3] * w[1] + pos[a + 6] * w[2], py = pos[a + 1] * w[0] + pos[a + 4] * w[1] + pos[a + 7] * w[2], pz = pos[a + 2] * w[0] + pos[a + 5] * w[1] + pos[a + 8] * w[2];
      for (const j of grid.get(cellKey(Math.floor(px / G), Math.floor(py / G), Math.floor(pz / G))) ?? []) {
        if (j === i) continue;
        const u = T[j]!;
        const c = u.n[0] * t.n[0] + u.n[1] * t.n[1] + u.n[2] * t.n[2];
        if (Math.abs(c) < 0.999) continue;
        const off = u.d - (u.n[0] * px + u.n[1] * py + u.n[2] * pz);
        if (Math.abs(off) > eps) continue;
        const b = bary(pos, u.a, px, py, pz);
        if (!b || b[0] < -1e-4 || b[1] < -1e-4 || b[2] < -1e-4) continue;
        visit(i, k, j, c > 0, c > 0 ? off : -off);
      }
    });
  });
}

/** Non-indexed position soup of a geometry (world = geometry space). */
function soup(geo: THREE.BufferGeometry): Float32Array {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute('position');
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { out[i * 3] = p.getX(i); out[i * 3 + 1] = p.getY(i); out[i * 3 + 2] = p.getZ(i); }
  if (g !== geo) g.dispose();
  return out;
}

/**
 * Coplanar overlap census of a geometry: the surface share of faces another face covers in the same plane (within eps), split by
 * opposite-facing (a zero-thickness double sheet: z-fights when drawn double-sided) and same-facing (z-fights either way when the
 * texels differ).
 */
export function coplanarStats(geo: THREE.BufferGeometry, eps = 0.001): CoplanarStats {
  const pos = soup(geo), T = trisOf(pos, pos.length / 9);
  const S = SAMPLES.length, hit = new Uint8Array(T.length * S * 2);
  scan(pos, T, eps, (t, k, _u, s) => { hit[(t * S + k) * 2 + (s ? 1 : 0)] = 1; });
  let area = 0, o = 0, sm = 0;
  T.forEach((t, i) => {
    if (!t) return;
    area += t.area;
    for (let k = 0; k < S; k++) { o += t.area * hit[(i * S + k) * 2] / S; sm += t.area * hit[(i * S + k) * 2 + 1] / S; }
  });
  return {area, opposite: o, same: sm};
}

/** The separation (m) under which two same-facing faces z-fight at room distances (24-bit depth, near 0.05 m: ~0.27 mm at 15 m). */
export const COPLANAR_BAND = 0.0003;
/** How far a partly hidden near-coincident face is set back behind the face in front of it (m). */
export const COPLANAR_RECESS = 0.0015;

/**
 * The geometry without its same-facing coplanar overlaps:
 *  1. a face is DROPPED when every sample of it lies on a same-facing face within `eps` in front of it (or on a coincident face with a
 *     lower index: exact duplicates keep one);
 *  2. a face only PARTLY under a same-facing face closer than COPLANAR_BAND in front of it (or coincident, higher index) is RECESSED by
 *     COPLANAR_RECESS along its normal (repeated until no such pair is left: a stack of layers spreads out behind its front face).
 * Non-indexed output, every attribute kept for the surviving faces (normals / uvs unchanged). Returns the input when nothing changes.
 */
export function dropHiddenCoplanar(geo: THREE.BufferGeometry, eps = 0.002): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const p = flat.getAttribute('position');
  const pos = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { pos[i * 3] = p.getX(i); pos[i * 3 + 1] = p.getY(i); pos[i * 3 + 2] = p.getZ(i); }
  const n = pos.length / 9, T = trisOf(pos, n);
  const covered = new Uint8Array(n * SAMPLES.length), layered = new Uint8Array(n);
  scan(pos, T, eps, (t, k, u, same, ahead) => {
    if (!same) return;
    layered[t] = layered[u] = 1;
    if (ahead > 1e-6 || (Math.abs(ahead) <= 1e-6 && u < t)) covered[t * SAMPLES.length + k] = 1;
  });
  const keep: number[] = [];
  for (let t = 0; t < n; t++) {
    let all = !!T[t];
    for (let k = 0; k < SAMPLES.length && all; k++) if (!covered[t * SAMPLES.length + k]) all = false;
    if (!all) keep.push(t);
  }
  const kpos = new Float32Array(keep.length * 9);
  keep.forEach((t, j) => { for (let v = 0; v < 9; v++) kpos[j * 9 + v] = pos[t * 9 + v]; });
  let recessed = 0;
  for (let it = 0; it < 8; it++) {
    // only the faces of a same-facing stack (within eps) can meet in the band: the rest of the shell is left out of the re-scans
    const K = trisOf(kpos, keep.length).map((q, j) => (layered[keep[j]] ? q : null)), push = new Uint8Array(keep.length);
    let any = false;
    scan(kpos, K, COPLANAR_BAND, (t, _k, u, same, ahead) => { if (same && (ahead > 1e-7 || (Math.abs(ahead) <= 1e-7 && u < t))) { push[t] = 1; any = true; } });
    if (!any) break;
    for (let t = 0; t < keep.length; t++) {
      if (!push[t] || !K[t]) continue;
      const nrm = K[t]!.n;
      for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) kpos[t * 9 + v * 3 + c] -= nrm[c] * COPLANAR_RECESS;
      recessed++;
    }
  }
  if (keep.length === n && !recessed) { if (flat !== geo) flat.dispose(); return geo; }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(flat.attributes)) {
    const a = attr as THREE.BufferAttribute, sz = a.itemSize, src = a.array as ArrayLike<number>;
    const dst = new (a.array.constructor as new (n: number) => Float32Array)(keep.length * 3 * sz);
    if (name === 'position' && sz === 3) dst.set(kpos);
    else keep.forEach((t, j) => { for (let v = 0; v < 3 * sz; v++) dst[j * 3 * sz + v] = src[t * 3 * sz + v]; });
    out.setAttribute(name, new THREE.BufferAttribute(dst, sz, a.normalized));
  }
  out.name = `${geo.name || 'geometry'}-coplanar-clean`;
  out.userData.coplanar = {dropped: n - keep.length, recessed};
  out.computeBoundingBox();
  out.computeBoundingSphere();
  if (flat !== geo) flat.dispose();
  return out;
}

const cleanGeos = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
const frontMats = new WeakMap<THREE.Material, THREE.Material>();

/**
 * A closed delivered shell drawn without its coplanar z-fighting: its hidden coplanar faces dropped (cached per source geometry) and its
 * material single-sided (a clone, cached per source material; the maps are the delivered ones).
 */
export function cleanShell(mesh: THREE.Mesh): {geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]} {
  let geometry = cleanGeos.get(mesh.geometry);
  if (!geometry) { geometry = dropHiddenCoplanar(mesh.geometry); cleanGeos.set(mesh.geometry, geometry); }
  const src = mesh.material;
  if (Array.isArray(src)) return {geometry, material: src};
  let material = frontMats.get(src);
  if (!material) {
    material = src.side === THREE.FrontSide ? src : src.clone();
    material.side = THREE.FrontSide;
    if (material !== src) material.name = `${src.name || 'material'}-front`;
    frontMats.set(src, material);
  }
  return {geometry, material};
}
