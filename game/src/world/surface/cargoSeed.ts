// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): THE DEPOT RECOVERABLES -> REAL TRAIN UNITS. The rail depot's
// generated recoverables (gen/surface/surfaceTypes.ts SurfaceDepot.recoverables: a craftable train unit kind or an upgrade kit id + its
// world pose) become ordinary station-lane equipment records of the district section ('train-equipment.here'): fresh run uids from the
// train's one unit counter (TrainEquipment.nextUid), so from then on they ARE crafted-style units (moved, carried, plugged, captured as
// cargo, saved, validated, melted) — nothing about them is special except where they first stood. Seeded ONCE (world/surface/cargo.ts
// writes the 'surface.cargo' seeded marker in the same step); never refilled.
//
// Contents (prop rule 1: finite, seeded once, themed, from the loot-table foundation): a recovered storage chest holds a depot
// workshop's salvage and supplies — DEPOT_CHEST, composed from the named tables BASE_WORKSHOP_SALVAGE (scrap metal / electrical parts)
// and TENANT_SUPPLY (water, cells, flares, dressings, tins), rolled exactly (no scarcity cut) on the district seed, stack sizes by
// BOX_COUNT (small). Devices and kits are recovered EMPTY (a recovered sentry's feed holds no rounds: ammo only by deliberate rule).
// Pure (no three.js / DOM).
//
// Task studio-surface-run-field-followup-20261116-211729-01 (lane FIXES), user: "A newly seeded depot gets exactly ONE randomly selected
// existing recoverable train upgrade, not the whole collection. Seed once, allocate exactly the actual unit, preserve physical UID/cargo/
// normal once-only train installation with no second material charge. Never delete existing saved kits or reroll/refill an
// already-seeded depot." / "Keep already-seeded legacy depot contents." — seedDepot: ONE of the generated recoverables, picked on the
// district seed's own salt (depotPick: Retry / reload pick the same) among the TRAIN UPGRADES (by trait: a device that plugs into the
// train — radar, sentry, scanner — or an upgrade kit; a storage chest is storage, not an upgrade), at its generated pose, with exactly
// one uid from the train's counter. The layout's list stays as generated; a depot seeded before this rule keeps every unit it got
// (world/surface/cargo.ts: the marker decides, nothing is rerolled; depotRecoverables says what a depot holds for the map).

import {Rng, hashString} from '../../core/rng';
import {EQUIPMENT, freshEquipment, recoverableKind, type EquipmentJSON} from '../../craft/equipment';
import type {SurfaceInfo, SurfaceRecoverable} from '../../gen/surface/surfaceTypes';
import {BASE_WORKSHOP_SALVAGE, BOX_COUNT, TENANT_SUPPLY, type LootSpec} from '../../items/lootTables';
import {stackToJSON, type ItemStack, type StackJSON} from '../../items/inventory';
import {itemDef} from '../../items/items';

/** A recovered depot chest's table: the workshop salvage + the supply rows, 3..5 lots, never empty, rolled exactly. */
export const DEPOT_CHEST: LootSpec = Object.freeze({
  items: Object.freeze([...BASE_WORKSHOP_SALVAGE, ...TENANT_SUPPLY.items]),
  lots: Object.freeze([3, 5] as const),
  empty: 0,
  exact: true,
}) as LootSpec;

