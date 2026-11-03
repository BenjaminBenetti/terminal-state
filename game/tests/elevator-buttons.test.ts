// Task office-overhaul-20261030 (lane LIFT): the elevator's PHYSICAL buttons and its full-size office-tower finish (no floor
// list / submenu). A synthetic 9-storey tower (as tower-runtime.test.ts: station hall at 0, lobby 5.6, floors 2..8 at +4.4, one
// SOLID shaft; cab 2.5 x 2 m, door N 1.5 m, shaft wall 0.5 m) and a fake Game host stepping dt:
//  - the button layout per stop (a numbered cab button per stop + door open / close + alarm on the car operating panel; the
//    lobby station has only up, the top floor only down);
//  - ray picking from a camera pose: the right button, reach, facing, occlusion by structure, never another storey's;
//  - press (left click through Game.pointerHandlers, or E) -> queued / lit -> the cab travels -> served -> unlit; pressing while
//    riding queues; the hall lantern shows the answered direction;
//  - door open / close obey the interlocks (an obstruction still re-opens / holds; nothing while moving);
//  - the click on a targeted button is consumed and latched (Game.update's contract): the held weapon never fires;
//  - no floor-list UI code path remains;
//  - geometry: the cab group stays inside the shaft, landing pieces never intrude into the walkable landing strip, nothing but the
//    doors in the clear doorway; modest draw calls; the GEN level's own signage never overlaps the landing fixtures;
//  - QA hooks: liftAim / liftPress (the real input path) / liftState.
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {WarmupRegistry} from '../src/render/warmup';
import {BUTTON_REACH, CLOSE_DWELL, DOOR_TIME, DWELL, ElevatorLogic, planElevator, type LiftButton} from '../src/world/elevator';
import {gateLocal, readTowerInfo} from '../src/world/towerShared';
import {TowerRuntime, installTower, type TowerHost} from '../src/world/towerRuntime';
import {towerQaApi} from '../src/world/towerQa';
import {Player} from '../src/player/player';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {WEAPONS, WeaponController, weaponAmmoItem} from '../src/weapons/weapons';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

// ---------------------------------------------------------------------------------------------
// Fixture (as tower-runtime.test.ts)

const W = 60, H = 50, FLOORS = [1, 2, 3, 4, 5, 6, 7, 8], LOBBY = 5.6, FH = 4.4;
const baseOf = (f: number) => (f === 0 ? 0 : LOBBY + FH * (f - 1));
const CAB = {x0: 10, z0: 10, x1: 12.5, z1: 12};
const SHAFT = {x0: 9.5, z0: 9.5, x1: 13, z1: 12.5};
const DOOR = {x: 11.25, z: 10, width: 1.5};
const LANDING = {x: 11.25, z: 8.6};

function towerLayout(edit?: (grids: Grid[]) => void): StationLayout {
  const levels = [0, ...FLOORS].map(L => {
    const g = new Grid(W, H);
    const base = baseOf(L), ceil = base + (L === 0 ? 4.4 : L === 1 ? 4.0 : 2.9);
    for (let y = 2; y <= 47; y++) for (let x = 2; x <= 57; x++) { g.set(x, y, FLOOR); const i = g.idx(x, y); g.floor[i] = base; g.ceil[i] = ceil; }
    if (L >= 1) for (let y = 19; y <= 24; y++) for (let x = 19; x <= 25; x++) g.set(x, y, SOLID);
    return {id: L, role: L === 0 ? 'main' : L === 1 ? 'upper' : 'office', grid: g, baseY: base};
  });
  edit?.(levels.map(l => l.grid));
  const storeys = FLOORS.map(f => ({floor: f, levelId: f, baseY: baseOf(f), label: f === 1 ? 'L' : String(f), clear: f === 1 ? 4 : 2.9}));
  const layout = {
    seed: 4242, grid: levels[0].grid, levels, levelLinks: [], rails: [], trench: {floorY: -1.15},
    lights: [], props: [], areas: [], doors: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    office: {
      version: 2, floors: FLOORS, floorHeight: FH, groundY: LOBBY, storeys,
      elevator: {
        cab: CAB, shaft: SHAFT, doorSide: 'N', door: DOOR, cabHeight: 2.6, panel: {x: 12.25, dy: 1.2, z: 10.03},
        stops: FLOORS.map(f => ({floor: f, levelId: f, y: baseOf(f), area: -1, callPanel: {x: 12.55, y: baseOf(f) + 1.2, z: 9.47}, landing: LANDING})),
      },
      stairs: {well: {x0: 15, z0: 9.5, x1: 18, z1: 14}, runs: [], landings: []},
      windows: [], exterior: {x0: 0.5, z0: 0.5, x1: 29.5, z1: 24.5}, start: {x: 5, z: 20, yaw: 0, level: 0}, name: 'Test Tower',
    },
  };
  return layout as unknown as StationLayout;
}

