// Lane RENDER-CPU probes (env-gated LL_RCPU_PROBE=1): (1) the no-op-device WebGPURenderer runs the spot-light shadow pass;
// (2) does compileAsync into a PassNode's target prepare what that pass draws inside a RenderPipeline (nested render)?
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';

afterAll(() => vi.unstubAllGlobals());
describe.skipIf(!process.env.LL_RCPU_PROBE)('probe', () => {
  it('compileAsync vs a nested scene pass', async () => {
    const canvas = stubWebgpuGlobals();
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const r = new W.WebGPURenderer({canvas});
    await r.init();
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
    scene.add(cam);
    scene.add(new THREE.HemisphereLight());
    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(), new W.MeshStandardNodeMaterial({color: 0x808080, roughness: i / 6, metalness: i % 2, flatShading: i % 3 === 0}));
      m.position.set(i - 3, 0, -4);
      scene.add(m); meshes.push(m);
    }
    const R = r as unknown as {backend: {createNodeBuilder: (...a: unknown[]) => unknown}; _nodes: {nodeFrame: {update(): void}}};
    let builds = 0;
    const cnb = R.backend.createNodeBuilder.bind(R.backend);
    R.backend.createNodeBuilder = (...a: unknown[]) => { builds++; return cnb(...a); };
    const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
    const pipe = new W.RenderPipeline(r, scenePass as never);
    const lines: string[] = [];
    // compile into the pass's own target, as render/warmup.ts does (Game: atmosphere.warmTarget)
    r.setRenderTarget(scenePass.renderTarget as never);
    await r.compileAsync(scene, cam);
    r.setRenderTarget(null);
    lines.push(`compileAsync into the pass target: builds ${builds}`);
    let b0 = builds;
    R._nodes.nodeFrame.update();
    pipe.render();
    lines.push(`first pipeline frame: builds ${builds - b0}`);
    b0 = builds;
    R._nodes.nodeFrame.update();
    pipe.render();
    lines.push(`second pipeline frame: builds ${builds - b0}`);
    const ctx = (r as unknown as {_renderContexts: {_renderContexts: Record<string, {id: number}>}})._renderContexts._renderContexts;
    lines.push(`render contexts: ${Object.entries(ctx).map(([k, v]) => `${k}=#${v.id}`).join(' | ')}`);
    writeFileSync('/tmp/rcpu-probe2.txt', lines.join('\n') + '\n');
    expect(builds).toBeGreaterThan(0);
  });
});
