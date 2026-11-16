// Task studio-surface-run-field-followup-20261116-211729-01 (lane FACADE; user: "Fix Surface Run building-glass reflections through the
// existing PBR / reflection contracts, keeping transparency, correct faces / normals, settings Off / fallback behavior and cab glazing
// intact. Don't globally boost materials to disguise it"): the district's decorative panes stand REVEAL x 0.6 inside their facade, in the
// wall's own SOLID cell. On the 'glass' rule (render/reflectTag.ts) their field sample / probe slot came from the texel holding the wall
// (the district's field is drawn at 1 m texels): ~3/4 of the street's light, none on some panes, another storey's slot on a few. The
// panes now draw the district's OWN copy of the shared glazing tagged 'window' — the contract class for a pane set inside its wall (the
// field and the probes one cell out along the normal) — with nothing else changed: same colour / opacity / transparency / depth write /
// node hooks / face mode; the shared station glazing keeps 'glass'; a cab's glass keeps 'cab'; the plain field light (Reflections Off, no
// probes) builds the very same program as the shared glazing on both backends.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {GLSLNodeBuilder, WGSLNodeBuilder, WebGPURenderer, type NodeMaterial} from 'three/webgpu';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {shapeMaterial} from '../src/world/shapeMaterials';
import {SURFACE_PANE_KEYS, liveSurfaceMaterials, surfaceArchMaterial} from '../src/world/surface/archMaterials';
import {reflectTagOf} from '../src/render/reflectTag';
import {nodeHookKeys} from '../src/render/nodeHooks';
import {cabGlassMaterial} from '../src/world/elevator';
import {installLightFieldNode, stationFieldLight} from '../src/world/lightFieldNode';
import {installReflectNode, reflectLookup, stationReflectLight} from '../src/world/reflectionNode';
import {LEVELS} from '../src/levels/registry';
import {drainSync} from '../src/core/pacedBuild';
import {stationBakeInput} from '../src/world/lights';
import {bakeLightFieldSteps, downsampleField, fieldSlot, sampleField} from '../src/world/lightField';
import {CELL} from '../src/gen/grid';
import {LOOK_TUNE, surfaceLookPlan} from '../src/world/surface/archPlan';
import {SURFACE_FIELD_SCALE} from '../src/world/surface/lookDaylight';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const PANES = [[SURFACE_PANE_KEYS.glass, 'glass'], [SURFACE_PANE_KEYS.shop, 'glassShopfront']] as const;

