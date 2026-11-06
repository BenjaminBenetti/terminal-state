// Task studio-beta-train-fuel-system-20261106-024923-01: the STATIONS' fuel — realizing each campaign station's deterministic plan
// (fuel/fuel.ts stationFuelPlan) once, keeping it finite, and telling the map how much fuel a station holds.
//
// Task studio-beta-fuel-feedback-20261106-064128-01 (user feedback): the cans are ordinary LOOT LOTS on shelves, counters and in storage
// (gen/fuelHolders.ts), ONE can per lot / pickup, about 4 tanks a station on average (plan v2), loose floor cans only as the rare
// fallback when no holder has room.
//
// installFuelStations(game) only registers a section hook (Game.buildSection runs `holders` right after the loot holders are built —
// before the shelf filler and the section memory — and `build` at the end of the build, after the memory was applied):
//  - holders: the station's fuel slots (fuelHolderSlots: a fixed order for this layout) are computed and the REALIZED ones placed into
//    their holders as lots (ContainerManager.addLots): a realized v2 station gets exactly its recorded lots back (the holder memory then
//    removes the taken ones, like any lot); an unrealized station (first visit, or visited before fuel existed) realizes its v2 plan
//    (chooseFuelSlots: spread over the rooms; a visited station's already-searched containers are left out); a station a v1 save
//    realized gets ONE additive delta (v2 units - v1 units, never negative; its v1 cans / cart are untouched). Newly realized lots are
//    added to the station's remembered holder records (so the memory keeps them; idempotent if a save reloads the arrival).
//  - build: the plan's optional cart (world/fuelCarts.ts spawn) and the cans no holder could take (gen/fuelPlacement.ts: one per spot);
//    a realized station's remembered carts come back (loadStation); any loose fuel pickup holding more than one can is split into
//    single cans side by side (v1 saves laid two cans as one pickup: one visible can = one can, the quantity kept exactly).
//  - teardown: the record {v: 2, realized: true, carts, lots} is written into the station's memory together with the normal memory flush
//    (Game.leaveSection: hooks first, then saveSectionMemory) — a save taken before the first departure (new-game / arrival) regenerates
//    the same realization on load, never twice and never lost; a Retry rebuilds the entry state the same way.
// Remaining fuel (the map, nodeFuel): the CURRENT station live (its fuel lots in holders, fuel pickups, cans in grounded bags, its carts
// outside the car); a visited station with a realized record from its memory (recorded lots its holders still list, remembered fuel
// cans, cans in remembered bags, its carts; a v1 station + its pending delta); otherwise (known, never built, or visited before fuel
// existed) its PLAN. Fuel moved aboard the train is not the station's any more.
import type {Game} from '../game';
import type {SectionKey} from '../levels/types';
import type {StationLayout} from '../gen/stationTypes';
import {FUEL, FUEL_LANE, FUEL_LOTS_MAX, stationFuelPlan, stationFuelPlanV1, stationFuelProblem, stationFuelRemaining, type StationCartJSON, type StationFuelJSON} from '../fuel/fuel';
import {placeStationFuel} from '../gen/fuelPlacement';
import {chooseFuelSlots, fuelHolderSlots, type FuelHolderIn, type FuelSlot} from '../gen/fuelHolders';
import {BAG_LANE} from '../run/bagStore';
import {holderKeyOf} from '../run/worldMemory';
import type {ContainerManager, Holder} from './containers';
import type {ItemStack} from '../items/inventory';

/** What world/fuelCarts.ts offers the station coordinator (optional: absent = no carts). */
export interface StationCartsApi {
  spawn(rec: StationCartJSON): void;
  stationRecords(): StationCartJSON[];
  loadStation(recs: readonly StationCartJSON[]): void;
}

/** A station's fuel for the map: quarter units and where the number comes from. */
export interface NodeFuel { units: number; source: 'planned' | 'remaining' | 'live' }

/** How this build treats the station's fuel. */
type Mode = 'kept' | 'plan' | 'delta';

interface PickupLike { stack: ItemStack; x: number; y: number; z: number; obj?: {rotation?: {y: number}} }

export class FuelStations {
  /** The section key of the live station this coordinator built (null between worlds / outside a campaign). */
  private live: SectionKey | null = null;
  /** This build's decision (holders phase -> build phase -> teardown record). */
  private stage: {mode: Mode; lots: string[]; short: number; cart: number; carts: StationCartJSON[] | null} | null = null;
  /** QA / tests: what the last build did. */
  last: {station: string; mode: Mode; lots: number; loose: number; cart: boolean; split: number} | null = null;

  constructor(private readonly game: Game) {}

  install(): this {
    this.game.sectionHooks.push({
      holders: layout => this.holders(layout as unknown as StationLayout),
      build: layout => this.build(layout as unknown as StationLayout),
      teardown: () => this.teardown(),
    });
    return this;
  }

