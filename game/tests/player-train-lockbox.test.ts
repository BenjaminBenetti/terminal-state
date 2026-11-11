// Task train-lockbox-windows-20261101-232156 (lane TRAIN): the Lockbox world object in the player train's rear compartment
// (world/trainLockbox.ts + its hooks in world/playerTrain.ts / playerTrainSpec.ts), on a generated Subway with a fake Game host and the
// REAL Player body:
//  - placement: inside the rear compartment, clear of the bulkhead / partition / lining, its doorway and every door, front to the aisle;
//  - collision: a solid anchored box (a walking Player stops at its front, a bullet stops on it; in game.propIndex + layout.props);
//  - aim + [E] + prompt '[E] Open Lockbox' + the shared highlight (the doors' reach / occlusion), off when the aim leaves;
//  - the lid: hinged at the back, opens / closes smoothly; lane BOX's API (onLockboxInteract / setLockboxOpen / lockboxWorld /
//    lockboxAimed); the cooked model's two nodes when present, a placeholder (never a crash) when missing; teardown without leaks.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {raycastWorld} from '../src/combat/hitscan';
import {playerTrainPlacement, trainSpawnPose, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {LOCKBOX_CLEAR, LOCKBOX_PROVISIONAL, PARTITION_HALF, PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain, trainQaApi, type TrainHost} from '../src/world/playerTrain';
import {TRAIN_VIEW} from '../src/world/playerTrainView';
import {PLAYER_TRAIN_MEASURED} from '../src/assets/playerTrain.generated';
import {loadStripped} from './helpers/openablesFixture';
import {LOCKBOX_MODEL_KEY} from '../src/world/trainLockbox';
import {LOCKBOX, lockboxFootprint} from '../src/world/trainLockbox';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
const LB = SPEC.lockbox!;
let cached: StationLayout | null = null;
const layout = (): StationLayout => (cached ??= LEVELS.subway.generate('main', {levelSeed: 4242}));

class Keys implements MoveInput {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}
const W = () => { const k = new Keys(); k.held.add('KeyW'); return k; };

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) rt.teardown(); });

function makeHost(L: StationLayout) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(L);
  const host = {
    scene, camera, player: new Player(), zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[],
    levels, layout: L, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L) as TrainPlacement | null,
    sfx: null, hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn()},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', world: {culler: {register: vi.fn()}}, run: {current: {level: 'subway', section: 'main'}},
  } satisfies TrainHost;
  return host;
}
type Host = ReturnType<typeof makeHost>;

