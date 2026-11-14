// Task studio-baked-lighting-reflections-20261114-050258-01: the game-side runtime of Enhanced lighting
// (world/enhancedLightingRuntime.ts) — the plan a station is built with, the derived cache and the status.
// - Off and the Reactor: nothing is baked here and the cache is never opened (the caller bakes the baseline, as always);
// - a first load bakes (miss) and stores; the next session's load of the same station is a HIT with byte-identical field and
//   probes and no bake time; a cleared, corrupt or unavailable cache only costs the bake again — the result is the same;
// - an entry is used only when the digest of the REAL inputs matches: other surface colours, another fixture state or other
//   parameters under the same address are 'stale' and baked again (and replaced);
// - the bake never touches the layout, draws no random number and knows nothing of the save;
// - Auto on a software renderer: the enhanced bake without reflections, with the reason; On: both; capability limits are reported;
// - a settings change is 'pending' until a station is next built;
// - the station lighting uses the reflecting light only with usable probes and returns to the plain one without.
import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import * as THREE from 'three';
import {FakeIndexedDb} from './helpers/fakeIndexedDb';
import {layoutFor, materialsFor, modelsFor} from './helpers/pacedBuildFixture';
import {drainSync} from '../src/core/pacedBuild';
import {DERIVED_DB_NAME, openDerivedCache, type DerivedCache} from '../src/core/derivedCache';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import {buildWorldSteps, type BuiltWorld} from '../src/world/builder';
import {REACTOR_REASON, SOFTWARE_REASON, enhancedLightingLine, type LightingCapabilities} from '../src/world/enhancedLighting';
import {
  DERIVED_LIGHTING_VERSIONS, EnhancedLightingRuntime, layoutAddress, lightingCapabilities, type EnhancedBake, type EnhancedLightingSettings, type StationBakeInput,
} from '../src/world/enhancedLightingRuntime';
import {DEFAULT_FIELD, bakeLightField, type FieldSource} from '../src/world/lightField';
import {activeLightField, stationFieldLight} from '../src/world/lightFieldNode';
import {MOOD, StationLighting, stationBakeInput, stationFieldSource} from '../src/world/lights';
import {REFL, activeReflectionProbes, stationReflectLight} from '../src/world/reflectionNode';
import type {DrawnSurfaces} from '../src/world/surfaceAlbedo';

const HW: LightingCapabilities = {backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};
const SW: LightingCapabilities = {backend: 'webgl2', software: true, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};

interface Rt { rt: EnhancedLightingRuntime; opens: () => number; cache: () => DerivedCache | null }
function runtime(settings: EnhancedLightingSettings, idb: FakeIndexedDb | null = null, caps: LightingCapabilities = HW): Rt {
  let opens = 0, cache: DerivedCache | null = null;
  const rt = new EnhancedLightingRuntime(settings, {openCache: () => { opens++; return (cache = openDerivedCache({indexedDB: idb, compress: false})); }});
  rt.setCapabilities(caps);
  return {rt, opens: () => opens, cache: () => cache};
}
const tick = () => new Promise<void>(r => setImmediate(r));
/** Wait for the runtime's fire-and-forget writes: until the cache has finished `puts` of them. */
async function settle(r: Rt, puts: number): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    const s = await r.rt.cacheStats(); // (null until the cache is opened: a write that waits for its address has not opened it yet)
    if (s && s.puts + s.failedPuts >= puts) return;
    await tick();
  }
  throw new Error('the cache write did not finish');
}
/** One station load: prefetch (as Game.prepareSection), then the bake steps (as the build's lighting step). */
async function load(r: Rt, input: StationBakeInput, drawn: DrawnSurfaces | null = null, max3D = 2048): Promise<EnhancedBake> {
  await r.rt.prefetch(input);
  return drainSync(r.rt.bakeSteps(input, drawn, {max3DTextureSize: max3D}));
}

