// Task studio-baked-lighting-reflections-20261114-050258-01: the station's FIXED ARCHITECTURE as a ray-castable scene, for the enhanced
// light-field bake (world/lightFieldGather.ts) and the reflection probes (world/reflectionProbes.ts).
//
// It is the light field's own geometry (world/lightField.ts levelGeometries: per level slot, per 0.5 m column, one free band floor..ceiling)
// seen as surfaces: a band's floor, its ceiling, and a WALL FACE wherever the neighbouring column has no free band at the ray's height
// (walls, platform edges, stair risers, lintels, slab edges). Identical bands of two levels (a flight carved into both) are one band.
// Nothing movable is in it: no prop, door leaf, character or train — so nothing that can move, break or leave is ever frozen into what is
// baked from it. Rays are exact against this geometry (a 2D DDA over the columns with the ray's height carried along), deterministic, and
// allocation-free: a hit is left in the scene's own fields.

import {CELL} from '../gen/grid';
import type {ColumnGeometry} from './lightField';

/** A hit surface's kind. */
export const HIT_FLOOR = 0, HIT_CEIL = 1, HIT_WALL = 2;

/** Height tolerance (m) for a ray passing from one column's band into the next one's. */
const PASS_EPS = 0.03;

export class BandScene {
  readonly W: number;
  readonly H: number;
  readonly n: number;
  /** Level slots. */
  readonly S: number;
  /** Band b of column i: start[i] <= b < start[i + 1]. */
  readonly start: Int32Array;
  /** Band floor / ceiling (world y). */
  readonly f: Float32Array;
  readonly c: Float32Array;
  /** The level slot a band's light is read from (the one whose own band it is; a shared band: the lowest slot). */
  readonly slot: Uint8Array;
  /** Band of slot s at column i: of[s * n + i] (-1 = the slot is closed there). */
  readonly of: Int32Array;

  // --- the last hit (valid after trace() returned true) ---
  /** Distance along the ray (m). */
  hitT = 0;
  /** HIT_FLOOR / HIT_CEIL / HIT_WALL. */
  hitKind = 0;
  /** The column and band the surface belongs to (the free space it faces). */
  hitCol = 0;
  hitBand = 0;
  /** Height of the hit point (world y). */
  hitY = 0;
  /** A wall's horizontal normal (unit, axis-aligned; 0, 0 for a floor / ceiling). */
  hitNx = 0;
  hitNz = 0;
  constructor(W: number, H: number, geos: readonly ColumnGeometry[]) {
    const n = W * H, S = geos.length;
    this.W = W; this.H = H; this.n = n; this.S = S;
    const start = new Int32Array(n + 1), of = new Int32Array(S * n).fill(-1);
    const f: number[] = [], c: number[] = [], slot: number[] = [];
    for (let i = 0; i < n; i++) {
      start[i] = f.length;
      const s0 = f.length;
      for (let s = 0; s < S; s++) {
        const g = geos[s];
        if (!g.open[i]) continue;
        let dup = -1;
        for (let b = s0; b < f.length; b++) if (Math.abs(f[b] - g.floorH[i]) < 1e-3 && Math.abs(c[b] - g.ceilH[i]) < 1e-3) { dup = b; break; }
        if (dup >= 0) { of[s * n + i] = dup; continue; }
        of[s * n + i] = f.length;
        f.push(g.floorH[i]); c.push(g.ceilH[i]); slot.push(s);
      }
    }
    start[n] = f.length;
    this.start = start; this.of = of;
    this.f = Float32Array.from(f); this.c = Float32Array.from(c); this.slot = Uint8Array.from(slot);
  }

  /** The band of column `col` holding height y (within `eps`), or -1. */
  bandAt(col: number, y: number, eps = PASS_EPS): number {
    const {start, f, c} = this;
    for (let b = start[col], e = start[col + 1]; b < e; b++) if (y >= f[b] - eps && y <= c[b] + eps) return b;
    return -1;
  }

  /** The band of the column holding world (x, z) at height y, or -1 (outside the grid / inside the solid). */
  bandAtPoint(x: number, y: number, z: number): number {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= this.W || cz >= this.H) return -1;
    return this.bandAt(cz * this.W + cx, y);
  }

  /**
   * Cast a ray from (ox, oy, oz) along the unit direction (dx, dy, dz), at most `maxT` m. True = it hit a surface (the hit* fields);
   * false = nothing within maxT, or the origin is not in free space. The grid's outer edge is a wall.
   */
  trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
    const {W, H, start, f, c} = this;
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) return false;
    let col = cz * W + cx;
    let b = -1;
    for (let q = start[col], e = start[col + 1]; q < e; q++) if (oy >= f[q] - PASS_EPS && oy <= c[q] + PASS_EPS) { b = q; break; }
    if (b < 0) return false;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
    const tDX = adx > 1e-9 ? CELL / adx : Infinity, tDZ = adz > 1e-9 ? CELL / adz : Infinity;
    let tMaxX = adx > 1e-9 ? (dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / adx : Infinity;
    let tMaxZ = adz > 1e-9 ? (dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / adz : Infinity;
    const down = dy < 0, level = dy === 0, invDy = level ? 0 : 1 / dy;
    for (let guard = 0; guard < 4096; guard++) {
      const tExit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      // the band's own floor / ceiling inside this column
      if (!level) {
        const ys = down ? f[b] : c[b], tS = (ys - oy) * invDy;
        if (tS <= tExit) {
          if (tS > maxT) return false;
          this.hitT = tS > 0 ? tS : 0; this.hitKind = down ? HIT_FLOOR : HIT_CEIL; this.hitCol = col; this.hitBand = b; this.hitY = ys; this.hitNx = 0; this.hitNz = 0;
          return true;
        }
      }
      if (tExit > maxT) return false;
      // into the neighbouring column at the ray's height there
      const y = oy + dy * tExit;
      let nx = 0, nz = 0;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDX; nx = -stepX; } else { cz += stepZ; tMaxZ += tDZ; nz = -stepZ; }
      let nb = -1;
      if (cx >= 0 && cz >= 0 && cx < W && cz < H) {
        const ncol = cz * W + cx;
        for (let q = start[ncol], e = start[ncol + 1]; q < e; q++) if (y >= f[q] - PASS_EPS && y <= c[q] + PASS_EPS) { nb = q; break; }
        if (nb >= 0) { col = ncol; b = nb; continue; }
      }
      this.hitT = tExit; this.hitKind = HIT_WALL; this.hitCol = col; this.hitBand = b; this.hitY = y; this.hitNx = nx; this.hitNz = nz;
      return true;
    }
    return false;
  }
}

/** N directions spread evenly over the sphere (a Fibonacci lattice; none exactly vertical or axis-aligned): [x, y, z] x N. */
export function sphereDirections(N: number): Float32Array {
  const out = new Float32Array(N * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let j = 0; j < N; j++) {
    const y = 1 - (2 * j + 1) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y)), a = ga * j + 0.37;
    out[j * 3] = Math.cos(a) * r; out[j * 3 + 1] = y; out[j * 3 + 2] = Math.sin(a) * r;
  }
  return out;
}
