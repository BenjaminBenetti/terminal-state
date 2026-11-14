// Task studio-baked-lighting-reflections-20261114-050258-01: the reflection probes' lighting node (world/reflectionNode.ts).
// - which materials reflect (metal / glass) and which never do (walls, floors, characters, unlit materials);
// - with the PLAIN field light every material compiles to the program it always had: no probe texture, no extra code — the
//   reflecting light is a second session-wide light a station only uses when it was built with probes;
// - a reflective material builds on BOTH backends (WGSL = WebGPU, GLSL = WebGL2 fallback) within WebGPU's per-stage limits, with
//   three more sampled textures and no uniform buffer more; a non-reflective one under the reflecting light adds none;
// - binding / unbinding swaps values only and asks every render object to re-read its texture bindings;
// - the CPU mirror of the shader's lookup (sampleProbes) on a hand-made probe set.
// Shader code is generated in Node by three's own GLSLNodeBuilder / WGSLNodeBuilder on an uninitialised renderer (no GPU).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GLSLNodeBuilder, MeshBasicNodeMaterial, MeshLambertNodeMaterial, MeshStandardNodeMaterial, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';
import {LightFieldLight, LightFieldNode, installLightFieldNode, stationFieldLight} from '../src/world/lightFieldNode';
import {
  LightFieldReflectLight, LightFieldReflectNode, REFL, REFLECTION_TUNING, ReflectionProbeVolume, activeReflectionProbes, bindReflectionProbes, installReflectNode,
  REFLECT_METALNESS_MIN, REFLECT_ROUGHNESS_MAX, reflectClass, sampleProbeLevel, sampleProbes, stationReflectLight, syncReflectionTuning,
} from '../src/world/reflectionNode';
import {reflectTagOf, tagReflect} from '../src/render/reflectTag';
import {materialKey} from '../src/render/runtimeVariants';
import {WorldMaterials, cloneSurfaceMaterial} from '../src/world/materials';
import {shapeMaterial} from '../src/world/shapeMaterials';
import {crackedGlassMaterial, officeGlassMaterial} from '../src/world/officeWindows';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {PROBE_NORM_MIN, PROBE_RATIO_MAX, octDecode, octEncode, probeAtlasLayout, probeTileOrigin, type BakedProbes} from '../src/world/reflectionProbes';
import {bindingRefreshStats} from '../src/render/bindingRefresh';
const bindingEpoch = (): number => bindingRefreshStats.bumps;
import {CELL} from '../src/gen/grid';

