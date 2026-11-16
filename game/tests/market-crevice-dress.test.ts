// Task studio-survivor-market-crevice-20261116-074419 (lane DRESS): THE CREVICE's furnishing (gen/market/v5/dress.ts) and its record
// (gen/market/v5/record.ts, layout.market v = 5) — the earlier versions' stall / bar / spot contract, environment only:
//  - the six shops in MARKET_STALLS order, then the bar: counter (its run its longer side), the trader behind it facing the customer, both
//    on clear floor on foot from the train; >= 4 displays on real item surfaces within 1.3 m of walkable floor; a shop's >= 5 m of display
//    within 2.6 m of the customer's eye (clear customer-side floor inside the stall); the bar's version-3 minimums, displays behind the
//    counter (never on it), 6-10 'drink' posts beside their seats; the wares planner fits a full stall / the bartender's stock;
//  - residents' spots of every kind on all four storeys, on clear floor reachable on foot (stairs only), never on the train side, few in
//    the private homes;
//  - holders all empty-keyed but version 2's community stores (the workshop's tool chest, the store room's holders), no pickups;
//  - a clear >= 1.6 m lane along every terrace / low walk row, nothing on the bridges / stairs, the den entry (and its approach and front
//    wall) left to the den's own pass;
//  - warm lamps (~150-220) in every container and back room, never high in the void; the boards; deterministic; existing art only.

import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, type Grid} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {isLootHolderKind} from '../src/items/loot';
import {itemDims} from '../src/items/items';
import {BEER_IDS} from '../src/items/beers';
import {MARKET_WORKSHOP_KEY} from '../src/items/lootTables';
import {BAR_STALL, MARKET_STALLS, MARKET_STALLS_ALL, type MarketStall} from '../src/gen/market/marketTypes';
import {MARKET_EMPTY_KEY, MARKET_POPULATION, marketStandOk} from '../src/gen/market/index';
import {SETTLE_DISPLAY} from '../src/gen/market/v2/validate';
import {SETTLE_HOME_SPOTS} from '../src/gen/market/v2/record';
import {BAR_SPOTS} from '../src/gen/market/v3/barRecord';
import {CREVICE} from '../src/gen/market/v5/frame';
import {CREVICE_GEN_STATS, creviceAttempt, generateCrevice} from '../src/gen/market/v5/index';
import {CREVICE_DRESS, CREVICE_DRESS_QA} from '../src/gen/market/v5/dress';
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
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 42, 777, 9001];
const B = CREVICE.bases;
const runs = SEEDS.map(seed => {
  const L = generateCrevice({levelSeed: seed});
  const stats = {...CREVICE_GEN_STATS};
  // the accepted attempt's carve (same frame salt / attempt seed: deterministic)
  const cc = creviceAttempt({levelSeed: seed}, stats.attempts - 1, stats.carveFails).carve!;
  return {seed, L, cc, stats, qa: CREVICE_DRESS_QA.get(L)!};
});

/** On-foot distance field (the stairs only: no ladders) from outside the parked car's middle platform-side door. */
function onFoot(L: StationLayout): Int32Array[] {
  const tp = playerTrainPlacement(L)!;
  const doors = PLAYER_TRAIN_SPEC.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const w = trainToWorld(tp, doors[Math.floor(doors.length / 2)], PLAYER_TRAIN_SPEC.floorY, -(PLAYER_TRAIN_SPEC.width / 2 + 0.75));
  const [sx, sy] = L.grid.cellOf(w.x, w.z);
  return levelDistance(L.levels, sx, sy, 0, L.levelLinks.filter(k => k.kind === 'stairs'));
}
const reach = (walk: Int32Array[], g: Grid, level: number, x: number, z: number) => walk[level][g.idx(...g.cellOf(x, z))];
/** A counter's run axis (its longer side) and which side of it (across its depth) a point lies: -1 / +1, 0 inside its depth. */
function across(s: MarketStall, x: number, z: number): number {
  const c = s.counter;
  return c.x1 - c.x0 >= c.z1 - c.z0 ? (z < c.z0 ? -1 : z > c.z1 ? 1 : 0) : (x < c.x0 ? -1 : x > c.x1 ? 1 : 0);
}
/** Walkable floor (FLOOR, not blocked, not a stair cell) reachable on foot, as cell centres, on one storey (optionally one area). */
function floorPoints(L: StationLayout, walk: Int32Array[], level: number, area?: number): [number, number][] {
  const g = L.levels[level].grid, out: [number, number][] = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] !== FLOOR || g.blocked[i] || g.rampIdx[i] >= 0 || walk[level][i] < 0 || (area !== undefined && g.area[i] !== area)) continue;
    out.push(g.center(i % g.w, Math.floor(i / g.w)));
  }
  return out;
}
const mine = <T>(list: T[], n: number) => list.slice(0, n);

