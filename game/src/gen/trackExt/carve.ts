// Track 2 (lane GEN): planning + carving of the track extensions into a Kit's VIRTUAL canvas (canvas cell coordinates; cells
// outside the Kit's canvas are rock, so a tunnel may run past the canvas edge — the crop grows to hold it). Nothing is written
// into the Kit: the result is a Carve (areas, doors, cell stamps, records) that gen/trackExt/index.ts attachExtensions applies
// to the cropped layout AFTER every core pass. Deterministic per (kit state, rng).
//
// Occupancy rules (cells):
//  - core: every open extension cell keeps `margin.core` cells of rock (SOLID on EVERY level grid) to every core open cell (any
//    level), except a tunnel's own track bed at its mouth; out-of-canvas = rock; 'east-south' levels never go west / north of
//    the fixed crop origin (+ margin);
//  - between extension groups (a tunnel + its annex = one group): `margin.ext` cells;
//  - inside a group: one wall cell between areas (annex rooms are also one cell off their tunnel's footprint); doors in walls.
// Tunnel footprint = the cells reaching into the open tube + the cap reservation (gen/trackExt/path.ts tubeCells).

import type {Rng} from '../../core/rng';
import {CELL, SOLID, VOID} from '../grid';
import {ROOM_LABEL, type Kit, type TrenchCells} from '../stationKit';
import type {Area, AreaKind, Door, Rect, RoomType} from '../stationTypes';
import {buildPath, pathEnd, pointAt, samplePath, tubeCells, walkCells, type ShapeStep, type TubeCells, type TunnelPath, type Vec2} from './path';
import {SUBWAY_WALK_BASELINE_M2} from './config';
import type {BedEnd, BedEntry, CapKind, ServiceAnnex, TrackExtConfig, TrackExtContext, TrackExtensions, TrackTunnel} from './types';

/** Cells of virtual canvas around the core bbox the extensions may use (> longest tunnel + an annex). */
const PAD = 420;
/** Tunnel shape preference: one metre of length is worth this many grid cells of crop growth (keeps grids compact). */
const GROWTH_CELLS_PER_M = 800;

/** One carved cell (canvas coordinates; `area` = index into Carve.areas). */
export interface CarveCell { x: number; y: number; area: number; floor: number; ceil: number }

/**
 * What extendTracks carved (canvas frame). Areas / doors carry LOCAL ids (index in these arrays; Area.parent and Door.a / b are
 * local area indices, -1 = none); records (TrackExtensions) reference local area / door indices; attachExtensions remaps them.
 */
export interface Carve {
  ext: TrackExtensions;
  areas: Area[];
  doors: Door[];
  cells: CarveCell[];
  /** Rects the crop must include (tunnel footprint boxes, annex areas, doors), canvas cells. */
  rects: Rect[];
  /** The core's own crop bbox (canvas cells, inclusive) — the window the core occupies after the crop. */
  core: {x0: number; y0: number; x1: number; y1: number};
}

export interface BedEndInfo {
  trench: number; t: TrenchCells; from: BedEnd;
  /** Face column boundary (cells): x1 for 'x1', x0 for 'x0'; travel direction along X. */
  face: number; dir: 1 | -1;
  half: number; cz: number; floorY: number;
}

/** (GEN-2) What an annex grows from: its extension group, floor, the area its entry door opens from (-1: a bed) and its tunnel. */
interface AnnexEntry { group: number; floorY: number; area: number; tunnel: number }

/** (GEN-2) A planned service hatch: the bed-entry record (canvas frame; door = local door index, no clues yet). */
export type HatchEntry = Omit<BedEntry, 'clues'>;

interface PlannedTunnel {
  id: number; end: BedEndInfo; path: TunnelPath; length: number; firstStraight: number;
  walk: {x: number[]; y: number[]; s: number[]}; walkSet: Set<number>;
  foot: {x: number[]; y: number[]};
  area: number; cap: CapKind;
}

interface AnnexArea { area: number; rect: Rect; kind: 'corridor' | 'room' | 'closet'; depth: number }

const vkey = (x: number, y: number): number => (y + 8192) * 16384 + (x + 8192);

export class Carver {
  private readonly W: number; private readonly H: number;
  /** Virtual window origin / size (canvas cells). */
  private readonly vx: number; private readonly vy: number; private readonly vw: number; private readonly vh: number;
  /** Core open cells (beds excluded) dilated by margin.core, over the core bbox (+ margin) region. */
  private readonly nearCore: Uint8Array; private readonly ncx: number; private readonly ncy: number; private readonly ncw: number; private readonly nch: number;
  /** Extension occupancy: exact owner (group + 1) and owner within margin.ext (group + 1; -1 = several). */
  private readonly own: Int16Array;
  private readonly near: Int16Array;
  private readonly beds: TrenchCells[];
  readonly coreBox: {x0: number; y0: number; x1: number; y1: number};
  /** Running bbox of everything the crop will hold (core + accepted extensions), canvas cells inclusive. */
  private box: {x0: number; y0: number; x1: number; y1: number};
  readonly carve: Carve;
  private readonly tunnels: PlannedTunnel[] = [];

