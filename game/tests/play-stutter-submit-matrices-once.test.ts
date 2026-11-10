// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY, user: "better performance, especially stuttering"): the station
// scene's world matrices once per frame (render/sceneMatrices.ts drawWithSceneMatricesOnce, Game.drawFrame around the atmosphere's
// render). three r186 updates a scene's world matrices at the start of every render of it — the scene pass and the flashlight's
// shadow pass nested inside it — although nothing moves between them. Pinned on three's REAL WebGPURenderer (no-op device) with the
// game's draw path (a pass in a RenderPipeline, the torch's shadow pass): objects moving every frame (an animated parent and child,
// a hand-updated static mesh, an InstancedMesh, a skinned mesh) draw exactly the same draws with exactly the same world matrices as
// three's own per-pass update — the once-updated frame drawn FIRST after each move, so it is its own update that the comparison
// checks — and the scene is traversed once a frame instead of once per pass. The automatic update is restored after the render,
// also when it throws. (The A / B timing — Mall t3a -9.0 / -9.3 %, Subway 7 -2.1 to -4.8 % of three's JavaScript per frame, Node — is
// a scratch measurement, not pinned: no timing assertions here.)
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {installShadowAlphaTwin} from '../src/render/shadowOverride';
import {drawWithSceneMatricesOnce} from '../src/render/sceneMatrices';

afterAll(() => vi.unstubAllGlobals());

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
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
  cam.rotation.order = 'YXZ';
  scene.add(cam, new THREE.HemisphereLight(0x9aa4b0, 0x2a2622, 0.4));
  const torch = new THREE.SpotLight(0xfff4e2, 2, 30, 0.58, 0.7, 1.2);
  torch.position.set(0.2, -0.15, 0.1); torch.target.position.set(0.04, -0.12, -6); torch.castShadow = true; torch.shadow.mapSize.set(256, 256);
  cam.add(torch, torch.target);
  const lit = <T extends THREE.Mesh>(o: T, name: string) => { o.castShadow = true; o.receiveShadow = true; o.name = name; return o; };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const floor = lit(new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({color: 0x333333})), 'floor');
  floor.rotation.x = -Math.PI / 2;
  // a static world root (matrices by hand, as the game's world group), a moving holder-like parent with a hinged child, an
  // InstancedMesh, a skinned mesh posed per frame
  const world = new THREE.Group();
  world.name = 'world';
  world.matrixAutoUpdate = false;
  const wall = lit(new THREE.Mesh(box, new THREE.MeshStandardMaterial({color: 0x777777})), 'wall');
  wall.position.set(0, 1, -5); wall.matrixAutoUpdate = false; wall.updateMatrix();
  world.add(floor, wall);
  const holder = lit(new THREE.Mesh(box, new THREE.MeshStandardMaterial({color: 0x886644})), 'holder');
  holder.position.set(2, 0.5, -3);
  const door = lit(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.05), new THREE.MeshStandardMaterial({color: 0x664422})), 'door');
  door.position.set(0.3, 0, 0.5);
  holder.add(door);
  const batch = lit(new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({color: 0x557799}), 4), 'batch');
  for (let i = 0; i < 4; i++) batch.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-2 + i * 0.6, 0.3, -2.5));
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[1].position.y = 0.8;
  bones[0].add(bones[1]);
  const sk = new THREE.BoxGeometry(0.3, 1.6, 0.3, 1, 4, 1);
  const pos = sk.attributes.position;
  const idx: number[] = [], wt: number[] = [];
  for (let i = 0; i < pos.count; i++) { const up = pos.getY(i) > 0 ? 1 : 0; idx.push(up, 0, 0, 0); wt.push(1, 0, 0, 0); }
  sk.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  sk.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  const body = lit(new THREE.SkinnedMesh(sk, new THREE.MeshStandardMaterial({color: 0x998877})), 'body');
  body.add(bones[0]);
  body.bind(new THREE.Skeleton(bones));
  body.position.set(-1, 0.8, -3);
  scene.add(world, holder, batch, body);
  const scenePass = TSL.pass(scene, cam, {samples: 4}) as unknown as {renderTarget: unknown};
  const pipe = new W.RenderPipeline(r, scenePass as never);
  const R = r as unknown as {_nodes: {nodeFrame: {update(): void}}; backend: {draw: (ro: {object: THREE.Object3D; material: THREE.Material}, info: unknown) => unknown}};
  const frame = () => { r.info.reset(); R._nodes.nodeFrame.update(); r.setRenderTarget(null); pipe.render(); };
  /** One frame's draws in order: pass, object, material and the drawn object's world matrix (and a skinned mesh's bone matrices). */
  const record = (draw: () => void): string[] => {
    const out: string[] = [];
    const inner = R.backend.draw;
    R.backend.draw = function (this: unknown, ro, info) {
      const shadow = (scene.overrideMaterial as {isShadowPassMaterial?: boolean} | null)?.isShadowPassMaterial === true;
      const o = ro.object as THREE.SkinnedMesh;
      out.push(`${shadow ? 'S' : 'M'}|${o.name}|${ro.material.name || ro.material.type}|${o.matrixWorld.elements.join(',')}${o.isSkinnedMesh ? `|${Array.from(o.skeleton.boneMatrices ?? []).join(',')}` : ''}`);
      return inner.call(this, ro, info);
    };
    try { draw(); } finally { R.backend.draw = inner; }
    return out;
  };
  /** Moves everything that moves (frame `f`): the camera turns back and forth, the holder slides, its door swings, a bone bends, the body walks. */
  const move = (f: number) => {
    cam.position.set(Math.sin(f * 0.1) * 0.5, 1.62, 0);
    cam.rotation.set(-0.05, Math.sin(f * 0.2) * 0.5, 0); // (turning, every object stays in view)
    holder.position.x = 2 + Math.sin(f * 0.3) * 0.4;
    door.rotation.y = f * 0.07;
    bones[1].rotation.z = Math.sin(f * 0.2) * 0.6;
    body.position.z = -3 - f * 0.02;
    batch.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-2, 0.3 + f * 0.01, -2.5));
    batch.instanceMatrix.needsUpdate = true;
    // a static mesh moved by hand (matrixAutoUpdate off: its owner updates the local matrix, the scene update its world matrix)
    wall.position.x = Math.sin(f * 0.05); wall.updateMatrix();
  };
  return {r, scene, cam, holder, door, body, frame, record, move};
}

