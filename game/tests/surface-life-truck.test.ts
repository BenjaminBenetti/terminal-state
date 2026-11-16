// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE, follow-up 1): the district LIFE systems against lane TRUCK's REAL
// truck (the vehicle controller with the truck definition: tests/helpers/surfaceTruckHost.ts, the same host lane TRUCK's tests use):
//  - the planning map's truck marker IS the truck's transform (truckTransform), parked and on the move; seated, the player marker faces
//    the truck's way; CARGO's truck line anchors at it;
//  - the outdoor replenisher keeps its spawns clear of the truck by the truck's real plan size (lane TRUCK's spec), following it;
//  - the map table refuses [E] while the player sits in the truck seat, and offers it again once out.
import {describe, expect, it} from 'vitest';
import {press, run} from './helpers/skywaysCarHost';
import {getInTruck, stopTruck, truckHost} from './helpers/surfaceTruckHost';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {surfaceKeyOf} from '../src/gen/surface/surfaceRun';
import {createRun} from '../src/run/runState';
import {TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {buildPlanningMap, refHolds, vehiclePoseOf} from '../src/world/surface/mapModel';
import {exploreGridFor} from '../src/world/surface/mapExplore';
import {SurfaceMapRuntime} from '../src/world/surface/mapRuntime';
import {cargoViewOf, type MapSourceHost} from '../src/world/surface/mapSources';
import {OutdoorReplenisher, REPLENISH, truckCircleOf, viewerOf, type ReplenishHost} from '../src/world/surface/replenish';

const district = () => {
  const layout = LEVELS.subway.generate('surface', {levelSeed: 7}) as StationLayout;
  return {layout, s: layout.surface as SurfaceInfo};
};

/** The planning-map runtime on a real district, its game holding the REAL truck controller as game.skywaysCar. */
function mapGame(layout: StationLayout, car: unknown) {
  const s = layout.surface!, r = s.checkpoint.mapTable.read;
  const key = surfaceKeyOf({level: 'subway', section: 'main', station: 'st-1'});
  const runState = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 5, skyways: 6, reactor: 7}, start: key, levels: LEVELS});
  runState.current = key;
  const player = {x: r.x, z: r.z, y: r.y, eye: r.y + 1.6, yaw: r.yaw, pitch: -0.5, alive: true};
  const game = {
    run: runState, layout, player, state: 'playing', zombies: [], containers: null, skywaysCar: car,
    levels: {areaAt: () => -1}, scene: {add() {}},
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[], interactHandlers: [] as (() => boolean)[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: string) => void)[],
    layoutIndexOf: () => undefined, input: {down: () => false, suppressUntilRelease() {}},
    setState(st: string) { this.state = st; }, enterPlay() { this.state = 'playing'; return Promise.resolve(); },
  };
  const rt = new SurfaceMapRuntime(game as never).install();
  for (const hk of game.sectionHooks) hk.build?.(layout);
  const tick = () => { for (const f of game.frameHooks) f(0.016); };
  return {game, rt, player, tick};
}

