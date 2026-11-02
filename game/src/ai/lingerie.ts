// Task mall-lingerie-20261102-221554 — TYPED STUB written by lane CONTEXT for lane FIT's API (LANES.md "Contracts" + FIT's contract
// relayed by the primary): the same exported names and shapes, so the spawn context / look plumbing (ai/spawnLook.ts, game.ts) builds
// and is tested before lane FIT lands. Lane FIT's real module REPLACES this file when lane/ling-fit is merged.
//
// FIT's contract: each set = two wearables `lingerie-<design>-top` (slot upper) + `lingerie-<design>-bottom` (slot lower) in
// `outfit-lingerie-<design>.glb` (nodes `Outfit_<wearableId>__<body>`), in a SEPARATE WardrobeLibrary (createLingerieLibrary) so the
// ordinary pickZombieLook pool can never pick them, loaded lazily (LINGERIE_MODEL_FILES, through Game.propModels).
// Stub: no set is fitted and no file is listed — the library has nothing to build, so isValid rejects every lingerie look and
// ai/spawnLook.ts gives the spawn the ordinary, fully clothed wardrobe pick. A body is never shown without a top and a bottom garment.

import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {hashString, mulberry32} from '../core/rng';
import {WardrobeLibrary, type WearableDef, type ZombieLook} from './wardrobe';
import {ZOMBIE_BODIES} from './outfits';

/** The six lingerie designs (user reference images; Meshy T2.5 garments fitted by lane FIT). */
export type LingerieDesign = 'green' | 'purple' | 'blush' | 'black' | 'red' | 'ivory';
export type LingerieSetId = `lingerie-${LingerieDesign}`;
export const LINGERIE_DESIGNS: readonly LingerieDesign[] = ['green', 'purple', 'blush', 'black', 'red', 'ivory'];

export interface LingerieSetDef {
  id: LingerieSetId;
  label: string;
  /** ZOMBIE_BODIES ids the set is fitted to (lane BODY's pale bodies). */
  bodies: readonly string[];
}

/** The fitted sets (lane FIT). Stub: none fitted yet. */
export const LINGERIE_SETS: readonly LingerieSetDef[] = [];

/** The three store-local bodies (lane BODY's ZOMBIE_BODIES ids). */
export const LINGERIE_BODY_IDS = ['paleGaze', 'paleRevenant', 'paleApparition'] as const;

/** Lazily loaded garment files: library key -> url + bytes (Game.propModels). Stub: none. */
export const LINGERIE_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {};

/** The lingerie wearables (top + bottom per set). Stub: none. */
export const LINGERIE_WEARABLES: readonly WearableDef[] = [];

/** The separate lingerie look library over the loaded models (the pale bodies + the lingerie wearables only). */
export function createLingerieLibrary(models: Record<string, GLTF | undefined>): WardrobeLibrary {
  return new WardrobeLibrary(models, ZOMBIE_BODIES.filter(b => (LINGERIE_BODY_IDS as readonly string[]).includes(b.id)), LINGERIE_WEARABLES);
}

/**
 * The lingerie look of store-local spawn `spawnIndex` of the layout seeded `seed`: deterministic per (seed, index) — the same on every
 * rebuild (revisit, streaming, Retry), independent of every other stream. Stub: a pale body + a design's top + bottom ids (not fitted:
 * the stub library rejects it). FIT: `usable` (optional) restricts the pick to buildable fits (e.g. l => lib.isValid(l)).
 */
export function lingerieLook(seed: number, spawnIndex: number, _usable?: (look: ZombieLook) => boolean): ZombieLook {
  const rand = mulberry32(hashString(`lingerie-look:${spawnIndex}`, seed >>> 0));
  rand();
  const body = LINGERIE_BODY_IDS[Math.floor(rand() * LINGERIE_BODY_IDS.length)];
  const design = LINGERIE_DESIGNS[Math.floor(rand() * LINGERIE_DESIGNS.length)];
  return {body, wear: {upper: `lingerie-${design}-top`, lower: `lingerie-${design}-bottom`}};
}
