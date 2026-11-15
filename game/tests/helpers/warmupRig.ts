// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD): the rig of the warm-up yield / compile-split tests — three's real
// WebGPURenderer on the no-op device (helpers/fakeWebgpu.ts) with a small lit scene, a runWarmup host for it, and counters inside three.
import * as THREE from 'three';
import {vi} from 'vitest';
import {stubWebgpuGlobals} from './fakeWebgpu';
import {WarmupRegistry, type WarmupRenderer} from '../../src/render/warmup';

export const G = globalThis as unknown as {scheduler?: {yield?: unknown; postTask?: unknown}};
/** No `scheduler` global at all (a browser without scheduler.yield / postTask). */
export const noScheduler = (): void => { vi.stubGlobal('scheduler', undefined); delete G.scheduler; };

/** three's real renderer on the no-op device, a small lit scene, and an animation frame that ticks (counted: `n.raf`). */
export async function warmupRig() {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({canvas});
  await r.init();
  // (after init: three's own animation loop asked for its frame from the stub that never ticks)
  // (`afterCompile`: the counts when the first real frame starts — three builds its output pass there, not in a compile call)
  const n = {raf: 0, builds: 0, asyncPipelines: 0, afterCompile: null as {builds: number; asyncPipelines: number} | null};
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { n.raf++; setTimeout(() => cb(0), 0); return n.raf; });
  const R = r as unknown as {
    _nodes: {nodeFrame: {update(): void}; _createNodeBuilder: unknown; _createNodeBuilderState: unknown}; _pipelines: {getForRender: unknown};
    backend: {createNodeBuilder: (...a: unknown[]) => unknown; device: {createRenderPipelineAsync: (d: unknown) => Promise<unknown>}};
  };
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => { n.builds++; return cnb(...a); };
  const crpa = R.backend.device.createRenderPipelineAsync.bind(R.backend.device);
  R.backend.device.createRenderPipelineAsync = (d: unknown) => { n.asyncPipelines++; return crpa(d); };
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(0, 2, 8);
  cam.lookAt(0, 0, 0);
  scene.add(cam, new THREE.HemisphereLight(0xffffff, 0x222222, 0.6), new THREE.DirectionalLight(0xffffff, 1));
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({color: 0x446688 + i * 0x1100, roughness: 0.3 + i * 0.1, transparent: i === 4, opacity: i === 4 ? 0.5 : 1}));
    m.position.set(i - 2, 0, 0);
    scene.add(m);
  }
  const frame = () => { n.afterCompile ??= {builds: n.builds, asyncPipelines: n.asyncPipelines}; R._nodes.nodeFrame.update(); r.render(scene, cam); };
  const host = {
    renderer: r as unknown as WarmupRenderer, scene, camera: cam, mode: 'full' as const, registry: new WarmupRegistry(),
    sceneTarget: () => null, torch: null, torchIntensity: 0, frame, finish: frame, hide: () => {}, alive: () => true,
  };
  return {r, R, n, scene, cam, box, host};
}

/** Options for a quick run: no real frame waits between the hidden frames. */
export const quickRun = {yieldFrame: () => Promise.resolve(), compileChunk: 2};
