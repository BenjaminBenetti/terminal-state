// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): the v2 DOG-LEG STAIR CORE of a district building — a compact
// open-well stair between its two walkable layout levels (the street storey and the storey above it, or the roof), used by every v2
// ("deep") interior plan (rooms/builder.ts deep mode; rooms/deepStores.ts). v1 never reaches this file (the first release's straight
// Mall-style core stays as it was: tests/surface-v1-compat.test.ts).
//
// Geometry (a core LRect of DOGLEG.width cells across x `len` along its axis; the NEAR end is the one its landings open from):
//
//     near end            run zone (R cells)                      far end
//    +---------+---------------------------------------------+-----------+
//    | landing | lane A: street floor -> half height  (lead)   |   half    |   lane A on the LOW side of the cross axis
//    |  (both  |---------------- divider (SOLID) -------------|  landing  |
//    | storeys)| lane B: half height -> upper floor            | (both     |
//    +---------+---------------------------------------------+-----------+   storeys)
//
//  - the street storey's landing covers the near end of lane A's side only (the near end of lane B's side is SOLID there, under the upper
//    landing); the upper storey's landing covers the whole near end. Lane A starts from a flat lead at the street floor beside the street
//    landing and climbs to the half landing; lane B climbs from it back to the upper landing. Each lane is a gen/traversal.ts layStairRun
//    (STAIR risers 0.17 / treads 0.28, at most 12 risers a flight, 1.2 m landings), carved into BOTH level grids as one open well (the
//    market v2 open stair: a large ramp headroom capped by the cell ceiling, Ramp.capCeil) up to `wellTop`.
//  - lane A's street-floor lead is SOLID on the upper grid (the upper landing never meets a cliff: a wall there, the well open below).
//  - one LevelLink (lower -> upper) from lane A's foot to lane B's head; every flight in kit.flights.

import {SOLID} from '../../grid';
import {STAIR, layStairRun, stairRunCells, type StairFlight} from '../../traversal';
import type {InteriorBuilder, LRect, RoomInfo} from './builder';

/** Cell sizes of the dog-leg core: lane width, divider, near (landing) and far (half landing) zone depths, total width. */
export const DOGLEG = {lane: 3, divider: 1, near: 3, far: 3, width: 7} as const;
/** The open well's ramp headroom (capped by the cell ceilings: gen/market/v2/carve.ts OPEN_HEADROOM). */
const OPEN_HEADROOM = 40;
/**
 * The roof stair's BULKHEAD (m): clear height inside over the top landing, the housing's height above the roof (its cap), the roof door's
 * clear width (cells) and head height.
 */
export const BULKHEAD = {inner: 2.5, h: 2.8, door: 2, doorH: 2.1} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The half landing's height between two storey floors (rounded: the same value every caller computes). */
export const halfHeight = (y0: number, y1: number): number => r3((y0 + y1) / 2);

/** Core length (cells along its axis) of a dog-leg between floors y0 and y1. */
export function dogLegLength(y0: number, y1: number): number {
  const hm = halfHeight(y0, y1);
  return DOGLEG.near + Math.max(stairRunCells(hm - y0, STAIR), stairRunCells(y1 - hm, STAIR)) + DOGLEG.far;
}

export interface DogLeg {
  /** [the street storey's landing (storey 0), the upper storey's / roof's landing (storey 1)]. */
  landings: [RoomInfo, RoomInfo];
  well: RoomInfo;
  /** The local rects: the whole core and its near zone (the landings' end). */
  core: LRect;
  nearZone: LRect;
  flights: StairFlight[];
}

/**
 * Carves the dog-leg in local rect `L` (long axis `along`, landings at the `near` end: 'lo' = the low local coordinate) between storeys 0
 * and 1 of the builder; the well's ceiling at `wellTop` (absolute). Null (nothing carved) when the rect is too small.
 */
