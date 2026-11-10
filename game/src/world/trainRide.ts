// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the player's train MOVES — the ride between two stations.
//
// User: "Confirm destination: the occupied player train MOVES into the dark subway tunnel, the player remains able to walk around the
// car / change gear while the next level loads in the background, the car jostles as it travels, then it emerges and stops in the next
// station. No static load screen." The primary owns the travel ORCHESTRATION (saves, world unload / staged load, failure recovery,
// the map) and drives this API; this file owns the motion, ride mode and the transit tunnel.
//
// API (TrainRide; Game.trainRide):
//   depart(journey?): Promise<DepartResult>  refuses ('refused' + reason: no-train / dead / climbing / busy / outside / door-blocked /
//                                     aborted) unless the player stands inside the parked car; closes every side door (the
//                                     runtime's door animation and rules: a blocked door re-opens, the close is re-tried every
//                                     RIDE.closeRetry s, reported after RIDE.closeTimeout s), then the car pulls away with an
//                                     ease-in (jerk-limited) acceleration FRONT FIRST, STRAIGHT along its track through the FRONT
//                                     ride portal (a gate in a closed bed end, a breach in a station tunnel's first straight) into
//                                     the ride tunnel and resolves {status: 'in-tunnel'} once the portal is out of sight behind the
//                                     car — at that moment the car is handed to the TRANSIT loop automatically. `journey` (lane MAP's
//                                     RideJourney: route = [current, ..., destination] over track edges) only lengthens the minimum
//                                     transit a little per extra hop (bounded); the portal never depends on it.
//   enterTransit(): boolean           hand the departing car to the transit loop now (idempotent; depart() does it itself).
//   leaveTransit()                    hide the transit tunnel (the arrival does it once the portal behind the car is released).
//   arrive(): Promise<ArriveResult>   after the primary built the next station (PlayerTrainRuntime adopted the riding car's view at
//                                     the new placement): after at least the journey's minimum transit, the car comes in through the
//                                     REAR ride portal of that station's track FRONT FIRST, keeps the player at the same car-local
//                                     pose, brakes and stops EXACTLY at the placement, then ride mode ends (normal player physics in
//                                     the parked car's DynamicVolume; doors shut until the player opens them) -> {status:
//                                     'stopped'}. Called before the car reached the transit, it waits for it.
//   lateFrame()                       the frame's LAST word on the scene fog (after every level hook): the tunnel murk while the eye
//                                     is beyond a portal plane (tiltCamera calls it; Game may call it again: idempotent).
//   transitFailed(reason)             the primary's load failed: nothing changes (the car keeps looping; QA shows the reason).
//   reset()                           hard stop (new game / load / death): ride mode ends, pending promises resolve 'aborted'.
//   riding / phase / state()          'idle' | 'closing' | 'departing' | 'transit' | 'arriving' (+ QA readout).
//   stepPlayer(dt, input, opts)       Game.update's hook instead of Player.update while riding (see the update order below).
//   tiltCamera(camera)                Game.updateCamera's hook: the car's jostle roll / pitch on the view.
//   blocksWeapons / refuseFire()      weapon fire / melee / flare throws are blocked while riding ("Holster — the train is moving").
//   refuseDrop()                      the fallback refusal of a riding drop (task train-loose-cargo: Game.dropRef hands riding drops to
//                                     world/trainCargo.ts — they arrive with the train); the gear's backpack set-down stays refused.
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
// TRANSIT (trainTransitTunnel.ts): the car stands at TRANSIT.origin with the yaw it had and the procedural tunnel scrolls past it at
// up to RIDE.cruise m/s with red signals passing the windows; nothing moves in world space, so the primary's main-thread hitches
// (0.3-2 s world builds) only advance the clamped dt: the motion continues sensibly after each, no teleport, no drift. A failed load
// keeps it looping (the player is always inside the car's walls: never in the void).
//
// Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN):
//  - item 15: the transit is VERY DARK (no warm lamps; while it shows, the scene fog is the indoor tunnel murk — a level's own fog,
//    e.g. the mall's grey haze, is held and given back when the car leaves the transit; uniform values only) with red signals at a
//    metro block spacing scrolling at the car's speed. Lights: the car's boot-time lights and the flashlight only. The station light
//    field reads zero this far from any station (tests), so nothing else lights the box.
//  - item 16: FRONT FIRST always: the transit only ever runs +X (no reverse velocity, no dwell, no reversal); the car's yaw is carried
//    into the transit and turned (bounded rate, the whole view with it) toward the arrival heading — no 180-degree snap. (How a bed
//    end is crossed and where the hand-overs happen: the ride portals below, which replaced this item's stub / edge crossings.)
//    Spent brass lying in the car rides with it (Physics casings: relocate / carry by the car's pose change).
//  - item 17: the sound (trainRideAudio.ts): continuous rumble / air loops blended by speed (start / cruise / decel / stop), the run
//    layer, rail-joint clacks, brake release / brake / stop one-shots — stopped on the stop, reset, a failed journey and dispose,
//    silenced on pause / menus. The doors use the runtime's own cues.
//
// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane RIDE). User: "Make train transitions SEAMLESS between levels. The
// train visibly plows through real walls / black walls; the cuts into the fake tunnel and back to the real destination are obvious."
// Before: the car followed a station tunnel's bends (its body cut the walls), drove through a closed end's wall and barricade (or
// stopped at its black plane), and was cut to the transit 4 m into the dark with the station still in view; it popped into the next
// station 4 m outside its mouth. Now (the lead's contract: world/ridePortal.ts, ridePortalRuntime.ts, rideMask.ts):
//  - THE CAR RUNS STRAIGHT along its own track, both ways (trainRideRoute.ts). Beyond the PORTAL PLANE of that bed end it is inside
//    the RIDE TUNNEL: the transit tunnel placed as a stub from the plane outward (trainTransitTunnel.ts), co-axial with the track.
//  - DEPARTURE: when the doors start to close the FRONT portal is engaged (the station draws nothing in the tunnel's volume, its baked
//    light reads zero there), the stub stands behind it and its gate swings open; the car pulls away once the doors are shut AND the
//    gate is fully open, runs through the plane (the gate shuts behind it) and on until the plane is RIDE_PORTAL.dark behind its
//    trailing end — only there, out of the murk's sight, the stub becomes the transit around the car and the station is let go.
//  - ARRIVAL: the transit hands the car back RIDE_PORTAL.dark before the REAR portal's plane, at the moment the car's place in the
//    tunnel's 48 m pattern is the one the stub gives it (so the box ends exactly at the plane and nothing around the car moves); the
//    car runs in through the open gate, brakes to the exact stop; the gate shuts behind it and the portal is released (after the
//    stop, if the gate is still swinging: a frame hook finishes it).
//  - Within sight NOTHING changes at either hand-over, in the car's frame: the box (walls, floor, ceiling, rails, the sleepers'
//    phase), the signals, the car's pose / speed / jostle, the fog and the light mask (tests/train-ride-portal*.test.ts).
//  - THE FOG in the ride tunnel is the tunnel murk whatever the level's own is (the mall's haze would show the portal's opening at
//    70 % from the hand-over distance): it blends in while the EYE passes the plane (RIDE.fogBand) and back out on arrival. The
//    levels write the scene fog from their own hooks, so the ride gives the level's value back at the frame's start (stepPlayer) and
//    takes it over at the frame's end (lateFrame, after the hooks): what is DRAWN is the ride's, what the level reads is its own.
//  - THE LIGHT MASK (rideMask.ts): the portal runtime sets it for a station's portal; the ride sets the transit tunnel's box while in
//    transit (and the portal's box itself when no runtime did), and clears its own when the ride ends.
//  - No bend following, no 'stub' / 'edge' / 'tunnel' crossing modes, no hand-over within sight of a station.

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
  wrapAngle, yawCS, type CarPose, type Jostle, type P3, type RideLocalModel,
} from './trainRideLocal';
import {arrivalPlan, departurePlan, type RidePlan} from './trainRideRoute';
import {TRANSIT, TrainTransitTunnel, transitMaskBox, transitMaterials, type TransitMaterials} from './trainTransitTunnel';
import {TrainRideAudio} from './trainRideAudio';
import {MOOD, syncGlowFog} from './lights';
import {PLAYER_TRAIN_SPEC} from './playerTrainSpec';
import {RIDE_PORTAL, type Box3} from './ridePortal';
import type {PortalWhich, RidePortalRuntime} from './ridePortalRuntime';
import {RIDE_MASK, setRideMask} from './rideMask';

