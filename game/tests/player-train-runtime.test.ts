// Task player-train-shell-20261101-202805 (lane TRAIN): the player's home train in the game (world/playerTrain.ts + playerTrainView.ts)
// on generated Subway / Office / Mall levels at the shared placement (gen/playerTrain.ts), with a fake Game host and the REAL Player
// body (player/player.ts movement / collision / support, steered with keys; no teleport during a walk):
//  - the car builds synchronously in the section hook: interior volume, walls / underframe / leaves in layout.props + game.propIndex,
//    the view in the scene, culler-registered, a warm pool; the procedural interior exists without any model;
//  - from the spawn inside, a shut door blocks; aim + [E] opens it; the player walks out onto the platform over the gap bridge and
//    back in; the far wall blocks; closing is refused while the player stands in the doorway, a body stepping in re-opens closing
//    doors, pushing into a shut door opens it; from the platform a shut door's gap is closed (no falling in);
//  - the lights exist from install (boot) with the same light set in every section, cast (intensity > 0) only with a train;
//  - teardown restores the volume list, layout.props, game.propIndex and the scene; the draw / triangle cost the car adds.
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainSpawnPose, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {TRAIN_DOOR, TRAIN_LIGHTS, PlayerTrainRuntime, installPlayerTrain, interiorLightMounts, trainColliders, trainQaApi, type TrainHost} from '../src/world/playerTrain';
import {TRAIN_VIEW, TrainMaterials, WALL_ART_GLASS, buildTrainView, leafSpan, noseCorners, nosePane, viewCost, windowsOf} from '../src/world/playerTrainView';
import {raycastWorld} from '../src/combat/hitscan';
import {loadStripped} from './helpers/openablesFixture';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};

const layouts = new Map<string, StationLayout>();
const layoutOf = (level: 'subway' | 'office' | 'mall', levelSeed = 4242): StationLayout => {
  const k = `${level}:${levelSeed}`;
  let l = layouts.get(k);
  if (!l) layouts.set(k, (l = LEVELS[level].generate(LEVELS[level].entry, {levelSeed})));
  return l;
};

/** Every runtime a test installed: torn down after each test even when an assertion failed mid-way (the layouts are cached). */
const live: PlayerTrainRuntime[] = [];
const track = (rt: PlayerTrainRuntime): PlayerTrainRuntime => { live.push(rt); return rt; };
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) rt.teardown(); });

class Keys implements MoveInput {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}

function makeHost(layout: StationLayout) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(layout);
  const player = new Player();
  const culler = {register: vi.fn()};
  const toasts: string[] = [];
  const pushKeys = new Keys(); // what the train's push-open reads (Game.input)
  const host = {
    scene, camera, player, zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[],
    levels, layout, propIndex: new PropIndex(levels, layout.props), trainPlacement: playerTrainPlacement(layout) as TrainPlacement | null,
    sfx: null, hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn()},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', world: {culler}, input: pushKeys, run: {current: {level: 'subway', section: 'main'}},
  } satisfies TrainHost;
  return {host, culler, toasts, pushKeys};
}

type Host = ReturnType<typeof makeHost>['host'];

/** The camera at the player's eye (Game.updateCamera's pose: yaw / pitch, YXZ). */
function syncCamera(h: Host): void {
  const P = h.player;
  h.camera.position.set(P.x, P.y + STAND_EYE, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  h.camera.updateMatrixWorld(true);
}

/** Real frames: the Player moves with `keys` through the host's levels / propIndex, then the lane frame hooks run. */
function step(h: Host, seconds: number, keys: Keys = new Keys()): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    h.player.update(DT, keys, h.levels, h.propIndex, OPTS);
    syncCamera(h);
    for (const f of h.frameHooks) f(DT);
  }
}

const local = (h: Host, p: TrainPlacement) => worldToTrain(p, h.player.x, h.player.y, h.player.z);
/** Face a train-local point (yaw only; level look). */
function face(h: Host, p: TrainPlacement, lx: number, lz: number): void {
  const w = trainToWorld(p, lx, 0, lz);
  h.player.yaw = Math.atan2(-(w.x - h.player.x), -(w.z - h.player.z));
  h.player.pitch = 0;
  syncCamera(h);
}
const W = () => { const k = new Keys(); k.held.add('KeyW'); return k; };
const middleDoor = (side: -1 | 1) => SPEC.doors.reduce((b, d, i) => (d.side === side && (b < 0 || Math.abs(d.x) < Math.abs(SPEC.doors[b].x)) ? i : b), -1);
const sceneLights = (s: THREE.Scene) => { let n = 0; s.traverse(o => { if ((o as THREE.Light).isLight) n++; }); return n; };

function spawnInside(h: Host, rt: PlayerTrainRuntime, p: TrainPlacement): void {
  const pose = trainSpawnPose(h.layout, p);
  h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
  syncCamera(h);
  expect(rt.playerInside(), 'spawned inside the car').toBe(true);
}

