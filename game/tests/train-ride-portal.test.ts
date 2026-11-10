// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane RIDE): the moving train and the RIDE PORTALS (world/trainRide.ts,
// trainRideRoute.ts, trainTransitTunnel.ts against the lead's contract world/ridePortal.ts / ridePortalRuntime.ts / rideMask.ts) — on
// real generated levels of EVERY level kind in the registry, with the real Player / PlayerTrainRuntime / TrainRide, a fake Game host
// stepped in Game.update's order (the ride, the frame hooks, the camera) and a recording stand-in for the portal runtime:
//  - a chain of journeys, each level kind left and arrived at once per seed: frame by frame the car's centre stays on its straight
//    track line and nothing of the car lies outside the bed / the station tunnel's first straight (station side of the portal plane)
//    or the ride box (beyond it) — it never crosses a wall; the ride tunnel always covers the car and its sight;
//  - the portal: engaged before the doors have shut, its gate fully open before the car moves toward it and until the car is through,
//    shut behind the car both ways, released after the arrival (a breach: engaged for the whole run in the tunnel);
//  - both hand-overs change NOTHING in the car's frame: the box, its pattern, every signal in sight, the fog, the light mask, the
//    car's speed / yaw / jostle clock and the player's local pose; the plane is RIDE_PORTAL.dark beyond the car's end;
//  - both yaws (front +1 and -1 occur in the registry's levels): the tunnel is the same in the car's frame, and symmetric about it.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {SOLID} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {Player, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {RAIL_TOP_ABOVE_BED, playerTrainPlacement, trainSpawnPose, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain} from '../src/world/playerTrain';
import {carToWorld, jostleBounds} from '../src/world/trainRideLocal';
import type {RidePlan} from '../src/world/trainRideRoute';
import {TRANSIT, TrainTransitTunnel, transitMaskBox, type TransitMaterials} from '../src/world/trainTransitTunnel';
import {RIDE, TrainRide, installTrainRide} from '../src/world/trainRide';
import {RIDE_BOX, RIDE_PORTAL, inBox, ridePortals, type RidePortal} from '../src/world/ridePortal';
import type {PortalState, PortalWhich, RidePortalRuntime} from '../src/world/ridePortalRuntime';
import {RIDE_MASK, setRideMask} from '../src/world/rideMask';
import {MOOD} from '../src/world/lights';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
const L2 = SPEC.length / 2, HW = SPEC.width / 2;
const D = L2 + RIDE_PORTAL.dark; // the car centre's distance beyond the plane at a hand-over
const SEEDS = [4242, 8];

class NoKeys implements MoveInput { down() { return false; } hit() { return false; } }
const NOKEYS = new NoKeys();

const layouts = new Map<string, StationLayout>();
const gen = (level: (typeof LEVEL_IDS)[number], seed: number): StationLayout => {
  const k = `${level} ${seed}`;
  let l = layouts.get(k);
  if (!l) layouts.set(k, (l = LEVELS[level].generate('main', {levelSeed: seed})));
  return l;
};
const basic = (): TransitMaterials => {
  const m = () => new THREE.MeshBasicMaterial();
  return {wall: m(), ceiling: m(), floor: m(), rail: m(), sleeper: m(), lens: m(), glow: m()};
};
const mod = (a: number, n: number) => ((a % n) + n) % n;

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } setRideMask(null); });

// ---------------------------------------------------------------------------------------------
// A recording stand-in for world/ridePortalRuntime.ts (the contract's surface; the gate swings over 1.3 s, a release shuts the gate
// first, a breach goes once the eye is 50 m away or after 3 s; engage sets the light mask of its portal, the release clears it)

interface PortalEvent { frame: number; ev: 'engage' | 'setGate' | 'release' | 'released'; which: PortalWhich; arg?: boolean }

