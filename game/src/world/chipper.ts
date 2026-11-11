// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CHIPPER; user: "the player carries real dead undead bodies one at a time onto the
// player's train and feeds them into a woodchipper fixed in the car; it grinds each body for about 20 active seconds with LOTS of blood
// spray; 1 body = 0.1 standard tank of fuel"): the MACHINE'S RUNTIME (Game.chipper). The fuel maths is the lead's (fuel/chipperFuel.ts:
// startJob / grind / GrindClock / transferToTank / chipperRefusal / jobProgress / creditTankText) on THE record
// (run/playerTrain.ts TrainChipper.state: mutated in place, re-read every frame — a load / reset replaces it).
//
// installChipper(game) is called ONCE from the Game constructor (after the train, the ride and the cargo systems); it only REGISTERS:
// - sectionHooks: build = attach the machine to the car's view root and rebuild a job's body visual; teardown = the spray goes, the
//   sound stops and (unless the riding car keeps its view) the body visual is disposed and the machine detached;
// - frameHooks (only while playing): the corpse sink's registration (Game.corpses may install later), the aim, the GRIND, the transfer,
//   the gauge / vibration / blood, the sound's position; promptProviders: the look-at status line; stateListeners: leaving 'playing'
//   (pause, menus, death) clears the spray and silences the machine; warmRegistry pool 'train-chipper' (model, gauge, the four blood
//   pools: compiled on the loading screen, never on the first feed); sectionModelKeys: the cooked model with the car.
//
// FIXTURE: every train has one (a fixed component, never cargo / loot): world/chipperPlace.ts places it in the car's +Z bay between the
// middle and front door pairs, its front to the aisle; world/playerTrain.ts trainColliders / world/trainRideLocal.ts give it its solid box
// (parked and riding). The cooked GLB (CHIPPER_MODEL) comes from the prop library; without it there is no machine visual and everything
// else works (tests never need it).
// FEEDING (a BodySink of Game.corpses; corpse/api.ts): while a body is held, the eye inside the car within CHIPPER_RT.reach of the hopper
// mouth and the crosshair on the machine -> '[E] Feed the body into the chipper', or a refusal (chipperRefusal: busy / full; riding: not
// while the train moves) — refused bodies stay in the hands. take() converts the record to a train-local 'lying' record and startJob()s
// it in the same call; the machine owns the body's object for the feed visual (world/chipperView.ts FedBody: head first, sinking with the
// progress in small lunges, legs last) and disposes it (corpses.disposeBody) in the frame the job is credited. After a load mid-grind the
// visual is rebuilt from the job's record (corpses.buildBody; null = no visual, the progress continues honestly).
// GRINDING: only while the car is PARKED (not riding: world/trainRide.ts phases) and the game plays; grind(state, clock.take(dt)). It is
// electric / auxiliary: it runs at ZERO train fuel. Riding / paused: the progress stays in the record, the spray goes, the sound stops;
// parked again, the motor restarts. TRANSFER: whole quarters go into the train's tank (transferToTank) only while parked with no journey
// pending (no ride phase, no campaign transit) on two consecutive frames — so a refused departure's refund (game.ts travelToStation: the
// debit is taken before the doors close, the refund lands in the microtask after the ride's last frame) never meets a moved quarter.
// NOISE (ai/worldNoise.ts emitWorldNoise at the MACHINE's world position): the motor start (CHIPPER_RT.noise.start m), each feed (feed m)
// and a grind pulse at every whole CHIPPER_RT.pulseMs of a job's progress (grind m) — never per frame. The Bunker generator's start is
// 40 m (world/bunker/objective.ts BUNKER_GEN.ALERT_START_M), a pistol 26, a rifle 30.
// SOUND (audio/chipperAudio.ts, lane AUDIO): start() + feed() + grind(true) on a feed, grind(false) + stop() when it goes idle, start() +
// grind(true) when a paused job resumes, frame(x, y, z) every frame, silence() on pause / ride / teardown / a replaced record.
// No damage, gas or hazard of any kind comes from the machine.

