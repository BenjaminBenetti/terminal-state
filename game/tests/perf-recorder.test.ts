// Task studio-performance-recorder-20261103-043629 (lane RECORDER): the player-controlled performance recorder
// (debug/perfRecorder.ts core, debug/perfRecorderHooks.ts game / browser side, debug/perfRecorderUi.ts keys) — the report schema and
// its serialization, bounded buffers + disclosed drops (worst kept), percentiles, gameplay-only summaries (menus / hidden-tab gaps /
// warm-up / transitions excluded), the cap auto-stop, restart clearing, an inert OFF path, privacy (no URLs / query strings / save
// or inventory data), the lifecycle hooks installed only while recording, and the measured overhead / report size.

import {readFileSync, writeFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {CATEGORIES, F, FrameInput, PERF_SCHEMA, PERF_SCHEMA_VERSION, PerfCapture, assetCategory, assetId, chunkHash, distribution, reportFileName, stateCode, type ReportMeta} from '../src/debug/perfRecorder';
import {PerfRecorderController, sanitizeInvoker, type RecorderGame} from '../src/debug/perfRecorderHooks';
import {PerfRecorderUi, RECORDER_KEYS, RECORDER_PRIVACY_LINE, clockText, recorderKeyAction} from '../src/debug/perfRecorderUi';
import {S, SPAN_COUNT, UpdateProfiler} from '../src/debug/updateProfile';
import {GAME_KEYS} from '../src/player/input';
import {enhancedLightingLine, type EnhancedLightingStatus} from '../src/world/enhancedLighting'; // task studio-baked-lighting-reflections-20261114-050258-01 (lane SETTINGS)

const LOG ='/tmp/recorder-perf-recorder-test.txt';
const log = (line: string) => { try { writeFileSync(LOG, line + '\n', {flag: 'a'}); } catch { /* best effort */ } };

const NAMES = (() => { const p = new UpdateProfiler(2); return Array.from({length: SPAN_COUNT}, (_, j) => p.name(j)); })();
const META: ReportMeta = {build: {label: 'test'}, environment: {}, capabilities: [{id: 'x', available: true, source: 'test'}], spanNames: NAMES, capturedAtUTC: '2026-11-03T00:00:00.000Z', endedAtUTC: '2026-11-03T00:01:00.000Z'};
const parse = (c: PerfCapture, meta: ReportMeta = META) => JSON.parse(c.serializeSync(meta)) as Record<string, any>;

/** Push `count` frames into a core capture: every `dt` ms, cpu `cpu`, state / flags from `mod`. */
function feed(c: PerfCapture, i: FrameInput, count: number, dt: number, mod: (i: FrameInput, k: number) => void = () => {}): void {
  for (let k = 0; k < count; k++) {
    i.time += dt; i.cpuMs = 4; i.updateMs = 2; i.renderMs = 1.5; i.deferredMs = 0; i.state = 0; i.flags = F.rendered; i.frameId++;
    mod(i, k);
    c.frame(i, null);
  }
}

afterEach(() => { vi.restoreAllMocks(); });

describe('perf recorder core: schema and serialization', () => {
  it('serializes a versioned, self-describing report with every frame (columnar, quantized) and the capabilities it was given', () => {
    const c = new PerfCapture();
    expect(c.bytes()).toBe(0); // nothing allocated before the first start
    c.start(1000);
    const i = new FrameInput();
    i.time = 1000;
    feed(c, i, 30, 16.5, (f, k) => { f.yaw = k * 0.01; f.textures = 10 + (k === 12 ? 3 : 0); f.nodes = k >= 20 ? 7 : 5; f.culled = k < 15 ? 40 : 55; f.enemies = 9; });
    c.event(1200, 'level.build', 25, {level: 'mall', section: 'main', station: 's07'});
    c.mark(1300);
    c.stop(1600, 'manual');
    expect(c.bytes()).toBeGreaterThan(0);
    const r = parse(c);
    expect(r.schema).toBe(PERF_SCHEMA);
    expect(r.schemaVersion).toBe(PERF_SCHEMA_VERSION);
    expect(typeof r.privacy).toBe('string');
    expect(r.capabilities).toEqual(META.capabilities);
    expect(r.capture.termination).toBe('manual');
    expect(r.capture.frames).toBe(30);
    expect(r.capture.durationMs).toBe(600);
    expect(r.capture.drops.frames).toBe(0);
    const cols = r.frames.columns;
    for (const k of ['t', 'interval', 'cpu', 'update', 'render', 'deferred', 'gpu', 'state', 'category', 'flags', 'draws', 'triangles', 'passes',
      'newTextures', 'newGeometries', 'newPrograms', 'newNodeBuilds', 'newPipelines', 'culled', 'enemies', 'yaw', 'pitch']) expect(cols[k], k).toHaveLength(30);
    expect(cols.interval[0]).toBe(1650); // 16.5 ms in 0.01 ms units = rAF to rAF
    expect(cols.interval[29]).toBeNull(); // the last frame has no next rAF
    expect(cols.gpu.every((v: unknown) => v === null)).toBe(true); // never measured -> null, never 0
    expect(cols.newPipelines.every((v: unknown) => v === null)).toBe(true); // counter never available -> null
    expect(cols.newTextures[12]).toBe(3);
    expect(cols.newTextures[13]).toBe(-3);
    expect(cols.newNodeBuilds[20]).toBe(2);
    expect(cols.culled[16]).toBe(55);
    expect(cols.yaw[10]).toBe(Math.round(0.1 * 180 / Math.PI * 10));
    expect(r.events.list.find((e: any) => e.kind === 'level.build')).toMatchObject({t: 175, dur: 25, level: 'mall', station: 's07'});
    expect(r.marks).toHaveLength(1);
    expect(r.marks[0].worstBefore).not.toBeNull();
    expect(Object.keys(r.spans.perFrame)).toHaveLength(22); // the top-level laps
    expect(r.frames.categories).toEqual([...CATEGORIES]);
  });

  it('the async serialization yields between steps and produces the same text', async () => {
    const c = new PerfCapture();
    c.start(0);
    const i = new FrameInput();
    feed(c, i, 200, 16.7);
    c.stop(4000, 'manual');
    let yields = 0;
    const parts = await c.serialize(META, () => { yields++; return Promise.resolve(); }, 0);
    expect(yields).toBeGreaterThan(10);
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.join('')).toBe(c.serializeSync(META));
  });
});

