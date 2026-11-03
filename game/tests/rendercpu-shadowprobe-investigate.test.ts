// Lane RENDER-CPU probe (env-gated LL_RCPU_PROBE=1): does the no-op-device WebGPURenderer run the spot-light shadow pass?
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';

afterAll(() => vi.unstubAllGlobals());
describe.skipIf(!process.env.LL_RCPU_PROBE)('probe', () => {
  it('shadow pass', async () => {
    const canvas = stubWebgpuGlobals();
    const {WebGPURenderer} = await import('three/webgpu');
    const r = new WebGPURenderer({canvas});
    await r.init();
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
    scene.add(cam);
    const fl = new THREE.SpotLight(0xffffff, 1, 30, 0.58, 0.7, 1.2);
    fl.castShadow = true;
    fl.target.position.set(0, 0, -6);
    cam.add(fl, fl.target);
    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    a.position.set(0, 0, -3); a.castShadow = a.receiveShadow = true;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial());
    b.position.set(0, 0, -5); b.castShadow = b.receiveShadow = true;
    scene.add(a, b);
    const calls: number[] = [];
    const orig = r.render.bind(r);
    let depth = 0;
    (r as unknown as {render: (s: THREE.Object3D, c: THREE.Camera) => void}).render = (s, c) => { calls.push(depth); depth++; try { orig(s, c); } finally { depth--; } };
    const R = r as unknown as {_objects: {createRenderObject: (...x: unknown[]) => unknown}};
    let ros = 0;
    const cro = R._objects.createRenderObject.bind(R._objects);
    R._objects.createRenderObject = (...x: unknown[]) => { ros++; return cro(...x); };
    for (let i = 0; i < 3; i++) r.render(scene, cam);
    console.log('render calls', calls.join(','), 'ROs', ros, 'info', JSON.stringify(r.info.render));
    (await import('node:fs')).writeFileSync('/tmp/rcpu-probe.txt', `render calls ${calls.join(',')} ROs ${ros} info ${JSON.stringify(r.info.render)}\n`);
    expect(ros).toBeGreaterThan(0);
  });
});
