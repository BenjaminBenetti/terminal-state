// Task studio-beta-train-loose-cargo-20261107-060450-01 (user: "all items on the train should move with the train, i.e. if I drop an item
// on the train it should come with it, to the next level!"): the TRAIN'S LOOSE CARGO record — every loose item (a world pickup of any
// inventory item: weapons with their magazine, ammo, consumables, gear incl. a mask's filter / an air tank's air, fuel cans …) and every
// grounded bag (a set-down backpack with its contents) that belongs to the train, with its exact ItemStack (uid, count, mag, filter, air,
// bag contents) and its TRAIN-LOCAL pose (gen/playerTrain.ts worldToTrain: x / y / z; `q` = the object's orientation in that frame).
// Pure (no three.js / DOM). The live truth is world/trainCargo.ts (TrainCargo.live, like run/playerTrain.ts TrainFuel.live); without a
// live system (Node, between worlds) the stored records are kept exactly. Saved with the 'player-train' participant (`cargo`; strict:
// save/validate.ts checks every stack with the run's carried / Lockbox uid set). An older save without `cargo` loads EMPTY.
// The fuel carts keep their own cargo (TrainFuel) and the Lockbox its slots: never listed here.
//
// Task studio-beta-train-all-cargo-20261107-184244-01 (user: "Let’s have all items on the train move with the train!"): v2 adds the
// MOVABLE PROPS aboard (`props`: chairs, bins, suitcases, plush, record crates … any loose layout prop lying in the car; world/
// trainPropCargo.ts), each with its canonical identity (the station section + layout index it was generated at, kept for good), its look
// (kind, variant, size, purpose), its integrity and the decor riding it, at its train-local pose. A station keeps the other half of the
// ownership (STATION_PROPS_LANE): the layout props it lost (`gone`, never respawned) and the props left lying there (`here`, world poses).
// A v1 record (items only) loads with no props.

import type {StackJSON} from '../items/inventory';

/** Limits (items / props; train-local metres; a station's lists). */
export const CARGO = {maxItems: 256, pos: 40, maxProps: 96, maxRiders: 16, size: 12, stationProps: 192, gone: 512, world: 1e5} as const;

/** One loose thing aboard: an item lying as a pickup ('item') or a grounded backpack ('bag', with its bag id). */
export interface CargoItemJSON {
  kind: 'item' | 'bag';
  /** A grounded bag's id (gear/system.ts GroundBag.id). */
  id?: string;
  stack: StackJSON;
  /** Train-local position (the pickup's object origin / the bag's pose). */
  x: number; y: number; z: number;
  /** Train-local orientation (quaternion x, y, z, w; a bag: its yaw only). */
  q: [number, number, number, number];
}

/**
 * Task train-all-cargo: decor riding a carried prop (damage/materials.ts ridesHost: garments on a garment rail) — its look and its pose in
 * the host prop's object frame (origin bottom centre).
 */
export interface CargoRiderJSON {
  kind: string;
  variant: number;
  /** Size in its own frame (m): width (x), depth (z), height. */
  w: number; d: number; h: number;
  purpose?: string;
  x: number; y: number; z: number;
  q: [number, number, number, number];
}

/**
 * Task train-all-cargo: one movable layout prop aboard (train cargo: train-local pose) or lying in a station it was carried to (the
 * station's `here` list: world pose + storey).
 */
export interface CargoPropJSON {
  /** Canonical identity: '<section id>#<layout index>' of the generated placement it was (run/memory sectionId). Never changes. */
  id: string;
  kind: string;
  variant: number;
  /** Its size in its own frame (m): width (x), depth (z), height — the placement's scale. */
  w: number; d: number; h: number;
  /** The placement's purpose override (loot / look), when it had one. */
  purpose?: string;
  /** Pose of its object frame (origin bottom centre) + orientation (quaternion x, y, z, w). */
  x: number; y: number; z: number;
  q: [number, number, number, number];
  /** Storey (station records). */
  level?: number;
  /** Integrity left (0..1 of its damage class's), when it took hits. */
  hp?: number;
  /** Decor riding it. */
  riders?: CargoRiderJSON[];
}

export interface TrainCargoJSON { v: 1 | 2; items: CargoItemJSON[]; props?: CargoPropJSON[] }

/** Task train-all-cargo: a station's half of the prop ownership (its section memory lane STATION_PROPS_LANE). */
export const STATION_PROPS_LANE = 'train-cargo.props';
/** A generated layout prop the station lost to the train: its layout index + kind (a revisit hides exactly it; a changed layout: none). */
export interface GonePropJSON { i: number; kind: string }
export interface StationPropsJSON { v: 1; gone: GonePropJSON[]; here: CargoPropJSON[] }

const finite = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const ITEM_KEYS = ['kind', 'id', 'stack', 'x', 'y', 'z', 'q'];
const PROP_KEYS = ['id', 'kind', 'variant', 'w', 'd', 'h', 'purpose', 'x', 'y', 'z', 'q', 'level', 'hp', 'riders'];
const RIDER_KEYS = ['kind', 'variant', 'w', 'd', 'h', 'purpose', 'x', 'y', 'z', 'q'];
/** A prop kind's shape (PROP_DEFS membership is checked by save/validate.ts and the runtime). */
export const PROP_KIND_RE = /^[A-Za-z][A-Za-z0-9]{0,47}$/;
/** '<section id>#<layout index>' (levels/types.ts sectionId: '<station | level>:<section>'). */
export const PROP_ID_RE = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}#\d{1,6}$/;

