// Iteration 14 (primary): loading-screen rendering warm-up (render/warmup.ts) — discovery, the reusable registry
// (USER-UPDATE-01: future assets / passes), lifecycle (restore, budget, cancel, failure, progress), the readiness call for
// content added later, and the per-station GPU-release deferral (USER-UPDATE-02). No GPU: a fake renderer whose
// compileAsync PROJECTS the scene like three r186 (invisible subtrees skipped, layer test, frustum test unless
// frustumCulled is off), so what would actually be compiled is checked.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {
  WARMUP_DEFAULTS, WarmupRegistry, geometryKey, planWarmup, prepareObjects, runWarmup, warmKeys, warmupLabel, warmupNote,
  type WarmupHost, type WarmupProgress, type WarmupRenderer,
} from '../src/render/warmup';
import {CULL_LAYER} from '../src/world/levelCulling';
import {warmupMode} from '../src/game';
import {generateStation, type StationLayout} from '../src/gen/station';
import {StationLighting} from '../src/world/lights';
import type {Fixture} from '../src/world/builder';

const cullLayers = (o: THREE.Object3D) => { o.layers.set(CULL_LAYER); return o; };

/** three r186 Renderer._projectObject, structurally. */
function project(root: THREE.Object3D, camera: THREE.Camera): THREE.Object3D[] {
  camera.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const out: THREE.Object3D[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o.visible === false) return;
    if (o.layers.test(camera.layers)) {
      const r = o as THREE.Mesh;
      if (r.isMesh || (r as unknown as THREE.Points).isPoints || (r as unknown as THREE.Line).isLine) { if (!o.frustumCulled || fr.intersectsObject(r)) out.push(o); }
      else if ((o as THREE.Sprite).isSprite) { if (!o.frustumCulled || fr.intersectsSprite(o as THREE.Sprite)) out.push(o); }
    }
    for (const c of o.children) walk(c);
  };
  root.updateMatrixWorld(true);
  walk(root);
  return out;
}

interface Call { target: unknown; mrt: unknown; scene: THREE.Object3D; objects: THREE.Object3D[]; visibleDuring: Map<THREE.Object3D, boolean> }
class FakeRenderer implements WarmupRenderer {
  target: unknown = 'canvas';
  mrt: unknown = 'mrt-before';
  calls: Call[] = [];
  failAt = -1;
  watch: THREE.Object3D[] = [];
  compileAsync(scene: THREE.Object3D, camera: THREE.Camera, _t?: THREE.Scene | null, onProgress?: ((e: {loaded: number; total: number}) => void) | null): Promise<void> {
    const objects = project(scene, camera);
    this.calls.push({target: this.target, mrt: this.mrt, scene, objects, visibleDuring: new Map(this.watch.map(o => [o, o.visible]))});
    if (this.calls.length - 1 === this.failAt) return Promise.reject(new Error('pipeline creation failed'));
    return (async () => { for (let i = 0; i < objects.length; i++) { await Promise.resolve(); onProgress?.({loaded: i + 1, total: objects.length}); } })();
  }
  getRenderTarget() { return this.target; }
  setRenderTarget(t: unknown) { this.target = t; }
  getMRT() { return this.mrt; }
  setMRT(m: unknown) { this.mrt = m; }
}

