// Task frame-budget-deferral-20261030 (lane SCHED): the cooperative frame-budget scheduler (core/frameBudget.ts) under a
// controllable clock — remaining-budget math, refresh-rate detection, chunk boundaries, adaptive estimates, fairness /
// max staleness, coalescing, queue bound + counted drops, generation cancellation, pause / loading / warm-up holds,
// unavoidable overload (bounded overdue chunks per frame) and diagnostics truthfulness.
import {describe, expect, it, vi} from 'vitest';
import {FRAME_BUDGET, FrameBudget, detectRefresh, type CancelReason, type FrameBudgetOptions} from '../src/core/frameBudget';

/** A scheduler on a fake clock: `t` ms; steps advance it by their cost. */
function rig(o: FrameBudgetOptions = {}) {
  const clock = {t: 0};
  const fb = new FrameBudget({...o, now: () => clock.t});
  let raf = 0;
  /** One frame: rAF at the display interval, `spent` ms of critical work before the scheduler runs. */
  const frame = (spent = 0, interval = 1000 / 60) => {
    raf += interval;
    clock.t = Math.max(clock.t, raf);
    const start = clock.t;
    fb.beginFrame(raf, start);
    clock.t += spent;
    const ms = fb.run();
    return {ms, start, end: clock.t};
  };
  /** A job of `n` units, `per` units per chunk, each unit costing `cost` ms. */
  const job = (n: number, per: number, cost: number) => {
    const s = {done: 0, chunks: 0};
    const step = () => { const k = Math.min(per, n - s.done); s.done += k; s.chunks++; clock.t += k * cost; return s.done >= n; };
    return {s, step};
  };
  return {fb, clock, frame, job};
}

const BUDGET_60 = 1000 / 60 * (1 - FRAME_BUDGET.headroom);

describe('budget and refresh detection', () => {
  it('remaining = target × (1 − headroom) − main-thread ms already spent in the frame (60 Hz default until measured)', () => {
    const {fb, clock} = rig();
    expect(fb.refresh).toMatchObject({hz: 60, measured: false});
    expect(FRAME_BUDGET.headroom).toBe(0.3);
    fb.beginFrame(0, 100);
    clock.t = 105;
    expect(fb.budgetMs).toBeCloseTo(BUDGET_60, 6);
    expect(fb.remaining()).toBeCloseTo(BUDGET_60 - 5, 6);
    clock.t = 130; // an already-overrun frame
    expect(fb.remaining()).toBeLessThan(0);
  });

  it('detects the display rate: median rAF interval snapped to a common rate; jitter and rare hitches do not move it', () => {
    const jitter = (ms: number, n: number) => Array.from({length: n}, (_, i) => ms + (i % 3 - 1) * 0.4 + (i % 17 === 0 ? 30 : 0));
    for (const hz of [60, 75, 90, 120, 144, 165, 240]) {
      const d = detectRefresh(jitter(1000 / hz, 64), 64);
      expect(d.hz, `${hz} Hz`).toBe(hz);
      expect(d.snapped && d.measured).toBe(true);
    }
    // an uncommon rate stays as measured (80 Hz is > 6 % from 75 and 90)
    const odd = detectRefresh(Array(40).fill(12.5), 40);
    expect(odd.snapped).toBe(false);
    expect(odd.hz).toBeCloseTo(80, 6);
    // too few samples: the 60 Hz default
    expect(detectRefresh(Array(10).fill(1000 / 144), 10)).toMatchObject({hz: 60, measured: false, medianMs: null});
  });

  it('never budgets slower than 60 Hz: a game missing vsync (33 ms median) does not get a 33 ms budget', () => {
    const d = detectRefresh(Array(64).fill(1000 / 30), 64);
    expect(d.medianMs).toBeCloseTo(33.33, 2);
    expect(d.hz).toBe(60);
    const {fb, frame} = rig();
    for (let i = 0; i < 80; i++) frame(0, 1000 / 30);
    expect(fb.refresh.hz).toBe(60);
    expect(fb.budgetMs).toBeCloseTo(BUDGET_60, 6);
  });

  it('measures from the rAF timestamps it is given: 144 Hz shrinks the budget to 70 % of 6.94 ms', () => {
    const {fb, frame} = rig();
    for (let i = 0; i < FRAME_BUDGET.minSamples + 2; i++) frame(0, 1000 / 144);
    expect(fb.refresh).toMatchObject({hz: 144, measured: true});
    expect(fb.budgetMs).toBeCloseTo(1000 / 144 * 0.7, 6);
  });

  it('loading / warm-up intervals and hitches / gaps are not display samples', () => {
    const {fb, frame} = rig();
    fb.hold('loading');
    for (let i = 0; i < 40; i++) frame(0, 1000 / 144);
    fb.hold('warmup');
    for (let i = 0; i < 40; i++) frame(0, 1000 / 144);
    expect(fb.refresh.measured).toBe(false);
    fb.hold(null);
    for (let i = 0; i < 40; i++) frame(0, 400); // > maxSampleMs: gaps
    expect(fb.refresh.measured).toBe(false);
    fb.hold('paused'); // menus are sampled (light frames: the display's own pace)
    for (let i = 0; i < 40; i++) frame(0, 1000 / 120);
    expect(fb.refresh.hz).toBe(120);
  });
});

