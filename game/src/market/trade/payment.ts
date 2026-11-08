// Task studio-market-rework-20261108-074144-01 (lane TRADE): PAYMENT — the ONE shared helper every trade pays and gets paid through. Rail
// Ties are the physical item (items/railTies.ts `rail_ties`, stacks of up to 1000): there is no balance anywhere, what you can spend is what
// you carry. User: "rail ties should be a physical item that sits in your inventory, max stack size 1,000."
//  - WHERE: the quick slots and the pockets (the reach of Inventory.count / add; ties are a passive kind, pockets first). Ties inside a
//    WORN backpack are not spent (no Inventory method reaches the worn bag's contents — the rule a mask's spare filters follow too): the
//    trade view names how many wait there (bagTies). The Lockbox, a trunk and the train's cargo are never drawn on.
//  - PAY exactly n (payTies): the SMALLEST ties stacks first (a payment empties as many slots as it can), pockets before quick slots,
//    later slots first; the last stack touched keeps its rest (same uid). Short, or n not a whole amount: false, nothing changes.
//  - RECEIVE n (receiveTies): merged onto the carried ties stacks first, then new stacks of up to 1000 in empty pockets, then quick slots
//    (Inventory.add). Returns how many did NOT fit — a trade always simulates first, so a real receive always fits.
//  - ATOMIC (simulate): a trade runs its exact steps on Inventory.clone() first (the same slots and uid counter, so the real run places
//    exactly the same way) and only then on the real inventory. A SALE takes the goods out THEN receives the ties (the slot the goods leave
//    may take the ties); a BUY pays THEN adds the goods (the slot the payment empties may take them). If the copy cannot do it, nothing
//    real changes — not even the uid counter.
//  - THE OLD BALANCE (migrateTies, market/trade/wallet.ts): placed carried first, then into the train's Lockbox, then as ties pickups
//    lying in the parked car (train cargo); whatever still does not fit stays owed (never discarded, never truncated).
// Pure (no three.js / DOM).
import {RAIL_TIES_ID, RAIL_TIES_STACK} from '../../items/railTies';
import type {Inventory, ItemStack, SlotRef} from '../../items/inventory';
import {CARGO, type CargoItemJSON} from '../../run/trainCargo';

const isTies = (s: ItemStack | null | undefined): s is ItemStack => !!s && s.itemId === RAIL_TIES_ID;
const whole = (n: number) => Number.isInteger(n) && n >= 0;

/** The carried ties stacks a payment draws on: pockets, then quick slots (slot order). */
function tiesRefs(inv: Inventory): {ref: SlotRef; count: number; rank: number}[] {
  const out: {ref: SlotRef; count: number; rank: number}[] = [];
  inv.pack.forEach((s, i) => { if (isTies(s)) out.push({ref: {bar: 'pack', index: i}, count: s.count, rank: 1000 - i}); });
  inv.hotbar.forEach((s, i) => { if (isTies(s)) out.push({ref: {bar: 'hotbar', index: i}, count: s.count, rank: 2000 - i}); });
  return out;
}

/** The ties you can spend now: quick slots + pockets. */
export function carriedTies(inv: Inventory): number {
  return tiesRefs(inv).reduce((n, r) => n + r.count, 0);
}

/** Ties inside the worn backpack (not spendable until taken out; the view says so). */
export function bagTies(inv: Inventory): number {
  return (inv.wornBag()?.bag ?? []).reduce((n, s) => n + (isTies(s) ? s.count : 0), 0);
}

/** How many ties the quick slots + pockets could still take (room on carried ties stacks + empty slots). */
export function tiesRoom(inv: Inventory): number {
  let n = 0;
  for (const s of [...inv.pack, ...inv.hotbar]) n += !s ? RAIL_TIES_STACK : isTies(s) ? RAIL_TIES_STACK - s.count : 0;
  return n;
}

/** Pay exactly `n` ties out of the quick slots / pockets (smallest stacks first). False (nothing changes) when short or `n` is not whole. */
export function payTies(inv: Inventory, n: number): boolean {
  if (!whole(n)) return false;
  const refs = tiesRefs(inv);
  if (refs.reduce((a, r) => a + r.count, 0) < n) return false;
  refs.sort((a, b) => a.count - b.count || a.rank - b.rank);
  let left = n;
  for (const r of refs) {
    if (!left) break;
    const s = inv.get(r.ref)!, k = Math.min(left, s.count);
    if (k === s.count) inv.set(r.ref, null);
    else { s.count -= k; inv.version++; }
    left -= k;
  }
  return true;
}

