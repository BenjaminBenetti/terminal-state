// Task reactor-playtest-round2-20261102 (lane BUNKER): the LOCAL OCCUPANCY engine of the bunker's seeded room graph (./bunkerPlan.ts).
// Pure data, no Kit: room rects of the wall-local frame (u along the pit wall, v into the rock; cells 0.5 m) with exactly one wall cell
// between neighbours. A summed-area table answers "does this rect + its one-cell wall ring stay clear of every room" in O(1), so the
// planner can score thousands of candidate rooms per level inside the gen budget.

/** A local rect: u / v of its first cell, w cells along u, h cells along v. */
export interface LRect { u: number; v: number; w: number; h: number }
/** A wall of a local rect: the low / high u side (a wall column) or the low / high v side (a wall row). */
export type LSide = 'u-' | 'u+' | 'v-' | 'v+';
export const LSIDES: readonly LSide[] = ['u-', 'u+', 'v-', 'v+'];

/**
 * Room cells (id + 1) over u in [0, A), v in [0, Vd). Rooms keep u in [1, A - 1) (one wall cell inside the region's along edges) and
 * v in [0, Vd) (v = -1 is the pit wall, v = Vd the far wall row): anything outside counts as BLOCKED rock.
 */
export class Occ {
  readonly cells: Int16Array;
  private readonly sat: Int32Array;
  private dirty = true;
  constructor(readonly A: number, readonly Vd: number) {
    this.cells = new Int16Array(A * Vd);
    this.sat = new Int32Array((A + 1) * (Vd + 1));
  }

  /** Room id at a cell (-1 outside the grid, -1 for free too: `cells` holds id + 1). */
  at(u: number, v: number): number {
    if (u < 0 || v < 0 || u >= this.A || v >= this.Vd) return -1;
    return this.cells[v * this.A + u] - 1;
  }

  mark(r: LRect, id: number): void {
    for (let v = r.v; v < r.v + r.h; v++) for (let u = r.u; u < r.u + r.w; u++) this.cells[v * this.A + u] = id + 1;
    this.dirty = true;
  }

  /** Frees a rect's cells again (an undone placement). */
  clear(r: LRect): void { this.mark(r, -1); }

