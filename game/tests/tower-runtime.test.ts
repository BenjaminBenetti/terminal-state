// Iteration 16 (lane TOWER): the office tower runtime — elevator state machine (call, open, close with the passenger,
// exactly one ride request, arrival opens, doorway obstruction re-opens, enemies never ride, never trapped), door
// collision (no tunnelling at sprint speed), stairwell door travel requests (2-choice list, refusal), window collision
// boxes over every span (a broken pane is no way out), exterior ground offset per floor and scenery placement, build /
// teardown leaves nothing behind (deferred InstancedMesh release, camera far restored), and the warm-up discovers the
// cab / doors / glass / exterior (render/warmup.ts planWarmup, including a hidden exterior through the 'tower' pool).
// No GPU / browser: a fake Game host and a hand-made one-storey office floor grid.
import {beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {FLOOR, Grid} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {WarmupRegistry, planWarmup, warmKeys} from '../src/render/warmup';
import {markShadows} from '../src/render/volumetric';
import type {TravelRequest} from '../src/levels/types';
import {ARRIVE_CHIME, ARRIVE_OPEN, CALL_DELAY, DEPART_DELAY, DOOR_TIME, ElevatorLogic, planElevator, type ElevatorEvent} from '../src/world/elevator';
import {constrainGate, gateSideOf, pushOutRect, readTowerInfo, sectionForFloor, floorOfSection, type GateSide} from '../src/world/towerShared';
import {planStairDoors} from '../src/world/stairDoors';
import {planWindows} from '../src/world/officeWindows';
import {EXTERIOR, buildExterior, planExterior} from '../src/world/exterior';
import {TowerRuntime, installTower, type TowerHost} from '../src/world/towerRuntime';
import {ChoiceModel} from '../src/ui/elevatorPanel';
import {buildBoth} from './helpers/tslShaders';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

// ---------------------------------------------------------------------------------------------
// Fixture: a 30 x 25 m office floor (cells 0.5 m). Perimeter wall ring (solid) with window spans; an elevator shaft
// (cab x 10..12.5, z 10..12, door N, 1.5 m opening through a 0.5 m wall); a stairwell block with its door on the N face.

const W = 60, H = 50;
const CAB = {x0: 10, z0: 10, x1: 12.5, z1: 12};
function officeLayout(o: {floor?: number; baseY?: number; arrival?: string; noStairs?: boolean} = {}): StationLayout {
  const g = new Grid(W, H);
  const open = (x0: number, y0: number, x1: number, y1: number, ceil: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { g.set(x, y, FLOOR); g.ceil[g.idx(x, y)] = ceil; }
  };
  const solid = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.set(x, y, 0); };
  open(2, 2, 57, 47, 2.9);
  solid(19, 19, 25, 24); // shaft
  open(20, 20, 24, 23, 2.6); // cab
  open(21, 19, 23, 19, 2.2); // door opening through the shaft wall (lintel 2.2)
  solid(30, 20, 35, 24); // stairwell block (its N face at z = 10)
  const floor = o.floor ?? 3;
  const layout = {
    seed: 4242 + floor, grid: g, levels: [{id: 0, role: 'main', grid: g, baseY: 0}], levelLinks: [], rails: [],
    lights: [], props: [], areas: [], doors: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    office: {
      floor, floors: [1, 2, 3, 4, 5, 6, 7, 8], floorHeight: 4.4, levelId: 0, baseY: o.baseY ?? 0,
      elevator: {cab: CAB, doorSide: 'N', door: {x: 11.25, z: 10, width: 1.5}, panel: {x: 12.2, y: 1.2, z: 10.02}, callPanel: {x: 12.3, y: 1.2, z: 9.48}, floorY: 0},
      stairDoors: o.noStairs ? [] : [{dir: 'up', x: 16.5, z: 9.98, yaw: Math.PI, toFloor: floor + 1}, {dir: 'down', x: 16.5, z: 9.98, yaw: Math.PI, toFloor: floor - 1}],
      windows: [
        {x0: 3, x1: 10.5, z0: 0.5, z1: 1.0, side: 'N', sill: 0.85, head: 2.55, kind: 'window'},
        {x0: 0.5, x1: 1.0, z0: 5, z1: 15, side: 'W', sill: 0.85, head: 2.55, kind: 'window'},
        {x0: 5, x1: 20, z0: 24, z1: 24.5, side: 'S', sill: 0, head: 2.6, kind: 'entrance'},
      ],
      exterior: {x0: 0.5, z0: 0.5, x1: 29.5, z1: 24.5},
      arrivals: {elevator: {x: 11.25, z: 11, yaw: 0, level: 0}},
    },
  };
  return layout as unknown as StationLayout;
}

