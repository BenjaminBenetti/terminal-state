// Task track1-siren-blightbelly-20261031 (lane SIREN): the SIREN enemy family — stats, wake perception and brain (pure: no three.js).
//
// User brief (user-prompt.txt): "this enemy when it spawns is different than other enemies it doesn't wander around instead this enemy
// should be on the floor ... hunched over and should be kind of humming ... she sits still. Her detection range should be lower than
// other zombies ... you basically have to come within perhaps two meters to wake her up but if you shine your flashlight on her she
// wakes up and when she wakes up she'll scream ... and run at you very quickly ... hit you with her claws ... she should have about
// double the health of a regular zombie."
//
// DORMANT (first placement): floor-hunched, still, no wandering, no groans; she hums (ai/sirenCues.ts). The ordinary perception of
// the zombie brain is OFF while dormant: no sight cone, no gunfire / knife-noise hearing (hear() is ignored), no light lure (the
// base brain never runs: 'dormant' is not LURABLE and step() has no case for it). Exactly three things wake her:
//   (a) PROXIMITY: the living player within SIREN_WAKE.proximityM (2 m, plan distance) on her storey (|feet dy| <= proximityDy) with
//       a sight line (the game's BrainWorld.los: walls, slabs between storeys, sight-blocking props block) — no through-wall or
//       through-floor wake;
//   (b) the player's ACTIVE FLASHLIGHT actually on her body: a 'flashlight' LightSource that is emitting (active, intensity >= the
//       registry's lure threshold), one of her body sample points inside its beam cone (dir / cosHalfAngle, no widening), within its
//       effective range (the light lane's brightness-scaled attractRange: BEAM.attractRange 20 m x battery output, capped at
//       LURE.maxRange) and an unobstructed ray from the lens to that point (Levels.lineOfSight: walls, floors / slab undersides,
//       sight props). Flares, the body glow and "the torch is on somewhere" never wake her. Checked every SIREN_WAKE.flashlight.period s;
//   (c) DIRECT DAMAGE (a bullet / pellet / knife hit: damage() — never staggered while dormant / rising).
// WAKE = one state transition: dormant -> 'rise' (her Rise clip, SIREN_WAKE.riseS or the clip's own length; she turns to the player,
// does not move, takes damage without staggering) -> the zombie brain's chase toward where the player is at that moment. The scream
// is handed out ONCE (takeScream(); the cue adapter plays it); a woken Siren never becomes dormant again, so there is no scream / wake
// farming. Awake she is an ordinary hunter with her own stats: zombie sight (shambler sight range) / hearing / chase / search /
// light investigation, fast Run, claw swipes with a short lunge in the wind-up, no ladder links (she has no climb clip).
//
// Tuning (all source-backed; player/player.ts WALK_SPEED 3.4, SPRINT_SPEED 5.8, AIM_SPEED 2.1; brain.ts ZOMBIE_STATS; ai/creatureActor.ts
// RATDOG_STATS):
//  - hp = 2 x ZOMBIE_STATS.shambler.hp (the ordinary zombie; derived, never the coated 165, never a literal);
//  - chase 4.2 m/s: 1.65 x the shambler's 2.55, a little under the rat/dog's 4.4; faster than a walking (3.4) or aiming (2.1) player,
//    slower than a sprint (5.8) — sprinting, doors, ladders (she cannot climb) and breaking sight are the counterplay;
//  - claw: range 1.3 m (shambler 1.35), 14 damage (shambler 10, coated 15), swing 1.0 s with the claws landing at 0.42 s (a readable
//    wind-up) and 0.55 s recovery after the swing (zombies 0.45) -> one swing per 1.55 s, the same cadence as a shambler's
//    (1.1 + 0.45). The hit test is the zombie brain's: ONE test per swing at the impact moment — player within range + 0.45 m,
//    inside 1.2 rad of her facing, within swipe reach vertically and in sight (LOS). During the wind-up she lunges 2.4 m/s from
//    0.12 s until the impact while farther than 0.75 m (at most ~0.7 m): backing off at walking speed through the wind-up still
//    makes her miss from the edge of her reach.

import {ZOMBIE_STATS, ZombieBrain, type BrainOutput, type BrainWorld, type ZombieStats} from './brain';
import {LURE, LURE_EYE, type SeePoint} from './lightLure';
import type {LightSource} from '../world/lightSources';

