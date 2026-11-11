// Task train-lockbox-windows-20261101-232156 (lane BOX): the LOCKBOX — a LOCKBOX_SLOTS-slot store that belongs to the run's player train
// (run/playerTrain.ts PlayerTrainRecord.lockbox), so it is the SAME container in every level (Subway / Office / Mall / Reactor).
//
// - LOCKBOX_SLOTS (LOCKBOX_GRID 10 × 5 = 50; 40 = 10 × 4 before task gameplay-feedback-20261111, lane STORAGE: one more row, the same
//   columns) ordinary inventory slots (ItemStack, the item's own stackMax), not volume. An older 40-slot save loads into the first 40
//   slots exactly as saved (load reads by index; the new row starts empty). Every item kind fits, a backpack whole with its
//   contents (`bag`); stacks keep their uid, count, gun magazine `mag`, gas-mask `filter` charge and an airtank's `air`.
// - It lives in the player-train RunParticipant: Travel keeps it (nothing touches the record), Retry restores it with the player's
//   inventory from the level-entry snapshot, NewGame empties it. There is no on-disk run save (a page reload starts a new run).
// - Transfers go only through Inventory.storeMove / storeQuick / storeWornBag (the open Lockbox view); the 1337 gear drop through
//   items/devGrant.ts. Loading malformed data never throws: bad slots are dropped, an old save without a lockbox loads empty.
// Pure (no three.js / DOM).
//
// Task studio-beta-skyways-vehicle-20261107-054512-01 (lane TRUNK): the slot count is a constructor parameter (default LOCKBOX_SLOTS:
// the Lockbox is unchanged) so the Skyways prize car's trunk (world/skywaysCarTrunk.ts, TRUNK_SLOTS) is the same store.

import {ITEMS} from '../items/items';
import {canonicalItemId} from '../items/calibers';
import {gearSpec, isAirtank, isFilterMask} from '../items/gear';
import {stackToJSON, stacksIn, type ItemStack, type StackJSON} from '../items/inventory';
import {WEAPONS} from '../weapons/weapons';

/**
 * The Lockbox's shape (its view lays the slots out in LOCKBOX_GRID.columns). Task gameplay-feedback-20261111 (lane STORAGE): one more
 * row, the same columns — 10 × 4 -> 10 × 5. Change the shape HERE only (the Skyways trunk has its own TRUNK_SLOTS).
 */
export const LOCKBOX_GRID: Readonly<{columns: number; rows: number}> = Object.freeze({columns: 10, rows: 5});
export const LOCKBOX_SLOTS = LOCKBOX_GRID.columns * LOCKBOX_GRID.rows;
export const LOCKBOX_NAME = 'Lockbox';

export interface TrainLockboxJSON { v: 1; slots: (StackJSON | null)[] }

/** A clean live stack from untrusted plain data, or null (unknown item, bad count / uid, a bag inside a bag). */
function stackFrom(j: unknown, inBag: boolean, seen: Set<number>): ItemStack | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Partial<StackJSON>;
  const itemId = typeof o.itemId === 'string' ? canonicalItemId(o.itemId) : '';
  const def = ITEMS[itemId];
  const uid = o.uid, count = o.count;
  if (!def || !Number.isInteger(uid) || (uid as number) < 1 || seen.has(uid as number)) return null;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > def.stackMax) return null;
  const slots = def.gear?.bagSlots ?? 0;
  if (slots > 0 && inBag) return null;
  seen.add(uid as number);
  const s: ItemStack = {uid: uid as number, itemId, count: count as number};
  if (def.kind === 'weapon') {
    const mag = WEAPONS[def.weaponId!]?.magazine ?? 0;
    s.mag = Number.isFinite(o.mag) ? Math.max(0, Math.min(mag, Math.floor(o.mag as number))) : 0;
  }
  if (isFilterMask(itemId) && Number.isFinite(o.filter)) s.filter = Math.max(0, Math.min(gearSpec(itemId)!.filterLife!, o.filter as number));
  if (isAirtank(itemId) && Number.isFinite(o.air)) s.air = Math.max(0, Math.min(gearSpec(itemId)!.airLife!, o.air as number)); // task filter-tension-airtank
  const fullArmor = gearSpec(itemId)?.armor ?? 0; // task studio-general-armor-20261107-231448-01: worn armour stays worn in the Lockbox
  if (fullArmor > 0 && Number.isFinite(o.armor)) s.armor = Math.max(0, Math.min(fullArmor, o.armor as number));
  if (slots > 0) {
    const src = Array.isArray(o.bag) ? o.bag : [];
    s.bag = Array.from({length: slots}, (_, i) => stackFrom(src[i], true, seen));
  }
  return s;
}

