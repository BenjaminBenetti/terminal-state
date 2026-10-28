// Doorway clearance (iteration 07, Lane DW). Pure data (no three.js), shared by generation,
// validation, the renderers and QA.
//
// User feedback (iteration 07): "Some doorways have bars / boards across them … the doorways should
// be free of bars". Walk-through openings — doors between areas, staff doors, stair/passage mouths,
// storefront entries, fare-line lanes, washroom and closet doors — must stay free of decor: no wall
// handrails, sign plates, steel panels or props crossing them. Door frames / lintels above head
// height are part of the opening, and openings meant to be sealed (rolled-down storefront shutters,
// the street-exit grille) are real collision blockers, not walk-through decor.
//
// This module:
//  1. derives every opening's CLEAR VOLUME (`doorClearVolumes`): each lane's width minus the jambs
//     x floor .. min(~2.1 m, below the lintel / stuck shutter) x the wall's depth plus an approach
//     strip on both sides (rails and plates sit a few cm off the wall faces);
//  2. emits the opening-aware decor data the renderers consume — wall handrails along passages
//     (`passageRails`) and stair flights (`flightRailRuns`) broken at openings, sign plate sizes
//     (`signDims`) and the wall-backed sign spot search (`wallSignSpot`);
//  3. gathers every pure-data decor volume (`decorVolumes`: props, sign plates + drop rods, light
//     fixtures + pendant rods, storefront parts, floor decor, passage + stair handrails) and reports
//     intrusions (`doorwayIntrusions` / `doorwayIssues`, part of validateLayout);
//  4. gives prop placement (Lane P2's new props) a clearance API: `blocksDoorway(layout, box)` and
//     the cell mask `doorClearMask(layout)`.

import {CELL, SOLID, type Grid, type Ramp} from './grid';
import type {Door, SignKind, SignPlacement, StationLayout} from './stationTypes';
import {storefrontParts} from './storefronts';
import {apertureOf} from './levelGen';

/** Iteration 08 (Lane A): grid of the level an opening is carved on (the level of its `a` area). */
function doorGrid(layout: StationLayout, d: Door): Grid {
  const lv = d.level ?? layout.areas[d.a]?.level ?? 0;
  return layout.levels?.[lv]?.grid ?? layout.grid;
}

export interface Box3 { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

/** Clearance parameters (metres). */
export const DOOR_CLEAR = {
  /** Clear height above the opening's floor; lower where the lintel / a stuck shutter is lower. */
  height: 2.1,
  /** Kept free below the lintel (door-frame heads are 0.1 m deep). */
  lintel: 0.12,
  /** Jamb / frame allowance at each side of a lane. */
  jamb: 0.1,
  /** Approach strip on each side of the wall (rails, plates and panels sit on the wall faces). */
  approach: 0.5,
  /** Floor finishes (rugs, nosings, thresholds) up to this height are fine. */
  floor: 0.02,
};
export type DoorClearOpts = typeof DOOR_CLEAR;

export type OpeningKind = 'door' | 'staff' | 'arch' | 'fare' | 'shopfront';

export interface DoorClearVolume extends Box3 {
  /** layout.doors index and lane within the opening (fare lines have one lane per gate gap). */
  door: number;
  lane: number;
  kind: OpeningKind;
  /** Areas the opening joins. */
  a: number;
  b: number;
  /** The opening spans X (its wall runs along X; it is walked through along Z). */
  alongX: boolean;
}

/** The opening spans X (one cell thick in Z), else Z. */
export function doorAlongX(d: Door): boolean {
  return d.h === 1 ? true : d.w === 1 ? false : d.w >= d.h;
}

export function openingKind(d: Door): OpeningKind {
  return d.fare ? 'fare' : d.shopfront ? 'shopfront' : d.staff ? 'staff' : d.arch ? 'arch' : 'door';
}

/**
 * Walk lanes of an opening in cells from its start, or null when it is sealed: a closed storefront
 * (rolled-down shutter / grille collision blocker across it). Fare lines: the 1 m gaps between the
 * turnstile cabinets (every third cell). Glazed storefronts: the entry span (the rest is glazing).
 */
export function doorLanes(layout: StationLayout, d: Door): [number, number][] | null {
  const len = doorAlongX(d) ? d.w : d.h;
  if (d.shopfront) {
    const sf = layout.storefronts.find(s => s.unit === d.b);
    if (!sf || sf.shutter === 'closed') return null;
    return sf.glazed ? [[sf.entry[0], sf.entry[1]]] : [[0, len]];
  }
  if (d.fare) {
    const lanes: [number, number][] = [];
    for (let s = 0; s + 2 <= len; s += 3) lanes.push([s, s + 2]);
    return lanes;
  }
  return [[0, len]];
}

/** Floor (max) and clear top (min ceiling) over an opening's cells. */
function doorHeights(g: Grid, d: Door): {floor: number; ceil: number} {
  let floor = -Infinity, ceil = Infinity;
  for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
    if (!g.inBounds(x, y)) continue;
    const i = g.idx(x, y);
    floor = Math.max(floor, g.floorOf(i));
    if (g.hasCeil(i)) ceil = Math.min(ceil, g.ceil[i]);
  }
  if (!Number.isFinite(floor)) floor = 0;
  if (!Number.isFinite(ceil)) ceil = floor + d.height;
  return {floor, ceil};
}

