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
// owns record + object from that call on); a refusal is shown and keeps it. Otherwise E lays it down in the 'lying' pose (its Death clip's
// end frame: grounded by the asset contract) on a free, level floor spot in front of the player (refused while the train moves).
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
import {CORPSE_TRAITS, corpseFeedable} from '../ai/corpseTrait';
import {enemyModelKeysFor} from '../ai/enemyModels';
import {cosplayModelKeysFor, lingerieModelKeysFor} from '../ai/spawnLook';
import {BODIES, bodyId, copyBody, type BodyRecordJSON} from '../corpse/bodyRecord';
import {CORPSE_CARRY_PARTICIPANT, STATION_BODIES_LANE, carriedBodyOf, heldRecord, stationBodiesOf, type CorpseCarryJSON} from '../corpse/bodyLanes';
import type {BodyOffer, BodySink, CorpseSystemApi, HeldBody} from '../corpse/api';
import {boneInRoot, bodyPoints, poseCarry, poseLying} from '../corpse/bodyPose';
import {corpseVolumes, type DamageZombie} from '../damage/system';
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
  overloaded: (n: number) => `The train is overloaded — ${n} bodies lie in it, at most ${BODIES.maxAboard} can travel. Carry ${n - BODIES.maxAboard} out first`,
} as const;

type Phase = 'prepare' | 'build';
type V3 = {x: number; y: number; z: number};
const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), QY = new THREE.Quaternion(), S = new THREE.Vector3(), EYE = new THREE.Vector3(), DIR = new THREE.Vector3();
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

