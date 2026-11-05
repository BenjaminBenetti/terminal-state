// Task studio-runtime-variant-warmup-20261105 (lane RECORDER): the performance recorder's schema 1 / schemaMinor 3 additions.
//  - pipeline-request identity (summary.firstUse.pipelines, worst[].firstUse.pipelineRequests): a native capture showed render
//    PIPELINE requests with no node build (pipeline cache misses) followed by ~100 ms GPU-side stalls, and the recorder could not
//    say what they were for. Every new request now carries the build labels plus the pass / target / material state / object flags
//    the pipeline is keyed by, withBuild and newPrograms; bounded (the most expensive in-render kept, async first-come), labels /
//    numbers / booleans only, nothing recorded while not recording;
//  - F9 marks look back 10 s (MARK_LOOKBACK_MS; a 367 ms freeze 3.35 s before a mark was missed by the 2 s window) and list the
//    stalls in that window (refresh misses / overruns, worst first, bounded), clamped at the capture start; hidden-tab gaps are
//    never stalls, paused / menu frames are tagged by category.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {F, FrameInput, MARK_LOOKBACK_MS, MARK_STALLS, PERF_CAPS, PERF_SCHEMA_MINOR, PerfCapture, type FirstUsePipeline, type ReportMeta} from '../src/debug/perfRecorder';
import {PerfRecorderController, pipelineContext, type RecorderGame} from '../src/debug/perfRecorderHooks';
import {SPAN_COUNT, UpdateProfiler} from '../src/debug/updateProfile';

const NAMES = (() => { const p = new UpdateProfiler(2); return Array.from({length: SPAN_COUNT}, (_, j) => p.name(j)); })();
const meta = (environment: Record<string, unknown> = {}): ReportMeta => ({build: {label: 'test'}, environment, capabilities: [], spanNames: NAMES,
  capturedAtUTC: '2026-11-05T00:00:00.000Z', endedAtUTC: '2026-11-05T00:01:00.000Z'});
const parse = (c: PerfCapture, m = meta()) => JSON.parse(c.serializeSync(m)) as Record<string, any>;
const HZ60 = 1000 / 60;

/** A pipeline identity as the hooks build it (labels + context), for the core tests. */
const pid = (object: string, extra: Partial<FirstUsePipeline> = {}): Omit<FirstUsePipeline, 'frame' | 't' | 'ms'> => ({
  object, via: 'self', objectType: 'Mesh', material: `${object}-mat`, materialType: 'MeshStandardMaterial', objectMaterial: null, shadowPass: false,
  async: false, withBuild: false, newPrograms: 0, pass: 'scene', target: null, materialState: null, objectFlags: null, ...extra});

