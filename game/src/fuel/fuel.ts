// Task studio-beta-train-fuel-system-20261106-024923-01 (user-confirmed design, 2026-11-06): TRAIN FUEL — the pure core (no three.js / DOM).
//
// Units: one QUARTER of the train's tank is the unit everything counts in (integers only: no partial cans, no float drift).
//   - the train's built-in tank holds FUEL.tankUnits (4 = one tank = ONE hop); a New Game starts EMPTY (0);
//   - every actual track EDGE travelled costs FUEL.hopUnits (4), a multi-hop route hops x 4 — paid once, at departure;
//   - a fuel CAN (`fuel_can`, an ordinary inventory item: pockets / quick slots / bags / the train chest) holds FUEL.canUnits (1),
//     stacks to FUEL.canStackMax (2): two slots carry a full tank;
//   - an optional FUEL CART (a hand truck with a drum: a physical, wheeled world object; never an inventory item) holds up to
//     FUEL.cartUnits (8 = two tanks); not guaranteed anywhere.
// Station fuel: every network station has a deterministic FuelPlan (its own RNG namespace over the network seed — never the layout /
//   loot / enemy streams) of at least FUEL.stationMinUnits (one tank) in total: the cart's fuel COUNTS toward it. It is realized ONCE,
//   on the station's first build, and is finite from then on (the station's memory remembers what is left: never re-rolled or refilled
//   on a revisit).
//   Task studio-beta-fuel-feedback-20261106-064128-01 (user feedback: "about 4 tanks average per level, distributed as standard loot"):
//   plan v2 (FUEL_PLAN) — total = min + two uniform rolls (a triangular spread: average 4 tanks, now and then a lean or a rich station);
//   a station rich enough may carry its optional cart (8 of its units) and still has cans. Every can is ONE loot lot / ONE pickup
//   (gen/fuelHolders.ts: on shelves, counters and in storage — never a stack of two shown as one can). The v1 plan
//   (stationFuelPlanV1) stays only to size the one-time additive delta for stations a v1 save already realized.
// Departure: the route cost is drawn from the RESERVES ABOARD — the tank, then the carts fully inside the car (uid order), then the fuel
//   cans in the train chest (slot order). Pockets, bags, the ground and carts outside the car are never drawn automatically. The exact
//   draw is recorded (FuelDebit) with the pending journey so a failed journey that brings the train back refunds exactly that, and a
//   reload of the departure save never charges twice. The map 1337 cheat waives the cost (cheat runs only).
import {Rng, hashString} from '../core/rng';
import type {ItemStack} from '../items/inventory';

export const FUEL = {
  /** Train tank capacity in quarter units (one tank = one hop). */
  tankUnits: 4,
  /** Cost of one track edge (one hop), quarter units. */
  hopUnits: 4,
  /** One fuel can, quarter units. */
  canUnits: 1,
  /** Fuel cans per inventory slot. */
  canStackMax: 2,
  /** A full fuel cart (hand truck + drum), quarter units (two tanks). */
  cartUnits: 8,
  /** Every station's initial fuel in total, at least (one tank). */
  stationMinUnits: 4,
  /** The fuel can item id. */
  canItem: 'fuel_can',
} as const;

/**
 * Plan v2 (task fuel-feedback): total units = FUEL.stationMinUnits + two independent rolls of 0..rollMax (a triangular spread around the
 * average 4 + rollMax = 16 units = 4 tanks; 4 .. 28). A station with at least cartMinTotal units carries its cart with cartChance (the
 * cart's 8 units are PART of the total, the rest are cans: a cart station is never "a cart and nothing else" below cartMinTotal).
 */
export const FUEL_PLAN = {
  version: 2,
  rollMax: 12,
  cartChance: 0.25,
  cartMinTotal: 12,
} as const;

export type StationId = string;

/** A station's initial fuel (deterministic per network seed + station id). `units` = cans x canUnits + cart. */
export interface FuelPlan { units: number; cans: number; cart: number }

/** The station's initial fuel plan (pure: no world generation; the map shows it for known, unvisited stations). */
export function stationFuelPlan(networkSeed: number, station: StationId): FuelPlan {
  const rng = new Rng(hashString(`fuel-plan-v2:${station}`, (networkSeed >>> 0) ^ 0x5f3759df));
  const units = FUEL.stationMinUnits + rng.int(0, FUEL_PLAN.rollMax) + rng.int(0, FUEL_PLAN.rollMax);
  const cart = units >= FUEL_PLAN.cartMinTotal && rng.next() < FUEL_PLAN.cartChance ? FUEL.cartUnits : 0;
  return {units, cans: (units - cart) / FUEL.canUnits, cart};
}