describe('perf recorder core: bounds, caps and disclosed drops', () => {
  it('stops at the frame cap and at the duration cap (returns the cap; never overwrites frames)', () => {
    const c = new PerfCapture({frames: 50});
    c.start(0);
    const i = new FrameInput();
    const res: number[] = [];
    for (let k = 0; k < 60; k++) { i.time += 10; res.push(c.frame(i, null)); }
    expect(res.indexOf(1)).toBe(49); // the 50th frame fills the ring
    expect(c.frames).toBe(50);
    const d = new PerfCapture({durationMs: 1000});
    d.start(0);
    const j = new FrameInput();
    let cap = 0, k = 0;
    while (!cap && k < 1000) { j.time += 16; cap = d.frame(j, null); k++; }
    expect(cap).toBe(2);
    expect(j.time).toBeGreaterThanOrEqual(1000);
  });

  it('bounded events / resources drop the OLDEST, long frames keep the WORST; every drop is reported', () => {
    const c = new PerfCapture({events: 10, longFrames: 5, resources: 3});
    c.start(0);
    for (let k = 0; k < 25; k++) c.event(k * 10, 'asset.load', 1, {id: `f${k}.glb`});
    for (const d of [60, 300, 55, 70, 80, 51, 400]) c.longFrame({start: d, duration: d, blocking: d - 50, renderStart: null, styleAndLayoutStart: null, scripts: [], type: 'long-animation-frame'});
    for (let k = 0; k < 5; k++) c.resource({start: k, duration: 1, id: `r${k}.png`, category: 'texture', initiator: 'img', transferBytes: 10, encodedBytes: 10, decodedBytes: 20, cache: k % 2 ? 'hit' : 'network'});
    c.stop(1000, 'manual');
    const r = parse(c);
    expect(r.events.dropped).toBe(15);
    expect(r.events.list.map((e: any) => e.id)).toEqual(Array.from({length: 10}, (_, k) => `f${k + 15}.glb`)); // newest 10, in order
    expect(r.events.totals['asset.load'].count).toBe(25); // totals never drop
    expect(r.longFrames.seen).toBe(7);
    expect(r.longFrames.dropped).toBe(2);
    expect(r.longFrames.list.map((e: any) => e.duration).sort((a: number, b: number) => b - a)).toEqual([400, 300, 80, 70, 60]);
    expect(r.resources.dropped).toBe(2);
    expect(r.resources.list.map((e: any) => e.id)).toEqual(['r2.png', 'r3.png', 'r4.png']);
    expect(r.resources.totals.texture).toEqual({count: 5, cacheHits: 2, transferBytes: 50, decodedBytes: 100});
    expect(r.capture.drops).toMatchObject({frames: 0, events: 15, longFrames: 2, resources: 2});
  });

  it('keeps the worst frames: the worst-N timelines and the spike detail hold the biggest spikes, worst first', () => {
    const c = new PerfCapture({worst: 4, spikeDetail: 2});
    c.start(0);
    const prof = {on: true, head: 0, capacity: 4, ms: new Float32Array(4 * SPAN_COUNT), calls: new Uint16Array(4 * SPAN_COUNT)};
    c.start(0, 0);
    const i = new FrameInput();
    const spikes: Record<number, number> = {100: 90, 200: 250, 300: 60, 400: 120};
    for (let k = 0; k < 500; k++) {
      // the previous frame's cpu stretches this rAF: frame k's interval = time[k+1] - time[k]
      i.time += spikes[k - 1] ?? 16.7;
      i.cpuMs = (spikes[k] ?? 10) - 2; i.state = 0; i.flags = F.rendered;
      prof.head = (prof.head + 1) % prof.capacity;
      const o = ((prof.head - 1 + prof.capacity) % prof.capacity) * SPAN_COUNT;
      prof.ms.fill(0, o, o + SPAN_COUNT); prof.calls.fill(0, o, o + SPAN_COUNT);
      prof.ms[o + S.ai] = spikes[k] ? spikes[k] / 2 : 1; prof.ms[o + S.brain] = prof.ms[o + S.ai] * 0.8; prof.ms[o + S.path] = prof.ms[o + S.ai] * 0.6; prof.calls[o + S.path] = spikes[k] ? 12 : 1;
      prof.ms[o + S.draw] = 3;
      c.frame(i, prof);
    }
    c.stop(i.time + 20, 'manual');
    const r = parse(c);
    const w = r.worst.gameplay;
    expect(w.map((f: any) => f.frame)).toEqual([200, 400, 100, 300]);
    expect(w[0].intervalMs).toBeCloseTo(250, 1);
    expect(w[0].spans.dominant[0]).toMatchObject({name: 'ai.path', calls: 12});
    expect(w[0].spans.pathSearches).toBe(12);
    expect(w[0].timeline.rows.find((row: number[]) => row[0] === 0)[1]).toBeCloseTo(250, 1);
    expect(r.spikeDetail.kept).toBe(2);
    expect(r.spikeDetail.omitted).toBe(2);
    expect(r.spikeDetail.frames.map((f: any) => f.frame)).toEqual([200, 400]);
    expect(r.spikeDetail.frames[0].ms).toHaveLength(SPAN_COUNT);
    expect(r.spikeDetail.frames[0].calls[S.path]).toBe(12);
    expect(r.summary.correlation.with.pathSearches.spikes).toBe(4);
  });
});

describe('perf recorder core: summaries', () => {
  it('distribution = min / median / p95 / p99 / max (linear-interpolated, as the overlay) + counts over 16.7 / 33.3 / 50 / 100 ms', () => {
    const v = Float64Array.from({length: 100}, (_, k) => 100 - k); // 100 .. 1
    const d = distribution(v, 100);
    expect(d).toMatchObject({frames: 100, min: 1, max: 100, mean: 50.5, median: 50.5, p95: 95.05, p99: 99.01});
    expect(d.over).toEqual({'16.7': 84, '33.3': 67, '50': 50, '100': 0});
    expect(distribution(new Float64Array(0), 0)).toMatchObject({frames: 0, median: null, max: null});
  });

  it('GAMEPLAY summaries exclude menus, pause, loading, warm-up, transitions, focus loss and hidden-tab gaps (all still tagged)', () => {
    const c = new PerfCapture();
    c.start(0);
    const i = new FrameInput();
    let next = 0;
    /** `count` frames whose own interval (to the next rAF) is `interval`; `gapAfter` = the page went hidden during the last one. */
    const seq = (count: number, interval: number, mod: (f: FrameInput) => void = () => {}, gapAfter = false) => {
      for (let k = 0; k < count; k++) {
        i.time += next; i.cpuMs = 4; i.state = 0; i.flags = F.rendered;
        mod(i);
        c.frame(i, null);
        next = interval;
        if (gapAfter && k === count - 1) c.markGap();
      }
    };
    seq(99, 16.7);
    seq(1, 80); // frame 99: a real gameplay spike
    seq(20, 16.7);
    seq(1, 9000, () => {}, true); // frame 120: the tab went to the background for 9 s -> a gap, never a stutter
    seq(20, 16.7);
    seq(10, 250, f => { f.state = stateCode('paused'); }); // menu frames
    seq(5, 400, f => { f.state = stateCode('loading'); });
    seq(5, 600, f => { f.flags |= F.warming; });
    seq(5, 300, f => { f.flags |= F.transition; }); // e.g. the journey's level build
    seq(3, 700, f => { f.flags |= F.unfocused; });
    seq(2, 16.7, f => { f.state = stateCode('title'); });
    c.stop(i.time + 50, 'manual');
    const r = parse(c);
    const g = r.summary.gameplay;
    expect(g.interval.max).toBeCloseTo(80, 1);
    expect(g.interval.frames).toBe(140);
    expect(g.interval.over['50']).toBe(1);
    const cat = r.frames.columns.category, iv = r.frames.columns.interval;
    expect(CATEGORIES[cat[99]]).toBe('gameplay');
    expect(CATEGORIES[cat[120]]).toBe('hidden');
    expect(iv[120]).toBe(900000);
    expect(r.worst.gameplay[0]).toMatchObject({frame: 99, category: 'gameplay'});
    expect(r.worst.gameplay.every((f: any) => f.category === 'gameplay')).toBe(true);
    expect(r.worst.anyState.some((f: any) => f.category === 'hidden')).toBe(false);
    const by = r.summary.byCategory;
    expect(by.hidden.frames).toBe(1);
    expect(by.menu.frames).toBe(12); // paused 10 + title 2
    expect(by.loading.frames).toBe(5);
    expect(by.warmup.frames).toBe(5);
    expect(by.transition.frames).toBe(5);
    expect(by.unfocused.frames).toBe(3);
    expect(by.loading.interval.max).toBeCloseTo(400, 1);
    expect(r.summary.gaps).toBe(1);
    expect(r.summary.framesByState.paused).toBe(10);
  });
});

// ==== the game / browser side ===================================================================================================

