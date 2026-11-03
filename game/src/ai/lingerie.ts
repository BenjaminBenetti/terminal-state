// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): the Mall lingerie store's ORDINARY-zombie variants.
//
// Six lingerie sets (the user's six reference designs, generated as Meshy T2.5 models by the primary, Meshy PBR maps kept) are FITTED
// offline to the three pale female zombie bodies (tools/asset-pipeline/zombie/build-lingerie.mjs: landmark alignment, non-rigid
// conformity to the body surface, skin weights transferred from the body, pose-aware clearance through all six clips, covered body
// triangles hidden). Each set ships as outfit-lingerie-<design>.glb holding TWO wardrobe wearables:
//   lingerie-<design>-top     slot upper  (bra / bustier / the bodysuit's upper half)
//   lingerie-<design>-bottom  slot lower  (brief / thong + garter belt, suspender straps, thigh rings / the bodysuit's lower half)
// so a lingerie look is a normal ZombieLook {body, wear: {upper, lower}} and the pale bodies' `requires: ['upper', 'lower']` holds:
// a body NEVER appears without both a top and a bottom garment. The one-piece blush bodysuit is cut at the waist into those two
// halves (both always worn together; they share the vertices along the cut, so it renders as one garment).
// Isolation: the lingerie wearables are NOT in the ordinary registry (ai/outfits.ts ZOMBIE_WEARABLES) and have weight 0; they are
// assembled by their OWN WardrobeLibrary (createLingerieLibrary) used only for the store-context spawns (lane CONTEXT: spawns with
// look 'lingerie'), so the ordinary pickZombieLook pool can never dress anyone in lingerie.
// Files are loaded lazily (LINGERIE_MODEL_FILES, not the boot MODEL_FILES): only a section whose layout has a lingerie spawn / store.
// Each GLB also holds static display nodes LingerieDisplay_<design>_top / _bottom (unskinned, same texture) for the store's stock.
// Content: ordinary zombie clips only (the bodies' own Idle / Walk / Run / Attack / Hit / Death); opaque lace, full coverage.
// All derivatives are unapproved prototypes (gameReady false).

import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {hashString, mulberry32} from '../core/rng';
import {WardrobeLibrary, type WearableDef, type ZombieBodyDef, type ZombieLook} from './wardrobe';
import {ZOMBIE_BODIES} from './outfits';
import {LINGERIE_BUILD} from './lingerie.generated';

/** The three pale female zombie bodies (lane BODY's ordinary-pool bodies) the lingerie sets are fitted to. */
export const LINGERIE_BODY_IDS = ['paleGaze', 'paleRevenant', 'paleApparition'] as const;
export type LingerieBodyId = typeof LINGERIE_BODY_IDS[number];

export interface LingerieSet {
  /** 'lingerie-<design>' */
  id: string;
  design: string;
  label: string;
  /** Lazy model key of outfit-lingerie-<design>.glb. */
  model: string;
  url: string;
  bytes: number;
  /** Wardrobe wearable ids per slot. */
  pieces: {upper: string; lower: string};
  pieceLabels: {upper: string; lower: string};
  /** Bodies this set is fitted to (one skinned variant per body). */
  bodies: readonly string[];
  /** Static display nodes inside the same GLB: centred in x / z, lowest point at y = 0, front +Z, real worn size (fitted on `fittedOn`). */
  display: {top: string; bottom: string; fittedOn: string; setSizeM: readonly number[] | null};
}

export const LINGERIE_SETS: readonly LingerieSet[] = LINGERIE_BUILD.map(s => ({
  id: s.id, design: s.design, label: s.label, model: s.model, url: s.url, bytes: s.bytes,
  pieces: {upper: s.top, lower: s.bottom}, pieceLabels: {upper: s.topLabel, lower: s.bottomLabel}, bodies: s.bodies, display: s.display,
}));

/** Lazily loaded lingerie set files: model key -> url + exact bytes (progress weight). */
export const LINGERIE_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(LINGERIE_SETS.map(s => [s.model, {url: s.url, bytes: s.bytes}]));

