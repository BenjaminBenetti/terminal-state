// Task office-seamless-20261029 (lane LIFT): the physically travelling elevator of the ONE continuous Office Space world.
// A synthetic 9-storey tower (station hall at 0, lobby 5.6, floors 2..8 at +4.4 each, one SOLID shaft through every tower
// storey) and a fake Game host stepping dt:
//  - ElevatorLogic: a call from floor 1 to 5 moves the cab continuously and monotonically within the speed / acceleration
//    limits and stops EXACTLY at stop.y; collective (SCAN) service order and on-the-way stops; door interlock (never moving
//    with the doors open, landing doors shut when the cab is away), obstruction re-open, an enemy inside holds the doors;
//  - Levels dynamic volume: support / collision / headroom / raycast / sight inside and outside the cab, through an open
//    vs a shut doorway; with no volume every query is unchanged (Subway);
//  - the runtime with the REAL Player body: walk in, press the panel's 5 button (aim + E; task office-overhaul-20261030: no
//    floor list), ride (carried by the cab's dy: never below its floor, never through its ceiling, y continuous), walk out on
//    floor 5 — and the host's travel / setState are NEVER called;
//  - riders: a pickup and a resting flare (real PickupManager / FlareSystem / PhysicsSystem) ride along;
//  - per-storey windows, the exterior built once at street level (hidden in the station), the warm-up discovers every mesh,
//    teardown leaves nothing, TSL builds on both backends, QA hooks.
import {beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {Levels, levelsOf, type DynamicVolume} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {WarmupRegistry, planWarmup, warmKeys} from '../src/render/warmup';
import {markShadows} from '../src/render/volumetric';
import {
  CAB_ACCEL, CAB_SPEED, DOOR_TIME, DWELL, GATE_OPEN, START_DELAY, ElevatorLogic, planElevator, planMotion, sampleMotion, type ElevatorSense,
} from '../src/world/elevator';
import {readTowerInfo} from '../src/world/towerShared';
import {planWindows} from '../src/world/officeWindows';
import {EXTERIOR} from '../src/world/exterior';
import {TowerRuntime, installTower, type TowerHost} from '../src/world/towerRuntime';
import {towerQaApi} from '../src/world/towerQa';
import {Player} from '../src/player/player';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {PhysicsSystem} from '../src/physics/world';
import {StaticQuery} from '../src/physics/staticQuery';
import {FlareSystem} from '../src/weapons/throwables';
import {LightSources} from '../src/world/lightSources';
import {buildBoth} from './helpers/tslShaders';
import {installGear} from '../src/gear/system';
import {WeaponController} from '../src/weapons/weapons';
import {BASE_MODIFIERS} from '../src/player/modifiers';
import {MemoryBagStore} from '../src/gear/bagStore';
import type {Game} from '../src/game';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => {
  mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  // the item label atlas clips its cells (the no-raster shim has no clip): a no-op is enough here
  const ctx = (document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx) as {clip?: () => void};
  proto.clip ??= () => {};
});

// ---------------------------------------------------------------------------------------------
// Fixture: 30 x 25 m, levels 0 (station hall, floor 0, ceil 4.4 — also under the tower) and 1..8 (lobby 5.6 + 4.4 n).
// Shaft cells x 19..25, y 19..24 (x 9.5..13, z 9.5..12.5) SOLID on every tower storey; cab interior x 10..12.5,
// z 10..12; door N (z = 10), 1.5 m wide at x 11.25 (doorway cells x 21..23, y 19: z 9.5..10, solid in the grids).

const W = 60, H = 50, FLOORS = [1, 2, 3, 4, 5, 6, 7, 8], LOBBY = 5.6, FH = 4.4;
const baseOf = (f: number) => (f === 0 ? 0 : LOBBY + FH * (f - 1));
const CAB = {x0: 10, z0: 10, x1: 12.5, z1: 12};
const SHAFT = {x0: 9.5, z0: 9.5, x1: 13, z1: 12.5};
const DOOR = {x: 11.25, z: 10, width: 1.5};
const LANDING = {x: 11.25, z: 8.6};

function towerLayout(): StationLayout {
  const levels = [0, ...FLOORS].map(L => {
    const g = new Grid(W, H);
    const base = baseOf(L), ceil = base + (L === 0 ? 4.4 : L === 1 ? 4.0 : 2.9);
    for (let y = 2; y <= 47; y++) for (let x = 2; x <= 57; x++) { g.set(x, y, FLOOR); const i = g.idx(x, y); g.floor[i] = base; g.ceil[i] = ceil; }
    if (L >= 1) for (let y = 19; y <= 24; y++) for (let x = 19; x <= 25; x++) g.set(x, y, SOLID);
    return {id: L, role: L === 0 ? 'main' : L === 1 ? 'upper' : 'office', grid: g, baseY: base};
  });
  const storeys = FLOORS.map(f => ({floor: f, levelId: f, baseY: baseOf(f), label: f === 1 ? 'L' : String(f), clear: f === 1 ? 4 : 2.9}));
  const windows = FLOORS.flatMap(f => [
    {x0: 3, x1: 9, z0: 0.5, z1: 1.0, side: 'N', sill: 0.85, head: 2.55, kind: 'window', level: f, baseY: baseOf(f)},
    {x0: 0.5, x1: 1.0, z0: 5, z1: 15, side: 'W', sill: 0.85, head: 2.55, kind: f === 1 ? 'entrance' : 'window', level: f, baseY: baseOf(f)},
  ]);
  const layout = {
    seed: 4242, grid: levels[0].grid, levels, levelLinks: [], rails: [], trench: {floorY: -1.15},
    lights: [], props: [], areas: [], doors: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    office: {
      version: 2, floors: FLOORS, floorHeight: FH, groundY: LOBBY, storeys,
      elevator: {
        cab: CAB, shaft: SHAFT, doorSide: 'N', door: DOOR, cabHeight: 2.6, panel: {x: 12.2, dy: 1.2, z: 10.02},
        stops: FLOORS.map(f => ({floor: f, levelId: f, y: baseOf(f), area: -1, callPanel: {x: 12.6, y: baseOf(f) + 1.2, z: 9.5}, landing: LANDING})),
      },
      stairs: {well: {x0: 15, z0: 9.5, x1: 18, z1: 14}, runs: [], landings: []},
      windows, exterior: {x0: 0.5, z0: 0.5, x1: 29.5, z1: 24.5}, start: {x: 5, z: 20, yaw: 0, level: 0}, name: 'Test Tower',
    },
  };
  return layout as unknown as StationLayout;
}

interface FakeZombie { brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled: boolean; root: {position: {y: number}} }

