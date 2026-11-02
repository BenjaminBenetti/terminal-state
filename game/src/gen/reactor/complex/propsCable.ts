// Task reactor-playtest-round2-20261102 (lane PROPS, user bullet 11): "cables that show path to generator (good idea btw) should be along
// the roof. Right now they clip awkwardly through the doorways and stuff". THE CEILING CABLE ROUTE inside a side complex.
//
// Was (host.ts complexCable): one cable height for the whole complex (2.6 m or 0.25 m under the LOWEST ceiling / door head on the way,
// ~2.15 m behind 2.4 m doors) string-pulled diagonally across rooms and straight through the upper part of every door opening.
//
// Now, on whatever rooms the carver generated (the bunker / mines / waste lanes re-randomise their layouts), from the generator's use
// point to the complex entrance:
//  - a least-cost route over the complex's floor cells (axis-aligned runs, turns cost, a mild pull toward the walls, cells whose ceiling
//    band is taken by a fixture / sign / duct / prop cost more or are closed);
//  - every run hangs UNDER THE CEILING (its centre CEILING_CABLE.drop under the lowest ceiling of its cells) on drop rods, or under what
//    spans the ceiling band where the route has no way round it (the mines' timber set caps: it hangs under the caps), never lower than
//    CEILING_CABLE.minY over the storey floor (over the 1.9 m body);
//  - between rooms it goes UP AND OVER THE DOOR LINTEL, through the wall above the opening (a penetration), never through the opening;
//    where a door has no lintel to pass over (its head at the ceiling) or a plate / fixture takes the wall above it, it goes through the
//    wall BESIDE the door jamb (within CEILING_CABLE.besideReach cells), still leading the eye through the doorway;
//  - out through the entrance wall the same way, onto the deck's pit wall: host.ts continues with cableOf along the pit walls to the
//    zone's fans.
// Pure data (no three.js): the obstacles are the layout's own records (props, fixtures, signs, decor boxes, the waste repository's
// decor, the mines' timber set caps from their post pairs). Returns null when no route exists (the host keeps its old routing).

import {CELL, FLOOR, type Grid} from '../../grid';
import type {Door, StationLayout} from '../../stationTypes';
import {signDims} from '../../doorways';
import type {ReactorGenerator} from '../reactorTypes';
import {MINE_PIECE, MINE_SETS, timberSetFit} from './minesDress';

/** What the route needs of a complex (host.ts: its ComplexCarve's slot + areas; tests: layout.reactor.complexes + the storey's baseY). */
export interface CableComplex { level: number; baseY: number; frontArea: number; areas: readonly number[] }

export const CEILING_CABLE = {
  /** Cable centre under the ceiling (its body: tray -0.075 .. wires +0.0475 about the centre; the drop rods fill the gap above). */
  drop: 0.12,
  /** Lowest cable centre over the storey floor (body bottom 2.075 m: over the 1.9 m walking body and every door head's sightline). */
  minY: 2.15,
  /** Cable centre under an obstacle's underside it passes below (a timber cap, a hung fixture); its body over one it passes above. */
  under: 0.08, over: 0.03,
  /** An obstacle's footprint grown by this (tray half-width 0.16 + margin) covers a cell centre. */
  grow: 0.25,
  /** Over a door: the cable centre at least this above its head (the body 10 cm over the lintel). */
  lintel: 0.175,
  /** Wall cells beside a door's jamb a crossing may use when the lintel leaves no room. */
  besideReach: 3,
  /** Drop rods (hangers) along the runs, m apart; the longest drop drawn. */
  hangerPitch: 1.6, hangerMax: 3.2,
  /** Route costs: per cell, a turn, an interior cell (no wall beside it), a cell whose ceiling band is taken, a crossing beside a jamb. */
  cost: {cell: 1, turn: 3, interior: 0.3, low: 4, beside: 3},
  /** The cable body about its centre (tray bottom, wires top). */
  body: [-0.075, 0.0475] as const,
} as const;

