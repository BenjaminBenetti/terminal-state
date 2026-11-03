// Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN): the campaign train ride's polish — on generated levels with a fake
// Game host and the REAL Player body / PlayerTrainRuntime / TrainRide:
//  - item 16 FRONT FIRST: the departure always takes the FRONT end and the arrival always comes out of the REAR end (every level kind);
//    a ride never reverses (transit velocity >= 0, the car's world motion never against its +X), its yaw never snaps (bounded per
//    frame through both hand-overs); bed ends crossed through a STUB (clear rock behind the end face: the box continues the bed, the
//    end plane hidden while the car passes, then whole again) or at the EDGE (rooms behind: the car never passes the plane); the stub
//    hand-over keeps the pattern / signals around the car; brass lying in the car rides with it; lane MAP's multi-hop journeys only
//    lengthen the minimum transit (bounded);
//  - item 15 DARK: no warm lamps, no lights, no shadow casters in the transit; red signals at a block spacing scrolling backwards at the
//    car's speed (lenses facing the oncoming car), out of sight before the arrival leaves the transit; the station light field reads
//    zero at the transit; a level's own fog is held while the transit shows and given back after;
//  - item 17 SOUND: rumble / air loops only while moving, blended by speed, gone at the stop (no hum while parked), quiet on pause,
//    stopped on reset / dispose; no run window struck on the final approach; Sfx.rideLoop is a non-positional loop into the master.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {FakeCtx, fakeBank, type Node as FakeNode} from './helpers/fakeAudio';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainSpawnPose, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain} from '../src/world/playerTrain';
import {carToWorld, placementPose, worldToCar} from '../src/world/trainRideLocal';
import {RIDE_ROUTE, arrivalPlan, arriveDir, bedEndClear, departDir, departurePlan} from '../src/world/trainRideRoute';
import {TRANSIT, TrainTransitTunnel, type TransitMaterials} from '../src/world/trainTransitTunnel';
import {RIDE, TrainRide, installTrainRide, journeyOf} from '../src/world/trainRide';
import {RIDE_AUDIO} from '../src/world/trainRideAudio';
import {MOOD} from '../src/world/lights';
import {bakeLightField, sampleField} from '../src/world/lightField';
import {stationLevels} from '../src/world/levelGeometry';
import {mallSkyField} from '../src/world/mallSkylight';
import {CELL} from '../src/gen/grid';
import {Sfx} from '../src/audio/sfx';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
const L2 = SPEC.length / 2;

class NoKeys implements MoveInput { down() { return false; } hit() { return false; } }

const layouts = new Map<string, StationLayout>();
const gen = (level: 'subway' | 'office' | 'mall' | 'reactor', seed: number): StationLayout => {
  const k = `${level} ${seed}`;
  let l = layouts.get(k);
  if (!l) layouts.set(k, (l = LEVELS[level].generate('main', {levelSeed: seed})));
  return l;
};
const basic = (): TransitMaterials => {
  const m = () => new THREE.MeshBasicMaterial();
  return {wall: m(), ceiling: m(), floor: m(), rail: m(), sleeper: m(), lens: m(), glow: m()};
};

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** Each bed end's black plane, tagged like world/builder.ts does (userData.bedEndVoid = 'trench:end'). */
function voidPlanes(L: StationLayout): THREE.Group {
  const g = new THREE.Group();
  L.trenches.forEach((t, ti) => {
    for (const end of ['x0', 'x1'] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
      m.position.set(end === 'x0' ? t.x0 + 0.01 : t.x1 - 0.01, t.floorY + 1, (t.z0 + t.z1) / 2);
      m.userData.bedEndVoid = `${ti}:${end}`;
      g.add(m);
    }
  });
  return g;
}

/** A small stand-in for physics/casings.ts (relocate x / z, carry y: the same contract). */
class FakeCasings {
  readonly pts: {x: number; y: number; z: number}[] = [];
  relocate(move: (x: number, y: number, z: number) => [number, number] | null): void { for (const p of this.pts) { const to = move(p.x, p.y, p.z); if (to) { p.x = to[0]; p.z = to[1]; } } }
  carry(inside: (x: number, y: number, z: number) => boolean, dy: number): void { for (const p of this.pts) if (inside(p.x, p.y, p.z)) p.y += dy; }
}