function makeHost(layout: StationLayout, player: {x: number; z: number; y: number; vx: number; vz: number; radius: number; alive: boolean; eye?: number} = {x: 5, z: 20, y: 0, vx: 0, vz: 0, radius: 0.3, alive: true}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  scene.add(camera);
  const toasts: string[] = [];
  const culler = {enabled: true, register: vi.fn()};
  const host = {
    scene, camera, player, zombies: [] as FakeZombie[], levels: levelsOf(layout as never), layout, mats, sfx: null,
    hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(),
    atmosphere: {markShadows: (root: THREE.Object3D, s: boolean) => { markShadows(root, true, s); }},
    interactHandlers: [] as (() => boolean)[], pointerHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[],
    stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', warming: false, prepareBeforeShow: async () => {},
    pickups: new PickupManager({}), world: {culler},
    // the iteration-16 section travel paths: must NEVER be used now
    travel: vi.fn(async () => ({ok: true})), setState: vi.fn(), fade: vi.fn(),
  };
  return {host, toasts, culler};
}

const aim = (host: {camera: THREE.PerspectiveCamera}, eye: [number, number, number], at: [number, number, number]) => {
  host.camera.position.set(...eye);
  host.camera.lookAt(new THREE.Vector3(...at));
  host.camera.updateMatrixWorld(true);
};
const DT = 1 / 30;
const stepHooks = (host: {frameHooks: ((dt: number) => void)[]}, seconds: number, dt = DT) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) for (const f of host.frameHooks) f(dt);
};
const keys = (...k: string[]) => ({down: (c: string) => k.includes(c), hit: () => false, clears: 0});
const SENSE0: ElevatorSense = {occupant: false, doorway: false, enemyInside: false};
const STOPS = FLOORS.map(f => ({floor: f, y: baseOf(f)}));

// ---------------------------------------------------------------------------------------------

