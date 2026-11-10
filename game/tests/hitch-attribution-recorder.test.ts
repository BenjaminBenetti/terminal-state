// Task studio-hitch-attribution-recorder-20261105 (the user felt hitches in the Office top-floor recording; the trace could not
// attribute 56 of them): the performance recorder's attribution detail, schema 1 / schemaMinor 2 (additive).
//  - callback START (main.ts t0) in the rAF timebase: start / startDelay / gapBefore columns, null when not supplied;
//  - the TAIL summary: intervals by refresh multiple (an exactly 33.3 ms interval at 60 Hz is ONE missed refresh), callback overruns
//    and their overlap with interval misses (one union count), stall events per minute, worst 1 s / 5 s windows, low / high refresh;
//  - the GPU-queue completion probe through the controller with a fake asynchronous queue: never awaited, out-of-order resolution,
//    the in-flight cap, a rejected probe, stop (pending -> cancelled, a late resolution ignored), a new capture (no cross-write),
//    unsupported backends (null + capability reason);
//  - the shot / hit spans: stable ids / names / parents, and on the REAL hit path (a real rigged zombie, DamageSystem.hitZombie ->
//    tearChunk -> extractPatch) the spans nest and every outcome (wounds, tears, chunks, RNG) is identical with profiling on or off;
//  - first-use identity labels (sanitized, bounded, the most expensive kept) and the flashlight lit / shadow flags.
import * as THREE from 'three';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {installCanvasShim} from './helpers/canvas2d';
import {FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import {PhysicsSystem} from '../src/physics/world';
import {DamageSystem} from '../src/damage/system';
import {woundsOf} from '../src/damage/wounds';
import {ZombieActor} from '../src/ai/zombieActor';
import {F, FrameInput, PERF_SCHEMA_MINOR, PerfCapture, QUEUE_STATES, safeLabel, type ReportMeta} from '../src/debug/perfRecorder';
import {PerfRecorderController, firstUseIdentity, type RecorderGame} from '../src/debug/perfRecorderHooks';
import {PARENT, S, SPAN_COUNT, UpdateProfiler, isHookSpan} from '../src/debug/updateProfile';

afterEach(() => { vi.restoreAllMocks(); });

const NAMES = (() => { const p = new UpdateProfiler(2); return Array.from({length: SPAN_COUNT}, (_, j) => p.name(j)); })();
const meta = (environment: Record<string, unknown> = {}): ReportMeta => ({build: {label: 'test'}, environment, capabilities: [], spanNames: NAMES,
  capturedAtUTC: '2026-11-05T00:00:00.000Z', endedAtUTC: '2026-11-05T00:01:00.000Z'});
const parse = (c: PerfCapture, m = meta()) => JSON.parse(c.serializeSync(m)) as Record<string, any>;
const flush = () => new Promise<void>(r => setImmediate(r));
const HZ60 = 1000 / 60;

/** Frames whose INTERVALS are `ivs` (interval k = rAF k+1 - rAF k) and cpu `cpu(k)`, playing + rendered. */
function capture(ivs: number[], cpu: (k: number) => number, start?: (k: number, t: number) => number, caps: ConstructorParameters<typeof PerfCapture>[0] = {}): PerfCapture {
  const c = new PerfCapture(caps);
  c.start(1000);
  const i = new FrameInput();
  i.time = 1000;
  for (let k = 0; k <= ivs.length; k++) {
    i.cpuMs = cpu(k); i.updateMs = 1; i.renderMs = 2; i.state = 0; i.flags = F.rendered; i.frameId++;
    i.start = start ? start(k, i.time) : NaN;
    c.frame(i, null);
    if (k < ivs.length) i.time += ivs[k];
  }
  c.stop(i.time + 20, 'manual');
  return c;
}

describe('callback start / gaps (frames.columns.start / startDelay / gapBefore)', () => {
  it('stores performance.now() at the callback entry in the rAF timebase; startDelay = start - t, gapBefore = start - previous end', () => {
    const c = capture(Array(9).fill(HZ60), () => 5, (k, t) => t + (k === 5 ? 6 : 0.4));
    const r = parse(c), col = r.frames.columns;
    expect(r.schemaMinor).toBe(PERF_SCHEMA_MINOR);
    expect(col.start[0]).toBe(40); // 0.4 ms after the capture's first rAF timestamp (0.01 ms units)
    expect(col.startDelay[3]).toBe(40);
    expect(col.startDelay[5]).toBe(600);
    expect(col.gapBefore[0]).toBeNull(); // no previous callback
    expect(col.gapBefore[5]).toBe(Math.round((HZ60 + 6 - 0.4 - 5) * 100)); // this start - (previous start + previous cpu)
    expect(col.gapBefore[6]).toBe(Math.round((HZ60 + 0.4 - 6 - 5) * 100));
    expect(r.frames.units.gapBefore).toMatch(/INCLUDING the normal wait/);
    expect(r.summary.tail.callbackStart.frames).toBe(9); // (gameplay frames with an interval: the last frame has none)
    // not supplied (an older caller): every start column null, no callbackStart summary — the rest of the report unchanged
    const old = parse(capture(Array(9).fill(HZ60), () => 5));
    for (const k of ['start', 'startDelay', 'gapBefore']) expect(old.frames.columns[k].every((v: unknown) => v === null), k).toBe(true);
    expect(old.summary.tail.callbackStart).toBeNull();
    for (const k of ['t', 'interval', 'cpu', 'update', 'render', 'deferred', 'gpu', 'state', 'category', 'flags', 'draws', 'triangles', 'passes', 'newTextures', 'newGeometries',
      'newPrograms', 'newNodeBuilds', 'newPipelines', 'culled', 'enemies', 'yaw', 'pitch', 'nodeBuilds', 'nodeBuildMs', 'asyncBuilds', 'pipelinesCreated', 'pipelineMs', 'programsCreated', 'programMs'])
      expect(old.frames.columns[k], k).toHaveLength(10); // every schema-1 column is still there
  });
});

describe('tail summary (summary.tail): refresh multiples, overruns and their overlap, stall events, worst windows', () => {
  /** 60 Hz: 300 intervals; exact 33.333 / rounded 33.3 / 50 ms intervals, a hidden overrun and an overrun with a miss. */
  const special: Record<number, number> = {50: 2 * HZ60, 100: 33.3, 150: 50, 250: 33.33};
  const ivs = Array.from({length: 300}, (_, k) => special[k] ?? HZ60);
  const cpu = (k: number) => (k === 200 ? 19.5 : k === 250 ? 23 : 7);

  it('counts an exactly 33.3 ms interval as ONE missed refresh, 50 ms as two; overruns separately; the union once', () => {
    const r = parse(capture(ivs, cpu), meta({refresh: {hz: 60, measured: true}}));
    const tl = r.summary.tail;
    expect(tl.refreshMs).toBeCloseTo(16.67, 2);
    expect(tl.refreshSource).toMatch(/measured/);
    expect(tl.intervals).toMatchObject({missed1: 3, missed2: 1, missed3plus: 0, misses: 4, missedRefreshes: 5});
    expect(tl.overruns).toEqual({count: 2, withIntervalMiss: 1, withoutIntervalMiss: 1});
    expect(tl.stallEvents).toMatchObject({count: 5, intervalMissOnly: 3, overrunOnly: 1, both: 1});
    // the schema-1 distribution counts intervals strictly over 1000 / 30 ms: it misses the exact (33.333), rounded (33.3) and
    // 33.33 ms one-refresh misses alike — only the 50 ms interval is 'over 33.3'; the tail counts all four
    expect(r.summary.gameplay.interval.over['33.3']).toBe(1);
    const minutes = tl.timeMs / 60000;
    expect(tl.stallEvents.perMinute).toBeCloseTo(5 / minutes, 1);
    expect(tl.worstWindows['1s'].events).toBe(2);
    expect(tl.worstWindows['5s'].events).toBe(5);
    expect(tl.intervals.max).toBe(50);
    // the spike detail now also keeps the one-refresh misses and the overruns (nested spans for attribution)
    expect(r.spikeDetail.note).toMatch(/1\.5 refreshes/);
  });

  it('without a measured display rate uses the median interval; a 30 Hz display does not flag its normal 33.3 ms frames; 144 Hz works', () => {
    const r = parse(capture(ivs, cpu));
    expect(r.summary.tail.refreshSource).toMatch(/median/);
    expect(r.summary.tail.intervals.misses).toBe(4);
    const lo = parse(capture(Array.from({length: 120}, (_, k) => (k === 60 ? 66.7 : 33.33)), () => 9), meta({refresh: {hz: 30, measured: true}}));
    expect(lo.summary.tail.intervals).toMatchObject({onTime: 119, missed1: 1, misses: 1});
    expect(lo.summary.tail.overruns.count).toBe(0); // 9 ms CPU is inside a 33.3 ms refresh
    const hi = parse(capture(Array.from({length: 400}, (_, k) => (k === 99 ? 1000 / 72 : 1000 / 144)), () => 3), meta({refresh: {hz: 144, measured: true}}));
    expect(hi.summary.tail.intervals).toMatchObject({missed1: 1, misses: 1});
    // menus / pause / hidden gaps are not gameplay: a 500 ms paused interval is not a stall
    const c = new PerfCapture();
    c.start(0);
    const i = new FrameInput();
    for (let k = 0; k < 60; k++) { i.time += k === 30 ? 500 : HZ60; i.cpuMs = 4; i.state = k === 29 ? 1 : 0; i.flags = F.rendered; c.frame(i, null); }
    c.stop(i.time + 20, 'manual');
    expect(parse(c).summary.tail.intervals.misses).toBe(0);
  });
});

// --- the controller (hooks) with a fake game and a fake asynchronous GPU queue ---------------------------------------------------

class FakeGame {
  state = 'playing'; warming = false;
  frameCpu = {updateMs: 1, renderMs: 2, deferredMs: 0, rendered: true};
  prof = new UpdateProfiler(8);
  renderer: Record<string, unknown> = {initialized: true, getPixelRatio: () => 1,
    info: {frame: 0, render: {drawCalls: 10, frameCalls: 3, triangles: 100}, memory: {textures: 1, geometries: 1, programs: 1}}};
  canvas = {width: 800, height: 450}; settings = {quality: 'high', renderScale: 1, fov: 75}; gpu = null;
  player = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0}; zombies: unknown[] = []; seed = 1; run = {current: {level: 'office', section: 'main'}};
  stateListeners: ((s: string, p: string) => void)[] = [];
  flashlight: {visible: boolean; intensity: number; castShadow: boolean; shadow: {autoUpdate: boolean}} | undefined = {visible: true, intensity: 0, castShadow: true, shadow: {autoUpdate: false}};
}
const asGame = (g: FakeGame) => g as unknown as RecorderGame;

