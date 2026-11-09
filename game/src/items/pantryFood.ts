// Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): THE PANTRY — 18 foods + 6 drinks (F01..F18, D01, D02, D04..D07 of
// the approved food / shelf vision board; D03 / D08 are excluded) as ordinary collectible consumables. User intent: "more VARIETY of
// collectible food and drinks across the game, less repetition like 30 % chocolate bars".
//
// They are ordinary consumables (items/items.ts kind 'consumable', verb eat / drink): the existing survival bars only (player/survival.ts —
// no new meter, no buff, no poison / disease, no crafting), the existing timed use + first-person eat / drink view (weapons/consumeView.ts
// styles: PANTRY_CONSUME picks an existing motion), the existing eat / drink cues (audio/sfx.ts: PANTRY_SOUND picks an existing take), the
// generic consume / stack / save paths. Numbers sit in the existing balance (survival 0-100 scale; water 35, cola 20 / 4, juice 25 / 6,
// chocolate 12, chips 14 / -4, beans 30 / 4, noodles 25 / -3, bread 22 / -3): each new item is close to the old item it stands in for.
//
// NOT more food: no table row names them. They appear only through items/pantryVariety.ts — a deterministic FAMILY SUBSTITUTION of the old
// foods / drinks at realization (a lot / floor pickup that rolled chocolate may become butter cookies, ...): same lot, same count, the
// expected food / water per substituted lot within ~10 % of the original (tests/food-variety.test.ts).
//
// Models: the cook lane's runtime GLBs (assets/foodShelfModels.generated.ts FOOD_ITEM_MODELS, keyed by these ids; Meshy maps kept).
// Item dims = the delivered model's measured bounds when it is there, else the vision-board real size (the cook's reference measure).
// They are NOT boot files: world/pantryModels.ts fetches them lazily (the level's palette + what the player carries) and keeps them;
// until a model is loaded (or when the record is empty) the item shows a plain labelled FALLBACK primitive (never finished art).
import type {ItemDef, ItemDims, ItemShape} from './items';
import type {DamageClass, ItemPhysics} from '../damage/materials';
import {FOOD_ITEM_MODELS} from '../assets/foodShelfModels.generated';

export const CORNED_BEEF = 'corned_beef';
export const SARDINES = 'sardines';
export const FIELD_RATION = 'field_ration';
export const RATION_BRICK = 'ration_brick';
export const PICKLES = 'pickles';
export const PEANUT_BUTTER = 'peanut_butter';
export const SALTINES = 'saltines';
export const JERKY = 'jerky';
export const TRAIL_MIX = 'trail_mix';
export const HONEY = 'honey';
export const BUTTER_COOKIES = 'butter_cookies';
export const PUDDING_CUPS = 'pudding_cups';
export const FRUIT_PUREE = 'fruit_puree';
export const RAISINS = 'raisins';
export const SMOKED_SAUSAGE = 'smoked_sausage';
export const WAX_CHEESE = 'wax_cheese';
export const ROLLED_OATS = 'rolled_oats';
export const RICE_CRACKERS = 'rice_crackers';
export const SPORTS_DRINK = 'sports_drink';
export const ICED_COFFEE = 'iced_coffee';
export const ICED_TEA = 'iced_tea';
export const JUICE_BOXES = 'juice_boxes';
export const UHT_MILK = 'uht_milk';
export const GINGER_SODA = 'ginger_soda';

/** Food (verb eat) ids in vision-board order (F01..F18), appended to items.ts FOOD_IDS. */
export const PANTRY_FOOD_IDS = [
  CORNED_BEEF, SARDINES, FIELD_RATION, RATION_BRICK, PICKLES, PEANUT_BUTTER, SALTINES, JERKY, TRAIL_MIX, HONEY,
  BUTTER_COOKIES, PUDDING_CUPS, FRUIT_PUREE, RAISINS, SMOKED_SAUSAGE, WAX_CHEESE, ROLLED_OATS, RICE_CRACKERS,
] as const;
/** Drink (verb drink) ids (D01, D02, D04..D07), appended to items.ts DRINK_IDS. */
export const PANTRY_DRINK_IDS = [SPORTS_DRINK, ICED_COFFEE, ICED_TEA, JUICE_BOXES, UHT_MILK, GINGER_SODA] as const;
export type PantryFoodId = (typeof PANTRY_FOOD_IDS)[number];
export type PantryDrinkId = (typeof PANTRY_DRINK_IDS)[number];
export type PantryId = PantryFoodId | PantryDrinkId;
export const PANTRY_IDS: readonly PantryId[] = [...PANTRY_FOOD_IDS, ...PANTRY_DRINK_IDS];
const PANTRY_SET: ReadonlySet<string> = new Set(PANTRY_IDS);
export const isPantryItem = (id: string): id is PantryId => PANTRY_SET.has(id);

