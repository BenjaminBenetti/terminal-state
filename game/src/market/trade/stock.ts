// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE STALLS' STOCK — real, finite ItemStacks per market station.
//
// SEEDED ONCE: on the station's first build (market/trade/tradeSystem.ts), from the station's own seed + scope in a hashed RNG namespace
// per stall (`market-stock-v1:<scope>:<stall>`: never a draw on the layout / loot / enemy / fuel streams). The stacks are made by the
// run's Inventory (makeStack: its uid counter, so every stock uid is unique run-wide; a gun comes with a full magazine), then written at
// once into that station's lane memory (MARKET_STOCK_LANE, run.setLaneStore) and REMEMBERED: a revisit, a reload, opening the view or a
// Retry loads the record and never seeds or refills again. Every trade writes the record back in the same step (the memory is always
// the live stock: saves at departure / arrival / the ending need no flush). Sold items JOIN the stall's stock (merging onto a plain
// stack of the same item, else as the same stack: uid and condition kept); bought items LEAVE it.
//
// WHAT each stall stocks (bounded quantities, drawn from the loot-table foundation's pools — items/lootTables.ts — not a new item list):
//  - gun: 1-2 guns (the weapons the item registry has) + 4-6 boxes of generic ammo (GLOBAL_POOL.ammo, BOX_COUNT big boxes);
//  - medical: 4-6 lots of HP medicine (GLOBAL_POOL.med) and limb treatments (LIMB_ECONOMY.pool);
//  - fuel: fuel cans for one hop up to the train's full capacity (FUEL.hopUnits .. trainCapacityUnits(), in FUEL.canUnits per can; never a
//    hard-coded tank) + 1-2 lots of rail supplies (flares, cells). Ordinary cans: it is not a refuelling service;
//  - general: 7-10 lots of food, drink, cells, flares (GLOBAL_POOL) and spare gas filters;
//  - gear: 3-4 distinct pieces (GEAR_WEIGHTS + the gas mask), some part-used (a mask's fitted filter, an airtank's air);
//  - scrap: 3-5 lots of crafting materials (GLOBAL_POOL.material);
//  - bar (task studio-market-bar-20261108-225231-01, layout version 3's bartender only): every one of the five beers (items/beers.ts BEER_IDS:
//    BAR_BEER_COUNTS bottles each — the four timed beers 3-6, the Bock 2-4) + 1-2 small lots of ordinary drinks (GLOBAL_POOL.drink).
// Task studio-market-bar-20261108-225231-01: a station seeds the stalls ITS layout places (versions 1 / 2: the six, in the same order and
// with the same uids as before; version 3: + the bar, last), and its record lists the bar only when the bar holds something (a market
// without a bar writes exactly the six as before; an old record without `bar` loads with an empty bar).
// LOADING never throws: each stall's list goes through the Lockbox's sanitising stack loader (run/trainLockbox.ts — the same serializer
// every store uses: mag / filter / air / armor wear are kept exactly, clamped like the Lockbox's); a uid already seen in another stall is dropped (and, task
// studio-market-rework-20261108-074144-01, a restart part or Rail Ties: never stock). A strict check of the saved record is save/validate.ts
// (marketStock).
import {Rng, hashString} from '../../core/rng';
import {ITEMS, type ItemDef} from '../../items/items';
import {WEAPONS} from '../../weapons/weapons';
import {isVarietyWeapon} from '../../weapons/varietyIds'; // task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI)
import {gearSpec, isAirtank, isFilterMask} from '../../items/gear';
import {BOX_COUNT, GEAR_WEIGHTS, GLOBAL_POOL, LIMB_ECONOMY, type ItemRows, type LotRange} from '../../items/lootTables';
import {FUEL} from '../../fuel/fuel';
import {stackToJSON, stacksIn, type ItemStack, type StackJSON} from '../../items/inventory';
import {TrainLockbox} from '../../run/trainLockbox';
import {BAR_STALL, MARKET_STALLS, MARKET_STALLS_ALL, type MarketStallId} from '../../gen/market/marketTypes';
import {BEER_IDS, type BeerId} from '../../items/beers';
import {GAS_FILTER_ID} from './value';

/** Section-memory lane of a market station's stock (save/validate.ts checks it strictly). */
export const MARKET_STOCK_LANE = 'market.stock';
/** Most stacks one stall's stock may hold (sold items merge first; a sale that would pass it is refused, nothing changes). */
export const STOCK_MAX = 96;

export interface MarketStockJSON { v: 1; stalls: Record<typeof MARKET_STALLS[number], StackJSON[]> & {bar?: StackJSON[]} }

/** Task studio-market-bar-20261108-225231-01 (lane BAR): bottles of each beer the bartender starts with (inclusive ranges; finite, never refilled). */
export const BAR_BEER_COUNTS: Readonly<Record<BeerId, LotRange>> = {
  beer_lager: [3, 6], beer_pilsner: [3, 6], beer_stout: [3, 6], beer_porter: [3, 6], beer_bock: [2, 4],
};

