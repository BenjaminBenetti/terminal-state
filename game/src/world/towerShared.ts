// Office tower runtime shared pieces (task office-seamless-20261029, lane LIFT; iteration 16 lane TOWER before it): the
// normalised `layout.office` v2 contract (gen/stationTypes.ts OfficeTowerInfo, lane GEN — ONE continuous Office Space
// world: levels[0] station, levels[1] lobby, levels[2..8] office floors, levelId === floor), the doorway gate geometry the
// elevator uses, window push-out, ray-box targeting and small helpers. Pure (no three.js scene work): unit-testable.

import {CELL, SOLID, type Grid} from '../gen/grid';
import {mallTowerRecord} from '../gen/mall/elevator'; // Task track3-eaton-centre-20261031 (lane GEN): the mall's glass elevator

export type Side = 'N' | 'S' | 'E' | 'W';
export interface Rect2 { x0: number; z0: number; x1: number; z1: number }
export interface P3 { x: number; y: number; z: number }

/** One elevator stop (cab floor level with a storey). */
export interface StopInfo {
  floor: number;
  /** layout.levels index of the storey (=== floor in the tower). */
  levelId: number;
  /** Cab floor at this stop (absolute y) = the storey's baseY. */
  y: number;
  /** Landing strip area id on that storey (-1 unknown). */
  area: number;
  /** Short stop label on buttons / indicators: the storey's authored label (Office 'L' / '2'..'8'; mall 'S' / '1'..'3'). */
  label: string;
  /** Task mall-round2-20261031 (lane RUNTIME, M02): the storey's long name for prompts when authored (mall 'Subway' / 'Level 1'). */
  name?: string;
  /** Call panel on the landing wall beside the door (absolute y). */
  callPanel: P3;
  /** Walkable stand point just outside the door. */
  landing: {x: number; z: number};
}

export interface ElevatorInfo {
  /** Cab interior footprint (world m; SOLID shaft cells on every storey grid — the cab is a Levels dynamic volume). */
  cab: Rect2;
  /** Shaft outer box incl. its walls. */
  shaft: Rect2;
  doorSide: Side;
  /** Opening centre ON the cab edge of doorSide and its clear width (same X/Z at every stop). */
  door: {x: number; z: number; width: number};
  /** Interior clear height of the cab (m). */
  cabHeight: number;
  /** Floor panel inside the cab (door wall's inner face); dy above the cab floor. */
  panel: {x: number; dy: number; z: number};
  /** Stops, bottom-up. */
  stops: StopInfo[];
}

export interface StoreyInfo { floor: number; levelId: number; baseY: number; label: string; clear: number; name?: string }

/** kind 'entrance' = the lobby's street doors (sill 0): boarded up (scenery only; the wall cells are solid). */
export interface WindowSpan extends Rect2 {
  side: Side;
  /** Sill / head above `baseY`. */
  sill: number;
  head: number;
  kind?: 'window' | 'entrance';
  /** Storey (layout.levels index) and its floor (absolute y). */
  level: number;
  baseY: number;
}

/** LIFT's view of layout.office (v2, normalised). */
export interface TowerInfo {
  floors: number[];
  floorHeight: number;
  /** Street / lobby floor (absolute y): the exterior ground. */
  groundY: number;
  storeys: StoreyInfo[];
  elevator: ElevatorInfo | null;
  windows: WindowSpan[];
  /** Tower footprint (outer wall faces). */
  exterior: Rect2;
  stairs: {well: Rect2 | null; landings: {floor: number; levelId: number; x: number; z: number}[]};
  seed: number;
  name: string;
}

/** Floor label for panels / lists ("L" for the lobby): the Office numbering, the fallback for a record without storey labels. */
export const floorLabel = (f: number): string => (f <= 1 ? 'L' : String(f));

/**
 * Task mall-round2-20261031 (lane RUNTIME, M02): the display label of stop `floor` from the record's own stops (readTowerInfo keeps
 * each storey's authored label: the Office 'L' / '2'..'8', the mall 'S' (station) / '1'..'3'), else the floorLabel numbering.
 * Every elevator label consumer (cab / hall buttons, ids, indicator, prompts, QA) goes through the stop labels, never floorLabel
 * alone: on the mall floors 0 and 1 both read 'L' ("two lobby levels"). Allocation-free (per-frame indicator).
 */
