// Iteration 08 (Lane G): multi-level station geometry in the union-of-open-columns model
// (gen/levels.ts). Pure data + math (no three.js): the world builder renders from it, the wall
// treatment pass (Lane W) receives its WallFace[] and gameplay can reuse the derived railings.
//
// A column (grid cell) is free at height y when some level has an open cell there whose band
// [floor, ceil] contains y. Everything visible follows from that one rule:
// - WALLS: for every cell edge, each open band of the cell minus the free bands of the neighbour
//   column = the faces visible from that band (merged into straight runs). So a level's wall exists
//   only where its open cell borders closed space within its own band; nothing is drawn through
//   another level's open band; slab fascias (between a neighbour's lower ceiling and upper floor),
//   soffits, platform faces, stair-core walls and double-height voids all fall out of the rule.
//   Stair flights carved into two level grids (LevelLink) are one band, not two.
// - CEILINGS: every open band's ceiling, unless another band continues straight up from it.
// - RAILINGS: walkable edges whose neighbour column is free at standing height but drops away
//   (mezzanine/catwalk edges, light wells, stairwells, open flight sides). Platform edges onto the
//   track bed are deliberately not railed.

import {CELL, FLOOR, STEP_UP, VOID, rampHeight, type Grid, type Ramp} from '../gen/grid';
import type {Level, LevelLink} from '../gen/levels';
import type {Area, StationLayout} from '../gen/station';
import type {WallFace, WallZone} from './wallFaces';

// ---------------------------------------------------------------------------------------------
// Layout access (fields Lane A adds; absent on single-level layouts)

/** Every level of a station (levels[0] = main = layout.grid); a single main level when absent. */
export function stationLevels(layout: Pick<StationLayout, 'grid'>): Level[] {
  const ls = (layout as {levels?: Level[]}).levels;
  return ls && ls.length ? ls : [{id: 0, role: 'main', grid: layout.grid, baseY: 0}];
}

export function stationLinks(layout: object): LevelLink[] {
  return (layout as {levelLinks?: LevelLink[]}).levelLinks ?? [];
}

/** Level of an area / placement (0 = main when unset). */
export function levelOf(o: object | undefined | null): number {
  return (o as {level?: number} | undefined)?.level ?? 0;
}

/** Ceiling used when a hand-built grid leaves a cell's ceiling unset. */
export const DEFAULT_CEIL = 4.4;
/** Side walls of a stair flight reach this far below the pitch line (hidden under the treads). */
export const WALL_SKIRT = 0.35;
/** Drops deeper than this at a walkable edge get a railing (m). */
export const RAIL_DROP = 0.55;
/** Guard rail height above the walking surface (m). */
export const RAIL_HEIGHT = 1.05;
/** Architecture chunk size (m): meshes are split on this grid per level for frustum culling. */
export const CHUNK_M = 48;

const EPS = 1e-4;
/** Slivers thinner than this are not walls (m). */
const MIN_H = 0.01;

const isOpenCell = (c: number) => c === FLOOR || c === VOID;

export function rampsEqual(a: Ramp, b: Ramp): boolean {
  return a === b || (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.axis === b.axis &&
    Math.abs(a.s0 - b.s0) < EPS && Math.abs(a.s1 - b.s1) < EPS && Math.abs(a.h0 - b.h0) < EPS && Math.abs(a.h1 - b.h1) < EPS);
}

/** Ceiling of grid cell i (absolute; ramps follow the pitch line at the cell centre). */
export function cellCeil(g: Grid, i: number): number {
  const r = g.rampIdx[i];
  if (r >= 0) {
    const R = g.ramps[r], W = g.w, cx = i % W, cy = (i - cx) / W;
    const s = ((R.axis === 'x' ? cx : cy) + 0.5) * CELL;
    const c = rampHeight(R, s) + R.headroom;
    return R.capCeil && g.hasCeil(i) ? Math.min(c, g.ceil[i]) : c; // (task studio-skyways-rework-20261107-054512-01: open wells)
  }
  return g.hasCeil(i) ? g.ceil[i] : g.floorOf(i) + DEFAULT_CEIL;
}

// ---------------------------------------------------------------------------------------------
// Columns: which levels are open in each cell (deduplicated, sorted by floor)

export interface CentreBand { level: number; f: number; c: number }

