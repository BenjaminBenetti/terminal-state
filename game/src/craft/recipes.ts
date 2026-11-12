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
  /** What it does, in ONE short plain sentence (the recipe list's only line of text under the name). */
  readonly blurb: string;
}

const recipe = (kind: EquipmentKind, scrap: number, elec: number, blurb: string): Recipe =>
  Object.freeze({kind, cost: Object.freeze({[SCRAP_METAL]: scrap, [ELECTRICAL_PARTS]: elec} as Record<RecipeMaterial, number>), blurb});

export const RECIPES: readonly Recipe[] = Object.freeze([
  // (task train-interaction-ux-20261112-063646, lane CRAFT-UI: one short sentence each — the costs, kinds and what the units do are unchanged)
  recipe('chest', 2, 0, 'A 50-slot chest you can carry and put down anywhere.'),
  recipe('radar', 4, 3, 'Plugged in, the network map shows stations two stops away.'),
  recipe('sentry', 8, 6, 'Plugged in and loaded with 5.56mm rounds, its roof turret shoots enemies near the train.'),
  recipe('scanner', 5, 5, 'Plugged in, its scope shows enemies and items around the train.'),
]);

export const recipeFor = (kind: EquipmentKind): Recipe | null => RECIPES.find(r => r.kind === kind) ?? null;
