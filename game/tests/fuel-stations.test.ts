// Task studio-beta-train-fuel-system-20261106-024923-01: WHERE a station's fuel lies (gen/fuelPlacement.ts) on real generated layouts of
// every archetype, and the station coordinator (world/fuelStations.ts): the plan realized ONCE as ordinary pickups (+ a cart), finite,
// remembered through the section memory; the map's figures (planned / remaining / live); an older save's station realized once.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {LevelId, SectionKey} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {FUEL_PLACE, cartDistance, placeStationFuel} from '../src/gen/fuelPlacement';
import {levelDistance} from '../src/gen/levelGen';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {FUEL, FUEL_LANE, stationFuelPlan, type FuelPlan} from '../src/fuel/fuel';
import {FuelStations} from '../src/world/fuelStations';
import {createRun} from '../src/run/runState';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';

const gen = (level: LevelId, seed: number): StationLayout => LEVELS[level].generate('main', {levelSeed: seed, startWeapon: 'pistol'});
const LAYOUTS: [string, StationLayout][] = [
  ['subway 101', gen('subway', 101)], ['subway 4242', gen('subway', 4242)], ['office', gen('office', 0x5ea1e55)], ['mall', gen('mall', 77)], ['reactor', gen('reactor', 0x70)],
];
const CANS: FuelPlan = {units: 6, cans: 6, cart: 0};
const CART: FuelPlan = {units: 8, cans: 0, cart: 8};

function doorCell(l: StationLayout) {
  const tp = playerTrainPlacement(l)!;
  const doors = PLAYER_TRAIN_SPEC.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const w = trainToWorld(tp, doors[Math.floor(doors.length / 2)], PLAYER_TRAIN_SPEC.floorY, -(PLAYER_TRAIN_SPEC.width / 2 + 0.75));
  return {tp, cell: l.grid.cellOf(w.x, w.z)};
}