function makeHost(layout: StationLayout, player: Player) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const host = {
    scene, camera, player, zombies: [] as {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled: boolean}[],
    levels: levelsOf(layout as never), layout, mats, sfx: null, hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(),
    interactHandlers: [] as (() => boolean)[], pointerHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[],
    stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', warming: false, pickups: new PickupManager({}), world: {culler: {enabled: true, register: () => {}}},
  };
  const rt = installTower(host as unknown as TowerHost);
  host.sectionHooks[0].build!(layout);
  return {host, rt, e: rt.office!.elevator!};
}

const DT = 1 / 30;
const step = (host: {frameHooks: ((dt: number) => void)[]}, seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += DT) for (const f of host.frameHooks) f(DT); };
/** Put the eye at (x, y, z) looking at p (also moves the player under it so its storey / cab tests agree). */
function look(host: {camera: THREE.PerspectiveCamera}, P: Player, eye: [number, number, number], p: {x: number; y: number; z: number}) {
  P.x = eye[0]; P.z = eye[2]; P.y = eye[1] - 1.62; P.eye = eye[1];
  host.camera.position.set(...eye);
  host.camera.lookAt(p.x, p.y, p.z);
  host.camera.updateMatrixWorld(true);
}
/** World cap centre of a button (cab buttons at the cab's current y). */
const capAt = (e: {logic: ElevatorLogic}, b: LiftButton) => (b.where === 'car' ? {x: b.at.x, y: b.at.y + e.logic.y, z: b.at.z} : b.at);
const byId = (src: {buttons: LiftButton[]} | {plan: {buttons: LiftButton[]}}, id: string) => ('plan' in src ? src.plan : src).buttons.find(b => b.id === id)!;
/** The input section of Game.update (game.ts, task office-overhaul-20261030 lane LIFT): consume + latch, then the weapon gate. */
function gameInput(host: {pointerHandlers: (() => boolean)[]}, inp: {mouse: boolean[]; mousePressed: boolean[]}, st: {latch: boolean}) {
  if (inp.mousePressed[0] && host.pointerHandlers.some(h => h())) { inp.mousePressed[0] = false; st.latch = true; }
  if (st.latch && !inp.mouse[0]) st.latch = false;
  return {held: inp.mouse[0] && !st.latch, pressed: inp.mousePressed[0] && !st.latch};
}

// ---------------------------------------------------------------------------------------------

describe('button layout per stop (plan)', () => {
  it('a numbered cab button per stop + door open / close + alarm on the panel; lobby up only, top floor down only', () => {
    const info = readTowerInfo(towerLayout())!;
    const plan = planElevator(info.elevator!);
    const G = plan.gate;
    expect(plan.carButtons.map(b => b.id)).toEqual(['car-L', 'car-2', 'car-3', 'car-4', 'car-5', 'car-6', 'car-7', 'car-8', 'car-open', 'car-close', 'car-alarm']);
    // the panel sits on the front return beside the opening, clear of the jamb return and the side wall, facing into the cab
    expect(Math.abs(plan.cop.l) - plan.cop.halfW).toBeGreaterThan(G.hw + 0.04);
    expect(Math.abs(plan.cop.l) + plan.cop.halfW).toBeLessThan(plan.frame.lMax - 0.046);
    for (const b of plan.carButtons) {
      expect(b.n).toEqual(plan.panelN);
      expect(b.n).toEqual([0, 1]); // door N: the panel faces +z, into the cab
      expect(b.at.z).toBeGreaterThan(CAB.z0 + 0.065);
      expect(b.at.z).toBeLessThan(CAB.z0 + 0.1);
      expect(b.at.x).toBeGreaterThan(CAB.x0);
      expect(b.at.x).toBeLessThan(CAB.x1);
      expect(b.at.y).toBeGreaterThan(0.7); // ergonomic: every button between knee and shoulder height
      expect(b.at.y).toBeLessThan(1.4);
      expect(Math.abs(gateLocal(G, b.at.x, b.at.z)[1] - plan.cop.l)).toBeLessThan(plan.cop.halfW - b.r);
    }
    // floors bottom-up in rows of two: L bottom-left, 8 top-right
    const f = plan.carButtons.filter(b => b.kind === 'floor');
    for (let i = 2; i < f.length; i++) expect(f[i].at.y).toBeCloseTo(f[i - 2].at.y + 0.11, 6);
    expect(f[0].local.l).toBeLessThan(f[1].local.l);
    expect(f[0].at.y).toBeCloseTo(f[1].at.y, 9);
    expect(byId(plan, 'car-open').at.y).toBeLessThan(f[0].at.y);
    expect(byId(plan, 'car-alarm').at.y).toBeLessThan(byId(plan, 'car-open').at.y);
    // landing stations
    expect(plan.hallButtons.map(l => l.map(b => b.kind).join('+'))).toEqual(['up', 'up+down', 'up+down', 'up+down', 'up+down', 'up+down', 'up+down', 'down']);
    expect(plan.hallButtons[0][0].id).toBe('hall-L-up');
    expect(plan.hallButtons[7][0].id).toBe('hall-8-down');
    info.elevator!.stops.forEach((st, i) => {
      for (const b of plan.hallButtons[i]) {
        expect(b.n).toEqual([0, -1]); // facing the corridor
        expect(b.at.z).toBeCloseTo(SHAFT.z0 - 0.019, 6);
        expect(Math.abs(gateLocal(G, b.at.x, b.at.z)[1])).toBeGreaterThanOrEqual(G.hw + 0.3 - 1e-9); // beside the doorway, clear of the frame
        expect(b.at.y - st.y).toBeGreaterThan(1.0);
        expect(b.at.y - st.y).toBeLessThan(1.4);
      }
      const [up, down] = plan.hallButtons[i];
      if (up && down) expect(up.at.y).toBeGreaterThan(down.at.y);
    });
    // pick boxes never overlap (each press is unambiguous)
    const overlap = (a: LiftButton, b: LiftButton) => a.box.min.x < b.box.max.x && b.box.min.x < a.box.max.x && a.box.min.y < b.box.max.y && b.box.min.y < a.box.max.y && a.box.min.z < b.box.max.z && b.box.min.z < a.box.max.z;
    for (const list of [plan.carButtons, ...plan.hallButtons]) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i], list[j]), `${list[i].id} / ${list[j].id}`).toBe(false);
    expect(plan.buttons).toHaveLength(11 + 14);
  });
});

