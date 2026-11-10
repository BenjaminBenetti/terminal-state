// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO; user: "add AO"): the ambient occlusion pass inside the atmosphere's
// RenderPipeline (render/volumetric.ts + render/ambientOcclusion.ts), driven through three r186's REAL WebGPURenderer (WebGPU backend,
// and its WebGL 2 backend) on the no-op device of tests/helpers/fakeWebgpu.ts — node builds and draws counted inside three, no GPU:
//  1. AO on: the two AO targets exist at the preset's size; per frame the pass draws raw -> blur x -> blur y exactly once, after the
//     scene pass and before the composite; resize / pixel ratio / quality resize the targets; a FOV (ADS) change builds nothing (the
//     projection is a per-frame uniform);
//  2. AO off: the pass draws nothing and no AO program is ever built (targets 1 x 1); toggling AO rebuilds nothing that existed — off ->
//     on builds the three AO programs only, on -> off -> on builds nothing;
//  3. after the warm-up's frames (AO on at load), a normal frame builds no program, AO included;
//  4. failure isolation: a rejected AO program (WebGPU validation error scope) or a thrown one turns AO off only — the fog pass, its
//     failure flag and the frame continue; a WebGL 2 shader error of an AO program flags AO, one of a fog program flags the fog.
import {afterAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {generateStation, type StationLayout} from '../src/gen/station';
import {AO_MARK} from '../src/render/ambientOcclusion';
import {AO_QUALITY, aoSize} from '../src/render/ambientOcclusionMath';
import {VF_MARK} from '../src/render/volumetricShaders';
import type {VolumetricAtmosphere as VA} from '../src/render/volumetric';

afterAll(() => vi.unstubAllGlobals());

let layout: StationLayout | null = null;
const station = () => (layout ??= generateStation(5));

type Backend = 'webgpu' | 'webgl2';

/** A real renderer on the no-op device + the atmosphere + a small lit scene; draws and node builds recorded per frame. */
async function rig(backend: Backend, o: {ao: boolean; quality?: 'low' | 'high'}) {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // (three: "WebGPU is not available, running under WebGL2 backend")
  const W = await import('three/webgpu');
  const {VolumetricAtmosphere} = await import('../src/render/volumetric');
  const r = new W.WebGPURenderer({canvas, forceWebGL: backend === 'webgl2'});
  await r.init();
  if (backend === 'webgl2') { // the inert GL lists no extensions: report the float colour targets the atmosphere needs (as real WebGL 2 drivers do)
    const ext = (r.backend as unknown as {extensions: {has(n: string): boolean}}).extensions, has = ext.has.bind(ext);
    ext.has = (nm: string) => nm === 'EXT_color_buffer_float' || has(nm);
  }
  r.shadowMap.enabled = true;
  const R = r as unknown as {backend: {createNodeBuilder: (...a: unknown[]) => {material?: THREE.Material}}; _nodes: {nodeFrame: {update(): void}}};
  const built: {material?: THREE.Material}[] = [];
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => { const b = cnb(...a); built.push(b); return b; };
  // every draw call of three's renderer, recorded on EXIT (nested passes before the pipeline quad that runs them)
  const draws: string[] = [];
  const render = r.render.bind(r);
  r.render = ((obj: THREE.Object3D, cam: THREE.Camera) => {
    const target = r.getRenderTarget() as {texture?: THREE.Texture} | null;
    const res = render(obj, cam);
    const mat = (obj as unknown as {material?: THREE.Material}).material;
    draws.push((obj as THREE.Scene).isScene ? 'scene' : `${mat?.name || 'quad'}${target ? '' : ' -> canvas'}`);
    return res;
  }) as typeof r.render;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x101418, 0.02);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  const flashlight = new THREE.SpotLight(0xfff4e2, 2, 30, 0.58, 0.7, 1.2);
  camera.add(flashlight, flashlight.target);
  flashlight.target.position.set(0, 0, -6);
  scene.add(camera, new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.6));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({color: 0x555555}));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({color: 0x887766})); b.position.set(i * 1.5 - 2, 0.5, -4); scene.add(b); }
  camera.position.set(0, 1.62, 0);
  camera.rotation.set(-0.2, 0, 0);
  const a: VA = new VolumetricAtmosphere(r as never, {flashlight}, o.quality ?? 'high');
  a.override = null;
  a.occlusion.override = null;
  a.setAmbientOcclusion(o.ao);
  const db = r.getDrawingBufferSize(new THREE.Vector2());
  a.setSize(db.x, db.y);
  a.setStation(station(), null);
  a.markShadows(scene, true);
  let t = 0;
  const frame = () => {
    draws.length = 0;
    R._nodes.nodeFrame.update();
    r.info.reset();
    camera.updateMatrixWorld(true);
    a.render(scene, camera, (t += 1 / 60));
    return [...draws];
  };
  const names = () => built.map(b => b.material?.name ?? '?');
  return {r, a, scene, camera, frame, built, names};
}

