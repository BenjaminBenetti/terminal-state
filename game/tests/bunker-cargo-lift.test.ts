// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2's CARGO LIFT — a large freight car physically travelling one shaft
// through the station and all five shelter storeys (the Office / mall elevator runtime on the Bunker's record: world/towerShared.ts
// readTowerInfo <- gen/bunker/v2/liftPlan.ts bunkerTowerRecord; world/towerRuntime.ts; the freight look in world/elevator.ts).
//  - the record: six stops at the storey floors (station 'S', '1'..'5'), a 4 x 5 m car, a 3.2 m x 2.9 m gate, the car home at the
//    station; the shaft solid on every storey grid, the landing gates cut into the shaft's landing faces;
//  - POWER: without power every button refuses (the reason, nothing moves); with it (all three generators online, the objective's
//    seam) a call opens the gate, the REAL player walks in, rides down continuously carried, walks out on the storey;
//  - riders: a resting pickup and a fuel cart in the car ride along (their storey too); a car torn down mid-run parks at its target
//    with the loose things carried the rest of the way, and placeCar restores a remembered stop;
//  - the freight look: barred car gates (see-through), the shaft liner over every storey (the landings open), painted landing doors.

import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {CAB_SPEED, DOOR_TIME} from '../src/world/elevator';
import {gateWorld, readTowerInfo} from '../src/world/towerShared';
import type {StationLayout} from '../src/gen/stationTypes';
import {levelsOf} from '../src/gen/levels';
import {SOLID} from '../src/gen/grid';
import {WarmupRegistry} from '../src/render/warmup';
import {markShadows} from '../src/render/volumetric';
import {installTower, type TowerHost} from '../src/world/towerRuntime';
import {Player} from '../src/player/player';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {V2, V2_BASES} from '../src/gen/bunker/v2/spine';
import {bunkerTowerRecord} from '../src/gen/bunker/v2/liftPlan';

installCanvasShim(false);

const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
let cached: StationLayout | null = null;
const bunker = (): StationLayout => (cached ??= generateBunkerLevel({levelSeed: 9001}));

function makeHost(layout: StationLayout, player: Player) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  scene.add(camera);
  const toasts: string[] = [];
  const carried: {dy: number; level: number}[] = [];
  const host = {
    scene, camera, player, zombies: [], levels: levelsOf(layout as never), layout, mats, sfx: null,
    hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(),
    atmosphere: {markShadows: (root: THREE.Object3D, s: boolean) => { markShadows(root, true, s); }},
    interactHandlers: [] as (() => boolean)[], pointerHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[],
    stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', warming: false, prepareBeforeShow: async () => {},
    pickups: new PickupManager({}), world: {culler: {enabled: true, register: vi.fn()}},
    // a fuel cart standing in the car (the real FuelCarts.carry is unit-tested in bunker-fuel-sources; here: the call and its dy / storey)
    fuelCarts: {carry: (inside: (x: number, y: number, z: number) => boolean, dy: number, level: number) => { if (inside(cart.x, cart.y, cart.z)) { cart.y += dy; cart.level = level; carried.push({dy, level}); return 1; } return 0; }},
  };
  const cart = {x: 0, y: 0, z: 0, level: 0};
  return {host, toasts, cart, carried};
}

const DT = 1 / 30;
const keys = (...k: string[]) => ({down: (c: string) => k.includes(c), hit: () => false, clears: 0});

describe('the Bunker v2 cargo lift record', () => {
  it('six stops at the storey floors, a large car, a tall gate, home at the station; the shaft solid on every storey grid', () => {
    const L = bunker(), lift = L.bunker!.lift!;
    expect(L.bunker!.version).toBe(2);
    expect(lift.stops.map(s => s.y)).toEqual([...V2_BASES]);
    expect(lift.cab.x1 - lift.cab.x0).toBeCloseTo(4, 5);
    expect(lift.cab.z1 - lift.cab.z0).toBeCloseTo(5, 5);
    expect(lift.door.width).toBeCloseTo(3.2, 5);
    expect(lift.gateHeight).toBeGreaterThanOrEqual(2.8);
    expect(lift.home).toBe(0);
    for (const v of L.levels) for (let y = V2.shaft.y; y < V2.shaft.y + V2.shaft.h; y++) for (let x = V2.shaft.x; x < V2.shaft.x + V2.shaft.w; x++) expect(v.grid.cells[v.grid.idx(x, y)]).toBe(SOLID);
    const info = readTowerInfo(L)!;
    expect(info.elevator?.cargo).toBe(true);
    expect(info.elevator?.home).toBe(0);
    expect(info.elevator?.stops.map(s => s.label)).toEqual(['5', '4', '3', '2', '1', 'S']); // (bottom-up)
    expect(info.windows).toEqual([]);
    expect(bunkerTowerRecord({bunker: {...L.bunker!, lift: undefined}, levels: L.levels})).toBeNull();
  });
});