/** Siren stats (brain.ts ZombieStats); see the tuning notes above. */
export const SIREN_STATS: ZombieStats = {
  hp: 2 * ZOMBIE_STATS.shambler.hp,
  wanderSpeed: 0.7,
  chaseSpeed: 4.2,
  attackRange: 1.3,
  attackDamage: 14,
  attackDuration: 1.0,
  attackImpact: 0.42,
  attackCooldown: 0.55,
  sightRange: ZOMBIE_STATS.shambler.sightRange,
  radius: 0.3,
  chaseAnim: 'Run',
  turnRate: 7,
};

/** Dormant wake rules (exported for the generated enemy reference; see the header). */
export const SIREN_WAKE = {
  /** (a) plan distance (m) to the player's feet and max feet height difference (same storey) for the proximity wake. */
  proximityM: 2.0,
  proximityDy: 1.2,
  /** (c) a direct hit wakes her. */
  onDamage: true,
  /** What a dormant Siren does NOT react to (documentation for the reference; enforced by SirenBrain). */
  gunfireHearing: false, sightCone: false, lightLure: false, flares: false,
  flashlight: {
    /** (b) light kinds that can wake her. */
    kinds: ['flashlight'] as readonly string[],
    /** Seconds between flashlight checks (rays only for points inside the cone and range). */
    period: 0.1,
    /** Minimum emitting brightness (= LightSources.attracting()'s threshold). */
    minIntensity: 0.05,
    /** Effective range = the beam's published attractRange (20 m x battery output), capped here (m). */
    maxRange: LURE.maxRange,
    /**
     * Body sample points of the dormant (floor-hunched) pose, [right, up, forward] metres from her feet in her own frame (yaw):
     * back / torso, head + shoulders, both flanks, hips / dress. Any one lit with a clear ray from the lens wakes her.
     */
    points: [[0, 0.45, 0.05], [0, 0.72, 0.28], [0.22, 0.36, -0.02], [-0.22, 0.36, -0.02], [0, 0.24, -0.32]] as readonly (readonly [number, number, number])[],
  },
  /** Rise duration (s) when the model gives none; a model's Rise clip length is clamped to [riseMin, riseMax]. */
  riseS: 1.1, riseMin: 0.6, riseMax: 2.0,
} as const;

/** Claw swipe extras on top of SIREN_STATS (the lunge through the wind-up). */
export const SIREN_CLAW = {
  /** Forward lunge speed (m/s) from `from` s into the swing until the claws land (SIREN_STATS.attackImpact), while farther than `stop` m. */
  lunge: {from: 0.12, speed: 2.4, stop: 0.75},
} as const;

export type SirenWakeReason = 'proximity' | 'flashlight' | 'damage' | 'restored' | 'qa';

export interface SirenObserver { x: number; y: number; z: number; yaw: number }
export interface Pt { x: number; y: number; z: number }

/** World positions of her body sample points (SIREN_WAKE.flashlight.points) for a pose; `scale` = the actor's uniform scale. */
export function sirenBodyPoints(o: SirenObserver, scale = 1, out: Pt[] = []): Pt[] {
  const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw); // forward (+Z at yaw 0)
  const rx = fz, rz = -fx;                          // right
  const P = SIREN_WAKE.flashlight.points;
  out.length = P.length;
  for (let i = 0; i < P.length; i++) {
    const [r, u, f] = P[i];
    const p = out[i] ?? (out[i] = {x: 0, y: 0, z: 0});
    p.x = o.x + (rx * r + fx * f) * scale;
    p.y = o.y + u * scale;
    p.z = o.z + (rz * r + fz * f) * scale;
  }
  return out;
}

/** A light that can wake a dormant Siren at all: an emitting player flashlight beam (spot light with a direction and a range). */
export function sirenWakeLight(s: LightSource): boolean {
  const F = SIREN_WAKE.flashlight;
  return F.kinds.includes(s.kind) && s.active && !!s.dir && s.cosHalfAngle < 1 && s.intensity >= F.minIntensity && s.attractRange > 0;
}

/** Per-point flashlight probe (QA / tests): range, cone and the lens-to-point ray. */
export interface SirenLightProbe { light: number; point: number; dist: number; range: number; cos: number; inRange: boolean; inCone: boolean; clear: boolean | null }

