// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART): the FUEL CARTS in the world — a hand truck carrying a drum of up to
// FUEL.cartUnits quarter units (two tanks), physically pushed / pulled by the player (NOT a drivable vehicle), a HOSE to the parked
// train's fuel cap, and the carts' OWNERSHIP between the stations and the train (cargo). Implements fuel/trainPort.ts FuelCartsLike for
// the lead's travel transaction. Installs itself through the Game's registries only (frameHooks, interactHandlers, promptProviders,
// inputOwners, modifierSources, hitListeners, stateListeners, sectionHooks, sectionPreloads, warmRegistry) and attaches the train fuel
// record's live cargo hook (run/playerTrain.ts TrainFuel.live) — no run participant of its own: cargo saves through TrainFuel, the
// station carts through the lead's FUEL_LANE coordinator (this module never writes FUEL_LANE).
//
// THE CART (world/fuelCartModel.ts): composed from the approved hand truck + (scaled) drum models, a runtime lid gauge. Its controller
// (world/fuelCartPhysics.ts) is kinematic: the player's own collision (walls, ledges, props, the parked car's volume / walls / door
// leaves / curbs) + a floor rule (never off a platform edge, no stairs).
//  - PUSH: walking into a free cart shoves it (slowly: 150 kg full); the player never walks through it.
//  - GRAB: aim at it within FUEL_CART.grabReach and press E: it follows a hand point FUEL_CART.hold m in front of the player on a damped
//    spring (pull it out of a corner, steer it), turning to trail the player; the player walks at FUEL_CART.speedMult (a modifier
//    source); the mouse buttons belong to the grab (inputOwners: no shot / ADS / item use / flare). E again, the player walking away /
//    the cart stuck, a hit, death, a ladder, any menu, the train departing, a world teardown let go.
//  - HOSE: with the cart within PORT.hoseMax of the parked train's fuel cap, E while aiming at the DRUM connects the hose (one pooled
//    tube); one unit flows every FUEL_CART.transferEvery s into game.playerTrain.fuel.tank (integers, conserved exactly, never past
//    FUEL.tankUnits); it disconnects on E, the tank full, the cart empty, the cart grabbed / pushed beyond the hose's reach, the train
//    departing or a teardown (a unit in progress is simply not transferred).
//
// OWNERSHIP (the rule): a cart wholly inside the PARKED car (trainPort.ts cartAboard on its train-local centre) at save / teardown time is
// the TRAIN's (TrainFuel cargo: CargoCartJSON, train-local pose); otherwise it belongs to the STATION (StationCartJSON world pose, saved by
// the lead in that station's FUEL_LANE). One uid moves between the records; every live cart is serialized exactly once.
//  - captureCargo() (the lead, right before the car moves; also automatic when a ride starts with carts aboard): the hoses disconnect,
//    the carts aboard become kinematic CARGO parented to the car's view root at their train-local poses (they ride the car through the
//    departure, the world teardown, the transit and the arrival: the view is held and adopted by world/playerTrain.ts), and the ride's
//    car-local collision model (world/trainRideLocal.ts) gets their footprints (the riding player cannot walk through them).
//  - releaseCargo() (the departure refused; also automatic once the ride has stopped at the parked placement): back to normal carts at
//    trainToWorld(placement, local) — at the NEW station after an arrival.
//  - A world teardown without a ride: carts aboard -> pending cargo records (spawned in the next world's parked car), the others -> the
//    station snapshot (stationRecords()).
//  - restore(cargo) (TrainFuel.load / reset: Load, Continue, Retry, New Game): idempotent, safe before / after a world exists: the old
//    cargo goes, the records wait until a world with a parked car exists.
// PERFORMANCE: only carts near the player (or moving / grabbed) step; sleeping carts cost a distance test; the hose rewrites one fixed
// geometry in place; materials / geometry are shared; a hidden prototype is warmed with the station (pool 'fuel-carts').
// LIMITS: enemies walk through carts and bullets do not move them (no hitscan target); a train door closes through a cart standing in
// the doorway (only bodies block the doors) — a departure is refused while one straddles (departBlock).

import * as THREE from 'three';
import type {Game} from '../game';
import type {Levels} from '../gen/levels';
import type {PropPlacement} from '../gen/props';
import {PropIndex} from '../core/physics';
import {FUEL, cartProblem, tanksText, type CargoCartJSON, type CartFuel, type StationCartJSON} from '../fuel/fuel';
import {PORT, cartAboard, cartStraddles, fuelPortLocal, type FuelCartsLike} from '../fuel/trainPort';
import {playerTrainPlacement, trainToWorld, worldToTrain, type TrainPlacement} from '../gen/playerTrain';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {RIDE_FRAME, type RideLocalModel} from './trainRideLocal';
import {rayBox, rayCylinder, type Box3Like, type P3} from './towerShared';
import {CART, cartFloorAt, pushByPlayer, separateCarts, separatePlayer, stepCart, turnToward, wrapYaw, type CartBody, type CartTarget, type CartWorld} from './fuelCartPhysics';
import {CART_LOOK, CartHose, buildCartView, cartMaterials, cartModelsGen, loadCartModels, refreshCartBody, setGauge, type CartView} from './fuelCartModel';

