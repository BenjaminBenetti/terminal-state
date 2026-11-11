// Iteration 16 (lane RUN): capture / apply a section's memory (run/memory.ts) from / onto the live world managers —
// loose pickups (PickupManager) and loot holders (ContainerManager). Game owns the enemy kill list itself.
// Nothing here creates or destroys loot: restoring spawns exactly the remembered items, and holder lots are only ever
// filtered (a taken lot never comes back, a remembered id that is not in the rolled holder is ignored).

import * as THREE from 'three';
import {fitBagContents, type Inventory, type ItemStack} from '../items/inventory';
import {canonicalItemId} from '../items/calibers';
import type {ContainerManager} from '../world/containers';
import type {Pickup, PickupManager} from '../world/pickups';
import {applyHolderRecord, captureHolder, holderKey, type HolderRecord, type PickupRecord, type StackRecord} from './memory';
import {holderTable, isSalvageLotId} from '../items/loot'; // task studio-base-salvage-20261108-073314-01
import {BASELINE_PROFILE, type LootProfile} from '../items/lootTables';
import {holderFoodOrigin, isNaturalFood, keepNaturalFood} from '../items/naturalFood'; // task studio-food-drink-half-20261109-201124-01

/** Plain deep copy of a stack without its uid. */
export function stackRecord(st: ItemStack): StackRecord {
  const c = structuredClone(st) as Partial<ItemStack> & Record<string, unknown>;
  delete c.uid;
  return c as StackRecord;
}

/** A live stack from a record, with a fresh uid of `inv` (count / mag / lane fields exactly as recorded). */
export function stackFromRecord(inv: Inventory, rec: StackRecord): ItemStack {
  const st = inv.makeStack(rec.itemId, 1, rec.mag);
  Object.assign(st, structuredClone(rec)); // the record has no uid: the fresh one stays
  st.itemId = canonicalItemId(st.itemId); // lane AMMO: a remembered legacy ammo id comes back as its caliber item (same count)
  if (st.bag) st.bag = fitBagContents(st.itemId, st.bag.map(c => (c ? {...c, itemId: canonicalItemId(c.itemId)} : null))); // (lane STORAGE: an older 12-slot bag gains its new empty slots)
  return st;
}

/**
 * The section's loose items as records. Task studio-market-rework-20261108-074144-01 (lane WARES): never an OWNED pickup (a market stall's
 * displayed stock, Pickup.owner): the stall's stock record is its truth and its displays are rebuilt from it on every build.
 */
export function capturePickups(list: readonly Pickup[], layoutIndexOf: (p: Pickup) => number | undefined): PickupRecord[] {
  return list.filter(p => !p.owner).map(p => {
    const o = p.obj;
    const rec: PickupRecord = {
      stack: stackRecord(p.stack),
      pose: {p: [o.position.x, o.position.y, o.position.z], q: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]},
      anchor: [p.x, p.y, p.z],
    };
    const li = layoutIndexOf(p);
    if (li !== undefined) rec.layoutIndex = li;
    if (p.fromLot) rec.fromLot = {...p.fromLot};
    return rec;
  });
}

const tv = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3(1, 1, 1), tm = new THREE.Matrix4();

/** Spawn one remembered item at its exact pose. */
export function restorePickup(pm: PickupManager, inv: Inventory, rec: PickupRecord): Pickup {
  tm.compose(tv.set(...rec.pose.p), tq.set(...rec.pose.q), ts);
  const p = pm.addAt(stackFromRecord(inv, rec.stack), tm, rec.fromLot ? {...rec.fromLot} : undefined);
  [p.x, p.y, p.z] = rec.anchor;
  return p;
}

type HolderLike = ContainerManager['all'][number];

export function holderKeyOf(h: HolderLike): string {
  return holderKey(h.kind, h.prop.level, h.prop.x, h.prop.z);
}

export function captureHolders(cm: ContainerManager): Record<string, HolderRecord> {
  const out: Record<string, HolderRecord> = {};
  for (const h of cm.all) out[holderKeyOf(h)] = captureHolder(h.state);
  return out;
}

/**
 * Apply remembered holder states right after ContainerManager.build (before the first update). Door / lid containers
 * remembered open are shown open at once (no swing on arrival); openable compartments come back closed with their
 * remaining contents. Returns {holders applied, lots removed}.
 */
export function applyHolders(cm: ContainerManager, recs: Record<string, HolderRecord>): {applied: number; removed: number} {
  let applied = 0, removed = 0;
  for (const h of cm.all) {
    const rec = recs[holderKeyOf(h)];
    if (!rec) continue;
    applied++;
    const openable = !!h.open;
    removed += applyHolderRecord(h.state, rec, {openable, container: h.group === 'container'});
    if (!openable && h.group === 'container' && h.state.open) {
      h.t = 1;
      for (const hg of h.hinges) hg.obj.rotation[hg.axis] = hg.angle;
      for (const o of h.inner) o.visible = true;
    }
  }
  return {applied, removed};
}

/**
 * Task studio-base-salvage-20261108-073314-01: right after ContainerManager.build — before the fuel lots, the shelf filler and applyHolders
 * — a REMEMBERED holder drops the additive base salvage lot (items/loot.ts isSalvageLotId) its record does not list: one realized before
 * the base salvage existed (an old save) never gains it, one whose lot was taken / yielded to a fuel can never gets it back, and the
 * filler / fuel placement see the holder exactly as it was left. Unremembered holders keep theirs (new loot). Returns the lots dropped.
 */
export function dropUnrecordedSalvage(cm: ContainerManager, recs: Record<string, HolderRecord>): number {
  let dropped = 0;
  for (const h of cm.all) {
    const rec = recs[holderKeyOf(h)];
    if (!rec) continue;
    const keep = new Set(rec.lots), before = h.state.lots.length;
    h.state.lots = h.state.lots.filter(l => !isSalvageLotId(l.id) || keep.has(l.id));
    dropped += before - h.state.lots.length;
  }
  return dropped;
}

/**
 * Task studio-food-drink-half-20261109-201124-01 (user: "cut food / drink spawn in half"): right after applyHolders, every holder WITHOUT a
 * remembered record (realized now for the first time) keeps each natural food / drink lot only if items/naturalFood.ts keepNaturalFood
 * says so for its stable origin (`section` = the section memory id, `seed` = the layout seed). Runs after the fuel lots and the shelf
 * filler, so both see the holder exactly as before (a dropped lot's spot reads as taken). A remembered holder (any save) keeps exactly
 * its record; non-food lots and curated rewards (the roof cache) are never touched. Returns the lots dropped.
 */
export function dropNaturalFood(cm: ContainerManager, recs: Record<string, HolderRecord>, seed: number, section: string, profile: LootProfile = BASELINE_PROFILE): number {
  let dropped = 0;
  for (const h of cm.all) {
    const key = holderKeyOf(h);
    if (recs[key] || !h.state.lots.some(l => isNaturalFood(l.itemId))) continue;
    if (holderTable(h.kind, h.state.areaType, profile).source === 'reward') continue;
    const before = h.state.lots.length;
    h.state.lots = h.state.lots.filter(l => !isNaturalFood(l.itemId) || keepNaturalFood(seed, holderFoodOrigin(section, key, l.id)));
    dropped += before - h.state.lots.length;
  }
  return dropped;
}
