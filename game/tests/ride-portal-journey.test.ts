// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): whole journeys with the REAL moving train (world/trainRide.ts:
// the real Player / PlayerTrainRuntime / TrainRide, a fake Game host stepped in Game.update's order — the pattern of
// tests/train-ride-portal.test.ts) driving the REAL portal runtime (world/ridePortalRuntime.ts) on REAL worlds built like
// Game.buildSection (tests/helpers/ridePortalWorld.ts), one departure and one arrival per portal kind (gate, breach):
//  - while any of the car is beyond the portal plane, nothing the station draws lies in the portal's cut (sampled frames: every drawn
//    triangle / instance of the three static roots, honouring draw ranges, collapsed instances and visible flags);
//  - a gate stands fully open before the car's nose reaches it and is shut once the portal is let go;
//  - the light mask is the portal's (open at its plane) while engaged, the transit's (no open face) in transit, off after the arrival;
//  - the culler's stand-in eye is set while a portal is engaged and cleared after;
//  - the station is restored bit-exactly when the departure's portal is let go (the hand-over) and after the arrival's release.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {appendFileSync} from 'node:fs';
import {PropIndex} from '../src/core/physics';
import {Player, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import {levelsOf} from '../src/gen/levels';
import {trainSpawnPose} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain} from '../src/world/playerTrain';
import {carToWorld} from '../src/world/trainRideLocal';
import {RIDE, TrainRide, installTrainRide} from '../src/world/trainRide';
import {portalCut, type RidePortal} from '../src/world/ridePortal';
import {RidePortalRuntime, type PortalWhich} from '../src/world/ridePortalRuntime';
import {RIDE_MASK, setRideMask} from '../src/world/rideMask';
import {MOOD} from '../src/world/lights';
import {portalWorld, type PortalWorld} from './helpers/ridePortalWorld';
import {audit, diff, snapshot, type DrawSnapshot} from './helpers/ridePortalAudit';

const LOG = '/tmp/lanes/portal/journey.log';
const log = (s: string) => { try { appendFileSync(LOG, s + '\n'); } catch { /* best effort */ } };
const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
const L2 = SPEC.length / 2;
class NoKeys implements MoveInput { down() { return false; } hit() { return false; } }
const NOKEYS = new NoKeys();

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } setRideMask(null); });

/** Game's surface the train, the ride and the portal runtime read; the world's static roots live in the host's one scene. */
function makeHost(w: PortalWorld) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(w.layout);
  return {
    scene, camera, player: new Player(), zombies: [] as {root: THREE.Object3D; brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}}[],
    levels, layout: w.layout, propIndex: new PropIndex(levels, w.layout.props), trainPlacement: w.placement,
    sfx: null as unknown, hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn()},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: never): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: never) => Promise<void>)[],
    state: 'playing', world: w.world, containers: w.cm as {group: THREE.Object3D}, stock: w.stock as {group: THREE.Object3D}, run: {current: {level: 'subway', section: 'main'}},
    gear: {placeRules: [] as ((x: number, y: number, z: number, level: number) => string | null)[]}, mats: w.mats,
    propModels: {ownsGeometry: (g: THREE.BufferGeometry) => w.modelGeometries.has(g)},
    ridePortals: undefined as RidePortalRuntime | undefined, trainRuntime: undefined as PlayerTrainRuntime | undefined,
  };
}
type Host = ReturnType<typeof makeHost>;

/** The world's static roots into the host's scene (Game.buildSection adds them to its one scene). */
function adopt(h: Host, w: PortalWorld): void {
  for (const r of w.roots) h.scene.add(r);
  h.scene.updateMatrixWorld(true);
}

