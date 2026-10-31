// Track 2 (lane GEN): tunnel centrelines — straight runs and circular arcs (tangent-continuous), arc-length sampling, the exact
// point → (s, lateral) projection and the CONSERVATIVE rasterisation of the tube into grid cells. Pure math, no grid state.
//
// Frame: world X/Z in metres (canvas or final grid frame, the caller's), y up. "Left of travel" for a direction d = (dx, dz) is
// (dz, -dx) (y-up right-handed: facing +X, left is -Z). A positive turn bends toward the left.

import {CELL} from '../grid';

export interface Vec2 { x: number; z: number }

const left = (d: Vec2): Vec2 => ({x: d.z, z: -d.x});

export interface LinePrim { kind: 'line'; s0: number; len: number; p: Vec2; d: Vec2 }
export interface ArcPrim {
  kind: 'arc'; s0: number; len: number; p: Vec2; d: Vec2;
  /** Centre, radius, unit vector from the start point toward the centre (= side * left(d)), sweep (rad > 0), side (+1 = left turn). */
  c: Vec2; r: number; n: Vec2; phi: number; side: 1 | -1;
}
export type Prim = LinePrim | ArcPrim;

/** A planned centreline: primitives in order (s0 = arc length at their start). */
export interface TunnelPath { prims: Prim[]; length: number }

/** A shape step: a straight run (m) or an arc (centreline radius m, signed turn deg; + = toward the left). */
export type ShapeStep = {line: number} | {arc: {r: number; turnDeg: number}};

/** Builds the primitives of a shape from a start point / unit direction. Zero-length steps are dropped. */
export function buildPath(start: Vec2, dir: Vec2, steps: readonly ShapeStep[]): TunnelPath {
  const prims: Prim[] = [];
  let p = {...start}, d = {...dir}, s = 0;
  for (const st of steps) {
    if ('line' in st) {
      if (st.line <= 1e-9) continue;
      prims.push({kind: 'line', s0: s, len: st.line, p, d});
      p = {x: p.x + d.x * st.line, z: p.z + d.z * st.line};
      s += st.line;
    } else {
      const phi = Math.abs(st.arc.turnDeg) * Math.PI / 180;
      if (phi <= 1e-9) continue;
      const side: 1 | -1 = st.arc.turnDeg >= 0 ? 1 : -1;
      const l = left(d), n = {x: l.x * side, z: l.z * side}, r = st.arc.r;
      const c = {x: p.x + n.x * r, z: p.z + n.z * r};
      const len = r * phi;
      prims.push({kind: 'arc', s0: s, len, p, d, c, r, n, phi, side});
      const at = arcAt(c, r, n, d, phi);
      p = at.p; d = at.d;
      s += len;
    }
  }
  return {prims, length: s};
}

function arcAt(c: Vec2, r: number, n: Vec2, d: Vec2, t: number): {p: Vec2; d: Vec2} {
  const ct = Math.cos(t), st = Math.sin(t);
  return {
    p: {x: c.x - n.x * r * ct + d.x * r * st, z: c.z - n.z * r * ct + d.z * r * st},
    d: {x: d.x * ct + n.x * st, z: d.z * ct + n.z * st},
  };
}

/** Point and unit direction at arc length s (clamped to [0, length]; beyond the end the last direction continues). */
export function pointAt(path: TunnelPath, s: number): {p: Vec2; d: Vec2} {
  const prims = path.prims;
  if (!prims.length) return {p: {x: 0, z: 0}, d: {x: 1, z: 0}};
  let k = 0;
  while (k < prims.length - 1 && s > prims[k].s0 + prims[k].len) k++;
  const q = prims[k], u = s - q.s0;
  if (q.kind === 'line' || u < 0) return {p: {x: q.p.x + q.d.x * u, z: q.p.z + q.d.z * u}, d: q.d};
  if (u > q.len) {
    const e = arcAt(q.c, q.r, q.n, q.d, q.phi), over = u - q.len;
    return {p: {x: e.p.x + e.d.x * over, z: e.p.z + e.d.z * over}, d: e.d};
  }
  return arcAt(q.c, q.r, q.n, q.d, u / q.r);
}

