// Task track1-siren-blightbelly-20261031 (lane BLIGHT): the BLIGHTBELLY — an obese, pustule-covered zombie subtype that
// bursts when killed. It is an ordinary zombie in every other way: the same ZombieBrain (perception, chase, search, light
// lure, ladders / track-bed drops, one swing per attack with LOS + reach + facing checks), the same claw damage and the same
// health; only clearly-justified, conservative subtype numbers differ (BLIGHTBELLY_STATS below). No global retune: the
// shambler / coated / rat-dog stats are untouched.
//
// Death burst — EXACTLY ONCE per actor: BlightbellyBrain overrides damage() and reports the single super.damage() -> true
// transition (the brain's own "dies once": a dead brain never takes damage again). That ONE place covers every kill path
// (Game.fire — shotgun pellets are summed per enemy before the single damage() call —, Game.meleeContact, the QA kill, a
// blast from another Blightbelly, any future path). Spawning, loading a section, a revisit (killed layout indices are never
// re-spawned: run/memory.ts), corpse cleanup, teardown and actor disposal never call damage(): no burst. The burst itself
// (pustule VFX, blast, gas puff, audio) is run by ai/blightBurst.ts (queued, bounded, cleared with the section).
//
// Blast (pure helpers here; ai/blightBurst.ts applies them): damage = BLIGHTBELLY_BURST.blastMax x falloff(distance) x the
// fraction of the player's body sample points the burst centre can see (raycastWorld: walls, slabs, props — the cover that
// stops bullets stops the blast). Falloff 1 inside blastInner, linear to 0 at blastRadius. It is a PHYSICAL hit
// (HitSource 'blast' through Game.applyPlayerHit: armour, injuries, HUD direction): the gas mask does NOT block it. The cloud
// that follows is ordinary toxic gas (world/gas/puff.ts through GasSystem.addPuff): the mask + a filter DO block that.

import {ZOMBIE_STATS, ZombieBrain, type ZombieStats} from './brain';
import type {HitLocation} from '../player/hits';
import type {EnemyCues} from './creatureArchetypes';
import {PUFF} from '../world/gas/puff';

/**
 * Blightbelly stats (brain.ts ZombieStats). Derived from the ordinary zombie (ZOMBIE_STATS.shambler) — only these change:
 *  - wanderSpeed 0.45 / chaseSpeed 1.6 m/s (shambler 0.65 / 2.55, coated 0.55 / 1.75): the obese body lumbers; RIGB's Walk /
 *    Run clips were authored for 0.4 / 1.5 m/s (derivatives/enemy-blightbelly.json), so the cycles play at ~1.1x. Slower than
 *    a walking player (3.4): it is a target to shoot from a distance, which is also the counterplay to its burst;
 *  - attackDuration 1.5 s / attackImpact 0.7 s: the Attack clip's overhead double-fist slam (duration / impactTime of RIGB's
 *    clip contract) — a longer, readable wind-up than the shambler's 1.1 / 0.45 claw;
 *  - radius 0.42 m (shambler 0.33, coated 0.38): the belly's collider = RIGB's measured extras `radius` (covers the torso's
 *    95th-percentile horizontal radius 0.395 m); diameter 0.84 m passes the narrowest walk-through opening (2-cell doors,
 *    1.0 m in the 0.5 m grid) with 0.08 m per side (tests/blightbelly.test.ts checks every generated door of both levels);
 *    the pathfinder keeps its 0.34 m clearance like every other enemy (the coated zombie's 0.38 works the same way);
 *  - turnRate 3.5 rad/s (default 4.5): heavy body.
 * Unchanged on purpose: hp (= the shambler's 100, read from source — no "needed" reason to raise it: its threat is the burst,
 * and every weapon keeps its hits-to-kill), attackDamage (10, the ordinary claw), attackRange 1.35 (centre-to-centre; with the
 * bigger body that is LESS reach beyond its surface than a shambler — no invisible reach), sightRange 18, chaseAnim 'Run'.
 */
export const BLIGHTBELLY_STATS: ZombieStats = {
  ...ZOMBIE_STATS.shambler,
  hp: ZOMBIE_STATS.shambler.hp,
  wanderSpeed: 0.45,
  chaseSpeed: 1.6,
  attackRange: ZOMBIE_STATS.shambler.attackRange,
  attackDamage: ZOMBIE_STATS.shambler.attackDamage,
  attackDuration: 1.5,
  attackImpact: 0.7,
  sightRange: ZOMBIE_STATS.shambler.sightRange,
  radius: 0.42,
  chaseAnim: 'Run',
  turnRate: 3.5,
};

/**
 * The death burst (first pass; reported in lanes/BLIGHT.done). Lengths m, times s, damage hp.
 * Gas numbers are the defaults of world/gas/puff.ts PUFF (one source of truth) — mirrored here for the reference site.
 */
