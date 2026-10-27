// Zombie appearance registry DATA (iteration 06 slot-based wardrobe; logic in ai/wardrobe.ts).
// Data-driven and level-generic: a level supplies a ZombiePool (weights per body/wearable and the
// weight of "nothing" per slot); the registry lists every body and wearable derivative built by
// tools/asset-pipeline/zombie (runtime GLBs zombie-body-<id>.glb / outfit-<id>.glb, provenance in
// public/assets/derivatives/). A body x wearable pair exists only where the offline fit produced a
// variant node for that body; looks are composed from slots (upper, lower, head, face).
// The 'coated' archetype wears a heavy (long-coat) upper; shamblers a light upper or none.
// All derivatives are unapproved prototypes (gameReady false).

import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {WardrobeLibrary, type ZombieBodyDef, type WearableDef, type ZombieLook} from './wardrobe';

export {
  WardrobeLibrary, pickZombieLook, outfitNodeName, lookKey, normalizeLook, wearablesCompatible, wearableFitsBodyRules,
  SLOTS, PICK_ORDER, DEFAULT_NONE_WEIGHTS, DEFAULT_ZOMBIE_POOL, HIT_CALIBRATION, REFERENCE_HIT, isWardrobeSlot,
} from './wardrobe';
export type {
  WardrobeSlot, ZombieBodyDef, WearableDef, ZombieOutfitDef, ZombieLook, LegacyZombieLook, ZombiePool, HitRadii, MeshSlot,
  ZombieAppearance, WardrobeAvailability, LegacyAvailability, LookCounts,
} from './wardrobe';

export const ZOMBIE_BODIES: readonly ZombieBodyDef[] = [
  {id: 'lastshift', label: 'Last-shift worker', model: 'zombieBody_lastshift', weight: 1, origin: 'generated', tags: ['hair']},
  {id: 'courier', label: 'Bike courier', model: 'zombieBody_courier', weight: 1, origin: 'generated', tags: ['hair']},
  {id: 'agent', label: 'Station agent', model: 'zombieBody_agent', weight: 1, origin: 'generated', tags: ['hair', 'curly-hair']},
  // REUSED original user upload (zombie-pixal3d), re-posed T -> A; its hood and built-in gas mask
  // already fill the head/face slots. Iteration 06 repaired the derivative (arm/torso webbing)
  // instead of hiding it by rarity.
  {id: 'scavenger', label: 'Masked scavenger (reused original upload)', model: 'zombieBody_scavenger', weight: 1, origin: 'reused', covers: ['head', 'face'], tags: ['hood', 'gasmask']},
  // Iteration 06 base-layer bodies (generated wearing an opaque tank top/t-shirt + shorts/briefs + socks):
  // they always get pants at runtime.
  {id: 'heavyset', label: 'Heavyset man (base layer)', model: 'zombieBody_heavyset', weight: 1, origin: 'generated', requires: ['lower'], tags: ['shaved-head', 'base-layer']},
  {id: 'tall', label: 'Tall woman (base layer)', model: 'zombieBody_tall', weight: 1, origin: 'generated', requires: ['lower'], tags: ['short-hair', 'base-layer']},
];

export const ZOMBIE_WEARABLES: readonly WearableDef[] = [
  // upper
  {id: 'coat', slot: 'upper', label: 'Hi-vis parka (long coat)', model: 'outfit_coat', weight: 1, heavy: true, tags: ['long', 'hood-down'], origin: 'generated'},
  {id: 'trench', slot: 'upper', label: 'Trench coat', model: 'outfit_trench', weight: 1, heavy: true, tags: ['long'], origin: 'generated'},
  {id: 'hivis', slot: 'upper', label: 'Hi-vis vest', model: 'outfit_hivis', weight: 1, tags: ['vest'], origin: 'generated'},
  {id: 'hoodie', slot: 'upper', label: 'Zip hoodie', model: 'outfit_hoodie', weight: 1, tags: ['hood-down'], origin: 'generated'},
  {id: 'blazer', slot: 'upper', label: 'Office blazer', model: 'outfit_blazer', weight: 1, origin: 'generated'},
  {id: 'puffer', slot: 'upper', label: 'Puffer jacket', model: 'outfit_puffer', weight: 1, tags: ['bulky-collar'], origin: 'generated'},
  {id: 'flannel', slot: 'upper', label: 'Plaid flannel shirt', model: 'outfit_flannel', weight: 1, tags: ['shirt'], origin: 'generated'},
  {id: 'sweater', slot: 'upper', label: 'Cable-knit sweater', model: 'outfit_sweater', weight: 1, tags: ['knit'], origin: 'generated'},
  // lower (pants): fitted to each body's legs; always layered under the upper garment
  {id: 'cargo', slot: 'lower', label: 'Olive cargo work pants', model: 'outfit_cargo', weight: 1, origin: 'generated'},
  {id: 'jeans', slot: 'lower', label: 'Dark-wash jeans', model: 'outfit_jeans', weight: 1, origin: 'generated'},
  {id: 'slacks', slot: 'lower', label: 'Grey office slacks', model: 'outfit_slacks', weight: 1, origin: 'generated'},
  // head (rigid to the Head bone)
  {id: 'hardhat', slot: 'head', label: 'Transit hard hat', model: 'outfit_hardhat', weight: 1, tags: ['helmet'], origin: 'generated'},
  {id: 'cap', slot: 'head', label: 'Faded baseball cap', model: 'outfit_cap', weight: 1, tags: ['brim'], origin: 'generated'},
  {id: 'beanie', slot: 'head', label: 'Knit beanie', model: 'outfit_beanie', weight: 1, tags: ['knit'], origin: 'generated'},
  // face (rigid to the Head bone); the user likes the gas mask as an OPTION - a minority by default pool weights
  {id: 'gasmask', slot: 'face', label: 'Full-face gas mask', model: 'outfit_gasmask', weight: 1, tags: ['mask', 'full-face'], origin: 'generated'},
  {id: 'respirator', slot: 'face', label: 'Half-face respirator', model: 'outfit_respirator', weight: 1, tags: ['mask'], origin: 'generated'},
];

/** Backward-compatible list of the upper-slot wearables (iteration 05 "outfits"). */
export const ZOMBIE_OUTFITS: readonly WearableDef[] = ZOMBIE_WEARABLES.filter(w => w.slot === 'upper');

/** The default registry assembler (game.ts: `new ZombieLookLibrary(models)`). */
export class ZombieLookLibrary extends WardrobeLibrary {
  constructor(models: Record<string, GLTF | undefined>, bodies: readonly ZombieBodyDef[] = ZOMBIE_BODIES, wearables: readonly WearableDef[] = ZOMBIE_WEARABLES) {
    super(models, bodies, wearables);
  }
}

/** Iteration-05 helper: each body's base look plus each upper wearable alone (no slot combinations). */
export function allZombieLooks(bodies: readonly ZombieBodyDef[] = ZOMBIE_BODIES, outfits: readonly WearableDef[] = ZOMBIE_OUTFITS): ZombieLook[] {
  return bodies.flatMap(b => [{body: b.id, wear: {}}, ...outfits.filter(o => !b.covers?.includes(o.slot)).map(o => ({body: b.id, wear: {[o.slot]: o.id}}))]);
}

