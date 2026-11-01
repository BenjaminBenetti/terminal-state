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
// headCenter, headRadius, reachM, attackHitTime, clips}). STRAINER_ASSET mirrors those numbers for the static stats / the reference
// (tests/strainer-contract.test.ts checks the agreement; tests/strainer-asset.test.ts checks the derivative itself).

import {ZOMBIE_STATS, ZombieBrain, type BrainOutput, type BrainWorld, type ZombieStats} from './brain';
import type {EnemyCues} from './creatureArchetypes';

/** The player's body radius (player/player.ts Player.radius): a claw tip `reachM` from the Strainer's feet touches the player at reachM + this. */
export const PLAYER_BODY_RADIUS = 0.3;

/**
 * The asset contract numbers the gameplay reads (model metres / seconds at scale 1) = the `enemyStrainer` extras of
 * enemy-strainer.glb (tools/asset-pipeline/enemy/build-strainer.mjs; tests/strainer-contract.test.ts checks the agreement).
 */
export const STRAINER_ASSET = {
  /** Bind height (feet -> crown, m): ~21 % taller than the 1.78 m zombie, under the 2.3 m annex doors. */
  heightM: 2.15,
  /** Head hit-sphere centre in the BIND pose (model metres, +Z forward): the crown is hunched FORWARD of the body (on the Head bone). */
  headCenter: [-0.0006, 1.9481, 0.228] as readonly [number, number, number],
  /** Head hit-sphere radius (model metres): the measured rib-grille crown (~0.5 m wide), larger than a zombie's 0.10-0.17 head. */
  headRadius: 0.257,
  /**
   * Horizontal claw reach (m) from the feet origin at the Attack clip's hit frame (the right claw tip at chest height): the LUNGING
   * long-arm swipe (task studio-alpha-strainer-reach-squish-20261101-201110-01) — 1.631 -> 2.311 (the arm straight out on a deep lunge).
   */
  reachM: 2.311,
  /** Seconds into the Attack clip when the claws land (brain attackImpact): the lumbering swipe's telegraphed coil (user playtest). */
  attackHitTime: 1.0,
  /** Clip durations (s): the brain's attackDuration = the Attack clip. */
  attackDuration: 2.0,
  /**
   * Ground speeds (m/s) the in-place Walk / Run clips were authored for at timeScale 1 (extras clips.*.groundSpeed win): the
   * lumbering gait (user playtest 2026-11-01) — wander 0.42, the heavy chase lumber 1.35 = STRAINER_STATS.chaseSpeed (timeScale 1).
   */
  walkGroundSpeed: 0.42,
  runGroundSpeed: 1.35,
  /** Gameplay limb / torso hit radii (model metres; extras hitRadii win): a lanky body — thinner limbs than the zombie's. */
  hitRadii: {torso: 0.241, arm: 0.0633, leg: 0.1004},
} as const;

/**
 * The Strainer's runtime root-scale jitter (its OWN narrow band, not the zombie's 0.95..1.05): the crown stays under ~2.25 m
 * (STRAINER_ASSET.heightM x max = 2.2145; the service-annex doors are 2.3 m).
 */
export const STRAINER_SCALE = {min: 0.97, max: 1.03} as const;
/** The tallest the Strainer may stand (m): annex doors are 2.3 m (tests/strainer.test.ts: heightM x STRAINER_SCALE.max below it). */
export const STRAINER_MAX_TOP_M = 2.25;

/**
 * Visible CLAW CONTACT distance (m, centre to centre) for a claw reach (m from the feet origin at the hit frame): the claw tip touches
 * the player's body at reach + PLAYER_BODY_RADIUS. Always longer than the shambler's 1.35 (long arms) and never above 3.0 m (no
 * invisible reach from a bad number).
 */
export function strainerAttackRange(reachM: number): number {
  return Math.min(3.0, Math.max(ZOMBIE_STATS.shambler.attackRange + 0.15, reachM + PLAYER_BODY_RADIUS));
}

/**
 * The swing's RANGE (user: "double the reach of the swing ... using its long arms it should be able to hit you from further away"):
 * the previous range was 1.931 m (claw reach 1.631 + the player's 0.3); it is now DOUBLED to 3.862 m — the distance from which a
 * swing starts and connects. It is covered VISIBLY: the clip's lunging long-arm swipe reaches 2.311 m (contact 2.611), and the body
 * LUNGES the rest (1.251 m) toward the player in the clip's lunge window (0.62 s -> the 1.0 s impact) through the normal motor —
 * walls, props, storeys and bodies still block it; LOS / facing / storey checks at the impact frame as before; no projectile.
 */
