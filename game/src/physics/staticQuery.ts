// Read-only collision queries against the station layout (grid cells + prop boxes), shared by the
// casing integrator and the ragdoll "initial overlap" check. Pure data; no three.js / cannon.
//
// Vertical profile per grid cell: FLOOR / VOID (track bed) = solid below the cell's floor height
// (iteration 05, Lane T: grid.floor — platform 0, track bed, underpass; stair cells follow the
// tread profile, so casings bounce down steps and ragdolls rest on treads), SOLID = wall at every
// height. Props are axis-aligned boxes (x±hx, y..y+h, z±hz).
//
// Iteration 08 (Lane B): stacked levels. A column's free space is the union of every level's open
// band (floor = tread tops on stairs, ceiling = the band ceiling); everything else is solid: the
// slab between a lower band's ceiling and an upper band's floor, the rock below the lowest floor,
// walls. Ground / ceiling / blocked / insideSolid queries take the body's height and answer for
// the band it is in, so an item on the upper deck rests on the deck, one under it lands on the
// floor below, and one over an aperture falls through it. A single-level layout gives exactly the
// iteration-05 answers (ceilings only matter where a cell sets one).

import {CELL, FLOOR, SOLID, VOID, type Grid, type Ramp} from '../gen/grid';
import {ceilNearCell, levelsOf, Levels, type Level, type LevelLink, type RailRun} from '../gen/levels';
import {stepTop} from '../gen/grid';
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
  /** Iteration 08: stacked levels (levels[0].grid === grid) and their links; absent = one level. */
  levels?: Level[];
  levelLinks?: LevelLink[];
}

/** One solid vertical interval of a column (static collision box), y0..y1. */
export interface Solid { y0: number; y1: number }

const isOpen = (g: Grid, i: number): boolean => { const c = g.cells[i]; return c === FLOOR || c === VOID; };

export class StaticQuery {
  /** Main grid (levels[0]). */
  readonly grid: Grid;
  /** Every level (one for legacy layouts). */
  readonly levels: Levels;
  readonly props: PropPlacement[];
  readonly trenchY: number;
  /** Lowest floor in the layout (static slab depth). */
  readonly minFloor: number;
  /** Top of full-height wall boxes: above the highest ceiling (m). */
  readonly topY: number;
  /** Prop indices per grid cell their footprint overlaps (ALL props, including stacked ones). */
  private readonly buckets = new Map<number, number[]>();
  private readonly grids: Grid[];
  private readonly fb: number[] = [];
  private readonly cb: number[] = [];

  constructor(layout: StaticLayout) {
    this.grid = layout.grid;
    this.levels = levelsOf(layout);
    this.grids = this.levels.list.map(l => l.grid);
    this.props = layout.props;
    this.trenchY = layout.trench.floorY;
    this.minFloor = Math.min(...this.grids.map(g => g.minFloor()), this.trenchY);
    let top = 9;
    for (const g of this.grids) for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== SOLID && g.hasCeil(i) && g.ceil[i] + 0.5 > top) top = g.ceil[i] + 0.5;
    this.topY = top;
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

  /**
   * Free bands of the column at (x, z) evaluated at that point: floors are the physical surface
   * (tread tops on stairs; VOID without a height at the trench floor), ceilings Infinity when unset.
   * Fills this.fb / this.cb (sorted by floor); returns the count (-1 outside the grid).
   */
  private bandsAt(x: number, z: number): number {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    const g0 = this.grid;
    if (!g0.inBounds(cx, cy)) return -1;
    const i = cy * g0.w + cx;
    const fb = this.fb, cb = this.cb;
    let n = 0;
    for (const g of this.grids) {
      if (!isOpen(g, i)) continue;
      let f: number;
      if (g.rampIdx[i] >= 0) { const R = g.ramps[g.rampIdx[i]]; f = stepTop(R, R.axis === 'x' ? x : z); }
      else f = g.cells[i] === VOID && g.floor[i] === 0 ? this.trenchY : g.floorOf(i);
      const c = ceilNearCell(g, i, cx, cy, x, z);
      // insertion by floor
      let k = n++;
      while (k > 0 && fb[k - 1] > f) { fb[k] = fb[k - 1]; cb[k] = cb[k - 1]; k--; }
      fb[k] = f; cb[k] = c;
    }
    return n;
  }

