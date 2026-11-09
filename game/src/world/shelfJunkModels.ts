// Task studio-food-shelf-production-20261109-002816-01 (lane SHELF): the 27 Meshy-modelled RUINED SHELF PROPS (P01..P27) as filler
// stock — 12 spoiled groceries, 7 ruined boxes / packaging, 8 non-food storage / maintenance / office junk. Pure data (no three.js).
//
// The models come as ONE GLB (assets/models/shelf-junk-atlas.glb, cooked by tools/asset-pipeline/props/build-food-shelf-meshy.mjs)
// with one mesh node per prop id, all on ONE shared atlas material whose maps are Meshy's own (kept exactly). The cook writes the
// registry (assets/foodShelfModels.generated.ts SHELF_JUNK_ATLAS: node name, real size w / h / d in metres, triangles).
//
// Each prop is a filler ARCHETYPE (world/shelfStockCatalog.ts STOCK_ARCHES, appended: ids stable) with its own real-size box,
// collider, mass and contact material (a cardboard carton is light, a paint tin heavy) and a procedural FALLBACK recipe (the
// existing authored packaging builder at the prop's own size) that draws it while the atlas is not loaded (the cook's stub, a
// failed fetch). Layout (world/shelfStockLayout.ts) only ever reads the registry's static numbers, never the loaded file, so a
// station dresses identically whether the GLB arrived or not; world/shelfStock.ts swaps the drawn geometry.
//
// Filler is NOT loot: no pickup, prompt, highlight or inventory entry (world/shelfStock.ts header). A cracked EMPTY tote, a dead
// cable or a burst carton is debris, never a usable tool / container / food.

import {SHELF_JUNK_ATLAS, type ShelfJunkPart} from '../assets/foodShelfModels.generated';
import type {ImpactFamily} from '../physics/chunks';
import type {DamageClass, PhysMat} from '../damage/materials';
import type {LabelKind, StockLook, StockShape} from './shelfStockCatalog';

/** Lazy prop-library key of the shared atlas GLB (Game.propModels; levels with shelf stock fetch it behind their loading screen). */
export const SHELF_JUNK_KEY = 'shelf-junk-atlas';
/** Catalogue bytes used for the loading bar when the registry carries none (cooked atlas: ~27 small parts + one shared map set). */
const ATLAS_BYTES_ESTIMATE = 3_000_000;
/** Lazy-library file map entry of the atlas (Game.propModels catalogue). */
export const SHELF_JUNK_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {
  [SHELF_JUNK_KEY]: {url: SHELF_JUNK_ATLAS.url, bytes: (SHELF_JUNK_ATLAS as {bytes?: number}).bytes ?? ATLAS_BYTES_ESTIMATE},
};

export type JunkFamily = 'food' | 'box' | 'junk';

export interface JunkProp {
  /** Manifest id (P01..P27) = the registry key. */
  id: string;
  slug: string;
  family: JunkFamily;
  /** Plan reference measure (the cook scales the model to it): axis and metres. */
  ref: {axis: 'h' | 'w' | 'd'; m: number};
  /** Upright box (w = X across the facing, h = Y, d = Z depth, m) used until the cooked registry carries the part. */
  est: [number, number, number];
  collider: 'box' | 'cylinder';
  /** Collider extents as a fraction of the box (sacks / bundles / clusters are not full boxes). */
  fit?: [number, number, number];
  mass: number;
  mat: PhysMat;
  fam: ImpactFamily;
  hit: DamageClass;
  stack: number;
  depth: number;
  facings: [number, number];
  look: StockLook;
  /** Procedural fallback (world/shelfStockGeometry.ts recipe, drawn at this prop's own box). */
  fallback: {shape: StockShape; label: LabelKind; variants: number};
}

const J = (id: string, slug: string, family: JunkFamily, ref: JunkProp['ref'], est: [number, number, number],
  phys: Pick<JunkProp, 'collider' | 'mass' | 'mat' | 'fam' | 'hit'> & {fit?: [number, number, number]},
  shelf: [stack: number, depth: number, facings: [number, number]], look: StockLook, fallback: JunkProp['fallback']): JunkProp =>
  ({id, slug, family, ref, est, ...phys, stack: shelf[0], depth: shelf[1], facings: shelf[2], look, fallback});

const CARD = (mass: number, fam: ImpactFamily = 'light') => ({collider: 'box', mass, mat: 'soft', fam, hit: 'cardboard'} as const);
const TIN = (mass: number, collider: 'box' | 'cylinder' = 'cylinder') => ({collider, mass, mat: 'metal', fam: 'can', hit: 'sheetMetal'} as const);
const PLAS = (mass: number) => ({collider: 'box', mass, mat: 'plastic', fam: 'light', hit: 'plastic'} as const);

