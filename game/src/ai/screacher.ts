// Task studio-screacher-production-20261110-221858-01: THE SCREACHER — "basically a zombie with no head", a bit taller, with lanky arms
// and legs. A registered enemy family (ai/creatureArchetypes.ts ENEMY_ARCHETYPES.screacher), ONE enemy type with four approved model
// variants (SCREACHER_VARIANTS: the same AI and stats), placed only by the per-level seeded roster (ai/enemyRoster.ts: 40 % of levels).
//
// IT CANNOT SEE. It reacts only to SOUND, and once in a while it screams to echolocate (user: "cannot see, only reacts to sound
// (player bumping things, firing gun, running). Moves towards last sound. Multiple quick sounds -> quite fast / aggressive. Player can
// sneak by or fight head on. Screams about once [per] 60 seconds for echolocation." — the echo "locates the player in range but not
// through walls": one position snapshot, not continuous tracking).
//
// THE INFORMATION FIREWALL (ScreacherBrain.update). The ordinary zombie brain (ai/brain.ts) is driven by a SUB-WORLD in which "the
// player" is this Screacher's BELIEF — the last sound / echo point it knows — never the real player: the base machine's chase, path,
// facing and swing all aim at the belief. The real player position is read in exactly three places, each a physical fact:
//  1. TOUCH — the player's body within SCREACHER_SENSE.touchM (contact distance) on the same floor: it feels what it bumps into;
//  2. the SWING — at a swing's impact frame the claw hurts the player only if the player is really inside its reach, in front of it
//     and unobstructed (the swing itself was aimed at the belief; it can hit air);
//  3. the ECHO — BrainWorld.echo, asked once per scream at the cue instant: the world answers with the player's position only when the
//     player is within SCREACHER_ECHO.rangeM with no solid geometry between; that ONE snapshot becomes the belief.
// Everything else it knows arrives as sound EVENTS at their SOURCE position (hearNoise: gunshots and melee contact through the existing
// alertListeners -> hear(); running footsteps, landings and prop impacts through the game's noise events) — a kicked can or a prop
// knocked over somewhere else misleads it honestly. It has no sight cone, no eye ray, no light lure, and looking at it does nothing.
//
// BEHAVIOUR: idle / wander (listening) -> a heard sound: walk to its source -> more DISTINCT sounds in quick succession raise its
// HEAT: hunt pace, then a frenzied run (SCREACHER_AGGRO) -> it swings at the spot it believes in -> a miss leaves it searching there,
// and quiet cools it down again. No ladders (the Strainer's rule), no ranged attack, no summon, no stun: the scream only locates.

import {ATTACK_REACH_Y, ZOMBIE_STATS, ZombieBrain, hearingMuffle, slabsBetween, type BrainOutput, type BrainWorld, type ZombieStats} from './brain';
import type {EnemyActor, EnemyCues} from './creatureArchetypes';
import {SCREACHER_VARIANT_IDS} from './enemyRoster';

export type ScreacherVariantId = (typeof SCREACHER_VARIANT_IDS)[number];

/** The four approved bodies (user: all four kept; one enemy type). `model` = the lazy model key (ai/enemyModels.ts). */
export const SCREACHER_VARIANTS: Readonly<Record<ScreacherVariantId, {name: string; model: string}>> = {
  sc01: {name: 'Hollow Commuter', model: 'enemy_screacher_sc01'},
  sc02: {name: 'Track Ganger', model: 'enemy_screacher_sc02'},
  sc03: {name: 'Lopsided Sleeper', model: 'enemy_screacher_sc03'},
  sc04: {name: 'Long-Stride Runner', model: 'enemy_screacher_sc04'},
};
/** The variant of a spawn (ZombieSpawn.variant, set by the roster pass); an unknown / missing one is the first body. */
export function screacherVariantOf(spawn: {variant?: string}): ScreacherVariantId {
  return spawn.variant !== undefined && spawn.variant in SCREACHER_VARIANTS ? (spawn.variant as ScreacherVariantId) : SCREACHER_VARIANT_IDS[0];
}

/**
 * The asset contract numbers the gameplay reads (model metres / seconds at scale 1) = the `enemyScreacher` extras every variant GLB
 * carries (tools/asset-pipeline/enemy/build-screacher.mjs; tests/screacher-contract.test.ts checks the agreement). All four variants
 * share clip names, durations and timings — one AI.
 */
