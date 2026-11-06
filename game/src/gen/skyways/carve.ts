// Task studio-skyways-level-20261106-054448-01 (primary): carving of a Skyways level into ONE Kit (three storey grids), canvas cells,
// before the crop. Pure data (gen/skyways/index.ts crops, links, rails, dresses, populates, validates).
//
// Order:
//  1. the station building: its street-level HUB, the TRANSIT run (stopped escalators + a fixed stair on one pitch) from the
//     underground CONCOURSE (storey 0) up into the hub, the concourse itself, and the station block under it (Kit.sideBlock: two side
//     platforms, one double bed along X) with wide openings from the north platform into the concourse;
//  2. every other building: its hub (the same rect on both storeys; a hub building's skyway slab is open over an atrium court);
//  3. the BRIDGES: one deck per frame edge across the street at the skyway level, laterally inside both hubs' spans, straight
//     corridors from each hub to its facade, a wide opening through each facade wall;
//  4. per building: street-level entrance halls (boarded street doors, glazed facade), a lookout lounge at the skyway level where a
//     facade has no bridge, the enclosed public stair core between the street and skyway levels;
//  5. the ONE add-on hall (its host's skyway level) and the ramen restaurant (dining room + kitchen);
//  6. the optional lower pedway: the concourse continues under the street to a second building's own stair core;
//  7. storefront units off every public edge (Storefront records with their storey: the station storefront look on any storey),
//     washrooms and back-of-house rooms;
//  8. the glazing: bridge sides, entrance halls, lookout lounges, the add-on hall's facade (SkywaysWindow spans in solid wall runs).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, VOID} from '../grid';
import {Kit, type TrackBlock} from '../stationKit';
import {layStairRun, transitSpecs, type StairFlight, type StairSpec} from '../traversal';
import {STORE_PURPOSES} from '../purposes';
import type {Area, Rect, ShopUse, Side, Storefront} from '../stationTypes';
import {BASES, CLEAR, STOREY, type FrameBuilding, type SkywaysFrame} from './frame';
import type {SkywaysAddonId} from './skywaysTypes';
import {SKYWAYS_RAMEN_PURPOSE} from './ramenPurposes';
import {decompose} from '../mall/skeleton';

const r2 = (v: number) => Math.round(v * 100) / 100;
export type CellRect = Rect;

/** Transit specs of one 5 m storey (the mall's / office's 30-degree pitch). */
export const RUN = transitSpecs(STOREY);
/** Cells of a stair run (pitch + top landing) for one storey. */
export const RUN_CELLS = RUN.cells;
/** Lanes of the station transit run (stopped escalator | fixed stair | stopped escalator) and of a building stair core. */
const TRANSIT_LANES: readonly ('escalator' | 'stair')[] = ['escalator', 'stair', 'escalator'];
const LANE_W = {escalator: 3, stair: 5} as const;

export interface RunLaneCarve { kind: 'escalator' | 'stair'; rect: CellRect; flights: number[] }
/** A vertical run between storey `lower` and `lower + 1`. */
export interface RunCarve {
  id: string;
  lower: number;
  rect: CellRect;
  axis: 'x' | 'z';
  /** The TOP end of the run (layStairRun `from`). */
  from: 'lo' | 'hi';
  lanes: RunLaneCarve[];
  area: number;
  /** Enclosed core (walls both sides) vs an open well (railed). */
  enclosed: boolean;
  building: string;
}

export interface BridgeCarve { id: string; a: string; b: string; axis: 'x' | 'z'; rect: CellRect; area: number; breached: boolean; width: number }

export interface WindowCarve {
  /** Wall cells (canvas) of the span and its outward side. */
  rect: CellRect;
  side: Side;
  level: number;
  sill: number;
  head: number;
  kind: 'window' | 'entrance';
  host: {bridge: string} | {building: string};
  breached?: boolean;
}

export interface BuildingCarve {
  b: FrameBuilding;
  /** Interior (inside the wall ring). */
  I: CellRect;
  hub: CellRect;
  /** Skyway-level atrium opening (inside the hub). */
  atrium: CellRect | null;
  /** Public areas per storey (hub pieces, corridors, halls). */
  publicAreas: Map<number, number[]>;
  /** The open public run between the street and skyway levels inside the hub (its lanes, the axis it climbs along). */
  run12: CellRect;
  run12Lanes: ('escalator' | 'stair')[];
  run12Axis: 'x' | 'z';
  /** The station building's transit well (storey 0 -> 1) inside its hub, or null. */
  transit: CellRect | null;
}

export interface AddonCarve {
  id: SkywaysAddonId;
  building: string;
  hall: CellRect;
  hallArea: number;
  areas: number[];
  entry: CellRect;
  stage: CellRect | null;
  /** Prize car: the car's spot (cells, centre) and heading (rad, camera convention). */
  car: {cx: number; cy: number; yaw: number} | null;
  washrooms: number[];
}

export interface RamenCarve { building: string; level: number; dining: number; kitchen: number }

export interface SkywaysCarve {
  f: SkywaysFrame;
  block: TrackBlock;
  concourse: Area;
  runs: RunCarve[];
  bridges: BridgeCarve[];
  buildings: BuildingCarve[];
  windows: WindowCarve[];
  storefronts: Storefront[];
  addon: AddonCarve;
  ramen: RamenCarve | null;
  /** Carved extent (canvas cells). */
  X0: number; Z0: number; X1: number; Z1: number;
  /** Atrium court roof height (absolute y). */
  roofY: number;
  fail?: string;
}

let FAIL = '';
/** Why the last carve returned null (QA / tests). */
export const lastSkywaysCarveFail = (): string => FAIL;
const fail = (why: string): null => { FAIL = why; return null; };

