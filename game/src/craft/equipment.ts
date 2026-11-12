// Task studio-train-crafting-v1-20261111-225628-01 (user: "Build the first train-crafting system"): the TRAIN EQUIPMENT records — the
// physical things the train's crafting bench makes (craft/recipes.ts): an additional storage CHEST and three DEVICES (route radar,
// defense sentry, item / enemy scanner). Pure (no three.js / DOM): the kinds and their traits, the save records, their validators and
// the run-side store (TrainEquipment: the units aboard, like run/playerTrain.ts TrainFuel for the fuel carts).
//
// ONE MECHANISM FOR EVERY KIND (user: "Use common physical cargo/container behavior … Do not add a second per-kind cargo whitelist"):
// the world system (world/trainEquipment.ts), the cargo capture / release, the ownership rule, the records and the validators below read
// only a kind's TRAITS (EquipmentDef: how it moves, whether it needs a plug, its storage slots, its ammo hopper). A new kind is one more
// row of EQUIPMENT; nothing lists kinds anywhere else.
//
// OWNERSHIP (the train cargo's rule, fuel/trainPort.ts cartAboard): a unit wholly inside the PARKED car — or riding it as cargo, or in
// the player's hands — is the TRAIN's (TrainEquipmentJSON.aboard: train-local pose; saved with the 'player-train' run participant as
// `equipment`); anything else lies in the STATION it was left in (StationEquipmentJSON.here: world pose + storey, that station's
// STATION_EQUIPMENT_LANE lane store). One uid, one place: save/validate.ts checks each uid once per scope.
//
// IDENTITY / CONTENTS: `uid` ('eq-<n>', n from the run's counter `seq`, never reused) stays with the unit for good. A chest's `slots` are
// ordinary inventory stacks (run/trainLockbox.ts TrainLockbox: uids, counts, magazines, filters, air, bags kept), a sentry's `ammo` its
// loaded rounds, `plug` the train plug a device is connected to (craft/trainFixtures.ts; aboard records only). Nothing is refilled,
// rerolled or invented on load: a malformed record loads as NO equipment (never a free device, chest content or round).

import type {StackJSON} from '../items/inventory';
import {LOCKBOX_SLOTS} from '../run/trainLockbox';

export const EQUIPMENT_KINDS = ['chest', 'radar', 'sentry', 'scanner'] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

/** A kind's traits — everything the shared systems need to know about it. */
export interface EquipmentDef {
  readonly kind: EquipmentKind;
  /** 'Storage chest' / 'the storage chest' (prompts, toasts, the recipe list). */
  readonly name: string;
  readonly the: string;
  /**
   * How the player moves it: 'dolly' — it stands on a hand truck and is grabbed, dragged, pushed and stopped exactly like the fuel dolly
   * (world/fuelCartPhysics.ts); 'carry' — picked up and carried in both hands, put down on free floor.
   */
  readonly move: 'dolly' | 'carry';
  /** Its benefit needs one of the train's plugs (craft/trainFixtures.ts equipmentPlugs). */
  readonly plug: boolean;
  /** Storage slots (0: not storage). */
  readonly slots: number;
  /** Rounds its hopper holds (0: none) and the ammo item it takes. */
  readonly ammoCap: number;
  readonly ammoItem: string | null;
  /** Mass (kg, empty), footprint radius (m) and clear height (m) of its kinematic body. */
  readonly kg: number;
  readonly radius: number;
  readonly height: number;
}

/** The fuel dolly's footprint radius / clear height (fuel/trainPort.ts PORT.cartRadius, world/fuelCartPhysics.ts CART.height): the devices stand on the same hand truck. */
const DOLLY_RADIUS = 0.36, DOLLY_HEIGHT = 1.25;