  private get carts(): StationCartsApi | null {
    const c = (this.game as unknown as {fuelCarts?: Partial<StationCartsApi>}).fuelCarts;
    return c && typeof c.spawn === 'function' && typeof c.stationRecords === 'function' && typeof c.loadStation === 'function' ? c as StationCartsApi : null;
  }

  private get containers(): ContainerManager | null {
    const cm = (this.game as unknown as {containers?: ContainerManager | null}).containers;
    return cm && Array.isArray(cm.all) && typeof cm.addLots === 'function' ? cm : null;
  }

  private networkSeed(): number | null {
    return this.game.run.campaign?.network.seed ?? null;
  }

  /** The station's realized record (validated; null = none / malformed). */
  private record(key: SectionKey): StationFuelJSON | null {
    const r = this.game.run.peekMemory(key) ? this.game.run.laneStore<unknown>(FUEL_LANE, key) : undefined;
    return r !== undefined && stationFuelProblem(r) === null ? r as StationFuelJSON : null;
  }

  /** The live holders as gen/fuelHolders.ts reads them (their rolled lots: this runs before the memory is applied). */
  private holderInputs(cm: ContainerManager): {ins: FuelHolderIn[]; byKey: Map<string, Holder>} {
    const ins: FuelHolderIn[] = [], byKey = new Map<string, Holder>();
    for (const h of cm.all) {
      const key = holderKeyOf(h);
      byKey.set(key, h);
      ins.push({key, kind: h.kind, index: h.index, area: h.prop.area, level: h.prop.level ?? 0, x: h.prop.x, z: h.prop.z, surfaces: h.surfaces, lots: h.state.lots});
    }
    return {ins, byKey};
  }

  /** Phase 1 (right after the holders are built): decide the realization and place the fuel lots. */
  holders(layout: StationLayout): void {
    const key = this.game.run.current, seed = this.networkSeed();
    this.live = null;
    this.stage = null;
    if (!key.station || seed === null) return; // fuel exists in campaign runs only
    this.live = {...key};
    const cm = this.containers;
    const {ins, byKey} = cm ? this.holderInputs(cm) : {ins: [], byKey: new Map<string, Holder>()};
    const slots = cm ? fuelHolderSlots(layout, ins, key.station) : [];
    const rec = this.record(key);
    const mem = this.game.run.peekMemory(key);
    let chosen: FuelSlot[];
    if (rec?.realized && rec.v === 2) {
      const keep = new Set(rec.lots ?? []);
      chosen = slots.filter(s => keep.has(s.key));
      this.stage = {mode: 'kept', lots: [...(rec.lots ?? [])], short: 0, cart: 0, carts: rec.carts};
    } else {
      const plan = stationFuelPlan(seed, key.station);
      const delta = !!rec?.realized; // a v1 station: ONE additive delta, its v1 cans / cart untouched
      const n = delta ? Math.max(0, plan.units - stationFuelPlanV1(seed, key.station).units) / FUEL.canUnits : plan.cans;
      // a visited station: containers the player already opened (searched) are left out (no fuel appears in an emptied cupboard)
      const recs = mem?.holders ?? {};
      const skip = (hk: string) => !!recs[hk]?.searched && byKey.get(hk)?.group === 'container';
      const inLots = Math.min(n, FUEL_LOTS_MAX); // (the record lists at most FUEL_LOTS_MAX lots; a plan has at most 28 cans)
      const pick = chooseFuelSlots(slots, inLots, skip);
      chosen = pick.chosen;
      this.stage = {mode: delta ? 'delta' : 'plan', lots: chosen.map(s => s.key), short: pick.short + n - inLots, cart: delta ? 0 : plan.cart, carts: delta ? rec!.carts : null};
      // the memory must keep the newly realized lots (Game.applyHolders keeps only listed lot ids of a remembered holder)
      for (const s of chosen) {
        const hr = recs[s.holder];
        if (hr && !hr.lots.includes(s.lot.id)) hr.lots.push(s.lot.id);
      }
    }
    if (cm && chosen.length) {
      const adds = new Map<Holder, FuelSlot['lot'][]>();
      for (const s of chosen) {
        const h = byKey.get(s.holder);
        if (!h) continue;
        const l = adds.get(h) ?? [];
        l.push(s.lot);
        adds.set(h, l);
      }
      cm.addLots([...adds].map(([holder, lots]) => ({holder, lots})));
    }
  }

