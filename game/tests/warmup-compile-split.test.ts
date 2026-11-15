// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD; render/compileYield.ts observeCompile, render/warmup.ts
// WarmupResult.compile): the warm-up result says where its MATERIALS stage went — node builds and asynchronous pipeline requests as
// three really made them, how three yielded, and (with the warm-up's own task yield) how many yields it took. Judged against counters
// of the test's own inside three's real WebGPURenderer (no-op device); the observers put back exactly what they wrapped.
import {afterEach, describe, expect, it, vi} from 'vitest';
import {emptyCompileSplit, observeCompile} from '../src/render/compileYield';
import {runWarmup, skippedWarmup} from '../src/render/warmup';
import {G, noScheduler, quickRun as run, warmupRig as rig} from './helpers/warmupRig';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete G.scheduler; });

describe('WarmupResult.compile (render/warmup.ts runWarmup)', () => {
  it('no scheduler.yield: the warm-up\'s task yield, counted; builds and asynchronous pipelines are three\'s own counts', async () => {
    const k = await rig();
    noScheduler();
    const res = await runWarmup(k.host, run);
    expect(res.status).toBe('complete');
    expect(res.compile.yield).toBe('task');
    expect(res.compile.yields).toBeGreaterThan(5);
    expect(res.compile.yieldWaitMs).toBeGreaterThanOrEqual(0);
    expect(res.compile.builds).toBe(k.n.afterCompile!.builds);
    expect(res.compile.builds).toBeGreaterThan(0);
    expect(res.compile.pipelines).toBe(k.n.afterCompile!.asyncPipelines);
    expect(res.compile.pipelines).toBeGreaterThan(0);
    for (const v of [res.compile.buildMs, res.compile.pipelineWaitMs]) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
  }, 120_000);

  it('three\'s animation-frame fallback (`taskYield: false`) and the browser\'s own scheduler.yield are named, their yields not counted', async () => {
    const a = await rig();
    noScheduler();
    const frames = await runWarmup(a.host, {...run, taskYield: false});
    expect(frames.compile).toMatchObject({yield: 'frame', yields: null, yieldWaitMs: null});
    expect(frames.compile.builds).toBe(a.n.afterCompile!.builds);
    vi.unstubAllGlobals();
    const b = await rig(); // (the rig's globals have a scheduler.yield)
    const own = await runWarmup(b.host, run);
    expect(own.compile).toMatchObject({yield: 'scheduler', yields: null, yieldWaitMs: null});
    expect(own.compile.builds).toBe(b.n.afterCompile!.builds);
    expect(own.compile.pipelines).toBe(b.n.afterCompile!.asyncPipelines);
  }, 120_000);

  it('three\'s node manager and pipelines are as they were after the warm-up (the observers put back what they wrapped)', async () => {
    const k = await rig();
    const before = [k.R._nodes._createNodeBuilder, k.R._nodes._createNodeBuilderState, k.R._pipelines.getForRender];
    const own = ['_createNodeBuilder', '_createNodeBuilderState'].map(name => Object.prototype.hasOwnProperty.call(k.R._nodes, name));
    await runWarmup(k.host, run);
    expect([k.R._nodes._createNodeBuilder, k.R._nodes._createNodeBuilderState, k.R._pipelines.getForRender]).toEqual(before);
    expect(['_createNodeBuilder', '_createNodeBuilderState'].map(name => Object.prototype.hasOwnProperty.call(k.R._nodes, name))).toEqual(own);
  }, 120_000);
});

describe('observeCompile (render/compileYield.ts)', () => {
  it('counts builds from the builder\'s creation to its state, and asynchronous pipeline requests until they settle; undo puts everything back', async () => {
    let t = 0;
    class Nodes { _createNodeBuilder() { t += 3; return {}; } _createNodeBuilderState() { t += 4; return {}; } }
    let release: (() => void) | null = null;
    const pipes = {getForRender(_ro: unknown, promises?: unknown[] | null) { if (promises) promises.push(new Promise<void>(res => { release = res; })); }};
    const inner = pipes.getForRender;
    const nodes = new Nodes();
    const split = emptyCompileSplit();
    expect(split).toEqual({yield: 'frame', builds: null, buildMs: null, pipelines: null, pipelineWaitMs: null, yields: null, yieldWaitMs: null});
    const undo = observeCompile({_nodes: nodes, _pipelines: pipes}, split, () => t);
    for (let i = 0; i < 2; i++) { nodes._createNodeBuilder(); t += 10; nodes._createNodeBuilderState(); }
    expect([split.builds, split.buildMs]).toEqual([2, 34]); // (3 + 10 + 4, twice)
    const promises: unknown[] = [];
    pipes.getForRender({}, promises);
    pipes.getForRender({}, null); // (a synchronous request: not counted)
    expect(split.pipelines).toBe(1);
    t += 25;
    release!();
    await Promise.all(promises);
    await Promise.resolve();
    expect(split.pipelineWaitMs).toBe(25);
    undo();
    expect(Object.prototype.hasOwnProperty.call(nodes, '_createNodeBuilder')).toBe(false); // (the class's methods again)
    expect(pipes.getForRender).toBe(inner);
    nodes._createNodeBuilder(); nodes._createNodeBuilderState();
    expect(split.builds).toBe(2);
    // a renderer it cannot read: the split stays null
    const blind = emptyCompileSplit('scheduler');
    observeCompile({}, blind)();
    expect(blind).toEqual(emptyCompileSplit('scheduler'));
    expect(skippedWarmup('x').compile).toEqual(emptyCompileSplit());
  });
});
