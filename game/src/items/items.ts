// Item catalogue. Weapons reference WEAPONS by id; everything else is ammo or a consumable.
// Consumables restore health (medical) or food/water (player/survival.ts); values are tuned so a
// short slice never forces eating, but each item visibly moves its bar.

// Iteration 12 (LIGHT): 'throwable' = the grenade slot (the road flare: T throws it, or left click while it is held).
// Iteration 16: 'gear' = character gear worn in a gear slot (items/gear.ts; lane GEAR).
export type ItemKind = 'weapon' | 'ammo' | 'consumable' | 'throwable' | 'gear';

/** Key into the HUD icon set (ui/icons.ts). */
export type IconKey =
  | 'rifle' | 'shotgun' | 'pistol' | 'rounds' | 'rounds9' | 'shells' | 'medkit' | 'bandage'
  | 'water' | 'cola' | 'juice' | 'chocolate' | 'chips' | 'beans' | 'noodles'
  | 'battery' | 'flare'
  | GearIconKey | MedicalIconKey; // Iteration 16 (lanes GEAR / INJURY)

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
}

import {GEAR_DIMS, GEAR_ITEMS, type GearIconKey, type GearSpec} from './gear';
import {MEDICAL_DIMS, MEDICAL_ITEMS, treatsText, type Limb, type MedicalIconKey} from './medical';

export const FOOD_IDS = ['chocolate', 'chips', 'beans', 'noodles'] as const;
export const DRINK_IDS = ['water', 'cola', 'juice'] as const;

export const ITEMS: Record<string, ItemDef> = {
  rifle: {id: 'rifle', name: 'Rifle — "Kept running"', short: 'Rifle', kind: 'weapon', stackMax: 1, weaponId: 'rifle', icon: 'rifle',
    description: 'Adapted automatic rifle with a battered optic. 30-round magazine.'},
  shotgun: {id: 'shotgun', name: 'Shotgun — "Old reliable"', short: 'Shotgun', kind: 'weapon', stackMax: 1, weaponId: 'shotgun', icon: 'shotgun',
    description: 'Pump shotgun with a repaired stock. Loads shell by shell; devastating up close.'},
  pistol: {id: 'pistol', name: 'Pistol — "Service sidearm"', short: 'Pistol', kind: 'weapon', stackMax: 1, weaponId: 'pistol', icon: 'pistol',
    description: 'Semi-automatic 9 mm service pistol. 15-round magazine; quick to raise and reload.'},
  ammo_rifle: {id: 'ammo_rifle', name: 'Rifle rounds', short: 'Rounds', kind: 'ammo', stackMax: 120, icon: 'rounds',
    description: 'Loose rifle cartridges. Used when reloading the rifle.'},
  ammo_pistol: {id: 'ammo_pistol', name: '9 mm rounds', short: '9 mm', kind: 'ammo', stackMax: 120, icon: 'rounds9',
    description: 'Loose 9 mm pistol cartridges. Used when reloading the pistol.'},
  ammo_shells: {id: 'ammo_shells', name: '12-gauge shells', short: 'Shells', kind: 'ammo', stackMax: 32, icon: 'shells',
    description: 'Buckshot shells for the shotgun.'},
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
  // --- Iteration 12 (LIGHT): light survival (authored models: world/authoredItems.ts) ---
  battery: {id: 'battery', name: 'D-cell battery', short: 'Battery', kind: 'consumable', stackMax: 4, recharge: 1, useTime: 1.4, verb: 'use', icon: 'battery',
    description: 'Unbranded 1.5 V D cell, scuffed but holding charge. Swap it into the flashlight to refill it to 100 %.'},
  flare: {id: 'flare', name: 'Road flare', short: 'Flare', kind: 'throwable', stackMax: 3, icon: 'flare',
    description: 'Red highway flare. T strikes and throws one (or left click while it is held): about 50 s of red light and smoke. Light draws the infected.'},
  // --- Iteration 16: character gear (lane GEAR, items/gear.ts) and limb-treatment items (lane INJURY, items/medical.ts) ---
  ...GEAR_ITEMS,
  ...MEDICAL_ITEMS,
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
  return out.join(' · ');
}

/** Iteration 12 (LIGHT): weapon-panel hint while a throwable (flare) is held. */
export function throwHint(def: ItemDef): string {
  return `Hold click or T to ready ${def.short.toLowerCase()} · release to throw`; // Iteration 15: grenade-style
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
  // Legacy procedural supplies (world/pickups.ts makeSupplyMesh).
  ammo_rifle: {w: 0.28, d: 0.16, h: 0.12, shape: 'flat'},
  ammo_shells: {w: 0.2, d: 0.2, h: 0.1, shape: 'flat'},
  ammo_pistol: {w: 0.16, d: 0.11, h: 0.08, shape: 'flat'},
  medkit: {w: 0.32, d: 0.22, h: 0.14, shape: 'flat'},
  bandage: {w: 0.1, d: 0.094, h: 0.092, shape: 'flat'},
  // Iteration 12 (LIGHT): authored models (world/authoredItems.ts): a D cell standing upright, a capped road flare lying along X.
  battery: {w: 0.0346, d: 0.0346, h: 0.0615, shape: 'cylinder'},
  flare: {w: 0.255, d: 0.033, h: 0.033, shape: 'flat'},
  // Iteration 16: gear / limb-treatment items (lanes GEAR / INJURY)
  ...GEAR_DIMS,
  ...MEDICAL_DIMS,
};

export function itemDims(id: string): ItemDims {
  return ITEM_DIMS[id] ?? {w: 0.2, d: 0.2, h: 0.2, shape: 'flat'};
}
