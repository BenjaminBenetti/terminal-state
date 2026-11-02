// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY — the PROGRAM (pure planning in a local frame) and its
// carving into the shared Kit. Contract: ./types.ts (ComplexSlot / ComplexCarve). Pure data; draws only from the given rng.
//
// Task studio-reactor-playtest-round2-20261102 (lane WASTE), user: "the layout of reactor / reactor side areas is much to normal right
// now. Just like the subway it should be random! with logical rooms flowing in to one another!" — the plan is a SEEDED ROOM GRAPH, not
// a fixed band layout. Every generation GROWS a new facility from the entrance, in the order a real repository is entered:
//
//   deck ─> RECEIVING BAY ─> HEALTH-PHYSICS CHECKPOINT ─> DOSIMETRY & CHANGE ROOM ═heavy═> VAULT AIRLOCK ═heavy═> SEALED VAULT
//            │   (truck dock)      (decon booths)               (lockers)                                        CORRIDORS
//            │                                                                              (straight runs, turns, branches, dead ends)
//            ├─ the CONTROL ROOM off the bay / checkpoint / change room                       ├─ DRUM VAULT(S)  (racks)
//            └─ the SERVICE SIDE: a service corridor (or a door) to the GENERATOR &           ├─ COMPACTOR & PROCESSING ─ HOT-CELL GALLERY
//               VENTILATION PLANT (zone 2's aux generator), its sump / switch room            └─ DRY-CASK HALL (casks in a grid)
//
// What varies per seed: the bay's size and where the entrance meets it, which side the checkpoint / change room / control room take,
// the airlock's direction, the controlled corridor network (2-4 segments: straight runs, L turns, T branches off a run's middle), where
// the drum vault / cask hall / compactor hang off it (each hall's size and orientation), the optional rooms (a second drum vault, the
// hot-cell gallery, the sump & pump room, a switch room, stores in leftover rock), the service side (corridor or a direct door, the
// plant's position), the extra doors that close loops (goods doors from the bay into a vault / the cask hall, plant maintenance doors
// into the controlled side, vault <-> compactor …), the switchgear's home (control room, plant or switch room) and the frame's mirror.
// What never varies: the program's logic (the controlled area is entered ONLY through heavy / wide doors: the airlock or a goods
// shutter; the plant is reached from the clean side without crossing it), >= 2 independent loops, every space connected, the
// required spaces, the generator skid + use clearance in the plant, real sizes (rooms 3.4 m, corridors 3 m wide, halls up to the slot).
//
// LOCAL FRAME: u runs ALONG the pit wall the complex opens from, v runs INWARD (away from the shaft deck). The slot's region maps onto
// (u, v) by its `inward` side, optionally mirrored along u (seeded). Rooms are rects with exactly one wall cell between neighbours;
// doors are one-cell gaps in those walls.

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

/** What a space IS (its function: the dress hook furnishes by it). */
export type WasteKind =
  | 'bay' | 'hp' | 'lockers' | 'control' | 'airlock' | 'corridor' | 'vault' | 'compactor' | 'hotcell' | 'cask'
  | 'service' | 'plant' | 'pump' | 'switch' | 'store';
/** Which side of the controlled-area boundary a space lies on. */
export type WasteZone = 'clean' | 'controlled' | 'service';
/** A space's key: its kind, numbered when a kind repeats ('vault', 'vault2', 'k1', 'k2', 'store1' …). */
export type WasteKey = string;

/** Ceiling class of a space: rooms 3.4 m, corridors 3.2 m, the plant 4.8 m, halls 6 m, the cask hall as tall as the slot allows. */
export type WasteClear = 'room' | 'corr' | 'plant' | 'hall' | 'tall';
export const WASTE_CLEAR: Readonly<Record<WasteClear, number>> = {room: 3.4, corr: 3.2, plant: 4.8, hall: 6.0, tall: 7.5};

export interface WasteKindSpec {
  zone: WasteZone;
  kind: AreaKind;
  type: RoomType;
  /** Existing purpose (gen/purposes.ts ROOM_PURPOSES): loot tables, light odds, the station dresser's furnishing rules. */
  purpose: string;
  label: string;
  role: ComplexRoom['role'];
  clear: WasteClear;
}