import * as THREE from 'three';
import type {Game} from '../game';
import {CHIPPER, chipperRefusal, creditTankText, GrindClock, grind, jobProgress, startJob, transferToTank, type ChipperCredit, type ChipperJSON} from '../fuel/chipperFuel';
import {tanksText} from '../fuel/fuel';
import {bodyProblem, copyBody, type BodyRecordJSON} from '../corpse/bodyRecord';
import type {BodyOffer, BodySink, CorpseSystemApi, HeldBody} from '../corpse/api';
import {corpseFeedable} from '../ai/corpseTrait';
import {emitWorldNoise, type WorldNoise, type WorldNoiseHost, type WorldNoiseKind} from '../ai/worldNoise';
import {ChipperAudio} from '../audio/chipperAudio';
import type {Sfx} from '../audio/sfx';
import {CHIPPER_ANCHORS, CHIPPER_MODEL} from './chipperSpec';
import {chipperDirToLocal, chipperFootprint, chipperPlacement, chipperToLocal, type ChipperPlacement} from './chipperPlace';
import {ChipperFx, type ChipperFxFrame} from './chipperFx';
import {ChipperView, FedBody, lungeRate} from './chipperView';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {playerTrainPlacement} from '../gen/playerTrain';
import type {StationLayout} from '../gen/stationTypes';
import type {WarmupRegistry} from '../render/warmup';

/** Tuning (one place). */
export const CHIPPER_RT = {
  /** Feeding: the eye within this of the hopper mouth (m, to its nearest point at the rim). */
  reach: 1.4,
  /** The look-at status line / the machine's aim (m, eye -> the machine's box along the crosshair). */
  look: 2.2,
  /** The aim box rises this far above the machine's top (m: a body sticking out of the hopper). */
  aimAbove: 0.12,
  /** World noise radii (m) and the grind pulse period (ms of a job's progress). */
  noise: {start: 32, feed: 20, grind: 28},
  pulseMs: 4000,
  /** A missing body visual (its model not loaded yet) is retried this often (s). */
  rebuildS: 1,
  /** The noise / sound point: the machine's centre this high above the floor (m). */
  soundY: 0.5,
} as const;

/** Prompt / toast texts. */
export const CHIPPER_TEXT = {
  feed: '<b>[E]</b> Feed the body into the chipper',
  riding: 'Not while the train is moving',
  notUndead: 'The chipper only takes dead undead bodies',
  ground: (credit: string) => `Body ground — +0.1 tank of fuel${credit !== '0.0' ? ` · ${credit} tank waiting` : ''}`,
  transfer: (tank: string) => `Chipper fuel into the tank — ${tank}`,
} as const;

/**
 * The prop library file map of the cooked chipper model (game.ts propModels catalogue). EMPTY until lane ASSET delivers the GLB: then
 * `{[CHIPPER_MODEL.key]: {url: CHIPPER_MODEL.url, bytes}}` (its cooked size) — the section key below is ignored while it is absent.
 */
export const CHIPPER_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {};

/** The chipper's sound (audio/chipperAudio.ts ChipperAudio; structural for tests). */
export interface ChipperAudioLike {
  start(x: number, y: number, z: number): void;
  feed(x: number, y: number, z: number): void;
  grind(on: boolean): void;
  stop(x: number, y: number, z: number): void;
  frame(x: number, y: number, z: number): void;
  silence(): void;
}

interface V3 { x: number; y: number; z: number }

