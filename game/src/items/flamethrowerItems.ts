// Task studio-flamethrower-fire-20261114-031614-01: the FLAMETHROWER's ItemDef (its WeaponDef: weapons/flamethrower.ts; its fuel: the
// wearable Fuel Tank, items/gear.ts `fuel_tank`). items.ts spreads it into ITEMS after every existing item (catalogue order unchanged).
// An ordinary weapon item in every common path (kind 'weapon', one per slot): inventory, bags, the Lockbox, cargo, trades and saves
// classify it by kind + WeaponDef. It comes ONLY from the train's crafting bench (craft/recipes.ts) or a Market gun stall
// (market/trade/stock.ts): never loot, never in a weapon find pool. A leaf module: import only TYPES from items.ts.
import type {ItemDef, ItemDims} from './items';
import type {DamageClass, ItemPhysics} from '../damage/materials';
import {FLAME, FLAME_FUEL, FLAMETHROWER_ID} from '../fire/flamethrowerSpec';

/** HUD icon key (ui/icons.ts SVG fallback; the 3D icon is the model). */
export type FlamethrowerIconKey = 'flamethrower';

export const FLAMETHROWER_ITEMS: Record<string, ItemDef> = {
  [FLAMETHROWER_ID]: {id: FLAMETHROWER_ID, name: 'Flamethrower — "Weed burner"', short: 'Flamethrower', kind: 'weapon', stackMax: 1, weaponId: FLAMETHROWER_ID, icon: 'flamethrower',
    description: `A scrap-built burner lance: a valve body, a perforated heat shield and a wide burner bell. Hold the trigger for a stream of fire out to ${FLAME.range} m that sets the infected, loose props and the ground alight — the flames cling and keep burning, and they burn you too. It only fires with a Flamethrower fuel tank on your back, and drinks it: one fuel can lasts ${FLAME_FUEL.unitsPerCan * FLAME_FUEL.unitSeconds} seconds. Press R to pour a fuel can into the tank. It never harms the train itself or its fitted fixtures.`},
};

/** Impact class and rigid body as a loose item (damage/materials.ts): a heavy steel lance. */
export const FLAMETHROWER_CLASS: DamageClass = 'steel';
export const FLAMETHROWER_PHYSICS: ItemPhysics = {mass: 5.5, shape: 'box', mat: 'heavy'};

/** Resting size (m) lying on its side = the cooked model's bounds (assets/flamethrowerModels.generated.ts; world/pickups.ts lays weapons down). */
export const FLAMETHROWER_DIMS: Record<string, ItemDims> = {
  [FLAMETHROWER_ID]: {w: 0.95, d: 0.2229, h: 0.1251, shape: 'flat'},
};
