// Inventory: five hotbar slots (keys 1-5) plus the pockets ("pack", PACK_SIZE = POCKET_GRID 6 × 3 = 18 slots). Pure logic, no DOM.
//
// Iteration 16 (lane GEAR):
// - GEAR SLOTS (helmet / chest / gloves / boots / backpack; items/gear.ts GEAR_SLOTS order) — SlotRef {bar: 'gear', index}.
//   A gear slot only takes gear of its type. Worn gear's stats come from gearModifiersFor(inv.gear) (a ModifierSource).
// - DYNAMIC POCKETS: `pack.length` = PACK_SIZE + the worn chest rig's pockets (the same array, resized in place). Any
//   change that would shrink the pockets while the extra ones hold something is REFUSED (nothing is dropped or lost).
// - BACKPACK: a backpack ItemStack carries its own contents in `stack.bag` (one level: a bag never goes inside a bag,
//   and a bag never goes into the pockets / quick slots). No Inventory method reads or writes the contents of the WORN
//   backpack (add / take / count / find / move / moveCount / detach / consumeAt / hasRoomFor all ignore them); they are
//   only reachable through `bagMove` / `bagQuick` on a backpack that is NOT worn, which gear/bagSession.ts calls only for
//   a bag lying on the ground whose transfer view is open.
// - SNAPSHOTS for run carryover / Retry level (lane RUN): toJSON / fromJSON / loadJSON / clone — deep, same uids, and
//   nextUid restored above every uid. Every change bumps `version`.
//
// Task office-overhaul-20261030 (lane INTERACT, user feedback #6 "introduce grenade slot, flare can go in it. Throw grenade with G"):
// - GRENADE SLOT: one dedicated slot (`throwSlot`, SlotRef {bar: 'throw', index: 0}; HUD: end of the quick-slot bar, key G) that
//   takes ONLY kind 'throwable' items. Picking a throwable up fills it first (same item merge, else the empty slot), then the
//   normal order. count / take / find / holds / hasRoomFor / allStacks / snapshots include it; moves validate it.
// - SNAPSHOT v2 (`throw` field). loadJSON migrates v1 snapshots (older saves / carryover): the grenade slot starts empty and every
//   flare stays where it was. A non-throwable found in it (malformed) goes back in through add(), never lost.
//
// Task gasmask-breach-20261030 (mask lane): the MASK gear slot (appended to GEAR_SLOTS) and a gas mask's fitted-filter charge
// `filter` (seconds left) ON ITS OWN STACK — kept by every move / swap / drop / snapshot (stackToJSON / stackFromJSON, clone,
// section-memory records), so taking the mask off and on, swapping masks or travelling never refills or duplicates it. A mask
// stack made here starts with no charge (undefined = 0); a found mask's partly used filter comes from its placement. Spare
// filters (`gas_filter`, kind 'supply') go to the pockets first, like ammo; count / take see only quick slots + pockets.
//
// Task knife-windup-20261030 (lane SLOT, user: "I want a custom melee weapon slot ... you hit the tilde key to switch to your knife
// ... so that way it doesn't take up a hot[bar] slot"):
// - MELEE SLOT: one dedicated equipment slot (`meleeSlot`, SlotRef MELEE_REF = {bar: 'melee', index: 0}; HUD: the "~" cell before
//   quick slot 1; key ~ / ` = KeyboardEvent.code 'Backquote') that takes ONLY melee weapons (a WeaponDef with `melee`: the knife
//   today, clubs / crowbars later) — set / move / swap / bag moves of anything else are refused ('wrong-slot'). A picked-up melee
//   weapon fills an EMPTY melee slot first (the same object), else the normal order; a second knife stays an ordinary item.
// - SELECTION: `selected` stays the quick-slot index (0-4, always valid: the "remembered" quick slot). `meleeSelected` says the
//   melee slot's weapon is in the hands instead: selectedStack() / selectedRef() then return the melee slot. selectMelee() needs
//   a weapon in it (false, nothing changes, when empty); select(i) (keys 1-5 / wheel) leaves the melee slot. Whenever the melee
//   slot is emptied (dropped, moved, bagged) while selected, the selection falls back to the remembered quick slot — the hands
//   never keep a stale knife, and a knife picked up later never draws itself.
// - count / take / find / holds / hasRoomFor / allStacks / snapshots include it; consumeAt never touches it.
// - SNAPSHOT v3 (`melee` + `meleeSelected`). loadJSON migrates v1 / v2 snapshots: see migrateLegacyMelee() (exactly one carried melee
//   weapon — quick slots first, then pockets — moves into the empty melee slot; never the worn backpack's contents).
//
// Task train-lockbox-windows-20261101-232156 (lane BOX): STORE transfers with the train's Lockbox (run/trainLockbox.ts, LOCKBOX_SLOTS) —
// storeMove / storeQuick / storeWornBag on a slot list the inventory does not own (StoreRef {bar: 'store', index}), through the same
// move engine. The store takes every item kind (a backpack too, whole with its contents); a backpack leaves it only onto your back.
//
// Task filter-tension-airtank-20261104-072836: the AIRTANK BACKPACK (items/gear.ts `airtank_backpack`) is back-slot gear WITHOUT
// storage — not a bag (isBagItem false): no contents list, it can ride in the pockets / a bag like a vest, and it never becomes a
// grounded bag. Its air (seconds left) is `air` ON ITS OWN STACK, kept by every move / swap / drop / snapshot like a mask's `filter`.
// makeStack makes a NEW tank full; a missing `air` reads as empty (never full), so no copy path can refill one. `wornBag()` is the
// worn back item only when it is a real bag (the 6 / set-down / bag paths use it). Wearing it while a backpack is worn swaps
// through the normal move engine, which refuses (a backpack never goes into the pockets): nothing is moved, dropped or lost.
//
// Task gameplay-feedback-20261111 (lane STORAGE; user: "Add one extra row to the player inventory, backpack inventory and train chest.
// Keep their existing column counts unchanged. Make this real usable storage, not just a visual resize."): the pockets are POCKET_GRID
// (6 columns × 3 rows: PACK_SIZE 12 -> 18; a worn chest rig still adds its 4 after them: 16 -> 22) and a backpack's own contents
// BACKPACK_GRID (items/gear.ts, 6 × 3: 12 -> 18). Every capacity check reads these constants, so the new slots are real slots.
// - SNAPSHOTS record `packBase` (the base pockets they were written with). A snapshot without it was written with LEGACY_PACK_SIZE (12)
//   base pockets: loadJSON keeps pockets 0..11 where they are and moves its chest-rig pockets (12..15) to the rig's indices now
//   (PACK_SIZE..PACK_SIZE + 3) — never into the new base pockets, which load empty (remapPockets). Still format v3 (an optional field,
//   like the save's `filterLifeS`).
// - BAGS: a backpack's contents list written at an older, smaller size (12) loads padded with empty slots at the end (fitBagContents:
//   stackFromJSON, the Lockbox's loader, remembered loose items); every item keeps its slot, nothing is reordered.

import {itemDef} from './items';
import {canonicalItemId} from './calibers';
import {WEAPONS, meleeDefOf} from '../weapons/weapons';
import {GEAR_SLOTS, GEAR_SLOT_NAMES, gearSpec, isAirtank, isBagItem, isFilterMask, type GearSlot} from './gear';

export interface ItemStack {
  uid: number;
  itemId: string;
  count: number;
  /** Rounds currently loaded (weapons only). */
  mag?: number;
  /**
   * Task studio-turnstile-reload-visuals-20261112-063646-01: fired hulls still in a revolver's chambers (a BreakReload with spentHulls: the
   * Turnstile), thrown out when its reload opens it; mag + spent <= magazine. Absent = none (every older save / found gun: empty chambers).
   * Travels with the item like `mag` (drop / bag / Lockbox / saves).
   */
  spent?: number;
  /** Iteration 16 (GEAR): a backpack's own contents (backpack stacks only; never holds another backpack). */
  bag?: (ItemStack | null)[];
  /** Mask lane: a gas mask's fitted filter, seconds of on-face use left (gas masks only; undefined = no charge). */
  filter?: number;
  /** Task filter-tension-airtank-20261104-072836: an Airtank Backpack's air, seconds left (airtanks only; undefined = empty). */
  air?: number;
  /**
   * (task studio-general-armor-20261107-231448-01) An armour-bearing gear item's armour LEFT after wear (fraction, 0..its GearSpec.armor; player/armor.ts). Absent =
   * undamaged (every older save / new item); travels with the item (drop / bag / Lockbox / cargo / saves): never reset by equipping.
   */
  armor?: number;
}

