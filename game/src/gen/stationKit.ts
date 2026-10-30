// Carving toolkit for the station generator (pure data, no three.js): areas, doors, attachment of
// rooms to walls, track blocks (side / island / express) and their trenches. Archetypes in
// archetypes.ts compose these into recognisably different station structures.

import type {Rng} from '../core/rng';
import {CELL, FLOOR, Grid, SOLID, VOID} from './grid';
import type {StairFlight, Underpass} from './traversal';
import type {LevelPlan} from './levelGen';
import {
  GEN_H, GEN_W, SINGLE_BED_CELLS, TRACK_BED_CELLS, TRENCH_DEPTH,
  type Area, type AreaKind, type AreaRole, type Door, type Rect, type RoomType, type Side, type Trench,
} from './stationTypes';

export const ROOM_LABEL: Record<RoomType, string> = {
  'platform': 'Platform', 'passage': 'Stair passage', 'underpass': 'Underpass', 'concourse': 'Concourse',
  'fare-hall': 'Ticket hall', 'food-court': 'Food court', 'retail-arcade': 'Retail arcade', 'exit-stair': 'Street exit (closed)',
  'washroom': 'Washroom', 'service-corridor': 'Service corridor',
  'agent-office': 'Station agent office', 'storage': 'Storage room', 'stock-room': 'Stock room', 'crew-room': 'Crew room',
  'utility': 'Utility room', 'supply-closet': 'Supply closet', 'janitor-closet': 'Janitor closet',
  'eatery': 'Food counter', 'shop': 'Shop', 'stair-core': 'Stairs',
  // Iteration 16 (WORLD-GEN): office tower areas (gen/office/*; purposes give the final labels).
  'office-lobby': 'Lobby', 'office-corridor': 'Corridor', 'office-open': 'Open-plan office', 'office-room': 'Office',
  'office-elevator': 'Elevator', 'office-stair': 'Stairwell',
  // Task office-overhaul-20261030 (lane STRUCT): the open-sky roof deck of the tower.
  'office-roof': 'Roof',
};

export type Wing = 'food' | 'north' | 'agent' | 'misc';

export interface AreaOpts {
  label?: string; publicSpace?: boolean; paid?: boolean; role?: AreaRole;
  /** Iteration 08 (Lane A): level grid the area is carved into (default 0 = main) and its absolute floor there. */
  level?: number; floorY?: number;
  /** Extra level grids that carry the same cells (stair runs between levels). */
  also?: number[];
}

/** Track bed in cells (converted to a world-space Trench after cropping). */
export interface TrenchCells { x0: number; x1: number; y0: number; y1: number; px0: number; px1: number; tracks: number[]; third: number[]; columns: boolean; ceil: number }

export interface TrackBlock {
  kind: 'side' | 'island' | 'express';
  /** Platform areas, south-most first for side blocks (P1 = south platform). */
  platforms: Area[];
  trenches: TrenchCells[];
  px0: number; px1: number;
  /** Track-bed extent in X (tunnels continue TUN cells beyond the platform ends). */
  tx0: number; tx1: number;
  /** Outer rows of the block (first and last row, inclusive). */
  y0: number; y1: number;
}

/** Track continues this far (cells) into the tunnel beyond each platform end. */
export const TUN = 12;

/** Seamless office (lane GEN): canvas options. Defaults = the Subway's (3 level grids of GEN_W x GEN_H). */
export interface KitOptions {
  /** Number of level canvases (default 3: main, upper, lower). The office tower uses 9 (station, lobby, floors 2..8). */
  levels?: number;
  /** Canvas size in cells (default GEN_W x GEN_H); a smaller canvas keeps N level grids cheap. */
  w?: number; h?: number;
}