class FakePortals {
  readonly log: PortalEvent[] = [];
  frame = 0;
  steps = 0;
  private readonly st: Record<PortalWhich, {engaged: boolean; gate: number; want: number; releasing: boolean; t: number}> = {
    front: {engaged: false, gate: 0, want: 0, releasing: false, t: 0}, rear: {engaged: false, gate: 0, want: 0, releasing: false, t: 0},
  };
  constructor(readonly host: {layout: StationLayout; trainPlacement: TrainPlacement | null; sectionHooks: {build?(l: StationLayout): void; teardown?(): void}[]}) {
    host.sectionHooks.push({teardown: () => { for (const w of ['front', 'rear'] as const) this.finish(w); }});
  }
  portal(which: PortalWhich): RidePortal | null {
    const p = this.host.trainPlacement;
    return p ? ridePortals(this.host.layout, p)[which] : null;
  }
  engage(which: PortalWhich, o: {gateOpen: boolean}): void {
    const s = this.st[which], q = this.portal(which);
    if (!q || s.engaged) return;
    s.engaged = true; s.releasing = false; s.t = 0;
    s.gate = s.want = q.kind === 'breach' || o.gateOpen ? 1 : 0;
    setRideMask(q.box, q.x, 4);
    this.log.push({frame: this.frame, ev: 'engage', which, arg: o.gateOpen});
  }
  setGate(which: PortalWhich, open: boolean): void {
    const s = this.st[which];
    this.log.push({frame: this.frame, ev: 'setGate', which, arg: open});
    if (this.portal(which)?.kind === 'gate' && s.engaged) s.want = open ? 1 : 0;
  }
  gate(which: PortalWhich): number {
    const s = this.st[which];
    return this.portal(which)?.kind === 'breach' ? (s.engaged ? 1 : 0) : s.gate;
  }
  step(dt: number, eye?: {x: number; y: number; z: number}): void {
    this.steps++;
    for (const which of ['front', 'rear'] as const) {
      const s = this.st[which], q = this.portal(which);
      if (!s.engaged || !q) continue;
      if (q.kind === 'gate') {
        const d = dt / 1.3;
        s.gate = s.want > s.gate ? Math.min(s.want, s.gate + d) : Math.max(s.want, s.gate - d);
        if (s.releasing && s.gate <= 0) this.finish(which);
      } else if (s.releasing) {
        s.t += dt;
        if ((eye && Math.hypot(eye.x - q.x, eye.z - q.z) > 50) || s.t > 3) this.finish(which);
      }
    }
  }
  release(which: PortalWhich, o: {now?: boolean} = {}): void {
    const s = this.st[which];
    if (!s.engaged) return;
    this.log.push({frame: this.frame, ev: 'release', which, arg: !!o.now});
    if (o.now) this.finish(which);
    else { s.releasing = true; s.want = 0; s.t = 0; }
  }
  engaged(which: PortalWhich): boolean { return this.st[which].engaged; }
  state(which: PortalWhich): PortalState {
    const s = this.st[which];
    return {portal: this.portal(which), engaged: s.engaged, gate: this.gate(which), hidden: {meshes: 0, triangles: 0, instances: 0, objects: 0}};
  }
  private finish(which: PortalWhich): void {
    const s = this.st[which];
    if (!s.engaged) return;
    s.engaged = false; s.releasing = false; s.gate = s.want = 0;
    setRideMask(null);
    this.log.push({frame: this.frame, ev: 'released', which});
  }
}

// ---------------------------------------------------------------------------------------------
// The host (Game's surface the train / the ride read) and Game.update's frame order

function makeHost(L: StationLayout, o: {fog?: THREE.FogExp2; portals?: boolean} = {}) {
  const scene = new THREE.Scene();
  scene.fog = o.fog ?? new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(L);
  const host = {
    scene, camera, player: new Player(), zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[],
    levels, layout: L, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L) as TrainPlacement | null,
    sfx: null as unknown, hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn()},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', world: {culler: {register: vi.fn(), release: vi.fn()}, group: new THREE.Group()}, run: {current: {level: 'subway', section: 'main'}},
    gear: {placeRules: [] as ((x: number, y: number, z: number, level: number) => string | null)[]}, mats: null,
    ridePortals: undefined as RidePortalRuntime | undefined,
  };
  return host;
}
type Host = ReturnType<typeof makeHost>;

function setup(L: StationLayout, o: {fog?: THREE.FogExp2; portals?: boolean; sfx?: unknown} = {}) {
  const h = makeHost(L, o);
  if (o.sfx) h.sfx = o.sfx;
  const rt = installPlayerTrain(h);
  live.push(rt);
  const portals = o.portals === false ? null : new FakePortals(h);
  if (portals) h.ridePortals = portals as unknown as RidePortalRuntime;
  const ride = installTrainRide(h, rt, {transitMaterials: basic});
  for (const s of h.sectionHooks) s.build?.(L);
  const p = h.trainPlacement!;
  const pose = trainSpawnPose(L, p);
  h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
  camera(h, ride);
  return {h, rt, ride, p, portals};
}