/** Vision-board asset id of each item (PLAN / provenance: the cook's FOOD_ITEM_MODELS entry carries it too). */
export const PANTRY_ASSET_ID: Readonly<Record<PantryId, string>> = {
  [CORNED_BEEF]: 'F01', [SARDINES]: 'F02', [FIELD_RATION]: 'F03', [RATION_BRICK]: 'F04', [PICKLES]: 'F05', [PEANUT_BUTTER]: 'F06',
  [SALTINES]: 'F07', [JERKY]: 'F08', [TRAIL_MIX]: 'F09', [HONEY]: 'F10', [BUTTER_COOKIES]: 'F11', [PUDDING_CUPS]: 'F12', [FRUIT_PUREE]: 'F13',
  [RAISINS]: 'F14', [SMOKED_SAUSAGE]: 'F15', [WAX_CHEESE]: 'F16', [ROLLED_OATS]: 'F17', [RICE_CRACKERS]: 'F18',
  [SPORTS_DRINK]: 'D01', [ICED_COFFEE]: 'D02', [ICED_TEA]: 'D04', [JUICE_BOXES]: 'D05', [UHT_MILK]: 'D06', [GINGER_SODA]: 'D07',
};

/** Icon keys (= the item ids, like every food / drink: tests/survival.test.ts). */
export type PantryIconKey = PantryId;

const food = (id: PantryFoodId, name: string, short: string, hunger: number, thirst: number, stackMax: number, useTime: number, description: string): ItemDef =>
  ({id, name, short, kind: 'consumable', stackMax, hunger, ...(thirst ? {thirst} : {}), useTime, verb: 'eat', icon: id, description});
const drink = (id: PantryDrinkId, name: string, short: string, thirst: number, hunger: number, stackMax: number, useTime: number, description: string): ItemDef =>
  ({id, name, short, kind: 'consumable', stackMax, thirst, ...(hunger ? {hunger} : {}), useTime, verb: 'drink', icon: id, description});

/**
 * The 24 ItemDefs. Family (what it stands in for, items/pantryVariety.ts) in brackets — values stay close to that item:
 * tinned meals [beans 30 / +4], dry meals [noodles 25 / -3], sweet snacks [chocolate 12], savoury snacks [chips 14 / -4],
 * soft drinks [cola 20 water / 4 food], juice-like [juice 25 / 6], electrolyte [water 35].
 */