export interface CablePoint { x: number; y: number; z: number }
export interface CableHanger { x: number; z: number; y0: number; y1: number }
export interface CeilingCableRoute {
  /** From the generator panel's riser top to the exit on the deck side of the entrance wall (absolute y). */
  pts: CablePoint[];
  /** The exit point (deck side): cableOf continues from it along the pit wall. */
  exit: CablePoint;
  /** Drop rods from the tray to the ceiling / the cap it hangs under. */
  hangers: CableHanger[];
  /** Wall crossings: over a lintel / beside a jamb (door id). */
  crossings: {door: number; kind: 'lintel' | 'beside'; y: number}[];
}

/** An axis-aligned obstacle box (absolute y); `cap` = structure the cable may hang under (a timber set's cap). */
export interface Obst { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; cap?: boolean }

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** AABB half extents of a box `hl` along / `hw` across a yaw `rot` (about Y). */
const rotHalf = (hl: number, hw: number, rot: number): [number, number] => {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  return [hl * c + hw * s, hl * s + hw * c];
};

/**
 * Everything that can take the ceiling band of a complex's rooms and the deck in front of its entrance, from the layout's records: the
 * storey's props, fixtures, signs and decor boxes inside `bounds` (world x0, z0, x1, z1; a plate or frame on a wall belongs to no
 * area), the waste repository's decor, the mines' timber set caps.
 */
export function cableObstacles(layout: StationLayout, level: number, base: number, bounds: readonly [number, number, number, number], g: Grid): Obst[] {
  const out: Obst[] = [];
  const ceilAt = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && g.ceil[g.idx(cx, cy)] > base ? g.ceil[g.idx(cx, cy)] : base + 6; };
  const near = (x: number, z: number, r = 0) => x + r >= bounds[0] && x - r <= bounds[2] && z + r >= bounds[1] && z - r <= bounds[3];
  const box = (x: number, z: number, hx: number, hz: number, y0: number, y1: number, cap?: boolean) => out.push({x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz, y0, y1, ...(cap ? {cap} : {})});
  for (const p of layout.props) {
    if ((p.level ?? 0) !== level || !near(p.x, p.z, Math.hypot(p.hx, p.hz))) continue;
    const [hx, hz] = p.round ? [p.hx, p.hx] : rotHalf(p.hx, p.hz, p.rot ?? 0);
    box(p.x, p.z, hx, hz, p.y, p.y + p.h + ((p as {lift?: number}).lift ?? 0));
  }
  for (const l of layout.lights) {
    if (l.virtual || (l.level ?? 0) !== level || !near(l.x, l.z, 1)) continue;
    const top = Math.max(ceilAt(l.x, l.z), l.y + 0.45); // a hung fixture's rods / a pendant's hanger reach the ceiling
    if (l.mount) { box(l.x, l.z, 0.3, 0.3, l.y - 0.4, l.y + 0.3); box(l.mount.x, l.mount.z, 0.3, 0.3, l.mount.y - 0.3, l.mount.y + 0.3); continue; }
    const [hx, hz] = rotHalf(0.65, 0.2, l.rot);
    box(l.x, l.z, Math.max(hx, 0.2), Math.max(hz, 0.2), l.y - 0.4, top);
  }
  for (const s of layout.signs) {
    if ((s.level ?? 0) !== level || !near(s.x, s.z, 1.5)) continue;
    const d = signDims(s), [hx, hz] = rotHalf(d.w / 2, 0.08, s.rot);
    box(s.x, s.z, hx, hz, s.y - d.h / 2 - 0.02, s.hang ? Math.max(ceilAt(s.x, s.z), s.y + d.h / 2) : s.y + d.h / 2 + 0.02);
  }
  for (const b of layout.decor) {
    const bb = b as {x0: number; z0: number; x1: number; z1: number; y0?: number; y1?: number};
    if (bb.y0 === undefined || bb.y1 === undefined || bb.y1 < base - 0.5 || bb.y0 > base + 9 || !near((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2, 2)) continue;
    out.push({x0: Math.min(bb.x0, bb.x1), z0: Math.min(bb.z0, bb.z1), x1: Math.max(bb.x0, bb.x1), z1: Math.max(bb.z0, bb.z1), y0: bb.y0, y1: bb.y1});
  }
  const W = layout.reactorWaste;
  if (W && W.level === level) {
    for (const b of W.boxes) out.push({x0: Math.min(b.x0, b.x1), z0: Math.min(b.z0, b.z1), x1: Math.max(b.x0, b.x1), z1: Math.max(b.z0, b.z1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1)});
    for (const c of W.cyls) {
      if (c.ax === 'x') box(c.x, c.z, c.h / 2, c.r, c.y - c.r, c.y + c.r);
      else if (c.ax === 'z') box(c.x, c.z, c.r, c.h / 2, c.y - c.r, c.y + c.r);
      else box(c.x, c.z, c.r, c.r, c.y, c.y + c.h);
    }
    for (const m of W.models) { const [hx, hz] = rotHalf(m.w / 2, m.d / 2, m.yaw); box(m.x, m.z, hx, hz, m.y, m.y + m.h); }
    for (const f of W.fans) box(f.x, f.z, f.r + 0.4, f.r + 0.4, f.y - f.r - 0.1, f.y + f.r + 0.1);
  }
  // the mines' timber support sets: the dress pass pushes each set's two posts together (minesDress placeTimberSets; minesVisuals.ts
  // planMinesVisuals reads them the same way) — the posts are props (above), the cap spans the drift under its roof
  const posts = layout.props.filter(p => p.kind === 'annexMachine' && p.variant === MINE_PIECE.post && (p.level ?? 0) === level && near(p.x, p.z, 2));
  for (let k = 0; k + 1 < posts.length; k += 2) {
    const p = posts[k], q = posts[k + 1], a = layout.areas[p.area];
    if (q.area !== p.area || !a) continue;
    const alongX = Math.abs(p.x - q.x) < 1e-3 && Math.abs(p.z - q.z) > 1e-3, s = alongX ? p.x : p.z;
    const Wd = (alongX ? a.h : a.w) * CELL, mid = (alongX ? a.y : a.x) * CELL + Wd / 2, fit = timberSetFit(Wd, a.ceil - base), M = MINE_SETS.model;
    const across = M.capOuter * fit.sx, along = M.depth / 2;
    box(alongX ? s : mid, alongX ? mid : s, alongX ? along : across, alongX ? across : along, base + M.capUnder * fit.sy, base + M.top * fit.sy, true);
  }
  return out;
}

