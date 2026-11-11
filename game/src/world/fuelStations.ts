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
//    their holders as lots (ContainerManager.addLots): a realized v3 station gets exactly its recorded lots back (the holder memory then
//    removes the taken ones, like any lot); an unrealized station (first visit, or visited before fuel existed) realizes its v2 plan
//    (chooseFuelSlots: spread over the rooms; a visited station's already-searched containers are left out); a station a v1 save
//    realized gets ONE additive delta (v2 units - v1 units, never negative; its v1 cans / cart are untouched). Newly realized lots are
//    added to the station's remembered holder records (so the memory keeps them; idempotent if a save reloads the arrival).
//  - build: the plan's optional cart (world/fuelCarts.ts spawn) and the cans no holder could take (gen/fuelPlacement.ts: one per spot);
//    a realized station's remembered carts come back (loadStation); any loose fuel pickup holding more than one can is split into
//    single cans side by side (v1 saves laid two cans as one pickup: one visible can = one can, the quantity kept exactly).
//  - teardown: the record {v: 3, realized: true, carts, lots} is written into the station's memory together with the normal memory flush
//    (Game.leaveSection: hooks first, then saveSectionMemory) — a save taken before the first departure (new-game / arrival) regenerates
//    the same realization on load, never twice and never lost; a Retry rebuilds the entry state the same way. The ending save's
//    non-destructive memory capture writes it too (flush), so its Continue never realizes the station twice.
// Remaining fuel (the map, nodeFuel): the CURRENT station live (its fuel lots in holders, fuel pickups, cans in grounded bags — not the
// ones lying in the parked train: its cargo, task train-loose-cargo — its carts
// outside the car); a visited station with a realized record from its memory (recorded lots its holders still list, remembered fuel
// cans, cans in remembered bags, its carts; a v1 station + its pending delta); otherwise (known, never built, or visited before fuel
// existed) its PLAN. Fuel moved aboard the train is not the station's any more.
//
// Task gameplay-feedback-20261111 (lane FUEL-LOOT; user: fuel is scarce at the first station after the start). The `holders` phase runs
// BEFORE Game.buildSectionSteps moves run.current to the station being built ('arrival' step), and v2 read run.current: every journey's
// destination was realized under the DEPARTURE station's key. Measured (6 real networks, Game's order): the first station after the start
// realized 0 of its 6-25 planned units every time (the start's own record matched against the new layout: 'kept', no key in common), each
// later station got the PREVIOUS station's plan, a revisit could refill, and the teardown wrote the record under the departure's key.
// Now Game passes the key being built (`holders(layout, key)`), and the record says so: v3. Saves of the v2 releases (legacy, below):
//  - a v3 record: exactly its lots (kept); a v1 record: the one additive delta (v1 realized in the build phase: correctly keyed);
//  - a station some v2 record lists holders of (it WAS realized, whichever key that record has: the start, every station a v2 release
//    built with a plan): exactly the fuel lots its own holder memory still lists (the cans left there), in the same holders with the same
//    lot ids — at this station's own slot for the lot, else a free spot in that holder (gen/fuelHolders.ts refitFuelLot), else loose — and
//    its own record's carts (a cart whose pose is not on this layout's floor is re-placed on the cart spot, else laid as cans). No new fuel;
//  - a visited station no record lists (never realized: before fuel existed, or a v2 release's first station after the start, which got
//    none): its plan once, the searched containers left out (the existing rule for stations visited before fuel existed).
// The next teardown writes a v3 record; from then on the station is kept exactly.
import type {Game} from '../game';
import type {SectionKey} from '../levels/types';
import type {StationLayout} from '../gen/stationTypes';
import {FUEL, FUEL_LANE, FUEL_LOTS_MAX, parseFuelLotKey, stationFuelPlan, stationFuelPlanV1, stationFuelProblem, stationFuelRemaining, type StationCartJSON, type StationFuelJSON} from '../fuel/fuel';
import {placeStationFuel} from '../gen/fuelPlacement';
import {FUEL_HOLDERS, chooseFuelSlots, fuelHolderSlots, isFuelLotId, refitFuelLot, type FuelHolderIn, type FuelSlot} from '../gen/fuelHolders';
import {BAG_LANE} from '../run/bagStore';
import {holderKeyOf} from '../run/worldMemory';
import type {ContainerManager, Holder} from './containers';
import type {ItemStack} from '../items/inventory';

