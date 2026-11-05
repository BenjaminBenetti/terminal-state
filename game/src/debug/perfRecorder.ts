// Task studio-performance-recorder-20261103-043629 (lane RECORDER): the player-controlled performance recorder — CORE.
//
// Pure (no DOM, no renderer, no game import), so it is unit tested (tests/perf-recorder.test.ts): bounded typed-array capture of
// EVERY animation frame (never every n-th), bounded event / long-frame / resource / camera / heap buffers, the read-out (gameplay-only
// summaries, worst-frame timelines with their nearby events, correlation counts) and the report's chunked JSON serialization. The
// browser / game side (debug/perfRecorderHooks.ts) fills one FrameInput per frame and forwards events; the UI
// (debug/perfRecorderUi.ts) starts / stops and downloads. Format: docs/performance-recorder.md.
//
// Frame semantics are the debug overlay's (debug/frameHistory.ts): sample k is one rAF callback — its rAF timestamp, the main-thread
// ms of the game's whole frame callback (cpu), of its world update, render submission and deferred chunks (the same performance.now()
// boundaries Game.frame / main.ts already measure), the UpdateProfiler's span breakdown when the world updated in it, and the renderer
// counters after it. Its INTERVAL is the time to the next rAF timestamp (the work it did is what delayed that next frame), so the
// last sample has none. An interval the page was hidden in (or > GAP_MS longer than the game's own work) is a GAP: tagged, never a
// stutter.
//
// Bounds: frames are never dropped — the capture auto-stops when the frame ring (caps.frames) or the duration cap is reached. The
// secondary buffers drop their OLDEST entries when full (long frames: the SHORTEST, so the worst are kept) and say so in
// capture.drops. Spike detail (nested spans) is kept for the worst caps.spikeDetail frames; the rest is counted as omitted.
//
// Cost: nothing is allocated before the first start (the arrays are then reused by every later start: a restart clears, never
// grows); one frame() writes ~25 typed-array slots and copies the profiler's newest slot — no allocation, no string work.
//
// Task hitch-attribution-recorder-20261105 (schema revision 2, additive — every revision-1 field is unchanged): the callback START
// (performance.now() at the main loop's rAF callback entry: `start`, with startDelay = start - t and gapBefore = start - the previous
// callback's end), an asynchronous GPU-queue completion probe per drawn frame (device.queue.onSubmittedWorkDone(), resolved on the
// main thread: queueMs / queueDone / queueState — never awaited, bounded, honest nulls), flashlight lit / shadow-map flag bits, the
// identity of synchronous first-use node builds (sanitized labels, bounded) and the TAIL summary: intervals by refresh multiple,
// callback overruns and their overlap with interval misses, stall events per minute and the worst 1 s / 5 s windows.
//
// Task runtime-variant-warmup-20261105 (schemaMinor 3, additive): the identity of every NEW render pipeline request
// (summary.firstUse.pipelines — a pipeline cache miss, with or without a node build, sync in a render or async; sanitized labels and
// the request's pass / target / material-state / object flags, bounded) and a 10 s mark lookback with the stalls in it (marks[]).

import {GAP_MS, quantile} from './frameHistory';
import {PARENT, S, SPAN_COUNT, isHookSpan} from './updateProfile';

export const PERF_SCHEMA = 'terminal-state-perf';
export const PERF_SCHEMA_VERSION = 1;
/**
 * Additive minor version of schema 1 (report key schemaMinor; 2: start / startDelay / gapBefore / queue* columns, torch flags,
 * firstUse.builds, summary.tail, shot / hit spans; 3: summary.firstUse.pipelines + worst[].firstUse.pipelineRequests, the 10 s mark
 * lookback with marks[].windowMs / fromT / refreshMs / stalls / omittedStalls; 4: frames.columns.uniformWrites / uniformWritesSkipped —
 * render/uploadDedupe.ts).
 */
export const PERF_SCHEMA_MINOR = 4;

/** (schemaMinor 3) A mark looks back this far (ms) for its worst frame and stalls: players press F9 seconds after the felt stall. */
export const MARK_LOOKBACK_MS = 10000;
/** (schemaMinor 3) Stalls listed per mark (worst first; the rest counted in omittedStalls). */
export const MARK_STALLS = 12;

export interface PerfCaps {
  /** Frame samples (every rAF callback); the capture stops when full. */
  frames: number;
  /** Capture wall time (ms since start, hidden time included); the capture stops when reached. */
  durationMs: number;
  events: number;
  longFrames: number;
  resources: number;
  /** Camera pose samples (cameraEveryMs cadence). */
  camera: number;
  cameraEveryMs: number;
  heap: number;
  marks: number;
  /** World segments (level / station changes). */
  worlds: number;
  /** Worst frames reported with full timelines. */
  worst: number;
  /** Spike frames reported with every nested span. */
  spikeDetail: number;
  /** Synchronous first-use node builds reported with their identity (the most expensive are kept). */
  firstUseBuilds: number;
  /**
   * (schemaMinor 3) New render pipeline requests reported with their identity: the most expensive in-render requests are kept;
   * asynchronous ones (no CPU time) only first-come while there is room.
   */
  firstUsePipelines: number;
  /** GPU-queue completion probes in flight at once (more: that frame is not probed, counted as capped). */
  queueOutstanding: number;
}

export const PERF_CAPS: Readonly<PerfCaps> = Object.freeze({
  frames: 20000, durationMs: 120000, events: 6000, longFrames: 400, resources: 1500, camera: 1300, cameraEveryMs: 100, heap: 150,
  marks: 200, worlds: 64, worst: 24, spikeDetail: 160, firstUseBuilds: 240, firstUsePipelines: 240, queueOutstanding: 8,
});

/** Game states (Game.state) by code; anything else is 'other'. */
export const STATE_NAMES = ['playing', 'paused', 'inventory', 'map', 'dead', 'won', 'title', 'loading', 'error', 'other'] as const;
export type StateName = (typeof STATE_NAMES)[number];
export const ST_PLAYING = 0;
const ST_TITLE = 6, ST_LOADING = 7;

export function stateCode(s: string): number {
  switch (s) {
    case 'playing': return 0;
    case 'paused': return 1;
    case 'inventory': return 2;
    case 'map': return 3;
    case 'dead': return 4;
    case 'won': return 5;
    case 'title': return 6;
    case 'loading': return 7;
    case 'error': return 8;
    default: return 9;
  }
}

/** Per-frame flag bits (frames.columns.flags). */
export const F = {
  /** the game drew in this callback */ rendered: 1,
  /** the interval after this callback contained a hidden / suspended page (set when the page comes back) */ gap: 2,
  /** document.hidden at the sample */ hidden: 4,
  /** the window had lost focus */ unfocused: 8,
  /** the loading-screen render warm-up owns the loop */ warming: 16,
  /** a lifecycle operation (travel / journey / level build / new game / load) is in flight */ transition: 32,
  /** the campaign train is moving (ride mode) */ riding: 64,
  /** the UpdateProfiler recorded this frame (the world updated) */ spans: 128,
  /** the player pressed the mark key since the previous sample */ mark: 256,
  /** Game.setState ran since the previous sample */ stateChange: 512,
  /** the train journey's background compile (render/journeyCompile.ts) was active at the sample */ compiling: 1024,
  /** the player's flashlight was lit (visible, intensity > 0) at the sample */ torchLit: 2048,
  /** the flashlight's shadow map was drawn this frame (castShadow and shadow.autoUpdate; quality-dependent) */ torchShadow: 4096,
} as const;

/** GPU-queue completion probe state per frame (frames.columns.queueState). */
export const QUEUE_STATES = ['none', 'pending', 'resolved', 'capped', 'error', 'cancelled'] as const;
export const Q_NONE = 0, Q_PENDING = 1, Q_RESOLVED = 2, Q_CAPPED = 3, Q_ERROR = 4, Q_CANCELLED = 5;
export const FLAG_NAMES = Object.keys(F) as (keyof typeof F)[];

/** Frame categories: what the summaries split by. Only 'gameplay' frames feed the gameplay summary. */
export const CATEGORIES = ['gameplay', 'transition', 'menu', 'loading', 'warmup', 'hidden', 'unfocused'] as const;
export type Category = (typeof CATEGORIES)[number];
const C_GAMEPLAY = 0, C_TRANSITION = 1, C_MENU = 2, C_LOADING = 3, C_WARMUP = 4, C_HIDDEN = 5, C_UNFOCUSED = 6;

/** Frame-time thresholds counted by every distribution (ms): 60 / 30 / 20 / 10 fps. */
export const THRESHOLDS_MS = [1000 / 60, 1000 / 30, 50, 100] as const;
const THRESHOLD_KEYS = ['16.7', '33.3', '50', '100'] as const;
/** A gameplay frame whose interval exceeds this is a spike (correlation counts, spike detail). */
export const SPIKE_MS = 1000 / 30;
/** Camera turning: yaw rate (deg/s, over the preceding TURN_WINDOW_MS) above this counts as turning. */
export const TURN_DEG_S = 90;
export const TURN_WINDOW_MS = 100;

export type TerminationReason = 'manual' | 'auto-cap-frames' | 'auto-cap-duration' | 'hidden' | 'device-lost' | 'recorder-error' | 'cancelled';

/** One frame's values (the hooks fill ONE reused instance per frame; -1 = counter unavailable). */
export class FrameInput {
  time = 0; cpuMs = 0; updateMs = 0; renderMs = 0; deferredMs = 0;
  /** performance.now() at the game's rAF callback entry (main.ts loop t0; the same timebase as `time`); NaN = not supplied. */
  start = NaN;
  /** renderer.info.frame of the drawn frame (asynchronous GPU timings refer to it); -1 when nothing was drawn. */
  frameId = -1;
  state = 0; flags = 0;
  draws = 0; tris = 0; passes = 0;
  textures = -1; geometries = -1; programs = -1; nodes = -1; pipelines = -1;
  culled = -1; enemies = 0;
  /** Player look (radians) and position (m); storey = the culler's level of the eye. */
  yaw = 0; pitch = 0; x = 0; y = 0; z = 0; storey = 0;
  /**
   * First-use preparation since the previous sample (three r186 internals, hooked while recording; fuOn = false: unavailable):
   * TSL node builds completed inside a synchronous renderer.render() and their CPU ms, node builds completed outside one
   * (compileAsync / warm-up), pipelines requested (+ CPU ms inside renders), shader programs created (+ CPU ms inside renders).
   */
  fuOn = false;
  nodeBuilds = 0; nodeBuildMs = 0; asyncBuilds = 0; pipelinesCreated = 0; pipelineMs = 0; programsCreated = 0; programMs = 0;
  /** (schemaMinor 4) Uniform-buffer uploads issued / skipped as identical so far (render/uploadDedupe.ts uploadStats; -1: not installed). */
  uniformWrites = -1; uniformWritesSkipped = -1;
}

/** The UpdateProfiler's ring (debug/updateProfile.ts) as the recorder reads it. */
export interface ProfilerFrames {
  readonly on: boolean;
  readonly head: number;
  readonly capacity: number;
  readonly ms: Float32Array;
  readonly calls: Uint16Array;
}

export interface LongFrameEntry {
  /** performance.now() timebase */
  start: number;
  duration: number;
  blocking: number | null;
  renderStart: number | null;
  styleAndLayoutStart: number | null;
  /** The longest scripts (LoAF attribution; ids already sanitized). */
  scripts: {invokerType: string; invoker: string; fn: string; source: string; ms: number; forcedLayoutMs: number | null}[];
  type: 'long-animation-frame' | 'longtask';
}

/**
 * One synchronous first-use TSL node build (inside a renderer.render(); task hitch-attribution-recorder-20261105). Labels only —
 * sanitized names / types of the object and materials (safeLabel), never object references, shaders, geometry or textures.
 */
export interface FirstUseBuild {
  /** Capture frame index of the callback it ran in, and its time (ms since capture start). */
  frame: number;
  t: number;
  /** CPU ms of the build. */
  ms: number;
  /** The rendered object's name (or its nearest named ancestor's, `via` 'ancestor'); null = anonymous. */
  object: string | null;
  via: 'self' | 'ancestor' | null;
  objectType: string | null;
  /** The material the build is for (a shadow pass: the pass's depth material) and the object's own material. */
  material: string | null;
  materialType: string | null;
  objectMaterial: string | null;
  /** A shadow-map pass build (the material is the light's shadow-pass material). */
  shadowPass: boolean;
}