export const SCREACHER_ASSET = {
  /** Bind height (feet -> the top of the neck stump, m): "a bit taller" than the 1.78 m zombie, well under the Strainer's 2.15. */
  heightM: 2.0,
  /** Horizontal reach (m) of the striking hand from the feet origin at the Attack clip's hit frame (variants: 1.10-1.30). */
  reachM: 1.2,
  attackHitTime: 0.42,
  attackDuration: 1.0,
  /** Ground speeds (m/s) the in-place Walk / Run clips were authored for at timeScale 1. */
  walkGroundSpeed: 1.25,
  runGroundSpeed: 3.9,
  /** The Scream clip: its length, and the instant (s) of the cry's peak — the echo scan happens then. */
  screamDuration: 1.6,
  screamCueTime: 0.5,
  /** Gameplay hit radii (model metres; the extras' measured ones win). A lanky body: NO head volume at all. */
  hitRadii: {torso: 0.2, arm: 0.06, leg: 0.085},
} as const;

/** Runtime root-scale jitter (its own narrow band): the stump top stays between 1.94 and 2.06 m (ordinary doors are 2.2-2.3 m). */
export const SCREACHER_SCALE = {min: 0.97, max: 1.03} as const;
export const SCREACHER_MAX_TOP_M = 2.1;
/** The player's body radius (player/player.ts): a hand `reachM` from the feet touches the player at reachM + this. */
const PLAYER_BODY_RADIUS = 0.3;

/**
 * The paces of its three aggression tiers (m/s). For scale: the player walks 3.4 and sprints 5.8, crouch-walks 1.7; the ordinary
 * zombie chases at 2.55. `frenzy` outruns a walking player — breaking away means sprinting (which it hears) or going quiet and
 * stepping aside so it runs to where the noise was.
 */
export const SCREACHER_SPEED = {investigate: SCREACHER_ASSET.walkGroundSpeed, hunt: 2.4, frenzy: SCREACHER_ASSET.runGroundSpeed} as const;

/**
 * Screacher stats (brain.ts ZombieStats), relative to the ordinary zombie (ZOMBIE_STATS.shambler: hp 100, chase 2.55, range 1.35,
 * damage 10, swing 1.1 s / impact 0.45 s, cooldown 0.45 s, radius 0.33):
 *  - hp 150: a body with no head has no weak spot (every hit is a body hit), so it soaks more rounds than a zombie — and every shot
 *    is a sound it hears;
 *  - chaseSpeed = the frenzy pace (the top speed; the brain commands the pace of the current tier);
 *  - attackRange 1.55 (the long arm: visible contact 1.2 + 0.3 = 1.5), hitRange = contact + the usual 0.45 m step-away slack;
 *  - attackDamage 16 (between the shambler's 10 and the Strainer's 24); swing 1.0 s, impact 0.42 s (the Attack clip), cooldown 0.6 s;
 *  - sightRange 0: BLIND (its brain never uses sight; the number documents it);
 *  - no `height` (the body-clear height stays the shared BODY_CLEAR, like the 2.15 m Strainer: the pathfinder plans with it).
 */
export const SCREACHER_STATS: ZombieStats = {
  ...ZOMBIE_STATS.shambler,
  hp: 150,
  wanderSpeed: 0.5,
  chaseSpeed: SCREACHER_SPEED.frenzy,
  attackRange: 1.55,
  hitRange: SCREACHER_ASSET.reachM + PLAYER_BODY_RADIUS + 0.45,
  attackDamage: 16,
  attackDuration: SCREACHER_ASSET.attackDuration,
  attackImpact: SCREACHER_ASSET.attackHitTime,
  attackCooldown: 0.6,
  sightRange: 0,
  radius: 0.34,
  chaseAnim: 'Run',
  turnRate: 5.0,
};

/** What it can perceive besides gunfire (which arrives through the existing alertListeners -> hear()). */
export type ScreacherNoiseKind = 'gunshot' | 'run' | 'land' | 'impact' | 'drag' | 'touch' | 'echo' | 'pain';

