// Task mall-horde-performance-20261105 investigation harness (env-gated: LL_RCPU_HORDE_OUT=/tmp/x.txt): three r186's real
// WebGPURenderer (no-op device) drawing the real mall (the game's nested RenderPipeline pass, the torch casting) after the real
// warm-up, the camera on the densest enemy cluster: render CPU per frame with the enemies static vs animated (the game's
// animate + updateVolumes path), looking at them vs away, and a CPU profile of the animated view (self time per function).
import {appendFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {gpuCalls, resetGpuCalls, stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {realMallScene, startPose} from './helpers/rendercpuMall';
import {WarmupRegistry, runWarmup, type WarmupRenderer} from '../src/render/warmup';
import {DamageSystem} from '../src/damage/system';
import {installUploadDedupe, uploadStats} from '../src/render/uploadDedupe';

const OUT = process.env.LL_RCPU_HORDE_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
const SEED = process.env.LL_RCPU_SEED ?? 't3a';
afterAll(() => vi.unstubAllGlobals());

describe.skipIf(!OUT)('RENDER-CPU: horde view cost (no-op device)', () => {
  it('static vs animated enemies, looking at vs away; CPU profile of the animated view', async () => {
    writeFileSync(OUT!, '');
    const canvas = stubWebgpuGlobals();
    // (upload bytes: the fake queue's writeBuffer is fixed, so the device handed to three gets a queue proxy that measures them)
    let wbBytes = 0;
    const wbBy = new Map<number, number>();
    const gpu = (globalThis.navigator as unknown as {gpu: {requestAdapter: () => Promise<{requestDevice: () => Promise<Record<string, unknown>>}>}}).gpu;
    const ra = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async () => {
      const ad = await ra();
      return {...ad, requestDevice: async () => {
        const dv = await ad.requestDevice(), q = dv.queue as Record<string, (...a: unknown[]) => unknown>;
        const qp = new Proxy(q, {get: (_t, k) => k === 'writeBuffer' ? (...a: unknown[]) => {
          const data = a[2] as ArrayBufferView, el = (data as unknown as {BYTES_PER_ELEMENT?: number}).BYTES_PER_ELEMENT ?? 1;
          const bytes = typeof a[4] === 'number' ? (a[4] as number) * el : data.byteLength;
          wbBytes += bytes; wbBy.set(bytes, (wbBy.get(bytes) ?? 0) + 1);
          return q.writeBuffer(...a);
        } : q[k as string]});
        return new Proxy(dv, {get: (_t, k) => k === 'queue' ? qp : dv[k as string]});
      }};
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const W = await import('three/webgpu'), TSL = await import('three/tsl');
    const renderer = new W.WebGPURenderer({canvas, antialias: true});
    await renderer.init();
    (await import('../src/render/shadowOverride')).installShadowAlphaTwin(renderer);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const M = await realMallScene(SEED);
    const scene = M.scene, c = M.world.culler, cm = M.cm;
    scene.add(new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.35));
    // the game's per-actor wound materials (Game.spawnEnemy -> DamageSystem.installZombie)
    if (!process.env.LL_RCPU_NO_WOUNDS) { const damage = new DamageSystem(null, null); for (const e of M.enemies) damage.installZombie(e as never); }
    // the densest enemy cluster: the enemy with the most others within 8 m (same storey)
    const E = M.enemies;
    const near = (a: typeof E[number], b: typeof E[number]) => Math.hypot(a.brain.x - b.brain.x, a.brain.z - b.brain.z) < 8 && Math.abs(a.brain.y - b.brain.y) < 2;
    const hub = E.map(e => ({e, n: E.filter(o => near(e, o)).length})).sort((a, b) => b.n - a.n)[0];
    out(`enemies ${E.length}; densest cluster ${hub.n} within 8 m; meshes per enemy ${E.map(e => { let k = 0; e.root.traverse(o => { if ((o as THREE.Mesh).isMesh) k++; }); return k; }).join(',')}`);
    const cluster = E.filter(o => near(hub.e, o));
    const cx = cluster.reduce((s, e) => s + e.brain.x, 0) / cluster.length, cz = cluster.reduce((s, e) => s + e.brain.z, 0) / cluster.length, cy = hub.e.brain.y;
    const sp = startPose(M.layout);
    let dx = sp.x - cx, dz = sp.z - cz;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 220);
    cam.position.set(cx + dx * 9, cy + 1.62, cz + dz * 9);
    let lookYaw = Math.atan2(cx - cam.position.x, cz - cam.position.z) + Math.PI; // (three cameras look down -Z)
    // LL_RCPU_POSE="x,y,z,yawDeg" (feet position; the player's yaw): a recorded pose instead of the densest cluster (local use only)
    const pose = process.env.LL_RCPU_POSE?.split(',').map(Number);
    if (pose && pose.length >= 4 && pose.every(Number.isFinite)) { cam.position.set(pose[0], pose[1] + 1.62, pose[2]); lookYaw = pose[3] * Math.PI / 180; out('pose: recorded (env)'); }
    cam.rotation.set(-0.05, lookYaw, 0, 'YXZ');
    scene.add(cam);
    const fl = new THREE.SpotLight(0xfff4e2, 1, 30, 0.58, 0.7, 1.2);
    fl.position.set(0.2, -0.15, 0.1);
    fl.target.position.set(0.04, -0.12, -6);
    fl.castShadow = true;
    fl.shadow.mapSize.set(1024, 1024);
    fl.shadow.camera.near = 0.2;
    cam.add(fl, fl.target);
    c.viewpoints = [fl];
    const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: THREE.RenderTarget};
    const pipe = new W.RenderPipeline(renderer, scenePass as never);
    const rt = scenePass.renderTarget;
    const {renderContextDepth} = await import('../src/render/renderContextDepth');
    const nodeFrame = (renderer as unknown as {_nodes: {nodeFrame: {update(): void}}})._nodes.nodeFrame;
    const frame = () => { renderer.info.reset(); nodeFrame.update(); renderer.setRenderTarget(null); pipe.render(); };
    cam.updateMatrixWorld(true);
    (cm as unknown as {lastEye: THREE.Vector3}).lastEye.copy(cam.position);
    (cm as unknown as {dirty: boolean}).dirty = true;
    cm.update(0.2, 0);
    c.update(cam, true);
    const reg = new WarmupRegistry();
    if (M.liftRoot) reg.addPool('tower', () => [M.liftRoot!]);
    reg.addPool('holders', () => [cm.group]);
    const probe = () => { const m = cam.layers.mask; cam.layers.mask = 0; try { return renderContextDepth(renderer, rt, frame) ?? 0; } finally { cam.layers.mask = m; } };
    const res = await runWarmup({
      renderer: renderer as unknown as WarmupRenderer, scene, camera: cam, mode: 'full', registry: reg,
      sceneTarget: () => rt, torch: fl, torchIntensity: 1, frame, finish: () => { c.update(cam, true); frame(); }, hide: () => {}, alive: () => true, sceneDepth: probe,
    }, {yieldFrame: () => Promise.resolve()});
    out(`warm-up ${res.status}`);
    let moveT = 0;
    const animateAll = (anim: 'Walk' | 'Idle' | 'Move') => {
      moveT++;
      for (const e of E) {
        if (anim === 'Move') { e.brain.x += Math.sin(moveT * 0.05 + e.brain.z) * 0.01; e.brain.z += Math.cos(moveT * 0.05) * 0.01; e.brain.yaw += 0.01; }
        e.animate(1 / 60, anim === 'Move' ? 'Walk' : anim, 0.5); e.syncTransform(); e.updateVolumes();
      }
    };
    const visibleEnemyMeshes = () => {
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let n = 0;
      for (const e of E) e.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.visible && (m.layers.mask & cam.layers.mask) && fr.intersectsObject(m)) n++; });
      return n;
    };
    const measure = (label: string, yaw: number, anim: 'static' | 'Walk' | 'Move', frames = 40) => {
      cam.rotation.set(-0.05, yaw, 0, 'YXZ');
      cam.updateMatrixWorld(true);
      c.update(cam, true);
      for (let i = 0; i < 6; i++) { if (anim !== 'static') animateAll(anim); frame(); } // (settle: any remaining first use)
      const ms: number[] = [], an: number[] = [];
      resetGpuCalls(); wbBytes = 0; wbBy.clear();
      for (let i = 0; i < frames; i++) {
        const a0 = performance.now();
        if (anim !== 'static') animateAll(anim);
        const a1 = performance.now();
        c.update(cam);
        frame();
        ms.push(performance.now() - a1);
        an.push(a1 - a0);
      }
      ms.sort((a, b) => a - b); an.sort((a, b) => a - b);
      const info = renderer.info.render as unknown as {drawCalls?: number; calls?: number; triangles?: number};
      const per = (k: string) => ((gpuCalls.get(k) ?? 0) / frames).toFixed(0);
      out(`  ${label} all calls per frame: ${[...gpuCalls.entries()].filter(([k]) => !/^(draw|drawIndexed|setBindGroup|setVertexBuffer|setPipeline|writeBuffer)$/.test(k)).map(([k, v]) => `${k} ${(v / frames).toFixed(2)}`).join(', ')}`);
      out(`  ${label} per frame: writeBuffer ${per('writeBuffer')} (${(wbBytes / frames / 1024).toFixed(1)} KiB; sizes ${[...wbBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b, n]) => `${b}B x${(n / frames).toFixed(0)}`).join(' ')}) · setBindGroup ${per('setBindGroup')} · draw ${per('draw')} + drawIndexed ${per('drawIndexed')} · setPipeline ${per('setPipeline')} · setVertexBuffer ${per('setVertexBuffer')} · submit ${per('submit')} · beginRenderPass ${per('beginRenderPass')}`);
      out(`${label}: render median ${ms[ms.length >> 1].toFixed(2)} ms p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(2)} · animate+volumes median ${an[an.length >> 1].toFixed(2)} ms · draws ${info.drawCalls ?? info.calls} · triangles ${info.triangles} · enemy skinned meshes in view ${visibleEnemyMeshes()}`);
      return ms[ms.length >> 1];
    };
    const at = lookYaw, away = lookYaw + Math.PI;
    const at_ = at, away_ = away;
    const runSet = (tag: string) => {
      const r: Record<string, number> = {};
      for (const [yn, y] of [['A', at_], ['B', away_]] as const) for (const mode of ['static', 'Walk', 'Move'] as const) r[`${yn}.${mode}`] = measure(`${tag} yaw ${yn}, ${mode === 'static' ? 'static' : mode === 'Walk' ? 'animated in place' : 'moving + animated'}`, y, mode);
      return r;
    };
    const before = runSet('PLAIN');
    for (const e of E) e.root.visible = false;
    measure('PLAIN yaw A, enemies HIDDEN', at, 'static');
    measure('PLAIN yaw B, enemies HIDDEN', away, 'static');
    for (const e of E) e.root.visible = true;
    // A/B: the upload dedupe (render/uploadDedupe.ts) installed on the same renderer, the same views
    expect(installUploadDedupe(renderer)).toBe(true);
    const after = runSet('DEDUPE');
    out(`render median ms plain -> dedupe: ${Object.keys(before).map(k => `${k} ${before[k].toFixed(2)} -> ${after[k].toFixed(2)}`).join(' · ')}; stats ${JSON.stringify(uploadStats)}`);
    // CPU profile of the animated horde view (frames only: the animate call is outside the profiled section)
    if (process.env.LL_RCPU_PROFILE) {
      cam.rotation.set(-0.05, away, 0, 'YXZ');
      cam.updateMatrixWorld(true);
      const session = new Session();
      session.connect();
      await session.post('Profiler.enable');
      await session.post('Profiler.setSamplingInterval', {interval: 100});
      await session.post('Profiler.start');
      for (let i = 0; i < 60; i++) { animateAll('Walk'); c.update(cam); frame(); }
      const {profile} = await session.post('Profiler.stop') as {profile: {nodes: {id: number; callFrame: {functionName: string; url: string; lineNumber: number}; hitCount: number; children?: number[]}[]; samples: number[]; timeDeltas: number[]}};
      session.disconnect();
      const self = new Map<string, number>();
      let total = 0;
      for (const nd of profile.nodes) {
        const f = nd.callFrame, file = f.url.split('/').slice(-1)[0] || '(native)';
        const k = `${f.functionName || '(anon)'} @ ${file}:${f.lineNumber + 1}`;
        self.set(k, (self.get(k) ?? 0) + nd.hitCount);
        total += nd.hitCount;
      }
      out(`profile: ${total} samples (100 us), top self time:`);
      for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45)) out(`  ${(100 * v / total).toFixed(1).padStart(5)} %  ${k}`);
      // inclusive time for selected three entry points
      const byId = new Map(profile.nodes.map(nd => [nd.id, nd]));
      const incl = new Map<number, number>();
      const visit = (id: number): number => { const nd = byId.get(id)!; let s = nd.hitCount; for (const ch of nd.children ?? []) s += visit(ch); incl.set(id, s); return s; };
      for (const nd of profile.nodes) if (!incl.has(nd.id)) visit(nd.id);
      const inclBy = new Map<string, number>();
      for (const nd of profile.nodes) { const k = nd.callFrame.functionName || '(anon)'; inclBy.set(k, Math.max(inclBy.get(k) ?? 0, incl.get(nd.id)!)); }
      out('inclusive (max per name):');
      for (const name of ['render', '_renderScene', '_renderObjects', 'renderObject', '_renderObjectDirect', 'updateForRender', 'getForRender', 'update', 'updateBefore', 'updateAfter', 'draw', 'updateBindings', 'updateUniform', 'needsUpdate', 'getCacheKey', 'getDynamicCacheKey', 'getMaterialCacheKey', 'getRenderObject', 'get', 'update', 'computeBoundingSphere', 'intersectsObject', 'updateMatrixWorld', '_projectObject'])
        if (inclBy.has(name)) out(`  ${(100 * inclBy.get(name)! / total).toFixed(1).padStart(5)} %  ${name}`);
    }
    expect(res.status).toBe('complete');
  }, 1_500_000);
});
