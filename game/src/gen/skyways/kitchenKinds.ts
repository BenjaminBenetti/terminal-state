// Task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways ramen restaurant's NEW PROP KINDS — the commercial gas range, the
// stock pot and the saucepan on it, and the kawaii sushi mascot figurine on the service counter. Pure data (no three.js). Each kind is
// classified here for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md) and spread into the shared
// tables by one tagged line each: gen/props.ts PROP_DEFS (+ PropKind), damage/materials.ts PROP_DAMAGE, damage/physicsAudit.ts
// PROP_PHYSICS_AUDIT, world/openablesSpec.ts OPENABLE_AUDIT. Drawn by world/skywaysKitchen.ts (the level-only lazy `skyways-*` models,
// a plain box stand-in while a model is not loaded); the lazy keys come from skywaysKitchenModelKeysFor (game.ts sectionModelKeys).
//
// Models: lane ASSET-A's derivatives of the user's community-supplied Meshy sources (assets/skywaysFoodModels.ts: real size, +Y up,
// front +Z, grounded, centred; the source maps kept). Footprints = the models' real bounds, except the RANGE, whose collision box stops
// at its COOKTOP (SKYWAYS_RANGE_COOKTOP_Y, the work surface its pots stand on — a static host top, like a desk's for its monitor): the
// thin backguard / high shelf rising above the cooktop at the back is drawn by the model only (bullets / sight pass that sheet).
//
// Affordances:
//  - range: anchored equipment (a ~250 kg gas range levelled on its feet and hard-piped to the gas line) — static; its oven doors are the
//    appliance's (cold, empty ovens: not storage) — an explicit openables EXCEPTION;
//  - stock pot / saucepan: loose cookware standing on the range's cooktop (on-host decor: `onHost`) — dynamic: a shot knocks it off the
//    range / along it (they react to bullets; a walker's legs never reach a raised prop); plausible masses; nothing to open (the stock
//    pot's lid is part of its one mesh: cookware, not storage — an exception with its reason);
//  - sushi mascot: a ~0.8 kg resin display figurine standing on the service counter (on-host decor) — dynamic like the pots.
// No loose items are baked into any model (rule 4): the bowls, bento and cups are separate item pickups / holder lots.

import type {PropDef} from '../props';
import type {DamageClass, PhysMat, StaticWhy} from '../../damage/materials';
import {SKYWAYS_FOOD_MODELS, SKYWAYS_FOOD_MODEL_BYTES, SKYWAYS_RANGE_COOKTOP_Y, type SkywaysFoodModelKey} from '../../assets/skywaysFoodModels';

