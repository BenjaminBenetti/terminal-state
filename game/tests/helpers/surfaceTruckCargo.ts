// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK, follow-up 1): a Node host with the REAL truck AND the REAL district cargo
// on a GENERATED district — no fake truck (helpers/surfaceCargoHost.ts FakeTruck is CARGO's stand-in): the train equipment room
// (helpers/trainEquipmentHost.ts equipRoom: the real TrainEquipmentSystem, fuel carts, Player, RunState, Inventory) dressed as the vehicle
// controller's host (helpers/skywaysCarHost.ts: the fakes it reads of other lanes), then the vehicle controller + the truck (Game's
// installSurfaceTruck: addVehicle(TRUCK_DEF) + the storage compartments) and the district cargo (world/surface/cargo.ts) installed, and
// every registry put back into GAME's install order (fuel carts -> vehicle controller -> district cargo -> truck storage -> equipment:
// the equipment's busy [E] handler first, its section / frame hooks last). The truck is found by the cargo exactly as in Game:
// `game.skywaysCar.truckAttachPoints` (world/surface/cargoTypes.ts truckCargoSource).
import * as THREE from 'three';
import {PropIndex} from '../../src/core/physics';
import type {Levels} from '../../src/gen/levels';
import type {PropPlacement} from '../../src/gen/props';
import {SkywaysCar} from '../../src/world/skywaysCar';
import {SurfaceCargo} from '../../src/world/surface/cargo';
import {installSurfaceTruck, type TruckStorageSystem} from '../../src/world/surface/truckStorage';
import {flatRoom} from './fuelCartsHost';
import {equipRoom, type EquipTestHost} from './trainEquipmentHost';
import {DISTRICT, STATION} from './surfaceCargoHost';
import {paneRefs, type CarTestHost} from './skywaysCarHost';
import type {District} from './surfaceTruckDistrict';

export type TruckCargoHost = EquipTestHost & CarTestHost & {skywaysCar: SkywaysCar};

/** Move `item` to the end (`first`: to the front) of a registry. */
function move<T>(list: T[], item: T, first = false): void {
  const i = list.indexOf(item);
  if (i < 0) throw new Error('registry entry not found');
  list.splice(i, 1);
  if (first) list.unshift(item); else list.push(item);
}

/** The generated district `D` with the real truck at its generated pose and the depot's recoverables seeded (the district entered). */
export function truckCargoWorld(D: District) {
  const s = equipRoom(D.levels);
  const h = s.h as unknown as TruckCargoHost, eq = s.eq;
  // the equipment's own entries (installed last of all in Game): remembered by reference before the others go in
  const eqSection = h.sectionHooks.at(-1)!, eqFrame = h.frameHooks.at(-1)!, eqInteract = h.interactHandlers.at(-1)!, eqBusy = h.interactHandlers[0];
  const eqPrompt = h.promptProviders.at(-1)!, eqBusyPrompt = h.promptProviders[0], eqBullet = (h.bulletHitHandlers as unknown[]).at(-1);
  // what the vehicle controller reads of Game (the car host's fakes: helpers/skywaysCarHost.ts carHost)
  const kills: CarTestHost['kills'] = [], shoves: CarTestHost['shoves'] = [], propHits: CarTestHost['propHits'] = [], broken: string[] = [];
  const windows = paneRefs([]);
  (h.keys as unknown as {mousePressed: boolean[]}).mousePressed = [false, false, false];
  const sfx = h.sfx as Record<string, unknown>;
  Object.assign(sfx, {
    physImpact: (_x: number, _y: number, _z: number, v: number, fam: string) => { h.sfxCalls.push(`physImpact:${fam}:${v.toFixed(1)}`); },
    carEngine: () => {}, stopCarEngine: () => {}, carSkid: () => true, carDoor: () => { h.sfxCalls.push('door'); },
  });
  Object.assign(h, {
    frameNo: 0, store: new Map(), engineLog: [], kills, shoves, propHits, broken, windows, fx: null, use: null,
    damage: {hitWorld: (wh: {prop: number}, _p: THREE.Vector3, _d: THREE.Vector3, shot: {damage: number}) => { propHits.push({prop: wh.prop, damage: shot.damage}); return {}; }},
    gas: {windows: null, breakPane: () => false},
    blastKill: (z: CarTestHost['zombies'][number], dir: THREE.Vector3, point: THREE.Vector3) => { kills.push({z, dir: dir.clone(), point: point.clone()}); z.ragdolled = true; },
  });
  (h.physics as unknown as Record<string, unknown>).dynamicItems = {
    walkers: null,
    shootProp(prop: PropPlacement, index: number, _p: THREE.Vector3, _d: THREE.Vector3, impulse: number) { shoves.push({prop, index, impulse, t: h.frameNo}); prop.h = 0; return true; },
    rayHits: () => [],
  };
  // Game's order: the vehicle controller, the district cargo, the truck (its definition + storage), then (already in) the equipment
  const car = new SkywaysCar(h).install();
  h.skywaysCar = car;
  const cargo = new SurfaceCargo(h as never).install();
  const storage: TruckStorageSystem = installSurfaceTruck(h as never);
  move(h.sectionHooks, eqSection);
  move(h.frameHooks, eqFrame);
  move(h.interactHandlers, eqInteract);
  move(h.interactHandlers, eqBusy, true);
  move(h.promptProviders, eqPrompt);
  move(h.promptProviders, eqBusyPrompt, true);
  if (eqBullet) move(h.bulletHitHandlers as unknown[], eqBullet);
  const w = {h, eq, car, cargo, storage, D, propIndex: new PropIndex(D.levels, D.L.props)};
  // equipRoom built the flat room as "the station": leave it and enter the district
  leave(w);
  enterDistrict(w);
  return w;
}
export type TruckCargoWorld = ReturnType<typeof truckCargoWorld>;

/** Game.buildSection's hook pass for the generated district (the level fields, then every section hook with its layout). */
export function enterDistrict(w: TruckCargoWorld): void {
  const h = w.h;
  h.run.current = {...DISTRICT};
  Object.assign(h, {layout: w.D.L, levels: w.D.levels, propIndex: w.propIndex, trainPlacement: null});
  for (const x of h.sectionHooks) x.build?.(w.D.L as never);
}

/** The station side of a crossing: the flat room with no district (no truck, no cargo points) — what a station build gives them. */
export function enterStation(w: TruckCargoWorld): void {
  const h = w.h, levels: Levels = flatRoom(), layout = {props: [] as PropPlacement[]};
  h.run.current = {...STATION};
  Object.assign(h, {layout, levels, propIndex: new PropIndex(levels, layout.props), trainPlacement: null});
  for (const x of h.sectionHooks) x.build?.(layout as never);
}

/** Every teardown hook (Game.teardownSection). */
export function leave(w: TruckCargoWorld): void {
  for (const x of w.h.sectionHooks) x.teardown?.();
}