describe('player train: build at the shared placement (Subway / Office / Mall)', () => {
  for (const level of ['subway', 'office', 'mall'] as const) {
    it(`${level}: builds synchronously — volume, colliders, view, culler, warm pool, lights — and tears down without leaks`, () => {
      const layout = layoutOf(level);
      const {host, culler} = makeHost(layout);
      const p = host.trainPlacement!;
      expect(p, `${level}: placed`).not.toBeNull();
      const lightsBoot0 = sceneLights(host.scene);
      const rt = track(installPlayerTrain(host));
      const lightsBoot = sceneLights(host.scene);
      expect(lightsBoot - lightsBoot0, 'lights added once at install').toBe(2 + TRAIN_LIGHTS.interior.count);
      for (const l of rt.lights.all) expect(l.intensity).toBe(0);
      const props0 = layout.props.length, index0 = host.propIndex;
      for (const s of host.sectionHooks) s.build?.(layout);
      const t = rt.train!;
      expect(t, 'built').not.toBeNull();
      // the interior volume (bridge gates on the platform side only) — the player can stand at the car floor there
      expect(host.levels.dynamicVolumes).toContain(t.col.volume);
      expect(t.col.volume.shell).toBe(0);
      expect(t.col.volume.floorY).toBeCloseTo(p.floorY, 6);
      expect(t.col.volume.ceilY - t.col.volume.floorY).toBeGreaterThanOrEqual(2.25);
      const plat = t.doors.filter(d => d.col.door.side < 0), far = t.doors.filter(d => d.col.door.side > 0);
      expect(plat.every(d => d.col.gate && d.col.gate.depth >= 0.45 && d.col.gate.depth <= 1.0), `${level}: platform doors bridge the gap`).toBe(true);
      expect(far.every(d => !d.col.gate), `${level}: far doors open onto the bed`).toBe(true);
      const sp = trainSpawnPose(layout, p);
      expect(host.levels.supportAt(sp.x, sp.z, sp.y)?.floor).toBeCloseTo(p.floorY, 6);
      // bullets: from the spawn eye the far wall stops a level shot, the car floor a shot straight down, the roof one straight up
      const eye = {x: sp.x, y: sp.y + STAND_EYE, z: sp.z}, side = trainToWorld(p, 0, 0, 1), dz = side.z - p.z;
      const wall = raycastWorld(host.levels, layout.props, eye, {x: 0, y: 0, z: dz}, 30, layout.trench.floorY);
      expect(wall.kind).toBe('prop');
      // (straight across from the spawn stands the far middle door: the bullet stops on its leaf, where the leaf is drawn)
      expect(Math.abs(worldToTrain(p, eye.x, eye.y, eye.z + dz * wall.t).z)).toBeCloseTo(SPEC.doorLeaf.outerZ - SPEC.doorLeaf.thickness, 3);
      const down = raycastWorld(host.levels, layout.props, eye, {x: 0, y: -1, z: 0}, 30, layout.trench.floorY);
      expect(eye.y - down.t).toBeCloseTo(p.floorY, 3);
      const up = raycastWorld(host.levels, layout.props, eye, {x: 0, y: 1, z: 0}, 30, layout.trench.floorY);
      expect(eye.y + up.t).toBeCloseTo(p.railTopY + SPEC.ceilingY, 3);
      // layout.props (hitscan / statics) and the collision index
      expect(layout.props.length).toBe(props0 + t.layoutBoxes.length);
      expect(host.propIndex).not.toBe(index0);
      for (const b of t.col.statics) expect(host.propIndex.props).toContain(b);
      for (const b of t.col.curbs) { expect(host.propIndex.props).toContain(b); expect(layout.props).not.toContain(b); }
      // the view: in the scene at the pose, storey-tagged, the static part registered with the culler, a warm pool
      expect(t.view.root.parent).toBe(host.scene);
      expect(t.view.root.position.x).toBeCloseTo(p.x, 6);
      expect(t.view.root.rotation.y).toBeCloseTo(p.yaw, 6);
      expect(culler.register).toHaveBeenCalledWith(t.view.fixed);
      t.view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.userData.level).toBe(p.level); });
      expect(host.warmRegistry.names.pools).toContain('player-train');
      expect(host.warmRegistry.poolRoots()).toContain(t.view.root);
      expect(t.view.source.shell).toBe('procedural'); // no model in Node: the fallback skin, never a void
      // lights: the same set, casting now (head / tail / interior), at the mounts
      expect(sceneLights(host.scene)).toBe(lightsBoot);
      expect(rt.lights.head.intensity).toBeGreaterThan(0);
      expect(rt.lights.tail.intensity).toBeGreaterThan(0);
      for (const l of rt.lights.interior) expect(l.intensity).toBeGreaterThan(0);
      const headLocal = worldToTrain(p, rt.lights.head.position.x, rt.lights.head.position.y, rt.lights.head.position.z);
      const aim = worldToTrain(p, rt.lights.head.target.position.x, rt.lights.head.target.position.y, rt.lights.head.target.position.z);
      expect(headLocal.x).toBeGreaterThan(SPEC.length / 2 - 0.5);
      expect(aim.x - headLocal.x, 'head light aims ahead along the track').toBeGreaterThan(5);
      const tailLocal = worldToTrain(p, rt.lights.tail.position.x, rt.lights.tail.position.y, rt.lights.tail.position.z);
      expect(tailLocal.x).toBeLessThan(-SPEC.length / 2 + 0.5);
      for (const l of rt.lights.all) expect(l.castShadow).toBe(false);
      // cost the car adds (reported): a handful of draws
      const cost = viewCost(t.view.root);
      expect(cost.meshes).toBeLessThanOrEqual(30); // 9 lining + the window glass + 3 fallback skin + 12 fallback leaves + the Lockbox (body, lid, liner)
      // the procedural surfaces face the way their normals say (winding = shading normal), the lining faces into the car
      const owned = new Set(t.view.geometries);
      const inward = new Set(['train-floor', 'train-ceiling', 'train-walls']);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), g = new THREE.Vector3();
      t.view.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !owned.has(m.geometry)) return;
        const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal, idx = m.geometry.index!;
        for (let i = 0; i < idx.count; i += 3) {
          a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
          g.subVectors(b, a).cross(c.clone().sub(a));
          if (g.lengthSq() < 1e-12) continue; // the lens fans' degenerate halves
          n.fromBufferAttribute(nor, idx.getX(i));
          expect(g.dot(n), `${m.name} triangle ${i / 3} winding`).toBeGreaterThan(0);
          if (inward.has(m.name)) {
            const ctr = a.clone().add(b).add(c).divideScalar(3);
            expect(new THREE.Vector3(0, (SPEC.floorY + SPEC.ceilingY) / 2, 0).sub(ctr).dot(n), `${m.name} faces the interior`).toBeGreaterThan(0);
          }
        }
      });
      // teardown: nothing left behind
      const disposed = vi.fn();
      for (const g of t.view.geometries) g.addEventListener('dispose', disposed);
      for (const s of host.sectionHooks) s.teardown?.();
      expect(rt.train).toBeNull();
      expect(host.levels.dynamicVolumes).not.toContain(t.col.volume);
      expect(layout.props.length).toBe(props0);
      expect(host.propIndex).toBe(index0);
      expect(t.view.root.parent).toBeNull();
      expect(disposed).toHaveBeenCalledTimes(t.view.geometries.length);
      expect(sceneLights(host.scene)).toBe(lightsBoot);
      for (const l of rt.lights.all) expect(l.intensity).toBe(0);
      // a second build (the next section) reuses the boot lights and the cached materials
      for (const s of host.sectionHooks) s.build?.(layout);
      expect(sceneLights(host.scene)).toBe(lightsBoot);
      for (const s of host.sectionHooks) s.teardown?.();
      expect(layout.props.length).toBe(props0);
    });
  }
});

