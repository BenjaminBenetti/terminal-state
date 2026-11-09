// Zombie decision-making: idle / wander / chase / search / attack / stagger / climb / dead.
// Pure logic driven through a BrainWorld interface so it can be unit-tested without three.js.
//
// Iteration 05 (Lane T, vertical traversal): the brain tracks its feet height `y`. Chase paths may
// drop off the platform edge into the track bed (one-way) and climb rescue ladders (path waypoints
// carry the ladder id; the climb follows the same scripted path as the player's). Swipes need the
// player within ATTACK_REACH_Y vertically, so a zombie on the platform cannot hit a player down in
// the track bed — it drops in after them, and climbs out by the nearest ladder.
//
// Iteration 08 (Lane B, stacked levels): the brain passes feet heights to its world — sight is a 3D
// line between eye lines (a slab between storeys blocks it, an open stairwell does not), paths are
// planned from the zombie's storey to the target's (the last known position keeps its height), and
// path waypoints on another storey are not "reached" by standing above / below them. Worlds that
// ignore the extra arguments behave exactly as before.
//
// Iteration 12 (AI lane, mandate E): LIGHT ATTRACTS ENEMIES — a new 'investigate' state. An idle /
// wandering / searching enemy that can see a player-made light (flashlight spot or lens, flare;
// perception in ai/lightLure.ts, checked every ~0.4 s, staggered) walks SLOWLY toward it (wander
// speed x 1.2 via the normal level-aware pathfinder), stands near it while it stays visible
// ('hold': a burning flare gathers enemies), and when the light goes out / is lost walks on to the
// last seen spot (unless stuck / unreachable), lingers there, then returns to wander; it re-acquires a
// light that reappears. Seeing the player always wins (the normal chase / attack), and gunfire / damage alert
// it as before. Worlds without `lights` / `seePoint` (older tests) never investigate.

import type {ZombieType} from '../gen/station';
import type {Waypoint} from '../gen/grid';
import {CLIMB, climbDuration, ladderClimbPath, sampleClimb, type ClimbPath, type Ladder, type Vec3} from '../gen/traversal';
import type {LightSource, LightSourceKind} from '../world/lightSources';
import {LURE, perceiveLight, type LurePart, type LureSighting, type SeePoint} from './lightLure';
import {ATRIUM_CHASE} from './chaseShare'; // Task track3-eaton-centre-20261031 (lane HORDE, atrium AI)

export interface ZombieStats {
  hp: number;
  wanderSpeed: number;
  chaseSpeed: number;
  attackRange: number;
  attackDamage: number;
  attackDuration: number;
  /** Seconds into the Attack clip when the swipe lands (from the rig manifest). */
  attackImpact: number;
  sightRange: number;
  radius: number;
  chaseAnim: 'Run' | 'Walk';
  /** Iteration 07 (Lane Q): body turn rate outside attacks (rad/s; default 4.5) — the quadruped turns fast. */
  turnRate?: number;
  /** Task track1-siren-blightbelly-20261031 (lane SIREN): recovery (s) after a swing before the next can start (default 0.45, as before). */
  attackCooldown?: number;
  /** Iteration 08 (Lane B): clear height the body needs under soffits / slabs (m; default levels.BODY_CLEAR 1.6). */
  height?: number;
  /**
   * (Strainer reach, task studio-alpha-strainer-reach-squish-20261101-201110-01) a forward LUNGE inside the swing: between clip times
   * `from` .. `to` (s) the body travels up to `distM` toward the player through the normal motor (collision, storeys, no walls),
   * never closer than `stopM` (centre to centre). Default: none (every other enemy swings in place, as before).
   */
  lunge?: {distM: number; from: number; to: number; stopM: number};
  /** (Strainer reach) centre-to-centre distance at which the swing connects at the impact frame (default attackRange + 0.45, as before). */
  hitRange?: number;
}

// Attack duration/impact match the Attack clip (1.1 s, impact 0.45 s) in derivatives/zombie-rigged.json.
// The coated variant is tougher and slower: its Run clip plays at ~0.76x for a heavier lurch.
export const ZOMBIE_STATS: Record<ZombieType, ZombieStats> = {
  shambler: {hp: 100, wanderSpeed: 0.65, chaseSpeed: 2.55, attackRange: 1.35, attackDamage: 10, attackDuration: 1.1, attackImpact: 0.45, sightRange: 18, radius: 0.33, chaseAnim: 'Run'},
  coated: {hp: 165, wanderSpeed: 0.55, chaseSpeed: 1.75, attackRange: 1.4, attackDamage: 15, attackDuration: 1.1, attackImpact: 0.45, sightRange: 16, radius: 0.38, chaseAnim: 'Run'},
};

// Task track3-eaton-centre-20261031 (lane HORDE): 'patrol' = a roaming-horde member walking in its group's formation (ai/horde.ts
// steers it through `escort`). Only a brain with an escort ever enters it (no pre-mall enemy has one: their behaviour is unchanged).
// It behaves like wandering for every existing mechanic: seeing the player -> chase, gunfire / damage -> chase, a seen light ->
// investigate; when the chase / search / investigation ends the member idles a moment, then rejoins its group (idle -> patrol).
export type BrainState = 'idle' | 'wander' | 'chase' | 'search' | 'attack' | 'stagger' | 'climb' | 'dead' | 'investigate' | 'patrol'
  // Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren's (ai/siren.ts SirenBrain) floor-hunched DORMANT state and her one-time
  // RISE after the wake. The base brain never enters them (no case in step(), not LURABLE, hear() ignores them).
  | 'dormant' | 'rise';
/** Iteration 12 (AI): states in which an enemy notices light (never while chasing / attacking / staggered / climbing). */
const LURABLE: ReadonlySet<BrainState> = new Set<BrainState>(['idle', 'wander', 'search', 'investigate', 'patrol']);

