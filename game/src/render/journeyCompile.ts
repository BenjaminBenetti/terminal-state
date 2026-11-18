// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU, journey follow-up; user: "the lag is also bad in reactor … the new
// loading transitions in the train … might be skipping the warmup / compile step"): the campaign JOURNEY (Game.travelToStation) never
// shows a loading screen, so the next station is prepared while the player rides — for the WHOLE ride now (and after it, until done),
// time-sliced through the game's frame-budget scheduler (core/frameBudget.ts: steps run after the frame's render, inside its spare
// budget). It never holds a frame and never touches the canvas. Two kinds of work run side by side, each nearest the arrival first:
//  - SCENE PASS (asynchronous): the warm-up planner's representatives, then ('full') every other renderable: one compileAsync chunk in
//    flight at a time, into the scene pass's target at its render-context depth (render/renderContextDepth.ts). The chunk is ISOLATED
//    on a spare layer (PREP_LAYER: only its objects and the lights the camera sees, for the synchronous part of the call, restored at
//    once — O(chunk) writes) and projected with a twin of the camera that renders that layer only. The step is that synchronous
//    projection; three then runs the node builds in its own yielded slices between frames (NodeBuilder.buildAsync yields between build
//    stages; pipelines are created asynchronously).
//  - FLASHLIGHT SHADOW VARIANTS (synchronous): compileAsync cannot prepare them (three records the shared shadow override material by
//    reference and builds after the per-caster nodes were restored), and a shadow map is drawn only when a RECEIVER draws inside a real
//    render. So a step draws a few casters OFF-SCREEN: renderer.render(scene, the twin camera) into the scene pass's own target, nested
//    at the real frame's depth (renderAtDepthOffset), with ONE receiver on the twin's layer (the scene pass draws only it: it triggers
//    the shadow node) and the casters on CASTER_LAYER, which only the light's shadow camera renders for that call — so the shadow pass
//    draws exactly those casters in the real frame's shadow render context, and their scene-pass variants are not needed for it. Nothing
//    reaches the canvas: the step runs after the frame's render, and the next frame re-renders that target and — for the game camera,
//    a new frame id — the shadow map before anything composites. Synchronous work (node builds, any new shadow pipeline): the
//    scheduler measures it; the casters per draw adapt to the measured step (shared builds are cheap, a fresh InstancedMesh variant is
//    a full build).
// Every step is its own scheduler request (re-queued after the frame that ran it): it runs only in spare frame time, and one that
// waited JOURNEY_COMPILE.maxStaleMs of active time gets one step even over budget (the scheduler's bounded overdue rule) — a high
// estimate never stalls the job, and at worst one step per that interval lands in a busy frame.
// Cancelled with the station (the scheduler's world generation) or when the scheduler drops it; `done` resolves either way.
//
// Task studio-journey-compile-pacing-20261104 (lead; the user's native GAME61 Mall trace): the scene lane used to hand three ONE
// compileAsync over a chunk of 16 items. three r186's compileAsync awaits yieldToMain() after every object and NodeBuilder.buildAsync
// after every shader stage of every build stage (~6 per new build) — and in Chrome yieldToMain() is scheduler.yield(), whose
// continuations are PRIORITISED over the browser's other work: the whole chunk's chain ran before the next frame was rendered, until
// Chrome's ~100 ms render-starvation guard (the trace: 100-117 ms frames with game CPU ~8-11 ms, GPU <= 7 ms, LoAF renderStart +100 ms,
// 'Scheduler.yield.then' scripts; 21 / 31 hitches in a 30 s capture just after leaving the train). The studio's Firefox 158 has
// scheduler.yield / postTask too, but keeps rendering between yield continuations (a probe page: frames every ~17 ms, at most a 34 ms
// gap, under a continuous 3 ms-per-link yield chain), so software QA never showed it. Now the scene lane is PACED to real frames:
//  - ONE item per compileAsync call (JOURNEY_COMPILE.chunk 1) and one call in flight: the most a frame can be held is one item's chain;
//  - a SLICE starts in the scheduler's step (after the frame's render); when an item settles in the SAME game frame (opts.frameNo:
//    FrameBudget.frame) and the slice is under JOURNEY_COMPILE.sliceMs of real time, the next item starts at once (cheap cache-hit items
//    batch, at most maxPerSlice), else the job waits for the next frame's step — no burst after a hidden tab / pause (steps only run
//    in playing frames; at most one item is ever in flight);
//  - where the browser has scheduler.postTask, the call is LAUNCHED from a 'background' priority task, so the scheduler.yield()
//    calls three makes inside it inherit background priority (the platform's documented yield-inheritance) instead of jumping
//    ahead of rendering. The frame bound above does not depend on that inheritance;
//  - limits: one NEW build's chain (~6 yielded slices) can still cost one frame where the inheritance does not apply; GPU / driver
//    pipeline compile is not observable or preemptible here (CPU-side units only).
//
// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): TWO-PASS items (render/warmup.ts drawsTwoPass: transparent
// DoubleSide glass). three draws them with `side` set to BackSide, then FrontSide, but compileAsync builds after the side was restored:
// the scene lane leaves their render objects with the DoubleSide pipeline only, and the first real view created the two real pipelines
// (a first-use census after a complete preparation: 2 per glass batch on first sight). A third lane, 'sides', draws each such item
// OFF-SCREEN once its scene-lane compile settled (its node build is a cache hit by then): the same nested render as a shadow draw, the
// item alone on the twin's layer, ONE item per step (two pipeline requests at most), nearest the arrival first like the scene lane.
//
// Task studio-surface-host-ground-connectors-20261118-053602-01 (lane READY; user: "Diagnose and address the first-visible exit/ready
// handoff … A successful exit needs a built, playable first view that can actually be drawn"): a crossing's exit (the Surface Run cargo
// lift's doors, the on-foot connector's far door) opened after the whole compile, and the door-open frame was the FIRST real draw of the
// destination's scene-pass programs. compileAsync only links a program on a software rasterizer (llvmpipe JITs a variant at its first
// draw: one ~160 s frame in Firefox there) and leaves each covered object's render objects to the first frame that draws it. A fourth
// lane, 'view' (opts.firstView, render/firstView.ts plans it), DRAWS the exit's first view OFF-SCREEN before the exit opens:
//  - its representatives (one per program group of what can be seen from the exit, any yaw) once their scene-lane compile settled (a
//    cache hit by then: a real draw creates nothing synchronously that compileAsync prepares asynchronously), then the rest of the
//    first-view renderables (their programs are the representatives': their own render objects); each draw the same nested render of
//    the scene pass as a shadow draw, its items alone on the twin's layer; items per draw ADAPTIVE (from 1: doubled while a draw stays
//    under its target, halved above 3 x it or when the frames between two draws ran long — work a draw left to the GPU / driver), so
//    the drawn frames keep coming while the JIT / pipeline work is spread over many of them;
//  - the first view's flashlight-shadow casters lead the shadow lane (opts.firstView.casters: counted as first-view work);
//  - then ONE hidden frame of the real view: the scene pass drawn from the camera as the next frame would see it (its layers as the
//    level culler left them, the shadow pass's real casters) into the scene pass's target — the frame that would otherwise have been
//    the door-open frame;
//  - stats.firstView says where it is ('pending' compile -> 'drawing' -> 'frame' -> 'ready'); `viewReady` resolves then (or when the
//    job ended). Until then the frames are the first view's: the scene lane compiles only its lead (the items up to the last
//    representative), the shadow lane draws only its casters, the two-pass lane waits (measured on the Subway lift ride in Node: the
//    whole job's other lanes, side by side, had drawn every caster of the destination and a third of its scene items by then — frames
//    the first view waited for). Then the rest of the job; pace() hands it the journey's play pacing once the exit is open. Without a scene pass
//    target (the direct path: an off-screen draw would land on the canvas) the first view is COMPILED only (stats.viewDrawn false).

