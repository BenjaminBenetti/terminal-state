// Task studio-bb-production-20261112-234540-01: BB — a small baby-like undead that crawls. A registered enemy family
// (ai/creatureArchetypes.ts ENEMY_ARCHETYPES.bb), ONE enemy type with four approved looks (BB_VARIANTS: A Lullaby, B Binky, C Teddy,
// D Changeling — the same AI, stats, timings and sounds), placed only by the per-level seeded roster (ai/enemyRoster.ts: 40 % of
// combat level maps hold 1-3 of them; never the Market).
//
// BEHAVIOUR (all four looks): fast, twitchy, stop-start crawling on floors, walls and ceilings; an eerie cackle when it notices the
// player; a short wind-up, then a close-range pounce that can hurt at most once; then a recovery on the floor and a cooldown before
// the next one. It is knee-high (0.85 m standing, ~0.45 m on all fours), not a scaled adult zombie, and its presentation is
// non-graphic (no wounds, gore or dismemberment: ai/bbActor.ts).
//
// This module is pure (no three.js): the numbers, the pose the actor renders (BbPose) and the brain (BbBrain). The surface
// locomotion itself is ai/bbSurface.ts.

import {ZOMBIE_STATS, ZombieBrain, type BrainOutput, type BrainWorld, type ZombieStats} from './brain';
import type {EnemyActor, EnemyCues} from './creatureArchetypes';
import {BB_VARIANT_IDS} from './enemyRoster';

export type BbVariantId = (typeof BB_VARIANT_IDS)[number];

/** The four approved looks (user: all four kept; one enemy type). `model` = the lazy model key (ai/enemyModels.ts). */
export const BB_VARIANTS: Readonly<Record<BbVariantId, {name: string; look: 'A' | 'B' | 'C' | 'D'; model: string}>> = {
  lullaby: {name: 'Lullaby', look: 'A', model: 'enemy_bb_lullaby'},
  binky: {name: 'Binky', look: 'B', model: 'enemy_bb_binky'},
  teddy: {name: 'Teddy', look: 'C', model: 'enemy_bb_teddy'},
  changeling: {name: 'Changeling', look: 'D', model: 'enemy_bb_changeling'},
};
/** The variant of a spawn (ZombieSpawn.variant, set by the roster pass); an unknown / missing one is the first look. */
export function bbVariantOf(spawn: {variant?: string}): BbVariantId {
  return spawn.variant !== undefined && spawn.variant in BB_VARIANTS ? (spawn.variant as BbVariantId) : BB_VARIANT_IDS[0];
}

/**
 * The asset contract numbers the gameplay reads (model metres at scale 1) = the `enemyBb` extras every variant GLB carries
 * (tools/asset-pipeline/enemy/build-bb.mjs; tests/bb-contract.test.ts checks the agreement). The GLBs carry no clips: every pose is
 * a runtime clip on the shared 18-joint rig (ai/bbClips.ts).
 */
export const BB_ASSET = {
  /** Standing bind height (floor -> the top of the head, headwear included, m). */
  heightM: 0.85,
  /** Gameplay hit radii (model metres; the extras' measured ones win). The big head is a fair target. */
  hitRadii: {torso: 0.11, arm: 0.035, leg: 0.045},
  headRadius: 0.12,
} as const;

/** Runtime root-scale jitter (its own narrow band). */
export const BB_SCALE = {min: 0.94, max: 1.06} as const;

/** The crawling body the AI and the motor reason about (m, scale 1). */
export const BB_BODY = {
  /** Collider radius on the floor (the motor) and the body's reach on a surface. */
  radius: 0.22,
  /** Clear height it needs under a soffit when crawling on the floor (BODY_CLEAR is 1.6 for a standing zombie). */
  clearM: 0.6,
  /** Body centre above its support surface (along the surface normal). */
  centreUp: 0.2,
  /** Eyes above the support surface (along the normal), ahead of the centre by eyeFwd. */
  eyeUp: 0.3,
  eyeFwd: 0.18,
} as const;

/**
 * BB stats (brain.ts ZombieStats), relative to the ordinary zombie (hp 100, chase 2.55, damage 10) and the rat/dog (hp 44, chase 4.4,
 * damage 7):
 *  - hp 55: small and quick, so it dies fast once it is hit; a head hit counts as on any enemy;
 *  - wanderSpeed / chaseSpeed are its BURST paces (it moves in bursts with freezes between: BB_CADENCE) — the average pursuit pace is
 *    about 3.3 m/s, just under the player's 3.4 m/s walk and well under the 5.8 m/s sprint;
 *  - attackRange 0: the base brain's standing swing never starts — its only attack is the pounce (BB_POUNCE);
 *  - attackDamage 9 raw (x2 as every enemy hit: 18 before armour), once per pounce;
 *  - sightRange 16; radius 0.22; clear height 0.6 (it fits under desks the adults cannot).
 */