/**
 * LOUDNESS (source radius, m; walls x0.6 and floor slabs x0.35 each on top: brain.ts HEARING, the gunfire rule) of the sounds the
 * game reports to Screachers. Gunshots / melee contact / explosions keep their existing radii (WeaponDef.noise 24-40 m, melee 5-9 m).
 *  - run: ONE sprinting footstep (walking and crouch-walking make no qualifying sound: sneaking past is possible);
 *  - land: a landing of at least landMinSpeed m/s (a jump lands at ~4.1 m/s: 8.9 m; a step off a kerb does not count);
 *  - impact: a physics prop / item contact of at least impactMinSpeed m/s (a kicked can, a toppled chair, a thrown flare landing):
 *    impactBase + impactPerMs x speed, at most impactMax; soft flesh chunks and brass casings never count;
 *  - drag: a pushed box scraping along the floor.
 */
export const SCREACHER_NOISE = {
  run: 11,
  landMinSpeed: 2.5, landBase: 4, landPerMs: 1.2, landMax: 10,
  impactMinSpeed: 1.0, impactBase: 3, impactPerMs: 2.2, impactMax: 14,
  drag: 4,
} as const;
/** Loudness radius (m) of a landing at `speed` m/s (0: too soft to count). */
export function landNoise(speed: number): number {
  const N = SCREACHER_NOISE;
  return speed >= N.landMinSpeed ? Math.min(N.landMax, N.landBase + N.landPerMs * speed) : 0;
}
/**
 * How loud an impact of each physics sound family is, relative to a hard object (physics/chunks.ts ImpactFamily): soft and light
 * things (a bean bag, a plastic bottle, a thrown flare, a cardboard box) carry less; glass and sheet metal a little more.
 */
export const IMPACT_FAMILY_LOUDNESS: Readonly<Record<string, number>> = {light: 0.6, cardboard: 0.7, can: 1, heavy: 1, prop: 1, wood: 1, stone: 1, glass: 1.1, metal: 1.1};
/**
 * Loudness radius (m) of a prop / item impact at `speed` m/s (0: too soft to count), scaled by its sound family. Measured with a real
 * Player and the real physics: walking (3.4 m/s) into an office chair lands contacts of 2.5-4 m/s (8-12 m); sprinting into one, 6-9 m/s
 * (the cap).
 */
export function impactNoise(speed: number, family?: string): number {
  const N = SCREACHER_NOISE;
  if (!(speed >= N.impactMinSpeed)) return 0;
  return Math.min(N.impactMax, N.impactBase + N.impactPerMs * speed) * ((family !== undefined ? IMPACT_FAMILY_LOUDNESS[family] : undefined) ?? 1);
}

/** Touch, belief memory and the priority of one sound over another. */
export const SCREACHER_SENSE = {
  /** Centre-to-centre distance (m, same floor) at which it FEELS the player's body (its radius 0.34 + the player's 0.3 + 0.3). */
  touchM: 0.94,
  /** A melee hit from within this distance tells it where the attacker stands (physical contact); a far hit does not. */
  painTouchM: 3.2,
  /** A belief older than this (s) without a newer sound is forgotten (bounded memory). */
  beliefTtlS: 25,
  /** In a chase, standing without progress this long (s) forgets the belief (an unreachable sound). */
  stallS: 2.5,
  /** A quieter class of sound does not move the belief while a louder one is younger than this (s): a shot, then its ricochets. */
  holdS: 1.2,
} as const;
/** Sound classes for the hold rule: touch / echo (it KNOWS) > gunshot-class > everything else. */
const NOISE_CLASS: Readonly<Record<ScreacherNoiseKind, number>> = {touch: 3, echo: 3, gunshot: 2, run: 1, land: 1, impact: 1, drag: 1, pain: 1};

/**
 * AGGRESSION ("multiple quick sounds -> quite fast / aggressive"): every DISTINCT sound adds its weight to `heat` (sounds closer than
 * mergeS to the last counted one are the same event: a shotgun blast, one crash's many contacts), capped at heatMax; after quietHoldS
 * without any sound heat decays by decayPerS. Tiers: heat < huntAt = INVESTIGATE (a stalking walk), < frenzyAt = HUNT, else FRENZY.
 * One shot: a walk toward it. Two quick shots or a short sprint: hunting. Three shots / a second of sprinting: frenzy. About ten
 * seconds of silence bring a frenzied one back to calm.
 */
export const SCREACHER_AGGRO = {
  weight: {gunshot: 1.25, run: 0.75, land: 1, impact: 1, drag: 0.5, touch: 1, echo: 1, pain: 1} as Readonly<Record<ScreacherNoiseKind, number>>,
  mergeS: 0.22,
  heatMax: 4.5,
  huntAt: 1.5,
  frenzyAt: 3,
  quietHoldS: 2.0,
  decayPerS: 0.5,
} as const;
export type ScreacherTier = 'investigate' | 'hunt' | 'frenzy';

