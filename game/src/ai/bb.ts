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

import {detectFactor, ZOMBIE_STATS, ZombieBrain, type BrainOutput, type BrainWorld, type ZombieStats} from './brain';
import {
  anchorValid, arcClear, centreValid, clingKind, CRAWL, crawlStep, findMounts, flatCrawlWorld, flightStep, floorBelow, launchVelocity, mountWall, steerCling,
  type Cling, type CrawlWorld, type Flight, type FlightHit, type MountSpot,
} from './bbSurface';
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
  radius: CRAWL.radius,
  /** Clear height it needs under a soffit when crawling on the floor (BODY_CLEAR is 1.6 for a standing zombie). */
  clearM: 0.6,
  /** Body centre above its support surface (along the surface normal). */
  centreUp: CRAWL.lift,
  /** Eyes above the support surface (along the normal), ahead of the centre by eyeFwd. */
  eyeUp: 0.3,
  eyeFwd: 0.1,
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
  hitRange: 0,
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
  maxHeightM: CRAWL.maxHeightM,
  /** A wall it mounts must be within this distance (m). */
  mountReachM: 6,
  /** A hit of at least this much damage knocks it off a wall or ceiling: it falls and lies recovering (BB_POUNCE.landS). */
  knockOffDamage: 10,
  /** Unaware, it spends its time perched: seconds on the floor before it climbs, and seconds it stays up. */
  floorS: [8, 20], perchS: [20, 45],
  /** A perch is this high on a wall (m above the floor), or a crawl of this length out onto the ceiling. */
  perchUpM: [1.9, 2.8], perchCeilingM: [1, 3.5],
  /** Noticing the player from further than huntClimbM, it takes the wall-and-ceiling way this often (else it runs on the floor). */
  huntClimbM: 4.5, huntClimbChance: 0.6,
} as const;

/**
 * THE POUNCE. Tell first: it stops, crouches and giggles for windupS; then it leaps at where the player is (a ballistic arc, aimed
 * once at the launch — a player who moves after the launch is missed). It hurts only by touching the player during the leap, at most
 * once; then it lies recovering for landS (it cannot attack, and a hit staggers it) and may not wind up again for cooldownS.
 */
export const BB_POUNCE = {
  /**
   * Launch range (m, body to the player's chest, 3D), with a clear arc between. Each attempt picks its own launch distance in
   * [leapFromM, maxM]. Nearer than minM it first scuttles back once (it needs room), then leaps anyway.
   */
  minM: 0.9, leapFromM: 2.0, maxM: 3.4,
  /** From a wall or ceiling perch it may also drop on a player this far away (3D). */
  dropMaxM: 4.4,
  windupS: 0.55,
  /** Flight: horizontal launch speed (m/s) and the gravity it falls with (m/s^2); a leap can hurt only in its first maxFlightS. */
  speed: 7.5, gravity: 16, maxFlightS: 1.1,
  /** The aim leads a moving player by this share of the flight time (1 = a perfect lead): a sidestep at a run still dodges it. */
  lead: 0.6,
  /** Body-to-body contact distance (m) for the one hit: its radius + the player's 0.3 + this slack. */
  contactSlackM: 0.12,
  landS: 0.75,
  /** Recovery after letting go of a perch on its own (no leap). */
  dropLandS: 0.3,
  cooldownS: 3.0,
  /**
   * While it cools down it keeps its distance: a player nearer than retreatM makes it run (to a wall perch when one is near, else
   * away to fleeToM); between retreatM and holdM it waits and watches.
   */
  retreatM: 3.2, holdM: 5.5, fleeToM: 4.8, retreatPerchChance: 0.65,
} as const;

/** What it notices and how long it remembers. */
export const BB_SENSE = {
  /** Seconds after losing sight before it stops hunting the last place it saw the player. */
  loseS: 9,
  /** The cackle (the "it has seen you" tell) is not repeated within this time (s). */
  cackleGapS: 7,
  /** After noticing the player it stares for this long before it moves (s). */
  stareS: 0.4,
  /** Clinging to a wall or ceiling it notices all round, but only this near (m); on the floor it has the usual forward field of view. */
  perchNoticeM: 10,
  /** Field of view of an unaware one on the floor (rad each side of its heading); nearer than closeM it notices all round. */
  fovRad: 1.3, closeM: 5,
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
  /** Counters the actor / the cues react to once each: cackles, head twitches, wind-ups begun, leaps launched, landings. */
  cackleSeq: number; twitchSeq: number; windupSeq: number; pounceSeq: number; landSeq: number;
}

export function bbRestPose(x: number, y: number, z: number, yaw: number): BbPose {
  return {x, y, z, ux: 0, uy: 1, uz: 0, fx: Math.sin(yaw), fy: 0, fz: Math.cos(yaw), surface: 'floor', phase: 'idle', phaseT: 0, speed: 0, look: null,
    cackleSeq: 0, twitchSeq: 0, windupSeq: 0, pounceSeq: 0, landSeq: 0};
}

type Mode = 'ground' | 'surf' | 'air';
type PlanKind = 'perch' | 'hunt' | 'retreat' | 'down';
/** What it does on a wall / ceiling. */
interface Plan {
  k: PlanKind;
  /** Seconds on this plan; ways found blocked; seconds left of a sidestep round a blocker. */
  t: number; blocks: number; detourT: number;
  /** On a wall: the vertical way it keeps going (+1 up, -1 down, 0 sideways); the climb limit was reached on this wall. */
  vert: number; topped: boolean;
  /** perch / retreat: it has arrived and sits; seconds left up there; its next idle twitch. */
  settled: boolean; holdS: number; twitchT: number;
  /** perch / retreat: the height on the wall it stops at (m above the floor), or (perch) a crawl out onto the ceiling of `travel` m. */
  goalUp: number; ceiling: boolean; travel: number;
}
type Act =
  | {k: 'none'}
  /** Just noticed the player: it stares. */
  | {k: 'stare'; t: number}
  /** The pounce tell. */
  | {k: 'windup'; t: number; lost: number}
  /** Recovering on the floor after a leap or a fall. */
  | {k: 'land'; t: number; dur: number}
  /** On the floor, going to the foot of a wall to climb it. */
  | {k: 'mount'; spot: MountSpot; t: number; plan: PlanKind}
  /** On the floor, getting away from the player (`back`: a short backward scuttle, still facing the player). */
  | {k: 'flee'; t: number; dur: number; farM: number; back: boolean; dx: number; dz: number; pickT: number};