/** three r186's first-use internals as the hooks see them (NodeManager / Pipelines / backend / Renderer.render). */
class FakeNodes { nodeBuilderCache = new Map<unknown, unknown>(); _createNodeBuilder(_o?: unknown) { return {}; } _createNodeBuilderState(_b: unknown) { return {}; } }
class FakePipelines { caches = new Map<unknown, unknown>(); _getRenderPipeline(..._a: unknown[]) { const p = {}; this.caches.set(p, p); return p; } }
class FakeBackend { createProgram(_p: unknown) { return undefined; } }
class FakeRenderer {
  initialized = true;
  info = {frame: 0, render: {drawCalls: 812, frameCalls: 5, triangles: 1.2e6}, memory: {textures: 300, geometries: 900, programs: 60}};
  _nodes = new FakeNodes(); _pipelines = new FakePipelines(); backend = new FakeBackend();
  /** First-use work the next render() does: node builds (ms each), pipelines, programs. */
  todo = {builds: [] as number[], pipes: 0, progs: 0};
  clock: {t: number} | null = null;
  getPixelRatio() { return 1.5; }
  render(_s?: unknown, _c?: unknown) {
    for (const ms of this.todo.builds) this.build(ms);
    for (let k = 0; k < this.todo.pipes; k++) this._pipelines._getRenderPipeline();
    for (let k = 0; k < this.todo.progs; k++) this.backend.createProgram({});
    this.todo = {builds: [], pipes: 0, progs: 0};
  }
  /** One TSL node build (inside a render when called from render(); a compileAsync-style build otherwise). */
  build(ms: number) { const b = this._nodes._createNodeBuilder({}); if (this.clock) this.clock.t += ms; const st = this._nodes._createNodeBuilderState(b); this._nodes.nodeBuilderCache.set(st, st); }
}

class FakeGame {
  state = 'playing';
  warming = false;
  frameCpu = {updateMs: 2, renderMs: 3, deferredMs: 0.5, rendered: true};
  prof = new UpdateProfiler(64);
  renderer = new FakeRenderer();
  world: {culler: {stats: {culled: number; level: number}}} | null = {culler: {stats: {culled: 120, level: 1}}};
  warmGate: Promise<void> = Promise.resolve();
  canvas = {width: 1920, height: 1080};
  settings = {quality: 'high', renderScale: 1, fov: 80};
  gpu = null;
  player = {x: 10, y: 0, z: -4, yaw: 0, pitch: 0};
  zombies: unknown[] = [1, 2, 3];
  seed = 0x1234abcd;
  run = {current: {level: 'mall', section: 'main', station: 's07'}};
  stateListeners: ((s: string, p: string) => void)[] = [];
  trainRide = new FakeRide();
  lifecycle = {busy: false};
  layout = {name: 'Galleria Center'};
  // what must never reach a report
  inv = {items: ['INVENTORY-SECRET']};
  saves = {slot1: 'SAVE-SECRET'};
  calls: string[] = [];
  setState(s: string) { const p = this.state; this.state = s; for (const fn of this.stateListeners) fn(s, p); }
  generateSection(key: unknown) { this.calls.push('generate'); return {key}; }
  async prepareSection(_key: unknown) { this.calls.push('prepare'); await Promise.resolve(); return {}; }
  buildSection(_key: unknown) { this.calls.push('build'); for (let k = 0; k < 3; k++) this.spawnEnemy({archetype: k ? 'rat' : undefined, look: 'lingerie'}); }
  spawnEnemy(_s: unknown) { this.zombies.push(0); return {}; }
  leaveSection() { this.calls.push('leave'); }
  commitSave(reason: string) { this.calls.push('save'); return {ok: true, meta: {revision: 3, secret: 'SAVE-SECRET'}, reason}; }
  async prepareGraphics() {
    this.warming = true;
    this.renderer.build(3); // a compileAsync-style build (outside a render)
    await this.warmGate;
    this.warming = false;
    return {status: 'complete', mode: 'full', ms: 1234.5, reason: 'x?y=1', plan: {items: 4}, passes: ['a'], pools: [],
      stages: {materials: {done: 4, total: 4, ms: 900}, passes: {done: 3, total: 3, ms: 200}, shadows: {done: 2, total: 2, ms: 100}, view: {done: 1, total: 1, ms: 30}}};
  }
  /** Game.newGame's order: prepare (assets) -> leave -> build -> warm-up -> play. */
  async newGame(level: string) {
    await this.prepareSection({level, section: 'main'});
    this.leaveSection();
    this.setState('loading');
    this.buildSection({level, section: 'main', station: 's09'});
    const w = await this.prepareGraphics();
    this.setState('playing');
    return w;
  }
  /** Game.travelToStation's order: depart, leave, prepare, build in the tunnel, background compile (no warm-up), arrive, save. */
  async travelToStation(to: string) {
    this.lifecycle.busy = true;
    await this.trainRide.depart();
    this.leaveSection();
    await this.prepareSection({level: 'reactor', section: 'main', station: to});
    this.buildSection({level: 'reactor', section: 'main', station: to});
    await this.backgroundCompile();
    await this.trainRide.arrive();
    this.commitSave('arrival');
    this.lifecycle.busy = false;
    return {ok: true};
  }
  async backgroundCompile() { this.renderer.build(7); }
}
class FakeRide { riding = false; async depart() { return {status: 'in-tunnel'}; } async arrive() { return {status: 'stopped'}; } }

const asGame = (g: FakeGame) => g as unknown as RecorderGame;
const quick = {yieldFn: () => Promise.resolve(), observer: null, loadingManager: null, doc: null, win: null, origin: 'https://game.example'} as const;

/** One play frame through the real profiler (mocked clock) + the controller. */
function playFrame(g: FakeGame, ctl: PerfRecorderController, clock: {t: number}, aiMs = 1): void {
  const p = g.prof;
  p.frameBegin();
  clock.t += 0.2;
  p.lap(S.input); clock.t += 0.5;
  p.lap(S.ai); p.begin(S.brain); p.begin(S.path); clock.t += aiMs; p.end(S.path); p.end(S.brain);
  p.lap(S.cull); clock.t += 0.3;
  p.lap(S.draw); g.renderer.render(); clock.t += 2;
  p.frameEnd();
  g.renderer.info.frame++;
  clock.t += 12;
  ctl.frame(clock.t, 4);
}