function camera(h: Host, ride: TrainRide): void {
  const P = h.player;
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  ride.tiltCamera(h.camera);
  h.camera.updateMatrixWorld(true);
}
function frame(h: Host, ride: TrainRide): void {
  if (ride.riding) ride.stepPlayer(DT, NOKEYS, OPTS);
  else h.player.update(DT, NOKEYS, h.levels, h.propIndex, OPTS);
  for (const f of h.frameHooks) f(DT);
  camera(h, ride);
  h.scene.updateMatrixWorld();
}

/** The car's extent beyond portal `q`'s plane: [nearest, furthest] point (m; negative: the station side). */
function beyond(ride: TrainRide, q: RidePortal): [number, number] {
  const e = [-L2, L2].map(lx => { const p = carToWorld(ride.pose, lx, 0, 0); return (p.x - q.x) * q.out; });
  return [Math.min(...e), Math.max(...e)];
}

interface Check { audits: number; violations: number; stationSide: number; collateral: number; gateBefore: number; proxyOff: number; maskWrong: number; examples: string[] }
const fresh = (): Check => ({audits: 0, violations: 0, stationSide: 0, collateral: 0, gateBefore: 1, proxyOff: 0, maskWrong: 0, examples: []});

/** One engaged frame's checks against portal `q` (`which`) of the station drawn by `w` (base: its state when bound). */
function checkFrame(c: Check, k: number, h: Host, ride: TrainRide, w: PortalWorld, base: DrawSnapshot, which: PortalWhich, q: RidePortal): void {
  const rp = h.ridePortals!, cul = w.world.culler as unknown as {eyeProxy: unknown};
  if (!rp.engaged(which)) return;
  if (cul.eyeProxy == null) c.proxyOff++;
  if (!(RIDE_MASK.on && RIDE_MASK.openX === q.x)) c.maskWrong++;
  const [lo, hi] = beyond(ride, q);
  // the gate: fully open whenever the car reaches within 0.5 m of the plane, until it is through (the ride shuts it RIDE.gateClear on)
  if (q.kind === 'gate' && hi > -0.5 && lo < RIDE.gateClear - 0.05) c.gateBefore = Math.min(c.gateBefore, rp.gate(which));
  if (hi > 0 && k % 12 === 0) {
    const a = audit(w.roots, base, [portalCut(q)], [q.x]);
    c.audits++; c.violations += a.violations; c.stationSide += a.stationSide; c.collateral += a.collateral;
    if (a.examples.length && c.examples.length < 4) c.examples.push(...a.examples.slice(0, 2));
  }
}

