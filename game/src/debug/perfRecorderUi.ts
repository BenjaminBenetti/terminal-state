// Task studio-performance-recorder-20261103-043629 (lane RECORDER): the performance recorder's IN-GAME UI.
//
//  - A "Performance" section in the pause menu (and the main menu's Settings): Start recording / Stop & Download report /
//    Download last report / Discard, the keys, and the privacy line. Start, then Resume and play: the capture runs through play,
//    pause, menus, loading and travel (every frame tagged with its state); stop here or with the key.
//  - A small recording badge + timer (top centre, pointer-events none) while recording, and a short notice when a report is ready.
//  - Keys (inspected against every existing binding — game input WASD / Space / Shift / C / E / Q / F / G / T / H / R / M / I / Tab /
//    Esc / 1-6 / ` / mouse, the inventory / Lockbox (digits, 1337) / bag views, the paper map (arrows, +/-, F, Home, Enter, Backspace,
//    Delete; it passes F-keys through), the main menu (arrows, Home / End, Enter / Space, Esc), the Ctrl+Shift+P overlay: none uses a
//    function key): F8 = start / stop, F9 = mark a stutter (while recording; a plain numbered mark, never typed text). Ctrl / Alt /
//    Meta combinations and typing in a form field are never taken; Shift is allowed (sprinting).
// Nothing is uploaded or stored: the report lives in this tab's memory until downloaded (a normal browser download) or reload.

import {MARK_LOOKBACK_MS, PRIVACY_NOTE, type PerfCaps} from './perfRecorder';
import {PerfRecorderController, type GpuTapHost, type RecorderGame, type RecorderOptions} from './perfRecorderHooks';
import {isTypingTarget} from '../player/input';

/** The recorder's keys (KeyboardEvent.code) and their labels. */
export const RECORDER_KEYS = {toggle: 'F8', mark: 'F9'} as const;

/** What a keydown means to the recorder (pure). Null = not the recorder's: it passes through untouched. */
export function recorderKeyAction(e: {code: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: unknown}, recording: boolean): 'toggle' | 'mark' | null {
  if (e.ctrlKey || e.altKey || e.metaKey || isTypingTarget(e.target)) return null;
  if (e.code === RECORDER_KEYS.toggle) return 'toggle';
  if (e.code === RECORDER_KEYS.mark) return recording ? 'mark' : null;
  return null;
}

/** m:ss */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const mbText = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const TERMINATION_TEXT: Record<string, string> = {
  manual: 'stopped by you', 'auto-cap-frames': 'stopped at the frame limit', 'auto-cap-duration': 'stopped at the time limit',
  hidden: 'stopped: the tab was in the background', 'device-lost': 'stopped: the graphics device was lost', 'recorder-error': 'stopped by a recorder error',
};

export const RECORDER_PRIVACY_LINE = 'Records only game performance / event data — not your saves, inventory or account. Nothing is uploaded: the report stays in this tab until you download it (or reload).';

const CSS = `
#perf-rec-badge { position: fixed; top: 6px; left: 50%; transform: translateX(-50%); z-index: 90; pointer-events: none; user-select: none;
  font: 600 11px/1.3 var(--font, sans-serif); letter-spacing: 0.06em; color: #ece4cf; background: rgba(12, 13, 14, 0.72); border-left: 3px solid #c2463a;
  padding: 3px 9px; white-space: nowrap; text-shadow: none; }
#perf-rec-badge.ready { border-left-color: #4f8a87; }
#perf-rec-badge .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #c2463a; margin-right: 6px; vertical-align: 0; }
.perf-rec { margin: 10px 0 6px; }
.perf-rec .actions { margin: 8px 0 6px; }
.perf-rec button { font-size: 13px; padding: 7px 12px; }
.perf-rec .perf-rec-status { color: var(--cream, #ece4cf); }
.perf-rec kbd { font: inherit; border: 1px solid #555b61; padding: 0 4px; }
`;

interface Panel { root: HTMLElement; status: HTMLElement; start: HTMLButtonElement; stop: HTMLButtonElement; dl: HTMLButtonElement; discard: HTMLButtonElement }

export interface PerfRecorderInstallOptions {
  overlay?: GpuTapHost | null;
  qa?: boolean;
  caps?: Partial<PerfCaps>;
  /** Tests: the controller's environment (observer / loading manager / document / yield). */
  controller?: Omit<RecorderOptions, 'overlay' | 'caps'>;
}

export class PerfRecorderUi {
  readonly ctl: PerfRecorderController;
  private readonly panels: Panel[] = [];
  private badge: HTMLElement | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private noticeUntil = 0;
  private notice = '';
  private pendingDownload = false;

  constructor(game: RecorderGame, private readonly doc: Document | null, opts: PerfRecorderInstallOptions = {}) {
    this.ctl = new PerfRecorderController(game, {...opts.controller, overlay: opts.overlay ?? null, caps: opts.caps});
    this.ctl.listeners.push(() => this.onPhase());
  }

