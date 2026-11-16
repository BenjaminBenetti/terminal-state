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
// THE TRUNK (lane TRUNK, world/skywaysCarTrunk.ts through `rear`): the crosshair on the boot (the rear zone) while standing behind the car
// -> its prompt and [E] open the trunk view instead; anywhere else the doors rule above (the two stand zones never overlap).
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
// reuse existing cues (the metal crash, the flesh slap). Round 2 (task skyways-vehicle-20261107, lane AUDIO; audio/sfx.ts CAR_AUDIO has
// the root cause: the round-1 engine loops were sub-bass only): the engine START on getting in, mid-range engine loops rising with the
// speed / pedal, the reverse-gear whine while reversing, the brake-to-stop (CAR_SOUND), and Sfx.carImpact for the contacts.
//
// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): ONE CONTROLLER, PER-VEHICLE DEFINITIONS (world/skywaysCarVehicle.ts
// VehicleDef). Each world build picks the first registered definition whose spawn the layout has: CAR_DEF (the Skyways add-on's car:
// CAR_SPEC / CAR_RT / CAR_TEXT / CAR_PHYS, its record lane, model and lamps — exactly as before) or a definition another lane registers
// with addVehicle() (world/surface/truckVehicle.ts TRUCK_DEF: the Surface Run truck). Everything above (controls, enter / exit, the
// seat, collisions, run-over, prop shoves, glass, bullets, audio, persistence moments) is shared; the anchors, tuning, texts, record,
// model and lamps come from the definition. `enclosed` (seated in a closed cab), the attachment points (cargo) and the body transform /
// move listeners are generic seams; the car has no attachment points and is not enclosed.

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
import {STAMINA_PCT_PER_UNIT, STAMINA_REGEN, STAND_EYE} from '../player/player';
import {paneCentre, type PaneRef} from './windowBreach';
import {rayBox, type Box3Like} from './towerShared';
import {CAR_SPEC, carToWorld, worldToCar, type CarSpec} from './skywaysCarSpec';
import {CAR_PHYS, CAR_STAIRS, NO_CONTROLS, carPose, nearestCircle, settlePose, stepCar, wrapAngle, type CarBody, type CarControls, type CarImpact, type CarPhys, type CarPose, type CarStep, type CarWorld} from './skywaysCarPhysics';
import {SKYWAYS_CAR_LANE, emptyTrunk, skywaysCarProblem, skywaysCarRecord, upgradeCarRecord, type SkywaysCarRecord, type SkywaysCarRecordV1} from './skywaysCarStore';
import type {StackJSON} from '../items/inventory';
import {buildCarView, carModelsGen, loadSkywaysCarModel, refreshCarView, releaseSkywaysCarModel, setWheel, type CarView} from './skywaysCarModel';
import {attachCarBeam, createCarBeam, setCarLamps, type CarBeam} from './skywaysCarLights';
import type {VehicleAttachPoint, VehicleDef, VehicleRecordPose, VehicleRt, VehicleText, VehicleTransform} from './skywaysCarVehicle';

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

/**
 * (round 2, task skyways-vehicle-20261107, lane AUDIO) When driveAudio sounds the brake-to-stop: a brake (the pedal against the travel /
 * the handbrake) held from at least `brakeMin` m/s that brings the car under `brakeStopAt` m/s (once per stop; not when a crash did it);
 * its level = the speed it braked from / CAR_PHYS.forwardMax.
 */
export const CAR_SOUND = {brakeMin: 3, brakeStopAt: 1} as const;

/** The car's sound hook (sfxCarAudio maps it onto Sfx). */
export interface CarAudio {
  /** The engine: the driver got in (the engine START, then its idle, at the engine, world x / y / z) / the car is empty (it stops). */
  start(x: number, y: number, z: number): void;
  stop(): void;
  /**
   * Every frame someone drives: speed 0..1 of the top speed, throttle 0..1, the engine's world position, `reverse01` 0..1 of the reverse
   * top speed while reversing (0 otherwise).
   */
  engine(speed01: number, throttle01: number, x: number, y: number, z: number, reverse01?: number): void;
  /** A tyre skid (a hard brake / handbrake turn at speed), at the car. */
  skid(x: number, y: number, z: number): void;
  /** The brake-to-stop (a real brake brought the car to rest), at the car; strength 0..1 = the speed it braked from. */
  brake(x: number, y: number, z: number, strength01: number): void;
  /** A contact (closing m/s): the car body against the world, or a body it hit. */
  impact(x: number, y: number, z: number, speed: number, what: 'car' | 'flesh'): void;
  door(open: boolean, x: number, y: number, z: number): void;
}

type At = {x: number; y: number; z: number};
interface CarSfx {
  physImpact?(x: number, y: number, z: number, speed: number, family: 'prop' | 'flesh', mass?: number): void;
  carEngine?(speed01: number, throttle01: number, at?: At, o?: {rev?: boolean; reverse01?: number}): void;
  stopCarEngine?(): void;
  carSkid?(at?: At): boolean;
  carBrake?(at?: At, strength?: number): boolean;
  carImpact?(x: number, y: number, z: number, speed: number, what: 'car' | 'flesh'): boolean;
  carDoor?(at?: At): void;
  denied?(): void;
  click?(pitch?: number): void;
  impact?(x: number, y: number, z: number, surface: 'metal'): void;
}

