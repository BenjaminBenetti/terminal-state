// The Skyways anime convention's COSPLAY ZOMBIES' wardrobe.
//
// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY), user: "the anime convention "event" should have special "cosplay
// zombies" spawned, which are just zombies wearing special clothing." A cosplay zombie is an ORDINARY zombie (zombie family, ordinary
// health / damage / AI / audio / clips) whose wardrobe look is a COSTUME instead of the ordinary pick.
//
// Task studio-cosplay-general-20261108-225231-01 (lane COSTUME), user: "Current hat-only costumes are low effort. Full costume / clothing
// swap. 70% female zombie variants, preferably unclothed base variants IN COMPLETE CLOTHES for fit, no unclothed final characters."
// The costumes are now FULL head-to-toe costumes (cosplayCostumes.generated.ts, built by tools/asset-pipeline/zombie/
// build-cosplay-costumes.mjs from the primary's Meshy garment masters; Meshy maps kept): a head piece (the convention mascot's bear-ear
// hat - with its wig on short hair, alone on the long-haired pale bodies -, the oversized mascot costume head, the sushi hat), an upper
// (jacket / kigurumi top / happi coat / blazer) and a lower that runs down to and includes the footwear:
//   bear-idol     idol jacket, tiered skirt, thigh-high stockings, platform boots (female bodies)
//   mascot-suit   bear kigurumi top with paw mitts, onesie trousers, paw slippers (every presentation)
//   sushi-fan     happi coat with sash, hakama trousers, tabi boots (every presentation)
//   rose-uniform  sailor-collar blazer, pleated skirt, knee socks, mary-janes (female bodies)
// Presentation: ~70 % of the convention's cosplayers wear a FEMALE body (the pale unclothed bodies preferred - always in the complete
// costume - plus the tall woman), the rest the male bodies; deterministic per (seed, spawn index) and local to the convention (the
// ordinary pool's body weights are untouched). The old dyed-garment pieces (outfit-cosplay-*.glb) stay in the repository, unreferenced.
// Isolation (the precedent: ai/lingerie.ts): the costume wearables are NOT in the ordinary registry (ai/outfits.ts ZOMBIE_WEARABLES) and
// have weight 0; they are assembled by their OWN WardrobeLibrary (createCosplayLibrary), used only for spawns tagged look 'cosplay'
// (gen/skyways/cosplaySpawns.ts), so the ordinary pickZombieLook pool can never dress anyone in a costume. Files load lazily
// (COSPLAY_MODEL_FILES, not the boot MODEL_FILES) only for a layout holding a cosplay spawn, before the section is built and warmed up.
// All derivatives are unapproved prototypes (gameReady false); provenance assets/derivatives/outfit-cosplay-costume.json.

import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {hashString, mulberry32} from '../core/rng';
import {WardrobeLibrary, type WardrobeSlot, type WearableDef, type ZombieBodyDef, type ZombieLook} from './wardrobe';
import {ZOMBIE_BODIES} from './outfits';
import {COSPLAY_BODY_PRESENTATION, COSPLAY_COSTUME_BUILD, COSPLAY_COSTUME_FILES} from './cosplayCostumes.generated';

/** The spawn-context / look tag of the convention's cosplay zombies (ZombieSpawn.look, SpawnContextId). */
export const COSPLAY_LOOK = 'cosplay' as const;

export interface CosplayCostume {
  id: string;
  label: string;
  /** Wearable id per slot (every piece is a cosplay wearable). */
  pieces: {head: string; upper: string; lower: string};
  /** Bodies every piece of the costume is fitted to (the build's gate). */
  bodies: readonly string[];
}
export const COSPLAY_COSTUMES: readonly CosplayCostume[] = COSPLAY_COSTUME_BUILD;

/** Lazily loaded cosplay files: model key -> url + exact bytes (progress weight). */
export const COSPLAY_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(COSPLAY_COSTUME_FILES.map(f => [f.model, {url: f.url, bytes: f.bytes}]));

/** The cosplay wearables (weight 0: never part of an ordinary selection pool), tagged 'cosplay'. */
export const COSPLAY_WEARABLES: readonly WearableDef[] = COSPLAY_COSTUME_FILES.flatMap(f => f.wearables.map(w => ({
  id: w.id, slot: f.slot as WardrobeSlot, label: w.label, model: f.model, weight: 0, tags: ['cosplay'], origin: 'derived' as const,
})));
const COSPLAY_WEAR_IDS = new Set(COSPLAY_WEARABLES.map(w => w.id));
export const isCosplayWearable = (id: string | undefined | null): boolean => !!id && COSPLAY_WEAR_IDS.has(id);

