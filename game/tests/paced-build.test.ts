// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): the paced runner (core/pacedBuild.ts) on a fake clock — slices
// bounded by sliceMs + one step, exactly-once completion, a throw inside the build, cancellation (the generator is closed), a hidden
// tab whose animation frames stop (the fallback timer; no wait while hidden), and the synchronous wrapper running the same steps.
import {describe, expect, it} from 'vitest';
import {PacedBuildCancelled, drainSync, newPacedStats, runPaced, type BuildSteps, type PacedBuildOptions} from '../src/core/pacedBuild';

/** A fake main thread: a clock, queued frame callbacks and timers, driven explicitly. */
class FakeLoop {
  t = 0;
  frames: (() => void)[] = [];
  timers: {at: number; go: () => void; id: number}[] = [];
  private id = 0;
  framesDelivered = 0;
  options(extra: PacedBuildOptions = {}): PacedBuildOptions {
    return {
      now: () => this.t,
      frame: go => { this.frames.push(go); },
      timer: (go, ms) => { const id = ++this.id; this.timers.push({at: this.t + ms, go, id}); return id; },
      clearTimer: h => { this.timers = this.timers.filter(x => x.id !== h); },
      hidden: () => false,
      ...extra,
    };
  }
  /** One drawn frame: 16 ms pass, every queued frame callback runs. */
  frame(): void {
    this.t += 16;
    const f = this.frames;
    this.frames = [];
    for (const go of f) { this.framesDelivered++; go(); }
  }
  /** No frame is drawn: the clock jumps to the next timer, which runs. */
  timer(): boolean {
    this.timers.sort((a, b) => a.at - b.at);
    const x = this.timers.shift();
    if (!x) return false;
    this.t = Math.max(this.t, x.at);
    x.go();
    return true;
  }
}
const settle = () => new Promise<void>(r => setTimeout(r, 0));

/** A build of `n` steps of `ms` each on `loop`'s clock; `log` records every step that ran; finally -> 'closed'. */
function* work(loop: FakeLoop, n: number, ms: number | ((i: number) => number), log: string[]): BuildSteps<number> {
  try {
    for (let i = 0; i < n; i++) {
      loop.t += typeof ms === 'number' ? ms : ms(i);
      log.push(`s${i}`);
      if (i < n - 1) yield i % 10 === 0 ? `stage${i / 10}` : undefined;
    }
    return n * 7;
  } finally { log.push('closed'); }
}

async function drive(loop: FakeLoop, p: Promise<unknown>, mode: 'frames' | 'timers' = 'frames', max = 10000): Promise<void> {
  let done = false;
  void p.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < max && !done; i++) {
    await settle();
    if (done) break;
    if (mode === 'frames') loop.frame(); else if (!loop.timer()) loop.frame();
  }
  await settle();
}