/**
 * THE ECHO: about once per periodS of ACTIVE play (the brain's own clock: it only advances while the world updates — no pause / menu /
 * offline catch-up) it stops, screams (the Scream clip, holdS long) and at cueS scans ONCE: BrainWorld.echo answers with the player's
 * position when the player is within rangeM (3D) with no solid geometry between — that snapshot becomes its belief. It does not
 * track the player between pulses, deals no damage, stuns nothing and calls nobody. The first pulse of each Screacher is staggered
 * over [firstMinS, firstMinS + firstSpanS) from its spawn position (deterministic; no shared RNG), so two never scream in unison;
 * every later one follows periodS +- jitterS. A swing, a stagger or a climb delays a due scream until it ends; a scream cut short by
 * a staggering hit before its scan is retried after retryS.
 */
export const SCREACHER_ECHO = {periodS: 60, jitterS: 6, firstMinS: 10, firstSpanS: 50, rangeM: 18, cueS: SCREACHER_ASSET.screamCueTime, holdS: SCREACHER_ASSET.screamDuration, retryS: 6} as const;

/** Feet-to-stump height (m) of the standing Screacher: its positional voice (ENEMY_ARCHETYPES.screacher.voiceHeight). */
export const SCREACHER_VOICE_Y = 1.9;

/**
 * THE ECHO'S LINE RULE (pure; the game's BrainWorld.echo is exactly this with the bullet line as `clear`): from the stump of a
 * Screacher standing at `body` (feet), the player (feet x / y / z and the absolute eye height: crouching lowers it) is located when
 * the chest or the head is within `range` (3D) AND `clear(from, to)` — a straight line with no solid geometry between. Returns the
 * player's position at this instant (the snapshot), else null. Within arm's length (0.6 m) nothing can be between.
 */
export function echoLocate(body: {x: number; y: number; z: number}, player: {x: number; y: number; z: number; eye: number}, range: number,
  clear: (from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}) => boolean): {x: number; z: number; y: number} | null {
  const from = {x: body.x, y: body.y + SCREACHER_VOICE_Y, z: body.z};
  for (const ty of [player.y + (player.eye - player.y) * 0.62, player.eye - 0.08]) {
    const to = {x: player.x, y: ty, z: player.z}, d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (d > range) continue;
    if (d <= 0.6 || clear(from, to)) return {x: player.x, z: player.z, y: player.y};
  }
  return null;
}

export interface ScreacherBelief {
  x: number; z: number; y: number;
  /** Brain clock (s) the belief was formed at, its sound class and what it was. */
  t: number; cls: number; kind: ScreacherNoiseKind;
}

const STILL: BrainOutput = {dirX: 0, dirZ: 0, speed: 0, face: null, anim: 'Idle', attackHit: false, alerted: false};

