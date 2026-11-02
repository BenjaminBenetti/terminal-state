// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the player's train MOVES — the ride between two stations.
//
// User: "Confirm destination: the occupied player train MOVES into the dark subway tunnel, the player remains able to walk around the
// car / change gear while the next level loads in the background, the car jostles as it travels, then it emerges and stops in the next
// station. No static load screen." The primary owns the travel ORCHESTRATION (saves, world unload / staged load, failure recovery,
// the map) and drives this API; this file owns the motion, ride mode and the transit tunnel.
//
// API (TrainRide; Game.trainRide):
//   depart(): Promise<DepartResult>   refuses ('refused' + reason: no-train / dead / climbing / busy / outside / door-blocked /
//                                     aborted) unless the player stands inside the parked car; closes every side door (the
//                                     runtime's door animation and rules: a blocked door re-opens, the close is re-tried every
//                                     RIDE.closeRetry s, reported after RIDE.closeTimeout s), then the car pulls away with an
//                                     ease-in (jerk-limited) acceleration along its track into the bed end's tunnel (front end
//                                     preferred, else rear-first through the rear end's tunnel, else the front bed end's black end
//                                     plane: the documented fallback) and resolves {status: 'in-tunnel'} once the whole car is in
//                                     the dark — at that moment the car is handed to the TRANSIT loop automatically.
//   enterTransit(): boolean           hand the departing car to the transit loop now (idempotent; depart() does it itself).
//   leaveTransit()                    hide the transit tunnel (arrive() does it when the car enters the next station).
//   arrive(): Promise<ArriveResult>   after the primary built the next station (PlayerTrainRuntime adopted the riding car's view at
//                                     the new placement): after at least RIDE.minTransit s in transit (reversing first when the
//                                     arrival tunnel needs the other direction), the car enters that station's tunnel on the
//                                     placement's track (or the bed end), keeps the player at the same car-local pose, brakes and
//                                     stops EXACTLY at the placement, then ride mode ends (normal player physics in the parked
//                                     car's DynamicVolume; doors shut until the player opens them) -> {status: 'stopped'}.
//                                     Called before the car reached the transit, it waits for it.
//   transitFailed(reason)             the primary's load failed: nothing changes (the car keeps looping; QA shows the reason).
//   reset()                           hard stop (new game / load / death): ride mode ends, pending promises resolve 'aborted'.
//   riding / phase / state()          'idle' | 'closing' | 'departing' | 'transit' | 'arriving' (+ QA readout).
//   stepPlayer(dt, input, opts)       Game.update's hook instead of Player.update while riding (see the update order below).
//   tiltCamera(camera)                Game.updateCamera's hook: the car's jostle roll / pitch on the view.
//   blocksWeapons / refuseFire()      weapon fire / melee / flare throws are blocked while riding ("Holster — the train is moving").
//   refuseDrop()                      item drops are refused while riding (the Lockbox holds things); the gear's backpack set-down too.
//
// RIDE MODE. The player lives in the TRAIN-LOCAL frame: `local` (x, y, z, yaw, vx, vz) is the truth; Player.update runs unchanged on
// it against the car's own collision model (trainRideLocal.ts: walls with the closed side doors, end walls, both partitions with
// their doorways, the console, the Lockbox; floor / ceiling heights), so walking, crouching, jumping and landing are player.ts' own.
// Update order per frame: 1. the CAR pose advances (sequence + clamped dt + jostle; view root and boot-time lights follow), 2. the
// player's LOCAL step (mouse look already applied to the world yaw: local yaw = world yaw - the car's previous yaw), 3. the WORLD pose
// = carToWorld(car pose, local) (feet, yaw + car yaw, velocity rotated, eye recomputed from the world feet), 4. Game's camera from
// that pose + tiltCamera. Bob: the player's walking bob only (local speed); the car's motion reaches the view only as the car's own
// pose (no double bob). Everything that reads the player's world pose (camera, flashlight, viewmodel, held items, gear, inventory,
// the Lockbox by aim in the car frame, audio listener) keeps working; the station world's train colliders are ignored while riding.
//
// TRANSIT (trainTransitTunnel.ts): the car stands at TRANSIT.origin (yaw 0) and the procedural tunnel scrolls past it at up to
// RIDE.cruise m/s with lamps passing the windows; nothing moves in world space, so the primary's main-thread hitches (0.3-2 s world
// builds) only advance the clamped dt: the motion continues sensibly after each, no teleport, no drift. A failed load keeps it
// looping (the player is always inside the car's walls: never in the void).
//
// AUDIO: existing Sound Lab cues only, through the Sfx master: 'bedRumble' (the under-floor motor / wheel rumble, re-struck in
// overlapping faded windows, rate and gain with speed), 'trainDistant' (a low-passed run layer at speed), 'clank' (each bogie over a
// rail joint; the brake release; the stop), 'creak' (the brakes). The doors use the runtime's own cues.