/** The 27 ruined props (manifest order). Masses: what is left of the package after ~30 years (dried, burst, emptied). */
export const JUNK_PROPS: readonly JunkProp[] = [
  // --- 12 spoiled groceries (food shops / back-of-house food storage) -------------------------------------------------------
  J('P01', 'mouldy_loaf', 'food', {axis: 'w', m: 0.32}, [0.32, 0.13, 0.14], {...CARD(0.35), hit: 'food', fit: [0.95, 0.9, 0.9]}, [2, 2, [1, 2]], 'spoiled', {shape: 'loaf', label: 'loaf', variants: 3}),
  J('P02', 'bloated_can', 'food', {axis: 'h', m: 0.12}, [0.085, 0.12, 0.085], TIN(0.45), [2, 2, [1, 3]], 'spoiled', {shape: 'tin', label: 'rusttin', variants: 3}),
  J('P03', 'burst_milk', 'food', {axis: 'h', m: 0.25}, [0.095, 0.25, 0.095], CARD(0.12), [1, 2, [1, 2]], 'spoiled', {shape: 'gable', label: 'carton', variants: 3}),
  J('P04', 'rotten_fruit_crate', 'food', {axis: 'w', m: 0.40}, [0.40, 0.22, 0.28], {collider: 'box', mass: 2.6, mat: 'wood', fam: 'wood', hit: 'wood', fit: [0.96, 0.92, 0.96]}, [1, 1, [1, 1]], 'spoiled', {shape: 'openbox', label: 'cartonbox', variants: 3}),
  J('P05', 'crushed_cereal', 'food', {axis: 'h', m: 0.30}, [0.21, 0.30, 0.08], {...CARD(0.12), fit: [0.94, 0.95, 0.85]}, [1, 2, [1, 2]], 'trash', {shape: 'crushed', label: 'cereal', variants: 4}),
  J('P06', 'mould_jar', 'food', {axis: 'h', m: 0.18}, [0.10, 0.18, 0.10], {collider: 'cylinder', mass: 0.55, mat: 'glass', fam: 'glass', hit: 'glass'}, [1, 2, [1, 3]], 'spoiled', {shape: 'jar', label: 'jar', variants: 4}),
  J('P07', 'flour_sack', 'food', {axis: 'h', m: 0.40}, [0.26, 0.40, 0.15], {...CARD(1.8, 'cardboard'), hit: 'fabric', fit: [0.9, 0.95, 0.85]}, [1, 1, [1, 1]], 'spoiled', {shape: 'box', label: 'cartonbox', variants: 3}),
  J('P08', 'deli_clamshell', 'food', {axis: 'w', m: 0.18}, [0.18, 0.08, 0.15], PLAS(0.12), [2, 2, [1, 2]], 'spoiled', {shape: 'box', label: 'pantry', variants: 4}),
  J('P09', 'egg_carton', 'food', {axis: 'w', m: 0.16}, [0.16, 0.07, 0.10], CARD(0.12), [2, 2, [1, 2]], 'spoiled', {shape: 'box', label: 'cartonbox', variants: 3}),
  J('P10', 'potato_sack', 'food', {axis: 'h', m: 0.40}, [0.30, 0.40, 0.22], {collider: 'box', mass: 3.2, mat: 'cloth', fam: 'cardboard', hit: 'fabric', fit: [0.88, 0.95, 0.85]}, [1, 1, [1, 1]], 'spoiled', {shape: 'box', label: 'cartonbox', variants: 3}),
  J('P11', 'wrapper_cluster', 'food', {axis: 'w', m: 0.25}, [0.25, 0.08, 0.18], {...CARD(0.06), fit: [0.85, 0.8, 0.85]}, [1, 2, [1, 2]], 'trash', {shape: 'crumple', label: 'trash', variants: 4}),
  J('P12', 'rusty_tins', 'food', {axis: 'h', m: 0.30}, [0.17, 0.30, 0.10], TIN(1.1, 'box'), [1, 2, [1, 2]], 'spoiled', {shape: 'box', label: 'rusttin', variants: 3}),
  // --- 7 ruined boxes / packaging ----------------------------------------------------------------------------------------------
  J('P13', 'retail_carton', 'box', {axis: 'w', m: 0.20}, [0.20, 0.14, 0.12], CARD(0.3), [2, 2, [1, 2]], 'box', {shape: 'box', label: 'cartonbox', variants: 3}),
  J('P14', 'shipping_box', 'box', {axis: 'w', m: 0.55}, [0.55, 0.28, 0.27], CARD(1.2, 'cardboard'), [1, 1, [1, 1]], 'box', {shape: 'box', label: 'cartonbox', variants: 3}),
  J('P15', 'torn_carton', 'box', {axis: 'w', m: 0.45}, [0.45, 0.24, 0.27], {...CARD(0.6, 'cardboard'), fit: [0.92, 1, 0.92]}, [1, 1, [1, 1]], 'box', {shape: 'openbox', label: 'cartonbox', variants: 3}),
  J('P16', 'crushed_box', 'box', {axis: 'w', m: 0.45}, [0.45, 0.12, 0.27], {...CARD(0.4, 'cardboard'), fit: [0.92, 0.85, 0.95]}, [2, 1, [1, 1]], 'box', {shape: 'crushed', label: 'cartonbox', variants: 3}),
  J('P17', 'blister_card', 'box', {axis: 'h', m: 0.25}, [0.15, 0.25, 0.04], PLAS(0.06), [1, 2, [1, 3]], 'trash', {shape: 'blister', label: 'blister', variants: 4}),
  J('P18', 'carton_bundle', 'box', {axis: 'w', m: 0.30}, [0.30, 0.10, 0.24], CARD(1.6, 'cardboard'), [2, 1, [1, 1]], 'box', {shape: 'box', label: 'cartonbox', variants: 3}),
  J('P19', 'shelf_tray', 'box', {axis: 'w', m: 0.40}, [0.40, 0.08, 0.26], {...CARD(0.35), fit: [0.96, 1, 0.96]}, [2, 1, [1, 1]], 'box', {shape: 'openbox', label: 'cartonbox', variants: 3}),
  // --- 8 non-food storage / maintenance / office junk --------------------------------------------------------------------------
  J('P20', 'cleaner_jug', 'junk', {axis: 'h', m: 0.30}, [0.16, 0.30, 0.11], PLAS(1.1), [1, 2, [1, 2]], 'aged', {shape: 'jug', label: 'jug', variants: 3}),
  J('P21', 'trigger_sprayer', 'junk', {axis: 'h', m: 0.28}, [0.10, 0.28, 0.07], PLAS(0.3), [1, 2, [1, 2]], 'trash', {shape: 'spray', label: 'spray', variants: 3}),
  J('P22', 'rag_bundle', 'junk', {axis: 'w', m: 0.30}, [0.30, 0.10, 0.22], {collider: 'box', mass: 0.45, mat: 'cloth', fam: 'light', hit: 'fabric', fit: [0.9, 0.85, 0.9]}, [2, 1, [1, 1]], 'trash', {shape: 'crumple', label: 'trash', variants: 4}),
  J('P23', 'tool_tote', 'junk', {axis: 'w', m: 0.45}, [0.45, 0.22, 0.24], PLAS(0.9), [1, 1, [1, 1]], 'trash', {shape: 'openbox', label: 'cartonbox', variants: 3}),
  J('P24', 'cable_adapter', 'junk', {axis: 'w', m: 0.25}, [0.25, 0.08, 0.18], {collider: 'box', mass: 0.35, mat: 'plastic', fam: 'light', hit: 'rubber', fit: [0.9, 0.85, 0.9]}, [1, 1, [1, 2]], 'trash', {shape: 'crumple', label: 'reel', variants: 2}),
  J('P25', 'paint_tin', 'junk', {axis: 'd', m: 0.17}, [0.20, 0.19, 0.17], TIN(1.5, 'box'), [1, 1, [1, 2]], 'aged', {shape: 'box', label: 'paint', variants: 3}),
  J('P26', 'towel_pack', 'junk', {axis: 'w', m: 0.30}, [0.30, 0.24, 0.20], CARD(0.5), [1, 1, [1, 2]], 'aged', {shape: 'rolls', label: 'towels', variants: 2}),
  J('P27', 'binder_stack', 'junk', {axis: 'w', m: 0.32}, [0.32, 0.16, 0.27], CARD(2.4, 'cardboard'), [2, 1, [1, 1]], 'aged', {shape: 'box', label: 'news', variants: 2}),
];

