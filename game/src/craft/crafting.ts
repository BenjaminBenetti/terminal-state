// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE ATOMIC CRAFT of the train's crafting bench — where the materials
// are counted, the exact debit, and the one transaction that turns them into a real unit on the car floor. Pure (no three.js / DOM, no
// Game): the bench (world/craftBench.ts) builds the sources from the live inventory / Lockbox / chests and calls craft(); Node tests
// drive it with real Inventory objects and a small fake equipment system.
//
// THE SOURCES, in this fixed order (a recipe is paid from the first that has the material, then the next):
//   1. CARRIED    the pockets and quick slots (also the grenade / melee slots, which never hold a material) — through the inventory's
//                 own Inventory.count / Inventory.take;
//   2. BACKPACK   the WORN backpack's contents (its `bag` list; no bag worn: an empty source);
//   3. LOCKBOX    the train Lockbox's slots (run/trainLockbox.ts);
//   4. CHESTS     every crafted chest standing in the parked car (EquipmentSystemLike.storesAboard), by unit number.
// Nothing else is ever a source: not the ground, not a container or shelf in the level, not loose cargo on the car floor, not a
// backpack lying anywhere or stored INSIDE the Lockbox / a chest (v1: a stored bag's contents are out of reach until it is worn).
// Within one list the LAST matching slot is drawn first (Inventory.take's own order), so the front of a grid stays as the player
// arranged it.
//
// EXACT: a debit only lowers `count` of the stacks it draws from (a stack that reaches 0 leaves its slot); every stack object, uid,
// slot and count it does not draw from is untouched. Each source that changed is `touch()`ed (the inventory's / Lockbox's version, a
// chest's storeVersion) so an open view redraws. Materials are never created: the only way a count rises here is the exact refund.
//
// ATOMIC (craft): 1. equipment.craftBlock(kind) — refused with its text, nothing changes; 2. planCraft — refused with the missing list,
// nothing changes; 3. applyCraft (synchronous); 4. equipment.craft(kind). If that last call returns null (or throws), refundCraft puts
// every drawn unit back into the SAME stack objects at the SAME slots with the SAME counts and the craft is refused. One call, no
// awaits: no frame, save or other system runs between the debit and the unit (or the refund). No loot table, RNG stream or supply
// number is read or changed by any of this.

import type {Inventory, ItemStack} from '../items/inventory';
import {itemDef} from '../items/items';
import {equipmentSeqOf, type EquipmentKind} from './equipment';
import type {EquipmentStore, EquipmentSystemLike, EquipmentUnit} from './equipmentApi';
import {RECIPE_MATERIALS, type Recipe, type RecipeMaterial} from './recipes';

export type MaterialSourceKind = 'carried' | 'backpack' | 'lockbox' | 'chest';

/** One drawn stack as it was before the draw: the refund writes exactly this back. */
export interface StackUndo {
  list: (ItemStack | null)[];
  index: number;
  stack: ItemStack;
  count: number;
}

/** One place materials are counted in and drawn from. */
export interface MaterialSource {
  readonly kind: MaterialSourceKind;
  /** 'carried' | 'backpack' | 'lockbox' | 'chest:<unit uid>'. */
  readonly id: string;
  /** How many of an item it holds now. */
  count(itemId: string): number;
  /** Draw up to n (the last matching slot first). Every stack it changes is recorded in `undo` first. Returns how many were drawn. */
  take(itemId: string, n: number, undo: StackUndo[]): number;
  /** Its contents changed (a debit / a refund): bump its version so an open view redraws. */
  touch(): void;
}

/** Draw from a plain slot list, last slot first. */
function takeFromSlots(list: (ItemStack | null)[], itemId: string, n: number, undo: StackUndo[]): number {
  let got = 0;
  for (let i = list.length - 1; i >= 0 && got < n; i--) {
    const s = list[i];
    if (!s || s.itemId !== itemId || s.count <= 0) continue;
    const k = Math.min(s.count, n - got);
    undo.push({list, index: i, stack: s, count: s.count});
    s.count -= k;
    got += k;
    if (s.count <= 0) list[i] = null;
  }
  return got;
}

function countSlots(list: readonly (ItemStack | null)[] | null | undefined, itemId: string): number {
  let n = 0;
  if (list) for (const s of list) if (s && s.itemId === itemId) n += s.count;
  return n;
}