export const PANTRY_ITEMS: Record<PantryId, ItemDef> = {
  // --- tinned / pouch meals (beans family) ---
  [CORNED_BEEF]: food(CORNED_BEEF, 'Corned beef tin', 'Corned beef', 30, -2, 4, 2.2,
    'A tapered tin of pressed corned beef with its key still taped to the side. Salty, dense and very filling, cold or not.'),
  [SARDINES]: food(SARDINES, 'Sardine tin', 'Sardines', 24, 2, 6, 1.8,
    'A flat ring-pull tin of sardines in oil. A small meal, and the oil goes down easier than you would think.'),
  [FIELD_RATION]: food(FIELD_RATION, 'Field ration pouch', 'Field ration', 34, 4, 3, 2.5,
    'A sealed khaki ration pouch: a retort main course, crackers and a drink sachet you mix with the juices. A full meal in one bag.'),
  [RATION_BRICK]: food(RATION_BRICK, 'Emergency ration brick', 'Ration brick', 44, -6, 3, 2.4,
    'A foil-wrapped block of compressed emergency ration, years from its date and still good. The most food in the smallest space; it leaves your mouth dry.'),
  [PICKLES]: food(PICKLES, 'Pickled vegetables jar', 'Pickles', 18, 6, 3, 2.0,
    'A glass jar of pickled carrots, cauliflower and cucumbers in cloudy brine. Less filling than meat, but the brine is wet and sharp.'),
  // --- dry meals (noodles family) ---
  [PEANUT_BUTTER]: food(PEANUT_BUTTER, 'Peanut butter tub', 'Peanut butter', 30, -6, 3, 2.2,
    'A plastic tub of peanut butter, eaten off two fingers. Rich and filling, and it sticks to the roof of your mouth.'),
  [SMOKED_SAUSAGE]: food(SMOKED_SAUSAGE, 'Smoked sausage chub', 'Smoked sausage', 28, -4, 3, 2.2,
    'A shelf-stable chub of smoked sausage in its casing. Chewy, salty and proper food.'),
  [WAX_CHEESE]: food(WAX_CHEESE, 'Wax-sealed cheese round', 'Wax cheese', 24, -1, 3, 2.0,
    'A small round of hard cheese sealed in red wax. Peel the wax and it is as good as the day it was made.'),
  [ROLLED_OATS]: food(ROLLED_OATS, 'Rolled oats canister', 'Rolled oats', 24, -5, 3, 2.2,
    'A cardboard canister of rolled oats. No milk, no stove — you eat them dry by the handful. Filling, and thirsty work.'),
  // --- savoury snacks (chips family) ---
  [SALTINES]: food(SALTINES, 'Saltine crackers box', 'Saltines', 13, -5, 4, 1.8,
    'A box of square salted crackers, a sleeve or two still sealed. Dry, salty and better than nothing.'),
  [JERKY]: food(JERKY, 'Beef jerky pouch', 'Jerky', 16, -6, 4, 2.0,
    'A resealable pouch of dried beef jerky. Tough to chew, full of salt, a good snack for the road.'),
  [TRAIL_MIX]: food(TRAIL_MIX, 'Trail mix bag', 'Trail mix', 15, -3, 4, 1.6,
    'A bag of nuts, seeds and dried fruit. A quick handful of energy; a little salty.'),
  [RICE_CRACKERS]: food(RICE_CRACKERS, 'Rice cracker tray pack', 'Rice crackers', 12, -3, 4, 1.6,
    'A tray pack of glazed rice crackers from an import shelf, the wrapper crackling. Light, crunchy and a bit salty.'),
  // --- sweet snacks (chocolate family) ---
  [HONEY]: food(HONEY, 'Honey squeeze bottle', 'Honey', 13, -1, 4, 1.4,
    'A squeeze bottle of honey, thick and crystallising. Honey never spoils; a few mouthfuls of pure sugar.'),
  [BUTTER_COOKIES]: food(BUTTER_COOKIES, 'Butter cookie tin', 'Butter cookies', 13, -2, 3, 1.8,
    'A round blue tin of butter cookies, actually full of cookies for once. Sweet and crumbly.'),
  [PUDDING_CUPS]: food(PUDDING_CUPS, 'Pudding cup four-pack', 'Pudding cups', 11, 2, 4, 1.6,
    'Four shelf-stable pudding cups in a sleeve. Sweet, soft and easy to get down.'),
  [FRUIT_PUREE]: food(FRUIT_PUREE, 'Fruit puree pouch', 'Fruit puree', 9, 3, 6, 1.2,
    'A spouted pouch of fruit puree meant for a child\'s lunch box. A little food and a little juice.'),
  [RAISINS]: food(RAISINS, 'Raisin mini-boxes', 'Raisins', 11, -1, 6, 1.4,
    'Three little cardboard boxes of raisins, banded together. Sweet, chewy and light to carry.'),
  // --- drinks ---
  [SPORTS_DRINK]: drink(SPORTS_DRINK, 'Sports drink bottle', 'Sports drink', 32, 3, 4, 1.6,
    'A squeeze-cap bottle of electrolyte drink in a colour not found in nature. Nearly as good as water, with a little sugar.'),
  [ICED_COFFEE]: drink(ICED_COFFEE, 'Slim iced-coffee can', 'Iced coffee', 17, 7, 6, 1.4,
    'A slim can of sweet milky iced coffee, warm now. Less water than a soda, more to it.'),
  [ICED_TEA]: drink(ICED_TEA, 'Iced tea glass bottle', 'Iced tea', 26, 4, 4, 1.6,
    'A glass bottle of lemon iced tea with a crimped cap. Sweet and wet.'),
  [JUICE_BOXES]: drink(JUICE_BOXES, 'Juice box three-pack', 'Juice boxes', 24, 6, 4, 1.8,
    'Three small juice boxes in their wrap, straws still glued on. You drink them one after another.'),
  [UHT_MILK]: drink(UHT_MILK, 'UHT milk brick', 'UHT milk', 22, 10, 4, 1.8,
    'A shelf-stable carton of long-life milk, sealed. Food and drink at once; it tastes a little cooked.'),
  [GINGER_SODA]: drink(GINGER_SODA, 'Ginger soda bottle', 'Ginger soda', 21, 3, 4, 1.6,
    'A glass bottle of ginger soda, mostly flat. Sugary water with a bite.'),
};

