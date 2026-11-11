// Task studio-beta-fuel-feedback-20261106-064128-01 (user feedback: "Smaller fuel cans … shelves and standard loot spots. Reserve floor
// placement for really key items" / "about 4 tanks average per level, distributed as standard loot so not forced to comb the whole level
// for the last can"): WHERE a station's fuel cans lie as ordinary LOOT LOTS — on shelf tiers, tables, counters and inside storage
// (cabinets, crates, lockers, tool chests) — pure and deterministic (no three.js; its own RNG `fuel-holders:<stationId>` over the layout
// seed; the holders' own rolled lots, streams and lot ids are never touched: a fuel lot only takes FREE room beside them). Task
// studio-base-salvage-20261108-073314-01: the additive base salvage lot (items/loot.ts isSalvageLotId) is left out of that room — the fuel
// slots are exactly what they were before it existed — and yields where a can lands on it (world/containers.ts addLots).
//
// fuelHolderSlots(): every eligible holder (FUEL_HOLDERS.kinds x the room's fuel affinity — gen/fuelPlacement.ts fuelWeight: back-of-house,
//   utility, storage, workshops first; never platforms / passages / concourses / stairs — reachable on foot from the train door, at least
//   FUEL_HOLDERS.minFromTrain m from the car) offers up to FUEL_HOLDERS.perHolder slots: a can standing upright (label to the aisle) or,
//   under a low tier / in a drawer, lying on its back, in a free gap of a surface (FUEL_HOLDERS.gap clear of every lot, inside the
//   surface and its clearance). The slots come in ONE fixed weighted-random order (first slots of all holders, then second slots), so the
//   same layout always offers the same slots with the same lot ids (holder.index * 1000 + FUEL_HOLDERS.lotBase + k).
// chooseFuelSlots(): the first n of that order, at most max(2, ceil(n / roomShare)) per room in a first pass (spread over the station:
//   no single room holds the last can), then without the room cap; `skip` leaves out holders (a visited station's searched containers).
//   What no holder can take is `short` (the caller lays those cans loose — the rare fallback).
import {Rng, hashString} from '../core/rng';
import {placementBox, orientedSize, type Orient, type Surface} from '../items/lootLayout';
import {isSalvageLotId, type Lot} from '../items/loot';
import {FUEL, fuelLotKey} from '../fuel/fuel';
import type {StationLayout} from './stationTypes';
import {fuelReachableAreas, fuelWeight} from './fuelPlacement';
import {playerTrainPlacement} from './playerTrain';

export const FUEL_HOLDERS = {
  /** Fuel lot ids: holder.index * 1000 + lotBase + k (clear of rolled 0.., compartment 500.., storage-fill 600.. ids). */
  lotBase: 900,
  /** Fuel cans one holder takes at most. */
  perHolder: 2,
  /** First pass: a room takes at most max(2, ceil(n / roomShare)) cans. */
  roomShare: 5,
  /** Clearance to the neighbouring lots / surface ends (m). */
  gap: 0.03,
  /** A holder this close to the car centre (same storey) gets none (scavenged, not handed over). */
  minFromTrain: 10,
  /**
   * Holder kinds that plausibly store a fuel can and their weight (storage / workshop furniture first; counters and tables less;
   * never food / cold / medical / arms / vending fixtures, displays of clothes or books, filing drawers, server racks or bins).
   */
  kinds: {
    crate: 1.5, shelf: 1.5, stockShelf: 1.2, outdoorsPlankShelving: 1.0, rollingToolChest: 1.2,
    cabinetTall: 1.0, cabinetLow: 1.0, staffLockers: 0.7, footlocker: 0.8, storageTote: 0.8, cardboardBoxFlaps: 0.6,
    table: 0.6, desk: 0.25, shopBackbar: 0.4, shopCounter: 0.3, stall: 0.3, checkoutLane: 0.2, mallCashwrapCounter: 0.25,
    retailGondola: 0.4, wallBay: 0.3, shoppingCart: 0.3, kitchenette: 0.15,
  } as Readonly<Record<string, number>>,
} as const;

