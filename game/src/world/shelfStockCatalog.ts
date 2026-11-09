// Iteration 08 (Lane S): the FILLER STOCK catalogue — honestly authored, simple 3D packaging that
// replaces the old product-picture facades on shop shelving (world/shelfStock.ts renders it,
// physics/fillerStock.ts makes every piece a rigid body on demand). Pure data, no three.js.
//
// Filler is environmental dressing, NOT loot: it is never pickable, never highlighted, never in an
// inventory (real loot lots keep their own models, glow and finite ids; items/loot.ts). Sizes are
// real-world metres (upright pose: w = X across the facing, h = Y, d = Z depth; cylinders w = d =
// diameter). Labels are fictional canvas-drawn designs (world/shelfStockGeometry.ts label atlas):
// no real brands, logos or photos. Masses / contact materials are plausible per packaging.

import type {ImpactFamily} from '../physics/chunks';
import type {PhysMat} from '../damage/materials';
import type {DamageClass} from '../damage/materials';
import {JUNK_PROPS, junkArchId, junkDims} from './shelfJunkModels'; // task food-shelf-production (lane SHELF): the 27 modelled ruined props

/** Geometry recipe of an archetype (world/shelfStockGeometry.ts builds each one, low-poly). */
export type StockShape =
  | 'can' | 'tin' | 'bottle' | 'jar' | 'cup' | 'gable' | 'box' | 'pillow' | 'spray' | 'jug' | 'pills'
  | 'paint' | 'reel' | 'thin' | 'bunch' | 'plant' | 'loaf' | 'rolls' | 'blister' | 'key' | 'ball'
  // Iteration 12 (LOOT lane): abandoned-station filler — open / crushed cartons, crumpled trash, deflated torn bags, crushed cans,
  // broken bottles.
  | 'openbox' | 'crushed' | 'crumple' | 'flatbag' | 'crushcan' | 'shard';

/** Label family drawn into the atlas (each with `variants` designs). 'none' = vertex colours only. */
export type LabelKind =
  | 'soda' | 'energy' | 'tin' | 'bottle' | 'bigbottle' | 'jar' | 'cup' | 'carton' | 'cereal' | 'pantry' | 'candy'
  | 'chips' | 'snack' | 'towels' | 'rolls' | 'med' | 'pills' | 'lotion' | 'spray' | 'jug' | 'phone' | 'tablet'
  | 'blister' | 'gadget' | 'cartonbox' | 'paint' | 'tubes' | 'reel' | 'magazine' | 'news' | 'loaf' | 'donuts'
  // Iteration 12 (LOOT lane): crumpled printed scraps, a rusted tin's peeling label, an empty bottle's torn sleeve.
  | 'trash' | 'rusttin' | 'oldbottle' | 'none';

/**
 * Iteration 12 (LOOT lane): how a filler piece reads after ~30 years without upkeep (user: "most shelf items should be boxes, or
 * trash or broken. So the good items the player is looking for stand out"; "the 'no interactable' items should appear time worn
 * and tarnished"). 'box' cardboard cartons (closed / open / crushed); 'trash' wrappers, torn bags, crushed cans, empty and broken
 * bottles; 'spoiled' rotten fruit, mouldy bread / jars, rusted tins, dead flowers; 'aged' faded / tarnished non-food goods
 * (cleaning, devices, parts, magazines, key blanks); 'intact' an unopened food / drink / medicine package — only a small minority,
 * and even those carry the aged atlas print (faded, stained) so none reads like a fresh usable find.
 */
export type StockLook = 'box' | 'trash' | 'spoiled' | 'aged' | 'intact';

