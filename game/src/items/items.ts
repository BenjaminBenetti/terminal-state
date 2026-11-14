// Item catalogue. Weapons reference WEAPONS by id; everything else is ammo or a consumable.
// Consumables restore health (medical) or food/water (player/survival.ts); values are tuned so a
// short slice never forces eating, but each item visibly moves its bar.

// Iteration 12 (LIGHT): 'throwable' = the grenade slot (the road flare: T throws it, or left click while it is held).
// Task office-overhaul-20261030 (lane INTERACT, user feedback #6): flares stack to 10; the dedicated grenade slot (HUD key G,
// items/inventory.ts throwSlot) takes throwables only and G strikes / throws from it (T retired; G no longer drops).
// Iteration 16: 'gear' = character gear worn in a gear slot (items/gear.ts; lane GEAR).
// Task gasmask-breach-20261030 (mask lane): 'supply' = a PASSIVE supply that worn gear draws by itself (the gas-mask filter):
// never used, equipped, held as a weapon or thrown; it stacks in the pockets first (like ammo).
// Task office-props-physics-scale-20261030 (lane RACK): 'material' = collectible crafting salvage (items/craftMaterials.ts): passive
// like 'supply' (never used / equipped / thrown; pockets first). Since task studio-train-crafting-v1-20261111-225628-01 the train's
// crafting bench consumes scrap metal and electrical parts (craft/recipes.ts) — and, since task studio-refinement-batch-20261113-035659-01,
// bio mater (the acid / lure grenades: items/grenades.ts).
// Task reactor-build-20261101 (lane RESTART): 'part' = a finite restart part of THE REACTOR (startup key, fuse cartridge): passive
// (never used / equipped / thrown; pockets first), placed once by the level generator, never in a loot table; a control consumes it.
// Task studio-market-rework-20261108-074144-01 (lane TRADE): 'currency' = the survivor market's Rail Ties (items/railTies.ts): passive
// (never used / equipped / thrown; pockets first), stacks to 1000, never loot, never traded for itself; only a trade pays it out.
export type ItemKind = 'weapon' | 'ammo' | 'consumable' | 'throwable' | 'gear' | 'supply' | 'material' | 'part' | 'currency';

/** Key into the HUD icon set (ui/icons.ts). */
export type IconKey =
  | 'rifle' | 'shotgun' | 'pistol' | 'ammo556' | 'ammo9mm' | 'ammo12ga' | 'medkit' | 'bandage' // lane AMMO: one icon per caliber
  | 'water' | 'cola' | 'juice' | 'chocolate' | 'chips' | 'beans' | 'noodles'
  | 'bread' // lane FURN (office-props-physics-scale-20261030): the bakery case's loaves
  | 'battery' | 'flare'
  | 'knife' // lane KNIFE: the first melee weapon
  | 'filter' // mask lane: gas-mask filter canister
  | GearIconKey | MedicalIconKey // Iteration 16 (lanes GEAR / INJURY)
  | MaterialIconKey // lane RACK (office-props-physics-scale-20261030): crafting materials
  | 'fuelCan' // task train-fuel-system-20261106-024923: the train's fuel can
  | SkywaysFoodIconKey // task studio-skyways-level-20261106-054448 (lane FOOD): ramen bowls, sushi bento, bubble tea (items/skywaysFood.ts)
  | PantryIconKey // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): the 24 pantry foods / drinks (items/pantryFood.ts)
  | 'reactorKey' | 'fuseCartridge' // task reactor-build-20261101 (lane RESTART): the reactor restart parts
  | 'railTies' // task studio-market-rework-20261108-074144-01 (lane TRADE): the market's Rail Ties (items/railTies.ts)
  | BeerIconKey // task studio-market-bar-20261108-225231-01 (lane BEER): the market bar's beers (items/beers.ts)
  | WeaponVarietyIconKey // task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the twelve new weapons (ui/weaponVarietyIcons.ts)
  | GrenadeIconKey // task studio-refinement-batch-20261113-035659-01: the crafted acid / lure grenades (items/grenades.ts)
  | FlamethrowerIconKey; // task studio-flamethrower-fire-20261114-031614-01: the flamethrower (items/flamethrowerItems.ts)