describe('journeys through the ride portals: the real TrainRide drives the real portal runtime on real worlds', () => {
  // departure gate + arrival breach; departure breach + arrival gate
  for (const [from, to] of [[['market', 4242], ['subway', 4242]], [['mall', 4242], ['market', 8]]] as const) {
    it(`${from[0]} ${from[1]} -> ${to[0]} ${to[1]}: nothing of the station in the cut while the car is beyond a plane; the gate open for it; mask / stand-in eye on and off; restored bit-exactly`, async () => {
      const A = await portalWorld(from[0], from[1]);
      const h = makeHost(A);
      adopt(h, A);
      const rt = installPlayerTrain(h as never);
      live.push(rt);
      h.trainRuntime = rt;
      h.ridePortals = new RidePortalRuntime(h as never).install(); // (Game: before the ride, which drives it)
      const ride = installTrainRide(h as never, rt);
      for (const s of h.sectionHooks) s.build?.(A.layout as never);
      const p = h.trainPlacement!;
      const pose = trainSpawnPose(A.layout, p);
      h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
      camera(h, ride);
      const baseA = snapshot(A.roots), qA = A.portals!.front, culA = A.world.culler as unknown as {eyeProxy: unknown};
      // ---- departure
      let dep: {status: string} | null = null;
      void ride.depart().then(r => { dep = r; });
      expect(ride.plan!.which).toBe('front');
      expect(h.ridePortals.engaged('front')).toBe(true);
      const cD = fresh();
      let k = 0, gateShutAtRelease = true;
      for (let t = 0; t < 90 && ride.phase !== 'transit'; t += DT) {
        frame(h, ride);
        if ((ride.phase as string) === 'transit') break;
        checkFrame(cD, k++, h, ride, A, baseA, 'front', qA);
      }
      await Promise.resolve();
      expect(dep).toMatchObject({status: 'in-tunnel'});
      // the hand-over: the portal let go at once, the station whole again (bit-exact), the stand-in eye cleared, the transit's mask
      expect(h.ridePortals.engaged('front')).toBe(false);
      if (qA.kind === 'gate') gateShutAtRelease = h.ridePortals.gate('front') === 0;
      expect(diff(baseA, snapshot(A.roots))).toEqual([]);
      expect(culA.eyeProxy).toBeNull();
      expect(RIDE_MASK.on && Number.isNaN(RIDE_MASK.openX)).toBe(true);
      log(`${from.join(' ')} departure (${qA.kind}): ${JSON.stringify(cD)} gate shut at release ${gateShutAtRelease}`);
      expect(cD.audits).toBeGreaterThan(5);
      expect([cD.violations, cD.stationSide, cD.collateral, cD.proxyOff, cD.maskWrong], cD.examples.join('; ')).toEqual([0, 0, 0, 0, 0]);
      expect(cD.gateBefore).toBe(1);
      expect(gateShutAtRelease).toBe(true);
      // ---- the old world goes (teardown hooks), the next one is built behind the transit, the car arrives
      for (let i = 0; i < 30; i++) frame(h, ride);
      for (const s of h.sectionHooks) s.teardown?.();
      for (const r of A.roots) h.scene.remove(r);
      const B = await portalWorld(to[0], to[1]);
      const levels = levelsOf(B.layout);
      Object.assign(h, {layout: B.layout, levels, propIndex: new PropIndex(levels, B.layout.props), trainPlacement: B.placement, world: B.world, containers: B.cm, stock: B.stock,
        propModels: {ownsGeometry: (g: THREE.BufferGeometry) => B.modelGeometries.has(g)}});
      adopt(h, B);
      for (const s of h.sectionHooks) s.build?.(B.layout as never);
      const baseB = snapshot(B.roots), qB = B.portals!.rear, culB = B.world.culler as unknown as {eyeProxy: unknown};
      let arr: {status: string} | null = null;
      void ride.arrive().then(r => { arr = r; });
      const cA = fresh();
      let engagedSeen = false;
      k = 0;
      for (let t = 0; t < 200 && ride.riding; t += DT) {
        frame(h, ride);
        if (h.ridePortals.engaged('rear')) engagedSeen = true;
        checkFrame(cA, k++, h, ride, B, baseB, 'rear', qB);
      }
      await Promise.resolve();
      expect(arr).toMatchObject({status: 'stopped'});
      expect(engagedSeen).toBe(true);
      // the release tail after the stop (Game.frameHooks): the gate shuts behind the car / the breach goes, then everything is back
      for (let t = 0; t < 8 && (h.ridePortals.engaged('rear') || ride.transit.active); t += DT) frame(h, ride);
      expect(h.ridePortals.engaged('rear')).toBe(false);
      if (qB.kind === 'gate') expect(h.ridePortals.gate('rear')).toBe(0);
      expect(diff(baseB, snapshot(B.roots))).toEqual([]);
      expect(culB.eyeProxy).toBeNull();
      expect(RIDE_MASK.on).toBe(false);
      log(`${to.join(' ')} arrival (${qB.kind}): ${JSON.stringify(cA)} forced ${h.ridePortals.state('rear').forced}`);
      expect(cA.audits).toBeGreaterThan(5);
      expect([cA.violations, cA.stationSide, cA.collateral, cA.proxyOff, cA.maskWrong], cA.examples.join('; ')).toEqual([0, 0, 0, 0, 0]);
      expect(cA.gateBefore).toBe(1);
    }, 600_000);
  }
});