/** Every shipped (costume, body) fit, in costume order. */
export const COSPLAY_FITS: readonly {costume: string; body: string}[] = COSPLAY_COSTUMES.flatMap(c => c.bodies.map(body => ({costume: c.id, body})));

/** Share of the convention's cosplayers wearing a female body (expected over the convention's seeded spawns). */
export const COSPLAY_FEMALE_SHARE = 0.7;
/** Presentation of a costume body ('female' / 'male'; the build's record of the bodies it fits). */
export const cosplayBodyPresentation = (body: string): 'female' | 'male' | undefined => COSPLAY_BODY_PRESENTATION[body];
/** Body preference within a presentation: the unclothed pale bodies first (always in the complete costume), the base-layer ones less. */
export const COSPLAY_BODY_WEIGHT: Readonly<Record<string, number>> = {paleGaze: 1, paleRevenant: 1, paleApparition: 1, tall: 0.6, lastshift: 1, courier: 1, heavyset: 1};

/**
 * The cosplay WardrobeLibrary: the bodies of the shipped fits + only the cosplay wearables. `models` = the boot models plus the loaded
 * lazy cosplay files (COSPLAY_MODEL_FILES keys). A piece whose file is not loaded (or whose node for a body is missing / stale: the
 * geometry-hash guard) is simply unavailable; isValid(look) tells.
 */
export function createCosplayLibrary(models: Record<string, GLTF | undefined>, bodies: readonly ZombieBodyDef[] = ZOMBIE_BODIES): WardrobeLibrary {
  const ids = new Set(COSPLAY_FITS.map(f => f.body));
  return new WardrobeLibrary(models, bodies.filter(b => ids.has(b.id)), COSPLAY_WEARABLES);
}

export interface CosplayLook extends ZombieLook {
  /** The costume id ('bear-idol', ...). */
  costume: string;
}

/**
 * Deterministic costume look for a cosplay spawn, by (station seed, spawn index), independent of every other random stream:
 *  - the COSTUME: a per-seed shuffled order of the costumes entered at a per-seed offset and stepped by the spawn index (consecutive
 *    spawns wear different costumes, all of them before any repeats);
 *  - the PRESENTATION: a per-(seed, index) draw. Skirted costumes fit female bodies only, so the costumes fitting both draw female with
 *    the probability q that makes the convention's expected female share COSPLAY_FEMALE_SHARE: share = f_F + q x f_B over the usable
 *    costumes (f_F female-only, f_B both); a costume with one presentation uses it;
 *  - the BODY: a weighted pick (COSPLAY_BODY_WEIGHT) among that costume's bodies of that presentation.
 * The same (seed, index) always gets the same look (revisit / streaming / Retry). `usable` (optional, e.g. `look => lib.isValid(look)`)
 * restricts the choice to looks that can be built (a costume with no usable body is skipped). Always all three slots.
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
  // presentation: q from the pool's mix so the expected share is COSPLAY_FEMALE_SHARE
  const has = (bs: readonly string[], p: 'female' | 'male') => bs.some(b => cosplayBodyPresentation(b) === p);
  const fF = pool.filter(x => has(x.bodies, 'female') && !has(x.bodies, 'male')).length / pool.length;
  const fB = pool.filter(x => has(x.bodies, 'female') && has(x.bodies, 'male')).length / pool.length;
  const q = fB > 0 ? Math.min(1, Math.max(0, (COSPLAY_FEMALE_SHARE - fF) / fB)) : 0;
  const bodyRand = mulberry32(hashString(`cosplay-body:${k}`, seed >>> 0));
  const female = bodyRand() < q;
  const want = has(o.bodies, 'female') && has(o.bodies, 'male') ? (female ? 'female' : 'male') : has(o.bodies, 'female') ? 'female' : 'male';
  const cands = o.bodies.filter(b => cosplayBodyPresentation(b) === want);
  const list = cands.length ? cands : o.bodies;
  const total = list.reduce((a, b) => a + (COSPLAY_BODY_WEIGHT[b] ?? 1), 0);
  let r = bodyRand() * total, body = list[list.length - 1];
  for (const b of list) { r -= COSPLAY_BODY_WEIGHT[b] ?? 1; if (r < 0) { body = b; break; } }
  return lookOf(o.c, body);
}
