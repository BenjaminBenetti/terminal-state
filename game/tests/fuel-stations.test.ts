// Task studio-beta-train-fuel-system-20261106-024923-01 + task studio-beta-fuel-feedback-20261106-064128-01: WHERE a station's fuel lies
// on real generated layouts of every archetype — as ordinary LOOT LOTS in shelves / counters / storage (gen/fuelHolders.ts: free room
// only, beside the holder's own rolled lots; one can per lot), loose single cans only as the fallback (gen/fuelPlacement.ts) — and the
// station coordinator (world/fuelStations.ts) driven in Game's order (holders built -> fuel lots -> section memory -> pickups -> build
// hooks; teardown -> memory flush): the v2 plan realized ONCE, finite and remembered (taken lots stay taken, nothing refills), the map's
// figures (planned / remaining / live), a v1 save's station topped up by ONE additive delta, and ONE visible can = ONE can.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import type {LevelId, SectionKey} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {FUEL_PLACE, cartDistance, placeStationFuel} from '../src/gen/fuelPlacement';
import {FUEL_HOLDERS, chooseFuelSlots, fuelHolderSlots, type FuelHolderIn} from '../src/gen/fuelHolders';
import {levelDistance} from '../src/gen/levelGen';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {FUEL, FUEL_LANE, parseFuelLotKey, stationFuelPlan, stationFuelPlanV1, stationFuelProblem, type FuelPlan, type StationFuelJSON} from '../src/fuel/fuel';
import {FuelStations} from '../src/world/fuelStations';
import {ContainerManager} from '../src/world/containers';
import {PickupManager} from '../src/world/pickups';
import {WorldMaterials} from '../src/world/materials';
import {createRun, type RunState} from '../src/run/runState';
import {applyHolders, captureHolders, capturePickups, holderKeyOf, restorePickup} from '../src/run/worldMemory';
import {Inventory} from '../src/items/inventory';
import {placementBox} from '../src/items/lootLayout';
import {takeLot} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

const gen = (level: LevelId, seed: number): StationLayout => LEVELS[level].generate('main', {levelSeed: seed, startWeapon: 'pistol'});
const LAYOUTS: [string, LevelId, StationLayout][] = [
  ['subway 101', 'subway', gen('subway', 101)], ['subway 4242', 'subway', gen('subway', 4242)], ['office', 'office', gen('office', 0x5ea1e55)],
  ['mall', 'mall', gen('mall', 77)], ['reactor', 'reactor', gen('reactor', 0x70)],
];
const CANS: FuelPlan = {units: 6, cans: 6, cart: 0};
const CART: FuelPlan = {units: 8, cans: 0, cart: 8};
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

function doorCell(l: StationLayout) {
  const tp = playerTrainPlacement(l)!;
  const doors = PLAYER_TRAIN_SPEC.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const w = trainToWorld(tp, doors[Math.floor(doors.length / 2)], PLAYER_TRAIN_SPEC.floorY, -(PLAYER_TRAIN_SPEC.width / 2 + 0.75));
  return {tp, cell: l.grid.cellOf(w.x, w.z)};
}

function holdersOf(l: StationLayout, level: LevelId, inv = new Inventory()) {
  const cm = new ContainerManager({}, mats, () => inv);
  cm.build(l, {}, lootProfile(level));
  const ins: FuelHolderIn[] = cm.all.map(h => ({key: holderKeyOf(h), kind: h.kind, index: h.index, area: h.prop.area, level: h.prop.level ?? 0, x: h.prop.x, z: h.prop.z, surfaces: h.surfaces, lots: h.state.lots}));
  return {cm, ins};
}

