// Task studio-sprinter-zombies-20261112-033210-01: SPRINTERS — about one in ten ordinary zombies RUNS at the player while it pursues
// instead of the usual chase gait, to break up the pace of encounters. Pure (no three.js, no RNG stream).
//
// User: "Add sprinter variants to 10% of ordinary regular zombie spawns. They should run at the player when pursuing instead of
// shambling ... Idle/roaming behavior otherwise stays normal." "Use a deterministic seeded 10% chance per eligible regular zombie,
// without increasing total spawns or guaranteeing an extra sprinter. Keep their existing appearance, health, damage, attack timing,
// perception, loot and other regular-zombie behavior unchanged. Do not change special enemies or their spawn rules."
//
// THE RULE (applySprinters, run by the seeded roster pass on the FINISHED layout — ai/enemyRoster.ts applyEnemyRoster — after every
// family has its slots, from roster version SPRINTER.since):
//  - ELIGIBLE = every spawn of the ordinary infected family (archetype absent / 'zombie'), of either type (shambler / coated): ambient,
//    roaming-horde member or store / convention outfit zombie alike (the coated type is ~40 % of them, so leaving it out would make far
//    fewer than one in ten regular zombies sprint). Every special family (Siren, Blightbelly, Strainer, Screacher, rat/dog) and a special
//    family's zombie stand-in (its spawn keeps the special archetype) never sprint;
//  - one INDEPENDENT roll per eligible spawn: sprinterRoll(level seed, spawn index) < SPRINTER.chance. A hash of (level seed, index):
//    no RNG stream is consumed, so the layout, loot, every spawn's position / type / family / look and every other roll are bit-identical;
//    nothing is added, removed, moved or reordered (the per-index kill memory keeps its meaning), and there is no minimum: a level may
//    hold none (the expected share is the chance, never a guaranteed extra);
//  - the same seed + index gives the same sprinters on every regeneration (revisit, reload, Continue, Retry, import). A station first
//    built before this rule keeps its recorded roster version (< since) and regenerates without sprinters (enemyRoster.ts VERSION PIN).
//
// THE BEHAVIOUR (brain.ts SPRINTER_STATS via spawnStats): only the pursuit pace changes —
// chaseSpeed SPRINTER.chaseSpeed m/s for both types (the ordinary shambler chases at 2.55, the coated at 1.75). Idle, wander, search,
// light investigation and horde patrol keep the type's wander pace; hp, damage, reach, swing timing and cooldown, sight / hearing, turn
// rate, body radius, look, cues and loot are the type's own (a coated sprinter keeps its 165 hp and heavier swipe). Faster than a walking player (player.ts WALK_SPEED 3.4: a sprinter closes ~0.9 m/s), slower than a sprinting
// one (SPRINT_SPEED 5.8: the player can still break away while stamina lasts), between the ordinary zombie and the rat/dog (4.4).
//
// THE LOOK (task studio-sprinter-gait-20261112-063646-01; user: "the player should clearly see a sprinting gait/pose rather than a sped-up
// shamble"): while it pursues, a sprinter plays its own Sprint clip (ai/sprintGait.ts, built on its body's rig; zombieActor.ts) instead
// of the ordinary Run played faster, and its footsteps follow that clip's foot strikes. Presentation only: it comes from the spawn's tag
// when the actor is built, so a saved sprinter shows it on Continue / Retry / import without any reroll; idle / roaming / attack clips
// and every other zombie's animation are unchanged.

import {hashString, mulberry32} from '../core/rng';
import type {ZombieSpawn} from '../gen/stationTypes';

export const SPRINTER = {
  /** Chance an eligible spawn is a sprinter (one independent roll per spawn; user: 10 %). */
  chance: 0.1,
  /** Pursuit ground speed (m/s) of either type: ~1.69x the shambler's chase 2.55, ~2.46x the coated's 1.75 (brain.ts ZOMBIE_STATS). */
  chaseSpeed: 4.3,
  /** The first roster version (ai/enemyRoster.ts ROSTER_VERSION) that rolls sprinters: older stations regenerate without them. */
  since: 2,
  /** Stable hash key (never rename: it IS the roll). */
  key: 'sprinter',
} as const;

/** A spawn that may be a sprinter: any spawn of the ordinary infected family, either type (see THE RULE). */
export function sprinterEligible(s: Pick<ZombieSpawn, 'archetype'>): boolean {
  return (s.archetype ?? 'zombie') === 'zombie';
}

/** A spawn that IS a sprinter: tagged by the roster pass and still eligible (a special family's spawn never is, whatever its tag). */
export function isSprinter(s: Pick<ZombieSpawn, 'archetype' | 'sprinter'>): boolean {
  return s.sprinter === true && sprinterEligible(s);
}

/** Deterministic uniform roll in [0, 1) of spawn `index` of the level map of `levelSeed` (its own hash: no RNG stream is consumed). */
export function sprinterRoll(levelSeed: number, index: number): number {
  return mulberry32(hashString(`enemy-${SPRINTER.key}:${index}`, (levelSeed >>> 0) ^ 0x5b1d7e3))();
}

export interface SprinterReport {
  /** Eligible spawns of the layout, and how many of them rolled sprinter. */
  eligible: number;
  sprinters: number;
}

/**
 * Tag the sprinters of a FINISHED layout's spawns (`sprinter: true`; every other spawn carries no tag). Only that tag is written: no
 * spawn is added, removed, moved, reordered or given another family / type / look.
 */
export function applySprinters(zombies: ZombieSpawn[], levelSeed: number): SprinterReport {
  const rep: SprinterReport = {eligible: 0, sprinters: 0};
  zombies.forEach((s, i) => {
    delete s.sprinter;
    if (!sprinterEligible(s)) return;
    rep.eligible++;
    if (sprinterRoll(levelSeed, i) < SPRINTER.chance) { s.sprinter = true; rep.sprinters++; }
  });
  return rep;
}