export type Bar = 'hotbar' | 'pack' | 'gear' | 'throw' | 'melee';
export interface SlotRef { bar: Bar; index: number }
/** Iteration 16 (GEAR): a slot of a (grounded, open) backpack's own contents. */
export interface BagRef { bar: 'bag'; index: number }
export type AnyRef = SlotRef | BagRef;
/** Task train-lockbox-windows-20261101-232156 (lane BOX): a slot of the train's Lockbox (a slot list outside the inventory). */
export interface StoreRef { bar: 'store'; index: number }
/** A player slot or a Lockbox slot (the Lockbox transfer view). */
export type StoreSideRef = SlotRef | StoreRef;

export const HOTBAR_SIZE = 5;
/**
 * The pockets' shape: every pockets view lays them out in POCKET_GRID.columns (the chest rig's extra pockets continue the grid).
 * Task gameplay-feedback-20261111 (lane STORAGE): one more row, the same columns — 6 × 2 -> 6 × 3. Change the shape HERE only.
 */
export const POCKET_GRID: Readonly<{columns: number; rows: number}> = Object.freeze({columns: 6, rows: 3});
/** Base pockets (without a chest rig): POCKET_GRID columns × rows. */
export const PACK_SIZE = POCKET_GRID.columns * POCKET_GRID.rows;
/** The base pockets of every snapshot written before task gameplay-feedback-20261111 (no `packBase`): its chest-rig pockets follow them. */
export const LEGACY_PACK_SIZE = 12;
/** Task office-overhaul-20261030 (INTERACT): grenade slots (one; HUD key G). */
export const THROW_SLOTS = 1;
/** Task office-overhaul-20261030 (INTERACT): the grenade slot ref. */
export const THROW_REF: SlotRef = Object.freeze({bar: 'throw', index: 0}) as SlotRef;
/** Task knife-windup-20261030 (SLOT): melee slots (one; HUD key ~). */
export const MELEE_SLOTS = 1;
/** Task knife-windup-20261030 (SLOT): the melee slot ref. */
export const MELEE_REF: SlotRef = Object.freeze({bar: 'melee', index: 0}) as SlotRef;
/**
 * Snapshot format: 1 = iteration 16 (no grenade slot), 2 = + `throw` (task office-overhaul-20261030), 3 = + `melee` /
 * `meleeSelected` (task knife-windup-20261030).
 */
export const INVENTORY_JSON_VERSION = 3;

/** Task knife-windup-20261030 (SLOT): whether an item is a melee weapon (the only kind the melee slot takes). */
export function isMeleeItem(itemId: string | null | undefined): boolean {
  return !!meleeDefOf(itemId);
}

export type MoveResult = 'none' | 'moved' | 'split' | 'merged' | 'swapped' | 'refused';

/** Why the last move / detach / wear was refused (the UI shows `text`). */
export type RefusalCode = 'split' | 'wrong-slot' | 'not-gear' | 'pockets-occupied' | 'bag-not-pocketable' | 'bag-in-bag'
  | 'worn-bag' | 'not-a-bag' | 'slot-taken' | 'no-room' | 'bad-ref';
export interface Refusal { code: RefusalCode; text: string }

/** Plain-data stack (snapshots). Mask lane: + `filter` (a gas mask's fitted-filter seconds). */
export interface StackJSON { uid: number; itemId: string; count: number; mag?: number; spent?: number; bag?: (StackJSON | null)[]; filter?: number; air?: number; armor?: number }
export interface InventoryJSON {
  /** 1: iteration-16 snapshots (no grenade slot), 2: + grenade slot (no melee slot) — both still loaded; 3: current. */
  v: 1 | 2 | 3;
  hotbar: (StackJSON | null)[];
  pack: (StackJSON | null)[];
  /**
   * Task gameplay-feedback-20261111 (lane STORAGE): the base pockets `pack` was written with (PACK_SIZE then); a worn chest rig's
   * pockets follow them. Absent: an older snapshot (LEGACY_PACK_SIZE base pockets) — loadJSON moves its rig pockets (remapPockets).
   */
  packBase?: number;
  gear: Record<GearSlot, StackJSON | null>;
  /** v2: the grenade slot (THROW_SLOTS entries). Absent in v1. */
  throw?: (StackJSON | null)[];
  /** v3: the melee slot (MELEE_SLOTS entries). Absent in v1 / v2 (migrated: Inventory.loadJSON). */
  melee?: (StackJSON | null)[];
  /** Quick-slot index 0-4 (v3: the remembered quick slot while the melee slot's weapon is held). */
  selected: number;
  /** v3: the melee slot's weapon is in the hands (key ~). */
  meleeSelected?: boolean;
  nextUid: number;
}

/** Frozen empty slot list for refs that are not inventory slots. */
const NO_SLOTS: (ItemStack | null)[] = Object.freeze([]) as unknown as (ItemStack | null)[];
const CHEST = GEAR_SLOTS.indexOf('chest');
const BACK = GEAR_SLOTS.indexOf('backpack');
/** Lane BOX: a backpack dragged from the Lockbox to a pocket / quick slot. */
const STORE_BAG_TEXT = 'A backpack does not go in your pockets — click it in the Lockbox to wear it (your back slot must be free).';

/** Deep plain copy of a stack (bag contents included). */
export function stackToJSON(s: ItemStack | null | undefined): StackJSON | null {
  if (!s) return null;
  const j: StackJSON = {uid: s.uid, itemId: s.itemId, count: s.count};
  if (s.mag !== undefined) j.mag = s.mag;
  if (s.spent !== undefined) j.spent = s.spent; // task studio-turnstile-reload-visuals-20261112-063646-01: hulls still in the cylinder
  if (s.bag) j.bag = s.bag.map(stackToJSON);
  if (s.filter !== undefined) j.filter = s.filter; // mask lane
  if (s.air !== undefined) j.air = s.air; // task filter-tension-airtank
  if (s.armor !== undefined) j.armor = s.armor; // task studio-general-armor-20261107-231448-01: armour left after wear
  return j;
}

/**
 * Deep copy back into live stacks (fresh objects, same uids). Lane AMMO: a legacy gun-specific ammo id (ammo_pistol / ammo_rifle /
 * ammo_shells) comes back as its caliber item (items/calibers.ts) with the same count — the stack limits are identical.
 */
export function stackFromJSON(j: StackJSON | null | undefined): ItemStack | null {
  if (!j) return null;
  const s: ItemStack = {uid: j.uid, itemId: canonicalItemId(j.itemId), count: j.count};
  if (j.mag !== undefined) s.mag = j.mag;
  if (j.spent !== undefined) s.spent = j.spent; // task studio-turnstile-reload-visuals-20261112-063646-01
  if (j.bag) s.bag = fitBagContents(s.itemId, j.bag.map(stackFromJSON)); // (lane STORAGE: an older 12-slot bag gains its new empty slots)
  if (j.filter !== undefined) s.filter = j.filter; // mask lane
  if (j.air !== undefined) s.air = j.air; // task filter-tension-airtank
  if (j.armor !== undefined) s.armor = j.armor; // task studio-general-armor-20261107-231448-01
  return s;
}

/**
 * Task gameplay-feedback-20261111 (lane STORAGE): a backpack's contents list at its item's size today (gear bagSlots: BACKPACK_SLOTS) —
 * a list written at an older, smaller size (12) gains empty slots at its END, so every item keeps its slot (nothing reordered, nothing
 * lost). A longer list is left as it is (never truncated: nothing is dropped). Returns the same array (padded in place).
 */
export function fitBagContents<T>(itemId: string, list: (T | null)[]): (T | null)[] {
  const n = gearSpec(itemId)?.bagSlots ?? 0;
  while (list.length < n) list.push(null);
  return list;
}

/** Every stack in a stack (itself + bag contents), for uid / count audits. */
export function stacksIn(s: ItemStack | null | undefined): ItemStack[] {
  if (!s) return [];
  return [s, ...(s.bag ?? []).filter((x): x is ItemStack => !!x)];
}