export const EQUIPMENT: Readonly<Record<EquipmentKind, EquipmentDef>> = Object.freeze({
  chest: Object.freeze({kind: 'chest', name: 'Storage chest', the: 'the storage chest', move: 'carry', plug: false, slots: LOCKBOX_SLOTS, ammoCap: 0, ammoItem: null, kg: 45, radius: 0.4, height: 0.5}),
  radar: Object.freeze({kind: 'radar', name: 'Route radar', the: 'the route radar', move: 'dolly', plug: true, slots: 0, ammoCap: 0, ammoItem: null, kg: 58, radius: DOLLY_RADIUS, height: DOLLY_HEIGHT}),
  sentry: Object.freeze({kind: 'sentry', name: 'Defense sentry', the: 'the defense sentry', move: 'dolly', plug: true, slots: 0, ammoCap: 300, ammoItem: 'ammo_556', kg: 92, radius: DOLLY_RADIUS, height: DOLLY_HEIGHT}),
  scanner: Object.freeze({kind: 'scanner', name: 'Item scanner', the: 'the item scanner', move: 'dolly', plug: true, slots: 0, ammoCap: 0, ammoItem: null, kg: 74, radius: DOLLY_RADIUS, height: DOLLY_HEIGHT}),
} as const);

export const isEquipmentKind = (k: unknown): k is EquipmentKind => typeof k === 'string' && (EQUIPMENT_KINDS as readonly string[]).includes(k);

/**
 * Limits — input-safety bounds of the save format, never truncation points: more than `aboard` units in the car refuses the departure
 * (and a craft) with the numbers; a record beyond a bound is refused as invalid, the game untouched.
 */
export const EQUIPMENT_LIMITS = {aboard: 24, station: 48, plugs: 3, pos: 40, world: 1e5, seq: 1e9} as const;

/** The lane store of the equipment left lying in a station (run memory, per section). */
export const STATION_EQUIPMENT_LANE = 'train-equipment.here';

/** One unit: aboard (train-local pose) or lying in a station (world pose + `level`). */
export interface EquipmentJSON {
  /** 'eq-<n>' — the unit's identity for good. */
  uid: string;
  kind: EquipmentKind;
  /** Footprint centre on the floor it stands on + yaw about +Y (rad). Train-local aboard; world in a station. */
  x: number; y: number; z: number; yaw: number;
  /** Storey (station records only). */
  level?: number;
  /** The train plug it is connected to (aboard records of a `plug` kind only; absent: unplugged). */
  plug?: number;
  /** Storage kinds: exactly def.slots entries. */
  slots?: (StackJSON | null)[];
  /** Hopper kinds: rounds loaded, 0..def.ammoCap. */
  ammo?: number;
}

export interface TrainEquipmentJSON { v: 1; seq: number; aboard: EquipmentJSON[] }
export interface StationEquipmentJSON { v: 1; here: EquipmentJSON[] }

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const UID = /^eq-([1-9]\d{0,8})$/;

/** The counter value of a uid ('eq-12' -> 12; 0 when it is not one). */
export const equipmentSeqOf = (uid: string): number => Number(UID.exec(uid)?.[1] ?? 0);

/**
 * Why a unit record is malformed (null = fine). Shapes and ranges only: a chest's stacks are checked by the save validator with the run's
 * uid set (save/validate.ts), like the Lockbox's.
 */
