// Task studio-market-bar-20261108-225231-01 (lane BAR; user: "A substantially sized upper-level bar with substantial props/tables, NPCs
// drinking, bartender selling beers"): THE SURVIVOR MARKET's layout version 3 (gen/market/v3/: version 2's container settlement plus the
// bar, the default for unvisited / new markets) over a seed sample —
//  - valid on its first attempts, deterministic, quick, both mirror states; version 2's settlement unchanged around it (the six shops);
//  - the bar: a deck at catwalk level over the yard, >= 45 m² under the shed roof, joined to the Yard stairs' landing and block C's catwalk,
//    every cell of it reachable on foot from the train door, railed on every drop, the yard below covered (its lamps under the deck);
//  - its furniture: a 4.5 m counter, backbar shelving, stools, bistro tables with chairs, lamps, its hanging name board, decor; nothing
//    holds loot (every holder: the exact empty key — never the base salvage key);
//  - the bartender behind the counter facing the customer spot; the stock's surfaces on the backbar shelves on the bartender's side
//    (never the counter top, never the customer side), within reach of the bartender's aisle; the stock fits them;
//  - 6-10 'drink' posts beside their stools / chairs, on clear floor, reachable on foot, never the customer spot;
//  - its look: fans from the shed roof over the deck; existing art only (the market may load the mall's café furniture).
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {levelsOf} from '../src/gen/levels';
import {isLootHolderKind} from '../src/items/loot';
import {itemDims, itemDef} from '../src/items/items';
import {BEER_IDS} from '../src/items/beers';
import {LEVELS} from '../src/levels/registry';
import {BAR_STALL, MARKET_STALLS, MARKET_STALLS_ALL} from '../src/gen/market/marketTypes';
import {MARKET_EMPTY_KEY, MARKET_POPULATION, barFloorArea, generateMarketLevel, marketLayoutIssues, marketStandOk} from '../src/gen/market/index';
import {SETTLE_GEN_STATS} from '../src/gen/market/v2/index';
import {SETTLE} from '../src/gen/market/v2/frame';
import {BAR_SPOTS} from '../src/gen/market/v3/barRecord';
import {marketFans} from '../src/gen/market/art';
import {settleAreaClass} from '../src/world/marketArch';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {WARES, stallSurfaces} from '../src/market/wares/slots';
import {planStall} from '../src/market/wares/plan';
import {MarketStock} from '../src/market/trade/stock';
import {Inventory} from '../src/items/inventory';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {P7_FILES, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {officeModelKeysFor} from '../src/gen/office/index';
import {MARKET_WORKSHOP_KEY} from '../src/items/lootTables';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 42, 777, 4242, 9001, 123456, 0xdeadbeef, 20261108];
const layouts = SEEDS.map(s => {
  const L = generateMarketLevel({levelSeed: s});
  return {seed: s, L, attempts: SETTLE_GEN_STATS.attempts, ms: SETTLE_GEN_STATS.ms};
});
const barOf = (L: StationLayout) => L.market!.stalls.find(s => s.id === BAR_STALL)!;

/** The walking distance field from the point outside the car's middle platform-side door (market-settlement.test.ts's). */
function fromTrainDoor(L: StationLayout, ladders = true): Int32Array[] {
  const tp = playerTrainPlacement(L)!;
  const doors = PLAYER_TRAIN_SPEC.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const w = trainToWorld(tp, doors[Math.floor(doors.length / 2)], PLAYER_TRAIN_SPEC.floorY, -(PLAYER_TRAIN_SPEC.width / 2 + 0.75));
  const [sx, sy] = L.grid.cellOf(w.x, w.z);
  return levelDistance(L.levels, sx, sy, 0, ladders ? L.levelLinks : []);
}