/** What the chipper needs from Game (structural: tests drive it with a fake host). */
export interface ChipperHost extends WorldNoiseHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; alive: boolean; yaw?: number; pitch?: number};
  state: string;
  hud: {toast(text: string, warn?: boolean): void};
  playerTrain: {chipper: {state: ChipperJSON}; fuel: {tank: number}};
  trainRuntime?: {
    view: {root: THREE.Object3D} | null;
    train?: {placement: {level: number}} | null;
    spec?: PlayerTrainSpec;
    carLocal(x: number, y: number, z: number): V3 | null;
    carDir(x: number, y: number, z: number): V3 | null;
    carPoint(x: number, y: number, z: number): V3 | null;
  };
  trainRide?: {riding: boolean};
  run?: {campaign?: {transit?: unknown} | null};
  corpses?: CorpseSystemApi | null;
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  sfx?: unknown;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
  stateListeners?: ((s: never, prev: never) => void)[];
  sectionModelKeys?: ((layout: StationLayout) => readonly string[])[];
  warmRegistry: WarmupRegistry;
}

export interface ChipperOptions {
  /** The cooked model's scene (default: the prop library's CHIPPER_MODEL; null = none yet). */
  model?: () => THREE.Object3D | null;
  /** The sound (default: audio/chipperAudio.ts on the host's sfx). */
  audio?: ChipperAudioLike;
  /** The blood's generator seed. */
  seed?: number;
}

/** Nearest point of an axis-aligned rect (x / z, at height y) to p: the distance. */
function rectDist(p: V3, cx: number, y: number, cz: number, hx: number, hz: number): number {
  const dx = Math.max(0, Math.abs(p.x - cx) - hx), dz = Math.max(0, Math.abs(p.z - cz) - hz);
  return Math.hypot(dx, p.y - y, dz);
}

/** One slab of a ray-box test: the narrowed [t0, t1] (t1 < t0: a miss). */
function slab(o: number, d: number, lo: number, hi: number, t: [number, number]): void {
  if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) t[1] = -1; return; }
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > t[0]) t[0] = a;
  if (b < t[1]) t[1] = b;
}

const T2: [number, number] = [0, 0];
/** Ray (o, unit d) vs an axis-aligned box: entry distance within [0, maxT], or null. */
function rayBox(o: V3, d: V3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxT: number): number | null {
  T2[0] = 0; T2[1] = maxT;
  slab(o.x, d.x, x0, x1, T2);
  if (T2[0] <= T2[1]) slab(o.y, d.y, y0, y1, T2);
  if (T2[0] <= T2[1]) slab(o.z, d.z, z0, z1, T2);
  return T2[0] <= T2[1] ? T2[0] : null;
}

export class ChipperSystem {
  readonly spec: PlayerTrainSpec;
  /** The machine's placement in the car (null: the spec has no bay for it — then nothing is built). */
  readonly place: ChipperPlacement | null;
  /** Train-local root on the car's view root: the machine (view.root), the fed body, the blood. */
  readonly group = new THREE.Group();
  readonly view: ChipperView | null;
  readonly fx: ChipperFx;
  readonly audio: ChipperAudioLike;
  /** The body in the hopper (its visual), null: none. */
  body: FedBody | null = null;
  /** The motor runs (sound started for the current job). */
  motor = false;
  /** The crosshair is on the machine within CHIPPER_RT.look (this frame), and the eye's distance to the hopper mouth. */
  aimed = false;
  hopperDist = Infinity;
  /** Counters (QA / tests). */
  readonly counts = {fed: 0, refused: 0, credited: 0, disposed: 0, built: 0, transferred: 0, noises: 0, starts: 0, stops: 0, attached: 0};
  /** The last world noise emitted (QA). */
  lastNoise: WorldNoise | null = null;
  /** The last credit (QA / tests). */
  lastCredit: ChipperCredit | null = null;
  private readonly clock = new GrindClock();
  private rec: ChipperJSON | null = null;
  private sinkOwner: CorpseSystemApi | null = null;
  private settledPrev = false;
  private time = 0;
  private grindT = 0;
  private rebuildAt = 0;
  private readonly frame: ChipperFxFrame | null;
  private readonly hopper: V3;
  private readonly aisle: {x: number; z: number};
  private readonly fp: {x0: number; x1: number; z0: number; z1: number} | null;
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private shadowsMarked = false;
  readonly sink: BodySink;

