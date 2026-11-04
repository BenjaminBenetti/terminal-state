// Task studio-journey-compile-pacing-20261104 (the user's native Chrome Mall trace: 100-117 ms frames while the train journey's
// background compile continued after the arrival — three r186's compileAsync over a 16-item chunk chained scheduler.yield()
// continuations, which Chrome runs ahead of rendering): render/journeyCompile.ts's scene lane PACED to real frames, through the REAL
// frame-budget scheduler (core/frameBudget.ts) with a fake renderer whose compileAsync settles when the test says (a cache hit settles
// at once, a new build's yielded stages last past the next frame) and a fake clock:
//  - ONE item per compileAsync call, one call in flight, each call's item alone on the prep layer;
//  - an item settling after its frame ended (or over the slice's real-time budget) waits for the next frame's step: one call per frame;
//  - cheap items batch only inside the frame their slice started in, bounded by JOURNEY_COMPILE.sliceMs and maxPerSlice;
//  - a hidden page / pause: no launches without a step, no burst on resume;
//  - completion exactly once; cancel / world change / renderer failure mid-flight start nothing more;
//  - the background-priority launcher (scheduler.postTask 'background' where it exists): the step only posts, the call runs in that
//    task, a task that never runs is run by a step after postStallFrames frames (the stale one is then a no-op), no launcher = direct.
import * as THREE from 'three';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {FrameBudget} from '../src/core/frameBudget';
import {JOURNEY_COMPILE, JourneyCompile, PREP_LAYER} from '../src/render/journeyCompile';
import type {WarmItem} from '../src/render/warmup';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

interface Call { on: THREE.Object3D[]; frame: number; done: boolean; resolve(): void; reject(e: unknown): void }

const flush = () => new Promise<void>(r => setImmediate(r));

function rig(n: number, o: {post?: ((fn: () => void) => void) | null; throwAt?: number} = {}) {
  let clock = 1000;
  const now = () => clock;
  const fb = new FrameBudget({now});
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  scene.add(cam);
  const geo = new THREE.BoxGeometry(), mat = new THREE.MeshBasicMaterial();
  const items: WarmItem[] = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.layers.set(3); // (off the camera: only the isolation puts it on the prep layer)
    scene.add(m);
    items.push({object: m as never, flips: [], caster: false});
  }
  const calls: Call[] = [];
  let target: unknown = null, mrt: unknown = null;
  const renderer = {
    getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t; }, getMRT: () => mrt, setMRT: (m: unknown) => { mrt = m; },
    render: () => undefined,
    compileAsync(s: THREE.Object3D, view: THREE.Camera): Promise<void> {
      if (o.throwAt === calls.length) throw new Error('renderer failed');
      const on: THREE.Object3D[] = [];
      s.traverse(x => { if ((x as THREE.Mesh).isMesh && x.visible && x.layers.test(view.layers)) on.push(x); });
      return new Promise<void>((resolve, reject) => { calls.push({on, frame: fb.frame, done: false, resolve, reject}); });
    },
  };
  const job = new JourneyCompile({renderer: renderer as never, scheduler: fb, scene, camera: cam, target: null, depth: 0, items, casters: [], receiver: null,
    frameNo: () => fb.frame, now, ...(o.post !== undefined ? {post: o.post} : {})});
  /** One game frame callback: beginFrame (the frame number advances), the render, then the scheduler's run (held: no steps). */
  const frame = (held: 'paused' | null = null, dt = 16.7) => { clock += dt; fb.hold(held); fb.beginFrame(clock, clock); fb.run(); };
  /** Settle the open call `ms` of real time after now (its work), then let the job react (microtasks / timers). */
  const settle = async (ms = 0, fail?: unknown) => {
    const c = calls.find(x => !x.done);
    if (!c) throw new Error('no call in flight');
    clock += ms;
    c.done = true;
    if (fail !== undefined) c.reject(fail); else c.resolve();
    await flush();
  };
  const open = () => calls.filter(c => !c.done).length;
  const layers = () => items.map(i => i.object.layers.mask).join(',');
  return {fb, job, items, calls, frame, settle, open, layers, advance: (ms: number) => { clock += ms; }};
}

