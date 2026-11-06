// Task studio-beta-train-fuel-system-20261106-024923-01: the STATIONS' fuel — realizing each campaign station's deterministic plan
// (fuel/fuel.ts stationFuelPlan) once, keeping it finite, and telling the map how much fuel a station holds.
//
// installFuelStations(game) only registers a section hook (Game.buildSection runs it after the section's memory was applied):
//  - build: a campaign station whose memory has no realized FUEL_LANE record gets its plan as ORDINARY world pickups (`fuel_can`, 1-2 a
//    spot: gen/fuelPlacement.ts) plus its optional cart (world/fuelCarts.ts spawn); a realized one gets its remembered carts back (the
//    remembered cans are ordinary loose items: the section memory already restored them). Nothing else in the layout changes.
//  - teardown: the record {v: 1, realized: true, carts} is written into the station's memory together with the normal memory flush
//    (Game.leaveSection: hooks first, then saveSectionMemory) — so a save taken before the first departure (new-game / arrival) still
//    regenerates the same plan on load, never twice and never lost; a Retry rebuilds the entry state the same way.
//  - an older save's stations (no record: visited before fuel existed) realize on their next build — once ("the current / visited
//    stations gain fuel once"), ordinary loot untouched.
// Remaining fuel (the map, nodeFuel): the CURRENT station live (its fuel pickups, cans in grounded bags, its carts outside the car);
// a visited station with a realized record from its memory (remembered fuel cans, cans in remembered bags, its carts); otherwise
// (known, never built, or an older save's unrealized station) its PLAN. Fuel moved aboard the train is not the station's any more.
import type {Game} from '../game';
import type {SectionKey} from '../levels/types';
import type {StationLayout} from '../gen/stationTypes';
import {FUEL, FUEL_LANE, stationFuelPlan, stationFuelProblem, stationFuelRemaining, type StationCartJSON, type StationFuelJSON} from '../fuel/fuel';
import {placeStationFuel} from '../gen/fuelPlacement';
import {BAG_LANE} from '../run/bagStore';

/** What world/fuelCarts.ts offers the station coordinator (optional: absent = no carts). */
export interface StationCartsApi {
  spawn(rec: StationCartJSON): void;
  stationRecords(): StationCartJSON[];
  loadStation(recs: readonly StationCartJSON[]): void;
}

/** A station's fuel for the map: quarter units and where the number comes from. */
export interface NodeFuel { units: number; source: 'planned' | 'remaining' | 'live' }

export class FuelStations {
  /** The section key of the live station this coordinator built (null between worlds / outside a campaign). */
  private live: SectionKey | null = null;
  /** QA / tests: what the last build did. */
  last: {station: string; realized: boolean; cans: number; cart: boolean} | null = null;

  constructor(private readonly game: Game) {}

  install(): this {
    this.game.sectionHooks.push({build: layout => this.build(layout as unknown as StationLayout), teardown: () => this.teardown()});
    return this;
  }

  private get carts(): StationCartsApi | null {
    const c = (this.game as unknown as {fuelCarts?: Partial<StationCartsApi>}).fuelCarts;
    return c && typeof c.spawn === 'function' && typeof c.stationRecords === 'function' && typeof c.loadStation === 'function' ? c as StationCartsApi : null;
  }

  private networkSeed(): number | null {
    return this.game.run.campaign?.network.seed ?? null;
  }

  /** The station's realized record (validated; null = none / malformed). */
  private record(key: SectionKey): StationFuelJSON | null {
    const r = this.game.run.peekMemory(key) ? this.game.run.laneStore<unknown>(FUEL_LANE, key) : undefined;
    return r !== undefined && stationFuelProblem(r) === null ? r as StationFuelJSON : null;
  }

  build(layout: StationLayout): void {
    const key = this.game.run.current, seed = this.networkSeed();
    this.live = null;
    if (!key.station || seed === null) return; // fuel exists in campaign runs only
    this.live = {...key};
    const rec = this.record(key);
    if (rec?.realized) {
      this.carts?.loadStation(rec.carts);
      this.last = {station: key.station, realized: false, cans: 0, cart: false};
      return;
    }
    const plan = stationFuelPlan(seed, key.station), place = placeStationFuel(layout, plan, key.station);
    const inv = this.game.inv;
    let cans = 0;
    for (const s of place.cans) {
      const st = inv.makeStack(FUEL.canItem, s.count);
      st.count = s.count;
      this.game.pickups.add(st, s.x, s.y, s.z, (s.x * 7.13 + s.z * 3.71) % (Math.PI * 2));
      cans += s.count;
    }
    let cart = false;
    if (place.cart) {
      const c = this.carts;
      if (c) { c.spawn({uid: `cart:${key.station}`, units: plan.cart, ...place.cart}); cart = true; }
      else { // no cart system (Node shells): the cart's units as cans at its spot (never lost)
        for (let k = 0; k < plan.cart; k += 2) {
          const st = inv.makeStack(FUEL.canItem, 2);
          st.count = Math.min(2, plan.cart - k);
          this.game.pickups.add(st, place.cart.x + (k / 2) * 0.4, place.cart.y, place.cart.z, 0);
          cans += st.count;
        }
      }
    }
    this.last = {station: key.station, realized: true, cans, cart};
  }

  teardown(): void {
    const key = this.live;
    this.live = null;
    if (!key) return;
    const rec: StationFuelJSON = {v: 1, realized: true, carts: this.carts?.stationRecords() ?? []};
    this.game.run.setLaneStore(FUEL_LANE, rec, key);
  }

  /** Fuel units lying in the live station right now (its pickups, cans in its grounded bags, its carts outside the car). */
  liveUnits(): number {
    const g = this.game as unknown as {pickups: {list: readonly {stack: {itemId: string; count: number; bag?: readonly ({itemId: string; count: number} | null)[]}}[]}; gear?: {bags?: readonly {stack: {bag?: readonly ({itemId: string; count: number} | null)[]}}[]}};
    return stationFuelRemaining({pickups: g.pickups.list, bags: g.gear?.bags ?? [], carts: this.carts?.stationRecords() ?? []});
  }

  /** The map's figure for a station (null outside a campaign). */
  nodeFuel(station: string): NodeFuel | null {
    const run = this.game.run, c = run.campaign, seed = this.networkSeed();
    if (!c || seed === null) return null;
    if (this.live && this.live.station === station && this.game.world) return {units: this.liveUnits(), source: 'live'};
    const key: SectionKey | null = (() => {
      const node = c.network.nodes.find(n => n.id === station);
      return node ? {level: node.archetype, section: 'main', station} : null;
    })();
    if (key && run.peekMemory(key)) {
      const rec = this.record(key);
      if (rec?.realized) {
        const mem = run.peekMemory(key)!;
        const bags = (run.laneStore<{bags?: {stack: {bag?: ({itemId: string; count: number} | null)[]}}[]}>(BAG_LANE, key)?.bags) ?? [];
        return {units: stationFuelRemaining({pickups: mem.pickups as never, bags, carts: rec.carts}), source: 'remaining'};
      }
    }
    return {units: stationFuelPlan(seed, station).units, source: 'planned'};
  }
}

export function installFuelStations(game: Game): FuelStations {
  return new FuelStations(game).install();
}