export interface SeedDeps {
  /** The district seed (layout.surface.seed): the contents are the district's, not the run's. */
  seed: number;
  /** The train's unit counter (TrainEquipment.nextUid): one run, one id space. */
  nextUid(): string;
  /** The live inventory's stack maker (its item uid counter: one item, one uid run-wide). */
  makeStack(itemId: string, count: number): ItemStack;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** A recovered chest's stacks (def.slots entries; same items merge up to their stack size). */
export function depotChestSlots(rng: Rng, slots: number, makeStack: SeedDeps['makeStack'], table: LootSpec = DEPOT_CHEST): (StackJSON | null)[] {
  const out: (ItemStack | null)[] = new Array<ItemStack | null>(slots).fill(null);
  const [lo, hi] = table.lots ?? [1, 1];
  if (table.empty && rng.chance(table.empty)) return out.map(stackToJSON);
  const lots = rng.int(lo, hi);
  for (let k = 0; k < lots; k++) {
    const id = rng.weighted(table.items);
    const box = BOX_COUNT[id];
    let n = box ? rng.int(box.small[0], box.small[1]) : 1;
    const max = Math.max(1, itemDef(id).stackMax);
    for (const st of out) {
      if (n <= 0) break;
      if (!st || st.itemId !== id || st.count >= max) continue;
      const add = Math.min(n, max - st.count);
      st.count += add;
      n -= add;
    }
    for (let i = 0; i < out.length && n > 0; i++) {
      if (out[i]) continue;
      const st = makeStack(id, Math.min(n, max));
      out[i] = st;
      n -= st.count;
    }
  }
  return out.map(stackToJSON);
}

/**
 * The recoverables as station records (world pose + storey; uid order), at most `room` of them (the lane's bound: the rest stay
 * unrecovered, never invented elsewhere). Unknown kinds are skipped. Deterministic contents per (district seed, index).
 */
export function seedRecoverables(list: readonly SurfaceRecoverable[], deps: SeedDeps, room: number): EquipmentJSON[] {
  const out: EquipmentJSON[] = [];
  list.forEach((r, i) => {
    if (out.length >= room) return;
    const rec = recoverableRecord(r, i, deps);
    if (rec) out.push(rec);
  });
  return out;
}

/** One recoverable (index i of the depot's list) as a station record with a fresh run uid, or null (an unknown kind: no uid taken). */
function recoverableRecord(r: SurfaceRecoverable, i: number, deps: SeedDeps): EquipmentJSON | null {
  const kind = recoverableKind(r.kind);
  if (!kind) return null;
  const def = EQUIPMENT[kind], p = r.pose;
  const rec = freshEquipment(kind, deps.nextUid(), {x: r4(p.x), y: r4(p.y), z: r4(p.z), yaw: r4(p.yaw)});
  rec.level = Math.max(0, Math.min(63, Math.floor(p.level)));
  // a storage chest holds the depot's salvage; a feed / a device / a kit is recovered empty
  if (def.slots && !def.slotItem) rec.slots = depotChestSlots(new Rng(hashString(`surface-cargo-depot:${i}:${kind}`, deps.seed)), def.slots, deps.makeStack);
  return rec;
}

/** (lane FIXES) Is a recoverable a TRAIN UPGRADE: a device that plugs into the train, or an upgrade kit (never storage)? */
export function isTrainUpgrade(id: string): boolean {
  const kind = recoverableKind(id);
  if (!kind) return false;
  const def = EQUIPMENT[kind];
  return def.plug || !!def.upgrade;
}

/** (lane FIXES) The pick's own stream: the district seed, this salt. */
export const DEPOT_PICK_SALT = 'surface-cargo-depot-one';

/**
 * (lane FIXES) The index (in the depot's generated list) of the ONE train upgrade a newly seeded depot gets: uniform among the list's
 * train upgrades on the district seed's own stream (deterministic: Retry / reload / a revisit pick the same), -1 when there is none.
 */
export function depotPick(list: readonly SurfaceRecoverable[], seed: number): number {
  const ups: number[] = [];
  list.forEach((r, i) => { if (isTrainUpgrade(r.kind)) ups.push(i); });
  if (!ups.length) return -1;
  return ups[new Rng(hashString(DEPOT_PICK_SALT, seed)).int(0, ups.length - 1)];
}

/**
 * (lane FIXES) A newly seeded depot (world/surface/cargo.ts, marker absent): the one picked train upgrade as a station record (exactly
 * one uid from the train's counter), at most `room` (0: none), and the indices seeded (the cargo record's `depot` list).
 */
export function seedDepot(list: readonly SurfaceRecoverable[], deps: SeedDeps, room: number): {units: EquipmentJSON[]; depot: number[]} {
  const i = depotPick(list, deps.seed);
  if (i < 0 || room < 1) return {units: [], depot: []};
  const rec = recoverableRecord(list[i], i, deps);
  return rec ? {units: [rec], depot: [i]} : {units: [], depot: []};
}

/**
 * (lane FIXES) What a district's depot holds as recoverables (the planning map's line): not seeded yet -> the one train upgrade a first
 * entry seeds; seeded under this rule (the record's `depot` indices) -> those; seeded before it (a marker without the list) -> every
 * recoverable of a known kind (the old rule seeded them all).
 */
export function depotRecoverables(S: Pick<SurfaceInfo, 'seed' | 'depot'>, seeded: boolean, depot?: readonly number[] | null): SurfaceRecoverable[] {
  const list = S.depot?.recoverables ?? [];
  if (seeded && !depot) return list.filter(r => recoverableKind(r.kind));
  const idx = seeded ? depot! : [depotPick(list, S.seed)];
  return idx.filter(i => i >= 0 && i < list.length && recoverableKind(list[i].kind)).map(i => list[i]);
}