describe('journey compile pacing (render/journeyCompile.ts scene lane)', () => {
  it('a NEW build (settles after its frame): one item per call, one call per frame, one in flight, the item alone on the prep layer', async () => {
    const k = rig(10, {post: null});
    const mask0 = k.layers();
    k.job.start();
    let frames = 0;
    while (k.job.stats.phase === 'scene' && frames < 50) {
      const c0 = k.calls.length;
      k.frame();
      frames++;
      await flush();
      expect(k.calls.length - c0, `frame ${frames}`).toBe(1); // exactly one call started by this frame's step
      expect(k.open()).toBe(1);
      const c = k.calls[k.calls.length - 1];
      expect(c.on).toEqual([k.items[k.calls.length - 1].object]); // ONE item, isolated on the prep layer
      expect(c.frame).toBe(k.fb.frame);
      expect(k.layers()).toBe(mask0); // restored at once
      await k.settle(JOURNEY_COMPILE.sliceMs + 3); // its yielded stages ran past the slice's budget
      expect(k.calls.length - c0).toBe(1); // nothing more until the next frame's step
    }
    expect(k.job.stats.phase).toBe('done');
    expect(frames).toBe(10);
    expect([k.job.stats.sceneDone, k.job.stats.sceneChunks, k.job.stats.slices, k.job.stats.maxPerSlice]).toEqual([10, 10, 10, 1]);
    expect(PREP_LAYER).toBe(30);
  });

  it('cheap items (cache hits) batch only inside their frame: bounded by the slice budget and maxPerSlice', async () => {
    const k = rig(300, {post: null});
    k.job.start();
    // 0.3 ms per item: the slice stops launching once JOURNEY_COMPILE.sliceMs of real time passed since its step
    k.frame();
    let c0 = 0;
    while (k.open()) await k.settle(0.3);
    const timed = k.calls.length - c0;
    expect(timed).toBeGreaterThan(1); // batched (not one per frame)
    expect(timed).toBeLessThanOrEqual(Math.ceil(JOURNEY_COMPILE.sliceMs / 0.3) + 1);
    // free items: the call cap ends the slice
    c0 = k.calls.length;
    k.frame();
    while (k.open()) await k.settle(0);
    expect(k.calls.length - c0).toBe(JOURNEY_COMPILE.maxPerSlice);
    expect(k.job.stats.maxPerSlice).toBe(JOURNEY_COMPILE.maxPerSlice);
    expect(k.job.stats.sliceMaxMs).toBeLessThan(JOURNEY_COMPILE.sliceMs + 0.31);
    // a cheap item that settles AFTER the next frame began never chains (the frame number moved), even inside the time budget
    c0 = k.calls.length;
    k.frame();
    expect(k.calls.length - c0).toBe(1);
    k.frame('paused', 0.1); // (the next frame callback began 0.1 ms later — still inside the slice's time budget; held: no step)
    await k.settle(0);
    expect(k.calls.length - c0).toBe(1);
    k.frame();
    expect(k.calls.length - c0).toBe(2); // that frame's own step
  });

  it('hidden page / pause: no launches without a step, no burst on resume', async () => {
    const k = rig(200, {post: null});
    k.job.start();
    k.frame();
    expect(k.calls.length).toBe(1);
    k.advance(30_000); // hidden: no rAF for 30 s (the slice's budget long gone)
    await k.settle(0);
    expect(k.calls.length).toBe(1);
    for (let i = 0; i < 60; i++) { k.frame('paused'); await flush(); } // the pause menu: held frames run no steps
    expect(k.calls.length).toBe(1);
    expect(k.open()).toBe(0);
    // resume: this frame's step starts ONE slice — cheap items batch inside it, bounded; everything else waits for later frames
    k.frame();
    expect(k.calls.length).toBe(2);
    while (k.open()) await k.settle(0);
    expect(k.calls.length - 1).toBeLessThanOrEqual(JOURNEY_COMPILE.maxPerSlice);
    expect(k.job.stats.sceneDone).toBeLessThan(200);
    expect(k.job.stats.phase).toBe('scene');
  });

  it('completes exactly once; nothing runs or re-queues after it', async () => {
    const k = rig(3, {post: null});
    let done = 0, scene = 0;
    void k.job.done.then(() => done++);
    void k.job.sceneDone.then(() => scene++);
    k.job.start();
    for (let f = 0; f < 10 && k.job.stats.phase !== 'done'; f++) { k.frame(); await flush(); if (k.open()) await k.settle(5); }
    await flush();
    expect([k.job.stats.phase, k.job.stats.cancelReason, k.job.stats.sceneDone, done, scene]).toEqual(['done', null, 3, 1, 1]);
    const calls = k.calls.length, stats = JSON.stringify(k.job.stats);
    for (let f = 0; f < 10; f++) { k.frame(); await flush(); }
    k.job.cancel(); // (a later cancel — Game.setState / a new journey — is a no-op on an ended job)
    await flush();
    expect([k.calls.length, k.fb.size, JSON.stringify(k.job.stats), done]).toEqual([calls, 0, stats, 1]);
  });

  it('cancel / a world change / a renderer failure mid-flight: the job ends once and starts nothing more', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // cancel (Game: a new journey, the main menu, death, a loading screen, device loss)
    const a = rig(10, {post: null});
    a.job.start();
    a.frame();
    a.job.cancel();
    await a.job.done;
    await a.settle(0); // the call that was in flight settles later
    for (let f = 0; f < 5; f++) { a.frame(); await flush(); }
    expect([a.job.stats.phase, a.job.stats.cancelReason, a.job.stats.sceneDone, a.calls.length, a.fb.size]).toEqual(['cancelled', 'cancelled', 0, 1, 0]);
    // the world generation changes while a call is in flight (nothing of the job queued to be told): ends when it settles
    const b = rig(10, {post: null});
    b.job.start();
    b.frame();
    expect(b.fb.size).toBe(0); // (no scene step queued while the call is in flight)
    b.fb.bumpGeneration();
    expect(b.job.stats.phase).toBe('scene');
    await b.settle(0);
    for (let f = 0; f < 5; f++) { b.frame(); await flush(); }
    expect([b.job.stats.phase, b.job.stats.cancelReason, b.calls.length]).toEqual(['cancelled', 'generation', 1]);
    // the renderer rejects (device lost / context lost): 'error'
    const c = rig(10, {post: null});
    c.job.start();
    c.frame();
    await c.settle(0, new Error('device lost'));
    await c.job.done;
    for (let f = 0; f < 5; f++) { c.frame(); await flush(); }
    expect([c.job.stats.phase, c.job.stats.cancelReason, c.calls.length]).toEqual(['cancelled', 'error', 1]);
    // the renderer throws inside the call: the isolation is restored, 'error'
    const d = rig(10, {post: null, throwAt: 0});
    const mask0 = d.layers();
    d.job.start();
    d.frame();
    await flush();
    expect([d.job.stats.phase, d.job.stats.cancelReason, d.layers()]).toEqual(['cancelled', 'error', mask0]);
  });

  it('background-priority launcher: the step only posts; the call runs in that task; pacing and cancellation hold there too', async () => {
    const q: (() => void)[] = [];
    const k = rig(6, {post: fn => q.push(fn)});
    expect(k.job.stats.background).toBe(true);
    k.job.start();
    k.frame();
    await flush();
    expect([k.calls.length, q.length]).toEqual([0, 1]); // nothing compiled inside the frame callback
    q.shift()!();
    expect(k.calls.length).toBe(1);
    expect(k.calls[0].on).toEqual([k.items[0].object]);
    await k.settle(0); // a cache hit inside the frame: the next launch is posted again (never run inline)
    expect([k.calls.length, q.length]).toEqual([1, 1]);
    q.shift()!();
    expect(k.calls.length).toBe(2);
    await k.settle(JOURNEY_COMPILE.sliceMs + 1); // over budget: waits for the next frame's step
    expect(q.length).toBe(0);
    k.frame();
    await flush();
    expect(q.length).toBe(1);
    // the world changes while a launch waits for its task: the task compiles nothing
    k.fb.bumpGeneration();
    q.shift()!();
    expect([k.calls.length, k.job.stats.phase, k.job.stats.cancelReason]).toEqual([2, 'cancelled', 'generation']);
  });

  it('watchdog: a background task the browser never runs is run by a step after postStallFrames frames; the stale task is then a no-op', async () => {
    const q: (() => void)[] = [];
    const k = rig(3, {post: fn => q.push(fn)});
    k.job.start();
    k.frame();
    await flush();
    expect([k.calls.length, q.length]).toEqual([0, 1]);
    for (let f = 1; f < JOURNEY_COMPILE.postStallFrames; f++) { k.frame(); await flush(); }
    expect(k.calls.length).toBe(0);
    k.frame();
    await flush();
    expect([k.calls.length, k.job.stats.postStalls]).toEqual([1, 1]);
    q.shift()!(); // the browser finally runs the old task
    expect(k.calls.length).toBe(1);
    await k.settle(5);
    expect(k.job.stats.sceneDone).toBe(1);
  });

  it("default launcher: the browser's scheduler.postTask at 'background' priority; none, or one that refuses = direct launches", async () => {
    const posted: [() => void, {priority: string}][] = [];
    vi.stubGlobal('scheduler', {postTask: vi.fn((fn: () => void, opts: {priority: string}) => { posted.push([fn, opts]); return Promise.resolve(); }), yield: () => Promise.resolve()});
    const a = rig(2);
    expect(a.job.stats.background).toBe(true);
    a.job.start();
    a.frame();
    await flush();
    expect([a.calls.length, posted.length, posted[0][1]]).toEqual([0, 1, {priority: 'background'}]);
    posted[0][0]();
    expect(a.calls.length).toBe(1);
    vi.stubGlobal('scheduler', {yield: () => Promise.resolve()}); // (three's yieldToMain only: no postTask)
    const b = rig(2);
    expect(b.job.stats.background).toBe(false);
    b.job.start();
    b.frame();
    expect(b.calls.length).toBe(1);
    vi.stubGlobal('scheduler', {postTask: () => { throw new Error('refused'); }});
    const c = rig(2);
    c.job.start();
    c.frame();
    expect([c.calls.length, c.job.stats.background]).toEqual([1, false]);
  });
});