/** A live holder as the placement reads it (world/containers.ts Holder: its surfaces and its rolled lots, before any memory). */
export interface FuelHolderIn {
  /** The holder's memory key (run/memory.ts holderKey). */
  key: string;
  kind: string;
  /** Index within its group (the loot seed key; lot ids are index * 1000 + …). */
  index: number;
  /** Layout area index / storey / world centre. */
  area: number;
  level: number;
  x: number;
  z: number;
  surfaces: readonly Surface[];
  lots: readonly Lot[];
}

/** One place a fuel can may lie: the holder (key), the lot (holder-local placement, count 1) and its room. */
export interface FuelSlot { key: string; holder: string; lot: Lot; area: number; pass: number }

const box = (itemId: string, p: {x: number; y: number; z: number; yaw: number; orient: Orient}) => placementBox(itemId, {surface: 0, ...p});
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>, pad: number) =>
  a.min[0] < b.max[0] + pad && a.max[0] > b.min[0] - pad && a.min[1] < b.max[1] - 0.002 && a.max[1] > b.min[1] + 0.002 && a.min[2] < b.max[2] + pad && a.max[2] > b.min[2] - pad;

/**
 * A free spot for one fuel can on surface `si` of a holder (holder-local), clear of `taken` boxes; null when none. Upright first (label
 * to the front), else lying on its back (low tiers, drawers); yaw 0 or a quarter turn (narrow, deep surfaces), a small jitter.
 */
export function freeCanSpot(surfaces: readonly Surface[], si: number, taken: readonly ReturnType<typeof box>[], rnd: () => number): Lot | null {
  const s = surfaces[si], id = FUEL.canItem, G = FUEL_HOLDERS.gap;
  if (s.spill) return null; // (a vending machine's tumbled spill area is no shelf)
  for (const orient of ['up', 'back'] as Orient[]) {
    const o = orientedSize(id, orient);
    if (o.sy + 0.01 > s.clear) continue;
    for (const base of [0, Math.PI / 2]) {
      const yaw = base + (rnd() * 2 - 1) * 0.12;
      const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
      const sx = c * o.sx + sn * o.sz, sz = sn * o.sx + c * o.sz;
      if (sz + 0.01 > s.z1 - s.z0 || sx + 2 * G > s.x1 - s.x0) continue;
      // depth: towards the front (aisle) like the packer, inside the surface
      const freeZ = (s.z1 - s.z0 - sz) / 2, z = (s.z0 + s.z1) / 2 + freeZ * 0.35;
      const xs: number[] = [];
      for (let x = s.x0 + G + sx / 2; x <= s.x1 - G - sx / 2 + 1e-9; x += 0.01) {
        const b = box(id, {x, y: s.y, z, yaw, orient});
        if (!taken.some(t => overlaps(b, t, G))) xs.push(x);
      }
      if (!xs.length) continue;
      const x = xs[Math.floor(rnd() * xs.length)];
      return {id: -1, itemId: id, count: 1, surface: si, x, y: s.y, z, yaw, orient, ...(s.part !== undefined ? {part: s.part} : {})};
    }
  }
  return null;
}

/** The station's fuel slots in their fixed order (deterministic for layout + holders + station id). */
export function fuelHolderSlots(layout: StationLayout, holders: readonly FuelHolderIn[], station: string): FuelSlot[] {
  const seed = hashString(`fuel-holders:${station}`, (layout.seed >>> 0) ^ 0x1b873593);
  const reach = fuelReachableAreas(layout);
  const tp = playerTrainPlacement(layout);
  type Offer = {h: FuelHolderIn; w: number; key: number; lots: Lot[]};
  const offers: Offer[] = [];
  for (const h of holders) {
    const kw = FUEL_HOLDERS.kinds[h.kind] ?? 0;
    const a = layout.areas[h.area];
    const w = kw * (a ? fuelWeight(a) : 0);
    // (each holder its own stream: one holder never shifts another's slots)
    const r = new Rng(hashString(`fuel-holder:${h.key}`, seed)), key = r.next();
    if (w <= 0 || !h.surfaces.length) continue;
    if (reach && !reach.get(h.level)?.has(h.area)) continue;
    if (tp && h.level === tp.level && Math.hypot(h.x - tp.x, h.z - tp.z) < FUEL_HOLDERS.minFromTrain) continue;
    const taken = h.lots.filter(l => !isSalvageLotId(l.id)).map(l => placementBox(l.itemId, l)); // (base salvage: yields to a can)
    const lots: Lot[] = [];
    const rnd = () => r.next();
    for (let k = 0; k < FUEL_HOLDERS.perHolder; k++) {
      // surfaces in a shuffled order (a can on any tier / in any compartment), the first with room wins
      const order = h.surfaces.map((_, i) => ({i, k: rnd()})).sort((p, q) => p.k - q.k);
      let lot: Lot | null = null;
      for (const {i} of order) if ((lot = freeCanSpot(h.surfaces, i, taken, rnd))) break;
      if (!lot) break;
      lot.id = h.index * 1000 + FUEL_HOLDERS.lotBase + k;
      lots.push(lot);
      taken.push(placementBox(lot.itemId, lot));
    }
    if (lots.length) offers.push({h, w, key: Math.pow(key, 1 / w), lots});
  }
  offers.sort((a, b) => b.key - a.key || (a.h.key < b.h.key ? -1 : 1));
  const out: FuelSlot[] = [];
  for (let k = 0; k < FUEL_HOLDERS.perHolder; k++) {
    for (const o of offers) {
      const lot = o.lots[k];
      if (lot) out.push({key: fuelLotKey(o.h.key, lot.id), holder: o.h.key, lot, area: o.h.area, pass: k});
    }
  }
  return out;
}

