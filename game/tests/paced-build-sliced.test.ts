// The time-sliced drain (core/pacedBuild.ts runSliced): the driver of a build during which NO frame is drawn — the pause menu's
// lighting rebuild (Game.runRelight) and the loading screen's station build. The frame-paced drain (runPaced) waits for a drawn frame
// after every 6 ms of work; with the frame loop held that wait is idle time (the pause menu's rebuild spent half its wall time there).
//  - slices of `sliceMs` with ONE turn of the event loop between two of them: the turns are at most work / sliceMs;
//  - the same steps in the same order, the same result and the same stage times as the synchronous and the frame-paced drain;
//  - a slice is never cut inside a step; a throw rejects; `alive() === false` closes the generator (PacedBuildCancelled);
//  - the default turn needs no animation frame and no timer (a hidden / throttled tab cannot stall it) and leaves nothing open;
//  - the REAL lighting bake (world/enhancedLightingRuntime.ts bakeSteps, the high bake with high probes, three levels) drained the
//    three ways gives the same bytes; cancelled mid-bake it leaves what the frame-paced drain leaves: no record, nothing cached.
import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {FakeIndexedDb} from './helpers/fakeIndexedDb';
import {FIX as RFIX, levelFixture as renderFixture} from './helpers/levelRenderFixture';
import {BUILD_PARK, PACED_BUILD, PacedBuildCancelled, SLICED_BUILD, drainSync, newPacedStats, runPaced, runSliced, type BuildSteps, type SlicedBuildOptions} from '../src/core/pacedBuild';
import {openDerivedCache} from '../src/core/derivedCache';
import type {LightingCapabilities} from '../src/world/enhancedLighting';
import {EnhancedLightingRuntime, type EnhancedBake, type EnhancedLightingSettings, type StationBakeInput} from '../src/world/enhancedLightingRuntime';
import {DEFAULT_FIELD} from '../src/world/lightField';

afterEach(() => { vi.restoreAllMocks(); });

/** A fake main thread: a clock and the queued turns of the event loop, taken one at a time. */
class FakeTurns {
  t = 0;
  queue: (() => void)[] = [];
  taken = 0;
  options(extra: SlicedBuildOptions = {}): SlicedBuildOptions {
    return {now: () => this.t, turn: go => { this.queue.push(go); }, ...extra};
  }
  /** One turn of the event loop (1 ms passes): the queued continuation runs. False: nothing was queued. */
  turn(): boolean {
    const go = this.queue.shift();
    if (!go) return false;
    this.t += 1;
    this.taken++;
    go();
    return true;
  }
}
const settle = () => new Promise<void>(r => setImmediate(r));
async function drive(loop: FakeTurns, p: Promise<unknown>, max = 100000): Promise<void> {
  let done = false;
  void p.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < max && !done; i++) { await settle(); if (!done) loop.turn(); }
  await settle();
}
/** A build of `n` steps of `ms` each on `clock`; `log` records every step that ran; finally -> 'closed'. */
function* work(clock: {t: number}, n: number, ms: number | ((i: number) => number), log: string[]): BuildSteps<number> {
  try {
    for (let i = 0; i < n; i++) {
      clock.t += typeof ms === 'number' ? ms : ms(i);
      log.push(`s${i}`);
      if (i < n - 1) yield i % 10 === 0 ? `stage${i / 10}` : undefined;
    }
    return n * 7;
  } finally { log.push('closed'); }
}