describe('pipeline-request identity: the core capture (summary.firstUse.pipelines)', () => {
  it('bounded: the most expensive in-render requests kept, async first-come; time order; drops disclosed; per frame in worst detail', () => {
    expect(PERF_SCHEMA_MINOR).toBe(3);
    expect(PERF_CAPS.firstUsePipelines).toBe(240);
    const c = new PerfCapture({firstUsePipelines: 3});
    c.firstUsePipeline(10, 9, pid('before-start')); // not recording: ignored
    c.start(0);
    const i = new FrameInput();
    for (let k = 0; k < 40; k++) {
      if (k === 10) { c.firstUsePipeline(200, 7.7, pid('a')); c.firstUsePipeline(201, 1.0, pid('b', {withBuild: true, newPrograms: 2})); }
      if (k === 20) c.firstUsePipeline(400, null, pid('c', {async: true})); // kept: there is room
      if (k === 25) c.firstUsePipeline(500, null, pid('d', {async: true})); // full: an async request never displaces (first-come)
      if (k === 30) c.firstUsePipeline(600, 5.5, pid('e')); // full: displaces the async 'c' (lowest rank)
      i.time += HZ60; i.cpuMs = k === 10 ? 19 : 6; i.state = 0; i.flags = F.rendered; i.fuOn = true; i.pipelinesCreated = k === 10 ? 2 : 0;
      c.frame(i, null);
    }
    c.stop(i.time + 20, 'manual');
    c.firstUsePipeline(i.time + 30, 50, pid('after-stop')); // not recording: ignored
    const r = parse(c);
    expect(r.schemaMinor).toBe(3);
    const p = r.summary.firstUse.pipelines;
    expect([p.seen, p.kept, p.dropped]).toEqual([5, 3, 2]);
    expect(p.list.map((e: any) => [e.object, e.frame, e.ms, e.async])).toEqual([['a', 10, 7.7, false], ['b', 10, 1, false], ['e', 30, 5.5, false]]);
    expect(p.note).toMatch(/GPU \/ driver compile time is not observable/);
    expect(p.note).toMatch(/withBuild/);
    expect(r.capture.drops.firstUsePipelines).toBe(2);
    expect(r.capture.drops.firstUsePipelinesNote).toMatch(/first-come/);
    expect(r.summary.firstUse.builds).toMatchObject({seen: 0, kept: 0}); // the build list is separate and unchanged
    const w = r.worst.gameplayByCpu.find((f: any) => f.frame === 10);
    expect(w.firstUse.pipelines).toBe(2); // (schema-1 count, unchanged)
    expect(w.firstUse.pipelineRequests.map((e: any) => [e.object, e.ms, e.withBuild, e.newPrograms])).toEqual([['a', 7.7, false, 0], ['b', 1, true, 2]]); // most expensive first
    expect(Object.keys(w.firstUse.pipelineRequests[0])).toEqual(['ms', 'async', 'withBuild', 'newPrograms', 'pass', 'object', 'objectType', 'material', 'materialType', 'objectMaterial',
      'shadowPass', 'target', 'materialState', 'objectFlags']);
    expect(r.worst.gameplay.find((f: any) => f.frame !== 10 && f.frame !== 30).firstUse.pipelineRequests).toEqual([]);
    // an async entry, when kept, has ms null (never 0)
    const d = new PerfCapture({firstUsePipelines: 4});
    d.start(0);
    d.firstUsePipeline(5, null, pid('warm', {async: true}));
    for (let k = 0; k < 3; k++) { i.time += HZ60; d.frame(i, null); }
    d.stop(i.time, 'manual');
    expect(parse(d).summary.firstUse.pipelines.list).toEqual([expect.objectContaining({object: 'warm', ms: null, async: true, frame: 0, t: 5})]);
  });

  it('at most 6 requests per worst frame (the most expensive), the rest only counted', () => {
    const c = new PerfCapture();
    c.start(0);
    const i = new FrameInput();
    for (let k = 0; k < 12; k++) {
      if (k === 4) for (let j = 0; j < 9; j++) c.firstUsePipeline(70 + j, j + 0.5, pid(`p${j}`));
      i.time += HZ60; i.cpuMs = k === 4 ? 30 : 5; i.state = 0; i.flags = F.rendered; i.fuOn = true; i.pipelinesCreated = k === 4 ? 9 : 0;
      c.frame(i, null);
    }
    c.stop(i.time, 'manual');
    const r = parse(c);
    expect(r.summary.firstUse.pipelines.kept).toBe(9);
    const w = r.worst.gameplayByCpu.find((f: any) => f.frame === 4);
    expect(w.firstUse.pipelineRequests.map((e: any) => e.object)).toEqual(['p8', 'p7', 'p6', 'p5', 'p4', 'p3']);
    expect(w.firstUse.pipelines).toBe(9);
  });
});