/**
 * (schemaMinor 3) What a pipeline request draws into: three r186 RenderContext fields read at the request (null = unknown / not a
 * render-target value). A pipeline is keyed by these as well as by the shaders, so a request with no node build is often a known
 * material in a new target / sample-count / state combination.
 */
export interface PipelineTarget {
  /** Drawn into a render target (false: the canvas / default framebuffer). */
  toTarget: boolean | null;
  /** Color attachments of the target (0: the canvas). */
  colorTargets: number | null;
  /** three texture type constant of color attachment 0 (e.g. 1009 UnsignedByteType, 1016 HalfFloatType); null: the canvas. */
  colorType: number | null;
  /** RenderContext.sampleCount of a render target (MSAA); null for the canvas (the renderer's own samples are not read). */
  samples: number | null;
  depth: boolean | null;
  stencil: boolean | null;
  /** The target has a depth texture. */
  depthTexture: boolean | null;
  /** Multiple render targets (an MRT node) are bound. */
  mrt: boolean | null;
}

/** (schemaMinor 3) The pipeline-relevant state of the request's material (three constants as numbers; null = not on the material). */
export interface PipelineMaterialState {
  side: number | null;
  transparent: boolean | null;
  blending: number | null;
  depthWrite: boolean | null;
  depthTest: boolean | null;
  colorWrite: boolean | null;
  alphaToCoverage: boolean | null;
  polygonOffset: boolean | null;
}

/** (schemaMinor 3) The pipeline-relevant flags of the request's object. */
export interface PipelineObjectFlags {
  instanced: boolean;
  batched: boolean;
  skinned: boolean;
  /** A mesh with a negative-determinant world matrix (three keys its front face, so it is a separate pipeline); null = unknown. */
  mirrored: boolean | null;
  /** The geometry has an index. */
  indexed: boolean | null;
  /** Clipping planes apply (RenderObject.clippingContextCacheKey). */
  clipping: boolean | null;
}

/**
 * (schemaMinor 3) One NEW render pipeline request (three r186 Pipelines._getRenderPipeline: a pipeline cache miss). Labels, numbers
 * and booleans only — the same sanitized identity as a FirstUseBuild, plus the pass / target / state the pipeline is keyed by.
 */
export interface FirstUsePipeline extends Omit<FirstUseBuild, 'ms'> {
  /** CPU ms of the request inside a synchronous render (it includes the backend's pipeline creation call); null outside one. */
  ms: number | null;
  /** Outside a synchronous renderer.render() (compileAsync / warm-up / background compile). */
  async: boolean;
  /**
   * The most recent node build (same frame sample) was for this render object: false in a render = the material's node build was
   * cached (an async build can span frame samples: there false is not proof).
   */
  withBuild: boolean;
  /** Vertex / fragment shader programs created for this request (0-2; 0 = both shader stages already existed). */
  newPrograms: number;
  /** 'shadow' = a shadow-map pass (shadow-pass material), 'fullscreen' = a full-screen quad pass, else 'scene'; null = unknown. */
  pass: 'scene' | 'shadow' | 'fullscreen' | null;
  target: PipelineTarget | null;
  materialState: PipelineMaterialState | null;
  objectFlags: PipelineObjectFlags | null;
}

export interface ResourceEntry {
  start: number;
  duration: number;
  id: string;
  category: string;
  initiator: string;
  transferBytes: number | null;
  encodedBytes: number | null;
  decodedBytes: number | null;
  cache: 'hit' | 'network' | 'unknown';
}

export interface WorldSegment {
  t: number;
  level: string | null;
  section: string | null;
  station: string | null;
  seed: number | null;
  seedCode: string | null;
  name?: string | null;
  /** How the level was reached: travel-arrival (train transit), new-game, new-campaign, continue, retry, menu-travel, recording-start, other. */
  route?: string | null;
  /** Warm-ups / background compiles run for this level (status / mode / ms; stage times in the events). */
  warmups?: Record<string, unknown>[];
  /** When the player had control again (state playing, no warm-up, no lifecycle operation in flight); null = not within the capture. */
  controlT?: number | null;
}

/** Everything the report says besides the capture itself (the hooks collect it; all fields optional / nullable). */
export interface ReportMeta {
  build: Record<string, unknown>;
  environment: Record<string, unknown>;
  capabilities: {id: string; available: boolean; source: string; note?: string}[];
  /** UpdateProfiler span names by id (prof.name(i)). */
  spanNames: string[];
  capturedAtUTC: string;
  endedAtUTC: string;
  stoppedBy?: string;
  overhead?: Record<string, unknown>;
  notes?: string[];
}

export const PRIVACY_NOTE = 'Game performance / event data only: frame timings, renderer counters, game-relative asset file names, the '
  + 'game-generated level / station / seed and the camera pose inside it. No saves, inventory, account, keys or typed text, no URLs or '
  + 'query strings, no screenshots / audio. Nothing is uploaded: the file is kept in memory until downloaded or the page reloads.';

const r2 = (v: number) => Math.round(v * 100) / 100;
const q100 = (v: number) => Math.round(v * 100);
/** Wrap radians to (-180, 180] degrees. */
const wrapDeg = (rad: number) => { let d = rad * 180 / Math.PI % 360; if (d > 180) d -= 360; else if (d <= -180) d += 360; return d; };
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export interface Dist {
  frames: number;
  min: number | null; median: number | null; p95: number | null; p99: number | null; max: number | null; mean: number | null;
  /** Frames over 16.7 / 33.3 / 50 / 100 ms. */
  over: Record<(typeof THRESHOLD_KEYS)[number], number>;
}

/** Distribution of the first n values of `vals` (sorted in place: pass a scratch copy). */
export function distribution(vals: Float64Array, n: number): Dist {
  const d: Dist = {frames: n, min: null, median: null, p95: null, p99: null, max: null, mean: null, over: {'16.7': 0, '33.3': 0, '50': 0, '100': 0}};
  if (n <= 0) return d;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    sum += v;
    for (let k = 0; k < THRESHOLDS_MS.length; k++) if (v > THRESHOLDS_MS[k]) d.over[THRESHOLD_KEYS[k]]++;
  }
  const s = vals.subarray(0, n).sort();
  d.min = r2(s[0]); d.max = r2(s[n - 1]); d.mean = r2(sum / n);
  d.median = r2(quantile(s, 0.5)); d.p95 = r2(quantile(s, 0.95)); d.p99 = r2(quantile(s, 0.99));
  return d;
}

const CAP_NONE = 0, CAP_FRAMES = 1, CAP_DURATION = 2;
export type CapResult = 0 | 1 | 2;

interface EventRec { t: number; dur: number | null; kind: string; data: Record<string, unknown> | null }

/** One capture (start .. stop) and its read-out. Reusable: start() clears the previous capture. */
export class PerfCapture {
  readonly caps: PerfCaps;
  private on = false;
  private stopped = false;
  private allocated = false;
  /** performance.now() at start (frame times are stored relative to it). */
  t0 = 0;
  tEnd = 0;
  termination: TerminationReason | null = null;
  n = 0;
  // --- frames (allocated at the first start) ---
  private t!: Float64Array;
  private cpu!: Float32Array; private upd!: Float32Array; private ren!: Float32Array; private def!: Float32Array; private gpu!: Float32Array;
  private state!: Uint8Array; private flags!: Uint16Array; private frameId!: Float64Array;
  private draws!: Uint32Array; private tris!: Uint32Array; private passes!: Uint16Array;
  private dTex!: Int16Array; private dGeo!: Int16Array; private dProg!: Int16Array; private dNode!: Int16Array; private dPipe!: Int16Array;
  private dUni!: Int16Array; private dUniSkip!: Int16Array;
  private culled!: Int32Array; private enemies!: Uint16Array; private yaw!: Float32Array; private pitch!: Float32Array;
  private spanMs!: Float32Array; private spanCalls!: Uint16Array;
  private fuBuilds!: Uint16Array; private fuBuildMs!: Float32Array; private fuAsync!: Uint16Array; private fuPipes!: Uint16Array; private fuPipeMs!: Float32Array;
  private fuProgs!: Uint16Array; private fuProgMs!: Float32Array;
  /** (Revision 2) callback start, queue probe call / resolution (ms since capture start; NaN = none) and probe state (Q_*). */
  private st!: Float64Array; private qCall!: Float64Array; private qDone!: Float64Array; private qState!: Uint8Array;
  /** Bumped at every start / clear: a queue result of an earlier capture is never written into this one. */
  gen = 0;
  /** (Revision 2) identified synchronous first-use builds (the most expensive kept) and how many were not kept. */
  private fuList: FirstUseBuild[] = [];
  fuListDropped = 0;
  fuListSeen = 0;
  /** (schemaMinor 3) identified new render pipeline requests (bounded: see PerfCaps.firstUsePipelines). */
  private fpList: FirstUsePipeline[] = [];
  fpListDropped = 0;
  fpListSeen = 0;
  // --- running state ---
  private prev = {textures: -1, geometries: -1, programs: -1, nodes: -1, pipelines: -1, uniformWrites: -1, uniformWritesSkipped: -1};
  /** Counters that were ever available in this capture (null in the report otherwise). */
  readonly seen = {textures: false, geometries: false, programs: false, nodes: false, pipelines: false, culled: false, gpu: false, spans: false, firstUse: false, uniformWrites: false};
  private profHead = -1;
  private gapPending = false;
  private markPending = false;
  private lastCam = -Infinity;
  // --- camera (cadence) ---
  private camN = 0; private camHead = 0; camDropped = 0;
  private camT!: Float64Array; private camX!: Float32Array; private camY!: Float32Array; private camZ!: Float32Array; private camS!: Int8Array;
  // --- secondary buffers ---
  private events: EventRec[] = [];
  private evHead = 0;
  eventsDropped = 0;
  private readonly eventTotals = new Map<string, {count: number; ms: number; maxMs: number}>();
  private longFrames: LongFrameEntry[] = [];
  longFramesDropped = 0;
  longFramesSeen = 0;
  private resources: ResourceEntry[] = [];
  private resHead = 0;
  resourcesDropped = 0;
  private readonly resourceTotals = new Map<string, {count: number; cacheHits: number; transferBytes: number; decodedBytes: number}>();
  private heapRows: [number, number, number | null, number | null][] = [];
  heapDropped = 0;
  private marks: number[] = [];
  marksDropped = 0;
  private worlds: WorldSegment[] = [];
  worldsDropped = 0;

  constructor(caps: Partial<PerfCaps> = {}) {
    this.caps = {...PERF_CAPS, ...caps};
  }

  get recording(): boolean { return this.on; }
  /** A capture was taken (stopped) and can be read out. */
  get finished(): boolean { return this.stopped; }
  get frames(): number { return this.n; }
  get markCount(): number { return this.marks.length; }

  private alloc(): void {
    if (this.allocated) return;
    const N = Math.max(2, Math.floor(this.caps.frames));
    this.t = new Float64Array(N);
    this.cpu = new Float32Array(N); this.upd = new Float32Array(N); this.ren = new Float32Array(N); this.def = new Float32Array(N);
    this.gpu = new Float32Array(N);
    this.state = new Uint8Array(N); this.flags = new Uint16Array(N); this.frameId = new Float64Array(N);
    this.draws = new Uint32Array(N); this.tris = new Uint32Array(N); this.passes = new Uint16Array(N);
    this.dTex = new Int16Array(N); this.dGeo = new Int16Array(N); this.dProg = new Int16Array(N); this.dNode = new Int16Array(N); this.dPipe = new Int16Array(N);
    this.dUni = new Int16Array(N); this.dUniSkip = new Int16Array(N);
    this.culled = new Int32Array(N); this.enemies = new Uint16Array(N); this.yaw = new Float32Array(N); this.pitch = new Float32Array(N);
    this.spanMs = new Float32Array(N * SPAN_COUNT); this.spanCalls = new Uint16Array(N * SPAN_COUNT);
    this.fuBuilds = new Uint16Array(N); this.fuBuildMs = new Float32Array(N); this.fuAsync = new Uint16Array(N); this.fuPipes = new Uint16Array(N); this.fuPipeMs = new Float32Array(N);
    this.fuProgs = new Uint16Array(N); this.fuProgMs = new Float32Array(N);
    this.st = new Float64Array(N); this.qCall = new Float64Array(N); this.qDone = new Float64Array(N); this.qState = new Uint8Array(N);
    const C = Math.max(1, Math.floor(this.caps.camera));
    this.camT = new Float64Array(C); this.camX = new Float32Array(C); this.camY = new Float32Array(C); this.camZ = new Float32Array(C); this.camS = new Int8Array(C);
    this.allocated = true;
  }

