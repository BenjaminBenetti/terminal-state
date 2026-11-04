// Task studio-performance-recorder-20261103-043629 (lane RECORDER): the performance recorder's GAME / BROWSER side — what feeds the
// pure capture (debug/perfRecorder.ts) while a recording runs, and the report it hands to the UI (debug/perfRecorderUi.ts).
//
// Per frame (main.ts loop, right after the debug overlay's FrameHistory sample, same values): the rAF timestamp, the game callback's
// main-thread ms, Game.frameCpu (update / render submit / deferred), the UpdateProfiler's newest span slot (the profiler is switched
// on for the recording and back off after, unless QA had it on), renderer.info counters (draw calls / triangles / passes, texture /
// geometry / program counts) and two three-internal cache sizes (TSL node builds, pipelines), the level culler's hidden-mesh count,
// the enemy count, the player's look and position, the game state and lifecycle / visibility / focus flags. All plain property
// reads into one reused FrameInput — no allocation, no getParameter, no stringify, no console.
//
// Events (installed at start, removed at stop — nothing of this exists while not recording):
//  - Game lifecycle methods are wrapped on the instance (generate / prepare / build / leave a level, warm-up, the mall's texture
//    staging, the journey's background compile, travel / journey, new game / load / retry, save writes, enemy spawns aggregated per
//    build) and the moving train's depart / arrive; a method another lane renamed is listed in capabilities as missing, never a crash;
//  - three's DefaultLoadingManager item start / end (every GLB / texture / embedded image request -> parsed or decoded);
//  - PerformanceObserver 'resource' (fetch timings, transfer / decoded sizes, cache hit), 'long-animation-frame' (else 'longtask');
//  - visibility / focus changes, state changes (Game.stateListeners), display / settings changes (checked at 1 Hz), JS heap (1 Hz,
//    performance.memory where it exists), asynchronous GPU pass times (the overlay's GpuTimer, when the backend supports them).
// Asset ids are basenames + a category (never URLs / query strings); nothing about saves, inventory, input or the account is read.

import * as THREE from 'three';
import {FrameInput, PerfCapture, ST_PLAYING, assetId, chunkHash, reportFileName, stateCode, F, type LongFrameEntry, type PerfCaps, type ReportMeta, type TerminationReason} from './perfRecorder';
import {SPAN_COUNT, type UpdateProfiler} from './updateProfile';
import type {GpuInfo} from '../render/backend';
import type {GpuTimingSupport} from './gpuTimer';
import {seedToCode} from '../core/rng';
import {SAVE_BUILD} from '../save/serialize';

/** The page was hidden this long (ms): the capture stops when it comes back (termination 'hidden'). */
export const HIDDEN_STOP_MS = 30000;
/** Environment / heap sampling cadence (ms). */
const SLOW_MS = 1000;

/** What the recorder reads from the game (Game satisfies it structurally; tests pass a fake). */
export interface RecorderGame {
  readonly state: string;
  readonly warming: boolean;
  readonly frameCpu: {readonly updateMs: number; readonly renderMs: number; readonly deferredMs: number; readonly rendered: boolean};
  readonly prof: UpdateProfiler;
  readonly renderer: {
    readonly initialized: boolean;
    getPixelRatio(): number;
    readonly info: {readonly frame: number; readonly render: {readonly drawCalls: number; readonly frameCalls: number; readonly triangles: number};
      readonly memory: {readonly textures: number; readonly geometries: number; readonly programs: number}};
  };
  readonly canvas: {readonly width: number; readonly height: number};
  readonly settings: {readonly quality: string; readonly renderScale: number; readonly fov: number};
  readonly gpu: GpuInfo | null;
  readonly player: {readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly pitch: number};
  readonly zombies: {readonly length: number};
  readonly seed: number;
  readonly run: {readonly current: {readonly level: string; readonly section: string; readonly station?: string}};
  readonly stateListeners: {push(fn: (s: string, prev: string) => void): number};
}

/** The debug overlay's GPU timing tap (debug/overlay.ts PerfOverlay); absent = no GPU timing. */
export interface GpuTapHost {
  setGpuTap(fn: ((frameId: number, ms: number) => void) | null): void;
  readonly gpuTimer: {status(): GpuTimingSupport | null; readonly error: string | null};
}

interface ObserverCtor {
  new (cb: (list: {getEntries(): unknown[]}) => void): {observe(o: {type: string; buffered?: boolean}): void; disconnect(): void};
  supportedEntryTypes?: readonly string[];
}

export interface RecorderOptions {
  overlay?: GpuTapHost | null;
  caps?: Partial<PerfCaps>;
  now?: () => number;
  /** Time GPU passes while recording (when the backend supports timestamp queries). Default true. */
  gpuTiming?: boolean;
  /** PerformanceObserver (tests inject one; null = none). Default: the global. */
  observer?: ObserverCtor | null;
  /** three's loading manager to observe (tests inject one; null = none). Default: THREE.DefaultLoadingManager. */
  loadingManager?: LoadingManagerLike | null;
  /** Document / window for visibility / focus (null in tests). Default: the globals. */
  doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** Page origin for asset ids (default location.origin). */
  origin?: string | null;
  /** Yield between serialization steps (default: a macrotask). */
  yieldFn?: () => Promise<void>;
}

interface LoadingManagerLike { itemStart(url: string): void; itemEnd(url: string): void; itemError(url: string): void }

export type RecorderPhase = 'idle' | 'recording' | 'preparing' | 'ready';

export interface PerfReport {
  filename: string;
  /** The JSON text parts (a Blob is built from them for the download). */
  parts: string[];
  bytes: number;
  frames: number;
  durationMs: number;
  termination: TerminationReason;
  stoppedBy: string;
  serializeMs: number;
}

interface WrapSpec {
  name: string;
  kind: string;
  async?: boolean;
  /** A lifecycle entry point: every level build / warm-up inside it is labelled with this load route. */
  route?: string;
  detail?: (args: unknown[], game: RecorderGame) => Record<string, unknown> | null;
  result?: (r: unknown) => Record<string, unknown> | null;
}