/** Game.updateCamera: the eye from the (world) player pose + the ride's late call (tiltCamera: the car's tilt, the frame's fog). */
function camera(h: Host, ride: TrainRide): void {
  const P = h.player;
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  ride.tiltCamera(h.camera);
  h.camera.updateMatrixWorld(true);
}

/** One frame in Game.update's order: the player (ride mode or the world body), the lane frame hooks, then the camera. */
function frame(h: Host, ride: TrainRide, portals?: FakePortals | null): void {
  if (portals) portals.frame++;
  if (ride.riding) ride.stepPlayer(DT, NOKEYS, OPTS);
  else h.player.update(DT, NOKEYS, h.levels, h.propIndex, OPTS);
  for (const f of h.frameHooks) f(DT);
  camera(h, ride);
}
function run(h: Host, ride: TrainRide, seconds: number, each?: () => boolean | void, portals?: FakePortals | null): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) { frame(h, ride, portals); if (each?.()) break; }
}

/** The swap to the next station as Game does it: teardown, the new layout on the host, build. */
function swapTo(h: Host, B: StationLayout): void {
  for (const s of h.sectionHooks) s.teardown?.();
  const levels = levelsOf(B);
  Object.assign(h, {layout: B, levels, propIndex: new PropIndex(levels, B.props), trainPlacement: playerTrainPlacement(B)});
  for (const s of h.sectionHooks) s.build?.(B);
}

// ---------------------------------------------------------------------------------------------
// What the rider can see, in the CAR's frame

interface Snap {
  phase: string; u: number; speed: number; yaw: number; dist: number; clock: number;
  /** The car's place in the tunnel's 48 m pattern; the box relative to the car (lateral offset, height, yaw), its reach along the car. */
  pattern: number; box: {lat: number; dy: number; dyaw: number}; reach: {ahead: number; behind: number};
  /** Shown signals: metres ahead (+) of the car centre. */
  signals: number[];
  fog: {density: number; hex: number};
  mask: {on: boolean; openX: number; centre: boolean; nose: boolean; tail: boolean};
  local: {x: number; y: number; z: number; yaw: number};
  jostle: {lateral: number; bump: number};
  tunnel: {active: boolean; mode: string};
}

function snap(h: Host, ride: TrainRide): Snap {
  const b = ride.base, tt = ride.transit, ax = Math.cos(b.yaw), az = -Math.sin(b.yaw), g = tt.group.position;
  const lat = -(g.x - b.x) * az + (g.z - b.z) * ax;
  const fog = h.scene.fog as THREE.FogExp2;
  const inMask = (lx: number) => { const w = carToWorld(b, lx, 1.5, 0); return RIDE_MASK.on && inBox(RIDE_MASK.box, w.x, w.y, w.z); };
  return {
    phase: ride.phase, u: ride.u, speed: ride.speed, yaw: b.yaw, dist: ride.dist, clock: ride.clock,
    pattern: tt.patternAt(b.x, b.z), box: {lat, dy: g.y - b.y, dyaw: mod(tt.yaw - b.yaw + Math.PI, 2 * Math.PI) - Math.PI}, reach: tt.reach(b.x, b.z),
    signals: tt.signalPoints().map(q => (q.x - b.x) * ax + (q.z - b.z) * az).sort((x, y) => x - y),
    fog: {density: fog.density, hex: fog.color.getHex()},
    mask: {on: RIDE_MASK.on, openX: RIDE_MASK.openX, centre: inMask(0), nose: inMask(L2), tail: inMask(-L2)},
    local: {...ride.local}, jostle: {lateral: ride.jostle.lateral, bump: ride.jostle.bump},
    tunnel: {active: tt.active, mode: tt.mode},
  };
}

