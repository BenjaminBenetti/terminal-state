// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): THE TRAIN EQUIPMENT IN THE WORLD — the crafted chests and devices as
// physical, persistent, travelling things (craft/equipment.ts records, craft/equipmentApi.ts EquipmentSystemLike). The sibling of the
// fuel carts (world/fuelCarts.ts is the structural template): the same kinematic controller (world/fuelCartPhysics.ts), the same cargo
// capture / release through a ride, the same ownership rule. Installs itself through the Game's registries only (frameHooks,
// interactHandlers, promptProviders, inputOwners, modifierSources, hitListeners, stateListeners, sectionHooks, sectionPreloads,
// bulletHitHandlers, warmRegistry) and attaches the train record's live hook (craft/equipment.ts TrainEquipment.live).
//
// ONE MECHANISM FOR EVERY KIND: everything below reads a kind's TRAITS (EquipmentDef: move / plug / slots / ammoCap / kg / radius /
// height) — no list of kinds anywhere in this file.
//
// A UNIT: uid ('eq-<n>'), kind, a CartBody (its own kg / r / h; a 'carry' kind slides on its base: EQUIP.slideDecel), a mode
// ('world' | 'cargo' | 'held'), its plug, its hopper rounds, its store (run/trainLockbox.ts TrainLockbox(def.slots): the live slots the
// store view and the bench use) and its view (world/trainEquipmentModel.ts).
//  - 'dolly' kinds (the devices: a module on the fuel dolly's hand truck) MOVE AND STOP LIKE THE FUEL DOLLY — the same controller calls
//    with the same constants (FUEL_CART / CART): E on the frame / handle grabs (the hand point, the slow walk, the input owner, the
//    let-go reasons, the break distance), walking into one pushes it, it sleeps, goes up and down stairs, lies on the steps, rides lifts
//    (carry / anyAt), stops bullets (a metal impact, a shove by mass). Heavier = slower (bodyPushTop / the grip's acceleration cap).
//  - 'carry' kinds (the chest): E TAP = its use (the store view: lane BENCH registers uses.chest) — with no use registered a tap picks it
//    up —, E HELD EQUIP_HOLD_S = pick it up (always). In the hands: mode 'held' (no body in the world), drawn low in front of the camera,
//    the hands busy (input owner, the held item lowered: Game reads `holster`; no reload / item use: `carrying` / refuseUse), a slow walk
//    (EQUIP.carry.speedMult, no sprint), never picked up or put down on a ladder; E puts it down on FREE FLOOR in front of the player
//    (the controller's own tests: floor under the footprint, no wall / prop / unit / fuel cart / player overlap, a clear way to the spot)
//    facing the player, else "No room to put it down here" and it stays in the hands. A hit does not drop it; death puts it down at the
//    player's feet. On the floor it is pushed slowly (EQUIP.slideMax), stops at once and is never walked through.
//  - Units and fuel carts keep apart (separateCarts); the player never stands inside one (separatePlayer). ONE thing is grabbed at a
//    time across fuel carts + equipment (E while a unit is grabbed / carried is this system's first: interactHandlers.unshift).
//
// AIM / E: pickAim() = the unit + part under the crosshair: a dolly kind's 'module' (the console face: the module's +Z face inside the
// measured face band) or 'frame' (anything else of it); a carry kind's 'body'. Frame -> grab. Module -> uses[kind]: with `hold`, a TAP
// (released before EQUIP_HOLD_S) calls tap(u) on the release and holding calls hold(u) once; without `hold`, tap(u) fires on the press;
// a false answer (or no use) -> grab. Prompts: the use's prompt(u), else the defaults (EQUIPMENT_TEXT). While the train rides there is
// no interaction with units (v1): prompts null.
//
// PLUGS (craft/trainFixtures.ts: three sockets): a plug-kind unit AT REST (asleep, not grabbed), wholly inside the PARKED car, within
// PLUG.reach of a FREE socket connects to the nearest: unit.plug, the cable (one pooled tube per plug) and the green lamp, the
// plugListeners, a toast and the hose-connect cue. It unplugs when grabbed, when it leaves the reach / the car, when it is removed.
// Evaluated only for awake / just-settled units (a unit at rest costs a flag test). The plug is kept while riding as cargo and across
// save / load / Retry / travel: a record's plug is restored when still free and in reach, else derived again. Never two units on one
// plug; a station unit is never plugged. plugged(kind) = the lowest plug's unit (parked or riding); active(kind) = plugged AND the car
// parked in a live world. plugListeners fire on EVERY change of a unit's plug (also a restored plug, a plugged unit leaving with its
// world); toasts / the cue only for changes the player caused in the live world.
//
// OWNERSHIP / CARGO / PERSISTENCE (the fuel carts' rule, one mechanism for every kind): a world unit wholly inside the PARKED car
// (fuel/trainPort.ts cartAboard with its own radius), riding cargo, pending records and the chest in the hands are the TRAIN's
// (TrainEquipment.live.aboard(): train-local records, saved with the 'player-train' participant); every other unit lies in the STATION
// (STATION_EQUIPMENT_LANE = {v: 1, here}: world pose + storey, never a plug; written at this system's teardown and by flush()).
//  - A ride starting (phase closing / departing; also captureCargo()): the units aboard become CARGO on the car's view root at their
//    train-local poses (the cables are train-local too), their footprints go into the ride's collision model (setRideCargoBoxes
//    'train-equipment'); once the ride stopped they are released at the NEW placement.
//  - departBlock(): a unit straddling the car's outline, more than EQUIPMENT_LIMITS.aboard aboard (or more than .station left behind).
//  - Teardown: train units -> pending records (TrainEquipment.setAboard), station units -> the lane (deleted when none). Build: the
//    lane's units, then the pending train units inside the parked car (clamped into the interior, nudged apart when two overlap).
//  - restore(aboard) (TrainEquipment.load / reset: Load, Continue, Retry, New Game): idempotent, before or after a world: the old train
//    units (the chest in the hands too) go, the records wait for a world; a uid clash is won by the train's record. After a restore /
//    build the inventory's uid counter is reserved above every chest's stacks (host.inv.reserveUids).
//
// CRAFT (lane BENCH calls it): craftBlock(kind) / craft(kind) — the car parked in a live world, fewer than EQUIPMENT_LIMITS.aboard
// aboard, the first PHYSICALLY FREE spot of craftSpots(def.radius): a new, empty, unplugged unit with the run's next uid, facing the
// aisle, asleep. storesAboard(): the chests standing wholly inside the parked car.
//
// PERFORMANCE: units far from the player and at rest cost a distance test; the pair loops only look at pairs with one awake; views share
// geometry / materials (cloned models, shared stand-ins); the cables rewrite fixed geometry in place only when an end moved; a hidden
// prototype of every kind + both lamp materials is warmed with the station (pool 'train-equipment'); no allocation per frame at rest.
// LIMITS (v1, documented): enemies walk through units (no nav / body collision, like the fuel carts); a train door closes through a
// unit standing in the doorway (a departure is refused while one straddles); no interaction with units while the train rides; a
// carried chest can poke into a wall the player stands against (like the carried body); the roll cue is the fuel dolly's one channel.
//
// Prop rules (root CLAUDE.md): every kind is loose and movable (rule 2: pushed, grabbed / carried, shot); the chest is storage that
// opens (rule 1) with finite, remembered, never-refilled contents (crafted EMPTY; exactly what the player puts in); no loose items are
// baked into a view (rule 4); the plug sockets are anchored wall fixtures (rule 3).

import * as THREE from 'three';
import type {Game} from '../game';
import type {Levels} from '../gen/levels';
import type {PropPlacement} from '../gen/props';
import {moveCircle, type PropIndex} from '../core/physics';
import {
  EQUIPMENT, EQUIPMENT_KINDS, EQUIPMENT_LIMITS, STATION_EQUIPMENT_LANE, copyEquipment, equipmentProblem, equipmentSeqOf, isEquipmentKind, freshEquipment,
  stationEquipmentOf, type EquipmentDef, type EquipmentJSON, type EquipmentKind, type StationEquipmentJSON, type TrainEquipment,
} from '../craft/equipment';
import {EQUIP_HOLD_S, type EquipmentStore, type EquipmentSystemLike, type EquipmentUnit, type EquipmentUse} from '../craft/equipmentApi';
import {PLUG, craftSpots, plugInReach} from '../craft/trainFixtures';
import {cartAboard, cartStraddles} from '../fuel/trainPort';
import {playerTrainPlacement, trainSpawnLocal, trainToWorld, type TrainPlacement} from '../gen/playerTrain';
import type {ItemStack} from '../items/inventory';
import {SPRINT_SPEED, WALK_SPEED} from '../player/player';
import {TrainLockbox} from '../run/trainLockbox';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {insideInterior, setRideCargoBoxes, type RideLocalModel} from './trainRideLocal';
import {rayBox, rayCylinder, type Box3Like, type P3} from './towerShared';
import {
  CART, bodyMass, bodyRadius, cartFloorAt, cartRestPose, footprintFloor, pushByPlayer, separateCarts, separatePlayer, stepCart, turnToward,
  wrapYaw, type CartBody, type CartPose, type CartTarget, type CartWorld,
} from './fuelCartPhysics';
import {CART_LOOK, loadCartModels} from './fuelCartModel';
import {FUEL_CART, rideCargoColumn, type CartBodyRef} from './fuelCarts';
import {
  EQUIPMENT_LID_TIME, EquipmentLook, buildPlugFixtures, equipmentBox, equipmentMaterials, poseEquipmentLid, setPlugLamp, shapePlugCable,
  type EquipmentView, type PlugFixtures,
} from './trainEquipmentModel';

/** Tuning (one place). Everything a dolly kind shares with the fuel dolly is READ from FUEL_CART / CART, never copied. */
export const EQUIP = {
  /** Aim reach (eye -> the hit point, m): a dolly's frame / handle (grab); its console face and a chest (use / carry). */
  grabReach: FUEL_CART.grabReach,
  useReach: FUEL_CART.drumReach,
  /** A grabbed dolly: its centre this far in front of the player; let go beyond farDist; the walking speed while dragging. */
  hold: FUEL_CART.hold,
  farDist: FUEL_CART.farDist,
  speedMult: FUEL_CART.speedMult,
  /** Units farther than this from the player are not stepped (unless grabbed / moving) (m). */
  activeRange: FUEL_CART.activeRange,
  /** Seconds a captured cargo waits for a ride to start before it is released in place. */
  captureGrace: FUEL_CART.captureGrace,
  modelWaitMs: FUEL_CART.modelWaitMs,
  /** The ownership test's footprint radius is this much inside the collision circle (a unit resting against the lining is aboard). */
  ownMargin: 0.01,
  bulletImpulse: FUEL_CART.bulletImpulse,
  bulletMaxDv: FUEL_CART.bulletMaxDv,
  /** A 'carry' kind standing on the floor slides on its base: its free deceleration (m/s²) and the fastest a walking player shoves it (m/s). */
  slideDecel: 8,
  slideMax: 0.6,
  /** The chest in the hands. */
  carry: {
    /** Walking speed factor (a sprint is no faster). */
    speedMult: 0.7,
    /** The held item lowers / comes back over this (s). */
    holsterS: 0.25,
    /** Its footprint centre in the carry frame (camera space: +y up, -z forward; m) — low: only its top edge shows. */
    anchor: {x: 0, y: -0.8, z: -0.52},
    /** Share of the view's pitch it follows (the carried body's rule). */
    pitchFollow: 0.5,
    /** Put down: the footprint centre this far in front of the player (m, tried in order). */
    putAt: [0.9, 1.05, 1.2, 0.76],
    /** The way from the player to a put-down spot is swept with a circle of this radius (never through a wall / over a counter). */
    sweepR: 0.15,
  },
  /** The model sources are re-read every this many frames (a map read per kind). */
  pollEvery: 30,
} as const;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const EQUIPMENT_TEXT = {
  moving: 'Not while the train is moving',
  noTrain: 'There is no train here',
  noRoom: 'No room on the car floor — move something first',
  tooMany: (n: number, max: number) => `Too much equipment in the car (${n} of ${max}) — leave some at a station`,
  stationFull: (n: number, max: number) => `Too much equipment left in this station (${n} of ${max}) — take some aboard`,
  straddle: (the: string) => `${cap(the)} is in the doorway — push it all the way in or out`,
  pluggedIn: (name: string) => `${name} plugged in`,
  unplugged: (name: string) => `${name} unplugged`,
  pulled: (name: string) => `${name}: the cable pulled free`,
  stuck: (the: string) => `${cap(the)} is stuck — you let go`,
  handsFull: 'Your hands are full',
  noPutDown: 'No room to put it down here',
  ladder: 'Not on a ladder',
  grab: (the: string, note: string) => `<b>[E]</b> Grab ${the}${note}`,
  letGo: (the: string) => `<b>[E]</b> Let go of ${the}`,
  pluggedNote: ' · plugged in',
  plugHint: ' · roll it to a free plug',
  open: (the: string) => `<b>[E]</b> Open · hold <b>[E]</b> Carry ${the}`,
  carry: (the: string) => `<b>[E]</b> Carry ${the}`,
  holding: (the: string) => `<b>Hold [E]</b> Picking up ${the}…`,
  putDown: (the: string) => `<b>[E]</b> Put down ${the}`,
} as const;