  /**
   * Begin a capture at `now` (performance.now()); clears every earlier capture (the arrays are reused). `profHead` = the
   * UpdateProfiler's ring head right now (its next recorded frame is then the first sampled one); -1 = no profiler.
   */
  start(now: number, profHead = -1): void {
    this.alloc();
    this.on = true;
    this.stopped = false;
    this.t0 = now;
    this.tEnd = now;
    this.termination = null;
    this.n = 0;
    this.gen++;
    this.gpu.fill(NaN);
    this.fuList = []; this.fuListDropped = 0; this.fuListSeen = 0;
    this.fpList = []; this.fpListDropped = 0; this.fpListSeen = 0;
    this.prev.textures = this.prev.geometries = this.prev.programs = this.prev.nodes = this.prev.pipelines = this.prev.uniformWrites = this.prev.uniformWritesSkipped = -1;
    for (const k of Object.keys(this.seen) as (keyof PerfCapture['seen'])[]) this.seen[k] = false;
    this.profHead = profHead;
    this.gapPending = this.markPending = false;
    this.lastCam = -Infinity;
    this.camN = this.camHead = this.camDropped = 0;
    this.events = []; this.evHead = 0; this.eventsDropped = 0; this.eventTotals.clear();
    this.longFrames = []; this.longFramesDropped = 0; this.longFramesSeen = 0;
    this.resources = []; this.resHead = 0; this.resourcesDropped = 0; this.resourceTotals.clear();
    this.heapRows = []; this.heapDropped = 0;
    this.marks = []; this.marksDropped = 0;
    this.worlds = []; this.worldsDropped = 0;
  }

  /** End the capture (idempotent: the first reason wins). */
  stop(now: number, reason: TerminationReason): void {
    if (!this.on) return;
    this.on = false;
    this.stopped = reason !== 'cancelled';
    this.tEnd = now;
    this.termination = reason;
    // queue probes still in flight are CANCELLED (null in the report; a later resolution is ignored: the capture is off)
    for (let k = 0; k < this.n; k++) if (this.qState[k] === Q_PENDING) this.qState[k] = Q_CANCELLED;
  }

  /** Forget the capture (idempotent). The arrays stay allocated for the next start. */
  clear(): void {
    this.on = false;
    this.stopped = false;
    this.termination = null;
    this.n = 0;
    this.gen++;
    this.fuList = []; this.fuListDropped = 0; this.fuListSeen = 0;
    this.fpList = []; this.fpListDropped = 0; this.fpListSeen = 0;
    this.events = []; this.longFrames = []; this.resources = []; this.heapRows = []; this.marks = []; this.worlds = [];
    this.eventTotals.clear(); this.resourceTotals.clear();
  }

  /** Record one frame. Returns 1 / 2 when a cap is reached (the caller stops the capture), else 0. Never allocates. */
  frame(i: FrameInput, prof: ProfilerFrames | null): CapResult {
    if (!this.on) return CAP_NONE;
    const k = this.n;
    if (k >= this.t.length) return CAP_FRAMES;
    if (this.gapPending) { if (k > 0) this.flags[k - 1] |= F.gap; this.gapPending = false; }
    const t = i.time - this.t0;
    this.t[k] = t;
    this.st[k] = i.start === i.start ? i.start - this.t0 : NaN;
    this.qCall[k] = NaN; this.qDone[k] = NaN; this.qState[k] = Q_NONE;
    this.cpu[k] = i.cpuMs; this.upd[k] = i.updateMs; this.ren[k] = i.renderMs; this.def[k] = i.deferredMs;
    this.state[k] = i.state;
    let fl = i.flags & 0xffff;
    if (this.markPending) { fl |= F.mark; this.markPending = false; }
    const drew = (fl & F.rendered) !== 0;
    this.frameId[k] = drew ? i.frameId : -1;
    this.draws[k] = drew ? i.draws : 0; this.tris[k] = drew ? i.tris : 0; this.passes[k] = drew ? i.passes : 0;
    const p = this.prev, s = this.seen;
    this.dTex[k] = delta(i.textures, p.textures); if (i.textures >= 0) s.textures = true; p.textures = i.textures;
    this.dGeo[k] = delta(i.geometries, p.geometries); if (i.geometries >= 0) s.geometries = true; p.geometries = i.geometries;
    this.dProg[k] = delta(i.programs, p.programs); if (i.programs >= 0) s.programs = true; p.programs = i.programs;
    this.dNode[k] = delta(i.nodes, p.nodes); if (i.nodes >= 0) s.nodes = true; p.nodes = i.nodes;
    this.dPipe[k] = delta(i.pipelines, p.pipelines); if (i.pipelines >= 0) s.pipelines = true; p.pipelines = i.pipelines;
    this.dUni[k] = delta(i.uniformWrites, p.uniformWrites); this.dUniSkip[k] = delta(i.uniformWritesSkipped, p.uniformWritesSkipped);
    if (i.uniformWrites >= 0) s.uniformWrites = true;
    p.uniformWrites = i.uniformWrites; p.uniformWritesSkipped = i.uniformWritesSkipped;
    this.culled[k] = i.culled; if (i.culled >= 0) s.culled = true;
    this.enemies[k] = Math.min(65535, Math.max(0, i.enemies));
    this.yaw[k] = i.yaw; this.pitch[k] = i.pitch;
    if (i.fuOn) s.firstUse = true;
    const c16 = (v: number) => (v > 65535 ? 65535 : v < 0 ? 0 : v);
    this.fuBuilds[k] = c16(i.nodeBuilds); this.fuBuildMs[k] = i.nodeBuildMs; this.fuAsync[k] = c16(i.asyncBuilds);
    this.fuPipes[k] = c16(i.pipelinesCreated); this.fuPipeMs[k] = i.pipelineMs; this.fuProgs[k] = c16(i.programsCreated); this.fuProgMs[k] = i.programMs;
    // the profiler's newest slot is this frame's when its head moved since the previous sample (it records only frames in which
    // the world updated); profHead = -1: no baseline yet (the profiler was off), so this frame only sets it
    const o = k * SPAN_COUNT;
    let sampled = false;
    if (prof && prof.on) {
      if (this.profHead >= 0 && prof.head !== this.profHead) {
        const src = ((prof.head - 1 + prof.capacity) % prof.capacity) * SPAN_COUNT;
        for (let j = 0; j < SPAN_COUNT; j++) { this.spanMs[o + j] = prof.ms[src + j]; this.spanCalls[o + j] = prof.calls[src + j]; }
        sampled = true;
      }
      this.profHead = prof.head;
    } else this.profHead = -1;
    if (sampled) { fl |= F.spans; s.spans = true; } else for (let j = 0; j < SPAN_COUNT; j++) { this.spanMs[o + j] = 0; this.spanCalls[o + j] = 0; }
    this.flags[k] = fl;
    // camera pose at a bounded cadence (the per-frame yaw / pitch above carry the turns)
    if (t - this.lastCam >= this.caps.cameraEveryMs) {
      this.lastCam = t;
      const c = this.camHead, C = this.camT.length;
      this.camT[c] = t; this.camX[c] = i.x; this.camY[c] = i.y; this.camZ[c] = i.z; this.camS[c] = Math.max(-128, Math.min(127, i.storey | 0));
      this.camHead = (c + 1) % C;
      if (this.camN < C) this.camN++; else this.camDropped++;
    }
    this.n = k + 1;
    if (this.n >= this.t.length) return CAP_FRAMES;
    if (t >= this.caps.durationMs) return CAP_DURATION;
    return CAP_NONE;
  }

  /** The page went hidden: the interval in progress becomes a gap once frames resume. */
  markGap(): void {
    if (this.on) this.gapPending = true;
  }

  /** A user mark (the mark key): flags the next frame and records a 'mark' event. Returns the mark's number (0 when not recording). */
  mark(now: number): number {
    if (!this.on) return 0;
    this.markPending = true;
    if (this.marks.length >= this.caps.marks) { this.marksDropped++; return 0; }
    this.marks.push(now - this.t0);
    this.event(now, 'mark', null, {n: this.marks.length, label: 'stutter'});
    return this.marks.length;
  }

  /** A timestamped event (`now` = performance.now() at its END when `dur` is known, else its moment). Bounded; drops the oldest. */
  event(now: number, kind: string, dur: number | null, data: Record<string, unknown> | null = null): void {
    if (!this.on) return;
    const t = (dur !== null && Number.isFinite(dur) ? now - dur : now) - this.t0;
    const rec: EventRec = {t, dur: dur !== null && Number.isFinite(dur) ? dur : null, kind, data};
    const cap = Math.max(1, this.caps.events);
    if (this.events.length < cap) this.events.push(rec);
    else { this.events[this.evHead] = rec; this.evHead = (this.evHead + 1) % cap; this.eventsDropped++; }
    let tot = this.eventTotals.get(kind);
    if (!tot) this.eventTotals.set(kind, (tot = {count: 0, ms: 0, maxMs: 0}));
    tot.count++;
    if (rec.dur !== null) { tot.ms += rec.dur; if (rec.dur > tot.maxMs) tot.maxMs = rec.dur; }
  }

  /** A long animation frame / long task; when full, the shortest kept entry is replaced (the worst are kept). */
  longFrame(e: LongFrameEntry): void {
    if (!this.on) return;
    this.longFramesSeen++;
    const cap = Math.max(1, this.caps.longFrames);
    if (this.longFrames.length < cap) { this.longFrames.push(e); return; }
    let min = 0;
    for (let j = 1; j < this.longFrames.length; j++) if (this.longFrames[j].duration < this.longFrames[min].duration) min = j;
    this.longFramesDropped++;
    if (e.duration > this.longFrames[min].duration) this.longFrames[min] = e;
  }

  /** A completed resource fetch (Resource Timing). Bounded ring (oldest dropped); per-category totals are never dropped. */
  resource(e: ResourceEntry): void {
    if (!this.on) return;
    const cap = Math.max(1, this.caps.resources);
    if (this.resources.length < cap) this.resources.push(e);
    else { this.resources[this.resHead] = e; this.resHead = (this.resHead + 1) % cap; this.resourcesDropped++; }
    let tot = this.resourceTotals.get(e.category);
    if (!tot) this.resourceTotals.set(e.category, (tot = {count: 0, cacheHits: 0, transferBytes: 0, decodedBytes: 0}));
    tot.count++;
    if (e.cache === 'hit') tot.cacheHits++;
    tot.transferBytes += e.transferBytes ?? 0;
    tot.decodedBytes += e.decodedBytes ?? 0;
  }

  /** A JS heap sample (performance.memory; approximate). */
  heap(now: number, used: number, total: number | null, limit: number | null): void {
    if (!this.on) return;
    if (this.heapRows.length >= this.caps.heap) { this.heapRows.shift(); this.heapDropped++; }
    this.heapRows.push([now - this.t0, used, total, limit]);
  }

  /** The level / station the capture is in from `now` on (start, and every level build). */
  world(now: number, seg: Omit<WorldSegment, 't'>): void {
    if (!this.on) return;
    if (this.worlds.length >= this.caps.worlds) { this.worlds.shift(); this.worldsDropped++; }
    this.worlds.push({warmups: [], controlT: null, ...seg, t: now - this.t0});
  }

  /** A warm-up / background compile for the current level (newest segment). */
  segmentWarmup(w: Record<string, unknown>): void {
    const seg = this.worlds[this.worlds.length - 1];
    if (!this.on || !seg) return;
    if ((seg.warmups ??= []).length < 16) seg.warmups.push(w);
  }

  /** The player has control again in the current level (newest segment), at `now`. */
  segmentControl(now: number): void {
    const seg = this.worlds[this.worlds.length - 1];
    if (!this.on || !seg || (seg.controlT !== null && seg.controlT !== undefined)) return;
    seg.controlT = now - this.t0;
  }

  /** An asynchronous GPU time for the drawn frame `frameId` (debug/gpuTimer.ts); false when that frame is not (recently) recorded. */
  gpuResult(frameId: number, ms: number): boolean {
    if (!(frameId >= 0) || !Number.isFinite(ms) || this.n === 0) return false;
    for (let k = this.n - 1, stop = Math.max(0, this.n - 600); k >= stop; k--) {
      const f = this.frameId[k];
      if (f === frameId) { this.gpu[k] = ms; this.seen.gpu = true; return true; }
      if (f >= 0 && f < frameId) return false;
    }
    return false;
  }