/** A slot-list source (the worn backpack's contents, the Lockbox, a chest). `slots` is read on every use (null: nothing there). */
export function slotSource(kind: MaterialSourceKind, id: string, slots: () => (ItemStack | null)[] | null | undefined, touch: () => void): MaterialSource {
  return {
    kind, id,
    count: itemId => countSlots(slots(), itemId),
    take: (itemId, n, undo) => {
      const list = slots();
      return list && n > 0 ? takeFromSlots(list, itemId, n, undo) : 0;
    },
    touch,
  };
}

/** The carried source: the inventory's own count / take (pockets first, then the quick slots). */
export function carriedSource(inv: Inventory): MaterialSource {
  return {
    kind: 'carried', id: 'carried',
    count: itemId => inv.count(itemId),
    take: (itemId, n, undo) => {
      if (!(n > 0)) return 0;
      // (Inventory.take does not say which stacks it drew from: remember every candidate, keep the ones it changed)
      const before: StackUndo[] = [];
      for (const list of [inv.pack, inv.hotbar, inv.throwSlot, inv.meleeSlot]) {
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (s && s.itemId === itemId) before.push({list, index: i, stack: s, count: s.count});
        }
      }
      const got = inv.take(itemId, n);
      for (const b of before) if (b.list[b.index] !== b.stack || b.stack.count !== b.count) undo.push(b);
      return got;
    },
    touch: () => { inv.version++; },
  };
}

/** What the bench reads the sources from. */
export interface CraftSourceInput {
  inv: Inventory;
  /** The train Lockbox (run/trainLockbox.ts TrainLockbox: its live slots and version). */
  lockbox?: {slots: (ItemStack | null)[]; version: number} | null;
  /** The chests standing in the parked car (EquipmentSystemLike.storesAboard()). */
  stores?: readonly EquipmentStore[];
}