import * as THREE from 'three';
import type {FrameScheduler} from '../core/frameBudget';
import {compileAtDepth, renderAtDepthOffset} from './renderContextDepth';
import {drawsTwoPass, type WarmItem, type WarmupRenderer} from './warmup';

/** Layers nothing else uses (CULL_LAYER is 31): a chunk is drawn / compiled alone on them for one synchronous call. */
export const PREP_LAYER = 30;
export const CASTER_LAYER = 29;
const PREP_MASK = (1 << PREP_LAYER) >>> 0;
const CASTER_MASK = (1 << CASTER_LAYER) >>> 0;

export interface JourneyCompileOptions {
  renderer: WarmupRenderer & {render(scene: THREE.Object3D, camera: THREE.Camera): unknown};
  scheduler: FrameScheduler;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The scene pass's render target (null: the direct path — no shadow draws then) and its render-context call depth. */
  target: unknown;
  depth: number;
  /** Scene-pass items in order (nearest the arrival first) and the casters whose shadow variants are drawn (in order). */
  items: readonly WarmItem[];
  casters: readonly WarmItem[];
  /** A shadow receiver drawn with every shadow draw (three draws a shadow map only when a receiver draws); null: no shadow work. */
  receiver: WarmItem | null;
  /** Items per compileAsync chunk / the most casters per off-screen shadow draw. */
  chunk?: number;
  shadowChunk?: number;
  /**
   * (Surface Run v2 lift ride, lane ACCESS follow-up) pacing overrides for a job the caller WAITS for while only a sealed car is drawn:
   * the active ms a queued step waits before the scheduler runs it over budget (default JOURNEY_COMPILE.maxStaleMs; 0 = a step every
   * frame within the scheduler's own overdue bounds), a slice's real-time budget for same-frame batching (default sliceMs) and the
   * shadow draw's adaptive target (default shadowTargetMs).
   */
  maxStaleMs?: number;
  sliceMs?: number;
  shadowTargetMs?: number;
  /** (the lift ride) frames a launch waits for its background task before a step runs it directly (default JOURNEY_COMPILE.postStallFrames). */
  postStallFrames?: number;
  /**
   * The game's frame number (Game: FrameBudget.frame, stable from a frame's run() until the next frame callback): cheap items batch
   * only inside the frame whose step started the slice. Default: a counter
   * the job's own scheduler steps advance (each step = a new frame).
   */
  frameNo?: () => number;
  /** Clock (ms); default performance.now. */
  now?: () => number;
  /**
   * Launch a compile call from a low-priority task (default: the browser's scheduler.postTask with priority 'background' where it
   * exists, else null = launch directly). Tests inject it.
   */
  post?: ((fn: () => void) => void) | null;
  /** (lane READY) The exit's first view, drawn off-screen before the job reports it ready (render/firstView.ts planFirstView). */
  firstView?: JourneyFirstView | null;
}

/** (lane READY) The first-view work of a job (see the file comment). */
export interface JourneyFirstView {
  /** The first-view renderables in draw order: the representatives first, then the rest (nearest the exit first in each). */
  items: readonly WarmItem[];
  /** How many of `items` lead as representatives: each is drawn only once its scene-lane compile settled (when it is a scene item). */
  reps: number;
  /** How many of the job's leading `casters` are the first view's (their shadow variants count as first-view work). */
  casters: number;
  /** End with one hidden frame of the real view (default true; only with a scene pass target). */
  frame?: boolean;
  /** The adaptive draw's target (synchronous ms of a draw), the most items per draw, and the gap between two draws (ms) that counts as a long frame. */
  targetMs?: number;
  maxPerDraw?: number;
  longGapMs?: number;
}