describe('pipeline-request identity: pass / target / state from the render object (pipelineContext)', () => {
  it('numbers / booleans only; null where a field is absent; mirrored = negative world determinant', () => {
    const mat = new THREE.MeshStandardMaterial({name: 'm'});
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    mesh.updateMatrixWorld();
    const ctx = {sampleCount: 4, textures: [{type: THREE.HalfFloatType}], depth: true, stencil: false, depthTexture: null, renderTarget: {}, mrt: null, fullscreenPass: false};
    expect(pipelineContext({object: mesh, material: mat, context: ctx, geometry: mesh.geometry, clippingContextCacheKey: ''})).toEqual({
      pass: 'scene',
      target: {toTarget: true, colorTargets: 1, colorType: THREE.HalfFloatType, samples: 4, depth: true, stencil: false, depthTexture: false, mrt: false},
      materialState: {side: THREE.FrontSide, transparent: false, blending: THREE.NormalBlending, depthWrite: true, depthTest: true, colorWrite: true, alphaToCoverage: false, polygonOffset: false},
      objectFlags: {instanced: false, batched: false, skinned: false, mirrored: false, indexed: true, clipping: false},
    });
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry().toNonIndexed(), mat, 3);
    inst.scale.set(-1, 1, 1); inst.updateMatrixWorld();
    expect(pipelineContext({object: inst, material: mat, context: ctx, clippingContextCacheKey: '7:1:0'}).objectFlags).toEqual({instanced: true, batched: false, skinned: false, mirrored: true, indexed: false, clipping: true});
    // the canvas (no render target), a full-screen quad pass
    const canvas = {sampleCount: 1, textures: null, depth: false, stencil: false, depthTexture: null, renderTarget: null, mrt: null, fullscreenPass: true};
    expect(pipelineContext({object: mesh, material: mat, context: canvas})).toMatchObject({pass: 'fullscreen',
      target: {toTarget: false, colorTargets: 0, colorType: null, samples: null, depth: false, stencil: false, depthTexture: false, mrt: false}});
    const shadow = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {isShadowPassMaterial?: boolean};
    shadow.isShadowPassMaterial = true;
    expect(pipelineContext({object: mesh, material: shadow, context: ctx}).pass).toBe('shadow');
    // absent fields: null, never a guess; no render object at all: everything null
    expect(pipelineContext({object: {}, material: {}, context: {}})).toEqual({pass: 'scene',
      target: {toTarget: null, colorTargets: null, colorType: null, samples: null, depth: null, stencil: null, depthTexture: null, mrt: null},
      materialState: {side: null, transparent: null, blending: null, depthWrite: null, depthTest: null, colorWrite: null, alphaToCoverage: null, polygonOffset: null},
      objectFlags: {instanced: false, batched: false, skinned: false, mirrored: false, indexed: null, clipping: null}});
    expect(pipelineContext(undefined)).toEqual({pass: null, target: null, materialState: null, objectFlags: null});
    expect(pipelineContext({object: {isMesh: true}})).toMatchObject({pass: null, objectFlags: {mirrored: null}});
  });
});

// --- the controller with three r186's internals faked (Renderer.render / NodeManager / Pipelines / backend) ------------------------

