// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE; user: carry REAL dead undead bodies one at a time onto the train and feed
// them into the woodchipper as emergency fuel): the CORPSE SYSTEM (Game.corpses, corpse/api.ts CorpseSystemApi) — which dead bodies can be
// carried, picking one up, carrying it, putting it down / handing it to a sink (the chipper), and where a handled body lives between worlds.
//
// ELIGIBLE: an actor of Game.zombies that is dead, has a layout identity (Game.enemyIndex: only layout spawns — a QA-spawned enemy never
// counts) and whose archetype's corpse trait is feedable (ai/corpseTrait.ts: zombie / Blightbelly / Siren / Strainer yes, the rat-dog no).
// Its identity: bodyId(sectionId(section), index). The actor ITSELF is the body (ragdoll parts / torn pieces are never separate bodies).
// An untouched corpse keeps today's behaviour (not saved; its enemy stays dead); only a body picked up at least once is ever a record.
//
// PICKUP (E aimed at the body within CORPSE.reach, hands free: no other input owner, flare hold, climb, car, retch): the SAME actor leaves
// the floor — out of Game.zombies / enemyIndex (its index goes into the section's killed list at once), out of physics (its ragdoll frozen
// and forgotten), out of the station's damage bookkeeping (its wound materials go with the actor) — mixer stopped (beginRagdoll), and is
// posed in the fixed carry pose (corpse/bodyPose.ts) over the right shoulder on a carry frame under the camera (follows the eye, half the
// view's pitch), never frustum-culled (its skinned bounds would not follow) and casting no flashlight shadow. An item use in progress is
// cancelled (nothing consumed). It is in no hit list while carried (bullets / blasts never reach it).
// CARRY: one body; the hands are busy — an input owner (no fire, ADS, flare, item start; a melee windup is cancelled by the lane-ownership
// path: Game.update `lowered`), the held item lowered (Game reads `holster`), startUse / the fuel pour refuse (refuseUse / held()), E is
// only the body's; slower by the body's mass (a ModifierSource; a sprint is a heavy jog). A still-held left button never fires after the
// body leaves the hands (Game's laneOwnedLast latch).
// E WHILE CARRYING: each registered sink (addSink, in order) is offered the body — an ok offer's E hands it over (take() true: the sink
// owns record + object from that call on); a refusal is shown and keeps it. Otherwise E lets it go (refused while the train moves).
// A body lying there is a corpse for shots and swings (hitTargets: blood, and its wounds while it is still the actor that died here); never
// a collider, like any corpse.
// THE DROP (task studio-refinement-batch-20261113-035659-01, lane DROPS; user: "Carried bodies: set down/drop freely as physical ragdolls
// that fall naturally amid clutter, rather than requiring a clear area"): with the game's physics world up (every built station), E lets
// the body go as a RAGDOLL (physics/world.ts PhysicsSystem.ragdoll: the same parts / joints / limits as any corpse, colliding with the
// floors, walls, stairs, props, loose props and the parked car's floor) from its carried pose, moved a little in front of the player —
// pulled back toward the player while the way from the chest to any part of it is blocked (never inside or beyond a wall / prop / the car's
// shell), with the player's own velocity, a small push and a roll off the shoulder (CORPSE.push / roll: dropped straight down it could
// balance folded on head and feet). No clear-area refusal: it falls on whatever is there. The refusals left are about integrity: riding,
// a lift cab (it moves), the count caps (train / station, decided at the release point) and — at the departure — a body across the
// doorway or still falling. While it falls it is in `lying` (a target, aimed / picked up as any; its centre follows the pelvis); once
// physics stops simulating it (calm, the 8 s cap; one stopped in mid-air by a newer ragdoll falls on at its velocity, CORPSE.restarts) it
// leaves the physics, is lifted out of the floor by its deepest skinned point (CORPSE.lift: the ragdoll's spheres are slimmer than the
// skin) and its ACTUAL pose is recorded ('fallen': the bones' local rotations + the pelvis, the root moved under the pelvis with the world
// pose kept); ownership follows the settled pelvis by the rule below. A save / teardown / departure while it still falls records its pose
// at that instant marked `falling` with its pelvis velocity (a teardown / departure stops its ragdoll there): rebuilt, it falls on from
// that pose at that velocity. Without a physics world
// (Node hosts without one, a rig the ragdoll refuses) the old posed drop remains: the 'lying' pose (its Death clip's end frame, its lowest
// vertex exactly on the floor) on a free, level floor spot in front of the player.
// The one other E use while carrying is the train's driving console (aimed: its map / a journey with the body in the hands).
//
// OWNERSHIP (one body, one place; every move is one synchronous call):
//  - hands: run participant 'corpse-carry' (corpse/bodyLanes.ts): saved / loaded / Retry / NewGame; the object survives teardowns (it
//    rides under the camera through a journey's transit gap);
//  - station: a body lying in the world whose centre (pelvis) is outside the parked car belongs to the station — lane 'corpses.here'
//    (world pose + storey), rewritten on every pickup / drop and at teardown, rebuilt on every build of that station;
//  - train: a body lying in the PARKED car (centre inside, world/trainCargo.ts's rule) is train cargo (run/trainCargo.ts v3 `bodies`, via
//    TrainCargo.liveBodies). Ride start (doors closing / departing, the props' moment): the car's bodies move onto the car's view root at
//    their train-local poses; the stop: back in the parked car (the next station's). A teardown without a ride: pending records, rebuilt in
//    the next parked car. A body straddling the car's wall line or more than BODIES.maxAboard aboard refuses the departure (departBlock).
//  - models: buildBody(rec) rebuilds a body exactly like Game.spawnEnemy (Game.buildEnemyActor: archetype actor + chooseSpawnLook(seed,
//    index, type / look), its own rand stream — never the game's) at its recorded size; a rebuilt body has no old wounds. The lazy models of
//    every record (hands, train, station lane, the chipper's job, a Retry snapshot's, a decoded save's) are section model keys (prepare).
// Held, aboard and in-hopper bodies never despawn (nothing here removes a body except a sink's take or a teardown into records).

import * as THREE from 'three';
import {archetypeOf, type EnemyActor} from '../ai/creatureArchetypes';
import {CORPSE_TRAITS, corpseCarriable} from '../ai/corpseTrait'; // (task studio-corpse-market-shop-20261114-031614-01: every undead body is carriable — BB's too; the chipper keeps its own feedable check)
import {enemyModelKeysFor} from '../ai/enemyModels';
import {cosplayModelKeysFor, lingerieModelKeysFor} from '../ai/spawnLook';
import {BODIES, bodyId, copyBody, type BodyRecordJSON} from '../corpse/bodyRecord';
import {CORPSE_CARRY_PARTICIPANT, STATION_BODIES_LANE, carriedBodyOf, heldRecord, stationBodiesOf, type CorpseCarryJSON} from '../corpse/bodyLanes';
import type {BodyOffer, BodySink, CorpseSystemApi, HeldBody} from '../corpse/api';
import {boneInRoot, bodyPoints, poseCarry, poseFallen, poseLying, readFallen, restingLift} from '../corpse/bodyPose';
import {corpseVolumes, type DamageZombie} from '../damage/system';
import type {RagdollTarget} from '../physics/ragdoll';
import {raySphere, rayCapsule} from '../combat/hitscan';
import {hashString, mulberry32} from '../core/rng';
import {trainToWorld, worldToTrain, type TrainPlacement} from '../gen/playerTrain';
import type {StationLayout, ZombieSpawn} from '../gen/stationTypes';
import type {PropPlacement} from '../gen/props';
import {sectionId, type SectionKey} from '../levels/types';
import {cargoBodiesOf} from '../run/trainCargo';
import {mergeKilled} from '../run/memory';
import type {RunParticipant} from '../run/snapshot';
import {SPRINT_SPEED, WALK_SPEED} from '../player/player';
import type {PlayerTrainSpec} from './playerTrainSpec';

/** Tuning (one place). */
export const CORPSE = {
  /** Pickup reach from the eye (m). */
  reach: 2.4,
  /** The pelvis on the right shoulder, in the carry frame (camera space: +x right, +y up, -z forward; m). */
  anchor: {x: 0.26, y: -0.27, z: -0.2},
  /** Extra height of the anchor per unit of torso girth above 1 (a fat body's belly rests on the shoulder, m). */
  girthLift: 0.12,
  /** Share of the view's pitch the carried body follows (0 = the shoulders' yaw only, 1 = locked to the view). */
  pitchFollow: 0.5,
  /** Walk speed factor = 1 - massKg / massDiv, clamped to [slowMin, slowMax]; a sprint becomes a heavy jog (sprintJog x walk). */
  massDiv: 350, slowMin: 0.55, slowMax: 0.9, sprintJog: 1.25,
  /** The held item lowers / comes back over this (s). */
  holsterS: 0.25,
  /** Drop: the body's centre this far in front of the player (m, tried in order), across the view first, then along it. */
  dropAt: [0.95, 1.2, 0.75, 1.45],
  /** A drop spot's floor: within this of the player's floor (m: level floor only); body points keep this from walls / props (m). */
  floorTol: 0.06, clear: 0.1,
  /** Another lying body's points nearer than this to a new one's refuse the spot (m: bodies never interpenetrate). */
  apart: 0.28,
  /** A lying body's point this far past the car's wall line counts as outside / inside (m; resting against a wall is not straddling). */
  wallTol: 0.06,
  /**
   * Lane DROPS (the ragdoll drop): the carried pose moves this far along the view's heading (m, tried in order, down to behind the
   * shoulder: the pull-back) and across it (m, + right: the shoulder's pelvis comes in front of the player first); the first release whose
   * every part is in free space in sight of the chest (`chestY` above the feet) with `partClear` m to spare wins.
   */
  release: [0.55, 0.4, 0.25, 0.1, 0, -0.15, -0.3], across: [-0.2, 0, -0.4], chestY: 1.2, partClear: 0.06,
  /**
   * The push the body leaves the shoulder with (m/s along the view's heading, on top of the player's own velocity) and the roll (rad/s)
   * about its length (the carried root's Z, head to feet; the same frame when it falls on after a stop): dropped straight down from the
   * carry pose a ragdoll lands on head and feet and can balance there folded, pelvis up; rolling, it lands on a side.
   */
  push: 0.7, roll: 3,
  /**
   * A ragdoll that stops while its pelvis still moved faster than `stillV` (m/s: retired in mid-air by a newer ragdoll, not at rest) falls
   * on from there at the velocity it had, at most `restarts` times; then it stays as it is.
   */
  stillV: 0.35, restarts: 2,
  /** Let go this close to the parked car (m, its interior box padded: departBlock's box), a body may come to rest in it or out of it. */
  nearCar: 3,
  /**
   * At rest, the body is lifted by its deepest skinned point's sink into the floor under it (m, at most `lift`; every `liftStride`-th
   * vertex): the ragdoll's spheres are slimmer than the skin (a Blightbelly's belly, a coat), which would sink into the floor. The lying
   * pose's rule (corpse/bodyPose.ts restingLift): never sunk. Floors only, level `liftFlat` m round the point (a prop's top or side, a
   * stair riser cannot be told apart from one point: skin against a crate or a wall may touch a few cm into it, as every ragdoll's does).
   */
  lift: 0.15, liftStride: 3, liftFlat: 0.06,
} as const;