export function stopLabel(stops: readonly {floor: number; label: string}[], floor: number): string {
  for (const s of stops) if (s.floor === floor) return s.label;
  return floorLabel(floor);
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isSide = (v: unknown): v is Side => v === 'N' || v === 'S' || v === 'E' || v === 'W';

export function normRect(r: unknown): Rect2 | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const x0 = num(o.x0, NaN), z0 = num(o.z0, NaN), x1 = num(o.x1, NaN), z1 = num(o.z1, NaN);
  if (![x0, z0, x1, z1].every(Number.isFinite)) return null;
  return {x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1)};
}

function p3(v: unknown, fallback: P3): P3 {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {x: num(o.x, fallback.x), y: num(o.y, fallback.y), z: num(o.z, fallback.z)};
}

/** Outward unit normal (x, z) of a side (N = -z, S = +z, W = -x, E = +x; gen/storefronts.ts convention). */
export function sideNormal(s: Side): [number, number] {
  return s === 'N' ? [0, -1] : s === 'S' ? [0, 1] : s === 'W' ? [-1, 0] : [1, 0];
}

/** Minimal shape of a layout this module reads (StationLayout satisfies it). */
export interface TowerLayoutLike {
  seed: number;
  grid: Grid;
  levels?: readonly {id: number; baseY: number; grid: Grid}[];
  office?: unknown;
  /** Task track3-eaton-centre-20261031 (lane GEN): The Eaton's Center record (its glass elevator rides the same runtime). */
  mall?: unknown;
}

/**
 * Reads and validates `layout.office` v2 (null when the layout has no office tower: the Subway). Task track3-eaton-centre-20261031
 * (lane GEN): a mall layout (no office record) yields its glass elevator in the same v2 shape (gen/mall/elevator.ts; no windows).
 */