interface FakeZombie { brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled: boolean }

function makeHost(layout: StationLayout, travel?: (req: TravelRequest) => Promise<{ok: boolean; reason?: string}>) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  scene.add(camera);
  const toasts: string[] = [];
  const calls: TravelRequest[] = [];
  const host = {
    scene, camera, player: {x: 11.25, z: 8.6, y: 0, vx: 0, vz: 0, radius: 0.3, alive: true},
    zombies: [] as FakeZombie[], levels: levelsOf(layout as never), layout, mats, sfx: null,
    hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(),
    atmosphere: {markShadows: (root: THREE.Object3D, s: boolean) => { markShadows(root, true, s); }},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[],
    stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    travel: async (req: TravelRequest) => { calls.push(req); return travel ? travel(req) : {ok: true}; },
    arrival: {kind: 'start'} as {kind: 'start' | 'elevator' | 'stairs-up' | 'stairs-down'; floor?: number},
    state: 'playing', warming: false,
    prepareBeforeShow: async () => {},
  };
  return {host, toasts, calls};
}

const aim = (host: {camera: THREE.PerspectiveCamera}, eye: [number, number, number], at: [number, number, number]) => {
  host.camera.position.set(...eye);
  host.camera.lookAt(new THREE.Vector3(...at));
  host.camera.updateMatrixWorld(true);
};
const step = (host: {frameHooks: ((dt: number) => void)[]}, seconds: number, dt = 1 / 30) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) for (const f of host.frameHooks) f(dt);
};
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

// ---------------------------------------------------------------------------------------------

