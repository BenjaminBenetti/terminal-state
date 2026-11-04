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
// 'Scheduler.yield.then' scripts; 21 / 31 hitches in a 30 s capture just after leaving the train). Firefox has no scheduler.yield
// (three falls back to one object per rAF), so software QA never showed it. Now the scene lane is PACED to real frames:
//  - ONE item per compileAsync call (JOURNEY_COMPILE.chunk 1) and one call in flight: the most a frame can be held is one item's chain;
//  - a SLICE starts in the scheduler's step (after the frame's render); when an item settles in the SAME game frame (opts.frameNo:
//    Game.frames) and the slice is under JOURNEY_COMPILE.sliceMs of real time, the next item starts at once (cheap cache-hit items
//    batch, at most maxPerSlice), else the job waits for the next frame's step — no burst after a hidden tab / pause (steps only run
//    in playing frames; at most one item is ever in flight);
//  - where the browser has scheduler.postTask, the call is LAUNCHED from a 'background' priority task, so the scheduler.yield()
//    calls three makes inside it inherit background priority (the platform's documented yield-inheritance) instead of jumping
//    ahead of rendering. The frame bound above does not depend on that inheritance;
//  - limits: one NEW build's chain (~6 yielded slices) can still cost one frame where the inheritance does not apply; GPU / driver
//    pipeline compile is not observable or preemptible here (CPU-side units only).

import * as THREE from 'three';
import type {FrameScheduler} from '../core/frameBudget';
import {compileAtDepth, renderAtDepthOffset} from './renderContextDepth';
import type {WarmItem, WarmupRenderer} from './warmup';

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
   * The game's frame number (Game.frames): cheap items batch only inside the frame whose step started the slice. Default: a counter
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
}

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
  cancelReason: string | null;
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

/** The browser's background-priority task launcher where it has scheduler.postTask (Chromium); null elsewhere (Node, older engines). */
function defaultPost(): ((fn: () => void) => void) | null {
  const s = (globalThis as {scheduler?: {postTask?: (fn: () => void, o: {priority: string}) => Promise<unknown>}}).scheduler;
  if (!s || typeof s.postTask !== 'function') return null;
  return fn => { void s.postTask!(fn, {priority: 'background'}).catch(() => undefined); };
}

type Lane = 'scene' | 'shadow';

export class JourneyCompile {
  readonly stats: JourneyCompileStats;
  /** Resolves when the scene-pass work is finished (or the job ended): the arrival gate waits for this (bounded by the caller). */
  readonly sceneDone: Promise<void>;
  /** Resolves when everything is done or the job ended. */
  readonly done: Promise<void>;
  private resolveScene!: () => void;
  private resolveDone!: () => void;
  private nextScene = 0;
  private nextShadow = 0;
  private inFlight = false;
  private readonly generation: number;
  private readonly view = new THREE.PerspectiveCamera();
  /** The lights the game camera sees (three's light set never changes in play: only intensities do) and the shadow-casting ones. */
  private readonly lights: THREE.Object3D[] = [];
  private readonly shadowLights: (THREE.Light & {shadow: THREE.LightShadow})[] = [];
  private readonly requested: Record<Lane, boolean> = {scene: false, shadow: false};
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
  private readonly o: Required<Omit<JourneyCompileOptions, 'receiver' | 'frameNo' | 'now' | 'post'>> & {receiver: WarmItem | null};

