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
import {beforeAll, describe, expect, it, vi} from 'vitest';
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
import {TRAIN_DOOR, TRAIN_LIGHTS, PlayerTrainRuntime, installPlayerTrain, interiorLightMounts, trainColliders, type TrainHost} from '../src/world/playerTrain';
import {viewCost} from '../src/world/playerTrainView';

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
      const rt = installPlayerTrain(host);
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
      expect(cost.meshes).toBeLessThanOrEqual(24);
      console.info(`player train ${level}: ${cost.meshes} meshes / ${cost.tris} tris (procedural shell); volume ${JSON.stringify({x0: t.col.volume.x0, x1: t.col.volume.x1, z0: t.col.volume.z0, z1: t.col.volume.z1})}`);
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
    const rt = installPlayerTrain(host);
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
    } finally {
      for (const s of host.sectionHooks) s.teardown?.();
    }
  });

  it('never closes on a body: refused in the doorway, re-opens when stepped into, push-open, the gap stays closed from the platform', () => {
    const {host, toasts, pushKeys} = makeHost(layout);
    const rt = installPlayerTrain(host);
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
    const rt = installPlayerTrain(host);
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