/** (lane READY) Where a job's first view is: no first view; its representatives compiling; drawn off-screen; the hidden real-view frame; ready. */
export type FirstViewState = 'none' | 'pending' | 'drawing' | 'frame' | 'ready';

/** (lane READY) The first view's draws: target ms of one draw, the most items per draw, a gap between draws that halves the next one. */
export const FIRST_VIEW_DRAW = {targetMs: 6, maxPerDraw: 64, longGapMs: 250} as const;

/** The pacing a job can be switched to (pace()); null fields = the journey's play defaults. */
export type JourneyPacing = Pick<JourneyCompileOptions, 'chunk' | 'shadowChunk' | 'maxStaleMs' | 'sliceMs' | 'shadowTargetMs' | 'postStallFrames'>;

export interface JourneyCompileStats {
  /** 'scene' while scene-pass items remain, 'shadow' while only shadow variants remain. */
  phase: 'scene' | 'shadow' | 'done' | 'cancelled';
  sceneItems: number; sceneDone: number; casters: number; shadowDone: number;
  /** Scheduler steps run, and the synchronous ms of the steps (max / total). */
  steps: number; stepMaxMs: number; stepMs: number;
  /** The most casters one shadow draw took; scene chunks started (= compileAsync calls). */
  shadowMaxPerStep: number; sceneChunks: number;
  /**
   * (Pacing) scene slices begun (one per scene step), the most compile calls one slice made, the longest real time from a slice's
   * start to its last same-frame settle (ms), and whether calls were launched from a background-priority task.
   */
  slices: number; maxPerSlice: number; sliceMaxMs: number; background: boolean;
  /** Launches whose background task had not run after postStallFrames frames (the step ran them directly). */
  postStalls: number;
  /** (lane PLAY) Two-pass items among the scene items (0 without a scene pass target) and how many were drawn off-screen so far. */
  twoPass: number; twoPassDone: number;
  cancelReason: string | null;
  /**
   * (lane READY) The first view: its state; its renderables / representatives, the representatives compiled and the renderables
   * drawn off-screen so far; its casters (the job's leading ones); off-screen draws made, the most items one draw took, the longest
   * draw (ms); the hidden real-view frame (drawn, its ms); whether the first view is DRAWN at all (false: the direct path — compiled
   * only) and when it became ready (ms after the job started; -1: not yet).
   */
  firstView: FirstViewState;
  viewItems: number; viewReps: number; viewRepsCompiled: number; viewDone: number; viewCasters: number;
  viewDraws: number; viewMaxPerDraw: number; viewDrawMaxMs: number; viewFrame: boolean; viewFrameMs: number; viewDrawn: boolean; viewReadyMs: number;
}

/**
 * chunk: scene items per compileAsync call. shadowChunk: the MOST casters per off-screen draw — a draw starts at 1 and adapts to the
 * measured step (doubled while a step stays under shadowTargetMs, halved above 3 x that). maxStaleMs: active ms a queued step waits
 * before it may run once over budget.
 */
export const JOURNEY_COMPILE = {chunk: 1, shadowChunk: 8, shadowTargetMs: 1.5, key: 'render.journey-compile', priority: -1, maxStaleMs: 2000,
  /**
   * (Pacing) real-time budget of one frame's scene slice (cheap items batch while under it), the most calls per slice, and the frames
   * a launch may wait for its background task before a step runs it directly (a browser that never schedules the background queue).
   */
  sliceMs: 2, maxPerSlice: 48, postStallFrames: 20} as const;

/** The browser's background-priority task launcher where it has scheduler.postTask (Chromium; Firefox 158); null elsewhere (Node, older engines). */
function defaultPost(): ((fn: () => void) => void) | null {
  const s = (globalThis as {scheduler?: {postTask?: (fn: () => void, o: {priority: string}) => Promise<unknown>}}).scheduler;
  if (!s || typeof s.postTask !== 'function') return null;
  return fn => { void s.postTask!(fn, {priority: 'background'}).catch(() => undefined); };
}

type Lane = 'scene' | 'shadow' | 'sides' | 'view';
const LANES: readonly Lane[] = ['scene', 'shadow', 'sides', 'view'];

