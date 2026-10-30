// Task frame-budget-deferral-20261030 (lane SCHED), user feedback #11: "CPU time is getting a little high at spots and that
// is what causes stuttering. We should implement a deferral system such that tasks that can be deferred get deferred if
// the frame time budget is close."
//
// A compact COOPERATIVE frame-budget scheduler for genuinely deferrable, genuinely chunked background work. Not a task
// framework, not a worker / thread / idle-callback: a job is a step function that does ONE bounded chunk of its work and
// says whether it is finished; the scheduler runs chunks on the main thread inside the game's own frame callback, so
// deferred work still counts as main-thread time in the frame that runs it (frameCpu / the overlay stay truthful).
//
// Budget (per frame):
//   target    = the display's frame interval: the MEDIAN rAF interval over the recent frames, snapped to a common refresh
//               rate (60 / 72 / 75 / 90 / 100 / 120 / 144 / 165 / 180 / 240 Hz, within ±6 %), 60 Hz until measured.
//               Never budgeted slower than 60 Hz: a slower median is almost always the game itself missing vsync on a
//               60 Hz display (or a throttled browser), and budgeting a 33 ms frame there would feed background work into
//               frames that should be recovering. A genuine 30 / 48 / 50 Hz display is therefore budgeted as 60 Hz —
//               conservative (less background work per frame), never the cause of a missed frame.
//   remaining = target × (1 − headroom) − main-thread ms already spent in this frame callback (clock injectable).
//   headroom  = 0.3: 30 % of the interval stays free for the browser (input events, HUD style / layout, compositing, GC)
//               and timer jitter — background chunks never push the callback past 70 % of the display interval
//               (11.7 ms at 60 Hz, 5.8 ms at 120 Hz).
// The game calls run() AFTER the critical update and the render submission (game.ts frame()), so `remaining` is measured,
// not predicted; results are read by the next frame's update (one frame of latency — background data only).
//
// Jobs: keyed + coalesced (a re-request updates the pending entry; its age is kept, so re-requests never reset staleness),
// priority (higher first), max staleness (`maxStaleMs` of ACTIVE time — paused / loading / warm-up frames do not age a
// job). A chunk runs only when its kind's estimate fits `remaining`. Estimates are an asymmetric EWMA of the measured chunk
// cost per job kind (rises fast, decays slowly), starting conservative. An OVERDUE job gets one chunk per frame even over
// budget, but at most `maxOverduePerFrame` such forced chunks per frame across all jobs (a second one only while the forced
// ms stay within `maxOverdueMsPerFrame`), so a burst of overdue work never becomes one giant frame: under unavoidable
// overload every overdue job still progresses a bounded chunk at a time, in line by how long it has waited since it became
// overdue or was last served (a stream of new overdue jobs cannot starve a long one). Within budget, jobs take turns
// (round-robin passes in priority order) until the budget, the queue or the per-frame chunk cap runs out.
//
// Bounds: at most `maxQueue` jobs (a full queue drops the lowest-priority job — counted, reported to its owner via
// onCancel('dropped') and listed in the diagnostics, never silent); at most `maxChunksPerFrame` chunks per frame; estimate
// table bounded. Cancellation: a world GENERATION token — Retry / travel / new game / rebuild / teardown bump it, every
// queued job is cancelled (onCancel('generation')) and a request carrying an older token is rejected, so an old world's
// job can never run against a new world. Pause / loading / warm-up: hold() — no chunks while held, the queue keeps its jobs
// (loading / warm-up always follow a teardown that already bumped the generation), active time stops.
//
// Diagnostics (diagnostics(), built only on demand: `__LL.frameBudget()` and the overlay's 4 Hz text row while shown):
// refresh detection, budget, queued jobs + oldest age, this frame's chunks / ms / deferred jobs / overdue runs, totals
// (requests, coalesced, completed, chunks, ms, overdue runs, drops, stale requests, cancellations, errors, overruns) and the
// per-kind estimates. Nothing here estimates CPU utilisation: every number is a measured main-thread duration or a count.