export const SKYWAYS_KITCHEN_KINDS = ['skywaysRange', 'skywaysStockPot', 'skywaysSaucepan', 'skywaysSushiMascot'] as const;
export type SkywaysKitchenKind = (typeof SKYWAYS_KITCHEN_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(SKYWAYS_KITCHEN_KINDS);
export const isSkywaysKitchenKind = (k: string): k is SkywaysKitchenKind => KIND_SET.has(k);

/** The model each kind renders with (assets/skywaysFoodModels.ts key). */
export const SKYWAYS_KITCHEN_MODEL: Readonly<Record<SkywaysKitchenKind, SkywaysFoodModelKey>> = {
  skywaysRange: 'skyways_commercial_range', skywaysStockPot: 'skyways_stock_pot', skywaysSaucepan: 'skyways_saucepan', skywaysSushiMascot: 'skyways_sushi_mascot',
};
/** Lazy model-library key of a kind: the runtime file name ('skyways-' prefix: a level-only Skyways file, assets/levelAssets.ts). */
export const skywaysKitchenModelKey = (k: SkywaysKitchenKind): string => SKYWAYS_FOOD_MODELS[SKYWAYS_KITCHEN_MODEL[k]].url.replace(/^.*\//, '').replace(/\.glb$/, '');

/** Lazy file map (game.ts propModels catalogue): `skyways-commercial-range` -> assets/models/skyways-commercial-range.glb, ... */
export const SKYWAYS_KITCHEN_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(SKYWAYS_KITCHEN_KINDS.map(k => {
  const m = SKYWAYS_KITCHEN_MODEL[k];
  return [skywaysKitchenModelKey(k), {url: SKYWAYS_FOOD_MODELS[m].url, bytes: SKYWAYS_FOOD_MODEL_BYTES[m]}];
}));

/** Rigid-body row (damage/materials.ts PropPhysics shape) or the static reason. */
type KitchenPhys =
  | {dynamic: true; mass: number; mat: PhysMat; shape: 'box' | 'cylinder'; how: string}
  | {dynamic: false; why: StaticWhy; how: string};

/** Physics affordance of each kind (damage/physicsAudit.ts PROP_PHYSICS_AUDIT reads it; the live physics come from PROP_DEFS.physics). */
export const SKYWAYS_KITCHEN_PHYS: Readonly<Record<SkywaysKitchenKind, KitchenPhys>> = {
  skywaysRange: {dynamic: false, why: 'anchored', how: 'commercial gas range (~250 kg of steel and cast-iron grates) levelled on its feet against the kitchen wall and hard-piped to the gas line: a bump or a bullet does not shove it; its stock pot / saucepan are separate loose props on its cooktop'},
  skywaysStockPot: {dynamic: true, mass: 3.5, mat: 'metal', shape: 'cylinder', how: 'empty 20 l stainless stock pot with its lid (~3.5 kg) standing on the range: a shot knocks it along / off the cooktop (on-host decor: out of reach of a walker\'s legs)'},
  skywaysSaucepan: {dynamic: true, mass: 1.3, mat: 'metal', shape: 'box', how: 'rusty steel saucepan (~1.3 kg) standing on the range: a shot spins / knocks it off the cooktop (on-host decor)'},
  skywaysSushiMascot: {dynamic: true, mass: 0.8, mat: 'plastic', shape: 'box', how: 'kawaii sushi display figurine (~0.8 kg of painted resin) on the service counter: a shot knocks it over / off the counter (on-host decor)'},
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
function defOf(k: SkywaysKitchenKind): PropDef {
  const m = SKYWAYS_FOOD_MODELS[SKYWAYS_KITCHEN_MODEL[k]], ph = SKYWAYS_KITCHEN_PHYS[k];
  const h = k === 'skywaysRange' ? SKYWAYS_RANGE_COOKTOP_Y : m.h;
  // dynamic on-host decor: `onHost` (goes loose on its static host's top) + `contact` (the calibrated contact-wake rules; a raised
  // prop is never shoved by legs) — read by damage/materials.ts propPhysics before PROP_PHYSICS
  return {w: r3(m.w), d: r3(m.d), h: r3(h), blocksSight: false,
    ...(ph.dynamic ? {physics: {mass: ph.mass, dynamic: true, shape: ph.shape, mat: ph.mat as 'metal' | 'plastic', onHost: true, contact: true}} : {})};
}
export const SKYWAYS_KITCHEN_PROP_DEFS: Readonly<Record<SkywaysKitchenKind, PropDef>> = Object.fromEntries(SKYWAYS_KITCHEN_KINDS.map(k => [k, defOf(k)])) as Record<SkywaysKitchenKind, PropDef>;

/** Damage class (damage/materials.ts PropDamageSpec, 'never' breaks: dents / chips / sparks only — no destructibility system). */
export const SKYWAYS_KITCHEN_DAMAGE_CLASS: Readonly<Record<SkywaysKitchenKind, DamageClass>> = {
  skywaysRange: 'steel', skywaysStockPot: 'steel', skywaysSaucepan: 'sheetMetal', skywaysSushiMascot: 'plastic',
};

/** Openables audit rows (world/openablesSpec.ts OPENABLE_AUDIT; every kind classified, honest reason). */
export const SKYWAYS_KITCHEN_OPEN_AUDIT: readonly {kind: SkywaysKitchenKind; cls: 'exception' | 'none'; role: 'equipment' | 'decor'; how: string}[] = [
  {kind: 'skywaysRange', cls: 'exception', role: 'equipment', how: 'commercial gas range: its two oven doors are the appliance\'s (cold, empty ovens — not storage; no appliance simulation); anchored equipment. The kitchen\'s storage is its fridge and shelving'},
  {kind: 'skywaysStockPot', cls: 'exception', role: 'equipment', how: 'stock pot: cookware, not storage — its lid is part of the pot\'s one mesh and the pot is empty (the food is the bowls / bento / cups, separate items)'},
  {kind: 'skywaysSaucepan', cls: 'none', role: 'equipment', how: 'open saucepan: no lid, door or drawer'},
  {kind: 'skywaysSushiMascot', cls: 'none', role: 'decor', how: 'solid resin display figurine: nothing to open'},
];

/** Game.sectionModelKeys: the lazy model keys of the kitchen kinds a layout placed (none outside a Skyways ramen restaurant). */
export function skywaysKitchenModelKeysFor(layout: {props?: readonly {kind: string}[]}): readonly string[] {
  const out = new Set<string>();
  for (const p of layout.props ?? []) if (isSkywaysKitchenKind(p.kind)) out.add(skywaysKitchenModelKey(p.kind));
  return [...out].sort();
}
