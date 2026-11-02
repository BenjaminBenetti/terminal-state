// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY — the PROGRAM (pure planning in a local frame) and its
// carving into the shared Kit. Contract: ./types.ts (ComplexSlot / ComplexCarve). Pure data; draws only from the given rng.
//
// LOCAL FRAME: u runs ALONG the pit wall the complex opens from, v runs INWARD (away from the shaft deck). The slot's region maps onto
// (u, v) by its `inward` side, optionally mirrored along u (seeded). Bands, front (v small) to back:
//
//      v ┌──────────────┬──────────────────────┬────────────────┐
//   F    │              │                      │ Control room   │   F: the receiving bay on the entrance (truck dock, roller-shutter
//        │ HEALTH-      │    RECEIVING BAY     │────────────────│      frame), the health-physics checkpoint (decon showers, portal
//        │ PHYSICS      │   (entry, tall)      │ Dosimetry /    │      monitor) on one side, the control room + the dosimetry / change
//        │ CHECKPOINT   │                      │ change room    │      room (lockers) on the other;
//        ├──────────────┴──────────────────────┼────────────────┤
//   M    │        DRUM VAULT (long hall,       │ Compactor &    │   M: the long drum vault (racked drums in rows, aisles along u),
//        │        racks in rows along u)       │ processing     │      the compactor / processing room (hot-cell window);
//        ├─────────────────────────────────────┼────────────────┤
//   K    │   Sealed vault corridor (west)   ║ heavy door ║ (east)│   K: the sealed-vault corridor, split by a heavy airlock door;
//        ├──────────────┬────────┬────────────┴────────────────┤
//   B    │ GENERATOR /  │ Sump & │     DRY-CASK HALL            │   B: the generator / ventilation plant (zone 2's aux generator,
//        │ VENT PLANT   │ pumps  │     (casks in a grid, tall)  │      fans, cable trench), the sump & pump room, the dry-cask hall.
//        └──────────────┴────────┴─────────────────────────────┘
//
// Two disjoint routes bay -> plant: (A) bay -> drum vault -> corridor (west) -> plant; (B) bay -> control -> change room -> compactor
// -> corridor (east) -> cask hall -> sump & pumps -> plant. More loops: bay -> HP checkpoint -> vault; the airlock between the two
// corridor halves; optionally vault <-> compactor. 11 spaces, ~900-1200 m² walkable.

import type {Rng} from '../../../core/rng';
import type {AreaKind, Rect, RoomType, Side} from '../../stationTypes';
import type {ComplexRoom} from './types';

/** A rectangle in the complex's local cells: u along the pit wall, v inward. */
export interface LRect { u: number; v: number; du: number; dv: number }

/** The local frame of a slot region: (u, v) <-> canvas cells. */
export class WasteFrame {
  /** Region extent along u / v (cells). */
  readonly U: number;
  readonly V: number;
  constructor(readonly region: Rect, readonly inward: Side, readonly mirror: boolean) {
    const ns = inward === 'N' || inward === 'S';
    this.U = ns ? region.w : region.h;
    this.V = ns ? region.h : region.w;
  }

  /** Canvas rect of a local rect. */
  rect(l: LRect): Rect {
    const r = this.region;
    const ns = this.inward === 'N' || this.inward === 'S';
    const ua = ns ? r.x : r.y, ul = ns ? r.w : r.h;
    const a0 = this.mirror ? ua + ul - l.u - l.du : ua + l.u;
    let b0: number;
    switch (this.inward) {
      case 'S': b0 = r.y + l.v; break;
      case 'N': b0 = r.y + r.h - l.v - l.dv; break;
      case 'E': b0 = r.x + l.v; break;
      default: b0 = r.x + r.w - l.v - l.dv; break;
    }
    return ns ? {x: a0, y: b0, w: l.du, h: l.dv} : {x: b0, y: a0, w: l.dv, h: l.du};
  }

  /** Canvas cell of local cell (u, v). */
  cell(u: number, v: number): [number, number] {
    const q = this.rect({u, v, du: 1, dv: 1});
    return [q.x, q.y];
  }

  /** Local (u, v) of a canvas cell. */
  local(x: number, y: number): [number, number] {
    const r = this.region;
    const ns = this.inward === 'N' || this.inward === 'S';
    const a = ns ? x : y, ua = ns ? r.x : r.y, ul = ns ? r.w : r.h;
    const u = this.mirror ? ua + ul - 1 - a : a - ua;
    let v: number;
    switch (this.inward) {
      case 'S': v = y - r.y; break;
      case 'N': v = r.y + r.h - 1 - y; break;
      case 'E': v = x - r.x; break;
      default: v = r.x + r.w - 1 - x; break;
    }
    return [u, v];
  }