  /** Per animation frame (main.ts loop): the recorder's frame sample (+ the callback's start, revision 2). OFF: one boolean check. */
  frame(time: number, cpuMs: number, start?: number): void {
    this.ctl.frame(time, cpuMs, start);
  }

  start(by = 'menu'): boolean { return this.ctl.start(by); }

  /** Stop; `download` = also download the report once it is ready. */
  stop(by = 'menu', download = false): void {
    if (!this.ctl.recording) return;
    this.pendingDownload = download;
    void this.ctl.stop('manual', by);
  }

  mark(): number {
    const n = this.ctl.mark();
    if (n > 0) this.flash(`Mark ${n} added`, 1200);
    return n;
  }

  /** Download the last report (a normal browser download of a private JSON file); false when there is none. */
  download(): boolean {
    const r = this.ctl.report, doc = this.doc;
    if (!r || !doc || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(new Blob(r.parts, {type: 'application/json'}));
    const a = doc.createElement('a');
    a.href = url; a.download = r.filename; a.rel = 'noopener';
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  discard(): void {
    this.pendingDownload = false;
    this.ctl.clear();
    this.noticeUntil = 0;
    this.renderBadge();
  }

  /** Builds a Performance section into `container` (before `before`, else at the end). Idempotent per container. */
  mountPanel(container: HTMLElement | null, o: {idPrefix: string; before?: Element | null}): void {
    const d = this.doc;
    if (!d || !container || container.querySelector(':scope > .perf-rec')) return;
    this.ensureCss();
    const root = d.createElement('div');
    root.className = 'perf-rec';
    root.id = `${o.idPrefix}perf-rec`;
    const h = d.createElement('h3');
    h.textContent = 'Performance';
    const status = d.createElement('p');
    status.className = 'fine perf-rec-status';
    const actions = d.createElement('div');
    actions.className = 'actions';
    const btn = (id: string, text: string, fn: () => void) => {
      const b = d.createElement('button');
      b.type = 'button'; b.id = o.idPrefix + id; b.textContent = text;
      b.addEventListener('click', fn);
      actions.append(b);
      return b;
    };
    const start = btn('perf-start', 'Start recording', () => this.start('menu'));
    const stop = btn('perf-stop', 'Stop & Download report', () => this.stop('menu', true));
    const dl = btn('perf-download', 'Download last report', () => { this.download(); });
    const discard = btn('perf-discard', 'Discard', () => this.discard());
    const keys = d.createElement('p');
    keys.className = 'fine';
    keys.append('Keys: ', kbd(d, RECORDER_KEYS.toggle), ' start / stop recording · ', kbd(d, RECORDER_KEYS.mark), ` mark a stutter (while recording; a mark covers the last ${MARK_LOOKBACK_MS / 1000} s).`);
    const privacy = d.createElement('p');
    privacy.className = 'fine perf-rec-privacy';
    privacy.textContent = RECORDER_PRIVACY_LINE;
    privacy.title = PRIVACY_NOTE;
    root.append(h, status, actions, keys, privacy);
    if (o.before && o.before.parentElement === container) container.insertBefore(root, o.before); else container.append(root);
    this.panels.push({root, status, start, stop, dl, discard});
    this.renderPanels();
  }

  // --- internals ---

  private onPhase(): void {
    const c = this.ctl;
    if (c.phase === 'recording') this.startTick();
    if (c.phase === 'ready' && c.report) {
      if (this.pendingDownload) { this.pendingDownload = false; this.download(); this.flash('Performance report downloaded', 4000); }
      else this.flash(`Performance report ready (${TERMINATION_TEXT[c.report.termination] ?? c.report.termination}) — Esc, Performance, Download`, 9000);
    }
    if (c.phase === 'idle' && c.error) this.flash(`Performance recorder: ${c.error}`, 8000);
    this.renderPanels();
    this.renderBadge();
  }

  private flash(text: string, ms: number): void {
    this.notice = text;
    this.noticeUntil = Date.now() + ms;
    this.startTick();
    this.renderBadge();
  }

  private startTick(): void {
    if (this.tick || typeof setInterval !== 'function') return;
    this.tick = setInterval(() => {
      this.renderBadge();
      if (this.ctl.recording) this.renderPanels();
      if (!this.ctl.recording && this.ctl.phase !== 'preparing' && Date.now() >= this.noticeUntil && this.tick) { clearInterval(this.tick); this.tick = null; this.renderBadge(); }
    }, 250);
  }

  private statusText(): string {
    const c = this.ctl, caps = c.capture.caps;
    if (c.phase === 'recording') {
      const marks = c.marks;
      return `Recording · ${clockText(c.elapsedMs())} of ${clockText(caps.durationMs)} · ${c.capture.frames} frames${marks ? ` · ${marks} mark${marks > 1 ? 's' : ''}` : ''}. `
        + `Resume and play the part that stutters (e.g. turn around in the Mall); stop here or with ${RECORDER_KEYS.toggle}.`;
    }
    if (c.phase === 'preparing') return 'Preparing the report…';
    if (c.phase === 'ready' && c.report) {
      const r = c.report;
      return `Report ready: ${clockText(r.durationMs)}, ${r.frames} frames, ${mbText(r.bytes)} (${TERMINATION_TEXT[r.termination] ?? r.termination}) — ${r.filename}. Send us the downloaded file.`;
    }
    return `Not recording. Start, then Resume and play; the recording stops by itself after ${clockText(caps.durationMs)} or ${caps.frames} frames.`
      + (c.error ? ` (${c.error})` : '');
  }

  private renderPanels(): void {
    if (!this.panels.length) return;
    const c = this.ctl, text = this.statusText();
    for (const p of this.panels) {
      if (p.status.textContent !== text) p.status.textContent = text;
      p.start.disabled = c.recording || c.phase === 'preparing';
      p.stop.disabled = !c.recording;
      p.dl.disabled = !c.report;
      p.discard.disabled = !c.recording && !c.report;
    }
  }

  private renderBadge(): void {
    const d = this.doc;
    if (!d) return;
    const c = this.ctl;
    const showNotice = Date.now() < this.noticeUntil;
    const on = c.recording || c.phase === 'preparing' || showNotice;
    if (!on) { if (this.badge) this.badge.classList.add('hidden'); return; }
    if (!this.badge) {
      this.ensureCss();
      const b = d.createElement('div');
      b.id = 'perf-rec-badge';
      b.setAttribute('aria-live', 'polite');
      d.body.appendChild(b);
      this.badge = b;
    }
    const b = this.badge;
    b.classList.remove('hidden');
    const rec = c.recording;
    b.classList.toggle('ready', !rec);
    const text = rec ? `REC ${clockText(c.elapsedMs())} · ${RECORDER_KEYS.toggle} stop · ${RECORDER_KEYS.mark} mark${c.marks ? ` (${c.marks})` : ''}${showNotice ? ` · ${this.notice}` : ''}`
      : c.phase === 'preparing' ? 'Preparing performance report…' : this.notice;
    if (b.dataset.text !== text) {
      b.dataset.text = text;
      b.replaceChildren();
      if (rec) { const dot = d.createElement('span'); dot.className = 'dot'; b.append(dot); }
      b.append(text);
    }
  }

  private ensureCss(): void {
    const d = this.doc;
    if (!d || d.getElementById('perf-rec-css')) return;
    const st = d.createElement('style');
    st.id = 'perf-rec-css';
    st.textContent = CSS;
    d.head.appendChild(st);
  }
}

function kbd(d: Document, text: string): HTMLElement {
  const k = d.createElement('kbd');
  k.textContent = text;
  return k;
}

/**
 * Create the recorder, its keys (window keydown, capture phase: F8 / F9 never reach the game) and, with `qa`, the QA hook
 * `__LL.perfRecorder()` -> {status, start, stop, mark, report, clear, download}. Mount panels with ui.mountPanel.
 */
export function installPerfRecorder(game: RecorderGame, opts: PerfRecorderInstallOptions = {}): PerfRecorderUi {
  const doc = typeof document !== 'undefined' ? document : null;
  const ui = new PerfRecorderUi(game, doc, opts);
  const ctl = ui.ctl;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const a = recorderKeyAction(e, ctl.recording);
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (a === 'toggle') { if (ctl.recording) ui.stop('hotkey', false); else if (ctl.phase !== 'preparing') ui.start('hotkey'); }
      else ui.mark();
    }, {capture: true});
    if (opts.qa) {
      const api = {
        /** Phase, frames, elapsed, marks, the last report's summary (no data), the keys and caps. */
        status: () => {
          const r = ctl.report;
          return {phase: ctl.phase, recording: ctl.recording, frames: ctl.capture.frames, elapsedMs: Math.round(ctl.elapsedMs()), marks: ctl.marks, error: ctl.error,
            report: r ? {filename: r.filename, bytes: r.bytes, frames: r.frames, durationMs: r.durationMs, termination: r.termination, stoppedBy: r.stoppedBy, serializeMs: r.serializeMs} : null,
            keys: {...RECORDER_KEYS}, caps: {...ctl.capture.caps}, captureBytes: ctl.capture.bytes()};
        },
        start: () => ui.start('qa'),
        /** Stop and prepare the report (no download); resolves with status().report. */
        stop: async () => { if (ctl.recording) await ctl.stop('manual', 'qa'); return api.status().report; },
        mark: () => ui.mark(),
        /** The finished report as an object (the same JSON the download carries); null before one is ready. */
        report: () => ctl.reportObject(),
        clear: () => { ui.discard(); return api.status(); },
        download: () => ui.download(),
      };
      const w = window as unknown as {__LL?: Record<string, unknown>};
      if (w.__LL) w.__LL.perfRecorder = () => api;
    }
  }
  return ui;
}
