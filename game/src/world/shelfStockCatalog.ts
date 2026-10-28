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

/** Geometry recipe of an archetype (world/shelfStockGeometry.ts builds each one, low-poly). */
export type StockShape =
  | 'can' | 'tin' | 'bottle' | 'jar' | 'cup' | 'gable' | 'box' | 'pillow' | 'spray' | 'jug' | 'pills'
  | 'paint' | 'reel' | 'thin' | 'bunch' | 'plant' | 'loaf' | 'rolls' | 'blister' | 'key' | 'ball';

/** Label family drawn into the atlas (each with `variants` designs). 'none' = vertex colours only. */
export type LabelKind =
  | 'soda' | 'energy' | 'tin' | 'bottle' | 'bigbottle' | 'jar' | 'cup' | 'carton' | 'cereal' | 'pantry' | 'candy'
  | 'chips' | 'snack' | 'towels' | 'rolls' | 'med' | 'pills' | 'lotion' | 'spray' | 'jug' | 'phone' | 'tablet'
  | 'blister' | 'gadget' | 'cartonbox' | 'paint' | 'tubes' | 'reel' | 'magazine' | 'news' | 'loaf' | 'donuts' | 'none';

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
}

const A = (id: string, shape: StockShape, w: number, h: number, d: number, label: LabelKind, variants: number,
  phys: {collider: 'box' | 'cylinder' | 'sphere'; mass: number; mat: PhysMat; fam: ImpactFamily; hit: DamageClass; fit?: [number, number, number]},
  shelf: {stack?: number; depth?: number; facings?: [number, number]} = {}): StockArch =>
  ({id, shape, w, h, d, label, variants, ...phys, stack: shelf.stack ?? 1, depth: shelf.depth ?? 3, facings: shelf.facings ?? [1, 3]});

const CAN = {collider: 'cylinder', mass: 0.37, mat: 'metal', fam: 'can', hit: 'sheetMetal'} as const;
const PAPER = (mass: number) => ({collider: 'box', mass, mat: 'soft', fam: 'light', hit: 'cardboard'} as const);
const PLASTIC = (mass: number, collider: 'box' | 'cylinder' = 'cylinder') => ({collider, mass, mat: 'plastic', fam: 'light', hit: 'plastic'} as const);