const str = (v: unknown, max = 48): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const sectionDetail = (a: unknown[]): Record<string, unknown> => {
  const k = a[0] as {level?: unknown; section?: unknown; station?: unknown} | undefined;
  return {level: str(k?.level), section: str(k?.section), station: str(k?.station)};
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Game methods timed while recording (instance wrappers; removed at stop). */
const GAME_WRAPS: WrapSpec[] = [
  {name: 'generateSection', kind: 'level.generate', detail: sectionDetail},
  {name: 'prepareSection', kind: 'level.prepare', async: true, detail: sectionDetail},
  {name: 'buildSection', kind: 'level.build', detail: sectionDetail},
  {name: 'leaveSection', kind: 'level.leave'},
  {name: 'prepareGraphics', kind: 'warmup', async: true, result: r => {
    const w = r as {status?: unknown; mode?: unknown; ms?: unknown; plan?: Record<string, unknown>; stages?: Record<string, {done?: number; total?: number; ms?: number}>} | null;
    if (!w) return null;
    const stages: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(w.stages ?? {})) stages[k] = {done: s?.done ?? null, total: s?.total ?? null, ms: typeof s?.ms === 'number' ? r2(s.ms) : null};
    return {status: str(w.status), mode: str(w.mode), warmupMs: typeof w.ms === 'number' ? r2(w.ms) : null, stages, plan: w.plan ? {...w.plan} : null};
  }},
  {name: 'stageLevelTextures', kind: 'warmup.textures', async: true},
  {name: 'backgroundCompile', kind: 'compile.background', async: true, detail: () => ({note: 'the arrival gate (<= 8 s) of the journey compile; the job itself: flags.compiling + compile.journey.* events. GPU / driver pipeline compile completion is not observable'})},
  {name: 'travel', kind: 'travel', async: true, route: 'menu-travel', detail: a => { const q = a[0] as {to?: {level?: unknown; section?: unknown}; via?: unknown} | undefined; return {to: str(q?.to?.level), section: str(q?.to?.section), via: str(q?.via)}; },
    result: r => ({status: str((r as {status?: unknown} | null)?.status)})},
  {name: 'travelToStation', kind: 'journey', async: true, route: 'travel-arrival', detail: a => ({to: str(a[0])}), result: r => ({ok: (r as {ok?: unknown} | null)?.ok === true})},
  {name: 'newGame', kind: 'lifecycle.newGame', async: true, route: 'new-game', detail: a => ({level: str(a[0])})},
  {name: 'newCampaign', kind: 'lifecycle.newCampaign', async: true, route: 'new-campaign'},
  {name: 'continueCampaign', kind: 'lifecycle.continue', async: true, route: 'continue'},
  {name: 'retryLevel', kind: 'lifecycle.retry', async: true, route: 'retry'},
  {name: 'rewarmAfterSettings', kind: 'warmup.rewarm', async: true, route: 'settings-rewarm'},
  {name: 'commitSave', kind: 'save.write', detail: a => ({reason: str(a[0])}), result: r => { const c = r as {ok?: unknown; code?: unknown} | null; return {ok: c?.ok === true, code: str(c?.code)}; }},
  {name: 'spawnEnemy', kind: 'enemy.spawn', detail: a => { const s = a[0] as {archetype?: unknown; look?: unknown} | undefined; return {archetype: str(s?.archetype) ?? 'zombie', look: str(s?.look)}; }},
];
/** The moving train (world/trainRide.ts). */
const RIDE_WRAPS: WrapSpec[] = [
  {name: 'depart', kind: 'train.depart', async: true, result: r => ({status: str((r as {status?: unknown} | null)?.status)})},
  {name: 'arrive', kind: 'train.arrive', async: true, result: r => ({status: str((r as {status?: unknown} | null)?.status)})},
];

/** Private / optional game fields read per frame (absent = flag never set). */
interface GameExtras {
  lifecycle?: {busy?: boolean};
  transitGap?: boolean;
  trainRide?: {riding?: boolean} | null;
  world?: {culler?: {stats?: {culled?: number; level?: number}}} | null;
  layout?: {name?: unknown} | null;
  softwareGl?: {software?: boolean} | null;
  warmup?: {mode?: unknown; status?: unknown} | null;
  atmosphereBypass?: string | null;
  frameBudget?: {diagnostics(): {refresh?: {hz?: number; measured?: boolean}}};
  camera?: {fov?: number};
  journeyCompileStats?: JourneyStats | null;
}
/** Game.journeyCompileStats (render/journeyCompile.ts JourneyCompileStats; one object per job). */
interface JourneyStats {
  phase?: string; sceneItems?: number; sceneDone?: number; casters?: number; shadowDone?: number; sceneChunks?: number;
  slices?: number; maxPerSlice?: number; sliceMaxMs?: number; background?: boolean; postStalls?: number; cancelReason?: string | null;
}
const journeyActive = (s: JourneyStats | null | undefined): boolean => s?.phase === 'scene' || s?.phase === 'shadow';
const journeyData = (s: JourneyStats): Record<string, unknown> => ({phase: str(s.phase, 16), reason: str(s.cancelReason, 16),
  sceneDone: s.sceneDone ?? null, sceneItems: s.sceneItems ?? null, shadowDone: s.shadowDone ?? null, casters: s.casters ?? null,
  calls: s.sceneChunks ?? null, slices: s.slices ?? null, maxPerSlice: s.maxPerSlice ?? null,
  sliceMaxMs: typeof s.sliceMaxMs === 'number' ? r2(s.sliceMaxMs) : null, background: s.background ?? null, postStalls: s.postStalls ?? null});
/** three r186 internals read per frame for first-use counts (absent = null in the report). */
interface RendererInternals { _nodes?: {nodeBuilderCache?: {size: number}} | null; _pipelines?: {caches?: {size: number}} | null }

export class PerfRecorderController {
  readonly capture: PerfCapture;
  phase: RecorderPhase = 'idle';
  /** The per-frame hook's whole OFF cost is this one check. */
  recording = false;
  report: PerfReport | null = null;
  /** Called on every phase change (UI). */
  readonly listeners: ((c: PerfRecorderController) => void)[] = [];
  /** Why the last capture could not be serialized / the recorder stopped itself. */
  error: string | null = null;
  private readonly inp = new FrameInput();
  private readonly now: () => number;
  private readonly g: RecorderGame;
  private readonly x: GameExtras;
  private readonly ri: RendererInternals;
  private focused = true;
  private hiddenAt = -1;
  private stateChanged = false;
  private lastSlow = -Infinity;
  private display = '';
  private startedAtUTC = '';
  private stoppedBy = 'menu';
  private profWasOn = false;
  private gen = 0;
  private gpuWanted = true;
  // overhead of the recorder's own per-frame work (performance.now() around it)
  private ovSum = 0; private ovMax = 0; private ovN = 0;
  // installed while recording
  private wrapped: {obj: Record<string, unknown>; name: string; wrapper: unknown; orig: unknown; own: boolean}[] = [];
  private missing: string[] = [];
  private observers: {disconnect(): void}[] = [];
  private loafType: 'long-animation-frame' | 'longtask' | null = null;
  private resourceTiming = false;
  private crossOrigin = 0;
  private manager: {m: LoadingManagerLike; orig: LoadingManagerLike; wrap: LoadingManagerLike} | null = null;
  private managerInstalled = false;
  private readonly assetsOpen = new Map<string, {t: number; depth: number; firstEnd: number; id: string; category: string}>();
  private buildDepth = 0;
  private spawnAgg = {count: 0, ms: 0, maxMs: 0};
  /** Lifecycle entry points in flight (outermost first): the load route of a level build / warm-up. */
  private routes: string[] = [];
  /** A level was built at this time (performance.now()) and the player has not had control since; -1 = none pending. */
  private pendingControl = -1;
  private pendingRoute = '';
  // first-use preparation (three internals, hooked while recording): counts / CPU ms since the last frame sample
  private readonly fu = {builds: 0, buildMs: 0, async: 0, pipes: 0, pipeMs: 0, progs: 0, progMs: 0};
  private renderDepth = 0;
  private nbT0 = -1;
  private fuHooks: string[] = [];
  private fuMissing: string[] = [];
  private readonly unlisten: (() => void)[] = [];
  private gpuTap = false;
  /** The journey compile job last seen (its stats object) and its phase then. */
  private jcSeen: JourneyStats | null = null;
  private jcPhase = '';