export function equipmentProblem(r: unknown, station: boolean): string | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'an equipment record must be an object';
  const o = r as Record<string, unknown>;
  if (!isEquipmentKind(o.kind)) return `unknown equipment kind '${String(o.kind).slice(0, 24)}'`;
  const def = EQUIPMENT[o.kind];
  const keys = ['uid', 'kind', 'x', 'y', 'z', 'yaw', ...(station ? ['level'] : def.plug ? ['plug'] : []), ...(def.slots ? ['slots'] : []), ...(def.ammoCap ? ['ammo'] : [])];
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `unexpected ${def.name.toLowerCase()} field '${k.slice(0, 24)}'`;
  if (typeof o.uid !== 'string' || !UID.test(o.uid)) return 'an equipment unit needs an id';
  const pos = station ? EQUIPMENT_LIMITS.world : EQUIPMENT_LIMITS.pos;
  for (const k of ['x', 'y', 'z']) if (!finite(o[k], -pos, pos)) return `${def.name.toLowerCase()} ${k} out of range`;
  if (!finite(o.yaw, -1e6, 1e6)) return `${def.name.toLowerCase()} yaw out of range`;
  if (station && !(Number.isInteger(o.level) && (o.level as number) >= 0 && (o.level as number) < 64)) return `${def.name.toLowerCase()} level out of range`;
  if (o.plug !== undefined && !(Number.isInteger(o.plug) && (o.plug as number) >= 0 && (o.plug as number) < EQUIPMENT_LIMITS.plugs)) return `${def.name.toLowerCase()} plug out of range`;
  if (def.slots) {
    if (!Array.isArray(o.slots) || o.slots.length !== def.slots) return `${def.name.toLowerCase()} needs its ${def.slots} slots`;
  }
  if (def.ammoCap) {
    if (!(Number.isInteger(o.ammo) && (o.ammo as number) >= 0 && (o.ammo as number) <= def.ammoCap)) return `${def.name.toLowerCase()} ammo ${String(o.ammo).slice(0, 16)} out of range (0 to ${def.ammoCap})`;
  }
  return null;
}

function listProblem(list: unknown, station: boolean, max: number, what: string): string | null {
  if (!Array.isArray(list) || list.length > max) return `${what} must be a list of at most ${max} units`;
  const ids = new Set<string>(), plugs = new Set<number>();
  for (const r of list) {
    const p = equipmentProblem(r, station);
    if (p) return p;
    const u = r as EquipmentJSON;
    if (ids.has(u.uid)) return `duplicate equipment unit ${u.uid}`;
    ids.add(u.uid);
    if (u.plug !== undefined) {
      if (plugs.has(u.plug)) return `two units on train plug ${u.plug}`;
      plugs.add(u.plug);
    }
  }
  return null;
}

/** Why a train equipment record ('player-train' participant `equipment`) is malformed (null = fine). */
export function trainEquipmentProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the train equipment record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['v', 'seq', 'aboard'].includes(k)) return `unexpected train equipment field '${k.slice(0, 24)}'`;
  if (o.v !== 1) return 'unsupported train equipment version';
  if (!(Number.isInteger(o.seq) && (o.seq as number) >= 0 && (o.seq as number) <= EQUIPMENT_LIMITS.seq)) return 'train equipment counter out of range';
  const p = listProblem(o.aboard, false, EQUIPMENT_LIMITS.aboard, 'the equipment aboard');
  if (p) return p;
  for (const u of o.aboard as EquipmentJSON[]) if (equipmentSeqOf(u.uid) > (o.seq as number)) return `equipment unit ${u.uid} is newer than the train's counter`;
  return null;
}

/** Why a station's equipment lane (STATION_EQUIPMENT_LANE) is malformed (null = fine). */
export function stationEquipmentProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a station equipment record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['v', 'here'].includes(k)) return `unexpected station equipment field '${k.slice(0, 24)}'`;
  if (o.v !== 1) return 'unsupported station equipment version';
  return listProblem(o.here, true, EQUIPMENT_LIMITS.station, 'the equipment in a station');
}

/** A deep copy of a unit record (its stacks too: plain JSON). */
export function copyEquipment(r: EquipmentJSON): EquipmentJSON {
  const c: EquipmentJSON = {uid: r.uid, kind: r.kind, x: r.x, y: r.y, z: r.z, yaw: r.yaw};
  if (r.level !== undefined) c.level = r.level;
  if (r.plug !== undefined) c.plug = r.plug;
  if (r.slots) c.slots = r.slots.map(s => (s ? JSON.parse(JSON.stringify(s)) as StackJSON : null));
  if (r.ammo !== undefined) c.ammo = r.ammo;
  return c;
}