describe('elevator state machine (pure)', () => {
  const run = (l: ElevatorLogic, s: number, sense = {occupant: false, doorway: false, enemyInside: false}, dt = 1 / 60): ElevatorEvent[] => {
    const ev: ElevatorEvent[] = [];
    for (let t = 0; t < s - 1e-9; t += dt) ev.push(...l.update(dt, sense));
    return ev;
  };

  it('call: the cab arrives (chime) and the doors open; an empty cab closes again by itself', () => {
    const l = new ElevatorLogic(3, [1, 2, 3, 4]);
    expect(l.state).toBe('closed');
    l.call();
    let ev = run(l, CALL_DELAY + 0.05);
    expect(ev.map(e => e.type)).toEqual(['chime', 'opening']);
    ev = run(l, DOOR_TIME + 0.05);
    expect(ev.map(e => e.type)).toContain('opened');
    expect(l.door).toBe(1);
    ev = run(l, 7);
    expect(ev.map(e => e.type)).toContain('closing');
    run(l, DOOR_TIME + 0.1);
    expect(l.state).toBe('closed');
    expect(l.rides).toBe(0);
  });

  it('choose a floor with the passenger inside: doors close, ONE ride request, nothing more', () => {
    const l = new ElevatorLogic(3, [1, 2, 3, 4, 5], {open: true});
    const inside = {occupant: true, doorway: false, enemyInside: false};
    expect(l.select(5).ok).toBe(true);
    let ev = run(l, DOOR_TIME + 0.05, inside);
    expect(ev.map(e => e.type)).toEqual(['closed', 'depart']);
    ev = run(l, DEPART_DELAY + 0.05, inside);
    expect(ev.filter(e => e.type === 'ride')).toEqual([{type: 'ride', floor: 5}]);
    ev = run(l, 5, inside);
    expect(ev.filter(e => e.type === 'ride')).toHaveLength(0);
    expect(l.rides).toBe(1);
    expect(l.busy).toBe(true);
    expect(l.select(2).ok).toBe(false); // riding: input ignored
  });

  it('a body in the doorway re-opens closing doors; it closes again once clear', () => {
    const l = new ElevatorLogic(3, [1, 2, 3, 4], {open: true});
    l.select(4);
    run(l, DOOR_TIME * 0.5, {occupant: true, doorway: false, enemyInside: false});
    expect(l.state).toBe('closing');
    const ev = l.update(1 / 60, {occupant: true, doorway: true, enemyInside: false});
    expect(ev).toEqual([{type: 'reopen', why: 'doorway'}]);
    expect(l.state).toBe('opening');
    run(l, 4, {occupant: true, doorway: false, enemyInside: false});
    expect(l.phase === 'departing' || l.phase === 'riding').toBe(true);
    expect(l.rides).toBeLessThanOrEqual(1);
  });

  it('enemies never ride: an enemy inside holds the doors open', () => {
    const l = new ElevatorLogic(3, [1, 2, 3, 4], {open: true});
    l.select(1);
    const ev = run(l, 6, {occupant: true, doorway: false, enemyInside: true});
    expect(ev.some(e => e.type === 'reopen' && e.why === 'enemy')).toBe(true);
    expect(ev.some(e => e.type === 'ride')).toBe(false);
    expect(l.rides).toBe(0);
  });

  it('doors closing with nobody inside cancel the trip (no ride)', () => {
    const l = new ElevatorLogic(3, [1, 2, 3], {open: true});
    l.select(1);
    const ev = run(l, DOOR_TIME + DEPART_DELAY + 0.5, {occupant: false, doorway: false, enemyInside: false});
    expect(ev.some(e => e.type === 'cancelled' && e.why === 'empty')).toBe(true);
    expect(l.rides).toBe(0);
  });

  it('arrival: rebuilt closed around the passenger, chime, then the doors open', () => {
    const l = new ElevatorLogic(5, [1, 5, 8]);
    l.arrive();
    expect(l.sealed).toBe(true);
    const ev = run(l, ARRIVE_OPEN + DOOR_TIME + 0.1, {occupant: true, doorway: false, enemyInside: false});
    const types = ev.map(e => e.type);
    expect(types.indexOf('chime')).toBeLessThan(types.indexOf('opening'));
    expect(types).toContain('opened');
    expect(ARRIVE_CHIME).toBeLessThan(ARRIVE_OPEN);
    expect(l.rides).toBe(0); // an arrival never re-issues a ride
  });

  it('current floor = open; a refused travel re-opens; open cancels a departure', () => {
    const l = new ElevatorLogic(2, [1, 2, 3]);
    expect(l.select(2).events.map(e => e.type)).toEqual(['opening']);
    const m = new ElevatorLogic(2, [1, 2, 3]);
    m.select(3);
    run(m, 0.1, {occupant: true, doorway: false, enemyInside: false});
    expect(m.phase).toBe('departing');
    expect(m.requestOpen().map(e => e.type)).toEqual(['cancelled', 'opening']);
    const r = new ElevatorLogic(2, [1, 2, 3]);
    r.select(1);
    run(r, DEPART_DELAY + 0.1, {occupant: true, doorway: false, enemyInside: false});
    expect(r.phase).toBe('riding');
    expect(r.rideFailed().map(e => e.type)).toEqual(['cancelled', 'opening']);
    expect(r.phase).toBe('idle');
    expect(new ElevatorLogic(2, [1, 2]).select(9).ok).toBe(false);
  });
});