/**
 * The flashlight that lights a dormant Siren now, or null: inside its beam cone, within its effective range, with an unobstructed
 * ray from the lens to one of her body points. `see` = the brain world's seePoint (eye = feet + LURE_EYE): it is called with
 * feet = lens y - LURE_EYE, i.e. from the lens itself. `onRay` counts rays (QA). `probes` (optional) records every point.
 */
export function sirenLitBy(o: SirenObserver, lights: readonly LightSource[], see: SeePoint, scale = 1, onRay?: () => void, probes?: SirenLightProbe[]): LightSource | null {
  const F = SIREN_WAKE.flashlight;
  const pts = sirenBodyPoints(o, scale, scratch);
  let hit: LightSource | null = null;
  for (const s of lights) {
    if (!sirenWakeLight(s)) continue;
    const range = Math.min(F.maxRange, s.attractRange), d0 = s.dir!;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z, d = Math.hypot(dx, dy, dz);
      const c = d > 1e-6 ? (dx * d0.x + dy * d0.y + dz * d0.z) / d : 1;
      const inRange = d <= range, inCone = c >= s.cosHalfAngle;
      let clear: boolean | null = null;
      if (inRange && inCone && (!hit || probes)) { onRay?.(); clear = see(s.x, s.y - LURE_EYE, s.z, p.x, p.y, p.z); }
      probes?.push({light: s.id, point: i, dist: d, range, cos: c, inRange, inCone, clear});
      if (clear && !hit) { hit = s; if (!probes) return s; }
    }
  }
  return hit;
}
const scratch: Pt[] = [];

/**
 * The Siren's brain: the zombie brain with SIREN_STATS once awake, behind a dormant / rise front end (see the header). Never paths
 * over ladder links (no climb clip). `dormant = false` builds an awake Siren (QA).
 */