  /** Any room cell in [u0, u1) x [v0, v1) (clipped; a direct scan: no table rebuild, for one-cell growth steps). */
  anyIn(u0: number, v0: number, u1: number, v1: number): boolean {
    u0 = Math.max(0, u0); v0 = Math.max(0, v0); u1 = Math.min(this.A, u1); v1 = Math.min(this.Vd, v1);
    for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) if (this.cells[v * this.A + u]) return true;
    return false;
  }

  private build(): void {
    const {A, Vd, cells, sat} = this, W = A + 1;
    for (let v = 0; v < Vd; v++) {
      let run = 0;
      for (let u = 0; u < A; u++) {
        run += cells[v * A + u] ? 1 : 0;
        sat[(v + 1) * W + u + 1] = sat[v * W + u + 1] + run;
      }
    }
    this.dirty = false;
  }

  /** Room cells in [u0, u1) x [v0, v1), clipped to the grid. */
  occ(u0: number, v0: number, u1: number, v1: number): number {
    u0 = Math.max(0, u0); v0 = Math.max(0, v0); u1 = Math.min(this.A, u1); v1 = Math.min(this.Vd, v1);
    if (u1 <= u0 || v1 <= v0) return 0;
    if (this.dirty) this.build();
    const W = this.A + 1, s = this.sat;
    return s[v1 * W + u1] - s[v0 * W + u1] - s[v1 * W + u0] + s[v0 * W + u0];
  }

  /** The rect lies in the room zone (u in [1, A - 1), v in [0, Vd)). */
  inside(r: LRect): boolean {
    return r.w > 0 && r.h > 0 && r.u >= 1 && r.v >= 0 && r.u + r.w <= this.A - 1 && r.v + r.h <= this.Vd;
  }

  /** In the room zone, and the rect + its one-cell wall ring holds no room cell (walls between neighbours are shared). */
  fits(r: LRect): boolean {
    return this.inside(r) && this.occ(r.u - 1, r.v - 1, r.u + r.w + 1, r.v + r.h + 1) === 0;
  }

  /** Blocked cells of a strip [u0, u1) x [v0, v1): room cells + every cell outside the room zone. */
  blocked(u0: number, v0: number, u1: number, v1: number): number {
    if (u1 <= u0 || v1 <= v0) return 0;
    const cu0 = Math.max(u0, 1), cv0 = Math.max(v0, 0), cu1 = Math.min(u1, this.A - 1), cv1 = Math.min(v1, this.Vd);
    const zone = cu1 > cu0 && cv1 > cv0 ? (cu1 - cu0) * (cv1 - cv0) : 0;
    return (u1 - u0) * (v1 - v0) - zone + (zone ? this.occ(cu0, cv0, cu1, cv1) : 0);
  }

  /** The strip `d` cells beyond side `s` of `r` (d = 1: its wall ring), along the side's span. */
  strip(r: LRect, s: LSide, d: number, dd = 1): [number, number, number, number] {
    switch (s) {
      case 'u-': return [r.u - d - dd + 1, r.v, r.u - d + 1, r.v + r.h];
      case 'u+': return [r.u + r.w + d - 1, r.v, r.u + r.w + d - 1 + dd, r.v + r.h];
      case 'v-': return [r.u, r.v - d - dd + 1, r.u + r.w, r.v - d + 1];
      default: return [r.u, r.v + r.h + d - 1, r.u + r.w, r.v + r.h + d - 1 + dd];
    }
  }

  /** Snugness: the share of the ring two cells out (just beyond one wall cell) that is blocked — a packed plan wastes no rock. */
  contact(r: LRect): number {
    let n = 0;
    for (const s of LSIDES) n += this.blocked(...this.strip(r, s, 2));
    return n / (2 * (r.w + r.h));
  }

  /**
   * Wasted rock beside a rect (cells): per side, a free band 1..9 cells deep between its wall and the next mostly-blocked strip is too
   * thin for a room (8 cells + its wall) and stays solid. `sides` limits the sides (a corridor's long sides).
   */
  sliver(r: LRect, sides: readonly LSide[] = LSIDES): number {
    let waste = 0;
    for (const s of sides) {
      const len = s === 'u-' || s === 'u+' ? r.h : r.w;
      for (let d = 2; d <= 11; d++) {
        if (this.blocked(...this.strip(r, s, d)) * 2 < len) continue;
        if (d >= 3) waste += (d - 2) * len;
        break;
      }
    }
    return waste;
  }

  /** Free (unblocked) cells in the band 2..k + 1 cells beyond the given sides (room potential round a corridor). */
  free(r: LRect, sides: readonly LSide[], k: number): number {
    let n = 0;
    for (const s of sides) {
      const [u0, v0, u1, v1] = this.strip(r, s, 2, k);
      n += (u1 - u0) * (v1 - v0) - this.blocked(u0, v0, u1, v1);
    }
    return n;
  }
}

/** The one-cell wall between two rects (null when they are not exactly one wall cell apart with an overlap). */
export function sharedWall(a: LRect, b: LRect): {col: boolean; line: number; s0: number; s1: number} | null {
  if (a.u + a.w + 1 === b.u || b.u + b.w + 1 === a.u) {
    const s0 = Math.max(a.v, b.v), s1 = Math.min(a.v + a.h, b.v + b.h);
    return s1 > s0 ? {col: true, line: a.u + a.w + 1 === b.u ? a.u + a.w : b.u + b.w, s0, s1} : null;
  }
  if (a.v + a.h + 1 === b.v || b.v + b.h + 1 === a.v) {
    const s0 = Math.max(a.u, b.u), s1 = Math.min(a.u + a.w, b.u + b.w);
    return s1 > s0 ? {col: false, line: a.v + a.h + 1 === b.v ? a.v + a.h : b.v + b.h, s0, s1} : null;
  }
  return null;
}

/** Which side of `a` the wall shared with `b` is (null: none). */
export function sideToward(a: LRect, b: LRect): LSide | null {
  if (a.u + a.w + 1 === b.u) return 'u+';
  if (b.u + b.w + 1 === a.u) return 'u-';
  if (a.v + a.h + 1 === b.v) return 'v+';
  if (b.v + b.h + 1 === a.v) return 'v-';
  return null;
}