/** Task track3-eaton-centre-20261031 (lane HORDE): a horde member's link to its group (ai/horde.ts): steers the 'patrol' state. */
export interface PatrolLink {
  /** Fill `out` (direction / speed / facing / anim) for one 'patrol' frame of brain `b` (sight was already checked: not seen). */
  steer(b: ZombieBrain, out: BrainOutput, dt: number, w: BrainWorld, moved: number): void;
}

/** Iteration 12 (AI): an enemy's current light investigation (QA reads it through `brain.lure`). */
export interface LureState {
  lightId: number;
  kind: LightSourceKind;
  part: LurePart;
  /** Last seen light point (world, absolute y). */
  x: number; y: number; z: number;
  /** Walk goal: a standable point near it on its storey (gy = that floor). */
  gx: number; gz: number; gy: number;
  /** Brain time the light was last seen / the investigation began. */
  seenT: number;
  startT: number;
  /** approach = walking to it; hold = standing near a still-visible light; linger = lost it, waiting before wandering off. */
  phase: 'approach' | 'hold' | 'linger';
  lingerT: number;
  /** Stop distance from the light point (m, per enemy). */
  stop: number;
  /** Goal of the current path, re-plan timer, stuck time / count. */
  pathGoal: [number, number] | null;
  repathT: number;
  stuckT: number;
  stucks: number;
}
/** Vertical reach of a swipe (m between feet heights). */
export const ATTACK_REACH_Y = 0.9;
export type AnimName = 'Idle' | 'Walk' | 'Run' | 'Attack' | 'Hit' | 'Death';

export interface BrainWorld {
  px: number;
  pz: number;
  playerAlive: boolean;
  /** Iteration 08: `ay` / `by` = feet heights of the two ends (3D sight between eye lines on stacked stations). */
  los(ax: number, az: number, bx: number, bz: number, ay?: number, by?: number): boolean;
  /** Iteration 08: `ay` = feet height at a, `by` = the walk must end at that height (same storey). */
  walkClear(ax: number, az: number, bx: number, bz: number, r: number, ay?: number, by?: number): boolean;
  /**
   * `drops`: chase paths may jump down ledges (platform edge into the track bed). Iteration 08: `ay` / `by` = start / goal feet
   * heights (storeys). Task frame-budget-deferral-20261030 (lane SCHED): `defer` = the requesting brain, offered only by a chase
   * re-plan of an enemy that does not see the player; the world MAY then answer `undefined` = "queued in the background, ask
   * again next frame" (the game does for far enemies: ai/pathService.ts). Without `defer` the answer is always immediate.
   */
  findPath(ax: number, az: number, bx: number, bz: number, opts?: {drops?: boolean; noLinks?: boolean; ay?: number; by?: number; defer?: object; seen?: boolean; local?: boolean}): Waypoint[] | null | undefined;
  /** Iteration 08: `y` = feet height (stay on that storey); the optional 3rd element is the point's floor height. */
  randomNear(x: number, z: number, r: number, y?: number): [number, number] | [number, number, number] | null;
  rand(): number;
  /** Player feet height (world y); omitted = same level. */
  py?: number;
  /** Ladder geometry for path waypoints that climb one. */
  ladder?(id: number): Ladder | undefined;
  /** Iteration 12 (AI): player-made lights that can attract enemies this frame (world/lightSources.ts attracting()); absent = no lure. */
  lights?: readonly LightSource[];
  /** Iteration 12 (AI): 3D sight from an enemy's eye (feet ay + 1.5 m) to a world point (walls, shutters, sight props, slabs block). */
  seePoint?: SeePoint;
  /** Iteration 12 (AI): standable [x, z, floor] near a lit point on the storey containing it (absent / null: the point on the enemy's storey). */
  lureGoal?(x: number, y: number, z: number): [number, number, number] | null;
  /**
   * Task track3-eaton-centre-20261031 (lane HORDE, atrium AI): an OPEN-ATRIUM level (the mall: the game sets it only for a layout
   * with `mall`; ai/chaseShare.ts ATRIUM_CHASE). A chase re-plan toward a SEEN player on another storey is then offered to the
   * deferral (`defer` + `seen`: the path service still answers a NEAR enemy at once), and a re-plan whose goal has not moved
   * materially keeps the current route a little longer (never within ATRIUM_CHASE.nearM). Absent: the established chase, unchanged.
   */
  atrium?: boolean;
  /**
   * Task studio-beta-mall-round3-20261031-01 (lane ENEMY, R2): the open-atrium NOTICE rule (ATRIUM_PERCEPTION: an unaware enemy and a
   * player on another storey — 3D range, dwell). The game sets it together with `atrium` (layout.mall only); separate so the Node
   * aggro scenario can compare the rule off / on with the atrium chase rules unchanged. Absent: the established sight.
   */
  atriumNotice?: boolean;
  /**
   * Task studio-market-bar-20261108-225231-01 (lane BEER): THE one "how detectable is the player" factor (Night Shift Porter: 0.75;
   * absent / 1: the established perception). Applied ONCE per channel — an UNAWARE enemy's sight / notice distances (sees, noticeAcross)
   * and the player's noise radius (alertListeners `detect`) — never compounded. An enemy already aware of the player keeps its sight:
   * the AI is never switched off and aggro is never dropped by it.
   */
  detect?: number;
}

/** (lane BEER) The detection factor in use: a finite positive BrainWorld.detect, else 1. */
export const detectFactor = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) && v > 0 ? v : 1);

export interface BrainOutput {
  /** Desired horizontal direction (unit or zero). */
  dirX: number;
  dirZ: number;
  speed: number;
  /** Yaw the body should turn toward (radians, model forward +Z), or null to keep. */
  face: number | null;
  anim: AnimName;
  attackHit: boolean;
  /** Became aware of the player this frame (for a growl). */
  alerted: boolean;
}