export class SirenBrain extends ZombieBrain {
  readonly archetype = 'siren' as const;
  /** Why she woke ('restored' = awake from the run memory on a revisit), null while dormant (or killed in her sleep). */
  wakeReason: SirenWakeReason | null = null;
  /** Brain time of the wake (-1: never). */
  wakeT = -1;
  /** dormant -> awake transitions (0 or 1, ever). */
  wakes = 0;
  /** Scream cues handed out by takeScream() (0 or 1, ever). */
  screams = 0;
  /** Rise duration (s): the actor sets the model's Rise clip length (clamped). */
  riseS: number = SIREN_WAKE.riseS;
  /** Uniform actor scale (her body sample points scale with it). */
  bodyScale = 1;
  /** QA counters: flashlight checks run / rays cast while dormant, the id of the light that woke her. */
  lightChecks = 0;
  lightRays = 0;
  wakeLight: number | null = null;
  private riseT = 0;
  private lightCheckT: number;
  private screamPending = false;
  private seenSeq = 0;
  private attackT0 = -1;

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = SIREN_STATS, dormant = true) {
    super('shambler', x, z, yaw, stats); // the spawn's shambler / coated type and wardrobe never apply to her
    if (dormant) this.state = 'dormant';
    // phase-staggered light checks (deterministic per placement; never draws from the world's rand)
    const ph = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    this.lightCheckT = ph * SIREN_WAKE.flashlight.period;
  }

  get dormant(): boolean { return this.state === 'dormant'; }
  get rising(): boolean { return this.state === 'rise'; }
  /** Rise progress 0..1 (QA / animation). */
  get riseProgress(): number { return this.state === 'rise' ? Math.min(1, this.riseT / Math.max(1e-3, this.riseS)) : this.dormant ? 0 : 1; }

  /** The ONE dormant -> rise transition (false when not dormant: no second wake / scream). */
  wake(reason: SirenWakeReason): boolean {
    if (this.state !== 'dormant') return false;
    this.state = 'rise';
    this.riseT = 0;
    this.wakeReason = reason;
    this.wakeT = this.t;
    this.wakes++;
    this.aware = true;
    this.screamPending = true;
    return true;
  }

  /** Revisit of a section where she had woken (run memory): awake from the start, no scream, no hum, never dormant again. */
  restoreAwake(): void {
    if (this.state !== 'dormant') return;
    this.state = 'idle';
    this.wakeReason = 'restored';
    this.wakes++;
  }

  /** True exactly once after a wake: the cue adapter plays the scream then. */
  takeScream(): boolean {
    if (!this.screamPending) return false;
    this.screamPending = false;
    this.screams++;
    return true;
  }

  /** Gunfire / knife noise: ignored while dormant or rising (no long-range hearing wake); ordinary hearing once awake. */
  override hear(x: number, z: number, radius: number, y?: number): void {
    if (this.state === 'dormant' || this.state === 'rise') return;
    super.hear(x, z, radius, y);
  }

  /** A direct hit wakes a dormant Siren (once); dormant / rising she never staggers. Returns true when this hit killed her. */
  override damage(amount: number, fromX: number, fromZ: number, fromY?: number, o: {stagger?: boolean} = {}): boolean {
    if (this.state !== 'dormant' && this.state !== 'rise') return super.damage(amount, fromX, fromZ, fromY, o);
    const wasDormant = this.state === 'dormant';
    const killed = super.damage(amount, fromX, fromZ, fromY, {...o, stagger: false}); // hp / aware / death; state untouched otherwise
    if (!killed && wasDormant && SIREN_WAKE.onDamage) this.wake('damage');
    return killed;
  }

  override update(dt: number, w: BrainWorld): BrainOutput {
    // every path request ignores ladder nav links (no climb clip; ladders are counterplay)
    const cw: BrainWorld = {...w, findPath: (ax, az, bx, bz, opts) => w.findPath(ax, az, bx, bz, {...opts, noLinks: true})};
    if (this.state === 'dormant' || this.state === 'rise') return this.stillStep(dt, cw);
    const out = super.update(dt, cw);
    if (this.attackSeq !== this.seenSeq) { this.seenSeq = this.attackSeq; this.attackT0 = this.t; }
    if (this.state === 'attack' && w.playerAlive) {
      const e = this.t - this.attackT0, L = SIREN_CLAW.lunge;
      const dx = w.px - this.x, dz = w.pz - this.z, d = Math.hypot(dx, dz);
      if (e >= L.from && e <= this.stats.attackImpact && d > L.stop) { out.dirX = dx / d; out.dirZ = dz / d; out.speed = L.speed; out.face = Math.atan2(dx, dz); }
      this.speedCmd = out.speed;
    }
    return out;
  }

  /** Seconds into the current swing (-1 when not attacking; QA / tests). */
  get attackElapsed(): number {
    return this.state === 'attack' ? this.t - this.attackT0 : -1;
  }

  /** Dormant: perceive the three wake triggers only. Rise: stand up facing the player, then chase where the player is now. */
  private stillStep(dt: number, w: BrainWorld): BrainOutput {
    this.t += dt;
    this.speedCmd = 0;
    const out: BrainOutput = {dirX: 0, dirZ: 0, speed: 0, face: null, anim: 'Idle', attackHit: false, alerted: false};
    if (this.state === 'dormant') {
      const why = this.perceive(dt, w);
      if (!why || !this.wake(why)) return out;
      dt = 0; // the rise starts now
    }
    this.riseT += dt;
    if (w.playerAlive) out.face = Math.atan2(w.px - this.x, w.pz - this.z);
    if (this.riseT >= this.riseS) {
      this.state = 'idle';
      super.hear(w.px, w.pz, Infinity, w.py); // base transition idle -> chase with the player's position as the last known one
    }
    return out;
  }

  /** The wake trigger this frame (proximity or flashlight; damage arrives through damage()), or null. */
  private perceive(dt: number, w: BrainWorld): SirenWakeReason | null {
    if (!w.playerAlive) return null;
    const dy = (w.py ?? this.y) - this.y;
    if (Math.abs(dy) <= SIREN_WAKE.proximityDy && Math.hypot(w.px - this.x, w.pz - this.z) <= SIREN_WAKE.proximityM
      && w.los(this.x, this.z, w.px, w.pz, this.y, w.py)) return 'proximity';
    this.lightCheckT -= dt;
    if (this.lightCheckT > 0) return null;
    this.lightCheckT += SIREN_WAKE.flashlight.period;
    if (this.lightCheckT <= 0) this.lightCheckT = SIREN_WAKE.flashlight.period;
    if (!w.lights?.length || !w.seePoint) return null;
    this.lightChecks++;
    const lit = sirenLitBy(this, w.lights, w.seePoint, this.bodyScale, () => { this.lightRays++; });
    if (!lit) return null;
    this.wakeLight = lit.id;
    return 'flashlight';
  }
}
