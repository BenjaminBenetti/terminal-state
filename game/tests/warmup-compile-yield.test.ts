// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD; render/compileYield.ts, render/warmup.ts): how three yields
// during the BLOCKING loading warm-up.
//
// three r186's compileAsync yields after every object and after every shader stage of every build stage: scheduler.yield() where the
// browser has one, and ONE requestAnimationFrame per yield everywhere else. The warm-up holds the game's frames, so where
// scheduler.yield is missing its compile calls run with a task-boundary yield installed — and only they do:
//  1. installTaskYield: a browser that has scheduler.yield is left exactly as it is; without one a yield is installed that ends at the
//     next task (no animation frame), and restore() puts back exactly what was there;
//  2. the real runWarmup on three's real WebGPURenderer (no-op device): without scheduler.yield its materials stage takes NO animation
//     frame (the control, `taskYield: false`, takes them); with scheduler.yield the browser's own function is what three calls, and
//     it is never replaced; whatever happens the global is restored;
//  3. play is untouched: prepareObjects (content added mid-play) keeps three's own animation-frame fallback, and neither the journey's
//     compile nor the Game names the task yield at all.
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {hasSchedulerYield, installTaskYield} from '../src/render/compileYield';
import {prepareObjects, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {G, noScheduler, quickRun as run, warmupRig as rig} from './helpers/warmupRig';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete G.scheduler; });

describe('installTaskYield (render/compileYield.ts)', () => {
  it('a browser with scheduler.yield is left exactly as it is', () => {
    vi.stubGlobal('self', globalThis);
    const own = () => Promise.resolve();
    const sched = {yield: own, postTask: () => {}};
    vi.stubGlobal('scheduler', sched);
    expect(hasSchedulerYield()).toBe(true);
    const ty = installTaskYield();
    expect(ty.mode).toBe('scheduler');
    expect(G.scheduler).toBe(sched);
    expect(sched.yield).toBe(own);
    ty.restore();
    expect(G.scheduler).toBe(sched);
    expect(sched.yield).toBe(own);
    expect([ty.yields, ty.waitMs]).toEqual([0, 0]);
  });

  it('no scheduler: a yield that ends at the next task (after pending microtasks, without an animation frame); restore removes it', async () => {
    vi.stubGlobal('self', globalThis);
    noScheduler();
    const raf = vi.fn(() => 0);
    vi.stubGlobal('requestAnimationFrame', raf);
    expect(hasSchedulerYield()).toBe(false);
    let t = 100;
    const ty = installTaskYield(() => t);
    expect(ty.mode).toBe('task');
    const y = G.scheduler!.yield as () => Promise<void>;
    expect(typeof y).toBe('function');
    expect(hasSchedulerYield()).toBe(true); // (what three's yieldToMain tests)
    const order: string[] = [];
    const p = y().then(() => { order.push('yield'); });
    void Promise.resolve().then(() => { order.push('microtask'); });
    t = 107;
    await p;
    expect(order).toEqual(['microtask', 'yield']);
    expect(raf).not.toHaveBeenCalled();
    expect([ty.yields, ty.waitMs]).toEqual([1, 7]);
    // several in a row: each resolves, in order
    const seen: number[] = [];
    await Promise.all([0, 1, 2].map(i => y().then(() => { seen.push(i); })));
    expect(seen).toEqual([0, 1, 2]);
    expect(ty.yields).toBe(4);
    ty.restore();
    expect(G.scheduler).toBeUndefined();
    expect('scheduler' in globalThis).toBe(false);
    expect(hasSchedulerYield()).toBe(false);
    ty.restore(); // (idempotent)
    expect(G.scheduler).toBeUndefined();
  });

  it('a scheduler without yield (postTask only) gets one for the call and loses it again; the object and its postTask stay', async () => {
    vi.stubGlobal('self', globalThis);
    const postTask = () => {};
    const sched: {yield?: unknown; postTask: unknown} = {postTask};
    vi.stubGlobal('scheduler', sched);
    expect(hasSchedulerYield()).toBe(false);
    const ty = installTaskYield();
    expect(ty.mode).toBe('task');
    expect(G.scheduler).toBe(sched);
    expect(typeof sched.yield).toBe('function');
    await (sched.yield as () => Promise<void>)();
    ty.restore();
    expect(G.scheduler).toBe(sched);
    expect('yield' in sched).toBe(false);
    expect(sched.postTask).toBe(postTask);
  });

  it('a yield still pending at restore resolves', async () => {
    vi.stubGlobal('self', globalThis);
    noScheduler();
    const ty = installTaskYield();
    const p = (G.scheduler!.yield as () => Promise<void>)();
    ty.restore();
    expect(G.scheduler).toBeUndefined();
    await p;
    expect(ty.yields).toBe(1);
  });

  it('a second install while one is active changes nothing and restores nothing', async () => {
    vi.stubGlobal('self', globalThis);
    noScheduler();
    const first = installTaskYield();
    const y = G.scheduler!.yield;
    const second = installTaskYield();
    expect(second.mode).toBe('scheduler'); // (it finds a yield: the first one's)
    second.restore();
    expect(G.scheduler!.yield).toBe(y);
    first.restore();
    expect(G.scheduler).toBeUndefined();
  });

  it('not a page (no `self`): nothing is installed', () => {
    vi.stubGlobal('self', undefined);
    noScheduler();
    const ty = installTaskYield();
    expect(ty.mode).toBe('frame');
    expect(G.scheduler).toBeUndefined();
    ty.restore();
  });
});

