// Debug overlay (Ctrl+Shift+P): frame history / stutter statistics, GPU timestamp timing (against three r186's real
// WebGPU / WebGL backends initialized on a mocked device / context, as in backend.test.ts), the shortcut and the
// overlay's hidden / shown cost and labels (fake DOM).
import {afterEach, describe, expect, it, vi} from 'vitest';
import {FrameHistory, GAP_MS, GRAPH_SCALES_MS, HISTORY_FRAMES, graphScaleMs, quantile, type FrameSample} from '../src/debug/frameHistory';
import {GpuTimer, frameTotals, gpuTimingSupport, type TimingBackendLike, type TimingRendererLike} from '../src/debug/gpuTimer';
import {CpuPressureWatch, LongFrameWatch, summarizeLongFrames} from '../src/debug/browserSignals';
import {PerfOverlay, TEXT_MS, count, installPerfOverlay, isOverlayToggle} from '../src/debug/overlay';
import {createGameRenderer, describeBackend, rendererRequest, type GpuInfo} from '../src/render/backend';
import {FrameBudget} from '../src/core/frameBudget'; // task frame-budget-deferral-20261030 (lane SCHED)

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sample = (time: number, o: Partial<FrameSample> = {}): FrameSample =>
  ({time, cpuMs: 4, updateMs: 1.5, renderMs: 2, rendered: true, frameId: -1, ...o});

/** Push frames at a fixed interval starting after `t0`; returns the last timestamp. */
function run(h: FrameHistory, frames: number, interval: number, t0 = 0, o: (k: number) => Partial<FrameSample> = () => ({})): number {
  let t = t0;
  for (let k = 0; k < frames; k++) { t += interval; h.push(sample(t, o(k))); }
  return t;
}