  /** Index of the band holding height y (with tolerance), else -1. */
  private bandOf(n: number, y: number, tol = 0.02): number {
    let best = -1;
    for (let k = 0; k < n; k++) if (y >= this.fb[k] - tol && y <= this.cb[k] + tol) best = k;
    return best;
  }

  /**
   * Top of the solid ground under (x, z): the floor (tread tops on stairs) of the band holding `y`;
   * from inside a slab, the nearer of the floor above / the band below; +Infinity for a wall.
   * Without `y`: the top-most floor of the column (the one floor of a single-level layout).
   */
  cellGround(x: number, z: number, y?: number): number {
    const n = this.bandsAt(x, z);
    if (n <= 0) return Infinity;
    if (y === undefined) return this.fb[n - 1];
    const k = this.bandOf(n, y);
    if (k >= 0) return this.fb[k];
    let up = -1, dn = -1;
    for (let m = 0; m < n; m++) { if (this.fb[m] > y && up < 0) up = m; if (this.cb[m] < y) dn = m; }
    if (up >= 0 && (dn < 0 || this.fb[up] - y < y - this.cb[dn])) return this.fb[up];
    return dn >= 0 ? this.fb[dn] : this.fb[up];
  }

  /** Ceiling of the band holding height y at (x, z) (Infinity: none / unset / a wall). */
  ceilAbove(x: number, z: number, y: number): number {
    const n = this.bandsAt(x, z);
    if (n <= 0) return Infinity;
    const k = this.bandOf(n, y);
    return k >= 0 ? this.cb[k] : Infinity;
  }

  /** Flat floor height of a non-solid cell of the main grid (track bed falls back to the layout trench floor). */
  cellFloor(cx: number, cy: number): number {
    const g = this.grid, i = g.idx(cx, cy);
    return g.cells[i] === VOID && g.floor[i] === 0 ? this.trenchY : g.floorOf(i);
  }

  private propsAt(x: number, z: number): number[] | undefined {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    return this.grid.inBounds(cx, cy) ? this.buckets.get(this.grid.idx(cx, cy)) : undefined;
  }

  /** Highest supporting surface under (x, z) whose top is at or below `y` (ground of y's band or a prop top). */
  surfaceBelow(x: number, z: number, y: number): number {
    let s = this.cellGround(x, z, y);
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
   * ground step above its underside (platform face seen from the trench), a slab edge / ceiling at
   * its height (no band holds it) or a prop box side.
   */
  blocked(x: number, y: number, z: number, r: number): boolean {
    const n = this.bandsAt(x, z);
    if (n <= 0) return true;
    let free = false;
    for (let k = 0; k < n; k++) if (this.fb[k] <= y - r * 0.5 && this.cb[k] >= y + r * 0.5) { free = true; break; }
    if (!free) return true;
    const list = this.propsAt(x, z);
    if (list) for (const i of list) {
      const p = this.props[i];
      if (Math.abs(x - p.x) > p.hx || Math.abs(z - p.z) > p.hz) continue;
      if (y - r * 0.5 < p.y + p.h && y + r > p.y) return true;
    }
    return false;
  }

  /** Point strictly inside static solid volume (wall column, below ground, inside a slab, inside a prop). */
  insideSolid(x: number, y: number, z: number): boolean {
    const n = this.bandsAt(x, z);
    if (n <= 0 || this.bandOf(n, y) < 0) return true;
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
   * Main grid only (legacy); multi-level statics use columnKey / columnSolids.
   */
  cellClass(cx: number, cy: number): number {
    const g = this.grid;
    if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] === SOLID) return 0;
    if (g.rampIdx[g.idx(cx, cy)] >= 0) return -1;
    return 1 + Math.round((this.cellFloor(cx, cy) + 100) * 1000);
  }