export const CORPSE_TEXT = {
  pickup: '<b>[E]</b> Pick up the body',
  drop: '<b>[E]</b> Put the body down',
  riding: 'Hold on to the body — the train is moving',
  notReady: 'The body is not ready yet',
  noRoom: 'No room to put the body down here — face open, level floor',
  elevator: 'Not inside the elevator — put the body down on a floor',
  handsFull: 'Your hands are full — put the body down first',
  stationFull: `No more room for bodies here (at most ${BODIES.stationHere} in one station)`,
  trainFull: `The train holds at most ${BODIES.maxAboard} bodies — put this one down outside`,
  doorway: 'A body is lying in the train doorway — move it fully inside or out onto the platform',
  noSpace: 'No space to let the body go here — step back from the wall', // (lane DROPS: even the pulled-back release would start in a wall)
  settling: 'A body is still falling — wait a moment', // (lane DROPS: the departure waits for a body falling at the car)
  overloaded: (n: number) => `The train is overloaded — ${n} bodies lie in it, at most ${BODIES.maxAboard} can travel. Carry ${n - BODIES.maxAboard} out first`,
} as const;

type Phase = 'prepare' | 'build';
type V3 = {x: number; y: number; z: number};
const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), QY = new THREE.Quaternion(), S = new THREE.Vector3(), EYE = new THREE.Vector3(), DIR = new THREE.Vector3();
const C = new THREE.Vector3(), M1 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), E1 = new THREE.Euler(); // (lane DROPS)
const r5 = (v: number) => (Math.round(v * 1e5) / 1e5) || 0;
/** Layout key of the body model keys computed by the layout hook (a symbol: copied by `{...layout}` spreads, never serialized). */
const KEYS = Symbol('corpse-model-keys');

/** A canonical unit quaternion (w >= 0, rounded: a record round-trips exactly). */
function quat(q: THREE.Quaternion): [number, number, number, number] {
  const n = q.clone().normalize();
  if (n.w < 0) n.set(-n.x, -n.y, -n.z, -n.w);
  const out: [number, number, number, number] = [r5(n.x), r5(n.y), r5(n.z), r5(n.w)];
  const len = Math.hypot(...out) || 1;
  return out.map(v => r5(v / len)) as [number, number, number, number];
}

/** Lane DROPS: a record's velocity turned about the vertical by `yaw` (the world <-> car frames; rounded like the record). */
function turnV(v: readonly number[], yaw: number): [number, number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [r5(c * v[0] + s * v[2]), r5(v[1]), r5(-s * v[0] + c * v[2])];
}

/** A handled body in the live world (or riding / in the hands). */
interface Body {
  rec: BodyRecordJSON;
  actor: EnemyActor;
  /** World positions of its bone points while lying (ownership / doorway / spacing); its centre = the pelvis. */
  points: THREE.Vector3[];
  centre: THREE.Vector3;
  /** Its meshes' frustumCulled / castShadow before the carry. */
  flags: {mesh: THREE.Mesh; culled: boolean; shadow: boolean}[] | null;
  /**
   * Lane DROPS: the ragdoll target this body was handed to the game's physics as (simulating while `falling`; at rest it leaves the
   * physics), its pelvis velocity / speed (m/s) and last position while it falls, and how often it fell on after a mid-air stop.
   */
  rag?: RagdollTarget | null;
  falling?: boolean;
  vel?: THREE.Vector3;
  v?: number;
  last?: THREE.Vector3 | null;
  restarts?: number;
}

type Aimed = {kind: 'actor'; z: EnemyActor; index: number; t: number} | {kind: 'body'; b: Body; list: Body[]; t: number};

interface LevelsLike {
  supportIn(x: number, z: number, y: number, tol?: number): {level: number; floor: number; cell: number; volume?: unknown} | null;
  circleClear(x: number, z: number, r: number, feet: number): boolean;
  lineOfSight(a: V3, b: V3, opts?: {sightProps?: boolean; slack?: number}): boolean;
  raycast(o: V3, d: V3, max: number, opts?: {props?: readonly PropPlacement[]}): {kind: string; t: number};
  grid(level: number): {rampIdx: ArrayLike<number>};
}

/** What the system needs of Game (structural: the Node tests drive it with stand-ins and the real train runtime / ride). */
export interface CorpseHost {
  scene: THREE.Object3D;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; yaw: number; pitch: number; alive: boolean; climbing: boolean; sprinting: boolean; vx?: number; vz?: number};
  levels: LevelsLike | null;
  propIndex?: {near(x0: number, z0: number, x1: number, z1: number, out: Set<number>): Set<number>; props: readonly PropPlacement[]} | null;
  layout: StationLayout | null;
  run: {
    current: SectionKey;
    memory(key?: SectionKey): {killed: number[]};
    laneStore<T = unknown>(lane: string, key?: SectionKey): T | undefined;
    setLaneStore(lane: string, data: unknown, key?: SectionKey): void;
    entry?: {lanes: Record<string, unknown>; memories: Record<string, {lanes?: Record<string, unknown>}>} | null;
  };
  zombies: EnemyActor[];
  readonly seed: number;
  state: string;
  /**
   * Lane DROPS: + the ragdoll drop — PhysicsSystem.ragdoll (a body from its current pose), its world (built: a station's), and actorVelocity
   * (true only while a target's ragdoll SIMULATES: false = frozen / retired / gone — how a drop sees its body come to rest).
   */
  physics?: {forgetRagdoll?(target: object): boolean; ragdoll?(target: RagdollTarget, impulse: null): boolean; world?: unknown;
    actorVelocity?(target: object, point: THREE.Vector3, out: THREE.Vector3): boolean; statics?: {cellGround(x: number, z: number, y?: number): number} | null} | null;
  damage?: {releaseZombie?(z: object): boolean} | null;
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void} | null;
  trainRuntime?: {spec: PlayerTrainSpec; view: {root: THREE.Object3D} | null; train: {placement: TrainPlacement} | null; consoleAimed?: boolean; saveAimed?: boolean} | null;
  trainRide?: {riding: boolean; phase: string} | null;
  playerTrain: {cargo: {liveBodies: {bodies(): BodyRecordJSON[]; restoreBodies(b: BodyRecordJSON[]): void} | null}; chipper?: {state: {job: {body: BodyRecordJSON} | null}}};
  hud: {toast(text: string, warn?: boolean): void};
  sfx?: {denied?(): void; bodyFall?(x: number, y: number, z: number, strength: number): void} | null;
  aimOffset?: {pitch: number};
  flareHold?: {active: boolean};
  skywaysCar?: {driving?: boolean} | null;
  vomit?: {active?: boolean} | null;
  interactHandlers: (() => boolean)[];
  promptProviders: (() => string | null)[];
  inputOwners: (() => boolean)[];
  modifierSources: (() => {speedMult?: number})[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  sectionLayoutHooks: ((layout: StationLayout, key: SectionKey, run: unknown, phase: Phase) => void)[];
  sectionModelKeys: ((layout: StationLayout) => readonly string[])[];
  runParticipants: RunParticipant[];
  /** Game.buildEnemyActor: spawnEnemy's actor build (look + lazy models), unregistered. */
  buildEnemyActor?(s: ZombieSpawn, i: number, seed: number, rand: () => number): {actor: EnemyActor; fallback: boolean};
}

/** Game's private seams the install hands over (game.ts installs with one line). */
export interface CorpseDeps {
  /** The layout index of a live enemy (Game.enemyIndex; undefined: not a layout spawn — QA). */
  enemyIndex(z: EnemyActor): number | undefined;
  /** The actor left the world's enemies (Game.enemyIndex entry dropped). */
  forgetEnemy?(z: EnemyActor): void;
  /** Cancel a timed item use in progress (Game.cancelUse: nothing consumed). */
  cancelUse?(reason: string): void;
  /** The aimed floor pickup / holder this frame (Game.currentTarget / containerTarget): a closer one wins the E press. */
  targets?(): {pickup?: V3 | null; container?: {container: {min: V3; max: V3}} | null};
}

export class CorpseSystem implements CorpseSystemApi {
  /** The body in the hands (its object on the carry frame), or its record while no world could build it. */
  private hand: Body | null = null;
  private handRec: BodyRecordJSON | null = null;
  /** Handled bodies lying in the live world (the station's or — inside the parked car — the train's). */
  readonly lying: Body[] = [];
  /** The train's bodies on the car's view root (a ride's start .. its stop). */
  readonly riding: Body[] = [];
  /** The train's bodies waiting for a world with the car (a teardown without a ride, a load). */
  pending: BodyRecordJSON[] = [];
  /** Station records of the live world no model could be built for (kept in its lane as they were). */
  private deferred: BodyRecordJSON[] = [];
  private captured = false;
  private retryT = 0;
  private here: {key: SectionKey; layout: StationLayout} | null = null;
  private readonly sinks: BodySink[] = [];
  /** The carry frame: a child of the camera (follows the eye through every frame, the transit gap included). */
  readonly carry = new THREE.Group();
  /** The held item's lowering (0..1; Game.update lowers the viewmodel by it). */
  holster = 0;
  private readonly actors = new WeakMap<THREE.Object3D, EnemyActor>();
  private readonly prepared = new WeakMap<object, BodyRecordJSON[]>();
  private readonly owner = () => !!(this.hand || this.handRec);
  /** QA / tests. */
  readonly counts = {pickups: 0, drops: 0, sunk: 0, refused: 0, built: 0, failed: 0, captured: 0, released: 0, flushes: 0, blocked: 0,
    ragdolls: 0, landed: 0, restarts: 0, stopped: 0, resumed: 0, unsupported: 0}; // (lane DROPS: ragdoll drops started, come to rest, fell on, stopped mid-fall, resumed; refinement batch: fell again when the support under them melted)