export class ScreacherBrain extends ZombieBrain {
  readonly archetype = 'screacher' as const;
  /** Where it believes its prey is (the last sound / touch / echo point), or null. Never the live player. */
  belief: ScreacherBelief | null = null;
  heat = 0;
  /** Counters for cues and QA: screams started, frenzies entered, echo scans made / that found the player, sounds heard / counted. */
  screamSeq = 0;
  shriekSeq = 0;
  echoScans = 0;
  echoHits = 0;
  heard = 0;
  counted = 0;
  /** Seconds until the next scream (active play only). */
  echoT: number;
  /** The brain's own clock (s of updates). */
  clock = 0;
  private screamT = -1;
  private scanned = false;
  private lastSoundT = -Infinity;
  private lastCountT = -Infinity;
  private wasFrenzy = false;
  private swingSeq = 0;
  private swingT = 0;
  private swingDone = true;
  private swingStart = 0;
  private stallT = 0;
  private px0 = 0;
  private pz0 = 0;
  private echoSeed: number;

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = SCREACHER_STATS) {
    super('shambler', x, z, yaw, stats);
    this.echoSeed = (Math.imul(Math.round(x * 64) | 0, 0x85ebca6b) ^ Math.imul(Math.round(z * 64) | 0, 0xc2b2ae35) ^ 0x27d4eb2f) | 0 || 1;
    this.echoT = SCREACHER_ECHO.firstMinS + this.echoRnd() * SCREACHER_ECHO.firstSpanS;
    this.px0 = x; this.pz0 = z;
  }

  /** Private xorshift for the echo timing (deterministic per spawn; never the world's RNG). */
  private echoRnd(): number {
    let s = this.echoSeed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.echoSeed = s;
    return (s >>> 0) / 4294967296;
  }

  get tier(): ScreacherTier {
    return this.heat >= SCREACHER_AGGRO.frenzyAt ? 'frenzy' : this.heat >= SCREACHER_AGGRO.huntAt ? 'hunt' : 'investigate';
  }
  /** True while the Scream plays (the actor shows the clip; it stands still). */
  get screaming(): boolean {
    return this.screamT >= 0;
  }
  /** Seconds into the current scream (-1: none). */
  get screamTime(): number {
    return this.screamT;
  }

  /** BLIND: the base brain's "sees the player" is "has a belief to act on" (the sub-world puts the belief where the player would be). */
  protected override sees(): boolean {
    return this.belief !== null;
  }

  /**
   * A world sound reached it: `radius` = the loudness left at this listener after walls / floors (the caller's muffle), (x, z, y) =
   * where the SOUND happened. Returns true when it was within earshot.
   */
  hearNoise(x: number, z: number, radius: number, y: number | undefined, kind: ScreacherNoiseKind): boolean {
    if (!this.alive) return false;
    if (Math.hypot(x - this.x, z - this.z, y === undefined ? 0 : y - this.y) > radius) return false;
    this.heard++;
    this.sense(x, z, y ?? this.y, kind);
    return true;
  }

  /** Gunfire, melee contact, explosions and machines reach every enemy through alertListeners -> hear(): for it, one more sound. */
  override hear(x: number, z: number, radius: number, y?: number): void {
    this.hearNoise(x, z, radius, y, 'gunshot');
  }

  /** Take in one perceived event at its position: heat (distinct sounds only), then the belief (the hold rule). */
  private sense(x: number, z: number, y: number, kind: ScreacherNoiseKind): void {
    const A = SCREACHER_AGGRO, cls = NOISE_CLASS[kind], B = this.belief;
    if (this.clock - this.lastCountT >= A.mergeS) {
      this.heat = Math.min(A.heatMax, this.heat + A.weight[kind]);
      this.lastCountT = this.clock;
      this.counted++;
    }
    this.lastSoundT = this.clock;
    if (B && cls < B.cls && this.clock - B.t < SCREACHER_SENSE.holdS) return; // a quieter sound right after a louder one: position kept
    this.belief = {x, z, y, t: this.clock, cls, kind};
    this.stallT = 0;
    // wake the base machine toward it (idle / wander / search -> chase; a chase's last-known point moves)
    super.hear(x, z, Infinity, y);
  }

  /**
   * A hit. It feels pain (heat) but learns the attacker's position only from physical contact (a melee strike from within
   * painTouchM); a far bullet tells it nothing by itself — the gunshot's sound does, when it is in earshot. The base brain is told
   * the hit came from where it believes its prey is (or from where it stands), never the real shooter.
   */
  override damage(amount: number, fromX: number, fromZ: number, fromY?: number, o: {stagger?: boolean; staggerS?: number} = {}): boolean {
    if (!this.alive) return false;
    const near = Math.hypot(fromX - this.x, fromZ - this.z) <= SCREACHER_SENSE.painTouchM && (fromY === undefined || Math.abs(fromY - this.y) <= ATTACK_REACH_Y + 0.3);
    if (near) this.sense(fromX, fromZ, fromY ?? this.y, 'touch');
    else {
      const A = SCREACHER_AGGRO;
      if (this.clock - this.lastCountT >= A.mergeS) { this.heat = Math.min(A.heatMax, this.heat + A.weight.pain); this.lastCountT = this.clock; this.counted++; }
      this.lastSoundT = this.clock;
    }
    const B = this.belief;
    const dead = super.damage(amount, B ? B.x : this.x, B ? B.z : this.z, B ? B.y : this.y, o);
    if (this.screamT >= 0 && (dead || this.state === 'stagger')) {
      // a scream cut short: without its scan it is retried soon
      if (!this.scanned && !dead) this.echoT = SCREACHER_ECHO.retryS;
      this.screamT = -1;
    }
    return dead;
  }

  /** The base brain's world with the belief in the player's place (and nothing sight-based). */
  private subWorld(w: BrainWorld): BrainWorld {
    const B = this.belief, live = B !== null;
    return {
      ...w,
      px: B ? B.x : this.x, pz: B ? B.z : this.z, py: B ? B.y : this.y,
      // the base's own line tests run against the belief point: it "sees" the belief while it has one
      los: () => live,
      // no eyes: no light lure, no atrium sight rule, no detectability factor
      lights: undefined, seePoint: undefined, lureGoal: undefined, atriumNotice: false, detect: 1,
      // no ladders (the Strainer's rule); track-bed drops stay allowed
      findPath: (ax, az, bx, bz, opts) => w.findPath(ax, az, bx, bz, {...opts, noLinks: true}),
    };
  }

  override update(dt: number, w: BrainWorld): BrainOutput {
    const A = SCREACHER_AGGRO, S = SCREACHER_SENSE, E = SCREACHER_ECHO;
    if (!this.alive) return super.update(dt, this.subWorld(w));
    this.clock += dt;
    if (this.clock - this.lastSoundT > A.quietHoldS) this.heat = Math.max(0, this.heat - A.decayPerS * dt);

    // (1) TOUCH: the player's body against it, on its floor
    if (w.playerAlive && Math.hypot(w.px - this.x, w.pz - this.z) <= S.touchM && (w.py === undefined || Math.abs(w.py - this.y) <= ATTACK_REACH_Y)) {
      this.sense(w.px, w.pz, w.py ?? this.y, 'touch');
    }
    // bounded memory
    if (this.belief && this.clock - this.belief.t > S.beliefTtlS) this.belief = null;

    // (3) THE ECHO
    if (this.screamT >= 0) {
      this.screamT += dt;
      if (!this.scanned && this.screamT >= E.cueS) {
        this.scanned = true;
        this.echoScans++;
        const hit = w.playerAlive ? w.echo?.(this.x, this.y, this.z, E.rangeM) ?? null : null;
        if (hit) { this.echoHits++; this.sense(hit.x, hit.z, hit.y, 'echo'); }
      }
      if (this.screamT < E.holdS) return {...STILL};
      this.screamT = -1;
    } else {
      this.echoT -= dt;
      if (this.echoT <= 0 && (this.state === 'idle' || this.state === 'wander' || this.state === 'search' || this.state === 'chase')) {
        this.echoT = E.periodS + (this.echoRnd() * 2 - 1) * E.jitterS;
        this.screamT = 0;
        this.scanned = false;
        this.screamSeq++;
        return {...STILL};
      }
    }

    // the base machine, aimed at the belief
    const seq0 = this.attackSeq;
    const out = super.update(dt, this.subWorld(w));
    out.attackHit = false; // the base tested the BELIEF point; the real swing test is below
    out.alerted = false;

    // (2) THE SWING: at the impact frame the claw hurts the player only if the player is really there
    if (this.state === 'attack') {
      if (this.attackSeq !== this.swingSeq || this.attackSeq !== seq0) { this.swingSeq = this.attackSeq; this.swingT = 0; this.swingDone = false; this.swingStart = this.clock; }
      else this.swingT += dt;
      // (the base brain's impact frame: the first attack frame whose start-of-frame clip time + dt reaches attackImpact)
      if (!this.swingDone && this.swingT >= this.stats.attackImpact) {
        this.swingDone = true;
        const dx = w.px - this.x, dz = w.pz - this.z, d = Math.hypot(dx, dz);
        const ang = Math.atan2(dx, dz) - this.yaw, a = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)));
        const hitRange = this.stats.hitRange ?? this.stats.attackRange + 0.45;
        const hit = w.playerAlive && d <= hitRange && a < 1.2 && (w.py === undefined || Math.abs(w.py - this.y) <= ATTACK_REACH_Y + 0.15) && w.los(this.x, this.z, w.px, w.pz, this.y, w.py);
        if (hit) { out.attackHit = true; this.sense(w.px, w.pz, w.py ?? this.y, 'touch'); }
        else if (this.belief && this.belief.t <= this.swingStart) this.belief = null; // it struck where the sound was: nothing there
      }
    }

    // the hunt is over when the base machine stopped hunting (it reached the spot and found nothing)
    if (this.belief && (this.state === 'idle' || this.state === 'wander' || this.state === 'search')) this.belief = null;

    // pace of the tier; an unreachable sound is given up
    if (this.state === 'chase') {
      const tier = this.tier;
      if (out.speed > 0) { out.speed = SCREACHER_SPEED[tier]; out.anim = tier === 'investigate' ? 'Walk' : 'Run'; }
      else out.anim = 'Idle';
      const moved = Math.hypot(this.x - this.px0, this.z - this.pz0);
      this.stallT = moved < 0.004 ? this.stallT + dt : 0;
      if (this.belief && this.stallT > S.stallS) { this.belief = null; this.stallT = 0; }
    } else this.stallT = 0;
    this.px0 = this.x; this.pz0 = this.z;
    this.speedCmd = out.speed;

    const frenzy = this.tier === 'frenzy';
    if (frenzy && !this.wasFrenzy) this.shriekSeq++;
    this.wasFrenzy = frenzy;
    return out;
  }
}