interface FakeRO { object: THREE.Object3D; material: THREE.Material; context: Record<string, unknown>; geometry?: unknown; clippingContextCacheKey?: string }
class FakeNodes { nodeBuilderCache = new Map<unknown, unknown>(); _createNodeBuilder(ro: unknown, m: unknown) { return {ro, m}; } _createNodeBuilderState(b: unknown) { return {b}; } }
class FakePipelines {
  caches = new Map<unknown, unknown>();
  constructor(private readonly clock: {t: number}) {}
  /** three r186: _getRenderPipeline(renderObject, stageVertex, stageFragment, cacheKey, promises) on a pipeline cache miss. */
  _getRenderPipeline(_ro: unknown, _vs: unknown, _fs: unknown, key: string, _promises: unknown[] | null) { this.clock.t += 0.75; const p = {key}; this.caches.set(key, p); return p; }
}
class FakeBackend { createProgram(_stage: unknown) { return undefined; } }
class FakeRenderer {
  initialized = true;
  info = {frame: 0, render: {drawCalls: 10, frameCalls: 3, triangles: 100}, memory: {textures: 1, geometries: 1, programs: 1}};
  _nodes = new FakeNodes(); _pipelines: FakePipelines; backend = new FakeBackend();
  todo: {ro: FakeRO; build?: boolean; programs?: number}[] = [];
  private keys = 0;
  constructor(clock: {t: number}) { this._pipelines = new FakePipelines(clock); }
  getPixelRatio() { return 1; }
  render(_s?: unknown, _c?: unknown) { for (const j of this.todo) this.request(j); this.todo = []; }
  /** three r186's order in Pipelines.getForRender: the node build (a cache miss), new shader programs, the pipeline cache miss. */
  request(j: {ro: FakeRO; build?: boolean; programs?: number}, promises: unknown[] | null = null) {
    if (j.build) this._nodes._createNodeBuilderState(this._nodes._createNodeBuilder(j.ro, j.ro.material));
    for (let p = 0; p < (j.programs ?? 0); p++) this.backend.createProgram({stage: p ? 'fragment' : 'vertex'});
    this.backend.createProgram({stage: 'compute'}); // (a compute program is never a render pipeline's)
    return this._pipelines._getRenderPipeline(j.ro, {}, {}, `k${++this.keys}`, promises);
  }
}
class FakeGame {
  state = 'playing'; warming = false;
  frameCpu = {updateMs: 1, renderMs: 2, deferredMs: 0, rendered: true};
  prof = new UpdateProfiler(8);
  renderer: FakeRenderer;
  canvas = {width: 800, height: 450}; settings = {quality: 'high', renderScale: 1, fov: 75}; gpu = null;
  player = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0}; zombies: unknown[] = []; seed = 1; run = {current: {level: 'office', section: 'main'}};
  stateListeners: ((s: string, p: string) => void)[] = [];
  constructor(clock: {t: number}) { this.renderer = new FakeRenderer(clock); }
}

const target = (o: Record<string, unknown> = {}) => ({sampleCount: 4, textures: [{type: THREE.HalfFloatType}], depth: true, stencil: false, depthTexture: null, renderTarget: {}, mrt: null, fullscreenPass: false, ...o});