describe('elevator logic: a physically travelling cab (pure)', () => {
  const run = (l: ElevatorLogic, s: number, sense: ElevatorSense = SENSE0, dt = 1 / 60, each?: () => void) => {
    const ev = [];
    for (let t = 0; t < s - 1e-9; t += dt) { ev.push(...l.update(dt, sense)); each?.(); }
    return ev;
  };

  it('motion profile: eases in / out within the limits and ends exactly at the target', () => {
    for (const [y0, y1] of [[5.6, 23.2], [36.4, 5.6], [5.6, 10], [10, 10.5]] as const) {
      const p = planMotion(y0, 0, y1);
      let prev: number = y0, pv = 0;
      const dt = 1 / 60;
      for (let t = dt; ; t += dt) {
        const s = sampleMotion(p, t);
        const v = (s.y - prev) / dt;
        expect(Math.abs(v)).toBeLessThanOrEqual(CAB_SPEED + 1e-6);
        expect(Math.abs(v - pv) / dt).toBeLessThanOrEqual(CAB_ACCEL + 1e-6);
        expect((s.y - prev) * Math.sign(y1 - y0)).toBeGreaterThanOrEqual(-1e-12); // monotonic
        prev = s.y; pv = v;
        if (s.done) { expect(s.y).toBe(y1); break; }
        expect(t).toBeLessThan(60);
      }
    }
  });

  it('a landing call on floor 5 brings the cab up from the lobby: continuous, monotonic, limited, exact stop; doors only at the stop', () => {
    const l = new ElevatorLogic(STOPS, {floor: 1});
    expect(l.y).toBe(baseOf(1));
    expect(l.call(5).map(e => e.type)).toEqual(['called']);
    const ys: number[] = [];
    let maxV = 0, maxA = 0, pv = 0;
    const ev = run(l, START_DELAY + 13 + DOOR_TIME + 0.4, SENSE0, 1 / 60, () => {
      ys.push(l.y);
      if (l.moving) { expect(l.door).toBe(0); expect(l.gateOpen).toBe(false); for (let i = 0; i < 8; i++) expect(l.landingDoor(i)).toBe(0); }
      if (ys.length > 1) {
        const v = (ys[ys.length - 1] - ys[ys.length - 2]) * 60;
        maxV = Math.max(maxV, Math.abs(v)); maxA = Math.max(maxA, Math.abs(v - pv) * 60); pv = v;
      }
    });
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-12);
    expect(maxV).toBeLessThanOrEqual(CAB_SPEED + 1e-6);
    expect(maxV).toBeGreaterThan(CAB_SPEED - 0.05); // it really cruised
    expect(maxA).toBeLessThanOrEqual(CAB_ACCEL + 1e-6);
    expect(l.y).toBe(baseOf(5));
    expect(l.stop).toBe(4);
    const types = ev.map(e => e.type);
    expect(types.slice(0, 2)).toEqual(['depart', 'arrive']);
    expect(types).toContain('chime');
    expect(types).toContain('opened');
    expect(l.landingDoor(4)).toBe(1);
    expect(l.landingDoor(0)).toBe(0);
    expect(l.trips).toBe(1);
  });

  it('collective service: requests ahead first (with on-the-way stops), then it turns round', () => {
    const l = new ElevatorLogic(STOPS, {floor: 1});
    l.select(7); l.call(3); l.call(5);
    const order: number[] = [];
    let t = 0;
    while (order.length < 3 && t < 120) { for (const e of l.update(1 / 30, {...SENSE0, occupant: true})) if (e.type === 'arrive') order.push(e.floor); t += 1 / 30; }
    expect(order).toEqual([3, 5, 7]);
    // a call below while still serving above is taken after the turn
    const m = new ElevatorLogic(STOPS, {floor: 4});
    m.select(8);
    run(m, 2.5, SENSE0, 1 / 30); // started up toward 8
    expect(m.moving).toBe(true);
    m.call(2);
    m.call(6); // ahead and still brakeable: taken on the way
    const seq: number[] = [];
    for (let i = 0; i < 4000 && seq.length < 3; i++) for (const e of m.update(1 / 30, SENSE0)) if (e.type === 'arrive') seq.push(e.floor);
    expect(seq).toEqual([6, 8, 2]);
  });

  it('door interlock: doors open only level at a stop; the cab moves only sealed; obstruction re-opens; enemies never ride', () => {
    const l = new ElevatorLogic(STOPS, {floor: 3, open: true});
    l.select(6);
    // doors start closing quickly after a floor was chosen inside; a body in the doorway re-opens them
    run(l, 0.7, SENSE0, 1 / 60);
    expect(l.state).toBe('closing');
    const ev = l.update(1 / 60, {...SENSE0, doorway: true});
    expect(ev).toEqual([{type: 'reopen', why: 'doorway'}]);
    expect(l.state).toBe('opening');
    // while the doorway stays occupied, the cab never leaves
    run(l, 10, {...SENSE0, doorway: true}, 1 / 60);
    expect(l.moving).toBe(false);
    expect(l.stop).toBe(2);
    // an enemy inside holds the doors open: no departure
    run(l, 10, {...SENSE0, enemyInside: true}, 1 / 60, () => expect(l.moving).toBe(false));
    expect(l.door).toBe(1);
    expect(l.trips).toBe(0);
    // clear: it closes, waits START_DELAY sealed, then rides
    let sealedSince = -1, t = 0;
    run(l, 20, SENSE0, 1 / 60, () => {
      t += 1 / 60;
      if (l.sealed && !l.moving && sealedSince < 0) sealedSince = t;
      if (l.moving) { expect(l.door).toBe(0); expect(l.sealed).toBe(true); }
    });
    expect(l.trips).toBe(1);
    expect(l.y).toBe(baseOf(6));
    expect(START_DELAY).toBeGreaterThan(0);
    expect(GATE_OPEN).toBeGreaterThan(0.5);
  });

  it('dwell, current-floor buttons, "open doors", never trapped (standing at the doors of an idle cab opens them)', () => {
    const l = new ElevatorLogic(STOPS, {floor: 2});
    expect(l.select(2).events.map(e => e.type)).toEqual(['opening']);
    run(l, DOOR_TIME + 0.05);
    expect(l.state).toBe('open');
    run(l, DWELL + DOOR_TIME + 0.2);
    expect(l.state).toBe('closed'); // auto-closed after the dwell
    // a hall call at the floor it stands at opens it (chime)
    expect(l.call(2).map(e => e.type)).toEqual(['chime', 'opening']);
    run(l, DOOR_TIME + DWELL + DOOR_TIME + 0.3);
    expect(l.state).toBe('closed');
    run(l, 0.5, {...SENSE0, occupant: true, pushOpen: true});
    expect(l.state).toBe('closed'); // a brush against the doors is not enough
    run(l, 0.3, {...SENSE0, occupant: true, pushOpen: true});
    expect(l.state).toBe('opening');
    expect(new ElevatorLogic(STOPS).select(9).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe('Levels dynamic volume (the cab as moving free space)', () => {
  const setup = () => {
    const layout = towerLayout();
    const L = levelsOf(layout as never);
    const vol: DynamicVolume = {...CAB, floorY: baseOf(3), ceilY: baseOf(3) + 2.6, level: 3, gates: [{side: 'N', a0: 10.5, a1: 12, depth: 0.5, height: 2.2, open: false}], stops: FLOORS.map(baseOf)};
    return {layout, L, vol};
  };

  it('support / collision / headroom inside the cab; the shaft stays solid elsewhere; the station band below is untouched', () => {
    const {L, vol} = setup();
    const y3 = baseOf(3);
    expect(L.supportIn(11.2, 11, y3)).toBeNull(); // shaft cells are solid on every storey grid
    L.addDynamicVolume(vol);
    const s = L.supportIn(11.2, 11, y3 + 0.01)!;
    expect(s.floor).toBe(y3);
    expect(s.level).toBe(3);
    expect(s.volume).toBe(vol);
    expect(L.levelAt(11.2, 11, y3)).toBe(3);
    expect(L.ceilAt(11.2, 11, y3)).toBeCloseTo(y3 + 2.6, 9);
    const [cx, cy] = [Math.floor(11.2 / CELL), Math.floor(11 / CELL)];
    expect(L.blocksAt(cx, cy, 11.2, 11, y3, 1.74)).toBe(false);
    expect(L.blocksAt(cx, cy, 11.2, 11, baseOf(5), 1.74)).toBe(true); // the shaft at floor 5 while the cab is at 3
    expect(L.ceilingOver(11.2, 11, 0.3, y3)).toBeCloseTo(y3 + 2.6, 9);
    expect(L.circleClear(11.25, 11, 0.3, y3)).toBe(true);
    expect(L.supportIn(11.2, 11, baseOf(5) + 0.01)).toBeNull();
    // the station hall band under the tower is not part of the shaft
    expect(L.supportIn(11.2, 11, 0.01)!.level).toBe(0);
    // the cab moves: the free space follows
    vol.floorY = 20.1; vol.ceilY = 22.7;
    expect(L.supportIn(11.2, 11, 20.11)!.floor).toBe(20.1);
    expect(L.supportIn(11.2, 11, y3 + 0.01)).toBeNull();
    // walls of the cab are the surrounding solid cells
    expect(L.blocksAt(Math.floor(9.7 / CELL), cy, 9.7, 11, 20.1, 1.74)).toBe(true);
  });

  it('the doorway: solid while shut (nobody walks / falls into the shaft), free only with the cab level there and the doors open', () => {
    const {L, vol} = setup();
    L.addDynamicVolume(vol);
    const gate = vol.gates[0], y3 = baseOf(3);
    const [dx, dy] = [Math.floor(11.25 / CELL), Math.floor(9.75 / CELL)];
    expect(L.blocksAt(dx, dy, 11.25, 9.75, y3, 1.74)).toBe(true);
    gate.open = true;
    expect(L.blocksAt(dx, dy, 11.25, 9.75, y3, 1.74)).toBe(false);
    expect(L.supportIn(11.25, 9.75, y3)!.floor).toBe(y3);
    expect(L.ceilAt(11.25, 9.75, y3)).toBeCloseTo(y3 + 2.2, 9);
    // another storey's doorway stays shut
    expect(L.blocksAt(dx, dy, 11.25, 9.75, baseOf(4), 1.74)).toBe(true);
    // the real movement path: walk from the landing into the cab through the open doorway, then the doors shut
    const P = new Player();
    P.spawn(11.25, 8.6, Math.PI, y3); // facing +z (the doors)
    for (let i = 0; i < 60; i++) P.update(DT, keys('KeyW'), L, null, {aiming: false, speedMult: 1, canSprint: true});
    expect(P.z).toBeGreaterThan(10.3);
    expect(P.y).toBeCloseTo(y3, 5);
    gate.open = false;
    for (let i = 0; i < 60; i++) P.update(DT, keys('KeyS', 'ShiftLeft'), L, null, {aiming: false, speedMult: 1, canSprint: true});
    expect(P.z).toBeGreaterThan(10 + 0.3 - 1e-6); // kept in by the shut doors
    // from the landing nobody gets in while it is shut (and the cab away: no void to fall into)
    const Q = new Player();
    Q.spawn(11.25, 8.6, Math.PI, baseOf(5));
    for (let i = 0; i < 60; i++) Q.update(DT, keys('KeyW', 'ShiftLeft'), L, null, {aiming: false, speedMult: 1, canSprint: true});
    expect(Q.z).toBeLessThanOrEqual(9.5 - 0.3 + 1e-6);
    expect(Q.y).toBeCloseTo(baseOf(5), 5);
  });

  it('raycast / line of sight: cab walls, floor and ceiling; through the doorway only while open', () => {
    const {L, vol, layout: setupLayout} = setup();
    L.addDynamicVolume(vol);
    const y3 = baseOf(3), eyeIn = {x: 11.25, y: y3 + 1.6, z: 11.2};
    const east = L.raycast(eyeIn, {x: 1, y: 0, z: 0}, 10);
    expect(east.kind).toBe('wall');
    expect(eyeIn.x + east.t).toBeCloseTo(CAB.x1, 6);
    const up = L.raycast(eyeIn, {x: 0, y: 1, z: 0}, 10);
    expect(up.kind).toBe('ceiling');
    expect(eyeIn.y + up.t).toBeCloseTo(y3 + 2.6, 6);
    const down = L.raycast(eyeIn, {x: 0, y: -1, z: 0}, 10);
    expect(down.kind).toBe('floor');
    expect(down.level).toBe(3);
    // landing -> cab: the shut landing doors stop rays and sight at the shaft face
    const eyeOut = {x: 11.25, y: y3 + 1.6, z: 8};
    const r = L.raycast(eyeOut, {x: 0, y: 0, z: 1}, 10);
    expect(r.kind).toBe('wall');
    expect(eyeOut.z + r.t).toBeCloseTo(SHAFT.z0, 6);
    expect(L.lineOfSight(eyeOut, eyeIn)).toBe(false);
    vol.gates[0].open = true;
    expect(L.lineOfSight(eyeOut, eyeIn)).toBe(true);
    const r2 = L.raycast(eyeOut, {x: 0, y: 0, z: 1}, 10);
    expect(eyeOut.z + r2.t).toBeCloseTo(CAB.z1, 6); // across the cab to its back wall
    // another storey never sees into the cab
    expect(L.lineOfSight({x: 11.25, y: baseOf(4) + 1.6, z: 8}, eyeIn)).toBe(false);
    // physics statics (casings, item ground clamp, flares) follow too
    const q = new StaticQuery(setupLayout as never);
    expect(q.cellGround(11.2, 11, y3 + 0.5)).toBe(y3);
    expect(q.insideSolid(11.2, y3 + 1, 11)).toBe(false);
    expect(q.insideSolid(11.2, baseOf(5) + 1, 11)).toBe(true);
  });

  it('no volume = no change (Subway): every query is identical before adding and after removing', () => {
    const {L, vol} = setup();
    const sample = () => {
      const out: unknown[] = [];
      for (let x = 0.3; x < 29.7; x += 1.37) for (let z = 0.3; z < 24.7; z += 1.13) for (const y of [0.01, 5.61, 14.41, 34.21]) {
        const s = L.supportIn(x, z, y);
        out.push(s ? [s.level, s.floor, s.ceil] : null, L.isFree(x, y + 0.5, z), L.blocksAt(Math.floor(x / CELL), Math.floor(z / CELL), x, z, y, 1.74));
        const h = L.raycast({x, y: y + 1.5, z}, {x: 0.6, y: -0.1, z: 0.79}, 12);
        out.push(h.kind, +h.t.toFixed(6));
      }
      return out;
    };
    const before = sample();
    L.addDynamicVolume(vol);
    L.removeDynamicVolume(vol);
    expect(L.dynamicVolumes).toHaveLength(0);
    expect(sample()).toEqual(before);
    // with the volume present, columns away from the shaft answer exactly as before
    L.addDynamicVolume(vol);
    const s = L.supportIn(3, 3, baseOf(3) + 0.01)!;
    expect(s.level).toBe(3);
    expect(s.floor).toBeCloseTo(baseOf(3), 5);
    expect(s.volume).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

describe('tower runtime with a fake Game host (ONE continuous world)', () => {
  it('installs into the registries; builds once: the cab volume, culler registration, far plane', () => {
    const layout = towerLayout();
    const {host, culler} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    expect(host.sectionHooks).toHaveLength(1);
    expect(host.frameHooks).toHaveLength(1);
    expect(host.interactHandlers).toHaveLength(1);
    expect(host.pointerHandlers).toHaveLength(1);
    expect(host.promptProviders).toHaveLength(1);
    expect(host.stateListeners).toHaveLength(1);
    expect(host.warmRegistry.names.pools).toContain('tower');
    host.sectionHooks[0].build!(layout);
    expect(host.levels.dynamicVolumes).toHaveLength(1);
    expect(rt.office!.elevator!.view.landings).toHaveLength(8);
    expect(culler.register).toHaveBeenCalledTimes(9); // 8 landings + the windows
    expect(host.camera.far).toBeGreaterThanOrEqual(EXTERIOR.far);
    expect(host.travel).not.toHaveBeenCalled();
  });

  it('call -> walk in -> press 5 -> RIDE (carried, continuous, never below the floor / through the ceiling) -> walk out on 5; no travel / state change ever', () => {
    const layout = towerLayout();
    const P = new Player();
    P.spawn(LANDING.x, LANDING.z, 0, baseOf(1)); // facing -z: turn toward the doors below
    const {host} = makeHost(layout, P);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.office!.elevator!, L = host.levels;
    // E on the lobby call panel (the cab waits there with the doors shut)
    const call = e.plan.calls[0].at;
    aim(host, [call.x, baseOf(1) + 1.62, 8.6], [call.x, call.y, call.z]);
    P.x = call.x;
    stepHooks(host, DT);
    expect(rt.target?.kind).toBe('call');
    expect(host.promptProviders[0]()).toMatch(/Call the elevator/);
    expect(host.interactHandlers[0]()).toBe(true);
    stepHooks(host, DOOR_TIME + 0.2);
    expect(e.logic.state).toBe('open');
    expect(e.gate.open).toBe(true);
    // walk in with the real movement path (yaw pi: facing +z)
    P.x = LANDING.x; P.yaw = Math.PI;
    const frame = (k: string[]) => { P.update(DT, keys(...k), L, null, {aiming: false, speedMult: 1, canSprint: true}); for (const f of host.frameHooks) f(DT); };
    for (let i = 0; i < 40 && !rt.playerInCab(); i++) frame(['KeyW']);
    for (let i = 0; i < 8; i++) frame(['KeyW']);
    expect(rt.playerInCab()).toBe(true);
    for (let i = 0; i < 10; i++) frame([]);
    // the cab panel: aim at its 5 button and press E (a physical button: no list)
    const b5 = e.plan.carButtons.find(b => b.floor === 5)!;
    host.camera.position.set(P.x, P.eye, P.z);
    host.camera.lookAt(b5.at.x, b5.at.y + e.logic.y, b5.at.z);
    host.camera.updateMatrixWorld(true);
    stepHooks(host, DT);
    expect(rt.target?.kind).toBe('panel');
    expect(rt.target?.btn.id).toBe('car-5');
    expect(host.promptProviders[0]()).toMatch(/Floor 5/);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(e.logic.car.has(4)).toBe(true);
    // ride: the world keeps running, the player stands still inside
    const ys: number[] = [];
    let moved = false;
    for (let i = 0; i < 30 * 30 && !(moved && !e.logic.moving && e.logic.state === 'open'); i++) {
      frame([]);
      const f = e.logic.y;
      ys.push(P.y);
      if (e.logic.moving) {
        moved = true;
        expect(e.gate.open).toBe(false);
        for (let k = 0; k < 8; k++) expect(e.logic.landingDoor(k)).toBe(0);
      }
      expect(P.y).toBeGreaterThanOrEqual(f - 1e-6); // never below the cab floor
      expect(P.y + 1.74).toBeLessThanOrEqual(f + e.plan.cabH + 1e-6); // never through its ceiling
      expect(Math.abs(P.y - f)).toBeLessThan(1e-6); // standing: exactly on the moving floor
      expect(host.state).toBe('playing');
    }
    expect(moved).toBe(true);
    expect(e.logic.y).toBe(baseOf(5));
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i] - ys[i - 1])).toBeLessThanOrEqual(CAB_SPEED * DT + 1e-6); // continuous
    expect(P.y).toBe(baseOf(5));
    expect(e.carried.player).toBe(true);
    // walk out onto floor 5's landing
    P.yaw = 0;
    for (let i = 0; i < 60; i++) frame(['KeyW']);
    expect(P.z).toBeLessThan(9.3);
    expect(L.levelAt(P.x, P.z, P.y)).toBe(5);
    expect(P.y).toBeCloseTo(baseOf(5), 5); // the storey grid's (float32) floor
    // the seamless invariant: nothing ever asked the host to travel / fade / change state
    expect(host.travel).not.toHaveBeenCalled();
    expect(host.setState).not.toHaveBeenCalled();
    expect(host.fade).not.toHaveBeenCalled();
    expect(host.levels).toBe(levelsOf(layout as never));
  });

  it('doorway obstruction re-opens; an enemy inside holds the doors (enemies never ride); landing doors stay shut where the cab is not', () => {
    const layout = towerLayout();
    const {host, toasts} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.office!.elevator!;
    rt.callFloor(1); // at the lobby already: opens
    stepHooks(host, DOOR_TIME + 0.2);
    expect(e.logic.state).toBe('open');
    rt.callFloor(6); // wanted upstairs
    host.player.x = 11.25; host.player.z = 9.75; host.player.y = baseOf(1); // standing in the doorway
    stepHooks(host, 12);
    expect(e.logic.moving).toBe(false);
    expect(e.logic.door).toBeGreaterThan(0.5);
    // an enemy inside (player away)
    host.player.x = 5; host.player.z = 20;
    const zb: FakeZombie = {brain: {x: 11.6, z: 11.4, y: baseOf(1), alive: true, stats: {radius: 0.33}}, ragdolled: false, root: {position: {y: baseOf(1)}}};
    host.zombies.push(zb);
    stepHooks(host, 15, DT);
    expect(e.logic.moving).toBe(false);
    expect(e.logic.trips).toBe(0);
    expect(toasts.some(t => /won.t close/.test(t))).toBe(true);
    // the enemy dies: the doors close and the cab leaves (the corpse rides; it is not "inside" any more for the rule)
    zb.brain.alive = false;
    let sawMoving = false;
    for (let i = 0; i < 30 * 40 && e.logic.stop !== 5; i++) {
      for (const f of host.frameHooks) f(DT);
      if (e.logic.moving) { sawMoving = true; for (let k = 0; k < 8; k++) expect(e.logic.landingDoor(k)).toBe(0); }
    }
    expect(sawMoving).toBe(true);
    expect(e.logic.y).toBe(baseOf(6));
    expect(zb.brain.y).toBeCloseTo(baseOf(6), 6); // carried
    expect(zb.root.position.y).toBeCloseTo(baseOf(6), 6);
    expect(e.logic.landingDoor(0)).toBe(0);
  });

  it('riders: a resting pickup and a resting flare ride along (real PickupManager / FlareSystem / PhysicsSystem)', () => {
    const layout = towerLayout();
    const P = new Player();
    P.spawn(11.6, 11.5, 0, baseOf(1));
    const {host} = makeHost(layout, P);
    const physics = new PhysicsSystem(null);
    physics.build(layout as never);
    const flares = new FlareSystem(new THREE.Group(), physics, new LightSources());
    Object.assign(host, {physics, flares});
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.office!.elevator!, L = host.levels;
    const inv = new Inventory();
    const pk = host.pickups.add(inv.makeStack('water', 1), 10.5, baseOf(1), 11.6);
    const outside = host.pickups.add(inv.makeStack('cola', 1), 5, baseOf(1), 20);
    // a flare tossed onto the cab floor (doors shut): it bounces and settles on the cab's kinematic floor
    expect(flares.throw({x: 11.0, y: baseOf(1) + 1.5, z: 10.9}, {x: 0.05, y: -1, z: 0.05}).ok).toBe(true);
    const fl = flares.flares[0];
    const frame = () => { P.update(DT, keys(), L, null, {aiming: false, speedMult: 1, canSprint: true}); for (const f of host.frameHooks) f(DT); physics.update(DT); flares.tick(DT); };
    for (let i = 0; i < 30 * 12 && fl.body; i++) frame();
    expect(fl.body).toBeNull();
    expect(fl.pos.x > CAB.x0 && fl.pos.x < CAB.x1 && fl.pos.z > CAB.z0 && fl.pos.z < CAB.z1).toBe(true);
    expect(fl.pos.y).toBeGreaterThan(baseOf(1) - 0.01);
    expect(fl.pos.y).toBeLessThan(baseOf(1) + 0.1);
    expect(physics.cabBodies()[0]).toEqual({floor: baseOf(1), fillersIn: 8, fillers: 8});
    const flareAbove = fl.pos.y - baseOf(1);
    // ride 1 -> 4 from inside
    expect(rt.panelPick(4)).toBe(true);
    for (let i = 0; i < 30 * 30 && e.logic.stop !== 3; i++) frame();
    expect(e.logic.y).toBe(baseOf(4));
    expect(pk.y).toBeCloseTo(baseOf(4), 6);
    expect(pk.obj.position.y).toBeCloseTo(baseOf(4), 6);
    expect(outside.y).toBe(baseOf(1)); // nothing outside the cab moved
    expect(fl.pos.y - baseOf(4)).toBeCloseTo(flareAbove, 3);
    expect(flares.flares[0].model.root.position.y).toBeGreaterThan(baseOf(4) - 0.05);
    expect(P.y).toBe(baseOf(4));
    // the cab's physics floor and the doorway fillers follow (open doors at floor 4: that filler leaves)
    for (let i = 0; i < 60; i++) frame();
    expect(physics.cabBodies()[0].floor).toBe(baseOf(4));
    expect(e.gate.open).toBe(true);
    expect(physics.cabBodies()[0].fillersIn).toBe(7);
    expect(host.travel).not.toHaveBeenCalled();
  });

  // Regression (primary, full suite): with a station hall open UNDER the shaft, a flare rolling into a cab corner left the
  // cab footprint and fell through the shaft wall to the station floor — the cannon statics had no wall above that column's
  // top band. Seeded (deterministic rng): flares, a shot loose item and a flesh chunk, in a stationary and a moving cab.
  const lcg = (seed: number) => { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };
  function cabScenario(seed: number, moving: boolean) {
    const layout = towerLayout();
    const P = new Player();
    P.spawn(5, 20, 0, 0); // in the station, out of the way
    const {host} = makeHost(layout, P);
    const physics = new PhysicsSystem(null);
    physics.build(layout as never);
    const rng = lcg(seed);
    const flares = new FlareSystem(new THREE.Group(), physics, new LightSources(), rng);
    Object.assign(host, {physics, flares});
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.office!.elevator!, L = host.levels;
    const frame = () => { P.update(DT, keys(), L, null, {aiming: false, speedMult: 1, canSprint: true}); for (const f of host.frameHooks) f(DT); physics.update(DT); flares.tick(DT); };
    if (moving) rt.callFloor(3); // the empty cab rides up to floor 3 (8.8 m: accelerate, cruise, brake)
    const tThrow = moving ? Math.round((1.2 + rng() * 6) / DT) : 1;
    let pk: ReturnType<typeof host.pickups.add> | null = null;
    let lowest = Infinity;
    // flares (where the tube lies: its centre x / z, its head's height), the item's lowest point (its pickup anchor sits 8 cm
    // under the body centre), chunk centres
    const itemBox = new THREE.Box3();
    const objects = () => [...flares.flares.map(f => ({x: f.model.root.position.x, y: f.pos.y, z: f.model.root.position.z})),
      ...(pk ? [(() => { itemBox.setFromObject(pk.obj); const c = itemBox.getCenter(new THREE.Vector3()); return {x: c.x, y: itemBox.min.y + 0.01, z: c.z}; })()] : []),
      ...physics.chunks.listFlesh().map(c => ({x: c.x, y: c.y, z: c.z}))];
    for (let i = 0; i < 30 * 26; i++) {
      if (i === tThrow) {
        const y = e.logic.y;
        // the reported throw (straight down into the cab; first use of the rng, exactly as the primary's repro) and a seeded
        // one at the walls / corners
        expect(flares.throw({x: 11.0, y: y + 1.5, z: 10.9}, {x: 0.05, y: -1, z: 0.05}).ok).toBe(true);
        const cx = 10.4 + rng() * 1.7, cz = 10.4 + rng() * 1.2;
        const d = new THREE.Vector3(rng() - 0.5, -0.4 - rng() * 0.6, rng() - 0.5).normalize();
        flares.cooldown = 0;
        expect(flares.throw({x: cx, y: y + 1.4, z: cz}, d).ok).toBe(true);
        // a loose item on the cab floor, shot across it
        pk = host.pickups.add(new Inventory().makeStack('cola', 1), 10.6 + rng() * 1.3, y, 10.5 + rng() * 1.0);
        const sd = new THREE.Vector3(rng() - 0.5, rng() * 0.3, rng() - 0.5).normalize();
        physics.dynamicItems.shootPickup(pk as never, new THREE.Vector3(pk.x, y + 0.06, pk.z), sd, 2 + rng() * 5);
        // a flesh chunk flung at the walls
        physics.chunks.spawnFlesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), new THREE.MeshStandardMaterial(), new THREE.Vector3(11.25, y + 1.2, 11), new THREE.Quaternion(),
          new THREE.Vector3(0.05, 0.03, 0.04), {vel: new THREE.Vector3((rng() - 0.5) * 8, (rng() - 0.5) * 6, (rng() - 0.5) * 8), spin: new THREE.Vector3(rng() * 9, rng() * 9, rng() * 9), mat: 'flesh', density: 1000}, 60);
      }
      frame();
      if (i > tThrow) for (const o of objects()) lowest = Math.min(lowest, o.y - e.logic.y);
      const settled = i > tThrow && flares.flares.every(f => !f.body) && physics.dynamicItems.awake === 0 && physics.chunks.awake === 0;
      if (settled && !e.logic.moving && (!moving || e.logic.stop === 2)) break;
    }
    return {e, objects: objects(), lowest, physics, flares};
  }

  /** In the cab on its floor — or (doors open at its stop) rolled out over the threshold onto that storey's floor; never in the shaft. */
  const expectSafe = (o: {x: number; y: number; z: number}, e: ReturnType<typeof cabScenario>['e'], seed: number) => {
    const y = e.logic.y, inCabXZ = o.x > CAB.x0 - 0.02 && o.x < CAB.x1 + 0.02 && o.z > CAB.z0 - 0.02 && o.z < CAB.z1 + 0.02;
    if (inCabXZ) {
      expect(o.y, `seed ${seed} on the cab floor (${o.y.toFixed(3)} vs ${y})`).toBeGreaterThan(y - 0.02);
      expect(o.y, `seed ${seed} under the cab ceiling`).toBeLessThan(y + 2.6);
      return;
    }
    expect(e.gate.open, `seed ${seed} out of the cab (${o.x.toFixed(3)}, ${o.z.toFixed(3)}) only through open doors`).toBe(true);
    expect(o.z, `seed ${seed} out on the door side`).toBeLessThan(CAB.z0 + 0.02);
    expect(Math.abs(o.x - DOOR.x) < DOOR.width / 2 + 0.05 || o.z < SHAFT.z0, `seed ${seed} through the doorway, not the shaft wall`).toBe(true);
    expect(o.y, `seed ${seed} on the landing floor`).toBeGreaterThan(y - 0.02);
    expect(o.y, `seed ${seed} at that storey`).toBeLessThan(y + 2.2);
  };

  it('seeded regression: nothing thrown / shot / flung inside a STATIONARY cab ends below its floor or in the shaft (40 seeds)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const {e, objects, lowest} = cabScenario(seed, false);
      const y = e.logic.y;
      expect(objects.length, `seed ${seed}`).toBe(4);
      for (const o of objects) {
        expect(o.x > CAB.x0 - 0.02 && o.x < CAB.x1 + 0.02 && o.z > CAB.z0 - 0.02 && o.z < CAB.z1 + 0.02, `seed ${seed} in the cab: ${o.x.toFixed(3)}, ${o.z.toFixed(3)}`).toBe(true);
        expect(o.y, `seed ${seed} on the cab floor`).toBeGreaterThan(y - 0.02);
        expect(o.y, `seed ${seed} under the cab ceiling`).toBeLessThan(y + 2.6);
      }
      // (an end-first 9 m/s impact dents the contact a few cm for a step: never anywhere near through the 0.5 m slab)
      expect(lowest, `seed ${seed} never sank`).toBeGreaterThan(-0.15);
    }
  });

  it('seeded regression: the same in a MOVING cab (thrown while it accelerates / cruises / brakes; 40 seeds)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const {e, objects, lowest, physics} = cabScenario(seed, true);
      expect(e.logic.stop, `seed ${seed} arrived`).toBe(2);
      const y = e.logic.y;
      expect(y).toBe(baseOf(3));
      expect(objects.length, `seed ${seed}`).toBe(4);
      for (const o of objects) expectSafe(o, e, seed);
      expect(lowest, `seed ${seed} never sank below the moving floor`).toBeGreaterThan(-0.15);
      expect(physics.cabBodies()[0].floor).toBe(y);
    }
  }, 120000);

  it('QA hooks: tower() state, towerCall / towerPick / towerGoLanding / towerGoCab drive the real logic', () => {
    const layout = towerLayout();
    const P = new Player();
    const {host} = makeHost(layout, P);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const qa = towerQaApi({tower: rt, player: P, levels: host.levels, camera: host.camera});
    expect(qa.towerGoLanding(3)).toBe(true);
    expect(P.y).toBe(baseOf(3));
    expect(host.levels.levelAt(P.x, P.z, P.y)).toBe(3);
    expect(qa.towerPick(5)).toBe(false); // not in the cab
    expect(qa.towerCall(3)).toBe(true);
    let s = qa.tower() as {cab: {queue: number[]; phase: string}};
    expect(s.cab.queue).toEqual([3]);
    stepHooks(host, 1.2);
    s = qa.tower() as {cab: {queue: number[]; phase: string}};
    expect(s.cab.phase).toBe('moving');
    stepHooks(host, 10.5);
    const t = qa.tower() as {cab: {y: number; stop: number; doors: number}; player: {inCab: boolean}; landingDoors: Record<number, number>};
    expect(t.cab.stop).toBe(3);
    expect(t.cab.y).toBeCloseTo(baseOf(3), 6);
    expect(t.landingDoors[3]).toBeGreaterThan(0.5);
    expect(t.landingDoors[1]).toBe(0);
    expect(qa.towerGoCab()).toBe(true);
    expect(rt.playerInCab()).toBe(true);
    expect(qa.towerPick(8)).toBe(true);
    expect((qa.tower() as {cab: {queue: number[]}}).cab.queue).toEqual([8]);
  });

  it('the culler: while the eye is inside the cab its storey is current (override, else culling off), restored outside', () => {
    const layout = towerLayout();
    const P = new Player();
    const {host, culler} = makeHost(layout, P);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    aim(host, [11.25, baseOf(1) + 1.6, 11.2], [11.25, baseOf(1) + 1.6, 9]);
    stepHooks(host, DT);
    expect(culler.enabled).toBe(false);
    aim(host, [5, 1.6, 20], [5, 1.6, 10]);
    stepHooks(host, DT);
    expect(culler.enabled).toBe(true);
    const c2 = {eyeOverride: null as number | null, register: () => {}};
    (host.world as {culler: unknown}).culler = c2;
    aim(host, [11.25, baseOf(1) + 1.6, 11.2], [11.25, baseOf(1) + 1.6, 9]);
    stepHooks(host, DT);
    expect(c2.eyeOverride).toBe(1);
    expect(rt).toBeInstanceOf(TowerRuntime);
    // ENGINE (task office-seamless-20261029): LevelCuller has a public eyeOverride, so the runtime never patches a culler's
    // private grid resolver; a culler without the override only switches culling off while the eye is in the cab.
    host.sectionHooks[0].teardown!();
    const c3 = {enabled: true, register: () => {}, levelAt: (_x: number, _y: number, _z: number) => 0};
    const orig = c3.levelAt;
    (host.world as {culler: unknown}).culler = c3;
    host.sectionHooks[0].build!(layout);
    expect(c3.levelAt).toBe(orig);
    aim(host, [11.25, baseOf(1) + 1.6, 11.2], [11.25, baseOf(1) + 1.6, 9]);
    stepHooks(host, DT);
    expect(c3.enabled).toBe(false);
    host.sectionHooks[0].teardown!();
    expect(c3.enabled).toBe(true);
    expect(c3.levelAt).toBe(orig);
  });

  it('the doorway (the solid door-wall strip between the cab and landing planes) carries the cab storey', () => {
    // task office-elevator-visibility-20261104-063115 (user: "if you stand right in the door way, the level disappears")
    const layout = towerLayout();
    const P = new Player();
    const {host} = makeHost(layout, P);
    installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const c2 = {eyeOverride: null as number | null, register: () => {}};
    (host.world as {culler: unknown}).culler = c2;
    const at = (x: number, z: number, f = 1) => { aim(host, [x, baseOf(f) + 1.6, z], [x, baseOf(f) + 1.6, z - 2]); stepHooks(host, DT); return c2.eyeOverride; };
    // lobby -> threshold -> cab -> threshold -> lobby (cab plane z 10, landing plane z 9.5)
    expect(at(11.25, 8.5)).toBe(null);
    expect(at(11.25, 9.4)).toBe(1); // just outside the landing plane (within the 0.16 m pad)
    expect(at(11.25, 9.75)).toBe(1); // on the threshold
    expect(at(10.6, 9.6)).toBe(1); // near a jamb, still inside the opening
    expect(at(11.25, 10.05)).toBe(1); // cab plane
    expect(at(11.25, 11.2)).toBe(1); // cab
    expect(at(11.25, 9.75)).toBe(1);
    expect(at(11.25, 9.2)).toBe(null); // a step into the lobby: the grid resolver again
    expect(at(12.3, 9.75)).toBe(null); // beside the opening (the shaft wall, not the doorway)
    // the doorway of a storey the cab is not at (the cab parks at 1): no override, that storey's own resolver
    expect(at(11.25, 9.75, 3)).toBe(null);
    host.sectionHooks[0].teardown!();
  });
});