const overlapsR = (a: CellRect, b: CellRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inRect = (r: CellRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const within = (outer: CellRect, r: CellRect) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
const interiorOf = (b: FrameBuilding): CellRect => ({x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2});

/** Rect beyond `r`'s side `s` (one wall cell between): `t` cells along from the side's start, `along` long, `deep` deep. */
function beyond(r: CellRect, s: Side, t: number, along: number, deep: number): CellRect {
  if (s === 'N') return {x: r.x + t, y: r.y - 1 - deep, w: along, h: deep};
  if (s === 'S') return {x: r.x + t, y: r.y + r.h + 1, w: along, h: deep};
  if (s === 'W') return {x: r.x - 1 - deep, y: r.y + t, w: deep, h: along};
  return {x: r.x + r.w + 1, y: r.y + t, w: deep, h: along};
}
/** The one-cell wall slice between `r` and a rect beyond it on side `s` (from `t`, `along` long). */
function gapOn(r: CellRect, s: Side, t: number, along: number): CellRect {
  if (s === 'N') return {x: r.x + t, y: r.y - 1, w: along, h: 1};
  if (s === 'S') return {x: r.x + t, y: r.y + r.h, w: along, h: 1};
  if (s === 'W') return {x: r.x - 1, y: r.y + t, w: 1, h: along};
  return {x: r.x + r.w, y: r.y + t, w: 1, h: along};
}
const sideLen = (r: CellRect, s: Side) => (s === 'N' || s === 'S' ? r.w : r.h);
const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];

/** Carves the whole Skyways level. Null when the frame does not fit (the caller re-rolls the frame's free parameters). */
export function carveSkyways(k: Kit, rng: Rng, f: SkywaysFrame): SkywaysCarve | null {
  FAIL = '';
  let shopSerial = 0;
  const shopName = (use: ShopUse): string => { const list = STORE_PURPOSES[use].names; return list[(shopSerial++ + f.seed) % list.length]; };
  const byId = new Map(f.buildings.map(b => [b.id, b]));
  const station = byId.get(f.station)!;
  const roofY = r2(BASES[2] + CLEAR.atriumRoof);
  const carves = new Map<string, BuildingCarve>();
  const runs: RunCarve[] = [];
  const storefronts: Storefront[] = [];
  const windows: WindowCarve[] = [];
  const addPublic = (bc: BuildingCarve, level: number, id: number) => { let l = bc.publicAreas.get(level); if (!l) bc.publicAreas.set(level, (l = [])); l.push(id); };
  const ceilOf = (level: number, clear: number) => r2(BASES[level] + clear);
  const opt = (level: number) => (level ? {level, floorY: BASES[level]} : {});
  const free = (r: CellRect, level: number, inside?: CellRect) => (!inside || within(inside, r)) && k.rectFree(r, level);

  // --- 1. Hubs --------------------------------------------------------------------------------------------------------------
  for (const b of f.buildings) {
    const I = interiorOf(b);
    const host = b.id === f.addonHost;
    // the hub: a generous court (about half the interior each way), at least 10 cells (5 m: a shop's depth) from every facade
    let hw = Math.round(I.w * rng.range(0.48, 0.6)), hd = Math.round(I.h * rng.range(0.46, 0.58));
    if (b.atrium) { hw = Math.max(hw, 36); hd = Math.max(hd, 32); }
    if (host) { hw = Math.min(hw, 30); hd = Math.min(hd, 28); }
    hw = Math.max(28, Math.min(hw, I.w - (b.id === station.id ? 16 : 20)));
    hd = Math.max(26, Math.min(hd, I.h - (b.id === station.id ? 16 : 20)));
    let hx = I.x + Math.round((I.w - hw) / 2) + rng.int(-3, 3);
    let hy = I.y + Math.round((I.h - hd) / 2) + rng.int(-3, 3);
    if (b.id === station.id) { hw = Math.max(hw, Math.min(I.w - 16, 46)); hd = Math.max(hd, Math.min(I.h - 16, 40)); } // both wells + a walkway
    if (host) {
      // the add-on hall takes the far side of the host: push the hub toward the host's bridge
      const e = f.bridges.find(q => q.a === b.id || q.b === b.id);
      if (e) {
        const other = byId.get(e.a === b.id ? e.b : e.a)!;
        if (e.axis === 'x') hx = other.x < b.x ? I.x + 10 : I.x + I.w - 10 - hw;
        else hy = other.y < b.y ? I.y + 10 : I.y + I.h - 10 - hd;
      }
    }
    const mg = b.id === station.id ? 8 : 10;
    hx = Math.max(I.x + mg, Math.min(hx, I.x + I.w - mg - hw));
    hy = Math.max(I.y + mg, Math.min(hy, I.y + I.h - mg - hd));
    if (hw < 26 || hd < 24) return fail(`hub-${b.id}`);
    const hub = {x: hx, y: hy, w: hw, h: hd};
    let atrium: CellRect | null = null;
    if (b.atrium) {
      const g = rng.int(7, 9);
      atrium = {x: hub.x + g, y: hub.y + g, w: hub.w - 2 * g, h: hub.h - 2 * g};
      if (atrium.w < 12 || atrium.h < 10) atrium = null;
    }
    // the public run between the street and skyway levels: an OPEN well hugging one long edge of the hub (the mall's court runs),
    // escalators either side of a fixed stair where the hub is wide enough, else one stair lane
    // (the station building: along X on the hub's NORTH edge — the transit run lands on its south edge). The run hugs a hub edge with
    // no bridge on that facade where it can (the corridors to the bridges then never meet its well).
    const bridgedSides = new Set<Side>(f.bridges.filter(q => q.a === b.id || q.b === b.id).map(q => {
      const o = byId.get(q.a === b.id ? q.b : q.a)!;
      return q.axis === 'x' ? (o.x > b.x ? 'E' : 'W') : (o.y > b.y ? 'S' : 'N');
    }));
    const edgeLen = (s: Side) => (s === 'N' || s === 'S' ? hub.w : hub.h);
    const edges = SIDES.filter(s => edgeLen(s) >= RUN_CELLS + 8);
    // (the station: never its south edge — the transit well lies there; a bridged north edge keeps the run at one end of it)
    const usable = edges.filter(s => !(b.id === station.id && s === 'S'));
    const edgePick = rng.shuffle(usable.filter(s => !bridgedSides.has(s)))[0] ?? (b.id === station.id ? 'N' : rng.shuffle(usable.slice())[0]);
    if (!edgePick) return fail(`hub-run-${b.id}`);
    const alongX = edgePick === 'N' || edgePick === 'S';
    const lanes: ('escalator' | 'stair')[] = (b.atrium || b.id === station.id) && (alongX ? hub.h : hub.w) >= 30 ? ['escalator', 'stair', 'escalator'] : ['stair'];
    const lw = lanes.reduce((q, l) => q + LANE_W[l], 0);
    const len = RUN_CELLS;
    if ((alongX ? hub.w : hub.h) < len + 8) return fail(`hub-run-${b.id}`);
    const atLow = edgePick === 'N' || edgePick === 'W';
    let a0 = (alongX ? hub.x : hub.y) + Math.round(((alongX ? hub.w : hub.h) - len) / 2) + rng.int(-2, 2);
    if (b.id === station.id) {
      if (!alongX) a0 = hub.y + 3; // E / W: in the rows above the transit well
      else if (bridgedSides.has('N')) a0 = rng.chance(0.5) ? hub.x + 3 : hub.x + hub.w - 3 - len; // leave the other end to the bridge
    }
    const run12: CellRect = alongX ? {x: a0, y: atLow ? hub.y : hub.y + hub.h - lw, w: len, h: lw} : {x: atLow ? hub.x : hub.x + hub.w - lw, y: a0, w: lw, h: len};
    if (atrium && (run12.x < atrium.x + atrium.w + 1 && atrium.x < run12.x + run12.w + 1 && run12.y < atrium.y + atrium.h + 1 && atrium.y < run12.y + run12.h + 1)) {
      // keep at least one gallery cell between the well and the opening (shrink the opening away from the run)
      if (alongX) { if (atLow) { const y1 = atrium.y + atrium.h; atrium.y = run12.y + run12.h + 2; atrium.h = y1 - atrium.y; } else atrium.h = run12.y - 2 - atrium.y; }
      else { if (atLow) { const x1 = atrium.x + atrium.w; atrium.x = run12.x + run12.w + 2; atrium.w = x1 - atrium.x; } else atrium.w = run12.x - 2 - atrium.x; }
      if (atrium.w < 10 || atrium.h < 8) atrium = null;
    }
    // the station's TRANSIT run: an open well along the hub's south edge (the mall's court escalators), climbing along X from the
    // pedway concourse under the hub (storey 0) to the lobby floor
    let transit: CellRect | null = null;
    if (b.id === station.id) {
      const tw = TRANSIT_LANES.reduce((q, l) => q + LANE_W[l], 0);
      transit = {x: hub.x + Math.round((hub.w - RUN_CELLS) / 2) + rng.int(-2, 2), y: hub.y + hub.h - tw, w: RUN_CELLS, h: tw};
      if (transit.x < hub.x + 4 || transit.x + transit.w > hub.x + hub.w - 4 || overlapsR(transit, {x: run12.x - 3, y: run12.y - 3, w: run12.w + 6, h: run12.h + 6})) return fail('transit-well');
    }
    carves.set(b.id, {b, I, hub, atrium, publicAreas: new Map(), run12, run12Lanes: lanes, run12Axis: alongX ? 'x' : 'z', transit});
  }

  // the skyway-level cells of every atrium opening stay open air: no later room may be carved into them (rock again at the end)
  const g2a = k.grid(2), airCells: number[] = [];
  for (const bc of carves.values()) if (bc.atrium) for (let y = bc.atrium.y; y < bc.atrium.y + bc.atrium.h; y++) for (let x = bc.atrium.x; x < bc.atrium.x + bc.atrium.w; x++) { const i = g2a.idx(x, y); g2a.cells[i] = VOID; airCells.push(i); }

  // --- 2. Station: transit run, concourse, station block ---------------------------------------------------------------------
  const sc = carves.get(station.id)!;
  const T = sc.transit!;
  const tW = T.h;
  // the pedway concourse (storey 0) under the station hub: round the transit well (both its mouths on concourse floor), on south to
  // the station block
  const cw = Math.max(T.w + 24, rng.int(64, 90)), Dc = rng.int(10, 14);
  const C0rect: CellRect = {x: T.x + Math.round(T.w / 2 - cw / 2) + rng.int(-6, 6), y: T.y - rng.int(6, 9), w: cw, h: 0};
  if (C0rect.x > T.x - 6) C0rect.x = T.x - 6;
  if (C0rect.x + C0rect.w < T.x + T.w + 6) C0rect.x = T.x + T.w + 6 - C0rect.w;
  C0rect.h = T.y + T.h + Dc - C0rect.y;
  const y0 = C0rect.y + C0rect.h + 1;
  // the platforms centred under the run where the canvas allows (a station building at the west / east edge shifts them)
  const px0 = Math.max(18, Math.min(k.g.w - f.Lp - 18, Math.round(T.x + T.w / 2 - f.Lp / 2) + rng.int(-10, 10)));
  if (px0 - 14 < 2 || px0 + f.Lp + 14 > k.g.w - 2 || y0 + 60 > k.g.h - 2) return fail('station-canvas');
  // carve the concourse before the block (the block's platforms are their own areas); its pieces leave the well's cells to the run
  const conPieces = decompose((x, y) => !inRect(T, x, y), C0rect).sort((p, q) => q.w * q.h - p.w * p.h);
  const concourse = k.addArea(conPieces[0], 'concourse', 'concourse', CLEAR.concourse, -1, {label: 'Pedway concourse', publicSpace: true, role: 'great-hall'});
  addPublic(sc, 0, concourse.id);
  for (const q of conPieces.slice(1)) addPublic(sc, 0, k.addArea(q, 'concourse', 'concourse', CLEAR.concourse, concourse.id, {label: 'Pedway concourse', publicSpace: true, role: 'great-hall'}).id);
  const block = k.sideBlock(px0, y0, f.Lp, CLEAR.platform, ['Platform 1', 'Platform 2']);
  const [P1, P2] = block.platforms;
  for (const t of k.trenches) t.columns = false;
  for (const P of block.platforms) delete P.paid;
  P1.platformNo = 1; P2.platformNo = 2;
  // openings from the north platform into the concourse (wide arches through the shared wall)
  {
    const x0 = Math.max(P2.x + 4, C0rect.x + 2), x1 = Math.min(P2.x + P2.w - 4, C0rect.x + C0rect.w - 2);
    if (x1 - x0 < 16) return fail('platform-concourse');
    const n = x1 - x0 >= 50 ? 3 : 2, ow = rng.int(6, 8);
    for (let i = 0; i < n; i++) {
      const cx = Math.round(x0 + (x1 - x0) * (i + 0.5) / n - ow / 2);
      k.carveDoor({x: cx, y: y0 - 1, w: ow, h: 1}, P2, concourse, CLEAR.wide + 0.6, true);
    }
  }
  // the transit run (storeys 0 and 1): an open well climbing along X from the concourse to the lobby floor
  runs.push(carveRun(k, 'transit', station.id, 0, T, 'x', rng.chance(0.5) ? 'lo' : 'hi', TRANSIT_LANES, false));
  void tW;

  // --- 3. Hub areas (street + skyway level) ----------------------------------------------------------------------------------
  for (const bc of carves.values()) {
    const {b, hub} = bc;
    const name = b.id === station.id ? 'Station lobby' : 'Lobby';
    const g1 = k.grid(1);
    for (const q of decompose((x, y) => !inRect(bc.run12, x, y) && !(bc.transit && inRect(bc.transit, x, y)), hub)) {
      const court = !!bc.atrium && overlapsR(q, bc.atrium);
      const h1 = k.addArea(q, 'concourse', 'concourse', court ? roofY : ceilOf(1, CLEAR.lobby), -1, {...opt(1), label: `${court ? 'Atrium court' : name} · ${bName(b)}`, publicSpace: true, role: 'great-hall'});
      addPublic(bc, 1, h1.id);
      // the atrium court: the street-level band under the opening rises to the glass roof; the gallery ring keeps the lobby ceiling
      if (bc.atrium) for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) g1.ceil[g1.idx(x, y)] = inRect(bc.atrium, x, y) ? roofY : ceilOf(1, CLEAR.lobby);
    }
    // the public run itself (both grids; an open well rising to the skyway ceiling)
    const top: 'lo' | 'hi' = rng.chance(0.5) ? 'lo' : 'hi';
    runs.push(carveRun(k, `run-${b.id}`, b.id, 1, bc.run12, bc.run12Axis, top, bc.run12Lanes, false));
    // skyway level: the hub (or its gallery ring round the opening) minus the run's well
    const pieces = decompose((x, y) => !inRect(bc.run12, x, y) && !(bc.atrium && inRect(bc.atrium, x, y)), hub);
    for (const q of pieces) {
      const a = k.addArea(q, 'concourse', 'retail-arcade', ceilOf(2, CLEAR.skyway), -1, {...opt(2), label: `${bc.atrium ? 'Atrium gallery' : 'Skyway court'} · ${bName(b)}`, publicSpace: true, role: 'mall'});
      addPublic(bc, 2, a.id);
    }
  }

  // --- 4. Bridges ------------------------------------------------------------------------------------------------------------
  const bridges: BridgeCarve[] = [];
  const corridorTo = (bc: BuildingCarve, level: number, side: Side, lat0: number, width: number, label: string, role: 'mall' | 'great-hall' = 'mall'): Area | null => {
    // a straight corridor from the hub's side to the facade (exclusive of the wall ring), lateral span [lat0, lat0 + width)
    const {I, hub} = bc;
    let r: CellRect;
    if (side === 'E') r = {x: hub.x + hub.w, y: lat0, w: I.x + I.w - (hub.x + hub.w), h: width};
    else if (side === 'W') r = {x: I.x, y: lat0, w: hub.x - I.x, h: width};
    else if (side === 'N') r = {x: lat0, y: I.y, w: width, h: hub.y - I.y};
    else r = {x: lat0, y: hub.y + hub.h, w: width, h: I.y + I.h - (hub.y + hub.h)};
    if (r.w < 1 || r.h < 1) return null;
    // must stay inside the hub's lateral span (straight join) and on rock
    const latOk = side === 'E' || side === 'W' ? lat0 >= hub.y && lat0 + width <= hub.y + hub.h : lat0 >= hub.x && lat0 + width <= hub.x + hub.w;
    if (!latOk) return null;
    const g = k.grid(level);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g.cells[g.idx(x, y)] !== SOLID) return null;
    // the cells of the hub along the mouth are flat hub floor (never the run's well, never the atrium opening), clear of the wells
    const wells = [bc.run12, ...(bc.transit ? [bc.transit] : [])].map(w => ({x: w.x - 3, y: w.y - 3, w: w.w + 6, h: w.h + 6}));
    const mouth: CellRect = side === 'E' ? {x: hub.x + hub.w - 4, y: lat0, w: 4, h: width} : side === 'W' ? {x: hub.x, y: lat0, w: 4, h: width}
      : side === 'N' ? {x: lat0, y: hub.y, w: width, h: 4} : {x: lat0, y: hub.y + hub.h - 4, w: width, h: 4};
    if (wells.some(w => overlapsR(w, mouth))) return null;
    for (let t = 0; t < width; t++) {
      const [x, y] = side === 'E' ? [hub.x + hub.w - 1, lat0 + t] : side === 'W' ? [hub.x, lat0 + t] : side === 'N' ? [lat0 + t, hub.y] : [lat0 + t, hub.y + hub.h - 1];
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return null;
    }
    const clear = level === 2 ? CLEAR.skyway : CLEAR.lobby;
    return k.addArea(r, 'concourse', level === 2 ? 'retail-arcade' : 'concourse', ceilOf(level, clear), -1, {...opt(level), label, publicSpace: true, role});
  };
  for (const e of f.bridges) {
    const A = carves.get(e.a)!, B = carves.get(e.b)!;
    // a = west / north, b = east / south
    const [W0, E0] = e.axis === 'x' ? (A.b.x < B.b.x ? [A, B] : [B, A]) : (A.b.y < B.b.y ? [A, B] : [B, A]);
    const lo = e.axis === 'x' ? Math.max(W0.hub.y, E0.hub.y) : Math.max(W0.hub.x, E0.hub.x);
    const hi = e.axis === 'x' ? Math.min(W0.hub.y + W0.hub.h, E0.hub.y + E0.hub.h) : Math.min(W0.hub.x + W0.hub.w, E0.hub.x + E0.hub.w);
    let width = e.width;
    if (hi - lo - 2 < width) width = hi - lo - 2;
    if (width < 10) return fail(`bridge-overlap-${e.id}`);
    // corridors of other bridges / the run on these sides must not overlap: try lateral positions
    let done: BridgeCarve | null = null;
    let why = 'none';
    const cands: number[] = [];
    for (let t = lo + 1; t + width <= hi - 1; t++) cands.push(t);
    const mid = (lo + hi - width) / 2;
    cands.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
    const pickFrom = rng.shuffle(cands.slice(0, Math.min(6, cands.length))).concat(cands.slice(6));
    for (const lat of pickFrom) {
      const sa: Side = e.axis === 'x' ? 'E' : 'S', sb: Side = e.axis === 'x' ? 'W' : 'N';
      const deck: CellRect = e.axis === 'x'
        ? {x: W0.b.x + W0.b.w, y: lat, w: E0.b.x - (W0.b.x + W0.b.w), h: width}
        : {x: lat, y: W0.b.y + W0.b.h, w: width, h: E0.b.y - (W0.b.y + W0.b.h)};
      if (deck.w < 4 || deck.h < 4) return fail(`bridge-street-${e.id}`);
      if (!k.solid(deck, 2)) { why = 'deck'; continue; }
      const ca = corridorTo(W0, 2, sa, lat, width, `Skyway concourse · ${bName(W0.b)}`);
      if (!ca) { why = `corridor-${W0.b.id}`; continue; }
      const cb = corridorTo(E0, 2, sb, lat, width, `Skyway concourse · ${bName(E0.b)}`);
      if (!cb) { k.undoLast(ca); why = `corridor-${E0.b.id}`; continue; }
      const dk = k.addArea(deck, 'passage', 'passage', ceilOf(2, CLEAR.bridge), -1, {...opt(2), label: `Skyway bridge · ${bName(W0.b)} – ${bName(E0.b)}`, publicSpace: true, role: 'crossover'});
      // wide openings through both facade walls (the full width less a pier each side)
      const ga: CellRect = e.axis === 'x' ? {x: W0.b.x + W0.b.w - 1, y: lat + 1, w: 1, h: width - 2} : {x: lat + 1, y: W0.b.y + W0.b.h - 1, w: width - 2, h: 1};
      const gb: CellRect = e.axis === 'x' ? {x: E0.b.x, y: lat + 1, w: 1, h: width - 2} : {x: lat + 1, y: E0.b.y, w: width - 2, h: 1};
      k.carveDoor(ga, ca, dk, CLEAR.wide, false);
      k.carveDoor(gb, dk, cb, CLEAR.wide, false);
      addPublic(W0, 2, ca.id); addPublic(E0, 2, cb.id);
      done = {id: e.id, a: e.a, b: e.b, axis: e.axis, rect: deck, area: dk.id, breached: e.breached, width};
      break;
    }
    if (!done) return fail(`bridge-${e.id}-${why}-${cands.length}`);
    bridges.push(done);
    // glazing: both long sides of the deck, in spans of at most 16 cells (8 m) with a one-cell pier
    const along = e.axis === 'x' ? done.rect.w : done.rect.h;
    for (const s of (e.axis === 'x' ? ['N', 'S'] : ['W', 'E']) as Side[]) {
      for (const [t0, t1] of spans(1, along - 1, 16)) {
        const strip = e.axis === 'x' ? {x: done.rect.x + t0, y: s === 'N' ? done.rect.y - 1 : done.rect.y + done.rect.h, w: t1 - t0, h: 1}
          : {x: s === 'W' ? done.rect.x - 1 : done.rect.x + done.rect.w, y: done.rect.y + t0, w: 1, h: t1 - t0};
        windows.push({rect: strip, side: s, level: 2, sill: 0.45, head: 3.1, kind: 'window', host: {bridge: e.id}, ...(e.breached ? {breached: true} : {})});
      }
    }
  }

  // --- 5. Street-level entrance halls, skyway lookout lounges, stair cores -----------------------------------------------------
  for (const bc of carves.values()) {
    const {b, I, hub} = bc;
    // facades without a bridge at the skyway level
    const bridged = new Set<Side>(bridges.flatMap(q => {
      const out: Side[] = [];
      if (q.a === b.id || q.b === b.id) {
        const other = carves.get(q.a === b.id ? q.b : q.a)!.b;
        out.push(q.axis === 'x' ? (other.x > b.x ? 'E' : 'W') : (other.y > b.y ? 'S' : 'N'));
      }
      return out;
    }));
    // street level: 1-2 entrance halls (never the station's south side: the transit run is there)
    const entSides = rng.shuffle(SIDES.slice()).slice(0, rng.chance(0.55) ? 2 : 1);
    for (const s of entSides) entranceHall(bc, s);
    // skyway level: a lookout lounge on one unbridged facade (not on the add-on host: its hall takes the far side)
    if (b.id !== f.addonHost) {
      const open = rng.shuffle(SIDES.filter(s => !bridged.has(s)));
      if (open.length && rng.chance(0.75)) lookout(bc, open[0]);
    }
    void I; void hub;
  }

  // --- 6. The add-on hall --------------------------------------------------------------------------------------------------
  const hostC = carves.get(f.addonHost)!;
  const addon = carveAddon(hostC, f.addon);
  if (!addon) return fail(`addon-${f.addon}`);

  // --- 7. Ramen restaurant ----------------------------------------------------------------------------------------------------
  const ramen = carveRamen(carves.get(f.ramen)!);

  // --- 8. The lower pedway (optional) -------------------------------------------------------------------------------------------
  if (f.lowerLink) lowerPedway(carves.get(f.lowerLink)!);

  // --- 9. Storefront units, washrooms, back of house ---------------------------------------------------------------------------
  // the station concourse first (storey 0: food counters + kiosks), then every building's street / skyway level public edges
  const con0 = sc.publicAreas.get(0) ?? [concourse.id];
  shopsOn(sc, 0, con0, 'food', rng.int(5, 8));
  for (const bc of carves.values()) {
    for (const level of [1, 2]) {
      const pub = (bc.publicAreas.get(level) ?? []).filter(id => !addon.areas.includes(id));
      washroom(bc, level, pub);
      shopsOn(bc, level, pub, level === 1 ? 'mixed' : 'skyway', level === 1 ? rng.int(5, 8) : rng.int(6, 10));
      backOfHouse(bc, level, pub, rng.int(3, 5));
    }
  }
  // the station's own back of house off the concourse
  washroom(sc, 0, con0);
  backOfHouse(sc, 0, con0, rng.int(3, 4));

  for (const i of airCells) g2a.cells[i] = SOLID;

  // --- Extent -----------------------------------------------------------------------------------------------------------------
  let X0 = Infinity, Z0 = Infinity, X1 = -Infinity, Z1 = -Infinity;
  for (const r of [...k.areas, ...f.buildings, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    X0 = Math.min(X0, r.x); Z0 = Math.min(Z0, r.y); X1 = Math.max(X1, r.x + r.w); Z1 = Math.max(Z1, r.y + r.h);
  }
  if (X0 - 4 < 1 || Z0 - 4 < 1 || X1 + 4 > k.g.w || Z1 + 4 > k.g.h) return fail('canvas');
  return {f, block, concourse, runs, bridges, buildings: [...carves.values()], windows, storefronts, addon, ramen, X0, Z0, X1, Z1, roofY};

  // ===========================================================================================================================
  // Local helpers (closures over the kit / records)

  function entranceHall(bc: BuildingCarve, s: Side): void {
    const {I, hub, b} = bc;
    const width = rng.int(10, 12);
    const span = s === 'N' || s === 'S' ? [hub.x + 2, hub.x + hub.w - 2 - width] : [hub.y + 2, hub.y + hub.h - 2 - width];
    if (span[1] < span[0]) return;
    const lat = rng.int(span[0], span[1]);
    const c = corridorTo(bc, 1, s, lat, width, `Entrance hall · ${bName(b)}`, 'great-hall');
    if (!c) return;
    addPublic(bc, 1, c.id);
    // the vestibule: widen the facade end along the facade (glazed both sides of the boarded street doors)
    const vlen = Math.min(sideLen(I, s) - 10, width + 2 * rng.int(5, 8)), vdeep = 6;
    const vlat = Math.max((s === 'N' || s === 'S' ? I.x : I.y) + 4, Math.min(lat - Math.round((vlen - width) / 2), (s === 'N' || s === 'S' ? I.x + I.w : I.y + I.h) - 4 - vlen));
    const parts: CellRect[] = [];
    if (s === 'N' || s === 'S') {
      const y = s === 'N' ? I.y : I.y + I.h - vdeep;
      if (vlat < lat) parts.push({x: vlat, y, w: lat - vlat, h: vdeep});
      if (vlat + vlen > lat + width) parts.push({x: lat + width, y, w: vlat + vlen - lat - width, h: vdeep});
    } else {
      const x = s === 'W' ? I.x : I.x + I.w - vdeep;
      if (vlat < lat) parts.push({x, y: vlat, w: vdeep, h: lat - vlat});
      if (vlat + vlen > lat + width) parts.push({x, y: lat + width, w: vdeep, h: vlat + vlen - lat - width});
    }
    const g1 = k.grid(1);
    for (const p of parts) {
      let ok = true;
      for (let y = p.y; y < p.y + p.h && ok; y++) for (let x = p.x; x < p.x + p.w; x++) if (g1.cells[g1.idx(x, y)] !== SOLID) { ok = false; break; }
      if (!ok) continue;
      const a = k.addArea(p, 'concourse', 'concourse', ceilOf(1, CLEAR.lobby), c.id, {...opt(1), label: `Entrance hall · ${bName(b)}`, publicSpace: true, role: 'great-hall'});
      addPublic(bc, 1, a.id);
    }
    // glazing along the facade: the boarded street doors in the middle (entrance), glass either side
    const f0 = Math.max(vlat, (s === 'N' || s === 'S' ? I.x : I.y)), f1 = vlat + vlen;
    const d0 = lat + Math.round(width / 2) - 3, d1 = d0 + 6;
    const wall = (t0: number, t1: number): CellRect => s === 'N' ? {x: t0, y: b.y, w: t1 - t0, h: 1} : s === 'S' ? {x: t0, y: b.y + b.h - 1, w: t1 - t0, h: 1}
      : s === 'W' ? {x: b.x, y: t0, w: 1, h: t1 - t0} : {x: b.x + b.w - 1, y: t0, w: 1, h: t1 - t0};
    const onFloor = (t: number) => { const [x, y] = s === 'N' ? [t, I.y] : s === 'S' ? [t, I.y + I.h - 1] : s === 'W' ? [I.x, t] : [I.x + I.w - 1, t]; return g1.cells[g1.idx(x, y)] === FLOOR; };
    for (const [t0, t1] of [[f0 + 1, d0], [d1, f1 - 1]] as const) {
      for (const [u0, u1] of runsWhere(t0, t1, onFloor)) for (const [q0, q1] of spans(u0, u1, 14)) windows.push({rect: wall(q0, q1), side: s, level: 1, sill: 0.4, head: 3.3, kind: 'window', host: {building: b.id}});
    }
    if (onFloor(d0) && onFloor(d1 - 1)) windows.push({rect: wall(d0, d1), side: s, level: 1, sill: 0, head: 2.8, kind: 'entrance', host: {building: b.id}});
  }

  function lookout(bc: BuildingCarve, s: Side): void {
    const {I, hub, b} = bc;
    const width = rng.int(8, 10);
    const span = s === 'N' || s === 'S' ? [hub.x + 2, hub.x + hub.w - 2 - width] : [hub.y + 2, hub.y + hub.h - 2 - width];
    if (span[1] < span[0]) return;
    const lat = rng.int(span[0], span[1]);
    const c = corridorTo(bc, 2, s, lat, width, `Lookout lounge · ${bName(b)}`);
    if (!c) return;
    addPublic(bc, 2, c.id);
    const g2 = k.grid(2);
    const wall = s === 'N' ? {x: lat, y: b.y, w: width, h: 1} : s === 'S' ? {x: lat, y: b.y + b.h - 1, w: width, h: 1}
      : s === 'W' ? {x: b.x, y: lat, w: 1, h: width} : {x: b.x + b.w - 1, y: lat, w: 1, h: width};
    void g2; void I;
    windows.push({rect: wall, side: s, level: 2, sill: 0.5, head: 3.2, kind: 'window', host: {building: b.id}});
  }

  function carveAddon(bc: BuildingCarve, id: SkywaysAddonId): AddonCarve | null {
    const {I, hub, b} = bc;
    const minAlong = id === 'convention' ? 52 : 34, minDeep = id === 'convention' ? 26 : 28;
    // the biggest rect on rock beyond one hub side, inside the interior, at the skyway level (per side; tried largest first) whose
    // entry opening faces flat hub floor (never a run well)
    const g2 = k.grid(2);
    const ewidth = id === 'prize-car' ? 14 : 10;
    const cands: {r: CellRect; s: Side; score: number; gap: CellRect}[] = [];
    for (const s of SIDES) {
      const deepMax = s === 'N' ? hub.y - 1 - I.y : s === 'S' ? I.y + I.h - (hub.y + hub.h + 1) : s === 'W' ? hub.x - 1 - I.x : I.x + I.w - (hub.x + hub.w + 1);
      if (deepMax < minDeep) continue;
      const a0 = s === 'N' || s === 'S' ? I.x : I.y, a1 = s === 'N' || s === 'S' ? I.x + I.w : I.y + I.h;
      let got: {r: CellRect; s: Side; score: number; gap: CellRect} | null = null;
      for (let deep = deepMax; deep >= minDeep && !got; deep -= 2) {
        for (let w = a1 - a0; w >= minAlong && !got; w -= 2) {
          for (let o = 0; o + w <= a1 - a0; o += 2) {
            const r: CellRect = s === 'N' ? {x: a0 + o, y: hub.y - 1 - deep, w, h: deep} : s === 'S' ? {x: a0 + o, y: hub.y + hub.h + 1, w, h: deep}
              : s === 'W' ? {x: hub.x - 1 - deep, y: a0 + o, w: deep, h: w} : {x: hub.x + hub.w + 1, y: a0 + o, w: deep, h: w};
            const ov0 = s === 'N' || s === 'S' ? Math.max(r.x, hub.x) : Math.max(r.y, hub.y);
            const ov1 = s === 'N' || s === 'S' ? Math.min(r.x + r.w, hub.x + hub.w) : Math.min(r.y + r.h, hub.y + hub.h);
            if (ov1 - ov0 < ewidth + 2) continue;
            if (!within(I, r) || !k.rectFree(r, 2)) continue;
            // the entry: centred on the overlap, slid along it until flat hub floor lies in front of every cell
            const hubSide: Side = s === 'N' ? 'S' : s === 'S' ? 'N' : s === 'W' ? 'E' : 'W';
            let gap: CellRect | null = null;
            for (const d of [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10]) {
              const e0 = Math.round((ov0 + ov1 - ewidth) / 2) + d;
              if (e0 < ov0 || e0 + ewidth > ov1) continue;
              const gp: CellRect = hubSide === 'S' ? {x: e0, y: r.y + r.h, w: ewidth, h: 1} : hubSide === 'N' ? {x: e0, y: r.y - 1, w: ewidth, h: 1}
                : hubSide === 'E' ? {x: r.x + r.w, y: e0, w: 1, h: ewidth} : {x: r.x - 1, y: e0, w: 1, h: ewidth};
              let ok = true;
              for (let q = 0; q < ewidth && ok; q++) {
                const cx = gp.w > 1 ? gp.x + q : hubSide === 'E' ? gp.x + 1 : gp.x - 1;
                const cy = gp.h > 1 ? gp.y + q : hubSide === 'S' ? gp.y + 1 : gp.y - 1;
                const i = g2.idx(cx, cy);
                if (g2.cells[i] !== FLOOR || g2.rampIdx[i] >= 0) ok = false;
              }
              if (ok) { gap = gp; break; }
            }
            if (!gap) continue;
            got = {r, s, score: r.w * r.h, gap};
            break;
          }
        }
      }
      if (got) cands.push(got);
    }
    if (!cands.length) return null;
    cands.sort((p, q) => q.score - p.score);
    const {r: r0, s, gap} = cands[0];
    // the convention keeps a support strip (green room, washrooms, storage) along the hall's flank, away from the entry
    let r = r0, strip: CellRect | null = null;
    if (id === 'convention') {
      const SW = 11;
      const along = s === 'N' || s === 'S';
      const gapMid = along ? gap.x + gap.w / 2 : gap.y + gap.h / 2, mid = along ? r0.x + r0.w / 2 : r0.y + r0.h / 2;
      const atLow = gapMid > mid; // the strip at the end away from the entry
      if (along) { strip = {x: atLow ? r0.x : r0.x + r0.w - SW, y: r0.y, w: SW, h: r0.h}; r = {x: atLow ? r0.x + SW + 1 : r0.x, y: r0.y, w: r0.w - SW - 1, h: r0.h}; }
      else { strip = {x: r0.x, y: atLow ? r0.y : r0.y + r0.h - SW, w: r0.w, h: SW}; r = {x: r0.x, y: atLow ? r0.y + SW + 1 : r0.y, w: r0.w, h: r0.h - SW - 1}; }
      // the entry must still open onto the hall
      const g0x = along ? gap.x : gap.y, g1x = g0x + ewidth, h0 = along ? r.x : r.y, h1 = h0 + (along ? r.w : r.h);
      if (g0x < h0 || g1x > h1) return null;
    }
    const hallCeil = ceilOf(2, id === 'convention' ? 5.6 : 6.0);
    const label = id === 'convention' ? 'Convention hall' : 'Grand prize atrium';
    const hall = k.addArea(r, 'concourse', 'concourse', hallCeil, -1, {...opt(2), label, publicSpace: true, role: 'great-hall'});
    addPublic(bc, 2, hall.id);
    const hubSide: Side = s === 'N' ? 'S' : s === 'S' ? 'N' : s === 'W' ? 'E' : 'W';
    const hubArea = k.areas[g2.area[g2.idx(...frontCell(gap, hubSide))]];
    if (!hubArea) return null;
    k.carveDoor(gap, hubArea, hall, id === 'prize-car' ? 3.4 : CLEAR.wide, false);
    const areas = [hall.id];
    const washrooms: number[] = [];
    // support rooms along the hall's flank sides (convention: green room, storage, washrooms; prize car: a sales office)
    const flank: Side[] = s === 'N' || s === 'S' ? ['W', 'E'] : ['N', 'S'];
    const rooms: [string, 'room' | 'closet', Area['type'], number, number][] = id === 'convention'
      ? [['Green room', 'room', 'crew-room', 12, 10], ['Washrooms', 'room', 'washroom', 10, 9], ['Event storage', 'room', 'storage', 12, 10]]
      : [['Sales office', 'room', 'agent-office', 12, 10], ['Washrooms', 'room', 'washroom', 10, 9]];
    let placed = 0;
    if (strip) {
      // the strip's rooms in a row along it, each with its door through the wall into the hall
      const stripSide: Side = s === 'N' || s === 'S' ? (strip.x < r.x ? 'W' : 'E') : (strip.y < r.y ? 'N' : 'S');
      const len = s === 'N' || s === 'S' ? strip.h : strip.w;
      let t = 0;
      for (const [label2, kind, type, along] of rooms) {
        const L = Math.min(along + 2, len - t);
        if (L < 7) break;
        const rr: CellRect = s === 'N' || s === 'S' ? {x: strip.x, y: strip.y + t, w: strip.w, h: L} : {x: strip.x + t, y: strip.y, w: L, h: strip.h};
        const a = k.addArea(rr, kind, type, ceilOf(2, CLEAR.back), hall.id, {...opt(2), label: label2, publicSpace: type === 'washroom'});
        const d0 = t + Math.floor(L / 2) - 1;
        k.carveDoor(gapOn(r, stripSide, d0 - (s === 'N' || s === 'S' ? r.y - strip.y : r.x - strip.x), 3), hall, a, CLEAR.door, false, type === 'washroom' ? {} : {staff: true});
        areas.push(a.id); placed++;
        if (type === 'washroom') washrooms.push(a.id);
        t += L + 1;
      }
    }
    for (const [label2, kind, type, along, deep] of strip ? [] : rooms) {
      let a: Area | null = null;
      for (const fs of flank) {
        const n = sideLen(r, fs) - along;
        for (let t = 2; t <= n - 2 && !a; t += 3) {
          const rr = beyond(r, fs, t, along, deep);
          if (!within(I, rr) || !k.rectFree(rr, 2)) continue;
          a = k.addArea(rr, kind, type, ceilOf(2, CLEAR.back), hall.id, {...opt(2), label: label2, publicSpace: type === 'washroom'});
          k.carveDoor(gapOn(r, fs, t + Math.floor(along / 2) - 1, 3), hall, a, CLEAR.door, false, type === 'washroom' ? {} : {staff: true});
        }
        if (a) break;
      }
      if (!a) {
        // any side of the hall but the entry side
        for (const fs of SIDES) {
          if (fs === s || (fs === hubSide)) continue;
          const n = sideLen(r, fs) - along;
          for (let t = 2; t <= n - 2 && !a; t += 3) {
            const rr = beyond(r, fs, t, along, deep);
            if (!within(I, rr) || !k.rectFree(rr, 2)) continue;
            a = k.addArea(rr, kind, type, ceilOf(2, CLEAR.back), hall.id, {...opt(2), label: label2, publicSpace: type === 'washroom'});
            k.carveDoor(gapOn(r, fs, t + Math.floor(along / 2) - 1, 3), hall, a, CLEAR.door, false, type === 'washroom' ? {} : {staff: true});
          }
          if (a) break;
        }
      }
      if (a) { areas.push(a.id); placed++; if (type === 'washroom') washrooms.push(a.id); }
    }
    if (id === 'convention' && !washrooms.length) return null; // the mascot points the way to them: they must exist
    void placed;
    // the stage: along the wall opposite the entry, 40-55 % of the hall's width, 7-9 cells deep (props render it; see addon.ts)
    let stage: CellRect | null = null;
    if (id === 'convention') {
      const sw = Math.round(sideLen(r, s) * rng.range(0.4, 0.55)), sd = rng.int(7, 9);
      const t = Math.round((sideLen(r, s) - sw) / 2);
      stage = s === 'N' ? {x: r.x + t, y: r.y + 1, w: sw, h: sd} : s === 'S' ? {x: r.x + t, y: r.y + r.h - 1 - sd, w: sw, h: sd}
        : s === 'W' ? {x: r.x + 1, y: r.y + t, w: sd, h: sw} : {x: r.x + r.w - 1 - sd, y: r.y + t, w: sd, h: sw};
    }
    // the prize car: in the middle of the hall, angled toward the entry
    let car: AddonCarve['car'] = null;
    if (id === 'prize-car') {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const ex = gap.x + gap.w / 2, ey = gap.y + gap.h / 2;
      // camera convention: forward = (-sin yaw, -cos yaw); face 35-50 degrees off the entry line (a showroom angle)
      const toward = Math.atan2(-(ex - cx), -(ey - cy));
      car = {cx, cy, yaw: toward + (rng.chance(0.5) ? 1 : -1) * rng.range(0.6, 0.9)};
    }
    // facade glazing where the hall meets the wall ring (a showroom / ballroom window wall)
    for (const fs of SIDES) {
      const touches = fs === 'N' ? r.y === I.y : fs === 'S' ? r.y + r.h === I.y + I.h : fs === 'W' ? r.x === I.x : r.x + r.w === I.x + I.w;
      if (!touches) continue;
      const t0 = fs === 'N' || fs === 'S' ? r.x + 2 : r.y + 2, t1 = fs === 'N' || fs === 'S' ? r.x + r.w - 2 : r.y + r.h - 2;
      for (const [q0, q1] of spans(t0, t1, 14)) {
        const rect = fs === 'N' ? {x: q0, y: b.y, w: q1 - q0, h: 1} : fs === 'S' ? {x: q0, y: b.y + b.h - 1, w: q1 - q0, h: 1}
          : fs === 'W' ? {x: b.x, y: q0, w: 1, h: q1 - q0} : {x: b.x + b.w - 1, y: q0, w: 1, h: q1 - q0};
        windows.push({rect, side: fs, level: 2, sill: id === 'prize-car' ? 0.3 : 0.9, head: id === 'prize-car' ? 4.6 : 3.4, kind: 'window', host: {building: b.id}});
      }
    }
    return {id, building: b.id, hall: r, hallArea: hall.id, areas, entry: gap, stage, car, washrooms};
  }

  function carveRamen(bc: BuildingCarve): RamenCarve | null {
    // a compact dining room off a public edge with its kitchen beside it (skyway level, then street level, then the pedway concourse)
    const tries: [BuildingCarve, number][] = [[bc, 2], [bc, 1], [sc, 0]];
    for (const [B, level] of tries) {
      for (const pid of rng.shuffle((B.publicAreas.get(level) ?? []).slice())) {
        const P = k.areas[pid];
        for (const s of rng.shuffle(SIDES.slice())) {
          const along = rng.int(16, 20), kal = rng.int(7, 9), deep = rng.int(10, 12);
          const n = sideLen(P, s) - along - kal - 1;
          for (let t = 1; t <= n; t += 2) {
            const r = beyond(P, s, t, along, deep);
            const kr = beyond(P, s, t + along + 1, kal, deep);
            const inside = level ? B.I : undefined;
            if (!free(r, level, inside) || !free(kr, level, inside)) continue;
            const gap = gapOn(P, s, t + Math.floor(along / 2) - 3, 6);
            if (!k.solid(gap, level)) continue;
            const name = rng.pick(RAMEN_NAMES);
            const dining = k.addArea(r, 'room', 'eatery', ceilOf(level, CLEAR.shop), P.id, {...opt(level), label: name, publicSpace: true});
            dining.purpose = SKYWAYS_RAMEN_PURPOSE.dining;
            const kitchen = k.addArea(kr, 'room', 'eatery', ceilOf(level, CLEAR.back), dining.id, {...opt(level), label: `${name} kitchen`, publicSpace: false});
            kitchen.purpose = SKYWAYS_RAMEN_PURPOSE.kitchen;
            k.carveDoor(gap, P, dining, CLEAR.door + 0.2, false);
            // the kitchen door through the shared side wall (one cell between the two rooms)
            const side2: Side = s === 'N' || s === 'S' ? 'E' : 'S';
            k.carveDoor(gapOn(r, side2, Math.max(1, Math.floor(deep / 2) - 1), 3), dining, kitchen, CLEAR.door, false, {staff: true});
            return {building: B.b.id, level, dining: dining.id, kitchen: kitchen.id};
          }
        }
      }
    }
    return null;
  }

  function lowerPedway(bc: BuildingCarve): void {
    // a single stair lane up into the neighbour's street-level hub (top end north), reached by a pedway along the concourse rows
    const w = LANE_W.stair;
    const R: CellRect = {x: bc.hub.x + Math.round(bc.hub.w / 2 - w / 2), y: bc.hub.y + bc.hub.h, w, h: RUN_CELLS};
    // its top mouth must be flat hub floor on the street level (not the hub's own run well)
    { const g1 = k.grid(1); for (let x = R.x; x < R.x + R.w; x++) { const i = g1.idx(x, R.y - 1); if (g1.cells[i] !== FLOOR || g1.rampIdx[i] >= 0) return; } }
    if (!within(bc.I, R) || !k.rectFree(R, 1) || !k.rectFree(R, 0)) return;
    const bottomRow = R.y + R.h; // the run's bottom mouth (storey 0)
    const C = concourse;
    const east = R.x > C.x + C.w;
    const ped: CellRect = east ? {x: C.x + C.w, y: C.y + 2, w: R.x + R.w + 2 - (C.x + C.w), h: 9} : {x: R.x - 2, y: C.y + 2, w: C.x - (R.x - 2), h: 9};
    // the pedway must reach the run's bottom row: a spur along z between the pedway band and the bottom mouth
    const spur: CellRect | null = bottomRow < ped.y ? {x: R.x - 1, y: bottomRow, w: R.w + 2, h: ped.y - bottomRow}
      : bottomRow >= ped.y + ped.h ? {x: R.x - 1, y: ped.y + ped.h, w: R.w + 2, h: bottomRow + 1 - (ped.y + ped.h)} : null;
    const g0 = k.grid(0);
    const rock = (r: CellRect) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!g0.inBounds(x, y) || g0.cells[g0.idx(x, y)] !== SOLID) return false; return true; };
    if (!rock(ped) || (spur && !rock(spur))) return;
    // the ramp's rect itself must be rock on storey 0 (south of the hub; never over the station block)
    const pa = k.addArea(ped, 'concourse', 'concourse', CLEAR.concourse - 0.6, concourse.id, {label: `Pedway to ${bName(bc.b)}`, publicSpace: true, role: 'transfer'});
    addPublic(sc, 0, pa.id);
    if (spur) { const sa = k.addArea(spur, 'concourse', 'concourse', CLEAR.concourse - 0.6, pa.id, {label: `Pedway to ${bName(bc.b)}`, publicSpace: true, role: 'transfer'}); addPublic(sc, 0, sa.id); }
    runs.push(carveRun(k, `pedway-${bc.b.id}`, bc.b.id, 0, R, 'z', 'lo', ['stair'], true));
  }

  function shopsOn(bc: BuildingCarve, level: number, publicIds: number[], mix: 'food' | 'mixed' | 'skyway', target: number): void {
    let n = 0;
    const useCount = new Map<ShopUse, number>();
    const pool = mix === 'food' ? FOOD_POOL : mix === 'mixed' ? STREET_POOL : SKYWAY_POOL;
    for (const pid of rng.shuffle(publicIds.slice())) {
      const P = k.areas[pid];
      for (const s of rng.shuffle(SIDES.slice())) {
        let t = 1 + rng.int(0, 2);
        while (t < sideLen(P, s) - 6 && n < target) {
          const min = Math.min(...pool.map(([u]) => useCount.get(u) ?? 0));
          const use = rng.weighted(pool.filter(([u]) => (useCount.get(u) ?? 0) === min));
          const info = STORE_PURPOSES[use];
          const w = Math.min(rng.int(info.w[0], info.w[1]), sideLen(P, s) - t - 1);
          if (w < 6) break;
          let d = rng.int(Math.max(8, info.d[0]), Math.max(10, info.d[1]));
          let r = beyond(P, s, t, w, d);
          const inside = level === 0 ? null : bc.I;
          while (!free(r, level, inside ?? undefined) && d - 2 >= 7) { d -= 2; r = beyond(P, s, t, w, d); }
          const gap = gapOn(P, s, t, w);
          if (!free(r, level, inside ?? undefined) || !k.solid(gap, level)) { t += 2; continue; }
          const sf = shopfront(level, P, s, gap, r, use);
          storefronts.push(sf);
          useCount.set(use, (useCount.get(use) ?? 0) + 1);
          n++;
          t += w + 1;
        }
      }
    }
  }

  function shopfront(level: number, P: Area, s: Side, gap: CellRect, r: CellRect, use: ShopUse): Storefront {
    const info = STORE_PURPOSES[use];
    const isFood = info.category === 'food';
    // glazed retail fronts stand open (glass either side of the entry); counter fronts may have their shutter stuck part-way
    const shutter = info.glazed ? 'open' as const : rng.weighted([['open', 0.65], ['partial', 0.35]] as const);
    const head = r2(rng.range(2.55, 2.8)), fasciaTop = r2(Math.min(head + rng.range(0.55, 0.75), (P.ceil - BASES[level]) - 0.15));
    const glazed = info.glazed && gap.w + gap.h - 1 >= 6;
    const ow = gap.w + gap.h - 1;
    const entryW = Math.min(ow - 2, rng.int(2, 3));
    const e0 = !glazed ? 0 : rng.chance(0.5) ? 1 : Math.floor((ow - entryW) / 2);
    const sf: Storefront = {
      id: storefronts.length, hall: P.id, side: s, unit: -1, ox: gap.x, oy: gap.y, ow: gap.w, oh: gap.h, ux: r.x, uy: r.y, uw: r.w, uh: r.h,
      use, food: isFood, name: shopName(use), shutter, head, shutterY: shutter === 'partial' ? r2(rng.range(1.95, 2.2)) : head, fasciaTop,
      sign: shutter === 'open' ? rng.weighted([['lit', 0.5], ['dim', 0.3], ['dead', 0.2]] as const) : rng.weighted([['dim', 0.4], ['dead', 0.6]] as const),
      glazed, entry: glazed ? [e0, e0 + entryW] : [0, ow], color: rng.pick(info.colors), backDoor: -1,
      style: 'slat',
      ...(level ? {level, baseY: BASES[level]} : {}),
    };
    // every unit has an interior (an abandoned network: a closed shutter is a grille you can see through, or reached via a partial)
    const unit = k.addArea(r, 'room', isFood ? 'eatery' : 'shop', ceilOf(level, CLEAR.shop), P.id, {...opt(level), label: sf.name, publicSpace: true});
    unit.storefront = sf.id;
    unit.purpose = use;
    sf.unit = unit.id;
    k.carveDoor(gap, P, unit, sf.shutter === 'partial' ? sf.shutterY : head, false, {shopfront: true});
    k.reserve(gap.h === 1 ? {x: gap.x - 1, y: gap.y, w: gap.w + 2, h: 1} : {x: gap.x, y: gap.y - 1, w: 1, h: gap.h + 2});
    return sf;
  }

  function washroom(bc: BuildingCarve, level: number, publicIds: number[]): void {
    for (const pid of rng.shuffle(publicIds.slice())) {
      const P = k.areas[pid];
      for (const s of rng.shuffle(SIDES.slice())) {
        const along = 10, deep = rng.int(8, 10), n = sideLen(P, s) - along;
        for (let t = 1; t <= n - 1; t += 2) {
          const r = beyond(P, s, t, along, deep);
          if (!free(r, level, level ? bc.I : undefined) || !k.solid(gapOn(P, s, t + 3, 3), level)) continue;
          const a = k.addArea(r, 'room', 'washroom', ceilOf(level, CLEAR.back), P.id, {...opt(level), label: 'Washrooms', publicSpace: true});
          k.carveDoor(gapOn(P, s, t + 3, 3), P, a, CLEAR.door, false);
          return;
        }
      }
    }
  }

  function backOfHouse(bc: BuildingCarve, level: number, publicIds: number[], target: number): void {
    let n = 0;
    const types: [Area['type'], 'room' | 'closet', string, number][] = [['storage', 'room', 'Storage room', 3], ['utility', 'room', 'Utility room', 2], ['crew-room', 'room', 'Staff room', 1.5],
      ['stock-room', 'room', 'Stock room', 2], ['supply-closet', 'closet', 'Supply closet', 1], ['janitor-closet', 'closet', 'Janitor closet', 1]];
    for (const pid of rng.shuffle(publicIds.slice())) {
      const P = k.areas[pid];
      for (const s of rng.shuffle(SIDES.slice())) {
        if (n >= target) return;
        const [type, kind, label] = rng.weighted(types.map(q => [q, q[3]] as const));
        const along = kind === 'closet' ? rng.int(5, 7) : rng.int(9, 14), deep = kind === 'closet' ? rng.int(5, 6) : rng.int(8, 12);
        const N = sideLen(P, s) - along;
        for (let t = 1; t <= N - 1; t += 3) {
          const r = beyond(P, s, t, along, deep);
          const door = gapOn(P, s, t + 1, 3);
          if (!free(r, level, level ? bc.I : undefined) || !k.solid(door, level)) continue;
          const a = k.addArea(r, kind, type, ceilOf(level, CLEAR.back), P.id, {...opt(level), label, publicSpace: false});
          k.carveDoor(door, P, a, CLEAR.door, false, {staff: true});
          n++;
          break;
        }
      }
    }
  }
}