/** Scheduler parameters (see FRAME_BUDGET for the meaning and the game defaults). */
export interface FrameBudgetConfig {
  defaultHz: number; rates: readonly number[]; snapTolerance: number; slowestHz: number; fastestHz: number;
  windowFrames: number; minSamples: number; maxSampleMs: number; remeasureEvery: number; headroom: number;
  initialEstimateMs: number; ewmaUp: number; ewmaDown: number; minEstimateMs: number; maxQueue: number;
  maxOverduePerFrame: number; maxOverdueMsPerFrame: number; maxChunksPerFrame: number; defaultMaxStaleMs: number; maxActiveStepMs: number;
  overrunSlackMs: number; maxKinds: number;
}

/** Scheduler parameters (game defaults; tests override per instance). */
export const FRAME_BUDGET: Readonly<FrameBudgetConfig> = {
  /** Assumed display rate until enough intervals were measured. */
  defaultHz: 60,
  /** Common display refresh rates a measured median snaps to (Hz). */
  rates: [60, 72, 75, 90, 100, 120, 144, 165, 180, 240],
  /** Snap tolerance (fraction of the rate's interval). */
  snapTolerance: 0.06,
  /** The budget never assumes a display slower than this (see the file comment). */
  slowestHz: 60,
  /** Fastest display the budget believes (a faster median is clamped here). */
  fastestHz: 240,
  /** rAF intervals kept for the median (a ring). */
  windowFrames: 64,
  /** Intervals needed before the measurement replaces the default. */
  minSamples: 20,
  /** Intervals longer than this (ms) are hitches / gaps, not display samples. */
  maxSampleMs: 250,
  /** Re-detect the refresh rate every this many new samples. */
  remeasureEvery: 30,
  /** Fraction of the target interval left free for the browser (see the file comment). */
  headroom: 0.3,
  /** First estimate of a job kind without a hint (ms; conservative: a fresh kind runs only in clearly spare time). */
  initialEstimateMs: 1.5,
  /** EWMA weights: a measured chunk above / below the estimate (rise fast, decay slowly). */
  ewmaUp: 0.5,
  ewmaDown: 0.1,
  /** Floor of an estimate (ms): a coarse browser clock reads many chunks as 0. */
  minEstimateMs: 0.02,
  /** Queue bound (jobs): room for one far re-plan per enemy of the largest level (40) plus the other jobs. */
  maxQueue: 64,
  /** Forced (overdue, over-budget) chunks per frame across all jobs. */
  maxOverduePerFrame: 2,
  /** A second forced chunk in a frame runs only while forced ms + its estimate stay within this (the first always runs). */
  maxOverdueMsPerFrame: 4,
  /** Hard cap on chunks per frame (any mix). */
  maxChunksPerFrame: 48,
  /** Default max staleness (ms of active time) before a job is overdue. */
  defaultMaxStaleMs: 500,
  /** Active time a single frame can add (ms): a hitch or a resumed tab does not age every job at once. */
  maxActiveStepMs: 100,
  /** A chunk measured above max(2 × its estimate, estimate + this) counts as an overrun (diagnostics only). */
  overrunSlackMs: 1,
  /** Estimate kinds tracked (bounded table). */
  maxKinds: 64,
};

export type FrameBudgetOptions = Partial<FrameBudgetConfig>;

/** Why the queue is not running: the game state (game.ts frame()). */
export type HoldReason = 'loading' | 'warmup' | 'paused';
/** Why a job left the queue without finishing. */
export type CancelReason = 'generation' | 'dropped' | 'cancelled' | 'error';
/** What request() did. 'stale' = an old world's token (rejected); 'dropped' = the queue was full of more important work. */
export type RequestResult = 'queued' | 'coalesced' | 'dropped' | 'stale';