// ---------------------------------------------------------------------------------------------

describe('windows of every storey, the exterior once at street level', () => {
  it('every span of every storey is planned at its own height; colliders per storey; meshes tagged per storey', () => {
    const layout = towerLayout();
    const info = readTowerInfo(layout)!;
    const plans = planWindows(info);
    expect(plans).toHaveLength(16);
    for (const p of plans) {
      expect(p.y0).toBeCloseTo(p.baseY + p.span.sill, 6);
      expect(p.y1).toBeCloseTo(p.baseY + p.span.head, 6);
      expect(p.baseY).toBe(baseOf(p.level));
      if (p.span.kind === 'entrance') expect(p.panes.every(q => q.state === 'boarded')).toBe(true);
      const c = p.collider;
      expect(Math.min(c.x1 - c.x0, c.z1 - c.z0)).toBeGreaterThanOrEqual(0.35 - 1e-9);
    }
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const levels = new Set<number>();
    rt.office!.windows!.view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) levels.add(o.userData.level); });
    expect([...levels].sort((a, b) => a - b)).toEqual(FLOORS);
    // a body on floor 6 pushing into its window is put back inside; floor 2's windows never touch it
    host.player.x = 6; host.player.z = 1.1; host.player.y = baseOf(6);
    stepHooks(host, DT);
    expect(host.player.z).toBeGreaterThan(1.25);
  });

  it('the city is built once with its ground at the lobby floor (real height from floor 8); hidden down in the station', () => {
    const layout = towerLayout();
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const ex = rt.office!.exterior!;
    expect(ex.plan.groundY).toBe(LOBBY);
    let exteriors = 0;
    host.scene.traverse(o => { if (o.name === 'tower-exterior') exteriors++; });
    expect(exteriors).toBe(1);
    const ground = ex.view.root.getObjectByName('tower-ext-ground') as THREE.Mesh;
    expect(ground.geometry.attributes.position.getY(0)).toBeCloseTo(LOBBY, 6);
    // floor 8, looking out of its north window
    aim(host, [6, baseOf(8) + 1.6, 2.5], [6, baseOf(8) + 1.4, -5]);
    stepHooks(host, 0.2);
    expect(ex.view.root.visible).toBe(true);
    // the station below the street: never
    aim(host, [6, 1.6, 2.5], [6, 1.4, -5]);
    stepHooks(host, 0.2);
    expect(ex.view.root.visible).toBe(false);
  });
});