/** The two frames around a hand-over show the same thing from the car, the car having run `ds` on in between. */
function expectSeamless(a: Snap, b: Snap, tag: string): void {
  const ds = b.dist - a.dist;
  expect(ds, tag).toBeGreaterThan(0);
  expect(ds, tag).toBeLessThan(RIDE.cruise * DT + 1e-9);
  // the box: same place around the car (co-axial, same height, same heading), its pattern only scrolled by the car's own run
  for (const s of [a, b]) {
    expect(Math.abs(s.box.lat), tag).toBeLessThan(1e-9);
    expect(Math.abs(s.box.dy), tag).toBeLessThan(1e-9);
    expect(Math.abs(s.box.dyaw), tag).toBeLessThan(1e-9);
    expect(s.tunnel.active, tag).toBe(true);
    // ... and it reaches beyond the rider's sight both ways (or to the portal plane behind / ahead of the car: a frame's run short of D)
    expect(s.reach.ahead, tag).toBeGreaterThanOrEqual(D - RIDE.cruise * DT - 1e-6);
    expect(s.reach.behind, tag).toBeGreaterThanOrEqual(D - RIDE.cruise * DT - 1e-6);
  }
  const slip = mod(b.pattern - a.pattern - ds + TRANSIT.period / 2, TRANSIT.period) - TRANSIT.period / 2;
  expect(Math.abs(slip), `${tag}: pattern`).toBeLessThan(1e-6);
  // every signal within sight of the car (its ends + RIDE_PORTAL.dark) is where it was; none appeared, none vanished
  const near = (s: Snap, shift: number) => s.signals.map(x => x + shift).filter(x => Math.abs(x) <= D + 1e-6);
  const sa = near(a, -ds), sb = near(b, 0);
  expect(sb.length, `${tag}: signals ${JSON.stringify([a.signals, b.signals])}`).toBe(sa.length);
  sa.forEach((x, i) => expect(Math.abs(sb[i] - x), `${tag}: signal ${i}`).toBeLessThan(1e-6));
  // the fog is the tunnel murk on both sides; the light mask is on with the whole car inside it
  for (const s of [a, b]) {
    expect(s.fog, tag).toEqual({density: MOOD.fogDensity, hex: MOOD.fogColor});
    expect(s.mask.on && s.mask.centre && s.mask.nose && s.mask.tail, `${tag}: mask ${JSON.stringify(s.mask)}`).toBe(true);
  }
  // the car: no speed or yaw jump, the jostle's clock and distance run on, the player where they stood
  expect(Math.abs(b.speed - a.speed), tag).toBeLessThanOrEqual(RIDE.transitBrake * DT + 1e-9);
  expect(b.yaw, tag).toBe(a.yaw);
  expect(b.clock - a.clock, tag).toBeCloseTo(DT, 9);
  expect(Math.abs(b.jostle.lateral - a.jostle.lateral), tag).toBeLessThan(0.002);
  expect(Math.abs(b.jostle.bump - a.jostle.bump), tag).toBeLessThan(0.003);
  expect(Math.hypot(b.local.x - a.local.x, b.local.y - a.local.y, b.local.z - a.local.z), tag).toBeLessThan(1e-9);
  expect(Math.abs(b.local.yaw - a.local.yaw), tag).toBeLessThan(1e-9);
}

