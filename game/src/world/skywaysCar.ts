// Task studio-skyways-level-20261106-054448 (lane CAR): THE PRIZE CAR — a surprise, first-person-only drivable car standing in the
// Skyways 'prize-car' add-on (layout.skyways.addon.car: one per station world; never train cargo).
//
// User intent: a short arcade change of pace — FIRST PERSON ONLY (the camera is the driver's eye on the real seat: gas exposure,
// zombie attacks and light all work on the real player position; never an external camera); ram zombies to kill them through actual
// contact, push physics objects, fun acceleration / steering / braking / reverse; no simulation, no fuel / maintenance / management.
// DISCOVERY: nothing advertises it (no objective text, map label, loading tip or tutorial) — only a LOCAL close-up "Get in" prompt and,
// while actually driving, the controls hint.
//
// Installs through the Game's registries only (frameHooks, interactHandlers + promptProviders FIRST — while driving, E always gets
// out and no other lane prompt shows —, inputOwners, stateListeners, sectionHooks, sectionPreloads, warmRegistry, bulletHitHandlers, the
// gear's placeRules) plus Game.update's player slot: while `driving`, Game steps the player through stepPlayer() instead of
// Player.update (game.ts, like the train ride). Game.ts also asks `driving` for the reload / item-use refusals and `holster` for the
// lowered viewmodel.
//
// ENTER / EXIT: [E] looking at the car (within CAR_RT.enterReach, nothing structural in between) while standing by a door
// (CAR_RT.doorReach of either door; the driver always takes the LEFT seat) — not climbing / riding / using an item / with another lane
// owning the hands (a grabbed fuel cart, a readied backpack). Inside: [E] gets out once the car has (nearly) stopped (CAR_RT.exitSpeed)
// at the left door's stand point if a player circle fits there on the same storey floor (nothing solid, a clear line from the seat),
// else the right, the front, the back; none -> "No room to get out". Death, any state other than playing / paused / inventory, a
// teardown (travel / Retry / Load / New game) -> the player is out, the car stays parked, the controls cleared.
// DRIVING: W drive, S brake / reverse, A / D steer, Space handbrake (world/skywaysCarPhysics.ts: arcade kinematics, the rigid
// multi-circle body against the world's collision, the floor rule). Mouse look is relative to the car (the yaw clamped to
// ±CAR_RT.lookYaw; settings / inversion untouched: Game's applyMouseLook runs as ever). No fire / melee / ADS / flares / throws
// (inputOwners), no reload / item use (game.ts asks `driving`), no backpack set-down (placeRules); the held item is lowered (holster).
// IMPACTS (same storey only): a zombie the car meets closing faster than CAR_RT.killSpeed dies through the REAL kill path
// (brain.damage + Game.blastKill: kill stats, death cue, ragdoll along the car's velocity; the section memory records the dead brain);
// slower contacts shove it out of the body through its own collision (never into a wall) and slow the car; a body pinned against
// something while the car presses on is crushed (CAR_RT.crushDps). Every zombie is also kept out of the PARKED car, and the walking
// player never passes through it. Loose props: a dynamic floor prop the body is about to meet is shoved with an impulse ∝ speed through
// physics/dynamicItems.ts shootProp (its budgets: MAX_DYNAMIC_PROPS bodies, detach reclaim; at most CAR_RT.kick.perFrame a frame, a
// per-prop cooldown; never a level-wide wake), already loose ones in front by a short ray (rayHits); the moving car's circles are
// walkers too (contact wake + the walker shove up to 12 m/s). Glass: a hit faster than CAR_RT.glassSpeed breaks the Skyways window
// pane(s) at the contact through the gas system's break path (breakPane: gas comes in — the established rule; the wall cells still stop
// the car) and shatters a glazed prop there through damage.hitWorld (nothing else is damaged). Bullets meeting the car stop on it.
// PERSISTENCE: the lane store SKYWAYS_CAR_LANE {v: 2, x, y, z, yaw, level, lights, trunk} (world/skywaysCarStore.ts; strict, validated by
// save/validate.ts; a v1 record upgrades once: lamps off, an empty trunk) — written at teardown, on getting out and when play pauses;
// read at the build (a record that no longer satisfies the floor rule falls back to the generator's spawn; its lamps / trunk stay).
// Exactly one car per station world.
// AUDIO: `audio` (CarAudio; lane CAR2: the Sound Lab car set through audio/sfx.ts carEngine / stopCarEngine / carSkid / carDoor) — the
// engine runs only while someone is in the car: it starts on getting in (a short rev), follows the speed / throttle every frame (idle at
// rest), stops on getting out / death / a state change / teardown (a pause or a new world also silences it in Sfx); the tyre skid on a
// hard brake / handbrake above CAR_RT.skidSpeed (an edge, rate-limited: CAR_RT.skidEvery); the car door on getting in / out; impacts
// reuse existing cues (the metal crash, the flesh slap).

import * as THREE from 'three';
import type {Game} from '../game';
import type {Levels} from '../gen/levels';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {BODY_CLEAR} from '../gen/levels';
import {STEP_UP} from '../gen/grid';
import {moveCircle, resolveCircle, type PropIndex} from '../core/physics';
import {MAX_SHOT_DV, dynamicKind} from '../physics/dynamicItems';
import {propDamageSpec, propPhysics} from '../damage/materials';
import {STAND_EYE} from '../player/player';
import {paneCentre, type PaneRef} from './windowBreach';
import {rayBox, type Box3Like} from './towerShared';
import {CAR_SPEC, carToWorld, worldToCar, type CarSpec} from './skywaysCarSpec';
import {CAR_PHYS, NO_CONTROLS, footprintFloor, nearestCircle, settlePose, stepCar, wrapAngle, type CarBody, type CarControls, type CarImpact, type CarStep, type CarWorld} from './skywaysCarPhysics';
import {SKYWAYS_CAR_LANE, emptyTrunk, skywaysCarProblem, skywaysCarRecord, upgradeCarRecord, type SkywaysCarRecord, type SkywaysCarRecordV1} from './skywaysCarStore';
import type {StackJSON} from '../items/inventory';
import {buildCarView, carModelsGen, loadSkywaysCarModel, refreshCarView, releaseSkywaysCarModel, setWheel, type CarView} from './skywaysCarModel';
import {attachCarBeam, createCarBeam, setCarLamps, type CarBeam} from './skywaysCarLights';

