// Task mall-lingerie-20261102-221554 (lane CONTEXT): the look of one spawn at spawn time (game.ts spawnEnemy).
//
// Every spawn of every level wears the ordinary wardrobe pick (ai/wardrobe.ts pickZombieLook over the ORDINARY library: the default
// pool, deterministic per (layout seed, spawn index, type)) — EXCEPT the store-local variants of the mall's lingerie store
// (ZombieSpawn.look 'lingerie', placed only by gen/mall/lingerieSpawns.ts inside that store), which wear a fitted lingerie set:
// ai/lingerie.ts lingerieLook(seed, index), built by the SEPARATE lingerie library (createLingerieLibrary: the ordinary pool can never
// pick a lingerie garment). Both are pure functions of (seed, index): a look is never stored, never rerolled, identical on every
// rebuild of the section (revisit, streaming, Retry); kills are remembered per index (run/memory.ts), so a killed variant never comes
// back, with another look or at all.
//
// Content gate: a lingerie look is used only when the lingerie library can build it EXACTLY (WardrobeLibrary.isValid: loaded body,
// every garment fitted to it, the body's required slots filled) AND it covers both the upper and the lower slot; otherwise (garments
// not loaded, set not fitted to that body) the spawn takes the ordinary, fully clothed pick. A body is never shown without both.
//
// The lingerie garments load lazily (ai/lingerie.ts LINGERIE_MODEL_FILES through Game.propModels): only for a layout that holds a
// lingerie-tagged spawn (lingerieModelKeysFor, a Game.sectionModelKeys hook) — never on the Subway, Office, Reactor or a mall
// without a lingerie store.

import type {StationLayout, ZombieSpawn} from '../gen/stationTypes';
import {LINGERIE_MODEL_FILES, lingerieLook} from './lingerie';
import {pickZombieLook, type LegacyZombieLook, type WardrobeAvailability, type ZombieLook, type ZombiePool} from './wardrobe';

/** What the pick needs from a look library (WardrobeLibrary / ZombieLookLibrary satisfy it). */
export interface SpawnLookLibrary {
  readonly available: WardrobeAvailability;
  isValid(look: ZombieLook | LegacyZombieLook): boolean;
}

/** A spawn's look and the library that builds it. */
export interface SpawnLookChoice {
  look: ZombieLook;
  /** 'lingerie' = build with the lingerie library (createLingerieLibrary); 'ordinary' = the ordinary wardrobe library. */
  library: 'ordinary' | 'lingerie';
}

/** True when a lingerie look may be shown: buildable exactly by the lingerie library and dressed top AND bottom. */
export function lingerieLookUsable(look: ZombieLook | null | undefined, lib: Pick<SpawnLookLibrary, 'isValid'> | null | undefined): look is ZombieLook {
  return !!look && !!lib && !!look.wear.upper && !!look.wear.lower && lib.isValid(look);
}

/**
 * The look of spawn `index` of the layout seeded `seed` (see the module comment). `ordinary` = the ordinary wardrobe library,
 * `lingerie` = the lingerie library (null while its garments are not loaded), `pool` = the ordinary pool (default registry).
 */
export function chooseSpawnLook(
  seed: number, index: number, s: Pick<ZombieSpawn, 'type' | 'look'>, ordinary: SpawnLookLibrary, lingerie?: Pick<SpawnLookLibrary, 'isValid'> | null, pool?: ZombiePool,
): SpawnLookChoice {
  if (s.look === 'lingerie') {
    const look = lingerieLook(seed, index);
    if (lingerieLookUsable(look, lingerie)) return {look, library: 'lingerie'};
  }
  return {look: pickZombieLook(seed, index, s.type, ordinary.available, pool), library: 'ordinary'};
}

/** Game.sectionModelKeys hook: the lazy lingerie garment keys, only for a layout with a lingerie-tagged spawn. */
export function lingerieModelKeysFor(layout: Pick<StationLayout, 'zombies'>): string[] {
  return layout.zombies.some(z => z.look === 'lingerie') ? Object.keys(LINGERIE_MODEL_FILES).sort() : [];
}