describe('perf recorder controller: OFF is inert', () => {
  it('while not recording, frame() reads nothing from the game and nothing is installed or allocated', () => {
    let reads = 0;
    const g = new FakeGame();
    const ctl = new PerfRecorderController(asGame(g), quick);
    const spy = new Proxy(g, {get(t, k, r) { reads++; return Reflect.get(t, k, r); }});
    (ctl as unknown as {g: unknown}).g = spy; (ctl as unknown as {x: unknown}).x = spy;
    for (let k = 0; k < 10000; k++) ctl.frame(k * 16, 3);
    expect(reads).toBe(0);
    expect(ctl.capture.bytes()).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(g, 'buildSection')).toBe(false);
    expect(g.prof.on).toBe(false);
    // the real three loading manager is untouched by constructing a recorder
    const m = THREE.DefaultLoadingManager;
    const before = m.itemStart;
    new PerfRecorderController(asGame(new FakeGame()), {yieldFn: quick.yieldFn});
    expect(m.itemStart).toBe(before);
  });

  it('costs next to nothing off (1 M frame() calls well under 100 ms)', () => {
    const ctl = new PerfRecorderController(asGame(new FakeGame()), quick);
    const t0 = performance.now();
    for (let k = 0; k < 1e6; k++) ctl.frame(k, 1);
    const ms = performance.now() - t0;
    log(`off: 1e6 frame() calls ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100);
  });
});

describe('perf recorder controller: recording', () => {
  it('records profiler spans, renderer counters, state / flags and lifecycle events; restores the profiler and every hook at stop', async () => {
    const clock = {t: 1000};
    vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    const g = new FakeGame();
    const ctl = new PerfRecorderController(asGame(g), quick);
    expect(ctl.start('qa')).toBe(true);
    expect(ctl.start('qa')).toBe(false); // already running
    expect(g.prof.on).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(g, 'buildSection')).toBe(true); // wrapped on the instance while recording
    for (let k = 0; k < 10; k++) playFrame(g, ctl, clock);
    g.renderer._nodes.nodeBuilderCache.set('a', 1); g.renderer._pipelines.caches.set('p', 1); g.renderer.info.memory.textures += 2;
    playFrame(g, ctl, clock, 30); // a slow AI frame that also built a node / pipeline / 2 textures
    g.buildSection({level: 'mall', section: 'main', station: 's08'});
    g.commitSave('arrival');
    await g.prepareSection({level: 'mall', section: 'main'});
    await g.prepareGraphics();
    await g.trainRide.depart();
    g.lifecycle.busy = true; playFrame(g, ctl, clock); g.lifecycle.busy = false;
    g.setState('paused'); playFrame(g, ctl, clock);
    const n = ctl.mark();
    expect(n).toBe(1);
    playFrame(g, ctl, clock);
    const rep = await ctl.stop('manual', 'qa');
    expect(rep).not.toBeNull();
    expect(ctl.phase).toBe('ready');
    expect(g.prof.on).toBe(false); // back off (it was off before)
    for (const k of ['buildSection', 'commitSave', 'prepareSection', 'spawnEnemy', 'prepareGraphics']) expect(Object.prototype.hasOwnProperty.call(g, k), k).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(g.trainRide, 'depart')).toBe(false);
    g.buildSection({level: 'subway', section: 'main'}); // still works unwrapped
    const r = ctl.reportObject() as any;
    expect(r.capture.stoppedBy).toBe('qa');
    const cols = r.frames.columns;
    expect(cols.t).toHaveLength(14);
    const slow = 10;
    expect(cols.newNodeBuilds[slow]).toBe(1);
    expect(cols.newPipelines[slow]).toBe(1);
    expect(cols.newTextures[slow]).toBe(2);
    expect(cols.draws[slow]).toBe(812);
    expect(cols.culled[slow]).toBe(120);
    expect(r.spans.perFrame.ai[slow]).toBe(3000);
    expect(cols.flags[11] & F.transition).toBeTruthy();
    expect(cols.flags[12] & F.stateChange).toBeTruthy();
    expect(r.frames.stateNames[cols.state[12]]).toBe('paused');
    expect(cols.flags[13] & F.mark).toBeTruthy();
    const kinds = r.events.list.map((e: any) => e.kind);
    for (const k of ['recording.start', 'level.build', 'save.write', 'level.prepare', 'warmup', 'train.depart', 'state', 'mark', 'recording.stop']) expect(kinds, k).toContain(k);
    expect(kinds).not.toContain('enemy.spawn'); // aggregated into the level build
    const build = r.events.list.find((e: any) => e.kind === 'level.build');
    expect(build).toMatchObject({level: 'mall', station: 's08', enemySpawns: 3});
    expect(r.events.list.find((e: any) => e.kind === 'save.write')).toMatchObject({reason: 'arrival', ok: true});
    expect(r.events.list.find((e: any) => e.kind === 'warmup')).toMatchObject({status: 'complete', mode: 'full', warmupMs: 1234.5});
    expect(r.world.segments.map((s: any) => s.station)).toEqual(['s07', 's08']);
    expect(r.world.segments[0]).toMatchObject({level: 'mall', seed: 0x1234abcd, seedCode: (0x1234abcd >>> 0).toString(36).toUpperCase().padStart(7, '0'), name: 'Galleria Center'});
    const cap = Object.fromEntries((r.capabilities as any[]).map(c => [c.id, c]));
    expect(cap.spans.available).toBe(true);
    expect(cap['renderer.newNodeBuilds'].available).toBe(true);
    expect(cap.gpu.available).toBe(false);
    expect(cap.lifecycleEvents.note).toMatch(/missing: .*stageLevelTextures/); // the fake has no stageLevelTextures(): reported, not a crash
    expect(r.summary.gameplay.interval.frames).toBeGreaterThan(5);
    expect(r.capture.overhead.frames).toBe(14);
  });

  it('task journey-compile-pacing: tags frames while the journey compile runs; its start / phase / end (and a job already running) are events', async () => {
    const clock = {t: 1000};
    vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    const g = new FakeGame() as FakeGame & {journeyCompileStats: Record<string, unknown> | null};
    const job = (phase: string) => ({phase, sceneItems: 40, sceneDone: 12, casters: 9, shadowDone: 0, sceneChunks: 12, slices: 7, maxPerSlice: 3,
      sliceMaxMs: 1.2345, background: true, postStalls: 0, cancelReason: null as string | null});
    const old = job('scene');
    g.journeyCompileStats = old; // a capture started after the arrival, the job still running (the user's Mall trace)
    const ctl = new PerfRecorderController(asGame(g), quick);
    ctl.start('qa');
    playFrame(g, ctl, clock);
    old.phase = 'done';
    playFrame(g, ctl, clock);
    const next = job('scene');
    g.journeyCompileStats = next; // the next journey
    playFrame(g, ctl, clock);
    next.phase = 'shadow';
    playFrame(g, ctl, clock);
    next.phase = 'cancelled'; next.cancelReason = 'generation';
    playFrame(g, ctl, clock);
    g.journeyCompileStats = null;
    playFrame(g, ctl, clock);
    await ctl.stop('manual', 'qa');
    const r = ctl.reportObject() as any;
    expect(r.frames.flagBits.compiling).toBe(F.compiling);
    expect(Array.from(r.frames.columns.flags as number[], f => (f & F.compiling) !== 0)).toEqual([true, false, true, true, false, false]);
    const ev = r.events.list.filter((e: any) => String(e.kind).startsWith('compile.journey'));
    expect(ev.map((e: any) => [e.kind, e.phase])).toEqual([['compile.journey.active', 'scene'], ['compile.journey.end', 'done'], ['compile.journey.start', 'scene'],
      ['compile.journey.phase', 'shadow'], ['compile.journey.end', 'cancelled']]);
    expect(ev[0]).toMatchObject({sceneDone: 12, sceneItems: 40, calls: 12, slices: 7, maxPerSlice: 3, sliceMaxMs: 1.23, background: true, postStalls: 0});
    expect(ev[4]).toMatchObject({reason: 'generation'});
    const cap = Object.fromEntries((r.capabilities as any[]).map(c => [c.id, c]));
    expect(cap.journeyCompile.available).toBe(true);
  });

  it('keeps a QA-started profiler on after the recording', async () => {
    const g = new FakeGame();
    g.prof.startRecording();
    const ctl = new PerfRecorderController(asGame(g), quick);
    ctl.start();
    await ctl.stop();
    expect(g.prof.on).toBe(true);
  });

  it('auto-stops at the frame cap and at the duration cap, with the report ready', async () => {
    const g = new FakeGame();
    let now = 0;
    const ctl = new PerfRecorderController(asGame(g), {...quick, caps: {frames: 100}, now: () => now});
    ctl.start();
    for (let k = 0; k < 150 && ctl.recording; k++) { now += 16; ctl.frame(now, 3); }
    expect(ctl.recording).toBe(false);
    await vi.waitFor(() => expect(ctl.phase).toBe('ready'));
    expect(ctl.report?.termination).toBe('auto-cap-frames');
    expect(ctl.report?.frames).toBe(100);
    const d = new PerfRecorderController(asGame(new FakeGame()), {...quick, caps: {durationMs: 500}, now: () => now});
    d.start();
    for (let k = 0; k < 100 && d.recording; k++) { now += 16; d.frame(now, 3); }
    await vi.waitFor(() => expect(d.phase).toBe('ready'));
    expect(d.report?.termination).toBe('auto-cap-duration');
  });

  it('stops with "hidden" when the tab was in the background for long, and tags the gap', async () => {
    let now = 0;
    const fns: (() => void)[] = [];
    const doc = {hidden: false, addEventListener: (_t: string, fn: () => void) => { fns.push(fn); }, removeEventListener: () => {}};
    const ctl = new PerfRecorderController(asGame(new FakeGame()), {...quick, doc: doc as never, now: () => now});
    ctl.start();
    for (let k = 0; k < 10; k++) { now += 16; ctl.frame(now, 3); }
    doc.hidden = true; for (const f of fns) f();
    now += 45000;
    doc.hidden = false; for (const f of fns) f();
    await vi.waitFor(() => expect(ctl.phase).toBe('ready'));
    const r = ctl.reportObject() as any;
    expect(r.capture.termination).toBe('hidden');
    expect(r.frames.columns.flags[9] & F.gap).toBeFalsy(); // set when frames resume; none did
    expect(r.events.list.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['page.hidden', 'page.visible']));
  });

  it('a restart clears the previous capture and report (the arrays are reused: no growth); clear / cancel are idempotent', async () => {
    let now = 0;
    const g = new FakeGame();
    const ctl = new PerfRecorderController(asGame(g), {...quick, now: () => now});
    ctl.start();
    for (let k = 0; k < 50; k++) { now += 16; ctl.frame(now, 3); }
    ctl.mark();
    await ctl.stop();
    expect(ctl.report?.frames).toBe(50);
    const arr = (ctl.capture as unknown as {t: Float64Array}).t, bytes = ctl.capture.bytes();
    ctl.start();
    expect(ctl.report).toBeNull();
    expect(ctl.capture.frames).toBe(0);
    expect(ctl.marks).toBe(0);
    for (let k = 0; k < 5; k++) { now += 16; ctl.frame(now, 3); }
    await ctl.stop();
    expect(ctl.report?.frames).toBe(5);
    expect((ctl.capture as unknown as {t: Float64Array}).t).toBe(arr);
    expect(ctl.capture.bytes()).toBe(bytes);
    ctl.clear(); ctl.clear();
    expect(ctl.report).toBeNull();
    expect(ctl.phase).toBe('idle');
    ctl.start();
    ctl.clear(); // cancels a running capture: no report
    expect(ctl.recording).toBe(false);
    expect(ctl.report).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(g, 'buildSection')).toBe(false);
    expect(g.prof.on).toBe(false);
    await expect(ctl.stop()).resolves.toBeNull(); // stop when idle: nothing
  });

  it('GPU pass times come only from the overlay timer, asynchronously, and are null (never 0) otherwise', async () => {
    let tap: ((f: number, ms: number) => void) | null = null;
    const overlay = {setGpuTap: (fn: typeof tap) => { tap = fn; }, gpuTimer: {status: () => ({available: true, kind: 'webgpu-timestamp-query' as const, note: 'ts'}), error: null}};
    const g = new FakeGame();
    let now = 0;
    const ctl = new PerfRecorderController(asGame(g), {...quick, overlay, now: () => now});
    ctl.start();
    for (let k = 0; k < 6; k++) { g.renderer.info.frame = 100 + k; now += 16; ctl.frame(now, 3); }
    expect(tap).not.toBeNull();
    tap!(102, 4.25); // resolves a few frames later
    tap!(999, 1); // unknown frame: ignored
    await ctl.stop();
    expect(tap).toBeNull(); // the tap is removed at stop
    const r = ctl.reportObject() as any;
    expect(r.frames.columns.gpu).toEqual([null, null, 425, null, null, null]);
    expect(r.capabilities.find((c: any) => c.id === 'gpu').available).toBe(true);
  });
});

describe('perf recorder: the recent warm-up result (schemaMinor 5, task static-batching-warmup-20261105)', () => {
  it('a capture started after the load carries the warm-up that prepared the level: status, budget, cut stage, stages; reasons sanitized', async () => {
    const clock = {t: 1000};
    vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    const g = new FakeGame() as FakeGame & {warmup?: unknown};
    g.warmup = {status: 'partial', mode: 'full', ms: 120004.2, budgetMs: 120000, cutStage: 'materials', reason: 'time budget (120 s) reached in materials',
      plan: {items: 1366, others: 722, casters: 900}, stages: {materials: {done: 900, total: 1366, ms: 119000}, passes: {done: 1, total: 1, ms: 300}, shadows: {done: 0, total: 20, ms: 0}, view: {done: 1, total: 1, ms: 40}}};
    const ctl = new PerfRecorderController(asGame(g), quick);
    ctl.start('qa');
    for (let k = 0; k < 5; k++) playFrame(g, ctl, clock);
    await ctl.stop('manual', 'qa');
    const r = ctl.reportObject() as any;
    expect(r.schemaMinor).toBe(5);
    const want = {status: 'partial', mode: 'full', budgetMs: 120000, cutStage: 'materials', reason: 'time budget (120 s) reached in materials', warmupMs: 120004.2,
      stages: {materials: {done: 900, total: 1366, ms: 119000}, shadows: {done: 0, total: 20, ms: 0}}, plan: {items: 1366}};
    expect(r.world.segments[0]).toMatchObject({route: 'recording-start', lastWarmup: want});
    expect(r.environment.warmup).toMatchObject(want);
    // an error-message reason (may hold a path / URL) is withheld
    g.warmup = {status: 'failed', mode: 'full', ms: 3, reason: 'fetch https://x.example/a?b=1 failed', stages: {}};
    const c2 = new PerfRecorderController(asGame(g), quick);
    c2.start('qa');
    playFrame(g, c2, clock);
    await c2.stop('manual', 'qa');
    const r2 = c2.reportObject() as any;
    expect(r2.world.segments[0].lastWarmup.reason).toBe('withheld (not a plain reason)');
    expect(JSON.stringify(r2)).not.toContain('x.example');
    vi.restoreAllMocks();
  });
});

// Task studio-baked-lighting-reflections-20261114-050258-01 (lane SETTINGS)
describe('perf recorder: enhanced lighting in the environment block (an additive key: schemaMinor unchanged)', () => {
  it('a report carries the runtime\'s status at report time — what the live station was built with; null for a game without the runtime', async () => {
    const clock = {t: 1000};
    vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    const g = new FakeGame() as FakeGame & {enhancedLighting?: {status(): EnhancedLightingStatus}};
    const bare = new PerfRecorderController(asGame(g), quick);
    bare.start('qa');
    for (let k = 0; k < 3; k++) playFrame(g, bare, clock);
    await bare.stop('manual', 'qa');
    const r0 = bare.reportObject() as any;
    expect(Object.prototype.hasOwnProperty.call(r0.environment, 'enhancedLighting')).toBe(true);
    expect(r0.environment.enhancedLighting).toBe(null);
    const status: EnhancedLightingStatus = {requested: {lighting: 'on', reflections: 'high'}, pending: true, cacheBackend: 'indexeddb',
      active: {gi: 'standard', giReason: null, reflections: 'off', reflectionsReason: 'Auto skips reflections on a software renderer (On forces them)', cache: 'miss', giMs: 840.5, probeMs: 0, probes: 0, probeBytes: 0}};
    g.enhancedLighting = {status: () => status};
    const ctl = new PerfRecorderController(asGame(g), quick);
    ctl.start('qa');
    for (let k = 0; k < 3; k++) playFrame(g, ctl, clock);
    await ctl.stop('manual', 'qa');
    const r = ctl.reportObject() as any;
    expect(r.schemaMinor).toBe(5);
    expect(r.environment.enhancedLighting).toEqual({line: enhancedLightingLine(status), requested: status.requested, active: status.active, pending: true, cacheBackend: 'indexeddb'});
    expect(r.environment.enhancedLighting.line).toBe('on: bake standard · refl off (Auto skips reflections on a software renderer (On forces them)) · cache miss · change pending');
    expect(r.environment.warmup).toBe(null); // the other environment keys are as before
    expect(r.environment.display).toMatchObject({quality: g.settings.quality});
  });
});

describe('perf recorder: privacy', () => {
  it('asset ids are basenames + a category (no directories, query strings, fragments, other origins)', () => {
    const o = 'https://game.example';
    expect(assetId('https://game.example/app/assets/models/mall-lingerie-top.glb?token=SECRET#x', o)).toEqual({id: 'mall-lingerie-top.glb', category: 'model'});
    expect(assetId('https://cdn.other.example/x.png', o)).toBeNull();
    expect(assetId('blob:https://game.example/1234-5678', o)).toEqual({id: 'embedded', category: 'embedded-image'});
    expect(assetId('data:image/png;base64,AAAA', o)).toEqual({id: 'embedded', category: 'embedded-image'});
    expect(assetId('assets/textures/wall%20tile.jpg?v=2', o)).toEqual({id: 'wall tile.jpg', category: 'texture'});
    expect(assetCategory('a.mp3')).toBe('audio');
    expect(sanitizeInvoker('https://game.example/assets/index-AbC123.js?x=1', o)).toBe('index-AbC123.js');
    expect(sanitizeInvoker('https://evil.example/a.js', o)).toBe('other-origin');
    expect(sanitizeInvoker('FrameRequestCallback', o)).toBe('FrameRequestCallback');
  });

  it('a full report from hooks fed URLs with credentials carries no URL, query string, save or inventory data', async () => {
    let now = 0;
    const managerCalls: string[] = [];
    const manager = {itemStart: (u: string) => { managerCalls.push(`s:${u}`); }, itemEnd: (u: string) => { managerCalls.push(`e:${u}`); }, itemError: () => {}};
    type Cb = (l: {getEntries(): unknown[]}) => void;
    let loafCb: Cb | null = null, resCb: Cb | null = null;
    class PO {
      static supportedEntryTypes = ['long-animation-frame', 'resource'];
      constructor(private cb: (l: {getEntries(): unknown[]}) => void) {}
      observe(o: {type: string}) { if (o.type === 'resource') resCb = this.cb; else loafCb = this.cb; }
      disconnect() { if (resCb === this.cb) resCb = null; if (loafCb === this.cb) loafCb = null; }
    }
    const g = new FakeGame();
    const ctl = new PerfRecorderController(asGame(g), {...quick, loadingManager: manager, observer: PO as never, now: () => now});
    ctl.start();
    const glb = 'https://game.example/app/assets/models/zombie-rigged.glb?sig=SECRETSIG&user=ME';
    manager.itemStart(glb); manager.itemStart(glb); now += 40; manager.itemEnd(glb); now += 25; manager.itemEnd(glb);
    manager.itemStart('blob:https://game.example/abcd'); now += 5; manager.itemEnd('blob:https://game.example/abcd');
    resCb!({getEntries: () => [
      {name: glb, startTime: 1, responseEnd: 41, initiatorType: 'fetch', transferSize: 0, encodedBodySize: 5000, decodedBodySize: 5000},
      {name: 'https://tracker.other.example/p.gif?id=ME', startTime: 2, responseEnd: 3, initiatorType: 'img', transferSize: 10, encodedBodySize: 10, decodedBodySize: 10},
    ]});
    loafCb!({getEntries: () => [{startTime: 50, duration: 180, blockingDuration: 130, renderStart: 200, styleAndLayoutStart: 210,
      scripts: [{invokerType: 'user-callback', invoker: 'https://game.example/assets/index-AbC123.js?q=SECRETQ', sourceFunctionName: 'frame', sourceURL: 'https://game.example/assets/index-AbC123.js?q=SECRETQ', duration: 170}]}]});
    for (let k = 0; k < 20; k++) { now += 16; ctl.frame(now, 3); }
    await ctl.stop();
    expect(managerCalls).toHaveLength(6); // the original manager still saw every call
    expect(manager.itemStart).not.toBe(undefined);
    const text = ctl.report!.parts.join('');
    for (const bad of ['SECRETSIG', 'user=ME', 'SECRETQ', 'tracker', '?sig', 'game.example', 'https:', 'blob:', 'INVENTORY-SECRET', 'SAVE-SECRET', 'revision']) expect(text, bad).not.toContain(bad);
    const r = JSON.parse(text);
    const load = r.events.list.find((e: any) => e.kind === 'asset.load');
    expect(load).toMatchObject({id: 'zombie-rigged.glb', category: 'model', dur: 65, fetchedMs: 40, parseMs: 25});
    expect(r.events.list.find((e: any) => e.kind === 'asset.image')).toMatchObject({id: 'embedded'});
    expect(r.resources.list).toEqual([expect.objectContaining({id: 'zombie-rigged.glb', cache: 'hit', duration: 40})]);
    expect(r.longFrames.list[0]).toMatchObject({duration: 180, blocking: 130, scripts: [expect.objectContaining({invoker: 'index-AbC123.js', source: 'index-AbC123.js', fn: 'frame'})]});
    expect(resCb).toBeNull(); expect(loafCb).toBeNull(); // observers disconnected at stop
    // the manager's methods are its own again
    manager.itemStart('x.png');
    expect(managerCalls).toHaveLength(7);
  });

  it('restores the real three DefaultLoadingManager after a recording', async () => {
    const m = THREE.DefaultLoadingManager;
    const before = {s: m.itemStart, e: m.itemEnd, x: m.itemError};
    const ctl = new PerfRecorderController(asGame(new FakeGame()), {yieldFn: quick.yieldFn, observer: null, doc: null, win: null});
    ctl.start();
    expect(m.itemStart).not.toBe(before.s);
    await ctl.stop();
    expect(m.itemStart).toBe(before.s); expect(m.itemEnd).toBe(before.e); expect(m.itemError).toBe(before.x);
  });
});

describe('perf recorder: keys, file name, build identity, game seams', () => {
  it('F8 starts / stops, F9 marks only while recording; modifiers and typing are never taken; no existing binding uses them', () => {
    expect(recorderKeyAction({code: 'F8'}, false)).toBe('toggle');
    expect(recorderKeyAction({code: 'F8'}, true)).toBe('toggle');
    expect(recorderKeyAction({code: 'F9'}, false)).toBeNull();
    expect(recorderKeyAction({code: 'F9'}, true)).toBe('mark');
    expect(recorderKeyAction({code: 'F8', ctrlKey: true}, true)).toBeNull();
    expect(recorderKeyAction({code: 'F8', altKey: true}, true)).toBeNull();
    expect(recorderKeyAction({code: 'F9', metaKey: true}, true)).toBeNull();
    expect(recorderKeyAction({code: 'F8', target: {tagName: 'INPUT'}}, true)).toBeNull();
    expect(recorderKeyAction({code: 'KeyP'}, true)).toBeNull();
    expect(GAME_KEYS.has(RECORDER_KEYS.toggle) || GAME_KEYS.has(RECORDER_KEYS.mark)).toBe(false);
    // no other source file binds F8 / F9 (the paper map passes every F-key through)
    const files = ['game.ts', 'player/input.ts', 'ui/lockboxView.ts', 'ui/paperMap.ts', 'ui/mainMenu.ts', 'gear/system.ts', 'debug/overlay.ts', 'ui/inventoryUI.ts'];
    for (const f of files) expect(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), f).not.toMatch(/['"]F[89]['"]/);
  });

  it('the title / pause controls list shows the recorder keys', async () => {
    const {CONTROLS} = await import('../src/ui/hud');
    expect(CONTROLS.some(([a, k]) => /performance recording/i.test(a) && k === `${RECORDER_KEYS.toggle} · ${RECORDER_KEYS.mark}`)).toBe(true);
  });

  it('report file name terminal-state-perf-<build>-<UTC date>.json; the build hash comes from a hashed chunk name only', () => {
    const at = new Date(Date.UTC(2026, 10, 3, 5, 7, 9));
    expect(reportFileName('B1x2Y3z4', at)).toBe('terminal-state-perf-B1x2Y3z4-20261103-050709Z.json');
    expect(reportFileName(null, at)).toBe('terminal-state-perf-dev-20261103-050709Z.json');
    expect(chunkHash('https://h.example/app/assets/index-B1x2Y3z4.js?v=1')).toBe('B1x2Y3z4');
    expect(chunkHash('file:///repo/game/src/debug/perfRecorderHooks.ts')).toBeNull();
    expect(clockText(125400)).toBe('2:05');
  });

  it('the game methods / fields the hooks read still exist (a rename shows up here, not as silently missing events)', () => {
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    for (const m of ['generateSection(', 'async prepareSection(', 'private buildSection(', 'private leaveSection(', 'prepareGraphics(', 'private async stageLevelTextures(',
      'private async backgroundCompile(', '  travel(req', 'async travelToStation(', '  newGame(level', 'async newCampaign(', 'async continueCampaign(', '  retryLevel(',
      'commitSave(reason', 'spawnEnemy(s', 'private readonly lifecycle = new SingleFlight()', 'private transitGap = false', 'readonly frameCpu = {', 'readonly prof = new UpdateProfiler()',
      'get journeyCompileStats(']) {
      expect(src.includes(m), m).toBe(true);
    }
    const ride = readFileSync(new URL('../src/world/trainRide.ts', import.meta.url), 'utf8');
    expect(ride).toMatch(/\n {2}depart\(\): Promise</);
    expect(ride).toMatch(/\n {2}arrive\(\): Promise</);
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/perf\.frame\(time, cpuMs\);\s*recorder\.frame\(time, cpuMs, t0\)/); // (revision 2: + the callback start t0)
    expect(main).toMatch(/const loop = \(time: number\) => \{\s*const t0 = performance\.now\(\);/); // t0 = the rAF callback's entry
  });
});

describe('perf recorder: measured overhead and report size (Node; browser costs differ)', () => {
  it('a full 20 000-frame capture: per-frame recorder cost, serialization time and a report of a handful of MB', async () => {
    const clock = {t: 0};
    const g = new FakeGame();
    // the 20 000-frame cap is reached first only above ~167 Hz (at 60 Hz the 120 s cap stops at ~7 200 frames): lift the time cap
    const ctl = new PerfRecorderController(asGame(g), {...quick, now: () => performance.now(), caps: {durationMs: 1e9}});
    for (let k = 0; k < 400; k++) g.renderer._nodes.nodeBuilderCache.set(`n${k}`, k);
    ctl.start();
    const t0 = performance.now();
    let k = 0;
    while (ctl.recording && k < 25000) {
      g.player.yaw += 0.02; g.player.x += 0.01;
      if (k % 500 === 0) ctl.capture.event(performance.now(), 'asset.load', 12, {id: 'x.glb', category: 'model'});
      playFrame(g, ctl, clock, k % 997 === 0 ? 40 : 0.8);
      k++;
    }
    const recMs = performance.now() - t0;
    expect(ctl.recording).toBe(false);
    await vi.waitFor(() => expect(ctl.phase).toBe('ready'), {timeout: 30000});
    const rep = ctl.report!;
    const r = ctl.reportObject() as any;
    const ov = r.capture.overhead;
    log(`on: ${rep.frames} frames, recorder frame() mean ${ov.meanUs} us max ${ov.maxUs} us (whole loop incl. fake profiler frames ${(recMs / rep.frames * 1000).toFixed(1)} us/frame); `
      + `serialize ${rep.serializeMs} ms, report ${(rep.bytes / 1048576).toFixed(2)} MB, capture arrays ${(ov.captureBytes / 1048576).toFixed(2)} MB`);
    expect(rep.frames).toBe(20000);
    expect(rep.termination).toBe('auto-cap-frames');
    expect(rep.bytes).toBeLessThan(8 * 1048576);
    expect(ov.meanUs).toBeLessThan(200);
    expect(ov.captureBytes).toBeLessThan(8 * 1048576);
    // the serialization's longest main-thread step between two yields (the frame loop runs between them)
    let last = performance.now(), maxStep = 0, steps = 0;
    const each: string[] = [];
    await ctl.capture.serialize({...META}, () => { const t = performance.now(); each.push((t - last).toFixed(1)); maxStep = Math.max(maxStep, t - last); steps++; return new Promise<void>(res => setTimeout(() => { last = performance.now(); res(); }, 0)); });
    maxStep = Math.max(maxStep, performance.now() - last);
    log(`serialize steps ${steps}, longest step ${maxStep.toFixed(1)} ms [${each.join(' ')}]`);
    expect(maxStep).toBeLessThan(60); // ~6 ms measured; generous for slow CI runners and a cold JIT
  });
});

// ==== the in-game UI (a minimal DOM stand-in: Node has no document) ============================================================

class El {
  children: El[] = [];
  parentElement: El | null = null;
  className = ''; id = ''; type = ''; title = ''; href = ''; download = ''; rel = ''; disabled = false;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  private text = '';
  private readonly on: Record<string, (() => void)[]> = {};
  clicks = 0;
  constructor(readonly tagName: string, readonly doc: Doc) {}
  get textContent(): string { return this.children.length ? this.children.map(c => c.textContent).join('') : this.text; }
  set textContent(v: string) { this.children = []; this.text = v; }
  get classList() {
    const cls = () => new Set(this.className.split(' ').filter(Boolean));
    return {add: (c: string) => { const s = cls(); s.add(c); this.className = [...s].join(' '); }, remove: (c: string) => { const s = cls(); s.delete(c); this.className = [...s].join(' '); },
      toggle: (c: string, on?: boolean) => { const s = cls(); if (on ?? !s.has(c)) s.add(c); else s.delete(c); this.className = [...s].join(' '); }, contains: (c: string) => cls().has(c)};
  }
  append(...nodes: (El | string)[]) {
    for (const n of nodes) {
      if (typeof n === 'string') { const t = new El('#text', this.doc); t.text = n; t.parentElement = this; this.children.push(t); } else { n.parentElement = this; this.children.push(n); }
    }
  }
  appendChild(n: El) { this.append(n); return n; }
  insertBefore(n: El, ref: El) { n.parentElement = this; this.children.splice(this.children.indexOf(ref), 0, n); }
  replaceChildren(...nodes: El[]) { this.children = []; this.text = ''; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(t: string, fn: () => void) { (this.on[t] ??= []).push(fn); }
  click() { this.clicks++; if (!this.disabled) for (const fn of this.on.click ?? []) fn(); }
  querySelector(sel: string): El | null { return sel === ':scope > .perf-rec' ? this.children.find(c => c.className.split(' ').includes('perf-rec')) ?? null : null; }
  all(): El[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class Doc {
  head = new El('head', this); body = new El('body', this);
  createElement(tag: string) { return new El(tag.toUpperCase(), this); }
  getElementById(id: string) { return [...this.head.all(), ...this.body.all()].find(e => e.id === id) ?? null; }
}

describe('perf recorder UI: the Performance section, badge and download', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('mounts once per container; the buttons start / stop & download / download again / discard, with honest states and the privacy line', async () => {
    vi.useFakeTimers();
    const doc = new Doc();
    const pause = doc.createElement('div');
    const controls = doc.createElement('div');
    pause.append(controls);
    doc.body.append(pause);
    const urls: unknown[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { urls.push(b); return `blob:test-${urls.length}`; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const g = new FakeGame();
    const ui = new PerfRecorderUi(asGame(g), doc as unknown as Document, {controller: {...quick}});
    ui.mountPanel(pause as unknown as HTMLElement, {idPrefix: 'pause-', before: controls as unknown as Element});
    ui.mountPanel(pause as unknown as HTMLElement, {idPrefix: 'pause-', before: controls as unknown as Element});
    expect(pause.children.filter(c => c.className === 'perf-rec')).toHaveLength(1);
    expect(pause.children[0].className).toBe('perf-rec'); // before the controls grid
    const btn = (id: string) => doc.getElementById(`pause-${id}`)!;
    const all = pause.children[0].all();
    expect(all.find(e => e.tagName === 'H3')?.textContent).toBe('Performance');
    expect(all.some(e => e.textContent === RECORDER_PRIVACY_LINE)).toBe(true);
    expect(pause.children[0].textContent).toContain('F8');
    expect(pause.children[0].textContent).toContain('F9');
    expect([btn('perf-start').disabled, btn('perf-stop').disabled, btn('perf-download').disabled]).toEqual([false, true, true]);
    btn('perf-start').click();
    expect(ui.ctl.recording).toBe(true);
    expect([btn('perf-start').disabled, btn('perf-stop').disabled]).toEqual([true, false]);
    const badge = doc.getElementById('perf-rec-badge')!;
    expect(badge.textContent).toMatch(/^REC 0:00 · F8 stop · F9 mark/);
    for (let k = 0; k < 30; k++) ui.frame(k * 16.7, 3);
    expect(ui.mark()).toBe(1);
    btn('perf-stop').click(); // Stop & Download
    await vi.advanceTimersByTimeAsync(50);
    expect(ui.ctl.phase).toBe('ready');
    expect(doc.body.all().find(e => e.tagName === 'A')).toBeUndefined(); // the download link was clicked and removed again
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBeInstanceOf(Blob);
    const text = await (urls[0] as Blob).text();
    expect(JSON.parse(text).schema).toBe('terminal-state-perf');
    expect(btn('perf-download').disabled).toBe(false);
    expect(btn('perf-start').disabled).toBe(false);
    expect(pause.children[0].textContent).toContain('Report ready');
    btn('perf-download').click(); // download the last report again
    expect(urls).toHaveLength(2);
    btn('perf-discard').click();
    expect(ui.ctl.report).toBeNull();
    expect(btn('perf-download').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(badge.classList.contains('hidden')).toBe(true); // the badge goes away once nothing is recorded / announced
  });

  it('a key / automatic stop prepares the report without downloading and announces it on the badge', async () => {
    vi.useFakeTimers();
    const doc = new Doc();
    const urls: unknown[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { urls.push(b); return 'blob:x'; });
    const ui = new PerfRecorderUi(asGame(new FakeGame()), doc as unknown as Document, {caps: {frames: 20}, controller: {...quick}});
    ui.start('hotkey');
    for (let k = 0; k < 25; k++) ui.frame(k * 16.7, 3); // hits the 20-frame cap
    await vi.advanceTimersByTimeAsync(50);
    expect(ui.ctl.phase).toBe('ready');
    expect(urls).toHaveLength(0);
    expect(doc.getElementById('perf-rec-badge')!.textContent).toMatch(/report ready \(stopped at the frame limit\)/);
  });
});

describe('perf recorder: load routes, warm-up stage spans, control returned and first-use work after it', () => {
  it('labels each level build with its route and splits first-use preparation into before / after the player had control', async () => {
    const clock = {t: 1000};
    vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    const g = new FakeGame();
    g.renderer.clock = clock;
    const ctl = new PerfRecorderController(asGame(g), quick);
    ctl.start('qa');
    expect(Object.prototype.hasOwnProperty.call(g.renderer, 'render')).toBe(true); // hooked while recording
    for (let k = 0; k < 3; k++) playFrame(g, ctl, clock);
    g.renderer.todo.builds = [4];
    playFrame(g, ctl, clock); // frame 3: a node build in a running level (segment 0, after control)
    // NEW GAME: prepare -> build -> warm-up (held open over two loading frames) -> play
    let open!: () => void;
    g.warmGate = new Promise<void>(r => { open = r; });
    clock.t += 1; // (a level build always comes after the rAF timestamp of the frame before it)
    const p = g.newGame('mall');
    await new Promise(r => setTimeout(r, 0));
    expect(g.state).toBe('loading');
    playFrame(g, ctl, clock); playFrame(g, ctl, clock); // frames 4-5: loading + warming (the warm-up's async build lands in frame 4)
    open();
    await p;
    playFrame(g, ctl, clock); // frame 6: playing, no warm-up, no lifecycle op -> control returned
    g.renderer.todo = {builds: [2, 3], pipes: 2, progs: 1};
    playFrame(g, ctl, clock); // frame 7: first use AFTER the warm-up (what it did not cover)
    // TRAVEL BY TRAIN: no warm-up, a background compile in the tunnel
    clock.t += 1;
    await g.travelToStation('s21');
    playFrame(g, ctl, clock); // control returned after the arrival
    await ctl.stop('manual', 'qa');
    // every hook is gone again
    for (const [o, k] of [[g.renderer, 'render'], [g.renderer._nodes, '_createNodeBuilder'], [g.renderer._nodes, '_createNodeBuilderState'], [g.renderer._pipelines, '_getRenderPipeline'], [g.renderer.backend, 'createProgram']] as const) {
      expect(Object.prototype.hasOwnProperty.call(o, k), k).toBe(false);
    }
    const r = ctl.reportObject() as any;
    const segs = r.world.segments;
    expect(segs.map((x: any) => x.route)).toEqual(['recording-start', 'new-game', 'travel-arrival']);
    expect(segs[1]).toMatchObject({level: 'mall', station: 's09'});
    expect(segs[1].warmups).toEqual([expect.objectContaining({kind: 'prepareGraphics', route: 'new-game', status: 'complete', mode: 'full', ms: 1234.5,
      stages: expect.objectContaining({materials: {done: 4, total: 4, ms: 900}, view: {done: 1, total: 1, ms: 30}})})]);
    expect(segs[2].warmups).toEqual([expect.objectContaining({kind: 'backgroundCompile', route: 'travel-arrival'})]);
    expect(segs.every((x: any) => x.controlT !== null)).toBe(true);
    const ev = (kind: string) => r.events.list.filter((e: any) => e.kind === kind);
    expect(ev('level.build').map((e: any) => e.route)).toEqual(['new-game', 'travel-arrival']);
    expect(ev('level.prepare').map((e: any) => e.route)).toEqual(['new-game', 'travel-arrival']);
    expect(ev('warmup')[0]).toMatchObject({route: 'new-game', status: 'complete', mode: 'full'});
    const stages = ev('warmup.stage');
    expect(stages.map((e: any) => e.stage)).toEqual(['materials', 'passes', 'shadows', 'view']);
    expect(stages.map((e: any) => e.dur)).toEqual([900, 200, 100, 30]);
    for (let k = 1; k < 4; k++) expect(stages[k].t).toBeCloseTo(stages[k - 1].t + stages[k - 1].dur, 1); // back to back, ending with the warm-up
    expect(ev('control.returned').map((e: any) => e.route)).toEqual(['new-game', 'travel-arrival']);
    expect(ev('save.write')[0]).toMatchObject({route: 'travel-arrival', reason: 'arrival'});
    const cols = r.frames.columns;
    expect(cols.nodeBuilds[3]).toBe(1);
    expect(cols.nodeBuildMs[3]).toBe(400);
    expect(cols.asyncBuilds[4]).toBe(1);
    expect([cols.nodeBuilds[7], cols.nodeBuildMs[7], cols.pipelinesCreated[7], cols.programsCreated[7]]).toEqual([2, 500, 2, 1]);
    const fu = r.summary.firstUse;
    expect(fu.available).toBe(true);
    expect(fu.segments[0].afterControl).toMatchObject({nodeBuilds: 1, nodeBuildMs: 4});
    expect(fu.segments[1].beforeControl).toMatchObject({asyncBuilds: 1, nodeBuilds: 0});
    expect(fu.segments[1].afterControl).toMatchObject({nodeBuilds: 2, nodeBuildMs: 5, pipelines: 2, programs: 1, framesWithFirstUse: 1});
    expect(fu.segments[1].afterControl.worst[0]).toMatchObject({frame: 7, nodeBuilds: 2});
    expect(cols.asyncBuilds[8]).toBe(1); // the background compile's build (compileAsync, outside a render)
    expect(fu.gameplayAfterControl.nodeBuilds).toBe(3);
    const cap = Object.fromEntries((r.capabilities as any[]).map(c => [c.id, c]));
    expect(cap['firstUse.nodeBuilds / nodeBuildMs / asyncBuilds'].available).toBe(true);
    expect(cap['firstUse.pipelines / pipelineMs'].note).toMatch(/GPU pipeline compile time not observable/);
    expect(cap.shaderCompileTime.available).toBe(false);
    expect(r.worst.gameplay.find((f: any) => f.frame === 7)?.firstUse).toMatchObject({nodeBuilds: 2, pipelines: 2, programs: 1});
  });

  it('first-use columns are null (and listed as unavailable) when three\'s internals are not there', async () => {
    const g = new FakeGame();
    (g.renderer as unknown as {_nodes: unknown})._nodes = {nodeBuilderCache: new Map()};
    let now = 0;
    const ctl = new PerfRecorderController(asGame(g), {...quick, now: () => now});
    ctl.start();
    for (let k = 0; k < 5; k++) { now += 16; ctl.frame(now, 3); }
    await ctl.stop();
    const r = ctl.reportObject() as any;
    expect(r.frames.columns.nodeBuilds.every((v: unknown) => v === null)).toBe(true);
    const c = r.capabilities.find((x: any) => x.id === 'firstUse.nodeBuilds / nodeBuildMs / asyncBuilds');
    expect(c.available).toBe(false);
    expect(c.note).toMatch(/unavailable: .*_createNodeBuilder/);
    expect(Object.prototype.hasOwnProperty.call(g.renderer, 'render')).toBe(false); // the hooks that did install are removed too
  });
});