export const STRAINER_REACH = (() => {
  const previousRangeM = 1.931, rangeM = 2 * previousRangeM, contactM = strainerAttackRange(STRAINER_ASSET.reachM);
  return {previousRangeM, rangeM, contactM, lungeM: Math.round((rangeM - contactM) * 1000) / 1000, lungeFrom: 0.62} as const;
})();

/**
 * Strainer stats (brain.ts ZombieStats), relative to the ordinary zombie (ZOMBIE_STATS.shambler: hp 100, wander 0.65, chase 2.55,
 * range 1.35, damage 10, swing 1.1 s / impact 0.45 s, cooldown 0.45 s, radius 0.33). Task studio-alpha-strainer-lumbering-wetness-
 * 20261101-01 (user playtest: "much to weak ... health much to low"; "moves to fast, should lumber towards you, but be strong"):
 *  - hp 200 -> 600 (lumbering task) -> 1200 (reach + squish task) = 12x: pistol 17: ~71 body / ~30 head hits; rifle 24: ~50 body /
 *    20 head; ~9 close shotgun blasts;
 *  - attackDamage 13 -> 24 = 2.4x: a slow but heavy claw (four hits fell a healthy player);
 *  - wanderSpeed 0.585 -> 0.40; chaseSpeed 2.45 -> 1.35 (~0.53x the zombie): it LUMBERS — a walking player (3.4 m/s) outpaces it,
 *    so it is beaten by distance, not by out-trading it up close;
 *  - (reach + squish task, user: "needs double the health. 1,200 health" / "double the reach of the swing") hp 600 -> 1200;
 *    attackRange 1.931 -> 3.862 (STRAINER_REACH: the lunging long-arm swipe + a 1.251 m lunge; hitRange = the visible claw contact
 *    2.611 + 0.45 after the lunge);
 *  - attackDuration 1.4 -> 2.0 / attackImpact 0.6 -> 1.0 = the lumbering Attack clip / its attackHitTime (a telegraphed coil);
 *  - attackCooldown 0.6 -> 1.0 s: a long recovery after the big swing;
 *  - stagger resistance (StrainerBrain.damage): only a single hit of >= STRAINER_STAGGER_MIN (45) staggers it (a rifle / pistol
 *    headshot or a knife-free heavy hit), not every >= 20 hit like a zombie: a strong body is not stun-locked by gunfire;
 *  - radius 0.36 m; turnRate 4.0 -> 3.0 rad/s (a heavy body turns slowly).
 * Unchanged: sightRange 18, the Run chase clip (now a lumber), the body clear height (BODY_CLEAR).
 */
export const STRAINER_STATS: ZombieStats = {
  ...ZOMBIE_STATS.shambler,
  hp: 1200,
  wanderSpeed: 0.4,
  chaseSpeed: STRAINER_ASSET.runGroundSpeed,
  attackRange: STRAINER_REACH.rangeM,
  // the claws connect at their visible contact (+ the usual 0.45 m step-away slack), measured after the lunge
  hitRange: STRAINER_REACH.contactM + 0.45,
  lunge: {distM: STRAINER_REACH.lungeM, from: STRAINER_REACH.lungeFrom, to: STRAINER_ASSET.attackHitTime, stopM: STRAINER_REACH.contactM - 0.2},
  attackDamage: 24,
  attackDuration: STRAINER_ASSET.attackDuration,
  attackImpact: STRAINER_ASSET.attackHitTime,
  attackCooldown: 1.0,
  sightRange: ZOMBIE_STATS.shambler.sightRange,
  radius: 0.36,
  chaseAnim: 'Run',
  turnRate: 3.0,
};

/** Smallest single hit that staggers the Strainer (a zombie: 20): a strong, heavy body shrugs off ordinary rounds. */
export const STRAINER_STAGGER_MIN = 45;

/**
 * The wet finish (user playtest: "apply a wetness material, the strainer looks much to dry") — a RUNTIME material layer on the
 * ORIGINAL Meshy maps (they stay the source, untouched): the roughness factor scales the Meshy roughness map down (sharp wet
 * highlights under the flashlight), the base colour darkens a little (wet skin reads darker), metalness stays the map's.
 */