const box = () => new THREE.BoxGeometry(1, 1, 1);
const std = (c = 0x808080) => new THREE.MeshStandardMaterial({color: c});
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, z = -6) => { const o = new THREE.Mesh(g, m); o.position.set(x, 0, z); return o; };

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  c.position.set(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

/** A small "station": shared-material walls, an instanced mesh, a culled far room, an off-frustum mesh, a skinned actor, pools. */
function station() {
  const scene = new THREE.Scene();
  const world = new THREE.Group(); world.name = 'station';
  scene.add(world);
  const wallMat = std(0x777777), floorMat = std(0x333333);
  const g = box();
  const walls = [0, 1, 2, 3].map(i => mesh(g, wallMat, i * 2 - 3)); // 4 walls, ONE group
  const floor = mesh(g, floorMat, 0, -8);
  const inst = new THREE.InstancedMesh(box(), wallMat, 4); inst.position.set(0, 0, -10);
  const inst2 = new THREE.InstancedMesh(box(), wallMat, 4); inst2.position.set(1, 0, -10); // same material: still its own group
  const farRoom = cullLayers(mesh(box(), std(0x224466), 0, -40)); // hidden by the level / fog culler
  const behind = mesh(box(), std(0x446622), 0, 6); // behind the camera: off-frustum
  const other = mesh(box(), std(0x999999)); other.layers.set(5); // a layer the camera never renders
  const hiddenUnpooled = mesh(box(), std(0xaaaaaa)); hiddenUnpooled.visible = false; // not a pool: never warmed
  for (const o of [...walls, floor, inst, inst2, farRoom, behind, other, hiddenUnpooled]) o.castShadow = o.receiveShadow = true;
  world.add(...walls, floor, inst, inst2, farRoom, behind, other, hiddenUnpooled);
  // skinned actor (own group from the bones)
  const sg = box();
  sg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(sg.attributes.position.count * 4).fill(0), 4));
  sg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(sg.attributes.position.count * 4).fill(0.25), 4));
  const bones = [new THREE.Bone(), new THREE.Bone()]; bones[0].add(bones[1]);
  const actor = new THREE.SkinnedMesh(sg, std(0x553322)); actor.add(bones[0]); actor.bind(new THREE.Skeleton(bones)); actor.position.set(2, 0, -5);
  actor.castShadow = true;
  scene.add(actor);
  // effect pool: visible root, hidden sprite / decal
  const fx = new THREE.Group(); fx.name = 'fx';
  const sparks = new THREE.Sprite(new THREE.SpriteMaterial({color: 0xffaa00})); sparks.visible = false;
  const decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({transparent: true}), 32); decals.count = 0; decals.visible = false;
  fx.add(sparks, decals);
  scene.add(fx);
  // prototype pool: INVISIBLE root with a hidden intermediate group (the planner must flip the whole chain)
  const proto = new THREE.Group(); proto.visible = false;
  const protoInner = new THREE.Group(); protoInner.visible = false;
  const protoMesh = mesh(box(), std(0xff2200)); protoInner.add(protoMesh); proto.add(protoInner);
  scene.add(proto);
  const light = new THREE.SpotLight(0xffffff, 0); light.castShadow = true;
  scene.add(light);
  return {scene, world, walls, floor, inst, inst2, farRoom, behind, other, hiddenUnpooled, actor, fx, sparks, decals, proto, protoInner, protoMesh, light};
}

function registryFor(s: ReturnType<typeof station>, extra?: (r: WarmupRegistry) => void): WarmupRegistry {
  const r = new WarmupRegistry();
  r.addPool('effects', () => [s.fx]);
  r.addPool('prototypes', () => [s.proto]);
  extra?.(r);
  return r;
}

interface HostLog { frames: THREE.Object3D[][]; hide: boolean[]; finished: number; torchDuringFrames: number[] }
function hostFor(s: ReturnType<typeof station>, r: FakeRenderer, o: Partial<WarmupHost> = {}): {host: WarmupHost; log: HostLog} {
  const cam = camera();
  s.scene.add(cam);
  const log: HostLog = {frames: [], hide: [], finished: 0, torchDuringFrames: []};
  const host: WarmupHost = {
    renderer: r, scene: s.scene, camera: cam, mode: 'full', registry: registryFor(s),
    sceneTarget: () => 'scene-pass-rt', torch: s.light, torchIntensity: 34,
    frame: () => { log.frames.push(project(s.scene, cam)); log.torchDuringFrames.push(s.light.intensity); },
    finish: () => { log.finished++; },
    hide: h => { log.hide.push(h); },
    alive: () => true,
    ...o,
  };
  return {host, log};
}

const state = (objs: THREE.Object3D[]) => objs.map(o => [o.layers.mask, o.visible, o.frustumCulled]);
const allObjects = (root: THREE.Object3D) => { const out: THREE.Object3D[] = []; root.traverse(o => { out.push(o); }); return out; };