/**
 * Task gameplay-feedback-20261111 (lane STORAGE): the base pockets a snapshot's `pack` was written with. `packBase` when recorded;
 * otherwise an older snapshot — LEGACY_PACK_SIZE, unless its list is exactly today's length for the worn chest gear (a snapshot built
 * in today's layout without the field: tests / hand-made data).
 */
export function packBaseOf(j: Pick<InventoryJSON, 'pack' | 'packBase'>, extraPockets: number): number {
  const b = j.packBase;
  if (Number.isInteger(b) && (b as number) >= 1) return b as number;
  return (j.pack?.length ?? 0) === PACK_SIZE + extraPockets ? PACK_SIZE : LEGACY_PACK_SIZE;
}

/**
 * Task gameplay-feedback-20261111 (lane STORAGE): pockets written with `base` base pockets at their indices today — base pocket i stays
 * at i, the chest rig's pocket k (written at base + k) goes to PACK_SIZE + k. The new base pockets in between stay empty: a rig item is
 * never shuffled into a base pocket. (A base pocket that has no place any more — a smaller PACK_SIZE — is returned in `loose`; the
 * caller puts it back in through add(), never lost.)
 */
export function remapPockets<T>(list: readonly (T | null)[], base: number): {pack: (T | null)[]; loose: T[]} {
  if (base === PACK_SIZE) return {pack: [...list], loose: []};
  const pack: (T | null)[] = [], loose: T[] = [];
  list.forEach((s, i) => {
    if (!s) return;
    if (i >= base) pack[PACK_SIZE + (i - base)] = s;
    else if (i < PACK_SIZE) pack[i] = s;
    else loose.push(s);
  });
  for (let i = 0; i < pack.length; i++) pack[i] ??= null; // dense (no holes)
  return {pack, loose};
}

/** Iteration 16: each inventory instance starts on its own version range, so a swapped-in restored one always redraws. */
let versionEpoch = 0;

interface End { kind: 'hotbar' | 'pack' | 'gear' | 'bag' | 'throw' | 'melee' | 'store'; list: (ItemStack | null)[]; index: number }

export class Inventory {
  readonly hotbar: (ItemStack | null)[] = new Array(HOTBAR_SIZE).fill(null);
  /** Pockets: PACK_SIZE + the worn chest rig's extra pockets (resized in place). */
  readonly pack: (ItemStack | null)[] = new Array(PACK_SIZE).fill(null);
  /** Iteration 16 (GEAR): worn gear, GEAR_SLOTS order (helmet, chest, gloves, boots, backpack). */
  readonly gearSlots: (ItemStack | null)[] = new Array(GEAR_SLOTS.length).fill(null);
  /** Task office-overhaul-20261030 (INTERACT): the grenade slot (throwables only; G strikes / throws from it). */
  readonly throwSlot: (ItemStack | null)[] = new Array(THROW_SLOTS).fill(null);
  /** Task knife-windup-20261030 (SLOT): the melee slot (melee weapons only; ~ draws its weapon). */
  readonly meleeSlot: (ItemStack | null)[] = new Array(MELEE_SLOTS).fill(null);
  /** Quick slot 0-4 in the hands — or, while `meleeSelected`, the remembered quick slot (1-5 / wheel come back to it). */
  selected = 0;
  /** Task knife-windup-20261030 (SLOT): the melee slot is selected (read `meleeSelected`; cleared whenever the slot empties). */
  private meleeHeld = false;
  private nextUid = 1;
  /** Bumped on every change so the UI knows when to redraw. */
  version = ++versionEpoch * 1_000_000;
  /** Iteration 16 (GEAR): why the last refused operation was refused (null after a success). */
  refusal: Refusal | null = null;

  makeStack(itemId: string, count: number, mag?: number): ItemStack {
    itemId = canonicalItemId(itemId); // lane AMMO: a legacy ammo id makes its caliber item
    const def = itemDef(itemId);
    const s: ItemStack = {uid: this.nextUid++, itemId, count: Math.min(count, def.stackMax)};
    if (def.kind === 'weapon') s.mag = mag ?? WEAPONS[def.weaponId!].magazine;
    const bagSlots = def.gear?.bagSlots ?? 0;
    if (bagSlots > 0) s.bag = new Array(bagSlots).fill(null);
    if (def.gear?.airLife) s.air = def.gear.airLife; // task filter-tension-airtank: a NEW tank is full (copies keep their own `air`)
    return s;
  }

  /** Iteration 16: a fresh uid from this run's counter (splits made outside the inventory, e.g. a bag transfer). */
  allocUid(): number {
    return this.nextUid++;
  }

  /** Iteration 16: keep the uid counter above stacks restored from elsewhere (grounded bags from section memory). */
  reserveUids(maxUid: number): void {
    if (Number.isFinite(maxUid) && maxUid >= this.nextUid) this.nextUid = Math.floor(maxUid) + 1;
  }

  private list(bar: Bar): (ItemStack | null)[] {
    // strict: any other bar (e.g. a stray 'bag' ref) is no slot at all — it never aliases the pockets
    return bar === 'hotbar' ? this.hotbar : bar === 'gear' ? this.gearSlots : bar === 'pack' ? this.pack : bar === 'throw' ? this.throwSlot
      : bar === 'melee' ? this.meleeSlot : NO_SLOTS;
  }
  get(ref: SlotRef): ItemStack | null {
    return this.list(ref.bar)[ref.index] ?? null;
  }
  /**
   * Raw slot write (starter loadouts, tests). A gear slot only takes matching gear (or null), a backpack never goes into
   * the quick slots / pockets, and the pockets never shrink over an occupied extra pocket: an invalid write is refused
   * (no change, `refusal` says why).
   */
  set(ref: SlotRef, s: ItemStack | null): void {
    const list = this.list(ref.bar);
    if (ref.index < 0 || ref.index >= list.length) { this.refuse('bad-ref', 'No such slot.'); return; }
    if (s) {
      const r = this.acceptsText({kind: ref.bar, list, index: ref.index}, s.itemId);
      if (r) { this.refuse(r.code, r.text); return; }
    }
    if (ref.bar === 'gear' && ref.index === CHEST) {
      const cap = PACK_SIZE + this.pocketsOf(s);
      if (!this.pocketsFree(cap)) { this.refuse('pockets-occupied', this.pocketsText()); return; }
      list[ref.index] = s;
      this.resizePack(cap);
    } else list[ref.index] = s;
    this.settleMelee();
    this.refusal = null;
    this.version++;
  }
  /** What is in the hands: the selected quick slot, or the melee slot's weapon while it is selected (task knife-windup-20261030). */
  selectedStack(): ItemStack | null {
    return this.meleeSelected ? this.meleeSlot[0] : this.hotbar[this.selected] ?? null;
  }
  /** Task knife-windup-20261030 (SLOT): the slot whose item is in the hands (MELEE_REF or the selected quick slot). */
  selectedRef(): SlotRef {
    return this.meleeSelected ? MELEE_REF : {bar: 'hotbar', index: this.selected};
  }
  /** Quick slot i (keys 1-5 / wheel); leaves the melee slot. */
  select(i: number): void {
    if (i < 0 || i >= HOTBAR_SIZE) return;
    this.selected = i;
    this.meleeHeld = false;
    this.version++;
  }
  /** Next / previous quick slot; from the melee slot, back to the remembered quick slot first. */
  cycle(dir: number): void {
    this.select(this.meleeSelected ? this.selected : (this.selected + dir + HOTBAR_SIZE) % HOTBAR_SIZE);
  }

  // --- Task knife-windup-20261030 (lane SLOT): the melee slot -------------------------------------------------------------