/** The sources in THE order: carried, the worn backpack, the Lockbox, the chests aboard (by unit number). */
export function craftSources(o: CraftSourceInput): MaterialSource[] {
  const inv = o.inv, box = o.lockbox ?? null;
  const out: MaterialSource[] = [
    carriedSource(inv),
    slotSource('backpack', 'backpack', () => inv.wornBag()?.bag ?? null, () => { inv.version++; }),
  ];
  if (box) out.push(slotSource('lockbox', 'lockbox', () => box.slots, () => { box.version++; }));
  const stores = [...(o.stores ?? [])].sort((a, b) => equipmentSeqOf(a.uid) - equipmentSeqOf(b.uid) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  for (const st of stores) out.push(slotSource('chest', `chest:${st.uid}`, () => st.slots, () => st.touch()));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Counting

/** One material across the sources. */
export interface MaterialCount {
  total: number;
  carried: number;
  backpack: number;
  lockbox: number;
  /** Every chest aboard together. */
  chests: number;
  /** Per source, in source order (a chest each). */
  sources: {id: string; kind: MaterialSourceKind; n: number}[];
}

export type MaterialCounts = Record<RecipeMaterial, MaterialCount>;

const GROUP: Record<MaterialSourceKind, 'carried' | 'backpack' | 'lockbox' | 'chests'> = {carried: 'carried', backpack: 'backpack', lockbox: 'lockbox', chest: 'chests'};

/** Every recipe material: the total and where it is. */
export function countMaterials(sources: readonly MaterialSource[]): MaterialCounts {
  const out = {} as MaterialCounts;
  for (const m of RECIPE_MATERIALS) {
    const c: MaterialCount = {total: 0, carried: 0, backpack: 0, lockbox: 0, chests: 0, sources: []};
    for (const s of sources) {
      const n = s.count(m);
      c.total += n;
      c[GROUP[s.kind]] += n;
      c.sources.push({id: s.id, kind: s.kind, n});
    }
    out[m] = c;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The plan and the debit

export interface CraftTake {
  /** MaterialSource.id. */
  source: string;
  kind: MaterialSourceKind;
  material: RecipeMaterial;
  n: number;
}

export type MissingMaterials = Partial<Record<RecipeMaterial, number>>;

/** The exact draw for one recipe, in source order per material. */
export interface CraftPlan {
  ok: true;
  kind: EquipmentKind;
  takes: CraftTake[];
}

/** Not enough: how many more of each material are needed (only the materials that are short). */
export interface CraftShort {
  ok: false;
  missing: MissingMaterials;
}

/** What one craft would draw from where (carried first, then the backpack, the Lockbox, the chests) — or what is missing. Changes nothing. */
export function planCraft(recipe: Recipe, sources: readonly MaterialSource[]): CraftPlan | CraftShort {
  const takes: CraftTake[] = [];
  const missing: MissingMaterials = {};
  let short = false;
  for (const m of RECIPE_MATERIALS) {
    let need = recipe.cost[m];
    if (!(need > 0)) continue;
    for (const s of sources) {
      if (need <= 0) break;
      const n = Math.min(need, s.count(m));
      if (n <= 0) continue;
      takes.push({source: s.id, kind: s.kind, material: m, n});
      need -= n;
    }
    if (need > 0) { missing[m] = need; short = true; }
  }
  return short ? {ok: false, missing} : {ok: true, kind: recipe.kind, takes};
}

/** What applyCraft did: enough to put every unit back exactly. */
export interface CraftReceipt {
  plan: CraftPlan;
  undo: StackUndo[];
  touched: MaterialSource[];
}

function restore(undo: readonly StackUndo[], touched: readonly MaterialSource[]): void {
  for (let i = undo.length - 1; i >= 0; i--) {
    const u = undo[i];
    u.stack.count = u.count;
    u.list[u.index] = u.stack;
  }
  for (const s of touched) s.touch();
}

/**
 * Draw a plan from the sources, synchronously and exactly. Returns the receipt — or null when the plan no longer fits the sources (a
 * stale plan: everything already drawn is put back first, nothing changed).
 */
export function applyCraft(plan: CraftPlan, sources: readonly MaterialSource[]): CraftReceipt | null {
  const undo: StackUndo[] = [], touched: MaterialSource[] = [];
  for (const t of plan.takes) {
    const s = sources.find(x => x.id === t.source);
    const got = s ? s.take(t.material, t.n, undo) : 0;
    if (s && got > 0 && !touched.includes(s)) touched.push(s);
    if (got !== t.n) { restore(undo, touched); return null; }
  }
  for (const s of touched) s.touch();
  return {plan, undo, touched};
}

/** Put a debit back exactly: the same stack objects, at the same slots, with the same counts. */
export function refundCraft(receipt: CraftReceipt): void {
  restore(receipt.undo, receipt.touched);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The transaction

export const CRAFT_TEXT = {
  /** equipment.craft() gave no unit although craftBlock() allowed it: the materials were put back. */
  failed: 'The bench could not build it — your materials were put back',
} as const;

/** 'Need 3 more Scrap metal and 2 more Electrical parts' (the recipe materials' order). */
export function missingText(missing: MissingMaterials): string {
  const parts: string[] = [];
  for (const m of RECIPE_MATERIALS) {
    const n = missing[m] ?? 0;
    if (n > 0) parts.push(`${n} more ${itemDef(m).name}`);
  }
  return parts.length ? `Need ${parts.join(' and ')}` : '';
}

export interface CraftContext {
  sources: readonly MaterialSource[];
  equipment: Pick<EquipmentSystemLike, 'craftBlock' | 'craft'>;
}

export type CraftResult =
  | {ok: true; unit: EquipmentUnit; plan: CraftPlan}
  | {ok: false; reason: 'blocked' | 'missing' | 'failed'; text: string; missing?: MissingMaterials; error?: unknown};

/**
 * THE craft: block check -> plan -> debit -> the unit on the car floor; any refusal leaves every stack, count and version-relevant
 * content exactly as it was (a failed last step is refunded exactly).
 */
export function craft(recipe: Recipe, ctx: CraftContext): CraftResult {
  const block = ctx.equipment.craftBlock(recipe.kind);
  if (block) return {ok: false, reason: 'blocked', text: block};
  const plan = planCraft(recipe, ctx.sources);
  if (!plan.ok) return {ok: false, reason: 'missing', text: missingText(plan.missing), missing: plan.missing};
  const receipt = applyCraft(plan, ctx.sources);
  if (!receipt) return {ok: false, reason: 'failed', text: CRAFT_TEXT.failed};
  let unit: EquipmentUnit | null = null, error: unknown;
  try { unit = ctx.equipment.craft(recipe.kind); } catch (err) { error = err; }
  if (!unit) {
    refundCraft(receipt);
    return error === undefined ? {ok: false, reason: 'failed', text: CRAFT_TEXT.failed} : {ok: false, reason: 'failed', text: CRAFT_TEXT.failed, error};
  }
  return {ok: true, unit, plan};
}