/** QA / tests: the last routes (complex level, the result or why there is none, crossings found, open cells, ms). */
export const CEILING_CABLE_STATS = {runs: [] as {level: number; result: string; crossings: number; open: number; ms: number}[]};
const stat = (level: number, result: string, crossings = 0, open = 0, t0 = 0) => {
  CEILING_CABLE_STATS.runs.push({level, result, crossings, open, ms: Math.round((now() - t0) * 10) / 10});
  if (CEILING_CABLE_STATS.runs.length > 24) CEILING_CABLE_STATS.runs.shift();
};
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export type Crossing = {door: Door; e: number; x: number; dir: number; kind: 'lintel' | 'beside'; y: number; cost: number};
const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];

/** A small binary min-heap of [cost, state]. */
class Heap {
  private readonly k: number[] = [];
  private readonly v: number[] = [];
  get size(): number { return this.k.length; }
  push(cost: number, state: number): void {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(cost); v.push(state);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop(): [number, number] {
    const k = this.k, v = this.v, top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}

/** The ceiling field of a complex (QA / tests): per cell the highest open cable centre, what lowered it, the wall crossings. */
export interface CableField {
  g: Grid; base: number; ids: ReadonlySet<number>; front: number; doors: Door[]; entrance: Door;
  /** Per cell: the highest cable centre with nothing above it in the ceiling band (-Infinity: not a route cell). */
  top: Float32Array;
  /** Per cell: the obstacle (index into `obst`) that lowered `top`, else -1; whether it is a cap the cable may hang under. */
  lowBy: Int32Array; capped: Uint8Array;
  obst: Obst[]; crossings: Crossing[];
  /** Route cells' bounds (cells). */
  bx0: number; by0: number; bx1: number; by1: number;
  room(i: number, deck?: boolean): boolean;
  open(i: number): boolean;
}

/** The ceiling field (see CableField) or why there is none. */
export function cableField(layout: StationLayout, c: CableComplex): CableField | string {
  const g = layout.levels[c.level]?.grid, base = c.baseY, C = CEILING_CABLE, lv = c.level;
  if (!g) return 'no grid';
  const ids = new Set(c.areas), front = c.frontArea;
  // the doors of the complex (both sides complex areas) and its entrance door (the deck in front of it on one side)
  const doors = layout.doors.filter(d => (d.level ?? 0) === lv && ((ids.has(d.a) && ids.has(d.b)) || (d.a === front && ids.has(d.b)) || (d.b === front && ids.has(d.a))));
  const entrance = doors.find(d => d.a === front || d.b === front);
  if (!entrance) return 'no entrance door';
  const doorCell = new Uint8Array(g.w * g.h);
  for (const d of doors) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) if (g.inBounds(x, y)) doorCell[g.idx(x, y)] = 1;
  const room = (i: number, deck = false): boolean => g.cells[i] === FLOOR && !doorCell[i] && (ids.has(g.area[i]) || (deck && g.area[i] === front))
    && g.floor[i] <= base + 0.01 && g.floor[i] >= base - 0.5;
  // the obstacle field: per cell, the highest cable centre with nothing above it in the ceiling band (and whether a cap / fixture sets it)
  const top = new Float32Array(g.w * g.h).fill(-Infinity), lowBy = new Int32Array(g.w * g.h).fill(-1), capped = new Uint8Array(g.w * g.h);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = g.idx(x, y);
    if (!room(i, true)) continue;
    if (g.area[i] === front && (Math.abs(x + 0.5 - (entrance.x + entrance.w / 2)) > entrance.w / 2 + C.besideReach + 2 || Math.abs(y + 0.5 - (entrance.y + entrance.h / 2)) > entrance.h / 2 + C.besideReach + 2)) continue;
    top[i] = g.ceil[i] - C.drop;
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
  }
  if (bx0 > bx1) return 'no cells';
  const obst = cableObstacles(layout, lv, base, [bx0 * CELL - 1, by0 * CELL - 1, (bx1 + 1) * CELL + 1, (by1 + 1) * CELL + 1], g);
  // every obstacle over a cell forbids the cable centre from just under its underside to just over its top: the cable hangs as high as
  // it can under the ceiling, over what stays below it (a door frame's header, a wall plate, a cabinet), under what reaches the ceiling
  // band (a fixture, a duct, a timber cap)
  const band = base + C.minY - 0.15, forbid = new Map<number, number[]>();
  obst.forEach((o, k) => {
    if (o.y1 <= band) return; // wholly below the cable band (furniture, low machines)
    const [cx0, cy0] = g.cellOf(o.x0 - C.grow, o.z0 - C.grow), [cx1, cy1] = g.cellOf(o.x1 + C.grow, o.z1 + C.grow);
    for (let y = Math.max(by0, cy0); y <= Math.min(by1, cy1); y++) for (let x = Math.max(bx0, cx0); x <= Math.min(bx1, cx1); x++) {
      const i = g.idx(x, y);
      if (top[i] === -Infinity) continue;
      const px = (x + 0.5) * CELL, pz = (y + 0.5) * CELL;
      if (px < o.x0 - C.grow || px > o.x1 + C.grow || pz < o.z0 - C.grow || pz > o.z1 + C.grow) continue;
      let l = forbid.get(i);
      if (!l) forbid.set(i, (l = []));
      l.push(k);
    }
  });
  for (const [i, ks] of forbid) {
    let y = top[i], moved = true;
    while (moved) {
      moved = false;
      for (const k of ks) {
        const o = obst[k];
        // (strictly above the forbidden range's floor: y only falls, so this ends)
        if (y > o.y0 - C.under + 1e-6 && y < o.y1 - C.body[0] + C.over) { y = o.y0 - C.under; lowBy[i] = k; capped[i] = o.cap ? 1 : 0; moved = true; }
      }
    }
    top[i] = y;
  }
  const minY = base + C.minY;
  const open = (i: number) => top[i] >= minY;
  // wall crossings at every door: over its lintel (through the wall above the opening) or beside its jambs (through solid wall)
  const crossings: Crossing[] = [];
  for (const d of doors) {
    const head = base + d.height;
    for (const axis of [0, 1]) { // 0: through the wall along x (a wall running along z), 1: along y
      const T = axis === 0 ? d.w : d.h, s0 = axis === 0 ? d.y : d.x, s1 = s0 + (axis === 0 ? d.h : d.w);
      for (let sp = s0 - C.besideReach; sp < s1 + C.besideReach; sp++) {
        const [ex, ey] = axis === 0 ? [d.x - 1, sp] : [sp, d.y - 1], [xx, xy] = axis === 0 ? [d.x + d.w, sp] : [sp, d.y + d.h];
        if (!g.inBounds(ex, ey) || !g.inBounds(xx, xy)) continue;
        const ei = g.idx(ex, ey), xi = g.idx(xx, xy);
        if (!open(ei) || !open(xi)) continue;
        const ea = g.area[ei], xa = g.area[xi];
        if (ea === xa || !((ea === d.a && xa === d.b) || (ea === d.b && xa === d.a))) continue;
        const inSpan = sp >= s0 && sp < s1;
        let wallOk = true;
        for (let k = 0; k < T && wallOk; k++) {
          const wi = axis === 0 ? g.idx(d.x + k, sp) : g.idx(sp, d.y + k);
          wallOk = inSpan ? !!doorCell[wi] : g.cells[wi] !== FLOOR;
        }
        if (!wallOk) continue;
        const y = Math.min(top[ei], top[xi]);
        if (inSpan && y < head + C.lintel) continue; // no room over this lintel: a beside crossing instead
        const off = inSpan ? 0 : sp < s0 ? s0 - sp : sp - s1 + 1;
        const cost = T + 1 + (inSpan ? 0 : C.cost.beside + off);
        crossings.push({door: d, e: ei, x: xi, dir: axis === 0 ? 0 : 2, kind: inSpan ? 'lintel' : 'beside', y, cost});
        crossings.push({door: d, e: xi, x: ei, dir: axis === 0 ? 1 : 3, kind: inSpan ? 'lintel' : 'beside', y, cost});
      }
    }
  }
  return {g, base, ids, front, doors, entrance, top, lowBy, capped, obst, crossings, bx0, by0, bx1, by1, room, open};
}

