// Debug overlay (Ctrl+Shift+P): asynchronous GPU render-pass timing through three r186's own timestamp-query pools.
//
// What is measured: the GPU duration of each render pass (begin → end timestamp), summed per frame. Shadow-map,
// scene, fog / post and viewmodel passes are all render passes; the game runs no compute passes. Gaps between passes,
// the browser's compositor and other pages' GPU work are NOT included, so this is GPU work time of this page's frame,
// not GPU utilization (no browser API exposes that).
//
//  - WebGPU backend: the 'timestamp-query' device feature (three requests every feature the adapter offers). Browsers
//    may quantize the timestamps (Chrome: 100 µs by default) — small passes can read 0 or one quantum.
//  - WebGL 2 fallback: EXT_disjoint_timer_query_webgl2 (TIME_ELAPSED around each render call); many browsers / drivers
//    do not expose it.
//
// Availability is read from the INITIALIZED backend (device features / the extension three obtained), never from API
// existence. Tracking is switched on only while the overlay is visible (backend.trackTimestamp is a plain flag three
// checks per pass, so no renderer re-initialization). Results come back through three's resolveTimestampsAsync:
// a buffer mapAsync (WebGPU) or QUERY_RESULT_AVAILABLE polling (WebGL) — no synchronous readback. At most one resolve
// is in flight; three's pools hold at most 2048 queries (1024 passes) and recycle on overflow, so nothing queues up.

export type GpuTimingKind = 'webgpu-timestamp-query' | 'webgl2-disjoint-timer-query';

export interface GpuTimingSupport {
  available: boolean;
  kind: GpuTimingKind | null;
  /** Short reason / caveat for the overlay. */
  note: string;
}

/** The parts of three's WebGPUBackend / WebGLBackend this module touches. */
export interface TimingBackendLike {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: {features?: {has(name: string): boolean}} | null;
  /** WebGL backend: the EXT_disjoint_timer_query_webgl2 extension object, null when not exposed. */
  disjoint?: unknown;
  trackTimestamp?: boolean;
  initTimestampQuery?: (type: string, uid: string, descriptor?: {timestampWrites?: unknown}) => void;
  timestampQueryPool?: Record<string, {timestamps?: Map<string, number>} | null | undefined>;
}

export interface TimingRendererLike {
  initialized?: boolean;
  backend: TimingBackendLike;
  resolveTimestampsAsync(type?: string): Promise<number | undefined>;
}

export function gpuTimingSupport(backend: TimingBackendLike | null | undefined): GpuTimingSupport {
  if (!backend) return {available: false, kind: null, note: 'renderer not initialized'};
  if (backend.isWebGPUBackend === true) {
    let has = false;
    try { has = backend.device?.features?.has('timestamp-query') === true; } catch { has = false; }
    return has
      ? {available: true, kind: 'webgpu-timestamp-query', note: 'WebGPU timestamp-query; browser-quantized (Chrome: 0.1 ms)'}
      : {available: false, kind: null, note: "this WebGPU device has no 'timestamp-query' feature (not exposed by the browser / adapter)"};
  }
  if (backend.isWebGLBackend === true) {
    return backend.disjoint
      ? {available: true, kind: 'webgl2-disjoint-timer-query', note: 'EXT_disjoint_timer_query_webgl2 (per render call)'}
      : {available: false, kind: null, note: 'EXT_disjoint_timer_query_webgl2 is not exposed by this browser / driver'};
  }
  return {available: false, kind: null, note: 'unknown renderer backend'};
}

export interface FrameGpuTotal {
  /** renderer.info.frame of the frame. */
  frame: number;
  /** Sum of that frame's render-pass GPU durations (ms). */
  ms: number;
  passes: number;
}

/**
 * Per-frame totals from a three timestamp pool's resolved `timestamps` (uid → ms). three keys every pass as
 * `r:<call>:<context id>:f<renderer.info.frame>`; the game's passes of one animation frame share that frame number.
 * Ascending by frame.
 */
