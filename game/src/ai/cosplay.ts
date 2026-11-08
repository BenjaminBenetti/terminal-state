// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the Skyways anime convention's COSPLAY ZOMBIES' wardrobe.
//
// User: "the anime convention "event" should have special "cosplay zombies" spawned, which are just zombies wearing special clothing."
// A cosplay zombie is an ORDINARY zombie (zombie family, ordinary health / damage / AI / audio / clips) whose wardrobe look is a COSTUME
// instead of the ordinary pick. The costumes (cosplay.generated.ts COSPLAY_BUILD_COSTUMES, built by
// tools/asset-pipeline/zombie/build-cosplay.mjs from approved models only — no generation) are one piece per slot:
//   bear-idol     the convention mascot's bear-ear hat + blue wig (split from the mascot statue), cream knit top, maroon trousers
//   mascot-suit   an oversized mascot costume head (the statue's head), cocoa hoodie, maroon trousers
//   sushi-fan     the nigiri-sushi mascot as a novelty hat, salmon hoodie, rice-white trousers
//   rose-uniform  the mascot hat + wig in an alternate palette (cream hat, rose wig), navy uniform blazer, the ordinary grey slacks
// Isolation (the precedent: ai/lingerie.ts): the cosplay wearables are NOT in the ordinary registry (ai/outfits.ts ZOMBIE_WEARABLES) and
// have weight 0; they are assembled by their OWN WardrobeLibrary (createCosplayLibrary), used only for spawns tagged look 'cosplay'
// (gen/skyways/cosplaySpawns.ts, the convention venue of a version-5 Skyways layout), so the ordinary pickZombieLook pool can never dress
// anyone in a costume. Files load lazily (COSPLAY_MODEL_FILES, not the boot MODEL_FILES): only for a layout holding a cosplay spawn.
// All derivatives are unapproved prototypes (gameReady false); provenance assets/derivatives/outfit-cosplay.json.

import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {hashString, mulberry32} from '../core/rng';
import {WardrobeLibrary, type WardrobeSlot, type WearableDef, type ZombieBodyDef, type ZombieLook} from './wardrobe';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES} from './outfits';
import {COSPLAY_BUILD_COSTUMES, COSPLAY_FILES} from './cosplay.generated';

/** The spawn-context / look tag of the convention's cosplay zombies (ZombieSpawn.look, SpawnContextId). */
export const COSPLAY_LOOK = 'cosplay' as const;

export interface CosplayCostume {
  id: string;
  label: string;
  /** Wearable id per slot (head = the costume piece; upper / lower = dyed garments, or an ordinary one reused). */
  pieces: {head: string; upper: string; lower: string};
  /** Bodies every piece of the costume is fitted to (the build's gate). */
  bodies: readonly string[];
}
export const COSPLAY_COSTUMES: readonly CosplayCostume[] = COSPLAY_BUILD_COSTUMES;

/** Lazily loaded cosplay files: model key -> url + exact bytes (progress weight). */
export const COSPLAY_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(COSPLAY_FILES.map(f => [f.model, {url: f.url, bytes: f.bytes}]));

/** The cosplay wearables (weight 0: never part of an ordinary selection pool), tagged 'cosplay'. */
export const COSPLAY_WEARABLES: readonly WearableDef[] = COSPLAY_FILES.flatMap(f => f.wearables.map(w => ({
  id: w.id, slot: f.slot as WardrobeSlot, label: w.label, model: f.model, weight: 0, tags: ['cosplay'], origin: 'derived' as const,
})));
const COSPLAY_WEAR_IDS = new Set(COSPLAY_WEARABLES.map(w => w.id));
export const isCosplayWearable = (id: string | undefined | null): boolean => !!id && COSPLAY_WEAR_IDS.has(id);

/** Ordinary wearables a costume reuses unchanged (the uniform's grey slacks): their ordinary boot model, weight 0 in this library. */
const REUSED: readonly WearableDef[] = ZOMBIE_WEARABLES.filter(w => !COSPLAY_WEAR_IDS.has(w.id) && COSPLAY_COSTUMES.some(c => Object.values(c.pieces).includes(w.id))).map(w => ({...w, weight: 0}));

/** Every shipped (costume, body) fit, in costume order. */
export const COSPLAY_FITS: readonly {costume: string; body: string}[] = COSPLAY_COSTUMES.flatMap(c => c.bodies.map(body => ({costume: c.id, body})));

/**
 * The cosplay WardrobeLibrary: the bodies of the shipped fits + only the cosplay wearables (and the ordinary pieces a costume reuses).
 * `models` = the boot models plus the loaded lazy cosplay files (COSPLAY_MODEL_FILES keys). A piece whose file is not loaded (or whose
 * node for a body is missing / stale: the geometry-hash guard) is simply unavailable; isValid(look) tells.
 */
export function createCosplayLibrary(models: Record<string, GLTF | undefined>, bodies: readonly ZombieBodyDef[] = ZOMBIE_BODIES): WardrobeLibrary {
  const ids = new Set(COSPLAY_FITS.map(f => f.body));
  return new WardrobeLibrary(models, bodies.filter(b => ids.has(b.id)), [...COSPLAY_WEARABLES, ...REUSED]);
}

export interface CosplayLook extends ZombieLook {
  /** The costume id ('bear-idol', ...). */
  costume: string;
}

/**
 * Deterministic costume look for a cosplay spawn, by (station seed, spawn index), independent of every other random stream: a per-seed
 * shuffled order of the COSTUMES entered at a per-seed offset and stepped by the spawn index (consecutive spawns wear different costumes,
 * all four before any repeats), then the body a per-(seed, index) pick among that costume's fitted bodies. The same (seed, index) always
 * gets the same look (revisit / streaming / Retry). `usable` (optional, e.g. `look => lib.isValid(look)`) restricts the choice to looks
 * that can be built (a costume with no usable body is skipped). Always all three slots.
 */
export function cosplayLook(seed: number, spawnIndex: number, usable?: (look: CosplayLook) => boolean): CosplayLook {
  const lookOf = (c: CosplayCostume, body: string): CosplayLook => ({body, wear: {head: c.pieces.head, upper: c.pieces.upper, lower: c.pieces.lower}, costume: c.id});
  const options = COSPLAY_COSTUMES.map(c => ({c, bodies: usable ? c.bodies.filter(b => usable(lookOf(c, b))) : [...c.bodies]})).filter(o => o.bodies.length);
  const pool = options.length ? options : COSPLAY_COSTUMES.filter(c => c.bodies.length).map(c => ({c, bodies: [...c.bodies]}));
  if (!pool.length) return {body: ZOMBIE_BODIES[0].id, wear: {}, costume: ''};
  const rand = mulberry32(hashString('cosplay-looks', seed >>> 0));
  rand();
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const offset = Math.floor(rand() * order.length);
  const k = Math.max(0, Math.floor(spawnIndex));
  const o = pool[order[(offset + k) % order.length]];
  const bodyRand = mulberry32(hashString(`cosplay-body:${k}`, seed >>> 0));
  return lookOf(o.c, o.bodies[Math.floor(bodyRand() * o.bodies.length) % o.bodies.length]);
}