describe('ray picking from a camera pose', () => {
  it('in the cab: each button under the crosshair is the target; beyond reach, not facing it, or from outside: nothing', () => {
    const P = new Player();
    P.spawn(11.25, 11.0, 0, baseOf(1));
    const {host, rt, e} = makeHost(towerLayout(), P);
    const y = e.logic.y;
    for (const b of e.plan.carButtons) {
      look(host, P, [11.25, y + 1.62, 11.0], capAt(e, b));
      const t = rt.pickButton(rt.office!, y);
      expect(t?.btn.id, b.id).toBe(b.id);
      expect(t!.kind).toBe('panel');
      expect(t!.t).toBeLessThanOrEqual(BUTTON_REACH);
    }
    // the hover ring follows the target (one frame)
    look(host, P, [11.25, y + 1.62, 11.0], capAt(e, byId(e, 'car-5')));
    step(host, DT);
    expect(rt.target?.btn.id).toBe('car-5');
    expect(rt.prompt).toMatch(/\[Click \/ E\].*Floor 5/);
    const hover = e.view.cab.getObjectByName('tower-button-hover-car')!;
    expect(hover.visible).toBe(true);
    expect(hover.position.distanceTo(new THREE.Vector3(byId(e, 'car-5').at.x, byId(e, 'car-5').at.y, byId(e, 'car-5').at.z))).toBeLessThan(0.01);
    // from the rear corner of the cab the panel is out of reach (> 1.7 m)
    look(host, P, [10.3, y + 1.62, 11.7], capAt(e, byId(e, 'car-5')));
    expect(rt.pickButton(rt.office!, y)).toBeNull();
    step(host, DT);
    expect(rt.target).toBeNull();
    expect(hover.visible).toBe(false);
    // looking past it (the ray misses every box)
    look(host, P, [11.25, y + 1.62, 11.0], {x: 12.2, y: y + 2.2, z: 10});
    expect(rt.pickButton(rt.office!, y)).toBeNull();
    // from the landing with the doors open: the panel's face looks away (and the eye is not in the cab)
    rt.callFloor(1);
    step(host, DOOR_TIME + 0.2);
    expect(e.gate.open).toBe(true);
    look(host, P, [11.9, y + 1.62, 9.1], capAt(e, byId(e, 'car-L')));
    expect(rt.pickButton(rt.office!, y)?.btn.where ?? null).not.toBe('car');
  });

  it("landing: the call station of the eye's storey; reach; occluded by structure; never another storey's", () => {
    // a pillar of solid cells on floor 3's landing between the eye at z 8.0 and the call station (x 12.55, z 9.47)
    const P = new Player();
    const {host, rt, e} = makeHost(towerLayout(g => { for (const x of [24, 25, 26]) for (const y of [17, 18]) g[3].set(x, y, SOLID); }), P);
    const y3 = baseOf(3), up3 = byId(e, 'hall-3-up'), down3 = byId(e, 'hall-3-down');
    look(host, P, [12.55, baseOf(2) + 1.62, 8.6], byId(e, 'hall-2-up').at);
    expect(rt.pickButton(rt.office!, e.logic.y)?.btn.id).toBe('hall-2-up');
    look(host, P, [12.55, baseOf(2) + 1.62, 8.6], byId(e, 'hall-2-down').at);
    const t = rt.pickButton(rt.office!, e.logic.y)!;
    expect(t.btn.id).toBe('hall-2-down');
    expect(t.kind).toBe('call');
    // another storey's station (through the slab): never
    look(host, P, [12.55, baseOf(2) + 1.62, 8.6], up3.at);
    expect(rt.pickButton(rt.office!, e.logic.y)).toBeNull();
    // reach: 1.9 m away nothing, 1.2 m away yes
    look(host, P, [12.55, baseOf(5) + 1.62, 7.6], byId(e, 'hall-5-up').at);
    expect(rt.pickButton(rt.office!, e.logic.y)).toBeNull();
    look(host, P, [12.55, baseOf(5) + 1.62, 8.3], byId(e, 'hall-5-up').at);
    expect(rt.pickButton(rt.office!, e.logic.y)?.btn.id).toBe('hall-5-up');
    // occlusion: floor 3's pillar stands between the eye and its station (within reach)
    look(host, P, [12.55, y3 + 1.4, 8.0], down3.at);
    expect(Math.hypot(down3.at.x - 12.55, down3.at.y - (y3 + 1.4), down3.at.z - 8.0)).toBeLessThan(BUTTON_REACH);
    expect(rt.pickButton(rt.office!, e.logic.y)).toBeNull();
    // the same pose on floor 4 (no pillar): pressable
    look(host, P, [12.55, baseOf(4) + 1.4, 8.0], byId(e, 'hall-4-down').at);
    expect(rt.pickButton(rt.office!, e.logic.y)?.btn.id).toBe('hall-4-down');
  });
});

