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
  MeshStandardNodeMaterial, MeshToonNodeMaterial, NodeMaterial, QuadMesh, WGSLNodeBuilder, WebGPURenderer, type Node,
} from 'three/webgpu';
import {normalWorld, positionWorld, uniform, vec4} from 'three/tsl';
import {generateStation, type StationLayout} from '../src/gen/station';
import {CELL} from '../src/gen/grid';
import type {Fixture} from '../src/world/builder';
import {
  AUX_SLOT_DEPTH, FIELD_EMAX, LightFieldVolume, MAX_SLOTS, SLOT_DEPTH, bakeLightField, downsampleField, fieldDepth, fieldSlot, isExtendedHeader, levelGeometries, sampleField,
  slotBase, slotLayers, withoutCube, type BakedField, type FieldSource,
} from '../src/world/lightField';
import {
  LF, LightFieldLight, LightFieldNode, UNBOUND_BAND, activeLightField, bindLightField, installLightFieldNode, lfBandAt, lfFloorAt, lfSlotAt,
  lightFieldSample, probeLightFieldGPU, stationFieldLight, stationLights,
} from '../src/world/lightFieldNode';
import {
  DISPLAY_MAX, FLASH_BOUNCE, GLOW_FOG, MOOD, StationLighting, acesDisplayCPU, displayLinearCPU, displayReferred, glowFog, glowMaterial, max3DTextureSize, syncGlowFog,
} from '../src/world/lights';
import {FB, FLASH_VPLS} from '../src/world/flashBounce';
import {BandScene} from '../src/world/lightScene';
import {surfaceAlbedo} from '../src/world/surfaceAlbedo';
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
import {towerFixture} from './helpers/towerFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {rendererFor} from './helpers/fogCompile';
import {arrayVal, mainBody, runFlow, type Env, type Val} from './helpers/glslEval';
import {bakeRows, patternRows, sequence} from './helpers/lightCubeFixture';

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

