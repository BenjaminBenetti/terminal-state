// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE VALUE MODEL — one shared helper that prices every item from the
// AUTHORITATIVE item data (no per-trader catalogue): a new item / weapon / gear piece is priced by the same rules the day it is added.
//
// Inputs (all read live from their own modules):
//  - items/items.ts ItemDef: kind, stackMax, the consumable effects (heal / hunger / thirst / recharge / treats);
//  - weapons/weapons.ts WeaponDef: damage x pellets / interval (sustained damage), the magazine and caliber of the loaded rounds;
//  - items/gear.ts GearSpec: armor, pockets, bag slots, speed / spread / handling, the mask's filter, the airtank's air;
//  - items/lootTables.ts rarity weights: an item's weight in its loot pool (GLOBAL_POOL by econCat, the limb-treatment pool, the rare
//    gear weights) against the pool's mean — a rarer find is worth a little more (sqrt, clamped);
//  - the resources other systems define: one gas filter = FILTER_LIFE_S of protection, one fuel can = FUEL.canUnits of the train's fuel.
// Items without stats of their own (ammo, flares, crafting materials, a future supply) are valued by STACK SIZE: VALUE.stackTies per
// full stack of their kind, so a rarer / bulkier unit (it stacks less) is worth more each.
//
// CONDITION travels with the stack and is priced, never repaired: a gun's loaded rounds (`mag`, each at the loose round's value), a gas
// mask's fitted filter charge (`filter`, its share of a spare filter), an airtank's air (`air`, per second), and armor wear (`armor`, the
// fraction LEFT in absolute GearSpec.armor units, read through the common player/armor.ts itemArmor: absent = undamaged, 0 = depleted;
// the worn share of the armor's value comes off). Nothing here — or in any trade — writes, resets or repairs any of these fields.
// A backpack is valued EMPTY (the trade rules refuse a bag with contents: market/trade/stalls.ts).
//
// Values are integer hundredths of a tie ("cents"), so every price is exact integer arithmetic (market/trade/stalls.ts rounds buys up,
// sells down). The reactor restart parts (kind 'part') have no trade value at all; nor have Rail Ties themselves (kind 'currency').
//
// Task studio-market-rework-20261108-074144-01 (lane TRADE), GEAR PRICES. User: "gear prices are two low, with this price level a chest
// armor is only a little more than 4 cans of beans. Lets go bump chest armor up to 72 rail ties, and move other gear items up to match,
// They should be similar to the guns, which have a good price." VALUE.gear is retuned so a fresh armor vest retails at exactly 72 ties and
// every other piece rises by its own stats into the guns' range (knife 42 .. rifle 113): hard hat 37, work boots 55, work gloves 57, chest
// rig 61, gas mask 70 (+ its fitted filter), armor vest 72, backpack 78, airtank 28 empty .. 100 full (its air still priced per second).
// Guns, food, medicine, ammo and supplies are unchanged; condition (wear / filter / air / rounds) still prices in through this one path.
import {ITEMS, type ItemDef} from '../../items/items';
import {WEAPONS, type WeaponDef} from '../../weapons/weapons';
import {CALIBERS, type Caliber} from '../../items/calibers';
import {FILTER_LIFE_S, gearSpec, isAirtank, isFilterMask, type GearSpec} from '../../items/gear';
import {GEAR_WEIGHTS, GLOBAL_POOL, LIMB_ECONOMY, econCat, type ItemRows} from '../../items/lootTables';
import {FUEL} from '../../fuel/fuel';
import type {ItemKind} from '../../items/items';
import type {ItemStack} from '../../items/inventory';
import {itemArmor} from '../../player/armor';

/** Hundredths of a tie per tie. */
export const CENTS = 100;
/**
 * The spare gas-mask filter item (gen/maskLoot.ts GAS_FILTER_ID = gear/gasMask.ts GAS_MASK.filterItem; a test pins the three): named here
 * so this pure module does not pull in the generators / the mask view.
 */
export const GAS_FILTER_ID = 'gas_filter';

