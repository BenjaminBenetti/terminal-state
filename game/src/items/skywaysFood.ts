// Task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways ramen restaurant's EDIBLE food — two bowls of ramen, a sushi bento
// and a bubble tea. User intent: the supplied ramen / sushi / bubble-tea objects are edible pickups in an ordinary ramen restaurant.
//
// They are ordinary consumables (items/items.ts kind 'consumable', verb eat / drink): the existing survival bars (player/survival.ts —
// no new meter), the existing timed use + first-person eat / drink view (weapons/consumeView.ts styles), the existing eat / drink cues
// (audio/sfx.ts), the existing auto-return / cancel / last-use release rules of game.ts (unchanged: nothing here is special-cased).
// Finite: the restaurant dresser (gen/skyways/ramen.ts) places a few seeded pickups on its tables and themed holder lots
// (items/lootTables.ts RAMEN_* named tables via the 'skyways-ramen' purpose) — remembered like every pickup / holder, never refilled.
// Food travels: the item models are SHARED boot files (assets/manifest.ts MODEL_FILES item_<id>), not Skyways-only.
//
// Numbers (survival 0-100 scale; cf. beans 30 food, water 35 water): a full bowl of ramen is the most filling find in the game and its
// broth helps thirst a little; the bento is a solid meal; the bubble tea is mostly a drink (milk tea + tapioca pearls).
// Registered into the shared tables by one tagged line each: items.ts (ITEMS / FOOD_IDS / DRINK_IDS / ITEM_DIMS / IconKey),
// assets/manifest.ts (MODEL_FILES), ui/icons.ts (SVG fallback icons: ui/skywaysFoodIcons.ts), damage/materials.ts (ITEM_CLASS /
// ITEM_PHYSICS / MODEL_KEY_CLASS), items/lootTables.ts (econ categories), weapons/consumeView.ts, audio/sfx.ts.
import type {ItemDef, ItemDims} from './items';
import type {DamageClass, ItemPhysics} from '../damage/materials';
import {SKYWAYS_FOOD_MODELS, SKYWAYS_FOOD_MODEL_BYTES, type SkywaysFoodModelKey} from '../assets/skywaysFoodModels';

export const RAMEN = 'ramen';
export const RAMEN_CHASHU = 'ramen_chashu';
export const SUSHI_BENTO = 'sushi_bento';
export const BUBBLE_TEA = 'bubble_tea';

/** Food (verb eat) and drink (verb drink) ids, appended to items.ts FOOD_IDS / DRINK_IDS. */
export const SKYWAYS_FOOD_IDS = [RAMEN, RAMEN_CHASHU, SUSHI_BENTO] as const;
export const SKYWAYS_DRINK_IDS = [BUBBLE_TEA] as const;
export type SkywaysFoodId = (typeof SKYWAYS_FOOD_IDS)[number] | (typeof SKYWAYS_DRINK_IDS)[number];
export const SKYWAYS_EDIBLE_IDS: readonly SkywaysFoodId[] = [...SKYWAYS_FOOD_IDS, ...SKYWAYS_DRINK_IDS];
export const isSkywaysFood = (id: string): id is SkywaysFoodId => (SKYWAYS_EDIBLE_IDS as readonly string[]).includes(id);

/** Icon keys (= the item ids, like every food / drink: tests/survival.test.ts). */
export type SkywaysFoodIconKey = SkywaysFoodId;

export const SKYWAYS_FOOD_ITEMS: Record<SkywaysFoodId, ItemDef> = {
  [RAMEN]: {id: RAMEN, name: 'Shoyu ramen bowl', short: 'Ramen', kind: 'consumable', stackMax: 2, hunger: 40, thirst: 12, useTime: 2.5, verb: 'eat', icon: RAMEN,
    description: 'A patterned bowl of shoyu ramen left on the pass, long gone cold: wheat noodles, a soy broth under a skin of fat, half an egg. The most filling thing you will find, and the broth helps your thirst a little.'},
  [RAMEN_CHASHU]: {id: RAMEN_CHASHU, name: 'Chashu ramen bowl', short: 'Chashu ramen', kind: 'consumable', stackMax: 2, hunger: 45, thirst: 10, useTime: 2.5, verb: 'eat', icon: RAMEN_CHASHU,
    description: 'A deep white bowl of ramen topped with slices of braised pork belly, cold and set. Heavier than the plain bowl; slurp the broth too.'},
  [SUSHI_BENTO]: {id: SUSHI_BENTO, name: 'Sushi bento box', short: 'Bento', kind: 'consumable', stackMax: 3, hunger: 32, useTime: 2.2, verb: 'eat', icon: SUSHI_BENTO,
    description: 'A lidded bento of nigiri, maki and rice from the ramen bar\'s cold case. The fish is past its best but the rice still fills you up.'},
  [BUBBLE_TEA]: {id: BUBBLE_TEA, name: 'Bubble tea', short: 'Bubble tea', kind: 'consumable', stackMax: 3, thirst: 30, hunger: 8, useTime: 1.8, verb: 'drink', icon: BUBBLE_TEA,
    description: 'A sealed cup of milk tea with tapioca pearls and a fat straw. Mostly a drink; the pearls are a little food.'},
};

