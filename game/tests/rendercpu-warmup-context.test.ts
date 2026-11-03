// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU, user: "stuttering on new visuals is defiantly worse now, especially
// turning the camera around in the mall causes the spike. CPU spike for sure." + "the lag is also bad in reactor"): the warm-up's
// coverage, measured on three r186's REAL WebGPURenderer (WebGPU backend, and the WebGL 2 backend) running in Node against a no-op
// device (tests/helpers/fakeWebgpu.ts): node builds, render objects and material-cache-key rebuilds are counted inside three.
//  1. render context: the station is drawn by a PassNode inside a RenderPipeline (render/volumetric.ts) = call depth 1; compileAsync
//     asks for depth 0, so the former warm-up compiled every representative into a context the real frame never used. With the
//     scene pass's measured depth (render/renderContextDepth.ts) a full warm-up leaves NOTHING to build or create on turning: 0 node
//     builds, 0 new render objects — incl. a culled room coming into view, a pooled loot-style batch shown later (its shadow variant
//     too: pooled casters get shadow frames, every chunk with a receiver) and an unlit glow (a non-caster: no shadow frame ever
//     covered it). Without the depth the same sweep builds again.
//  2. the shadow-pass alpha twin (render/shadowOverride.ts): alpha-tested and opaque casters no longer flip the shared override's
//     version, so no caster re-keys per frame — with byte-identical shadow shaders per caster and the same casters per frame.
//  3. the REAL mall (t3a): every hidden-until-used holder content is planned (the 'holders' pool); a full warm-up through the real
//     renderer leaves 0 node builds / 0 new render objects / 0 key rebuilds on yaw sweeps at three poses.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {WarmupRegistry, planWarmup, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {renderContextDepth} from '../src/render/renderContextDepth';
import {installShadowAlphaTwin, shadowTwinStats} from '../src/render/shadowOverride';
import {CULL_LAYER} from '../src/world/levelCulling';
import {mallQaPose} from '../src/gen/mall/qa';
import {eyeCam, realMallScene, startPose, type Pose} from './helpers/rendercpuMall';

afterAll(() => vi.unstubAllGlobals());

type Backend = 'webgpu' | 'webgl2';
interface Counters { builds: number; ros: number; keys: number }

/** A real renderer on the no-op device with three-internal counters (node builds, render objects, cache-key computations). */
async function renderer(backend: Backend, twin: boolean) {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // (three: "WebGPU is not available, running under WebGL2 backend")
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const r = new W.WebGPURenderer({canvas, forceWebGL: backend === 'webgl2'});
  await r.init();
  if (twin) installShadowAlphaTwin(r);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const n: Counters = {builds: 0, ros: 0, keys: 0};
  const R = r as unknown as {_objects: {createRenderObject: (...a: unknown[]) => object}; backend: {createNodeBuilder: (...a: unknown[]) => unknown}; _nodes: {nodeFrame: {update(): void}}};
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => { n.builds++; return cnb(...a); };
  const cro = R._objects.createRenderObject.bind(R._objects);
  const ros: {object: THREE.Object3D; material: THREE.Material & {isShadowPassMaterial?: boolean}; ro: {getNodeBuilderState(): {vertexShader: string; fragmentShader: string}}}[] = [];
  let hooked = false;
  R._objects.createRenderObject = (...a: unknown[]) => {
    n.ros++;
    const ro = cro(...a) as {getNodeBuilderState(): {vertexShader: string; fragmentShader: string}};
    ros.push({object: a[3] as THREE.Object3D, material: a[4] as THREE.Material, ro});
    if (!hooked) {
      hooked = true;
      const proto = Object.getPrototypeOf(ro) as {getCacheKey(): string; __rcpuKeys?: boolean};
      if (!proto.__rcpuKeys) {
        proto.__rcpuKeys = true;
        const g = proto.getCacheKey;
        proto.getCacheKey = function (this: {renderer: unknown}) { const c = counters.get(this.renderer); if (c) c.keys++; return g.call(this); };
      }
    }
    return ro;
  };
  counters.set(r, n);
  return {r, W, TSL, n, ros, nodeFrame: R._nodes.nodeFrame};
}
const counters = new Map<unknown, Counters>();

/**
 * A small station: shared-material walls (non-representatives), instanced props, alpha-tested decals interleaved with opaque casters,
 * a glass pane and an unlit glow (non-casters), a culled room behind the camera, a pooled hidden loot-style batch (count 0).
 */