function quatProblem(q: unknown, what: string): string | null {
  if (!Array.isArray(q) || q.length !== 4 || !q.every(x => finite(x, 1.0001))) return `${what} orientation must be a quaternion`;
  if (Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1) > 1e-3) return `${what} orientation must be a unit quaternion`;
  return null;
}

/** The look fields a prop and a rider share (kind, variant, size, purpose). */
function lookProblem(c: Record<string, unknown>, what: string): string | null {
  if (typeof c.kind !== 'string' || !PROP_KIND_RE.test(c.kind)) return `${what} needs a prop kind`;
  if (typeof c.variant !== 'number' || !Number.isInteger(c.variant) || c.variant < 0 || c.variant > 1e9) return `${what} variant out of range`;
  for (const k of ['w', 'd', 'h']) if (!finite(c[k], CARGO.size) || (c[k] as number) <= 0) return `${what} size ${k} out of range`;
  if (c.purpose !== undefined && (typeof c.purpose !== 'string' || !/^[\x20-\x7e]{1,64}$/.test(c.purpose))) return `${what} purpose is malformed`; // (area purposes, 'waste:<what>', annex keys)
  return null;
}

/**
 * Task train-all-cargo: why a list of carried props is malformed (null = fine). `world`: station records (world poses + a storey) instead
 * of train-local ones. Identities are unique within the list (`ids`: shared across lists by the caller — one prop, one place).
 */
export function propsProblem(v: unknown, o: {world: boolean; max: number; ids?: Set<string>}): string | null {
  if (!Array.isArray(v) || v.length > o.max) return `at most ${o.max} carried props`;
  const ids = o.ids ?? new Set<string>(), lim = o.world ? CARGO.world : CARGO.pos;
  for (const it of v) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return 'a carried prop must be an object';
    const c = it as Record<string, unknown>;
    for (const k of Object.keys(c)) if (!PROP_KEYS.includes(k)) return `unexpected carried prop field '${k}'`;
    if (typeof c.id !== 'string' || !PROP_ID_RE.test(c.id)) return 'a carried prop needs its identity';
    if (ids.has(c.id)) return `carried prop ${c.id} is listed twice`;
    ids.add(c.id);
    const lp = lookProblem(c, 'a carried prop');
    if (lp) return lp;
    for (const k of ['x', 'y', 'z']) if (!finite(c[k], lim)) return `carried prop ${k} out of range`;
    const qp = quatProblem(c.q, 'a carried prop');
    if (qp) return qp;
    if (o.world) { if (typeof c.level !== 'number' || !Number.isInteger(c.level) || c.level < 0 || c.level > 64) return 'a carried prop needs its storey'; }
    else if (c.level !== undefined) return 'a carried prop aboard has no storey';
    if (c.hp !== undefined && (!finite(c.hp, 1) || (c.hp as number) < 0)) return 'carried prop integrity out of range';
    if (c.riders !== undefined) {
      if (!Array.isArray(c.riders) || !c.riders.length || c.riders.length > CARGO.maxRiders) return `a carried prop has 1..${CARGO.maxRiders} riders`;
      for (const r0 of c.riders) {
        if (!r0 || typeof r0 !== 'object' || Array.isArray(r0)) return 'a rider must be an object';
        const r = r0 as Record<string, unknown>;
        for (const k of Object.keys(r)) if (!RIDER_KEYS.includes(k)) return `unexpected rider field '${k}'`;
        const rp = lookProblem(r, 'a rider');
        if (rp) return rp;
        for (const k of ['x', 'y', 'z']) if (!finite(r[k], CARGO.size)) return `rider ${k} out of range`;
        const rq = quatProblem(r.q, 'a rider');
        if (rq) return rq;
      }
    }
  }
  return null;
}

/** Task train-all-cargo: why a station's prop record is malformed (null = fine). */
export function stationPropsProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the station prop record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'gone' && k !== 'here') return `unexpected station prop field '${k}'`;
  if (o.v !== 1) return 'unsupported station prop record version';
  if (!Array.isArray(o.gone) || o.gone.length > CARGO.gone) return `a station lists at most ${CARGO.gone} props gone`;
  const seen = new Set<number>();
  for (const g of o.gone) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return 'a gone prop must be an object';
    const r = g as Record<string, unknown>;
    for (const k of Object.keys(r)) if (k !== 'i' && k !== 'kind') return `unexpected gone prop field '${k}'`;
    if (typeof r.i !== 'number' || !Number.isInteger(r.i) || r.i < 0 || r.i > 999999) return 'a gone prop needs its layout index';
    if (seen.has(r.i)) return `gone prop ${r.i} is listed twice`;
    seen.add(r.i);
    if (typeof r.kind !== 'string' || !PROP_KIND_RE.test(r.kind)) return 'a gone prop needs its kind';
  }
  return propsProblem(o.here, {world: true, max: CARGO.stationProps});
}