  constructor(readonly host: CorpseHost, private readonly deps: CorpseDeps) {
    this.carry.name = 'corpse-carry';
  }

  install(): this {
    const h = this.host;
    h.camera.add(this.carry);
    // E / prompt WHILE CARRYING go first (unshift: E is only the body's then); the pickup's after every lane's (an aimed door / box wins)
    h.interactHandlers.unshift(() => this.onCarryInteract());
    h.promptProviders.unshift(() => this.carryPrompt());
    h.interactHandlers.push(() => this.onPickupInteract());
    h.promptProviders.push(() => this.pickupPrompt());
    h.inputOwners.push(this.owner);
    h.modifierSources.push(() => this.modifier());
    h.frameHooks.push(dt => this.frame(dt));
    h.sectionLayoutHooks.push((layout, key, run, phase) => this.onLayout(layout, key, run as CorpseHost['run'], phase));
    h.sectionModelKeys.push(layout => (layout as unknown as Record<symbol, readonly string[] | undefined>)[KEYS] ?? []);
    // teardown FIRST (before the section memory / other lanes save the section), build LAST (after the train's floor colliders)
    h.sectionHooks.unshift({teardown: () => this.onTeardown()});
    h.sectionHooks.push({build: () => this.onBuild()});
    h.playerTrain.cargo.liveBodies = {bodies: () => this.trainBodies(), restoreBodies: b => this.restoreBodies(b)};
    if (!h.runParticipants.some(p => p.id === CORPSE_CARRY_PARTICIPANT)) h.runParticipants.push(this.participant());
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The public seams (corpse/api.ts)

  held(): HeldBody | null {
    const b = this.hand;
    return b ? {record: heldRecord(b.rec), object: b.actor.root} : null;
  }

  /** The hands carry a body (also one whose model is not built yet). */
  get carrying(): boolean { return this.owner(); }

  addSink(s: BodySink): void {
    if (!this.sinks.includes(s)) this.sinks.push(s);
  }

  buildBody(rec: BodyRecordJSON): THREE.Object3D | null {
    return this.makeBody(rec)?.actor.root ?? null;
  }

  disposeBody(obj: THREE.Object3D): void {
    const a = this.actors.get(obj);
    obj.removeFromParent();
    if (!a) return;
    this.actors.delete(obj);
    a.dispose();
  }

  ragdollTarget(obj: THREE.Object3D): RagdollTarget | null {
    return this.actors.get(obj) ?? null;
  }

  /**
   * The handled bodies a bullet / melee swing can hit now — every body LYING in the live world (the station's and the parked car's;
   * never the hands, the riding car or the hopper), as corpses (Game.fire / meleeContact: DamageSystem.corpseHit next to Game.zombies'
   * corpses). The original actor keeps its wound controller (its wounds, tears); a rebuilt body has none (blood and flesh bits only:
   * no new materials). One reused array (no allocation per shot); bounded by the bodies lying there.
   */
  hitTargets(): readonly EnemyActor[] {
    const out = this.targetBuf;
    out.length = 0;
    for (const b of this.lying) out.push(b.actor);
    return out;
  }
  private readonly targetBuf: EnemyActor[] = [];

  /** Game.startUse: no item use while the hands carry a body (true = refused, with the note). */
  refuseUse(): boolean {
    if (!this.owner()) return false;
    this.host.hud.toast(CORPSE_TEXT.handsFull, true);
    this.host.sfx?.denied?.();
    this.counts.refused++;
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Bodies: build / dispose

  /** The real model of a record (Game.buildEnemyActor with its own stream; null: its archetype's model is not loaded). Lying, at rest. */
  private makeBody(rec: BodyRecordJSON): Body | null {
    const h = this.host;
    if (!h.buildEnemyActor || !corpseCarriable(rec.arch)) return null;
    const index = Number(rec.id.slice(rec.id.lastIndexOf('#') + 1));
    const spawn: ZombieSpawn = {x: 0, z: 0, yaw: 0, type: rec.type, area: 0, ...(rec.arch !== 'zombie' ? {archetype: rec.arch} : {}), ...(rec.look ? {look: rec.look} : {}), ...(rec.variant !== undefined ? {variant: rec.variant} : {})};
    let built: {actor: EnemyActor; fallback: boolean};
    try { built = h.buildEnemyActor(spawn, index, rec.seed >>> 0, mulberry32((hashString(rec.id) ^ rec.seed) >>> 0)); } catch (err) { console.warn('corpses: a body could not be built', rec.id, err); this.counts.failed++; return null; }
    const a = built.actor;
    if (built.fallback || archetypeOf(a) !== rec.arch) { a.dispose(); this.counts.failed++; return null; } // (never another body standing in)
    a.beginRagdoll(); // the mixer stops; animate / syncTransform leave the bones alone
    a.brain.damage(1e9, rec.x, rec.z); // (a corpse's brain: dead — a hit target like any corpse, never an enemy; it is in no AI list)
    const s = rec.scale ?? a.scale;
    a.root.scale.setScalar(s);
    (a as unknown as {scale: number}).scale = s;
    if (rec.pose === 'fallen' && rec.bones) poseFallen(a, rec.bones, rec.hips); // (lane DROPS: exactly as it fell)
    else poseLying(a);
    a.root.position.set(rec.x, rec.y, rec.z);
    a.root.quaternion.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize();
    a.root.updateMatrixWorld(true);
    this.actors.set(a.root, a);
    this.counts.built++;
    return {rec: copyBody(rec), actor: a, points: [], centre: new THREE.Vector3(), flags: null};
  }

  private dispose(b: Body): void {
    this.leavePhysics(b);
    this.restoreFlags(b);
    this.disposeBody(b.actor.root);
  }

  /** Lane DROPS: the body's ragdoll (simulating or one of the frozen corpses) leaves the game's physics; its bones keep the pose now. */
  private leavePhysics(b: Body): void {
    // (forgetRagdoll freezes a simulating one first: its bones keep the physics' latest step)
    if (b.rag) this.host.physics?.forgetRagdoll?.(b.rag);
    b.rag = null;
    b.falling = false;
  }

  /** A lying body's points / centre / cull bounds / shadows after a (re)pose. */
  private settle(b: Body): void {
    const root = b.actor.root;
    root.updateMatrixWorld(true);
    b.points = bodyPoints(root);
    const hips = root.getObjectByName('Hips');
    if (hips) hips.getWorldPosition(b.centre); else root.getWorldPosition(b.centre);
    // the skinned bounds round the pelvis (the actors' own spheres were sized for a body standing at its root)
    b.actor.setCullSphere(b.centre, 1.6 * (b.rec.scale ?? b.actor.scale));
    const br = b.actor.brain as {x: number; z: number; y?: number};
    br.x = b.centre.x; br.z = b.centre.z; // (cheap distance tests follow the body)
  }

  private keepFlags(b: Body): void {
    if (b.flags) return;
    b.flags = [];
    b.actor.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      b.flags!.push({mesh: m, culled: m.frustumCulled, shadow: m.castShadow});
      m.frustumCulled = false; // (carried: its skinned bounds would not follow the carry pose)
      m.castShadow = false; // (at the shoulder it would black out the flashlight beam)
    });
  }

  private restoreFlags(b: Body): void {
    for (const f of b.flags ?? []) { f.mesh.frustumCulled = f.culled; f.mesh.castShadow = f.shadow; }
    b.flags = null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Eligibility + aim

  /** A live actor's body can be carried: dead, a layout spawn (identity), a carriable (undead) archetype. */
  eligible(z: EnemyActor): boolean {
    return !z.brain.alive && this.deps.enemyIndex(z) !== undefined && corpseCarriable(archetypeOf(z));
  }

  /** The nearest bone-volume hit of the camera ray on a body (Infinity: none). */
  private rayBody(a: EnemyActor, o: V3, d: V3): number {
    let best = Infinity;
    for (const v of corpseVolumes(a as unknown as DamageZombie)) best = Math.min(best, v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r));
    return best;
  }

  /** The body under the crosshair within reach (nothing nearer in the way; a nearer aimed item / holder wins), or null. */
  aimed(): Aimed | null {
    const h = this.host, cam = h.camera;
    if (!h.levels && !h.trainRide?.riding) return null;
    cam.updateWorldMatrix(true, false);
    cam.getWorldPosition(EYE);
    cam.getWorldDirection(DIR);
    const o = {x: EYE.x, y: EYE.y, z: EYE.z}, d = {x: DIR.x, y: DIR.y, z: DIR.z}, R = CORPSE.reach, near = (R + 2.2) ** 2;
    const riding = !!h.trainRide?.riding;
    let best: Aimed | null = null;
    if (!riding) {
      for (const z of h.zombies) {
        if (z.brain.alive || (z.brain.x - o.x) ** 2 + (z.brain.z - o.z) ** 2 > near) continue;
        const index = this.deps.enemyIndex(z);
        if (index === undefined || !corpseCarriable(archetypeOf(z))) continue;
        const t = this.rayBody(z, o, d);
        if (t < (best?.t ?? R)) best = {kind: 'actor', z, index, t};
      }
    }
    const list = riding ? this.riding : this.lying;
    for (const b of list) {
      b.actor.root.getWorldPosition(V); // (a riding body moves with the car)
      if ((V.x - o.x) ** 2 + (V.z - o.z) ** 2 > near) continue;
      const t = this.rayBody(b.actor, o, d);
      if (t < (best?.t ?? R)) best = {kind: 'body', b, list, t};
    }
    if (!best) return null;
    if (!riding && h.levels) { // (riding: the station's geometry is not the car's)
      const hit = h.levels.raycast(o, d, best.t, {props: h.layout?.props ?? []});
      if (hit.kind !== 'none' && hit.t < best.t - 0.03) return null;
    }
    const tg = this.deps.targets?.();
    if (tg?.pickup && Math.hypot(tg.pickup.x - o.x, tg.pickup.y - o.y, tg.pickup.z - o.z) < best.t) return null;
    const c = tg?.container?.container;
    if (c) {
      const cx = Math.max(c.min.x, Math.min(o.x, c.max.x)), cy = Math.max(c.min.y, Math.min(o.y, c.max.y)), cz = Math.max(c.min.z, Math.min(o.z, c.max.z));
      if (Math.hypot(cx - o.x, cy - o.y, cz - o.z) < best.t) return null;
    }
    return best;
  }