/** How far along the car from its centre anything in the tunnel can be seen from inside it: its end + the murk's sight (m). */
const SIGHT = PLAYER_TRAIN_SPEC.length / 2 + RIDE_PORTAL.dark;

/** Motion tuning (m, s, m/s, m/s², m/s³). */
export const RIDE = {
  /** Longest step the car integrates per frame (a hitch only advances this much: no teleport). */
  maxDt: 0.1,
  /** Doors shut -> the car pulls away after this pause (and not before the portal's gate stands fully open). */
  departDelay: 0.8,
  /** ... but a gate that has not opened this long after the pause never holds the journey (QA counts it). */
  gateWait: 6,
  /** Ease-in: the acceleration ramps up at `jerk` to `accel`. */
  accel: 1.05, jerk: 0.75,
  /**
   * Speed caps: in a station (departing, until the whole car is beyond the portal plane), in the ride tunnel / the transit. An arrival
   * enters at the speed its braking distance to the stop allows (at most `cruise`): no fixed crawl over a long approach.
   */
  departMax: 11, cruise: 15,
  /** Service braking (arrival) and the transit's deceleration. */
  brake: 0.85, transitBrake: 1.2,
  /** The last centimetres of a stop never stall. */
  creep: 0.35,
  /** At least this long in transit before the car leaves for the next station. */
  minTransit: 6,
  /** Multi-hop journeys (lane MAP): + hopTransit s per hop beyond the first, at most hopTransitCap s in all (bounded: survival time). */
  hopTransit: 2, hopTransitCap: 6,
  /** Item 16: in transit the car's yaw turns toward the arrival heading at most this fast (rad/s; the whole view turns with it). */
  yawRate: 0.8,
  /**
   * Item 15: once the arrival is planned the transit shows no new signal beyond this band (m along the car from its centre: behind,
   * ahead — the car's ends + RIDE_PORTAL.dark: the fog hides anything beyond it, so nothing pops); the ones inside it pass on and are
   * carried into the arrival's stub at the hand-back (the same places around the car).
   */
  signalBand: [-SIGHT, SIGHT] as const,
  /** A departure stub's first signal beyond the portal plane (m). */
  stubSignal: 50,
  /** The gate starts to shut once the car's trailing end is this far past the portal plane (its leaves fold into the tunnel side). */
  gateClear: 1.5,
  /** An arrival through a breach lets the portal go once the car's trailing end is this far inside the station (m), or at the stop. */
  stubRelease: 20,
  /** A GATE portal still not released this long after the stop goes at once (s). */
  releaseWait: 5,
  /**
   * A BREACH's release tail waits for the portal runtime instead (it lets the station tunnel back only where nobody sees it change:
   * world/ridePortalRuntime.ts PORTAL_RT, last resort after its own 90 s); this is only the ride's outer bound for a runtime that never
   * lets go. A gate is shut by then and goes after `releaseWait`.
   */
  breachReleaseWait: 120,
  /**
   * The scene fog blends from the level's own to the tunnel murk (MOOD) while the eye passes the portal plane: from / to this many
   * metres beyond it (negative: the station side).
   */
  fogBand: [-3, 3] as const,
  /** Door closing: retry a re-opened (blocked) door every closeRetry s, give up after closeTimeout s. */
  closeRetry: 1.2, closeTimeout: 9,
  /** Bogie half spacing (m): the body rides the chord between the bogies. */
  bogie: 5.5,
  /** Seconds between "Holster" / "Not while moving" notes. */
  noteEvery: 2.5,
} as const;

export type RidePhase = 'idle' | 'closing' | 'departing' | 'transit' | 'arriving';
export type RideRefusal = 'no-train' | 'dead' | 'climbing' | 'busy' | 'outside' | 'door-blocked' | 'aborted' | 'not-riding';
/** `via`: what the layout has at the portal's bed end — a station tunnel ('tunnel': a breach portal) or a closed end ('bed-end': a gate). */
export type DepartResult = {status: 'in-tunnel'; via: 'tunnel' | 'bed-end'; end: 'x0' | 'x1'; dir: 1 | -1} | {status: 'refused'; reason: RideRefusal; message: string};
/** `reversed` is always false since item 16 (kept for the API: the car never reverses). */
export type ArriveResult = {status: 'stopped'; via: 'tunnel' | 'bed-end'; end: 'x0' | 'x1'; reversed: boolean} | {status: 'refused'; reason: RideRefusal; message: string};
/** QA: one hand-over (station <-> transit) as the ride made it. */
export interface HandOver {
  /** Car-centre u on the station plan and the plane's distance beyond the car's nearer end (m; >= RIDE_PORTAL.dark). */
  u: number;
  clear: number;
  speed: number;
  /** The car's place in the tunnel's pattern (0 .. TRANSIT.period) just before / just after. */
  pattern: [number, number];
}

/**
 * Lane MAP's multi-hop journey (task campaign-polish): route[0] = the current station, route[last] = the destination, consecutive
 * pairs are track edges (length 2 = one hop). One continuous ride; the intermediates are never built.
 */
