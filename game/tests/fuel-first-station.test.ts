// Task gameplay-feedback-20261111 (lane FUEL-LOOT; user: "Investigate fuel scarcity at the first station reached after the starting
// station. Fix actual generation, placement or accounting problems rather than increasing fuel everywhere.")
//
// The defect: Game.buildSectionSteps runs the `holders` hooks (world/fuelStations.ts realizes a station's fuel cans there) BEFORE its
// 'arrival' step moves run.current to the station being built, and the coordinator read run.current. Every journey's destination was
// realized under the DEPARTURE station's key: the first station after the start matched the start's own (kept) record against its own
// layout and realized 0 of its 6-25 planned units on every one of 6 real networks; each later station got the previous station's plan,
// a revisit could refill, and the record went to the departure. Game now passes the key being built and the record is v3.
// These tests drive the coordinator in Game's REAL order (run.current stale during `holders`), the source order in game.ts, and the
// save compatibility of v2 records (written by the releases with the defect).
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import type {SectionKey} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {FUEL, FUEL_LANE, fuelLotKey, parseFuelLotKey, stationFuelPlan, type StationFuelJSON} from '../src/fuel/fuel';
import {FuelStations} from '../src/world/fuelStations';
import {chooseFuelSlots, fuelHolderSlots, isFuelLotId, type FuelHolderIn} from '../src/gen/fuelHolders';
import {ContainerManager} from '../src/world/containers';
import {PickupManager} from '../src/world/pickups';
import {WorldMaterials} from '../src/world/materials';
import {createRun, type RunState} from '../src/run/runState';
import {applyHolders, captureHolders, capturePickups, holderKeyOf, restorePickup} from '../src/run/worldMemory';
import {Inventory} from '../src/items/inventory';
import {takeLot} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {adjacency, generateNetwork} from '../src/campaign/network';
import {newCampaign} from '../src/campaign/discovery';
import {SEEDS} from './helpers/saveFixture';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

/** A Game shell in Game.buildSectionSteps' order: holders -> `holders` hooks (run.current = the departure) -> applyHolders -> run.current = key -> pickups -> `build` hooks. */
class Journey {
  readonly run: RunState;
  readonly inv = new Inventory();
  readonly pickups = new PickupManager({});
  readonly sectionHooks: {holders?(l: unknown, k: SectionKey): void; build?(l: unknown): void; teardown?(): void}[] = [];
  containers: ContainerManager | null = new ContainerManager({}, mats, () => this.inv);
  world: unknown = null;
  readonly fs: FuelStations;
  private readonly layouts: Map<string, StationLayout>;
  constructor(netSeed: number, share?: Journey) {
    this.layouts = share ? share.layouts : new Map();
    const camp = newCampaign(generateNetwork(netSeed));
    this.run = createRun({seeds: SEEDS, start: this.key(camp.network.start, camp), levels: LEVELS, campaign: camp});
    this.fs = new FuelStations(this as never).install();
  }
  get net() { return this.run.campaign!.network; }
  key(id: string, camp = this.run.campaign!): SectionKey { return {level: camp.network.nodes.find(n => n.id === id)!.archetype, section: 'main', station: id}; }
  layout(id: string): StationLayout {
    let l = this.layouts.get(id);
    if (!l) { const n = this.run.node(id)!; l = LEVELS[n.archetype].generate('main', {levelSeed: n.levelSeed, startWeapon: 'pistol'}); this.layouts.set(id, l); }
    return l;
  }
  /** Build station `id` (a journey: run.current is still the station left until the arrival step). */
  enter(id: string): void {
    const key = this.key(id), l = this.layout(id);
    this.containers!.build(l, {}, lootProfile(key.level));
    for (const h of this.sectionHooks) h.holders?.(l, key);
    const mem = this.run.memory(key);
    applyHolders(this.containers!, mem.holders);
    this.run.current = {...key};
    mem.visits++;
    this.pickups.clear();
    for (const rec of mem.pickups ?? []) restorePickup(this.pickups, this.inv, rec);
    this.world = {};
    for (const h of this.sectionHooks) h.build?.(l);
  }
  leave(): void {
    for (const h of this.sectionHooks) h.teardown?.();
    const mem = this.run.memory(this.run.current);
    mem.pickups = capturePickups(this.pickups.list, () => undefined);
    mem.holders = captureHolders(this.containers!);
    this.world = null;
  }
  fuelLots() { return this.containers!.all.flatMap(h => h.state.lots.filter(l => l.itemId === FUEL.canItem).map(l => ({h, l}))); }
  loose() { return this.pickups.list.filter(p => p.stack.itemId === FUEL.canItem).reduce((s, p) => s + p.stack.count, 0); }
  units(): number { return this.fuelLots().reduce((s, x) => s + x.l.count, 0) + this.loose(); }
  plan(id: string): number { return stationFuelPlan(this.net.seed, id).units; }
  record(id: string) { return this.run.laneStore<StationFuelJSON>(FUEL_LANE, this.key(id)); }
}