export interface StockArch {
  id: string;
  shape: StockShape;
  /** Upright extents (m). */
  w: number; h: number; d: number;
  label: LabelKind;
  /** Label designs (atlas cells) — 'none': colourways. */
  variants: number;
  /** Rigid-body collider (physics/fillerStock.ts): upright cylinder (radius w/2), sphere (radius w/2) or box (scaled by `fit`). */
  collider: 'box' | 'cylinder' | 'sphere';
  /** Collider extents as a fraction of the visual box (pillow bags are not full boxes). */
  fit?: [number, number, number];
  /** Mass (kg) of one full package. */
  mass: number;
  /** Contact family vs the station (damage/materials.ts PHYS_MATS). */
  mat: PhysMat;
  /** Impact sound family (audio/sfx.ts physImpact, existing bank only). */
  fam: ImpactFamily;
  /** Damage class of a pellet hit (sound + puff; nothing is destroyed). */
  hit: DamageClass;
  /** Most copies stacked in one facing (shelved). */
  stack: number;
  /** Most rows deep in one facing. */
  depth: number;
  /** Facings of one product placed side by side [min, max]. */
  facings: [number, number];
  /** Iteration 12 (LOOT lane): what the piece reads as (aged / boxed / trash classes vs the few intact packages). */
  look: StockLook;
  /**
   * Task food-shelf-production (lane SHELF): a MODEL-BACKED archetype — the ruined-prop id (P01..P27, world/shelfJunkModels.ts) whose
   * mesh node in the shared atlas GLB draws it; `shape` / `label` are its procedural fallback (drawn at the same box until the atlas
   * is loaded). Absent: an authored procedural archetype.
   */
  model?: string;
  /** Heavy bulk goods: only on a holder's bottom deck (world/shelfStockLayout.ts LOW_DECK_Y). */
  low?: boolean;
  /** Model-backed: the authored archetype standing in for it when the station's triangle budget lowers the model share. */
  standIn?: string;
  /** Model-backed: the cooked (upright) part lies on its back here (its template turned face up; world/shelfJunkModels.ts). */
  layFlat?: boolean;
}

const A = (id: string, shape: StockShape, w: number, h: number, d: number, label: LabelKind, variants: number,
  phys: {collider: 'box' | 'cylinder' | 'sphere'; mass: number; mat: PhysMat; fam: ImpactFamily; hit: DamageClass; fit?: [number, number, number]},
  shelf: {stack?: number; depth?: number; facings?: [number, number]} = {}, look: StockLook = 'intact'): StockArch =>
  ({id, shape, w, h, d, label, variants, ...phys, stack: shelf.stack ?? 1, depth: shelf.depth ?? 3, facings: shelf.facings ?? [1, 3], look});

const CAN = {collider: 'cylinder', mass: 0.37, mat: 'metal', fam: 'can', hit: 'sheetMetal'} as const;
const PAPER = (mass: number) => ({collider: 'box', mass, mat: 'soft', fam: 'light', hit: 'cardboard'} as const);
const PLASTIC = (mass: number, collider: 'box' | 'cylinder' = 'cylinder') => ({collider, mass, mat: 'plastic', fam: 'light', hit: 'plastic'} as const);

