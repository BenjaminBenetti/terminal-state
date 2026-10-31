// Task office-seamless-20261029 (ENGINE): the engine with N storeys, on a SYNTHETIC 9-storey tower (tests/helpers/
// towerFixture.ts: station + lobby + 7 office floors stacked 4.4 m apart over one footprint, joined by a scissor stair of
// straight runs alternating between two lanes, each run carved into both grids with a LevelLink).
//  - light field: 9 slots, up to 9 bands per column (extended column header); the CPU slot pick for every storey at several
//    heights, per-slot header precision, light on every storey (no fixture clamped to slot 3), no leak through slabs, the
//    cross-level flood is exact, downsampling;
//  - the GENERATED GLSL of the TSL decode (lfBandAt / lfSlotAt) evaluated on the CPU against fieldSlot, tower and Subway;
//  - fog density / air maps, decay field over every storey;
//  - level culling per storey (flights tagged to their two storeys, portal hops up the stair), the warm-up still plans
//    culled meshes, culling never touches world state;
//  - A* from storey 0 to storey 8 within the game's expansion budget; 3D hearing attenuated per slab;
//  - the REAL Office Space layout (LEVELS.office.generate('main')): ~1000 fixtures in one bake under budget, every storey
//    picks its own slot, A* from the platform to every storey within the game budget, portals between consecutive storeys;
//    task office-overhaul-20261030 (lane STRUCT): 10 storeys — the open-sky ROOF (level 9) packs its own light-field slot / band,
//    is lit by its fixture-less daylight, joins floor 8 by a portal through the access hatch, is never on an AI route, and
//    the station <-> lobby portal is the transit hall's box;
//  - Subway regression: the iteration-08 bytes of the render fixture and a generated station's field, density, air and
//    decay maps are unchanged (FNV-1a pinned before the N-storey engine change).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GLSLNodeBuilder, NodeMaterial, QuadMesh} from 'three/webgpu';
import {uniform, vec4} from 'three/tsl';
import {TOWER, landingOf, storeyCeil, storeyY, towerFixture} from './helpers/towerFixture';
import {FIX as RFIX, levelFixture as renderFixture} from './helpers/levelRenderFixture';
import {rendererFor} from './helpers/fogCompile';
import {arrayVal, mainBody, runFlow, type Env, type Val} from './helpers/glslEval';
import {installCanvasShim} from './helpers/canvas2d';
import {CELL, FLOOR, PathFinder} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {generateStation} from '../src/gen/station';
import {coreView} from '../src/gen/trackExt/index';
import type {StationLayout} from '../src/gen/stationTypes';
import {TRACK_EXT_RESERVE_OFF} from './helpers/trackExtCore';
import {levelIssues} from '../src/gen/levelGen';
import {
  LightFieldVolume, MAX_BANDS, MAX_SLOTS, bakeLightField, columnMask, downsampleField, fieldDepth, fieldSlot, isExtendedHeader, levelGeometries,
  sampleField, slotBase, slotLayers, slotRange, type BakedField, type FieldSource,
} from '../src/world/lightField';
import {LF, bindLightField, boundSlotRanges, lfBandAt, lfSlotAt} from '../src/world/lightFieldNode';
import {ATMOSPHERE, atmosphereFor, buildAirMap, buildDensityMap, densityLayerRange, densitySlot, sampleDensityMap} from '../src/render/atmosphere';
import {LEVEL_WETNESS, buildDecayField, fitDecayField, sampleDecay} from '../src/world/decay';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, STAIR_LEVEL} from '../src/world/builder';
import {planWarmup} from '../src/render/warmup';
import {HEARING, ZombieBrain, hearingMuffle, slabsBetween} from '../src/ai/brain';
import {LEVELS} from '../src/levels/registry';
import {LevelColumns, stationLevels} from '../src/world/levelGeometry';
import {CULL_LAYER, LevelCuller} from '../src/world/levelCulling';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {FlareLight} from '../src/world/flareLight';
import {FLARE} from '../src/weapons/throwables';

const fnv = (bytes: ArrayLike<number>): string => {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i] & 255; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
};
const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const irr = (f: BakedField, x: number, y: number, z: number) => { const s = sampleField(f, x, y, z, [1, 1, 1], [0, 1, 0]); return lum(s.amb) + lum(s.dirColor) * Math.max(0, s.dir[1]); };

const T = towerFixture();
const src = (lights = T.layout.lights, o: Partial<FieldSource> = {}): FieldSource => ({grid: T.layout.grid, lights, trenchFloorY: -1.15, levels: T.levels, ...o});
let baked: {f: BakedField; ms: number} | null = null;
const tower = () => {
  if (!baked) { const t0 = performance.now(); const f = bakeLightField(src()); baked = {f, ms: performance.now() - t0}; }
  return baked;
};
/** Room columns of the floor plate (every `step` cells), away from its walls. */
const roomCols = (step = 5): [number, number][] => {
  const out: [number, number][] = [];
  for (let cy = TOWER.room.y + 1; cy < TOWER.room.y + TOWER.room.h - 1; cy += step) for (let cx = TOWER.room.x + 1; cx < TOWER.room.x + TOWER.room.w - 1; cx += step) out.push([cx, cy]);
  return out;
};