describe('player train: a real Player walks out of the train and back (Subway)', () => {
  let layout: StationLayout;
  beforeAll(() => { layout = layoutOf('subway'); });

  it('a shut door blocks; aim + [E] opens it; out onto the platform over the bridge and back in; the far wall blocks', () => {
    const {host} = makeHost(layout);
    const rt = track(installPlayerTrain(host));
    for (const s of host.sectionHooks) s.build?.(layout);
    const p = host.trainPlacement!, t = rt.train!, hw = SPEC.interior.halfWidth;
    try {
      spawnInside(host, rt, p);
      step(host, 0.5);
      expect(host.player.y).toBeCloseTo(p.floorY, 6); // standing on the car floor (no fall into the bed)
      const di = middleDoor(-1), d = t.doors[di], dd = d.col.door;
      expect(d.t).toBe(0);
      // a fresh spawn faces the middle platform door: its prompt shows at once
      host.frameHooks.forEach(f => f(0));
      expect(rt.target).toBe(d);
      expect(host.promptProviders.map(f => f()).find(Boolean)).toBe('<b>[E]</b> Open doors');
      // shut: walking at it (no push intent fed to the train) stays inside
      face(host, p, dd.x, -3);
      step(host, 1.5, W());
      expect(local(host, p).z).toBeGreaterThan(-hw);
      expect(rt.playerInside()).toBe(true);
      // aim + [E]
      face(host, p, dd.x, -hw);
      host.player.pitch = -0.1; syncCamera(host);
      expect(host.interactHandlers.some(f => f())).toBe(true);
      expect(d.target).toBe(1);
      step(host, TRAIN_DOOR.time + 0.1);
      expect(d.t).toBe(1);
      expect(d.col.gate!.open).toBe(true);
      expect(host.promptProviders.map(f => f()).find(Boolean)).toBe('<b>[E]</b> Close doors');
      // out: across the bridge onto the platform (continuous height: a 0.1-0.25 m step down, never the 1.15 m bed)
      face(host, p, dd.x, -4);
      let minY = Infinity;
      for (let i = 0; i < 120; i++) { step(host, DT, W()); minY = Math.min(minY, host.player.y); }
      const q = local(host, p);
      expect(Math.abs(q.z), 'past the platform edge').toBeGreaterThan(Math.abs(worldToTrain(p, 0, 0, p.platformEdgeZ).z) + 0.2);
      expect(host.player.y, 'on the platform floor').toBeCloseTo(layout.grid.floorAt(host.player.x, host.player.z), 2);
      expect(minY, 'never dropped into the gap').toBeGreaterThan(p.floorY - 0.5);
      expect(rt.playerInside()).toBe(false);
      // back in
      face(host, p, dd.x, 0);
      for (let i = 0; i < 120; i++) { step(host, DT, W()); minY = Math.min(minY, host.player.y); }
      expect(rt.playerInside(), 'back inside').toBe(true);
      expect(host.player.y).toBeCloseTo(p.floorY, 6);
      expect(minY).toBeGreaterThan(p.floorY - 0.5);
      // the far wall (between two far-side doors) blocks
      const farDoors = SPEC.doors.filter(x => x.side > 0).map(x => x.x).sort((a, b) => a - b);
      const gapX = (farDoors[0] + farDoors[1]) / 2;
      face(host, p, gapX, 0);
      step(host, 2.5, W());
      face(host, p, gapX, 4);
      step(host, 2, W());
      expect(local(host, p).z).toBeLessThan(hw - host.player.radius + 0.01);
      expect(rt.playerInside()).toBe(true);
      // the rear end wall blocks too
      face(host, p, -20, local(host, p).z);
      step(host, 6, W());
      expect(local(host, p).x).toBeGreaterThan(SPEC.interior.x0 + host.player.radius - 0.01);
      expect(rt.playerInside()).toBe(true);
      // a far-side door opens onto the bed: out through it is a drop to the bed floor (no bridge)
      const fd = t.doors[middleDoor(1)], fdd = fd.col.door;
      face(host, p, fdd.x, 0);
      for (let i = 0; i < 240 && Math.abs(local(host, p).x - fdd.x) > 0.1; i++) step(host, DT, W());
      face(host, p, fdd.x, hw);
      expect(host.interactHandlers.some(f => f())).toBe(true);
      step(host, TRAIN_DOOR.time + 0.1);
      expect(fd.t).toBe(1);
      face(host, p, fdd.x, 4);
      step(host, 1.2, W());
      expect(local(host, p).z).toBeGreaterThan(SPEC.width / 2);
      expect(host.player.y).toBeCloseTo(t.col.bedY, 2);
    } finally {
      for (const s of host.sectionHooks) s.teardown?.();
    }
  });

  it('never closes on a body: refused in the doorway, re-opens when stepped into, push-open, the gap stays closed from the platform', () => {
    const {host, toasts, pushKeys} = makeHost(layout);
    const rt = track(installPlayerTrain(host));
    for (const s of host.sectionHooks) s.build?.(layout);
    const p = host.trainPlacement!, t = rt.train!, hw = SPEC.interior.halfWidth;
    try {
      spawnInside(host, rt, p);
      const d = t.doors[middleDoor(-1)], dd = d.col.door;
      rt.setDoor(t.doors.indexOf(d), true);
      step(host, TRAIN_DOOR.time + 0.1);
      // stand in the doorway (walk into it): closing is refused, the door stays open
      face(host, p, dd.x, -hw - 0.1);
      for (let i = 0; i < 200 && local(host, p).z > -hw - 0.05; i++) step(host, DT, W());
      expect(d.blocked).toBe(true);
      expect(rt.setDoor(t.doors.indexOf(d), false)).toBe('refused');
      expect(d.target).toBe(1);
      expect(toasts.some(x => /stand clear/i.test(x))).toBe(true);
      // back inside, close, then step into the closing doorway: they re-open (no pinch: the player stays where it walked)
      face(host, p, dd.x, 0);
      step(host, 0.6, W());
      expect(d.blocked).toBe(false);
      expect(rt.setDoor(t.doors.indexOf(d), false)).toBe('closing');
      step(host, 0.25);
      expect(d.t).toBeLessThan(1);
      const reopen0 = rt.counts.reopen;
      face(host, p, dd.x, -3);
      step(host, 0.6, W());
      expect(rt.counts.reopen).toBeGreaterThan(reopen0);
      expect(d.target).toBe(1);
      step(host, TRAIN_DOOR.time);
      expect(d.t).toBe(1);
      // a zombie standing in the doorway also holds them open
      face(host, p, dd.x, 0);
      step(host, 0.8, W());
      const zw = trainToWorld(p, dd.x, SPEC.floorY, -hw - 0.05);
      host.zombies.push({brain: {x: zw.x, z: zw.z, y: p.floorY, alive: true, stats: {radius: 0.3}}});
      step(host, DT);
      expect(rt.setDoor(t.doors.indexOf(d), false)).toBe('refused');
      host.zombies.length = 0;
      step(host, DT);
      expect(rt.setDoor(t.doors.indexOf(d), false)).toBe('closing');
      step(host, TRAIN_DOOR.time + 0.1);
      expect(d.t).toBe(0);
      expect(d.col.gate!.open).toBe(false);
      // push-open: pressing into the shut door (the movement keys) opens it after DOOR.pushOpen
      face(host, p, dd.x, -3);
      const keys = W();
      for (let i = 0; i < 240 && local(host, p).z > -hw + host.player.radius + 0.01; i++) step(host, DT, keys); // up against the leaves
      expect(d.target).toBe(0);
      pushKeys.held.add('KeyW');
      step(host, TRAIN_DOOR.pushOpen - 0.2, keys);
      expect(d.target, 'not before pushOpen').toBe(0);
      step(host, 0.4, keys);
      pushKeys.held.clear();
      expect(rt.counts.pushOpen).toBe(1);
      expect(d.target).toBe(1);
      step(host, TRAIN_DOOR.time);
      // out onto the platform, then the door shut behind: walking back at it from the platform never drops into the gap
      for (let i = 0; i < 120; i++) step(host, DT, keys);
      expect(rt.playerInside()).toBe(false);
      expect(rt.setDoor(t.doors.indexOf(d), false)).toBe('closing');
      step(host, TRAIN_DOOR.time + 0.1);
      expect(d.t).toBe(0);
      face(host, p, dd.x, 0);
      let minY = Infinity;
      for (let i = 0; i < 120; i++) { step(host, DT, W()); minY = Math.min(minY, host.player.y); }
      expect(minY, 'the closed door\'s gap is curbed').toBeGreaterThan(-0.2);
      expect(rt.playerInside()).toBe(false);
      // ... and beside the car (no door): the platform edge along the body is curbed as well
      const wallX = (SPEC.doors[0].x + SPEC.doors[2].x) / 2;
      const at = trainToWorld(p, wallX, 0, worldToTrain(p, 0, 0, p.platformEdgeZ).z - 0.6);
      host.player.x = at.x; host.player.z = at.z; host.player.y = layout.grid.floorAt(at.x, at.z); host.player.vx = host.player.vz = 0;
      face(host, p, wallX, 0);
      minY = Infinity;
      for (let i = 0; i < 90; i++) { step(host, DT, W()); minY = Math.min(minY, host.player.y); }
      expect(minY).toBeGreaterThan(-0.2);
    } finally {
      for (const s of host.sectionHooks) s.teardown?.();
    }
  });

  it('remembers door states per level for the run; colliders are a pure function of the spec + pose', () => {
    const {host} = makeHost(layout);
    const rt = track(installPlayerTrain(host));
    for (const s of host.sectionHooks) s.build?.(layout);
    rt.setDoor(0, true);
    for (const s of host.sectionHooks) s.teardown?.();
    for (const s of host.sectionHooks) s.build?.(layout);
    expect(rt.train!.doors[0].target).toBe(1);
    expect(rt.train!.doors[0].t).toBe(1);
    for (const s of host.sectionHooks) s.teardown?.();
    const p = host.trainPlacement!;
    const a = trainColliders(SPEC, p, host.levels), b = trainColliders(SPEC, p, host.levels);
    expect(JSON.stringify(a.statics)).toBe(JSON.stringify(b.statics));
    // the same car moved 10 m along the track: the same colliders shifted (a later moving train = a pose change)
    const q = {...p, x: p.x + 10};
    const c = trainColliders(SPEC, q, null);
    expect(c.statics.map(s => +(s.x - 10).toFixed(6))).toEqual(a.statics.map(s => +s.x.toFixed(6)));
    expect(interiorLightMounts(SPEC).length).toBe(TRAIN_LIGHTS.interior.count);
  });
});