  constructor(private readonly k: Kit, private readonly cfg: TrackExtConfig, private readonly ctx: TrackExtContext) {
    const g0 = k.g;
    this.W = g0.w; this.H = g0.h;
    let x0 = g0.w, y0 = g0.h, x1 = 0, y1 = 0;
    for (const r of [...k.areas, ...k.doors, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
      if (r.w <= 0 || r.h <= 0) continue;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w - 1); y1 = Math.max(y1, r.y + r.h - 1);
    }
    this.coreBox = {x0, y0, x1, y1};
    this.box = {...this.coreBox};
    this.beds = k.trenches.slice();
    this.vx = x0 - PAD; this.vy = y0 - PAD; this.vw = x1 - x0 + 1 + 2 * PAD; this.vh = y1 - y0 + 1 + 2 * PAD;
    this.own = new Int16Array(this.vw * this.vh);
    this.near = new Int16Array(this.vw * this.vh);
    // core open mask (any level non-SOLID; a level-0 VOID bed cell counts only when another level is open above / below it)
    const mc = cfg.margin.core;
    this.ncx = x0 - mc - 1; this.ncy = y0 - mc - 1; this.ncw = x1 - x0 + 2 * mc + 3; this.nch = y1 - y0 + 2 * mc + 3;
    const base = new Uint8Array(this.ncw * this.nch);
    const grids = k.levelGrids;
    for (let y = Math.max(0, y0); y <= Math.min(this.H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.W - 1, x1); x++) {
        const i = y * this.W + x;
        let open = false;
        for (let L = 0; L < grids.length && !open; L++) {
          const c = grids[L].cells[i];
          if (c !== SOLID && !(L === 0 && c === VOID)) open = true;
        }
        if (open) base[(y - this.ncy) * this.ncw + (x - this.ncx)] = 1;
      }
    }
    // separable Chebyshev dilation by mc
    const tmp = new Uint8Array(base.length), out = new Uint8Array(base.length);
    const w = this.ncw, h = this.nch;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -mc; d <= mc && !v; d++) { const xx = x + d; if (xx >= 0 && xx < w && base[y * w + xx]) v = 1; }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -mc; d <= mc && !v; d++) { const yy = y + d; if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1; }
      out[y * w + x] = v;
    }
    this.nearCore = out;
    this.carve = {ext: {tunnels: [], annexes: [], log: [], core: {x: 0, y: 0, w: 0, h: 0}, shift: {x: 0, z: 0}}, areas: [], doors: [], cells: [], rects: [], core: {...this.coreBox}};
  }

  // ---------------------------------------------------------------------------------------------
  // Occupancy

  private vi(x: number, y: number): number {
    const xx = x - this.vx, yy = y - this.vy;
    return xx < 0 || yy < 0 || xx >= this.vw || yy >= this.vh ? -1 : yy * this.vw + xx;
  }

  /** Core rule for an open extension cell (`ownBed`: that bed's cells may lie within the margin — a tunnel's mouth). */
  private coreFree(x: number, y: number, ownBed: TrenchCells | null): boolean {
    const mc = this.cfg.margin.core;
    if (this.ctx.canvasGrow === 'east-south') {
      const o = this.ctx.origin ?? {x: 0, y: 0};
      if (x - mc < o.x + 2 || y - mc < o.y + 2) return false;
    }
    const nx = x - this.ncx, ny = y - this.ncy;
    if (nx >= 0 && ny >= 0 && nx < this.ncw && ny < this.nch && this.nearCore[ny * this.ncw + nx]) return false;
    for (const b of this.beds) {
      if (b === ownBed) continue;
      if (x + mc >= b.x0 && x - mc < b.x1 && y + mc >= b.y0 && y - mc < b.y1) return false;
    }
    return true;
  }

  /** Extension rule: no other group's cell within margin.ext (and inside the virtual window). */
  private extFree(x: number, y: number, group: number): boolean {
    const i = this.vi(x, y);
    if (i < 0) return false;
    const v = this.near[i];
    return v === 0 || v === group + 1;
  }

  private cellOk(x: number, y: number, group: number, ownBed: TrenchCells | null): boolean {
    return this.coreFree(x, y, ownBed) && this.extFree(x, y, group);
  }

  /** Registers open / footprint cells of a group: exact owner + the margin.ext neighbourhood. */
  private claim(xs: readonly number[], ys: readonly number[], group: number): void {
    const me = this.cfg.margin.ext, g = group + 1;
    for (let k = 0; k < xs.length; k++) {
      const i = this.vi(xs[k], ys[k]);
      if (i >= 0) this.own[i] = g;
    }
    for (let k = 0; k < xs.length; k++) {
      for (let dy = -me; dy <= me; dy++) for (let dx = -me; dx <= me; dx++) {
        const i = this.vi(xs[k] + dx, ys[k] + dy);
        if (i < 0) continue;
        const v = this.near[i];
        if (v === 0) this.near[i] = g; else if (v !== g) this.near[i] = -1;
      }
    }
  }

  /** Grid cells of the final crop for a bbox (the level's crop rule). */
  private cellsFor(b: {x0: number; y0: number; x1: number; y1: number}): number {
    if (this.ctx.canvasGrow === 'east-south') {
      const o = this.ctx.origin ?? {x: 0, y: 0};
      return (b.x1 - o.x + 3) * (b.y1 - o.y + 3);
    }
    return (b.x1 - b.x0 + 5) * (b.y1 - b.y0 + 5);
  }
  private grown(b: {x0: number; y0: number; x1: number; y1: number}): {x0: number; y0: number; x1: number; y1: number} {
    return {x0: Math.min(this.box.x0, b.x0), y0: Math.min(this.box.y0, b.y0), x1: Math.max(this.box.x1, b.x1), y1: Math.max(this.box.y1, b.y1)};
  }
  private fits(b: {x0: number; y0: number; x1: number; y1: number}): boolean {
    return this.cellsFor(this.grown(b)) <= this.ctx.maxCells;
  }

  // ---------------------------------------------------------------------------------------------
  // Tunnels

  /** Every bed end of every trench (canvas cells). */
  bedEnds(): BedEndInfo[] {
    const out: BedEndInfo[] = [];
    this.k.trenches.forEach((t, ti) => {
      const g = this.k.g;
      // the bed's own floor (float32 in the grid: rounded back to the mm it was authored at)
      const floorY = Math.round(g.floorOf(g.idx(t.x0, t.y0)) * 1000) / 1000;
      for (const from of ['x0', 'x1'] as const) {
        out.push({trench: ti, t, from, face: from === 'x1' ? t.x1 : t.x0, dir: from === 'x1' ? 1 : -1, half: (t.y1 - t.y0) * CELL / 2, cz: (t.y0 + t.y1) * CELL / 2, floorY});
      }
    });
    return out;
  }

  private shapes(rng: Rng, cls: number, minFirst = 0): ShapeStep[][] {
    const T = this.cfg.tunnel, total = T.length[1] + T.capDepth + 2;
    const R = () => Math.round(rng.range(T.radius[0], T.radius[1]));
    const turn = () => rng.pick(T.turnsDeg) * (rng.chance(0.5) ? 1 : -1);
    // first straight: often long enough for an annex door (s >= doorMinS on the bed-aligned run), else short (an early bend);
    // (GEN-2) an annex host (minFirst > 0) always long enough: drawn in [minFirst, firstStraight max]
    const mid = Math.min(T.firstStraight[1], this.cfg.annex.doorMinS + 4);
    const host = Math.min(minFirst, T.firstStraight[1]);
    const fs = () => Math.round((minFirst > 0 ? rng.range(host, T.firstStraight[1]) : rng.chance(0.6) ? rng.range(mid, T.firstStraight[1]) : rng.range(T.firstStraight[0], mid)) * 2) / 2;
    const out: ShapeStep[][] = [];
    const finish = (steps: ShapeStep[]) => {
      let len = 0;
      for (const s of steps) len += 'line' in s ? s.line : s.arc.r * Math.abs(s.arc.turnDeg) * Math.PI / 180;
      steps.push({line: Math.max(1, total - len)});
      return steps;
    };
    if (cls === 0) out.push(finish([]));
    else if (cls === 1) out.push(finish([{line: fs()}, {arc: {r: R(), turnDeg: turn()}}]));
    else {
      const t1 = turn();
      const room = T.maxTurnDeg - Math.abs(t1);
      const opts = T.turnsDeg.filter(t => t <= room);
      if (!opts.length) out.push(finish([{line: fs()}, {arc: {r: R(), turnDeg: t1}}]));
      else {
        const t2 = rng.pick(opts) * (rng.chance(0.6) ? -Math.sign(t1) : Math.sign(t1));
        out.push(finish([{line: fs()}, {arc: {r: R(), turnDeg: t1}}, {line: Math.round(rng.range(4, 20))}, {arc: {r: R(), turnDeg: t2}}]));
      }
    }
    return out;
  }

  /**
   * Plans (and claims) a tunnel at a bed end; returns the reason when none fits. (GEN-2) `minFirst` > 0: an annex host — every
   * shape's first straight is at least that long; when none of those fits this end, the ordinary shapes are tried after them.
   */
  planTunnel(end: BedEndInfo, rng: Rng, minFirst = 0): PlannedTunnel | string {
    const T = this.cfg.tunnel, id = this.tunnels.length;
    const start: Vec2 = {x: end.face * CELL, z: end.cz}, dir: Vec2 = {x: end.dir, z: 0};
    const want = rng.range(T.length[0], T.length[1]);
    const cls = rng.weighted(T.arcWeights.map((w, i) => [i, w] as [number, number]));
    // the drawn shape (3 parameterisations) first, then the other classes (2 each) as fallbacks
    const shapeList = (mf: number) => {
      const out: {steps: ShapeStep[]; drawn: boolean}[] = [];
      for (let i = 0; i < 3; i++) for (const s of this.shapes(rng, cls, mf)) out.push({steps: s, drawn: true});
      for (const c of [0, 1, 2]) if (c !== cls) for (let i = 0; i < (c === 0 ? 1 : 2); i++) for (const s of this.shapes(rng, c, mf)) out.push({steps: s, drawn: false});
      return out;
    };
    // (cast: `choose` below assigns it from a closure)
    let best = null as {path: TunnelPath; tube: TubeCells; L: number; score: number} | null;
    let why = 'blocked at the mouth';
    const ok = (x: number, y: number) => this.cellOk(x, y, id, end.t);
    // every shape shares its first straight (>= firstStraight[0]): blocked there = no tunnel at this end
    const shared = tubeCells(buildPath(start, dir, [{line: T.firstStraight[0] + T.capDepth + 1}]), end.half, T.firstStraight[0], T.capDepth, ok);
    if (shared.limit < T.firstStraight[0] - 1e-6) return shared.limit > 0 ? `too short (${shared.limit.toFixed(1)} m free)` : why;
    const choose = (cands: {steps: ShapeStep[]; drawn: boolean}[]) => {
      for (const c of cands) {
        const path = buildPath(start, dir, c.steps);
        const tube = tubeCells(path, end.half, T.length[1], T.capDepth, ok);
        const limit = tube.limit;
        let L = Math.min(want, limit);
        if (L < T.length[0]) { if (limit > 0) why = `too short (${limit.toFixed(1)} m free)`; continue; }
        L = this.budgetLength(path, end.half, T.length[0], L);
        if (L < T.length[0]) { why = 'grid budget'; continue; }
        // prefer reaching the drawn length with the drawn shape, then the least grid growth (1 m per GROWTH_CELLS_PER_M cells)
        const score = Math.min(L, want) + (c.drawn ? 6 : 0) - this.growthOf(path, end.half, L) / GROWTH_CELLS_PER_M;
        if (!best || score > best.score + 1e-9) best = {path, tube, L: Math.floor(L * 2) / 2, score};
        if (c.drawn && L >= want - 1e-6) break;
      }
    };
    choose(shapeList(minFirst));
    if (!best && minFirst > 0) choose(shapeList(0));
    if (!best) return why;
    const {path, tube} = best;
    const L = best.L;
    const footX: number[] = [], footY: number[] = [];
    for (let i = 0; i < tube.x.length; i++) {
      if (tube.s[i] - tube.e[i] >= L + T.capDepth - 1e-9) continue;
      if (!this.cellOk(tube.x[i], tube.y[i], id, end.t)) return 'footprint check failed';
      footX.push(tube.x[i]); footY.push(tube.y[i]);
    }
    const walk = walkCells(path, end.half, L, tube);
    const walkSet = new Set<number>();
    for (let i = 0; i < walk.x.length; i++) walkSet.add(vkey(walk.x[i], walk.y[i]));
    // mouth: the first column past the face holds every bed row (no lip)
    const mouthX = end.dir > 0 ? end.face : end.face - 1;
    for (let y = end.t.y0; y < end.t.y1; y++) if (!walkSet.has(vkey(mouthX, y))) return 'mouth not flush';
    const first = path.prims[0];
    const firstStraight = Math.min(L, first && first.kind === 'line' ? first.len : 0);
    // claim + bbox (the footprint box: the smooth walls stay inside the crop)
    this.claim(footX, footY, id);
    const fb = {x0: Math.min(...footX), y0: Math.min(...footY), x1: Math.max(...footX), y1: Math.max(...footY)};
    this.box = this.grown(fb);
    const area = this.addTunnelArea(end, walk, id);
    const cap = rng.weighted(Object.entries(T.caps) as [CapKind, number][]);
    const pt: PlannedTunnel = {id, end, path, length: L, firstStraight, walk, walkSet, foot: {x: footX, y: footY}, area, cap};
    this.tunnels.push(pt);
    this.carve.rects.push({x: fb.x0, y: fb.y0, w: fb.x1 - fb.x0 + 1, h: fb.y1 - fb.y0 + 1});
    return pt;
  }

  /** Conservative cell box of a tunnel's walls up to length `len`. */
  private boxOf(path: TunnelPath, half: number, len: number): {x0: number; y0: number; x1: number; y1: number} {
    const b = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
    for (const p of samplePath(path, len + this.cfg.tunnel.capDepth)) {
      b.x0 = Math.min(b.x0, Math.floor((p.x - half - 0.5) / CELL)); b.x1 = Math.max(b.x1, Math.floor((p.x + half + 0.5) / CELL));
      b.y0 = Math.min(b.y0, Math.floor((p.z - half - 0.5) / CELL)); b.y1 = Math.max(b.y1, Math.floor((p.z + half + 0.5) / CELL));
    }
    return b;
  }

  /** Grid cells a tunnel of length L would add to the crop. */
  private growthOf(path: TunnelPath, half: number, L: number): number {
    return this.cellsFor(this.grown(this.boxOf(path, half, L))) - this.cellsFor(this.box);
  }

  /** Largest length <= L (>= min, else min - 1) whose walls keep the crop within the grid budget. */
  private budgetLength(path: TunnelPath, half: number, min: number, L: number): number {
    const boxOf = (len: number) => this.boxOf(path, half, len);
    if (this.fits(boxOf(L))) return L;
    if (!this.fits(boxOf(min))) return min - 1;
    let lo = min, hi = L;
    for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (this.fits(boxOf(m))) lo = m; else hi = m; }
    return lo;
  }

  private addTunnelArea(end: BedEndInfo, walk: {x: number[]; y: number[]}, id: number): number {
    const t = end.t;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < walk.x.length; i++) { x0 = Math.min(x0, walk.x[i]); x1 = Math.max(x1, walk.x[i]); y0 = Math.min(y0, walk.y[i]); y1 = Math.max(y1, walk.y[i]); }
    const a: Area = {
      x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, id: this.carve.areas.length, kind: 'service', type: 'service-corridor', label: 'Track tunnel',
      ceil: t.ceil, parent: -1, depth: 0, publicSpace: false, lighting: 'dark', floorY: end.floorY, ext: 'tunnel', extId: id,
    };
    this.carve.areas.push(a);
    for (let i = 0; i < walk.x.length; i++) this.carve.cells.push({x: walk.x[i], y: walk.y[i], area: a.id, floor: end.floorY, ceil: t.ceil});
    return a.id;
  }

  // ---------------------------------------------------------------------------------------------
  // Annexes

  /** Arc-length window of the entry door on a tunnel's first straight (null: not eligible). */
  doorWindow(pt: PlannedTunnel): [number, number] | null {
    const A = this.cfg.annex;
    const hi = Math.min(pt.firstStraight - A.doorCells * CELL - 0.5, pt.length - A.doorEndClear);
    return hi >= A.doorMinS ? [A.doorMinS, hi] : null;
  }

  get planned(): readonly PlannedTunnel[] { return this.tunnels; }

  /** Rect test for an annex area of `group`: core / other-group margins on every cell, one wall cell to the own group. */
  private rectOk(r: Rect, group: number): boolean {
    if (r.w < 1 || r.h < 1) return false;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!this.cellOk(x, y, group, null)) return false;
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const i = this.vi(x, y);
      if (i < 0 || this.own[i] === group + 1) return false;
    }
    return true;
  }

  /** Tries to grow an annex off tunnel `pt` (claims it on success); returns the reason on failure (nothing claimed). */
  planAnnex(pt: PlannedTunnel, annexId: number, rng: Rng): {annex: ServiceAnnex; doorS: number; side: 1 | -1; door: number} | string {
    const A = this.cfg.annex, win = this.doorWindow(pt);
    if (!win) return 'first straight too short';
    const end = pt.end, t = end.t, group = pt.id, dc = A.doorCells;
    const target = A.share * SUBWAY_WALK_BASELINE_M2 * rng.range(A.jitter[0], A.jitter[1]);
    const minM2 = A.minShare * SUBWAY_WALK_BASELINE_M2;
    const cellsOf = (m: number) => Math.max(1, Math.round(m / CELL));
    let last = 'no entry corridor fits';
    for (const side of rng.shuffle([1, -1] as (1 | -1)[])) {
      for (let tryK = 0; tryK < 4; tryK++) {
        const s = rng.range(win[0], win[1]);
        const off = Math.floor(s / CELL);
        const xd = end.dir > 0 ? end.face + off : end.face - 1 - off - (dc - 1);
        const north = (end.dir > 0) === (side > 0);
        const wallRow = north ? t.y0 - 1 : t.y1, tunnelRow = north ? t.y0 : t.y1 - 1;
        let ok = true;
        for (let x = xd; x < xd + dc; x++) if (!pt.walkSet.has(vkey(x, tunnelRow)) || !this.coreFree(x, wallRow, t) || this.own[this.vi(x, wallRow)] !== 0) { ok = false; break; }
        if (!ok) { last = 'door wall'; continue; }
        const cw = rng.int(cellsOf(A.corridorWidth[0]), cellsOf(A.corridorWidth[1]));
        const cl = rng.int(cellsOf(A.corridorLength[0]), cellsOf(A.corridorLength[1]));
        const xc = xd - rng.int(0, Math.max(0, cw - dc));
        const root: Rect = north ? {x: xc, y: wallRow - cl, w: cw, h: cl} : {x: xc, y: wallRow + 1, w: cw, h: cl};
        if (!this.rectOk(root, group) || !this.fits({x0: root.x, y0: root.y, x1: root.x + root.w - 1, y1: root.y + root.h - 1})) { last = 'entry corridor blocked'; continue; }
        const res = this.grow({group, floorY: end.floorY, area: pt.area, tunnel: pt.id}, annexId, rng, root, north ? 'N' : 'S', {x: xd, y: wallRow, w: dc, h: 1}, target, minM2);
        if (typeof res === 'string') { last = res; continue; }
        const doorS = (end.dir > 0 ? xd - end.face : end.face - (xd + dc)) * CELL + dc * CELL / 2;
        return {...res, doorS, side};
      }
    }
    return last;
  }

  /** (GEN-2) Extension group of a hatch annex (after every tunnel's group). */
  private hatchGroups = 0;

  /** (GEN-2) Bed-wall row and the row of bed cells in front of it, for a side wall of a bed. */
  private static wallRows(t: TrenchCells, wall: 'N' | 'S'): {wallRow: number; bedRow: number} {
    return wall === 'N' ? {wallRow: t.y0 - 1, bedRow: t.y0} : {wallRow: t.y1, bedRow: t.y1 - 1};
  }

  /** (GEN-2) Cell column of bed-frame arc position s (m from the end face, into the station) — fractional, in cell units. */
  private static colAt(end: BedEndInfo, s: number): number {
    return end.face - end.dir * s / CELL;
  }

  /**
   * (GEN-2) Tries to grow a SERVICE-HATCH annex at a bed end no tunnel continues: a door through one of the bed's side walls
   * (`hatch.s` m from the end face; the wall cells and a jamb either side must be rock on every level grid — never a platform
   * face), the entry corridor running straight away from the bed into the rock, then the same room-graph growth as off a tunnel.
   * Claims it on success; returns the reason on failure (nothing claimed, nothing recorded).
   */
  planHatch(end: BedEndInfo, annexId: number, rng: Rng): {annex: ServiceAnnex; door: number; entry: HatchEntry} | string {
    const A = this.cfg.annex, H = this.cfg.hatch;
    if (!H) return 'no hatches configured';
    const t = end.t, dc = A.doorCells, g = this.k.g, group = this.tunnels.length + this.hatchGroups;
    const target = A.share * SUBWAY_WALK_BASELINE_M2 * rng.range(A.jitter[0], A.jitter[1]);
    const minM2 = A.minShare * SUBWAY_WALK_BASELINE_M2;
    const cellsOf = (m: number) => Math.max(1, Math.round(m / CELL));
    let last = 'no hatch wall fits';
    for (const wall of rng.shuffle(['N', 'S'] as ('N' | 'S')[])) {
      const {wallRow, bedRow} = Carver.wallRows(t, wall);
      if (wallRow < 1 || wallRow >= this.H - 1) continue;
      for (let tryK = 0; tryK < 5; tryK++) {
        const s = rng.range(H.s[0], H.s[1]);
        const xd = Math.round(Carver.colAt(end, s) - dc / 2);
        // inside the bed span, one wall cell between the opening and the end face
        if (xd < t.x0 + 1 || xd + dc > t.x1 - 1) { last = 'hatch off the bed'; continue; }
        let ok = true;
        for (let x = xd - 1; x <= xd + dc && ok; x++) {
          const i = g.idx(x, wallRow);
          // the opening and a jamb either side are wall: rock on every level grid (a platform face is open floor: refused)
          for (const L of this.k.levelGrids) if (L.cells[i] !== SOLID) { ok = false; break; }
          if (!ok || x < xd || x >= xd + dc) continue;
          // in front of the opening the bed itself; the opening keeps the core / extension margins (its own bed exempt)
          if (g.cells[g.idx(x, bedRow)] !== VOID || !this.coreFree(x, wallRow, t) || this.own[this.vi(x, wallRow)] !== 0 || !this.extFree(x, wallRow, group)) ok = false;
        }
        if (!ok) { last = 'hatch wall'; continue; }
        const north = wall === 'N';
        const cw = rng.int(cellsOf(A.corridorWidth[0]), cellsOf(A.corridorWidth[1]));
        const cl = rng.int(cellsOf(A.corridorLength[0]), cellsOf(A.corridorLength[1]));
        const xc = xd - rng.int(0, Math.max(0, cw - dc));
        const root: Rect = north ? {x: xc, y: wallRow - cl, w: cw, h: cl} : {x: xc, y: wallRow + 1, w: cw, h: cl};
        if (!this.rectOk(root, group) || !this.fits({x0: root.x, y0: root.y, x1: root.x + root.w - 1, y1: root.y + root.h - 1})) { last = 'entry corridor blocked'; continue; }
        const doorRect: Rect = {x: xd, y: wallRow, w: dc, h: 1};
        const res = this.grow({group, floorY: end.floorY, area: -1, tunnel: -1}, annexId, rng, root, north ? 'N' : 'S', doorRect, target, minM2);
        if (typeof res === 'string') { last = res; continue; }
        this.hatchGroups++;
        // the opening on the wall plane (the bed's z0 / z1 face); bed frame: travel from the end face into the station
        const head = this.carve.cells.find(c => c.x === xd && c.y === wallRow)!.ceil;
        const entry: HatchEntry = {
          trench: end.trench, from: end.from, wall, side: (wall === 'S') === (end.dir > 0) ? 1 : -1, door: res.door,
          s: round(Math.abs(end.face - (xd + dc / 2)) * CELL), x: round((xd + dc / 2) * CELL), z: round((north ? t.y0 : t.y1) * CELL),
          width: dc * CELL, floorY: end.floorY, head,
        };
        return {...res, entry};
      }
    }
    return last;
  }

  /**
   * (GEN-2) Graffiti spot check on a hatch's bed wall: the wall row cells under the bed-frame span [s0, s1] are rock on the main
   * level grid (a real wall face from the bed floor up: not a platform face, opening or another extension's cell).
   */
  bedWallSolid(entry: Pick<HatchEntry, 'trench' | 'from' | 'wall'>, s0: number, s1: number): boolean {
    const end = this.bedEnds().find(e => e.trench === entry.trench && e.from === entry.from);
    if (!end) return false;
    const {wallRow} = Carver.wallRows(end.t, entry.wall), g = this.k.g;
    const a = Carver.colAt(end, s0), b = Carver.colAt(end, s1);
    const x0 = Math.floor(Math.min(a, b)), x1 = Math.ceil(Math.max(a, b)) - 1;
    if (x0 < end.t.x0 || x1 >= end.t.x1) return false;
    for (let x = x0; x <= x1; x++) {
      if (!g.inBounds(x, wallRow) || g.cells[g.idx(x, wallRow)] !== SOLID) return false;
      const i = this.vi(x, wallRow);
      if (i < 0 || this.own[i] !== 0) return false;
    }
    return true;
  }

  /**
   * Room-graph growth from the entry corridor `root` (running away from the tunnel / bed toward `away`). Transactional: claims
   * cells as it goes; on failure every claim and record is rolled back.
   */
  private grow(from: AnnexEntry, annexId: number, rng: Rng, root: Rect, away: 'N' | 'S', doorRect: Rect, targetM2: number, minM2: number): {annex: ServiceAnnex; door: number} | string {
    const A = this.cfg.annex, group = from.group, floorY = from.floorY;
    const a0 = this.carve.areas.length, d0 = this.carve.doors.length, c0 = this.carve.cells.length, r0 = this.carve.rects.length;
    const claimed: number[] = [];
    const box0 = {...this.box};
    const own = (r: Rect) => {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = this.vi(x, y); this.own[i] = group + 1; claimed.push(i); }
    };
    const ceilH = () => Math.round(rng.range(A.ceil[0], A.ceil[1]) * 20) / 20;
    let cells = 0;
    const list: AnnexArea[] = [];
    const addArea = (r: Rect, kind: AnnexArea['kind'], parent: number, depth: number): AnnexArea => {
      let type: RoomType, ak: AreaKind;
      if (kind === 'corridor') { type = 'service-corridor'; ak = 'service'; }
      else if (kind === 'closet') { type = rng.chance(0.5) ? 'janitor-closet' : 'supply-closet'; ak = 'closet'; }
      else { type = rng.weighted([['utility', 0.42], ['storage', 0.36], ['crew-room', 0.22]] as [RoomType, number][]); ak = 'room'; }
      const h = ceilH();
      const a: Area = {
        ...r, id: this.carve.areas.length, kind: ak, type, label: kind === 'corridor' ? 'Service corridor' : ROOM_LABEL[type],
        ceil: Math.round((floorY + h) * 1000) / 1000, parent, depth, publicSpace: false, lighting: 'dark', floorY, ext: 'annex', extId: annexId,
      };
      this.carve.areas.push(a);
      own(r);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.carve.cells.push({x, y, area: a.id, floor: floorY, ceil: a.ceil});
      cells += r.w * r.h;
      this.box = this.grown({x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1});
      this.carve.rects.push({...r});
      const e: AnnexArea = {area: a.id, rect: r, kind, depth};
      list.push(e);
      return e;
    };
    const addDoor = (r: Rect, a: number, b: number): number => {
      const ab = this.carve.areas[b];
      const h = A.doorHeight;
      const d: Door = {...r, id: this.carve.doors.length, a, b, height: h, arch: false};
      this.carve.doors.push(d);
      own(r);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.carve.cells.push({x, y, area: b, floor: floorY, ceil: Math.round((floorY + Math.min(h, ab.ceil - floorY)) * 1000) / 1000});
      cells += r.w * r.h;
      return d.id;
    };
    const rollback = (why: string): string => {
      this.carve.areas.length = a0; this.carve.doors.length = d0; this.carve.cells.length = c0; this.carve.rects.length = r0;
      for (const i of claimed) this.own[i] = 0;
      this.box = box0;
      return why;
    };
    /** Rect adjacent to `p` on `side` (one wall cell between), `along` x `deep`, at overlap offset u in [0, 1]. */
    const adjacent = (p: Rect, side: 'N' | 'S' | 'E' | 'W', along: number, deep: number, u: number): Rect => {
      const need = Math.min(A.doorCells + 2, side === 'N' || side === 'S' ? p.w : p.h);
      if (side === 'N' || side === 'S') {
        const lo = p.x - along + need, hi = p.x + p.w - need;
        const x = Math.round(lo + (hi - lo) * u);
        return {x, y: side === 'S' ? p.y + p.h + 1 : p.y - 1 - deep, w: along, h: deep};
      }
      const lo = p.y - along + need, hi = p.y + p.h - need;
      const y = Math.round(lo + (hi - lo) * u);
      return {x: side === 'E' ? p.x + p.w + 1 : p.x - 1 - deep, y, w: deep, h: along};
    };
    /** Door rect in the shared wall of p and c (null when the overlap is too small). */
    const wallDoor = (p: Rect, c: Rect, width: number): Rect | null => {
      let horizontal: boolean, line: number, s0: number, s1: number;
      if (p.y + p.h + 1 === c.y || c.y + c.h + 1 === p.y) { horizontal = true; line = p.y + p.h + 1 === c.y ? p.y + p.h : c.y + c.h; s0 = Math.max(p.x, c.x); s1 = Math.min(p.x + p.w, c.x + c.w); }
      else if (p.x + p.w + 1 === c.x || c.x + c.w + 1 === p.x) { horizontal = false; line = p.x + p.w + 1 === c.x ? p.x + p.w : c.x + c.w; s0 = Math.max(p.y, c.y); s1 = Math.min(p.y + p.h, c.y + c.h); }
      else return null;
      // a door with a jamb either side when the overlap allows it, else the full overlap (a corridor end opening into a room)
      if (s1 - s0 < 2) return null;
      width = Math.min(width, s1 - s0);
      const m = s1 - s0 >= width + 2 ? 1 : 0;
      const lo = s0 + m, hi = s1 - m - width;
      if (hi < lo) return null;
      const s = rng.int(lo, hi);
      const r: Rect = horizontal ? {x: s, y: line, w: width, h: 1} : {x: line, y: s, w: 1, h: width};
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = this.vi(x, y); if (i < 0 || this.own[i] !== 0 || !this.coreFree(x, y, null)) return null; }
      return r;
    };
    const cellsOf = (m: number) => Math.max(1, Math.round(m / CELL));
    const roomDims = (closet: boolean): [number, number] => {
      if (closet) { const a = rng.int(cellsOf(A.roomMin[0]), cellsOf(A.closetMax)), b = rng.int(cellsOf(A.roomMin[1]), cellsOf(A.closetMax)); return [a, b]; }
      // big plant / store rooms more often than small ones (cramped, but worth the walk)
      const big = rng.chance(0.6);
      const sMin = cellsOf(big ? 5.5 : A.roomMin[0]), sMax = cellsOf(big ? A.roomMax[0] : 5.5);
      const s = rng.int(sMin, sMax);
      const l = rng.int(Math.max(s, cellsOf(A.roomMin[1])), Math.max(s, cellsOf(big ? A.roomMax[1] : 7)));
      return rng.chance(0.5) ? [s, l] : [l, s];
    };
    const growth = (r: Rect) => this.cellsFor(this.grown({x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1})) - this.cellsFor(this.box);

    // root corridor + the entry door (tunnel area -> corridor) + a room at its far end (dead ends end in rooms)
    const rootA = addArea(root, 'corridor', from.area, 1);
    // (GEN-2: a hatch door joins the bed, which has no area: a = b = the entry corridor)
    const entry = addDoor(doorRect, from.area >= 0 ? from.area : rootA.area, rootA.area);
    const endRoom = (c: AnnexArea, dirSide: 'N' | 'S' | 'E' | 'W'): boolean => {
      for (let k = 0; k < 6; k++) {
        const [along, deep] = roomDims(rng.chance(0.2));
        const r = adjacent(c.rect, dirSide, along, deep, rng.next());
        if (!this.rectOk(r, group) || !this.fits({x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1})) continue;
        const dw = wallDoor(c.rect, r, Math.min(A.doorCells, c.kind === 'corridor' ? Math.min(c.rect.w, c.rect.h) : A.doorCells));
        if (!dw) continue;
        const kind = along <= cellsOf(A.closetMax) && deep <= cellsOf(A.closetMax) ? 'closet' : 'room';
        const e = addArea(r, kind, c.area, c.depth + 1);
        addDoor(dw, c.area, e.area);
        return true;
      }
      return false;
    };
    if (!endRoom(rootA, away)) return rollback('no room at the entry corridor end');

    const sides: ('N' | 'S' | 'E' | 'W')[] = ['N', 'S', 'E', 'W'];
    const target = targetM2 / (CELL * CELL);
    let corridors = 1;
    for (let step = 0; step < A.steps && cells < target; step++) {
      const parents = list.map(e => [e, e.kind === 'corridor' ? 3 : e.kind === 'room' ? (e.depth < 9 ? 1.1 : 0.3) : 0] as [AnnexArea, number]).filter(e => e[1] > 0);
      if (!parents.length) break;
      const P = rng.weighted(parents);
      const kind: AnnexArea['kind'] = P.kind === 'corridor'
        ? rng.weighted([['room', 0.62], ['corridor', corridors < 14 ? 0.26 : 0], ['closet', 0.12]] as [AnnexArea['kind'], number][])
        : rng.weighted([['closet', 0.25], ['room', 0.5], ['corridor', corridors < 14 ? 0.25 : 0]] as [AnnexArea['kind'], number][]);
      let best: {r: Rect; side: 'N' | 'S' | 'E' | 'W'; g: number} | null = null;
      for (let c = 0; c < 4; c++) {
        const side = rng.pick(sides);
        let along: number, deep: number;
        if (kind === 'corridor') {
          const cw = rng.int(cellsOf(A.corridorWidth[0]), cellsOf(A.corridorWidth[1])), cl = rng.int(cellsOf(A.corridorLength[0]), cellsOf(A.corridorLength[1]));
          // away from the parent (deep = length) or along its wall (along = length)
          [along, deep] = rng.chance(0.55) ? [cw, cl] : [cl, cw];
        } else [along, deep] = roomDims(kind === 'closet');
        const r = adjacent(P.rect, side, along, deep, rng.next());
        if (!this.rectOk(r, group) || !this.fits({x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1})) continue;
        const g = growth(r);
        if (!best || g < best.g) best = {r, side, g};
      }
      if (!best) continue;
      const dw = wallDoor(P.rect, best.r, kind === 'closet' ? 2 : Math.min(A.doorCells, kind === 'corridor' ? Math.min(best.r.w, best.r.h) : A.doorCells));
      if (!dw) continue;
      const kindF = kind === 'room' && best.r.w <= cellsOf(A.closetMax) && best.r.h <= cellsOf(A.closetMax) ? 'closet' : kind;
      const mark = {a: this.carve.areas.length, d: this.carve.doors.length, c: this.carve.cells.length, r: this.carve.rects.length, l: list.length, cells, claimed: claimed.length, box: {...this.box}};
      const e = addArea(best.r, kindF, P.area, P.depth + 1);
      addDoor(dw, P.area, e.area);
      if (kindF === 'corridor') {
        // a corridor runs on to a room at its far end (or is undone)
        const far: 'N' | 'S' | 'E' | 'W' = best.r.w < best.r.h ? (best.side === 'S' ? 'S' : best.side === 'N' ? 'N' : rng.pick(['N', 'S'] as const))
          : (best.side === 'E' ? 'E' : best.side === 'W' ? 'W' : rng.pick(['E', 'W'] as const));
        if (!endRoom(e, far)) {
          this.carve.areas.length = mark.a; this.carve.doors.length = mark.d; this.carve.cells.length = mark.c; this.carve.rects.length = mark.r;
          list.length = mark.l; cells = mark.cells;
          for (let i = mark.claimed; i < claimed.length; i++) this.own[claimed[i]] = 0;
          claimed.length = mark.claimed;
          this.box = mark.box;
          continue;
        }
        corridors++;
      }
    }
    if (cells * CELL * CELL < minM2) return rollback(`too small (${Math.round(cells * CELL * CELL)} m² < ${Math.round(minM2)} m²)`);

    // one main loop: an extra door between two neighbouring areas far apart in the door graph
    if (rng.chance(A.loopChance)) {
      const ids = list.map(e => e.area);
      const adj = new Map<number, number[]>();
      for (const d of this.carve.doors.slice(d0)) for (const [p, q] of [[d.a, d.b], [d.b, d.a]]) { let l = adj.get(p); if (!l) adj.set(p, (l = [])); l.push(q); }
      const hops = (s: number): Map<number, number> => {
        const dist = new Map<number, number>([[s, 0]]), q = [s];
        while (q.length) { const v = q.shift()!; for (const w of adj.get(v) ?? []) if (!dist.has(w)) { dist.set(w, dist.get(v)! + 1); q.push(w); } }
        return dist;
      };
      const pairs: [AnnexArea, AnnexArea][] = [];
      for (let i = 0; i < list.length; i++) {
        const di = hops(ids[i]);
        for (let j = i + 1; j < list.length; j++) {
          if ((di.get(ids[j]) ?? 99) < 4) continue;
          if (list[i].kind === 'closet' || list[j].kind === 'closet') continue;
          pairs.push([list[i], list[j]]);
        }
      }
      for (const [p, q] of rng.shuffle(pairs)) {
        const dw = wallDoor(p.rect, q.rect, Math.min(A.doorCells, p.kind === 'corridor' ? Math.min(p.rect.w, p.rect.h) : A.doorCells, q.kind === 'corridor' ? Math.min(q.rect.w, q.rect.h) : A.doorCells));
        if (!dw) continue;
        addDoor(dw, p.area, q.area);
        break;
      }
    }
    // commit: the other groups keep margin.ext from every annex cell
    const xs: number[] = [], ys: number[] = [];
    for (let i = c0; i < this.carve.cells.length; i++) { xs.push(this.carve.cells[i].x); ys.push(this.carve.cells[i].y); }
    this.claim(xs, ys, group);
    const areas = list.map(e => e.area);
    const ceilY = Math.max(...areas.map(i => this.carve.areas[i].ceil));
    const ex = (doorRect.x + doorRect.w / 2) * CELL, ez = (doorRect.y + doorRect.h / 2) * CELL;
    return {annex: {id: annexId, tunnel: from.tunnel, door: entry, areas, floorY, ceilY, cells, areaM2: cells * CELL * CELL, exit: {x: ex, z: ez}}, door: entry};
  }

  // ---------------------------------------------------------------------------------------------
  // Records

  tunnelRecord(pt: PlannedTunnel): TrackTunnel {
    const end = pt.end, t = end.t;
    // <= 0.5 m spacing even after rounding the samples to 0.1 mm
    const path = samplePath(pt.path, pt.length, CELL - 0.01).map(p => ({x: round(p.x), z: round(p.z)}));
    const rails = t.tracks.map(z => round(end.dir > 0 ? end.cz - z : z - end.cz));
    const arcs: TrackTunnel['arcs'] = [];
    for (const q of pt.path.prims) {
      if (q.kind !== 'arc' || q.s0 >= pt.length - 1e-9) continue;
      const len = Math.min(q.len, pt.length - q.s0);
      arcs.push({s: round(q.s0), len: round(len), radius: q.r, turnDeg: round(q.side * len / q.r * 180 / Math.PI)});
    }
    return {
      id: pt.id, trench: end.trench, from: end.from, floorY: end.floorY, ceilY: t.ceil, width: (t.y1 - t.y0) * CELL,
      path, length: pt.length, rails, cap: {kind: pt.cap, s: pt.length}, areas: [pt.area], doors: [], clues: [],
      firstStraight: round(pt.firstStraight), arcs,
    };
  }

  /** End point of a planned tunnel (QA). */
  static end(pt: PlannedTunnel): Vec2 { return pathEnd(pt.path).p; }
  static at(pt: PlannedTunnel, s: number): Vec2 { return pointAt(pt.path, s).p; }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