function station() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
  cam.rotation.order = 'YXZ';
  scene.add(cam, new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.4));
  const torch = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
  torch.position.set(0.2, -0.15, 0.1);
  torch.target.position.set(0.04, -0.12, -6);
  torch.castShadow = true;
  torch.shadow.mapSize.set(512, 512);
  cam.add(torch, torch.target);
  const world = new THREE.Group();
  scene.add(world);
  const box = new THREE.BoxGeometry(1, 1, 1), plane = new THREE.PlaneGeometry(1, 1);
  const lit = (o: THREE.Mesh) => { o.castShadow = true; o.receiveShadow = true; return o; };
  const floor = lit(new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({color: 0x333333})));
  floor.rotation.x = -Math.PI / 2;
  world.add(floor);
  const mats = [0x777777, 0x665544, 0x445566].map(c => new THREE.MeshStandardMaterial({color: c}));
  const decal = new THREE.MeshStandardMaterial({color: 0xffffff, alphaTest: 0.5, side: THREE.DoubleSide});
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const m = lit(new THREE.Mesh(box, mats[i % 3]));
    m.position.set(Math.cos(a) * 6, 0.5, Math.sin(a) * 6);
    world.add(m);
    const d = new THREE.Mesh(plane, decal); // alpha-tested caster next to each wall
    d.castShadow = true;
    d.position.set(Math.cos(a) * 5.4, 1.2, Math.sin(a) * 5.4);
    world.add(d);
  }
  for (let k = 0; k < 2; k++) {
    const im = lit(new THREE.InstancedMesh(box, mats[k], 4) as unknown as THREE.Mesh) as unknown as THREE.InstancedMesh;
    for (let i = 0; i < 4; i++) im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i - 2, 0.3, k ? 3 : -3));
    world.add(im);
  }
  const glass = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({color: 0x88aacc, transparent: true, opacity: 0.3}));
  glass.position.set(0, 1.5, -4);
  const W = (globalThis as {__W?: typeof import('three/webgpu')}).__W!;
  const glow = new THREE.Mesh(plane, new W.MeshBasicNodeMaterial({color: 0xffaa55}));
  glow.position.set(4, 2, 0);
  world.add(glass, glow);
  const room = lit(new THREE.Mesh(box, new THREE.MeshStandardMaterial({color: 0x224466})));
  room.position.set(0, 0.5, 12);
  room.layers.set(CULL_LAYER); // hidden by the level culler at warm-up time
  world.add(room);
  const holders = new THREE.Group();
  scene.add(holders);
  const batch = lit(new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({color: 0xaa3322}), 8) as unknown as THREE.Mesh) as unknown as THREE.InstancedMesh;
  batch.count = 0;
  batch.visible = false; // a loot batch with nothing to show yet
  holders.add(batch);
  return {scene, cam, torch, world, room, batch, holders, floor};
}

async function sweep(backend: Backend, o: {depth: boolean; twin: boolean}) {
  const k = await renderer(backend, o.twin);
  (globalThis as {__W?: unknown}).__W = k.W;
  const s = station();
  const scenePass = k.TSL.pass(s.scene, s.cam, {samples: 4}) as unknown as {renderTarget: unknown};
  const pipe = new k.W.RenderPipeline(k.r, scenePass as never);
  const frame = () => { k.r.info.reset(); k.nodeFrame.update(); k.r.setRenderTarget(null); pipe.render(); };
  const reg = new WarmupRegistry();
  reg.addPool('holders', () => [s.holders]);
  const probe = () => { const m = s.cam.layers.mask; s.cam.layers.mask = 0; try { return renderContextDepth(k.r, scenePass.renderTarget, frame) ?? 0; } finally { s.cam.layers.mask = m; } };
  s.cam.updateMatrixWorld(true);
  const res = await runWarmup({
    renderer: k.r as unknown as WarmupRenderer, scene: s.scene, camera: s.cam, mode: 'full', registry: reg,
    sceneTarget: () => scenePass.renderTarget, torch: s.torch, torchIntensity: 1, frame, finish: frame, hide: () => {}, alive: () => true,
    ...(o.depth ? {sceneDepth: probe} : {}),
  }, {yieldFrame: () => Promise.resolve(), compileChunk: 4, frameChunk: 5});
  const after = {...k.n};
  const keysPerFrame: number[] = [];
  for (let st = 0; st < 16; st++) {
    if (st === 6) s.room.layers.enableAll(), s.room.layers.set(0); // the culler shows the room (turned towards it)
    if (st === 10) { s.batch.count = 2; s.batch.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0.3, -2)); s.batch.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1, 0.3, -2)); s.batch.instanceMatrix.needsUpdate = true; s.batch.computeBoundingSphere(); s.batch.visible = true; }
    s.cam.position.set(0, 1.62, 0);
    s.cam.rotation.set(0, st * Math.PI / 8, 0);
    s.cam.updateMatrixWorld(true);
    const k0 = k.n.keys;
    frame();
    keysPerFrame.push(k.n.keys - k0);
  }
  return {res, k, s, builds: k.n.builds - after.builds, ros: k.n.ros - after.ros, keys: k.n.keys - after.keys, keysPerFrame, frame};
}

