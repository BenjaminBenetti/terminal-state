// Iteration 16 (lane TOWER): shared pieces of the office tower runtime — the normalised `layout.office` contract
// (design.md OfficeSectionInfo, WORLD-GEN), section names, the 2D body constraints the elevator doors / windows use
// (side-memory gates: no tunnelling through a thin door at sprint speed), ray-box targeting and small helpers.
// Pure (no three.js scene work) so the logic is unit-testable.

import {CELL, SOLID, type Grid} from '../gen/grid';

export type Side = 'N' | 'S' | 'E' | 'W';
export interface Rect2 { x0: number; z0: number; x1: number; z1: number }
export interface P3 { x: number; y: number; z: number }

export interface ElevatorInfo {
  /** Cab interior (world metres, x0 < x1, z0 < z1). */
  cab: Rect2;
  doorSide: Side;
  /** Centre of the door opening ON the cab edge of doorSide, and its clear width. */
  door: {x: number; z: number; width: number};
  /** Floor panel inside the cab / call panel outside (absolute y). */
  panel: P3;
  callPanel: P3;
  /** Cab floor (absolute y). */
  floorY: number;
}

export interface StairDoorInfo { dir: 'up' | 'down'; x: number; z: number; yaw: number; toFloor: number }
/** kind 'entrance' = the lobby's street doors (sill 0): boarded up (scenery only; the wall cells are solid). */
export interface WindowSpan extends Rect2 { side: Side; sill: number; head: number; kind?: 'window' | 'entrance' }

/** The office part of a section layout, normalised (TOWER's view of design.md OfficeSectionInfo). */
export interface TowerInfo {
  /** 1 = lobby (street section), 2..N = office floors. */
  floor: number;
  floors: number[];
  floorHeight: number;
  /** layout.levels index of the office storey. */
  levelId: number;
  /** Floor (absolute y) of the office storey. */
  baseY: number;
  elevator: ElevatorInfo | null;
  stairDoors: StairDoorInfo[];
  windows: WindowSpan[];
  /** Tower footprint (outer wall faces). */
  exterior: Rect2;
  /** Street level (absolute y) seen from this storey: baseY - floorHeight * (floor - 1). */
  groundY: number;
  seed: number;
  /** Tower name (signs / HUD), when WORLD-GEN provides one. */
  name: string;
}

/** Office section name of a tower floor (floor 1 = the lobby, the upper storey of the 'street' section). */
export function sectionForFloor(floor: number): string {
  return floor <= 1 ? 'street' : `floor-${floor}`;
}

/** Tower floor of an office section name (null for anything else). */
export function floorOfSection(section: string): number | null {
  if (section === 'street') return 1;
  const m = /^floor-(\d+)$/.exec(section);
  return m ? Number(m[1]) : null;
}

/** Floor label for panels / lists ("L" for the lobby). */
export const floorLabel = (f: number): string => (f <= 1 ? 'L' : String(f));

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
}

