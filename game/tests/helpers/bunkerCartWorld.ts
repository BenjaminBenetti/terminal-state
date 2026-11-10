// Task studio-fuel-cart-stairs-20261110-004505-01: ONE Node host with everything a fuel cart meets in a Bunker, installed in Game's
// order on the fuel-cart test host (tests/helpers/fuelCartsHost.ts stationHost: the REAL FuelCarts, parked PlayerTrainRuntime,
// TrainRide and Player): + the REAL lift runtime (world/towerRuntime.ts) and the REAL Bunker objective (world/bunker/objective.ts:
// generators as hose targets, the turnkey, the lift's power) over the save fixture's RunState / Inventory. No browser, no renderer.

import * as THREE from 'three';
import type {Game} from '../../src/game';
import type {StationLayout} from '../../src/gen/stationTypes';
import {WorldMaterials} from '../../src/world/materials';
import {markShadows} from '../../src/render/volumetric';
import {PickupManager} from '../../src/world/pickups';
import {installTower, type TowerHost, type TowerRuntime} from '../../src/world/towerRuntime';
import {installBunkerObjective, type BunkerObjective} from '../../src/world/bunker/objective';
import type {CampaignState} from '../../src/campaign/types';
import {stationFuelPlan} from '../../src/fuel/fuel';
import {FuelStations} from '../../src/world/fuelStations';
import {fakeEnvTextures} from './openablesFixture';
import {Harness, fixtureCampaign, sid} from './saveFixture';
import {build, stationHost, teardown, type CartTestHost} from './fuelCartsHost';
import {CartBot} from './cartBot';

let mats: WorldMaterials | null = null;

export interface BunkerCartWorld {
  h: CartTestHost;
  carts: ReturnType<typeof stationHost>['carts'];
  rt: ReturnType<typeof stationHost>['rt'];
  tower: TowerRuntime;
  objective: BunkerObjective;
  harness: Harness;
  /** The station fuel coordinator (opts.coordinator), else null. */
  stations: FuelStations | null;
  bot: CartBot;
  toasts: string[];
  /** Game.buildSection's tail / Game.leaveSection's hooks. */
  build(): void;
  teardown(): void;
}

/** The station key the fixture campaign stands at (its section memory holds the objective's record). */
export const BUNKER_STATION = sid(3);

/**
 * A fixture campaign standing at BUNKER_STATION (a Bunker node) whose fuel plan for it carries the optional station cart (a
 * deterministic search over the network seed: fuel/fuel.ts stationFuelPlan).
 */
export function cartStationCampaign(): CampaignState {
  const c = fixtureCampaign({current: BUNKER_STATION, known: [sid(0), sid(1), sid(2), BUNKER_STATION, sid(4)], visited: [sid(0), sid(1), sid(2)]});
  const node = c.network.nodes.find(n => n.id === BUNKER_STATION)!;
  (node as {archetype: string}).archetype = 'bunker';
  let seed = 1;
  while (stationFuelPlan(seed, BUNKER_STATION).cart === 0) seed++;
  (c.network as {seed: number}).seed = seed;
  return c;
}

export function bunkerCartWorld(layout: StationLayout, opts: {campaign?: CampaignState | null; coordinator?: boolean} = {}): BunkerCartWorld {
  const s = stationHost(layout, {build: false});
  const h = s.h;
  const campaign = opts.campaign === undefined ? fixtureCampaign({current: BUNKER_STATION, known: [sid(0), sid(1), sid(2), BUNKER_STATION, sid(4)], visited: [sid(0), sid(1), sid(2), BUNKER_STATION]}) : opts.campaign;
  const harness = new Harness(campaign);
  if (!opts.coordinator) harness.run.memory().visits = 1;
  mats ??= new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  let clock = 0;
  const base = h.sfx as Record<string, unknown>;
  Object.assign(h, {
    mats,
    pointerHandlers: [] as (() => boolean)[],
    sectionModelKeys: [] as ((l: StationLayout) => readonly string[])[],
    input: h.keys,
    consumeView: {busy: false}, gasMask: {transitioning: false},
    hud: {toast: (t: string) => { h.toasts.push(t); }, setHoldRing: () => {}},
    sfx: {...base, stopFuelPour: () => {}, reactorCue: () => {}, reactorLoop: () => ({stop() {}, playing: true})},
    syncHeld: () => {},
    propModels: {get: () => undefined},
    atmosphere: {markShadows: (root: THREE.Object3D, st: boolean) => { markShadows(root, true, st); }, addSmokeEmitter: () => ({id: 1, alive: true, emitting: true, setPos() {}, stop() {}})},
    fuelPort: {heldObj: null},
    fuelCarts: s.carts,
    pickups: new PickupManager({}),
    warming: false, prepareBeforeShow: async () => {},
  });
  Object.defineProperty(h, 'clock', {get: () => clock, configurable: true});
  Object.defineProperty(h, 'inv', {get: () => harness.inv, configurable: true});
  Object.defineProperty(h, 'run', {get: () => harness.run, configurable: true});
  h.frameHooks.unshift(dt => { clock += dt; });
  // the station's fuel coordinator (world/fuelStations.ts: the plan's cart, FUEL_LANE at a teardown), hooks before the carts' (Game's order)
  let stations: FuelStations | null = null;
  if (opts.coordinator) {
    stations = new FuelStations(h as never).install();
    h.sectionHooks.unshift(h.sectionHooks.pop()!);
  }
  const tower = installTower(h as unknown as TowerHost);
  (h as unknown as {tower: TowerRuntime}).tower = tower;
  const objective = installBunkerObjective(h as unknown as Game);
  const bot = new CartBot(h, s.carts, () => ({levels: h.levels!, props: h.propIndex}));
  const w: BunkerCartWorld = {
    h, carts: s.carts, rt: s.rt, tower, objective, harness, bot, toasts: h.toasts, stations,
    build: () => { build(h, layout); bot.cache.clear(); },
    teardown: () => teardown(h),
  };
  w.build();
  return w;
}