  /** The melee weapon in the melee slot (null when empty). */
  get melee(): ItemStack | null {
    return this.meleeSlot[0] ?? null;
  }
  /** The melee slot's weapon is in the hands (key ~). Never true while the slot is empty. */
  get meleeSelected(): boolean {
    return this.meleeHeld && !!this.meleeSlot[0];
  }
  /** Draw the melee slot's weapon (key ~). False (nothing changes) when the slot is empty; the remembered quick slot is kept. */
  selectMelee(): boolean {
    if (!this.meleeSlot[0]) return false;
    if (!this.meleeHeld) { this.meleeHeld = true; this.version++; }
    return true;
  }
  /**
   * An EMPTY melee slot takes the first melee weapon carried elsewhere (pockets first, then quick slots, the held one last) —
   * ~ then always draws "the equipped melee weapon", like G and the grenade slot. Returns whether the slot holds one.
   */
  refillMeleeSlot(): boolean {
    if (this.meleeSlot[0]) return true;
    const order: SlotRef[] = [
      ...this.pack.map((_, i) => ({bar: 'pack' as const, index: i})),
      ...this.hotbar.map((_, i) => ({bar: 'hotbar' as const, index: i})).filter(r => r.index !== this.selected),
      {bar: 'hotbar', index: this.selected},
    ];
    for (const r of order) {
      const st = this.get(r);
      if (st && isMeleeItem(st.itemId)) return this.moveCount(r, MELEE_REF) === 'moved';
    }
    return false;
  }
  /**
   * Put the melee weapon in `ref` into the melee slot (inventory Equip / right-click / double-click / ~ while the inventory is
   * open): a move, or a swap with the one already there (which goes to `ref`). 'none' for the melee slot itself; refused
   * ('wrong-slot') for anything that is not a melee weapon. Selection is unchanged (the caller draws it).
   */
  equipMeleeFrom(ref: SlotRef): MoveResult {
    if (ref.bar === 'melee') return this.meleeSlot[ref.index] ? 'none' : this.refuse('bad-ref', 'The melee slot is empty.');
    const st = this.get(ref);
    if (!st) return 'none';
    if (!isMeleeItem(st.itemId)) return this.refuse('wrong-slot', `Only melee weapons go in the melee slot (~) — not the ${itemDef(st.itemId).short.toLowerCase()}.`);
    return this.moveCount(ref, MELEE_REF);
  }
  /** The melee slot was emptied: a melee selection falls back to the remembered quick slot (no stale weapon, no auto-draw later). */
  private settleMelee(): void {
    if (this.meleeHeld && !this.meleeSlot[0]) this.meleeHeld = false;
  }

  // --- Iteration 16 (GEAR): gear slots ----------------------------------------------------------------------------------

  /** Worn gear by slot (a fresh record; the stacks are the live ones). */
  get gear(): Record<GearSlot, ItemStack | null> {
    const out = {} as Record<GearSlot, ItemStack | null>;
    GEAR_SLOTS.forEach((slot, i) => { out[slot] = this.gearSlots[i]; });
    return out;
  }
  worn(slot: GearSlot): ItemStack | null {
    return this.gearSlots[GEAR_SLOTS.indexOf(slot)] ?? null;
  }
  /** Pocket capacity right now: PACK_SIZE + the worn chest gear's extra pockets. */
  get capacity(): number {
    return PACK_SIZE + this.pocketsOf(this.gearSlots[CHEST]);
  }
  /** Extra pockets the worn chest gear adds (0 without a rig). */
  get extraPockets(): number {
    return this.pocketsOf(this.gearSlots[CHEST]);
  }
  /** Task filter-tension-airtank-20261104-072836: the worn back item when it is a real bag (has contents), else null (e.g. an airtank). */
  wornBag(): ItemStack | null {
    const st = this.gearSlots[BACK];
    return st && isBagItem(st.itemId) ? st : null;
  }

  /** Task filter-tension-airtank-20261104-072836: why the back slot is not free for a backpack (the airtank needs Tab, a bag needs 6). */
  private backTakenText(after: string): string {
    const st = this.gearSlots[BACK];
    return st && !isBagItem(st.itemId) ? `You are wearing the ${itemDef(st.itemId).name} — take it off first (Tab: gear).`
      : `You are already wearing a backpack — ${after}`;
  }

  /** Whether `stack` is the backpack being worn right now (its contents are then out of reach). */
  isWornBag(stack: ItemStack | null | undefined): boolean {
    return !!stack && this.gearSlots[BACK] === stack;
  }

  /**
   * Wear a piece of gear taken from a slot (Tab: double-click / right-click / Wear button, drag onto the gear panel).
   * Swaps with what is worn there (the old piece goes to the source slot) under the usual validation.
   */
  wearFrom(ref: SlotRef): MoveResult {
    const st = this.get(ref);
    const spec = gearSpec(st?.itemId);
    if (!st || !spec) return this.refuse('not-gear', 'That is not something you can wear.');
    return this.moveCount(ref, {bar: 'gear', index: GEAR_SLOTS.indexOf(spec.slot)});
  }

  /** Take off worn gear into the first free pocket (then quick slot). Refused for a backpack (6 puts it down) or a rig with full extra pockets. */
  takeOff(slot: GearSlot): MoveResult {
    const k = GEAR_SLOTS.indexOf(slot), st = this.gearSlots[k];
    if (!st) return 'none';
    if (isBagItem(st.itemId)) return this.refuse('bag-not-pocketable', 'A backpack does not fit in your pockets — press 6, then click to put it down.');
    const cap = slot === 'chest' ? PACK_SIZE : this.capacity;
    for (const bar of ['pack', 'hotbar'] as const) {
      const list = this.list(bar);
      const n = bar === 'pack' ? Math.min(cap, list.length) : list.length;
      for (let i = 0; i < n; i++) if (!list[i]) return this.moveCount({bar: 'gear', index: k}, {bar, index: i});
    }
    return this.refuse('no-room', `No free pocket to take the ${itemDef(st.itemId).short.toLowerCase()} off into — drop it instead.`);
  }

  /** Wear a backpack that is NOT in this inventory (a grounded bag's "Wear"): the very same stack (identity + contents). */
  wearBag(stack: ItemStack): boolean {
    if (!isBagItem(stack.itemId)) { this.refuse('not-a-bag', 'That is not a backpack.'); return false; }
    if (this.gearSlots[BACK]) { this.refuse('slot-taken', this.backTakenText('put yours down first (6, then click).')); return false; }
    if (this.holds(stack)) { this.refuse('bad-ref', 'That backpack is already yours.'); return false; }
    this.gearSlots[BACK] = stack;
    this.refusal = null;
    this.version++;
    return true;
  }

  /** Take the worn backpack off (to set it on the ground: gear/system.ts). Returns the same stack, contents untouched. */
  takeOffBag(): ItemStack | null {
    const st = this.gearSlots[BACK];
    if (!st) return null;
    this.gearSlots[BACK] = null;
    this.version++;
    return st;
  }

  /** Whether a stack object is anywhere in the quick slots / pockets / gear slots / grenade slot / melee slot. */
  holds(stack: ItemStack): boolean {
    return this.hotbar.includes(stack) || this.pack.includes(stack) || this.gearSlots.includes(stack) || this.throwSlot.includes(stack)
      || this.meleeSlot.includes(stack);
  }

  /** Task office-overhaul-20261030 (INTERACT): the throwable in the grenade slot (null when empty). */
  get thrown(): ItemStack | null {
    return this.throwSlot[0] ?? null;
  }

  /**
   * Task office-overhaul-20261030 (INTERACT): an EMPTY grenade slot takes the first throwable stack carried elsewhere (pockets
   * first, then quick slots, the held one last) — G then always throws "the equipped throwable". Returns whether it holds one.
   */
  refillThrowSlot(): boolean {
    if (this.throwSlot[0]) return true;
    const order: SlotRef[] = [
      ...this.pack.map((_, i) => ({bar: 'pack' as const, index: i})),
      ...this.hotbar.map((_, i) => ({bar: 'hotbar' as const, index: i})).filter(r => r.index !== this.selected),
      {bar: 'hotbar', index: this.selected},
    ];
    for (const r of order) {
      const st = this.get(r);
      if (st && itemDef(st.itemId).kind === 'throwable') return this.moveCount(r, THROW_REF) === 'moved';
    }
    return false;
  }