  constructor(o: JourneyCompileOptions) {
    // (the direct path — no scene pass target — would draw an off-screen shadow draw onto the canvas: no shadow work there)
    this.o = {chunk: JOURNEY_COMPILE.chunk, shadowChunk: JOURNEY_COMPILE.shadowChunk, ...o, receiver: o.target ? o.receiver : null};
    this.frameNo = o.frameNo ?? (() => this.stepNo);
    this.now = o.now ?? (() => performance.now());
    this.post = o.post === undefined ? defaultPost() : o.post;
    this.generation = o.scheduler.generation;
    this.stats = {phase: 'scene', sceneItems: o.items.length, sceneDone: 0, casters: this.o.receiver ? o.casters.length : 0, shadowDone: 0,
      steps: 0, stepMaxMs: 0, stepMs: 0, shadowMaxPerStep: 0, sceneChunks: 0, slices: 0, maxPerSlice: 0, sliceMaxMs: 0, background: this.post !== null,
      postStalls: 0, cancelReason: null};
    this.sceneDone = new Promise(r => { this.resolveScene = r; });
    this.done = new Promise(r => { this.resolveDone = r; });
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

  /** Phase bookkeeping, then (re)queue whatever lane has work. */
  private progress(): void {
    if (this.ended) return;
    if (!this.sceneLeft) this.resolveScene();
    if (!this.sceneLeft && !this.shadowLeft) { this.end('done', null); return; }
    this.stats.phase = this.sceneLeft ? 'scene' : 'shadow';
    if ((this.nextScene < this.o.items.length && !this.inFlight) || this.posted) this.request('scene');
    if (this.shadowLeft) this.request('shadow');
  }

  private request(lane: Lane): void {
    if (this.ended || this.requested[lane]) return;
    this.requested[lane] = true;
    const r = this.o.scheduler.request({
      key: `${JOURNEY_COMPILE.key}.${lane}`, kind: `${JOURNEY_COMPILE.key}.${lane}`, priority: JOURNEY_COMPILE.priority,
      maxStaleMs: JOURNEY_COMPILE.maxStaleMs, initialEstimateMs: lane === 'scene' ? 2 : 6, generation: this.generation,
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
        else { this.shadowStep(); queueMicrotask(() => this.progress()); }
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
    const {camera, scene} = this.o, v = this.view;
    camera.updateMatrixWorld();
    v.matrixWorld.copy(camera.matrixWorld);
    v.matrixWorldInverse.copy(camera.matrixWorldInverse);
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) { v.fov = pc.fov; v.aspect = pc.aspect; v.near = pc.near; v.far = pc.far; v.zoom = pc.zoom; } // (uniform values only)
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
      if (this.frameNo() - this.postedFrame < JOURNEY_COMPILE.postStallFrames) { queueMicrotask(() => this.progress()); return; }
      this.posted = false;
      this.postToken++; // (the stalled task becomes a no-op when it does run)
      this.stats.postStalls++;
      this.compileNext();
      return;
    }
    if (this.inFlight || this.nextScene >= this.o.items.length) return;
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
    const part = items.slice(this.nextScene, this.nextScene + chunk);
    this.nextScene += part.length;
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
    const sameFrame = this.frameNo() === this.sliceFrame, ms = this.now() - this.sliceStart;
    if (this.sliceCount > this.stats.maxPerSlice) this.stats.maxPerSlice = this.sliceCount;
    if (sameFrame && ms > this.stats.sliceMaxMs) this.stats.sliceMaxMs = ms;
    if (sameFrame && ms < JOURNEY_COMPILE.sliceMs && this.sliceCount < JOURNEY_COMPILE.maxPerSlice && this.nextScene < this.o.items.length) { this.launch(); return; }
    this.progress();
  }

  private shadowStep(): void {
    const {renderer: r, casters, shadowChunk, receiver} = this.o;
    if (!receiver || this.nextShadow >= this.stats.casters) return;
    const part = casters.slice(this.nextShadow, this.nextShadow + Math.min(shadowChunk, this.shadowN));
    this.nextShadow += part.length;
    const t0 = performance.now();
    const prevTarget = r.getRenderTarget(), prevMRT = r.getMRT();
    // (the renderer state the real scene pass draws under: RenderPipeline.render sets these around its quad, the PassNode inside it)
    const rs = r as unknown as {toneMapping: THREE.ToneMapping; outputColorSpace: THREE.ColorSpace};
    const tm = rs.toneMapping, cs = rs.outputColorSpace;
    try {
      rs.toneMapping = THREE.NoToneMapping;
      rs.outputColorSpace = THREE.ColorManagement.workingColorSpace as THREE.ColorSpace;
      this.isolated([[receiver, PREP_MASK], ...part.map(i => [i, CASTER_MASK] as [WarmItem, number])], view => {
        r.setRenderTarget(this.o.target);
        r.setMRT(null);
        renderAtDepthOffset(r, this.o.depth, () => r.render(this.o.scene, view));
      });
    } catch (err) {
      console.warn('journey compile: a shadow draw failed', err);
      this.end('cancelled', 'error');
      return;
    } finally {
      rs.toneMapping = tm;
      rs.outputColorSpace = cs;
      r.setRenderTarget(prevTarget);
      r.setMRT(prevMRT);
    }
    this.stats.shadowDone += part.length;
    if (part.length > this.stats.shadowMaxPerStep) this.stats.shadowMaxPerStep = part.length;
    const ms = performance.now() - t0, target = JOURNEY_COMPILE.shadowTargetMs;
    this.shadowN = ms < target ? Math.min(shadowChunk, this.shadowN * 2) : ms > 3 * target ? Math.max(1, this.shadowN >> 1) : this.shadowN;
  }

  private end(phase: 'done' | 'cancelled', reason: string | null): void {
    if (this.ended) return;
    this.stats.phase = phase;
    this.stats.cancelReason = reason;
    if (phase === 'cancelled') for (const lane of ['scene', 'shadow'] as const) { const k = `${JOURNEY_COMPILE.key}.${lane}`; if (this.o.scheduler.has(k)) this.o.scheduler.cancel(k); }
    this.resolveScene();
    this.resolveDone();
  }

  /** Stop now (queued steps are cancelled). */
  cancel(): void {
    this.end('cancelled', 'cancelled');
  }
}