/** Every filler archetype (index = archetype id used by placements / render / physics). New archetypes are APPENDED (ids stable). */
export const STOCK_ARCHES: readonly StockArch[] = [
  // --- drinks -----------------------------------------------------------------------------
  A('soda', 'can', 0.066, 0.122, 0.066, 'soda', 4, CAN, {stack: 2, depth: 3, facings: [2, 4]}),
  A('energy', 'can', 0.058, 0.168, 0.058, 'energy', 3, {...CAN, mass: 0.52}, {depth: 3, facings: [2, 3]}),
  A('bottle', 'bottle', 0.066, 0.215, 0.066, 'bottle', 5, PLASTIC(0.53), {depth: 3, facings: [2, 4]}),
  A('bigbottle', 'bottle', 0.105, 0.31, 0.105, 'bigbottle', 3, PLASTIC(2.1), {depth: 2, facings: [1, 3]}),
  A('carton1l', 'gable', 0.07, 0.2, 0.07, 'carton', 3, PAPER(1.0), {depth: 3, facings: [2, 3]}),
  // --- grocery ----------------------------------------------------------------------------
  A('tin', 'tin', 0.075, 0.105, 0.075, 'tin', 5, {...CAN, mass: 0.42}, {stack: 3, depth: 3, facings: [2, 4]}),
  // iteration 12: every jar's contents have long since gone mouldy (murky grey-green fill)
  A('jar', 'jar', 0.078, 0.112, 0.078, 'jar', 4, {collider: 'cylinder', mass: 0.45, mat: 'glass', fam: 'glass', hit: 'glass'}, {stack: 2, depth: 3, facings: [2, 4]}, 'spoiled'),
  A('cup', 'cup', 0.095, 0.105, 0.095, 'cup', 3, {collider: 'cylinder', mass: 0.09, mat: 'soft', fam: 'light', hit: 'food'}, {stack: 3, depth: 3, facings: [1, 3]}),
  A('cereal', 'box', 0.19, 0.28, 0.065, 'cereal', 4, PAPER(0.45), {depth: 3, facings: [1, 3]}),
  A('pantry', 'box', 0.15, 0.2, 0.055, 'pantry', 4, PAPER(0.3), {stack: 2, depth: 3, facings: [1, 3]}),
  A('towels', 'rolls', 0.24, 0.26, 0.12, 'towels', 2, PAPER(0.45), {depth: 2, facings: [1, 2]}, 'aged'),
  // --- snacks -----------------------------------------------------------------------------
  A('candy', 'box', 0.12, 0.065, 0.09, 'candy', 4, {...PAPER(0.22), hit: 'food'}, {stack: 3, depth: 2, facings: [1, 3]}),
  A('chips', 'pillow', 0.2, 0.27, 0.075, 'chips', 4, {...PAPER(0.07), hit: 'food', fit: [0.9, 0.9, 0.7]}, {depth: 3, facings: [1, 3]}),
  A('snack', 'pillow', 0.13, 0.18, 0.045, 'snack', 4, {...PAPER(0.05), hit: 'food', fit: [0.9, 0.9, 0.7]}, {stack: 1, depth: 3, facings: [2, 4]}),
  // --- pharmacy ---------------------------------------------------------------------------
  A('medbox', 'box', 0.09, 0.13, 0.035, 'med', 5, PAPER(0.06), {stack: 2, depth: 2, facings: [2, 4]}),
  A('pills', 'pills', 0.046, 0.095, 0.046, 'pills', 3, PLASTIC(0.08), {stack: 1, depth: 2, facings: [2, 5]}),
  A('lotion', 'box', 0.065, 0.18, 0.042, 'lotion', 3, PLASTIC(0.3, 'box'), {depth: 3, facings: [2, 4]}),
  // --- cleaning / household ---------------------------------------------------------------
  A('spray', 'spray', 0.095, 0.28, 0.06, 'spray', 3, PLASTIC(0.65, 'box'), {depth: 2, facings: [2, 4]}, 'aged'),
  A('jug', 'jug', 0.15, 0.29, 0.1, 'jug', 3, {...PLASTIC(2.2, 'box')}, {depth: 2, facings: [1, 3]}, 'aged'),
  A('rolls', 'rolls', 0.33, 0.22, 0.22, 'rolls', 2, PAPER(1.1), {depth: 1, facings: [1, 2]}, 'aged'),
  // --- devices ----------------------------------------------------------------------------
  A('phonebox', 'box', 0.09, 0.17, 0.045, 'phone', 4, PAPER(0.35), {depth: 3, facings: [2, 4]}, 'aged'),
  A('tabletbox', 'box', 0.21, 0.28, 0.05, 'tablet', 2, PAPER(0.8), {depth: 2, facings: [1, 2]}, 'aged'),
  A('blister', 'blister', 0.11, 0.18, 0.03, 'blister', 4, {...PLASTIC(0.08, 'box')}, {depth: 3, facings: [2, 4]}, 'aged'),
  A('gadget', 'box', 0.14, 0.1, 0.1, 'gadget', 3, PAPER(0.4), {stack: 2, depth: 2, facings: [1, 3]}, 'aged'),
  // --- parts / back stock -----------------------------------------------------------------
  A('cartonS', 'box', 0.32, 0.24, 0.26, 'cartonbox', 3, PAPER(2.6), {stack: 1, depth: 1, facings: [1, 2]}, 'box'),
  A('cartonL', 'box', 0.42, 0.3, 0.28, 'cartonbox', 3, PAPER(4.2), {stack: 1, depth: 1, facings: [1, 2]}, 'box'),
  A('paint', 'paint', 0.17, 0.19, 0.17, 'paint', 3, {...CAN, mass: 1.6}, {stack: 2, depth: 2, facings: [1, 3]}, 'aged'),
  A('tubes', 'box', 0.6, 0.065, 0.085, 'tubes', 1, PAPER(0.6), {stack: 4, depth: 2, facings: [1, 1]}, 'box'),
  A('reel', 'reel', 0.28, 0.13, 0.28, 'reel', 2, {collider: 'cylinder', mass: 2.4, mat: 'plastic', fam: 'light', hit: 'plastic'}, {stack: 2, depth: 1, facings: [1, 2]}, 'aged'),
  // --- news -------------------------------------------------------------------------------
  A('magazine', 'thin', 0.21, 0.28, 0.008, 'magazine', 8, {...PAPER(0.25), fit: [1, 1, 1.5]}, {}, 'aged'),
  A('news', 'box', 0.29, 0.045, 0.37, 'news', 2, PAPER(1.1), {stack: 2, depth: 1, facings: [1, 2]}, 'aged'),
  // --- flowers (iteration 12: long dead — dried brown heads, withered leaves) -------------------
  A('bunch', 'bunch', 0.22, 0.56, 0.22, 'none', 6, {collider: 'cylinder', mass: 2.2, mat: 'metal', fam: 'can', hit: 'food', fit: [0.88, 1, 0.88]}, {}, 'spoiled'),
  A('plant', 'plant', 0.2, 0.32, 0.2, 'none', 4, {collider: 'cylinder', mass: 1.2, mat: 'plastic', fam: 'light', hit: 'plastic', fit: [0.72, 1, 0.72]}, {}, 'spoiled'),
  // --- bakery (iteration 12: mouldy loaves, stained boxes) -------------------------------------
  A('loaf', 'loaf', 0.25, 0.11, 0.12, 'loaf', 3, {...PAPER(0.5), hit: 'food'}, {stack: 2, depth: 2, facings: [1, 3]}, 'spoiled'),
  A('donutbox', 'box', 0.24, 0.075, 0.24, 'donuts', 2, {...PAPER(0.45), hit: 'food'}, {stack: 3, depth: 1, facings: [1, 2]}, 'aged'),
  // --- key-cutting wall (hung on pegboard hooks) / juice-bar fruit crates ---------------------
  // key blank: tarnished brass / nickel colourways; the collider is 3x the 2.5 mm blank (stable contacts, hooks space them to match)
  A('key', 'key', 0.026, 0.062, 0.0025, 'none', 2, {collider: 'box', mass: 0.012, mat: 'metal', fam: 'can', hit: 'sheetMetal', fit: [1, 1, 3]}, {depth: 3, facings: [1, 1]}, 'aged'),
  // whole fruit, iteration 12: rotten (brown, shrivelled, mould-flecked colourways): rolls when knocked
  A('fruit', 'ball', 0.075, 0.075, 0.075, 'none', 5, {collider: 'sphere', mass: 0.18, mat: 'soft', fam: 'light', hit: 'food'}, {stack: 2, depth: 4, facings: [3, 5]}, 'spoiled'),
  // --- iteration 12 (LOOT lane): the abandoned station — boxes, trash, broken goods ---------------------------------------------
  // open carton, flaps up (the box body; flaps stay inside the catalogue box), mostly empty
  A('cartonOpen', 'openbox', 0.34, 0.27, 0.26, 'cartonbox', 3, {...PAPER(0.5), fit: [0.72, 1, 0.74]}, {stack: 1, depth: 1, facings: [1, 2]}, 'box'),
  // crushed / collapsed carton (sheared, sagging lid)
  A('cartonCrushed', 'crushed', 0.38, 0.13, 0.29, 'cartonbox', 3, {...PAPER(0.45), fit: [0.9, 0.85, 0.95]}, {stack: 2, depth: 1, facings: [1, 2]}, 'box'),
  // crumpled wrapper / paper wad
  A('wrapper', 'crumple', 0.12, 0.06, 0.1, 'trash', 4, {collider: 'box', mass: 0.05, mat: 'soft', fam: 'light', hit: 'cardboard', fit: [0.8, 0.85, 0.8]}, {stack: 2, depth: 3, facings: [2, 4]}, 'trash'),
  // deflated, torn snack bag lying flat
  A('bagTorn', 'flatbag', 0.2, 0.05, 0.14, 'chips', 4, {...PAPER(0.05), fit: [0.95, 0.9, 0.95]}, {stack: 3, depth: 2, facings: [1, 2]}, 'trash'),
  // emptied product boxes, torn open (a cereal / cracker box, a medicine carton): upright, light, the shelf's commonest junk
  A('snackboxOpen', 'openbox', 0.15, 0.2, 0.07, 'pantry', 4, {...PAPER(0.06), fit: [0.88, 1, 0.86]}, {stack: 1, depth: 3, facings: [1, 3]}, 'trash'),
  A('medboxOpen', 'openbox', 0.09, 0.13, 0.05, 'med', 5, {...PAPER(0.05), fit: [0.88, 1, 0.86]}, {stack: 2, depth: 3, facings: [1, 3]}, 'trash'),
  // crushed, empty drinks can
  A('canCrushed', 'crushcan', 0.076, 0.062, 0.076, 'soda', 4, {...CAN, mass: 0.06}, {stack: 3, depth: 3, facings: [2, 4]}, 'trash'),
  // rusted tin, its label mostly peeled away
  A('canRusty', 'tin', 0.075, 0.105, 0.075, 'rusttin', 3, {...CAN, mass: 0.42}, {stack: 3, depth: 3, facings: [2, 4]}, 'spoiled'),
  // empty, scuffed plastic bottle with a torn sleeve
  A('bottleEmpty', 'bottle', 0.066, 0.215, 0.066, 'oldbottle', 3, PLASTIC(0.06), {depth: 3, facings: [1, 3]}, 'trash'),
  // broken glass bottle (the lower body, a jagged crown)
  A('bottleBroken', 'shard', 0.07, 0.13, 0.07, 'oldbottle', 3, {collider: 'cylinder', mass: 0.18, mat: 'glass', fam: 'glass', hit: 'glass'}, {depth: 2, facings: [1, 2]}, 'trash'),
  // --- task food-shelf-production (lane SHELF): the 27 Meshy-modelled ruined props (world/shelfJunkModels.ts), manifest order --------
  ...JUNK_PROPS.map(j => {
    const [w, h, d] = junkDims(j);
    return {...A(junkArchId(j), j.fallback.shape, w, h, d, j.fallback.label, j.fallback.variants,
      {collider: j.collider, mass: j.mass, mat: j.mat, fam: j.fam, hit: j.hit, ...(j.fit ? {fit: j.fit} : {})},
      {stack: j.stack, depth: j.depth, facings: j.facings}, j.look), model: j.id, standIn: j.standIn, ...(j.low ? {low: true} : {}), ...(j.layFlat ? {layFlat: true} : {})};
  }),
];