  /** Phase 2 (end of the build, memory applied): carts, the loose remainder, single-can pickups. */
  build(layout: StationLayout): void {
    const key = this.live, st = this.stage;
    if (!key?.station || !st) return;
    if (st.carts) this.carts?.loadStation(st.carts);
    let loose = 0, cart = false;
    if (st.short > 0 || st.cart > 0) {
      const place = placeStationFuel(layout, {units: st.short + st.cart, cans: st.short, cart: st.cart}, key.station);
      for (const s of place.cans) loose += this.addCans(s.count, s.x, s.y, s.z, (s.x * 7.13 + s.z * 3.71) % (Math.PI * 2));
      if (place.cart) {
        const c = this.carts;
        if (c) { c.spawn({uid: `cart:${key.station}`, units: st.cart, ...place.cart}); cart = true; }
        else loose += this.addCans(st.cart, place.cart.x, place.cart.y, place.cart.z, 0); // no cart system (Node shells): its units as cans (never lost)
      }
    }
    const split = this.splitLooseStacks();
    this.last = {station: key.station, mode: st.mode, lots: st.mode === 'kept' ? 0 : st.lots.length, loose, cart, split};
  }

  /** `n` single fuel cans as pickups side by side around (x, z), facing `yaw`. Returns n. */
  private addCans(n: number, x: number, y: number, z: number, yaw: number): number {
    const step = 0.26, c = Math.cos(yaw), s = Math.sin(yaw);
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * step;
      const st = this.game.inv.makeStack(FUEL.canItem, 1);
      st.count = 1;
      this.game.pickups.add(st, x + c * off, y, z - s * off, yaw);
    }
    return n;
  }

  /**
   * Every loose fuel pickup holding more than one can becomes single cans side by side (the first keeps its place and object; the
   * others are new pickups beside it): one visible can is one can, the total kept exactly. Returns the cans split off.
   */
  splitLooseStacks(): number {
    const pm = this.game.pickups as unknown as {list: PickupLike[]; add(stack: ItemStack, x: number, y: number, z: number, yaw?: number): unknown};
    let n = 0;
    for (const p of [...pm.list]) {
      if (p.stack.itemId !== FUEL.canItem || p.stack.count <= 1) continue;
      const extra = p.stack.count - 1, yaw = p.obj?.rotation?.y ?? 0;
      p.stack.count = 1;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (let k = 1; k <= extra; k++) {
        const st = this.game.inv.makeStack(FUEL.canItem, 1);
        st.count = 1;
        pm.add(st, p.x + c * 0.26 * k, p.y, p.z - s * 0.26 * k, yaw);
        n++;
      }
    }
    return n;
  }

  teardown(): void {
    const key = this.live, st = this.stage;
    this.live = null;
    this.stage = null;
    if (!key || !st) return;
    const rec: StationFuelJSON = {v: 2, realized: true, carts: this.carts?.stationRecords() ?? [], lots: st.lots};
    this.game.run.setLaneStore(FUEL_LANE, rec, key);
  }

  /** Fuel units in the live station right now (its fuel lots in holders, pickups, cans in its grounded bags, its carts outside the car). */
  liveUnits(): number {
    const g = this.game as unknown as {pickups: {list: readonly {stack: {itemId: string; count: number; bag?: readonly ({itemId: string; count: number} | null)[]}}[]}; gear?: {bags?: readonly {stack: {bag?: readonly ({itemId: string; count: number} | null)[]}}[]}};
    let lots = 0;
    for (const h of this.containers?.all ?? []) for (const l of h.state.lots) if (l.itemId === FUEL.canItem) lots += l.count * FUEL.canUnits;
    return lots + stationFuelRemaining({pickups: g.pickups.list, bags: g.gear?.bags ?? [], carts: this.carts?.stationRecords() ?? []});
  }

  /** The map's figure for a station (null outside a campaign). */
  nodeFuel(station: string): NodeFuel | null {
    const run = this.game.run, c = run.campaign, seed = this.networkSeed();
    if (!c || seed === null) return null;
    if (this.live && this.live.station === station && this.game.world) return {units: this.liveUnits(), source: 'live'};
    const node = c.network.nodes.find(n => n.id === station);
    const key: SectionKey | null = node ? {level: node.archetype, section: 'main', station} : null;
    const mem = key ? run.peekMemory(key) : undefined;
    if (key && mem) {
      const rec = this.record(key);
      if (rec?.realized) {
        const bags = (run.laneStore<{bags?: {stack: {bag?: ({itemId: string; count: number} | null)[]}}[]}>(BAG_LANE, key)?.bags) ?? [];
        const left = stationFuelRemaining({pickups: mem.pickups as never, bags, carts: rec.carts, lots: rec.lots ?? [], holders: mem.holders});
        // a v1 station: + the delta its next build adds
        const delta = rec.v === 1 ? Math.max(0, stationFuelPlan(seed, station).units - stationFuelPlanV1(seed, station).units) : 0;
        return {units: left + delta, source: 'remaining'};
      }
    }
    return {units: stationFuelPlan(seed, station).units, source: 'planned'};
  }
}

export function installFuelStations(game: Game): FuelStations {
  return new FuelStations(game).install();
}