/**
 * Deliver one world sound at `src` (feet height y) of loudness `radius` (m) to every living Screacher in earshot: the radius is
 * muffled per listener exactly like gunfire (hearingMuffle: a wall between x0.6, each floor slab x0.35; `los` = a clear line from the
 * source to that listener, `bases` = the storeys' base heights or null on a single level). Other enemies are not touched — their
 * hearing stays what it was (gunfire through alertListeners). Returns how many heard it.
 */
export function deliverNoise(brains: Iterable<ZombieBrain>, src: {x: number; y: number; z: number}, radius: number, kind: ScreacherNoiseKind,
  los: (b: ScreacherBrain) => boolean, bases: readonly number[] | null): number {
  let n = 0;
  if (!(radius > 0)) return 0;
  for (const b of brains) {
    if (!(b instanceof ScreacherBrain) || !b.alive) continue;
    if (Math.hypot(b.x - src.x, b.z - src.z, b.y - src.y) > radius) continue;
    const r = radius * hearingMuffle(los(b), bases ? slabsBetween(bases, src.y, b.y) : 0);
    if (b.hearNoise(src.x, src.z, r, src.y, kind)) n++;
  }
  return n;
}

/** Per-actor cue bookkeeping (the brain's counters already played). */
const CUE_SEEN = new WeakMap<object, {scream: number; shriek: number}>();