export const ARCH_INDEX: Readonly<Record<string, number>> = Object.fromEntries(STOCK_ARCHES.map((a, i) => [a.id, i]));
export const arch = (id: string): StockArch => {
  const i = ARCH_INDEX[id];
  if (i === undefined) throw new Error(`unknown stock archetype ${id}`);
  return STOCK_ARCHES[i];
};

/** Label variants per family (the atlas draws exactly these). */
export const LABEL_VARIANTS: Readonly<Record<Exclude<LabelKind, 'none'>, number>> = (() => {
  const out: Partial<Record<LabelKind, number>> = {};
  for (const a of STOCK_ARCHES) if (a.label !== 'none') out[a.label] = Math.max(out[a.label] ?? 0, a.variants);
  return out as Record<Exclude<LabelKind, 'none'>, number>;
})();

// ---------------------------------------------------------------------------------------
// Categories: what a shop / room stocks on which holder

export type StockCategory =
  | 'snacks' | 'grocery' | 'pharmacy' | 'cleaning' | 'devices' | 'cartons' | 'parts'
  | 'drinks' | 'juice' | 'magazines' | 'flowers' | 'bread' | 'pastry' | 'keys' | 'fruit'
  // task food-shelf-production (lane SHELF): storage-room / office / back-of-house food shelving (the plain 'shelf' kind)
  | 'storage' | 'office' | 'pantry';

