// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the moving player train (world/trainRide.ts + trainRideLocal.ts
// + trainRideRoute.ts + trainTransitTunnel.ts and their hooks in world/playerTrain.ts), on generated levels with a fake Game host and
// the REAL Player body / PlayerTrainRuntime:
//  - ride mode's car-local collision model: walls (closed side doors), end walls, both partitions and their doorways, the console, the
//    Lockbox; feet on the car floor (no drop), crouch / jump / landing through Player.update itself;
//  - the car pose maps: exact for the parked yaws 0 / PI (= trainToWorld / worldToTrain), inverse round trips for any pose;
//  - the sequence: depart refused outside the car / with a blocked door; doors closed before the car moves; the car runs into its bed
//    end's tunnel (or the bed-end fallback), is handed to the transit loop, re-arrives and stops EXACTLY at the placement with the
//    player at the same car-local pose (rideDemo's same-station path) — and across a world teardown / a NEW station's build the
//    runtime adopts the riding car's view (one TrainView, no duplicate); no drift over a long transit; a 2 s hitch only advances the
//    clamped dt (no teleport); the jostle stays bounded; weapons / drops refused while riding.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import {generateStation} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE, CROUCH_EYE, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainSpawnPose, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain} from '../src/world/playerTrain';
import {TRAIN_VIEW, partitionsOf} from '../src/world/playerTrainView';
import {lockboxFootprint} from '../src/world/trainLockbox';
import {
  RIDE_FRAME, buildRideLocalModel, carToWorld, fromStep, jostleAt, jostleBounds, placementPose, rotateToLocal, rotateToWorld, toStep,
  worldToCar, type CarPose,
} from '../src/world/trainRideLocal';
import {RIDE_ROUTE, arrivalPlan, arriveDir, departDir, departurePlan, routePose} from '../src/world/trainRideRoute';
import {TRANSIT, TrainTransitTunnel} from '../src/world/trainTransitTunnel';
import {RIDE, TrainRide, installTrainRide, rideQaApi} from '../src/world/trainRide';
import {TunnelFrame} from '../src/world/trackExt/frame';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
const HW = SPEC.interior.halfWidth;
const R = 0.3;

class Keys implements MoveInput {
  held = new Set<string>();
  hits = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit(c: string) { const h = this.hits.has(c); this.hits.delete(c); return h; }
}
const keys = (...k: string[]) => { const s = new Keys(); for (const c of k) s.held.add(c); return s; };

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout): StationLayout => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway 4242', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const ISLAND = () => lay('island-ends 11', () => generateStation(11, {archetype: 'island-ends'}));
const OFFICE = () => lay('office 4242', () => LEVELS.office.generate('main', {levelSeed: 4242}));
const MALL = () => lay('mall 4242', () => LEVELS.mall.generate('main', {levelSeed: 4242}));

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

function makeHost(L: StationLayout) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(L);
  const toasts: string[] = [];
  const culler = {register: vi.fn(), release: vi.fn()};
  const host = {
    scene, camera, player: new Player(), zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[],
    levels, layout: L, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L) as TrainPlacement | null,
    sfx: null, hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn()},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', world: {culler}, run: {current: {level: 'subway', section: 'main'}},
    gear: {placeRules: [] as ((x: number, y: number, z: number, level: number) => string | null)[]}, mats: null,
  };
  return {host, toasts, culler};
}
type Host = ReturnType<typeof makeHost>['host'];

function setup(L: StationLayout = SUBWAY()) {
  const {host: h, toasts, culler} = makeHost(L);
  const rt = installPlayerTrain(h);
  live.push(rt);
  const ride = installTrainRide(h, rt);
  for (const s of h.sectionHooks) s.build?.(L);
  const p = h.trainPlacement!;
  const pose = trainSpawnPose(L, p);
  h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
  sync(h, ride);
  return {h, rt, ride, p, toasts, culler};
}