describe('elevator geometry + door collision', () => {
  it('plans the gate from the contract and the grid (0.5 m wall, panels facing their rooms)', () => {
    const layout = officeLayout();
    const info = readTowerInfo(layout)!;
    const plan = planElevator(info.elevator!, layout.grid);
    expect(plan.gate.depth).toBeCloseTo(0.5, 5);
    expect(plan.gate.hw).toBeCloseTo(0.75, 5);
    expect([plan.gate.nx, plan.gate.nz]).toEqual([0, -1]);
    expect(plan.panelN).toEqual([0, 1]); // inside the cab, on the door wall's inner face
    expect(plan.callN).toEqual([0, -1]); // corridor face
    expect(plan.doorTop).toBeCloseTo(2.195, 3); // the doors fill the opening to its lintel
  });

  it('no tunnelling: a sprinting body stays in the cab while the doors are shut, and outside stays outside', () => {
    const info = readTowerInfo(officeLayout())!;
    const G = planElevator(info.elevator!, officeLayout().grid).gate;
    // inside, running north (toward the doors) at 5.8 m/s for 1 s
    let p = {x: 11.25, z: 11.2}, side: GateSide = gateSideOf(G, p.x, p.z);
    for (let i = 0; i < 20; i++) { const r = constrainGate(G, 0, p.x, p.z - 0.29, 0.3, side); p = {x: r.x, z: r.z}; side = r.side; }
    expect(side).toBe('in');
    expect(p.z).toBeGreaterThanOrEqual(10.3 - 1e-6);
    // outside, running south into the shut doors
    p = {x: 11.0, z: 8.5}; side = gateSideOf(G, p.x, p.z);
    for (let i = 0; i < 20; i++) { const r = constrainGate(G, 0.1, p.x, p.z + 0.29, 0.3, side); p = {x: r.x, z: r.z}; side = r.side; }
    expect(side).toBe('out');
    expect(p.z).toBeLessThanOrEqual(9.5 - 0.3 + 1e-6);
    // open doors: walks straight through
    p = {x: 11.25, z: 8.5}; side = 'out';
    for (let i = 0; i < 12; i++) { const r = constrainGate(G, 1, p.x, p.z + 0.25, 0.3, side); p = {x: r.x, z: r.z}; side = r.side; }
    expect(side).toBe('in');
    expect(p.z).toBeGreaterThan(10.5);
  });
});

