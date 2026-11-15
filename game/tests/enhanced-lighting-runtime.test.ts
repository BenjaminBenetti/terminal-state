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
// Task studio-baked-gi-visual-uplift-20261115-004324-01:
// - the bake says how its field is to be SHADED ('full': it holds its ambient cube), whether the glass MIRROR is planned, and — with
//   full shading — what the flashlight's BOUNCE traces (the ray scene and the surface colours), on a miss and on a hit alike;
// - a station whose field with its cube is deeper than the renderer's 3D textures, or larger than FIELD_CUBE_BYTES, keeps the
//   enhanced bake and is shaded plain, with the reason; the prefetch and the bake agree on its cache entry (the next load is a hit);
// - the cache holds the gather's rows as 16 bits a value, and a hit gives the very bytes of the miss (field, cube and probes);
// - the station lighting puts the light of its shading in the scene (full / plain, with or without probes and mirror) and binds the
//   flashlight bounce only under full shading; a rebuild in place keeps it bound to whatever lights the station afterwards.
import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import * as THREE from 'three';
import {FakeIndexedDb} from './helpers/fakeIndexedDb';
import {FIX as RFIX, levelFixture as renderFixture} from './helpers/levelRenderFixture';
import {layoutFor, materialsFor, modelsFor} from './helpers/pacedBuildFixture';
import {drainSync} from '../src/core/pacedBuild';
import {DERIVED_DB_NAME, openDerivedCache, type DerivedBundle, type DerivedCache} from '../src/core/derivedCache';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import {buildWorldSteps, type BuiltWorld} from '../src/world/builder';
import {
  APPLYING_NOTE, FIELD_CUBE_BYTES, REACTOR_REASON, SOFTWARE_REASON, SOFTWARE_SHADING_REASON, describeEnhancedLighting, enhancedLightingLine,
  type LightingCapabilities,
} from '../src/world/enhancedLighting';
import {
  DERIVED_LIGHTING_VERSIONS, EnhancedLightingRuntime, layoutAddress, lightingCapabilities, type EnhancedBake, type EnhancedLightingSettings, type StationBakeInput,
} from '../src/world/enhancedLightingRuntime';
import {DEFAULT_FIELD, MAX_GROUPS, bakeLightField, fieldDepth, giDepth, withoutCube, type BakedField, type FieldSource} from '../src/world/lightField';
import {IND_STRIDE, rowBits, rowValue} from '../src/world/lightFieldGather';
import {LF, activeLightField, stationFieldLight, stationLights} from '../src/world/lightFieldNode';
import {BandScene} from '../src/world/lightScene';
import {FLASH_BOUNCE, MOOD, StationLighting, stationBakeInput, stationFieldSource} from '../src/world/lights';
import {REFL, activeReflectionProbes, stationReflectLight} from '../src/world/reflectionNode';
import type {DrawnSurfaces} from '../src/world/surfaceAlbedo';

const HW: LightingCapabilities = {backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};
const SW: LightingCapabilities = {backend: 'webgl2', software: true, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};

interface Rt { rt: EnhancedLightingRuntime; opens: () => number; cache: () => DerivedCache | null; puts: {key: string; bundle: DerivedBundle}[] }
function runtime(settings: EnhancedLightingSettings, idb: FakeIndexedDb | null = null, caps: LightingCapabilities = HW): Rt {
  let opens = 0, cache: DerivedCache | null = null;
  const puts: Rt['puts'] = [];
  const rt = new EnhancedLightingRuntime(settings, {openCache: () => {
    opens++;
    const c = openDerivedCache({indexedDB: idb, compress: false}), put = c.put.bind(c);
    // (what the runtime hands the cache, as handed: the key and the bundle)
    (c as {put: DerivedCache['put']}).put = (key, bundle, tag) => { puts.push({key, bundle}); return put(key, bundle, tag); };
    return (cache = c);
  }});
  rt.setCapabilities(caps);
  return {rt, opens: () => opens, cache: () => cache, puts};
}
/** The record of a station that is not enhanced, and what its bake hands the station lighting. */
const BASELINE_ACTIVE = {gi: 'baseline', giReason: null, shading: 'plain', shadingReason: null, mirror: false, reflections: 'off', reflectionsReason: null, cache: 'none', giMs: 0, probeMs: 0, probes: 0, probeBytes: 0};
const NOT_ENHANCED: EnhancedBake = {baked: undefined, probes: null, shading: 'plain', mirror: false, bounce: null};
/** A station of three levels (80 x 50 cells: an upper deck and a crossing below the main level). */
function threeLevels(): StationBakeInput {
  const {layout, levels} = renderFixture();
  return {source: {grid: layout.grid, lights: layout.lights, trenchFloorY: RFIX.bedY, levels}, params: {...DEFAULT_FIELD}, reactor: false, extra: ''};
}
/** The slices before a field's ambient cube (all of a field without one). */
const slotBytes = (f: BakedField): Uint8Array => f.data.subarray(0, (f.gi ?? f.depth) * f.w * f.h * 4);
/** The station's field lights that are in a scene. */
const fieldLightsIn = (scene: THREE.Scene): THREE.Object3D[] => scene.children.filter(c => (stationLights() as THREE.Object3D[]).includes(c));
/** What the flashlight bounce is bound to (null: nothing). */
const bounceSource = (): unknown => (FLASH_BOUNCE as unknown as {src: unknown}).src;
/** A bake as the game hands it to the station lighting (game.ts: every field of it, by name). */
const handed = (b: EnhancedBake) => ({baked: b.baked, probes: b.probes, shading: b.shading, mirror: b.mirror, bounce: b.bounce});
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
    expect(out).toEqual(NOT_ENHANCED);
    expect(r.opens()).toBe(0);
    expect(await r.rt.cacheStats()).toBeNull();
    expect(r.rt.status().active).toEqual(BASELINE_ACTIVE);
    expect(r.rt.status().cacheBackend).toBe('none');
    expect(r.rt.timings).toBeNull();
    expect(enhancedLightingLine(r.rt.status())).toBe('off: baseline · refl off');
  });

  it('the Reactor keeps its lighting under every setting, and says why', async () => {
    for (const s of [{enhancedLighting: 'auto', reflections: 'standard'}, {enhancedLighting: 'on', reflections: 'high'}] as EnhancedLightingSettings[]) {
      const r = runtime(s);
      const out = await load(r, {...rooms(), reactor: true});
      expect(out).toEqual(NOT_ENHANCED);
      expect(r.opens()).toBe(0);
      expect(r.rt.status().active).toEqual({...BASELINE_ACTIVE, giReason: REACTOR_REASON, reflectionsReason: REACTOR_REASON});
      expect(r.rt.status().pending).toBe(false);
    }
  });

  it('the settings default to Auto + Standard reflections', () => {
    expect(new EnhancedLightingRuntime({}).request()).toEqual({lighting: 'auto', reflections: 'standard'});
  });
});