describe('fuel at the stations after the start, in Game\'s real build order', () => {
  it('game.ts hands the key being built to the `holders` hooks, which run before run.current moves on', () => {
    const src = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    const steps = src.slice(src.indexOf('private *buildSectionSteps('));
    const hook = steps.indexOf('h.holders?.(this.layout, key)'), moved = steps.indexOf('this.run.current = {...key};');
    expect(hook).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(hook); // (the reason the key must be passed: run.current is still the departure here)
  });

  it.each([101, 505])('network %i: the start, the first station after it and the next each realize their OWN plan; records keyed by their own station; a revisit keeps it', netSeed => {
    const j = new Journey(netSeed);
    const st0 = j.net.start, adj = adjacency(j.net);
    const first = adj.get(st0)![0], second = adj.get(first)!.find(x => x !== st0)!;
    j.enter(st0);
    expect(j.units()).toBe(j.plan(st0));
    j.leave();
    const startRec = structuredClone(j.record(st0));
    expect(startRec).toMatchObject({v: 3, realized: true});
    j.enter(first); // the first station reached after the start (the user's report)
    expect(j.fs.last).toMatchObject({station: first, mode: 'plan'});
    expect(j.units()).toBe(j.plan(first)); // (was 0 on every measured network)
    expect(j.fs.nodeFuel(first)).toEqual({units: j.plan(first), source: 'live'});
    j.leave();
    expect(j.record(st0)).toEqual(startRec); // the departure's record is not overwritten by the station built after it
    expect(j.record(first)).toMatchObject({v: 3, realized: true});
    for (const k of j.record(first)!.lots!) expect(j.run.memory(j.key(first)).holders[parseFuelLotKey(k).holder]?.lots).toContain(parseFuelLotKey(k).lot);
    j.enter(second);
    expect(j.fs.last).toMatchObject({station: second, mode: 'plan'});
    expect(j.units()).toBe(j.plan(second)); // (was the PREVIOUS station's plan)
    j.leave();
    j.enter(first); // back: exactly what was left, never refilled
    expect(j.fs.last).toMatchObject({station: first, mode: 'kept'});
    expect(j.units()).toBe(j.plan(first));
    j.leave();
    expect(j.fs.nodeFuel(first)).toEqual({units: j.plan(first), source: 'remaining'});
    expect(j.fs.nodeFuel(second)).toEqual({units: j.plan(second), source: 'remaining'});
  }, 180000);
});

/** The holders of `id`'s layout as gen/fuelHolders.ts reads them (rolled lots, before any memory). */
function holderIns(j: Journey, id: string): FuelHolderIn[] {
  const cm = new ContainerManager({}, mats, () => j.inv);
  cm.build(j.layout(id), {}, lootProfile(j.key(id).level));
  return cm.all.map(h => ({key: holderKeyOf(h), kind: h.kind, index: h.index, area: h.prop.area, level: h.prop.level ?? 0, x: h.prop.x, z: h.prop.z, surfaces: h.surfaces, lots: h.state.lots}));
}