  constructor(game: RecorderGame, private readonly opts: RecorderOptions = {}) {
    this.g = game;
    this.x = game as unknown as GameExtras;
    this.ri = game.renderer as unknown as RendererInternals;
    this.capture = new PerfCapture(opts.caps);
    this.now = opts.now ?? (() => performance.now());
    this.gpuWanted = opts.gpuTiming !== false;
    // permanent and cheap: a state change only sets a flag (and records an event while recording)
    game.stateListeners.push((s, prev) => {
      if (!this.recording) return;
      this.stateChanged = true;
      this.capture.event(this.now(), 'state', null, {from: str(prev, 16), to: str(s, 16)});
    });
  }

  /** Per animation frame (main.ts, after the overlay's sample): `time` = the rAF timestamp, `cpuMs` = the game callback's main-thread ms. */
  frame(time: number, cpuMs: number): void {
    if (!this.recording) return;
    const t1 = this.now();
    try {
      const g = this.g, x = this.x, i = this.inp, c = g.frameCpu;
      i.time = time; i.cpuMs = cpuMs; i.updateMs = c.updateMs; i.renderMs = c.renderMs; i.deferredMs = c.deferredMs;
      i.state = stateCode(g.state);
      let fl = c.rendered ? F.rendered : 0;
      if (g.warming) fl |= F.warming;
      if (this.hiddenAt >= 0) fl |= F.hidden;
      if (!this.focused) fl |= F.unfocused;
      if (x.lifecycle?.busy || x.transitGap) fl |= F.transition;
      if (x.trainRide?.riding) fl |= F.riding;
      if (this.stateChanged) { fl |= F.stateChange; this.stateChanged = false; }
      const jc = x.journeyCompileStats;
      if (journeyActive(jc)) fl |= F.compiling;
      if ((jc ?? null) !== this.jcSeen || (jc && jc.phase !== this.jcPhase)) this.journeyEvent(t1, jc ?? null);
      i.flags = fl;
      const r = g.renderer;
      if (r.initialized) {
        const info = r.info, rr = info.render, mem = info.memory;
        i.frameId = info.frame; i.draws = rr.drawCalls; i.tris = rr.triangles; i.passes = rr.frameCalls;
        i.textures = mem.textures; i.geometries = mem.geometries; i.programs = mem.programs;
        const nodes = this.ri._nodes?.nodeBuilderCache, pipes = this.ri._pipelines?.caches;
        i.nodes = nodes ? nodes.size : -1; i.pipelines = pipes ? pipes.size : -1;
      } else { i.frameId = -1; i.draws = i.tris = i.passes = 0; i.textures = i.geometries = i.programs = i.nodes = i.pipelines = -1; }
      const stats = x.world?.culler?.stats;
      i.culled = stats && typeof stats.culled === 'number' ? stats.culled : -1;
      i.storey = stats && typeof stats.level === 'number' ? stats.level : 0;
      i.enemies = g.zombies.length;
      const p = g.player;
      i.yaw = p.yaw; i.pitch = p.pitch; i.x = p.x; i.y = p.y; i.z = p.z;
      const fu = this.fu;
      i.fuOn = this.fuMissing.length === 0 && this.fuHooks.length > 0;
      i.nodeBuilds = fu.builds; i.nodeBuildMs = fu.buildMs; i.asyncBuilds = fu.async; i.pipelinesCreated = fu.pipes; i.pipelineMs = fu.pipeMs; i.programsCreated = fu.progs; i.programMs = fu.progMs;
      fu.builds = fu.buildMs = fu.async = fu.pipes = fu.pipeMs = fu.progs = fu.progMs = 0;
      this.nbT0 = -1;
      const cap = this.capture.frame(i, g.prof);
      if (this.pendingControl >= 0 && i.state === ST_PLAYING && (fl & (F.warming | F.transition)) === 0) {
        this.capture.event(t1, 'control.returned', null, {route: this.pendingRoute, sinceBuildMs: r2(t1 - this.pendingControl)});
        this.capture.segmentControl(t1);
        this.pendingControl = -1;
      }
      if (t1 - this.lastSlow >= SLOW_MS) this.slowSample(t1);
      if (cap) this.stop(cap === 1 ? 'auto-cap-frames' : 'auto-cap-duration', 'auto');
      else if (g.gpu?.deviceLost) this.stop('device-lost', 'auto');
    } catch (err) {
      this.fail(err);
    }
    const d = this.now() - t1;
    this.ovSum += d; this.ovN++; if (d > this.ovMax) this.ovMax = d;
  }

  /** The journey compile job changed (a new job, scene -> shadow, done / cancelled): one event, at the sample that saw it. */
  private journeyEvent(t: number, jc: JourneyStats | null): void {
    const fresh = jc !== this.jcSeen;
    this.jcSeen = jc;
    this.jcPhase = jc?.phase ?? '';
    if (!jc) return;
    const timing = 'seen at this frame sample (the change happened since the previous one)';
    if (fresh) this.capture.event(t, 'compile.journey.start', null, {...journeyData(jc), timing});
    if (!journeyActive(jc)) this.capture.event(t, 'compile.journey.end', null, {...journeyData(jc), timing});
    else if (!fresh && jc.phase === 'shadow') this.capture.event(t, 'compile.journey.phase', null, {...journeyData(jc), timing});
  }

