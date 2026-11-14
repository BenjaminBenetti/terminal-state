// Task studio-ui-subway-maps-20261108-074144-01: the tooltip content of an item stack (ui/tooltip.ts), shared by every item grid — the
// inventory, a grounded backpack, the train's Lockbox and the car trunk — and available to any other item view (the market's trade
// panel). Heading = the item's name (×count for a stack); lines = what this particular stack is: rounds loaded and caliber, what a
// consumable does, a mask's filter, an airtank's air, armour left (pips, worn), a bag's contents, what ammo loads; the hint = how this
// view uses it (each view passes its own). Text only.
// Task studio-flamethrower-fire-20261114-031614-01: a STREAM weapon (the flamethrower) has no magazine — its line says what it burns (the
// worn fuel tank's fuel) and the item grids show no round count on it (noMagazine); the fuel tank's own line is its fuel (gearStatText).

import {effectText, itemDef} from '../items/items';
import type {Inventory, ItemStack} from '../items/inventory';
import {AIRTANK_AIR_S, FILTER_LIFE_S, fuelCansText, gearStatText, isAirtank, isFilterMask} from '../items/gear';
import {WEAPONS, caliberLabel, reserveFor, weaponsForCaliber, type WeaponDef} from '../weapons/weapons';
import {FLAME_FUEL, FUEL_TANK_ID} from '../fire/flamethrowerSpec';
import {tankFuel, wornFuelTank} from '../fire/fuelTank';
import {CALIBERS} from '../items/calibers';
import {materialNote} from '../items/craftMaterials';
import type {TipContent, TipTone} from './tooltip';
import {CURRENCY_NOTE} from '../items/railTies'; // task studio-market-rework-20261108-074144-01: the market's physical Rail Ties
import {BEER_RULE_NOTE, isTimedBeer} from '../items/beers'; // task studio-market-bar-20261108-225231-01 (lane BEER)

/** Mask lane: a gas mask's fitted filter in whole percent (rounded up: 0 only when empty). */
export const filterPct = (filter: number | undefined) => Math.ceil(Math.max(0, Math.min(1, (filter ?? 0) / FILTER_LIFE_S)) * 100 - 1e-9);
/** Task filter-tension-airtank-20261104-072836: an Airtank Backpack's air left ("Air 85 % · 510 s left" / "Air empty — cannot be refilled"). */
export const airText = (air: number | undefined) => ((air ?? 0) > 0 ? `Air ${Math.ceil(Math.max(0, Math.min(1, (air ?? 0) / AIRTANK_AIR_S)) * 100 - 1e-9)} % · ${Math.ceil(air ?? 0)} s left` : 'Air empty — it cannot be refilled');

/**
 * Task studio-flamethrower-fire-20261114-031614-01: a weapon with no magazine to count — melee, or a STREAM weapon (the flamethrower burns
 * the worn fuel tank's fuel): an item slot shows no "loaded / magazine" numbers on it.
 */
export const noMagazine = (w: Pick<WeaponDef, 'melee' | 'stream'> | null | undefined): boolean => !!w && (!!w.melee || !!w.stream);

/** Task studio-flamethrower-fire-20261114-031614-01: a fuel tank's fuel ("Fuel 1 of 3 cans · 20 s of flame" / "Fuel empty — …"). Absent = empty. */
export function fuelText(tank: Pick<ItemStack, 'itemId' | 'fuel'>): string {
  const units = tankFuel(tank);
  return units > 0 ? `Fuel ${fuelCansText(units)} of ${FLAME_FUEL.capacityCans} cans · ${Math.round(units * FLAME_FUEL.unitSeconds)} s of flame` : 'Fuel empty — refill it from fuel cans';
}

/**
 * Task studio-flamethrower-fire-20261114-031614-01: a stream weapon's line — what it burns, and (with `inv`) what is on the back now:
 * "… · tank worn: 1 of 3 cans" / "… · no fuel tank worn: it will not fire".
 */
export function streamText(inv?: Pick<Inventory, 'gearSlots'>): string {
  const base = `Burns the fuel of a worn ${itemDef(FUEL_TANK_ID).name} · no magazine`;
  if (!inv) return base;
  const tank = wornFuelTank(inv);
  return tank ? `${base} · tank worn: ${fuelCansText(tankFuel(tank))} of ${FLAME_FUEL.capacityCans} cans` : `${base} · no fuel tank worn: it will not fire`;
}

/** What this stack is, line by line (no hint). `inv` adds carried counts (ammo in reserve). */
export function itemTipLines(st: ItemStack, o: {inv?: Inventory} = {}): string[] {
  const def = itemDef(st.itemId);
  const out: string[] = [];
  const w = def.kind === 'weapon' && def.weaponId ? WEAPONS[def.weaponId] : undefined;
  if (w?.melee) out.push(`Melee · reach ${w.range} m · never needs ammo`);
  else if (w?.stream) out.push(streamText(o.inv)); // task flamethrower-fire: no "0 / 0 loaded"
  else if (w) out.push(`${st.mag ?? 0} / ${w.magazine} loaded${w.caliber ? ` · takes ${caliberLabel(w)}${o.inv ? ` · ${reserveFor(w, o.inv)} in reserve` : ''}` : ''}`);
  if (def.kind === 'ammo' && def.caliber) {
    const loads = weaponsForCaliber(def.caliber).map(x => itemDef(x.itemId).short).join(', ');
    out.push(`${CALIBERS[def.caliber].designation} · loads: ${loads || 'no weapon yet'}`);
  }
  if (def.kind === 'consumable') out.push(effectText(def));
  if (isTimedBeer(def.id)) out.push(BEER_RULE_NOTE); // task studio-market-bar-20261108-225231-01 (lane BEER): one timed beer at a time
  if (def.kind === 'gear' && def.gear) {
    if (isFilterMask(def.id)) out.push(`Filter ${filterPct(st.filter)} % fitted`);
    if (isAirtank(def.id)) out.push(airText(st.air));
    const stats = gearStatText(def.gear, st);
    if (stats) out.push(stats);
    if (st.bag) out.push(`${st.bag.filter(Boolean).length} of ${st.bag.length} slots used inside`);
  }
  if (def.kind === 'supply') out.push('A worn gas mask fits one by itself when its filter runs out');
  if (def.kind === 'material') out.push(materialNote(def.id)); // (task train-crafting, lane BENCH: per material — the bench's two, or no recipe yet)
  if (def.kind === 'part') out.push('Reactor restart part — take it to its control and press E there');
  if (def.kind === 'currency') out.push(CURRENCY_NOTE);
  return out.filter(Boolean);
}

/** The tooltip of an item stack: its name (×count), its lines, the view's hint. */
export function itemTip(st: ItemStack, hint?: string, o: {inv?: Inventory; tone?: TipTone; lines?: readonly string[]} = {}): TipContent {
  const def = itemDef(st.itemId);
  return {head: `${def.name}${st.count > 1 ? ` ×${st.count}` : ''}`, lines: [...itemTipLines(st, o), ...(o.lines ?? [])], hint, tone: o.tone};
}