/**
 * Why a cargo record is malformed (null = fine): its SHAPE (kinds, ids, poses, a unit quaternion, at most CARGO.maxItems). The stacks
 * themselves (items, counts, uids unique run-wide, mags / filters / air / bag contents) are checked by save/validate.ts.
 */
export function cargoProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the train cargo must be an object';
  const o = v as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return 'unsupported train cargo version';
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'items' && !(k === 'props' && o.v === 2)) return `unexpected train cargo field '${k}'`;
  if (!Array.isArray(o.items) || o.items.length > CARGO.maxItems) return `train cargo must list at most ${CARGO.maxItems} items`;
  const ids = new Set<string>();
  for (const it of o.items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return 'a train cargo item must be an object';
    const c = it as Record<string, unknown>;
    for (const k of Object.keys(c)) if (!ITEM_KEYS.includes(k)) return `unexpected train cargo item field '${k}'`;
    if (c.kind !== 'item' && c.kind !== 'bag') return 'a train cargo item is an item or a bag';
    if (c.kind === 'bag') {
      if (typeof c.id !== 'string' || !c.id.length || c.id.length > 64) return 'a cargo bag needs an id';
      if (ids.has(c.id)) return `duplicate cargo bag ${c.id}`;
      ids.add(c.id);
    } else if (c.id !== undefined) return 'a cargo item has no id';
    if (!c.stack || typeof c.stack !== 'object' || Array.isArray(c.stack)) return 'a train cargo item needs its stack';
    for (const k of ['x', 'y', 'z']) if (!finite(c[k], CARGO.pos)) return `train cargo ${k} out of range`;
    const q = c.q;
    if (!Array.isArray(q) || q.length !== 4 || !q.every(x => finite(x, 1.0001))) return 'a train cargo orientation must be a quaternion';
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    if (Math.abs(n - 1) > 1e-3) return 'a train cargo orientation must be a unit quaternion';
  }
  if (o.v === 2) return propsProblem(o.props, {world: false, max: CARGO.maxProps}); // task train-all-cargo
  return null;
}

const copy = <T>(c: T): T => structuredClone(c);

/**
 * The train's loose cargo. With a live cargo system attached (`live`, world/trainCargo.ts) the truth is the live items (riding cargo,
 * the train-owned pickups / bags in the parked car, records waiting for a world) at save time; without one the stored records.
 */
export class TrainCargo {
  private items: CargoItemJSON[] = [];
  /** Task train-all-cargo: the movable props aboard (stored records). */
  private propRecs: CargoPropJSON[] = [];
  live: {cargo(): CargoItemJSON[]; restore(items: CargoItemJSON[]): void} | null = null;
  /** Task train-all-cargo: the live prop cargo (world/trainPropCargo.ts), like `live`. */
  liveProps: {props(): CargoPropJSON[]; restoreProps(props: CargoPropJSON[]): void} | null = null;

  /** The items aboard (live when attached, else the stored records). Copies. */
  records(): CargoItemJSON[] {
    return (this.live ? this.live.cargo() : this.items).map(copy);
  }

  /** Store records (the live system hands them back when its world goes / a load without a live system). */
  setRecords(items: readonly CargoItemJSON[]): void {
    this.items = items.map(copy);
  }

  /** Task train-all-cargo: the props aboard (live when attached, else the stored records). Copies. */
  props(): CargoPropJSON[] {
    return (this.liveProps ? this.liveProps.props() : this.propRecs).map(copy);
  }

  setProps(props: readonly CargoPropJSON[]): void {
    this.propRecs = props.map(copy);
  }

  toJSON(): TrainCargoJSON {
    return {v: 2, items: this.records(), props: this.props()};
  }

  /** Exact load (absent / malformed: EMPTY — an older save; never invented items). A v1 record: its items, no props. */
  load(d: unknown): void {
    const ok = d !== undefined && cargoProblem(d) === null;
    this.items = ok ? (d as TrainCargoJSON).items.map(copy) : [];
    this.propRecs = ok ? ((d as TrainCargoJSON).props ?? []).map(copy) : [];
    this.live?.restore(this.items.map(copy));
    this.liveProps?.restoreProps(this.propRecs.map(copy));
  }

  reset(): void {
    this.items = [];
    this.propRecs = [];
    this.live?.restore([]);
    this.liveProps?.restoreProps([]);
  }
}

/** Task train-all-cargo: the props listed in a raw (validated or not) cargo record — model prefetch for a save not yet installed. */
export function cargoPropsOf(d: unknown): CargoPropJSON[] {
  return d !== undefined && cargoProblem(d) === null ? ((d as TrainCargoJSON).props ?? []).map(copy) : [];
}

/** Task train-all-cargo: a station's prop record (absent / malformed: none — nothing hidden, nothing invented). */
export function stationPropsOf(d: unknown): StationPropsJSON {
  return d !== undefined && stationPropsProblem(d) === null ? copy(d as StationPropsJSON) : {v: 1, gone: [], here: []};
}
