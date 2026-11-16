// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the interior BUILDER every programme plans with — one building's
// local frame, its rooms / doors / stair cores carved into the district Kit, a placement context per storey (the station placement kit,
// gen/placeKit.ts: door zones, access strips, room connectivity) over a STUB layout that shares the Kit's grids / areas / doors / flights,
// and the plan lists it returns (gen/surface/rooms/api.ts InteriorPlan). Pure data, deterministic from the plot's own Rng (never the Kit's).
//
// Local frame (cells): u along the MAIN entrance's facade (0 at the inner rect's x0 / y0 end), v depth from that facade inward; W x D =
// the inner rect (inside the facade ring). Local sides: 'F' = the main facade (v = 0 side), 'B' = the back (v = D - 1), 'L' = u = 0,
// 'R' = u = W - 1. A room is an LRect {u, v, du, dv}; walls are the 1-cell gaps the plan leaves between rooms.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, type Grid} from '../../grid';
import type {Kit} from '../../stationKit';
import {makePlaceCtx, type PlaceCtx} from '../../placeKit';
import {STAIR, layStairRun, stairRunCells, type StairFlight} from '../../traversal';
import type {LevelLink} from '../../levels';
import type {Area, AreaKind, Door, LightProfile, Rect, RoomType, Side, StationLayout} from '../../stationTypes';
import type {SurfaceBuilding, SurfaceRecoverable, SurfaceWindowSpan} from '../surfaceTypes';
import type {InteriorFloor, InteriorPlot, PlannedEntrance} from './api';
import {resolveProgramme, type SurfaceProgrammeId} from './programmes';

export type LSide = 'F' | 'B' | 'L' | 'R';
export interface LRect { u: number; v: number; du: number; dv: number }

/** How a room's facade glazing looks (window spans: sill / head, pane width); 'none' = a blind wall. */
export type WindowStyle = 'shop' | 'office' | 'high' | 'small' | 'none';

/** What the builder knows about each room it carved (dressing, lights, windows, enemies). */
export interface RoomInfo {
  area: Area;
  storey: number;
  /** Programme role key ('sales', 'stock', 'office', 'washroom', 'corridor', 'stair', 'shed' ...). */
  role: string;
  /** Front of house (customers / public) vs back of house. */
  front: boolean;
  windows: WindowStyle;
  /** Interior enemies this room may hold (weight; 0 = none). */
  enemies: number;
  /** No loose floor finds here (its loot is in its holders, or it is a stair / corridor). */
  noLoose?: boolean;
}

/** An entrance as the planner sees it: local side, span along that wall (local coord), its inner cells (level 0). */
export interface EntranceInfo {
  e: PlannedEntrance;
  local: LSide;
  /** Span along its wall (u for F / B, v for L / R), inclusive. */
  s0: number; s1: number;
  /** The cells just inside the facade (level 0 grid indices + cell coords). */
  inner: {x: number; y: number; i: number}[];
}