export interface RideJourney { route: readonly string[] }

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
  world?: {culler?: unknown; group?: THREE.Object3D} | null;
  /** Physics (structural, read as BrassHost): spent brass lying in the riding car moves with it (physics/casings.ts relocate / carry). */
  physics?: unknown;
  mats?: WorldMaterials | null;
  warmRegistry?: WarmupRegistry;
  gear?: {placeRules?: ((x: number, y: number, z: number, level: number) => string | null)[]} | null;
  stateListeners?: ((state: never, prev: never) => void)[];
  sectionHooks?: {build?(layout: StationLayout): void; teardown?(): void}[];
  /** (lane RIDE, train continuity) Game.frameHooks: after an arrival's stop the ride finishes its portal's release from one (absent: at once). */
  frameHooks?: ((dt: number) => void)[];
  /** Task studio-perf-ao-train-continuity-20261110-022206-01: the station's ride portals (gates / breaches; world/ridePortalRuntime.ts). */
  ridePortals?: RidePortalRuntime;
}

export interface RideOptions {
  /** The jostle intensity 0..1 (a Settings getter; default RIDE_JOSTLE.intensity). */
  jostle?: () => number;
  /** Toast refusals / notes on the HUD (default true). */
  toasts?: boolean;
  /** Tests: the transit's materials when the host has no world material cache. */
  transitMaterials?: () => TransitMaterials;
}

/** The casings surface the ride uses (physics/casings.ts CasingSystem). */
interface BrassHost {
  casings?: {relocate?(move: (x: number, y: number, z: number) => [number, number] | null): void; carry?(inside: (x: number, y: number, z: number) => boolean, dy: number): void};
}

interface Local { x: number; y: number; z: number; yaw: number; vx: number; vz: number }
type Pending<T> = {resolve: (v: T) => void} | null;