// ---------------------------------------------------------------------------------------------
describe('warm-up discovery (planWarmup)', () => {
  it('one representative per three cache-key group; every InstancedMesh its own; culled / off-frustum included, other layers / hidden non-pools not', () => {
    const s = station();
    const plan = planWarmup(s.scene, {mode: 'full', cameraMask: 1, pools: [s.fx, s.proto]});
    const objs = plan.items.map(i => i.object);
    expect(objs.filter(o => (s.walls as THREE.Object3D[]).includes(o)).length).toBe(1); // 4 walls, same material + layout
    expect(objs).toEqual(expect.arrayContaining([s.floor, s.inst, s.inst2, s.farRoom, s.behind, s.actor, s.sparks, s.decals, s.protoMesh]));
    expect(objs).not.toContain(s.other);
    expect(objs).not.toContain(s.hiddenUnpooled);
    const proto = plan.items.find(i => i.object === s.protoMesh)!;
    expect(proto.flips).toEqual([s.proto, s.protoInner]); // the whole hidden chain inside the pool
    expect(proto.caster).toBe(false); // (castShadow off; lane RENDER-CPU: a pooled CASTER gets shadow frames too, its chain flipped)
    expect(plan.items.find(i => i.object === s.sparks)!.flips).toEqual([s.sparks]);
    expect(plan.items.find(i => i.object === s.floor)!.caster).toBe(true);
    // the plan only reads
    expect(s.farRoom.layers.mask).toBe(1 << CULL_LAYER >>> 0);
    expect(s.sparks.visible).toBe(false);
  });

  it('cache-key superset: skinning, shadow flags, geometry layout and material identity split groups', () => {
    const g = box(), m = std();
    const a = mesh(g, m), b = mesh(g, m);
    expect(warmKeys(a)).toEqual(warmKeys(b));
    b.receiveShadow = true;
    expect(warmKeys(a)).not.toEqual(warmKeys(b));
    const g2 = box(); g2.setAttribute('aWear', new THREE.Float32BufferAttribute(new Float32Array(g2.attributes.position.count), 1));
    expect(geometryKey(g2)).not.toBe(geometryKey(g));
    expect(warmKeys(mesh(g, std()))).not.toEqual(warmKeys(a)); // another material object
    const arr = new THREE.Mesh(g, [m, std()]);
    expect(warmKeys(arr).length).toBe(2);
  });

  it("'view' mode keeps the camera's neighbourhood (+ every pool) and leaves culled rooms", () => {
    const s = station();
    const plan = planWarmup(s.scene, {mode: 'view', cameraMask: 1, pools: [s.fx, s.proto], near: {center: new THREE.Vector3(0, 0, 0), radius: 12}});
    const objs = plan.items.map(i => i.object);
    expect(objs).toEqual(expect.arrayContaining([s.floor, s.inst, s.behind, s.sparks, s.protoMesh]));
    expect(objs).not.toContain(s.farRoom);
  });

  it('USER-UPDATE-01: an unfamiliar asset added through the normal scene path is covered with no warm-up change', () => {
    // a "future" asset: new geometry layout (custom attribute), a node material type nothing references today, an
    // instanced variant, a multi-material mesh, and a runtime material swap on an existing mesh (decay / damage clone)
    const s = station();
    const g = new THREE.CylinderGeometry(0.3, 0.3, 2, 12);
    g.setAttribute('aFutureWear', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    const futureMat = new MeshStandardNodeMaterial({color: 0x5a7a2a});
    const futureProp = mesh(g, futureMat, -2, -30); cullLayers(futureProp); futureProp.name = 'future-prop';
    const futureRack = new THREE.InstancedMesh(g, futureMat, 6); futureRack.position.set(3, 0, 9); // behind the camera
    const futureSign = new THREE.Mesh(box(), [std(0x112233), new THREE.MeshBasicMaterial({color: 0xffffff})]);
    futureSign.geometry.addGroup(0, 18, 0); futureSign.geometry.addGroup(18, 18, 1); futureSign.position.set(0, 0, -7);
    s.world.add(futureProp, futureRack, futureSign);
    const runtimeSwap = std(0x404040); s.walls[2].material = runtimeSwap; // the object's RUNTIME material is what counts
    const r = new FakeRenderer();
    const {host} = hostFor(s, r);
    return runWarmup(host, {yieldFrame: async () => {}}).then(res => {
      expect(res.status).toBe('complete');
      const compiled = new Set(r.calls.filter(c => c.target === 'scene-pass-rt').flatMap(c => c.objects));
      for (const o of [futureProp, futureRack, futureSign, s.walls[2]]) expect(compiled.has(o), o.name || o.type).toBe(true);
      expect(compiled.has(s.other)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('warm-up runner lifecycle (runWarmup)', () => {
  it('compiles every representative in the scene pass context, chunked; passes in their own; restores everything exactly', async () => {
    const s = station();
    const vmScene = new THREE.Scene(), vmCam = camera();
    const held = new THREE.Group(); held.visible = false;
    const rifle = mesh(box(), std(0x222222), 0, -1); held.add(rifle); vmScene.add(held);
    const r = new FakeRenderer();
    r.watch = [held, rifle, s.sparks, s.proto];
    const {host, log} = hostFor(s, r, {});
    host.registry = registryFor(s, reg => reg.addPass({name: 'weapons and held items', scene: vmScene, camera: vmCam, target: () => 'overlay-rt', hidden: () => [held]}));
    const everything = [...allObjects(s.scene), ...allObjects(vmScene)];
    const before = state(everything);
    const progress: WarmupProgress[] = [];
    const res = await runWarmup(host, {compileChunk: 3, frameChunk: 2, yieldFrame: async () => {}, onProgress: p => progress.push(p)});
    expect(res.status).toBe('complete');
    const plan = planWarmup(s.scene, {mode: 'full', cameraMask: 1, pools: [s.fx, s.proto]}); // (state restored => same plan)
    const sceneCalls = r.calls.filter(c => c.target === 'scene-pass-rt');
    expect(sceneCalls.length).toBe(Math.ceil(plan.items.length / 3));
    for (const c of sceneCalls) { expect(c.mrt).toBeNull(); expect(c.objects.length).toBeLessThanOrEqual(3); }
    const compiled = sceneCalls.flatMap(c => c.objects);
    expect(new Set(compiled)).toEqual(new Set(plan.items.map(i => i.object))); // each representative exactly in its chunk
    expect(compiled.length).toBe(plan.items.length);
    // pools were visible DURING their compile, hidden before and after
    const sparkCall = sceneCalls.find(c => c.objects.includes(s.sparks))!;
    expect(sparkCall.visibleDuring.get(s.sparks)).toBe(true);
    expect(sceneCalls.find(c => c.objects.includes(s.protoMesh))!.visibleDuring.get(s.proto)).toBe(true);
    // the overlay pass: own target, hidden held items visible for the call
    const vmCall = r.calls.find(c => c.target === 'overlay-rt')!;
    expect(vmCall.objects).toContain(rifle);
    expect(vmCall.visibleDuring.get(held)).toBe(true);
    expect(res.stages.passes).toMatchObject({done: 1, total: 1});
    // hidden frames, torch lit during them and restored after: the casters' shadow variants (task studio-performance-recorder-20261103,
    // lane RENDER-CPU RE-PIN: pooled casters too), then ('full') every other renderable once for its own render objects; chunked, and
    // every chunk holds a shadow RECEIVER (three draws a shadow map only when a receiver draws)
    const casters = plan.items.filter(i => i.caster).map(i => i.object);
    const others = plan.others.map(i => i.object);
    expect(others).toEqual(expect.arrayContaining(s.walls.filter(w => !casters.includes(w)))); // the walls the representative covers
    expect(log.frames.length).toBe(Math.ceil((casters.length + others.length) / 2));
    expect(new Set(log.frames.flat())).toEqual(new Set([...casters, ...others]));
    for (const f of log.frames) expect(f.some(o => o.receiveShadow)).toBe(true);
    expect(res.plan.others).toBe(others.length);
    expect(log.torchDuringFrames.every(v => v === 34)).toBe(true);
    expect(s.light.intensity).toBe(0);
    expect(log.hide).toEqual([true, false]);
    expect(log.finished).toBe(1);
    // exact restore + renderer state
    expect(state(everything)).toEqual(before);
    expect(r.target).toBe('canvas');
    expect(r.mrt).toBe('mrt-before');
    // truthful progress: monotonic, 100 % only at the very end
    for (let i = 1; i < progress.length; i++) expect(progress[i].done).toBeGreaterThanOrEqual(progress[i - 1].done);
    expect(progress.filter(p => p.done === p.total).map(p => p.stage)).toEqual(['view']);
    expect(res.stages.materials.done).toBe(res.stages.materials.total);
    expect(warmupNote(res)).toMatch(/^graphics prepared in /);
    expect(warmupLabel(progress[0])).toMatch(/^Preparing graphics · compiling materials \d+\/\d+$/);
  });

  it('time budget: stops between chunks, reports partial (never ready-complete), still restores and shows the real view', async () => {
    const s = station();
    const r = new FakeRenderer();
    let t = 0;
    const {host, log} = hostFor(s, r);
    const before = state(allObjects(s.scene));
    const progress: WarmupProgress[] = [];
    const res = await runWarmup(host, {compileChunk: 2, budgetMs: 1000, now: () => (t += 400), yieldFrame: async () => {}, onProgress: p => progress.push(p)});
    expect(res.status).toBe('partial');
    expect(res.reason).toMatch(/time budget/);
    expect(res.stages.materials.done).toBeLessThan(res.stages.materials.total);
    expect(log.frames.length).toBe(0); // no further stages once over budget
    expect(log.finished).toBe(1);
    expect(log.hide.at(-1)).toBe(false);
    expect(Math.max(...progress.map(p => p.done))).toBeLessThan(progress[0].total);
    expect(state(allObjects(s.scene))).toEqual(before);
    expect(warmupNote(res)).toMatch(/partly prepared/);
  });

  it('cancelled (station replaced / device lost): no further chunks, no final frame, state restored', async () => {
    const s = station();
    const r = new FakeRenderer();
    let alive = true;
    const {host, log} = hostFor(s, r, {alive: () => alive});
    const before = state(allObjects(s.scene));
    const res = await runWarmup(host, {compileChunk: 2, yieldFrame: async () => {}, onProgress: p => { if (p.stage === 'materials' && p.stageDone >= 2) alive = false; }});
    expect(res.status).toBe('cancelled');
    expect(r.calls.length).toBe(1);
    expect(log.finished).toBe(0);
    expect(log.hide.at(-1) ?? false).toBe(false);
    expect(state(allObjects(s.scene))).toEqual(before);
    expect(r.target).toBe('canvas');
  });

  it('a failing compile is reported as failed (not ready), restores state and the render target, and the real view still renders', async () => {
    const s = station();
    const r = new FakeRenderer();
    r.failAt = 1;
    const {host, log} = hostFor(s, r);
    const before = state(allObjects(s.scene));
    const res = await runWarmup(host, {compileChunk: 2, yieldFrame: async () => {}});
    expect(res.status).toBe('failed');
    expect(res.reason).toMatch(/pipeline creation failed/);
    expect(state(allObjects(s.scene))).toEqual(before);
    expect(r.target).toBe('canvas');
    expect(r.mrt).toBe('mrt-before');
    expect(log.finished).toBe(1);
    expect(warmupNote(res)).toMatch(/failed/);
  });

  it('no flashlight shadow (quality off): no shadow frames (\'full\' still draws the non-representatives once; \'view\' nothing); registry names reported', async () => {
    // (task studio-performance-recorder-20261103, lane RENDER-CPU RE-PIN: 'full' draws every renderable a representative covers once,
    // for its own render objects; without the torch shadow those frames are all there is, and no caster-only frame is added)
    const s = station();
    s.light.castShadow = false;
    const r = new FakeRenderer();
    const {host, log} = hostFor(s, r);
    const res = await runWarmup(host, {yieldFrame: async () => {}});
    const plan = planWarmup(s.scene, {mode: 'full', cameraMask: 1, pools: [s.fx, s.proto]});
    expect(log.frames.length).toBe(Math.ceil(plan.others.length / WARMUP_DEFAULTS.frameChunk));
    expect(new Set(log.frames.flat())).toEqual(new Set(plan.others.map(i => i.object)));
    expect(res.stages.shadows.total).toBe(log.frames.length);
    expect(res.pools).toEqual(['effects', 'prototypes']);
    const v = station();
    v.light.castShadow = false;
    const rv = hostFor(v, new FakeRenderer(), {mode: 'view'});
    const resV = await runWarmup(rv.host, {yieldFrame: async () => {}});
    expect(rv.log.frames.length).toBe(0);
    expect(rv.log.hide).toEqual([false]);
    expect(resV.stages.shadows.total).toBe(0);
  });

  it('registry: named passes / pools replace by name and reject empty names', () => {
    const reg = new WarmupRegistry();
    const sc = new THREE.Scene(), cam = camera();
    reg.addPass({name: 'a', scene: sc, camera: cam, target: () => null});
    reg.addPass({name: 'a', scene: sc, camera: cam, target: () => 'x'});
    expect(reg.passes.length).toBe(1);
    expect(reg.passes[0].target()).toBe('x');
    expect(() => reg.addPool('', () => [])).toThrow();
    reg.addPool('p', () => [sc]);
    expect(reg.poolRoots()).toEqual([sc]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('readiness for content added later (prepareObjects) and the warm-up mode', () => {
  it('projects the hidden subtree in the given context during the call only, then restores visibility and the target', async () => {
    const s = station();
    const r = new FakeRenderer();
    const cam = camera();
    const late = new THREE.Group(); late.visible = false;
    const part = mesh(box(), std(0x00ff00), 0, -50); // also off-frustum
    late.add(part);
    s.scene.add(late);
    r.watch = [late];
    const p = prepareObjects(r, s.scene, cam, late, 'scene-pass-rt');
    expect(r.calls[0].target).toBe('scene-pass-rt');
    expect(r.calls[0].mrt).toBeNull();
    expect(r.calls[0].objects).toEqual([part]);
    expect(r.calls[0].visibleDuring.get(late)).toBe(true);
    expect(late.visible).toBe(false); // hidden again before any frame can run
    expect(part.frustumCulled).toBe(true);
    expect(r.target).toBe('canvas');
    expect(r.mrt).toBe('mrt-before');
    await p;
  });

  it('?warmup= overrides; software rasterizers default to the neighbourhood', () => {
    expect(warmupMode('', false)).toBe('full');
    expect(warmupMode('', true)).toBe('view');
    expect(warmupMode('?warmup=off', false)).toBe('off');
    expect(warmupMode('?warmup=full&qa=1', true)).toBe('full');
    expect(warmupMode('?warmup=bogus', false)).toBe('full');
  });
});

// ---------------------------------------------------------------------------------------------
describe('USER-UPDATE-02: station transition keeps shared programs alive until the new station is prepared', () => {
  const fixturesOf = (l: StationLayout): Fixture[] => l.lights.map((x, i) => ({x: x.x, y: x.y, z: x.z, broken: x.broken, flicker: x.flicker, warm: x.warm, dying: x.dying, power: x.power, area: x.area, phase: i * 1.7, level: x.broken ? 0 : 1}));
  it('StationLighting.dispose(scene, retire): leaves the scene now, releases GPU resources only when the retire queue runs', () => {
    const scene = new THREE.Scene();
    const l = generateStation(1);
    const sl = new StationLighting(scene, l, fixturesOf(l), null);
    let texDisposed = 0;
    sl.volume.texture.addEventListener('dispose', () => { texDisposed++; });
    const queue: (() => void)[] = [];
    sl.dispose(scene, fn => queue.push(fn));
    const lights: THREE.Object3D[] = [];
    scene.traverse(o => { if ((o as THREE.Light).isLight || (o as THREE.InstancedMesh).isInstancedMesh) lights.push(o); });
    expect(lights).toEqual([]); // nothing of the old station left in the scene
    expect(texDisposed).toBe(0); // ... but nothing released yet
    expect(queue.length).toBe(1);
    for (const fn of queue) fn();
    expect(texDisposed).toBe(1);
    // the old behaviour without a retire sink is unchanged (immediate)
    const sl2 = new StationLighting(scene, l, fixturesOf(l), null);
    let t2 = 0;
    sl2.volume.texture.addEventListener('dispose', () => { t2++; });
    sl2.dispose(scene);
    expect(t2).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Task static-batching-warmup-20261105 (user: "double that to 120s"): a 120 s MAXIMUM work budget, the likely first uses first, and the
// cut recorded (a GAME72 laptop capture: 'partial' at 60 s with the held items, torch casters and loot batches left for play).
describe('warm-up budget / first-use order / cut stage (task static-batching-warmup-20261105)', () => {
  it('the default budget is a 120 s maximum: a run that finishes early returns at once (complete, no cut)', async () => {
    expect(WARMUP_DEFAULTS.budgetMs).toBe(120_000);
    const s = station();
    const r = new FakeRenderer();
    let t = 0;
    const {host} = hostFor(s, r);
    const res = await runWarmup(host, {now: () => (t += 1), yieldFrame: async () => {}});
    expect(res.status).toBe('complete');
    expect([res.budgetMs, res.cutStage]).toEqual([120_000, null]);
    expect(res.ms).toBeLessThan(500); // (fake clock: one tick per call — it ends with the work, it never waits for the budget)
  });

  it('pooled first-use items (effects, prototypes) compile first, then the representatives nearest the camera', async () => {
    const s = station();
    const r = new FakeRenderer();
    const {host} = hostFor(s, r);
    const res = await runWarmup(host, {compileChunk: 2, yieldFrame: async () => {}});
    expect(res.status).toBe('complete');
    const calls = r.calls.filter(c => c.target === 'scene-pass-rt');
    const order = calls.flatMap(c => c.objects);
    // the 3 pooled items (the empty decal batch is planned but this fake projects nothing for it) fill the first 2 chunks of 2
    const pooled = [s.sparks, s.decals, s.protoMesh];
    const firstCalls = new Set(calls.slice(0, Math.ceil(pooled.length / 2)).flatMap(c => c.objects));
    for (const o of [s.sparks, s.protoMesh]) expect(firstCalls.has(o)).toBe(true);
    expect(firstCalls.has(s.floor) || firstCalls.has(s.farRoom)).toBe(false);
    expect(order.indexOf(s.farRoom)).toBeGreaterThan(order.indexOf(s.floor)); // (40 m away: after the room around the camera)
    expect(new Set(order)).toEqual(new Set(planWarmup(s.scene, {mode: 'full', cameraMask: 1, pools: [s.fx, s.proto]}).items.map(i => i.object))); // (same set)
  });

  it('a budget cut in the materials stage: partial, cutStage materials, the held-item pass STILL compiled, no hidden frames', async () => {
    const s = station();
    const vmScene = new THREE.Scene(), vmCam = camera();
    const held = new THREE.Group(); held.visible = false;
    const knife = mesh(box(), std(0x222222), 0, -1); held.add(knife); vmScene.add(held);
    const r = new FakeRenderer();
    let t = 0;
    const {host, log} = hostFor(s, r);
    host.registry = registryFor(s, reg => reg.addPass({name: 'weapons and held items', scene: vmScene, camera: vmCam, target: () => 'overlay-rt', hidden: () => [held]}));
    const res = await runWarmup(host, {compileChunk: 2, budgetMs: 1000, now: () => (t += 400), yieldFrame: async () => {}});
    expect(res.status).toBe('partial');
    expect([res.cutStage, res.budgetMs]).toEqual(['materials', 1000]);
    expect(res.reason).toMatch(/time budget \(1 s\) reached in materials/);
    expect(res.stages.materials.done).toBeLessThan(res.stages.materials.total);
    expect(r.calls.some(c => c.target === 'overlay-rt' && c.objects.includes(knife))).toBe(true);
    expect(res.stages.passes).toMatchObject({done: 1, total: 1});
    expect(log.frames.length).toBe(0);
    expect(held.visible).toBe(false); // (restored)
    expect(log.finished).toBe(1);
  });
});
