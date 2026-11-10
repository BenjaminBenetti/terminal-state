// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY, user: "better performance, especially stuttering"): TWO-PASS
// materials (transparent, DoubleSide, not forceSinglePass: the station's glass) after the loading-screen warm-up and after the train
// journey's preparation, on three r186's REAL WebGPURenderer (no-op device, tests/helpers/fakeWebgpu.ts).
//
// three draws such a material twice with `side` set to BackSide, then FrontSide. `compileAsync` queues its work and builds it after
// the side was restored, so a compile-only preparation leaves the render objects with the DoubleSide pipeline; the first real draw
// then asks the device for two more render pipelines of the same programs (no node build, no new render object: invisible to the
// earlier "0 builds / 0 render objects" censuses). The first-use census of this task found exactly these left on every level kind
// after a complete 'full' warm-up: 2 per glass batch on first sight (Skyways seed 80: 72 on one walk between seven poses).
//  1. the warm-up (render/warmup.ts): non-caster two-pass representatives get a real hidden frame — a sweep afterwards (a culled
//     pane coming into view, a pooled hidden pane shown) requests 0 pipelines; a pane prepared by compile ONLY (the control:
//     prepareObjects) still requests its two on first draw;
//  2. the journey (render/journeyCompile.ts): the 'sides' lane draws each compiled two-pass item off-screen, one per step, into the
//     scene pass's own target; the sweep after the job requests 0 pipelines, and the lane's own draws are where they were requested.
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {FrameBudget} from '../src/core/frameBudget';
import {WarmupRegistry, drawsDoublePass, drawsTwoPass, planWarmup, prepareObjects, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {drawsDoublePass as poolDrawsDoublePass} from '../src/render/runtimeVariants';
import {renderContextDepth} from '../src/render/renderContextDepth';
import {installShadowAlphaTwin} from '../src/render/shadowOverride';
import {JourneyCompile} from '../src/render/journeyCompile';
import {CULL_LAYER} from '../src/world/levelCulling';

afterAll(() => vi.unstubAllGlobals());

/** A real renderer on the no-op device: node builds, render objects and render-pipeline requests counted inside three. */
async function rig() {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const r = new W.WebGPURenderer({canvas});
  await r.init();
  installShadowAlphaTwin(r);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const n = {builds: 0, ros: 0, pipelines: 0, sides: [] as number[]};
  const R = r as unknown as {
    _objects: {createRenderObject: (...a: unknown[]) => object}; _nodes: {nodeFrame: {update(): void}};
    backend: {createNodeBuilder: (...a: unknown[]) => unknown; createRenderPipeline: (ro: {material: THREE.Material}, promises: unknown) => unknown};
  };
  const cnb = R.backend.createNodeBuilder.bind(R.backend);
  R.backend.createNodeBuilder = (...a: unknown[]) => { n.builds++; return cnb(...a); };
  const cro = R._objects.createRenderObject.bind(R._objects);
  R._objects.createRenderObject = (...a: unknown[]) => { n.ros++; return cro(...a); };
  const crp = R.backend.createRenderPipeline.bind(R.backend);
  R.backend.createRenderPipeline = (ro, promises) => { n.pipelines++; n.sides.push(ro.material.side); return crp(ro, promises); };

  // a small station: lit casters / receivers, and double-sided glass as the game has it — a pane, an instanced batch (its own
  // programs), a pane the level culler hides, and a pane hidden in a pool until used (a holder's glass door)
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
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = lit(new THREE.Mesh(box, new THREE.MeshStandardMaterial({color: 0x777777 + i})));
    m.position.set(Math.cos(a) * 6, 0.5, Math.sin(a) * 6);
    scene.add(m);
  }
  const glassMat = () => new THREE.MeshStandardMaterial({color: 0x88aacc, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false});
  const pane = new THREE.Mesh(plane, glassMat());
  pane.position.set(0, 1.5, -4);
  const batch = new THREE.InstancedMesh(plane, glassMat(), 3);
  for (let i = 0; i < 3; i++) batch.setMatrixAt(i, new THREE.Matrix4().makeTranslation(4, 1.2, i - 1));
  const culled = new THREE.Mesh(plane, glassMat());
  culled.position.set(0, 1.5, 5);
  culled.layers.set(CULL_LAYER);
  const holders = new THREE.Group();
  const door = new THREE.Mesh(plane, glassMat());
  door.position.set(-4, 1.2, 0);
  door.visible = false;
  holders.add(door);
  scene.add(pane, batch, culled, holders);
  const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
  const pipe = new W.RenderPipeline(r, scenePass as never);
  const frame = () => { r.info.reset(); R._nodes.nodeFrame.update(); r.setRenderTarget(null); pipe.render(); };
  const depthProbe = () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(r, scenePass.renderTarget, frame) ?? 0; } finally { cam.layers.mask = m; } };
  const reg = new WarmupRegistry();
  reg.addPool('holders', () => [holders]);
  cam.position.set(0, 1.62, 0);
  cam.updateMatrixWorld(true);
  /** A full turn; the culler shows the hidden pane and the holder's door opens on the way. */
  const sweep = () => {
    for (let st = 0; st < 16; st++) {
      if (st === 5) culled.layers.set(0);
      if (st === 9) door.visible = true;
      cam.rotation.set(0, st * Math.PI / 8, 0);
      cam.updateMatrixWorld(true);
      frame();
    }
  };
  return {r, n, scene, cam, torch, plane, glassMat, pane, batch, culled, door, holders, scenePass, frame, depthProbe, reg, sweep};
}