describe('chunks', () => {
  it('runs a chunk only when its estimate fits the remaining budget; the frame never passes the budget with accurate estimates', () => {
    const {fb, frame, job} = rig();
    const a = job(1000, 10, 0.1); // 1 ms chunks
    fb.request({key: 'a', step: a.step, initialEstimateMs: 1});
    const r = frame(4); // 4 ms of critical work, budget 11.67 ms -> 7 chunks fit (7.67 ms left)
    expect(a.s.chunks).toBe(7);
    expect(r.end - r.start).toBeLessThanOrEqual(BUDGET_60 + 1e-9);
    expect(r.ms).toBeCloseTo(7, 6);
    expect(fb.lastFrame).toMatchObject({chunks: 7, overdueRuns: 0, deferred: 0});
    expect(fb.lastFrame.spentBeforeMs).toBeCloseTo(4, 6);
    expect(fb.lastFrame.remainingMs).toBeCloseTo(BUDGET_60 - 11, 6);
    // a heavier frame leaves room for fewer chunks; one over budget leaves the job deferred (not yet overdue)
    frame(9);
    expect(a.s.chunks).toBe(9);
    frame(12);
    expect(a.s.chunks).toBe(9);
    expect(fb.lastFrame).toMatchObject({chunks: 0, deferred: 1});
  });

  it('carries the job state between chunks and finishes exactly once (step says done)', () => {
    const {fb, frame, job} = rig();
    const a = job(25, 10, 0.05);
    const onCancel = vi.fn();
    fb.request({key: 'a', step: a.step, onCancel});
    for (let i = 0; i < 5; i++) frame(2);
    expect(a.s).toEqual({done: 25, chunks: 3});
    expect(fb.has('a')).toBe(false);
    expect(fb.totals.completed).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('adapts the per-kind estimate (EWMA: rises fast, decays slowly) from a conservative start', () => {
    const {fb, frame, job} = rig();
    expect(fb.estimate('k')).toBe(FRAME_BUDGET.initialEstimateMs);
    const a = job(10000, 1, 0.25);
    fb.request({key: 'a', kind: 'k', step: a.step});
    frame(0);
    const after = fb.estimate('k');
    expect(after).toBeLessThan(FRAME_BUDGET.initialEstimateMs);
    expect(after).toBeGreaterThan(0.25);
    for (let i = 0; i < 20; i++) frame(0);
    expect(fb.estimate('k')).toBeCloseTo(0.25, 2);
    // one 4 ms chunk: the estimate jumps halfway (ewmaUp 0.5) — the next heavy frames keep clear of it
    fb.cancel('a');
    const b = job(1, 1, 4);
    fb.request({key: 'b', kind: 'k', step: b.step, priority: 5});
    frame(0);
    expect(fb.estimate('k')).toBeCloseTo(0.25 + 0.5 * (4 - 0.25), 1);
    expect(fb.totals.overruns).toBeGreaterThanOrEqual(1);
    expect(fb.diagnostics().estimates.k).toMatchObject({maxMs: 4});
  });

  it('caps chunks per frame (a zero-cost step cannot spin the frame)', () => {
    const {fb, frame} = rig();
    const step = vi.fn(() => false);
    fb.request({key: 'z', step, initialEstimateMs: 0});
    frame(0);
    expect(step).toHaveBeenCalledTimes(FRAME_BUDGET.maxChunksPerFrame);
  });

  it('a throwing step leaves the queue (counted, its owner told) and the others keep running', () => {
    const {fb, frame, job} = rig();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onCancel = vi.fn();
    const ok = job(3, 1, 0.1);
    fb.request({key: 'bad', priority: 1, step: () => { throw new Error('boom'); }, onCancel});
    fb.request({key: 'ok', step: ok.step});
    frame(0);
    expect(onCancel).toHaveBeenCalledWith('error');
    expect(fb.has('bad')).toBe(false);
    expect(ok.s.done).toBe(3);
    expect(fb.diagnostics()).toMatchObject({totals: {errors: 1}, lastError: 'bad: boom'});
    expect(err).toHaveBeenCalled();
  });
});

describe('fairness and staleness', () => {
  it('higher priority first; equal priority takes turns (round-robin passes) inside the budget', () => {
    const {fb, frame, job} = rig();
    const lo = job(100, 1, 1), hi = job(100, 1, 1), hi2 = job(100, 1, 1);
    fb.request({key: 'lo', kind: 'k', step: lo.step, initialEstimateMs: 1});
    fb.request({key: 'hi', kind: 'k', priority: 2, step: hi.step, initialEstimateMs: 1});
    fb.request({key: 'hi2', kind: 'k', priority: 2, step: hi2.step, initialEstimateMs: 1});
    frame(6.5); // 5.17 ms left: 5 chunks of 1 ms
    expect([hi.s.chunks, hi2.s.chunks, lo.s.chunks]).toEqual([2, 2, 1]);
    frame(9.5); // 2.17 ms left: 2 chunks, both to the priority-2 jobs
    expect([hi.s.chunks, hi2.s.chunks, lo.s.chunks]).toEqual([3, 3, 1]);
  });

  it('max staleness: a starved low-priority job becomes overdue and gets ONE chunk per frame even over budget', () => {
    const {fb, frame, job} = rig();
    const hog = job(1e6, 1, 1), lo = job(10, 1, 1);
    fb.request({key: 'hog', kind: 'k', priority: 9, maxStaleMs: 1e9, step: hog.step, initialEstimateMs: 1});
    fb.request({key: 'lo', kind: 'k', maxStaleMs: 100, step: lo.step, initialEstimateMs: 1});
    let firstLo = -1;
    for (let f = 1; f <= 40; f++) {
      frame(10.5); // room for ONE chunk: always the hog's while lo is not overdue
      if (lo.s.chunks > 0 && firstLo < 0) firstLo = f;
    }
    // 100 ms of active time at 16.7 ms frames: overdue from the 7th frame (the first frame starts the active clock); then it
    // goes first (one chunk per frame here) until done — it never starves — and the hog resumes afterwards
    expect(firstLo).toBeGreaterThanOrEqual(7);
    expect(firstLo).toBeLessThanOrEqual(8);
    expect(lo.s.done).toBe(10);
    expect(hog.s.chunks).toBe(40 - 10);
  });

  it('an overdue job in a frame already over budget is forced: one chunk, counted as an overdue run', () => {
    const {fb, frame, job} = rig();
    const lo = job(3, 1, 1);
    fb.request({key: 'lo', maxStaleMs: 40, step: lo.step, initialEstimateMs: 1});
    const ran: number[] = [];
    for (let f = 1; f <= 8; f++) { frame(14); ran.push(fb.lastFrame.overdueRuns); } // nothing ever fits
    expect(ran).toEqual([0, 0, 0, 1, 1, 1, 0, 0]); // overdue once 40 active ms passed (frame 4: 50 ms), then 1 per frame until done
    expect(lo.s.done).toBe(3);
    expect(fb.totals.overdueRuns).toBe(3);
  });

  it('paused / loading / warm-up time does not age a job', () => {
    const {fb, frame, job} = rig();
    const a = job(5, 1, 1);
    fb.request({key: 'a', maxStaleMs: 50, step: a.step, initialEstimateMs: 1});
    fb.hold('paused');
    for (let i = 0; i < 30; i++) frame(30);
    fb.hold('loading');
    for (let i = 0; i < 30; i++) frame(30);
    expect(fb.activeMs).toBe(0);
    expect(fb.diagnostics()).toMatchObject({queued: 1, overdue: 0, oldestAgeMs: 0});
    expect(a.s.chunks).toBe(0);
  });
});

describe('queue rules', () => {
  it('coalesces by key: one entry, the newest step, the highest priority, the earliest deadline (age is kept)', () => {
    const {fb, frame} = rig();
    const s1 = vi.fn(() => true), s2 = vi.fn(() => true);
    expect(fb.request({key: 'x', step: s1, maxStaleMs: 1000})).toBe('queued');
    fb.hold('paused'); frame(20); fb.hold(null);
    for (let i = 0; i < 4; i++) frame(20); // over budget: deferred, ageing
    const age = fb.diagnostics().oldestAgeMs;
    expect(age).toBeGreaterThan(0);
    expect(fb.request({key: 'x', step: s2, priority: 3, maxStaleMs: 5000})).toBe('coalesced');
    const d = fb.diagnostics();
    expect(d.queued).toBe(1);
    expect(d.jobs[0]).toMatchObject({priority: 3, maxStaleMs: 1000, ageMs: age});
    expect(d.totals).toMatchObject({requested: 2, coalesced: 1});
    frame(0);
    expect(s1).not.toHaveBeenCalled();
    expect(s2).toHaveBeenCalledTimes(1);
  });

  it('is bounded: a full queue drops the lowest priority (newest among equals) — counted, listed, owner told; never silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {fb, frame} = rig({maxQueue: 3});
    const cancels: [string, CancelReason][] = [];
    const req = (key: string, priority = 0) => fb.request({key, priority, step: () => true, onCancel: r => cancels.push([key, r])});
    expect(req('a')).toBe('queued');
    frame(20); frame(20); // over budget: a waits; b is requested later (newer)
    expect(req('b')).toBe('queued');
    expect(req('c', 1)).toBe('queued');
    expect(req('d')).toBe('dropped'); // not more important than the lowest queued
    expect(req('e', 2)).toBe('queued'); // evicts the newest lowest-priority job: b
    expect(cancels).toEqual([['d', 'dropped'], ['b', 'dropped']]);
    const d = fb.diagnostics();
    expect(d.queued).toBe(3);
    expect(d.jobs.map(j => j.key).sort()).toEqual(['a', 'c', 'e']);
    expect(d.totals.drops).toBe(2);
    expect(d.lastDrops).toEqual(['d', 'b']);
    expect(warn).toHaveBeenCalled();
  });

  it('cancel(key) removes a queued job and tells its owner', () => {
    const {fb} = rig();
    const onCancel = vi.fn();
    fb.request({key: 'a', step: () => true, onCancel});
    expect(fb.cancel('a')).toBe(true);
    expect(fb.cancel('a')).toBe(false);
    expect(onCancel).toHaveBeenCalledWith('cancelled');
  });
});

describe('world generation', () => {
  it('a bump cancels every queued job and rejects requests carrying the old token', () => {
    const {fb, frame} = rig();
    const g0 = fb.generation;
    const old = vi.fn(() => false), onCancel = vi.fn();
    fb.request({key: 'a', step: old, onCancel, generation: g0});
    fb.request({key: 'b', step: old, onCancel, generation: g0});
    const g1 = fb.bumpGeneration();
    expect(g1).toBe(g0 + 1);
    expect(fb.size).toBe(0);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledWith('generation');
    expect(fb.request({key: 'a', step: old, generation: g0})).toBe('stale'); // an old world's late request
    frame(0);
    expect(old).not.toHaveBeenCalled();
    expect(fb.request({key: 'a', step: () => true, generation: g1})).toBe('queued');
    expect(fb.diagnostics().totals).toMatchObject({staleRejected: 1, cancelled: 2});
  });

  it('a bump during a chunk stops the frame: no other old-world chunk runs after it', () => {
    const {fb, frame} = rig();
    const later = vi.fn(() => false);
    fb.request({key: 'first', priority: 1, step: () => { fb.bumpGeneration(); return false; }, initialEstimateMs: 0.1});
    fb.request({key: 'later', step: later, initialEstimateMs: 0.1});
    frame(0);
    expect(later).not.toHaveBeenCalled();
    expect(fb.size).toBe(0);
  });
});

describe('holds', () => {
  it('paused: nothing runs and the queue holds; play resumes it where it was', () => {
    const {fb, frame, job} = rig();
    const a = job(3, 1, 1);
    fb.request({key: 'a', step: a.step});
    fb.hold('paused');
    for (let i = 0; i < 10; i++) expect(frame(0).ms).toBe(0);
    expect(a.s.chunks).toBe(0);
    expect(fb.diagnostics()).toMatchObject({held: 'paused', queued: 1});
    fb.hold(null);
    frame(0);
    expect(a.s.done).toBe(3);
  });

  it('loading / warm-up: no background chunks at all, even overdue ones', () => {
    const {fb, frame, job} = rig();
    const a = job(3, 1, 1);
    fb.request({key: 'a', step: a.step, maxStaleMs: 0});
    for (const h of ['loading', 'warmup'] as const) {
      fb.hold(h);
      for (let i = 0; i < 5; i++) frame(40);
      expect(a.s.chunks).toBe(0);
    }
  });
});

describe('unavoidable overload', () => {
  it('a frame already over budget runs at most maxOverduePerFrame overdue chunks, one per job, least recently run first', () => {
    const {fb, frame, job} = rig();
    const jobs = Array.from({length: 5}, () => job(1e6, 1, 2));
    jobs.forEach((j, i) => fb.request({key: `j${i}`, kind: 'k', step: j.step, maxStaleMs: 0, initialEstimateMs: 2}));
    const fresh = job(10, 1, 0.1);
    fb.request({key: 'fresh', step: fresh.step, maxStaleMs: 1e9, initialEstimateMs: 0.1}); // not overdue: waits for room
    for (let f = 0; f < 10; f++) {
      const r = frame(40); // 40 ms of critical work: every frame is over budget
      expect(fb.lastFrame.overdueRuns).toBeLessThanOrEqual(FRAME_BUDGET.maxOverduePerFrame);
      expect(fb.lastFrame.chunks).toBe(FRAME_BUDGET.maxOverduePerFrame);
      expect(r.ms).toBeCloseTo(2 * FRAME_BUDGET.maxOverduePerFrame, 6); // bounded extra work, not a burst
    }
    // 20 forced chunks rotated over the 5 overdue jobs (least recently run first): 4 each
    expect(jobs.map(j => j.s.chunks)).toEqual([4, 4, 4, 4, 4]);
    expect(fresh.s.chunks).toBe(0);
    expect(fb.lastFrame.deferred).toBe(4); // three overdue jobs without a chunk this frame + the fresh one
  });

  it('long overdue chunks: the second forced chunk waits for the next frame (forced ms cap), the first always runs', () => {
    const {fb, frame, job} = rig();
    const jobs = Array.from({length: 3}, () => job(1e6, 1, 6)); // e.g. a long cross-storey path search
    jobs.forEach((j, i) => fb.request({key: `p${i}`, kind: 'path', step: j.step, maxStaleMs: 0, initialEstimateMs: 6}));
    for (let f = 0; f < 6; f++) {
      const r = frame(40);
      expect(fb.lastFrame.overdueRuns).toBe(1);
      expect(r.ms).toBeCloseTo(6, 6);
    }
    expect(jobs.map(j => j.s.chunks)).toEqual([2, 2, 2]);
    expect(FRAME_BUDGET.maxOverdueMsPerFrame).toBe(4);
  });

  it('a stream of new overdue jobs cannot starve a long overdue job: forced turns go by waiting time (FIFO round-robin)', () => {
    const {fb, frame, job} = rig();
    const long = job(8, 1, 2); // e.g. a field build: 8 slices
    fb.request({key: 'long', kind: 'slice', step: long.step, maxStaleMs: 0, initialEstimateMs: 2});
    const shorts: ReturnType<typeof job>[] = [];
    const longAt: number[] = [];
    for (let f = 0; f < 24; f++) {
      if (f < 8) { const j = job(1, 1, 6); shorts.push(j); fb.request({key: `s${f}`, kind: 'search', step: j.step, maxStaleMs: 0, initialEstimateMs: 6}); }
      const before = long.s.chunks;
      frame(40); // every frame over budget
      if (long.s.chunks > before) longAt.push(f);
    }
    expect(long.s.done).toBe(8);
    expect(shorts.every(j => j.s.done === 1)).toBe(true);
    // exactly one forced chunk per frame (6 ms searches never pair up under the forced-ms cap): 16 chunks in 16 frames
    expect(Math.max(...longAt)).toBeLessThanOrEqual(15);
    // while new jobs keep arriving (frames 0-7) the long job keeps its turns in line (f0, f2, f5 …), instead of waiting
    // until every newcomer has run (least-recently-run would have served it once before frame 9)
    expect(longAt.filter(f => f < 10).length).toBeGreaterThanOrEqual(3);
  });
});

describe('diagnostics', () => {
  it('reports measured numbers only: chunk ms = the time steps took, per frame and in total; queue, ages, estimates', () => {
    const {fb, frame, job} = rig();
    const a = job(6, 1, 0.75), b = job(1e6, 1, 6);
    fb.request({key: 'a', kind: 'ka', priority: 1, step: a.step, initialEstimateMs: 0.75});
    fb.request({key: 'b', kind: 'kb', step: b.step, initialEstimateMs: 6, maxStaleMs: 1e9});
    frame(5); // 6.67 ms left: a's 6 chunks fit (4.5 ms); b's 6 ms never does (5.92 ms left at best)
    const d = fb.diagnostics();
    expect(d.frame.chunks).toBe(6);
    expect(d.frame.ms).toBeCloseTo(4.5, 6);
    expect(d.frame.deferred).toBe(1);
    expect(d.totals).toMatchObject({chunks: 6, completed: 1, frames: 1});
    expect(d.totals.ms).toBeCloseTo(4.5, 6);
    expect(d.queued).toBe(1);
    expect(d.jobs).toEqual([{key: 'b', kind: 'kb', priority: 0, ageMs: 0, maxStaleMs: 1e9, overdue: false, chunks: 0}]);
    expect(d.estimates.ka).toMatchObject({samples: 6, lastMs: 0.75});
    expect(d.refresh).toMatchObject({hz: 60, measured: false});
    expect(d.budgetMs).toBeCloseTo(BUDGET_60, 6);
    frame(0);
    expect(fb.diagnostics().oldestAgeMs).toBeCloseTo(1000 / 60, 6);
  });

  it('an empty queue costs nothing: run() returns at once and allocates no job state', () => {
    const {fb, frame} = rig();
    for (let i = 0; i < 100; i++) expect(frame(3).ms).toBe(0);
    expect(fb.totals.frames).toBe(0);
  });
});