describe('pipeline-request identity through the controller (hooked Pipelines._getRenderPipeline)', () => {
  it('in-render requests: labels, pass, target, withBuild / newPrograms per render object; async outside renders; nothing while not recording', async () => {
    const clock = {t: 1000};
    const g = new FakeGame(clock);
    const ctl = new PerfRecorderController(g as unknown as RecorderGame, {yieldFn: () => Promise.resolve(), observer: null, loadingManager: null, doc: null, win: null,
      origin: 'https://game.example', now: () => clock.t});
    const frame = () => { ctl.frame(clock.t, 6, clock.t + 0.5); clock.t += HZ60; };
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshStandardMaterial({name: 'm'});
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'prop-x'; mesh.updateMatrixWorld();
    const ro1: FakeRO = {object: mesh, material: mat, context: target(), geometry: geo, clippingContextCacheKey: ''};
    const crate = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({name: 'crate-mat'})); crate.name = 'crate';
    const shadowMat = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {isShadowPassMaterial?: boolean};
    shadowMat.isShadowPassMaterial = true;
    const ro2: FakeRO = {object: crate, material: shadowMat, context: target({sampleCount: 1, depthTexture: {}, textures: [{type: THREE.UnsignedByteType}]})};
    const leak = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({name: 'blob:abc'})); leak.name = 'https://host.example/a/b.glb?sig=SECRET';
    const ro3: FakeRO = {object: leak, material: leak.material as THREE.Material, context: target()};
    const quadMat = new THREE.MeshBasicMaterial({name: 'post-output'});
    const ro4: FakeRO = {object: new THREE.Mesh(geo, quadMat), material: quadMat, context: target({textures: null, renderTarget: null, sampleCount: 1, fullscreenPass: true})};
    // not recording: no hook is installed, nothing is recorded
    g.renderer.todo = [{ro: ro1}];
    g.renderer.render();
    expect(Object.prototype.hasOwnProperty.call(g.renderer._pipelines, '_getRenderPipeline')).toBe(false);
    ctl.start('qa');
    frame(); // frame 0
    g.renderer.todo = [{ro: ro1}, {ro: ro2, build: true, programs: 2}, {ro: ro3}, {ro: ro4, build: true}];
    g.renderer.render();
    frame(); // frame 1: four requests
    g.renderer._nodes._createNodeBuilder(ro1, mat); // a build for ro1 in frame 2 ...
    frame();
    g.renderer.todo = [{ro: ro1}];
    g.renderer.render();
    frame(); // ... and its pipeline request in frame 3: not withBuild (the reference is reset at every frame sample)
    g.renderer.request({ro: ro1, programs: 2}, []); // a compileAsync-style request outside a render (frame 4)
    frame();
    await ctl.stop('manual', 'qa');
    for (const [o, k] of [[g.renderer, 'render'], [g.renderer._pipelines, '_getRenderPipeline'], [g.renderer.backend, 'createProgram'], [g.renderer._nodes, '_createNodeBuilder']] as const)
      expect(Object.prototype.hasOwnProperty.call(o, k), k).toBe(false); // every hook removed at stop
    g.renderer.todo = [{ro: ro2}];
    g.renderer.render(); // after stop: nothing
    expect(ctl.capture.fpListSeen).toBe(6);
    const text = ctl.report!.parts.join('');
    for (const bad of ['SECRET', 'https:', 'blob:', 'host.example', 'game.example', 'revision']) expect(text, bad).not.toContain(bad);
    const r = JSON.parse(text);
    const list = r.summary.firstUse.pipelines.list as any[];
    expect(list.map(e => [e.frame, e.object, e.pass, e.withBuild, e.newPrograms, e.async])).toEqual([
      [1, 'prop-x', 'scene', false, 0, false],
      [1, 'crate', 'shadow', true, 2, false],
      [1, null, 'scene', false, 0, false], // a URL-like name is dropped, never trimmed
      [1, null, 'fullscreen', true, 0, false], // (an anonymous quad)
      [3, 'prop-x', 'scene', false, 0, false],
      [4, 'prop-x', 'scene', false, 2, true],
    ]);
    expect(list[0]).toMatchObject({ms: 0.75, via: 'self', objectType: 'Mesh', material: 'm', materialType: 'MeshStandardMaterial', objectMaterial: null, shadowPass: false,
      target: {toTarget: true, colorTargets: 1, colorType: THREE.HalfFloatType, samples: 4, depth: true, stencil: false, depthTexture: false, mrt: false},
      materialState: {side: THREE.FrontSide, transparent: false, depthWrite: true}, objectFlags: {instanced: false, mirrored: false, indexed: true, clipping: false}});
    expect(list[1]).toMatchObject({material: null, materialType: 'MeshBasicMaterial', objectMaterial: 'crate-mat', shadowPass: true, target: {samples: 1, depthTexture: true}});
    expect(list[2]).toMatchObject({object: null, via: null, material: null});
    expect(list[3].target).toMatchObject({toTarget: false, colorTargets: 0, samples: null});
    expect(list[5]).toMatchObject({ms: null, async: true});
    for (const e of list) expect(e.t).toBeGreaterThan(0);
    expect(r.frames.columns.pipelinesCreated).toEqual([0, 4, 0, 1, 1]);
    expect(r.frames.columns.pipelineMs).toEqual([0, 300, 0, 75, 0]); // (in-render requests only; the identity read is outside the timed call)
    const w = r.worst.gameplay.find((f: any) => f.frame === 1);
    expect(w.firstUse.pipelineRequests.map((e: any) => e.pass)).toEqual(['scene', 'shadow', 'scene', 'fullscreen']);
    const cap = Object.fromEntries((r.capabilities as any[]).map(c => [c.id, c]));
    expect(cap['firstUse.pipelineIdentity']).toMatchObject({available: true});
    expect(cap['firstUse.pipelineIdentity'].note).toMatch(/GPU \/ driver compile is not observable/);
    expect(cap['marks.lookback'].note).toMatch(/10 s before it/);
  });

  it('the capability is unavailable when three has no Pipelines._getRenderPipeline (no list entries)', async () => {
    const clock = {t: 0};
    const g = new FakeGame(clock);
    (g.renderer as unknown as {_pipelines: unknown})._pipelines = {caches: new Map()};
    const ctl = new PerfRecorderController(g as unknown as RecorderGame, {yieldFn: () => Promise.resolve(), observer: null, loadingManager: null, doc: null, win: null, now: () => clock.t});
    ctl.start('qa');
    for (let k = 0; k < 3; k++) { ctl.frame(clock.t, 4); clock.t += HZ60; }
    await ctl.stop('manual', 'qa');
    const r = ctl.reportObject() as any;
    expect(r.capabilities.find((c: any) => c.id === 'firstUse.pipelineIdentity').available).toBe(false);
    expect(r.summary.firstUse.pipelines).toMatchObject({seen: 0, kept: 0, list: []});
  });
});