/** A uniform of a built stage: its name in the shader, its type ('buffer' = a uniform array), the node it was made for, its group. */
interface BuiltUniform { name: string; type: string; node: unknown; groupNode?: {name: string} }
interface Built { vertex: string; fragment: string; uniforms: BuiltUniform[] }
function compile(backend: Backend, mesh: THREE.Mesh, lights: THREE.Light[], toneMapping?: THREE.ToneMapping): Built {
  const r = headless(backend, toneMapping);
  const scene = new THREE.Scene();
  scene.add(mesh);
  for (const l of lights) if (!l.parent) scene.add(l);
  const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
  const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; vertexShader: string; fragmentShader: string; uniforms: {fragment: BuiltUniform[]}};
  b.scene = scene;
  b.camera = new THREE.PerspectiveCamera();
  b.material = mesh.material as THREE.Material;
  b.context.material = b.material;
  b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights(lights);
  b.build();
  scene.remove(mesh);
  for (const l of lights) if (l.parent === scene) scene.remove(l); // (the session-wide field lights are shared with the other tests' scenes)
  return {vertex: b.vertexShader, fragment: b.fragmentShader, uniforms: b.uniforms.fragment};
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** What a stage binds besides its samplers: uniform buffers (WebGPU allows 12 a stage) and textures. */
function bindings(backend: Backend, code: string): {buffers: number; textures: number} {
  return backend === 'wgsl'
    ? {buffers: count(code, /\bvar<uniform>/g), textures: count(code, /\bvar\s+\w+\s*:\s*texture_\w+/g)}
    : {buffers: count(code, /\buniform\s+\w+\s*\{/g), textures: count(code, /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?[iu]?sampler\w+\s+\w+\s*;/g)};
}
/** The members of the render group's uniform block (the one buffer LF, the ride mask and the flashlight bounce live in). */
const renderBlock = (backend: Backend, code: string): string => (backend === 'wgsl' ? /struct\s+renderStruct\s*\{([^}]*)\}/ : /uniform\s+render\s*\{([^}]*)\}/).exec(code)?.[1] ?? '';
/** A built stage's uniforms counted by type and group. */
function tally(b: Built): Map<string, number> {
  const m = new Map<string, number>();
  for (const u of b.uniforms) { const k = `${u.type} in ${u.groupNode?.name ?? '-'}`; m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}
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
// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane TESTS): the FULL field light — a second session-wide light whose node
// shades by the surface normal from the field's ambient cube and adds the flashlight's bounce. The plain light's programs must stay
// exactly what they were; the full one may cost three more samples of the SAME texture and plain render-group uniforms, nothing else.
describe('full shading: the FULL field light (the ambient cube and the flashlight bounce in the program)', () => {
  const lit = [MeshStandardNodeMaterial, MeshPhysicalNodeMaterial, MeshLambertNodeMaterial, MeshPhongNodeMaterial, MeshToonNodeMaterial];
  const bounceNodes: unknown[] = [...FB.pos, ...FB.nrm, ...FB.col, FB.params];

  it('a second session-wide light, fixed when made: its own id (its own programs), the one lighting node class', () => {
    const plain = stationFieldLight(), full = stationFieldLight(true);
    expect(full).not.toBe(plain);
    expect(stationFieldLight(true)).toBe(full);
    expect(stationFieldLight(false)).toBe(plain);
    expect([plain.full, full.full]).toEqual([false, true]);
    expect([plain.name, full.name]).toEqual(['light-field', 'light-field-full']);
    expect(full.id).not.toBe(plain.id);
    expect([full.isLight, full.castShadow, full.intensity]).toEqual([true, false, 1]);
    expect(stationLights()).toEqual(expect.arrayContaining([plain, full]));
    // one registration serves both (three resolves a light's node by its constructor)
    expect(full.constructor).toBe(LightFieldLight);
    for (const b of ['glsl', 'wgsl'] as const) expect((headless(b).library as unknown as {getLightNodeClass(c: unknown): unknown}).getLightNodeClass(full.constructor)).toBe(LightFieldNode);
    // the two light sets are two cache keys: a station shaded the other way builds its own programs and leaves the plain ones alone
    expect(new LightsNode().setLights([full]).customCacheKey()).not.toBe(new LightsNode().setLights([plain]).customCacheKey());
  });

  it('every lit material, both backends: the plain program has no cube lookup and no bounce uniform; the full one adds exactly three samples of the field texture and plain render-group uniforms — no texture, no uniform buffer, no array more', () => {
    expect(bounceNodes.length).toBe(FLASH_VPLS * 3 + 1);
    const has = (b: Built, node: unknown) => b.uniforms.some(u => u.node === node);
    const rows: string[] = [];
    for (const backend of ['wgsl', 'glsl'] as const) {
      for (const M of lit) {
        const tag = `${backend} ${M.name}`;
        // (one material for both: what differs is the light alone)
        const mesh = box(new M());
        const plain = compile(backend, mesh, [stationFieldLight(), new THREE.HemisphereLight()]);
        const full = compile(backend, mesh, [stationFieldLight(true), new THREE.HemisphereLight()]);
        // the plain light: the program it always was
        expect(field3D(backend, plain.fragment), `${tag} plain`).toEqual({decls: 1, fetches: 3, samples: 5});
        expect(has(plain, LF.cube), `${tag} plain: LF.cube`).toBe(false);
        expect(bounceNodes.filter(n => has(plain, n)).length, `${tag} plain: bounce uniforms`).toBe(0);
        expect(plain.fragment).not.toMatch(/\bfb(?:Pos|Nrm|Col|Params)/);
        // the full light: the same one 3D texture, the same three fetches, three more filtered samples (one cube face per axis)
        expect(field3D(backend, full.fragment), `${tag} full`).toEqual({decls: 1, fetches: 3, samples: 8});
        expect(field3D(backend, full.vertex).decls, `${tag} full: nothing of the field in the vertex stage`).toBe(0);
        expect(/[^\x00-\x7F]/.test(full.fragment), `${tag} full: ASCII-only shader`).toBe(false);
        expect(has(full, LF.cube), `${tag} full: LF.cube`).toBe(true);
        expect(bounceNodes.filter(n => has(full, n)).length, `${tag} full: bounce uniforms`).toBe(bounceNodes.length);
        // what it binds: exactly what the plain program binds (WebGPU allows 12 uniform buffers a stage; every uniformArray is one)
        const pb = bindings(backend, plain.fragment), fb = bindings(backend, full.fragment);
        expect(fb, `${tag}: buffers and textures`).toEqual(pb);
        expect(bindings(backend, full.vertex), `${tag}: vertex stage`).toEqual(bindings(backend, plain.vertex));
        expect(fb.buffers).toBeGreaterThan(0);
        if (backend === 'wgsl') expect(fb.buffers).toBeLessThanOrEqual(12);
        // its uniforms, by type and group: the cube's vec2 and the bounce's vec4s in the render group; on GLSL three's per-sample
        // flip flag for each of the three new samples; nothing else — no array ('buffer'), no texture
        const tp = tally(plain), tf = tally(full), more = new Map<string, number>();
        for (const k of new Set([...tp.keys(), ...tf.keys()])) { const d = (tf.get(k) ?? 0) - (tp.get(k) ?? 0); if (d !== 0) more.set(k, d); }
        const flips = backend === 'glsl' ? [...more].filter(([k]) => k.startsWith('uint in ')) : [];
        expect(flips.reduce((s, [, d]) => s + d, 0), `${tag}: flip flags`).toBe(backend === 'glsl' ? 3 : 0);
        for (const [k] of flips) more.delete(k);
        expect(Object.fromEntries(more), `${tag}: uniforms the full program adds`).toEqual({'vec2 in render': 1, 'vec4 in render': bounceNodes.length});
        expect([...tf.keys()].filter(k => k.startsWith('buffer in ')).reduce((s, k) => s + tf.get(k)!, 0), `${tag}: uniform arrays`).toBe([...tp.keys()].filter(k => k.startsWith('buffer in ')).reduce((s, k) => s + tp.get(k)!, 0));
        // and they are members of the render group's one block (not a block of their own)
        const block = renderBlock(backend, full.fragment);
        expect(block.length, `${tag}: render block`).toBeGreaterThan(0);
        for (const node of [LF.cube, ...bounceNodes]) {
          const u = full.uniforms.find(x => x.node === node)!;
          expect(new RegExp(`\\b${u.name}\\b`).test(block), `${tag}: ${u.name} in the render block`).toBe(true);
        }
        rows.push(`${tag}: plain ${plain.fragment.length} chars, full ${full.fragment.length} (+${full.fragment.length - plain.fragment.length}); ${fb.buffers} uniform buffers, ${fb.textures} textures either way`);
      }
      // unlit materials get nothing from the full light either
      expect(field3D(backend, compile(backend, box(new MeshBasicNodeMaterial()), [stationFieldLight(true)]).fragment).decls).toBe(0);
    }
    console.log(rows.join('\n'));
  });

  it('the shared sample helper: `cube` adds the three face samples; without it the nodes are the ones it always built', () => {
    for (const backend of ['wgsl', 'glsl'] as const) {
      const build = (cube: boolean) => {
        const m = new MeshBasicNodeMaterial();
        const s = lightFieldSample(positionWorld, cube ? {normal: normalWorld, cube: normalWorld} : {normal: normalWorld});
        m.colorNode = vec4((s.amb as unknown as {add(x: unknown): unknown}).add(s.dirColor) as never, 1);
        return compile(backend, box(m), []);
      };
      const plain = build(false), cube = build(true);
      expect(field3D(backend, plain.fragment), backend).toEqual({decls: 1, fetches: 3, samples: 5});
      expect(field3D(backend, cube.fragment), backend).toEqual({decls: 1, fetches: 3, samples: 8});
      expect(plain.uniforms.some(u => u.node === LF.cube)).toBe(false);
      expect(cube.uniforms.some(u => u.node === LF.cube)).toBe(true);
      expect(bindings(backend, cube.fragment)).toEqual(bindings(backend, plain.fragment));
      const main = cube.fragment.slice(cube.fragment.indexOf(backend === 'glsl' ? 'void main' : '@fragment'));
      expect(main).not.toMatch(/\bfor\s*\(|\bloop\s*\{|\bwhile\b/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The generated GLSL of lightFieldSample, evaluated on the CPU (tests/helpers/glslEval.ts runFlow) against sampleField — the shader's
// own text, with the field's bytes behind a clamp-to-edge trilinear `textureLod` and an integer `texelFetch`.
type P3 = readonly [number, number, number];
interface SampleHarness {
  /** Filtered samples in the program (5 plain, 8 with the cube). */
  samples: number;
  /** null: nothing bound (the placeholder). */
  run(f: BakedField | null, p: P3, n: P3, levels?: P3): {amb: number[]; dirColor: number[]; dir: number[]};
}
function sampleHarness(cube: boolean): SampleHarness {
  const P = uniform(new THREE.Vector3()), Nn = uniform(new THREE.Vector3());
  const m = new NodeMaterial();
  const s = lightFieldSample(P as never, cube ? {normal: Nn as never, cube: Nn as never} : {normal: Nn as never});
  const named = (x: unknown, name: string) => (x as {toVar(n: string): {add(y: unknown): unknown}}).toVar(name);
  const amb = named(s.amb, 'lfAmb'), dc = named(s.dirColor, 'lfDirColor'), dir = named(s.dir, 'lfDirOut');
  m.fragmentNode = vec4((amb.add(dc) as {add(y: unknown): unknown}).add(dir) as never, 1).toVar('lfProbe') as never;
  const B = new (GLSLNodeBuilder as unknown as new (o: unknown, r: unknown) => {
    scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; build(): void; fragmentShader: string; uniforms: {fragment: BuiltUniform[]};
  })(new QuadMesh(m), rendererFor('glsl'));
  B.scene = new THREE.Scene(); B.camera = new THREE.OrthographicCamera(); B.material = m;
  B.build();
  const code = mainBody(B.fragmentShader), unis = B.uniforms.fragment;
  const zero = {w: 1, h: 1, depth: fieldDepth(1), data: new Uint8Array(fieldDepth(1) * 4)};
  return {
    samples: count(B.fragmentShader, /\btextureLod\(/g),
    run(f, p, n, levels = [1, 1, 1]) {
      const vol = f ? new LightFieldVolume(f) : null;
      vol?.setLevels(levels[0], levels[1], levels[2]);
      bindLightField(vol);
      try {
        const env: Env = new Map();
        for (const u of unis) {
          const v = (u.node as {value?: unknown}).value;
          if (u.node === P) env.set(u.name, [...p]);
          else if (u.node === Nn) env.set(u.name, [...n]);
          else if (u.node === LF.slotY) env.set(u.name, arrayVal((LF.slotY as unknown as {array: THREE.Vector4[]}).array.map(q => q.toArray())));
          else if (u.type === 'uint') env.set(u.name, 0); // three's per-sample flip flag (not a render target)
          else if (typeof v === 'number') env.set(u.name, v); // LF.slots / gain / bound
          else if (v && !(v as {isTexture?: boolean}).isTexture && typeof (v as {toArray?: unknown}).toArray === 'function') env.set(u.name, (v as {toArray(): number[]}).toArray()); // LF / RM vectors
          else env.set(u.name, 0); // the sampler (the two functions below read the bound field)
        }
        const t = f ?? zero, dims = [t.w, t.h, t.depth];
        const texel = (x: number, y: number, z: number) => { const o = ((z * t.h + y) * t.w + x) * 4; return [t.data[o] / 255, t.data[o + 1] / 255, t.data[o + 2] / 255, t.data[o + 3] / 255]; };
        const clampTo = (q: number, size: number) => Math.min(size - 1, Math.max(0, q));
        const fns = {
          ivec3: (a: Val[]) => (a as unknown as number[][]).flat().slice(0, 3).map(Math.trunc),
          texelFetch: (a: Val[]) => { const [x, y, z] = a[1] as number[]; return texel(x, y, z); },
          // LinearFilter, ClampToEdge on all three axes, level 0 (world/lightField.ts configureFieldTexture)
          textureLod: (a: Val[]) => {
            const c = (a[1] as number[]).map((q, i) => q * dims[i] - 0.5), i0 = c.map(Math.floor), fr = c.map((q, i) => q - i0[i]), out = [0, 0, 0, 0];
            for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
              const w = (dx ? fr[0] : 1 - fr[0]) * (dy ? fr[1] : 1 - fr[1]) * (dz ? fr[2] : 1 - fr[2]);
              if (w === 0) continue;
              const q = texel(clampTo(i0[0] + dx, t.w), clampTo(i0[1] + dy, t.h), clampTo(i0[2] + dz, t.depth));
              for (let k = 0; k < 4; k++) out[k] += w * q[k];
            }
            return out;
          },
        };
        runFlow(code, env, fns, 'lfProbe');
        return {amb: env.get('lfAmb') as number[], dirColor: env.get('lfDirColor') as number[], dir: env.get('lfDirOut') as number[]};
      } finally {
        bindLightField(null);
        vol?.dispose();
      }
    },
  };
}

describe('TSL sample parity: the generated GLSL of lightFieldSample equals sampleField, with and without the ambient cube', () => {
  const threeLevels = (): FieldSource => { const {layout, levels} = renderFixture(); return {grid: layout.grid, lights: layout.lights, trenchFloorY: RFIX.bedY, levels}; };
  const towerSource = (): FieldSource => { const t = towerFixture({lights: false}); return {grid: t.layout.grid, lights: t.layout.lights, trenchFloorY: -1.15, levels: t.levels}; };
  /** Random points in and a little round a field's box, random unit normals (some along an axis, some with a zero component), random circuit levels. */
  function* cases(f: BakedField, count: number, seed: number): Generator<{p: P3; n: P3; levels: P3}> {
    const rnd = sequence(seed), C = CELL * (f.cellScale ?? 1), W = f.w * C, D = f.h * C;
    for (let q = 0; q < count; q++) {
      const p: P3 = [-1 + rnd() * (W + 2), f.yMin - 0.5 + rnd() * (f.yMax - f.yMin + 1), -1 + rnd() * (D + 2)];
      const v = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], l = Math.hypot(v[0], v[1], v[2]) || 1;
      const n: P3 = q % 6 === 0 ? [0, v[1] < 0 ? -1 : 1, 0] : q % 6 === 1 ? [v[0] < 0 ? -1 : 1, 0, 0] : q % 6 === 2 ? [v[0] / Math.hypot(v[0], v[2]), 0, v[2] / Math.hypot(v[0], v[2])] : [v[0] / l, v[1] / l, v[2] / l];
      yield {p, n, levels: q % 3 === 0 ? [1, 1, 1] : [rnd(), rnd(), rnd()]};
    }
  }
  /** How many of `count` cases the harness and the CPU sample disagree on, and how many samples held light at all. */
  function compare(H: SampleHarness, bound: BakedField, cpu: BakedField, count: number, seed: number): {off: number; lit: number; worst: number} {
    let off = 0, lit = 0, worst = 0;
    for (const c of cases(bound, count, seed)) {
      const g = H.run(bound, c.p, c.n, c.levels), s = sampleField(cpu, c.p[0], c.p[1], c.p[2], c.levels, c.n);
      let bad = false;
      for (let k = 0; k < 3; k++) for (const [a, b] of [[g.amb[k], s.amb[k]], [g.dirColor[k], s.dirColor[k]], [g.dir[k], s.dir[k]]]) {
        const e = Math.abs(a - b);
        if (!(e <= 1e-9 + Math.abs(b) * 1e-9)) bad = true;
        if (e > worst) worst = e;
      }
      if (bad) off++;
      if (s.amb[0] + s.amb[1] + s.amb[2] > 1e-4) lit++;
    }
    return {off, lit, worst};
  }

  it('three levels, a nine-storey tower (extended headers) and a downsampled field: amb (the cube\'s faces), dirColor and dir agree at random points, normals and circuit levels', () => {
    const H = sampleHarness(true);
    expect(H.samples).toBe(8);
    const three = bakeRows(threeLevels(), patternRows(1.2, 11)).field, tall = bakeRows(towerSource(), patternRows(0.8)).field, half = downsampleField(three, 2);
    expect([three.gi, tall.gi, half.gi].every(g => g !== undefined)).toBe(true);
    expect([three.slots, tall.slots, tall.hdr, half.cellScale]).toEqual([3, 9, 3, 2]);
    const rows: string[] = [];
    for (const [name, f, count] of [['three levels', three, 1500], ['tower', tall, 1500], ['half resolution', half, 800]] as const) {
      const r = compare(H, f, f, count, 17);
      rows.push(`${name}: ${count} points, ${r.lit} lit, worst difference ${r.worst.toExponential(1)}`);
      expect(r.off, name).toBe(0);
      expect(r.lit, `${name}: lit samples`).toBeGreaterThan(count * 0.1);
    }
    console.log(`cube sample parity (GLSL vs sampleField): ${rows.join('; ')}`);
    // and the cube is what was compared: the same points on the field without it read differently
    let differ = 0;
    for (const c of cases(three, 300, 17)) {
      const a = sampleField(three, c.p[0], c.p[1], c.p[2], c.levels, c.n).amb, b = sampleField(withoutCube(three), c.p[0], c.p[1], c.p[2], c.levels, c.n).amb;
      if (a.some((v, k) => Math.abs(v - b[k]) > 1e-6)) differ++;
    }
    expect(differ).toBeGreaterThan(30);
  });

  it('a field without a cube under the cube program reads as plain (LF.cube.y = 0); the plain program never reads a cube; nothing bound = no light', () => {
    const withCube = sampleHarness(true), plain = sampleHarness(false);
    expect(plain.samples).toBe(5);
    const f = bakeRows(threeLevels(), patternRows(1.2, 11)).field, bare = withoutCube(f), base = bakeLightField(threeLevels());
    // the full light over a station that kept no cube (a renderer whose 3D textures are too shallow), and over a baseline bake
    for (const [name, field] of [['enhanced, cube left out', bare], ['baseline bake', base]] as const) {
      const r = compare(withCube, field, field, 600, 23);
      expect(r.off, name).toBe(0);
      expect(r.lit, name).toBeGreaterThan(60);
    }
    // the plain program: the main texels alone, whether the bound texture has cube slices behind them or not
    expect(compare(plain, f, bare, 600, 29).off).toBe(0);
    expect(compare(plain, bare, bare, 300, 31).off).toBe(0);
    // nothing bound: both programs give no light at all (and a fixed direction)
    for (const H of [withCube, plain]) {
      const z = H.run(null, [3, 1, 4], [0, 1, 0]);
      expect([...z.amb, ...z.dirColor]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(z.dir.every(Number.isFinite)).toBe(true);
    }
    expect(activeLightField()).toBeNull();
    expect(LF.cube.value.toArray()).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('slot selection, CPU mirror and the no-leak contract (baked data)', () => {
  it('the TSL float slot decode equals the packed bit layout for every byte and band', () => {
    // pickSlot: min(mod(floor(pk / 2^(2 band)), 4), slots - 1) == (pk >> 2 band) & 3
    for (let pk = 0; pk < 256; pk++) for (let band = 0; band < 3; band++) expect(Math.floor(pk / 2 ** (2 * band)) % 4).toBe((pk >> (2 * band)) & 3);
    // header slice: mix(1, 1 + SLOT_DEPTH - AUX + slot * AUX, min(slot, 1)) == slotBase(slot) (every slot, N storeys)
    for (let s = 0; s < MAX_SLOTS; s++) { const aux = Math.min(s, 1); expect(1 + (1 + SLOT_DEPTH - AUX_SLOT_DEPTH + s * AUX_SLOT_DEPTH - 1) * aux).toBe(slotBase(s)); }
    // task office-seamless-20261029, extended columns: A in 1..63 (count bits 0) never collides with a legacy byte; the group
    // slice 1 + SLOT_DEPTH - AUX + slots * AUX + g == fieldDepth(slots) + g; the slot-id pair byte splits exactly in floats
    for (let pk = 0; pk < 256; pk++) expect(isExtendedHeader(pk)).toBe(pk > 0 && Math.floor(pk / 64) === 0);
    for (let S = 1; S <= MAX_SLOTS; S++) expect(1 + SLOT_DEPTH - AUX_SLOT_DEPTH + S * AUX_SLOT_DEPTH).toBe(fieldDepth(S));
    for (let b = 0; b < 256; b++) { const hi = Math.floor(b / 16); expect([b - hi * 16, hi]).toEqual([b & 15, b >> 4]); }
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

  // Task studio-baked-gi-visual-uplift-20261115-004324-01: StationLightingOptions.shading / .bounce (the enhanced runtime's bake hands
  // them over: tests/enhanced-lighting-runtime.test.ts) — here over a station field with a hand-made cube.
  it('shading: the cube stays on the GPU only for full shading that fits; the full light, LF.cube and the flashlight bounce follow it', () => {
    const scene = new THREE.Scene(), l = station(1);
    const cube = bakeRows(src(l), patternRows(0.6)).field, base = baked(1);
    expect(cube.gi).toBe(base.depth);
    const geos = levelGeometries(src(l));
    const bounce = {scene: new BandScene(cube.w, cube.h, geos), albedo: surfaceAlbedo(cube.w, cube.h, stationLevels(l), geos, null)};
    const stationLightsIn = (s: THREE.Scene) => s.children.filter(c => (stationLights() as THREE.Object3D[]).includes(c));
    const bound = () => FLASH_BOUNCE.debug().bound;
    expect(bound()).toBe(false);

    // full shading: the bake IS the field, cube and all; the full light; the cube's first slice on LF.cube; the bounce bound
    const full = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, shading: 'full', bounce});
    expect([full.full, full.shadingSkipped, full.mirror]).toEqual([true, null, false]);
    expect(full.field).toBe(cube);
    expect(full.fieldLight).toBe(stationFieldLight(true));
    expect(stationLightsIn(scene)).toEqual([stationFieldLight(true)]);
    expect(LF.cube.value.toArray()).toEqual([cube.gi, 1]);
    expect(LF.dims.value.toArray()).toEqual([cube.w, cube.h, cube.depth]);
    expect((full.volume.texture.image as {depth: number}).depth).toBe(cube.depth);
    expect(full.bounce).toBe(bounce);
    expect(bound()).toBe(true);
    full.dispose(scene);
    expect([bound(), LF.cube.value.toArray(), stationLightsIn(scene)]).toEqual([false, [0, 0], []]);

    // plain shading (asked for, or nothing said): the same bake WITHOUT its cube — a view of the same bytes —, the plain light,
    // no cube on LF.cube, and no bounce even when one is handed over
    for (const o of [{}, {shading: 'plain' as const, bounce}]) {
      const plain = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, ...o});
      expect([plain.full, plain.shadingSkipped, plain.bounce]).toEqual([false, null, null]);
      expect([plain.field.gi, plain.field.depth]).toEqual([undefined, cube.gi]);
      expect(plain.field.data.buffer).toBe(cube.data.buffer); // (nothing copied)
      expect(plain.field.data.byteLength).toBe(cube.gi! * cube.w * cube.h * 4);
      expect((plain.volume.texture.image as {depth: number}).depth).toBe(cube.gi);
      expect(plain.fieldLight).toBe(stationFieldLight());
      expect(stationLightsIn(scene)).toEqual([stationFieldLight()]);
      expect([LF.cube.value.toArray(), LF.dims.value.z, bound()]).toEqual([[0, 0], cube.gi, false]);
      plain.dispose(scene);
    }

    // full shading asked for a bake that has no cube (the baseline): nothing to keep, nothing skipped — plain
    const none = new StationLighting(scene, l, fixturesOf(l), null, {baked: base, shading: 'full', bounce});
    expect([none.full, none.shadingSkipped, none.bounce, none.fieldLight === stationFieldLight(), bound()]).toEqual([false, null, null, true, false]);
    expect(none.field).toBe(base);
    none.dispose(scene);

    // a renderer whose 3D textures are shallower than the field WITH its cube: the cube is left out and the reason kept
    const max = cube.depth - 1;
    const shallow = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, shading: 'full', bounce, max3DTextureSize: max});
    expect(shallow.shadingSkipped).toBe(`the field with its cube (${cube.depth} slices) is deeper than this renderer's 3D textures (${max})`);
    expect([shallow.full, shallow.bounce, shallow.field.gi, shallow.field.depth]).toEqual([false, null, undefined, cube.gi]);
    expect(Math.max(shallow.field.w, shallow.field.h, shallow.field.depth)).toBeLessThanOrEqual(max);
    expect([shallow.fieldLight === stationFieldLight(), LF.cube.value.toArray(), bound()]).toEqual([true, [0, 0], false]);
    shallow.dispose(scene);

    // a field downsampled to fit (the grid is wider than the limit, the depth fits): the cube is downsampled with it and stays
    const small = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, shading: 'full', bounce, max3DTextureSize: 256});
    expect(cube.w).toBeGreaterThan(256);
    expect([small.full, small.shadingSkipped, small.field.gi, small.field.depth]).toEqual([true, null, cube.gi, cube.depth]);
    expect(Math.max(small.field.w, small.field.h)).toBeLessThanOrEqual(256);
    expect([LF.cube.value.toArray(), small.fieldLight === stationFieldLight(true), bound()]).toEqual([[cube.gi, 1], true, true]);
    small.dispose(scene);

    // the byte cap is the slots' (the cube has its own bound, in the enhanced runtime): a cap the slots just fit keeps full resolution
    const slotBytes = cube.gi! * cube.w * cube.h * 4;
    expect(cube.data.byteLength).toBeGreaterThan(slotBytes * 2);
    const fits = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, shading: 'full', maxFieldBytes: slotBytes});
    expect([fits.field === cube, fits.full, fits.bounce, bound()]).toEqual([true, true, null, false]); // (and full shading without a bounce source: no bounce)
    fits.dispose(scene);
    const capped = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, shading: 'full', maxFieldBytes: slotBytes / 3.9});
    expect([capped.field.cellScale, capped.field.gi, capped.full]).toEqual([2, cube.gi, true]);
    capped.dispose(scene);

    // a station swap: the next lighting's bounce is bound when the old one is disposed AFTER it (the game's order), and disposing
    // the old one does not unbind the new one's
    const a = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, shading: 'full', bounce});
    const bounce2 = {...bounce};
    const b = new StationLighting(scene, l, fixturesOf(l), null, {baked: cube, shading: 'full', bounce: bounce2});
    a.dispose(scene);
    expect(bound()).toBe(true);
    expect((FLASH_BOUNCE as unknown as {src: unknown}).src).toBe(bounce2);
    expect(LF.cube.value.toArray()).toEqual([cube.gi, 1]);
    b.dispose(scene);
    expect(bound()).toBe(false);
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