const NONE: Act = {k: 'none'};
/** In the air (m/s, m): the fastest fall, the push off the player after its hit, the hop off a thing it cannot stay on. */
const AIR = {terminal: 18, reboundSpeed: 2.2, hopSpeed: 3, hopRings: [0.7, 1.1, 1.6]} as const;
/** A leap is aimed at the first of these horizontal paces (m/s) whose arc is clear and comes down somewhere it can go on from. */
const LEAP_PACES = [BB_POUNCE.speed, 5, 3.5] as const;

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * BB's brain: the base machine (idle / wander / chase / search / stagger, with the pathfinder and the motor) while it is on a floor
 * it can walk on, and its own surface body (ai/bbSurface.ts) on walls, ceilings and in the air.
 *
 *  - PERCEPTION is sight from its real eye (3D, from wherever it clings) plus the sounds / hits every enemy hears: it knows only
 *    the last place it saw or heard the player (`known`), never the live position while the player is out of sight.
 *  - MOVEMENT is stop-start: bursts and freezes (BB_CADENCE) drawn on its own stream, on every surface.
 *  - Unaware, it perches: it climbs a nearby wall, sits on it or out on the ceiling for a while, comes down, roams, climbs again.
 *  - Hunting, it runs on the floor (the pathfinder's route) or takes the wall-and-ceiling way toward where it knows the player is;
 *    walls it meets on the way are crossed by their own surfaces (a door lintel: down its face, under it, up again).
 *  - THE POUNCE: wind-up (the tell) -> a ballistic leap aimed once -> at most one hit, by touching the player -> a recovery on
 *    the floor -> a cooldown during which it keeps its distance (a wall perch when one is near).
 *
 * While the body is off the floor, `x` / `z` are its plan position and `y` is the FLOOR BELOW it (so every "same storey" / sight /
 * sound rule of the game keeps working); where the body really is, is `pose`.
 */
export class BbBrain extends ZombieBrain {
  readonly archetype = 'bb' as const;
  readonly pose: BbPose;
  /** QA counters: walls mounted, corners turned, leaps, leaps that hit, falls (let go / knocked off / lost its hold), knock-offs, and two that must stay 0 (a forced return to the floor, a recovery from an invalid place). */
  readonly tally = {mounts: 0, corners: 0, leaps: 0, hits: 0, falls: 0, knocks: 0, hops: 0, forced: 0, recoveries: 0};
  /** QA: why and where the last forced return to the floor happened. */
  lastForced: string | null = null;
  private mode: Mode = 'ground';
  private act: Act = NONE;
  private readonly cling: Cling = {x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, hx: 0, hy: 0, hz: 1};
  /** A turn round a corner (or onto a wall) in progress: the body centre travels from here to the cling's centre. */
  private blend: {x: number; y: number; z: number; t: number; dur: number} | null = null;
  private plan: Plan | null = null;
  private readonly flight: Flight = {x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0};
  /** Airborne: this is a leap (it can hurt, once); it has hit; seconds in the air; hops off things it cannot land on. */
  private leap = false;
  private leapHit = false;
  private airT = 0;
  private bounces = 0;
  private landDur: number = BB_POUNCE.dropLandS;
  private coolOnLand = false;
  private seed: number;
  /** Its own clock (s of updates). */
  clock = 0;
  private seenNow = false;
  private unseen = 0;
  /** The last place it saw / heard the player (feet height y) and when. */
  private readonly known = {x: 0, y: 0, z: 0, t: -Infinity};
  /** The player's velocity as it watched it (m/s; for the leap's lead). */
  private pvx = 0;
  private pvz = 0;
  private plx = 0;
  private plz = 0;
  private plt = -Infinity;
  /** Seconds until it may wind up again. */
  private cdT = 0;
  private leapAt: number;
  private backed = false;
  /** Seconds until it looks for a leap again after finding none (the aim costs rays). */
  private aimT = 0;
  private lastCackle = -Infinity;
  private alertFlag = false;
  private burstT = 0;
  private freezeT = 0;
  private noClimbT = 0;
  private perchT: number;
  private climbCheckT = 1.2;
  private stallRef = Infinity;
  private stalls = 0;
  private anchorT = 0.25;
  /** The last floor place it stood on (where it goes back to from a place it cannot stand). */
  private readonly home = {x: 0, y: 0, z: 0};
  private flat: CrawlWorld | null = null;
  private flatY = NaN;
  private moving = false;
  private frozen = false;
  private paceNow = 0;
  private readonly lookAt = {x: 0, y: 0, z: 0};

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = BB_STATS) {
    super('shambler', x, z, yaw, stats);
    this.pose = bbRestPose(x, 0, z, yaw);
    this.seed = (Math.imul(Math.round(x * 64) | 0, 0xc2b2ae35) ^ Math.imul(Math.round(z * 64) | 0, 0x9e3779b1) ^ 0x165667b1) | 0 || 1;
    this.leapAt = this.drawLeapAt();
    this.perchT = 1 + this.rnd() * 6; // the first climb comes early: a station found with BBs already up on its walls
    this.home.x = x; this.home.z = z;
  }

  /** Private xorshift (deterministic per spawn; never the world's RNG). */
  private rnd(): number {
    let s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.seed = s;
    return (s >>> 0) / 4294967296;
  }
  private span(r: readonly [number, number] | readonly number[]): number {
    return r[0] + this.rnd() * (r[1] - r[0]);
  }
  private drawLeapAt(): number {
    return BB_POUNCE.leapFromM + this.rnd() * (BB_POUNCE.maxM - BB_POUNCE.leapFromM);
  }

  /** True while the brain moves the body itself (a wall, a ceiling, the air, a floor top it cannot walk on): `y` is the floor below it. */
  get offFloor(): boolean {
    return this.mode !== 'ground';
  }
  override get climbing(): boolean {
    return this.alive && this.mode !== 'ground';
  }
  /** Seconds until it may wind up again (QA). */
  get cooldown(): number {
    return this.cdT;
  }
  /** Sees the player this update (QA; the cues never read it). */
  get seeing(): boolean {
    return this.seenNow;
  }
  /** What it is doing (QA): its mode, its floor act and its surface plan. */
  get doing(): {mode: Mode; act: Act['k']; plan: PlanKind | null; settled: boolean} {
    return {mode: this.mode, act: this.act.k, plan: this.mode === 'surf' ? this.plan?.k ?? null : null, settled: !!this.plan?.settled};
  }
  /** The body centre (m). */
  centre(out: {x: number; y: number; z: number} = {x: 0, y: 0, z: 0}): {x: number; y: number; z: number} {
    const P = this.pose, L = BB_BODY.centreUp;
    out.x = P.x + P.ux * L; out.y = P.y + P.uy * L; out.z = P.z + P.uz * L;
    return out;
  }

  /** The base machine's "sees the player" is this brain's own 3D sight (computed once per update). */
  protected override sees(): boolean {
    return this.seenNow;
  }

  override hear(x: number, z: number, radius: number, y?: number): void {
    if (!this.alive) return;
    if (Math.hypot(x - this.x, z - this.z, y === undefined ? 0 : y - this.y) > radius) return;
    const was = this.aware;
    super.hear(x, z, radius, y);
    this.know(x, y ?? this.y, z);
    if (!was) this.noticed();
  }

  override damage(amount: number, fromX: number, fromZ: number, fromY?: number, o: {stagger?: boolean; staggerS?: number} = {}): boolean {
    if (!this.alive) return false;
    const was = this.aware;
    // off the floor the base stagger (a floor flinch) does not apply: a hard enough hit knocks it off instead
    const dead = super.damage(amount, fromX, fromZ, fromY, this.mode === 'ground' ? o : {...o, stagger: false});
    this.know(fromX, fromY ?? this.y, fromZ);
    if (dead) return true;
    if (!was) this.noticed();
    if (this.mode === 'surf' && amount >= BB_CLIMB.knockOffDamage) {
      const c = this.cling, dx = this.x - fromX, dz = this.z - fromZ, d = Math.hypot(dx, dz) || 1;
      this.tally.knocks++;
      this.startFall(c.nx * 1.2 + dx / d * 1.2, Math.min(0, c.ny), c.nz * 1.2 + dz / d * 1.2, BB_POUNCE.landS);
    } else if (this.mode === 'air' && this.leap && amount >= 20) {
      // shot out of its leap: it loses most of its way and falls short
      this.flight.vx *= 0.35; this.flight.vz *= 0.35;
    } else if (this.mode === 'ground' && this.state === 'stagger') {
      if (this.act.k === 'windup') this.cdT = Math.max(this.cdT, 1);
      this.act = NONE;
    }
    return false;
  }

  private know(x: number, y: number, z: number): void {
    const K = this.known;
    K.x = x; K.y = y; K.z = z; K.t = this.clock;
  }
  private get knows(): boolean {
    return this.clock - this.known.t <= BB_SENSE.loseS;
  }

  /** It has just become aware of the player: the cackle (the tell), a short stare, and whatever it was doing calmly ends. */
  private noticed(): void {
    this.aware = true;
    if (this.clock - this.lastCackle >= BB_SENSE.cackleGapS) { this.pose.cackleSeq++; this.lastCackle = this.clock; }
    if (this.act.k === 'none' || (this.act.k === 'mount' && this.act.plan === 'perch')) this.act = {k: 'stare', t: BB_SENSE.stareS};
    if (this.plan && (this.plan.k === 'perch' || this.plan.k === 'down')) this.setPlan('hunt');
    this.freezeT = 0;
  }

  private flatWorld(): CrawlWorld {
    if (!this.flat || this.flatY !== this.y) { this.flat = flatCrawlWorld(this.y); this.flatY = this.y; }
    return this.flat;
  }

  override update(dt: number, w: BrainWorld): BrainOutput {
    this.clock += dt;
    const real = w.crawl !== undefined, cw = w.crawl ?? this.flatWorld();
    this.cdT = Math.max(0, this.cdT - dt);
    this.aimT = Math.max(0, this.aimT - dt);
    this.noClimbT = Math.max(0, this.noClimbT - dt);
    this.alertFlag = false; this.moving = false; this.frozen = false; this.paceNow = 0;
    let out: BrainOutput;
    if (!this.alive) {
      this.seenNow = false;
      out = this.deadUpdate(dt, cw);
    } else {
      this.perceive(dt, w, cw, real);
      out = this.mode === 'air' ? this.airUpdate(dt, w, cw) : this.mode === 'surf' ? this.surfUpdate(dt, w, cw) : this.groundUpdate(dt, w, cw, real);
      if (this.alertFlag) out.alerted = true;
    }
    this.writePose(dt, w);
    return out;
  }

  // --------------------------------------------------------------------------------------------------------------------------
  // perception

  /** 3D sight from its eye to the player's head or chest: range, an unaware one's field of view, then the level's sight line. */
  private perceive(dt: number, w: BrainWorld, cw: CrawlWorld, real: boolean): void {
    const seen = w.playerAlive && this.sight(w, cw, real);
    this.seenNow = seen;
    if (!seen) { this.unseen += dt; return; }
    const py = w.py ?? this.y;
    const gap = this.clock - this.plt;
    if (gap > 1e-6 && gap < 0.25) {
      const k = Math.min(1, gap * 10);
      this.pvx += ((w.px - this.plx) / gap - this.pvx) * k;
      this.pvz += ((w.pz - this.plz) / gap - this.pvz) * k;
    } else { this.pvx = 0; this.pvz = 0; }
    this.plx = w.px; this.plz = w.pz; this.plt = this.clock;
    this.know(w.px, py, w.pz);
    this.unseen = 0;
    if (!this.aware) { this.alertFlag = true; this.noticed(); }
  }

  private sight(w: BrainWorld, cw: CrawlWorld, real: boolean): boolean {
    const P = this.pose, B = BB_BODY, S = BB_SENSE;
    const ex = P.x + P.ux * B.eyeUp + P.fx * B.eyeFwd, ey = P.y + P.uy * B.eyeUp + P.fy * B.eyeFwd, ez = P.z + P.uz * B.eyeUp + P.fz * B.eyeFwd;
    const py = w.py ?? this.y, pe = w.pEye ?? py + 1.62;
    const dx = w.px - ex, dz = w.pz - ez, d = Math.hypot(dx, pe - ey, dz);
    // an UNAWARE one's notice distances x the player's one detectability factor (an aware one keeps its sight: brain.ts detect)
    const k = this.aware ? 1 : detectFactor(w.detect);
    if (d > this.stats.sightRange * k) return false;
    if (!this.aware) {
      if (this.mode === 'ground') {
        if (d > S.closeM * k) {
          const ang = Math.atan2(dx, dz) - this.yaw;
          if (Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) > S.fovRad) return false;
        }
      } else if (d > S.perchNoticeM * k) return false;
    }
    if (!real || !cw.sight) return w.los(this.x, this.z, w.px, w.pz, this.y, w.py);
    const e = {x: ex, y: ey, z: ez};
    return cw.sight(e, {x: w.px, y: pe - 0.1, z: w.pz}) || cw.sight(e, {x: w.px, y: Math.max(py + 0.35, pe - 0.55), z: w.pz});
  }

  /** The player's chest: what a leap aims at (lower for a crouched player). */
  private chestY(w: BrainWorld): number {
    const py = w.py ?? this.y;
    return Math.max(py + 0.35, (w.pEye ?? py + 1.62) - 0.5);
  }
  private chestDist(w: BrainWorld): number {
    const P = this.pose, L = BB_BODY.centreUp;
    return Math.hypot(w.px - (P.x + P.ux * L), this.chestY(w) - (P.y + P.uy * L), w.pz - (P.z + P.uz * L));
  }

  // --------------------------------------------------------------------------------------------------------------------------
  // the floor

  private idleOut(): BrainOutput {
    return {dirX: 0, dirZ: 0, speed: 0, face: null, anim: 'Idle', attackHit: false, alerted: false};
  }

  /** The base machine goes after the place this brain knows (it never learns more than `known`). */
  private wake(): void {
    if (this.aware && this.knows) super.hear(this.known.x, this.known.z, Infinity, this.known.y);
  }

  /** Stop-start: true while a burst lasts; draws the next freeze / burst (calm: unaware; far: a long way from its target). */
  private cadence(dt: number, calm: boolean, far: boolean): boolean {
    if (this.freezeT > 0) { this.freezeT -= dt; return false; }
    const C = BB_CADENCE;
    if (this.burstT <= 0) this.burstT = this.span(calm ? C.calmBurstS : far ? C.farBurstS : C.burstS);
    this.burstT -= dt;
    if (this.burstT <= 0) {
      this.freezeT = this.span(calm ? C.calmFreezeS : far ? C.farFreezeS : C.freezeS);
      this.pose.twitchSeq++;
    }
    return true;
  }

  private groundUpdate(dt: number, w: BrainWorld, cw: CrawlWorld, real: boolean): BrainOutput {
    const H = this.home;
    H.x = this.x; H.y = this.y; H.z = this.z;
    const sub: BrainWorld = {...w, findPath: (ax, az, bx, bz, opts) => w.findPath(ax, az, bx, bz, {...opts, noLinks: true})}; // no ladders: it climbs walls
    // a flinch (the base machine's stagger) interrupts whatever it was doing
    if (this.state === 'stagger') {
      this.act = NONE;
      return super.update(dt, sub);
    }
    if (this.act.k !== 'none') return this.groundAct(this.act, dt, w, cw, real);
    const out = super.update(dt, sub);
    const hunting = this.state === 'chase';
    if (hunting && w.playerAlive) {
      const P = BB_POUNCE;
      if (this.seenNow) {
        const d3 = this.chestDist(w), face = Math.atan2(w.px - this.x, w.pz - this.z);
        if (d3 > P.maxM) this.backed = false;
        if (this.cdT <= 0) {
          if (d3 < P.minM && !this.backed) {
            // too near to leap: one short backward scuttle, eyes on the player
            this.backed = true;
            this.act = {k: 'flee', t: 0, dur: 0.45, farM: P.minM + 0.7, back: true, dx: 0, dz: 0, pickT: -1};
            return this.still(out, face);
          }
          if (d3 <= this.leapAt && this.aimT <= 0) {
            if (this.aim(w, cw, false)) {
              this.beginWindup();
              return this.still(out, face);
            }
            this.aimT = 0.12;
          }
        } else if (d3 < P.retreatM) {
          // cooling down with the player near: up a wall when one is close, else away
          if (!(real && this.rnd() < P.retreatPerchChance && this.tryMount('retreat', w, cw, 1.4, 4.5, w.px, w.pz, true)))
            this.act = {k: 'flee', t: 0, dur: 2.5, farM: P.fleeToM, back: false, dx: 0, dz: 0, pickT: -1};
          return this.still(out, face);
        } else if (d3 < P.holdM) {
          this.frozen = true;
          return this.still(out, face);
        }
      }
      // a way up toward a place it cannot walk to (a player above it), or when the floor route is not getting it there
      if (real && this.knows && this.noClimbT <= 0) {
        this.climbCheckT -= dt;
        if (this.climbCheckT <= 0) {
          this.climbCheckT = 1.2;
          const K = this.known, dh = Math.hypot(K.x - this.x, K.z - this.z);
          const above = K.y - this.y > 0.6 && dh < 10;
          if (dh > this.stallRef - 0.5) this.stalls++; else this.stalls = 0;
          this.stallRef = dh;
          if ((above || (this.stalls >= 2 && dh > 3.5)) && this.tryMount('hunt', w, cw, above ? 0.5 : 1.4, BB_CLIMB.mountReachM, K.x, K.z, false)) {
            this.stalls = 0; this.stallRef = Infinity;
            return this.still(out, null);
          }
        }
      }
    } else if (!this.aware && real && (this.state === 'idle' || this.state === 'wander')) {
      // unaware: time to climb to a perch
      this.perchT -= dt;
      if (this.perchT <= 0) {
        this.perchT = 4 + this.rnd() * 4;
        if (this.tryMount('perch', w, cw, 1.4, BB_CLIMB.mountReachM)) return this.still(out, null);
      }
    }
    if (out.speed > 0) {
      const far = hunting && Math.hypot(this.known.x - this.x, this.known.z - this.z) > BB_CADENCE.farM;
      if (this.cadence(dt, !hunting, far)) { this.moving = true; this.paceNow = out.speed; }
      else { out.speed = 0; this.frozen = true; }
    }
    return out;
  }

  private still(out: BrainOutput, face: number | null): BrainOutput {
    out.dirX = 0; out.dirZ = 0; out.speed = 0; out.anim = 'Idle';
    if (face !== null) out.face = face;
    return out;
  }

  private groundAct(a: Act, dt: number, w: BrainWorld, cw: CrawlWorld, real: boolean): BrainOutput {
    const out = this.idleOut();
    switch (a.k) {
      case 'stare': {
        a.t -= dt;
        if (this.knows) out.face = Math.atan2(this.known.x - this.x, this.known.z - this.z);
        if (a.t <= 0) {
          this.act = NONE;
          this.wake();
          const K = this.known;
          if (real && this.knows && Math.hypot(K.x - this.x, K.z - this.z) > BB_CLIMB.huntClimbM && this.rnd() < BB_CLIMB.huntClimbChance)
            this.tryMount('hunt', w, cw, 1.4, BB_CLIMB.mountReachM, K.x, K.z, false);
        }
        break;
      }
      case 'windup': {
        out.face = Math.atan2(w.px - this.x, w.pz - this.z);
        this.windupTick(a, dt, w, cw);
        break;
      }
      case 'land': {
        a.t += dt;
        if (a.t >= a.dur) { this.act = NONE; this.wake(); }
        break;
      }
      case 'mount': {
        a.t += dt;
        const dx = a.spot.x - this.x, dz = a.spot.z - this.z, d = Math.hypot(dx, dz);
        if (d < 0.16 || (d < 0.45 && a.t > 1.2)) {
          const c = mountWall(cw, this.x, this.y, this.z, -a.spot.nx, -a.spot.nz, 0.9);
          this.act = NONE;
          if (c) this.beginSurf(c, a.plan);
          else this.noClimbT = 4;
          break;
        }
        if (a.t > 3.5) { this.act = NONE; this.noClimbT = 4; break; }
        const pace = a.plan === 'perch' ? this.stats.wanderSpeed * 1.4 : this.stats.chaseSpeed;
        out.dirX = dx / d; out.dirZ = dz / d; out.face = Math.atan2(dx, dz);
        out.speed = Math.min(pace, d / Math.max(dt, 1e-3));
        out.anim = 'Run';
        this.moving = true; this.paceNow = out.speed;
        break;
      }
      case 'flee': {
        a.t += dt;
        const dx = this.x - w.px, dz = this.z - w.pz, d = Math.hypot(dx, dz) || 1;
        if (a.t >= a.dur || d >= a.farM || !w.playerAlive) { this.act = NONE; this.wake(); break; }
        if (a.pickT < 0 || a.t - a.pickT >= 0.3) {
          // away from the player; where that way is shut, the nearest open way round
          a.pickT = a.t;
          const base = Math.atan2(dx, dz);
          a.dx = dx / d; a.dz = dz / d;
          for (const off of [0, 0.9, -0.9, 1.7, -1.7]) {
            const sx = Math.sin(base + off), sz = Math.cos(base + off);
            if (w.walkClear(this.x, this.z, this.x + sx * 1.2, this.z + sz * 1.2, this.stats.radius, this.y, this.y)) { a.dx = sx; a.dz = sz; break; }
          }
        }
        out.dirX = a.dx; out.dirZ = a.dz;
        out.speed = this.stats.chaseSpeed;
        out.face = a.back ? Math.atan2(-dx, -dz) : Math.atan2(a.dx, a.dz);
        out.anim = 'Run';
        this.moving = true; this.paceNow = a.back ? out.speed * 0.25 : out.speed;
        break;
      }
    }
    return out;
  }

  /**
   * Pick a wall to climb and start toward its foot: within `reach`, climbable for `needUp` m, a clear walk to the spot in front of
   * it. `tx` / `tz`: prefer one on the way to that place (`flee`: away from it). False (and no retry for a moment) when there is none.
   */
  private tryMount(kind: PlanKind, w: BrainWorld, cw: CrawlWorld, needUp: number, reach: number, tx?: number, tz?: number, flee = false): boolean {
    if (this.noClimbT > 0) return false;
    let best: MountSpot | null = null, bs = Infinity;
    for (const s of findMounts(cw, this.x, this.y, this.z, reach, needUp)) {
      if (s.dist > 0.2 && !w.walkClear(this.x, this.z, s.x, s.z, this.stats.radius, this.y, this.y)) continue;
      const far = tx === undefined || tz === undefined ? this.rnd() * 3 : Math.hypot(tx - s.x, tz - s.z) * (flee ? -0.5 : 0.7);
      if (s.dist + far < bs) { bs = s.dist + far; best = s; }
    }
    if (!best) { this.noClimbT = 3; return false; }
    this.act = {k: 'mount', spot: best, t: 0, plan: kind};
    return true;
  }

  // --------------------------------------------------------------------------------------------------------------------------
  // the pounce

  private beginWindup(): void {
    this.act = {k: 'windup', t: 0, lost: 0};
    this.pose.windupSeq++;
  }

  /** The tell runs its time with the player in sight, then the leap; losing sight of the player for a moment calls it off. */
  private windupTick(a: Extract<Act, {k: 'windup'}>, dt: number, w: BrainWorld, cw: CrawlWorld): void {
    a.t += dt;
    if (this.seenNow) a.lost = 0; else a.lost += dt;
    if (!w.playerAlive || a.lost > 0.25) {
      this.act = NONE;
      this.cdT = Math.max(this.cdT, 1);
      return;
    }
    if (a.t >= BB_POUNCE.windupS) this.launch(w, cw);
  }

  /**
   * The launch velocity of a leap at the player's chest from where the body is, when its arc is clear of solid geometry (else null).
   * `lead`: aim ahead of a moving player. A player beyond its reach is leapt at as far as it can leap: it falls short.
   */
  private aim(w: BrainWorld, cw: CrawlWorld, lead: boolean): {vx: number; vy: number; vz: number; T: number} | null {
    const P = BB_POUNCE, from = this.centre();
    let tx = w.px, tz = w.pz;
    if (lead) {
      const T0 = Math.max(0.2, Math.min(0.65, Math.hypot(tx - from.x, tz - from.z) / P.speed));
      tx += this.pvx * P.lead * T0; tz += this.pvz * P.lead * T0;
    }
    const dx = tx - from.x, dz = tz - from.z, dh = Math.hypot(dx, dz);
    const reach = (this.mode === 'ground' ? P.maxM : P.dropMaxM) * 1.15;
    if (dh > reach) { tx = from.x + dx * reach / dh; tz = from.z + dz * reach / dh; }
    const to = {x: tx, y: this.chestY(w), z: tz}, refY = Math.min(this.y, w.py ?? this.y);
    for (const pace of LEAP_PACES) {
      const v = launchVelocity(from, to, pace, P.gravity);
      if (arcClear(cw, from, v, P.gravity, v.T) && this.comesDown(cw, from, v, refY)) return v;
    }
    return null;
  }

  /**
   * A dry run of a leap PAST its target (a miss): it must come down on a floor it can stand on, or on something at about floor
   * level (a desk it hops off) — never in a pit, a shaft or a void it could not walk out of. Rays do not see railings, so without
   * this a miss beside an open edge would carry it over.
   */
  private comesDown(cw: CrawlWorld, from: {x: number; y: number; z: number}, v: {vx: number; vy: number; vz: number}, refY: number): boolean {
    const f: Flight = {x: from.x, y: from.y, z: from.z, vx: v.vx, vy: v.vy, vz: v.vz}, G = BB_POUNCE.gravity;
    const ok = (x: number, y: number, z: number): boolean => y >= refY - 1.6 || cw.stand(x, y, z, 0.1) !== null;
    for (let k = 0; k < 45; k++) {
      const hit = flightStep(cw, f, 1 / 30, G);
      if (!hit) continue;
      if (hit.ny > 0.7) return ok(f.x, hit.y, f.z);
      if (hit.ny < -0.7) { f.vy = Math.min(f.vy, -0.5); continue; }
      // a wall: it slides down it — what lies at its foot
      const d = cw.ray(f, {x: 0, y: -1, z: 0}, 12);
      return d.kind !== 'none' && ok(f.x, f.y - d.t, f.z);
    }
    return false;
  }

  private launch(w: BrainWorld, cw: CrawlWorld): void {
    const v = this.aim(w, cw, true) ?? this.aim(w, cw, false);
    this.act = NONE;
    if (!v) { this.cdT = Math.max(this.cdT, 1); return; }
    const f = this.flight;
    this.centre(f);
    f.vx = v.vx; f.vy = v.vy; f.vz = v.vz;
    this.mode = 'air';
    this.blend = null; this.plan = null;
    this.leap = true; this.leapHit = false; this.coolOnLand = true;
    this.airT = 0; this.bounces = 0;
    this.landDur = BB_POUNCE.landS;
    this.backed = false;
    this.leapAt = this.drawLeapAt();
    this.pose.pounceSeq++;
    this.attackSeq++;
    this.tally.leaps++;
  }

  /** The leaping body touches the player's body (a standing capsule), with nothing solid between the two. */
  private touches(w: BrainWorld, cw: CrawlWorld): boolean {
    const f = this.flight, py = w.py ?? this.y, pe = w.pEye ?? py + 1.62;
    const lo = py + 0.3, hi = Math.max(lo, pe - 0.1), qy = Math.max(lo, Math.min(hi, f.y));
    const dx = w.px - f.x, dy = qy - f.y, dz = w.pz - f.z, d = Math.hypot(dx, dy, dz);
    if (d > BB_BODY.radius + 0.3 + BB_POUNCE.contactSlackM) return false;
    const gap = d - 0.3;
    if (gap > 0.02 && cw.ray(f, {x: dx / d, y: dy / d, z: dz / d}, gap).kind !== 'none') return false;
    return true;
  }

  // --------------------------------------------------------------------------------------------------------------------------
  // the air

  private startFall(vx: number, vy: number, vz: number, landS: number): void {
    const f = this.flight;
    this.centre(f);
    f.vx = vx; f.vy = vy; f.vz = vz;
    this.mode = 'air';
    this.blend = null; this.plan = null;
    this.act = NONE;
    this.leap = false; this.leapHit = true; this.coolOnLand = false;
    this.airT = 0; this.bounces = 0;
    this.landDur = landS;
    this.tally.falls++;
  }

  private airUpdate(dt: number, w: BrainWorld, cw: CrawlWorld): BrainOutput {
    const out = this.idleOut(), f = this.flight, G = BB_POUNCE.gravity;
    let left = dt;
    while (left > 1e-6 && this.mode === 'air') {
      const h = Math.min(left, 1 / 60);
      left -= h;
      this.airT += h;
      if (f.vy < -AIR.terminal) f.vy = -AIR.terminal;
      const hit = flightStep(cw, f, h, G);
      if (this.leap && !this.leapHit && this.airT <= BB_POUNCE.maxFlightS && w.playerAlive && this.touches(w, cw)) {
        // THE one hit of this leap; it bounces back off the player
        this.leapHit = true;
        out.attackHit = true;
        this.tally.hits++;
        let bx = f.x - w.px, bz = f.z - w.pz, bl = Math.hypot(bx, bz);
        if (bl < 1e-3) { bx = -f.vx; bz = -f.vz; bl = Math.hypot(bx, bz) || 1; }
        f.vx = bx / bl * AIR.reboundSpeed; f.vz = bz / bl * AIR.reboundSpeed; f.vy = Math.max(f.vy, 1.5);
      }
      if (hit) this.contact(hit, cw);
      else if (this.airT > 4) this.forceDown(cw);
      else if (!cw.band(f.x, f.y, f.z)) this.recover();
    }
    if (this.mode === 'air') this.shadow(cw, f.x, f.y, f.z);
    this.paceNow = Math.hypot(f.vx, f.vy, f.vz);
    return out;
  }

  /** The flying body has met something. */
  private contact(hit: FlightHit, cw: CrawlWorld): void {
    const f = this.flight, R = BB_BODY.radius;
    if (hit.ny > 0.7) {
      if (!this.alive) { this.rest(f.x, hit.y, f.z); return; } // a dead body lies where it comes down
      if (hit.kind === 'floor') {
        const fy = cw.stand(f.x, hit.y, f.z, R) ?? cw.stand(f.x, hit.y, f.z, 0.1);
        if (fy !== null) { this.touchDown(f.x, fy, f.z); return; }
        // a floor it cannot stand on (a ledge top, a sill): it crawls off it, back toward where it last stood
        const c = this.cling, H = this.home;
        let hx = H.x - f.x, hz = H.z - f.z;
        const hl = Math.hypot(hx, hz);
        if (hl > 1e-3) { hx /= hl; hz /= hl; } else { hx = this.pose.fx; hz = this.pose.fz; }
        const q: Cling = {x: f.x, y: hit.y, z: f.z, nx: 0, ny: 1, nz: 0, hx, hy: 0, hz};
        if (Math.hypot(q.hx, q.hz) > 0.5 && centreValid(cw, q) && anchorValid(cw, q)) {
          Object.assign(c, q);
          this.mode = 'surf';
          this.blend = null;
          this.leap = false;
          this.setPlan('down');
          this.act = NONE;
          this.pose.landSeq++;
          if (this.coolOnLand) this.cdT = BB_POUNCE.cooldownS;
          this.coolOnLand = false;
          return;
        }
      }
      // a prop's top (a desk, a crate): it hops off, to the nearest floor it can stand on
      this.leap = false; this.leapHit = true;
      if (++this.bounces > 4) { this.forceDown(cw); return; }
      let dx = f.vx, dz = f.vz, d = Math.hypot(dx, dz);
      if (d < 0.5) { dx = this.home.x - f.x; dz = this.home.z - f.z; d = Math.hypot(dx, dz) || 1; }
      if (!this.hopOff(cw, Math.atan2(dx, dz))) { f.vx = dx / d * 1.8; f.vz = dz / d * 1.8; f.vy = 2.6; }
    } else if (hit.ny < -0.7) {
      f.vy = Math.min(f.vy, -0.5); f.vx *= 0.6; f.vz *= 0.6;
    } else {
      // a wall or a prop's side: it loses its way into it and slides down
      const vn = f.vx * hit.nx + f.vz * hit.nz;
      f.vx = (f.vx - vn * hit.nx) * 0.5 + hit.nx * 0.5;
      f.vz = (f.vz - vn * hit.nz) * 0.5 + hit.nz * 0.5;
      f.vy = Math.min(f.vy, 0);
      this.leap = false; this.leapHit = true;
    }
  }

  /**
   * On something it cannot stay on: a short hop to a floor it can stand on — the nearest ring first, round the compass starting
   * with the way it was going (`ang`), a clear arc required. False when no such place is in reach.
   */
  private hopOff(cw: CrawlWorld, ang: number): boolean {
    const f = this.flight, G = BB_POUNCE.gravity, b = cw.band(f.x, f.y, f.z);
    if (!b) return false;
    for (const r of AIR.hopRings) {
      for (let k = 0; k < 8; k++) {
        const a = ang + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * (Math.PI / 4);
        const tx = f.x + Math.sin(a) * r, tz = f.z + Math.cos(a) * r;
        const fy = cw.stand(tx, b.floor, tz, BB_BODY.radius);
        if (fy === null) continue;
        const v = launchVelocity(f, {x: tx, y: fy + BB_BODY.centreUp, z: tz}, AIR.hopSpeed, G, 0.3, 0.6);
        if (!arcClear(cw, f, v, G, v.T)) continue;
        f.vx = v.vx; f.vy = v.vy; f.vz = v.vz;
        this.tally.hops++;
        return true;
      }
    }
    return false;
  }

  /** Back on a floor it can walk on, recovering. */
  private touchDown(x: number, y: number, z: number): void {
    const P = this.pose;
    this.toGround(x, y, z, Math.hypot(P.fx, P.fz) > 0.3 ? Math.atan2(P.fx, P.fz) : this.yaw);
    this.act = {k: 'land', t: 0, dur: this.landDur};
    P.landSeq++;
    this.cdT = this.coolOnLand ? BB_POUNCE.cooldownS : Math.max(this.cdT, this.landDur + 0.6);
    this.coolOnLand = false;
    this.leap = false;
  }

  private toGround(x: number, y: number, z: number, yaw: number): void {
    this.mode = 'ground';
    this.blend = null; this.plan = null;
    this.x = x; this.y = y; this.z = z; this.vy = 0;
    this.yaw = yaw;
  }

  /** A dead body at rest. */
  private rest(x: number, y: number, z: number): void {
    this.mode = 'ground';
    this.blend = null; this.plan = null;
    this.x = x; this.y = y; this.z = z; this.vy = 0;
  }

  /** Still airborne long after any fall could last: down to the floor of the space it is in (the motor frees it from what stands there). */
  private forceDown(cw: CrawlWorld): void {
    const f = this.flight, b = cw.band(f.x, f.y, f.z);
    if (!b) { this.recover(); return; }
    this.tally.forced++;
    this.lastForced = `air ${this.airT.toFixed(2)} s, ${this.bounces} hops, at ${f.x.toFixed(2)},${f.y.toFixed(2)},${f.z.toFixed(2)}`;
    if (this.alive) this.touchDown(f.x, b.floor, f.z); else this.rest(f.x, b.floor, f.z);
  }

  /** Outside free space (never expected: every move is swept): back to where it last stood. */
  private recover(): void {
    const H = this.home;
    this.tally.recoveries++;
    if (this.alive) this.touchDown(H.x, H.y, H.z); else this.rest(H.x, H.y, H.z);
  }

  private deadUpdate(dt: number, cw: CrawlWorld): BrainOutput {
    const out = this.idleOut();
    out.anim = 'Death';
    if (this.mode === 'surf') {
      const c = this.cling;
      this.startFall(c.nx * 0.8, Math.min(0, c.ny) * 0.8, c.nz * 0.8, 0);
    }
    if (this.mode === 'air') {
      const f = this.flight;
      let left = dt;
      while (left > 1e-6 && this.mode === 'air') {
        const h = Math.min(left, 1 / 60);
        left -= h;
        this.airT += h;
        if (f.vy < -AIR.terminal) f.vy = -AIR.terminal;
        const hit = flightStep(cw, f, h, BB_POUNCE.gravity);
        if (hit) this.contact(hit, cw);
        else if (this.airT > 4) this.forceDown(cw);
        else if (!cw.band(f.x, f.y, f.z)) this.recover();
      }
      if (this.mode === 'air') this.shadow(cw, f.x, f.y, f.z);
    }
    return out;
  }

  /** Off the floor: the plan position, and the floor below the body as its feet height. */
  private shadow(cw: CrawlWorld, cx: number, cy: number, cz: number): void {
    this.x = cx; this.z = cz;
    const b = cw.band(cx, cy, cz);
    if (b) this.y = b.floor;
    this.vy = 0;
  }

  // --------------------------------------------------------------------------------------------------------------------------
  // walls and ceilings

  private setPlan(k: PlanKind): Plan {
    const c = this.cling, C = BB_CLIMB;
    return this.plan = {
      k, t: 0, blocks: 0, detourT: 0,
      vert: clingKind(c) === 'wall' ? (c.hy < -0.3 ? -1 : 1) : 0, topped: false,
      settled: false, holdS: this.span(C.perchS), twitchT: 2 + this.rnd() * 3,
      goalUp: k === 'retreat' ? 2.2 + this.rnd() * 0.8 : this.span(C.perchUpM), ceiling: k === 'perch' && this.rnd() < 0.5, travel: this.span(C.perchCeilingM),
    };
  }

  /** From the floor onto a wall: the body turns up onto it over a moment. */
  private beginSurf(c: Cling, kind: PlanKind): void {
    this.blend = {x: this.x, y: this.y + BB_BODY.centreUp, z: this.z, t: 0, dur: 0.14};
    Object.assign(this.cling, c);
    this.mode = 'surf';
    this.setPlan(kind);
    this.anchorT = 0.25;
    this.tally.mounts++;
  }

  private surfUpdate(dt: number, w: BrainWorld, cw: CrawlWorld): BrainOutput {
    const out = this.idleOut(), c = this.cling, L = BB_BODY.centreUp, R = BB_BODY.radius;
    const B = this.blend;
    if (B) {
      // turning a corner
      B.t += dt;
      this.moving = true; this.paceNow = BB_CLIMB.speed;
      if (B.t >= B.dur) this.blend = null;
      const s = Math.min(1, B.t / B.dur);
      this.shadow(cw, B.x + (c.x + c.nx * L - B.x) * s, B.y + (c.y + c.ny * L - B.y) * s, B.z + (c.z + c.nz * L - B.z) * s);
      return out;
    }
    // the surface is still there (a door it clung to has opened ...), and the body still has room
    this.anchorT -= dt;
    if (this.anchorT <= 0) {
      this.anchorT = 0.25;
      if (!anchorValid(cw, c) || !centreValid(cw, c)) {
        this.startFall(c.nx * 0.8, Math.min(0, c.ny) * 0.8, c.nz * 0.8, BB_POUNCE.dropLandS);
        return out;
      }
    }
    const kind = clingKind(c);
    // back on a floor it can walk on: the ordinary floor body again
    if (kind === 'floor') {
      const fy = cw.stand(c.x, c.y, c.z, R) ?? cw.stand(c.x, c.y, c.z, 0.1);
      if (fy !== null) {
        this.toGround(c.x, fy, c.z, Math.atan2(c.hx, c.hz));
        this.noClimbT = Math.max(this.noClimbT, 3);
        this.wake();
        return out;
      }
    }
    const cx = c.x + c.nx * L, cy = c.y + c.ny * L, cz = c.z + c.nz * L;
    const turn = (this.stats.turnRate ?? 4.5) * dt;
    const a = this.act;
    if (a.k === 'windup') {
      steerCling(c, w.px - cx, this.chestY(w) - cy, w.pz - cz, turn);
      this.windupTick(a, dt, w, cw);
      if (this.mode === 'surf') this.shadow(cw, cx, cy, cz);
      return out;
    }
    if (a.k === 'stare') {
      a.t -= dt;
      if (this.knows) steerCling(c, this.known.x - cx, this.known.y + 1 - cy, this.known.z - cz, turn);
      if (a.t <= 0) this.act = NONE;
      this.shadow(cw, cx, cy, cz);
      return out;
    }
    if (a.k !== 'none') this.act = NONE;
    // the leap from a perch
    if (kind !== 'floor' && this.seenNow && this.cdT <= 0 && this.aimT <= 0 && w.playerAlive && this.chestDist(w) <= BB_POUNCE.dropMaxM) {
      if (this.aim(w, cw, false)) {
        this.beginWindup();
        this.shadow(cw, cx, cy, cz);
        return out;
      }
      this.aimT = 0.12;
    }
    this.runPlan(this.plan ?? this.setPlan(this.aware ? 'hunt' : 'down'), dt, cw, turn);
    if (this.mode === 'surf' && !this.blend) this.shadow(cw, c.x + c.nx * L, c.y + c.ny * L, c.z + c.nz * L);
    if (this.aware && !this.seenNow && this.unseen > 20) this.aware = false;
    return out;
  }

  /** One update of the surface plan: where it wants to go, the stop-start cadence, one crawl step, and what the step met. */
  private runPlan(P: Plan, dt: number, cw: CrawlWorld, turn: number): void {
    const c = this.cling, kind = clingKind(c), L = BB_BODY.centreUp, C = BB_CLIMB;
    const cx = c.x + c.nx * L, cy = c.y + c.ny * L, cz = c.z + c.nz * L;
    const K = this.known;
    P.t += dt;
    let wx = 0, wy = 0, wz = 0, steer = false, pace: number = C.speed, calm = false, far = false;
    const hold = (): void => {
      // it waits where it is, turned toward what it knows
      this.frozen = true;
      if (this.knows) steerCling(c, K.x - cx, K.y + 1 - cy, K.z - cz, turn);
    };
    switch (P.k) {
      case 'perch': {
        calm = true; pace = C.calmSpeed;
        if (P.settled) {
          P.holdS -= dt; P.twitchT -= dt;
          if (P.twitchT <= 0) { P.twitchT = 2.5 + this.rnd() * 3.5; this.pose.twitchSeq++; }
          if (P.holdS <= 0) this.setPlan('down');
          return;
        }
        if (kind === 'wall') {
          if (P.topped || (!P.ceiling && cy - this.y >= P.goalUp)) { P.settled = true; return; }
          wy = 1; steer = true;
        } else if (kind === 'ceiling' && P.travel <= 0) { P.settled = true; return; }
        if (P.t > 14) { P.settled = kind !== 'floor'; if (!P.settled) this.setPlan('down'); return; }
        break;
      }
      case 'retreat': {
        if (kind === 'wall' && !P.topped && cy - this.y < P.goalUp && P.t < 4) { wy = 1; steer = true; break; }
        if (this.cdT <= 0 || !this.knows) { this.setPlan(this.knows ? 'hunt' : 'down'); return; }
        hold();
        return;
      }
      case 'hunt': {
        if (!this.aware || !this.knows || P.blocks >= 4 || P.t > 16) { this.setPlan('down'); return; }
        const tx = K.x - cx, tz = K.z - cz, dh = Math.hypot(tx, tz);
        far = dh > BB_CADENCE.farM;
        if (kind === 'ceiling') {
          // over where it knows the player is; cooling down, it waits near instead of right overhead
          if (dh < 0.5 || (this.cdT > 0 && dh < 2.2)) { hold(); return; }
          wx = tx; wz = tz; steer = true;
        } else if (kind === 'wall') {
          // keep the vertical way it has on this wall (up from the floor; down a face met on the ceiling: a lintel or a beam is
          // crossed by its own surfaces), leaning sideways toward the target; at the climb limit, sideways only
          const tn = tx * c.nx + tz * c.nz;
          let lx = tx - tn * c.nx, lz = tz - tn * c.nz;
          const ll = Math.hypot(lx, lz);
          if (ll > 1e-3) { lx /= ll; lz /= ll; }
          if (P.topped || P.vert === 0) {
            if (ll < 0.4) { hold(); return; }
            wx = lx; wz = lz;
          } else { wy = P.vert; if (ll > 0.3) { wx = lx * 0.45; wz = lz * 0.45; } }
          steer = true;
        } else { wx = tx; wz = tz; steer = dh > 0.3; }
        break;
      }
      case 'down': {
        if (!this.aware) pace = C.calmSpeed;
        const H = this.home;
        if (kind === 'floor') {
          // a floor top it cannot stand on: off it, toward where it last stood
          if (P.t > 6 || P.blocks >= 4) { this.tally.forced++; this.lastForced = `floor top ${P.t.toFixed(1)} s, ${P.blocks} blocks, at ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`; this.toGround(c.x, c.y, c.z, Math.atan2(c.hx, c.hz)); this.wake(); return; }
          wx = H.x - c.x; wz = H.z - c.z; steer = Math.hypot(wx, wz) > 0.3;
        } else if (kind === 'ceiling' || P.t > 5 || P.blocks >= 3) {
          // let go where there is a floor to land on (in the end: anywhere — the fall finds the floor)
          const fy = floorBelow(cw, cx, cy, cz, CRAWL.maxHeightM + 1);
          if ((fy !== null && cw.stand(cx, fy, cz, BB_BODY.radius) !== null) || P.t > 7 || P.blocks >= 5) {
            this.startFall(c.nx * 0.6, Math.min(0, c.ny) * 0.6, c.nz * 0.6, BB_POUNCE.dropLandS);
            return;
          }
          wx = H.x - cx; wz = H.z - cz; steer = Math.hypot(wx, wz) > 0.3;
        } else { wy = -1; steer = true; } // down the wall to the floor
        break;
      }
    }
    if (!this.cadence(dt, calm, far)) { this.frozen = true; return; }
    if (P.detourT > 0) P.detourT -= dt;
    else if (steer) steerCling(c, wx, wy, wz, turn);
    const r = crawlStep(cw, c, pace * dt);
    if (r.moved > 1e-5) { this.moving = true; this.paceNow = pace; }
    if (P.k === 'perch' && kind === 'ceiling') P.travel -= r.moved;
    if ((r.event === 'inner' || r.event === 'outer') && r.next) {
      // round the corner: the body centre travels to its place on the next surface over a moment
      const n = r.next, bx = c.x + c.nx * L, by = c.y + c.ny * L, bz = c.z + c.nz * L;
      const d = Math.hypot(n.x + n.nx * L - bx, n.y + n.ny * L - by, n.z + n.nz * L - bz);
      this.blend = {x: bx, y: by, z: bz, t: 0, dur: Math.max(0.08, Math.min(0.25, d / pace))};
      const was = kind;
      Object.assign(c, n);
      const now = clingKind(c);
      if (now === 'wall') { if (Math.abs(c.hy) > 0.3) P.vert = c.hy > 0 ? 1 : -1; } else P.vert = 0;
      if (now !== was) P.topped = false;
      this.moving = true; this.paceNow = pace;
      this.tally.corners++;
    } else if (r.event === 'blocked') {
      if (r.by === 'height' && kind === 'wall' && c.hy > 0.3) P.topped = true;
      else if (P.k === 'perch' && kind !== 'floor') {
        // a calm climb that meets something stops there (too low to be a perch: down again)
        if (cy - this.y >= 1.2) P.settled = true; else this.setPlan('down');
      } else {
        // something in the way: a sidestep along the surface, then on toward the goal again
        P.blocks++;
        const s = this.rnd() < 0.5 ? 1 : -1;
        const rx = (c.ny * c.hz - c.nz * c.hy) * s, ry = (c.nz * c.hx - c.nx * c.hz) * s, rz = (c.nx * c.hy - c.ny * c.hx) * s;
        c.hx = rx; c.hy = ry; c.hz = rz;
        P.detourT = 0.5 + this.rnd() * 0.6;
      }
    }
  }

  // --------------------------------------------------------------------------------------------------------------------------
  // the pose

  /** Turn the pose's basis toward (u, f) by at most `maxAngle` rad (both stay unit and perpendicular). */
  private turnPose(ux: number, uy: number, uz: number, fx: number, fy: number, fz: number, maxAngle: number): void {
    const P = this.pose;
    let du = P.ux * ux + P.uy * uy + P.uz * uz;
    if (du < -0.95) {
      // upside down to the target (it let go of a ceiling): nose down first, then on round
      ux = -P.fx; uy = -P.fy; uz = -P.fz;
      fx = P.ux; fy = P.uy; fz = P.uz;
      du = 0;
    }
    const df = P.fx * fx + P.fy * fy + P.fz * fz;
    if (df < -0.95 && du > 0.95) {
      // an about-turn on its surface: round its own up axis
      const a = Math.min(maxAngle, Math.PI), s = Math.sin(a), k = Math.cos(a);
      const rx = P.uy * P.fz - P.uz * P.fy, ry = P.uz * P.fx - P.ux * P.fz, rz = P.ux * P.fy - P.uy * P.fx;
      fx = P.fx * k + rx * s; fy = P.fy * k + ry * s; fz = P.fz * k + rz * s;
      P.fx = fx; P.fy = fy; P.fz = fz;
      return;
    }
    const ang = Math.max(Math.acos(clamp1(du)), Math.acos(clamp1(df)));
    const k = ang <= maxAngle ? 1 : maxAngle / ang;
    let nx = P.ux + (ux - P.ux) * k, ny = P.uy + (uy - P.uy) * k, nz = P.uz + (uz - P.uz) * k;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    let gx = P.fx + (fx - P.fx) * k, gy = P.fy + (fy - P.fy) * k, gz = P.fz + (fz - P.fz) * k;
    let gn = gx * nx + gy * ny + gz * nz;
    gx -= gn * nx; gy -= gn * ny; gz -= gn * nz;
    let gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-4) {
      // forward fell onto the up axis: any direction square to it (the old up serves)
      gx = P.ux; gy = P.uy; gz = P.uz;
      gn = gx * nx + gy * ny + gz * nz;
      gx -= gn * nx; gy -= gn * ny; gz -= gn * nz;
      gl = Math.hypot(gx, gy, gz);
      if (gl < 1e-4) { gx = nz; gy = nx; gz = ny; gn = gx * nx + gy * ny + gz * nz; gx -= gn * nx; gy -= gn * ny; gz -= gn * nz; gl = Math.hypot(gx, gy, gz) || 1; }
    }
    P.ux = nx; P.uy = ny; P.uz = nz;
    P.fx = gx / gl; P.fy = gy / gl; P.fz = gz / gl;
  }

  private writePose(dt: number, w: BrainWorld): void {
    const P = this.pose, L = BB_BODY.centreUp;
    let cx: number, cy: number, cz: number;
    if (this.mode === 'ground') {
      cx = this.x; cy = this.y + L; cz = this.z;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      // upright and facing its yaw (the game turns the yaw slower than this): exactly the floor body; else it rights itself
      if (P.uy > 0.9995 && P.fx * fx + P.fz * fz > Math.cos(14 * dt)) { P.ux = 0; P.uy = 1; P.uz = 0; P.fx = fx; P.fy = 0; P.fz = fz; }
      else this.turnPose(0, 1, 0, fx, 0, fz, 14 * dt);
      P.surface = 'floor';
    } else if (this.mode === 'surf') {
      const c = this.cling, B = this.blend;
      cx = c.x + c.nx * L; cy = c.y + c.ny * L; cz = c.z + c.nz * L;
      if (B) {
        const s = Math.min(1, B.t / B.dur), e = s * s * (3 - 2 * s);
        cx = B.x + (cx - B.x) * e; cy = B.y + (cy - B.y) * e; cz = B.z + (cz - B.z) * e;
      }
      this.turnPose(c.nx, c.ny, c.nz, c.hx, c.hy, c.hz, 14 * dt);
      P.surface = clingKind(c);
      if (Math.hypot(P.fx, P.fz) > 0.3) this.yaw = Math.atan2(P.fx, P.fz);
    } else {
      const f = this.flight, vh = Math.hypot(f.vx, f.vz);
      cx = f.x; cy = f.y; cz = f.z;
      // in the air it rights itself, nose along its way
      let fx = P.fx, fz = P.fz;
      if (vh > 0.5 && this.alive) { fx = f.vx / vh; fz = f.vz / vh; }
      else { const l = Math.hypot(fx, fz); if (l > 0.2) { fx /= l; fz /= l; } else { fx = Math.sin(this.yaw); fz = Math.cos(this.yaw); } }
      this.turnPose(0, 1, 0, fx, 0, fz, 9 * dt);
      P.surface = 'air';
      if (Math.hypot(P.fx, P.fz) > 0.3) this.yaw = Math.atan2(P.fx, P.fz);
    }
    P.x = cx - P.ux * L; P.y = cy - P.uy * L; P.z = cz - P.uz * L;
    const phase: BbPhase = !this.alive ? 'dead'
      : this.mode === 'air' ? (this.leap ? 'pounce' : 'fall')
      : this.mode === 'ground' && this.state === 'stagger' ? 'stagger'
      : this.act.k === 'windup' ? 'windup'
      : this.act.k === 'land' ? 'land'
      : this.moving ? 'crawl' : this.frozen ? 'freeze' : 'idle';
    P.phaseT = phase === P.phase ? P.phaseT + dt : 0;
    P.phase = phase;
    P.speed = phase === 'crawl' || this.mode === 'air' ? this.paceNow : 0;
    if (this.seenNow) {
      const py = w.py ?? this.y, A = this.lookAt;
      A.x = w.px; A.y = (w.pEye ?? py + 1.62) - 0.1; A.z = w.pz;
      P.look = A;
    } else P.look = null;
  }
}

