// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): the Enhanced-lighting bake's WORKERS — the gather
// (world/lightFieldGather.ts) and the reflection probes (world/reflectionProbes.ts) off the main thread (world/lightBakePool.ts,
// world/lightBakeTasks.ts, world/lightBakeWorker.ts; world/enhancedLightingRuntime.ts bakeSteps `offThread`).
// - HOW MANY: min(cores - 1, 3), one on a machine that reports 4 GB or less, none without Workers — and that number is all the
//   machine decides;
// - THE SAME BYTES: on a real generated station (Subway, what its builder drew), Standard and High, real worker threads running the
//   worker's own bundled script give the field with its cube, the cached rows, the probe atlas, meta and grid, the digests, the
//   cache key and the record of the bake on one thread — for 1, 2 and 3 workers; the parts of both bakes, split over 1, 2 and 3
//   workers on a station of three levels, give the rows and the probes of one pass, value for value;
// - WHAT STAYS HERE: the digests and the cache key are made on the calling thread from the inputs, before a worker starts (the
//   same key and digests whatever the workers do);
// - NEVER SILENT: no worker, a worker that cannot start, fails, answers something else or stops answering, a part that stops
//   answering, a station past the memory bound — the bake is made on the calling thread, is the same bake, is cached once, says why
//   (timings.bake, status().bake, the one-line status, a console warning) and leaves no worker behind;
// - BOUNDED: the memory bound takes workers away before it takes all of them; a bake's workers are gone when it ends;
// - CANCELLABLE: a build abandoned while it waits for its workers (the station was replaced, the device lost, the choice changed)
//   terminates them, records and caches nothing, and the next bake is whole; a synchronous drain of a build that would wait fails
//   loudly and leaves no worker behind;
// - TRUTHFUL: the stage labels are the lead worker's own, in the order of the bake on one thread;
// - the worker's script: one classic script without renderer code, without a URL and without a root path in it (the release
//   check reads the inlined script as one string of the bundle); game.ts hands the bake `offThread` only where the drain can wait.
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {bakeWorkerScript, sameThreadWorkers, threadWorkers} from './helpers/bakeWorkers';
import {FakeIndexedDb} from './helpers/fakeIndexedDb';
import {FIX as RFIX, levelFixture as renderFixture} from './helpers/levelRenderFixture';
import {layoutFor, materialsFor, modelsFor} from './helpers/pacedBuildFixture';
import {openDerivedCache, type DerivedBundle} from '../src/core/derivedCache';
import {PacedBuildCancelled, drainSync, newPacedStats, runPaced, runSliced, type BuildSteps, type PacedBuildStats} from '../src/core/pacedBuild';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import {buildWorldSteps} from '../src/world/builder';
import {GI_TIERS, REFLECTION_TIERS, enhancedLightingLine, type GiTier, type LightingCapabilities} from '../src/world/enhancedLighting';
import {EnhancedLightingRuntime, type EnhancedBake, type EnhancedLightingSettings, type StationBakeInput} from '../src/world/enhancedLightingRuntime';
import {
  BakeWorkersFailed, LIGHT_BAKE_POOL, LightBakeSession, bakeWorkerCount, gatherWorkersBytes, probeWorkersBytes, type BakeWorker, type LightBakeWorkers,
} from '../src/world/lightBakePool';
import {bakeShares} from '../src/world/lightBakeTasks';
import {DEFAULT_FIELD, bakeLightFieldSteps, type BakedField, type FieldSource} from '../src/world/lightField';
import {GATHER_REACH, GATHER_TUNING, gatherIndirectSteps, type GatherOptions, type IndirectContext, type IndirectLight} from '../src/world/lightFieldGather';
import {stationBakeInput} from '../src/world/lights';
import {bakeReflectionProbesSteps, probeSource, type BakedProbes, type ProbeBakeInput} from '../src/world/reflectionProbes';
import {surfaceAlbedoSteps, type DrawnSurfaces, type SurfaceAlbedo} from '../src/world/surfaceAlbedo';