/**
 * Weighted archetype lists per category (shelf dressing picks facings from these). Iteration 12 (LOOT lane): ~30 years on, most
 * of what is left is cardboard, trash and broken / spoiled goods; intact packages are a faded minority (tests: >= 75 % of pieces in
 * the box / trash / spoiled / aged classes). Coolers: mostly empty, broken bottles and crushed cans.
 *
 * Task food-shelf-production (lane SHELF): the crude authored spoiled / trash / aged / boxed packaging is ROUTED to the modelled
 * ruined props where they correspond (world/shelfJunkModels.ts; `junk_*` ids): loaf -> mouldy loaf, rusty tins -> bloated can /
 * rusty tin stack, gable cartons -> burst milk, jars -> mould jar, opened cereal / snack boxes -> crushed cereal, plain / open /
 * crushed cartons -> retail carton / shipping box / torn carton / crushed box, blister -> blister card, wrappers -> wrapper cluster,
 * spray -> trigger sprayer, jug -> cleaner jug, paper rolls / towels -> towel pack (+ rags), paint -> paint tin, cable reel ->
 * cable + dead adapter. Kept authored: the intact leftover product facings, crushed cans, empty / broken bottles, medicine boxes,
 * device boxes, tube boxes, magazines / newspapers, dead flowers, donut boxes, key blanks and the juice bar's whole fruit (no model
 * counterpart). Non-food junk goes to cleaning / parts / storage / office shelving, the food ruins to food shops and pantries.
 */
