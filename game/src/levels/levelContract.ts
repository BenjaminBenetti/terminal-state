// Task track1-siren-blightbelly-20261031 (lane SPAWN): the level / enemy REGISTRATION CONTRACT check (guide:
// docs/level-enemy-contract.md). Every registered logical level must declare, explicitly:
//  - a LevelDef in levels/registry.ts LEVELS with the same id and an integer difficulty tier >= 0 (Subway 0, Office 1);
//  - a spawn profile in ai/spawnTables.ts SPAWN_PROFILES with the same id that passes validateSpawnProfile (every family listed,
//    known contexts, the opt-in Siren only with an eligibility rule, ...).
// A missing tier / profile is an ERROR here (tests/enemy-spawn-contract.test.ts, the pages build) — never a silent Subway / Office
// default. Pure (no three.js). Nothing here scales anything by tier.

import {LEVELS, LEVEL_IDS} from './registry';
import type {LevelDef, LevelId} from './types';
import {SPAWN_PROFILES, validateSpawnProfile, type SpawnProfile} from '../ai/spawnTables';

/** Problems with the level registry + spawn profiles (empty = valid). Inputs default to the shipped registry. */
export function validateLevelRegistry(
  ids: readonly string[] = LEVEL_IDS,
  levels: Readonly<Record<string, LevelDef | undefined>> = LEVELS,
  profiles: Readonly<Record<string, SpawnProfile | undefined>> = SPAWN_PROFILES,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push(`${id}: listed twice in LEVEL_IDS`);
    seen.add(id);
    const def = Object.prototype.hasOwnProperty.call(levels, id) ? levels[id] : undefined;
    if (!def) issues.push(`${id}: no LEVELS entry (levels/registry.ts)`);
    else {
      if (def.id !== id) issues.push(`${id}: LEVELS entry has id '${String(def.id)}'`);
      const tier: unknown = (def as {tier?: unknown}).tier;
      if (tier === undefined) issues.push(`${id}: no difficulty tier (LEVELS.${id}.tier must be declared explicitly)`);
      else if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 0) issues.push(`${id}: tier ${String(tier)} is not an integer >= 0`);
    }
    const p = Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : undefined;
    if (!p) issues.push(`${id}: no spawn profile (ai/spawnTables.ts SPAWN_PROFILES)`);
    else {
      if (p.id !== id) issues.push(`${id}: spawn profile has id '${String(p.id)}'`);
      issues.push(...validateSpawnProfile(p));
    }
  }
  for (const k of Object.keys(levels)) if (!seen.has(k)) issues.push(`${k}: LEVELS entry for a level not in LEVEL_IDS`);
  for (const k of Object.keys(profiles)) if (!seen.has(k)) issues.push(`${k}: spawn profile for a level not in LEVEL_IDS`);
  return issues;
}

/** Throws with every problem when the shipped registry breaks the contract. */
export function assertLevelRegistry(): void {
  const issues = validateLevelRegistry();
  if (issues.length) throw new Error(`level registry contract:\n  ${issues.join('\n  ')}`);
}

/** The tier of every registered level, in LEVEL_IDS order (reference / QA). */
export function levelTiers(): {id: LevelId; tier: number}[] {
  return LEVEL_IDS.map(id => ({id, tier: LEVELS[id].tier}));
}