  /** Unit canvas / world direction (x, z) of local +u and +v. */
  dirU(): [number, number] {
    const s = this.mirror ? -1 : 1;
    return this.inward === 'N' || this.inward === 'S' ? [s, 0] : [0, s];
  }
  dirV(): [number, number] {
    switch (this.inward) {
      case 'S': return [0, 1];
      case 'N': return [0, -1];
      case 'E': return [1, 0];
      default: return [-1, 0];
    }
  }
}

export type WasteKey = 'bay' | 'hp' | 'lockers' | 'control' | 'vault' | 'compactor' | 'kWest' | 'kEast' | 'plant' | 'pump' | 'cask';

/** Ceiling class of a space: rooms 3.4 m, corridors 3.2 m, the plant 4.8 m, halls 6 m, the cask hall as tall as the slot allows. */
export type WasteClear = 'room' | 'corr' | 'plant' | 'hall' | 'tall';
export const WASTE_CLEAR: Readonly<Record<WasteClear, number>> = {room: 3.4, corr: 3.2, plant: 4.8, hall: 6.0, tall: 7.5};

export interface WasteRoomSpec {
  key: WasteKey;
  kind: AreaKind;
  type: RoomType;
  /** Existing purpose (gen/purposes.ts ROOM_PURPOSES): loot tables, light odds, the station dresser's furnishing rules. */
  purpose: string;
  label: string;
  role: ComplexRoom['role'];
  clear: WasteClear;
}

