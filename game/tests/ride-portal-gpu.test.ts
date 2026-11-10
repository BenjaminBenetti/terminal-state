// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): engaging / releasing a ride portal costs the renderer NOTHING
// but the instance matrices it rewrites. A real level (built like Game.buildSection) drawn by three r186's REAL WebGPURenderer on a
// no-op GPU device (tests/helpers/fakeWebgpu.ts): after the first frames, engage the departure portal (the cut: draw ranges on the
// partitioned meshes, collapsed instances), swing its gate, release it, engage the arrival portal — and count what three does: no
// WGSL node build, no shader module, no render pipeline, no bind group, no buffer created; only buffer writes (instance matrices,
// the frame's uniforms). Node figures of three's JavaScript, not GPU / driver work.
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {appendFileSync} from 'node:fs';
import {gpuCalls, resetGpuCalls, stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {RidePortalRuntime, type RidePortalHost} from '../src/world/ridePortalRuntime';
import {setRideMask} from '../src/world/rideMask';
import {portalWorld} from './helpers/ridePortalWorld';

const LOG = '/tmp/lanes/portal/gpu.log';
const log = (s: string) => { try { appendFileSync(LOG, s + '\n'); } catch { /* best effort */ } };
afterAll(() => { setRideMask(null); vi.unstubAllGlobals(); });

const CREATE = ['createRenderPipeline', 'createRenderPipelineAsync', 'createShaderModule', 'createBindGroup', 'createBuffer', 'createTexture', 'createBindGroupLayout', 'createPipelineLayout'];

describe('ride portal runtime on three r186 WebGPURenderer (no-op device): engage / release build nothing', () => {
  for (const [id, seed] of [['market', 4242], ['mall', 4242]] as const) {
    it(`${id} ${seed}: after the first frames, engage / gate swing / release / the other portal create no node build, shader, pipeline, bind group or buffer`, async () => {
      const canvas = stubWebgpuGlobals();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const W = await import('three/webgpu');
      const renderer = new W.WebGPURenderer({canvas});
      await renderer.init();
      const w = await portalWorld(id, seed);
      const q = w.portals!;
      const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 220);
      // in the car's path on the station side, looking along the track at the departure portal (its gate, the cut beyond it)
      cam.position.set(q.front.x - q.front.out * 12, q.front.bedY + 1.62 + 1.1, q.front.z);
      const view = (k: 'portal' | 'station') => { cam.lookAt(q.front.x + q.front.out * (k === 'portal' ? 30 : -60), q.front.bedY + 1.5, q.front.z); cam.updateMatrixWorld(); };
      view('portal');
      w.scene.add(cam, new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.6));
      const host = {scene: w.scene, layout: w.layout, trainPlacement: w.placement, world: w.world, containers: w.cm, stock: w.stock, mats: w.mats, camera: cam,
        propModels: {ownsGeometry: (g: THREE.BufferGeometry) => w.modelGeometries.has(g)}, sectionHooks: [] as NonNullable<RidePortalHost['sectionHooks']>, zombies: [], pickups: {list: []}} as RidePortalHost;
      const rt = new RidePortalRuntime(host).install();
      for (const k of host.sectionHooks!) k.build?.(w.layout as never);
      const builds = vi.spyOn(W.WGSLNodeBuilder.prototype as unknown as {build(): void}, 'build');
      const frame = () => { w.scene.updateMatrixWorld(); renderer.render(w.scene, cam); };
      // the warm-up stand-in: a breach headwall (hidden until a ride uses it) is drawn once like the loading warm-up draws its pool
      const breach = w.scene.children.filter(o => o.userData.ridePortal);
      // (both views the test uses are drawn first: what a NEW view builds is not the portal's doing)
      for (const b of breach) b.visible = true;
      for (const k of ['portal', 'station', 'portal'] as const) { view(k); frame(); frame(); }
      for (const b of breach) b.visible = false;
      for (const k of ['station', 'portal'] as const) { view(k); frame(); frame(); }
      const first = builds.mock.calls.length;
      resetGpuCalls();
      builds.mockClear();
      frame();
      const steady = {builds: builds.mock.calls.length, calls: CREATE.map(k => gpuCalls.get(k) ?? 0), writes: gpuCalls.get('writeBuffer') ?? 0, draws: (gpuCalls.get('draw') ?? 0) + (gpuCalls.get('drawIndexed') ?? 0)};
      const steps: [string, () => void][] = [
        ['engage front', () => rt.engage('front', {gateOpen: false})],
        ['gate opening', () => { rt.setGate('front', true); rt.step(0.65, cam.position); }],
        ['gate open', () => rt.step(0.7, cam.position)],
        // (a gate shuts, then lets go; a breach lets go once its plane is out of view: the camera turns round)
        ['release front', () => { rt.release('front'); rt.step(1.4, cam.position); if (rt.engaged('front')) { view('station'); rt.step(0.1, cam.position); } }],
        ['view back to the portal', () => view('portal')],
        ['engage rear (open)', () => rt.engage('rear', {gateOpen: true})],
        ['release rear now', () => rt.release('rear', {now: true})],
      ];
      for (const [name, act] of steps) {
        resetGpuCalls();
        builds.mockClear();
        act();
        frame(); frame();
        const c = CREATE.map(k => gpuCalls.get(k) ?? 0), draws = (gpuCalls.get('draw') ?? 0) + (gpuCalls.get('drawIndexed') ?? 0);
        log(`${id} ${seed} ${name}: node builds ${builds.mock.calls.length}, ${CREATE.map((k, i) => `${k} ${c[i]}`).join(', ')}, writeBuffer ${gpuCalls.get('writeBuffer') ?? 0} (steady frame ${steady.writes}), draws/2 frames ${draws} (steady ${steady.draws}); engaged ${rt.engaged('front')}/${rt.engaged('rear')} state ${JSON.stringify(rt.state('front').hidden)} ${JSON.stringify(rt.state('rear').hidden)}`);
        expect(builds.mock.calls.length, `${id} ${name}: node builds`).toBe(0);
        expect(c, `${id} ${name}: ${CREATE.join(', ')}`).toEqual(CREATE.map(() => 0));
      }
      expect(rt.engaged('front') || rt.engaged('rear')).toBe(false);
      log(`${id} ${seed}: first frames ${first} node builds; steady frame ${JSON.stringify(steady)}`);
      expect(steady.builds).toBe(0);
      builds.mockRestore();
      renderer.dispose();
    }, 300_000);
  }
});