describe('player train follow-up (train-shell-followup-20261101-221246): door highlight, rear compartment', () => {
  it('the aimed door pair highlights like a drawer: on aim, off on un-aim / out of reach / leaving play; materials restored', () => {
    const layout = layoutOf('subway');
    const {host} = makeHost(layout);
    const rt = track(installPlayerTrain(host));
    for (const s of host.sectionHooks) s.build?.(layout);
    const p = host.trainPlacement!, t = rt.train!;
    const d = t.doors[middleDoor(-1)];
    const mine = rt.leafMeshes(d), others = t.doors.filter(x => x !== d).flatMap(x => rt.leafMeshes(x));
    const bases = new Map(mine.map(m => [m, m.material as THREE.Material]));
    try {
      spawnInside(host, rt, p);
      expect(mine.length).toBeGreaterThanOrEqual(2); // both leaves of the pair
      step(host, DT);
      expect(rt.target).toBe(d);
      expect(rt.highlighted).toBe(d);
      expect(host.promptProviders.map(f => f()).find(Boolean)).toBe('<b>[E]</b> Open doors');
      for (const m of mine) {
        const hi = m.material as THREE.MeshStandardMaterial;
        expect(hi).not.toBe(bases.get(m));
        expect(m.userData.baseMat).toBe(bases.get(m));
        expect(hi.isMeshStandardMaterial).toBe(true);
        expect(hi.emissive.r).toBeGreaterThan(0.02); // the containers' warm pulse
      }
      for (const m of others) expect(m.userData.baseMat ?? m.material).toBe(m.material); // only the aimed pair
      // the glow pulses while aimed (the same formula as drawers)
      const e0 = (mine[0].material as THREE.MeshStandardMaterial).emissive.r;
      step(host, 0.2);
      expect((mine[0].material as THREE.MeshStandardMaterial).emissive.r).not.toBeCloseTo(e0, 4);
      // opening keeps the target, the prompt follows the state
      expect(host.interactHandlers.some(f => f())).toBe(true);
      step(host, DT);
      expect(rt.highlighted).toBe(d);
      expect(host.promptProviders.map(f => f()).find(Boolean)).toBe('<b>[E]</b> Close doors');
      // un-aim: look at the far wall -> restored
      face(host, p, 2.5, 3);
      step(host, DT);
      expect(rt.target).toBeNull();
      expect(rt.highlighted).toBeNull();
      for (const m of mine) expect(m.material).toBe(bases.get(m));
      // re-aim, then leave play (pause): cleared at once
      face(host, p, d.col.door.x, -3);
      step(host, DT);
      expect(rt.highlighted).toBe(d);
      for (const f of host.stateListeners) (f as unknown as (s: string, q: string) => void)('paused', 'playing');
      expect(rt.highlighted).toBeNull();
      expect(rt.prompt).toBeNull();
      for (const m of mine) expect(m.material).toBe(bases.get(m));
      // out of reach: walk to the car's far end -> nothing aimed, nothing glowing
      face(host, p, d.col.door.x, -3);
      step(host, DT);
      expect(rt.highlighted).toBe(d);
      host.player.x = trainToWorld(p, 6.0, 0, 0).x;
      step(host, DT);
      expect(rt.highlighted).toBeNull();
      for (const m of mine) expect(m.material).toBe(bases.get(m));
      // teardown while highlighted: the leaves get their own materials back; the clone cache stays bounded
      spawnInside(host, rt, p);
      step(host, DT);
      expect(rt.highlighted).toBe(d);
    } finally {
      for (const s of host.sectionHooks) s.teardown?.();
    }
    expect(rt.highlighted).toBeNull();
    for (const m of mine) expect(m.material, 'restored at teardown').toBe(bases.get(m));
    expect((rt as unknown as {hiMats: Map<unknown, unknown>}).hiMats.size).toBeLessThanOrEqual(2); // one clone per leaf base material
  });

  it('the rear compartment: a partition with the cab\'s doorway (no console); a real Player walks in and back; its wall blocks', () => {
    const rear = SPEC.rear!;
    expect(rear.x0).toBe(SPEC.interior.x0);
    const rearDoorEdge = Math.min(...SPEC.doors.map(d => d.x - d.width / 2));
    expect(rear.x1).toBeLessThan(rearDoorEdge - 0.05); // clear of the rear doors (their pockets are outside the lining)
    expect(rear.x1 - rear.x0).toBeGreaterThan(1.0); // room to stand in
    expect(rear.doorway).toEqual(SPEC.cab.doorway);
    const layout = layoutOf('subway');
    const {host} = makeHost(layout);
    const rt = track(installPlayerTrain(host));
    for (const s of host.sectionHooks) s.build?.(layout);
    const p = host.trainPlacement!, t = rt.train!;
    try {
      // the partition panels collide beside its doorway
      const panels = t.col.statics.filter(b => { const q = worldToTrain(p, b.x, 0, b.z); return Math.abs(q.x - rear.x1) < 0.05 && b.hx < 0.2 + 1e-6 && Math.abs(b.hx - 0.03) < 0.01 || (Math.abs(q.x - rear.x1) < 0.05 && Math.abs(b.hz - 0.03) < 0.01); });
      expect(panels.length).toBe(2);
      spawnInside(host, rt, p);
      // along the car to just in front of the rear partition, then through its doorway
      face(host, p, rear.x1 + 1.0, 0);
      for (let i = 0; i < 400 && local(host, p).x > rear.x1 + 1.05; i++) step(host, DT, W());
      expect(local(host, p).x).toBeLessThan(rear.x1 + 1.2);
      face(host, p, -20, local(host, p).z);
      step(host, 2.5, W());
      const q = local(host, p);
      expect(q.x, 'inside the rear compartment').toBeLessThan(rear.x1 - 0.4);
      expect(q.x, 'stopped by the rear wall').toBeGreaterThan(SPEC.interior.x0 + host.player.radius - 0.02);
      expect(host.player.y).toBeCloseTo(p.floorY, 6);
      expect(host.player.standBlocked).toBe(false);
      expect(rt.playerInside()).toBe(true);
      // and back out into the saloon
      face(host, p, 20, local(host, p).z);
      step(host, 1.2, W());
      expect(local(host, p).x).toBeGreaterThan(rear.x1 + 0.5);
      // QA hooks for the browser spot check: stand in the rear compartment / the cab, the readout
      const qa = trainQaApi({trainRuntime: rt, player: host.player});
      expect(qa.trainGo('rear')).toBe(true);
      expect(local(host, p).x).toBeLessThan(rear.x1);
      expect(rt.playerInside()).toBe(true);
      expect(qa.trainGo('cab')).toBe(true);
      expect(local(host, p).x).toBeGreaterThan(SPEC.cab.x0);
      expect(qa.trainGo('spawn')).toBe(true);
      const info = qa.train() as {rear: unknown; windows: {end: number; glassBoxes: number}; highlighted: number | null};
      expect(info.rear).toEqual(SPEC.rear);
      expect(info.windows.end).toBe(windowsOf(SPEC).end.length);
      expect(info.windows.glassBoxes).toBe(windowsOf(SPEC).side.filter(w => w.zone !== 'nose').length + windowsOf(SPEC).end.length + SPEC.doors.length * 2);
      face(host, p, rear.x1 + 1.0, 0);
      for (let i = 0; i < 400 && local(host, p).x > rear.x1 + 1.05; i++) step(host, DT, W());
      // beside the doorway the partition blocks
      face(host, p, local(host, p).x, 0.95);
      step(host, 0.8, W());
      face(host, p, -20, local(host, p).z);
      step(host, 2, W());
      expect(local(host, p).x).toBeGreaterThan(rear.x1 + TRAIN_VIEW.partition / 2 + host.player.radius - 0.02);
    } finally {
      for (const s of host.sectionHooks) s.teardown?.();
    }
  });
});