  /** The hands are free for a pickup now (nothing else owns them). */
  private handsFree(): boolean {
    const h = this.host, p = h.player;
    if (this.owner() || h.state !== 'playing' || !p.alive || p.climbing) return false;
    if (h.flareHold?.active || h.skywaysCar?.driving || h.vomit?.active) return false;
    return !h.inputOwners.some(f => f !== this.owner && f());
  }

  private pickupPrompt(): string | null {
    return this.handsFree() && this.aimed() ? CORPSE_TEXT.pickup : null;
  }

  private onPickupInteract(): boolean {
    if (!this.handsFree()) return false;
    const a = this.aimed();
    if (!a) return false;
    if (a.kind === 'actor') this.pickUpActor(a.z, a.index);
    else {
      a.list.splice(a.list.indexOf(a.b), 1);
      this.toHands(a.b);
      if (a.list === this.lying) this.flush(); // (the station's lane follows the move at once)
    }
    return true;
  }

  /** Pick up an eligible dead actor of the live world (see the header). */
  pickUpActor(z: EnemyActor, index: number): boolean {
    const h = this.host;
    if (!this.eligible(z) || this.deps.enemyIndex(z) !== index || this.owner() || !this.here) return false;
    const key = this.here.key, spawn = h.layout?.zombies[index];
    const rec: BodyRecordJSON = {id: bodyId(sectionId(key), index), arch: archetypeOf(z), seed: h.seed >>> 0, type: spawn?.type ?? z.brain.type, pose: 'lying',
      x: 0, y: 0, z: 0, q: [0, 0, 0, 1], scale: r5(z.scale)};
    if (spawn?.look) rec.look = spawn.look;
    if (spawn?.variant !== undefined) rec.variant = spawn.variant; // (a family with several bodies: the Screacher's sc01..sc04)
    // the world forgets the enemy: no AI / hit list / identity; its kill is remembered now (never respawned, whatever happens to the body)
    const i = h.zombies.indexOf(z);
    if (i >= 0) h.zombies.splice(i, 1);
    this.deps.forgetEnemy?.(z);
    const mem = h.run.memory(key);
    mem.killed = mergeKilled(mem.killed, [index]);
    h.physics?.forgetRagdoll?.(z);
    h.damage?.releaseZombie?.(z);
    z.beginRagdoll();
    z.animate(1, 'Death', 0); // (ragdolled: only the hit flash fades out)
    this.actors.set(z.root, z);
    this.toHands({rec, actor: z, points: [], centre: new THREE.Vector3(), flags: null});
    return true;
  }

  /** A body into the hands: the carry pose on the carry frame, item use cancelled. */
  private toHands(b: Body): void {
    const h = this.host;
    this.leavePhysics(b); // (lane DROPS: a dropped body — falling or at rest — leaves its ragdoll behind)
    if (b.actor.root.parent !== this.carry) this.carry.add(b.actor.root);
    b.rec = heldRecord(b.rec);
    this.carryPose(b);
    this.keepFlags(b);
    this.hand = b;
    this.handRec = null;
    this.deps.cancelUse?.('carry');
    this.counts.pickups++;
    const p = h.player;
    h.sfx?.bodyFall?.(p.x, p.y + 1.2, p.z, 0.35);
  }

