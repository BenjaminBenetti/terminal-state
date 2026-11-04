// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU, journey follow-up; user: "the lag is also bad in reactor … the new
// loading transitions in the train"): render/journeyCompile.ts prepares the next station for the WHOLE ride, time-sliced through the
// REAL frame-budget scheduler (core/frameBudget.ts), on three r186's real WebGPURenderer (no-op device, tests/helpers/fakeWebgpu.ts):
//  - slicing bound (per frame): at most ONE scene chunk in flight (one step per frame in that phase), shadow draws of at most
//    JOURNEY_COMPILE.shadowChunk casters, every step's state change restored before the scheduler returns (layers, visibility,
//    frustum flags of every renderable, the scene's matrix auto-update, the renderer's target / MRT / tone mapping), and every
//    off-screen draw goes to the scene pass's own target, never the canvas;
//  - coverage after a simulated ride (no loading-screen warm-up at all): the job finishes within a typical ride (720 frames, 12 s at
//    60 Hz) and a sweep afterwards — incl. a culled room coming into view and a pooled loot-style batch shown later — makes 0 node
//    builds, 0 new render objects (scene AND shadow pass), 0 material cache-key rebuilds;
//  - the job ends with the station (the scheduler's world generation).
// Task studio-journey-compile-pacing-20261104 (the user's Chrome trace: three's scheduler.yield chain of a 16-item chunk held frames
// ~100 ms): ONE item per compileAsync call, one in flight, and between two frames at most JOURNEY_COMPILE.maxPerSlice calls inside
// the slice's real-time budget (the pacing rules with a fake renderer and clock: tests/journey-compile-pacing.test.ts).
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {FrameBudget} from '../src/core/frameBudget';
import {WarmupRegistry, planWarmup} from '../src/render/warmup';
import {renderContextDepth} from '../src/render/renderContextDepth';
import {installShadowAlphaTwin} from '../src/render/shadowOverride';
import {JOURNEY_COMPILE, JourneyCompile} from '../src/render/journeyCompile';
import {CULL_LAYER} from '../src/world/levelCulling';

afterAll(() => vi.unstubAllGlobals());

async function rig() {
  const canvas = stubWebgpuGlobals();
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const r = new W.WebGPURenderer({canvas});
  await r.init();
  installShadowAlphaTwin(r);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const n = {builds: 0, ros: 0, keys: 0};
  const R = r as unknown as {_objects: {createRenderObject: (...a: unknown[]) => object}; backend: {createNodeBuilder: (...a: unknown[]) => unknown}; _nodes: {nodeFrame: {update(): void}}};
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => { n.builds++; return cnb(...a); };
  const cro = R._objects.createRenderObject.bind(R._objects);
  R._objects.createRenderObject = (...a: unknown[]) => {
    n.ros++;
    const ro = cro(...a) as {getCacheKey(): string};
    const proto = Object.getPrototypeOf(ro) as {getCacheKey(): string; __jcKeys?: boolean};
    if (!proto.__jcKeys) { proto.__jcKeys = true; const g = proto.getCacheKey; proto.getCacheKey = function (this: unknown) { n.keys++; return g.call(this); }; }
    return ro;
  };
  // the station (as tests/rendercpu-warmup-context.test.ts): walls sharing materials, instanced props, alpha-tested decals between
  // opaque casters, a glass pane and an unlit glow, a culled room, a pooled hidden loot-style batch
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
  cam.rotation.order = 'YXZ';
  scene.add(cam, new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.4));
  const torch = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
  torch.position.set(0.2, -0.15, 0.1); torch.target.position.set(0.04, -0.12, -6); torch.castShadow = true; torch.shadow.mapSize.set(512, 512);
  cam.add(torch, torch.target);
  const box = new THREE.BoxGeometry(1, 1, 1), plane = new THREE.PlaneGeometry(1, 1);
  const lit = <T extends THREE.Mesh>(o: T) => { o.castShadow = true; o.receiveShadow = true; return o; };
  const floor = lit(new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({color: 0x333333})));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const mats = [0x777777, 0x665544, 0x445566].map(c => new THREE.MeshStandardMaterial({color: c}));
  const decal = new THREE.MeshStandardMaterial({color: 0xffffff, alphaTest: 0.5, side: THREE.DoubleSide});
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const m = lit(new THREE.Mesh(box, mats[i % 3])); m.position.set(Math.cos(a) * 6, 0.5, Math.sin(a) * 6); scene.add(m);
    const d = new THREE.Mesh(plane, decal); d.castShadow = true; d.position.set(Math.cos(a) * 5.4, 1.2, Math.sin(a) * 5.4); scene.add(d);
  }
  for (let k = 0; k < 3; k++) {
    const im = lit(new THREE.InstancedMesh(box, mats[k], 4));
    for (let i = 0; i < 4; i++) im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i - 2, 0.3, k * 2 - 2));
    scene.add(im);
  }
  const glass = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({color: 0x88aacc, transparent: true, opacity: 0.3})); glass.position.set(0, 1.5, -4);
  const glow = new THREE.Mesh(plane, new W.MeshBasicNodeMaterial({color: 0xffaa55})); glow.position.set(4, 2, 0);
  const room = lit(new THREE.Mesh(box, new THREE.MeshStandardMaterial({color: 0x224466}))); room.position.set(0, 0.5, 12); room.layers.set(CULL_LAYER);
  const holders = new THREE.Group();
  const batch = lit(new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({color: 0xaa3322}), 8)); batch.count = 0; batch.visible = false;
  holders.add(batch);
  scene.add(glass, glow, room, holders);
  const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
  const pipe = new W.RenderPipeline(r, scenePass as never);
  const frame = () => { r.info.reset(); R._nodes.nodeFrame.update(); r.setRenderTarget(null); pipe.render(); };
  return {r, n, scene, cam, torch, room, batch, holders, scenePass, frame};
}