describe('lifecycle, warm-up discovery, shaders', () => {
  it('the warm-up plan discovers every mesh (cab, landing doors of every stop, hidden lit buttons / lanterns / hover rings, glass, exterior)', () => {
    const layout = towerLayout();
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const plan = planWarmup(host.scene, {mode: 'full', cameraMask: host.camera.layers.mask, pools: host.warmRegistry.poolRoots()});
    const planned = new Set(plan.items.flatMap(i => warmKeys(i.object as THREE.Mesh)));
    const names = new Set<string>();
    rt.office!.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      names.add(m.name);
      for (const k of warmKeys(m)) expect(planned.has(k), `${m.name} ${k}`).toBe(true);
    });
    for (const n of ['tower-cab-walls', 'tower-cab-wood', 'tower-cab-mirror', 'tower-cab-floor', 'tower-cab-handrail', 'tower-cab-light', 'tower-cab-light-flicker', 'tower-door-cab-l',
      'tower-door-landing-r', 'tower-landing-frame', 'tower-landing-buttons', 'tower-indicator-in', 'tower-indicator-out', 'tower-call-button-lit-up', 'tower-call-button-lit-down',
      'tower-lantern-lit-up', 'tower-floor-button-lit-5', 'tower-button-lit-open', 'tower-button-hover-car', 'tower-button-hover-hall', 'tower-floor-panel-buttons',
      'tower-window-glass', 'tower-window-frames', 'tower-ext-ground', 'tower-ext-sky']) expect(names.has(n), n).toBe(true);
  });

  it('teardown: the volume leaves Levels, nothing is left in the scene, geometries released, far plane restored', () => {
    const layout = towerLayout();
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    const before = host.scene.children.length;
    host.sectionHooks[0].build!(layout);
    const geos: THREE.BufferGeometry[] = [];
    rt.office!.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) geos.push(m.geometry); });
    const spies = [...new Set(geos)].map(g => vi.spyOn(g, 'dispose'));
    host.sectionHooks[0].teardown!();
    expect(host.levels.dynamicVolumes).toHaveLength(0);
    expect(host.scene.children.length).toBe(before);
    expect(host.camera.far).toBe(70);
    expect(rt.office).toBeNull();
    expect(spies.every(s => s.mock.calls.length > 0)).toBe(true);
    // the Subway: nothing built
    host.sectionHooks[0].build!({...towerLayout(), office: undefined} as unknown as StationLayout);
    expect(rt.office).toBeNull();
  });

  it('every distinct tower material builds cleanly on WGSL + GLSL', () => {
    const layout = towerLayout();
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const seen = new Map<THREE.Material, THREE.Mesh>();
    rt.office!.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (!seen.has(mat)) seen.set(mat, m);
    });
    expect(seen.size).toBeGreaterThan(10);
    for (const [mat, mesh] of seen) {
      if (!/^tower-(cab|door|button|indicator|call|floor)/.test(mat.name) && !/^tower-ext-sky$/.test(mat.name)) continue;
      for (const b of buildBoth(mesh, {material: mat})) {
        expect(b.errors, `${mat.name} on ${mesh.name} (${b.backend})`).toEqual([]);
        expect(b.fragment.length, `${mat.name} ${b.backend}`).toBeGreaterThan(100);
      }
    }
  });
});