describe('two-pass materials: the predicate', () => {
  it('a transparent DoubleSide material that is not forceSinglePass draws in two passes; a renderable with one is a two-pass item', () => {
    const glass = new THREE.MeshStandardMaterial({transparent: true, side: THREE.DoubleSide});
    const single = new THREE.MeshStandardMaterial({transparent: true, side: THREE.DoubleSide, forceSinglePass: true});
    const front = new THREE.MeshStandardMaterial({transparent: true}), opaque = new THREE.MeshStandardMaterial({side: THREE.DoubleSide});
    expect([glass, single, front, opaque].map(drawsDoublePass)).toEqual([true, false, false, false]);
    expect(poolDrawsDoublePass).toBe(drawsDoublePass); // (render/runtimeVariants.ts re-exports the one definition)
    const g = new THREE.BoxGeometry();
    expect([drawsTwoPass(new THREE.Mesh(g, glass)), drawsTwoPass(new THREE.Mesh(g, [opaque, glass])), drawsTwoPass(new THREE.Mesh(g, [opaque, front])), drawsTwoPass(new THREE.Group())])
      .toEqual([true, true, false, false]);
    const hidden = glass.clone();
    hidden.visible = false;
    expect(drawsTwoPass(new THREE.Mesh(g, [opaque, hidden]))).toBe(false);
  });
});