describe('Surface Run glass: the decorative panes on the window rule (lane FACADE)', () => {
  it("the panes are the district's own owned copies of the shared glazing, tagged 'window'; the shared glazing stays 'glass', a cab's 'cab'", () => {
    const m = mats();
    for (const [key, shape] of PANES) {
      const P = surfaceArchMaterial(m, key) as THREE.MeshStandardMaterial, S = shapeMaterial(m, shape) as THREE.MeshStandardMaterial;
      expect(P).not.toBe(S);
      expect(reflectTagOf(P), key).toBe('window');
      expect(reflectTagOf(S), shape).toBe('glass');
      // nothing else differs: transparency, opacity, colour, roughness / metalness, depth, face mode, node hooks
      expect([P.transparent, P.opacity, P.color.getHex(), P.roughness, P.metalness, P.depthWrite, P.depthTest, P.side, P.blending])
        .toEqual([S.transparent, S.opacity, S.color.getHex(), S.roughness, S.metalness, S.depthWrite, S.depthTest, S.side, S.blending]);
      expect(P.transparent).toBe(true);
      expect(P.opacity).toBeLessThan(1);
      expect(nodeHookKeys(P as unknown as NodeMaterial)).toEqual(nodeHookKeys(S as unknown as NodeMaterial));
      // cached per WorldMaterials, owned (released with the district's resources), a fresh copy after release
      expect(surfaceArchMaterial(m, key)).toBe(P);
      expect(liveSurfaceMaterials.has(P)).toBe(true);
      P.dispose();
      expect(liveSurfaceMaterials.has(P)).toBe(false);
      const P2 = surfaceArchMaterial(m, key);
      expect(P2).not.toBe(P);
      expect(reflectTagOf(P2!)).toBe('window');
      // the shared glazing survives the district's release
      expect(reflectTagOf(shapeMaterial(m, shape))).toBe('glass');
    }
    expect(reflectTagOf(cabGlassMaterial())).toBe('cab');
  });

  it("a pane reads the street's light and slot one cell out (the window rule); the old glass rule read the wall's texel — about 3/4 of it, another storey's slot on some", () => {
    const L = LEVELS.subway.generate('surface', {levelSeed: 93});
    const input = stationBakeInput(L);
    const F = downsampleField(drainSync(bakeLightFieldSteps(input.source, input.params)), SURFACE_FIELD_SCALE);
    const plan = surfaceLookPlan(L)!;
    const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const rG: number[] = [], rW: number[] = [];
    let n = 0, otherG = 0, otherW = 0;
    for (const bl of plan.buildings) for (const h of bl.holes) {
      if (h.kind !== 'glass' && h.kind !== 'shop') continue;
      const sd = bl.sides.find(s => s.side === h.side)!;
      const N: [number, number, number] = sd.alongX ? [0, 0, sd.n] : [sd.n, 0, 0];
      const d = sd.plane - sd.n * LOOK_TUNE.reveal * 0.6, s = (h.s0 + h.s1) / 2, y = (h.y0 + h.y1) / 2;
      const P: [number, number, number] = sd.alongX ? [s, y, d] : [d, y, s];
      // the street 1.5 m out: its slot and its light
      const sx = P[0] + N[0] * 1.5, sz = P[2] + N[2] * 1.5, C = CELL * (F.cellScale ?? 1);
      const street = fieldSlot(F, Math.floor(sx / C), Math.floor(sz / C), y), f = sampleField(F, sx, y, sz), light = lum(f.amb) + lum(f.dirColor);
      const g = reflectLookup('glass', F, P[0], P[1], P[2], N), w = reflectLookup('window', F, P[0], P[1], P[2], N);
      n++;
      if (g.slot !== street.slot) otherG++;
      if (w.slot !== street.slot) otherW++;
      if (light > 0.05) { rG.push(g.local / light); rW.push(w.local / light); }
    }
    expect(n).toBeGreaterThan(1000);
    expect(otherW).toBe(0);
    expect(median(rW)).toBeGreaterThan(0.85);
    expect(median(rW)).toBeLessThan(1.15); // the street's light, not a boost
    expect(median(rG)).toBeLessThan(median(rW) - 0.1);
    expect(otherG).toBeGreaterThan(0);
  }, 120_000);

  it('compiles on both backends: under the plain field light (Reflections Off / no probes / the WebGL2 fallback) the very program of the shared glazing; under the reflecting light the window lookup, the same bindings', () => {
    const m = mats();
    for (const backend of ['wgsl', 'glsl'] as const) {
      for (const [key, shape] of PANES) {
        const P = surfaceArchMaterial(m, key)!, S = shapeMaterial(m, shape);
        const plainP = frag(backend, P, [stationFieldLight(), new THREE.HemisphereLight()]), plainS = frag(backend, S, [stationFieldLight(), new THREE.HemisphereLight()]);
        // (the same code: line for line, up to the order three emits its shared helper functions in — the build order of the run)
        expect(lines(plainP), `${backend} ${key}: plain light = the shared glazing's program`).toEqual(lines(plainS));
        const reflP = frag(backend, P, [stationReflectLight(), new THREE.HemisphereLight()]), reflS = frag(backend, S, [stationReflectLight(), new THREE.HemisphereLight()]);
        expect(reflP.length, `${backend} ${key}: the window lookup (a second field sample a cell out)`).toBeGreaterThan(reflS.length);
        expect(bindings(backend, reflP), `${backend} ${key}`).toEqual(bindings(backend, reflS));
      }
    }
  }, 120_000);
});

// --- headless shader builds (three's own node builders on an uninitialised renderer: no GPU) --------------------------------------
type Backend = 'glsl' | 'wgsl';
const renderers = new Map<Backend, WebGPURenderer>();
function headless(backend: Backend): WebGPURenderer {
  let r = renderers.get(backend);
  if (r) return r;
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
  (r as unknown as {hasFeature: () => boolean}).hasFeature = () => false;
  (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
  (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
  r.toneMapping = THREE.ACESFilmicToneMapping;
  expect(installLightFieldNode(r)).toBe(true);
  expect(installReflectNode(r)).toBe(true);
  renderers.set(backend, r);
  return r;
}
function frag(backend: Backend, material: THREE.Material, lights: THREE.Light[]): string {
  const r = headless(backend), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material), scene = new THREE.Scene();
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
    b.material = material;
    b.context.material = material;
    b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights(lights);
    b.build();
    expect(errors, `${backend}: a clean build`).toEqual([]);
    return b.fragmentShader;
  } finally {
    console.error = oe; console.warn = ow;
    scene.remove(mesh);
    for (const l of lights) scene.remove(l);
    mesh.geometry.dispose();
  }
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean).sort();
function bindings(backend: Backend, f: string): {textures: number; samplers: number; ubos: number} {
  if (backend === 'wgsl') return {textures: count(f, /var\s+\w+\s*:\s*texture_\w+(<\w+>)?\s*;/g), samplers: count(f, /var\s+\w+\s*:\s*sampler(_comparison)?\s*;/g), ubos: count(f, /var<uniform>/g)};
  return {textures: count(f, /uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler\w+\s+\w+;/g), samplers: 0, ubos: count(f, /layout\s*\(\s*std140\s*\)\s*uniform/g)};
}