/** How a consumable is used: wording, sound and the stat it mainly restores ('use': the flashlight battery). */
export type ConsumeVerb = 'apply' | 'eat' | 'drink' | 'use';

export interface ItemDef {
  id: string;
  name: string;
  short: string;
  kind: ItemKind;
  stackMax: number;
  description: string;
  weaponId?: string;
  heal?: number;
  /** Food restored (+) or drained (−); survival 0-100 scale. */
  hunger?: number;
  /** Water restored (+) or drained (−). */
  thirst?: number;
  verb?: ConsumeVerb;
  useTime?: number;
  /** Iteration 12 (LIGHT): flashlight battery charge set by using it (1 = refill to 100 %; player/flashlight.ts). */
  recharge?: number;
  icon: IconKey;
  /** Iteration 16 (lane GEAR): gear slot + base-tier stats (items/gear.ts). */
  gear?: GearSpec;
  /** Iteration 16 (lane INJURY): limb injuries this item treats (items/medical.ts); HP-only items never treat limbs. */
  treats?: readonly Limb[];
  /** Lane AMMO (knife-melee-20261030): the caliber an ammo item IS (items/calibers.ts); weapons load by caliber. */
  caliber?: Caliber;
}

import {GEAR_DIMS, GEAR_ITEMS, type GearIconKey, type GearSpec} from './gear';
import type {Caliber} from './calibers';
import {MEDICAL_DIMS, MEDICAL_ITEMS, treatsText, type Limb, type MedicalIconKey} from './medical';
import {MATERIAL_DIMS, MATERIAL_ITEMS, type MaterialIconKey} from './craftMaterials'; // lane RACK (office-props-physics-scale-20261030)
import {SKYWAYS_DRINK_IDS, SKYWAYS_FOOD_DIMS, SKYWAYS_FOOD_IDS, SKYWAYS_FOOD_ITEMS, type SkywaysFoodIconKey} from './skywaysFood'; // task studio-skyways-level-20261106-054448 (lane FOOD)
import {RAIL_TIES_DIMS, RAIL_TIES_ITEMS} from './railTies'; // task studio-market-rework-20261108-074144-01 (lane TRADE)
import {BEER_DIMS, BEER_ITEMS, beerEffectText, isBeer, type BeerIconKey} from './beers'; // task studio-market-bar-20261108-225231-01: the market bar's beers
import {PANTRY_DIMS, PANTRY_DRINK_IDS, PANTRY_FOOD_IDS, PANTRY_ITEMS, type PantryIconKey} from './pantryFood'; // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS)
import {VARIETY_WEAPON_ITEMS, type WeaponVarietyIconKey} from './weaponVarietyItems'; // task studio-weapon-variety-production-20261109-224355-01: the twelve new weapons
import {GRENADE_DIMS, GRENADE_ITEMS, isGrenadeItem, type GrenadeIconKey} from './grenades'; // task studio-refinement-batch-20261113-035659-01: the crafted acid / lure grenades
import {FLAMETHROWER_DIMS, FLAMETHROWER_ITEMS, type FlamethrowerIconKey} from './flamethrowerItems'; // task studio-flamethrower-fire-20261114-031614-01: the flamethrower