/** End point / direction of the whole path. */
export function pathEnd(path: TunnelPath): {p: Vec2; d: Vec2} {
  return pointAt(path, path.length);
}

/** Samples the centreline from s = 0 to `length` at <= `step` m spacing (both ends included). */
export function samplePath(path: TunnelPath, length = path.length, step = CELL): Vec2[] {
  const out: Vec2[] = [];
  for (const q of path.prims) {
    if (q.s0 >= length - 1e-9) break;
    const len = Math.min(q.len, length - q.s0);
    const n = Math.max(1, Math.ceil(len / step - 1e-9));
    for (let i = out.length ? 1 : 0; i <= n; i++) out.push(pointAt(path, q.s0 + len * i / n).p);
  }
  if (!out.length) out.push(pointAt(path, 0).p);
  return out;
}

/**
 * Projection of a point onto the centreline: arc length s, lateral offset (+left of travel) and the local direction. Only
 * projections inside a primitive's range count (tangent-continuous shapes leave no gaps inside the tube); among several the
 * smallest |lateral| wins. `before` / `after` extend the path by straight runs before s = 0 / past s = length (footprints).
 * Null when the point projects onto no primitive.
 */
export function project(path: TunnelPath, x: number, z: number, before = 0, after = 0): {s: number; lat: number; d: Vec2; arc: boolean} | null {
  let best: {s: number; lat: number; d: Vec2; arc: boolean} | null = null;
  const consider = (s: number, lat: number, d: Vec2, arc = false) => { if (!best || Math.abs(lat) < Math.abs(best.lat)) best = {s, lat, d, arc}; };
  const prims = path.prims;
  for (let k = 0; k < prims.length; k++) {
    const q = prims[k];
    const lo = k === 0 ? -before : 0, hi = q.len + (k === prims.length - 1 && q.kind === 'line' ? after : 0);
    if (q.kind === 'line') {
      const vx = x - q.p.x, vz = z - q.p.z;
      const u = vx * q.d.x + vz * q.d.z;
      if (u < lo - 1e-9 || u > hi + 1e-9) continue;
      consider(q.s0 + u, vx * q.d.z - vz * q.d.x, q.d);
    } else {
      const vx = x - q.c.x, vz = z - q.c.z;
      const t = Math.atan2(vx * q.d.x + vz * q.d.z, -(vx * q.n.x + vz * q.n.z));
      if (t >= -1e-9 && t <= q.phi + 1e-9) {
        const r = Math.hypot(vx, vz);
        consider(q.s0 + q.r * t, q.side * (q.r - r), arcAt(q.c, q.r, q.n, q.d, t).d, true);
      } else if (k === 0 && before > 0) {
        // before the start of a leading arc: the straight continuation backwards
        const vx2 = x - q.p.x, vz2 = z - q.p.z, u = vx2 * q.d.x + vz2 * q.d.z;
        if (u >= -before - 1e-9 && u <= 0) consider(u, vx2 * q.d.z - vz2 * q.d.x, q.d);
      }
    }
  }
  const last = prims[prims.length - 1];
  if (after > 0 && last && last.kind === 'arc') {
    const e = arcAt(last.c, last.r, last.n, last.d, last.phi);
    const vx = x - e.p.x, vz = z - e.p.z, u = vx * e.d.x + vz * e.d.z;
    if (u >= 0 && u <= after + 1e-9) consider(path.length + u, vx * e.d.z - vz * e.d.x, e.d);
  }
  return best;
}

/** Packed cell key for possibly negative cell coordinates (|coord| < 8192). */
export const key = (x: number, y: number): number => (y + 8192) * 16384 + (x + 8192);
export const unkey = (k: number): [number, number] => [(k % 16384) - 8192, Math.floor(k / 16384) - 8192];