function build(models?: () => {lockbox?: GLTF | null}) {
  const L = layout(), h = makeHost(L);
  const rt = installPlayerTrain(h, models ? {models} : {});
  live.push(rt);
  for (const s of h.sectionHooks) s.build?.(L);
  return {h, rt, p: h.trainPlacement!, L};
}
const sync = (h: Host) => {
  const P = h.player;
  h.camera.position.set(P.x, P.y + STAND_EYE, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  h.camera.updateMatrixWorld(true);
};
const step = (h: Host, s: number, keys: Keys = new Keys()) => {
  for (let t = 0; t < s - 1e-9; t += DT) { h.player.update(DT, keys, h.levels, h.propIndex, OPTS); sync(h); for (const f of h.frameHooks) f(DT); }
};
const local = (h: Host, p: TrainPlacement) => worldToTrain(p, h.player.x, h.player.y, h.player.z);
const face = (h: Host, p: TrainPlacement, lx: number, lz: number, pitch = 0) => {
  const w = trainToWorld(p, lx, 0, lz);
  h.player.yaw = Math.atan2(-(w.x - h.player.x), -(w.z - h.player.z));
  h.player.pitch = pitch;
  sync(h);
};
const stand = (h: Host, p: TrainPlacement, lx: number, lz: number) => {
  const w = trainToWorld(p, lx, SPEC.floorY, lz);
  h.player.spawn(w.x, w.z, 0, w.y);
  sync(h);
};

describe('the Lockbox: placement (spec.lockbox)', () => {
  it('stands in the rear compartment, centred along it, its back on the far-side lining, front to the aisle, clear of doorway / doors / walls', () => {
    const rear = SPEC.rear!, hw = SPEC.interior.halfWidth;
    expect(PARTITION_HALF).toBe(TRAIN_VIEW.partition / 2);
    // the cooked model's measured size (lane ASSETS; the provisional box only without it): ~1.03 x 0.56 x 0.61 m — substantial (LOCKBOX_SLOTS)
    const M = (PLAYER_TRAIN_MEASURED as {lockbox?: typeof LOCKBOX_PROVISIONAL}).lockbox ?? LOCKBOX_PROVISIONAL;
    expect([LB.length, LB.height, LB.depth]).toEqual([M.length, M.height, M.depth]);
    expect(LB.seamY).toBe(M.seamY);
    expect([LB.lid.hingeY, LB.lid.hingeZ]).toEqual([M.hinge.y, M.hinge.z]);
    expect(LB.length).toBeGreaterThan(0.9);
    expect(LB.height).toBeGreaterThan(0.45);
    const fp = lockboxFootprint(LB);
    // in the compartment, 1.5-3 cm clear of the rear bulkhead and the partition's rear face; centred between them
    const back = SPEC.interior.x0, partitionFace = rear.x1 - PARTITION_HALF;
    expect(fp.x0 - back).toBeGreaterThanOrEqual(0.015);
    expect(partitionFace - fp.x1).toBeGreaterThanOrEqual(0.015);
    expect(fp.x0 - back).toBeLessThanOrEqual(0.035);
    expect((fp.x0 - back) - (partitionFace - fp.x1)).toBeCloseTo(0, 6);
    // back against the far-side (+Z) lining (LOCKBOX_CLEAR off it), front facing the aisle (yaw PI turns the model's +Z front to -Z)
    expect(hw - fp.z1).toBeCloseTo(LOCKBOX_CLEAR, 6);
    expect(LB.yaw).toBeCloseTo(Math.PI, 6);
    // never in front of the partition doorway (z ±0.45) and no door opening in the compartment's x range
    expect(fp.z0).toBeGreaterThan(rear.doorway.z1 + 0.15);
    for (const d of SPEC.doors) expect(fp.x1 <= d.x - d.width / 2 || fp.x0 >= d.x + d.width / 2).toBe(true);
    // a walkable aisle beside it (a body is 0.6 m wide)
    expect(fp.z0 - -hw).toBeGreaterThan(1.2);
    // the lid: hinged at the back-top, opens ~100 degrees, within the box
    expect(LB.lid.openAngle).toBeCloseTo((100 * Math.PI) / 180, 6);
    expect(LB.lid.hingeZ).toBeLessThan(0);
    expect(LB.lid.hingeY).toBeGreaterThan(0.2);
    expect(LB.lid.hingeY).toBeLessThanOrEqual(LB.height);
  });
});

describe('the Lockbox: collision, aim, lid, lane BOX API', () => {
  it('is a solid anchored box: a real Player stops at its front, a bullet stops on it; it is in propIndex and layout.props', () => {
    const {h, rt, p, L} = build();
    const t = rt.train!, fp = lockboxFootprint(LB);
    const box = t.col.statics.find(b => { const q = worldToTrain(p, b.x, 0, b.z); return Math.abs(q.x - LB.x) < 1e-6 && Math.abs(q.z - LB.z) < 1e-6; })!;
    expect(box).toBeTruthy();
    expect(box.y + box.h).toBeCloseTo(p.floorY + LB.height, 6);
    expect(h.propIndex.props).toContain(box);
    expect(L.props).toContain(box);
    // walk at it from the aisle
    stand(h, p, LB.x, fp.z0 - 1.0);
    face(h, p, LB.x, 3);
    step(h, 1.5, W());
    expect(local(h, p).z).toBeLessThanOrEqual(fp.z0 - h.player.radius + 0.01);
    expect(rt.playerInside()).toBe(true);
    // shoot it (level, at mid height): the bullet stops on its front face
    const eye = trainToWorld(p, LB.x, SPEC.floorY + 0.3, fp.z0 - 1.0), dir = trainToWorld(p, LB.x, SPEC.floorY + 0.3, fp.z0 + 1);
    const d = new THREE.Vector3(dir.x - eye.x, 0, dir.z - eye.z).normalize();
    const wh = raycastWorld(h.levels, L.props, eye, {x: d.x, y: 0, z: d.z}, 10, L.trench.floorY);
    expect(wh.kind).toBe('prop');
    expect(L.props[wh.prop!]).toBe(box);
    expect(wh.t).toBeCloseTo(1.0, 3);
  });

  it('aim + [E]: the prompt and the drawers\' highlight while aimed (doors\' reach / occlusion), off when the aim leaves', () => {
    const {h, rt, p} = build();
    const qa = trainQaApi({trainRuntime: rt, player: h.player});
    expect(qa.trainGo('lockbox')).toBe(true);
    const v = rt.lockboxView!;
    const bases = new Map(v.highlight.map(m => [m, m.material as THREE.Material]));
    expect(v.highlight.length).toBeGreaterThan(0);
    step(h, DT);
    expect(rt.lockboxAimed).toBe(true);
    expect(rt.target).toBeNull();
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe('<b>[E]</b> Open Lockbox');
    for (const m of v.highlight) {
      expect(m.material).not.toBe(bases.get(m));
      expect((m.material as THREE.MeshStandardMaterial).emissive.r).toBeGreaterThan(0.02);
    }
    // the liner never glows
    const liner = v.group.getObjectByName('train-lockbox-liner') as THREE.Mesh;
    expect(v.highlight).not.toContain(liner);
    // look away (along the aisle): no aim, no prompt, the materials restored
    face(h, p, 20, local(h, p).z);
    step(h, DT);
    expect(rt.lockboxAimed).toBe(false);
    expect(rt.prompt).toBeNull();
    for (const m of v.highlight) expect(m.material).toBe(bases.get(m));
    // out of reach: 3 m away facing it -> nothing
    stand(h, p, -4.0, -0.3);
    face(h, p, LB.x, LB.z, -0.2);
    step(h, DT);
    expect(rt.lockboxAimed).toBe(false);
    // leaving play clears it at once
    expect(qa.trainGo('lockbox')).toBe(true);
    step(h, DT);
    expect(rt.lockboxAimed).toBe(true);
    for (const f of h.stateListeners) (f as unknown as (s: string, q: string) => void)('paused', 'playing');
    for (const m of v.highlight) expect(m.material).toBe(bases.get(m));
  });

  it('the lid opens / closes on [E] (no handler) and through setLockboxOpen; lane BOX\'s handler takes [E]; lockboxWorld', () => {
    const {h, rt, p} = build();
    const qa = trainQaApi({trainRuntime: rt, player: h.player});
    qa.trainGo('lockbox');
    step(h, DT);
    const v = rt.lockboxView!;
    const rest = v.lid!.rotation.x;
    // no handler: [E] toggles the lid, the prompt follows
    expect(h.interactHandlers.some(f => f())).toBe(true);
    expect(rt.lockboxLid.target).toBe(1);
    step(h, LOCKBOX.lidTime / 2);
    const mid = v.lid!.rotation.x;
    expect(mid).toBeLessThan(rest);
    expect(mid).toBeGreaterThan(rest - LB.lid.openAngle); // smooth, not a snap
    step(h, LOCKBOX.lidTime);
    expect(rt.lockboxLid.t).toBe(1);
    expect(v.lid!.rotation.x).toBeCloseTo(rest - LB.lid.openAngle, 6);
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe('<b>[E]</b> Close Lockbox');
    expect(h.interactHandlers.some(f => f())).toBe(true);
    step(h, LOCKBOX.lidTime + 0.1);
    expect(rt.lockboxLid.t).toBe(0);
    expect(v.lid!.rotation.x).toBeCloseTo(rest, 6);
    // lane BOX's handler: [E] calls it (and nothing else); it drives the lid through setLockboxOpen
    const calls: number[] = [];
    rt.onLockboxInteract = () => { calls.push(1); rt.setLockboxOpen(true); };
    expect(h.promptProviders.map(f => f()).find(Boolean)).toBe('<b>[E]</b> Open Lockbox');
    expect(h.interactHandlers.some(f => f())).toBe(true);
    expect(calls.length).toBe(1);
    step(h, LOCKBOX.lidTime + 0.1);
    expect(rt.lockboxLid.t).toBe(1);
    rt.setLockboxOpen(false);
    step(h, LOCKBOX.lidTime + 0.1);
    expect(rt.lockboxLid.t).toBe(0);
    // the walk-away anchor: the closed top's centre
    const top = rt.lockboxWorld()!, q = worldToTrain(p, top.x, top.y, top.z);
    expect(q.x).toBeCloseTo(LB.x, 6);
    expect(q.z).toBeCloseTo(LB.z, 6);
    expect(top.y).toBeCloseTo(p.floorY + LB.height, 6);
    // the doors still answer [E] when aimed (the Lockbox only takes it while it is the nearest aimed thing)
    const pose = trainSpawnPose(h.layout, p);
    h.player.spawn(pose.x, pose.z, pose.yaw, pose.y); sync(h);
    step(h, DT);
    expect(rt.lockboxAimed).toBe(false);
    expect(rt.target).not.toBeNull();
    expect(h.interactHandlers.some(f => f())).toBe(true);
    expect(calls.length).toBe(1);
    expect(rt.qa().lockbox).toMatchObject({aimed: false, handler: true, size: [LB.length, LB.height, LB.depth]});
  });

  it('uses the cooked model\'s two nodes when present (the lid node pivots), a placeholder when missing / malformed; no leaks', () => {
    // a synthetic cooked model: 'lockbox-body' + 'lockbox-lid' (origin on the hinge line)
    const scene = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(LB.length, 0.42, LB.depth), new THREE.MeshStandardMaterial());
    body.name = 'lockbox-body'; body.position.y = 0.21;
    const lid = new THREE.Group(); lid.name = 'lockbox-lid'; lid.position.set(0, LB.lid.hingeY, LB.lid.hingeZ);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(LB.length, 0.13, LB.depth), new THREE.MeshStandardMaterial());
    lidMesh.position.set(0, 0.065, -LB.lid.hingeZ); lid.add(lidMesh);
    scene.add(body, lid);
    const gltf = {scene} as unknown as GLTF;
    const a = build(() => ({lockbox: gltf}));
    const v = a.rt.lockboxView!;
    expect(v.source).toBe('model');
    expect(v.lid?.name).toBe('lockbox-lid');
    expect(v.highlight.length).toBe(2);
    a.rt.setLockboxOpen(true);
    step(a.h, LOCKBOX.lidTime + 0.1);
    expect(v.lid!.rotation.x).toBeCloseTo(-LB.lid.openAngle, 6);
    // the library's model is cloned, never moved
    expect(lid.rotation.x).toBe(0);
    const props0 = a.L.props.length - a.rt.train!.layoutBoxes.length;
    a.rt.teardown();
    expect(a.L.props.length).toBe(props0);
    expect(a.rt.lockboxWorld()).toBeNull();
    expect(a.rt.lockboxView).toBeNull();
    // malformed (no named nodes) -> the placeholder, with a warning; missing -> the placeholder
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = build(() => ({lockbox: {scene: new THREE.Group()} as unknown as GLTF}));
    expect(b.rt.lockboxView!.source).toBe('placeholder');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    b.rt.teardown();
    const c = build();
    expect(c.rt.lockboxView!.source).toBe('placeholder');
    expect(c.rt.lockboxView!.lid).not.toBeNull();
  });
});

