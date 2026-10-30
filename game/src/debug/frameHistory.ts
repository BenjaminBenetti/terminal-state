// Debug overlay (Ctrl+Shift+P, debug/overlay.ts): bounded per-frame timing history and its summaries. Pure — no DOM,
// no renderer — so the statistics are unit tested (tests/debug-overlay.test.ts).
//
// One slot per animation frame, in fixed typed arrays (~13 KB). A slot is the interval from one rAF callback to the
// next, together with the work the game did in the callback that OPENED it (that work is what delays the next rAF):
//  - interval: rAF timestamp to rAF timestamp (ms) — the frame time the player sees, including vsync waits, GC, the
//    browser's own work and anything else on the main thread or GPU that delayed the frame;
//  - cpu / update / render: main-thread ms spent inside the game's own frame callback (world update; render =
//    scene traversal + command encoding / submission on the CPU — NOT GPU execution);
//  - gpu: GPU ms of that callback's render passes, filled in asynchronously by timestamp queries when the backend
//    supports them (NaN = unknown);
//  - flags: the game drew in that callback (menus redraw at 4 Hz, the warm-up skips the loop), or the slot is a GAP.
//
// A gap is an interval the page was not running frames for (tab in the background, window occluded / suspended,
// debugger): it is kept and drawn as a gap but excluded from FPS / percentile statistics. Real stutters while the
// page is visible are never smoothed or dropped — every slot is one real frame.

export const HISTORY_FRAMES = 360;
/** Longer rAF intervals than this are treated as a suspension gap even without a visibilitychange. */
export const GAP_MS = 3000;
/** Statistics window for FPS / CPU / GPU averages (ms of frames). */
export const RECENT_MS = 1000;
/** Graph target lines: 60 and 30 frames per second. */
export const TARGET_LINES_MS = [1000 / 60, 1000 / 30] as const;
/** Graph scales (ms at the top edge); the smallest that holds the window's 95th percentile wins. */
export const GRAPH_SCALES_MS = [1000 / 30, 50, 100, 250, 500, 1000] as const;

const RENDERED = 1, GAP = 2;

export interface FrameSample {
  /** requestAnimationFrame timestamp of this frame (ms). */
  time: number;
  /** Main-thread ms of the game's whole frame callback. */
  cpuMs: number;
  /** Main-thread ms of the world update inside it (0 when the world did not update). */
  updateMs: number;
  /** Main-thread ms of render() inside it: traversal + command encoding / submission (0 when nothing was drawn). */
  renderMs: number;
  /** The game drew this frame. */
  rendered: boolean;
  /** renderer.info.frame of this frame (matches the asynchronous GPU timings); -1 when nothing was drawn. */
  frameId: number;
}

export interface FrameSummary {
  /** Frames (rAF callbacks) per second over the last ~1 s of non-gap frames; null before two frames. */
  fps: number | null;
  /** Frames the game drew per second over the same window. */
  renderedPerSec: number | null;
  /** The newest frame's interval (ms); null if it was a gap or there is none. */
  lastMs: number | null;
  /** Over the whole history (non-gap frames): mean / median / 95th / 99th percentile / max interval (ms). */
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  /** Non-gap frames in the history and the time they span (ms). */
  frames: number;
  spanMs: number;
  /** Frames over 33.3 ms / 50 ms in the history. */
  over33: number;
  over50: number;
  /** Gaps in the history and the newest gap's length (ms). */
  gaps: number;
  lastGapMs: number | null;
  /** Game frame callback / update / render main-thread ms over the recent window: mean (cpu also max). */
  cpuAvgMs: number | null;
  cpuMaxMs: number | null;
  updateAvgMs: number | null;
  renderAvgMs: number | null;
  /** GPU render-pass ms (timestamp queries) over the frames of the recent window that have a result. */
  gpuAvgMs: number | null;
  gpuMaxMs: number | null;
  gpuSamples: number;
  /** The newest frame that has a GPU result. */
  gpuLastMs: number | null;
}