import * as THREE from 'three';
import type {MoveInput, Player} from '../player/player';
import type {Grid} from '../gen/grid';
import type {Levels} from '../gen/levels';
import type {PropIndex} from '../core/physics';
import type {StationLayout} from '../gen/stationTypes';
import {worldToTrain, type TrainPlacement} from '../gen/playerTrain';
import type {PlayerTrainRuntime, TrainRideLink} from './playerTrain';
import type {WorldMaterials} from './materials';
import type {WarmupRegistry} from '../render/warmup';
import {
  RIDE_JOSTLE, buildRideLocalModel, carToWorld, fromStep, insideInterior, jostleAt, placementPose, rotateToLocal, toStep, worldToCar,
  wrapAngle, yawCS, yawOfAxis, type CarPose, type Jostle, type P3, type RideLocalModel,
} from './trainRideLocal';
import {RIDE_ROUTE, arriveDir, arrivalPlan, departDir, departurePlan, routePose, type RidePlan} from './trainRideRoute';
import {TRANSIT, TrainTransitTunnel, transitMaterials} from './trainTransitTunnel';

/** Motion tuning (m, s, m/s, m/s², m/s³). */
export const RIDE = {
  /** Longest step the car integrates per frame (a hitch only advances this much: no teleport). */
  maxDt: 0.1,
  /** Doors shut -> the car pulls away after this pause. */
  departDelay: 0.8,
  /** Ease-in: the acceleration ramps up at `jerk` to `accel`. */
  accel: 1.05, jerk: 0.75,
  /** Speed caps: in a station (departing), in transit, entering the arrival station. */
  departMax: 11, cruise: 15, arriveMax: 10,
  /** Service braking (arrival) and the transit's deceleration / reversal. */
  brake: 0.85, transitBrake: 1.2,
  /** The last centimetres of a stop never stall. */
  creep: 0.35,
  /** At least this long in transit before the car leaves for the next station. */
  minTransit: 6,
  /** A reversal in transit rests this long at zero. */
  reverseDwell: 1.4,
  /** Door closing: retry a re-opened (blocked) door every closeRetry s, give up after closeTimeout s. */
  closeRetry: 1.2, closeTimeout: 9,
  /** Bogie half spacing (m): the body rides the chord between the bogies. */
  bogie: 5.5,
  /** Seconds between "Holster" / "Not while moving" notes. */
  noteEvery: 2.5,
} as const;

export type RidePhase = 'idle' | 'closing' | 'departing' | 'transit' | 'arriving';
export type RideRefusal = 'no-train' | 'dead' | 'climbing' | 'busy' | 'outside' | 'door-blocked' | 'aborted' | 'not-riding';
export type DepartResult = {status: 'in-tunnel'; via: 'tunnel' | 'bed-end'; end: 'x0' | 'x1'; dir: 1 | -1} | {status: 'refused'; reason: RideRefusal; message: string};
export type ArriveResult = {status: 'stopped'; via: 'tunnel' | 'bed-end'; end: 'x0' | 'x1'; reversed: boolean} | {status: 'refused'; reason: RideRefusal; message: string};

const REFUSAL_TEXT: Record<RideRefusal, string> = {
  'no-train': 'There is no train here',
  dead: 'You cannot drive now',
  climbing: 'Get off the ladder first',
  busy: 'The train is already under way',
  outside: 'Board the train first — stand inside the car',
  'door-blocked': 'A door is blocked — clear the doorway, then try again',
  aborted: 'The journey was cancelled',
  'not-riding': 'The train is not travelling',
};

/** What the ride needs from Game (structural: tests drive it with a fake host and the real Player). */
export interface RideHost {
  scene: THREE.Scene;
  player: Player;
  levels: Levels | Grid;
  propIndex: PropIndex | null;
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  state: string;
  world?: {culler?: unknown} | null;
  mats?: WorldMaterials | null;
  warmRegistry?: WarmupRegistry;
  gear?: {placeRules?: ((x: number, y: number, z: number, level: number) => string | null)[]} | null;
  stateListeners?: ((state: never, prev: never) => void)[];
  sectionHooks?: {build?(layout: StationLayout): void; teardown?(): void}[];
}

export interface RideOptions {
  /** The jostle intensity 0..1 (a Settings getter; default RIDE_JOSTLE.intensity). */
  jostle?: () => number;
  /** Toast refusals / notes on the HUD (default true). */
  toasts?: boolean;
}

interface Local { x: number; y: number; z: number; yaw: number; vx: number; vz: number }
type Pending<T> = {resolve: (v: T) => void} | null;

/** Plays an EXISTING cue through the Sfx master, non-positional (the listener rides in the car); guarded, best effort. */
function rideCue(sfx: unknown, cue: string, o: {rate?: number; gain?: number; maxDur?: number; fadeOut?: number; delay?: number; filter?: {type: BiquadFilterType; freq: number; q?: number}} = {}): void {
  const s = sfx as {voice?(o: object): unknown; play?(v: unknown, cue: string, o?: object): unknown} | null;
  if (!s || typeof s.voice !== 'function' || typeof s.play !== 'function') return;
  try {
    const v = s.voice({send: 0.22, pri: 1});
    if (v) s.play(v, cue, {jitter: 0.03, gainJitter: 0.5, ...o});
  } catch { /* audio is best-effort */ }
}