/**
 * The default CarAudio over Sfx: the Sound Lab car set (the engine channel with its start / reverse whine, skid, brake stop, door, the
 * car's own impact cue) — an Sfx without carImpact falls back to the generic prop / flesh contact cues.
 */
export function sfxCarAudio(sfx: () => unknown): CarAudio {
  const s = () => (sfx() as CarSfx | null) ?? null;
  return {
    start(x, y, z) { s()?.carEngine?.(0, 0, {x, y, z}, {rev: true}); },
    stop() { s()?.stopCarEngine?.(); },
    engine(speed01, throttle01, x, y, z, reverse01 = 0) { s()?.carEngine?.(speed01, throttle01, {x, y, z}, reverse01 > 0 ? {reverse01} : undefined); },
    skid(x, y, z) { s()?.carSkid?.({x, y, z}); },
    brake(x, y, z, strength01) { s()?.carBrake?.({x, y, z}, strength01); },
    impact(x, y, z, speed, what) {
      const f = s();
      if (f?.carImpact) f.carImpact(x, y, z, speed, what);
      else f?.physImpact?.(x, y, z, Math.min(5, speed), what === 'car' ? 'prop' : 'flesh', what === 'car' ? 1300 : 70);
    },
    door(_open, x, y, z) { s()?.carDoor?.({x, y, z}); },
  };
}

/**
 * (lane TRUCK) The Skyways car as a vehicle definition: its spec (the physics steps the spec itself: CAR_PHYS, the stairs rule), CAR_RT,
 * CAR_TEXT, the 'skyways.car' record (v2; a v1 record upgrades: lamps off, an empty trunk), its model / lamps — every value as before.
 */
export function carDef(spec: CarSpec): VehicleDef {
  return {
    id: 'car',
    name: 'skyways-car',
    spec,
    geom: spec,
    rt: CAR_RT,
    text: CAR_TEXT,
    enclosed: false,
    spawnOf: layout => layout?.skyways?.addon?.car ?? null,
    model: {
      load: s => loadSkywaysCarModel(s),
      release: releaseSkywaysCarModel,
      build: s => buildCarView(s),
      refresh: (v, s) => refreshCarView(v, s),
      gen: () => carModelsGen,
      sync: (v, b, dt) => setWheel(v, b.steer, dt),
    },
    lamps: {createBeam: createCarBeam, set: setCarLamps},
    record: {
      lane: SKYWAYS_CAR_LANE,
      read: (raw: unknown): VehicleRecordPose | null => (raw !== undefined && skywaysCarProblem(raw) === null ? upgradeCarRecord(raw as SkywaysCarRecordV1 | SkywaysCarRecord) : null),
      load(car, rec) {
        const r = rec as SkywaysCarRecord | null;
        // (record v2) the car's own state comes back with it even when its pose fell back to the spawn (never lost, never doubled)
        car.lights = r?.lights ?? false;
        car.trunkJSON = r ? structuredClone(r.trunk) : emptyTrunk();
      },
      write(car, b) {
        if (car.trunkSource) car.trunkJSON = car.trunkSource();
        return skywaysCarRecord(b.x, b.y, b.z, b.yaw, b.level, {lights: car.lights, trunk: car.trunkJSON});
      },
    },
  };
}