/** The wardrobe wearables of every set (weight 0: never part of an ordinary selection pool). */
export const LINGERIE_WEARABLES: readonly WearableDef[] = LINGERIE_SETS.flatMap(s => [
  {id: s.pieces.upper, slot: 'upper' as const, label: `${s.label}: ${s.pieceLabels.upper}`, model: s.model, weight: 0, tags: ['lingerie', s.id], origin: 'generated' as const},
  {id: s.pieces.lower, slot: 'lower' as const, label: `${s.label}: ${s.pieceLabels.lower}`, model: s.model, weight: 0, tags: ['lingerie', s.id], origin: 'generated' as const},
]);

const LINGERIE_WEAR_IDS = new Set(LINGERIE_WEARABLES.map(w => w.id));
export const isLingerieWearable = (id: string | undefined | null): boolean => !!id && LINGERIE_WEAR_IDS.has(id);

/** Every shipped (set, body) fit, in set order. */
export const LINGERIE_FITS: readonly {set: string; body: string}[] = LINGERIE_SETS.flatMap(s => s.bodies.map(body => ({set: s.id, body})));

/** Registry entries of the pale bodies (lane BODY); contract-identical fallbacks until those land in ZOMBIE_BODIES. */
function lingerieBodies(bodies: readonly ZombieBodyDef[]): ZombieBodyDef[] {
  return LINGERIE_BODY_IDS.map(id => bodies.find(b => b.id === id) ?? {id, label: id, model: `zombieBody_${id}`, weight: 0, origin: 'reused' as const, requires: ['upper', 'lower'] as const});
}

/**
 * The lingerie WardrobeLibrary: the pale bodies + only the lingerie wearables. `models` = the boot models plus the loaded lazy
 * lingerie files (LINGERIE_MODEL_FILES keys). A set whose file is not loaded (or whose node for a body is missing / stale: the
 * geometry-hash guard) is simply unavailable; isValid(look) tells.
 */
export function createLingerieLibrary(models: Record<string, GLTF | undefined>, bodies: readonly ZombieBodyDef[] = ZOMBIE_BODIES): WardrobeLibrary {
  return new WardrobeLibrary(models, lingerieBodies(bodies), LINGERIE_WEARABLES);
}

export interface LingerieLook extends ZombieLook {
  /** 'lingerie-<design>' */
  set: string;
}

/**
 * Deterministic lingerie look for a store-context spawn, by (station seed, spawn index), independent of every other random stream:
 * a per-seed shuffled order of the shipped (set, body) fits, entered at a per-seed offset and stepped by the spawn index, so a
 * store's consecutive spawns wear different sets (up to six) and the same (seed, index) always gets the same look (revisit /
 * streaming / Retry). `usable` (optional, e.g. `look => lib.isValid(look)`) restricts the choice to fits that can be built.
 * Always both slots: upper = the set's top, lower = its bottom.
 */
export function lingerieLook(seed: number, spawnIndex: number, usable?: (look: LingerieLook) => boolean): LingerieLook {
  const all = LINGERIE_FITS.map(f => { const s = LINGERIE_SETS.find(x => x.id === f.set)!; return {body: f.body, wear: {upper: s.pieces.upper, lower: s.pieces.lower}, set: s.id}; });
  const fits = usable ? all.filter(l => usable(l)) : all;
  const pool = fits.length ? fits : all;
  if (!pool.length) return {body: LINGERIE_BODY_IDS[0], wear: {}, set: ''};
  const rand = mulberry32(hashString('lingerie-looks', seed >>> 0));
  rand();
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const offset = Math.floor(rand() * order.length);
  const k = order[(offset + Math.max(0, Math.floor(spawnIndex))) % order.length];
  const l = pool[k];
  return {body: l.body, wear: {...l.wear}, set: l.set};
}

/** Static display stock of every set (lane STORE): model key + node names inside that GLB. */
export const LINGERIE_DISPLAYS: readonly {set: string; model: string; nodes: {top: string; bottom: string}; setSizeM: readonly number[] | null}[] =
  LINGERIE_SETS.map(s => ({set: s.id, model: s.model, nodes: {top: s.display.top, bottom: s.display.bottom}, setSizeM: s.display.setSizeM}));