export class FrameHistory {
  readonly capacity: number;
  readonly interval: Float32Array;
  readonly cpu: Float32Array;
  readonly update: Float32Array;
  readonly render: Float32Array;
  readonly gpu: Float32Array;
  readonly frameId: Float64Array;
  readonly flags: Uint8Array;
  /** Next slot to write. */
  head = 0;
  /** Filled slots (<= capacity). */
  count = 0;
  /** Slots ever written (the overlay redraws only when this moved). */
  pushed = 0;
  private gapPending = false;
  // the newest callback's sample: it becomes a slot when the next rAF timestamp closes its interval
  private hasOpen = false;
  private open = {time: 0, cpu: 0, update: 0, render: 0, rendered: false, frameId: -1, gpu: NaN};
  private readonly scratch: Float32Array;

  constructor(capacity = HISTORY_FRAMES) {
    this.capacity = Math.max(2, Math.floor(capacity));
    const n = this.capacity;
    this.interval = new Float32Array(n);
    this.cpu = new Float32Array(n);
    this.update = new Float32Array(n);
    this.render = new Float32Array(n);
    this.gpu = new Float32Array(n).fill(NaN);
    this.frameId = new Float64Array(n).fill(-1);
    this.flags = new Uint8Array(n);
    this.scratch = new Float32Array(n);
  }

  /** The page stopped producing frames (e.g. went to the background): the next interval is a gap. */
  markGap(): void {
    this.gapPending = true;
  }

  /**
   * Record one animation frame's callback. Its timestamp closes the previous callback's interval, which becomes a
   * slot with that previous callback's work; the first callback only opens an interval.
   */
  push(s: FrameSample): void {
    const o = this.open;
    if (this.hasOpen) {
      const interval = Math.max(0, s.time - o.time);
      const gap = this.gapPending || interval > GAP_MS;
      const i = this.head;
      this.interval[i] = interval;
      this.cpu[i] = o.cpu;
      this.update[i] = o.update;
      this.render[i] = o.render;
      this.gpu[i] = o.gpu;
      this.frameId[i] = o.rendered ? o.frameId : -1;
      this.flags[i] = (o.rendered ? RENDERED : 0) | (gap ? GAP : 0);
      this.head = (i + 1) % this.capacity;
      this.count = Math.min(this.count + 1, this.capacity);
      this.pushed++;
    }
    this.gapPending = false;
    this.hasOpen = true;
    o.time = s.time;
    o.cpu = s.cpuMs;
    o.update = s.updateMs;
    o.render = s.renderMs;
    o.rendered = s.rendered;
    o.frameId = s.rendered ? s.frameId : -1;
    o.gpu = NaN;
  }

  /** Slot of the k-th newest sample (k = 0: newest). */
  slot(k: number): number {
    return (this.head - 1 - k + this.capacity * 2) % this.capacity;
  }

  isGap(slot: number): boolean { return (this.flags[slot] & GAP) !== 0; }
  isRendered(slot: number): boolean { return (this.flags[slot] & RENDERED) !== 0; }

  /** Store an asynchronous GPU result for the frame with this renderer frame id; false when it left the history. */
  assignGpu(frameId: number, ms: number): boolean {
    if (!(frameId >= 0) || !Number.isFinite(ms)) return false;
    if (this.hasOpen && this.open.frameId === frameId) { this.open.gpu = ms; return true; }
    for (let k = 0; k < this.count; k++) {
      const i = this.slot(k);
      if (this.frameId[i] === frameId) { this.gpu[i] = ms; return true; }
      if (this.frameId[i] >= 0 && this.frameId[i] < frameId) return false; // older frames only from here on
    }
    return false;
  }

  /** Forget everything (e.g. after a renderer device loss). */
  clear(): void {
    this.head = this.count = 0;
    this.hasOpen = false;
    this.gapPending = false;
    this.gpu.fill(NaN);
    this.frameId.fill(-1);
    this.flags.fill(0);
  }