// --- F9 marks: the 10 s lookback and the stalls in it ---------------------------------------------------------------------------

/**
 * Frames whose intervals are `ivs` (interval k = rAF k+1 - rAF k), cpu / state / flags per frame (playing, rendered by default),
 * then marks at `marks` (ms since capture start). The capture starts at performance.now() 1000 = the first rAF timestamp.
 */
function run(ivs: number[], marks: number[], o: {cpu?: (k: number) => number; state?: (k: number) => number; flags?: (k: number) => number} = {}): PerfCapture {
  const c = new PerfCapture();
  c.start(1000);
  const i = new FrameInput();
  i.time = 1000;
  for (let k = 0; k <= ivs.length; k++) {
    i.cpuMs = o.cpu?.(k) ?? 5; i.state = o.state?.(k) ?? 0; i.flags = F.rendered | (o.flags?.(k) ?? 0); i.frameId++;
    c.frame(i, null);
    if (k < ivs.length) i.time += ivs[k];
  }
  for (const mt of marks) c.mark(1000 + mt);
  c.stop(i.time + 20, 'manual');
  return c;
}
/** 60 Hz intervals with `special` ones at given frame indices. */
const ivs60 = (count: number, special: Record<number, number> = {}) => Array.from({length: count}, (_, k) => special[k] ?? HZ60);