export const CATEGORY_STOCK: Readonly<Record<StockCategory, readonly (readonly [string, number])[]>> = {
  snacks: [['canCrushed', 1.6], ['junk_wrapper_cluster', 1.1], ['wrapper', 0.6], ['junk_crushed_cereal', 0.9], ['snackboxOpen', 0.5], ['bagTorn', 0.5], ['bottleEmpty', 0.6],
    ['junk_retail_carton', 0.25], ['junk_crushed_box', 0.25], ['junk_shelf_tray', 0.3], ['junk_deli_clamshell', 0.25], ['chips', 0.7], ['snack', 0.6], ['candy', 0.5]],
  grocery: [['junk_bloated_can', 2.4], ['junk_rusty_tins', 0.9], ['junk_mould_jar', 1.2], ['canCrushed', 1.6], ['junk_crushed_cereal', 0.6], ['junk_wrapper_cluster', 0.6], ['bottleEmpty', 0.5],
    ['junk_mouldy_loaf', 0.3], ['junk_flour_sack', 0.35], ['junk_potato_sack', 0.3], ['junk_egg_carton', 0.3], ['junk_rotten_fruit_crate', 0.35], ['junk_deli_clamshell', 0.3],
    ['junk_shelf_tray', 0.3], ['junk_retail_carton', 0.15], ['junk_crushed_box', 0.3], ['tin', 0.6], ['cereal', 0.4], ['pantry', 0.4], ['cup', 0.3]],
  pharmacy: [['medboxOpen', 2.4], ['junk_wrapper_cluster', 0.6], ['wrapper', 0.5], ['bottleEmpty', 0.9], ['junk_retail_carton', 0.3], ['junk_crushed_box', 0.3], ['junk_blister_card', 0.3],
    ['medbox', 0.8], ['pills', 0.6], ['lotion', 0.5]],
  cleaning: [['junk_trigger_sprayer', 2], ['junk_cleaner_jug', 1.6], ['junk_towel_pack', 1], ['junk_rag_bundle', 0.8], ['junk_torn_carton', 0.6], ['junk_crushed_box', 0.5],
    ['junk_wrapper_cluster', 0.4], ['junk_retail_carton', 0.4]],
  // (the authored blister / wrapper stay at a small share: the only ones low and shallow enough for the electronics wall bay's
  // 0.115 m strip under its accessory cards)
  devices: [['phonebox', 1.6], ['junk_blister_card', 1.2], ['blister', 0.9], ['gadget', 1], ['tabletbox', 0.5], ['junk_retail_carton', 0.5], ['junk_torn_carton', 0.5], ['junk_crushed_box', 0.5],
    ['junk_cable_adapter', 0.6], ['junk_wrapper_cluster', 0.4], ['wrapper', 0.5]],
  cartons: [['junk_retail_carton', 1.6], ['junk_shipping_box', 1.6], ['junk_torn_carton', 1.8], ['junk_crushed_box', 1.4], ['junk_carton_bundle', 1], ['junk_shelf_tray', 0.6],
    ['junk_towel_pack', 0.3]],
  parts: [['junk_paint_tin', 2], ['junk_cable_adapter', 1.4], ['junk_tool_tote', 1], ['junk_retail_carton', 1], ['junk_torn_carton', 0.8], ['junk_crushed_box', 0.5], ['tubes', 1],
    ['junk_cleaner_jug', 0.5], ['junk_rag_bundle', 0.6], ['junk_blister_card', 0.4]],
  drinks: [['bottleEmpty', 3], ['bottleBroken', 1.5], ['canCrushed', 1.5], ['junk_burst_milk', 0.4], ['junk_deli_clamshell', 0.3], ['junk_egg_carton', 0.15], ['junk_torn_carton', 0.1], ['bottle', 0.4], ['soda', 0.35], ['energy', 0.2], ['bigbottle', 0.2]],
  juice: [['bottleEmpty', 2.5], ['bottleBroken', 1], ['canCrushed', 0.6], ['junk_burst_milk', 0.5], ['junk_rotten_fruit_crate', 0.25], ['bottle', 0.5]],
  magazines: [['magazine', 1]],
  flowers: [['bunch', 3], ['plant', 1]],
  bread: [['junk_mouldy_loaf', 3], ['junk_wrapper_cluster', 0.8], ['wrapper', 0.4], ['bagTorn', 0.4], ['junk_shelf_tray', 0.4], ['junk_flour_sack', 0.2], ['junk_torn_carton', 0.25], ['pantry', 0.3]],
  pastry: [['donutbox', 3], ['junk_wrapper_cluster', 0.6], ['wrapper', 0.5], ['junk_mouldy_loaf', 0.5], ['junk_shelf_tray', 0.3], ['junk_torn_carton', 0.2]],
  keys: [['key', 1]],
  fruit: [['fruit', 1]],
  storage: [['junk_shipping_box', 1.4], ['junk_torn_carton', 1.4], ['junk_crushed_box', 1], ['junk_retail_carton', 1.2], ['junk_carton_bundle', 1], ['junk_binder_stack', 0.6],
    ['junk_paint_tin', 0.6], ['junk_cable_adapter', 0.6], ['junk_tool_tote', 0.5], ['junk_rag_bundle', 0.5], ['junk_towel_pack', 0.5], ['junk_cleaner_jug', 0.5],
    ['junk_trigger_sprayer', 0.4], ['junk_wrapper_cluster', 0.4], ['canCrushed', 0.3], ['bottleEmpty', 0.3]],
  office: [['junk_binder_stack', 2.4], ['junk_retail_carton', 1.2], ['junk_torn_carton', 1], ['junk_crushed_box', 0.8], ['junk_shipping_box', 0.8], ['junk_carton_bundle', 0.8],
    ['junk_cable_adapter', 0.6], ['junk_wrapper_cluster', 0.4], ['canCrushed', 0.3], ['bottleEmpty', 0.3]],
  pantry: [['junk_flour_sack', 1], ['junk_potato_sack', 0.8], ['junk_rusty_tins', 1.2], ['junk_bloated_can', 1.2], ['junk_mould_jar', 0.8], ['junk_rotten_fruit_crate', 0.6],
    ['junk_egg_carton', 0.4], ['junk_shipping_box', 0.6], ['junk_torn_carton', 0.6], ['junk_crushed_box', 0.4], ['junk_shelf_tray', 0.5], ['junk_wrapper_cluster', 0.4]],
};

