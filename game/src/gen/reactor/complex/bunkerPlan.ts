// Task reactor-expansion-20261101 (lane BUNKER): THE BUNKER's program in a LOCAL frame (pure data, no Kit): the civil-defence shelter
// that houses zone 0's auxiliary generator off the Reactor's tier-1 gallery. gen/reactor/complex/bunker.ts maps it onto the canvas and
// carves it; bunkerDress.ts furnishes it after the crop.
//
// Local frame (cells): u runs ALONG the pit wall (0 = the region's first cell along it), v runs INTO the rock (0 = the first row behind
// the entrance span). Every room is a rect with exactly one wall cell between neighbours; doors are 1-cell-deep gaps in those walls.
//
//   v  0 ┌────────────┐┌──────┐   front band: the BLAST-DOOR LOCK behind the entrance, the DECONTAMINATION room behind it, the GUARD
//      │  lock      ││guard │   POST beside both (doors into the lock and the muster corridor: the first loop); the rest of the band
//    8 ├────────────┤│ post │   holds 1-4 front rooms opening onto the muster corridor
//      │  decon     ││      │
//   16 └────────────┘└──────┘
//   17 ═══════ MUSTER CORRIDOR (the full width) ═══════
//   24 ║W║ outer rooms │ MESS HALL (both spines) │ ║E║ outer rooms     spine zone: two spines from the muster corridor to the hall
//      ║ ║            │ centre rooms            │ ║ ║                 (the second loop), rooms off them
//  vH  ═══ switch room │   GENERATOR HALL (the zone generator mid-hall)   │ armoury (dead end) ═══
//
// Real scale: rooms 3.2-3.6 m clear, corridors 3.2 m, the hall up to 6.5 m (slot.ceilMax), doorways 1.5-3 m wide x 2.4 m (junctions
// 3.0 m), corridors 2.5-3 m wide. Seeded variation: the guard post side, outer / centre widths, row splits, hall depth, which room
// takes which slot, door positions, the armoury side, the muster-to-mess opening.

import type {Rng} from '../../../core/rng';
import type {AreaKind, RoomType} from '../../stationTypes';
import type {ComplexRoom} from './types';
import {BUNKER_PURPOSE} from './bunkerPurposes';
import {BLAST} from './bunkerKinds';

/** A local rect: u / v of its first cell, w cells along u, h cells along v. */
export interface LRect { u: number; v: number; w: number; h: number }

export interface PlanRoom {
  key: string;
  label: string;
  role: ComplexRoom['role'];
  kind: AreaKind;
  type: RoomType;
  /** Room purpose (gen/purposes.ts ROOM_PURPOSES id): preset, so the station dresser keeps the label and dresses / lights / loots by it. */
  purpose: string;
  r: LRect;
  /** Clear height above the floor (m) before the slot's ceilMax cap. */
  clear: number;
  /** Key of the room it opens off (its main door; '' = the entrance deck). */
  parent: string;
}

export interface PlanDoor {
  /** Parent side (a) and the room the door cells join (b), by key ('' = the entrance deck). */
  a: string;
  b: string;
  /** Local gap (1 cell deep), height above the floor (m), arch. The entrance's gap is the slot's own span (`entrance`). */
  gap: LRect;
  height: number;
  arch: boolean;
  kind: 'blast' | 'junction' | 'door' | 'bulkhead';
}

export interface BunkerPlan {
  rooms: PlanRoom[];
  doors: PlanDoor[];
  /** The generator skid (8 x 4 cells, long axis along u) and the use cell (2 cells off its `end` short side, facing it). */
  gen: {foot: LRect; use: {u: number; v: number}; end: 'lo' | 'hi'};
  /**
   * The blast door in the bulkhead: the lane's first cell along u (3 cells wide), the model origin (continuous local cells: model x
   * along xs * u, model z along -facing * v; facing 1 = its front / open leaf toward the lock, -1 toward the decon), and the threshold
   * cells' rise (rows v, risers of BLAST.sill / 3 over the lane).
   */
  blast: {uo: number; uf: number; vo: number; xs: 1 | -1; facing: 1 | -1; steps: [number, number][]};
  /** Layout numbers (QA / tests / dressing). */
  dims: {A: number; Vd: number; LD: number; BW: number; vM: number; vS: number; vH: number; uW: number; uE: number; SW: number; MW: number; GD: number; lock: LRect};
}