export const FUEL_CART = {
  /** Aim reach (eye -> the hit point, m): the handle / frame (grab) and the drum (hose, else grab). */
  grabReach: 1.6,
  drumReach: 1.8,
  /** A grabbed cart's centre this far in front of the player (m). */
  hold: 1.0,
  /** The player this far from a grabbed cart lets go (m). */
  farDist: 2.4,
  /** Walking speed while dragging a cart. */
  speedMult: 0.6,
  /** One quarter unit flows through the hose every transferEvery s. */
  transferEvery: 1.2,
  /** Carts farther than this from the player are not stepped (unless grabbed / moving) (m). */
  activeRange: 16,
  /** A connected hose re-checks reach against PORT.hoseMax from the nozzle to the cap. */
  hoseMax: PORT.hoseMax,
  /** Seconds a captured cargo waits for a ride to start before it is released in place (the lead captured without departing). */
  captureGrace: 1.0,
  /** Model fetch wait behind the loading screen (ms). */
  modelWaitMs: 8000,
} as const;

export const CART_TEXT = {
  connected: 'Hose connected — fuelling',
  full: 'Tank full — hose disconnected',
  empty: 'Cart empty',
  disconnected: 'Hose disconnected',
  pulled: 'The hose pulled free',
  stuck: 'The cart is stuck — you let go',
  straddle: 'A fuel cart is in the doorway — push it all the way in or out',
} as const;

type Mode = 'world' | 'cargo';

interface Cart {
  readonly uid: string;
  /** The live fuel (aboard() hands these out: the departure debit mutates `units`). */
  readonly fuel: CartFuel;
  /** World pose / motion (mode 'world'). */
  readonly body: CartBody;
  /** Train-local pose (mode 'cargo'). */
  readonly local: {x: number; y: number; z: number; yaw: number};
  mode: Mode;
  readonly view: CartView;
  awake: boolean;
}

/** A readout of one cart (the lead's map stock / QA). */
export interface FuelCartReadout {
  uid: string; units: number;
  /** 'train' = wholly inside the parked car (or riding as cargo), 'station' = lying in the station. */
  owner: 'train' | 'station';
  mode: Mode | 'pending';
  x: number; y: number; z: number; level: number;
}

interface TrainRuntimeLike {
  spec?: PlayerTrainSpec;
  train: {placement: TrainPlacement; col?: {statics?: readonly PropPlacement[]; doors?: readonly {leaves: readonly PropPlacement[]}[]}} | null;
  readonly view: {root: THREE.Object3D} | null;
}
interface TrainRideLike { riding: boolean; moving: boolean; phase?: string; model?: RideLocalModel }
interface TrainFuelLike { tank: number; live: {cargo(): CargoCartJSON[]; restore(c: CargoCartJSON[]): void} | null; setCargo?(c: readonly CargoCartJSON[]): void }

/** What the carts need from Game (structural: tests drive them with a fake host + the real Player / train runtime / ride). */
export interface FuelCartHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; vx: number; vz: number; yaw: number; radius: number; alive: boolean; climbing: boolean; bodyHeight?: number};
  levels: Levels | null;
  propIndex: PropIndex | null;
  trainPlacement: TrainPlacement | null;
  trainRuntime?: TrainRuntimeLike | null;
  trainRide?: TrainRideLike | null;
  playerTrain: {fuel: TrainFuelLike};
  hud: {toast(text: string, warn?: boolean): void};
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
}

interface CartSfx {
  hoseConnect?(on: boolean): void;
  fuelPour?(): void;
  cartRoll?(speed01: number): void;
  denied?(): void;
}