/**
 * Iteration 12 (LOOT lane): how bare a category's boards are — chance per bay of a sold-out gap, of a looted facing (front rows
 * gone) and of a knocked-over piece in a gap. Coolers (drinks / juice) are mostly empty.
 */
export const CATEGORY_SPARSE: Readonly<Partial<Record<StockCategory, {gap: number; taken: number; tipped: number}>>> = {
  // task food-shelf-production (lane SHELF): modestly fuller, lived-in shelves (iteration 12: coolers 0.3 / 0.5, shop shelving 0.055 /
  // 0.15, bread 0.12 / 0.3) — coolers stay the emptiest
  drinks: {gap: 0.3, taken: 0.5, tipped: 0.6}, juice: {gap: 0.3, taken: 0.5, tipped: 0.6},
  snacks: {gap: 0.025, taken: 0.07, tipped: 0.55}, grocery: {gap: 0.025, taken: 0.07, tipped: 0.55}, pharmacy: {gap: 0.025, taken: 0.07, tipped: 0.55},
  bread: {gap: 0.08, taken: 0.2, tipped: 0.5}, pastry: {gap: 0.08, taken: 0.2, tipped: 0.5},
};
export const DEFAULT_SPARSE = {gap: 0.025, taken: 0.07, tipped: 0.45};

/** gen/purposeShapes.ts STOCK_THEMES order (stockShelf variant) -> category. */
export const THEME_CATEGORY: readonly StockCategory[] = ['snacks', 'grocery', 'pharmacy', 'cleaning', 'devices', 'cartons', 'parts'];

