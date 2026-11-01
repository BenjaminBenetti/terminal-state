// Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): THE STRAINER — a tall (slightly taller than a zombie), long-
// armed, clawed infected the user picked for Beyond the Station. A NORMAL registered enemy family (ai/creatureArchetypes.ts
// ENEMY_ARCHETYPES.strainer), placed only by the ordinary per-spawn family roll: its weight is positive ONLY in the service-annex
// pool (ai/spawnTables.ts SERVICE_FAMILY_SHARES.strainer 0.08, STRAINER_CONTEXTS = ['service']) and an explicit 0 everywhere else
// (validateSpawnProfile rejects anything else; hordes forbid it). No forced Strainer per annex, no guarantee.
//
// Ordinary melee baseline: the SAME ZombieBrain as every zombie (perception, chase, search, light lure, track-bed drops, one claw
// swipe per attack with the LOS + reach + facing checks) with the conservative subtype numbers below. NO acid / ranged / explosion /
// scream / boss / ceiling / teleport / loot systems. It does not climb ladders (it lurks in the annex): every path request ignores
// ladder nav links, exactly like the rat/dog and the Siren. Audio: NO new clips — the existing zombie cues through the cue adapter
// (STRAINER_CUES: the deep groan voice from its taller mouth, the ordinary claw swing, footfalls and death).
//
// ASSET CONTRACT (lane ASSET: game/public/assets/models/enemy-strainer.glb — one skinned body on the shared 18-joint skeleton, clips
// Idle / Walk / Run / Attack / Hit / Death, feet at the origin, +Z facing, bind height 2.15 m, scene extras `enemyStrainer` {heightM,
// headCenter, headRadius, reachM, attackHitTime, clips}). STRAINER_ASSET mirrors those numbers for the static stats / the reference;
// values marked TODO-ASSET are PROVISIONAL until the GLB lands — then they are set to the GLB's extras (tests/strainer-asset.test.ts
// checks the agreement once the file exists).

import {ZOMBIE_STATS, ZombieBrain, type BrainOutput, type BrainWorld, type ZombieStats} from './brain';
import type {EnemyCues} from './creatureArchetypes';

/** The player's body radius (player/player.ts Player.radius): a claw tip `reachM` from the Strainer's feet touches the player at reachM + this. */
export const PLAYER_BODY_RADIUS = 0.3;

/**
 * The asset contract numbers the gameplay reads (model metres / seconds at scale 1). TODO-ASSET: provisional until
 * enemy-strainer.glb lands; then every value = the GLB's `enemyStrainer` extras (tests/strainer-asset.test.ts, skipped until then).
 */
export const STRAINER_ASSET = {
  /** Bind height (feet -> crown, m). Contract: 2.15. */
  heightM: 2.15,
  /** Head hit-sphere centre in the BIND pose (model metres, +Z forward): the head is hunched FORWARD of the body. TODO-ASSET. */
  headCenter: [0, 1.97, 0.17] as readonly [number, number, number],
  /** Head hit-sphere radius (model metres; the gameplay head zone). TODO-ASSET. */
  headRadius: 0.13,
  /**
   * Horizontal claw reach (m) from the feet origin at the Attack clip's hit frame. TODO-ASSET: provisional 1.7 so the attack range
   * (reach + the player's body radius) is 2.0 m = ~1.5x the shambler's 1.35 (the brief's provisional rule until the GLB's reachM).
   */
  reachM: 1.7,
  /** Seconds into the Attack clip when the claws land (brain attackImpact). TODO-ASSET. */
  attackHitTime: 0.6,
  /** Clip durations (s): the brain's attackDuration = the Attack clip. TODO-ASSET. */
  attackDuration: 1.3,
  /** Ground speeds (m/s) the in-place Walk / Run clips were authored for at timeScale 1 (extras clips.*.groundSpeed win). TODO-ASSET. */
  walkGroundSpeed: 0.55,
  runGroundSpeed: 2.2,
  /** Gameplay limb / torso hit radii (model metres; extras hitRadii win): a lanky body — thinner than the zombie's. TODO-ASSET. */
  hitRadii: {torso: 0.2, arm: 0.075, leg: 0.095},
} as const;

/**
 * The Strainer's runtime root-scale jitter (its OWN narrow band, not the zombie's 0.95..1.05): the crown stays under ~2.25 m
 * (STRAINER_ASSET.heightM x max = 2.2145; the service-annex doors are 2.3 m).
 */
export const STRAINER_SCALE = {min: 0.97, max: 1.03} as const;
/** The tallest the Strainer may stand (m): annex doors are 2.3 m (tests/strainer.test.ts: heightM x STRAINER_SCALE.max below it). */
export const STRAINER_MAX_TOP_M = 2.25;

/**
 * Brain attack range (m, centre to centre, ZombieStats.attackRange) for a claw reach (m from the feet origin at the hit frame): the
 * claw tip touches the player's body at reach + PLAYER_BODY_RADIUS. Always longer than the shambler's (long arms) and never above
 * 2.3 m (no invisible reach from a bad number). The brain adds its usual 0.45 m step-away margin at the hit frame (brain.ts 'attack').
 */