/** The train's built-in fuel capacity in quarter units (FUEL.trainTankUnits: two tanks; FUEL.tankUnits is one tank = one hop). Never a literal. */
export function trainCapacityUnits(): number {
  return FUEL.trainTankUnits;
}

/** A stack factory with the run's uid counter (Inventory.makeStack). */
export type MakeStack = (itemId: string, count: number) => ItemStack;

type Draw = {itemId: string; count: number};

/** Weighted lots from rows (`distinct`: each item once). */
function lots(rng: Rng, rows: ItemRows, range: LotRange, count: (d: ItemDef) => number, distinct = false): Draw[] {
  const out: Draw[] = [];
  let pool = rows.filter(r => ITEMS[r[0]] && r[1] > 0);
  const n = rng.int(range[0], range[1]);
  for (let i = 0; i < n && pool.length; i++) {
    const id = rng.weighted(pool);
    out.push({itemId: id, count: count(ITEMS[id])});
    if (distinct) pool = pool.filter(r => r[0] !== id);
  }
  return out;
}

const small = (rng: Rng, hi: number) => (d: ItemDef) => rng.int(1, Math.max(1, Math.min(hi, d.stackMax)));
const box = (rng: Rng) => (d: ItemDef) => { const b = BOX_COUNT[d.id]; return b ? rng.int(b.big[0], b.big[1]) : rng.int(1, d.stackMax); };

/**
 * The weapons the item registry holds (guns first; melee half as often). Task studio-weapon-variety-production-20261109-224355-01 (lane
 * LOOT-UI, the lead's loot decision: vendor / market stock UNCHANGED): the twelve variety weapons (weapons/varietyIds.ts) are never seeded
 * here — the gunsmith keeps exactly its baseline rows and draws (they arrive only as diversified weapon finds; a player may still sell one).
 */
const weaponRows = (): ItemRows => Object.values(ITEMS).filter(d => d.kind === 'weapon' && d.weaponId && WEAPONS[d.weaponId] && !isVarietyWeapon(d.id))
  .map(d => [d.id, WEAPONS[d.weaponId!].melee ? 0.5 : 1] as const);

/** What one stall stocks (the draws of its own stream; counts before merging). */
export function stallDraws(stall: MarketStallId, rng: Rng): Draw[] {
  switch (stall) {
    case 'gun': return [...lots(rng, weaponRows(), [1, 2], () => 1, true), ...lots(rng, GLOBAL_POOL.ammo, [4, 6], box(rng))];
    case 'medical': return lots(rng, [...GLOBAL_POOL.med, ...LIMB_ECONOMY.pool], [4, 6], small(rng, 2));
    case 'fuel': {
      const units = rng.int(FUEL.hopUnits, Math.max(FUEL.hopUnits, trainCapacityUnits()));
      const cans = Math.max(1, Math.floor(units / FUEL.canUnits));
      return [{itemId: FUEL.canItem, count: cans}, ...lots(rng, [...GLOBAL_POOL.flare, ...GLOBAL_POOL.battery], [1, 2], small(rng, 3))];
    }
    case 'general': return lots(rng, [...GLOBAL_POOL.food, ...GLOBAL_POOL.drink, ...GLOBAL_POOL.battery, ...GLOBAL_POOL.flare, [GAS_FILTER_ID, 0.6]], [7, 10], small(rng, 3));
    case 'gear': return lots(rng, [...Object.entries(GEAR_WEIGHTS), ['gas_mask', 1]], [3, 4], () => 1, true);
    case 'scrap': return lots(rng, GLOBAL_POOL.material, [3, 5], d => rng.int(2, Math.min(6, d.stackMax)));
    // (task studio-market-bar-20261108-225231-01) the bartender: all five beers, then a little ordinary drink
    case 'bar': return [...BEER_IDS.map(id => ({itemId: id, count: rng.int(BAR_BEER_COUNTS[id][0], BAR_BEER_COUNTS[id][1])})), ...lots(rng, GLOBAL_POOL.drink, [1, 2], small(rng, 3))];
  }
}

/** A stack carries condition of its own (mag / filter / air / bag / wear): it is never merged with another. */
const plain = (s: ItemStack) => s.mag === undefined && s.filter === undefined && s.air === undefined && !s.bag && s.armor === undefined;

/**
 * Put `piece` into a stock list: merged onto plain stacks of the same item up to stackMax, the rest as the SAME stack (uid kept). Returns
 * false (nothing changed) when the rest needs a new entry and the list is full.
 */
export function addToStock(list: ItemStack[], piece: ItemStack): boolean {
  const d = ITEMS[piece.itemId];
  if (!d) return false;
  const targets = d.stackMax > 1 && plain(piece) ? list.filter(s => s.itemId === piece.itemId && plain(s) && s.count < d.stackMax) : [];
  const room = targets.reduce((n, s) => n + d.stackMax - s.count, 0);
  if (room < piece.count && list.length >= STOCK_MAX) return false;
  let left = piece.count;
  for (const s of targets) {
    if (!left) break;
    const k = Math.min(left, d.stackMax - s.count);
    s.count += k;
    left -= k;
  }
  if (left > 0) { piece.count = left; list.push(piece); }
  return true;
}

