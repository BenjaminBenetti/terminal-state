// Task studio-surface-run-lift-reliability-and-cab-20261118-023909-01: the Surface Run cargo lift's ride, focused (no Game; the real-Game
// ride is surface-lift-ride.test.ts). User: "when riding the lift up a black plane passes through you" / "you cannot look left and right
// when in the lift only up and down" / "the lift never opens … and so you are stuck".
//  1. SEALED frames (world/surface/liftRuntime.ts drawSealed): during the draw every renderable outside the car's view and the kept roots
//     is off the camera's layers (CULL_LAYER), lights and kept roots untouched, an already culled one left as it was; after the draw —
//     also a draw that throws — every mask exactly as before. `sealed`: travel / waiting with the doors shut only.
//  2. LOOK: the car's tick folds the mouse-applied world yaw into the car-local yaw before writing the pose back (the transit gap ticks
//     the car BEFORE stepping the player: the turn used to be put back every frame).
//  3. The ride's wait is BOUNDED like the loading screen's warm-up (LIFT_RIDE_WAIT). (task studio-surface-host-ground-connectors-20261118-
//     053602-01, lane READY: the ride waits for its exit's FIRST VIEW now — render/firstView.ts waitForFirstView, its ready / cancelled /
//     budget / stall / paused cases in tests/crossing-first-view.test.ts; the old whole-job wait, waitForLiftCompile, is gone.)
import * as THREE from 'three';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {CULL_LAYER} from '../src/world/levelCulling';
import {LIFT_RIDE_WAIT, SurfaceLiftRuntime} from '../src/world/surface/liftRuntime';

const CULL = (1 << CULL_LAYER) >>> 0;

afterEach(() => { vi.useRealTimers(); });

/** A runtime on a stand-in game, its current end a minimal drawn view (the fields tick / drawSealed read). */
function rig(yaw = 0.7) {
  const player = {x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, eye: 0, stanceEye: 1.6, landDip: 0, pitch: 0};
  const game = {player, sfx: null, promptProviders: [] as (() => string | null)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as unknown[], scene: new THREE.Scene()};
  const R = new SurfaceLiftRuntime(game as never);
  const root = new THREE.Group();
  root.name = 'cargo-lift-surface';
  const end = {lift: {}, plan: {}, frame: {cx: 10, cz: 20, yaw, hx: 3, hz: 2.5}, stops: [0, 9] as [number, number], home: 0 as const, lamp: new THREE.Mesh(), inWorld: true,
    view: {root, setCab: () => {}, setLanding: () => {}, setIndicator: () => {}}};
  (R as unknown as {site: unknown}).site = end;
  return {R, game, player, end, root};
}

describe('Surface lift: sealed frames draw only the car', () => {
  it('moves every other renderable off the camera layers for the draw only; lights, kept roots and culled meshes untouched', () => {
    const {R, game, root} = rig();
    const scene = game.scene, mat = new THREE.MeshBasicMaterial(), geo = new THREE.BoxGeometry();
    const world = new THREE.Group(), floor = new THREE.Mesh(geo, mat), ceiling = new THREE.Mesh(geo, mat), culled = new THREE.Mesh(geo, mat);
    const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()), line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const lamp = new THREE.PointLight(), keep = new THREE.Group(), kept = new THREE.Mesh(geo, mat), car = new THREE.Mesh(geo, mat), camera = new THREE.PerspectiveCamera();
    ceiling.layers.enable(3);
    culled.layers.set(CULL_LAYER);
    lamp.layers.enable(5);
    world.add(floor, ceiling, culled, pts, line, lamp, root); // (the adopted car view inside the world group)
    root.add(car);
    keep.add(kept);
    scene.add(world, keep, camera);
    const before = new Map<THREE.Object3D, number>();
    scene.traverse(o => before.set(o, o.layers.mask));
    R.phase = 'travel';
    R.door = 0;
    expect(R.sealed).toBe(true);
    let during: Map<THREE.Object3D, number> | null = null;
    R.drawSealed(scene, [camera, keep], () => { during = new Map(); scene.traverse(o => during!.set(o, o.layers.mask)); });
    expect(during!.get(floor)).toBe(CULL);
    expect(during!.get(ceiling)).toBe(CULL);
    expect(during!.get(pts)).toBe(CULL);
    expect(during!.get(line)).toBe(CULL);
    expect(during!.get(culled), 'already culled: as it was').toBe(CULL);
    expect(during!.get(lamp), 'lights keep their layers (no light-set change)').toBe(before.get(lamp));
    expect(during!.get(car), 'the car\'s own view drawn').toBe(before.get(car));
    expect(during!.get(kept), 'a kept root drawn').toBe(before.get(kept));
    const after = new Map<THREE.Object3D, number>();
    scene.traverse(o => after.set(o, o.layers.mask));
    expect(after).toEqual(before);
    // a draw that throws: the masks come back all the same
    expect(() => R.drawSealed(scene, [camera], () => { throw new Error('qa: draw failed'); })).toThrow('qa: draw failed');
    scene.traverse(o => expect(o.layers.mask).toBe(before.get(o)));
    expect(R.counts.sealedFrames).toBe(2);
  });

  it('is sealed only while the shut car travels or waits', () => {
    const {R} = rig();
    const at = (phase: SurfaceLiftRuntime['phase'], door: number) => { R.phase = phase; R.door = door; return R.sealed; };
    expect(at('idle', 1)).toBe(false);
    expect(at('closing', 0.4), 'the doors still open: the world is seen').toBe(false);
    expect(at('travel', 0)).toBe(true);
    expect(at('waiting', 0)).toBe(true);
    expect(at('opening', 0), 'arrived at the stop: the world drawn before the doors part').toBe(false);
    expect(at('reopening', 0)).toBe(false);
    (R as unknown as {site: unknown}).site = null;
    expect(at('travel', 0), 'no end drawn').toBe(false);
  });
});

describe('Surface lift: the held rider\'s look', () => {
  it('keeps a mouse turn applied before the car ticks (the transit gap order) and maps the car frame both ways', () => {
    const {R, player, end} = rig(0.7);
    (R as unknown as {takePlayer(e: unknown): void}).takePlayer(end);
    R.phase = 'travel';
    R.door = 0;
    R.travel = 1;
    player.yaw = 1.2; // (applyMouseLook turned the world yaw)
    R.tick(1 / 60);
    expect(player.yaw, 'the turn survives the car\'s tick').toBeCloseTo(1.2, 9);
    expect((R as unknown as {local: {yaw: number}}).local.yaw, 'car-local yaw = world yaw - car frame yaw').toBeCloseTo(1.2 - 0.7, 9);
    player.yaw = -0.4;
    R.tick(1 / 60);
    expect(player.yaw).toBeCloseTo(-0.4, 9);
    expect(player.y, 'the pose still written (the car floor at its travel)').toBeCloseTo(R.cabY(end as never), 9);
  });
});

describe('Surface lift: the bounded wait', () => {
  it('bounds the ride like the loading screen\'s warm-up', async () => {
    const {WARMUP_DEFAULTS} = await import('../src/render/warmup');
    expect(LIFT_RIDE_WAIT.budgetMs).toBe(WARMUP_DEFAULTS.budgetMs);
    expect(LIFT_RIDE_WAIT.stallMs).toBeLessThan(LIFT_RIDE_WAIT.budgetMs);
  });
});