/**
 * The ceiling route of a complex generator's cable: from its panel's riser to the deck side of the complex entrance (see the header).
 * `pts[0]` is the riser top over the panel; host.ts prepends the panel and appends cableOf from `exit`. Null: no route.
 */
export function ceilingCableRoute(layout: StationLayout, c: CableComplex, gen: ReactorGenerator): CeilingCableRoute | null {
  const t0 = now(), lv = c.level, C = CEILING_CABLE, F = cableField(layout, c);
  if (typeof F === 'string') { stat(lv, F, 0, 0, t0); return null; }
  const {g, ids, front, entrance, top, lowBy, capped, obst, crossings, bx0, by0, bx1, by1, room, open} = F;
  const minY = c.baseY + C.minY;
  const byEntry = new Map<number, Crossing[]>();
  for (const x of crossings) { let l = byEntry.get(x.e); if (!l) byEntry.set(x.e, (l = [])); l.push(x); }
  // Dijkstra over (cell, heading): axis-aligned runs, turns cost; the goal is a deck cell reached through the entrance wall
  const [ux, uy] = g.cellOf(gen.use.x, gen.use.z);
  let start = g.inBounds(ux, uy) ? g.idx(ux, uy) : -1;
  if (start < 0 || !open(start) || !ids.has(g.area[start])) {
    let best = -1, bd = Infinity;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const i = g.idx(x, y); if (open(i) && ids.has(g.area[i])) { const dd = (x - ux) ** 2 + (y - uy) ** 2; if (dd < bd) { bd = dd; best = i; } } }
    start = best;
  }
  if (start < 0) { stat(lv, 'no start', crossings.length, 0, t0); return null; }
  const N = g.w * g.h, dist = new Float64Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1), via = new Map<number, Crossing>();
  const interior = (i: number) => { const x = i % g.w, y = (i / g.w) | 0; for (let k = 0; k < 4; k++) { const j = g.idx(x + DX[k], y + DY[k]); if (!g.inBounds(x + DX[k], y + DY[k]) || !room(j, true)) return false; } return true; };
  const cellCost = (i: number) => C.cost.cell + (interior(i) ? C.cost.interior : 0) + (lowBy[i] >= 0 ? C.cost.low : 0);
  const heap = new Heap();
  for (let k = 0; k < 4; k++) { dist[start * 4 + k] = 0; heap.push(0, start * 4 + k); }
  let goal = -1;
  while (heap.size) {
    const [d0, st] = heap.pop();
    if (d0 > dist[st]) continue;
    const i = st >> 2, dir = st & 3;
    if (g.area[i] === front) { goal = st; break; }
    const x = i % g.w, y = (i / g.w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!g.inBounds(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (!open(j) || g.area[j] === front || !room(j)) continue; // the deck is reached only through the entrance wall
      const nd = d0 + cellCost(j) + (k === dir ? 0 : C.cost.turn), ns = j * 4 + k;
      if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = st; via.delete(ns); heap.push(nd, ns); }
    }
    for (const cr of byEntry.get(i) ?? []) {
      if (g.area[cr.x] === front && cr.door !== entrance) continue;
      const nd = d0 + cr.cost + (cr.dir === dir ? 0 : C.cost.turn), ns = cr.x * 4 + cr.dir;
      if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = st; via.set(ns, cr); heap.push(nd, ns); }
    }
  }
  if (goal < 0) {
    let o = 0;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (open(g.idx(x, y))) o++;
    const d = entrance, ends: string[] = [];
    for (let y = d.y - 1; y <= d.y + d.h && ends.length < 24; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) {
      if (!g.inBounds(x, y) || (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h)) continue;
      const i = g.idx(x, y), o = lowBy[i] >= 0 ? obst[lowBy[i]] : null;
      if (g.cells[i] === FLOOR) ends.push(`${x},${y}:a${g.area[i]}:${Number.isFinite(top[i]) ? (top[i] - c.baseY).toFixed(2) : '-'}${o ? `<${(o.y0 - c.baseY).toFixed(2)}..${(o.y1 - c.baseY).toFixed(2)}>` : ''}`);
    }
    stat(lv, `no way out (entrance ${d.id} h ${d.height} crossings ${crossings.filter(x => x.door === entrance).length}; ${ends.join(' ')})`, crossings.length, o, t0);
    return null;
  }
  // the path (cells, with the crossing that reached a cell)
  const path: {i: number; cr?: Crossing}[] = [];
  for (let st = goal; st >= 0; st = prev[st]) path.push({i: st >> 2, ...(via.has(st) ? {cr: via.get(st)} : {})});
  path.reverse();
  // runs: straight cell sequences between turns / crossings, each at the lowest open height of its cells
  type Run = {cells: number[]; y: number};
  const runs: Run[] = [];
  let cur: number[] = [path[0].i];
  const flush = () => { if (cur.length) runs.push({cells: cur, y: Math.min(...cur.map(i => top[i]))}); };
  const crossAfter: (Crossing | null)[] = [];
  for (let k = 1; k < path.length; k++) {
    const p = path[k];
    if (p.cr) { flush(); crossAfter.push(p.cr); cur = [p.i]; continue; }
    const a = path[k - 1].i, b = cur.length >= 2 ? cur[cur.length - 2] : -1;
    const straight = b < 0 || (a - b === p.i - a);
    if (!straight) { flush(); crossAfter.push(null); cur = [a, p.i]; continue; }
    cur.push(p.i);
  }
  flush();
  // the last run is the deck cell beyond the entrance wall: the cable leaves there at the crossing's height (cableOf takes over)
  if (runs.length > 1 && runs[runs.length - 1].cells.every(i => g.area[i] === front)) runs.pop();
  const ctr = (i: number): [number, number] => [((i % g.w) + 0.5) * CELL, (((i / g.w) | 0) + 0.5) * CELL];
  const pts: CablePoint[] = [];
  const put = (x: number, y: number, z: number) => {
    const q = {x: r3(x), y: r3(y), z: r3(z)}, l = pts[pts.length - 1];
    if (!l || Math.abs(l.x - q.x) + Math.abs(l.y - q.y) + Math.abs(l.z - q.z) > 1e-3) pts.push(q);
  };
  // the riser over the panel: up to the first run's height (or under whatever hangs right over the panel), then over to the first cell
  {
    let yr = runs[0].y;
    for (const o of obst) if (o.y0 > gen.panel.y + 0.4 && gen.panel.x > o.x0 - C.grow && gen.panel.x < o.x1 + C.grow && gen.panel.z > o.z0 - C.grow && gen.panel.z < o.z1 + C.grow) yr = Math.min(yr, o.y0 - C.under);
    yr = Math.max(yr, minY);
    put(gen.panel.x, yr, gen.panel.z);
    const [fx, fz] = ctr(runs[0].cells[0]);
    put(fx, yr, fz);
  }
  const crossed: CeilingCableRoute['crossings'] = [];
  runs.forEach((r, k) => {
    const [ax, az] = ctr(r.cells[0]), [bx, bz] = ctr(r.cells[r.cells.length - 1]);
    put(ax, r.y, az);
    put(bx, r.y, bz);
    const cr = crossAfter[k];
    if (cr) {
      // up (or down) at the wall to the crossing height, through the wall, then to the next run's height on the far side
      const [ex, ez] = ctr(cr.e), [xx, xz] = ctr(cr.x);
      put(ex, cr.y, ez);
      put(xx, cr.y, xz);
      crossed.push({door: cr.door.id, kind: cr.kind, y: r3(cr.y)});
    }
  });
  const last = pts[pts.length - 1];
  // drop rods along the runs (to the ceiling, or to the cap a mines run hangs under; never from a fixture / sign)
  const hangers: CableHanger[] = [];
  for (const r of runs) {
    if (r.cells.length < 2) continue;
    const [ax, az] = ctr(r.cells[0]), [bx, bz] = ctr(r.cells[r.cells.length - 1]), L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / C.hangerPitch));
    for (let k = 0; k <= n; k++) {
      const t = (k + 0.5) / (n + 1), x = ax + (bx - ax) * t, z = az + (bz - az) * t, [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
      if (top[i] === -Infinity || (lowBy[i] >= 0 && !capped[i])) continue;
      const y0 = r.y + C.body[1], y1 = lowBy[i] >= 0 ? top[i] + C.under : g.ceil[i];
      if (y1 - y0 > 0.02 && y1 - y0 < C.hangerMax) hangers.push({x: r3(x), z: r3(z), y0: r3(y0), y1: r3(y1)});
    }
  }
  stat(lv, 'ok', crossings.length, 0, t0);
  return {pts, exit: {...last}, hangers, crossings: crossed};
}

