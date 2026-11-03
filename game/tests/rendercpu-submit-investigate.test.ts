// Lane RENDER-CPU investigation harness (env-gated: LL_RCPU_SUBMIT_OUT=/tmp/x.txt): three r186's real WebGPURenderer (no-op device)
// drawing the real mall through the real warm-up (render/warmup.ts runWarmup, 'full') and then yaw sweeps.
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {gpuCalls, resetGpuCalls, stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {eyeCam, realMallScene, startPose, type Pose} from './helpers/rendercpuMall';
import {WarmupRegistry, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {mallQaPose} from '../src/gen/mall/qa';

const OUT = process.env.LL_RCPU_SUBMIT_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
const SEED = process.env.LL_RCPU_SEED ?? 't3a';
afterAll(() => vi.unstubAllGlobals());

describe.skipIf(!OUT)('RENDER-CPU: real three WebGPU JS per frame on mall yaw sweeps (no-op device)', () => {
  it('warm-up full, then two sweeps per pose: frame CPU, node builds, render objects, cache-key recomputes', async () => {
    writeFileSync(OUT!, '');
    const canvas = stubWebgpuGlobals();
    const {WebGPURenderer} = await import('three/webgpu');
    const renderer = new WebGPURenderer({canvas, antialias: true});
    await renderer.init();
    if (process.env.LL_RCPU_SHADOW_FIX) (await import('../src/render/shadowOverride')).installShadowAlphaTwin(renderer);
    out(`backend ${(renderer.backend as unknown as {isWebGPUBackend?: boolean}).isWebGPUBackend ? 'WebGPU' : 'other'}`);
    const M = await realMallScene(SEED);
    const scene = M.scene, c = M.world.culler;
    scene.add(new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.35));
    renderer.shadowMap.enabled = true;
    const sp = startPose(M.layout);
    const cam = eyeCam(sp);
    scene.add(cam);
    const fl = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
    fl.position.set(0.2, -0.15, 0.1);
    fl.target.position.set(0.04, -0.12, -6);
    fl.castShadow = true;
    fl.shadow.mapSize.set(1024, 1024);
    fl.shadow.camera.near = 0.2;
    cam.add(fl, fl.target);
    c.viewpoints = [fl];
    // the game's path: the station drawn by a PassNode inside a RenderPipeline (render/volumetric.ts), i.e. a nested render
    const W = await import('three/webgpu'), TSL = await import('three/tsl');
    const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: THREE.RenderTarget};
    const pipe = new W.RenderPipeline(renderer, scenePass as never);
    const rt = scenePass.renderTarget;
    const {renderContextDepth} = await import('../src/render/renderContextDepth');
    // counters: node builds, render objects, cache-key recomputes
    const R = renderer as unknown as {_objects: {createRenderObject: (...a: unknown[]) => {constructor: {prototype: {getCacheKey: () => string}}}}; backend: {createNodeBuilder: (...a: unknown[]) => unknown}};
    const n = {builds: 0, ros: 0, keys: 0, keyMs: 0, log: false};
    const buildLog: string[] = [];
    const roLog: string[] = [];
    let lastMat: {isShadowPassMaterial?: boolean; type?: string; name?: string} | null = null;
    const cnb = R.backend.createNodeBuilder.bind(R.backend);
    R.backend.createNodeBuilder = (...a: unknown[]) => {
      n.builds++;
      if (n.log) { const o = a[0] as THREE.Mesh; buildLog.push(`${o.name || o.type}${(o as THREE.InstancedMesh).isInstancedMesh ? '[inst]' : ''}:${lastMat?.isShadowPassMaterial ? 'SHADOW' : `${lastMat?.type}/${lastMat?.name ?? ''}`}`); }
      return cnb(...a);
    };
    const cro = R._objects.createRenderObject.bind(R._objects);
    let keyHooked = false;
    R._objects.createRenderObject = (...a: unknown[]) => {
      n.ros++;
      lastMat = a[4] as typeof lastMat;
      if (n.log) { const o = a[3] as THREE.Mesh; roLog.push(`${o.name || o.type}${(o as THREE.InstancedMesh).isInstancedMesh ? '[inst]' : ''}:${lastMat?.isShadowPassMaterial ? 'S' : 'M'}:${String(a[10] ?? '')}`); }
      const ro = cro(...a);
      if (!keyHooked) {
        keyHooked = true;
        const proto = Object.getPrototypeOf(ro) as {getCacheKey: () => string};
        const g = proto.getCacheKey;
        proto.getCacheKey = function (this: unknown) { n.keys++; const t = performance.now(); try { return g.call(this); } finally { n.keyMs += performance.now() - t; } };
      }
      return ro;
    };
    const nodeFrame = (renderer as unknown as {_nodes: {nodeFrame: {update(): void}}})._nodes.nodeFrame;
    const frame = (_camera: THREE.Camera) => { renderer.info.reset(); nodeFrame.update(); renderer.setRenderTarget(null); pipe.render(); };
    // the game's first frame setup: loot display filled for the start eye
    (M.cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
    (M.cm as unknown as {dirty: boolean}).dirty = true;
    M.cm.update(0.2, 0);
    c.update(cam, true);
    const reg = new WarmupRegistry();
    if (M.liftRoot) reg.addPool('tower', () => [M.liftRoot!]); // (the game's towerRuntime pool in the mall)
    if (!process.env.LL_RCPU_NO_POOL) reg.addPool('holders', () => [M.cm.group]); // (the game's pool since lane RENDER-CPU)
    const t0 = performance.now();
    const res = await runWarmup({
      renderer: renderer as unknown as WarmupRenderer, scene, camera: cam, mode: 'full', registry: reg,
      sceneTarget: () => rt, torch: fl, torchIntensity: 1, frame: () => frame(cam),
      finish: () => { c.update(cam, true); frame(cam); }, hide: () => {}, alive: () => true,
      ...(process.env.LL_RCPU_NO_DEPTH ? {} : {sceneDepth: () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(renderer, rt, () => frame(cam)) ?? 0; } finally { cam.layers.mask = m; } }}),
    }, {yieldFrame: () => Promise.resolve()});
    out(`scene depth ${res.sceneDepth}, others ${res.plan.others}, shadow-stage frames ${res.stages.shadows.total}, stage ms ${JSON.stringify(Object.fromEntries(Object.entries(res.stages).map(([k, v]) => [k, Math.round(v.ms)])))}`);
    n.log = true;
    n.keyMs = 0;
    out(`warm-up ${res.status}${res.reason ? ` (${res.reason})` : ''} ${(performance.now() - t0).toFixed(0)} ms: items ${res.plan.items}, groups ${res.plan.groups}, casters ${res.plan.casters}; builds ${n.builds}, render objects ${n.ros}, cache keys ${n.keys}; gpu ${[...gpuCalls].filter(([k]) => /create|write/.test(k)).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const posesList: Pose[] = [sp];
    for (const [name, ring] of [['ring-edge', 2], ['shopfront', 1], ['escalator', 1], ['court', undefined], ['corridor', 1]] as const) {
      const p = mallQaPose(M.layout, name, ring);
      if (p) posesList.push({name: `${name}${ring ?? ''}`, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0});
    }
    // steady-state baseline: the start view, 5 frames
    for (let i = 0; i < 5; i++) frame(cam);
    const STEPS = Number(process.env.LL_RCPU_STEPS ?? 16);
    for (const pass of [1, 2]) for (const p of posesList) {
      const lines: string[] = [];
      let sum = 0, max = 0, bsum = 0, rsum = 0, ksum = 0;
      for (let s = 0; s <= STEPS; s++) {
        cam.position.set(p.x, p.y + 1.62, p.z);
        cam.rotation.set(0, p.yaw + s * 2 * Math.PI / STEPS, 0, 'YXZ');
        cam.updateMatrixWorld(true);
        (M.cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
        M.cm.update(1 / 60, 0);
        const b0 = n.builds, r0 = n.ros, k0 = n.keys;
        resetGpuCalls();
        const a = performance.now();
        c.update(cam);
        const tc = performance.now() - a;
        frame(cam);
        const t = performance.now() - a;
        const info = renderer.info.render as unknown as {calls?: number; drawCalls?: number; frameCalls?: number};
        sum += t; max = Math.max(max, t); bsum += n.builds - b0; rsum += n.ros - r0; ksum += n.keys - k0;
        lines.push(`  ${String(Math.round(s * 360 / STEPS)).padStart(3)}°: frame ${t.toFixed(2)} ms (cull ${tc.toFixed(2)}), draws ${info.drawCalls ?? info.calls}, builds ${n.builds - b0}, new ROs ${n.ros - r0}, cacheKeys ${n.keys - k0}, gpu ${[...gpuCalls].filter(([k]) => /create(Render|Bind|Buffer|Shader)|writeBuffer/.test(k)).map(([k, v]) => `${k} ${v}`).join(' ')}`);
      }
      out(`pass ${pass} ${p.name}: frame avg ${(sum / (STEPS + 1)).toFixed(2)} max ${max.toFixed(2)} ms; builds ${bsum}, new ROs ${rsum}, cacheKeys ${ksum} (${n.keyMs.toFixed(1)} ms)${buildLog.length ? ` BUILT: ${buildLog.join(', ')}` : ''}${roLog.length ? ` NEW RO: ${[...new Map(roLog.map(x => [x, roLog.filter(y => y === x).length])).entries()].slice(0, 40).map(([k, v]) => `${k} x${v}`).join(', ')}` : ''}`);
      buildLog.length = 0; roLog.length = 0; n.keyMs = 0;
      for (const l of lines) out(l);
    }
    expect(res.status).toBe('complete');
  }, 1_200_000);
});