/** Records the ride's sound calls (the Sfx surface trainRideAudio.ts uses). */
class FakeRideSfx {
  readonly loops: {cue: string; level: number; rate: number; lowpass: number; playing: boolean; levels: number[]}[] = [];
  readonly cues: string[] = [];
  rideLoop(cue: 'bedRumble' | 'bedWind') {
    const l = {cue, level: 0, rate: 1, lowpass: 800, playing: true, levels: [] as number[]};
    this.loops.push(l);
    return {
      setLevel(k: number) { if (l.playing) { l.level = k; l.levels.push(k); } },
      setRate(r: number) { if (l.playing) l.rate = r; },
      setLowpass(hz: number) { if (l.playing) l.lowpass = hz; },
      stop() { l.playing = false; },
      get playing() { return l.playing; },
    };
  }
  voice() { return {}; }
  play(_v: unknown, cue: string) { this.cues.push(cue); return {}; }
  get alive() { return this.loops.filter(l => l.playing); }
}

function makeHost(L: StationLayout, o: {sfx?: unknown; fog?: THREE.FogExp2} = {}) {
  const scene = new THREE.Scene();
  scene.fog = o.fog ?? new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(L);
  const casings = new FakeCasings();
  const group = voidPlanes(L);
  scene.add(group);
  const host = {
    scene, camera, player: new Player(), zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[],
    levels, layout: L, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L) as TrainPlacement | null,
    sfx: o.sfx ?? null, hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn(), casings},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', world: {culler: {register: vi.fn(), release: vi.fn()}, group}, run: {current: {level: 'subway', section: 'main'}},
    gear: {placeRules: [] as ((x: number, y: number, z: number, level: number) => string | null)[]}, mats: null,
  };
  return {host, casings, group};
}
type Host = ReturnType<typeof makeHost>['host'];

function setup(L: StationLayout, o: {sfx?: unknown; fog?: THREE.FogExp2; transit?: boolean} = {}) {
  const {host: h, casings, group} = makeHost(L, o);
  const rt = installPlayerTrain(h);
  live.push(rt);
  const ride = installTrainRide(h, rt, o.transit === false ? {} : {transitMaterials: basic});
  for (const s of h.sectionHooks) s.build?.(L);
  const p = h.trainPlacement!;
  const pose = trainSpawnPose(L, p);
  h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
  sync(h, ride);
  return {h, rt, ride, p, casings, group};
}

function sync(h: Host, ride?: TrainRide): void {
  const P = h.player;
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  ride?.tiltCamera(h.camera);
  h.camera.updateMatrixWorld(true);
}

function frame(h: Host, ride: TrainRide): void {
  if (ride.riding) ride.stepPlayer(DT, new NoKeys(), OPTS);
  else h.player.update(DT, new NoKeys(), h.levels, h.propIndex, OPTS);
  sync(h, ride);
  for (const f of h.frameHooks) f(DT);
}
function run(h: Host, ride: TrainRide, seconds: number, each?: () => boolean | void): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) { frame(h, ride); if (each?.()) break; }
}

/** The swap to the next station as Game does it: teardown, the new layout on the host, build. */
function swapTo(h: Host, B: StationLayout): void {
  for (const s of h.sectionHooks) s.teardown?.();
  const levels = levelsOf(B);
  h.scene.remove(h.world.group);
  const group = voidPlanes(B);
  h.scene.add(group);
  Object.assign(h, {layout: B, levels, propIndex: new PropIndex(levels, B.props), trainPlacement: playerTrainPlacement(B)});
  h.world.group = group;
  for (const s of h.sectionHooks) s.build?.(B);
}