type Backend = 'glsl' | 'wgsl';
const renderers = new Map<Backend, WebGPURenderer>();
function headless(backend: Backend): WebGPURenderer {
  let r = renderers.get(backend);
  if (r) return r;
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
  (r as unknown as {hasFeature: () => boolean; hasCompatibility: () => boolean}).hasFeature = () => false;
  (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
  (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
  r.toneMapping = THREE.ACESFilmicToneMapping;
  expect(installLightFieldNode(r)).toBe(true);
  expect(installReflectNode(r)).toBe(true);
  renderers.set(backend, r);
  return r;
}
function compile(backend: Backend, mesh: THREE.Mesh, lights: THREE.Light[]): string {
  const r = headless(backend);
  const scene = new THREE.Scene();
  scene.add(mesh);
  for (const l of lights) if (!l.parent) scene.add(l);
  const errors: string[] = [];
  const oe = console.error, ow = console.warn;
  console.error = console.warn = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try {
    const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
    const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; fragmentShader: string};
    b.scene = scene;
    b.camera = new THREE.PerspectiveCamera();
    b.material = mesh.material as THREE.Material;
    b.context.material = b.material;
    b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights(lights);
    b.build();
    expect(errors, `${backend}: a clean build`).toEqual([]);
    return b.fragmentShader;
  } finally {
    console.error = oe; console.warn = ow;
    scene.remove(mesh);
    for (const l of lights) scene.remove(l);
  }
}
const box = (m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** Sampled textures, samplers and uniform buffers a fragment shader declares. */
function bindings(backend: Backend, frag: string): {textures: number; samplers: number; ubos: number} {
  if (backend === 'wgsl') return {textures: count(frag, /var\s+\w+\s*:\s*texture_\w+(<\w+>)?\s*;/g), samplers: count(frag, /var\s+\w+\s*:\s*sampler(_comparison)?\s*;/g), ubos: count(frag, /var<uniform>/g)};
  return {textures: count(frag, /uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler\w+\s+\w+;/g), samplers: 0, ubos: count(frag, /layout\s*\(\s*std140\s*\)\s*uniform/g)};
}

/** A hand-made probe set: one slot, a w x h cell grid, `count` probes of one flat colour each, all weight on channel 0 of probe 0 unless given. */
function fakeProbes(o: {w?: number; h?: number; colors: [number, number, number][]; norm?: number} = {colors: [[1, 1, 1]]}): BakedProbes {
  const w = o.w ?? 8, h = o.h ?? 8, count = o.colors.length, layout = probeAtlasLayout(8, count);
  const atlas = new Uint16Array(layout.width * layout.height * 4);
  for (let p = 0; p < count; p++) for (let l = 0; l < 4; l++) {
    const t = layout.levelTile[l], [ox, oy] = probeTileOrigin(layout, p, l);
    for (let y = -1; y <= t; y++) for (let x = -1; x <= t; x++) {
      const q = ((oy + y) * layout.width + ox + x) * 4;
      for (let c = 0; c < 3; c++) atlas[q + c] = THREE.DataUtils.toHalfFloat(o.colors[p][c]);
      atlas[q + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const meta = new Float32Array(count * 12);
  for (let p = 0; p < count; p++) {
    meta.set([w * CELL / 2, 1.5, h * CELL / 2, o.norm ?? 1], p * 4);
    meta.set([0, 0, 0, 0], (count + p) * 4);
    meta.set([w * CELL, 3, h * CELL, 0], (2 * count + p) * 4);
  }
  const grid = new Uint8Array(w * h * 2 * 4);
  for (let i = 0; i < w * h; i++) { grid[i * 4] = 255; grid[(w * h + i) * 4] = 1; }
  return {tier: 'standard', count, block: 8, ramp: 2, layout, atlas, meta, grid, gridW: w, gridH: h, gridDepth: 2, slots: 1, stats: {ms: 0, rays: 0, fixtures: 0, orphanCells: 0, bytes: 0}};
}

describe('which materials reflect', () => {
  const std = (o: THREE.MeshStandardMaterialParameters) => new MeshStandardNodeMaterial(o as never);
  it('untagged: a metal candidate by a metalness map or a metalness that is not zero; never a see-through, unlit or zero-metalness material', () => {
    expect(reflectClass(std({metalness: 0.3, roughness: 0.5}))).toBe('metal');
    expect(reflectClass(std({metalness: 0.1}))).toBe('metal'); // a candidate: the shader's own metalness / roughness test decides per fragment
    expect(reflectClass(std({metalness: 0}))).toBe('none');
    const map = new THREE.Texture();
    expect(reflectClass(std({metalness: 1, metalnessMap: map}))).toBe('metal');
    expect(reflectClass(std({metalness: 0, metalnessMap: map}))).toBe('metal');
    // see-through things (decals, particles, liquids) are never glass on their own: only a tagged pane is
    expect(reflectClass(std({transparent: true, opacity: 0.4, roughness: 0.06}))).toBe('none');
    expect(reflectClass(std({transparent: true, opacity: 0.5, roughness: 0.9, metalness: 1}))).toBe('none');
    expect(reflectClass(null)).toBe('none');
    expect(reflectClass(new MeshBasicNodeMaterial())).toBe('none');
    expect(reflectClass(new MeshLambertNodeMaterial())).toBe('none');
    expect(REFLECT_METALNESS_MIN).toBeGreaterThan(0.1);
    expect(REFLECT_ROUGHNESS_MAX).toBeLessThan(0.6);
  });
  it('a tag wins (glass panes, the wall / floor sets that are not metal), and a skinned mesh never reflects', () => {
    const wall = tagReflect(std({metalness: 1, metalnessMap: new THREE.Texture()}), 'none');
    expect(reflectClass(wall)).toBe('none');
    const pane = tagReflect(std({metalness: 0.1, transparent: true, opacity: 0.42}), 'glass');
    expect(reflectClass(pane)).toBe('glass');
    expect(reflectTagOf(pane)).toBe('glass');
    expect(reflectTagOf(std({}))).toBeUndefined();
    const steel = std({metalness: 0.5});
    expect(reflectClass(steel, new THREE.SkinnedMesh())).toBe('none');
    expect(reflectClass(steel, new THREE.Mesh())).toBe('metal');
    expect(reflectClass(tagReflect(steel, 'metal'), new THREE.SkinnedMesh())).toBe('metal'); // an explicit tag wins
  });
  it('the choice only reads what three\'s program cache key holds: two materials that share a key always get the same class', () => {
    // three r186 RenderObject.getMaterialCacheKey: numbers on / off, no userData / name / opacity; a string property as its text
    const key = (m: THREE.Material): string => materialKey(m);
    const cases: THREE.Material[] = [
      std({metalness: 0}), std({metalness: 0.05}), std({metalness: 0.9}), std({metalness: 0.3, roughness: 0.2}), std({metalness: 0, roughness: 0.1}),
      std({transparent: true, opacity: 0.3}), std({transparent: true, opacity: 0.95, metalness: 0.4}),
      tagReflect(std({transparent: true, opacity: 0.4, metalness: 0.1}), 'glass'), tagReflect(std({metalness: 1}), 'none'), tagReflect(std({metalness: 0}), 'metal'),
      std({metalness: 1, metalnessMap: new THREE.Texture()}), tagReflect(std({metalness: 1, metalnessMap: new THREE.Texture()}), 'none'),
    ];
    const named = std({transparent: true, opacity: 0.4}); named.name = 'shop-glass'; named.userData.reflect = 'glass';
    cases.push(named); // neither a name nor userData is in the key: neither may decide
    const byKey = new Map<string, string>();
    for (const m of cases) {
      const k = key(m), c = reflectClass(m);
      if (byKey.has(k)) expect(c, `two materials with one key (${m.name || m.type})`).toBe(byKey.get(k));
      byKey.set(k, c);
    }
    expect(reflectClass(named)).toBe('none');
    // a tag is part of the key: a tagged pane never shares a program with an untagged see-through material
    expect(key(tagReflect(std({transparent: true, opacity: 0.4}), 'glass'))).not.toBe(key(std({transparent: true, opacity: 0.4})));
    expect(key(tagReflect(std({metalness: 1}), 'none'))).not.toBe(key(std({metalness: 1})));
  });
  it('the station kit: glazing is glass (clones too), tile / slab / ceiling sets never reflect, painted and brushed steel are metal candidates', () => {
    installCanvasShim();
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    for (const k of ['tileLower', 'tileUpper', 'platformSlab', 'ceiling', 'tunnel', 'platformFace', 'safetyEdge'] as const) expect(reflectClass(mats.get(k)), k).toBe('none');
    for (const k of ['terrazzo', 'concrete', 'paint', 'ballast'] as const) expect(reflectClass(mats.get(k)), k).toBe('none');
    for (const k of ['steel', 'rail', 'gate'] as const) expect(reflectClass(mats.get(k)), k).toBe('metal');
    const glass = shapeMaterial(mats, 'glass'), front = shapeMaterial(mats, 'glassShopfront');
    expect(reflectClass(glass)).toBe('glass');
    expect(reflectClass(front)).toBe('glass');
    expect(reflectClass(cloneSurfaceMaterial(front))).toBe('glass');
    expect(reflectClass(officeGlassMaterial(mats))).toBe('glass');
    expect(reflectClass(crackedGlassMaterial(null))).toBe('glass');
    expect(reflectClass(shapeMaterial(mats, 'steelBright'))).toBe('metal');
    expect(reflectClass(shapeMaterial(mats, 'counter'))).toBe('none');
  });
});

describe('the reflecting field light', () => {
  it('is its own session-wide light and node class; the plain light keeps the plain node', () => {
    expect(installReflectNode(null)).toBe(false);
    expect(installReflectNode({})).toBe(false);
    for (const b of ['glsl', 'wgsl'] as const) {
      const r = headless(b);
      expect(installReflectNode(r)).toBe(true);
      const lib = r.library as unknown as {getLightNodeClass(c: unknown): unknown};
      expect(lib.getLightNodeClass(LightFieldReflectLight)).toBe(LightFieldReflectNode);
      expect(lib.getLightNodeClass(LightFieldLight)).toBe(LightFieldNode);
    }
    const a = stationReflectLight();
    expect(stationReflectLight()).toBe(a);
    expect(a).not.toBe(stationFieldLight());
    expect(a.isLightFieldLight).toBe(true);
    expect(a.castShadow).toBe(false);
  });

  it('plain light: no probe texture in any material; reflecting light: only metal and glass get the probes, on both backends, inside the WebGPU limits', () => {
    const rows: string[] = [];
    const mats = {
      wall: () => new MeshStandardNodeMaterial({metalness: 0, roughness: 0.8}),
      steel: () => new MeshStandardNodeMaterial({metalness: 0.45, roughness: 0.4}),
      glass: () => tagReflect(new MeshStandardNodeMaterial({metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.42}), 'glass'),
    };
    for (const backend of ['wgsl', 'glsl'] as const) {
      const plain = Object.fromEntries(Object.entries(mats).map(([k, f]) => [k, compile(backend, box(f()), [stationFieldLight(), new THREE.HemisphereLight()])]));
      const refl = Object.fromEntries(Object.entries(mats).map(([k, f]) => [k, compile(backend, box(f()), [stationReflectLight(), new THREE.HemisphereLight()])]));
      for (const k of Object.keys(mats)) {
        expect(/[^\x00-\x7F]/.test(refl[k]), `${backend} ${k}: ASCII-only shader`).toBe(false);
        const a = bindings(backend, plain[k]), b = bindings(backend, refl[k]);
        rows.push(`${backend} ${k}: plain ${plain[k].length} chars ${JSON.stringify(a)} -> reflecting ${refl[k].length} chars ${JSON.stringify(b)}`);
        expect(b.ubos, `${backend} ${k}: no uniform buffer more`).toBe(a.ubos);
        if (k === 'wall') {
          // a non-reflective material is the same program under either light (the light's name aside)
          expect(b.textures).toBe(a.textures);
          expect(refl[k].length).toBe(plain[k].length);
        } else {
          expect(b.textures, `${backend} ${k}: atlas + meta + grid`).toBe(a.textures + 3);
          expect(b.textures).toBeLessThanOrEqual(16);
          expect(b.ubos).toBeLessThanOrEqual(12);
          if (backend === 'wgsl') {
            expect(b.samplers).toBeLessThanOrEqual(16);
            // every probe sample has an explicit level (legal inside the per-probe branches)
            expect(refl[k]).toContain('textureSampleLevel');
          }
        }
      }
      // the plain programs never mention a probe texture
      for (const k of Object.keys(mats)) expect(bindings(backend, plain[k]).textures, `${backend} ${k} plain`).toBeLessThanOrEqual(bindings(backend, refl[k]).textures);
      // unlit / non-physical materials: nothing under the reflecting light either
      const basic = compile(backend, box(new MeshBasicNodeMaterial()), [stationReflectLight()]);
      expect(bindings(backend, basic).textures).toBe(0);
      const lambertA = compile(backend, box(new MeshLambertNodeMaterial()), [stationFieldLight()]);
      const lambertB = compile(backend, box(new MeshLambertNodeMaterial()), [stationReflectLight()]);
      expect(bindings(backend, lambertB).textures).toBe(bindings(backend, lambertA).textures);
    }
    console.log(rows.join('\n'));
  });
});

describe('binding the probes', () => {
  it('bind swaps the global nodes and asks for a binding refresh; unbind returns to the placeholders with strength 0', () => {
    bindReflectionProbes(null);
    expect(activeReflectionProbes()).toBeNull();
    expect(REFL.params.value.x).toBe(0);
    const ph = {atlas: REFL.atlas.value, meta: REFL.meta.value, grid: REFL.grid.value};
    const v = new ReflectionProbeVolume(fakeProbes({colors: [[1, 0, 0], [0, 1, 0]]}));
    const e0 = bindingEpoch();
    bindReflectionProbes(v);
    expect(bindingEpoch()).toBeGreaterThan(e0);
    expect(activeReflectionProbes()).toBe(v);
    expect(REFL.atlas.value).toBe(v.atlas);
    expect(REFL.meta.value).toBe(v.meta);
    expect(REFL.grid.value).toBe(v.grid);
    expect(REFL.params.value.x).toBe(1);
    expect(REFL.atlasInfo.value.toArray()).toEqual([v.probes.layout.width, v.probes.layout.height, 8, 16]);
    expect(REFL.gridInfo.value.toArray()).toEqual([8, 8, 2, CELL]);
    expect(v.atlas.type).toBe(THREE.HalfFloatType);
    expect(v.meta.type).toBe(THREE.FloatType);
    expect(v.meta.magFilter).toBe(THREE.NearestFilter);
    expect(v.bytes).toBe(v.probes.atlas.byteLength + v.probes.meta.byteLength + v.probes.grid.byteLength);
    // the same volume again: nothing to refresh
    const e1 = bindingEpoch();
    bindReflectionProbes(v);
    expect(bindingEpoch()).toBe(e1);
    REFLECTION_TUNING.strength = 0.5;
    syncReflectionTuning();
    expect(REFL.params.value.x).toBe(0.5);
    REFLECTION_TUNING.strength = 1;
    syncReflectionTuning();
    bindReflectionProbes(null);
    expect(bindingEpoch()).toBeGreaterThan(e1);
    expect(REFL.atlas.value).toBe(ph.atlas);
    expect(REFL.meta.value).toBe(ph.meta);
    expect(REFL.grid.value).toBe(ph.grid);
    expect(REFL.params.value.x).toBe(0);
    v.dispose();
  });
  it('a station with no probe binds strength 0', () => {
    const empty = fakeProbes({colors: [[1, 1, 1]]});
    const v = new ReflectionProbeVolume({...empty, count: 0, meta: new Float32Array(12)});
    bindReflectionProbes(v);
    expect(REFL.params.value.x).toBe(0);
    bindReflectionProbes(null);
    v.dispose();
  });
});

describe('the lookup (CPU mirror of the shader)', () => {
  it('octahedral map: round trip, the upper hemisphere in the inner diamond', () => {
    for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, -1], [0.3, 0.5, -0.8], [-0.6, -0.7, 0.2]] as const) {
      const l = Math.hypot(d[0], d[1], d[2]), u = octEncode(d[0] / l, d[1] / l, d[2] / l), back = octDecode(u[0], u[1]);
      for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo(d[c] / l, 5);
      expect(u[0]).toBeGreaterThanOrEqual(0); expect(u[0]).toBeLessThanOrEqual(1);
    }
    expect(octEncode(0, 1, 0)).toEqual([0.5, 0.5]);
  });
  it('one probe of a flat colour returns that colour scaled by local light / NORM, capped; no weight returns nothing', () => {
    const B = fakeProbes({colors: [[0.2, 0.4, 0.8]], norm: 2});
    expect(sampleProbeLevel(B, 0, 0, [0, 1, 0]).map(v => +v.toFixed(3))).toEqual([0.2, 0.4, 0.8]);
    expect(sampleProbeLevel(B, 0, 3, [0.5, -0.5, 0.7]).map(v => +v.toFixed(3))).toEqual([0.2, 0.4, 0.8]);
    const at = (local: number, rough = 0.3) => sampleProbes(B, 2, 1.2, 2, 0, [0, 0.6, 0.8], rough, local).map(v => +v.toFixed(3));
    expect(at(2)).toEqual([0.2, 0.4, 0.8]);
    expect(at(1)).toEqual([0.1, 0.2, 0.4]);
    expect(at(0)).toEqual([0, 0, 0]);
    expect(at(100)).toEqual([0.2 * PROBE_RATIO_MAX, 0.4 * PROBE_RATIO_MAX, 0.8 * PROBE_RATIO_MAX].map(v => +v.toFixed(3)));
    expect(at(2, 0)).toEqual(at(2, 1));
    const none = {...B, grid: new Uint8Array(B.grid.length)};
    expect(sampleProbes(none, 2, 1.2, 2, 0, [0, 1, 0], 0.3, 2)).toEqual([0, 0, 0]);
    expect(PROBE_NORM_MIN).toBeGreaterThan(0);
  });
  it('two probes blend by their weights; a faint total weight fades the reflection out instead of normalising it up', () => {
    const B = fakeProbes({colors: [[1, 0, 0], [0, 0, 1]]});
    const n = B.gridW * B.gridH;
    for (let i = 0; i < n; i++) { B.grid[i * 4] = 191; B.grid[i * 4 + 1] = 64; B.grid[(n + i) * 4] = 1; B.grid[(n + i) * 4 + 1] = 2; }
    const c = sampleProbes(B, 2, 1.2, 2, 0, [0, 1, 0], 0.2, 1);
    expect(c[0]).toBeCloseTo(191 / 255, 3);
    expect(c[2]).toBeCloseTo(64 / 255, 3);
    for (let i = 0; i < n; i++) { B.grid[i * 4] = 3; B.grid[i * 4 + 1] = 0; }
    const faint = sampleProbes(B, 2, 1.2, 2, 0, [0, 1, 0], 0.2, 1);
    expect(faint[0]).toBeCloseTo(3 / 255 / 0.05, 3);
    expect(faint[0]).toBeLessThan(0.3);
  });
});