describe('fuel cans as loot lots in shelves / counters / storage (gen/fuelHolders.ts, every archetype)', () => {
  it.each(LAYOUTS)('%s: free room only, inside the surface, clear of the rolled lots, reachable, away from the car, deterministic', (_n, level, l) => {
    const {ins} = holdersOf(l, level);
    const slots = fuelHolderSlots(l, ins, 'st-07');
    expect(fuelHolderSlots(l, ins, 'st-07')).toEqual(slots);
    expect(fuelHolderSlots(l, ins, 'st-08').map(s => s.key)).not.toEqual(slots.map(s => s.key)); // another station: another order
    expect(slots.length).toBeGreaterThanOrEqual(60);
    const tp = playerTrainPlacement(l)!, byKey = new Map(ins.map(h => [h.key, h]));
    const keys = new Set<string>();
    for (const s of slots) {
      const h = byKey.get(s.holder)!;
      expect(FUEL_HOLDERS.kinds[h.kind]).toBeGreaterThan(0);
      expect(s.lot).toMatchObject({itemId: FUEL.canItem, count: 1}); // ONE can per lot
      expect(s.lot.id % 1000).toBeGreaterThanOrEqual(FUEL_HOLDERS.lotBase);
      expect(Math.floor(s.lot.id / 1000)).toBe(h.index);
      expect(h.lots.some(r => r.id === s.lot.id)).toBe(false); // never a rolled lot's id
      expect(keys.has(s.key)).toBe(false);
      keys.add(s.key);
      const surf = h.surfaces[s.lot.surface], b = placementBox(FUEL.canItem, s.lot);
      expect(b.min[0]).toBeGreaterThanOrEqual(surf.x0 - 1e-6);
      expect(b.max[0]).toBeLessThanOrEqual(surf.x1 + 1e-6);
      expect(b.min[2]).toBeGreaterThanOrEqual(surf.z0 - 1e-6);
      expect(b.max[2]).toBeLessThanOrEqual(surf.z1 + 1e-6);
      expect(b.min[1]).toBeCloseTo(surf.y, 6); // resting ON the surface (not floating, not sunk)
      expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(surf.clear); // fits under the next tier / lid
      if (surf.part !== undefined) expect(s.lot.part).toBe(surf.part); // a compartment's lot is behind its door / in its drawer
      for (const r of h.lots) {
        const o = placementBox(r.itemId, r);
        const hit = b.min[0] < o.max[0] && b.max[0] > o.min[0] && b.min[1] < o.max[1] - 0.002 && b.max[1] > o.min[1] + 0.002 && b.min[2] < o.max[2] && b.max[2] > o.min[2];
        expect(hit, `${s.key} overlaps rolled lot ${r.id}`).toBe(false);
      }
      if (h.level === tp.level) expect(Math.hypot(h.x - tp.x, h.z - tp.z)).toBeGreaterThanOrEqual(FUEL_HOLDERS.minFromTrain);
    }
    // two slots of one holder never overlap each other
    for (const s of slots.filter(x => x.pass === 1)) {
      const first = slots.find(x => x.holder === s.holder && x.pass === 0)!;
      const a = placementBox(FUEL.canItem, s.lot), b = placementBox(FUEL.canItem, first.lot);
      const same = first.lot.surface === s.lot.surface;
      if (same) expect(a.max[0] <= b.min[0] + 1e-6 || b.max[0] <= a.min[0] + 1e-6 || a.max[2] <= b.min[2] + 1e-6 || b.max[2] <= a.min[2] + 1e-6).toBe(true);
    }
  }, 30000);

  it.each(LAYOUTS)('%s: a 4-tank plan spreads over the rooms (no room holds most of it) and even the largest plan fits in holders', (_n, level, l) => {
    const {ins} = holdersOf(l, level);
    const slots = fuelHolderSlots(l, ins, 'st-03');
    const r16 = chooseFuelSlots(slots, 16);
    expect(r16.short).toBe(0);
    const rooms = new Map<number, number>();
    for (const s of r16.chosen) rooms.set(s.area, (rooms.get(s.area) ?? 0) + 1);
    expect(rooms.size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...rooms.values())).toBeLessThanOrEqual(Math.max(2, Math.ceil(16 / FUEL_HOLDERS.roomShare)));
    expect(chooseFuelSlots(slots, 28).short).toBe(0); // the plan maximum (4 + 12 + 12)
    // a skipped holder never gets fuel; a holder's second slot only with its first
    const skip = new Set(r16.chosen.slice(0, 4).map(s => s.holder));
    const r = chooseFuelSlots(slots, 16, k => skip.has(k));
    expect(r.chosen.some(s => skip.has(s.holder))).toBe(false);
    for (const s of r.chosen.filter(x => x.pass === 1)) expect(r.chosen.some(x => x.holder === s.holder && x.pass === 0)).toBe(true);
  }, 30000);
});

