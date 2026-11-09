// Task studio-food-drink-half-20261109-201124-01: HALF the natural food / drink spawn on every level. User (2026-11-09): "food spawn
// rate is to high … lets cut food / drink spawn in half. 50% reduction."
//
// One shared, stable, independent RETENTION gate on newly realized natural loot. It is not a re-weighting: halving the food rows' weights
// and renormalizing would not halve what the player finds, and would hand the freed draws to ammo / medicine / fuel instead. Instead every
// natural food or drink find (a holder lot, or a generated floor pickup on its first spawn) is kept with probability NATURAL_FOOD_KEEP,
// decided by a hash of its own stable origin: no RNG stream is read, so every other lot / pickup / roll is exactly as before. A kept find
// keeps its id, item (its food-variety variant), count, spot and compartment; a dropped one simply never appears (its spot reads as taken).
//  - What counts: the common economy classification (lootTables econCat 'food' / 'drink'): every old food / drink, the Skyways ramen food,
//    bakery bread and the 24 pantry items alike. Curated rewards (lootTables REWARD_TABLES holders, `reward` pickups) are exempt.
//  - Exactly once (run/worldMemory.ts dropNaturalFood, game.ts buildSection): only holders WITHOUT a section-memory record and floor
//    pickups of a section WITHOUT pickup memory (a first spawn). A remembered holder / pickup list (any save, old or new) is restored
//    exactly as recorded; the gate is idempotent anyway (a kept find stays kept).
//  - Untouched: nutrition, stacks and the survival drain; market / vendor stock and the beers; the starter kit; what the player carries,
//    drops, stores or ships; the shelf filler and its density (dressed around the rolled lots before the gate, like taken lots).

import {hashString} from '../core/rng';
import {econCat} from './lootTables';
import {decodeLotId} from './pantryVariety';

/** The share of natural food / drink finds that stays (the user's 50 % reduction). */
export const NATURAL_FOOD_KEEP = 0.5;

/** A natural food or drink find: the economy's own food / drink classification (old items, ramen food, bread, the pantry items). */
export function isNaturalFood(itemId: string): boolean {
  const c = econCat(itemId);
  return c === 'food' || c === 'drink';
}

/** Uniform [0, 1) of a stable identity (FNV-1a + a murmur3 finalizer; its own key prefix, so independent of the food-variety pick). */
function unit(identity: string, seed: number): number {
  let h = hashString(`food-half|${identity}`, seed >>> 0);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Does the natural find at `origin` stay? `seed` = the section layout's seed (so each run decides afresh), `origin` = a stable identity
 * within the section (holderFoodOrigin / pickupFoodOrigin). Pure and deterministic: the same find always gets the same answer.
 */
export function keepNaturalFood(seed: number, origin: string): boolean {
  return unit(origin, seed) < NATURAL_FOOD_KEEP;
}

/**
 * A holder lot's origin: the section, the holder's memory key (kind + storey + position: run/memory.ts holderKey) and the lot's ROLLED id
 * (a food-variety variant id decodes to it), so the decision never depends on which variant the lot became.
 */
export function holderFoodOrigin(section: string, holder: string, lotId: number): string {
  return `${section}|${holder}|lot:${decodeLotId(lotId).rolled}`;
}

/** A generated floor pickup's origin: the section and its layout index. */
export function pickupFoodOrigin(section: string, layoutIndex: number): string {
  return `${section}|pickup:${layoutIndex}`;
}

/** Does a generated layout pickup spawn on its first spawn? Non-food and curated (`reward`) pickups always do. */
export function keepLayoutPickup(seed: number, section: string, layoutIndex: number, p: {itemId: string; reward?: string}): boolean {
  return !isNaturalFood(p.itemId) || !!p.reward || keepNaturalFood(seed, pickupFoodOrigin(section, layoutIndex));
}
