// Iteration 07 (Lane Q): level-generic enemy archetype pool and the per-spawn, seed-weighted pick.
//
// The station generator places enemy spawn points exactly as before (gen/stationDress.ts); afterwards
// every spawn point independently draws its archetype from ENEMY_POOL with a deterministic roll of
// (station seed, spawn index). The rat/dog therefore REPLACES a zombie at ~5 % of all spawn points:
// it is ~5 % of the total enemies over many stations, not 5 % extra and not forced into each map
// (many stations have none, a few have two). Pure module (no three.js) so tests and the generator
// can use it.
//
// Task enemy-spawn-tables-20261030 (lane SPAWN): the pool, the population constants and every other spawn control now live in the
// per-level spawn profiles (ai/spawnTables.ts; re-exported here unchanged). assignEnemyArchetypes reads the level's profile: the
// pool of the spawn's ROOM (room modifiers; the profile's own pool array when the room has none — every shipped room) with the
// SAME roll enemyRoll(seed, index), so the shipped draws are bit-identical.

import {hashString, mulberry32} from '../core/rng';
import type {Area} from '../gen/stationTypes';
import {ENEMY_POOL, roomFamilyPool, spawnProfile, type EnemyFamilyId, type FamilyPool, type SpawnProfile} from './spawnTables';

export {ENEMY_POOL, ENEMY_POPULATION_SCALE, ENEMY_SPAWNS, ENEMY_SPAWNS_BASELINE} from './spawnTables';

export type EnemyArchetypeId = EnemyFamilyId;

/** Deterministic uniform roll in [0, 1) for one spawn point of one station seed. */
export function enemyRoll(seed: number, index: number): number {
  return mulberry32(hashString(`enemy-archetype:${index}`, (seed >>> 0) ^ 0x2545f491))();
}

export function pickEnemyArchetype(seed: number, index: number, pool: FamilyPool = ENEMY_POOL): EnemyArchetypeId {
  let total = 0;
  for (const [, w] of pool) total += Math.max(0, w);
  let r = enemyRoll(seed, index) * total;
  for (const [id, w] of pool) {
    r -= Math.max(0, w);
    if (r < 0) return id;
  }
  return pool[pool.length - 1][0];
}

/**
 * Tag every spawn of a generated layout with its archetype (zombie spawns keep their shambler /
 * coated type for the outfit pick; a non-zombie archetype ignores it). Returns the non-zombie count.
 * Lane SPAWN: `profile` = the logical level's spawn profile (default: the Subway's); a spawn's pool is its room's
 * (spawnTables roomFamilyPool: purpose / room-type modifiers; untouched when the room has no entry).
 */
export function assignEnemyArchetypes(
  layout: {seed: number; zombies: {archetype?: EnemyArchetypeId; area?: number}[]; areas?: readonly Pick<Area, 'purpose' | 'type'>[]},
  profile: SpawnProfile = spawnProfile('subway'),
): number {
  let n = 0;
  layout.zombies.forEach((s, i) => {
    const area = s.area !== undefined ? layout.areas?.[s.area] : undefined;
    s.archetype = pickEnemyArchetype(layout.seed, i, roomFamilyPool(profile, area));
    if (s.archetype !== 'zombie') n++;
  });
  return n;
}