interface TrainRuntimeLike {
  spec?: PlayerTrainSpec;
  train: {placement: TrainPlacement; col?: {statics?: readonly PropPlacement[]; doors?: readonly {leaves: readonly PropPlacement[]}[]}} | null;
  readonly view: {root: THREE.Object3D} | null;
  consoleAimed?: boolean;
  carPoint?(lx: number, ly: number, lz: number): P3 | null;
}
interface TrainRideLike {
  riding: boolean; moving: boolean; phase?: string; model?: RideLocalModel;
  /** The riding player in the car frame / the moving car's pose. */
  local?: {x: number; z: number};
  pose?: {yaw: number};
}
interface SectionKeyLike { level: string; section: string; station?: string }

/** What the system needs from Game (structural: tests drive it with a fake host + the real Player / train runtime / ride). */
export interface TrainEquipmentHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; vx: number; vz: number; yaw: number; pitch?: number; radius: number; alive: boolean; climbing: boolean; sprinting?: boolean; bodyHeight?: number};
  levels: Levels | null;
  propIndex: PropIndex | null;
  trainPlacement: TrainPlacement | null;
  trainRuntime?: TrainRuntimeLike | null;
  trainRide?: TrainRideLike | null;
  playerTrain: {equipment: TrainEquipment};
  /** The station lane (run/runState.ts lane stores: STATION_EQUIPMENT_LANE of the current station). */
  run?: {current: SectionKeyLike; laneStore?(lane: string, key?: never): unknown; setLaneStore?(lane: string, data: unknown, key?: never): void} | null;
  /** The inventory's uid counter stays above every chest's stacks. */
  inv?: {reserveUids?(max: number): void} | null;
  /** E held / released (the tap / hold rule); `clears` changes when the input was cleared (a menu). */
  input?: {down(code: string): boolean; clears?: number} | null;
  hud: {toast(text: string, warn?: boolean): void; setHoldRing?(progress: number | null): void};
  sfx: unknown;
  state: string;
  frameHooks: ((dt: number) => void)[];
  interactHandlers: (() => boolean)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  warmRegistry: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  promptProviders?: (() => string | null)[];
  inputOwners?: (() => boolean)[];
  modifierSources?: (() => {speedMult?: number})[];
  hitListeners?: ((hit: never) => void)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  sectionPreloads?: ((layout: never) => Promise<void>)[];
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  /** The level's lift: asked to park its car before the station's units are recorded at a teardown (the fuel carts' rule). */
  tower?: {parkCar?(): void} | null;
  bulletHitHandlers?: ((wh: never, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[];
  fx?: {impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: 'metal', opts?: {decal?: boolean; chips?: number}): void} | null;
  /** The cooked models (Game.propModels: the modules and the Lockbox load with the car). */
  propModels?: {get(key: string): {scene: THREE.Object3D} | undefined} | null;
  /** The fuel carts on the same controller (kept apart; one thing grabbed at a time). */
  fuelCarts?: {bodies?(): readonly CartBodyRef[]; grab?: unknown} | null;
  /** Other things the hands can be busy with (a pickup needs them free: the carried body's rule). */
  corpses?: {carrying?: boolean} | null;
  flareHold?: {active?: boolean} | null;
  skywaysCar?: {driving?: boolean} | null;
  vomit?: {active?: boolean} | null;
  aimOffset?: {pitch: number};
}

/** What Game hands over besides itself (its private parts). */
export interface TrainEquipmentDeps {
  /** Cancel a timed item use in progress (Game.cancelUse: nothing consumed) — the hands take a chest. */
  cancelUse?(reason: string): void;
}

interface EquipSfx {
  hoseConnect?(on: boolean): void;
  cartRoll?(speed01: number): void;
  denied?(): void;
  pickup?(): void;
  impact?(x: number, y: number, z: number, surface: string): void;
  bodyFall?(x: number, y: number, z: number, strength: number): void;
}

type Mode = 'world' | 'cargo' | 'held';
type AimPart = 'frame' | 'module' | 'body';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/**
 * A recorded yaw: wrapped, 4 decimals, and never beyond +-3.1415 — r4(PI) = 3.1416 lies past PI and would come back from the next
 * wrap with the other sign: a record written twice is the same record.
 */
const YAW_MAX = 3.1415;
const yawOut = (a: number): number => Math.max(-YAW_MAX, Math.min(YAW_MAX, r4(wrapYaw(a))));
const NO_MODS = Object.freeze({});
const DRAG_MODS = Object.freeze({speedMult: EQUIP.speedMult});
const CARRY_MODS = Object.freeze({speedMult: EQUIP.carry.speedMult});
const CARRY_SPRINT_MODS = Object.freeze({speedMult: (EQUIP.carry.speedMult * WALK_SPEED) / SPRINT_SPEED});
/** Frames a unit spawned without support waits for its column's surface (a lift's car) before it gives up (the fuel carts' rule). */
const SEAT_FRAMES = 240;
/** Two footprints nearer than their radii by more than this overlap (records are rounded: resting contact is not an overlap). */
const TOUCH = 0.005;

/** One live unit (EquipmentUnit for the other crafting systems; the rest is this system's). */
export class LiveUnit implements EquipmentUnit {
  readonly kind: EquipmentKind;
  /** The uid's number (the units' order). */
  readonly seq: number;
  mode: Mode = 'world';
  plug: number | null = null;
  ammo = 0;
  /** The storage (kinds with def.slots): the live slots, exactly a Lockbox-like store. */
  readonly store: TrainLockbox | null;
  /** World pose / motion (mode 'world'). */
  readonly body: CartBody;
  /** Train-local pose (mode 'cargo'). */
  readonly local = {x: 0, y: 0, z: 0, yaw: 0};
  awake = false;
  /** Its plug state must be looked at (it settled / was put somewhere / a plug came free). */
  plugCheck = true;
  /** The next connection is not the player's doing (a record's unit finding its plug again): no toast / cue. */
  quietPlug = true;
  /** The DRAWN pose over the body (steps / slopes) — the fuel carts' rest pose. */
  readonly pose: CartPose = {dy: 0, pitch: 0, roll: 0};
  poseSettled = false;
  poseHeld = false;
  readonly solved = {x: NaN, y: NaN, z: NaN, yaw: NaN};
  readonly drawn = {x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, roll: NaN};
  markedLevel = -1;
  unseated = 0;
  /** The lid: open fraction 0..1 moving toward its target. */
  lidT = 0;
  lidTarget: 0 | 1 = 0;
  /** Its meshes' castShadow before it was picked up. */
  flags: {mesh: THREE.Mesh; shadow: boolean}[] | null = null;

  constructor(private readonly sys: TrainEquipmentSystem, readonly uid: string, readonly def: EquipmentDef, readonly view: EquipmentView, at: {x: number; y: number; z: number; yaw: number; level: number}) {
    this.kind = def.kind;
    this.seq = equipmentSeqOf(uid);
    this.store = def.slots > 0 ? new TrainLockbox(def.slots) : null;
    this.body = {x: at.x, y: at.y, z: at.z, yaw: at.yaw, vx: 0, vz: 0, level: at.level, units: 0, kg: def.kg, r: def.radius, h: def.height};
    if (def.move === 'carry') this.body.decel = EQUIP.slideDecel;
  }

  get slots(): (ItemStack | null)[] | null { return this.store?.slots ?? null; }
  get storeVersion(): number { return this.store?.version ?? 0; }
  touchStore(): void { if (this.store) this.store.version++; }

  setAmmo(n: number): number {
    const c = this.def.ammoCap;
    this.ammo = c > 0 && Number.isFinite(n) ? Math.max(0, Math.min(c, Math.floor(n))) : 0;
    return this.ammo;
  }

  setOpen(open: boolean): void { this.sys.setLid(this, open); }
  worldPose(): {x: number; y: number; z: number; yaw: number; level: number} | null { return this.sys.poseOf(this); }
}

/** A readout of one unit (QA). */
export interface EquipmentReadout {
  uid: string; kind: EquipmentKind; mode: Mode | 'pending'; owner: 'train' | 'station'; plug: number | null; ammo: number; stacks: number;
  x: number; y: number; z: number; yaw: number; level: number;
}