/**
 * Category for a holder: stock shelves by their theme (the purpose's `stock`), coolers by the
 * shop (juice bars sell juice), racks / stands / bread racks by what they hold. null = not stocked.
 */
export function stockCategory(kind: string, variant: number, purpose: string | undefined): StockCategory | null {
  switch (kind) {
    case 'stockShelf': return THEME_CATEGORY[((variant % THEME_CATEGORY.length) + THEME_CATEGORY.length) % THEME_CATEGORY.length];
    case 'snackRack': return 'snacks';
    case 'shopCooler': return purpose === 'juice' || purpose === 'coffee' || purpose === 'bakery' || purpose === 'donut' ? 'juice' : 'drinks';
    case 'magazineRack': return 'magazines';
    case 'flowerStand': return 'flowers';
    case 'breadRack': return ((variant % 2) + 2) % 2 === 1 ? 'pastry' : 'bread';
    // key-cutting bench: a few boxes of blanks / parts (its key wall's hooks hold 'keys', Board.category);
    // phone-repair bench: accessories for sale
    case 'repairBench': return ((variant % 2) + 2) % 2 === 1 ? 'devices' : 'parts';
    // electronics wall bay: boxed stock behind the display phones
    case 'deviceWall': return 'devices';
    // juice bar: crates of whole fruit on the counter
    case 'blenderBar': return 'fruit';
    // task food-shelf-production (lane SHELF): plain storage shelving (storage / stock rooms, closets, workshops, plant rooms, office
    // storage / archives, kitchens' back shelves) by the room it stands in
    case 'shelf': return shelfCategory(purpose);
    default: return null;
  }
}

/**
 * Task food-shelf-production (lane SHELF): what a plain storage shelf ('shelf' kind) of a room holds, by its purpose id: cleaning
 * supplies in janitor / supply closets, binders and boxes in offices / archives, medical boxes in clinics, spoiled food stores in
 * kitchens / pantries, parts / paint / cable / totes in workshops and plant rooms, else general storage (boxes and mixed junk).
 */
export function shelfCategory(purpose: string | undefined): StockCategory {
  const p = (purpose ?? '').toLowerCase();
  if (/janitor|supply|clean|wash/.test(p)) return 'cleaning';
  if (/office|archive|mail|record|copy|admin|reception|agent|law|account|library|study/.test(p)) return 'office';
  if (/pharm|medic|clinic|first-aid|dispens|infirm/.test(p)) return 'pharmacy';
  if (/kitchen|ramen|roast|bak|cafe|coffee|food|deli|pantry|canteen|crew|diner|restaurant|grocer/.test(p)) return 'pantry';
  if (/work|tool|hardware|electric|maint|utility|plant|boiler|generator|turbine|pump|vent|signal|sewage|spill|overflow|machine|garage|repair|fuel/.test(p)) return 'parts';
  return 'storage';
}

/** Holder kinds that receive filler stock (tests: every one gets stock appropriate to its category). */
export const STOCKED_KINDS = ['stockShelf', 'snackRack', 'shopCooler', 'magazineRack', 'flowerStand', 'breadRack', 'repairBench', 'deviceWall', 'blenderBar', 'shelf'] as const;
export type StockedKind = (typeof STOCKED_KINDS)[number];
export const isStockedKind = (k: string): k is StockedKind => (STOCKED_KINDS as readonly string[]).includes(k);

/**
 * Per-station bound on filler objects. Over it, back rows are thinned first (front facings keep
 * reading as full shelves); see world/shelfStockLayout.ts.
 */
export const MAX_STOCK_PER_STATION = 6000;
/**
 * Task food-shelf-production (lane SHELF): per-station bounds on the stock's triangles and packed rest-mesh geometry, under the
 * rendering budgets (tests/shelfStock.test.ts: < 320 k triangles, < 14 MB). The thinning passes (world/shelfStock.ts) hold them
 * exactly like the piece bound, from the archetypes' static triangle counts (the cooked registry's for model-backed ones), so a
 * station dresses the same whether or not the model atlas loaded.
 */
export const MAX_STOCK_TRIANGLES = 300_000;
export const MAX_STOCK_GEOMETRY_BYTES = 13 * 1048576;