export const BLIGHTBELLY_BURST = {
  /** Play-time beat between the kill and the pop (the killing hit's blood reads first; the ragdoll is already falling). */
  delayS: 0.15,
  /** Burst centre above the corpse's feet at the kill (the belly). */
  centreY: 0.95,
  /** Blast to the player: max damage inside blastInner, linear falloff to 0 at blastRadius (3D, to the nearest body point). */
  blastMax: 22,
  blastInner: 0.75,
  blastRadius: 3.75,
  /** Player body sample heights above the feet (the eye is the last sample); damage x the visible fraction. */
  bodySamples: [0.25, 0.75, 1.15] as readonly number[],
  /** Blast to OTHER enemies (same falloff / LOS): a fresh zombie survives; >= 20 staggers; a killed Blightbelly bursts too (once). */
  enemyMax: 30,
  /** Loudness of the pop (m, gunfire-like hearing radius: walls x0.6, slabs x0.35 each). */
  noise: 16,
  /** Bounded work: at most this many bursts processed per frame (a chain waits for the next frame), queue cap. */
  maxPerFrame: 3,
  maxQueued: 16,
  /** VFX: at most this many pustule clusters pop visibly (DamageSystem.burst + fx spray each). */
  maxPops: 6,
  /** Gas (world/gas/puff.ts PUFF — one source of truth): source walking radius, source peak, emission, whole life. */
  gasRadius: PUFF.RADIUS_M,
  gasPeak: PUFF.PEAK,
  gasEmitS: PUFF.EMIT_S,
  gasDurationS: PUFF.DURATION_S,
} as const;

/** Zombie brain with Blightbelly stats whose death (the single damage() -> true) is reported once to `onDeath`. */
export class BlightbellyBrain extends ZombieBrain {
  readonly archetype = 'blightbelly' as const;
  /** Set by the burst system (ai/blightBurst.ts adopt): called ONCE, synchronously, on the killing hit. */
  onDeath: ((b: BlightbellyBrain) => void) | null = null;
  /** The death was reported (QA / tests; a second report is impossible: super.damage() returns true once). */
  deathReported = false;

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = BLIGHTBELLY_STATS) {
    super('shambler', x, z, yaw, stats);
  }

  override damage(amount: number, fromX: number, fromZ: number, fromY?: number, o: {stagger?: boolean} = {}): boolean {
    const killed = super.damage(amount, fromX, fromZ, fromY, o);
    if (killed && !this.deathReported) {
      this.deathReported = true;
      this.onDeath?.(this);
    }
    return killed;
  }
}

/** Blast falloff 0..1 at distance d (1 inside blastInner, linear to 0 at blastRadius). */
export function blastFalloff(d: number, B: {blastInner: number; blastRadius: number} = BLIGHTBELLY_BURST): number {
  if (!(d < B.blastRadius)) return 0;
  if (d <= B.blastInner) return 1;
  return 1 - (d - B.blastInner) / (B.blastRadius - B.blastInner);
}

/** Blast damage for a distance and the visible fraction of the body (0..1). Never above `max`. */
export function blastDamage(d: number, visible: number, max: number = BLIGHTBELLY_BURST.blastMax): number {
  return max * blastFalloff(d) * Math.min(1, Math.max(0, visible));
}

/** Nearest point of the player's vertical body segment [feet, eye] to a height (3D distance uses it). */
export function bodyDistance(cx: number, cy: number, cz: number, px: number, feet: number, eye: number, pz: number): number {
  const y = Math.min(eye, Math.max(feet, cy));
  return Math.hypot(px - cx, y - cy, pz - cz);
}

/**
 * Where a blast hit lands (armour / injuries): deterministic from a 0..1 roll — torso 55 %, leg 25 %, arm 15 %, head 5 %
 * (a crouched player takes it more on the legs / arms). Every location takes the same damage before armour.
 */
export function blastHitLocation(roll: number, crouched = false): HitLocation {
  const torso = crouched ? 0.45 : 0.55, leg = crouched ? 0.3 : 0.25, arm = crouched ? 0.2 : 0.15;
  if (roll < torso) return 'torso';
  if (roll < torso + leg) return 'leg';
  if (roll < torso + leg + arm) return 'arm';
  return 'head';
}

/**
 * The Blightbelly's positional cues: the ordinary zombie calls (lane AUDIO: Blightbelly attacks / hit / death reuse the
 * existing zombie cues) with the DEEP groan voice and the heavy gait; the burst / hiss are played by ai/blightBurst.ts.
 * (Standalone, not a spread of ZOMBIE_CUES: ai/creatureArchetypes.ts imports this module.)
 */
export const BLIGHT_CUES: EnemyCues = {
  alert: (sfx, z) => sfx.groan(z.brain.x, z.brain.y + 1.5, z.brain.z, true, true),
  attack: (sfx, z) => sfx.zombieAttack(z.brain.x, z.brain.y + 1.5, z.brain.z),
  tick(sfx, z, dt, moved, dist, rand) {
    const b = z.brain;
    if (!b.alive) return;
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = (b.aware ? 2.8 : 6.5) + rand() * 6; if (dist < 22) sfx.groan(b.x, b.y + 1.5, b.z, true); }
    if (b.climbing) sfx.zombieClimb(z, b.x, b.y, b.z, dt);
    else sfx.zombieGait(z, b.x, b.z, moved, dt, true, b.y);
  },
  hurt: () => {},
  death: (sfx, z) => sfx.zombieDeath(z.brain.x, z.brain.y + 1.3, z.brain.z),
};