describe('pressing: click / E -> queued + lit -> the cab travels -> served -> unlit', () => {
  it('a click on 5 in the cab is consumed and queues it; pressing 7 while riding queues it too; each goes dark when served', () => {
    const P = new Player();
    P.spawn(11.25, 11.0, 0, baseOf(1));
    const {host, rt, e} = makeHost(towerLayout(), P);
    const inp = {mouse: [true, false, false], mousePressed: [true, false, false]}, st = {latch: false};
    look(host, P, [11.25, e.logic.y + 1.62, 11.0], capAt(e, byId(e, 'car-5')));
    step(host, DT);
    const gate = gameInput(host, inp, st);
    expect(gate).toEqual({held: false, pressed: false}); // the click was the button's
    expect(e.logic.car.has(4)).toBe(true);
    expect(rt.lastPress).toEqual({id: 'car-5', via: 'click'});
    step(host, DT);
    expect(e.view.lit.get('car-5')!.visible).toBe(true);
    expect(rt.prompt).toMatch(/Floor 5 · lit/);
    // ride; once moving, press 7 (E this time): queued, and the cab continues there after 5
    let pressed7 = false;
    const arrivals: number[] = [];
    for (let i = 0; i < 30 * 60 && arrivals.length < 2; i++) {
      for (const f of host.frameHooks) f(DT);
      P.y = e.logic.y; P.eye = P.y + 1.62; // standing in the cab (carried)
      if (e.logic.moving && !pressed7) {
        look(host, P, [11.25, e.logic.y + 1.62, 11.0], capAt(e, byId(e, 'car-7')));
        expect(host.interactHandlers[0]()).toBe(true);
        expect(e.logic.car.has(6)).toBe(true);
        pressed7 = true;
      }
      if (e.logic.arrivals > arrivals.length) arrivals.push(e.logic.floor);
      if (arrivals.length === 1 && e.logic.state === 'open') {
        expect(e.logic.car.has(4)).toBe(false);
        expect(e.view.lit.get('car-5')!.visible).toBe(false); // served: dark
        expect(e.view.lit.get('car-7')!.visible).toBe(true);
      }
    }
    expect(pressed7).toBe(true);
    expect(arrivals).toEqual([5, 7]);
    step(host, DT);
    expect(e.view.lit.get('car-7')!.visible).toBe(false);
    expect(host.state).toBe('playing');
  });

  it('landing down / up buttons light until the cab arrives; the lantern shows the answered direction', () => {
    const P = new Player();
    const {host, rt, e} = makeHost(towerLayout(), P);
    look(host, P, [12.55, baseOf(3) + 1.62, 8.6], byId(e, 'hall-3-down').at);
    expect(host.pointerHandlers[0]()).toBe(true);
    expect(e.logic.hallDown.has(2)).toBe(true);
    expect(e.logic.hallUp.has(2)).toBe(false);
    step(host, DT);
    expect(e.view.lit.get('hall-3-down')!.visible).toBe(true);
    expect(e.view.lit.get('hall-3-up')!.visible).toBe(false);
    expect(rt.prompt).toMatch(/Elevator called · going down/);
    for (let i = 0; i < 30 * 30 && !(e.logic.stop === 2 && e.logic.state === 'open'); i++) for (const f of host.frameHooks) f(DT);
    expect(e.logic.stop).toBe(2);
    expect(e.view.lit.get('hall-3-down')!.visible).toBe(false);
    expect(e.view.lit.get('lantern-3-down')!.visible).toBe(true); // came up for a down call: ▼
    expect(e.view.lit.get('lantern-3-up')!.visible).toBe(false);
    expect(e.view.lit.get('lantern-4-down')!.visible).toBe(false);
    // the doors open at this stop: the station's prompt holds them
    look(host, P, [12.55, baseOf(3) + 1.62, 8.6], byId(e, 'hall-3-up').at);
    step(host, DT);
    expect(rt.prompt).toMatch(/Hold the elevator doors/);
    // the lobby station only calls up; the top floor's only down
    expect(e.plan.hallButtons[0].map(b => b.kind)).toEqual(['up']);
    look(host, P, [12.55, baseOf(1) + 1.62, 8.6], byId(e, 'hall-L-up').at);
    expect(host.pointerHandlers[0]()).toBe(true);
    expect(e.logic.hallUp.has(0)).toBe(true);
    look(host, P, [12.55, baseOf(8) + 1.62, 8.6], byId(e, 'hall-8-down').at);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(e.logic.hallDown.has(7)).toBe(true);
  });

  it('door open / close buttons obey the interlocks', () => {
    const P = new Player();
    P.spawn(11.25, 11.0, 0, baseOf(1));
    const {host, rt, e} = makeHost(towerLayout(), P);
    const L = e.logic;
    const press = (id: string) => { look(host, P, [11.25, L.y + 1.62, 11.0], capAt(e, byId(e, id))); return host.pointerHandlers[0](); };
    expect(press('car-open')).toBe(true);
    step(host, DOOR_TIME + 0.1);
    expect(L.state).toBe('open');
    // door close: shut long before the dwell would have closed them
    expect(press('car-close')).toBe(true);
    step(host, DT);
    expect(e.view.lit.get('car-close')!.visible).toBe(true);
    step(host, CLOSE_DWELL + 0.1);
    expect(L.state).toBe('closing');
    expect(CLOSE_DWELL + 0.2).toBeLessThan(DWELL);
    // door open while closing re-opens them
    expect(press('car-open')).toBe(true);
    expect(L.state).toBe('opening');
    step(host, DOOR_TIME + 0.1);
    // someone in the doorway: door close never shuts them on the body (held open)
    const prev = {x: P.x, z: P.z};
    P.x = 11.25; P.z = 9.75; // standing in the doorway (the camera stays in the cab, aiming at the panel)
    host.camera.position.set(11.25, L.y + 1.62, 11.0); host.camera.lookAt(capAt(e, byId(e, 'car-close')).x, capAt(e, byId(e, 'car-close')).y, capAt(e, byId(e, 'car-close')).z); host.camera.updateMatrixWorld(true);
    expect(host.pointerHandlers[0]()).toBe(true);
    step(host, 3);
    expect(L.door).toBe(1);
    expect(L.state).toBe('open');
    // the doorway clears: the pending close goes through at once
    P.x = prev.x; P.z = prev.z;
    step(host, 0.3);
    expect(L.state).toBe('closing');
    // while moving: door open does nothing (never opens between stops); door close is a no-op
    rt.panelPick(4);
    for (let i = 0; i < 300 && !L.moving; i++) for (const f of host.frameHooks) f(DT);
    expect(L.moving).toBe(true);
    P.y = L.y;
    expect(press('car-open')).toBe(true);
    expect(press('car-close')).toBe(true);
    step(host, 0.5);
    expect(L.door).toBe(0);
    expect(e.gate.open).toBe(false);
    expect(L.closeRequested).toBe(false);
  });
});