describe('drawWithSceneMatricesOnce (render/sceneMatrices.ts)', () => {
  it('the same draws with the same world matrices as three\'s per-pass update, frame after frame of motion; one traversal a frame', async () => {
    const k = await rig();
    for (let f = 0; f < 4; f++) { k.move(f); k.frame(); } // (settle: first-frame builds)
    let traversals = 0;
    const inner = k.scene.updateMatrixWorld.bind(k.scene);
    k.scene.updateMatrixWorld = (force?: boolean) => { traversals++; inner(force); };
    const counts: {once: number; plain: number}[] = [];
    let compared = 0, shadowDraws = 0;
    const drawn = new Set<string>();
    for (let f = 4; f < 28; f++) {
      k.move(f);
      // the once-updated frame FIRST after the move: its own single update must give the matrices three's update gives
      traversals = 0;
      const once = k.record(() => drawWithSceneMatricesOnce(k.scene, k.frame));
      const t1 = traversals;
      expect(k.scene.matrixWorldAutoUpdate).toBe(true); // (restored)
      traversals = 0;
      const plain = k.record(k.frame);
      counts.push({once: t1, plain: traversals});
      expect(once, `frame ${f}`).toEqual(plain);
      compared++; shadowDraws += plain.filter(d => d.startsWith('S|')).length;
      for (const d of plain) drawn.add(d.split('|')[1]);
    }
    expect(compared).toBe(24);
    expect(shadowDraws).toBeGreaterThan(0); // (the shadow pass drew: the second render of the scene within the frame is covered)
    expect([...drawn].filter(n => n !== 'Render Pipeline').sort()).toEqual(['batch', 'body', 'door', 'floor', 'holder', 'wall']); // (every moving kind drawn and compared; + the pipeline's output quad)
    // three's own update runs once per render of the scene (the scene pass and its nested shadow pass); the helper's once
    for (const c of counts) { expect(c.plain).toBeGreaterThanOrEqual(2); expect(c.once).toBe(1); }
  }, 120_000);

  it('restores the automatic update when the render throws; leaves a scene that manages its own matrices alone', () => {
    const scene = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(m);
    m.position.set(1, 2, 3);
    expect(() => drawWithSceneMatricesOnce(scene, () => { expect(scene.matrixWorldAutoUpdate).toBe(false); throw new Error('render failed'); })).toThrow('render failed');
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    expect(m.matrixWorld.elements.slice(12, 15)).toEqual([1, 2, 3]); // (updated before the draw)
    expect(drawWithSceneMatricesOnce(scene, () => 7)).toBe(7);
    // a scene whose automatic update is already off: no update, the flag untouched
    scene.matrixWorldAutoUpdate = false;
    m.position.set(4, 5, 6);
    let seen = true;
    drawWithSceneMatricesOnce(scene, () => { seen = scene.matrixWorldAutoUpdate; });
    expect(seen).toBe(false);
    expect(scene.matrixWorldAutoUpdate).toBe(false);
    expect(m.matrixWorld.elements.slice(12, 15)).toEqual([1, 2, 3]);
  });

  it('Game.drawFrame draws the atmosphere through it (the direct fallback path keeps three\'s own update)', () => {
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('  private drawFrame(): void {'), src.indexOf('  private renderDirect(): void {'));
    expect(body).toContain('drawWithSceneMatricesOnce(this.scene, () => this.atmosphere.render(this.scene, this.camera, this.time));');
    expect(body.match(/drawWithSceneMatricesOnce/g)).toHaveLength(1);
  });
});
