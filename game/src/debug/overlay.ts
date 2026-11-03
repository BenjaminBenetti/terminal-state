// Performance / debug overlay — Ctrl+Shift+P toggles it (off by default; `?perf=1` starts it shown).
//
// Shows: FPS and frame times (rAF interval) with a rolling frame-time graph; this game's main-thread CPU time (world
// update, render submission); GPU render-pass time from timestamp queries where the backend supports them; renderer
// counters (draw calls, passes, submitted triangles, three-tracked GPU resources); the backend that actually
// initialized; and, where the browser has them, Long Animation Frames, the system's coarse CPU pressure state and the
// JS heap. Anything a browser does not expose (system CPU %, GPU utilization %) is said to be unavailable — never
// estimated.
//
// Cost: while hidden, one sample per frame goes into fixed typed arrays (debug/frameHistory.ts) — the DOM is not even
// built and no GPU queries / observers run. While shown: the graph (one small 2D canvas, a few batched fills) redraws
// every frame, the text rows at 4 Hz and only when their text changed; GPU timing resolves asynchronously, one
// resolve at a time (debug/gpuTimer.ts). Toggling never pauses the game or touches the renderer / world.
//
// The overlay is pointer-events: none (menus stay clickable). Browsers / OSes that reserve Ctrl+Shift+P (e.g.
// Firefox: new private window) never deliver it to the page; `?perf=1` is the fallback there.

import type {GpuInfo} from '../render/backend';
import {backendTag} from '../render/backend';
import {FrameHistory, HISTORY_FRAMES, TARGET_LINES_MS, graphScaleMs, type FrameSummary} from './frameHistory';
import {GpuTimer, type TimingRendererLike} from './gpuTimer';
import {CpuPressureWatch, LongFrameWatch, summarizeLongFrames} from './browserSignals';
import type {FrameBudgetDiagnostics} from '../core/frameBudget'; // task frame-budget-deferral-20261030 (lane SCHED)

/** Task frame-budget-deferral-20261030 (lane SCHED): the scheduler numbers the overlay reads (core/frameBudget.ts FrameBudget). */
export interface DeferralView {
  diagnostics(): Pick<FrameBudgetDiagnostics, 'refresh' | 'budgetMs' | 'held' | 'queued' | 'oldestAgeMs' | 'totals'>;
}

/** What the overlay reads from the game (Game satisfies it). */
export interface PerfHost {
  readonly state: string;
  readonly warming: boolean;
  /** deferredMs (lane SCHED): background chunks inside the same callback (part of its main-thread time). */
  readonly frameCpu: {readonly updateMs: number; readonly renderMs: number; readonly rendered: boolean; readonly deferredMs?: number};
  /** Lane SCHED: the frame-budget scheduler (read only by the 4 Hz text rows while shown). */
  readonly frameBudget?: DeferralView | null;
  readonly gpu: GpuInfo | null;
  readonly settings: {readonly quality: string};
  readonly canvas: {readonly width: number; readonly height: number};
  readonly renderer: {
    readonly initialized: boolean;
    getPixelRatio(): number;
    readonly backend: unknown;
    readonly info: {
      readonly frame: number;
      readonly render: {readonly drawCalls: number; readonly frameCalls: number; readonly triangles: number; readonly points: number; readonly lines: number};
      readonly memory: {readonly total: number; readonly textures: number; readonly geometries: number; readonly programs: number};
    };
  };
}

/** Ctrl+Shift+P (no Alt / Meta): the physical P key, or P on a layout that puts it elsewhere. */
export function isOverlayToggle(e: {code: string; key?: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean}): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.code === 'KeyP' || e.key === 'P' || e.key === 'p');
}

/** Text rows refresh interval (ms). */
export const TEXT_MS = 250;
/** Graph: one CSS pixel column per frame of the history. */
const GRAPH_W = HISTORY_FRAMES, GRAPH_H = 72;

const ROWS = [
  ['fps', 'FPS'],
  ['frame', 'Frame ms'],
  ['spikes', 'Spikes'],
  ['cpu', 'Game CPU ms'],
  ['defer', 'Deferred'], // lane SCHED: background work queue (core/frameBudget.ts)
  ['gpu', 'GPU ms'],
  ['syscpu', 'System CPU'],
  ['loaf', 'Long frames'],
  ['draws', 'Draw calls'],
  ['tris', 'Triangles'],
  ['res', 'GPU memory'],
  ['heap', 'JS heap'],
  ['backend', 'Backend'],
  ['output', 'Output'],
  ['state', 'State'],
] as const;
type RowKey = (typeof ROWS)[number][0];