export function readTowerInfo(layout: TowerLayoutLike): TowerInfo | null {
  const o = (layout.office ?? (layout.mall ? mallTowerRecord(layout as unknown as Parameters<typeof mallTowerRecord>[0]) : undefined)) as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object') return null;
  const lv = (id: number) => layout.levels?.find(l => l.id === id) ?? layout.levels?.[id];
  const floorHeight = Math.max(2.5, num(o.floorHeight, 4.4));
  // storeys: the contract's list, else one per floor on layout.levels[floor]
  const rawFloors = Array.isArray(o.floors) && o.floors.length ? (o.floors as unknown[]).map(f => Math.round(num(f, 1))) : [];
  let storeys: StoreyInfo[] = Array.isArray(o.storeys) ? (o.storeys as Record<string, unknown>[]).flatMap(s => {
    if (!s || typeof s !== 'object') return [];
    const floor = Math.round(num(s.floor, NaN));
    if (!Number.isFinite(floor)) return [];
    const levelId = Math.round(num(s.levelId, floor));
    const baseY = num(s.baseY, lv(levelId)?.baseY ?? 0);
    return [{floor, levelId, baseY, label: typeof s.label === 'string' ? s.label : floorLabel(floor), clear: num(s.clear, floor <= 1 ? 4 : 2.9),
      ...(typeof s.name === 'string' ? {name: s.name} : {})}];
  }) : [];
  if (!storeys.length) {
    const fl = rawFloors.length ? rawFloors : (layout.levels ?? []).map(l => l.id).filter(id => id >= 1);
    storeys = fl.map(f => ({floor: f, levelId: f, baseY: lv(f)?.baseY ?? 0, label: floorLabel(f), clear: f <= 1 ? 4 : 2.9}));
  }
  storeys.sort((a, b) => a.baseY - b.baseY);
  const floors = (rawFloors.length ? rawFloors : storeys.map(s => s.floor)).filter((f, i, a) => a.indexOf(f) === i).sort((a, b) => a - b);
  const storeyOf = (floor: number) => storeys.find(s => s.floor === floor);
  const groundY = num(o.groundY, storeys[0]?.baseY ?? 0);
  // elevator
  let elevator: ElevatorInfo | null = null;
  const e = o.elevator as Record<string, unknown> | undefined;
  const cab = e ? normRect(e.cab) : null;
  if (e && cab && isSide(e.doorSide)) {
    const [nx, nz] = sideNormal(e.doorSide);
    const cx = (cab.x0 + cab.x1) / 2, cz = (cab.z0 + cab.z1) / 2;
    const edge = {x: nx > 0 ? cab.x1 : nx < 0 ? cab.x0 : cx, z: nz > 0 ? cab.z1 : nz < 0 ? cab.z0 : cz};
    const d = (e.door ?? {}) as Record<string, unknown>;
    const door = {x: num(d.x, edge.x), z: num(d.z, edge.z), width: Math.max(0.8, num(d.width, 1.5))};
    const shaft = normRect(e.shaft) ?? {x0: cab.x0 - CELL, z0: cab.z0 - CELL, x1: cab.x1 + CELL, z1: cab.z1 + CELL};
    const pn = (e.panel ?? {}) as Record<string, unknown>;
    const panel = {x: num(pn.x, door.x + (nz !== 0 ? door.width / 2 + 0.3 : 0)), dy: num(pn.dy, 1.2), z: num(pn.z, door.z + (nx !== 0 ? door.width / 2 + 0.3 : 0))};
    const depth = Math.max(0.1, nx > 0 ? shaft.x1 - cab.x1 : nx < 0 ? cab.x0 - shaft.x0 : nz > 0 ? shaft.z1 - cab.z1 : cab.z0 - shaft.z0);
    const rawStops = Array.isArray(e.stops) && e.stops.length ? (e.stops as Record<string, unknown>[]) : storeys.map(s => ({floor: s.floor} as Record<string, unknown>));
    const stops: StopInfo[] = rawStops.flatMap(s => {
      if (!s || typeof s !== 'object') return [];
      const floor = Math.round(num(s.floor, NaN));
      if (!Number.isFinite(floor)) return [];
      const st = storeyOf(floor);
      const levelId = Math.round(num(s.levelId, st?.levelId ?? floor));
      const y = num(s.y, st?.baseY ?? lv(levelId)?.baseY ?? 0);
      const out = {x: door.x + nx * (depth + 1), z: door.z + nz * (depth + 1)};
      return [{
        floor, levelId, y, area: Math.round(num(s.area, -1)), label: st?.label ?? floorLabel(floor), ...(st?.name ? {name: st.name} : {}),
        callPanel: p3(s.callPanel, {x: door.x + nx * depth + (nz !== 0 ? door.width / 2 + 0.35 : 0), y: y + 1.2, z: door.z + nz * depth + (nx !== 0 ? door.width / 2 + 0.35 : 0)}),
        landing: {x: num((s.landing as Record<string, unknown> | undefined)?.x, out.x), z: num((s.landing as Record<string, unknown> | undefined)?.z, out.z)},
      }];
    }).sort((a, b) => a.y - b.y);
    if (stops.length) elevator = {cab, shaft, doorSide: e.doorSide, door, cabHeight: Math.max(2.2, num(e.cabHeight, 2.6)), panel, stops};
  }
  // windows: every span of every storey (sill / head relative to its own storey floor)
  const windows: WindowSpan[] = Array.isArray(o.windows) ? (o.windows as Record<string, unknown>[]).flatMap(w => {
    const r = normRect(w);
    if (!r || !isSide(w.side)) return [];
    const sill = num(w.sill, 0.9), head = num(w.head, 2.4);
    if (head <= sill + 0.2) return [];
    const level = Math.round(num(w.level, storeys[0]?.levelId ?? 0));
    const baseY = num(w.baseY, lv(level)?.baseY ?? storeys.find(s => s.levelId === level)?.baseY ?? 0);
    return [{...r, side: w.side, sill, head, kind: w.kind === 'entrance' ? 'entrance' as const : 'window' as const, level, baseY}];
  }) : [];
  const exterior = normRect(o.exterior) ?? boundsOf(layout.grid, windows, cab);
  const st = (o.stairs ?? {}) as Record<string, unknown>;
  const landings = Array.isArray(st.landings) ? (st.landings as Record<string, unknown>[]).flatMap(l => {
    const floor = Math.round(num(l?.floor, NaN)), x = num(l?.x, NaN), z = num(l?.z, NaN);
    return Number.isFinite(floor) && Number.isFinite(x) && Number.isFinite(z) ? [{floor, levelId: Math.round(num(l.levelId, floor)), x, z}] : [];
  }) : [];
  return {
    floors, floorHeight, groundY, storeys, elevator, windows, exterior, stairs: {well: normRect(st.well), landings},
    seed: layout.seed >>> 0, name: typeof o.name === 'string' ? o.name : '',
  };
}