export class TrainEquipmentSystem implements EquipmentSystemLike {
  readonly uses: Partial<Record<EquipmentKind, EquipmentUse>> = {};
  readonly plugListeners: ((u: EquipmentUnit, plugged: boolean) => void)[] = [];
  /** World units live under this group (cargo under the car's view root, the carried chest under `hands`). */
  readonly group = new THREE.Group();
  /** The carry frame: a child of the camera (follows the eye through every frame, the transit gap included). */
  readonly hands = new THREE.Group();
  readonly look: EquipmentLook;
  /** The plug sockets + cables: train-local, on the car's view root while there is one. */
  readonly fixtures: PlugFixtures;
  /** Live units (world + cargo + held), in spawn order. */
  private readonly list: LiveUnit[] = [];
  private sorted: LiveUnit[] | null = null;
  /** The train's units waiting for a world with a parked car (aboard records: train-local). */
  private pending: EquipmentJSON[] = [];
  /** A world is built (between this system's build and teardown hooks); the station it is (the lane's key). */
  worldLive = false;
  private here: {key: SectionKeyLike} | null = null;
  /** The grabbed dolly (null: none). */
  grab: {unit: LiveUnit; lag: number} | null = null;
  /** The chest in the hands (null: none). */
  held: LiveUnit | null = null;
  /** The held item's lowering while the hands carry (0..1; Game.update -> Viewmodel.setHolstered). */
  holster = 0;
  /** E pressed on a unit whose action waits for the release / the hold time. */
  private eHold: {unit: LiveUnit; part: AimPart; t: number; clears: number} | null = null;
  /** Captured cargo: whether a ride was seen, idle seconds without one, the ride model its footprints are in. */
  private captured: {sawRide: boolean; idle: number; swap: RideLocalModel | null} | null = null;
  /** The unit / part under the crosshair (this frame) and the prompt. */
  aim: {unit: LiveUnit; part: AimPart; t: number} | null = null;
  prompt: string | null = null;
  /** Plug index -> the unit connected; the taken indices (plugInReach). */
  private readonly owners: (LiveUnit | null)[];
  private readonly taken = new Set<number>();
  /** Lids in motion. */
  private readonly lids = new Set<LiveUnit>();
  /** QA / tests. */
  readonly counts = {spawned: 0, captured: 0, released: 0, grabs: 0, letGo: 0, pushes: 0, restores: 0, steps: 0, bullets: 0, carried: 0, seated: 0, poses: 0, plugged: 0, unplugged: 0, pickups: 0, putDowns: 0, refused: 0, crafted: 0, taps: 0, holds: 0, cables: 0};
  private proto: THREE.Group | null = null;
  private protoGen = -1;
  private pollIn = 0;
  private roll01 = 0;
  private readonly owner = (): boolean => !!this.grab || !!this.held || !!this.eHold;
  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly target: CartTarget = {x: 0, z: 0, vx: 0, vz: 0};
  private readonly boxScratch: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};
  private readonly world: CartWorld = {levels: null as unknown as Levels, props: null};
  private readonly poseScratch: CartPose = {dy: 0, pitch: 0, roll: 0};
  private readonly inv = new THREE.Matrix4();
  private readonly lo = new THREE.Vector3();
  private readonly ld = new THREE.Vector3();
  private readonly shot = new THREE.Vector3();
  private readonly q: P3 = {x: 0, y: 0, z: 0};
  private readonly axis = new THREE.Vector3(1, 0, 0);
  /** craft/trainFixtures.ts craftSpots per footprint radius (of `spotsSpec`). */
  private readonly spots = new Map<number, readonly {x: number; z: number}[]>();
  private spotsSpec: PlayerTrainSpec | null = null;

  constructor(readonly host: TrainEquipmentHost, private readonly deps: TrainEquipmentDeps = {}) {
    this.group.name = 'train-equipment';
    this.hands.name = 'train-equipment-carry';
    this.look = new EquipmentLook(() => this.host.propModels ?? null, this.spec);
    this.fixtures = buildPlugFixtures(this.spec);
    this.owners = this.fixtures.plugs.map(() => null);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Registration

  install(): this {
    const h = this.host;
    h.scene.add(this.group);
    h.camera.add(this.hands);
    // E / prompt WHILE a unit is grabbed / carried go first (E is only that unit's then: one thing in the hands at a time); the aimed
    // unit's after every other lane's (an aimed door / the Lockbox / a fuel cart in front wins)
    h.interactHandlers.unshift(() => this.onBusyInteract());
    h.promptProviders?.unshift(() => this.busyPrompt());
    h.interactHandlers.push(() => this.onInteract());
    h.promptProviders?.push(() => this.prompt);
    h.inputOwners?.push(this.owner);
    h.modifierSources?.push(() => this.modifier());
    h.frameHooks.push(dt => this.frame(dt));
    h.hitListeners?.push((() => { if (this.grab) this.letGo('hit'); }) as (hit: never) => void); // (a hit never drops the chest)
    h.stateListeners?.push(((s: string) => {
      if (s === 'playing') return;
      if (this.grab) this.letGo('menu');
      this.endHold();
      // (a death decided AFTER this frame's hook ran — a later lane's damage: Game stops updating, so the chest goes down here)
      if (this.held && !this.host.player.alive && !this.riding) this.dropHeld();
      this.aim = null;
      this.prompt = null;
      this.setRoll(0);
    }) as (s: never, p: never) => void);
    h.sectionHooks.push({build: () => this.onBuild(), teardown: () => this.onTeardown()});
    // the hand truck's model behind the loading screen of any station that parks the train (the modules / the Lockbox load with the car)
    h.sectionPreloads?.push(((layout: Parameters<typeof playerTrainPlacement>[0]) => (playerTrainPlacement(layout)
      ? Promise.race([loadCartModels().then(() => undefined), new Promise<void>(r => setTimeout(r, EQUIP.modelWaitMs))])
      : Promise.resolve())) as (layout: never) => Promise<void>);
    h.warmRegistry.addPool('train-equipment', () => this.warmRoots());
    h.bulletHitHandlers?.push(((wh: {t: number}, point: THREE.Vector3, dir: THREE.Vector3, _shot: number, damage: number) => this.bulletHit(wh, point, dir, damage)) as never);
    // (a record loaded BEFORE this system existed: its units are adopted — from here on the live units are the record's truth)
    const E = h.playerTrain.equipment, stored = E.live ? [] : E.records();
    E.live = {aboard: () => this.aboard(), restore: a => this.restore(a)};
    if (stored.length) this.restore(stored);
    return this;
  }

  private get rt(): TrainRuntimeLike | null { return this.host.trainRuntime ?? null; }
  private get ride(): TrainRideLike | null { return this.host.trainRide ?? null; }
  private get spec(): PlayerTrainSpec { return this.host.trainRuntime?.spec ?? PLAYER_TRAIN_SPEC; }
  private get sfx(): EquipSfx | null { return (this.host.sfx as EquipSfx | null) ?? null; }
  private get riding(): boolean { return !!this.ride?.riding; }

  /** The car's placement right now: the built train's, else the level's (a build in progress). */
  private placement(): TrainPlacement | null {
    return this.rt?.train?.placement ?? this.host.trainPlacement ?? null;
  }

  /** The car stands parked (built, not riding). */
  private parkedPlacement(): TrainPlacement | null {
    return this.riding ? null : this.rt?.train?.placement ?? null;
  }

  /** World -> train-local into the scratch point (no allocation). */
  private toLocal(p: TrainPlacement, x: number, y: number, z: number): P3 {
    const q = this.q;
    q.x = (x - p.x) * p.front; q.y = y - p.railTopY; q.z = (z - p.z) * p.front;
    return q;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // EquipmentSystemLike

  /** Every live unit (world + cargo + held), in uid order (the numbers of 'eq-<n>'). */
  units(): readonly LiveUnit[] {
    return (this.sorted ??= [...this.list].sort((a, b) => a.seq - b.seq));
  }

  /** A live unit by uid (QA / tests / the other lanes' lookups), or null. */
  unit(uid: string): LiveUnit | null {
    for (const u of this.list) if (u.uid === uid) return u;
    return null;
  }

  /** (The return types are the contract's: a subclass / a fake may answer with any EquipmentUnit.) */
  plugged(kind: EquipmentKind): EquipmentUnit | null {
    for (const u of this.owners) if (u && u.kind === kind) return u;
    return null;
  }

  active(kind: EquipmentKind): EquipmentUnit | null {
    if (!this.worldLive || !this.parkedPlacement()) return null;
    for (const u of this.owners) if (u && u.kind === kind && u.mode === 'world') return u;
    return null;
  }

  craftBlock(kind: EquipmentKind): string | null {
    if (!isEquipmentKind(kind)) return EQUIPMENT_TEXT.noRoom; // (a registry kind only: never an inherited key)
    const def = EQUIPMENT[kind];
    if (this.riding) return EQUIPMENT_TEXT.moving;
    const p = this.parkedPlacement();
    if (!this.worldLive || !p || !this.host.levels) return EQUIPMENT_TEXT.noTrain;
    const n = this.aboardCount();
    if (n >= EQUIPMENT_LIMITS.aboard) return EQUIPMENT_TEXT.tooMany(n, EQUIPMENT_LIMITS.aboard);
    return this.craftSpot(def, p) ? null : EQUIPMENT_TEXT.noRoom;
  }

  craft(kind: EquipmentKind): LiveUnit | null {
    if (this.craftBlock(kind) !== null) return null;
    const def = EQUIPMENT[kind], p = this.parkedPlacement()!, s = this.craftSpot(def, p);
    if (!s) return null;
    const w = trainToWorld(p, s.x, this.spec.floorY, s.z);
    // facing the aisle: its front toward the car's centre line (an aisle spot: toward the car's front)
    const localYaw = s.z > 1e-6 ? Math.PI : s.z < -1e-6 ? 0 : Math.PI / 2;
    const rec = freshEquipment(kind, this.host.playerTrain.equipment.nextUid(), {x: w.x, y: w.y, z: w.z, yaw: wrapYaw(localYaw + p.yaw)});
    const u = this.spawnUnit(rec, p.level);
    if (!u) return null;
    u.quietPlug = false;
    this.counts.crafted++;
    return u;
  }

  storesAboard(): EquipmentStore[] {
    const p = this.parkedPlacement(), out: EquipmentStore[] = [];
    if (!this.worldLive || !p) return out;
    for (const u of this.units()) {
      if (u.mode !== 'world' || !u.store || !this.insideCar(u, p)) continue;
      out.push({uid: u.uid, slots: u.store.slots, touch: () => u.touchStore()});
    }
    return out;
  }

  /** How many stops out the train console's map reveals: 2 while a route radar is plugged in, else 1 (Game.openTravelMap). */
  routeRadius(): number { return this.plugged('radar') ? 2 : 1; }

  /**
   * A unit straddling the car's outline (a doorway) / too many aboard / too many left in the station: the refusal text for a
   * departure, else null (Game.fuelCheck).
   */
  departBlock(): string | null {
    const p = this.placement();
    if (!p) return null;
    const spec = this.spec;
    let aboard = this.pending.length, station = 0;
    for (const u of this.list) {
      if (u.mode !== 'world') { aboard++; continue; }
      const b = u.body, q = this.toLocal(p, b.x, b.y, b.z), r = bodyRadius(b) - EQUIP.ownMargin;
      // (a unit down in the bed / on another storey is not at the car)
      if (Math.abs(q.y - spec.floorY) <= 1.2 && cartStraddles(q.x, q.z, r, spec)) return EQUIPMENT_TEXT.straddle(u.def.the);
      if (Math.abs(q.y - spec.floorY) < 0.3 && cartAboard(q.x, q.z, r, spec)) aboard++; else station++;
    }
    if (aboard > EQUIPMENT_LIMITS.aboard) return EQUIPMENT_TEXT.tooMany(aboard, EQUIPMENT_LIMITS.aboard);
    if (station > EQUIPMENT_LIMITS.station) return EQUIPMENT_TEXT.stationFull(station, EQUIPMENT_LIMITS.station);
    return null;
  }

  /** The ending save: the station's units into its lane WITHOUT a teardown (Game.commitEndingSave). */
  flush(): void {
    if (!this.worldLive) return;
    this.writeLane(this.stationRecords());
  }

  /** Highest item uid in any chest (live in the world, in the hands, waiting as a record): the inventory's counter stays above it. */
  maxUid(): number {
    let m = this.host.playerTrain.equipment.maxUid();
    for (const u of this.list) if (u.store) m = Math.max(m, u.store.maxUid());
    return m;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Game's seams for the carried chest (beside the carried body's)

  /** The hands carry a chest. */
  get carrying(): boolean { return !!this.held; }

  /** Game.startUse: no item use while the hands carry a chest (true = refused, with the note). */
  refuseUse(): boolean {
    if (!this.held) return false;
    this.refuse(EQUIPMENT_TEXT.handsFull);
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Persistence (TrainEquipment.live; the station lane)

  /** The train's units as records (train-local; uid order): inside the parked car, riding cargo, in the hands, waiting for a world. */
  aboard(): EquipmentJSON[] {
    const out: EquipmentJSON[] = [];
    const p = this.placement(), over = this.overflow(p);
    for (const u of this.list) {
      if (u.mode === 'world' && (!(p && this.insideCar(u, p)) || over?.has(u))) continue;
      out.push(this.aboardRecord(u, p));
    }
    for (const r of this.pending) out.push(copyEquipment(r));
    return out.sort(bySeq);
  }

  /** The station's units as records (world pose + storey; uid order). */
  stationRecords(): EquipmentJSON[] {
    const out: EquipmentJSON[] = [];
    const p = this.placement(), over = this.overflow(p);
    for (const u of this.list) if (u.mode === 'world' && (!(p && this.insideCar(u, p)) || over?.has(u))) out.push(this.stationRecord(u));
    return out.sort(bySeq);
  }

  /**
   * World units standing in the car BEYOND the save format's bound (EQUIPMENT_LIMITS.aboard; the newest ones): recorded with the
   * station, where they stand (the car parks on the same spot: they are in it again after a load). Null: none — the usual case. A
   * departure is refused before it matters (departBlock); this keeps a save taken without one (the ending) valid.
   */
  private overflow(p: TrainPlacement | null): Set<LiveUnit> | null {
    if (this.list.length + this.pending.length <= EQUIPMENT_LIMITS.aboard) return null;
    let n = this.pending.length;
    const inside: LiveUnit[] = [];
    for (const u of this.list) {
      if (u.mode !== 'world') n++;
      else if (p && this.insideCar(u, p)) inside.push(u);
    }
    const room = Math.max(0, EQUIPMENT_LIMITS.aboard - n);
    if (inside.length <= room) return null;
    inside.sort((a, b) => a.seq - b.seq);
    return new Set(inside.slice(room));
  }

  /** Retry / Load / Continue / New Game (TrainEquipment.load / reset): the train's units become exactly `recs` (idempotent). */
  restore(recs: readonly EquipmentJSON[]): void {
    this.counts.restores++;
    if (this.grab) this.letGo('restore');
    this.endHold();
    const p = this.placement();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const u = this.list[i];
      if (u.mode !== 'world' || (p && this.insideCar(u, p))) this.removeAt(i);
    }
    this.unswapRideCollision();
    this.captured = null;
    const seen = new Set<string>();
    this.pending = [];
    for (const r of recs ?? []) {
      if (equipmentProblem(r, false) !== null || seen.has(r.uid)) continue;
      seen.add(r.uid);
      this.pending.push(copyEquipment(r));
    }
    // the train's record wins a uid clash with a station unit of the old world (never two live units with one id)
    for (let i = this.list.length - 1; i >= 0; i--) if (seen.has(this.list[i].uid)) this.removeAt(i);
    // (the record's counter was just loaded: it is never behind a station unit still standing in this world)
    const E = this.host.playerTrain.equipment;
    for (const u of this.list) if (u.seq > E.seq) E.seq = Math.min(EQUIPMENT_LIMITS.seq, u.seq);
    this.spawnPending();
    this.reserveUids();
  }

  private stamp(u: LiveUnit, r: EquipmentJSON): EquipmentJSON {
    if (u.store) r.slots = u.store.toJSON().slots;
    if (u.def.ammoCap > 0) r.ammo = u.ammo;
    return r;
  }

  private aboardRecord(u: LiveUnit, p: TrainPlacement | null): EquipmentJSON {
    let x: number, y: number, z: number, yaw: number;
    if (u.mode === 'cargo') { x = u.local.x; y = u.local.y; z = u.local.z; yaw = u.local.yaw; }
    else if (u.mode === 'held' || !p) { const hl = this.heldLocal(u); x = hl.x; y = hl.y; z = hl.z; yaw = 0; }
    else { const q = this.toLocal(p, u.body.x, u.body.y, u.body.z); x = q.x; y = this.spec.floorY; z = q.z; yaw = u.body.yaw - p.yaw; }
    const r: EquipmentJSON = {uid: u.uid, kind: u.kind, x: r4(x), y: r4(y), z: r4(z), yaw: yawOut(yaw)};
    if (u.def.plug && u.plug !== null) r.plug = u.plug;
    return this.stamp(u, r);
  }

  private stationRecord(u: LiveUnit): EquipmentJSON {
    const b = u.body;
    return this.stamp(u, {uid: u.uid, kind: u.kind, x: r4(b.x), y: r4(b.y), z: r4(b.z), yaw: yawOut(b.yaw), level: Math.max(0, b.level)});
  }

  /**
   * Where the chest in the hands is recorded (the TRAIN's): the player's train-local position clamped into the car's interior, or the
   * train's spawn point while the player is not in the car.
   */
  private heldLocal(u: LiveUnit): {x: number; y: number; z: number} {
    const spec = this.spec, I = spec.interior, r = u.def.radius + 0.01, P = this.host.player, ride = this.ride;
    let lx = 0, lz = 0, ok = false;
    if (ride?.riding && ride.local) { lx = ride.local.x; lz = ride.local.z; ok = true; }
    else {
      const p = this.parkedPlacement();
      if (p) { const q = this.toLocal(p, P.x, P.y, P.z); lx = q.x; lz = q.z; ok = insideInterior(spec, q.x, q.y, q.z, 0.6); }
    }
    if (!ok) { const s = trainSpawnLocal(spec); lx = s.x; lz = s.z; }
    return {x: Math.max(I.x0 + r, Math.min(I.x1 - r, lx)), y: spec.floorY, z: Math.max(-I.halfWidth + r, Math.min(I.halfWidth - r, lz))};
  }

  private writeLane(list: EquipmentJSON[]): void {
    const run = this.host.run, here = this.here;
    if (!run?.setLaneStore || !here) return;
    if (list.length > EQUIPMENT_LIMITS.station) {
      // (never reached through a departure: departBlock refuses first — the lane's bound is the save format's)
      console.warn(`train equipment: ${list.length} units left in a station, the lane holds ${EQUIPMENT_LIMITS.station}`);
      list = list.slice(0, EQUIPMENT_LIMITS.station);
    }
    const rec: StationEquipmentJSON | undefined = list.length ? {v: 1, here: list} : undefined;
    run.setLaneStore(STATION_EQUIPMENT_LANE, rec, here.key as never);
  }

  private reserveUids(): void {
    const m = this.maxUid();
    if (m > 0) this.host.inv?.reserveUids?.(m);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  private onBuild(): void {
    this.worldLive = true;
    const run = this.host.run ?? null;
    this.here = run ? {key: {...run.current}} : null;
    this.look.poll(EQUIPMENT);
    this.attachFixtures();
    // the units left lying in this station (a uid the train carries is the train's)
    const mine = new Set<string>(), p = this.placement();
    for (const u of this.list) mine.add(u.uid);
    for (const r of this.pending) mine.add(r.uid);
    let stale = false;
    for (const r of stationEquipmentOf(run?.laneStore?.(STATION_EQUIPMENT_LANE))) {
      if (mine.has(r.uid)) { stale = true; continue; }
      mine.add(r.uid);
      const u = this.spawnUnit(r, r.level ?? 0);
      if (u && p && this.insideCar(u, p)) stale = true; // (the car parks over it: the train's from now on)
    }
    this.spawnPending();
    // a lane that lists a unit the train owns is written again at once: a save taken in this world never has one unit in two places
    if (stale) this.writeLane(this.stationRecords());
    this.reserveUids();
  }

  private onTeardown(): void {
    if (this.grab) this.letGo('teardown');
    this.endHold();
    // (a lift car still travelling finishes its run with the units in it first: recorded at the car's stop, never mid-shaft)
    try { this.host.tower?.parkCar?.(); } catch (err) { console.warn('train equipment: parking the lift failed', err); }
    this.aim = null;
    this.prompt = null;
    this.setRoll(0);
    const keepCargo = this.riding && !!this.captured; // the riding car keeps its cargo through the teardown (the view is held)
    const p = this.placement(), over = this.overflow(p);
    const station: EquipmentJSON[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const u = this.list[i];
      if (u.mode === 'held') continue; // (the chest stays in the hands)
      if (u.mode === 'cargo') {
        if (keepCargo) continue;
        this.pending.push(this.aboardRecord(u, p));
      } else if (p && this.insideCar(u, p) && !over?.has(u)) this.pending.push(this.aboardRecord(u, p));
      else station.push(this.stationRecord(u));
      this.removeAt(i);
    }
    if (!keepCargo) { this.unswapRideCollision(); this.captured = null; }
    this.pending.sort(bySeq);
    if (this.worldLive) this.writeLane(station.sort(bySeq));
    this.worldLive = false;
    this.here = null;
    this.host.playerTrain.equipment.setAboard(this.aboard());
    // the sockets ride a riding car's held view; otherwise they go with the world
    if (!(this.riding && this.fixtures.group.parent)) this.fixtures.group.removeFromParent();
  }

  /** Parent the plug sockets (+ cables) to the current train view (none: detached). Cheap when already there. */
  private attachFixtures(): boolean {
    const root = this.rt?.view?.root ?? null, g = this.fixtures.group;
    if (!root) { if (g.parent) g.removeFromParent(); return false; }
    if (g.parent !== root) {
      root.add(g);
      const level = this.rt?.train?.placement.level ?? 0;
      g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
      g.updateMatrixWorld(true);
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Per frame

  frame(dt: number): void {
    this.stepCarry(dt);
    if (!this.worldLive) { this.prompt = null; return; }
    this.pollLook();
    this.attachFixtures();
    this.followRide(dt);
    if (this.pending.length) this.spawnPending();
    const h = this.host, P = h.player, riding = this.riding;
    this.world.levels = h.levels!;
    this.world.props = h.propIndex;
    if (!h.levels) return;
    // a grab ends with the player out of action / riding / gone too far
    if (this.grab && (!P.alive || P.climbing || riding || this.grab.unit.mode !== 'world')) this.letGo(riding ? 'capture' : 'state');
    // the chest goes down where its carrier dies
    if (this.held && !P.alive && !riding) this.dropHeld();
    let fastest = 0;
    const top = P.y + (P.bodyHeight ?? 1.8);
    for (const u of this.list) {
      if (u.mode !== 'world') continue;
      const b = u.body;
      if (u.unseated > 0) this.seat(u);
      const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz);
      const grabbed = this.grab?.unit === u;
      if (!grabbed && !u.awake && d > EQUIP.activeRange) continue;
      if (grabbed) {
        // the hand point EQUIP.hold in front of the player (horizontal look), moving with the player — the fuel dolly's grab
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), T = this.target;
        T.x = P.x + fx * EQUIP.hold; T.z = P.z + fz * EQUIP.hold; T.vx = P.vx; T.vz = P.vz;
        const moved = stepCart(b, this.world, dt, T);
        this.counts.steps++;
        if (moved > 0 || d > 0.05) b.yaw = turnToward(b.yaw, Math.atan2(b.x - P.x, b.z - P.z), CART.grab.turnRate, dt);
        const lag = Math.hypot(T.x - b.x, T.z - b.z);
        this.grab!.lag = lag > CART.grab.breakDist ? this.grab!.lag + dt : 0;
        if (this.grab!.lag > CART.grab.breakTime || Math.hypot(b.x - P.x, b.z - P.z) > EQUIP.farDist) this.letGo('stuck');
        u.awake = true;
      } else {
        // (only a player whose body is at its height pushes it: never from the storey above)
        const pushed = !riding && P.alive && d < P.radius + bodyRadius(b) + 0.05 && P.y < b.y + u.def.height + 0.05 && top > b.y && pushByPlayer(b, P, dt);
        if (pushed) {
          u.awake = true;
          this.counts.pushes++;
          if (u.def.move === 'carry') { // (a box on its base: shoved slowly)
            const v = Math.hypot(b.vx, b.vz);
            if (v > EQUIP.slideMax) { b.vx *= EQUIP.slideMax / v; b.vz *= EQUIP.slideMax / v; }
          }
        }
        if (u.awake) {
          stepCart(b, this.world, dt, null, pushed);
          this.counts.steps++;
          if (Math.hypot(b.vx, b.vz) < CART.sleep) { b.vx = b.vz = 0; u.awake = false; u.plugCheck = true; }
        }
      }
      if (u.def.move === 'dolly') fastest = Math.max(fastest, Math.hypot(b.vx, b.vz));
    }
    this.separate();
    // the player never stands inside a unit (the ride moves the player in the car frame: not here)
    if (!riding && P.alive) {
      for (const u of this.list) {
        const b = u.body;
        if (u.mode === 'world' && P.y < b.y + u.def.height + 0.05 && top > b.y) separatePlayer(b, P, this.world);
      }
    }
    for (const u of this.list) {
      if (u.mode !== 'world') continue;
      if (u.body.level !== u.markedLevel) this.markLevel(u); // (dragged over a stair: its meshes carry the storey it stands on)
      this.solvePose(u, dt);
      this.draw(u);
    }
    if (this.lids.size) this.stepLids(dt);
    this.stepPlugs();
    this.setRoll(Math.min(1, fastest / 2.2));
    this.stepHold(dt);
    this.updateAim();
  }

  /** Units against each other and against the fuel carts (bounded: only pairs with one awake). */
  private separate(): void {
    const L = this.list, n = L.length, W = this.world;
    for (let i = 0; i < n; i++) {
      const a = L[i];
      if (a.mode !== 'world') continue;
      for (let j = i + 1; j < n; j++) {
        const c = L[j];
        if (c.mode !== 'world' || (!a.awake && !c.awake)) continue;
        if (separateCarts(a.body, c.body, W)) { a.awake = c.awake = true; }
      }
    }
    const carts = this.host.fuelCarts?.bodies?.();
    if (!carts?.length) return;
    for (let i = 0; i < n; i++) {
      const a = L[i];
      if (a.mode !== 'world') continue;
      for (const c of carts) {
        if (c.mode !== 'world' || (!a.awake && !c.awake)) continue;
        if (separateCarts(a.body, c.body, W)) { a.awake = true; c.awake = true; }
      }
    }
  }

  /** The ride: capture the units aboard when it starts; release the cargo once it has stopped (or never started). */
  private followRide(dt: number): void {
    const ride = this.ride;
    if (ride?.riding) {
      if (this.captured) this.captured.sawRide = true;
      // (before the car has left: the units aboard ride with it)
      if (ride.phase === undefined || ride.phase === 'closing' || ride.phase === 'departing') {
        const p = this.rt?.train?.placement;
        if (p && this.list.some(u => u.mode === 'world' && this.insideCar(u, p))) this.captureCargo();
      }
      return;
    }
    if (!this.captured) return;
    this.captured.idle += dt;
    if (this.captured.sawRide || this.captured.idle > EQUIP.captureGrace) this.release();
  }

  /** The model sources (the prop library, the hand truck's) are looked at again now and then: a model that arrived upgrades the stand-ins. */
  private pollLook(): void {
    if (--this.pollIn > 0) return;
    this.pollIn = EQUIP.pollEvery;
    if (!this.look.poll(EQUIPMENT)) return;
    for (const u of this.list) {
      if (!this.look.refresh(u.view, u.def)) continue;
      poseEquipmentLid(u.view, ease(u.lidT));
      if (u.mode === 'held') { u.flags = null; this.keepFlags(u); } // (its new meshes: no shadow in the hands)
      else this.host.atmosphere?.markShadows(u.view.group, false);
      this.markLevel(u);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Cargo

  /** Right before the car moves (also automatic when a ride starts): the units aboard become cargo riding the car's view root. Idempotent. */
  captureCargo(): void {
    const rt = this.rt, root = rt?.view?.root, p = rt?.train?.placement;
    if (!root || !p) return;
    let n = 0;
    for (const u of this.list) {
      if (u.mode !== 'world' || !this.insideCar(u, p)) continue;
      if (this.grab?.unit === u) this.letGo('capture');
      if (this.eHold?.unit === u) this.endHold();
      const b = u.body, q = this.toLocal(p, b.x, b.y, b.z);
      u.local.x = q.x; u.local.y = this.spec.floorY; u.local.z = q.z; u.local.yaw = wrapYaw(b.yaw - p.yaw);
      b.vx = b.vz = 0;
      u.mode = 'cargo';
      u.awake = false;
      this.shutLid(u);
      root.add(u.view.group);
      u.view.group.position.set(u.local.x, u.local.y, u.local.z);
      u.view.group.rotation.set(0, u.local.yaw, 0);
      u.view.group.updateMatrixWorld(true);
      if (u.plug !== null) this.shapeCable(u.plug, u.local.x, u.local.z);
      n++;
    }
    if (!this.list.some(u => u.mode === 'cargo')) return;
    if (!this.captured) this.captured = {sawRide: this.riding, idle: 0, swap: null};
    if (n) { this.counts.captured += n; this.swapRideCollision(); }
  }

  /** The departure was refused before the car left: cargo back to ordinary units where they stand (no-op while the car moves). */
  releaseCargo(): void {
    if (this.ride?.moving) return;
    this.release();
  }

  /** Cargo -> ordinary units at the parked car's placement (an arrival: the NEW station's); without a car -> pending records. */
  private release(): void {
    const cargo = this.list.filter(u => u.mode === 'cargo');
    this.unswapRideCollision();
    this.captured = null;
    if (!cargo.length) return;
    const p = this.rt?.train?.placement ?? null, L = this.host.levels;
    for (const u of cargo) {
      if (!p || !this.worldLive) {
        this.pending.push(this.aboardRecord(u, p));
        this.removeAt(this.list.indexOf(u));
        continue;
      }
      const w = trainToWorld(p, u.local.x, u.local.y, u.local.z), b = u.body;
      const f = L ? cartFloorAt(L, w.x, w.z, w.y + 0.05) : null;
      b.x = w.x; b.z = w.z; b.y = f?.floor ?? w.y; b.level = f?.level ?? p.level;
      b.yaw = wrapYaw(u.local.yaw + p.yaw);
      b.vx = b.vz = 0;
      u.mode = 'world';
      u.awake = false;
      u.unseated = f ? 0 : SEAT_FRAMES;
      u.plugCheck = true;
      u.quietPlug = true;
      this.group.add(u.view.group);
      this.solvePose(u, 0, true);
      this.draw(u, true);
      this.markLevel(u);
      this.counts.released++;
    }
    this.pending.sort(bySeq);
  }

  /** The riding player collides with the cargo: the ride's car-local model gets their footprints (removed on release). */
  private swapRideCollision(): void {
    const model = this.ride?.model;
    if (!model || !this.captured) return;
    const H = this.spec.ceilingY + 3;
    const boxes: PropPlacement[] = [];
    for (const u of this.list) if (u.mode === 'cargo') boxes.push(rideCargoColumn(u.local.x, u.local.z, bodyRadius(u.body), H));
    setRideCargoBoxes(model, 'train-equipment', boxes);
    this.captured.swap = model;
  }

  private unswapRideCollision(): void {
    const m = this.captured?.swap;
    if (!m) return;
    setRideCargoBoxes(m, 'train-equipment', null);
    this.captured!.swap = null;
  }

  /** Pending train records -> live units inside the parked car (needs a world with a parked car, not riding). */
  private spawnPending(): void {
    if (!this.worldLive || this.riding || !this.pending.length) return;
    const p = this.rt?.train?.placement ?? this.host.trainPlacement;
    if (!p) return;
    const spec = this.spec, I = spec.interior;
    const recs = this.pending;
    this.pending = [];
    for (const k of recs) {
      const def = EQUIPMENT[k.kind];
      if (!def || this.unit(k.uid)) continue;
      // (a pose from a save is clamped into the walkable interior: always wholly aboard)
      const r = def.radius;
      const lx = Math.max(I.x0 + r + 0.01, Math.min(I.x1 - r - 0.01, k.x)), lz = Math.max(-I.halfWidth + r + 0.01, Math.min(I.halfWidth - r - 0.01, k.z));
      let w = trainToWorld(p, lx, spec.floorY, lz);
      // two records on one spot (a chest recorded where the player stood beside another): the later one moves to the nearest free floor
      if (this.overlapsUnit(w.x, p.floorY, w.z, r, null)) w = this.nudge(p, lx, lz, def) ?? w;
      const rec = copyEquipment(k);
      rec.x = w.x; rec.y = p.floorY; rec.z = w.z; rec.yaw = wrapYaw(k.yaw + p.yaw);
      this.spawnUnit(rec, p.level, k.plug);
    }
  }

  /** The nearest free floor round a train-local point inside the car for a unit of `def` (null: none within 2 m). */
  private nudge(p: TrainPlacement, lx: number, lz: number, def: EquipmentDef): {x: number; y: number; z: number} | null {
    const spec = this.spec, I = spec.interior, r = def.radius;
    for (let ring = 1; ring <= 10; ring++) {
      const d = ring * 0.2;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, x = lx + Math.cos(a) * d, z = lz + Math.sin(a) * d;
        if (x - r < I.x0 || x + r > I.x1 || Math.abs(z) + r > I.halfWidth) continue;
        const w = trainToWorld(p, x, spec.floorY, z);
        if (this.spotFree(w.x, p.floorY, w.z, def, null, false)) return w;
      }
    }
    return null;
  }

  /** A live world unit from a record (world pose; `plug`: an aboard record's plug to take again when free and in reach). */
  private spawnUnit(rec: EquipmentJSON, level: number, plug?: number): LiveUnit | null {
    const def = EQUIPMENT[rec.kind];
    if (!def || this.unit(rec.uid)) return null;
    const view = this.look.build(def), L = this.host.levels;
    const f = L ? cartFloorAt(L, rec.x, rec.z, rec.y + 0.05) : null;
    const u = new LiveUnit(this, rec.uid, def, view, {x: rec.x, y: f?.floor ?? rec.y, z: rec.z, yaw: rec.yaw, level: f?.level ?? level});
    // (nothing is invented: exactly the record's stacks / rounds; a malformed stack loads as an empty slot)
    if (u.store) u.store.load({v: 1, slots: rec.slots ?? []});
    u.setAmmo(rec.ammo ?? 0);
    // (nothing under it at its recorded height — a lift shaft whose car stands elsewhere: seated on the first frames)
    u.unseated = f || !L ? 0 : SEAT_FRAMES;
    view.group.name = `train-equipment:${rec.uid}`;
    this.group.add(view.group);
    this.solvePose(u, 0, true);
    this.draw(u, true);
    this.host.atmosphere?.markShadows(view.group, false);
    this.markLevel(u);
    this.list.push(u);
    this.sorted = null;
    this.counts.spawned++;
    // (the run's counter is never below a live unit's number: a new unit never takes a living one's id, and a save stays valid)
    const E = this.host.playerTrain.equipment;
    if (u.seq > E.seq) E.seq = Math.min(EQUIPMENT_LIMITS.seq, u.seq);
    if (plug !== undefined && def.plug) this.restorePlug(u, plug);
    return u;
  }

  private removeAt(i: number): void {
    if (i < 0) return;
    const u = this.list[i];
    if (this.grab?.unit === u) this.grab = null;
    if (this.eHold?.unit === u) this.endHold();
    if (this.held === u) { this.held = null; this.restoreFlags(u); }
    if (this.aim?.unit === u) { this.aim = null; this.prompt = null; }
    this.lids.delete(u);
    this.list.splice(i, 1);
    this.sorted = null;
    if (u.plug !== null) this.disconnect(u, null);
    u.view.group.removeFromParent();
  }

  /** The unit is the TRAIN's now: riding cargo, in the hands, or a world unit wholly inside the car at its placement. */
  private isTrainOwned(u: LiveUnit): boolean {
    if (u.mode !== 'world') return true;
    const p = this.placement();
    return !!p && this.insideCar(u, p);
  }

  /** A world unit wholly inside the car at placement p (cartAboard on its train-local centre with its own radius, on the car floor). */
  private insideCar(u: LiveUnit, p: TrainPlacement): boolean {
    const b = u.body, q = this.toLocal(p, b.x, b.y, b.z);
    return Math.abs(q.y - this.spec.floorY) < 0.3 && cartAboard(q.x, q.z, bodyRadius(b) - EQUIP.ownMargin, this.spec);
  }

  /** Units the train owns right now (live + waiting). */
  private aboardCount(): number {
    let n = this.pending.length;
    for (const u of this.list) if (this.isTrainOwned(u)) n++;
    return n;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Free floor (craft, put down, a record's nudge)

  /** Some live world unit other than `skip` overlaps the footprint (x, z, r) at height y. */
  private overlapsUnit(x: number, y: number, z: number, r: number, skip: LiveUnit | null): boolean {
    for (const o of this.list) {
      if (o === skip || o.mode !== 'world') continue;
      const b = o.body, min = r + bodyRadius(b) - TOUCH;
      if (Math.abs(b.y - y) < 1 && (b.x - x) ** 2 + (b.z - z) ** 2 < min * min) return true;
    }
    return false;
  }

  /**
   * A unit of `def` can stand at (x, y, z): floor under its whole footprint, no wall / ledge / prop / car collider in it (the
   * controller's own collision, a zero move), no other unit, no fuel cart, and (unless `player` is false) not the player.
   */
  spotFree(x: number, y: number, z: number, def: EquipmentDef, skip: LiveUnit | null = null, player = true): boolean {
    const h = this.host, L = h.levels;
    if (!L) return false;
    const r = def.radius;
    if (!footprintFloor(L, x, z, y, r)) return false;
    const [nx, nz] = moveCircle(L, h.propIndex, x, z, 0, 0, r, y, def.height);
    if (Math.abs(nx - x) > 2e-3 || Math.abs(nz - z) > 2e-3) return false;
    if (this.overlapsUnit(x, y, z, r, skip)) return false;
    for (const c of h.fuelCarts?.bodies?.() ?? []) {
      if (c.mode !== 'world') continue;
      const b = c.body, min = r + bodyRadius(b) - TOUCH;
      if (Math.abs(b.y - y) < 1 && (b.x - x) ** 2 + (b.z - z) ** 2 < min * min) return false;
    }
    if (player) {
      const P = h.player, min = r + P.radius;
      if (Math.abs(P.y - y) < 1.5 && (P.x - x) ** 2 + (P.z - z) ** 2 < min * min) return false;
    }
    return true;
  }

  /**
   * The first physically free craft spot for `def` in the parked car (train-local), or null. Reads only (craftBlock is asked per recipe
   * while the bench's list is open): the spot list is kept per footprint radius, the first free spot is usually the first tested.
   */
  private craftSpot(def: EquipmentDef, p: TrainPlacement): {x: number; z: number} | null {
    const spec = this.spec;
    if (this.spotsSpec !== spec) { this.spots.clear(); this.spotsSpec = spec; }
    let list = this.spots.get(def.radius);
    if (!list) this.spots.set(def.radius, (list = craftSpots(def.radius, spec)));
    for (const s of list) {
      const wx = p.x + p.front * s.x, wz = p.z + p.front * s.z; // (trainToWorld without the object)
      if (this.spotFree(wx, p.floorY, wz, def)) return s;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Plugs

  private notifyPlug(u: LiveUnit, plugged: boolean): void {
    for (const f of this.plugListeners) {
      try { f(u, plugged); } catch (err) { console.warn('train equipment: a plug listener failed', err); }
    }
  }

  /** Connect `u` to plug `index` (`live`: the player's doing in the live world — the toast and the cue). */
  private connect(u: LiveUnit, index: number, live: boolean): void {
    u.plug = index;
    this.owners[index] = u;
    this.taken.add(index);
    setPlugLamp(this.fixtures, index, true);
    this.fixtures.cables[index].mesh.visible = true;
    this.counts.plugged++;
    if (live) {
      this.host.hud.toast(EQUIPMENT_TEXT.pluggedIn(u.def.name));
      this.sfx?.hoseConnect?.(true);
    }
    this.notifyPlug(u, true);
  }

  /** Disconnect `u` (a toast `text`, null = silently: it leaves with its world / a restore). */
  private disconnect(u: LiveUnit, text: string | null, warn = false): void {
    const i = u.plug;
    if (i === null) return;
    u.plug = null;
    if (this.owners[i] === u) {
      this.owners[i] = null;
      this.taken.delete(i);
      setPlugLamp(this.fixtures, i, false);
      this.fixtures.cables[i].mesh.visible = false;
    }
    this.counts.unplugged++;
    if (text) {
      this.host.hud.toast(text, warn);
      this.sfx?.hoseConnect?.(false);
    }
    // a plug came free: the devices standing at rest look again
    for (const o of this.list) if (o.def.plug && o.plug === null) o.plugCheck = true;
    this.notifyPlug(u, false);
  }

  /** A record's plug: taken again when it exists, is free, and the unit stands wholly inside the car within its reach. */
  private restorePlug(u: LiveUnit, index: number): void {
    const p = this.rt?.train?.placement ?? this.host.trainPlacement, e = this.fixtures.plugs[index];
    if (!p || !e || this.taken.has(index) || u.mode !== 'world' || !this.insideCar(u, p)) return;
    const q = this.toLocal(p, u.body.x, u.body.y, u.body.z);
    if (Math.hypot(e.x - q.x, e.z - q.z) > PLUG.reach) return;
    this.connect(u, index, false);
    this.shapeCable(index, q.x, q.z);
    u.plugCheck = false;
  }

  private shapeCable(index: number, lx: number, lz: number): void {
    shapePlugCable(this.fixtures, index, lx, lz, this.spec.floorY);
    this.counts.cables++;
  }

  /** The plugs follow the units: only awake / just-settled ones are looked at (a unit at rest costs a flag test). */
  private stepPlugs(): void {
    const p = this.parkedPlacement(), spec = this.spec;
    for (const u of this.list) {
      if (!u.def.plug || u.mode !== 'world') continue;
      if (!u.awake && !u.plugCheck) continue;
      const b = u.body;
      if (u.plug !== null) {
        u.plugCheck = false;
        const e = this.fixtures.plugs[u.plug];
        if (!p || !e) { this.disconnect(u, EQUIPMENT_TEXT.pulled(u.def.name), true); continue; }
        const q = this.toLocal(p, b.x, b.y, b.z);
        const inCar = Math.abs(q.y - spec.floorY) < 0.3 && cartAboard(q.x, q.z, bodyRadius(b) - EQUIP.ownMargin, spec);
        if (!inCar || Math.hypot(e.x - q.x, e.z - q.z) > PLUG.reach) { this.disconnect(u, EQUIPMENT_TEXT.pulled(u.def.name), true); continue; }
        if (u.awake) this.shapeCable(u.plug, q.x, q.z); // (it moved: the cable follows)
        continue;
      }
      if (u.awake || this.grab?.unit === u) continue; // (connects at rest only)
      u.plugCheck = false;
      const quiet = u.quietPlug;
      u.quietPlug = false;
      if (!p) continue;
      const q = this.toLocal(p, b.x, b.y, b.z);
      if (!(Math.abs(q.y - spec.floorY) < 0.3 && cartAboard(q.x, q.z, bodyRadius(b) - EQUIP.ownMargin, spec))) continue;
      const lx = q.x, lz = q.z, plug = plugInReach(lx, lz, this.taken, spec);
      if (!plug) continue;
      this.connect(u, plug.index, !quiet);
      this.shapeCable(plug.index, lx, lz);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Lids

  /** EquipmentUnit.setOpen: the lid's target (it moves on the Lockbox's stroke; shut at once when the unit is not standing in the world). */
  setLid(u: LiveUnit, open: boolean): void {
    if (!u.view.lid && !u.def.slots) return;
    if (u.mode !== 'world') { this.shutLid(u); return; }
    u.lidTarget = open ? 1 : 0;
    if (u.lidT !== u.lidTarget) this.lids.add(u);
  }

  private shutLid(u: LiveUnit): void {
    u.lidTarget = 0;
    u.lidT = 0;
    this.lids.delete(u);
    poseEquipmentLid(u.view, 0);
  }

  private stepLids(dt: number): void {
    const k = dt / EQUIPMENT_LID_TIME;
    for (const u of this.lids) {
      u.lidT = u.lidTarget > u.lidT ? Math.min(1, u.lidT + k) : Math.max(0, u.lidT - k);
      poseEquipmentLid(u.view, ease(u.lidT));
      if (u.lidT === u.lidTarget) this.lids.delete(u);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Bullets

  /**
   * A bullet / pellet ray that reached the world at distance wh.t: a world unit in front of that hit stops it (a metal impact, no
   * crater behind) and takes a shove along the shot (bounded, by its mass). Riding cargo / the carried chest are never hit.
   */
  bulletHit(wh: {t: number}, point: THREE.Vector3, dir: THREE.Vector3, damage: number): boolean {
    if (!this.worldLive || !(wh.t > 0)) return false;
    const o = this.shot.set(point.x - dir.x * wh.t, point.y - dir.y * wh.t, point.z - dir.z * wh.t);
    let best: LiveUnit | null = null, bt = wh.t - 0.01;
    for (const u of this.list) {
      if (u.mode !== 'world') continue;
      const b = u.body;
      const t = u.def.move === 'dolly'
        ? rayCylinder(o, dir, b.x, b.z, bodyRadius(b) * 0.85, b.y + 0.02, b.y + CART_LOOK.height, bt)
        : this.rayBody(u, o, dir, bt);
      if (t !== null && t < bt) { bt = t; best = u; }
    }
    if (!best) return false;
    const b = best.body, hx = o.x + dir.x * bt, hy = o.y + dir.y * bt, hz = o.z + dir.z * bt;
    const hl = Math.hypot(dir.x, dir.z);
    if (hl > 1e-6) {
      const dv = Math.min(EQUIP.bulletMaxDv, (Math.max(0, damage) * EQUIP.bulletImpulse) / bodyMass(b));
      b.vx += (dir.x / hl) * dv;
      b.vz += (dir.z / hl) * dv;
      best.awake = true;
    }
    const n = new THREE.Vector3(hx - b.x, 0, hz - b.z);
    if (n.lengthSq() < 1e-8) n.set(-dir.x, -dir.y, -dir.z);
    n.normalize();
    this.host.fx?.impact(new THREE.Vector3(hx, hy, hz), n, 'metal', {decal: false, chips: 1});
    this.sfx?.impact?.(hx, hy, hz, 'metal');
    this.counts.bullets++;
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Grab / carry / aim / prompt / E

  private startGrab(u: LiveUnit): void {
    if (u.mode !== 'world') return;
    if (u.plug !== null) this.disconnect(u, EQUIPMENT_TEXT.unplugged(u.def.name));
    this.grab = {unit: u, lag: 0};
    u.awake = true;
    this.counts.grabs++;
  }

  /** Let go of the grabbed unit (`why` for QA). */
  letGo(why: string): void {
    if (!this.grab) return;
    const u = this.grab.unit;
    this.grab = null;
    this.counts.letGo++;
    u.plugCheck = true;
    if (why === 'stuck') this.host.hud.toast(EQUIPMENT_TEXT.stuck(u.def.the));
  }

  private refuse(text: string): void {
    this.host.hud.toast(text, true);
    this.sfx?.denied?.();
    this.counts.refused++;
  }

  /** The hands are free for a pickup now (nothing else owns them: the carried body's rule). */
  private handsFree(): boolean {
    const h = this.host, p = h.player;
    if (this.grab || this.held || h.state !== 'playing' || !p.alive || p.climbing) return false;
    if (h.flareHold?.active || h.skywaysCar?.driving || h.vomit?.active || h.corpses?.carrying || h.fuelCarts?.grab) return false;
    return !(h.inputOwners?.some(f => f !== this.owner && f()) ?? false);
  }

  /** A 'carry' kind into the hands; false (with the reason shown) when the hands are not free. */
  pickUp(u: LiveUnit): boolean {
    if (u.def.move !== 'carry' || u.mode !== 'world') return false;
    if (this.host.player.climbing) { this.refuse(EQUIPMENT_TEXT.ladder); return false; }
    if (!this.handsFree()) { this.refuse(EQUIPMENT_TEXT.handsFull); return false; }
    this.shutLid(u);
    u.mode = 'held';
    u.awake = false;
    u.body.vx = u.body.vz = 0;
    const g = u.view.group, A = EQUIP.carry.anchor;
    this.hands.add(g);
    g.position.set(A.x, A.y, A.z);
    g.rotation.set(0, Math.PI, 0); // (its front away from the carrier: the hinge side toward the chest)
    this.keepFlags(u);
    this.held = u;
    this.aim = null;
    this.deps.cancelUse?.('carry');
    this.counts.pickups++;
    this.sfx?.pickup?.();
    this.followView();
    return true;
  }

  /** Put the carried chest down on free floor in front of the player, or say why not; true = done. */
  putDown(): boolean {
    const u = this.held, h = this.host;
    if (!u) return false;
    if (this.riding) { this.refuse(EQUIPMENT_TEXT.moving); return false; }
    if (h.player.climbing) { this.refuse(EQUIPMENT_TEXT.ladder); return false; }
    const s = this.worldLive ? this.putSpot(u, false) : null;
    if (!s) { this.refuse(EQUIPMENT_TEXT.noPutDown); return false; }
    this.toFloor(u, s.x, s.y, s.z, s.level);
    return true;
  }

  /** Death: the chest goes down at the player's feet (the best free spot; never lost, never kept by a dead carrier). */
  private dropHeld(): void {
    const u = this.held, P = this.host.player, L = this.host.levels;
    if (!u || !this.worldLive || !L) return;
    const s = this.putSpot(u, true) ?? (() => { const f = L.supportIn(P.x, P.z, P.y + 0.05); return {x: P.x, y: f?.floor ?? P.y, z: P.z, level: f?.level ?? 0}; })();
    this.toFloor(u, s.x, s.y, s.z, s.level);
  }

  /**
   * Where the carried chest can stand: in front of the player (EQUIP.carry.putAt), on floor within a step of the player's, the way
   * there clear, the footprint free. `anywhere` (death): then round the player, then on the player's own spot.
   */
  private putSpot(u: LiveUnit, anywhere: boolean): {x: number; y: number; z: number; level: number} | null {
    const h = this.host, L = h.levels, P = h.player;
    if (!L) return null;
    const def = u.def;
    const tryAt = (ax: number, az: number, dist: number, player: boolean): {x: number; y: number; z: number; level: number} | null => {
      const x = P.x + ax * dist, z = P.z + az * dist;
      const f = cartFloorAt(L, x, z, P.y);
      if (!f) return null;
      if (dist > 0) {
        // the way to the spot: a small circle walks there from the player (never through a wall, a closed door leaf, over a counter)
        const [sx, sz] = moveCircle(L, h.propIndex, P.x, P.z, ax * dist, az * dist, EQUIP.carry.sweepR, P.y, def.height);
        if (Math.hypot(sx - x, sz - z) > 0.05) return null;
      }
      return this.spotFree(x, f.floor, z, def, u, player) ? {x, y: f.floor, z, level: f.level} : null;
    };
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    for (const d of EQUIP.carry.putAt) { const s = tryAt(fx, fz, d, true); if (s) return s; }
    if (!anywhere) return null;
    for (const d of EQUIP.carry.putAt) for (let k = 1; k < 8; k++) {
      const a = P.yaw + (k / 8) * Math.PI * 2, s = tryAt(-Math.sin(a), -Math.cos(a), d, true);
      if (s) return s;
    }
    return tryAt(0, 0, 0, false);
  }

  /** The carried chest becomes a world unit standing at (x, y, z), its front toward the player. */
  private toFloor(u: LiveUnit, x: number, y: number, z: number, level: number): void {
    const P = this.host.player, b = u.body;
    this.restoreFlags(u);
    b.x = x; b.y = y; b.z = z; b.level = level; b.vx = b.vz = 0;
    b.yaw = Math.hypot(P.x - x, P.z - z) > 1e-3 ? Math.atan2(P.x - x, P.z - z) : wrapYaw(P.yaw);
    u.mode = 'world';
    u.awake = false;
    u.plugCheck = true;
    u.unseated = 0;
    this.held = null;
    this.group.add(u.view.group);
    this.solvePose(u, 0, true);
    this.draw(u, true);
    this.host.atmosphere?.markShadows(u.view.group, false);
    this.markLevel(u);
    this.counts.putDowns++;
    this.sfx?.bodyFall?.(x, y + 0.2, z, 0.5);
  }

  private keepFlags(u: LiveUnit): void {
    if (u.flags) return;
    const flags: {mesh: THREE.Mesh; shadow: boolean}[] = u.flags = [];
    u.view.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      flags.push({mesh: m, shadow: m.castShadow});
      m.castShadow = false; // (in front of the chest it would black out the flashlight beam)
    });
  }

  private restoreFlags(u: LiveUnit): void {
    for (const f of u.flags ?? []) f.mesh.castShadow = f.shadow;
    u.flags = null;
  }

  private modifier(): {speedMult?: number} {
    if (this.held) return this.host.player.sprinting ? CARRY_SPRINT_MODS : CARRY_MODS; // (a sprint is no faster: the flag is last frame's)
    return this.grab ? DRAG_MODS : NO_MODS;
  }

  /** The carry frame follows part of the view's pitch (it is the camera's child): the chest stays low in view. */
  private followView(): void {
    const h = this.host;
    const pitch = (h.player.pitch ?? 0) + (h.aimOffset?.pitch ?? 0);
    this.hands.quaternion.setFromAxisAngle(this.axis, -pitch * (1 - EQUIP.carry.pitchFollow));
    this.hands.updateMatrixWorld(true);
  }

  private stepCarry(dt: number): void {
    const step = dt / EQUIP.carry.holsterS;
    this.holster = this.held ? Math.min(1, this.holster + step) : Math.max(0, this.holster - step);
    if (this.held) this.followView();
  }

  /** E while a unit is grabbed / carried: always that unit's (let go / put down) — except the driving console with a chest in the hands. */
  private onBusyInteract(): boolean {
    if (this.grab) { this.letGo('user'); return true; }
    if (!this.held) return false;
    if (this.host.state !== 'playing') return true;
    // the one other E use while carrying: the train's driving console (its map / a journey with the chest in the hands)
    if (this.rt?.consoleAimed) return false;
    this.putDown();
    return true;
  }

  private busyPrompt(): string | null {
    const h = this.host;
    if (h.state !== 'playing' || !h.player.alive) return null;
    if (this.grab) return EQUIPMENT_TEXT.letGo(this.grab.unit.def.the);
    if (!this.held || this.riding || this.rt?.consoleAimed) return null;
    return EQUIPMENT_TEXT.putDown(this.held.def.the);
  }

  /** [E] on the aimed unit: see the header (AIM / E). Only when a unit is the aim target. */
  onInteract(): boolean {
    const h = this.host;
    if (!this.worldLive || this.riding || h.state !== 'playing' || !h.player.alive) return false;
    if (this.eHold) return true;
    const aim = this.pickAim();
    if (!aim) return false;
    const u = aim.unit, use = this.uses[u.kind];
    if (u.def.move === 'carry' || (aim.part === 'module' && use?.hold)) {
      // a tap acts on the release, a hold at EQUIP_HOLD_S (stepHold)
      this.eHold = {unit: u, part: aim.part, t: 0, clears: h.input?.clears ?? 0};
      return true;
    }
    if (aim.part === 'module' && use && this.callUse(use, 'tap', u)) return true;
    this.startGrab(u);
    return true;
  }

  private callUse(use: EquipmentUse, what: 'tap' | 'hold', u: LiveUnit): boolean {
    try {
      if (what === 'tap') { this.counts.taps++; return use.tap(u) === true; }
      this.counts.holds++;
      return use.hold?.(u) === true;
    } catch (err) {
      console.warn(`train equipment: the ${u.kind} use failed`, err);
      return false;
    }
  }

  /** E held on a unit (0..1 of EQUIP_HOLD_S), or null — QA / tests. */
  get holdProgress(): number | null {
    return this.eHold ? Math.min(1, this.eHold.t / EQUIP_HOLD_S) : null;
  }

  private endHold(): void {
    if (!this.eHold) return;
    this.eHold = null;
    this.host.hud.setHoldRing?.(null);
  }

  /** The pending E on a unit: released early = the TAP, held EQUIP_HOLD_S = the HOLD; cancelled when the aim leaves it / a menu / death. */
  private stepHold(dt: number): void {
    const H = this.eHold;
    if (!H) return;
    const h = this.host, inp = h.input ?? null, u = H.unit;
    if (h.state !== 'playing' || !h.player.alive || h.player.climbing || this.riding || u.mode !== 'world' || this.grab || this.held
      || (inp && inp.clears !== undefined && inp.clears !== H.clears)) { this.endHold(); return; }
    const aim = this.pickAim();
    if (!aim || aim.unit !== u) { this.endHold(); return; }
    H.t += dt;
    const use = this.uses[u.kind];
    if (H.t >= EQUIP_HOLD_S) {
      this.endHold();
      if (u.def.move === 'carry') this.pickUp(u);
      else if (!(use && this.callUse(use, 'hold', u))) this.startGrab(u);
      return;
    }
    if (!inp || !inp.down('KeyE')) {
      this.endHold();
      if (use && this.callUse(use, 'tap', u)) return;
      if (u.def.move === 'carry') this.pickUp(u); else this.startGrab(u);
      return;
    }
    h.hud.setHoldRing?.(H.t >= 0.1 ? H.t / EQUIP_HOLD_S : null);
  }

  /** The camera ray against a unit's box in its own frame (its drawn frame when it lies tilted on steps): the distance, or null. */
  private rayBody(u: LiveUnit, o: THREE.Vector3, d: THREE.Vector3, maxT: number, face: {front: boolean} | null = null): number | null {
    const K = equipmentBox(u.def, this.spec).body, B = this.boxScratch, b = u.body;
    const lo = this.lo, ld = this.ld;
    if (this.tilted(u)) {
      lo.copy(o).applyMatrix4(this.inv.copy(u.view.group.matrixWorld).invert());
      ld.copy(d).transformDirection(this.inv);
    } else {
      const s = Math.sin(b.yaw), c = Math.cos(b.yaw), ox = o.x - b.x, oz = o.z - b.z;
      lo.set(ox * c - oz * s, o.y - b.y, ox * s + oz * c);
      ld.set(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
    }
    B.min.x = K.x - K.hw; B.max.x = K.x + K.hw; B.min.y = K.y0; B.max.y = K.y1; B.min.z = K.z - K.hd; B.max.z = K.z + K.hd;
    const t = rayBox(lo, ld, B, maxT);
    if (t !== null && face) {
      const F = equipmentBox(u.def, this.spec).face, hy = lo.y + ld.y * t, hz = lo.z + ld.z * t;
      face.front = !!F && Math.abs(hz - (K.z + K.hd)) < 2e-3 && hy >= F.y0 - 0.03 && hy <= F.y1 + 0.03;
    }
    return t;
  }

  /** The unit part under the crosshair within reach, nothing structural in between (null: none). */
  pickAim(): {unit: LiveUnit; part: AimPart; t: number} | null {
    const h = this.host, L = h.levels;
    if (!L) return null;
    h.camera.getWorldPosition(this.eye);
    h.camera.getWorldDirection(this.dir);
    const o = this.eye, d = this.dir, K = CART_LOOK, face = FACE;
    let best: {unit: LiveUnit; part: AimPart; t: number} | null = null;
    for (const u of this.list) {
      if (u.mode !== 'world') continue;
      const b = u.body;
      if (Math.hypot(b.x - o.x, b.z - o.z) > EQUIP.useReach + 0.8) continue;
      let part: AimPart, t: number;
      if (u.def.move === 'carry') {
        const tb = this.rayBody(u, o, d, EQUIP.useReach);
        if (tb === null) continue;
        part = 'body'; t = tb;
      } else {
        // the console face (the module's front, inside its face band) is the 'module'; the rest of the module and the truck's own
        // cylinder (uprights, handle, wheels) are the 'frame' — from behind the handle grabs, from the front the console is used
        face.front = false;
        const tm = this.rayBody(u, o, d, EQUIP.useReach, face);
        let tf: number | null;
        if (this.tilted(u)) {
          const lo = this.lo.copy(o).applyMatrix4(this.inv.copy(u.view.group.matrixWorld).invert()), ld = this.ld.copy(d).transformDirection(this.inv);
          tf = rayCylinder(lo, ld, 0, K.frame.z, K.frame.r, 0, K.height, EQUIP.grabReach);
        } else {
          const s = Math.sin(b.yaw), co = Math.cos(b.yaw);
          tf = rayCylinder(o, d, b.x + K.frame.z * s, b.z + K.frame.z * co, K.frame.r, b.y, b.y + K.height, EQUIP.grabReach);
        }
        if (tm !== null && face.front && (tf === null || tm <= tf + 0.02)) { part = 'module'; t = tm; }
        else if (tf !== null || (tm !== null && tm <= EQUIP.grabReach)) { part = 'frame'; t = Math.min(tf ?? Infinity, tm ?? Infinity); }
        else continue;
      }
      if (best && best.t <= t) continue;
      if (!this.clearTo(o, d, t)) continue;
      best = {unit: u, part, t};
    }
    return best;
  }

  /** Nothing structural between the eye and the hit at distance t: the level (walls / slabs) and the parked car's walls / leaves. */
  private clearTo(o: THREE.Vector3, d: THREE.Vector3, t: number): boolean {
    const L = this.host.levels!;
    const hit = {x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t};
    if (!L.lineOfSight(o, hit, {slack: 0.15})) return false;
    const col = this.rt?.train?.col;
    if (!col) return true;
    const B = this.boxScratch;
    const blocks = (p: PropPlacement) => {
      B.min.x = p.x - p.hx; B.min.y = p.y; B.min.z = p.z - p.hz;
      B.max.x = p.x + p.hx; B.max.y = p.y + p.h; B.max.z = p.z + p.hz;
      const tb = rayBox(o, d, B, t);
      return tb !== null && tb < t - 0.04;
    };
    for (const p of col.statics ?? []) if (blocks(p)) return false;
    for (const dr of col.doors ?? []) for (const p of dr.leaves) if (p.h > 0 && blocks(p)) return false;
    return true;
  }

  private updateAim(): void {
    const h = this.host;
    if (this.riding || h.state !== 'playing' || !h.player.alive || this.grab || this.held) { this.aim = null; this.prompt = null; return; }
    if (this.eHold) { this.aim = null; this.prompt = this.eHold.unit.def.move === 'carry' ? EQUIPMENT_TEXT.holding(this.eHold.unit.def.the) : this.prompt; return; }
    this.aim = this.pickAim();
    this.prompt = this.aim ? this.promptFor(this.aim.unit, this.aim.part) : null;
  }

  private promptFor(u: LiveUnit, part: AimPart): string {
    const use = this.uses[u.kind], def = u.def;
    if (use && part !== 'frame') {
      let text: string | null = null;
      try { text = use.prompt(u); } catch (err) { console.warn(`train equipment: the ${u.kind} prompt failed`, err); }
      if (text) return text;
    }
    if (def.move === 'carry') return use ? EQUIPMENT_TEXT.open(def.the) : EQUIPMENT_TEXT.carry(def.the);
    return EQUIPMENT_TEXT.grab(def.the, def.plug ? (u.plug !== null ? EQUIPMENT_TEXT.pluggedNote : EQUIPMENT_TEXT.plugHint) : '');
  }

  private setRoll(v: number): void {
    const q = Math.round(v * 50) / 50;
    if (q === this.roll01) return;
    this.roll01 = q;
    this.sfx?.cartRoll?.(q);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Lifts, the drawn pose

  /**
   * Units standing in a moving lift car ride it (world/towerRuntime.ts calls this with the car's dy each frame, like the fuel carts):
   * their height and storey follow the car. Returns the units carried.
   */
  carry(inside: (x: number, y: number, z: number) => boolean, dy: number, level: number): number {
    let n = 0;
    for (const u of this.list) {
      const b = u.body;
      if (u.mode !== 'world' || !inside(b.x, b.y, b.z)) continue;
      b.y += dy;
      if (b.level !== level) { b.level = level; this.markLevel(u); }
      n++;
    }
    this.counts.carried += n;
    return n;
  }

  /**
   * Some world unit's footprint satisfies `test(x, y, z, radius)` (world/towerRuntime.ts: a unit standing in a lift's doorway holds
   * the doors like a body does).
   */
  anyAt(test: (x: number, y: number, z: number, r: number) => boolean): boolean {
    for (const u of this.list) if (u.mode === 'world' && test(u.body.x, u.body.y, u.body.z, bodyRadius(u.body))) return true;
    return false;
  }

  private markLevel(u: LiveUnit): void {
    const level = u.mode === 'world' ? u.body.level : this.rt?.train?.placement.level ?? u.body.level;
    u.markedLevel = u.body.level;
    u.view.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
  }

  /** The unit is drawn off its upright stance (steps, a slope, a threshold): aim uses the drawn frame. */
  private tilted(u: LiveUnit): boolean {
    const p = u.pose;
    return u.mode === 'world' && (Math.abs(p.pitch) > 0.01 || Math.abs(p.roll) > 0.01 || Math.abs(p.dy) > 0.01);
  }

  /** The drawn pose follows the rest pose under the footprint (the fuel carts' rule): solved only when the body moved / still easing. */
  private solvePose(u: LiveUnit, dt: number, snap = false): void {
    const L = this.host.levels, b = u.body, q = u.solved;
    if (!L) return;
    const held = this.grab?.unit === u;
    const moved = q.x !== b.x || q.y !== b.y || q.z !== b.z || q.yaw !== b.yaw || held !== u.poseHeld;
    if (!snap && !moved && u.poseSettled) return;
    u.poseHeld = held;
    const T = cartRestPose(L, b, this.poseScratch, held), p = u.pose;
    q.x = b.x; q.y = b.y; q.z = b.z; q.yaw = b.yaw;
    this.counts.poses++;
    const k = snap ? 1 : 1 - Math.exp(-CART.poseRate * dt);
    p.dy += (T.dy - p.dy) * k; p.pitch += (T.pitch - p.pitch) * k; p.roll += (T.roll - p.roll) * k;
    if (Math.abs(T.dy - p.dy) < 5e-4 && Math.abs(T.pitch - p.pitch) < 1e-3 && Math.abs(T.roll - p.roll) < 1e-3) {
      p.dy = T.dy; p.pitch = T.pitch; p.roll = T.roll;
      u.poseSettled = true;
    } else u.poseSettled = false;
  }

  /** The view at the body + the drawn pose (matrix work only when something changed). */
  private draw(u: LiveUnit, force = false): void {
    const g = u.view.group, b = u.body, p = u.pose, d = u.drawn, y = b.y + p.dy;
    if (!force && d.x === b.x && d.y === y && d.z === b.z && d.yaw === b.yaw && d.pitch === p.pitch && d.roll === p.roll) return;
    d.x = b.x; d.y = y; d.z = b.z; d.yaw = b.yaw; d.pitch = p.pitch; d.roll = p.roll;
    g.position.set(b.x, y, b.z);
    g.rotation.set(-p.pitch, b.yaw, p.roll); // (order YXZ: +pitch lifts the front, +roll lifts the +x side)
    g.updateMatrixWorld(true);
  }

  /** A unit with nothing under it at its height (recorded in a lift shaft whose car stands elsewhere) is put on its column's surface. */
  private seat(u: LiveUnit): void {
    const L = this.host.levels, b = u.body;
    if (!L) return;
    if (L.supportIn(b.x, b.z, b.y, CART.step)) { u.unseated = 0; return; }
    const s = L.supportAt(b.x, b.z, b.y, CART.step) ?? L.supportAt(b.x, b.z, Infinity, CART.step);
    if (!s) { u.unseated--; return; }
    b.y = s.floor; b.level = s.level; b.vx = b.vz = 0;
    u.unseated = 0;
    this.counts.seated++;
    this.solvePose(u, 0, true);
  }

  /** EquipmentUnit.worldPose: see craft/equipmentApi.ts. */
  poseOf(u: LiveUnit): {x: number; y: number; z: number; yaw: number; level: number} | null {
    if (!this.worldLive || u.mode === 'held') return null;
    const b = u.body;
    if (u.mode === 'world') return {x: b.x, y: b.y, z: b.z, yaw: b.yaw, level: b.level};
    const rt = this.rt, p = rt?.train?.placement ?? null, ride = this.ride;
    const w = rt?.carPoint?.(u.local.x, u.local.y, u.local.z) ?? (p ? trainToWorld(p, u.local.x, u.local.y, u.local.z) : null);
    if (!w) return null;
    const carYaw = ride?.riding && ride.pose ? ride.pose.yaw : p?.yaw ?? 0;
    return {x: w.x, y: w.y, z: w.z, yaw: wrapYaw(u.local.yaw + carYaw), level: p?.level ?? 0};
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Warm-up + QA

  /** Hidden prototype (a view of every kind from the sources known now, both lamp materials, the stand-ins') + the sockets / cables. */
  warmRoots(): THREE.Object3D[] {
    this.look.poll(EQUIPMENT);
    if (!this.proto || this.protoGen !== this.look.gen) {
      this.proto?.removeFromParent();
      const g = new THREE.Group(), S = equipmentMaterials();
      g.name = 'train-equipment-warm-prototype';
      g.position.set(0, -1000, 0);
      g.visible = false;
      for (const kind of EQUIPMENT_KINDS) g.add(this.look.build(EQUIPMENT[kind]).group);
      for (const m of [S.standIn, S.standInFace, S.plugSteel, S.plugSocket, S.lampFree, S.lampOn]) {
        const mesh = new THREE.Mesh(this.fixtures.lamps[0]?.geometry ?? new THREE.BoxGeometry(0.01, 0.01, 0.01), m);
        mesh.name = `train-equipment-warm:${m.name}`;
        g.add(mesh);
      }
      this.host.atmosphere?.markShadows(g, false);
      this.group.add(g);
      this.proto = g;
      this.protoGen = this.look.gen;
    }
    return this.attachFixtures() ? [this.proto, this.fixtures.group] : [this.proto];
  }

  /** Every unit (live + waiting records) as readouts (QA). */
  all(): EquipmentReadout[] {
    const out: EquipmentReadout[] = [];
    for (const u of this.units()) {
      const w = this.poseOf(u) ?? {x: u.body.x, y: u.body.y, z: u.body.z, yaw: u.body.yaw, level: u.body.level};
      out.push({uid: u.uid, kind: u.kind, mode: u.mode, owner: this.isTrainOwned(u) ? 'train' : 'station', plug: u.plug, ammo: u.ammo, stacks: u.store?.used ?? 0,
        x: r4(w.x), y: r4(w.y), z: r4(w.z), yaw: r4(w.yaw), level: w.level});
    }
    for (const r of this.pending) out.push({uid: r.uid, kind: r.kind, mode: 'pending', owner: 'train', plug: r.plug ?? null, ammo: r.ammo ?? 0, stacks: (r.slots ?? []).filter(Boolean).length, x: r.x, y: r.y, z: r.z, yaw: r.yaw, level: -1});
    return out;
  }

  /** QA readout. */
  state() {
    return {
      worldLive: this.worldLive, units: this.all(), plugs: this.owners.map(u => u?.uid ?? null),
      grab: this.grab ? {uid: this.grab.unit.uid, lag: r4(this.grab.lag)} : null, held: this.held?.uid ?? null, holster: +this.holster.toFixed(2),
      hold: this.eHold ? {uid: this.eHold.unit.uid, part: this.eHold.part, t: r4(this.eHold.t)} : null,
      captured: this.captured ? {sawRide: this.captured.sawRide, idle: r4(this.captured.idle), swapped: !!this.captured.swap} : null,
      fixtures: !!this.fixtures.group.parent, lookGen: this.look.gen, prompt: this.prompt, counts: {...this.counts},
    };
  }

  /** QA: put a live world unit at rest beside plug `index` in the parked car (it connects on the next frames when the plug is free). */
  qaToPlug(uid: string, index: number): boolean {
    const u = this.unit(uid), p = this.parkedPlacement(), e = this.fixtures.plugs[index];
    if (!u || !p || !e || u.mode !== 'world') return false;
    if (this.grab?.unit === u) this.letGo('qa');
    const w = trainToWorld(p, e.x, this.spec.floorY, e.z - e.side * (u.def.radius + 0.3)), b = u.body;
    b.x = w.x; b.y = p.floorY; b.z = w.z; b.level = p.level; b.vx = b.vz = 0;
    b.yaw = wrapYaw((e.side > 0 ? Math.PI : 0) + p.yaw);
    u.awake = false;
    u.plugCheck = true;
    this.solvePose(u, 0, true);
    this.draw(u, true);
    return true;
  }
}

/** A lid's eased open fraction (smoothstep, like the Lockbox's). */
const ease = (t: number): number => t * t * (3 - 2 * t);
const bySeq = (a: {uid: string}, b: {uid: string}) => equipmentSeqOf(a.uid) - equipmentSeqOf(b.uid);
/** pickAim's scratch: whether the module ray met the console face. */
const FACE = {front: false};

/** Installs the train equipment (one call in the Game constructor; registries only). */
export function installTrainEquipment(game: Game, deps: TrainEquipmentDeps = {}): TrainEquipmentSystem {
  return new TrainEquipmentSystem(game as unknown as TrainEquipmentHost, deps).install();
}

/** QA hooks (spread into window.__LL) for a short serial browser spot check. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trainEquipmentQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {trainEquipment?: TrainEquipmentSystem};
  return {
    /** The train equipment: every unit (mode / owner / plug / ammo / stacks / pose), the plugs, the grab / carry / hold, counters. */
    equipment: () => g.trainEquipment?.state() ?? null,
    /** Craft one unit of `kind` on the parked car's floor (no materials: QA): its uid, or the refusal text. */
    equipmentCraft: (kind: EquipmentKind) => {
      const s = g.trainEquipment;
      if (!s || !isEquipmentKind(kind)) return 'unknown kind';
      return s.craft(kind)?.uid ?? s.craftBlock(kind);
    },
    /** Put a unit at rest beside plug `index` (0..2) of the parked car: it plugs in on the next frames when that plug is free. */
    equipmentToPlug: (uid: string, index: number) => g.trainEquipment?.qaToPlug(uid, index) ?? false,
  };
}