// ---------------------------------------------------------------------------------------------
describe('miss, hit, stale: the derived cache', () => {
  it('first load bakes and stores; the next session reads the same field, cube and probes back with no bake; one entry per station', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const input = rooms();
    const first = await load(a, input);
    expect(first.baked).toBeDefined();
    expect(first.probes!.count).toBeGreaterThan(0);
    // Auto on a hardware WebGPU renderer: the standard bake shaded in full, the standard probes and the glass mirror
    expect([first.shading, first.mirror]).toEqual(['full', true]);
    expect(a.rt.status().active).toMatchObject({gi: 'standard', giReason: null, shading: 'full', shadingReason: null, mirror: true, reflections: 'standard', cache: 'miss', probes: first.probes!.count});
    expect(a.rt.status().active!.giMs).toBeGreaterThan(0);
    expect(a.rt.status().active!.probeMs).toBeGreaterThan(0);
    expect(a.rt.status().active!.probeBytes).toBe(first.probes!.atlas.byteLength + first.probes!.meta.byteLength + first.probes!.grid.byteLength);
    expect(a.rt.status().cacheBackend).toBe('indexeddb');
    await settle(a, 1);
    expect(await a.rt.cacheStats()).toMatchObject({backend: 'indexeddb', entries: 1, puts: 1, failedPuts: 0});
    // the enhanced field: the baseline's format with its own light in the slots, then the ambient cube
    const base = bakeLightField(input.source, input.params);
    expect([first.baked!.w, first.baked!.h, first.baked!.slots, first.baked!.gi]).toEqual([base.w, base.h, base.slots, base.depth]);
    expect(first.baked!.depth).toBe(base.depth + giDepth(base.slots));
    expect(same(slotBytes(first.baked!), base.data)).toBe(false);
    // what the flashlight's bounce traces: the station's ray scene and its surface colours
    expect(first.bounce!.scene).toBeInstanceOf(BandScene);
    expect(first.bounce!.albedo.slots.length).toBe(base.slots);
    // what was stored: ONE entry at the plan's address; the gather's rows as 16 bits a value, each exactly a row value
    expect(a.puts.length).toBe(1);
    const {key, bundle} = a.puts[0];
    expect(key.startsWith(`el${DERIVED_LIGHTING_VERSIONS.entry}-standard-full-standard-`)).toBe(true);
    expect(bundle.meta.v).toBe(DERIVED_LIGHTING_VERSIONS.entry);
    const rows = bundle.arrays.gi as Uint16Array;
    expect(rows).toBeInstanceOf(Uint16Array);
    expect(rows.length).toBe(first.baked!.stats.indirect!.voxels * IND_STRIDE);
    let lit = 0, moved = 0;
    for (let q = 0; q < rows.length; q++) { if (rows[q] > 0) lit++; if (rowBits(rowValue(rows[q])) !== rows[q]) moved++; }
    expect(lit).toBeGreaterThan(rows.length / 4);
    expect(moved).toBe(0);
    expect(bundle.arrays.atlas).toBeInstanceOf(Uint16Array); // (the probes: half floats)

    // "the next session": a new runtime over the same browser storage
    const b = runtime({}, idb);
    const second = await load(b, rooms());
    expect(b.rt.status().active).toMatchObject({gi: 'standard', shading: 'full', shadingReason: null, mirror: true, reflections: 'standard', cache: 'hit', giMs: 0, probeMs: 0, probes: first.probes!.count});
    expect([second.shading, second.mirror]).toEqual(['full', true]);
    // HIT BYTES = MISS BYTES: the field with its cube, and the probes
    expect([second.baked!.gi, second.baked!.depth]).toEqual([first.baked!.gi, first.baked!.depth]);
    expect(same(second.baked!.data, first.baked!.data)).toBe(true);
    expect(same(second.probes!.atlas, first.probes!.atlas)).toBe(true);
    expect(same(second.probes!.meta, first.probes!.meta)).toBe(true);
    expect(same(second.probes!.grid, first.probes!.grid)).toBe(true);
    expect(second.probes!.layout).toEqual(first.probes!.layout);
    expect([second.probes!.count, second.probes!.block, second.probes!.ramp, second.probes!.gridW, second.probes!.gridH, second.probes!.gridDepth, second.probes!.slots])
      .toEqual([first.probes!.count, first.probes!.block, first.probes!.ramp, first.probes!.gridW, first.probes!.gridH, first.probes!.gridDepth, first.probes!.slots]);
    expect(b.rt.timings).toMatchObject({giMs: 0, probeMs: 0});
    // the bounce on a hit: the gather that makes the ray scene did not run, so one is made for it — it traces as the miss's does,
    // over the same surface colours
    expect(second.bounce!.scene).toBeInstanceOf(BandScene);
    expect(second.bounce!.scene).not.toBe(first.bounce!.scene);
    for (let s = 0; s < base.slots; s++) expect(same(second.bounce!.albedo.slots[s], first.bounce!.albedo.slots[s])).toBe(true);
    const sa = first.bounce!.scene, sb = second.bounce!.scene;
    let hits = 0;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0.6, -0.2, 0.77], [0.5, 0.1, -0.86], [0.99, 0.05, 0.1]]) for (const [x, z] of [[5, 5], [10.5, 6.5], [16, 3], [20, 11]]) {
      const ha = sa.trace(x, 1.5, z, dx, dy, dz, 40), hb = sb.trace(x, 1.5, z, dx, dy, dz, 40);
      expect(hb).toBe(ha);
      if (ha) { hits++; expect([sb.hitT, sb.hitKind, sb.hitCol, sb.hitBand, sb.hitNx, sb.hitNz]).toEqual([sa.hitT, sa.hitKind, sa.hitCol, sa.hitBand, sa.hitNx, sa.hitNz]); }
    }
    expect(hits).toBeGreaterThan(20);
    await tick();
    expect((await b.rt.cacheStats())!.puts).toBe(0); // nothing was baked: nothing is written
    expect(b.puts.length).toBe(0);
    // the compact line names the bake's shading, the probes and the mirror
    const line = enhancedLightingLine(b.rt.status());
    expect(line.startsWith(`auto: bake standard full · refl standard ×${first.probes!.count}`)).toBe(true);
    expect(line.endsWith(' · cache hit')).toBe(true);
    expect(line).toMatch(/mirror/);
  });

  it('a hit gives the bytes of the miss at every shading and tier: plain (software, Auto), full without reflections, the high bake with high probes', async () => {
    const cases: {name: string; settings: EnhancedLightingSettings; caps: LightingCapabilities; shading: 'plain' | 'full'; probes: boolean; mirror: boolean}[] = [
      {name: 'Auto on a software renderer', settings: {}, caps: SW, shading: 'plain', probes: false, mirror: false},
      {name: 'Auto, reflections off', settings: {reflections: 'off'}, caps: HW, shading: 'full', probes: false, mirror: false},
      {name: 'On + High on a software renderer', settings: {enhancedLighting: 'on', reflections: 'high'}, caps: SW, shading: 'full', probes: true, mirror: true},
    ];
    for (const c of cases) {
      const idb = new FakeIndexedDb();
      const a = runtime(c.settings, idb, c.caps), miss = await load(a, threeLevels());
      expect(a.rt.status().active, c.name).toMatchObject({cache: 'miss', shading: c.shading, mirror: c.mirror});
      expect([miss.shading, miss.mirror, miss.probes !== null, miss.bounce !== null, miss.baked!.gi !== undefined], c.name).toEqual([c.shading, c.mirror, c.probes, c.shading === 'full', c.shading === 'full']);
      await settle(a, 1);
      expect(a.puts.length, c.name).toBe(1);
      expect(a.puts[0].bundle.arrays.gi, c.name).toBeInstanceOf(Uint16Array);
      const b = runtime(c.settings, idb, c.caps), hit = await load(b, threeLevels());
      expect(b.rt.status().active, c.name).toMatchObject({cache: 'hit', giMs: 0, probeMs: 0, shading: c.shading, mirror: c.mirror});
      expect([hit.shading, hit.mirror, hit.probes !== null, hit.bounce !== null], c.name).toEqual([c.shading, c.mirror, c.probes, c.shading === 'full']);
      expect([hit.baked!.gi, hit.baked!.depth, hit.baked!.data.length], c.name).toEqual([miss.baked!.gi, miss.baked!.depth, miss.baked!.data.length]);
      expect(same(hit.baked!.data, miss.baked!.data), `${c.name}: field`).toBe(true);
      if (c.probes) for (const k of ['atlas', 'meta', 'grid'] as const) expect(same(hit.probes![k], miss.probes![k]), `${c.name}: probes ${k}`).toBe(true);
      // plain shading: the field has no cube, and it is the cube bake's slots (the cube changes nothing before it)
      if (c.shading === 'plain') {
        expect(a.rt.status().active!.shadingReason).toBe(SOFTWARE_SHADING_REASON);
        const on = runtime({enhancedLighting: 'auto', reflections: 'off'}, null, HW), full = await load(on, threeLevels());
        expect(full.baked!.gi).toBe(miss.baked!.depth);
        expect(same(slotBytes(full.baked!), miss.baked!.data)).toBe(true);
        expect(same(withoutCube(full.baked!).data, miss.baked!.data)).toBe(true);
      }
    }
  }, 120000);

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
    expect(on.rt.status().active).toMatchObject({gi: 'high', shading: 'full', mirror: false, reflections: 'off', reflectionsReason: null, cache: 'miss', probes: 0, probeBytes: 0});
    expect(high.probes).toBeNull();
    expect([high.shading, high.mirror, high.bounce !== null]).toEqual(['full', false, true]); // (no mirror without reflections; the bounce needs none)
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
    // The versions of the cached data: whole numbers, and past what the first release of the cache wrote (entry 1, gather 1, probes 3)
    // — the rows became an ambient cube of 16-bit values, the probes read the cube: an entry of that release must never be read as
    // current (the entry version is in the address and in the bundle; gather and probes are in the address and the digests).
    expect(Object.keys(DERIVED_LIGHTING_VERSIONS).sort()).toEqual(['entry', 'gather', 'probes']);
    for (const v of Object.values(DERIVED_LIGHTING_VERSIONS)) expect(Number.isInteger(v)).toBe(true);
    expect(DERIVED_LIGHTING_VERSIONS.entry).toBeGreaterThan(1);
    expect(DERIVED_LIGHTING_VERSIONS.gather).toBeGreaterThan(1);
    expect(DERIVED_LIGHTING_VERSIONS.probes).toBeGreaterThan(3);
  });

  it('an entry of another entry version under the same address is not read: baked again and replaced', async () => {
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb);
    const first = await load(a, rooms());
    await settle(a, 1);
    // the same key, a bundle that claims another layout version (what an older build would have left there)
    const {key, bundle} = a.puts[0];
    expect(await a.cache()!.put(key, {meta: {...bundle.meta, v: DERIVED_LIGHTING_VERSIONS.entry - 1}, arrays: bundle.arrays}, 'old')).toBe(true);
    const b = runtime({}, idb);
    const again = await load(b, rooms());
    expect(b.rt.status().active!.cache).toBe('miss');
    expect(same(again.baked!.data, first.baked!.data)).toBe(true);
    await settle(b, 1);
    expect((await b.rt.cacheStats())!.entries).toBe(1);
    const c = runtime({}, idb);
    await load(c, rooms());
    expect(c.rt.status().active!.cache).toBe('hit');
  });
});