describe('tower runtime with a fake Game host', () => {
  it('installs into the iteration-16 registries', () => {
    const {host} = makeHost(officeLayout());
    installTower(host as unknown as TowerHost);
    expect(host.sectionHooks).toHaveLength(1);
    expect(host.frameHooks).toHaveLength(1);
    expect(host.interactHandlers).toHaveLength(1);
    expect(host.promptProviders).toHaveLength(1);
    expect(host.stateListeners).toHaveLength(1);
    expect(host.sectionPreloads).toHaveLength(1);
    expect(host.warmRegistry.names.pools).toContain('tower');
  });

  it('call -> walk in -> choose floor 5 -> doors shut (cannot leave) -> exactly one travel request', async () => {
    const layout = officeLayout({floor: 3});
    const {host, calls} = makeHost(layout, async () => ({ok: true}));
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.section!.elevator!;
    expect(e.logic.state).toBe('closed');
    // outside: aim at the call panel
    host.player.x = 12.3; host.player.z = 8.5;
    aim(host, [12.3, 1.62, 8.5], [12.3, 1.2, 9.45]);
    step(host, 0.05);
    expect(host.promptProviders[0]()).toMatch(/Call the elevator/);
    expect(host.interactHandlers[0]()).toBe(true);
    step(host, CALL_DELAY + DOOR_TIME + 0.2);
    expect(e.logic.door).toBe(1);
    // in the cab (doors open: walking in is free)
    host.player.x = 11.6; host.player.z = 11.3;
    step(host, 0.1);
    aim(host, [11.6, 1.62, 11.3], [12.2, 1.2, 10.08]);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(rt.choice.isOpen).toBe(true);
    expect(rt.choice.handleKey('Digit5')).toBe(true);
    expect(rt.choice.isOpen).toBe(false);
    expect(e.logic.target).toBe(5);
    // try to sprint out while the doors close: the gate keeps the player in (the doorway band is never entered)
    for (let i = 0; i < Math.ceil((DOOR_TIME + DEPART_DELAY + 0.3) * 30); i++) {
      if (e.logic.door < 0.3) host.player.z -= 0.19;
      step(host, 1 / 30);
    }
    await flush();
    expect(host.player.z).toBeGreaterThanOrEqual(10.3 - 1e-6);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({to: {level: 'office', section: 'floor-5'}, arrival: {kind: 'elevator', floor: 5}, label: 'Elevator · floor 5', via: 'local'});
    step(host, 3);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('a refused travel re-opens the doors (no ride lost in limbo); doorway obstruction re-opens', async () => {
    const layout = officeLayout();
    const {host, calls, toasts} = makeHost(layout, async () => ({ok: false, reason: 'not-ready'}));
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.section!.elevator!;
    e.logic.door = 1;
    host.player.x = 11.25; host.player.z = 11.2;
    step(host, 0.1);
    e.logic.select(1);
    step(host, DOOR_TIME + DEPART_DELAY + 0.2);
    await flush();
    expect(calls).toHaveLength(1);
    expect(e.logic.phase).toBe('idle');
    expect(e.logic.state === 'opening' || e.logic.state === 'open').toBe(true);
    expect(toasts.some(t => /won.t move/.test(t))).toBe(true);
    // obstruction: stand in the doorway while it closes
    step(host, DOOR_TIME + 0.2);
    e.logic.select(2);
    host.player.z = 9.75; // in the opening
    step(host, 0.4);
    expect(e.logic.door).toBeGreaterThan(0.5);
  });

  it('never trapped: pushing on the shut doors from inside opens them; enemies stay out of a shut cab', () => {
    const layout = officeLayout();
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.section!.elevator!;
    host.player.x = 11.25; host.player.z = 11.0;
    step(host, 0.05);
    const zb: FakeZombie = {brain: {x: 11.25, z: 8.8, y: 0, alive: true, stats: {radius: 0.33}}, ragdolled: false};
    host.zombies.push(zb);
    step(host, 0.05);
    for (let i = 0; i < 20; i++) { zb.brain.z += 0.25; step(host, 1 / 30); }
    expect(zb.brain.z).toBeLessThanOrEqual(9.5 - 0.33 + 1e-6); // kept on the landing
    for (let i = 0; i < 40 && e.logic.state === 'closed'; i++) { host.player.z -= 0.2; step(host, 1 / 30); }
    expect(e.logic.state).not.toBe('closed');
  });

  it('elevator arrival: built with the doors shut around the player, then they open', () => {
    const layout = officeLayout({floor: 6});
    const {host} = makeHost(layout);
    host.arrival = {kind: 'elevator', floor: 6};
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.section!.elevator!;
    expect(e.logic.sealed).toBe(true);
    expect(e.logic.phase).toBe('arriving');
    host.player.x = 11.25; host.player.z = 11;
    step(host, ARRIVE_OPEN + DOOR_TIME + 0.2);
    expect(e.logic.door).toBe(1);
  });

  it('stair door: one door with up + down -> 2-choice list -> travel request (arrival = direction travelled)', async () => {
    const layout = officeLayout({floor: 3});
    const {host, calls} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const plans = rt.section!.stairs!.plans;
    expect(plans).toHaveLength(1);
    expect(plans[0].choices.map(c => `${c.dir}${c.toFloor}`)).toEqual(['up4', 'down2']);
    expect(plans[0].n).toEqual([0, -1]);
    expect(plans[0].z).toBeCloseTo(10, 5); // snapped onto the wall face
    host.player.x = 16.5; host.player.z = 8.7;
    aim(host, [16.5, 1.62, 8.7], [16.5, 1.2, 10]);
    step(host, 0.05);
    expect(host.promptProviders[0]()).toMatch(/Stairwell/);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(rt.choice.isOpen).toBe(true);
    rt.choice.handleKey('Digit1');
    await flush();
    await new Promise(r => setTimeout(r, 20));
    await flush();
    expect(calls).toEqual([{to: {level: 'office', section: 'floor-4'}, arrival: {kind: 'stairs-up', floor: 4}, label: 'Stairs · floor 4', via: 'local'}]);
  });

  it('stair door with one way (the lobby: up only) travels directly; a wall between blocks the E target', async () => {
    const layout = officeLayout({floor: 1, baseY: 0});
    (layout as unknown as {office: {stairDoors: unknown[]}}).office.stairDoors = [{dir: 'up', x: 16.5, z: 9.98, yaw: Math.PI, toFloor: 2}];
    const {host, calls} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    // from inside the stairwell block's far side (z 13, behind the solid block): no target through the wall
    host.player.x = 16.5; host.player.z = 13;
    aim(host, [16.5, 1.62, 13], [16.5, 1.2, 10]);
    step(host, 0.05);
    expect(rt.target).toBeNull();
    expect(host.interactHandlers[0]()).toBe(false);
    host.player.z = 8.8;
    aim(host, [16.5, 1.62, 8.8], [16.5, 1.2, 10]);
    expect(host.interactHandlers[0]()).toBe(true);
    await flush();
    await new Promise(r => setTimeout(r, 20));
    await flush();
    expect(calls.map(c => [c.to.section, c.arrival.kind])).toEqual([['floor-2', 'stairs-up']]);
  });

  it('the floor list: digits pick floors (1 = lobby), arrows + E confirm, Esc closes', () => {
    const m = new ChoiceModel([{id: 'f8', label: '8', key: 8}, {id: 'f1', label: 'L', key: 1}, {id: 'open', label: 'open'}], 0);
    expect(m.key('Digit1')).toEqual({type: 'pick', id: 'f1'});
    m.key('ArrowDown');
    expect(m.key('KeyE')).toEqual({type: 'pick', id: 'f1'});
    expect(m.key('Escape')).toEqual({type: 'close'});
    expect(m.key('KeyW')).toBeNull(); // movement keys reach the game
  });
});

describe('windows', () => {
  it('every span gets a collision box covering it (>= 0.35 m, extended outward); the entrance is boarded', () => {
    const info = readTowerInfo(officeLayout())!;
    const plans = planWindows(info);
    expect(plans).toHaveLength(info.windows.length);
    for (const p of plans) {
      const s = p.span, c = p.collider;
      expect(c.x0).toBeLessThanOrEqual(s.x0 + 1e-9); expect(c.x1).toBeGreaterThanOrEqual(s.x1 - 1e-9);
      expect(c.z0).toBeLessThanOrEqual(s.z0 + 1e-9); expect(c.z1).toBeGreaterThanOrEqual(s.z1 - 1e-9);
      expect(Math.min(c.x1 - c.x0, c.z1 - c.z0)).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(p.panes.length).toBeGreaterThan(0);
      if (s.kind === 'entrance') expect(p.panes.every(q => q.state === 'boarded')).toBe(true);
      expect(p.y0).toBeCloseTo(info.baseY + s.sill, 6);
      expect(p.y1).toBeCloseTo(info.baseY + s.head, 6);
    }
  });

  it('a body pushing into any pane (even a broken one) is put back inside', () => {
    const info = readTowerInfo(officeLayout())!;
    for (const p of planWindows(info)) {
      const mid = (p.a0 + p.a1) / 2;
      // a body that tunnelled deep into the wall (center inside the span box)
      const x = p.along === 'x' ? mid : (p.span.x0 + p.span.x1) / 2, z = p.along === 'x' ? (p.span.z0 + p.span.z1) / 2 : mid;
      const o = pushOutRect(x, z, 0.3, p.collider, [-p.n[0], -p.n[1]])!;
      expect(o).not.toBeNull();
      const s = (o[0] - x) * -p.n[0] + (o[1] - z) * -p.n[1];
      expect(s).toBeGreaterThan(0); // moved toward the room
      const inner = p.inner;
      if (p.along === 'x') expect(Math.abs(o[1] - inner)).toBeCloseTo(0.3, 6); else expect(Math.abs(o[0] - inner)).toBeCloseTo(0.3, 6);
    }
  });
});

describe('exterior', () => {
  it('street level per floor = storey floor - floorHeight * (floor - 1); section names', () => {
    for (const floor of [1, 2, 5, 8]) {
      const baseY = floor === 1 ? 5.6 : 0;
      const info = readTowerInfo(officeLayout({floor, baseY}))!;
      expect(info.groundY).toBeCloseTo(baseY - 4.4 * (floor - 1), 6);
      expect(floorOfSection(sectionForFloor(floor))).toBe(floor);
    }
    expect(sectionForFloor(1)).toBe('street');
  });

  it('scenery stays outside the tower (and its pavement); the ground has the footprint cut out', () => {
    const foot = {x0: 0.5, z0: 0.5, x1: 29.5, z1: 24.5};
    const plan = planExterior({foot, groundY: -8.8, eyeAbove: 10.4, seed: 99});
    const dist = (x: number, z: number) => Math.hypot(Math.max(foot.x0 - x, 0, x - foot.x1), Math.max(foot.z0 - z, 0, z - foot.z1));
    for (const p of plan.props) expect(dist(p.x, p.z)).toBeGreaterThan(EXTERIOR.pavement - 0.5);
    for (const b of plan.buildings) {
      const near = dist(b.x, b.z) - Math.hypot(b.w, b.d) / 2;
      expect(near).toBeGreaterThan(EXTERIOR.pavement + EXTERIOR.road - 4);
    }
    expect(plan.props.length).toBeGreaterThan(8);
    expect(plan.buildings.length).toBeGreaterThan(40);
    const view = buildExterior(plan);
    const ground = view.root.getObjectByName('tower-ext-ground') as THREE.Mesh;
    const pos = ground.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      expect(cx > foot.x0 && cx < foot.x1 && cz > foot.z0 && cz < foot.z1).toBe(false);
      expect(pos.getY(i)).toBeCloseTo(-8.8, 6);
    }
    expect(view.tris).toBeLessThan(150_000); // procedural stand-ins
    expect(view.dome.frustumCulled).toBe(false);
    let shadows = 0;
    view.root.traverse(o => { if (o.castShadow || o.receiveShadow) shadows++; });
    expect(shadows).toBe(0); // scenery never takes part in the flashlight shadow
    for (const g of view.geometries) g.dispose();
  });

  it('Meshy budget: with stand-in models of the manifest tri counts, any half of the city stays near 150k tris', () => {
    const fake = (tris: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris * 9), 3));
      const scene = new THREE.Group(); scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
      return {scene} as never;
    };
    const plan = planExterior({foot: {x0: 0.5, z0: 0.5, x1: 29.5, z1: 24.5}, groundY: 0, eyeAbove: 1.6, seed: 5});
    const view = buildExterior(plan, {car: fake(8000), bus: fake(10000), rubble: fake(6000), tower: fake(20000), midrise: fake(20000)});
    const quad = [0, 0, 0, 0];
    for (const im of view.instanced) {
      const q = Number(/-(\d)$/.exec(im.name)?.[1] ?? -1);
      const t = (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3 * im.count;
      if (q >= 0) quad[q] += t;
    }
    const halves = [quad[0] + quad[1], quad[1] + quad[2], quad[2] + quad[3], quad[3] + quad[0]];
    expect(Math.max(...halves)).toBeLessThan(160_000);
    expect(view.used).toEqual({props: true, heroes: true});
  });
});