export class JourneyCompile {
  readonly stats: JourneyCompileStats;
  /** Resolves when the scene-pass work is finished (or the job ended): the arrival gate waits for this (bounded by the caller). */
  readonly sceneDone: Promise<void>;
  /** Resolves when everything is done or the job ended. */
  readonly done: Promise<void>;
  /** (lane READY) Resolves when the first view is ready (stats.firstView 'ready'), at once without one, or when the job ended. */
  readonly viewReady: Promise<void>;
  private resolveScene!: () => void;
  /** (lane READY) whenScene's waiters: resolved once sceneDone reaches their count (or the job ended). */
  private sceneWaiters: {n: number; resolve: () => void}[] = [];
  private resolveDone!: () => void;
  private resolveView!: () => void;
  /** (lane READY) The first view (null: none); its representatives' compile state by object; the compiled leading run; the next to draw. */
  private readonly fv: (Required<Omit<JourneyFirstView, 'items'>> & {items: readonly WarmItem[]}) | null;
  private readonly repIndex = new Map<THREE.Object3D, number>();
  private readonly repCompiled: boolean[] = [];
  private repPrefix = 0;
  private repsCompiledN = 0;
  /** (lane READY) The scene items up to the last first-view representative (the lane's lead while the first view is not ready). */
  private leadScene = 0;
  private nextView = 0;
  private viewN = 1;
  private viewAt = -1;
  private readonly t0: number;
  private nextScene = 0;
  private nextShadow = 0;
  private inFlight = false;
  /** (lane PLAY) The two-pass scene items; the ones whose compile settled, in that order (the 'sides' lane's queue); the call in flight. */
  private readonly twoPass: ReadonlySet<WarmItem>;
  private readonly sides: WarmItem[] = [];
  private nextSides = 0;
  private flight: readonly WarmItem[] = [];
  private readonly generation: number;
  private readonly view = new THREE.PerspectiveCamera();
  /** The lights the game camera sees (three's light set never changes in play: only intensities do) and the shadow-casting ones. */
  private readonly lights: THREE.Object3D[] = [];
  private readonly shadowLights: (THREE.Light & {shadow: THREE.LightShadow})[] = [];
  private readonly requested: Record<Lane, boolean> = {scene: false, shadow: false, sides: false, view: false};
  /** Casters per off-screen shadow draw right now (adaptive, 1 .. shadowChunk). */
  private shadowN = 1;
  /** (Pacing) the current slice: its frame number, real start (ms) and compile calls so far; the job's own step count (frameNo default). */
  private sliceFrame = -1;
  private sliceStart = 0;
  private sliceCount = 0;
  private stepNo = 0;
  /** A launch waits for its posted task (since postedFrame); the token of the newest launch (an older task is a no-op). */
  private posted = false;
  private postedFrame = 0;
  private postToken = 0;
  private readonly frameNo: () => number;
  private readonly now: () => number;
  private post: ((fn: () => void) => void) | null;
  private readonly o: Required<Omit<JourneyCompileOptions, 'receiver' | 'frameNo' | 'now' | 'post' | 'maxStaleMs' | 'sliceMs' | 'shadowTargetMs' | 'postStallFrames' | 'firstView'>> & {receiver: WarmItem | null; maxStaleMs?: number; sliceMs?: number; shadowTargetMs?: number; postStallFrames?: number};

  constructor(o: JourneyCompileOptions) {
    // (the direct path — no scene pass target — would draw an off-screen shadow draw onto the canvas: no shadow work there)
    const {firstView, ...rest} = o;
    this.o = {chunk: JOURNEY_COMPILE.chunk, shadowChunk: JOURNEY_COMPILE.shadowChunk, ...rest, receiver: o.target ? o.receiver : null};
    this.frameNo = o.frameNo ?? (() => this.stepNo);
    this.now = o.now ?? (() => performance.now());
    this.t0 = this.now();
    this.post = o.post === undefined ? defaultPost() : o.post;
    this.generation = o.scheduler.generation;
    // (the direct path has no scene pass target: an off-screen draw would land on the canvas — no 'sides' work there either)
    this.twoPass = new Set(o.target ? o.items.filter(i => drawsTwoPass(i.object)) : []);
    const fv = firstView ?? null;
    this.fv = fv ? {items: fv.items, reps: Math.max(0, Math.min(fv.reps, fv.items.length)), casters: this.o.receiver ? Math.max(0, Math.min(fv.casters, o.casters.length)) : 0,
      frame: fv.frame ?? true, targetMs: fv.targetMs ?? FIRST_VIEW_DRAW.targetMs, maxPerDraw: Math.max(1, fv.maxPerDraw ?? FIRST_VIEW_DRAW.maxPerDraw), longGapMs: fv.longGapMs ?? FIRST_VIEW_DRAW.longGapMs} : null;
    if (this.fv) {
      // a representative waits for its scene-lane compile only when it is one of the job's scene items
      const scene = new Set<THREE.Object3D>(o.items.map(i => i.object));
      for (let k = 0; k < this.fv.reps; k++) {
        const obj = this.fv.items[k].object;
        this.repCompiled.push(!scene.has(obj));
        if (!scene.has(obj)) this.repsCompiledN++;
        else if (!this.repIndex.has(obj)) this.repIndex.set(obj, k);
      }
      o.items.forEach((i, k) => { if (this.repIndex.has(i.object)) this.leadScene = k + 1; });
      this.advanceReps();
    }
    this.stats = {phase: 'scene', sceneItems: o.items.length, sceneDone: 0, casters: this.o.receiver ? o.casters.length : 0, shadowDone: 0,
      steps: 0, stepMaxMs: 0, stepMs: 0, shadowMaxPerStep: 0, sceneChunks: 0, slices: 0, maxPerSlice: 0, sliceMaxMs: 0, background: this.post !== null,
      postStalls: 0, twoPass: this.twoPass.size, twoPassDone: 0, cancelReason: null,
      firstView: this.fv ? 'pending' : 'none', viewItems: this.fv?.items.length ?? 0, viewReps: this.fv?.reps ?? 0, viewRepsCompiled: this.repsCompiledN, viewDone: 0,
      viewCasters: this.fv?.casters ?? 0, viewDraws: 0, viewMaxPerDraw: 0, viewDrawMaxMs: 0, viewFrame: false, viewFrameMs: 0, viewDrawn: !!this.fv && !!o.target, viewReadyMs: -1};
    this.sceneDone = new Promise(r => { this.resolveScene = r; });
    this.done = new Promise(r => { this.resolveDone = r; });
    this.viewReady = new Promise(r => { this.resolveView = r; });
    if (!this.fv) this.resolveView();
    this.view.matrixAutoUpdate = false;
    this.view.matrixWorldAutoUpdate = false;
    const mask = o.camera.layers.mask;
    o.scene.traverse(x => {
      const l = x as THREE.Light;
      if (!l.isLight || (x.layers.mask & mask) === 0) return;
      this.lights.push(x);
      const sl = l as THREE.Light & {shadow?: THREE.LightShadow};
      if (l.castShadow && sl.shadow?.camera) this.shadowLights.push(sl as THREE.Light & {shadow: THREE.LightShadow});
    });
  }