describe('input ownership: a click on a targeted button never fires the weapon', () => {
  it('the pointer handler takes the click only while a button is targeted; the held rifle fires otherwise', () => {
    const P = new Player();
    P.spawn(11.25, 11.0, 0, baseOf(1));
    const {host, e} = makeHost(towerLayout(), P);
    const inv = new Inventory();
    inv.add(inv.makeStack('rifle', 1));
    inv.add(inv.makeStack(weaponAmmoItem(WEAPONS.rifle)!, 60)); // lane AMMO: the rifle's caliber item (5.56×45mm)
    const wc = new WeaponController();
    wc.equip(inv.hotbar[0]);
    const idle = {held: false, pressed: false, reload: false, lowered: false};
    wc.update(2, idle, inv);
    const shoot = (aimAtButton: boolean) => {
      const at = aimAtButton ? capAt(e, byId(e, 'car-3')) : {x: 11.25, y: e.logic.y + 1.6, z: 12};
      look(host, P, [11.25, e.logic.y + 1.62, 11.0], at);
      const inp = {mouse: [true, false, false], mousePressed: [true, false, false]}, st = {latch: false};
      let shots = 0;
      for (let i = 0; i < 30; i++) { // press, then hold for a second (the rifle is automatic)
        const g = gameInput(host, inp, st);
        shots += wc.update(DT, {...idle, ...g}, inv).filter(x => x.type === 'fire').length;
        inp.mousePressed[0] = false;
      }
      inp.mouse[0] = false;
      gameInput(host, inp, st);
      expect(st.latch).toBe(false); // released: the latch lets go
      return shots;
    };
    expect(shoot(true)).toBe(0);
    expect(e.logic.car.has(2)).toBe(true);
    expect(shoot(false)).toBeGreaterThan(3);
  });

  it('a living enemy standing in front of a button takes the click (the gun fires); a dead one does not', () => {
    const P = new Player();
    const {host, rt, e} = makeHost(towerLayout(), P);
    const b = byId(e, 'hall-4-up');
    look(host, P, [12.55, baseOf(4) + 1.62, 8.2], b.at);
    expect(rt.pickButton(rt.office!, e.logic.y)?.btn.id).toBe('hall-4-up');
    const zb = {brain: {x: 12.55, z: 8.85, y: baseOf(4), alive: true, stats: {radius: 0.3}}, ragdolled: false};
    host.zombies.push(zb);
    expect(rt.pickButton(rt.office!, e.logic.y)).toBeNull();
    expect(host.pointerHandlers[0]()).toBe(false);
    expect(e.logic.hallUp.has(3)).toBe(false);
    zb.brain.alive = false;
    expect(host.pointerHandlers[0]()).toBe(true);
    expect(e.logic.hallUp.has(3)).toBe(true);
  });

  it("game.ts: the consuming pointer hook runs right after E and before the flare hold, the gun, item use and the lanes' frame hooks", () => {
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/readonly pointerHandlers: \(\(\) => boolean\)\[\] = \[\];/);
    const update = src.slice(src.indexOf('  update(dt: number): void {'));
    const hook = update.indexOf('if (inp.mousePressed[0] && this.pointerHandlers.some(h => h())) { inp.mousePressed[0] = false; this.lmbLatch = true; }');
    expect(hook).toBeGreaterThan(0);
    expect(update.indexOf("if (inp.hit('KeyE')) this.interact();")).toBeLessThan(hook);
    // (task knife-windup-20261030, lane SLOT: item use starts from the held slot ref, `this.startUse(this.inv.selectedRef())`)
    for (const later of ['this.flareHold.update(', 'this.weapon.update(', 'this.startUse(this.inv.selectedRef())', 'for (const fn of this.frameHooks)']) {
      const at = update.indexOf(later);
      expect(at, later).toBeGreaterThan(hook);
    }
    // the gun's trigger is gated by the latch (flareOwns includes lmbLatch)
    expect(update).toMatch(/const flareOwns = [^;]*this\.lmbLatch/);
    expect(update).toMatch(/held: inp\.mouse\[0\] && !flareOwns(?: && !rideHolster)?, pressed: inp\.mousePressed\[0\] && !flareOwns/);
    // and the tower registers its handler there
    const P = new Player();
    const {host} = makeHost(towerLayout(), P);
    expect(host.pointerHandlers).toHaveLength(1);
    look(host, P, [5, 1.62, 20], {x: 5, y: 1.6, z: 10});
    expect(host.pointerHandlers[0]()).toBe(false); // nothing targeted: the click is the gun's
  });
});