interface Trace { phase: string; x: number; z: number; yaw: number; tv: number; speed: number }
/** Runs a ride frame by frame, checking FRONT FIRST and the yaw's continuity on every frame. */
function rideChecks(h: Host, ride: TrainRide, seconds: number, until: () => boolean) {
  const out = {maxBack: 0, maxYawStep: 0, minTransitV: Infinity, frames: 0, arrivalStart: null as Trace | null, trace: [] as Trace[]};
  let last: Trace = {phase: ride.phase, x: ride.base.x, z: ride.base.z, yaw: ride.base.yaw, tv: ride.transitV, speed: ride.speed};
  run(h, ride, seconds, () => {
    const now: Trace = {phase: ride.phase, x: ride.base.x, z: ride.base.z, yaw: ride.base.yaw, tv: ride.transitV, speed: ride.speed};
    out.frames++;
    if (ride.phase === 'transit') out.minTransitV = Math.min(out.minTransitV, ride.transitV);
    if (now.phase === 'arriving' && last.phase === 'transit') out.arrivalStart = now;
    out.maxYawStep = Math.max(out.maxYawStep, Math.abs(now.yaw - last.yaw));
    // in a station the car's own motion never runs against its +X (the jostle is lateral / vertical only; base excludes it anyway)
    if (now.phase === last.phase && (now.phase === 'departing' || now.phase === 'arriving')) {
      const ax = Math.cos(now.yaw), az = -Math.sin(now.yaw);
      out.maxBack = Math.max(out.maxBack, -((now.x - last.x) * ax + (now.z - last.z) * az));
    }
    last = now;
    out.trace.push(now);
    return until();
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Item 16: plans, portals, clearance

describe('item 16: FRONT FIRST plans and portals on every level kind', () => {
  it('the departure takes the front end and the arrival comes out of the rear end (cab leading both ways); bed ends are classified stub / edge', () => {
    const cases: [string, StationLayout][] = [
      ['subway 4242', gen('subway', 4242)], ['subway 3', gen('subway', 3)], ['subway 8', gen('subway', 8)],
      ['office 4242', gen('office', 4242)], ['mall 4242', gen('mall', 4242)], ['reactor 4242', gen('reactor', 4242)],
    ];
    const seen = {stub: 0, edge: 0, tunnel: 0};
    const kinds: Record<string, string> = {};
    for (const [tag, L] of cases) {
      const p = playerTrainPlacement(L)!;
      const d = departurePlan(L, p), a = arrivalPlan(L, p);
      expect(d.end, tag).toBe(p.front > 0 ? 'x1' : 'x0');
      expect(a.end, tag).toBe(p.front > 0 ? 'x0' : 'x1');
      expect(d.sgn, tag).toBe(1);
      expect(a.sgn, tag).toBe(-1);
      expect(departDir(d)).toBe(1);
      expect(arriveDir(a)).toBe(1);
      const lv = levelsOf(L);
      for (const [which, pl] of [['dep', d], ['arr', a]] as const) {
        const mode = pl.kind === 'tunnel' ? 'tunnel' : bedEndClear(lv, L, p, pl.end) ? 'stub' : 'edge';
        seen[mode]++;
        kinds[`${tag} ${which}`] = mode;
        if (pl.kind === 'bed-end') {
          expect(pl.uEdge, tag).toBeGreaterThan(0);
          expect(pl.uDark - pl.uMouth, tag).toBeCloseTo(L2 + RIDE_ROUTE.darkS, 9);
          expect(pl.route.length, tag).toBeGreaterThan(pl.uDark + L2); // the stub run fits the bed-end route
        }
      }
    }
    // the probe-verified classes: the mall comes out of its clear rear bed end through a stub, the Office / Subway front ends have
    // rooms behind them (edge), the Reactor's front end is clear rock (stub), a tunnel-less Subway (seed 8) is edge both ways
    expect(kinds['mall 4242 arr']).toBe('stub');
    expect(kinds['office 4242 dep']).toBe('edge');
    expect(kinds['subway 4242 dep']).toBe('edge');
    expect(kinds['subway 4242 arr']).toBe('tunnel');
    expect(kinds['reactor 4242 dep']).toBe('stub');
    expect(kinds['subway 8 dep']).toBe('edge');
    expect(kinds['subway 8 arr']).toBe('edge');
    expect(seen.stub + seen.edge + seen.tunnel).toBe(cases.length * 2);
  }, 120000);
});

// ---------------------------------------------------------------------------------------------
// Item 16: the ride never reverses; the yaw never snaps; edge / stub crossings

describe('item 16: a ride never reverses, never snaps its yaw, crosses bed ends without cutting the car', () => {
  it('Subway (front edge -> rear tunnel, same station): forward motion only, bounded yaw steps, the cab leads into the platform, exact stop', async () => {
    const {h, rt, ride, p} = setup(gen('subway', 4242));
    const before = worldToTrain(p, h.player.x, h.player.y, h.player.z);
    let dep: {status: string} | null = null;
    void ride.depart().then(r => { dep = r; });
    expect(ride.cross).toBe('edge'); // rooms behind the front end face
    const plan = ride.plan!;
    // the departure: the cab's nose never passes the black end plane (edge crossing), then the transit
    let maxNose = -Infinity;
    const a = rideChecks(h, ride, 80, () => {
      if (ride.phase === 'departing') maxNose = Math.max(maxNose, ride.u + L2);
      return ride.phase === 'transit';
    });
    await Promise.resolve();
    expect(dep).toMatchObject({status: 'in-tunnel', dir: 1});
    expect(maxNose).toBeLessThanOrEqual(plan.uMouth - RIDE_ROUTE.planeClear + 1e-6);
    expect(ride.transit.mode).toBe('transit');
    // the car keeps its yaw into the transit (no snap): the transit box takes it
    expect(ride.transit.yaw).toBeCloseTo(ride.base.yaw, 9);
    expect(Math.abs(ride.base.yaw - p.yaw)).toBeLessThan(0.05);
    // arrive at the same station: out of the REAR end (its tunnel), front first
    let arr: {status: string; reversed?: boolean} | null = null;
    void ride.arrive().then(r => { arr = r; });
    const b = rideChecks(h, ride, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped', end: p.front > 0 ? 'x0' : 'x1', reversed: false});
    for (const c of [a, b]) {
      expect(c.maxBack).toBeLessThan(1e-9);
      expect(c.maxYawStep).toBeLessThan(0.03);
    }
    expect(b.minTransitV).toBeGreaterThanOrEqual(0);
    expect(ride.counts.reversals).toBe(0);
    // the car came in from behind the parked car (the rear end), cab first
    const s = b.arrivalStart!;
    expect(((s.x - p.x) * p.front)).toBeLessThan(-L2);
    expect(Math.abs(s.yaw - p.yaw) % (2 * Math.PI)).toBeLessThan(0.3);
    // exact stop, same car-local pose, normal physics in the parked car
    const root = rt.view!.root;
    expect([root.position.x, root.position.y, root.position.z]).toEqual([p.x, p.railTopY, p.z]);
    expect(root.rotation.y).toBe(p.yaw);
    const after = worldToTrain(p, h.player.x, h.player.y, h.player.z);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
    expect(rt.playerInside()).toBe(true);
    expect(ride.transit.active).toBe(false);
  }, 90000);

  it('Subway -> Mall: the car comes out of the mall\'s clear REAR bed end through a stub (end plane hidden, then whole), cab first, exact stop', async () => {
    const A = gen('subway', 4242), B = gen('mall', 4242);
    const {h, rt, ride} = setup(A);
    void ride.depart();
    run(h, ride, 80, () => ride.phase === 'transit');
    swapTo(h, B);
    const p = h.trainPlacement!;
    const t = B.trenches[p.trenchIndex], rearEnd = p.front > 0 ? 'x0' : 'x1', key = `${p.trenchIndex}:${rearEnd}`;
    const plane = (() => { let f: THREE.Object3D | null = null; h.world.group.traverse(o => { if (o.userData.bedEndVoid === key) f = o; }); return f as unknown as THREE.Object3D; })();
    expect(plane.visible).toBe(true);
    void ride.arrive();
    let sawStub = false, hiddenWhileIn = true, groupOk = true;
    const c = rideChecks(h, ride, 150, () => {
      if (ride.phase === 'arriving' && ride.transit.mode === 'stub') {
        sawStub = true;
        // the stub continues the bed OUTWARD from the end face: its walls span [face, face + 2 * half] along the outward axis
        const e = rearEnd === 'x1' ? 1 : -1, face = rearEnd === 'x1' ? t.x1 : t.x0;
        groupOk &&= Math.abs(ride.transit.anchor.x - (face + e * TRANSIT.half)) < 1e-9 && Math.abs(ride.transit.anchor.z - p.z) < 1e-9;
        // the plane stays hidden while any part of the car is still near / behind it
        const tail = ride.u + L2, uMouth = ride.plan!.uMouth;
        if (tail > uMouth - 1) hiddenWhileIn &&= !plane.visible;
      }
      return !ride.riding;
    });
    expect(ride.cross).toBe('stub');
    expect(sawStub).toBe(true);
    expect(groupOk).toBe(true);
    expect(hiddenWhileIn).toBe(true);
    expect(plane.visible).toBe(true); // whole again
    expect(ride.transit.active).toBe(false);
    expect(c.maxBack).toBeLessThan(1e-9);
    expect(c.maxYawStep).toBeLessThan(0.03);
    expect(c.minTransitV).toBeGreaterThanOrEqual(0);
    const s = c.arrivalStart!;
    expect((s.x - p.x) * p.front).toBeLessThan(-(L2 + RIDE_ROUTE.darkS)); // started inside the stub, beyond the face
    const root = rt.view!.root;
    expect([root.position.x, root.position.y, root.position.z]).toEqual([p.x, p.railTopY, p.z]);
    expect(root.rotation.y).toBe(p.yaw);
    expect(rt.playerInside()).toBe(true);
  }, 120000);

  it('a stub hands over to the transit seamlessly: the same pattern phase and signals around the car', () => {
    const tt = new TrainTransitTunnel().build(basic());
    const face = {x: 30, y: -0.85, z: 4};
    tt.placeStub(face, {x: 1, z: 0}, 0, RIDE.stubSignal);
    // every shown stub signal is beyond the end face, the first one RIDE.stubSignal past it
    const sOut = tt.signalOffsets().map(x => tt.anchor.x + x - face.x);
    expect(Math.min(...sOut)).toBeCloseTo(RIDE.stubSignal, 9);
    // a car 13.25 m into the stub: its view of the pattern and the signals before / after the hand-over
    const car = {x: face.x + L2 + RIDE_ROUTE.darkS, z: face.z};
    const relSignals = () => tt.signalOffsets().map(x => +(tt.anchor.x + x - car.x).toFixed(9)).sort((a, b) => a - b);
    const patternAt = () => ((((car.x - tt.group.position.x) % TRANSIT.period) + TRANSIT.period) % TRANSIT.period);
    const sig0 = relSignals().filter(v => v > -70 && v < 70), pat0 = patternAt();
    tt.handOver(car.x, car.z);
    expect(tt.mode).toBe('transit');
    car.x = TRANSIT.origin.x; car.z = TRANSIT.origin.z; // the car now stands at the transit origin
    const sig1 = relSignals().filter(v => v > -70 && v < 70);
    expect(sig1).toEqual(sig0);
    expect(patternAt()).toBeCloseTo(pat0, 9);
    // the arrival stub (the car's +X inward): no signal between the face and the car's start, the first RIDE.stubSignalBehind behind it
    const back = new TrainTransitTunnel().build(basic());
    const start = L2 + RIDE_ROUTE.darkS;
    back.placeStub(face, {x: 1, z: 0}, Math.PI, start + RIDE.stubSignalBehind);
    const outs = back.signalOffsets().map(x => back.anchor.x - x - face.x); // group +X = -out
    expect(Math.min(...outs)).toBeCloseTo(start + RIDE.stubSignalBehind, 9);
  });

  it('brass lying in the car rides with it; brass outside stays', () => {
    const {h, ride, p, casings} = setup(gen('subway', 4242));
    const inCar = carToWorld(placementPose(p), 1.2, SPEC.floorY + 0.006, 0.4);
    const onPlatform = {x: p.x + 2, y: p.floorY + 0.006, z: p.z - (SPEC.interior.halfWidth + 3) * (p.yaw === 0 ? 1 : -1)};
    casings.pts.push({...inCar}, {...onPlatform});
    const local0 = worldToCar(placementPose(p), inCar.x, inCar.y, inCar.z);
    void ride.depart();
    let worst = 0;
    run(h, ride, 80, () => {
      const q = worldToCar(ride.pose, casings.pts[0].x, casings.pts[0].y, casings.pts[0].z);
      worst = Math.max(worst, Math.hypot(q.x - local0.x, q.y - local0.y, q.z - local0.z));
      return ride.phase === 'transit' && ride.transitT > 2;
    });
    expect(ride.counts.brassCarried).toBeGreaterThan(10);
    expect(worst).toBeLessThan(0.01); // (the jostle's pitch / roll tilt: millimetres)
    expect(casings.pts[1]).toEqual(onPlatform);
    ride.reset();
  }, 60000);
});

// ---------------------------------------------------------------------------------------------
// Lane MAP's journeys

describe('item 16 + lane MAP: multi-hop journeys', () => {
  it('journeyOf: one hop by default, + hopTransit per extra hop, capped', () => {
    expect(journeyOf()).toEqual({route: [], hops: 1, minTransit: RIDE.minTransit});
    expect(journeyOf({route: ['a', 'b']}).minTransit).toBe(RIDE.minTransit);
    expect(journeyOf({route: ['a', 'b', 'c', 'd']})).toMatchObject({hops: 3, minTransit: RIDE.minTransit + 2 * RIDE.hopTransit});
    expect(journeyOf({route: Array.from({length: 20}, (_, i) => `s${i}`)}).minTransit).toBe(RIDE.minTransit + RIDE.hopTransitCap);
  });

  it('depart({route}) holds the car in the transit at least the journey\'s minimum before it leaves for the destination', async () => {
    const {h, ride} = setup(gen('subway', 4242));
    void ride.depart({route: ['s0', 's1', 's2', 's3']});
    expect((ride.state() as {journey: {hops: number}}).journey.hops).toBe(3);
    run(h, ride, 80, () => ride.phase === 'transit');
    void ride.arrive(); // (the same station: ready at once)
    let leftAt = -1;
    run(h, ride, 150, () => { if (ride.phase === 'arriving' && leftAt < 0) leftAt = ride.transitT; return !ride.riding; });
    expect(leftAt).toBeGreaterThanOrEqual(RIDE.minTransit + 2 * RIDE.hopTransit);
  }, 90000);
});

// ---------------------------------------------------------------------------------------------
// Item 15: the dark transit and its red signals

describe('item 15: a very dark transit with red signals', () => {
  it('no warm lamps, no lights, no shadow casters; red signal lenses (glow-fog hook, no fog uniform of their own) facing the oncoming car', () => {
    const tt = new TrainTransitTunnel().build({...basic(), lens: undefined, glow: undefined});
    let lights = 0, casters = 0;
    const names: string[] = [];
    tt.group.traverse(o => { if ((o as THREE.Light).isLight) lights++; if ((o as THREE.Mesh).isMesh) { names.push(o.name); if (o.castShadow) casters++; } });
    expect(lights).toBe(0);
    expect(casters).toBe(0);
    expect(names.some(n => /lamp/.test(n))).toBe(false);
    expect(names).toEqual(expect.arrayContaining(['transit-signal-housings', 'transit-signal-lenses', 'transit-signal-glow']));
    const lens = tt.group.getObjectByName('transit-signal-lenses') as THREE.InstancedMesh, housing = tt.group.getObjectByName('transit-signal-housings') as THREE.InstancedMesh;
    const lm = lens.material as THREE.MeshBasicMaterial;
    expect((lm as unknown as {isNodeMaterial?: boolean}).isNodeMaterial).toBe(true);
    expect(lm.color.r).toBeGreaterThan(0.9);
    expect(lm.color.g).toBeLessThan(0.1);
    expect(lm.fog).toBe(false); // the shared glow-fog hook (GLOW_FOG uniforms) instead
    expect(lm.userData.glowFog).toBe(TRANSIT.signal.fog);
    const glow = (tt.group.getObjectByName('transit-signal-glow') as THREE.InstancedMesh).material as THREE.Material;
    expect(glow.blending).toBe(THREE.AdditiveBlending);
    expect(glow.depthWrite).toBe(false);
    // the lens sits on the housing's -X face (toward the car, which always runs +X), on the wall opposite the third rail
    const ml = new THREE.Matrix4(), mh = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
    lens.getMatrixAt(1, ml); housing.getMatrixAt(1, mh);
    a.setFromMatrixPosition(ml); b.setFromMatrixPosition(mh);
    expect(a.x).toBeLessThan(b.x - TRANSIT.signal.housing[0] / 2 + 1e-9);
    expect(Math.sign(a.z)).toBe(-Math.sign(TRANSIT.third.z));
    tt.dispose();
  });

  it('signals at a block spacing pass backwards at the car\'s speed; the arrival cut lets no new one into sight, wrap-safe', () => {
    const tt = new TrainTransitTunnel().build(basic());
    tt.enterTransit(0);
    tt.setSignalAhead(TRANSIT.signal.ahead);
    const o0 = tt.signalOffsets().sort((x, y) => x - y);
    for (let i = 1; i < o0.length; i++) expect(o0[i] - o0[i - 1]).toBeCloseTo(TRANSIT.signal.step, 9);
    expect(Math.min(...o0.filter(x => x > 0))).toBeCloseTo(TRANSIT.signal.ahead, 9);
    tt.advance(2.5);
    const o1 = tt.signalOffsets().sort((x, y) => x - y);
    expect(o1.map((x, i) => x - o0[i]).every(d => Math.abs(d + 2.5) < 1e-9)).toBe(true); // all 2.5 m further back
    // the cut: shown signals only ever leave, the in-band one leaves only once behind the band, then none is in sight
    const [lo, hi] = RIDE.signalBand;
    tt.advance(TRANSIT.signal.ahead - 10); // a signal 10 m ahead
    tt.hideSignalsOutside(lo, hi);
    expect(tt.signalsWithin(lo, hi)).toBe(1);
    let shown = tt.signalOffsets().length;
    for (let i = 0; i < 4000; i++) {
      tt.advance(0.25);
      tt.hideSignalsOutside(lo, hi);
      const now = tt.signalOffsets();
      expect(now.length).toBeLessThanOrEqual(shown);
      for (const x of now) expect(x).toBeGreaterThanOrEqual(lo - 0.25);
      shown = now.length;
    }
    expect(tt.signalsWithin(lo, hi)).toBe(0);
    // a fresh transit shows them all again
    tt.enterTransit(0);
    expect(tt.signalOffsets().length).toBe(TRANSIT.signal.count);
  });

  it('out of sight at the band edge: the lens fog and the glow card fade put both below ~2 % there', () => {
    const edge = Math.min(-RIDE.signalBand[0], RIDE.signalBand[1]);
    const lensLeft = Math.exp(-((TRANSIT.signal.fog * MOOD.fogDensity * edge) ** 2));
    expect(lensLeft).toBeLessThan(0.02);
    expect(TRANSIT.signal.glowFar * 0.95).toBeLessThanOrEqual(edge);
    expect(TRANSIT.signal.step).toBeGreaterThan(edge - RIDE.signalBand[0]); // at most one signal in sight at a time
  });

  it('the station light field reads zero at the transit (Subway, Mall with its sky field): only the car\'s lights and the flashlight light it', () => {
    for (const L of [gen('subway', 4242), gen('mall', 4242)]) {
      const f = bakeLightField({grid: L.grid, lights: L.lights, trenchFloorY: L.trench.floorY, levels: stationLevels(L), ...mallSkyField(L, CELL)});
      for (const y of [0.5, 2.5, 4]) {
        const q = sampleField(f, TRANSIT.origin.x, y, TRANSIT.origin.z);
        expect(Math.max(...q.amb, ...q.dirColor)).toBe(0);
      }
    }
  }, 60000);

  it('a level\'s own fog is held while the transit shows (the indoor murk) and given back on arrival; a teardown drops it', async () => {
    const mallFog = new THREE.FogExp2(0x3a403c, 0.0115);
    const {h, ride} = setup(gen('subway', 4242), {fog: mallFog});
    void ride.depart();
    run(h, ride, 80, () => ride.phase === 'transit');
    run(h, ride, 0.5);
    const fog = h.scene.fog as THREE.FogExp2;
    expect(fog.density).toBe(MOOD.fogDensity);
    expect(fog.color.getHex()).toBe(MOOD.fogColor);
    void ride.arrive();
    run(h, ride, 150, () => ride.phase === 'arriving');
    expect(fog.density).toBe(0.0115);
    expect(fog.color.getHex()).toBe(0x3a403c);
    run(h, ride, 150, () => !ride.riding);
    // a teardown while the transit shows: the old level restores its own fog; nothing stale comes back on arrival
    fog.density = 0.0115; fog.color.setHex(0x3a403c);
    void ride.depart();
    run(h, ride, 80, () => ride.phase === 'transit');
    run(h, ride, 0.2);
    expect(fog.density).toBe(MOOD.fogDensity);
    swapTo(h, gen('subway', 4242)); // (the fake level's teardown restores nothing: the fog stays the murk)
    void ride.arrive();
    run(h, ride, 150, () => !ride.riding);
    expect(fog.density).toBe(MOOD.fogDensity);
  }, 120000);

  it('the transit is in the warm-up registry (signals compile with the boot warm-up, not on first sight)', () => {
    const {h, ride} = setup(gen('subway', 4242));
    expect(h.warmRegistry.names.pools).toContain('train-transit');
    expect(h.warmRegistry.poolRoots()).toContain(ride.transit.group);
    expect(ride.transit.group.getObjectByName('transit-signal-lenses')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Item 17: the ride sound

describe('item 17: the ride sound', () => {
  it('loops only while moving, blended by speed; no run window on the final approach; gone at the stop (no hum while parked)', async () => {
    const sfx = new FakeRideSfx();
    const {h, ride} = setup(gen('subway', 4242), {sfx});
    void ride.depart();
    run(h, ride, 4, () => ride.phase === 'departing');
    expect(sfx.loops.length).toBe(0); // closing: at rest, silent
    const levels: {v: number; r: number}[] = [];
    run(h, ride, 80, () => { const r = sfx.alive.find(l => l.cue === 'bedRumble'); if (r) levels.push({v: ride.speed, r: r.level}); return ride.phase === 'transit' && ride.speed >= RIDE.cruise - 1e-6; });
    expect(sfx.alive.map(l => l.cue).sort()).toEqual(['bedRumble', 'bedWind']);
    // the rumble rises with the speed (start blend) to the cruise mix
    for (let i = 1; i < levels.length; i++) if (levels[i].v > levels[i - 1].v + 1e-9) expect(levels[i].r).toBeGreaterThanOrEqual(levels[i - 1].r - 1e-9);
    run(h, ride, 1);
    expect(ride.audio.level.rumble).toBeCloseTo(RIDE_AUDIO.rumble.level[1], 6);
    expect(ride.audio.level.air).toBeCloseTo(RIDE_AUDIO.air.level, 6);
    // pause / a menu: quiet (loops kept); the next ride frame brings them back
    for (const f of h.stateListeners) (f as unknown as (s: string, q: string) => void)('paused', 'playing');
    expect(sfx.alive.every(l => l.level === 0)).toBe(true);
    run(h, ride, 0.1);
    expect(sfx.alive.find(l => l.cue === 'bedRumble')!.level).toBeGreaterThan(0.3);
    // the arrival: no run window once arriving; the loops fade with the brakes and are released at the stop
    void ride.arrive();
    run(h, ride, 150, () => ride.phase === 'arriving');
    const runsBefore = sfx.cues.filter(c => c === 'trainDistant').length;
    run(h, ride, 150, () => !ride.riding);
    expect(sfx.cues.filter(c => c === 'trainDistant').length).toBe(runsBefore);
    expect(sfx.cues).toEqual(expect.arrayContaining(['clank', 'creak']));
    expect(sfx.alive.length).toBe(0);
    expect(ride.audio.playing).toBe(false);
    run(h, ride, 3); // parked: nothing starts again
    expect(sfx.alive.length).toBe(0);
  }, 120000);

  it('reset (menu / death / failed journey) and dispose stop the loops at once', async () => {
    const sfx = new FakeRideSfx();
    const {h, ride} = setup(gen('subway', 4242), {sfx});
    void ride.depart();
    run(h, ride, 80, () => ride.phase === 'transit');
    expect(sfx.alive.length).toBe(2);
    ride.transitFailed('load failed (test)');
    run(h, ride, 1); // a failed load keeps the car running (the primary retries / sends it back): still moving, still heard
    expect(sfx.alive.length).toBe(2);
    for (const f of h.stateListeners) (f as unknown as (s: string, q: string) => void)('error', 'playing'); // no station at all: reset
    expect(ride.riding).toBe(false);
    expect(sfx.alive.length).toBe(0);
    void ride.depart();
    run(h, ride, 80, () => ride.phase === 'transit');
    expect(sfx.alive.length).toBe(2);
    ride.dispose();
    expect(sfx.alive.length).toBe(0);
    expect(ride.riding).toBe(false);
  }, 120000);

  it('Sfx.rideLoop: a non-positional loop into the master (volume applies), eased level / rate / lowpass, stop releases; none while paused', async () => {
    const made: FakeCtx[] = [];
    const {bank} = fakeBank({variants: 1, only: ['bedRumble', 'bedWind']});
    const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
    sfx.init();
    sfx.suspend(false);
    await new Promise(r => setTimeout(r, 40));
    const ctx = made[0];
    const pans = ctx.nodes.filter(n => n.kind === 'panner').length;
    const h = sfx.rideLoop('bedRumble')!;
    expect(h.playing).toBe(true);
    expect(ctx.nodes.filter(n => n.kind === 'panner').length).toBe(pans); // non-positional
    const src = ctx.started.at(-1)!;
    expect(src.loop).toBe(true);
    expect(src.loopEnd).toBeGreaterThan(src.loopStart);
    // src -> lowpass -> gain -> master (the master gain is the volume setting)
    const lp = src.outputs[0] as FakeNode & {frequency: {value: number}}, g = lp.outputs[0] as FakeNode & {gain: {value: number}};
    const master = (sfx as unknown as {master: FakeNode & {gain: {value: number}}}).master;
    expect(g.outputs).toContain(master);
    expect(g.gain.value).toBe(0); // starts silent
    h.setLevel(0.5); h.setRate(1.1); h.setLowpass(1200);
    expect(g.gain.value).toBeCloseTo(0.5, 9); // x CUE_GAIN.bedRumble (1)
    expect(src.playbackRate.value).toBeCloseTo(1.1, 9);
    expect(lp.frequency.value).toBe(1200);
    sfx.setVolume(0.3);
    expect(master.gain.value).toBeCloseTo(0.3, 9);
    h.stop();
    expect(h.playing).toBe(false);
    h.setLevel(1); // ignored once stopped
    expect(g.gain.value).toBe(0);
    sfx.pause();
    expect(master.gain.value).toBe(0);
    expect(sfx.rideLoop('bedWind')).toBeNull();
  });
});