/** Fallback footprint: the window spans' (or the grid's) bounds. */
function boundsOf(grid: Grid, windows: readonly WindowSpan[], cab: Rect2 | null): Rect2 {
  if (windows.length) {
    const r = {x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity};
    for (const w of windows) { r.x0 = Math.min(r.x0, w.x0); r.z0 = Math.min(r.z0, w.z0); r.x1 = Math.max(r.x1, w.x1); r.z1 = Math.max(r.z1, w.z1); }
    return r;
  }
  if (cab) return {x0: cab.x0 - 20, z0: cab.z0 - 20, x1: cab.x1 + 20, z1: cab.z1 + 20};
  return {x0: 0, z0: 0, x1: grid.w * CELL, z1: grid.h * CELL};
}

/** Window y range (absolute): sill / head above the span's own storey floor. */
export function windowYs(w: WindowSpan): [number, number] {
  return [w.baseY + w.sill, w.baseY + w.head];
}

// ---------------------------------------------------------------------------------------------
// Grid probes

/** True when world (x, z) lies in a SOLID (wall) cell of `g` (outside the grid counts as solid). */
export function solidAt(g: Grid, x: number, z: number): boolean {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  return !g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] === SOLID;
}

// ---------------------------------------------------------------------------------------------
// The elevator doorway

/** A doorway gate: the cab-side plane at s = 0 (s = distance along the outward normal), the landing plane at s = depth. */
export interface DoorGate {
  cx: number; cz: number;
  /** Outward unit normal (cab -> landing) and tangent (along the opening). */
  nx: number; nz: number; tx: number; tz: number;
  /** Half clear width of the opening. */
  hw: number;
  /** Wall thickness between the cab plane and the landing plane (m). */
  depth: number;
}

/** Local gate coordinates of (x, z): s along the normal, l along the opening. */
export function gateLocal(g: DoorGate, x: number, z: number): [number, number] {
  const dx = x - g.cx, dz = z - g.cz;
  return [dx * g.nx + dz * g.nz, dx * g.tx + dz * g.tz];
}

/** World (x, z) of gate-local (s, l). */
export function gateWorld(g: DoorGate, s: number, l: number): [number, number] {
  return [g.cx + g.nx * s + g.tx * l, g.cz + g.nz * s + g.tz * l];
}

/**
 * A body (radius r) stands in the doorway: its centre within 0.4 r of the door planes or between them (a body merely
 * touching the doors from inside the cab does not hold them).
 */
export function inDoorway(g: DoorGate, x: number, z: number, r: number): boolean {
  const [s, l] = gateLocal(g, x, z);
  return s > -r * 0.4 && s < g.depth + r * 0.4 && Math.abs(l) < g.hw;
}

/** Box (x, z) push-out of a circle, axis-aligned (core/physics.ts pushOutOfBox semantics, with a preferred side). */
export function pushOutRect(x: number, z: number, r: number, b: Rect2, prefer?: [number, number]): [number, number] | null {
  const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
  const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-12 && !prefer) { const d = Math.sqrt(d2); return [x + dx / d * (r - d), z + dz / d * (r - d)]; }
  if (prefer) {
    // always resolve toward the preferred normal (the interior side of a window), never through the box
    const [px, pz] = prefer;
    if (px > 0) return [b.x1 + r, z];
    if (px < 0) return [b.x0 - r, z];
    if (pz > 0) return [x, b.z1 + r];
    return [x, b.z0 - r];
  }
  const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bb = b.z1 - z, m = Math.min(l, rr, t, bb);
  if (m === l) return [b.x0 - r, z];
  if (m === rr) return [b.x1 + r, z];
  if (m === t) return [x, b.z0 - r];
  return [x, b.z1 + r];
}

export const insideRect = (b: Rect2, x: number, z: number, inset = 0): boolean =>
  x > b.x0 + inset && x < b.x1 - inset && z > b.z0 + inset && z < b.z1 - inset;

// ---------------------------------------------------------------------------------------------
// Targeting

export interface Box3Like { min: P3; max: P3 }