export function strainerAttackRange(reachM: number): number {
  const r = Math.round((reachM + PLAYER_BODY_RADIUS) * 100) / 100;
  return Math.min(2.3, Math.max(ZOMBIE_STATS.shambler.attackRange + 0.15, r));
}

/**
 * Strainer stats (brain.ts ZombieStats), relative to the ordinary zombie (ZOMBIE_STATS.shambler: hp 100, wander 0.65, chase 2.55,
 * range 1.35, damage 10, swing 1.1 s / impact 0.45 s, cooldown 0.45 s, radius 0.33):
 *  - hp 200 = 2x: the tall body takes about two zombies' worth of body shots (a head hit is still the efficient answer);
 *  - attackDamage 13 = 1.3x: the long claws hit harder than a zombie's swipe (below the coated zombie's 15);
 *  - wanderSpeed 0.585 = 0.9x; chaseSpeed 2.45 (~0.96x, NEVER faster than the zombie): long strides, not a sprinter — a walking
 *    player (3.4 m/s) outpaces it;
 *  - attackRange 2.0 = reach + the player's radius (strainerAttackRange(STRAINER_ASSET.reachM)), LONGER than the zombie's 1.35
 *    because of the long arms (TODO-ASSET: the GLB's reachM);
 *  - attackDuration / attackImpact = the Attack clip / its attackHitTime (claw contact timed by the clip; TODO-ASSET);
 *  - attackCooldown 0.6 s (zombie default 0.45): slightly longer recovery after the big swing;
 *  - radius 0.36 m: the lanky body's collider (passes every 1.0 m opening with 0.14 m per side); turnRate 4.0 (default 4.5).
 * Unchanged: sightRange 18, the Run chase clip, the body clear height (it stoops under soffits like every enemy: BODY_CLEAR).
 */
export const STRAINER_STATS: ZombieStats = {
  ...ZOMBIE_STATS.shambler,
  hp: 2 * ZOMBIE_STATS.shambler.hp,
  wanderSpeed: Math.round(0.9 * ZOMBIE_STATS.shambler.wanderSpeed * 1000) / 1000,
  chaseSpeed: 2.45,
  attackRange: strainerAttackRange(STRAINER_ASSET.reachM),
  attackDamage: Math.round(1.3 * ZOMBIE_STATS.shambler.attackDamage),
  attackDuration: STRAINER_ASSET.attackDuration,
  attackImpact: STRAINER_ASSET.attackHitTime,
  attackCooldown: 0.6,
  sightRange: ZOMBIE_STATS.shambler.sightRange,
  radius: 0.36,
  chaseAnim: 'Run',
  turnRate: 4.0,
};

/** The ordinary zombie brain with Strainer stats and no ladder links (it lurks in the annex; ladders are counterplay). */
export class StrainerBrain extends ZombieBrain {
  readonly archetype = 'strainer' as const;

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = STRAINER_STATS) {
    super('shambler', x, z, yaw, stats);
  }

  override update(dt: number, w: BrainWorld): BrainOutput {
    // every path request ignores ladder nav links (the rat/dog's / Siren's mechanism); track-bed drops stay allowed
    return super.update(dt, {...w, findPath: (ax, az, bx, bz, opts) => w.findPath(ax, az, bx, bz, {...opts, noLinks: true})});
  }
}

/** Feet-to-mouth height (m) of the standing Strainer: its positional voice (ENEMY_ARCHETYPES.strainer.voiceHeight). */
export const STRAINER_VOICE_Y = 1.9;

/**
 * The Strainer's positional cues — NO new audio: the existing zombie calls (Sound Lab clips) through the cue adapter, with the DEEP
 * groan voice (the Blightbelly's) from its taller mouth, the ordinary claw swing / footfalls (light gait: lanky, not heavy) and the
 * zombie death. It never climbs, so no rung clanks. (Standalone, not a spread of ZOMBIE_CUES: ai/creatureArchetypes.ts imports this.)
 */
export const STRAINER_CUES: EnemyCues = {
  alert: (sfx, z) => sfx.groan(z.brain.x, z.brain.y + STRAINER_VOICE_Y, z.brain.z, true, true),
  attack: (sfx, z) => sfx.zombieAttack(z.brain.x, z.brain.y + 1.8, z.brain.z),
  tick(sfx, z, dt, moved, dist, rand) {
    const b = z.brain;
    if (!b.alive) return;
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = (b.aware ? 2.8 : 6.5) + rand() * 6; if (dist < 22) sfx.groan(b.x, b.y + STRAINER_VOICE_Y, b.z, true); }
    sfx.zombieGait(z, b.x, b.z, moved, dt, false, b.y);
  },
  hurt: () => {},
  death: (sfx, z) => sfx.zombieDeath(z.brain.x, z.brain.y + 1.6, z.brain.z),
};
