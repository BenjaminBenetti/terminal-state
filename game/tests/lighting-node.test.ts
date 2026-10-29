// Iteration 13 (LIGHTING): the baked light field and station lights under three r186's WebGPURenderer (node materials).
// - the TSL lighting node is registered for the session's single LightFieldLight and builds into every lit node material
//   on BOTH backends (WGSL = WebGPU, GLSL = WebGL2 fallback), with one 3D texture binding, 3 texel fetches (column header, the
//   extended-column group texel - read only inside the extended-column branch -, slot header) + 5 trilinear samples and no
//   per-slot loop; unlit materials / scenes without the light get nothing;
// - its isotropic part goes to the indirect irradiance and its directional part through the lighting model's direct term;
// - slot selection / band floors (the no-leak contract) and the CPU mirror against the baked texels;
// - the scene's light set (LightsNode cache key) is identical across new stations, flare throws / burn-out, flashlight
//   toggles and a flat battery (no node / pipeline rebuild);
// - tubes / glow cards: glow fog + display-referred output (inverse ACES) as node hooks; the flashlight shadow path and
//   three's shadow-side rule (the iteration-12 container-liner fix) on WebGPURenderer.
// Shader code is generated in Node by three's own GLSLNodeBuilder / WGSLNodeBuilder on an uninitialised renderer (no GPU).
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {
  GLSLNodeBuilder, LightsNode, MeshBasicNodeMaterial, MeshLambertNodeMaterial, MeshPhongNodeMaterial, MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial, MeshToonNodeMaterial, WGSLNodeBuilder, WebGPURenderer, type Node, type NodeMaterial,
} from 'three/webgpu';
import {positionWorld, vec4} from 'three/tsl';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL} from '../src/gen/grid';
import type {Fixture} from '../src/world/builder';
import {
  AUX_SLOT_DEPTH, FIELD_EMAX, LightFieldVolume, SLOT_DEPTH, bakeLightField, fieldSlot, levelGeometries, sampleField, slotBase, slotLayers,
  type BakedField, type FieldSource,
} from '../src/world/lightField';
import {
  LF, LightFieldLight, LightFieldNode, UNBOUND_BAND, activeLightField, bindLightField, installLightFieldNode, lfBandAt, lfFloorAt, lfSlotAt,
  lightFieldSample, probeLightFieldGPU, stationFieldLight,
} from '../src/world/lightFieldNode';
import {
  DISPLAY_MAX, GLOW_FOG, MOOD, StationLighting, acesDisplayCPU, displayLinearCPU, displayReferred, glowFog, glowMaterial, max3DTextureSize, syncGlowFog,
} from '../src/world/lights';
import {nodeHookKeys} from '../src/render/nodeHooks';
import {stationLevels} from '../src/world/levelGeometry';
import {FLASH_SHADOW, PlayerLight, flashShadowBiasCPU} from '../src/player/flashlight';
import {shadowBiasFor, SHADOW_NEAR} from '../src/render/atmosphere';
import {LightSources} from '../src/world/lightSources';
import {FLARE, FlareSystem} from '../src/weapons/throwables';
import {PhysicsSystem} from '../src/physics/world';
import {levelsOf} from '../src/gen/levels';
import {levelFixture} from './helpers/levelFixture';
import {FIX as RFIX, levelFixture as renderFixture} from './helpers/levelRenderFixture';
import {installCanvasShim} from './helpers/canvas2d';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const three = (rel: string) => fs.readFileSync(path.join(REPO, 'node_modules/three/src', rel), 'utf8');

// ---------------------------------------------------------------------------------------------
// Headless shader generation (three's own node builders on an uninitialised renderer)