/**
 * The v1 plan (task train-fuel-system, released): only to size the ONE additive delta a station realized under v1 receives (v2 units
 * minus these, never negative). Exactly the old rolls: 12 % a full cart and no cans, else 4 cans +0 / +1 / +2 (0.7 / 0.2 / 0.1).
 */
export function stationFuelPlanV1(networkSeed: number, station: StationId): FuelPlan {
  const rng = new Rng(hashString(`fuel-plan:${station}`, (networkSeed >>> 0) ^ 0x5f3759df));
  if (rng.next() < 0.12) return {units: FUEL.cartUnits, cans: 0, cart: FUEL.cartUnits};
  const extra = rng.weighted([['0', 0.7], ['1', 0.2], ['2', 0.1]] as [string, number][]);
  const cans = FUEL.stationMinUnits / FUEL.canUnits + Number(extra);
  return {units: cans * FUEL.canUnits, cans, cart: 0};
}

/** Route cost of `hops` track edges (quarter units); 0 when the cheat waives it. */
export function routeCost(hops: number, cheat = false): number {
  return cheat ? 0 : Math.max(0, Math.floor(hops)) * FUEL.hopUnits;
}

/** Fuel units in fuel-can stacks of a slot list (the train chest / a bag / an inventory list). */
export function canUnitsIn(slots: readonly (ItemStack | null | undefined)[]): number {
  let n = 0;
  for (const s of slots) if (s && s.itemId === FUEL.canItem) n += s.count * FUEL.canUnits;
  return n;
}

/** A cart's live fuel (`units`, 0..FUEL.cartUnits) and its stable run-wide id. */
export interface CartFuel { uid: string; units: number }

/** What the train can draw from right now. */
export interface FuelReserves { tank: number; carts: number; chest: number; total: number }

export function reservesOf(tank: number, cartsAboard: readonly CartFuel[], chest: readonly (ItemStack | null)[]): FuelReserves {
  const carts = cartsAboard.reduce((s, c) => s + Math.max(0, c.units), 0), ch = canUnitsIn(chest), t = Math.max(0, tank);
  return {tank: t, carts, chest: ch, total: t + carts + ch};
}

/** Exactly what a departure took (refundable): tank units, units per cart, cans per chest stack (by item uid). */
export interface FuelDebit { tank: number; carts: {uid: string; units: number}[]; chest: {uid: number; count: number}[] }

export const debitUnits = (d: FuelDebit): number => d.tank + d.carts.reduce((s, c) => s + c.units, 0) + d.chest.reduce((s, c) => s + c.count * FUEL.canUnits, 0);

/**
 * The draw for `cost` (pure; nothing changes): the tank first, then the carts aboard in uid order, then the chest's fuel cans in slot
 * order (whole cans: a can is never split — the unit IS a can). Null when the reserves are short.
 */
export function planDebit(cost: number, tank: number, cartsAboard: readonly CartFuel[], chest: readonly (ItemStack | null)[]): FuelDebit | null {
  let need = Math.max(0, Math.floor(cost));
  const d: FuelDebit = {tank: 0, carts: [], chest: []};
  const t = Math.min(need, Math.max(0, tank));
  d.tank = t; need -= t;
  for (const c of [...cartsAboard].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))) {
    if (!need) break;
    const u = Math.min(need, Math.max(0, c.units));
    if (u > 0) { d.carts.push({uid: c.uid, units: u}); need -= u; }
  }
  for (const s of chest) {
    if (!need) break;
    if (!s || s.itemId !== FUEL.canItem) continue;
    const k = Math.min(s.count, Math.ceil(need / FUEL.canUnits));
    if (k > 0) { d.chest.push({uid: s.uid, count: k}); need -= k * FUEL.canUnits; }
  }
  return need > 0 ? null : d;
}

/** Apply a planned debit to the live sources (the tank value returned; carts / chest stacks mutated in place). */
export function applyDebit(d: FuelDebit, tank: number, carts: CartFuel[], chest: (ItemStack | null)[]): number {
  for (const c of d.carts) { const k = carts.find(x => x.uid === c.uid); if (k) k.units = Math.max(0, k.units - c.units); }
  for (const c of d.chest) {
    const i = chest.findIndex(s => s?.uid === c.uid);
    if (i < 0) continue;
    const s = chest[i]!;
    s.count -= c.count;
    if (s.count <= 0) chest[i] = null;
  }
  return Math.max(0, tank - d.tank);
}

/**
 * Refund a debit EXACTLY (a journey that never left: the train returned to the station it left): the tank units back, each cart's units
 * back (only carts still present), each chest stack back by uid (re-created in the first free slot if it was emptied). Returns the tank.
 * `alloc` makes a fresh stack for an emptied chest slot.
 */