const HW: LightingCapabilities = {backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
const same = (a: ArrayBufferView, b: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const tick = () => new Promise<void>(r => setImmediate(r));
/** A turn of the event loop that lets timers and other ports' messages in (Node hands one port its whole queue first). */
const TURN = {turn: (go: () => void) => { setTimeout(go, 0); }};

/** A station of three levels (80 x 50 cells: an upper deck and a crossing below the main level). */
function threeLevels(): StationBakeInput {
  const {layout, levels} = renderFixture();
  return {source: {grid: layout.grid, lights: layout.lights, trenchFloorY: RFIX.bedY, levels}, params: {...DEFAULT_FIELD}, reactor: false, extra: ''};
}
/** A small two-room station: a dividing wall with a door, two fixtures. */
function rooms(): StationBakeInput {
  const g = new Grid(48, 28);
  for (let y = 1; y < 27; y++) for (let x = 1; x < 47; x++) { g.set(x, y, FLOOR); g.ceil[y * 48 + x] = 4.4; g.area[y * 48 + x] = x < 24 ? 0 : 1; }
  for (let y = 0; y < 28; y++) if (y < 11 || y > 15) g.set(24, y, SOLID);
  const light = (x: number, z: number) => ({x, y: 4.35, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false});
  const source: FieldSource = {grid: g, lights: [light(6, 7), light(18, 7)], trenchFloorY: -1.15};
  return {source, params: {...DEFAULT_FIELD}, reactor: false, extra: ''};
}
const paint = (hex: number): DrawnSurfaces => ({
  keys: ['paint'], floors: [0, 0.5, 0.5, 23.5, 13.5, 0, 0], ceils: [], faces: [],
  material: () => ({color: new THREE.Color(hex), userData: {}}) as never,
});

interface Rt { rt: EnhancedLightingRuntime; puts: {key: string; bundle: DerivedBundle}[] }
function runtime(settings: EnhancedLightingSettings, workers: LightBakeWorkers | null): Rt {
  const puts: Rt['puts'] = [];
  const rt = new EnhancedLightingRuntime(settings, {bakeWorkers: workers, openCache: () => {
    const c = openDerivedCache({indexedDB: new FakeIndexedDb(), compress: false}), put = c.put.bind(c);
    (c as {put: typeof c.put}).put = (key, bundle, tag) => { puts.push({key, bundle}); return put(key, bundle, tag); };
    return c;
  }});
  rt.setCapabilities(HW);
  return {rt, puts};
}
/** Wait for the runtime's fire-and-forget cache writes. */
async function settle(r: Rt, puts: number): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    const s = await r.rt.cacheStats();
    if (s && s.puts + s.failedPuts >= puts) return;
    await tick();
  }
  throw new Error('the cache write did not finish');
}
interface Load extends Rt { out: EnhancedBake; stats: PacedBuildStats; labels: string[] }
/** One station load: the prefetch, then the bake — on the calling thread (`workers` null: the synchronous drain) or with workers (a drain that can wait). */
async function load(settings: EnhancedLightingSettings, input: StationBakeInput, drawn: DrawnSurfaces | null, workers: LightBakeWorkers | null, r: Rt = runtime(settings, workers)): Promise<Load> {
  await r.rt.prefetch(input);
  const stats = newPacedStats(), labels: string[] = [], before = r.puts.length;
  const labelled = function* (steps: BuildSteps<EnhancedBake>): BuildSteps<EnhancedBake> {
    for (;;) { const s = steps.next(); if (s.done) return s.value; if (typeof s.value === 'string') labels.push(s.value); yield s.value; }
  };
  const out = workers ? await runSliced(labelled(r.rt.bakeSteps(input, drawn, {max3DTextureSize: 2048, offThread: true})), {...TURN, stats})
    : drainSync(labelled(r.rt.bakeSteps(input, drawn, {max3DTextureSize: 2048})));
  await settle(r, before + 1);
  return {...r, out, stats, labels};
}
const noTime = <T extends object>(s: T): Partial<T> => { const {ms: _ms, traceMs: _trace, giMs: _gi, probeMs: _probe, ...rest} = s as Record<string, unknown>; return rest as Partial<T>; };
interface Meta { gi: {inputs: string; stats: IndirectLight['stats']}; rp: ({inputs: string; stats: BakedProbes['stats']} & Record<string, unknown>) | null }
/** Everything a load made is what `ref` made: the field, the probes, what went to the cache (and under which key), the record. */
function expectSameLoad(a: Load, ref: Load, what: string): void {
  const put = a.puts[a.puts.length - 1], rput = ref.puts[ref.puts.length - 1], m = put.bundle.meta as unknown as Meta, rm = rput.bundle.meta as unknown as Meta;
  expect([put.key, m.gi.inputs, m.rp?.inputs], `${what}: the cache key and the digests`).toEqual([rput.key, rm.gi.inputs, rm.rp?.inputs]);
  expect(noTime(m.gi.stats), `${what}: the gather's counts`).toEqual(noTime(rm.gi.stats));
  expect(same(put.bundle.arrays.gi, rput.bundle.arrays.gi), `${what}: the cached rows`).toBe(true);
  const f = a.out.baked!, rf = ref.out.baked!;
  expect(same(f.data, rf.data), `${what}: the field with its cube`).toBe(true);
  expect(same(f.groups, rf.groups), `${what}: the flicker groups`).toBe(true);
  expect(!!f.slotY && !!rf.slotY && same(f.slotY, rf.slotY) || (!f.slotY && !rf.slotY), `${what}: the slots' heights`).toBe(true);
  // (everything else of the field but its clock readings)
  const facts = (b: BakedField) => { const st = b.stats as unknown as Record<string, unknown> & {indirect?: object}; return {...b, data: 0, groups: 0, slotY: 0, stats: {...noTime(st), indirect: st.indirect ? noTime(st.indirect) : null}}; };
  expect(facts(f), `${what}: the field's layout and counts`).toEqual(facts(rf));
  const p = a.out.probes, rp = ref.out.probes;
  expect(!!p, `${what}: probes`).toBe(!!rp);
  if (p && rp) {
    expect(same(p.atlas, rp.atlas), `${what}: the probe atlas`).toBe(true);
    expect(same(p.meta, rp.meta), `${what}: the probe meta`).toBe(true);
    expect(same(p.grid, rp.grid), `${what}: the probe grid`).toBe(true);
    expect({...p, atlas: 0, meta: 0, grid: 0, stats: noTime(p.stats)}).toEqual({...rp, atlas: 0, meta: 0, grid: 0, stats: noTime(rp.stats)});
    expect(same(put.bundle.arrays.atlas, rput.bundle.arrays.atlas) && same(put.bundle.arrays.pmeta, rput.bundle.arrays.pmeta) && same(put.bundle.arrays.grid, rput.bundle.arrays.grid), `${what}: the cached probes`).toBe(true);
    expect(noTime(m.rp!.stats)).toEqual(noTime(rm.rp!.stats));
  }
  expect({shading: a.out.shading, mirror: a.out.mirror, bounce: !!a.out.bounce}).toEqual({shading: ref.out.shading, mirror: ref.out.mirror, bounce: !!ref.out.bounce});
  expect(noTime(a.rt.status().active!), `${what}: the record`).toEqual(noTime(ref.rt.status().active!));
}
const mb = (bytes: number): string => (bytes / 1e6).toFixed(1);

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------
describe('how many workers a bake gets', () => {
  it('min(cores - 1, 3); one where the machine reports 4 GB or less; none without Workers; an unknown number counts as one', () => {
    const n = (hardwareConcurrency?: number | null, deviceMemory?: number | null, workers = true) => bakeWorkerCount({workers, hardwareConcurrency, deviceMemory});
    expect([n(1), n(2), n(3), n(4), n(8), n(64)]).toEqual([1, 1, 2, 3, 3, 3]);
    expect([n(8, 8), n(8, 4), n(8, 2), n(8, 0.5), n(2, 8)]).toEqual([3, 1, 1, 1, 1]);
    expect([n(undefined), n(null, null), n(NaN), n(0), n(-4), n(Infinity)]).toEqual([1, 1, 1, 1, 1, 1]);
    expect([n(8, 8, false), n(undefined, undefined, false)]).toEqual([0, 0]);
    expect(LIGHT_BAKE_POOL).toMatchObject({maxWorkers: 3, lowMemoryGb: 4});
  });

  it('the shares of a split: every item once, in order, the lead\'s first; a lighter lead takes less; fewer items than workers leaves shares empty', () => {
    for (const lead of [1, 0.5, 0.25]) {
      for (let parts = 0; parts <= 2; parts++) {
        for (const total of [0, 1, 2, 3, 7, 100, 4181]) {
          const s = bakeShares(total, parts, lead);
          expect(s).toHaveLength(parts + 1);
          expect(s[0][0]).toBe(0);
          expect(s[parts][1]).toBe(total);
          for (let i = 0; i <= parts; i++) { expect(s[i][1]).toBeGreaterThanOrEqual(s[i][0]); if (i) expect(s[i][0]).toBe(s[i - 1][1]); }
        }
      }
    }
    expect(bakeShares(300, 2)).toEqual([[0, 100], [100, 200], [200, 300]]);
    expect(bakeShares(300, 2, 0.5)).toEqual([[0, 60], [60, 180], [180, 300]]);
    expect(bakeShares(300, 0, 0.5)).toEqual([[0, 300]]);
    expect(bakeShares(2, 2)).toEqual([[0, 0], [0, 1], [1, 2]]);
  });

  it('only the host asks the machine: the bake modules never read it (the pool is handed a number)', () => {
    const asks = /deviceMemory|hardwareConcurrency|\bnavigator\b|userAgent/;
    const code = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // (the pool's own bakeWorkerCount is handed the two numbers by name: that function aside, nothing here names them)
    const counted = /export function bakeWorkerCount\(env: \{[^}]*\}\): number \{[^]*?\n\}\n/;
    expect(counted.test(code('world/lightBakePool.ts'))).toBe(true);
    for (const f of ['world/lightBakePool.ts', 'world/lightBakeTasks.ts', 'world/lightBakeWorker.ts', 'world/lightFieldLayout.ts', 'world/enhancedLightingRuntime.ts']) {
      expect(asks.test(code(f).replace(counted, '')), f).toBe(false);
    }
    const main = readFileSync(resolve(SRC, 'main.ts'), 'utf8');
    expect(main).toContain("import LightBakeWorker from './world/lightBakeWorker?worker&inline';");
    expect(main).toContain("const canBakeOffThread = typeof Worker === 'function', bakeWorkersAsked = params.get('bakeworkers');");
    expect(main).toContain('bakeWorkerCount({workers: canBakeOffThread, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: (navigator as {deviceMemory?: number}).deviceMemory});');
    expect(main).toMatch(/game\.enhancedLighting\.setBakeWorkers\(\{count: bakeWorkers, unavailable: [^\n]*, spawn: \(\) => new LightBakeWorker\(\{name: 'light-bake'\}\)\}\);/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the worker\'s script', () => {
  it('is one classic script with no renderer code, no URL and no root path in it', async () => {
    const code = await bakeWorkerScript();
    expect(code.length).toBeGreaterThan(4000);
    expect(code.length, 'no renderer library in the worker').toBeLessThan(80_000);
    expect(/\bimport\b|\bexport\b/.test(code), 'a classic script').toBe(false);
    expect(/WebGPU|WebGL|THREE\b|three\.module/.test(code)).toBe(false);
    // (tools/release/package-ci.mjs reads the inlined script as ONE string of the bundle: no URL anywhere in it)
    expect(/[a-z][a-z0-9+.-]*:\/\//i.test(code), 'no URL').toBe(false);
    expect(/^\s*\/[^\s/*]/.test(code), 'does not start like a root path').toBe(false);
  });

  it('imports no module that imports the renderer (the import graph from world/lightBakeWorker.ts)', () => {
    const seen = new Set<string>(), bad: string[] = [];
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      // value imports only (`import type` and inline `type` specifiers alone are erased; a module with one value specifier is loaded)
      for (const m of text.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)';/gm)) {
        if (m[1]) continue;
        const named = /^\{([^}]*)\}$/.exec(m[2].trim());
        if (named && named[1].split(',').every(s => !s.trim() || s.trim().startsWith('type '))) continue;
        if (!m[3].startsWith('.')) { bad.push(`${file.slice(SRC.length + 1)} -> ${m[3]}`); continue; }
        walk(resolve(dirname(file), `${m[3]}.ts`));
      }
    };
    walk(resolve(SRC, 'world/lightBakeWorker.ts'));
    expect(bad).toEqual([]);
    expect([...seen].map(f => f.slice(SRC.length + 1)).sort()).toEqual([
      'core/pacedBuild.ts', 'gen/grid.ts', 'world/lightBakeTasks.ts', 'world/lightBakeWorker.ts', 'world/lightFieldGather.ts', 'world/lightFieldLayout.ts', 'world/lightScene.ts', 'world/reflectionProbes.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the parts of both bakes over 1, 2 and 3 workers (a station of three levels)', () => {
  const gatherOptions = (tier: GiTier, albedo: SurfaceAlbedo): GatherOptions => ({
    rays: tier.rays, bounces: tier.bounces, stride: tier.stride, reach: GATHER_REACH, gain: GATHER_TUNING.gain, saturation: GATHER_TUNING.saturation,
    ...(GATHER_TUNING.lift > 0 ? {response: {lift: GATHER_TUNING.lift, ceiling: GATHER_TUNING.ceiling}} : {}), albedo,
  });

  it('the gather\'s rows and counts and the probes\' atlas, meta and grid are those of one pass; the stages come in the bake\'s order; the workers are gone afterwards', async () => {
    const input = threeLevels(), src = input.source, levels = src.levels!;
    for (const tier of [GI_TIERS.standard, GI_TIERS.high]) {
      const pools = [1, 2, 3].map(k => sameThreadWorkers(k));
      const got: {ctx: IndirectContext | null; albedo: SurfaceAlbedo | null} = {ctx: null, albedo: null};
      const seen: string[] = [];
      // the gathers run where the bake runs its own: inside the field bake's indirect step, on the very arrays it reads
      const field: BakedField = await runSliced(bakeLightFieldSteps({
        ...src, cube: true,
        indirect: function* (ctx): BuildSteps<IndirectLight> {
          const albedo = yield* surfaceAlbedoSteps(ctx.W, ctx.H, levels, ctx.geos, null);
          got.ctx = ctx; got.albedo = albedo;
          const opt = gatherOptions(tier, albedo);
          const ref = yield* gatherIndirectSteps(ctx, opt);
          for (const pool of pools) {
            const session = new LightBakeSession(pool), labels: string[] = [];
            const steps = session.gatherSteps(ctx, opt);
            let ind: IndirectLight;
            for (;;) { const s = steps.next(); if (s.done) { ind = s.value; break; } if (typeof s.value === 'string') labels.push(s.value); yield s.value; }
            seen.push(`${tier.id} x${pool.count}: ${session.report.workers} workers, ${labels.join(' ')}`);
            expect(same(ind.data, ref.data), `${tier.id}, ${pool.count} workers: the rows`).toBe(true);
            expect(ind.index.length).toBe(ref.index.length);
            ind.index.forEach((ix, s) => { expect(same(ix, ref.index[s]), `${tier.id}, ${pool.count} workers: the index of slot ${s}`).toBe(true); });
            expect(noTime(ind.stats)).toEqual(noTime(ref.stats));
            expect(session.report).toMatchObject({workers: pool.count, fallback: null});
            expect(session.report.copyBytes).toBeGreaterThan(0);
            expect(session.report.memory.lead).toBeGreaterThan(0);
            expect(session.report.memory.part > 0).toBe(pool.count > 1);
            expect([session.live, pool.alive()], 'a session keeps its workers for the bake\'s next part').toEqual([pool.count, pool.count]);
            session.close();
            expect([session.live, pool.alive(), pool.spawned]).toEqual([0, 0, pool.count]);
          }
          return ref;
        },
      }, input.params), TURN);
      const bounces = Array.from({length: tier.bounces - 1}, () => 'gather.bounce').join(' ');
      expect(seen).toEqual([1, 2, 3].map(k => `${tier.id} x${k}: ${k} workers, gather.index gather.trace ${bounces} gather.smooth`));

      for (const rt of [REFLECTION_TIERS.standard, REFLECTION_TIERS.high]) {
        const from: ProbeBakeInput = {field, geos: got.ctx!.geos, levels, albedo: got.albedo!, lights: src.lights};
        const ref = drainSync(bakeReflectionProbesSteps(from, rt));
        expect(ref.count).toBeGreaterThan(3);
        for (const k of [1, 2, 3]) {
          const pool = sameThreadWorkers(k), session = new LightBakeSession(pool), labels: string[] = [];
          const p = await runSliced((function* (): BuildSteps<BakedProbes> {
            const steps = session.probesSteps(from, rt);
            for (;;) { const s = steps.next(); if (s.done) return s.value; if (typeof s.value === 'string') labels.push(s.value); yield s.value; }
          })(), TURN);
          expect(same(p.atlas, ref.atlas) && same(p.meta, ref.meta) && same(p.grid, ref.grid), `${tier.id} field, ${rt.id} probes, ${k} workers`).toBe(true);
          expect({...p, atlas: 0, meta: 0, grid: 0, stats: noTime(p.stats)}).toEqual({...ref, atlas: 0, meta: 0, grid: 0, stats: noTime(ref.stats)});
          expect(labels).toEqual(['probes.place', 'probes.grid', 'probes.capture', 'probes.filter']);
          expect(session.report).toMatchObject({workers: k, fallback: null});
          session.close();
          expect(pool.alive()).toBe(0);
        }
      }
    }
  }, 240_000);

  it('the memory bound takes workers away before it takes all of them, and is an estimate made before one starts', async () => {
    const input = threeLevels(), src = input.source, levels = src.levels!, tier = GI_TIERS.standard;
    let ran = false;
    await runSliced(bakeLightFieldSteps({
      ...src, cube: true,
      indirect: function* (ctx): BuildSteps<IndirectLight> {
        const albedo = yield* surfaceAlbedoSteps(ctx.W, ctx.H, levels, ctx.geos, null), opt = gatherOptions(tier, albedo);
        const ref = yield* gatherIndirectSteps(ctx, opt);
        const need = [1, 2, 3].map(k => gatherWorkersBytes(ctx, opt, k));
        expect(need[0]).toBeGreaterThan(0);
        expect(need[1]).toBeGreaterThan(need[0]);
        expect(need[2]).toBeGreaterThan(need[1]);
        // room for two: the third worker is never started
        const two = sameThreadWorkers(3, {maxExtraBytes: need[1]}), s2 = new LightBakeSession(two);
        const ind = yield* s2.gatherSteps(ctx, opt);
        expect(same(ind.data, ref.data)).toBe(true);
        expect([s2.report.workers, two.spawned]).toEqual([2, 2]);
        // (what the workers really held is of the size that was estimated)
        expect(s2.report.memory.lead + s2.report.memory.part).toBeLessThan(need[1] + ref.data.byteLength * 6);
        s2.close();
        // room for none: no worker is started, the session says why and stays failed
        const none = sameThreadWorkers(3, {maxExtraBytes: need[0] - 1}), s0 = new LightBakeSession(none);
        let err: unknown = null;
        try { yield* s0.gatherSteps(ctx, opt); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(BakeWorkersFailed);
        expect(String((err as Error).message)).toMatch(/^the gather's worker copy of this station \(\d+ MB\) is past the \d+ MB bound$/);
        expect([none.spawned, s0.failure, s0.report.fallback]).toEqual([0, (err as Error).message, (err as Error).message]);
        ran = true;
        return ref;
      },
    }, input.params), TURN);
    expect(ran).toBe(true);
    // the game's own bound is far above what its largest stations need on three workers (the numbers the docs state)
    expect(LIGHT_BAKE_POOL.maxExtraBytes).toBe(512e6);
    const from = probeSource({field: {w: 8, h: 8, data: new Uint8Array(8 * 8 * 4 * 6)} as never, geos: [], levels: [], albedo: {slots: []} as never, lights: []}, REFLECTION_TIERS.high);
    expect(probeWorkersBytes(from, REFLECTION_TIERS.high, 3)).toBeGreaterThan(probeWorkersBytes(from, REFLECTION_TIERS.high, 1));
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
describe('a real generated station on real worker threads: the bytes of the bake on one thread', async () => {
  let input: StationBakeInput, drawn: DrawnSurfaces | null;
  beforeAll(async () => {
    const layout = layoutFor('subway', 4242);
    const models = await modelsFor('subway', layout);
    dropUnloadedP7(layout, new Set(p7ModelKeysFor(layout).filter(k => models.lazy[k])));
    const world = drainSync(buildWorldSteps(layout, materialsFor(models), models.all));
    input = stationBakeInput(layout);
    drawn = world.drawn ?? null;
  }, 120_000);

  for (const [name, settings] of [['Auto + Standard', {}], ['On + High reflections High', {enhancedLighting: 'on', reflections: 'high'}]] as [string, EnhancedLightingSettings][]) {
    it(`${name}: 1, 2 and 3 workers`, async () => {
      const ref = await load(settings, input, drawn, null);
      expect(ref.rt.timings!.bake).toEqual({workers: 0, fallback: null, startMs: 0, copyMs: 0, copyBytes: 0, memory: {lead: 0, part: 0}});
      expect(ref.rt.status().bake).toEqual({workers: 0, fallback: null});
      expect(ref.out.probes!.count).toBeGreaterThan(100);
      const lines = [`in process: gather ${ref.rt.timings!.giMs.toFixed(0)} ms, probes ${ref.rt.timings!.probeMs.toFixed(0)} ms, bake ${ref.rt.timings!.totalMs.toFixed(0)} ms (all on the calling thread)`];
      for (const k of [1, 2, 3]) {
        const pool = await threadWorkers(k);
        const a = await load(settings, input, drawn, pool);
        expectSameLoad(a, ref, `${name}, ${k} workers`);
        const t = a.rt.timings!, b = t.bake!;
        expect(b).toMatchObject({workers: k, fallback: null});
        expect(a.rt.status().bake).toEqual({workers: k, fallback: null});
        expect(enhancedLightingLine(a.rt.status())).toBe(enhancedLightingLine(ref.rt.status()));
        expect([pool.spawned, pool.alive()], 'one set of workers for the gather and the probes, gone when the bake ends').toEqual([k, 0]);
        expect(a.puts.length).toBe(1);
        // the calling thread waited for the workers instead of working: the bake's two long parts are parked time
        expect(a.stats.parks).toBeGreaterThan(0);
        expect(a.stats.parkedMs).toBeGreaterThan(0);
        expect(b.memory.lead + 2 * b.memory.part, 'the workers\' typed arrays stay under the bound').toBeLessThan(LIGHT_BAKE_POOL.maxExtraBytes + 400e6);
        const onThread = (prefix: string) => Object.entries(a.stats.stages).filter(([s]) => s.startsWith(prefix)).reduce((sum, [, ms]) => sum + ms, 0);
        lines.push(`${k} worker${k > 1 ? 's' : ''}: gather ${t.giMs.toFixed(0)} ms, probes ${t.probeMs.toFixed(0)} ms, bake ${t.totalMs.toFixed(0)} ms; calling thread ${a.stats.workMs.toFixed(0)} ms (gather.* ${onThread('gather').toFixed(0)}, probes.* ${onThread('probes').toFixed(0)}), parked ${a.stats.parkedMs.toFixed(0)} ms;`
          + ` start ${b.startMs.toFixed(1)} ms, copy ${mb(b.copyBytes)} MB in ${b.copyMs.toFixed(1)} ms; held: lead ${mb(b.memory.lead)} MB, a part ${mb(b.memory.part)} MB`
          + `\n      waited, by the workers' stage: ${Object.entries(a.stats.parked).map(([s, ms]) => `${s} ${ms.toFixed(0)}`).join(', ')}`);
      }
      console.log(`light-bake-workers (Subway 4242, ${name}; Node worker threads):\n  ${lines.join('\n  ')}`);
    }, 300_000);
  }
});

// ---------------------------------------------------------------------------------------------
describe('never silent: when the workers cannot make it, the calling thread does, and says why', async () => {
  const settings: EnhancedLightingSettings = {enhancedLighting: 'on', reflections: 'standard'};
  const input = rooms(), drawn = paint(0x7a2a1c);
  const ref = await load(settings, input, drawn, null);
  /** A worker that takes everything and never says a word. */
  const mute = (ended: {n: number}): BakeWorker => ({postMessage: () => {}, terminate: () => { ended.n++; }, onmessage: null, onerror: null, onmessageerror: null});
  /** The bake fell back (for the reason), is `ref`'s bake, was cached once and left no worker. */
  const expectFallback = (a: Load, reason: RegExp, workers: number, warn: ReturnType<typeof vi.spyOn>, warnings: number) => {
    expectSameLoad(a, ref, String(reason));
    const b = a.rt.timings!.bake!;
    expect(b.fallback).toMatch(reason);
    expect(b.workers).toBe(workers);
    expect(a.rt.status().bake).toEqual({workers, fallback: b.fallback});
    expect(enhancedLightingLine(a.rt.status())).toBe(`${enhancedLightingLine(ref.rt.status())} · baked on the main thread (${b.fallback})`);
    expect(a.puts.length, 'cached once').toBe(1);
    expect((warn.mock.calls as unknown[][]).filter(c => String(c[0]).startsWith('enhanced lighting: the ')).length).toBe(warnings);
  };

  it('the reference: without workers the status carries no note', () => {
    expect(ref.rt.status().bake).toEqual({workers: 0, fallback: null});
    expect(enhancedLightingLine(ref.rt.status())).not.toContain('main thread');
    expect(ref.out.probes!.count).toBeGreaterThan(0);
  });

  it('with workers (in this thread\'s stand-ins): the same bake, no note', async () => {
    const pool = sameThreadWorkers(3);
    const a = await load(settings, input, drawn, pool);
    expectSameLoad(a, ref, 'three workers');
    expect(a.rt.timings!.bake).toMatchObject({workers: 3, fallback: null});
    expect([pool.spawned, pool.alive()]).toEqual([3, 0]);
    expect(a.labels.filter(l => l.startsWith('gather') || l.startsWith('probes'))).toEqual(ref.labels.filter(l => l.startsWith('gather') || l.startsWith('probes')));
  });

  it('no Worker in this browser (a pool of none): baked here, with the host\'s reason; nothing is started', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let spawned = 0;
    const a = await load(settings, input, drawn, {count: 0, unavailable: 'this browser has no Workers', spawn: () => { spawned++; throw new Error('never'); }});
    expectFallback(a, /^this browser has no Workers$/, 0, warn, 0);
    expect(spawned).toBe(0);
    const b = await load(settings, input, drawn, {count: 0, spawn: () => { throw new Error('never'); }});
    expectFallback(b, /^no bake worker is available$/, 0, warn, 0);
  });

  it('a worker that cannot be started: the ones already started are terminated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inner = sameThreadWorkers(3);
    let n = 0;
    const a = await load(settings, input, drawn, {count: 3, spawn: () => { if (++n === 2) throw new Error('blocked by the content security policy'); return inner.spawn(); }});
    expectFallback(a, /^the bake workers could not be started \(blocked by the content security policy\)$/, 0, warn, 1);
    expect([inner.spawned, inner.alive()]).toEqual([1, 0]);
    expect(n, 'not tried again for the probes of the same bake').toBe(2);
  });

  it('a worker that fails while it works (its error event)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ended = {n: 0};
    const a = await load(settings, input, drawn, {count: 1, spawn: () => {
      const w = mute(ended);
      w.postMessage = message => { if ((message as {op: string}).op === 'gather') setTimeout(() => { w.onerror?.({message: 'out of memory'} as ErrorEvent); }, 5); };
      return w;
    }});
    expectFallback(a, /^a bake worker failed: out of memory$/, 0, warn, 1);
    expect(ended.n).toBe(1);
  });

  it('a job that throws inside the worker is reported by it; the probes after a failed gather are not tried on workers again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inner = sameThreadWorkers(2);
    let jobs = 0;
    const a = await load(settings, input, drawn, {count: 2, spawn: () => {
      const w = inner.spawn(), post = w.postMessage.bind(w);
      // (the gather's job arrives without its columns: the worker's own code throws on it)
      w.postMessage = (message, transfer) => { const m = message as {op: string}; if (m.op === 'gather' || m.op === 'probes') jobs++; post(m.op === 'gather' ? {...m, geos: null} : m, transfer); };
      return w;
    }});
    expectFallback(a, /./, 0, warn, 1);
    expect(a.rt.timings!.bake!.fallback).not.toMatch(/sent nothing/);
    expect([jobs, inner.alive()]).toEqual([1, 0]);
  });

  it('a worker that answers with something else than the rows / the probes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ended = {n: 0};
    const a = await load(settings, input, drawn, {count: 1, spawn: () => {
      const w = mute(ended);
      w.postMessage = message => {
        const m = message as {op: string; id: number};
        if (m.op === 'gather') setTimeout(() => { w.onmessage?.({data: {kind: 'done', id: m.id, result: {data: new Float32Array(3), stats: {}, workers: 1, memory: {lead: 0, part: 0}}}} as MessageEvent); }, 5);
      };
      return w;
    }});
    expectFallback(a, /^the bake workers answered the gather with something else$/, 0, warn, 1);
    expect(ended.n).toBe(1);
  });

  it('a worker that stops answering (a lost message): given up after the limit of quiet time, not before', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ended = {n: 0};
    const t0 = performance.now();
    const a = await load(settings, input, drawn, {count: 1, stallMs: 200, spawn: () => mute(ended)});
    expect(performance.now() - t0).toBeGreaterThan(190);
    expectFallback(a, /^the bake workers sent nothing for 200 ms$/, 0, warn, 1);
    expect(ended.n).toBe(1);
    expect(a.stats.parks, 'the build waited without working').toBeGreaterThan(0);
    expect(LIGHT_BAKE_POOL.stallMs).toBe(20000);
  });

  it('a part that stops answering: the lead cannot finish, the watchdog ends it; the probes fail later than the gather and keep its workers\' rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 1. the gather's part is mute
    const ended = {n: 0}, inner = sameThreadWorkers(2);
    let n = 0;
    const a = await load(settings, input, drawn, {count: 2, stallMs: 300, spawn: () => (++n === 2 ? mute(ended) : inner.spawn())});
    expectFallback(a, /^the bake workers sent nothing for 300 ms$/, 0, warn, 1);
    expect([ended.n, inner.alive()]).toEqual([1, 0]);
    // 2. the gather is made on two workers, then the probes' job is lost: the gather's rows are kept, the probes are baked here
    const pool = sameThreadWorkers(2);
    const b = await load(settings, input, drawn, {count: 2, stallMs: 300, spawn: () => {
      const w = pool.spawn(), post = w.postMessage.bind(w);
      w.postMessage = (message, transfer) => { if ((message as {op: string}).op !== 'probes') post(message, transfer); };
      return w;
    }});
    expectFallback(b, /^the bake workers sent nothing for 300 ms$/, 2, warn, 2);
    expect(pool.alive()).toBe(0);
  });

  it('a station past the memory bound: no worker is started', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = sameThreadWorkers(3, {maxExtraBytes: 1000});
    const a = await load(settings, input, drawn, pool);
    expectFallback(a, /^the gather's worker copy of this station \(\d+ MB\) is past the 0 MB bound$/, 0, warn, 1);
    expect(pool.spawned).toBe(0);
  });

  it('workers that failed are not started again on this page: one wait for the watchdog, not one per station — and every later bake says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ended = {n: 0};
    let spawned = 0;
    const bad: LightBakeWorkers = {count: 2, stallMs: 200, spawn: () => { spawned++; return mute(ended); }};
    const r = runtime(settings, bad);
    const a = await load(settings, input, drawn, bad, r);
    expectFallback(a, /^the bake workers sent nothing for 200 ms$/, 0, warn, 1);
    expect([spawned, ended.n]).toEqual([2, 2]);
    // the next station (the same rooms under another address: nothing of it is cached)
    const next = {...input, extra: 'next'};
    const b = await load(settings, next, drawn, bad, r);
    expect(spawned, 'no worker is started again').toBe(2);
    expect(b.rt.timings!.bake).toMatchObject({workers: 0, fallback: 'the bake workers failed earlier on this page (the bake workers sent nothing for 200 ms)'});
    expect(b.rt.status().bake).toEqual({workers: 0, fallback: b.rt.timings!.bake!.fallback});
    expect(enhancedLightingLine(b.rt.status())).toContain(' · baked on the main thread (the bake workers failed earlier on this page (');
    expect(b.stats.parks, 'and nothing is waited for').toBe(0);
    expect(same(b.out.baked!.data, ref.out.baked!.data) && same(b.out.probes!.atlas, ref.out.probes!.atlas), 'the same bake').toBe(true);
    expect(b.puts.length, 'cached, once each').toBe(2);
    // workers handed in anew (a reload does this) are used again
    const good = sameThreadWorkers(2);
    r.rt.setBakeWorkers(good);
    const c = await load(settings, {...input, extra: 'third'}, drawn, good, r);
    expect(c.rt.timings!.bake).toMatchObject({workers: 2, fallback: null});
    expect([good.spawned, good.alive()]).toEqual([2, 0]);
    expect(same(c.out.baked!.data, ref.out.baked!.data)).toBe(true);
  });

  it('a station past the memory bound says nothing about the workers: the next station that fits is baked on them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = sameThreadWorkers(2, {maxExtraBytes: 1000}), r = runtime(settings, pool);
    const a = await load(settings, input, drawn, pool, r);
    expectFallback(a, /^the gather's worker copy of this station \(\d+ MB\) is past the 0 MB bound$/, 0, warn, 1);
    expect(pool.spawned).toBe(0);
    (pool as LightBakeWorkers).maxExtraBytes = LIGHT_BAKE_POOL.maxExtraBytes; // (the next station is one that fits)
    const b = await load(settings, {...input, extra: 'next'}, drawn, pool, r);
    expect(b.rt.timings!.bake).toMatchObject({workers: 2, fallback: null});
    expect([pool.spawned, pool.alive()]).toEqual([2, 0]);
    expect(same(b.out.baked!.data, ref.out.baked!.data)).toBe(true);
  });

  it('a bake that is not the worker\'s to fail still fails as it did (a bad tier is thrown, not hidden by a fallback)', async () => {
    const pool = sameThreadWorkers(1), session = new LightBakeSession(pool);
    const field = ref.out.baked!;
    expect(() => drainSync(session.probesSteps({field: {...field, cellScale: 2}, geos: [], levels: [], albedo: {slots: []} as never, lights: []}, REFLECTION_TIERS.standard)))
      .toThrow('bakeReflectionProbesSteps: the field must be the full-resolution one');
    expect([session.failure, pool.spawned]).toEqual([null, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('cancellable: a build abandoned while its workers work', async () => {
  const settings: EnhancedLightingSettings = {enhancedLighting: 'on', reflections: 'standard'};
  const input = rooms(), drawn = paint(0x7a2a1c);
  const ref = await load(settings, input, drawn, null);

  for (const [name, drain] of [
    ['the time-sliced drain (the loading screen, the pause menu)', (steps: BuildSteps<EnhancedBake>, alive: () => boolean, stats: PacedBuildStats) => runSliced(steps, {...TURN, alive, stats})],
    ['the frame-paced drain (the journey)', (steps: BuildSteps<EnhancedBake>, alive: () => boolean, stats: PacedBuildStats) => runPaced(steps, {frame: go => { setTimeout(go, 0); }, hidden: () => false, alive, stats})],
  ] as [string, (steps: BuildSteps<EnhancedBake>, alive: () => boolean, stats: PacedBuildStats) => Promise<EnhancedBake>][]) {
    it(`${name}: the workers are terminated, nothing is recorded or cached, and the next bake is whole`, async () => {
      const pool = await threadWorkers(2), r = runtime(settings, pool);
      const before = {active: r.rt.status().active, timings: r.rt.timings};
      await r.rt.prefetch(input);
      // the station is replaced the moment the build first waits for its workers: they have their job and are working on it
      const stats = newPacedStats();
      let seen = -1;
      const alive = () => { if (stats.parks > 0 && seen < 0) seen = pool.alive(); return stats.parks === 0; };
      await expect(drain(r.rt.bakeSteps(input, drawn, {max3DTextureSize: 2048, offThread: true}), alive, stats)).rejects.toBeInstanceOf(PacedBuildCancelled);
      expect(seen, 'the workers were running when the build was abandoned').toBe(2);
      expect([pool.spawned, pool.alive()], 'terminated').toEqual([2, 0]);
      for (let i = 0; i < 20; i++) await tick();
      expect(r.puts.length, 'nothing of the dead bake is cached').toBe(0);
      expect(r.rt.timings, 'no timings of a bake that did not happen').toBe(before.timings);
      expect(before.active).toBeNull();
      // the next bake of the same runtime starts new workers and is the whole bake
      const a = await load(settings, input, drawn, pool, r);
      expectSameLoad(a, ref, 'after a cancelled bake');
      expect(a.rt.timings!.bake).toMatchObject({workers: 2, fallback: null});
      expect([pool.spawned, pool.alive()]).toEqual([4, 0]);
    }, 120_000);
  }

  it('a synchronous drain cannot wait: it fails loudly, leaves no worker behind, and the same call without `offThread` bakes here', async () => {
    const pool = sameThreadWorkers(2), r = runtime(settings, pool);
    await r.rt.prefetch(input);
    expect(() => drainSync(r.rt.bakeSteps(input, drawn, {max3DTextureSize: 2048, offThread: true}))).toThrow(/drainSync: this build waits for work done off this thread/);
    expect([pool.spawned, pool.alive()]).toEqual([2, 0]);
    expect(r.puts.length).toBe(0);
    // (what every synchronous caller does: no `offThread`, so the workers the runtime was handed are not used at all)
    const out = drainSync(r.rt.bakeSteps(input, drawn, {max3DTextureSize: 2048}));
    expect(same(out.baked!.data, ref.out.baked!.data)).toBe(true);
    expect(r.rt.timings!.bake).toEqual({workers: 0, fallback: null, startMs: 0, copyMs: 0, copyBytes: 0, memory: {lead: 0, part: 0}});
    expect(pool.spawned).toBe(2);
  });

  it('a cache hit starts no worker', async () => {
    const pool = sameThreadWorkers(3), r = runtime(settings, pool);
    const first = await load(settings, input, drawn, pool, r);
    expect(first.rt.status().active!.cache).toBe('miss');
    expect(pool.spawned).toBe(3);
    await r.rt.prefetch(input);
    const again = await runSliced(r.rt.bakeSteps(input, drawn, {max3DTextureSize: 2048, offThread: true}), TURN);
    expect(r.rt.status().active!.cache).toBe('hit');
    expect([pool.spawned, r.rt.timings!.bake, r.rt.status().bake]).toEqual([3, null, null]);
    expect(same(again.baked!.data, first.out.baked!.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('game.ts: the bake may wait for workers only where the drain can wait', () => {
  const src = readFileSync(resolve(SRC, 'game.ts'), 'utf8');
  it('the station build hands `offThread` on from its caller: true from the paced and the sliced drain, never from the synchronous one', () => {
    expect(src).toContain('private *buildSectionSteps(key: SectionKey, layout: StationLayout, arrival: Arrival, fresh: boolean, offThread = false): BuildSteps<void> {');
    expect(src).toContain('const enhanced = yield* this.enhancedLighting.bakeSteps(stationBakeInput(this.layout), this.world.drawn, {max3DTextureSize: max3D, offThread});');
    expect(src).toContain('buildSection(key: SectionKey, layout: StationLayout, arrival: Arrival, fresh: boolean): void { drainSync(this.buildSectionSteps(key, layout, arrival, fresh)); }');
    expect(src).toContain('await runPaced(this.buildSectionSteps(key, layout, arrival, fresh, true), {...this.buildPacing, stats, alive: () => gen === this.stationGen});');
    expect(src).toContain('await runSliced(stageLabels(this.buildSectionSteps(key, layout, arrival, fresh, true), started), {...this.slicePacing, stats, alive: () => gen === this.stationGen});');
    expect(src.split('this.buildSectionSteps(').length - 1, 'no other caller').toBe(3);
  });

  it('the pause menu\'s rebuild is always drained by a driver that can wait, and is dropped when the choice changes under it', () => {
    expect(src).toContain('const enhanced = yield* this.enhancedLighting.bakeSteps(input, this.world.drawn, {max3DTextureSize: max3D, offThread: true});');
    expect(src.split('this.relightSteps(').length - 1, 'one caller: runRelight\'s time-sliced drain').toBe(1);
    expect(src.split('.bakeSteps(').length - 1, 'the two bakes of the game').toBe(2);
    const relight = src.slice(src.indexOf('  private async runRelight('), src.indexOf('  private *relightSteps('));
    expect(relight).toContain('const wanted = () => alive() && el.pendingSignature() === signature;');
    expect(relight).toMatch(/await runSliced\(stageLabels\(this\.relightSteps\(input\), [^\n]*\{\.\.\.this\.slicePacing, stats, alive: wanted\}\);/);
  });
});