/**
 * FOOTPRINT cells of a tube of half-width `half` over (0, maxLen + capDepth): every cell reaching into the open tube (min |lateral|
 * over the cell < half, + 2 cm on arcs for the curvature) with some part at 0 < s < maxLen + capDepth. The bed's own cells before
 * the face are not part of it. Each with its centre's arc length `s` and the cell's half-extent `e` along the path, so the footprint
 * of a SHORTER tunnel (length L) is exactly the cells with s - e < L + capDepth.
 */
export interface TubeCells { x: number[]; y: number[]; s: number[]; e: number[] }

export function tubeCells(path: TunnelPath, half: number, maxLen: number, capDepth: number, ok?: (x: number, y: number) => boolean): TubeCells & {limit: number} {
  const out: TubeCells & {limit: number} = {x: [], y: [], s: [], e: [], limit: maxLen};
  const reach = half + 0.8;
  const pts = samplePath(path, Math.min(path.length, maxLen + capDepth));
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const p of pts) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); by0 = Math.min(by0, p.z); by1 = Math.max(by1, p.z); }
  const gx0 = Math.floor((bx0 - reach) / CELL), gy0 = Math.floor((by0 - reach) / CELL);
  const gw = Math.floor((bx1 + reach) / CELL) - gx0 + 1, gh = Math.floor((by1 + reach) / CELL) - gy0 + 1;
  const seen = new Uint8Array(gw * gh);
  const maxE = CELL / Math.SQRT2 + 1e-9;
  let chord = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (k) chord += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
    // samples are in s order (chord <= s): every footprint cell below the blocked limit was met by a sample before this one
    if (ok && chord - reach - maxE > out.limit + capDepth) break;
    const cx0 = Math.floor((p.x - reach) / CELL), cx1 = Math.floor((p.x + reach) / CELL), cy0 = Math.floor((p.z - reach) / CELL), cy1 = Math.floor((p.z + reach) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const vi = (cy - gy0) * gw + (cx - gx0);
      if (seen[vi]) continue;
      seen[vi] = 1;
      const c = project(path, (cx + 0.5) * CELL, (cy + 0.5) * CELL, CELL, capDepth);
      if (!c) continue;
      const e = CELL / 2 * (Math.abs(c.d.x) + Math.abs(c.d.z));
      if (Math.abs(c.lat) - e - (c.arc ? 0.02 : 0) >= half - 1e-9 || c.s - e >= maxLen + capDepth - 1e-9 || c.s + e <= 1e-9) continue;
      out.x.push(cx); out.y.push(cy); out.s.push(c.s); out.e.push(e);
      // a cell the footprint may not hold caps the length: footprint(L) = cells with s - e < L + capDepth
      if (ok && c.s - e - capDepth < out.limit && !ok(cx, cy)) out.limit = c.s - e - capDepth - 1e-6;
    }
  }
  return out;
}

/**
 * WALKABLE cells of a tunnel of length L: all four corners inside the smooth walls (|lat| <= half, 0 <= s <= L) — the exact
 * conservative rasterisation (cells between this staircase and the smooth wall stay solid). Corner results are shared.
 */
export function walkCells(path: TunnelPath, half: number, length: number, tube: TubeCells): {x: number[]; y: number[]; s: number[]} {
  const corner = new Map<number, boolean>();
  const inside = (gx: number, gy: number) => {
    const k = key(gx, gy);
    let v = corner.get(k);
    if (v === undefined) {
      const q = project(path, gx * CELL, gy * CELL);
      v = !!q && Math.abs(q.lat) <= half + 1e-9 && q.s >= -1e-9 && q.s <= length + 1e-9;
      corner.set(k, v);
    }
    return v;
  };
  const out = {x: [] as number[], y: [] as number[], s: [] as number[]};
  for (let i = 0; i < tube.x.length; i++) {
    const cx = tube.x[i], cy = tube.y[i];
    if (tube.s[i] - tube.e[i] > length) continue;
    if (inside(cx, cy) && inside(cx + 1, cy) && inside(cx, cy + 1) && inside(cx + 1, cy + 1)) { out.x.push(cx); out.y.push(cy); out.s.push(tube.s[i]); }
  }
  return out;
}