/** A request for background work: one bounded chunk per step() call. */
export interface FrameJob {
  /** Coalescing key: a request whose key is queued updates that entry (no duplicates). */
  key: string;
  /** Estimate kind (one EWMA per kind; default: the key). */
  kind?: string;
  /** Higher runs first (default 0). */
  priority?: number;
  /** Active ms after the first request before the job is overdue (default FRAME_BUDGET.defaultMaxStaleMs). */
  maxStaleMs?: number;
  /** First estimate of this kind when nothing was measured yet (ms; default FRAME_BUDGET.initialEstimateMs). */
  initialEstimateMs?: number;
  /** ONE bounded chunk; true = finished (the job leaves the queue), false = more to do. */
  step: () => boolean;
  /** Told when the job leaves the queue unfinished (generation bump, dropped, cancel(key), a step threw). */
  onCancel?: (reason: CancelReason) => void;
  /** The world generation the requester captured (game.frameBudget.generation); an older one is rejected. */
  generation?: number;
}

/** The part of the scheduler a background system needs (game.frameBudget satisfies it). */
export interface FrameScheduler {
  readonly generation: number;
  request(job: FrameJob): RequestResult;
  cancel(key: string): boolean;
  has(key: string): boolean;
}

/** The measured display interval: median of the rAF intervals, snapped (see the file comment). */
export interface RefreshDetection {
  /** Hz the budget uses. */
  hz: number;
  /** 1000 / hz. */
  targetMs: number;
  /** Median of the samples (ms); null when too few. */
  medianMs: number | null;
  /** The median snapped to a common rate (else the clamped raw value). */
  snapped: boolean;
  /** Enough samples were measured (else the default rate). */
  measured: boolean;
  samples: number;
}

/**
 * Display rate from rAF intervals (pure; tests): the median of `samples` (first `n` values), snapped to the nearest common
 * rate within the tolerance, clamped to [slowestHz, fastestHz]; the default rate until `minSamples` were measured.
 */
export function detectRefresh(samples: ArrayLike<number>, n: number, o: FrameBudgetOptions = {}, scratch?: Float32Array): RefreshDetection {
  const cfg = {...FRAME_BUDGET, ...o};
  const count = Math.min(n, samples.length);
  if (count < cfg.minSamples) return {hz: cfg.defaultHz, targetMs: 1000 / cfg.defaultHz, medianMs: null, snapped: false, measured: false, samples: count};
  const buf = scratch && scratch.length >= count ? scratch.subarray(0, count) : new Float32Array(count);
  for (let i = 0; i < count; i++) buf[i] = samples[i];
  buf.sort();
  const median = count % 2 ? buf[(count - 1) >> 1] : (buf[count / 2 - 1] + buf[count / 2]) / 2;
  let hz = 1000 / median, snapped = false;
  let best = Infinity;
  for (const r of cfg.rates) {
    const err = Math.abs(median - 1000 / r) / (1000 / r);
    if (err <= cfg.snapTolerance && err < best) { best = err; hz = r; snapped = true; }
  }
  hz = Math.min(cfg.fastestHz, Math.max(cfg.slowestHz, hz));
  return {hz, targetMs: 1000 / hz, medianMs: median, snapped, measured: true, samples: count};
}

/** Per-kind chunk cost estimate (ms). */
export interface KindEstimate {
  ms: number;
  samples: number;
  lastMs: number;
  maxMs: number;
}

/** One frame's scheduling (the last run frame). */
export interface FrameRunStats {
  /** Chunks run / their measured main-thread ms (all of it inside the game's frame callback). */
  chunks: number;
  ms: number;
  /** Jobs that stayed queued with no chunk in this frame (did not fit / overdue cap reached). */
  deferred: number;
  /** Chunks run over budget because their job was overdue (<= maxOverduePerFrame). */
  overdueRuns: number;
  /** Budget left when the scheduler stopped (ms; negative = the frame was already over budget). */
  remainingMs: number;
  /** Main-thread ms the frame had spent before the scheduler ran. */
  spentBeforeMs: number;
}