export class LevelColumns {
  readonly W: number;
  readonly H: number;
  /** Max bands per column (= number of levels). */
  readonly S: number;
  private readonly cnt: Uint8Array;
  private readonly lv: Int8Array;
  constructor(readonly levels: Level[]) {
    const g0 = levels[0].grid, W = g0.w, H = g0.h, n = W * H, S = Math.max(1, levels.length);
    this.W = W; this.H = H; this.S = S;
    this.cnt = new Uint8Array(n);
    this.lv = new Int8Array(n * S).fill(-1);
    const tmp: {l: number; f: number}[] = [];
    for (let i = 0; i < n; i++) {
      tmp.length = 0;
      for (let k = 0; k < levels.length; k++) {
        const g = levels[k].grid;
        if (!isOpenCell(g.cells[i])) continue;
        // A flight carved into two grids (same ramp) or an identical flat band is one band.
        let dup = false;
        for (const t of tmp) {
          const h = levels[t.l].grid;
          const ra = g.rampIdx[i], rb = h.rampIdx[i];
          if (ra >= 0 && rb >= 0 ? rampsEqual(g.ramps[ra], h.ramps[rb])
            : ra < 0 && rb < 0 && Math.abs(g.floorOf(i) - h.floorOf(i)) < 1e-3 && Math.abs(cellCeil(g, i) - cellCeil(h, i)) < 1e-3) { dup = true; break; }
        }
        if (!dup) tmp.push({l: k, f: g.floorOf(i)});
      }
      tmp.sort((a, b) => a.f - b.f);
      this.cnt[i] = tmp.length;
      for (let k = 0; k < tmp.length; k++) this.lv[i * S + k] = tmp[k].l;
    }
  }
  count(i: number): number { return i < 0 ? 0 : this.cnt[i]; }
  /** True when level index L contributes a (non-duplicate) band to column i. */
  has(i: number, L: number): boolean {
    for (let k = 0; k < this.cnt[i]; k++) if (this.lv[i * this.S + k] === L) return true;
    return false;
  }
  /** Level index (into `levels`) of the k-th band of column i (sorted by floor). */
  level(i: number, k: number): number { return this.lv[i * this.S + k]; }
  /** Index of the level with this level id (ids are list indices in practice). */
  grid(k: number): Grid { return this.levels[k].grid; }
  /** Bands of column i at the cell centre. */
  bands(i: number, out: CentreBand[] = []): CentreBand[] {
    out.length = 0;
    for (let k = 0; k < this.count(i); k++) {
      const L = this.level(i, k), g = this.levels[L].grid;
      out.push({level: L, f: g.floorOf(i), c: cellCeil(g, i)});
    }
    return out;
  }
  /** True when the column at cell (x, y) is free at height y (any level). */
  freeAt(x: number, y: number, h: number): boolean {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const i = y * this.W + x;
    for (let k = 0; k < this.count(i); k++) {
      const g = this.levels[this.level(i, k)].grid;
      if (h >= g.floorOf(i) - 1e-3 && h <= cellCeil(g, i) + 1e-3) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Edge bands: a band's floor/ceiling along one cell edge, as values at both ends (linear between)

/** Floor/ceiling lines along an edge segment: f0/c0 at the start (t0), f1/c1 at the end (t1). */
export interface Lin { f0: number; f1: number; c0: number; c1: number }

/**
 * Band of grid cell i along the edge segment [t0, t1] of a wall plane. `alongX`: the edge runs
 * along X (plane = world z), else along Z (plane = world x). Ramps whose axis runs along the edge
 * slope with t; a ramp met end-on is constant at the plane. `skirt` lowers sloped floors (side walls
 * of a flight reach under its treads).
 */
export function edgeBand(g: Grid, i: number, alongX: boolean, plane: number, t0: number, t1: number, skirt = 0): Lin & {sloped: boolean} {
  const r = g.rampIdx[i];
  if (r < 0) {
    const f = g.floorOf(i), c = g.hasCeil(i) ? g.ceil[i] : f + DEFAULT_CEIL;
    return {f0: f, f1: f, c0: c, c1: c, sloped: false};
  }
  const R = g.ramps[r];
  // (task studio-skywalk-variety-20261107-231448-01) a capped open well (Ramp.capCeil, the Skyways runs): the band — and so the well's
  // side walls — stops at the well's ceiling, like cellCeil (its 40 m open headroom drew the walls up through the roofs)
  const cap = (c: number) => (R.capCeil && g.hasCeil(i) ? Math.min(c, g.ceil[i]) : c);
  if ((R.axis === 'x') === alongX) {
    const fa = rampHeight(R, t0), fb = rampHeight(R, t1);
    return {f0: fa - skirt, f1: fb - skirt, c0: cap(fa + R.headroom), c1: cap(fb + R.headroom), sloped: Math.abs(fa - fb) > EPS};
  }
  const f = rampHeight(R, plane);
  return {f0: f, f1: f, c0: cap(f + R.headroom), c1: cap(f + R.headroom), sloped: false};
}

/**
 * Task mall-round3-20261031 (lane FIX R1): how many (band, edge) pairs subtracted an overlapping lower band of their own column in
 * extractWallFaces (the mall's open escalator wells only; tests prove 0 for the Subway / Office). Reset by the caller.
 */
export const OVERLAP_STATS = {subtracted: 0};

/** Tags of the line bounding a piece: A floor / A ceiling / neighbour band j floor (2j) or ceiling (2j + 1). */
export const TAG_AF = -1, TAG_AC = -2;

/** A visible part of band A over a sub-range [ua, ub] (0..1 along the edge) of the edge. */
export interface Piece { ua: number; ub: number; b0: number; b1: number; t0: number; t1: number; bt: number; tt: number }

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * Band A minus the union of bands B along one edge (all linear): the parts of A's band that face
 * closed space. Breakpoints where any two lines cross split the edge so every piece is a trapezoid.
 */
export function subtractBands(a: Lin, bs: readonly Lin[], out: Piece[] = []): Piece[] {
  out.length = 0;
  // Lines: 0 = A floor, 1 = A ceil, 2 + 2j = B floor j, 3 + 2j = B ceil j.
  const n = 2 + 2 * bs.length;
  const v0 = new Float64Array(n), v1 = new Float64Array(n);
  v0[0] = a.f0; v1[0] = a.f1; v0[1] = a.c0; v1[1] = a.c1;
  bs.forEach((b, j) => { v0[2 + 2 * j] = b.f0; v1[2 + 2 * j] = b.f1; v0[3 + 2 * j] = b.c0; v1[3 + 2 * j] = b.c1; });
  const us: number[] = [0, 1];
  for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
    const dp = v1[p] - v0[p], dq = v1[q] - v0[q], den = dp - dq;
    if (Math.abs(den) < 1e-9) continue;
    const u = (v0[q] - v0[p]) / den;
    if (u > 1e-4 && u < 1 - 1e-4) us.push(u);
  }
  us.sort((p, q) => p - q);
  const tagLine = (t: number) => (t === TAG_AF ? 0 : t === TAG_AC ? 1 : 2 + t);
  const at = (t: number, u: number) => { const L = tagLine(t); return lerp(v0[L], v1[L], u); };
  const seg: {lo: number; hi: number; lt: number; ht: number}[] = [];
  let prev: Piece[] = [];
  for (let s = 0; s + 1 < us.length; s++) {
    const ua = us[s], ub = us[s + 1];
    if (ub - ua < 1e-6) continue;
    const um = (ua + ub) / 2;
    // Union of B at um (sorted, merged), with the tags of its bounding lines.
    seg.length = 0;
    bs.forEach((_, j) => seg.push({lo: lerp(v0[2 + 2 * j], v1[2 + 2 * j], um), hi: lerp(v0[3 + 2 * j], v1[3 + 2 * j], um), lt: 2 * j, ht: 2 * j + 1}));
    seg.sort((p, q) => p.lo - q.lo);
    const af = lerp(v0[0], v1[0], um), ac = lerp(v0[1], v1[1], um);
    let cur = af, curTag = TAG_AF;
    const pieces: Piece[] = [];
    const push = (lo: number, hi: number, bt: number, tt: number) => {
      if (hi - lo < MIN_H) return;
      pieces.push({ua, ub, b0: at(bt, ua), b1: at(bt, ub), t0: at(tt, ua), t1: at(tt, ub), bt, tt});
    };
    for (let k = 0; k < seg.length;) {
      // merge overlapping B intervals
      let lo = seg[k].lo, hi = seg[k].hi, lt = seg[k].lt, ht = seg[k].ht;
      k++;
      while (k < seg.length && seg[k].lo <= hi + EPS) { if (seg[k].hi > hi) { hi = seg[k].hi; ht = seg[k].ht; } k++; }
      if (hi <= cur + EPS) continue;
      if (lo >= ac - EPS) break;
      if (lo > cur) push(cur, lo, curTag, lt);
      if (hi > cur) { cur = hi; curTag = ht; }
    }
    if (ac > cur) push(cur, ac, curTag, TAG_AC);
    // Continue pieces of the previous segment with the same bounding lines (one trapezoid).
    const next: Piece[] = [];
    for (const p of pieces) {
      const q = prev.find(o => o.bt === p.bt && o.tt === p.tt && Math.abs(o.ub - p.ua) < 1e-9);
      if (q) { q.ub = p.ub; q.b1 = p.b1; q.t1 = p.t1; next.push(q); } else { out.push(p); next.push(p); }
    }
    prev = next;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Wall faces

/** Builder edge kinds (material families). */
export type WallKind = 'tile' | 'paint' | 'shop' | 'tunnel' | 'platformFace' | 'slab' | 'annex';

/** A published face plus what the builder needs to render it. */
export interface BuiltFace extends WallFace {
  kind: WallKind;
  /** Texture base height (v = (y - base) / span) at the x0/z0 end and at the x1/z1 end. */
  vb0: number; vb1: number;
}

const DIRS = [
  {dx: 0, dy: -1, nx: 0, nz: 1},
  {dx: 0, dy: 1, nx: 0, nz: -1},
  {dx: -1, dy: 0, nx: 1, nz: 0},
  {dx: 1, dy: 0, nx: -1, nz: 0},
] as const;

function hash32(...v: number[]): number {
  let h = 2166136261 >>> 0;
  for (const x of v) {
    h ^= (Math.round(x * 64) | 0);
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

const STAIR_ROLES = new Set(['stair', 'end-stair', 'escalator', 'stair-core', 'landing']);

/** Wall identity of a band's face (see WallZone). */
export function wallZone(level: Level, area: Area | undefined, voidCell: boolean, stair: boolean): WallZone {
  if (voidCell) return 'trackbed';
  if (stair) return 'stair';
  if (area && (area.type === 'eatery' || area.type === 'shop')) return 'shop';
  if (area && ((area.type as string) === 'exit-stair' || (area.type as string) === 'stair-core' || (area.role && STAIR_ROLES.has(area.role)))) return 'stair';
  // Track 2 (VIS): service annexes off the track tunnels take the lower-level service look (lowerConcrete: formwork, pipes,
  // conduits, damp); tunnel faces are replaced by the smooth shell (world/trackExt), the track-bed zone if any survive.
  if (isExt(area, 'annex')) return 'lower';
  if (isExt(area, 'tunnel')) return 'trackbed';
  if (level.role === 'lower' || area?.type === 'underpass') return 'lower';
  if (level.role === 'upper') return 'upper';
  // Task office-seamless-20261029: 'office' storeys (tower floors 2..8) take the main-level zones (public -> concourse,
  // back-of-house -> service), exactly as iteration 16 built them (each floor was a 'main' section then).
  if (area?.kind === 'platform') return 'platform';
  return !area || area.publicSpace ? 'concourse' : 'service';
}

/** Track 2: extension marker of an area (DESIGN §1 Area.ext; GEN). */
function isExt(area: Area | undefined, kind: 'tunnel' | 'annex'): boolean {
  return (area as {ext?: string} | undefined)?.ext === kind;
}

function kindOf(area: Area | undefined): WallKind {
  if (!area) return 'tile';
  // Track 2 (VIS): annex rooms / corridors are cast concrete, tunnels the tunnel lining. Playtest revision (lane ART): the annexes'
  // own board-formed finish ('annexWall', world/trackExt/wallFinish.ts) instead of the 128 texel / m platform-face backing.
  if (isExt(area, 'annex')) return 'annex';
  if (isExt(area, 'tunnel')) return 'tunnel';
  if (area.type === 'eatery' || area.type === 'shop') return 'shop';
  return area.publicSpace ? 'tile' : 'paint';
}

export interface WallOptions {
  /** Height of the lower tile band (WorldMaterials.tileLowerHeight). */
  tileLowerHeight: number;
}

interface OpenRun {
  level: number; area: number; kind: WallKind; voidCell: boolean; stair: boolean;
  f: number; c: number; k0: number; kEnd: number;
  /** Per-edge entries after k0: top of an opening, or NaN for a wall edge. */
  tops: number[];
}
interface OtherRun { level: number; area: number; kind: WallKind; voidCell: boolean; stair: boolean; y0: number; y1: number; base: number; k0: number; kEnd: number }

/**
 * Every visible base-wall face of a (multi-level) station, merged into straight runs per level band.
 * Tiled walls yield one face per material band ('tileLower' up to the tile line, 'tileUpper' above).
 */
export function extractWallFaces(layout: Pick<StationLayout, 'grid' | 'areas'> & Pick<Partial<StationLayout>, 'extensions'>, levels: Level[], cols: LevelColumns, opts: WallOptions): BuiltFace[] {
  const W = cols.W, H = cols.H;
  // Track 2 (lane GEN): face seeds in the CORE frame (a crop translation by track extensions keeps every core face's detail).
  const ox = layout.extensions?.core.x ?? 0, oy = layout.extensions?.core.y ?? 0;
  const out: BuiltFace[] = [];
  const TILE = opts.tileLowerHeight;
  // Areas holding a stair flight (any level): their walls are stair-core walls.
  const stairArea = new Set<number>();
  for (const L of levels) {
    const g = L.grid;
    for (const r of g.ramps) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      if (g.rampIdx[i] < 0) continue; // ramps arrays may be shared by every level grid: only carved cells count
      const a = g.area[i];
      if (a >= 0) stairArea.add(a);
    }
  }
  const areaOf = (id: number): Area | undefined => (id >= 0 ? layout.areas[id] : undefined);

  // Scratch (allocation-free constant-band fast path; sloped stair edges use subtractBands).
  const MAXB = Math.max(4, 2 * cols.S + 1); // (+ the same column's overlapping lower bands, task mall-round3 lane FIX R1)
  const bF = new Float64Array(MAXB), bC = new Float64Array(MAXB);
  const pB = new Float64Array(2 * MAXB + 2), pT = new Float64Array(2 * MAXB + 2);
  const pBt = new Int32Array(2 * MAXB + 2), pTt = new Int32Array(2 * MAXB + 2);
  const bandsB: Lin[] = [];
  const pieces: Piece[] = [];
  /** A [af, ac] minus the union of the nb sorted B bands in bF/bC: pieces into pB/pT/pBt/pTt. */
  const sub1D = (af: number, ac: number, nb: number): number => {
    let np = 0, cur = af, curTag = TAG_AF;
    for (let k = 0; k < nb;) {
      const lo = bF[k], lt = 2 * k;
      let hi = bC[k], ht = 2 * k + 1;
      k++;
      while (k < nb && bF[k] <= hi + EPS) { if (bC[k] > hi) { hi = bC[k]; ht = 2 * k + 1; } k++; }
      if (hi <= cur + EPS) continue;
      if (lo >= ac - EPS) break;
      if (lo > cur && lo - cur >= MIN_H) { pB[np] = cur; pT[np] = lo; pBt[np] = curTag; pTt[np] = lt; np++; }
      if (hi > cur) { cur = hi; curTag = ht; }
    }
    if (ac > cur && ac - cur >= MIN_H) { pB[np] = cur; pT[np] = ac; pBt[np] = curTag; pTt[np] = TAG_AC; np++; }
    return np;
  };
  const ceilOf = (g: Grid, i: number, f: number) => (g.hasCeil(i) ? g.ceil[i] : f + DEFAULT_CEIL);

  for (let di = 0; di < 4; di++) {
    const d = DIRS[di];
    const alongX = d.dy !== 0;
    const lines = alongX ? H : W, len = alongX ? W : H;
    for (let l = 0; l < lines; l++) {
      const plane = (alongX ? (d.dy < 0 ? l : l + 1) : (d.dx < 0 ? l : l + 1)) * CELL;
      const runs: (OpenRun | null)[] = new Array(levels.length).fill(null);
      let openRuns = 0;
      const others = new Map<string, OtherRun>();
      const slopedRuns: SlopedRun[] = [];
      const emitFace = (level: number, area: number, kind: WallKind, voidCell: boolean, stair: boolean, k0: number, k1: number,
        y0: number, y1: number, base: number, openings: {s0: number; s1: number; top: number}[], slope?: {b0: number; b1: number; t0: number; t1: number; base0: number; base1: number; finish: string}) => {
        const L = levels[level];
        const ar = areaOf(area);
        const a0 = k0 * CELL, a1 = k1 * CELL;
        const [x0, z0, x1, z1] = alongX ? [a0, plane, a1, plane] : [plane, a0, plane, a1];
        const zone = wallZone(L, ar, voidCell, stair);
        const mk = (finish: string, fy0: number, fy1: number, vb0: number, vb1: number, ops: {s0: number; s1: number; top: number}[], sl?: WallFace['slope']): void => {
          out.push({
            level: L.id, area, areaType: voidCell ? 'trackbed' : ar?.type ?? 'unknown', zone, x0, z0, x1, z1, nx: d.nx, nz: d.nz,
            y0: fy0, y1: fy1, finish, openings: ops, seed: hash32(L.id, di, l - (alongX ? oy : ox), k0 - (alongX ? ox : oy), fy0, finish.length), kind, vb0, vb1, ...(sl ? {slope: sl} : {}),
          });
        };
        if (slope) {
          // Sloped (stair) face: a trapezoid of one material band (split at the tile line beforehand).
          mk(slope.finish, Math.min(slope.b0, slope.b1), Math.max(slope.t0, slope.t1), slope.base0, slope.base1, [], {b0: slope.b0, b1: slope.b1, t0: slope.t0, t1: slope.t1});
          return;
        }
        if (kind === 'tile') {
          const split = base + TILE;
          if (y0 < split - MIN_H) mk('tileLower', y0, Math.min(y1, split), base, base, openings.filter(o => o.top > y0 + MIN_H));
          if (y1 > split + MIN_H) {
            const fy0 = Math.max(y0, split);
            mk('tileUpper', fy0, y1, split, split, openings.filter(o => o.top > fy0 + MIN_H).map(o => ({...o, top: Math.min(o.top, y1)})));
          }
        } else mk(finishFor(kind, false), y0, y1, base, base, openings);
      };
      const closeRun = (r: OpenRun) => {
        // Trailing openings (a door at the end of the wall) become lintel faces of their own.
        let last = r.tops.length;
        while (last > 0 && !Number.isNaN(r.tops[last - 1])) last--;
        const k1 = r.k0 + 1 + last;
        const ops: {s0: number; s1: number; top: number}[] = [];
        for (let j = 0; j < last; j++) {
          const top = r.tops[j];
          if (Number.isNaN(top)) continue;
          const s0 = (j + 1) * CELL;
          const o = ops[ops.length - 1];
          if (o && Math.abs(o.s1 - s0) < EPS && Math.abs(o.top - top) < EPS) o.s1 = s0 + CELL;
          else ops.push({s0, s1: s0 + CELL, top});
        }
        emitFace(r.level, r.area, r.kind, r.voidCell, r.stair, r.k0, k1, r.f, r.c, r.f, ops);
        for (let j = last; j < r.tops.length;) {
          const top = r.tops[j];
          let e = j + 1;
          while (e < r.tops.length && Math.abs(r.tops[e] - top) < EPS) e++;
          emitFace(r.level, r.area, r.kind, r.voidCell, r.stair, r.k0 + 1 + j, r.k0 + 1 + e, top, r.c, r.f, []);
          j = e;
        }
      };
      const closeOther = (o: OtherRun) => emitFace(o.level, o.area, o.kind, o.voidCell, o.stair, o.k0, o.kEnd, o.y0, o.y1, o.base, []);
      for (let k = 0; k <= len; k++) {
        if (k < len) {
          const x = alongX ? k : l, y = alongX ? l : k;
          const i = y * W + x;
          const na = cols.count(i);
          const nxc = x + d.dx, nyc = y + d.dy;
          const ni = na && nxc >= 0 && nyc >= 0 && nxc < W && nyc < H ? nyc * W + nxc : -1;
          const nb = cols.count(ni);
          const t0 = k * CELL, t1 = t0 + CELL;
          for (let ab = 0; ab < na; ab++) {
            const Lk = cols.level(i, ab), g = levels[Lk].grid;
            const isRamp = g.rampIdx[i] >= 0;
            let anyRampB = false;
            for (let bb = 0; bb < nb; bb++) if (levels[cols.level(ni, bb)].grid.rampIdx[ni] >= 0) { anyRampB = true; break; }
            let f: number, c: number, np: number;
            let sloped = false;
            let A: Lin | null = null;
            /** Skirt included in A's floor line (sloped ramp edges only), so pitch = floor + aSkirt. */
            let aSkirt = 0;
            // Task mall-round3-20261031 (lane FIX R1 — user: "z-fighting appears on escalators where they connect slopped walls under
            // them"): a LOWER band of the same column that reaches above this band's floor already emits the faces where both are open.
            // Only the mall's open escalator wells do that (Ramp.headroom = OPEN_HEADROOM: a scissor stack's lower flight band runs on up
            // through the flight above it and the storeys over it), and both bands drew the same face — coplanar duplicates with
            // different texture bases (visible z-fighting on the wells' slab edges). Subtract such bands from this one; columns whose
            // bands do not overlap (stacked storeys with a slab between: every Subway / Office column) skip this, unchanged.
            let over: (Lin & {sloped: boolean})[] | null = null;
            if (ab > 0) {
              const fA = g.floorOf(i) - 0.5;
              let Af: Lin | null = null; // this band's own floor / pitch line (no skirt)
              for (let lb = 0; lb < ab; lb++) {
                const g2 = levels[cols.level(i, lb)].grid;
                if (cellCeil(g2, i) + 0.5 <= fA) continue; // quick reject: a slab between
                const r2 = g2.rampIdx[i] >= 0;
                const E = edgeBand(g2, i, alongX, plane, t0, t1, r2 ? WALL_SKIRT : 0);
                if (r2 && !E.sloped) { const E0 = edgeBand(g2, i, alongX, plane, t0, t1, 0); E.f0 = E0.f0; E.f1 = E0.f1; }
                Af ??= edgeBand(g, i, alongX, plane, t0, t1, 0);
                if (E.c0 > Af.f0 + MIN_H || E.c1 > Af.f1 + MIN_H) { (over ??= []).push(E); OVERLAP_STATS.subtracted++; }
              }
            }
            if (!isRamp && !anyRampB && !over) {
              // Constant bands (the common case): straight 1D interval subtraction, no allocation.
              f = g.floorOf(i); c = ceilOf(g, i, f);
              for (let bb = 0; bb < nb; bb++) {
                const gm = levels[cols.level(ni, bb)].grid, ff = gm.floorOf(ni);
                bF[bb] = ff; bC[bb] = ceilOf(gm, ni, ff);
              }
              if (nb === 1 && bF[0] <= f + EPS && bC[0] >= c - EPS) continue; // interior edge
              np = sub1D(f, c, nb);
            } else {
              const Ae = edgeBand(g, i, alongX, plane, t0, t1, isRamp ? WALL_SKIRT : 0);
              if (isRamp && !Ae.sloped) { const B0 = edgeBand(g, i, alongX, plane, t0, t1, 0); Ae.f0 = B0.f0; Ae.f1 = B0.f1; }
              aSkirt = isRamp && Ae.sloped ? WALL_SKIRT : 0;
              A = Ae;
              sloped = Ae.sloped;
              bandsB.length = 0;
              for (let bb = 0; bb < nb; bb++) {
                // Seen from a flight, a neighbouring flight cell reaches under its treads as far (no skirt slivers inside a flight).
                const B = edgeBand(levels[cols.level(ni, bb)].grid, ni, alongX, plane, t0, t1, isRamp ? WALL_SKIRT : 0);
                sloped ||= B.sloped;
                bandsB.push(B);
              }
              for (const E of over ?? []) { sloped ||= E.sloped; bandsB.push(E); }
              if (!sloped) bandsB.sort((p, q) => p.f0 - q.f0);
              subtractBands(Ae, bandsB, pieces);
              f = Ae.f0; c = Ae.c0;
              np = pieces.length;
              if (!sloped) for (let q = 0; q < np; q++) {
                pB[q] = pieces[q].b0; pT[q] = pieces[q].t0; pBt[q] = pieces[q].bt; pTt[q] = pieces[q].tt;
                bF[q] = 0;
              }
              if (!sloped) bandsB.forEach((B, j) => { bF[j] = B.f0; bC[j] = B.c0; });
            }
            if (!np) continue;
            const cellVoid = g.cells[i] === VOID;
            const area = g.area[i], ar = areaOf(area);
            const stair = isRamp || stairArea.has(area);
            const baseKind: WallKind = cellVoid ? 'tunnel' : kindOf(ar);
            const pieceKind = (bt: number, tt: number): WallKind => {
              // Between a neighbour's lower ceiling and its upper floor: the edge of a structural slab.
              if (bt >= 0 && tt >= 0 && bt % 2 === 1 && tt % 2 === 0) return 'slab';
              if (cellVoid) return bt === TAG_AF && tt >= 0 && tt % 2 === 0 ? 'platformFace' : 'tunnel';
              return baseKind;
            };
            if (sloped) {
              // Stair flights: trapezoids, merged with the previous cell's when they continue the same lines.
              // Iteration 12 (ARCH, user: "the bricks would always be straight up and down"): the texture base used
              // to follow the pitch line, so tile courses, the charcoal base and the teal band ran diagonally with
              // the flight. Every zone now has a CONSTANT texture base (horizontal courses, vertical joints): the
              // bottom landing's dado continues level into the stairwell, the top landing's dado continues level
              // back over the flight, plain courses between, and only the skirting follows the pitch as a raked
              // strip of level-coursed charcoal tile (stairWallZones).
              const Af = A!;
              const R = isRamp ? g.ramps[g.rampIdx[i]] : null;
              const lo = R ? Math.min(R.h0, R.h1) : Af.f0, hi = R ? Math.max(R.h0, R.h1) : Af.f0;
              const pitch = (u: number) => lerp(Af.f0, Af.f1, u) + aSkirt;
              for (const p of pieces) {
                const kind = pieceKind(p.bt, p.tt);
                for (const q of stairWallZones(p, kind, R ? pitch : null, lo, hi, TILE)) {
                  pushSloped(slopedRuns, {
                    level: Lk, area, kind, voidCell: cellVoid, stair, finish: q.finish, ta: t0 + q.ua * CELL, tb: t0 + q.ub * CELL,
                    b0: q.b0, b1: q.b1, t0: q.t0, t1: q.t1, base0: q.base, base1: q.base,
                  });
                }
              }
              continue;
            }
            let cls = 0; // 0 other, 1 wall, 2 opening
            let top = NaN;
            if (np === 1 && !over) {
              if (pBt[0] === TAG_AF && pTt[0] === TAG_AC) cls = 1;
              else if (pTt[0] === TAG_AC && pBt[0] >= 0 && pBt[0] % 2 === 1) {
                // Walk-through: the neighbour's band starts at (about) this floor: a door / arch / storefront.
                const j = (pBt[0] - 1) / 2;
                if (bF[j] <= f + STEP_UP && bF[j] >= f - STEP_UP && pB[0] > f + 1.2) { cls = 2; top = pB[0]; }
              }
            }
            if (cls) {
              const r = runs[Lk];
              if (r && r.kEnd === k && r.area === area && r.kind === baseKind && Math.abs(r.f - f) < EPS && Math.abs(r.c - c) < EPS) {
                r.tops.push(cls === 1 ? NaN : top); r.kEnd = k + 1; continue;
              }
              if (r) { closeRun(r); runs[Lk] = null; openRuns--; }
              if (cls === 1) { runs[Lk] = {level: Lk, area, kind: baseKind, voidCell: cellVoid, stair, f, c, k0: k, kEnd: k + 1, tops: []}; openRuns++; continue; }
            }
            for (let q = 0; q < np; q++) {
              const kind = pieceKind(pBt[q], pTt[q]);
              const key = `${Lk}|${kind}|${pB[q].toFixed(4)}|${pT[q].toFixed(4)}|${area}|${f.toFixed(4)}`;
              const o = others.get(key);
              if (o && o.kEnd === k) { o.kEnd = k + 1; continue; }
              if (o) closeOther(o);
              others.set(key, {level: Lk, area, kind, voidCell: cellVoid, stair, y0: pB[q], y1: pT[q], base: f, k0: k, kEnd: k + 1});
            }
          }
        }
        // Close everything that did not continue through edge k.
        if (openRuns) for (let L = 0; L < runs.length; L++) { const r = runs[L]; if (r && r.kEnd <= k) { closeRun(r); runs[L] = null; openRuns--; } }
        if (others.size) for (const [key, o] of others) if (o.kEnd <= k) { closeOther(o); others.delete(key); }
      }
      // Sloped runs of this line.
      for (const s of slopedRuns) emitFace(s.level, s.area, s.kind, s.voidCell, s.stair, s.ta / CELL, s.tb / CELL, 0, 0, 0, [], s);
    }
  }
  return clipSkyFaces(out, levels, W);
}

/**
 * Task office-overhaul-20261030 (lane STRUCT): faces of an OPEN-SKY storey (Level.sky: the tower roof) stand only as high as the
 * closed column behind them is solid there — the parapet (sky.top) or a taller structure (sky.tops: the elevator overrun) —
 * instead of running up to the storey's nominal band top; above that is open sky. No sky storey: the list is returned as is.
 */
function clipSkyFaces(faces: BuiltFace[], levels: Level[], W: number): BuiltFace[] {
  const skyLv = levels.find(l => l.sky);
  // (task reactor-submit-roof-fog-20261102, lane ROOF: a roof OPENING keeps every column solid — task studio-reactor-surface-ending-
  // 20261102, lane ENDING: except over its outdoor storey (LevelSky.outdoor: the Reactor's surface plaza), whose faces stand only as
  // high as its parapet line / a structure's top, like the Office roof's)
  if (!skyLv || (skyLv.sky!.open && !skyLv.sky!.outdoor)) return faces;
  const sky = skyLv.sky!;
  const lid = sky.open ? sky.outdoor!.level : skyLv.id, top0 = sky.open ? sky.outdoor!.y : sky.top;
  // Task reactor-surface-redesign-credits-20261103 (primary; user screenshot "strange floating walls on the surface"): with an outdoor
  // storey over a roof opening, the OTHER storeys' faces stop at the open-sky band's top too. The pit tiers' edge cells without a
  // ceiling keep a nominal open band (floor + 40 m); the outdoor storey's band in the next column subtracted it only up to its own top
  // (sky.ceil, deck + 6 m), so the rest stood above the yard as flat-bottomed, saw-toothed slabs. Nothing of a storey under the roof
  // is outside above that line (a taller structure: sky.tops, as for the outdoor storey's own faces).
  const otherTop = sky.open ? sky.ceil : Infinity;
  const out: BuiltFace[] = [];
  for (const f of faces) {
    if (f.level !== lid && !(f.y1 > otherTop)) { out.push(f); continue; }
    // The column behind the face at its midpoint (the face normal points into the open band).
    const bx = (f.x0 + f.x1) / 2 - f.nx * CELL / 2, bz = (f.z0 + f.z1) / 2 - f.nz * CELL / 2;
    const cx = Math.floor(bx / CELL), cy = Math.floor(bz / CELL);
    const t = sky.tops && cx >= 0 && cy >= 0 ? sky.tops[cy * W + cx] : 0;
    const top = t > 0 ? Math.max(t, f.level === lid ? 0 : otherTop) : f.level === lid ? top0 : otherTop;
    if (f.y0 >= top - MIN_H) continue;
    if (f.y1 <= top) { out.push(f); continue; }
    out.push({...f, y1: top, openings: f.openings.map(o => ({...o, top: Math.min(o.top, top)})), ...(f.slope ? {slope: {...f.slope, t0: Math.min(f.slope.t0, top), t1: Math.min(f.slope.t1, top)}} : {})});
  }
  return out;
}

interface SlopedRun {
  level: number; area: number; kind: WallKind; voidCell: boolean; stair: boolean; finish: string;
  ta: number; tb: number; b0: number; b1: number; t0: number; t1: number; base0: number; base1: number;
}

function pushSloped(list: SlopedRun[], s: SlopedRun): void {
  // Continue a run that ends where this one starts on the same bottom/top/base lines.
  for (const r of list) {
    if (r.level !== s.level || r.finish !== s.finish || r.area !== s.area || Math.abs(r.tb - s.ta) > 1e-6) continue;
    if (Math.abs(r.b1 - s.b0) > 1e-4 || Math.abs(r.t1 - s.t0) > 1e-4 || Math.abs(r.base1 - s.base0) > 1e-4) continue;
    const ra = r.tb - r.ta, sa = s.tb - s.ta;
    const slope = (a: number, b: number, len: number) => (b - a) / len;
    if (Math.abs(slope(r.b0, r.b1, ra) - slope(s.b0, s.b1, sa)) > 1e-4 || Math.abs(slope(r.t0, r.t1, ra) - slope(s.t0, s.t1, sa)) > 1e-4
      || Math.abs(slope(r.base0, r.base1, ra) - slope(s.base0, s.base1, sa)) > 1e-4) continue;
    r.tb = s.tb; r.b1 = s.b1; r.t1 = s.t1; r.base1 = s.base1;
    return;
  }
  list.push(s);
}

/** Material key of a wall kind (tile: lower band; see extractWallFaces for the split). */
export function finishFor(kind: WallKind, upper: boolean): string {
  switch (kind) {
    case 'tile': return upper ? 'tileUpper' : 'tileLower';
    case 'paint': return 'paint';
    case 'shop': return 'tileShop';
    case 'tunnel': return 'tunnel';
    case 'platformFace': case 'slab': return 'platformFace';
    case 'annex': return 'annexWall';
  }
}

// ---------------------------------------------------------------------------------------------
// Iteration 12 (ARCH): gravity-aligned finishes on stair-flight side walls

/** Raked skirting on tiled flight walls: the wall texture's two charcoal base courses, this far above the pitch (m). */
export const STAIR_BASE_H = 0.3;
/** Painted block walls: the charcoal base band of canvasTextures.paintedBlock (m). */
export const PAINT_BASE_H = 0.14;

/** A horizontal texture zone [y0, y1) of a flight's side wall: finish + CONSTANT texture base (v = (y - base) / span). */
export interface StairZone { y0: number; y1: number; finish: string; base: number }

/**
 * Horizontal zones (bottom to top) of a flight wall above its raked skirting. `lo` / `hi` = the flight's bottom /
 * top landing floors. Tiled walls: the bottom landing's dado (tileLower from `lo`: field, teal band, plain courses)
 * continues level into the stairwell, plain courses (tileUpper) above it, and from the top landing's skirting line
 * (`hi` + STAIR_BASE_H) up the top landing's dado and plain courses - so the courses meet both landings' flat walls
 * at their heights. Painted block: the bottom landing's paint below the top landing's base line, the top's above.
 * A flat cell (lo = hi = floor) gets exactly its flat walls' zones.
 */
export function stairWallBands(kind: WallKind, lo: number, hi: number, tile: number): StairZone[] {
  const out: StairZone[] = [];
  const push = (y0: number, y1: number, finish: string, base: number) => {
    if (!(y1 - y0 > 1e-6)) return;
    const p = out[out.length - 1];
    if (p && p.finish === finish && Math.abs(p.base - base) < 1e-6 && Math.abs(p.y1 - y0) < 1e-6) { p.y1 = y1; return; }
    out.push({y0, y1, finish, base});
  };
  if (kind === 'tile') {
    const ya = hi + STAIR_BASE_H;
    push(-Infinity, Math.min(lo + tile, ya), 'tileLower', lo);
    push(lo + tile, ya, 'tileUpper', lo + tile);
    push(ya, hi + tile, 'tileLower', hi);
    push(Math.max(ya, hi + tile), Infinity, 'tileUpper', hi + tile);
  } else if (kind === 'paint') {
    push(-Infinity, hi + PAINT_BASE_H, 'paint', lo);
    push(hi + PAINT_BASE_H, Infinity, 'paint', hi);
  } else push(-Infinity, Infinity, finishFor(kind, false), lo);
  return out;
}

/** A zoned part of a wall piece (u: fractions of the cell edge like Piece.ua/ub) with its finish and texture base. */
export interface ZonedPiece { ua: number; ub: number; b0: number; b1: number; t0: number; t1: number; finish: string; base: number }

/**
 * Split a (sloped) wall piece into zone trapezoids. Zone boundaries are horizontal lines (stairWallBands) plus, on
 * tiled flight walls (`pitch` given), the raked skirting line pitch(u) + STAIR_BASE_H: below it 'tileBase' (charcoal
 * courses, level joints, cut along the rake). Every texture base is constant, so courses stay horizontal.
 */
export function stairWallZones(p: Piece, kind: WallKind, pitch: ((u: number) => number) | null, lo: number, hi: number, tile: number): ZonedPiece[] {
  const zones = stairWallBands(kind, lo, hi, tile);
  const rake = pitch && kind === 'tile' ? (u: number) => pitch(u) + STAIR_BASE_H : null;
  const span = Math.max(1e-9, p.ub - p.ua);
  const bAt = (u: number) => p.b0 + (p.b1 - p.b0) * (u - p.ua) / span;
  const tAt = (u: number) => p.t0 + (p.t1 - p.t0) * (u - p.ua) / span;
  const cuts = zones.slice(1).map(z => z.y0);
  const us = [p.ua, p.ub];
  const cross = (f: (u: number) => number, g: (u: number) => number) => {
    const d0 = f(p.ua) - g(p.ua), d1 = f(p.ub) - g(p.ub);
    if (d0 * d1 < 0) us.push(p.ua + (p.ub - p.ua) * d0 / (d0 - d1));
  };
  for (const h of cuts) { const H = () => h; cross(bAt, H); cross(tAt, H); if (rake) cross(rake, H); }
  if (rake) { cross(rake, bAt); cross(rake, tAt); }
  us.sort((a, b) => a - b);
  const out: ZonedPiece[] = [];
  for (let k = 0; k + 1 < us.length; k++) {
    const u0 = us[k], u1 = us[k + 1];
    if (u1 - u0 < 1e-6) continue;
    const um = (u0 + u1) / 2, bm = bAt(um), tm = tAt(um);
    const rm = rake ? rake(um) : -Infinity;
    const lines: ((u: number) => number)[] = [];
    if (rake && rm > bm + 1e-6 && rm < tm - 1e-6) lines.push(rake);
    // Horizontal boundaries only matter above the skirting.
    for (const h of cuts) if (h > bm + 1e-6 && h < tm - 1e-6 && h > rm + 1e-6) lines.push(() => h);
    lines.sort((f, g) => f(um) - g(um));
    lines.unshift(bAt);
    lines.push(tAt);
    for (let j = 0; j + 1 < lines.length; j++) {
      const L0 = lines[j], L1 = lines[j + 1];
      const b0 = L0(u0), b1 = L0(u1), t0 = L1(u0), t1 = L1(u1);
      if (t0 - b0 < 1e-4 && t1 - b1 < 1e-4) continue;
      const ym = (L0(um) + L1(um)) / 2;
      const z = ym < rm ? {finish: 'tileBase', base: lo} : zones.find(q => ym >= q.y0 && ym < q.y1) ?? zones[zones.length - 1];
      out.push({ua: u0, ub: u1, b0, b1, t0, t1, finish: z.finish, base: z.base});
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ceilings

/** One horizontal ceiling run (per level band): cells [x0, x1) of row y at height `y`. */
export interface CeilRun { level: number; row: number; x0: number; x1: number; y: number; area: number; voidCell: boolean }

/**
 * Ceiling runs of every level: each open, non-ramp cell's band ceiling (+ a capped open well's ramp cells), unless another band of the
 * column starts right there (the space continues upward). `skip` excludes cells (door rects).
 */
export function ceilingRuns(levels: Level[], cols: LevelColumns, skip?: (level: number, i: number) => boolean): CeilRun[] {
  const out: CeilRun[] = [];
  const sky = levels.find(l => l.sky)?.sky;
  const W = cols.W, H = cols.H;
  const ok = (L: number, i: number): number => {
    const g = levels[L].grid;
    // (task studio-skywalk-variety-20261107-231448-01, user bug: "a hole in the roof above the stairs") a ramp cell has no flat ceiling
    // (its flight draws a pitch-following one) — EXCEPT a capped open well (Ramp.capCeil, the Skyways runs): its band rises to the
    // well's own ceiling, which nothing else draws (traversalBuilder skips the following ceiling of an open well)
    if (!isOpenCell(g.cells[i]) || (g.rampIdx[i] >= 0 && !g.ramps[g.rampIdx[i]].capCeil) || (skip && skip(L, i))) return NaN;
    // Task office-overhaul-20261030 (lane STRUCT): open sky (the roof's nominal band top, the hatch shaft above it): no ceiling.
    // Task reactor-submit-roof-fog-20261102 (lane ROOF): with an opening mask (LevelSky.open) only its cells; the rest keep the roof.
    if (sky && cellCeil(g, i) >= sky.ceil - 0.01 && (!sky.open || sky.open[i] === 1)) return NaN;
    // Deduplicated away (identical band of a lower level id)?
    let mine = false;
    for (let k = 0; k < cols.count(i); k++) if (cols.level(i, k) === L) { mine = true; break; }
    if (!mine) return NaN;
    const c = cellCeil(g, i);
    for (let k = 0; k < cols.count(i); k++) {
      const M = cols.level(i, k);
      if (M === L) continue;
      const f = levels[M].grid.floorOf(i);
      if (Math.abs(f - c) < 0.02) return NaN;
    }
    return c;
  };
  for (let L = 0; L < levels.length; L++) {
    const g = levels[L].grid;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {
        const i = y * W + x;
        const c = ok(L, i);
        if (Number.isNaN(c)) { x++; continue; }
        const vd = g.cells[i] === VOID, area = g.area[i];
        let e = x + 1;
        while (e < W) {
          const j = y * W + e;
          const cj = ok(L, j);
          if (Number.isNaN(cj) || Math.abs(cj - c) > EPS || (g.cells[j] === VOID) !== vd) break;
          if (!vd && g.area[j] !== area) break; // floor cells: one area per run (material follows the area)
          e++;
        }
        out.push({level: L, row: y, x0: x, x1: e, y: c, area, voidCell: vd});
        x = e;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Railings

/** A guard railing along a walkable edge facing a drop. */
export interface RailRun {
  level: number;
  /** Endpoints on the rail line (world m); y0/y1 = walking surface at each end. */
  x0: number; z0: number; x1: number; z1: number; y0: number; y1: number;
  /** Unit normal toward the walkable side (±X / ±Z). */
  nx: number; nz: number;
  kind: 'railing' | 'parapet';
}

/** Railings from the layout (`layout.rails`, Lane A) or derived from the geometry. */
export function stationRails(layout: Pick<StationLayout, 'grid' | 'areas'>, levels?: Level[], cols?: LevelColumns): RailRun[] {
  const given = (layout as {rails?: RailRun[]}).rails;
  if (given) return given;
  return deriveRails(layout, levels, cols);
}

/**
 * Walkable edges that face a drop (the neighbour column is free at standing height and its floor is
 * > RAIL_DROP below): mezzanine / catwalk edges, light wells, stairwell guards, open flight sides.
 * Platform edges onto the track bed are not railed. Runs are merged along straight edges.
 */
export function deriveRails(layout: Pick<StationLayout, 'grid' | 'areas'>, levels: Level[] = stationLevels(layout), cols: LevelColumns = new LevelColumns(levels)): RailRun[] {
  const W = cols.W, H = cols.H;
  const out: RailRun[] = [];
  for (let di = 0; di < 4; di++) {
    const d = DIRS[di];
    const alongX = d.dy !== 0;
    const lines = alongX ? H : W, len = alongX ? W : H;
    for (let l = 0; l < lines; l++) {
      const plane = (alongX ? (d.dy < 0 ? l : l + 1) : (d.dx < 0 ? l : l + 1)) * CELL;
      const linePos = plane + (alongX ? d.nz : d.nx) * 0.05; // inset toward the walkable side
      let cur: RailRun | null = null;
      const flush = () => { if (cur) out.push(cur); cur = null; };
      for (let k = 0; k < len; k++) {
        const x = alongX ? k : l, y = alongX ? l : k;
        const i = y * W + x;
        const nxc = x + d.dx, nyc = y + d.dy;
        const ni = nxc >= 0 && nyc >= 0 && nxc < W && nyc < H ? nyc * W + nxc : -1;
        let hit: {level: number; ya: number; yb: number} | null = null;
        const nbc = cols.count(ni);
        for (let ab = 0; ab < cols.count(i) && !hit; ab++) {
          const L = cols.level(i, ab), g = levels[L].grid;
          if (g.cells[i] !== FLOOR || nbc === 0) continue;
          const r = g.rampIdx[i];
          let ya: number, yb: number;
          if (r >= 0) {
            const R = g.ramps[r];
            if ((R.axis === 'x') !== alongX) continue; // a flight's end: walked through
            ya = rampHeight(R, k * CELL); yb = rampHeight(R, (k + 1) * CELL);
          } else ya = yb = g.floorOf(i);
          const ym = (ya + yb) / 2;
          // Neighbour free at standing height (no wall), and its floor there far below (no walk-on band).
          let lowest = Infinity, free = false, walkOn = false;
          for (let bb = 0; bb < nbc; bb++) {
            const bg = levels[cols.level(ni, bb)].grid;
            const br = bg.rampIdx[ni];
            let bf: number, bc: number;
            if (br >= 0) {
              const R = bg.ramps[br];
              bf = rampHeight(R, (R.axis === 'x') === alongX ? (k + 0.5) * CELL : plane);
              bc = bf + R.headroom;
            } else { bf = bg.floorOf(ni); bc = bg.hasCeil(ni) ? bg.ceil[ni] : bf + DEFAULT_CEIL; }
            if (bc < ym + 1.0) continue;
            if (bf <= ym + STEP_UP && bf > ym - RAIL_DROP) { walkOn = true; break; }
            if (bf <= ym + 0.1) { free = true; if (bf < lowest) lowest = bf; }
          }
          if (walkOn || !free || !(ym - lowest > RAIL_DROP)) continue;
          // The platform edge onto the track bed stays open.
          const area = layout.areas[g.area[i]];
          if (area?.kind === 'platform') {
            let bed = false;
            for (let bb = 0; bb < nbc; bb++) if (levels[cols.level(ni, bb)].grid.cells[ni] === VOID) bed = true;
            if (bed) continue;
          }
          hit = {level: L, ya, yb};
        }
        if (!hit) { flush(); continue; }
        const a0 = k * CELL, a1 = a0 + CELL;
        const c = cur as RailRun | null;
        if (c && c.level === levels[hit.level].id && Math.abs(c.y1 - hit.ya) < 1e-4) {
          const clen = alongX ? c.x1 - c.x0 : c.z1 - c.z0;
          const sc = (c.y1 - c.y0) / clen, sh = (hit.yb - hit.ya) / CELL;
          const end = alongX ? c.x1 : c.z1;
          if (Math.abs(end - a0) < 1e-6 && Math.abs(sc - sh) < 1e-4) {
            if (alongX) c.x1 = a1; else c.z1 = a1;
            c.y1 = hit.yb;
            continue;
          }
        }
        flush();
        cur = alongX
          ? {level: levels[hit.level].id, x0: a0, z0: linePos, x1: a1, z1: linePos, y0: hit.ya, y1: hit.yb, nx: d.nx, nz: d.nz, kind: 'railing'}
          : {level: levels[hit.level].id, x0: linePos, z0: a0, x1: linePos, z1: a1, y0: hit.ya, y1: hit.yb, nx: d.nx, nz: d.nz, kind: 'railing'};
      }
      flush();
    }
  }
  return out;
}

/** Chunk key of a world point for a level (architecture meshes are split per level and chunk). */
export function chunkKey(level: number, x: number, z: number): string {
  return `${level}:${Math.floor(x / CHUNK_M)},${Math.floor(z / CHUNK_M)}`;
}