/**
 * Issues of a generated complex cable (tests / QA): every interior point of `gen.cable` up to the entrance exit stands at least
 * CEILING_CABLE.minY over the storey (bar the riser over the panel), under the ceilings of the cells it hangs in, and no cable
 * segment enters a door opening's volume (the door rect from the floor up to its head) of the complex or its entrance.
 */
export function ceilingCableIssues(layout: StationLayout, c: CableComplex, gen: ReactorGenerator, upTo: number): string[] {
  const g = layout.levels[c.level].grid, base = c.baseY, out: string[] = [];
  const ids = new Set(c.areas);
  const doors = layout.doors.filter(d => (d.level ?? 0) === c.level && (ids.has(d.a) || ids.has(d.b)));
  const pts = gen.cable.slice(0, upTo + 1);
  const [lo, hi] = CEILING_CABLE.body, hw = 0.16;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1], L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.1));
    for (let t = 0; t <= n; t++) {
      const x = a.x + (b.x - a.x) * t / n, y = a.y + (b.y - a.y) * t / n, z = a.z + (b.z - a.z) * t / n;
      if (k >= 2 && y < base + CEILING_CABLE.minY - 1e-3) out.push(`segment ${k}: ${y.toFixed(2)} under the headroom at ${x.toFixed(1)},${z.toFixed(1)}`);
      for (const d of doors) {
        const x0 = d.x * CELL, z0 = d.y * CELL, x1 = (d.x + d.w) * CELL, z1 = (d.y + d.h) * CELL, head = base + d.height;
        if (x + hw > x0 + 0.02 && x - hw < x1 - 0.02 && z + hw > z0 + 0.02 && z - hw < z1 - 0.02 && y + lo < head) { out.push(`segment ${k}: in door ${d.id}'s opening (head ${head.toFixed(2)}) at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`); break; }
      }
      const [cx, cy] = g.cellOf(x, z);
      if (g.inBounds(cx, cy)) {
        const i = g.idx(cx, cy);
        if (g.cells[i] === FLOOR && !doors.some(d => cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h) && y + hi > g.ceil[i] + 1e-3) out.push(`segment ${k}: above the ceiling at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  }
  return [...new Set(out)];
}