describe('the cargo lift runtime (real Player): power, a ride down, riders, parking', () => {
  it('unpowered: refuses; powered: call -> open -> walk in -> ride to storey 2 (continuous, carried) -> walk out', () => {
    const layout = bunker();
    const P = new Player();
    const {host, toasts, cart, carried} = makeHost(layout, P);
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    const e = rt.office!.elevator!, L = host.levels, G = e.plan.gate, info = e.plan.info;
    expect(e.plan.doorH).toBeCloseTo(2.9, 5);
    const station = info.stops.find(s => s.floor === 0)!, s2 = info.stops.find(s => s.floor === 2)!;
    expect(e.logic.y).toBe(station.y); // home: the station
    let parked: number[] = [];
    let on = false;
    rt.liftPower = {on: () => on, offline: () => 'NO POWER', park: f => { parked.push(f); }};
    const step = (k: string[]) => { P.update(DT, keys(...k), L, null, {aiming: false, speedMult: 1, canSprint: true}); for (const f of host.frameHooks) f(DT); };
    const inYaw = G.nz > 0 ? 0 : G.nz < 0 ? Math.PI : G.nx > 0 ? Math.PI / 2 : -Math.PI / 2;
    const [lx, lz] = gateWorld(G, G.depth + 0.8, 0);
    P.spawn(lx, lz, inYaw, station.y);
    for (let i = 0; i < 3; i++) step([]);
    // --- unpowered: the call refuses, nothing moves or opens ---
    expect(rt.callFloor(0)).toBe(true);
    for (let t = 0; t < DOOR_TIME + 0.5; t += DT) step([]);
    expect(e.gate.open).toBe(false);
    expect(rt.counts.unpowered).toBe(1);
    expect(toasts.at(-1)).toBe('NO POWER');
    // --- powered: the call opens the gate at the station ---
    on = true;
    expect(rt.callFloor(0)).toBe(true);
    for (let t = 0; t < DOOR_TIME + 0.3; t += DT) step([]);
    expect(e.gate.open).toBe(true);
    // a pickup and a cart in the car
    const inv = new Inventory();
    const cab = info.cab;
    const pk = host.pickups.add(inv.makeStack('bandage', 1), cab.x0 + 0.6, station.y, cab.z1 - 0.8);
    Object.assign(cart, {x: cab.x1 - 0.9, y: station.y, z: cab.z1 - 1.2, level: 0});
    // --- walk in ---
    P.yaw = inYaw;
    for (let i = 0; i < 90 && !rt.playerInCab(); i++) step(['KeyW']);
    for (let i = 0; i < 10; i++) step(['KeyW']);
    expect(rt.playerInCab()).toBe(true);
    for (let i = 0; i < 10; i++) step([]);
    // --- ride down to storey 2: continuous, carried, gate shut while moving ---
    expect(rt.panelPick(2)).toBe(true);
    let moved = false, last = P.y;
    for (let i = 0; i < 30 * 90 && !(moved && !e.logic.moving && e.logic.state === 'open'); i++) {
      step([]);
      if (e.logic.moving) { moved = true; expect(e.gate.open).toBe(false); }
      expect(Math.abs(P.y - last)).toBeLessThanOrEqual(CAB_SPEED * DT + 1e-6);
      expect(P.y).toBeGreaterThanOrEqual(e.logic.y - 1e-6);
      last = P.y;
    }
    expect(moved).toBe(true);
    expect(e.logic.y).toBe(s2.y);
    expect(P.y).toBeCloseTo(s2.y, 5);
    expect(pk.y).toBeCloseTo(s2.y, 3); // the pickup rode along
    expect(cart.y).toBeCloseTo(s2.y, 5);
    expect(cart.level).toBe(2);
    expect(carried.length).toBeGreaterThan(10);
    // --- walk out onto storey 2 ---
    P.yaw = inYaw + Math.PI;
    for (let i = 0; i < 90 && rt.playerInCab(); i++) step(['KeyW']);
    for (let i = 0; i < 15; i++) step(['KeyW']);
    expect(rt.playerInCab()).toBe(false);
    const sup = L.supportAt(P.x, P.z, P.y + 0.3);
    expect(sup?.floor).toBeCloseTo(V2_BASES[2], 3);
    // --- send it back up empty and tear the world down mid-run: it parks at its target, the loose things carried there ---
    const cart2 = {x: cab.x0 + 1, y: s2.y, z: cab.z0 + 1.5};
    Object.assign(cart, {...cart2, level: 2});
    expect(rt.callFloor(0)).toBe(true);
    for (let i = 0; i < 30 * 8 && !e.logic.moving; i++) step([]);
    for (let i = 0; i < 30 * 2; i++) step([]);
    expect(e.logic.moving).toBe(true);
    parked = [];
    host.sectionHooks[0].teardown!();
    expect(parked).toEqual([0]);
    expect(pk.y).toBeCloseTo(station.y, 3);
    expect(cart.y).toBeCloseTo(station.y, 5);
    expect(rt.counts.parked).toBe(1);
  });

  it('placeCar restores a remembered stop (gates shut); the freight look: barred gates, the shaft liner over every storey', () => {
    const layout = bunker();
    const {host} = makeHost(layout, new Player());
    const rt = installTower(host as unknown as TowerHost);
    host.sectionHooks[0].build!(layout);
    expect(rt.placeCar(3)).toBe(true);
    const e = rt.office!.elevator!;
    expect(e.logic.y).toBe(V2_BASES[3]);
    expect(e.vol.floorY).toBe(V2_BASES[3]);
    expect(e.vol.level).toBe(3);
    expect(e.gate.open).toBe(false);
    expect(rt.placeCar(9)).toBe(false);
    const root = e.view.root;
    const liner = root.getObjectByName('tower-shaft-liner') as THREE.Mesh;
    expect(liner).toBeTruthy();
    expect(liner.userData.levels).toEqual([5, 4, 3, 2, 1, 0]);
    const bars = e.view.cab.getObjectByName('tower-door-cab-l') as THREE.Mesh;
    expect((bars.material as THREE.Material).name).toBe('cargo-gate-bars');
    // barred: many separate bars (a see-through gate), not a slab
    expect((bars.geometry.getAttribute('position').count)).toBeGreaterThan(24 * 10);
    const door = e.view.landings[0].getObjectByName('tower-door-landing-l') as THREE.Mesh;
    expect((door.material as THREE.Material).name).toBe('cargo-landing-door');
    expect(e.view.cab.getObjectByName('tower-cab-handrail')).toBeUndefined();
  });
});