/** Clear volume of every walk-through lane of every opening (sealed openings have none). */
export function doorClearVolumes(layout: StationLayout, o: DoorClearOpts = DOOR_CLEAR): DoorClearVolume[] {
  const out: DoorClearVolume[] = [];
  layout.doors.forEach((d, door) => {
    const lanes = doorLanes(layout, d);
    if (!lanes) return;
    const alongX = doorAlongX(d);
    const {floor, ceil} = doorHeights(doorGrid(layout, d), d);
    const y0 = floor + o.floor, y1 = Math.min(floor + o.height, ceil - o.lintel);
    if (y1 <= y0) return;
    const base = (alongX ? d.x : d.y) * CELL;
    const n0 = (alongX ? d.y : d.x) * CELL - o.approach, n1 = (alongX ? d.y + d.h : d.x + d.w) * CELL + o.approach;
    const kind = openingKind(d);
    lanes.forEach(([c0, c1], lane) => {
      const s0 = base + c0 * CELL + o.jamb, s1 = base + c1 * CELL - o.jamb;
      if (s1 <= s0) return;
      out.push(alongX
        ? {x0: s0, x1: s1, z0: n0, z1: n1, y0, y1, door, lane, kind, a: d.a, b: d.b, alongX}
        : {x0: n0, x1: n1, z0: s0, z1: s1, y0, y1, door, lane, kind, a: d.a, b: d.b, alongX});
    });
  });
  return out;
}

/** Positive overlap of two boxes (more than `eps` on every axis), or null. */
export function boxOverlap(p: Box3, q: Box3, eps = 0.002): Box3 | null {
  const x0 = Math.max(p.x0, q.x0), x1 = Math.min(p.x1, q.x1);
  const y0 = Math.max(p.y0, q.y0), y1 = Math.min(p.y1, q.y1);
  const z0 = Math.max(p.z0, q.z0), z1 = Math.min(p.z1, q.z1);
  if (x1 - x0 <= eps || y1 - y0 <= eps || z1 - z0 <= eps) return null;
  return {x0, y0, z0, x1, y1, z1};
}

// ---------------------------------------------------------------------------------------------
// Clearance API for prop placement

const volumeCache = new WeakMap<StationLayout, {doors: number; vols: DoorClearVolume[]}>();
function cachedVolumes(layout: StationLayout): DoorClearVolume[] {
  const c = volumeCache.get(layout);
  if (c && c.doors === layout.doors.length) return c.vols;
  const vols = doorClearVolumes(layout);
  volumeCache.set(layout, {doors: layout.doors.length, vols});
  return vols;
}

/**
 * The first walk-through clear volume a world box would intrude on, or null when the box keeps
 * every opening clear. For prop placement: pass the prop's footprint box (x/z) and its height
 * span (y). Uses the default DOOR_CLEAR parameters (volumes cached per layout once its doors exist).
 */