  /**
   * Adds as much of the stack as fits. Returns the count that did not fit.
   * Iteration 16: gear is WORN straight away when its slot is empty (`opts.wear`, default true; a picked-up vest goes on);
   * otherwise it goes to the pockets first. A backpack is never pocketed: it is worn if the back slot is free, else refused.
   */
  add(stack: ItemStack, opts: {wear?: boolean} = {}): number {
    const def = itemDef(stack.itemId);
    if (def.kind === 'gear' && def.gear) {
      const k = GEAR_SLOTS.indexOf(def.gear.slot);
      if ((opts.wear ?? true) && !this.gearSlots[k] && !this.holds(stack)) {
        if (k !== CHEST || this.pocketsFree(PACK_SIZE + this.pocketsOf(stack))) {
          this.gearSlots[k] = stack;
          if (k === CHEST) this.resizePack(PACK_SIZE + this.pocketsOf(stack));
          this.refusal = null;
          this.version++;
          return 0;
        }
      }
      if (isBagItem(stack.itemId)) { this.refuse('bag-not-pocketable', this.backTakenText('a second one does not fit in your pockets.')); return stack.count; }
    }
    let left = stack.count;
    // Task office-overhaul-20261030 (INTERACT): a throwable fills the grenade slot first (same item merge, else the empty slot)
    if (def.kind === 'throwable') {
      const t = this.throwSlot[0];
      if (t && t.itemId === stack.itemId && t.count < def.stackMax) {
        const n = Math.min(left, def.stackMax - t.count);
        t.count += n;
        left -= n;
      } else if (!t) {
        const n = Math.min(left, def.stackMax);
        this.throwSlot[0] = n === stack.count ? stack : {...stack, uid: this.nextUid++, count: n};
        left -= n;
      }
      if (!left) { this.refusal = null; this.version++; return 0; }
    }
    // Task knife-windup-20261030 (SLOT): a melee weapon fills an EMPTY melee slot first (the same object); a second one is an ordinary item
    if (isMeleeItem(stack.itemId) && !this.meleeSlot[0] && !this.holds(stack)) {
      const n = Math.min(left, def.stackMax);
      this.meleeSlot[0] = n === stack.count ? stack : {...stack, uid: this.nextUid++, count: n};
      left -= n;
      if (!left) { this.refusal = null; this.version++; return 0; }
    }
    if (def.stackMax > 1) {
      for (const s of [...this.pack, ...this.hotbar]) {
        if (!s || s.itemId !== stack.itemId || s.count >= def.stackMax) continue;
        const n = Math.min(left, def.stackMax - s.count);
        s.count += n;
        left -= n;
        if (!left) break;
      }
    }
    const order: Bar[] = def.kind === 'ammo' || def.kind === 'gear' || def.kind === 'supply' || def.kind === 'material' || def.kind === 'part' || def.kind === 'currency' ? ['pack', 'hotbar'] : ['hotbar', 'pack']; // mask lane: filters like ammo; lane RACK: materials too; task reactor-build-20261101 (lane RESTART): restart parts too; task studio-market-rework-20261108-074144-01 (lane TRADE): Rail Ties too
    for (const bar of order) {
      const list = this.list(bar);
      for (let i = 0; i < list.length && left > 0; i++) {
        if (list[i]) continue;
        const n = Math.min(left, def.stackMax);
        list[i] = n === stack.count && left === stack.count && !this.throwSlot.includes(stack) && !this.meleeSlot.includes(stack) ? stack : {...stack, uid: this.nextUid++, count: n};
        left -= n;
      }
      if (!left) break;
    }
    this.version++;
    return left;
  }

  count(itemId: string): number {
    let n = 0;
    for (const s of [...this.hotbar, ...this.pack, ...this.throwSlot, ...this.meleeSlot]) if (s && s.itemId === itemId) n += s.count; // + grenade (INTERACT) / melee (SLOT) slot
    return n;
  }

  /** Removes up to n of an item (backpack first; the grenade slot, then the melee slot last). Returns how many were removed. */
  take(itemId: string, n: number): number {
    let got = 0;
    for (const bar of ['pack', 'hotbar', 'throw', 'melee'] as Bar[]) {
      const list = this.list(bar);
      for (let i = list.length - 1; i >= 0 && got < n; i--) {
        const s = list[i];
        if (!s || s.itemId !== itemId) continue;
        const k = Math.min(s.count, n - got);
        s.count -= k;
        got += k;
        if (s.count <= 0) list[i] = null;
      }
    }
    this.settleMelee();
    if (got) this.version++;
    return got;
  }

  /** Consume one from a specific slot (used for consumables in hand). */
  consumeAt(ref: SlotRef): boolean {
    if (ref.bar === 'gear' || ref.bar === 'melee') return false; // Iteration 16: worn gear is never consumed; SLOT: nor a melee weapon
    const s = this.get(ref);
    if (!s) return false;
    s.count--;
    if (s.count <= 0) this.set(ref, null);
    else this.version++;
    return true;
  }

  /** Empties a slot and returns what was there (null, and nothing changes, when that is refused: a full rig's chest slot). */
  remove(ref: SlotRef): ItemStack | null {
    const s = this.get(ref);
    if (!s) return null;
    this.set(ref, null);
    return this.get(ref) === s ? null : s;
  }

  /**
   * Takes `count` (default: all) out of a slot, e.g. to drop it into the world. Taking the whole
   * stack returns the same object (uid and loaded magazine kept); a partial take leaves the rest
   * in place and returns a new stack with a fresh uid.
   * Iteration 16: refused (null + `refusal`) for a rig whose extra pockets hold items, and for a backpack unless
   * `opts.bag` (a backpack leaves only as a grounded bag: gear/system.ts).
   */
  detach(ref: SlotRef, count?: number, opts: {bag?: boolean} = {}): ItemStack | null {
    const s = this.get(ref);
    if (!s) return null;
    if (isBagItem(s.itemId) && !opts.bag) { this.refuse('bag-not-pocketable', 'Put a backpack down with 6 (then click) — it lands on the ground as a bag you can open.'); return null; }
    const n = Math.max(1, Math.min(s.count, Math.floor(count ?? s.count)));
    if (n >= s.count) return this.remove(ref);
    s.count -= n;
    this.version++;
    return {...s, uid: this.nextUid++, count: n};
  }

  /** Move/merge/swap between two slots (whole stack). */
  move(from: SlotRef, to: SlotRef): boolean {
    const r = this.moveCount(from, to);
    return r !== 'none' && r !== 'refused';
  }

  /**
   * Drag-and-drop move of `count` items (default: the whole stack) from one slot to another:
   * - empty target: the whole stack moves as the same object (uid, mag); a split creates a new
   *   stack with a fresh uid and leaves the rest behind;
   * - same item with room: merge up to stackMax, any remainder stays in the source slot;
   * - anything else: the two whole stacks swap. A split onto a different (or full) stack is
   *   refused, because the remainder would have nowhere to go.
   * Selection (`selected`) is a slot index and never changes here: the caller re-syncs what is held.
   * Iteration 16: gear slots validate the item type; a backpack never enters the quick slots / pockets; the pockets
   * never shrink over occupied extra pockets (refused, `refusal` says why).
   */
  moveCount(from: SlotRef, to: SlotRef, count?: number): MoveResult {
    const a = this.end(from), b = this.end(to);
    if (!a || !b) return from.bar === to.bar && from.index === to.index ? 'none' : this.refuse('bad-ref', 'No such slot.');
    return this.moveEnds(a, b, count);
  }

  // --- Iteration 16 (GEAR): grounded-bag transfers (called only through gear/bagSession.ts) ------------------------------

  /**
   * Move between this inventory and a backpack's own contents (or within them). `bag` must be a backpack stack that is
   * NOT worn by this inventory (a worn bag's contents are out of reach: refused 'worn-bag').
   */
  bagMove(bag: ItemStack, from: AnyRef, to: AnyRef, count?: number): MoveResult {
    const g = this.bagGuard(bag);
    if (g) return g;
    const a = this.end(from, bag), b = this.end(to, bag);
    if (!a || !b) return this.refuse('bad-ref', 'No such slot.');
    return this.moveEnds(a, b, count);
  }

  /**
   * Click-to-transfer: a bag slot's stack goes into the pockets / quick slots (merging, never auto-worn; what does not fit
   * stays in the bag), or a quick-slot / pocket stack goes into the bag (merging, then the first empty bag slot).
   * Returns how many items moved.
   */
  bagQuick(bag: ItemStack, from: AnyRef): number {
    if (this.bagGuard(bag)) return 0;
    const src = this.end(from, bag);
    const st = src?.list[src.index];
    if (!src || !st) return 0;
    if (src.kind === 'bag') {
      // bag -> quick slots / pockets: add() places the same object when it fits whole (uid kept), else merges / copies
      const before = st.count;
      const left = this.add(st, {wear: false});
      if (left >= before) { this.refuse('no-room', 'No room in your pockets or quick slots.'); return 0; }
      if (left > 0) st.count = left; // the rest stays in the bag
      else src.list[src.index] = null;
      this.refusal = null;
      this.version++;
      return before - left;
    }
    if (src.kind === 'gear') { this.refuse('not-gear', 'Take worn gear off in the inventory (Tab) first.'); return 0; }
    const r = this.acceptsText({kind: 'bag', list: bag.bag!, index: 0}, st.itemId);
    if (r) { this.refuse(r.code, r.text); return 0; }
    // quick slots / pockets -> bag: merge onto the same item, the rest (same object, uid kept) into the first empty slot
    const def = itemDef(st.itemId), list = bag.bag!;
    const before = st.count;
    let left = before;
    if (def.stackMax > 1) for (const s of list) {
      if (!s || s.itemId !== st.itemId || s.count >= def.stackMax) continue;
      const k = Math.min(left, def.stackMax - s.count);
      s.count += k;
      left -= k;
      if (!left) break;
    }
    if (left > 0) {
      const i = list.indexOf(null);
      st.count = left;
      if (i >= 0) { list[i] = st; src.list[src.index] = null; left = 0; }
    } else src.list[src.index] = null;
    const moved = before - left;
    if (moved <= 0) { this.refuse('no-room', 'The backpack is full.'); return 0; }
    this.settleMelee(); // SLOT: the knife went into the bag
    this.refusal = null;
    this.version++;
    return moved;
  }