// + bread (task office-props-physics-scale-20261030, lane FURN): only bakery display cases hold it (items/lootTables.ts BAKERY_ROWS)
// + the Skyways ramen restaurant's ramen bowls / bento and bubble tea (task studio-skyways-level-20261106-054448, lane FOOD: items/skywaysFood.ts)
// + the 18 pantry foods / 6 drinks (task studio-food-shelf-production-20261109-002816-01, lane ITEMS: items/pantryFood.ts) — in no table row:
//   they appear only by family substitution of the old items at realization (items/pantryVariety.ts)
export const FOOD_IDS = ['chocolate', 'chips', 'beans', 'noodles', 'bread', ...SKYWAYS_FOOD_IDS, ...PANTRY_FOOD_IDS] as const;
export const DRINK_IDS = ['water', 'cola', 'juice', ...SKYWAYS_DRINK_IDS, ...PANTRY_DRINK_IDS] as const;

export const ITEMS: Record<string, ItemDef> = {
  rifle: {id: 'rifle', name: 'Rifle — "Kept running"', short: 'Rifle', kind: 'weapon', stackMax: 1, weaponId: 'rifle', icon: 'rifle',
    description: 'Adapted automatic rifle with a battered optic. Chambered in 5.56×45mm; 30-round magazine.'},
  shotgun: {id: 'shotgun', name: 'Shotgun — "Old reliable"', short: 'Shotgun', kind: 'weapon', stackMax: 1, weaponId: 'shotgun', icon: 'shotgun',
    description: '12-gauge pump shotgun with a repaired stock. Loads shell by shell; devastating up close.'},
  pistol: {id: 'pistol', name: 'Pistol — "Service sidearm"', short: 'Pistol', kind: 'weapon', stackMax: 1, weaponId: 'pistol', icon: 'pistol',
    description: 'Semi-automatic 9mm (9×19mm) service pistol. 15-round magazine; quick to raise and reload.'},
  // Lane KNIFE (knife-melee-20261030): the user's survival knife — the first melee weapon; no ammo, never used up (weapons.ts knife).
  knife: {id: 'knife', name: 'Knife — "Last resort"', short: 'Knife', kind: 'weapon', stackMax: 1, weaponId: 'knife', icon: 'knife',
    // lane FEEL (knife-windup-20261030): hold to wind up / release to slash; 30 body / 60 head -> 2 head or 4 body slashes, reach 1.125 m
    description: 'Survival knife with a serrated spine. Melee: hold the button to wind up, release to slash (a quick tap slashes too) — no ammo, never runs out. Two slashes to the head or four to the body drop an ordinary zombie — and you have to get close enough to be hit back.'},
  // Lane AMMO (knife-melee-20261030): ammo items ARE calibers (items/calibers.ts); any weapon chambering that caliber loads from
  // them. Old ids ammo_pistol / ammo_rifle / ammo_shells migrate 1:1 (LEGACY_AMMO_IDS); stack limits unchanged (120 / 120 / 32).
  ammo_9mm: {id: 'ammo_9mm', name: '9mm rounds (9×19mm)', short: '9mm', kind: 'ammo', stackMax: 120, icon: 'ammo9mm', caliber: '9x19mm',
    description: 'Loose 9×19mm pistol cartridges. Loads any 9mm weapon — the service pistol, the Hornet SMG and the Longslide.'},
  ammo_556: {id: 'ammo_556', name: '5.56×45mm rounds', short: '5.56mm', kind: 'ammo', stackMax: 120, icon: 'ammo556', caliber: '5.56x45mm',
    description: 'Loose 5.56×45mm rifle cartridges. Loads any 5.56mm weapon — the automatic rifle, the Stub carbine and the Overwatch.'},
  ammo_12ga: {id: 'ammo_12ga', name: '12-gauge shells', short: '12-gauge', kind: 'ammo', stackMax: 32, icon: 'ammo12ga', caliber: '12ga',
    description: 'Buckshot shells. Loads any 12-gauge weapon — the pump shotgun, the Coach Gun and the Thresher.'},
  medkit: {id: 'medkit', name: 'First-aid kit', short: 'Med kit', kind: 'consumable', stackMax: 3, heal: 50, useTime: 2.2, verb: 'apply', icon: 'medkit',
    description: 'Restores 50 health. Takes a couple of seconds to apply.'},
  bandage: {id: 'bandage', name: 'Bandage roll', short: 'Bandage', kind: 'consumable', stackMax: 5, heal: 20, useTime: 1.1, verb: 'apply', icon: 'bandage',
    description: 'Restores 20 health quickly.'},
  // --- drinks ---
  water: {id: 'water', name: 'Bottled water', short: 'Water', kind: 'consumable', stackMax: 4, thirst: 35, useTime: 1.6, verb: 'drink', icon: 'water',
    description: 'Half-litre bottle, seal intact. The best thing for thirst.'},
  cola: {id: 'cola', name: 'Cola can', short: 'Cola', kind: 'consumable', stackMax: 6, thirst: 20, hunger: 4, useTime: 1.4, verb: 'drink', icon: 'cola',
    description: 'Warm, flat-ish and sugary. Some water and a little energy.'},
  juice: {id: 'juice', name: 'Orange juice carton', short: 'Juice', kind: 'consumable', stackMax: 4, thirst: 25, hunger: 6, useTime: 1.6, verb: 'drink', icon: 'juice',
    description: 'Shelf-stable carton from a kiosk fridge that stopped working long ago.'},
  // --- food ---
  chocolate: {id: 'chocolate', name: 'Chocolate bar', short: 'Chocolate', kind: 'consumable', stackMax: 6, hunger: 12, useTime: 1.2, verb: 'eat', icon: 'chocolate',
    description: 'A quick snack. Slightly bloomed, still good.'},
  chips: {id: 'chips', name: 'Potato chips bag', short: 'Chips', kind: 'consumable', stackMax: 4, hunger: 14, thirst: -4, useTime: 1.8, verb: 'eat', icon: 'chips',
    description: 'Salty. Fills you up a bit but makes you thirsty.'},
  beans: {id: 'beans', name: 'Canned beans', short: 'Beans', kind: 'consumable', stackMax: 4, hunger: 30, thirst: 4, useTime: 2.5, verb: 'eat', icon: 'beans',
    description: 'Ring-pull tin, eaten cold. The most filling find down here.'},
  noodles: {id: 'noodles', name: 'Instant noodle cup', short: 'Noodles', kind: 'consumable', stackMax: 4, hunger: 25, thirst: -3, useTime: 2.2, verb: 'eat', icon: 'noodles',
    description: 'No hot water, so you crunch them dry. Filling, salty.'},
  // Task office-props-physics-scale-20261030 (lane FURN, user: "the bread should be a food item"): the loaf the bakery case used to
  // have baked into its model, now a real pickup (model item-bread-t25.glb, cut out of the same Meshy case; finite case lots).
  bread: {id: 'bread', name: 'Stale bread loaf', short: 'Bread', kind: 'consumable', stackMax: 3, hunger: 22, thirst: -3, useTime: 2.0, verb: 'eat', icon: 'bread',
    description: 'A round crusty loaf from a bakery display case, gone hard as a brick. Filling once you work through the crust, and thirsty work.'},
  // --- task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways ramen restaurant's food (items/skywaysFood.ts) ---
  ...SKYWAYS_FOOD_ITEMS,
  // --- Iteration 12 (LIGHT): light survival (authored models: world/authoredItems.ts) ---
  battery: {id: 'battery', name: 'D-cell battery', short: 'Battery', kind: 'consumable', stackMax: 4, recharge: 1, useTime: 1.4, verb: 'use', icon: 'battery',
    description: 'Unbranded 1.5 V D cell, scuffed but holding charge. Swap it into the flashlight to refill it to 100 %.'},
  flare: {id: 'flare', name: 'Road flare', short: 'Flare', kind: 'throwable', stackMax: 10, icon: 'flare', // INTERACT (#6): was 3
    description: 'Red highway flare. Goes in the grenade slot: hold G to strike and ready one, release to throw (or hold click while it is in your hand): about 100 s of red light and smoke. Light draws the infected.'},
  // --- Task gasmask-breach-20261030 (mask lane): a passive supply (authored model: world/authoredItems.ts) ---
  gas_filter: {id: 'gas_filter', name: 'Gas mask filter canister', short: 'Filter', kind: 'supply', stackMax: 6, icon: 'filter',
    description: 'Screw-in 40 mm respirator filter, seal intact. Nothing to use by hand: a gas mask on your face fits a spare by itself when its filter runs out (from your pockets or quick slots — never from a worn backpack). One lasts 37.5 seconds on the face.'}, // (task train-fuel-system: corrected — FILTER_LIFE_S is 37.5 s since PR #52)
  // --- Task studio-beta-train-fuel-system-20261106-024923-01: the TRAIN's fuel (fuel/fuel.ts): one can = a quarter of the tank, 2 a slot ---
  fuel_can: {id: 'fuel_can', name: 'Fuel can', short: 'Fuel', kind: 'supply', stackMax: 2, icon: 'fuelCan',
    description: 'A small steel jerrycan of diesel: a quarter of the train\'s tank (one tank = one stop). Pour it in at the train\'s fuel cap (E), or leave it in the train chest — the train burns chest fuel by itself when it departs.'},
  // --- Iteration 16: character gear (lane GEAR, items/gear.ts) and limb-treatment items (lane INJURY, items/medical.ts) ---
  ...GEAR_ITEMS,
  ...MEDICAL_ITEMS,
  // --- Task office-props-physics-scale-20261030 (lane RACK): crafting materials (items/craftMaterials.ts; recipes: craft/recipes.ts) ---
  ...MATERIAL_ITEMS,
  // --- Task reactor-build-20261101 (lane RESTART): THE REACTOR's restart parts (world/reactor/restartLogic.ts) — finite, placed once by
  // the Reactor generator (layout.pickups + layout.reactor.components), never in a loot table, never refilled ---
  reactor_key: {id: 'reactor_key', name: 'Startup key', short: 'Key', kind: 'part', stackMax: 1, icon: 'reactorKey',
    description: 'The shift supervisor\'s reactor startup key, brass on a red fob. The control-room key switch will not arm the rod control without it — the switch keeps it once it is in.'},
  fuse_cartridge: {id: 'fuse_cartridge', name: 'Fuse cartridge', short: 'Fuse', kind: 'part', stackMax: 3, icon: 'fuseCartridge',
    description: 'A heavy ceramic switchgear fuse cartridge with tinned end caps and blade contacts. The reactor switchgear has two burnt-out slots; press E on a slot to seat one.'},
  // --- Task studio-market-rework-20261108-074144-01 (lane TRADE): the survivor market's currency, Rail Ties (items/railTies.ts) — never loot ---
  ...RAIL_TIES_ITEMS,
  ...BEER_ITEMS, // task studio-market-bar-20261108-225231-01: the market bar's beers (items/beers.ts; bar stock only, never loot)
  // --- task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): the pantry foods / drinks (items/pantryFood.ts) — appended LAST so
  // every earlier entry keeps its catalogue order (icon builds, fixtures); they appear only by family substitution (items/pantryVariety.ts) ---
  ...PANTRY_ITEMS,
  ...VARIETY_WEAPON_ITEMS, // task studio-weapon-variety-production-20261109-224355-01 (items/weaponVarietyItems.ts)
  ...GRENADE_ITEMS, // task studio-refinement-batch-20261113-035659-01: the crafted acid / lure grenades (items/grenades.ts; bench only, never loot) — appended last
  ...FLAMETHROWER_ITEMS, // task studio-flamethrower-fire-20261114-031614-01: the flamethrower (items/flamethrowerItems.ts; bench / Market only, never loot) — appended after them
};