/** A fresh unit record of `kind` (crafted EMPTY: no stacks, no rounds, unplugged) at a pose. */
export function freshEquipment(kind: EquipmentKind, uid: string, pose: {x: number; y: number; z: number; yaw: number}): EquipmentJSON {
  const def = EQUIPMENT[kind];
  const r: EquipmentJSON = {uid, kind, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw};
  if (def.slots) r.slots = new Array<StackJSON | null>(def.slots).fill(null);
  if (def.ammoCap) r.ammo = 0;
  return r;
}

/** The station lane's records (a missing / malformed lane: none — never invented equipment). */
export function stationEquipmentOf(v: unknown): EquipmentJSON[] {
  return v !== undefined && stationEquipmentProblem(v) === null ? (v as StationEquipmentJSON).here.map(copyEquipment) : [];
}

/** Highest item uid in a unit's stacks (bag contents included). */
function maxStackUid(list: readonly (StackJSON | null)[] | undefined): number {
  let m = 0;
  for (const s of list ?? []) {
    if (!s) continue;
    m = Math.max(m, s.uid);
    for (const c of s.bag ?? []) if (c) m = Math.max(m, c.uid);
  }
  return m;
}

/** What the live world system gives the run record (world/trainEquipment.ts sets TrainEquipment.live). */
export interface TrainEquipmentLive {
  /** The units that are the train's right now (wholly inside the parked car, riding cargo, waiting for a world, in the hands). */
  aboard(): EquipmentJSON[];
  /** Retry / Load / Continue / New Game: the train's units become exactly `aboard` (idempotent; before or after a world exists). */
  restore(aboard: EquipmentJSON[]): void;
}

/**
 * The train's equipment: the uid counter and the units aboard. With a live world system attached (`live`) the truth is the live units
 * (their poses / contents / ammo / plugs at save time); without one (Node, between worlds) the stored records are kept exactly.
 */
export class TrainEquipment {
  /** The run's unit counter: the last number handed out (saved; a Retry restores it with the units). */
  seq = 0;
  private aboard: EquipmentJSON[] = [];
  live: TrainEquipmentLive | null = null;

  /** A new unit id (never reused within a run). */
  nextUid(): string {
    this.seq = Math.min(EQUIPMENT_LIMITS.seq, this.seq + 1);
    return `eq-${this.seq}`;
  }

  /** The units aboard (live when attached, else the stored records). */
  records(): EquipmentJSON[] {
    return (this.live ? this.live.aboard() : this.aboard).map(copyEquipment);
  }

  /** Store the records (the live system hands them back when its world goes). */
  setAboard(a: readonly EquipmentJSON[]): void {
    this.aboard = a.map(copyEquipment);
  }

  toJSON(): TrainEquipmentJSON {
    return {v: 1, seq: this.seq, aboard: this.records()};
  }

  /** Exact load (absent / malformed: NO equipment, the counter at 0 — never an invented unit, stack or round). */
  load(d: unknown): void {
    const ok = d !== undefined && trainEquipmentProblem(d) === null;
    const j = ok ? d as TrainEquipmentJSON : {v: 1 as const, seq: 0, aboard: []};
    this.seq = j.seq;
    this.aboard = j.aboard.map(copyEquipment);
    this.live?.restore(this.aboard.map(copyEquipment));
  }

  reset(): void {
    this.seq = 0;
    this.aboard = [];
    this.live?.restore([]);
  }

  /** Highest item uid held in the chests aboard — the inventory's counter stays above it (Inventory.reserveUids). */
  maxUid(): number {
    let m = 0;
    for (const r of this.live ? this.live.aboard() : this.aboard) m = Math.max(m, maxStackUid(r.slots));
    return m;
  }
}