export function carveDogLeg(b: InteriorBuilder, L: LRect, along: 'u' | 'v', near: 'lo' | 'hi', wellTop: number, topLabel: string): DogLeg | null {
  const s0 = b.storeys[0], s1 = b.storeys[1];
  if (!s0 || !s1 || s1.level === s0.level) return null;
  const len = along === 'u' ? L.du : L.dv, wid = along === 'u' ? L.dv : L.du;
  if (len < dogLegLength(s0.y, s1.y) || wid !== DOGLEG.width) return null;
  if (L.u < 0 || L.v < 0 || L.u + L.du > b.W || L.v + L.dv > b.D) return null;
  // a0 = along offset from the near end, c0 = cross offset from the low side
  const sub = (a0: number, da: number, c0: number, dc: number): LRect => {
    const a = near === 'lo' ? a0 : len - a0 - da;
    return along === 'u' ? {u: L.u + a, v: L.v + c0, du: da, dv: dc} : {u: L.u + c0, v: L.v + a, du: dc, dv: da};
  };
  const R = len - DOGLEG.near - DOGLEG.far;
  const g0 = b.kit.grid(s0.level), g1 = b.kit.grid(s1.level);
  const hm = halfHeight(s0.y, s1.y), top = r3(wellTop);
  const name = b.b.name;
  // the well (run zone + half landing), on both grids
  const wellR = b.rect(sub(DOGLEG.near, len - DOGLEG.near, 0, DOGLEG.width));
  const well = b.kit.addArea(wellR, 'room', 'stair-core', top, -1, {label: `${name} · Stairs`, level: s0.level, floorY: s0.y, also: [s1.level], publicSpace: false});
  well.lighting = 'dark';
  well.noFloorLoot = true;
  const wellInfo: RoomInfo = {area: well, storey: 0, role: 'stair-run', front: false, windows: 'none', enemies: 0, noLoose: true};
  b.rooms.push(wellInfo);
  // world run direction of the near end (rooms/builder.ts carveCore's rule: the local v axis is flipped on S / E fronts)
  const axis: 'x' | 'z' = (along === 'u') === (b.front === 'N' || b.front === 'S') ? 'x' : 'z';
  const same = b.front === 'N' || b.front === 'W' || along === 'u';
  const nearW: 'lo' | 'hi' = (near === 'lo') === same ? 'lo' : 'hi';
  const farW: 'lo' | 'hi' = nearW === 'lo' ? 'hi' : 'lo';
  const spec = {...STAIR, headroom: OPEN_HEADROOM};
  const laneA = b.rect(sub(DOGLEG.near, R, 0, DOGLEG.lane)), laneB = b.rect(sub(DOGLEG.near, R, DOGLEG.lane + DOGLEG.divider, DOGLEG.lane));
  const fa = layStairRun([g0, g1], laneA, well.id, axis, nearW, s0.y, hm, spec);
  const fb = layStairRun([g0, g1], laneB, well.id, axis, farW, hm, s1.y, spec);
  const flights = [...fa, ...fb];
  for (const q of flights) { q.id = b.kit.flights.length; b.kit.flights.push(q); g0.ramps[q.ramp].capCeil = true; }
  const each = (r: {x: number; y: number; w: number; h: number}, f: (i: number) => void) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) f(g0.idx(x, y));
  };
  // the half landing at mid height, the divider SOLID, the well open to its top on both grids
  each(b.rect(sub(len - DOGLEG.far, DOGLEG.far, 0, DOGLEG.width)), i => { g0.floor[i] = hm; g1.floor[i] = hm; });
  each(b.rect(sub(DOGLEG.near, R, DOGLEG.lane, DOGLEG.divider)), i => {
    for (const g of [g0, g1]) { g.cells[i] = SOLID; g.area[i] = -1; }
  });
  each(wellR, i => { if (g0.cells[i] !== SOLID) { g0.ceil[i] = top; g1.ceil[i] = top; } });
  // lane A's street-floor lead is not part of the upper storey (a wall beside the upper landing; the well stays open below)
  each(laneA, i => { if (g1.rampIdx[i] < 0 && Math.abs(g1.floor[i] - s0.y) < 0.01) { g1.cells[i] = SOLID; g1.area[i] = -1; } });
  // the landings
  const l0 = b.room(0, sub(0, DOGLEG.near, 0, DOGLEG.lane), {kind: 'room', type: 'stair-core', label: 'Stairs · Street floor', role: 'stair', enemies: 0, noLoose: true});
  const l1 = b.room(1, sub(0, DOGLEG.near, 0, DOGLEG.width), {kind: 'room', type: 'stair-core', label: topLabel, role: 'stair', enemies: 0, noLoose: true});
  if (!l0 || !l1) return null;
  const first = flights.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
  const last = flights.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
  b.links.push({id: b.links.length, kind: 'stairs', lower: s0.level, upper: s1.level, ramp: first.ramp, bottom: {...first.bottom}, top: {...last.top}, traversalId: first.id});
  b.carvedStoreys = Math.max(b.carvedStoreys, 2);
  return {landings: [l0, l1], well: wellInfo, core: {...L}, nearZone: sub(0, DOGLEG.near, 0, DOGLEG.width), flights};
}