export const CAR_RT = {
  /** Aim reach to the car's body (eye -> hit, m) and the most a player may stand from a door's side point (m, horizontal). */
  enterReach: 2.2,
  doorReach: 2.0,
  /** Get out only below this speed (m/s). */
  exitSpeed: 1.5,
  /** Mouse look relative to the car: yaw clamp (rad, ~150°). */
  lookYaw: (150 * Math.PI) / 180,
  /** A zombie met closing faster than this (m/s) dies; the car keeps (1 - killSlow) of its speed per kill. */
  killSpeed: 4,
  killSlow: 0.1,
  /** Slower contacts: the car loses pushDecel (m/s²) per pushed body; a pinned body is crushed at crushDps while it presses on. */
  pushDecel: 6,
  crushDps: 90,
  pinned: 0.06,
  /** Same storey: |zombie feet - car floor| below this (m). */
  storeyY: 0.9,
  /** Glass breaks above this closing speed (m/s): panes within paneReach (m) along the wall / paneDepth (m) of the glass plane. */
  glassSpeed: 6,
  paneReach: 1.2,
  paneDepth: 0.9,
  maxPanes: 2,
  /** Prop glass: damage per hit = glassDamage + glassPerMs x closing m/s, a prop at most once per glassCooldown s. */
  glassDamage: 30,
  glassPerMs: 6,
  glassCooldown: 0.6,
  /** Loose props: Δv = min(MAX_SHOT_DV, gain x speed), at most perFrame kicks a frame, one prop at most once per cooldown s. */
  kick: {gain: 1.1, perFrame: 3, cooldown: 0.15, rayAbove: 2},
  /** The crash sound from this closing speed (m/s). */
  impactSfx: 1.5,
  /** The viewmodel lowers / comes back over this (s). */
  holsterTime: 0.3,
  /** Refusal notes at most every noteEvery s. */
  noteEvery: 2.5,
  /** Model fetch wait behind the loading screen (ms). */
  modelWaitMs: 8000,
  /** (lane CAR2) The tyre skid: a hard brake / handbrake begun above skidSpeed (m/s), at most every skidEvery s. */
  skidSpeed: 6,
  skidEvery: 1.2,
  /** (lane CAR2) The engine's sound position (car frame: under the bonnet). */
  engineAt: {x: 0, y: 0.75, z: -1.5},
} as const;

export const CAR_TEXT = {
  getIn: '<b>[E]</b> Get in',
  driving: '<b>[W]</b> drive · <b>[S]</b> brake / reverse · <b>[A]</b> <b>[D]</b> steer · <b>[Space]</b> handbrake · <b>[E]</b> get out · <b>[F]</b> lights',
  noRoom: 'No room to get out',
  slowDown: 'Stop the car to get out',
  hands: 'Hands on the wheel — get out first',
  placeRule: 'Not from the driver seat',
} as const;

/** The car's sound hook (sfxCarAudio maps it onto Sfx). */
export interface CarAudio {
  /** The engine: the driver got in (it starts with a short rev at the engine, world x / y / z) / the car is empty (it stops). */
  start(x: number, y: number, z: number): void;
  stop(): void;
  /** Every frame someone drives: speed 0..1 of the top speed, throttle 0..1, the engine's world position. */
  engine(speed01: number, throttle01: number, x: number, y: number, z: number): void;
  /** A tyre skid (a hard brake / handbrake turn at speed), at the car. */
  skid(x: number, y: number, z: number): void;
  /** A contact (closing m/s): the car body against the world, or a body it hit. */
  impact(x: number, y: number, z: number, speed: number, what: 'car' | 'flesh'): void;
  door(open: boolean, x: number, y: number, z: number): void;
}

type At = {x: number; y: number; z: number};
interface CarSfx {
  physImpact?(x: number, y: number, z: number, speed: number, family: 'prop' | 'flesh', mass?: number): void;
  carEngine?(speed01: number, throttle01: number, at?: At, o?: {rev?: boolean}): void;
  stopCarEngine?(): void;
  carSkid?(at?: At): boolean;
  carDoor?(at?: At): void;
  denied?(): void;
  click?(pitch?: number): void;
  impact?(x: number, y: number, z: number, surface: 'metal'): void;
}

/** The default CarAudio over Sfx: the Sound Lab car set (engine loops, skid, door) + the existing impact cues. */
export function sfxCarAudio(sfx: () => unknown): CarAudio {
  const s = () => (sfx() as CarSfx | null) ?? null;
  return {
    start(x, y, z) { s()?.carEngine?.(0, 0, {x, y, z}, {rev: true}); },
    stop() { s()?.stopCarEngine?.(); },
    engine(speed01, throttle01, x, y, z) { s()?.carEngine?.(speed01, throttle01, {x, y, z}); },
    skid(x, y, z) { s()?.carSkid?.({x, y, z}); },
    impact(x, y, z, speed, what) { s()?.physImpact?.(x, y, z, Math.min(5, speed), what === 'car' ? 'prop' : 'flesh', what === 'car' ? 1300 : 70); },
    door(_open, x, y, z) { s()?.carDoor?.({x, y, z}); },
  };
}

interface ZombieLike {
  brain: {x: number; y: number; z: number; hp: number; readonly alive: boolean; readonly climbing?: boolean; stats: {radius: number; height?: number};
    damage(amount: number, fromX: number, fromZ: number, fromY?: number, o?: {stagger?: boolean}): boolean};
  ragdolled?: boolean;
  root?: THREE.Object3D;
  syncTransform?(): void;
}

interface DynLike {
  walkers: (() => readonly {id: object; x: number; z: number; y: number; r: number; wake?: boolean}[]) | null;
  shootProp(prop: PropPlacement, index: number, point: THREE.Vector3, dir: THREE.Vector3, impulse: number): boolean;
  rayHits?(o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, maxT: number, pickups: readonly never[]): {point: THREE.Vector3; prop?: PropPlacement; propIndex?: number}[];
}