describe('the loading warm-up\'s compile calls (render/warmup.ts runWarmup)', () => {
  it('no scheduler.yield: the materials stage takes no animation frame, and the global is as it was afterwards', async () => {
    const k = await rig();
    noScheduler();
    const res = await runWarmup(k.host, run);
    expect(res.status).toBe('complete');
    expect(res.stages.materials).toMatchObject({done: 5, total: 5});
    expect(k.n.builds).toBeGreaterThan(0);
    expect(k.n.raf, 'animation frames asked for by three\'s yields').toBe(0);
    expect(G.scheduler).toBeUndefined();
    expect('scheduler' in globalThis).toBe(false);
  }, 120_000);

  it('the control (`taskYield: false`): three\'s own fallback asks for an animation frame per yield', async () => {
    const k = await rig();
    noScheduler();
    const res = await runWarmup(k.host, {...run, taskYield: false});
    expect(res.status).toBe('complete');
    expect(k.n.raf).toBeGreaterThan(5);
    expect(G.scheduler).toBeUndefined();
  }, 120_000);

  it('scheduler.yield present: three calls the browser\'s own function, which is never replaced', async () => {
    const k = await rig();
    const seen = new Set<unknown>();
    const sched: {yield: () => Promise<void>} = {yield: () => { seen.add(G.scheduler); seen.add(G.scheduler?.yield); return new Promise<void>(res => setImmediate(res)); }};
    const own = vi.spyOn(sched, 'yield');
    const fn = sched.yield;
    vi.stubGlobal('scheduler', sched);
    const res = await runWarmup(k.host, run);
    expect(res.status).toBe('complete');
    expect(own.mock.calls.length).toBeGreaterThan(5);
    expect([...seen]).toEqual([sched, fn]); // (during every yield the global and its function were the browser's)
    expect(G.scheduler).toBe(sched);
    expect(sched.yield).toBe(fn);
    expect(k.n.raf).toBe(0);
  }, 120_000);

  it('a compile that throws: the warm-up reports the failure and the global is restored', async () => {
    const k = await rig();
    noScheduler();
    let during: unknown = null;
    (k.r as unknown as {compileAsync: () => Promise<void>}).compileAsync = async () => { during = typeof G.scheduler?.yield; throw new Error('lost'); };
    const res = await runWarmup(k.host, run);
    expect(res.status).toBe('failed');
    expect(during).toBe('function');
    expect(G.scheduler).toBeUndefined();
  }, 120_000);
});

describe('play keeps three\'s own yields', () => {
  it('prepareObjects (content added mid-play) installs nothing: without scheduler.yield it yields on animation frames as before', async () => {
    const k = await rig();
    noScheduler();
    const late = new THREE.Mesh(k.box, new THREE.MeshStandardMaterial({color: 0xaa3322, metalness: 0.4}));
    late.visible = false;
    k.scene.add(late);
    const compileAsync = k.r.compileAsync.bind(k.r);
    const during: unknown[] = [];
    (k.r as unknown as {compileAsync: (...a: unknown[]) => Promise<void>}).compileAsync = (...a: unknown[]) => { during.push(G.scheduler); return (compileAsync as (...x: unknown[]) => Promise<void>)(...a); };
    await prepareObjects(k.r as unknown as WarmupRenderer, k.scene, k.cam, late, null, 0);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every(x => x === undefined)).toBe(true);
    expect(k.n.raf).toBeGreaterThan(0);
    expect(G.scheduler).toBeUndefined();
  }, 120_000);

  it('only the loading warm-up names the task yield: not the journey\'s compile, not the Game', () => {
    const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
    for (const name of ['render/journeyCompile.ts', 'game.ts', 'render/runtimeVariants.ts']) expect(src(name), name).not.toMatch(/installTaskYield|compileYield'/);
    const warm = src('render/warmup.ts');
    expect(warm.match(/installTaskYield\(/g)?.length, 'one call site: runWarmup\'s compileIn').toBe(1);
  });
});