describe('saves of the releases with the defect (v2 station records): visited stations keep exactly what they remember', () => {
  it('the start keeps its remaining cans; the first station (which got none) gets its plan once; a station realized under the previous station\'s id keeps exactly its remaining cans, no new fuel', () => {
    let j = new Journey(202);
    const st0 = j.net.start, adj = adjacency(j.net);
    const first = adj.get(st0)![0], second = adj.get(first)!.find(x => x !== st0)!;
    // --- the v2 release's state, written by hand: (1) the start realized correctly (its own record, v2), two cans taken
    j.enter(st0);
    for (const {h, l} of j.fuelLots().slice(0, 2)) takeLot(h.state, l.id, j.inv);
    j.leave();
    const startLeft = j.plan(st0) - 2;
    j.run.setLaneStore(FUEL_LANE, {...j.record(st0)!, v: 2}, j.key(st0));
    // (2) the first station after the start: visited, NO fuel realized (its holders remember no can), no record of its own
    const k1 = j.key(first), cm1 = new ContainerManager({}, mats, () => j.inv);
    cm1.build(j.layout(first), {}, lootProfile(k1.level));
    for (const h of cm1.all) if (h.group === 'container' && h.index % 3 === 0) h.state.searched = true; // some cupboards opened
    Object.assign(j.run.memory(k1), {visits: 1, holders: captureHolders(cm1), pickups: []});
    // (3) the station after it: realized under the FIRST station's id (the v2 release's plan of the first station), recorded under the
    // first station's key; the player took three cans
    const ins2 = holderIns(j, second), wrong = chooseFuelSlots(fuelHolderSlots(j.layout(second), ins2, first), stationFuelPlan(j.net.seed, first).cans).chosen;
    const k2 = j.key(second), cm2 = new ContainerManager({}, mats, () => j.inv);
    cm2.build(j.layout(second), {}, lootProfile(k2.level));
    const byKey = new Map(cm2.all.map(h => [holderKeyOf(h), h]));
    for (const s of wrong) byKey.get(s.holder)!.state.lots.push({...s.lot});
    for (const s of wrong.slice(0, 3)) takeLot(byKey.get(s.holder)!.state, s.lot.id, j.inv);
    Object.assign(j.run.memory(k2), {visits: 1, holders: captureHolders(cm2), pickups: []});
    j.run.setLaneStore(FUEL_LANE, {v: 2, realized: true, carts: [], lots: wrong.map(s => s.key)}, k1);
    // --- that save is loaded: a fresh run with those memories (the layouts are the same generator output)
    const old = j;
    j = new Journey(202, old);
    j.run.importMemories(old.run.exportMemories());
    j.run.current = j.key(second); // (wherever the save stood)
    const remembered2 = Object.entries(j.run.memory(k2).holders).flatMap(([hk, hr]) => hr.lots.filter(isFuelLotId).map(id => fuelLotKey(hk, id))).sort();
    expect(remembered2.length).toBe(wrong.length - 3);
    const ordinary = (k: SectionKey) => JSON.stringify(Object.entries(j.run.memory(k).holders).map(([hk, hr]) => [hk, hr.lots.filter(id => !isFuelLotId(id))]));
    const ord1 = ordinary(k1), ord2 = ordinary(k2);
    // --- the map before any build: what each station really holds (or will realize)
    expect(j.fs.nodeFuel(st0)).toEqual({units: startLeft, source: 'remaining'});
    expect(j.fs.nodeFuel(first)).toEqual({units: j.plan(first), source: 'planned'});
    expect(j.fs.nodeFuel(second)).toEqual({units: wrong.length - 3, source: 'remaining'});
    // --- now: the start keeps exactly its remaining cans (legacy, no new fuel)
    j.enter(st0);
    expect(j.fs.last).toMatchObject({station: st0, mode: 'legacy', loose: 0});
    expect(j.units()).toBe(startLeft);
    j.leave();
    expect(j.record(st0)).toMatchObject({v: 3, realized: true});
    j.enter(st0);
    expect(j.fs.last).toMatchObject({mode: 'kept'});
    expect(j.units()).toBe(startLeft);
    j.leave();
    // the first station: never realized -> its plan once, never in a cupboard the player already searched; its ordinary loot untouched
    j.enter(first);
    expect(j.fs.last).toMatchObject({station: first, mode: 'plan'});
    expect(j.units()).toBe(j.plan(first));
    expect(j.fuelLots().some(x => x.h.group === 'container' && x.h.state.searched && x.h.index % 3 === 0)).toBe(false);
    expect(ordinary(k1)).toBe(ord1);
    j.leave();
    j.enter(first);
    expect(j.fs.last).toMatchObject({mode: 'kept'});
    expect(j.units()).toBe(j.plan(first));
    j.leave();
    // the station realized under the first station's id: exactly its remembered cans, in the same holders with the same lot ids
    j.enter(second);
    expect(j.fs.last).toMatchObject({station: second, mode: 'legacy'});
    expect(j.units()).toBe(wrong.length - 3);
    const lots = j.fuelLots().map(x => fuelLotKey(holderKeyOf(x.h), x.l.id)).sort();
    expect(lots.length + j.loose()).toBe(remembered2.length);
    for (const k of lots) expect(remembered2).toContain(k);
    expect(ordinary(k2)).toBe(ord2);
    j.leave();
    j.enter(second);
    expect(j.fs.last).toMatchObject({mode: 'kept'});
    expect(j.units()).toBe(wrong.length - 3);
  }, 180000);
});