/**
 * Section-memory lane: {v: 1} = this station's fuel was realized by a release writing v2 station records (see the header); read until its
 * v3 record is written (the flush then drops it).
 */
export const FUEL_LEGACY_LANE = 'fuel.legacy';
/** Runs whose v2 evidence was already read (markLegacy). */
const legacyMarked = new WeakSet<object>();

/** What world/fuelCarts.ts offers the station coordinator (optional: absent = no carts). */
export interface StationCartsApi {
  spawn(rec: StationCartJSON): void;
  stationRecords(): StationCartJSON[];
  loadStation(recs: readonly StationCartJSON[]): void;
}

/** A station's fuel for the map: quarter units and where the number comes from. */
export interface NodeFuel { units: number; source: 'planned' | 'remaining' | 'live' }

/** How this build treats the station's fuel ('legacy': a station a v2 release realized — see the header). */
type Mode = 'kept' | 'plan' | 'delta' | 'legacy';

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
      holders: (layout, key) => this.holders(layout as unknown as StationLayout, key),
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
      if (h.prop.cargo) continue; // task train-all-cargo: a carried holder (always open and empty) is never a fuel slot: the generated order stays
      const key = holderKeyOf(h);
      byKey.set(key, h);
      ins.push({key, kind: h.kind, index: h.index, area: h.prop.area, level: h.prop.level ?? 0, x: h.prop.x, z: h.prop.z, surfaces: h.surfaces, lots: h.state.lots});
    }
    return {ins, byKey};
  }

  /**
   * ONCE per run, before any v3 record replaces a v2 one: every visited station some v2 record lists holders of (whichever key that
   * record has) was realized by a v2 release — marked in its own memory (FUEL_LEGACY_LANE), so the evidence outlives the v2 records.
   */
  private markLegacy(): void {
    const run = this.game.run, c = run.campaign;
    if (!c || legacyMarked.has(run)) return;
    legacyMarked.add(run);
    const keyOf = (n: {id: string; archetype: SectionKey['level']}): SectionKey => ({level: n.archetype, section: 'main', station: n.id});
    const v2 = new Set<string>();
    for (const n of c.network.nodes) {
      const r = this.record(keyOf(n));
      if (r?.v === 2) for (const k of r.lots ?? []) v2.add(parseFuelLotKey(k).holder);
    }
    if (!v2.size) return;
    for (const n of c.network.nodes) {
      const key = keyOf(n), mem = run.peekMemory(key);
      if (!mem || mem.lanes[FUEL_LEGACY_LANE] !== undefined || this.record(key)?.v === 3) continue;
      if (Object.keys(mem.holders).some(hk => v2.has(hk))) run.setLaneStore(FUEL_LEGACY_LANE, {v: 1}, key);
    }
  }

  /** A station a v2 release realized whose record is not v3 yet (see the header). */
  private legacyAt(key: SectionKey, rec: StationFuelJSON | null): boolean {
    this.markLegacy();
    return rec?.v !== 3 && this.game.run.laneStore(FUEL_LEGACY_LANE, key) !== undefined;
  }

  /**
   * The lots `keys` (`<holderKey>#<lotId>`) on this build: this layout's slot for the key, else a free spot in that holder (a lot an
   * older release placed under another station's id: gen/fuelHolders.ts refitFuelLot); `short` = the ones no holder can take (laid loose).
   */
  private placeKeys(keys: readonly string[], slots: readonly FuelSlot[], ins: readonly FuelHolderIn[], layoutSeed: number): {chosen: FuelSlot[]; short: number} {
    const bySlot = new Map(slots.map(s => [s.key, s])), byHolder = new Map(ins.map(h => [h.key, h]));
    const chosen: FuelSlot[] = [], placed = new Map<string, FuelSlot['lot'][]>();
    let short = 0;
    const missing: string[] = [];
    for (const k of keys) {
      const s = bySlot.get(k);
      if (s) { chosen.push(s); placed.set(s.holder, [...(placed.get(s.holder) ?? []), s.lot]); } else missing.push(k);
    }
    for (const k of missing) {
      const {holder, lot: id} = parseFuelLotKey(k), h = byHolder.get(holder);
      const lot = h ? refitFuelLot(h, id, placed.get(holder) ?? [], layoutSeed) : null;
      if (!h || !lot) { short++; continue; }
      chosen.push({key: k, holder, lot, area: h.area, pass: id % 1000 - FUEL_HOLDERS.lotBase});
      placed.set(holder, [...(placed.get(holder) ?? []), lot]);
    }
    return {chosen, short};
  }

  /**
   * A legacy record's carts on this layout: a cart standing on this layout's floor (its storey's walkable cell, about its height) stays;
   * another is re-placed on the station's cart spot (gen/fuelPlacement.ts), else its units become loose cans (`cans`). Never lost.
   */
  private legacyCarts(layout: StationLayout, carts: readonly StationCartJSON[], station: string): {carts: StationCartJSON[]; cans: number} {
    const out: StationCartJSON[] = [];
    let cans = 0;
    for (const c of carts) {
      const g = layout.levels?.[c.level]?.grid ?? (c.level === 0 ? layout.grid : null);
      const [cx, cy] = g ? g.cellOf(c.x, c.z) : [0, 0];
      if (g && g.inBounds(cx, cy) && g.walkable(cx, cy) && Math.abs(g.floorOf(g.idx(cx, cy)) - c.y) < 0.6) { out.push({...c}); continue; }
      const spot = placeStationFuel(layout, {units: c.units, cans: 0, cart: c.units}, `${station}:${c.uid}`).cart;
      if (spot) out.push({uid: c.uid, units: c.units, ...spot});
      else cans += c.units / FUEL.canUnits;
    }
    return {carts: out, cans};
  }

  /**
   * A run-wide unique id for a newly realized cart: `cart:<station>`, unless the train carries that id or another station's record lists
   * it (a v2 release named the cart it realized at a journey's destination after the DEPARTURE station).
   */
  private freshCartUid(station: string): string {
    const used = new Set<string>();
    const cargo = (this.game as unknown as {fuelCarts?: {cargo?(): {uid: string}[]}}).fuelCarts;
    for (const c of typeof cargo?.cargo === 'function' ? cargo.cargo() : []) used.add(c.uid);
    for (const n of this.game.run.campaign?.network.nodes ?? []) {
      if (n.id !== station) for (const c of this.record({level: n.archetype, section: 'main', station: n.id})?.carts ?? []) used.add(c.uid);
    }
    const base = `cart:${station}`;
    if (!used.has(base)) return base;
    for (let k = 2; ; k++) if (!used.has(`${base}~${k}`)) return `${base}~${k}`;
  }

  /**
   * Phase 1 (right after the holders are built): decide the realization and place the fuel lots. `buildKey` = the section being built
   * (Game passes it: run.current is still the departure during a journey's build); absent = run.current (a build outside a journey).
   */
  holders(layout: StationLayout, buildKey?: SectionKey): void {
    const key = buildKey ?? this.game.run.current, seed = this.networkSeed();
    this.live = null;
    this.stage = null;
    if (!key.station || seed === null) return; // fuel exists in campaign runs only
    this.live = {...key};
    const cm = this.containers;
    const {ins, byKey} = cm ? this.holderInputs(cm) : {ins: [], byKey: new Map<string, Holder>()};
    const slots = cm ? fuelHolderSlots(layout, ins, key.station) : [];
    const rec = this.record(key);
    const mem = this.game.run.peekMemory(key);
    const recs = mem?.holders ?? {};
    const legacy = this.legacyAt(key, rec);
    let chosen: FuelSlot[];
    if (rec?.realized && rec.v === 3) {
      // (a recorded lot no holder can take any more is dropped, never laid loose: a kept build adds nothing)
      chosen = this.placeKeys(rec.lots ?? [], slots, ins, layout.seed).chosen;
      this.stage = {mode: 'kept', lots: [...(rec.lots ?? [])], short: 0, cart: 0, carts: rec.carts};
    } else if (legacy) {
      // a v2 release realized it: the cans its holders still remember, no new fuel (see the header)
      const keys: string[] = [];
      for (const [hk, hr] of Object.entries(recs)) for (const id of hr.lots) if (isFuelLotId(id)) keys.push(`${hk}#${id}`);
      const p = this.placeKeys(keys.slice(0, FUEL_LOTS_MAX), slots, ins, layout.seed);
      chosen = p.chosen;
      const lc = this.legacyCarts(layout, rec?.carts ?? [], key.station);
      this.stage = {mode: 'legacy', lots: chosen.map(s => s.key), short: p.short + lc.cans, cart: 0, carts: lc.carts};
    } else {
      const plan = stationFuelPlan(seed, key.station);
      const delta = rec?.realized === true && rec.v === 1; // a v1 station: ONE additive delta, its v1 cans / cart untouched
      const n = delta ? Math.max(0, plan.units - stationFuelPlanV1(seed, key.station).units) / FUEL.canUnits : plan.cans;
      // a v2 record of a station never realized (a v2 release's first station after the start) holds the carts left at the station built
      // after it: they stay in the world (here), never lost
      const lc = !delta && rec?.v === 2 ? this.legacyCarts(layout, rec.carts, key.station) : null;
      // a visited station: containers the player already opened (searched) are left out (no fuel appears in an emptied cupboard)
      const skip = (hk: string) => !!recs[hk]?.searched && byKey.get(hk)?.group === 'container';
      const inLots = Math.min(n, FUEL_LOTS_MAX); // (the record lists at most FUEL_LOTS_MAX lots; a plan has at most 28 cans)
      const pick = chooseFuelSlots(slots, inLots, skip);
      chosen = pick.chosen;
      this.stage = {mode: delta ? 'delta' : 'plan', lots: chosen.map(s => s.key), short: pick.short + n - inLots + (lc?.cans ?? 0), cart: delta ? 0 : plan.cart, carts: delta ? rec!.carts : lc ? lc.carts : null};
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
        if (c) { c.spawn({uid: this.freshCartUid(key.station), units: st.cart, ...place.cart}); cart = true; }
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
    this.flush();
    this.live = null;
    this.stage = null;
  }

  /**
   * Write the station's record now (teardown; and Game.commitEndingSave's NON-destructive capture, which flushes the live section's
   * memory without leaving it — the record must go with that memory, or a Continue would realize the plan a second time).
   */
  flush(): void {
    const key = this.live, st = this.stage;
    if (!key || !st) return;
    const rec: StationFuelJSON = {v: 3, realized: true, carts: this.carts?.stationRecords() ?? [], lots: st.lots};
    this.game.run.setLaneStore(FUEL_LANE, rec, key);
    this.game.run.setLaneStore(FUEL_LEGACY_LANE, undefined, key); // (a v3 record now: the legacy mark has done its job)
  }

  /** Fuel units in the live station right now (its fuel lots in holders, pickups, cans in its grounded bags, its carts outside the car). */
  liveUnits(): number {
    const g = this.game as unknown as {pickups: {list: readonly {owner?: string; stack: {itemId: string; count: number; bag?: readonly ({itemId: string; count: number} | null)[]}}[]}; gear?: {bags?: readonly {stack: {bag?: readonly ({itemId: string; count: number} | null)[]}}[]}};
    let lots = 0;
    for (const h of this.containers?.all ?? []) for (const l of h.state.lots) if (l.itemId === FUEL.canItem) lots += l.count * FUEL.canUnits;
    // (task train-loose-cargo: cans / bags lying in the parked train are the train's cargo, not the station's stock)
    // (task studio-market-rework-20261108-074144-01, lane WARES: a market stall's displayed cans are its stock for sale — Pickup.owner —
    // never the station's fuel; the remembered figure never counts them either: run/worldMemory.ts capturePickups)
    const cargo = (this.game as unknown as {trainCargo?: {ownsPickup(p: unknown): boolean; ownsBag(b: unknown): boolean}}).trainCargo;
    const free = g.pickups.list.filter(p => !p.owner);
    const pickups = cargo ? free.filter(p => !cargo.ownsPickup(p)) : free;
    const bags = cargo ? (g.gear?.bags ?? []).filter(b => !cargo.ownsBag(b)) : g.gear?.bags ?? [];
    return lots + stationFuelRemaining({pickups, bags, carts: this.carts?.stationRecords() ?? []});
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
      const bags = (run.laneStore<{bags?: {stack: {bag?: ({itemId: string; count: number} | null)[]}}[]}>(BAG_LANE, key)?.bags) ?? [];
      if (this.legacyAt(key, rec)) {
        // realized by a v2 release (legacy, see the header): the fuel lots its holders still list + loose / bagged cans + its record's carts
        let lots = 0;
        for (const hr of Object.values(mem.holders)) for (const id of hr.lots) if (isFuelLotId(id)) lots += FUEL.canUnits;
        return {units: lots + stationFuelRemaining({pickups: mem.pickups as never, bags, carts: rec?.carts ?? []}), source: 'remaining'};
      }
      if (rec?.realized && rec.v !== 2) { // (a v2 record nothing realized here: the plan its next build realizes)
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