export function itemDef(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export function isFoodOrDrink(def: ItemDef): boolean {
  return def.verb === 'eat' || def.verb === 'drink';
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

/** "+35 water", "+14 food · −4 water", "+20 health". */
export function effectText(def: ItemDef): string {
  const out: string[] = [];
  if (def.heal) out.push(`${signed(def.heal)} health`);
  if (def.hunger) out.push(`${signed(def.hunger)} food`);
  if (def.thirst) out.push(`${signed(def.thirst)} water`);
  if (def.recharge) out.push(`flashlight battery ${Math.round(def.recharge * 100)} %`); // Iteration 12 (LIGHT)
  if (def.treats?.length) out.push(`treats ${def.treats.length > 1 ? `${treatsText(def.treats)} injuries` : `a ${treatsText(def.treats)} injury`}`); // Iteration 16 (lane INJURY)
  if (isBeer(def.id)) out.push(beerEffectText(def.id)); // task studio-market-bar-20261108-225231-01 (lane BEER): the effect and its duration
  return out.join(' · ');
}

/** Iteration 12 (LIGHT): weapon-panel hint while a throwable (flare) is held. */
export function throwHint(def: ItemDef): string {
  const what = isGrenadeItem(def.id) ? `the ${def.short.toLowerCase()} grenade` : def.short.toLowerCase(); // (a crafted grenade: "ready the acid grenade")
  return `Hold click or G to ready ${what} · release to throw`; // Iteration 15: grenade-style; INTERACT (#6): G (was T)
}

/** Weapon-panel hint while a consumable is held. */
export function useHint(def: ItemDef): string {
  const verb = def.verb === 'eat' ? 'eat' : def.verb === 'drink' ? 'drink' : 'use';
  const fx = effectText(def);
  return `Click to ${verb}${fx ? ` · ${fx}` : ''}`;
}

/** Use-bar label: "Drinking water…", "Eating chips…", "Using bandage…". */
export function useLabel(def: ItemDef): string {
  const verb = def.verb === 'eat' ? 'Eating' : def.verb === 'drink' ? 'Drinking' : 'Using';
  if (def.treats?.length) return `Applying ${def.short.toLowerCase()}…`; // Iteration 16 (lane INJURY): limb treatment
  return `${verb} ${def.short.toLowerCase()}…`;
}

/** Inventory button label for a consumable. */
export function useButtonLabel(def: ItemDef | null): string {
  return def?.verb === 'eat' ? 'Eat' : def?.verb === 'drink' ? 'Drink' : 'Use';
}

// ---------------------------------------------------------------------------------------
// Physical sizes (meters) of loot items for shelf/container placement and world models.
// Local frame: origin bottom-centre, front +Z; w = X, d = Z, h = Y as the item normally rests.
// Food/drink values are the iteration-03 provisional runtime dims (lane contract); the primary
// reconciles them with the measured generated models. `shape` decides how an item lies down
// when a slot is too low or it was tipped over (cylinders roll onto their side; bags/cartons
// lie on their back; flat items always rest flat).

export type ItemShape = 'cylinder' | 'box' | 'flat';
export interface ItemDims { w: number; d: number; h: number; shape: ItemShape }

export const ITEM_DIMS: Record<string, ItemDims> = {
  water: {w: 0.07, d: 0.07, h: 0.23, shape: 'cylinder'},
  cola: {w: 0.066, d: 0.066, h: 0.122, shape: 'cylinder'},
  juice: {w: 0.07, d: 0.07, h: 0.195, shape: 'box'},
  chocolate: {w: 0.16, d: 0.08, h: 0.02, shape: 'flat'},
  chips: {w: 0.2, d: 0.08, h: 0.27, shape: 'box'},
  beans: {w: 0.075, d: 0.075, h: 0.11, shape: 'cylinder'},
  noodles: {w: 0.095, d: 0.095, h: 0.105, shape: 'cylinder'},
  // lane FURN (office-props-physics-scale-20261030): the measured runtime bounds of item-bread-t25.glb (assets/companyDims.generated.ts
  // COMPANY_PART_DIMS.bread, so fitItemModel keeps it at scale 1): a round loaf, always resting on its base
  bread: {w: 0.26, d: 0.2231, h: 0.0919, shape: 'flat'},
  ...SKYWAYS_FOOD_DIMS, // task studio-skyways-level-20261106-054448 (lane FOOD): the item models' real bounds (assets/skywaysFoodModels.ts)
  ...PANTRY_DIMS, // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): the cooked models' bounds, else the vision board's real size
  // Lane AMMO (knife-melee-20261030): the measured runtime bounds of the Meshy T2.5 ammo boxes (assets/manifest.ts item_ammo_*;
  // derivatives/meshy-t25-ammo-20261030.json), so fitItemModel keeps them at scale 1. They stand upright ('flat': never laid down)
  // and are all < 0.176 m tall: they fit the 0.18 m desk-drawer / low-cupboard clearance (items/lootLayout.ts).
  ammo_9mm: {w: 0.1126, d: 0.13, h: 0.1326, shape: 'flat'},   // 9mm carton, printed end to the front, lid flap open
  ammo_556: {w: 0.1645, d: 0.0762, h: 0.175, shape: 'flat'},  // 5.56 steel can incl. its folded handle
  ammo_12ga: {w: 0.13, d: 0.123, h: 0.1566, shape: 'flat'},   // 12-gauge carton, open top, flap up at the back
  // Legacy procedural supplies (world/pickups.ts makeSupplyMesh).
  medkit: {w: 0.32, d: 0.22, h: 0.14, shape: 'flat'},
  bandage: {w: 0.1, d: 0.094, h: 0.092, shape: 'flat'},
  // Iteration 12 (LIGHT): authored models (world/authoredItems.ts): a D cell standing upright, a capped road flare lying along X.
  battery: {w: 0.0346, d: 0.0346, h: 0.0615, shape: 'cylinder'},
  flare: {w: 0.255, d: 0.033, h: 0.033, shape: 'flat'},
  // mask lane: the authored filter canister (world/authoredItems.ts FILTER_DIMS) standing on its base, thread up
  gas_filter: {w: 0.096, d: 0.096, h: 0.072, shape: 'cylinder'},
  fuel_can: {w: 0.2015, d: 0.105, h: 0.30, shape: 'box'}, // a ~5 l can standing upright, med-kit sized (user feedback, task fuel-feedback: assets/models/train-fuel-can.glb bounds)
  // Iteration 16: gear / limb-treatment items (lanes GEAR / INJURY)
  ...GEAR_DIMS,
  ...MEDICAL_DIMS,
  ...MATERIAL_DIMS, // lane RACK (office-props-physics-scale-20261030): authored models (world/materialItems.ts)
  // task reactor-build-20261101 (lane RESTART): the Meshy kit models' runtime bounds (assets/reactorKit.generated.ts REACTOR_KIT.reactorKey
  // / .fuseCartridge, so they stay at scale 1; world/reactor/restartItems.ts): the key lying flat, the ceramic cartridge along X
  reactor_key: {w: 0.13, d: 0.0573, h: 0.0073, shape: 'flat'},
  fuse_cartridge: {w: 0.3, d: 0.062, h: 0.0623, shape: 'flat'},
  ...RAIL_TIES_DIMS, // task studio-market-rework-20261108-074144-01 (lane TRADE): the code-built tie bundle (world/railTiesModel.ts)
  ...BEER_DIMS, // task studio-market-bar-20261108-225231-01: the beer bottles
  ...GRENADE_DIMS, // task studio-refinement-batch-20261113-035659-01: the cooked acid / lure canisters' bounds (assets/grenades.generated.ts)
  ...FLAMETHROWER_DIMS, // task studio-flamethrower-fire-20261114-031614-01
};

export function itemDims(id: string): ItemDims {
  return ITEM_DIMS[id] ?? {w: 0.2, d: 0.2, h: 0.2, shape: 'flat'};
}