/** The program's vocabulary: existing room types / purposes, so loot, spawns, lighting and materials work unchanged. */
export const WASTE_KINDS: Readonly<Record<WasteKind, WasteKindSpec>> = {
  bay: {zone: 'clean', kind: 'room', type: 'storage', purpose: 'storage', label: 'Receiving bay', role: 'entry', clear: 'hall'},
  hp: {zone: 'clean', kind: 'room', type: 'crew-room', purpose: 'first-aid-room', label: 'Health-physics checkpoint', role: 'room', clear: 'room'},
  lockers: {zone: 'clean', kind: 'room', type: 'crew-room', purpose: 'locker-room', label: 'Dosimetry & change room', role: 'room', clear: 'room'},
  control: {zone: 'clean', kind: 'room', type: 'utility', purpose: 'signal-room', label: 'Repository control room', role: 'room', clear: 'room'},
  airlock: {zone: 'controlled', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', label: 'Vault airlock', role: 'corridor', clear: 'corr'},
  corridor: {zone: 'controlled', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', label: 'Sealed vault corridor', role: 'corridor', clear: 'corr'},
  // (the drum vault: the anchored-stores hall purpose the cask hall uses — wall lockers / a spares shelf / a crate, no floor scatter:
  // the hall's floor is the racks')
  vault: {zone: 'controlled', kind: 'room', type: 'storage', purpose: 'turbine-hall', label: 'Drum vault A', role: 'hall', clear: 'hall'},
  compactor: {zone: 'controlled', kind: 'room', type: 'utility', purpose: 'custodial-room', label: 'Compactor & processing', role: 'room', clear: 'plant'},
  hotcell: {zone: 'controlled', kind: 'room', type: 'utility', purpose: 'workshop', label: 'Hot-cell gallery', role: 'room', clear: 'room'},
  cask: {zone: 'controlled', kind: 'room', type: 'storage', purpose: 'turbine-hall', label: 'Dry-cask hall', role: 'vault', clear: 'tall'},
  service: {zone: 'service', kind: 'service', type: 'service-corridor', purpose: 'service-corridor', label: 'Service corridor', role: 'corridor', clear: 'corr'},
  plant: {zone: 'service', kind: 'room', type: 'utility', purpose: 'generator-room', label: 'Generator & ventilation plant', role: 'generator', clear: 'plant'},
  pump: {zone: 'service', kind: 'room', type: 'utility', purpose: 'pump-room', label: 'Sump & pump room', role: 'room', clear: 'room'},
  switch: {zone: 'service', kind: 'room', type: 'utility', purpose: 'electrical-room', label: 'Switch room', role: 'room', clear: 'room'},
  store: {zone: 'clean', kind: 'room', type: 'storage', purpose: 'storage', label: 'Records store', role: 'store', clear: 'room'},
};

/** A store's function by the zone it opens off (leftover rock becomes the store its neighbourhood needs). */
const STORE_OF: Readonly<Record<WasteZone, {label: string; purpose: string; type: RoomType}>> = {
  clean: {label: 'Records store', purpose: 'storage', type: 'storage'},
  controlled: {label: 'Spares store', purpose: 'storage', type: 'storage'},
  service: {label: 'Filter room', purpose: 'ventilation-plant', type: 'utility'},
};

/** One planned space. */
export interface WasteRoom {
  key: WasteKey;
  kind: WasteKind;
  zone: WasteZone;
  label: string;
  type: RoomType;
  purpose: string;
  r: LRect;
  /** The room it was grown off (its tree door); '' = the entrance deck. */
  parent: WasteKey;
  /** The dress frame's first axis (s) runs along local u (else along v): the vault's rack rows, the plant's skid, a corridor's run. */
  alongU: boolean;
}

export type WasteDoorKind = 'personnel' | 'wide' | 'heavy';
export interface WasteDoorSpec {
  a: WasteKey; b: WasteKey; w: number; h: number; t: number; kind: WasteDoorKind;
  /** A door that closes a loop (not the room's tree door). */
  loop: boolean;
}

export interface WastePlan {
  frame: WasteFrame;
  rooms: WasteRoom[];
  /** Rooms by key. */
  by: Record<WasteKey, WasteRoom>;
  doors: WasteDoorSpec[];
  /** The entrance span in local cells ([u0, u1) at row v; v < the bay's first row). */
  entrance: {u0: number; u1: number; v: number};
  /** Generator skid footprint (long axis along the plant's long side) and the use cell (one free cell beyond the skid's end). */
  gen: {foot: LRect; use: [number, number]};
  /** Rooms the switchgear tries first, in order (seeded: the control room, the plant or the switch room). */
  switchgear: WasteKey[];
  /** The drum vaults' rack rows run along the vault's long axis (else across it, off a spine aisle), per vault key. */
  racksAlong: Record<WasteKey, boolean>;
  /** QA: planning attempts used, independent loops, dead-end spaces. */
  stats: {attempts: number; loops: number; deadEnds: number};
}

/** Program limits (cells). The region is used up to UMAX x VMAX (a bigger slot keeps rock round the program). */
export const WASTE_LIMITS = {UMIN: 62, VMIN: 56, UMAX: 96, VMAX: 82} as const;
/** Planning attempts before the carver gives up (each one draws on, deterministic). */
export const WASTE_ATTEMPTS = 60;
/** Why planning attempts were rejected (QA / tests: which step of the program ran out of rock). */
export const WASTE_PLAN_FAILS: Record<string, number> = {};
const no = (why: string): null => { WASTE_PLAN_FAILS[why] = (WASTE_PLAN_FAILS[why] ?? 0) + 1; return null; };
/** Corridor width (cells): 3 m. */
const CW = 6;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Plans the program in the slot's region. `ent` = the entrance span (canvas rect, 1 cell deep). Null when the region (or the
 * entrance's position) cannot hold it. Deterministic in `rng`.
 */
export function planWaste(region: Rect, inward: Side, ent: Rect, rng: Rng): WastePlan | null {
  const f = new WasteFrame(region, inward, rng.chance(0.5));
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
  if (eu0 < 3 || eu1 > f.U - 3) return null;
  // the program box along u: as centred on the entrance as the region allows
  const ub0 = clamp(Math.round((eu0 + eu1) / 2 - Uw / 2), 1, f.U - 1 - Uw);
  const box: LRect = {u: ub0, v: v0, du: Uw, dv: Vw};
  const entrance = {u0: eu0, u1: eu1, v: ev};
  for (let k = 1; k <= WASTE_ATTEMPTS; k++) {
    const p = attempt(f, box, entrance, rng, k > WASTE_ATTEMPTS * 2 / 3);
    if (p) { p.stats.attempts = k; return p; }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The packer: rooms as local rects, one wall cell between neighbours

/** A side of a rect: 0 = u-, 1 = u+, 2 = v- (toward the entrance), 3 = v+ (inward). */
type S4 = 0 | 1 | 2 | 3;
const LATERAL: Readonly<Record<S4, [S4, S4]>> = {0: [2, 3], 1: [2, 3], 2: [0, 1], 3: [0, 1]};

interface Want {
  /** Long / short side ranges (cells). */
  long: [number, number];
  short: [number, number];
  /** The long side lies along the parent's wall ('along'), runs away from it ('deep') or either (seeded). */
  orient?: 'along' | 'deep' | 'any';
  /** Placement preference (added to the packing score). */
  bonus?: (r: LRect) => number;
}
interface DoorReq { w: number; h: number; kind: WasteDoorKind }

const PERSONNEL: DoorReq = {w: 4, h: 2.4, kind: 'personnel'};
const JUNCTION: DoorReq = {w: 4, h: 2.8, kind: 'personnel'};
const HEAVY: DoorReq = {w: 5, h: 2.8, kind: 'heavy'};
const HEAVY_NARROW: DoorReq = {w: 4, h: 2.8, kind: 'heavy'};
const CASK_DOOR: DoorReq = {w: 6, h: 3.6, kind: 'heavy'};
const GOODS: DoorReq = {w: 8, h: 3.6, kind: 'wide'};

/** Size caps (long, short) of the grow pass by kind (corridors / the airlock never grow: their runs are planned). */
const CAP: Readonly<Partial<Record<WasteKind, [number, number]>>> = {
  bay: [34, 22], hp: [20, 18], lockers: [18, 14], control: [20, 16], vault: [52, 22], compactor: [22, 18], hotcell: [16, 13],
  cask: [34, 28], plant: [28, 24], pump: [16, 14], switch: [13, 12], store: [16, 14],
};

class Packer {
  rooms: WasteRoom[] = [];
  by: Record<WasteKey, WasteRoom> = {};
  doors: WasteDoorSpec[] = [];
  /** Corridor runs: the side of each one's far end (its head). */
  heads: Record<WasteKey, S4> = {};
  constructor(readonly box: LRect, readonly rng: Rng) {}

  /** Inside the box and one wall cell (at least) from every other room. */
  ok(r: LRect, skip?: WasteKey): boolean {
    const b = this.box;
    if (r.du < 1 || r.dv < 1 || r.u < b.u || r.v < b.v || r.u + r.du > b.u + b.du || r.v + r.dv > b.v + b.dv) return false;
    for (const q of this.rooms) {
      if (q.key === skip) continue;
      const s = q.r;
      if (r.u + r.du + 1 <= s.u || s.u + s.du + 1 <= r.u || r.v + r.dv + 1 <= s.v || s.v + s.dv + 1 <= r.v) continue;
      return false;
    }
    return true;
  }

  /** How many of the rect's sides are flush with the box edge or one wall from a room (tight packing leaves room for the halls). */
  tight(r: LRect, skip?: WasteKey): number {
    const b = this.box;
    let n = 0;
    if (r.u === b.u || this.rooms.some(q => q.key !== skip && q.r.u + q.r.du + 1 === r.u && ov(q.r.v, q.r.dv, r.v, r.dv) > 0)) n++;
    if (r.u + r.du === b.u + b.du || this.rooms.some(q => q.key !== skip && r.u + r.du + 1 === q.r.u && ov(q.r.v, q.r.dv, r.v, r.dv) > 0)) n++;
    if (r.v === b.v || this.rooms.some(q => q.key !== skip && q.r.v + q.r.dv + 1 === r.v && ov(q.r.u, q.r.du, r.u, r.du) > 0)) n++;
    if (r.v + r.dv === b.v + b.dv || this.rooms.some(q => q.key !== skip && r.v + r.dv + 1 === q.r.v && ov(q.r.u, q.r.du, r.u, r.du) > 0)) n++;
    return n;
  }

  /** Rects `a` along x `d` deep on side s of p, sharing >= `share` cells of wall with it (every offset). */
  slide(p: LRect, s: S4, a: number, d: number, share: number): LRect[] {
    const out: LRect[] = [];
    const alongU = s === 2 || s === 3, p0 = alongU ? p.u : p.v, pl = alongU ? p.du : p.dv;
    for (let o = p0 + share - a; o <= p0 + pl - share; o++) out.push(sideRect(p, s, o, a, d));
    return out;
  }

  add(key: WasteKey, kind: WasteKind, r: LRect, parent: WasteKey, alongU: boolean, zone?: WasteZone): WasteRoom {
    const sp = WASTE_KINDS[kind], z = zone ?? sp.zone;
    const st = kind === 'store' ? STORE_OF[z] : null;
    const room: WasteRoom = {key, kind, zone: z, label: st?.label ?? sp.label, type: st?.type ?? sp.type, purpose: st?.purpose ?? sp.purpose, r, parent, alongU};
    this.rooms.push(room);
    this.by[key] = room;
    return room;
  }

  door(a: WasteKey, b: WasteKey, d: DoorReq, loop: boolean, t?: number): void {
    this.doors.push({a, b, w: d.w, h: d.h, t: t ?? this.rng.range(0.15, 0.85), kind: d.kind, loop});
  }

  /**
   * Grows room `key` off `parent` on the first of `sides` that fits (sizes drawn from `want`, shrunk toward their minimum when nothing
   * fits), the best packing candidate of every offset; the tree door `door` joins them. Null when no side fits.
   */
  attach(key: WasteKey, kind: WasteKind, parent: WasteKey, sides: readonly S4[], want: Want, door: DoorReq, zone?: WasteZone): WasteRoom | null {
    const P = this.by[parent];
    if (!P) return null;
    const share = door.w + 2;
    for (const s of sides) {
      const L = this.rng.int(want.long[0], want.long[1]), S = this.rng.int(want.short[0], want.short[1]);
      const o = want.orient ?? 'any';
      const along = o === 'along' || (o === 'any' && this.rng.chance(0.5));
      for (let k = 0; k < 3; k++) {
        const Lk = Math.max(want.long[0], L - k * Math.ceil((L - want.long[0]) / 2)), Sk = Math.max(want.short[0], S - k * Math.ceil((S - want.short[0]) / 2));
        const a = along ? Lk : Sk, d = along ? Sk : Lk;
        const r = this.best(this.slide(P.r, s, a, d, share), want.bonus);
        if (r) {
          const room = this.add(key, kind, r, parent, r.du >= r.dv, zone);
          this.door(parent, key, door, false);
          return room;
        }
        if (Lk === want.long[0] && Sk === want.short[0]) break;
      }
    }
    return null;
  }

  /** The valid candidate with the best packing score (+ bonus, + a seeded jitter). */
  best(cands: readonly LRect[], bonus?: (r: LRect) => number): LRect | null {
    let best: LRect | null = null, bs = -Infinity;
    for (const r of cands) {
      if (!this.ok(r)) continue;
      const sc = this.tight(r) + (bonus ? bonus(r) : 0) + this.rng.next() * 0.9;
      if (sc > bs) { bs = sc; best = r; }
    }
    return best;
  }

  /** How far (cells, <= max) a corridor of width CW could run from `r`'s side s, starting at along-offset o. */
  reach(r: LRect, s: S4, o: number, max = 32): number {
    let lo = 0, hi = max;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.ok(sideRect(r, s, o, CW, m))) lo = m; else hi = m - 1;
    }
    return lo;
  }

  /**
   * A corridor run of `len` cells off corridor / room `from`: 'straight' continues a corridor out of its head, 'turn' leaves a corridor's
   * head end sideways, 'branch' leaves a run's middle sideways, 'side' leaves a room's side. The best of the offsets by how far the run
   * could go on (open rock ahead) and packing. Null when nothing fits.
   */
  corridor(key: WasteKey, kind: WasteKind, from: WasteKey, mode: 'straight' | 'turn' | 'branch' | 'side', len: [number, number], door: DoorReq, sides?: readonly S4[]): WasteRoom | null {
    const P = this.by[from];
    if (!P) return null;
    const head = this.heads[from], r = P.r;
    const opts: {s: S4; o: number}[] = [];
    if (mode === 'straight' && head !== undefined) opts.push({s: head, o: head === 2 || head === 3 ? r.u : r.v});
    else if (mode === 'turn' && head !== undefined) {
      for (const s of LATERAL[head]) {
        // flush with the head end of the run
        const runU = head === 0 || head === 1;
        const o = runU ? (head === 1 ? r.u + r.du - CW : r.u) : (head === 3 ? r.v + r.dv - CW : r.v);
        opts.push({s, o});
      }
    } else if (mode === 'branch' && head !== undefined) {
      const runU = head === 0 || head === 1, p0 = runU ? r.u : r.v, pl = runU ? r.du : r.dv;
      for (const s of LATERAL[head]) for (let o = p0 + 3; o <= p0 + pl - CW - 3; o += 2) opts.push({s, o});
    } else if (mode === 'side') {
      for (const s of sides ?? [0, 1, 2, 3] as S4[]) {
        const alongU = s === 2 || s === 3, p0 = alongU ? r.u : r.v, pl = alongU ? r.du : r.dv;
        for (let o = p0 + 1; o <= p0 + pl - CW - 1; o++) opts.push({s, o});
      }
    }
    if (!opts.length) return null;
    const want = this.rng.int(len[0], len[1]);
    let best: {s: S4; o: number; d: number} | null = null, bs = -Infinity;
    for (const {s, o} of opts) {
      const d = this.reach(r, s, o, Math.max(want, 34));
      if (d < len[0]) continue;
      const dd = Math.min(d, want);
      const sc = Math.min(d, 34) / 8 + this.tight(sideRect(r, s, o, CW, dd)) * 0.5 + this.rng.next();
      if (sc > bs) { bs = sc; best = {s, o, d: dd}; }
    }
    if (!best) return null;
    const rr = sideRect(r, best.s, best.o, CW, best.d);
    const room = this.add(key, kind, rr, from, best.s === 0 || best.s === 1);
    this.heads[key] = best.s;
    this.door(from, key, door, false, 0.5);
    return room;
  }

  /** Grows a room one cell at a time on every side while it fits, up to its kind's caps. */
  grow(room: WasteRoom): void {
    const cap = CAP[room.kind];
    if (!cap) return;
    const order = this.rng.shuffle([0, 1, 2, 3] as S4[]);
    for (let moved = true; moved;) {
      moved = false;
      for (const s of order) {
        const r = room.r, n: LRect = s === 0 ? {...r, u: r.u - 1, du: r.du + 1} : s === 1 ? {...r, du: r.du + 1} : s === 2 ? {...r, v: r.v - 1, dv: r.dv + 1} : {...r, dv: r.dv + 1};
        if (Math.max(n.du, n.dv) > cap[0] || Math.min(n.du, n.dv) > cap[1] || !this.ok(n, room.key)) continue;
        room.r = n;
        moved = true;
      }
    }
  }
}

/** Overlap length of two 1D spans. */
const ov = (a0: number, al: number, b0: number, bl: number) => Math.min(a0 + al, b0 + bl) - Math.max(a0, b0);

/** The rect `a` along x `d` deep on side s of p, its along-range starting at o. */
function sideRect(p: LRect, s: S4, o: number, a: number, d: number): LRect {
  switch (s) {
    case 0: return {u: p.u - 1 - d, v: o, du: d, dv: a};
    case 1: return {u: p.u + p.du + 1, v: o, du: d, dv: a};
    case 2: return {u: o, v: p.v - 1 - d, du: a, dv: d};
    default: return {u: o, v: p.v + p.dv + 1, du: a, dv: d};
  }
}

// ---------------------------------------------------------------------------------------------
// One planning attempt

/** One attempt; `relax` (the last third of the attempts): the halls' minimum sizes and the floor target a little lower. */
function attempt(f: WasteFrame, box: LRect, ent: {u0: number; u1: number; v: number}, rng: Rng, relax: boolean): WastePlan | null {
  const P = new Packer(box, rng);
  const sh = <T>(a: T[]) => rng.shuffle(a);
  const deepBonus = (w: number) => (r: LRect) => w * (r.v + r.dv / 2 - box.v) / box.dv;
  // --- 1. the receiving bay over the entrance (the entrance anywhere along its front wall, 2 cells off its corners)
  const bayDu = rng.int(20, 30), bayDv = rng.int(14, 20);
  const lo = Math.max(box.u, ent.u1 + 2 - bayDu), hi = Math.min(box.u + box.du - bayDu, ent.u0 - 2);
  if (hi < lo) return no('bay');
  P.add('bay', 'bay', {u: rng.int(lo, hi), v: box.v, du: bayDu, dv: bayDv}, '', true);
  // --- 2. the health-physics checkpoint beside the bay (often front-aligned), sometimes behind it; the change room off it
  const frontAligned = rng.chance(0.6);
  const hpSides = sh([0, 1] as S4[]);
  if (rng.chance(0.25)) hpSides.unshift(3); else hpSides.push(3);
  if (!P.attach('hp', 'hp', 'bay', hpSides, {long: [13, 18], short: [12, 16], bonus: r => (frontAligned && r.v === box.v ? 2 : 0)}, PERSONNEL)) return no('hp');
  // the service side first on some seeds (the plant then claims its corner before the vaults)
  const serviceFirst = rng.chance(0.45);
  if (serviceFirst && !service(P, rng, box)) return no('service');
  if (!P.attach('lockers', 'lockers', 'hp', sh([0, 1, 2, 3] as S4[]), {long: [10, 15], short: [9, 13], bonus: deepBonus(1.5)}, PERSONNEL)) return no('lockers');
  // --- 3. the airlock out of the change room (heavy doors both ends), into open rock (inward preferred)
  if (!P.corridor('airlock', 'airlock', 'lockers', 'side', [8, 13], HEAVY_NARROW, sh([0, 1, 3] as S4[]).concat([2]))) return no('airlock');
  // --- 4. the sealed vault corridors: runs (straight on, an L turn, a T branch off a run's middle) from the airlock's head, grown as
  // the halls need them (a hall that fits nowhere gets a new run toward open rock), then a few more toward the target count
  const corrs: WasteKey[] = [];
  const addRun = (bases: readonly WasteKey[]): WasteKey | null => {
    const key = `k${corrs.length + 1}`, first = !corrs.length;
    for (const base of bases) for (const m of sh<'straight' | 'turn' | 'branch'>(base === 'airlock' ? ['straight', 'turn'] : ['straight', 'turn', 'branch', 'branch'])) {
      if (P.corridor(key, 'corridor', base, m, first ? [10, 30] : [10, 26], first ? HEAVY_NARROW : JUNCTION)) { corrs.push(key); return key; }
    }
    return null;
  };
  /** Takes back the last room (and its tree door) when it is `key`. */
  const undo = (key: WasteKey) => {
    if (P.rooms[P.rooms.length - 1]?.key !== key) return;
    P.rooms.pop(); delete P.by[key]; delete P.heads[key]; P.doors.pop();
    const i = corrs.indexOf(key);
    if (i >= 0) corrs.splice(i, 1);
  };
  const runBases = () => { const c = sh(corrs.slice()); if (corrs.length && rng.chance(0.6)) c.unshift(corrs[corrs.length - 1]); return [...new Set(c)]; };
  if (!addRun(['airlock'])) return no('corridor');
  const runs = rng.int(2, 4);
  // --- 5. the halls off the corridors: the dry-cask hall, the drum vault, the compactor (each the first corridor side that fits)
  const hallOff = (key: WasteKey, kind: WasteKind, want: Want, door: DoorReq, via: readonly WasteKey[]): boolean => {
    for (const c of via) if (P.attach(key, kind, c, sh([0, 1, 2, 3] as S4[]), want, door)) return true;
    return false;
  };
  const hall = (key: WasteKey, kind: WasteKind, want: Want, door: DoorReq, extra: readonly WasteKey[] = []): boolean => {
    if (hallOff(key, kind, want, door, [...sh(corrs.slice()), ...extra])) return true;
    for (let k = 0; k < 2 && corrs.length < 5; k++) {
      const run = addRun(runBases());
      if (!run) return false;
      if (hallOff(key, kind, want, door, [run])) return true;
      undo(run);
    }
    return false;
  };
  const halls: [WasteKey, WasteKind, Want, DoorReq][] = [
    ['cask', 'cask', {long: [relax ? 22 : 24, 32], short: [21, 26]}, CASK_DOOR],
    ['vault', 'vault', {long: [relax ? 28 : 32, 46], short: [16, 22], orient: rng.chance(0.7) ? 'along' : 'any'}, HEAVY],
  ];
  for (const [key, kind, want, door] of rng.chance(0.5) ? halls : halls.reverse()) if (!hall(key, kind, want, door)) return no(key);
  while (corrs.length < runs) if (!addRun(runBases())) break;
  if (!hall('compactor', 'compactor', {long: [15, 20], short: [13, 17]}, PERSONNEL, ['vault'])) return no('compactor');
  const onCorr = () => sh(corrs.slice());
  // --- 6. the control room off the clean side (the bay, the checkpoint or the change room)
  {
    let ok = false;
    for (const p of sh(['bay', 'hp', 'lockers'])) if (P.attach('control', 'control', p, sh([0, 1, 2, 3] as S4[]), {long: [12, 18], short: [10, 14]}, PERSONNEL)) { ok = true; break; }
    if (!ok) return no('control');
  }
  // --- 7. the service side (when not first)
  if (!serviceFirst && !service(P, rng, box)) return no('service');
  // --- 8. optional spaces: a second drum vault, the hot-cell gallery, the sump & pump room, a switch room
  if (rng.chance(0.45)) {
    const via = rng.chance(0.5) ? ['vault', ...onCorr()] : [...onCorr(), 'vault'];
    for (const p of via) if (P.attach('vault2', 'vault', p, sh([0, 1, 2, 3] as S4[]), {long: [22, 32], short: [16, 18], orient: 'along'}, p === 'vault' ? {w: 6, h: 3.6, kind: 'wide'} : HEAVY)) { P.by.vault2.label = 'Drum vault B'; break; }
  }
  if (rng.chance(0.55)) for (const p of sh(['compactor', 'cask', ...corrs])) if (P.attach('hotcell', 'hotcell', p, sh([0, 1, 2, 3] as S4[]), {long: [11, 14], short: [9, 12]}, PERSONNEL)) break;
  if (rng.chance(0.6)) for (const p of sh(['plant', ...(P.by.service ? ['service'] : [])])) if (P.attach('pump', 'pump', p, sh([0, 1, 2, 3] as S4[]), {long: [10, 14], short: [10, 13]}, PERSONNEL)) break;
  if (rng.chance(0.45)) for (const p of sh(['plant', 'control', ...(P.by.service ? ['service'] : [])])) if (P.attach('switch', 'switch', p, sh([0, 1, 2, 3] as S4[]), {long: [9, 12], short: [8, 11]}, PERSONNEL, 'service')) break;
  // --- 9. grow every room into the rock round it (halls first), then stores into the pockets left (dead ends)
  const growOrder = ['cask', 'vault', 'vault2', 'plant', 'compactor', 'bay', 'hp', 'control', 'lockers', 'hotcell', 'pump', 'switch'];
  for (const k of growOrder) if (P.by[k]) P.grow(P.by[k]);
  let stores = 0;
  const hosts = sh(P.rooms.filter(r => r.kind !== 'airlock' && r.kind !== 'store').map(r => r.key));
  for (const h of hosts) {
    if (stores >= 3) break;
    const host = P.by[h], key = `store${stores + 1}`;
    const s = P.attach(key, 'store', h, sh([0, 1, 2, 3] as S4[]), {long: [9, 14], short: [8, 11]}, PERSONNEL, host.zone);
    if (!s) continue;
    P.grow(s);
    if (s.r.du * s.r.dv < 72) { P.rooms.pop(); delete P.by[key]; P.doors.pop(); continue; }
    stores++;
  }
  // --- 10. loops: extra doors where the grown rooms now share a wall and the function allows one
  loops(P, rng);
  // --- the graph: connected (by construction), >= 2 independent loops, the substance
  const cyc = P.doors.length - P.rooms.length + 1;
  if (cyc < 2) return no('loops');
  let cells = 0;
  for (const r of P.rooms) cells += r.r.du * r.r.dv;
  // (~900 m² in the host's 40 x 32 m slot; a smaller region asks for the same share of its box)
  if (cells < Math.min(relax ? 3300 : 3600, box.du * box.dv * (relax ? 0.62 : 0.7))) return no('floor');
  // --- 11. the zone generator in the plant: the skid along the plant's long side, the use point on its main door's side
  const pl = P.by.plant.r, pd = P.doors.find(d => d.b === 'plant' && !d.loop);
  const g = pd ? doorGapL(P.by[pd.a].r, pl, pd.w, pd.t) : null;
  if (!g) return no('plant-door');
  const gen = placeGen(pl, [g.u + g.du / 2, g.v + g.dv / 2]);
  if (!gen) return no('generator');
  // every door's gap exists on the final rects
  for (const d of P.doors) if (!doorGapL(P.by[d.a].r, P.by[d.b].r, d.w, d.t)) return no('door');
  // the dress frames: the bay / cask hall in the complex frame (front = the entrance side), a vault's rack rows along or across it
  const racksAlong: Record<WasteKey, boolean> = {};
  for (const r of P.rooms) {
    if (r.kind === 'bay' || r.kind === 'cask' || r.kind === 'hp' || r.kind === 'lockers') r.alongU = true;
    // (rows across the hall need its short side >= 9 m: three bays between the end aisles)
    else if (r.kind === 'vault') { racksAlong[r.key] = Math.min(r.r.du, r.r.dv) < 18 || rng.chance(0.72); r.alongU = (r.r.du >= r.r.dv) === racksAlong[r.key]; }
    else r.alongU = r.r.du >= r.r.dv;
  }
  const sg = sh(['control', 'plant']);
  if (P.by.switch && rng.chance(0.75)) sg.unshift('switch');
  const deg = new Map<string, number>();
  for (const d of P.doors) { deg.set(d.a, (deg.get(d.a) ?? 0) + 1); deg.set(d.b, (deg.get(d.b) ?? 0) + 1); }
  const deadEnds = P.rooms.filter(r => (deg.get(r.key) ?? 0) + (r.key === 'bay' ? 1 : 0) === 1).length;
  return {frame: f, rooms: P.rooms, by: P.by, doors: P.doors, entrance: ent, gen, switchgear: sg, racksAlong, stats: {attempts: 0, loops: cyc, deadEnds}};
}

/** The service side: a service corridor off the bay / the control room to the plant (or the plant straight off the bay). */
function service(P: Packer, rng: Rng, box: LRect): boolean {
  const plantWant: Want = {long: [18, 26], short: [16, 22], bonus: r => 0.8 * (r.v + r.dv / 2 - box.v) / box.dv};
  const sh = <T>(a: T[]) => rng.shuffle(a);
  const from = sh(['bay', ...(P.by.control ? ['control'] : [])]);
  if (rng.chance(0.72)) {
    for (const p of from) {
      if (!P.corridor('service', 'service', p, 'side', [6, 24], PERSONNEL, sh([0, 1, 3] as S4[]))) continue;
      const off = (c: WasteKey) => { const h = P.heads[c]; return P.attach('plant', 'plant', c, sh([h, ...LATERAL[h]]), plantWant, HEAVY); };
      if (off('service')) return true;
      // a second leg (on, or round a corner) toward open rock
      for (const m of sh<'turn' | 'straight'>(['turn', 'straight'])) {
        if (!P.corridor('service2', 'service', 'service', m, [6, 20], PERSONNEL)) continue;
        if (off('service2')) return true;
        P.rooms.pop(); delete P.by.service2; delete P.heads.service2; P.doors.pop();
      }
      // the corridor led nowhere: take it back
      P.rooms.pop(); delete P.by.service; delete P.heads.service; P.doors.pop();
    }
  }
  for (const p of from) if (P.attach('plant', 'plant', p, sh([0, 1, 3] as S4[]), plantWant, HEAVY)) return true;
  return false;
}

/** Which kinds may share an extra door (a loop), with what door and how likely. Never clean <-> controlled except a goods shutter. */
function loopDoor(a: WasteRoom, b: WasteRoom): {d: DoorReq; p: number} | null {
  const k = (x: WasteKind, y: WasteKind) => (a.kind === x && b.kind === y) || (a.kind === y && b.kind === x);
  const z = (x: WasteZone, y: WasteZone) => (a.zone === x && b.zone === y) || (a.zone === y && b.zone === x);
  if (a.kind === 'store' || b.kind === 'store' || a.kind === 'airlock' || b.kind === 'airlock') return null;
  if (k('bay', 'vault')) return {d: GOODS, p: 0.85};
  if (k('bay', 'cask')) return {d: GOODS, p: 0.7};
  if (z('clean', 'controlled')) return null;
  if (z('service', 'controlled')) return {d: HEAVY, p: 0.55}; // plant maintenance doors into the controlled side
  if (k('vault', 'vault')) return {d: {w: 6, h: 3.6, kind: 'wide'}, p: 0.8};
  if (k('vault', 'compactor') || k('hotcell', 'compactor') || k('hotcell', 'cask')) return {d: PERSONNEL, p: 0.65};
  if (k('corridor', 'corridor')) return {d: JUNCTION, p: 0.7};
  if (k('corridor', 'vault') || k('corridor', 'cask') || k('corridor', 'compactor') || k('corridor', 'hotcell')) return {d: k('corridor', 'cask') ? CASK_DOOR : HEAVY, p: 0.35};
  if (k('vault', 'cask')) return {d: {w: 6, h: 3.6, kind: 'wide'}, p: 0.5};
  if (k('control', 'hp') || k('control', 'lockers') || k('control', 'bay') || k('hp', 'lockers')) return {d: PERSONNEL, p: 0.5};
  if (k('bay', 'plant') || k('bay', 'service')) return {d: HEAVY, p: 0.45};
  if (z('service', 'service') || z('clean', 'service')) return {d: PERSONNEL, p: 0.4};
  return null;
}

/** Extra doors between rooms that share a wall (one per pair), seeded; then more of them if fewer than two loops closed. */
function loops(P: Packer, rng: Rng): void {
  const has = new Set(P.doors.map(d => pairKey(d.a, d.b)));
  const cands: {a: WasteRoom; b: WasteRoom; d: DoorReq; p: number}[] = [];
  for (let i = 0; i < P.rooms.length; i++) for (let j = i + 1; j < P.rooms.length; j++) {
    const a = P.rooms[i], b = P.rooms[j];
    if (has.has(pairKey(a.key, b.key))) continue;
    const L = loopDoor(a, b);
    if (!L) continue;
    const s = sharedWallL(a.r, b.r);
    if (!s || s.s1 - s.s0 < L.d.w + 2) continue;
    cands.push({a, b, ...L});
  }
  // a hall takes at most one loop door (every door cuts a cross aisle through the racks / the cask grid)
  const hallLoops = new Map<WasteKey, number>();
  const room = (c: {a: WasteRoom; b: WasteRoom}) => [c.a, c.b].every(r => (r.kind !== 'vault' && r.kind !== 'cask') || !hallLoops.get(r.key));
  const open = (c: {a: WasteRoom; b: WasteRoom; d: DoorReq}) => {
    P.door(c.a.key, c.b.key, c.d, true);
    has.add(pairKey(c.a.key, c.b.key));
    for (const r of [c.a, c.b]) hallLoops.set(r.key, (hallLoops.get(r.key) ?? 0) + 1);
  };
  const skipped: typeof cands = [];
  for (const c of cands) {
    if (!room(c)) continue;
    if (rng.chance(c.p)) open(c); else skipped.push(c);
  }
  // fewer than two loops: the likeliest skipped ones close them
  skipped.sort((x, y) => y.p - x.p);
  for (const c of skipped) {
    if (P.doors.length - P.rooms.length + 1 >= 2) break;
    if (room(c)) open(c);
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The generator in the plant: the skid (8 x 4 cells = 4 x 2 m) along the plant's long side in its middle, its use cell one free cell
 * beyond the skid's end on the main door's side, >= 5 cells (2.5 m) from the end walls (wall fittings + their access strips never
 * reach it), the back strip deep enough for the fans.
 */
function placeGen(pl: LRect, doorAt: [number, number]): {foot: LRect; use: [number, number]} | null {
  const alongU = pl.du >= pl.dv;
  const S = alongU ? pl.du : pl.dv, T = alongU ? pl.dv : pl.du, s0 = alongU ? pl.u : pl.v, t0 = alongU ? pl.v : pl.u;
  const lowSide = (alongU ? doorAt[0] : doorAt[1]) < s0 + S / 2;
  const slack = Math.max(0, Math.floor((S - 17) / 2));
  const fs = lowSide ? s0 + 7 + slack : s0 + S - 15 - slack;
  const ft = t0 + Math.max(4, Math.floor((T - 4) / 2) + 1);
  if (ft + 4 > t0 + T - 3) return null;
  const us = lowSide ? fs - 2 : fs + 9, ut = ft + 2;
  if (us - 5 < s0 || us + 5 >= s0 + S || fs < s0 + 2 || fs + 8 > s0 + S - 2) return null;
  return alongU ? {foot: {u: fs, v: ft, du: 8, dv: 4}, use: [us, ut]} : {foot: {u: ft, v: fs, du: 4, dv: 8}, use: [ut, us]};
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