export class TrainRide {
  phase: RidePhase = 'idle';
  /** The player's car-local pose (the truth while riding). */
  readonly local: Local = {x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0};
  /** The car's world pose this frame (incl. the jostle) and without it. */
  readonly pose: CarPose = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0};
  readonly base: CarPose = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0};
  readonly jostle: Jostle = {lateral: 0, roll: 0, pitch: 0, bump: 0};
  /** Speed along the motion (m/s, >= 0) and its direction relative to the car (+1 front-first: always, since item 16). */
  speed = 0;
  readonly dir: 1 | -1 = 1;
  /** Car-centre position on the current station plan's route. */
  u = 0;
  plan: RidePlan | null = null;
  /** The station placement the current plan belongs to. */
  placement: TrainPlacement | null = null;
  /** Total distance travelled this ride (jostle joints) and the ride clock. */
  dist = 0;
  clock = 0;
  /** Transit: velocity along the car's local +X (never negative), seconds in transit. */
  transitV = 0;
  transitT = 0;
  readonly transit: TrainTransitTunnel;
  /** Item 17: the sound. */
  readonly audio: TrainRideAudio;
  /** This ride's journey (hops) and its minimum transit (s). */
  journey: {route: string[]; hops: number; minTransit: number} = {route: [], hops: 1, minTransit: RIDE.minTransit};
  /**
   * (train continuity) The ride portal this ride has engaged at the current station (world/ridePortalRuntime.ts; null: none) — the
   * departure's 'front' from the start of the door closing to the hand-over, the arrival's 'rear' from the hand-back until its gate
   * has shut behind the car.
   */
  engaged: PortalWhich | null = null;
  /** (train continuity) QA: the last hand-overs — station -> transit (`out`) and transit -> station (`back`). */
  readonly hand: {out: HandOver | null; back: HandOver | null} = {out: null, back: null};
  /** QA. */
  readonly counts = {departs: 0, refused: 0, arrivals: 0, handovers: 0, reversals: 0, clampedSteps: 0, closeRetries: 0, fireBlocked: 0, dropsBlocked: 0, stubs: 0, gates: 0, breaches: 0, gateWaits: 0, phaseWaits: 0, fogHolds: 0, brassCarried: 0};
  lastRefusal: RideRefusal | null = null;
  failure: string | null = null;
  readonly model: RideLocalModel;

  private phaseT = 0;
  private accelNow = 0;
  private closeT = 0;
  private retryT = 0;
  private arrivalReady = false;
  private arrivalPlanned: RidePlan | null = null;
  private departing: Pending<DepartResult> = null;
  private arriving: Pending<ArriveResult> = null;
  private noteT = 1e9;
  private brakeCued = false;
  private released: THREE.Object3D | null = null;
  /** A closed bed end's black plane (where no gate view replaced it) hidden while its portal is engaged (restored after). */
  private hiddenPlane: THREE.Object3D | null = null;
  /** (train continuity) The engaged portal's gate: what the ride last asked, its last read swing, whether the runtime has a gate there (cues). */
  private gateWant = false;
  private gateWas = 0;
  private gateReal = false;
  private gateDist = 0;
  /** release() was asked of the engaged portal (its gate is shutting / its breach waits to go unobserved). */
  private releasing = false;
  /** After the stop: the portal still to be released (stepped from a frame hook; `t` s since the stop). */
  private tail: {which: PortalWhich; t: number} | null = null;
  /** RIDE_MASK.version of the mask the ride set itself (-1: none): only that one is the ride's to clear. */
  private maskMine = -1;
  private readonly transitBox: Box3 = transitMaskBox();
  /**
   * The scene fog: while the ride's value is in the scene (`fogSet`), `fogOwn` is the level's own (given back at the frame's start and
   * on every exit) and `fogDrawn` what the ride wrote (to tell a level's later write from its own).
   */
  private fogSet = false;
  private fogOn = false;
  private readonly fogOwn = {color: new THREE.Color(), density: 0};
  private readonly fogDrawn = {color: new THREE.Color(), density: 0};
  private readonly prevPose: CarPose = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0};
  private readonly tmp: P3 = {x: 0, y: 0, z: 0};
  private readonly tmp2: P3 = {x: 0, y: 0, z: 0};
  private readonly tmp3: P3 = {x: 0, y: 0, z: 0};
  private readonly fogColor = new THREE.Color(MOOD.fogColor);
  private readonly tmpColor = new THREE.Color();
  private readonly eyeAt: P3 = {x: 0, y: 0, z: 0};
  private readonly qTilt = new THREE.Quaternion();
  private readonly qYaw = new THREE.Quaternion();
  /** The camera tiltCamera last tilted and the orientation it left it in (a second call on the same pose is a no-op). */
  private tiltedCam: THREE.Camera | null = null;
  private readonly qTilted = new THREE.Quaternion();
  private readonly eTilt = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly link: TrainRideLink;
  private transitBuilt = false;

  constructor(readonly host: RideHost, readonly runtime: PlayerTrainRuntime, readonly opts: RideOptions = {}) {
    this.model = buildRideLocalModel(runtime.spec, runtime.consoleRect);
    this.transit = new TrainTransitTunnel();
    this.audio = new TrainRideAudio(() => this.host.sfx);
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
    // a teardown: the old world's end plane / fog are its own again (its atmosphere restores its fog itself; the next one re-applies)
    h.sectionHooks?.push({build: () => this.ensureTransit(), teardown: () => this.sectionGone()});
    // (train continuity) after an arrival's stop the gate may still be swinging shut: the portal's release finishes from here
    h.frameHooks?.push(dt => this.stepTail(dt));
    h.warmRegistry?.addPool('train-transit', () => (this.transitBuilt ? [this.transit.group] : []));
    h.gear?.placeRules?.push(() => (this.riding ? 'Not while the train is moving' : null));
    h.stateListeners?.push(((state: string) => {
      if (state === 'dead' || state === 'title' || state === 'error') this.reset();
      else if (state !== 'playing') this.audio.silence(); // pause / inventory / a map or any menu: the ride sound goes quiet with it
    }) as (s: never, p: never) => void);
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
    if (this.transitBuilt) return;
    const make = this.host.mats ? () => transitMaterials(this.host.mats!) : this.opts.transitMaterials;
    if (!make) return;
    try {
      this.transit.build(make());
      this.transitBuilt = true;
    } catch (err) { console.warn('train ride: transit tunnel unavailable', err); }
  }

  // -------------------------------------------------------------------------------------------
  // Departure

  /** One hop (the original call; the perf recorder wraps this method by name). */
  depart(): Promise<DepartResult>;
  /** A journey (lane MAP's RideJourney: [current, ..., destination]); undefined = one hop. */
  depart(journey: RideJourney | undefined): Promise<DepartResult>;
  depart(journey?: RideJourney): Promise<DepartResult> {
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
    this.journey = journeyOf(journey);
    // ride mode from now on: the car frame at the placement (the player is held inside the closed-door walls while they shut)
    this.placement = p;
    this.plan = departurePlan(t.layout, p); // item 16: the FRONT end, always (sgn +1)
    this.hand.out = this.hand.back = null;
    this.u = 0;
    this.speed = 0;
    this.accelNow = 0;
    this.dist = 0;
    this.clock = 0;
    this.audio.begin(0);
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
    // (train continuity) the portal ahead, while the doors close: the station draws nothing in the tunnel's volume from now on, the
    // ride tunnel stands behind the plane and the gate swings open — the car waits for it (stepClosing)
    this.ensureTransit();
    this.engage(this.plan, false);
    this.transit.placeStub({x: this.plan.portal.x, y: p.railTopY, z: p.z}, {x: this.plan.portal.out, z: 0}, p.yaw, RIDE.stubSignal);
    this.counts.stubs++;
    this.setGate(true);
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
    this.transitV = this.speed;
    this.transitT = 0;
    // the car keeps its yaw (no world-yaw snap); the stub it is in becomes the transit around it — the same pattern and signals — else
    // (no stub: a hand-over forced early) the next signal waits out of sight
    const plan = this.plan, L2 = this.runtime.spec.length / 2, before = this.transit.patternAt(this.base.x, this.base.z);
    if (this.transit.mode === 'stub') this.transit.handOver(this.base.x, this.base.z);
    else { this.transit.enterTransit(this.base.yaw); this.transit.setSignalAhead(TRANSIT.signal.ahead); }
    // (train continuity) the station is out of sight behind the car (RIDE_PORTAL.dark of murk): its portal is let go at once, its end
    // plane is whole again; the light mask is the transit tunnel's box from here
    this.dropPortal();
    this.ownMask(this.transitBox, Number.NaN);
    this.setPhase('transit');
    Object.assign(this.base, {x: TRANSIT.origin.x, y: TRANSIT.origin.y, z: TRANSIT.origin.z, pitch: 0, roll: 0});
    if (plan) this.hand.out = {u: this.u, clear: this.u - L2 - plan.uPlane, speed: this.speed, pattern: [before, this.transit.patternAt(this.base.x, this.base.z)]};
    const d = this.departing;
    this.departing = null;
    d?.resolve({status: 'in-tunnel', via: this.plan?.kind ?? 'tunnel', end: this.plan?.end ?? 'x0', dir: this.dir});
    return true;
  }

  /** Hide the transit tunnel (the car is in a station again). */
  leaveTransit(): void {
    this.transit.leaveTransit();
    this.fogBack();
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
    this.audio.stop(0.1);
    if (!this.riding) { if (this.engaged || this.tail) this.dropPortal(); return; } // (a portal still shutting after an arrival goes at once)
    const d = this.departing, a = this.arriving;
    this.departing = this.arriving = null;
    this.exitRide();
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
    const P = this.host.player, L = this.local;
    this.fogBack(); // (train continuity) the level's own scene fog while its hooks run this frame; lateFrame takes it over again
    L.yaw = P.yaw - this.pose.yaw; // the mouse look was applied to the world yaw (relative to the car's pose of the last frame)
    const cdt = Math.max(0, Math.min(dt, RIDE.maxDt));
    if (dt > RIDE.maxDt) this.counts.clampedSteps++;
    this.advance(cdt);
    if (!this.riding) return P.update(dt, input, this.host.levels, this.host.propIndex, opts);
    const [sx, sz] = toStep(L.x, L.z);
    P.x = sx; P.z = sz; P.y = L.y; P.yaw = L.yaw; P.vx = L.vx; P.vz = L.vz;
    let step = false;
    try {
      step = P.update(cdt, input, this.model.levels, this.model.props, opts);
    } finally {
      [L.x, L.z] = fromStep(P.x, P.z);
      // the car floor is flat: a grounded body stands exactly on it (the grid stores float32 heights)
      L.y = P.grounded && Math.abs(P.y - this.runtime.spec.floorY) < 1e-4 ? this.runtime.spec.floorY : P.y;
      L.yaw = P.yaw; L.vx = P.vx; L.vz = P.vz;
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

  /**
   * Game.updateCamera: the car's roll / pitch on the camera (premultiplied in world space; yaw is already in the player's yaw).
   * (train continuity) It is also the ride's LATE call of the frame — Game.updateCamera runs after the frame hooks, at the end of a
   * section build and in the transit gap — so the scene fog the frame is drawn with is settled here (lateFrame).
   */
  tiltCamera(camera: THREE.Camera): void {
    if (this.riding || this.fogSet) this.lateFrame();
    if (!this.riding) return;
    const c = this.pose;
    if (c.roll === 0 && c.pitch === 0) return;
    // (train continuity) once per camera pose: Game's transit gap calls this again right after updateCamera did — the jostle's tilt
    // was doubled there and halved the moment the next station was built (a roll step in the view mid-transit)
    if (camera === this.tiltedCam && camera.quaternion.equals(this.qTilted)) return;
    this.eTilt.set(c.roll, c.yaw, c.pitch, 'YZX');
    this.qTilt.setFromEuler(this.eTilt);
    this.qYaw.setFromAxisAngle(this.yAxis, -c.yaw);
    this.qTilt.multiply(this.qYaw);
    camera.quaternion.premultiply(this.qTilt);
    this.tiltedCam = camera;
    this.qTilted.copy(camera.quaternion);
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
    Object.assign(this.prevPose, this.pose);
    switch (this.phase) {
      case 'closing': this.stepClosing(dt); break;
      case 'departing': this.stepDeparting(dt); break;
      case 'transit': this.stepTransit(dt); break;
      case 'arriving': this.stepArriving(dt); break;
    }
    if (!this.riding) return;
    this.composePose();
    this.applyView();
    this.carryBrass(this.prevPose);
    this.stepPortal(dt);
    // (train continuity) in transit the light mask is the transit tunnel's box (a teardown / a build in between may have cleared it)
    if (this.phase === 'transit' && RIDE_MASK.version !== this.maskMine) this.ownMask(this.transitBox, Number.NaN);
    this.audio.step(dt, this.speed, this.dist, this.phase === 'arriving');
  }

  private stepClosing(dt: number): void {
    const t = this.runtime.train;
    if (!t || !this.host.player.alive) { this.failDepart('aborted'); return; }
    if (this.doorsShut()) {
      this.closeT += dt;
      // (train continuity) the car pulls away only through a gate that stands fully open (bounded: a gate never holds the journey)
      const late = this.closeT >= RIDE.departDelay + RIDE.gateWait;
      if (this.closeT >= RIDE.departDelay && (late || this.gateOpen())) {
        if (late && !this.gateOpen()) this.counts.gateWaits++;
        this.releaseFromCuller();
        this.setPhase('departing');
        this.audio.cue('clank', {rate: 0.7, gain: 0.45, filter: {type: 'lowpass', freq: 1400}}); // the brake release
        this.audio.cue('creak', {rate: 0.55, gain: 0.35, delay: 0.15, filter: {type: 'lowpass', freq: 1600}});
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
    this.exitRide();
    if (reason !== 'aborted') this.toast(REFUSAL_TEXT[reason], true);
    d?.resolve({status: 'refused', reason, message: REFUSAL_TEXT[reason]});
  }

  /** Ease-in: the acceleration ramps up by the jerk to its cap, the speed to `vmax` (at the cap the ramp starts over: a raised cap eases in too). */
  private accelerate(dt: number, vmax: number): void {
    const v0 = this.speed;
    if (v0 >= vmax) { this.accelNow = 0; return; }
    this.accelNow = Math.min(RIDE.accel, this.accelNow + RIDE.jerk * dt);
    this.speed = Math.min(vmax, v0 + this.accelNow * dt);
  }

  private stepDeparting(dt: number): void {
    const plan = this.plan!, L2 = this.runtime.spec.length / 2;
    const v0 = this.speed;
    // the station's speed until the whole car is beyond the portal plane, the tunnel's from there
    this.accelerate(dt, this.u - L2 >= plan.uPlane ? RIDE.cruise : RIDE.departMax);
    const du = ((v0 + this.speed) / 2) * dt;
    this.u = Math.min(this.u + du, plan.uMax);
    this.dist += du;
    this.poseOnRoute();
    // the gate shuts behind the car; the hand-over: the plane RIDE_PORTAL.dark behind the trailing end (out of the murk's sight)
    if (this.u - L2 >= plan.uPlane + RIDE.gateClear) this.setGate(false);
    if (this.u >= plan.uHand) this.enterTransit();
  }

  private stepTransit(dt: number): void {
    this.transitT += dt;
    const rt = this.runtime;
    // the arrival: once the primary built the next station and the car has run long enough, approach its entry velocity front first
    let target: number = RIDE.cruise, plan: RidePlan | null = null, ready = false;
    if (this.arrivalReady && rt.train && this.transitT >= this.journey.minTransit) {
      if (!this.arrivalPlanned || this.placement !== rt.train.placement) {
        this.placement = rt.train.placement;
        this.arrivalPlanned = arrivalPlan(rt.train.layout, rt.train.placement); // item 16: the REAR end, cab first
      }
      plan = this.arrivalPlanned;
      // the entry speed: what the braking distance of the whole run-in allows (the car brakes from the hand-back to the exact stop)
      target = Math.min(RIDE.cruise, Math.sqrt(2 * RIDE.brake * plan.uHand));
      // the car's yaw turns toward the arrival heading (bounded rate; the box and the view turn with it: nothing visible changes)
      const want = this.continuousYaw(this.placement.yaw), dy = want - this.base.yaw, maxTurn = RIDE.yawRate * dt;
      this.base.yaw = Math.abs(dy) <= maxTurn ? want : this.base.yaw + Math.sign(dy) * maxTurn;
      this.transit.setYaw(this.base.yaw);
      // no new signal comes into sight from here on (the ones in sight are carried into the arrival's stub: none of them can stand
      // at the portal plane, which is `hi` ahead of the car at the hand-back)
      const [lo, hi] = RIDE.signalBand;
      this.transit.hideSignalsOutside(lo, hi - TRANSIT.signal.planeClear);
      ready = this.transitV === target && this.base.yaw === want;
    }
    const w0 = this.transitV, gap = target - w0;
    if (Math.abs(gap) > 1e-9) {
      let a: number;
      if (gap > 0) { this.accelNow = Math.min(RIDE.accel, this.accelNow + RIDE.jerk * dt); a = this.accelNow; } else { this.accelNow = 0; a = RIDE.transitBrake; }
      this.transitV = Math.abs(gap) <= a * dt ? target : w0 + Math.sign(gap) * a * dt;
    } else { this.transitV = target; this.accelNow = 0; }
    const ds = ((w0 + this.transitV) / 2) * dt;
    this.speed = Math.abs(this.transitV);
    if (plan && ready) {
      // (train continuity) at the entry speed and heading: the hand-back waits for the car's place in the tunnel's pattern — where the
      // arrival's stub, whose box ends exactly at the portal plane, has the same sleepers / boards around the car (at most one period)
      const need = this.transit.arrivalGap(plan.uHand - plan.uPlane);
      if (need <= ds) {
        this.transit.advance(need);
        this.dist += need;
        this.beginArrival(plan, ds - need);
        return;
      }
      this.counts.phaseWaits++;
    }
    this.transit.advance(ds);
    this.dist += Math.abs(ds);
  }

  /**
   * Transit -> the arrival station (the hand-back): the REAR portal is engaged with its gate open, the tunnel around the car becomes
   * that portal's stub (same pattern, same signals), the car stands RIDE_PORTAL.dark before the plane on the arrival plan — and has
   * `rest` m of this frame still to run.
   */
  private beginArrival(plan: RidePlan, rest: number): void {
    const p = this.placement!, L2 = this.runtime.spec.length / 2, before = this.transit.patternAt(this.base.x, this.base.z);
    this.plan = plan;
    this.brakeCued = false;
    this.engage(plan, true);
    this.transit.handBack({x: plan.portal.x, y: p.railTopY, z: p.z}, {x: plan.portal.out, z: 0}, this.base.yaw, plan.uHand - plan.uPlane);
    this.counts.handovers++;
    this.counts.stubs++;
    this.setPhase('arriving');
    this.u = plan.uHand;
    this.base.y = p.railTopY;
    this.poseOnRoute();
    this.hand.back = {u: this.u, clear: this.u - L2 - plan.uPlane, speed: this.speed, pattern: [before, this.transit.patternAt(this.base.x, this.base.z)]};
    this.u -= rest;
    this.dist += rest;
    this.poseOnRoute();
  }

  private stepArriving(dt: number): void {
    const plan = this.plan!;
    const d = this.u; // remaining distance to the placement (the car runs -u to 0)
    const v = this.speed, brakeDist = (v * v) / (2 * RIDE.brake);
    const b = d > brakeDist + 0.01 ? 0 : (v * v) / (2 * Math.max(1e-4, d));
    if (b > 0 && !this.brakeCued) { this.brakeCued = true; this.audio.cue('creak', {rate: 0.5, gain: 0.5, filter: {type: 'lowpass', freq: 1800}}); }
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
    // (train continuity) the portal's job is done once the car is through: the gate shuts behind its trailing end (a breach goes once
    // the car is well inside); the ride tunnel behind it goes when the runtime has let the portal go (stepPortal)
    const inside = plan.uPlane - (this.u + this.runtime.spec.length / 2);
    if (inside >= (plan.kind === 'tunnel' ? RIDE.stubRelease : RIDE.gateClear)) this.askRelease();
  }

  /** The stop: exactly at the placement; ride mode ends (normal physics in the parked car), the promise resolves. */
  private stop(): void {
    const plan = this.plan;
    this.audio.cue('clank', {rate: 0.85, gain: 0.45, filter: {type: 'lowpass', freq: 1500}});
    this.counts.arrivals++;
    const a = this.arriving;
    this.arriving = null;
    this.exitRide(true);
    a?.resolve({status: 'stopped', via: plan?.kind ?? 'tunnel', end: plan?.end ?? 'x0', reversed: false});
  }

  /**
   * Leave ride mode: the car parked at the runtime's placement (exact), the player at the same car-local pose there.
   * `arrived`: the stop of an arrival — a portal whose gate is still swinging shut keeps the ride tunnel behind it until it has shut
   * (the release tail, from a frame hook); every other exit (reset, a refused / aborted departure) lets everything go at once.
   */
  private exitRide(arrived = false): void {
    const rt = this.runtime, t = rt.train;
    if (!(arrived && this.startTail())) { this.dropPortal(); this.transit.leaveTransit(); }
    this.fogBack();
    this.fogOn = false;
    this.audio.stop();
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
      this.registerWithCuller(t.view.fixed);
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

  /**
   * The car on its station plan at u: on the straight track line (trainRideRoute.ts: the chord between the bogies IS the line), y =
   * the rail top, its yaw the placement's — a departure's exactly; an arrival keeps the yaw it turned to in transit (the same heading).
   */
  private poseOnRoute(): void {
    const plan = this.plan, p = this.placement;
    if (!plan || !p) return;
    if (this.u === 0 && this.phase !== 'arriving') { Object.assign(this.base, placementPose(p)); return; }
    this.base.x = p.x + plan.portal.out * this.u; this.base.z = p.z; this.base.y = p.railTopY;
    if (this.phase !== 'arriving') this.base.yaw = p.yaw;
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

  /** Parked again: back in the CURRENT world's culler when it was released here or a build while riding skipped it. */
  private registerWithCuller(fixed: THREE.Object3D): void {
    const cul = this.host.world?.culler as {register?(o: THREE.Object3D): void} | undefined;
    if ((this.released === fixed || this.runtime.cullerPending) && cul && typeof cul.register === 'function') cul.register(fixed);
    this.released = null;
    this.runtime.cullerPending = false;
  }

  // -------------------------------------------------------------------------------------------
  // Train continuity: the ride portal (engage / gate / release), the light mask

  /**
   * The ride starts using its plan's portal (the departure's FRONT when the doors start to close, the arrival's REAR at the
   * hand-back): the runtime hides what the station draws in the tunnel's volume and darkens its baked light there; `gateOpen` = the
   * gate's state at once. Every use is optional-chained: with no runtime (tests' hosts) the ride works alone and the gate reads open.
   */
  private engage(plan: RidePlan, gateOpen: boolean): void {
    if (this.engaged || this.tail) this.dropPortal(); // (one ride tunnel: a portal still shutting from the last arrival goes at once)
    const rp = this.host.ridePortals, v0 = RIDE_MASK.version;
    rp?.engage(plan.which, {gateOpen});
    this.engaged = plan.which;
    this.releasing = false;
    this.gateWant = gateOpen;
    this.gateReal = rp?.portal(plan.which)?.kind === 'gate';
    this.gateWas = this.gateSwing();
    this.gateDist = Math.abs(plan.uPlane - this.u);
    if (plan.kind === 'tunnel') this.counts.breaches++; else this.counts.gates++;
    // the runtime sets the light mask of its portal; where none did (no runtime, an inert one) the ride does: the tunnel is rock-bound
    if (RIDE_MASK.version === v0) this.ownMask(plan.portal.box, plan.portal.x);
    // a closed end that still has its black plane (no gate view built): hidden while the portal is in use
    if (plan.kind === 'bed-end') this.hidePlane(plan.portal.trench, plan.end);
  }

  /** The engaged portal's gate swing 0 (shut) .. 1 (open): the runtime's; without one, what the ride asked (at once). */
  private gateSwing(): number {
    const which = this.engaged, rp = this.host.ridePortals;
    if (!which) return 0;
    return rp ? rp.gate(which) : this.gateWant ? 1 : 0;
  }

  private gateOpen(): boolean { return !this.engaged || this.gateSwing() >= 1 - 1e-3; }

  /** Ask the engaged portal's gate to swing open / shut (once per change; the leaves' creak where a real gate stands). */
  private setGate(open: boolean): void {
    if (!this.engaged || this.gateWant === open) return;
    this.gateWant = open;
    this.host.ridePortals?.setGate(this.engaged, open);
    if (this.gateReal) this.gateCue(false);
  }

  /**
   * The gate's sound with the EXISTING cues (no new clip): a low creak as the leaves start to move, a clank as they stop — heard from
   * the car, so quieter the further the gate is.
   */
  private gateCue(stop: boolean): void {
    const k = 1 / (1 + (this.gateDist / 20) ** 2);
    if (stop) this.audio.cue('clank', {rate: 0.6, gain: 0.08 + 0.34 * k, filter: {type: 'lowpass', freq: 1200}});
    else this.audio.cue('creak', {rate: 0.42, gain: 0.08 + 0.3 * k, filter: {type: 'lowpass', freq: 1100}});
  }

  /** The ride is done with its portal (the car is through): the gate shuts, then the runtime puts the station back (stepPortal waits for it). */
  private askRelease(): void {
    if (!this.engaged || this.releasing) return;
    this.setGate(false);
    this.host.ridePortals?.release(this.engaged);
    this.releasing = true;
  }

  /** Has the runtime let the engaged portal go (or its gate shut: the tunnel behind it is out of view)? No runtime: at once. */
  private portalReleased(): boolean {
    const which = this.engaged, rp = this.host.ridePortals;
    if (!which || !rp) return true;
    return !rp.engaged(which) || (this.gateReal && rp.gate(which) <= 1e-3);
  }

  /** Per frame while a portal is engaged (the ride's frame; after the stop the release tail): the runtime's step, the gate's cues, the release. */
  private stepPortal(dt: number): void {
    const which = this.engaged;
    if (!which) return;
    const P = this.host.player, plan = this.plan, e = this.eyeAt;
    if (plan) this.gateDist = Math.abs(plan.uPlane - this.u);
    e.x = P.x; e.y = P.eye; e.z = P.z;
    this.host.ridePortals?.step(dt, e);
    const g = this.gateSwing();
    if (this.gateReal && g !== this.gateWas && (g >= 1 || g <= 0)) this.gateCue(true);
    this.gateWas = g;
    if (this.releasing && this.portalReleased()) this.dropPortal();
  }

  /**
   * Everything of the portal goes at once: the runtime's release (`now`), the stub (a tunnel in transit stays), a hidden end plane,
   * the ride's own light mask. Every exit path ends here (the hand-over, the release after an arrival, reset, a refused departure).
   */
  private dropPortal(): void {
    const which = this.engaged ?? this.tail?.which ?? null;
    if (which) this.host.ridePortals?.release(which, {now: true});
    this.engaged = null;
    this.releasing = false;
    this.tail = null;
    if (this.transit.mode === 'stub') this.transit.leaveTransit();
    this.restorePlane();
    this.clearOwnMask();
  }

  /** The stop of an arrival with its portal not released yet: finish it from the frame hook (false: nothing to wait for / no hook). */
  private startTail(): boolean {
    const which = this.engaged;
    if (!which || !this.host.frameHooks) return false;
    this.askRelease();
    if (this.portalReleased()) return false;
    this.tail = {which, t: 0};
    return true;
  }

  /** The release tail (Game.frameHooks; idle otherwise): the gate swings shut behind the parked car, then the ride tunnel goes. */
  private stepTail(dt: number): void {
    const tl = this.tail;
    if (!tl) return;
    tl.t += dt;
    this.stepPortal(dt);
    if (this.tail === tl && tl.t >= (this.gateReal ? RIDE.releaseWait : RIDE.breachReleaseWait)) this.dropPortal();
  }

  /** The old world goes (a section teardown): its portal, its end plane and its fog are its own again — the runtime let go at once itself. */
  private sectionGone(): void {
    this.hiddenPlane = null;
    this.fogGone();
    if (!this.engaged && !this.tail) return;
    this.engaged = null;
    this.releasing = false;
    this.tail = null;
    if (!this.riding && this.transit.mode === 'stub') this.transit.leaveTransit();
    if (!this.riding) this.clearOwnMask();
  }

  /** Set the light mask (world/rideMask.ts) as the ride's own. */
  private ownMask(box: Box3, openX: number): void {
    setRideMask(box, openX);
    this.maskMine = RIDE_MASK.version;
  }

  /** Clear the light mask if it is still the one the ride set (the runtime clears its own on release). */
  private clearOwnMask(): void {
    if (this.maskMine >= 0 && RIDE_MASK.on && RIDE_MASK.version === this.maskMine) setRideMask(null);
    this.maskMine = -1;
  }

  /** world/builder.ts tags each bed end's black plane (userData.bedEndVoid = 'trench:end'): hidden while its portal is in use. */
  private hidePlane(trench: number, end: 'x0' | 'x1'): void {
    this.restorePlane();
    const root = this.host.world?.group, key = `${trench}:${end}`;
    if (!root) return;
    let found: THREE.Object3D | null = null;
    root.traverse(o => { if (!found && o.userData.bedEndVoid === key) found = o; });
    const plane = found as THREE.Object3D | null;
    if (plane && plane.visible) { plane.visible = false; this.hiddenPlane = plane; }
  }

  private restorePlane(): void {
    if (this.hiddenPlane) this.hiddenPlane.visible = true;
    this.hiddenPlane = null;
  }

  /**
   * Spent brass lying in the car rides with it: every live casing inside the car's interior at the previous pose goes to the same
   * car-local point at the new pose (x / z by relocate, y by carry). Resting casings are not stepped, so they stay put on the car floor;
   * a station teardown clears them with the rest of its physics.
   */
  private carryBrass(prev: CarPose): void {
    const cs = (this.host.physics as BrassHost | null | undefined)?.casings, c = this.pose;
    if (!cs || typeof cs.relocate !== 'function') return;
    if (prev.x === c.x && prev.y === c.y && prev.z === c.z && prev.yaw === c.yaw && prev.pitch === c.pitch && prev.roll === c.roll) return;
    const spec = this.runtime.spec, I = spec.interior, q = this.tmp3, w = this.tmp2;
    const inside = (x: number, y: number, z: number, pose: CarPose) => {
      worldToCar(pose, x, y, z, q);
      return q.x > I.x0 && q.x < I.x1 && Math.abs(q.z) < I.halfWidth && q.y > spec.floorY - 0.25 && q.y < spec.ceilingY;
    };
    const moved = new Set<string>();
    cs.relocate((x, y, z) => {
      if (!inside(x, y, z, prev)) return null;
      carToWorld(c, q.x, q.y, q.z, w);
      this.counts.brassCarried++;
      moved.add(`${w.x.toFixed(5)},${w.z.toFixed(5)}`);
      return [w.x, w.z];
    });
    const dy = c.y - prev.y;
    if (moved.size && Math.abs(dy) > 1e-9 && typeof cs.carry === 'function') cs.carry((x, _y, z) => moved.has(`${x.toFixed(5)},${z.toFixed(5)}`), dy);
  }

  // -------------------------------------------------------------------------------------------
  // The tunnel fog (item 15; train continuity: beyond a portal plane too, blended in / out as the eye passes the plane)

  private sceneFog(): THREE.FogExp2 | null {
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    return fog && fog.isFogExp2 ? fog : null;
  }

  /**
   * How much of the tunnel murk the scene fog is drawn with, 0 (the level's own) .. 1: 1 in transit; in a station by the EYE's
   * distance beyond the portal plane (RIDE.fogBand: the air the camera is in — the ride tunnel's whatever the level's haze is).
   */
  private fogK(): number {
    if (this.phase === 'transit') return 1;
    const plan = this.plan;
    if (this.phase === 'idle' || !plan) return 0;
    const depth = this.u + plan.sgn * this.local.x - plan.uPlane, [a, b] = RIDE.fogBand;
    const s = Math.max(0, Math.min(1, (depth - a) / (b - a)));
    return s * s * (3 - 2 * s);
  }

  /**
   * The level's own fog back in the scene: at the START of every ride frame (stepPlayer: the level's hooks then read and write their
   * own values — a hook that keeps / restores the fog never captures the ride's) and on every exit. Only while the scene still holds
   * what the ride wrote: a level that wrote since (a build, a teardown) has its own in place already.
   */
  private fogBack(): void {
    const fog = this.sceneFog(), w = this.fogDrawn, own = this.fogOwn;
    const mine = this.fogSet && !!fog && fog.density === w.density && fog.color.equals(w.color);
    this.fogSet = false;
    if (!mine) return;
    fog!.density = own.density;
    fog!.color.copy(own.color);
    syncGlowFog(fog!);
  }

  /** A section teardown: the level restores its fog itself (to the indoor default); the ride's value never outlives it. */
  private fogGone(): void {
    const fog = this.sceneFog(), w = this.fogDrawn;
    if (this.fogSet && fog && fog.density === w.density && fog.color.equals(w.color)) {
      fog.density = MOOD.fogDensity;
      fog.color.copy(this.fogColor);
      syncGlowFog(fog);
    }
    this.fogSet = false;
  }

  /**
   * The frame's LAST word on the scene fog (uniform values only): the ride's blend toward the tunnel murk (MOOD) over whatever the
   * level has there now — the levels write the fog from their own frame hooks, after the ride's step, so this runs after them
   * (tiltCamera, from Game.updateCamera; Game may also call it directly after its hooks: a second call changes nothing). What is in
   * the scene when it runs is the level's own value, unless it is still exactly what the ride wrote (no ride frame in between).
   */
  lateFrame(): void {
    const fog = this.sceneFog();
    if (!fog) return;
    const w = this.fogDrawn, own = this.fogOwn, k = this.fogK();
    const mine = this.fogSet && fog.density === w.density && fog.color.equals(w.color);
    if (k <= 0) { if (mine) this.fogBack(); this.fogSet = false; this.fogOn = false; return; }
    if (!mine) { own.density = fog.density; own.color.copy(fog.color); }
    if (!this.fogOn) { this.fogOn = true; this.counts.fogHolds++; }
    const c = this.tmpColor;
    let d: number;
    if (k >= 1) { d = MOOD.fogDensity; c.copy(this.fogColor); } else { d = own.density + (MOOD.fogDensity - own.density) * k; c.copy(own.color).lerp(this.fogColor, k); }
    this.fogSet = true;
    w.density = d;
    w.color.copy(c);
    if (fog.density === d && fog.color.equals(c)) return;
    fog.density = d;
    fog.color.copy(c);
    syncGlowFog(fog);
  }

  /** Dispose (the game going away): ride mode ends, the sound stops, the transit's GPU resources go. */
  dispose(): void {
    this.reset();
    this.audio.stop(0);
    this.transit.dispose();
    this.transitBuilt = false;
  }

  // -------------------------------------------------------------------------------------------
  // QA

  /** QA readout (__LL.ride()). */
  state() {
    const r = (v: number, k = 3) => +v.toFixed(k);
    const which = this.engaged, rp = this.host.ridePortals, fog = this.sceneFog();
    const hand = (h: HandOver | null) => (h ? {u: r(h.u), clear: r(h.clear), speed: r(h.speed), pattern: [r(h.pattern[0], 6), r(h.pattern[1], 6)]} : null);
    return {
      phase: this.phase, riding: this.riding, moving: this.moving,
      plan: this.plan ? {which: this.plan.which, kind: this.plan.kind, end: this.plan.end, tunnel: this.plan.tunnel, sgn: this.plan.sgn, uMouth: r(this.plan.uMouth), uPlane: r(this.plan.uPlane), uHand: r(this.plan.uHand), uMax: r(this.plan.uMax)} : null,
      u: r(this.u), speed: r(this.speed), dir: this.dir, dist: r(this.dist, 1), clock: r(this.clock, 2),
      journey: {route: [...this.journey.route], hops: this.journey.hops, minTransit: this.journey.minTransit},
      // (train continuity) the engaged portal, its gate, the release still running after the stop; the last hand-overs; the fog / mask in force
      portal: {engaged: which, kind: which ? (this.plan?.portal.kind ?? rp?.portal(which)?.kind ?? null) : null, runtime: !!rp, gate: r(this.gateSwing()), gateWant: this.gateWant,
        releasing: this.releasing, tail: this.tail ? r(this.tail.t, 2) : null},
      hand: {out: hand(this.hand.out), back: hand(this.hand.back)},
      fog: {k: r(this.fogK()), density: fog ? r(fog.density, 5) : null, own: this.fogSet ? r(this.fogOwn.density, 5) : null},
      mask: {on: RIDE_MASK.on, mine: this.maskMine >= 0 && RIDE_MASK.version === this.maskMine, openX: Number.isFinite(RIDE_MASK.openX) ? r(RIDE_MASK.openX) : null},
      transit: {active: this.transit.active, mode: this.transit.mode, offset: r(this.transit.offset), v: r(this.transitV), t: r(this.transitT, 2), built: this.transitBuilt, meshes: this.transit.stats.meshes,
        yaw: r(this.transit.yaw, 5), signals: this.transit.signalOffsets().map(v => r(v, 1)), endCap: this.transit.endCap},
      audio: {playing: this.audio.playing, rumble: r(this.audio.level.rumble), air: r(this.audio.level.air), counts: {...this.audio.counts}},
      fogHeld: this.fogSet, planeHidden: !!this.hiddenPlane,
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

/**
 * A journey's ride parameters (lane MAP's RideJourney; none = one hop): hops = route edges (>= 1), the minimum transit = RIDE.minTransit
 * + RIDE.hopTransit per hop beyond the first, at most RIDE.hopTransitCap extra.
 */
export function journeyOf(j?: RideJourney | null): {route: string[]; hops: number; minTransit: number} {
  const route = Array.isArray(j?.route) ? j!.route.filter(s => typeof s === 'string') : [];
  const hops = Math.max(1, route.length - 1);
  return {route, hops, minTransit: RIDE.minTransit + Math.min(RIDE.hopTransitCap, RIDE.hopTransit * (hops - 1))};
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