/** One slab of rayBox: [t0, t1] narrowed by the slab [mn, mx] along one axis (o, d components); null when it misses. */
function slab(o: number, d: number, mn: number, mx: number, t0: number, t1: number, out: [number, number]): boolean {
  const inv = 1 / (Math.abs(d) < 1e-9 ? (d < 0 ? -1e-9 : 1e-9) : d);
  let a = (mn - o) * inv, c = (mx - o) * inv;
  if (a > c) { const s = a; a = c; c = s; }
  out[0] = Math.max(t0, a); out[1] = Math.min(t1, c);
  return out[0] <= out[1];
}
const slabT: [number, number] = [0, 0];

/**
 * Ray (o, unit d) vs axis-aligned box: entry distance (0 when inside) or null. `dy` lifts the box (task office-overhaul-20261030,
 * lane LIFT: the cab's buttons are planned relative to its floor). Allocation-free (per-frame button picking).
 */
export function rayBox(o: P3, d: P3, b: Box3Like, maxT = Infinity, dy = 0): number | null {
  if (!slab(o.x, d.x, b.min.x, b.max.x, 0, maxT, slabT)) return null;
  if (!slab(o.y, d.y, b.min.y + dy, b.max.y + dy, slabT[0], slabT[1], slabT)) return null;
  if (!slab(o.z, d.z, b.min.z, b.max.z, slabT[0], slabT[1], slabT)) return null;
  return slabT[0];
}

/**
 * Ray (o, unit d) vs a vertical cylinder (centre x / z, radius r, from y0 to y1): the first t in [0, maxT] inside it, or null.
 * Task office-overhaul-20261030 (lane LIFT): a living body in front of an elevator button takes the click (allocation-free).
 */
export function rayCylinder(o: P3, d: P3, cx: number, cz: number, r: number, y0: number, y1: number, maxT: number): number | null {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r;
  let t0: number, t1: number;
  if (a < 1e-12) { if (c > 0) return null; t0 = 0; t1 = maxT; }
  else {
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / a; t1 = (-b + s) / a;
  }
  if (Math.abs(d.y) < 1e-9) { if (o.y < y0 || o.y > y1) return null; }
  else {
    let ya = (y0 - o.y) / d.y, yb = (y1 - o.y) / d.y;
    if (ya > yb) { const k = ya; ya = yb; yb = k; }
    t0 = Math.max(t0, ya); t1 = Math.min(t1, yb);
  }
  t0 = Math.max(t0, 0); t1 = Math.min(t1, maxT);
  return t0 <= t1 ? t0 : null;
}

/** A box around a wall-mounted point (centre p, room-facing normal (nx, nz)): w wide, h tall, d deep. */
export function wallBox(p: P3, n: [number, number], w: number, h: number, d: number): Box3Like {
  const [nx, nz] = n;
  const hx = Math.abs(nx) > 0.5 ? d / 2 : w / 2, hz = Math.abs(nx) > 0.5 ? w / 2 : d / 2;
  const cx = p.x + nx * d / 2, cz = p.z + nz * d / 2;
  return {min: {x: cx - hx, y: p.y - h / 2, z: cz - hz}, max: {x: cx + hx, y: p.y + h / 2, z: cz + hz}};
}

/** A box shifted up by dy (the cab panel: planned relative to the cab floor). */
export function liftBox(b: Box3Like, dy: number): Box3Like {
  return {min: {x: b.min.x, y: b.min.y + dy, z: b.min.z}, max: {x: b.max.x, y: b.max.y + dy, z: b.max.z}};
}

// ---------------------------------------------------------------------------------------------
// Misc

/** Deterministic small hash -> [0, 1). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Plays an EXISTING Sound Lab cue through the game's Sfx (no new audio). Sfx has no public "play any cue" method, so
 * this uses its voice / play internals when present (guarded: a missing method or a muted / unstarted context is a no-op).
 */
export function towerCue(sfx: unknown, cue: string, at?: P3, o: {rate?: number; gain?: number; delay?: number; jitter?: number} = {}): void {
  const s = sfx as {voice?(o: object): unknown; play?(v: unknown, cue: string, o?: object): unknown} | null;
  if (!s || typeof s.voice !== 'function' || typeof s.play !== 'function') return;
  try {
    const v = s.voice({at, send: 0.3, ref: 3, hrtf: !!at});
    if (v) s.play(v, cue, {jitter: 0.02, ...o});
  } catch { /* audio is best-effort */ }
}
