// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE VALUE MODEL and the stalls' price rules (market/trade/value.ts, stalls.ts)
// — every price comes from the authoritative item data; condition (mag / filter / air / armor wear) is monotonic; every stall's buy-back is
// strictly below every stall's price for every item, condition and count (no arbitrage, also by splitting / merging / loading rounds or
// fitting filters); every ordinary item sells somewhere (the general store and the scrapyard buy broadly); the reactor parts never sell;
// a bag with contents is refused; the fuel stall works in the common fuel units and reads the train's capacity from FUEL.
import {describe, expect, it} from 'vitest';
import {ITEMS, type ItemDef} from '../src/items/items';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {WEAPONS} from '../src/weapons/weapons';
import {CALIBERS} from '../src/items/calibers';
import {FILTER_LIFE_S, gearSpec, isAirtank, isBagItem, isFilterMask} from '../src/items/gear';
import {GAS_FILTER_ID as LOOT_FILTER_ID} from '../src/gen/maskLoot';
import {GAS_MASK} from '../src/gear/gasMask';
import {FUEL} from '../src/fuel/fuel';
import {MARKET_STALLS, type MarketStallId} from '../src/gen/market/marketTypes';
import {CENTS, GAS_FILTER_ID, VALUE, baseCents, isTradeable, rarityFactor, roundCents, stackUnitCents} from '../src/market/trade/value';
import {STALL_TRADE, TRADE_RATES, buyBackPct, buyPrice, sellQuote} from '../src/market/trade/stalls';
import {MarketStock, stallDraws, stockRng, trainCapacityUnits} from '../src/market/trade/stock';

const inv = new Inventory();
const ALL = Object.values(ITEMS);
const TRADEABLE = ALL.filter(d => d.kind !== 'part');

/** A stack of an item at a given condition fraction (0 = empty magazine / no filter / no air / armor gone, 1 = full). */
function at(d: ItemDef, frac: number, count = 1): ItemStack {
  const s = inv.makeStack(d.id, count);
  if (d.kind === 'weapon') s.mag = Math.round(WEAPONS[d.weaponId!].magazine * frac);
  if (isFilterMask(d.id)) s.filter = gearSpec(d.id)!.filterLife! * frac;
  if (isAirtank(d.id)) s.air = gearSpec(d.id)!.airLife! * frac;
  if ((gearSpec(d.id)?.armor ?? 0) > 0) (s as {armor?: number}).armor = gearSpec(d.id)!.armor! * frac; // (another task's optional wear field)
  return s;
}
const FRACS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
const sellOrNull = (stall: MarketStallId, s: ItemStack, n: number) => { const q = sellQuote(stall, s, n); return q.ok ? q.price : null; };