/**
 * Real size (m) of each item as it normally rests: the vision board's reference measure (PLAN: H = height, W = width / length,
 * D = diameter) completed with the object's ordinary proportions; `shape` = how it lies down when a slot is too low or it was knocked
 * over (cylinders roll onto their side, boxes / bags onto their back, flat items always rest flat). The delivered model's measured
 * bounds replace w / h / d (PANTRY_DIMS).
 */
export const PANTRY_NOMINAL: Readonly<Record<PantryId, ItemDims>> = {
  [CORNED_BEEF]: {w: 0.095, d: 0.06, h: 0.10, shape: 'box'},       // F01 H 0.10: the tapered oblong tin, standing
  [SARDINES]: {w: 0.11, d: 0.075, h: 0.03, shape: 'flat'},        // F02 W 0.11: a flat ring-pull tin
  [FIELD_RATION]: {w: 0.15, d: 0.05, h: 0.20, shape: 'box'},      // F03 H 0.20: the pouch standing on its gusset
  [RATION_BRICK]: {w: 0.15, d: 0.085, h: 0.045, shape: 'flat'},   // F04 W 0.15: a foil block lying flat
  [PICKLES]: {w: 0.10, d: 0.10, h: 0.18, shape: 'cylinder'},      // F05 H 0.18: a glass jar
  [PEANUT_BUTTER]: {w: 0.095, d: 0.095, h: 0.12, shape: 'cylinder'}, // F06 H 0.12: a tub
  [SALTINES]: {w: 0.22, d: 0.065, h: 0.13, shape: 'box'},         // F07 W 0.22: the cracker box standing
  [JERKY]: {w: 0.14, d: 0.045, h: 0.20, shape: 'box'},            // F08 H 0.20: a stand-up pouch
  [TRAIL_MIX]: {w: 0.15, d: 0.05, h: 0.20, shape: 'box'},         // F09 H 0.20: a stand-up bag
  [HONEY]: {w: 0.075, d: 0.06, h: 0.17, shape: 'cylinder'},       // F10 H 0.17: a squeeze bottle
  [BUTTER_COOKIES]: {w: 0.20, d: 0.20, h: 0.075, shape: 'flat'},  // F11 D 0.20: a round tin
  [PUDDING_CUPS]: {w: 0.15, d: 0.075, h: 0.075, shape: 'flat'},   // F12 W 0.15: four cups in a sleeve
  [FRUIT_PUREE]: {w: 0.09, d: 0.035, h: 0.15, shape: 'box'},      // F13 H 0.15: a spouted pouch
  [RAISINS]: {w: 0.12, d: 0.035, h: 0.075, shape: 'box'},         // F14 W 0.12: three banded mini boxes
  [SMOKED_SAUSAGE]: {w: 0.28, d: 0.055, h: 0.055, shape: 'flat'}, // F15 W 0.28: a chub lying along X
  [WAX_CHEESE]: {w: 0.14, d: 0.14, h: 0.065, shape: 'flat'},      // F16 D 0.14: a waxed round
  [ROLLED_OATS]: {w: 0.13, d: 0.13, h: 0.24, shape: 'cylinder'},  // F17 H 0.24: a canister
  [RICE_CRACKERS]: {w: 0.22, d: 0.08, h: 0.06, shape: 'flat'},    // F18 W 0.22: a tray pack lying flat
  [SPORTS_DRINK]: {w: 0.07, d: 0.07, h: 0.23, shape: 'cylinder'}, // D01 H 0.23
  [ICED_COFFEE]: {w: 0.058, d: 0.058, h: 0.17, shape: 'cylinder'}, // D02 H 0.17: a slim can
  [ICED_TEA]: {w: 0.072, d: 0.072, h: 0.24, shape: 'cylinder'},   // D04 H 0.24: a glass bottle
  [JUICE_BOXES]: {w: 0.15, d: 0.04, h: 0.105, shape: 'box'},      // D05 W 0.15: three boxes in a wrap
  [UHT_MILK]: {w: 0.075, d: 0.065, h: 0.20, shape: 'box'},        // D06 H 0.20: a carton brick
  [GINGER_SODA]: {w: 0.068, d: 0.068, h: 0.22, shape: 'cylinder'}, // D07 H 0.22: a glass bottle
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const shapeOf = (id: PantryId): ItemShape => PANTRY_NOMINAL[id].shape;

/**
 * Item dims: the delivered model's real bounds (FOOD_ITEM_MODELS; world/pickups.ts fitItemModel keeps it at scale 1), else the nominal size.
 * A delivered box-like model that already rests LYING (height under half its footprint: a pouch / box cooked on its back) is 'flat' — it
 * is never turned onto its back again (that would stand it on end).
 */
export const PANTRY_DIMS: Record<PantryId, ItemDims> = Object.fromEntries(PANTRY_IDS.map(id => {
  const m = FOOD_ITEM_MODELS[id];
  const ok = !!m && [m.w, m.h, m.d].every(v => Number.isFinite(v) && v > 0.005 && v < 1);
  if (!ok) return [id, {...PANTRY_NOMINAL[id]}];
  const lying = shapeOf(id) === 'box' && m.h < 0.5 * Math.max(m.w, m.d);
  return [id, {w: r4(m.w), d: r4(m.d), h: r4(m.h), shape: lying ? 'flat' : shapeOf(id)}];
})) as Record<PantryId, ItemDims>;

/** The delivered runtime model of an item (FOOD_ITEM_MODELS entry), or null while the cook has not delivered it. */
export function pantryModelUrl(id: string): string | null {
  const m = isPantryItem(id) ? FOOD_ITEM_MODELS[id] : undefined;
  return m && typeof m.url === 'string' && m.url.length ? m.url : null;
}

/** Damage class of the loose item / lot (bullets): tins sheet metal, jars / bottles glass, pouches / tubs plastic, cartons card, food food. */
export const PANTRY_CLASS: Readonly<Record<PantryId, DamageClass>> = {
  [CORNED_BEEF]: 'sheetMetal', [SARDINES]: 'sheetMetal', [FIELD_RATION]: 'plastic', [RATION_BRICK]: 'plastic', [PICKLES]: 'glass',
  [PEANUT_BUTTER]: 'plastic', [SALTINES]: 'cardboard', [JERKY]: 'plastic', [TRAIL_MIX]: 'plastic', [HONEY]: 'plastic',
  [BUTTER_COOKIES]: 'sheetMetal', [PUDDING_CUPS]: 'plastic', [FRUIT_PUREE]: 'plastic', [RAISINS]: 'cardboard', [SMOKED_SAUSAGE]: 'food',
  [WAX_CHEESE]: 'food', [ROLLED_OATS]: 'cardboard', [RICE_CRACKERS]: 'plastic',
  [SPORTS_DRINK]: 'plastic', [ICED_COFFEE]: 'sheetMetal', [ICED_TEA]: 'glass', [JUICE_BOXES]: 'cardboard', [UHT_MILK]: 'cardboard', [GINGER_SODA]: 'glass',
};
/** The same classes keyed by the item model key (damage/materials.ts MODEL_KEY_CLASS; world/pickups.ts ITEM_MODEL_KEYS `item_<id>`). */
export const PANTRY_MODEL_CLASS: Readonly<Record<`item_${PantryId}`, DamageClass>> =
  Object.fromEntries(PANTRY_IDS.map(id => [`item_${id}`, PANTRY_CLASS[id]])) as Record<`item_${PantryId}`, DamageClass>;

/**
 * Rigid body of a loose item / knocked lot (physics/dynamicItems.ts): plausible full masses (kg) on an upright cylinder (jars, bottles,
 * tubs, cans) or a box collider; contact family like the old items (cola / beans tins metal, bags and boxes soft, bottles plastic,
 * glass jars / bottles glass).
 */
export const PANTRY_PHYSICS: Readonly<Record<PantryId, ItemPhysics>> = {
  [CORNED_BEEF]: {mass: 0.36, shape: 'box', mat: 'metal'},
  [SARDINES]: {mass: 0.13, shape: 'box', mat: 'metal'},
  [FIELD_RATION]: {mass: 0.55, shape: 'box', mat: 'soft'},
  [RATION_BRICK]: {mass: 0.5, shape: 'box', mat: 'soft'},
  [PICKLES]: {mass: 0.8, shape: 'cylinder', mat: 'glass'},
  [PEANUT_BUTTER]: {mass: 0.5, shape: 'cylinder', mat: 'plastic'},
  [SALTINES]: {mass: 0.45, shape: 'box', mat: 'soft'},
  [JERKY]: {mass: 0.1, shape: 'box', mat: 'soft'},
  [TRAIL_MIX]: {mass: 0.3, shape: 'box', mat: 'soft'},
  [HONEY]: {mass: 0.38, shape: 'cylinder', mat: 'plastic'},
  [BUTTER_COOKIES]: {mass: 0.45, shape: 'cylinder', mat: 'metal'},
  [PUDDING_CUPS]: {mass: 0.45, shape: 'box', mat: 'plastic'},
  [FRUIT_PUREE]: {mass: 0.1, shape: 'box', mat: 'soft'},
  [RAISINS]: {mass: 0.1, shape: 'box', mat: 'soft'},
  [SMOKED_SAUSAGE]: {mass: 0.45, shape: 'box', mat: 'soft'},
  [WAX_CHEESE]: {mass: 0.6, shape: 'cylinder', mat: 'soft'},
  [ROLLED_OATS]: {mass: 0.5, shape: 'cylinder', mat: 'soft'},
  [RICE_CRACKERS]: {mass: 0.15, shape: 'box', mat: 'soft'},
  [SPORTS_DRINK]: {mass: 0.62, shape: 'cylinder', mat: 'plastic'},
  [ICED_COFFEE]: {mass: 0.27, shape: 'cylinder', mat: 'metal'},
  [ICED_TEA]: {mass: 0.75, shape: 'cylinder', mat: 'glass'},
  [JUICE_BOXES]: {mass: 0.62, shape: 'box', mat: 'soft'},
  [UHT_MILK]: {mass: 1.03, shape: 'box', mat: 'soft'},
  [GINGER_SODA]: {mass: 0.7, shape: 'cylinder', mat: 'glass'},
};

/**
 * First-person eat / drink motion (weapons/consumeView.ts): the EXISTING style an item is used with — 'chocolate' (a bar bitten end-on),
 * 'chips' (a bag tipped and shaken), 'beans' (a tin / jar tipped and scooped), 'noodles' (a cup tipped), 'sip' (held up and tipped like a
 * bottle: a squeeze bottle / pouch), 'bite' (held and bitten). Drinks use the drink tip.
 */
export type PantryConsume = 'chocolate' | 'chips' | 'beans' | 'noodles' | 'sip' | 'bite';
export const PANTRY_CONSUME: Readonly<Record<PantryFoodId, PantryConsume>> = {
  [RATION_BRICK]: 'chocolate', [SMOKED_SAUSAGE]: 'chocolate',
  [JERKY]: 'chips', [TRAIL_MIX]: 'chips', [RAISINS]: 'chips', [RICE_CRACKERS]: 'chips', [SALTINES]: 'chips', [FIELD_RATION]: 'chips',
  [CORNED_BEEF]: 'beans', [SARDINES]: 'beans', [PICKLES]: 'beans', [PEANUT_BUTTER]: 'beans', [PUDDING_CUPS]: 'beans', [BUTTER_COOKIES]: 'beans',
  [ROLLED_OATS]: 'noodles',
  [HONEY]: 'sip', [FRUIT_PUREE]: 'sip',
  [WAX_CHEESE]: 'bite',
};

/** The EXISTING eat / drink take of each item (audio/sfx.ts cue ids; no new audio): crunchy bags / boxes, tins, bars, dry cups, chews; cans, bottles, cartons. */
export type PantrySound = 'eatChips' | 'eatChocolate' | 'eatBeans' | 'eatNoodles' | 'eat' | 'drinkCola' | 'drinkWater' | 'drinkJuice';
export const PANTRY_SOUND: Readonly<Record<PantryId, PantrySound>> = {
  [JERKY]: 'eatChips', [TRAIL_MIX]: 'eatChips', [RICE_CRACKERS]: 'eatChips', [SALTINES]: 'eatChips', [RAISINS]: 'eatChips', [FIELD_RATION]: 'eatChips',
  [CORNED_BEEF]: 'eatBeans', [SARDINES]: 'eatBeans', [PICKLES]: 'eatBeans', [PEANUT_BUTTER]: 'eatBeans', [PUDDING_CUPS]: 'eatBeans',
  [RATION_BRICK]: 'eatChocolate', [BUTTER_COOKIES]: 'eatChocolate',
  [ROLLED_OATS]: 'eatNoodles',
  [HONEY]: 'eat', [FRUIT_PUREE]: 'eat', [SMOKED_SAUSAGE]: 'eat', [WAX_CHEESE]: 'eat',
  [ICED_COFFEE]: 'drinkCola', [GINGER_SODA]: 'drinkCola',
  [JUICE_BOXES]: 'drinkJuice', [UHT_MILK]: 'drinkJuice',
  [ICED_TEA]: 'drinkWater', [SPORTS_DRINK]: 'drinkWater',
};

/**
 * The plain FALLBACK primitive of an item while its model is not loaded (world/pantryModels.ts): a form at ITEM_DIMS size and two flat
 * colours (body / cap-band). Geometry only — no label, picture or texture (never a stand-in for the generated art).
 */
export type PantryForm = 'can' | 'jar' | 'bottle' | 'box' | 'pouch' | 'tin' | 'round' | 'chub' | 'multi';
export const PANTRY_FALLBACK: Readonly<Record<PantryId, {form: PantryForm; body: number; accent: number}>> = {
  [CORNED_BEEF]: {form: 'box', body: 0x9a7b4f, accent: 0xb8bcc0}, [SARDINES]: {form: 'tin', body: 0x3c6e8f, accent: 0xb8bcc0},
  [FIELD_RATION]: {form: 'pouch', body: 0x6b6a45, accent: 0x4f4e33}, [RATION_BRICK]: {form: 'tin', body: 0xc9b98a, accent: 0x8d8f91},
  [PICKLES]: {form: 'jar', body: 0x8a9a4a, accent: 0xc0c3c6}, [PEANUT_BUTTER]: {form: 'jar', body: 0xb07a3c, accent: 0xc93a2a},
  [SALTINES]: {form: 'box', body: 0xe6d6b0, accent: 0xb4321f}, [JERKY]: {form: 'pouch', body: 0x5a3a28, accent: 0xd8b25a},
  [TRAIL_MIX]: {form: 'pouch', body: 0x7c8a3c, accent: 0xd9a441}, [HONEY]: {form: 'bottle', body: 0xd99a1e, accent: 0xf2e6c8},
  [BUTTER_COOKIES]: {form: 'round', body: 0x24427a, accent: 0xd9c38a}, [PUDDING_CUPS]: {form: 'multi', body: 0xece2c6, accent: 0x7a4a2a},
  [FRUIT_PUREE]: {form: 'pouch', body: 0xe0703a, accent: 0x3f8a2e}, [RAISINS]: {form: 'multi', body: 0xb3261e, accent: 0xf0e2c0},
  [SMOKED_SAUSAGE]: {form: 'chub', body: 0x8a3a24, accent: 0xd8c9a0}, [WAX_CHEESE]: {form: 'round', body: 0xb51f1a, accent: 0xe8d28a},
  [ROLLED_OATS]: {form: 'can', body: 0xd9c08a, accent: 0x2f5a8a}, [RICE_CRACKERS]: {form: 'tin', body: 0xd9b56a, accent: 0xb53a2a},
  [SPORTS_DRINK]: {form: 'bottle', body: 0x3fa7d9, accent: 0x1f3f7a}, [ICED_COFFEE]: {form: 'can', body: 0x6b4a32, accent: 0xd9d2c4},
  [ICED_TEA]: {form: 'bottle', body: 0x9a5a1e, accent: 0xe0c050}, [JUICE_BOXES]: {form: 'multi', body: 0x5aa83a, accent: 0xe8a020},
  [UHT_MILK]: {form: 'box', body: 0xeef0f2, accent: 0x2f6fb5}, [GINGER_SODA]: {form: 'bottle', body: 0x8fa83c, accent: 0xd9d2c4},
};