describe('player train follow-up: see-through windows (glass panes, lining cut-outs, collision kept, bullets stop at the glass)', () => {
  // the shape lane ASSETS publishes as spec.windows (rects = the inner-most skin opening); synthetic rects here so this test pins the
  // runtime regardless of the exact cut (the real spec's windows are checked in the cooked-model test when present)
  const WIN = {
    side: [{side: -1 as const, x0: 5.4, x1: 6.9, y0: 2.0, y1: 2.9, skinZ: 1.42}, {side: 1 as const, x0: -7.15, x1: -6.72, y0: 2.0, y1: 2.9, skinZ: 1.42}],
    end: [{end: 1 as const, z0: -0.9, z1: 0.9, y0: 2.25, y1: 3.0, skinX: 7.7}, {end: -1 as const, z0: -0.5, z1: 0.5, y0: 2.25, y1: 3.0, skinX: 7.7}],
    leaf: {x0: -0.2, x1: 0.2, y0: 1.1, y1: 1.9},
  };
  const spec = {...SPEC, windows: WIN} as typeof SPEC;
  let models: {door: GLTF};
  beforeAll(async () => { models = {door: await loadStripped(SPEC.models.doorLeaf.url)}; }, 120000);

  it('the published cut windows (spec.windows, lane ASSETS) fit the runtime: inside the cab / rear compartment / ends, clear of the leaf pockets', () => {
    const w = windowsOf(SPEC);
    expect(w.end.length, 'the windshield + rear end windows are published').toBeGreaterThan(0);
    expect(w.leaf, 'the leaf window is published').not.toBeNull();
    const hw = SPEC.interior.halfWidth, rear = SPEC.rear!;
    const pockets = SPEC.doors.flatMap(d => [0, 1].map(k => leafSpan(d, k as 0 | 1, 1, SPEC.doorLeaf.width)));
    // (task train-lockbox: every intended side window is cut — zones cab / saloon / rear / nose)
    expect(new Set(w.side.map(s => s.zone))).toEqual(new Set(['cab', 'saloon', 'rear', 'nose']));
    for (const s of w.side) {
      const tag = `${s.zone} window ${s.x0}..${s.x1} side ${s.side}`;
      expect(s.y0, tag).toBeGreaterThan(SPEC.floorY); expect(s.y1, tag).toBeLessThan(SPEC.ceilingY);
      if (s.zone === 'nose') {
        // beyond a bulkhead, joined to that end's corner end window (one wraparound opening)
        expect(Math.min(Math.abs(s.x0), Math.abs(s.x1)), tag).toBeGreaterThan(SPEC.interior.x1 - 1e-6);
        const e = w.end.find(q => noseCorners(SPEC, q).includes(s));
        expect(e, `${tag}: joined to an end window`).toBeTruthy();
        continue;
      }
      expect(s.skinZ, tag).toBeGreaterThan(hw); expect(s.skinZ, tag).toBeLessThanOrEqual(SPEC.width / 2 + 1e-6);
      if (s.zone === 'cab') expect(s.x0 >= SPEC.cab.x0 + TRAIN_VIEW.partition && s.x1 <= SPEC.interior.x1 + 1e-6, `${tag} in the cab`).toBe(true);
      if (s.zone === 'rear') {
        // in the rear compartment, over the rear door's leaf pocket (a pocket door seen through glass): the pocket is published
        expect(s.x0 >= SPEC.interior.x0 - 1e-6 && s.x1 <= rear.x1 - TRAIN_VIEW.partition, `${tag} in the rear compartment`).toBe(true);
        expect(s.pocket, `${tag} names its pocket`).toBeTruthy();
        const lp = pockets.find(([a, b]) => Math.abs(a - s.pocket!.x0) < 0.002 && Math.abs(b - s.pocket!.x1) < 0.002);
        expect(lp, `${tag}: the pocket is a real open-leaf span`).toBeTruthy();
        continue;
      }
      if (s.zone === 'saloon') expect(s.x0 > rear.x1 && s.x1 < SPEC.cab.x0, `${tag} in the saloon`).toBe(true);
      for (const [a, b] of pockets) expect(s.x1 <= a - 0.03 || s.x0 >= b + 0.03, `${tag} clear of the open leaf ${a.toFixed(3)}..${b.toFixed(3)}`).toBe(true);
    }
    for (const e of w.end) {
      expect(e.z0).toBeGreaterThanOrEqual(-hw - 1e-6); expect(e.z1).toBeLessThanOrEqual(hw + 1e-6);
      expect(e.y0).toBeGreaterThan(SPEC.floorY); expect(e.y1).toBeLessThan(SPEC.ceilingY);
      expect(e.skinX).toBeGreaterThan(SPEC.interior.x1); expect(e.skinX).toBeLessThanOrEqual(SPEC.length / 2 + 1e-6);
    }
    const l = w.leaf!;
    expect(l.x0).toBeGreaterThan(-SPEC.doorLeaf.width / 2); expect(l.x1).toBeLessThan(SPEC.doorLeaf.width / 2);
    expect(l.y0).toBeGreaterThan(0); expect(l.y1).toBeLessThan(SPEC.doorLeaf.height);
  });

  it('task train-lockbox: the rear windows show the pocket door — nothing of the frame in the leaf\'s slide, a stop post at its parked end; the nose corners close as an L', () => {
    const view = buildTrainView(SPEC, new TrainMaterials());
    const trim = view.fixed.getObjectByName('train-trim') as THREE.Mesh, glassM = view.fixed.getObjectByName('train-glass') as THREE.Mesh;
    const tp = trim.geometry.attributes.position, ti = trim.geometry.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), box = new THREE.Box3();
    const L = SPEC.doorLeaf;
    for (const w of windowsOf(SPEC).side.filter(q => q.pocket)) {
      // the leaf's slot inside the pocket span at window height: no trim triangle crosses it (the leaf slides through freely)
      const z0 = w.side * (L.outerZ - L.thickness), z1 = w.side * L.outerZ;
      const slot = new THREE.Box3(new THREE.Vector3(w.pocket!.x0, w.y0, Math.min(z0, z1)), new THREE.Vector3(w.pocket!.x1, w.y1, Math.max(z0, z1)));
      slot.expandByScalar(-0.001);
      for (let i = 0; i < ti.count; i += 3) {
        a.fromBufferAttribute(tp, ti.getX(i)); b.fromBufferAttribute(tp, ti.getX(i + 1)); c.fromBufferAttribute(tp, ti.getX(i + 2));
        box.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c);
        const inter = box.clone().intersect(slot);
        const solid = !inter.isEmpty() && inter.max.x - inter.min.x > 1e-4 && inter.max.y - inter.min.y > 1e-4 && inter.max.z - inter.min.z > 1e-4;
        const flat = !inter.isEmpty() && [inter.max.x - inter.min.x, inter.max.y - inter.min.y, inter.max.z - inter.min.z].filter(d => d > 1e-4).length >= 2;
        expect(solid || flat, `trim triangle ${i / 3} in the leaf slot of the ${w.zone} window side ${w.side}`).toBe(false);
      }
      // the stop post: its +X face TRAIN_VIEW.pocketStopGap short of the parked leaf's -X end, |z| lining -> skin, window height
      const px = w.pocket!.x0 - TRAIN_VIEW.pocketStopGap;
      let post = false;
      for (let i = 0; i < tp.count; i++) if (Math.abs(tp.getX(i) - px) < 1e-6 && Math.abs(tp.getY(i) - w.y1) < 1e-6 && Math.abs(Math.abs(tp.getZ(i)) - w.skinZ) < 1e-6) post = true;
      expect(post, `the pocket-end stop post behind the ${w.zone} window side ${w.side}`).toBe(true);
      // the stop post and frame never reach into the Lockbox (it stands below the sill, inside the lining)
      const lb = SPEC.lockbox!;
      expect(w.y0).toBeGreaterThan(SPEC.floorY + lb.height);
    }
    // the nose: a side pane at |z| = skinZ from the corner rect's inner edge to the end pane (never outside the skin curve)
    const gp = glassM.geometry.attributes.position;
    for (const e of windowsOf(SPEC).end) for (const n of noseCorners(SPEC, e)) {
      const q = nosePane(e, n), z = n.side * n.skinZ;
      expect(q.x1 - q.x0).toBeGreaterThan(0.05);
      expect(Math.min(Math.abs(q.x0), Math.abs(q.x1))).toBeCloseTo(Math.min(Math.abs(n.x0), Math.abs(n.x1)), 6); // from the inner edge
      expect(Math.max(Math.abs(q.x0), Math.abs(q.x1))).toBeCloseTo(e.skinX, 6); // to the end pane
      let found = false;
      for (let i = 0; i < gp.count; i++) if (Math.abs(gp.getZ(i) - z) < 1e-6 && Math.abs(gp.getX(i) - q.x1) < 1e-6 && Math.abs(gp.getY(i) - q.y1) < 1e-6) found = true;
      expect(found, `nose side pane at z ${z}`).toBe(true);
    }
    for (const g of view.geometries) g.dispose();
  });

  it('task train-lockbox: a newly cut (saloon) window gets the wall art\'s painted glass laid exactly on its hole; the cab walls keep their mapping, continuous on both sides', () => {
    // a saloon window on each side between the rear and middle doors, plus the cab windows the spec already has
    const sal = [{side: -1 as const, zone: 'saloon', x0: -3.6, x1: -2.4, y0: 1.98, y1: 2.82, skinZ: 1.46}, {side: 1 as const, zone: 'saloon', x0: -3.6, x1: -2.4, y0: 1.98, y1: 2.82, skinZ: 1.46}];
    const sp = {...SPEC, windows: {...SPEC.windows, side: [...SPEC.windows.side.filter(w => w.zone === 'cab'), ...sal]}} as typeof SPEC;
    const view = buildTrainView(sp, new TrainMaterials());
    const walls = view.fixed.getObjectByName('train-walls') as THREE.Mesh;
    const pos = walls.geometry.attributes.position, uv = walls.geometry.attributes.uv;
    const at = (x: number, y: number, z: number) => {
      const out: [number, number][] = [];
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - x) < 1e-6 && Math.abs(pos.getY(i) - y) < 1e-6 && Math.abs(pos.getZ(i) - z) < 1e-6) out.push([uv.getX(i), uv.getY(i)]);
      return out;
    };
    const hw = SPEC.interior.halfWidth;
    for (const w of sal) {
      // the hole's corner seen as the viewer's lower-left (from inside: -Z wall = smaller x, +Z wall = larger x) carries the painted
      // glass's lower-left corner; the upper-right likewise
      const ll = at(w.side < 0 ? w.x0 : w.x1, w.y0, w.side * hw), ur = at(w.side < 0 ? w.x1 : w.x0, w.y1, w.side * hw);
      expect(ll.length, 'a lining vertex on the hole corner').toBeGreaterThan(0);
      for (const [u, v] of ll) { expect(u).toBeCloseTo(WALL_ART_GLASS.u0, 6); expect(v).toBeCloseTo(WALL_ART_GLASS.v0, 6); }
      for (const [u, v] of ur) { expect(u).toBeCloseTo(WALL_ART_GLASS.u1, 6); expect(v).toBeCloseTo(WALL_ART_GLASS.v1, 6); }
    }
    // the cab walls (accepted mapping): every lining vertex shared by two pieces carries ONE uv (no per-piece reversal on +Z)
    const seen = new Map<string, string>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x < SPEC.cab.x0) continue;
      const k = `${x.toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`, u = `${uv.getX(i).toFixed(5)},${uv.getY(i).toFixed(5)}`;
      if (seen.has(k)) expect(seen.get(k), `uv continuity at ${k}`).toBe(u); else seen.set(k, u);
    }
    for (const g of view.geometries) g.dispose();
  });

  it('glass in every cut window and leaf window, the lining open behind it, collision unchanged, bullets stop at the glass', () => {
    const layout = layoutOf('subway');
    const {host} = makeHost(layout);
    const fxCalls: string[] = [];
    const h2 = {...host, bulletHitHandlers: [] as ((wh: never, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[],
      fx: {impact: (_p: THREE.Vector3, _n: THREE.Vector3, surface: string) => { fxCalls.push(surface); }}};
    const rt = track(installPlayerTrain(h2, {spec, models: () => models}));
    for (const s of h2.sectionHooks) s.build?.(layout);
    const p = h2.trainPlacement!, t = rt.train!, v = t.view;
    // --- the view: one static glass mesh (both faces, transparent, no depth write, no shadow), a pane in each leaf window ---
    const glass = v.fixed.getObjectByName('train-glass') as THREE.Mesh;
    expect(glass).toBeTruthy();
    const gm = glass.material as THREE.Material;
    expect(gm.transparent).toBe(true);
    expect(gm.depthWrite).toBe(false);
    expect(gm.side).toBe(THREE.DoubleSide);
    expect(glass.castShadow).toBe(false);
    expect(glass.geometry.index!.count / 6).toBe(WIN.side.length + WIN.end.length);
    // the leaf-window glass: ONE instanced draw for all twelve panes (both faces; never culler-registered: it moves)
    const lg = v.leafGlass!;
    expect(lg.mesh.isInstancedMesh).toBe(true);
    expect(lg.mesh.count).toBe(SPEC.doors.length * 2);
    expect(lg.mesh.parent).toBe(v.root);
    expect((lg.mesh.material as THREE.Material).side).toBe(THREE.DoubleSide);
    // looking out through each window from inside: the first thing on the ray is the glass (no lining in front of it), then nothing
    // of the car until past the skin plane
    const ray = new THREE.Raycaster();
    v.root.updateMatrixWorld(true);
    const opaque: THREE.Object3D[] = [];
    v.fixed.traverse(o => { if ((o as THREE.Mesh).isMesh && o !== glass) opaque.push(o); });
    const look = (from: [number, number, number], to: [number, number, number]) => {
      const a = trainToWorld(p, ...from), b = trainToWorld(p, ...to);
      const o = new THREE.Vector3(a.x, a.y, a.z), d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z), len = d.length();
      ray.set(o, d.normalize()); ray.far = len;
      return {glass: ray.intersectObject(glass, false)[0]?.distance ?? null, opaque: ray.intersectObjects(opaque, false)[0]?.distance ?? null, len};
    };
    for (const w of WIN.side) {
      const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
      const r = look([cx, cy, 0], [cx, cy, w.side * (w.skinZ + 0.3)]);
      expect(r.glass, 'side glass').not.toBeNull();
      expect(r.opaque === null || r.opaque > r.glass!, 'nothing opaque in front of the side glass').toBe(true);
    }
    for (const w of WIN.end) {
      const cz = (w.z0 + w.z1) / 2, cy = (w.y0 + w.y1) / 2, x0 = w.end > 0 ? SPEC.interior.x1 - 0.5 : SPEC.interior.x0 + 0.5;
      const r = look([x0, cy, cz], [w.end * (w.skinX + 0.3), cy, cz]);
      expect(r.glass, 'end glass').not.toBeNull();
      expect(r.opaque === null || r.opaque > r.glass!, 'nothing opaque in front of the end glass').toBe(true);
    }
    // --- collision: unchanged — the full wall boxes stay in game.propIndex (glass is not passable) ---
    for (const b of t.col.statics) expect(h2.propIndex.props).toContain(b);
    expect(t.col.statics.length).toBe(trainColliders(SPEC, p, null).statics.length);
    // a real Player pushing into the cab side window from inside stays in the car
    const w0 = WIN.side[0];
    const at = trainToWorld(p, (w0.x0 + w0.x1) / 2 - 0.6, SPEC.floorY, 0);
    h2.player.spawn(at.x, at.z, 0, at.y);
    face(h2 as Host, p, (w0.x0 + w0.x1) / 2 - 0.6, -3);
    step(h2 as Host, 2, W());
    expect(Math.abs(local(h2 as Host, p).z)).toBeLessThan(SPEC.interior.halfWidth - h2.player.radius + 0.01);
    // --- bullets: a shot through a window stops at its glass (a glass impact, not the steel); a shot at a shut door's window too ---
    const shoot = (from: [number, number, number], to: [number, number, number]) => {
      const a = trainToWorld(p, ...from), b = trainToWorld(p, ...to);
      const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      const wh = raycastWorld(h2.levels, layout.props, a, {x: d.x, y: d.y, z: d.z}, 30, layout.trench.floorY);
      const point = new THREE.Vector3(a.x, a.y, a.z).addScaledVector(d, wh.t);
      const handled = h2.bulletHitHandlers.some(f => f(wh as never, point, d, 1, 20));
      return {wh, point: worldToTrain(p, point.x, point.y, point.z), handled};
    };
    const sw = shoot([(w0.x0 + w0.x1) / 2, (w0.y0 + w0.y1) / 2, 0], [(w0.x0 + w0.x1) / 2, (w0.y0 + w0.y1) / 2, -3]);
    expect(sw.wh.kind).toBe('prop');
    expect(sw.handled).toBe(true);
    expect(Math.abs(sw.point.z)).toBeCloseTo(w0.skinZ - TRAIN_VIEW.glassInset - 0.01, 3);
    const we = WIN.end[0];
    const ew = shoot([SPEC.cab.x0 + 0.3, (we.y0 + we.y1) / 2, 0], [20, (we.y0 + we.y1) / 2, 0]);
    expect(ew.handled).toBe(true);
    expect(ew.point.x).toBeCloseTo(we.skinX - TRAIN_VIEW.glassInset - 0.01, 3);
    // the middle platform door's window (shut): the leaf glass, at the leaf
    const d = t.doors[middleDoor(-1)], dd = d.col.door;
    const [ga, gb] = [dd.x - SPEC.doorLeaf.width / 2 + WIN.leaf.x0, dd.x - SPEC.doorLeaf.width / 2 + WIN.leaf.x1];
    const ly = SPEC.floorY + (WIN.leaf.y0 + WIN.leaf.y1) / 2; // (the leaf rect's y is above the leaf bottom = the car floor)
    const lw = shoot([(ga + gb) / 2, ly, 0], [(ga + gb) / 2, ly, -3]);
    expect(lw.handled).toBe(true);
    expect(Math.abs(lw.point.z)).toBeCloseTo(SPEC.doorLeaf.outerZ - SPEC.doorLeaf.thickness - 0.002, 3);
    // a shot at the wall beside a window: the steel (the damage system), not the glass
    const ww = shoot([3.0, 2.0, 0], [3.0, 2.0, -3]);
    expect(ww.handled).toBe(false);
    expect(Math.abs(ww.point.z)).toBeCloseTo(SPEC.interior.halfWidth, 3);
    expect(fxCalls.filter(x => x === 'glass').length).toBe(3);
    expect(rt.counts.glassHits).toBe(3);
    // the leaf glass slides with the leaf: open the door, its pane instance and its glass box are in the pocket
    const slot = lg.slots.findIndex(sl => sl.door === d.col.index && sl.k === 0);
    const at0 = new THREE.Matrix4(), at1 = new THREE.Matrix4(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    lg.mesh.getMatrixAt(slot, at0); p0.setFromMatrixPosition(at0);
    rt.setDoor(t.doors.indexOf(d), true);
    step(h2 as Host, TRAIN_DOOR.time + 0.1);
    lg.mesh.getMatrixAt(slot, at1); p1.setFromMatrixPosition(at1);
    expect(p0.x - p1.x).toBeCloseTo(dd.width / 2 + TRAIN_VIEW.leafClear, 3); // (root-local: -X, the pocket side of leaf 0)
    const lgb = d.col.leafGlass![0], lgl = worldToTrain(p, lgb.x, 0, lgb.z);
    expect(lgl.x).toBeLessThan(dd.x - dd.width / 2); // in the wall pocket, out of the opening
    // the glass never highlights (only the leaf panels do)
    for (const m of rt.leafMeshes(d)) expect(m.userData.trainGlass).toBeFalsy();
  });
});