/** A queue whose onSubmittedWorkDone() promises settle only when the test says (in any order). */
function fakeQueue() {
  const calls: {resolve: () => void; reject: () => void}[] = [];
  return {calls, queue: {onSubmittedWorkDone: () => new Promise<void>((resolve, reject) => { calls.push({resolve, reject: () => reject(new Error('device lost'))}); })}};
}

function controller(g: FakeGame, extra: Record<string, unknown> = {}) {
  const clock = {t: 1000};
  const ctl = new PerfRecorderController(asGame(g), {yieldFn: () => Promise.resolve(), observer: null, loadingManager: null, doc: null, win: null, origin: 'https://game.example',
    now: () => clock.t, caps: {queueOutstanding: 4}, ...extra});
  /** One frame: rAF at clock.t, the callback 0.5 ms later, cpu 6 ms. */
  const frame = () => { const rafT = clock.t; ctl.frame(rafT, 6, rafT + 0.5); clock.t += HZ60; };
  return {ctl, clock, frame};
}

describe('GPU-queue completion probe (queueMs / queueDone / queueState)', () => {
  it('one probe per drawn frame, never awaited; resolutions in any order land on their own frame; the in-flight cap; a rejection', async () => {
    const g = new FakeGame(), q = fakeQueue();
    const {ctl, clock, frame} = controller(g, {queue: q.queue});
    ctl.start('qa');
    for (let k = 0; k < 6; k++) frame(); // 4 probes in flight (the cap), frames 4 and 5 capped
    expect(q.calls).toHaveLength(4);
    clock.t += 3;
    q.calls[2].resolve(); await flush(); // out of order: frame 2 first
    clock.t += 2;
    q.calls[0].resolve(); await flush();
    q.calls[1].reject(); await flush();
    frame(); frame(); // two in flight again (3 and 6): frames 6, 7 probed
    expect(q.calls).toHaveLength(6);
    q.calls[4].resolve(); await flush();
    await ctl.stop('manual', 'qa'); // frames 3 and 7 still pending -> cancelled (the report is prepared at stop)
    q.calls[3].resolve(); await flush(); // a late resolution after stop: ignored, never written into the stopped capture
    expect((ctl as unknown as {qStats: {stale: number}}).qStats.stale).toBe(1);
    const r = ctl.reportObject() as any, col = r.frames.columns;
    const states = col.queueState.map((s: number) => QUEUE_STATES[s]);
    expect(states).toEqual(['resolved', 'error', 'resolved', 'cancelled', 'capped', 'capped', 'resolved', 'cancelled']);
    // frame 2: issued at its callback end (rAF 1000 + 2 x 16.67 ... the fake clock), resolved 3 ms after the 6th frame
    expect(col.queueMs[2]).toBe(Math.round((1000 + 6 * HZ60 + 3 - (1000 + 2 * HZ60)) * 100));
    expect(col.queueMs[0]).toBe(Math.round((1000 + 6 * HZ60 + 5 - 1000) * 100));
    expect(col.queueMs[1]).toBeNull(); // rejected
    expect(col.queueMs[4]).toBeNull(); // capped: never issued
    expect(col.queueDone[2]).toBe(Math.round((6 * HZ60 + 3) * 100)); // ms since capture start
    const qp = r.capture.overhead.queueProbe;
    expect(qp).toMatchObject({supported: true, issued: 6, resolved: 3, failed: 1, capped: 2, staleIgnored: 0, inFlightNow: 2});
    expect(qp.frameStates).toMatchObject({resolved: 3, error: 1, capped: 2, cancelled: 2, pending: 0});
    const cap = Object.fromEntries((r.capabilities as any[]).map(c => [c.id, c]));
    expect(cap['gpu.queueCompletion'].available).toBe(true);
    expect(cap['gpu.queueCompletion'].note).toMatch(/ON THE MAIN THREAD/);
    expect(cap['frame.callbackStart'].available).toBe(true);
    expect(r.summary.tail.queue.all.n).toBe(3);
  });

  it('a new capture never receives an older capture\'s resolution; frame() returns synchronously even if the GPU never answers', async () => {
    const g = new FakeGame(), q = fakeQueue();
    const {ctl, frame} = controller(g, {queue: q.queue});
    ctl.start('qa');
    frame(); frame();
    await ctl.stop('manual', 'qa');
    ctl.start('qa'); // the two old probes are still in flight (they count toward the cap)
    frame(); frame(); frame();
    expect(q.calls).toHaveLength(4); // 2 old + 2 new (cap 4), the third new frame capped
    q.calls[0].resolve(); q.calls[1].resolve(); await flush(); // old capture's: ignored
    await ctl.stop('manual', 'qa');
    const r = ctl.reportObject() as any;
    expect(r.frames.columns.queueState.map((s: number) => QUEUE_STATES[s])).toEqual(['cancelled', 'cancelled', 'capped']);
    expect(r.capture.overhead.queueProbe).toMatchObject({issued: 2, capped: 1, staleIgnored: 2, inFlightNow: 2});
  });

  it('unsupported backends: no probe, every queue column null, the capability says why', async () => {
    const g = new FakeGame(); // (renderer without a WebGPU backend: the WebGL 2 fallback / Node)
    const {ctl, frame} = controller(g);
    ctl.start('qa');
    for (let k = 0; k < 5; k++) frame();
    await ctl.stop('manual', 'qa');
    const r = ctl.reportObject() as any;
    expect(r.frames.columns.queueMs.every((v: unknown) => v === null)).toBe(true);
    expect(r.frames.columns.queueState.every((v: number) => v === 0)).toBe(true);
    const cap = Object.fromEntries((r.capabilities as any[]).map(c => [c.id, c]));
    expect(cap['gpu.queueCompletion']).toMatchObject({available: false});
    expect(cap['gpu.queueCompletion'].source).toMatch(/not the WebGPU backend/);
    expect(r.summary.tail.queue).toBeNull();
    // a WebGPU backend whose device has the queue: found without injection (the renderer's own device; nothing else created)
    const g2 = new FakeGame(), q2 = fakeQueue();
    g2.renderer.backend = {isWebGPUBackend: true, device: {queue: q2.queue}};
    const c2 = controller(g2);
    c2.ctl.start('qa');
    c2.frame();
    expect(q2.calls).toHaveLength(1);
    await c2.ctl.stop('manual', 'qa');
  });
});