/** Filler archetype id of a junk prop (world/shelfStockCatalog.ts STOCK_ARCHES; never an ItemDef id). */
export const junkArchId = (j: Pick<JunkProp, 'slug'>): string => `junk_${j.slug}`;

/** The cooked registry part of a prop (undefined while the registry is the cook's stub). */
export function junkPart(id: string): ShelfJunkPart | undefined {
  const p = (SHELF_JUNK_ATLAS.parts as Record<string, ShelfJunkPart | undefined>)[id];
  return p && [p.w, p.h, p.d].every(v => Number.isFinite(v) && v > 0.004) ? p : undefined;
}

/**
 * The prop's upright box (m): the cooked part's real size when the registry has it (mm-rounded), else the estimate. An upright
 * cylinder collider keeps w = d (its footprint is a circle). Static per build: layout never depends on what loaded.
 */
export function junkDims(j: JunkProp): [number, number, number] {
  const p = junkPart(j.id);
  let [w, h, d] = p ? [p.w, p.h, p.d].map(v => Math.round(v * 1000) / 1000) : j.est;
  if (j.collider === 'cylinder') w = d = Math.max(w, d);
  return [w, h, d];
}

/** Triangles of one cooked part (registry), or undefined (stub: the fallback's own count applies). */
export function junkTris(j: JunkProp): number | undefined {
  const t = junkPart(j.id)?.tris;
  return t !== undefined && Number.isFinite(t) && t > 0 ? t : undefined;
}

/** Mesh node name of a part in the atlas GLB (the registry's, else the prop id). */
export function junkNode(id: string): string {
  return junkPart(id)?.node ?? id;
}

/** The registry has cooked parts (the atlas is worth fetching). */
export function junkAtlasCooked(): boolean {
  return JUNK_PROPS.some(j => junkPart(j.id));
}