describe('player train: out of the middle platform door and back on every level', () => {
  for (const level of ['office', 'mall'] as const) {
    it(`${level}: spawn -> aim + [E] -> platform -> back inside`, () => {
      const layout = layoutOf(level);
      const {host} = makeHost(layout);
      const rt = track(installPlayerTrain(host));
      for (const s of host.sectionHooks) s.build?.(layout);
      const p = host.trainPlacement!, t = rt.train!;
      try {
        spawnInside(host, rt, p);
        const d = t.doors[middleDoor(-1)], dd = d.col.door;
        face(host, p, dd.x, -SPEC.interior.halfWidth);
        expect(host.interactHandlers.some(f => f())).toBe(true);
        step(host, TRAIN_DOOR.time + 0.1);
        expect(d.col.gate!.open).toBe(true);
        face(host, p, dd.x, -4);
        let minY = Infinity;
        for (let i = 0; i < 120; i++) { step(host, DT, W()); minY = Math.min(minY, host.player.y); }
        expect(rt.playerInside()).toBe(false);
        expect(host.player.y).toBeCloseTo(layout.grid.floorAt(host.player.x, host.player.z), 2);
        face(host, p, dd.x, 0);
        for (let i = 0; i < 120; i++) { step(host, DT, W()); minY = Math.min(minY, host.player.y); }
        expect(rt.playerInside()).toBe(true);
        expect(minY, 'never in the gap / bed').toBeGreaterThan(p.floorY - 0.5);
      } finally {
        for (const s of host.sectionHooks) s.teardown?.();
      }
    });
  }
});