/** What the car needs from Game (structural: tests drive it with a fake host + the real Player / ZombieBrain). */
export interface SkywaysCarHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; vx: number; vz: number; vy: number; yaw: number; eye: number; radius: number; alive: boolean;
    climbing: boolean; grounded: boolean; speed: number; sprinting: boolean; stamina: number; bodyHeight?: number; readonly stanceEye?: number;
    justJumped: boolean; justLanded: boolean; landSpeed: number; justRung: boolean; justClimbed: boolean; justLetGo: boolean; stanceChanged: boolean};
  levels: Levels | null;
  propIndex: PropIndex | null;
  layout: StationLayout | null;
  zombies: readonly ZombieLike[];
  run: {laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, data: unknown): void};
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  state: string;
  frameHooks: ((dt: number) => void)[];
  interactHandlers: (() => boolean)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  warmRegistry: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  promptProviders?: (() => string | null)[];
  inputOwners?: (() => boolean)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  sectionPreloads?: ((layout: never) => Promise<void>)[];
  bulletHitHandlers?: ((wh: never, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[];
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  physics?: {dynamicItems: DynLike} | null;
  damage?: {hitWorld(wh: {t: number; kind: 'prop'; nx: number; ny: number; nz: number; prop: number; level: number}, point: THREE.Vector3, dir: THREE.Vector3, shot: {damage: number; pellet: boolean; weapon: string}): unknown} | null;
  gas?: {windows: {refs: ReadonlyMap<string, PaneRef>; broken(id: string): boolean} | null; breakPane(id: string): boolean} | null;
  blastKill?(z: never, dir: THREE.Vector3, point: THREE.Vector3): void;
  gear?: {placeRules?: ((x: number, y: number, z: number, level: number) => string | null)[]} | null;
  trainRide?: {riding: boolean} | null;
  fx?: {impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: 'metal', opts?: {decal?: boolean; chips?: number}): void} | null;
  /** Game's timed item use in progress (no getting in meanwhile). */
  use?: unknown;
}