export function blocksDoorway(layout: StationLayout, box: Box3): DoorClearVolume | null {
  for (const v of cachedVolumes(layout)) if (boxOverlap(v, box)) return v;
  return null;
}

/** Footprint convenience: a prop at (x, z) with half extents (hx, hz) standing from y to y + h. */
export function propBlocksDoorway(layout: StationLayout, x: number, z: number, hx: number, hz: number, y = 0, h = 2): DoorClearVolume | null {
  return blocksDoorway(layout, {x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y, y1: y + h});
}

/**
 * Grid cells (1) whose footprint touches any clear volume — the cells a floor/wall prop must not
 * occupy (height-agnostic, so conservative). Same indexing as Grid cells.
 */
export function doorClearMask(layout: StationLayout, o: DoorClearOpts = DOOR_CLEAR): Uint8Array {
  const g = layout.grid;
  const mask = new Uint8Array(g.w * g.h);
  for (const v of doorClearVolumes(layout, o)) {
    const cx0 = Math.floor(v.x0 / CELL), cx1 = Math.ceil(v.x1 / CELL) - 1;
    const cy0 = Math.floor(v.z0 / CELL), cy1 = Math.ceil(v.z1 / CELL) - 1;
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) if (g.inBounds(x, y)) mask[g.idx(x, y)] = 1;
  }
  return mask;
}

// ---------------------------------------------------------------------------------------------
// Opening-aware decor data (consumed by the renderers)

/** Gap left between a wall handrail's end and an opening's edge (m). */
const RAIL_GAP = 0.15;
/** Shortest wall handrail piece worth building (m). */
const RAIL_MIN = 0.3;

/**
 * Pieces of [s0, s1] (world metres along a wall) backed by solid wall: `open(c)` tells whether the
 * cell at index c along the wall (behind it) is an opening. Pieces stop RAIL_GAP short of openings.
 */
export function wallBackedRuns(s0: number, s1: number, open: (c: number) => boolean, gap = RAIL_GAP, min = RAIL_MIN): {s0: number; s1: number; cut0: boolean; cut1: boolean}[] {
  const runs: {s0: number; s1: number; cut0: boolean; cut1: boolean}[] = [];
  let a = s0, cutA = false;
  const c0 = Math.floor(s0 / CELL), c1 = Math.ceil(s1 / CELL) - 1;
  for (let c = c0; c <= c1 + 1; c++) {
    const isOpen = c <= c1 && open(c);
    if (!isOpen && c <= c1) continue;
    const b = c <= c1 ? Math.min(s1, c * CELL - gap) : s1;
    if (b - a >= min) runs.push({s0: a, s1: b, cut0: cutA, cut1: c <= c1});
    if (c <= c1) { a = Math.max(a, (c + 1) * CELL + gap); cutA = true; }
  }
  return runs;
}

/** Wall handrail height (top of the rail tube centre) and bracket height in passages (m). */
const PASSAGE_RAIL_Y = 0.92, PASSAGE_POST_Y = 0.86;

/** Rail span (world m along the wall) of a passage wall pair: 0.6 m in from both corners. */
function railSpan(a: WallRect, alongX: boolean): [number, number] {
  return [(alongX ? a.x : a.y) * CELL + 0.6, (alongX ? a.x + a.w : a.y + a.h) * CELL - 0.6];
}

/** Total wall-backed length of a passage's wall pair (N/S when alongX, else W/E). */
function backedLength(g: Grid, a: WallRect, alongX: boolean): number {
  const [s0, s1] = railSpan(a, alongX);
  let total = 0;
  for (const behind of alongX ? [a.y - 1, a.y + a.h] : [a.x - 1, a.x + a.w]) {
    const open = (k: number) => { const [x, y] = alongX ? [k, behind] : [behind, k]; return g.inBounds(x, y) && g.cells[g.idx(x, y)] !== SOLID; };
    for (const r of wallBackedRuns(s0, s1, open)) total += r.s1 - r.s0;
  }
  return total;
}

/**
 * The wall pair of a passage that runs WITH the walking direction (and carries its handrails and
 * wall signs): the long walls, unless they are mostly openings — a stair passage wider than it is
 * long has its full-width mouths in the "long" walls, so its side walls are the other pair.
 * Returns true for the N/S pair (walls along X).
 */
