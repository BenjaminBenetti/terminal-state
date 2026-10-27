// Read-only collision queries against the station layout (grid cells + prop boxes), shared by the
// casing integrator and the ragdoll "initial overlap" check. Pure data; no three.js / cannon.
//
// Vertical profile per grid cell: FLOOR / VOID (track bed) = solid below the cell's floor height
// (iteration 05, Lane T: grid.floor — platform 0, track bed, underpass; stair cells follow the
// tread profile, so casings bounce down steps and ragdolls rest on treads), SOLID = wall at every
// height. Props are axis-aligned boxes (x±hx, y..y+h, z±hz).

import {CELL, SOLID, VOID, type Grid, type Ramp} from '../gen/grid';
import type {PropPlacement} from '../gen/props';

/** Step pieces of a ramp (treads + half-tread landing ends) over its cell rect: along-axis span and top height. */
export function rampPieces(r: Ramp): {s0: number; s1: number; h: number; a0: number; a1: number}[] {
  const axisX = r.axis === 'x';
  const lo = (axisX ? r.x : r.y) * CELL, hi = lo + (axisX ? r.w : r.h) * CELL;
  const a0 = (axisX ? r.y : r.x) * CELL, a1 = a0 + (axisX ? r.h : r.w) * CELL;
  const dir = Math.sign(r.s1 - r.s0) || 1;
  const bounds = [dir > 0 ? lo : hi];
  for (let k = 0; k < r.risers; k++) bounds.push(r.s0 + (r.s1 - r.s0) * (k + 0.5) / r.risers);
  bounds.push(dir > 0 ? hi : lo);
  const out: {s0: number; s1: number; h: number; a0: number; a1: number}[] = [];
  for (let k = 0; k <= r.risers; k++) {
    const p = bounds[k], q = bounds[k + 1];
    if (Math.abs(q - p) > 1e-4) out.push({s0: Math.min(p, q), s1: Math.max(p, q), h: r.h0 + (r.h1 - r.h0) * k / r.risers, a0, a1});
  }
  return out;
}

/** The subset of StationLayout the physics module needs (lets tests build tiny layouts). */
export interface StaticLayout {
  grid: Grid;
  props: PropPlacement[];
  trench: {floorY: number};
}

export class StaticQuery {
  readonly grid: Grid;
  readonly props: PropPlacement[];
  readonly trenchY: number;
  /** Lowest floor in the layout (static slab depth). */
  readonly minFloor: number;
  /** Prop indices per grid cell their footprint overlaps (ALL props, including stacked ones). */
  private readonly buckets = new Map<number, number[]>();

  constructor(layout: StaticLayout) {
    this.grid = layout.grid;
    this.props = layout.props;
    this.trenchY = layout.trench.floorY;
    this.minFloor = Math.min(this.grid.minFloor(), this.trenchY);
    this.props.forEach((p, i) => {
      const x0 = Math.floor((p.x - p.hx) / CELL), x1 = Math.floor((p.x + p.hx) / CELL);
      const y0 = Math.floor((p.z - p.hz) / CELL), y1 = Math.floor((p.z + p.hz) / CELL);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!this.grid.inBounds(x, y)) continue;
        const k = this.grid.idx(x, y);
        let b = this.buckets.get(k);
        if (!b) this.buckets.set(k, (b = []));
        b.push(i);
      }
    });
  }

  /** Top of the solid ground under (x, z): the cell's floor (tread tops on stairs), +Infinity for a wall. */
  cellGround(x: number, z: number): number {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    const g = this.grid;
    if (!g.inBounds(cx, cy)) return Infinity;
    const i = g.idx(cx, cy);
    const c = g.cells[i];
    if (c === SOLID) return Infinity;
    if (c === VOID && g.floor[i] === 0) return this.trenchY;
    return g.stepAt(x, z);
  }

  /** Flat floor height of a non-solid cell (track bed falls back to the layout trench floor). */
  cellFloor(cx: number, cy: number): number {
    const g = this.grid, i = g.idx(cx, cy);
    return g.cells[i] === VOID && g.floor[i] === 0 ? this.trenchY : g.floorOf(i);
  }

  private propsAt(x: number, z: number): number[] | undefined {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    return this.grid.inBounds(cx, cy) ? this.buckets.get(this.grid.idx(cx, cy)) : undefined;
  }

  /** Highest supporting surface under (x, z) whose top is at or below `y` (ground or a prop top). */
  surfaceBelow(x: number, z: number, y: number): number {
    let s = this.cellGround(x, z);
    if (s === Infinity) return s;
    const list = this.propsAt(x, z);
    if (list) for (const i of list) {
      const p = this.props[i];
      if (Math.abs(x - p.x) > p.hx || Math.abs(z - p.z) > p.hz) continue;
      const top = p.y + p.h;
      if (top <= y && top > s) s = top;
    }
    return s;
  }

  /**
   * True if a small body of radius r centred at (x, y, z) is blocked sideways: a wall cell, a
   * ground step above its underside (platform face seen from the trench) or a prop box side.
   */
  blocked(x: number, y: number, z: number, r: number): boolean {
    const g = this.cellGround(x, z);
    if (g === Infinity || g > y - r * 0.5) return true;
    const list = this.propsAt(x, z);
    if (list) for (const i of list) {
      const p = this.props[i];
      if (Math.abs(x - p.x) > p.hx || Math.abs(z - p.z) > p.hz) continue;
      if (y - r * 0.5 < p.y + p.h && y + r > p.y) return true;
    }
    return false;
  }

  /** Point strictly inside static solid volume (wall column, below ground, inside a prop). */
  insideSolid(x: number, y: number, z: number): boolean {
    const g = this.cellGround(x, z);
    if (g === Infinity || y < g - 0.02) return true;
    const list = this.propsAt(x, z);
    if (list) for (const i of list) {
      const p = this.props[i];
      if (Math.abs(x - p.x) < p.hx && Math.abs(z - p.z) < p.hz && y > p.y && y < p.y + p.h) return true;
    }
    return false;
  }

  /**
   * Cell profile key for greedy box merging: 0 = wall, -1 = stair ramp (built from step pieces),
   * otherwise a positive key per floor height (cells at one height merge into one slab).
   */
  cellClass(cx: number, cy: number): number {
    const g = this.grid;
    if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] === SOLID) return 0;
    if (g.rampIdx[g.idx(cx, cy)] >= 0) return -1;
    return 1 + Math.round((this.cellFloor(cx, cy) + 100) * 1000);
  }
}