/** Game.backgroundCompile's job for this scene ('full': representatives, then the rest; shadow variants of every caster). */
function journey(k: Awaited<ReturnType<typeof rig>>, fb: FrameBudget, depth: number) {
  const reg = new WarmupRegistry();
  reg.addPool('holders', () => [k.holders]);
  const plan = planWarmup(k.scene, {mode: 'full', cameraMask: k.cam.layers.mask, pools: reg.poolRoots()});
  const items = [...plan.items, ...plan.others];
  const casters = items.filter(i => i.caster);
  const receiver = plan.items.find(i => i.object.receiveShadow && !i.flips.length) ?? null;
  const job = new JourneyCompile({renderer: k.r as never, scheduler: fb, scene: k.scene, camera: k.cam, target: k.scenePass.renderTarget, depth, items, casters, receiver,
    frameNo: () => fb.frame});
  return {job, plan, items, casters};
}

const stateOf = (root: THREE.Object3D) => { const out: unknown[] = []; root.traverse(o => { out.push(o.layers.mask, o.visible, o.frustumCulled); }); return JSON.stringify(out); };
const idle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(res => setImmediate(res)); };

describe('journey compile (render/journeyCompile.ts) through the real frame-budget scheduler', () => {
  it('slicing bound per frame; restored state; off-screen only; finished within a typical ride; 0 builds / render objects / keys after it', async () => {
    const k = await rig();
    k.cam.position.set(0, 1.62, 0);
    k.cam.updateMatrixWorld(true);
    k.frame(); // a frame before the journey: the pipeline exists, the depth is measured (Game: the session's earlier warm-up)
    const depth = (() => { const m = k.cam.layers.mask; k.cam.layers.mask = 0; try { return renderContextDepth(k.r, k.scenePass.renderTarget, k.frame) ?? 0; } finally { k.cam.layers.mask = m; } })();
    expect(depth).toBe(1);
    const fb = new FrameBudget();
    const {job, items, casters} = journey(k, fb, depth);
    job.start();
    // the renderer's render target during every render the job issues (the scheduler runs after the frame's own render)
    const R = k.r as unknown as {render: (s: THREE.Object3D, c: THREE.Camera) => unknown};
    const render = R.render.bind(k.r);
    let inRun = false;
    const targets: unknown[] = [];
    let nest = 0; // (the light's shadow map render nested inside the off-screen draw has its own target: only top-level renders count)
    R.render = (s, c) => { if (inRun && nest === 0) targets.push(k.r.getRenderTarget()); nest++; try { return render(s, c); } finally { nest--; } };
    let frames = 0, maxSceneSteps = 0, maxPerFrame = 0;
    for (; frames < 720 && job.stats.phase !== 'done' && job.stats.phase !== 'cancelled'; frames++) {
      k.frame();
      const before = stateOf(k.scene), tm = k.r.toneMapping, auto = k.scene.matrixWorldAutoUpdate, target = k.r.getRenderTarget();
      const c0 = job.stats.sceneChunks;
      const t = performance.now();
      fb.hold(null);
      fb.beginFrame(t, t);
      inRun = true;
      fb.run();
      inRun = false;
      expect(stateOf(k.scene), `frame ${frames}: state restored`).toBe(before);
      expect([k.r.toneMapping, k.scene.matrixWorldAutoUpdate, k.r.getRenderTarget()]).toEqual([tm, auto, target]);
      maxSceneSteps = Math.max(maxSceneSteps, job.stats.sceneChunks - c0);
      await idle(); // time between frames: three's yielded compile slices
      maxPerFrame = Math.max(maxPerFrame, job.stats.sceneChunks - c0);
    }
    R.render = render;
    expect(job.stats.phase).toBe('done');
    expect(frames).toBeLessThan(720);
    expect([job.stats.sceneDone, job.stats.shadowDone]).toEqual([items.length, casters.length]);
    expect(maxSceneSteps).toBe(1); // at most one compile call started inside a frame's scheduler run (and one in flight)
    expect(job.stats.sceneChunks).toBe(items.length); // ONE item per compileAsync call (JOURNEY_COMPILE.chunk)
    expect(maxPerFrame).toBeLessThanOrEqual(JOURNEY_COMPILE.maxPerSlice); // between two frames: the slice's bounded calls
    expect(job.stats.maxPerSlice).toBeLessThanOrEqual(JOURNEY_COMPILE.maxPerSlice);
    expect([job.stats.background, job.stats.postStalls]).toEqual([false, 0]); // (Node: no scheduler.postTask — direct launches)
    expect(job.stats.shadowMaxPerStep).toBeGreaterThan(0);
    expect(job.stats.shadowMaxPerStep).toBeLessThanOrEqual(JOURNEY_COMPILE.shadowChunk);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every(t => t === k.scenePass.renderTarget)).toBe(true); // never the canvas
    // after the ride: a sweep incl. the culled room coming into view and the loot-style batch shown
    const n0 = {...k.n};
    for (let st = 0; st < 16; st++) {
      if (st === 6) k.room.layers.set(0);
      if (st === 10) { k.batch.count = 2; k.batch.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0.3, -2)); k.batch.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1, 0.3, -2)); k.batch.instanceMatrix.needsUpdate = true; k.batch.computeBoundingSphere(); k.batch.visible = true; }
      k.cam.rotation.set(0, st * Math.PI / 8, 0);
      k.cam.updateMatrixWorld(true);
      k.frame();
    }
    expect({builds: k.n.builds - n0.builds, renderObjects: k.n.ros - n0.ros, keys: k.n.keys - n0.keys}).toEqual({builds: 0, renderObjects: 0, keys: 0});
  }, 180_000);

  it('without the job the same sweep builds (the journey route has no loading-screen warm-up); the job ends with the station', async () => {
    const k = await rig();
    k.cam.position.set(0, 1.62, 0);
    k.cam.updateMatrixWorld(true);
    k.frame();
    const n0 = {...k.n};
    for (let st = 0; st < 16; st++) { if (st === 6) k.room.layers.set(0); k.cam.rotation.set(0, st * Math.PI / 8, 0); k.cam.updateMatrixWorld(true); k.frame(); }
    expect(k.n.builds - n0.builds).toBeGreaterThan(0);
    const fb = new FrameBudget();
    const {job} = journey(k, fb, 1);
    job.start();
    fb.bumpGeneration(); // Game.leaveSection: the station is replaced
    await job.done;
    expect(job.stats.phase).toBe('cancelled');
    expect(job.stats.cancelReason).toBe('generation');
  }, 120_000);
});