export const BB_STATS: ZombieStats = {
  ...ZOMBIE_STATS.shambler,
  hp: 55,
  wanderSpeed: 1.5,
  chaseSpeed: 4.8,
  attackRange: 0,
  attackDamage: 9,
  attackDuration: 1.3,
  attackImpact: 0.55,
  attackCooldown: 3.0,
  sightRange: 16,
  radius: BB_BODY.radius,
  height: BB_BODY.clearM,
  chaseAnim: 'Run',
  turnRate: 11,
};

/** Stop-start cadence (s): a burst of movement, then a freeze. Each is drawn uniformly from its range on the brain's own stream. */
export const BB_CADENCE = {
  /** Hunting (aware of the player). */
  burstS: [0.35, 0.75], freezeS: [0.14, 0.36],
  /** Far from its target (> farM) it keeps moving longer and pauses less, so it closes the distance. */
  farM: 9, farBurstS: [0.8, 1.3], farFreezeS: [0.1, 0.22],
  /** Unaware (roaming / settling on a perch). */
  calmBurstS: [0.5, 1.1], calmFreezeS: [0.7, 2.2],
} as const;

/** Paces on a wall or ceiling (m/s, burst pace) and the limits of where it climbs. */
export const BB_CLIMB = {
  speed: 3.4,
  calmSpeed: 1.3,
  /** It never clings higher than this above the floor below it (m): a tall hall's ceiling and an atrium void are out of reach. */
  maxHeightM: 4.6,
  /** A wall it mounts must be within this distance (m). */
  mountReachM: 6,
} as const;

/**
 * THE POUNCE. Tell first: it stops, crouches and giggles for windupS; then it leaps at where the player is (a ballistic arc, aimed
 * once at the launch — a player who moves after the launch is missed). It hurts only by touching the player during the leap, at most
 * once; then it lies recovering for landS (it cannot attack, and a hit staggers it) and may not wind up again for cooldownS.
 */
export const BB_POUNCE = {
  /** Launch range (m, body to the player's chest, 3D), with a clear straight line between. */
  minM: 0.9, maxM: 3.4,
  /** From a wall or ceiling perch it may also drop on a player this far away (3D). */
  dropMaxM: 4.4,
  windupS: 0.55,
  /** Flight: horizontal launch speed (m/s) and the gravity it falls with (m/s^2); a leap ends after maxFlightS whatever happens. */
  speed: 7.5, gravity: 16, maxFlightS: 1.1,
  /** Body-to-body contact distance (m) for the one hit: its radius + the player's 0.3 + this slack. */
  contactSlackM: 0.12,
  landS: 0.75,
  cooldownS: 3.0,
} as const;

/** What it notices and how long it remembers. */
export const BB_SENSE = {
  /** Seconds after losing sight before it stops hunting the last place it saw the player. */
  loseS: 9,
  /** The cackle (the "it has seen you" tell) is not repeated within this time (s). */
  cackleGapS: 7,
} as const;

/** Feet-to-mouth height of the crawling body (m): its positional voice on the floor (ENEMY_ARCHETYPES.bb.voiceHeight). */
export const BB_VOICE_Y = 0.32;

export type BbSurface = 'floor' | 'wall' | 'ceiling' | 'air';
/**
 * What the body is doing (the actor picks its clip from this):
 *  idle = settled (perched or resting), crawl = a movement burst, freeze = the stop between two bursts, windup = the pounce tell,
 *  pounce = the leap, fall = airborne without a leap (dropped or shot off a perch), land = recovering after a leap or a fall,
 *  stagger = flinching from a hit, dead.
 */
export type BbPhase = 'idle' | 'crawl' | 'freeze' | 'windup' | 'pounce' | 'fall' | 'land' | 'stagger' | 'dead';

/**
 * THE POSE CONTRACT between the brain and the actor (ai/bbActor.ts renders exactly this; nothing else of the brain is read for the
 * body's placement). One object per brain, updated in place every update.
 */
export interface BbPose {
  /** The model root in the world (m): the point ON the support surface under the body centre. Airborne: body centre - up x BB_BODY.centreUp. */
  x: number; y: number; z: number;
  /** Unit model up (+Y): the normal of the surface it clings to (floor 0,1,0; ceiling 0,-1,0; a wall's horizontal normal). */
  ux: number; uy: number; uz: number;
  /** Unit model forward (+Z), perpendicular to up: its heading along the surface, or its flight direction's projection. */
  fx: number; fy: number; fz: number;
  surface: BbSurface;
  phase: BbPhase;
  /** Seconds since the phase began. */
  phaseT: number;
  /** Speed along the surface (m/s): the crawl cycle's rate; 0 while frozen / settled. Airborne: its speed. */
  speed: number;
  /** World point its head turns to (the player's head while it has the player in sight), else null. */
  look: {x: number; y: number; z: number} | null;
  /** Counters the actor / the cues react to once each: cackles, head twitches, leaps launched, landings. */
  cackleSeq: number; twitchSeq: number; pounceSeq: number; landSeq: number;
}

