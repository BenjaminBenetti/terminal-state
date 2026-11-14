// Task train-lockbox-windows-20261101-232156 (lane BOX): the DEVELOPER GEAR DROP — typing 1 3 3 7 while the train's Lockbox view is
// open (ui/lockboxView.ts) puts the current ranged guns, one of every gear item and a full stack of each caliber into the Lockbox.
//
// - The bundle is derived from the registries, never a literal list: guns = weapon items that are not melee (the knife is a melee
//   weapon: not a gun, not gear, so it is excluded); gear = items of kind 'gear' with a gear spec (backpacks included); ammo = one
//   stack of each caliber item (items/calibers.ts) at its real stackMax. Stacks come from Inventory.makeStack (a full magazine,
//   empty backpack slots, a gas mask without filter charge, fresh uids from the run's counter).
// - ALL OR NOTHING: the whole bundle is placed on a copy of the slots first with the real stack rules (merge onto partial stacks of
//   the same item, then empty slots). Only if all of it fits are the live slots changed; otherwise nothing changes at all.
// Pure (no DOM).

import {ITEMS, itemDef} from './items';
import {CALIBER_IDS, ammoItemFor, canonicalItemId} from './calibers';
import {WEAPONS} from '../weapons/weapons';
import type {Inventory, ItemStack} from './inventory';

export interface GrantLine { itemId: string; count: number }

/** The ordered key sequence (digits) that triggers the drop. */
export const DEV_GRANT_SEQUENCE: readonly string[] = ['1', '3', '3', '7'];

/**
 * The gear drop: current ranged guns, one of each gear item (the Airtank Backpack excepted: task filter-tension-airtank), one full stack per
 * caliber (registry order, deduped). Task studio-flamethrower-fire-20261114-031614-01: never the flamethrower (a stream weapon) or its
 * fuel tank — they come from the bench or a Market stall only.
 */
export function devGrantBundle(): GrantLine[] {
  const seen = new Set<string>(), out: GrantLine[] = [];
  const push = (itemId: string, count: number) => {
    const id = canonicalItemId(itemId);
    if (!seen.has(id) && ITEMS[id]) { seen.add(id); out.push({itemId: id, count}); }
  };
  const defs = Object.values(ITEMS);
  for (const d of defs) if (d.kind === 'weapon' && d.weaponId && WEAPONS[d.weaponId] && !WEAPONS[d.weaponId].melee && !WEAPONS[d.weaponId].stream) push(d.id, 1);
  for (const d of defs) if (d.kind === 'gear' && d.gear && !d.gear.airLife && !d.gear.fuelCap) push(d.id, 1); // (task filter-tension-airtank: the bundle stays as it was — no Airtank Backpack; task flamethrower-fire: nor the fuel tank)
  for (const c of CALIBER_IDS) push(ammoItemFor(c), itemDef(ammoItemFor(c)).stackMax);
  return out;
}

export interface GrantPlan {
  ok: boolean;
  /** Empty slots the whole bundle needs (after merging onto partial stacks). */
  need: number;
  /** Empty slots there are. */
  free: number;
}

type Placement = {kind: 'merge'; index: number; count: number} | {kind: 'new'; index: number; itemId: string; count: number};

/** Places `bundle` on a copy of `slots` (no mutation): the exact placements, and the empty slots needed / available. */
function planBundle(slots: readonly (ItemStack | null)[], bundle: readonly GrantLine[]): {plan: GrantPlan; placements: Placement[]} {
  const sim = slots.map(s => (s ? {itemId: s.itemId, count: s.count} : null));
  const free = sim.filter(s => !s).length;
  const placements: Placement[] = [];
  let need = 0;
  for (const line of bundle) {
    const itemId = canonicalItemId(line.itemId), max = itemDef(itemId).stackMax;
    let left = Math.max(0, Math.floor(line.count));
    if (max > 1) sim.forEach((s, index) => {
      if (!left || !s || s.itemId !== itemId || s.count >= max) return;
      const k = Math.min(left, max - s.count);
      s.count += k;
      left -= k;
      placements.push({kind: 'merge', index, count: k});
    });
    while (left > 0) {
      const n = Math.min(left, max);
      const index = sim.indexOf(null);
      need++;
      left -= n;
      if (index < 0) continue; // counted, never placed: the plan fails
      sim[index] = {itemId, count: n};
      placements.push({kind: 'new', index, itemId, count: n});
    }
  }
  return {plan: {ok: need <= free, need, free}, placements};
}

/** Whether the whole bundle fits (and how many empty slots it needs) — no mutation. */
export function planGrant(slots: readonly (ItemStack | null)[], bundle: readonly GrantLine[] = devGrantBundle()): GrantPlan {
  return planBundle(slots, bundle).plan;
}

/**
 * Grant the whole bundle into `slots` or nothing: simulated first; on success the merges and the new stacks (Inventory.makeStack:
 * full magazine, empty bag, fresh uids) are committed exactly as planned. On failure the slots and the inventory are untouched.
 */
export function grantAllOrNothing(slots: (ItemStack | null)[], inv: Pick<Inventory, 'makeStack'>, bundle: readonly GrantLine[] = devGrantBundle()): GrantPlan {
  const {plan, placements} = planBundle(slots, bundle);
  if (!plan.ok) return plan;
  for (const p of placements) {
    if (p.kind === 'merge') slots[p.index]!.count += p.count;
    else {
      const st = inv.makeStack(p.itemId, p.count);
      st.count = p.count;
      slots[p.index] = st;
    }
  }
  return plan;
}

/** "Pistol, Rifle, …, 120 × 9mm" (the success note). */
export function grantText(bundle: readonly GrantLine[] = devGrantBundle()): string {
  return bundle.map(l => (l.count > 1 ? `${l.count} × ${itemDef(l.itemId).short}` : itemDef(l.itemId).short)).join(', ');
}

/** '1'..'9' / '0' for Digit* / Numpad* key codes, else null. */
export function digitOfCode(code: string): string | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return m ? m[1] : null;
}

/**
 * An ordered key-sequence matcher: push() each key; true on the key that completes the sequence (then it starts over, so a
 * repeat needs the whole sequence again). A wrong key resets — unless it is itself the first key, which starts a new attempt.
 */
export class SequenceMatcher {
  private i = 0;

  constructor(readonly seq: readonly string[] = DEV_GRANT_SEQUENCE) {}

  /** Keys matched so far. */
  get progress(): number {
    return this.i;
  }

  push(key: string): boolean {
    if (key === this.seq[this.i]) {
      this.i++;
      if (this.i < this.seq.length) return false;
      this.i = 0;
      return true;
    }
    this.i = key === this.seq[0] ? 1 : 0;
    return false;
  }

  reset(): void {
    this.i = 0;
  }
}