/**
 * Task office-seamless-20261029 (ENGINE): how far gunfire carries (multiplier of the weapon's noise radius). In sight: 1;
 * behind walls on the same storey: `wall` (0.6, as iteration 08); through n slabs (storey floors between the shooter's
 * and the listener's feet): `slab`^n (0.35 for one slab, as iteration 08; a shot on floor 8 never reaches the station).
 */
export const HEARING = {wall: 0.6, slab: 0.35} as const;

/** Storey floors strictly between two feet heights: level base heights in (min + 1, max + 1] (a stair landing counts). */
export function slabsBetween(bases: readonly number[], ya: number, yb: number): number {
  const lo = Math.min(ya, yb) + 1, hi = Math.max(ya, yb) + 1;
  let n = 0;
  for (const b of bases) if (b > lo && b <= hi) n++;
  return n;
}

/** Noise-radius multiplier for a listener (see HEARING). */
export function hearingMuffle(los: boolean, slabs: number): number {
  if (los) return 1;
  return slabs > 0 ? HEARING.slab ** slabs : HEARING.wall;
}

/**
 * Task studio-beta-mall-round3-20261031-01 (lane ENEMY, R2). User (mall round 3): "slight agro issue at the start of the level. When
 * killing zombies at the subway terminal the open atrium often causes zombies higher up to agro, causing them to run down in a big
 * stream. We might need better line of sight checks before agro-ing or something."
 *
 * Measured cause (deterministic Node scenario on 12 generated malls, tests/mall-atrium-aggro.test.ts; lanes/ENEMY.notes): the
 * established perception treats the open atrium like open floor. (1) SIGHT: the range test is the PLAN distance (18 m), so an idle
 * zombie 15 m up on floor 3 noticed a player in the pit 21-23 m away (3D) the moment it stood by the void, and the 5 m all-round
 * awareness was plan distance too (anyone right above saw straight down); (2) GUNFIRE: a listener with a sight line through the void
 * heard a shot at full loudness (rifle 30 m, shotgun 38 m: zombies two floors up at 26-28 m answered); (3) HORDE CALLS: a single
 * member's sighting across the void called every mate within 6 m — the whole group (up to 17 measured) ran down at once.
 *
 * OPEN-ATRIUM rules — only in an open-atrium level (BrainWorld.atriumNotice / alertListeners `atrium` / HordeDirector.alerted's
 * `targetY`: the game passes them only for a layout with `mall`; the Subway and the Office never see them), only ACROSS STOREYS (feet more than `dy` apart: an escalator rider half
 * a storey away is still "the same floor"), and only for NOTICING (an enemy already aware of the player — chasing / searching —
 * keeps the established sight; nobody that genuinely sees the player goes blind):
 *  - sight: an UNAWARE enemy notices a player on another storey within sightRange x `noticeFrac` measured in 3D (eye to eye:
 *    shambler 13.5 m, coated 12, rat/dog 15), inside its usual field of view (1.3 rad) unless within `closeM` (3D), with a clear
 *    3D sight line — and only after keeping the player in view for `dwellS` s (a glance down through the void is not a sighting);
 *  - gunfire: a listener on another storey that hears the shot THROUGH the open void (a sight line, no slab between) hears it
 *    x `hearOpen` per storey between (rifle 30 m: floor 1 21 m, floor 2 14.7 m, floor 3 10.3 m — the pit is 15 m below it) — some
 *    sound carries up the atrium, not the whole mall; through slabs the established x0.35 per slab still applies. Of the listeners
 *    on other storeys (through the void or a slab) a single noise would newly send hunting, only the `hearCrossMax` nearest react (a
 *    crowd joins shot by shot, never all at once from one shot: measured, a horde walking over the station heard one shot through
 *    the floor slab and 7 of its members came down together);
 *  - horde call (ai/horde.ts HordeDirector.alerted): a member that noticed the player on ANOTHER storey calls at most
 *    `callCrossMax` mates (the nearest within the usual call radius); a same-storey call is unchanged.
 * Attack timing / damage / HP, the Siren's dormant wake (proximity / flashlight / damage — she ignores hearing while dormant),
 * Blightbelly burst and rat/dog mechanics, and horde composition are untouched.
 */
export const ATRIUM_PERCEPTION = {
  /** Feet heights farther apart than this (m) are different storeys (STOREY 5 m; mid-escalator 2.5 m is not). */
  dy: 3,
  /** Unaware cross-storey notice range = the enemy's sightRange x this, measured in 3D. */
  noticeFrac: 0.75,
  /** Within this 3D distance (m) the field of view does not matter (the base brain's 5 m all-round awareness, but in 3D). */
  closeM: 5,
  /** Continuous sight (s) an unaware enemy needs to notice a player on another storey. */
  dwellS: 1.0,
  /** Gunfire heard across storeys through the open void (sight line, no slab): radius x hearOpen^storeys. */
  hearOpen: 0.7,
  /** At most this many NEW cross-storey responders per noise (nearest first). */
  hearCrossMax: 3,
  /** A horde member that noticed the player on another storey calls at most this many mates (nearest first). */
  callCrossMax: 2,
} as const;

/** Brain states a heard noise turns into a chase (ZombieBrain.hear). */
const HEAR_TURNS: ReadonlySet<BrainState> = new Set<BrainState>(['idle', 'wander', 'search', 'investigate', 'patrol']);

/**
 * Task studio-beta-mall-round3-20261031-01 (lane ENEMY, R2): Game.alertZombies' listener loop, moved here verbatim so the Node
 * aggro scenario (tests/helpers/aggroSim.ts) runs the game's own rule. A noise of loudness `radius` at `src` (feet): every living
 * enemy within the 3D radius hears it muffled by hearingMuffle(los(b), slabs between the feet heights; `bases` null = one level).
 * `atrium` (open-atrium levels only): listeners on another storey with a sight line through the void use ATRIUM_PERCEPTION.hearOpen
 * per storey (through slabs: the established muffle), and of ALL the listeners on other storeys that would newly start hunting at
 * most hearCrossMax react (nearest first). Without `atrium`: exactly the established loop.
 * Task studio-market-bar-20261108-225231-01 (lane BEER): `detect` = BrainWorld.detect (the player's one detectability factor) scales the
 * noise radius once, before everything else (1: the established loop).
 */