// ---------------------------------------------------------------------------------------------
describe('full shading where the field with its cube fits; else the same bake shaded plain, and it says why', () => {
  /** Slices of a station's field with its cube, as the runtime bounds it (every extended-header group slice counted). */
  const cubeDepth = (slots: number) => fieldDepth(slots) + MAX_GROUPS + giDepth(slots);

  it('3D textures shallower than the field with its cube: plain, with the reason — the probes stay, the cache entry is the plain one and the next load is a hit', async () => {
    // three levels, 80 x 50 cells: the probe grid fits a limit the field with its cube is deeper than
    const depth = cubeDepth(3), max3D = depth - 1;
    expect(max3D).toBeGreaterThanOrEqual(80);
    const caps = {...HW, max3DTextureSize: max3D};
    const idb = new FakeIndexedDb();
    const a = runtime({}, idb, caps);
    // (the plan is the renderer's, not the station's: it still asks for full shading — nothing is "pending" because a station cannot have it)
    expect(a.rt.plan(false)).toMatchObject({shading: 'full', mirror: true});
    const first = await load(a, threeLevels(), null, max3D);
    const reason = `this station's field with its cube (${depth} slices) is deeper than this renderer's 3D textures (${max3D})`;
    expect(a.rt.status().active).toMatchObject({gi: 'standard', shading: 'plain', shadingReason: reason, reflections: 'standard', mirror: true, cache: 'miss'});
    expect(a.rt.status().pending).toBe(false);
    expect([first.shading, first.mirror, first.bounce, first.baked!.gi]).toEqual(['plain', true, null, undefined]);
    expect(first.probes!.count).toBeGreaterThan(0);
    expect(describeEnhancedLighting(a.rt.status())).toBe(`This station: enhanced bake (standard), baked and cached — ${reason}`);
    expect(enhancedLightingLine(a.rt.status()).startsWith('auto: bake standard plain · refl standard ×')).toBe(true);
    await settle(a, 1);
    expect(a.puts[0].key.startsWith(`el${DERIVED_LIGHTING_VERSIONS.entry}-standard-plain-standard-`)).toBe(true);
    // the next load: prefetch and bake agree on that entry — a hit, the same bytes, never a "pending" change
    const b = runtime({}, idb, caps);
    const second = await load(b, threeLevels(), null, max3D);
    expect(b.rt.status()).toMatchObject({pending: false, active: {cache: 'hit', shading: 'plain', shadingReason: reason, giMs: 0, probeMs: 0}});
    expect(same(second.baked!.data, first.baked!.data)).toBe(true);
    expect(same(second.probes!.atlas, first.probes!.atlas)).toBe(true);
    expect(b.puts.length).toBe(0);
    // one slice more and the station is shaded in full: another entry (its probes are lit by the cube)
    const c = runtime({}, idb, {...HW, max3DTextureSize: depth});
    const full = await load(c, threeLevels(), null, depth);
    expect(c.rt.status().active).toMatchObject({shading: 'full', shadingReason: null, cache: 'miss'});
    expect([full.shading, full.bounce !== null, full.baked!.gi]).toEqual(['full', true, first.baked!.depth]);
    expect(full.baked!.depth).toBeLessThanOrEqual(depth);
    expect(same(slotBytes(full.baked!), first.baked!.data)).toBe(true); // (the same enhanced bake before the cube)
    expect(same(full.probes!.atlas, first.probes!.atlas)).toBe(false); // (probes lit through the cube are other probes)
    await settle(c, 1);
    expect((await c.rt.cacheStats())!.entries).toBe(2);
  }, 120000);

  it('a field whose cube would pass FIELD_CUBE_BYTES: plain, with the reason; the next load is a hit', async () => {
    // one level, mostly rock: a grid just wide enough for its field with the cube to pass the bound
    const depth = cubeDepth(1), side = Math.ceil(Math.sqrt(FIELD_CUBE_BYTES / (depth * 4))) + 1;
    expect(side).toBeLessThanOrEqual(HW.max3DTextureSize);
    const big = (): StationBakeInput => {
      const g = new Grid(side, side);
      for (let y = 1; y < 27; y++) for (let x = 1; x < 47; x++) { g.set(x, y, FLOOR); g.ceil[y * side + x] = 4.4; g.area[y * side + x] = 0; }
      const light = (x: number, z: number) => ({x, y: 4.35, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false});
      return {source: {grid: g, lights: [light(6, 7), light(18, 7)], trenchFloorY: -1.15}, params: {...DEFAULT_FIELD}, reactor: false, extra: ''};
    };
    const bytes = side * side * depth * 4;
    expect(bytes).toBeGreaterThan(FIELD_CUBE_BYTES);
    const idb = new FakeIndexedDb();
    const a = runtime({reflections: 'off'}, idb);
    const first = await load(a, big());
    const reason = `this station's field with its cube (${Math.round(bytes / 1e6)} MB) is past the ${Math.round(FIELD_CUBE_BYTES / 1e6)} MB bound`;
    expect(a.rt.status()).toMatchObject({pending: false, active: {gi: 'standard', shading: 'plain', shadingReason: reason, cache: 'miss'}});
    expect([first.shading, first.bounce, first.baked!.gi]).toEqual(['plain', null, undefined]);
    expect(first.baked!.data.length).toBeLessThan(FIELD_CUBE_BYTES);
    await settle(a, 1);
    const b = runtime({reflections: 'off'}, idb);
    const second = await load(b, big());
    expect(b.rt.status()).toMatchObject({pending: false, active: {cache: 'hit', shading: 'plain', shadingReason: reason}});
    expect(same(second.baked!.data, first.baked!.data)).toBe(true);
    // (a station of the usual size under the same settings is shaded in full)
    const c = runtime({reflections: 'off'});
    expect((await load(c, rooms())).shading).toBe('full');
  }, 120000);

  it('applied(): the station lighting could not keep the cube after all — the status turns plain with its reason, once', async () => {
    const r = runtime({});
    await load(r, rooms());
    expect(r.rt.status().active).toMatchObject({shading: 'full', shadingReason: null, reflections: 'standard', mirror: true});
    let heard = 0;
    r.rt.subscribe(() => { heard++; });
    r.rt.applied(null, null);
    r.rt.applied(null);
    expect(heard).toBe(0);
    const why = 'the field with its cube (90 slices) is deeper than this renderer\'s 3D textures (64)';
    r.rt.applied(null, why);
    expect(heard).toBe(1);
    const a = r.rt.status().active!;
    expect(a).toMatchObject({gi: 'standard', shading: 'plain', shadingReason: why, reflections: 'standard', mirror: true});
    expect(a.probes).toBeGreaterThan(0);
    expect(describeEnhancedLighting(r.rt.status())).toBe(`This station: enhanced bake (standard), baked and cached — ${why}`);
    expect(enhancedLightingLine(r.rt.status()).startsWith('auto: bake standard plain · refl standard ×')).toBe(true);
    expect(r.rt.status().pending).toBe(false); // (the plan did not change: nothing to apply)
    // already plain: nothing more to say
    r.rt.applied(null, 'another reason');
    expect(heard).toBe(1);
    expect(r.rt.status().active!.shadingReason).toBe(why);
    // both at once: the probes were not usable either — no reflections, no mirror
    await load(r, rooms());
    heard = 0;
    r.rt.applied('the renderer has no node library', why);
    expect(heard).toBe(1);
    expect(r.rt.status().active).toMatchObject({shading: 'plain', shadingReason: why, reflections: 'off', reflectionsReason: 'the renderer has no node library', mirror: false, probes: 0, probeBytes: 0});
    // a plan that is plain by itself (Auto on a software renderer) keeps its own reason
    const sw = runtime({}, null, SW);
    await load(sw, rooms());
    sw.rt.applied(null, why);
    expect(sw.rt.status().active).toMatchObject({shading: 'plain', shadingReason: SOFTWARE_SHADING_REASON});
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
    // (task studio-baked-gi-visual-uplift-20261115-004324-01: + the field bake itself, which now encodes the gathered cube, and the
    // flashlight's bounce, which reads the bake's ray scene and surface colours every frame)
    const bake = [
      'world/enhancedLightingRuntime.ts', 'world/lightFieldGather.ts', 'world/lightScene.ts', 'world/surfaceAlbedo.ts', 'world/reflectionProbes.ts', 'core/derivedCache.ts', 'core/contentHash.ts',
      'world/lightField.ts', 'world/flashBounce.ts',
    ];
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
    // (and the baseline shader: the enhanced bake without its cube, no mirror, no flashlight bounce)
    expect([a.shading, a.mirror, a.bounce, a.baked!.gi]).toEqual(['plain', false, null, undefined]);
    expect(auto.rt.status().active).toMatchObject({
      gi: 'standard', shading: 'plain', shadingReason: SOFTWARE_SHADING_REASON, mirror: false, reflections: 'off', reflectionsReason: SOFTWARE_REASON, probes: 0, probeBytes: 0, probeMs: 0,
    });
    expect(describeEnhancedLighting(auto.rt.status())).toContain(SOFTWARE_SHADING_REASON);
    const on = runtime({enhancedLighting: 'on', reflections: 'standard'}, null, SW);
    const b = await load(on, rooms());
    expect(b.probes!.count).toBeGreaterThan(0);
    expect([b.shading, b.mirror, b.bounce !== null, b.baked!.gi !== undefined]).toEqual(['full', true, true, true]);
    expect(on.rt.status().active).toMatchObject({gi: 'high', shading: 'full', shadingReason: null, mirror: true, reflections: 'standard', reflectionsReason: null});
  });

  it('before the renderer reported its capabilities nothing but the bake is planned; a station larger than the 3D texture limit says so', async () => {
    const early = new EnhancedLightingRuntime({});
    expect(early.plan(false)).toMatchObject({shading: 'plain', shadingReason: 'the renderer is not ready', reflections: null, mirror: false, reflectionsReason: 'the renderer is not ready'});
    expect(early.plan(false).gi?.id).toBe('standard');
    const r = runtime({}, null, {...HW, max3DTextureSize: 32});
    const out = await load(r, rooms(), null, 32); // the grid is 48 cells wide, its field with the cube deeper than 32 slices
    expect(out.probes).toBeNull();
    expect(out.baked).toBeDefined();
    expect([out.shading, out.mirror, out.bounce, out.baked!.gi]).toEqual(['plain', false, null, undefined]);
    expect(r.rt.status().active!.reflections).toBe('off');
    expect(r.rt.status().active!.reflectionsReason).toMatch(/larger than this renderer's 3D textures \(32\)/);
    expect(r.rt.status().active!.shadingReason).toMatch(/deeper than this renderer's 3D textures \(32\)/);
    expect(r.rt.status().pending).toBe(false);
  });

  it('lightingCapabilities reads the backend\'s own limits, never memory', () => {
    expect(lightingCapabilities({device: {limits: {maxTextureDimension2D: 8192}}}, 'webgpu', false, 2048))
      .toEqual({backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true});
    const gl = {MAX_TEXTURE_SIZE: 0x0d33, getParameter: (p: number) => (p === 0x0d33 ? 4096 : 0)};
    expect(lightingCapabilities({gl}, 'webgl2', true, 256)).toEqual({backend: 'webgl2', software: true, maxTextureSize: 4096, max3DTextureSize: 256, halfFloatLinear: true});
    expect(lightingCapabilities(null, null, false, 0)).toEqual({backend: null, software: false, maxTextureSize: 0, max3DTextureSize: 0, halfFloatLinear: false});
    expect(lightingCapabilities({gl: {MAX_TEXTURE_SIZE: 1, getParameter: () => { throw new Error('lost'); }}}, 'webgl2', false, 256).maxTextureSize).toBe(0);
    // nothing that plans, bakes, binds or shades the lighting asks the machine how much memory it has, or what browser it is: the
    // decisions are the renderer's own limits (texture sizes) and fixed byte bounds
    for (const f of ['enhancedLightingRuntime', 'enhancedLighting', 'lightField', 'lightFieldGather', 'lightFieldNode', 'lights', 'flashBounce', 'reflectionNode', 'reflectionProbes']) {
      const src = readFileSync(new URL(`../src/world/${f}.ts`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/deviceMemory|jsHeapSizeLimit|hardwareConcurrency|\bnavigator\b|VRAM|userAgent/);
    }
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

  it('while a rebuild in place runs, the status says what the station is still lit by — and the new lighting from the swap on', async () => {
    const settings: EnhancedLightingSettings = {enhancedLighting: 'auto', reflections: 'standard'};
    const r = runtime(settings);
    await load(r, rooms());
    const before = r.rt.status().active!;
    expect(before).toMatchObject({gi: 'standard', reflections: 'standard'});
    let heard = 0;
    r.rt.subscribe(() => { heard++; });

    // Off: bakeSteps writes the baseline record at its first step, before the station lighting is swapped (the baseline bake runs
    // in between). Until the swap the station still has the enhanced lighting, and the status says so
    settings.enhancedLighting = 'off';
    r.rt.setApplying(true);
    r.rt.checkpoint();
    expect(drainSync(r.rt.bakeSteps(rooms(), null, {max3DTextureSize: 2048})).baked).toBeUndefined();
    expect(r.rt.status()).toMatchObject({applying: true, pending: false, active: before});
    expect(describeEnhancedLighting(r.rt.status())).toMatch(/^This station: enhanced bake \(standard\), .*\. Rebuilding this station's lighting…$/);
    expect(describeEnhancedLighting(r.rt.status()).endsWith(APPLYING_NOTE)).toBe(true);
    let n = heard;
    r.rt.applied(null); // (the swap: world/lights.ts replaceSteps returned)
    expect(heard, 'the forms hear the swap').toBe(n + 1);
    expect(r.rt.status()).toMatchObject({applying: true, pending: false, active: {gi: 'baseline', reflections: 'off'}});
    expect(describeEnhancedLighting(r.rt.status())).toBe(`This station: baseline lighting. ${APPLYING_NOTE}`); // (the warm-up still runs)
    r.rt.setApplying(false);
    expect(r.rt.status()).toMatchObject({applying: false, pending: false, active: {gi: 'baseline', reflections: 'off'}});

    // On again, with the probes: the record is written at the END of the bake — still before the swap
    settings.enhancedLighting = 'auto';
    r.rt.setApplying(true);
    r.rt.checkpoint();
    expect((await load(r, rooms())).baked).toBeDefined();
    expect(r.rt.status()).toMatchObject({applying: true, active: {gi: 'baseline', reflections: 'off'}});
    r.rt.applied(null);
    expect(r.rt.status()).toMatchObject({applying: true, active: {gi: 'standard', reflections: 'standard'}});
    r.rt.setApplying(false);

    // a rebuild that ends without a swap (the station was replaced, a lost device): nothing of the checkpoint outlives it
    settings.enhancedLighting = 'off';
    r.rt.setApplying(true);
    const undo = r.rt.checkpoint();
    drainSync(r.rt.bakeSteps(rooms(), null, {max3DTextureSize: 2048}));
    undo();
    r.rt.setApplying(false);
    expect(r.rt.status()).toMatchObject({applying: false, pending: true, active: {gi: 'standard', reflections: 'standard'}});
    r.rt.setApplying(true);
    r.rt.checkpoint();
    r.rt.setApplying(false); // (ended before any bake step)
    drainSync(r.rt.bakeSteps(rooms(), null, {max3DTextureSize: 2048})); // a station LOAD: its record is the status at once
    expect(r.rt.status()).toMatchObject({applying: false, pending: false, active: {gi: 'baseline'}});
    // …and applied() with nothing to report stays silent there, as before
    n = heard;
    r.rt.applied(null);
    expect(heard).toBe(n);
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
    expect(a.rt.status().active).toMatchObject({gi: 'standard', shading: 'full', shadingReason: null, mirror: true, reflections: 'standard', cache: 'miss'});
    expect([first.shading, first.mirror]).toEqual(['full', true]);
    expect(first.probes!.count).toBeGreaterThan(8);
    expect(first.probes!.count).toBeLessThanOrEqual(192);
    // the field with its cube: the baseline's slots in number, then giDepth more slices; within the byte bound; nothing clipped
    const baseline = bakeLightField(stationFieldSource(layout), StationLighting.fieldParams({}));
    expect([first.baked!.gi, first.baked!.depth]).toEqual([baseline.depth, baseline.depth + giDepth(baseline.slots)]);
    expect(first.baked!.data.length).toBeLessThanOrEqual(FIELD_CUBE_BYTES);
    expect(first.baked!.stats.cubeClipped).toBe(0);
    expect(first.bounce!.scene).toBeInstanceOf(BandScene);

    const scene = new THREE.Scene();
    const opts = {hemi: new THREE.HemisphereLight(), fogDensity: MOOD.fogDensity, far: 70, max3DTextureSize: 2048, renderer: fakeRenderer()};
    const lit = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, ...handed(first)}));
    a.rt.applied(lit.reflectionsSkipped, lit.shadingSkipped);
    expect([lit.reflectionsSkipped, lit.shadingSkipped]).toEqual([null, null]);
    // full shading with probes and the mirror: that light, alone, in the scene; the cube on the GPU; the flashlight bounce bound
    expect([lit.full, lit.mirror]).toEqual([true, true]);
    expect(lit.fieldLight === stationReflectLight(true, true)).toBe(true);
    expect(fieldLightsIn(scene).map(l => l.name)).toEqual([stationReflectLight(true, true).name]);
    expect(activeReflectionProbes() === lit.reflections).toBe(true);
    expect(REFL.atlas.value === lit.reflections!.atlas).toBe(true);
    expect(REFL.params.value.x).toBe(1);
    expect(lit.field === first.baked).toBe(true); // full resolution: the bake is the field, cube and all
    expect(LF.cube.value.toArray()).toEqual([first.baked!.gi, 1]);
    expect([FLASH_BOUNCE.debug().bound, bounceSource() === first.bounce]).toEqual([true, true]);
    expect(a.rt.status().active).toMatchObject({shading: 'full', reflections: 'standard', mirror: true});

    // "death -> reload": the old lighting retires, the same station loads again — from the cache, to the same bytes
    await settle(a, 1);
    const retired: (() => void)[] = [];
    lit.dispose(scene, f => retired.push(f));
    expect(activeReflectionProbes()).toBeNull();
    expect(REFL.params.value.x).toBe(0);
    expect(fieldLightsIn(scene)).toEqual([]);
    expect([FLASH_BOUNCE.debug().bound, LF.cube.value.toArray()]).toEqual([false, [0, 0]]);
    const second = await load(a, stationBakeInput(layout), world.drawn);
    expect(a.rt.status().active).toMatchObject({cache: 'hit', shading: 'full', mirror: true, giMs: 0, probeMs: 0});
    expect(same(second.baked!.data, first.baked!.data)).toBe(true);
    for (const k of ['atlas', 'meta', 'grid'] as const) expect(same(second.probes![k], first.probes![k]), k).toBe(true);
    expect([second.shading, second.mirror, second.bounce !== null, second.bounce !== first.bounce]).toEqual(['full', true, true, true]);
    const lit2 = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, ...handed(second)}));
    expect(activeReflectionProbes() === lit2.reflections).toBe(true);
    expect([FLASH_BOUNCE.debug().bound, bounceSource() === second.bounce]).toEqual([true, true]);
    const disposed: string[] = [];
    for (const tex of [lit.reflections!.atlas, lit.reflections!.meta, lit.reflections!.grid]) tex.addEventListener('dispose', () => disposed.push(tex.name));
    for (const f of retired) f(); // the old station's GPU objects go after the new one is bound
    expect(disposed.sort()).toEqual(['reflection-atlas', 'reflection-grid', 'reflection-meta']);
    expect(activeReflectionProbes() === lit2.reflections).toBe(true);
    expect(REFL.atlas.value === lit2.reflections!.atlas).toBe(true);
    expect([FLASH_BOUNCE.debug().bound, LF.cube.value.toArray()]).toEqual([true, [second.baked!.gi, 1]]);

    // a renderer whose 3D textures are too small for the probe grid (the field is downsampled to fit, its cube with it): the full
    // light WITHOUT reflections, and the reason — no mirror without probes; the bounce stays
    lit2.dispose(scene);
    const small = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, max3DTextureSize: 256, ...handed(second)}));
    expect(small.reflections).toBeNull();
    expect(small.reflectionsSkipped).toMatch(/larger than this renderer's 3D textures \(256\)/);
    expect([small.full, small.shadingSkipped, small.mirror]).toEqual([true, null, false]);
    expect(small.fieldLight === stationFieldLight(true)).toBe(true);
    expect(fieldLightsIn(scene).map(l => l.name)).toEqual([stationFieldLight(true).name]);
    expect([small.field.gi, small.field.depth, Math.max(small.field.w, small.field.h) <= 256]).toEqual([second.baked!.gi, second.baked!.depth, true]);
    expect(FLASH_BOUNCE.debug().bound).toBe(true);
    a.rt.applied(small.reflectionsSkipped, small.shadingSkipped);
    expect(a.rt.status().active).toMatchObject({shading: 'full', reflections: 'off', mirror: false, probes: 0});
    small.dispose(scene);

    // 3D textures shallower than the field with its cube: the cube is left out — the plain light over the same enhanced slots, no
    // bounce — and the status says why
    const max = second.baked!.depth - 1;
    const shallow = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, max3DTextureSize: max, ...handed(second)}));
    expect(shallow.shadingSkipped).toBe(`the field with its cube (${second.baked!.depth} slices) is deeper than this renderer's 3D textures (${max})`);
    expect([shallow.full, shallow.bounce, shallow.field.gi, shallow.field.depth]).toEqual([false, null, undefined, second.baked!.gi]);
    expect(shallow.fieldLight === stationFieldLight()).toBe(true);
    expect([FLASH_BOUNCE.debug().bound, LF.cube.value.toArray()]).toEqual([false, [0, 0]]);
    a.rt.applied(shallow.reflectionsSkipped, shallow.shadingSkipped);
    expect(a.rt.status().active).toMatchObject({gi: 'standard', shading: 'plain', shadingReason: shallow.shadingSkipped, reflections: 'off'});
    shallow.dispose(scene);

    // Enhanced lighting Off: the baseline bake, the plain light, no probe bound, no cube, no bounce
    settings.enhancedLighting = 'off';
    const off = await load(a, stationBakeInput(layout), world.drawn);
    expect(off).toEqual(NOT_ENHANCED);
    const plain = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts, ...handed(off)}));
    expect(plain.fieldLight === stationFieldLight()).toBe(true);
    expect(fieldLightsIn(scene).map(l => l.name)).toEqual([stationFieldLight().name]);
    expect([plain.reflections, plain.full, plain.mirror, plain.bounce, plain.shadingSkipped]).toEqual([null, false, false, null, null]);
    expect(activeReflectionProbes()).toBeNull();
    expect([FLASH_BOUNCE.debug().bound, LF.cube.value.toArray(), plain.field.gi]).toEqual([false, [0, 0], undefined]);
    expect(same(plain.field.data, baseline.data)).toBe(true);
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
    expect([enhanced.shading, enhanced.mirror, enhanced.bounce !== null]).toEqual(['full', true, true]);
    const scene = new THREE.Scene();
    const opts = {hemi: new THREE.HemisphereLight(), fogDensity: MOOD.fogDensity, far: 70, max3DTextureSize: 2048, renderer: fakeRenderer()};
    /** The station field lights in the scene, by name (one, always: the light of what lights the station). */
    const lightNames = () => fieldLightsIn(scene).map(l => l.name);
    const PLAIN = stationFieldLight().name, FULL_REFLECT = stationReflectLight(true, true).name;
    /** The live glow cards are exactly `l`'s. */
    const glowsOf = (l: StationLighting) => { const g = scene.children.filter(c => c.name === 'light-glow'); return g.length === 1 && g[0] === l.glow; };
    const clock = (l: StationLighting) => (l as unknown as {t: number}).t;
    /** What is bound: the field, the probes, the cube's place in the field, the flashlight bounce. */
    const boundTo = (l: StationLighting) => [activeLightField() === l.volume, activeReflectionProbes() === l.reflections, LF.cube.value.toArray(), FLASH_BOUNCE.debug().bound, bounceSource() === l.bounce];
    const gi = enhanced.baked!.gi!;
    const baseline = bakeLightField(stationFieldSource(layout), StationLighting.fieldParams({}));

    // the station as it stands: the baseline lighting, its flicker clock running, a circuit held by an override
    const plain = drainSync(StationLighting.steps(scene, layout, world.fixtures, world.tubes, {...opts}));
    plain.circuitLevel = [null, 0.25, null];
    for (let i = 0; i < 90; i++) plain.update(1 / 60);
    expect(plain.levels[1]).toBe(0.25);
    expect(lightNames()).toEqual([PLAIN]);
    expect(glowsOf(plain)).toBe(true);
    expect(boundTo(plain)).toEqual([true, true, [0, 0], false, true]);
    const levels0 = [...plain.levels], t0 = clock(plain);
    expect(t0).toBeCloseTo(1.5, 6);

    // 1. Off -> On with reflections: the full reflecting light with the mirror, the probes and the flashlight bounce bound, the same
    //    clock and levels; the old lighting's GPU objects are handed to `retire` (the game runs them after the warm-up), nothing is
    //    released inside the step
    const retired: (() => void)[] = [];
    const releasedPlain = vi.spyOn(plain.volume, 'dispose');
    const r1 = drainSync(StationLighting.replaceSteps(plain, {...opts, ...handed(enhanced)}, f => retired.push(f)));
    const lit = r1.lighting;
    expect(r1.error).toBeNull();
    expect(lit !== plain).toBe(true);
    expect([lit.fieldLight === stationReflectLight(true, true), lit.full, lit.mirror, lit.shadingSkipped, lit.reflectionsSkipped]).toEqual([true, true, true, null, null]);
    expect(lightNames()).toEqual([FULL_REFLECT]);
    expect(boundTo(lit)).toEqual([true, true, [gi, 1], true, true]);
    expect([lit.field === enhanced.baked, lit.bounce === enhanced.bounce]).toEqual([true, true]);
    expect([clock(lit), lit.circuitLevel, [...lit.levels]]).toEqual([t0, [null, 0.25, null], levels0]);
    expect(glowsOf(lit)).toBe(true);
    expect(retired).toHaveLength(1);
    expect(releasedPlain).not.toHaveBeenCalled();
    for (const f of retired.splice(0)) f();
    expect(releasedPlain).toHaveBeenCalledTimes(1);
    expect(boundTo(lit), 'releasing the old field leaves the new one, its cube and its bounce bound').toEqual([true, true, [gi, 1], true, true]);

    // 2. Standard -> another bake with probes: the SAME session-wide reflecting light stays in the scene (the old lighting's dispose
    //    takes it out, the new one is put back) — and the flashlight bounce is bound to what the NEW lighting traces (the old
    //    lighting's dispose must not unbind it)
    const again = {...enhanced.bounce!};
    const r2 = drainSync(StationLighting.replaceSteps(lit, {...opts, ...handed(enhanced), bounce: again}, f => retired.push(f)));
    expect(r2.error).toBeNull();
    expect(r2.lighting.fieldLight === stationReflectLight(true, true)).toBe(true);
    expect(lightNames()).toEqual([FULL_REFLECT]);
    expect(boundTo(r2.lighting)).toEqual([true, true, [gi, 1], true, true]);
    expect([r2.lighting.bounce === again, bounceSource() === again, activeReflectionProbes() !== lit.reflections]).toEqual([true, true, true]);
    expect(glowsOf(r2.lighting)).toBe(true);
    for (const f of retired.splice(0)) f();
    expect(boundTo(r2.lighting)).toEqual([true, true, [gi, 1], true, true]);

    // (the same double failure as 5 below, over a lighting WITH probes, cube and bounce: it stands as it stood, all of them bound —
    // the failed lighting had bound its own bounce, the failed baseline none)
    const hemiDead = new THREE.HemisphereLight();
    Object.defineProperty(hemiDead, 'intensity', {get: () => 1, set: () => { throw new Error('simulated: nothing installs'); }});
    expect(() => drainSync(StationLighting.replaceSteps(r2.lighting, {...opts, hemi: hemiDead, ...handed(enhanced), bounce: {...again}}, f => retired.push(f)))).toThrow('simulated: nothing installs');
    expect(lightNames()).toEqual([FULL_REFLECT]);
    expect(boundTo(r2.lighting)).toEqual([true, true, [gi, 1], true, true]);
    expect(bounceSource() === again).toBe(true);
    expect(REFL.atlas.value === r2.lighting.reflections!.atlas).toBe(true);
    expect(glowsOf(r2.lighting)).toBe(true);
    expect(retired).toHaveLength(0);

    // 3. the planned lighting cannot be installed (it throws after its light is in the scene and its textures are bound): the station
    //    gets the BASELINE lighting, the error is reported, and nothing of the failed one is left behind — no light, no cube, no bounce
    let throwsLeft = 1;
    const hemiOnce = new THREE.HemisphereLight();
    Object.defineProperty(hemiOnce, 'intensity', {get: () => 1, set: () => { if (throwsLeft-- > 0) throw new Error('simulated install failure'); }});
    const r3 = drainSync(StationLighting.replaceSteps(r2.lighting, {...opts, hemi: hemiOnce, ...handed(enhanced)}, f => retired.push(f)));
    expect(String((r3.error as Error).message)).toBe('simulated install failure');
    const base = r3.lighting;
    expect([base.fieldLight === stationFieldLight(), base.reflections, base.full, base.mirror, base.bounce, base.field.gi]).toEqual([true, null, false, false, null, undefined]);
    expect(lightNames(), 'the failed lighting\'s reflecting light is not left beside the baseline\'s').toEqual([PLAIN]);
    expect(boundTo(base)).toEqual([true, true, [0, 0], false, true]);
    expect(activeReflectionProbes()).toBeNull();
    expect(REFL.params.value.x).toBe(0);
    expect(glowsOf(base)).toBe(true);
    expect(same(base.field.data, baseline.data)).toBe(true);
    expect([clock(base), [...base.levels]]).toEqual([t0, levels0]);
    expect(retired, 'the replaced lighting is released once').toHaveLength(1);
    for (const f of retired.splice(0)) f();

    // 4. …and when it fails at its very end, its glow cards already in the scene: they go too (one set of cards, the baseline's)
    const tubes = world.tubes!;
    expect(base.glow).not.toBeNull();
    let tubeThrows = 1, cardSets = 0;
    const setColorAt = tubes.setColorAt;
    tubes.setColorAt = function (this: THREE.InstancedMesh, i: number, c: THREE.Color) { if (tubeThrows-- > 0) throw new Error('simulated late install failure'); return setColorAt.call(this, i, c); } as typeof tubes.setColorAt;
    const add = scene.add;
    scene.add = function (this: THREE.Scene, ...o: THREE.Object3D[]) { for (const x of o) if (x.name === 'light-glow') cardSets++; return add.apply(this, o); } as typeof scene.add;
    const r4 = drainSync(StationLighting.replaceSteps(base, {...opts, ...handed(enhanced)}, f => retired.push(f)));
    tubes.setColorAt = setColorAt;
    scene.add = add;
    const late = r4.lighting;
    expect(String((r4.error as Error).message)).toBe('simulated late install failure');
    expect(cardSets, 'the failed lighting had put its cards in, then the baseline put its own').toBe(2);
    expect([glowsOf(late), late.glow !== base.glow]).toEqual([true, true]);
    expect(lightNames()).toEqual([PLAIN]);
    expect([late.reflections, late.full, late.bounce]).toEqual([null, false, null]);
    expect(boundTo(late)).toEqual([true, true, [0, 0], false, true]);
    expect([clock(late), [...late.levels]]).toEqual([t0, levels0]);
    expect(world.fixtures.map(f => f.level), 'the fixtures carry the levels').toEqual(world.fixtures.map((_, i) => late.fixtureLevel(i)));
    expect(retired).toHaveLength(1);
    for (const f of retired.splice(0)) f();

    // 5. neither the planned lighting nor the baseline can be installed: the step throws the FIRST error and the old lighting stands
    //    exactly as it stood — in the scene, bound, not released; the failed lighting's cube and bounce are bound no longer
    const releasedLate = vi.spyOn(late.volume, 'dispose');
    expect(() => drainSync(StationLighting.replaceSteps(late, {...opts, hemi: hemiDead, ...handed(enhanced)}, f => retired.push(f)))).toThrow('simulated: nothing installs');
    expect(lightNames()).toEqual([PLAIN]);
    expect(boundTo(late)).toEqual([true, true, [0, 0], false, true]);
    expect(activeReflectionProbes()).toBeNull();
    expect(glowsOf(late)).toBe(true);
    expect(retired).toHaveLength(0);
    expect(releasedLate).not.toHaveBeenCalled();
    expect([clock(late), [...late.levels]]).toEqual([t0, levels0]);
    late.update(1 / 60); // (still a working lighting)

    // 6. …and the next change installs: full again, bound again; then the enhanced bake shaded PLAIN (what a software renderer is
    //    given under Auto): the plain light over the enhanced slots, the cube not on the GPU, no bounce
    const r6 = drainSync(StationLighting.replaceSteps(late, {...opts, ...handed(enhanced)}, f => retired.push(f)));
    expect(r6.error).toBeNull();
    expect(lightNames()).toEqual([FULL_REFLECT]);
    expect(boundTo(r6.lighting)).toEqual([true, true, [gi, 1], true, true]);
    for (const f of retired.splice(0)) f();
    const r7 = drainSync(StationLighting.replaceSteps(r6.lighting, {...opts, baked: enhanced.baked, probes: null, shading: 'plain', mirror: false, bounce: enhanced.bounce}, f => retired.push(f)));
    const flat = r7.lighting;
    expect(r7.error).toBeNull();
    expect([flat.fieldLight === stationFieldLight(), flat.full, flat.mirror, flat.bounce, flat.shadingSkipped, flat.field.gi, flat.field.depth]).toEqual([true, false, false, null, null, undefined, gi]);
    expect(lightNames()).toEqual([PLAIN]);
    expect(boundTo(flat)).toEqual([true, true, [0, 0], false, true]);
    expect(same(flat.field.data, slotBytes(enhanced.baked!)), 'the enhanced slots as baked: the cube is a view left out, nothing is baked again').toBe(true);
    expect(same(flat.field.data, baseline.data), 'not the baseline').toBe(false);
    for (const f of retired.splice(0)) f();

    // 7. Off: the baseline bake, baked here — its bytes, the plain light, nothing of the enhanced lighting bound; then released
    const r8 = drainSync(StationLighting.replaceSteps(flat, {...opts, ...handed(NOT_ENHANCED)}, f => retired.push(f)));
    expect(r8.error).toBeNull();
    expect(lightNames()).toEqual([PLAIN]);
    expect(boundTo(r8.lighting)).toEqual([true, true, [0, 0], false, true]);
    expect(same(r8.lighting.field.data, baseline.data)).toBe(true);
    expect([clock(r8.lighting), [...r8.lighting.levels]]).toEqual([clock(late), [...late.levels]]);
    for (const f of retired.splice(0)) f();
    r8.lighting.dispose(scene);
    expect([lightNames(), activeLightField(), activeReflectionProbes(), FLASH_BOUNCE.debug().bound]).toEqual([[], null, null, false]);
  }, 240000);
});