describe('player train: the cooked Meshy models (lane ASSETS) in place', () => {
  let models: {shell: GLTF; door: GLTF; console: GLTF};
  beforeAll(async () => {
    models = {shell: await loadStripped(SPEC.models.shell.url), door: await loadStripped(SPEC.models.doorLeaf.url), console: await loadStripped(SPEC.models.console.url)};
  }, 120000);

  it('shell / leaves / desk placed by the spec; the desk collides; a walk into the cab stops at the desk; the cost', () => {
    const layout = layoutOf('subway');
    const {host} = makeHost(layout);
    const rt = track(installPlayerTrain(host, {models: () => models}));
    for (const s of host.sectionHooks) s.build?.(layout);
    const p = host.trainPlacement!, t = rt.train!;
    try {
      expect(t.view.source).toMatchObject({shell: 'model', door: 'model', console: 'model'});
      // the desk: in the cab, on the floor, and a collision box where it is drawn
      const desk = t.view.fixed.getObjectByName('train-console')!;
      const bb = new THREE.Box3().setFromObject(desk);
      const lo = worldToTrain(p, bb.min.x, bb.min.y, bb.min.z), hi = worldToTrain(p, bb.max.x, bb.max.y, bb.max.z);
      const dx0 = Math.min(lo.x, hi.x), dx1 = Math.max(lo.x, hi.x);
      expect(dx0).toBeGreaterThan(SPEC.cab.x0);
      expect(dx1).toBeLessThanOrEqual(SPEC.interior.x1 + 0.01);
      expect(bb.min.y).toBeCloseTo(p.floorY, 3);
      expect(t.col.statics.length).toBe(trainColliders(SPEC, p, null).statics.length + 1);
      // leaves: baked at runtime size (scale ~1), the outer face on doorLeaf.outerZ, the +X leaf mirrored
      for (const pair of t.view.leaves) {
        for (const [k, holder] of pair.entries()) {
          const inner = holder.children[0];
          expect(Math.abs(inner.scale.x)).toBeCloseTo(1, 2);
          expect(Math.sign(inner.scale.x)).toBe(k === 1 ? -1 : 1);
          const lb = new THREE.Box3().setFromObject(holder);
          const zs = [worldToTrain(p, 0, 0, lb.min.z).z, worldToTrain(p, 0, 0, lb.max.z).z].map(Math.abs);
          expect(Math.max(...zs)).toBeCloseTo(SPEC.doorLeaf.outerZ, 3);
        }
      }
      // task train-shell-followup: GENUINELY see-through with the cooked (cut) shell and leaf — from inside, a ray through the middle of
      // every published window passes the lining hole, the glass and the shell's cut without touching anything opaque out to 0.5 m
      // past the skin; the glass is there (one static mesh: every side + end window; one instanced draw: every leaf window)
      const WN = windowsOf(SPEC);
      const glassMesh = t.view.fixed.getObjectByName('train-glass') as THREE.Mesh;
      expect(glassMesh.geometry.index!.count / 6).toBe(WN.side.length + WN.end.length);
      expect(t.view.leafGlass!.mesh.count).toBe(SPEC.doors.length * 2);
      t.view.root.updateMatrixWorld(true);
      const solid: THREE.Object3D[] = [];
      t.view.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.trainGlass && !m.userData.highlightPrototype) solid.push(m); });
      const caster = new THREE.Raycaster();
      const clear = (from: [number, number, number], to: [number, number, number], what: string) => {
        const a = trainToWorld(p, ...from), b = trainToWorld(p, ...to);
        const o = new THREE.Vector3(a.x, a.y, a.z), dv = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
        caster.set(o, dv.clone().normalize()); caster.far = dv.length();
        const hit = caster.intersectObjects(solid, false)[0];
        expect(hit ? `${hit.object.name} at ${hit.distance.toFixed(3)}` : null, `${what}: nothing opaque on the view out`).toBeNull();
        caster.far = dv.length();
        expect(caster.intersectObject(glassMesh, false).length + caster.intersectObject(t.view.leafGlass!.mesh, false).length, `${what}: through glass`).toBeGreaterThan(0);
      };
      for (const w of WN.side) {
        const cy = (w.y0 + w.y1) / 2;
        if (w.zone === 'nose') {
          // the corner's side pane: from outside, beside the nose, the view goes in through the glass (no skin, no sleeve face first)
          const e = WN.end.find(q => noseCorners(SPEC, q).includes(w))!, q = nosePane(e, w), cx = (q.x0 + q.x1) / 2;
          clear([cx, (q.y0 + q.y1) / 2, w.side * 2.5], [cx, (q.y0 + q.y1) / 2, w.side * (w.skinZ - 0.02)], `nose corner x ${w.x0}..${w.x1} side ${w.side}`);
          continue;
        }
        // a window over the rear door's pocket: look past the pocket-end stop post (it stands at the parked leaf's -X end)
        const cx = w.pocket ? (w.x0 + w.pocket.x0 - TRAIN_VIEW.pocketStopGap - TRAIN_VIEW.pocketStop) / 2 : (w.x0 + w.x1) / 2;
        clear([cx, cy, 0], [cx, cy, w.side * (w.skinZ + 0.5)], `${w.zone} side window x ${w.x0}..${w.x1} side ${w.side}`);
      }
      for (const w of WN.end) {
        const cz = (w.z0 + w.z1) / 2, cy = (w.y0 + w.y1) / 2;
        const from = w.end > 0 ? SPEC.console.x - 0.5 : (SPEC.rear!.x0 + SPEC.rear!.x1) / 2;
        clear([from, Math.max(cy, SPEC.floorY + 1.3), cz], [w.end * (w.skinX + 0.5), cy, cz], `end ${w.end} window z ${w.z0}..${w.z1}`);
      }
      for (const dd of SPEC.doors.filter(q => q.side < 0)) {
        const lx = dd.x - SPEC.doorLeaf.width / 2 + (WN.leaf!.x0 + WN.leaf!.x1) / 2, ly = SPEC.floorY + 1.4; // leaf 0 of the shut pair (clear of the T-handle lever)
        clear([lx, ly, 0], [lx, ly, -2.5], `door ${dd.x} leaf window`);
      }
      // the cooked leaf highlights like a drawer (its Meshy PBR material cloned, emissive pulse), and only while aimed
      spawnInside(host, rt, p);
      step(host, DT);
      const aimed = t.doors[middleDoor(-1)];
      expect(rt.highlighted).toBe(aimed);
      for (const m of rt.leafMeshes(aimed)) {
        expect(m.material).not.toBe(m.userData.baseMat);
        expect((m.material as THREE.MeshStandardMaterial).map).toBe((m.userData.baseMat as THREE.MeshStandardMaterial).map);
      }
      // through the partition doorway into the cab: the desk stops the walk
      face(host, p, SPEC.cab.x0 - 0.5, 0);
      step(host, 1.5, W());
      face(host, p, 20, 0);
      step(host, 3, W());
      const q = local(host, p);
      expect(q.x, 'into the cab').toBeGreaterThan(SPEC.cab.x0 + 0.3);
      expect(q.x, 'stopped by the desk').toBeLessThan(dx0 - host.player.radius + 0.02);
      expect(rt.playerInside()).toBe(true);
      const cost = viewCost(t.view.root);
      // 25 draws: 9 lining + the window glass + shell + desk + 12 leaves + ONE instanced leaf-glass draw (task train-shell-followup)
      // + the Lockbox (task train-lockbox: body, lid, liner)
      expect(cost.meshes).toBeLessThanOrEqual(30);
      expect(cost.tris).toBeLessThan(160000);
    } finally {
      for (const s of host.sectionHooks) s.teardown?.();
    }
  });
});