describe('market value model: from the item data', () => {
  it('every tradeable item has a value; the reactor restart parts have none and are refused everywhere with a reason', () => {
    for (const d of TRADEABLE) expect(baseCents(d.id), d.id).toBeGreaterThan(0);
    const parts = ALL.filter(d => d.kind === 'part');
    expect(parts.map(d => d.id).sort()).toEqual(['fuse_cartridge', 'reactor_key']);
    for (const d of parts) {
      expect([isTradeable(d.id), baseCents(d.id)]).toEqual([false, 0]);
      for (const st of MARKET_STALLS) {
        const q = sellQuote(st, inv.makeStack(d.id, 1), 1);
        expect(q.ok).toBe(false);
        if (!q.ok) { expect(q.code).toBe('part'); expect(q.text).toMatch(/reactor/); }
        expect(buyBackPct(st, d.id)).toBeNull();
      }
    }
  });

  it('values follow the data: guns by sustained damage, consumables by what they restore (rarer finds a little more), stack-valued kinds by stack size', () => {
    expect(baseCents('rifle')).toBeGreaterThan(baseCents('shotgun'));
    expect(baseCents('shotgun')).toBeGreaterThan(baseCents('pistol'));
    expect(baseCents('pistol')).toBeGreaterThan(baseCents('knife'));
    expect(baseCents('medkit')).toBeGreaterThan(baseCents('bandage'));
    expect(baseCents('trauma_kit')).toBeGreaterThan(baseCents('leg_splint'));
    expect(baseCents('ramen_chashu')).toBeGreaterThan(baseCents('chocolate'));
    expect(rarityFactor('medkit')).toBeGreaterThan(rarityFactor('bandage')); // GLOBAL_POOL.med weights 0.35 vs 1
    // by stack size: a full stack of each ammo caliber / material / flare is worth the same; per unit, the bulkier stack is cheaper
    for (const id of ['ammo_9mm', 'ammo_556', 'ammo_12ga']) expect(Math.abs(baseCents(id) * ITEMS[id].stackMax - VALUE.stackTies.ammo * CENTS), id).toBeLessThanOrEqual(ITEMS[id].stackMax / 2); // (whole cents)
    expect(baseCents('bio_mater')).toBe(2 * baseCents('scrap_metal'));
    // the resources other systems define
    expect(baseCents(GAS_FILTER_ID)).toBe(Math.round(FILTER_LIFE_S * VALUE.filterPerSecond * CENTS));
    expect(baseCents(FUEL.canItem)).toBe(FUEL.canUnits * VALUE.fuelPerUnit * CENTS);
    // the filter id the value model names is the game's one
    expect([GAS_FILTER_ID, GAS_FILTER_ID]).toEqual([LOOT_FILTER_ID, GAS_MASK.filterItem]);
    // a NEW item is priced by the same rules the day it is added (no catalogue): a hypothetical bigger medkit / a new gun
    ITEMS.test_bigkit = {...ITEMS.medkit, id: 'test_bigkit', heal: 100};
    try { expect(baseCents('test_bigkit')).toBeGreaterThan(baseCents('medkit')); } finally { delete ITEMS.test_bigkit; }
  });

  it('condition is monotonic: loaded rounds, the fitted filter, the air left, the armor left (wear read only when present)', () => {
    for (const d of TRADEABLE) {
      const vals = FRACS.map(f => stackUnitCents(at(d, f)));
      for (let i = 1; i < vals.length; i++) expect(vals[i], `${d.id} @${FRACS[i]}`).toBeGreaterThanOrEqual(vals[i - 1]);
      const conditioned = (d.kind === 'weapon' && !!WEAPONS[d.weaponId!].caliber) || isFilterMask(d.id) || isAirtank(d.id) || (gearSpec(d.id)?.armor ?? 0) > 0;
      if (conditioned) expect(vals[vals.length - 1], d.id).toBeGreaterThan(vals[0]);
      else expect(new Set(vals).size, d.id).toBe(1);
    }
    // a loaded round is worth exactly a loose round of its caliber
    const rifle = at(ITEMS.rifle, 0);
    rifle.mag = 7;
    expect(stackUnitCents(rifle) - baseCents('rifle')).toBe(7 * roundCents(WEAPONS.rifle.caliber!));
    expect(roundCents('9x19mm')).toBe(baseCents(CALIBERS['9x19mm'].itemId));
    // absent wear = undamaged (a stack without the field is the full value)
    const vest = inv.makeStack('armor_vest', 1);
    expect(stackUnitCents(vest)).toBe(baseCents('armor_vest'));
  });
});