/** Per-actor cue bookkeeping (the brain's counters already played). */
const CUE_SEEN = new WeakMap<object, {cackle: number; windup: number}>();

/**
 * BB's positional cues (audio/sfx.ts bbVoice: the shared laugh set of all four looks): the cackle when it notices the player, a
 * quiet giggle now and then while it is near (the tell that one is about), a rising squeal that starts with the pounce's wind-up
 * (so it is heard BEFORE the leap), a yelp when hurt and a short death cry. Silent while a clip is missing — never a stand-in sound. Audio only: nothing here feeds the AI.
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
    if (!seen) CUE_SEEN.set(z, (seen = {cackle: P.cackleSeq, windup: P.windupSeq}));
    const my = P.y + P.uy * BB_VOICE_Y;
    if (P.cackleSeq !== seen.cackle) { seen.cackle = P.cackleSeq; sfx.bbVoice('cackle', z, P.x, my, P.z, b.y); z.groanT = 4 + rand() * 3; }
    if (P.windupSeq !== seen.windup) { seen.windup = P.windupSeq; sfx.bbVoice('pounce', z, P.x, my, P.z, b.y); }
    z.groanT -= dt;
    if (z.groanT <= 0) { z.groanT = 5 + rand() * 5; if (dist < 16 && P.phase !== 'windup' && P.phase !== 'pounce') sfx.bbVoice('giggle', z, P.x, my, P.z, b.y); }
  },
  hurt: (sfx, z) => { const b = z.brain as BbBrain, P = b.pose; sfx.bbVoice('hurt', z, P.x, P.y + P.uy * BB_VOICE_Y, P.z, b.y); },
  death: (sfx, z) => { const b = z.brain as BbBrain, P = b.pose; sfx.bbVoice('death', z, P.x, P.y + P.uy * BB_VOICE_Y, P.z, b.y); },
};