  // --- revision 2: GPU-queue completion probes (the hooks issue them; this only stores) ---

  /**
   * A queue probe was issued for the newest recorded frame at `now` (performance.now(); right after the game's frame callback and
   * its submissions). Returns its frame index (-1: not recording / no frame). `capped`: not issued (too many in flight).
   */
  queueIssued(now: number, capped = false): number {
    const k = this.n - 1;
    if (!this.on || k < 0) return -1;
    if (capped) { this.qState[k] = Q_CAPPED; return k; }
    this.qCall[k] = now - this.t0;
    this.qState[k] = Q_PENDING;
    return k;
  }

  /** The probe of frame `k` (issued in capture `gen`) resolved (ok) or failed at `now`; ignored unless it is still this capture's and pending. */
  queueSettled(gen: number, k: number, now: number, ok: boolean): boolean {
    if (gen !== this.gen || !this.on || !(k >= 0 && k < this.n) || this.qState[k] !== Q_PENDING) return false;
    if (ok) { this.qDone[k] = now - this.t0; this.qState[k] = Q_RESOLVED; } else this.qState[k] = Q_ERROR;
    return true;
  }

  /** Queue probe states over the recorded frames (report / UI). */
  queueCounts(): Record<(typeof QUEUE_STATES)[number], number> {
    const c = {none: 0, pending: 0, resolved: 0, capped: 0, error: 0, cancelled: 0};
    for (let k = 0; k < this.n; k++) c[QUEUE_STATES[this.qState[k]] ?? 'none']++;
    return c;
  }

  // --- revision 2: first-use identity ---

  /** A synchronous first-use node build of the frame being prepared (index = the next sample). Bounded: the most expensive are kept. */
  firstUseBuild(now: number, ms: number, id: Omit<FirstUseBuild, 'frame' | 't' | 'ms'>): void {
    if (!this.on) return;
    this.fuListSeen++;
    const e: FirstUseBuild = {frame: this.n, t: now - this.t0, ms, ...id};
    const cap = Math.max(0, Math.floor(this.caps.firstUseBuilds));
    if (this.fuList.length < cap) { this.fuList.push(e); return; }
    this.fuListDropped++;
    let min = -1;
    for (let j = 0; j < this.fuList.length; j++) if (min < 0 || this.fuList[j].ms < this.fuList[min].ms) min = j;
    if (min >= 0 && e.ms > this.fuList[min].ms) this.fuList[min] = e;
  }

  /**
   * (schemaMinor 3) A new render pipeline request of the frame being prepared (index = the next sample), at `now`; `ms` = its CPU
   * ms inside a synchronous render, null outside one. Bounded: when full, the kept entry with the lowest rank (in-render ms;
   * asynchronous = -1) is replaced by a strictly higher-ranked one — the most expensive in-render requests are kept, asynchronous
   * requests only first-come while there is room.
   */
  firstUsePipeline(now: number, ms: number | null, id: Omit<FirstUsePipeline, 'frame' | 't' | 'ms'>): void {
    if (!this.on) return;
    this.fpListSeen++;
    const e: FirstUsePipeline = {frame: this.n, t: now - this.t0, ms: ms !== null && Number.isFinite(ms) ? ms : null, ...id};
    const list = this.fpList, cap = Math.max(0, Math.floor(this.caps.firstUsePipelines));
    if (list.length < cap) { list.push(e); return; }
    this.fpListDropped++;
    const rank = (x: FirstUsePipeline) => (x.ms === null ? -1 : x.ms);
    let min = -1;
    for (let j = 0; j < list.length; j++) if (min < 0 || rank(list[j]) < rank(list[min])) min = j;
    if (min >= 0 && rank(e) > rank(list[min])) list[min] = e;
  }

  /** Bounded-memory footprint of the capture arrays (bytes; 0 before the first start). */
  bytes(): number {
    if (!this.allocated) return 0;
    const N = this.t.length;
    return N * (8 + 4 * 5 + 1 + 2 + 8 + 4 + 4 + 2 + 2 * 5 + 4 + 2 + 4 + 4 + 2 * 4 + 4 * 3 + 8 * 3 + 1) + N * SPAN_COUNT * 6 + this.camT.length * (8 + 12 + 1);
  }

  // ==== read-out ===================================================================================================================

  /** Report JSON text, synchronously (tests / QA). */
  serializeSync(meta: ReportMeta): string {
    const g = this.build(meta);
    for (;;) { const r = g.next(); if (r.done) return r.value.join(''); }
  }