export function alertListeners(brains: Iterable<ZombieBrain>, src: {x: number; y: number; z: number}, radius: number, los: (b: ZombieBrain) => boolean, bases: readonly number[] | null, atrium = false, detect = 1): void {
  radius *= detectFactor(detect);
  let cross: {b: ZombieBrain; d: number; r: number}[] | null = null;
  for (const b of brains) {
    const d = Math.hypot(b.x - src.x, b.z - src.z, b.y - src.y);
    if (!b.alive || d > radius) continue;
    const seen = los(b), slabs = bases ? slabsBetween(bases, src.y, b.y) : 0;
    if (atrium && slabs > 0 && Math.abs(b.y - src.y) > ATRIUM_PERCEPTION.dy) {
      // another storey: through the open void (a sight line) x hearOpen per storey; through the slabs the established x0.35 each
      const r = radius * (seen ? ATRIUM_PERCEPTION.hearOpen ** slabs : hearingMuffle(false, slabs));
      if (d > r) continue;
      if (HEAR_TURNS.has(b.state)) (cross ??= []).push({b, d, r}); // would newly start hunting: capped below
      else b.hear(src.x, src.z, r, src.y); // already hunting (its last known spot moves) / dormant / climbing: as always
      continue;
    }
    b.hear(src.x, src.z, radius * hearingMuffle(seen, slabs), src.y);
  }
  if (!cross) return;
  cross.sort((p, q) => p.d - q.d); // stable: equal distances keep the enemy order
  for (let k = 0; k < cross.length && k < ATRIUM_PERCEPTION.hearCrossMax; k++) cross[k].b.hear(src.x, src.z, cross[k].r, src.y);
}

export class ZombieBrain {
  state: BrainState = 'idle';
  hp: number;
  t = 0;
  private stateT = 0;
  private path: Waypoint[] = [];
  /** Feet height (world y): set by the game's motor (gravity/stairs) and by ladder climbs. */
  y = 0;
  /** Vertical speed while falling (0 = on the ground). */
  vy = 0;
  private climb: {path: ClimbPath; t: number; ladder: number; yaw: number; resume: BrainState; resumeT: number} | null = null;
  private readonly tmp: Vec3 = {x: 0, y: 0, z: 0};
  private repathT = 0;
  /** Task frame-budget-deferral-20261030 (lane SCHED): the chase re-plan timer drawn at the first ask of a re-plan still queued (null: none). */
  private nextRepathT: number | null = null;
  /** Last known player position; iteration 08: with its feet height when known (its storey). */
  private lastKnown: [number, number, number?] | null = null;
  private unseenT = 0;
  private attackDone = false;
  private staggerCd = 0;
  /** Recovery after a swing before the next one can start. */
  private attackCd = 0;
  private stuckT = 0;
  /** Back-off after a failed path search so an unreachable goal is not re-searched every frame. */
  private pathFailT = 0;
  private lastX = 0;
  private lastZ = 0;
  aware = false;
  /** Increments every time a new attack swing starts (lets the animator replay the clip). */
  attackSeq = 0;
  /** Iteration 12 (AI): the light being investigated (state 'investigate', kept through a ladder climb), else null. */
  lure: LureState | null = null;
  /** Iteration 12 (AI): investigations started / light checks run (QA counters). */
  lureStarts = 0;
  lureChecks = 0;
  /** Iteration 12 (AI): commanded ground speed of the last update (QA: the investigate walk is slow). */
  speedCmd = 0;
  /** Iteration 12 (AI): countdown to the next light check, and a private jitter stream (never consumes world.rand). */
  private lureCheckT: number;
  private lureSeed: number;
  /** Task track3-eaton-centre-20261031 (lane HORDE): the roaming-horde group steering this member's 'patrol' state; null = ordinary enemy. */
  escort: PatrolLink | null = null;
  /** Lane HORDE (atrium AI, w.atrium only): goal of the last planned chase route [x, z, y] and when; re-plans skipped by the throttle (QA). */
  private plannedGoal: [number, number, number] | null = null;
  private plannedT = 0;
  throttled = 0;
  /** Lane ENEMY (mall round 3, R2): continuous cross-storey sight (s) of an unaware enemy in an open-atrium level (ATRIUM_PERCEPTION.dwellS). */
  noticeT = 0;