/** A holder lot id in the fuel range (holder.index * 1000 + lotBase + k, k < perHolder; food-variety ids keep `id % 1000`, never here). */
export function isFuelLotId(id: number): boolean {
  const r = id % 1000;
  return id >= 0 && r >= FUEL_HOLDERS.lotBase && r < FUEL_HOLDERS.lotBase + FUEL_HOLDERS.perHolder;
}

/**
 * Task gameplay-feedback-20261111 (lane FUEL-LOOT): a spot for a REMEMBERED fuel lot that this layout's slot order does not offer (a
 * station a release before the v3 station record realized under another station's id: world/fuelStations.ts) — a free spot on any
 * surface of the holder, clear of its rolled lots and `others` (the fuel lots already placed there). Deterministic (its own stream over
 * the lot key and the layout seed). Null: no room (the caller lays the can loose: never lost).
 */
export function refitFuelLot(h: FuelHolderIn, lotId: number, others: readonly Lot[], layoutSeed: number): Lot | null {
  const r = new Rng(hashString(`fuel-refit:${h.key}#${lotId}`, (layoutSeed >>> 0) ^ 0x1b873593)), rnd = () => r.next();
  const taken = [...h.lots.filter(l => !isSalvageLotId(l.id)), ...others].map(l => placementBox(l.itemId, l));
  for (let si = 0; si < h.surfaces.length; si++) {
    const lot = freeCanSpot(h.surfaces, si, taken, rnd);
    if (lot) { lot.id = lotId; return lot; }
  }
  return null;
}

/** The first `n` slots of the order, spread over the rooms (see the header); `short` = cans no holder took. */
export function chooseFuelSlots(slots: readonly FuelSlot[], n: number, skip?: (holderKey: string) => boolean): {chosen: FuelSlot[]; short: number} {
  const cap = Math.max(2, Math.ceil(n / FUEL_HOLDERS.roomShare));
  const chosen: FuelSlot[] = [], used = new Set<string>(), perRoom = new Map<number, number>();
  const prevOf = new Map<string, string>(); // a holder's slot k -> its slot k - 1
  const byHolder = new Map<string, string[]>();
  for (const s of slots) { const l = byHolder.get(s.holder) ?? []; if (s.pass > 0 && l[s.pass - 1]) prevOf.set(s.key, l[s.pass - 1]); l[s.pass] = s.key; byHolder.set(s.holder, l); }
  for (const pass of [0, 1]) {
    for (const s of slots) {
      if (chosen.length >= n) break;
      if (used.has(s.key) || skip?.(s.holder)) continue;
      // a holder's second slot only after its first (the order lists first slots first; a skipped first never yields a second)
      if (s.pass > 0 && !used.has(prevOf.get(s.key) ?? '')) continue;
      const room = perRoom.get(s.area) ?? 0;
      if (pass === 0 && room >= cap) continue;
      chosen.push(s); used.add(s.key); perRoom.set(s.area, room + 1);
    }
  }
  return {chosen, short: Math.max(0, n - chosen.length)};
}