  /**
   * Iteration 08: solid intervals of column (cx, cy) for the static boxes, from `base` up: below the
   * lowest floor, and every slab between consecutive bands (nothing above the top band, like the
   * single-level statics). A band that is a stair flight gets no box under it here (tread pieces
   * build that). `wall`: no band at all (a full-height wall box). Flat floors (cell centre value).
   */
  columnSolids(cx: number, cy: number, base: number): {wall: boolean; ramp: boolean; solids: Solid[]} {
    const g0 = this.grid;
    if (!g0.inBounds(cx, cy)) return {wall: true, ramp: false, solids: []};
    const i = cy * g0.w + cx;
    const bands: {f: number; c: number; ramp: boolean}[] = [];
    for (const g of this.grids) {
      if (!isOpen(g, i)) continue;
      const ramp = g.rampIdx[i] >= 0;
      const f = ramp ? -Infinity : g.cells[i] === VOID && g.floor[i] === 0 ? this.trenchY : g.floorOf(i);
      // ramp bands: their lowest point in the cell bounds the slab below (treads fill the rest)
      let fr = f;
      if (ramp) { const R = g.ramps[g.rampIdx[i]]; const a = (R.axis === 'x' ? cx : cy) * CELL; fr = Math.min(rampLow(R, a), rampLow(R, a + CELL)); }
      const c = g.hasCeil(i) ? (ramp ? Math.min(g.ceil[i], rampHigh(g.ramps[g.rampIdx[i]], cx, cy) + g.ramps[g.rampIdx[i]].headroom) : g.ceil[i]) : Infinity;
      bands.push({f: fr, c, ramp});
    }
    if (!bands.length) return {wall: true, ramp: false, solids: []};
    bands.sort((a, b) => a.f - b.f);
    // merge overlapping / duplicate bands (a flight carved into two levels)
    const merged: {f: number; c: number; ramp: boolean}[] = [];
    for (const b of bands) {
      const p = merged[merged.length - 1];
      if (p && b.f <= p.c + 1e-4) { p.c = Math.max(p.c, b.c); p.ramp ||= b.ramp; }
      else merged.push({...b});
    }
    const solids: Solid[] = [];
    let below = base;
    let ramp = false;
    for (const b of merged) {
      if (b.ramp) ramp = true;
      else if (b.f > below + 1e-4) solids.push({y0: below, y1: b.f});
      below = b.c;
      if (!Number.isFinite(below)) break;
    }
    return {wall: false, ramp, solids};
  }

  /** Iteration 08: greedy-merge key of a column profile (equal keys merge into one box set). */
  columnKey(cx: number, cy: number, base: number): string {
    const p = this.columnSolids(cx, cy, base);
    if (p.wall) return 'w';
    return (p.ramp ? 'r' : 'f') + p.solids.map(s => `${Math.round(s.y0 * 1000)}:${Math.round(s.y1 * 1000)}`).join(',');
  }

  /**
   * Iteration 08: every distinct stair ramp across the levels (a flight carved into two grids is one
   * ramp) with the ceiling of the band below it at its lowest (tread boxes start there; `base` when
   * nothing lies under the flight).
   */
  ramps(base: number): {ramp: Ramp; bottom: number}[] {
    const seen = new Set<string>();
    const out: {ramp: Ramp; bottom: number}[] = [];
    for (const g of this.grids) {
      for (const r of g.ramps) {
        const k = `${r.x},${r.y},${r.w},${r.h},${r.axis},${r.s0},${r.s1},${r.h0},${r.h1}`;
        if (seen.has(k)) continue;
        // a ramp registered in a grid but not carved there (index alignment) has no cells
        const i0 = g.idx(r.x, r.y);
        if (g.rampIdx[i0] < 0 || g.ramps[g.rampIdx[i0]] !== r) continue;
        seen.add(k);
        let bottom = base;
        const lowest = Math.min(r.h0, r.h1);
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
          const i = g.idx(x, y);
          for (const h of this.grids) {
            if (h === g || !isOpen(h, i) || h.rampIdx[i] >= 0) continue;
            const c = h.hasCeil(i) ? h.ceil[i] : Infinity;
            if (c <= lowest + 1e-3 && c > bottom) bottom = c;
          }
        }
        out.push({ramp: r, bottom});
      }
    }
    return out;
  }

  /** Iteration 08: railings (levels.ts) — static boxes for ragdolls / items / chunks. */
  get rails(): readonly RailRun[] {
    return this.levels.rails;
  }
}

function rampLow(R: Ramp, s: number): number {
  const t = (s - R.s0) / (R.s1 - R.s0);
  return R.h0 + (R.h1 - R.h0) * (t < 0 ? 0 : t > 1 ? 1 : t);
}
function rampHigh(R: Ramp, cx: number, cy: number): number {
  const a = (R.axis === 'x' ? cx : cy) * CELL;
  return Math.max(rampLow(R, a), rampLow(R, a + CELL));
}