const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Lane / landing / divider sizes (cells) of a stair core (the Mall's service core: gen/mall/frame.ts CORE). */
export const CORE = {lane: 4, divider: 1, landing: 4} as const;

export class InteriorBuilder {
  readonly kit: Kit;
  readonly rng: Rng;
  readonly b: SurfaceBuilding;
  readonly plot: InteriorPlot;
  /** The programme the planner builds (rooms/programmes.ts resolveProgramme: GEN's id, an alias, or the kind's fallback). */
  readonly pid: SurfaceProgrammeId | null;
  /** World side of the main facade. */
  readonly front: Side;
  /** Inner rect (cells, inside the facade ring). */
  readonly I: Rect;
  readonly W: number;
  readonly D: number;
  /** Storeys bottom-up (plot.floors sorted by y). */
  readonly storeys: InteriorFloor[];
  readonly ents: EntranceInfo[];
  readonly rooms: RoomInfo[] = [];
  readonly links: LevelLink[] = [];
  readonly windows: SurfaceWindowSpan[] = [];
  recoverables?: SurfaceRecoverable[];
  /** Extra plan data for other lanes (the depot's tracks / pits / crane: InteriorPlan.features). */
  features?: Record<string, unknown>;
  /** The stub layout the placement kit and the shared dressers read / write (its props / lights … are the plan's). */
  readonly stub: StationLayout;
  /** Highest storey index actually carved (upper storeys need a stair core: see carveCore). */
  carvedStoreys = 1;
  private ctxs = new Map<number, PlaceCtx>();

  constructor(plot: InteriorPlot) {
    this.plot = plot;
    this.kit = plot.kit;
    this.rng = plot.rng;
    this.b = plot.building;
    this.pid = resolveProgramme(this.b.programme, this.b.kind);
    const r = plot.rect;
    this.I = {x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2};
    const main = plot.entrances.find(e => e.main) ?? plot.entrances[0];
    this.front = main?.side ?? 'S';
    const alongX = this.front === 'N' || this.front === 'S';
    this.W = alongX ? this.I.w : this.I.h;
    this.D = alongX ? this.I.h : this.I.w;
    this.storeys = plot.floors.slice().sort((a, b) => a.y - b.y);
    this.ents = plot.entrances.filter(e => e.cells.length).map(e => this.entranceInfo(e));
    const levels = this.kit.levelGrids.map((grid, id) => ({id, role: 'office' as const, grid, baseY: this.storeys.find(f => f.level === id)?.y ?? 0}));
    this.stub = {
      seed: 0, attempt: 0, name: this.b.name, archetype: 'side-mezzanine', towards: ['', ''], grid: this.kit.g, areas: this.kit.areas, doors: this.kit.doors,
      props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [], playerSpawn: {x: 0, z: 0, yaw: 0},
      trench: {x0: 0, x1: 0, z0: 0, z1: 0, floorY: 0, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0}, trenches: [],
      platform: -1, platforms: [], traversal: {stairs: this.kit.flights, ladders: [], underpasses: []}, levels, levelLinks: this.links, rails: [],
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Frame

  /** Local side -> world side. */
  side(s: LSide): Side {
    if (s === 'F') return this.front;
    if (s === 'B') return OPP[this.front];
    const ns = this.front === 'N' || this.front === 'S';
    if (s === 'L') return ns ? 'W' : 'N';
    return ns ? 'E' : 'S';
  }
  /** World side -> local side. */
  localSide(s: Side): LSide {
    for (const l of ['F', 'B', 'L', 'R'] as const) if (this.side(l) === s) return l;
    return 'F';
  }
  /** Local rect -> world cell rect. */
  rect(L: LRect): Rect {
    const I = this.I;
    switch (this.front) {
      case 'N': return {x: I.x + L.u, y: I.y + L.v, w: L.du, h: L.dv};
      case 'S': return {x: I.x + L.u, y: I.y + I.h - L.v - L.dv, w: L.du, h: L.dv};
      case 'W': return {x: I.x + L.v, y: I.y + L.u, w: L.dv, h: L.du};
      default: return {x: I.x + I.w - L.v - L.dv, y: I.y + L.u, w: L.dv, h: L.du};
    }
  }
  /** World cell -> local (u, v). */
  local(x: number, y: number): {u: number; v: number} {
    const I = this.I;
    switch (this.front) {
      case 'N': return {u: x - I.x, v: y - I.y};
      case 'S': return {u: x - I.x, v: I.y + I.h - 1 - y};
      case 'W': return {u: y - I.y, v: x - I.x};
      default: return {u: y - I.y, v: I.x + I.w - 1 - x};
    }
  }
  /** World cell of local (u, v). */
  cell(u: number, v: number): {x: number; y: number} {
    const r = this.rect({u, v, du: 1, dv: 1});
    return {x: r.x, y: r.y};
  }
  /** World metres of the local point (u, v) in cells (fractional: u + 0.5 = a cell centre). */
  world(u: number, v: number): {x: number; z: number} {
    const I = this.I;
    switch (this.front) {
      case 'N': return {x: (I.x + u) * CELL, z: (I.y + v) * CELL};
      case 'S': return {x: (I.x + u) * CELL, z: (I.y + I.h - v) * CELL};
      case 'W': return {x: (I.x + v) * CELL, z: (I.y + u) * CELL};
      default: return {x: (I.x + I.w - v) * CELL, z: (I.y + u) * CELL};
    }
  }

  private entranceInfo(e: PlannedEntrance): EntranceInfo {
    const local = this.localSide(e.side);
    const inward: Record<Side, [number, number]> = {N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]};
    const [dx, dy] = inward[e.side];
    const g0 = this.kit.grid(0);
    const inner = e.cells.map(c => ({x: c.x + dx, y: c.y + dy, i: g0.idx(c.x + dx, c.y + dy)}));
    const along = inner.map(c => { const l = this.local(c.x, c.y); return local === 'F' || local === 'B' ? l.u : l.v; });
    return {e, local, s0: Math.min(...along), s1: Math.max(...along), inner};
  }
  /** Entrances on a local wall. */
  entsOn(s: LSide): EntranceInfo[] {
    return this.ents.filter(e => e.local === s);
  }

  /**
   * A wall line clear of the entrances it would meet: a wall at u = c (running along v from v0 to v1) meets the F / B entrances whose
   * span holds c when it touches that facade; a wall at v = c (along u from u0 to u1) the L / R ones. Returns the nearest clear c in
   * [lo, hi] (±1-cell jamb kept), or the input when none is clear.
   */
  clearLine(axis: 'u' | 'v', c: number, lo: number, hi: number, span: [number, number]): number {
    const hits = (q: number) => this.ents.some(en => {
      if (axis === 'u') {
        if (en.local === 'F' && span[0] > 0) return false;
        if (en.local === 'B' && span[1] < this.D - 1) return false;
        if (en.local !== 'F' && en.local !== 'B') return false;
      } else {
        if (en.local === 'L' && span[0] > 0) return false;
        if (en.local === 'R' && span[1] < this.W - 1) return false;
        if (en.local !== 'L' && en.local !== 'R') return false;
      }
      return q >= en.s0 - 1 && q <= en.s1 + 1;
    });
    if (!hits(c)) return c;
    for (let d = 1; d <= Math.max(c - lo, hi - c); d++) for (const q of [c + d, c - d]) if (q >= lo && q <= hi && !hits(q)) return q;
    return c;
  }

  /**
   * Splits [a0, a1) along `axis` into rooms of the given relative weights (minimum `min` cells each) with a 1-cell wall between
   * consecutive rooms, each wall clear of the entrances (clearLine; `cross` = the rooms' extent on the other axis). Returns the [s, e)
   * spans (fewer when the run is too short for all of them).
   */
  split(axis: 'u' | 'v', a0: number, a1: number, weights: readonly number[], min: number, cross: [number, number]): [number, number][] {
    let n = weights.length;
    while (n > 1 && a1 - a0 - (n - 1) < n * min) n--;
    const ws = weights.slice(0, n), total = ws.reduce((s, w) => s + w, 0);
    const free = a1 - a0 - (n - 1);
    const out: [number, number][] = [];
    let s = a0, acc = 0;
    for (let k = 0; k < n; k++) {
      acc += ws[k];
      let e = k === n - 1 ? a1 : a0 + Math.round(free * acc / total) + k;
      if (k < n - 1) {
        const lo = s + min, hi = a1 - (n - 1 - k) * (min + 1);
        e = Math.max(lo, Math.min(hi, e));
        e = this.clearLine(axis, e, lo, hi, cross); // the wall cell is at e
      }
      out.push([s, e]);
      s = e + 1;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Rooms and doors

  /** Carves a room on storey `k` (local rect) and records it. */
  room(k: number, L: LRect, o: {kind?: AreaKind; type: RoomType; label: string; role: string; front?: boolean; purpose?: string; lighting?: LightProfile;
    windows?: WindowStyle; enemies?: number; noLoose?: boolean; publicSpace?: boolean}): RoomInfo | null {
    if (L.du < 2 || L.dv < 2 || L.u < 0 || L.v < 0 || L.u + L.du > this.W || L.v + L.dv > this.D) return null;
    const f = this.storeys[k];
    const r = this.rect(L);
    const a = this.kit.addArea(r, o.kind ?? 'room', o.type, f.ceil, -1, {label: `${this.b.name} · ${o.label}`, level: f.level, floorY: f.y,
      publicSpace: o.publicSpace ?? !!o.front});
    // the street storey stands on the plot's floor (GEN: the kerb height), which Kit.addArea writes only off the main level
    if (f.level === 0) this.stampFloor(0, r, f.y, f.ceil);
    if (o.purpose) a.purpose = o.purpose;
    a.lighting = o.lighting ?? (o.front ? 'dim' : 'dark');
    if (o.noLoose) a.noFloorLoot = true;
    const info: RoomInfo = {area: a, storey: k, role: o.role, front: !!o.front, windows: o.windows ?? (o.front ? 'office' : 'none'), enemies: o.enemies ?? 1, noLoose: o.noLoose};
    this.rooms.push(info);
    return info;
  }
  roomsOn(k: number): RoomInfo[] {
    return this.rooms.filter(r => r.storey === k);
  }
  info(a: Area | number): RoomInfo | undefined {
    const id = typeof a === 'number' ? a : a.id;
    return this.rooms.find(r => r.area.id === id);
  }

  /** The shared wall (cells) between two rooms of one storey, or null. */
  shared(a: Area, b: Area): {horizontal: boolean; line: number; s0: number; s1: number} | null {
    return this.kit.sharedWall(a, b);
  }

  /**
   * A doorway (width cells) through the shared wall of two rooms of one storey: `at` = 'mid' / a 0..1 position along the overlap /
   * 'lo' / 'hi'; `margin` cells kept from the overlap's ends. Never draws from any rng but the plot's (and only when `at` = 'rand').
   */
  door(a: RoomInfo | null, b: RoomInfo | null, width: number, o: {at?: 'mid' | 'lo' | 'hi' | 'rand' | number; margin?: number; height?: number; staff?: boolean} = {}): Door | null {
    if (!a || !b || a.storey !== b.storey) return null;
    const w = this.shared(a.area, b.area);
    if (!w) return null;
    const margin = o.margin ?? 1;
    const span = w.s1 - w.s0 - 2 * margin;
    const width2 = Math.min(width, span);
    if (width2 < 2) return null;
    const lo = w.s0 + margin, hi = w.s1 - margin - width2;
    const at = o.at ?? 'mid';
    const s = at === 'lo' ? lo : at === 'hi' ? hi : at === 'mid' ? Math.floor((lo + hi) / 2)
      : at === 'rand' ? this.rng.int(lo, hi) : Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * at)));
    const gap: Rect = w.horizontal ? {x: s, y: w.line, w: width2, h: 1} : {x: w.line, y: s, w: 1, h: width2};
    return this.carve(gap, a, b, o.height ?? 2.3, o.staff ? {staff: true} : {});
  }
  /** Kit.carveDoor plus the street storey's floor / head height (Kit.carveDoor keeps main-level doorways at y = 0). */
  private carve(gap: Rect, a: RoomInfo, b: RoomInfo, height: number, extra: Partial<Door> = {}): Door {
    const d = this.kit.carveDoor(gap, a.area, b.area, height, false, extra);
    const f = this.storeys[a.storey];
    if (f.level === 0) {
      d.height = Math.round(Math.min(height, a.area.ceil - f.y, b.area.ceil - f.y) * 1000) / 1000;
      this.stampFloor(0, gap, f.y, f.y + d.height);
    }
    return d;
  }
  /** Writes floor / ceiling heights of a level-grid rect (the street storey's floor is not y = 0 in the district). */
  private stampFloor(level: number, r: Rect, y: number, ceil: number): void {
    const g = this.kit.grid(level);
    for (let cy = r.y; cy < r.y + r.h; cy++) for (let cx = r.x; cx < r.x + r.w; cx++) {
      const i = g.idx(cx, cy);
      g.floor[i] = y;
      g.ceil[i] = ceil;
    }
  }
  /** Whether a doorway joins two rooms. */
  joined(a: RoomInfo, b: RoomInfo): boolean {
    return this.kit.doors.some(d => (d.a === a.area.id && d.b === b.area.id) || (d.a === b.area.id && d.b === a.area.id));
  }
  /**
   * Makes every room of storey k reachable from `root` through doorways: rooms not reached yet get a door through a wall they share with
   * a reached one (landings through their full width), breadth-first, until nothing changes. Returns the rooms still unreachable (none
   * in a well-formed plan: the tests assert it).
   */
  connectAll(k: number, root: RoomInfo | null): RoomInfo[] {
    const rooms = this.roomsOn(k).filter(r => r.role !== 'stair-run');
    if (!root) return rooms;
    const reached = new Set<RoomInfo>([root]);
    const byId = new Map(rooms.map(r => [r.area.id, r]));
    // doorway adjacency among this storey's rooms (the district's door list scanned once per flood, from where it last ended)
    const adj = new Map<RoomInfo, RoomInfo[]>();
    let scanned = 0;
    const flood = () => {
      const doors = this.kit.doors;
      for (; scanned < doors.length; scanned++) {
        const d = doors[scanned], a = byId.get(d.a), b = byId.get(d.b);
        if (!a || !b) continue;
        adj.set(a, [...(adj.get(a) ?? []), b]);
        adj.set(b, [...(adj.get(b) ?? []), a]);
      }
      const stack = [...reached];
      while (stack.length) for (const q of adj.get(stack.pop()!) ?? []) if (!reached.has(q)) { reached.add(q); stack.push(q); }
    };
    flood();
    for (let pass = 0; pass < rooms.length; pass++) {
      const left = rooms.filter(r => !reached.has(r));
      if (!left.length) break;
      let made = false;
      for (const r of left) {
        for (const q of [...reached].sort((p1, p2) => (p2.front ? 1 : 0) - (p1.front ? 1 : 0))) {
          if (!this.shared(q.area, r.area)) continue;
          const d = r.role === 'stair' ? this.landingDoor(r, q) : q.role === 'stair' ? this.landingDoor(q, r)
            : this.door(q, r, 3, {at: 'mid', staff: !r.front}) ?? this.door(q, r, 2, {at: 'mid', margin: 0, staff: !r.front});
          if (d) { made = true; break; }
        }
        if (made) break;
      }
      flood();
      if (!made) break;
    }
    return rooms.filter(r => !reached.has(r));
  }
  /** Door to the first of `bs` that shares a wall with `a` (helper for fallbacks). */
  doorAny(a: RoomInfo | null, bs: readonly (RoomInfo | null)[], width: number, o: Parameters<InteriorBuilder['door']>[3] = {}): Door | null {
    for (const b of bs) { const d = this.door(a, b, width, o); if (d) return d; }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Stair core (the Mall's service-core scheme: landings at alternating ends, one straight run per storey pair in alternating lanes)

  /** Core length (cells along its axis) for the building's storeys. */
  coreLength(n = this.storeys.length): number {
    let run = 0;
    for (let k = 0; k + 1 < Math.min(n, this.storeys.length); k++) run = Math.max(run, stairRunCells(this.storeys[k + 1].y - this.storeys[k].y, STAIR));
    return 2 * CORE.landing + run;
  }
  /** Core width (cells across): one lane for two storeys, two lanes + a divider for more. */
  coreWidth(n = this.storeys.length): number {
    return n > 2 ? 2 * CORE.lane + CORE.divider : CORE.lane;
  }

  /**
   * Carves the stair core in local rect `L` (its long axis = `along`; the street storey's landing at the `start` end, 'lo' = the low
   * local coordinate) for storeys 0..n-1, landings labelled per storey; returns each storey's landing room (the caller connects it).
   * Registers the flights in kit.flights and one LevelLink per storey pair.
   */
  carveCore(L: LRect, along: 'u' | 'v', start: 'lo' | 'hi', n = this.storeys.length): RoomInfo[] {
    const landings: RoomInfo[] = [];
    const len = along === 'u' ? L.du : L.dv, wid = along === 'u' ? L.dv : L.du;
    const end = (k: number): 'lo' | 'hi' => ((k % 2 === 0) === (start === 'lo') ? 'lo' : 'hi');
    const sub = (a0: number, da: number, c0: number, dc: number): LRect => along === 'u' ? {u: L.u + a0, v: L.v + c0, du: da, dv: dc} : {u: L.u + c0, v: L.v + a0, du: dc, dv: da};
    const label = (k: number) => k === 0 ? 'Street floor' : `Floor ${k + 1}`;
    for (let k = 0; k < n; k++) {
      const a0 = end(k) === 'lo' ? 0 : len - CORE.landing;
      const r = this.room(k, sub(a0, CORE.landing, 0, wid), {kind: 'room', type: 'stair-core', label: `Stairs · ${label(k)}`, role: 'stair', enemies: 0, noLoose: true});
      if (!r) return landings;
      landings.push(r);
    }
    for (let k = 0; k + 1 < n; k++) {
      const lane = n > 2 && k % 2 === 1 ? CORE.lane + CORE.divider : 0;
      const runL = sub(CORE.landing, len - 2 * CORE.landing, lane, n > 2 ? CORE.lane : wid);
      const rect = this.rect(runL);
      const lo = this.storeys[k], hi = this.storeys[k + 1];
      const area = this.kit.addArea(rect, 'room', 'stair-core', r2(lo.y + STAIR.headroom), -1, {label: `${this.b.name} · Stairs · ${label(k)} – ${label(k + 1)}`,
        level: lo.level, floorY: lo.y, also: [hi.level], publicSpace: false});
      area.lighting = 'dark';
      area.noFloorLoot = true;
      this.rooms.push({area, storey: k, role: 'stair-run', front: false, windows: 'none', enemies: 0, noLoose: true});
      // world run direction: the street storey's landing end of this pair (end(k)) in world coordinates
      const axis: 'x' | 'z' = (along === 'u') === (this.front === 'N' || this.front === 'S') ? 'x' : 'z';
      const localLo = end(k) === 'lo';
      const worldLo = (this.front === 'N' || this.front === 'W' || along === 'u') ? localLo : !localLo;
      const fl: StairFlight[] = layStairRun([this.kit.grid(lo.level), this.kit.grid(hi.level)], rect, area.id, axis, worldLo ? 'lo' : 'hi', lo.y, hi.y, STAIR);
      for (const q of fl) { q.id = this.kit.flights.length; this.kit.flights.push(q); }
      const first = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
      const last = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
      this.links.push({id: this.links.length, kind: 'stairs', lower: lo.level, upper: hi.level, ramp: fl[0].ramp, bottom: {...first.bottom}, top: {...last.top}, traversalId: fl[0].id});
    }
    this.carvedStoreys = Math.max(this.carvedStoreys, n);
    return landings;
  }

  /**
   * Opens a landing onto a room through its full landing length (a stair landing is short: no margins). Tries every shared wall;
   * the widest opening wins.
   */
  landingDoor(landing: RoomInfo, room: RoomInfo | null): Door | null {
    if (!room) return null;
    const w = this.shared(landing.area, room.area);
    if (!w) return null;
    const width = Math.min(4, w.s1 - w.s0);
    if (width < 2) return null;
    const s = Math.floor((w.s0 + w.s1 - width) / 2);
    const gap: Rect = w.horizontal ? {x: s, y: w.line, w: width, h: 1} : {x: w.line, y: s, w: 1, h: width};
    return this.carve(gap, room, landing, 2.3);
  }

  /**
   * A stair core along the BACK wall (the Mall service-core scheme, long axis along u) at the `at` end, plus the strip in front of it
   * (`hall` cells deep) that each storey's landing opens into. Returns null when the building is too small (no upper storeys then).
   * The end is chosen clear of the back / side entrances when the caller passes 'auto'.
   */
  backCore(n: number, hall: number, at: 'lo' | 'hi' | 'auto' = 'auto'): {core: LRect; front: LRect; at: 'lo' | 'hi'} | null {
    const L = this.coreLength(n), CW = this.coreWidth(n);
    if (L > this.W - 2 || CW + 1 + hall > this.D - 12) return null;
    const pick = (q: 'lo' | 'hi'): LRect => ({u: q === 'lo' ? 0 : this.W - L, v: this.D - CW, du: L, dv: CW});
    // cells of the entrances' spans the core (and its jambs) would take at that end: the end that takes fewer wins, 'hi' on a tie
    const hits = (c: LRect) => this.ents.reduce((s, en) => {
      if (en.local === 'B') return s + Math.max(0, Math.min(en.s1, c.u + c.du) - Math.max(en.s0, c.u - 1) + 1);
      if (en.local === 'L' && c.u === 0) return s + Math.max(0, en.s1 - (c.v - 1 - hall) + 1);
      if (en.local === 'R' && c.u + c.du === this.W) return s + Math.max(0, en.s1 - (c.v - 1 - hall) + 1);
      return s;
    }, 0);
    const q: 'lo' | 'hi' = at !== 'auto' ? at : hits(pick('lo')) < hits(pick('hi')) ? 'lo' : 'hi';
    const core = pick(q);
    return {core, front: {u: core.u, v: core.v - 1 - hall, du: L, dv: hall}, at: q};
  }

  /** Whether the facade cell (ring cell) at world (x, y) faces open ground (a street / yard / lot: never a party wall). */
  exposed(x: number, y: number, side: Side): boolean {
    const out: Record<Side, [number, number]> = {N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0]};
    const [dx, dy] = out[side];
    const g = this.kit.g, ox = x + dx, oy = y + dy;
    if (!g.inBounds(ox, oy)) return false;
    const i = g.idx(ox, oy);
    return g.cells[i] === FLOOR && g.rampIdx[i] < 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // Placement

  /** The placement context of storey k (built once, after carving: door zones / landings are known then). */
  ctx(k: number): PlaceCtx {
    let c = this.ctxs.get(k);
    if (!c) {
      const r = this.plot.rect;
      c = makePlaceCtx(this.stub, this.rng.fork(`place-${k}`), this.storeys[k].level, {x0: r.x - 2, y0: r.y - 2, x1: r.x + r.w + 1, y1: r.y + r.h + 1});
      c.strictWalls = true;
      this.ctxs.set(k, c);
      if (k === 0) this.keepEntrances(c);
    }
    return c;
  }
  /** The ground storey keeps a 2 m deep strip inside every entrance clear (the doorway cells are not Door records). */
  private keepEntrances(c: PlaceCtx): void {
    const g = c.g;
    for (const en of this.ents) {
      const inward: Record<Side, [number, number]> = {N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]};
      const [dx, dy] = inward[en.e.side];
      const across: [number, number] = dx === 0 ? [1, 0] : [0, 1];
      for (const p of en.inner) for (let d = 0; d < 4; d++) for (const s of [-1, 0, 1]) {
        const x = p.x + dx * d + across[0] * s, y = p.y + dy * d + across[1] * s;
        if (!g.inBounds(x, y)) continue;
        const i = g.idx(x, y);
        if (g.cells[i] === FLOOR) c.keep[i] = 1;
      }
    }
  }
  /** Marks cells of storey k as kept clear (a dolly lane, a turning space). */
  keepCells(k: number, cells: readonly number[]): void {
    const c = this.ctx(k);
    for (const i of cells) c.keep[i] = 1;
  }
  grid(k: number): Grid {
    return this.kit.grid(this.storeys[k].level);
  }
  /** Floor y (absolute) of storey k. */
  floorY(k: number): number {
    return this.storeys[k].y;
  }
}

/** World-metre bounds of an area. */
export const areaBox = (a: Area) => ({x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL});