/** The cell in front of a one-cell wall gap on its `side` (toward that side's area). */
function frontCell(gap: CellRect, toward: Side): [number, number] {
  const cx = gap.x + Math.floor(gap.w / 2), cy = gap.y + Math.floor(gap.h / 2);
  return toward === 'N' ? [cx, gap.y - 1] : toward === 'S' ? [cx, gap.y + gap.h] : toward === 'W' ? [gap.x - 1, cy] : [gap.x + gap.w, cy];
}

/** [t0, t1) split into spans of at most `max` cells with a one-cell pier between them. */
function spans(t0: number, t1: number, max: number): [number, number][] {
  const len = t1 - t0;
  if (len < 3) return [];
  const n = Math.ceil((len + 1) / (max + 1));
  const each = (len - (n - 1)) / n;
  const out: [number, number][] = [];
  let a = t0;
  for (let i = 0; i < n; i++) {
    const b = i === n - 1 ? t1 : Math.round(a + each);
    if (b - a >= 2) out.push([a, b]);
    a = b + 1;
  }
  return out;
}
/** Maximal runs of t in [t0, t1) where pred(t). */
function runsWhere(t0: number, t1: number, pred: (t: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let t = t0; t <= t1; t++) {
    const on = t < t1 && pred(t);
    if (on && s < 0) s = t;
    if (!on && s >= 0) { out.push([s, t]); s = -1; }
  }
  return out;
}