describe('section lifecycle + warm-up discovery', () => {
  it('build adds everything (cab, doors, glass, exterior) and the warm-up plan discovers it, hidden exterior included', () => {
    const layout = officeLayout({floor: 4});
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    expect(host.camera.far).toBeGreaterThanOrEqual(EXTERIOR.far);
    const plan = planWarmup(host.scene, {mode: 'full', cameraMask: host.camera.layers.mask, pools: host.warmRegistry.poolRoots()});
    // every renderable of the section (cab, doors, panels, glass, frames, boards, stair doors, exterior) is covered by a
    // planned representative of its three cache-key group (doors share the cab walls' material + layout: one compile)
    const planned = new Set(plan.items.flatMap(i => warmKeys(i.object as THREE.Mesh)));
    const names = new Set<string>();
    rt.section!.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      names.add(m.name);
      for (const k of warmKeys(m)) expect(planned.has(k), `${m.name} ${k}`).toBe(true);
    });
    for (const n of ['tower-cab-walls', 'tower-door-cab-l', 'tower-door-landing-r', 'tower-landing-frame', 'tower-indicator-in', 'tower-window-glass', 'tower-window-glass-cracked', 'tower-window-frames', 'tower-window-boards', 'tower-ext-ground', 'tower-ext-sky']) expect(names.has(n), n).toBe(true);
    expect([...names].some(n => n.startsWith('tower-ext-blocks-'))).toBe(true);
    expect(plan.items.some(i => i.object.name === 'tower-ext-sky')).toBe(true);
    // the exterior hidden (no window in view) is still planned through the 'tower' pool
    rt.section!.exterior!.view.root.visible = false;
    const hidden = planWarmup(host.scene, {mode: 'view', cameraMask: host.camera.layers.mask, pools: host.warmRegistry.poolRoots(), near: {center: new THREE.Vector3(11, 1.6, 11), radius: 5}});
    const hn = hidden.items.map(i => i.object.name);
    expect(hn).toContain('tower-ext-sky');
    expect(hidden.items.find(i => i.object.name === 'tower-ext-sky')!.flips.length).toBeGreaterThan(0);
  });

  it('teardown leaves nothing behind: scene restored, far plane restored, instanced meshes released after the next warm-up', () => {
    const layout = officeLayout({floor: 2});
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    const before = host.scene.children.length;
    host.sectionHooks[0].build!(layout);
    const sec = rt.section!;
    const geos: THREE.BufferGeometry[] = [];
    sec.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) geos.push(m.geometry); });
    const geoSpies = geos.map(g => vi.spyOn(g, 'dispose'));
    const inst = sec.exterior!.view.instanced;
    const instSpies = inst.map(im => vi.spyOn(im, 'dispose'));
    host.sectionHooks[0].teardown!();
    expect(host.scene.children.length).toBe(before);
    let leftovers = 0;
    host.scene.traverse(o => { if (o.name.startsWith('tower-')) leftovers++; });
    expect(leftovers).toBe(0);
    expect(host.camera.far).toBe(70);
    expect(rt.section).toBeNull();
    expect(geoSpies.filter(s => s.mock.calls.length > 0).length).toBe(geos.length); // every per-section geometry released
    expect(instSpies.every(s => s.mock.calls.length === 0)).toBe(true); // instanced: deferred (shared programs survive the next warm-up)
    // next section built + warmed, first played frame: released
    const next = officeLayout({floor: 3});
    host.layout = next; host.levels = levelsOf(next as never);
    host.sectionHooks[0].build!(next);
    expect(instSpies.every(s => s.mock.calls.length === 0)).toBe(true);
    step(host, 1 / 30);
    expect(instSpies.every(s => s.mock.calls.length === 1)).toBe(true);
    // a non-office section (the subway): nothing is built, far plane back to the station value
    host.sectionHooks[0].teardown!();
    const sub = {...officeLayout(), office: undefined} as unknown as StationLayout;
    host.sectionHooks[0].build!(sub);
    expect(rt.section).toBeNull();
    expect(host.camera.far).toBe(70);
    expect(host.scene.children.length).toBe(before);
    expect(rt).toBeInstanceOf(TowerRuntime);
  });
});

