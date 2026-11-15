// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD; render/sharedInstancing.ts): shared instanced builds on a REAL
// station — the mall (t3a) built through the game's build path with its runtime population (helpers/rendercpuMall.ts: world, holders
// and loot display, shelf stock, the glass lift, enemies, pickups; the mall's attribute-instancing switch on, as Game.buildSection
// sets it), drawn by three r186's real WebGPURenderer on the validating no-op device, the station inside a nested scene pass like the
// game's, and warmed by the loading warm-up itself (render/warmup.ts, 'full' mode).
//  1. The plan. With shared builds on there is one representative per instanced variant; the pools it no longer lists are `others`
//     (drawn once in the warm-up's hidden frames). Every renderable is still planned, and the count the loading line shows is the
//     number of representatives really compiled.
//  2. Nothing is left for play. After the warm-up, yaw sweeps at three poses with the torch lit create 0 node builds, 0 render
//     objects, 0 pipelines (synchronous or asynchronous) and 0 shader modules — the pools that are no longer warm items included.
//  3. Own data. Every instanced draw of the sweeps (scene pass and the torch's shadow pass) names the instanceMatrix array of ITS mesh
//     in its vertex buffers, and no other mesh's.
//  4. The vertex-buffer budget. No pipeline of the mall asks for more than 8 vertex buffers / 16 attributes.
//  5. The game's wiring: installed once per renderer, on for every level; the journey route prepares the `others` too.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubValidatingWebgpu} from './helpers/validatingWebgpu';
import {VERTEX_LIMITS, attributeInstancing, setAttributeInstancing} from '../src/render/instancing';
import {installSharedInstancing, instancingSignature, isSharedRenderObject, overrideSharedInstancing, setSharedInstancing, sharedInstancingStats} from '../src/render/sharedInstancing';
import {WarmupRegistry, planWarmup, runWarmup, type WarmupProgress, type WarmupRenderer} from '../src/render/warmup';
import {renderContextDepth} from '../src/render/renderContextDepth';
import {installShadowAlphaTwin} from '../src/render/shadowOverride';
import {mallQaPose} from '../src/gen/mall/qa';
import {eyeCam, realMallScene, startPose, type Pose} from './helpers/rendercpuMall';

afterAll(() => { overrideSharedInstancing(undefined); setSharedInstancing(false); setAttributeInstancing(false); vi.unstubAllGlobals(); });

interface RO { object: THREE.Object3D; material: THREE.Material & {isShadowPassMaterial?: boolean};
  getVertexBuffers(): {array?: unknown; isInstancedInterleavedBuffer?: boolean}[] }