/** The program: what each space IS (existing room types / purposes, so loot, spawns, lighting and materials work unchanged). */
export const WASTE_ROOMS: readonly WasteRoomSpec[] = [
  {key: 'bay', kind: 'room', type: 'storage', purpose: 'storage', label: 'Receiving bay', role: 'entry', clear: 'hall'},
  {key: 'hp', kind: 'room', type: 'crew-room', purpose: 'first-aid-room', label: 'Health-physics checkpoint', role: 'room', clear: 'room'},
  {key: 'lockers', kind: 'room', type: 'crew-room', purpose: 'locker-room', label: 'Dosimetry & change room', role: 'room', clear: 'room'},
  {key: 'control', kind: 'room', type: 'utility', purpose: 'signal-room', label: 'Repository control room', role: 'room', clear: 'room'},
  {key: 'vault', kind: 'room', type: 'storage', purpose: 'storage', label: 'Drum vault', role: 'hall', clear: 'hall'},
  {key: 'compactor', kind: 'room', type: 'utility', purpose: 'custodial-room', label: 'Compactor & processing', role: 'room', clear: 'plant'},
  {key: 'kWest', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', label: 'Sealed vault corridor', role: 'corridor', clear: 'corr'},
  {key: 'kEast', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', label: 'Vault airlock corridor', role: 'corridor', clear: 'corr'},
  {key: 'plant', kind: 'room', type: 'utility', purpose: 'generator-room', label: 'Generator & ventilation plant', role: 'generator', clear: 'plant'},
  {key: 'pump', kind: 'room', type: 'utility', purpose: 'pump-room', label: 'Sump & pump room', role: 'room', clear: 'room'},
  {key: 'cask', kind: 'room', type: 'storage', purpose: 'turbine-hall', label: 'Dry-cask hall', role: 'vault', clear: 'tall'},
];

export type WasteDoorKind = 'personnel' | 'wide' | 'heavy';
export interface WasteDoorSpec { a: WasteKey; b: WasteKey; w: number; h: number; t: number; kind: WasteDoorKind }

export interface WastePlan {
  frame: WasteFrame;
  rooms: Record<WasteKey, LRect>;
  doors: WasteDoorSpec[];
  /** The entrance span in local cells ([u0, u1) at row v; v < the bay's first row). */
  entrance: {u0: number; u1: number; v: number};
  /** Generator skid footprint (long axis along u) and the use cell (one free cell beyond the skid's end toward the plant door). */
  gen: {foot: LRect; use: [number, number]};
}

/** Program limits (cells). The region is used up to UMAX x VMAX (a bigger slot keeps rock round the program). */
export const WASTE_LIMITS = {UMIN: 62, VMIN: 56, UMAX: 96, VMAX: 82} as const;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Plans the program in the slot's region. `ent` = the entrance span (canvas rect, 1 cell deep). Null when the region (or the
 * entrance's position) cannot hold it. Draws a fixed number of values from `rng` per attempt (deterministic).
 */
export function planWaste(region: Rect, inward: Side, ent: Rect, rng: Rng): WastePlan | null {
  const flip = rng.chance(0.5);
  const jit = [rng.int(-2, 2), rng.int(-2, 2), rng.int(-1, 1), rng.int(-1, 1), rng.int(-1, 1), rng.int(-1, 1)];
  const t = [rng.range(0.25, 0.4), rng.range(0.4, 0.6), rng.range(0.55, 0.75), rng.range(0.3, 0.7), rng.range(0.35, 0.65)];
  const link = rng.chance(0.5);
  for (const mirror of [flip, !flip]) {
    const p = tryPlan(new WasteFrame(region, inward, mirror), ent, jit, t, link);
    if (p) return p;
  }
  return null;
}

function tryPlan(f: WasteFrame, ent: Rect, jit: number[], t: number[], link: boolean): WastePlan | null {
  // the entrance in local cells
  let eu0 = Infinity, eu1 = -Infinity, ev = -Infinity;
  for (let y = ent.y; y < ent.y + ent.h; y++) for (let x = ent.x; x < ent.x + ent.w; x++) {
    const [u, v] = f.local(x, y);
    eu0 = Math.min(eu0, u); eu1 = Math.max(eu1, u + 1); ev = Math.max(ev, v);
  }
  if (!Number.isFinite(eu0) || ev > 1 || ev < -3) return null;
  const v0 = Math.max(1, ev + 1);
  const Uw = Math.min(f.U - 2, WASTE_LIMITS.UMAX), Vw = Math.min(f.V - 1 - v0, WASTE_LIMITS.VMAX);
  if (Uw < WASTE_LIMITS.UMIN || Vw < WASTE_LIMITS.VMIN) return null;
  if (eu0 < 2 || eu1 > f.U - 2) return null;
  // the program box along u: as centred on the entrance as the region allows
  const ub0 = clamp(Math.round((eu0 + eu1) / 2 - Uw / 2), 1, f.U - 1 - Uw), ub1 = ub0 + Uw;
  // columns: L (checkpoint / vault / plant side), C (the bay over the entrance), R (control / compactor / airlock side)
  let L = Math.round(Uw * 0.23) + jit[0], R = Math.round(Uw * 0.27) + jit[1];
  const C = Uw - L - R - 2;
  const c0 = () => ub0 + L + 1;
  if (eu0 - 1 < c0()) { const s = c0() - (eu0 - 1); L -= s; R += s; }
  if (eu1 + 1 > c0() + C) { const s = eu1 + 1 - (c0() + C); L += s; R -= s; }
  if (L < 13 || R < 15 || C < 22 || C < eu1 - eu0 + 4) return null;
  const cL = ub0, cC = c0(), cR = cC + C + 1;
  // bands (the back band deep enough for two rows of dry casks: 2 x 3.23 m + an aisle + wall aisles = 10.5 m = 21 cells)
  let F = clamp(Math.round(Vw * 0.245) + jit[2], 15, 22), B = clamp(Math.round(Vw * 0.34) + jit[3], 18, 28);
  const K = 6;
  let M = Vw - F - K - B - 3;
  while (M < 15 && B > 18) { B--; M++; }
  while (M < 15 && F > 15) { F--; M++; }
  if (M < 14) return null;
  const vF = v0, vM = vF + F + 1, vK = vM + M + 1, vB = vK + K + 1;
  // F splits (front room toward the bay's entrance side, back room behind it)
  const gA = clamp(Math.ceil((F - 1) * 0.55) + jit[5], 7, F - 7), gB = F - 1 - gA;
  if (gB < 6 || gA < 7) return null;
  // B splits: plant | pump | cask
  let P = clamp(Math.round(Uw * 0.3), 18, 28), Q = clamp(Math.round(Uw * 0.16), 10, 15);
  let Cw = Uw - P - Q - 2;
  while (Cw < 22 && P > 18) { P--; Cw++; }
  while (Cw < 22 && Q > 10) { Q--; Cw++; }
  if (Cw < 22) return null;
  const bPlant = ub0, bPump = bPlant + P + 1, bCask = bPump + Q + 1;
  // the cask hall's door to the east corridor half needs >= 8 cells of shared wall
  if (ub1 - Math.max(bCask, cR) < 8) return null;
  const rooms: Record<WasteKey, LRect> = {
    bay: {u: cC, v: vF, du: C, dv: F},
    hp: {u: cL, v: vF, du: L, dv: F},
    control: {u: cR, v: vF, du: R, dv: gA},
    lockers: {u: cR, v: vF + gA + 1, du: R, dv: gB},
    vault: {u: cL, v: vM, du: L + 1 + C, dv: M},
    compactor: {u: cR, v: vM, du: R, dv: M},
    kWest: {u: cL, v: vK, du: L + 1 + C, dv: K},
    kEast: {u: cR, v: vK, du: R, dv: K},
    plant: {u: bPlant, v: vB, du: P, dv: B},
    pump: {u: bPump, v: vB, du: Q, dv: B},
    cask: {u: bCask, v: vB, du: Cw, dv: B},
  };
  const doors: WasteDoorSpec[] = [
    {a: 'bay', b: 'hp', w: 4, h: 2.4, t: t[0], kind: 'personnel'},
    {a: 'hp', b: 'vault', w: 4, h: 2.4, t: t[1], kind: 'personnel'},
    {a: 'bay', b: 'control', w: 4, h: 2.4, t: t[0], kind: 'personnel'},
    {a: 'control', b: 'lockers', w: 4, h: 2.4, t: t[1], kind: 'personnel'},
    {a: 'lockers', b: 'compactor', w: 4, h: 2.4, t: t[1], kind: 'personnel'},
    {a: 'bay', b: 'vault', w: 8, h: 3.6, t: 0.5, kind: 'wide'},
    {a: 'vault', b: 'kWest', w: 5, h: 2.8, t: t[2], kind: 'heavy'},
    {a: 'compactor', b: 'kEast', w: 4, h: 2.4, t: t[3], kind: 'personnel'},
    {a: 'kWest', b: 'kEast', w: 4, h: 2.8, t: 0.5, kind: 'heavy'},
    {a: 'kWest', b: 'plant', w: 5, h: 2.8, t: t[4], kind: 'heavy'},
    {a: 'kEast', b: 'cask', w: 6, h: 3.6, t: 0.5, kind: 'heavy'},
    {a: 'plant', b: 'pump', w: 4, h: 2.4, t: 0.3, kind: 'personnel'},
    {a: 'pump', b: 'cask', w: 4, h: 2.4, t: 0.7, kind: 'personnel'},
  ];
  if (link) doors.push({a: 'vault', b: 'compactor', w: 4, h: 2.4, t: 0.5, kind: 'personnel'});
  // the generator: skid (8 x 4 cells = 4 x 2 m, long axis along u) in the middle of the plant, its use cell one free cell beyond the
  // skid's end on the plant door's side, >= 5 cells (2.5 m) from the side wall (wall fittings + their access strips never reach it)
  const pl = rooms.plant;
  const dU = doorCentreU(rooms.kWest, pl, 5, t[4]);
  const lowSide = dU < pl.u + pl.du / 2;
  const slack = Math.max(0, Math.floor((pl.du - 17) / 2));
  const fu = lowSide ? pl.u + 7 + slack : pl.u + pl.du - 15 - slack;
  const fv = pl.v + Math.max(4, Math.floor((pl.dv - 4) / 2) + 1);
  if (fv + 4 > pl.v + pl.dv - 3) return null;
  const foot: LRect = {u: fu, v: fv, du: 8, dv: 4};
  const use: [number, number] = lowSide ? [fu - 2, fv + 2] : [fu + 9, fv + 2];
  if (use[0] - 5 < pl.u || use[0] + 5 >= pl.u + pl.du || fu < pl.u + 2 || fu + 8 > pl.u + pl.du - 2) return null;
  return {frame: f, rooms, doors, entrance: {u0: eu0, u1: eu1, v: ev}, gen: {foot, use}};
}

/** Shared one-cell wall of two local rects: the wall line, its axis and span; null if they do not share one. */
export function sharedWallL(a: LRect, b: LRect): {alongU: boolean; line: number; s0: number; s1: number} | null {
  if (a.v + a.dv + 1 === b.v || b.v + b.dv + 1 === a.v) {
    const s0 = Math.max(a.u, b.u), s1 = Math.min(a.u + a.du, b.u + b.du);
    return s1 > s0 ? {alongU: true, line: a.v + a.dv + 1 === b.v ? a.v + a.dv : b.v + b.dv, s0, s1} : null;
  }
  if (a.u + a.du + 1 === b.u || b.u + b.du + 1 === a.u) {
    const s0 = Math.max(a.v, b.v), s1 = Math.min(a.v + a.dv, b.v + b.dv);
    return s1 > s0 ? {alongU: false, line: a.u + a.du + 1 === b.u ? a.u + a.du : b.u + b.du, s0, s1} : null;
  }
  return null;
}

/** The door gap (local) in the shared wall of a and b: width `w` (shrunk to >= 3 if the wall is short), at fraction t; null if no room. */
export function doorGapL(a: LRect, b: LRect, w: number, t: number): LRect | null {
  const s = sharedWallL(a, b);
  if (!s) return null;
  const room = s.s1 - s.s0 - 2;
  const ww = Math.min(w, room);
  if (ww < 3) return null;
  const st = s.s0 + 1 + Math.round((room - ww) * t);
  return s.alongU ? {u: st, v: s.line, du: ww, dv: 1} : {u: s.line, v: st, du: 1, dv: ww};
}

function doorCentreU(a: LRect, b: LRect, w: number, t: number): number {
  const g = doorGapL(a, b, w, t);
  return g ? g.u + g.du / 2 : b.u + b.du / 2;
}