  /** The carry pose and the root placed so the pelvis sits at the shoulder anchor (in the carry frame). */
  private carryPose(b: Body): void {
    const a = b.actor, root = a.root, s = b.rec.scale ?? a.scale;
    poseCarry(a);
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.setScalar(s);
    const hips = boneInRoot(root, 'Hips', V) ?? V.set(0, 0.9, 0);
    const A = CORPSE.anchor, lift = CORPSE.girthLift * Math.max(0, (a.girth?.torso ?? 1) - 1);
    root.position.set(A.x - hips.x * s, A.y + lift - hips.y * s, A.z - hips.z * s);
    root.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Carrying: E, prompt, slow-down, the carry frame

  private offers(): {sink: BodySink; offer: BodyOffer} | null {
    const held = this.held();
    if (!held) return null;
    for (const sink of this.sinks) {
      let offer: BodyOffer | null = null;
      try { offer = sink.offer(held); } catch (err) { console.warn('corpses: a sink offer failed', err); }
      if (offer) return {sink, offer};
    }
    return null;
  }

  private carryPrompt(): string | null {
    if (!this.owner()) return null;
    if (!this.hand) return CORPSE_TEXT.notReady;
    const o = this.offers();
    if (o) return o.offer.text;
    if (this.host.trainRuntime?.consoleAimed || this.host.trainRuntime?.saveAimed) return null; // (the driving console's / the Save terminal's own prompt: a journey or a save with a body in the hands)
    return this.host.trainRide?.riding ? CORPSE_TEXT.riding : CORPSE_TEXT.drop;
  }

  /** E while carrying: always the body's (a sink takes it, a refusal keeps it, else it is laid down / the reason shown). */
  private onCarryInteract(): boolean {
    if (!this.owner()) return false;
    const h = this.host;
    if (h.state !== 'playing') return true;
    const b = this.hand;
    if (!b) { this.refuse(CORPSE_TEXT.notReady); return true; }
    const o = this.offers();
    if (o) {
      if (!o.offer.ok) { h.sfx?.denied?.(); this.counts.refused++; return true; }
      this.toSink(o.sink);
      return true;
    }
    // the other E uses while carrying: the train's driving console (its map / the journey) and its Save terminal (a manual save) — the body
    // stays in the hands (the carry participant saves it held)
    if (h.trainRuntime?.consoleAimed || h.trainRuntime?.saveAimed) return false;
    this.putDown();
    return true;
  }

  /**
   * Hand the body to `sink` (one call: true = the sink owns record + object now; the hands are free). The object is handed over as a
   * body at rest — the 'lying' pose (straight, head to feet: what buildBody gives a sink too), its meshes' own culling / shadow flags with
   * a cull sphere round the whole body (a sink moves only its root) — still under the carry frame: the sink re-parents it in take(). After
   * a true take() nothing here touches the object again (no frame update, re-parenting or disposal: the sink calls disposeBody).
   */
  private toSink(sink: BodySink): boolean {
    const b = this.hand;
    if (!b) return false;
    this.restoreFlags(b);
    poseLying(b.actor);
    const hips = b.actor.root.getObjectByName('Hips');
    if (hips) b.actor.setCullSphere(hips.getWorldPosition(V), 1.9 * (b.rec.scale ?? b.actor.scale));
    const held: HeldBody = {record: heldRecord(b.rec), object: b.actor.root};
    let took = false;
    try { took = sink.take(held); } catch (err) { console.warn('corpses: a sink take failed', err); }
    if (!took) { // (it stays in the hands, in the carry pose)
      if (this.hand === b) { this.carryPose(b); this.keepFlags(b); }
      this.host.sfx?.denied?.();
      this.counts.refused++;
      return false;
    }
    this.hand = null;
    this.handRec = null;
    this.counts.sunk++;
    return true;
  }

  private refuse(text: string): void {
    this.host.hud.toast(text, true);
    this.host.sfx?.denied?.();
    this.counts.refused++;
  }

  /**
   * Let the carried body go in front of the player, or say why not; true = done. Lane DROPS: with the game's physics world up, as a ragdoll
   * falling on whatever is there (dropRagdoll); without one, laid down in the 'lying' pose on a clear spot (layDown).
   */
  putDown(): boolean {
    const h = this.host, b = this.hand;
    if (!b) return false;
    if (h.trainRide?.riding) { this.refuse(CORPSE_TEXT.riding); return false; }
    return this.physicsReady() ? this.dropRagdoll(b) : this.layDown(b);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Lane DROPS: the ragdoll drop (see the header)

  /** The game's physics world is up (a built station): the ragdoll drop. */
  private physicsReady(): boolean {
    const h = this.host, ph = h.physics;
    return !!(ph?.ragdoll && ph.world && h.levels && h.layout);
  }

  /** A point in a lift cab (a Levels dynamic volume other than the parked car's interior: it moves — no body is left in one). */
  private inLift(x: number, y: number, z: number): boolean {
    const s = this.host.levels?.supportIn(x, z, y + 0.05);
    if (!s?.volume) return false;
    const p = this.parked();
    return !(p && this.insideCar(worldToTrain(p, x, s.floor + 0.05, z)));
  }

  /** Let the carried body go as a ragdoll from its carried pose (moved / pulled back by releaseOffset), or say why not. */
  private dropRagdoll(b: Body): boolean {
    const h = this.host, P = h.player, p = this.parked(), root = b.actor.root;
    if (this.inLift(P.x, P.y, P.z)) { this.refuse(CORPSE_TEXT.elevator); return false; }
    this.followView();
    const off = this.releaseOffset(b);
    if (!off) { this.refuse(CORPSE_TEXT.noSpace); return false; }
    const hips = root.getObjectByName('Hips');
    const c = (hips ? hips.getWorldPosition(C) : root.getWorldPosition(C)).add(off);
    if (this.inLift(c.x, c.y, c.z)) { this.refuse(CORPSE_TEXT.elevator); return false; }
    // the count caps at the release point (the car's or the station's); let go within CORPSE.nearCar of the car it may come to rest on
    // either side of its wall: both caps then (a record never holds more bodies than its validator takes)
    const l = p ? worldToTrain(p, c.x, c.y, c.z) : null, Sp = this.spec, N = CORPSE.nearCar;
    const inCar = !!l && this.insideCar(l);
    const near = !!l && !!Sp && l.x > Sp.interior.x0 - N && l.x < Sp.interior.x1 + N && Math.abs(l.z) < Sp.interior.halfWidth + N;
    if ((inCar || near) && this.trainCount() >= BODIES.maxAboard) { this.refuse(CORPSE_TEXT.trainFull); return false; }
    if ((!inCar || near) && this.stationCount() >= BODIES.stationHere) { this.refuse(CORPSE_TEXT.stationFull); return false; }
    this.restoreFlags(b);
    h.scene.attach(root); // (its world transform kept: the carried pose where it hangs now)
    root.position.add(off);
    root.updateMatrixWorld(true);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    if (!this.startFall(b, V.set((P.vx ?? 0) + fx * CORPSE.push, 0, (P.vz ?? 0) + fz * CORPSE.push))) {
      // (a rig the ragdoll refuses: back on the shoulder, then the posed drop)
      this.carry.add(root);
      this.carryPose(b);
      this.keepFlags(b);
      return this.layDown(b);
    }
    b.restarts = 0;
    b.rec = this.fallenRecord(b); // (its pose at once: a save in the next frames already holds it, marked falling)
    this.settle(b);
    h.atmosphere?.markShadows(root, false); // (enemies block the flashlight beam: so does a body lying there)
    this.lying.push(b);
    this.hand = null;
    this.counts.drops++;
    this.flush();
    return true;
  }

  /** The release offset (world m: the view's heading and across it) of the carried pose with every part free and in sight, else null. */
  private releaseOffset(b: Body): THREE.Vector3 | null {
    const P = this.host.player;
    const pts = this.partPoints(b.actor.root);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = -fz, rz = fx; // (forward, right)
    const chest = {x: P.x, y: P.y + CORPSE.chestY, z: P.z};
    for (const d of CORPSE.release) {
      for (const a of CORPSE.across) {
        const ox = fx * d + rx * a, oz = fz * d + rz * a;
        if (pts.every(q => this.freePoint(chest, q.x + ox, q.y, q.z + oz))) return new THREE.Vector3(ox, 0, oz);
      }
    }
    return null;
  }

  /**
   * World points spanning a body's ragdoll parts now: every bone below the skeleton root, the midpoint of each bone to its parent bone, the
   * crown and the toes (the parts' spheres sit on these segments).
   */
  private partPoints(root: THREE.Object3D): THREE.Vector3[] {
    root.updateMatrixWorld(true);
    const out: THREE.Vector3[] = [];
    root.traverse(o => {
      if (!(o as THREE.Bone).isBone || !(o.parent as THREE.Bone | null)?.isBone) return;
      const w = o.getWorldPosition(new THREE.Vector3());
      out.push(w);
      if ((o.parent as THREE.Bone).parent && (o.parent!.parent as THREE.Bone).isBone) out.push(o.parent!.getWorldPosition(new THREE.Vector3()).lerp(w, 0.5));
    });
    const head = root.getObjectByName('Head');
    if (head) out.push(head.localToWorld(new THREE.Vector3(0, 0.17, 0.02)));
    for (const n of ['L_Foot', 'R_Foot']) { const f = root.getObjectByName(n); if (f) out.push(f.localToWorld(new THREE.Vector3(0, -0.06, 0.13))); }
    return out;
  }

  /** A part point is in free space seen from the chest: nothing (walls, slabs, floors, props, the car's shell) on the way or `partClear` past it. */
  private freePoint(chest: V3, x: number, y: number, z: number): boolean {
    const L = this.host.levels!, dx = x - chest.x, dy = y - chest.y, dz = z - chest.z, dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;
    const want = dist + CORPSE.partClear;
    // (a long max distance: Levels.raycast's cheap prop reject measures from the ray's reach, so a long wall box is never skipped)
    const hit = L.raycast(chest, {x: dx / dist, y: dy / dist, z: dz / dist}, want + 3, {props: this.host.layout?.props ?? []});
    return hit.kind === 'none' || hit.t >= want;
  }

  /**
   * The body into the game's physics as a ragdoll from its current pose (the wrapper hands it `v` as its pelvis' start velocity, turning
   * at CORPSE.roll about the root's yaw-only Z: the bones' start velocities are the pelvis' + the roll's).
   */
  private startFall(b: Body, v: THREE.Vector3): boolean {
    const ph = this.host.physics;
    if (!ph?.ragdoll) return false;
    const root = b.actor.root, hips = root.getObjectByName('Hips');
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(Q);
    E1.setFromQuaternion(Q, 'YXZ');
    const w = new THREE.Vector3(0, 0, CORPSE.roll).applyQuaternion(QY.setFromAxisAngle(UP, E1.y));
    const at = hips ? hips.getWorldPosition(new THREE.Vector3()) : root.getWorldPosition(new THREE.Vector3());
    const rag = this.ragTarget(b, v.clone(), w, at);
    let ok = false;
    try { ok = ph.ragdoll(rag, null); } catch (err) { console.warn('corpses: a ragdoll drop failed', err); }
    if (!ok) return false;
    b.rag = rag;
    b.falling = true;
    b.vel = (b.vel ?? new THREE.Vector3()).copy(v);
    b.v = Infinity;
    b.last = null;
    this.counts.ragdolls++;
    return true;
  }

  /**
   * The ragdoll target of a body (its actor, but its start velocity is the drop's — the actor's own bone velocities are those of its last
   * living frames: `v` at the pelvis `at` + `w` (rad/s) x the bone's offset from it). The physics finds it by this object (forgetRagdoll /
   * actorVelocity), never by the actor.
   */
  private ragTarget(b: Body, v: THREE.Vector3, w: THREE.Vector3, at: THREE.Vector3): RagdollTarget {
    const a = b.actor, br = a.brain as {x: number; z: number};
    return {
      root: a.root, scale: b.rec.scale ?? a.scale, coated: a.coated, girth: a.girth, ragdollRig: a.ragdollRig,
      bone: n => a.bone(n),
      boneVelocity: (n, out) => {
        const bone = a.bone(n);
        if (!bone) return out.copy(v);
        return out.copy(bone.getWorldPosition(out).sub(at)).cross(w).negate().add(v); // (v + w x r = v - r x w)
      },
      beginRagdoll: () => a.beginRagdoll(),
      setCullSphere: (c, r) => a.setCullSphere(c, r),
      ragdollMoved: (x, z) => { br.x = x; br.z = z; },
    };
  }

  /** The body's ragdoll simulates now (PhysicsSystem.actorVelocity answers for a simulating ragdoll only). */
  private simulating(b: Body): boolean {
    return !!b.rag && !!this.host.physics?.actorVelocity?.(b.rag, V2.copy(b.centre), S);
  }

  /** Per frame while a dropped body falls: its centre follows the pelvis; once physics stops simulating it, it rests (or falls on). */
  private watchFall(b: Body, dt: number): void {
    const root = b.actor.root, hips = root.getObjectByName('Hips');
    if (hips) hips.getWorldPosition(C); else root.getWorldPosition(C);
    if (b.last && dt > 0) { b.vel = (b.vel ?? new THREE.Vector3()).copy(C).sub(b.last).divideScalar(dt); b.v = b.vel.length(); }
    b.last = (b.last ?? new THREE.Vector3()).copy(C);
    b.centre.copy(C);
    if (this.simulating(b)) return;
    if ((b.v ?? 0) > CORPSE.stillV && (b.restarts ?? 0) < CORPSE.restarts && this.physicsReady()) {
      // stopped in mid-fall (retired for a newer ragdoll): it falls on from where it is, as fast as it fell
      const v = V.copy(b.vel ?? V.set(0, 0, 0));
      this.leavePhysics(b);
      b.restarts = (b.restarts ?? 0) + 1;
      if (this.startFall(b, v)) { this.counts.restarts++; return; }
    }
    // at rest: out of the physics (the corpse system poses it from now on), re-rooted under the pelvis, lifted out of the floor
    this.leavePhysics(b);
    let rec = this.fallenRecord(b);
    this.applyPose(b, rec);
    const up = this.groundLift(b);
    if (up > 1e-3) {
      root.position.y += up;
      root.updateMatrixWorld(true);
      rec = this.fallenRecord(b);
      this.applyPose(b, rec);
    }
    delete rec.falling;
    b.rec = rec;
    this.settle(b);
    this.counts.landed++;
    this.flush();
  }

  /**
   * How far (world m, >= 0, at most CORPSE.lift) the body's deepest skinned point lies below the floor under it (the station's floors and
   * stair treads, the car's floor volume; StaticQuery.cellGround of the band `lift` above it): the lift that puts it on the floor.
   * A point counts only where that floor is level `liftFlat` m round it (one against a stair riser or a platform face is beside a floor,
   * not in it) and sunk at most `lift` (deeper: not this floor's).
   */
  private groundLift(b: Body): number {
    const q = this.host.physics?.statics;
    if (!q) return 0;
    const root = b.actor.root, top = CORPSE.lift, d = CORPSE.liftFlat;
    root.updateMatrixWorld(true);
    let sink = 0;
    const level = (x: number, z: number, y: number, s: number) =>
      Math.abs(q.cellGround(x + d, z, y) - s) < 0.01 && Math.abs(q.cellGround(x - d, z, y) - s) < 0.01 && Math.abs(q.cellGround(x, z + d, y) - s) < 0.01 && Math.abs(q.cellGround(x, z - d, y) - s) < 0.01;
    // (the floor of the band `top` above the point: a point in a thin slab — the car's floor over the trench — reads the floor it sank in)
    root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.visible) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += CORPSE.liftStride) {
        C.fromBufferAttribute(pos, i);
        m.applyBoneTransform(i, C);
        C.applyMatrix4(m.matrixWorld);
        const s = q.cellGround(C.x, C.z, C.y + top), k = s - C.y;
        if (Number.isFinite(s) && k > sink && k <= top && level(C.x, C.z, C.y + top, s)) sink = k;
      }
    });
    return sink;
  }

  /**
   * A body's CURRENT pose as a 'fallen' world record (marked `falling` with its pelvis velocity; nothing is moved): its bones' local
   * rotations, its root re-seated on the floor under the pelvis and turned about the vertical only (the pelvis' local transform recomputed
   * so the world pose is the same), the pelvis' storey.
   */
  private fallenRecord(b: Body): BodyRecordJSON {
    const root = b.actor.root, L = this.host.levels;
    root.updateMatrixWorld(true);
    const {bones} = readFallen(root, r5);
    const fv = BODIES.fallV, cv = (v: number | undefined) => r5(Math.max(-fv, Math.min(fv, v ?? 0)));
    const base: BodyRecordJSON = {...copyBody(b.rec), pose: 'fallen', bones, falling: [cv(b.vel?.x), cv(b.vel?.y), cv(b.vel?.z)]};
    const hips = root.getObjectByName('Hips');
    root.matrixWorld.decompose(V, Q, S);
    if (!hips?.parent) return {...base, ...this.worldPose(b), hips: [0, 0, 0]}; // (no pelvis bone: the root as it is)
    hips.getWorldPosition(C);
    const sup = L?.supportIn(C.x, C.z, C.y + 0.05) ?? null;
    E1.setFromQuaternion(Q, 'YXZ');
    const q = quat(QY.setFromAxisAngle(UP, E1.y));
    const x = r5(C.x), y = r5(sup ? sup.floor : C.y - 0.15), z = r5(C.z);
    // the new root's world matrix x the model's fixed chain from the root to the pelvis' parent bone; the pelvis' local = its inverse x world
    M1.compose(V2.set(x, y, z), QY.set(q[0], q[1], q[2], q[3]), S);
    M2.copy(root.matrixWorld).invert().multiply(hips.parent.matrixWorld);
    M1.multiply(M2).invert().multiply(hips.matrixWorld);
    M1.decompose(V, Q, S);
    Q.normalize();
    const hq = [r5(Q.x), r5(Q.y), r5(Q.z), r5(Q.w)], hl = Math.hypot(hq[0], hq[1], hq[2], hq[3]) || 1;
    bones.Hips = hq.map(v => r5(v / hl)) as [number, number, number, number];
    const lim = BODIES.hipsLim - 1e-3, cl = (v: number) => r5(Math.max(-lim, Math.min(lim, v)));
    return {...base, x, y, z, q, level: Math.max(0, sup?.level ?? b.rec.level ?? 0), hips: [cl(V.x), cl(V.y), cl(V.z)]};
  }

  /** A body posed exactly as a 'fallen' world record says (root + bones; its world pose as recorded). */
  private applyPose(b: Body, rec: BodyRecordJSON): void {
    const root = b.actor.root;
    root.position.set(rec.x, rec.y, rec.z);
    root.quaternion.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize();
    root.scale.setScalar(rec.scale ?? b.actor.scale);
    if (rec.bones) poseFallen(b.actor, rec.bones, rec.hips);
    root.updateMatrixWorld(true);
  }

  /** A body still falling at a teardown / departure: its ragdoll stops where it is now, its record says so (rebuilt, it falls on). */
  private stopFall(b: Body): void {
    this.leavePhysics(b);
    const rec = this.fallenRecord(b);
    this.applyPose(b, rec);
    b.rec = rec;
    this.settle(b);
    this.counts.stopped++;
  }

  /**
   * Task studio-refinement-batch-20261113-035659-01: the support under `box` is gone (world/acidMelt.ts completed a melt there): every body
   * lying AT REST on it — its pelvis or a bone point inside the footprint (+ 5 cm), above the support's base `y0`, at most 0.6 m over its
   * top — falls again as a ragdoll from its pose (no push), so none hangs in the air; it comes to rest on what is below as any drop does
   * (watchFall: the 'fallen' record, ownership by where the pelvis ends up). Nothing while the train rides / without the physics world.
   * Returns how many fell.
   */
  supportGone(box: {min: V3; max: V3}, y0: number): number {
    if (this.host.trainRide?.riding || !this.physicsReady()) return 0;
    const pad = 0.05, ylo = y0 + 0.04, yhi = box.max.y + 0.6;
    const on = (v: V3) => v.x >= box.min.x - pad && v.x <= box.max.x + pad && v.z >= box.min.z - pad && v.z <= box.max.z + pad && v.y >= ylo && v.y <= yhi;
    let n = 0;
    for (const b of this.lying) {
      if (b.falling || !(on(b.centre) || b.points.some(on))) continue;
      b.restarts = 0;
      if (this.startFall(b, V.set(0, 0, 0))) { n++; this.counts.unsupported++; }
    }
    return n;
  }

  /** A rebuilt body whose record was captured mid-fall falls on from that pose at its recorded velocity (a built station, a parked car). */
  private resume(b: Body): void {
    const f = b.rec.falling;
    if (b.rec.pose !== 'fallen' || !f || b.falling || this.host.trainRide?.riding || !this.physicsReady()) return;
    if (this.startFall(b, V.set(f[0], f[1], f[2]))) { b.restarts = 0; this.counts.resumed++; }
  }

  /** A lying body's world record now (a falling one: its pose this instant; a fallen one: its root where it is — a lift may carry it). */
  private worldRecord(b: Body): BodyRecordJSON {
    if (b.falling) return this.fallenRecord(b);
    return b.rec.pose === 'fallen' ? {...copyBody(b.rec), ...this.worldPose(b)} : copyBody(b.rec);
  }

  /** The posed drop (no physics world): laid down in the 'lying' pose on a clear, level spot in front, or say why not. */
  private layDown(b: Body): boolean {
    const h = this.host;
    const spot = this.dropSpot(b);
    if (typeof spot === 'string') { this.refuse(spot); return false; }
    const p = this.parked();
    const inCar = !!p && this.insideCar(worldToTrain(p, spot.centre.x, spot.centre.y, spot.centre.z));
    if (inCar && this.trainCount() >= BODIES.maxAboard) { this.refuse(CORPSE_TEXT.trainFull); return false; }
    if (!inCar && this.stationCount() >= BODIES.stationHere) { this.refuse(CORPSE_TEXT.stationFull); return false; }
    const root = b.actor.root;
    this.restoreFlags(b);
    h.scene.add(root);
    this.lieAt(b, spot.x, spot.y, spot.z, spot.yaw, spot.level);
    h.atmosphere?.markShadows(root, false); // (enemies block the flashlight beam: so does a body lying there)
    this.lying.push(b);
    this.hand = null;
    this.counts.drops++;
    h.sfx?.bodyFall?.(b.centre.x, b.centre.y, b.centre.z, 0.8);
    this.flush();
    return true;
  }

  /** The lying pose's grounding lift of a body's look (unscaled m; measured once per look: restingLift). */
  private lift(b: Body): number {
    const key = `${b.rec.arch}|${b.rec.look ?? ''}|${b.actor.root.name}`;
    let l = this.lifts.get(key);
    if (l === undefined) {
      const root = b.actor.root, parent = root.parent, pos = root.position.clone(), q = root.quaternion.clone();
      root.position.set(0, 0, 0); root.quaternion.identity(); // (its own frame; the bones already lie)
      if (parent) root.updateMatrixWorld(true);
      l = restingLift(root);
      root.position.copy(pos); root.quaternion.copy(q);
      this.lifts.set(key, l);
    }
    return l;
  }
  private readonly lifts = new Map<string, number>();

  /** Pose `b` lying with its root's floor at (x, y, z) / yaw (world, a child of the scene) and record that pose (the root: lifted). */
  private lieAt(b: Body, x: number, y: number, z: number, yaw: number, level: number): void {
    const root = b.actor.root, s = b.rec.scale ?? b.actor.scale;
    poseLying(b.actor);
    root.scale.setScalar(s);
    y += this.lift(b) * s; // (its lowest vertex exactly on the floor)
    root.position.set(x, y, z);
    root.quaternion.setFromAxisAngle(UP, yaw);
    this.settle(b);
    b.rec = {...copyBody(b.rec), x: r5(x), y: r5(y), z: r5(z), q: quat(root.quaternion), level};
  }

  /** The lying pose's footprint in the root frame (unscaled model metres): its bone points and the pelvis. */
  private footprint(b: Body): {pts: THREE.Vector3[]; hips: THREE.Vector3} {
    const root = b.actor.root;
    poseLying(b.actor); // (read in the root's own frame wherever it is; a refused drop goes back to the carry pose below)
    const inv = root.matrixWorld.clone().invert();
    const pts = bodyPoints(root).map(q => q.applyMatrix4(inv));
    const hips = boneInRoot(root, 'Hips', new THREE.Vector3()) ?? new THREE.Vector3();
    if (b === this.hand) this.carryPose(b);
    // a few points between the head / pelvis / feet so a doorway or a post between two bones is seen too
    const extra: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[i].distanceTo(pts[j]) > 0.5) extra.push(pts[i].clone().lerp(pts[j], 0.5));
    return {pts: [...pts, ...extra.slice(0, 24)], hips};
  }

  /** Where a carried body would lie: root pose + its storey + its centre, or the refusal text. */
  dropSpot(b: Body): {x: number; y: number; z: number; yaw: number; level: number; centre: THREE.Vector3} | string {
    const h = this.host, L = h.levels, P = h.player;
    if (!L || !h.layout) return CORPSE_TEXT.noRoom;
    const here = L.supportIn(P.x, P.z, P.y + 0.05);
    if (!here) return CORPSE_TEXT.noRoom;
    const fp = this.footprint(b), s = b.rec.scale ?? b.actor.scale;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let why: string = CORPSE_TEXT.noRoom;
    const others = [...this.lying.flatMap(o => o.points), ...h.zombies.filter(z => !z.brain.alive).map(z => new THREE.Vector3(z.brain.x, P.y, z.brain.z))];
    for (const yaw of [P.yaw + Math.PI / 2, P.yaw - Math.PI / 2, P.yaw, P.yaw + Math.PI]) {
      Q.setFromAxisAngle(UP, yaw);
      const hipsW = V2.copy(fp.hips).multiplyScalar(s).applyQuaternion(Q);
      for (const dist of CORPSE.dropAt) {
        const cx = P.x + fx * dist, cz = P.z + fz * dist;
        const rx = cx - hipsW.x, rz = cz - hipsW.z;
        const r = this.spotProblem(fp.pts.map(pt => V.copy(pt).multiplyScalar(s).applyQuaternion(Q).add(S.set(rx, here.floor, rz)).clone()), here.floor, {x: cx, z: cz}, others);
        if (r === null) {
          const centre = new THREE.Vector3(cx, here.floor + hipsW.y, cz);
          return {x: rx, y: here.floor, z: rz, yaw, level: here.level, centre};
        }
        if (r !== CORPSE_TEXT.noRoom) why = r;
      }
    }
    return why;
  }

  /** Why these world points cannot lie there (null: they can): level floor, clear of walls / props, in sight, not in a lift, apart. */
  private spotProblem(pts: readonly THREE.Vector3[], floor: number, centre: {x: number; z: number}, others: readonly THREE.Vector3[]): string | null {
    const h = this.host, L = h.levels!, P = h.player, p = this.parked();
    for (const q of pts) {
      const s = L.supportIn(q.x, q.z, floor + 0.05);
      if (!s || Math.abs(s.floor - floor) > CORPSE.floorTol) return CORPSE_TEXT.noRoom;
      if ((L.grid(s.level).rampIdx[s.cell] ?? -1) >= 0) return CORPSE_TEXT.noRoom;
      if (s.volume && !(p && this.insideCar(worldToTrain(p, q.x, floor, q.z)))) return CORPSE_TEXT.elevator; // (a lift cab: it moves)
      if (!L.circleClear(q.x, q.z, CORPSE.clear, floor) || this.propBlocks(q.x, q.z, floor, CORPSE.clear)) return CORPSE_TEXT.noRoom;
      for (const o of others) if (Math.abs(o.y - q.y) < 0.6 && (o.x - q.x) ** 2 + (o.z - q.z) ** 2 < CORPSE.apart ** 2) return CORPSE_TEXT.noRoom;
    }
    // never through a wall: in sight of the player's chest, and no collider (the car's walls, a counter) on the way to the centre
    if (!L.lineOfSight({x: P.x, y: P.y + 0.9, z: P.z}, {x: centre.x, y: floor + 0.9, z: centre.z})) return CORPSE_TEXT.noRoom;
    const dx = centre.x - P.x, dz = centre.z - P.z, n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
    for (let i = 1; i <= n; i++) if (this.propBlocks(P.x + dx * i / n, P.z + dz * i / n, floor, 0)) return CORPSE_TEXT.noRoom;
    return null;
  }

  /** A collider box of the world (Game.propIndex: station props, the car's walls / partitions / console) covers (x, z) at floor height. */
  private propBlocks(x: number, z: number, floor: number, r: number): boolean {
    const pi = this.host.propIndex;
    if (!pi) return false;
    const ids = pi.near(x - r, z - r, x + r, z + r, new Set());
    for (const i of ids) {
      const q = pi.props[i];
      if (!q || q.h <= 0.02 || q.y > floor + 0.35 || q.y + q.h < floor + 0.05) continue;
      // (hx / hz: the world-axis half extents, as the player's collision reads them; round props as their cylinder)
      if (q.round ? (x - q.x) ** 2 + (z - q.z) ** 2 < (q.hx + r) ** 2 : Math.abs(x - q.x) < q.hx + r && Math.abs(z - q.z) < q.hz + r) return true;
    }
    return false;
  }

  private modifier(): {speedMult?: number} {
    const b = this.hand ?? (this.handRec ? {rec: this.handRec} : null);
    if (!b) return {};
    const kg = CORPSE_TRAITS[b.rec.arch]?.massKg ?? 70;
    const walk = Math.max(CORPSE.slowMin, Math.min(CORPSE.slowMax, 1 - kg / CORPSE.massDiv));
    // a sprint while carrying is a heavy jog (the player's sprint flag is last frame's: one frame of a full stride at most)
    return {speedMult: this.host.player.sprinting ? walk * CORPSE.sprintJog * WALK_SPEED / SPRINT_SPEED : walk};
  }

  /** The carry frame follows part of the view's pitch (Game's camera = player pitch + aim offset; it is the camera's child). */
  private followView(): void {
    const h = this.host;
    const pitch = h.player.pitch + (h.aimOffset?.pitch ?? 0);
    this.carry.quaternion.setFromAxisAngle(V.set(1, 0, 0), -pitch * (1 - CORPSE.pitchFollow));
    this.carry.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Ownership: the parked car

  private get spec(): PlayerTrainSpec | null { return this.host.trainRuntime?.spec ?? null; }

  /** The car standing parked (built, not riding), else null. */
  parked(): TrainPlacement | null {
    return this.host.trainRide?.riding ? null : this.host.trainRuntime?.train?.placement ?? null;
  }

  /** A train-local point inside the car interior, between its floor and ceiling (world/trainCargo.ts insideCar). */
  insideCar(l: V3, pad = 0): boolean {
    const Sp = this.spec;
    if (!Sp) return false;
    return l.x > Sp.interior.x0 - pad && l.x < Sp.interior.x1 + pad && Math.abs(l.z) < Sp.interior.halfWidth + pad && l.y > Sp.floorY - 0.3 && l.y < Sp.ceilingY;
  }

  /** The lying body lies in the parked car: the train's. */
  ownsBody(b: Body, p: TrainPlacement | null = this.parked()): boolean {
    return !!p && this.insideCar(worldToTrain(p, b.centre.x, b.centre.y, b.centre.z));
  }

  /** A lying body's record in the train frame of `p` (lane DROPS: a falling one's pose this instant, marked falling). */
  private trainRecord(b: Body, p: TrainPlacement): BodyRecordJSON {
    let base = b.rec;
    if (b.falling) {
      base = this.fallenRecord(b);
      V.set(base.x, base.y, base.z);
      Q.set(base.q[0], base.q[1], base.q[2], base.q[3]);
    } else {
      const root = b.actor.root;
      root.updateMatrixWorld(true);
      root.matrixWorld.decompose(V, Q, S);
    }
    const l = worldToTrain(p, V.x, V.y, V.z);
    Q.premultiply(QY.setFromAxisAngle(UP, -p.yaw));
    const rec: BodyRecordJSON = {...copyBody(base), x: r5(l.x), y: r5(l.y), z: r5(l.z), q: quat(Q)};
    delete rec.level;
    if (rec.falling) rec.falling = turnV(rec.falling, -p.yaw); // (lane DROPS: its velocity in the car's frame too)
    return rec;
  }

  /** The train's bodies now (save time): riding, lying in the parked car, pending. Copies, by identity. */
  trainBodies(): BodyRecordJSON[] {
    const out = this.riding.map(b => copyBody(b.rec));
    const p = this.parked();
    if (p) for (const b of this.lying) if (this.ownsBody(b, p)) out.push(this.trainRecord(b, p));
    for (const r of this.pending) out.push(copyBody(r));
    const seen = new Set<string>();
    return out.filter(r => !seen.has(r.id) && !!seen.add(r.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private trainCount(): number {
    const p = this.parked();
    return this.riding.length + this.pending.length + (p ? this.lying.filter(b => this.ownsBody(b, p)).length : 0);
  }

  private stationCount(): number {
    const p = this.parked();
    return this.deferred.length + this.lying.filter(b => !this.ownsBody(b, p)).length;
  }

  /**
   * The departure refusal (Game.fuelCheck, with the carts' / props' rules, before anything moves): a body straddling the car's wall line —
   * its centre inside with a point well outside, or the other way round — or more than BODIES.maxAboard bodies aboard. Null: free to leave.
   */
  departBlock(): string | null {
    const p = this.parked(), Sp = this.spec;
    if (!p || !Sp) return null;
    const n = this.trainCount();
    if (n > BODIES.maxAboard) { this.counts.blocked++; return CORPSE_TEXT.overloaded(n); }
    const T = CORPSE.wallTol;
    for (const b of this.lying) {
      const c = worldToTrain(p, b.centre.x, b.centre.y, b.centre.z);
      if (c.x < Sp.interior.x0 - 3 || c.x > Sp.interior.x1 + 3 || Math.abs(c.z) > Sp.interior.halfWidth + 3) continue;
      if (b.falling) { this.counts.blocked++; return CORPSE_TEXT.settling; } // (lane DROPS: one falling at the car — where it ends decides)
      const inside = this.insideCar(c);
      const pts = b.points.map(q => worldToTrain(p, q.x, q.y, q.z)).map(q => ({x: q.x, y: Math.max(q.y, Sp.floorY), z: q.z}));
      const straddles = inside ? pts.some(q => !this.insideCar(q, T)) : pts.some(q => this.insideCar(q, -T));
      if (straddles) { this.counts.blocked++; return CORPSE_TEXT.doorway; }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Records: the station lane, the train, the hands

  /**
   * The live station's lane now (every pickup / drop, the teardown, Game.commitEndingSave): the handled bodies lying in it that are not the
   * train's, plus the records no model could be built for. Non-destructive.
   */
  flush(): void {
    const w = this.here;
    if (!w) return;
    const p = this.parked();
    const here = [...this.deferred.map(copyBody), ...this.lying.filter(b => !this.ownsBody(b, p)).map(b => this.worldRecord(b))]; // (lane DROPS: live poses)
    const seen = new Set<string>();
    const list = here.filter(r => !seen.has(r.id) && !!seen.add(r.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // (never cut: BODIES.stationHere is the format's input safety and a drop beyond it is refused)
    this.host.run.setLaneStore(STATION_BODIES_LANE, list.length ? {v: 1, here: list} : undefined, w.key);
    this.counts.flushes++;
  }

  /** Load / Continue / Retry / New game: the train's bodies become exactly `bodies` (its current ones leave the world first). */
  restoreBodies(bodies: readonly BodyRecordJSON[]): void {
    for (const b of this.riding.splice(0)) this.dispose(b);
    this.captured = false;
    const p = this.parked();
    if (p) for (const b of [...this.lying]) if (this.ownsBody(b, p)) { this.lying.splice(this.lying.indexOf(b), 1); this.dispose(b); }
    this.pending = bodies.map(copyBody);
  }

  participant(): RunParticipant {
    return {
      id: CORPSE_CARRY_PARTICIPANT,
      save: (): CorpseCarryJSON => {
        const r = this.hand?.rec ?? this.handRec;
        return {v: 1, held: r ? heldRecord(r) : null};
      },
      load: d => this.setHeld(carriedBodyOf(d, corpseCarriable)),
      reset: () => this.setHeld(null),
    };
  }

  /** The hands hold exactly `rec` (its body is built at once in a live world, else at the next build). */
  private setHeld(rec: BodyRecordJSON | null): void {
    if (this.hand) { this.dispose(this.hand); this.hand = null; }
    this.handRec = rec ? heldRecord(rec) : null;
    if (this.here) this.buildHeld();
  }

  private buildHeld(): void {
    if (!this.handRec || this.hand) return;
    const b = this.makeBody(this.handRec);
    if (!b) return;
    this.carry.add(b.actor.root);
    b.rec = heldRecord(b.rec);
    this.carryPose(b);
    this.keepFlags(b);
    this.hand = b;
    this.handRec = null;
  }

  /** Task corpse-chipper: a decoded save's records (not installed yet) — the prepare fetches their models too (Game.decodeSave). */
  notePrepared(run: object, participants: Record<string, unknown> | undefined): void {
    const t = participants?.['player-train'] as {cargo?: unknown; chipper?: {job?: {body?: unknown} | null}} | undefined;
    const out = cargoBodiesOf(t?.cargo);
    const held = carriedBodyOf(participants?.[CORPSE_CARRY_PARTICIPANT], corpseCarriable);
    if (held) out.push(held);
    const job = t?.chipper?.job?.body as BodyRecordJSON | undefined;
    if (job && typeof job === 'object' && typeof job.arch === 'string') out.push(job);
    this.prepared.set(run, out);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  /** The lazy model keys of a list of records (archetype models, lingerie / cosplay garments): the layout's section model keys. */
  static modelKeys(recs: readonly BodyRecordJSON[]): string[] {
    const zs = recs.map(r => ({archetype: r.arch, look: r.look, variant: r.variant})) as unknown as ZombieSpawn[]; // (the keys read archetype / look / variant only)
    return [...new Set([...enemyModelKeysFor({zombies: zs}), ...lingerieModelKeysFor({zombies: zs}), ...cosplayModelKeysFor({zombies: zs})])].sort();
  }

  /** Every record a section build may need a model for (a superset at prepare: the Retry snapshot's and a decoded save's too). */
  private onLayout(layout: StationLayout, key: SectionKey, run: CorpseHost['run'], phase: Phase): void {
    const recs: BodyRecordJSON[] = [];
    const h = this.host;
    if (this.hand) recs.push(this.hand.rec);
    if (this.handRec) recs.push(this.handRec);
    recs.push(...this.riding.map(b => b.rec), ...this.lying.map(b => b.rec), ...this.pending);
    const job = h.playerTrain.chipper?.state.job?.body;
    if (job) recs.push(job);
    recs.push(...stationBodiesOf(run.laneStore(STATION_BODIES_LANE, key), corpseCarriable));
    if (phase === 'prepare') {
      const snap = run.entry;
      if (snap) {
        recs.push(...stationBodiesOf(snap.memories?.[sectionId(key)]?.lanes?.[STATION_BODIES_LANE], corpseCarriable));
        const held = carriedBodyOf(snap.lanes?.[CORPSE_CARRY_PARTICIPANT], corpseCarriable);
        if (held) recs.push(held);
        const t = snap.lanes?.['player-train'] as {cargo?: unknown; chipper?: {job?: {body?: BodyRecordJSON} | null}} | undefined;
        recs.push(...cargoBodiesOf(t?.cargo));
        if (t?.chipper?.job?.body) recs.push(t.chipper.job.body);
      }
      recs.push(...(this.prepared.get(run) ?? []));
    }
    (layout as unknown as Record<symbol, readonly string[]>)[KEYS] = CorpseSystem.modelKeys(recs.filter(r => r && typeof r.arch === 'string'));
  }

  private onBuild(): void {
    const h = this.host, layout = h.layout;
    if (!layout) return;
    const key = {...h.run.current};
    this.here = {key, layout};
    this.prepared.delete(h.run);
    this.deferred = [];
    // the station's handled bodies, at their world poses (their source enemies, if from here, are in the killed list: never doubled)
    for (const rec of stationBodiesOf(h.run.laneStore(STATION_BODIES_LANE, key), corpseCarriable)) {
      if (this.lying.some(b => b.rec.id === rec.id) || this.riding.some(b => b.rec.id === rec.id)) continue;
      const b = this.makeBody(rec);
      if (!b) { this.deferred.push(rec); continue; }
      h.scene.add(b.actor.root);
      this.settle(b);
      h.atmosphere?.markShadows(b.actor.root, false);
      this.lying.push(b);
      this.resume(b); // (lane DROPS: one saved while it fell falls on)
    }
    // the train's pending bodies: in the parked car, or riding in on the car's view root (an arriving build)
    this.placePending();
    this.buildHeld();
  }

  /** Pending train records -> bodies in the parked car (or on the riding car's view root). Records without a model stay pending. */
  private placePending(): void {
    const h = this.host, view = h.trainRuntime?.view?.root, riding = !!h.trainRide?.riding, p = h.trainRuntime?.train?.placement ?? null;
    if (!this.pending.length || (!riding && !p) || (riding && !view)) return;
    const keep: BodyRecordJSON[] = [];
    for (const rec of this.pending) {
      const b = this.makeBody(rec);
      if (!b) { keep.push(rec); continue; }
      if (riding) {
        view!.add(b.actor.root); // (its pose is train-local: the view root's frame)
        b.actor.root.updateMatrixWorld(true);
        this.riding.push(b);
        this.captured = true;
      } else {
        h.scene.add(b.actor.root);
        this.placeInCar(b, p!);
        h.atmosphere?.markShadows(b.actor.root, false);
        this.lying.push(b);
        this.resume(b); // (lane DROPS)
      }
    }
    this.pending = keep;
  }

  /** A train record's world pose in the parked car `p` (a pose from a save clamped into the interior: always aboard). */
  private placeInCar(b: Body, p: TrainPlacement): void {
    const Sp = this.spec, rec = b.rec, root = b.actor.root;
    let {x, z} = rec;
    if (Sp) { x = Math.max(Sp.interior.x0 + 0.05, Math.min(Sp.interior.x1 - 0.05, x)); z = Math.max(-Sp.interior.halfWidth + 0.05, Math.min(Sp.interior.halfWidth - 0.05, z)); }
    const w = trainToWorld(p, x, rec.y, z);
    root.position.set(w.x, w.y, w.z);
    root.quaternion.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize().premultiply(QY.setFromAxisAngle(UP, p.yaw));
    this.settle(b);
    const f = b.rec.falling;
    b.rec = {...copyBody(b.rec), ...this.worldPose(b)}; // (lying in the world: a world record; trainRecord() gives its car-local one)
    if (f) b.rec.falling = turnV(f, p.yaw); // (lane DROPS: a falling one's velocity back in the world's frame)
  }

  /** A lying body's world pose fields (root position / orientation + storey). */
  private worldPose(b: Body): Pick<BodyRecordJSON, 'x' | 'y' | 'z' | 'q' | 'level'> {
    const root = b.actor.root;
    root.updateMatrixWorld(true);
    root.matrixWorld.decompose(V, Q, S);
    const lv = this.host.levels?.supportIn(V.x, V.z, V.y + 0.05)?.level ?? b.rec.level ?? 0;
    return {x: r5(V.x), y: r5(V.y), z: r5(V.z), q: quat(Q), level: Math.max(0, lv)};
  }

  /** Teardown (FIRST): the train's lying bodies -> pending records, the station's -> its lane; the riding ones and the hands stay. */
  private onTeardown(): void {
    if (!this.here) return;
    const h = this.host;
    for (const b of this.lying) if (b.falling) this.stopFall(b); // (lane DROPS: recorded as they are this instant, marked falling)
    if (h.trainRide?.riding && !this.captured) this.capture(); // (a teardown before the ride's first frame: the car's bodies ride along)
    const p = this.parked();
    if (p) for (const b of [...this.lying]) if (this.ownsBody(b, p)) { this.pending.push(this.trainRecord(b, p)); this.lying.splice(this.lying.indexOf(b), 1); this.dispose(b); }
    this.flush();
    for (const b of this.lying.splice(0)) this.dispose(b);
    this.deferred = [];
    this.here = null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The ride

  /** Doors closing / departing: the bodies in the parked car move onto the car's view root at their train-local poses (once). */
  capture(): number {
    const h = this.host, root = h.trainRuntime?.view?.root, p = h.trainRuntime?.train?.placement;
    if (!root || !p) return 0;
    let n = 0;
    for (const b of [...this.lying]) {
      if (!(this.here && this.insideCar(worldToTrain(p, b.centre.x, b.centre.y, b.centre.z)))) continue;
      if (b.falling) this.stopFall(b); // (lane DROPS: departBlock waits for it; a ride started otherwise records it falling — it falls on at the stop)
      this.leavePhysics(b); // (lane DROPS: a riding body is no corpse of the station's physics)
      b.rec = this.trainRecord(b, p);
      const o = b.actor.root;
      root.add(o);
      o.position.set(b.rec.x, b.rec.y, b.rec.z);
      o.quaternion.set(b.rec.q[0], b.rec.q[1], b.rec.q[2], b.rec.q[3]);
      o.updateMatrixWorld(true);
      this.lying.splice(this.lying.indexOf(b), 1);
      this.riding.push(b);
      n++;
    }
    this.captured = true;
    this.counts.captured += n;
    if (n) this.flush();
    return n;
  }

  /** The car stopped at a placement: the riding bodies lie in the parked car again (this world's or the next one's). */
  release(): number {
    const h = this.host, p = this.parked();
    this.captured = false;
    let n = 0;
    for (const b of this.riding.splice(0)) {
      if (!p || !this.here) { this.pending.push(copyBody(b.rec)); this.dispose(b); continue; }
      h.scene.add(b.actor.root);
      this.placeInCar(b, p);
      h.atmosphere?.markShadows(b.actor.root, false);
      this.lying.push(b);
      this.resume(b); // (lane DROPS: one captured while it fell falls on in the parked car)
      n++;
    }
    this.counts.released += n;
    return n;
  }

  frame(dt: number): void {
    const ride = this.host.trainRide;
    if (ride?.riding) { if (!this.captured && (ride.phase === 'closing' || ride.phase === 'departing')) this.capture(); }
    else if (this.captured || this.riding.length) this.release();
    for (const b of this.lying) if (b.falling) this.watchFall(b, dt); // (lane DROPS: the ragdoll drops in flight)
    if (!this.hand && this.handRec && this.here && (this.retryT -= dt) <= 0) { this.retryT = 1; this.buildHeld(); } // (a model that arrived late)
    if (this.hand) this.followView();
    const step = dt / CORPSE.holsterS;
    this.holster = this.owner() ? Math.min(1, this.holster + step) : Math.max(0, this.holster - step);
  }

  /** QA: a compact state report. */
  qa() {
    const p = this.parked();
    return {held: this.hand?.rec.id ?? this.handRec?.id ?? null, built: !!this.hand, holster: +this.holster.toFixed(2),
      lying: this.lying.map(b => ({id: b.rec.id, arch: b.rec.arch, owner: this.ownsBody(b, p) ? 'train' : 'station', x: +b.centre.x.toFixed(2), y: +b.centre.y.toFixed(2), z: +b.centre.z.toFixed(2),
        pose: b.rec.pose, falling: !!b.falling})),
      riding: this.riding.map(b => b.rec.id), pending: this.pending.map(r => r.id), deferred: this.deferred.map(r => r.id), sinks: this.sinks.length, captured: this.captured, counts: {...this.counts}};
  }
}

/** Create the corpse system and register it into the Game (once, after the train's cargo systems). */
export function installCorpses(game: unknown, deps: CorpseDeps): CorpseSystem {
  return new CorpseSystem(game as CorpseHost, deps).install();
}