describe('the REAL mall (t3a) with shared instanced builds: the loading warm-up, then play', () => {
  it('one representative per instanced variant; after the warm-up yaw sweeps build and create nothing; every pool draws its own instances', async () => {
    const v = stubValidatingWebgpu();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const r = new W.WebGPURenderer({canvas: v.canvas});
    await r.init();
    installShadowAlphaTwin(r); // (as Game.initRenderer)
    expect(installSharedInstancing(r)).toBe(true);
    overrideSharedInstancing('on');
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    // counters inside three and at the device
    const n = {builds: 0, instancedBuilds: 0, renderObjects: 0, pipelines: 0, asyncPipelines: 0, modules: 0, maxBuffers: 0, maxAttributes: 0};
    const R = r as unknown as {_objects: {createRenderObject(...a: unknown[]): object}; _nodes: {nodeFrame: {update(): void}};
      backend: {createNodeBuilder(object: THREE.Object3D, renderer: unknown): {material: THREE.Material & {isShadowPassMaterial?: boolean}}; draw(ro: RO, info: unknown): void; device: Record<string, any>}};
    const createNodeBuilder = R.backend.createNodeBuilder.bind(R.backend);
    R.backend.createNodeBuilder = (object, renderer) => { n.builds++; if ((object as THREE.InstancedMesh).isInstancedMesh) n.instancedBuilds++; return createNodeBuilder(object, renderer); };
    const createRenderObject = R._objects.createRenderObject.bind(R._objects);
    R._objects.createRenderObject = (...a: unknown[]) => { n.renderObjects++; return createRenderObject(...a); };
    const device = R.backend.device;
    for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const inner = device[name].bind(device);
      device[name] = (d: {vertex?: {buffers?: {attributes?: unknown[]}[]}}) => {
        n.pipelines++; if (name === 'createRenderPipelineAsync') n.asyncPipelines++;
        const vb = d?.vertex?.buffers ?? [];
        n.maxBuffers = Math.max(n.maxBuffers, vb.length);
        n.maxAttributes = Math.max(n.maxAttributes, vb.reduce((k, x) => k + (x?.attributes?.length ?? 0), 0));
        return inner(d);
      };
    }
    const createShaderModule = device.createShaderModule.bind(device);
    device.createShaderModule = (d: unknown) => { n.modules++; return createShaderModule(d); };
    // every instanced draw: does it name its own mesh's matrices?
    const drawn = {shared: 0, keyed: 0, sharedShadow: 0, wrong: [] as string[], pools: new Set<THREE.Object3D>()};
    let watching = false;
    const draw = R.backend.draw.bind(R.backend);
    R.backend.draw = (ro: RO, info: unknown) => {
      const im = ro.object as THREE.InstancedMesh;
      if (watching && im.isInstancedMesh) {
        if (isSharedRenderObject(ro)) {
          drawn.shared++; drawn.pools.add(im);
          if (ro.material.isShadowPassMaterial === true) drawn.sharedShadow++;
          const inst = ro.getVertexBuffers().filter(b => b.isInstancedInterleavedBuffer === true);
          const own = inst.filter(b => b.array === im.instanceMatrix.array).length;
          if (own !== 1 || inst.length !== 1) { if (drawn.wrong.length < 12) drawn.wrong.push(`${im.name || im.uuid}: ${own} own of ${inst.length} instance-matrix buffers`); }
        } else drawn.keyed++;
      }
      return draw(ro, info);
    };

    const M = await realMallScene('t3a');
    expect(attributeInstancing(), 'the mall builds with the attribute switch on').toBe(true);
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
    const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
    const pipe = new W.RenderPipeline(r, scenePass as never);
    const frame = () => { r.info.reset(); R._nodes.nodeFrame.update(); r.setRenderTarget(null); pipe.render(); };
    const lastEye = (M.cm as unknown as {lastEye: THREE.Vector3}).lastEye;
    lastEye.copy(cam.position);
    (M.cm as unknown as {dirty: boolean}).dirty = true;
    M.cm.update(0.2, 0);
    c.update(cam, true);
    const reg = new WarmupRegistry();
    if (M.liftRoot) reg.addPool('tower', () => [M.liftRoot!]);
    reg.addPool('holders', () => [M.cm.group]);

    // 1. the plan, shared builds on against off (the same scene, the same options)
    const planOf = (shareInstanced: boolean) => planWarmup(scene, {mode: 'full', cameraMask: cam.layers.mask, pools: reg.poolRoots(), shareInstanced});
    const on = planOf(true), off = planOf(false), auto = planWarmup(scene, {mode: 'full', cameraMask: cam.layers.mask, pools: reg.poolRoots()});
    const instanced = (l: readonly {object: THREE.Object3D}[]) => l.filter(i => (i.object as THREE.InstancedMesh).isInstancedMesh).length;
    const pools = instanced([...off.items, ...off.others]);
    expect(auto.items.length, 'the default follows the switch').toBe(on.items.length);
    expect(on.items.length + on.others.length, 'every renderable is still planned').toBe(off.items.length + off.others.length);
    expect(new Set([...on.items, ...on.others].map(i => i.object))).toEqual(new Set([...off.items, ...off.others].map(i => i.object)));
    expect(instanced(off.items), 'three alone: every pool is its own item').toBe(pools);
    expect(pools).toBeGreaterThan(300);
    expect(instanced(on.items), 'shared: far fewer instanced representatives than pools').toBeLessThan(pools / 2);
    expect(on.items.length).toBeLessThan(off.items.length);
    // the non-instanced part of the plan is untouched
    expect(on.items.filter(i => !(i.object as THREE.InstancedMesh).isInstancedMesh).map(i => i.object)).toEqual(off.items.filter(i => !(i.object as THREE.InstancedMesh).isInstancedMesh).map(i => i.object));
    // what stays keyed in the mall keeps its own item (no signature = three's own key)
    const keyedPools = [...off.items].filter(i => (i.object as THREE.InstancedMesh).isInstancedMesh && instancingSignature(i.object) === null);
    for (const k of keyedPools) expect(on.items.some(i => i.object === k.object)).toBe(true);

    // the warm-up itself
    const progress: WarmupProgress[] = [];
    const res = await runWarmup({
      renderer: r as unknown as WarmupRenderer, scene, camera: cam, mode: 'full', registry: reg,
      sceneTarget: () => scenePass.renderTarget, torch: fl, torchIntensity: 1, frame, finish: () => { c.update(cam, true); frame(); },
      hide: () => {}, alive: () => true,
      sceneDepth: () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(r, scenePass.renderTarget, frame) ?? 0; } finally { cam.layers.mask = m; } },
    }, {yieldFrame: () => Promise.resolve(), onProgress: p => { progress.push({...p}); }});
    expect(res.status).toBe('complete');
    expect(res.sceneDepth).toBe(1);
    expect(res.plan.items, 'the count shown is the representatives compiled').toBe(on.items.length);
    expect(res.plan.others).toBe(on.others.length);
    expect(res.stages.materials).toMatchObject({done: on.items.length, total: on.items.length});
    const materials = progress.filter(p => p.stage === 'materials');
    expect(materials.length).toBeGreaterThan(0);
    for (const p of materials) expect(p.stageTotal).toBe(on.items.length);
    expect(progress[progress.length - 1]).toMatchObject({stage: 'view', done: progress[progress.length - 1].total});
    // far fewer instanced node builds than pools (scene + shadow variants together), and at most one per representative and pass
    expect(n.instancedBuilds).toBeLessThanOrEqual(2 * instanced(on.items));
    expect(n.instancedBuilds).toBeLessThan(pools / 2);
    expect(sharedInstancingStats.missingTemplate).toBe(0);
    expect(sharedInstancingStats.releaseErrors).toBe(0);

    // 2. + 3. play: yaw sweeps at three poses, the torch lit
    const n0 = {...n};
    watching = true;
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
    watching = false;
    expect({builds: n.builds - n0.builds, renderObjects: n.renderObjects - n0.renderObjects, pipelines: n.pipelines - n0.pipelines, modules: n.modules - n0.modules})
      .toEqual({builds: 0, renderObjects: 0, pipelines: 0, modules: 0});
    expect(drawn.wrong).toEqual([]);
    expect(drawn.pools.size, 'many different pools were drawn on the shared path').toBeGreaterThan(100);
    expect(drawn.shared).toBeGreaterThan(1000);
    expect(drawn.sharedShadow, 'the torch shadow pass drew shared pools too').toBeGreaterThan(0);
    // the pools drawn in the sweeps that are NOT warm items any more: they were prepared by the hidden frames
    const items = new Set<THREE.Object3D>(on.items.map(i => i.object));
    expect([...drawn.pools].filter(p => !items.has(p)).length, 'pools that are no longer warm items were drawn').toBeGreaterThan(50);

    // printed (process.stdout): the plan with shared builds on / off, what the warm-up built, what the sweeps drew
    process.stdout.write(`shared-instancing-station: ${JSON.stringify({pools, keyedPools: keyedPools.length,
      plan: {on: {items: on.items.length, instanced: instanced(on.items), others: on.others.length}, off: {items: off.items.length, instanced: instanced(off.items), others: off.others.length}},
      warmup: {builds: n0.builds, instancedBuilds: n0.instancedBuilds, renderObjects: n0.renderObjects, pipelines: n0.pipelines, asyncPipelines: n0.asyncPipelines, modules: n0.modules, ms: Math.round(res.ms)},
      sweeps: {frames: poses.length * 9, sharedDraws: drawn.shared, sharedShadowDraws: drawn.sharedShadow, keyedDraws: drawn.keyed, poolsDrawn: drawn.pools.size, notWarmItems: [...drawn.pools].filter(p => !items.has(p)).length},
      layout: {maxBuffers: n.maxBuffers, maxAttributes: n.maxAttributes}, stats: {...sharedInstancingStats}})}\n`);

    // 4. the budget, and a clean device
    expect(n.maxBuffers).toBeLessThanOrEqual(VERTEX_LIMITS.buffers);
    expect(n.maxAttributes).toBeLessThanOrEqual(VERTEX_LIMITS.attributes);
    expect(v.log.issues).toEqual([]);
  }, 900_000);

  it('the game installs it once per renderer and turns it on for every level; the journey prepares the pools that are not representatives', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    const from = src.indexOf('  initRenderer(): Promise<GpuInfo> {'), to = src.indexOf('this.overlay.target.samples = this.renderer.samples;');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const init = src.slice(from, to);
    expect(init).toContain('installSharedInstancing(this.renderer);');
    expect(init).toContain('setSharedInstancing(true);');
    expect(src.match(/installSharedInstancing\(/g)?.length).toBe(1);
    expect(src.match(/setSharedInstancing\(/g)?.length, 'no level turns it off').toBe(1);
    // the journey route (no loading screen): in 'full' mode its job prepares plan.others too — scene pass and shadow variants
    const bg = src.slice(src.indexOf('private async backgroundCompile('), src.indexOf('// --- end campaign (primary)'));
    expect(bg).toContain("const items = [...byNear(plan.items), ...(mode === 'full' ? byNear(plan.others) : [])];");
    expect(bg).toContain('[...plan.items, ...plan.others].filter(i => i.caster)');
  });
});