/** A handled body in the live world (or riding / in the hands). */
interface Body {
  rec: BodyRecordJSON;
  actor: EnemyActor;
  /** World positions of its bone points while lying (ownership / doorway / spacing); its centre = the pelvis. */
  points: THREE.Vector3[];
  centre: THREE.Vector3;
  /** Its meshes' frustumCulled / castShadow before the carry. */
  flags: {mesh: THREE.Mesh; culled: boolean; shadow: boolean}[] | null;
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
  player: {x: number; y: number; z: number; yaw: number; pitch: number; alive: boolean; climbing: boolean; sprinting: boolean};
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
  physics?: {forgetRagdoll?(target: object): boolean} | null;
  damage?: {releaseZombie?(z: object): boolean} | null;
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void} | null;
  trainRuntime?: {spec: PlayerTrainSpec; view: {root: THREE.Object3D} | null; train: {placement: TrainPlacement} | null} | null;
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
  readonly counts = {pickups: 0, drops: 0, sunk: 0, refused: 0, built: 0, failed: 0, captured: 0, released: 0, flushes: 0, blocked: 0};

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
    if (!h.buildEnemyActor || !corpseFeedable(rec.arch)) return null;
    const index = Number(rec.id.slice(rec.id.lastIndexOf('#') + 1));
    const spawn: ZombieSpawn = {x: 0, z: 0, yaw: 0, type: rec.type, area: 0, ...(rec.arch !== 'zombie' ? {archetype: rec.arch} : {}), ...(rec.look ? {look: rec.look} : {})};
    let built: {actor: EnemyActor; fallback: boolean};
    try { built = h.buildEnemyActor(spawn, index, rec.seed >>> 0, mulberry32((hashString(rec.id) ^ rec.seed) >>> 0)); } catch (err) { console.warn('corpses: a body could not be built', rec.id, err); this.counts.failed++; return null; }
    const a = built.actor;
    if (built.fallback || archetypeOf(a) !== rec.arch) { a.dispose(); this.counts.failed++; return null; } // (never another body standing in)
    a.beginRagdoll(); // the mixer stops; animate / syncTransform leave the bones alone
    const s = rec.scale ?? a.scale;
    a.root.scale.setScalar(s);
    (a as unknown as {scale: number}).scale = s;
    poseLying(a);
    a.root.position.set(rec.x, rec.y, rec.z);
    a.root.quaternion.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize();
    a.root.updateMatrixWorld(true);
    this.actors.set(a.root, a);
    this.counts.built++;
    return {rec: copyBody(rec), actor: a, points: [], centre: new THREE.Vector3(), flags: null};
  }

  private dispose(b: Body): void {
    this.restoreFlags(b);
    this.disposeBody(b.actor.root);
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

  /** A live actor's body can be carried: dead, a layout spawn (identity), a feedable archetype. */
  eligible(z: EnemyActor): boolean {
    return !z.brain.alive && this.deps.enemyIndex(z) !== undefined && corpseFeedable(archetypeOf(z));
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
        if (index === undefined || !corpseFeedable(archetypeOf(z))) continue;
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
    this.putDown();
    return true;
  }

  /** Hand the body to `sink` (one call: true = the sink owns record + object now; the hands are free). */
  private toSink(sink: BodySink): boolean {
    const b = this.hand;
    const held = this.held();
    if (!b || !held) return false;
    let took = false;
    try { took = sink.take(held); } catch (err) { console.warn('corpses: a sink take failed', err); }
    if (!took) { this.host.sfx?.denied?.(); this.counts.refused++; return false; }
    this.restoreFlags(b);
    // (the sink re-poses it: its skinned bounds would not follow — it stays unculled, as carried)
    b.actor.root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; });
    if (b.actor.root.parent === this.carry) this.host.scene.attach(b.actor.root); // (out of the hands; the sink places it)
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

  /** Lay the carried body down in front of the player (the 'lying' pose), or say why not; true = done. */
  putDown(): boolean {
    const h = this.host, b = this.hand;
    if (!b) return false;
    if (h.trainRide?.riding) { this.refuse(CORPSE_TEXT.riding); return false; }
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

  /** Pose `b` lying with its root at (x, y, z) / yaw (world, a child of the scene) and record that pose. */
  private lieAt(b: Body, x: number, y: number, z: number, yaw: number, level: number): void {
    const root = b.actor.root, s = b.rec.scale ?? b.actor.scale;
    poseLying(b.actor);
    root.scale.setScalar(s);
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

  /** A lying body's record in the train frame of `p`. */
  private trainRecord(b: Body, p: TrainPlacement): BodyRecordJSON {
    const root = b.actor.root;
    root.updateMatrixWorld(true);
    root.matrixWorld.decompose(V, Q, S);
    const l = worldToTrain(p, V.x, V.y, V.z);
    Q.premultiply(QY.setFromAxisAngle(UP, -p.yaw));
    const rec: BodyRecordJSON = {...copyBody(b.rec), x: r5(l.x), y: r5(l.y), z: r5(l.z), q: quat(Q)};
    delete rec.level;
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
    const here = [...this.deferred.map(copyBody), ...this.lying.filter(b => !this.ownsBody(b, p)).map(b => copyBody(b.rec))];
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
      load: d => this.setHeld(carriedBodyOf(d, corpseFeedable)),
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
    const held = carriedBodyOf(participants?.[CORPSE_CARRY_PARTICIPANT], corpseFeedable);
    if (held) out.push(held);
    const job = t?.chipper?.job?.body as BodyRecordJSON | undefined;
    if (job && typeof job === 'object' && typeof job.arch === 'string') out.push(job);
    this.prepared.set(run, out);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  /** The lazy model keys of a list of records (archetype models, lingerie / cosplay garments): the layout's section model keys. */
  static modelKeys(recs: readonly BodyRecordJSON[]): string[] {
    const zs = recs.map(r => ({archetype: r.arch, look: r.look})) as unknown as ZombieSpawn[]; // (the keys read archetype / look only)
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
    recs.push(...stationBodiesOf(run.laneStore(STATION_BODIES_LANE, key), corpseFeedable));
    if (phase === 'prepare') {
      const snap = run.entry;
      if (snap) {
        recs.push(...stationBodiesOf(snap.memories?.[sectionId(key)]?.lanes?.[STATION_BODIES_LANE], corpseFeedable));
        const held = carriedBodyOf(snap.lanes?.[CORPSE_CARRY_PARTICIPANT], corpseFeedable);
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
    for (const rec of stationBodiesOf(h.run.laneStore(STATION_BODIES_LANE, key), corpseFeedable)) {
      if (this.lying.some(b => b.rec.id === rec.id) || this.riding.some(b => b.rec.id === rec.id)) continue;
      const b = this.makeBody(rec);
      if (!b) { this.deferred.push(rec); continue; }
      h.scene.add(b.actor.root);
      this.settle(b);
      h.atmosphere?.markShadows(b.actor.root, false);
      this.lying.push(b);
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
    b.rec = {...copyBody(b.rec), ...this.worldPose(b)}; // (lying in the world: a world record; trainRecord() gives its car-local one)
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
      n++;
    }
    this.counts.released += n;
    return n;
  }

  frame(dt: number): void {
    const ride = this.host.trainRide;
    if (ride?.riding) { if (!this.captured && (ride.phase === 'closing' || ride.phase === 'departing')) this.capture(); }
    else if (this.captured || this.riding.length) this.release();
    if (!this.hand && this.handRec && this.here && (this.retryT -= dt) <= 0) { this.retryT = 1; this.buildHeld(); } // (a model that arrived late)
    if (this.hand) this.followView();
    const target = this.owner() ? 1 : 0;
    this.holster = target > this.holster ? Math.min(1, this.holster + dt / CORPSE.holsterS) : Math.max(0, this.holster - dt / CORPSE.holsterS);
  }

  /** QA: a compact state report. */
  qa() {
    const p = this.parked();
    return {held: this.hand?.rec.id ?? this.handRec?.id ?? null, built: !!this.hand, holster: +this.holster.toFixed(2),
      lying: this.lying.map(b => ({id: b.rec.id, arch: b.rec.arch, owner: this.ownsBody(b, p) ? 'train' : 'station', x: +b.centre.x.toFixed(2), y: +b.centre.y.toFixed(2), z: +b.centre.z.toFixed(2)})),
      riding: this.riding.map(b => b.rec.id), pending: this.pending.map(r => r.id), deferred: this.deferred.map(r => r.id), sinks: this.sinks.length, captured: this.captured, counts: {...this.counts}};
  }
}

/** Create the corpse system and register it into the Game (once, after the train's cargo systems). */
export function installCorpses(game: unknown, deps: CorpseDeps): CorpseSystem {
  return new CorpseSystem(game as CorpseHost, deps).install();
}
