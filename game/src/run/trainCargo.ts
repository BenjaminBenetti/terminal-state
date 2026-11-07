// Task studio-beta-train-loose-cargo-20261107-060450-01 (user: "all items on the train should move with the train, i.e. if I drop an item
// on the train it should come with it, to the next level!"): the TRAIN'S LOOSE CARGO record — every loose item (a world pickup of any
// inventory item: weapons with their magazine, ammo, consumables, gear incl. a mask's filter / an air tank's air, fuel cans …) and every
// grounded bag (a set-down backpack with its contents) that belongs to the train, with its exact ItemStack (uid, count, mag, filter, air,
// bag contents) and its TRAIN-LOCAL pose (gen/playerTrain.ts worldToTrain: x / y / z; `q` = the object's orientation in that frame).
// Pure (no three.js / DOM). The live truth is world/trainCargo.ts (TrainCargo.live, like run/playerTrain.ts TrainFuel.live); without a
// live system (Node, between worlds) the stored records are kept exactly. Saved with the 'player-train' participant (`cargo`; strict:
// save/validate.ts checks every stack with the run's carried / Lockbox uid set). An older save without `cargo` loads EMPTY.
// The fuel carts keep their own cargo (TrainFuel) and the Lockbox its slots: never listed here.

import type {StackJSON} from '../items/inventory';

/** Limits (items; train-local metres). */
export const CARGO = {maxItems: 256, pos: 40} as const;

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

export interface TrainCargoJSON { v: 1; items: CargoItemJSON[] }

const finite = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const ITEM_KEYS = ['kind', 'id', 'stack', 'x', 'y', 'z', 'q'];

/**
 * Why a cargo record is malformed (null = fine): its SHAPE (kinds, ids, poses, a unit quaternion, at most CARGO.maxItems). The stacks
 * themselves (items, counts, uids unique run-wide, mags / filters / air / bag contents) are checked by save/validate.ts.
 */
export function cargoProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the train cargo must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'items') return `unexpected train cargo field '${k}'`;
  if (o.v !== 1) return 'unsupported train cargo version';
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
  return null;
}

const copy = (c: CargoItemJSON): CargoItemJSON => structuredClone(c);

/**
 * The train's loose cargo. With a live cargo system attached (`live`, world/trainCargo.ts) the truth is the live items (riding cargo,
 * the train-owned pickups / bags in the parked car, records waiting for a world) at save time; without one the stored records.
 */
export class TrainCargo {
  private items: CargoItemJSON[] = [];
  live: {cargo(): CargoItemJSON[]; restore(items: CargoItemJSON[]): void} | null = null;

  /** The items aboard (live when attached, else the stored records). Copies. */
  records(): CargoItemJSON[] {
    return (this.live ? this.live.cargo() : this.items).map(copy);
  }

  /** Store records (the live system hands them back when its world goes / a load without a live system). */
  setRecords(items: readonly CargoItemJSON[]): void {
    this.items = items.map(copy);
  }

  toJSON(): TrainCargoJSON {
    return {v: 1, items: this.records()};
  }

  /** Exact load (absent / malformed: EMPTY — an older save; never invented items). */
  load(d: unknown): void {
    const ok = d !== undefined && cargoProblem(d) === null;
    this.items = ok ? (d as TrainCargoJSON).items.map(copy) : [];
    this.live?.restore(this.items.map(copy));
  }

  reset(): void {
    this.items = [];
    this.live?.restore([]);
  }
}