  summary(): FrameSummary {
    const s: FrameSummary = {
      fps: null, renderedPerSec: null, lastMs: null, avgMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null,
      frames: 0, spanMs: 0, over33: 0, over50: 0, gaps: 0, lastGapMs: null,
      cpuAvgMs: null, cpuMaxMs: null, updateAvgMs: null, renderAvgMs: null, gpuAvgMs: null, gpuMaxMs: null, gpuSamples: 0, gpuLastMs: null,
    };
    if (this.count === 0) return s;
    const newest = this.slot(0);
    if (!this.isGap(newest)) s.lastMs = this.interval[newest];
    // whole history: distribution of non-gap intervals
    let n = 0, sum = 0, max = 0;
    for (let k = 0; k < this.count; k++) {
      const i = this.slot(k);
      if (this.isGap(i)) {
        s.gaps++;
        if (s.lastGapMs === null) s.lastGapMs = this.interval[i];
        continue;
      }
      const v = this.interval[i];
      this.scratch[n++] = v;
      sum += v;
      if (v > max) max = v;
      if (v > TARGET_LINES_MS[1]) s.over33++;
      if (v > 50) s.over50++;
    }
    if (n > 0) {
      s.frames = n;
      s.spanMs = sum;
      s.avgMs = sum / n;
      s.maxMs = max;
      const sorted = this.scratch.subarray(0, n).sort();
      s.p50Ms = quantile(sorted, 0.5);
      s.p95Ms = quantile(sorted, 0.95);
      s.p99Ms = quantile(sorted, 0.99);
    }
    // recent window (newest frames back to ~1 s, stopping at a gap)
    let win = 0, winMs = 0, rendered = 0, cpuSum = 0, cpuMax = 0, upd = 0, ren = 0, renN = 0, updN = 0, gpuSum = 0, gpuMax = 0, gpuN = 0;
    for (let k = 0; k < this.count && winMs < RECENT_MS; k++) {
      const i = this.slot(k);
      if (this.isGap(i)) break;
      win++;
      winMs += this.interval[i];
      cpuSum += this.cpu[i];
      if (this.cpu[i] > cpuMax) cpuMax = this.cpu[i];
      if (this.update[i] > 0) { upd += this.update[i]; updN++; }
      if (this.isRendered(i)) { rendered++; ren += this.render[i]; renN++; }
      const g = this.gpu[i];
      if (g === g) { gpuSum += g; gpuN++; if (g > gpuMax) gpuMax = g; }
    }
    if (win > 0 && winMs > 0) {
      s.fps = win / (winMs / 1000);
      s.renderedPerSec = rendered / (winMs / 1000);
      s.cpuAvgMs = cpuSum / win;
      s.cpuMaxMs = cpuMax;
      s.updateAvgMs = updN > 0 ? upd / updN : null;
      s.renderAvgMs = renN > 0 ? ren / renN : null;
    }
    if (gpuN > 0) { s.gpuAvgMs = gpuSum / gpuN; s.gpuMaxMs = gpuMax; s.gpuSamples = gpuN; }
    for (let k = 0; k < this.count; k++) {
      const g = this.gpu[this.slot(k)];
      if (g === g) { s.gpuLastMs = g; break; }
    }
    return s;
  }
}

/** Linear-interpolated quantile of an ascending array. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = Math.min(1, Math.max(0, q)) * (n - 1);
  const lo = Math.floor(pos), hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Graph top edge (ms): the smallest scale holding the window's 95th percentile with ~15 % headroom, so the
 * typical frames stay readable; rarer spikes above it are drawn clipped with a marker and reported as max.
 */
export function graphScaleMs(p95Ms: number | null): number {
  const need = (p95Ms ?? 0) * 1.15;
  for (const s of GRAPH_SCALES_MS) if (need <= s) return s;
  return GRAPH_SCALES_MS[GRAPH_SCALES_MS.length - 1];
}