const AO_MATS = ['ambient-occlusion-raw', 'ambient-occlusion-blur-x', 'ambient-occlusion-blur-y'];
const aoBuilds = (names: string[]) => names.filter(nme => AO_MATS.includes(nme));

describe('the AO pass in the real renderer (no-op GPU device)', () => {
  for (const backend of ['webgpu', 'webgl2'] as const) {
    it(`${backend}: AO on — targets at the preset size, raw -> blur x -> blur y once per frame after the scene pass and before the composite`, async () => {
      const k = await rig(backend, {ao: true});
      for (let f = 0; f < 3; f++) k.frame();
      const d = k.frame();
      const at = (nme: string) => d.indexOf(nme);
      for (const m of AO_MATS) expect(d.filter(x => x === m), `${m} per frame`).toHaveLength(1);
      expect(at('scene')).toBeGreaterThanOrEqual(0);
      expect(at('scene')).toBeLessThan(at('ambient-occlusion-raw'));
      expect(at('ambient-occlusion-raw')).toBeLessThan(at('ambient-occlusion-blur-x'));
      expect(at('ambient-occlusion-blur-x')).toBeLessThan(at('ambient-occlusion-blur-y'));
      const composite = d.findIndex(x => x.endsWith('-> canvas'));
      expect(composite, 'the pipeline output (composite) to the canvas').toBe(d.length - 1);
      expect(at('ambient-occlusion-blur-y')).toBeLessThan(composite);
      expect(d.filter(x => x === 'volumetric-march')).toHaveLength(1); // the fog pass still runs, once
      const dbg = k.a.debug();
      expect(dbg.active).toBe(true);
      expect(dbg.failed).toBe(null);
      expect(dbg.ao).toMatchObject({active: true, reason: null, failed: null, setting: true});
      expect(dbg.ao.size).toEqual(aoSize(1280, 720, AO_QUALITY.high));
      const internals = k.a.occlusion as unknown as {rtA: {width: number; height: number}; rtB: {width: number; height: number}};
      expect([internals.rtA.width, internals.rtA.height]).toEqual(dbg.ao.size);
      expect([internals.rtB.width, internals.rtB.height]).toEqual(dbg.ao.size);
      expect(k.a.occlusion.u.aoOn.value).toBe(1);
      expect(dbg.ao.passes.ao).toBe(4);
      expect(aoBuilds(k.names()).sort()).toEqual([...AO_MATS].sort()); // each AO program built once
      // resize: the drawing buffer follows the renderer (pixel ratio, size)
      k.r.setPixelRatio(1.5);
      k.frame();
      expect(k.a.debug().ao.size).toEqual(aoSize(1920, 1080, AO_QUALITY.high));
      k.r.setPixelRatio(1);
      k.r.setSize(800, 450, false);
      k.frame();
      expect(k.a.debug().ao.size).toEqual(aoSize(800, 450, AO_QUALITY.high));
      // FOV / ADS: nothing to build, the projection is a uniform
      const n0 = k.built.length;
      k.camera.fov = 45;
      k.camera.updateProjectionMatrix();
      k.frame();
      expect(k.built.length - n0, 'node builds on a FOV change').toBe(0);
      expect(k.a.occlusion.u.aoShape.value.w).toBeCloseTo(k.camera.projectionMatrix.elements[5], 6);
      // quality low: the low preset's size
      k.a.setQuality('low');
      k.frame();
      expect(k.a.debug().ao.size).toEqual(aoSize(800, 450, AO_QUALITY.low));
      expect(k.a.debug().ao.preset).toEqual(AO_QUALITY.low);
      k.a.dispose();
    }, 180_000);

    it(`${backend}: AO off — no AO draw, no AO program, 1 x 1 targets; off -> on builds the AO programs only; on -> off -> on builds nothing`, async () => {
      const k = await rig(backend, {ao: false});
      for (let f = 0; f < 3; f++) { const d = k.frame(); for (const m of AO_MATS) expect(d).not.toContain(m); }
      expect(aoBuilds(k.names())).toEqual([]);
      expect(k.a.debug().ao).toMatchObject({active: false, setting: false, size: [1, 1], reason: 'off in the settings'});
      expect(k.a.occlusion.u.aoOn.value).toBe(0);
      expect(k.a.debug().active, 'the fog pass runs').toBe(true);
      // switch on: only the AO pass's own three programs are new
      const n0 = k.built.length;
      k.a.setAmbientOcclusion(true);
      const d1 = k.frame();
      for (const m of AO_MATS) expect(d1).toContain(m);
      expect(k.names().slice(n0).sort(), 'programs built when AO is switched on').toEqual([...AO_MATS].sort());
      expect(k.a.debug().ao.size).toEqual(aoSize(1280, 720, AO_QUALITY.high));
      k.frame();
      // off and on again: nothing is rebuilt
      const n1 = k.built.length;
      k.a.setAmbientOcclusion(false);
      const d2 = k.frame();
      for (const m of AO_MATS) expect(d2).not.toContain(m);
      expect(k.a.debug().ao.size).toEqual([1, 1]);
      k.a.setAmbientOcclusion(true);
      k.frame();
      k.frame();
      expect(k.built.length - n1, 'node builds after toggling AO off and on').toBe(0);
      k.a.dispose();
    }, 180_000);

    it(`${backend}: after the warm-up frames (AO on at load) a normal frame builds no program, AO included`, async () => {
      const k = await rig(backend, {ao: true});
      expect(k.a.warmTarget(k.scene, k.camera)).not.toBe(null); // the pipeline (and the AO pass node) exists before the first frame
      for (let f = 0; f < 3; f++) k.frame(); // the warm-up's hidden frames
      expect(aoBuilds(k.names()).sort()).toEqual([...AO_MATS].sort());
      const n0 = k.built.length;
      for (let f = 0; f < 4; f++) { k.camera.rotation.y = f * 0.4; k.frame(); }
      expect(k.built.length - n0, 'node builds on normal frames after the warm-up').toBe(0);
      k.a.dispose();
    }, 180_000);
  }

  it('webgpu: a REJECTED AO program (validation error scope) turns AO off only; the fog pass and the frame continue', async () => {
    const k = await rig('webgpu', {ao: true});
    const device = (k.r.backend as unknown as {device: {pushErrorScope(f: string): void; popErrorScope(): Promise<unknown>}}).device;
    // the AO pass's own scope is the OUTERMOST one opened while it runs (three nests its pipeline scopes inside it): that one rejects
    const occ = k.a.occlusion as unknown as {run: (...x: unknown[]) => void};
    const run = occ.run.bind(k.a.occlusion);
    let inAo = false;
    const stack: boolean[] = [];
    const push = device.pushErrorScope.bind(device), pop = device.popErrorScope.bind(device);
    device.pushErrorScope = (f: string) => { stack.push(inAo && !stack.some(Boolean)); push(f); };
    device.popErrorScope = () => (stack.pop() ? Promise.resolve({message: 'Shader module compilation failed (test)'}) : pop());
    occ.run = (...x: unknown[]) => { inAo = true; try { run(...x); } finally { inAo = false; } };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    k.frame();
    await Promise.resolve(); await Promise.resolve();
    expect(k.a.occlusion.failed).toMatch(/ambient occlusion pass rejected by WebGPU: Shader module compilation failed/);
    expect(k.a.failed, 'the fog pass is not failed').toBe(null);
    expect(errors).toHaveBeenCalledTimes(1);
    const d = k.frame();
    for (const m of AO_MATS) expect(d).not.toContain(m);
    expect(d).toContain('volumetric-march');
    expect(d[d.length - 1]).toMatch(/-> canvas$/);
    expect(k.a.debug()).toMatchObject({active: true, failed: null, ao: {active: false, reason: 'failed'}});
    expect(k.a.occlusion.u.aoOn.value).toBe(0);
    expect(k.a.aoUnavailable()).toBe('failed on this device');
    k.frame();
    expect(errors, 'the console error is logged once').toHaveBeenCalledTimes(1);
    errors.mockRestore();
    k.a.dispose();
  }, 180_000);

  it('webgl2: a THROWN AO program turns AO off only (the frame still draws the composite)', async () => {
    const k = await rig('webgl2', {ao: true});
    k.frame();
    (k.a.occlusion as unknown as {quad: {render(): void}}).quad.render = () => { throw new Error('node build failed (test)'); };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = k.frame();
    expect(k.a.occlusion.failed).toMatch(/node build failed \(test\)/);
    expect(k.a.failed).toBe(null);
    expect(d[d.length - 1]).toMatch(/-> canvas$/);
    const d2 = k.frame();
    expect(d2).toContain('volumetric-march');
    expect(d2[d2.length - 1]).toMatch(/-> canvas$/);
    expect(k.a.debug().ao).toMatchObject({active: false, reason: 'failed'});
    errors.mockRestore();
    k.a.dispose();
  }, 180_000);

  it('webgl2 shader-error hook: an AO-marked program flags AO only; a fog-marked one flags the fog', async () => {
    const k = await rig('webgl2', {ao: true});
    k.frame(); // attach(): the hook is chained in front of three's
    const hook = (k.r.debug as unknown as {onShaderError: (...a: unknown[]) => void}).onShaderError;
    const gl = {getShaderSource: (s: string) => s, getShaderInfoLog: () => ''};
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    hook(gl, {}, 'void main(){}', `vec4 ${AO_MARK.blur} = vec4(1.0);`);
    expect(k.a.occlusion.failed).toMatch(/ambient occlusion program failed/);
    expect(k.a.occlusion.u.aoOn.value, 'the composite of this very frame already skips AO').toBe(0);
    expect(k.a.failed).toBe(null);
    hook(gl, {}, 'void main(){}', `vec3 ${VF_MARK.composite} = vec3(0.0);`);
    expect(k.a.failed).toMatch(/volumetric fog program failed/);
    errors.mockRestore();
    k.a.dispose();
  }, 180_000);
});