/** Fixed module sizes (cells, 0.5 m). */
export const BUNKER = {
  /** Lock depth / bulkhead (blast door) thickness / decontamination depth / muster corridor width / spine width / guard post width. */
  LD: 9, bulkhead: 2, DD: 9, MW: 6, SW: 5, GW: 10,
  /** Narrowest lock (cells): the blast-door frame (4.95 m) along its back wall plus a walkway past the open leaf. */
  lockMinW: 13,
  /** Minimum along / depth (cells) the program needs. */
  minA: 56, minVd: 57,
  /** Clear heights (m): rooms, stores, corridors, the lock, hall side rooms, the hall (target; capped by ceilMax). */
  clear: {room: 3.4, store: 3.2, corridor: 3.2, lock: 4.0, side: 3.6, hall: 6.5},
  /** Door heights (m): ordinary doors, corridor junctions, the entrance, the bulkhead lane (threshold sill + 2.26 m). */
  door: {room: 2.4, junction: 3.0, blast: 3.0, bulkhead: 3.1},
  /** The generator skid footprint (cells along u x along v). */
  skid: {w: 8, d: 4},
} as const;

interface Prog { key: string; label: string; kind: AreaKind; type: RoomType; purpose: string; role: ComplexRoom['role']; clear?: number }

/** The free-slot program in priority order: the dormitory takes the largest slot, the filtration plant the next, the rest shuffle. */
const PROGRAM: readonly Prog[] = [
  {key: 'dorm', label: 'Dormitory', kind: 'room', type: 'crew-room', purpose: BUNKER_PURPOSE.dorm, role: 'room'},
  {key: 'filtration', label: 'Air filtration plant', kind: 'room', type: 'utility', purpose: 'ventilation-plant', role: 'room'},
  {key: 'infirmary', label: 'Infirmary', kind: 'room', type: 'crew-room', purpose: 'first-aid-room', role: 'room'},
  {key: 'radio', label: 'Radio room', kind: 'room', type: 'utility', purpose: BUNKER_PURPOSE.radio, role: 'room'},
  {key: 'washroom', label: 'Latrines', kind: 'room', type: 'washroom', purpose: 'washroom', role: 'room'},
  {key: 'stores', label: 'Shelter stores', kind: 'room', type: 'storage', purpose: 'storage', role: 'store', clear: BUNKER.clear.store},
  {key: 'workshop', label: 'Maintenance workshop', kind: 'room', type: 'utility', purpose: 'workshop', role: 'room'},
  {key: 'warden', label: 'Shelter warden\'s office', kind: 'room', type: 'agent-office', purpose: 'agent-office', role: 'room'},
  {key: 'rations', label: 'Ration store', kind: 'room', type: 'stock-room', purpose: 'stock-room', role: 'store', clear: BUNKER.clear.store},
  {key: 'dorm2', label: 'Dormitory B', kind: 'room', type: 'crew-room', purpose: BUNKER_PURPOSE.dorm, role: 'room'},
  {key: 'lockers', label: 'Locker room', kind: 'room', type: 'crew-room', purpose: 'locker-room', role: 'room'},
];
const SPARE: Prog = {key: 'store', label: 'Storeroom', kind: 'room', type: 'storage', purpose: 'storage', role: 'store', clear: BUNKER.clear.store};

/** Splits a span of `S` cells into n rooms of width >= `min` (each <= ~`max`), one wall cell between: widths summing to S - (n - 1). */
export function splitSpan(S: number, min: number, max: number, rng: Rng): number[] {
  if (S < min) return [];
  let n = Math.max(1, Math.ceil((S + 1) / (max + 1)));
  while (n > 1 && (S + 1) / n - 1 < min) n--;
  const free = S - (n - 1);
  const out: number[] = [];
  let left = free;
  for (let i = 0; i < n; i++) {
    const rest = n - i;
    if (rest === 1) { out.push(left); break; }
    const avg = left / rest;
    const w = Math.max(min, Math.min(left - min * (rest - 1), Math.round(avg + rng.range(-1.5, 1.5))));
    out.push(w);
    left -= w;
  }
  return out;
}