  constructor(readonly type: ZombieType, public x: number, public z: number, public yaw: number, readonly stats: ZombieStats = ZOMBIE_STATS[type]) {
    this.hp = stats.hp;
    this.stateT = 1 + (x * 7.31 + z * 3.17) % 3;
    this.lureSeed = (Math.imul(Math.round(x * 64) | 0, 0x9e3779b1) ^ Math.imul(Math.round(z * 64) | 0, 0x85ebca6b) ^ 0x2545f491) | 0 || 1;
    this.lureCheckT = this.lureRnd() * LURE.period; // phase-staggered first check
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  /** Task track3-eaton-centre-20261031 (lane HORDE): start walking with the group (an idle / wandering member with an escort). */
  joinPatrol(): boolean {
    if (!this.escort || (this.state !== 'idle' && this.state !== 'wander' && this.state !== 'patrol')) return false;
    if (this.state !== 'patrol') { this.setState('patrol'); this.path = []; }
    return true;
  }

  /** Iteration 12 (AI): xorshift jitter for the lure timers (deterministic per spawn; leaves world.rand untouched). */
  private lureRnd(): number {
    let s = this.lureSeed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.lureSeed = s;
    return (s >>> 0) / 4294967296;
  }

  private setState(s: BrainState, t = 0) {
    if (s === 'attack') this.attackSeq++;
    if (s !== 'investigate' && s !== 'climb') this.lure = null; // Iteration 12 (AI): any other state ends a light investigation
    this.nextRepathT = null; // lane SCHED: a queued re-plan's timer belongs to the state that asked
    this.state = s;
    this.stateT = t;
    this.attackDone = false;
  }

  /**
   * Heard a loud noise (gunshot) at a position (iteration 08: `y` = the source's feet height). Task office-seamless-20261029
   * (ENGINE): the distance is 3D when `y` is given (a shot two storeys up is 8.8 m further away than its plan distance);
   * the caller's radius already carries the walls / slabs between (hearingMuffle).
   */
  hear(x: number, z: number, radius: number, y?: number): void {
    if (!this.alive) return;
    if (Math.hypot(x - this.x, z - this.z, y === undefined ? 0 : y - this.y) > radius) return;
    this.lastKnown = [x, z, y];
    this.aware = true;
    if (this.state === 'idle' || this.state === 'wander' || this.state === 'search' || this.state === 'investigate' || this.state === 'patrol') {
      this.setState('chase');
      this.repathT = 0;
      this.path = []; // lane SCHED: the old wander / search path is no chase route (an immediate re-plan replaced it this frame anyway)
    } else if (this.climb) this.climb.resume = 'chase';
  }

  /**
   * Returns true if this hit killed the zombie (iteration 08: `fromY` = the shooter's feet height). Lane KNIFE
   * (knife-melee-20261030): `o.stagger === false` skips the hit stagger (melee hits: no stun-lock — a zombie hit by the knife
   * keeps closing / swinging, so getting close stays a trade); everything else (aware, chase, death) is the same.
   */
  damage(amount: number, fromX: number, fromZ: number, fromY?: number, o: {stagger?: boolean} = {}): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.lastKnown = [fromX, fromZ, fromY];
    this.aware = true;
    if (this.hp <= 0) {
      this.hp = 0;
      this.setState('dead');
      return true;
    }
    if (this.state === 'climb') { if (this.climb) this.climb.resume = 'chase'; }
    else if (this.state !== 'attack' && amount >= 20 && this.staggerCd <= 0 && o.stagger !== false) {
      this.setState('stagger', 0.35);
      this.staggerCd = 0.9;
    } else if (this.state === 'idle' || this.state === 'wander' || this.state === 'search' || this.state === 'investigate' || this.state === 'patrol') {
      this.setState('chase');
      this.path = []; // lane SCHED: as in hear()
    }
    this.repathT = 0;
    return false;
  }