export function passageWallsAlongX(g: Grid, a: WallRect): boolean {
  const long = a.w > a.h;
  return backedLength(g, a, long) >= backedLength(g, a, !long) ? long : !long;
}

/**
 * Steel wall handrails along the side walls of every passage (stair / transfer / escalator
 * passages): rail tube + wall brackets every 1.6 m, broken at every opening in the wall (staff
 * doors, closets, storefront bays) so no rail crosses a doorway, and never along a wall whose
 * openings are the passage mouths. Boxes in world space.
 */
export function passageRails(layout: StationLayout): Box3[] {
  const g = layout.grid;
  const out: Box3[] = [];
  const add = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => out.push({x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2, z0: cz - sz / 2, z1: cz + sz / 2});
  for (const a of layout.areas) {
    if (a.type !== 'passage') continue;
    const alongX = passageWallsAlongX(g, a);
    const [s0, s1] = railSpan(a, alongX);
    const c = (alongX ? a.y + a.h / 2 : a.x + a.w / 2) * CELL;
    const walls: [number, number][] = alongX ? [[a.y * CELL + 0.07, a.y - 1], [(a.y + a.h) * CELL - 0.07, a.y + a.h]] : [[a.x * CELL + 0.07, a.x - 1], [(a.x + a.w) * CELL - 0.07, a.x + a.w]];
    for (const [w, behind] of walls) {
      const out2 = w < c ? -0.025 : 0.025;
      const open = (k: number) => { const [x, y] = alongX ? [k, behind] : [behind, k]; return g.inBounds(x, y) && g.cells[g.idx(x, y)] !== SOLID; };
      for (const r of wallBackedRuns(s0, s1, open)) {
        if (alongX) add((r.s0 + r.s1) / 2, PASSAGE_RAIL_Y, w, r.s1 - r.s0, 0.05, 0.05);
        else add(w, PASSAGE_RAIL_Y, (r.s0 + r.s1) / 2, 0.05, 0.05, r.s1 - r.s0);
        let last = -Infinity;
        for (let t = r.s0 + 0.2; t < r.s1; t += 1.6) {
          last = t;
          if (alongX) add(t, PASSAGE_POST_Y, w + out2, 0.04, 0.1, 0.04); else add(w + out2, PASSAGE_POST_Y, t, 0.04, 0.1, 0.04);
        }
        // A rail cut short by an opening still ends on a bracket.
        if (r.cut1 && r.s1 - last > 0.45) {
          const t = r.s1 - 0.1;
          if (alongX) add(t, PASSAGE_POST_Y, w + out2, 0.04, 0.1, 0.04); else add(w + out2, PASSAGE_POST_Y, t, 0.04, 0.1, 0.04);
        }
      }
    }
  }
  return out;
}

/** Handrail height above a stair's pitch line and its stand-off from the wall face (m). */
export const STAIR_RAIL = {y: 0.9, off: 0.07};

/**
 * Runs (along the ramp axis, world m) of a stair flight's two side walls where a wall handrail
 * can be fixed: side cells that are solid wall, ending 0.15 m short of the flight ends and of any
 * opening in the side wall (so a rail never crosses a doorway or an open join).
 */
export function flightRailRuns(g: Grid, r: Ramp): {side: -1 | 1; s0: number; s1: number}[] {
  const axisX = r.axis === 'x';
  const lo = (axisX ? r.x : r.y) * CELL, hi = lo + (axisX ? r.w : r.h) * CELL;
  const first = axisX ? r.x : r.y;
  const out: {side: -1 | 1; s0: number; s1: number}[] = [];
  for (const side of [-1, 1] as const) {
    const open = (c: number) => {
      const cx = axisX ? c : side < 0 ? r.x - 1 : r.x + r.w, cy = axisX ? (side < 0 ? r.y - 1 : r.y + r.h) : c;
      return c < first || c >= first + (axisX ? r.w : r.h) || g.get(cx, cy) !== SOLID;
    };
    for (const run of wallBackedRuns(lo + 0.15, hi - 0.15, open, 0.15, 0.4)) out.push({side, s0: run.s0, s1: run.s1});
  }
  return out;
}