const NO_MODS = Object.freeze({});
const DRAG_MODS = Object.freeze({speedMult: FUEL_CART.speedMult});
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export class FuelCarts implements FuelCartsLike {
  /** World carts live under this group (cargo under the car's view root). */
  readonly group = new THREE.Group();
  readonly hose = new CartHose();
  /** Live carts (world + cargo), in spawn order. */
  private readonly carts: Cart[] = [];
  /** Cargo waiting for a world with a parked car (no view). Their objects ARE CartFuel (uid / units). */
  private pendingCargo: CargoCartJSON[] = [];
  /** Station carts handed over (loadStation / spawn) before this world was built. */
  private pendingStation: StationCartJSON[] = [];
  /** The last torn-down station's carts (stationRecords() between worlds). */
  private stationSnapshot: StationCartJSON[] | null = null;
  /** A world is built (between this system's build and teardown hooks). */
  worldLive = false;
  /** The grabbed cart (null: none). */
  grab: {cart: Cart; lag: number} | null = null;
  /** The connected hose (null: none). */
  hoseOn: {cart: Cart; t: number} | null = null;
  /** Captured cargo: whether a ride was seen, idle seconds without one, the ride model's collision swap. */
  private captured: {sawRide: boolean; idle: number; swap: {model: RideLocalModel; orig: PropIndex; mine: PropIndex} | null} | null = null;
  /** The cart / part under the crosshair (this frame) and the prompt. */
  aim: {cart: Cart; part: 'frame' | 'drum'; t: number} | null = null;
  prompt: string | null = null;
  /** QA / tests. */
  readonly counts = {spawned: 0, captured: 0, released: 0, grabs: 0, letGo: 0, connects: 0, disconnects: 0, transfers: 0, pushes: 0, restores: 0, steps: 0};
  private proto: THREE.Group | null = null;
  private protoGen = -1;
  private modelsGen = cartModelsGen;
  private roll01 = 0;
  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly target: CartTarget = {x: 0, z: 0, vx: 0, vz: 0};
  private readonly boxScratch: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};
  private readonly world: CartWorld = {levels: null as unknown as Levels, props: null};

  constructor(readonly host: FuelCartHost) {
    this.group.name = 'fuel-carts';
    this.group.add(this.hose.mesh);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Registration

  install(): this {
    const h = this.host;
    h.scene.add(this.group);
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.onInteract());
    h.promptProviders?.push(() => this.prompt);
    h.inputOwners?.push(() => !!this.grab);
    h.modifierSources?.push(() => (this.grab ? DRAG_MODS : NO_MODS));
    h.hitListeners?.push((() => { if (this.grab) this.letGo('hit'); }) as (hit: never) => void);
    h.stateListeners?.push(((s: string) => {
      if (s === 'playing') return;
      if (this.grab) this.letGo('menu');
      this.aim = null;
      this.prompt = null;
      this.setRoll(0);
    }) as (s: never, p: never) => void);
    h.sectionHooks.push({build: () => this.onBuild(), teardown: () => this.onTeardown()});
    // the two models behind the loading screen of any station that parks the train (a cart can stand / ride in any of them)
    h.sectionPreloads?.push(((layout: Parameters<typeof playerTrainPlacement>[0]) => (playerTrainPlacement(layout)
      ? Promise.race([loadCartModels().then(() => undefined), new Promise<void>(r => setTimeout(r, FUEL_CART.modelWaitMs))])
      : Promise.resolve())) as (layout: never) => Promise<void>);
    h.warmRegistry.addPool('fuel-carts', () => this.warmRoots());
    h.playerTrain.fuel.live = {cargo: () => this.cargo(), restore: c => this.restore(c)};
    return this;
  }

  private get rt(): TrainRuntimeLike | null { return this.host.trainRuntime ?? null; }
  private get ride(): TrainRideLike | null { return this.host.trainRide ?? null; }
  private get spec(): PlayerTrainSpec { return this.rt?.spec ?? PLAYER_TRAIN_SPEC; }
  private get sfx(): CartSfx | null { return (this.host.sfx as CartSfx | null) ?? null; }
  private get riding(): boolean { return !!this.ride?.riding; }

  /** The car's placement right now: the built train's, else the level's (a build in progress). */
  private placement(): TrainPlacement | null {
    return this.rt?.train?.placement ?? this.host.trainPlacement ?? null;
  }

  /** The car stands parked (built, not riding). */
  private parkedPlacement(): TrainPlacement | null {
    return this.riding ? null : this.rt?.train?.placement ?? null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // FuelCartsLike (the lead's travel transaction)

  /** Carts wholly inside the parked car (+ riding cargo, + cargo waiting for a world): their LIVE fuel objects. */
  aboard(): CartFuel[] {
    const out: CartFuel[] = [];
    for (const c of this.carts) if (this.isTrainOwned(c)) out.push(c.fuel);
    for (const c of this.pendingCargo) out.push(c);
    return out;
  }

  /** A cart straddling the car's outline (a doorway / against the skin): the refusal text, else null. */
  departBlock(): string | null {
    const p = this.placement();
    if (!p) return null;
    for (const c of this.carts) {
      if (c.mode !== 'world') continue;
      const q = worldToTrain(p, c.body.x, c.body.y, c.body.z);
      if (Math.abs(q.y - this.spec.floorY) > 1.2) continue; // (a cart down in the bed / on another storey is not at the car)
      if (cartStraddles(q.x, q.z, PORT.cartRadius, this.spec)) return CART_TEXT.straddle;
    }
    return null;
  }

  /** Right before the car moves: hoses off, the carts aboard become cargo riding the car's view root. Idempotent. */
  captureCargo(): void {
    const rt = this.rt, root = rt?.view?.root, p = rt?.train?.placement;
    if (!root || !p) return;
    if (this.hoseOn) this.disconnect(null);
    let n = 0;
    for (const c of this.carts) {
      if (c.mode !== 'world' || !this.insideCar(c, p)) continue;
      if (this.grab?.cart === c) this.letGo('capture');
      const q = worldToTrain(p, c.body.x, c.body.y, c.body.z);
      c.local.x = q.x; c.local.y = this.spec.floorY; c.local.z = q.z; c.local.yaw = wrapYaw(c.body.yaw - p.yaw);
      c.body.vx = c.body.vz = 0;
      c.mode = 'cargo';
      c.awake = false;
      root.add(c.view.group);
      c.view.group.position.set(c.local.x, c.local.y, c.local.z);
      c.view.group.rotation.set(0, c.local.yaw, 0);
      c.view.group.updateMatrixWorld(true);
      n++;
    }
    if (!this.carts.some(c => c.mode === 'cargo')) return;
    if (!this.captured) this.captured = {sawRide: this.riding, idle: 0, swap: null};
    if (n) { this.counts.captured += n; this.swapRideCollision(); }
  }

  /** The departure was refused before the car left: cargo back to ordinary carts where they stand (no-op while the car moves). */
  releaseCargo(): void {
    if (this.ride?.moving) return;
    this.release();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Persistence (TrainFuel.live; the lead's FUEL_LANE coordinator)

  /** The train's cargo records (train-local; uid order): carts wholly inside the parked car, riding cargo, pending cargo. */
  cargo(): CargoCartJSON[] {
    const out: CargoCartJSON[] = [];
    const p = this.placement();
    for (const c of this.carts) {
      if (c.mode === 'cargo') out.push({uid: c.uid, units: c.fuel.units, x: r4(c.local.x), y: r4(c.local.y), z: r4(c.local.z), yaw: r4(wrapYaw(c.local.yaw))});
      else if (p && this.insideCar(c, p)) {
        const q = worldToTrain(p, c.body.x, c.body.y, c.body.z);
        out.push({uid: c.uid, units: c.fuel.units, x: r4(q.x), y: r4(this.spec.floorY), z: r4(q.z), yaw: r4(wrapYaw(c.body.yaw - p.yaw))});
      }
    }
    for (const c of this.pendingCargo) out.push({uid: c.uid, units: c.units, x: c.x, y: c.y, z: c.z, yaw: c.yaw});
    return out.sort(byUid);
  }

  /** Retry / Load / Continue / New Game (TrainFuel.load / reset): the cargo becomes exactly `c` (idempotent; before or after a world). */
  restore(c: readonly CargoCartJSON[]): void {
    this.counts.restores++;
    if (this.grab) this.letGo('restore');
    if (this.hoseOn) this.disconnect(null);
    const p = this.placement();
    for (let i = this.carts.length - 1; i >= 0; i--) {
      const k = this.carts[i];
      if (k.mode === 'cargo' || (p && this.insideCar(k, p))) this.removeAt(i);
    }
    this.unswapRideCollision();
    this.captured = null;
    const seen = new Set<string>();
    this.pendingCargo = [];
    for (const x of c ?? []) {
      if (cartProblem(x, false) !== null || seen.has(x.uid)) continue;
      seen.add(x.uid);
      this.pendingCargo.push({uid: x.uid, units: x.units, x: x.x, y: x.y, z: x.z, yaw: x.yaw});
    }
    // the train's cargo wins a uid clash with a station cart of the old world (never two live carts with one id)
    for (let i = this.carts.length - 1; i >= 0; i--) if (seen.has(this.carts[i].uid)) this.removeAt(i);
    this.pendingStation = this.pendingStation.filter(s => !seen.has(s.uid));
    this.spawnPendingCargo();
  }

  /** The station-owned carts (world poses): live while a world exists, else the last torn-down station's snapshot. */
  stationRecords(): StationCartJSON[] {
    if (!this.worldLive) return (this.stationSnapshot ?? []).map(s => ({...s}));
    const out: StationCartJSON[] = [];
    for (const c of this.carts) if (!this.isTrainOwned(c)) out.push(this.stationRecord(c));
    return out.sort(byUid);
  }

  /** The station's carts are exactly `recs` (replacing the station carts now live; cargo kept). Before a build they wait for it. */
  loadStation(recs: readonly StationCartJSON[]): void {
    const valid = this.dedupe(recs, true);
    this.stationSnapshot = null;
    if (!this.worldLive) { this.pendingStation = valid; return; }
    if (this.grab && !this.isTrainOwned(this.grab.cart)) this.letGo('restore');
    if (this.hoseOn && !this.isTrainOwned(this.hoseOn.cart)) this.disconnect(null);
    for (let i = this.carts.length - 1; i >= 0; i--) if (!this.isTrainOwned(this.carts[i])) this.removeAt(i);
    for (const r of valid) this.spawnWorld(r);
  }

  /** One station cart (the lead's plan realization; a uid already known anywhere is ignored). Before a build it waits for it. */
  spawn(rec: StationCartJSON): void {
    const [r] = this.dedupe([rec], false);
    if (!r) return;
    if (!this.worldLive) { this.pendingStation.push(r); return; }
    this.spawnWorld(r);
  }

  /** Every cart (live + pending cargo) as readouts. */
  all(): FuelCartReadout[] {
    const out: FuelCartReadout[] = [];
    const p = this.placement();
    for (const c of this.carts) {
      const w = c.mode === 'cargo' && p ? trainToWorld(p, c.local.x, c.local.y, c.local.z) : {x: c.body.x, y: c.body.y, z: c.body.z};
      out.push({uid: c.uid, units: c.fuel.units, owner: this.isTrainOwned(c) ? 'train' : 'station', mode: c.mode, x: r4(w.x), y: r4(w.y), z: r4(w.z), level: c.mode === 'cargo' ? p?.level ?? 0 : c.body.level});
    }
    for (const c of this.pendingCargo) out.push({uid: c.uid, units: c.units, owner: 'train', mode: 'pending', x: c.x, y: c.y, z: c.z, level: -1});
    return out;
  }

  /** Live world carts within r (m, horizontal) of (x, z) (optionally on one storey). */
  cartsNear(x: number, z: number, r: number, level?: number): FuelCartReadout[] {
    return this.all().filter(c => c.mode === 'world' && Math.hypot(c.x - x, c.z - z) <= r && (level === undefined || c.level === level));
  }

  /** Units lying in the current station (station-owned carts): the map's stock. */
  stationUnits(): number {
    return this.stationRecords().reduce((s, c) => s + c.units, 0);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  private onBuild(): void {
    this.worldLive = true;
    this.stationSnapshot = null;
    const st = this.pendingStation;
    this.pendingStation = [];
    for (const r of st) this.spawnWorld(r);
    this.spawnPendingCargo();
  }

  private onTeardown(): void {
    if (this.grab) this.letGo('teardown');
    if (this.hoseOn) this.disconnect(null);
    this.aim = null;
    this.prompt = null;
    this.setRoll(0);
    const keepCargo = this.riding && !!this.captured; // the riding car keeps its cargo through the teardown (the view is held)
    const p = this.placement();
    const station: StationCartJSON[] = [];
    for (let i = this.carts.length - 1; i >= 0; i--) {
      const c = this.carts[i];
      if (c.mode === 'cargo') {
        if (keepCargo) continue;
        this.pendingCargo.push({uid: c.uid, units: c.fuel.units, x: c.local.x, y: c.local.y, z: c.local.z, yaw: wrapYaw(c.local.yaw)});
      } else if (p && this.insideCar(c, p)) {
        const q = worldToTrain(p, c.body.x, c.body.y, c.body.z);
        this.pendingCargo.push({uid: c.uid, units: c.fuel.units, x: r4(q.x), y: r4(this.spec.floorY), z: r4(q.z), yaw: r4(wrapYaw(c.body.yaw - p.yaw))});
      } else station.push(this.stationRecord(c));
      this.removeAt(i);
    }
    if (!keepCargo) { this.unswapRideCollision(); this.captured = null; }
    this.pendingCargo.sort(byUid);
    this.stationSnapshot = station.sort(byUid);
    this.worldLive = false;
    this.host.playerTrain.fuel.setCargo?.(this.cargo());
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Per frame

  frame(dt: number): void {
    if (!this.worldLive) { this.prompt = null; return; }
    if (this.modelsGen !== cartModelsGen) { this.modelsGen = cartModelsGen; for (const c of this.carts) refreshCartBody(c.view); }
    this.followRide(dt);
    if (this.pendingCargo.length) this.spawnPendingCargo();
    const h = this.host, P = h.player, riding = this.riding;
    this.world.levels = h.levels!;
    this.world.props = h.propIndex;
    if (!h.levels) return;
    // a grab ends with the player out of action / riding / gone too far
    if (this.grab && (!P.alive || P.climbing || riding || this.grab.cart.mode !== 'world')) this.letGo(riding ? 'capture' : 'state');
    let fastest = 0;
    for (const c of this.carts) {
      if (c.mode !== 'world') continue;
      c.body.units = c.fuel.units;
      const dx = c.body.x - P.x, dz = c.body.z - P.z, d = Math.hypot(dx, dz);
      const grabbed = this.grab?.cart === c;
      if (!grabbed && !c.awake && d > FUEL_CART.activeRange) continue;
      if (grabbed) {
        // the hand point FUEL_CART.hold in front of the player (horizontal look), moving with the player
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), T = this.target;
        T.x = P.x + fx * FUEL_CART.hold; T.z = P.z + fz * FUEL_CART.hold; T.vx = P.vx; T.vz = P.vz;
        const moved = stepCart(c.body, this.world, dt, T);
        this.counts.steps++;
        if (moved > 0 || d > 0.05) c.body.yaw = turnToward(c.body.yaw, Math.atan2(c.body.x - P.x, c.body.z - P.z), CART.grab.turnRate, dt);
        const lag = Math.hypot(T.x - c.body.x, T.z - c.body.z);
        this.grab!.lag = lag > CART.grab.breakDist ? this.grab!.lag + dt : 0;
        if (this.grab!.lag > CART.grab.breakTime || Math.hypot(c.body.x - P.x, c.body.z - P.z) > FUEL_CART.farDist) this.letGo('stuck');
        c.awake = true;
      } else {
        if (!riding && P.alive && d < P.radius + CART.radius + 0.05 && pushByPlayer(c.body, P, dt)) { c.awake = true; this.counts.pushes++; }
        if (c.awake) {
          stepCart(c.body, this.world, dt, null);
          this.counts.steps++;
          if (Math.hypot(c.body.vx, c.body.vz) < CART.sleep) { c.body.vx = c.body.vz = 0; c.awake = false; }
        }
      }
      fastest = Math.max(fastest, Math.hypot(c.body.vx, c.body.vz));
    }
    // carts against each other (bounded: live carts only, near the player)
    for (let i = 0; i < this.carts.length; i++) {
      const a = this.carts[i];
      if (a.mode !== 'world') continue;
      for (let j = i + 1; j < this.carts.length; j++) {
        const b = this.carts[j];
        if (b.mode !== 'world' || (!a.awake && !b.awake)) continue;
        if (separateCarts(a.body, b.body, this.world)) { a.awake = b.awake = true; }
      }
    }
    // the player never stands inside a cart (the ride moves the player in the car frame: not here)
    if (!riding && P.alive) for (const c of this.carts) if (c.mode === 'world') separatePlayer(c.body, P, this.world);
    for (const c of this.carts) {
      if (c.mode !== 'world') continue;
      const g = c.view.group;
      if (g.position.x !== c.body.x || g.position.y !== c.body.y || g.position.z !== c.body.z || g.rotation.y !== c.body.yaw) {
        g.position.set(c.body.x, c.body.y, c.body.z);
        g.rotation.set(0, c.body.yaw, 0);
        g.updateMatrixWorld(true);
      }
      setGauge(c.view, c.fuel.units);
    }
    for (const c of this.carts) if (c.mode === 'cargo') setGauge(c.view, c.fuel.units);
    this.stepHose(dt);
    this.setRoll(Math.min(1, fastest / 2.2));
    this.updateAim();
  }

  /** The ride: capture carts aboard when it starts; release the cargo once it has stopped (or never started). */
  private followRide(dt: number): void {
    const ride = this.ride;
    if (ride?.riding) {
      if (this.captured) this.captured.sawRide = true;
      // (before the car has left: the carts aboard ride with it even when the lead did not capture them first)
      if (ride.phase === undefined || ride.phase === 'closing' || ride.phase === 'departing') {
        const p = this.rt?.train?.placement;
        if (p && this.carts.some(c => c.mode === 'world' && this.insideCar(c, p))) this.captureCargo();
      }
      return;
    }
    if (!this.captured) return;
    this.captured.idle += dt;
    if (this.captured.sawRide || this.captured.idle > FUEL_CART.captureGrace) this.release();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Hose

  /** Why the hose cannot connect to `c` now (null = it can). */
  connectBlock(c: Cart): string | null {
    const p = this.parkedPlacement();
    if (!p || c.mode !== 'world') return 'There is no train here';
    if (this.grab?.cart === c) return 'Let go of the cart first';
    if (this.nozzleToCap(c, p) > FUEL_CART.hoseMax) return 'Too far from the fuel cap';
    if (c.fuel.units <= 0) return CART_TEXT.empty;
    if (this.host.playerTrain.fuel.tank >= FUEL.tankUnits) return 'The train tank is full';
    return null;
  }

  private connect(c: Cart): void {
    this.hoseOn = {cart: c, t: 0};
    this.counts.connects++;
    this.hose.mesh.visible = true;
    this.shapeHose();
    this.host.hud.toast(CART_TEXT.connected);
    this.sfx?.hoseConnect?.(true);
  }

  /** Disconnect (a toast `text`, null = silently: teardown / restore / capture). The unit in progress is not transferred. */
  private disconnect(text: string | null, warn = false): void {
    if (!this.hoseOn) return;
    this.hoseOn = null;
    this.counts.disconnects++;
    this.hose.mesh.visible = false;
    if (text) this.host.hud.toast(text, warn);
    this.sfx?.hoseConnect?.(false);
  }

  private stepHose(dt: number): void {
    const H = this.hoseOn;
    if (!H) return;
    const c = H.cart, p = this.parkedPlacement(), fuel = this.host.playerTrain.fuel;
    if (!p || c.mode !== 'world' || !this.carts.includes(c)) { this.disconnect(null); return; }
    if (this.grab?.cart === c) { this.disconnect(CART_TEXT.disconnected); return; }
    if (this.nozzleToCap(c, p) > FUEL_CART.hoseMax) { this.disconnect(CART_TEXT.pulled, true); return; }
    if (fuel.tank >= FUEL.tankUnits) { this.disconnect(CART_TEXT.full); return; }
    if (c.fuel.units <= 0) { this.disconnect(CART_TEXT.empty, true); return; }
    H.t += dt;
    if (H.t >= FUEL_CART.transferEvery) {
      H.t -= FUEL_CART.transferEvery;
      // one whole unit: out of the drum, into the tank (integers; never past the tank's capacity)
      c.fuel.units -= 1;
      fuel.tank = Math.min(FUEL.tankUnits, fuel.tank + 1);
      this.counts.transfers++;
      this.sfx?.fuelPour?.();
      setGauge(c.view, c.fuel.units);
      if (fuel.tank >= FUEL.tankUnits) { this.disconnect(CART_TEXT.full); return; }
      if (c.fuel.units <= 0) { this.disconnect(CART_TEXT.empty, true); return; }
    }
    this.shapeHose();
  }

  private shapeHose(): void {
    const H = this.hoseOn, p = this.parkedPlacement();
    if (!H || !p) return;
    const a = this.nozzleWorld(H.cart), b = this.capWorld(p);
    this.hose.update(a.x, a.y, a.z, b.x, b.y, b.z, Math.min(H.cart.body.y, p.floorY));
  }

  private nozzleWorld(c: Cart): P3 {
    const N = CART_LOOK.nozzle, s = Math.sin(c.body.yaw), co = Math.cos(c.body.yaw);
    return {x: c.body.x + N.x * co + N.z * s, y: c.body.y + N.y, z: c.body.z - N.x * s + N.z * co};
  }

  private capWorld(p: TrainPlacement): P3 {
    const q = fuelPortLocal(this.spec);
    return trainToWorld(p, q.x, q.y, q.z);
  }

  private nozzleToCap(c: Cart, p: TrainPlacement): number {
    const a = this.nozzleWorld(c), b = this.capWorld(p);
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Grab / aim / prompt / E

  private startGrab(c: Cart): void {
    if (this.hoseOn?.cart === c) this.disconnect(CART_TEXT.disconnected);
    this.grab = {cart: c, lag: 0};
    c.awake = true;
    this.counts.grabs++;
  }

  /** Let go of the grabbed cart (`why` for QA). */
  letGo(why: string): void {
    if (!this.grab) return;
    const c = this.grab.cart;
    this.grab = null;
    this.counts.letGo++;
    if (why === 'stuck') this.host.hud.toast(CART_TEXT.stuck);
    void c;
  }

  /** [E]: let go; else on the aimed cart — the hose (drum, in reach) or the grab. Only when a cart is the aim target. */
  onInteract(): boolean {
    if (this.grab) { this.letGo('user'); return true; }
    if (!this.worldLive || this.riding || this.host.state !== 'playing') return false;
    const aim = this.pickAim();
    if (!aim) return false;
    const c = aim.cart;
    if (this.hoseOn?.cart === c) { this.disconnect(CART_TEXT.disconnected); return true; }
    if (aim.part === 'drum' && this.connectBlock(c) === null) {
      if (this.hoseOn) this.disconnect(null);
      this.connect(c);
      return true;
    }
    this.startGrab(c);
    return true;
  }

  /** The cart part under the crosshair within reach, nothing structural in between (null: none). */
  pickAim(): {cart: Cart; part: 'frame' | 'drum'; t: number} | null {
    const h = this.host, L = h.levels;
    if (!L) return null;
    h.camera.getWorldPosition(this.eye);
    h.camera.getWorldDirection(this.dir);
    const o = this.eye, d = this.dir;
    let best: {cart: Cart; part: 'frame' | 'drum'; t: number} | null = null;
    const K = CART_LOOK;
    for (const c of this.carts) {
      if (c.mode !== 'world') continue;
      const b = c.body;
      if (Math.hypot(b.x - o.x, b.z - o.z) > FUEL_CART.drumReach + 0.8) continue;
      const s = Math.sin(b.yaw), co = Math.cos(b.yaw);
      const tf = rayCylinder(o, d, b.x + K.frame.z * s, b.z + K.frame.z * co, K.frame.r, b.y, b.y + K.height, FUEL_CART.grabReach);
      const td = rayCylinder(o, d, b.x + K.drumZ * s, b.z + K.drumZ * co, K.drumR + 0.02, b.y + K.drumBase, b.y + K.drumTop + 0.03, FUEL_CART.drumReach);
      const part = td !== null && (tf === null || td <= tf) ? 'drum' : tf !== null ? 'frame' : null;
      if (!part) continue;
      const t = part === 'drum' ? td! : tf!;
      if (best && best.t <= t) continue;
      if (!this.clearTo(o, d, t)) continue;
      best = {cart: c, part, t};
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
    if (this.riding || h.state !== 'playing' || !h.player.alive) { this.aim = null; this.prompt = null; return; }
    if (this.grab) { this.aim = null; this.prompt = `<b>[E]</b> Let go · ${tanksText(this.grab.cart.fuel.units)}`; return; }
    this.aim = this.pickAim();
    this.prompt = this.aim ? this.promptFor(this.aim.cart, this.aim.part) : null;
  }

  private promptFor(c: Cart, part: 'frame' | 'drum'): string {
    const tank = this.host.playerTrain.fuel.tank;
    if (this.hoseOn?.cart === c) return `<b>[E]</b> Disconnect the hose · fuelling · train tank ${tanksText(tank)}`;
    if (part === 'drum' && this.connectBlock(c) === null) return `<b>[E]</b> Connect the hose · cart ${tanksText(c.fuel.units)} · train tank ${tanksText(tank)}`;
    const note = part === 'drum' && this.parkedPlacement() && this.nozzleToCap(c, this.parkedPlacement()!) <= FUEL_CART.hoseMax && tank >= FUEL.tankUnits ? ' · train tank full' : '';
    return `<b>[E]</b> Grab the fuel cart · ${tanksText(c.fuel.units)}${note}`;
  }

  private setRoll(v: number): void {
    const q = Math.round(v * 50) / 50;
    if (q === this.roll01) return;
    this.roll01 = q;
    this.sfx?.cartRoll?.(q);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Cargo internals

  /** The cart is the TRAIN's now: riding cargo, or a world cart wholly inside the car at its placement. */
  private isTrainOwned(c: Cart): boolean {
    if (c.mode === 'cargo') return true;
    const p = this.placement();
    return !!p && this.insideCar(c, p);
  }

  /** A world cart wholly inside the car at placement p (cartAboard on its train-local centre, standing on the car floor). */
  private insideCar(c: Cart, p: TrainPlacement): boolean {
    const q = worldToTrain(p, c.body.x, c.body.y, c.body.z);
    return Math.abs(q.y - this.spec.floorY) < 0.3 && cartAboard(q.x, q.z, PORT.cartRadius, this.spec);
  }

  /** Cargo -> ordinary carts at the parked car's placement (an arrival: the NEW station's); without a car -> pending records. */
  private release(): void {
    const cargo = this.carts.filter(c => c.mode === 'cargo');
    this.unswapRideCollision();
    this.captured = null;
    if (!cargo.length) return;
    const rt = this.rt, p = rt?.train?.placement ?? null;
    for (const c of cargo) {
      if (!p || !this.worldLive) {
        this.pendingCargo.push({uid: c.uid, units: c.fuel.units, x: c.local.x, y: c.local.y, z: c.local.z, yaw: wrapYaw(c.local.yaw)});
        this.removeAt(this.carts.indexOf(c));
        continue;
      }
      const w = trainToWorld(p, c.local.x, c.local.y, c.local.z);
      const f = this.host.levels ? cartFloorAt(this.host.levels, w.x, w.z, w.y + 0.05) : null;
      c.body.x = w.x; c.body.z = w.z; c.body.y = f?.floor ?? w.y; c.body.level = f?.level ?? p.level;
      c.body.yaw = wrapYaw(c.local.yaw + p.yaw);
      c.body.vx = c.body.vz = 0;
      c.mode = 'world';
      c.awake = false;
      this.group.add(c.view.group);
      c.view.group.position.set(c.body.x, c.body.y, c.body.z);
      c.view.group.rotation.set(0, c.body.yaw, 0);
      c.view.group.updateMatrixWorld(true);
      this.markLevel(c);
      this.counts.released++;
    }
    this.pendingCargo.sort(byUid);
  }

  /** The riding player collides with the cargo: the ride's car-local model gets their footprints (restored on release). */
  private swapRideCollision(): void {
    const model = this.ride?.model;
    if (!model || !this.captured) return;
    const orig = this.captured.swap?.orig ?? model.props;
    const H = this.spec.ceilingY + 3;
    const boxes: PropPlacement[] = this.carts.filter(c => c.mode === 'cargo').map(c => ({
      kind: 'column', x: c.local.x + RIDE_FRAME.ox, z: c.local.z + RIDE_FRAME.oz, y: -1, rot: 0, area: -1,
      hx: CART.radius, hz: CART.radius, h: H, blocksSight: false, variant: 0, level: 0, round: true,
    }));
    const mine = new PropIndex(model.levels, [...model.boxes, ...boxes]);
    model.props = mine;
    this.captured.swap = {model, orig, mine};
  }

  private unswapRideCollision(): void {
    const s = this.captured?.swap;
    if (!s) return;
    if (s.model.props === s.mine) s.model.props = s.orig;
    this.captured!.swap = null;
  }

  /** Pending cargo -> live carts inside the parked car (needs a world with a parked car, not riding). */
  private spawnPendingCargo(): void {
    if (!this.worldLive || this.riding || !this.pendingCargo.length) return;
    const p = this.rt?.train?.placement ?? this.host.trainPlacement;
    if (!p) return;
    const I = this.spec.interior, r = PORT.cartRadius;
    const recs = this.pendingCargo;
    this.pendingCargo = [];
    for (const k of recs) {
      // (a pose from a save is clamped into the walkable interior: always wholly aboard)
      const lx = Math.max(I.x0 + r + 0.01, Math.min(I.x1 - r - 0.01, k.x)), lz = Math.max(-I.halfWidth + r + 0.01, Math.min(I.halfWidth - r - 0.01, k.z));
      const w = trainToWorld(p, lx, this.spec.floorY, lz);
      this.spawnWorld({uid: k.uid, units: k.units, x: w.x, y: p.floorY, z: w.z, yaw: wrapYaw(k.yaw + p.yaw), level: p.level}, k);
    }
  }

  /** A live world cart from a record (`fuel`: keep that object as the live fuel — pending cargo hands its own over). */
  private spawnWorld(rec: StationCartJSON, fuel?: CartFuel): void {
    const view = buildCartView();
    const f = this.host.levels ? cartFloorAt(this.host.levels, rec.x, rec.z, rec.y + 0.05) : null;
    const c: Cart = {
      uid: rec.uid,
      fuel: fuel ?? {uid: rec.uid, units: rec.units},
      body: {x: rec.x, y: f?.floor ?? rec.y, z: rec.z, yaw: rec.yaw, vx: 0, vz: 0, level: f?.level ?? rec.level, units: rec.units},
      local: {x: 0, y: 0, z: 0, yaw: 0},
      mode: 'world',
      view,
      awake: false,
    };
    c.fuel.units = Math.max(0, Math.min(FUEL.cartUnits, Math.floor(c.fuel.units)));
    view.group.name = `fuel-cart:${rec.uid}`;
    view.group.position.set(c.body.x, c.body.y, c.body.z);
    view.group.rotation.set(0, c.body.yaw, 0);
    this.group.add(view.group);
    view.group.updateMatrixWorld(true);
    this.host.atmosphere?.markShadows(view.group, false);
    setGauge(view, c.fuel.units);
    this.markLevel(c);
    this.carts.push(c);
    this.counts.spawned++;
  }

  private markLevel(c: Cart): void {
    c.view.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = c.body.level; });
  }

  private removeAt(i: number): void {
    if (i < 0) return;
    const c = this.carts[i];
    if (this.grab?.cart === c) this.grab = null;
    if (this.hoseOn?.cart === c) this.disconnect(null);
    c.view.group.removeFromParent();
    this.carts.splice(i, 1);
  }

  private stationRecord(c: Cart): StationCartJSON {
    return {uid: c.uid, units: c.fuel.units, x: r4(c.body.x), y: r4(c.body.y), z: r4(c.body.z), yaw: r4(wrapYaw(c.body.yaw)), level: Math.max(0, c.body.level)};
  }

  /** Valid records whose uid no cart (live / pending) has yet; `replacingStation`: station carts now live may be replaced. */
  private dedupe(recs: readonly StationCartJSON[], replacingStation: boolean): StationCartJSON[] {
    const known = new Set<string>();
    for (const c of this.carts) if (!replacingStation || this.isTrainOwned(c)) known.add(c.uid);
    for (const c of this.pendingCargo) known.add(c.uid);
    if (!replacingStation) for (const c of this.pendingStation) known.add(c.uid);
    const out: StationCartJSON[] = [];
    for (const r of recs ?? []) {
      if (cartProblem(r, true) !== null || known.has(r.uid)) continue;
      known.add(r.uid);
      out.push({...r});
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Warm-up + QA

  /** Hidden prototype (every material of a cart: the body, both gauge colours) + the pooled hose. */
  warmRoots(): THREE.Object3D[] {
    if (!this.proto || this.protoGen !== cartModelsGen) {
      this.proto?.removeFromParent();
      const v = buildCartView();
      v.group.name = 'fuel-cart-warm-prototype';
      v.group.position.set(0, -1000, 0);
      v.group.visible = false;
      setGauge(v, FUEL.cartUnits);
      const S = cartMaterials(), low = new THREE.Mesh(S.gaugeSegGeo, S.gaugeLow); // (the amber segments' material too)
      low.name = 'fuel-cart-warm-gauge-low';
      low.position.copy(v.segments[0].position);
      v.segments[0].parent!.add(low);
      this.host.atmosphere?.markShadows(v.group, false);
      this.group.add(v.group);
      this.proto = v.group;
      this.protoGen = cartModelsGen;
    }
    return [this.proto, this.hose.mesh];
  }

  /** QA readout. */
  state() {
    return {
      worldLive: this.worldLive, carts: this.all(), pendingStation: this.pendingStation.map(s => ({...s})), snapshot: this.stationSnapshot?.length ?? null,
      grab: this.grab ? {uid: this.grab.cart.uid, lag: r4(this.grab.lag)} : null,
      hose: this.hoseOn ? {uid: this.hoseOn.cart.uid, t: r4(this.hoseOn.t)} : null,
      captured: this.captured ? {sawRide: this.captured.sawRide, idle: r4(this.captured.idle), swapped: !!this.captured.swap} : null,
      tank: this.host.playerTrain.fuel.tank, prompt: this.prompt, counts: {...this.counts},
    };
  }
}

const byUid = (a: {uid: string}, b: {uid: string}) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);

/** Installs the fuel carts (one call in the Game constructor; registries only). */
export function installFuelCarts(game: Game): FuelCarts {
  return new FuelCarts(game as unknown as FuelCartHost).install();
}