/** The value model's tuning (ties). */
export const VALUE = {
  /** Ties per FULL stack of an item valued by its stack size (no stats of its own): ammo, flares, crafting materials … */
  stackTies: {ammo: 90, throwable: 60, material: 60, supply: 40, consumable: 30, gear: 20, weapon: 40} as Readonly<Record<Exclude<ItemKind, 'part' | 'currency'>, number>>,
  /** A consumable's worth per point of what it restores (survival 0-100 scale; drains cost a little), per battery refill, per limb treated. */
  consumable: {heal: 0.35, food: 0.3, water: 0.3, drain: 0.15, recharge: 10, limb: 12},
  /** A weapon: base + sustained damage (damage x pellets / interval) x perDps; its loaded rounds are priced on top. */
  weapon: {base: 30, perDps: 0.25},
  /**
   * Gear: base + its stats (armor fraction, pocket, bag slot, +speed, -spread, -handling time, a mask's face piece); air per second.
   * (task studio-market-rework-20261108-074144-01, lane TRADE: was base 12, armor 120, pocket 4, bagSlot 2.5, speed 300, spread / handling
   * 150, mask 20 — the armor vest retails at 72 now; air per second unchanged: it is a resource, like a spare filter)
   */
  gear: {base: 24, armor: 465, pocket: 9, bagSlot: 5.5, speed: 600, spread: 200, handling: 200, mask: 46, airPerSecond: 0.12},
  /** One second of gas-mask filter (a spare filter = FILTER_LIFE_S of it). */
  filterPerSecond: 0.24,
  /** One unit (a quarter tank) of the train's fuel. */
  fuelPerUnit: 10,
  /** Rarity: sqrt(pool mean weight / the item's weight), clamped. */
  rarity: {min: 0.8, max: 1.6},
  /** No single unit of an item valued by its stats is worth less than this (ties): its sale is always worth at least a tie somewhere. */
  minUnit: 3,
} as const;

const pos = (v: number | undefined) => Math.max(0, v ?? 0);
const neg = (v: number | undefined) => Math.max(0, -(v ?? 0));
const toCents = (ties: number) => Math.max(1, Math.round(ties * CENTS));

/**
 * Whether an item can be traded at all: a known item that is not a progression part (the reactor restart key / fuse cartridges) and not
 * the currency itself (Rail Ties pay for goods; they are never bought or sold for ties).
 */
export function isTradeable(itemId: string): boolean {
  const d = ITEMS[itemId];
  return !!d && d.kind !== 'part' && d.kind !== 'currency';
}

/** The rarity factor of an item from its loot pool's weights (1 when it is in no pool: shop-only / level-specific finds). */
export function rarityFactor(itemId: string): number {
  const cat = econCat(itemId);
  const pools: ItemRows[] = [...(cat ? [GLOBAL_POOL[cat]] : []), LIMB_ECONOMY.pool, Object.entries(GEAR_WEIGHTS)];
  for (const rows of pools) {
    const row = rows.find(r => r[0] === itemId);
    if (!row || !(row[1] > 0)) continue;
    const mean = rows.reduce((s, r) => s + r[1], 0) / rows.length;
    return Math.min(VALUE.rarity.max, Math.max(VALUE.rarity.min, Math.sqrt(mean / row[1])));
  }
  return 1;
}

/** Sustained damage of a weapon (damage x pellets per second of its cycle). */
const dps = (w: WeaponDef) => (w.damage * w.pellets) / Math.max(0.05, w.interval);

/** What a consumable restores, in ties (0 when it has no effect stats). */
function consumableTies(d: ItemDef): number {
  const k = VALUE.consumable;
  return (d.heal ?? 0) * k.heal + pos(d.hunger) * k.food + pos(d.thirst) * k.water - (neg(d.hunger) + neg(d.thirst)) * k.drain
    + (d.recharge ?? 0) * k.recharge + (d.treats?.length ?? 0) * k.limb;
}

/** A gear piece's intrinsic stats in ties (base + armor at full + pockets / bag / mobility; a mask's face piece; NOT its filter / air). */
function gearTies(g: GearSpec): number {
  const k = VALUE.gear;
  return k.base + (g.armor ?? 0) * k.armor + (g.pockets ?? 0) * k.pocket + (g.bagSlots ?? 0) * k.bagSlot + pos((g.speedMult ?? 1) - 1) * k.speed
    + pos(1 - (g.spreadMult ?? 1)) * k.spread + pos(1 - (g.handlingMult ?? 1)) * k.handling + (g.filterLife ? k.mask : 0);
}

const stackRule = (d: ItemDef) => VALUE.stackTies[d.kind as Exclude<ItemKind, 'part' | 'currency'>] / Math.max(1, d.stackMax);

/**
 * The intrinsic value of ONE unit, in cents: a weapon with an EMPTY magazine, a gas mask with NO filter charge, an EMPTY airtank, armor
 * undamaged, a backpack empty. 0 for anything that cannot be traded (unknown items, the reactor restart parts, Rail Ties).
 */