const COLORS = {
  ok: '#4f8a87', warn: '#d9a520', bad: '#c2463a', gap: 'rgba(185, 177, 156, 0.28)', cpu: 'rgba(8, 9, 10, 0.55)', cpuChip: '#3c3d3d',
  gpu: '#ece4cf', cap: '#ffffff', line: 'rgba(236, 228, 207, 0.35)', label: 'rgba(236, 228, 207, 0.7)', bg: 'rgba(12, 13, 14, 0.6)',
};
/** Bar colours: ≈60 fps or faster (5 % timer tolerance), 30 fps or faster, slower. */
const OK_MS = 1000 / 60 * 1.05;

const CSS = `
#perf-overlay { position: fixed; right: 12px; top: 100px; z-index: 80; width: ${GRAPH_W + 24}px; max-width: calc(100vw - 24px); max-height: calc(100vh - 112px); overflow: hidden;
  box-sizing: border-box; padding: 8px 12px 9px; background: rgba(8, 9, 10, 0.8); border-left: 3px solid #4f8a87; color: #ece4cf;
  pointer-events: none; user-select: none; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace;
  font-weight: 400; letter-spacing: 0; text-shadow: none; }
#perf-overlay .po-head { display: flex; justify-content: space-between; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #b9b19c; margin-bottom: 5px; }
#perf-overlay canvas { display: block; width: ${GRAPH_W}px; height: ${GRAPH_H}px; }
#perf-overlay .po-legend { font-size: 9.5px; color: #b9b19c; margin: 3px 0 6px; white-space: nowrap; }
#perf-overlay .po-legend i { display: inline-block; width: 8px; height: 8px; margin: 0 3px 0 7px; vertical-align: -1px; }
#perf-overlay .po-legend i:first-child { margin-left: 0; }
#perf-overlay dl { display: grid; grid-template-columns: 78px 1fr; gap: 1px 8px; margin: 0; }
#perf-overlay dt { color: #b9b19c; }
#perf-overlay dd { margin: 0; overflow-wrap: anywhere; }
#perf-overlay .po-note { margin-top: 6px; font-size: 9.5px; line-height: 1.35; color: #8f887a; }
`;

const NOTE = 'System CPU % and GPU utilization % are not exposed to web pages. Game CPU = this game’s main-thread JS, '
  + 'deferred background chunks included (Deferred = their queue); '
  + 'render submit is CPU encoding, not GPU work. Draws / triangles: every pass (shadow map, scene, fog / post, viewmodel) '
  + 'after frustum culling, not unique visible triangles.';

