// Task studio-train-crafting-v1-20261111-225628-01 (user: "Build the first train-crafting system"): the TRAIN EQUIPMENT records — the
// physical things the train's crafting bench makes (craft/recipes.ts): an additional storage CHEST and three DEVICES (route radar,
// defense sentry, item / enemy scanner). Pure (no three.js / DOM): the kinds and their traits, the save records, their validators and
// the run-side store (TrainEquipment: the units aboard, like run/playerTrain.ts TrainFuel for the fuel carts).
//
// ONE MECHANISM FOR EVERY KIND (user: "Use common physical cargo/container behavior … Do not add a second per-kind cargo whitelist"):
// the world system (world/trainEquipment.ts), the cargo capture / release, the ownership rule, the records and the validators below read
// only a kind's TRAITS (EquipmentDef: how it moves, whether it needs a plug, its storage slots and the one item they take). A new kind is
// one more row of EQUIPMENT; nothing lists kinds anywhere else.
//
// OWNERSHIP (the train cargo's rule, fuel/trainPort.ts cartAboard): a unit wholly inside the PARKED car — or riding it as cargo, or in
// the player's hands — is the TRAIN's (TrainEquipmentJSON.aboard: train-local pose; saved with the 'player-train' run participant as
// `equipment`); anything else lies in the STATION it was left in (StationEquipmentJSON.here: world pose + storey, that station's
// STATION_EQUIPMENT_LANE lane store). One uid, one place: save/validate.ts checks each uid once per scope.
//
// IDENTITY / CONTENTS: `uid` ('eq-<n>', n from the run's counter `seq`, never reused) stays with the unit for good. A unit's `slots` are
// ordinary inventory stacks (run/trainLockbox.ts TrainLockbox: uids, counts, magazines, filters, air, bags kept): a chest's 50 take
// anything, a sentry's SENTRY_FEED_SLOTS take only its rounds (`slotItem`: the turret fires them out of these stacks). `plug` is the
// train plug a device is connected to (craft/trainFixtures.ts; aboard records only). Nothing is refilled, rerolled or invented on load:
// a malformed record loads as NO equipment (never a free device, chest content or round).
//
// Task train-interaction-ux-20261112-063646 (lane SENTRY; user: "Replace the sentry's take-all-ammo interaction with a real FOUR-SLOT
// inventory … Preserve every existing hopper round safely on migration"): the sentry's round counter (`ammo`, 0..300) became four
// ordinary slots. A record written before that still carries `ammo` (and no `slots`): it stays VALID for good, and its rounds become
// real stacks in the live unit's slots, uids from the live inventory, the first time the unit stands in a played world (world/
// trainEquipment.ts adoptLegacyAmmo) — every round, none twice. Until then a save writes the count back as it was.
//
// Task studio-scanner-console-refinements-20261114-031614-01 (user: "Handle old scanner records safely with an All default; persist the
// selected mode appropriately"): a kind may have DISPLAY MODES (EquipmentDef.displayModes — the item scanner's: craft/scanner.ts
// SCAN_MODES; every other kind none). The unit's selected one is its record's `display`, written ONLY when it is not the kind's first
// (default) mode: a record without it — every record written before the modes, and every unit still on its default — loads with the
// default (ALL), and those records stay byte-for-byte what they were. A `display` the kind does not have is malformed, like any other
// bad field. The field is the mode's NAME, never an index: task studio-scanner-medical-20261114-054010-01 appended 'medical' and every
// older record's mode still means what it did.

import type {StackJSON} from '../items/inventory';
import {LOCKBOX_SLOTS} from '../run/trainLockbox';
import {SCAN_MODES} from './scanner';

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
  /**
   * The ONE item its slots take (a feed: the sentry's rounds, which its turret fires out of these stacks), or null: every item
   * (general storage — a chest; the bench draws materials only from these).
   */
  readonly slotItem: string | null;
  /**
   * Records of this kind written before it had slots carried a round counter `ammo` of 0..legacyAmmoCap (0: the kind never had one).
   * Only the validators and the one-time adoption of those rounds read it.
   */
  readonly legacyAmmoCap: number;
  /**
   * The modes its display can be switched between, the first the default (empty: none) — the scanner's resource filters. A record holds
   * the selected one as `display` only when it is not the first.
   */
  readonly displayModes: readonly string[];
  /** Mass (kg, empty), footprint radius (m) and clear height (m) of its kinematic body. */
  readonly kg: number;
  readonly radius: number;
  readonly height: number;
}