  private bagGuard(bag: ItemStack): MoveResult | null {
    if (!bag || !isBagItem(bag.itemId) || !bag.bag) return this.refuse('not-a-bag', 'That is not a backpack.');
    if (this.isWornBag(bag) || this.holds(bag)) return this.refuse('worn-bag', 'You cannot reach into a backpack you are wearing — put it down first (6, then click).');
    return null;
  }

  // --- Task train-lockbox-windows-20261101-232156 (lane BOX): Lockbox transfers (called only through the open Lockbox view) -------

  /**
   * Drag / drop between the quick slots / pockets / grenade slot / melee slot and a Lockbox slot list (or within either): move,
   * merge, swap or split under the usual slot rules. Worn gear is out of reach here; a backpack in the Lockbox only leaves onto
   * your back (storeQuick), never into a pocket.
   */
  storeMove(slots: (ItemStack | null)[], from: StoreSideRef, to: StoreSideRef, count?: number): MoveResult {
    const g = this.storeGuard(slots, from, to);
    if (g) return g;
    const a = this.end(from, undefined, slots), b = this.end(to, undefined, slots);
    if (!a || !b) return this.refuse('bad-ref', 'No such slot.');
    const r = this.moveEnds(a, b, count);
    if (r === 'refused' && this.refusal?.code === 'bag-not-pocketable') this.refusal = {code: 'bag-not-pocketable', text: STORE_BAG_TEXT};
    return r;
  }

  /**
   * Click-to-transfer: a Lockbox stack goes to the quick slots / pockets (merging; what does not fit stays in the Lockbox) — a
   * backpack is WORN instead (the same stack with its contents) when the back slot is free, else refused; a quick-slot / pocket /
   * grenade / melee stack goes into the Lockbox (merging, then the first empty slot, the same object). Returns how many moved.
   */
  storeQuick(slots: (ItemStack | null)[], from: StoreSideRef): number {
    if (this.storeGuard(slots, from)) return 0;
    const src = this.end(from, undefined, slots);
    const st = src?.list[src.index];
    if (!src || !st) return 0;
    if (src.kind === 'store') {
      if (isBagItem(st.itemId)) {
        if (this.gearSlots[BACK]) { this.refuse('slot-taken', this.backTakenText('stow yours in the Lockbox first, then take this one.')); return 0; }
        src.list[src.index] = null;
        this.gearSlots[BACK] = st;
        this.refusal = null;
        this.version++;
        return st.count;
      }
      const before = st.count;
      const left = this.add(st, {wear: false});
      if (left >= before) { this.refuse('no-room', 'No room in your pockets or quick slots.'); return 0; }
      if (left > 0) st.count = left; // the rest stays in the Lockbox
      else src.list[src.index] = null;
      this.refusal = null;
      this.version++;
      return before - left;
    }
    const def = itemDef(st.itemId), before = st.count;
    let left = before;
    if (def.stackMax > 1) for (const s of slots) {
      if (!s || s.itemId !== st.itemId || s.count >= def.stackMax) continue;
      const k = Math.min(left, def.stackMax - s.count);
      s.count += k;
      left -= k;
      if (!left) break;
    }
    if (left > 0) {
      const i = slots.indexOf(null);
      st.count = left;
      if (i >= 0) { slots[i] = st; src.list[src.index] = null; left = 0; }
    } else src.list[src.index] = null;
    const moved = before - left;
    if (moved <= 0) { this.refuse('no-room', 'The Lockbox is full.'); return 0; }
    this.settleMelee();
    this.refusal = null;
    this.version++;
    return moved;
  }

  /** Put the worn backpack (the same stack, contents untouched) into the first free Lockbox slot. */
  storeWornBag(slots: (ItemStack | null)[]): boolean {
    if (this.storeGuard(slots)) return false;
    const st = this.gearSlots[BACK];
    if (!st) { this.refuse('not-a-bag', 'You are not wearing a backpack.'); return false; }
    const i = slots.indexOf(null);
    if (i < 0) { this.refuse('no-room', 'The Lockbox is full.'); return false; }
    slots[i] = st;
    this.gearSlots[BACK] = null;
    this.refusal = null;
    this.version++;
    return true;
  }

  private storeGuard(slots: (ItemStack | null)[], ...refs: StoreSideRef[]): 'refused' | null {
    if (!Array.isArray(slots) || [this.hotbar, this.pack, this.gearSlots, this.throwSlot, this.meleeSlot].includes(slots)) return this.refuse('bad-ref', 'No such store.');
    for (const r of refs) if (r?.bar === 'gear') return this.refuse('not-gear', 'Take worn gear off in the inventory (Tab) first.');
    return null;
  }

  // --- move engine ------------------------------------------------------------------------------------------------------

  private end(ref: AnyRef | StoreRef, bag?: ItemStack, store?: (ItemStack | null)[]): End | null {
    if (ref.bar === 'bag') {
      const list = bag?.bag;
      return list && ref.index >= 0 && ref.index < list.length ? {kind: 'bag', list, index: ref.index} : null;
    }
    if (ref.bar === 'store') return store && Number.isInteger(ref.index) && ref.index >= 0 && ref.index < store.length ? {kind: 'store', list: store, index: ref.index} : null; // lane BOX
    const list = this.list(ref.bar);
    return ref.index >= 0 && ref.index < list.length ? {kind: ref.bar, list, index: ref.index} : null;
  }

  private acceptsText(e: End, itemId: string): Refusal | null {
    if (e.kind === 'store') return null; // lane BOX: the Lockbox takes every item kind (a backpack whole, with its contents)
    const def = itemDef(itemId);
    // Task office-overhaul-20261030 (INTERACT): the grenade slot takes throwables only
    if (e.kind === 'throw' && def.kind !== 'throwable') return {code: 'wrong-slot', text: `Only throwables (flares) go in the grenade slot (G) — not the ${def.short.toLowerCase()}.`};
    // Task knife-windup-20261030 (SLOT): the melee slot takes melee weapons only
    if (e.kind === 'melee' && !isMeleeItem(itemId)) return {code: 'wrong-slot', text: `Only melee weapons go in the melee slot (~) — not the ${def.short.toLowerCase()}.`};
    if (e.kind === 'gear') {
      const slot = GEAR_SLOTS[e.index];
      const spec = def.gear;
      if (!spec) return {code: 'not-gear', text: `Only gear goes in the ${GEAR_SLOT_NAMES[slot].toLowerCase()} slot.`};
      if (spec.slot !== slot) return {code: 'wrong-slot', text: `The ${def.short.toLowerCase()} goes in the ${GEAR_SLOT_NAMES[spec.slot].toLowerCase()} slot.`};
      return null;
    }
    if (isBagItem(itemId)) {
      return e.kind === 'bag' ? {code: 'bag-in-bag', text: 'A backpack cannot hold a backpack.'}
        : {code: 'bag-not-pocketable', text: 'A backpack does not fit in your pockets — wear it, or put it down (6, then click).'};
    }
    return null;
  }

  private pocketsOf(s: ItemStack | null | undefined): number {
    const spec = gearSpec(s?.itemId);
    return spec && spec.slot === 'chest' ? Math.max(0, Math.floor(spec.pockets ?? 0)) : 0;
  }