describe('warm-up render context (three r186 WebGPURenderer on a no-op device)', () => {
  for (const backend of ['webgpu', 'webgl2'] as const) {
    it(`${backend}: with the scene pass's call depth the warm-up leaves 0 node builds / 0 new render objects on a sweep; without it the sweep builds again`, async () => {
      const fixed = await sweep(backend, {depth: true, twin: true});
      expect(fixed.res.status).toBe('complete');
      expect(fixed.res.sceneDepth).toBe(1); // the PassNode draws inside the pipeline's quad render
      expect(fixed.res.plan.others).toBeGreaterThan(0);
      expect(fixed.builds, 'node builds after the warm-up').toBe(0);
      expect(fixed.ros, 'new render objects after the warm-up').toBe(0);
      expect(fixed.keys, 'material cache keys computed after the warm-up').toBe(0);
      const before = await sweep(backend, {depth: false, twin: true});
      expect(before.res.sceneDepth).toBe(0);
      expect(before.builds, 'the former warm-up: builds on the sweep').toBeGreaterThan(0);
    }, 120_000);
  }
});

describe('shadow-pass alpha twin (render/shadowOverride.ts): exact, and no per-frame re-keying', () => {
  for (const backend of ['webgpu', 'webgl2'] as const) {
    it(`${backend}: identical shadow shaders per caster, the same casters, 0 key rebuilds per frame (three alone: every frame)`, async () => {
      const off = await sweep(backend, {depth: true, twin: false});
      const t0 = shadowTwinStats.draws;
      const on = await sweep(backend, {depth: true, twin: true});
      expect(shadowTwinStats.draws - t0).toBeGreaterThan(0);
      // three alone: the shared shadow material's alphaTest crosses 0 between casters, so every caster re-keys every frame
      expect(Math.min(...off.keysPerFrame.slice(1))).toBeGreaterThan(5);
      expect(on.keysPerFrame.every(v => v === 0)).toBe(true);
      // the same shadow render objects per caster, with the same shaders (ids normalised: node ids differ between renderers)
      const shadowOf = (k: typeof on) => {
        const m = new Map<string, string>();
        for (const x of k.k.ros) if (x.material.isShadowPassMaterial) {
          const st = x.ro.getNodeBuilderState();
          const name = `${x.object.type}@${x.object.position.toArray().map(v => v.toFixed(2)).join(',')}`;
          m.set(name, `${st.vertexShader}\n${st.fragmentShader}`.replace(/\d+/g, '#'));
        }
        return m;
      };
      const a = shadowOf(off), b = shadowOf(on);
      expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
      for (const [name, code] of a) expect(b.get(name), name).toBe(code);
      expect([...a.keys()].length).toBeGreaterThan(20);
    }, 120_000);
  }
});