/** The sentry's feed: four ordinary slots of its rounds (the item's own stack limit each). */
export const SENTRY_FEED_SLOTS = 4;

/** The fuel dolly's footprint radius / clear height (fuel/trainPort.ts PORT.cartRadius, world/fuelCartPhysics.ts CART.height): the devices stand on the same hand truck. */
const DOLLY_RADIUS = 0.36, DOLLY_HEIGHT = 1.25;

export const EQUIPMENT: Readonly<Record<EquipmentKind, EquipmentDef>> = Object.freeze({
  chest: Object.freeze({kind: 'chest', name: 'Storage chest', the: 'the storage chest', move: 'carry', plug: false, slots: LOCKBOX_SLOTS, slotItem: null, legacyAmmoCap: 0, displayModes: [], kg: 45, radius: 0.4, height: 0.5}),
  radar: Object.freeze({kind: 'radar', name: 'Route radar', the: 'the route radar', move: 'dolly', plug: true, slots: 0, slotItem: null, legacyAmmoCap: 0, displayModes: [], kg: 58, radius: DOLLY_RADIUS, height: DOLLY_HEIGHT}),
  sentry: Object.freeze({kind: 'sentry', name: 'Defense sentry', the: 'the defense sentry', move: 'dolly', plug: true, slots: SENTRY_FEED_SLOTS, slotItem: 'ammo_556', legacyAmmoCap: 300, displayModes: [], kg: 92, radius: DOLLY_RADIUS, height: DOLLY_HEIGHT}),
  scanner: Object.freeze({kind: 'scanner', name: 'Item scanner', the: 'the item scanner', move: 'dolly', plug: true, slots: 0, slotItem: null, legacyAmmoCap: 0, displayModes: SCAN_MODES, kg: 74, radius: DOLLY_RADIUS, height: DOLLY_HEIGHT}),
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
  /** Storage kinds: exactly def.slots entries (a feed kind's stacks are all its def.slotItem). */
  slots?: (StackJSON | null)[];
  /**
   * LEGACY (kinds with def.legacyAmmoCap): rounds counted before the kind had slots, 0..def.legacyAmmoCap — not yet turned into stacks.
   * Such a record may have no `slots`. Never written for a unit whose rounds are all in its slots.
   */
  ammo?: number;
  /** Kinds with def.displayModes: the selected mode when it is not the first (absent: the first — ALL for the scanner). */
  display?: string;
}

export interface TrainEquipmentJSON { v: 1; seq: number; aboard: EquipmentJSON[] }
export interface StationEquipmentJSON { v: 1; here: EquipmentJSON[] }

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const UID = /^eq-([1-9]\d{0,8})$/;

/** The counter value of a uid ('eq-12' -> 12; 0 when it is not one). */
export const equipmentSeqOf = (uid: string): number => Number(UID.exec(uid)?.[1] ?? 0);

/**
 * Why a unit record is malformed (null = fine). Shapes and ranges only: the stacks are checked by the save validator with the run's
 * uid set (save/validate.ts), like the Lockbox's — here only that a feed kind's stacks are its own item.
 */
export function equipmentProblem(r: unknown, station: boolean): string | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'an equipment record must be an object';
  const o = r as Record<string, unknown>;
  if (!isEquipmentKind(o.kind)) return `unknown equipment kind '${String(o.kind).slice(0, 24)}'`;
  const def = EQUIPMENT[o.kind];
  const keys = ['uid', 'kind', 'x', 'y', 'z', 'yaw', ...(station ? ['level'] : def.plug ? ['plug'] : []), ...(def.slots ? ['slots'] : []), ...(def.legacyAmmoCap ? ['ammo'] : []),
    ...(def.displayModes.length ? ['display'] : [])];
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `unexpected ${def.name.toLowerCase()} field '${k.slice(0, 24)}'`;
  if (typeof o.uid !== 'string' || !UID.test(o.uid)) return 'an equipment unit needs an id';
  const pos = station ? EQUIPMENT_LIMITS.world : EQUIPMENT_LIMITS.pos;
  for (const k of ['x', 'y', 'z']) if (!finite(o[k], -pos, pos)) return `${def.name.toLowerCase()} ${k} out of range`;
  if (!finite(o.yaw, -1e6, 1e6)) return `${def.name.toLowerCase()} yaw out of range`;
  if (station && !(Number.isInteger(o.level) && (o.level as number) >= 0 && (o.level as number) < 64)) return `${def.name.toLowerCase()} level out of range`;
  if (o.plug !== undefined && !(Number.isInteger(o.plug) && (o.plug as number) >= 0 && (o.plug as number) < EQUIPMENT_LIMITS.plugs)) return `${def.name.toLowerCase()} plug out of range`;
  if (o.display !== undefined && !(typeof o.display === 'string' && def.displayModes.includes(o.display))) return `${def.name.toLowerCase()} has no display mode '${String(o.display).slice(0, 24)}'`;
  if (o.ammo !== undefined) {
    if (!(Number.isInteger(o.ammo) && (o.ammo as number) >= 0 && (o.ammo as number) <= def.legacyAmmoCap)) return `${def.name.toLowerCase()} ammo ${String(o.ammo).slice(0, 16)} out of range (0 to ${def.legacyAmmoCap})`;
  }
  if (def.slots) {
    // (a record from before the kind had slots: its legacy round count stands in for them)
    const legacy = o.slots === undefined && o.ammo !== undefined;
    if (!legacy && (!Array.isArray(o.slots) || o.slots.length !== def.slots)) return `${def.name.toLowerCase()} needs its ${def.slots} slots`;
    if (def.slotItem && !legacy) {
      for (const st of o.slots as unknown[]) {
        if (st !== null && (typeof st !== 'object' || (st as {itemId?: unknown}).itemId !== def.slotItem)) return `${def.name.toLowerCase()} slots take only ${def.slotItem}`;
      }
    }
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
  if (r.display !== undefined) c.display = r.display;
  return c;
}

/** A unit's display mode from its record's `display` (absent / not one of the kind's: the kind's first; '' for a kind without modes). */
export function equipmentDisplay(def: EquipmentDef, v: unknown): string {
  return typeof v === 'string' && def.displayModes.includes(v) ? v : def.displayModes[0] ?? '';
}

/** A fresh unit record of `kind` (crafted EMPTY: no stacks, no rounds, unplugged) at a pose. */
export function freshEquipment(kind: EquipmentKind, uid: string, pose: {x: number; y: number; z: number; yaw: number}): EquipmentJSON {
  const def = EQUIPMENT[kind];
  const r: EquipmentJSON = {uid, kind, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw};
  if (def.slots) r.slots = new Array<StackJSON | null>(def.slots).fill(null);
  return r;
}

/**
 * The rounds a feed kind's record holds: its slots' stacks of def.slotItem plus a legacy `ammo` count not yet turned into stacks
 * (0 for every other kind). The one definition of "how many rounds is this record worth" (readouts, tests, the migration's proof).
 */
export function equipmentRounds(r: EquipmentJSON): number {
  const def = EQUIPMENT[r.kind];
  if (!def?.slotItem) return 0;
  let n = def.legacyAmmoCap > 0 && Number.isFinite(r.ammo) ? Math.max(0, Math.floor(r.ammo as number)) : 0;
  for (const st of r.slots ?? []) if (st && st.itemId === def.slotItem) n += st.count;
  return n;
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
 * (their poses / contents / plugs at save time); without one (Node, between worlds) the stored records are kept exactly.
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

  /** Highest item uid held in the units aboard (chests, feed slots) — the inventory's counter stays above it (Inventory.reserveUids). */
  maxUid(): number {
    let m = 0;
    for (const r of this.live ? this.live.aboard() : this.aboard) m = Math.max(m, maxStackUid(r.slots));
    return m;
  }
}
