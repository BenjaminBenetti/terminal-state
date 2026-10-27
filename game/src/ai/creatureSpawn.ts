// Iteration 07 (Lane Q): level-generic enemy archetype pool and the per-spawn, seed-weighted pick.
//
// The station generator places enemy spawn points exactly as before (gen/stationDress.ts); afterwards
// every spawn point independently draws its archetype from ENEMY_POOL with a deterministic roll of
// (station seed, spawn index). The rat/dog therefore REPLACES a zombie at ~5 % of all spawn points:
// it is ~5 % of the total enemies over many stations, not 5 % extra and not forced into each map
// (many stations have none, a few have two). Pure module (no three.js) so tests and the generator
// can use it.

import {hashString, mulberry32} from '../core/rng';

export type EnemyArchetypeId = 'zombie' | 'ratdog';

/**
 * Relative spawn weight of each archetype at ANY spawn point (level-generic; new levels/archetypes
 * add rows here). The user asked for the field-notes rat/dog to be about 5 % of the enemies.
 */
export const ENEMY_POOL: readonly (readonly [EnemyArchetypeId, number])[] = [['zombie', 0.95], ['ratdog', 0.05]];

/** Deterministic uniform roll in [0, 1) for one spawn point of one station seed. */
export function enemyRoll(seed: number, index: number): number {
  return mulberry32(hashString(`enemy-archetype:${index}`, (seed >>> 0) ^ 0x2545f491))();
}

export function pickEnemyArchetype(seed: number, index: number, pool: readonly (readonly [EnemyArchetypeId, number])[] = ENEMY_POOL): EnemyArchetypeId {
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
 */
export function assignEnemyArchetypes(layout: {seed: number; zombies: {archetype?: EnemyArchetypeId}[]}, pool = ENEMY_POOL): number {
  let n = 0;
  layout.zombies.forEach((s, i) => {
    s.archetype = pickEnemyArchetype(layout.seed, i, pool);
    if (s.archetype !== 'zombie') n++;
  });
  return n;
}