/** Keys the driver uses (MoveInput-like; Game's Input also carries mousePressed). */
export interface DriveInput { down(code: string): boolean; hit(code: string): boolean; mousePressed?: readonly boolean[] }

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tn = new THREE.Vector3();
const near = new Set<number>();
const approach = (v: number, to: number, step: number): number => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export class SkywaysCar {
  /** The car's view root lives here (one car per world). */
  readonly root = new THREE.Group();
  readonly spec: CarSpec;
  /** The car's controller state (null: no car in this world). */
  body: CarBody | null = null;
  view: CarView | null = null;
  /** A car world is built (between this system's build and teardown hooks). */
  worldLive = false;
  /** The player is in the driver seat. */
  driving = false;
  /** The view's look yaw relative to the car (rad, clamped). */
  lookYaw = 0;
  /** 0 = the held item in its pose … 1 = lowered out of view (Game applies it to the viewmodel). */
  holster = 0;
  prompt: string | null = null;
  audio: CarAudio;
  /** Where the car came from this build ('record' | 'spawn'), QA. */
  source: 'record' | 'spawn' | null = null;
  /**
   * Task skyways-vehicle-20261107 (record v2): the car's own state kept with it at its station — its lamps on / off and the trunk's
   * slots (StackJSON, uids kept). Read at the build (a v1 / missing record: off / empty), written by store().
   */
  lights = false;
  trunkJSON: (StackJSON | null)[] = emptyTrunk();
  /** The live trunk (lane TRUNK's store) supplies the slots to store, when present. */
  trunkSource: (() => (StackJSON | null)[]) | null = null;
  /** QA / tests. */
  readonly counts = {builds: 0, teardowns: 0, enters: 0, exits: 0, exitRefused: 0, forced: 0, kills: 0, crushed: 0, pushes: 0, propKicks: 0,
    impacts: 0, panes: 0, propGlass: 0, stores: 0, bullets: 0, released: 0, notes: 0};
  lastImpact: CarImpact | null = null;
  /**
   * (lane VIS) The car's forward beam (world/skywaysCarLights.ts): created at the first car world's build, in the view group from each
   * build (before the warm-up) to its teardown; `lights` only sets its intensity (and the lenses' glow). Null: no car world built yet.
   */
  beam: CarBeam | null = null;
  readonly ctl: CarControls = {...NO_CONTROLS};
  private yawSeen = 0;
  private clock = 0;
  /** (lane CAR2) The skid's edge (a hard brake / handbrake was already on last frame) and the last skid's clock. */
  private skidding = false;
  private skidT = -Infinity;
  private noteT: number = CAR_RT.noteEvery;
  private readonly step: CarStep = {moved: 0, blocked: false, refused: false, impact: null};
  private readonly world: CarWorld = {levels: null as unknown as Levels, props: null};
  private dynIdx: Map<PropPlacement, number> | null = null;
  private glassIdx: Map<PropPlacement, number> | null = null;
  private readonly kickT = new WeakMap<PropPlacement, number>();
  private readonly glassT = new WeakMap<PropPlacement, number>();
  private readonly walkerIds: object[];
  private walkerBase: DynLike['walkers'] = null;
  private readonly walkerWrap = () => {
    const list = this.walkerBase?.() ?? [];
    return this.body && this.driving && Math.abs(this.body.v) > 0.3 ? [...list, ...this.walkers()] : list;
  };
  private readonly ownsInput = (): boolean => this.driving;
  private readonly box: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};

  constructor(readonly host: SkywaysCarHost, spec: CarSpec = CAR_SPEC) {
    this.spec = spec;
    this.root.name = 'skyways-car-root';
    this.audio = sfxCarAudio(() => this.host.sfx);
    this.walkerIds = spec.circles.map(() => ({}));
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Registration

  install(): this {
    const h = this.host;
    h.scene.add(this.root);
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.unshift(() => this.onInteract()); // first: while driving E always gets out
    h.promptProviders?.unshift(() => this.prompt);
    h.inputOwners?.push(this.ownsInput);
    h.stateListeners?.push(((s: string) => this.onState(s)) as (s: never, p: never) => void);
    h.sectionHooks.push({build: ((layout: StationLayout) => this.onBuild(layout)) as (l: never) => void, teardown: () => this.onTeardown()});
    h.sectionPreloads?.push(((layout: StationLayout) => (layout.skyways?.addon?.car
      ? Promise.race([loadSkywaysCarModel(this.spec).then(() => undefined), new Promise<void>(r => setTimeout(r, CAR_RT.modelWaitMs))])
      : Promise.resolve())) as (l: never) => Promise<void>);
    h.warmRegistry.addPool('skyways-car', () => (this.view ? [this.view.group] : []));
    h.bulletHitHandlers?.push(((wh: {t: number}, point: THREE.Vector3, dir: THREE.Vector3) => this.bulletHit(wh, point, dir)) as never);
    h.gear?.placeRules?.push(() => (this.driving ? CAR_TEXT.placeRule : null));
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle + persistence

  onBuild(layout: StationLayout): void {
    if (this.worldLive) this.onTeardown();
    const spawn = layout?.skyways?.addon?.car;
    const L = this.host.levels;
    if (!spawn || !L) { if (releaseSkywaysCarModel()) this.counts.released++; return; }
    const rec = this.readRecord();
    const ok = (p: {x: number; y: number; z: number; yaw: number; level: number}) => p.level >= 0 && p.level < L.count && footprintFloor(L, p.x, p.z, p.yaw, p.y, p.level, this.spec) !== null;
    const pose = rec && ok(rec) ? rec : spawn;
    // (record v2) the car's own state comes back with it even when its pose fell back to the spawn (never lost, never doubled)
    this.lights = rec?.lights ?? false;
    this.trunkJSON = rec ? structuredClone(rec.trunk) : emptyTrunk();
    this.source = pose === rec ? 'record' : 'spawn';
    const y = footprintFloor(L, pose.x, pose.z, pose.yaw, pose.y, pose.level, this.spec) ?? pose.y;
    this.body = {x: pose.x, y, z: pose.z, yaw: wrapAngle(pose.yaw), v: 0, steer: 0, level: pose.level, yawRate: 0};
    this.view = buildCarView(this.spec);
    this.view.group.name = 'skyways-car';
    if (this.view.standIn && typeof document !== 'undefined') console.warn('skyways car: the model is not loaded — a stand-in body is drawn');
    this.root.add(this.view.group);
    // (lane VIS) the beam joins this world now, before the warm-up (the view group is the 'skyways-car' warm pool): on / off from here
    // on is its intensity only — the scene's light set never changes during play
    this.beam ??= createCarBeam();
    attachCarBeam(this.beam, this.view.group);
    this.decorateView();
    this.syncView();
    // the layout props the car can shove (dynamic kinds) / shatter (glazed kinds), by their layout index (shootProp / hitWorld need it)
    this.dynIdx = new Map();
    this.glassIdx = new Map();
    layout.props.forEach((p, i) => {
      if (dynamicKind(p.kind)) this.dynIdx!.set(p, i);
      if (propDamageSpec(p.kind).glass?.on === 'shatter') this.glassIdx!.set(p, i);
    });
    // the moving car's circles shove loose props as walkers (contact wake + the walker shove); Game sets a fresh walker list per build
    const di = this.host.physics?.dynamicItems;
    if (di) {
      this.walkerBase = di.walkers === this.walkerWrap ? this.walkerBase : di.walkers;
      di.walkers = this.walkerWrap;
    }
    this.driving = false;
    this.holster = 0;
    this.worldLive = true;
    this.counts.builds++;
  }

  onTeardown(): void {
    if (!this.worldLive) return; // (idempotent)
    if (this.driving) this.forceOut('teardown', false);
    this.store();
    this.view?.group.removeFromParent();
    this.beam?.light.removeFromParent(); // (lane VIS) the next world has no car beam unless it builds a car
    this.beam?.target.removeFromParent();
    this.view = null;
    this.body = null;
    this.dynIdx = this.glassIdx = null;
    this.prompt = null;
    this.holster = 0;
    this.worldLive = false;
    this.audio.stop();
    this.counts.teardowns++;
  }

  /** The station's car record (valid, else null), as v2 (a v1 record: lamps off, an empty trunk). */
  readRecord(): SkywaysCarRecord | null {
    let raw: unknown;
    try { raw = this.host.run.laneStore(SKYWAYS_CAR_LANE); } catch { raw = undefined; }
    return raw !== undefined && skywaysCarProblem(raw) === null ? upgradeCarRecord(raw as SkywaysCarRecordV1 | SkywaysCarRecord) : null;
  }

  /** Where the car stands now -> this station's lane store. */
  store(): void {
    const b = this.body;
    if (!b || !this.worldLive) return;
    try {
      if (this.trunkSource) this.trunkJSON = this.trunkSource();
      this.host.run.setLaneStore(SKYWAYS_CAR_LANE, skywaysCarRecord(b.x, b.y, b.z, b.yaw, b.level, {lights: this.lights, trunk: this.trunkJSON}));
      this.counts.stores++;
    } catch (err) { console.warn('skyways car: storing the record failed', err); }
  }

  private onState(s: string): void {
    if (s === 'playing') return;
    this.prompt = null;
    Object.assign(this.ctl, NO_CONTROLS);
    if (this.driving && s !== 'paused' && s !== 'inventory') this.forceOut(s, true);
    this.store(); // (a save may follow)
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Enter / exit

  /** [E]: while driving, get out; else get in when aiming at the car by a door. */
  onInteract(): boolean {
    const h = this.host;
    if (!this.worldLive || !this.body || h.state !== 'playing') return false;
    if (this.driving) { this.tryExit(); return true; }
    if (!this.canEnter() || !this.pickAim()) return false;
    this.enter();
    return true;
  }

  canEnter(): boolean {
    const h = this.host, P = h.player;
    return P.alive && !P.climbing && !h.trainRide?.riding && !h.use && !(h.inputOwners ?? []).some(f => f !== this.ownsInput && f());
  }

  /** The car under the crosshair within reach, by a door, nothing structural in between (null: not). */
  pickAim(): {t: number} | null {
    const h = this.host, b = this.body, L = h.levels, S = this.spec, P = h.player;
    if (!b || !L) return null;
    // standing by a door (either side: the driver slides over to the left seat)
    const doors = [carToWorld(b.x, b.z, b.yaw, -S.width / 2, S.exits.left.z), carToWorld(b.x, b.z, b.yaw, S.width / 2, S.exits.right.z)];
    if (Math.min(...doors.map(d => Math.hypot(d.x - P.x, d.z - P.z))) > CAR_RT.doorReach) return null;
    h.camera.getWorldPosition(tv);
    h.camera.getWorldDirection(tv2);
    const lo = worldToCar(b.x, b.z, b.yaw, tv.x, tv.z), c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const ld = {x: tv2.x * c - tv2.z * s, y: tv2.y, z: tv2.x * s + tv2.z * c};
    const B = this.box;
    B.min.x = -S.width / 2; B.min.y = 0.1; B.min.z = -S.length / 2;
    B.max.x = S.width / 2; B.max.y = S.height; B.max.z = S.length / 2;
    const t = rayBox({x: lo.x, y: tv.y - b.y, z: lo.z}, ld, B, CAR_RT.enterReach);
    if (t === null) return null;
    const hit = {x: tv.x + tv2.x * t, y: tv.y + tv2.y * t, z: tv.z + tv2.z * t};
    if (!L.lineOfSight({x: tv.x, y: tv.y, z: tv.z}, hit, {slack: 0.15})) return null;
    return {t};
  }

  private enter(): void {
    const b = this.body!, P = this.host.player;
    this.driving = true;
    this.counts.enters++;
    this.lookYaw = clamp(wrapAngle(P.yaw - b.yaw), -CAR_RT.lookYaw, CAR_RT.lookYaw);
    this.yawSeen = b.yaw;
    b.v = 0; b.steer = 0; b.yawRate = 0;
    Object.assign(this.ctl, NO_CONTROLS);
    this.writePlayer(0);
    const d = carToWorld(b.x, b.z, b.yaw, -this.spec.width / 2, this.spec.exits.left.z);
    this.audio.door(true, d.x, b.y + 0.8, d.z);
    const en = this.enginePos();
    this.audio.start(en.x, en.y, en.z);
    this.skidding = false;
    this.prompt = CAR_TEXT.driving;
  }

  /** E while driving: out at the first free stand point once (nearly) stopped. */
  tryExit(): boolean {
    const b = this.body!;
    if (Math.abs(b.v) > CAR_RT.exitSpeed) { this.note(CAR_TEXT.slowDown); return false; }
    const spot = this.exitSpot();
    if (!spot) {
      this.counts.exitRefused++;
      this.host.hud.toast(CAR_TEXT.noRoom, true);
      (this.host.sfx as CarSfx | null)?.denied?.();
      return false;
    }
    this.leave(spot);
    return true;
  }

  /** The first stand point (left door, right door, front, back) a player circle fits on the car's storey floor, else null. */
  exitSpot(): {x: number; y: number; z: number; side: 'left' | 'right' | 'front' | 'back'} | null {
    const h = this.host, b = this.body, L = h.levels, S = this.spec, P = h.player;
    if (!b || !L) return null;
    const r = P.radius, gap = 0.55;
    const cands: [typeof S.exits.left, 'left' | 'right' | 'front' | 'back'][] = [
      [S.exits.left, 'left'], [S.exits.right, 'right'], [{x: 0, z: -S.length / 2 - gap}, 'front'], [{x: 0, z: S.length / 2 + gap}, 'back']];
    const seat = carToWorld(b.x, b.z, b.yaw, S.eye.x, S.eye.z);
    for (const [c, side] of cands) {
      const w = carToWorld(b.x, b.z, b.yaw, c.x, c.z);
      const s = L.supportIn(w.x, w.z, b.y, STEP_UP);
      if (!s || s.volume || s.level !== b.level || Math.abs(s.floor - b.y) > 0.3) continue;
      if (!L.circleClear(w.x, w.z, r, s.floor)) continue;
      const [rx, rz] = resolveCircle(L, h.propIndex, w.x, w.z, r, s.floor, STAND_EYE + 0.12);
      if (Math.hypot(rx - w.x, rz - w.z) > 1e-4) continue; // a prop there
      if (nearestCircle(S, b.x, b.z, b.yaw, w.x, w.z).d < r + 0.02) continue;
      if (!L.lineOfSight({x: seat.x, y: b.y + 0.9, z: seat.z}, {x: w.x, y: s.floor + 0.9, z: w.z}, {slack: 0.1})) continue;
      return {x: w.x, y: s.floor, z: w.z, side};
    }
    return null;
  }

  private leave(spot: {x: number; y: number; z: number}): void {
    const b = this.body!, P = this.host.player;
    this.driving = false;
    this.counts.exits++;
    P.x = spot.x; P.z = spot.z; P.y = spot.y;
    P.vx = P.vz = P.vy = 0;
    P.grounded = true;
    P.eye = P.y + (P.stanceEye ?? STAND_EYE);
    P.yaw = b.yaw + this.lookYaw;
    b.v = 0; b.steer = 0; b.yawRate = 0;
    Object.assign(this.ctl, NO_CONTROLS);
    this.prompt = null;
    this.store();
    this.audio.door(false, spot.x, b.y + 0.8, spot.z);
    this.audio.stop();
  }

  /** The player is out without asking (death, a state change, a teardown): the car parks; placed outside when alive and `place`. */
  forceOut(why: string, place: boolean): void {
    if (!this.driving) return;
    const spot = place && this.host.player.alive ? this.exitSpot() : null;
    if (spot) this.leave(spot);
    else {
      this.driving = false;
      const b = this.body;
      if (b) { b.v = 0; b.steer = 0; b.yawRate = 0; }
      Object.assign(this.ctl, NO_CONTROLS);
      this.audio.stop();
    }
    this.counts.forced++;
    void why;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Driving (Game.update's player slot while `driving`)

  /**
   * The driver's frame instead of Player.update: the look yaw relative to the car (the mouse already turned the world yaw), the
   * controls, loose props in the path, the car's step (collision, floor rule, impacts), then the player's world pose = the seat.
   * Returns false (no footsteps).
   */
  stepPlayer(dt: number, input: DriveInput): boolean {
    const h = this.host, b = this.body, P = h.player;
    if (!b || !h.levels || !this.worldLive) { this.forceOut('lost', true); return false; }
    this.lookYaw = clamp(wrapAngle(P.yaw - this.yawSeen), -CAR_RT.lookYaw, CAR_RT.lookYaw);
    const c = this.ctl;
    c.forward = input.down('KeyW') || input.down('ArrowUp');
    c.back = input.down('KeyS') || input.down('ArrowDown');
    c.left = input.down('KeyA') || input.down('ArrowLeft');
    c.right = input.down('KeyD') || input.down('ArrowRight');
    c.handbrake = input.down('Space');
    if (input.mousePressed?.[0] || input.hit('KeyR') || input.hit('KeyG') || input.hit('KeyT')) this.note(CAR_TEXT.hands);
    this.world.levels = h.levels;
    this.world.props = h.propIndex;
    this.kickProps(dt);
    const r = stepCar(b, this.world, this.spec, c, dt, this.step);
    if (r.impact) this.onImpact(r.impact);
    this.writePlayer(dt);
    return false;
  }

  /** The player's world pose = the driver's seat (feet on the car's floor, the eye at the seated eye), its view yaw relative to the car. */
  private writePlayer(dt: number): void {
    const b = this.body!, P = this.host.player, S = this.spec;
    const e = carToWorld(b.x, b.z, b.yaw, S.eye.x, S.eye.z);
    P.x = e.x; P.z = e.z; P.y = b.y;
    P.eye = b.y + S.eye.y;
    P.yaw = b.yaw + this.lookYaw;
    this.yawSeen = b.yaw;
    P.vx = -Math.sin(b.yaw) * b.v; P.vz = -Math.cos(b.yaw) * b.v; P.vy = 0;
    P.grounded = true;
    P.speed = 0; // (no walking bob / spread)
    P.sprinting = false;
    P.stamina = Math.min(100, P.stamina + 18 * dt);
    P.justJumped = P.justLanded = P.justRung = P.justClimbed = P.justLetGo = P.stanceChanged = false;
    P.landSpeed = 0;
  }

  /** Game.startUse: no item use while driving (true = refused, with the note). */
  refuseUse(): boolean {
    if (!this.driving) return false;
    this.note(CAR_TEXT.hands);
    return true;
  }

  private note(text: string): void {
    if (this.noteT < CAR_RT.noteEvery) return;
    this.noteT = 0;
    this.counts.notes++;
    this.host.hud.toast(text);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Per frame (after the zombies moved)

  frame(dt: number): void {
    const h = this.host, P = h.player, b = this.body, L = h.levels;
    if (!this.worldLive || !b || !L) { this.prompt = null; return; }
    this.clock += dt;
    this.noteT += dt;
    if (this.view && this.view.gen !== carModelsGen) { refreshCarView(this.view, this.spec); this.decorateView(); }
    if (this.driving && (!P.alive || h.trainRide?.riding)) this.forceOut('death', false);
    this.holster = clamp(this.holster + (this.driving ? 1 : -1) * dt / CAR_RT.holsterTime, 0, 1);
    this.world.levels = L;
    this.world.props = h.propIndex;
    this.zombieContacts(dt);
    if (!this.driving && P.alive && Math.abs(P.y - b.y) < 1.2) this.separatePlayer();
    this.syncView(dt);
    if (this.driving) this.driveAudio();
    if (this.driving) this.prompt = CAR_TEXT.driving;
    else this.prompt = h.state === 'playing' && this.canEnter() && this.pickAim() ? CAR_TEXT.getIn : null;
  }

  /** (lane CAR2) The engine's world position (CAR_RT.engineAt under the bonnet). */
  private enginePos(): {x: number; y: number; z: number} {
    const b = this.body!, A = CAR_RT.engineAt, p = carToWorld(b.x, b.z, b.yaw, A.x, A.z);
    return {x: p.x, y: b.y + A.y, z: p.z};
  }

  /**
   * (lane CAR2) The driver's sounds each frame: the engine (speed / the pedal held in the direction of travel), the tyre skid when a hard
   * brake (the pedal against the travel) or the handbrake BEGINS above CAR_RT.skidSpeed (at most every CAR_RT.skidEvery s).
   */
  private driveAudio(): void {
    const b = this.body!, c = this.ctl, v = b.v, stop = CAR_PHYS.stopSpeed;
    const throttle = (c.forward && v > -stop) || (c.back && v < stop) ? 1 : 0;
    const en = this.enginePos();
    this.audio.engine(Math.min(1, Math.abs(v) / CAR_PHYS.forwardMax), throttle, en.x, en.y, en.z);
    const hard = Math.abs(v) > CAR_RT.skidSpeed && (c.handbrake || (c.back && v > 0) || (c.forward && v < 0));
    if (hard && !this.skidding && this.clock - this.skidT >= CAR_RT.skidEvery) {
      this.skidT = this.clock;
      this.audio.skid(b.x, b.y + 0.3, b.z);
    }
    this.skidding = hard;
  }

  /** The view at the body's pose; the wheel follows the steering (eased with dt, at once without); (lane VIS) the lamps as `lights`. */
  private syncView(dt?: number): void {
    const v = this.view, b = this.body;
    if (!v || !b) return;
    const g = v.group;
    if (g.position.x !== b.x || g.position.y !== b.y || g.position.z !== b.z || g.rotation.y !== b.yaw) {
      g.position.set(b.x, b.y, b.z);
      g.rotation.set(0, b.yaw, 0);
      g.updateMatrixWorld(true);
    }
    setWheel(v, b.steer, dt);
    setCarLamps(this.lights, v.lens, this.beam);
  }

  /**
   * (lane VIS) Game's F key: while seated, the car's lamps on / off (a switch click) and the key is consumed — the personal flashlight is
   * left alone; otherwise false (F = the flashlight as ever). The state stays with the car (record v2 `lights`), also once parked.
   */
  onLightKey(): boolean {
    if (!this.driving || !this.worldLive || !this.body) return false;
    this.lights = !this.lights;
    setCarLamps(this.lights, this.view?.lens ?? null, this.beam);
    (this.host.sfx as CarSfx | null)?.click?.(this.lights ? 1.2 : 0.9);
    return true;
  }

  /** Shadows (the paint casts; the trim twins / glass / cockpit do not), the storey for the level culler. */
  private decorateView(): void {
    const v = this.view, b = this.body;
    if (!v || !b) return;
    this.host.atmosphere?.markShadows(v.group, false);
    v.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.level = b.level;
      if (m.userData.noShadow || m.userData.carPart === 'glass' || v.cockpit.getObjectById(m.id)) m.castShadow = false;
    });
  }

  /** The moving car's body circles as dynamicItems walkers (stable ids). */
  private walkers(): {id: object; x: number; z: number; y: number; r: number}[] {
    const b = this.body!, s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    return this.spec.circles.map((k, i) => ({id: this.walkerIds[i], x: b.x + k.z * s, z: b.z + k.z * c, y: b.y, r: k.r}));
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Zombies

  /** Same-storey bodies inside the car's circles: killed (fast), shoved out + slowing the car (slow), crushed when pinned. */
  private zombieContacts(dt: number): void {
    const h = this.host, b = this.body!, L = h.levels!, S = this.spec;
    const reach = S.length / 2 + 1;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), moving = this.driving && Math.abs(b.v) > 0.05;
    for (const z of h.zombies) {
      const q = z.brain;
      if (!q.alive || q.climbing || z.ragdolled || Math.abs(q.y - b.y) > CAR_RT.storeyY) continue;
      const r = q.stats.radius, dx = q.x - b.x, dz = q.z - b.z;
      if (dx * dx + dz * dz > (reach + r) ** 2) continue;
      const n = nearestCircle(S, b.x, b.z, b.yaw, q.x, q.z), overlap = r - n.d;
      if (overlap <= 0) continue;
      // the car's velocity at the contact (its turn included: ω x the offset from the footprint centre)
      const k = S.circles[n.i].r, px = n.cx + n.nx * k - b.x, pz = n.cz + n.nz * k - b.z;
      const vx = moving ? fx * b.v + b.yawRate * pz : 0, vz = moving ? fz * b.v - b.yawRate * px : 0;
      const closing = vx * n.nx + vz * n.nz;
      if (closing > CAR_RT.killSpeed) { this.kill(z, vx, vz, closing, false); continue; }
      const [nx, nz] = moveCircle(L, h.propIndex, q.x, q.z, n.nx * overlap, n.nz * overlap, r, q.y, q.stats.height ?? BODY_CLEAR);
      q.x = nx; q.z = nz;
      this.syncZombie(z);
      if (!moving || closing <= 0.05) continue;
      this.counts.pushes++;
      b.v = approach(b.v, 0, CAR_RT.pushDecel * dt);
      if (r - nearestCircle(S, b.x, b.z, b.yaw, q.x, q.z).d > CAR_RT.pinned) {
        // pinned against something while the car presses on: crushed (the car stalls against the body meanwhile)
        b.v *= 0.5;
        if (q.damage(CAR_RT.crushDps * dt, b.x, b.z, b.y, {stagger: false})) { this.counts.crushed++; this.kill(z, vx, vz, closing, true); }
      }
    }
  }

  /** The real kill path: the brain dies (a ram: by an overwhelming hit), Game.blastKill does the kill bookkeeping / cue / ragdoll. */
  private kill(z: ZombieLike, vx: number, vz: number, closing: number, dead: boolean): void {
    const h = this.host, q = z.brain, b = this.body!;
    if (!dead && !q.damage(q.hp + 1000, b.x, b.z, b.y, {stagger: false})) return;
    this.counts.kills++;
    const sp = Math.hypot(vx, vz);
    const dir = sp > 1e-4 ? new THREE.Vector3(vx / sp, 0.35, vz / sp).normalize() : new THREE.Vector3(q.x - b.x, 0.35, q.z - b.z).normalize();
    h.blastKill?.(z as never, dir, new THREE.Vector3(q.x, q.y + 1.0, q.z));
    if (!dead) b.v *= 1 - CAR_RT.killSlow;
    this.audio.impact(q.x, q.y + 0.8, q.z, closing, 'flesh');
  }

  private syncZombie(z: ZombieLike): void {
    if (z.ragdolled) return;
    z.syncTransform?.();
    if (z.root) z.root.position.y = z.brain.y;
  }

  /** The walking player never passes through the parked car (moved out through the world's collision; the velocity into it lost). */
  private separatePlayer(): void {
    const h = this.host, P = h.player, b = this.body!;
    for (let it = 0; it < 3; it++) { // (out of one circle can still leave it inside the next one along the body)
      const n = nearestCircle(this.spec, b.x, b.z, b.yaw, P.x, P.z), ov = P.radius - n.d;
      if (ov <= 1e-7) return;
      const [x, z] = moveCircle(h.levels!, h.propIndex, P.x, P.z, n.nx * (ov + 1e-6), n.nz * (ov + 1e-6), P.radius, P.y, P.bodyHeight);
      P.x = x; P.z = z;
      const into = -(P.vx * n.nx + P.vz * n.nz);
      if (into > 0) { P.vx += n.nx * into; P.vz += n.nz * into; }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Props, glass, bullets

  /** Dynamic floor props the body is about to meet go loose with a shove ∝ speed; loose ones in front are shoved again (bounded). */
  private kickProps(dt: number): void {
    const h = this.host, b = this.body!, di = h.physics?.dynamicItems, props = h.propIndex, S = this.spec;
    const sp = Math.abs(b.v);
    if (!di || !props || !this.dynIdx?.size || sp < 0.3) return;
    const sg = b.v >= 0 ? 1 : -1, fx = -Math.sin(b.yaw) * sg, fz = -Math.cos(b.yaw) * sg;
    const ahead = sp * Math.min(dt, CAR_PHYS.maxDt) + 0.15, cx = b.x + fx * ahead, cz = b.z + fz * ahead, R = S.length / 2 + 0.3;
    const dv = Math.min(MAX_SHOT_DV, CAR_RT.kick.gain * sp);
    let n = 0;
    for (const i of props.near(cx - R, cz - R, cx + R, cz + R, near)) {
      if (n >= CAR_RT.kick.perFrame) break;
      const pr = props.props[i], li = this.dynIdx.get(pr);
      if (li === undefined || pr.h <= 0.02 || pr.y > b.y + 0.5 || pr.y + pr.h < b.y + 0.05) continue;
      const qx = clamp(cx, pr.x - pr.hx, pr.x + pr.hx), qz = clamp(cz, pr.z - pr.hz, pr.z + pr.hz);
      const c = nearestCircle(S, cx, cz, b.yaw, qx, qz);
      // the box's nearest point to that circle, at the look-ahead pose
      const bx = clamp(c.cx, pr.x - pr.hx, pr.x + pr.hx), bz = clamp(c.cz, pr.z - pr.hz, pr.z + pr.hz);
      if (Math.hypot(bx - c.cx, bz - c.cz) > S.circles[c.i].r + 0.05) continue;
      if (this.clock - (this.kickT.get(pr) ?? -1e9) < CAR_RT.kick.cooldown) continue;
      tn.set(bx - c.cx, 0, bz - c.cz).normalize();
      const dir = tv2.set(fx * 0.75 + tn.x * 0.25, 0, fz * 0.75 + tn.z * 0.25).normalize();
      const point = tv.set(bx, clamp(b.y + 0.45, pr.y + 0.05, pr.y + pr.h), bz);
      if (di.shootProp(pr, li, point, dir, propPhysics(pr.kind).mass * dv)) { this.kickT.set(pr, this.clock); this.counts.propKicks++; n++; }
    }
    // loose props already in front (faster than the walker shove takes: CAR_RT.kick.rayAbove)
    if (sp < CAR_RT.kick.rayAbove || !di.rayHits || n >= CAR_RT.kick.perFrame) return;
    const k = S.circles.reduce((a, q) => (sg > 0 ? (q.z < a.z ? q : a) : (q.z > a.z ? q : a)));
    const lead = carToWorld(b.x, b.z, b.yaw, 0, k.z), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw), len = sp * dt + k.r + 0.4;
    for (const off of [-0.7, 0, 0.7]) {
      const o = {x: lead.x + rx * off * (S.width / 2), y: b.y + 0.5, z: lead.z + rz * off * (S.width / 2)};
      for (const hit of di.rayHits(o, {x: fx, y: 0, z: fz}, len, [])) {
        if (!hit.prop || hit.propIndex === undefined || n >= CAR_RT.kick.perFrame) continue;
        if (this.clock - (this.kickT.get(hit.prop) ?? -1e9) < CAR_RT.kick.cooldown) continue;
        if (di.shootProp(hit.prop, hit.propIndex, hit.point, tv2.set(fx, 0, fz), propPhysics(hit.prop.kind).mass * dv)) { this.kickT.set(hit.prop, this.clock); this.counts.propKicks++; n++; }
      }
    }
  }

  private onImpact(imp: CarImpact): void {
    const b = this.body!;
    this.lastImpact = {...imp};
    this.counts.impacts++;
    if (imp.speed >= CAR_RT.impactSfx) this.audio.impact(imp.x, b.y + 0.6, imp.z, imp.speed, 'car');
    if (imp.speed < CAR_RT.glassSpeed) return;
    this.breakPanes(imp);
    this.breakPropGlass(imp);
  }

  /** Skyways window panes at the contact (on the car's storey, within its height) break through the gas system (gas comes in). */
  private breakPanes(imp: CarImpact): void {
    const G = this.host.gas, W = G?.windows, b = this.body!;
    if (!G || !W) return;
    const hits: {id: string; d: number}[] = [];
    for (const [id, ref] of W.refs) {
      const p = ref.plan;
      if (p.level !== b.level || W.broken(id)) continue;
      if (ref.pane.y0 > b.y + this.spec.height || ref.pane.y1 < b.y + 0.2) continue;
      const along = p.along === 'x' ? imp.x : imp.z, across = p.along === 'x' ? imp.z : imp.x;
      const da = along < ref.pane.a0 ? ref.pane.a0 - along : along > ref.pane.a1 ? along - ref.pane.a1 : 0;
      const dc = Math.abs(across - p.glass);
      if (da > CAR_RT.paneReach || dc > CAR_RT.paneDepth) continue;
      const c = paneCentre(ref);
      hits.push({id, d: Math.hypot(c.x - imp.x, c.z - imp.z)});
    }
    hits.sort((a, c) => a.d - c.d);
    for (const x of hits.slice(0, CAR_RT.maxPanes)) if (G.breakPane(x.id)) this.counts.panes++;
  }

  /** A glazed prop at the contact (shop glazing, showcases …) takes the hit through the damage system (its glass shatters). */
  private breakPropGlass(imp: CarImpact): void {
    const h = this.host, b = this.body!, props = h.propIndex, dmg = h.damage;
    if (!props || !dmg || !this.glassIdx?.size) return;
    const R = 1.2;
    for (const i of props.near(imp.x - R, imp.z - R, imp.x + R, imp.z + R, near)) {
      const pr = props.props[i], li = this.glassIdx.get(pr);
      if (li === undefined || pr.h <= 0.02 || pr.y > b.y + this.spec.height || pr.y + pr.h < b.y + 0.1) continue;
      const qx = clamp(imp.x, pr.x - pr.hx, pr.x + pr.hx), qz = clamp(imp.z, pr.z - pr.hz, pr.z + pr.hz);
      if (Math.hypot(qx - imp.x, qz - imp.z) > 0.25) continue;
      if (this.clock - (this.glassT.get(pr) ?? -1e9) < CAR_RT.glassCooldown) continue;
      this.glassT.set(pr, this.clock);
      const dir = new THREE.Vector3(-imp.nx, 0, -imp.nz);
      for (const y of [0.6, 1.0]) {
        const py = clamp(b.y + y, pr.y + 0.05, pr.y + pr.h - 0.05);
        dmg.hitWorld({t: 0, kind: 'prop', nx: imp.nx, ny: 0, nz: imp.nz, prop: li, level: b.level}, new THREE.Vector3(qx, py, qz), dir,
          {damage: CAR_RT.glassDamage + CAR_RT.glassPerMs * imp.speed, pellet: false, weapon: 'vehicle'});
      }
      this.counts.propGlass++;
    }
  }

  /** A bullet whose world hit lies behind the car stops on its body (a metal impact; no crater behind). */
  bulletHit(wh: {t: number}, point: THREE.Vector3, dir: THREE.Vector3): boolean {
    const b = this.body, S = this.spec;
    if (!this.worldLive || !b || !(wh.t > 0)) return false;
    const ox = point.x - dir.x * wh.t, oy = point.y - dir.y * wh.t, oz = point.z - dir.z * wh.t;
    const lo = worldToCar(b.x, b.z, b.yaw, ox, oz), c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const ld = {x: dir.x * c - dir.z * s, y: dir.y, z: dir.x * s + dir.z * c};
    const B = this.box;
    B.min.x = -S.width / 2 + 0.06; B.min.y = 0.15; B.min.z = -S.length / 2 + 0.1;
    B.max.x = S.width / 2 - 0.06; B.max.y = S.height - 0.04; B.max.z = S.length / 2 - 0.1;
    const t = rayBox({x: lo.x, y: oy - b.y, z: lo.z}, ld, B, wh.t - 0.01);
    if (t === null) return false;
    const hit = new THREE.Vector3(ox + dir.x * t, oy + dir.y * t, oz + dir.z * t);
    this.host.fx?.impact(hit, new THREE.Vector3(-dir.x, -dir.y, -dir.z), 'metal', {decal: false, chips: 1});
    (this.host.sfx as CarSfx | null)?.impact?.(hit.x, hit.y, hit.z, 'metal');
    this.counts.bullets++;
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // QA

  /** QA readout. */
  state() {
    const b = this.body;
    return {
      worldLive: this.worldLive, driving: this.driving, source: this.source, prompt: this.prompt, holster: +this.holster.toFixed(3),
      body: b ? {x: +b.x.toFixed(3), y: +b.y.toFixed(3), z: +b.z.toFixed(3), yaw: +b.yaw.toFixed(4), v: +b.v.toFixed(3), steer: +b.steer.toFixed(3), level: b.level} : null,
      standIn: this.view?.standIn ?? null, lookYaw: +this.lookYaw.toFixed(4), lastImpact: this.lastImpact, counts: {...this.counts},
    };
  }

  /** QA / tests: is the body free in the world right now (no push needed)? */
  settled(): boolean {
    const b = this.body, L = this.host.levels;
    if (!b || !L) return false;
    const o = {x: 0, z: 0, sx: 0, sz: 0, circle: -1};
    return settlePose({levels: L, props: this.host.propIndex}, this.spec, b.x, b.z, b.yaw, b.y, o) && Math.hypot(o.sx, o.sz) < 1e-6;
  }
}

/** Installs the prize car (one call in the Game constructor; registries only + Game.update's player slot). */
export function installSkywaysCar(game: Game): SkywaysCar {
  return new SkywaysCar(game as unknown as SkywaysCarHost).install();
}