/** Reads and validates `layout.office` (null when the section is not part of the office tower). */
export function readTowerInfo(layout: TowerLayoutLike): TowerInfo | null {
  const o = layout.office as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object') return null;
  const floor = Math.max(1, Math.round(num(o.floor, 1)));
  const floors = Array.isArray(o.floors) && o.floors.length ? (o.floors as unknown[]).map(f => Math.round(num(f, 1))).filter((f, i, a) => a.indexOf(f) === i).sort((a, b) => a - b) : [1, floor];
  if (!floors.includes(floor)) floors.push(floor), floors.sort((a, b) => a - b);
  const levelId = Math.max(0, Math.round(num(o.levelId, 0)));
  const lv = layout.levels?.find(l => l.id === levelId) ?? layout.levels?.[levelId];
  const baseY = num(o.baseY, lv ? lv.baseY : 0);
  const floorHeight = Math.max(2.5, num(o.floorHeight, 3.8));
  let elevator: ElevatorInfo | null = null;
  const e = o.elevator as Record<string, unknown> | undefined;
  const cab = e ? normRect(e.cab) : null;
  if (e && cab && isSide(e.doorSide)) {
    const d = (e.door ?? {}) as Record<string, unknown>;
    const cx = (cab.x0 + cab.x1) / 2, cz = (cab.z0 + cab.z1) / 2;
    const floorY = num(e.floorY, baseY);
    const [nx, nz] = sideNormal(e.doorSide);
    const edge = {x: nx > 0 ? cab.x1 : nx < 0 ? cab.x0 : cx, z: nz > 0 ? cab.z1 : nz < 0 ? cab.z0 : cz};
    elevator = {
      cab, doorSide: e.doorSide, floorY,
      door: {x: num(d.x, edge.x), z: num(d.z, edge.z), width: Math.max(0.8, num(d.width, 1.1))},
      panel: p3(e.panel, {x: cx, y: floorY + 1.2, z: cz}),
      callPanel: p3(e.callPanel, {x: edge.x + nx * 0.6, y: floorY + 1.2, z: edge.z + nz * 0.6}),
    };
  }
  const stairDoors: StairDoorInfo[] = Array.isArray(o.stairDoors) ? (o.stairDoors as Record<string, unknown>[]).flatMap(s => {
    if (!s || (s.dir !== 'up' && s.dir !== 'down')) return [];
    const x = num(s.x, NaN), z = num(s.z, NaN), toFloor = Math.round(num(s.toFloor, NaN));
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(toFloor)) return [];
    return [{dir: s.dir, x, z, yaw: num(s.yaw, 0), toFloor}];
  }) : [];
  const windows: WindowSpan[] = Array.isArray(o.windows) ? (o.windows as Record<string, unknown>[]).flatMap(w => {
    const r = normRect(w);
    if (!r || !isSide(w.side)) return [];
    const sill = num(w.sill, 0.9), head = num(w.head, 2.4);
    if (head <= sill + 0.2) return [];
    return [{...r, side: w.side, sill, head, kind: w.kind === 'entrance' ? 'entrance' as const : 'window' as const}];
  }) : [];
  const exterior = normRect(o.exterior) ?? boundsOf(layout.grid, windows, cab);
  return {floor, floors, floorHeight, levelId, baseY, elevator, stairDoors, windows, exterior, groundY: baseY - floorHeight * (floor - 1), seed: layout.seed >>> 0, name: typeof o.name === 'string' ? o.name : ''};
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

/** Window y range (absolute): sill / head are heights above the storey floor. */
export function windowYs(w: WindowSpan, baseY: number): [number, number] {
  return [baseY + w.sill, baseY + w.head];
}

// ---------------------------------------------------------------------------------------------
// Grid probes

/** True when world (x, z) lies in a SOLID (wall) cell of `g` (outside the grid counts as solid). */
export function solidAt(g: Grid, x: number, z: number): boolean {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  return !g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] === SOLID;
}

/**
 * The room-facing normal of a wall point (x, z) (e.g. a panel or a door on a wall face): the axis direction whose
 * probe at `probe` m is solid while the opposite one is open, preferring the one with the nearest wall. null when
 * the point is not next to a wall.
 */