describe('frame history', () => {
  it('pairs each rAF interval with the work of the callback that opened it (the work that delayed the next frame)', () => {
    const h = new FrameHistory(8);
    h.push(sample(0, {cpuMs: 40, renderMs: 30, updateMs: 9}));
    expect(h.count).toBe(0); // one timestamp opens an interval, it is not a frame time yet
    h.push(sample(45, {cpuMs: 3}));
    const i = h.slot(0);
    expect(h.interval[i]).toBe(45);
    expect(h.cpu[i]).toBe(40); // the 40 ms callback is what made this interval 45 ms
    expect(h.render[i]).toBe(30);
    expect(h.update[i]).toBe(9);
  });

  it('is bounded: fixed typed arrays, the oldest frames are overwritten', () => {
    const h = new FrameHistory();
    expect(h.capacity).toBe(HISTORY_FRAMES);
    const before = h.interval.buffer;
    run(h, HISTORY_FRAMES * 3, 16.7);
    expect(h.count).toBe(HISTORY_FRAMES);
    expect(h.interval.buffer).toBe(before);
    expect(h.interval.length).toBe(HISTORY_FRAMES);
  });

  it('keeps a genuine spike exactly (no smoothing): max, p99 and the >33 / >50 ms counts see it', () => {
    const h = new FrameHistory();
    let t = run(h, 200, 1000 / 60);
    t += 120; h.push(sample(t)); // one 120 ms hitch
    t = run(h, 30, 1000 / 60, t);
    const s = h.summary();
    expect(s.maxMs).toBeCloseTo(120, 3);
    expect(s.over50).toBe(1);
    expect(s.over33).toBe(1);
    expect(s.p50Ms).toBeCloseTo(16.667, 2);
    expect(s.gaps).toBe(0);
    // the graph scale follows the 95th percentile, so the spike is drawn clipped (capped) rather than flattening the rest
    expect(graphScaleMs(s.p95Ms)).toBe(GRAPH_SCALES_MS[0]);
  });

  it('a long freeze while the page is visible is a stutter, not a gap', () => {
    const h = new FrameHistory();
    let t = run(h, 10, 16.7);
    t += 2000; h.push(sample(t));
    const s = h.summary();
    expect(s.gaps).toBe(0);
    expect(s.maxMs).toBeCloseTo(2000, 3);
  });

  it('a freeze inside the game’s own callback counts however long (e.g. first-frame shader compiles on a software GL)', () => {
    // browser spot check: the first frame after a warmup=off load compiled every program for 76 s on llvmpipe
    const h = new FrameHistory();
    let t = run(h, 10, 16.7);
    h.push(sample(t + 1, {cpuMs: 76400})); // this callback blocks...
    t += 1 + 76500; h.push(sample(t)); // ...so the next rAF comes 76.5 s later
    run(h, 5, 16.7, t);
    const s = h.summary();
    expect(s.gaps).toBe(0);
    expect(s.maxMs).toBeCloseTo(76500, 0);
    expect(s.over50).toBe(1);
  });

  it('background / suspension gaps are kept as gaps but excluded from FPS and frame statistics', () => {
    const h = new FrameHistory();
    let t = run(h, 60, 1000 / 60);
    h.markGap(); // visibilitychange: hidden
    t += 12000; h.push(sample(t));
    t = run(h, 5, 1000 / 60, t);
    let s = h.summary();
    expect(s.gaps).toBe(1);
    expect(s.lastGapMs).toBeCloseTo(12000, 3);
    expect(s.maxMs).toBeLessThan(17); // the 12 s gap is not a frame time
    expect(s.fps).toBeCloseTo(60, 0); // the FPS window stops at the gap (5 frames after it)
    // a suspension without a visibility event (rAF stopped > GAP_MS beyond the game's own work) is a gap too
    t += GAP_MS + 100; h.push(sample(t));
    s = h.summary();
    expect(s.gaps).toBe(2);
    expect(s.maxMs).toBeLessThan(17);
  });

  it('FPS / drawn-per-second over the last second; menu frames that only redraw at 4 Hz are counted apart', () => {
    const h = new FrameHistory();
    run(h, 120, 1000 / 60, 0, k => ({rendered: k % 15 === 0, renderMs: k % 15 === 0 ? 2 : 0, updateMs: 0}));
    const s = h.summary();
    expect(s.fps).toBeCloseTo(60, 0);
    expect(s.renderedPerSec).toBeCloseTo(4, 0);
    expect(s.updateAvgMs).toBeNull(); // no world update in menus
  });

  it('matches asynchronous GPU results to their frames (also the newest, still-open one)', () => {
    const h = new FrameHistory();
    let t = 0;
    for (let f = 100; f < 110; f++) { t += 16.7; h.push(sample(t, {frameId: f})); }
    expect(h.assignGpu(105, 6.5)).toBe(true);
    expect(h.assignGpu(109, 7.5)).toBe(true); // open (its interval is not closed yet)
    expect(h.assignGpu(50, 1)).toBe(false); // left the history
    expect(h.assignGpu(105.5, 1)).toBe(false);
    h.push(sample(t + 16.7, {frameId: 110}));
    const s = h.summary();
    expect(s.gpuSamples).toBe(2);
    expect(s.gpuAvgMs).toBeCloseTo(7, 5);
    expect(s.gpuMaxMs).toBeCloseTo(7.5, 5);
    expect(s.gpuLastMs).toBeCloseTo(7.5, 5);
  });

  it('quantile and graph scale steps', () => {
    expect(quantile(new Float32Array([1, 2, 3, 4]), 0.5)).toBeCloseTo(2.5);
    expect(quantile(new Float32Array([]), 0.5)).toBeNaN();
    expect(graphScaleMs(null)).toBe(GRAPH_SCALES_MS[0]);
    expect(graphScaleMs(40)).toBe(50);
    expect(graphScaleMs(70)).toBe(100);
    expect(graphScaleMs(5000)).toBe(1000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GPU timing

/** A Proxy WebGL 2 context (as backend.test.ts) that optionally exposes EXT_disjoint_timer_query_webgl2. */
function proxyGl(timer: boolean): WebGL2RenderingContext {
  const ext = {TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb};
  const gl: WebGL2RenderingContext = new Proxy({} as WebGL2RenderingContext, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return 0x1000 + (k.length * 7919 + k.charCodeAt(0) * 31 + k.charCodeAt(k.length - 1)) % 60000;
      if (k === 'getParameter') return (p: number) => ([0x0ba2, 0x0c10, 0x0c22, 0x0b73].includes(p) ? new Int32Array([0, 0, 300, 150]) : p === gl.RENDERER ? 'llvmpipe' : 16);
      if (k === 'getSupportedExtensions') return () => (timer ? ['EXT_disjoint_timer_query_webgl2'] : []);
      if (k === 'getExtension') return (n: string) => (timer && n === 'EXT_disjoint_timer_query_webgl2' ? ext : null);
      if (k === 'getContextAttributes') return () => ({antialias: true});
      return () => ({});
    },
  });
  return gl;
}

function fakeCanvas(gl: WebGL2RenderingContext) {
  return {width: 300, height: 150, style: {}, addEventListener() {}, removeEventListener() {},
    getContext: (k: string) => (k === 'webgl2' ? gl : k === 'webgpu' ? {configure() {}, unconfigure() {}, getCurrentTexture: () => ({})} : null)} as unknown as HTMLCanvasElement;
}

function fakeGpu(features: string[]) {
  const device = {
    features: new Set(['core-features-and-limits', ...features]), limits: {maxTextureDimension3D: 2048}, lost: new Promise(() => {}),
    adapterInfo: {vendor: 'testvendor', architecture: 'testarch', device: '', description: 'Mock GPU', isFallbackAdapter: false},
    createTexture: () => ({createView: () => ({}), destroy() {}}), createSampler: () => ({}), createBuffer: () => ({destroy() {}, mapState: 'unmapped'}),
    createQuerySet: vi.fn(() => ({destroy() {}})), queue: {submit() {}, writeBuffer() {}},
  };
  const adapter = {features: new Set(features), requestDevice: async () => device};
  return {requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm'};
}

/** The real three r186 WebGPURenderer, initialized like Game.initRenderer (render/backend.ts). */
async function realRenderer(search: string, nav: Record<string, unknown>, timerExt = false) {
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('GPUBufferUsage', {MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const req = rendererRequest(search, nav as {gpu?: unknown}, true);
  const g = createGameRenderer(fakeCanvas(proxyGl(timerExt)), req);
  await g.renderer.init();
  return {renderer: g.renderer, gpu: describeBackend(g.renderer.backend as never, req, g.fallbackError())};
}

describe('GPU timing availability is read from the initialized backend', () => {
  it('WebGPU with the timestamp-query device feature', async () => {
    const {renderer, gpu} = await realRenderer('', {gpu: fakeGpu(['timestamp-query'])});
    expect(gpu.backend).toBe('webgpu');
    const s = gpuTimingSupport(renderer.backend as unknown as TimingBackendLike);
    expect(s).toMatchObject({available: true, kind: 'webgpu-timestamp-query'});
  });

  it('WebGPU without the feature (API present, adapter does not expose it) is unavailable', async () => {
    const {renderer} = await realRenderer('', {gpu: fakeGpu([])});
    const s = gpuTimingSupport(renderer.backend as unknown as TimingBackendLike);
    expect(s.available).toBe(false);
    expect(s.note).toMatch(/timestamp-query/);
  });

  it('WebGL 2 fallback: only with EXT_disjoint_timer_query_webgl2 — navigator.gpu existing does not matter', async () => {
    const none = await realRenderer('?renderer=webgl2', {gpu: fakeGpu(['timestamp-query'])});
    expect(none.gpu.backend).toBe('webgl2-fallback');
    expect(gpuTimingSupport(none.renderer.backend as unknown as TimingBackendLike)).toMatchObject({available: false});
    vi.unstubAllGlobals();
    const ext = await realRenderer('?renderer=webgl2', {}, true);
    expect(gpuTimingSupport(ext.renderer.backend as unknown as TimingBackendLike)).toMatchObject({available: true, kind: 'webgl2-disjoint-timer-query'});
  });

  it('not initialized -> no claim', () => {
    expect(gpuTimingSupport(null).available).toBe(false);
    const t = new GpuTimer({initialized: false, backend: {}, resolveTimestampsAsync: async () => 0});
    expect(t.status()).toBeNull();
    t.setEnabled(true);
    expect(t.enabled).toBe(false);
  });
});

describe('GPU timing on three r186 (real WebGPUBackend)', () => {
  it('switches tracking at runtime without re-initialization; a hidden overlay leaves no timestamp writes on cached pass descriptors', async () => {
    const {renderer} = await realRenderer('', {gpu: fakeGpu(['timestamp-query'])});
    const b = renderer.backend as unknown as TimingBackendLike & {initTimestampQuery(type: string, uid: string, d: {timestampWrites?: unknown}): void};
    expect(b.trackTimestamp).toBe(false); // the game never asked for it at construction
    const desc: {timestampWrites?: unknown} = {}; // stands in for a cached GPURenderPassDescriptor
    const timer = new GpuTimer(renderer as unknown as TimingRendererLike);
    timer.setEnabled(true);
    expect(b.trackTimestamp).toBe(true);
    b.initTimestampQuery('render', 'r:1:7:f3', desc);
    expect(desc.timestampWrites).toBeDefined();
    timer.setEnabled(false);
    expect(b.trackTimestamp).toBe(false);
    b.initTimestampQuery('render', 'r:1:7:f4', desc);
    expect(desc.timestampWrites).toBeUndefined();
    timer.setEnabled(true);
    b.initTimestampQuery('render', 'r:1:7:f5', desc);
    expect(desc.timestampWrites).toBeDefined();
  });

  it('(why the reset exists) three alone keeps timestampWrites on a cached descriptor after tracking stops', async () => {
    const {renderer} = await realRenderer('', {gpu: fakeGpu(['timestamp-query'])});
    const b = renderer.backend as unknown as {trackTimestamp: boolean; initTimestampQuery(type: string, uid: string, d: {timestampWrites?: unknown}): void};
    const desc: {timestampWrites?: unknown} = {};
    b.trackTimestamp = true;
    b.initTimestampQuery('render', 'r:1:7:f3', desc);
    b.trackTimestamp = false;
    b.initTimestampQuery('render', 'r:1:7:f4', desc);
    expect(desc.timestampWrites).toBeDefined();
  });

  it('never touches an unsupported backend', async () => {
    const {renderer} = await realRenderer('', {gpu: fakeGpu([])});
    const b = renderer.backend as unknown as TimingBackendLike;
    const timer = new GpuTimer(renderer as unknown as TimingRendererLike);
    timer.setEnabled(true);
    expect(timer.enabled).toBe(false);
    expect(b.trackTimestamp).toBe(false);
  });
});

describe('GPU timing resolve', () => {
  it('groups three’s per-pass uids into per-frame totals', () => {
    const t = frameTotals(new Map([['r:1:5:f10', 1.5], ['r:2:9:f10', 2.5], ['r:1:5:f11', 3], ['bogus', 9], ['r:3:9:f10', NaN]]));
    expect(t).toEqual([{frame: 10, ms: 4, passes: 2}, {frame: 11, ms: 3, passes: 1}]);
  });

  function fakeTimingRenderer() {
    const pool = {timestamps: new Map<string, number>()};
    let finish: () => void = () => {};
    const backend: TimingBackendLike = {isWebGLBackend: true, disjoint: {}, trackTimestamp: false, timestampQueryPool: {render: pool}};
    const renderer = {
      initialized: true, backend,
      resolveTimestampsAsync: vi.fn(() => new Promise<number>(r => { finish = () => r(0); })),
    };
    return {renderer, backend, pool, finish: () => finish()};
  }

  it('one resolve in flight at a time; only new frames are reported', async () => {
    const f = fakeTimingRenderer();
    const timer = new GpuTimer(f.renderer);
    const got: number[] = [];
    timer.poll(t => got.push(t.frame)); // disabled: nothing
    expect(f.renderer.resolveTimestampsAsync).not.toHaveBeenCalled();
    timer.setEnabled(true);
    expect(f.backend.trackTimestamp).toBe(true);
    for (let k = 0; k < 10; k++) timer.poll(t => got.push(t.frame));
    expect(f.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
    f.pool.timestamps.set('r:1:5:f20', 2).set('r:2:5:f21', 3);
    f.finish();
    await new Promise(r => setTimeout(r, 0));
    expect(got).toEqual([20, 21]);
    timer.poll(t => got.push(t.frame)); // the pool returns the same batch when nothing new was recorded
    f.finish();
    await new Promise(r => setTimeout(r, 0));
    expect(got).toEqual([20, 21]);
    expect(f.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(2);
  });

  it('repeated resolve failures stop GPU timing with a reason instead of retrying forever', async () => {
    const backend: TimingBackendLike = {isWebGLBackend: true, disjoint: {}, trackTimestamp: false};
    const renderer = {initialized: true, backend, resolveTimestampsAsync: vi.fn(async () => { throw new Error('mapAsync failed'); })};
    const timer = new GpuTimer(renderer);
    timer.setEnabled(true);
    for (let k = 0; k < 3; k++) { timer.poll(() => {}); await new Promise(r => setTimeout(r, 0)); }
    expect(timer.error).toMatch(/mapAsync failed/);
    expect(timer.enabled).toBe(false);
    expect(backend.trackTimestamp).toBe(false);
    timer.setEnabled(true);
    expect(timer.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Browser signals

describe('browser signals', () => {
  it('long animation frames: windowed count / worst; unsupported without the entry type', () => {
    const frames = [{start: 1000, duration: 80, blocking: 30}, {start: 9000, duration: 140, blocking: 90}, {start: 15000, duration: 60, blocking: 10}];
    expect(summarizeLongFrames(frames, 16000)).toEqual({count: 2, worstMs: 140, worstBlockingMs: 90});
    class Obs { static supportedEntryTypes = ['mark']; observe() {} disconnect() {} }
    expect(new LongFrameWatch(Obs as never).supported).toBe(false);
    expect(new LongFrameWatch(undefined).supported).toBe(false);
  });

  it('compute pressure: a coarse state when the browser has the API; a reason otherwise', async () => {
    expect(new CpuPressureWatch(undefined)).toMatchObject({supported: false, state: null, note: 'no Compute Pressure API'});
    let cb: (r: {state: 'fair'}[]) => void = () => {};
    class Ok { static knownSources = ['cpu']; constructor(f: typeof cb) { cb = f; } observe = vi.fn(async () => {}); disconnect = vi.fn(); }
    const w = new CpuPressureWatch(Ok as never);
    w.start();
    cb([{state: 'fair'}]);
    expect(w.state).toBe('fair');
    w.stop();
    expect(w.state).toBeNull();
    class Denied { static knownSources = ['cpu']; observe = async () => { throw Object.assign(new Error('x'), {name: 'NotAllowedError'}); }; disconnect() {} }
    const d = new CpuPressureWatch(Denied as never);
    d.start();
    await new Promise(r => setTimeout(r, 0));
    expect(d.state).toBeNull();
    expect(d.note).toMatch(/refused.*NotAllowedError/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Overlay (fake DOM)

class FakeEl {
  id = '';
  className = '';
  children: FakeEl[] = [];
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  width = 0;
  height = 0;
  writes = 0;
  private text: string | null = '';
  ctx: FakeCtx | null = null;
  constructor(readonly tag: string, private readonly doc: FakeDoc) {}
  get textContent(): string | null { return this.text; }
  set textContent(v: string | null) { this.text = v; this.writes++; this.doc.textWrites++; }
  readonly classList = {
    add: (c: string) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
    remove: (c: string) => { this.className = this.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...xs: (FakeEl | string)[]) { for (const x of xs) if (typeof x !== 'string') this.appendChild(x); }
  appendChild(x: FakeEl) { this.children.push(x); return x; }
  getContext(kind: string) { return kind === '2d' ? (this.ctx ??= new FakeCtx()) : null; }
}

class FakeCtx {
  calls: Record<string, number> = {};
  [k: string]: unknown;
  constructor() {
    for (const m of ['setTransform', 'clearRect', 'fillRect', 'beginPath', 'rect', 'fill', 'stroke', 'moveTo', 'lineTo', 'setLineDash', 'fillText']) {
      this[m] = () => { this.calls[m] = (this.calls[m] ?? 0) + 1; };
    }
  }
}

class FakeDoc {
  textWrites = 0;
  created = 0;
  hidden = false;
  listeners: Record<string, (() => void)[]> = {};
  head: FakeEl;
  body: FakeEl;
  constructor() { this.head = new FakeEl('head', this); this.body = new FakeEl('body', this); }
  createElement(tag: string) { this.created++; return new FakeEl(tag, this); }
  getElementById(id: string): FakeEl | null {
    const walk = (e: FakeEl): FakeEl | null => e.id === id ? e : e.children.map(walk).find(Boolean) ?? null;
    return walk(this.head) ?? walk(this.body);
  }
  addEventListener(type: string, fn: () => void) { (this.listeners[type] ??= []).push(fn); }
}

class FakeWin {
  handlers: {fn: (e: KeyboardEvent) => void; capture: boolean}[] = [];
  addEventListener(type: string, fn: (e: KeyboardEvent) => void, opts?: {capture?: boolean}) { if (type === 'keydown') this.handlers.push({fn, capture: !!opts?.capture}); }
  key(o: Partial<KeyboardEvent> & {code: string}) {
    const e = {key: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...o};
    for (const h of this.handlers) h.fn(e as unknown as KeyboardEvent);
    return e;
  }
}

const FALLBACK: GpuInfo = {
  backend: 'webgl2-fallback', adapter: null, reason: 'forced by ?renderer=webgl2', requested: 'webgl2', webgpuApi: false,
  glRenderer: 'llvmpipe (LLVM 19.1.7, 256 bits)', compatibilityMode: null, label: 'Renderer: WebGL2 (fallback — forced by ?renderer=webgl2)', deviceLost: null, errors: [],
};

function fakeHost(backend: TimingBackendLike = {isWebGLBackend: true, disjoint: null}) {
  const pool = {timestamps: new Map<string, number>()};
  backend.timestampQueryPool ??= {render: pool};
  const host = {
    state: 'playing', warming: false, frameCpu: {updateMs: 2, renderMs: 3, rendered: true}, gpu: FALLBACK as GpuInfo | null,
    settings: {quality: 'high'}, canvas: {width: 1280, height: 720},
    renderer: {
      initialized: true, getPixelRatio: () => 1, backend,
      resolveTimestampsAsync: vi.fn(async () => 0),
      info: {frame: 0, render: {drawCalls: 412, frameCalls: 9, triangles: 1234567, points: 0, lines: 0}, memory: {total: 400 * 1048576, textures: 210, geometries: 980, programs: 133}},
    },
  };
  return {host, pool};
}

/** Drive the overlay like main.ts: one call per animation frame. */
function frames(o: PerfOverlay, host: ReturnType<typeof fakeHost>['host'], n: number, t0: number, dt = 1000 / 60): number {
  let t = t0;
  for (let k = 0; k < n; k++) { t += dt; host.renderer.info.frame++; o.frame(t, 5); }
  return t;
}

describe('Ctrl+Shift+P', () => {
  it('matches Ctrl+Shift+P only (physical P, or P on another layout)', () => {
    const k = (o: Partial<Parameters<typeof isOverlayToggle>[0]>) => isOverlayToggle({code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...o});
    expect(k({})).toBe(true);
    expect(k({code: 'KeyR', key: 'P'})).toBe(true); // Dvorak: P is on the QWERTY R key
    expect(k({ctrlKey: false})).toBe(false); // Shift+P
    expect(k({shiftKey: false, key: 'p'})).toBe(false); // Ctrl+P (print) is left to the browser
    expect(k({altKey: true})).toBe(false);
    expect(k({metaKey: true})).toBe(false);
    expect(k({code: 'KeyO', key: 'O'})).toBe(false);
  });

  it('toggles on/off in the capture phase, swallows the shortcut (and its auto-repeat) from the game, leaves other keys alone', () => {
    const doc = new FakeDoc(), win = new FakeWin(), {host} = fakeHost();
    const o = installPerfOverlay(host, {doc: doc as unknown as Document, win: win as never});
    expect(win.handlers).toHaveLength(1);
    expect(win.handlers[0].capture).toBe(true);
    expect(o.visible).toBe(false); // off by default
    const e1 = win.key({code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true});
    expect(o.visible).toBe(true);
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(e1.stopImmediatePropagation).toHaveBeenCalled(); // game input never sees the P
    const held = win.key({code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true, repeat: true});
    expect(o.visible).toBe(true); // auto-repeat does not flicker it
    expect(held.preventDefault).toHaveBeenCalled();
    expect(held.stopImmediatePropagation).toHaveBeenCalled();
    win.key({code: 'KeyP', key: 'P', ctrlKey: true, shiftKey: true});
    expect(o.visible).toBe(false);
    for (const other of [{code: 'KeyW', key: 'w'}, {code: 'ShiftLeft', key: 'Shift', shiftKey: true}, {code: 'KeyP', key: 'p', ctrlKey: true}, {code: 'Tab', key: 'Tab'}]) {
      const e = win.key(other);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
    }
    expect(host.state).toBe('playing'); // toggling never pauses the game
  });

  it('?perf=1 starts it shown', () => {
    const doc = new FakeDoc(), {host} = fakeHost();
    const o = installPerfOverlay(host, {doc: doc as unknown as Document, win: null, visible: true});
    expect(o.visible).toBe(true);
    expect(doc.getElementById('perf-overlay')).not.toBeNull();
  });

  it('sits on the right-hand side (user request): right-anchored with the same inset, same top, kept inside the viewport', () => {
    const doc = new FakeDoc(), {host} = fakeHost();
    installPerfOverlay(host, {doc: doc as unknown as Document, win: null, visible: true});
    const css = doc.getElementById('perf-overlay-css')!.textContent ?? '';
    const panel = /#perf-overlay \{([^}]*)\}/.exec(css)![1];
    expect(panel).toMatch(/(^|[;\s])right:\s*12px/);
    expect(panel).not.toMatch(/(^|[;\s])left:/);
    expect(panel).toMatch(/(^|[;\s])top:\s*100px/);
    expect(panel).toMatch(/max-width:\s*calc\(100vw - 24px\)/);
  });
});

describe('overlay cost and content', () => {
  it('hidden: only records samples — no DOM, no GPU queries, no observers', () => {
    const doc = new FakeDoc();
    const backend: TimingBackendLike = {isWebGPUBackend: true, device: {features: new Set(['timestamp-query'])}, trackTimestamp: false};
    const {host} = fakeHost(backend);
    const o = new PerfOverlay(host, doc as unknown as Document);
    frames(o, host, 600, 0);
    expect(doc.created).toBe(0);
    expect(backend.trackTimestamp).toBe(false);
    expect(host.renderer.resolveTimestampsAsync).not.toHaveBeenCalled();
    expect(o.history.count).toBe(HISTORY_FRAMES); // the graph has history the moment it opens
  });

  it('shown: DOM built once; text rows refresh at 4 Hz and only when changed; the graph is a constant number of batched fills', () => {
    const doc = new FakeDoc(), {host} = fakeHost();
    const o = new PerfOverlay(host, doc as unknown as Document);
    let t = frames(o, host, 400, 0);
    o.show();
    const built = doc.created;
    expect(doc.getElementById('perf-overlay')?.classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('perf-overlay-css')).not.toBeNull();
    const canvas = doc.getElementById('perf-overlay')!.children.find(c => c.tag === 'canvas')!;
    const ctx = canvas.ctx!;
    const fills0 = ctx.calls.fill ?? 0;
    const writes0 = doc.textWrites;
    t = frames(o, host, 60, t); // 1 s
    expect(doc.created).toBe(built);
    const perFrameFills = ((ctx.calls.fill ?? 0) - fills0) / 60;
    expect(perFrameFills).toBeLessThanOrEqual(11); // 6 severity + gap + cpu + cap + gpu, independent of 360 bars
    expect(ctx.calls.fillRect).toBeLessThanOrEqual(61 + 1); // background only (bars are batched paths)
    // steady numbers: ~4 refreshes in a second, most rows unchanged (no write)
    expect(doc.textWrites - writes0).toBeLessThanOrEqual(Math.ceil(1000 / TEXT_MS) * 4);
    o.hide();
    const writes1 = doc.textWrites, fills1 = ctx.calls.fill;
    frames(o, host, 120, t);
    expect(doc.textWrites).toBe(writes1);
    expect(ctx.calls.fill).toBe(fills1);
  });

  it('labels say what is measured; unsupported metrics say n/a instead of inventing numbers', () => {
    const doc = new FakeDoc(), {host} = fakeHost();
    const o = installPerfOverlay(host, {doc: doc as unknown as Document, win: null, visible: true});
    let t = frames(o, host, 200, 0);
    t += 90; host.renderer.info.frame++; o.frame(t, 70); // a stutter
    frames(o, host, 30, t);
    const {text, summary} = o.snapshot();
    expect(summary.maxMs).toBeCloseTo(90, 3);
    expect(text.frame).toMatch(/90\.0 max/);
    expect(text.spikes).toMatch(/^1 >33 ms · 1 >50 ms in/);
    expect(text.cpu).toMatch(/render submit 3\.0/);
    expect(text.tris).toBe(`${count(1234567)} submitted, all passes`);
    expect(text.draws).toBe('412 · 9 render passes (last drawn frame)');
    expect(text.gpu).toBe('n/a — no EXT_disjoint_timer_query_webgl2');
    expect(text.syscpu).toBe('n/a — no Compute Pressure API');
    expect(text.loaf).toMatch(/^n\/a/); // Node has no long-animation-frame entries
    expect(text.backend).toMatch(/^WebGL2 fallback — forced by \?renderer=webgl2 · llvmpipe/);
    expect(text.output).toBe('1280×720 · DPR 1.00 · quality high');
    expect(text.res).toBe('≈400 MB · tex 210 · geo 980 · prog 133');
    expect(text.state).toBe('playing');
    for (const k of ['gpu', 'syscpu', 'cpu', 'fps']) expect(text[k]).not.toMatch(/%/); // no utilization percentages anywhere
  });

  it('task frame-budget-deferral (lane SCHED): deferred chunks stay inside game CPU, shown as their share; the queue row is read only while shown', () => {
    const doc = new FakeDoc(), {host} = fakeHost();
    const fb = new FrameBudget();
    const diag = vi.spyOn(fb, 'diagnostics');
    const h = Object.assign(host, {frameBudget: fb, frameCpu: {updateMs: 2, renderMs: 3, deferredMs: 1.5, rendered: true}});
    const o = new PerfOverlay(h, doc as unknown as Document);
    let t = frames(o, h, 240, 0);
    expect(diag).not.toHaveBeenCalled(); // hidden: no scheduler read-out at all
    expect(o.history.deferred[o.history.slot(0)]).toBeCloseTo(1.5, 5); // the sample is still recorded (typed array)
    o.show();
    t = frames(o, h, 60, t);
    const {text, summary} = o.snapshot();
    expect(diag).toHaveBeenCalled();
    expect(summary.deferredAvgMs).toBeCloseTo(1.5, 5);
    expect(text.cpu).toMatch(/· deferred 1\.50 \(max 1\.5\)$/); // part of the 5 ms callback the cpu avg already counts
    expect(text.defer).toMatch(/^0 queued · \d+ chunks\/s · \d+ overdue\/s · 0 drops · budget 11\.7 ms @ 60 Hz \(default\)$/);
    o.hide();
    diag.mockClear();
    frames(o, h, 60, t);
    expect(diag).not.toHaveBeenCalled();
  });

  it('GPU ms from timestamp queries when supported; tracking only while shown and not during the warm-up', async () => {
    const backend: TimingBackendLike = {isWebGPUBackend: true, device: {features: new Set(['timestamp-query'])}, trackTimestamp: false};
    const doc = new FakeDoc(), {host, pool} = fakeHost(backend);
    host.gpu = {...FALLBACK, backend: 'webgpu', reason: null, glRenderer: null, compatibilityMode: false,
      adapter: {vendor: 'nvidia', architecture: 'ampere', device: '', description: 'RTX', isFallbackAdapter: false}, label: 'Renderer: WebGPU'};
    host.renderer.resolveTimestampsAsync.mockImplementation(async () => {
      const f = host.renderer.info.frame;
      pool.timestamps.clear();
      pool.timestamps.set(`r:1:5:f${f}`, 2.5).set(`r:2:6:f${f}`, 4);
      return 6.5;
    });
    const o = new PerfOverlay(host, doc as unknown as Document);
    let t = frames(o, host, 10, 0);
    expect(backend.trackTimestamp).toBe(false);
    o.show();
    t = frames(o, host, 3, t);
    expect(backend.trackTimestamp).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    t = frames(o, host, 30, t);
    await new Promise(r => setTimeout(r, 0));
    t = frames(o, host, 20, t);
    const snap = o.snapshot();
    expect(snap.summary.gpuSamples).toBeGreaterThan(0);
    expect(snap.summary.gpuAvgMs).toBeCloseTo(6.5, 5);
    expect(snap.text.gpu).toBe('6.50 avg · 6.50 max · 2 passes (timestamp-query)');
    expect(snap.text.backend).toBe('WebGPU — nvidia ampere RTX');
    host.warming = true;
    frames(o, host, 1, t);
    expect(backend.trackTimestamp).toBe(false);
    host.warming = false;
    frames(o, host, 1, t + 20);
    expect(backend.trackTimestamp).toBe(true);
    o.hide();
    expect(backend.trackTimestamp).toBe(false);
  });

  it('a background tab shows up as a gap, not a giant frame time', () => {
    const doc = new FakeDoc(), {host} = fakeHost();
    const o = installPerfOverlay(host, {doc: doc as unknown as Document, win: null, visible: true});
    let t = frames(o, host, 100, 0);
    doc.hidden = true;
    for (const fn of doc.listeners.visibilitychange ?? []) fn();
    doc.hidden = false;
    t += 30000; host.renderer.info.frame++; o.frame(t, 4);
    frames(o, host, 30, t);
    const s = o.snapshot();
    expect(s.summary.gaps).toBe(1);
    expect(s.summary.maxMs).toBeLessThan(17);
    expect(s.text.spikes).toMatch(/1 gap \(30\.0 s, not counted\)/);
  });
});