/** The runtime model of each item (assets/skywaysFoodModels.ts key; manifest key `item_<id>`). */
export const SKYWAYS_FOOD_MODEL: Readonly<Record<SkywaysFoodId, SkywaysFoodModelKey>> = {
  [RAMEN]: 'item_ramen_bowl', [RAMEN_CHASHU]: 'item_ramen_chashu', [SUSHI_BENTO]: 'item_sushi_bento', [BUBBLE_TEA]: 'item_bubble_tea',
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;
/**
 * Item dims = the models' real bounds (assets/skywaysFoodModels.ts SKYWAYS_FOOD_MODELS), so world/pickups.ts fitItemModel keeps them at
 * scale 1. Bowls and the bento always rest on their base ('flat': a bowl of soup is never laid on its side to fit a shelf); the cup is a
 * cylinder (it lies down only where a slot is too low for it).
 */
export const SKYWAYS_FOOD_DIMS: Record<SkywaysFoodId, ItemDims> = Object.fromEntries(SKYWAYS_EDIBLE_IDS.map(id => {
  const m = SKYWAYS_FOOD_MODELS[SKYWAYS_FOOD_MODEL[id]];
  return [id, {w: r4(m.w), d: r4(m.d), h: r4(m.h), shape: id === BUBBLE_TEA ? 'cylinder' : 'flat'}];
})) as Record<SkywaysFoodId, ItemDims>;

/** Boot model files (assets/manifest.ts MODEL_FILES): shared, every level (food travels). */
export const SKYWAYS_FOOD_MODEL_FILES: Readonly<Record<`item_${SkywaysFoodId}`, {url: string; bytes: number}>> = Object.fromEntries(SKYWAYS_EDIBLE_IDS.map(id => {
  const k = SKYWAYS_FOOD_MODEL[id];
  return [`item_${id}`, {url: SKYWAYS_FOOD_MODELS[k].url, bytes: SKYWAYS_FOOD_MODEL_BYTES[k]}];
})) as Record<`item_${SkywaysFoodId}`, {url: string; bytes: number}>;

/** Damage class of the loose item / lot (bullets: ceramic bowls chip like porcelain; the bento tray and the cup are plastic). */
export const SKYWAYS_FOOD_CLASS: Readonly<Record<SkywaysFoodId, DamageClass>> = {
  [RAMEN]: 'porcelain', [RAMEN_CHASHU]: 'porcelain', [SUSHI_BENTO]: 'plastic', [BUBBLE_TEA]: 'plastic',
};
/** The same classes keyed by the boot model key (damage/materials.ts MODEL_KEY_CLASS). */
export const SKYWAYS_FOOD_MODEL_CLASS: Readonly<Record<`item_${SkywaysFoodId}`, DamageClass>> = Object.fromEntries(SKYWAYS_EDIBLE_IDS.map(id => [`item_${id}`, SKYWAYS_FOOD_CLASS[id]])) as Record<`item_${SkywaysFoodId}`, DamageClass>;

/**
 * Rigid body of a loose item / knocked lot (physics/dynamicItems.ts): a ceramic ramen bowl (~0.45 kg) full of noodles and broth (~0.6 kg)
 * on an upright-cylinder collider; the bento (box + rice + fish, ~0.5 kg); a 700 ml cup of tea with pearls (~0.6 kg).
 */
export const SKYWAYS_FOOD_PHYSICS: Readonly<Record<SkywaysFoodId, ItemPhysics>> = {
  [RAMEN]: {mass: 1.0, shape: 'cylinder', mat: 'stone'},
  [RAMEN_CHASHU]: {mass: 1.1, shape: 'cylinder', mat: 'stone'},
  [SUSHI_BENTO]: {mass: 0.5, shape: 'box', mat: 'plastic'},
  [BUBBLE_TEA]: {mass: 0.6, shape: 'cylinder', mat: 'plastic'},
};