/** Whether `piece` can go into a stock list (addToStock would succeed). */
export function stockHasRoom(list: readonly ItemStack[], piece: ItemStack): boolean {
  if (list.length < STOCK_MAX) return true;
  const d = ITEMS[piece.itemId];
  if (!d || d.stackMax <= 1 || !plain(piece)) return false;
  return list.filter(s => s.itemId === piece.itemId && plain(s)).reduce((n, s) => n + d.stackMax - s.count, 0) >= piece.count;
}

const emptyStalls = (): Record<MarketStallId, ItemStack[]> => Object.fromEntries(MARKET_STALLS_ALL.map(s => [s, [] as ItemStack[]])) as Record<MarketStallId, ItemStack[]>;

/** The RNG namespace of a stall's stock at one market station (scope = the station id; seed = its world seed). */
export function stockRng(scope: string, seed: number, stall: MarketStallId): Rng {
  return new Rng(hashString(`market-stock-v1:${scope}:${stall}`, (seed >>> 0) ^ 0x2545f491));
}

export class MarketStock {
  /** The live stock per stall (the open view and the transactions hold these lists). */
  readonly stalls: Record<MarketStallId, ItemStack[]> = emptyStalls();
  /** Bumped by every change (the open view redraws). */
  version = 0;

  /**
   * The station's first stock (deterministic contents per scope + seed; uids from `make`) for the stalls its layout places (`stalls`,
   * default the six; seeded in the fixed MARKET_STALLS_ALL order whatever order they are given in — the bar last).
   */
  static seed(scope: string, seed: number, make: MakeStack, stalls: readonly MarketStallId[] = MARKET_STALLS): MarketStock {
    const st = new MarketStock();
    for (const stall of MARKET_STALLS_ALL.filter(s => stalls.includes(s))) {
      const rng = stockRng(scope, seed, stall), list = st.stalls[stall];
      for (const d of stallDraws(stall, rng)) {
        let left = d.count;
        while (left > 0) {
          const s = make(d.itemId, left);
          left -= s.count;
          // part-used gear (its own stream; the stack keeps it): a mask with some filter fitted half the time, a used airtank
          if (isFilterMask(s.itemId) && rng.chance(0.5)) s.filter = Math.round(gearSpec(s.itemId)!.filterLife! * rng.range(0.25, 1) * 100) / 100;
          if (isAirtank(s.itemId)) s.air = Math.round(gearSpec(s.itemId)!.airLife! * rng.range(0.5, 1));
          if (!addToStock(list, s)) break;
        }
      }
    }
    return st;
  }

  /** A saved record back as live stacks (sanitised; never throws; a stall missing from it is empty). */
  static fromJSON(j: unknown): MarketStock {
    const st = new MarketStock();
    const src = j && typeof j === 'object' && (j as {stalls?: unknown}).stalls && typeof (j as {stalls: unknown}).stalls === 'object'
      ? (j as {stalls: Record<string, unknown>}).stalls : {};
    const seen = new Set<number>();
    for (const stall of MARKET_STALLS_ALL) {
      const raw = Array.isArray(src[stall]) ? (src[stall] as unknown[]).slice(0, STOCK_MAX) : [];
      const box = new TrainLockbox(raw.length);
      box.load({v: 1, slots: raw});
      for (const s of box.slots) {
        const kind = s ? ITEMS[s.itemId]?.kind : undefined;
        if (!s || kind === 'part' || kind === 'currency' || stacksIn(s).some(x => seen.has(x.uid))) continue; // (lane TRADE, market rework: ties are money, never stock)
        for (const x of stacksIn(s)) seen.add(x.uid);
        st.stalls[stall].push(s);
      }
    }
    return st;
  }

  toJSON(): MarketStockJSON {
    const stalls = {} as MarketStockJSON['stalls'];
    for (const s of MARKET_STALLS) stalls[s] = this.stalls[s].map(x => stackToJSON(x)!);
    // (the bar only when it holds something: lossless — an absent bar loads empty — and a market without a bar writes the six as before)
    if (this.stalls[BAR_STALL].length) stalls[BAR_STALL] = this.stalls[BAR_STALL].map(x => stackToJSON(x)!);
    return {v: 1, stalls};
  }

  /** Every stock stack (all stalls). */
  all(): ItemStack[] {
    return MARKET_STALLS_ALL.flatMap(s => this.stalls[s]);
  }

  /** Highest uid held (bag contents included): the inventory's counter stays above it. */
  maxUid(): number {
    let m = 0;
    for (const s of this.all().flatMap(stacksIn)) m = Math.max(m, s.uid);
    return m;
  }

  /** "stall:item×count@mag" lines (QA / tests). */
  summary(stall: MarketStallId): string[] {
    return this.stalls[stall].map(s => `${s.itemId}x${s.count}${s.mag !== undefined ? `@${s.mag}` : ''}`);
  }
}