  /** Queue the first steps. */
  start(): this {
    this.progress();
    return this;
  }

  private get ended(): boolean { return this.stats.phase === 'done' || this.stats.phase === 'cancelled'; }
  private get sceneLeft(): boolean { return this.nextScene < this.o.items.length || this.inFlight; }
  private get shadowLeft(): boolean { return this.nextShadow < this.stats.casters; }
  /** (lane PLAY) Two-pass items not drawn yet (compiled or not); the scene lane hands each one over as its compile settles. */
  private get sidesLeft(): boolean { return this.stats.twoPassDone < this.stats.twoPass; }

  /** Phase bookkeeping, then (re)queue whatever lane has work. */
  private progress(): void {
    if (this.ended) return;
    if (!this.sceneLeft) this.resolveScene();
    this.viewBookkeeping();
    // (a two-pass item that never reached the queue — the scene lane ended without it — cannot be drawn: nothing is left to wait for)
    if (!this.sceneLeft && !this.shadowLeft && !(this.sidesLeft && this.nextSides < this.sides.length) && !this.viewLeft) { this.end('done', null); return; }
    this.stats.phase = this.sceneLeft ? 'scene' : 'shadow';
    if ((this.nextScene < this.sceneEnd && !this.inFlight) || this.posted) this.request('scene');
    if (this.nextShadow < this.shadowEnd) this.request('shadow');
    if (this.nextSides < this.sides.length && !this.viewLeft) this.request('sides');
    if (this.viewDrawable) this.request('view');
  }

  // -------------------------------------------------------------------------------------------
  // (lane READY) The first view

  /** First-view work left (not ready yet). */
  private get viewLeft(): boolean { return !!this.fv && this.stats.firstView !== 'ready'; }

  /**
   * While the first view is not ready the frames are its own: the scene lane compiles only its lead (up to the last representative), the
   * shadow lane draws only the first view's casters, the two-pass lane waits (the first view's own two-pass items are drawn by its
   * draws). The rest of the job follows once it is ready (in the pacing the caller sets then: a crossing's play pacing).
   */
  private get sceneEnd(): number { return this.viewLeft ? this.leadScene : this.o.items.length; }
  private get shadowEnd(): number { return this.viewLeft ? this.fv!.casters : this.stats.casters; }

  /** The first view's casters drawn (the shadow lane's leading ones). */
  private get viewCastersDone(): boolean { return !this.fv || this.stats.shadowDone >= this.fv.casters; }

  /** A 'view' step has something to do now: an item whose program is prepared, or the hidden real-view frame. */
  private get viewDrawable(): boolean {
    if (!this.fv || !this.o.target) return false;
    const s = this.stats.firstView;
    if (s === 'frame') return true;
    if (s !== 'pending' && s !== 'drawing') return false;
    return this.nextView < this.fv.reps ? this.repPrefix > this.nextView : this.nextView < this.fv.items.length;
  }

  /** The leading run of representatives whose compile settled (drawn in order); and the count compiled. */
  private advanceReps(): void {
    while (this.repPrefix < this.repCompiled.length && this.repCompiled[this.repPrefix]) this.repPrefix++;
  }

  /** The first view's state from the lanes' progress (and ready once everything of it is done). */
  private viewBookkeeping(): void {
    const fv = this.fv, st = this.stats;
    if (!fv || st.firstView === 'ready') return;
    st.viewRepsCompiled = this.repsCompiledN;
    if (!this.o.target) {
      // the direct path: nothing can be drawn off-screen — the first view is its representatives COMPILED (stats.viewDrawn false)
      if (this.repPrefix >= fv.reps) this.viewIsReady();
      return;
    }
    if (st.firstView === 'pending' && (this.viewDrawable || this.nextView >= fv.items.length)) st.firstView = 'drawing';
    if (st.firstView === 'drawing' && this.nextView >= fv.items.length && this.viewCastersDone) {
      if (fv.frame) st.firstView = 'frame'; else this.viewIsReady();
    }
  }

  private viewIsReady(): void {
    this.stats.firstView = 'ready';
    this.stats.viewReadyMs = this.now() - this.t0;
    this.resolveView();
  }

  /**
   * The 'view' step: the next items of the first view drawn OFF-SCREEN in one draw (representatives only once compiled, in order; then
   * the rest), the items per draw adapted to the measured draw; or, once everything of the first view is drawn (and its casters), the
   * hidden frame of the real view.
   */
  private viewStep(): void {
    const fv = this.fv!, st = this.stats;
    if (st.firstView === 'frame') { this.viewFrame(); return; }
    const end = this.nextView < fv.reps ? Math.min(fv.reps, this.repPrefix) : fv.items.length;
    const t0 = this.now();
    // frames that ran long since the last draw (work the draw left to the GPU / driver, e.g. a software rasterizer's shader JIT at
    // its first use) count like a long draw
    const long = this.viewAt >= 0 && t0 - this.viewAt > fv.longGapMs;
    if (long) this.viewN = Math.max(1, this.viewN >> 1);
    const n = Math.min(end - this.nextView, this.viewN);
    if (n <= 0) return;
    const part = fv.items.slice(this.nextView, this.nextView + n);
    if (!this.offscreen(part.map(i => [i, PREP_MASK] as [WarmItem, number]), 'first-view')) return;
    this.nextView += n;
    st.viewDone = this.nextView;
    st.viewDraws++;
    if (n > st.viewMaxPerDraw) st.viewMaxPerDraw = n;
    const ms = this.now() - t0;
    if (ms > st.viewDrawMaxMs) st.viewDrawMaxMs = ms;
    this.viewAt = this.now();
    // (after a long gap the draw size never grows in the same step)
    if (ms > 3 * fv.targetMs) this.viewN = Math.max(1, this.viewN >> 1);
    else if (ms < fv.targetMs && !long) this.viewN = Math.min(fv.maxPerDraw, this.viewN * 2);
  }