export function refundDebit(d: FuelDebit, tank: number, carts: CartFuel[], chest: (ItemStack | null)[], alloc: (count: number, uid: number) => ItemStack): number {
  for (const c of d.carts) { const k = carts.find(x => x.uid === c.uid); if (k) k.units = Math.min(FUEL.cartUnits, k.units + c.units); }
  for (const c of d.chest) {
    const s = chest.find(x => x?.uid === c.uid);
    if (s) s.count += c.count;
    else { const i = chest.indexOf(null); if (i >= 0) chest[i] = alloc(c.count, c.uid); }
  }
  return Math.min(FUEL.tankUnits, tank + d.tank);
}

// ---------------------------------------------------------------------------------------------------------------------
// Records (JSON-safe; validated on load)

/** A cart in the train-local frame (the player-train record's cargo: it rides with the car). */
export interface CargoCartJSON { uid: string; units: number; x: number; y: number; z: number; yaw: number }
/** A cart lying in a station (world pose + storey). */
export interface StationCartJSON { uid: string; units: number; x: number; y: number; z: number; yaw: number; level: number }

/** The train's fuel record (inside the 'player-train' participant): the tank and the carts aboard. */
export interface TrainFuelJSON { v: 1; tank: number; cargo: CargoCartJSON[] }

/**
 * Section-memory lane of a station's fuel (FUEL_LANE): the plan realized (once), the carts lying there. v2 (task fuel-feedback): + `lots`
 * — the fuel cans realized as loot lots in the station's holders (`<holderKey>#<lotId>`, gen/fuelHolders.ts), re-placed on every build
 * (the holder memory then removes the taken ones like any lot). A v1 record (released train-fuel-system saves) has no lots: its
 * station gets the one-time v2 delta on its next build (world/fuelStations.ts).
 */
export interface StationFuelJSON { v: 1 | 2; realized: boolean; carts: StationCartJSON[]; lots?: string[] }
export const FUEL_LANE = 'fuel.station';
/** A realized fuel lot's key: the holder's memory key + the lot id. */
export const FUEL_LOT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,47}@-?\d{1,4}:-?\d{1,9},-?\d{1,9}#\d{1,9}$/;
/** Most fuel lots one station record lists. */
export const FUEL_LOTS_MAX = 64;
export const fuelLotKey = (holderKey: string, lotId: number): string => `${holderKey}#${lotId}`;
export function parseFuelLotKey(k: string): {holder: string; lot: number} {
  const i = k.lastIndexOf('#');
  return {holder: k.slice(0, i), lot: Number(k.slice(i + 1))};
}

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const units = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const POSE = 1e6;

/** Why a cart record is malformed (null = fine). */
export function cartProblem(c: unknown, station: boolean): string | null {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'a fuel cart record must be an object';
  const o = c as Record<string, unknown>;
  const keys = station ? ['uid', 'units', 'x', 'y', 'z', 'yaw', 'level'] : ['uid', 'units', 'x', 'y', 'z', 'yaw'];
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `unexpected fuel cart field '${k}'`;
  if (typeof o.uid !== 'string' || !o.uid.length || o.uid.length > 64) return 'a fuel cart needs an id';
  if (!units(o.units, FUEL.cartUnits)) return `fuel cart units ${String(o.units)} out of range (0 to ${FUEL.cartUnits})`;
  for (const k of ['x', 'y', 'z']) if (!finite(o[k], -POSE, POSE)) return `fuel cart ${k} out of range`;
  if (!finite(o.yaw, -1e6, 1e6)) return 'fuel cart yaw out of range';
  if (station && !(Number.isInteger(o.level) && (o.level as number) >= 0 && (o.level as number) < 64)) return 'fuel cart level out of range';
  return null;
}

/** Why a train fuel record is malformed (null = fine). */
export function trainFuelProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the train fuel record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['v', 'tank', 'cargo'].includes(k)) return `unexpected train fuel field '${k}'`;
  if (o.v !== 1) return 'unsupported train fuel version';
  if (!units(o.tank, FUEL.tankUnits)) return `train fuel ${String(o.tank)} out of range (0 to ${FUEL.tankUnits})`;
  if (!Array.isArray(o.cargo) || o.cargo.length > 16) return 'train cargo must be a list of at most 16 carts';
  const ids = new Set<string>();
  for (const c of o.cargo) {
    const p = cartProblem(c, false);
    if (p) return p;
    const id = (c as CargoCartJSON).uid;
    if (ids.has(id)) return `duplicate fuel cart ${id}`;
    ids.add(id);
  }
  return null;
}

