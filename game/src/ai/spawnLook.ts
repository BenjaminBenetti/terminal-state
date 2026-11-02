// Task mall-lingerie-20261102-221554 (lane CONTEXT): the look of one spawn at spawn time (game.ts spawnEnemy).
//
// Every spawn of every level wears the ordinary wardrobe pick (ai/wardrobe.ts pickZombieLook: the default pool, deterministic per
// (layout seed, spawn index, type)) — EXCEPT the store-local variants of the mall's lingerie store (ZombieSpawn.look 'lingerie',
// placed only by gen/mall/lingerieSpawns.ts inside that store), which wear a fitted lingerie set: ai/lingerie.ts lingerieLook(seed,
// index). Both are pure functions of (seed, index): a look is never stored, never rerolled, identical on every rebuild of the section
// (revisit, streaming, Retry); kills are remembered per index (run/memory.ts), so a killed variant never comes back with another look.
//
// Content gate: a lingerie look is used only when the library can build it EXACTLY (WardrobeLibrary.isValid: loaded body, every
// garment fitted to it, the body's required slots filled) AND it covers both the upper and the lower slot; otherwise (models not
// loaded, set not fitted to that body) the spawn takes the ordinary, fully clothed pick. A body is never shown without both.

import type {ZombieSpawn} from '../gen/stationTypes';
import {lingerieLook} from './lingerie';
import {pickZombieLook, type LegacyZombieLook, type WardrobeAvailability, type ZombieLook, type ZombiePool} from './wardrobe';

/** What the pick needs from the look library (WardrobeLibrary / ZombieLookLibrary satisfy it). */
export interface SpawnLookLibrary {
  readonly available: WardrobeAvailability;
  isValid(look: ZombieLook | LegacyZombieLook): boolean;
}

/** True when a lingerie look may be shown: buildable exactly and dressed top AND bottom. */
export function lingerieLookUsable(look: ZombieLook | null | undefined, lib: Pick<SpawnLookLibrary, 'isValid'>): look is ZombieLook {
  return !!look && !!look.wear.upper && !!look.wear.lower && lib.isValid(look);
}

/** The look of spawn `index` of the layout seeded `seed` (see the module comment). `pool` = the ordinary pool (default registry). */
export function spawnZombieLook(seed: number, index: number, s: Pick<ZombieSpawn, 'type' | 'look'>, lib: SpawnLookLibrary, pool?: ZombiePool): ZombieLook {
  if (s.look === 'lingerie') {
    const look = lingerieLook(seed, index);
    if (lingerieLookUsable(look, lib)) return look;
  }
  return pickZombieLook(seed, index, s.type, lib.available, pool);
}