  /**
   * The hidden frame of the real view: the scene pass from the camera exactly as the next frame draws it — every renderable on the
   * camera's layers as the level culler left them (nothing isolated), the shadow pass with its real casters — into the scene pass's
   * own target at its depth. Nothing reaches the canvas (the next frame redraws that target before anything composites).
   */
  private viewFrame(): void {
    const {renderer: r, camera, scene} = this.o, v = this.view, st = this.stats;
    const t0 = this.now();
    const prevTarget = r.getRenderTarget(), prevMRT = r.getMRT();
    const rs = r as unknown as {toneMapping: THREE.ToneMapping; outputColorSpace: THREE.ColorSpace};
    const tm = rs.toneMapping, cs = rs.outputColorSpace;
    const autoWorld = scene.matrixWorldAutoUpdate;
    try {
      this.twin();
      v.layers.mask = camera.layers.mask;
      rs.toneMapping = THREE.NoToneMapping;
      rs.outputColorSpace = THREE.ColorManagement.workingColorSpace as THREE.ColorSpace;
      scene.matrixWorldAutoUpdate = false;
      r.setRenderTarget(this.o.target);
      r.setMRT(null);
      renderAtDepthOffset(r, this.o.depth, () => r.render(scene, v));
    } catch (err) {
      console.warn('journey compile: the first view\'s hidden frame failed', err);
      this.end('cancelled', 'error');
      return;
    } finally {
      scene.matrixWorldAutoUpdate = autoWorld;
      rs.toneMapping = tm;
      rs.outputColorSpace = cs;
      r.setRenderTarget(prevTarget);
      r.setMRT(prevMRT);
    }
    st.viewFrame = true;
    st.viewFrameMs = this.now() - t0;
    this.viewIsReady();
  }