  constructor(readonly host: ChipperHost, readonly opts: ChipperOptions = {}) {
    this.spec = host.trainRuntime?.spec ?? PLAYER_TRAIN_SPEC;
    this.place = chipperPlacement(this.spec);
    this.group.name = 'train-chipper-group';
    this.fx = new ChipperFx(opts.seed);
    this.group.add(this.fx.root);
    this.audio = opts.audio ?? new ChipperAudio(host.sfx as Sfx);
    const c = this.place;
    if (c) {
      this.view = new ChipperView(c);
      this.group.add(this.view.root);
      const A = CHIPPER_ANCHORS, fp = chipperFootprint(c), front = chipperDirToLocal(c, 0, 0, 1);
      this.fp = fp;
      this.hopper = chipperToLocal(c, A.hopper.x, A.hopper.y, A.hopper.z);
      this.aisle = {x: front.x, z: front.z};
      // the outlet on the front face (never inside the box), the mouth's half extents in the car frame (yaw PI: the same axes)
      const out = chipperToLocal(c, A.outlet.x, A.outlet.y, Math.max(A.outlet.z, c.depth / 2));
      this.frame = {hopper: this.hopper, mouthHx: A.hopperMouth.x / 2, mouthHz: A.hopperMouth.z / 2, outlet: out, front, floorY: c.floorY,
        box: fp, rimY: this.hopper.y, halfWidth: this.spec.interior.halfWidth};
    } else {
      this.view = null;
      this.fp = null;
      this.frame = null;
      this.hopper = {x: 0, y: 0, z: 0};
      this.aisle = {x: 0, z: -1};
    }
    this.sink = {offer: held => this.offer(held), take: held => this.take(held)};
  }

  // --- registration --------------------------------------------------------------------------------------------------

