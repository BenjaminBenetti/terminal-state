// Task office-props-physics-scale-20261030 (lane RACK): CRAFTING MATERIALS — collectible salvage for a FUTURE crafting system.
// User (2026-10-30): "Perhaps this is where we introduce some materials, perhaps the most common spawn items here will bee
// "electrical parts". As well as "scrap metal" these will be used later in crafting." and (lab benches) "Include new resource
// hear. "Bio mater" for the player to collect."
//
// Item kind 'material' (items/items.ts): PASSIVE stock — never used, equipped, worn, held as a weapon or thrown; nothing consumes
// it yet (there are no recipes, no crafting UI and no currency in this pass). Materials stack in the pockets first (like ammo),
// ride in bags / ground bags and carry over between levels like any stack. Descriptions say so honestly.
//
// Loot (items/lootTables.ts): economy category 'material' — finite, themed rows in the holders they fit (server racks and server
// cupboards: electrical parts first, some scrap metal; lab storage: bio mater, lane FURN); kept exactly as rolled by the scarcity
// economy (like ammo: the row weights ARE the numbers) and never an off-theme re-pick anywhere else.
// Models (world/materialItems.ts): authored procedural geometry, no generation. Dims: metres, origin bottom-centre, front +Z, as
// the item normally rests (items/items.ts ITEM_DIMS).
//
// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): crafting exists now — Scrap metal and Electrical parts are what the
// recipes of the train's crafting bench cost (craft/recipes.ts RECIPE_MATERIALS; world/craftBench.ts), so their descriptions and detail
// line say "used at the train's crafting bench". Bio mater has NO recipe yet: its text says exactly that (materialNote). The items
// themselves are unchanged (still passive stacks: never used by hand; no loot row, weight or roll moved). tests/craft-materials.test.ts
// keeps the texts and the recipe list in step.
import type {ItemDef, ItemDims} from './items';

/** Icon keys of the materials (ui/materialIcons.ts). */
export type MaterialIconKey = 'electrical' | 'scrap' | 'biomater';

/** Stable item ids. `bio_mater` / "Bio mater" is the user's quoted label, kept exactly (may be meant as "Bio matter"). */
export const ELECTRICAL_PARTS = 'electrical_parts';
export const SCRAP_METAL = 'scrap_metal';
export const BIO_MATER = 'bio_mater';
export const MATERIAL_IDS = [ELECTRICAL_PARTS, SCRAP_METAL, BIO_MATER] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];
export const isMaterialItem = (id: string): id is MaterialId => (MATERIAL_IDS as readonly string[]).includes(id);

/** The detail line (inventoryUI, the item tooltip) of a material a recipe uses: nothing to use by hand — it is spent at the bench. */
export const MATERIAL_NOTE = 'Crafting material — nothing to use by hand: used at the train\'s crafting bench';
/** ... and of a material no recipe uses yet. */
export const MATERIAL_NOTE_NO_RECIPE = 'Crafting material — nothing to use by hand, and no recipe uses it yet';
/** The materials without a recipe (the rest are spent at the train's crafting bench; tests check this against craft/recipes.ts). */
const NO_RECIPE: readonly string[] = [BIO_MATER];
/** A material's detail line. */
export const materialNote = (id: string): string => (NO_RECIPE.includes(id) ? MATERIAL_NOTE_NO_RECIPE : MATERIAL_NOTE);

export const MATERIAL_ITEMS: Record<string, ItemDef> = {
  [ELECTRICAL_PARTS]: {id: ELECTRICAL_PARTS, name: 'Electrical parts', short: 'Elec. parts', kind: 'material', stackMax: 20, icon: 'electrical',
    description: 'A salvaged circuit board, a few relays and connectors and a coil of copper wire, pulled from dead equipment. Nothing to use by hand: a crafting material, used at the train\'s crafting bench.'},
  [SCRAP_METAL]: {id: SCRAP_METAL, name: 'Scrap metal', short: 'Scrap', kind: 'material', stackMax: 20, icon: 'scrap',
    description: 'Bent steel brackets, a plate offcut and a length of rack rail. Heavy for its size. Nothing to use by hand: a crafting material, used at the train\'s crafting bench.'},
  [BIO_MATER]: {id: BIO_MATER, name: 'Bio mater', short: 'Bio mater', kind: 'material', stackMax: 10, icon: 'biomater',
    description: 'A sealed lab specimen jar of organic culture. Not food and not medicine — keep it closed. Nothing to use by hand: a crafting material, but no recipe uses it yet.'},
};

export const MATERIAL_DIMS: Record<string, ItemDims> = {
  // a salvaged circuit board with two loops of wire, a relay and chips on it, lying flat (world/materialItems.ts measured bounds)
  [ELECTRICAL_PARTS]: {w: 0.13, d: 0.085, h: 0.02, shape: 'flat'},
  // a cut length of rack rail, a bent L-bracket and a plate offcut leaning on them, lying flat
  [SCRAP_METAL]: {w: 0.212, d: 0.114, h: 0.036, shape: 'flat'},
  // a screw-lid specimen jar standing upright
  [BIO_MATER]: {w: 0.075, d: 0.075, h: 0.1, shape: 'cylinder'},
};