type Backend = 'glsl' | 'wgsl';
const renderers = new Map<string, WebGPURenderer>();
function headless(backend: Backend, toneMapping: THREE.ToneMapping = THREE.ACESFilmicToneMapping): WebGPURenderer {
  const key = `${backend}:${toneMapping}`;
  let r = renderers.get(key);
  if (r) return r;
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
  // Uninitialised backend: answer the two queries the builders make (optional features: none; uniform block size: WebGL2 min).
  (r as unknown as {hasFeature: () => boolean; hasCompatibility: () => boolean}).hasFeature = () => false;
  (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
  (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
  r.toneMapping = toneMapping;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  expect(installLightFieldNode(r)).toBe(true);
  renderers.set(key, r);
  return r;
}

interface Built { vertex: string; fragment: string }
function compile(backend: Backend, mesh: THREE.Mesh, lights: THREE.Light[], toneMapping?: THREE.ToneMapping): Built {
  const r = headless(backend, toneMapping);
  const scene = new THREE.Scene();
  scene.add(mesh);
  for (const l of lights) if (!l.parent) scene.add(l);
  const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
  const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; vertexShader: string; fragmentShader: string};
  b.scene = scene;
  b.camera = new THREE.PerspectiveCamera();
  b.material = mesh.material as THREE.Material;
  b.context.material = b.material;
  b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights(lights);
  b.build();
  scene.remove(mesh);
  return {vertex: b.vertexShader, fragment: b.fragmentShader};
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** Name of the 3D texture uniform (one per shader) and how it is used. */
function field3D(backend: Backend, frag: string) {
  const decl = backend === 'glsl' ? [...frag.matchAll(/uniform\s+(?:highp\s+)?sampler3D\s+(\w+);/g)] : [...frag.matchAll(/var\s+(\w+)\s*:\s*texture_3d<f32>/g)];
  const name = decl[0]?.[1] ?? '';
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fetches = name ? count(frag, new RegExp(backend === 'glsl' ? `texelFetch\\(\\s*${esc}\\b` : `textureLoad\\(\\s*${esc}\\b`, 'g')) : 0;
  const samples = name ? count(frag, new RegExp(backend === 'glsl' ? `textureLod\\(\\s*${esc}\\b` : `textureSampleLevel\\(\\s*${esc}\\b`, 'g')) : 0;
  return {decls: decl.length, fetches, samples};
}
const box = (m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);

const fixturesOf = (l: StationLayout): Fixture[] => l.lights.map((x, i) => ({x: x.x, y: x.y, z: x.z, broken: x.broken, flicker: x.flicker, warm: x.warm, dying: x.dying, power: x.power, area: x.area, phase: i * 1.7, level: x.broken ? 0 : 1}));
const stations = new Map<number, StationLayout>();
const station = (seed: number) => { let s = stations.get(seed); if (!s) stations.set(seed, (s = generateStation(seed))); return s; };
const src = (l: StationLayout): FieldSource => ({grid: l.grid, lights: l.lights, trenchFloorY: l.trench.floorY, levels: stationLevels(l)});
const bakes = new Map<number, BakedField>();
const baked = (seed: number) => { let b = bakes.get(seed); if (!b) bakes.set(seed, (b = bakeLightField(src(station(seed))))); return b; };

// ---------------------------------------------------------------------------------------------
describe('light-field lighting node (WebGPURenderer node library)', () => {
  it('is registered for the session-wide LightFieldLight (idempotent); one light instance per session', () => {
    expect(installLightFieldNode(null)).toBe(false);
    expect(installLightFieldNode({})).toBe(false);
    for (const b of ['glsl', 'wgsl'] as const) {
      const r = headless(b);
      expect(installLightFieldNode(r)).toBe(true); // again: no "Redefinition" warning, same class
      expect((r.library as unknown as {getLightNodeClass(c: unknown): unknown}).getLightNodeClass(LightFieldLight)).toBe(LightFieldNode);
    }
    const a = stationFieldLight();
    expect(stationFieldLight()).toBe(a);
    expect(a.isLight).toBe(true);
    expect(a.castShadow).toBe(false);
    // three's upstream protocol we rely on: library.addLight + LightsNode resolving light nodes by constructor
    expect(three('renderers/common/nodes/NodeLibrary.js')).toContain('addLight( lightNodeClass, lightClass )');
    expect(three('nodes/lighting/LightsNode.js')).toContain('nodeLibrary.getLightNodeClass( light.constructor )');
    expect(three('nodes/lighting/LightsNode.js')).toContain('setupDirectLight( builder, lightNode, lightData )');
    expect(three('nodes/core/LightingModel.js')).toContain('builder.lightsNode.setupLights( builder, builder.lightsNode.getLightNodes( builder ) );');
  });

  it('every lit node material builds with the field on WGSL and GLSL: one 3D binding, 3 fetches + 5 trilinear samples', () => {
    const lit = [MeshStandardNodeMaterial, MeshPhysicalNodeMaterial, MeshLambertNodeMaterial, MeshPhongNodeMaterial, MeshToonNodeMaterial];
    const rows: string[] = [];
    for (const backend of ['wgsl', 'glsl'] as const) {
      for (const M of lit) {
        const withField = compile(backend, box(new M()), [stationFieldLight(), new THREE.HemisphereLight()]);
        const f = field3D(backend, withField.fragment);
        // task office-seamless-20261029: + the extended-column group texel (N storeys), inside its branch
        expect(f, `${backend} ${M.name}`).toEqual({decls: 1, fetches: 3, samples: 5});
        expect(/[^\x00-\x7F]/.test(withField.fragment), `${backend} ${M.name}: ASCII-only shader`).toBe(false);
        const without = compile(backend, box(new M()), [new THREE.HemisphereLight()]);
        expect(field3D(backend, without.fragment).decls, `${backend} ${M.name} without the field light`).toBe(0);
        rows.push(`${backend} ${M.name}: ${withField.fragment.length} chars (${withField.fragment.length - without.fragment.length} for the field)`);
      }
      // Unlit materials never get the field (iteration 12: only lit materials had USE_LIGHT_PROBES_GRID); three r186 still
      // runs every light node for MeshBasicNodeMaterial (lights = true, BasicLightingModel): the node skips non-surface models.
      expect(field3D(backend, compile(backend, box(new MeshBasicNodeMaterial()), [stationFieldLight()]).fragment).decls).toBe(0);
    }
    console.log(rows.join('\n'));
  });

  it('feeds the isotropic part to the indirect irradiance and the directional part through the lighting model direct term', () => {
    const proto = LightsNode.prototype as unknown as {setupDirectLight: (this: unknown, builder: unknown, node: unknown, data: {lightDirection?: unknown; lightColor?: unknown}) => void};
    const orig = proto.setupDirectLight;
    const calls: {node: unknown; data: {lightDirection?: unknown; lightColor?: unknown}}[] = [];
    proto.setupDirectLight = function (this: unknown, builder: unknown, node: unknown, data: {lightDirection?: unknown; lightColor?: unknown}) {
      calls.push({node, data});
      return orig.call(this, builder, node, data);
    };
    const ctx = LightFieldNode.prototype as unknown as {setup: (b: {context: {irradiance: unknown}}) => unknown};
    const origSetup = ctx.setup;
    let irradianceSeen = 0;
    ctx.setup = function (this: unknown, b: {context: {irradiance: unknown}}) { if (b.context.irradiance) irradianceSeen++; return origSetup.call(this, b); };
    try {
      for (const backend of ['wgsl', 'glsl'] as const) compile(backend, box(new MeshStandardNodeMaterial()), [stationFieldLight()]);
    } finally {
      proto.setupDirectLight = orig;
      ctx.setup = origSetup;
    }
    const ours = calls.filter(c => c.node instanceof LightFieldNode);
    expect(ours.length).toBe(2);
    for (const c of ours) { expect(c.data.lightDirection).toBeTruthy(); expect(c.data.lightColor).toBeTruthy(); }
    expect(irradianceSeen).toBe(2);
  });

  it('shared TSL helpers build on both backends; the decode has no loop and an unbound fallback', () => {
    bindLightField(null);
    for (const backend of ['wgsl', 'glsl'] as const) {
      const m = new MeshBasicNodeMaterial();
      const band = lfBandAt(positionWorld);
      m.colorNode = vec4(band.slot as Node<'float'>, band.floor as Node<'float'>, band.ceil as Node<'float'>, lfFloorAt(positionWorld) as Node<'float'>);
      const a = compile(backend, box(m), []);
      expect(field3D(backend, a.fragment).fetches, backend).toBe(6); // three per helper call (pick: header + group texel; slot header)
      const m2 = new MeshBasicNodeMaterial();
      m2.colorNode = vec4(lfSlotAt(positionWorld) as Node<'float'>, 0, 0, 1);
      expect(field3D(backend, compile(backend, box(m2), []).fragment)).toEqual({decls: 1, fetches: 2, samples: 0});
      const m3 = new MeshBasicNodeMaterial();
      const s = lightFieldSample(positionWorld);
      m3.colorNode = vec4((s.amb as unknown as {add(x: unknown): unknown}).add(s.dirColor) as never, 1);
      const c = compile(backend, box(m3), []);
      const main = c.fragment.slice(c.fragment.indexOf(backend === 'glsl' ? 'void main' : '@fragment'));
      expect(main).not.toMatch(/\bfor\s*\(|\bloop\s*\{|\bwhile\b/);
    }
    expect(UNBOUND_BAND).toEqual([0, 0, 3.2]);
    expect(LF.bound.value).toBe(0);
    expect(activeLightField()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('slot selection, CPU mirror and the no-leak contract (baked data)', () => {
  it('the TSL float slot decode equals the packed bit layout for every byte and band', () => {
    // pickSlot: min(mod(floor(pk / 2^(2 band)), 4), slots - 1) == (pk >> 2 band) & 3
    for (let pk = 0; pk < 256; pk++) for (let band = 0; band < 3; band++) expect(Math.floor(pk / 2 ** (2 * band)) % 4).toBe((pk >> (2 * band)) & 3);
    // header slice: mix(1, 1 + SLOT_DEPTH - AUX + slot * AUX, min(slot, 1)) == slotBase(slot)
    for (let s = 0; s < 4; s++) { const aux = Math.min(s, 1); expect(1 + (1 + SLOT_DEPTH - AUX_SLOT_DEPTH + s * AUX_SLOT_DEPTH - 1) * aux).toBe(slotBase(s)); }
  });

  it('every open band of every level picks its own slot at mid-height (multi-level stations; never the band above / below)', () => {
    for (const seed of [2, 6]) {
      const l = station(seed), f = baked(seed), geos = levelGeometries(src(l));
      if (geos.length < 2) continue;
      const step = (f.yMax - f.yMin) / 255 + 1e-6;
      let checked = 0, multi = 0;
      for (let cj = 0; cj < f.h; cj += 2) for (let ci = 0; ci < f.w; ci += 2) {
        const i = cj * f.w + ci, mask = f.data[i * 4];
        const bands = geos.map((g, s) => ({s, open: (mask >> s) & 1, f: g.floorH[i], c: g.ceilH[i]})).filter(b => b.open);
        if (bands.length > 1) multi++;
        for (const b of bands) {
          const r = fieldSlot(f, ci, cj, (b.f + b.c) / 2);
          expect(r.slot, `seed ${seed} column ${ci},${cj}`).toBe(b.s);
          expect(Math.abs(r.floor - b.f), `seed ${seed} column ${ci},${cj} floor`).toBeLessThanOrEqual(step);
          expect(Math.abs(r.ceil - b.c), `seed ${seed} column ${ci},${cj} ceil`).toBeLessThanOrEqual(step);
          checked++;
        }
      }
      expect(multi, `seed ${seed}: stacked columns`).toBeGreaterThan(50);
      expect(checked).toBeGreaterThan(500);
    }
  });

  it('the CPU sample (mirror of the TSL decode) reproduces the baked texels at texel centres and layer heights', () => {
    const f = baked(1);
    const dec = (b: number) => (b / 255) ** 2 * FIELD_EMAX;
    let n = 0, lit = 0;
    for (let cj = 1; cj < f.h - 1; cj += 7) for (let ci = 1; ci < f.w - 1; ci += 5) {
      const mask = f.data[(cj * f.w + ci) * 4];
      for (let s = 0; s < f.slots; s++) {
        if (!((mask >> s) & 1)) continue;
        const L = slotLayers(s), yr = f.yMax - f.yMin;
        const h0 = ((slotBase(s) * f.h + cj) * f.w + ci) * 4;
        const fl = f.yMin + f.data[h0] / 255 * yr, ce = f.yMin + f.data[h0 + 1] / 255 * yr;
        for (let k = 0; k < L; k++) {
          const y = fl + Math.max(ce - fl, 0.3) * (k / (L - 1));
          if (fieldSlot(f, ci, cj, y).slot !== s) continue; // a layer height past a quantised band threshold
          const smp = sampleField(f, (ci + 0.5) * CELL, y, (cj + 0.5) * CELL); // levels 1: m = 1, T = decoded texel
          const oa = (((slotBase(s) + 1 + 2 * k) * f.h + cj) * f.w + ci) * 4;
          for (let c = 0; c < 3; c++) expect(smp.amb[c] + smp.dirColor[c]).toBeCloseTo(dec(f.data[oa + c]), 4);
          // the directional share and the direction texel
          const rho = f.data[oa + 3] / 255;
          expect(smp.dirColor[1]).toBeCloseTo(dec(f.data[oa + 1]) * rho, 4);
          if (f.data[oa + 1] > 0) lit++;
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(200);
    expect(lit).toBeGreaterThan(50);
  });

  it('no leak through slabs: an upper-deck-only bake leaves the main floor under the deck dark, in the data and the slot pick', () => {
    const {layout, levels} = renderFixture();
    const f = bakeLightField({grid: layout.grid, lights: layout.lights.filter(x => (x.level ?? 0) === 1), trenchFloorY: RFIX.bedY, levels});
    // main platform floor under deck 1 (x 20, z 6): the slot pick is the main band and its light is exactly zero
    const [ci, cj] = [Math.floor(20 / CELL), Math.floor(6 / CELL)];
    expect(fieldSlot(f, ci, cj, 0.05).slot).toBe(0);
    const s = sampleField(f, 20, 0.05, 6, [1, 1, 1], [0, 1, 0]);
    expect(s.amb.concat(s.dirColor).every(v => v === 0)).toBe(true);
    // ... while the deck above in the same column is lit
    expect(fieldSlot(f, ci, cj, RFIX.upperY + 0.5).slot).toBe(1);
    const up = sampleField(f, 20, RFIX.upperY + 0.05, 7.25, [1, 1, 1], [0, 1, 0]);
    expect(up.amb[1] + up.dirColor[1]).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('StationLighting under WebGPURenderer', () => {
  it('binds the station field to the global TSL nodes and keeps ONE field light across stations', () => {
    const scene = new THREE.Scene();
    const l1 = station(1), l2 = station(2);
    const a = new StationLighting(scene, l1, fixturesOf(l1), null, {hemi: new THREE.HemisphereLight()});
    expect(activeLightField()).toBe(a.volume);
    expect(a.volume).toBeInstanceOf(LightFieldVolume);
    expect(LF.bound.value).toBe(1);
    expect(LF.tex.value).toBe(a.volume.texture);
    expect(LF.dims.value.toArray()).toEqual([a.field.w, a.field.h, a.field.depth]);
    expect(LF.slots.value).toBe(a.field.slots);
    expect(LF.min.value.equals(a.volume.boundingBox.min) && LF.max.value.equals(a.volume.boundingBox.max)).toBe(true);
    const lightsOf = (s: THREE.Scene) => { const out: THREE.Light[] = []; s.traverse(o => { if ((o as THREE.Light).isLight) out.push(o as THREE.Light); }); return out; };
    expect(lightsOf(scene)).toEqual([a.fieldLight]);
    const id = a.fieldLight.id;
    a.update(1 / 30);
    expect(LF.levels.value.toArray()).toEqual(a.levels);
    a.dispose(scene);
    expect(activeLightField()).toBeNull();
    expect(LF.bound.value).toBe(0);
    expect(lightsOf(scene)).toEqual([]);
    const b = new StationLighting(scene, l2, fixturesOf(l2), null);
    expect(b.fieldLight.id).toBe(id); // same light object => same LightsNode cache key => node builder states reused
    expect(b.debug().node).toMatchObject({bound: true, inScene: true, registered: false});
    b.dispose(scene);
    // texture limit from an initialised backend (WebGPU device limits / WebGL2 MAX_3D_TEXTURE_SIZE), fallback otherwise
    expect(max3DTextureSize({backend: {device: {limits: {maxTextureDimension3D: 2048}}}})).toBe(2048);
    expect(max3DTextureSize({backend: {gl: {MAX_3D_TEXTURE_SIZE: 0x8073, getParameter: () => 1024} as unknown as WebGL2RenderingContext}})).toBe(1024);
    expect(max3DTextureSize(null)).toBe(2048);
    const small = new StationLighting(scene, l1, fixturesOf(l1), null, {renderer: {backend: {device: {limits: {maxTextureDimension3D: 256}}}}});
    expect(Math.max(small.field.w, small.field.h)).toBeLessThanOrEqual(256);
    small.dispose(scene);
  });

  it('the station scene light set (LightsNode cache key) never changes: new station, flares, flashlight, flat battery', () => {
    installCanvasShim(false);
    const fx = levelFixture();
    const L = levelsOf(fx);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera, new THREE.HemisphereLight());
    const spot = new THREE.SpotLight(0xfff4e2, 0, 30, 0.58, 0.7, 1.2);
    spot.castShadow = true; // configureFlashlightShadow(high)
    camera.add(spot, spot.target);
    const muzzle = new THREE.PointLight(0xffb468, 0, 8, 2);
    scene.add(muzzle);
    const torch = new PlayerLight(spot, MOOD.flashlight);
    scene.add(torch.glow);
    const ph = new PhysicsSystem(null);
    ph.build(fx);
    const flares = new FlareSystem(scene, ph, new LightSources());
    flares.env = {levelAt: (x, z, y) => L.levelAt(x, z, y), lineOfSight: (a, b) => L.lineOfSight(a, b)};
    let sl = new StationLighting(scene, fx, fixturesOf(fx), null);
    /** What the renderer pushes to the LightsNode: visible lights on the camera's layers (Renderer._projectObject). */
    const key = () => {
      const lights: THREE.Light[] = [];
      const walk = (o: THREE.Object3D) => { if (!o.visible) return; if ((o as THREE.Light).isLight && o.layers.test(camera.layers)) lights.push(o as THREE.Light); o.children.forEach(walk); };
      walk(scene);
      return {key: new LightsNode().setLights(lights).customCacheKey(), n: lights.length};
    };
    const k0 = key();
    expect(k0.n).toBe(1 + 1 + 1 + 1 + 1 + FLARE.maxActive); // hemi, field, spot, muzzle, body glow, pooled flares
    const keys: number[] = [];
    const eye = {x: 21, y: 1.62, z: 5};
    const world = {sources: new LightSources(), eye, feet: {x: 21, y: 0, z: 5}, yaw: 0, level: 0, raycast: () => 5};
    for (let f = 0; f < 600; f++) {
      if (f === 10 || f === 40 || f === 70) flares.throw(eye, {x: 0, y: -0.1, z: 1});
      if (f === 200) torch.toggle();
      if (f === 260) torch.toggle();
      if (f === 300) torch.battery.reset(0); // flat battery: light dead
      muzzle.intensity = f % 9 === 0 ? 18 : 0;
      ph.update(1 / 60); flares.tick(f === 400 ? FLARE.burn : 1 / 60); // f 400: every flare burns out
      torch.update(1 / 60, world);
      sl.update(1 / 60);
      if (f === 450) { sl.dispose(scene); sl = new StationLighting(scene, fx, fixturesOf(fx), null); } // next station
      if (f === 500) flares.clear();
      keys.push(key().key);
    }
    expect(new Set(keys)).toEqual(new Set([k0.key]));
    sl.dispose(scene);
  });
});

// ---------------------------------------------------------------------------------------------
describe('tubes and glow cards: display-referred output, glow fog, node materials', () => {
  it('displayLinear inverts three r186 TSL ACES (round trip at the game exposure); identity without tone mapping', () => {
    const src = three('nodes/display/ToneMappingFunctions.js');
    expect(src).toContain('const a = color.mul( color.add( 0.0245786 ) ).sub( 0.000090537 );');
    expect(src).toContain('const b = color.mul( color.add( 0.4329510 ).mul( 0.983729 ) ).add( 0.238081 );');
    expect(src).toContain('color = color.mul( exposure ).div( 0.6 );');
    let worst = 0;
    for (const d of [[0.02, 0.02, 0.02], [0.2, 0.18, 0.15], [0.5, 0.5, 0.5], [0.9, 0.86, 0.74], [0.95, 0.97, 0.93], [DISPLAY_MAX, DISPLAY_MAX, DISPLAY_MAX], [0.6, 0.37, 0.18]] as const) {
      const lin = displayLinearCPU(d, MOOD.exposure);
      const back = acesDisplayCPU(lin, MOOD.exposure);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(back[c] - d[c]));
    }
    expect(worst).toBeLessThan(2e-3);
    // a near-white tube (k 1): ACES alone would display ~0.70 (iteration 12 showed it un-tone-mapped at ~1)
    expect(acesDisplayCPU([1, 1, 1], MOOD.exposure)[1]).toBeLessThan(0.72);
    expect(acesDisplayCPU(displayLinearCPU([1, 1, 1], MOOD.exposure), MOOD.exposure)[1]).toBeGreaterThan(0.97);
    const m = new MeshBasicNodeMaterial();
    displayReferred(m);
    const aces = compile('glsl', box(m), []).fragment, none = compile('glsl', box(m), [], THREE.NoToneMapping).fragment;
    expect(aces).toContain('sqrt(');
    expect(none).not.toContain('sqrt(');
  });

  it('glow fog + display-referred are node hooks on the tube material; fog factor from scene.fog', () => {
    const tm = new MeshBasicNodeMaterial();
    glowFog(tm, MOOD.glowFog);
    glowFog(tm, MOOD.glowFog); // idempotent
    displayReferred(tm);
    expect(nodeHookKeys(tm)).toEqual(['glow-fog', 'display-referred']);
    expect(tm.fog).toBe(false);
    expect(tm.toneMapped).toBe(false);
    const tubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 0.05), tm, 4);
    tubes.setColorAt(0, new THREE.Color(1, 1, 1));
    for (const backend of ['wgsl', 'glsl'] as const) {
      const c = compile(backend, tubes, []);
      expect(c.fragment).toMatch(/exp\(/);
    }
    syncGlowFog(new THREE.FogExp2(0x112233, 0.05));
    expect(GLOW_FOG.density.value).toBe(0.05);
    expect((GLOW_FOG.color.value as THREE.Color).getHex()).toBe(0x112233);
    syncGlowFog(null);
    expect(GLOW_FOG.density.value).toBe(0);
    // StationLighting turns a WebGL-era MeshBasicMaterial tube into a cached node twin with both hooks.
    const l = station(1);
    const plain = new THREE.MeshBasicMaterial({color: 0xfff4dc});
    const t2 = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 0.05), plain, l.lights.length);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    const sl = new StationLighting(scene, l, fixturesOf(l), t2);
    const twin = t2.material as unknown as NodeMaterial;
    expect(twin.isNodeMaterial).toBe(true);
    expect((twin as unknown as THREE.MeshBasicMaterial).color.getHex()).toBe(0xfff4dc);
    expect(nodeHookKeys(twin)).toEqual(['glow-fog', 'display-referred']);
    expect(GLOW_FOG.density.value).toBe(MOOD.fogDensity);
    sl.dispose(scene);
    const t3 = new THREE.InstancedMesh(t2.geometry, plain, l.lights.length);
    const sl2 = new StationLighting(scene, l, fixturesOf(l), t3);
    expect(t3.material).toBe(twin); // shared across stations: one twin, hooks once
    sl2.dispose(scene);
  });

  it('glow cards: instanced camera-facing node material builds on both backends (billboard from the instance translation)', () => {
    const m = glowMaterial(70);
    expect(m.isNodeMaterial).toBe(true);
    expect([m.transparent, m.depthWrite, m.blending, m.fog]).toEqual([true, false, THREE.AdditiveBlending, false]);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, 3);
    for (let i = 0; i < 3; i++) { im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, 3, 0)); im.setColorAt(i, new THREE.Color(1, 0.9, 0.6)); }
    for (const backend of ['wgsl', 'glsl'] as const) {
      const c = compile(backend, im, []);
      expect(c.vertex.length).toBeGreaterThan(100);
      if (backend === 'glsl') {
        expect(c.vertex).toMatch(/positionLocal = \( \w+\[ uint\( gl_InstanceID \) \] \* vec4\( positionLocal, 1\.0 \) \)\.xyz;/);
        expect(c.vertex).toContain('( positionLocal - position )'); // card centre = instance translation
        expect(c.vertex).toContain('vec2( 1.5, 0.75 )');
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('flashlight shadow and the shadow-side rule on WebGPURenderer', () => {
  it('a castShadow SpotLight adds a shadow lookup only to receiveShadow meshes (both backends)', () => {
    for (const backend of ['wgsl', 'glsl'] as const) {
      const spot = new THREE.SpotLight(0xfff4e2, 34, 30, 0.58, 0.7, 1.2);
      spot.castShadow = true;
      const recv = box(new MeshStandardNodeMaterial());
      recv.receiveShadow = true;
      const a = compile(backend, recv, [spot, stationFieldLight()]);
      const noRecv = compile(backend, box(new MeshStandardNodeMaterial()), [spot, stationFieldLight()]);
      const shadowTex = backend === 'glsl' ? /uniform\s+(?:highp\s+)?sampler2DShadow\s+\w+/ : /:\s*texture_depth_2d\b/;
      expect(a.fragment, backend).toMatch(shadowTex);
      expect(noRecv.fragment, backend).not.toMatch(shadowTex);
      expect(field3D(backend, a.fragment).decls).toBe(1);
    }
  });

  it('flashlight surface bias is slope-scaled for the node PCF footprint: no self-shadow up close, less peter-panning far away', () => {
    const o = {angle: 0.58, mapSize: 1024, near: SHADOW_NEAR, far: 30};
    const oldDepth = shadowBiasFor(1024, 0.58); // iteration 12: one constant depth bias
    const oldWorld = (z: number) => -oldDepth * z * z / o.near; // its world offset (perspective depth ~ near / z^2)
    const texel = (z: number) => 2 * Math.tan(o.angle) * z / o.mapSize;
    for (const z of [0.6, 1, 1.5, 2, 3, 5, 8, 12, 20]) for (const deg of [0, 20, 45, 60, 75, 80, 89]) {
      const c = Math.cos(deg * Math.PI / 180);
      const b = flashShadowBiasCPU(z, c, o);
      expect(b.depthBias).toBeLessThan(0);
      expect(Number.isFinite(b.depthBias)).toBe(true);
      // the receiver clears its own surface across the filter footprint (up to the grazing clamp)
      const tanT = Math.min(FLASH_SHADOW.maxSlope, Math.tan(Math.min(deg, 87) * Math.PI / 180));
      expect(b.worldOffset).toBeGreaterThanOrEqual(FLASH_SHADOW.footprint * texel(z) * tanT);
    }
    // close curved receivers (zombies at 1 - 1.5 m, 45 deg): several times the old offset (which covered < 1 texel there)
    expect(flashShadowBiasCPU(1, Math.SQRT1_2, o).worldOffset).toBeGreaterThan(4 * oldWorld(1));
    expect(oldWorld(1)).toBeLessThan(2 * texel(1));
    // far receivers facing the light: far less offset than iteration 12 (0.22 m at 10 m)
    expect(flashShadowBiasCPU(10, 1, o).worldOffset).toBeLessThan(oldWorld(10) / 4);
    // installed by PlayerLight as the light's biasNode (surface lookups); shadow.bias keeps the march's value
    const spot = new THREE.SpotLight(0xfff4e2, 34, 30, 0.58, 0.7, 1.2);
    spot.castShadow = true;
    spot.shadow.bias = oldDepth;
    void new PlayerLight(spot, MOOD.flashlight);
    expect((spot.shadow as unknown as {biasNode: unknown}).biasNode).toBeTruthy();
    expect(spot.shadow.bias).toBe(oldDepth);
    expect(spot.shadow.normalBias).toBe(FLASH_SHADOW.normalBias);
    const recv = box(new MeshStandardNodeMaterial());
    recv.receiveShadow = true;
    for (const backend of ['wgsl', 'glsl'] as const) expect(compile(backend, recv, [spot]).fragment, backend).toMatch(/\btan\(/);
  });

  it("three r186 WebGPURenderer draws shadowSide ?? flip(side) in the PCF shadow pass (the iteration-12 container-liner rule)", () => {
    const r = three('renderers/common/Renderer.js');
    expect(r).toContain('const _shadowSide = { [ FrontSide ]: BackSide, [ BackSide ]: FrontSide, [ DoubleSide ]: DoubleSide };');
    expect(r).toContain('overrideMaterial.side = ( material.shadowSide !== null ) ? material.shadowSide : _shadowSide[ material.side ];');
    // same depth-space bias convention as WebGL (shadowCoord.z + bias, normalBias along the world normal)
    const s = three('nodes/lighting/ShadowNode.js');
    expect(s).toContain("const bias = shadow.biasNode || reference( 'bias', 'float', shadow ).setGroup( renderGroup );");
    expect(s).toContain('renderer.reversedDepthBuffer ? coordZ.sub( bias ) : coordZ.add( bias )');
    expect(s).toContain('const shadowNormalBias = normalWorld.mul( normalBias );');
  });
});

describe('QA light-field GPU probe (iteration 13 resume)', () => {
  it('its readback material builds for both backends (GLSL select() isolated the field vars: "addToStack" in the browser)', async () => {
    const {QuadMesh} = await import('three/webgpu');
    const {compileQuad} = await import('./helpers/fogCompile');
    const qm = QuadMesh.prototype as unknown as {render(r: unknown): void};
    const orig = qm.render;
    for (const backend of ['glsl', 'wgsl'] as const) {
      const built: string[] = [];
      // stand-in renderer: build the probe quad's material with the real node builder instead of drawing it
      qm.render = function (this: {material: NodeMaterial}) { built.push(compileQuad(this.material, backend).fragment); };
      const fake = {getRenderTarget: () => null, setRenderTarget() {}, readRenderTargetPixelsAsync: async () => new Float32Array(8)};
      try { await probeLightFieldGPU(fake, [{p: [0, 0, 0]}, {p: [1, 1, 1], n: [0, 1, 0]}]); } finally { qm.render = orig; }
      expect(built.length, backend).toBe(3); // isotropic / directional / direction rows
      for (const f of built) expect(f.length).toBeGreaterThan(500);
    }
  });
});
