// Task studio-train-crafting-v1-20261111-225628-01: THE RECIPES of the train's crafting bench — the approved costs in the two salvage
// materials that already exist (items/craftMaterials.ts; their supply is unchanged: no loot table row, weight or roll moves for this).
// Pure data. The bench (world/craftBench.ts) lists them in this order; craft/crafting.ts plans and applies the atomic debit; the output
// is a real physical unit (craft/equipment.ts), never a UI-only unlock.
//
//   output            Scrap metal / Electrical parts
//   Storage chest      2 / 0     the Lockbox's 50 slots again; carried, put down and picked up freely; needs no plug
//   Route radar        4 / 3     plugged in: the network map shows two stops out instead of one
//   Defense sentry     8 / 6     plugged in + loaded with real 5.56 mm rounds: the roof turret shoots zombies it can see; crafted EMPTY
//   Item scanner       5 / 5     plugged in: a 360° scope, ~100 m, a sweep about every 30 active seconds

import {ELECTRICAL_PARTS, SCRAP_METAL} from '../items/craftMaterials';
import type {EquipmentKind} from './equipment';

/** The materials a recipe may cost, in the order they are listed. */
export const RECIPE_MATERIALS = [SCRAP_METAL, ELECTRICAL_PARTS] as const;
export type RecipeMaterial = (typeof RECIPE_MATERIALS)[number];

export interface Recipe {
  /** The unit it makes (craft/equipment.ts EQUIPMENT[kind]: its name). */
  readonly kind: EquipmentKind;
  /** Units of each material (0: none). */
  readonly cost: Readonly<Record<RecipeMaterial, number>>;
  /** What it does, in a sentence or two (the recipe list). */
  readonly blurb: string;
}

const recipe = (kind: EquipmentKind, scrap: number, elec: number, blurb: string): Recipe =>
  Object.freeze({kind, cost: Object.freeze({[SCRAP_METAL]: scrap, [ELECTRICAL_PARTS]: elec} as Record<RecipeMaterial, number>), blurb});

export const RECIPES: readonly Recipe[] = Object.freeze([
  recipe('chest', 2, 0, 'A second chest with the same 50 slots as the Lockbox. Carry it anywhere, put it down and pick it up again with everything in it. Needs no plug.'),
  recipe('radar', 4, 3, 'A radar set on a hand truck. While it is plugged into the train, the network map shows stations two stops away instead of one.'),
  recipe('sentry', 8, 6, 'A fire-control console on a hand truck. Plugged in and loaded with 5.56mm rounds, a turret on the roof shoots the zombies it can see near the train. Built empty: it fires only the rounds you load.'),
  recipe('scanner', 5, 5, 'A scope console on a hand truck. While it is plugged in, it sweeps about 100 m around the train every 30 seconds: enemies red, items green, weapons and gear gold.'),
]);

export const recipeFor = (kind: EquipmentKind): Recipe | null => RECIPES.find(r => r.kind === kind) ?? null;