describe('loose fallback cans and the cart on real layouts (gen/fuelPlacement.ts)', () => {
  it.each(LAYOUTS)('%s: exactly the planned loose cans, ONE per pickup, reachable from the train, away from the car, deterministic', (_n, _lv, l) => {
    const p = placeStationFuel(l, CANS, 'st-07');
    expect(p).toEqual(placeStationFuel(l, CANS, 'st-07'));
    expect(p.cart).toBeNull();
    expect(p.cans.length).toBe(6);
    for (const c of p.cans) expect(c.count).toBe(1);
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

  it.each(LAYOUTS)('%s: a cart station gets a cart a wheeled cart can roll to the train door (or its units as cans: never lost)', (_n, _lv, l) => {
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
    const placed = LAYOUTS.filter(([, , l]) => placeStationFuel(l, CART, 'st-11').cart).length;
    expect(placed).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/**
 * A Game shell with what FuelStations touches, and Game.buildSection's ORDER: the loot holders built -> the `holders` hooks -> the
 * section memory's holder records applied -> the remembered pickups restored -> the `build` hooks; leaving: the teardown hooks, then
 * the memory flush (loose items + holder records).
 */
class Station {
  readonly run: RunState;
  readonly inv = new Inventory();
  readonly pickups = new PickupManager({});
  readonly sectionHooks: {holders?(l: unknown): void; build?(l: unknown): void; teardown?(): void}[] = [];
  containers: ContainerManager | null = null;
  world: unknown = null;
  readonly fs: FuelStations;
  readonly key: SectionKey;
  constructor(readonly layout: StationLayout, o: {at?: number; seed?: number; containers?: boolean} = {}) {
    const at = o.at ?? 0;
    const camp = fixtureCampaign({current: sid(at), known: [sid(0), sid(1), sid(2)], visited: [sid(at)]});
    if (o.seed !== undefined) (camp.network as {seed: number}).seed = o.seed;
    this.key = {level: 'subway', section: 'main', station: sid(at)};
    this.run = createRun({seeds: SEEDS, start: this.key, levels: LEVELS, campaign: camp});
    this.fs = new FuelStations(this as never).install();
    if (o.containers !== false) this.containers = new ContainerManager({}, mats, () => this.inv);
  }
  get seed(): number { return this.run.campaign!.network.seed; }
  enter(): void {
    const mem = this.run.memory(this.key);
    this.containers?.build(this.layout, {}, lootProfile('subway'));
    for (const h of this.sectionHooks) h.holders?.(this.layout);
    if (this.containers) applyHolders(this.containers, mem.holders);
    this.pickups.clear();
    for (const rec of mem.pickups ?? []) restorePickup(this.pickups, this.inv, rec);
    this.world = {};
    for (const h of this.sectionHooks) h.build?.(this.layout);
  }
  leave(): void {
    for (const h of this.sectionHooks) h.teardown?.();
    const mem = this.run.memory(this.key);
    mem.pickups = capturePickups(this.pickups.list, () => undefined);
    if (this.containers) mem.holders = captureHolders(this.containers);
    mem.visits++;
    this.world = null;
  }
  fuelLots() { return (this.containers?.all ?? []).flatMap(h => h.state.lots.filter(l => l.itemId === FUEL.canItem).map(l => ({h, l}))); }
  loose() { return this.pickups.list.filter(p => p.stack.itemId === FUEL.canItem); }
  stationUnits() { return this.fuelLots().reduce((s, x) => s + x.l.count, 0) + this.loose().reduce((s, p) => s + p.stack.count, 0); }
}

describe('the station coordinator (world/fuelStations.ts) in Game\'s build order', () => {
  const l = gen('subway', 101);

  it('first visit realizes the v2 plan once as loot lots (one can each); teardown records it; a revisit re-places exactly the remembered lots', () => {
    const s = new Station(l);
    const plan = stationFuelPlan(s.seed, sid(0));
    s.enter();
    expect(s.fs.last).toMatchObject({station: sid(0), mode: 'plan', lots: plan.cans, loose: plan.cart}); // (no cart system here: its units as single cans)
    expect(s.fuelLots().every(x => x.l.count === 1)).toBe(true);
    expect(s.loose().every(p => p.stack.count === 1)).toBe(true);
    expect(s.stationUnits()).toBe(plan.units);
    expect(s.fs.nodeFuel(sid(0))).toEqual({units: plan.units, source: 'live'});
    expect(s.run.laneStore(FUEL_LANE, s.key)).toBeUndefined(); // (not before the memory flush: a save before the departure regenerates it)
    s.leave();
    const rec = s.run.laneStore<StationFuelJSON>(FUEL_LANE, s.key)!;
    expect(stationFuelProblem(rec)).toBeNull();
    expect(rec).toMatchObject({v: 2, realized: true, carts: []});
    expect(rec.lots!.length).toBe(plan.cans);
    // revisit: the same lots, nothing new
    s.enter();
    expect(s.fs.last).toMatchObject({mode: 'kept', lots: 0, loose: 0});
    expect(s.stationUnits()).toBe(plan.units);
    expect(new Set(s.fuelLots().map(x => `${holderKeyOf(x.h)}#${x.l.id}`))).toEqual(new Set(rec.lots));
  }, 60000);

  it('taking cans: each visible can gives exactly ONE (stacking to 2 in the inventory); taken cans stay taken on a revisit; the map counts what is left', () => {
    let seed = 1;
    while (stationFuelPlan(seed, sid(0)).cart === 0) seed++; // a cart station: no cart system here, so its units lie as loose single cans too
    const s = new Station(l, {seed});
    const plan = stationFuelPlan(s.seed, sid(0));
    s.enter();
    const lots = s.fuelLots();
    // take three cans off their holders (ordinary loot take), the same one twice (double E / same frame: nothing extra)
    for (const {h, l: lot} of lots.slice(0, 3)) {
      const before = s.inv.count(FUEL.canItem);
      const r = takeLot(h.state, lot.id, s.inv);
      expect(r.taken).toEqual([{itemId: FUEL.canItem, count: 1}]);
      expect(s.inv.count(FUEL.canItem)).toBe(before + 1);
      expect(takeLot(h.state, lot.id, s.inv).taken).toEqual([]);
    }
    expect(s.inv.count(FUEL.canItem)).toBe(3);
    const stacks = [...s.inv.hotbar, ...s.inv.pack].filter(x => x?.itemId === FUEL.canItem).map(x => x!.count).sort();
    expect(stacks).toEqual([1, 2]); // inventory max stack 2 (unchanged)
    // one loose can (the cart's units here) picked up the way Game.interact does: Inventory.add of the pickup's stack
    const p = s.loose()[0];
    const left = s.inv.add(p.stack);
    expect(left).toBe(0);
    s.pickups.remove(p);
    expect(s.inv.count(FUEL.canItem)).toBe(4);
    s.leave();
    expect(s.fs.nodeFuel(sid(0))).toEqual({units: plan.units - 4, source: 'remaining'});
    s.enter();
    expect(s.stationUnits()).toBe(plan.units - 4); // finite: never refilled
    expect(s.fs.last).toMatchObject({mode: 'kept'});
  }, 60000);

  it('a reload of an arrival save (same memory, no teardown yet) realizes the same lots again — idempotent, no duplicates', () => {
    const s = new Station(l);
    const mem = s.run.memory(s.key);
    mem.visits = 2;
    s.containers!.build(l, {}, lootProfile('subway'));
    mem.holders = captureHolders(s.containers!); // visited before fuel existed: every holder remembered
    const snap = structuredClone(mem);
    s.enter();
    const first = s.fuelLots().map(x => `${holderKeyOf(x.h)}#${x.l.id}`).sort();
    const recs = structuredClone(mem.holders);
    // the arrival save is loaded again: memory as it was (+ whatever the build appended), no fuel record yet
    s.enter();
    expect(s.fuelLots().map(x => `${holderKeyOf(x.h)}#${x.l.id}`).sort()).toEqual(first);
    expect(mem.holders).toEqual(recs); // no id appended twice
    expect(first.length).toBe(stationFuelPlan(s.seed, sid(0)).cans);
    expect(Object.keys(snap.holders).length).toBe(Object.keys(mem.holders).length);
  }, 60000);

  it('a station visited before fuel existed: its plan once; containers the player already searched get none; its ordinary loot untouched', () => {
    const s = new Station(l);
    const mem = s.run.memory(s.key);
    mem.visits = 3;
    s.containers!.build(l, {}, lootProfile('subway'));
    for (const h of s.containers!.all) if (h.group === 'container') h.state.searched = true; // the player opened every cupboard / crate
    mem.holders = captureHolders(s.containers!);
    mem.pickups = [{stack: {itemId: 'water', count: 1}, pose: {p: [1, 0, 1], q: [0, 0, 0, 1]}, anchor: [1, 0, 1]}];
    const ordinary = JSON.stringify(Object.fromEntries(Object.entries(mem.holders).map(([k, v]) => [k, v.lots.filter(id => id % 1000 < FUEL_HOLDERS.lotBase)])));
    expect(s.fs.nodeFuel(sid(0))?.source).toBe('planned');
    s.enter();
    const plan = stationFuelPlan(s.seed, sid(0));
    expect(s.stationUnits()).toBe(plan.units);
    expect(s.fuelLots().some(x => x.h.group === 'container')).toBe(false);
    expect(s.pickups.list.some(p => p.stack.itemId === 'water')).toBe(true);
    const after = JSON.stringify(Object.fromEntries(Object.entries(mem.holders).map(([k, v]) => [k, v.lots.filter(id => id % 1000 < FUEL_HOLDERS.lotBase)])));
    expect(after).toBe(ordinary);
  }, 60000);

  it('a v1 save\'s realized station: ONE additive delta (v2 - v1 units) as lots, its v1 two-can pickups split into single cans (quantity kept), then never again', () => {
    // a network seed whose st-00 plans are v1 cans 4 and a richer v2 (deterministic search)
    let seed = 1;
    while (!(stationFuelPlanV1(seed, sid(0)).cart === 0 && stationFuelPlan(seed, sid(0)).units > stationFuelPlanV1(seed, sid(0)).units + 4)) seed++;
    const s = new Station(l, {seed});
    const v1 = stationFuelPlanV1(seed, sid(0)), v2 = stationFuelPlan(seed, sid(0)), delta = v2.units - v1.units;
    const mem = s.run.memory(s.key);
    mem.visits = 1;
    s.containers!.build(l, {}, lootProfile('subway'));
    mem.holders = captureHolders(s.containers!);
    // what a v1 visit left: one two-can stack + one single can lying loose (the player took the rest), a v1 record
    mem.pickups = [
      {stack: {itemId: FUEL.canItem, count: 2}, pose: {p: [3, 0, 3], q: [0, 0, 0, 1]}, anchor: [3, 0, 3]},
      {stack: {itemId: FUEL.canItem, count: 1}, pose: {p: [5, 0, 5], q: [0, 0, 0, 1]}, anchor: [5, 0, 5]},
    ];
    s.run.setLaneStore(FUEL_LANE, {v: 1, realized: true, carts: []}, s.key);
    expect(s.fs.nodeFuel(sid(0))).toEqual({units: 3 + delta, source: 'remaining'}); // what is left + the delta its next build adds
    s.enter();
    expect(s.fs.last).toMatchObject({mode: 'delta', lots: delta, split: 1});
    expect(s.fuelLots().length).toBe(delta);
    expect(s.loose().map(p => p.stack.count)).toEqual([1, 1, 1]); // the two-can stack is two cans now; nothing lost, nothing added
    expect(s.stationUnits()).toBe(3 + delta);
    s.leave();
    const rec = s.run.laneStore<StationFuelJSON>(FUEL_LANE, s.key)!;
    expect(rec).toMatchObject({v: 2, realized: true});
    expect(rec.lots!.length).toBe(delta);
    s.enter();
    expect(s.fs.last).toMatchObject({mode: 'kept', lots: 0, split: 0});
    expect(s.stationUnits()).toBe(3 + delta); // never a second delta
    expect(s.fs.nodeFuel(sid(0))).toEqual({units: 3 + delta, source: 'live'});
  }, 60000);

  it('the map figures: planned for a known unvisited station; remaining counts recorded lots its holders still list', () => {
    const s = new Station(l);
    s.enter();
    s.leave();
    const rec = s.run.laneStore<StationFuelJSON>(FUEL_LANE, s.key)!;
    const mem = s.run.memory(s.key);
    const total = stationFuelPlan(s.seed, sid(0)).units;
    // two recorded lots taken (their holders no longer list them)
    for (const k of rec.lots!.slice(0, 2)) { const {holder, lot} = parseFuelLotKey(k); mem.holders[holder].lots = mem.holders[holder].lots.filter(id => id !== lot); }
    expect(s.fs.nodeFuel(sid(0))).toEqual({units: total - 2, source: 'remaining'});
    const planned = stationFuelPlan(s.seed, sid(2));
    expect(s.fs.nodeFuel(sid(2))).toEqual({units: planned.units, source: 'planned'});
    expect(planned.units).toBeGreaterThanOrEqual(FUEL.stationMinUnits);
  }, 60000);

  it('without loot holders (a Node shell) every can lies loose, one per pickup; outside a campaign nothing is realized', () => {
    const s = new Station(l, {containers: false});
    s.enter();
    const plan = stationFuelPlan(s.seed, sid(0));
    expect(s.loose().length).toBe(plan.units);
    expect(s.loose().every(p => p.stack.count === 1)).toBe(true);
    const t = new Station(l);
    (t.run as {campaign: unknown}).campaign = null;
    t.enter();
    expect(t.fuelLots()).toEqual([]);
    expect(t.loose()).toEqual([]);
    expect(t.fs.nodeFuel(sid(0))).toBeNull();
  }, 60000);

  it('a loose stack of several cans (an older save, a drop) becomes single cans side by side, the total exact', () => {
    const s = new Station(l, {containers: false});
    s.enter();
    const before = s.stationUnits();
    const st = s.inv.makeStack(FUEL.canItem, 2);
    st.count = 2;
    s.pickups.add(st, 4, 0, 4, 0.5);
    expect(s.fs.splitLooseStacks()).toBe(1);
    expect(s.stationUnits()).toBe(before + 2);
    expect(s.loose().every(p => p.stack.count === 1)).toBe(true);
    const pair = s.loose().filter(p => Math.hypot(p.x - 4, p.z - 4) < 0.5);
    expect(pair.length).toBe(2);
    expect(s.fs.splitLooseStacks()).toBe(0);
    expect(new THREE.Vector3(pair[0].x, 0, pair[0].z).distanceTo(new THREE.Vector3(pair[1].x, 0, pair[1].z))).toBeGreaterThan(0.2); // side by side, not inside each other
  }, 60000);
});
