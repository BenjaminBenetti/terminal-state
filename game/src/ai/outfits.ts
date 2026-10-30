// Zombie appearance registry DATA (iteration 06 slot-based wardrobe; logic in ai/wardrobe.ts).
// Data-driven and level-generic: a level supplies a ZombiePool (weights per body/wearable and the
// weight of "nothing" per slot); the registry lists every body and wearable derivative built by
// tools/asset-pipeline/zombie (runtime GLBs zombie-body-<id>.glb / outfit-<id>.glb, provenance in
// public/assets/derivatives/). A body x wearable pair exists only where the offline fit produced a
// variant node for that body; looks are composed from slots (upper, lower, head, face).
// The 'coated' archetype wears a heavy (long-coat) upper; shamblers a light upper or none.
// Iteration 07: every upper / pants variant is refitted so the cloth sits OUTSIDE the posed body
// (tools/asset-pipeline/zombie/lib/fit07.mjs, validated in 92 poses); pairs whose body still visibly
// pokes through are NOT shipped (no variant node), and upper x pants layerings that still clip on a
// given body are per-body incompatibilities (variant extras incompatibleWear, honoured by
// WardrobeLibrary.compatible). Hats are fitted to the measured cranium (lib/headwear.mjs).
// See derivatives/zombie-wardrobe.json (fit07 gate) and derivatives/zombie-wardrobe-fit-audit.json.
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
  // Meshy T2.5 migration (2026-10-29): rebuilt from a T2.5 model of a RECREATED reference image of the old user upload
  // (zombie-pixal3d; user update 01, labelled not-original). Its built-in gas mask and straps still fill the head/face
  // slots (registry unchanged); it now wears fitted pants / jackets (the old fused upload could not).
  {id: 'scavenger', label: 'Masked scavenger', model: 'zombieBody_scavenger', weight: 1, origin: 'generated', covers: ['head', 'face'], tags: ['gasmask']},
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
  // iteration 07: the puffer fails the fit gate on EVERY body (its huge collar / quilted shell still lets the
  // body poke through after the refit): no variant ships and its model is not in the runtime manifest
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