export function frameTotals(timestamps: Iterable<[string, number]>): FrameGpuTotal[] {
  const by = new Map<number, FrameGpuTotal>();
  for (const [uid, ms] of timestamps) {
    const m = /:f(\d+)$/.exec(uid);
    if (!m || !Number.isFinite(ms)) continue;
    const frame = Number(m[1]);
    const t = by.get(frame);
    if (t) { t.ms += ms; t.passes++; } else by.set(frame, {frame, ms, passes: 1});
  }
  return [...by.values()].sort((a, b) => a.frame - b.frame);
}

export class GpuTimer {
  private support: GpuTimingSupport | null = null;
  private wrapped = false;
  private pending = false;
  private lastFrame = -1;
  private failures = 0;
  /** Tracking is on (overlay visible, backend supports it). */
  enabled = false;
  /** Passes in the newest resolved frame. */
  lastPasses = 0;
  /** Set when resolving failed repeatedly (tracking is then switched off for the session). */
  error: string | null = null;

  constructor(private readonly renderer: TimingRendererLike) {}

  /** What the initialized backend supports (null until the renderer is initialized). */
  status(): GpuTimingSupport | null {
    if (this.support) return this.support;
    if (!this.renderer.initialized) return null;
    this.support = gpuTimingSupport(this.renderer.backend);
    return this.support;
  }

  /** Switch tracking on / off (overlay shown / hidden, warm-up running). Never touches an unsupported backend. */
  setEnabled(on: boolean): void {
    const s = this.status();
    const want = on && !!s?.available && this.error === null;
    if (want === this.enabled) return;
    const b = this.renderer.backend;
    if (want) this.wrapDescriptorReset(b);
    if (s?.available) b.trackTimestamp = want;
    this.enabled = want;
  }

  /**
   * three caches its WebGPU render-pass descriptors and only ever SETS `timestampWrites` on them while tracking: once
   * tracking stops, cached descriptors would keep writing into the old query slots. Clear the field for passes begun
   * while tracking is off, so a hidden overlay leaves no timestamp writes behind. (WebGL passes have no descriptor.)
   */
  private wrapDescriptorReset(b: TimingBackendLike): void {
    if (this.wrapped || b.isWebGPUBackend !== true || typeof b.initTimestampQuery !== 'function') return;
    this.wrapped = true;
    const inner = b.initTimestampQuery;
    b.initTimestampQuery = function (this: TimingBackendLike, type, uid, descriptor) {
      if (!b.trackTimestamp && descriptor && descriptor.timestampWrites !== undefined) descriptor.timestampWrites = undefined;
      return inner.call(this, type, uid, descriptor);
    };
  }

  /** Start one asynchronous resolve unless one is already in flight; new per-frame totals go to `onFrame`. */
  poll(onFrame: (t: FrameGpuTotal) => void): void {
    if (!this.enabled || this.pending) return;
    this.pending = true;
    const b = this.renderer.backend;
    this.renderer.resolveTimestampsAsync('render').then(() => {
      this.failures = 0;
      const pool = b.timestampQueryPool?.render;
      if (!pool?.timestamps || pool.timestamps.size === 0) return;
      for (const t of frameTotals(pool.timestamps)) {
        if (t.frame <= this.lastFrame) continue; // the pool returns its previous batch when nothing new was recorded
        this.lastFrame = t.frame;
        this.lastPasses = t.passes;
        onFrame(t);
      }
    }).catch((err: unknown) => {
      if (++this.failures >= 3) {
        this.error = `GPU timing stopped: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
        this.setEnabledOff();
      }
    }).finally(() => { this.pending = false; });
  }

  private setEnabledOff(): void {
    const s = this.status();
    if (s?.available) this.renderer.backend.trackTimestamp = false;
    this.enabled = false;
  }
}