/**
 * The Screacher's positional cues: its own Sound Lab voice out of the stump (audio/sfx.ts screacherScream / screacherVoice: the
 * echolocation scream at every pulse, a shriek when it turns frenzied, a quiet wet wheeze while idle — the cue that tells a careful
 * player one is near —, a rasp when hurt, a death gurgle) + the ordinary zombie footfalls (reused). It has no groan: no head.
 * The sounds are audio only: nothing here feeds the AI (its own scream is never a noise event).
 */
export const SCREACHER_CUES: EnemyCues = {
  alert: () => {},
  attack: (sfx, z) => sfx.screacherVoice('hurt', z, z.brain.x, z.brain.y + SCREACHER_VOICE_Y, z.brain.z),
  tick(sfx, z: EnemyActor, dt, moved, dist, rand) {
    const b = z.brain as ScreacherBrain;
    if (!b.alive) return;
    let seen = CUE_SEEN.get(z);
    if (!seen) CUE_SEEN.set(z, (seen = {scream: b.screamSeq, shriek: b.shriekSeq}));
    const y = b.y + SCREACHER_VOICE_Y * z.scale;
    if (b.screamSeq !== seen.scream) { seen.scream = b.screamSeq; sfx.screacherScream(z, b.x, y, b.z); z.groanT = 3 + rand() * 3; }
    if (b.shriekSeq !== seen.shriek) { seen.shriek = b.shriekSeq; if (!b.screaming) sfx.screacherVoice('shriek', z, b.x, y, b.z); }
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = 3.5 + rand() * 4; if (dist < 16 && !b.screaming) sfx.screacherVoice('wheeze', z, b.x, y, b.z); }
    sfx.zombieGait(z, b.x, b.z, moved, dt, false, b.y);
  },
  hurt: (sfx, z) => sfx.screacherVoice('hurt', z, z.brain.x, z.brain.y + SCREACHER_VOICE_Y, z.brain.z),
  death: (sfx, z) => sfx.screacherVoice('death', z, z.brain.x, z.brain.y + 1.2, z.brain.z),
};