describe('the Survivor Market crevice (version 5): furnishing and record', () => {
  it('the record: version 5, six shops then the bar; first-attempt, quick, deterministic', () => {
    for (const {seed, L, stats, qa} of runs) {
      expect(L.market!.v, `${seed}`).toBe(5);
      expect(L.market!.stalls.map(s => s.id), `${seed}`).toEqual([...MARKET_STALLS, BAR_STALL]);
      expect(stats.attempts, `${seed}`).toBeLessThanOrEqual(2);
      expect(stats.ms, `${seed}`).toBeLessThan(1500); // (~40-170 ms locally per attempt; a loose CI bound)
      expect(qa, `${seed} QA record`).toBeDefined();
      for (const s of L.market!.stalls.slice(0, MARKET_STALLS.length)) expect(L.areas[s.area].label, `${seed} ${s.id}`).toBe(s.name);
    }
    const sig = (L: StationLayout) => JSON.stringify({props: L.props, lights: L.lights, signs: L.signs, market: L.market, areas: L.areas.map(a => [a.label, a.noFloorLoot])});
    expect(sig(generateCrevice({levelSeed: SEEDS[0]}))).toBe(sig(runs[0].L));
    expect(new Set(runs.map(({L}) => L.market!.stalls.map(s => s.name).join('|'))).size).toBeGreaterThan(3);
  });

  it('the shops: the counter\'s run its longer side, trader and customer across it on clear floor (on foot), the trader facing the customer; displays on real item surfaces within reach, >= 5 m near the customer', () => {
    const mixed = Array.from({length: 30}, (_, i) => ({uid: 1000 + i, itemId: ['beans', 'water', 'ammo_9mm', 'medkit', 'chips', 'bandage', 'battery', 'ammo_12ga'][i % 8]}));
    for (const {seed, L} of runs) {
      const walk = onFoot(L);
      for (const s of L.market!.stalls) {
        const tag = `${seed} ${s.id}`, lv = s.front.level, g = L.levels[lv].grid;
        expect([s.trader.level, s.counter.level, s.trader.y, s.front.y], tag).toEqual([lv, lv, B[lv], B[lv]]);
        const own = L.props.filter(p => p.area === s.area && p.host === undefined);
        expect(own.filter(p => p.kind === 'shopCounter').length, tag).toBeGreaterThanOrEqual(s.id === BAR_STALL ? 2 : 1);
        for (const p of [s.trader, s.front]) {
          expect(marketStandOk(g, p.x, p.z), `${tag} stand`).toBe(true);
          expect(g.area[g.idx(...g.cellOf(p.x, p.z))], `${tag} in its area`).toBe(s.area);
          expect(reach(walk, g, lv, p.x, p.z), `${tag} on foot`).toBeGreaterThanOrEqual(0);
        }
        expect(across(s, s.trader.x, s.trader.z) * across(s, s.front.x, s.front.z), `${tag} across the counter`).toBe(-1);
        const dx = s.front.x - s.trader.x, dz = s.front.z - s.trader.z, dl = Math.hypot(dx, dz);
        expect((-Math.sin(s.trader.yaw) * dx - Math.cos(s.trader.yaw) * dz) / dl, `${tag} trader faces the customer`).toBeGreaterThan(0.99);
        // the displays: real item surfaces of the stall's own fixtures, free height, each within 1.3 m of walkable floor
        const disp = s.displays!, pts = floorPoints(L, walk, lv);
        expect(disp.length, tag).toBeGreaterThanOrEqual(s.id === BAR_STALL ? 9 : SETTLE_DISPLAY.min);
        for (const d of disp) {
          const h = L.props[d.host!];
          expect([h.area, d.level], tag).toEqual([s.area, lv]);
          expect(isLootHolderKind(h.kind) ? h.purpose === MARKET_EMPTY_KEY : SETTLE_DISPLAY.solidTops.includes(h.kind), `${tag} ${h.kind}`).toBe(true);
          expect(Math.abs(d.x - h.x) <= h.hx + 1e-3 && Math.abs(d.z - h.z) <= h.hz + 1e-3 && d.y > h.y && d.y <= h.y + h.h + 0.01, `${tag} on its host`).toBe(true);
          expect(d.clear!, tag).toBeGreaterThan(0.1);
          expect(pts.some(([x, z]) => Math.hypot(x - d.x, z - d.z) <= SETTLE_DISPLAY.reach), `${tag} ${h.kind} within reach`).toBe(true);
        }
        if (s.id === BAR_STALL) {
          for (const d of disp) {
            expect(L.props[d.host!].kind, `${tag} never on the counter`).not.toBe('shopCounter');
            expect(across(s, d.x, d.z), `${tag} behind the counter`).toBe(across(s, s.trader.x, s.trader.z));
          }
          continue;
        }
        // >= 5 m of display within 2.6 m of the customer's eye from clear customer-side floor inside the stall
        const side = across(s, s.front.x, s.front.z);
        const cust = floorPoints(L, walk, lv, s.area).filter(([x, z]) => across(s, x, z) === side && marketStandOk(g, x, z));
        const near = disp.filter(d => cust.some(([x, z]) => Math.hypot(d.x - x, d.z - z, d.y - (B[lv] + 1.6)) <= SETTLE_DISPLAY.customerReach));
        expect(near.reduce((t, d) => t + d.w, 0), `${tag} near display width`).toBeGreaterThanOrEqual(SETTLE_DISPLAY.nearWidth);
        // the wares planner fills a full stall from them (all but the customer counter tops)
        expect(planStall(mixed, stallSurfaces(L, s), id => itemDims(id)).count, tag).toBe(WARES.maxPerStall);
      }
    }
  });

  it("the bar: version 3's furniture minimums, a jukebox and a register, lamps, its board; 6-10 'drink' posts beside their seats; the bartender's stock fits", () => {
    const inv = new Inventory();
    for (const {seed, L} of runs) {
      const bar = L.market!.stalls.find(s => s.id === BAR_STALL)!, tag = `${seed} bar`;
      expect(bar.trader.level, tag).toBe(1);
      const own = L.props.filter(p => p.area === bar.area), n = (k: string) => own.filter(p => p.kind === k && p.host === undefined).length;
      expect([n('shopCounter') >= 2, n('skyMuStool') >= 4, n('cafeBistroTable') >= 3, n('cafeChair') >= 6, n('jukebox') >= 1], tag).toEqual([true, true, true, true, true]);
      expect(own.some(p => p.kind === 'cashRegister' && p.host !== undefined && L.props[p.host].kind === 'shopCounter'), `${tag} register`).toBe(true);
      // its lamps over the deck (their rods to the canopy's bracket: the crevice is open above it)
      const deck = L.areas[bar.area];
      expect(L.lights.filter(l => l.level === 1 && l.x > deck.x * CELL && l.x < (deck.x + deck.w) * CELL && l.z > deck.y * CELL && l.z < (deck.y + deck.h) * CELL).length, tag).toBeGreaterThanOrEqual(4);
      expect(L.signs.some(s => s.text === bar.name.split(' — ')[0]), `${tag} board`).toBe(true);
      const drink = L.market!.spots.filter(s => s.kind === 'drink');
      expect(drink.length, tag).toBeGreaterThanOrEqual(BAR_SPOTS.min);
      expect(drink.length, tag).toBeLessThanOrEqual(BAR_SPOTS.max);
      for (const s of drink) {
        const seat = L.props[s.seat!];
        expect(['skyMuStool', 'cafeChair'], tag).toContain(seat.kind);
        expect([seat.area, s.area, s.level], tag).toEqual([bar.area, bar.area, 1]);
        expect(Math.hypot(seat.x - s.x, seat.z - s.z), tag).toBeLessThan(2.2);
        expect(Math.hypot(s.x - bar.front.x, s.z - bar.front.z), `${tag} never the customer spot`).toBeGreaterThan(0.5);
      }
      const stock = MarketStock.seed(`st-${seed}`, seed, (id, k) => inv.makeStack(id, k), [...MARKET_STALLS_ALL]);
      const list = stock.stalls.bar;
      expect(new Set(list.map(s => s.itemId)).size).toBeGreaterThanOrEqual(BEER_IDS.length);
      expect(planStall(list, stallSurfaces(L, bar), id => itemDims(id)).count, tag).toBe(Math.min(WARES.maxPerStall, list.length));
    }
  });

  it('residents\' spots: every kind, all four storeys, clear floor on foot (stairs only), never on a counter / the train side; few in the homes', () => {
    for (const {seed, L, cc} of runs) {
      const m = L.market!, walk = onFoot(L), tag = `${seed}`;
      expect(m.spots.length, tag).toBeGreaterThanOrEqual(MARKET_POPULATION.minSpots);
      expect(new Set(m.spots.map(s => s.kind)), tag).toEqual(new Set(['idle', 'sit', 'work', 'cook', 'sleep', 'chat', 'drink']));
      expect(new Set(m.spots.map(s => s.level)), tag).toEqual(new Set([0, 1, 2, 3]));
      for (const lv of [1, 2, 3]) expect(m.spots.filter(s => s.level === lv && cc.walks.W.concat(cc.walks.E).some(a => a.id === s.area)).length, `${tag} on the terraces of ${lv}`).toBeGreaterThanOrEqual(2);
      expect(m.residents).toBeGreaterThanOrEqual(MARKET_POPULATION.residents[0]);
      expect(m.residents).toBeLessThanOrEqual(MARKET_POPULATION.residents[1]);
      const P = cc.platform, edgeZ = P.edge === 'N' ? P.y * CELL : (P.y + P.h) * CELL;
      const counters = L.props.filter(p => p.kind === 'shopCounter');
      for (const s of m.spots) {
        const g = L.levels[s.level].grid, t = `${tag} ${s.kind} (${s.x}, ${s.z}) L${s.level}`;
        expect(marketStandOk(g, s.x, s.z), t).toBe(true);
        expect(s.y, t).toBe(B[s.level]);
        expect(g.area[g.idx(...g.cellOf(s.x, s.z))], t).toBe(s.area);
        expect(reach(walk, g, s.level, s.x, s.z), `${t} on foot`).toBeGreaterThanOrEqual(0);
        expect(counters.some(c => (c.level ?? 0) === s.level && Math.abs(c.x - s.x) < c.hx && Math.abs(c.z - s.z) < c.hz), `${t} on a counter`).toBe(false);
        expect(s.level === 0 && s.area === P.id && Math.abs(s.z - edgeZ) < CREVICE_DRESS.trainSide, `${t} train side`).toBe(false);
      }
      const homeSpots = m.spots.filter(s => ['Home', 'Back room'].includes(L.areas[s.area].label ?? ''));
      expect(homeSpots.length, `${tag} homes private`).toBeLessThanOrEqual(SETTLE_HOME_SPOTS.sleep + SETTLE_HOME_SPOTS.other);
    }
  });

  it('environment only: no pickups / zombies; every holder empty-keyed but version 2\'s community stores (workshop chest + one store room)', () => {
    for (const {seed, L, qa} of runs) {
      expect([seed, L.zombies.length, L.pickups.length], `${seed}`).toEqual([seed, 0, 0]);
      let keyed = 0;
      const keyedAreas = new Set<string>();
      for (const p of mine(L.props, qa.props)) {
        if (!isLootHolderKind(p.kind)) { expect(p.purpose === MARKET_WORKSHOP_KEY, `${seed} ${p.kind}`).toBe(false); continue; }
        expect([p.kind, [MARKET_EMPTY_KEY, MARKET_WORKSHOP_KEY].includes(p.purpose!)], `${seed}`).toEqual([p.kind, true]);
        if (p.purpose !== MARKET_WORKSHOP_KEY) continue;
        keyed++;
        const a = L.areas[p.area];
        keyedAreas.add(a.label ?? '');
        expect(a.purpose === 'workshop' ? p.kind : a.label, `${seed} ${p.kind} in ${a.label}`).toBe(a.purpose === 'workshop' ? 'rollingToolChest' : 'Store room');
      }
      // version 2's recipe: the workshop row's tool chest + the store room's back-wall holders + its side crate
      expect(keyed, `${seed}`).toBe(qa.community.expected);
      expect(qa.community.workshop, `${seed} the workshop chest`).toBe(1);
      expect(keyed, `${seed}`).toBeGreaterThanOrEqual(3);
      expect(keyed, `${seed}`).toBeLessThanOrEqual(6);
      expect(keyedAreas, `${seed}`).toEqual(new Set(['Workshop', 'Store room']));
      for (const s of L.market!.stalls) for (const d of s.displays ?? []) expect(L.props[d.host!].purpose, `${seed} ${s.id}`).not.toBe(MARKET_WORKSHOP_KEY);
      // no floor loot but the workshop (the station's fuel plan) and the den's own
      for (const a of L.areas) if (a.purpose !== 'workshop' && a.label !== 'Den entry') expect(a.noFloorLoot, `${seed} ${a.label}`).toBe(true);
    }
  });

  it('circulation: a clear >= 1.6 m lane along every terrace / low-walk row; nothing on the bridges, the stairs or their feet; the chasm rail free', () => {
    for (const {seed, L, cc, qa} of runs) {
      const walk = onFoot(L);
      for (const [lv, A] of [[0, cc.low.W], [0, cc.low.E], ...([1, 2, 3].flatMap(l => [[l, cc.walks.W[l - 1]], [l, cc.walks.E[l - 1]]]))] as [number, typeof cc.low.W][]) {
        const g = L.levels[lv].grid;
        for (let y = A.y; y < A.y + A.h; y++) {
          let bare = 0, run = 0, best = 0, bestBare = 0;
          for (let x = A.x; x < A.x + A.w; x++) {
            const i = g.idx(x, y);
            const b = g.cells[i] === FLOOR && g.area[i] === A.id && g.rampIdx[i] < 0;
            bare = b ? bare + 1 : 0; bestBare = Math.max(bestBare, bare);
            run = b && !g.blocked[i] && walk[lv][i] >= 0 ? run + 1 : 0; best = Math.max(best, run);
          }
          if (!bestBare) continue;
          expect(best, `${seed} ${A.label} L${lv} row ${y}: clear run (cells)`).toBeGreaterThanOrEqual(Math.min(4, bestBare));
        }
      }
      // nothing of the furnishing's on a bridge deck, a stair run or its foot
      const off = new Set([...cc.bridges.map(b => b.area), ...cc.stairs.flatMap(s => [s.area, s.foot])]);
      for (const p of mine(L.props, qa.props)) expect(off.has(p.area), `${seed} ${p.kind} on a bridge / stair`).toBe(false);
      // the chasm's railing side of the crevice floor: no prop on a cell beside the drop
      const g0 = L.levels[0].grid;
      for (let i = 0; i < g0.cells.length; i++) {
        if (g0.cells[i] !== FLOOR || !g0.blocked[i]) continue;
        let byDrop = false;
        for (const o of [-1, 1, -g0.w, g0.w]) if (g0.cells[i + o] === 2 && g0.floor[i + o] < -2) byDrop = true;
        expect(byDrop, `${seed} blocked cell ${i} beside the chasm`).toBe(false);
      }
    }
  });

  it("the den entry is the den's: nothing of the furnishing's inside, before its door or on its front wall", () => {
    for (const {seed, L, cc, qa} of runs) {
      const den = cc.containers[cc.denSlot], tag = `${seed}`;
      expect(den.use, tag).toBe('den');
      expect(mine(L.props, qa.props).filter(p => p.area === den.area).length, `${tag} props`).toBe(0);
      expect(mine(L.lights, qa.lights).filter(l => l.area === den.area).length, `${tag} lights`).toBe(0);
      expect(mine(L.signs, qa.signs).filter(s => s.area === den.area).length, `${tag} signs`).toBe(0);
      expect(L.market!.spots.filter(s => s.area === den.area).length, `${tag} spots`).toBe(0);
      const d = den.door!, out = den.face === 'E' ? 1 : -1, g = L.levels[den.level].grid;
      // the approach: 2 cells straight out of the doorway, clear
      for (let y = d.y; y < d.y + d.h; y++) for (let k = 1; k <= 2; k++) expect(g.blocked[g.idx(d.x + out * k, y)], `${tag} approach ${k}`).toBe(0);
      // its front wall's outside face (the boards' wall): no sign / lamp of the furnishing's along the den box
      const wallX = out > 0 ? (d.x + 1) * CELL : d.x * CELL, z0 = den.box.y * CELL, z1 = (den.box.y + den.box.h) * CELL;
      const onWall = (x: number, z: number, lvl: number) => lvl === den.level && Math.abs(x - wallX) < 0.6 && z > z0 - 0.3 && z < z1 + 0.3;
      expect(mine(L.signs, qa.signs).filter(s => onWall(s.x, s.z, s.level ?? 0)).length, `${tag} signs on its wall`).toBe(0);
      expect(mine(L.lights, qa.lights).filter(l => onWall(l.x, l.z, l.level ?? 0)).length, `${tag} lamps on its wall`).toBe(0);
    }
  });

  it('warm lamps (~150-220): in every container and back room, along the fronts, never high in the void; the boards and notices', () => {
    for (const {seed, L, cc, qa} of runs) {
      const lights = mine(L.lights, qa.lights), tag = `${seed}`;
      expect(lights.length, tag).toBeGreaterThanOrEqual(130);
      expect(lights.length, tag).toBeLessThanOrEqual(230);
      for (const l of lights) {
        const lv = l.level ?? 0, h = l.y - B[lv], plat = l.area === cc.platform.id;
        expect('tint' in l, `${tag} no tint`).toBe(false);
        expect(l.warm || plat, `${tag} warm`).toBe(true);
        expect(h > 1.5 && h <= (plat ? 4.6 : 3.0), `${tag} lamp ${h.toFixed(2)} m over storey ${lv}`).toBe(true);
      }
      const lit = new Set(lights.map(l => l.area));
      for (const c of cc.containers) {
        if (c.area < 0 || c.use === 'den') continue;
        expect(lit.has(c.area), `${tag} ${c.use} lit`).toBe(true);
        if (c.back !== undefined) expect(lit.has(c.back), `${tag} ${c.use} back room lit`).toBe(true);
      }
      const signs = mine(L.signs, qa.signs);
      for (const s of L.market!.stalls.slice(0, MARKET_STALLS.length)) expect(signs.filter(q => q.text === s.name.split(' — ')[0]).length, `${tag} ${s.id} board + blade`).toBeGreaterThanOrEqual(3);
      for (const text of ['COMMUNAL KITCHEN', 'WORKSHOP']) expect(signs.some(q => q.text === text), `${tag} ${text}`).toBe(true);
    }
  });

  it("existing art only: every lazy model it places is shared or one the market may load (no other level's own art)", () => {
    const files = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...MALL_MODEL_FILES};
    for (const {seed, L} of runs) {
      const keys = [...new Set([...p7ModelKeysFor(L), ...officeModelKeysFor(L)])];
      expect(selectLevelKeys('market', keys, files).foreign, `${seed}`).toEqual([]);
    }
  });
});