/** A small two-room station: w x h cells, a dividing wall with a door, two fixtures. */
function rooms(o: {flicker?: boolean; broken?: boolean} = {}): StationBakeInput {
  const g = new Grid(48, 28);
  for (let y = 1; y < 27; y++) for (let x = 1; x < 47; x++) { g.set(x, y, FLOOR); g.ceil[y * 48 + x] = 4.4; g.area[y * 48 + x] = x < 24 ? 0 : 1; }
  for (let y = 0; y < 28; y++) if (y < 11 || y > 15) g.set(24, y, SOLID);
  const light = (x: number, z: number, extra: object = {}) => ({x, y: 4.35, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false, ...extra});
  const source: FieldSource = {grid: g, lights: [light(6, 7), light(18, 7, {flicker: !!o.flicker, broken: !!o.broken})], trenchFloorY: -1.15};
  return {source, params: {...DEFAULT_FIELD}, reactor: false, extra: ''};
}
const paint = (hex: number): DrawnSurfaces => ({
  keys: ['paint'], floors: [0, 0.5, 0.5, 23.5, 13.5, 0, 0], ceils: [], faces: [],
  material: () => ({color: new THREE.Color(hex), userData: {}}) as never,
});
const same = (a: ArrayBufferView, b: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------
describe('Off and the Reactor: the baseline, untouched', () => {
  it('Off: nothing is baked here, the cache is never opened, the status says baseline', async () => {
    const r = runtime({enhancedLighting: 'off', reflections: 'high'});
    expect(r.rt.status()).toMatchObject({active: null, pending: false, cacheBackend: 'none'});
    const out = await load(r, rooms());
    expect(out).toEqual({baked: undefined, probes: null});
    expect(r.opens()).toBe(0);
    expect(await r.rt.cacheStats()).toBeNull();
    expect(r.rt.status().active).toEqual({gi: 'baseline', giReason: null, reflections: 'off', reflectionsReason: null, cache: 'none', giMs: 0, probeMs: 0, probes: 0, probeBytes: 0});
    expect(r.rt.status().cacheBackend).toBe('none');
    expect(r.rt.timings).toBeNull();
    expect(enhancedLightingLine(r.rt.status())).toBe('off: baseline · refl off');
  });

  it('the Reactor keeps its lighting under every setting, and says why', async () => {
    for (const s of [{enhancedLighting: 'auto', reflections: 'standard'}, {enhancedLighting: 'on', reflections: 'high'}] as EnhancedLightingSettings[]) {
      const r = runtime(s);
      const out = await load(r, {...rooms(), reactor: true});
      expect(out).toEqual({baked: undefined, probes: null});
      expect(r.opens()).toBe(0);
      expect(r.rt.status().active).toMatchObject({gi: 'baseline', giReason: REACTOR_REASON, reflections: 'off', reflectionsReason: REACTOR_REASON, cache: 'none'});
      expect(r.rt.status().pending).toBe(false);
    }
  });

  it('the settings default to Auto + Standard reflections', () => {
    expect(new EnhancedLightingRuntime({}).request()).toEqual({lighting: 'auto', reflections: 'standard'});
  });
});

// ---------------------------------------------------------------------------------------------
describe('miss, hit, stale: the derived cache', () => {
  it('first load bakes and stores; the next session reads the same field and probes back with no bake; one entry per station', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const input = rooms();
    const first = await load(a, input);
    expect(first.baked).toBeDefined();
    expect(first.probes!.count).toBeGreaterThan(0);
    expect(a.rt.status().active).toMatchObject({gi: 'standard', reflections: 'standard', cache: 'miss', probes: first.probes!.count});
    expect(a.rt.status().active!.giMs).toBeGreaterThan(0);
    expect(a.rt.status().active!.probeMs).toBeGreaterThan(0);
    expect(a.rt.status().active!.probeBytes).toBe(first.probes!.atlas.byteLength + first.probes!.meta.byteLength + first.probes!.grid.byteLength);
    expect(a.rt.status().cacheBackend).toBe('indexeddb');
    await settle(a, 1);
    expect(await a.rt.cacheStats()).toMatchObject({backend: 'indexeddb', entries: 1, puts: 1, failedPuts: 0});
    // the enhanced field is not the baseline; same format
    const base = bakeLightField(input.source, input.params);
    expect(same(first.baked!.data, base.data)).toBe(false);
    expect([first.baked!.w, first.baked!.h, first.baked!.depth]).toEqual([base.w, base.h, base.depth]);

    // "the next session": a new runtime over the same browser storage
    const b = runtime({}, idb);
    const second = await load(b, rooms());
    expect(b.rt.status().active).toMatchObject({gi: 'standard', reflections: 'standard', cache: 'hit', giMs: 0, probeMs: 0, probes: first.probes!.count});
    expect(same(second.baked!.data, first.baked!.data)).toBe(true);
    expect(same(second.probes!.atlas, first.probes!.atlas)).toBe(true);
    expect(same(second.probes!.meta, first.probes!.meta)).toBe(true);
    expect(same(second.probes!.grid, first.probes!.grid)).toBe(true);
    expect(second.probes!.layout).toEqual(first.probes!.layout);
    expect([second.probes!.count, second.probes!.block, second.probes!.ramp, second.probes!.gridW, second.probes!.gridH, second.probes!.gridDepth, second.probes!.slots])
      .toEqual([first.probes!.count, first.probes!.block, first.probes!.ramp, first.probes!.gridW, first.probes!.gridH, first.probes!.gridDepth, first.probes!.slots]);
    expect(b.rt.timings).toMatchObject({giMs: 0, probeMs: 0});
    await tick();
    expect((await b.rt.cacheStats())!.puts).toBe(0); // nothing was baked: nothing is written
    expect(enhancedLightingLine(b.rt.status())).toBe(`auto: bake standard · refl standard ×${first.probes!.count} · cache hit`);
  });

  it('a cleared cache bakes again to the same bytes (cache loss changes nothing but the load time)', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const first = await load(a, rooms());
    await settle(a, 1);
    await a.rt.clearCache();
    expect((await a.rt.cacheStats())!.entries).toBe(0);
    const again = await load(a, rooms());
    expect(a.rt.status().active!.cache).toBe('miss');
    expect(same(again.baked!.data, first.baked!.data)).toBe(true);
    expect(same(again.probes!.atlas, first.probes!.atlas)).toBe(true);
    await settle(a, 2);
    expect((await a.rt.cacheStats())!.entries).toBe(1);
  });

  it('a damaged entry is a miss; storage that cannot be used is reported and the session still caches in memory', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const first = await load(a, rooms());
    await settle(a, 1);
    for (const key of [...idb.records(DERIVED_DB_NAME, 'data').keys()]) idb.corrupt(DERIVED_DB_NAME, 'data', key, v => { (v as Uint8Array)[60] ^= 0xff; return v; });
    const b = runtime({}, idb);
    const second = await load(b, rooms());
    expect(b.rt.status().active!.cache).toBe('miss');
    expect(same(second.baked!.data, first.baked!.data)).toBe(true);

    const none = runtime({}, null); // no IndexedDB at all
    const x = await load(none, rooms());
    expect(none.rt.status().active!.cache).toBe('unavailable');
    expect(none.rt.status().cacheBackend).toBe('memory');
    expect(same(x.baked!.data, first.baked!.data)).toBe(true);
    await settle(none, 1);
    await load(none, rooms());
    expect(none.rt.status().active!.cache).toBe('hit'); // this session only
  });

  it('an entry whose real inputs changed is stale: other surface colours under the same address are baked again and replace it', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const grey = await load(a, rooms(), null);
    await settle(a, 1);
    const b = runtime({}, idb);
    const red = await load(b, rooms(), paint(0xb01010));
    expect(b.rt.status().active!.cache).toBe('stale');
    expect(same(red.baked!.data, grey.baked!.data)).toBe(false);
    await settle(b, 1);
    expect((await b.rt.cacheStats())!.entries).toBe(1); // replaced, not added
    const c = runtime({}, idb);
    const red2 = await load(c, rooms(), paint(0xb01010));
    expect(c.rt.status().active!.cache).toBe('hit');
    expect(same(red2.baked!.data, red.baked!.data)).toBe(true);
    // and the grey station is now the stale one
    const d = runtime({}, idb);
    await load(d, rooms(), null);
    expect(d.rt.status().active!.cache).toBe('stale');
  });

  it('another fixture state, other parameters or another tier are other stations to the cache (their own entries)', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const first = await load(a, rooms());
    await settle(a, 1);
    const flick = await load(a, rooms({flicker: true}));
    expect(a.rt.status().active!.cache).toBe('miss');
    expect(same(flick.baked!.data, first.baked!.data)).toBe(false);
    await settle(a, 2);
    const dimmer = {...rooms(), params: {...DEFAULT_FIELD, gain: DEFAULT_FIELD.gain * 0.5}};
    await load(a, dimmer);
    expect(a.rt.status().active!.cache).toBe('miss');
    await settle(a, 3);
    expect((await a.rt.cacheStats())!.entries).toBe(3);
    // the same station under On (the high bake) and without reflections
    const on = runtime({enhancedLighting: 'on', reflections: 'off'}, idb);
    const high = await load(on, rooms());
    expect(on.rt.status().active).toMatchObject({gi: 'high', reflections: 'off', reflectionsReason: null, cache: 'miss', probes: 0, probeBytes: 0});
    expect(high.probes).toBeNull();
    await settle(on, 1);
    expect((await on.rt.cacheStats())!.entries).toBe(4);
    // and each is found again
    const again = runtime({}, idb);
    for (const input of [rooms(), rooms({flicker: true}), dimmer]) { await load(again, input); expect(again.rt.status().active!.cache).toBe('hit'); }
  });

  it('a station built without a prefetch still bakes, and is stored for the next load', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const out = drainSync(a.rt.bakeSteps(rooms(), null, {max3DTextureSize: 2048}));
    expect(out.baked).toBeDefined();
    expect(a.rt.status().active!.cache).toBe('miss');
    await settle(a, 1);
    const b = runtime({}, idb);
    await load(b, rooms());
    expect(b.rt.status().active!.cache).toBe('hit');
  });

  it('the address names the realized layout: equal for equal stations, different for a moved wall, a broken tube or other parameters', async () => {
    const a = await layoutAddress(rooms());
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await layoutAddress(rooms())).toBe(a);
    const moved = rooms(); moved.source.grid.set(30, 5, SOLID);
    const raised = rooms(); raised.source.grid.ceil[5 * 48 + 5] = 3;
    const broken = rooms({broken: true});
    const params = {...rooms(), params: {...DEFAULT_FIELD, range: DEFAULT_FIELD.range + 1}};
    const extra = {...rooms(), extra: 'roof'};
    const all = [a, ...(await Promise.all([moved, raised, broken, params, extra].map(i => layoutAddress(i))))];
    expect(new Set(all).size).toBe(all.length);
    expect(DERIVED_LIGHTING_VERSIONS).toEqual({entry: 1, gather: 1, probes: 3});
  });
});

