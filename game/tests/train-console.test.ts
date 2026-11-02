// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the DRIVING CONSOLE of the player's train (world/trainConsole.ts
// + its 'console' owner in world/playerTrain.ts PlayerTrainRuntime): an [E] interactable in the front cab that opens the primary's map
// (onConsoleInteract), with the shared highlight and a readable prompt, the doors' / Lockbox's reach, occluded by the partition walls
// (the open cab doorway passes), no console in the rear compartment, and the same aim in the MOVING car (the ride's car frame).
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainSpawnPose, trainToWorld, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain} from '../src/world/playerTrain';
import type {TrainModels} from '../src/world/playerTrainView';
import {CONSOLE_DIMS, CONSOLE_PROMPT, consoleLocalRect, inCab} from '../src/world/trainConsole';
import {carToWorld} from '../src/world/trainRideLocal';
import {installTrainRide, type TrainRide} from '../src/world/trainRide';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
let cached: StationLayout | null = null;
const layout = (): StationLayout => (cached ??= LEVELS.subway.generate('main', {levelSeed: 4242}));

class Keys implements MoveInput {
  down() { return false; }
  hit() { return false; }
}

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

function setup(models?: TrainModels) {
  const L = layout();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(L);
  const h = {
    scene, camera, player: new Player(), zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[],
    levels, layout: L, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L) as TrainPlacement | null,
    sfx: null, hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn()},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', world: {culler: {register: vi.fn(), release: vi.fn()}}, run: {current: {level: 'subway', section: 'main'}}, mats: null,
  };
  const rt = installPlayerTrain(h, models ? {models: () => models} : {});
  live.push(rt);
  const ride = installTrainRide(h, rt);
  for (const s of h.sectionHooks) s.build?.(L);
  return {h, rt, ride, p: h.trainPlacement!};
}
type H = ReturnType<typeof setup>['h'];

const sync = (h: H, ride?: TrainRide) => {
  const P = h.player;
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  ride?.tiltCamera(h.camera);
  h.camera.updateMatrixWorld(true);
};
/** Stand at a train-local floor point (parked car) and look at a train-local point. */
function standLook(h: H, p: TrainPlacement, lx: number, lz: number, tx: number, ty: number, tz: number): void {
  const w = trainToWorld(p, lx, SPEC.floorY, lz);
  h.player.spawn(w.x, w.z, 0, w.y);
  const P = h.player, a = trainToWorld(p, tx, ty, tz);
  P.yaw = Math.atan2(-(a.x - P.x), -(a.z - P.z));
  P.pitch = Math.atan2(a.y - P.eye, Math.hypot(a.x - P.x, a.z - P.z));
  sync(h);
}
const frames = (h: H, n = 1, ride?: TrainRide) => {
  for (let i = 0; i < n; i++) {
    if (ride?.riding) ride.stepPlayer(DT, new Keys(), OPTS); else h.player.update(DT, new Keys(), h.levels, h.propIndex, OPTS);
    sync(h, ride);
    for (const f of h.frameHooks) f(DT);
  }
};
const prompt = (h: H) => h.promptProviders.map(f => f()).find(Boolean) ?? null;
const CR = consoleLocalRect(SPEC);
const mid = {x: (CR.x0 + CR.x1) / 2, y: (SPEC.floorY + CR.top) / 2, z: (CR.z0 + CR.z1) / 2};