/** The Skyways car's definition (the controller's default vehicle). */
export const CAR_DEF: VehicleDef = carDef(CAR_SPEC);

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

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tn = new THREE.Vector3(), tq = new THREE.Quaternion();
const near = new Set<number>();
const approach = (v: number, to: number, step: number): number => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export class SkywaysCar {
  /** The car's view root lives here (one car per world). */
  readonly root = new THREE.Group();
  /** (lane TRUCK) The vehicle of this world (the last built; the car's until another vehicle's world is built) and the registered ones. */
  private def: VehicleDef;
  private readonly vehicles: VehicleDef[];
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
  /**
   * (lane TRUNK) The trunk at the car's rear (world/skywaysCarTrunk.ts): when the crosshair is on the rear zone from behind the car,
   * its prompt shows and [E] opens it instead of the doors rule (one action per press; never while seated: E gets out first).
   */
  rear: {aimed(): boolean; interact(): boolean; readonly prompt: string} | null = null;
  /**
   * (lane TRUCK) More [E] targets on the parked vehicle, after `rear` (the truck's storage compartments: world/surface/truckStorage.ts):
   * the first aimed one's prompt shows and [E] opens it instead of the doors rule; each is inert on a vehicle it does not belong to.
   */
  readonly access: {aimed(): boolean; interact(): boolean; readonly prompt: string}[] = [];
  /**
   * (lane TRUCK) The vehicle's storage compartments' slots (StackJSON, uids kept), read from its record at the build; the live store
   * (storageSource) supplies them whenever the record is written. Empty for a vehicle without compartments (the car: its trunk above).
   */
  storageJSON: (StackJSON | null)[][] = [];
  storageSource: (() => (StackJSON | null)[][]) | null = null;
  /** (lane TRUCK, the cargo seam) Called with the body transform whenever the vehicle's pose changes (no allocation per call: reused). */
  readonly moveListeners: ((t: Readonly<VehicleTransform>) => void)[] = [];
  /** (lane TRUCK, the cargo seam) Whether a cargo owner holds an attachment point (the owner sets it; absent = all free). */
  attachOccupied: ((id: string) => boolean) | null = null;
  /** QA / tests. */
  readonly counts = {builds: 0, teardowns: 0, enters: 0, exits: 0, exitRefused: 0, forced: 0, kills: 0, crushed: 0, pushes: 0, propKicks: 0,
    impacts: 0, panes: 0, propGlass: 0, stores: 0, bullets: 0, released: 0, notes: 0};
  lastImpact: CarImpact | null = null;
  /**
   * (lane VIS) The car's forward beam (world/skywaysCarLights.ts): created at the first car world's build, in the view group from each
   * build (before the warm-up) to its teardown; `lights` only sets its intensity (and the lenses' glow). Null: no car world built yet.
   */
  beam: CarBeam | null = null;
  /** (lane TRUCK) One beam per vehicle definition (each a stable light for its visits' programs); `beam` = this world's. */
  private readonly beams = new Map<VehicleDef, CarBeam>();
  /** (lane TRUCK) Where the view was last synced (the wheels roll by the distance along the heading since) and the reused transform. */
  private syncedAt: {x: number; z: number} | null = null;
  private readonly xf: VehicleTransform = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, level: 0};
  readonly ctl: CarControls = {...NO_CONTROLS};
  private yawSeen = 0;
  private clock = 0;
  /** (lane CAR2) The skid's edge (a hard brake / handbrake was already on last frame) and the last skid's clock. */
  private skidding = false;
  private skidT = -Infinity;
  /** (round 2, lane AUDIO) The top speed of the brake in progress (0: none) — the brake-to-stop's trigger and level. */
  private brakeFrom = 0;
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
    this.def = spec === CAR_SPEC ? CAR_DEF : carDef(spec);
    this.vehicles = [this.def];
    this.root.name = 'skyways-car-root';
    this.audio = sfxCarAudio(() => this.host.sfx);
    this.walkerIds = spec.circles.map(() => ({}));
  }

  /** (lane TRUCK) This world's vehicle anchors (the car's until another vehicle's world is built). */
  get spec(): CarSpec {
    return this.def.spec;
  }

  /** (lane TRUCK) This world's vehicle tuning: the runtime rules, the texts, the physics. */
  get rt(): VehicleRt {
    return this.def.rt;
  }

  get text(): VehicleText {
    return this.def.text;
  }

  private get phys(): CarPhys {
    return this.def.geom.phys ?? CAR_PHYS;
  }

  /** (lane TRUCK) Which vehicle stands in this world ('car' | 'truck'; null: none). */
  get vehicle(): VehicleDef['id'] | null {
    return this.worldLive && this.body ? this.def.id : null;
  }

  /** (lane TRUCK, for lane AIR) The player is seated in a closed cab (the truck; never the car). */
  get enclosed(): boolean {
    return this.driving && this.worldLive && this.def.enclosed;
  }

  /** (lane TRUCK) Registers another vehicle (picked at a build whose layout has its spawn; the first match wins). Idempotent. */
  addVehicle(def: VehicleDef): this {
    if (!this.vehicles.includes(def)) this.vehicles.push(def);
    return this;
  }

  /** The registered vehicle a layout has (null: none). */
  private defFor(layout: StationLayout | null): VehicleDef | null {
    for (const d of this.vehicles) if (d.spawnOf(layout)) return d;
    return null;
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
    h.sectionPreloads?.push(((layout: StationLayout) => {
      const d = this.defFor(layout); // (lane TRUCK: the layout's vehicle; the car's as before)
      return d
        ? Promise.race([d.model.load(d.spec).then(() => undefined), new Promise<void>(r => setTimeout(r, d.rt.modelWaitMs))])
        : Promise.resolve();
    }) as (l: never) => Promise<void>);
    h.warmRegistry.addPool('skyways-car', () => (this.view ? [this.view.group] : []));
    h.bulletHitHandlers?.push(((wh: {t: number}, point: THREE.Vector3, dir: THREE.Vector3) => this.bulletHit(wh, point, dir)) as never);
    h.gear?.placeRules?.push(() => (this.driving ? this.text.placeRule : null));
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle + persistence

  onBuild(layout: StationLayout): void {
    if (this.worldLive) this.onTeardown();
    // (lane TRUCK) this layout's vehicle (the car: layout.skyways.addon.car as before); the other vehicles' models are released
    const def = this.defFor(layout);
    const spawn = def?.spawnOf(layout);
    const L = this.host.levels;
    if (!def || !spawn || !L) { this.releaseModels(null); return; }
    this.releaseModels(def);
    this.def = def;
    const rec = this.readRecord();
    // (stairs) a stored pose may stand on a flight: tried flat, then up / down a flight's pitch ((lane TRUCK) a vehicle that never takes
    // a flight: flat only)
    const pitches = def.geom.stairs === false ? [0] : CAR_STAIRS.loadPitches;
    const fit = (p: {x: number; y: number; z: number; yaw: number; level: number}): CarPose | null => {
      if (p.level < 0 || p.level >= L.count) return null;
      for (const pitch of pitches) { const q = carPose(L, p.x, p.z, p.yaw, p.y, pitch, p.level, def.geom); if (q) return q; }
      return null;
    };
    const fromRec = rec ? fit(rec) : null;
    const pose = fromRec ? rec! : spawn;
    def.record.load(this, rec); // (record v2: the car's lamps + trunk; the truck's lamps + compartments)
    this.source = pose === rec ? 'record' : 'spawn';
    const at = fromRec ?? fit(spawn);
    this.body = {x: pose.x, y: at?.y ?? pose.y, z: pose.z, yaw: wrapAngle(pose.yaw), v: 0, steer: 0, level: at?.level ?? pose.level, yawRate: 0, pitch: at?.pitch ?? 0};
    this.view = def.model.build(this.spec);
    this.view.group.name = def.name;
    if (this.view.standIn && typeof document !== 'undefined') console.warn(`${def.name.replace('-', ' ')}: the model is not loaded — a stand-in body is drawn`);
    this.root.add(this.view.group);
    // (lane VIS) the beam joins this world now, before the warm-up (the view group is the 'skyways-car' warm pool): on / off from here
    // on is its intensity only — the scene's light set never changes during play ((lane TRUCK) one beam per vehicle definition)
    let beam = this.beams.get(def);
    if (!beam) { beam = def.lamps.createBeam(); this.beams.set(def, beam); }
    this.beam = beam;
    attachCarBeam(this.beam, this.view.group);
    this.syncedAt = null;
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

  /** (lane TRUCK) The registered vehicles' models other than `keep`'s are released (a world without them); counted once per build. */
  private releaseModels(keep: VehicleDef | null): void {
    let released = false;
    for (const d of this.vehicles) if (d !== keep && d.model.release()) released = true;
    if (released) this.counts.released++;
  }

  /** The station's vehicle record (valid, else null); the car's as v2 (a v1 record: lamps off, an empty trunk). */
  readRecord(): VehicleRecordPose | null {
    let raw: unknown;
    try { raw = this.host.run.laneStore(this.def.record.lane); } catch { raw = undefined; }
    return this.def.record.read(raw);
  }

  /** Where the vehicle stands now -> this station's (section's) lane store. */
  store(): void {
    const b = this.body;
    if (!b || !this.worldLive) return;
    try {
      this.host.run.setLaneStore(this.def.record.lane, this.def.record.write(this, b));
      this.counts.stores++;
    } catch (err) { console.warn(`${this.def.name.replace('-', ' ')}: storing the record failed`, err); }
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

  /** [E]: while driving, get out; else the trunk when aiming at its rear zone from behind (lane TRUNK); else get in when aiming at the car by a door. */
  onInteract(): boolean {
    const h = this.host;
    if (!this.worldLive || !this.body || h.state !== 'playing') return false;
    if (this.driving) { this.tryExit(); return true; }
    if (this.rear?.aimed() && this.rear.interact()) return true;
    for (const a of this.access) if (a.aimed() && a.interact()) return true; // (lane TRUCK: the truck's storage compartments)
    if (!this.canEnter() || !this.pickAim()) return false;
    this.enter();
    return true;
  }

  /** (lane TRUCK) The aimed [E] target on the parked vehicle (the trunk first, then the access list), else null. */
  private aimedAccess(): {readonly prompt: string} | null {
    if (this.rear?.aimed()) return this.rear;
    for (const a of this.access) if (a.aimed()) return a;
    return null;
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
    if (Math.min(...doors.map(d => Math.hypot(d.x - P.x, d.z - P.z))) > this.rt.doorReach) return null;
    h.camera.getWorldPosition(tv);
    h.camera.getWorldDirection(tv2);
    const lo = worldToCar(b.x, b.z, b.yaw, tv.x, tv.z), c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const ld = {x: tv2.x * c - tv2.z * s, y: tv2.y, z: tv2.x * s + tv2.z * c};
    const B = this.box;
    B.min.x = -S.width / 2; B.min.y = 0.1; B.min.z = -S.length / 2;
    B.max.x = S.width / 2; B.max.y = S.height; B.max.z = S.length / 2;
    const t = rayBox({x: lo.x, y: tv.y - b.y, z: lo.z}, ld, B, this.rt.enterReach);
    if (t === null) return null;
    const hit = {x: tv.x + tv2.x * t, y: tv.y + tv2.y * t, z: tv.z + tv2.z * t};
    if (!L.lineOfSight({x: tv.x, y: tv.y, z: tv.z}, hit, {slack: 0.15})) return null;
    return {t};
  }

  private enter(): void {
    const b = this.body!, P = this.host.player;
    this.driving = true;
    this.counts.enters++;
    this.lookYaw = clamp(wrapAngle(P.yaw - b.yaw), -this.rt.lookYaw, this.rt.lookYaw);
    this.yawSeen = b.yaw;
    b.v = 0; b.steer = 0; b.yawRate = 0;
    Object.assign(this.ctl, NO_CONTROLS);
    this.writePlayer(0);
    const d = carToWorld(b.x, b.z, b.yaw, -this.spec.width / 2, this.spec.exits.left.z);
    this.audio.door(true, d.x, b.y + 0.8, d.z);
    const en = this.enginePos();
    this.audio.start(en.x, en.y, en.z);
    this.skidding = false;
    this.brakeFrom = 0;
    this.prompt = this.text.driving;
  }

  /** E while driving: out at the first free stand point once (nearly) stopped. */
  tryExit(): boolean {
    const b = this.body!;
    if (Math.abs(b.v) > this.rt.exitSpeed) { this.note(this.text.slowDown); return false; }
    const spot = this.exitSpot();
    if (!spot) {
      this.counts.exitRefused++;
      this.host.hud.toast(this.text.noRoom, true);
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
    const seat = carToWorld(b.x, b.z, b.yaw, S.eye.x, S.eye.z), tp = Math.tan(b.pitch ?? 0), onFlight = Math.abs(b.pitch ?? 0) > 1e-4;
    for (const [c, side] of cands) {
      const w = carToWorld(b.x, b.z, b.yaw, c.x, c.z);
      // (stairs) the body line's height there: beside / ahead of / behind a car on a flight the stand point is on the flight's floor
      const hl = b.y - c.z * tp;
      const s = L.supportIn(w.x, w.z, hl + 0.05, STEP_UP);
      if (!s || s.volume || (!onFlight && s.level !== b.level) || Math.abs(s.floor - hl) > (onFlight ? 0.45 : 0.3)) continue;
      if (!L.circleClear(w.x, w.z, r, s.floor)) continue;
      const [rx, rz] = resolveCircle(L, h.propIndex, w.x, w.z, r, s.floor, STAND_EYE + 0.12);
      if (Math.hypot(rx - w.x, rz - w.z) > 1e-4) continue; // a prop there
      if (nearestCircle(S, b.x, b.z, b.yaw, w.x, w.z).d < r + 0.02) continue;
      if (!L.lineOfSight({x: seat.x, y: b.y - S.eye.z * tp + 0.9, z: seat.z}, {x: w.x, y: s.floor + 0.9, z: w.z}, {slack: 0.1})) continue;
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
    this.lookYaw = clamp(wrapAngle(P.yaw - this.yawSeen), -this.rt.lookYaw, this.rt.lookYaw);
    const c = this.ctl;
    c.forward = input.down('KeyW') || input.down('ArrowUp');
    c.back = input.down('KeyS') || input.down('ArrowDown');
    c.left = input.down('KeyA') || input.down('ArrowLeft');
    c.right = input.down('KeyD') || input.down('ArrowRight');
    c.handbrake = input.down('Space');
    if (input.mousePressed?.[0] || input.hit('KeyR') || input.hit('KeyG') || input.hit('KeyT')) this.note(this.text.hands);
    this.world.levels = h.levels;
    this.world.props = h.propIndex;
    this.kickProps(dt);
    const r = stepCar(b, this.world, this.def.geom, c, dt, this.step); // (lane TRUCK: the vehicle's geometry + tuning; the car's = its spec)
    if (r.impact) this.onImpact(r.impact);
    this.writePlayer(dt);
    return false;
  }

  /** The player's world pose = the driver's seat (feet on the car's floor, the eye at the seated eye), its view yaw relative to the car. */
  private writePlayer(dt: number): void {
    const b = this.body!, P = this.host.player, S = this.spec;
    // (stairs) the seat rides the body's pitch: the eye (car frame) turned about the car's lateral axis, then the yaw
    const p = b.pitch ?? 0, cp = Math.cos(p), sp = Math.sin(p);
    const ez = S.eye.y * sp + S.eye.z * cp, e = carToWorld(b.x, b.z, b.yaw, S.eye.x, ez);
    P.x = e.x; P.z = e.z; P.y = b.y - S.eye.z * sp;
    P.eye = b.y + S.eye.y * cp - S.eye.z * sp;
    P.yaw = b.yaw + this.lookYaw;
    this.yawSeen = b.yaw;
    P.vx = -Math.sin(b.yaw) * b.v; P.vz = -Math.cos(b.yaw) * b.v; P.vy = 0;
    P.grounded = true;
    P.speed = 0; // (no walking bob / spread)
    P.sprinting = false;
    P.stamina = Math.min(100, P.stamina + STAMINA_REGEN * STAMINA_PCT_PER_UNIT * dt); // (the ordinary recovery: player.ts reserve units)
    P.justJumped = P.justLanded = P.justRung = P.justClimbed = P.justLetGo = P.stanceChanged = false;
    P.landSpeed = 0;
  }

  /**
   * (stairs) Game.updateCamera's hook: while seated, the view pitches with the car's body (on a flight the cockpit and the view tilt
   * together; the player's own look is relative to it). No-op out of the car / on flat floor.
   */
  tiltCamera(camera: THREE.Camera): void {
    const b = this.body;
    if (!this.driving || !b) return;
    const p = b.pitch ?? 0;
    if (Math.abs(p) < 1e-5) return;
    // a turn of `p` about the car's lateral axis (world: its +X turned by the yaw), applied on top of the look
    tq.setFromAxisAngle(tv.set(Math.cos(b.yaw), 0, -Math.sin(b.yaw)), p);
    camera.quaternion.premultiply(tq);
  }

  /** Game.startUse: no item use while driving (true = refused, with the note). */
  refuseUse(): boolean {
    if (!this.driving) return false;
    this.note(this.text.hands);
    return true;
  }

  private note(text: string): void {
    if (this.noteT < this.rt.noteEvery) return;
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
    if (this.view && this.view.gen !== this.def.model.gen()) { this.def.model.refresh(this.view, this.spec); this.decorateView(); }
    if (this.driving && (!P.alive || h.trainRide?.riding)) this.forceOut('death', false);
    this.holster = clamp(this.holster + (this.driving ? 1 : -1) * dt / this.rt.holsterTime, 0, 1);
    this.world.levels = L;
    this.world.props = h.propIndex;
    this.zombieContacts(dt);
    if (!this.driving && P.alive && Math.abs(P.y - b.y) < 1.2) this.separatePlayer();
    this.syncView(dt);
    if (this.driving) this.driveAudio();
    if (this.driving) this.prompt = this.text.driving;
    else if (h.state !== 'playing' || !this.canEnter()) this.prompt = null;
    else { const a = this.aimedAccess(); this.prompt = a ? a.prompt : this.pickAim() ? this.text.getIn : null; } // (the trunk; (lane TRUCK) the compartments)
  }

  /** (lane CAR2) The engine's world position (the vehicle's rt.engineAt: the car's under the bonnet). */
  private enginePos(): {x: number; y: number; z: number} {
    const b = this.body!, A = this.rt.engineAt, p = carToWorld(b.x, b.z, b.yaw, A.x, A.z);
    return {x: p.x, y: b.y + A.y, z: p.z};
  }

  /**
   * (lane CAR2) The driver's sounds each frame: the engine (speed / the pedal held in the direction of travel; round 2: + how fast it
   * reverses — the gearbox whine), the tyre skid when a hard brake (the pedal against the travel) or the handbrake BEGINS above
   * rt.skidSpeed (at most every rt.skidEvery s), (round 2) the brake-to-stop when a brake from >= CAR_SOUND.brakeMin brings the
   * car under CAR_SOUND.brakeStopAt (once per stop; a crash that stopped it already sounded).
   */
  private driveAudio(): void {
    const b = this.body!, c = this.ctl, v = b.v, sp = Math.abs(v), stop = this.phys.stopSpeed;
    const throttle = (c.forward && v > -stop) || (c.back && v < stop) ? 1 : 0;
    const en = this.enginePos();
    this.audio.engine(Math.min(1, sp / this.phys.forwardMax), throttle, en.x, en.y, en.z, v < -stop ? Math.min(1, sp / this.phys.reverseMax) : 0);
    const hard = sp > this.rt.skidSpeed && (c.handbrake || (c.back && v > 0) || (c.forward && v < 0));
    if (hard && !this.skidding && this.clock - this.skidT >= this.rt.skidEvery) {
      this.skidT = this.clock;
      this.audio.skid(b.x, b.y + 0.3, b.z);
    }
    this.skidding = hard;
    const braking = c.handbrake || (c.back && v > stop) || (c.forward && v < -stop);
    const crashed = !!this.step.impact && this.step.impact.speed >= this.rt.impactSfx;
    if (sp > CAR_SOUND.brakeStopAt) this.brakeFrom = braking && !crashed ? Math.max(this.brakeFrom, sp) : 0;
    else if (this.brakeFrom > 0) {
      if (this.brakeFrom >= CAR_SOUND.brakeMin && !crashed) this.audio.brake(b.x, b.y + 0.3, b.z, Math.min(1, this.brakeFrom / this.phys.forwardMax));
      this.brakeFrom = 0;
    }
  }

  /** The view at the body's pose; the wheel follows the steering (eased with dt, at once without); (lane VIS) the lamps as `lights`. */
  private syncView(dt?: number): void {
    const v = this.view, b = this.body;
    if (!v || !b) return;
    const g = v.group;
    const pitch = b.pitch ?? 0;
    let changed = false;
    if (g.position.x !== b.x || g.position.y !== b.y || g.position.z !== b.z || g.rotation.y !== b.yaw || g.rotation.x !== pitch) {
      g.position.set(b.x, b.y, b.z);
      g.rotation.set(pitch, b.yaw, 0, 'YXZ'); // (stairs: the yaw, then the pitch about the car's own lateral axis; nose -Z up for > 0)
      g.updateMatrixWorld(true);
      changed = true;
    }
    // (lane TRUCK) the distance along the heading since the last sync (the road wheels roll by it; the car's wheels are static)
    const at = this.syncedAt, moved = at ? (b.x - at.x) * -Math.sin(b.yaw) + (b.z - at.z) * -Math.cos(b.yaw) : 0;
    if (at) { at.x = b.x; at.z = b.z; } else this.syncedAt = {x: b.x, z: b.z};
    this.def.model.sync(v, b, dt, moved);
    this.def.lamps.set(this.lights, v.lens, this.beam);
    if (changed && this.moveListeners.length) { const t = this.transform()!; for (const f of this.moveListeners) f(t); }
  }

  /** (lane TRUCK, the cargo seam) The vehicle body's world transform (reused object; null: no vehicle in this world). */
  transform(): Readonly<VehicleTransform> | null {
    const b = this.body;
    if (!b || !this.worldLive) return null;
    const t = this.xf;
    t.x = b.x; t.y = b.y; t.z = b.z; t.yaw = b.yaw; t.pitch = b.pitch ?? 0; t.level = b.level;
    return t;
  }

  /** (lane TRUCK, for lane CARGO) The truck's body transform (null: no truck in this world). */
  truckTransform(): Readonly<VehicleTransform> | null {
    return this.vehicle === 'truck' ? this.transform() : null;
  }

  /**
   * (lane TRUCK, the cargo seam) The vehicle's secure attachment points in the world (the body's pose, its pitch included): id, the
   * point on the load floor, its yaw, size (w across / d along / h clear) and whether a cargo owner holds it (attachOccupied). Empty
   * without a vehicle or for one without points (the car). A fresh list per call (not per frame: read on demand).
   */
  attachPoints(): VehicleAttachPoint[] {
    const b = this.body, A = this.def.attach;
    if (!b || !this.worldLive || !A) return [];
    const pt = b.pitch ?? 0, cp = Math.cos(pt), sp = Math.sin(pt), occ = this.attachOccupied;
    return A.map(a => {
      const p = carToWorld(b.x, b.z, b.yaw, a.x, a.y * sp + a.z * cp);
      return {id: a.id, x: p.x, y: b.y + a.y * cp - a.z * sp, z: p.z, yaw: wrapAngle(b.yaw + a.yaw), w: a.w, d: a.d, h: a.h, occupied: occ ? occ(a.id) : false};
    });
  }

  /** (lane TRUCK, for lane CARGO) The truck's attachment points (empty: no truck in this world). */
  truckAttachPoints(): VehicleAttachPoint[] {
    return this.vehicle === 'truck' ? this.attachPoints() : [];
  }

  /**
   * (lane VIS) Game's F key: while seated, the car's lamps on / off (a switch click) and the key is consumed — the personal flashlight is
   * left alone; otherwise false (F = the flashlight as ever). The state stays with the car (record v2 `lights`), also once parked.
   */
  onLightKey(): boolean {
    if (!this.driving || !this.worldLive || !this.body) return false;
    this.lights = !this.lights;
    this.def.lamps.set(this.lights, this.view?.lens ?? null, this.beam);
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

  /** The moving car's body circles as dynamicItems walkers (stable ids; (lane TRUCK) more ids as a vehicle with more circles needs, circles off the centre line). */
  private walkers(): {id: object; x: number; z: number; y: number; r: number}[] {
    const b = this.body!, s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    return this.spec.circles.map((k, i) => {
      const kx = k.x ?? 0;
      return {id: (this.walkerIds[i] ??= {}), x: b.x + kx * c + k.z * s, z: b.z - kx * s + k.z * c, y: b.y, r: k.r};
    });
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
      if (!q.alive || q.climbing || z.ragdolled) continue;
      const r = q.stats.radius, dx = q.x - b.x, dz = q.z - b.z;
      // (stairs) the same storey = near the body line's height at the body (on a flight it rises along the car)
      if (Math.abs(q.y - (b.y - worldToCar(b.x, b.z, b.yaw, q.x, q.z).z * Math.tan(b.pitch ?? 0))) > this.rt.storeyY) continue;
      if (dx * dx + dz * dz > (reach + r) ** 2) continue;
      const n = nearestCircle(S, b.x, b.z, b.yaw, q.x, q.z), overlap = r - n.d;
      if (overlap <= 0) continue;
      // the car's velocity at the contact (its turn included: ω x the offset from the footprint centre)
      const k = S.circles[n.i].r, px = n.cx + n.nx * k - b.x, pz = n.cz + n.nz * k - b.z;
      const vx = moving ? fx * b.v + b.yawRate * pz : 0, vz = moving ? fz * b.v - b.yawRate * px : 0;
      const closing = vx * n.nx + vz * n.nz;
      if (closing > this.rt.killSpeed) { this.kill(z, vx, vz, closing, false); continue; }
      const [nx, nz] = moveCircle(L, h.propIndex, q.x, q.z, n.nx * overlap, n.nz * overlap, r, q.y, q.stats.height ?? BODY_CLEAR);
      q.x = nx; q.z = nz;
      this.syncZombie(z);
      if (!moving || closing <= 0.05) continue;
      this.counts.pushes++;
      b.v = approach(b.v, 0, this.rt.pushDecel * dt);
      if (r - nearestCircle(S, b.x, b.z, b.yaw, q.x, q.z).d > this.rt.pinned) {
        // pinned against something while the car presses on: crushed (the car stalls against the body meanwhile)
        b.v *= 0.5;
        if (q.damage(this.rt.crushDps * dt, b.x, b.z, b.y, {stagger: false})) { this.counts.crushed++; this.kill(z, vx, vz, closing, true); }
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
    if (!dead) b.v *= 1 - this.rt.killSlow;
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
    const ahead = sp * Math.min(dt, this.phys.maxDt) + 0.15, cx = b.x + fx * ahead, cz = b.z + fz * ahead, R = S.length / 2 + 0.3;
    const dv = Math.min(MAX_SHOT_DV, this.rt.kick.gain * sp);
    let n = 0;
    for (const i of props.near(cx - R, cz - R, cx + R, cz + R, near)) {
      if (n >= this.rt.kick.perFrame) break;
      const pr = props.props[i], li = this.dynIdx.get(pr);
      if (li === undefined || pr.h <= 0.02 || pr.y > b.y + 0.5 || pr.y + pr.h < b.y + 0.05) continue;
      const qx = clamp(cx, pr.x - pr.hx, pr.x + pr.hx), qz = clamp(cz, pr.z - pr.hz, pr.z + pr.hz);
      const c = nearestCircle(S, cx, cz, b.yaw, qx, qz);
      // the box's nearest point to that circle, at the look-ahead pose
      const bx = clamp(c.cx, pr.x - pr.hx, pr.x + pr.hx), bz = clamp(c.cz, pr.z - pr.hz, pr.z + pr.hz);
      if (Math.hypot(bx - c.cx, bz - c.cz) > S.circles[c.i].r + 0.05) continue;
      if (this.clock - (this.kickT.get(pr) ?? -1e9) < this.rt.kick.cooldown) continue;
      tn.set(bx - c.cx, 0, bz - c.cz).normalize();
      const dir = tv2.set(fx * 0.75 + tn.x * 0.25, 0, fz * 0.75 + tn.z * 0.25).normalize();
      const point = tv.set(bx, clamp(b.y + 0.45, pr.y + 0.05, pr.y + pr.h), bz);
      if (di.shootProp(pr, li, point, dir, propPhysics(pr.kind).mass * dv)) { this.kickT.set(pr, this.clock); this.counts.propKicks++; n++; }
    }
    // loose props already in front (faster than the walker shove takes: this.rt.kick.rayAbove)
    if (sp < this.rt.kick.rayAbove || !di.rayHits || n >= this.rt.kick.perFrame) return;
    const k = S.circles.reduce((a, q) => (sg > 0 ? (q.z < a.z ? q : a) : (q.z > a.z ? q : a)));
    const lead = carToWorld(b.x, b.z, b.yaw, 0, k.z), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw), len = sp * dt + k.r + 0.4;
    for (const off of [-0.7, 0, 0.7]) {
      const o = {x: lead.x + rx * off * (S.width / 2), y: b.y + 0.5, z: lead.z + rz * off * (S.width / 2)};
      for (const hit of di.rayHits(o, {x: fx, y: 0, z: fz}, len, [])) {
        if (!hit.prop || hit.propIndex === undefined || n >= this.rt.kick.perFrame) continue;
        if (this.clock - (this.kickT.get(hit.prop) ?? -1e9) < this.rt.kick.cooldown) continue;
        if (di.shootProp(hit.prop, hit.propIndex, hit.point, tv2.set(fx, 0, fz), propPhysics(hit.prop.kind).mass * dv)) { this.kickT.set(hit.prop, this.clock); this.counts.propKicks++; n++; }
      }
    }
  }

  private onImpact(imp: CarImpact): void {
    const b = this.body!;
    this.lastImpact = {...imp};
    this.counts.impacts++;
    if (imp.speed >= this.rt.impactSfx) this.audio.impact(imp.x, b.y + 0.6, imp.z, imp.speed, 'car');
    if (imp.speed < this.rt.glassSpeed) return;
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
      if (da > this.rt.paneReach || dc > this.rt.paneDepth) continue;
      const c = paneCentre(ref);
      hits.push({id, d: Math.hypot(c.x - imp.x, c.z - imp.z)});
    }
    hits.sort((a, c) => a.d - c.d);
    for (const x of hits.slice(0, this.rt.maxPanes)) if (G.breakPane(x.id)) this.counts.panes++;
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
      if (this.clock - (this.glassT.get(pr) ?? -1e9) < this.rt.glassCooldown) continue;
      this.glassT.set(pr, this.clock);
      const dir = new THREE.Vector3(-imp.nx, 0, -imp.nz);
      for (const y of [0.6, 1.0]) {
        const py = clamp(b.y + y, pr.y + 0.05, pr.y + pr.h - 0.05);
        dmg.hitWorld({t: 0, kind: 'prop', nx: imp.nx, ny: 0, nz: imp.nz, prop: li, level: b.level}, new THREE.Vector3(qx, py, qz), dir,
          {damage: this.rt.glassDamage + this.rt.glassPerMs * imp.speed, pellet: false, weapon: 'vehicle'});
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
      vehicle: this.vehicle, enclosed: this.enclosed, lights: this.lights, // (lane TRUCK)
    };
  }

  /** QA / tests: is the body free in the world right now (no push needed)? */
  settled(): boolean {
    const b = this.body, L = this.host.levels;
    if (!b || !L) return false;
    const o = {x: 0, z: 0, sx: 0, sz: 0, circle: -1};
    return settlePose({levels: L, props: this.host.propIndex}, this.def.geom, b.x, b.z, b.yaw, b.y, o) && Math.hypot(o.sx, o.sz) < 1e-6;
  }
}

/** Installs the prize car (one call in the Game constructor; registries only + Game.update's player slot). */
export function installSkywaysCar(game: Game): SkywaysCar {
  return new SkywaysCar(game as unknown as SkywaysCarHost).install();
}