  /** The twin camera = the game camera (matrices; perspective values for the uniforms). */
  private twin(): void {
    const {camera} = this.o, v = this.view;
    camera.updateMatrixWorld();
    v.matrixWorld.copy(camera.matrixWorld);
    v.matrixWorldInverse.copy(camera.matrixWorldInverse);
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) { v.fov = pc.fov; v.aspect = pc.aspect; v.near = pc.near; v.far = pc.far; v.zoom = pc.zoom; } // (uniform values only)
  }

  /**
   * (lane READY) The pacing from now on (the queued steps keep theirs until they ran): `null` = the journey's play pacing — once a
   * crossing's exit is open the rest of the job runs like a train journey's after arrival (one item per call, spare frame time).
   */
  pace(p: JourneyPacing | null): void {
    const o = this.o as unknown as Record<string, unknown>;
    const q: JourneyPacing = p ?? {chunk: JOURNEY_COMPILE.chunk, shadowChunk: JOURNEY_COMPILE.shadowChunk};
    o.chunk = q.chunk ?? JOURNEY_COMPILE.chunk;
    o.shadowChunk = q.shadowChunk ?? JOURNEY_COMPILE.shadowChunk;
    for (const k of ['maxStaleMs', 'sliceMs', 'shadowTargetMs', 'postStallFrames'] as const) o[k] = q[k];
    this.shadowN = Math.min(this.shadowN, this.o.shadowChunk);
  }

  /** The job has not ended (still preparing something). */
  get running(): boolean { return !this.ended; }

  /**
   * (lane READY) Resolves once the scene lane has compiled its first `n` items (stats.sceneDone >= n) — a crossing: the destination's
   * new program groups, before the rest's own render objects — or when the job ended.
   */
  whenScene(n: number): Promise<void> {
    if (this.ended || this.stats.sceneDone >= n) return Promise.resolve();
    return new Promise(resolve => { this.sceneWaiters.push({n, resolve}); });
  }

  private settleSceneWaiters(): void {
    const done = this.stats.sceneDone;
    this.sceneWaiters = this.sceneWaiters.filter(w => { if (done < w.n) return true; w.resolve(); return false; });
  }

  private request(lane: Lane): void {
    if (this.ended || this.requested[lane]) return;
    this.requested[lane] = true;
    // (lane READY: the first view's draws go before the rest of the job in a frame)
    const r = this.o.scheduler.request({
      key: `${JOURNEY_COMPILE.key}.${lane}`, kind: `${JOURNEY_COMPILE.key}.${lane}`, priority: lane === 'view' ? JOURNEY_COMPILE.priority + 1 : JOURNEY_COMPILE.priority,
      maxStaleMs: this.o.maxStaleMs ?? JOURNEY_COMPILE.maxStaleMs, initialEstimateMs: lane === 'scene' ? 2 : lane === 'shadow' ? 6 : 4, generation: this.generation,
      step: () => this.step(lane), onCancel: reason => { this.requested[lane] = false; this.end('cancelled', reason); },
    });
    if (r === 'stale' || r === 'dropped') { this.requested[lane] = false; this.end('cancelled', r); }
  }

  /** ONE bounded step (the scheduler's; the request then leaves the queue — the job re-queues itself after the frame). */
  private step(lane: Lane): boolean {
    const t0 = performance.now();
    this.stepNo++;
    this.requested[lane] = false;
    try {
      if (!this.ended) {
        if (lane === 'scene') this.sceneStep();
        else { if (lane === 'shadow') this.shadowStep(); else if (lane === 'sides') this.sidesStep(); else this.viewStep(); queueMicrotask(() => this.progress()); }
      }
      return true;
    } finally {
      const ms = performance.now() - t0;
      this.stats.steps++;
      this.stats.stepMs += ms;
      if (ms > this.stats.stepMaxMs) this.stats.stepMaxMs = ms;
    }
  }

  /**
   * Run `fn` with `objects` (and the camera's lights) on their layers — visible, unculled, their hidden pool chain shown — and the twin
   * camera rendering PREP_LAYER only; every changed field is restored before returning (no frame ever sees it).
   */
  private isolated<T>(objects: readonly [WarmItem, number][], fn: (view: THREE.Camera) => T): T {
    const {scene} = this.o, v = this.view;
    this.twin();
    v.layers.mask = PREP_MASK;
    const saved: [THREE.Object3D, number, boolean, boolean][] = [];
    const keep = (o: THREE.Object3D) => { saved.push([o, o.layers.mask, o.visible, o.frustumCulled]); };
    const shadowMasks = this.shadowLights.map(l => l.shadow.camera.layers.mask);
    // (a dark torch does not auto-update its shadow map — volumetric.ts — so the draw asks for one; the request flag is restored)
    const shadowNeeds = this.shadowLights.map(l => l.shadow.needsUpdate);
    // (the step runs after this frame's render, which brought every world matrix up to date: no second whole-scene update here)
    const autoWorld = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;
    try {
      for (const [i] of objects) { keep(i.object); for (const f of i.flips) keep(f); }
      for (const l of this.lights) keep(l);
      const masks = new Map<THREE.Object3D, number>();
      for (const [i, m] of objects) masks.set(i.object, ((masks.get(i.object) ?? 0) | m) >>> 0);
      for (const [i] of objects) { i.object.layers.mask = masks.get(i.object)!; i.object.visible = true; i.object.frustumCulled = false; for (const f of i.flips) f.visible = true; }
      for (const l of this.lights) l.layers.mask = (l.layers.mask | PREP_MASK) >>> 0;
      for (const l of this.shadowLights) { l.shadow.camera.layers.mask = CASTER_MASK; l.shadow.needsUpdate = true; }
      return fn(v);
    } finally {
      for (let k = saved.length - 1; k >= 0; k--) { const [o, m, vis, fc] = saved[k]; o.layers.mask = m; o.visible = vis; o.frustumCulled = fc; }
      this.shadowLights.forEach((l, k) => { l.shadow.camera.layers.mask = shadowMasks[k]; l.shadow.needsUpdate = shadowNeeds[k]; });
      scene.matrixWorldAutoUpdate = autoWorld;
    }
  }

  /**
   * The scheduler step of the scene lane: a new slice (this frame's) and its first compile call — or, while a launch waits for its
   * background task, the watchdog: a browser that has not run it for postStallFrames frames gets that one call from this step.
   */
  private sceneStep(): void {
    if (this.posted) {
      if (this.frameNo() - this.postedFrame < (this.o.postStallFrames ?? JOURNEY_COMPILE.postStallFrames)) { queueMicrotask(() => this.progress()); return; }
      this.posted = false;
      this.postToken++; // (the stalled task becomes a no-op when it does run)
      this.stats.postStalls++;
      this.compileNext();
      return;
    }
    if (this.inFlight || this.nextScene >= this.sceneEnd) return;
    this.stats.slices++;
    this.sliceFrame = this.frameNo();
    this.sliceStart = this.now();
    this.sliceCount = 0;
    this.launch();
  }

  /** Reserve the one in-flight slot and start the next compile call (from a background-priority task where there is one). */
  private launch(): void {
    this.inFlight = true;
    this.sliceCount++;
    if (this.post) {
      const token = ++this.postToken;
      this.posted = true;
      this.postedFrame = this.frameNo();
      try {
        this.post(() => { if (token !== this.postToken || !this.posted) return; this.posted = false; this.compileNext(); });
        queueMicrotask(() => this.progress()); // (the watchdog step while the task waits; never queued from inside a step)
        return;
      } catch { this.posted = false; this.post = null; this.stats.background = false; } // (the launcher refused: direct from now on)
    }
    this.compileNext();
  }

  /** ONE compileAsync call over the next `chunk` items (1: the pacing unit); settles into itemsSettled. */
  private compileNext(): void {
    // (a posted call can run after the job ended, or after the world changed under it: nothing is compiled then)
    if (this.ended) { this.inFlight = false; return; }
    if (this.o.scheduler.generation !== this.generation) { this.inFlight = false; this.end('cancelled', 'generation'); return; }
    const {renderer: r, items, chunk} = this.o;
    const part = items.slice(this.nextScene, Math.min(this.nextScene + chunk, this.sceneEnd));
    if (!part.length) { this.inFlight = false; queueMicrotask(() => this.progress()); return; }
    this.nextScene += part.length;
    this.flight = part;
    this.stats.sceneChunks++;
    let p: Promise<void>;
    const prevTarget = r.getRenderTarget(), prevMRT = r.getMRT();
    try {
      p = this.isolated(part.map(i => [i, PREP_MASK] as [WarmItem, number]), view => {
        r.setRenderTarget(this.o.target);
        r.setMRT(null);
        return compileAtDepth(r, this.o.depth, () => r.compileAsync(this.o.scene, view, null, null));
      });
    } catch (err) {
      p = Promise.reject(err);
    } finally {
      r.setRenderTarget(prevTarget);
      r.setMRT(prevMRT);
    }
    p.then(() => this.itemsSettled(part.length), err => {
      this.inFlight = false;
      if (this.ended) return;
      console.warn('journey compile: a scene item failed', err);
      this.end('cancelled', 'error');
    });
  }

  /**
   * A compile call finished. The next item starts at once only inside the slice's own frame, under its real-time budget and call
   * cap (cheap cache hits batch); otherwise the lane re-queues for the next frame's step (one call in flight throughout).
   */
  private itemsSettled(n: number): void {
    this.inFlight = false;
    if (this.ended) return;
    if (this.o.scheduler.generation !== this.generation) { this.end('cancelled', 'generation'); return; }
    this.stats.sceneDone += n;
    if (this.sceneWaiters.length) this.settleSceneWaiters();
    for (const i of this.flight) if (this.twoPass.has(i)) this.sides.push(i); // (lane PLAY: compiled — the 'sides' lane may draw it now)
    if (this.repIndex.size) {
      // (lane READY) a first-view representative compiled: the 'view' lane may draw it now (in order)
      for (const i of this.flight) { const k = this.repIndex.get(i.object); if (k !== undefined && !this.repCompiled[k]) { this.repCompiled[k] = true; this.repsCompiledN++; } }
      this.advanceReps();
    }
    this.flight = [];
    const sameFrame = this.frameNo() === this.sliceFrame, ms = this.now() - this.sliceStart;
    if (this.sliceCount > this.stats.maxPerSlice) this.stats.maxPerSlice = this.sliceCount;
    if (sameFrame && ms > this.stats.sliceMaxMs) this.stats.sliceMaxMs = ms;
    if (sameFrame && ms < (this.o.sliceMs ?? JOURNEY_COMPILE.sliceMs) && this.sliceCount < JOURNEY_COMPILE.maxPerSlice && this.nextScene < this.sceneEnd) { this.launch(); return; }
    this.progress();
  }

  /**
   * ONE real off-screen render of `objects` (each on its layer) into the scene pass's own target, nested at the real frame's depth, under
   * the renderer state the real scene pass draws with; false = it failed (the job is ended).
   */
  private offscreen(objects: readonly [WarmItem, number][], what: string): boolean {
    const r = this.o.renderer;
    const prevTarget = r.getRenderTarget(), prevMRT = r.getMRT();
    // (the renderer state the real scene pass draws under: RenderPipeline.render sets these around its quad, the PassNode inside it)
    const rs = r as unknown as {toneMapping: THREE.ToneMapping; outputColorSpace: THREE.ColorSpace};
    const tm = rs.toneMapping, cs = rs.outputColorSpace;
    try {
      rs.toneMapping = THREE.NoToneMapping;
      rs.outputColorSpace = THREE.ColorManagement.workingColorSpace as THREE.ColorSpace;
      this.isolated(objects, view => {
        r.setRenderTarget(this.o.target);
        r.setMRT(null);
        renderAtDepthOffset(r, this.o.depth, () => r.render(this.o.scene, view));
      });
    } catch (err) {
      console.warn(`journey compile: a ${what} draw failed`, err);
      this.end('cancelled', 'error');
      return false;
    } finally {
      rs.toneMapping = tm;
      rs.outputColorSpace = cs;
      r.setRenderTarget(prevTarget);
      r.setMRT(prevMRT);
    }
    return true;
  }

  private shadowStep(): void {
    const {casters, shadowChunk, receiver} = this.o;
    const end = this.shadowEnd;
    if (!receiver || this.nextShadow >= end) return;
    const part = casters.slice(this.nextShadow, Math.min(end, this.nextShadow + Math.min(shadowChunk, this.shadowN)));
    this.nextShadow += part.length;
    const t0 = performance.now();
    if (!this.offscreen([[receiver, PREP_MASK], ...part.map(i => [i, CASTER_MASK] as [WarmItem, number])], 'shadow')) return;
    this.stats.shadowDone += part.length;
    if (part.length > this.stats.shadowMaxPerStep) this.stats.shadowMaxPerStep = part.length;
    const ms = performance.now() - t0, target = this.o.shadowTargetMs ?? JOURNEY_COMPILE.shadowTargetMs;
    this.shadowN = ms < target ? Math.min(shadowChunk, this.shadowN * 2) : ms > 3 * target ? Math.max(1, this.shadowN >> 1) : this.shadowN;
  }

  /** (lane PLAY) The 'sides' step: ONE compiled two-pass item drawn off-screen by the scene pass (its BackSide and FrontSide pipelines). */
  private sidesStep(): void {
    if (this.nextSides >= this.sides.length || this.viewLeft) return;
    const item = this.sides[this.nextSides++];
    if (!this.offscreen([[item, PREP_MASK]], 'two-pass')) return;
    this.stats.twoPassDone++;
  }

  private end(phase: 'done' | 'cancelled', reason: string | null): void {
    if (this.ended) return;
    this.stats.phase = phase;
    this.stats.cancelReason = reason;
    if (phase === 'cancelled') for (const lane of LANES) { const k = `${JOURNEY_COMPILE.key}.${lane}`; if (this.o.scheduler.has(k)) this.o.scheduler.cancel(k); }
    this.resolveScene();
    for (const w of this.sceneWaiters.splice(0)) w.resolve();
    this.resolveView(); // (stats.firstView keeps where it got: a waiter reads it)
    this.resolveDone();
  }

  /** Stop now (queued steps are cancelled). */
  cancel(): void {
    this.end('cancelled', 'cancelled');
  }
}