const fmt = (v: number | null | undefined, d = 1) => v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d);
/** Frame times: 0.1 ms below 100 ms, whole ms above. */
const fms = (v: number | null | undefined) => fmt(v, v !== null && v !== undefined && v >= 100 ? 0 : 1);
export function count(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)} k`;
  return String(Math.round(n));
}
const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

export interface PerfOverlayOptions {
  doc?: Document | null;
  /** Event target for the shortcut (defaults to the global window). */
  win?: Pick<Window, 'addEventListener'> | null;
  /** Start shown (`?perf=1`). */
  visible?: boolean;
}

export class PerfOverlay {
  readonly history = new FrameHistory();
  readonly gpuTimer: GpuTimer;
  readonly longFrames = new LongFrameWatch();
  readonly pressure = new CpuPressureWatch();
  visible = false;
  /** Set when the overlay itself failed (it hides and stays off; the game is unaffected). */
  failed: string | null = null;
  private el: HTMLElement | null = null;
  private readonly values = new Map<RowKey, HTMLElement>();
  private ctx: CanvasRenderingContext2D | null = null;
  private scaleEl: HTMLElement | null = null;
  private dpr = 1;
  private scale: number = TARGET_LINES_MS[1];
  private lastText = -Infinity;
  private drawn = -1;

  constructor(readonly host: PerfHost, private readonly doc: Document | null = typeof document !== 'undefined' ? document : null) {
    this.gpuTimer = new GpuTimer(host.renderer as unknown as TimingRendererLike);
    doc?.addEventListener('visibilitychange', () => { if (doc.hidden) this.history.markGap(); });
  }

  /**
   * Once per animation frame, after game.frame(): `time` = the rAF timestamp, `cpuMs` = main-thread ms of the game's
   * frame callback. Hidden: records the sample only.
   */
  frame(time: number, cpuMs: number): void {
    const c = this.host.frameCpu;
    this.history.push({time, cpuMs, updateMs: c.updateMs, renderMs: c.renderMs, deferredMs: c.deferredMs ?? 0, rendered: c.rendered, frameId: c.rendered ? this.host.renderer.info.frame : -1});
    if (!this.visible) {
      // task studio-performance-recorder-20261103 (lane RECORDER): a recording keeps GPU timing on with the overlay hidden
      if (this.gpuTap) { try { this.pollGpu(c.rendered); } catch { this.setGpuTap(null); } }
      return;
    }
    try {
      this.pollGpu(c.rendered);
      if (time - this.lastText >= TEXT_MS || time < this.lastText) {
        this.lastText = time;
        this.updateText(time);
      }
      this.drawGraph();
    } catch (err) {
      this.fail(err);
    }
  }

  /** No GPU queries during the loading-screen warm-up (it owns the renderer) or after a device loss; results go to the history (+ the tap). */
  private pollGpu(rendered: boolean): void {
    this.gpuTimer.setEnabled(!this.host.warming && !this.host.gpu?.deviceLost);
    if (rendered) this.gpuTimer.poll(t => { this.history.assignGpu(t.frame, t.ms); this.gpuTap?.(t.frame, t.ms); });
  }

  /**
   * Task studio-performance-recorder-20261103-043629 (lane RECORDER): the performance recorder's GPU timing tap (debug/perfRecorderHooks.ts).
   * While set, GPU timing stays on and is polled even with the overlay hidden, and every resolved frame total is also handed to it;
   * clearing it (recording stopped) switches the timer off again unless the overlay is shown.
   */
  setGpuTap(fn: ((frameId: number, ms: number) => void) | null): void {
    this.gpuTap = fn;
    if (!fn && !this.visible) this.gpuTimer.setEnabled(false);
  }
  private gpuTap: ((frameId: number, ms: number) => void) | null = null;

  toggle(): void {
    if (this.visible) this.hide(); else this.show();
  }

  show(): void {
    if (this.visible || this.failed || !this.doc) return;
    try {
      this.ensureDom();
      this.el!.classList.remove('hidden');
      this.visible = true;
      this.longFrames.start();
      this.pressure.start();
      this.lastText = -Infinity;
      this.drawn = -1;
      this.updateText(performance.now());
      this.drawGraph();
    } catch (err) {
      this.fail(err);
    }
  }

  hide(): void {
    this.visible = false;
    this.el?.classList.add('hidden');
    this.gpuTimer.setEnabled(false);
    this.longFrames.stop();
    this.pressure.stop();
  }

  /** QA (`?qa=1` → window.__perf): the current numbers and row texts. */
  snapshot() {
    const text: Record<string, string> = {};
    for (const [k, el] of this.values) text[k] = el.textContent ?? '';
    return {
      visible: this.visible, failed: this.failed, built: !!this.el, scaleMs: this.scale, slots: this.history.pushed, summary: this.history.summary(),
      gpuTiming: {support: this.gpuTimer.status(), enabled: this.gpuTimer.enabled, error: this.gpuTimer.error, passes: this.gpuTimer.lastPasses},
      longFrames: {supported: this.longFrames.supported, ...summarizeLongFrames(this.longFrames.frames, performance.now())},
      pressure: {supported: this.pressure.supported, state: this.pressure.state, note: this.pressure.note},
      text,
    };
  }

  private fail(err: unknown): void {
    this.failed = String((err as Error)?.message ?? err).slice(0, 300);
    console.error('Debug overlay stopped:', err);
    this.hide();
  }

  // --- DOM (built on first show) ------------------------------------------------------------------------------------

  private ensureDom(): void {
    if (this.el) return;
    const doc = this.doc!;
    if (!doc.getElementById('perf-overlay-css')) {
      const st = doc.createElement('style');
      st.id = 'perf-overlay-css';
      st.textContent = CSS;
      doc.head.appendChild(st);
    }
    const el = doc.createElement('div');
    el.id = 'perf-overlay';
    el.className = 'hidden';
    el.setAttribute('aria-hidden', 'true');
    const head = doc.createElement('div');
    head.className = 'po-head';
    const title = doc.createElement('span');
    title.textContent = 'Performance · Ctrl+Shift+P';
    this.scaleEl = doc.createElement('span');
    head.append(title, this.scaleEl);
    const canvas = doc.createElement('canvas');
    this.dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    canvas.width = Math.round(GRAPH_W * this.dpr);
    canvas.height = Math.round(GRAPH_H * this.dpr);
    this.ctx = canvas.getContext('2d');
    const legend = doc.createElement('div');
    legend.className = 'po-legend';
    const chip = (color: string, text: string) => { const i = doc.createElement('i'); i.style.background = color; legend.append(i, text); };
    chip(COLORS.ok, '≈60 fps');
    chip(COLORS.warn, '≥30 fps');
    chip(COLORS.bad, '<30 fps');
    chip(COLORS.cpuChip, 'game CPU');
    chip(COLORS.gpu, 'GPU');
    chip(COLORS.gap, 'gap');
    const dl = doc.createElement('dl');
    for (const [key, label] of ROWS) {
      const dt = doc.createElement('dt');
      dt.textContent = label;
      const dd = doc.createElement('dd');
      dd.textContent = '—';
      dl.append(dt, dd);
      this.values.set(key, dd);
    }
    const note = doc.createElement('div');
    note.className = 'po-note';
    note.textContent = NOTE;
    el.append(head, canvas, legend, dl, note);
    doc.body.appendChild(el);
    this.el = el;
  }

  private set(key: RowKey, text: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }

  // --- text rows (4 Hz) ---------------------------------------------------------------------------------------------

  private updateText(now: number): void {
    const s = this.history.summary();
    this.scale = graphScaleMs(s.p95Ms);
    const scaleText = `graph 0–${fmt(this.scale, this.scale < 50 ? 1 : 0)} ms`;
    if (this.scaleEl && this.scaleEl.textContent !== scaleText) this.scaleEl.textContent = scaleText;
    const h = this.host, r = h.renderer;
    this.set('fps', s.fps === null ? 'waiting for frames (the game loop starts after loading)' :`${fmt(s.fps)} · game drew ${fmt(s.renderedPerSec, 0)} frames/s (last 1 s)`);
    this.set('frame', s.frames === 0 ? '—' : `${fms(s.lastMs)} now · ${fms(s.avgMs)} avg · ${fms(s.p99Ms)} p99 · ${fms(s.maxMs)} max`);
    this.set('spikes', `${s.over33} >33 ms · ${s.over50} >50 ms in ${fmt(s.spanMs / 1000)} s`
      + (s.gaps > 0 ? ` · ${s.gaps} gap${s.gaps > 1 ? 's' : ''} (${fmt((s.lastGapMs ?? 0) / 1000)} s, not counted)` : ''));
    // lane SCHED: deferred background chunks are already inside the game CPU avg / max (same callback); shown as their share
    this.set('cpu', s.cpuAvgMs === null ? '—'
      : `${fmt(s.cpuAvgMs)} avg · ${fmt(s.cpuMaxMs)} max · update ${fmt(s.updateAvgMs)} · render submit ${fmt(s.renderAvgMs)}`
        + (h.frameBudget ? ` · deferred ${fmt(s.deferredAvgMs, 2)} (max ${fmt(s.deferredMaxMs)})` : ''));
    this.set('defer', this.deferText(now));
    this.set('gpu', this.gpuText(s));
    const p = this.pressure;
    this.set('syscpu', p.state ? `pressure ${p.state} (Compute Pressure; coarse, no %)` : `n/a — ${p.note ?? 'unavailable'}`);
    if (this.longFrames.supported) {
      const lf = summarizeLongFrames(this.longFrames.frames, now);
      this.set('loaf', lf.count === 0 ? 'none >50 ms in 10 s' : `${lf.count} >50 ms in 10 s · worst ${fmt(lf.worstMs, 0)} ms (${fmt(lf.worstBlockingMs, 0)} blocking)`);
    } else this.set('loaf', 'n/a — no Long Animation Frames API');
    const ready = r.initialized;
    const ri = r.info.render, mem = r.info.memory;
    this.set('draws', ready ? `${count(ri.drawCalls)} · ${ri.frameCalls} render passes (last drawn frame)` : 'renderer initializing');
    this.set('tris', ready ? `${count(ri.triangles)} submitted, all passes${ri.lines > 0 ? ` · ${count(ri.lines)} lines` : ''}${ri.points > 0 ? ` · ${count(ri.points)} points` : ''}` : '—');
    this.set('res', ready ? `≈${mb(mem.total)} · tex ${mem.textures} · geo ${mem.geometries} · prog ${mem.programs}` : '—');
    const pm = (globalThis.performance as {memory?: {usedJSHeapSize?: number; jsHeapSizeLimit?: number}} | undefined)?.memory;
    this.set('heap', pm && typeof pm.usedJSHeapSize === 'number'
      ? `${mb(pm.usedJSHeapSize)} / ${mb(pm.jsHeapSizeLimit ?? 0)} limit (coarse)` : 'n/a — Chromium-only API');
    this.set('backend', this.backendText());
    this.set('output', ready ? `${h.canvas.width}×${h.canvas.height} · DPR ${fmt(r.getPixelRatio(), 2)} · quality ${h.settings.quality}` : '—');
    this.set('state', h.warming ? 'warm-up running (loop idle, no GPU timing)'
      : h.state === 'playing' ? 'playing'
        : h.state === 'paused' || h.state === 'inventory' || h.state === 'dead' || h.state === 'won' ? `${h.state} (menu: frame redrawn 4/s)` : h.state);
  }

  /**
   * Lane SCHED: the background-work queue — jobs waiting and the oldest one's age, chunks / overdue (forced) chunks per
   * second since the last text refresh, drops, and the budget it runs against. Counts and measured times only.
   */
  private deferText(now: number): string {
    const fb = this.host.frameBudget;
    if (!fb) return 'n/a — no scheduler';
    const d = fb.diagnostics(), t = d.totals, p = this.deferPrev;
    const dt = (now - p.time) / 1000;
    const rate = (v: number, was: number) => p.time >= 0 && dt > 0 ? fmt((v - was) / dt, 0) : '—';
    const text = `${d.queued} queued${d.queued ? ` (oldest ${fmt(d.oldestAgeMs / 1000, 2)} s)` : ''} · ${rate(t.chunks, p.chunks)} chunks/s`
      + ` · ${rate(t.overdueRuns, p.overdue)} overdue/s · ${t.drops} drops · budget ${fmt(d.budgetMs)} ms @ ${fmt(d.refresh.hz, 0)} Hz`
      + `${d.refresh.measured ? '' : ' (default)'}${d.held ? ` · held: ${d.held}` : ''}`;
    p.time = now; p.chunks = t.chunks; p.overdue = t.overdueRuns;
    return text;
  }
  private readonly deferPrev = {time: -1, chunks: 0, overdue: 0};

  private gpuText(s: FrameSummary): string {
    const st = this.gpuTimer.status();
    if (!st) return 'renderer initializing';
    if (this.host.gpu?.deviceLost) return 'n/a — device lost';
    if (this.gpuTimer.error) return this.gpuTimer.error;
    if (!st.available) return `n/a — ${st.note}`;
    if (this.host.warming) return 'paused during the warm-up';
    const via = st.kind === 'webgpu-timestamp-query' ? 'timestamp-query' : 'WebGL timer query';
    if (s.gpuSamples === 0) return `waiting for ${via} results`;
    return `${fmt(s.gpuAvgMs, 2)} avg · ${fmt(s.gpuMaxMs, 2)} max · ${this.gpuTimer.lastPasses} passes (${via})`;
  }

  private backendText(): string {
    const g = this.host.gpu;
    if (!g) return 'initializing';
    const a = g.adapter;
    const detail = g.backend === 'webgpu'
      ? [a ? [a.vendor, a.architecture, a.description || a.device].filter(Boolean).join(' ') : '', g.compatibilityMode ? 'compatibility mode' : ''].filter(Boolean).join(' · ')
      : [g.reason ?? '', g.glRenderer ?? ''].filter(Boolean).join(' · ');
    return `${backendTag(g)}${detail ? ` — ${detail}` : ''}${g.deviceLost ? ' — DEVICE LOST' : ''}`;
  }

  // --- graph (every frame while shown) ------------------------------------------------------------------------------

  private drawGraph(): void {
    const ctx = this.ctx, hist = this.history;
    if (!ctx || hist.pushed === this.drawn) return;
    this.drawn = hist.pushed;
    const W = GRAPH_W, H = GRAPH_H, scale = this.scale, top = 3;
    const y = (ms: number) => H - Math.min(ms, scale) / scale * (H - top);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    const n = Math.min(hist.count, W);
    /** One batched fill: a 1 px column [y0, y1) for every picked slot (newest at the right edge). */
    const pass = (color: string, alpha: number, pick: (slot: number) => boolean, y0: (slot: number) => number, y1: (slot: number) => number) => {
      ctx.beginPath();
      let any = false;
      for (let k = 0; k < n; k++) {
        const i = hist.slot(k);
        if (!pick(i)) continue;
        const a = y0(i), b = y1(i);
        if (b <= a) continue;
        ctx.rect(W - 1 - k, a, 1, b - a);
        any = true;
      }
      if (!any) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const iv = hist.interval;
    const sev = (i: number) => iv[i] <= OK_MS ? 0 : iv[i] <= TARGET_LINES_MS[1] ? 1 : 2;
    const barTop = (i: number) => y(iv[i]);
    const floor = () => H;
    const sevColors = [COLORS.ok, COLORS.warn, COLORS.bad];
    // every frame is its own bar (no smoothing): drawn frames full, idle menu / warm-up frames faded
    for (let c = 0; c < 3; c++) {
      pass(sevColors[c], 1, i => !hist.isGap(i) && hist.isRendered(i) && sev(i) === c, barTop, floor);
      pass(sevColors[c], 0.4, i => !hist.isGap(i) && !hist.isRendered(i) && sev(i) === c, barTop, floor);
    }
    pass(COLORS.gap, 1, i => hist.isGap(i), () => 0, floor);
    // the game's own main-thread work during that interval: dark base of each bar
    pass(COLORS.cpu, 1, i => !hist.isGap(i), i => y(Math.min(hist.cpu[i], iv[i])), floor);
    // frames longer than the scale: a cap marks the clipped spike (its value is the Frame row's max)
    pass(COLORS.cap, 1, i => !hist.isGap(i) && iv[i] > scale, () => 0, () => 2);
    // GPU render-pass time of the frame (asynchronous; absent where unsupported / not yet resolved)
    pass(COLORS.gpu, 1, i => hist.gpu[i] === hist.gpu[i] && !hist.isGap(i), i => y(hist.gpu[i]) - 1, i => Math.min(H, y(hist.gpu[i]) + 1));
    // target lines (60 / 30 fps)
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.fillStyle = COLORS.label;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    let labelY = Infinity;
    for (const t of TARGET_LINES_MS) {
      if (t >= scale) continue;
      const ly = Math.round(y(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(W, ly);
      ctx.stroke();
      if (labelY - ly >= 10) { ctx.fillText(t.toFixed(1), 2, ly - 2); labelY = ly; } // large scales squeeze the lines together
    }
    ctx.setLineDash([]);
  }
}

/**
 * Create the overlay and bind Ctrl+Shift+P on the window in the capture phase, so it runs before game input and the
 * shortcut's P never reaches the game. A held shortcut auto-repeats: only the first keydown toggles, repeats are
 * swallowed too. The browser default is prevented where the page receives the keys at all.
 */
export function installPerfOverlay(host: PerfHost, opts: PerfOverlayOptions = {}): PerfOverlay {
  const doc = opts.doc !== undefined ? opts.doc : typeof document !== 'undefined' ? document : null;
  const overlay = new PerfOverlay(host, doc);
  const win = opts.win !== undefined ? opts.win : typeof window !== 'undefined' ? window : null;
  win?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!isOverlayToggle(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) overlay.toggle();
  }, {capture: true});
  if (opts.visible) overlay.show();
  return overlay;
}