export class Kit {
  readonly g: Grid;
  /**
   * Iteration 08 (Lane A): canvases of every level (0 = main = g, 1 = upper, 2 = lower), same size,
   * sharing ONE ramps list (a stair between levels has the same ramp index in every grid).
   * Seamless office: N level canvases (KitOptions.levels), all sharing that ramps list.
   */
  readonly levelGrids: Grid[];
  readonly areas: Area[] = [];
  readonly doors: Door[] = [];
  readonly trenches: TrenchCells[] = [];
  /** Iteration 05 (Lane T): stair flights and underpasses (canvas coordinates until the crop). */
  readonly flights: StairFlight[] = [];
  readonly underpasses: Underpass[] = [];
  readonly wing = new Map<number, Wing>();
  /** Wall cells that later doors must not cut through (storefront fronts and their piers). */
  readonly reserved: Uint8Array;
  /** Iteration 08 (Lane A): main-level cells that must stay rock (an upper-only landing sits above them). */
  readonly keepRock: Uint8Array;
  /** Iteration 08 (Lane A): the multi-level program of the station (gen/levelGen.ts), canvas coordinates. */
  levelPlan: LevelPlan | null = null;
  constructor(readonly rng: Rng, opts: KitOptions = {}) {
    const W = opts.w ?? GEN_W, H = opts.h ?? GEN_H, n = Math.max(1, opts.levels ?? 3);
    this.g = new Grid(W, H);
    this.reserved = new Uint8Array(W * H);
    this.keepRock = new Uint8Array(W * H);
    this.levelGrids = [this.g];
    for (let i = 1; i < n; i++) {
      const L = new Grid(W, H);
      L.ramps = this.g.ramps;
      this.levelGrids.push(L);
    }
  }

  /** Grid of a level (0 = main). */
  grid(level = 0): Grid {
    return this.levelGrids[level];
  }