  install(): this {
    const h = this.host;
    h.frameHooks.push(dt => this.update(dt));
    h.promptProviders?.push(() => this.prompt());
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.pause(); }) as (s: never, p: never) => void);
    h.sectionHooks.push({build: () => this.build(), teardown: () => this.teardown()});
    h.sectionModelKeys?.push(layout => (this.place && CHIPPER_MODEL_FILES[CHIPPER_MODEL.key] && playerTrainPlacement(layout) ? [CHIPPER_MODEL.key] : []));
    h.warmRegistry.addPool('train-chipper', () => this.warmRoots());
    this.ensureSink();
    return this;
  }

  /** The corpse system (installed in parallel / later): the sink is registered once it exists. */
  private ensureSink(): void {
    const c = this.host.corpses ?? null;
    if (!c || c === this.sinkOwner || !this.place) return;
    c.addSink(this.sink);
    this.sinkOwner = c;
  }

  /** THE record (re-read every frame: a load / reset replaces it). */
  get state(): ChipperJSON {
    return this.host.playerTrain.chipper.state;
  }

  // --- the fixture ---------------------------------------------------------------------------------------------------

  /** Parent the machine to the current train view (none: detached). Cheap when already there. */
  attach(): boolean {
    const view = this.place ? this.host.trainRuntime?.view ?? null : null;
    if (!view) { if (this.group.parent) this.group.removeFromParent(); return false; }
    if (this.group.parent !== view.root) {
      view.root.add(this.group);
      this.counts.attached++;
      this.levelMeshes();
    }
    this.ensureModel();
    return true;
  }

  /** The cooked model (once the library has it). */
  private ensureModel(): void {
    if (!this.view) return;
    const src = this.opts.model ? this.opts.model() : ((this.host as {propModels?: {get(k: string): {scene: THREE.Object3D} | undefined}}).propModels?.get(CHIPPER_MODEL.key)?.scene ?? null);
    const had = this.view.model;
    if (this.view.setModel(src) && this.view.model !== had) {
      this.levelMeshes();
      if (!this.shadowsMarked && this.view.model) { this.host.atmosphere?.markShadows(this.view.model, false); this.shadowsMarked = true; }
    }
  }

  /** Every mesh under the machine carries the car's level (the culler's tag). */
  private levelMeshes(): void {
    const level = this.host.trainRuntime?.train?.placement.level ?? 0;
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
  }

  private warmRoots(): THREE.Object3D[] {
    return this.attach() ? [this.group] : [];
  }

  /** The car stands parked (built, not riding). */
  parked(): boolean {
    return !!this.host.trainRuntime?.train && !this.host.trainRide?.riding;
  }

  /** A journey is pending (a ride phase, or the campaign's transit until the arrival commits). */
  journeyPending(): boolean {
    return !!this.host.trainRide?.riding || !!this.host.run?.campaign?.transit;
  }

  /** The machine's world point (noise / sound), null without a car. */
  machineWorld(): V3 | null {
    const c = this.place;
    if (!c) return null;
    return this.host.trainRuntime?.carPoint(c.x, c.floorY + CHIPPER_RT.soundY, c.z) ?? null;
  }

  // --- lifecycle -----------------------------------------------------------------------------------------------------

  build(): void {
    this.ensureSink();
    this.attach();
    this.syncBody();
  }

  teardown(): void {
    this.silenceMotor(true);
    this.clock.reset();
    this.aimed = false;
    this.settledPrev = false;
    if (this.host.trainRide?.riding && this.group.parent) { this.fx.clearAirborne(); return; } // the riding car keeps its view (and us)
    this.dropBody();
    this.fx.clear();
    this.group.removeFromParent();
  }

  /** Leaving 'playing' (pause, menus, death): the spray goes, the machine falls silent (the job's progress stays in the record). */
  pause(): void {
    this.silenceMotor(true);
    this.fx.clearAirborne();
    this.clock.reset();
    this.aimed = false;
    this.settledPrev = false;
  }

  /** The motor's sound ends at once (`always`: also a wind-down cue still playing — pause / teardown / a replaced record). */
  private silenceMotor(always = false): void {
    if (this.motor || always) this.audio.silence();
    this.motor = false;
  }

  // --- feeding (the corpse system's sink) ----------------------------------------------------------------------------

  /** The crosshair on the machine (car frame, eye inside the car): its distance (null: not on it) and the eye's distance to the mouth. */
  aim(): {t: number | null; hopper: number} {
    const none = {t: null, hopper: Infinity};
    const h = this.host, tr = h.trainRuntime, c = this.place, fp = this.fp;
    if (!c || !fp || !tr?.view || !this.group.parent || !h.player.alive || h.state !== 'playing') return none;
    const pl = tr.carLocal(h.player.x, h.player.y, h.player.z);
    if (!pl || Math.abs(pl.x - c.x) > CHIPPER_RT.look + 1.5 || Math.abs(pl.z - c.z) > CHIPPER_RT.look + 1.5) return none; // cheap reject
    const cam = h.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.vEye);
    cam.getWorldDirection(this.vDir);
    const eye = tr.carLocal(this.vEye.x, this.vEye.y, this.vEye.z), dir = tr.carDir(this.vDir.x, this.vDir.y, this.vDir.z);
    if (!eye || !dir) return none;
    const S = this.spec, I = S.interior;
    // the eye inside the car (never through the wall from the bed or the platform)
    if (!(eye.x > I.x0 && eye.x < I.x1 && Math.abs(eye.z) < I.halfWidth && eye.y > S.floorY && eye.y < S.ceilingY)) return none;
    const t = rayBox(eye, dir, fp.x0, c.floorY, fp.z0, fp.x1, c.floorY + c.height + CHIPPER_RT.aimAbove, fp.z1, CHIPPER_RT.look);
    const A = CHIPPER_ANCHORS.hopperMouth;
    return {t, hopper: rectDist(eye, this.hopper.x, this.hopper.y, this.hopper.z, A.x / 2, A.z / 2)};
  }

  /** The train-local resting record of a fed body (the job's copy): 'lying' at the hopper, no storey. */
  jobRecord(r: BodyRecordJSON): BodyRecordJSON {
    const b = copyBody(r);
    delete b.level;
    b.pose = 'lying';
    b.x = +this.hopper.x.toFixed(4); b.y = this.place?.floorY ?? this.spec.floorY; b.z = +this.hopper.z.toFixed(4);
    b.q = [0, 0, 0, 1];
    return b;
  }

  /** BodySink.offer: in reach + looking at the machine -> feed, or why not (null: not ours). */
  offer(held: HeldBody): BodyOffer | null {
    const a = this.aim();
    if (a.t === null || a.hopper > CHIPPER_RT.reach) return null;
    if (this.host.trainRide?.riding || !this.host.trainRuntime?.train) return {ok: false, text: CHIPPER_TEXT.riding};
    const r = chipperRefusal(this.state);
    if (r) return {ok: false, text: r};
    if (bodyProblem(this.jobRecord(held.record), {world: false, feedable: corpseFeedable})) return {ok: false, text: CHIPPER_TEXT.notUndead};
    return {ok: true, text: CHIPPER_TEXT.feed};
  }

  /** BodySink.take: the body is the machine's now — its record becomes the job (same call), its object the feed visual. */
  take(held: HeldBody): boolean {
    const o = this.offer(held);
    if (!o?.ok) { this.counts.refused++; return false; }
    const st = this.state;
    const job = startJob(st, this.jobRecord(held.record));
    this.rec = st;
    this.counts.fed++;
    this.adoptBody(held.object, job.uid);
    this.grindT = 0;
    this.clock.reset();
    // the motor spins up, the body drops in, the grinding starts
    this.startMotor();
    const w = this.machineWorld();
    if (w) this.audio.feed(w.x, w.y, w.z);
    this.noise('machine-feed', CHIPPER_RT.noise.feed);
    return true;
  }

  // --- the body visual -----------------------------------------------------------------------------------------------

  /** Own a body object as the hopper's visual (re-parented into the car frame, posed at the job's progress). */
  private adoptBody(obj: THREE.Object3D, uid: number): void {
    this.dropBody();
    obj.removeFromParent();
    this.group.add(obj);
    obj.updateMatrixWorld(true);
    this.body = new FedBody(obj, uid);
    this.levelMeshes();
    this.poseBody(false);
  }

  /** Dispose the body visual (the corpse system frees its model). */
  private dropBody(): void {
    const b = this.body;
    if (!b) return;
    this.body = null;
    b.obj.removeFromParent();
    this.host.corpses?.disposeBody(b.obj);
    this.counts.disposed++;
  }

  /** The visual follows the record: gone with its job, rebuilt for a job that has none (a load mid-grind). */
  private syncBody(): void {
    const job = this.state.job;
    if (this.body && (!job || job.uid !== this.body.uid)) this.dropBody();
    if (!job || this.body || !this.group.parent || this.time < this.rebuildAt) return;
    const obj = this.host.corpses?.buildBody(job.body) ?? null;
    if (!obj) { this.rebuildAt = this.time + CHIPPER_RT.rebuildS; return; }
    this.counts.built++;
    this.adoptBody(obj, job.uid);
  }

  private poseBody(grinding: boolean): void {
    if (!this.body) return;
    this.body.place(this.hopper, this.aisle, jobProgress(this.state), grinding ? this.grindT : null);
  }

  // --- sound + noise -------------------------------------------------------------------------------------------------

  private startMotor(): void {
    if (this.motor) return;
    this.motor = true;
    this.counts.starts++;
    const w = this.machineWorld();
    if (w) this.audio.start(w.x, w.y, w.z);
    this.audio.grind(true);
    this.noise('machine-start', CHIPPER_RT.noise.start);
  }

  /** The job is done: the grinding stops, the motor winds down. */
  private stopMotor(): void {
    if (!this.motor) return;
    this.motor = false;
    this.counts.stops++;
    this.audio.grind(false);
    const w = this.machineWorld();
    if (w) this.audio.stop(w.x, w.y, w.z);
  }

  /** One world noise at the machine (the enemies hear it through the established rule; then the listeners). */
  private noise(kind: WorldNoiseKind, radius: number): void {
    const w = this.machineWorld();
    if (!w) return;
    const n: WorldNoise = {x: w.x, y: w.y, z: w.z, radius, kind, source: 'train-chipper'};
    this.lastNoise = n;
    this.counts.noises++;
    emitWorldNoise(this.host, n);
  }

  // --- per frame -----------------------------------------------------------------------------------------------------

  update(dt: number): void {
    const h = this.host;
    this.time += dt;
    this.ensureSink();
    const st = this.state;
    if (st !== this.rec) { // a load / reset replaced the record: nothing of the old job's visual / sound survives
      if (this.rec) { this.silenceMotor(true); this.clock.reset(); this.fx.clearAirborne(); this.dropBody(); this.settledPrev = false; }
      this.rec = st;
    }
    const attached = this.attach();
    this.syncBody();
    const a = this.aim();
    this.aimed = a.t !== null;
    this.hopperDist = a.hopper;
    const parked = this.parked();
    let grinding = false;
    if (parked && st.job && h.state === 'playing') {
      grinding = true;
      this.startMotor(); // (a resumed job after a ride / a pause)
      const before = st.job.ms;
      const credit = grind(st, this.clock.take(dt));
      this.grindT += dt;
      if (credit) this.credited(credit);
      else if (Math.floor(st.job!.ms / CHIPPER_RT.pulseMs) > Math.floor(before / CHIPPER_RT.pulseMs)) this.noise('machine-grind', CHIPPER_RT.noise.grind);
    } else if (this.motor) {
      // riding (or no car): the progress waits in the record, the machine falls silent, the spray goes
      this.silenceMotor();
      this.clock.reset();
      this.fx.clearAirborne();
    }
    // whole quarters into the tank: parked, no journey pending — this frame AND the last
    const settled = parked && !this.journeyPending();
    if (settled && this.settledPrev) {
      const n = transferToTank(st, h.playerTrain.fuel);
      if (n > 0) { this.counts.transferred += n; h.hud.toast(CHIPPER_TEXT.transfer(tanksText(h.playerTrain.fuel.tank))); }
    }
    this.settledPrev = settled;
    // visuals: the body, the gauge, the vibration, the blood, the sound's position
    grinding = grinding && !!st.job;
    this.poseBody(grinding);
    if (this.view) {
      this.view.setGauge(jobProgress(st), grinding, st.ticks > 0, this.time);
      this.view.vibrate(this.grindT, grinding);
    }
    if (this.frame) {
      if (grinding) this.fx.emit(dt, this.frame, 0.5 + lungeRate(jobProgress(st)));
      this.fx.update(dt, this.frame);
    }
    if (attached) { const w = this.machineWorld(); if (w) this.audio.frame(w.x, w.y, w.z); }
  }

  /** The completion instant (grind's credit return): the body's visual goes in the same frame, the motor winds down. */
  private credited(c: ChipperCredit): void {
    this.lastCredit = c;
    this.counts.credited++;
    this.dropBody();
    this.stopMotor();
    this.clock.reset();
    this.host.hud.toast(CHIPPER_TEXT.ground(creditTankText(this.state.ticks)));
  }

  // --- prompt --------------------------------------------------------------------------------------------------------

  /** The look-at status line (only while aimed with empty hands: a held body gets the corpse system's offer prompt). */
  prompt(): string | null {
    if (!this.aimed || this.host.corpses?.held()) return null;
    const st = this.state, wait = st.ticks > 0 ? ` · ${creditTankText(st.ticks)} tank waiting` : '';
    if (st.job) {
      const pct = Math.min(99, Math.floor(jobProgress(st) * 100));
      return this.parked() ? `Chipper — grinding ${pct} %${wait}` : `Chipper — paused while the train moves · ${pct} %${wait}`;
    }
    if (st.ticks + CHIPPER.bodyTicks > CHIPPER.bufferMaxTicks) return `Chipper — full${wait}: make room in the train's tank`;
    return `Chipper — idle${wait} · carry a dead body here for fuel`;
  }

  // --- QA ------------------------------------------------------------------------------------------------------------

  /** QA / tests: a compact state report. */
  qa(): {
    placed: boolean; attached: boolean; model: boolean; state: 'idle' | 'grinding' | 'paused'; progress: number; ticks: number; credit: string;
    done: number; job: number | null; body: {visual: boolean; bones: boolean} | null; motor: boolean; aimed: boolean; hopperDist: number;
    at: {x: number; z: number} | null; counts: ChipperSystem['counts']; fx: ReturnType<ChipperFx['stats']>; caps: ChipperFx['caps'];
    gauge: ReturnType<ChipperView['gaugeState']> | null; lastNoise: WorldNoise | null;
  } {
    const st = this.state;
    return {
      placed: !!this.place, attached: !!this.group.parent, model: !!this.view?.model,
      state: st.job ? (this.parked() ? 'grinding' : 'paused') : 'idle', progress: +jobProgress(st).toFixed(3), ticks: st.ticks, credit: creditTankText(st.ticks),
      done: st.done, job: st.job?.uid ?? null, body: st.job ? {visual: !!this.body, bones: !!this.body?.frame.bones} : null, motor: this.motor,
      aimed: this.aimed, hopperDist: Number.isFinite(this.hopperDist) ? +this.hopperDist.toFixed(2) : -1,
      at: this.place ? {x: this.place.x, z: this.place.z} : null, counts: {...this.counts}, fx: this.fx.stats(), caps: this.fx.caps,
      gauge: this.view?.gaugeState() ?? null, lastNoise: this.lastNoise,
    };
  }
}