/**
 * One vertical run between storey `lower` and `lower + 1` (carved into both grids): `lanes` side by side across the rect (a shared
 * pitch, like the mall's / office's transit hall), top end at `from`.
 */
function carveRun(k: Kit, id: string, building: string, lower: number, rect: CellRect, axis: 'x' | 'z', from: 'lo' | 'hi', lanes: readonly ('escalator' | 'stair')[], enclosed: boolean): RunCarve {
  const hi = lower + 1;
  const clear = hi === 1 ? CLEAR.lobby : CLEAR.corridor;
  const ceil = r2(BASES[hi] + clear + (enclosed ? 0.4 : 0));
  const label = id === 'transit' ? 'Escalators · Concourse – Street level' : id.startsWith('pedway') ? 'Stairs · Pedway – Street level' : 'Stairs · Street level – +15';
  const area = k.addArea(rect, 'passage', 'stair-core', ceil, -1, {...(lower ? {level: lower, floorY: BASES[lower]} : {}), also: [hi], role: 'stair', publicSpace: true, label});
  const out: RunLaneCarve[] = [];
  let off = 0;
  const spec = (kind: 'escalator' | 'stair'): StairSpec => (kind === 'escalator' ? RUN.escalator : RUN.stair);
  for (const kind of lanes) {
    const w = LANE_W[kind];
    const r: CellRect = axis === 'x' ? {x: rect.x, y: rect.y + off, w: rect.w, h: w} : {x: rect.x + off, y: rect.y, w, h: rect.h};
    off += w;
    const fl: StairFlight[] = layStairRun([k.grid(lower), k.grid(hi)], r, area.id, axis, from, BASES[hi], BASES[lower], spec(kind));
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; q.spec = kind === 'escalator' ? 'escalator' : 'transit'; ids.push(q.id); k.flights.push(q); }
    out.push({kind, rect: r, flights: ids});
  }
  // an open well: both storeys' bands rise to the upper storey's ceiling over the whole run
  for (const g of [k.grid(lower), k.grid(hi)]) for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) g.ceil[g.idx(x, y)] = ceil;
  return {id, lower, rect, axis, from, lanes: out, area: area.id, enclosed, building};
}

// ---------------------------------------------------------------------------------------------
// Names and shop pools

const bName = (b: FrameBuilding): string => b.name;

const RAMEN_NAMES = ['Menya Hoshi', 'Ramen Kumo', 'Hoshi Noodle Bar', 'Shoyu House'];

const FOOD_POOL: [ShopUse, number][] = [['coffee', 3], ['bakery', 2], ['noodles', 1.5], ['sushi', 1.5], ['deli', 1.5], ['juice', 1], ['donut', 1], ['pizza', 1], ['burger', 1], ['shawarma', 1]];
const STREET_POOL: [ShopUse, number][] = [['coffee', 2], ['convenience', 2], ['pharmacy', 1.5], ['newsstand', 1.5], ['florist', 1], ['bakery', 1], ['phone', 1], ['keys', 0.6]];
const SKYWAY_POOL: [ShopUse, number][] = [['coffee', 2.5], ['convenience', 1.5], ['phone', 1.2], ['tech', 1.2], ['newsstand', 1], ['pharmacy', 1], ['juice', 1], ['deli', 1], ['bakery', 1], ['florist', 0.8]];

export {inRect, CELL};