/** Receive `n` ties into the quick slots / pockets (merging first). Returns how many did not fit (those were NOT added). */
export function receiveTies(inv: Inventory, n: number): number {
  if (!whole(n) || n === 0) return 0;
  return inv.add({uid: inv.allocUid(), itemId: RAIL_TIES_ID, count: n});
}

/**
 * Run `step` on a deep copy of the inventory first; only if that succeeds (`ok`) is it run again on the real inventory. Returns the real
 * run's result, or the copy's failure with the real inventory untouched (not even its uid counter). The step must be deterministic in the
 * inventory alone (the same slots + uid counter place the same way); should the real run still fail, the real inventory is restored from
 * its snapshot (unreachable with a deterministic step). `trial` tells the step which run it is (the copy must not adopt live objects).
 */
export function simulate<T extends {ok: boolean}>(inv: Inventory, step: (inv: Inventory, trial: boolean) => T): T {
  const first = step(inv.clone(), true);
  if (!first.ok) return first;
  const before = inv.toJSON();
  const r = step(inv, false);
  if (!r.ok) inv.loadJSON(before);
  return r;
}

/** Where the old balance may go (the live objects; the train's are optional: a host without a train places carried only). */
export interface TiesPlaces {
  inv: Inventory;
  /** The train's Lockbox slots (run/trainLockbox.ts TrainLockbox). */
  lockbox?: {readonly slots: (ItemStack | null)[]; version: number} | null;
  /** The train's loose cargo (run/trainCargo.ts TrainCargo: records() / add()). */
  cargo?: {records(): CargoItemJSON[]; add(item: CargoItemJSON): void} | null;
  /** Train-local pose of the k-th ties pickup laid in the parked car (spawned clamped inside the car). */
  pose?: (k: number) => {x: number; y: number; z: number};
}

export interface TiesPlaced { carried: number; lockbox: number; cargo: number; left: number }

/** Merge `n` ties onto a store's ties stacks, then into its empty slots (fresh uids from `alloc`). Returns how many were placed. */
export function storeTies(slots: (ItemStack | null)[], n: number, alloc: () => number): number {
  let left = Math.max(0, Math.floor(n));
  for (const s of slots) {
    if (!left) break;
    if (!isTies(s) || s.count >= RAIL_TIES_STACK) continue;
    const k = Math.min(left, RAIL_TIES_STACK - s.count);
    s.count += k;
    left -= k;
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (slots[i]) continue;
    const k = Math.min(left, RAIL_TIES_STACK);
    slots[i] = {uid: alloc(), itemId: RAIL_TIES_ID, count: k};
    left -= k;
  }
  return Math.max(0, Math.floor(n)) - left;
}

/**
 * Place `owed` ties physically: carried (quick slots / pockets) first, then the Lockbox, then the parked car's floor as ties pickups (train
 * cargo records, at most CARGO.maxItems loose items aboard). Every new stack's uid comes from the run's counter (the inventory's). Returns
 * where they went and how many are still `left` (no room anywhere: they stay owed).
 */
export function migrateTies(owed: number, to: TiesPlaces): TiesPlaced {
  const out: TiesPlaced = {carried: 0, lockbox: 0, cargo: 0, left: Math.max(0, Math.floor(owed))};
  if (!out.left) return out;
  const inv = to.inv;
  const fit = Math.min(out.left, tiesRoom(inv));
  if (fit > 0) out.carried = fit - receiveTies(inv, fit);
  out.left -= out.carried;
  if (out.left > 0 && to.lockbox) {
    out.lockbox = storeTies(to.lockbox.slots, out.left, () => inv.allocUid());
    if (out.lockbox) to.lockbox.version++;
    out.left -= out.lockbox;
  }
  if (out.left > 0 && to.cargo) {
    let room = CARGO.maxItems - to.cargo.records().length, k = 0;
    while (out.left > 0 && room > 0) {
      const n = Math.min(out.left, RAIL_TIES_STACK), p = to.pose?.(k++) ?? {x: 0, y: 0, z: 0};
      to.cargo.add({kind: 'item', stack: {uid: inv.allocUid(), itemId: RAIL_TIES_ID, count: n}, x: p.x, y: p.y, z: p.z, q: [0, 0, 0, 1]});
      out.cargo += n;
      out.left -= n;
      room--;
    }
  }
  return out;
}
