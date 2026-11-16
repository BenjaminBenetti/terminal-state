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

import {Rng, hashString} from '../../core/rng';
import {EQUIPMENT, freshEquipment, recoverableKind, type EquipmentJSON} from '../../craft/equipment';
import type {SurfaceRecoverable} from '../../gen/surface/surfaceTypes';
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
    const kind = recoverableKind(r.kind);
    if (!kind) return;
    const def = EQUIPMENT[kind], p = r.pose;
    const rec = freshEquipment(kind, deps.nextUid(), {x: r4(p.x), y: r4(p.y), z: r4(p.z), yaw: r4(p.yaw)});
    rec.level = Math.max(0, Math.min(63, Math.floor(p.level)));
    // a storage chest holds the depot's salvage; a feed / a device / a kit is recovered empty
    if (def.slots && !def.slotItem) rec.slots = depotChestSlots(new Rng(hashString(`surface-cargo-depot:${i}:${kind}`, deps.seed)), def.slots, deps.makeStack);
    out.push(rec);
  });
  return out;
}