/** Why a station fuel lane record is malformed (null = fine). */
export function stationFuelProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the station fuel record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['v', 'realized', 'carts', 'lots'].includes(k)) return `unexpected station fuel field '${k}'`;
  if (o.v !== 1 && o.v !== 2) return 'unsupported station fuel version';
  if (typeof o.realized !== 'boolean') return 'station fuel needs a realized flag';
  if (o.v === 1 && o.lots !== undefined) return 'a v1 station fuel record has no lots';
  if (o.v === 2) {
    if (!Array.isArray(o.lots) || o.lots.length > FUEL_LOTS_MAX) return `station fuel lots must be a list of at most ${FUEL_LOTS_MAX}`;
    const seen = new Set<string>();
    for (const k of o.lots) {
      if (typeof k !== 'string' || !FUEL_LOT_KEY.test(k)) return 'a malformed station fuel lot';
      if (seen.has(k)) return `duplicate station fuel lot ${k}`;
      seen.add(k);
    }
  }
  if (!Array.isArray(o.carts) || o.carts.length > 16) return 'station carts must be a list of at most 16';
  const ids = new Set<string>();
  for (const c of o.carts) {
    const p = cartProblem(c, true);
    if (p) return p;
    const id = (c as StationCartJSON).uid;
    if (ids.has(id)) return `duplicate fuel cart ${id}`;
    ids.add(id);
  }
  return null;
}

/** A debit record (inside a pending journey) — why malformed (null = fine). */
export function debitProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a fuel debit must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['tank', 'carts', 'chest'].includes(k)) return `unexpected fuel debit field '${k}'`;
  if (!units(o.tank, FUEL.tankUnits)) return 'fuel debit tank out of range';
  if (!Array.isArray(o.carts) || o.carts.length > 16 || !Array.isArray(o.chest) || o.chest.length > 64) return 'a fuel debit lists carts and chest stacks';
  for (const c of o.carts) if (!c || typeof c !== 'object' || typeof (c as {uid?: unknown}).uid !== 'string' || !units((c as {units?: unknown}).units, FUEL.cartUnits) || Object.keys(c).length !== 2) return 'a malformed fuel debit cart';
  for (const c of o.chest) if (!c || typeof c !== 'object' || !Number.isInteger((c as {uid?: unknown}).uid) || !units((c as {count?: unknown}).count, FUEL.canStackMax) || Object.keys(c).length !== 2) return 'a malformed fuel debit chest stack';
  return null;
}

/**
 * Fuel units lying in a station's remembered loose items / grounded bags / carts / holder lots (the map's "remaining" for a visited
 * station). `lots` = the station record's realized fuel lots, `holders` = the station memory's holder records: a lot counts while its
 * holder still lists it (a holder without a record keeps all its lots, as Game's applyHolders does). A lot that left its holder is a
 * pickup now (counted there once).
 */
export function stationFuelRemaining(o: {pickups?: readonly {stack: {itemId: string; count: number; bag?: readonly ({itemId: string; count: number} | null)[]}}[] | null; bags?: readonly {stack: {bag?: readonly ({itemId: string; count: number} | null)[]}}[]; carts?: readonly {units: number}[];
  lots?: readonly string[]; holders?: Readonly<Record<string, {lots: readonly number[]}>>}): number {
  let n = 0;
  for (const k of o.lots ?? []) {
    const {holder, lot} = parseFuelLotKey(k), rec = o.holders?.[holder];
    if (!rec || rec.lots.includes(lot)) n += FUEL.canUnits;
  }
  for (const p of o.pickups ?? []) {
    if (p.stack.itemId === FUEL.canItem) n += p.stack.count * FUEL.canUnits;
    for (const c of p.stack.bag ?? []) if (c && c.itemId === FUEL.canItem) n += c.count * FUEL.canUnits;
  }
  for (const b of o.bags ?? []) for (const c of b.stack.bag ?? []) if (c && c.itemId === FUEL.canItem) n += c.count * FUEL.canUnits;
  for (const c of o.carts ?? []) n += Math.max(0, c.units);
  return n;
}

/** "1.5 tanks" / "1 tank" / "¾ tank" / "empty" from quarter units (the HUD / map wording). */
export function tanksText(u: number): string {
  const n = Math.max(0, Math.floor(u));
  if (n === 0) return 'empty';
  const whole = Math.floor(n / FUEL.tankUnits), q = n % FUEL.tankUnits;
  const frac = q === 0 ? '' : q === 1 ? '¼' : q === 2 ? '½' : '¾';
  if (!whole) return `${frac} tank`;
  return `${whole}${frac ? frac : ''} tank${whole === 1 && !frac ? '' : 's'}`;
}