  private pocketsText(): string {
    const ex = this.extraPockets;
    return ex > 0 ? `Empty the chest rig's extra pockets (${PACK_SIZE + 1}–${PACK_SIZE + ex}) first — nothing is dropped.` : 'Those pockets are in use.';
  }

  /** The pockets at index >= cap are all empty (so the pockets can shrink to cap). */
  private pocketsFree(cap: number): boolean {
    for (let i = cap; i < this.pack.length; i++) if (this.pack[i]) return false;
    return true;
  }

  private resizePack(cap: number): void {
    while (this.pack.length < cap) this.pack.push(null);
    if (this.pack.length > cap && this.pocketsFree(cap)) this.pack.length = cap;
  }

  private refuse(code: RefusalCode, text: string): 'refused' {
    this.refusal = {code, text};
    return 'refused';
  }

  private moveEnds(from: End, to: End, count?: number): MoveResult {
    if (from.list === to.list && from.index === to.index) return 'none';
    const a = from.list[from.index], b = to.list[to.index];
    if (!a) return 'none';
    const n = Math.max(1, Math.min(a.count, Math.floor(count ?? a.count)));
    const whole = n >= a.count;
    let plan: 'merge' | 'move' | 'split' | 'swap';
    let k = 0;
    const max = itemDef(a.itemId).stackMax;
    if (b && b.itemId === a.itemId && max > 1 && b.count < max) { plan = 'merge'; k = Math.min(n, max - b.count); }
    else if (!b) plan = whole ? 'move' : 'split';
    else if (!whole) return this.refuse('split', 'A split stack can only go to an empty slot or onto the same item.');
    else plan = 'swap';
    if (plan !== 'merge') {
      const r = this.acceptsText(to, a.itemId);
      if (r) return this.refuse(r.code, r.text);
    }
    if (plan === 'swap') {
      const r = this.acceptsText(from, b!.itemId);
      if (r) return this.refuse(r.code, r.text);
    }
    // pockets after the move: chest gear decides the capacity; nothing may sit beyond it
    const fromAfter = plan === 'move' ? null : plan === 'swap' ? b : plan === 'merge' && a.count - k <= 0 ? null : a;
    const toAfter: ItemStack = plan === 'merge' ? b! : a;
    const chestAfter = to.kind === 'gear' && to.index === CHEST ? toAfter : from.kind === 'gear' && from.index === CHEST ? fromAfter : this.gearSlots[CHEST];
    const cap = PACK_SIZE + this.pocketsOf(chestAfter);
    for (let i = cap; i < this.pack.length; i++) {
      const occ = to.list === this.pack && to.index === i ? toAfter : from.list === this.pack && from.index === i ? fromAfter : this.pack[i];
      if (occ) return this.refuse('pockets-occupied', this.pocketsText());
    }
    if (to.list === this.pack && to.index >= cap) return this.refuse('pockets-occupied', this.pocketsText());
    let result: MoveResult;
    if (plan === 'merge') {
      b!.count += k;
      a.count -= k;
      from.list[from.index] = a.count > 0 ? a : null;
      result = 'merged';
    } else if (plan === 'move') {
      to.list[to.index] = a;
      from.list[from.index] = null;
      result = 'moved';
    } else if (plan === 'split') {
      a.count -= n;
      const piece: ItemStack = {...a, uid: this.nextUid++, count: n};
      delete piece.bag;
      to.list[to.index] = piece;
      result = 'split';
    } else {
      to.list[to.index] = a;
      from.list[from.index] = b;
      result = 'swapped';
    }
    this.resizePack(cap);
    this.settleMelee(); // SLOT: the melee weapon moved out of its slot
    this.refusal = null;
    this.version++;
    return result;
  }

  hasRoomFor(itemId: string): boolean {
    const def = itemDef(itemId);
    if (def.gear && !this.gearSlots[GEAR_SLOTS.indexOf(def.gear.slot)]) return true; // worn straight away
    if (isBagItem(itemId)) return false;
    // + grenade slot (INTERACT) / melee slot (SLOT) for their own kinds
    for (const s of [...this.hotbar, ...this.pack, ...(def.kind === 'throwable' ? this.throwSlot : []), ...(isMeleeItem(itemId) ? this.meleeSlot : [])]) {
      if (!s) return true;
      if (s.itemId === itemId && s.count < def.stackMax) return true;
    }
    return false;
  }

  find(uid: number): SlotRef | null {
    for (const bar of ['hotbar', 'pack', 'gear', 'throw', 'melee'] as Bar[]) {
      const i = this.list(bar).findIndex(s => s?.uid === uid);
      if (i >= 0) return {bar, index: i};
    }
    return null;
  }

  // --- Iteration 16 (GEAR): snapshots for lane RUN (carryover, Retry level) ---------------------------------------------

  toJSON(): InventoryJSON {
    const gear = {} as Record<GearSlot, StackJSON | null>;
    GEAR_SLOTS.forEach((slot, i) => { gear[slot] = stackToJSON(this.gearSlots[i]); });
    return {v: INVENTORY_JSON_VERSION, hotbar: this.hotbar.map(stackToJSON), pack: this.pack.map(stackToJSON), packBase: PACK_SIZE, gear, throw: this.throwSlot.map(stackToJSON), // (+ packBase: lane STORAGE)
      melee: this.meleeSlot.map(stackToJSON), selected: this.selected, meleeSelected: this.meleeSelected, nextUid: this.nextUid}; // + melee slot (v3, SLOT)
  }

  /** A new inventory from a snapshot (deep; same uids; nextUid above every uid). */
  static fromJSON(j: InventoryJSON): Inventory {
    const inv = new Inventory();
    inv.loadJSON(j);
    return inv;
  }