// ---------------------------------------------------------------------------------------------
describe('light field over 9 storeys (extended column headers)', () => {
  it('holds a slot per storey and every band of the tower columns; bounded bake', () => {
    const {f, ms} = tower();
    expect(T.levels.length).toBe(9);
    expect(storeyY(8)).toBeCloseTo(36.4, 6);
    expect(f.slots).toBe(9);
    expect(f.stats.bands).toBe(9); // station + lobby + 7 office floors in every floor-plate column
    expect(f.hdr).toBe(3); // ceil(9 / 3) group slices after the slots
    expect(f.depth).toBe(fieldDepth(9) + 3);
    expect(f.stats.cut).toBe(0);
    expect(f.stats.extCols).toBeGreaterThan(TOWER.room.w * TOWER.room.h * 0.9);
    expect(MAX_SLOTS).toBeGreaterThanOrEqual(10);
    expect(MAX_BANDS).toBeGreaterThanOrEqual(10);
    // the reachability flood skips almost every cross-level ray in a stack of closed storeys
    expect(f.stats.crossCulled).toBeGreaterThan(f.stats.crossRays * 4);
    console.log(`9-storey tower bake: ${ms.toFixed(0)} ms, ${f.stats.working} fixtures, ${f.w}x${f.h}x${f.depth}, ${(f.stats.bytes / 1e6).toFixed(1)} MB, rays ${f.stats.rays}, cross ${f.stats.crossRays} (culled ${f.stats.crossCulled})`);
    expect(ms).toBeLessThan(20000);
  });

  it('the cross-level flood is exact: identical bytes with every cross ray traced', () => {
    const lights = T.layout.lights.filter((_, i) => i % 3 === 0);
    const a = bakeLightField(src(lights)), b = bakeLightField(src(lights, {crossCull: false}));
    expect(b.stats.crossCulled).toBe(0);
    expect(a.stats.crossRays).toBeLessThan(b.stats.crossRays);
    expect(fnv(a.data)).toBe(fnv(b.data));
  });

  it('the CPU slot pick names each storey at several heights in every floor-plate column, floors / ceilings to a few cm', () => {
    const {f} = tower();
    let n = 0;
    for (let L = 0; L < 9; L++) {
      const [lo, hi] = slotRange(f, L), step = (hi - lo) / 255;
      expect(step, `slot ${L} header step`).toBeLessThan(0.06); // per-slot range incl. its stair runs (one 42 m range: 0.17 m)
      for (const [ci, cj] of roomCols()) for (const y of [storeyY(L) + 0.05, storeyY(L) + 1.5, storeyCeil(L) - 0.1]) {
        const r = fieldSlot(f, ci, cj, y);
        expect(r.slot, `storey ${L} column ${ci},${cj} y ${y.toFixed(2)}`).toBe(L);
        expect(Math.abs(r.floor - storeyY(L))).toBeLessThanOrEqual(step / 2 + 1e-9);
        expect(Math.abs(r.ceil - storeyCeil(L))).toBeLessThanOrEqual(step / 2 + 1e-9);
        n++;
      }
    }
    expect(n).toBeGreaterThan(9 * 3 * 60);
  });

  it('every band of every column (stair lanes, landings, floor plates) picks its own slot at mid-height', () => {
    const {f} = tower();
    const geos = levelGeometries(src());
    let checked = 0, deep = 0;
    for (let cj = 0; cj < f.h; cj++) for (let ci = 0; ci < f.w; ci++) {
      const i = cj * f.w + ci, mask = columnMask(f, i);
      const bands = geos.map((g, s) => ({s, open: (mask >> s) & 1, f: g.floorH[i], c: g.ceilH[i]})).filter(b => b.open);
      if (bands.length > 3) deep++;
      for (const b of bands) {
        expect(fieldSlot(f, ci, cj, (b.f + b.c) / 2).slot, `column ${ci},${cj} band of slot ${b.s}`).toBe(b.s);
        checked++;
      }
    }
    expect(deep).toBeGreaterThan(2000);
    expect(checked).toBeGreaterThan(20000);
    // the scissor lanes: four runs stacked in each lane column, alternating slots
    const laneA = (TOWER.laneA + 1) * f.w + TOWER.lane.x0 + 9, laneB = (TOWER.laneB + 1) * f.w + TOWER.lane.x0 + 9;
    expect(isExtendedHeader(f.data[laneA * 4 + 3]) && f.data[laneA * 4 + 3]).toBe(4);
    expect(isExtendedHeader(f.data[laneB * 4 + 3]) && f.data[laneB * 4 + 3]).toBe(4);
  });

  it('every storey is lit by its own fixtures (none clamped to slot 3); no light through the slabs', () => {
    const {f} = tower();
    for (let L = 0; L < 9; L++) expect(irr(f, 12, storeyY(L) + 0.05, 8), `storey ${L}`).toBeGreaterThan(0.3);
    // only storey 5's fixtures: storeys 4 and 6 stay exactly dark under / over its floor plate, storey 5 is lit
    const only5 = bakeLightField(src(T.layout.lights.filter(l => l.level === 5)));
    const at = (L: number, x: number, z: number) => { const s = sampleField(only5, x, storeyY(L) + 0.05, z, [1, 1, 1], [0, 1, 0]); return [...s.amb, ...s.dirColor]; };
    for (const [x, z] of [[6, 4], [20, 8], [34, 12]]) {
      expect(at(4, x, z).every(v => v === 0), `storey 4 at ${x},${z}`).toBe(true);
      expect(at(6, x, z).every(v => v === 0), `storey 6 at ${x},${z}`).toBe(true);
      expect(lum(at(5, x, z)), `storey 5 at ${x},${z}`).toBeGreaterThan(0.1);
    }
  });

  it('the CPU sample reproduces the baked texels of the office slots (texel centres, layer heights)', () => {
    const {f} = tower();
    const dec = (b: number) => (b / 255) ** 2 * 12;
    let n = 0;
    for (const [ci, cj] of roomCols(7)) for (const s of [2, 5, 8]) {
      const L = slotLayers(s), [lo, hi] = slotRange(f, s), h0 = ((slotBase(s) * f.h + cj) * f.w + ci) * 4;
      const fl = lo + f.data[h0] / 255 * (hi - lo), ce = lo + f.data[h0 + 1] / 255 * (hi - lo);
      for (let k = 0; k < L; k++) {
        const y = fl + Math.max(ce - fl, 0.3) * (k / (L - 1));
        if (fieldSlot(f, ci, cj, y).slot !== s) continue;
        const smp = sampleField(f, (ci + 0.5) * CELL, y, (cj + 0.5) * CELL);
        const oa = (((slotBase(s) + 1 + 2 * k) * f.h + cj) * f.w + ci) * 4;
        for (let c = 0; c < 3; c++) expect(smp.amb[c] + smp.dirColor[c]).toBeCloseTo(dec(f.data[oa + c]), 4);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('downsampling keeps the storey pick (group slices copied from the deepest column, masks OR-ed)', () => {
    const {f} = tower();
    const d = downsampleField(f, 2);
    expect(d.depth).toBe(f.depth);
    expect(d.masks![0]).toBe(f.masks![0] | f.masks![1] | f.masks![f.w] | f.masks![f.w + 1]);
    for (let L = 0; L < 9; L++) for (const [ci, cj] of roomCols(9)) expect(fieldSlot(d, ci >> 1, cj >> 1, storeyY(L) + 1).slot, `storey ${L}`).toBe(L);
    expect(irr(d, 12, storeyY(7) + 0.05, 8)).toBeGreaterThan(irr(f, 12, storeyY(7) + 0.05, 8) * 0.3);
  });
});

// ---------------------------------------------------------------------------------------------
// The generated GLSL of the TSL decode, evaluated on the CPU (tests/helpers/glslEval.ts runFlow) against fieldSlot.
interface DecodeHarness { run(f: BakedField, p: readonly [number, number, number]): number[] }
function decodeHarness(): DecodeHarness {
  const P = uniform(new THREE.Vector3());
  const m = new NodeMaterial();
  const band = lfBandAt(P as never);
  m.fragmentNode = vec4(band.slot as never, band.floor as never, band.ceil as never, lfSlotAt(P as never) as never).toVar('lfProbe') as never;
  const quad = new QuadMesh(m);
  const B = new (GLSLNodeBuilder as unknown as new (o: unknown, r: unknown) => {
    scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; build(): void; fragmentShader: string;
    uniforms: {fragment: {name: string; type: string; node: unknown}[]};
  })(quad, rendererFor('glsl'));
  B.scene = new THREE.Scene(); B.camera = new THREE.OrthographicCamera(); B.material = m;
  B.build();
  const code = mainBody(B.fragmentShader);
  const unis = B.uniforms.fragment;
  return {
    run(f, p) {
      const vol = new LightFieldVolume(f);
      bindLightField(vol);
      const env: Env = new Map();
      const v3 = (u: {value: THREE.Vector3}) => u.value.toArray();
      for (const u of unis) {
        const node = u.node as {value?: unknown};
        if (node === P) env.set(u.name, [...p]);
        else if (node === LF.min) env.set(u.name, v3(LF.min as never));
        else if (node === LF.max) env.set(u.name, v3(LF.max as never));
        else if (node === LF.dims) env.set(u.name, v3(LF.dims as never));
        else if (node === LF.slots) env.set(u.name, LF.slots.value as number);
        else if (node === LF.bound) env.set(u.name, LF.bound.value as number);
        else if (node === LF.slotY) env.set(u.name, arrayVal((LF.slotY as unknown as {array: THREE.Vector4[]}).array.map(q => q.toArray())));
        else if (u.type === 'uint') env.set(u.name, 0); // texelFetch flipY (not a render target)
        else env.set(u.name, 0); // the sampler (texelFetch below reads the bound field)
      }
      const fns = {
        ivec3: (a: Val[]) => (a as unknown as number[][]).flat().slice(0, 3).map(Math.trunc),
        texelFetch: (a: Val[]) => {
          const [x, y, z] = a[1] as number[];
          const o = ((z * f.h + y) * f.w + x) * 4;
          return [f.data[o] / 255, f.data[o + 1] / 255, f.data[o + 2] / 255, f.data[o + 3] / 255];
        },
      };
      const out = runFlow(code, env, fns, 'lfProbe');
      vol.dispose();
      return out as number[];
    },
  };
}

describe('TSL decode parity: the generated GLSL slot pick equals fieldSlot (tower and Subway fields)', () => {
  it('every storey at several heights, stair lanes, landings, split heights +- 1 cm; extended and legacy columns', () => {
    const H = decodeHarness();
    const check = (f: BakedField, ci: number, cj: number, y: number, tag: string) => {
      const x = (ci + 0.5) * CELL * (f.cellScale ?? 1), z = (cj + 0.5) * CELL * (f.cellScale ?? 1);
      const [slot, floor, ceil, slot2] = H.run(f, [x, y, z]);
      const r = fieldSlot(f, ci, cj, y);
      expect(slot, `${tag} slot`).toBe(r.slot);
      expect(slot2, `${tag} lfSlotAt`).toBe(r.slot);
      expect(floor, `${tag} floor`).toBeCloseTo(r.floor, 9);
      expect(ceil, `${tag} ceil`).toBeCloseTo(r.ceil, 9);
      return r.slot;
    };
    try {
      const {f} = tower();
      const seen = new Set<number>();
      for (let L = 0; L < 9; L++) for (const y of [storeyY(L) + 0.05, storeyY(L) + 1.6, storeyCeil(L) - 0.1, storeyCeil(L) + 0.6]) {
        seen.add(check(f, 20, 10, y, `room storey ${L} y ${y.toFixed(2)}`));
        check(f, 60, 30, y, `room corner storey ${L}`);
      }
      expect(seen.size).toBe(9);
      // lanes and landings: every band's mid-height and the quantised splits +- 1 cm
      const geos = levelGeometries(src());
      for (const [ci, cj] of [[TOWER.lane.x0 + 4, TOWER.laneA + 1], [TOWER.lane.x1 - 3, TOWER.laneB + 1], [landingOf(0).x0 + 1, TOWER.divider], [landingOf(1).x0 + 2, TOWER.laneA], [TOWER.lane.x0 + 9, TOWER.divider]]) {
        const i = cj * f.w + ci;
        for (let s = 0; s < 9; s++) if ((columnMask(f, i) >> s) & 1) check(f, ci, cj, (geos[s].floorH[i] + geos[s].ceilH[i]) / 2, `lane ${ci},${cj} slot ${s}`);
        for (let y = -1; y < 40; y += 0.37) check(f, ci, cj, y, `lane ${ci},${cj} y ${y.toFixed(2)}`);
      }
      const yr = f.yMax - f.yMin, o = (10 * f.w + 20) * 4;
      for (const c of [0, 1, 2]) for (const e of [-0.01, 0.01]) check(f, 20, 10, f.yMin + f.data[o + c] / 255 * yr + e, `coarse split ${c} ${e}`);
      // a downsampled tower field and the Subway fixture (legacy headers)
      const d = downsampleField(f, 2);
      for (let L = 0; L < 9; L += 2) check(d, 10, 5, storeyY(L) + 1, `downsampled storey ${L}`);
      const {layout, levels} = renderFixture();
      const sf = bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: RFIX.bedY, levels});
      expect(sf.hdr).toBe(0);
      for (const [ci, cj] of [[42, 12], [40, 10], [60, 3], [20, 20], [50, 44]]) for (const y of [RFIX.lowerY + 1, RFIX.bedY + 0.5, 1, 3.9, RFIX.upperY + 1, 7.5]) check(sf, ci, cj, y, `subway ${ci},${cj} y ${y}`);
    } finally { bindLightField(null); }
    expect(boundSlotRanges()).toEqual([[0, 1]]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('fog, air and decay over every storey', () => {
  it('one density / air layer per storey; per-layer heights (a 42 m stack); the band holding a point picks its storey', () => {
    const p = atmosphereFor(T.layout);
    expect(p.levelDensity.office).toBeGreaterThan(0);
    expect(p.levelDensity.office!).toBeLessThan(p.levelDensity.main!);
    const m = buildDensityMap(T.layout, p);
    expect(m.slots).toBe(9);
    expect(m.layerY).toBeDefined();
    for (let L = 0; L < 9; L++) {
      const [, yr] = densityLayerRange(m, L);
      expect(yr / 255, `layer ${L} step`).toBeLessThan(0.06);
      expect(densitySlot(m, 20, 10, storeyY(L) + 1.2), `storey ${L}`).toBe(L);
      const [mult, fl] = sampleDensityMap(m, 20.25, 10.25, storeyY(L) + 1.2);
      expect(mult).toBeGreaterThan(0);
      expect(Math.abs(fl - storeyY(L)), `storey ${L} floor`).toBeLessThan(0.03);
    }
    expect(buildAirMap(T.layout).slots).toBe(9);
    // Subway: one height range (bytes unchanged; pinned below)
    expect(buildDensityMap(renderFixture().layout, ATMOSPHERE).layerY).toBeUndefined();
  });

  it('a burning flare on any storey gets its occlusion window and storey band (was: none above storey 3)', () => {
    const flashlight = new THREE.SpotLight(0xffffff, 0), muzzle = new THREE.PointLight(0xffffff, 0);
    const a = new VolumetricAtmosphere(null, {flashlight, muzzle}, 'high');
    a.setSize(640, 360);
    a.setStation(T.layout, null);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
    scene.add(camera, flashlight, muzzle);
    for (const L of [1, 4, 6, 8]) {
      expect(a.bandAt(20, storeyY(L) + 0.5, 10)?.slot, `band at storey ${L}`).toBe(L);
      camera.position.set(20, storeyY(L) + 1.6, 12); camera.updateMatrixWorld(true);
      const f = new FlareLight(FLARE.light.color, FLARE.light.intensity, FLARE.light.distance, FLARE.light.decay);
      f.position.set(20, storeyY(L) + 0.3, 10);
      scene.add(f);
      expect(a.addScatterLight(f)).toBe(true);
      a.sync(scene, camera, L);
      expect(f.window.w, `storey ${L} window`).toBeGreaterThanOrEqual(0);
      expect(Math.abs(f.band.x - storeyY(L)), `storey ${L} band floor`).toBeLessThan(0.05);
      expect(Math.abs(f.band.y - storeyCeil(L)), `storey ${L} band ceiling`).toBeLessThan(0.05);
      a.removeScatterLight(f);
      scene.remove(f);
    }
    a.dispose();
  });

  it('decay field: every storey a layer; the office storeys are dry; the texture-row guard keeps sampling', () => {
    const f = buildDecayField(T.layout, stationLevels(T.layout));
    expect(f.levels).toBe(9);
    expect(LEVEL_WETNESS.office).toBeLessThan(LEVEL_WETNESS.upper);
    const wet = (L: number) => { let s = 0, k = 0; for (let i = 0; i < f.w * f.h; i++) { const o = (L * f.w * f.h + i) * 4; if (f.data[o + 1]) { s += f.data[o + 2]; k++; } } return s / k; };
    expect(wet(5)).toBeLessThan(wet(0));
    expect(fitDecayField(f)).toBe(f); // 46 rows x 9 storeys fit one texture
    const small = fitDecayField(f, 210); // forced: 2 x 2 texels
    expect(small.cell).toBe(2 * CELL);
    expect(small.h * small.levels).toBeLessThanOrEqual(210);
    const a = sampleDecay(f, 4, 20, 10), b = sampleDecay(small, 4, 20, 10);
    expect(Math.abs(a.open - b.open)).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------------------------
function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

describe('level culling over 9 storeys', () => {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  cam.rotation.order = 'YXZ';
  const place = (x: number, y: number, z: number, yaw: number, pitch = 0) => { cam.position.set(x, y, z); cam.rotation.set(pitch, yaw, 0); cam.updateMatrixWorld(true); return cam; };
  const culled = (m: THREE.Object3D) => m.layers.isEnabled(CULL_LAYER) && !m.layers.test(new THREE.Layers());

  it('a floor draws only its storey (and the storeys seen up / down the scissor stair); flights culled with their storeys', () => {
    const un = installCanvasShim(false);
    try {
      const w = buildWorld(T.layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
      const arch: THREE.Mesh[] = [];
      w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.name.startsWith('arch-')) arch.push(m); });
      const byLevel = (L: number) => arch.filter(m => m.userData.level === L);
      const flights = arch.filter(m => m.userData.level === STAIR_LEVEL);
      // every run's flight meshes carry exactly the two storeys it joins
      expect(flights.length).toBeGreaterThan(0);
      for (const m of flights) { const l = m.userData.levels as number[]; expect(l.length, m.name).toBe(2); expect(l[1] - l[0], m.name).toBe(1); }
      expect(new Set(flights.map(m => (m.userData.levels as number[])[0]))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
      for (let L = 0; L < 9; L++) expect(byLevel(L).length, `storey ${L} meshes`).toBeGreaterThan(0);
      const visibleBefore = new Map<THREE.Object3D, boolean>();
      w.group.traverse(o => visibleBefore.set(o, o.visible));
      const cu = w.culler;
      expect(cu.portalTiles).toBeGreaterThan(8);
      // storey 4's floor plate, looking away from the stairwell: only storey 4
      cu.update(place(20, storeyY(4) + 1.62, 8, 0), true);
      expect(cu.stats.levels).toEqual([4]);
      expect(cu.stats.visibleLevels).toEqual([4]);
      expect(byLevel(4).some(m => !culled(m))).toBe(true);
      for (let L = 0; L < 9; L++) if (L !== 4) expect(byLevel(L).every(culled), `storey ${L}`).toBe(true);
      for (const m of flights) expect(culled(m), m.name).toBe(!(m.userData.levels as number[]).includes(4));
      // on storey 4's landing looking up run 4 -> 5: storeys 5 (and 3, down the other lane) through their runs, not the rest
      cu.update(place((landingOf(4).x0 + 1) * CELL, storeyY(4) + 1.62, (TOWER.laneA + 1.5) * CELL, -Math.PI / 2, 0.3), true);
      expect(cu.stats.levels).toEqual([4]);
      expect(cu.stats.visibleLevels).toContain(5);
      expect(byLevel(5).some(m => !culled(m))).toBe(true);
      for (const L of [0, 1, 7, 8]) { expect(cu.stats.visibleLevels).not.toContain(L); expect(byLevel(L).every(culled), `storey ${L}`).toBe(true); }
      // the top floor never draws the station
      cu.update(place(20, storeyY(8) + 1.62, 8, Math.PI), true);
      expect(byLevel(0).every(culled)).toBe(true);
      expect(byLevel(8).some(m => !culled(m))).toBe(true);
      // the eye inside the elevator cab (its shaft is SOLID on every storey grid): the public override names its storey
      const shaftX = (TOWER.shaft.x + 2) * CELL, shaftZ = (TOWER.shaft.y + 2) * CELL;
      cu.eyeOverride = 6;
      cu.update(place(shaftX, storeyY(6) + 1.62, shaftZ, 0), true);
      expect(cu.stats.levels).toEqual([6]);
      for (const L of [0, 4, 8]) expect(byLevel(L).every(culled), `storey ${L} from the cab`).toBe(true);
      cu.eyeOverride = null;
      cu.update(place(shaftX, storeyY(6) + 1.62, shaftZ, 0)); // the override change alone re-evaluates
      expect(cu.stats.levels).toEqual([0]); // (grid lookup in a solid column: the station)
      // render visibility only: nothing's `visible` flag changed
      w.group.traverse(o => expect(o.visible).toBe(visibleBefore.get(o)));
      // the iteration-14 'full' warm-up still plans every group, culled or not
      const planCulled = planWarmup(w.group, {mode: 'full', cameraMask: cam.layers.mask});
      cu.reset();
      const planAll = planWarmup(w.group, {mode: 'full', cameraMask: cam.layers.mask});
      expect(planCulled.groups).toBe(planAll.groups);
      expect(planCulled.items.length).toBe(planAll.items.length);
    } finally { un(); }
  });
});

// ---------------------------------------------------------------------------------------------
describe('AI across 9 storeys', () => {
  it('A* from the station to the top floor stays well inside the game budget (exact level-distance heuristic)', () => {
    const L = levelsOf(T.layout);
    const pf = new PathFinder(L);
    expect(pf.levelHeuristicMs).toBeGreaterThan(0);
    const up = pf.find(20, 10, 30, 10, 0.34, 26000, {ay: 0, by: storeyY(8)});
    expect(up, 'station -> floor 8').not.toBeNull();
    const upExpanded = pf.lastExpanded;
    expect(upExpanded).toBeLessThan(13000); // half the game's budget (26000)
    const ys = up!.map(p => p[3] as number);
    expect(ys[ys.length - 1]).toBeCloseTo(storeyY(8), 3);
    // it climbs through every storey in order (no slab crossings: consecutive waypoints within one run's rise)
    for (let k = 1; k < ys.length; k++) expect(Math.abs(ys[k] - ys[k - 1]), `waypoint ${k}`).toBeLessThanOrEqual(5.6 + 1e-6);
    for (let s = 1; s < 9; s++) expect(ys.some(y => Math.abs(y - storeyY(s)) < 0.6), `passes storey ${s}`).toBe(true);
    const down = pf.find(30, 10, 20, 10, 0.34, 26000, {ay: storeyY(8), by: 0});
    expect(down, 'floor 8 -> station').not.toBeNull();
    expect(pf.lastExpanded).toBeLessThan(13000);
    // the 2D heuristic alone floods every storey below the goal: same route cost, more than twice the expansions
    const flat = new PathFinder(L, {levelHeuristic: false});
    expect(flat.levelHeuristicMs).toBe(0);
    expect(flat.find(20, 10, 30, 10, 0.34, 400000, {ay: 0, by: storeyY(8)})).not.toBeNull();
    expect(flat.lastExpanded).toBeGreaterThan(upExpanded * 2); // (the real office: 26000+ = no route within the game budget)
    console.log(`A* station -> floor 8: ${upExpanded} expansions (2D heuristic: ${flat.lastExpanded}); level fields ${pf.levelHeuristicMs.toFixed(1)} ms`);
    // Subway stations (3 levels) keep the 2D heuristic (their searches are unchanged)
    expect(new PathFinder(levelsOf(renderFixture().layout)).levelHeuristicMs).toBe(0);
  });

  it('gunfire is heard in 3D, x0.35 per slab: a shot on floor 8 never reaches the station', () => {
    const bases = T.levels.map(l => l.baseY);
    expect(slabsBetween(bases, storeyY(8), 0)).toBe(8);
    expect(slabsBetween(bases, storeyY(3), storeyY(3) + 0.05)).toBe(0);
    expect(hearingMuffle(true, 8)).toBe(1);
    expect(hearingMuffle(false, 0)).toBe(HEARING.wall);
    expect(hearingMuffle(false, 1)).toBe(0.35); // iteration 08: a slab between storeys
    const noise = 38; // shotgun
    const hears = (zy: number, dx: number, shotY: number, los = false) => {
      const b = new ZombieBrain('shambler', 20 + dx, 10, 0);
      b.y = zy;
      b.hear(20, 10, noise * hearingMuffle(los, slabsBetween(bases, shotY, zy)), shotY);
      return b.aware;
    };
    expect(hears(0, 0, storeyY(8))).toBe(false); // station, directly below floor 8
    expect(hears(storeyY(7), 0, storeyY(8))).toBe(true); // one slab, 4.4 m below
    expect(hears(storeyY(6), 0, storeyY(8))).toBe(false); // two slabs, 8.8 m
    expect(hears(storeyY(8), 15, storeyY(8))).toBe(true); // same floor behind a wall (x0.6)
    expect(hears(storeyY(8), 25, storeyY(8))).toBe(false);
    expect(hears(storeyY(8), 25, storeyY(8), true)).toBe(true); // in sight
    // 3D distance: in sight up a stairwell 35 m above is beyond a 38 m shot only with the plan offset
    expect(hears(storeyY(8), 20, 0, true)).toBe(false); // hypot(20, 36.4) = 41.5 m
    // Subway parity: main <-> upper deck = one slab (0.35), same storey behind walls 0.6
    const sub = [0, RFIX.upperY, RFIX.lowerY];
    expect(hearingMuffle(false, slabsBetween(sub, 0, RFIX.upperY))).toBe(0.35);
    expect(hearingMuffle(false, slabsBetween(sub, RFIX.lowerY, 0))).toBe(0.35);
    expect(hearingMuffle(false, slabsBetween(sub, 0, 0))).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the real Office Space layout (one 10-storey world: station, lobby, floors 2-8, the roof)', () => {
  it('one bake for ~1000 fixtures under the field budget; every storey its own slot and lit; A* to every storey; portals', () => {
    const l = LEVELS.office.generate('main', {levelSeed: 11, startWeapon: 'pistol'});
    const lv = stationLevels(l);
    expect(lv.length).toBe(10);
    expect(lv.map(L => L.role)).toEqual(['main', 'upper', 'office', 'office', 'office', 'office', 'office', 'office', 'office', 'roof']);
    const t0 = performance.now();
    const f = bakeLightField({grid: l.grid, lights: l.lights, trenchFloorY: l.trench.floorY, levels: lv});
    const ms = performance.now() - t0;
    expect(f.slots).toBe(10);
    expect(f.stats.cut).toBe(0);
    expect(f.stats.bands).toBeLessThanOrEqual(MAX_BANDS);
    expect(f.stats.bytes).toBeLessThan(32e6); // StationLighting's default budget: no downsampling
    expect(l.lights.length).toBeGreaterThan(600);
    // no fixture dropped or clamped: every working fixture's level is a slot of the field
    expect(l.lights.every(x => (x.level ?? 0) < f.slots)).toBe(true);
    for (let L = 0; L < 10; L++) {
      const g = lv[L].grid;
      let n = 0, own = 0, lit = 0;
      for (let i = 0; i < g.w * g.h; i += 5) {
        if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || !((columnMask(f, i) >> L) & 1)) continue;
        const ci = i % g.w, cj = (i - ci) / g.w;
        n++;
        if (fieldSlot(f, ci, cj, g.floorOf(i) + 1.2).slot === L) own++;
        lit += irr(f, (ci + 0.5) * CELL, g.floorOf(i) + 0.05, (cj + 0.5) * CELL);
      }
      expect(n, `storey ${L} cells`).toBeGreaterThan(200);
      expect(own, `storey ${L} slot pick`).toBe(n);
      expect(lit / n, `storey ${L} mean light`).toBeGreaterThan(0.2);
    }
    console.log(`real office (seed 11): ${l.lights.length} fixtures, bake ${ms.toFixed(0)} ms, ${f.w}x${f.h}x${f.depth} ${(f.stats.bytes / 1e6).toFixed(1)} MB, bands ${f.stats.bands}`);
    // A* from the player spawn to a floor cell of every storey, inside the game's budget
    const pf = new PathFinder(levelsOf(l));
    const sp = l.playerSpawn;
    for (let L = 1; L < 10; L++) {
      const g = lv[L].grid;
      let t = -1;
      for (let i = Math.floor(g.w * g.h / 2); i < g.w * g.h && t < 0; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0 && g.passable(i % g.w, (i / g.w) | 0)) t = i;
      // (lane STRUCT: the transit hall moved the station south, so the tower storeys may lie wholly in the grid's first half)
      for (let i = 0; i < g.w * g.h && t < 0; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0 && g.passable(i % g.w, (i / g.w) | 0)) t = i;
      const p = pf.find(sp.x, sp.z, (t % g.w + 0.5) * CELL, (Math.floor(t / g.w) + 0.5) * CELL, 0.34, 26000, {ay: lv[0].grid.floorAt(sp.x, sp.z), by: g.floorOf(t)});
      // the roof is a player-only climb (the access ladder is not in the AI graph): no enemy route reaches it
      if (L === 9) expect(p, 'spawn -> roof must have no AI route').toBeNull();
      else expect(p, `spawn -> storey ${L} (${pf.lastExpanded} expansions)`).not.toBeNull();
    }
    // portal tiles join every pair of consecutive storeys (their stair runs; the roof hatch), and the fog / decay maps cover them all
    const cu = new LevelCuller(lv, new LevelColumns(lv), () => 0) as unknown as {tiles: {a: number; b: number}[]};
    for (let L = 0; L < 9; L++) expect(cu.tiles.some(t => t.a === L && t.b === L + 1), `portal ${L}-${L + 1}`).toBe(true);
    expect(buildDensityMap(l, atmosphereFor(l)).slots).toBe(10);
    expect(buildDecayField(l, lv).levels).toBe(10);
    expect(levelIssues(l)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('stack validation and the Subway regression', () => {
  it('levelIssues passes the 9-storey tower (every storey reached by stairs; slabs; landings)', () => {
    const issues = levelIssues({...T.layout, rails: []} as never);
    expect(issues).toEqual([]);
    // a storey without its stair link is caught (the check now covers every storey, not only levels 1 / 2)
    const cut = {...T.layout, rails: [], levelLinks: T.links.filter(l => l.upper !== 6)} as never;
    expect(levelIssues(cut).some(s => /level 6 has no stairs/.test(s))).toBe(false); // run 6 -> 7 still links storey 6
    const cut2 = {...T.layout, rails: [], levelLinks: T.links.filter(l => l.upper !== 6 && l.lower !== 6)} as never;
    expect(levelIssues(cut2)).toContain('level 6 has no stairs');
  });

  it('Subway packing and maps are byte-identical to iteration 16 (render fixture + generated station)', () => {
    const {layout, levels} = renderFixture();
    const ff = bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: -1.15, levels});
    expect(ff.hdr).toBe(0);
    expect(fnv(ff.data)).toBe('52cd2160');
    // Track 2 lane GEN-2 — CAUSE: "core reserve enabled (authorized incidence change)": the Subway's core reserve re-lays station 1
    // (a layout change) and its live layout carries a track tunnel. PROOF (every run): generated with the reserve OFF, the CORE
    // view (gen/trackExt coreView) reproduces the iteration-16 pins byte for byte; the live station (reserve on + extensions)
    // is pinned below (was the iteration-16 values: dc7abbcc / 1095b4d6 / fb391d51 / bf7c0c4). Track 2 (lane CONTENT): its tunnel
    // now carries the sparse dim / dying tunnel fixtures (gen/annexContent.ts, appended layout.lights) and the tunnel's lighting
    // profile follows them, so the live light field and the decay field's extension cells move (was a451242b / c645ac1f; the
    // density and air maps and the slot / depth / header budget are unchanged; the reserve-off core view still holds).
    const maps = (s: StationLayout) => {
      const lv = stationLevels(s), f = bakeLightField({grid: s.grid, lights: s.lights, trenchFloorY: s.trench.floorY, levels: lv});
      expect([f.slots, f.depth, f.hdr]).toEqual([3, 24, 0]);
      // every legacy column's header still names its bands with the iteration-08 byte
      for (let i = 0; i < f.w * f.h; i++) expect(isExtendedHeader(f.data[i * 4 + 3])).toBe(false);
      return [fnv(f.data), fnv(buildDensityMap(s, atmosphereFor(s)).data), fnv(buildAirMap(s).data), fnv(buildDecayField(s, lv).data)];
    };
    expect(maps(coreView(generateStation(1, {trackExtensions: TRACK_EXT_RESERVE_OFF})))).toEqual(['dc7abbcc', '1095b4d6', 'fb391d51', 'bf7c0c4']);
    expect(maps(generateStation(1))).toEqual(['912ec1a9', 'fc9cf608', '8285fcc7', '5725b18b']);
  });
});