  reserve(r: Rect): void {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.g.inBounds(x, y)) this.reserved[this.g.idx(x, y)] = 1;
  }

  private gapReserved(r: Rect): boolean {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.reserved[this.g.idx(x, y)]) return true;
    return false;
  }

  addArea(r: Rect, kind: AreaKind, type: RoomType, ceil: number, parent: number, opts: AreaOpts = {}): Area {
    const a: Area = {
      ...r, id: this.areas.length, kind, type, label: opts.label ?? ROOM_LABEL[type], ceil, parent,
      depth: parent >= 0 ? this.areas[parent].depth + 1 : 0,
      publicSpace: opts.publicSpace ?? (kind === 'platform' || kind === 'passage' || kind === 'concourse'),
      lighting: 'lit',
    };
    if (opts.paid) a.paid = true;
    if (opts.role) a.role = opts.role;
    const level = opts.level ?? 0;
    if (level !== 0) { a.level = level; a.floorY = opts.floorY ?? 0; }
    else if (opts.floorY !== undefined) a.floorY = opts.floorY;
    this.areas.push(a);
    // Iteration 08: off the main level the cells carry the level's absolute floor.
    const floor = level !== 0 ? a.floorY! : null;
    for (const L of [level, ...(opts.also ?? [])]) {
      const g = this.levelGrids[L];
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const i = g.idx(x, y);
          g.cells[i] = FLOOR;
          g.area[i] = a.id;
          g.ceil[i] = ceil;
          if (floor !== null) g.floor[i] = floor;
        }
      }
    }
    return a;
  }

  /** Removes the most recently added area (its cells return to rock). */
  undoLast(a: Area): void {
    if (this.areas[this.areas.length - 1] !== a) throw new Error('undoLast: not the last area');
    const g = this.levelGrids[a.level ?? 0];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { const i = g.idx(x, y); g.cells[i] = SOLID; g.area[i] = -1; g.ceil[i] = 0; g.floor[i] = 0; }
    this.areas.pop();
    this.wing.delete(a.id);
  }

  /** Rect plus a one-cell wall margin is untouched rock, inside the canvas border (main level unless `level`). */
  rectFree(r: Rect, level = 0): boolean {
    const g = this.levelGrids[level];
    if (r.w < 1 || r.h < 1) return false;
    if (r.x - 1 < 1 || r.y - 1 < 1 || r.x + r.w + 1 > g.w - 1 || r.y + r.h + 1 > g.h - 1) return false;
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) if (g.cells[g.idx(x, y)] !== SOLID) return false;
    // Iteration 08: main-level rock under upper-only landings stays rock.
    if (level === 0) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.keepRock[g.idx(x, y)]) return false;
    return true;
  }

  /** Every cell of the rect is rock (no margin). */
  solid(r: Rect, level = 0): boolean {
    const g = this.levelGrids[level];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!g.inBounds(x, y) || g.cells[g.idx(x, y)] !== SOLID || (level === 0 && this.keepRock[g.idx(x, y)])) return false;
    return true;
  }

  /**
   * Opening between two areas (cells join b). Iteration 08: carved on the level of `a` (both areas
   * share it); `height` is relative to that level's floor, grid ceilings stay absolute.
   */
  carveDoor(gap: Rect, a: Area, b: Area, height: number, arch: boolean, extra: Partial<Door> = {}): Door {
    const level = a.level ?? 0;
    const base = level !== 0 ? a.floorY ?? 0 : 0;
    const h = Math.min(height, a.ceil - base, b.ceil - base);
    const g = this.levelGrids[level];
    for (let y = gap.y; y < gap.y + gap.h; y++) {
      for (let x = gap.x; x < gap.x + gap.w; x++) {
        const i = g.idx(x, y);
        g.cells[i] = FLOOR;
        g.area[i] = b.id;
        g.ceil[i] = base + h;
        if (level !== 0) g.floor[i] = base;
      }
    }
    const d: Door = {...gap, id: this.doors.length, a: a.id, b: b.id, height: h, arch, ...extra};
    if (level !== 0) d.level = level;
    this.doors.push(d);
    return d;
  }

  /** Shared wall (one cell) between two areas: orientation + span of overlap, or null. */
  sharedWall(a: Rect, b: Rect): {horizontal: boolean; line: number; s0: number; s1: number} | null {
    if (a.y + a.h + 1 === b.y || b.y + b.h + 1 === a.y) {
      const s0 = Math.max(a.x, b.x), s1 = Math.min(a.x + a.w, b.x + b.w);
      if (s1 <= s0) return null;
      return {horizontal: true, line: a.y + a.h + 1 === b.y ? a.y + a.h : b.y + b.h, s0, s1};
    }
    if (a.x + a.w + 1 === b.x || b.x + b.w + 1 === a.x) {
      const s0 = Math.max(a.y, b.y), s1 = Math.min(a.y + a.h, b.y + b.h);
      if (s1 <= s0) return null;
      return {horizontal: false, line: a.x + a.w + 1 === b.x ? a.x + a.w : b.x + b.w, s0, s1};
    }
    return null;
  }

  /** Opening in the shared wall between two areas separated by exactly one wall cell. */
  wallGap(a: Rect, b: Rect, width: number, pick: 'mid' | 'rand' | 'lo' | 'hi' | number = 'rand', margin = 1): Rect | null {
    const w = this.sharedWall(a, b);
    if (!w) return null;
    const lo = w.s0 + margin, hi = w.s1 - margin - width;
    if (hi < lo) return null;
    let s: number;
    if (pick === 'mid') s = Math.floor((lo + hi) / 2);
    else if (pick === 'lo') s = lo;
    else if (pick === 'hi') s = hi;
    else if (typeof pick === 'number') s = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * pick)));
    else s = this.rng.int(lo, hi);
    const at = (q: number): Rect => (w.horizontal ? {x: q, y: w.line, w: width, h: 1} : {x: w.line, y: q, w: 1, h: width});
    if (!this.gapReserved(at(s))) return at(s);
    // Slide off reserved storefront walls to the nearest free position.
    for (let d = 1; d <= hi - lo; d++) for (const q of [s - d, s + d]) if (q >= lo && q <= hi && !this.gapReserved(at(q))) return at(q);
    return null;
  }

  /** Door between two areas through their shared wall (null if they do not share one wide enough). */
  connect(a: Area, b: Area, width: number, height: number, opts: {arch?: boolean; pick?: 'mid' | 'rand' | 'lo' | 'hi' | number; margin?: number; extra?: Partial<Door>} = {}): Door | null {
    const w = this.sharedWall(a, b);
    if (!w) return null;
    const span = w.s1 - w.s0 - 2 * (opts.margin ?? 1);
    const width2 = Math.min(width, span);
    if (width2 < 2) return null;
    const gap = this.wallGap(a, b, width2, opts.pick ?? 'rand', opts.margin ?? 1);
    if (!gap) return null;
    return this.carveDoor(gap, a, b, height, opts.arch ?? true, opts.extra);
  }

  /**
   * Rect adjacent to `parent` on `side` (one wall cell between): `along` cells along that wall,
   * `deep` cells away from it, its centre offset `offset` cells from the wall's centre.
   */
  adjacent(parent: Rect, side: Side, along: number, deep: number, offset = 0): Rect {
    if (side === 'N' || side === 'S') {
      const x = Math.round(parent.x + parent.w / 2 + offset - along / 2);
      return {x, y: side === 'S' ? parent.y + parent.h + 1 : parent.y - 1 - deep, w: along, h: deep};
    }
    const y = Math.round(parent.y + parent.h / 2 + offset - along / 2);
    return {x: side === 'E' ? parent.x + parent.w + 1 : parent.x - 1 - deep, y, w: deep, h: along};
  }

  /** Carves an adjacent area if the rect is free (tries a few offsets). Does not connect. */
  attach(parent: Rect, side: Side, along: number, deep: number, offset: number, kind: AreaKind, type: RoomType, ceil: number, parentId: number, opts: AreaOpts = {}, slide = true): Area | null {
    const tries = slide ? [0, 6, -6, 14, -14, 24, -24, 36, -36] : [0];
    for (const dt of tries) {
      const r = this.adjacent(parent, side, along, deep, offset + dt);
      if (this.rectFree(r)) return this.addArea(r, kind, type, ceil, parentId, opts);
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------
  // Track blocks

  private bed(x0: number, x1: number, y0: number, rows: number, ceil: number, tracks: number[], third: number[], columns: boolean): TrenchCells {
    const g = this.g;
    for (let y = y0; y < y0 + rows; y++) for (let x = x0; x < x1; x++) { const i = g.idx(x, y); g.cells[i] = VOID; g.ceil[i] = ceil; g.floor[i] = -TRENCH_DEPTH; }
    g.voidFloor = -TRENCH_DEPTH;
    const t: TrenchCells = {x0, x1, y0, y1: y0 + rows, px0: 0, px1: 0, tracks, third, columns, ceil};
    this.trenches.push(t);
    return t;
  }

  /** Two side platforms on a two-track bed: P2 north (edge S), P1 south (edge N). */
  sideBlock(px0: number, y0: number, Lp: number, ceil: number, labels: [string, string] = ['Platform 1', 'Platform 2']): TrackBlock {
    const rng = this.rng;
    const W2 = rng.int(14, 17), W1 = rng.int(15, 18);
    const px1 = px0 + Lp, tx0 = px0 - TUN, tx1 = px1 + TUN;
    const ty0 = y0 + W2, ty1 = ty0 + TRACK_BED_CELLS;
    const t = this.bed(tx0, tx1, ty0, TRACK_BED_CELLS, ceil, [ty0 * CELL + 2.0, ty0 * CELL + 6.0], [1, -1], true);
    t.px0 = px0; t.px1 = px1;
    const P1 = this.addArea({x: px0, y: ty1, w: Lp, h: W1}, 'platform', 'platform', ceil, -1, {label: labels[0], paid: true});
    P1.edge = 'N';
    const P2 = this.addArea({x: px0, y: y0, w: Lp, h: W2}, 'platform', 'platform', ceil, -1, {label: labels[1], paid: true});
    P2.edge = 'S';
    return {kind: 'side', platforms: [P1, P2], trenches: [t], px0, px1, tx0, tx1, y0, y1: ty1 + W1 - 1};
  }

  /** One island platform between two one-track beds. */
  islandBlock(px0: number, y0: number, Lp: number, ceil: number, label = 'Island platform'): TrackBlock {
    const rng = this.rng;
    const IW = rng.int(20, 26);
    const px1 = px0 + Lp, tx0 = px0 - TUN, tx1 = px1 + TUN;
    const S = SINGLE_BED_CELLS;
    const n = this.bed(tx0, tx1, y0, S, ceil, [(y0 + S) * CELL - 2.0], [-1], false);
    const I = this.addArea({x: px0, y: y0 + S, w: Lp, h: IW}, 'platform', 'platform', ceil, -1, {label, paid: true});
    I.edge = 'NS';
    const s = this.bed(tx0, tx1, y0 + S + IW, S, ceil, [(y0 + S + IW) * CELL + 2.0], [1], false);
    for (const t of [n, s]) { t.px0 = px0; t.px1 = px1; }
    return {kind: 'island', platforms: [I], trenches: [n, s], px0, px1, tx0, tx1, y0, y1: y0 + 2 * S + IW - 1};
  }

  /** Four-track express station: local | island A | express ×2 | island B | local. */
  expressBlock(px0: number, y0: number, Lp: number, ceil: number): TrackBlock {
    const rng = this.rng;
    const IA = rng.int(18, 22), IB = rng.int(18, 22);
    const px1 = px0 + Lp, tx0 = px0 - TUN, tx1 = px1 + TUN;
    const S = SINGLE_BED_CELLS, D = TRACK_BED_CELLS;
    let y = y0;
    const n = this.bed(tx0, tx1, y, S, ceil, [(y + S) * CELL - 2.0], [-1], false); y += S;
    const A = this.addArea({x: px0, y, w: Lp, h: IA}, 'platform', 'platform', ceil, -1, {label: 'Platforms 1 · 2 (local · express)', paid: true}); y += IA;
    A.edge = 'NS';
    const m = this.bed(tx0, tx1, y, D, ceil, [y * CELL + 2.0, y * CELL + 6.0], [1, -1], true); y += D;
    const B = this.addArea({x: px0, y, w: Lp, h: IB}, 'platform', 'platform', ceil, -1, {label: 'Platforms 3 · 4 (express · local)', paid: true}); y += IB;
    B.edge = 'NS';
    const s = this.bed(tx0, tx1, y, S, ceil, [y * CELL + 2.0], [1], false); y += S;
    for (const t of [n, m, s]) { t.px0 = px0; t.px1 = px1; }
    return {kind: 'express', platforms: [B, A], trenches: [n, m, s], px0, px1, tx0, tx1, y0, y1: y - 1};
  }

  /**
   * Stair passage leaving a platform's end wall along X, between the tunnel walls, into whatever
   * lies beyond the track end (an end hall). Returns the passage (paid) or null.
   */
  endPassage(blk: TrackBlock, P: Area, side: 'W' | 'E', beyond: number, width?: number): Area | null {
    const w = Math.min(width ?? this.rng.int(10, 13), P.h - 4);
    const y = P.y + Math.floor((P.h - w) / 2);
    const len = TUN + beyond;
    const r: Rect = side === 'E' ? {x: blk.px1 + 1, y, w: len, h: w} : {x: blk.px0 - 1 - len, y, w: len, h: w};
    if (!this.rectFreeExcept(r, side === 'E' ? r.x - 1 : r.x + r.w)) return null;
    const a = this.addArea(r, 'passage', 'passage', 3.4, P.id, {label: 'Stair passage', paid: true, role: 'end-stair'});
    this.carveDoor({x: side === 'E' ? blk.px1 : blk.px0 - 1, y: y + 1, w: 1, h: w - 2}, P, a, 3.2, true);
    return a;
  }

  /** rectFree, ignoring the margin column `col` (the wall shared with the platform it leaves from). */
  private rectFreeExcept(r: Rect, col: number): boolean {
    const g = this.g;
    if (r.x - 1 < 1 || r.y - 1 < 1 || r.x + r.w + 1 > g.w - 1 || r.y + r.h + 1 > g.h - 1) return false;
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (x === col && y >= r.y && y < r.y + r.h) continue;
      if (g.cells[g.idx(x, y)] !== SOLID) return false;
    }
    return true;
  }

  /**
   * Stair passages from a platform's back wall (side = direction away from the tracks).
   * Spread across [f0, f1] of the platform length.
   */
  stairPassages(P: Area, side: 'N' | 'S', n: number, f0: number, f1: number, len: number): Area[] {
    const rng = this.rng;
    const span0 = P.x + Math.floor(P.w * f0), span1 = P.x + Math.floor(P.w * f1);
    const seg = (span1 - span0) / n;
    const out: Area[] = [];
    for (let i = 0; i < n; i++) {
      const cw = rng.int(8, 10);
      let ex = span0 + Math.floor(seg * i + rng.range(1, Math.max(2, seg - cw - 2)));
      const at = (x: number): Rect => (side === 'S' ? {x, y: P.y + P.h + 1, w: cw, h: len} : {x, y: P.y - 1 - len, w: cw, h: len});
      // Iteration 08 (Lane A): slide (within this passage's segment) off rock already taken, e.g. a stair core.
      if (!this.rectFree(at(ex))) {
        const lo = span0 + Math.floor(seg * i), hi = span0 + Math.floor(seg * (i + 1)) - cw;
        let found = -1;
        for (let dd = 1; dd <= hi - lo && found < 0; dd++) for (const q of [ex - dd, ex + dd]) if (q >= lo && q <= hi && this.rectFree(at(q))) { found = q; break; }
        if (found < 0) continue;
        ex = found;
      }
      const r = at(ex);
      const p = this.addArea(r, 'passage', 'passage', 3.4, P.id, {paid: true, role: 'stair'});
      this.carveDoor({x: ex, y: side === 'S' ? P.y + P.h : P.y - 1, w: cw, h: 1}, P, p, 3.2, true);
      out.push(p);
    }
    return out;
  }

  /**
   * Hall spanning a set of passages on their far side (mezzanine): from the westmost passage to
   * the eastmost, extended by `extW`/`extE` cells; every passage opens into it.
   */
  mezzanine(passages: Area[], side: 'N' | 'S', deep: number, ext: [number, number], ceil: number, opts: AreaOpts): Area | null {
    if (!passages.length) return null;
    const x0 = Math.min(...passages.map(p => p.x)) - ext[0];
    const x1 = Math.max(...passages.map(p => p.x + p.w)) + ext[1];
    const p0 = passages[0];
    const y = side === 'S' ? p0.y + p0.h + 1 : p0.y - 1 - deep;
    const r: Rect = {x: x0, y, w: x1 - x0, h: deep};
    if (!this.rectFree(r)) return null;
    const M = this.addArea(r, 'concourse', 'concourse', ceil, p0.id, opts);
    for (const p of passages) this.carveDoor({x: p.x, y: side === 'S' ? y - 1 : y + deep, w: p.w, h: 1}, p, M, 3.2, true);
    return M;
  }

  /** Fare line: gate array in the shared wall of the paid hall and the unpaid hall (width 3k+2 cells). */
  fareLine(paid: Area, hall: Area, k: number, pick: 'mid' | 'rand' | number = 'rand'): Door | null {
    const w = this.sharedWall(paid, hall);
    if (!w) return null;
    for (let kk = k; kk >= 3; kk--) {
      const width = 3 * kk + 2;
      const lo = w.s0 + 5, hi = w.s1 - 5 - width;
      if (hi < lo) continue;
      const s = pick === 'mid' ? Math.floor((lo + hi) / 2) : typeof pick === 'number' ? Math.round(lo + (hi - lo) * pick) : this.rng.int(lo, hi);
      const gap: Rect = w.horizontal ? {x: s, y: w.line, w: width, h: 1} : {x: w.line, y: s, w: 1, h: width};
      return this.carveDoor(gap, paid, hall, 3.2, true, {fare: true});
    }
    return null;
  }

  /** Converts trench cells to world space after cropping by (ox, oy). */
  static trenchWorld(t: TrenchCells, ox: number, oy: number): Trench {
    const dz = oy * CELL;
    return {
      x0: (t.x0 - ox) * CELL, x1: (t.x1 - ox) * CELL, z0: (t.y0 - oy) * CELL, z1: (t.y1 - oy) * CELL, floorY: -TRENCH_DEPTH,
      platformX0: (t.px0 - ox) * CELL, platformX1: (t.px1 - ox) * CELL,
      tracks: t.tracks.map(z => z - dz), third: t.third.slice(), columns: t.columns, ceil: t.ceil,
    };
  }
}

export function sideOf(a: Rect, b: Rect): Side | null {
  if (a.y + a.h + 1 === b.y) return 'S';
  if (b.y + b.h + 1 === a.y) return 'N';
  if (a.x + a.w + 1 === b.x) return 'E';
  if (b.x + b.w + 1 === a.x) return 'W';
  return null;
}

export const OPPOSITE: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
export const LATERAL: Record<Side, [Side, Side]> = {N: ['W', 'E'], S: ['W', 'E'], E: ['N', 'S'], W: ['N', 'S']};