  /**
   * Restore a snapshot IN PLACE (keeps this object, which the UI / container closures hold).
   * Task office-overhaul-20261030 (INTERACT): v1 snapshots (no `throw`) load with an empty grenade slot (flares stay put).
   * Task knife-windup-20261030 (SLOT): v1 / v2 snapshots (no `melee`) migrate their carried knife into the melee slot
   * (migrateLegacyMelee); a non-melee item found in a v3 melee slot (malformed) goes back in through add(), never lost.
   * Task gameplay-feedback-20261111 (STORAGE): pockets written with another base size (an older snapshot: 12) keep their base pockets in
   * place and their chest-rig pockets move to the rig's indices now (remapPockets); the new base pockets load empty.
   */
  loadJSON(j: InventoryJSON): void {
    const v = j.v ?? 1;
    const hot = (j.hotbar ?? []).map(stackFromJSON);
    const gear = GEAR_SLOTS.map(slot => stackFromJSON(j.gear?.[slot] ?? null));
    const remapped = remapPockets((j.pack ?? []).map(stackFromJSON), packBaseOf(j, this.pocketsOf(gear[CHEST]))); // (chest gear that will be worn: pocketsOf checks its slot)
    const pack = remapped.pack;
    const thr = (v >= 2 && Array.isArray(j.throw) ? j.throw : []).map(stackFromJSON);
    // (read whatever the version: a melee slot found already occupied in an older snapshot is kept, and nothing migrates into it)
    const mel = (Array.isArray(j.melee) ? j.melee : []).map(stackFromJSON);
    this.throwSlot.fill(null);
    for (let i = 0; i < THROW_SLOTS; i++) { const s = thr[i]; if (s && itemDef(s.itemId).kind === 'throwable') this.throwSlot[i] = s; }
    this.meleeSlot.fill(null);
    for (let i = 0; i < MELEE_SLOTS; i++) { const s = mel[i]; if (s && isMeleeItem(s.itemId)) this.meleeSlot[i] = s; }
    this.hotbar.fill(null);
    for (let i = 0; i < HOTBAR_SIZE; i++) this.hotbar[i] = hot[i] ?? null;
    this.gearSlots.fill(null);
    gear.forEach((s, i) => { if (s && gearSpec(s.itemId)?.slot === GEAR_SLOTS[i]) this.gearSlots[i] = s; });
    const cap = this.capacity;
    this.pack.length = 0;
    for (let i = 0; i < cap; i++) this.pack.push(pack[i] ?? null);
    let maxUid = 0;
    const all = [...this.hotbar, ...this.pack, ...this.gearSlots, ...this.throwSlot, ...this.meleeSlot].flatMap(stacksIn);
    for (const s of all) maxUid = Math.max(maxUid, s.uid);
    const stray = [...hot.slice(HOTBAR_SIZE), ...pack.slice(cap), ...remapped.loose, ...gear.filter((s, i) => s && this.gearSlots[i] !== s), ...thr.filter((s, i) => s && this.throwSlot[i] !== s),
      ...mel.filter((s, i) => s && this.meleeSlot[i] !== s)].filter((s): s is ItemStack => !!s);
    for (const s of stray) for (const x of stacksIn(s)) maxUid = Math.max(maxUid, x.uid);
    this.nextUid = Math.max(j.nextUid ?? 1, maxUid + 1);
    this.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, Math.floor(j.selected ?? 0)));
    this.meleeHeld = v >= 3 && j.meleeSelected === true && !!this.meleeSlot[0];
    if (v < 3) this.migrateLegacyMelee(); // before the strays: only items that were really carried in quick slots / pockets move
    // a malformed snapshot never loses items silently: strays go back in through add()
    for (const s of stray) if (this.add(s) > 0) console.warn(`Inventory.loadJSON: no room for ${s.itemId} ×${s.count}`);
    this.refusal = null;
    this.version = ++versionEpoch * 1_000_000;
  }

  /**
   * Task knife-windup-20261030 (SLOT): a v1 / v2 snapshot (knife-melee-20261030 kit: the knife in quick slot 3) moves ONE carried
   * melee weapon into the empty melee slot — the first in quick slots 1-5, else the first in the pockets — as the same stack
   * (uid kept, nothing duplicated, nothing refilled). Further knives stay where they are (ordinary items). The worn backpack's
   * contents and grounded bags (separate stores) are never searched. Selection: a gun (any other quick slot) in the hands stays
   * in the hands; if the hands held THAT knife, the melee slot becomes the selection (still the knife in the hands) and the
   * remembered quick slot is the first quick slot holding a gun (else the one the knife left).
   */
  private migrateLegacyMelee(): void {
    if (this.meleeSlot[0]) return;
    const hi = this.hotbar.findIndex(s => !!s && isMeleeItem(s.itemId));
    const from: SlotRef | null = hi >= 0 ? {bar: 'hotbar', index: hi} : (() => {
      const pi = this.pack.findIndex(s => !!s && isMeleeItem(s.itemId));
      return pi >= 0 ? {bar: 'pack', index: pi} : null;
    })();
    if (!from) return;
    const held = from.bar === 'hotbar' && from.index === this.selected;
    const list = this.list(from.bar);
    this.meleeSlot[0] = list[from.index];
    list[from.index] = null;
    if (held) {
      this.meleeHeld = true;
      const gun = this.hotbar.findIndex(s => !!s && itemDef(s.itemId).kind === 'weapon' && !isMeleeItem(s.itemId));
      if (gun >= 0) this.selected = gun;
    }
  }

  /** Deep copy (same uids and uid counter). */
  clone(): Inventory {
    return Inventory.fromJSON(this.toJSON());
  }

  /** Every stack held (quick slots, pockets, worn gear, grenade + melee slots; `withBag`: the worn backpack's contents too — audits / tests only). */
  allStacks(withBag = false): ItemStack[] {
    const top = [...this.hotbar, ...this.pack, ...this.gearSlots, ...this.throwSlot, ...this.meleeSlot].filter((s): s is ItemStack => !!s);
    return withBag ? top.flatMap(stacksIn) : top;
  }

  /** Debug/test invariant check. */
  invariants(): string[] {
    const out: string[] = [];
    const uids = new Set<number>();
    const check = (s: ItemStack, where: string) => {
      const def = itemDef(s.itemId);
      if (uids.has(s.uid)) out.push(`duplicate uid ${s.uid}`);
      uids.add(s.uid);
      if (s.uid >= this.nextUid) out.push(`uid ${s.uid} not below nextUid ${this.nextUid}`);
      if (s.count < 1 || s.count > def.stackMax) out.push(`bad count ${s.itemId}:${s.count}`);
      if (def.kind === 'weapon') {
        const w = WEAPONS[def.weaponId!];
        if (s.mag === undefined || s.mag < 0 || s.mag > w.magazine) out.push(`bad mag ${s.itemId}:${s.mag}`);
      }
      // task studio-turnstile-reload-visuals-20261112-063646-01: spent hulls only in a hull-keeping gun, whole, never more than its free chambers
      if (s.spent !== undefined) {
        const w = def.kind === 'weapon' ? WEAPONS[def.weaponId!] : undefined;
        if (!w || w.reload.kind !== 'break' || !w.reload.spentHulls) out.push(`${s.itemId} keeps no hulls`);
        else if (!Number.isInteger(s.spent) || s.spent < 0 || s.spent + (s.mag ?? 0) > w.magazine) out.push(`bad spent ${s.itemId}:${s.spent}`);
      }
      const slots = def.gear?.bagSlots ?? 0;
      if (slots > 0) {
        if (where !== 'gear:backpack') out.push(`backpack in ${where}`);
        if (!s.bag || s.bag.length !== slots) out.push(`backpack ${s.uid} contents size ${s.bag?.length ?? 'missing'} != ${slots}`);
        for (const c of s.bag ?? []) {
          if (!c) continue;
          if (isBagItem(c.itemId)) out.push(`backpack inside backpack ${s.uid}`);
          if (c.bag) out.push(`nested contents in ${c.itemId}`);
          check(c, 'bag');
        }
      } else if (s.bag) out.push(`non-bag ${s.itemId} carries contents`);
      // mask lane: a filter charge only on gas masks, finite, 0..one filter's life
      if (s.filter !== undefined) {
        const life = gearSpec(s.itemId)?.filterLife ?? 0;
        if (!isFilterMask(s.itemId)) out.push(`non-mask ${s.itemId} carries a filter charge`);
        else if (!Number.isFinite(s.filter) || s.filter < 0 || s.filter > life + 1e-6) out.push(`bad filter ${s.itemId}:${s.filter}`);
      }
      // task filter-tension-airtank: air only on airtanks, finite, 0..a full tank
      if (s.air !== undefined) {
        const life = gearSpec(s.itemId)?.airLife ?? 0;
        if (!isAirtank(s.itemId)) out.push(`non-airtank ${s.itemId} carries air`);
        else if (!Number.isFinite(s.air) || s.air < 0 || s.air > life + 1e-6) out.push(`bad air ${s.itemId}:${s.air}`);
      }
      // task studio-general-armor-20261107-231448-01: armour left only on armour-bearing gear, finite, 0..its full armour
      if (s.armor !== undefined) {
        const full = gearSpec(s.itemId)?.armor ?? 0;
        if (!(full > 0)) out.push(`non-armour ${s.itemId} carries armour wear`);
        else if (!Number.isFinite(s.armor) || s.armor < 0 || s.armor > full + 1e-6) out.push(`bad armour ${s.itemId}:${s.armor}`);
      }
    };
    this.hotbar.forEach(s => s && check(s, 'hotbar'));
    this.pack.forEach(s => s && check(s, 'pack'));
    this.gearSlots.forEach((s, i) => {
      if (!s) return;
      const slot = GEAR_SLOTS[i];
      if (gearSpec(s.itemId)?.slot !== slot) out.push(`${s.itemId} in gear slot ${slot}`);
      check(s, `gear:${slot}`);
    });
    // Task office-overhaul-20261030 (INTERACT): the grenade slot holds throwables only
    this.throwSlot.forEach(s => {
      if (!s) return;
      if (itemDef(s.itemId).kind !== 'throwable') out.push(`${s.itemId} in the grenade slot`);
      check(s, 'throw');
    });
    if (this.throwSlot.length !== THROW_SLOTS) out.push('grenade slot resized');
    // Task knife-windup-20261030 (SLOT): the melee slot holds melee weapons only
    this.meleeSlot.forEach(s => {
      if (!s) return;
      if (!isMeleeItem(s.itemId)) out.push(`${s.itemId} in the melee slot`);
      check(s, 'melee');
    });
    if (this.meleeSlot.length !== MELEE_SLOTS) out.push('melee slot resized');
    if (this.hotbar.length !== HOTBAR_SIZE) out.push('slot arrays resized');
    if (this.pack.length !== this.capacity) out.push(`pockets ${this.pack.length} != capacity ${this.capacity}`);
    if (this.gearSlots.length !== GEAR_SLOTS.length) out.push('gear slots resized');
    if (this.selected < 0 || this.selected >= HOTBAR_SIZE) out.push('bad selection');
    return out;
  }
}