export function wallNormalAt(g: Grid, x: number, z: number, probe = 0.35): [number, number] | null {
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best: [number, number] | null = null, bestD = Infinity;
  for (const [dx, dz] of dirs) {
    for (let k = 1; k <= 4; k++) {
      const d = probe * k / 4;
      if (solidAt(g, x + dx * d, z + dz * d)) {
        if (d < bestD && !solidAt(g, x - dx * 0.2, z - dz * 0.2)) { bestD = d; best = [-dx || 0, -dz || 0]; }
        break;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Constraints (applied AFTER a body's own grid/prop collision in a frame hook)

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

export type GateSide = 'in' | 'out';

/** Local gate coordinates of (x, z): s along the normal, l along the opening. */
export function gateLocal(g: DoorGate, x: number, z: number): [number, number] {
  const dx = x - g.cx, dz = z - g.cz;
  return [dx * g.nx + dz * g.nz, dx * g.tx + dz * g.tz];
}

export function gateSideOf(g: DoorGate, x: number, z: number): GateSide {
  return gateLocal(g, x, z)[0] < g.depth * 0.5 ? 'in' : 'out';
}

/** Margin (m) a closed gate keeps a body clear of the door planes (so a pushed-back body is not "in the doorway"). */
export const GATE_CLEAR = 0.02;

/**
 * A body (radius r) stands in the doorway: its centre within 0.4 r of the door planes or between them (a body merely
 * touching the doors from inside the cab does not hold them; the gate pushes it clear as the gap narrows).
 */
export function inDoorway(g: DoorGate, x: number, z: number, r: number): boolean {
  const [s, l] = gateLocal(g, x, z);
  return s > -r * 0.4 && s < g.depth + r * 0.4 && Math.abs(l) < g.hw;
}

/**
 * Keep a body on its side of a (partly) closed doorway. `open` = 0 closed … 1 fully open (the gap is centred).
 * `side` = the side the body was on before this move. Returns the corrected position, the side after the move and
 * whether it was pushed (moving into the doors).
 */
export function constrainGate(g: DoorGate, open: number, x: number, z: number, r: number, side: GateSide): {x: number; z: number; side: GateSide; pushed: boolean} {
  let [s, l] = gateLocal(g, x, z);
  const halfGap = g.hw * Math.max(0, Math.min(1, open)) - r;
  const inBand = s > -r && s < g.depth + r;
  let pushed = false;
  if (Math.abs(l) < g.hw + r && inBand) {
    if (halfGap >= 0.02) {
      // the gap admits the body: keep it between the door edges (the doors re-open long before this squeezes)
      if (Math.abs(l) > halfGap && s > -r * 0.5 && s < g.depth + r * 0.5) { l = Math.sign(l) * halfGap; pushed = true; }
    } else if (side === 'in') {
      if (s > -r - GATE_CLEAR) { s = -r - GATE_CLEAR; pushed = true; }
    } else if (s < g.depth + r + GATE_CLEAR) { s = g.depth + r + GATE_CLEAR; pushed = true; }
  }
  const nx = g.cx + g.nx * s + g.tx * l, nz = g.cz + g.nz * s + g.tz * l;
  const out = s < -r * 0.25 ? 'in' : s > g.depth + r * 0.25 ? 'out' : side;
  return {x: nx, z: nz, side: out, pushed};
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

/** Ray (o, unit d) vs axis-aligned box: entry distance (0 when inside) or null. */
export function rayBox(o: P3, d: P3, b: Box3Like, maxT = Infinity): number | null {
  let t0 = 0, t1 = maxT;
  for (const k of ['x', 'y', 'z'] as const) {
    const inv = 1 / (Math.abs(d[k]) < 1e-9 ? (d[k] < 0 ? -1e-9 : 1e-9) : d[k]);
    let a = (b.min[k] - o[k]) * inv, c = (b.max[k] - o[k]) * inv;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

/** A box around a wall-mounted point (centre p, room-facing normal (nx, nz)): w wide, h tall, d deep. */
export function wallBox(p: P3, n: [number, number], w: number, h: number, d: number): Box3Like {
  const [nx, nz] = n;
  const hx = Math.abs(nx) > 0.5 ? d / 2 : w / 2, hz = Math.abs(nx) > 0.5 ? w / 2 : d / 2;
  const cx = p.x + nx * d / 2, cz = p.z + nz * d / 2;
  return {min: {x: cx - hx, y: p.y - h / 2, z: cz - hz}, max: {x: cx + hx, y: p.y + h / 2, z: cz + hz}};
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
