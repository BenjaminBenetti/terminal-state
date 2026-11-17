// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, resource teardown; render/bindingRefresh.ts syncNewBindings):
// a NEW render object of a material first built at an earlier station must not bring that station's released texture back.
// three r186's REAL WebGPURenderer on the VALIDATING no-op device with the game's real light-field lighting node: a material is built and
// drawn under station field A (its node build's binding template captures A), the stations change (A unbound -> B bound, A released as
// the retire queue releases it), and a SECOND mesh of the same material is drawn for the first time (an object first drawn at the later
// station — the lift car of the ride's destination, a district arch first drawn in the transit gap):
//  - three alone: the new object's first bind group uploads A AGAIN (a released texture is re-created on the GPU and stays alive), then
//    binds B;
//  - with installBindingRefresh: A stays released; the new object binds B; nothing is dropped.
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubValidatingWebgpu} from './helpers/validatingWebgpu';
import {levelFixture, FIX} from './helpers/levelRenderFixture';
import {bakeLightField, LightFieldVolume} from '../src/world/lightField';
import {LF, bindLightField, installLightFieldNode, stationFieldLight} from '../src/world/lightFieldNode';
import {bindingRefreshStats, installBindingRefresh} from '../src/render/bindingRefresh';

afterAll(() => { bindLightField(null); vi.unstubAllGlobals(); });

interface Binding { isSampledTexture?: boolean; texture?: THREE.Texture | null; textureNode?: {value?: unknown} }
interface RenderObject { object: THREE.Object3D; getBindings(): {name: string; bindings: Binding[]}[] }

const field = (() => { const {layout, levels} = levelFixture(); return bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: FIX.bedY, levels}); })();

async function run(fix: boolean) {
  const v = stubValidatingWebgpu();
  const created: string[] = [];
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({canvas: v.canvas});
  await r.init();
  const dev = (r.backend as unknown as {device: {createTexture(d: {label?: string}): unknown}}).device;
  const ct = dev.createTexture.bind(dev);
  dev.createTexture = (d: {label?: string}) => { created.push(d?.label ?? ''); return ct(d); };
  expect(installLightFieldNode(r)).toBe(true);
  if (fix) expect(installBindingRefresh(r)).toBe(true);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  cam.position.set(4, 1.6, 4);
  cam.lookAt(4, 1, 0);
  scene.add(cam, stationFieldLight());
  const mat = new THREE.MeshStandardMaterial({color: 0x8899aa, name: 'kept-material'});
  const first = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  first.position.set(4, 1, 0);
  scene.add(first);
  const ros = new Map<THREE.Object3D, RenderObject>();
  const backendR = r.backend as unknown as {draw(o: RenderObject, info: unknown): void};
  const draw = backendR.draw.bind(backendR);
  backendR.draw = (o: RenderObject, info: unknown) => { ros.set(o.object, o); draw(o, info); };
  const nodeFrame = (r as unknown as {_nodes: {nodeFrame: {update(): void}}})._nodes.nodeFrame;
  const frame = () => { nodeFrame.update(); r.render(scene, cam); };
  const fieldBinding = (o: THREE.Object3D) => ros.get(o)?.getBindings().flatMap(g => g.bindings).find(b => b.isSampledTexture && b.textureNode?.value === LF.tex.value) ?? null;
  const textures = (r as unknown as {_textures: {has(t: THREE.Texture): boolean}})._textures;

  const a = new LightFieldVolume(field), b = new LightFieldVolume(field);
  a.texture.name = 'field-a';
  b.texture.name = 'field-b';
  bindLightField(a); // station 1: the material's node build (its binding template captures A)
  for (let i = 0; i < 3; i++) frame();
  expect(fieldBinding(first)?.texture).toBe(a.texture);
  bindLightField(null); // leave station 1
  bindLightField(b); // station 2
  for (let i = 0; i < 2; i++) frame();
  a.dispose(); // the retired release of station 1's field
  expect(textures.has(a.texture), 'A released').toBe(false);
  for (let i = 0; i < 2; i++) frame();
  v.log.reset();
  created.length = 0;
  // an object of the same material drawn for the first time at station 2
  const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  second.position.set(3, 1, 0);
  scene.add(second);
  for (let i = 0; i < 3; i++) frame();
  const out = {log: v.log, created: created.slice(), aAlive: textures.has(a.texture), bound: fieldBinding(second)?.texture ?? null, a, b};
  bindLightField(null);
  b.dispose();
  return out;
}

describe('a new render object never re-creates a released station texture (render/bindingRefresh.ts syncNewBindings)', () => {
  it('three alone: the first bind group of a new object of an earlier-built material re-uploads the released field', async () => {
    const r = await run(false);
    expect(r.aAlive, 'the released field is back on the GPU').toBe(true);
    expect(r.created).toContain('field-a');
    expect(r.bound).toBe(r.b.texture);
  }, 60_000);

  it('with installBindingRefresh: the released field stays released; the new object binds the current one; nothing dropped', async () => {
    const synced = bindingRefreshStats.synced;
    const r = await run(true);
    expect(r.aAlive).toBe(false);
    expect(r.created).not.toContain('field-a');
    expect(r.bound).toBe(r.b.texture);
    expect(r.log.issues).toEqual([]);
    expect(r.log.dropped).toBe(0);
    expect(bindingRefreshStats.synced).toBeGreaterThan(synced);
  }, 60_000);
});