  /**
   * Report JSON as text parts, giving the main thread back (`yieldFn`) whenever a run of steps has taken `budgetMs` — never one
   * long task (the game keeps rendering while a report is prepared after a key / auto stop during play).
   */
  async serialize(meta: ReportMeta, yieldFn: () => Promise<void>, budgetMs = 4): Promise<string[]> {
    const g = this.build(meta);
    const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    let t = clock();
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
      if (clock() - t >= budgetMs) { await yieldFn(); t = clock(); }
    }
  }

  /** The report built step by step (each `yield` is a point where the caller may give the main thread back). */
  private *build(meta: ReportMeta): Generator<void, string[], void> {
    const n = this.n, caps = this.caps;
    // --- derived per-frame values ---
    // (the heavy per-frame loops live in plain methods — loops inside a generator run unoptimized — called over ranges, so
    // every step between two yields stays a few ms)
    const RANGE = 4096;
    const interval = new Float64Array(n), cat = new Uint8Array(n), yawRate = new Float32Array(n);
    let gapCount = 0;
    for (let k0 = 0; k0 < n; k0 += RANGE) { gapCount += this.deriveRange(k0, Math.min(n, k0 + RANGE), interval, cat); yield; }
    this.yawRates(yawRate);
    yield;
    // --- distributions (each one sort of at most caps.frames values: one step) ---
    const scratch = new Float64Array(n);
    const distOf = (pick: (k: number) => boolean, val: (k: number) => number): Dist => {
      let m = 0;
      for (let k = 0; k < n; k++) { if (!pick(k)) continue; const v = val(k); if (v === v) scratch[m++] = v; }
      return distribution(scratch, m);
    };
    const gameplay = (k: number) => cat[k] === C_GAMEPLAY && interval[k] === interval[k];
    const summary: Record<string, unknown> = {};
    const gp: Record<string, unknown> = {note: 'state playing, no lifecycle transition / state change / warm-up / hidden tab / gap / focus loss in the frame; interval = rAF to rAF'};
    gp.interval = distOf(gameplay, k => interval[k]); yield;
    gp.cpu = distOf(gameplay, k => this.cpu[k]); yield;
    gp.update = distOf(gameplay, k => this.upd[k]); yield;
    gp.renderSubmit = distOf(gameplay, k => this.ren[k]); yield;
    gp.deferred = distOf(gameplay, k => this.def[k]); yield;
    gp.gpu = this.seen.gpu ? distOf(k => gameplay(k) && this.gpu[k] === this.gpu[k], k => this.gpu[k]) : null;
    /** Frames matching `pick` and the sum of their intervals (a plain closure: optimizable, unlike a loop in this generator). */
    const countWhere = (pick: (k: number) => boolean): [number, number] => {
      let frames = 0, ms = 0;
      for (let k = 0; k < n; k++) if (pick(k)) { frames++; if (interval[k] === interval[k]) ms += interval[k]; }
      return [frames, ms];
    };
    gp.timeMs = r2(countWhere(gameplay)[1]);
    summary.gameplay = gp;
    yield;
    const byCategory: Record<string, unknown> = {};
    for (let c = 0; c < CATEGORIES.length; c++) {
      const [frames, ms] = countWhere(k => cat[k] === c);
      if (!frames) continue;
      const d = c === C_HIDDEN ? null : distOf(k => cat[k] === c && interval[k] === interval[k], k => interval[k]);
      byCategory[CATEGORIES[c]] = {frames, timeMs: r2(ms), interval: d};
      yield;
    }
    summary.byCategory = byCategory;
    const byState: Record<string, number> = {};
    const stateN = new Uint32Array(STATE_NAMES.length);
    ((st: Uint8Array) => { for (let k = 0; k < n; k++) if (st[k] < stateN.length) stateN[st[k]]++; })(this.state);
    STATE_NAMES.forEach((nm, c) => { if (stateN[c]) byState[nm] = stateN[c]; });
    summary.framesByState = byState;
    summary.gaps = gapCount;
    yield;
    // --- spans over gameplay frames with a profiler sample (one pass for the sums, then one sort per span) ---
    const spanNames = meta.spanNames.length === SPAN_COUNT ? meta.spanNames : Array.from({length: SPAN_COUNT}, (_, j) => meta.spanNames[j] ?? `span${j}`);
    const withSpans = (k: number) => gameplay(k) && (this.flags[k] & F.spans) !== 0;
    const callSum = new Float64Array(SPAN_COUNT), anyN = new Uint32Array(SPAN_COUNT), spikeSum = new Float64Array(SPAN_COUNT), spanN = new Uint32Array(2);
    for (let k0 = 0; k0 < n; k0 += RANGE) { this.spanSums(k0, Math.min(n, k0 + RANGE), interval, cat, callSum, anyN, spikeSum, spanN); yield; }
    const spanFrames = spanN[0], spikeSpanFrames = spanN[1];
    const spans: Record<string, unknown>[] = [];
    for (let j = 0; j < SPAN_COUNT; j++) {
      if (!anyN[j]) continue;
      const d = distOf(withSpans, k => this.spanMs[k * SPAN_COUNT + j]);
      spans.push({name: spanNames[j], parent: PARENT[j] >= 0 ? spanNames[PARENT[j]] : null, mean: d.mean, p95: d.p95, p99: d.p99, max: d.max,
        callsPerFrame: spanFrames ? r2(callSum[j] / spanFrames) : 0, spikeMean: spikeSpanFrames ? r2(spikeSum[j] / spikeSpanFrames) : null});
      yield;
    }
    summary.spans = {frames: spanFrames, spikeFrames: spikeSpanFrames, note: 'ms per gameplay frame (inclusive: a nested span is also inside its parent); spikeMean = mean over gameplay frames with interval > 33.3 ms', list: spans};
    yield;
    // --- (revision 2) tail / frame pacing ---
    const env = meta.environment as {refresh?: {hz?: unknown; measured?: unknown}} | undefined;
    const hintHz = env?.refresh?.measured === true && typeof env.refresh.hz === 'number' ? env.refresh.hz : null;
    summary.tail = this.tailSummary(interval, cat, hintHz);
    yield;
    // --- correlation counts: what the gameplay spikes coincide with (base rates over all gameplay frames beside them) ---
    const CORR = ['turning', 'newNodeBuilds', 'newPipelines', 'newPrograms', 'newTextures', 'newGeometries', 'cullingChanged', 'pathSearches', 'riding', 'mainThreadOutsideGame', 'firstUse'] as const;
    const cf = new Uint32Array(CORR.length), cs = new Uint32Array(CORR.length), cn = new Uint32Array(2);
    for (let k0 = 0; k0 < n; k0 += RANGE) { this.corrRange(k0, Math.min(n, k0 + RANGE), interval, cat, yawRate, cf, cs, cn); yield; }
    const corrFrames = cn[0], corrSpikes = cn[1];
    const with_: Record<string, {frames: number; spikes: number}> = {};
    CORR.forEach((key, c) => { with_[key] = {frames: cf[c], spikes: cs[c]}; });
    summary.correlation = {note: `gameplay frames (frames) and gameplay spikes over 33.3 ms (spikes) that coincide with each condition; turning = yaw rate over ${TURN_DEG_S} deg per s in the preceding ${TURN_WINDOW_MS} ms; new* = net renderer counter increase in that frame; pathSearches = the profiler counted A* searches; firstUse = a TSL node build / pipeline / shader program was created inside that frame's renders; mainThreadOutsideGame = interval minus game CPU over 33.3 ms (browser, GC, GPU wait or other tasks)`,
      frames: corrFrames, spikes: corrSpikes, with: with_};
    yield;
    // --- first use: preparation work per level, before vs after the player had control (does the warm-up cover gameplay?) ---
    const fuSegs: Record<string, unknown>[] = [];
    const fuTotal = this.fuAcc();
    for (let s = 0, k = 0; s < this.worlds.length; s++) {
      const seg = this.worlds[s], tEnd = s + 1 < this.worlds.length ? this.worlds[s + 1].t : Infinity;
      while (k < n && this.t[k] < seg.t) k++;
      let k1 = k;
      while (k1 < n && this.t[k1] < tEnd) k1++;
      const ctl = seg.controlT ?? null;
      const before = this.fuAcc(), after = this.fuAcc();
      this.fuRange(k, k1, ctl, interval, cat, before, after);
      this.fuRange(k, k1, ctl, interval, cat, null, fuTotal);
      fuSegs.push({t: r2(seg.t), level: seg.level, station: seg.station, route: seg.route ?? null, warmups: seg.warmups ?? [],
        controlReturnedT: ctl === null ? null : r2(ctl), controlAfterMs: ctl === null ? null : r2(ctl - seg.t),
        beforeControl: this.fuOut(before), afterControl: this.fuOut(after)});
      k = k1;
      yield;
    }
    summary.firstUse = {
      available: this.seen.firstUse,
      note: 'three r186 first-use preparation, counted per frame: nodeBuilds = TSL node builds completed inside synchronous renders (nodeBuildMs = their CPU ms), asyncBuilds = node builds completed outside a render (compileAsync / warm-up), pipelines = render pipelines requested (pipelineMs = CPU ms of the requests inside renders), programs = shader programs created (programMs likewise). afterControl = frames from the moment the player had control again (gameplay and transition frames); work there is first-use preparation the warm-up did not cover. The GPU / driver compile time is NOT observable: CPU-side spans only.',
      gameplayAfterControl: this.fuOut(fuTotal),
      segments: fuSegs,
      // (revision 2) which material / object each synchronous build was for (sanitized labels; the most expensive kept)
      builds: {seen: this.fuListSeen, kept: this.fuList.length, dropped: this.fuListDropped,
        note: 'synchronous (in-render) TSL node builds with the rendered object / material labels (game-relative names, sanitized; null = anonymous). A shadow-pass build names the pass material and the object\'s own material. Asynchronous builds (compileAsync / warm-up) are counted only (asyncBuilds).',
        list: this.fuList.slice().sort((a, b) => a.t - b.t).map(e => ({...e, t: r2(e.t), ms: r2(e.ms)}))},
      // (schemaMinor 3) which object / material / pass each NEW render pipeline request was for (a pipeline cache miss)
      pipelines: {seen: this.fpListSeen, kept: this.fpList.length, dropped: this.fpListDropped,
        note: 'new render pipeline requests (pipeline cache misses), in render (ms = CPU of the request) or async (compileAsync / warm-up; ms null), with the same sanitized object / material labels as builds. withBuild = a node build for the same render object preceded it in this frame sample (false in render: the material build was cached, so the miss is a new target / sample count / material state / object flag combination: see target, materialState, objectFlags; async builds can span frame samples, so there false is not proof of a cached build); newPrograms = vertex / fragment shader programs created for it. Bounded: the most expensive in-render requests are kept, async requests first-come while there is room. CPU-side request identity only: the GPU / driver compile time is not observable. null = unknown.',
        list: this.fpList.slice().sort((a, b) => a.t - b.t).map(e => ({...e, t: r2(e.t), ms: e.ms === null ? null : r2(e.ms)}))},
    };
    yield;
    // --- worst frames with timelines (bounded top-N selection, no full sort) ---
    const evs = this.eventsInOrder();
    const lfs = this.longFrames.slice().sort((a, b) => a.start - b.start);
    yield;
    const topN = (pick: (k: number) => boolean, by: (k: number) => number, count: number): number[] => {
      const top: number[] = [];
      for (let k = 0; k < n; k++) {
        if (!pick(k)) continue;
        const v = by(k);
        if (top.length === count && v <= by(top[count - 1])) continue;
        let at = top.length;
        while (at > 0 && by(top[at - 1]) < v) at--;
        top.splice(at, 0, k);
        if (top.length > count) top.pop();
      }
      return top;
    };
    const detail = function* (this: PerfCapture, idx: number[]): Generator<void, unknown[], void> {
      const out: unknown[] = [];
      for (const k of idx) { out.push(this.frameDetail(k, interval, cat, yawRate, evs, lfs, spanNames)); if (out.length % 6 === 0) yield; }
      return out;
    };
    const wGame = topN(gameplay, k => interval[k], caps.worst); yield;
    const wCpu = topN(gameplay, k => this.cpu[k], Math.ceil(caps.worst / 2)); yield;
    const wAny = topN(k => cat[k] !== C_HIDDEN && cat[k] !== C_GAMEPLAY && interval[k] === interval[k], k => interval[k], Math.ceil(caps.worst / 2)); yield;
    const worstOut = {
      note: 'the slowest frames by interval (gameplay; then any non-hidden frame) and by game CPU, each with its spans, renderer counter changes, camera, the frames around it, and the events / long frames near it',
      gameplay: yield* detail.call(this, wGame),
      gameplayByCpu: yield* detail.call(this, wCpu),
      anyState: yield* detail.call(this, wAny),
    };
    yield;
    // --- spike detail: every nested span of the worst spike frames (gameplay / transition) ---
    // (revision 2: also every frame that missed a refresh or whose callback overran one — the tail summary's refresh)
    const tailRefresh = (summary.tail as {refreshMs?: number} | null)?.refreshMs ?? Infinity;
    const spikeIdx = ((): number[] => {
      const out: number[] = [];
      for (let k = 0; k < n; k++) {
        if (!((cat[k] === C_GAMEPLAY || cat[k] === C_TRANSITION) && (this.flags[k] & F.spans))) continue;
        if (interval[k] > 50 || this.cpu[k] > SPIKE_MS || interval[k] > 1.5 * tailRefresh || this.cpu[k] > tailRefresh) out.push(k);
      }
      return out;
    })();
    spikeIdx.sort((a, b) => interval[b] - interval[a] || this.cpu[b] - this.cpu[a]);
    const keptSpikes = spikeIdx.slice(0, caps.spikeDetail);
    const spikeDetail = {
      note: 'frames with interval > 50 ms, game CPU > 33.3 ms, (schema 1.2) an interval over 1.5 refreshes or game CPU over one refresh (summary.tail.refreshMs) — gameplay / transition, profiler sampled — worst first: ms in 0.01 ms units, calls = span entries (nested: calls, e.g. path searches); span order = spans.names',
      kept: keptSpikes.length, omitted: spikeIdx.length - keptSpikes.length,
      frames: keptSpikes.map(k => ({frame: k, intervalMs: r2(interval[k]), cpuMs: r2(this.cpu[k]),
        ms: Array.from(this.spanMs.subarray(k * SPAN_COUNT, (k + 1) * SPAN_COUNT), q100), calls: Array.from(this.spanCalls.subarray(k * SPAN_COUNT, (k + 1) * SPAN_COUNT))})),
    };
    yield;
    // --- marks: the worst frame and the stalls in the MARK_LOOKBACK_MS before each (players press the key seconds after the
    // stutter; schemaMinor 3 — was 2 s) ---
    const markRefresh = (summary.tail as {refreshMs?: number} | null)?.refreshMs ?? 1000 / 60;
    const marks = this.marks.map((mt, j) => this.markWindow(j, mt, interval, cat, markRefresh));
    yield;
    // --- assemble ---
    const parts: string[] = [];
    const put = (key: string, v: unknown, first = false) => { parts.push(`${first ? '' : ','}${JSON.stringify(key)}:${JSON.stringify(v)}`); };
    parts.push('{');
    put('schema', PERF_SCHEMA, true);
    put('schemaVersion', PERF_SCHEMA_VERSION);
    put('schemaMinor', PERF_SCHEMA_MINOR);
    put('about', 'Terminal State in-game performance recording. Frames: every rAF callback. Times in ms unless a unit says otherwise. See docs/performance-recorder.md.');
    put('privacy', PRIVACY_NOTE);
    put('build', meta.build);
    put('capture', {
      capturedAtUTC: meta.capturedAtUTC, endedAtUTC: meta.endedAtUTC, durationMs: r2(this.tEnd - this.t0), frames: n,
      termination: this.termination, stoppedBy: meta.stoppedBy ?? null, caps: {...caps},
      drops: {frames: 0, framesNote: 'frames are never dropped: the capture stops at the frame / duration cap', events: this.eventsDropped,
        longFrames: this.longFramesDropped, longFramesNote: 'when full, the shortest kept long frame is replaced (the worst are kept)',
        resources: this.resourcesDropped, camera: this.camDropped, heap: this.heapDropped, marks: this.marksDropped, worlds: this.worldsDropped,
        spikeDetail: spikeDetail.omitted, firstUseBuilds: this.fuListDropped, firstUseBuildsNote: 'when full, the cheapest kept build is replaced (the most expensive are kept)',
        firstUsePipelines: this.fpListDropped, firstUsePipelinesNote: 'when full, the lowest-ranked kept request is replaced by a more expensive in-render one (async requests rank lowest: first-come)',
        oldestDropped: true},
      overhead: meta.overhead ?? null,
      notes: meta.notes ?? [],
    });
    put('capabilities', meta.capabilities);
    put('environment', meta.environment);
    put('world', {segments: this.worlds});
    put('summary', summary);
    put('worst', worstOut);
    put('marks', marks);
    yield;
    // frames: columnar, quantized (one chunk per column)
    parts.push(',"frames":{');
    parts.push(`"count":${n},"stateNames":${JSON.stringify(STATE_NAMES)},"categories":${JSON.stringify(CATEGORIES)},"flagBits":${JSON.stringify(F)},"queueStates":${JSON.stringify(QUEUE_STATES)},`);
    parts.push(`"units":${JSON.stringify({
      t: '0.01 ms since capture start (rAF timestamp)', interval: '0.01 ms to the next rAF (null: the last frame)', cpu: '0.01 ms (game frame callback, main thread)',
      update: '0.01 ms (world update)', render: '0.01 ms (render submission: CPU encoding, not GPU execution)', deferred: '0.01 ms (deferred background chunks, part of cpu)',
      gpu: '0.01 ms (GPU render-pass time, timestamp queries; null = not measured)', state: 'index into stateNames', category: 'index into categories', flags: 'bitmask (flagBits)',
      draws: 'draw calls of the drawn frame (all passes; 0 = nothing drawn)', triangles: 'submitted triangles, all passes', passes: 'render passes',
      newTextures: 'net change of renderer.info.memory.textures since the previous frame', newGeometries: 'net change of renderer.info.memory.geometries',
      newPrograms: 'net change of renderer.info.memory.programs (shader programs)', newNodeBuilds: 'net change of three NodeManager.nodeBuilderCache (TSL material builds on the CPU)',
      newPipelines: 'net change of three Pipelines.caches (pipelines requested on the CPU; driver compile not observable)',
      culled: 'meshes the level culler currently hides (-1: no culler)', enemies: 'enemy actors in the level', yaw: '0.1 degree (player look)', pitch: '0.1 degree (player look)',
      nodeBuilds: 'TSL node builds completed inside synchronous renders since the previous frame (null: hooks unavailable)', nodeBuildMs: '0.01 ms CPU of those builds',
      asyncBuilds: 'node builds completed outside a render (compileAsync / warm-up)', pipelinesCreated: 'render pipelines requested (any path)',
      pipelineMs: '0.01 ms CPU of the pipeline requests inside renders (driver compile not observable)', programsCreated: 'shader programs created', programMs: '0.01 ms CPU of the program creation inside renders',
      start: '0.01 ms since capture start: performance.now() at the game rAF callback entry (main.ts; same timebase as t; null = not supplied)',
      startDelay: '0.01 ms: start - t (the callback began this long after its rAF timestamp; can be slightly negative where the browser\'s rAF timestamp is not the frame\'s begin time or its clock is coarse, e.g. Firefox ~1 ms)',
      gapBefore: '0.01 ms: start - (previous start + previous cpu): main-thread time between the previous game callback\'s end and this one\'s start, INCLUDING the normal wait for the next refresh',
      queueMs: '0.01 ms from the GPU-queue probe call (end of this game callback, after its submissions) to device.queue.onSubmittedWorkDone() resolving on the main thread (queued GPU work + main-thread scheduling; not GPU execution alone, not presentation); null unless resolved',
      queueDone: '0.01 ms since capture start when that probe resolved (null unless resolved)',
      queueState: 'index into queueStates (none = not probed: nothing drawn / unsupported backend; capped = too many probes in flight; cancelled = still pending at stop)',
      uniformWrites: '(schemaMinor 4) uniform-buffer uploads (device.queue.writeBuffer through three\'s binding update) issued since the previous frame (null: render/uploadDedupe.ts not installed: WebGL 2 / not initialized)',
      uniformWritesSkipped: '(schemaMinor 4) uniform-buffer uploads skipped since the previous frame because their bytes equalled the last upload to the same GPU buffer (render/uploadDedupe.ts)',
    })},`);
    parts.push('"columns":{');
    // one column = `"name":[v,v,…]`, written in chunks (a yield every CHUNK values; the parts are only ever concatenated)
    const CHUNK = 4096;
    const buf: (string | number)[] = new Array(CHUNK);
    const chunk = (k0: number, get: (k: number) => string | number): string => {
      const m = Math.min(CHUNK, n - k0);
      buf.length = m;
      for (let j = 0; j < m; j++) buf[j] = get(k0 + j);
      return buf.join(',');
    };
    const column = function* (head: string, get: (k: number) => string | number): Generator<void, void, void> {
      parts.push(head + '[');
      for (let k0 = 0; k0 < n; k0 += CHUNK) { parts.push((k0 ? ',' : '') + chunk(k0, get)); yield; }
      parts.push(']');
    };
    let firstCol = true;
    const col = (name: string, get: (k: number) => string | number) => { const h = `${firstCol ? '' : ','}${JSON.stringify(name)}:`; firstCol = false; return column(h, get); };
    const nn = (v: number) => (v === v ? q100(v) : 'null');
    yield* col('t', k => q100(this.t[k]));
    yield* col('interval', k => nn(interval[k]));
    yield* col('cpu', k => q100(this.cpu[k]));
    yield* col('update', k => q100(this.upd[k]));
    yield* col('render', k => q100(this.ren[k]));
    yield* col('deferred', k => q100(this.def[k]));
    yield* col('gpu', k => nn(this.gpu[k]));
    yield* col('state', k => this.state[k]);
    yield* col('category', k => cat[k]);
    yield* col('flags', k => this.flags[k]);
    yield* col('draws', k => this.draws[k]);
    yield* col('triangles', k => this.tris[k]);
    yield* col('passes', k => this.passes[k]);
    const dcol = (name: string, a: Int16Array, avail: boolean) => col(name, k => (avail ? a[k] : 'null'));
    yield* dcol('newTextures', this.dTex, this.seen.textures);
    yield* dcol('newGeometries', this.dGeo, this.seen.geometries);
    yield* dcol('newPrograms', this.dProg, this.seen.programs);
    yield* dcol('newNodeBuilds', this.dNode, this.seen.nodes);
    yield* dcol('newPipelines', this.dPipe, this.seen.pipelines);
    yield* col('culled', k => this.culled[k]);
    yield* col('enemies', k => this.enemies[k]);
    yield* col('yaw', k => Math.round(wrapDeg(this.yaw[k]) * 10));
    yield* col('pitch', k => Math.round(this.pitch[k] * 1800 / Math.PI));
    const fu = this.seen.firstUse;
    yield* col('nodeBuilds', k => (fu ? this.fuBuilds[k] : 'null'));
    yield* col('nodeBuildMs', k => (fu ? q100(this.fuBuildMs[k]) : 'null'));
    yield* col('asyncBuilds', k => (fu ? this.fuAsync[k] : 'null'));
    yield* col('pipelinesCreated', k => (fu ? this.fuPipes[k] : 'null'));
    yield* col('pipelineMs', k => (fu ? q100(this.fuPipeMs[k]) : 'null'));
    yield* col('programsCreated', k => (fu ? this.fuProgs[k] : 'null'));
    yield* col('programMs', k => (fu ? q100(this.fuProgMs[k]) : 'null'));
    // (revision 2) callback start / gaps and the GPU-queue completion probe
    yield* col('start', k => nn(this.st[k]));
    yield* col('startDelay', k => nn(this.st[k] - this.t[k]));
    yield* col('gapBefore', k => (k > 0 ? nn(this.st[k] - (this.st[k - 1] + this.cpu[k - 1])) : 'null'));
    yield* col('queueMs', k => (this.qState[k] === Q_RESOLVED ? nn(this.qDone[k] - this.qCall[k]) : 'null'));
    yield* col('queueDone', k => (this.qState[k] === Q_RESOLVED ? nn(this.qDone[k]) : 'null'));
    yield* col('queueState', k => this.qState[k]);
    yield* dcol('uniformWrites', this.dUni, this.seen.uniformWrites);
    yield* dcol('uniformWritesSkipped', this.dUniSkip, this.seen.uniformWrites);
    parts.push('}}');
    // spans: top-level laps per frame (0.01 ms; 0 = no profiler sample, see flags.spans) + names
    parts.push(`,"spans":{"names":${JSON.stringify(spanNames)},"parents":${JSON.stringify(PARENT.map(p => (p >= 0 ? spanNames[p] : null)))},`);
    parts.push('"unit":"0.01 ms","perFrameNote":"top-level laps of every frame the profiler sampled (flags.spans); nested spans: spikeDetail / worst","perFrame":{');
    let firstSpan = true;
    for (let j = 0; j < SPAN_COUNT; j++) {
      if (PARENT[j] !== -1) continue;
      const h = `${firstSpan ? '' : ','}${JSON.stringify(spanNames[j])}:`;
      firstSpan = false;
      yield* column(h, k => q100(this.spanMs[k * SPAN_COUNT + j]));
    }
    parts.push('}}');
    put('spikeDetail', spikeDetail);
    yield;
    // secondary buffers
    put('events', {count: evs.length, dropped: this.eventsDropped, note: 't = start (ms since capture start); dur = null when only the moment is known',
      totals: Object.fromEntries([...this.eventTotals].map(([k, v]) => [k, {count: v.count, ms: r2(v.ms), maxMs: r2(v.maxMs)}])),
      list: evs.map(e => ({t: r2(e.t), dur: e.dur === null ? null : r2(e.dur), kind: e.kind, ...(e.data ?? {})}))});
    yield;
    put('longFrames', {seen: this.longFramesSeen, kept: lfs.length, dropped: this.longFramesDropped,
      list: lfs.map(e => ({t: r2(e.start - this.t0), duration: r2(e.duration), blocking: e.blocking === null ? null : r2(e.blocking), type: e.type,
        renderStart: e.renderStart === null ? null : r2(e.renderStart - this.t0), styleAndLayoutStart: e.styleAndLayoutStart === null ? null : r2(e.styleAndLayoutStart - this.t0),
        scripts: e.scripts}))});
    put('resources', {count: this.resources.length, dropped: this.resourcesDropped,
      totals: Object.fromEntries(this.resourceTotals),
      list: this.resourcesInOrder().map(e => ({t: r2(e.start - this.t0), duration: r2(e.duration), id: e.id, category: e.category, initiator: e.initiator,
        transferBytes: e.transferBytes, encodedBytes: e.encodedBytes, decodedBytes: e.decodedBytes, cache: e.cache}))});
    yield;
    const camRows: number[][] = [];
    for (let j = 0; j < this.camN; j++) {
      const c = (this.camHead - this.camN + j + this.camT.length) % this.camT.length;
      camRows.push([r2(this.camT[c]), r2(this.camX[c]), r2(this.camY[c]), r2(this.camZ[c]), this.camS[c]]);
    }
    put('camera', {everyMs: caps.cameraEveryMs, columns: ['t', 'x', 'y', 'z', 'storey'], rows: camRows, dropped: this.camDropped,
      note: 'player position (m, game world) at a bounded cadence; per-frame yaw / pitch are frames.columns.yaw / pitch'});
    put('heap', {columns: ['t', 'usedBytes', 'totalBytes', 'limitBytes'], rows: this.heapRows.map(r => [r2(r[0]), r[1], r[2], r[3]]), dropped: this.heapDropped,
      note: 'performance.memory (Chromium only, coarse / approximate); empty when unavailable'});
    parts.push('}');
    return parts;
  }

  /**
   * (Revision 2) Tail / frame-pacing summary of the gameplay frames: every interval classified by refresh multiple (missed = round(
   * interval / refresh) - 1: an exactly 33.3 ms interval at 60 Hz is ONE missed refresh, not "not over 33.3"), callback overruns (game
   * callback CPU over one refresh — the rAF timestamps are vsync-aligned, so an overrun need not lengthen any interval) and their
   * overlap with interval misses, stall events (union) per minute, the worst 1 s / 5 s windows, and — where recorded — the callback
   * start delays / gaps and queue completion after misses vs on-time frames. Descriptive, no pass / fail threshold.
   */
  private tailSummary(interval: Float64Array, cat: Uint8Array, hintHz: number | null): Record<string, unknown> | null {
    const n = this.n;
    const gp: number[] = [];
    for (let k = 0; k < n; k++) if (cat[k] === C_GAMEPLAY && interval[k] === interval[k]) gp.push(k);
    if (gp.length < 2) return null;
    const sorted = (a: number[]) => Float64Array.from(a).sort();
    const ivs = sorted(gp.map(k => interval[k]));
    const median = quantile(ivs, 0.5);
    const hz = hintHz ?? 0, measured = hz >= 20 && hz <= 500;
    const refreshMs = measured ? 1000 / hz : median;
    const missedOf = (k: number) => Math.max(0, Math.round(interval[k] / refreshMs) - 1);
    let onTime = 0, m1 = 0, m2 = 0, m3 = 0, missedRefreshes = 0, lostMs = 0, over = 0, overWithMiss = 0, timeMs = 0;
    const events: number[] = [];
    for (const k of gp) {
      const iv = interval[k], missed = missedOf(k), overrun = this.cpu[k] > refreshMs;
      timeMs += iv;
      if (missed === 0) onTime++; else if (missed === 1) m1++; else if (missed === 2) m2++; else m3++;
      if (missed > 0) { missedRefreshes += missed; lostMs += iv - refreshMs; }
      if (overrun) { over++; if (missed > 0) overWithMiss++; }
      if (missed > 0 || overrun) events.push(this.t[k]);
    }
    const misses = m1 + m2 + m3, minutes = timeMs / 60000;
    const perMin = (v: number) => (minutes > 0 ? r2(v / minutes) : null);
    const worst = (winMs: number) => {
      let best = 0, at = -1;
      for (let i = 0, j = 0; i < events.length; i++) {
        if (j < i) j = i;
        while (j < events.length && events[j] < events[i] + winMs) j++;
        if (j - i > best) { best = j - i; at = events[i]; }
      }
      return {events: best, t: at >= 0 ? r2(at) : null};
    };
    const stat = (a: number[]) => {
      if (!a.length) return null;
      const s = sorted(a);
      return {n: a.length, p50: r2(quantile(s, 0.5)), p95: r2(quantile(s, 0.95)), max: r2(s[s.length - 1])};
    };
    // callback start (where the main loop supplied it): this frame's delay after its rAF timestamp, the gap since the previous
    // callback's end, and the NEXT callback's values after a missed interval vs after an on-time one
    const sd: number[] = [], gb: number[] = [], sdMiss: number[] = [], gbMiss: number[] = [], sdOk: number[] = [], gbOk: number[] = [];
    let started = 0;
    for (const k of gp) {
      const s = this.st[k];
      if (s === s) { started++; sd.push(s - this.t[k]); if (k > 0 && this.st[k - 1] === this.st[k - 1]) gb.push(s - (this.st[k - 1] + this.cpu[k - 1])); }
      const j = k + 1;
      if (j < n && this.st[j] === this.st[j]) {
        const miss = missedOf(k) > 0;
        (miss ? sdMiss : sdOk).push(this.st[j] - this.t[j]);
        if (s === s) (miss ? gbMiss : gbOk).push(this.st[j] - (s + this.cpu[k]));
      }
    }
    // queue completion (resolved probes) of the frame whose interval missed vs on-time frames
    const q: number[] = [], qMiss: number[] = [], qOk: number[] = [];
    let qOver = 0;
    for (const k of gp) {
      if (this.qState[k] !== Q_RESOLVED) continue;
      const v = this.qDone[k] - this.qCall[k];
      q.push(v);
      if (v > refreshMs) qOver++;
      (missedOf(k) > 0 ? qMiss : qOk).push(v);
    }
    return {
      note: 'gameplay frames only (menus, pause, loading, warm-up, transitions, hidden-tab gaps and focus loss excluded). missed = round(interval / refreshMs) - 1 per interval (interval k = rAF k+1 - rAF k: its cause may be frame k\'s work, work between the callbacks, or the browser / GPU not being ready). An overrun = the game callback\'s CPU over one refresh; rAF timestamps are vsync-aligned, so an overrun need not lengthen an interval (the frame may still reach the screen late) and an interval miss need not have an overrun. stallEvents = frames with a missed interval OR an overrun, counted once. Clock: Chromium ~0.1 ms, Firefox ~1 ms resolution without cross-origin isolation.',
      refreshMs: r2(refreshMs), refreshSource: measured ? `display rate measured by the frame budget (${r2(hz)} Hz)` : 'median gameplay interval (no measured display rate)',
      frames: gp.length, timeMs: r2(timeMs),
      intervals: {onTime, missed1: m1, missed2: m2, missed3plus: m3, misses, missedRefreshes, lostMs: r2(lostMs),
        p99: r2(quantile(ivs, 0.99)), p999: r2(quantile(ivs, 0.999)), max: r2(ivs[ivs.length - 1])},
      overruns: {count: over, withIntervalMiss: overWithMiss, withoutIntervalMiss: over - overWithMiss},
      stallEvents: {count: misses + over - overWithMiss, intervalMissOnly: misses - overWithMiss, overrunOnly: over - overWithMiss, both: overWithMiss,
        perMinute: perMin(misses + over - overWithMiss), intervalMissesPerMinute: perMin(misses), overrunsPerMinute: perMin(over)},
      worstWindows: {'1s': worst(1000), '5s': worst(5000)},
      callbackStart: started ? {
        frames: started,
        note: 'startDelay = callback start - its rAF timestamp; gapBefore = callback start - (previous callback start + its game CPU): it includes the normal wait for the next refresh, so a large value alone is not proof of GC or a busy main thread. "afterMiss" = the callback right after a missed interval.',
        startDelay: stat(sd), gapBefore: stat(gb), afterMiss: {startDelay: stat(sdMiss), gapBefore: stat(gbMiss)}, afterOnTime: {startDelay: stat(sdOk), gapBefore: stat(gbOk)},
      } : null,
      queue: q.length ? {
        note: 'queueMs = from the probe call (end of the game callback, after its submissions) to device.queue.onSubmittedWorkDone() resolving ON THE MAIN THREAD: queued GPU work plus main-thread scheduling of the resolution — not GPU execution alone, not presentation',
        all: stat(q), overOneRefresh: qOver, missedFrames: stat(qMiss), onTimeFrames: stat(qOk),
      } : null,
    };
  }

  /**
   * (schemaMinor 3) Mark `j` at `mt` (ms since capture start): its lookback window [mt - MARK_LOOKBACK_MS, mt], clamped at the first
   * frame — the worst interval in it (any non-hidden category, as before) and the frames in it that missed a refresh (interval over
   * 1.5 x `refreshMs`) or overran one (game CPU over `refreshMs`), worst first (interval, then CPU), at most MARK_STALLS. Hidden /
   * gap frames are never stalls; paused / menu / loading frames are kept and tagged with their category and state. Indices only
   * while scanning (no frame objects); the list is built for the kept stalls.
   */
  private markWindow(j: number, mt: number, interval: Float64Array, cat: Uint8Array, refreshMs: number): Record<string, unknown> {
    const n = this.n;
    const from = mt - MARK_LOOKBACK_MS;
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.t[mid] < from) lo = mid + 1; else hi = mid; } // first frame in the window
    const iv = (k: number) => (interval[k] === interval[k] ? q100(interval[k]) : -1); // (ranked at the reported 0.01 ms)
    const worse = (a: number, b: number) => iv(a) > iv(b) || (iv(a) === iv(b) && this.cpu[a] > this.cpu[b]);
    const ivLimit = 1.5 * refreshMs;
    const top: number[] = [];
    let best = -1, stalls = 0;
    for (let k = lo; k < n && this.t[k] <= mt; k++) {
      if (cat[k] === C_HIDDEN) continue;
      const v = interval[k];
      if (v === v && (best < 0 || v > interval[best])) best = k;
      if (!((v === v && v > ivLimit) || this.cpu[k] > refreshMs)) continue;
      stalls++;
      if (top.length >= MARK_STALLS && !worse(k, top[top.length - 1])) continue;
      let at = top.length;
      while (at > 0 && worse(k, top[at - 1])) at--;
      top.splice(at, 0, k);
      if (top.length > MARK_STALLS) top.pop();
    }
    const fromT = Math.min(mt, Math.max(from, n > 0 ? this.t[0] : 0));
    return {n: j + 1, t: r2(mt), windowMs: MARK_LOOKBACK_MS, fromT: r2(fromT), refreshMs: r2(refreshMs),
      worstBefore: best >= 0 ? {frame: best, t: r2(this.t[best]), intervalMs: r2(interval[best]), cpuMs: r2(this.cpu[best]), category: CATEGORIES[cat[best]]} : null,
      stalls: top.map(k => ({frame: k, t: r2(this.t[k]), dtBeforeMark: r2(mt - this.t[k]), intervalMs: interval[k] === interval[k] ? r2(interval[k]) : null, cpuMs: r2(this.cpu[k]),
        category: CATEGORIES[cat[k]], state: STATE_NAMES[this.state[k]] ?? 'other'})),
      omittedStalls: stalls - top.length};
  }

  /** Frames [k0, k1): interval (to the next rAF) and category; returns the gaps among them. */
  private deriveRange(k0: number, k1: number, interval: Float64Array, cat: Uint8Array): number {
    const n = this.n;
    let gaps = 0;
    for (let k = k0; k < k1; k++) {
      const iv = k + 1 < n ? this.t[k + 1] - this.t[k] : NaN;
      interval[k] = iv;
      const fl = this.flags[k], st = this.state[k];
      const gap = (fl & (F.gap | F.hidden)) !== 0 || (iv === iv && iv - this.cpu[k] > GAP_MS);
      if (gap) gaps++;
      cat[k] = gap ? C_HIDDEN : fl & F.warming ? C_WARMUP : st === ST_LOADING ? C_LOADING : st === ST_TITLE ? C_MENU
        : st === ST_PLAYING ? (fl & (F.transition | F.stateChange) ? C_TRANSITION : fl & F.unfocused ? C_UNFOCUSED : C_GAMEPLAY) : C_MENU;
    }
    return gaps;
  }

  /** Yaw rate (deg/s) of every frame over the preceding TURN_WINDOW_MS (sliding window). */
  private yawRates(out: Float32Array): void {
    const n = this.n;
    for (let k = 0, j = 0; k < n; k++) {
      while (j < k && this.t[k] - this.t[j + 1] >= TURN_WINDOW_MS) j++;
      const dt = this.t[k] - this.t[j];
      out[k] = j < k && dt > 0 ? Math.abs(angleDelta(this.yaw[j], this.yaw[k])) * 180 / Math.PI / (dt / 1000) : 0;
    }
  }

  /** Span sums over the gameplay frames with a profiler sample in [k0, k1); counts[0] += frames, counts[1] += spike frames. */
  private spanSums(k0: number, k1: number, interval: Float64Array, cat: Uint8Array, callSum: Float64Array, anyN: Uint32Array, spikeSum: Float64Array, counts: Uint32Array): void {
    for (let k = k0; k < k1; k++) {
      if (cat[k] !== C_GAMEPLAY || interval[k] !== interval[k] || (this.flags[k] & F.spans) === 0) continue;
      counts[0]++;
      const spike = interval[k] > SPIKE_MS, o = k * SPAN_COUNT;
      if (spike) counts[1]++;
      for (let j = 0; j < SPAN_COUNT; j++) {
        const c = this.spanCalls[o + j], v = this.spanMs[o + j];
        callSum[j] += c;
        if (c > 0 || v > 0) anyN[j]++;
        if (spike) spikeSum[j] += v;
      }
    }
  }

  /** Correlation counts over the gameplay frames in [k0, k1) (condition c: cf[c] frames, cs[c] of them spikes; cn = frames, spikes). */
  private corrRange(k0: number, k1: number, interval: Float64Array, cat: Uint8Array, yawRate: Float32Array, cf: Uint32Array, cs: Uint32Array, cn: Uint32Array): void {
    for (let k = k0; k < k1; k++) {
      if (cat[k] !== C_GAMEPLAY || interval[k] !== interval[k]) continue;
      const spike = interval[k] > SPIKE_MS ? 1 : 0;
      cn[0]++; cn[1] += spike;
      const fl = this.flags[k];
      if (yawRate[k] > TURN_DEG_S) { cf[0]++; cs[0] += spike; }
      if (this.dNode[k] > 0) { cf[1]++; cs[1] += spike; }
      if (this.dPipe[k] > 0) { cf[2]++; cs[2] += spike; }
      if (this.dProg[k] > 0) { cf[3]++; cs[3] += spike; }
      if (this.dTex[k] > 0) { cf[4]++; cs[4] += spike; }
      if (this.dGeo[k] > 0) { cf[5]++; cs[5] += spike; }
      if (k > 0 && this.culled[k] >= 0 && this.culled[k - 1] >= 0 && this.culled[k] !== this.culled[k - 1]) { cf[6]++; cs[6] += spike; }
      if ((fl & F.spans) !== 0 && this.spanCalls[k * SPAN_COUNT + S.path] > 0) { cf[7]++; cs[7] += spike; }
      if ((fl & F.riding) !== 0) { cf[8]++; cs[8] += spike; }
      if (interval[k] - this.cpu[k] > SPIKE_MS) { cf[9]++; cs[9] += spike; }
      if (this.fuBuilds[k] > 0 || this.fuPipes[k] > 0 || this.fuProgs[k] > 0) { cf[10]++; cs[10] += spike; }
    }
  }

  private fuAcc() {
    return {frames: 0, nodeBuilds: 0, nodeBuildMs: 0, asyncBuilds: 0, pipelines: 0, pipelineMs: 0, programs: 0, programMs: 0, framesWithFirstUse: 0, spikesWithFirstUse: 0,
      netNodeBuilds: 0, netPipelines: 0, newTextures: 0, worst: [] as number[]};
  }

  /**
   * First-use sums of frames [k0, k1): frames before `ctl` (capture ms; null = never) go to `before` (null: skipped), the gameplay /
   * transition frames from it on to `after`; `after.worst` keeps the 5 frames with the most first-use CPU ms.
   */
  private fuRange(k0: number, k1: number, ctl: number | null, interval: Float64Array, cat: Uint8Array, before: ReturnType<PerfCapture['fuAcc']> | null, after: ReturnType<PerfCapture['fuAcc']>): void {
    const ms = (k: number) => this.fuBuildMs[k] + this.fuPipeMs[k] + this.fuProgMs[k];
    for (let k = k0; k < k1; k++) {
      const post = ctl !== null && this.t[k] >= ctl;
      if (post && cat[k] !== C_GAMEPLAY && cat[k] !== C_TRANSITION) continue;
      const a = post ? after : before;
      if (!a) continue;
      a.frames++;
      a.nodeBuilds += this.fuBuilds[k]; a.nodeBuildMs += this.fuBuildMs[k]; a.asyncBuilds += this.fuAsync[k];
      a.pipelines += this.fuPipes[k]; a.pipelineMs += this.fuPipeMs[k]; a.programs += this.fuProgs[k]; a.programMs += this.fuProgMs[k];
      if (this.dNode[k] > 0) a.netNodeBuilds += this.dNode[k];
      if (this.dPipe[k] > 0) a.netPipelines += this.dPipe[k];
      if (this.dTex[k] > 0) a.newTextures += this.dTex[k];
      if (this.fuBuilds[k] > 0 || this.fuPipes[k] > 0 || this.fuProgs[k] > 0) {
        a.framesWithFirstUse++;
        if (interval[k] > SPIKE_MS) a.spikesWithFirstUse++;
        if (post) {
          const w = a.worst, v = ms(k);
          if (w.length < 5 || v > ms(w[w.length - 1])) { w.push(k); w.sort((x, y) => ms(y) - ms(x)); if (w.length > 5) w.pop(); }
        }
      }
    }
  }

  private fuOut(a: ReturnType<PerfCapture['fuAcc']>): Record<string, unknown> {
    return {frames: a.frames, nodeBuilds: a.nodeBuilds, nodeBuildMs: r2(a.nodeBuildMs), asyncBuilds: a.asyncBuilds, pipelines: a.pipelines, pipelineMs: r2(a.pipelineMs),
      programs: a.programs, programMs: r2(a.programMs), framesWithFirstUse: a.framesWithFirstUse, spikesWithFirstUse: a.spikesWithFirstUse,
      netNodeBuilds: a.netNodeBuilds, netPipelines: a.netPipelines, newTextures: a.newTextures,
      worst: a.worst.map(k => ({frame: k, t: r2(this.t[k]), intervalMs: k + 1 < this.n ? r2(this.t[k + 1] - this.t[k]) : null, cpuMs: r2(this.cpu[k]),
        nodeBuilds: this.fuBuilds[k], nodeBuildMs: r2(this.fuBuildMs[k]), pipelines: this.fuPipes[k], pipelineMs: r2(this.fuPipeMs[k]), programs: this.fuProgs[k], programMs: r2(this.fuProgMs[k])}))};
  }

  /** The kept events by start time (recorded at their end, so the ring order is not time order). */
  private eventsInOrder(): EventRec[] {
    const e = this.events;
    return (this.eventsDropped > 0 ? [...e.slice(this.evHead), ...e.slice(0, this.evHead)] : e.slice()).sort((a, b) => a.t - b.t);
  }

  private resourcesInOrder(): ResourceEntry[] {
    const e = this.resources;
    return this.resourcesDropped > 0 ? [...e.slice(this.resHead), ...e.slice(0, this.resHead)] : e.slice();
  }

  /** One frame's full timeline entry (worst lists). */
  private frameDetail(k: number, interval: Float64Array, cat: Uint8Array, yawRate: Float32Array, evs: EventRec[], lfs: LongFrameEntry[], names: string[]) {
    const n = this.n, t = this.t[k], iv = interval[k];
    const o = k * SPAN_COUNT;
    let spans: unknown = null;
    if (this.flags[k] & F.spans) {
      const items: {name: string; ms: number; calls: number}[] = [];
      for (let j = 0; j < SPAN_COUNT; j++) {
        let v = this.spanMs[o + j];
        if (j === S.ai) v -= this.spanMs[o + S.vocal] + this.spanMs[o + S.brain] + this.spanMs[o + S.motor] + this.spanMs[o + S.anim];
        else if (j === S.brain) v -= this.spanMs[o + S.path];
        else if (j === S.hooks) { for (let h = S.hook0; h < SPAN_COUNT; h++) if (isHookSpan(h)) v -= this.spanMs[o + h]; }
        else if (j === S.weapon) v -= this.spanMs[o + S.fire] + this.spanMs[o + S.melee]; // (the shot / hit spans run inside those)
        if (v > 0.005) items.push({name: j === S.ai ? 'ai (rest)' : j === S.brain ? 'ai.brain (excl. path)' : j === S.hooks ? 'hooks (rest)' : j === S.weapon ? 'weapon (rest)' : names[j], ms: r2(v), calls: this.spanCalls[o + j]});
      }
      items.sort((a, b) => b.ms - a.ms);
      // (revision 2) the shot / hit path of this frame, every nested span (inclusive ms; parents in spans.parents)
      const hit: Record<string, {ms: number; calls: number}> = {};
      for (let j = S.fire; j < SPAN_COUNT; j++) if (this.spanCalls[o + j] > 0) hit[names[j]] = {ms: r2(this.spanMs[o + j]), calls: this.spanCalls[o + j]};
      spans = {dominant: items.slice(0, 6), pathSearches: this.spanCalls[o + S.path], brainUpdates: this.spanCalls[o + S.brain], hitPath: Object.keys(hit).length ? hit : null};
    }
    // camera pose: the newest cadence sample at or before the frame
    let pose: number[] | null = null;
    for (let j = this.camN - 1; j >= 0; j--) {
      const c = (this.camHead - this.camN + j + this.camT.length) % this.camT.length;
      if (this.camT[c] <= t) { pose = [r2(this.camX[c]), r2(this.camY[c]), r2(this.camZ[c]), this.camS[c], r2(t - this.camT[c])]; break; }
    }
    const lo = t - 1000, hi = t + (iv === iv ? iv : 0) + 50;
    const near = evs.filter(e => e.t <= hi && (e.dur !== null ? e.t + e.dur : e.t) >= lo)
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t)).slice(0, 16).sort((a, b) => a.t - b.t)
      .map(e => ({dt: r2(e.t - t), dur: e.dur === null ? null : r2(e.dur), kind: e.kind, ...(e.data ?? {})}));
    const absLo = this.t0 + t - 50, absHi = this.t0 + hi;
    const longs = lfs.filter(e => e.start <= absHi && e.start + e.duration >= absLo).slice(0, 4)
      .map(e => ({dt: r2(e.start - this.t0 - t), duration: r2(e.duration), blocking: e.blocking === null ? null : r2(e.blocking), scripts: e.scripts.slice(0, 2)}));
    const nul = (v: number) => (v === v ? r2(v) : null);
    const delayOf = (j: number) => this.st[j] - this.t[j];
    const gapOf = (j: number) => (j > 0 ? this.st[j] - (this.st[j - 1] + this.cpu[j - 1]) : NaN);
    const queueOf = (j: number) => (this.qState[j] === Q_RESOLVED ? this.qDone[j] - this.qCall[j] : NaN);
    const ctx: (number | null)[][] = [];
    for (let j = Math.max(0, k - 6); j <= Math.min(n - 1, k + 3); j++) ctx.push([j - k, interval[j] === interval[j] ? r2(interval[j]) : -1, r2(this.cpu[j]), cat[j], nul(delayOf(j)), nul(gapOf(j)), nul(queueOf(j))]);
    const culledDelta = k > 0 && this.culled[k] >= 0 && this.culled[k - 1] >= 0 ? this.culled[k] - this.culled[k - 1] : null;
    const builds = this.fuList.filter(e => e.frame === k).slice(0, 6).map(e => ({ms: r2(e.ms), object: e.object, objectType: e.objectType, material: e.material, materialType: e.materialType, objectMaterial: e.objectMaterial, shadowPass: e.shadowPass}));
    // (schemaMinor 3) this frame's identified pipeline requests, the most expensive first (at most 6; the count is firstUse.pipelines)
    const pipelineRequests = this.fpList.filter(e => e.frame === k).sort((a, b) => (b.ms === null ? -1 : r2(b.ms)) - (a.ms === null ? -1 : r2(a.ms)) || a.t - b.t).slice(0, 6)
      .map(e => ({ms: e.ms === null ? null : r2(e.ms), async: e.async, withBuild: e.withBuild, newPrograms: e.newPrograms, pass: e.pass, object: e.object, objectType: e.objectType,
        material: e.material, materialType: e.materialType, objectMaterial: e.objectMaterial, shadowPass: e.shadowPass, target: e.target, materialState: e.materialState, objectFlags: e.objectFlags}));
    return {
      frame: k, t: r2(t), intervalMs: iv === iv ? r2(iv) : null, cpuMs: r2(this.cpu[k]), updateMs: r2(this.upd[k]), renderSubmitMs: r2(this.ren[k]),
      deferredMs: r2(this.def[k]), gpuMs: this.gpu[k] === this.gpu[k] ? r2(this.gpu[k]) : null,
      state: STATE_NAMES[this.state[k]] ?? 'other', category: CATEGORIES[cat[k]], flags: FLAG_NAMES.filter(f => this.flags[k] & F[f]),
      renderer: {draws: this.draws[k], triangles: this.tris[k], passes: this.passes[k],
        newTextures: this.seen.textures ? this.dTex[k] : null, newGeometries: this.seen.geometries ? this.dGeo[k] : null, newPrograms: this.seen.programs ? this.dProg[k] : null,
        newNodeBuilds: this.seen.nodes ? this.dNode[k] : null, newPipelines: this.seen.pipelines ? this.dPipe[k] : null},
      firstUse: this.seen.firstUse ? {nodeBuilds: this.fuBuilds[k], nodeBuildMs: r2(this.fuBuildMs[k]), asyncBuilds: this.fuAsync[k], pipelines: this.fuPipes[k], pipelineMs: r2(this.fuPipeMs[k]),
        programs: this.fuProgs[k], programMs: r2(this.fuProgMs[k]), builds, pipelineRequests} : null,
      // (revision 2) this callback's start and the next one's (the interval ends at the next rAF), and this frame's queue probe
      callback: {startDelayMs: nul(delayOf(k)), gapBeforeMs: nul(gapOf(k)), nextStartDelayMs: k + 1 < n ? nul(delayOf(k + 1)) : null, nextGapBeforeMs: k + 1 < n ? nul(gapOf(k + 1)) : null},
      queue: {state: QUEUE_STATES[this.qState[k]] ?? 'none', ms: nul(queueOf(k))},
      world: {culled: this.culled[k] >= 0 ? this.culled[k] : null, culledDelta, enemies: this.enemies[k]},
      camera: {yawDeg: r2(wrapDeg(this.yaw[k])), pitchDeg: r2(this.pitch[k] * 180 / Math.PI), yawRateDegPerSec: Math.round(yawRate[k]), pose, poseColumns: ['x', 'y', 'z', 'storey', 'ageMs']},
      spans,
      timeline: {columns: ['frameOffset', 'intervalMs', 'cpuMs', 'category', 'startDelayMs', 'gapBeforeMs', 'queueMs'], rows: ctx},
      events: near, longFrames: longs,
    };
  }
}