describe('the loading-screen warm-up leaves no pipeline request for the first view of glass', () => {
  it('full warm-up: a sweep over the panes (culled one shown, pooled door opened) requests 0 pipelines; compile-only (the control) requests 2 per pane', async () => {
    const k = await rig();
    const res = await runWarmup({
      renderer: k.r as unknown as WarmupRenderer, scene: k.scene, camera: k.cam, mode: 'full', registry: k.reg,
      sceneTarget: () => k.scenePass.renderTarget, torch: k.torch, torchIntensity: 1, frame: k.frame, finish: k.frame, hide: () => {}, alive: () => true,
      sceneDepth: k.depthProbe,
    }, {yieldFrame: () => Promise.resolve(), compileChunk: 4, frameChunk: 5});
    expect(res.status).toBe('complete');
    expect(res.sceneDepth).toBe(1);
    // everything is restored: the culled pane is culled, the door hidden, the materials double-sided
    expect([k.culled.layers.mask >>> 0, k.door.visible]).toEqual([(1 << CULL_LAYER) >>> 0, false]);
    for (const o of [k.pane, k.batch, k.culled, k.door]) expect((o.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const n0 = {...k.n};
    k.sweep();
    expect({builds: k.n.builds - n0.builds, renderObjects: k.n.ros - n0.ros, pipelines: k.n.pipelines - n0.pipelines}).toEqual({builds: 0, renderObjects: 0, pipelines: 0});

    // the control: a new pane with its own material values, prepared by compileAsync alone (prepareObjects: no real frame) — its
    // node build and render objects are ready, and its first real draw still asks for the BackSide and the FrontSide pipeline
    const late = new THREE.Mesh(k.plane, new THREE.MeshStandardMaterial({color: 0x99bbdd, transparent: true, opacity: 0.4, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.01}));
    late.position.set(0, 1.5, -3);
    late.visible = false;
    k.scene.add(late);
    await prepareObjects(k.r as unknown as WarmupRenderer, k.scene, k.cam, late, k.scenePass.renderTarget, 1);
    k.cam.rotation.set(0, 0, 0);
    k.cam.updateMatrixWorld(true);
    k.frame();
    const n1 = {...k.n, sides: k.n.sides.length};
    late.visible = true;
    k.frame();
    expect({builds: k.n.builds - n1.builds, renderObjects: k.n.ros - n1.ros}).toEqual({builds: 0, renderObjects: 0});
    expect(k.n.sides.slice(n1.sides).sort()).toEqual([THREE.FrontSide, THREE.BackSide]); // (0 and 1: one request per pass)
  }, 120_000);

  it("'view' mode (software rasterizer) covers the two-pass representatives it plans, too", async () => {
    const k = await rig();
    const res = await runWarmup({
      renderer: k.r as unknown as WarmupRenderer, scene: k.scene, camera: k.cam, mode: 'view', registry: k.reg, near: {center: k.cam.position.clone(), radius: 24},
      sceneTarget: () => k.scenePass.renderTarget, torch: k.torch, torchIntensity: 1, frame: k.frame, finish: k.frame, hide: () => {}, alive: () => true,
      sceneDepth: k.depthProbe,
    }, {yieldFrame: () => Promise.resolve()});
    expect(res.status).toBe('complete');
    const n0 = k.n.pipelines;
    k.door.visible = true; // (pooled: planned in 'view' too)
    for (let st = 0; st < 16; st++) { k.cam.rotation.set(0, st * Math.PI / 8, 0); k.cam.updateMatrixWorld(true); k.frame(); }
    expect(k.n.pipelines - n0).toBe(0);
  }, 120_000);
});

describe("the train journey's preparation (render/journeyCompile.ts): the 'sides' lane", () => {
  it('draws each compiled two-pass item off-screen, one per step, into the scene pass target; the sweep after the job requests 0 pipelines', async () => {
    const k = await rig();
    k.cam.rotation.set(0, Math.PI, 0); // (the arrival view looks away from the pane: nothing of the glass was drawn before the job)
    k.cam.updateMatrixWorld(true);
    k.pane.layers.set(CULL_LAYER);
    k.batch.layers.set(CULL_LAYER);
    k.frame();
    const depth = k.depthProbe();
    expect(depth).toBe(1);
    const plan = planWarmup(k.scene, {mode: 'full', cameraMask: k.cam.layers.mask, pools: k.reg.poolRoots()});
    const items = [...plan.items, ...plan.others];
    const glass = items.filter(i => drawsTwoPass(i.object));
    expect(glass.map(i => i.object).sort((a, b) => a.id - b.id)).toEqual([k.pane, k.batch, k.culled, k.door].sort((a, b) => a.id - b.id));
    const fb = new FrameBudget();
    const job = new JourneyCompile({renderer: k.r as never, scheduler: fb, scene: k.scene, camera: k.cam, target: k.scenePass.renderTarget, depth, items,
      casters: items.filter(i => i.caster), receiver: plan.items.find(i => i.object.receiveShadow && !i.flips.length) ?? null, frameNo: () => fb.frame});
    expect([job.stats.twoPass, job.stats.twoPassDone]).toEqual([4, 0]);
    job.start();
    const R = k.r as unknown as {render: (s: THREE.Object3D, c: THREE.Camera) => unknown};
    const render = R.render.bind(k.r);
    let inRun = false, nest = 0;
    const targets: unknown[] = [];
    R.render = (s, c) => { if (inRun && nest === 0) targets.push(k.r.getRenderTarget()); nest++; try { return render(s, c); } finally { nest--; } };
    const stateOf = () => { const out: unknown[] = []; k.scene.traverse(o => { out.push(o.layers.mask, o.visible, o.frustumCulled, ((o as THREE.Mesh).material as THREE.Material | undefined)?.side); }); return JSON.stringify(out); };
    let frames = 0, maxSidesPerFrame = 0, sidePipelines = 0, compiledWhenDrawn = true;
    for (; frames < 720 && job.stats.phase !== 'done' && job.stats.phase !== 'cancelled'; frames++) {
      k.frame();
      const before = stateOf(), d0 = job.stats.twoPassDone, p0 = k.n.pipelines, s0 = job.stats.shadowDone;
      const t = performance.now();
      fb.hold(null);
      fb.beginFrame(t, t);
      inRun = true;
      fb.run();
      inRun = false;
      expect(stateOf(), `frame ${frames}: state restored`).toBe(before);
      const drew = job.stats.twoPassDone - d0;
      maxSidesPerFrame = Math.max(maxSidesPerFrame, drew);
      // (a frame's run with a 'sides' draw and no shadow draw: every pipeline requested in it is the lane's)
      if (drew && job.stats.shadowDone === s0) sidePipelines += k.n.pipelines - p0;
      if (job.stats.twoPassDone > items.slice(0, job.stats.sceneDone).filter(i => drawsTwoPass(i.object)).length) compiledWhenDrawn = false; // (never ahead of the scene lane)
      for (let i = 0; i < 6; i++) await new Promise(res => setImmediate(res)); // time between frames: three's yielded compile slices
    }
    R.render = render;
    expect(job.stats.phase).toBe('done');
    expect([job.stats.sceneDone, job.stats.twoPassDone]).toEqual([items.length, 4]);
    expect(compiledWhenDrawn).toBe(true);
    expect(maxSidesPerFrame).toBe(1); // ONE item per step: two pipeline requests at most
    expect(sidePipelines).toBeGreaterThan(0); // (the lane's draws are where the BackSide / FrontSide pipelines were requested)
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every(t => t === k.scenePass.renderTarget)).toBe(true); // never the canvas
    // after the ride: the glass comes into view (the culler shows the panes, the door opens)
    k.pane.layers.set(0);
    k.batch.layers.set(0);
    const n0 = {...k.n};
    k.sweep();
    expect({builds: k.n.builds - n0.builds, renderObjects: k.n.ros - n0.ros, pipelines: k.n.pipelines - n0.pipelines}).toEqual({builds: 0, renderObjects: 0, pipelines: 0});
  }, 180_000);

  it('no scene pass target (the direct path): no off-screen draw — the lane has nothing to do and the job still ends', async () => {
    const k = await rig();
    k.frame();
    const plan = planWarmup(k.scene, {mode: 'full', cameraMask: k.cam.layers.mask, pools: k.reg.poolRoots()});
    const fb = new FrameBudget();
    const job = new JourneyCompile({renderer: k.r as never, scheduler: fb, scene: k.scene, camera: k.cam, target: null, depth: 0, items: plan.items, casters: [], receiver: null, frameNo: () => fb.frame});
    expect(job.stats.twoPass).toBe(0);
    job.start();
    for (let f = 0; f < 400 && job.stats.phase !== 'done' && job.stats.phase !== 'cancelled'; f++) {
      const t = performance.now();
      fb.hold(null); fb.beginFrame(t, t); fb.run();
      for (let i = 0; i < 6; i++) await new Promise(res => setImmediate(res));
    }
    expect(job.stats.phase).toBe('done');
    expect(job.stats.twoPassDone).toBe(0);
  }, 120_000);
});