export function bbRestPose(x: number, y: number, z: number, yaw: number): BbPose {
  return {x, y, z, ux: 0, uy: 1, uz: 0, fx: Math.sin(yaw), fy: 0, fz: Math.cos(yaw), surface: 'floor', phase: 'idle', phaseT: 0, speed: 0, look: null,
    cackleSeq: 0, twitchSeq: 0, pounceSeq: 0, landSeq: 0};
}

/**
 * BB's brain. STUB (lead contract commit): floor-only on the base machine, with the pose kept current, so the actor, audio and registry
 * lanes can build against the final surface (BbPose, the counters, `offFloor`). The surface locomotion, perception and pounce replace
 * the body of update().
 */
export class BbBrain extends ZombieBrain {
  readonly archetype = 'bb' as const;
  readonly pose: BbPose;

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = BB_STATS) {
    super('shambler', x, z, yaw, stats);
    this.pose = bbRestPose(x, 0, z, yaw);
  }

  /** True while the body is on a wall, a ceiling or in the air: it moves itself, and `y` is the floor below it, not its body height. */
  get offFloor(): boolean {
    return this.pose.surface !== 'floor';
  }

  override get climbing(): boolean {
    return this.alive && this.offFloor;
  }

  override update(dt: number, w: BrainWorld): BrainOutput {
    const out = super.update(dt, {...w, findPath: (ax, az, bx, bz, opts) => w.findPath(ax, az, bx, bz, {...opts, noLinks: true})});
    const P = this.pose;
    const phase: BbPhase = !this.alive ? 'dead' : this.state === 'stagger' ? 'stagger' : out.speed > 0 ? 'crawl' : 'idle';
    P.phaseT = phase === P.phase ? P.phaseT + dt : 0;
    P.phase = phase;
    P.x = this.x; P.y = this.y; P.z = this.z;
    P.ux = 0; P.uy = 1; P.uz = 0;
    P.fx = Math.sin(this.yaw); P.fy = 0; P.fz = Math.cos(this.yaw);
    P.surface = 'floor';
    P.speed = out.speed;
    return out;
  }
}

/** Per-actor cue bookkeeping (the brain's counters already played). */
const CUE_SEEN = new WeakMap<object, {cackle: number; pounce: number}>();

/**
 * BB's positional cues (audio/sfx.ts bbVoice: the shared laugh set of all four looks): the cackle when it notices the player, a
 * quiet giggle now and then while it is near (the tell that one is about), a rising squeal at the pounce, a yelp when hurt and a
 * short death cry. Silent while a clip is missing — never a stand-in sound. Audio only: nothing here feeds the AI.
 * The voice is gated by the floor below the body (`b.y`), so one on a ceiling is heard like one on the floor under it.
 */
export const BB_CUES: EnemyCues = {
  alert: () => {},
  attack: () => {},
  tick(sfx, z: EnemyActor, dt, _moved, dist, rand) {
    const b = z.brain as BbBrain;
    if (!b.alive) return;
    const P = b.pose;
    let seen = CUE_SEEN.get(z);
    if (!seen) CUE_SEEN.set(z, (seen = {cackle: P.cackleSeq, pounce: P.pounceSeq}));
    const my = P.y + P.uy * BB_VOICE_Y;
    if (P.cackleSeq !== seen.cackle) { seen.cackle = P.cackleSeq; sfx.bbVoice('cackle', z, P.x, my, P.z, b.y); z.groanT = 4 + rand() * 3; }
    if (P.pounceSeq !== seen.pounce) { seen.pounce = P.pounceSeq; sfx.bbVoice('pounce', z, P.x, my, P.z, b.y); }
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = 5 + rand() * 5; if (dist < 16 && P.phase !== 'windup' && P.phase !== 'pounce') sfx.bbVoice('giggle', z, P.x, my, P.z, b.y); }
  },
  hurt: (sfx, z) => { const b = z.brain as BbBrain, P = b.pose; sfx.bbVoice('hurt', z, P.x, P.y + P.uy * BB_VOICE_Y, P.z, b.y); },
  death: (sfx, z) => { const b = z.brain as BbBrain, P = b.pose; sfx.bbVoice('death', z, P.x, P.y + P.uy * BB_VOICE_Y, P.z, b.y); },
};