describe('the driving console', () => {
  it('lies in the front cab (the rear compartment has none), sized like the cooked desk', () => {
    expect(inCab(SPEC, mid.x, mid.z)).toBe(true);
    expect(CR.x0).toBeGreaterThanOrEqual(SPEC.cab.x0);
    expect(CR.x1).toBeLessThanOrEqual(SPEC.interior.x1 + 1e-9);
    expect(CR.x1 - CR.x0).toBeCloseTo(CONSOLE_DIMS[0], 2);
    expect(CR.top - SPEC.floorY).toBeCloseTo(CONSOLE_DIMS[1], 6);
    expect(SPEC.rear!.x1).toBeLessThan(0);
    expect(CR.x0).toBeGreaterThan(SPEC.rear!.x1 + 5);
  });

  it('is no interactable until the primary wires the map; then aim + prompt + [E] call it once', () => {
    const {h, rt, p} = setup();
    standLook(h, p, SPEC.cab.x0 + 0.5, 0, mid.x, mid.y, mid.z);
    frames(h);
    expect(rt.consoleAimed).toBe(false);
    expect(prompt(h)).toBeNull();
    expect(h.interactHandlers.some(f => f())).toBe(false);
    const calls: number[] = [];
    rt.onConsoleInteract = () => calls.push(1);
    frames(h);
    expect(rt.consoleAimed).toBe(true);
    expect(rt.target).toBeNull();
    expect(rt.lockboxAimed).toBe(false);
    expect(prompt(h)).toBe(CONSOLE_PROMPT);
    expect(CONSOLE_PROMPT).toMatch(/\[E\].*Driving console.*map/);
    expect(h.interactHandlers.some(f => f())).toBe(true);
    expect(calls.length).toBe(1);
    expect(rt.counts.console).toBe(1);
    expect(rt.qa().console).toMatchObject({aimed: true, wired: true});
    // looking away: nothing
    standLook(h, p, SPEC.cab.x0 + 0.5, 0, SPEC.cab.x0 - 5, mid.y, 0);
    frames(h);
    expect(rt.consoleAimed).toBe(false);
    expect(prompt(h)).not.toBe(CONSOLE_PROMPT);
  });

  it('reach and occlusion: through the open cab doorway yes, through the partition wall / from too far no; nothing from the rear', () => {
    const {h, rt, p} = setup();
    rt.onConsoleInteract = () => {};
    // through the doorway (z 0), 0.5 m in front of the partition: in reach
    standLook(h, p, SPEC.cab.x0 - 0.5, 0, mid.x, mid.y, 0);
    frames(h);
    expect(rt.consoleAimed).toBe(true);
    // beside the doorway, looking through the partition wall at the desk: blocked
    standLook(h, p, SPEC.cab.x0 - 0.45, -0.95, CR.x0 + 0.1, mid.y, -0.75);
    frames(h);
    expect(rt.consoleAimed).toBe(false);
    // the saloon, 3 m back: out of reach
    standLook(h, p, SPEC.cab.x0 - 2.6, 0, mid.x, mid.y, 0);
    frames(h);
    expect(rt.consoleAimed).toBe(false);
    // the rear compartment, facing its end: no console there
    standLook(h, p, (SPEC.rear!.x0 + SPEC.rear!.x1) / 2, -0.6, SPEC.interior.x0 - 2, mid.y, -0.6);
    frames(h);
    expect(rt.consoleAimed).toBe(false);
    expect(prompt(h)).not.toBe(CONSOLE_PROMPT);
  });

  it('with the cooked desk: the aim box is the model\'s, and the desk glows with the shared highlight while aimed', async () => {
    const gl: GLTF = await loadStripped(SPEC.models.console.url);
    const {h, rt, p} = setup({console: gl});
    expect(rt.consoleRect).not.toBeNull();
    const box = consoleLocalRect(SPEC, rt.consoleRect);
    expect(box.x1 - box.x0).toBeCloseTo(CONSOLE_DIMS[0], 2);
    expect(box.z1 - box.z0).toBeCloseTo(CONSOLE_DIMS[2], 2);
    const meshes = rt.consoleMeshes();
    expect(meshes.length).toBeGreaterThan(0);
    const bases = new Map(meshes.map(m => [m, m.material as THREE.Material]));
    rt.onConsoleInteract = () => {};
    standLook(h, p, SPEC.cab.x0 + 0.5, 0, (box.x0 + box.x1) / 2, (SPEC.floorY + box.top) / 2, 0);
    frames(h);
    expect(rt.consoleAimed).toBe(true);
    for (const m of meshes) {
      expect(m.material).not.toBe(bases.get(m));
      expect((m.material as THREE.MeshStandardMaterial).emissive.r).toBeGreaterThan(0.02);
    }
    standLook(h, p, SPEC.cab.x0 + 0.5, 0, SPEC.cab.x0 - 5, 1.5, 0);
    frames(h);
    for (const m of meshes) expect(m.material).toBe(bases.get(m));
  }, 120000);

  it('works in the MOVING car: the aim is in the ride\'s car frame (the car far from its placement)', async () => {
    const {h, rt, ride, p} = setup();
    const calls: number[] = [];
    rt.onConsoleInteract = () => calls.push(1);
    const pose = trainSpawnPose(h.layout, p);
    h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
    sync(h, ride);
    void ride.depart();
    for (let t = 0; t < 80 && ride.phase !== 'transit'; t += DT) frames(h, 1, ride);
    expect(ride.phase).toBe('transit');
    // stand in the cab (car-local) and look at the desk through the car's pose
    ride.local.x = SPEC.cab.x0 + 0.5; ride.local.z = 0;
    ride.writePlayer();
    const P = h.player, a = carToWorld(ride.pose, mid.x, mid.y, mid.z);
    P.yaw = Math.atan2(-(a.x - P.x), -(a.z - P.z));
    P.pitch = Math.atan2(a.y - P.eye, Math.hypot(a.x - P.x, a.z - P.z));
    sync(h, ride);
    frames(h, 2, ride);
    expect(Math.hypot(P.x - p.x, P.z - p.z)).toBeGreaterThan(100); // far from the parked placement
    expect(rt.consoleAimed).toBe(true);
    expect(prompt(h)).toBe(CONSOLE_PROMPT);
    expect(h.interactHandlers.some(f => f())).toBe(true);
    expect(calls.length).toBe(1);
    // the doors are locked while it moves: no door prompt anywhere in the car
    expect(rt.target).toBeNull();
    ride.reset();
  });
});

beforeAll(() => { layout(); }, 120000);