  private sees(w: BrainWorld, dt: number): boolean {
    if (!w.playerAlive) { this.noticeT = 0; return false; }
    const dx = w.px - this.x, dz = w.pz - this.z;
    // lane ENEMY (mall round 3, R2): an unaware enemy and a player on another storey of an open-atrium level (ATRIUM_PERCEPTION)
    if (w.atriumNotice === true && !this.aware && w.py !== undefined && Math.abs(w.py - this.y) > ATRIUM_PERCEPTION.dy) return this.noticeAcross(w, dx, dz, dt);
    this.noticeT = 0;
    const d = Math.hypot(dx, dz);
    // (lane BEER) an UNAWARE enemy's notice distances x the player's one detectability factor (an aware one: the established sight)
    const k = this.aware ? 1 : detectFactor(w.detect);
    if (d > this.stats.sightRange * k) return false;
    if (d > 2.5 * k) {
      const ang = Math.atan2(dx, dz) - this.yaw;
      const a = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)));
      if (!this.aware && a > 1.3 && d > 5 * k) return false;
    }
    return w.los(this.x, this.z, w.px, w.pz, this.y, w.py);
  }

  /**
   * Lane ENEMY (mall round 3, R2; ATRIUM_PERCEPTION): an UNAWARE enemy noticing a player on another storey of an open-atrium level —
   * 3D distance within sightRange x noticeFrac, the usual 1.3 rad field of view beyond closeM (3D), a clear 3D sight line, held
   * for dwellS s of continuous sight (any frame without it starts the count again).
   */
  private noticeAcross(w: BrainWorld, dx: number, dz: number, dt: number): boolean {
    const A = ATRIUM_PERCEPTION, d = Math.hypot(dx, dz, (w.py ?? this.y) - this.y), k = detectFactor(w.detect); // (lane BEER: unaware only)
    let ok = d <= this.stats.sightRange * A.noticeFrac * k;
    if (ok && d > A.closeM * k) {
      const ang = Math.atan2(dx, dz) - this.yaw;
      ok = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) <= 1.3;
    }
    if (ok) ok = w.los(this.x, this.z, w.px, w.pz, this.y, w.py);
    if (!ok) { this.noticeT = 0; return false; }
    this.noticeT += dt;
    return this.noticeT >= A.dwellS;
  }

  private steerTo(w: BrainWorld, tx: number, tz: number, out: BrainOutput): boolean {
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) return true;
    out.dirX = dx / d;
    out.dirZ = dz / d;
    out.face = Math.atan2(dx, dz);
    void w;
    return false;
  }

  private followPath(w: BrainWorld, out: BrainOutput, speed: number): boolean {
    while (this.path.length) {
      const [tx, tz, link, ty] = this.path[0];
      // iteration 08: a waypoint on another storey (directly above / below) is not reached yet
      if (link === undefined && Math.hypot(tx - this.x, tz - this.z) < 0.35 && (ty === undefined || Math.abs(ty - this.y) < 1.2)) this.path.shift();
      else break;
    }
    if (!this.path.length) return true;
    const [tx, tz, link] = this.path[0];
    if (link !== undefined) {
      // Waypoint reached by climbing a ladder: walk to its near end, then climb.
      const l = w.ladder?.(link);
      if (!l) { this.path.shift(); return false; }
      const up = Math.abs(this.y - l.bottomY) <= Math.abs(this.y - l.topY);
      const start = up ? l.bottom : l.top;
      if (Math.hypot(start.x - this.x, start.z - this.z) < 0.55) { this.beginClimb(l, up); return false; }
      this.steerTo(w, start.x, start.z, out);
      out.speed = speed;
      return false;
    }
    this.steerTo(w, tx, tz, out);
    out.speed = speed;
    return false;
  }

  /** Scripted ladder climb (same path as the player's, zombie speeds). */
  private beginClimb(l: Ladder, up: boolean): void {
    const resume = this.state, resumeT = this.stateT;
    this.climb = {path: ladderClimbPath(l, up, {x: this.x, y: this.y, z: this.z}, CLIMB.zombie), t: 0, ladder: l.id, yaw: l.dir > 0 ? 0 : Math.PI, resume, resumeT};
    this.setState('climb');
  }

  get climbing(): boolean {
    return this.state === 'climb';
  }

  update(dt: number, w: BrainWorld): BrainOutput {
    const out: BrainOutput = {dirX: 0, dirZ: 0, speed: 0, face: null, anim: 'Idle', attackHit: false, alerted: false};
    this.t += dt;
    this.staggerCd = Math.max(0, this.staggerCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.pathFailT = Math.max(0, this.pathFailT - dt);
    if (this.state === 'dead') { out.anim = 'Death'; return out; }
    const sees = this.sees(w, dt);
    const distP = Math.hypot(w.px - this.x, w.pz - this.z);
    if (sees) {
      if (!this.aware) out.alerted = true;
      this.aware = true;
      this.lastKnown = [w.px, w.pz, w.py];
      this.unseenT = 0;
    } else this.unseenT += dt;

    // Stuck detection while moving: re-path or pick a new wander target.
    const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
    this.lastX = this.x; this.lastZ = this.z;

    // Iteration 12 (AI): light check at a modest staggered rate; skipped when the player is in sight (the player wins).
    this.lureCheckT -= dt;
    if (this.lureCheckT <= 0) {
      this.lureCheckT = LURE.period * (0.8 + 0.4 * this.lureRnd());
      if (!sees && w.lights?.length && w.seePoint && LURABLE.has(this.state)) {
        this.lureChecks++;
        const s = perceiveLight(this, w.lights, w.seePoint, this.state === 'investigate' && this.lure ? this.lure.lightId : null);
        if (s) this.noticeLight(w, s);
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      const before: BrainState = this.state;
      this.step(dt, w, out, sees, distP, moved);
      // Newly alerted zombies start moving in the same frame.
      if (this.state === before || this.state !== 'chase') break;
    }
    this.speedCmd = out.speed;
    return out;
  }

  private step(dt: number, w: BrainWorld, out: BrainOutput, sees: boolean, distP: number, moved: number): void {
    switch (this.state) {
      case 'idle': {
        this.stateT -= dt;
        out.anim = 'Idle';
        if (sees) { this.setState('chase'); this.repathT = 0; break; }
        if (this.stateT <= 0) {
          if (this.escort) { this.setState('patrol'); this.path = []; break; } // lane HORDE: rejoin the group instead of wandering
          const p = w.randomNear(this.x, this.z, 6, this.y);
          const path = p && this.localPath(w, p);
          if (path && path.length) { this.path = path; this.setState('wander', 12); }
          else this.stateT = 2 + w.rand() * 3;
        }
        break;
      }
      case 'wander':
      case 'search': {
        this.stateT -= dt;
        if (sees) { this.setState('chase'); this.repathT = 0; break; }
        const done = this.followPath(w, out, this.stats.wanderSpeed * (this.state === 'search' ? 1.4 : 1));
        out.anim = 'Walk';
        if (out.speed > 0 && moved < 0.002) this.stuckT += dt; else this.stuckT = 0;
        if (done || this.stateT <= 0 || this.stuckT > 1.5) {
          this.stuckT = 0;
          this.setState('idle', 1.5 + w.rand() * 3.5);
          if (this.unseenT > 20) this.aware = false;
        }
        break;
      }
      case 'chase': {
        if (!w.playerAlive) { this.setState('idle', 3); break; }
        if (sees && distP <= this.stats.attackRange && this.attackCd <= 0 && this.reachY(w)) {
          this.setState('attack', this.stats.attackDuration);
          out.face = Math.atan2(w.px - this.x, w.pz - this.z);
          out.anim = 'Attack';
          break;
        }
        const goal = this.lastKnown ?? [w.px, w.pz, w.py];
        out.anim = this.stats.chaseAnim;
        if (sees && w.walkClear(this.x, this.z, w.px, w.pz, this.stats.radius * 0.9, this.y, w.py)) {
          this.steerTo(w, w.px, w.pz, out);
          out.speed = this.stats.chaseSpeed;
          this.path = [];
        } else {
          this.repathT -= dt;
          let pending = false;
          // Task track3-eaton-centre-20261031 (lane HORDE, atrium AI; only with w.atrium): the goal has not moved materially since the
          // route was planned (measured from the planned goal: drift accumulates), the route is still there and the goal is not
          // close: keep it and look again shortly (at most ATRIUM_CHASE.holdMax without a re-plan).
          const pg = this.plannedGoal;
          if (w.atrium === true && (this.repathT <= 0 || (!this.path.length && this.pathFailT <= 0)) && pg && this.path.length && this.nextRepathT === null
            && this.t - this.plannedT < ATRIUM_CHASE.holdMax && Math.hypot(goal[0] - pg[0], goal[1] - pg[1]) < ATRIUM_CHASE.moved
            && Math.abs((goal[2] ?? this.y) - pg[2]) < 1 && Math.hypot(goal[0] - this.x, goal[1] - this.z) > ATRIUM_CHASE.nearM) {
            this.repathT = ATRIUM_CHASE.recheck;
            this.throttled++;
          }
          if (this.repathT <= 0 || (!this.path.length && this.pathFailT <= 0)) {
            // Far goals re-plan less often (long detours on the large station are costly). Task frame-budget-deferral-20261030
            // (lane SCHED): the timer is drawn at the FIRST ask, before the search, exactly as before. Not seeing the player,
            // the re-plan may be queued (undefined): keep following the current path, ask again next frame; the timer starts
            // once the path is there (and a failed search draws its back-off then, as it always did after the search).
            this.nextRepathT ??= 0.45 + w.rand() * 0.2 + Math.min(0.9, Math.hypot(goal[0] - this.x, goal[1] - this.z) / 45);
            // lane HORDE (atrium AI, only with w.atrium): a seen player on another storey is not 'critical near AI' by itself — offer
            // the re-plan to the deferral (the service answers a near enemy at once and queues a far one; it keeps facing / following)
            const seenFar = sees && w.atrium === true && Math.abs((w.py ?? this.y) - this.y) > ATRIUM_CHASE.dy;
            const path = w.findPath(this.x, this.z, goal[0], goal[1], sees && !seenFar ? {drops: true, ...this.pathOpts(goal[2])} : seenFar ? {drops: true, ...this.pathOpts(goal[2]), defer: this, seen: true} : {drops: true, ...this.pathOpts(goal[2]), defer: this});
            if (path === undefined) pending = true;
            else {
              this.repathT = this.nextRepathT;
              this.nextRepathT = null;
              this.path = path ?? [];
              if (!path) { this.pathFailT = 1.2 + w.rand() * 0.6; this.repathT = this.pathFailT; }
              if (w.atrium === true) { this.plannedGoal = path ? [goal[0], goal[1], goal[2] ?? this.y] : null; this.plannedT = this.t; } // lane HORDE: the throttle's reference
            }
          }
          const done = this.followPath(w, out, this.stats.chaseSpeed);
          // lane SCHED: a queued re-plan with nothing to follow yet: stand facing the goal (no running on the spot)
          if (done && pending) { out.anim = 'Idle'; out.face = Math.atan2(goal[0] - this.x, goal[1] - this.z); }
          if (done && !sees && !pending) {
            // Reached the last known position without seeing the player: search around.
            if (this.unseenT > 1.5) {
              const p = w.randomNear(this.x, this.z, 5, this.y);
              this.path = p ? this.localPath(w, p) ?? [] : [];
              this.setState('search', 8);
              this.lastKnown = null;
            }
          }
        }
        if (this.unseenT > 9 && this.state === 'chase') {
          this.setState('search', 6);
          const p = w.randomNear(this.x, this.z, 5, this.y);
          this.path = p ? this.localPath(w, p) ?? [] : [];
        }
        break;
      }
      case 'attack': {
        const total = this.stats.attackDuration;
        const elapsed = total - this.stateT;
        this.stateT -= dt;
        out.anim = 'Attack';
        if (elapsed < this.stats.attackImpact) out.face = Math.atan2(w.px - this.x, w.pz - this.z);
        // (Strainer reach) the lunge: travel toward the player inside the swing window (the motor keeps walls / storeys / bodies)
        const L = this.stats.lunge;
        if (L && elapsed >= L.from && elapsed < L.to && distP > L.stopM && w.playerAlive) {
          const d = Math.max(1e-6, Math.hypot(w.px - this.x, w.pz - this.z));
          out.dirX = (w.px - this.x) / d;
          out.dirZ = (w.pz - this.z) / d;
          out.speed = Math.min(L.distM / (L.to - L.from), (distP - L.stopM) / Math.max(dt, 1e-3));
        }
        if (!this.attackDone && elapsed + dt >= this.stats.attackImpact) {
          this.attackDone = true;
          const ang = Math.atan2(w.px - this.x, w.pz - this.z) - this.yaw;
          const a = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)));
          const hitRange = this.stats.hitRange ?? this.stats.attackRange + 0.45;
          if (w.playerAlive && distP <= hitRange && a < 1.2 && this.reachY(w, 0.15) && w.los(this.x, this.z, w.px, w.pz, this.y, w.py)) out.attackHit = true;
        }
        if (this.stateT <= 0) { this.setState('chase'); this.repathT = 0; this.attackCd = this.stats.attackCooldown ?? 0.45; } // lane SIREN: per-stats cooldown (default unchanged)
        break;
      }
      case 'stagger': {
        this.stateT -= dt;
        out.anim = 'Hit';
        if (this.stateT <= 0) { this.setState('chase'); this.repathT = 0; }
        break;
      }
      case 'investigate': {
        // Iteration 12 (AI): slow walk to a seen light; the player in sight always wins.
        if (sees) { this.setState('chase'); this.repathT = 0; break; }
        this.investigate(dt, w, out, moved);
        break;
      }
      case 'patrol': {
        // Task track3-eaton-centre-20261031 (lane HORDE): walking in the group's formation; the player in sight always wins.
        if (sees) { this.setState('chase'); this.repathT = 0; break; }
        if (!this.escort) { this.setState('idle', 1); break; } // left its group: an ordinary enemy from now on
        if (this.unseenT > 20) this.aware = false;
        out.anim = 'Idle';
        this.escort.steer(this, out, dt, w, moved);
        break;
      }
      case 'climb': {
        const c = this.climb;
        if (!c) { this.setState('chase'); break; }
        c.t += dt;
        sampleClimb(c.path, c.t, this.tmp);
        this.x = this.tmp.x; this.y = this.tmp.y; this.z = this.tmp.z;
        out.face = c.yaw;
        out.anim = 'Walk';
        if (c.t >= climbDuration(c.path)) {
          const end = c.path.pts[c.path.pts.length - 1];
          this.x = end.x; this.y = end.y; this.z = end.z;
          if (this.path.length && this.path[0][2] === c.ladder) this.path.shift();
          this.climb = null;
          const resume = c.resume === 'wander' || c.resume === 'search' || (c.resume === 'investigate' && this.lure) ? c.resume : 'chase';
          this.setState(resume, resume === 'chase' ? 0 : Math.max(2, c.resumeT));
          this.repathT = 0;
        }
        break;
      }
    }
  }

  /** Iteration 12 (AI): a light was seen — start investigating it, or refresh / re-acquire the one being investigated. */
  private noticeLight(w: BrainWorld, s: LureSighting): void {
    const g = w.lureGoal?.(s.x, s.y, s.z) ?? [s.x, s.z, this.y];
    const L = this.lure;
    if (this.state !== 'investigate' || !L) {
      this.lure = {lightId: s.light.id, kind: s.light.kind, part: s.part, x: s.x, y: s.y, z: s.z, gx: g[0], gz: g[1], gy: g[2],
        seenT: this.t, startT: this.t, phase: 'approach', lingerT: 0, stop: LURE.arrive + this.lureRnd() * LURE.arriveJitter,
        pathGoal: null, repathT: 0, stuckT: 0, stucks: 0};
      this.path = [];
      this.setState('investigate');
      this.lureStarts++;
      return;
    }
    L.lightId = s.light.id; L.kind = s.light.kind; L.part = s.part;
    L.x = s.x; L.y = s.y; L.z = s.z; L.gx = g[0]; L.gz = g[1]; L.gy = g[2];
    L.seenT = this.t;
    if (L.phase === 'linger') { L.phase = 'approach'; L.stucks = 0; } // re-acquired
  }

  /**
   * Iteration 12 (AI): the 'investigate' state body. approach: walk (wander speed x LURE.speedMult) to the goal near the
   * last seen light point; hold: stand facing a light that is still visible; linger: the light went out / was lost
   * (out of sight LURE.lostGrace s once at the spot or with no way there, or the LURE.pursueAfterLoss safety cap) —
   * wait, then wander again.
   */
  private investigate(dt: number, w: BrainWorld, out: BrainOutput, moved: number): void {
    const L = this.lure;
    if (!L) { this.setState('idle', 1); return; }
    const lost = this.t - L.seenT;
    const near = Math.hypot(L.x - this.x, L.z - this.z) <= L.stop && Math.abs(L.gy - this.y) < 1.2;
    if (L.phase !== 'linger') {
      // lost: at the spot, or no way there (stuck / no path, LURE.stuckGiveUp times), or the safety cap; a light still in view
      // that cannot be reached keeps it standing and staring
      if (lost > LURE.pursueAfterLoss || (lost > LURE.lostGrace && (near || L.stucks >= LURE.stuckGiveUp))) {
        L.phase = 'linger';
        L.lingerT = LURE.linger + this.lureRnd() * LURE.lingerJitter;
      } else L.phase = near ? 'hold' : 'approach';
    }
    const faceLight = () => { out.face = Math.atan2(L.x - this.x, L.z - this.z); out.anim = 'Idle'; out.speed = 0; out.dirX = out.dirZ = 0; };
    if (L.phase === 'approach') {
      L.repathT -= dt;
      const goalMoved = L.pathGoal ? Math.hypot(L.pathGoal[0] - L.gx, L.pathGoal[1] - L.gz) : Infinity;
      if (L.repathT <= 0 && this.pathFailT <= 0 && (!this.path.length || goalMoved > LURE.repathMove)) {
        L.repathT = LURE.repathMin;
        const path = w.findPath(this.x, this.z, L.gx, L.gz, {drops: true, ay: this.y, by: L.gy});
        this.path = path ?? [];
        L.pathGoal = [L.gx, L.gz];
        if (!path) { this.pathFailT = 1.5 + this.lureRnd(); L.stucks++; }
      }
      const done = this.followPath(w, out, this.stats.wanderSpeed * LURE.speedMult);
      out.anim = 'Walk';
      if (out.speed > 0 && moved < 0.002) L.stuckT += dt; else L.stuckT = 0;
      if (L.stuckT > LURE.stuckTime) { L.stuckT = 0; L.stucks++; this.path = []; L.repathT = 0; }
      // nothing to walk (path ran out short of the light, unreachable, or waiting to re-plan): stand and look at it
      if (done) faceLight();
      return;
    }
    faceLight();
    if (L.phase === 'linger') {
      L.lingerT -= dt;
      if (L.lingerT <= 0) {
        this.setState('idle', 1 + this.lureRnd() * 2);
        if (this.unseenT > 20) this.aware = false;
      }
    }
  }

  /** Start / goal heights for a path request (the goal's storey when known; else the zombie's own). */
  private pathOpts(goalY: number | undefined): {ay: number; by: number} {
    return {ay: this.y, by: goalY ?? this.y};
  }

  /**
   * A LOCAL path request (a wander / search target a few metres away). Task track3-eaton-centre-20261031 (lane HORDE, atrium AI):
   * in an open-atrium level it is marked `local` (the game bounds its search: ATRIUM_CHASE.localExpand — a few-metre target whose
   * route needs more is a detour round a wall / the void: the enemy just picks another spot later). Elsewhere: pathOpts unchanged.
   */
  private localOpts(w: BrainWorld, goalY: number | undefined): {ay: number; by: number; local?: true} {
    return w.atrium === true ? {...this.pathOpts(goalY), local: true} : this.pathOpts(goalY);
  }

  /**
   * The path to a LOCAL target p (wander / search spot). Lane HORDE (atrium AI, w.atrium only): a target the body can walk to in a
   * straight line needs no search (one height-aware walk test instead of an A* + string pulling); otherwise the bounded local
   * search. Elsewhere: exactly the established findPath call.
   */
  private localPath(w: BrainWorld, p: [number, number] | [number, number, number]): Waypoint[] | null | undefined {
    if (w.atrium === true && w.walkClear(this.x, this.z, p[0], p[1], this.stats.radius * 0.9, this.y, p[2] ?? this.y)) return [[p[0], p[1], undefined, p[2] ?? this.y]];
    return w.findPath(this.x, this.z, p[0], p[1], this.localOpts(w, p[2]));
  }

  /** Player within swiping reach vertically (feet heights). */
  private reachY(w: BrainWorld, slack = 0): boolean {
    return w.py === undefined || Math.abs(w.py - this.y) <= ATTACK_REACH_Y + slack;
  }
}