describe('the Lockbox: the cooked Meshy model (lane ASSETS) in place', () => {
  it('two nodes, grounded in its footprint, the lid pivoting on its hinge line, the liner inside the cavity', async () => {
    const files = (await import('../src/assets/playerTrain.generated')).PLAYER_TRAIN_MODELS as Record<string, {url: string}>;
    expect(files[LOCKBOX_MODEL_KEY], 'the cooked lockbox is in the train catalogue').toBeTruthy();
    const gltf = await loadStripped(files[LOCKBOX_MODEL_KEY].url);
    expect(gltf.scene.getObjectByName('lockbox-body')).toBeTruthy();
    expect(gltf.scene.getObjectByName('lockbox-lid')).toBeTruthy();
    const {h, rt, p} = build(() => ({lockbox: gltf}));
    const v = rt.lockboxView!;
    expect(v.source).toBe('model');
    v.group.updateMatrixWorld(true);
    // the placed model sits on the car floor, inside its collision footprint (+1 cm), never in the lining / partition
    const bb = new THREE.Box3();
    v.group.traverse(o => { if ((o as THREE.Mesh).isMesh && !o.userData.lockboxLiner) bb.expandByObject(o); });
    const lo = worldToTrain(p, bb.min.x, bb.min.y, bb.min.z), hi = worldToTrain(p, bb.max.x, bb.max.y, bb.max.z);
    const fp = lockboxFootprint(LB);
    expect(bb.min.y).toBeCloseTo(p.floorY, 2);
    expect(bb.max.y - p.floorY).toBeCloseTo(LB.height, 2);
    expect(Math.min(lo.x, hi.x)).toBeGreaterThan(fp.x0 - 0.01); expect(Math.max(lo.x, hi.x)).toBeLessThan(fp.x1 + 0.01);
    expect(Math.min(lo.z, hi.z)).toBeGreaterThan(fp.z0 - 0.01); expect(Math.max(lo.z, hi.z)).toBeLessThan(SPEC.interior.halfWidth);
    // the lid node's origin is the hinge line (box frame), and it opens up and back about it
    const lid = v.lid!;
    expect(lid.position.y).toBeCloseTo(LB.lid.hingeY, 3);
    expect(lid.position.z).toBeCloseTo(LB.lid.hingeZ, 3);
    const front0 = new THREE.Box3().setFromObject(lid);
    rt.setLockboxOpen(true);
    step(h, LOCKBOX.lidTime + 0.1);
    v.group.updateMatrixWorld(true);
    const front1 = new THREE.Box3().setFromObject(lid);
    expect(front1.max.y, 'the open lid stands up').toBeGreaterThan(front0.max.y + 0.3);
    // the liner fills the measured cavity (box frame), below the seam
    const liner = v.group.getObjectByName('train-lockbox-liner') as THREE.Mesh;
    liner.geometry.computeBoundingBox();
    const lb = liner.geometry.boundingBox!;
    expect(lb.max.y).toBeCloseTo(LB.seamY!, 4);
    expect(lb.min.y).toBeCloseTo(LB.cavity!.y0, 4);
    expect(lb.min.x).toBeGreaterThanOrEqual(-LB.length / 2); expect(lb.max.x).toBeLessThanOrEqual(LB.length / 2);
  });
});