/** Create the chipper and register it into the Game (call once from the Game constructor, after the train / ride / cargo systems). */
export function installChipper(game: Game, opts: ChipperOptions = {}): ChipperSystem {
  return new ChipperSystem(game as unknown as ChipperHost, opts).install();
}

/** QA hooks (spread into window.__LL) for the lead's short serial browser spot check. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function chipperQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {chipper?: ChipperSystem; player: {x: number; y: number; z: number; yaw: number; pitch: number; vy: number; grounded: boolean}};
  return {
    /** The chipper: placement, state / progress / credit, body visual, motor, aim, counters, blood pool counts, gauge, last noise. */
    chipper: () => g.chipper?.qa() ?? null,
    /** Stand in the aisle in front of the hopper, looking into it (the feed / status prompt shows on the next frame). */
    chipperGo: () => {
      const c = g.chipper, p = c?.place, tr = c?.host.trainRuntime;
      if (!c || !p || !tr) return false;
      const A = CHIPPER_ANCHORS.hopper, hop = chipperToLocal(p, A.x, A.y, A.z), front = chipperDirToLocal(p, 0, 0, 1);
      const at = tr.carPoint(hop.x + front.x * 0.95, p.floorY, hop.z + front.z * 0.95), aim = tr.carPoint(hop.x, hop.y, hop.z);
      if (!at || !aim) return false;
      const P = g.player;
      P.x = at.x; P.z = at.z; P.y = at.y; P.vy = 0; P.grounded = true;
      P.yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
      P.pitch = Math.atan2(aim.y - (at.y + 1.62), Math.hypot(aim.x - at.x, aim.z - at.z));
      return true;
    },
  };
}