  /** Start a new recording (clears the previous capture and report). Returns false when one is already running. */
  start(by = 'menu'): boolean {
    if (this.recording) return false;
    this.gen++;
    this.report = null;
    this.error = null;
    this.stoppedBy = by;
    const t = this.now();
    // the profiler: on for the recording (left on if QA had already switched it on)
    const prof = this.g.prof;
    this.profWasOn = prof.on;
    if (!prof.on) prof.startRecording();
    this.capture.start(t, prof.head);
    this.recording = true;
    this.phase = 'recording';
    this.focused = typeof document === 'undefined' || typeof document.hasFocus !== 'function' || document.hasFocus();
    const hidden = this.opts.doc !== undefined ? this.opts.doc?.hidden === true : typeof document !== 'undefined' && document.hidden;
    this.hiddenAt = hidden ? t : -1;
    this.stateChanged = false;
    this.lastSlow = -Infinity;
    this.display = '';
    this.ovSum = this.ovMax = this.ovN = 0;
    this.buildDepth = 0;
    this.spawnAgg = {count: 0, ms: 0, maxMs: 0};
    this.routes = [];
    this.pendingControl = -1;
    this.renderDepth = 0;
    this.nbT0 = -1;
    this.fu.builds = this.fu.buildMs = this.fu.async = this.fu.pipes = this.fu.pipeMs = this.fu.progs = this.fu.progMs = 0;
    this.startedAtUTC = new Date().toISOString();
    this.install();
    this.capture.event(t, 'recording.start', null, {by: str(by, 16), state: str(this.g.state, 16)});
    // a journey compile already running (a capture started after the arrival): one snapshot, then its phase / end events
    const jc = this.x.journeyCompileStats ?? null;
    this.jcSeen = jc;
    this.jcPhase = jc?.phase ?? '';
    if (jc && journeyActive(jc)) this.capture.event(t, 'compile.journey.active', null, {...journeyData(jc), note: 'already running at recording start'});
    this.worldSegment(t, undefined, 'recording-start', !this.x.world); // (the main menu: no level yet)
    if (this.x.world) this.capture.segmentControl(t); // a level already running: its first-use work from here on counts as after control
    this.emit();
    return true;
  }

  /** Stop and prepare the report (asynchronously; phase 'preparing' -> 'ready'). Idempotent. */
  stop(reason: TerminationReason = 'manual', by = 'menu'): Promise<PerfReport | null> {
    if (!this.recording) return Promise.resolve(this.report);
    const t = this.now();
    this.capture.event(t, 'recording.stop', null, {reason, by: str(by, 16)});
    this.capture.stop(t, reason);
    this.recording = false;
    this.stoppedBy = by;
    this.uninstall();
    if (!this.profWasOn) this.g.prof.stopRecording();
    if (reason === 'cancelled') { this.phase = 'idle'; this.capture.clear(); this.emit(); return Promise.resolve(null); }
    this.phase = 'preparing';
    this.emit();
    return this.prepare(this.gen);
  }

  /** Discard the running capture and / or the last report (idempotent). */
  clear(): void {
    if (this.recording) void this.stop('cancelled', 'clear');
    this.gen++;
    this.report = null;
    this.capture.clear();
    this.phase = 'idle';
    this.emit();
  }

  /** A user mark ('stutter'); returns its number, 0 when not recording. */
  mark(): number {
    if (!this.recording) return 0;
    return this.capture.mark(this.now());
  }

  /** Seconds recorded so far / of the last capture. */
  elapsedMs(): number {
    return this.recording ? this.now() - this.capture.t0 : this.capture.tEnd - this.capture.t0;
  }

  /** User marks of the running / last capture. */
  get marks(): number { return this.capture.markCount; }

  /** The finished report as an object (QA; parses the same text the download carries). */
  reportObject(): Record<string, unknown> | null {
    return this.report ? JSON.parse(this.report.parts.join('')) as Record<string, unknown> : null;
  }

  // ==== internals ===================================================================================================================

  private emit(): void {
    for (const fn of this.listeners) { try { fn(this); } catch { /* a UI listener never breaks the recorder */ } }
  }