/** Counter change since the previous frame (0 when either side is unavailable), clamped to Int16. */
function delta(cur: number, prev: number): number {
  if (cur < 0 || prev < 0) return 0;
  const d = cur - prev;
  return d > 32767 ? 32767 : d < -32768 ? -32768 : d;
}

// ==== privacy-safe identifiers ========================================================================================================

/** Category of a game asset file by extension (the report never carries full URLs). */
export function assetCategory(file: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(file);
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'glb' || ext === 'gltf' || ext === 'bin') return 'model';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'ktx2' || ext === 'avif' || ext === 'hdr' || ext === 'exr') return 'texture';
  if (ext === 'mp3' || ext === 'ogg' || ext === 'wav' || ext === 'm4a' || ext === 'opus') return 'audio';
  if (ext === 'js' || ext === 'mjs') return 'script';
  if (ext === 'css') return 'style';
  if (ext === 'json') return 'data';
  if (ext === 'wasm') return 'wasm';
  return ext ? 'other' : 'document';
}

/**
 * A game-relative asset identifier for `url`: the file's basename (no directories, query string or fragment) and its category.
 * blob: / data: URLs (images embedded in a GLB) become 'embedded'; another origin's URL becomes null (not reported at all).
 */
export function assetId(url: string, origin: string | null): {id: string; category: string} | null {
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return {id: 'embedded', category: 'embedded-image'};
  let path = url;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  if (scheme) {
    const o = `${scheme[1].toLowerCase()}://${scheme[2].toLowerCase()}`;
    if (origin !== null && o !== origin.toLowerCase()) return null;
    path = url.slice(scheme[0].length);
  }
  path = path.split('#')[0].split('?')[0];
  const base = path.split('/').filter(Boolean).pop() ?? '';
  let id = base;
  try { id = decodeURIComponent(base); } catch { id = base; }
  id = id.replace(/[^\w.\-+@ ]/g, '_').slice(0, 96);
  if (!id) return null;
  return {id, category: assetCategory(id)};
}

