// Debug overlay (Ctrl+Shift+P): optional browser signals, observed only while the overlay is visible.
//
//  - Long Animation Frames (PerformanceObserver 'long-animation-frame', Chromium): frames whose main-thread work
//    took > 50 ms, with their blocking time — the main-thread side of a stutter.
//  - Compute Pressure (PressureObserver 'cpu', Chromium): the SYSTEM's coarse CPU pressure state (nominal / fair /
//    serious / critical). It is the only standard web API about whole-system CPU load; it gives no percentage.
//
// Neither exists in every browser: unsupported / refused APIs are reported as such, never estimated.

/** Long frames kept (newest last). */
export const LONG_FRAME_KEEP = 32;
/** Long-frame summary window (ms). */
export const LONG_FRAME_WINDOW_MS = 10000;

export interface LongFrame {
  start: number;
  duration: number;
  blocking: number;
}

export interface LongFrameSummary {
  count: number;
  worstMs: number;
  worstBlockingMs: number;
}

/** Long frames that started within `windowMs` before `now` (performance.now() clock). */
export function summarizeLongFrames(frames: readonly LongFrame[], now: number, windowMs = LONG_FRAME_WINDOW_MS): LongFrameSummary {
  const s: LongFrameSummary = {count: 0, worstMs: 0, worstBlockingMs: 0};
  for (const f of frames) {
    if (f.start < now - windowMs) continue;
    s.count++;
    if (f.duration > s.worstMs) s.worstMs = f.duration;
    if (f.blocking > s.worstBlockingMs) s.worstBlockingMs = f.blocking;
  }
  return s;
}

interface ObserverCtor {
  new (cb: (list: {getEntries(): unknown[]}) => void): {observe(o: {type: string; buffered?: boolean}): void; disconnect(): void};
  supportedEntryTypes?: readonly string[];
}

export class LongFrameWatch {
  readonly frames: LongFrame[] = [];
  readonly supported: boolean;
  private observer: {disconnect(): void} | null = null;

  constructor(private readonly ctor: ObserverCtor | undefined = (globalThis as {PerformanceObserver?: ObserverCtor}).PerformanceObserver) {
    this.supported = !!ctor?.supportedEntryTypes?.includes('long-animation-frame');
  }

  start(): void {
    if (!this.supported || this.observer || !this.ctor) return;
    try {
      const o = new this.ctor(list => {
        for (const e of list.getEntries() as {startTime: number; duration: number; blockingDuration?: number}[]) {
          this.frames.push({start: e.startTime, duration: e.duration, blocking: e.blockingDuration ?? 0});
        }
        if (this.frames.length > LONG_FRAME_KEEP) this.frames.splice(0, this.frames.length - LONG_FRAME_KEEP);
      });
      o.observe({type: 'long-animation-frame', buffered: false});
      this.observer = o;
    } catch {
      this.observer = null;
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

export type PressureState = 'nominal' | 'fair' | 'serious' | 'critical';

interface PressureObserverLike {
  observe(source: string, options?: {sampleInterval?: number}): Promise<void>;
  disconnect(): void;
}
interface PressureCtor {
  new (cb: (records: {state: PressureState}[]) => void): PressureObserverLike;
  knownSources?: readonly string[];
}

export class CpuPressureWatch {
  state: PressureState | null = null;
  /** Why there is no state (unsupported / refused); null while observing. */
  note: string | null;
  readonly supported: boolean;
  private observer: PressureObserverLike | null = null;

  constructor(private readonly ctor: PressureCtor | undefined = (globalThis as {PressureObserver?: PressureCtor}).PressureObserver) {
    this.supported = !!ctor && (!ctor.knownSources || ctor.knownSources.includes('cpu'));
    this.note = this.supported ? 'waiting for the first sample' : 'this browser has no Compute Pressure API';
  }

  start(): void {
    if (!this.supported || this.observer || !this.ctor) return;
    try {
      const o = new this.ctor(records => {
        const last = records[records.length - 1];
        if (last) { this.state = last.state; this.note = null; }
      });
      this.observer = o;
      o.observe('cpu', {sampleInterval: 1000}).catch((err: unknown) => {
        if (this.observer !== o) return;
        this.observer = null;
        this.state = null;
        this.note = `refused by the browser (${String((err as Error)?.name ?? err)})`;
      });
    } catch (err) {
      this.observer = null;
      this.note = `unavailable (${String((err as Error)?.name ?? err)})`;
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.state = null;
    if (this.supported && !this.note?.startsWith('refused')) this.note = 'waiting for the first sample';
  }
}