describe('no floor list', () => {
  it('no floor-selection UI code path remains reachable', () => {
    const src = new URL('../src/', import.meta.url).pathname;
    expect(existsSync(join(src, 'ui/elevatorPanel.ts'))).toBe(false);
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|css|html)$/.test(n)) files.push(p); } };
    walk(src);
    files.push(new URL('../index.html', import.meta.url).pathname);
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/elevatorPanel|TowerChoice|ChoiceModel|tower-choice|openFloorList/);
    }
    for (const f of ['world/towerRuntime.ts', 'world/elevator.ts', 'world/towerQa.ts']) expect(readFileSync(join(src, f), 'utf8'), f).not.toMatch(/addEventListener\(\s*'(keydown|wheel|mousedown)'/);
    const P = new Player();
    const {rt} = makeHost(towerLayout(), P);
    expect(rt).toBeInstanceOf(TowerRuntime);
    expect('choice' in rt).toBe(false);
  });
});

describe('the finish: geometry stays where it belongs', () => {
  const verts = (root: THREE.Object3D, each: (p: THREE.Vector3, m: THREE.Mesh) => void, skip?: (m: THREE.Mesh) => boolean) => {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || skip?.(m)) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); each(v, m); }
    });
  };

  it('the cab group stays inside the shaft (doors shut and open, at several heights); its open door leaves sit just inside their pockets (never in the opening)', () => {
    const P = new Player();
    const {e} = makeHost(towerLayout(), P);
    const G = e.plan.gate;
    for (const [y, door] of [[baseOf(1), 0], [baseOf(1), 1], [baseOf(4) + 1.3, 0], [baseOf(8), 1]] as const) {
      e.view.setCab(y, door);
      verts(e.view.cab, (p, m) => {
        expect(p.x, m.name).toBeGreaterThanOrEqual(SHAFT.x0 - 1e-6);
        expect(p.x, m.name).toBeLessThanOrEqual(SHAFT.x1 + 1e-6);
        expect(p.z, m.name).toBeGreaterThanOrEqual(SHAFT.z0 - 1e-6);
        expect(p.z, m.name).toBeLessThanOrEqual(SHAFT.z1 + 1e-6);
        expect(p.y - y, m.name).toBeGreaterThan(-0.06);
        expect(p.y - y, m.name).toBeLessThan(2.6 + 0.04);
        const [s, l] = gateLocal(G, p.x, p.z);
        expect(s, `${m.name} reaches into the landing doors' zone`).toBeLessThanOrEqual(0.046);
        if (/door-cab/.test(m.name) && door === 1) expect(Math.abs(l), m.name).toBeGreaterThanOrEqual(G.hw - 1e-6);
        if (!/door-cab/.test(m.name) && s > 1e-6) expect(Math.abs(l) >= G.hw - 1e-6 || p.y - y <= 0.004 || p.y - y >= e.plan.doorH - 1e-6, `${m.name} in the doorway`).toBe(true);
      }, m => m.name.startsWith('tower-button-hover'));
    }
  });

  it('landing pieces never intrude into the walkable landing strip, and nothing but the doors fills the clear doorway', () => {
    const P = new Player();
    const {e, rt} = makeHost(towerLayout(), P);
    const G = e.plan.gate, d = G.depth;
    rt.callFloor(1);
    e.view.setLanding(0, 1);
    e.plan.info.stops.forEach((st, i) => {
      const g = e.view.landings[i];
      expect(g.userData.level).toBe(st.levelId);
      verts(g, (p, m) => {
        expect(m.userData.level, m.name).toBe(st.levelId);
        const [s, l] = gateLocal(G, p.x, p.z), y = p.y - st.y;
        // walkable strip in front of the doors: anything above the floor and below head height is at most 6 cm proud of the wall
        if (y > 0.006 && y < 2.1 && Math.abs(l) < 1.25) expect(s, `${m.name} intrudes into the landing strip (y ${y.toFixed(3)})`).toBeLessThanOrEqual(d + 0.06);
        // the clear doorway (doors open): only the door leaves
        if (!/door-landing/.test(m.name) && Math.abs(l) < G.hw - 1e-6 && y > 0.006 && y < e.plan.doorH - 1e-6) expect(s < -0.04 || s > d + 0.06, `${m.name} in the doorway`).toBe(true);
        // within the shaft footprint along the wall, and never inside the shaft beyond the cab plane
        expect(s, m.name).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.abs(l), m.name).toBeLessThanOrEqual(1.75 + 1e-6);
      }, m => m.name.startsWith('tower-button-hover'));
    });
    // the landing doors when shut fill the opening exactly between the jambs
    e.view.setLanding(0, 0);
    const box = new THREE.Box3();
    for (const n of ['tower-door-landing-l', 'tower-door-landing-r']) box.expandByObject(e.view.landings[0].getObjectByName(n)!);
    expect(box.min.x).toBeLessThanOrEqual(DOOR.x - G.hw);
    expect(box.max.x).toBeGreaterThanOrEqual(DOOR.x + G.hw);
  });

  it('modest draw calls: merged static geometry, shared landing geometry / materials, lit overlays only while lit; no lights', () => {
    const P = new Player();
    const {e, rt} = makeHost(towerLayout(), P);
    const visibleMeshes = (root: THREE.Object3D) => { let n = 0; root.traverseVisible(o => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
    const tris = (root: THREE.Object3D) => { let n = 0; root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) n += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; }); return n; };
    expect(visibleMeshes(e.view.cab)).toBeLessThanOrEqual(15);
    for (const g of e.view.landings) expect(visibleMeshes(g)).toBeLessThanOrEqual(5);
    expect(tris(e.view.cab)).toBeLessThan(16000);
    expect(tris(e.view.landings[3])).toBeLessThan(3000);
    // landings share geometry (middle stops identical) and materials
    const geo = (g: THREE.Group, n: string) => (g.getObjectByName(n) as THREE.Mesh).geometry;
    expect(geo(e.view.landings[2], 'tower-landing-frame')).toBe(geo(e.view.landings[5], 'tower-landing-frame'));
    expect(geo(e.view.landings[2], 'tower-landing-buttons')).toBe(geo(e.view.landings[5], 'tower-landing-buttons'));
    expect(geo(e.view.landings[0], 'tower-landing-buttons')).not.toBe(geo(e.view.landings[5], 'tower-landing-buttons')); // lobby: up only
    const mats = new Set<THREE.Material>();
    e.view.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) mats.add(m.material as THREE.Material); });
    expect(mats.size).toBeLessThanOrEqual(18);
    let lights = 0;
    rt.office!.root.traverse(o => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
  });

  it("GEN's real level: the landing fixtures never collide with the generated signage / props on the shaft face", async () => {
    // (loaded lazily: a generator mid-change in another lane must not take the rest of this file down)
    let layout: StationLayout | null = null;
    try {
      const officeGen = await import('../src/gen/office/index');
      const gen = (officeGen as unknown as {generateOfficeLevel?: (ctx: {levelSeed: number; startWeapon?: string}) => StationLayout}).generateOfficeLevel;
      layout = gen ? gen({levelSeed: 12345, startWeapon: 'pistol'}) : null;
    } catch (err) { console.warn('generateOfficeLevel unavailable (another lane mid-change?)', err); }
    if (!layout) return;
    const info = readTowerInfo(layout)!;
    const plan = planElevator(info.elevator!);
    const G = plan.gate, d = G.depth;
    // the landing fixtures on the corridor face: portal (|l| <= hw + 0.1, y <= doorH + 0.12), lantern (|l| <= 0.34), call station
    const call = plan.calls[0];
    const fixtures = [{l0: -G.hw - 0.1, l1: G.hw + 0.1, y0: 0, y1: plan.doorH + 0.32}, {l0: call.l - 0.07, l1: call.l + 0.07, y0: 0.85, y1: 1.4}];
    for (const s of layout.signs) {
      const lv = s.level ?? 0, st = info.elevator!.stops.find(q => q.levelId === lv);
      if (!st) continue;
      const [ss, l] = gateLocal(G, s.x, s.z);
      if (ss < d - 0.05 || ss > d + 0.2) continue; // not on the shaft's corridor face
      const hw = (s.w ?? 1.2) / 2, y = s.y - st.y;
      for (const f of fixtures) expect(l + hw <= f.l0 || l - hw >= f.l1 || y + 0.15 <= f.y0 || y - 0.15 >= f.y1, `sign '${s.text}' on floor ${st.floor} overlaps a landing fixture`).toBe(true);
    }
    for (const p of layout.props) {
      const lv = p.level ?? 0, st = info.elevator!.stops.find(q => q.levelId === lv);
      if (!st) continue;
      const [ss, l] = gateLocal(G, p.x, p.z);
      if (ss < d - 0.05 || ss > d + 0.6 || Math.abs(l) > 1.4) continue;
      expect(false, `prop ${p.kind} in front of the elevator on floor ${st.floor}`).toBe(true);
    }
    // the COP fits the real cab's front return
    expect(Math.abs(plan.cop.l) - plan.cop.halfW).toBeGreaterThan(G.hw + 0.04);
    expect(Math.abs(plan.cop.l) + plan.cop.halfW).toBeLessThan(Math.max(plan.frame.lMax, -plan.frame.lMin) - 0.046);
  }, 120000);
});