export function baseCents(itemId: string): number {
  const d = ITEMS[itemId];
  if (!d || !isTradeable(itemId)) return 0;
  let ties: number;
  if (d.kind === 'weapon' && d.weaponId && WEAPONS[d.weaponId]) ties = VALUE.weapon.base + dps(WEAPONS[d.weaponId]) * VALUE.weapon.perDps;
  else if (d.kind === 'gear' && d.gear) ties = gearTies(d.gear);
  else if (d.id === GAS_FILTER_ID) ties = FILTER_LIFE_S * VALUE.filterPerSecond;
  else if (d.id === FUEL.canItem) ties = FUEL.canUnits * VALUE.fuelPerUnit;
  else if (d.kind === 'consumable' && consumableTies(d) > 0) ties = consumableTies(d);
  else return toCents(stackRule(d)); // ammo, flares, materials, anything without stats: by stack size (may be under a tie a unit)
  return toCents(Math.max(VALUE.minUnit, ties * rarityFactor(d.id)));
}

/** One loaded round of a caliber, in cents (the caliber's loose ammo item). */
export function roundCents(c: Caliber): number {
  return baseCents(CALIBERS[c].itemId);
}

/** The armor a stack has left (itemArmor: its `armor` wear clamped to 0..full; absent = full) and its full value; null = no armor. */
export function armorState(stack: Pick<ItemStack, 'itemId' | 'armor'>): {left: number; full: number} | null {
  const full = gearSpec(stack.itemId)?.armor ?? 0;
  if (!(full > 0)) return null;
  const left = itemArmor(stack);
  return {left: Number.isFinite(left) ? left : full, full};
}

/**
 * The value of ONE unit of this very stack, in cents, with its condition: + the loaded rounds (each at the loose round's value), + the
 * fitted filter charge (its share of a spare filter), + the air left; armor wear takes its share of the armor value off. 0 = untradeable.
 */
export function stackUnitCents(stack: Pick<ItemStack, 'itemId' | 'mag' | 'filter' | 'air' | 'armor'>): number {
  const d = ITEMS[stack.itemId];
  const base = baseCents(stack.itemId);
  if (!d || !base) return 0;
  let cents = base;
  if (d.kind === 'weapon' && d.weaponId) {
    const w = WEAPONS[d.weaponId];
    if (w?.caliber) cents += Math.max(0, Math.min(w.magazine, Math.floor(stack.mag ?? 0))) * roundCents(w.caliber);
  }
  if (isFilterMask(stack.itemId)) {
    const life = gearSpec(stack.itemId)!.filterLife!;
    cents += Math.floor(baseCents(GAS_FILTER_ID) * Math.max(0, Math.min(1, (stack.filter ?? 0) / life)));
  }
  if (isAirtank(stack.itemId)) {
    const life = gearSpec(stack.itemId)!.airLife!;
    cents += Math.floor(Math.max(0, Math.min(life, stack.air ?? 0)) * VALUE.gear.airPerSecond * CENTS);
  }
  const arm = armorState(stack);
  if (arm && arm.left < arm.full) {
    const share = arm.full * VALUE.gear.armor * rarityFactor(stack.itemId) * CENTS; // the armor's part of the base value
    cents = Math.max(1, cents - Math.ceil(share * (1 - arm.left / arm.full)));
  }
  return cents;
}

/** The value of `count` units of the stack (default: all of it), in cents. */
export function stackCents(stack: Pick<ItemStack, 'itemId' | 'count' | 'mag' | 'filter' | 'air' | 'armor'>, count = stack.count): number {
  return Math.max(0, Math.floor(count)) * stackUnitCents(stack);
}

const pct = (x: number) => Math.ceil(Math.max(0, Math.min(1, x)) * 100 - 1e-9);

/** The condition a trade row names: "7 of 15 rounds loaded", "filter 54 % fitted", "air 52 % · 312 s", "armor 3 of 4 left"; '' = none. */
export function conditionText(stack: Pick<ItemStack, 'itemId' | 'mag' | 'filter' | 'air' | 'armor' | 'bag'>): string {
  const d = ITEMS[stack.itemId];
  if (!d) return '';
  const out: string[] = [];
  const w = d.kind === 'weapon' && d.weaponId ? WEAPONS[d.weaponId] : null;
  if (w && w.caliber) out.push(`${stack.mag ?? 0} of ${w.magazine} ${CALIBERS[w.caliber].unit[1]} loaded`);
  if (isFilterMask(d.id)) out.push((stack.filter ?? 0) > 0 ? `filter ${pct((stack.filter ?? 0) / gearSpec(d.id)!.filterLife!)} % fitted` : 'no filter charge');
  if (isAirtank(d.id)) out.push((stack.air ?? 0) > 0 ? `air ${pct((stack.air ?? 0) / gearSpec(d.id)!.airLife!)} % · ${Math.ceil(stack.air ?? 0)} s left` : 'air empty');
  const arm = armorState(stack);
  if (arm && arm.left < arm.full) out.push(`armor worn: ${pct(arm.left / arm.full)} % left`);
  if (stack.bag) { const n = stack.bag.filter(Boolean).length; out.push(n ? `${n} item${n === 1 ? '' : 's'} inside` : 'empty'); }
  return out.join(' · ');
}