export interface FrameBudgetTotals {
  requested: number;
  coalesced: number;
  completed: number;
  chunks: number;
  ms: number;
  overdueRuns: number;
  /** Job-frames deferred (a job left without a chunk in an active frame). */
  deferred: number;
  drops: number;
  staleRejected: number;
  cancelled: number;
  errors: number;
  overruns: number;
  /** Frames the scheduler ran with work queued. */
  frames: number;
}

export interface FrameBudgetDiagnostics {
  refresh: RefreshDetection;
  headroom: number;
  /** target × (1 − headroom) (ms). */
  budgetMs: number;
  held: HoldReason | null;
  generation: number;
  queued: number;
  /** Oldest queued job's age (active ms; 0 when empty). */
  oldestAgeMs: number;
  /** Queued jobs past their max staleness. */
  overdue: number;
  frame: FrameRunStats;
  totals: FrameBudgetTotals;
  estimates: Record<string, KindEstimate>;
  jobs: {key: string; kind: string; priority: number; ageMs: number; maxStaleMs: number; overdue: boolean; chunks: number}[];
  lastDrops: string[];
  lastError: string | null;
}

interface Entry {
  key: string;
  kind: string;
  priority: number;
  maxStaleMs: number;
  initialMs: number;
  step: () => boolean;
  onCancel?: (reason: CancelReason) => void;
  /** Active ms of the first request / its deadline (earliest of the coalesced requests). */
  since: number;
  deadline: number;
  chunks: number;
  /** Frame number of its last chunk (-1: never) — one forced chunk per job per frame. */
  lastRun: number;
  /** Scheduler-wide chunk sequence of its last chunk (-1: never) — tie-break of the overdue rotation. */
  lastSeq: number;
  /** Active ms of its last chunk (-Infinity: never): an overdue job waits in line since max(deadline, servedAt). */
  servedAt: number;
}