// --- Signs ------------------------------------------------------------------------------------

/** Sign plate sizes per kind (m); the renderer (world/builder.ts) draws these. */
export const SIGN_SIZE: Readonly<Record<SignKind, {w: number; h: number}>> = {
  station: {w: 1.8, h: 0.38}, exit: {w: 1.2, h: 0.26}, service: {w: 1.2, h: 0.26}, info: {w: 1.4, h: 0.3}, platform: {w: 2.2, h: 0.42},
};

/** Rendered plate size of a sign (a width override widens wayfinding plates a little taller). */
export function signDims(s: Pick<SignPlacement, 'kind' | 'w'>): {w: number; h: number} {
  const size = SIGN_SIZE[s.kind];
  const w = s.w ?? size.w;
  const h = s.w && s.kind !== 'station' && s.kind !== 'platform' ? Math.max(size.h, Math.min(0.34, w * 0.15)) : size.h;
  return {w, h};
}

type WallSide = 'N' | 'S' | 'E' | 'W';
interface WallRect { x: number; y: number; w: number; h: number }

/**
 * Whether a wall plate spanning [t0, t1] (world m along the wall of `area` on `side`) at heights
 * [yb, yt] is backed by wall: every cell behind it is solid rock, or an opening whose lintel face
 * lies below the plate (signs over doors). Plates never float in an opening or past a corner.
 * Iteration 08 (Lane A): a cell that is closed on this level but is an APERTURE (a light well: another
 * level's band rises through it, gen/levelGen.ts) is open air, not wall. Heights are absolute.
 */
export function wallBacked(g: Grid, area: WallRect, side: WallSide, t0: number, t1: number, yb: number): boolean {
  const alongX = side === 'N' || side === 'S';
  const lo = alongX ? area.x : area.y, hi = lo + (alongX ? area.w : area.h);
  const behind = side === 'N' ? area.y - 1 : side === 'S' ? area.y + area.h : side === 'W' ? area.x - 1 : area.x + area.w;
  const c0 = Math.floor(t0 / CELL + 1e-6), c1 = Math.ceil(t1 / CELL - 1e-6) - 1;
  if (c0 < lo || c1 >= hi) return false;
  const ap = apertureOf(g);
  for (let c = c0; c <= c1; c++) {
    const [x, y] = alongX ? [c, behind] : [behind, c];
    if (!g.inBounds(x, y)) continue;
    const i = g.idx(x, y);
    if (g.cells[i] === SOLID) { if (ap?.[i]) return false; continue; }
    // An opening: only the lintel face above it (when lower than the plate) can carry the plate.
    if (g.hasCeil(i) && yb >= g.ceil[i] + 0.02) continue;
    return false;
  }
  return true;
}

/**
 * Position along the wall (world m) for a wall sign centred at `t` and height `y`: `t` itself when
 * the plate is wall-backed, else the nearest wall-backed spot (deterministic 0.25 m search, no
 * RNG), or null when the wall has none.
 */