describe('F9 marks: 10 s lookback (marks[].windowMs / worstBefore / stalls)', () => {
  it('a 366 ms freeze 3.35 s before the mark is its worstBefore and its stall (the old 2 s window missed it)', () => {
    expect(MARK_LOOKBACK_MS).toBe(10000);
    expect(MARK_STALLS).toBe(12);
    // frame 600 at t = 10 000 ms has a 366 ms interval; the mark comes 3.35 s after that frame's rAF
    const r = parse(run(ivs60(1000, {600: 366}), [10000 + 3350]));
    expect(r.marks).toHaveLength(1);
    const m = r.marks[0];
    expect(m).toMatchObject({n: 1, windowMs: 10000});
    expect(m.t).toBeCloseTo(13350, 1);
    expect(m.fromT).toBeCloseTo(3350, 1);
    expect(m.refreshMs).toBeCloseTo(HZ60, 1); // (summary.tail.refreshMs: the median interval here)
    expect(m.worstBefore).toMatchObject({frame: 600, intervalMs: 366, cpuMs: 5, category: 'gameplay'});
    expect(Object.keys(m.worstBefore)).toEqual(['frame', 't', 'intervalMs', 'cpuMs', 'category']); // (schema-1 shape)
    expect(m.stalls).toHaveLength(1);
    expect(m.stalls[0]).toMatchObject({frame: 600, intervalMs: 366, cpuMs: 5, category: 'gameplay', state: 'playing'});
    expect(m.stalls[0].dtBeforeMark).toBeCloseTo(3350, 1);
    expect(m.omittedStalls).toBe(0);
  });

  it('a mark 1 s after the capture start clamps its window at the first frame', () => {
    const r = parse(run(ivs60(200, {30: 40}), [1000]));
    const m = r.marks[0];
    expect(m.windowMs).toBe(10000);
    expect(m.fromT).toBe(0); // (never before the first frame; no negative index)
    expect(m.worstBefore).toMatchObject({frame: 30, intervalMs: 40});
    expect(m.stalls.map((s: any) => s.frame)).toEqual([30]);
    expect(m.stalls[0].dtBeforeMark).toBeCloseTo(500, 1);
    // a mark before any frame (pressed at the very start): an empty window, no crash
    const c = new PerfCapture();
    c.start(0);
    c.mark(0);
    c.stop(5, 'manual');
    expect(parse(c).marks[0]).toMatchObject({n: 1, worstBefore: null, stalls: [], omittedStalls: 0});
  });

  it('two marks: each its own window (a stall 14 s before the second is not in it)', () => {
    // frame 120 (t = 2 s): 80 ms; frame 900 (t ~ 15.06 s): 120 ms
    const r = parse(run(ivs60(1200, {120: 80, 900: 120}), [4000, 16000]));
    const [a, b] = r.marks;
    expect([a.n, b.n]).toEqual([1, 2]);
    expect(a.stalls.map((s: any) => s.frame)).toEqual([120]);
    expect(a.worstBefore.frame).toBe(120);
    expect(b.stalls.map((s: any) => s.frame)).toEqual([900]);
    expect(b.worstBefore.frame).toBe(900);
    expect(b.fromT).toBeCloseTo(6000, 1);
  });

  it('paused frames in the window are tagged by category / state; an overrun without an interval miss is a stall; hidden gaps never are', () => {
    // frame 100: paused (menu) with a 100 ms interval; frame 200: 22 ms CPU (overrun) at an on-time interval;
    // frame 300: a hidden-tab interval (500 ms, flags.hidden); frame 400: a 3.1 s suspension gap (interval - cpu > GAP_MS);
    // the mark 100 ms after frame 401's rAF (t = 398 refreshes + 3700 ms): its window starts at ~433 ms, before frame 100
    const special = {100: 100, 300: 500, 400: 3100};
    const r = parse(run(ivs60(500, special), [398 * HZ60 + 3800], {
      state: k => (k === 100 ? 1 : 0), cpu: k => (k === 200 ? 22 : 5), flags: k => (k === 300 ? F.hidden : 0)}));
    const m = r.marks[0];
    const by = Object.fromEntries(m.stalls.map((s: any) => [s.frame, s]));
    expect(Object.keys(by).map(Number).sort((x, y) => x - y)).toEqual([100, 200]);
    expect(by[100]).toMatchObject({category: 'menu', state: 'paused', intervalMs: 100});
    expect(by[200]).toMatchObject({category: 'gameplay', cpuMs: 22});
    expect(by[200].intervalMs).toBeCloseTo(HZ60, 1);
    expect(m.stalls[0].frame).toBe(100); // worst interval first
    expect(m.worstBefore).toMatchObject({frame: 100, category: 'menu'}); // (any non-hidden category, as before)
  });

  it('more than 12 stalls: the 12 worst listed (interval, then CPU), the rest counted in omittedStalls', () => {
    const special: Record<number, number> = {};
    for (let j = 0; j < 20; j++) special[100 + j * 10] = 30 + j; // 20 interval misses: 30 .. 49 ms
    special[50] = 49; // a tie with frame 290 (49 ms): the higher CPU first
    const r = parse(run(ivs60(400, special), [400 * HZ60], {cpu: k => (k === 50 ? 9 : k === 350 ? 20 : 5)})); // + frame 350: an overrun at 16.7 ms
    const m = r.marks[0];
    expect(m.stalls).toHaveLength(12);
    expect(m.omittedStalls).toBe(22 - 12);
    expect(m.stalls.slice(0, 3).map((s: any) => s.frame)).toEqual([50, 290, 280]);
    const iv = m.stalls.map((s: any) => s.intervalMs);
    expect(iv).toEqual([...iv].sort((x: number, y: number) => y - x));
    expect(m.stalls.some((s: any) => s.frame === 350)).toBe(false); // the overrun ranks last (on-time interval): omitted
    for (const s of m.stalls) expect(Object.keys(s)).toEqual(['frame', 't', 'dtBeforeMark', 'intervalMs', 'cpuMs', 'category', 'state']);
  });
});