describe('fuel placement on real layouts (every archetype)', () => {
  it.each(LAYOUTS)('%s: exactly the planned cans, reachable from the train, away from the car, deterministic', (_n, l) => {
    const p = placeStationFuel(l, CANS, 'st-07');
    expect(p).toEqual(placeStationFuel(l, CANS, 'st-07'));
    expect(p.cart).toBeNull();
    expect(p.cans.reduce((s, c) => s + c.count, 0)).toBe(6);
    for (const c of p.cans) expect(c.count === 1 || c.count === 2).toBe(true);
    const levels = l.levels?.length ? l.levels : [{id: 0, role: 'main' as const, grid: l.grid, baseY: 0}];
    const {tp, cell} = doorCell(l);
    const dist = levelDistance(levels, cell[0], cell[1], tp.level);
    const keys = new Set<string>();
    for (const c of p.cans) {
      const g = levels[c.level].grid, [x, y] = g.cellOf(c.x, c.z), i = g.idx(x, y);
      expect(g.walkable(x, y)).toBe(true);
      expect(dist[c.level][i]).toBeGreaterThanOrEqual(0); // reachable on foot from the train door
      if (c.level === tp.level) expect(Math.hypot(c.x - tp.x, c.z - tp.z)).toBeGreaterThanOrEqual(FUEL_PLACE.cartFromTrain + 2 - 1e-6);
      keys.add(`${c.level}:${i}`);
    }
    expect(keys.size).toBe(p.cans.length);
    expect(placeStationFuel(l, CANS, 'st-08')).not.toEqual(p); // another station id: another draw
  });

  it.each(LAYOUTS)('%s: a cart station gets a cart a wheeled cart can roll to the train door (or its units as cans: never lost)', (_n, l) => {
    const p = placeStationFuel(l, CART, 'st-11');
    const {tp, cell} = doorCell(l);
    if (p.cart) {
      expect(p.cans).toEqual([]);
      expect(p.cart.level).toBe(tp.level);
      const g = (l.levels?.[tp.level]?.grid) ?? l.grid;
      const d = cartDistance(g, cell[0], cell[1]);
      const [x, y] = g.cellOf(p.cart.x, p.cart.z);
      expect(d[g.idx(x, y)]).toBeGreaterThanOrEqual(0);
      const gap = Math.hypot(Math.max(0, Math.abs(p.cart.x - tp.x) - tp.length / 2), Math.max(0, Math.abs(p.cart.z - tp.z) - tp.width / 2));
      expect(gap).toBeGreaterThanOrEqual(FUEL_PLACE.cartFromTrain - 1e-6);
    } else {
      expect(p.cans.reduce((s, c) => s + c.count, 0)).toBe(FUEL.cartUnits);
    }
  });

  it('most real stations place the cart itself (a fallback to cans is the exception)', () => {
    const placed = LAYOUTS.filter(([, l]) => placeStationFuel(l, CART, 'st-11').cart).length;
    expect(placed).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/** A Game shell with exactly what FuelStations touches. */
function shell(at = 0) {
  const camp = fixtureCampaign({current: sid(at), known: [sid(0), sid(1), sid(2)], visited: [sid(at)]});
  const key: SectionKey = {level: 'subway', section: 'main', station: sid(at)};
  const run = createRun({seeds: SEEDS, start: key, levels: LEVELS, campaign: camp});
  const list: {stack: ItemStack; x: number; y: number; z: number}[] = [];
  const g = {
    run, inv: new Inventory(), sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[], world: {},
    pickups: {list, add: (stack: ItemStack, x: number, y: number, z: number) => { list.push({stack, x, y, z}); return {}; }},
  };
  const fs = new FuelStations(g as never).install();
  return {g, fs, list, key, run};
}

describe('the station coordinator (world/fuelStations.ts)', () => {
  const l = gen('subway', 101);

  it('first build realizes the plan once (fuel cans as ordinary pickups); the record is written at teardown; a realized station adds nothing', () => {
    const {g, fs, list, key, run} = shell();
    const plan = stationFuelPlan(run.campaign!.network.seed, sid(0));
    run.memory(key);
    fs.build(l);
    const units = list.filter(p => p.stack.itemId === FUEL.canItem).reduce((s, p) => s + p.stack.count, 0);
    expect(units).toBe(plan.units); // (no cart system in this shell: a cart's units come as cans)
    expect(run.laneStore(FUEL_LANE, key)).toBeUndefined(); // not before the station's memory is flushed (saves before a departure regenerate the same)
    expect(fs.nodeFuel(sid(0))).toEqual({units: plan.units, source: 'live'});
    for (const h of g.sectionHooks) h.teardown?.();
    expect(run.laneStore(FUEL_LANE, key)).toEqual({v: 1, realized: true, carts: []});
    list.length = 0;
    fs.build(l);
    expect(list).toEqual([]); // realized: finite — the remembered cans come back through the section memory, never a second plan
  });

  it('the map figures: planned for a known unvisited station, remaining from a visited station\'s memory, live here', () => {
    const {g, fs, list, key, run} = shell();
    run.memory(key);
    fs.build(l);
    // the player took all but one can, then left: the memory holds what is left
    const left = list.find(p => p.stack.itemId === FUEL.canItem)!;
    left.stack.count = 1;
    run.memory(key).pickups = [{stack: {itemId: FUEL.canItem, count: 1}, pose: {p: [left.x, left.y, left.z], q: [0, 0, 0, 1]}, anchor: [left.x, left.y, left.z]}];
    for (const h of g.sectionHooks) h.teardown?.();
    (g as {world: unknown}).world = null;
    expect(fs.nodeFuel(sid(0))).toEqual({units: 1, source: 'remaining'});
    const planned = stationFuelPlan(run.campaign!.network.seed, sid(2));
    expect(fs.nodeFuel(sid(2))).toEqual({units: planned.units, source: 'planned'});
    expect(planned.units).toBeGreaterThanOrEqual(FUEL.stationMinUnits);
  });

  it('an older save\'s visited station (memory but no fuel record) realizes its plan once on its next build, ordinary loot untouched', () => {
    const {fs, list, key, run} = shell();
    const mem = run.memory(key);
    mem.visits = 3;
    mem.pickups = [{stack: {itemId: 'water', count: 1}, pose: {p: [1, 0, 1], q: [0, 0, 0, 1]}, anchor: [1, 0, 1]}];
    const before = JSON.stringify(mem.pickups);
    expect(fs.nodeFuel(sid(0))?.source).toBe('planned'); // (until it is built again)
    fs.build(l);
    expect(list.filter(p => p.stack.itemId === FUEL.canItem).length).toBeGreaterThan(0);
    expect(JSON.stringify(mem.pickups)).toBe(before);
  });

  it('outside a campaign nothing is realized', () => {
    const {fs, list, run} = shell();
    (run as {campaign: unknown}).campaign = null;
    fs.build(l);
    expect(list).toEqual([]);
    expect(fs.nodeFuel(sid(0))).toBeNull();
  });
});