describe('the REAL mall (t3a): warm-up coverage on the real build path', () => {
  it("hidden-until-used holder contents are planned via the 'holders' pool; nothing renderable is left out except by layer / geometry", async () => {
    const M = await realMallScene('t3a');
    const cam = eyeCam(startPose(M.layout));
    const pools = [M.cm.group, ...(M.liftRoot ? [M.liftRoot] : [])];
    const plan = planWarmup(M.scene, {mode: 'full', cameraMask: cam.layers.mask, pools});
    const planned = new Set([...plan.items, ...plan.others].map(i => i.object));
    const unplanned: string[] = [];
    let hiddenHolders = 0;
    M.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let hidden = false;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) hidden = true;
      let under = false;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p === M.cm.group) under = true;
      if (hidden && under) hiddenHolders++;
      if (!planned.has(m) && m.geometry?.attributes?.position) unplanned.push(`${m.name || m.type}${hidden ? ' (hidden)' : ''}`);
    });
    expect(hiddenHolders).toBeGreaterThan(100); // loot batches (one per item x storey) + holder interiors
    expect(unplanned).toEqual([]);
    // the game registers exactly that pool and the measured scene depth, and installs the twin (source wiring)
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/this\.warmRegistry\.addPool\('holders', \(\) => \(this\.containers \? \[this\.containers\.group\] : \[\]\)\);/);
    expect(src).toMatch(/sceneDepth: \(\) => this\.sceneDepth\(true\)/);
    expect(src).toMatch(/installShadowAlphaTwin\(this\.renderer\);/);
    expect(src).toMatch(/prepareObjects\([^)]*this\.sceneDepth\(false\)\)/);
    // the journey route (no loading-screen warm-up) compiles in the station's context too
    const bg = src.slice(src.indexOf('private async backgroundCompile('), src.indexOf('// --- end campaign (primary)'));
    expect(bg).toMatch(/compileItemsLive\(/);
    expect(bg).toMatch(/this\.atmosphere\.warmTarget\(this\.scene, this\.camera\)/);
    expect(bg).toMatch(/this\.sceneDepth\(false\)/);
  }, 240_000);

  it('a full warm-up through the real renderer (nested scene pass, no-op WebGPU device) leaves 0 builds / render objects / key rebuilds on yaw sweeps', async () => {
    const k = await renderer('webgpu', true);
    const M = await realMallScene('t3a');
    const scene = M.scene, c = M.world.culler;
    scene.add(new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.35));
    const sp = startPose(M.layout);
    const cam = eyeCam(sp);
    scene.add(cam);
    const fl = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
    fl.position.set(0.2, -0.15, 0.1);
    fl.target.position.set(0.04, -0.12, -6);
    fl.castShadow = true;
    fl.shadow.mapSize.set(1024, 1024);
    cam.add(fl, fl.target);
    c.viewpoints = [fl];
    const scenePass = k.TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
    const pipe = new k.W.RenderPipeline(k.r, scenePass as never);
    const frame = () => { k.r.info.reset(); k.nodeFrame.update(); k.r.setRenderTarget(null); pipe.render(); };
    const lastEye = (M.cm as unknown as {lastEye: THREE.Vector3}).lastEye;
    lastEye.copy(cam.position);
    (M.cm as unknown as {dirty: boolean}).dirty = true;
    M.cm.update(0.2, 0);
    c.update(cam, true);
    const reg = new WarmupRegistry();
    if (M.liftRoot) reg.addPool('tower', () => [M.liftRoot!]);
    reg.addPool('holders', () => [M.cm.group]);
    const res = await runWarmup({
      renderer: k.r as unknown as WarmupRenderer, scene, camera: cam, mode: 'full', registry: reg,
      sceneTarget: () => scenePass.renderTarget, torch: fl, torchIntensity: 1, frame, finish: () => { c.update(cam, true); frame(); },
      hide: () => {}, alive: () => true,
      sceneDepth: () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(k.r, scenePass.renderTarget, frame) ?? 0; } finally { cam.layers.mask = m; } },
    }, {yieldFrame: () => Promise.resolve()});
    expect(res.status).toBe('complete');
    expect(res.sceneDepth).toBe(1);
    const n0 = {...k.n};
    const poses: Pose[] = [sp];
    for (const [nm, ring] of [['ring-edge', 2], ['shopfront', 1]] as const) { const p = mallQaPose(M.layout, nm, ring); if (p) poses.push({name: nm, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0}); }
    expect(poses.length).toBe(3);
    for (const p of poses) for (let s = 0; s <= 8; s++) {
      cam.position.set(p.x, p.y + 1.62, p.z);
      cam.rotation.set(0, p.yaw + s * Math.PI / 4, 0, 'YXZ');
      cam.updateMatrixWorld(true);
      lastEye.copy(cam.position);
      M.cm.update(1 / 60, 0); // (the loot display shows the lots within view distance of this eye)
      c.update(cam);
      frame();
    }
    expect({builds: k.n.builds - n0.builds, renderObjects: k.n.ros - n0.ros, keys: k.n.keys - n0.keys}).toEqual({builds: 0, renderObjects: 0, keys: 0});
  }, 600_000);
});