describe('time-sliced drain: slices with one turn of the event loop between them', () => {
  it('the defaults: a slice is several frames long, far longer than a frame-paced one', () => {
    expect(SLICED_BUILD.sliceMs).toBeGreaterThanOrEqual(30);
    expect(SLICED_BUILD.sliceMs).toBeLessThanOrEqual(50);
    expect(SLICED_BUILD.sliceMs).toBeGreaterThan(PACED_BUILD.sliceMs * 4);
  });

  it('each slice stops at the first step past sliceMs; one turn per slice but the last; the turns are at most work / sliceMs; the result once', async () => {
    const loop = new FakeTurns(), log: string[] = [], stats = newPacedStats();
    let results = 0;
    const p = runSliced(work(loop, 1000, 1.5, log), loop.options({sliceMs: 40, stats})).then(v => { results++; return v; });
    await drive(loop, p);
    expect(await p).toBe(7000);
    expect(results).toBe(1);
    expect(log.filter(s => s.startsWith('s'))).toHaveLength(1000);
    expect(log.filter(s => s === 'closed')).toHaveLength(1);
    expect(log[log.length - 1]).toBe('closed');
    // 1.5 ms steps: a slice ends at the 27th step (40.5 ms) -> 1000 / 27 = 38 slices (the last one short), 37 turns
    expect(stats.slices).toBe(38);
    expect(stats.waits).toBe(37);
    expect(loop.taken).toBe(37);
    expect(stats.waits).toBeLessThanOrEqual(Math.floor(stats.workMs / 40));
    expect(stats.maxSliceMs).toBeLessThanOrEqual(40 + 1.5);
    expect(stats.workMs).toBeCloseTo(1500, 6);
    expect([stats.fallbacks, stats.hiddenSteps]).toEqual([0, 0]);
    // the frame-paced drain of the same work at ITS slice length: ten times the waits (each one a drawn frame)
    const frames = new FakeTurns(), paced = newPacedStats();
    const q = runPaced(work(frames, 1000, 1.5, []), {now: () => frames.t, frame: go => { frames.queue.push(go); }, timer: () => 0, clearTimer: () => {}, hidden: () => false, sliceMs: PACED_BUILD.sliceMs, stats: paced});
    await drive(frames, q);
    expect(paced.waits).toBe(249);
    expect(paced.waits / stats.waits).toBeGreaterThan(6);
  });

  it('the same steps in the same order, the same result and the same stage times as the synchronous and the frame-paced drain', async () => {
    const a: string[] = [], b: string[] = [], c: string[] = [];
    const ca = {t: 0}, lb = new FakeTurns(), lc = new FakeTurns();
    const ms = (i: number) => 0.25 + (i % 7) * 0.5;
    const sync = drainSync(work(ca, 333, ms, a));
    const sb = newPacedStats(), sc = newPacedStats();
    const pb = runSliced(work(lb, 333, ms, b), lb.options({sliceMs: 40, stats: sb}));
    await drive(lb, pb);
    const pc = runPaced(work(lc, 333, ms, c), {now: () => lc.t, frame: go => { lc.queue.push(go); }, timer: () => 0, clearTimer: () => {}, hidden: () => false, sliceMs: 6, stats: sc});
    await drive(lc, pc);
    expect([await pb, await pc]).toEqual([sync, sync]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(sb.steps).toBe(sc.steps);
    expect(Object.keys(sb.stages)).toEqual(Object.keys(sc.stages));
    for (const k of Object.keys(sb.stages)) expect(sb.stages[k], k).toBeCloseTo(sc.stages[k], 6);
    expect(sb.workMs).toBeCloseTo(ca.t, 6); // the work alone: no turn's time is counted in it
  });

  it('a long atomic step makes one long slice (never cut inside a step)', async () => {
    const loop = new FakeTurns(), stats = newPacedStats();
    const p = runSliced(work(loop, 200, i => (i === 77 ? 400 : 1), []), loop.options({sliceMs: 40, stats}));
    await drive(loop, p);
    expect(await p).toBe(1400);
    expect(stats.maxStepMs).toBe(400);
    expect(stats.maxSliceMs).toBeLessThanOrEqual(400 + 40);
    expect(stats.sliceMs.filter(v => v > 41)).toHaveLength(1);
  });

  it('a throw inside the build rejects with that error; no step runs after it', async () => {
    const loop = new FakeTurns(), log: string[] = [];
    function* bad(): BuildSteps<number> {
      for (let i = 0; i < 500; i++) { loop.t += 2; log.push(`s${i}`); if (i === 120) throw new Error('boom at 120'); yield; }
      return 1;
    }
    const p = runSliced(bad(), loop.options({sliceMs: 40}));
    await drive(loop, p);
    await expect(p).rejects.toThrow('boom at 120');
    expect(log).toHaveLength(121);
    expect(loop.queue).toHaveLength(0);
  });

  it('cancel: alive() false before a slice closes the generator (its finally runs) and rejects PacedBuildCancelled; nothing runs after', async () => {
    const loop = new FakeTurns(), log: string[] = [], stats = newPacedStats();
    let gen = 1;
    const mine = gen;
    const p = runSliced(work(loop, 1000, 1, log), loop.options({sliceMs: 40, stats, alive: () => gen === mine}));
    void p.catch(() => {});
    for (let i = 0; i < 6; i++) { await settle(); loop.turn(); }
    await settle();
    gen++; // the world generation changed (a teardown)
    const slices = stats.slices, steps = log.length;
    expect(slices).toBe(7);
    await drive(loop, p);
    await expect(p).rejects.toBeInstanceOf(PacedBuildCancelled);
    expect(stats.slices).toBe(slices);
    expect(log.slice(0, steps)).not.toContain('closed');
    expect(log.slice(steps)).toEqual(['closed']);
  });

  it('a build that is dead before its first slice runs no step at all', async () => {
    const loop = new FakeTurns(), log: string[] = [];
    await expect(runSliced(work(loop, 10, 1, log), loop.options({alive: () => false}))).rejects.toBeInstanceOf(PacedBuildCancelled);
    expect(log).toEqual([]); // (a generator that never started has no finally to run)
  });

  it('the default turn: no animation frame, no timer — a hidden or throttled tab cannot stall it — and its channel is closed at the end', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    vi.stubGlobal('requestAnimationFrame', () => { throw new Error('no frame may be asked for'); });
    const Real = globalThis.MessageChannel;
    const made: {closed: number}[] = [];
    vi.stubGlobal('MessageChannel', class extends Real {
      constructor() {
        super();
        const rec = {closed: 0};
        made.push(rec);
        for (const port of [this.port1, this.port2]) { const close = port.close.bind(port); port.close = () => { rec.closed++; close(); }; }
      }
    });
    try {
      const clock = {t: 0}, stats = newPacedStats(), log: string[] = [];
      // (the fake clock moves only inside the steps: every 4th step ends a slice)
      const v = await runSliced(work(clock, 100, 10, log), {now: () => clock.t, sliceMs: 40, stats});
      expect(v).toBe(700);
      expect(stats.waits).toBe(24);
      expect(timers).not.toHaveBeenCalled();
      expect(made).toEqual([{closed: 2}]); // one channel for the whole run, both ports closed
      // cancelled and failed runs close it too
      let alive = true;
      const dead = runSliced(work(clock, 100, 10, []), {now: () => clock.t, sliceMs: 40, alive: () => alive});
      alive = false;
      await expect(dead).rejects.toBeInstanceOf(PacedBuildCancelled);
      expect(made).toEqual([{closed: 2}, {closed: 2}]);
      // a build that fits one slice takes no turn and opens no channel
      expect(await runSliced(work(clock, 3, 1, []), {now: () => clock.t, sliceMs: 40})).toBe(21);
      expect(made).toHaveLength(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it('without MessageChannel the turn is a zero timer (still no animation frame)', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    vi.stubGlobal('requestAnimationFrame', () => { throw new Error('no frame may be asked for'); });
    try {
      const clock = {t: 0}, stats = newPacedStats();
      expect(await runSliced(work(clock, 20, 10, []), {now: () => clock.t, sliceMs: 40, stats})).toBe(140);
      expect(stats.waits).toBe(4);
    } finally { vi.unstubAllGlobals(); }
  });
});

// ---------------------------------------------------------------------------------------------
// A build that waits for work done off this thread (task studio-gi-mood-bounce-loading-20261115-081523-01, lane WORKERS: the lighting
// bake's workers): it yields {wait}; both drivers park there. (tests/light-bake-workers.test.ts has the real bake on real threads.)
describe('a build that waits: both drivers park on a yielded wait', () => {
  /** Four steps of 5 ms on `clock`, a wait for `gate` after the second (in stage 'one'); finally -> 'closed'. */
  function* waiting(clock: {t: number}, log: string[], gate: PromiseLike<unknown>): BuildSteps<string> {
    try {
      clock.t += 5; log.push('a');
      yield 'one';
      clock.t += 5; log.push('b');
      yield {wait: gate};
      clock.t += 5; log.push('c');
      yield 'two';
      clock.t += 5; log.push('d');
      return 'done';
    } finally { log.push('closed'); }
  }
  const drivers = {
    sliced: (steps: BuildSteps<string>, clock: {t: number}, o: {stats?: ReturnType<typeof newPacedStats>; alive?: () => boolean}) =>
      runSliced(steps, {now: () => clock.t, sliceMs: 40, turn: () => { throw new Error('no turn is taken: every slice is short'); }, ...o}),
    paced: (steps: BuildSteps<string>, clock: {t: number}, o: {stats?: ReturnType<typeof newPacedStats>; alive?: () => boolean}) =>
      runPaced(steps, {now: () => clock.t, sliceMs: 40, hidden: () => false, frame: () => { throw new Error('no frame is waited for: a park is not a frame wait'); }, timer: () => 0, clearTimer: () => {}, ...o}),
  };

  for (const how of ['sliced', 'paced'] as const) {
    it(`${how}: the slice ends at the wait, nothing runs until it settles, then the build goes on; the parked time is not work`, async () => {
      const clock = {t: 0}, log: string[] = [], stats = newPacedStats();
      let release!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      const p = drivers[how](waiting(clock, log, gate), clock, {stats});
      for (let i = 0; i < 20; i++) await settle();
      expect(log).toEqual(['a', 'b']); // parked: the step after the wait has not run
      expect([stats.slices, stats.parks]).toEqual([1, 1]);
      clock.t += 250; // (the wall time the work elsewhere took)
      release();
      expect(await p).toBe('done');
      expect(log).toEqual(['a', 'b', 'c', 'd', 'closed']);
      expect([stats.slices, stats.steps, stats.waits, stats.parks]).toEqual([2, 4, 0, 1]);
      expect(stats.workMs).toBe(20); // this thread's own time: the wait is not in it
      expect(stats.stages).toEqual({'(start)': 5, one: 10, two: 5});
      expect(stats.parkedMs).toBe(250);
      expect(stats.parked).toEqual({one: 250}); // under the stage that waited
    });

    it(`${how}: a wait that fails resumes the build all the same (the build looks at what came); a wait settled beforehand costs no poll`, async () => {
      for (const gate of [Promise.reject(new Error('the work elsewhere failed')), Promise.resolve(1), {then: (ok: (v: number) => void) => { ok(1); }} as PromiseLike<number>]) {
        const clock = {t: 0}, log: string[] = [], stats = newPacedStats();
        const t0 = performance.now();
        expect(await drivers[how](waiting(clock, log, gate), clock, {stats})).toBe('done');
        expect(performance.now() - t0).toBeLessThan(BUILD_PARK.pollMs);
        expect(log).toEqual(['a', 'b', 'c', 'd', 'closed']);
        expect([stats.parks, stats.parkedMs]).toEqual([1, 0]);
      }
    });

    it(`${how}: abandoned while parked — alive() is asked while it waits: the generator is closed (its finally runs) and the run rejects PacedBuildCancelled`, async () => {
      const clock = {t: 0}, log: string[] = [], stats = newPacedStats();
      let alive = true, asked = 0;
      const p = drivers[how](waiting(clock, log, new Promise<void>(() => {})), clock, {stats, alive: () => { asked++; return alive; }}); // (a wait that never settles)
      void p.catch(() => {});
      for (let i = 0; i < 20; i++) await settle();
      expect(log).toEqual(['a', 'b']);
      const before = asked;
      await new Promise<void>(r => setTimeout(r, BUILD_PARK.pollMs * 2 + 50));
      expect(asked).toBeGreaterThan(before); // polled while parked, and still parked
      expect(log).toEqual(['a', 'b']);
      alive = false; // the world generation changed
      await expect(p).rejects.toBeInstanceOf(PacedBuildCancelled);
      expect(log).toEqual(['a', 'b', 'closed']);
      expect([stats.slices, stats.parks]).toEqual([1, 1]);
    });
  }

  it('drainSync cannot wait: handed a build that parks, it closes it (its finally runs) and throws', () => {
    const clock = {t: 0}, log: string[] = [];
    expect(() => drainSync(waiting(clock, log, new Promise<void>(() => {})))).toThrow('drainSync: this build waits for work done off this thread');
    expect(log).toEqual(['a', 'b', 'closed']);
  });

  it('the poll is short against a bake and long against a frame', () => {
    expect(BUILD_PARK.pollMs).toBeGreaterThanOrEqual(50);
    expect(BUILD_PARK.pollMs).toBeLessThanOrEqual(250);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the real lighting bake through the three drains', () => {
  const HW: LightingCapabilities = {backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};
  const HIGH: EnhancedLightingSettings = {enhancedLighting: 'on', reflections: 'high'};
  /** A station of three levels (80 x 50 cells: an upper deck and a crossing below the main level). */
  function threeLevels(): StationBakeInput {
    const {layout, levels} = renderFixture();
    return {source: {grid: layout.grid, lights: layout.lights, trenchFloorY: RFIX.bedY, levels}, params: {...DEFAULT_FIELD}, reactor: false, extra: ''};
  }
  /** A fresh runtime (its own empty cache) and the cache writes it made. */
  function runtime() {
    const puts: string[] = [];
    const rt = new EnhancedLightingRuntime(HIGH, {openCache: () => {
      const c = openDerivedCache({indexedDB: new FakeIndexedDb(), compress: false}), put = c.put.bind(c);
      (c as {put: typeof c.put}).put = (key, bundle, tag) => { puts.push(key); return put(key, bundle, tag); };
      return c;
    }});
    rt.setCapabilities(HW);
    return {rt, puts};
  }
  const bytes = (v: ArrayBufferView) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  const print = (b: EnhancedBake) => ({
    field: [b.baked!.w, b.baked!.h, b.baked!.depth, b.baked!.gi], shading: b.shading, mirror: b.mirror, probes: b.probes!.count,
    data: bytes(b.baked!.data).toString('base64'), atlas: bytes(b.probes!.atlas).toString('base64'), meta: bytes(b.probes!.meta).toString('base64'), grid: bytes(b.probes!.grid).toString('base64'),
  });

  it('the same bytes (field with its cube, probe atlas, meta and grid), the same record and one cache write each; the turns are bounded by the work', async () => {
    const input = threeLevels();
    const a = runtime(), b = runtime(), c = runtime();
    for (const r of [a, b, c]) await r.rt.prefetch(input);
    const sync = drainSync(a.rt.bakeSteps(input, null, {max3DTextureSize: 2048}));
    const sliced = newPacedStats(), paced = newPacedStats();
    const viaSlices = await runSliced(b.rt.bakeSteps(input, null, {max3DTextureSize: 2048}), {stats: sliced});
    const viaFrames = await runPaced(c.rt.bakeSteps(input, null, {max3DTextureSize: 2048}), {stats: paced, hidden: () => false, frame: go => { setImmediate(go); }});
    const want = print(sync);
    expect(want.probes).toBeGreaterThan(4);
    expect(print(viaSlices)).toEqual(want);
    expect(print(viaFrames)).toEqual(want);
    const record = (r: {rt: EnhancedLightingRuntime}) => { const s = r.rt.status().active!; return {...s, giMs: 0, probeMs: 0}; };
    expect(record(b)).toEqual(record(a));
    expect(record(c)).toEqual(record(a));
    expect(record(a)).toMatchObject({gi: 'high', reflections: 'high', cache: 'miss'});
    for (let i = 0; i < 50; i++) await settle();
    expect([a.puts.length, b.puts.length, c.puts.length]).toEqual([1, 1, 1]);
    expect(b.puts).toEqual(a.puts); // (the same key: the digests do not know how the steps were driven)
    expect(c.puts).toEqual(a.puts);
    // the same steps; the sliced drain took at most work / slice turns, the frame-paced one several times as many waits
    expect(sliced.steps).toBe(paced.steps);
    expect(sliced.waits).toBeLessThanOrEqual(Math.floor(sliced.workMs / SLICED_BUILD.sliceMs));
    expect(sliced.slices).toBe(sliced.waits + 1);
    expect(paced.waits).toBeGreaterThan(sliced.waits * 3);
    console.log(`three-level high bake: ${sliced.steps} steps; sliced ${sliced.workMs.toFixed(0)} ms in ${sliced.slices} slices (${sliced.waits} turns, longest ${sliced.maxSliceMs.toFixed(1)} ms); `
      + `frame-paced ${paced.workMs.toFixed(0)} ms in ${paced.slices} slices (${paced.waits} waits for a frame)`);
  }, 120_000);

  it('cancelled mid-bake, both drains leave the same: the generator closed, no record of that bake, nothing cached; the next bake is whole', async () => {
    const input = threeLevels();
    const left: Record<string, unknown>[] = [];
    for (const how of ['sliced', 'paced'] as const) {
      const r = runtime();
      await r.rt.prefetch(input);
      const before = r.rt.status();
      let alive = true, stage = '';
      const steps = r.rt.bakeSteps(input, null, {max3DTextureSize: 2048});
      let closed = false;
      const watched = (function* (): BuildSteps<EnhancedBake> {
        try {
          for (;;) {
            const s = steps.next();
            if (s.done) return s.value;
            if (typeof s.value === 'string') { stage = s.value; if (stage.startsWith('gather')) alive = false; } // the station is replaced as the gather starts
            yield s.value;
          }
        } finally { closed = true; steps.return(undefined as never); }
      })();
      const p = how === 'sliced'
        ? runSliced(watched, {sliceMs: 0, alive: () => alive})
        : runPaced(watched, {sliceMs: 0, hidden: () => false, frame: go => { setImmediate(go); }, alive: () => alive});
      await expect(p).rejects.toBeInstanceOf(PacedBuildCancelled);
      for (let i = 0; i < 20; i++) await settle();
      left.push({closed, stage: stage.split('.')[0], puts: r.puts.length, timings: r.rt.timings === null ? null : 'set', active: r.rt.status().active, pending: r.rt.status().pending === before.pending});
      // ... and the runtime is not left half-way: the same station bakes whole afterwards
      const again = drainSync(r.rt.bakeSteps(input, null, {max3DTextureSize: 2048}));
      expect(again.probes!.count, how).toBeGreaterThan(4);
      expect(r.rt.status().active, how).toMatchObject({gi: 'high', reflections: 'high', cache: 'miss'});
    }
    expect(left[0]).toMatchObject({closed: true, stage: 'gather', puts: 0});
    expect(left[0]).toEqual(left[1]);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
describe('game.ts: which drain runs where', () => {
  const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
  const body = (from: string, to: string) => { const a = src.indexOf(from); expect(a, from).toBeGreaterThan(0); const b = src.indexOf(to, a + from.length); expect(b, to).toBeGreaterThan(a); return src.slice(a, b); };

  it('the pause menu\'s lighting rebuild holds the frames and drains in time slices, with the same alive check; the journey stays frame-paced', () => {
    const relight = body('  private async runRelight(', '\n  }\n');
    expect(relight).toContain('this.warming = true;');
    expect(relight).toContain('const alive = () => gen === this.stationGen && !this.gpu?.deviceLost && !!this.world;');
    // (task studio-gi-mood-bounce-loading-20261115-081523-01, lane WORKERS: ... and a bake whose choice changed under it is abandoned the same way)
    expect(relight).toContain('const wanted = () => alive() && el.pendingSignature() === signature;');
    expect(relight).toMatch(/await runSliced\(stageLabels\(this\.relightSteps\(input\), [^\n]*\{\.\.\.this\.slicePacing, stats, alive: wanted\}\);/);
    expect(relight).not.toMatch(/runPaced\(/);
    expect(relight).toContain('if (err instanceof PacedBuildCancelled) {');
    const journey = body('  private async buildSectionPaced(', '\n  }\n');
    // (lane WORKERS: the last argument — the lighting bake may wait for its workers under a drain that can wait)
    // (task studio-surface-run-lift-reliability-and-cab-20261118-023909-01: `pacing` = the caller's slice length — the lift ride's
    // LIFT_RIDE_WAIT.buildSliceMs; the journey passes none — under the QA override, stats and the alive check)
    // (task studio-surface-tent-first-staging-20261120-225458-01: `onStage` — the Surface crossings' stages for the staged command tent's
    // progress line — the same steps, labels reported as they start)
    expect(journey).toContain('const steps = this.buildSectionSteps(key, layout, arrival, fresh, true);');
    expect(journey).toContain('await runPaced(onStage ? stageLabels(steps, onStage) : steps, {...pacing, ...this.buildPacing, stats, alive: () => gen === this.stationGen});');
  });
});