  private fail(err: unknown): void {
    this.error = `recorder stopped: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
    if (this.recording) void this.stop('recorder-error', 'auto');
  }

  private async prepare(gen: number): Promise<PerfReport | null> {
    const yieldFn = this.opts.yieldFn ?? (() => new Promise<void>(r => setTimeout(r, 0)));
    await yieldFn(); // never inside the frame / key handler that stopped the capture
    if (gen !== this.gen) return null;
    const t0 = this.now();
    try {
      const meta = this.meta();
      const parts = await this.capture.serialize(meta, yieldFn);
      if (gen !== this.gen) return null; // cleared / restarted meanwhile
      let bytes = 0;
      for (const s of parts) bytes += s.length;
      const c = this.capture;
      this.report = {filename: reportFileName(chunkHash(buildUrl()), new Date()), parts, bytes, frames: c.frames, durationMs: r2(c.tEnd - c.t0),
        termination: c.termination ?? 'manual', stoppedBy: this.stoppedBy, serializeMs: r2(this.now() - t0)};
      this.phase = 'ready';
      this.emit();
      return this.report;
    } catch (err) {
      if (gen !== this.gen) return null;
      this.error = `the report could not be prepared: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
      this.phase = 'idle';
      this.emit();
      return null;
    }
  }

  private meta(): ReportMeta {
    const g = this.g, prof = g.prof;
    const spanNames = Array.from({length: SPAN_COUNT}, (_, j) => prof.name(j));
    const tap = this.opts.overlay?.gpuTimer.status() ?? null;
    const caps: ReportMeta['capabilities'] = [
      {id: 'frame.interval', available: true, source: 'requestAnimationFrame timestamps (every frame)'},
      {id: 'frame.cpu', available: true, source: 'performance.now() around the game frame callback (main.ts loop)', note: 'main-thread JS of the game callback only'},
      {id: 'frame.update / renderSubmit / deferred', available: true, source: 'Game.frameCpu (the same boundaries as the Ctrl+Shift+P overlay)', note: 'render submit = CPU encoding, not GPU execution'},
      {id: 'spans', available: this.capture.seen.spans, source: 'debug/updateProfile.ts UpdateProfiler (on while recording)', note: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? 'fine clock (cross-origin isolated)' : 'browser default clock: Firefox ~1 ms, Chromium ~0.1 ms resolution'},
      {id: 'gpu', available: this.capture.seen.gpu, source: 'debug/gpuTimer.ts (WebGPU timestamp-query / EXT_disjoint_timer_query_webgl2), asynchronous',
        note: !this.gpuWanted ? 'not requested for this capture' : !this.opts.overlay ? 'no GPU timer installed' : this.opts.overlay.gpuTimer.error ?? (tap ? (tap.available ? tap.note : `unavailable: ${tap.note}`) : 'renderer not initialized')},
      {id: 'renderer.draws / triangles / passes', available: g.renderer.initialized, source: 'renderer.info.render after each drawn frame (render/backend.ts renderStats)'},
      {id: 'renderer.newTextures / newGeometries / newPrograms', available: this.capture.seen.textures, source: 'renderer.info.memory counters, net change per frame'},
      {id: 'renderer.newNodeBuilds', available: this.capture.seen.nodes, source: 'three internal NodeManager.nodeBuilderCache.size (net change)', note: 'TSL material node builds on the CPU (first sight of a material / geometry / lights combination)'},
      {id: 'renderer.newPipelines', available: this.capture.seen.pipelines, source: 'three internal Pipelines.caches.size (net change)', note: 'pipelines REQUESTED on the CPU; the driver / GPU shader compile and its completion are NOT observable'},
      {id: 'firstUse.nodeBuilds / nodeBuildMs / asyncBuilds', available: this.capture.seen.firstUse, source: this.fuHooks.length ? `three r186 internals hooked while recording: ${this.fuHooks.join(', ')}` : 'none',
        note: this.fuMissing.length ? `unavailable: ${this.fuMissing.join(', ')}` : 'TSL node builds completed inside synchronous renders, with their CPU ms; builds outside a render (compileAsync / warm-up) are counted, not timed'},
      {id: 'firstUse.pipelines / pipelineMs', available: this.capture.seen.firstUse, source: 'Pipelines._getRenderPipeline (new render pipeline requests)', note: 'GPU pipeline compile time not observable; CPU-side request span only (inside renders)'},
      {id: 'firstUse.programs / programMs', available: this.capture.seen.firstUse, source: 'backend.createProgram (new shader programs)', note: 'CPU-side shader module / shader compile request only; driver compile completion not observable'},
      {id: 'loadRoute', available: true, source: 'Game lifecycle entry points in flight (travelToStation / travel / newGame / newCampaign / continueCampaign / retryLevel / rewarmAfterSettings)', note: 'labels every level build, warm-up and event; world.segments[].route'},
      {id: 'warmupStages', available: true, source: 'Game.prepareGraphics result (render/warmup.ts WarmupResult: status, mode, per-stage done / total / ms)', note: "stage start times are derived (the stages run in order materials, passes, shadows, view); the journey's background compile is a single CPU span"},
      {id: 'controlReturned', available: true, source: 'the first frame after a level build in state playing with no warm-up and no lifecycle operation in flight', note: 'for a train journey: after the arrival and its save'},
      {id: 'journeyCompile', available: 'journeyCompileStats' in (g as object), source: 'Game.journeyCompileStats (render/journeyCompile.ts) read at every frame sample',
        note: 'flags.compiling = the train journey\'s background compile is active (scene / shadow phase, incl. after the arrival); events compile.journey.active (running at recording start) / start / phase / end with its paced counts (calls, slices, maxPerSlice, sliceMaxMs, background = launched from a background-priority task)'},
      {id: 'shaderCompileTime', available: false, source: 'none', note: 'GPU pipeline compile time not observable from a web page; CPU-side build / request spans only (firstUse.*)'},
      {id: 'culling.culled', available: this.capture.seen.culled, source: 'LevelCuller.stats.culled', note: 'meshes hidden after the last full culler update (net; per-update show / hide counts are not instrumented)'},
      {id: 'enemies', available: true, source: 'Game.zombies.length'},
      {id: 'camera', available: true, source: 'player look (yaw / pitch) every frame; position at the camera cadence', note: 'recoil / sway / train tilt excluded'},
      {id: 'longFrames', available: this.loafType !== null, source: this.loafType ? `PerformanceObserver '${this.loafType}'` : 'none', note: this.loafType ? undefined : 'no long-animation-frame / longtask entry type in this browser'},
      {id: 'resources', available: this.resourceTiming, source: this.resourceTiming ? "PerformanceObserver 'resource' (same-origin game files)" : 'none', note: `${this.crossOrigin} other-origin entries not recorded`},
      {id: 'assetLoads', available: this.managerInstalled, source: 'three DefaultLoadingManager item start / end', note: 'wall time request -> parsed / decoded (asynchronous; overlaps other work; not main-thread time)'},
      {id: 'lifecycleEvents', available: this.missing.length < GAME_WRAPS.length, source: 'Game method timings (instance wrappers while recording)', note: this.missing.length ? `missing: ${this.missing.join(', ')}` : 'all hooks installed'},
      {id: 'heap', available: heapApi() !== null, source: heapApi() ? 'performance.memory at 1 Hz' : 'none', note: heapApi() ? 'Chromium only; coarse / approximate' : 'no performance.memory in this browser'},
      {id: 'gc', available: false, source: 'none', note: 'no web API reports GC pauses; they show only as interval much longer than the game CPU'},
      {id: 'systemCpu / gpuUtilization', available: false, source: 'none', note: 'not exposed to web pages'},
    ];
    const ov = this.ovN ? {frames: this.ovN, meanUs: r2(this.ovSum / this.ovN * 1000), maxUs: r2(this.ovMax * 1000), note: "the recorder's own per-frame work (not counted in frames.cpu); the UpdateProfiler's span clock reads are inside frames.cpu"} : null;
    return {build: buildIdentity(), environment: this.environment(), capabilities: caps, spanNames, capturedAtUTC: this.startedAtUTC, endedAtUTC: new Date().toISOString(),
      stoppedBy: this.stoppedBy, overhead: ov ? {...ov, captureBytes: this.capture.bytes()} : {captureBytes: this.capture.bytes()},
      notes: ['interval of frame k = rAF time of frame k+1 minus frame k (the work of frame k delays frame k+1)',
        'gameplay summaries exclude menus, pause, loading, warm-up, lifecycle transitions (travel / journey / level build), hidden-tab gaps and focus loss',
        'a software rasterizer / WebGL2 fallback is not representative of a hardware WebGPU device']};
  }

  private environment(): Record<string, unknown> {
    const g = this.g, x = this.x, nav = typeof navigator !== 'undefined' ? navigator as Navigator & {deviceMemory?: number} : null;
    const gp = g.gpu;
    let refresh: unknown = null;
    try { const d = x.frameBudget?.diagnostics(); refresh = d?.refresh ? {hz: typeof d.refresh.hz === 'number' ? r2(d.refresh.hz) : null, measured: d.refresh.measured === true} : null; } catch { refresh = null; }
    return {
      userAgent: nav?.userAgent ?? null,
      hardwareConcurrency: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
      deviceMemoryGB: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
      deviceNote: 'hardwareConcurrency = logical cores the browser reports; deviceMemoryGB = Chromium-only coarse estimate (null elsewhere)',
      crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
      display: this.displayNow(),
      refresh,
      renderer: gp ? {backend: gp.backend, label: gp.label, adapter: gp.adapter ? {...gp.adapter} : null, glRenderer: gp.glRenderer, compatibilityMode: gp.compatibilityMode,
        deviceLost: gp.deviceLost !== null, errors: gp.errors.length} : null,
      softwareRasterizer: x.softwareGl ? x.softwareGl.software === true : null,
      warmup: x.warmup ? {mode: str(x.warmup.mode), status: str(x.warmup.status)} : null,
      atmosphereBypass: typeof x.atmosphereBypass === 'string' ? true : x.atmosphereBypass === null ? false : null,
    };
  }

  private displayNow(): Record<string, unknown> {
    const g = this.g, s = g.settings;
    return {
      cssWidth: typeof innerWidth === 'number' ? innerWidth : null, cssHeight: typeof innerHeight === 'number' ? innerHeight : null,
      devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : null,
      canvasWidth: g.canvas.width, canvasHeight: g.canvas.height, renderPixelRatio: g.renderer.initialized ? r2(g.renderer.getPixelRatio()) : null,
      quality: s.quality, renderScale: s.renderScale, fov: s.fov,
    };
  }

  /** 1 Hz: JS heap and display / settings changes. */
  private slowSample(t: number): void {
    this.lastSlow = t;
    const h = heapApi();
    if (h && typeof h.usedJSHeapSize === 'number') this.capture.heap(t, h.usedJSHeapSize, h.totalJSHeapSize ?? null, h.jsHeapSizeLimit ?? null);
    const g = this.g, s = g.settings;
    const key = `${g.canvas.width}x${g.canvas.height}|${typeof devicePixelRatio === 'number' ? devicePixelRatio : 0}|${s.quality}|${s.renderScale}|${s.fov}`;
    if (key !== this.display) {
      if (this.display) this.capture.event(t, 'display', null, this.displayNow());
      this.display = key;
    }
  }

  private worldSegment(t: number, key: SectionKeyLike | undefined, route: string, noWorld = false): void {
    const g = this.g, cur = noWorld ? undefined : key && typeof key === 'object' ? key : g.run?.current;
    const name = noWorld ? null : this.x.layout?.name, seed = !noWorld && Number.isFinite(g.seed) ? g.seed >>> 0 : null;
    this.capture.world(t, {level: str(cur?.level), section: str(cur?.section), station: str(cur?.station), seed, seedCode: seed === null ? null : seedToCode(seed),
      name: typeof name === 'string' ? name.slice(0, 64) : null, route});
  }

  /** The load route of what runs now: the outermost lifecycle entry point in flight ('other' outside one). */
  private route(): string {
    return this.routes[0] ?? 'other';
  }

  /**
   * A finished warm-up (WarmupResult): one 'warmup.stage' span per stage (materials -> passes -> shadows -> view run in that order;
   * their start times are derived from the stage durations, aligned to the warm-up's end) and the level segment's warm-up record.
   */
  private warmupStages(t: number, dur: number, result: unknown, route: string): void {
    const w = result as {status?: unknown; mode?: unknown; ms?: unknown; stages?: Record<string, {done?: number; total?: number; ms?: number}>} | null;
    if (!w) return;
    const status = str(w.status), mode = str(w.mode);
    const stages: Record<string, unknown> = {};
    const order = ['materials', 'passes', 'shadows', 'view'].map(name => {
      const st = w.stages?.[name];
      return {name, st, ms: st && typeof st.ms === 'number' && Number.isFinite(st.ms) ? Math.max(0, st.ms) : 0};
    }).filter(x => x.st);
    let end = t - order.reduce((sum, x) => sum + x.ms, 0);
    for (const {name, st, ms} of order) {
      stages[name] = {done: st!.done ?? null, total: st!.total ?? null, ms: r2(ms)};
      end += ms;
      if (ms > 0) this.capture.event(end, 'warmup.stage', ms, {stage: name, done: st!.done ?? null, total: st!.total ?? null, status, mode, route, timing: 'derived from the stage durations'});
    }
    this.capture.segmentWarmup({kind: 'prepareGraphics', route, status, mode, ms: typeof w.ms === 'number' ? r2(w.ms) : null, spanMs: r2(dur), stages});
  }

  // --- install / uninstall (start / stop) ---

  private install(): void {
    this.missing = [];
    for (const spec of GAME_WRAPS) this.wrap(this.g, spec);
    const ride = this.x.trainRide;
    if (ride) for (const spec of RIDE_WRAPS) this.wrap(ride, spec);
    this.installFirstUse();
    this.installManager();
    this.installObservers();
    this.installPage();
    this.installGpu();
  }

  private uninstall(): void {
    for (const w of this.wrapped) {
      if (w.obj[w.name] !== w.wrapper) continue; // replaced again by someone else: ours stays a pass-through
      if (w.own) w.obj[w.name] = w.orig; else delete w.obj[w.name];
    }
    this.wrapped = [];
    const mg = this.manager;
    if (mg) {
      if (mg.m.itemStart === mg.wrap.itemStart) mg.m.itemStart = mg.orig.itemStart;
      if (mg.m.itemEnd === mg.wrap.itemEnd) mg.m.itemEnd = mg.orig.itemEnd;
      if (mg.m.itemError === mg.wrap.itemError) mg.m.itemError = mg.orig.itemError;
      this.manager = null;
    }
    this.assetsOpen.clear();
    for (const o of this.observers) { try { o.disconnect(); } catch { /* already gone */ } }
    this.observers = [];
    for (const u of this.unlisten.splice(0)) u();
    if (this.gpuTap) { this.opts.overlay?.setGpuTap(null); this.gpuTap = false; }
  }

  private wrap(target: object, spec: WrapSpec): void {
    const obj = target as Record<string, unknown>;
    const orig = obj[spec.name];
    if (typeof orig !== 'function') { this.missing.push(spec.name); return; }
    const own = Object.prototype.hasOwnProperty.call(obj, spec.name);
    const self = this;
    const fn = orig as (...a: unknown[]) => unknown;
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      if (!self.recording) return fn.apply(this, args);
      const t0 = self.now();
      if (spec.name === 'buildSection') { self.buildDepth++; self.spawnAgg = {count: 0, ms: 0, maxMs: 0}; }
      const route = spec.route;
      if (route) self.routes.push(route);
      const unroute = () => { if (route) { const j = self.routes.lastIndexOf(route); if (j >= 0) self.routes.splice(j, 1); } };
      let r: unknown;
      try {
        r = fn.apply(this, args);
      } catch (err) {
        if (spec.name === 'buildSection') self.buildDepth--;
        self.hookDone(spec, args, undefined, t0, err);
        unroute();
        throw err;
      }
      if (spec.async && r && typeof (r as Promise<unknown>).then === 'function') {
        (r as Promise<unknown>).then(v => { self.hookDone(spec, args, v, t0, null); unroute(); }, (e: unknown) => { self.hookDone(spec, args, undefined, t0, e); unroute(); });
        return r;
      }
      if (spec.name === 'buildSection') self.buildDepth--;
      self.hookDone(spec, args, r, t0, null);
      unroute();
      return r;
    };
    obj[spec.name] = wrapper;
    this.wrapped.push({obj, name: spec.name, wrapper, orig, own});
  }

  /** Wrap `obj[name]` (own-property wrapper, removed at stop) with `make(orig)`; false when there is no such method. */
  private patch(obj: object | null | undefined, name: string, make: (orig: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown): boolean {
    const o = obj as Record<string, unknown> | null | undefined;
    const orig = o?.[name];
    if (!o || typeof orig !== 'function') return false;
    const own = Object.prototype.hasOwnProperty.call(o, name);
    const wrapper = make(orig as (...a: unknown[]) => unknown);
    o[name] = wrapper;
    this.wrapped.push({obj: o, name, wrapper, orig, own});
    return true;
  }

  /**
   * First-use preparation counters (three r186 internals; installed only while recording, and only on cache-miss paths except the
   * per-call render depth): renderer.render (sync render depth), NodeManager._createNodeBuilder -> _createNodeBuilderState (a TSL
   * node build: timed when it runs inside a sync render, counted as async otherwise), Pipelines._getRenderPipeline (a new render
   * pipeline request) and backend.createProgram (a new shader program). Missing internals: listed, and the columns are null.
   */
  private installFirstUse(): void {
    this.fuHooks = [];
    this.fuMissing = [];
    const r = this.g.renderer as unknown as {render?: unknown; backend?: object; _nodes?: object | null; _pipelines?: object | null};
    if (!this.g.renderer.initialized) { this.fuMissing.push('renderer not initialized at start'); return; }
    const self = this, now = this.now;
    const hook = (label: string, obj: object | null | undefined, name: string, make: (orig: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown) => {
      if (this.patch(obj, name, make)) this.fuHooks.push(label); else this.fuMissing.push(label);
    };
    hook('renderer.render', r, 'render', orig => function (this: unknown, ...a: unknown[]) {
      self.renderDepth++;
      try { return orig.apply(this, a); } finally { self.renderDepth--; }
    });
    hook('NodeManager._createNodeBuilder', r._nodes, '_createNodeBuilder', orig => function (this: unknown, ...a: unknown[]) {
      if (self.recording && self.renderDepth > 0 && self.nbT0 < 0) self.nbT0 = now(); // (a TSL error re-creates it: one span)
      return orig.apply(this, a);
    });
    hook('NodeManager._createNodeBuilderState', r._nodes, '_createNodeBuilderState', orig => function (this: unknown, ...a: unknown[]) {
      const res = orig.apply(this, a);
      if (self.recording) {
        if (self.renderDepth > 0) { self.fu.builds++; if (self.nbT0 >= 0) { self.fu.buildMs += now() - self.nbT0; self.nbT0 = -1; } } else self.fu.async++;
      }
      return res;
    });
    hook('Pipelines._getRenderPipeline', r._pipelines, '_getRenderPipeline', orig => function (this: unknown, ...a: unknown[]) {
      if (!self.recording) return orig.apply(this, a);
      self.fu.pipes++;
      if (self.renderDepth === 0) return orig.apply(this, a);
      const t0 = now();
      try { return orig.apply(this, a); } finally { self.fu.pipeMs += now() - t0; }
    });
    hook('backend.createProgram', r.backend, 'createProgram', orig => function (this: unknown, ...a: unknown[]) {
      if (!self.recording) return orig.apply(this, a);
      self.fu.progs++;
      if (self.renderDepth === 0) return orig.apply(this, a);
      const t0 = now();
      try { return orig.apply(this, a); } finally { self.fu.progMs += now() - t0; }
    });
  }

  private hookDone(spec: WrapSpec, args: unknown[], result: unknown, t0: number, err: unknown): void {
    if (!this.recording) return;
    try {
      const t = this.now(), dur = t - t0;
      if (spec.name === 'spawnEnemy' && this.buildDepth > 0) { // aggregated into the level build's event
        const a = this.spawnAgg; a.count++; a.ms += dur; if (dur > a.maxMs) a.maxMs = dur;
        return;
      }
      const route = this.route();
      const data: Record<string, unknown> = {...(spec.detail?.(args, this.g) ?? {}), ...(err ? {failed: true} : spec.result?.(result) ?? {}), route};
      if (spec.name === 'buildSection') {
        const a = this.spawnAgg;
        data.enemySpawns = a.count; data.enemySpawnMs = r2(a.ms); data.enemySpawnMaxMs = r2(a.maxMs);
        data.enemies = this.g.zombies.length;
      }
      this.capture.event(t, spec.kind, dur, data);
      if (spec.name === 'buildSection' && !err) {
        this.worldSegment(t, args[0] as SectionKeyLike | undefined, route); // the key it built (run.current may follow later)
        this.pendingControl = t;
        this.pendingRoute = route;
      }
      if (spec.name === 'prepareGraphics' && !err) this.warmupStages(t, dur, result, route);
      if (spec.name === 'backgroundCompile' && !err) this.capture.segmentWarmup({kind: 'backgroundCompile', route, ms: r2(dur), note: 'renderer.compileAsync over the new level while the train rides (CPU request span; no hidden frames)'});
    } catch { /* an instrumentation detail never breaks the game method */ }
  }

  private installManager(): void {
    this.managerInstalled = false;
    const m = this.opts.loadingManager !== undefined ? this.opts.loadingManager : (THREE.DefaultLoadingManager as unknown as LoadingManagerLike);
    if (!m || typeof m.itemStart !== 'function' || typeof m.itemEnd !== 'function') return;
    const orig: LoadingManagerLike = {itemStart: m.itemStart, itemEnd: m.itemEnd, itemError: m.itemError};
    const self = this;
    const wrap: LoadingManagerLike = {
      itemStart(this: unknown, url: string) { self.assetStart(url); return orig.itemStart.call(this, url); },
      itemEnd(this: unknown, url: string) { const r = orig.itemEnd.call(this, url); self.assetEnd(url, false); return r; },
      itemError(this: unknown, url: string) { self.assetEnd(url, true); return orig.itemError?.call(this, url); },
    };
    m.itemStart = wrap.itemStart; m.itemEnd = wrap.itemEnd; m.itemError = wrap.itemError;
    this.manager = {m, orig, wrap};
    this.managerInstalled = true;
  }

  private origin(): string | null {
    if (this.opts.origin !== undefined) return this.opts.origin;
    return typeof location !== 'undefined' ? location.origin : null;
  }

  private assetStart(url: string): void {
    if (!this.recording) return;
    try {
      const o = this.assetsOpen.get(url);
      if (o) { o.depth++; return; }
      if (this.assetsOpen.size > 512) return; // bounded (a leak of unmatched starts never grows)
      const a = assetId(url, this.origin());
      this.assetsOpen.set(url, {t: this.now(), depth: 1, firstEnd: -1, id: a?.id ?? 'other-origin', category: a?.category ?? 'other'});
    } catch { /* never break a loader */ }
  }

  private assetEnd(url: string, failed: boolean): void {
    if (!this.recording) return;
    try {
      const o = this.assetsOpen.get(url);
      if (!o) return;
      const t = this.now();
      if (o.firstEnd < 0) o.firstEnd = t;
      if (failed) { this.assetsOpen.delete(url); this.capture.event(t, 'asset.error', t - o.t, {id: o.id, category: o.category}); return; }
      if (--o.depth > 0) return;
      this.assetsOpen.delete(url);
      const data: Record<string, unknown> = {id: o.id, category: o.category};
      if (o.firstEnd < t - 0.05) { data.fetchedMs = r2(o.firstEnd - o.t); data.parseMs = r2(t - o.firstEnd); }
      this.capture.event(t, o.category === 'embedded-image' ? 'asset.image' : 'asset.load', t - o.t, data);
    } catch { /* never break a loader */ }
  }

  private installObservers(): void {
    this.loafType = null;
    this.resourceTiming = false;
    this.crossOrigin = 0;
    const PO = this.opts.observer !== undefined ? this.opts.observer : (globalThis as {PerformanceObserver?: ObserverCtor}).PerformanceObserver;
    if (!PO) return;
    const types = PO.supportedEntryTypes ?? [];
    const origin = this.origin();
    const lt = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null;
    if (lt) {
      try {
        const o = new PO(list => { if (!this.recording) return; for (const e of list.getEntries()) this.longEntry(e as LoafLike, lt, origin); });
        o.observe({type: lt, buffered: false});
        this.observers.push(o);
        this.loafType = lt;
      } catch { this.loafType = null; }
    }
    if (types.includes('resource')) {
      try {
        const o = new PO(list => { if (!this.recording) return; for (const e of list.getEntries()) this.resourceEntry(e as ResourceLike, origin); });
        o.observe({type: 'resource', buffered: false});
        this.observers.push(o);
        this.resourceTiming = true;
      } catch { this.resourceTiming = false; }
    }
  }

  private longEntry(e: LoafLike, type: 'long-animation-frame' | 'longtask', origin: string | null): void {
    try {
      const scripts = (Array.isArray(e.scripts) ? e.scripts.slice() : []).sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0)).slice(0, 3).map(s => ({
        invokerType: str(s.invokerType, 32) ?? '', invoker: sanitizeInvoker(s.invoker, origin), fn: (str(s.sourceFunctionName, 64) ?? '').replace(/[^\w$.<> -]/g, '_'),
        source: typeof s.sourceURL === 'string' && s.sourceURL ? assetId(s.sourceURL, origin)?.id ?? 'other-origin' : '',
        ms: r2(s.duration ?? 0), forcedLayoutMs: typeof s.forcedStyleAndLayoutDuration === 'number' ? r2(s.forcedStyleAndLayoutDuration) : null,
      }));
      const entry: LongFrameEntry = {start: e.startTime ?? 0, duration: e.duration ?? 0, blocking: typeof e.blockingDuration === 'number' ? e.blockingDuration : null,
        renderStart: typeof e.renderStart === 'number' ? e.renderStart : null, styleAndLayoutStart: typeof e.styleAndLayoutStart === 'number' ? e.styleAndLayoutStart : null, scripts, type};
      this.capture.longFrame(entry);
    } catch { /* malformed entry */ }
  }

  private resourceEntry(e: ResourceLike, origin: string | null): void {
    try {
      const a = assetId(e.name ?? '', origin);
      if (!a || a.category === 'embedded-image') { this.crossOrigin++; return; }
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const transfer = num(e.transferSize), decoded = num(e.decodedBodySize);
      const end = num(e.responseEnd), start = num(e.startTime) ?? 0;
      this.capture.resource({start, duration: end !== null && end > 0 ? end - start : num(e.duration) ?? 0, id: a.id, category: a.category,
        initiator: str(e.initiatorType, 24) ?? '', transferBytes: transfer, encodedBytes: num(e.encodedBodySize), decodedBytes: decoded,
        cache: transfer === 0 && (decoded ?? 0) > 0 ? 'hit' : (transfer ?? 0) > 0 ? 'network' : 'unknown'});
    } catch { /* malformed entry */ }
  }

  private installPage(): void {
    const doc = this.opts.doc !== undefined ? this.opts.doc : typeof document !== 'undefined' ? document : null;
    const win = this.opts.win !== undefined ? this.opts.win : typeof window !== 'undefined' ? window : null;
    if (doc) {
      const onVis = () => {
        if (!this.recording) return;
        const t = this.now();
        if (doc.hidden) {
          this.hiddenAt = t;
          this.capture.markGap();
          this.capture.event(t, 'page.hidden', null);
        } else {
          const was = this.hiddenAt;
          this.hiddenAt = -1;
          this.capture.event(t, 'page.visible', null, {hiddenMs: was >= 0 ? r2(t - was) : null});
          if (was >= 0 && t - was >= HIDDEN_STOP_MS) void this.stop('hidden', 'auto');
        }
      };
      doc.addEventListener('visibilitychange', onVis);
      this.unlisten.push(() => doc.removeEventListener('visibilitychange', onVis));
    }
    if (win) {
      const onBlur = () => { if (!this.recording) return; this.focused = false; this.capture.event(this.now(), 'window.blur', null); };
      const onFocus = () => { if (!this.recording) return; this.focused = true; this.capture.event(this.now(), 'window.focus', null); };
      win.addEventListener('blur', onBlur);
      win.addEventListener('focus', onFocus);
      this.unlisten.push(() => { win.removeEventListener('blur', onBlur); win.removeEventListener('focus', onFocus); });
    }
  }

  private installGpu(): void {
    const ov = this.opts.overlay;
    if (!ov || !this.gpuWanted) return;
    try {
      ov.setGpuTap((frameId, ms) => { if (this.recording) this.capture.gpuResult(frameId, ms); });
      this.gpuTap = true;
    } catch { this.gpuTap = false; }
  }
}