export const STRAINER_WET = {roughnessFactor: 0.38, darken: 0.82} as const;

/** The ordinary zombie brain with Strainer stats and no ladder links (it lurks in the annex; ladders are counterplay). */
export class StrainerBrain extends ZombieBrain {
  readonly archetype = 'strainer' as const;

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = STRAINER_STATS) {
    super('shambler', x, z, yaw, stats);
  }

  /** A strong body: only a single hit of >= STRAINER_STAGGER_MIN staggers it (everything else as the zombie brain). */
  override damage(amount: number, fromX: number, fromZ: number, fromY?: number, o: {stagger?: boolean} = {}): boolean {
    return super.damage(amount, fromX, fromZ, fromY, amount >= STRAINER_STAGGER_MIN ? o : {...o, stagger: false});
  }

  override update(dt: number, w: BrainWorld): BrainOutput {
    // every path request ignores ladder nav links (the rat/dog's / Siren's mechanism); track-bed drops stay allowed
    return super.update(dt, {...w, findPath: (ax, az, bx, bz, opts) => w.findPath(ax, az, bx, bz, {...opts, noLinks: true})});
  }
}

/** Feet-to-mouth height (m) of the standing Strainer: its positional voice (ENEMY_ARCHETYPES.strainer.voiceHeight). */
export const STRAINER_VOICE_Y = 1.9;

/**
 * The Strainer's positional cues. VOICE: the existing zombie calls (Sound Lab clips) — the DEEP groan (the Blightbelly's) from its
 * taller mouth, the attack snarl as a swing starts, the zombie death. Task studio-alpha-strainer-reach-squish-20261101-201110-01
 * (lane AUDIO; user: "It needs unique 'squishy sounds' to really sell its swamp creature feel."): its OWN wet Sound Lab set
 * (audio/sfx.ts STRAINER_AUDIO) for movement and melee —
 *  - wet squelching footfalls on the foot plants of its Walk / Run clip, driven by the REAL ground speed `moved` (silent standing
 *    still; replaces the borrowed heavy zombie gait);
 *  - one wet arm-swing whoosh per swing whose peak lands on the claw's impact (brain attackImpact; silent if the swing is cut first);
 *  - the fleshy claw-contact squelch only when the claw connects (game.ts hurtPlayer — never on a miss);
 *  - a short, rate-limited wet squish when it is shot but survives (hurt).
 * It never climbs, so no rung clanks. (Standalone, not a spread of ZOMBIE_CUES: ai/creatureArchetypes.ts imports this.)
 */
export const STRAINER_CUES: EnemyCues = {
  alert: (sfx, z) => sfx.groan(z.brain.x, z.brain.y + STRAINER_VOICE_Y, z.brain.z, true, true),
  attack: (sfx, z) => sfx.zombieAttack(z.brain.x, z.brain.y + 1.8, z.brain.z),
  tick(sfx, z, dt, moved, dist, rand) {
    const b = z.brain;
    if (!b.alive) return;
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = (b.aware ? 2.8 : 6.5) + rand() * 6; if (dist < 22) sfx.groan(b.x, b.y + STRAINER_VOICE_Y, b.z, true); }
    // the wet arm-swing whoosh (claw at chest height), its peak on the impact; once per swing (attackSeq)
    if (b.state === 'attack') sfx.strainerSwing(z, b.attackSeq, b.stats.attackImpact, dt, b.x, b.y + 1.5, b.z);
    // wet footfalls on the foot plants of the clip the actor plays (Walk / Run; any other clip = not walking); an actor without clip
    // info falls back to its speed (the chase lumber vs the wander walk)
    const clip = (z as {clip?: string | null}).clip;
    sfx.strainerGait(z, b.x, b.z, moved, dt, clip === 'Walk' || clip === 'Run' ? clip : clip ? null : moved > 0.85 ? 'Run' : 'Walk', b.y, z.scale);
  },
  hurt: (sfx, z) => sfx.strainerSquish(z, z.brain.x, z.brain.y + 1.3, z.brain.z),
  death: (sfx, z) => sfx.zombieDeath(z.brain.x, z.brain.y + 1.6, z.brain.z),
};