describe('market prices: no arbitrage, anywhere', () => {
  it('for every item, condition, count and stall: the buy-back is strictly below the price (rounded down vs up)', () => {
    let checked = 0;
    for (const d of TRADEABLE) for (const f of FRACS) {
      const counts = d.stackMax > 1 ? [1, 2, 3, Math.ceil(d.stackMax / 2), d.stackMax] : [1];
      for (const n of counts) {
        const s = at(d, f, n), buy = buyPrice(s, n);
        expect(buy, `${d.id} x${n}`).toBeGreaterThanOrEqual(1);
        const best = Math.max(0, ...MARKET_STALLS.map(st => sellOrNull(st, s, n) ?? 0));
        expect(best, `${d.id} @${f} x${n}`).toBeLessThan(buy);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
    for (const st of MARKET_STALLS) {
      const s = STALL_TRADE[st];
      expect(TRADE_RATES.themedPct).toBeLessThan(TRADE_RATES.buyPct);
      if (s.broadPct !== null) expect(s.broadPct).toBeLessThan(TRADE_RATES.themedPct);
    }
  });

  it('splitting / merging a stack cannot beat the spread (sum of sales <= the whole sale < the whole price <= sum of prices)', () => {
    for (const d of TRADEABLE.filter(x => x.stackMax > 1)) for (const st of MARKET_STALLS) {
      const n = d.stackMax, whole = at(d, 1, n);
      const parts = [1, Math.floor((n - 1) / 2), n - 1 - Math.floor((n - 1) / 2)].filter(k => k > 0);
      const sellWhole = sellOrNull(st, whole, n) ?? 0;
      const sellParts = parts.reduce((a, k) => a + (sellOrNull(st, at(d, 1, k), k) ?? 0), 0);
      const buyParts = parts.reduce((a, k) => a + buyPrice(at(d, 1, k), k), 0);
      expect(sellParts, `${d.id}@${st}`).toBeLessThanOrEqual(sellWhole);
      expect(sellWhole).toBeLessThan(buyPrice(whole, n));
      expect(buyPrice(whole, n)).toBeLessThanOrEqual(buyParts);
    }
  });

  it('moving condition between items cannot beat it either: an empty gun + loose rounds, an empty mask + a spare filter', () => {
    for (const d of ALL.filter(x => x.kind === 'weapon' && WEAPONS[x.weaponId!].caliber)) {
      const w = WEAPONS[d.weaponId!], round = inv.makeStack(CALIBERS[w.caliber!].itemId, w.magazine);
      const loaded = at(d, 1);
      for (const st of MARKET_STALLS) {
        const s = sellOrNull(st, loaded, 1);
        if (s !== null) expect(s, `${d.id}@${st}`).toBeLessThan(buyPrice(at(d, 0), 1) + buyPrice(round, w.magazine));
      }
    }
    const filter = inv.makeStack(GAS_FILTER_ID, 1);
    for (const st of MARKET_STALLS) {
      const s = sellOrNull(st, at(ITEMS.gas_mask, 1), 1);
      if (s !== null) expect(s).toBeLessThan(buyPrice(at(ITEMS.gas_mask, 0), 1) + buyPrice(filter, 1));
    }
  });
});

describe('market stalls: who buys what', () => {
  it('every ordinary item sells somewhere: the general store and the scrapyard take anything ordinary; a single unit is worth a tie somewhere (or the refusal names the count)', () => {
    for (const d of TRADEABLE) {
      for (const st of ['general', 'scrap'] as const) {
        const q = sellQuote(st, inv.makeStack(d.id, d.stackMax), d.stackMax);
        expect(q.ok, `${d.id}@${st}`).toBe(true);
        if (q.ok) expect(q.price).toBeGreaterThanOrEqual(1);
      }
      const one = inv.makeStack(d.id, 1);
      const best = Math.max(0, ...MARKET_STALLS.map(st => sellOrNull(st, one, 1) ?? 0));
      if (baseCents(d.id) * TRADE_RATES.themedPct >= CENTS * 100) expect(best, d.id).toBeGreaterThanOrEqual(1);
      else {
        const q = sellQuote(MARKET_STALLS.find(st => STALL_TRADE[st].deals(d))!, one, 1);
        expect(q.ok).toBe(false);
        if (!q.ok) { expect(q.code).toBe('too-little'); expect(q.text).toMatch(/sell at least \d+ at once/); }
      }
    }
  });

  it('themed stalls buy their own line at the themed share and refuse the rest, naming a stall that takes it', () => {
    const own: Record<MarketStallId, string[]> = {gun: ['rifle', 'knife', 'ammo_9mm'], medical: ['medkit', 'trauma_kit', 'arm_sling'], fuel: [FUEL.canItem, 'flare', 'battery'],
      general: ['water', 'beans', 'battery', 'flare', GAS_FILTER_ID], gear: ['armor_vest', 'gas_mask', 'airtank_backpack', 'backpack'], scrap: ['scrap_metal', 'electrical_parts', 'bio_mater']};
    for (const st of MARKET_STALLS) for (const id of own[st]) expect(buyBackPct(st, id), `${id}@${st}`).toBe(TRADE_RATES.themedPct);
    for (const st of ['gun', 'medical', 'fuel', 'gear'] as const) {
      const off = TRADEABLE.filter(d => !STALL_TRADE[st].deals(d));
      expect(off.length).toBeGreaterThan(0);
      for (const d of off) {
        const q = sellQuote(st, inv.makeStack(d.id, d.stackMax), d.stackMax);
        expect(q.ok).toBe(false);
        if (!q.ok) { expect(q.code).toBe('off-line'); expect(q.text).toMatch(/general store|scrapyard|medic|gunsmith|outfitter|fuel/i); }
      }
    }
    // the layout's signs are used when given
    const q = sellQuote('gun', inv.makeStack('water', 1), 1, {general: 'PANTRY', scrap: 'SCRAP KING'});
    expect(!q.ok && q.text).toMatch(/try PANTRY or SCRAP KING for the water/);
  });

  it('a backpack is bought empty only (its contents are never priced, deleted or duplicated); worn wear stays on the item', () => {
    const bag = inv.makeStack('backpack', 1);
    expect(isBagItem(bag.itemId) && sellQuote('gear', bag, 1).ok).toBe(true);
    bag.bag![3] = inv.makeStack('medkit', 2);
    const q = sellQuote('gear', bag, 1);
    expect(q.ok).toBe(false);
    if (!q.ok) { expect(q.code).toBe('bag-contents'); expect(q.text).toMatch(/Empty the backpack first/); }
    expect(stackUnitCents(bag)).toBe(baseCents('backpack')); // contents add nothing to the bag's value
  });

  it('the fuel stall: ordinary fuel cans in the common units, one hop up to the train\'s capacity read from FUEL (never a literal tank)', () => {
    expect(STALL_TRADE.fuel.deals(ITEMS[FUEL.canItem])).toBe(true);
    // a can's price is its units of fuel; two cans (a stack) twice that
    const can = inv.makeStack(FUEL.canItem, FUEL.canStackMax);
    expect(buyPrice(can, 1)).toBe(FUEL.canUnits * VALUE.fuelPerUnit);
    expect(buyPrice(can, FUEL.canStackMax)).toBe(FUEL.canStackMax * FUEL.canUnits * VALUE.fuelPerUnit);
    const canUnitsStocked = (seed: number) => stallDraws('fuel', stockRng('st-09', seed, 'fuel')).filter(d => d.itemId === FUEL.canItem).reduce((n, d) => n + d.count * FUEL.canUnits, 0);
    // this build's capacity: FUEL.trainTankUnits where it exists (the two-tank train another task adds), else one tank
    const own = (FUEL as unknown as {trainTankUnits?: number}).trainTankUnits;
    expect(trainCapacityUnits()).toBe(own ?? FUEL.tankUnits);
    for (let seed = 1; seed < 40; seed++) {
      const u = canUnitsStocked(seed);
      expect(u).toBeGreaterThanOrEqual(FUEL.hopUnits);
      expect(u).toBeLessThanOrEqual(trainCapacityUnits());
    }
    // a bigger train (three tanks, a value no build uses): the stall follows the constant, never a magic number
    const desc = Object.getOwnPropertyDescriptor(FUEL, 'trainTankUnits');
    Object.defineProperty(FUEL, 'trainTankUnits', {value: 12, configurable: true, enumerable: true, writable: true});
    try {
      expect(trainCapacityUnits()).toBe(12);
      const seen = new Set<number>();
      for (let seed = 1; seed < 80; seed++) { const u = canUnitsStocked(seed); expect(u).toBeGreaterThanOrEqual(FUEL.hopUnits); expect(u).toBeLessThanOrEqual(12); seen.add(u); }
      expect(Math.max(...seen)).toBeGreaterThan(2 * FUEL.tankUnits);
    } finally {
      if (desc) Object.defineProperty(FUEL, 'trainTankUnits', desc);
      else delete (FUEL as unknown as {trainTankUnits?: number}).trainTankUnits;
    }
    expect(trainCapacityUnits()).toBe(own ?? FUEL.tankUnits);
  });

  it('stock: themed per stall from the loot pools, bounded, deterministic per station + stall, independent stalls', () => {
    const mk = (id: string, n: number) => inv.makeStack(id, n);
    const a = MarketStock.seed('st-04', 777, mk), b = MarketStock.seed('st-04', 777, mk), c = MarketStock.seed('st-05', 777, mk);
    const contents = (s: MarketStock) => JSON.stringify(MARKET_STALLS.map(st => s.stalls[st].map(x => [x.itemId, x.count, x.mag, x.filter, x.air])));
    expect(contents(a)).toBe(contents(b));
    expect(contents(a)).not.toBe(contents(c));
    for (let seed = 1; seed < 30; seed++) {
      const s = MarketStock.seed(`st-${seed}`, seed * 7919, mk);
      for (const st of MARKET_STALLS) {
        const list = s.stalls[st];
        expect(list.length, st).toBeGreaterThan(0);
        expect(list.length).toBeLessThanOrEqual(14);
        for (const x of list) {
          expect(STALL_TRADE[st].deals(ITEMS[x.itemId]), `${x.itemId}@${st}`).toBe(true);
          expect(x.count).toBeLessThanOrEqual(ITEMS[x.itemId].stackMax);
          if (ITEMS[x.itemId].kind === 'weapon') expect(x.mag).toBe(WEAPONS[ITEMS[x.itemId].weaponId!].magazine); // guns come loaded
        }
      }
      const ammo = s.stalls.gun.filter(x => ITEMS[x.itemId].kind === 'ammo').reduce((n, x) => n + x.count, 0);
      expect(ammo).toBeLessThanOrEqual(6 * 12); // at most six big boxes: no free global ammo
      expect(s.stalls.gun.filter(x => ITEMS[x.itemId].kind === 'weapon').length).toBeLessThanOrEqual(2);
    }
  });
});