export class TrainRide {
  phase: RidePhase = 'idle';
  /** The player's car-local pose (the truth while riding). */
  readonly local: Local = {x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0};
  /** The car's world pose this frame (incl. the jostle) and without it. */
  readonly pose: CarPose = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0};
  readonly base: CarPose = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0};
  readonly jostle: Jostle = {lateral: 0, roll: 0, pitch: 0, bump: 0};
  /** Speed along the motion (m/s, >= 0) and its direction relative to the car (+1 front-first). */
  speed = 0;
  dir: 1 | -1 = 1;
  /** Car-centre position on the current station plan's route. */
  u = 0;
  plan: RidePlan | null = null;
  /** The station placement the current plan belongs to. */
  placement: TrainPlacement | null = null;
  /** Total distance travelled this ride (jostle joints) and the ride clock. */
  dist = 0;
  clock = 0;
  /** Transit: signed velocity along the car's local +X, seconds in transit, the reversal dwell. */
  transitV = 0;
  transitT = 0;
  readonly transit: TrainTransitTunnel;
  /** QA. */
  readonly counts = {departs: 0, refused: 0, arrivals: 0, handovers: 0, reversals: 0, clampedSteps: 0, closeRetries: 0, fireBlocked: 0, dropsBlocked: 0};
  lastRefusal: RideRefusal | null = null;
  failure: string | null = null;
  readonly model: RideLocalModel;

  private phaseT = 0;
  private accelNow = 0;
  private closeT = 0;
  private retryT = 0;
  private dwellT = 0;
  private reversed = false;
  private arrivalReady = false;
  private arrivalPlanned: RidePlan | null = null;
  private departing: Pending<DepartResult> = null;
  private arriving: Pending<ArriveResult> = null;
  private noteT = 1e9;
  private audioT = {rumble: 1e9, run: 1e9, joints: [0, 0]};
  private brakeCued = false;
  private released: THREE.Object3D | null = null;
  private readonly tmp: P3 = {x: 0, y: 0, z: 0};
  private readonly tmp2: P3 = {x: 0, y: 0, z: 0};
  private readonly rp = {x: 0, z: 0, ax: 1, az: 0};
  private readonly qTilt = new THREE.Quaternion();
  private readonly qYaw = new THREE.Quaternion();
  private readonly eTilt = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly link: TrainRideLink;
  private transitBuilt = false;

  constructor(readonly host: RideHost, readonly runtime: PlayerTrainRuntime, readonly opts: RideOptions = {}) {
    this.model = buildRideLocalModel(runtime.spec, runtime.consoleRect);
    this.transit = new TrainTransitTunnel();
    const self = this;
    this.link = {
      toWorld: (lx, ly, lz) => carToWorld(self.pose, lx, ly, lz, {x: 0, y: 0, z: 0}),
      toLocal: (wx, wy, wz) => worldToCar(self.pose, wx, wy, wz, {x: 0, y: 0, z: 0}),
      dirToLocal: (dx, dy, dz) => rotateToLocal(self.pose, dx, dy, dz, {x: 0, y: 0, z: 0}),
      doorsLocked: true,
      holdView: true,
    };
  }

  /** Registers the warm-up pool, the gear's set-down rule and the state listener (called once from the Game constructor). */
  install(): this {
    const h = this.host;
    h.scene.add(this.transit.group);
    this.ensureTransit();
    // the tunnel is built before the first station's warm-up (the world materials exist by then), so its pipelines compile there
    h.sectionHooks?.push({build: () => this.ensureTransit()});
    h.warmRegistry?.addPool('train-transit', () => (this.transitBuilt ? [this.transit.group] : []));
    h.gear?.placeRules?.push(() => (this.riding ? 'Not while the train is moving' : null));
    h.stateListeners?.push(((state: string) => { if (state === 'dead' || state === 'title' || state === 'error') this.reset(); }) as (s: never, p: never) => void);
    return this;
  }

  /** The player is in ride mode (car-local; Game steps them through stepPlayer). */
  get riding(): boolean { return this.phase !== 'idle'; }
  /** Weapon triggers are blocked (ride mode). */
  get blocksWeapons(): boolean { return this.riding; }
  /** The car is moving (or about to: doors closing). */
  get moving(): boolean { return this.phase === 'departing' || this.phase === 'transit' || this.phase === 'arriving'; }

  private intensity(): number {
    const v = this.opts.jostle?.() ?? RIDE_JOSTLE.intensity;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : RIDE_JOSTLE.intensity;
  }

  private toast(text: string, warn = false): void {
    if (this.opts.toasts !== false) this.host.hud.toast(text, warn);
  }

  /** The transit tunnel's meshes (once, from the world's material cache; without one the tunnel stays empty). */
  private ensureTransit(): void {
    if (this.transitBuilt || !this.host.mats) return;
    try {
      this.transit.build(transitMaterials(this.host.mats, this.runtime.tunnelLampMaterial()));
      this.transitBuilt = true;
    } catch (err) { console.warn('train ride: transit tunnel unavailable', err); }
  }

  // -------------------------------------------------------------------------------------------
  // Departure

  depart(): Promise<DepartResult> {
    const rt = this.runtime, P = this.host.player, t = rt.train;
    const refuse = (reason: RideRefusal): Promise<DepartResult> => {
      this.counts.refused++;
      this.lastRefusal = reason;
      this.toast(REFUSAL_TEXT[reason], true);
      return Promise.resolve({status: 'refused', reason, message: REFUSAL_TEXT[reason]});
    };
    if (this.riding) return refuse('busy');
    if (!t) return refuse('no-train');
    if (!P.alive) return refuse('dead');
    if (P.climbing) return refuse('climbing');
    const p = t.placement, q = worldToTrain(p, P.x, P.y, P.z);
    if (!insideInterior(rt.spec, q.x, q.y, q.z)) return refuse('outside');
    this.counts.departs++;
    this.lastRefusal = null;
    this.failure = null;
    // ride mode from now on: the car frame at the placement (the player is held inside the closed-door walls while they shut)
    this.placement = p;
    this.plan = departurePlan(t.layout, p, rt.spec);
    this.dir = departDir(this.plan);
    this.u = 0;
    this.speed = 0;
    this.accelNow = 0;
    this.dist = 0;
    this.clock = 0;
    this.audioT.joints = [Math.floor(-RIDE_JOSTLE.bogie / RIDE_JOSTLE.jointStep), Math.floor(RIDE_JOSTLE.bogie / RIDE_JOSTLE.jointStep)];
    this.reversed = false;
    this.arrivalReady = false;
    this.arrivalPlanned = null;
    Object.assign(this.base, placementPose(p));
    Object.assign(this.pose, this.base);
    const L = this.local;
    L.x = q.x; L.y = rt.spec.floorY; L.z = q.z;
    L.yaw = P.yaw - p.yaw;
    L.vx = P.vx * p.front; L.vz = P.vz * p.front;
    this.link.doorsLocked = true;
    this.link.holdView = true;
    rt.ride = this.link;
    this.setPhase('closing');
    this.closeT = 0;
    this.retryT = RIDE.closeRetry;
    this.closeDoors();
    return new Promise<DepartResult>(resolve => { this.departing = {resolve}; });
  }

  /** Every open / opening door gets a close (through the runtime's rules: a blocked one is refused / re-opens). */
  private closeDoors(): void {
    const t = this.runtime.train;
    if (!t) return;
    t.doors.forEach((d, i) => { if (d.target === 1) this.runtime.setDoor(i, false); });
  }

  private doorsShut(): boolean {
    const t = this.runtime.train;
    return !!t && t.doors.every(d => d.target === 0 && d.t === 0);
  }

  /** Hand the departing car to the transit loop now (idempotent). */
  enterTransit(): boolean {
    if (this.phase === 'transit') return true;
    if (this.phase !== 'departing') return false;
    this.ensureTransit();
    this.counts.handovers++;
    this.transitV = this.dir * this.speed;
    this.transitT = 0;
    this.dwellT = 0;
    this.transit.enterTransit();
    this.setPhase('transit');
    Object.assign(this.base, {x: TRANSIT.origin.x, y: TRANSIT.origin.y, z: TRANSIT.origin.z, yaw: this.continuousYaw(0), pitch: 0, roll: 0});
    const d = this.departing;
    this.departing = null;
    d?.resolve({status: 'in-tunnel', via: this.plan?.kind ?? 'tunnel', end: this.plan?.end ?? 'x0', dir: this.dir});
    return true;
  }

  /** Hide the transit tunnel (the car is in a station again). */
  leaveTransit(): void {
    this.transit.leaveTransit();
  }

  // -------------------------------------------------------------------------------------------
  // Arrival

  /**
   * After the primary built the next station: PlayerTrainRuntime.train is the parked car at its placement (the riding car's view,
   * adopted). Resolves when the car has stopped there and ride mode ended.
   */
  arrive(): Promise<ArriveResult> {
    const refuse = (reason: RideRefusal): Promise<ArriveResult> => {
      this.counts.refused++;
      this.lastRefusal = reason;
      return Promise.resolve({status: 'refused', reason, message: REFUSAL_TEXT[reason]});
    };
    if (!this.riding) return refuse('not-riding');
    if (this.phase === 'arriving' || this.arriving) return refuse('busy');
    if (!this.runtime.train) return refuse('no-train');
    this.failure = null;
    this.arrivalReady = true;
    this.arrivalPlanned = null;
    return new Promise<ArriveResult>(resolve => { this.arriving = {resolve}; });
  }

  /** The primary's load failed: the car keeps looping in transit (QA shows why). */
  transitFailed(reason: string): void {
    this.failure = reason || 'load failed';
  }

  /** Hard stop (new game / load / death): ride mode ends; a parked car (if any) gets its placement pose back. */
  reset(): void {
    if (!this.riding) return;
    const d = this.departing, a = this.arriving;
    this.departing = this.arriving = null;
    this.exitRide(false);
    d?.resolve({status: 'refused', reason: 'aborted', message: REFUSAL_TEXT.aborted});
    a?.resolve({status: 'refused', reason: 'aborted', message: REFUSAL_TEXT.aborted});
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (Game.update, instead of Player.update while riding)

  /**
   * The ride's frame: 1. the car pose (clamped dt), 2. the player's car-local step (Player.update on the car's collision model), 3. the
   * world pose. Returns Player.update's footstep flag. Once the ride ends inside (the arrival stop / a refusal), the player is
   * stepped by normal physics in the station this frame.
   */
  stepPlayer(dt: number, input: MoveInput, opts: {aiming: boolean; speedMult: number; canSprint: boolean}): boolean {
    const P = this.host.player;
    const yaw0 = this.pose.yaw;
    const cdt = Math.max(0, Math.min(dt, RIDE.maxDt));
    if (dt > RIDE.maxDt) this.counts.clampedSteps++;
    this.advance(cdt);
    if (!this.riding) return P.update(dt, input, this.host.levels, this.host.propIndex, opts);
    const L = this.local;
    L.yaw = P.yaw - yaw0; // the mouse look was applied to the world yaw
    const [sx, sz] = toStep(L.x, L.z);
    P.x = sx; P.z = sz; P.y = L.y; P.yaw = L.yaw; P.vx = L.vx; P.vz = L.vz;
    let step = false;
    try {
      step = P.update(cdt, input, this.model.levels, this.model.props, opts);
    } finally {
      [L.x, L.z] = fromStep(P.x, P.z);
      L.y = P.y; L.yaw = P.yaw; L.vx = P.vx; L.vz = P.vz;
      this.writePlayer();
    }
    return step;
  }

  /** The player's world pose from the car pose + the car-local pose. */
  writePlayer(): void {
    const P = this.host.player, L = this.local, c = this.pose;
    const w = carToWorld(c, L.x, L.y, L.z, this.tmp);
    P.x = w.x; P.y = w.y; P.z = w.z;
    P.yaw = L.yaw + c.yaw;
    const [cy, sy] = yawCS(c.yaw);
    P.vx = L.vx * cy + L.vz * sy;
    P.vz = -L.vx * sy + L.vz * cy;
    P.eye = P.stanceEye + P.y - P.landDip;
  }

  /** Game.updateCamera: the car's roll / pitch on the camera (premultiplied in world space; yaw is already in the player's yaw). */
  tiltCamera(camera: THREE.Camera): void {
    if (!this.riding) return;
    const c = this.pose;
    if (c.roll === 0 && c.pitch === 0) return;
    this.eTilt.set(c.roll, c.yaw, c.pitch, 'YZX');
    this.qTilt.setFromEuler(this.eTilt);
    this.qYaw.setFromAxisAngle(this.yAxis, -c.yaw);
    this.qTilt.multiply(this.qYaw);
    camera.quaternion.premultiply(this.qTilt);
  }

  /** A blocked trigger pull (fire / melee / flare): the note, rate-limited. */
  refuseFire(): void {
    this.counts.fireBlocked++;
    this.note('Holster — the train is moving');
  }

  /** Drops are refused while riding (true = refused; the note shows). */
  refuseDrop(): boolean {
    if (!this.riding) return false;
    this.counts.dropsBlocked++;
    this.note('Not while the train is moving — use the Lockbox');
    return true;
  }

  private note(text: string): void {
    if (this.noteT < RIDE.noteEvery) return;
    this.noteT = 0;
    this.toast(text);
  }

  private setPhase(p: RidePhase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  /** Advance the sequence by dt (already clamped) and pose the car. */
  advance(dt: number): void {
    if (!this.riding) return;
    this.clock += dt;
    this.phaseT += dt;
    this.noteT += dt;
    switch (this.phase) {
      case 'closing': this.stepClosing(dt); break;
      case 'departing': this.stepDeparting(dt); break;
      case 'transit': this.stepTransit(dt); break;
      case 'arriving': this.stepArriving(dt); break;
    }
    if (!this.riding) return;
    this.composePose();
    this.applyView();
    this.stepAudio(dt);
  }

  private stepClosing(dt: number): void {
    const t = this.runtime.train;
    if (!t || !this.host.player.alive) { this.failDepart('aborted'); return; }
    if (this.doorsShut()) {
      this.closeT += dt;
      if (this.closeT >= RIDE.departDelay) {
        this.releaseFromCuller();
        this.setPhase('departing');
        rideCue(this.host.sfx, 'clank', {rate: 0.7, gain: 0.45, filter: {type: 'lowpass', freq: 1400}}); // the brake release
        rideCue(this.host.sfx, 'creak', {rate: 0.55, gain: 0.35, delay: 0.15, filter: {type: 'lowpass', freq: 1600}});
      }
      return;
    }
    this.closeT = 0;
    this.retryT -= dt;
    if (this.retryT <= 0) { this.retryT = RIDE.closeRetry; this.counts.closeRetries++; this.closeDoors(); }
    if (this.phaseT >= RIDE.closeTimeout) this.failDepart('door-blocked');
  }

  private failDepart(reason: RideRefusal): void {
    const d = this.departing;
    this.departing = null;
    this.counts.refused++;
    this.lastRefusal = reason;
    this.exitRide(false);
    if (reason !== 'aborted') this.toast(REFUSAL_TEXT[reason], true);
    d?.resolve({status: 'refused', reason, message: REFUSAL_TEXT[reason]});
  }

  /** Ease-in: the acceleration ramps up by the jerk to its cap, the speed to `vmax`. */
  private accelerate(dt: number, vmax: number): void {
    this.accelNow = Math.min(RIDE.accel, this.accelNow + RIDE.jerk * dt);
    const v0 = this.speed;
    this.speed = Math.min(vmax, v0 + this.accelNow * dt);
  }

  private stepDeparting(dt: number): void {
    const plan = this.plan!;
    const v0 = this.speed;
    this.accelerate(dt, RIDE.departMax);
    const du = ((v0 + this.speed) / 2) * dt;
    this.u += du;
    this.dist += du;
    let hand = this.u >= plan.uDark || this.u >= plan.uMax;
    if (plan.kind === 'bed-end') {
      // the documented fallback: into the black end plane; hand over before the camera would reach it (or the car is half through)
      const cam = this.u + plan.sgn * this.local.x;
      hand = cam + RIDE_ROUTE.planeClear >= plan.uMouth || this.u >= plan.uMouth + this.runtime.spec.length / 2 - 1;
    }
    this.u = Math.min(this.u, plan.uMax);
    this.poseOnRoute();
    if (hand) this.enterTransit();
  }

  private stepTransit(dt: number): void {
    this.transitT += dt;
    const rt = this.runtime;
    // the arrival: once the primary built the next station and the car has run long enough, approach its entry velocity
    let target = this.dir * RIDE.cruise;
    if (this.arrivalReady && rt.train && this.transitT >= RIDE.minTransit) {
      if (!this.arrivalPlanned || this.placement !== rt.train.placement) {
        this.placement = rt.train.placement;
        this.arrivalPlanned = arrivalPlan(rt.train.layout, rt.train.placement, this.dir, rt.spec);
      }
      const plan = this.arrivalPlanned, adir = arriveDir(plan);
      const vEntry = Math.min(RIDE.arriveMax, Math.sqrt(2 * RIDE.brake * Math.max(0.5, plan.uDark)));
      target = adir * vEntry;
      if (adir !== this.dir && Math.abs(this.transitV) < 0.05) {
        // a reversal: rest a moment at zero, then run the other way
        this.transitV = 0;
        this.dwellT += dt;
        if (this.dwellT < RIDE.reverseDwell) { this.speed = 0; this.transit.advance(0); return; }
        this.dir = adir;
        this.reversed = true;
        this.counts.reversals++;
        this.dwellT = 0;
        this.accelNow = 0;
      }
      if (adir === this.dir && Math.abs(this.transitV - target) < 0.06) { this.beginArrival(plan, vEntry); return; }
      if (adir !== this.dir) target = 0;
    }
    const w0 = this.transitV, gap = target - w0;
    if (Math.abs(gap) > 1e-9) {
      const speeding = Math.abs(target) > Math.abs(w0) && Math.sign(target) === Math.sign(w0 || target);
      let a: number;
      if (speeding) { this.accelNow = Math.min(RIDE.accel, this.accelNow + RIDE.jerk * dt); a = this.accelNow; } else { this.accelNow = 0; a = RIDE.transitBrake; }
      this.transitV = Math.abs(gap) <= a * dt ? target : w0 + Math.sign(gap) * a * dt;
    }
    const ds = ((w0 + this.transitV) / 2) * dt;
    this.transit.advance(ds);
    this.dist += Math.abs(ds);
    this.speed = Math.abs(this.transitV);
  }

  private beginArrival(plan: RidePlan, vEntry: number): void {
    this.plan = plan;
    this.u = plan.uDark;
    this.speed = vEntry;
    this.transitV = this.dir * vEntry;
    this.brakeCued = false;
    this.transit.leaveTransit();
    this.counts.handovers++;
    this.setPhase('arriving');
    this.base.y = this.placement!.railTopY;
    this.poseOnRoute();
  }

  private stepArriving(dt: number): void {
    const plan = this.plan!;
    const d = this.u; // remaining distance to the placement (the car runs -u to 0)
    const v = this.speed, brakeDist = (v * v) / (2 * RIDE.brake);
    const b = d > brakeDist + 0.01 ? 0 : (v * v) / (2 * Math.max(1e-4, d));
    if (b > 0 && !this.brakeCued) { this.brakeCued = true; rideCue(this.host.sfx, 'creak', {rate: 0.5, gain: 0.5, filter: {type: 'lowpass', freq: 1800}}); }
    let vn = Math.max(0, v - b * dt);
    if (vn < RIDE.creep && d > 1e-4) vn = RIDE.creep;
    const step = ((v + vn) / 2) * dt;
    if (step >= d || d <= 1e-4) {
      this.u = 0;
      this.dist += d;
      this.speed = 0;
      this.stop();
      return;
    }
    this.u = d - step;
    this.dist += step;
    this.speed = vn;
    this.poseOnRoute();
    void plan;
  }

  /** The stop: exactly at the placement; ride mode ends (normal physics in the parked car), the promise resolves. */
  private stop(): void {
    const plan = this.plan;
    rideCue(this.host.sfx, 'clank', {rate: 0.85, gain: 0.45, filter: {type: 'lowpass', freq: 1500}});
    this.counts.arrivals++;
    const a = this.arriving;
    this.arriving = null;
    const reversed = this.reversed;
    this.exitRide(true);
    a?.resolve({status: 'stopped', via: plan?.kind ?? 'tunnel', end: plan?.end ?? 'x0', reversed});
  }

  /** Leave ride mode: the car parked at the runtime's placement (exact), the player at the same car-local pose there. */
  private exitRide(stopped: boolean): void {
    const rt = this.runtime, t = rt.train;
    this.transit.leaveTransit();
    this.phase = 'idle';
    this.speed = 0;
    this.transitV = 0;
    this.arrivalReady = false;
    this.arrivalPlanned = null;
    rt.ride = null;
    if (t) {
      Object.assign(this.base, placementPose(t.placement));
      Object.assign(this.pose, this.base);
      const root = t.view.root;
      root.position.set(t.placement.x, t.placement.railTopY, t.placement.z);
      root.rotation.set(0, t.placement.yaw, 0);
      root.updateMatrixWorld(true);
      rt.placeLightsBy(q => carToWorld(this.pose, q.x, q.y, q.z, {x: 0, y: 0, z: 0}));
      this.registerWithCuller(t.view.fixed, stopped);
      // the player in the parked car: same local pose, the floor exactly, normal physics from here
      this.local.y = rt.spec.floorY;
      this.writePlayer();
      const P = this.host.player;
      P.vy = 0;
      P.grounded = true;
    } else {
      // nothing to park in (a reset between stations): drop the held car; the primary places the player in the next build
      rt.releaseHeldView();
    }
    this.plan = null;
  }

  /** The car on its station route at u: the chord between the bogies; y = the rail top. */
  private poseOnRoute(): void {
    const plan = this.plan, p = this.placement;
    if (!plan || !p) return;
    if (this.u === 0 && this.phase !== 'arriving') { Object.assign(this.base, placementPose(p)); return; }
    const r = routePose(plan, this.u, RIDE.bogie, this.rp);
    this.base.x = r.x; this.base.z = r.z; this.base.y = p.railTopY;
    this.base.yaw = this.continuousYaw(yawOfAxis(r.ax, r.az));
    this.base.pitch = this.base.roll = 0;
  }

  /** Keep the car's yaw continuous (no 2·PI jumps in the player's world yaw). */
  private continuousYaw(raw: number): number {
    return this.base.yaw + wrapAngle(raw - this.base.yaw);
  }

  /** base + the jostle -> pose. */
  private composePose(): void {
    const b = this.base, c = this.pose, j = jostleAt(this.clock, this.dist, this.speed, this.intensity(), this.jostle);
    const [cy, sy] = yawCS(b.yaw);
    c.x = b.x + j.lateral * sy; c.z = b.z + j.lateral * cy; c.y = b.y + j.bump;
    c.yaw = b.yaw; c.pitch = b.pitch + j.pitch; c.roll = b.roll + j.roll;
  }

  /** The view root + the boot-time lights at the car pose (one TrainView: the runtime's built or held view). */
  private applyView(): void {
    const v = this.runtime.view;
    if (!v) return;
    const c = this.pose, root = v.root;
    root.position.set(c.x, c.y, c.z);
    root.rotation.order = 'YZX';
    root.rotation.set(c.roll, c.yaw, c.pitch);
    root.updateMatrixWorld(true);
    this.runtime.placeLightsBy(q => carToWorld(c, q.x, q.y, q.z, this.tmp2));
  }

  /** The moving car is never culled by its parked box: released from the station culler while it rides. */
  private releaseFromCuller(): void {
    const v = this.runtime.view, cul = this.host.world?.culler as {release?(o: readonly THREE.Object3D[]): void} | undefined;
    if (v && cul && typeof cul.release === 'function') { cul.release([v.fixed]); this.released = v.fixed; }
  }

  private registerWithCuller(fixed: THREE.Object3D, stopped: boolean): void {
    const cul = this.host.world?.culler as {register?(o: THREE.Object3D): void} | undefined;
    if ((this.released === fixed || stopped) && cul && typeof cul.register === 'function') cul.register(fixed);
    this.released = null;
  }

  // -------------------------------------------------------------------------------------------
  // Audio (existing cues; Sfx master)

  private stepAudio(dt: number): void {
    const v = this.speed, sfx = this.host.sfx;
    if (!sfx || v < 0.3) { this.audioT.rumble = this.audioT.run = 1e9; return; }
    const k = Math.min(1, v / RIDE.cruise);
    this.audioT.rumble += dt;
    if (this.audioT.rumble >= 4.2) {
      this.audioT.rumble = 0;
      rideCue(sfx, 'bedRumble', {rate: 0.78 + 0.32 * k, gain: 0.3 + 0.45 * k, maxDur: 6.2, fadeOut: 1.8, filter: {type: 'lowpass', freq: 650 + 500 * k}});
    }
    this.audioT.run += dt;
    if (k > 0.35 && this.audioT.run >= 7) {
      this.audioT.run = 0;
      rideCue(sfx, 'trainDistant', {rate: 0.6 + 0.25 * k, gain: 0.3 * k, maxDur: 8.5, fadeOut: 2.2, filter: {type: 'lowpass', freq: 1100}});
    }
    // each bogie over a rail joint
    const J = RIDE_JOSTLE;
    [-J.bogie, J.bogie].forEach((b, i) => {
      const n = Math.floor((this.dist + b) / J.jointStep);
      if (n !== this.audioT.joints[i]) {
        this.audioT.joints[i] = n;
        rideCue(sfx, 'clank', {rate: 1.45 + 0.4 * k, gain: 0.06 + 0.1 * k, maxDur: 0.35, fadeOut: 0.08, filter: {type: 'lowpass', freq: 1700}});
      }
    });
  }

  // -------------------------------------------------------------------------------------------
  // QA

  /** QA readout (__LL.ride()). */
  state() {
    const r = (v: number, k = 3) => +v.toFixed(k);
    return {
      phase: this.phase, riding: this.riding, moving: this.moving,
      plan: this.plan ? {kind: this.plan.kind, end: this.plan.end, tunnel: this.plan.tunnel, sgn: this.plan.sgn, uMouth: r(this.plan.uMouth), uDark: r(this.plan.uDark), uMax: r(this.plan.uMax)} : null,
      u: r(this.u), speed: r(this.speed), dir: this.dir, dist: r(this.dist, 1), clock: r(this.clock, 2),
      transit: {active: this.transit.active, offset: r(this.transit.offset), v: r(this.transitV), t: r(this.transitT, 2), built: this.transitBuilt, meshes: this.transit.stats.meshes},
      car: {x: r(this.pose.x), y: r(this.pose.y), z: r(this.pose.z), yaw: r(this.pose.yaw, 5), pitch: r(this.pose.pitch, 5), roll: r(this.pose.roll, 5)},
      local: {x: r(this.local.x), y: r(this.local.y), z: r(this.local.z), yaw: r(this.local.yaw, 4)},
      jostle: {lateral: r(this.jostle.lateral, 4), roll: r(this.jostle.roll, 5), pitch: r(this.jostle.pitch, 5), bump: r(this.jostle.bump, 4), intensity: this.intensity()},
      pending: {depart: !!this.departing, arrive: !!this.arriving, arrivalReady: this.arrivalReady},
      failure: this.failure, lastRefusal: this.lastRefusal, counts: {...this.counts},
    };
  }

  /**
   * Dev only (__LL.rideDemo): depart, loop in transit for `seconds` (ride clock), re-arrive at the SAME station (no world rebuild) —
   * the motion checked in isolation.
   */
  async demo(seconds = 8): Promise<{depart: DepartResult; arrive: ArriveResult | null}> {
    const depart = await this.depart();
    if (depart.status !== 'in-tunnel') return {depart, arrive: null};
    await new Promise<void>(res => {
      const t0 = this.transitT;
      const poll = () => { if (!this.riding || this.transitT - t0 >= Math.max(0, seconds - RIDE.minTransit)) res(); else setTimeout(poll, 100); };
      poll();
    });
    if (!this.riding) return {depart, arrive: null};
    return {depart, arrive: await this.arrive()};
  }
}

/** Installs the ride (one call in the Game constructor, after the train runtime). */
export function installTrainRide(host: RideHost, runtime: PlayerTrainRuntime, opts: RideOptions = {}): TrainRide {
  return new TrainRide(host, runtime, opts).install();
}

/** QA hooks (spread into window.__LL): ride(), rideDepart(), rideArrive(), rideDemo(seconds?), rideReset(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rideQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const ride = () => (game as {trainRide?: TrainRide}).trainRide ?? null;
  return {
    /** Ride state: phase, plan, car pose, player local pose, jostle, transit, counts. */
    ride: () => ride()?.state() ?? null,
    /** Depart now (the player must stand in the car): resolves {status: 'in-tunnel' | 'refused', …}. */
    rideDepart: () => ride()?.depart() ?? null,
    /** Arrive at the station whose train is built now (resolves on the stop). */
    rideArrive: () => ride()?.arrive() ?? null,
    /** Dev: depart + loop `seconds` + re-arrive at the SAME station (no world rebuild). */
    rideDemo: (seconds = 8) => ride()?.demo(seconds) ?? null,
    /** Hard stop (back to the parked car). */
    rideReset: () => { ride()?.reset(); return ride()?.state() ?? null; },
  };
}