// ---------------------------------------------------------------------------------------------
describe('what the bake may never touch', () => {
  it('the layout is read only, no random number is drawn, and a hit and a miss leave the same world', async () => {
    const idb = new FakeIndexedDb();
    const input = rooms({flicker: true});
    const g = input.source.grid;
    const snap = () => [Buffer.from(g.cells).toString('base64'), Buffer.from(g.ceil.buffer).toString('base64'), Buffer.from(g.floor.buffer).toString('base64'),
      Buffer.from(g.area.buffer).toString('base64'), Buffer.from(g.sightBlocked).toString('base64'), JSON.stringify(input.source.lights)].join('|');
    const before = snap();
    const rnd = vi.spyOn(Math, 'random');
    const a = runtime({enhancedLighting: 'on', reflections: 'high'}, idb);
    await load(a, input);
    expect(snap()).toBe(before);
    await settle(a, 1);
    await load(a, input); // hit
    expect(a.rt.status().active!.cache).toBe('hit');
    expect(snap()).toBe(before);
    expect(rnd).not.toHaveBeenCalled();
  });

  it('the derived data lives outside the save: no save / run module knows the cache, and the bake modules know no save, RNG or clock but statistics', () => {
    const root = new URL('../src/', import.meta.url).pathname;
    const read = (p: string) => readFileSync(root + p, 'utf8');
    const bake = ['world/enhancedLightingRuntime.ts', 'world/lightFieldGather.ts', 'world/lightScene.ts', 'world/surfaceAlbedo.ts', 'world/reflectionProbes.ts', 'core/derivedCache.ts', 'core/contentHash.ts'];
    for (const f of bake) {
      const text = read(f), code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/Math\.random|mulberry32|\brng\b/);
      if (f.startsWith('world/')) expect(code, f).not.toMatch(/Date\.now|new Date/); // (the cache stamps entries for its LRU order; a bake reads no clock but performance.now for its statistics)
      expect(code, f).not.toMatch(/from '\.\.\/(run|campaign|items|save)\//);
      expect(code, f).not.toMatch(/localStorage|sessionStorage/);
    }
    // nothing that writes or reads a save imports the derived cache or the enhanced bake
    for (const dir of ['run', 'campaign']) {
      for (const f of readdirSync(root + dir).filter(n => n.endsWith('.ts'))) {
        expect(read(`${dir}/${f}`), `${dir}/${f}`).not.toMatch(/derivedCache|enhancedLightingRuntime|lightFieldGather|reflectionProbes/);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('capabilities, reasons and pending changes', () => {
  it('Auto on a software renderer: the enhanced bake, no reflections, and the reason; On forces them', async () => {
    const auto = runtime({enhancedLighting: 'auto', reflections: 'standard'}, null, SW);
    const a = await load(auto, rooms());
    expect(a.baked).toBeDefined();
    expect(a.probes).toBeNull();
    expect(auto.rt.status().active).toMatchObject({gi: 'standard', reflections: 'off', reflectionsReason: SOFTWARE_REASON, probes: 0, probeBytes: 0, probeMs: 0});
    const on = runtime({enhancedLighting: 'on', reflections: 'standard'}, null, SW);
    const b = await load(on, rooms());
    expect(b.probes!.count).toBeGreaterThan(0);
    expect(on.rt.status().active).toMatchObject({gi: 'high', reflections: 'standard', reflectionsReason: null});
  });

  it('before the renderer reported its capabilities no reflections are planned; a station larger than the 3D texture limit says so', async () => {
    const early = new EnhancedLightingRuntime({});
    expect(early.plan(false)).toMatchObject({reflections: null, reflectionsReason: 'the renderer is not ready'});
    expect(early.plan(false).gi?.id).toBe('standard');
    const r = runtime({});
    const out = await load(r, rooms(), null, 32); // the grid is 48 cells wide
    expect(out.probes).toBeNull();
    expect(out.baked).toBeDefined();
    expect(r.rt.status().active!.reflections).toBe('off');
    expect(r.rt.status().active!.reflectionsReason).toMatch(/larger than this renderer's 3D textures \(32\)/);
  });

  it('lightingCapabilities reads the backend\'s own limits, never memory', () => {
    expect(lightingCapabilities({device: {limits: {maxTextureDimension2D: 8192}}}, 'webgpu', false, 2048))
      .toEqual({backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true});
    const gl = {MAX_TEXTURE_SIZE: 0x0d33, getParameter: (p: number) => (p === 0x0d33 ? 4096 : 0)};
    expect(lightingCapabilities({gl}, 'webgl2', true, 256)).toEqual({backend: 'webgl2', software: true, maxTextureSize: 4096, max3DTextureSize: 256, halfFloatLinear: true});
    expect(lightingCapabilities(null, null, false, 0)).toEqual({backend: null, software: false, maxTextureSize: 0, max3DTextureSize: 0, halfFloatLinear: false});
    expect(lightingCapabilities({gl: {MAX_TEXTURE_SIZE: 1, getParameter: () => { throw new Error('lost'); }}}, 'webgl2', false, 256).maxTextureSize).toBe(0);
    const src = readFileSync(new URL('../src/world/enhancedLightingRuntime.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/deviceMemory|jsHeapSizeLimit|hardwareConcurrency/);
  });

  it('a settings change is pending until a station is built with it; subscribers hear every change', async () => {
    const settings: EnhancedLightingSettings = {enhancedLighting: 'auto', reflections: 'standard'};
    const r = runtime(settings);
    let heard = 0;
    const off = r.rt.subscribe(() => { heard++; });
    expect(r.rt.status().pending).toBe(false); // no station yet
    await load(r, rooms());
    expect(heard).toBeGreaterThan(0);
    expect(r.rt.status().pending).toBe(false);
    settings.enhancedLighting = 'off';
    expect(r.rt.status()).toMatchObject({pending: true, requested: {lighting: 'off', reflections: 'standard'}});
    expect(r.rt.status().active!.gi).toBe('standard'); // the live station is still what it was built with
    settings.enhancedLighting = 'auto';
    expect(r.rt.status().pending).toBe(false);
    settings.reflections = 'high';
    expect(r.rt.status().pending).toBe(true);
    await load(r, rooms());
    expect(r.rt.status()).toMatchObject({pending: false, active: {reflections: 'high'}});
    const n = heard;
    r.rt.applied('the renderer has no node library');
    expect(heard).toBe(n + 1);
    expect(r.rt.status().active).toMatchObject({reflections: 'off', reflectionsReason: 'the renderer has no node library', probes: 0, probeBytes: 0});
    r.rt.applied(null);
    expect(heard).toBe(n + 1);
    off();
    await r.rt.clearCache();
    expect(heard).toBe(n + 1);
  });

  it('a change applied to the LIVE station: applying, a failed change (kept lighting, reason, no blind retry), the baseline fallback', async () => {
    // task studio-graphics-gpu-materials-toggle-20261114-212239-01 (Game.relightAfterSettings drives these)
    const settings: EnhancedLightingSettings = {enhancedLighting: 'auto', reflections: 'standard'};
    const r = runtime(settings);
    let heard = 0;
    r.rt.subscribe(() => { heard++; });
    expect(r.rt.pendingSignature()).toBeNull(); // no station: nothing to apply to
    expect(r.rt.failedFor(null)).toBe(false);
    await load(r, rooms());
    const before = r.rt.status();
    expect(before).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'standard', reflections: 'standard'}});

    // the rebuild is announced once per edge
    let n = heard;
    r.rt.setApplying(true);
    r.rt.setApplying(true);
    expect(heard).toBe(n + 1);
    expect(r.rt.status().applying).toBe(true);
    r.rt.setApplying(false);
    expect([heard, r.rt.status().applying]).toEqual([n + 2, false]);

    // a rebuild that fails BEFORE anything was installed: the record is restored, the reason is reported while that plan is pending
    settings.reflections = 'high';
    const want = r.rt.pendingSignature();
    expect(want).not.toBeNull();
    const restore = r.rt.checkpoint();
    const steps = r.rt.bakeSteps(rooms(), null, {max3DTextureSize: 2048});
    steps.next(); // the bake started: the runtime already describes the station as being lit for the new plan
    expect(r.rt.status().pending).toBe(false);
    n = heard;
    r.rt.failed(want, 'simulated failure', restore);
    expect(heard).toBe(n + 1);
    expect(r.rt.status()).toMatchObject({pending: true, error: 'simulated failure', active: before.active});
    expect(r.rt.failedFor(want)).toBe(true);
    expect(r.rt.failedFor(r.rt.pendingSignature())).toBe(true); // the game does not retry this plan by itself
    // another choice is a new plan: not marked failed, and the old reason is not shown for it
    settings.reflections = 'off';
    expect(r.rt.failedFor(r.rt.pendingSignature())).toBe(false);
    expect(r.rt.status()).toMatchObject({pending: true, error: null});
    // back to the failed plan: its reason shows again; back to what the station has: nothing pending, no error
    settings.reflections = 'high';
    expect(r.rt.status()).toMatchObject({pending: true, error: 'simulated failure'});
    settings.reflections = 'standard';
    expect(r.rt.status()).toMatchObject({pending: false, error: null});
    // a station lit for the failed plan after all clears the failure
    settings.reflections = 'high';
    await load(r, rooms());
    expect(r.rt.status()).toMatchObject({pending: false, error: null, active: {reflections: 'high'}});
    expect(r.rt.failedFor(want)).toBe(false);

    // the install itself failed and the baseline lighting was put in instead: the status says baseline and why, and the change is
    // still pending (the station does not have what was asked)
    n = heard;
    r.rt.installedBaseline('the lighting could not be installed (out of memory)');
    expect(heard).toBe(n + 1);
    expect(r.rt.status()).toMatchObject({
      pending: true, error: null,
      active: {gi: 'baseline', giReason: 'the lighting could not be installed (out of memory)', reflections: 'off', cache: 'none', probes: 0, probeBytes: 0, giMs: 0, probeMs: 0},
    });
    r.rt.failed(r.rt.pendingSignature(), 'the lighting could not be installed (out of memory)');
    expect(r.rt.status()).toMatchObject({pending: true, error: 'the lighting could not be installed (out of memory)'});
    // Off is exactly what a baseline station has: choosing it leaves nothing pending
    settings.enhancedLighting = 'off';
    expect(r.rt.status()).toMatchObject({pending: false, error: null});
  });
});

// ---------------------------------------------------------------------------------------------
describe('a real station: what the builder drew, and the station lighting', () => {
  let layout: StationLayout, world: BuiltWorld;
  const fakeRenderer = () => {
    const nodes = new Map<unknown, unknown>();
    return {library: {addLight: (n: unknown, l: unknown) => { nodes.set(l, n); }, getLightNodeClass: (l: unknown) => nodes.get(l) ?? null}} as never;
  };
  const build = async () => {
    if (world) return;
    layout = layoutFor('subway', 4242);
    const models = await modelsFor('subway', layout);
    dropUnloadedP7(layout, new Set(p7ModelKeysFor(layout).filter(k => models.lazy[k])));
    world = drainSync(buildWorldSteps(layout, materialsFor(models), models.all));
  };

  it('the Subway: enhanced from what was drawn; the reflecting light carries the probes; a hit rebuilds the identical lighting; Off returns to the plain light', async () => {
    await build();
    expect(world.drawn!.floors.length).toBeGreaterThan(0);
    expect(world.drawn!.faces.length).toBeGreaterThan(0);
    const idb = new FakeIndexedDb();
    const settings: EnhancedLightingSettings = {};
    const a = runtime(settings, idb);
    const input = stationBakeInput(layout);
    expect(input.reactor).toBe(false);
    expect(input.params).toEqual(StationLighting.fieldParams({}));
    // the bake as the paced build runs it: every step timed (it must yield often, and no step may hold much of the work)
    await a.rt.prefetch(input);
    const steps = a.rt.bakeSteps(input, world.drawn, {max3DTextureSize: 2048});
    let n = 0, workMs = 0, maxMs = 0, maxAt = '', stage = '(start)', first!: EnhancedBake;
    for (;;) {
      const t0 = performance.now(), r = steps.next(), ms = performance.now() - t0;
      n++; workMs += ms;
      if (ms > maxMs) { maxMs = ms; maxAt = stage; }
      if (r.done) { first = r.value; break; }
      if (typeof r.value === 'string') stage = r.value;
    }
    const tag = `enhanced lighting bake: ${n} steps, ${workMs.toFixed(0)} ms, worst ${maxMs.toFixed(1)} ms (${maxAt})`;
    console.log(tag);
    expect(n / (workMs / 1000), tag).toBeGreaterThanOrEqual(60); // tests/paced-build-slices.test.ts: the lighting builder's bounds
    expect(maxMs / workMs, tag).toBeLessThanOrEqual(0.4);
    expect(maxMs, tag).toBeLessThan(1500);
    const t = a.rt.timings!;
    console.log(`subway 4242 enhanced load (Node): address ${t.addressMs.toFixed(0)} ms, fetch ${t.fetchMs.toFixed(0)} ms, albedo ${t.albedoMs.toFixed(0)} ms, digests ${t.digestMs.toFixed(0)} ms, gather ${t.giMs.toFixed(0)} ms, ` +
      `probes ${t.probeMs.toFixed(0)} ms (${first.probes!.count}, ${(a.rt.status().active!.probeBytes / 1048576).toFixed(2)} MiB), lighting total ${t.totalMs.toFixed(0)} ms`);
    expect(a.rt.status().active).toMatchObject({gi: 'standard', reflections: 'standard', cache: 'miss'});
    expect(first.probes!.count).toBeGreaterThan(8);
    expect(first.probes!.count).toBeLessThanOrEqual(192);

    const scene = new THREE.Scene();
    const opts = {hemi: new THREE.HemisphereLight(), fogDensity: MOOD.fogDensity, far: 70, max3DTextureSize: 2048, renderer: fakeRenderer()};
    const lit = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, baked: first.baked, probes: first.probes}));
    a.rt.applied(lit.reflectionsSkipped);
    expect(lit.reflectionsSkipped).toBeNull();
    expect(lit.fieldLight).toBe(stationReflectLight());
    expect(scene.children).toContain(stationReflectLight());
    expect(scene.children).not.toContain(stationFieldLight());
    expect(activeReflectionProbes()).toBe(lit.reflections);
    expect(REFL.atlas.value).toBe(lit.reflections!.atlas);
    expect(REFL.params.value.x).toBe(1);
    expect(lit.field).toBe(first.baked); // full resolution: the bake is the field
    expect(a.rt.status().active!.reflections).toBe('standard');

    // "death -> reload": the old lighting retires, the same station loads again — from the cache, to the same bytes
    await settle(a, 1);
    const retired: (() => void)[] = [];
    lit.dispose(scene, f => retired.push(f));
    expect(activeReflectionProbes()).toBeNull();
    expect(REFL.params.value.x).toBe(0);
    expect(scene.children).not.toContain(stationReflectLight());
    const second = await load(a, stationBakeInput(layout), world.drawn);
    expect(a.rt.status().active!.cache).toBe('hit');
    expect(same(second.baked!.data, first.baked!.data)).toBe(true);
    expect(same(second.probes!.atlas, first.probes!.atlas)).toBe(true);
    const lit2 = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, baked: second.baked, probes: second.probes}));
    expect(activeReflectionProbes()).toBe(lit2.reflections);
    const disposed: string[] = [];
    for (const tex of [lit.reflections!.atlas, lit.reflections!.meta, lit.reflections!.grid]) tex.addEventListener('dispose', () => disposed.push(tex.name));
    for (const f of retired) f(); // the old station's GPU objects go after the new one is bound
    expect(disposed.sort()).toEqual(['reflection-atlas', 'reflection-grid', 'reflection-meta']);
    expect(activeReflectionProbes()).toBe(lit2.reflections);
    expect(REFL.atlas.value).toBe(lit2.reflections!.atlas);

    // a renderer whose 3D textures are too small for the probe grid: the plain light, and the reason
    lit2.dispose(scene);
    const small = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, max3DTextureSize: 256, baked: second.baked, probes: second.probes}));
    expect(small.reflections).toBeNull();
    expect(small.reflectionsSkipped).toMatch(/larger than this renderer's 3D textures \(256\)/);
    expect(small.fieldLight).toBe(stationFieldLight());
    a.rt.applied(small.reflectionsSkipped);
    expect(a.rt.status().active).toMatchObject({reflections: 'off', probes: 0});
    small.dispose(scene);

    // Enhanced lighting Off: the baseline bake, the plain light, no probe bound
    settings.enhancedLighting = 'off';
    const off = await load(a, stationBakeInput(layout), world.drawn);
    expect(off).toEqual({baked: undefined, probes: null});
    const plain = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, baked: off.baked, probes: off.probes}));
    expect(plain.fieldLight).toBe(stationFieldLight());
    expect(plain.reflections).toBeNull();
    expect(activeReflectionProbes()).toBeNull();
    expect(same(plain.field.data, bakeLightField(stationFieldSource(layout), StationLighting.fieldParams({})).data)).toBe(true);
    plain.dispose(scene);
  }, 240000);

  // Task studio-graphics-gpu-materials-toggle-20261114-212239-01: the SAME station relit in place (StationLighting.replaceSteps — what
  // Game.relightAfterSettings runs for a changed choice in the pause menu).
  it('relit in place: the new lighting stands where the old one stood (clock, circuit levels, one field light, one set of glow cards); the old one is released afterwards; a failed install falls back to the baseline, and a double failure leaves the old lighting standing', async () => {
    await build();
    const settings: EnhancedLightingSettings = {enhancedLighting: 'on', reflections: 'standard'};
    const a = runtime(settings, new FakeIndexedDb());
    const enhanced = await load(a, stationBakeInput(layout), world.drawn);
    expect(enhanced.probes!.count).toBeGreaterThan(8);
    const scene = new THREE.Scene();
    const opts = {hemi: new THREE.HemisphereLight(), fogDensity: MOOD.fogDensity, far: 70, max3DTextureSize: 2048, renderer: fakeRenderer()};
    const fieldLights = () => scene.children.filter(c => c === stationFieldLight() || c === stationReflectLight());
    const glows = () => scene.children.filter(c => c.name === 'light-glow');
    const clock = (l: StationLighting) => (l as unknown as {t: number}).t;

    // the station as it stands: the baseline lighting, its flicker clock running, a circuit held by an override
    const plain = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts}));
    plain.circuitLevel = [null, 0.25, null];
    for (let i = 0; i < 90; i++) plain.update(1 / 60);
    expect(plain.levels[1]).toBe(0.25);
    expect(fieldLights()).toEqual([stationFieldLight()]);
    expect(glows()).toEqual([plain.glow]);
    const levels0 = [...plain.levels], t0 = clock(plain);
    expect(t0).toBeCloseTo(1.5, 6);

    // 1. Off -> On with reflections: the other field light, the probes bound, the same clock and levels; the old lighting's GPU
    //    objects are handed to `retire` (the game runs them after the warm-up), nothing is released inside the step
    const retired: (() => void)[] = [];
    const releasedPlain = vi.spyOn(plain.volume, 'dispose');
    const r1 = drainSync(StationLighting.replaceSteps(plain, {...opts, baked: enhanced.baked, probes: enhanced.probes}, f => retired.push(f)));
    const lit = r1.lighting;
    expect(r1.error).toBeNull();
    expect(lit).not.toBe(plain);
    expect(lit.fieldLight).toBe(stationReflectLight());
    expect(fieldLights()).toEqual([stationReflectLight()]);
    expect(activeLightField()).toBe(lit.volume);
    expect(activeReflectionProbes()).toBe(lit.reflections);
    expect(lit.field).toBe(enhanced.baked);
    expect([clock(lit), lit.circuitLevel, [...lit.levels]]).toEqual([t0, [null, 0.25, null], levels0]);
    expect(glows()).toEqual([lit.glow]);
    expect(retired).toHaveLength(1);
    expect(releasedPlain).not.toHaveBeenCalled();
    for (const f of retired.splice(0)) f();
    expect(releasedPlain).toHaveBeenCalledTimes(1);
    expect(activeLightField(), 'releasing the old field leaves the new one bound').toBe(lit.volume);

    // 2. Standard -> another bake with probes: the SAME session-wide reflecting light stays in the scene (the old lighting's dispose
    //    takes it out, the new one is put back)
    const r2 = drainSync(StationLighting.replaceSteps(lit, {...opts, baked: enhanced.baked, probes: enhanced.probes}, f => retired.push(f)));
    expect(r2.error).toBeNull();
    expect(r2.lighting.fieldLight).toBe(stationReflectLight());
    expect(fieldLights()).toEqual([stationReflectLight()]);
    expect(activeReflectionProbes()).toBe(r2.lighting.reflections);
    expect(activeReflectionProbes()).not.toBe(lit.reflections);
    expect(glows()).toEqual([r2.lighting.glow]);
    for (const f of retired.splice(0)) f();

    // 3. the planned lighting cannot be installed (it throws after its light is in the scene and its textures are bound): the station
    //    gets the BASELINE lighting, the error is reported, and nothing of the failed one is left behind
    let throwsLeft = 1;
    const hemiOnce = new THREE.HemisphereLight();
    Object.defineProperty(hemiOnce, 'intensity', {get: () => 1, set: () => { if (throwsLeft-- > 0) throw new Error('simulated install failure'); }});
    const r3 = drainSync(StationLighting.replaceSteps(r2.lighting, {...opts, hemi: hemiOnce, baked: enhanced.baked, probes: enhanced.probes}, f => retired.push(f)));
    expect(String((r3.error as Error).message)).toBe('simulated install failure');
    const base = r3.lighting;
    expect(base.fieldLight).toBe(stationFieldLight());
    expect(base.reflections).toBeNull();
    expect(fieldLights(), 'the failed lighting\'s reflecting light is not left beside the baseline\'s').toEqual([stationFieldLight()]);
    expect(activeLightField()).toBe(base.volume);
    expect(activeReflectionProbes()).toBeNull();
    expect(REFL.params.value.x).toBe(0);
    expect(glows()).toEqual([base.glow]);
    expect(same(base.field.data, bakeLightField(stationFieldSource(layout), StationLighting.fieldParams({})).data)).toBe(true);
    expect([clock(base), [...base.levels]]).toEqual([t0, levels0]);
    expect(retired, 'the replaced lighting is released once').toHaveLength(1);
    for (const f of retired.splice(0)) f();

    // 4. neither the planned lighting nor the baseline can be installed: the step throws the FIRST error and the old lighting stands
    //    exactly as it stood — in the scene, bound, not released
    const hemiNever = new THREE.HemisphereLight();
    Object.defineProperty(hemiNever, 'intensity', {get: () => 1, set: () => { throw new Error('simulated: nothing installs'); }});
    const releasedBase = vi.spyOn(base.volume, 'dispose');
    expect(() => drainSync(StationLighting.replaceSteps(base, {...opts, hemi: hemiNever, baked: enhanced.baked, probes: enhanced.probes}, f => retired.push(f)))).toThrow('simulated: nothing installs');
    expect(fieldLights()).toEqual([stationFieldLight()]);
    expect(activeLightField()).toBe(base.volume);
    expect(activeReflectionProbes()).toBeNull();
    expect(glows()).toEqual([base.glow]);
    expect(retired).toHaveLength(0);
    expect(releasedBase).not.toHaveBeenCalled();
    expect([clock(base), [...base.levels]]).toEqual([t0, levels0]);
    base.update(1 / 60); // (still a working lighting)
    base.dispose(scene);
  }, 240000);
});