describe('Surface Run life against the real truck', () => {
  it('the map marker is the truck transform, parked and on the move; seated, the player faces its way; the cargo line anchors at it', () => {
    const {h, car} = truckHost(); // parked at (8, 15), forward +X
    expect(car.vehicle).toBe('truck');
    expect(car.spec).toBe(TRUCK_SPEC);
    const t0 = {...car.truckTransform()!}; // (a copy: the controller reuses its transform object)
    expect(vehiclePoseOf(car)).toEqual({x: t0.x, z: t0.z, yaw: t0.yaw});
    const {layout, s} = district();
    const marker = () => buildPlanningMap(s, {explore: exploreGridFor(s.extent), entered: new Set(), truck: vehiclePoseOf(car)}).markers.find(k => k.kind === 'truck')!;
    expect(marker()).toMatchObject({x: t0.x, z: t0.z, yaw: t0.yaw, label: 'Truck'});
    expect(refHolds(s, marker().ref, marker().x, marker().z)).toBe(true);
    // the runtime's own model (game.skywaysCar = the real controller)
    const {rt, player} = mapGame(layout, car);
    expect(rt.model()!.markers.find(k => k.kind === 'truck')).toMatchObject({x: t0.x, z: t0.z});
    // in the seat and driving forward: the marker follows the truck; the player marker faces the truck's way
    getInTruck(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 1.5);
    h.keys.held.clear();
    const t1 = {...car.truckTransform()!};
    expect(t1.x).toBeGreaterThan(t0.x + 1);
    const m1 = rt.model()!;
    expect(m1.markers.find(k => k.kind === 'truck')).toMatchObject({x: t1.x, z: t1.z, yaw: t1.yaw});
    player.yaw = t1.yaw + 1.2; // (the seated look turned away from the heading)
    expect(rt.model()!.markers.find(k => k.kind === 'player')!.yaw).toBeCloseTo(t1.yaw, 9);
    // CARGO's truck line anchors where the truck stands
    const host = {layout, run: {laneStore: () => undefined}, trainEquipment: null, skywaysCar: car} as unknown as MapSourceHost;
    expect(cargoViewOf(host)!.truck).toEqual({x: t1.x, z: t1.z});
    stopTruck(h, car);
  });

  it("the replenisher keeps spawns clear of the truck by the truck's real plan size, and the clearance follows it", () => {
    const {h, car} = truckHost();
    const c0 = truckCircleOf(car)!;
    expect(c0.r).toBeCloseTo(Math.hypot(TRUCK_SPEC.length, TRUCK_SPEC.width) / 2, 9); // (~4 m: the 7.5 x 2.6 m truck)
    expect(c0).toMatchObject({x: car.truckTransform()!.x, z: car.truckTransform()!.z});
    // a permissive district: everything standable, nothing in sight (the viewer 50 m south, looking further south)
    const viewer = viewerOf({x: c0.x, y: 1.6, z: c0.z + 50}, Math.PI, 0, 75, 16 / 9);
    const rep = new OutdoorReplenisher<{brain: {x: number; y: number; z: number; alive: boolean}}>({
      spawn: () => null, remove: () => {}, viewer: () => viewer, lineOfSight: () => false, standable: () => ({floor: 0, area: 0}),
      truck: () => truckCircleOf(car), active: () => true,
    } as ReplenishHost<{brain: {x: number; y: number; z: number; alive: boolean}}>, {zones: [], safe: null, footprints: [], extent: {x0: -200, z0: -200, x1: 200, z1: 200}}, {seed: 1, visit: 1, pool: [['zombie', 1]], coatedChance: 0});
    const keep = c0.r + REPLENISH.truckKeepM;
    expect(rep.check(viewer, c0.x + keep - 0.2, c0.z)).toEqual({ok: false, why: 'truck'});
    expect(rep.check(viewer, c0.x, c0.z)).toEqual({ok: false, why: 'truck'});
    expect(rep.check(viewer, c0.x + keep + 0.3, c0.z).ok).toBe(true);
    // the truck drives forward (+X): the clearance moves with it
    getInTruck(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 1.5);
    h.keys.held.clear();
    const c1 = truckCircleOf(car)!;
    expect(c1.x).toBeGreaterThan(c0.x + 1);
    expect(rep.check(viewer, c0.x + keep + 0.3, c0.z)).toEqual({ok: false, why: 'truck'}); // (clear of the parked truck, not of the moved one)
    for (const dx of [keep + 0.3, keep + 2, keep + 4]) {
      const x = c0.x + dx, near = Math.hypot(x - c1.x, c0.z - c1.z) < c1.r + REPLENISH.truckKeepM;
      expect(rep.check(viewer, x, c0.z).ok).toBe(!near);
    }
    stopTruck(h, car);
  });

  it('the map table refuses [E] while the player sits in the truck seat, and offers it again once out', () => {
    const {h, car} = truckHost();
    const {layout} = district();
    const {rt, tick, game} = mapGame(layout, car);
    tick();
    expect(rt.prompt).toMatch(/planning map/); // aimed from the read pose, on foot
    getInTruck(h, car);
    expect(car.driving).toBe(true);
    tick();
    expect(rt.prompt).toBeNull();
    expect(game.interactHandlers.some(f => f())).toBe(false); // nothing opens from the seat
    expect(game.state).toBe('playing');
    stopTruck(h, car);
    press(h, car, 'KeyE'); // out of the seat (the map player never moved: only the seat changed)
    expect(car.driving).toBe(false);
    tick();
    expect(rt.prompt).toMatch(/planning map/);
  });
});