describe('tower node materials build on both backends (WGSL + GLSL fallback)', () => {
  it('every distinct material of a built section (cab, glass, signs, exterior incl. Meshy model shading) compiles cleanly', () => {
    const layout = officeLayout({floor: 5});
    const {host} = makeHost(layout);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    // plus the Meshy-model exterior path (a textured standard material, as GLTFLoader produces)
    const tex = new THREE.DataTexture(new Uint8Array(16).fill(128), 2, 2); tex.needsUpdate = true;
    const fake = () => { const g = new THREE.BoxGeometry(1, 1, 1); const sc = new THREE.Group(); sc.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({map: tex}))); return {scene: sc} as never; };
    const ext = buildExterior(rt.section!.exterior!.plan, {car: fake(), tower: fake()});
    const seen = new Map<THREE.Material, THREE.Mesh>();
    for (const root of [rt.section!.root, ext.root]) root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (!seen.has(mat)) seen.set(mat, m);
    });
    expect(seen.size).toBeGreaterThan(10);
    const sky = [...seen].find(([m]) => m.name === 'tower-ext-sky')!;
    const [wgsl] = buildBoth(sky[1], {material: sky[0]});
    expect(wgsl.fragment).toMatch(/atan2?\(/); // the skyline azimuth
    expect(wgsl.fragment).toMatch(/exp\(/); // the footprint fog + haze
    for (const [mat, mesh] of seen) {
      for (const b of buildBoth(mesh, {material: mat})) {
        expect(b.errors, `${mat.name} on ${mesh.name} (${b.backend})`).toEqual([]);
        expect(b.fragment.length, `${mat.name} ${b.backend}`).toBeGreaterThan(100);
      }
    }
  });
});