/** Every filler archetype (index = archetype id used by placements / render / physics). */
export const STOCK_ARCHES: readonly StockArch[] = [
  // --- drinks -----------------------------------------------------------------------------
  A('soda', 'can', 0.066, 0.122, 0.066, 'soda', 4, CAN, {stack: 2, depth: 3, facings: [2, 4]}),
  A('energy', 'can', 0.058, 0.168, 0.058, 'energy', 3, {...CAN, mass: 0.52}, {depth: 3, facings: [2, 3]}),
  A('bottle', 'bottle', 0.066, 0.215, 0.066, 'bottle', 5, PLASTIC(0.53), {depth: 3, facings: [2, 4]}),
  A('bigbottle', 'bottle', 0.105, 0.31, 0.105, 'bigbottle', 3, PLASTIC(2.1), {depth: 2, facings: [1, 3]}),
  A('carton1l', 'gable', 0.07, 0.2, 0.07, 'carton', 3, PAPER(1.0), {depth: 3, facings: [2, 3]}),
  // --- grocery ----------------------------------------------------------------------------
  A('tin', 'tin', 0.075, 0.105, 0.075, 'tin', 5, {...CAN, mass: 0.42}, {stack: 3, depth: 3, facings: [2, 4]}),
  A('jar', 'jar', 0.078, 0.112, 0.078, 'jar', 4, {collider: 'cylinder', mass: 0.45, mat: 'glass', fam: 'glass', hit: 'glass'}, {stack: 2, depth: 2, facings: [2, 3]}),
  A('cup', 'cup', 0.095, 0.105, 0.095, 'cup', 3, {collider: 'cylinder', mass: 0.09, mat: 'soft', fam: 'light', hit: 'food'}, {stack: 3, depth: 3, facings: [1, 3]}),
  A('cereal', 'box', 0.19, 0.28, 0.065, 'cereal', 4, PAPER(0.45), {depth: 3, facings: [1, 3]}),
  A('pantry', 'box', 0.15, 0.2, 0.055, 'pantry', 4, PAPER(0.3), {stack: 2, depth: 3, facings: [1, 3]}),
  A('towels', 'rolls', 0.24, 0.26, 0.12, 'towels', 2, PAPER(0.45), {depth: 2, facings: [1, 2]}),
  // --- snacks -----------------------------------------------------------------------------
  A('candy', 'box', 0.12, 0.065, 0.09, 'candy', 4, {...PAPER(0.22), hit: 'food'}, {stack: 3, depth: 2, facings: [1, 3]}),
  A('chips', 'pillow', 0.2, 0.27, 0.075, 'chips', 4, {...PAPER(0.07), hit: 'food', fit: [0.9, 0.9, 0.7]}, {depth: 3, facings: [1, 3]}),
  A('snack', 'pillow', 0.13, 0.18, 0.045, 'snack', 4, {...PAPER(0.05), hit: 'food', fit: [0.9, 0.9, 0.7]}, {stack: 1, depth: 3, facings: [2, 4]}),
  // --- pharmacy ---------------------------------------------------------------------------
  A('medbox', 'box', 0.09, 0.13, 0.035, 'med', 5, PAPER(0.06), {stack: 2, depth: 2, facings: [2, 4]}),
  A('pills', 'pills', 0.046, 0.095, 0.046, 'pills', 3, PLASTIC(0.08), {stack: 1, depth: 2, facings: [2, 5]}),
  A('lotion', 'box', 0.065, 0.18, 0.042, 'lotion', 3, PLASTIC(0.3, 'box'), {depth: 3, facings: [2, 4]}),
  // --- cleaning / household ---------------------------------------------------------------
  A('spray', 'spray', 0.095, 0.28, 0.06, 'spray', 3, PLASTIC(0.65, 'box'), {depth: 2, facings: [2, 4]}),
  A('jug', 'jug', 0.15, 0.29, 0.1, 'jug', 3, {...PLASTIC(2.2, 'box')}, {depth: 2, facings: [1, 3]}),
  A('rolls', 'rolls', 0.33, 0.22, 0.22, 'rolls', 2, PAPER(1.1), {depth: 1, facings: [1, 2]}),
  // --- devices ----------------------------------------------------------------------------
  A('phonebox', 'box', 0.09, 0.17, 0.045, 'phone', 4, PAPER(0.35), {depth: 3, facings: [2, 4]}),
  A('tabletbox', 'box', 0.21, 0.28, 0.05, 'tablet', 2, PAPER(0.8), {depth: 2, facings: [1, 2]}),
  A('blister', 'blister', 0.11, 0.18, 0.03, 'blister', 4, {...PLASTIC(0.08, 'box')}, {depth: 3, facings: [2, 4]}),
  A('gadget', 'box', 0.14, 0.1, 0.1, 'gadget', 3, PAPER(0.4), {stack: 2, depth: 2, facings: [1, 3]}),
  // --- parts / back stock -----------------------------------------------------------------
  A('cartonS', 'box', 0.32, 0.24, 0.26, 'cartonbox', 3, PAPER(2.6), {stack: 1, depth: 1, facings: [1, 2]}),
  A('cartonL', 'box', 0.42, 0.3, 0.28, 'cartonbox', 3, PAPER(4.2), {stack: 1, depth: 1, facings: [1, 2]}),
  A('paint', 'paint', 0.17, 0.19, 0.17, 'paint', 3, {...CAN, mass: 1.6}, {stack: 2, depth: 2, facings: [1, 3]}),
  A('tubes', 'box', 0.6, 0.065, 0.085, 'tubes', 1, PAPER(0.6), {stack: 4, depth: 2, facings: [1, 1]}),
  A('reel', 'reel', 0.28, 0.13, 0.28, 'reel', 2, {collider: 'cylinder', mass: 2.4, mat: 'plastic', fam: 'light', hit: 'plastic'}, {stack: 2, depth: 1, facings: [1, 2]}),
  // --- news -------------------------------------------------------------------------------
  A('magazine', 'thin', 0.21, 0.28, 0.008, 'magazine', 8, {...PAPER(0.25), fit: [1, 1, 1.5]}),
  A('news', 'box', 0.29, 0.045, 0.37, 'news', 2, PAPER(1.1), {stack: 2, depth: 1, facings: [1, 2]}),
  // --- flowers ----------------------------------------------------------------------------
  A('bunch', 'bunch', 0.22, 0.56, 0.22, 'none', 6, {collider: 'cylinder', mass: 2.2, mat: 'metal', fam: 'can', hit: 'food', fit: [0.88, 1, 0.88]}),
  A('plant', 'plant', 0.2, 0.32, 0.2, 'none', 4, {collider: 'cylinder', mass: 1.2, mat: 'plastic', fam: 'light', hit: 'plastic', fit: [0.72, 1, 0.72]}),
  // --- bakery -----------------------------------------------------------------------------
  A('loaf', 'loaf', 0.25, 0.11, 0.12, 'loaf', 3, {...PAPER(0.5), hit: 'food'}, {stack: 2, depth: 2, facings: [1, 3]}),
  A('donutbox', 'box', 0.24, 0.075, 0.24, 'donuts', 2, {...PAPER(0.45), hit: 'food'}, {stack: 3, depth: 1, facings: [1, 2]}),
  // --- key-cutting wall (hung on pegboard hooks) / juice-bar fruit crates ---------------------
  // key blank: brass / nickel colourways; the collider is 3x the 2.5 mm blank (stable contacts, hooks space them to match)
  A('key', 'key', 0.026, 0.062, 0.0025, 'none', 2, {collider: 'box', mass: 0.012, mat: 'metal', fam: 'can', hit: 'sheetMetal', fit: [1, 1, 3]}, {depth: 3, facings: [1, 1]}),
  // whole fruit (orange, red / green apple, lemon, lime colourways): rolls when knocked
  A('fruit', 'ball', 0.075, 0.075, 0.075, 'none', 5, {collider: 'sphere', mass: 0.18, mat: 'soft', fam: 'light', hit: 'food'}, {stack: 2, depth: 4, facings: [3, 5]}),
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
  | 'drinks' | 'juice' | 'magazines' | 'flowers' | 'bread' | 'pastry' | 'keys' | 'fruit';

/** Weighted archetype lists per category (shelf dressing picks facings from these). */
export const CATEGORY_STOCK: Readonly<Record<StockCategory, readonly (readonly [string, number])[]>> = {
  snacks: [['chips', 3], ['snack', 2.4], ['candy', 2], ['soda', 0.8], ['cup', 0.6]],
  grocery: [['tin', 3], ['cereal', 2], ['pantry', 2], ['jar', 1.5], ['cup', 1.4], ['bottle', 0.8], ['towels', 0.6], ['chips', 0.6]],
  pharmacy: [['medbox', 4], ['pills', 2.5], ['lotion', 2], ['bottle', 0.4]],
  cleaning: [['spray', 3], ['jug', 2.2], ['rolls', 1.2], ['towels', 1.2]],
  devices: [['phonebox', 3], ['blister', 2.5], ['gadget', 2], ['tabletbox', 1]],
  cartons: [['cartonS', 3], ['cartonL', 2], ['tin', 0.5], ['rolls', 0.4]],
  parts: [['cartonS', 2], ['paint', 2.4], ['reel', 1.6], ['tubes', 1.2], ['jug', 0.6]],
  drinks: [['soda', 3], ['bottle', 3], ['energy', 1.6], ['bigbottle', 1], ['carton1l', 0.8]],
  juice: [['carton1l', 3], ['bottle', 2.5], ['bigbottle', 0.8], ['soda', 0.6]],
  magazines: [['magazine', 1]],
  flowers: [['bunch', 3], ['plant', 1]],
  bread: [['loaf', 3], ['pantry', 0.6]],
  pastry: [['donutbox', 3], ['loaf', 0.8]],
  keys: [['key', 1]],
  fruit: [['fruit', 1]],
};

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
    default: return null;
  }
}

/** Holder kinds that receive filler stock (tests: every one gets stock appropriate to its category). */
export const STOCKED_KINDS = ['stockShelf', 'snackRack', 'shopCooler', 'magazineRack', 'flowerStand', 'breadRack', 'repairBench', 'deviceWall', 'blenderBar'] as const;
export type StockedKind = (typeof STOCKED_KINDS)[number];
export const isStockedKind = (k: string): k is StockedKind => (STOCKED_KINDS as readonly string[]).includes(k);

/**
 * Per-station bound on filler objects. Over it, back rows are thinned first (front facings keep
 * reading as full shelves); see world/shelfStockLayout.ts.
 */
export const MAX_STOCK_PER_STATION = 6000;