/**
 * A runtime object / material name as a report label (task hitch-attribution-recorder-20261105): never a URL (null), no directories
 * (the basename), only [word . - + @ : | , #] characters, at most `max` long; null when nothing is left. Game names are catalogue /
 * generator ids (e.g. "prop-foldingBarricade", "p7-folding-barricade-t25-baked"); a URL-like name is dropped, not trimmed.
 */
export function safeLabel(v: unknown, max = 48): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (v.includes('://') || /^(blob|data|file|https?):/i.test(v)) return null;
  const cut = Math.max(v.lastIndexOf('/'), v.lastIndexOf('\\'));
  const s = (cut >= 0 ? v.slice(cut + 1) : v).split('?')[0].replace(/[^\w.\-+@:|,#]/g, '_').slice(0, max);
  return s || null;
}

/** Report file name: terminal-state-perf-<build>-<UTC yyyymmdd-hhmmss>.json (build = the bundle's content hash, else 'dev'). */
export function reportFileName(build: string | null, at: Date): string {
  const b = (build ?? '').replace(/[^\w-]/g, '').slice(0, 24) || 'dev';
  const p = (v: number, w = 2) => String(v).padStart(w, '0');
  const d = `${p(at.getUTCFullYear(), 4)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}Z`;
  return `terminal-state-perf-${b}-${d}.json`;
}

/** The build hash of a hashed bundle chunk name (e.g. index-B1x2Y3z4.js -> B1x2Y3z4); null for dev / unhashed names. */
export function chunkHash(url: string | null | undefined): string | null {
  if (!url) return null;
  const base = url.split('#')[0].split('?')[0].split('/').pop() ?? '';
  const m = /^[\w.]+-([A-Za-z0-9_-]{6,})\.js$/.exec(base);
  return m ? m[1] : null;
}