const now0 = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class FrameBudget implements FrameScheduler {
  readonly cfg: Readonly<FrameBudgetConfig>;
  private readonly now: () => number;
  private readonly queue = new Map<string, Entry>();
  private readonly order: Entry[] = [];
  private readonly est = new Map<string, KindEstimate>();
  private gen = 0;
  private heldBy: HoldReason | null = null;
  // refresh detection (ring of rAF intervals)
  private readonly ring: Float32Array;
  private readonly scratch: Float32Array;
  private ringHead = 0;
  private ringCount = 0;
  private sinceDetect = 0;
  private lastTime = NaN;
  private refreshNow: RefreshDetection;
  // per frame
  private frameNo = 0;
  private seq = 0;
  private frameStart = 0;
  private active = 0;
  private wasActive = false;
  private readonly last: FrameRunStats = {chunks: 0, ms: 0, deferred: 0, overdueRuns: 0, remainingMs: 0, spentBeforeMs: 0};
  readonly totals: FrameBudgetTotals = {requested: 0, coalesced: 0, completed: 0, chunks: 0, ms: 0, overdueRuns: 0, deferred: 0, drops: 0, staleRejected: 0, cancelled: 0, errors: 0, overruns: 0, frames: 0};
  private readonly drops: string[] = [];
  private lastError: string | null = null;

  constructor(o: FrameBudgetOptions & {now?: () => number} = {}) {
    const {now, ...rest} = o;
    this.cfg = {...FRAME_BUDGET, ...rest};
    this.now = now ?? now0;
    this.ring = new Float32Array(Math.max(1, this.cfg.windowFrames));
    this.scratch = new Float32Array(this.ring.length);
    this.refreshNow = detectRefresh(this.ring, 0, this.cfg);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Requests

  get generation(): number {
    return this.gen;
  }

  /** Jobs waiting. */
  get size(): number {
    return this.queue.size;
  }

  has(key: string): boolean {
    return this.queue.has(key);
  }

  /** Queue (or coalesce) a job. See RequestResult. */
  request(job: FrameJob): RequestResult {
    if (job.generation !== undefined && job.generation !== this.gen) { this.totals.staleRejected++; return 'stale'; }
    this.totals.requested++;
    const maxStale = Math.max(0, job.maxStaleMs ?? this.cfg.defaultMaxStaleMs);
    const old = this.queue.get(job.key);
    if (old) {
      // coalesce: the newest step / parameters, the highest priority, the EARLIEST deadline (a re-request never resets age)
      old.step = job.step;
      old.onCancel = job.onCancel;
      old.kind = job.kind ?? job.key;
      old.priority = Math.max(old.priority, job.priority ?? 0);
      old.maxStaleMs = Math.min(old.maxStaleMs, maxStale);
      old.deadline = Math.min(old.deadline, this.active + maxStale);
      if (job.initialEstimateMs !== undefined) old.initialMs = job.initialEstimateMs;
      this.totals.coalesced++;
      return 'coalesced';
    }
    const priority = job.priority ?? 0;
    if (this.queue.size >= this.cfg.maxQueue) {
      // full: the lowest-priority job goes (the newest among equals); the request itself when it is not more important
      let victim: Entry | null = null;
      for (const e of this.queue.values()) if (!victim || e.priority < victim.priority || (e.priority === victim.priority && e.since >= victim.since)) victim = e;
      if (!victim || priority <= victim.priority) { this.noteDrop(job.key); job.onCancel?.('dropped'); return 'dropped'; }
      this.queue.delete(victim.key);
      this.noteDrop(victim.key);
      this.safeCancel(victim, 'dropped');
    }
    this.queue.set(job.key, {
      key: job.key, kind: job.kind ?? job.key, priority, maxStaleMs: maxStale, initialMs: job.initialEstimateMs ?? this.cfg.initialEstimateMs,
      step: job.step, onCancel: job.onCancel, since: this.active, deadline: this.active + maxStale, chunks: 0, lastRun: -1, lastSeq: -1, servedAt: -Infinity,
    });
    return 'queued';
  }

  /** Remove a queued job (its owner no longer needs it). */
  cancel(key: string): boolean {
    const e = this.queue.get(key);
    if (!e) return false;
    this.queue.delete(key);
    this.totals.cancelled++;
    this.safeCancel(e, 'cancelled');
    return true;
  }

  /**
   * A new world (Retry / travel / new game / rebuild / teardown): every queued job is cancelled and requests carrying the
   * previous token are rejected from now on. Returns the new token.
   */
  bumpGeneration(): number {
    this.gen++;
    const jobs = [...this.queue.values()];
    this.queue.clear();
    for (const e of jobs) { this.totals.cancelled++; this.safeCancel(e, 'generation'); }
    return this.gen;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Per frame

  /** The game state's hold (null = playing): no chunks while held; the queue keeps its jobs; active time stops. */
  hold(reason: HoldReason | null): void {
    this.heldBy = reason;
  }

  get held(): HoldReason | null {
    return this.heldBy;
  }

  /**
   * Start of the frame callback: `time` = the rAF timestamp (refresh detection), `start` = main-thread clock at the start of
   * the callback (budget origin; default now()). Call after hold() for this frame.
   */
  beginFrame(time: number, start = this.now()): void {
    this.frameNo++;
    this.frameStart = start;
    const L = this.last;
    L.chunks = 0; L.ms = 0; L.deferred = 0; L.overdueRuns = 0; L.remainingMs = 0; L.spentBeforeMs = 0;
    // refresh detection: not during loading / warm-up (long synchronous chunks), never across a hitch / gap
    const sampling = this.heldBy !== 'loading' && this.heldBy !== 'warmup';
    const iv = time - this.lastTime;
    if (sampling && iv > 0 && iv <= this.cfg.maxSampleMs) {
      this.ring[this.ringHead] = iv;
      this.ringHead = (this.ringHead + 1) % this.ring.length;
      this.ringCount = Math.min(this.ringCount + 1, this.ring.length);
      if (++this.sinceDetect >= this.cfg.remeasureEvery || (!this.refreshNow.measured && this.ringCount >= this.cfg.minSamples)) {
        this.sinceDetect = 0;
        this.refreshNow = detectRefresh(this.ring, this.ringCount, this.cfg, this.scratch);
      }
    }
    this.lastTime = sampling ? time : NaN;
    // active time: only between two consecutive un-held frames
    const activeNow = this.heldBy === null;
    if (activeNow && this.wasActive && iv > 0) this.active += Math.min(iv, this.cfg.maxActiveStepMs);
    this.wasActive = activeNow;
  }

  /** The refresh rate the budget uses now. */
  get refresh(): RefreshDetection {
    return this.refreshNow;
  }

  /** target × (1 − headroom) (ms). */
  get budgetMs(): number {
    return this.refreshNow.targetMs * (1 - this.cfg.headroom);
  }

  /** Budget left in this frame (ms; negative when already over). */
  remaining(): number {
    return this.budgetMs - (this.now() - this.frameStart);
  }

  /** Current estimate of a job kind (ms). */
  estimate(kind: string, initial = this.cfg.initialEstimateMs): number {
    return this.est.get(kind)?.ms ?? initial;
  }

  /**
   * Run background chunks in what is left of this frame's budget (after the critical update and the render submission).
   * Returns the main-thread ms spent in chunks (also last-frame diagnostics).
   */
  run(): number {
    if (this.heldBy !== null || this.queue.size === 0) return 0;
    const cfg = this.cfg, L = this.last, frame = this.frameNo, gen = this.gen;
    L.spentBeforeMs = this.now() - this.frameStart;
    this.totals.frames++;
    let chunks = 0, overdueRuns = 0, forcedMs = 0, progressed = true;
    while (progressed && chunks < cfg.maxChunksPerFrame && this.queue.size > 0) {
      progressed = false;
      const order = this.sorted();
      for (let i = 0; i < order.length; i++) {
        if (chunks >= cfg.maxChunksPerFrame || this.gen !== gen) break;
        const e = order[i];
        if (this.queue.get(e.key) !== e) continue; // finished / cancelled / replaced meanwhile
        const est = this.estimate(e.kind, e.initialMs);
        let forced = false;
        if (est > this.remaining()) {
          const overdue = this.active >= e.deadline;
          if (!overdue || overdueRuns >= cfg.maxOverduePerFrame || e.lastRun === frame) continue; // deferred
          if (overdueRuns > 0 && forcedMs + est > cfg.maxOverdueMsPerFrame) continue; // the frame already carries its forced work
          overdueRuns++;
          this.totals.overdueRuns++;
          forced = true;
        }
        const ms = this.runChunk(e, frame);
        if (forced) forcedMs += ms;
        chunks++;
        progressed = true;
      }
      if (this.gen !== gen) break;
    }
    let deferred = 0;
    for (const e of this.queue.values()) if (e.lastRun !== frame) deferred++;
    this.totals.deferred += deferred;
    L.chunks = chunks;
    L.deferred = deferred;
    L.overdueRuns = overdueRuns;
    L.remainingMs = this.remaining();
    this.order.length = 0;
    return L.ms;
  }

  private runChunk(e: Entry, frame: number): number {
    const t0 = this.now();
    let done = false, failed: unknown = null;
    try { done = e.step(); } catch (err) { failed = err ?? new Error('step threw'); }
    const ms = Math.max(0, this.now() - t0);
    e.chunks++;
    e.lastRun = frame;
    e.lastSeq = this.seq++;
    e.servedAt = this.active;
    this.last.ms += ms;
    this.totals.chunks++;
    this.totals.ms += ms;
    const before = this.estimate(e.kind, e.initialMs);
    if (ms > Math.max(2 * before, before + this.cfg.overrunSlackMs)) this.totals.overruns++;
    this.learn(e.kind, e.initialMs, ms);
    if (failed !== null) {
      this.totals.errors++;
      this.lastError = `${e.key}: ${String((failed as Error)?.message ?? failed).slice(0, 200)}`;
      console.error(`frame budget: background job ${e.key} failed`, failed);
      if (this.queue.get(e.key) === e) { this.queue.delete(e.key); this.safeCancel(e, 'error'); }
      return ms;
    }
    if (done && this.queue.get(e.key) === e) { this.queue.delete(e.key); this.totals.completed++; }
    return ms;
  }

  private learn(kind: string, initial: number, ms: number): void {
    let k = this.est.get(kind);
    if (!k) {
      if (this.est.size >= this.cfg.maxKinds) return;
      k = {ms: initial, samples: 0, lastMs: 0, maxMs: 0};
      this.est.set(kind, k);
    }
    const a = ms > k.ms ? this.cfg.ewmaUp : this.cfg.ewmaDown;
    k.ms = Math.max(this.cfg.minEstimateMs, k.ms + a * (ms - k.ms));
    k.samples++;
    k.lastMs = ms;
    if (ms > k.maxMs) k.maxMs = ms;
  }

  /**
   * Overdue first — in line since they became overdue or were last served (max(deadline, servedAt)): a round-robin in which
   * a newly overdue job queues behind the ones already waiting, so a stream of new jobs cannot starve a long one — then
   * priority, then oldest. Reuses one array.
   */
  private sorted(): Entry[] {
    const o = this.order;
    o.length = 0;
    for (const e of this.queue.values()) o.push(e);
    o.sort(this.cmp);
    return o;
  }

  private readonly cmp = (a: Entry, b: Entry): number => {
    const ao = this.active >= a.deadline, bo = this.active >= b.deadline;
    if (ao !== bo) return ao ? -1 : 1;
    if (ao) return Math.max(a.deadline, a.servedAt) - Math.max(b.deadline, b.servedAt) || a.lastSeq - b.lastSeq;
    return b.priority - a.priority || a.since - b.since || a.lastSeq - b.lastSeq;
  };

  private noteDrop(key: string): void {
    this.totals.drops++;
    this.drops.push(key);
    if (this.drops.length > 8) this.drops.shift();
    if (this.totals.drops === 1 || this.totals.drops % 100 === 0) console.warn(`frame budget: queue full (${this.cfg.maxQueue}) — dropped background job ${key} (${this.totals.drops} drops)`);
  }

  private safeCancel(e: Entry, reason: CancelReason): void {
    try { e.onCancel?.(reason); } catch (err) { console.warn(`frame budget: onCancel of ${e.key} failed`, err); }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Diagnostics (on demand only)

  /** The last run frame's numbers (no allocation). */
  get lastFrame(): Readonly<FrameRunStats> {
    return this.last;
  }

  /** Active (un-held) ms the scheduler has seen. */
  get activeMs(): number {
    return this.active;
  }

  diagnostics(): FrameBudgetDiagnostics {
    let oldest = 0, overdue = 0;
    const jobs: FrameBudgetDiagnostics['jobs'] = [];
    for (const e of this.queue.values()) {
      const age = this.active - e.since, od = this.active >= e.deadline;
      if (age > oldest) oldest = age;
      if (od) overdue++;
      jobs.push({key: e.key, kind: e.kind, priority: e.priority, ageMs: age, maxStaleMs: e.maxStaleMs, overdue: od, chunks: e.chunks});
    }
    const estimates: Record<string, KindEstimate> = {};
    for (const [k, v] of this.est) estimates[k] = {...v};
    return {
      refresh: {...this.refreshNow}, headroom: this.cfg.headroom, budgetMs: this.budgetMs, held: this.heldBy, generation: this.gen,
      queued: this.queue.size, oldestAgeMs: oldest, overdue, frame: {...this.last}, totals: {...this.totals}, estimates, jobs,
      lastDrops: [...this.drops], lastError: this.lastError,
    };
  }
}