describe('backpack: never set down in the cab (the moving cab volume; the v2 shaft on any storey)', () => {
  it('refused inside the cab at a stop and between floors; allowed on the landing outside', () => {
    const layout = towerLayout();
    const levels = levelsOf(layout as never);
    const vol: DynamicVolume = {...CAB, floorY: baseOf(4), ceilY: baseOf(4) + 2.6, level: 4, gates: [{side: 'N', a0: 10.5, a1: 12, depth: 0.5, height: 2.2, open: true}], stops: FLOORS.map(baseOf)};
    levels.addDynamicVolume(vol);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
    camera.rotation.order = 'YXZ';
    const player = {x: 11.25, y: baseOf(4), z: 11.4, yaw: Math.PI, pitch: -0.5, climbing: false, grounded: true, alive: true, eye: 1.6};
    const g = {
      scene: new THREE.Scene(), modifierSources: [], frameHooks: [], interactHandlers: [], hitListeners: [], sectionHooks: [], stateListeners: [], promptProviders: [], inputOwners: [],
      warmRegistry: {addPool: () => {}}, invUI: {gear: null},
      input: {onLockChange: () => {}, clears: 0, pressed: new Set<string>(), mouse: [false, false, false], mousePressed: [false, false, false], wheel: 0, locked: true, hit: () => false, unlock() {}, lock: () => Promise.resolve(true)},
      inv: new Inventory(), weapon: new WeaponController(), mods: {...BASE_MODIFIERS}, player, consumeView: {busy: false}, viewmodel: {setItem: () => {}},
      sfx: {equip() {}, denied() {}, pickup() {}, search() {}}, hud: {toast: () => {}}, flareHold: {active: false, cancel: () => false}, syncHeld() {},
      camera, levels, layout, pickups: new PickupManager({}), qa: true, state: 'playing',
    };
    const sys = installGear(g as unknown as Game);
    sys.setStore(new MemoryBagStore());
    const view = () => { camera.position.set(player.x, player.y + player.eye, player.z); camera.rotation.set(player.pitch, player.yaw, 0); camera.updateMatrixWorld(true); };
    view();
    expect(sys.placeSpot()).toMatch(/elevator/);
    // between floors (riding)
    vol.floorY = 20.3; vol.ceilY = 22.9; vol.gates[0].open = false; player.y = 20.3;
    view();
    expect(sys.placeSpot()).toMatch(/elevator/);
    // on floor 4's landing, facing away from the shaft: fine
    Object.assign(player, {x: 11.25, z: 8.2, y: baseOf(4), yaw: 0});
    view();
    expect(typeof sys.placeSpot()).toBe('object');
    // facing the shut doors from the landing: never into the doorway / shaft
    player.yaw = Math.PI; player.z = 9.0;
    view();
    expect(typeof sys.placeSpot()).toBe('string');
  });
});

describe('plan from the contract', () => {
  it('gate from the cab edge to the shaft face; panels beside the opening facing their rooms', () => {
    const info = readTowerInfo(towerLayout())!;
    expect(info.elevator!.stops.map(s => s.y)).toEqual(FLOORS.map(baseOf));
    const plan = planElevator(info.elevator!);
    expect(plan.gate.depth).toBeCloseTo(0.5, 6);
    expect(plan.gate.hw).toBeCloseTo(0.75, 6);
    expect([plan.gate.nx, plan.gate.nz]).toEqual([0, -1]);
    expect(plan.panelN).toEqual([0, 1]);
    expect(plan.calls[0].n).toEqual([0, -1]);
    expect(plan.calls[4].at.y).toBeCloseTo(baseOf(5) + 1.2, 6);
    expect(Math.abs(plan.calls[0].at.x - plan.gate.cx)).toBeGreaterThan(plan.gate.hw);
    expect(plan.passage).toEqual({x0: 10.5, z0: 9.5, x1: 12, z1: 10});
    expect(new Levels(towerLayout().levels!).count).toBe(9);
  });
});