/** Does anything of the car lie outside the bed / the station tunnel (station side of the plane) or the ride box (beyond it)? */
function carProblem(h: Host, ride: TrainRide, plan: RidePlan, p: TrainPlacement): string | null {
  const g = h.levels.grid(p.level), q = plan.portal, c = ride.pose;
  const roof = c.y + SPEC.roofY;
  if (roof > q.bedY + RIDE_BOX.ceil - 0.3) return `roof ${roof} too near the ride box's ceiling`;
  for (let lx = -L2; lx <= L2 + 1e-9; lx += L2 / 16) for (const lz of [-HW, 0, HW]) {
    const w = carToWorld(c, lx, 0, lz), beyond = (w.x - q.x) * q.out;
    if (beyond <= 0) {
      const [cx, cy] = g.cellOf(w.x, w.z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] === SOLID) return `solid under the car at local ${lx.toFixed(2)}, ${lz.toFixed(2)} (u ${ride.u.toFixed(2)})`;
      if (g.floorAt(w.x, w.z) > q.bedY + 0.05) return `raised floor under the car at local ${lx.toFixed(2)}, ${lz.toFixed(2)} (u ${ride.u.toFixed(2)})`;
      if (g.ceilAt(w.x, w.z) < roof) return `ceiling ${g.ceilAt(w.x, w.z)} below the roof ${roof} at local ${lx.toFixed(2)} (u ${ride.u.toFixed(2)})`;
    } else {
      if (Math.abs(w.z - q.z) > RIDE_BOX.half - 0.4) return `outside the ride box's walls at local ${lx.toFixed(2)}, ${lz.toFixed(2)}`;
      if (!ride.transit.active) return `no ride tunnel around the car beyond the plane (u ${ride.u.toFixed(2)})`;
      const r = ride.transit.reach(w.x, w.z);
      if (r.ahead < -1e-6 || r.behind < -1e-6) return `beyond the drawn box at local ${lx.toFixed(2)} (u ${ride.u.toFixed(2)})`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------

describe('the ride through the portals: every level kind, frame by frame', () => {
  it('the journeys below ride both yaws and both portal kinds each way, on every level kind of the registry', () => {
    const fronts = new Set<number>(), kinds = new Set<string>();
    for (const seed of SEEDS) for (const id of LEVEL_IDS) {
      const L = gen(id, seed), p = playerTrainPlacement(L)!, r = ridePortals(L, p);
      fronts.add(p.front);
      kinds.add(`dep ${r.front.kind}`);
      kinds.add(`arr ${r.rear.kind}`);
    }
    expect([...fronts].sort()).toEqual([-1, 1]);
    expect(kinds).toEqual(new Set(['dep gate', 'dep breach', 'arr gate', 'arr breach']));
  }, 240000);

  for (const seed of SEEDS) {
    it(`seed ${seed}: each level kind is left and arrived at — straight, inside the bed / the ride box, the portal driven, both hand-overs unseen`, async () => {
      const ids = [...LEVEL_IDS];
      const {h, rt, ride, portals} = setup(gen(ids[0], seed));
      let p = h.trainPlacement!;
      const jb = jostleBounds(1);
      for (let i = 0; i < ids.length; i++) {
        const from = ids[i], to = ids[(i + 1) % ids.length], tagD = `${from} ${seed} departure`, tagA = `${to} ${seed} arrival`;
        const B = gen(to, seed);
        // ---- departure: an open door first (the doors are still closing when the portal is engaged)
        const di = rt.train!.doors.findIndex(d => d.col.door.side < 0);
        rt.setDoor(di, true);
        run(h, ride, 1.6, undefined, portals);
        const log0 = portals!.log.length;
        let dep: {status: string; via?: string} | null = null;
        void ride.depart().then(r => { dep = r; });
        const plan = ride.plan!, q = plan.portal;
        expect(plan.which, tagD).toBe('front');
        expect(q, tagD).toBe(ridePortals(h.layout, p).front);
        // engaged at once (gate shut), then asked to open — while a door is still open
        expect(portals!.log.slice(log0).map(e => `${e.ev} ${e.which} ${e.arg}`), tagD).toEqual(['engage front false', 'setGate front true']);
        expect(rt.train!.doors.some(d => d.t > 0), tagD).toBe(true);
        expect(ride.engaged, tagD).toBe('front');
        expect(ride.transit.mode, tagD).toBe('stub');
        expect(ride.transit.reach(q.x, q.z), tagD).toEqual({ahead: 2 * TRANSIT.half, behind: 0}); // the box starts exactly at the plane
        expect(ride.transit.axis()[0], tagD).toBe(p.front); // ... and its +X is the car's front (both yaws)
        let prev = snap(h, ride), last = prev, problem: string | null = null, movedShut = false, offLine = 0, gateAtPlane = 1, disengaged = false, shutAsked = -1, maxSpeedIn = 0, tDepart = 0;
        run(h, ride, 90, () => {
          const s = snap(h, ride);
          if (s.phase === 'transit') { last = s; return true; }
          prev = s;
          if (s.phase === 'departing') {
            tDepart += DT;
            if (rt.train!.doors.some(d => d.t > 0)) movedShut = true;
            problem ??= carProblem(h, ride, plan, p);
            offLine = Math.max(offLine, Math.abs(ride.base.z - p.z), Math.abs(ride.pose.z - p.z) - jb.lateral, Math.abs(ride.base.yaw - p.yaw));
            const nose = ride.u + L2, tail = ride.u - L2;
            // the gate: fully open from before the car moves until its trailing end is through the plane
            if (tail < plan.uPlane + RIDE.gateClear - RIDE.cruise * DT) gateAtPlane = Math.min(gateAtPlane, portals!.gate('front'));
            if (nose < plan.uPlane) maxSpeedIn = Math.max(maxSpeedIn, ride.speed);
            if (!portals!.engaged('front')) disengaged = true;
            if (shutAsked < 0 && portals!.log.slice(log0).some(e => e.ev === 'setGate' && e.arg === false)) shutAsked = tail - plan.uPlane;
          }
          return false;
        }, portals);
        await Promise.resolve();
        expect(dep, tagD).toMatchObject({status: 'in-tunnel', via: q.kind === 'breach' ? 'tunnel' : 'bed-end', end: q.end, dir: 1});
        expect(problem, tagD).toBeNull();
        expect(movedShut, tagD).toBe(false);
        expect(offLine, tagD).toBeLessThanOrEqual(1e-12);
        expect(gateAtPlane, `${tagD}: the gate was open all the way through`).toBe(1);
        expect(disengaged, `${tagD}: engaged for the whole run`).toBe(false);
        expect(maxSpeedIn, tagD).toBeLessThanOrEqual(RIDE.departMax + 1e-9);
        // the gate shut behind the car (asked once its trailing end was through), and was shut when the station was let go
        if (q.kind === 'gate') {
          expect(shutAsked, tagD).toBeGreaterThanOrEqual(RIDE.gateClear);
          expect(shutAsked, tagD).toBeLessThan(RIDE.gateClear + RIDE.cruise * DT);
        }
        const rel = portals!.log.slice(log0).filter(e => e.ev === 'release');
        expect(rel.map(e => `${e.which} ${e.arg}`), tagD).toEqual(['front true']); // released at once, at the hand-over only
        expect(portals!.engaged('front'), tagD).toBe(false);
        // the hand-over: the plane RIDE_PORTAL.dark behind the trailing end; nothing changed around the car
        expect(ride.hand.out!.clear, tagD).toBeGreaterThanOrEqual(RIDE_PORTAL.dark);
        expect(ride.hand.out!.clear, tagD).toBeLessThan(RIDE_PORTAL.dark + RIDE.cruise * DT);
        expect(Math.abs(ride.hand.out!.pattern[1] - ride.hand.out!.pattern[0]), tagD).toBeLessThan(1e-9);
        expect(prev.phase, tagD).toBe('departing');
        expectSeamless(prev, last, tagD);
        expect(last.mask.openX, tagD).toBeNaN(); // the transit's box: no open face
        expect(prev.mask.openX, tagD).toBe(q.x); // the portal's box before (the runtime's own)
        expect(tDepart, tagD).toBeLessThan(45);
        // ---- the old world goes, the next one is built, the car arrives
        run(h, ride, 1, undefined, portals);
        swapTo(h, B);
        p = h.trainPlacement!;
        const logA = portals!.log.length;
        let arr: {status: string; via?: string} | null = null;
        void ride.arrive().then(r => { arr = r; });
        let planA: RidePlan | null = null, sawBack = false, gateIn = 1, releasedAt = -1, stubGoneOpen = false, tArrive = 0;
        problem = null; offLine = 0; prev = snap(h, ride);
        run(h, ride, 200, () => {
          const s = snap(h, ride);
          if (s.phase === 'arriving' && !sawBack) {
            sawBack = true;
            planA = ride.plan!;
            // the hand-back frame: `prev` is the transit's last frame
            expect(prev.phase, tagA).toBe('transit');
            expectSeamless(prev, s, tagA);
            expect(prev.mask.openX, tagA).toBeNaN();
            expect(s.mask.openX, tagA).toBe(planA.portal.x);
            expect(ride.transit.mode, tagA).toBe('stub');
            expect(ride.transit.reach(planA.portal.x, planA.portal.z).ahead, tagA).toBeCloseTo(0, 9); // the box ends exactly at the plane
            expect(Math.abs(ride.transit.axis()[0] - p.front), tagA).toBeLessThan(1e-12);
          }
          if (s.phase === 'arriving') {
            tArrive += DT;
            const pl = planA!, tail = ride.u + L2;
            problem ??= carProblem(h, ride, pl, p);
            offLine = Math.max(offLine, Math.abs(ride.base.z - p.z), Math.abs(ride.pose.z - p.z) - jb.lateral, Math.abs(mod(ride.base.yaw - p.yaw + Math.PI, 2 * Math.PI) - Math.PI));
            // the gate stands open until the trailing end is through; the ride tunnel stays until the portal is released
            if (tail > pl.uPlane - RIDE.gateClear + RIDE.cruise * DT) { gateIn = Math.min(gateIn, portals!.gate('rear')); if (!portals!.engaged('rear')) releasedAt = Math.max(releasedAt, tail - pl.uPlane); }
            if (!ride.transit.active && portals!.engaged('rear') && portals!.gate('rear') > 0) stubGoneOpen = true;
          }
          prev = s;
          return !ride.riding;
        }, portals);
        await Promise.resolve();
        const pa = planA!.portal;
        expect(arr, tagA).toMatchObject({status: 'stopped', via: pa.kind === 'breach' ? 'tunnel' : 'bed-end', end: pa.end, reversed: false});
        expect(sawBack, tagA).toBe(true);
        expect(problem, tagA).toBeNull();
        expect(offLine, tagA).toBeLessThanOrEqual(1e-12);
        expect(gateIn, `${tagA}: the gate was open while the car came through`).toBe(1);
        expect(releasedAt, `${tagA}: engaged until the car was through`).toBe(-1);
        expect(stubGoneOpen, tagA).toBe(false);
        expect(ride.hand.back!.clear, tagA).toBeCloseTo(RIDE_PORTAL.dark, 9);
        expect(Math.abs(ride.hand.back!.pattern[1] - ride.hand.back!.pattern[0]), tagA).toBeLessThan(1e-9);
        expect(portals!.log.slice(logA).map(e => `${e.ev} ${e.which} ${e.arg}`)[0], tagA).toBe('engage rear true');
        expect(tArrive, tagA).toBeLessThan(45);
        // the exact stop; then the gate finishes shutting behind the parked car and the portal is released (the frame hook's tail)
        const root = rt.view!.root;
        expect([root.position.x, root.position.y, root.position.z], tagA).toEqual([p.x, p.railTopY, p.z]);
        expect(root.rotation.y, tagA).toBe(p.yaw);
        expect(rt.playerInside(), tagA).toBe(true);
        let goneOpen = false;
        run(h, ride, RIDE.releaseWait + 1, () => {
          if (!ride.transit.active && portals!.engaged('rear') && portals!.gate('rear') > 0) goneOpen = true;
          return !portals!.engaged('rear') && !ride.transit.active;
        }, portals);
        expect(goneOpen, tagA).toBe(false);
        expect(portals!.engaged('rear'), tagA).toBe(false);
        expect(ride.engaged, tagA).toBeNull();
        expect(ride.transit.active, tagA).toBe(false);
        expect(RIDE_MASK.on, tagA).toBe(false);
        const evs = portals!.log.slice(logA).map(e => `${e.ev} ${e.which}`);
        expect(evs.filter(e => e === 'released rear').length, tagA).toBe(1);
        if (pa.kind === 'gate') expect(evs.indexOf('setGate rear'), tagA).toBeGreaterThan(0); // (asked shut after the engage, before the release)
        expect(evs.indexOf('release rear'), tagA).toBeGreaterThan(0);
        expect((h.scene.fog as THREE.FogExp2).density, tagA).toBe(MOOD.fogDensity);
      }
    }, 240000);
  }
});

// ---------------------------------------------------------------------------------------------

describe('the ride tunnel in the car\'s frame: the same for both yaws, symmetric about the track', () => {
  it('the box is the ride box, co-axial with the car; every fitting keeps clear of the car\'s swept body', () => {
    const tt = new TrainTransitTunnel().build(basic());
    const hw = TRANSIT.halfWidth, bed = -RAIL_TOP_ABOVE_BED, T = TRANSIT;
    expect(hw).toBe(RIDE_BOX.half);
    expect(T.ceil).toBe(RIDE_BOX.ceil);
    // the walls / floor / ceiling: a box symmetric about the track centre line, from the bed to the ride box's ceiling
    const box = new THREE.Box3();
    for (const name of ['transit-walls', 'transit-floor', 'transit-ceiling']) box.union(new THREE.Box3().setFromBufferAttribute((tt.group.getObjectByName(name) as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute));
    // (the positions are float32: 1.95 is stored as 1.9500000476837158)
    expect(box.min.z).toBeCloseTo(-hw, 6);
    expect(box.max.z).toBeCloseTo(hw, 6);
    expect(box.min.y).toBeCloseTo(bed, 6);
    expect(box.max.y).toBeCloseTo(bed + RIDE_BOX.ceil, 6);
    expect([box.min.x, box.max.x]).toEqual([-T.half, T.half]);
    // the car's swept body: half its width + the jostle's sway and roll at roof height
    const jb = jostleBounds(1), swept = HW + jb.lateral + jb.roll * SPEC.roofY;
    expect(hw - swept).toBeGreaterThan(0.4);
    expect(bed + T.ceil - (SPEC.roofY + jb.bump)).toBeGreaterThan(0.6);
    // the cable tray and the signal housings (beside the body): at least 0.15 m off it; the third rail keeps the station beds' offset
    expect(hw - 0.04 - T.tray.w - swept).toBeGreaterThanOrEqual(0.15);
    const sig = tt.signalLocal(1);
    expect(Math.abs(sig.z) - T.signal.housing[2] / 2 - swept).toBeGreaterThanOrEqual(0.15);
    expect(Math.abs(sig.z) + T.signal.housing[2] / 2).toBeLessThan(hw);
    expect(T.third.z + T.third.w / 2).toBeLessThan(hw - 0.3);
  });

  it('a stub of either yaw puts the same tunnel around the car: +X the car\'s front, the fittings on the same sides, the far end capped', () => {
    const views: Record<string, number[]> = {};
    for (const front of [1, -1] as const) for (const which of ['front', 'rear'] as const) {
      const tt = new TrainTransitTunnel().build(basic());
      const yaw = front > 0 ? 0 : Math.PI, out = which === 'front' ? front : -front, plane = {x: 40, y: -0.855, z: 7};
      // the car: beyond the plane by D, heading +front (a departure runs outward, an arrival inward)
      const car = {x: plane.x + out * D, y: plane.y, z: plane.z, yaw, pitch: 0, roll: 0};
      if (which === 'front') tt.placeStub(plane, {x: out, z: 0}, yaw, RIDE.stubSignal);
      else { tt.enterTransit(yaw); tt.advance(tt.arrivalGap(D)); tt.handBack(plane, {x: out, z: 0}, yaw, D); }
      // car-local points of the tunnel: the third rail, the tray, a wall, expressed from the car
      tt.group.updateMatrixWorld(true);
      const toCar = (v: THREE.Vector3) => { const w = v.applyMatrix4(tt.group.matrixWorld); const c = Math.cos(yaw), s = Math.sin(yaw); const dx = w.x - car.x, dz = w.z - car.z; return [dx * c - dz * s, w.y - car.y, dx * s + dz * c]; };
      const third = toCar(new THREE.Vector3(0, 0, TRANSIT.third.z)), tray = toCar(new THREE.Vector3(0, 0, TRANSIT.halfWidth - 0.1)), sigSide = toCar(new THREE.Vector3(0, 0, tt.signalLocal(1).z));
      views[`${front} ${which}`] = [third[2], tray[2], sigSide[2]].map(v => +v.toFixed(9));
      // the box reaches the plane on the plane's side and 2 * half beyond it on the other; the far end is the capped one
      const r = tt.reach(car.x, car.z);
      expect(which === 'front' ? r.behind : r.ahead).toBeCloseTo(D, 9);
      expect(which === 'front' ? r.ahead : r.behind).toBeCloseTo(2 * TRANSIT.half - D, 9);
      expect(tt.endCap).toBe(which === 'front' ? 1 : -1);
      // both side walls are RIDE_BOX.half from the car's centre line: either window sees the same wall distance
      for (const side of [-1, 1]) expect(Math.abs(toCar(new THREE.Vector3(0, 1, side * TRANSIT.halfWidth))[2])).toBeCloseTo(RIDE_BOX.half, 9);
    }
    // the third rail / the tray on the car's +Z side, the signals on its -Z side — whatever the world yaw and the portal
    const ref = views['1 front'];
    expect(ref[0]).toBeCloseTo(TRANSIT.third.z, 9);
    expect(ref[2]).toBeLessThan(0);
    for (const v of Object.values(views)) expect(v).toEqual(ref);
  });

  it('the transit mask box holds the tunnel at any yaw; in transit neither end is capped', () => {
    const b = transitMaskBox(), tt = new TrainTransitTunnel().build(basic());
    for (const yaw of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.1]) {
      tt.enterTransit(yaw);
      for (const adv of [0, 13.3, 47.9]) {
        tt.advance(adv);
        expect(tt.endCap).toBe(0);
        tt.group.updateMatrixWorld(true);
        for (const x of [-TRANSIT.half, 0, TRANSIT.half]) for (const z of [-TRANSIT.halfWidth, TRANSIT.halfWidth]) {
          const w = new THREE.Vector3(x, 1, z).applyMatrix4(tt.group.matrixWorld);
          expect(inBox(b, w.x, w.y, w.z), `yaw ${yaw} ${x} ${z}`).toBe(true);
        }
      }
    }
  });
});