describe('QA hooks (short browser spot checks)', () => {
  it('liftAim / liftPress (the real input path: Input -> pointerHandlers) / liftState / liftButtons', async () => {
    const P = new Player();
    P.spawn(11.25, 11.0, 0, baseOf(1));
    const {host, rt} = makeHost(towerLayout(), P);
    const input = {mouse: [false, false, false], mousePressed: [false, false, false], pressed: new Set<string>(), keys: new Set<string>()};
    const stats = {shots: 0};
    const qa = towerQaApi({tower: rt, player: P, levels: host.levels, camera: host.camera, input, stats});
    expect(qa.liftButtons()).toHaveLength(25);
    const aim = qa.liftAim('5');
    expect(aim).toMatchObject({ok: true, id: 'car-5', target: 'car-5'});
    expect(aim.prompt).toMatch(/Floor 5/);
    // the press goes into the Input; the next Game frame (emulated: game.ts's line, then the hooks) handles it
    const pending = qa.liftPress('5');
    expect(input.mousePressed[0]).toBe(true);
    const st = {latch: false};
    const gate = gameInput(host, input, st);
    expect(gate.pressed).toBe(false);
    step(host, DT);
    const r = await pending;
    expect(r.pressed).toBe(true);
    expect(r.shotsFired).toBe(0);
    expect(input.mouse[0]).toBe(false); // released
    expect(r.state).toMatchObject({target: 'car-5', queue: ['5']});
    expect((r.state as {lit: string[]}).lit).toContain('car-5');
    expect(rt.lastPress).toEqual({id: 'car-5', via: 'click'});
    // E path
    const pe = qa.liftPress('close', 'key');
    expect(input.pressed.has('KeyE')).toBe(true);
    input.pressed.clear();
    expect(host.interactHandlers[0]()).toBe(true); // what Game.interact() does on KeyE
    expect((await pe).pressed).toBe(true);
    // 'up' / 'down': the station of the player's storey
    P.spawn(12.55, 8.6, 0, baseOf(3));
    expect(qa.liftAim('down')).toMatchObject({ok: true, id: 'hall-3-down'});
    expect(qa.liftAim('nope')).toMatchObject({ok: false});
    expect(qa.liftState()).toMatchObject({elevator: true, target: 'hall-3-down'});
    expect(qa.towerPick(4)).toBe(false); // not in the cab any more
    vi.useRealTimers();
  });
});