describe('flashlight flags (frames.flagBits torchLit / torchShadow)', () => {
  it('lit = visible with intensity; shadow = castShadow and its shadow map updating this frame', async () => {
    const g = new FakeGame();
    const {ctl, frame} = controller(g);
    ctl.start('qa');
    frame(); // dark
    g.flashlight!.intensity = 1.2; frame(); // lit, shadow map not updating
    g.flashlight!.shadow.autoUpdate = true; frame(); // lit + shadow pass
    g.flashlight!.visible = false; frame(); // hidden
    await ctl.stop('manual', 'qa');
    const fl = (ctl.reportObject() as any).frames.columns.flags as number[];
    expect(fl.map(f => [(f & F.torchLit) !== 0, (f & F.torchShadow) !== 0])).toEqual([[false, false], [true, false], [true, true], [false, false]]);
  });
});

// --- span registry and the real hit path -------------------------------------------------------------------------------------

describe('shot / hit spans (debug/updateProfile.ts)', () => {
  it('appended after the hook slots: every earlier id unchanged; names and parents as nested', () => {
    expect([S.weapon, S.ai, S.path, S.hook0, S.fire, S.alert, SPAN_COUNT]).toEqual([3, 5, 24, 27, 35, 44, 45]);
    expect(NAMES.slice(35)).toEqual(['weapon.fire', 'weapon.melee', 'fire.fx', 'fire.rays', 'hit.world', 'hit.zombie', 'hit.tearChunk', 'hit.extractPatch', 'hit.ragdoll', 'hit.alert']);
    const parent = (id: number) => (PARENT[id] >= 0 ? NAMES[PARENT[id]] : null);
    expect([S.fire, S.melee, S.fireFx, S.fireRays, S.hitWorld, S.hitZombie, S.tearChunk, S.extractPatch, S.ragdoll, S.alert].map(parent))
      .toEqual(['weapon', 'weapon', 'weapon.fire', 'weapon.fire', 'weapon.fire', 'weapon', 'hit.zombie', 'hit.tearChunk', 'weapon', 'weapon']);
    expect([isHookSpan(27), isHookSpan(34), isHookSpan(35)]).toEqual([true, true, false]);
    expect(PARENT[34]).toBe(S.hooks);
  });

  it('source boundaries: Game.fire / meleeContact / alertZombies and the DamageSystem spans are at the real call sites', () => {
    const game = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    expect(game).toMatch(/if \(e\.type === 'fire'\) \{ prof\.begin\(SPAN\.fire\); this\.fire\(e\.def\); prof\.end\(SPAN\.fire\); \}/);
    expect(game).toMatch(/\{ prof\.begin\(SPAN\.melee\); this\.meleeContact\(e\.def\); prof\.end\(SPAN\.melee\); \}/);
    // (task studio-skywalk-variety-20261107-231448-01, lane MERCH: the world ray through physics/merchOnHost.ts raycastShot — raycastWorld,
    // then the shelf stock inside open shelving it passed; one more comment line)
    expect(game).toMatch(/prof\.begin\(SPAN\.fireRays\);\s*\/\/ Lane B[^\n]*\n(\s*\/\/[^\n]*\n)*\s*const wh = raycastShot\(/);
    expect(game).toMatch(/const fh = this\.stock\.pelletHit\([^\n]*\n\s*prof\.end\(SPAN\.fireRays\);/);
    // (task studio-weapon-variety-production-20261109-224355-01: the shot cue may take the gun's shot cycle — no pump rack after a
    // semi-auto / break-action shotgun; the span still opens at the shot sound)
    expect(game).toMatch(/prof\.begin\(SPAN\.fireFx\);\s*this\.sfx\.shot\(def\.sound(, def\.shotCycle)?\);/);
    expect(game).toMatch(/this\.physics\.onFire\([^\n]*\n\s*prof\.end\(SPAN\.fireFx\);/);
    expect((game.match(/prof\.begin\(SPAN\.ragdoll\);\s*this\.physics\.ragdoll\(/g) ?? []).length).toBe(2); // fire + melee kills
    expect(game).toMatch(/private alertZombies\(radius: number\): void \{\s*this\.prof\.begin\(SPAN\.alert\);/);
    expect(game).toMatch(/this\.damage\.prof = this\.prof;/);
    const sys = readFileSync(fileURLToPath(new URL('../src/damage/system.ts', import.meta.url)), 'utf8');
    expect(sys).toMatch(/this\.prof\?\.begin\(SPAN\.extractPatch\);\s*patch = extractPatch\(/);
    expect(sys).toMatch(/this\.prof\?\.begin\(SPAN\.tearChunk\); this\.tearChunk\(/);
  });
});

installCanvasShim(false);
{
  const ctx0 = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document.createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx0) as Record<string, unknown>;
  for (const k of ['clip', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse']) if (typeof proto[k] !== 'function') proto[k] = () => {};
}
const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
async function realZombie(): Promise<GLTF> {
  const io = new NodeIO();
  const doc = await io.read(fileURLToPath(new URL('../public/assets/models/zombie-rigged.glb', import.meta.url)));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
function layout() {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : y >= 24 ? VOID : FLOOR);
  return {grid: g, props: [], trench: {floorY: -1.15}};
}

describe('the real hit path: hit.zombie > hit.tearChunk > hit.extractPatch, outcomes identical with profiling on or off', () => {
  it('a chest shot on a real rigged zombie: the spans nest; wounds / tears / chunks / RNG are the same as without the profiler', async () => {
    const gltf = await realZombie();
    const shoot = (prof: UpdateProfiler | null) => {
      const L = layout();
      const ph = new PhysicsSystem(null);
      ph.build(L as never);
      const sys = new DamageSystem(null, null);
      sys.rand = mulberry(11);
      sys.prof = prof;
      sys.build({...L, areas: [], trenches: [], name: 't', seed: 1} as never, null, [], {physics: ph});
      let seed = 5;
      const z = new ZombieActor(gltf, {x: 8, z: 6, yaw: 0.4, type: 'coated', area: 0}, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
      sys.installZombie(z);
      for (let i = 0; i < 12; i++) { z.animate(1 / 60, 'Run', 2.3); z.syncTransform(); z.updateVolumes(); }
      const fwd = new THREE.Vector3(Math.sin(z.brain.yaw), 0, Math.cos(z.brain.yaw));
      const point = z.bone('Spine')!.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0)).addScaledVector(fwd, 0.22);
      prof?.frameBegin(); prof?.lap(S.weapon);
      sys.beginShot();
      const info = sys.hitZombie(z, point, fwd.clone().negate(), 'torso', {damage: 24, pellet: false, weapon: 'rifle'});
      prof?.frameEnd(true);
      const w = woundsOf(z)!;
      return {counts: {...sys.counts}, hits: w.hits, tears: w.tears, chunks: ph.chunks.stats(), next: sys.rand(), info: JSON.stringify(info)};
    };
    const off = shoot(null);
    const offProf = new UpdateProfiler(4); // present but NOT recording: one boolean check per call, nothing recorded
    const offRec = shoot(offProf);
    expect(offProf.count).toBe(0);
    const prof = new UpdateProfiler(4);
    prof.startRecording();
    const on = shoot(prof);
    expect(on).toEqual(off);
    expect(offRec).toEqual(off);
    expect(off.counts.patches + off.counts.flaps).toBe(1);
    const o = ((prof.head - 1 + prof.capacity) % prof.capacity) * SPAN_COUNT;
    const ms = (id: number) => prof.ms[o + id], calls = (id: number) => prof.calls[o + id];
    expect([calls(S.hitZombie), calls(S.tearChunk)]).toEqual([1, 1]);
    expect(calls(S.extractPatch)).toBeGreaterThanOrEqual(1);
    expect(calls(S.extractPatch)).toBeLessThanOrEqual(3); // the widening attempts
    expect(ms(S.extractPatch)).toBeLessThanOrEqual(ms(S.tearChunk) + 1e-6);
    expect(ms(S.tearChunk)).toBeLessThanOrEqual(ms(S.hitZombie) + 1e-6);
    expect(ms(S.hitZombie)).toBeLessThanOrEqual(ms(S.weapon) + 1e-6);
    const rep = prof.report();
    expect(rep.spans.map(s => s.name)).toEqual(expect.arrayContaining(['hit.zombie', 'hit.tearChunk', 'hit.extractPatch']));
    expect(rep.spans.map(s => s.name)).not.toContain('hit.ragdoll'); // never ran: not listed
  }, 120_000);
});

// --- first-use identity ----------------------------------------------------------------------------------------------------------

describe('first-use identity (summary.firstUse.builds): sanitized labels, bounded, the most expensive kept', () => {
  it('labels: own name, else the nearest named ancestor; shadow passes name the caster material; URLs / paths never leak', () => {
    expect(safeLabel('prop-foldingBarricade')).toBe('prop-foldingBarricade');
    expect(safeLabel('arch-tileLower@0:0,1')).toBe('arch-tileLower@0:0,1');
    expect(safeLabel('https://host/a/b.glb?sig=SECRET')).toBeNull();
    expect(safeLabel('blob:abc')).toBeNull();
    expect(safeLabel('/home/someone/private/thing.png')).toBe('thing.png');
    expect(safeLabel('C:\\Users\\me\\x.glb')).toBe('x.glb');
    expect(safeLabel('weird name<script>')).toBe('weird_name_script_');
    expect(safeLabel('x'.repeat(100))).toHaveLength(48);
    expect(safeLabel('')).toBeNull();
    const mat = new THREE.MeshStandardMaterial({name: 'p7-folding-barricade-t25-baked'});
    const grp = new THREE.Group(); grp.name = 'container-body-staffLockers';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat); grp.add(mesh);
    expect(firstUseIdentity({object: mesh}, mat)).toEqual({object: 'container-body-staffLockers', via: 'ancestor', objectType: 'Mesh', material: 'p7-folding-barricade-t25-baked',
      materialType: 'MeshStandardMaterial', objectMaterial: null, shadowPass: false});
    const shadow = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {isShadowPassMaterial?: boolean};
    shadow.isShadowPassMaterial = true;
    mesh.name = 'prop-light';
    expect(firstUseIdentity({object: mesh}, shadow)).toMatchObject({object: 'prop-light', via: 'self', objectMaterial: 'p7-folding-barricade-t25-baked', shadowPass: true});
    expect(firstUseIdentity(null, null)).toEqual({object: null, via: null, objectType: null, material: null, materialType: null, objectMaterial: null, shadowPass: false});
  });

  it('the capture keeps the most expensive builds (bounded), lists them in time order and on their frame\'s worst-frame detail', () => {
    const c = new PerfCapture({firstUseBuilds: 3});
    c.start(0);
    const i = new FrameInput();
    const id = (n: string) => ({object: n, via: 'self' as const, objectType: 'Mesh', material: `${n}-mat`, materialType: 'MeshStandardMaterial', objectMaterial: null, shadowPass: false});
    for (let k = 0; k < 40; k++) {
      if (k === 10) { c.firstUseBuild(200, 7.7, id('a')); c.firstUseBuild(201, 1.0, id('b')); }
      if (k === 20) c.firstUseBuild(400, 6.1, id('c'));
      if (k === 30) c.firstUseBuild(600, 5.5, id('d'));
      i.time += HZ60; i.cpuMs = k === 10 ? 19 : 6; i.state = 0; i.flags = F.rendered; i.fuOn = true; i.nodeBuilds = k === 10 ? 2 : k === 20 || k === 30 ? 1 : 0;
      c.frame(i, null);
    }
    c.stop(i.time + 20, 'manual');
    const r = parse(c);
    const b = r.summary.firstUse.builds;
    expect([b.seen, b.kept, b.dropped]).toEqual([4, 3, 1]);
    expect(b.list.map((e: any) => [e.object, e.frame])).toEqual([['a', 10], ['c', 20], ['d', 30]]); // 'b' (1 ms) dropped
    const w = r.worst.gameplayByCpu.find((f: any) => f.frame === 10);
    expect(w.firstUse.builds).toEqual([{ms: 7.7, object: 'a', objectType: 'Mesh', material: 'a-mat', materialType: 'MeshStandardMaterial', objectMaterial: null, shadowPass: false}]);
    expect(r.capture.drops.firstUseBuilds).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/https?:|blob:/);
  });
});
