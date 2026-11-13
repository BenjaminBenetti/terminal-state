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
//
// Task studio-refinement-batch-20261113-035659-01 (user: "Acid Scrapper Grenade: 3 bio_mater crafts 5 ... Zombie Lure Grenade:
// 3 bio_mater crafts 3 ... Train plating/blades: permanent ONE-TIME 10-scrap_metal upgrade"): the bench also MAKES things that are not
// equipment units — MADE_RECIPES, listed after the units (BENCH_RECIPES is the bench's whole list):
//
//   output                         Scrap / Elec / Bio mater
//   5 x Acid Scrapper grenade        0 / 0 / 3     into your pockets (the grenade slot first), the rest into the Lockbox
//   3 x Zombie Lure grenade          0 / 0 / 3     the same
//   Train armor (plating + blades)  10 / 0 / 0     fitted to the train for good, once (world/trainArmor.ts); no durability
//
// Bio mater is a recipe material now (RECIPE_MATERIALS; items/craftMaterials.ts says so). The four unit recipes keep their costs, kinds
// and order (RECIPES: their bio mater cost is 0).

import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL} from '../items/craftMaterials';
import {ACID_GRENADE, LURE_GRENADE, type GrenadeId} from '../items/grenades';
import type {EquipmentKind} from './equipment';

/** The materials a recipe may cost, in the order they are listed. */
export const RECIPE_MATERIALS = [SCRAP_METAL, ELECTRICAL_PARTS, BIO_MATER] as const;
export type RecipeMaterial = (typeof RECIPE_MATERIALS)[number];

/** A permanent train upgrade the bench fits (world/trainArmor.ts TrainUpgradeId). */
export type UpgradeId = 'armor';

export interface Recipe {
  /** The unit it makes (craft/equipment.ts EQUIPMENT[kind]: its name). */
  readonly kind: EquipmentKind;
  /** Units of each material (0: none). */
  readonly cost: Readonly<Record<RecipeMaterial, number>>;
  /** What it does, in ONE short plain sentence (the recipe list's only line of text under the name). */
  readonly blurb: string;
}

const costOf = (scrap: number, elec: number, bio: number): Readonly<Record<RecipeMaterial, number>> =>
  Object.freeze({[SCRAP_METAL]: scrap, [ELECTRICAL_PARTS]: elec, [BIO_MATER]: bio} as Record<RecipeMaterial, number>);

const recipe = (kind: EquipmentKind, scrap: number, elec: number, blurb: string): Recipe => Object.freeze({kind, cost: costOf(scrap, elec, 0), blurb});

export const RECIPES: readonly Recipe[] = Object.freeze([
  // (task train-interaction-ux-20261112-063646, lane CRAFT-UI: one short sentence each — the costs, kinds and what the units do are unchanged)
  recipe('chest', 2, 0, 'A 50-slot chest you can carry and put down anywhere.'),
  recipe('radar', 4, 3, 'Plugged in, the network map shows stations two stops away.'),
  recipe('sentry', 8, 6, 'Plugged in and loaded with 5.56mm rounds, its roof turret shoots enemies near the train.'),
  recipe('scanner', 5, 5, 'Plugged in, its scope shows enemies and items around the train.'),
]);

export const recipeFor = (kind: EquipmentKind): Recipe | null => RECIPES.find(r => r.kind === kind) ?? null;

/** What a made recipe gives: a batch of an item (into the inventory, then the Lockbox) or a permanent train upgrade. */
export type MadeOutput =
  | {readonly type: 'item'; readonly itemId: GrenadeId; readonly count: number}
  | {readonly type: 'upgrade'; readonly id: UpgradeId};

/** A recipe whose output is not an equipment unit (task studio-refinement-batch-20261113-035659-01). */
export interface MadeRecipe {
  /** The row id: the item id, or the upgrade id. */
  readonly kind: GrenadeId | UpgradeId;
  readonly make: MadeOutput;
  /** The row's name (the item's name x the batch; the upgrade's name). */
  readonly name: string;
  readonly cost: Readonly<Record<RecipeMaterial, number>>;
  readonly blurb: string;
}

export const MADE_RECIPES: readonly MadeRecipe[] = Object.freeze([
  Object.freeze({kind: ACID_GRENADE, make: Object.freeze({type: 'item', itemId: ACID_GRENADE, count: 5}), name: 'Acid Scrapper grenade ×5', cost: costOf(0, 0, 3),
    blurb: 'Five throwable canisters: the acid sticks, melts props down to salvage and burns whoever stands in it.'}),
  Object.freeze({kind: LURE_GRENADE, make: Object.freeze({type: 'item', itemId: LURE_GRENADE, count: 3}), name: 'Zombie Lure grenade ×3', cost: costOf(0, 0, 3),
    blurb: 'Three scent canisters: for 20 s the infected within 20 m go to the canister, not to you (one that sees you still comes).'}),
  Object.freeze({kind: 'armor', make: Object.freeze({type: 'upgrade', id: 'armor'}), name: 'Train armor', cost: costOf(10, 0, 0),
    blurb: 'Fits steel plating and blades all round the train for good: zombies pressed against it are cut down.'}),
] as MadeRecipe[]);

/** Every row of the bench, in its order: the four units, then the made things. */
export type BenchRecipe = Recipe | MadeRecipe;
export type BenchKind = BenchRecipe['kind'];
export const BENCH_RECIPES: readonly BenchRecipe[] = Object.freeze([...RECIPES, ...MADE_RECIPES]);

export const isMadeRecipe = (r: BenchRecipe): r is MadeRecipe => 'make' in r;
export const benchRecipeFor = (kind: string | null | undefined): BenchRecipe | null => BENCH_RECIPES.find(r => r.kind === kind) ?? null;
export const isBenchKind = (kind: string | null | undefined): kind is BenchKind => !!benchRecipeFor(kind);