interface SectionKeyLike { level?: string; section?: string; station?: string }
interface LoafLike {
  startTime?: number; duration?: number; blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number;
  scripts?: {invokerType?: unknown; invoker?: unknown; sourceFunctionName?: unknown; sourceURL?: unknown; duration?: number; forcedStyleAndLayoutDuration?: number}[];
}
interface ResourceLike { name?: string; startTime?: number; responseEnd?: number; duration?: number; initiatorType?: unknown; transferSize?: unknown; encodedBodySize?: unknown; decodedBodySize?: unknown }

/** A LoAF script invoker without URLs / query strings ("https://host/a/index-x.js" -> "index-x.js"; "IMG#x.onload" kept). */
export function sanitizeInvoker(v: unknown, origin: string | null): string {
  if (typeof v !== 'string') return '';
  if (v.includes('://') || v.startsWith('blob:') || v.startsWith('data:')) return assetId(v, origin)?.id ?? 'other-origin';
  return v.split('?')[0].slice(0, 64).replace(/[^\w$.#<>:() -]/g, '_');
}

function heapApi(): {usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number} | null {
  const m = (globalThis.performance as {memory?: {usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number}} | undefined)?.memory;
  return m && typeof m.usedJSHeapSize === 'number' ? m : null;
}

/** This module's bundle chunk URL (import.meta.url) — only its basename / hash is ever reported. */
function buildUrl(): string | null {
  try { return typeof import.meta.url === 'string' ? import.meta.url : null; } catch { return null; }
}

/** The build identity from what the bundle already carries (never guessed). */
export function buildIdentity(): Record<string, unknown> {
  const url = buildUrl();
  const hash = chunkHash(url);
  const env = (import.meta as unknown as {env?: Record<string, unknown>}).env;
  return {
    label: SAVE_BUILD,
    mode: typeof env?.MODE === 'string' ? env.MODE : null,
    buildHash: hash,
    bundleChunk: hash && url ? url.split('#')[0].split('?')[0].split('/').pop() ?? null : null,
    gameNumber: null,
    sourceCommit: null,
    note: 'the game bundle carries no GAME number or source commit; buildHash is the content hash in the bundle chunk name, which the CI artifact manifest (manifest.json files[]) lists for its exact source commit',
  };
}