describe('the Survivor Market, layout version 3 (the settlement with the upper-level bar)', () => {
  it('is the default: valid for every seed on its first attempts, deterministic, quick, both mirror states; version 2 around it', () => {
    for (const {seed, L, attempts, ms} of layouts) {
      expect(L.market!.v, `seed ${seed}`).toBe(3);
      expect([seed, marketLayoutIssues(L)]).toEqual([seed, []]);
      expect(attempts, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(ms, `seed ${seed}`).toBeLessThan(400); // (version 2's budget)
      expect(L.market!.stalls.map(s => s.id)).toEqual([...MARKET_STALLS_ALL]);
      // version 2's settlement round it: the same station, the same six shops (names, counters, traders) as the station's version 2
      const v2 = generateMarketLevel({levelSeed: seed, layoutVersion: 2});
      expect(L.name).toBe(v2.name);
      const six = (q: StationLayout) => q.market!.stalls.filter(s => s.id !== BAR_STALL).map(s => ({id: s.id, name: s.name, counter: s.counter, trader: s.trader, front: s.front}));
      expect(six(L), `seed ${seed}`).toEqual(six(v2));
      expect(L.market!.residents).toBe(v2.market!.residents);
    }
    const sig = (L: StationLayout) => JSON.stringify({areas: L.areas, doors: L.doors, props: L.props, lights: L.lights, signs: L.signs, market: L.market, rails: L.rails, links: L.levelLinks});
    expect(sig(generateMarketLevel({levelSeed: SEEDS[0]}))).toBe(sig(layouts[0].L));
    expect(sig(generateMarketLevel({levelSeed: SEEDS[0], layoutVersion: 3}))).toBe(sig(layouts[0].L));
    expect(sig(LEVELS.market.generate('main', {levelSeed: SEEDS[0]}))).toBe(sig(layouts[0].L));
    expect(new Set(layouts.map(({L}) => L.levelLinks[0].bottom.x > L.grid.w * CELL / 2)).size).toBe(2); // both mirror states
    expect(new Set(layouts.map(({L}) => barOf(L).name)).size).toBeGreaterThan(1); // the bar's painted name is seeded
  });

  it('the bar: a >= 45 m² deck at catwalk level over the yard under the shed roof, joined to the Yard stairs and block C, on foot from the train', () => {
    for (const {seed, L} of layouts) {
      const bar = barOf(L), a = L.areas[bar.area], g0 = L.grid, g1 = L.levels[1].grid, tag = `seed ${seed}`;
      expect([a.level, a.kind, a.publicSpace, bar.counter.level, bar.counter.y], tag).toEqual([1, 'concourse', true, 1, SETTLE.bases[1]]);
      expect(a.label).toBe(bar.name);
      expect(settleAreaClass(a)).toBe('catwalk'); // (the deck's plywood boards)
      const area = barFloorArea(L, a.id);
      expect(area, tag).toBeGreaterThanOrEqual(45);
      const yard = L.areas.find(q => q.label === 'The Yard' && !q.level)!;
      const walk = fromTrainDoor(L, false);
      let cells = 0, overYard = 0, stair = false, ring = false;
      for (let i = 0; i < g1.cells.length; i++) {
        if (g1.area[i] !== a.id) continue;
        cells++;
        expect(g1.cells[i], tag).toBe(FLOOR);
        // the shed roof over it (5.65 m of headroom), the ground under it covered at a container's height
        expect(g1.floorOf(i), tag).toBeCloseTo(SETTLE.bases[1], 5);
        expect(g1.ceil[i], tag).toBeCloseTo(SETTLE.roofY, 5);
        if (g0.cells[i] === FLOOR) expect(g0.ceil[i], tag).toBeCloseTo(SETTLE.cont, 6);
        if (g0.area[i] === yard.id) overYard++;
        if (!g1.blocked[i]) expect(walk[1][i], `${tag} bar cell ${i} on foot from the train`).toBeGreaterThanOrEqual(0);
        for (const j of [i - 1, i + 1, i - g1.w, i + g1.w]) {
          const b = L.areas[g1.area[j]];
          if (!b || g1.cells[j] !== FLOOR || g1.area[j] === a.id) continue;
          if (b.role === 'stair' && g1.rampIdx[j] < 0 && Math.abs(g1.floorOf(j) - SETTLE.bases[1]) < 1e-6) stair = true;
          if (b.role === 'catwalk' && b.label === 'Catwalk') ring = true;
        }
      }
      expect(cells * CELL * CELL).toBeCloseTo(area, 6);
      expect(overYard * CELL * CELL, tag).toBeGreaterThanOrEqual(35); // most of it over the yard (the rest over the lanes' edges)
      expect([stair, ring], `${tag} joined to the Yard stairs' landing and block C's catwalk`).toEqual([true, true]);
      // every drop railed (the shared derivation); the covered yard's lamps hang under the deck
      expect(levelsOf(L).unrailedDrops().filter(r => r.level === 1).length, tag).toBe(0);
      for (const l of L.lights.filter(q => q.area === yard.id)) expect(l.y, tag).toBeLessThan(SETTLE.cont);
    }
  });

  it('its furniture: a long counter, backbar shelving, stools, bistro tables with chairs, lamps, its name board; nothing holds loot', () => {
    for (const {seed, L} of layouts) {
      const bar = barOf(L), tag = `seed ${seed}`;
      const own = L.props.filter(p => p.area === bar.area && p.level === 1), n = (k: string) => own.filter(p => p.kind === k && p.host === undefined).length;
      expect(n('shopCounter'), tag).toBe(3);
      expect(bar.counter.x1 - bar.counter.x0, tag).toBeCloseTo(4.5, 6);
      expect(n('shelf'), tag).toBeGreaterThanOrEqual(3);
      expect(n('skyMuStool'), tag).toBeGreaterThanOrEqual(4);
      expect(n('cafeBistroTable'), tag).toBeGreaterThanOrEqual(3);
      expect(n('cafeChair'), tag).toBeGreaterThanOrEqual(6);
      expect(n('crate'), tag).toBeGreaterThanOrEqual(1);
      // loose things on the counter are separate props riding it (never baked into it)
      expect(own.filter(p => p.host !== undefined).map(p => [p.kind, L.props[p.host!].kind]).sort(), tag).toEqual([['campLantern', 'shopCounter'], ['campLantern', 'shopCounter'], ['cashRegister', 'shopCounter']]);
      for (const p of own) {
        const a = L.areas[bar.area];
        expect(p.x >= a.x * CELL && p.x <= (a.x + a.w) * CELL && p.z >= a.y * CELL && p.z <= (a.y + a.h) * CELL, `${tag} ${p.kind} on the deck`).toBe(true);
        if (p.host === undefined && !p.mounted) expect(p.y, `${tag} ${p.kind} on the deck floor`).toBeCloseTo(SETTLE.bases[1], 6);
        if (isLootHolderKind(p.kind)) expect([p.kind, p.purpose], tag).toEqual([p.kind, MARKET_EMPTY_KEY]);
        expect(p.purpose === MARKET_WORKSHOP_KEY, tag).toBe(false);
      }
      const lamps = L.lights.filter(l => l.area === bar.area);
      expect(lamps.length, tag).toBeGreaterThanOrEqual(4);
      for (const l of lamps) expect([l.level, l.warm, l.y > SETTLE.bases[1] + 2.2 && l.y < SETTLE.roofY], tag).toEqual([1, true, true]);
      const board = L.signs.filter(s => s.area === bar.area);
      expect(board.map(s => [s.text, s.hang, s.level]), tag).toEqual([[bar.name.split(' — ')[0], true, 1]]);
    }
    expect(layouts.some(({L}) => L.props.some(p => p.kind === 'jukebox' && p.area === barOf(L).area))).toBe(true);
  });

  it('the bartender behind the counter facing the customer spot; the stock on the backbar shelves on his side, within reach, and it fits', () => {
    const inv = new Inventory();
    for (const {seed, L} of layouts) {
      const bar = barOf(L), c = bar.counter, tag = `seed ${seed}`, g1 = L.levels[1].grid, walk = fromTrainDoor(L, false);
      const side = (z: number) => (z < c.z0 ? -1 : z > c.z1 ? 1 : 0);
      expect([side(bar.trader.z), side(bar.front.z)], tag).toEqual([-1, 1]); // the bartender on the backbar side, the customer in front
      expect(-Math.cos(bar.trader.yaw) * Math.sign(bar.front.z - bar.trader.z), tag).toBeCloseTo(1, 6);
      expect(Math.abs(bar.trader.x - bar.front.x), tag).toBeLessThan(0.01);
      for (const p of [bar.trader, bar.front]) {
        expect(marketStandOk(g1, p.x, p.z), tag).toBe(true);
        expect(walk[1][g1.idx(...g1.cellOf(p.x, p.z))], `${tag} on foot`).toBeGreaterThanOrEqual(0);
      }
      const disp = bar.displays!;
      expect(disp.length, tag).toBeGreaterThanOrEqual(9);
      const near = disp.map(d => Math.hypot(d.x - bar.trader.x, d.z - bar.trader.z, d.y - (bar.trader.y + 1.2)));
      for (let k = 1; k < near.length; k++) expect(near[k], tag).toBeGreaterThanOrEqual(near[k - 1] - 1e-9); // nearest the bartender first
      expect(Math.hypot(disp[0].x - bar.trader.x, disp[0].z - bar.trader.z), tag).toBeLessThan(1.5);
      // the bartender's side of the counter: its walkable cells (the aisle), and every display within 1.3 m of one
      const aisle: [number, number][] = [];
      for (let i = 0; i < g1.cells.length; i++) {
        if (g1.area[i] !== bar.area || g1.cells[i] !== FLOOR || g1.blocked[i] || walk[1][i] < 0) continue;
        const [wx, wz] = g1.center(i % g1.w, Math.floor(i / g1.w));
        if (side(wz) === -1) aisle.push([wx, wz]);
      }
      for (const d of disp) {
        const h = L.props[d.host!];
        expect([h.kind, h.purpose, h.area, d.level], tag).toEqual(['shelf', MARKET_EMPTY_KEY, bar.area, 1]);
        expect(side(d.z), `${tag} behind the counter`).toBe(-1);
        expect(Math.abs(d.x - h.x) <= h.hx + 1e-3 && Math.abs(d.z - h.z) <= h.hz + 1e-3 && d.y > h.y && d.y <= h.y + h.h + 0.01, tag).toBe(true);
        expect(d.clear!, tag).toBeGreaterThan(0.24); // (a standing long-neck: items/beers.ts BEER_DIMS 0.235 m)
        expect(aisle.some(([x, z]) => Math.hypot(x - d.x, z - d.z) <= 1.3), `${tag} within reach of the bartender's aisle`).toBe(true);
      }
      // the bartender's real stock (market/trade/stock.ts: all five beers + drinks) fits the backbar
      const stock = MarketStock.seed(`st-${seed}`, seed, (id, k) => inv.makeStack(id, k), [...MARKET_STALLS_ALL]);
      const list = stock.stalls.bar;
      expect(new Set(list.map(s => s.itemId)).size).toBeGreaterThanOrEqual(BEER_IDS.length);
      expect(planStall(list, stallSurfaces(L, bar), id => itemDims(id)).count, tag).toBe(Math.min(WARES.maxPerStall, list.length));
    }
  });

  it("6-10 'drink' posts beside their stools / chairs, on clear floor, on foot from the train, never the customer spot; every other kind kept", () => {
    for (const {seed, L} of layouts) {
      const m = L.market!, bar = barOf(L), g1 = L.levels[1].grid, walk = fromTrainDoor(L, false), tag = `seed ${seed}`;
      const drink = m.spots.filter(s => s.kind === 'drink');
      expect(drink.length, tag).toBeGreaterThanOrEqual(BAR_SPOTS.min);
      expect(drink.length, tag).toBeLessThanOrEqual(BAR_SPOTS.max);
      for (const s of drink) {
        expect([s.level, s.y, s.area], tag).toEqual([1, SETTLE.bases[1], bar.area]);
        expect(marketStandOk(g1, s.x, s.z), tag).toBe(true);
        expect(walk[1][g1.idx(...g1.cellOf(s.x, s.z))], `${tag} on foot`).toBeGreaterThanOrEqual(0);
        const seat = L.props[s.seat!];
        expect(['skyMuStool', 'cafeChair'], tag).toContain(seat.kind);
        expect(seat.area, tag).toBe(bar.area);
        expect(Math.hypot(seat.x - s.x, seat.z - s.z), tag).toBeLessThan(2.2);
        expect(Math.hypot(s.x - bar.front.x, s.z - bar.front.z), tag).toBeGreaterThanOrEqual(0.9);
      }
      expect(new Set(drink.map(s => L.props[s.seat!].kind)), `${tag} stools and chairs`).toEqual(new Set(['skyMuStool', 'cafeChair']));
      expect(new Set(m.spots.map(s => s.kind))).toEqual(new Set(['idle', 'sit', 'work', 'cook', 'sleep', 'chat', 'drink']));
      expect(m.residents).toBeGreaterThanOrEqual(MARKET_POPULATION.residents[0]);
      expect(m.residents).toBeLessThanOrEqual(MARKET_POPULATION.residents[1]);
    }
  });

  it('its look: fans from the shed roof over the deck; existing art only (the market may load the mall\'s café furniture)', () => {
    const files = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...MALL_MODEL_FILES};
    for (const {seed, L} of layouts) {
      const bar = barOf(L), a = L.areas[bar.area];
      const fans = marketFans(L).filter(f => f.level === 1);
      expect(fans.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      for (const f of fans) {
        expect(f.y + f.rod).toBeCloseTo(SETTLE.roofY, 6);
        expect(f.y - SETTLE.bases[1]).toBeGreaterThan(3.5);
        expect(f.x > a.x * CELL && f.x < (a.x + a.w) * CELL && f.z > a.y * CELL && f.z < (a.y + a.h) * CELL).toBe(true);
      }
      const keys = [...new Set([...p7ModelKeysFor(L), ...officeModelKeysFor(L)])];
      expect(selectLevelKeys('market', keys, files).foreign, `${seed}`).toEqual([]);
      expect(keys.some(k => /cafe-chair|cafeChair/.test(k)), `${seed} the café chairs load`).toBe(true);
    }
    // the beers it sells are real items (items/beers.ts)
    for (const id of BEER_IDS) expect(itemDef(id).kind).toBe('consumable');
    expect(MARKET_STALLS.length).toBe(6);
  });
});