export function wallSignSpot(g: Grid, area: WallRect, side: WallSide, t: number, y: number, dims: {w: number; h: number}): number | null {
  const margin = 0.05;
  const half = dims.w / 2 + margin, yb = y - dims.h / 2;
  const alongX = side === 'N' || side === 'S';
  const lo = (alongX ? area.x : area.y) * CELL + half, hi = (alongX ? area.x + area.w : area.y + area.h) * CELL - half;
  if (hi < lo) return null;
  const ok = (q: number) => q >= lo - 1e-6 && q <= hi + 1e-6 && wallBacked(g, area, side, q - half, q + half, yb);
  if (ok(t)) return t;
  const start = Math.min(hi, Math.max(lo, t));
  if (ok(start)) return start;
  for (let k = 1, n = Math.ceil((hi - lo) / 0.25) + 1; k <= n; k++) {
    for (const q of [start + k * 0.25, start - k * 0.25]) if (ok(q)) return Math.round(q * 1000) / 1000;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Decor volumes + intrusion check

export type DecorSource = 'prop' | 'sign' | 'signRod' | 'light' | 'lightRod' | 'storefront' | 'decor' | 'passageRail' | 'stairRail';
export interface DecorVolume extends Box3 { source: DecorSource; ref: string }

/** Ceiling-hung light fixture size (world/materials.ts `fixture`) incl. the emissive tube below. */
const FIXTURE = {w: 1.2, h: 0.19 + 0.03, d: 0.18};

function rotatedBox(x: number, z: number, rot: number, w: number, d: number, y0: number, y1: number, front = 0): Box3 {
  // Local X = width, local +Z = facing; `front` shifts the box centre along local +Z.
  const c = Math.cos(rot), s = Math.sin(rot);
  const cx = x + s * front, cz = z + c * front;
  const hx = Math.abs(c) * w / 2 + Math.abs(s) * d / 2, hz = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
  return {x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz, y0, y1};
}

function rod(x: number, z: number, y0: number, y1: number, t = 0.015): Box3 {
  return {x0: x - t / 2, x1: x + t / 2, z0: z - t / 2, z1: z + t / 2, y0, y1};
}

/**
 * Every pure-data decor volume of a layout that could stand in an opening: props, sign plates and
 * hanging-sign rods, light fixtures and pendant rods, storefront parts, floor decor, passage and
 * stair handrails. (Door frames/lintels are the openings themselves; track-bed parts, ladders and
 * underpass beams never sit in a doorway.)
 */
export function decorVolumes(layout: StationLayout): DecorVolume[] {
  const g = layout.grid;
  const out: DecorVolume[] = [];
  const push = (b: Box3, source: DecorSource, ref: string) => out.push({...b, source, ref});
  layout.props.forEach((p, i) => push({x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz, y0: p.y, y1: p.y + p.h}, 'prop', `${p.kind}#${i}`));
  layout.signs.forEach((s, i) => {
    const {w, h} = signDims(s);
    const ref = `${s.kind}:${s.text}#${i}`;
    if (s.hang) {
      push(rotatedBox(s.x, s.z, s.rot, w, 0.035, s.y - h / 2, s.y + h / 2), 'sign', ref);
      const ceil = layout.areas[s.area]?.ceil ?? s.y + 1;
      if (ceil - (s.y + h / 2) > 0.05) {
        const ax = Math.cos(s.rot) * w * 0.38, az = -Math.sin(s.rot) * w * 0.38;
        for (const k of [-1, 1]) push(rod(s.x + ax * k, s.z + az * k, s.y + h / 2, ceil), 'signRod', ref);
      }
    } else push(rotatedBox(s.x, s.z, s.rot, w, 0.06, s.y - h / 2, s.y + h / 2, 0.03), 'sign', ref);
  });
  layout.lights.forEach((l, i) => {
    push(rotatedBox(l.x, l.z, l.rot, FIXTURE.w, FIXTURE.d, l.y - FIXTURE.h, l.y), 'light', `light#${i}`);
    // Iteration 08 (Lane A): the rod reaches the ceiling of the fixture's own level.
    const lg = layout.levels?.[l.level ?? layout.areas[l.area]?.level ?? 0]?.grid ?? g;
    const local = lg.ceilAt(l.x, l.z);
    const ceil = Math.min(layout.areas[l.area]?.ceil ?? l.y, Number.isFinite(local) ? local : Infinity);
    if (ceil - l.y >= 0.1) {
      const ax = Math.cos(l.rot) * 0.45, az = -Math.sin(l.rot) * 0.45;
      for (const k of [-1, 1]) push(rod(l.x + ax * k, l.z + az * k, l.y, ceil), 'lightRod', `light#${i}`);
    }
  });
  for (const sf of layout.storefronts) {
    storefrontParts(layout, sf).boxes.forEach((b, i) => push(b, 'storefront', `${sf.name}:${b.m}#${i}`));
  }
  layout.decor.forEach((b, i) => push(b, 'decor', `${b.m}#${i}`));
  passageRails(layout).forEach((b, i) => push(b, 'passageRail', `rail#${i}`));
  for (const r of g.ramps) {
    const axisX = r.axis === 'x';
    const a0 = (axisX ? r.y : r.x) * CELL, a1 = a0 + (axisX ? r.h : r.w) * CELL;
    const H = (s: number) => r.h0 + (r.h1 - r.h0) * Math.min(1, Math.max(0, (s - r.s0) / (r.s1 - r.s0)));
    for (const run of flightRailRuns(g, r)) {
      const across = run.side < 0 ? a0 + STAIR_RAIL.off : a1 - STAIR_RAIL.off;
      const yA = H(run.s0) + STAIR_RAIL.y, yB = H(run.s1) + STAIR_RAIL.y;
      const b: Box3 = axisX
        ? {x0: run.s0, x1: run.s1, z0: across - 0.03, z1: across + 0.03, y0: Math.min(yA, yB) - 0.07, y1: Math.max(yA, yB) + 0.03}
        : {x0: across - 0.03, x1: across + 0.03, z0: run.s0, z1: run.s1, y0: Math.min(yA, yB) - 0.07, y1: Math.max(yA, yB) + 0.03};
      push(b, 'stairRail', `ramp${g.ramps.indexOf(r)}:${run.side}`);
    }
  }
  return out;
}

export interface DoorwayIntrusion {
  door: number;
  lane: number;
  kind: OpeningKind;
  source: DecorSource;
  ref: string;
  overlap: Box3;
}

/** Decor volumes intersecting any walk-through clear volume (empty = every opening is clear). */
export function doorwayIntrusions(layout: StationLayout, o: DoorClearOpts = DOOR_CLEAR): DoorwayIntrusion[] {
  const vols = doorClearVolumes(layout, o);
  if (!vols.length) return [];
  // Bucket the clear volumes on a coarse XZ grid (4 m) so the check stays cheap with many props.
  const B = 4;
  const buckets = new Map<number, number[]>();
  const key = (bx: number, bz: number) => bx * 4096 + bz;
  vols.forEach((v, i) => {
    for (let bx = Math.floor(v.x0 / B); bx <= Math.floor(v.x1 / B); bx++) for (let bz = Math.floor(v.z0 / B); bz <= Math.floor(v.z1 / B); bz++) {
      let l = buckets.get(key(bx, bz));
      if (!l) buckets.set(key(bx, bz), (l = []));
      l.push(i);
    }
  });
  const out: DoorwayIntrusion[] = [];
  const seen = new Set<number>();
  for (const d of decorVolumes(layout)) {
    seen.clear();
    for (let bx = Math.floor(d.x0 / B); bx <= Math.floor(d.x1 / B); bx++) for (let bz = Math.floor(d.z0 / B); bz <= Math.floor(d.z1 / B); bz++) {
      for (const i of buckets.get(key(bx, bz)) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const v = vols[i];
        const overlap = boxOverlap(v, d);
        if (overlap) out.push({door: v.door, lane: v.lane, kind: v.kind, source: d.source, ref: d.ref, overlap});
      }
    }
  }
  return out;
}

/** Validation strings (validateLayout / tests). */
export function doorwayIssues(layout: StationLayout): string[] {
  return doorwayIntrusions(layout).map(x => `doorway ${x.door} (${x.kind}) crossed by ${x.source} ${x.ref}`);
}

/** Compact QA summary: openings by kind, sealed openings and intrusions. */
export function doorwaySummary(layout: StationLayout) {
  const vols = doorClearVolumes(layout);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const kinds: Record<string, number> = {};
  for (const d of layout.doors) kinds[openingKind(d)] = (kinds[openingKind(d)] ?? 0) + 1;
  return {
    openings: layout.doors.length,
    kinds,
    sealed: layout.doors.map((d, i) => (doorLanes(layout, d) ? -1 : i)).filter(i => i >= 0),
    lanes: vols.map(v => ({door: v.door, lane: v.lane, kind: v.kind, a: layout.areas[v.a]?.label, b: layout.areas[v.b]?.label,
      x: r2((v.x0 + v.x1) / 2), z: r2((v.z0 + v.z1) / 2), y0: r2(v.y0), y1: r2(v.y1), width: r2(v.alongX ? v.x1 - v.x0 : v.z1 - v.z0)})),
    intrusions: doorwayIntrusions(layout).map(x => ({door: x.door, lane: x.lane, kind: x.kind, source: x.source, ref: x.ref})),
  };
}
