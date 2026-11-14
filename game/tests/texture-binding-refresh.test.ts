// Task studio-death-retry-render-fix-20261114-044607-01 (render/bindingRefresh.ts): a shared texture node swapped under an object that
// does not change. three r186's REAL WebGPURenderer runs on the VALIDATING no-op device (helpers/validatingWebgpu.ts: a command buffer that
// references a destroyed texture is rejected whole, as WebGPU does) with the game's real light-field lighting node; one persistent mesh
// with a plain lit material (the parked car's fuel cap / plugs on a same-station reload) is drawn under station field A, the stations
// change (bindLightField null -> B; the mesh, its transform and material untouched), A is released, and the mesh is drawn on:
//  - three alone: the mesh keeps the bind group naming A — every frame's submit is dropped once A is destroyed (the user's obscured view);
//  - with installBindingRefresh: one full refresh at the next draw rebinds B; nothing is dropped, the binding is B's texture;
//  - the same on the WebGL 2 backend at the binding level (the renderer's refresh path is backend-independent);
//  - the other shared texture nodes the game swaps (decay map, flare visibility) start a refresh epoch too.
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubValidatingWebgpu} from './helpers/validatingWebgpu';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {levelFixture, FIX} from './helpers/levelRenderFixture';
import {bakeLightField, LightFieldVolume} from '../src/world/lightField';
import {LF, bindLightField, installLightFieldNode, stationFieldLight} from '../src/world/lightFieldNode';
import {bindingRefreshStats, installBindingRefresh, refreshTextureBindings} from '../src/render/bindingRefresh';
import {bindFlareVisibility} from '../src/world/flareLight';
import {setDecayField} from '../src/world/decay';

afterAll(() => { bindLightField(null); vi.unstubAllGlobals(); });

interface Binding { isSampledTexture?: boolean; texture?: THREE.Texture | null; textureNode?: {value?: unknown} }
interface RenderObject { object: THREE.Object3D; getBindings(): {name: string; bindings: Binding[]}[] }

const field = (() => { const {layout, levels} = levelFixture(); return bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: FIX.bedY, levels}); })();

async function run(backend: 'webgpu' | 'webgl2', fix: boolean) {
  const v = backend === 'webgpu' ? stubValidatingWebgpu() : {canvas: stubWebgpuGlobals(), log: null};
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // (three: "WebGPU is not available, running under WebGL2 backend")
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({canvas: v.canvas, forceWebGL: backend === 'webgl2'});
  await r.init();
  expect(installLightFieldNode(r)).toBe(true);
  if (fix) expect(installBindingRefresh(r)).toBe(true);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  cam.position.set(4, 1.6, 4);
  cam.lookAt(4, 1, 0);
  scene.add(cam, stationFieldLight());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({color: 0x8899aa, name: 'persistent-part'}));
  mesh.position.set(4, 1, 0);
  scene.add(mesh);
  let ro: RenderObject | null = null;
  const backendR = r.backend as unknown as {draw(o: RenderObject, info: unknown): void};
  const draw = backendR.draw.bind(backendR);
  backendR.draw = (o: RenderObject, info: unknown) => { if (o.object === mesh) ro = o; draw(o, info); };
  const nodeFrame = (r as unknown as {_nodes: {nodeFrame: {update(): void}}})._nodes.nodeFrame;
  const frame = () => { nodeFrame.update(); r.render(scene, cam); };
  // (the light field's sampled-texture binding: its node follows LF.tex; `texture` is what the bind group was built with)
  const fieldBinding = () => ro!.getBindings().flatMap(g => g.bindings).find(b => b.isSampledTexture && b.textureNode?.value === LF.tex.value) ?? null;

  const a = new LightFieldVolume(field), b = new LightFieldVolume(field);
  bindLightField(a); // station 1
  for (let i = 0; i < 3; i++) frame();
  expect(ro, 'the persistent mesh is drawn').not.toBeNull();
  expect(fieldBinding()?.texture).toBe(a.texture);
  bindLightField(null); // leave station 1 (StationLighting.dispose; its release is retired until after the next warm-up)
  bindLightField(b); // build station 2 with the mesh untouched
  for (let i = 0; i < 2; i++) frame(); // (the warm-up's frames)
  a.dispose(); // the retired release: station 1's field
  v.log?.reset();
  const FRAMES = 4;
  for (let i = 0; i < FRAMES; i++) frame();
  const fb = fieldBinding();
  const out = {log: v.log, found: !!fb, bound: fb?.texture ?? null, a, b, frames: FRAMES}; // (read before B is released below: a release nulls it)
  bindLightField(null);
  b.dispose();
  return out;
}

describe('a swapped shared texture node reaches objects that did not change (render/bindingRefresh.ts)', () => {
  it('WebGPU, three alone: the unchanged mesh keeps the released field and every submit that draws it is dropped', async () => {
    const r = await run('webgpu', false);
    expect(r.log!.submits).toBeGreaterThan(r.frames);
    expect(r.log!.dropped).toBe(r.frames); // (the pass that draws the mesh, every frame)
    expect(r.log!.issues.some(i => i.kind === 'destroyed-in-submit' && i.label === 'light-field')).toBe(true);
    expect(r.found).toBe(true);
    expect(r.bound).not.toBe(r.b.texture);
  }, 60_000);

  it('WebGPU, with installBindingRefresh: one full refresh rebinds the new field; nothing is dropped', async () => {
    const forced = bindingRefreshStats.forced;
    const r = await run('webgpu', true);
    expect(r.log!.submits).toBeGreaterThan(0);
    expect(r.log!.issues).toEqual([]);
    expect(r.log!.dropped).toBe(0);
    expect(r.found).toBe(true);
    expect(r.bound).toBe(r.b.texture);
    expect(bindingRefreshStats.forced).toBeGreaterThan(forced);
  }, 60_000);

  it('WebGL 2 backend: the same binding follows the swap with the fix and stays stale without it', async () => {
    const stale = await run('webgl2', false);
    expect(stale.found).toBe(true);
    expect(stale.bound).not.toBe(stale.b.texture);
    const fixed = await run('webgl2', true);
    expect(fixed.found).toBe(true);
    expect(fixed.bound).toBe(fixed.b.texture);
  }, 60_000);

  it('every shared texture node swap starts a refresh epoch; re-binding the same texture does not', () => {
    const n0 = bindingRefreshStats.bumps;
    const tex = new THREE.DataArrayTexture(new Uint8Array([255]), 1, 1, 1);
    bindFlareVisibility(tex);
    expect(bindingRefreshStats.bumps).toBe(n0 + 1);
    bindFlareVisibility(tex);
    expect(bindingRefreshStats.bumps).toBe(n0 + 1);
    bindFlareVisibility(null);
    expect(bindingRefreshStats.bumps).toBe(n0 + 2);
    setDecayField({w: 2, h: 2, levels: 1, data: new Uint8Array(16), stats: {ms: 0, sources: [], leaks: []}});
    expect(bindingRefreshStats.bumps).toBe(n0 + 3);
    const v = new LightFieldVolume(field);
    bindLightField(v);
    bindLightField(v);
    expect(bindingRefreshStats.bumps).toBe(n0 + 4);
    bindLightField(null);
    expect(bindingRefreshStats.bumps).toBe(n0 + 5);
    refreshTextureBindings();
    expect(bindingRefreshStats.bumps).toBe(n0 + 6);
    v.dispose();
  });
});