describe('paced build runner (lane BUILD)', () => {
  it('slices: each slice stops at the first step past sliceMs, one wait per slice, the result once', async () => {
    const loop = new FakeLoop(), log: string[] = [], stats = newPacedStats();
    let results = 0;
    const p = runPaced(work(loop, 100, 1.5, log), loop.options({sliceMs: 6, stats})).then(v => { results++; return v; });
    await drive(loop, p);
    expect(await p).toBe(700);
    expect(results).toBe(1);
    expect(log.filter(s => s.startsWith('s'))).toHaveLength(100);
    expect(log[log.length - 1]).toBe('closed'); // the generator ran to its end (its finally once)
    expect(log.filter(s => s === 'closed')).toHaveLength(1);
    // 1.5 ms steps: a slice ends at the 4th step (6 ms) -> 25 slices, 24 waits, every slice <= sliceMs + one step
    expect(stats.slices).toBe(25);
    expect(stats.waits).toBe(24);
    expect(stats.fallbacks).toBe(0);
    expect(stats.maxSliceMs).toBeLessThanOrEqual(6 + 1.5);
    expect(stats.maxStepMs).toBe(1.5);
    expect(stats.workMs).toBeCloseTo(150, 6);
    expect(stats.sliceMs).toHaveLength(25);
    // labelled yields start stages: stage0 = steps 1..10, '(start)' = step 0
    expect(stats.stages['(start)']).toBeCloseTo(1.5, 6);
    expect(stats.stages.stage0).toBeCloseTo(15, 6);
    expect(Object.values(stats.stages).reduce((a, b) => a + b, 0)).toBeCloseTo(150, 6);
  });

  it('a long atomic step makes one long slice (never cut inside a step), the next slice starts fresh', async () => {
    const loop = new FakeLoop(), log: string[] = [], stats = newPacedStats();
    const p = runPaced(work(loop, 20, i => (i === 7 ? 40 : 1), log), loop.options({sliceMs: 6, stats}));
    await drive(loop, p);
    expect(await p).toBe(140);
    expect(stats.maxStepMs).toBe(40);
    expect(stats.maxSliceMs).toBeLessThanOrEqual(40 + 6);
    expect(stats.sliceMs.filter(ms => ms > 7)).toHaveLength(1);
  });

  it('a throw inside the build rejects with that error; no step runs after it', async () => {
    const loop = new FakeLoop(), log: string[] = [];
    function* bad(): BuildSteps<number> {
      for (let i = 0; i < 50; i++) { loop.t += 2; log.push(`s${i}`); if (i === 12) throw new Error('boom at 12'); yield; }
      return 1;
    }
    const p = runPaced(bad(), loop.options({sliceMs: 5}));
    await drive(loop, p);
    await expect(p).rejects.toThrow('boom at 12');
    expect(log).toHaveLength(13);
    expect(log[12]).toBe('s12');
  });

  it('cancel: alive() false before a slice closes the generator (finally runs) and rejects PacedBuildCancelled', async () => {
    const loop = new FakeLoop(), log: string[] = [], stats = newPacedStats();
    let gen = 1;
    const mine = gen;
    const p = runPaced(work(loop, 100, 1, log), loop.options({sliceMs: 4, stats, alive: () => gen === mine}));
    let slicesAtCancel = -1;
    void p.catch(() => {});
    for (let i = 0; i < 6; i++) { await settle(); loop.frame(); }
    gen++; // the world generation changed (a teardown)
    slicesAtCancel = stats.slices;
    await drive(loop, p);
    await expect(p).rejects.toBeInstanceOf(PacedBuildCancelled);
    expect(stats.slices).toBe(slicesAtCancel); // nothing ran after the change
    expect(log[log.length - 1]).toBe('closed');
    expect(log.filter(s => s.startsWith('s')).length).toBeLessThan(100);
  });

  it('a hidden tab: no animation frames -> the fallback timer continues the build; it never hangs', async () => {
    const loop = new FakeLoop(), log: string[] = [], stats = newPacedStats();
    const p = runPaced(work(loop, 40, 2, log), loop.options({sliceMs: 5, fallbackMs: 120, stats}));
    await drive(loop, p, 'timers'); // frames never delivered while a timer is pending
    expect(await p).toBe(280);
    expect(loop.framesDelivered).toBe(0);
    expect(stats.fallbacks).toBe(stats.waits);
    expect(stats.waits).toBeGreaterThan(0);
  });

  it('while hidden() nothing waits: the rest runs at once (no frame, no timer)', async () => {
    const loop = new FakeLoop(), log: string[] = [], stats = newPacedStats();
    let hidden = false;
    const p = runPaced(work(loop, 60, 1, log), loop.options({sliceMs: 5, stats, hidden: () => hidden}));
    await settle(); loop.frame(); await settle(); loop.frame(); await settle();
    const before = stats.waits;
    hidden = true;
    loop.frame(); // the wait that was pending ends; from here on the page is hidden
    await settle(); await settle();
    expect(await p).toBe(420);
    expect(stats.waits).toBe(before + 0); // no new wait once hidden
    expect(stats.hiddenSteps).toBeGreaterThan(0);
  });

  it('a frame clears its fallback timer (no stray timer, no double resume)', async () => {
    const loop = new FakeLoop(), log: string[] = [], stats = newPacedStats();
    const p = runPaced(work(loop, 30, 3, log), loop.options({sliceMs: 5, stats}));
    await drive(loop, p);
    await p;
    expect(loop.timers).toHaveLength(0);
    expect(stats.fallbacks).toBe(0);
    expect(log.filter(s => s.startsWith('s'))).toHaveLength(30);
  });

  it('drainSync runs the identical steps in the same order and returns the same result', async () => {
    const a: string[] = [], b: string[] = [];
    const la = new FakeLoop(), lb = new FakeLoop();
    const sync = drainSync(work(la, 37, 1.25, a));
    const p = runPaced(work(lb, 37, 1.25, b), lb.options({sliceMs: 3}));
    await drive(lb, p);
    expect(await p).toBe(sync);
    expect(b).toEqual(a);
    expect(la.t).toBe(lb.t - lb.framesDelivered * 16); // the same work time (the paced clock also advanced by the frames)
  });

  it('default options work without a DOM (setTimeout frames in Node)', async () => {
    const log: string[] = [];
    const loop = new FakeLoop();
    const v = await runPaced(work(loop, 5, 0, log), {sliceMs: 0});
    expect(v).toBe(35);
  });
});