/** Game.updateCamera: the eye from the (world) player pose + the car's tilt. */
function sync(h: Host, ride?: TrainRide): void {
  const P = h.player;
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  ride?.tiltCamera(h.camera);
  h.camera.updateMatrixWorld(true);
}

/** Game.update's order: the player (ride mode or the world body), the camera, then the lane frame hooks. */
function frame(h: Host, ride: TrainRide, dt = DT, k: MoveInput = new Keys()): void {
  if (ride.riding) ride.stepPlayer(dt, k, OPTS);
  else h.player.update(dt, k, h.levels, h.propIndex, OPTS);
  sync(h, ride);
  for (const f of h.frameHooks) f(dt);
}
function run(h: Host, ride: TrainRide, seconds: number, k?: MoveInput, until?: () => boolean): number {
  let t = 0;
  for (; t < seconds - 1e-9; t += DT) { frame(h, ride, DT, k); if (until?.()) break; }
  return t;
}

// ---------------------------------------------------------------------------------------------
// The car-local collision model (Player.update against it, step frame)

describe('ride mode: the car-local collision model', () => {
  const M = buildRideLocalModel(SPEC, null);
  /** Walk the real Player in the step frame from a train-local point along a local direction (yaw), return the local stop. */
  const walk = (lx: number, lz: number, yaw: number, seconds = 2.5, k = keys('KeyW')) => {
    const P = new Player();
    const [sx, sz] = toStep(lx, lz);
    P.place(sx, sz, yaw, SPEC.floorY);
    for (let t = 0; t < seconds; t += DT) P.update(DT, k, M.levels, M.props, OPTS);
    const [x, z] = fromStep(P.x, P.z);
    return {x, z, y: P.y, P};
  };
  // yaw: forward = (-sin yaw, -cos yaw): -Z = 0, +Z = PI, +X = -PI/2, -X = PI/2
  const toMinusZ = 0, toPlusZ = Math.PI, toPlusX = -Math.PI / 2, toMinusX = Math.PI / 2;

  it('the side walls hold the body inside the lining (the closed side doors are wall), feet on the floor', () => {
    for (const d of SPEC.doors) {
      const r = walk(d.x, 0, d.side < 0 ? toMinusZ : toPlusZ);
      expect(Math.abs(r.z), `door ${d.x} ${d.side}`).toBeLessThanOrEqual(HW - R + 1e-6);
      expect(Math.abs(r.z)).toBeGreaterThan(HW - R - 0.02);
      expect(r.y).toBe(Math.fround(SPEC.floorY)); // (the grid's float32 floor; ride mode snaps a grounded body to spec.floorY)
    }
    expect(walk(-2, 0, toMinusZ).z).toBeCloseTo(-(HW - R), 3);
    expect(walk(-2, 0, toPlusZ).z).toBeCloseTo(HW - R, 3);
  });

  it('the partitions stop the body beside their doorways and let it through the doorways', () => {
    const pt = TRAIN_VIEW.partition / 2;
    for (const part of partitionsOf(SPEC)) {
      const toward = part.end > 0 ? toPlusX : toMinusX, from = part.x - part.end * 1.5;
      // beside the doorway (z clear of it): stopped by the partition wall
      const zWall = part.doorway.z1 + 0.35;
      const r = walk(from, zWall, toward, 2);
      expect(part.end * (part.x - r.x), `${part.end} wall`).toBeCloseTo(pt + R, 3);
      // through the doorway (centre): past the partition
      const r2 = walk(from, (part.doorway.z0 + part.doorway.z1) / 2, toward, 1.2);
      expect(part.end * (r2.x - part.x), `${part.end} doorway`).toBeGreaterThan(pt + R);
    }
  });

  it('the console, the Lockbox and the end walls are solid', () => {
    // cab: walk at the console from behind (the operator side)
    const cr = M.console;
    const c = walk(SPEC.cab.x0 + 0.5, 0, toPlusX, 2);
    expect(c.x).toBeCloseTo(cr.x0 - R, 3);
    // the rear compartment: walk at the Lockbox's front from the aisle, then along the aisle at the rear end wall
    const lb = SPEC.lockbox!, fp = lockboxFootprint(lb);
    const l = walk(lb.x, fp.z0 - 0.7, toPlusZ, 2);
    expect(l.z).toBeCloseTo(fp.z0 - R, 3);
    const e = walk(SPEC.rear!.x0 + 0.6, -0.8, toMinusX, 2);
    expect(e.x).toBeCloseTo(SPEC.interior.x0 + R, 3);
    // the cab's front: past the console's side there is no room for a body; the front wall holds the box anyway
    expect(M.named.endFront.x - M.named.endFront.hx - RIDE_FRAME.ox).toBeCloseTo(SPEC.interior.x1, 6);
  });

  it('crouch, jump and landing are player.ts\' own; the head never passes the ceiling; no drop through the floor', () => {
    const P = new Player();
    const [sx, sz] = toStep(-1, 0);
    P.place(sx, sz, 0, SPEC.floorY);
    const k = new Keys();
    k.hits.add('KeyC');
    P.update(DT, k, M.levels, M.props, OPTS);
    for (let t = 0; t < 0.3; t += DT) P.update(DT, new Keys(), M.levels, M.props, OPTS);
    expect(P.crouched).toBe(true);
    expect(P.eye).toBeCloseTo(SPEC.floorY + CROUCH_EYE, 3);
    const k2 = new Keys(); k2.hits.add('KeyC');
    P.update(DT, k2, M.levels, M.props, OPTS);
    for (let t = 0; t < 0.3; t += DT) P.update(DT, new Keys(), M.levels, M.props, OPTS);
    expect(P.crouched).toBe(false);
    const k3 = new Keys(); k3.hits.add('Space');
    P.update(DT, k3, M.levels, M.props, OPTS);
    expect(P.justJumped).toBe(true);
    let top = 0, landed = false;
    for (let t = 0; t < 1.5; t += DT) { P.update(DT, new Keys(), M.levels, M.props, OPTS); top = Math.max(top, P.y); landed ||= P.justLanded; }
    expect(landed).toBe(true);
    expect(P.y).toBe(Math.fround(SPEC.floorY));
    expect(top + STAND_EYE + 0.12).toBeLessThanOrEqual(SPEC.ceilingY + 1e-6);
    // the partition doorway's head is lower than the saloon ceiling
    const [dx, dz] = toStep(SPEC.cab.x0, 0);
    expect(M.levels.ceilAt(dx, dz, SPEC.floorY)).toBeCloseTo(SPEC.floorY + SPEC.cab.doorway.height, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// The pose maps and the jostle

describe('the car pose: local <-> world maps, the jostle', () => {
  it('equals trainToWorld / worldToTrain exactly for the parked yaws 0 / PI', () => {
    for (const front of [1, -1] as const) {
      const p = {x: 123.45, z: 42.5, railTopY: -0.855, yaw: front > 0 ? 0 : Math.PI, front};
      const c = placementPose(p);
      for (const [lx, ly, lz] of [[0, 0, 0], [3.21, 0.98, -1.1], [-7.25, 2.5, 1.3], [6.809, 1.5, 0.977]]) {
        const a = carToWorld(c, lx, ly, lz), b = trainToWorld(p, lx, ly, lz);
        expect(a.x === b.x && a.y === b.y && a.z === b.z, `${front} ${lx} ${lz}`).toBe(true); // (=== : bit-exact, ±0 alike)
        const q = worldToCar(c, a.x, a.y, a.z), r = worldToTrain(p, a.x, a.y, a.z);
        expect(q.x === r.x && q.y === r.y && q.z === r.z).toBe(true);
      }
    }
  });

  it('round-trips for any pose (yaw / pitch / roll), and rotations keep lengths', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 200; i++) {
      const c: CarPose = {x: rnd() * 500, y: rnd() * 10, z: rnd() * 500, yaw: rnd() * 4, pitch: rnd() * 0.01, roll: rnd() * 0.01};
      const lx = rnd() * 8, ly = rnd() * 3, lz = rnd() * 1.5;
      const w = carToWorld(c, lx, ly, lz), q = worldToCar(c, w.x, w.y, w.z);
      expect(Math.abs(q.x - lx) + Math.abs(q.y - ly) + Math.abs(q.z - lz)).toBeLessThan(1e-9);
      const v = rotateToWorld(c, lx, ly, lz, {x: 0, y: 0, z: 0}), u = rotateToLocal(c, v.x, v.y, v.z, {x: 0, y: 0, z: 0});
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(Math.hypot(lx, ly, lz), 9);
      expect(Math.abs(u.x - lx) + Math.abs(u.y - ly) + Math.abs(u.z - lz)).toBeLessThan(1e-9);
    }
    // the three.js root (Euler 'YZX' = R_y · R_z · R_x) agrees with carToWorld
    const c: CarPose = {x: 5, y: 1, z: -3, yaw: 0.7, pitch: 0.004, roll: -0.003};
    const root = new THREE.Object3D();
    root.position.set(c.x, c.y, c.z); root.rotation.order = 'YZX'; root.rotation.set(c.roll, c.yaw, c.pitch); root.updateMatrixWorld(true);
    const v = new THREE.Vector3(2, 1.5, -0.8).applyMatrix4(root.matrixWorld), w = carToWorld(c, 2, 1.5, -0.8);
    expect(v.distanceTo(new THREE.Vector3(w.x, w.y, w.z))).toBeLessThan(1e-9);
  });

  it('the jostle is zero at rest, bounded at any speed / intensity, smooth in time', () => {
    expect(jostleAt(3.3, 12, 0, 1)).toEqual({lateral: 0, roll: 0, pitch: 0, bump: 0});
    expect(jostleAt(3.3, 12, 14, 0)).toEqual({lateral: 0, roll: 0, pitch: 0, bump: 0});
    for (const I of [0.3, 1]) {
      const B = jostleBounds(I);
      let prev = jostleAt(0, 0, 15, I), maxStep = 0;
      for (let t = 0; t < 120; t += 1 / 120) {
        const j = jostleAt(t, t * 15, 15, I);
        expect(Math.abs(j.lateral)).toBeLessThanOrEqual(B.lateral + 1e-12);
        expect(Math.abs(j.roll)).toBeLessThanOrEqual(B.roll + 1e-12);
        expect(Math.abs(j.pitch)).toBeLessThanOrEqual(B.pitch + 1e-12);
        expect(Math.abs(j.bump)).toBeLessThanOrEqual(B.bump + 1e-12);
        maxStep = Math.max(maxStep, Math.abs(j.lateral - prev.lateral), Math.abs(j.bump - prev.bump));
        prev = j;
      }
      expect(maxStep).toBeLessThan(0.003); // no jumps between 120 Hz samples
    }
    // restrained: about a centimetre and a quarter degree at most
    const B = jostleBounds(1);
    expect(B.lateral).toBeLessThanOrEqual(0.012);
    expect(B.roll).toBeLessThanOrEqual(0.005);
    expect(B.bump).toBeLessThanOrEqual(0.01);
  });
});

// ---------------------------------------------------------------------------------------------
// Routes per archetype

describe('routes: departure / arrival plans', () => {
  // task campaign-polish (lane TRAIN, item 16): FRONT FIRST both ways — the departure always takes the FRONT end, the arrival always comes
  // out of the REAR end (the car never runs rear first and never reverses); a tunnel when one continues that end, else its bed end
  it('Subway / Office / Mall / island-ends: the departure takes the FRONT end, the arrival comes out of the REAR end (tunnel, else bed end)', () => {
    for (const [tag, L] of [['subway', SUBWAY()], ['office', OFFICE()], ['mall', MALL()], ['island-ends', ISLAND()]] as const) {
      const p = playerTrainPlacement(L)!;
      const d = departurePlan(L, p), a = arrivalPlan(L, p);
      const frontEnd = p.front > 0 ? 'x1' : 'x0', rearEnd = p.front > 0 ? 'x0' : 'x1';
      expect(d.end, `${tag}: departure end`).toBe(frontEnd);
      expect(a.end, `${tag}: arrival end`).toBe(rearEnd);
      expect(departDir(d), tag).toBe(1);
      expect(arriveDir(a), tag).toBe(1);
      const tunnels = (L.extensions?.tunnels ?? []).filter(t => t.trench === p.trenchIndex);
      expect(d.kind, `${tag}: departure kind`).toBe(tunnels.some(t => t.from === frontEnd) ? 'tunnel' : 'bed-end');
      expect(a.kind, `${tag}: arrival kind`).toBe(tunnels.some(t => t.from === rearEnd) ? 'tunnel' : 'bed-end');
      for (const pl of [d, a]) if (pl.kind === 'bed-end') expect(pl.uEdge).toBeCloseTo(pl.uMouth - SPEC.length / 2 - RIDE_ROUTE.planeClear, 9);
      if (d.kind !== 'tunnel') continue;
      // the route starts at the car centre, runs along the bed to the mouth, then inside the tunnel corridor at the track's offset
      const s0 = d.route.at(0);
      expect(Math.hypot(s0.x - p.x, s0.z - p.z)).toBeLessThan(1e-9);
      const tn = L.extensions!.tunnels.find(t => t.id === d.tunnel)!, f = new TunnelFrame(tn);
      expect(tn.rails).toContain(d.lat);
      for (let u = d.uMouth + 1; u <= d.uMax; u += 2) { const q = d.route.at(u); expect(f.inside(q.x, q.z, 0.5), `${tag} u ${u}`).toBe(true); }
      // the hand-over: the whole car past the mouth (darkS) unless the cap is nearer; never beyond the cap clearance
      expect(d.uDark).toBeLessThanOrEqual(d.uMax + 1e-9);
      expect(d.uDark - SPEC.length / 2).toBeGreaterThanOrEqual(Math.min(d.uMouth + RIDE_ROUTE.darkS, d.uMax - SPEC.length / 2) - 1e-9);
      // the body (chord) at the start is the parked car exactly enough
      const rp = routePose(d, 0, RIDE.bogie);
      expect(Math.hypot(rp.x - p.x, rp.z - p.z)).toBeLessThan(1e-9);
      expect(rp.ax).toBeCloseTo(p.front, 12);
      expect(departDir(d)).toBe(d.sgn);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The transit tunnel

describe('the transit tunnel', () => {
  // task campaign-polish (lane TRAIN, item 15): the warm lamps became red signals (housings / lenses / glow cards in one sub-group)
  it('eight draws, periodic, far from every station world; the offset wraps (no drift)', () => {
    const m = () => new THREE.MeshBasicMaterial();
    const tt = new TrainTransitTunnel().build({wall: m(), ceiling: m(), floor: m(), rail: m(), sleeper: m(), lens: m(), glow: m()});
    expect(tt.stats.meshes).toBe(8);
    expect(tt.group.children.length).toBe(6); // 5 tunnel meshes + the signal sub-group (3 instanced meshes)
    expect(tt.signals.children.length).toBe(3);
    expect(tt.active).toBe(false);
    tt.enterTransit();
    expect(tt.active).toBe(true);
    expect(TRANSIT.half % TRANSIT.period).toBe(0);
    expect(Math.abs(TRANSIT.period / TRANSIT.sleeperStep - Math.round(TRANSIT.period / TRANSIT.sleeperStep))).toBeLessThan(1e-9);
    expect(Math.hypot(TRANSIT.origin.x, TRANSIT.origin.z)).toBeGreaterThan(1500);
    for (let i = 0; i < 100000; i++) tt.advance(15 / 60);
    expect(tt.offset).toBeGreaterThanOrEqual(0);
    expect(tt.offset).toBeLessThan(TRANSIT.period);
    expect(tt.group.position.x).toBeGreaterThan(TRANSIT.origin.x - TRANSIT.period);
    tt.advance(-1000.25);
    expect(tt.offset).toBeGreaterThanOrEqual(0);
    tt.leaveTransit();
    expect(tt.active).toBe(false);
    tt.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// The sequence

describe('the ride: depart / transit / arrive', () => {
  it('refuses to depart with the player outside the car (and does nothing)', async () => {
    const {h, rt, ride, p, toasts} = setup();
    const at = trainToWorld(p, 0, 0, -(HW + 2.5));
    h.player.spawn(at.x, at.z, 0, h.levels.grid(0).floorAt(at.x, at.z));
    sync(h, ride);
    const r = await ride.depart();
    expect(r).toMatchObject({status: 'refused', reason: 'outside'});
    expect(ride.riding).toBe(false);
    expect(rt.ride).toBeNull();
    expect(toasts.at(-1)).toMatch(/Board the train/);
  });

  it('a body in an open doorway blocks the close: retried, then reported; ride mode ends, nobody is trapped', async () => {
    const {h, rt, ride, p} = setup();
    const i = rt.train!.doors.findIndex(d => d.col.door.side < 0);
    expect(rt.setDoor(i, true)).toBe('opening');
    run(h, ride, 2);
    const dd = rt.train!.doors[i].col.door, w = trainToWorld(p, dd.x, SPEC.floorY, -(HW + 0.12));
    h.zombies.push({brain: {x: w.x, z: w.z, y: p.floorY, alive: true, stats: {radius: 0.3}}});
    let result: unknown = null;
    void ride.depart().then(r => { result = r; });
    expect(ride.phase).toBe('closing');
    run(h, ride, RIDE.closeTimeout + 1, undefined, () => result !== null);
    await Promise.resolve();
    expect(result).toMatchObject({status: 'refused', reason: 'door-blocked'});
    expect(ride.riding).toBe(false);
    expect(ride.counts.closeRetries).toBeGreaterThan(0);
    expect(rt.ride).toBeNull();
    // the car never moved
    expect(rt.train!.view.root.position.x).toBe(p.x);
  });

  it('closes the doors, pulls away into the tunnel, loops in transit and stops EXACTLY at the placement (same station, rideDemo path)', async () => {
    const {h, rt, ride, p, culler} = setup();
    const qa = rideQaApi({trainRide: ride});
    // an open door first: the depart closes it before anything moves
    const i = rt.train!.doors.findIndex(d => d.col.door.side < 0);
    rt.setDoor(i, true);
    run(h, ride, 1.6);
    const before = worldToTrain(p, h.player.x, h.player.y, h.player.z);
    let dep: {status: string} | null = null;
    void ride.depart().then(r => { dep = r; });
    expect(ride.riding).toBe(true);
    expect(ride.blocksWeapons).toBe(true);
    expect(ride.refuseDrop()).toBe(true);
    expect(h.gear.placeRules.some(r => r(0, 0, 0, 0))).toBe(true); // the backpack stays on the back while riding
    // the doors shut before the car moves
    let movedBeforeShut = false;
    run(h, ride, 4, undefined, () => {
      if (ride.phase === 'departing' && rt.train!.doors.some(d => d.t > 0)) movedBeforeShut = true;
      return ride.phase === 'departing';
    });
    expect(movedBeforeShut).toBe(false);
    expect(rt.train!.doors.every(d => d.t === 0 && d.target === 0)).toBe(true);
    expect(culler.release).toHaveBeenCalled();
    // the car accelerates smoothly (ease-in) and runs to the tunnel; the player keeps its car-local pose
    let maxJump = 0, last = {x: ride.pose.x, z: ride.pose.z}, maxSpeed = 0;
    run(h, ride, 60, undefined, () => {
      if (ride.phase !== 'departing') return true; // (the hand-over frame moves the car to the transit loop)
      maxJump = Math.max(maxJump, Math.hypot(ride.pose.x - last.x, ride.pose.z - last.z));
      last = {x: ride.pose.x, z: ride.pose.z};
      maxSpeed = Math.max(maxSpeed, ride.speed);
      return false;
    });
    await Promise.resolve();
    expect(dep).toMatchObject({status: 'in-tunnel'});
    expect(ride.phase).toBe('transit');
    expect(maxJump).toBeLessThan(RIDE.departMax * DT + 0.05);
    expect(maxSpeed).toBeGreaterThan(2);
    const st = qa.ride() as {plan: unknown; transit: {active: boolean}};
    expect(st.transit.active).toBe(true);
    // in transit the car stands at the transit origin (+ the jostle) and the view root / lights follow it
    expect(Math.abs(ride.pose.x - TRANSIT.origin.x)).toBeLessThan(0.05);
    const root = rt.view!.root;
    expect(root.position.distanceTo(new THREE.Vector3(ride.pose.x, ride.pose.y, ride.pose.z))).toBeLessThan(1e-9);
    const head = rt.lights.head.position;
    expect(Math.abs(head.x - TRANSIT.origin.x)).toBeLessThan(10);
    // the player's world pose = carToWorld(car, local) and the local pose is unchanged (nobody walked)
    const lw = carToWorld(ride.pose, ride.local.x, ride.local.y, ride.local.z);
    expect([h.player.x, h.player.y, h.player.z]).toEqual([lw.x, lw.y, lw.z]);
    expect(ride.local.x).toBeCloseTo(before.x, 6);
    expect(ride.local.z).toBeCloseTo(before.z, 6);
    // a 2 s hitch: one clamped step (no teleport)
    const off0 = ride.transit.offset, v0 = ride.speed;
    ride.stepPlayer(2.0, new Keys(), OPTS);
    const wrapped = ((ride.transit.offset - off0) % TRANSIT.period + TRANSIT.period) % TRANSIT.period;
    const moved = Math.min(wrapped, TRANSIT.period - wrapped); // (either direction of travel)
    expect(moved).toBeLessThanOrEqual(RIDE.maxDt * Math.max(v0, ride.speed) + 1e-6);
    expect(ride.counts.clampedSteps).toBe(1);
    // arrive (the same station): stops exactly at the placement
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, ride, 120, undefined, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    expect(ride.riding).toBe(false);
    expect(rt.ride).toBeNull();
    expect([root.position.x, root.position.y, root.position.z]).toEqual([p.x, p.railTopY, p.z]);
    expect(root.rotation.y).toBe(p.yaw);
    expect(root.rotation.x).toBe(0);
    expect(root.rotation.z).toBe(0);
    const after = worldToTrain(p, h.player.x, h.player.y, h.player.z);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
    expect(h.player.y).toBe(p.floorY);
    expect(rt.playerInside()).toBe(true);
    expect(rt.train!.doors.every(d => d.t === 0 && d.target === 0)).toBe(true);
    expect(culler.register).toHaveBeenCalledWith(rt.view!.fixed);
    // normal physics again: the parked car's volume holds the player
    run(h, ride, 0.5, keys('KeyW'));
    expect(rt.playerInside()).toBe(true);
    expect(h.player.y).toBe(p.floorY);
  }, 60000);

  it('walking in the moving car: the walls hold, the world pose follows the car, no drift over a long transit', async () => {
    const {h, rt, ride} = setup();
    void ride.depart();
    run(h, ride, 80, undefined, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    // walk into the platform-side wall for a while (local -Z): held at the lining
    h.player.yaw = ride.pose.yaw; // local yaw 0 = toward local -Z
    run(h, ride, 3, keys('KeyW'));
    expect(ride.local.z).toBeGreaterThanOrEqual(-(HW - R) - 1e-6);
    expect(ride.local.z).toBeLessThan(-(HW - R) + 0.02);
    expect(ride.local.y).toBe(SPEC.floorY);
    // stand still for five minutes in transit: the local pose does not creep, the car stays at the origin within its jostle
    const L0 = {...ride.local};
    const B = jostleBounds(1);
    let far = 0;
    run(h, ride, 300, undefined, () => {
      far = Math.max(far, Math.hypot(ride.pose.x - TRANSIT.origin.x, ride.pose.z - TRANSIT.origin.z));
      return false;
    });
    expect(Math.abs(ride.local.x - L0.x) + Math.abs(ride.local.z - L0.z)).toBeLessThan(1e-9);
    expect(far).toBeLessThanOrEqual(B.lateral + 1e-9);
    expect(ride.transit.offset).toBeLessThan(TRANSIT.period);
    expect(ride.speed).toBeCloseTo(RIDE.cruise, 6);
    // the Lockbox anchor is where the car is (lane BOX's walk-away check stays consistent)
    const a = rt.lockboxWorld()!;
    expect(Math.abs(a.x - TRANSIT.origin.x)).toBeLessThan(10);
    ride.transitFailed('load failed (test)');
    run(h, ride, 2);
    expect(ride.phase).toBe('transit'); // a failed load keeps it looping
    expect((ride.state() as {failure: string}).failure).toMatch(/load failed/);
  }, 60000);

  it('across a world swap: the teardown keeps the riding car (one view), the NEXT station adopts it and the car stops at ITS placement', async () => {
    const A = SUBWAY(), B = MALL();
    const {h, rt, ride} = setup(A);
    const view0 = rt.view!, lights0 = rt.lights.all.map(l => l.uuid);
    void ride.depart();
    run(h, ride, 80, undefined, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    // the primary unloads the old world: the runtime keeps the riding car's view in the scene
    for (const s of h.sectionHooks) s.teardown?.();
    expect(rt.train).toBeNull();
    expect(rt.view).toBe(view0);
    expect(view0.root.parent).toBe(h.scene);
    run(h, ride, 3); // the car keeps running between the worlds (Lockbox aim still in the car frame)
    expect(ride.phase).toBe('transit');
    // ... and builds the next station: the same view object is adopted at the new placement, no second car
    const levels = levelsOf(B);
    Object.assign(h, {layout: B, levels, propIndex: new PropIndex(levels, B.props), trainPlacement: playerTrainPlacement(B)});
    const builds = rt.counts.builds;
    for (const s of h.sectionHooks) s.build?.(B);
    expect(rt.counts.builds).toBe(builds + 1);
    expect(rt.view).toBe(view0);
    let cars = 0;
    h.scene.traverse(o => { if (o.name === 'player-train') cars++; });
    expect(cars).toBe(1);
    expect(rt.lights.all.map(l => l.uuid)).toEqual(lights0);
    expect(rt.train!.doors.every(d => d.target === 0 && d.t === 0)).toBe(true);
    const p = h.trainPlacement!;
    const L0 = {...ride.local};
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, ride, 150, undefined, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    const root = view0.root;
    expect([root.position.x, root.position.y, root.position.z]).toEqual([p.x, p.railTopY, p.z]);
    expect(root.rotation.y).toBe(p.yaw);
    const q = worldToTrain(p, h.player.x, h.player.y, h.player.z);
    expect(q.x).toBeCloseTo(L0.x, 6);
    expect(q.z).toBeCloseTo(L0.z, 6);
    expect(h.player.y).toBe(p.floorY);
    expect(rt.playerInside()).toBe(true);
  }, 90000);

  it('reset() mid-ride ends ride mode safely (parked car, pending promises resolve "aborted")', async () => {
    const {h, rt, ride, p} = setup();
    const dep = ride.depart();
    run(h, ride, 3, undefined, () => ride.phase === 'departing');
    run(h, ride, 1);
    ride.reset();
    expect(await dep).toMatchObject({status: 'refused', reason: 'aborted'});
    expect(ride.riding).toBe(false);
    expect(rt.ride).toBeNull();
    expect(rt.view!.root.position.x).toBe(p.x);
    expect(rt.playerInside()).toBe(true);
    // a death ends it too (state listener)
    void ride.depart();
    expect(ride.riding).toBe(true);
    for (const f of h.stateListeners) (f as unknown as (s: string, q: string) => void)('dead', 'playing');
    expect(ride.riding).toBe(false);
  });
});