/**
 * The bunker program for a region `A` cells along the wall, `Vd` usable cells deep (v in [0, Vd)), the entrance span [e0, e1) along u;
 * `leafSign` = the local u direction of the blast-door model's +x (its open leaf) when its front faces the lock (bunker.ts).
 * Null when it does not fit (the carver then returns null and the host keeps the generator on its landing).
 */
export function planBunker(A: number, Vd: number, e0: number, e1: number, leafSign: 1 | -1, rng: Rng): BunkerPlan | null {
  const {LD, DD, MW, SW} = BUNKER;
  if (A < BUNKER.minA || Vd < BUNKER.minVd || e1 - e0 < 2 || e0 < 1 || e1 > A - 1) return null;
  const C = BUNKER.clear, D = BUNKER.door;
  const rooms: PlanRoom[] = [], doors: PlanDoor[] = [];
  const room = (p: Prog, r: LRect, parent: string, over: Partial<PlanRoom> = {}): PlanRoom => {
    const q: PlanRoom = {key: p.key, label: p.label, role: p.role, kind: p.kind, type: p.type, purpose: p.purpose, r, clear: p.clear ?? C.room, parent, ...over};
    rooms.push(q);
    return q;
  };
  const door = (a: string, b: string, gap: LRect, kind: PlanDoor['kind'] = 'door', height: number = D.room): void => {
    doors.push({a, b, gap, height, arch: kind === 'junction', kind});
  };
  /** A door of width `w` in the wall row v = `vWall` (spanning u), somewhere in [u0 + 1, u1 - 1 - w] (`t` 0..1 = where). */
  const doorU = (a: string, b: string, vWall: number, u0: number, u1: number, w: number, t: number, kind: PlanDoor['kind'] = 'door') => {
    const lo = u0 + 1, hi = u1 - 1 - w;
    const u = hi < lo ? Math.max(u0, Math.round((u0 + u1 - w) / 2)) : Math.round(lo + (hi - lo) * t);
    door(a, b, {u, v: vWall, w: Math.min(w, u1 - u0), h: 1}, kind);
  };
  /** A door of height-span `h` in the wall column u = `uWall` (spanning v), in [v0 + 1, v1 - 1 - h]. */
  const doorV = (a: string, b: string, uWall: number, v0: number, v1: number, h: number, t: number, kind: PlanDoor['kind'] = 'door') => {
    const lo = v0 + 1, hi = v1 - 1 - h;
    const v = hi < lo ? Math.max(v0, Math.round((v0 + v1 - h) / 2)) : Math.round(lo + (hi - lo) * t);
    door(a, b, {u: uWall, v, w: 1, h: Math.min(h, v1 - v0)}, kind);
  };

  // --- Front band: lock, the blast-door bulkhead, decon, guard post ----------------------------------------------------------------
  // The lock (vestibule) behind the entrance; a 2-cell bulkhead holds the BLAST DOOR (REACTOR_X_KIT.blastDoor, grounded) whose round
  // leaf stands open beside the frame on the model's +x side: preferably facing the LOCK (you see the open door as you come in), the
  // leaf along the lock's side wall away from the entrance - else facing the DECON (the leaf along a decon side wall). The 3-cell lane
  // through it climbs a raised threshold (gen/reactor/complex/bunkerKinds.ts BLAST). The guard post always opens into the lock (and the
  // muster corridor): a level way round the threshold.
  const BW = BUNKER.bulkhead, FB = LD + BW + DD, vM = FB + 1, vS = vM + MW + 1;
  const ew = e1 - e0;
  const fHalf = BLAST.halfW / 0.5, oOff = BLAST.openX / 0.5, leafW = (BLAST.leaf.x[1] - BLAST.leaf.x[0]) / 0.5;
  const zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2 / 0.5;
  let GW: number = BUNKER.GW;
  const LWmin = BUNKER.lockMinW + rng.int(0, 2), gap = 3 + rng.int(0, 2);
  // facing the lock: the leaf's wall (u side `leafSign`) keeps >= `gap` cells clear of the entrance, the guard on the other side
  let facing: 1 | -1 = 1, lu0 = 0, lu1 = 0, gHi = false;
  {
    const l0 = Math.max(1, leafSign > 0 ? Math.min(e0 - 1, e1 + gap - LWmin) : e0 - gap);
    const l1 = Math.min(A - 1, leafSign > 0 ? e1 + gap : Math.max(e1 + 1, e0 - gap + LWmin));
    const leafClear = leafSign > 0 ? l1 - leafW >= e1 + 1 : l0 + leafW <= e0 - 1;
    const away = leafSign > 0 ? l0 - 2 : A - 2 - l1;
    if (l1 - l0 >= BUNKER.lockMinW && e0 >= l0 + 1 && e1 <= l1 - 1 && leafClear && away >= GW) { lu0 = l0; lu1 = l1; gHi = leafSign < 0; }
    else {
      // facing the decon: the lock round the entrance, the guard on the roomier side
      facing = -1;
      const w = Math.max(LWmin, ew + 4);
      lu0 = Math.max(1, Math.min(A - 1 - w, Math.round((e0 + e1) / 2 - w / 2)));
      lu1 = lu0 + w;
      const lo = lu0 - 2, hi = A - 2 - lu1;
      gHi = hi >= lo;
      if (Math.max(lo, hi) < GW) { GW = Math.max(lo, hi); if (GW < 8) return null; }
    }
  }
  const LW = lu1 - lu0;
  if (LW < BUNKER.lockMinW || e0 < lu0 + 1 || e1 > lu1 - 1) return null;
  // the model's +x along local u: `leafSign` facing the lock (front +z = -v), reversed facing the decon (front +z = +v)
  const xs = (facing > 0 ? leafSign : -leafSign) as 1 | -1;
  // the frame: its +x end (the leaf side) against that side wall; the opening's 3-cell lane; the model origin (continuous cells)
  const uo = Math.round(xs > 0 ? lu1 - fHalf + xs * oOff - 1.5 : lu0 + fHalf + xs * oOff - 1.5);
  const uf = uo + 1.5 - xs * oOff;
  if (uf - fHalf < lu0 - 0.7 || uf + fHalf > lu1 + 0.7) return null;
  // model z -> v: facing the lock v = vo - z / 0.5, the decon v = vo + z / 0.5; the body centred in the bulkhead
  const vo = LD + BW / 2 + facing * zc;
  const leafTip = vo - facing * BLAST.leaf.z[1] / 0.5;
  if (facing > 0 ? leafTip < 0.5 : leafTip > LD + BW + DD - 0.5) return null; // the open leaf stays inside its room
  const gu0 = gHi ? lu1 + 1 : lu0 - 1 - GW;
  const lockR: LRect = {u: lu0, v: 0, w: LW, h: LD};
  room({key: 'lock', label: 'Blast-door lock', kind: 'room', type: 'utility', purpose: BUNKER_PURPOSE.lock, role: 'entry'}, lockR, '', {clear: C.lock});
  door('', 'lock', {u: e0, v: -1, w: ew, h: 1}, 'blast', D.blast);
  room({key: 'decon', label: 'Decontamination', kind: 'room', type: 'utility', purpose: BUNKER_PURPOSE.decon, role: 'room'}, {u: lu0, v: LD + BW, w: LW, h: DD}, 'lock', {clear: C.lock});
  door('lock', 'decon', {u: uo, v: LD, w: 3, h: BW}, 'bulkhead', D.bulkhead);
  // the muster corridor (full width) behind the front band; the decon's door to it clear of a leaf along a decon side wall
  room({key: 'muster', label: 'Muster corridor', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', role: 'corridor'}, {u: 1, v: vM, w: A - 2, h: MW}, 'decon', {clear: C.corridor});
  doorU('decon', 'muster', FB, lu0 + (facing < 0 && xs < 0 ? 3 : 0), lu1 - (facing < 0 && xs > 0 ? 3 : 0), 4, rng.range(0.25, 0.75));
  room({key: 'guard', label: 'Guard post', kind: 'room', type: 'utility', purpose: 'security-office', role: 'room'}, {u: gu0, v: 0, w: GW, h: FB}, 'muster');
  doorV('lock', 'guard', gHi ? lu1 : lu0 - 1, 0, LD - 2, 3, rng.range(0.2, 0.8));
  doorU('muster', 'guard', FB, gu0, gu0 + GW, 3, gHi ? rng.range(0.4, 1) : rng.range(0, 0.6));
  // the threshold: the sill level over the bulkhead AND the first row each side (the frame's faces stand 0.29 / 0.49 m proud of the
  // wall: their plate below the round opening stays under the walking surface), then two risers down to each room's floor
  const blast = {uo, uf, vo, xs, facing, steps: [[LD - 3, 1], [LD - 2, 2], [LD - 1, 3], [LD, 3], [LD + 1, 3], [LD + BW, 3], [LD + BW + 1, 2], [LD + BW + 2, 1]] as [number, number][]};

  // front rooms on both sides of the lock group (they open onto the muster corridor)
  const groupLo = Math.min(lu0, gu0), groupHi = Math.max(lu0 + LW, gu0 + GW);
  const slots: {r: LRect; parent: string; open: (key: string) => void}[] = [];
  const front = (u0: number, u1: number) => {
    let u = u0;
    for (const w of splitSpan(u1 - u0, 10, 16, rng)) {
      const r: LRect = {u, v: 0, w, h: FB};
      slots.push({r, parent: 'muster', open: key => doorU('muster', key, FB, r.u, r.u + r.w, rng.int(3, 4), rng.next())});
      u += w + 1;
    }
  };
  front(1, groupLo - 1);
  front(groupHi + 1, A - 1);

  // --- Spine zone + the generator hall ----------------------------------------------------------------------------------------
  let GD = rng.int(18, 22);
  if (Vd - vS - 1 - GD < 12) GD = Vd - vS - 13;
  if (GD < 16) return null;
  if (Vd - vS - 1 - GD > 40) GD = Math.min(24, Vd - vS - 41);
  const vH = Vd - GD, SL = vH - 1 - vS;
  let OW = rng.int(11, 15), OE = rng.int(11, 15);
  let CW = A - 16 - OW - OE;
  while (CW < 20 && (OW > 10 || OE > 10)) { if (OW >= OE && OW > 10) OW--; else OE--; CW = A - 16 - OW - OE; }
  if (CW < 20) return null;
  while (CW > 40 && (OW < 18 || OE < 18)) { if (OW <= OE && OW < 18) OW++; else OE++; CW = A - 16 - OW - OE; }
  const uW = 1 + OW + 1, uC = uW + SW + 1, uE = uC + CW + 1, uO = uE + SW + 1;
  room({key: 'spineW', label: 'West corridor', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', role: 'corridor'}, {u: uW, v: vS, w: SW, h: SL}, 'muster', {clear: C.corridor});
  room({key: 'spineE', label: 'East corridor', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', role: 'corridor'}, {u: uE, v: vS, w: SW, h: SL}, 'muster', {clear: C.corridor});
  door('muster', 'spineW', {u: uW, v: vS - 1, w: SW, h: 1}, 'junction', D.junction);
  door('muster', 'spineE', {u: uE, v: vS - 1, w: SW, h: 1}, 'junction', D.junction);

  // centre block: the MESS HALL first (opens onto both spines, sometimes onto the muster corridor too), then 0-2 rows
  const cRows = splitSpan(SL, 12, 18, rng);
  let v = vS;
  cRows.forEach((L, i) => {
    if (i === 0) {
      const r: LRect = {u: uC, v, w: CW, h: L};
      room({key: 'mess', label: 'Mess hall', kind: 'room', type: 'crew-room', purpose: 'staff-room', role: 'hall'}, r, 'spineW');
      doorV('spineW', 'mess', uC - 1, v, v + L, 4, rng.range(0.1, 0.9));
      doorV('spineE', 'mess', uE - 1, v, v + L, 4, rng.range(0.1, 0.9));
      if (rng.chance(0.55)) doorU('muster', 'mess', vS - 1, uC, uC + CW, 6, rng.range(0.3, 0.7));
    } else if (CW >= 26) {
      const wl = Math.floor((CW - 1) / 2) + rng.int(-2, 2), wr = CW - 1 - wl;
      const rl: LRect = {u: uC, v, w: wl, h: L}, rr: LRect = {u: uC + wl + 1, v, w: wr, h: L};
      slots.push({r: rl, parent: 'spineW', open: key => doorV('spineW', key, uC - 1, rl.v, rl.v + L, rng.int(3, 4), rng.next())});
      slots.push({r: rr, parent: 'spineE', open: key => doorV('spineE', key, uE - 1, rr.v, rr.v + L, rng.int(3, 4), rng.next())});
    } else {
      const r: LRect = {u: uC, v, w: CW, h: L};
      slots.push({r, parent: 'spineW', open: key => { doorV('spineW', key, uC - 1, r.v, r.v + L, 3, rng.next()); doorV('spineE', key, uE - 1, r.v, r.v + L, 3, rng.next()); }});
    }
    v += L + 1;
  });
  // outer blocks (open onto their spine)
  for (const [u0, w, sp, wall] of [[1, OW, 'spineW', uW - 1], [uO, OE, 'spineE', uE + SW]] as const) {
    let vv = vS;
    for (const L of splitSpan(SL, 10, 18, rng)) {
      const r: LRect = {u: u0, v: vv, w, h: L};
      slots.push({r, parent: sp, open: key => doorV(sp, key, wall, r.v, r.v + L, rng.int(3, 4), rng.next())});
      vv += L + 1;
    }
  }

  // the generator hall between the spines' outer edges, its two side rooms (switch room / armoury: the dead-end reward)
  const hall: LRect = {u: uW, v: vH, w: uO - 1 - uW, h: GD};
  room({key: 'hall', label: 'Generator hall', kind: 'room', type: 'utility', purpose: 'generator-room', role: 'generator'}, hall, 'spineW', {clear: C.hall});
  door('spineW', 'hall', {u: uW, v: vH - 1, w: SW, h: 1}, 'junction', D.junction);
  door('spineE', 'hall', {u: uE, v: vH - 1, w: SW, h: 1}, 'junction', D.junction);
  const armouryHi = rng.chance(0.5);
  const sideLo: LRect = {u: 1, v: vH, w: OW, h: GD}, sideHi: LRect = {u: uO, v: vH, w: OE, h: GD};
  const sw = armouryHi ? sideLo : sideHi, ar = armouryHi ? sideHi : sideLo;
  room({key: 'switch', label: 'Switch room', kind: 'room', type: 'utility', purpose: 'electrical-room', role: 'room'}, sw, 'hall', {clear: C.side});
  doorV('hall', 'switch', armouryHi ? uW - 1 : uO - 1, vH, vH + GD, 4, rng.range(0.15, 0.5));
  room({key: 'armoury', label: 'Armoury', kind: 'room', type: 'storage', purpose: BUNKER_PURPOSE.armoury, role: 'vault'}, ar, 'hall', {clear: C.side});
  doorV('hall', 'armoury', armouryHi ? uO - 1 : uW - 1, vH, vH + GD, 3, rng.range(0.55, 0.9));

  // --- Assign the free slots: the dormitory the largest, the filtration plant the next, the rest shuffled ---------------------
  const order = slots.map((_, i) => i).sort((p, q) => slots[q].r.w * slots[q].r.h - slots[p].r.w * slots[p].r.h || p - q);
  const rest = rng.shuffle(order.slice(2));
  const assign = [...order.slice(0, 2), ...rest];
  const used = new Map<string, number>();
  assign.forEach((si, k) => {
    const s = slots[si];
    const p = PROGRAM[k] ?? SPARE;
    const n = (used.get(p.key) ?? 0) + 1;
    used.set(p.key, n);
    const key = n > 1 ? `${p.key}${n}` : p.key;
    room({...p, key}, s.r, s.parent);
    s.open(key);
  });

  // --- The generator: mid-hall, long axis along u; its use point 2 cells off one short end ----------------------------------------
  const {w: gw, d: gd} = BUNKER.skid;
  const fu0 = hall.u + Math.round((hall.w - gw) / 2) + rng.int(-2, 2), fv0 = hall.v + Math.round((hall.h - gd) / 2) + rng.int(-1, 1);
  const end: 'lo' | 'hi' = armouryHi ? 'lo' : 'hi'; // the panel end faces the switch room
  const use = {u: end === 'hi' ? fu0 + gw + 1 : fu0 - 2, v: fv0 + Math.floor(gd / 2)};
  return {
    rooms, doors, gen: {foot: {u: fu0, v: fv0, w: gw, h: gd}, use, end}, blast,
    dims: {A, Vd, LD, BW, vM, vS, vH, uW, uE, SW, MW, GD, lock: lockR},
  };
}