export class TrainLockbox {
  /** The live slots (one array for the whole run: the open view and transfers hold it; load / clear write in place). */
  readonly slots: (ItemStack | null)[];
  /** Bumped by load / clear / a grant (transfers bump the Inventory's version). */
  version = 0;

  /** `size`: the slot count (the Lockbox: LOCKBOX_SLOTS; lane TRUNK: the car trunk's TRUNK_SLOTS). */
  constructor(readonly size: number = LOCKBOX_SLOTS) {
    this.slots = new Array(size).fill(null);
  }

  get used(): number {
    return this.slots.filter(Boolean).length;
  }

  get free(): number {
    return this.size - this.used;
  }

  /** JSON-safe deep copy (the RunParticipant save). */
  toJSON(): TrainLockboxJSON {
    return {v: 1, slots: this.slots.map(stackToJSON)};
  }

  /** Restore a saved state in place; anything missing or malformed loads as empty slots (never throws). */
  load(d: unknown): void {
    const src = d && typeof d === 'object' && Array.isArray((d as TrainLockboxJSON).slots) ? (d as TrainLockboxJSON).slots : [];
    const seen = new Set<number>();
    for (let i = 0; i < this.size; i++) this.slots[i] = stackFrom(src[i], false, seen);
    this.version++;
  }

  /** NewGame: empty. */
  clear(): void {
    this.slots.fill(null);
    this.version++;
  }

  /** Highest uid held (bag contents included) — the inventory's counter stays above it (Inventory.reserveUids). */
  maxUid(): number {
    let m = 0;
    for (const s of this.slots.flatMap(stacksIn)) m = Math.max(m, s.uid);
    return m;
  }

  /** "Pistol, 120 × 9mm, Backpack (3 inside)" style lines per used slot (QA / tests). */
  summary(): string[] {
    return this.slots.flatMap((s, i) => s ? [`${i}:${s.itemId}x${s.count}${s.mag !== undefined ? `@${s.mag}` : ''}${s.bag ? `[${s.bag.filter(Boolean).length}]` : ''}`] : []);
  }

  /** Test invariant check: slot count, stack limits, uids unique, bags one level deep with their own size. */
  invariants(): string[] {
    const out: string[] = [], uids = new Set<number>();
    if (this.slots.length !== this.size) out.push(`lockbox has ${this.slots.length} slots`);
    const check = (s: ItemStack, inBag: boolean) => {
      const def = ITEMS[s.itemId];
      if (!def) { out.push(`unknown item ${s.itemId}`); return; }
      if (uids.has(s.uid)) out.push(`duplicate uid ${s.uid}`);
      uids.add(s.uid);
      if (s.count < 1 || s.count > def.stackMax) out.push(`bad count ${s.itemId}:${s.count}`);
      const n = def.gear?.bagSlots ?? 0;
      if (n > 0 && inBag) out.push(`backpack inside backpack ${s.uid}`);
      if (n > 0 && s.bag?.length !== n) out.push(`backpack ${s.uid} contents size ${s.bag?.length ?? 'missing'} != ${n}`);
      if (n === 0 && s.bag) out.push(`non-bag ${s.itemId} carries contents`);
      for (const c of s.bag ?? []) if (c) check(c, true);
    };
    for (const s of this.slots) if (s) check(s, false);
    return out;
  }
}
