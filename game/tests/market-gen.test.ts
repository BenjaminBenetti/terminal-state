// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's generator (gen/market) over a seed sample — every
// station valid on its first attempts, the player's train docks at its platform, the six stalls and the residents' spots on clear floor
// reachable from the train, the deck (storey 1) up its stair, the calm rules (no enemies / hordes / annexes / gas / free loot).
// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): this is LAYOUT VERSION 1 (gen/market/layoutVersion.ts: the stations a
// player entered under the first market's build regenerate it forever), generated explicitly with layoutVersion 1; version 2 (the
// container settlement, now the default) is tests/market-settlement.test.ts.
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {levelsOf} from '../src/gen/levels';
import {extraSalvageRule, isLootHolderKind, holderTable} from '../src/items/loot';
import {MARKET_WORKSHOP_KEY, lootProfile} from '../src/items/lootTables';
import {rollLevelGear} from '../src/levels/gearAdapter';
import {LEVELS, arrivalPose} from '../src/levels/registry';
import {MARKET_STALLS} from '../src/gen/market/marketTypes';
import {MARKET, MARKET_EMPTY_KEY, MARKET_GEN_STATS, MARKET_POPULATION, generateMarketLevel, marketIssues, marketStandOk} from '../src/gen/market/index';
import {MARKET_ART, marketAwnings, marketFans} from '../src/gen/market/art';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {SPAWN_PROFILES} from '../src/ai/spawnTables';
import {fuelWeight, placeStationFuel} from '../src/gen/fuelPlacement';
import {FUEL} from '../src/fuel/fuel';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 42, 777, 4242, 9001, 123456, 0xdeadbeef, 20261108];
const layouts = SEEDS.map(s => {
  const L = generateMarketLevel({levelSeed: s, layoutVersion: 1});
  return {seed: s, L, attempts: MARKET_GEN_STATS.attempts};
});

/** The walking distance field from the point outside the car's middle platform-side door (gen/fuelPlacement.ts's door point). */
function fromTrainDoor(L: StationLayout): Int32Array[] {
  const tp = playerTrainPlacement(L)!;
  const doors = PLAYER_TRAIN_SPEC.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const w = trainToWorld(tp, doors[Math.floor(doors.length / 2)], PLAYER_TRAIN_SPEC.floorY, -(PLAYER_TRAIN_SPEC.width / 2 + 0.75));
  const [sx, sy] = L.grid.cellOf(w.x, w.z);
  return levelDistance(L.levels, sx, sy, 0, L.levelLinks);
}

describe('the Survivor Market generator', () => {
  it('is valid for every seed, on its first attempts, deterministic and quick', () => {
    for (const {seed, L, attempts} of layouts) {
      expect([seed, marketIssues(L)]).toEqual([seed, []]);
      expect(attempts, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
    const again = generateMarketLevel({levelSeed: SEEDS[0], layoutVersion: 1});
    const sig = (L: StationLayout) => JSON.stringify({areas: L.areas, props: L.props, lights: L.lights, signs: L.signs, market: L.market, rails: L.rails});
    expect(sig(again)).toBe(sig(layouts[0].L));
    expect(MARKET_GEN_STATS.ms).toBeLessThan(400);
    // seeded variety: both mirror states, several stall orders and names
    expect(new Set(layouts.map(({L}) => L.market!.stalls.map(s => s.name).join('|'))).size).toBeGreaterThan(5);
    expect(new Set(layouts.map(({L}) => L.levelLinks[0].bottom.x > L.grid.w * CELL / 2)).size).toBe(2);
  });

  it('the train docks at the platform: the start arrival is inside the car, every walkable cell is reachable from its door', () => {
    for (const {seed, L} of layouts) {
      const tp = playerTrainPlacement(L);
      expect(tp, `seed ${seed}`).not.toBeNull();
      expect(tp!.platformArea).toBe(L.platform);
      const pose = arrivalPose(L, {kind: 'start'}, tp);
      expect(pose.source).toBe('train');
      const d = fromTrainDoor(L);
      for (const Lv of L.levels) {
        const g = Lv.grid;
        let bad = 0;
        for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && d[Lv.id][i] < 0) bad++;
        expect([seed, Lv.id, bad]).toEqual([seed, Lv.id, 0]);
      }
    }
  });

  it('six stalls (MARKET_STALLS order): counters inside the alcoves, traders behind them, customer points reachable from the train', () => {
    for (const {seed, L} of layouts) {
      const m = L.market!;
      expect(m.v).toBe(1);
      expect(m.stalls.map(s => s.id)).toEqual([...MARKET_STALLS]);
      const d = fromTrainDoor(L);
      for (const s of m.stalls) {
        expect(s.name, `${seed} ${s.id}`).toMatch(/ — /);
        expect(L.areas[s.area].label).toBe(s.name);
        for (const p of [s.trader, s.front]) {
          expect(marketStandOk(L.levels[p.level].grid, p.x, p.z), `${seed} ${s.id}`).toBe(true);
          const [cx, cy] = L.grid.cellOf(p.x, p.z);
          expect(d[p.level][L.grid.idx(cx, cy)], `${seed} ${s.id} reachable`).toBeGreaterThanOrEqual(0);
        }
        expect(s.trader.z).toBeLessThan(s.counter.z0);
        expect(s.front.z).toBeGreaterThan(s.counter.z1);
        // the trader faces the counter's front: forward (-sin yaw, -cos yaw) points +Z
        expect(-Math.cos(s.trader.yaw)).toBeCloseTo(1, 6);
        // a real counter run stands there (two counter modules, empty by the market rule)
        const counters = L.props.filter(p => p.area === s.area && p.kind === 'shopCounter');
        expect(counters.length).toBe(2);
      }
    }
  });

  it('a dozen+ resident spots of every kind over both storeys, a 8–12 population; the deck is reached by its stair', () => {
    for (const {seed, L} of layouts) {
      const m = L.market!;
      expect(m.spots.length, `seed ${seed}`).toBeGreaterThanOrEqual(MARKET_POPULATION.minSpots);
      expect(new Set(m.spots.map(s => s.kind))).toEqual(new Set(['idle', 'sit', 'work', 'cook', 'sleep', 'chat']));
      expect(m.spots.some(s => s.level === 1)).toBe(true);
      expect(m.residents).toBeGreaterThanOrEqual(MARKET_POPULATION.residents[0]);
      expect(m.residents).toBeLessThanOrEqual(MARKET_POPULATION.residents[1]);
      const tp = playerTrainPlacement(L)!;
      for (const s of m.spots) {
        expect(marketStandOk(L.levels[s.level].grid, s.x, s.z), `${seed} ${s.kind}`).toBe(true);
        expect(s.y).toBe(s.level ? MARKET.deckY : 0);
        // never in the bed / under the parked car
        expect(s.z > tp.platformEdgeZ || s.level > 0, `${seed} ${s.kind} off the bed`).toBe(true);
      }
      expect(L.levels.map(l => [l.id, l.role, l.baseY])).toEqual([[0, 'main', 0], [1, 'ring', MARKET.deckY]]);
      expect(L.levelLinks).toHaveLength(1);
      expect(L.levelLinks[0]).toMatchObject({kind: 'stairs', lower: 0, upper: 1});
      expect(levelsOf(L).unrailedDrops()).toEqual([]);
    }
  });

  // task studio-base-salvage-20261108-073314-01: the ONE exception — the workshop's own storage (tool chest, plank shelving, crates) carries
  // the workshop key, whose own table is empty too; its only possible find is the market's additive basic-salvage lot (lootTables
  // MARKET_SALVAGE; tests/base-salvage.test.ts) — every other holder keeps the exact empty key and no salvage rule
  it('the calm rules: no enemies, hordes, annexes, gas records or free loot; every holder table is empty under the market profile', () => {
    const P = lootProfile('market');
    const STORES = new Set(['rollingToolChest', 'outdoorsPlankShelving', 'crate']);
    for (const {seed, L} of layouts) {
      expect([seed, L.zombies.length, L.hordes?.length ?? 0, L.pickups.length]).toEqual([seed, 0, 0, 0]);
      expect(L.extensions).toBeUndefined();
      expect(L.office ?? L.mall ?? L.reactor ?? L.skyways).toBeUndefined();
      let stores = 0;
      for (const p of L.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const workshop = p.purpose === MARKET_WORKSHOP_KEY;
        expect([seed, p.kind, p.purpose]).toEqual([seed, p.kind, workshop ? MARKET_WORKSHOP_KEY : MARKET_EMPTY_KEY]);
        if (workshop) {
          stores++;
          expect(STORES.has(p.kind), `${seed} ${p.kind}`).toBe(true);
          expect(L.areas[p.area].purpose, `${seed} ${p.kind}`).toBe('workshop');
        }
        const t = holderTable(p.kind, p.purpose!, P);
        expect(t.empty === 1 || t.lots[1] === 0 || !t.rows.length, `${seed} ${p.kind}`).toBe(true);
        expect(!!extraSalvageRule(p.kind, p.purpose!, P), `${seed} ${p.kind} salvage`).toBe(workshop);
      }
      expect(stores, `${seed} workshop stores`).toBeGreaterThanOrEqual(3);
    }
    // the level-wide gear / mask roll is empty: the registry places nothing
    for (const s of SEEDS) {
      const gear = rollLevelGear(s, 'market', ['main']);
      expect(gear.main).toEqual([]);
      const L = LEVELS.market.generate('main', {levelSeed: s, gear: gear.main, layoutVersion: 1});
      expect(L.pickups).toEqual([]);
    }
    expect(Object.values(SPAWN_PROFILES.market.contexts).filter(c => c.count[1] > 0).map(c => c.label)).toEqual([SPAWN_PROFILES.market.contexts.service!.label]);
    // the common station-fuel rules unchanged: only the workshop has a fuel affinity (its storage takes the plan's cans, like any station's)
    for (const {L} of layouts) {
      expect(L.areas.filter(a => fuelWeight(a) > 0).map(a => a.purpose)).toEqual(['workshop']);
      // the cans no holder takes (the common fallback) are never lost: all of them in the workshop
      const fp = placeStationFuel(L, {units: 4 * FUEL.canUnits, cans: 4, cart: 0}, 'st-07');
      expect(fp.cans.length).toBe(4);
      expect(new Set(fp.cans.map(c => L.areas[c.area].purpose))).toEqual(new Set(['workshop']));
    }
    expect(SPAWN_PROFILES.market.contexts.station!.count).toEqual([0, 0]);
    expect(SPAWN_PROFILES.market.horde).toBeUndefined();
    expect(LEVELS.market.trackExtensions).toBe('none');
  });

  it('fans turn slowly above every head; one awning over each stall opening', () => {
    for (const {seed, L} of layouts) {
      const fans = marketFans(L);
      expect(fans.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      for (const f of fans) {
        const floor = f.level ? MARKET.deckY : 0;
        expect(f.y - floor - 0.05, `${seed} fan`).toBeGreaterThanOrEqual(MARKET_ART.fan.minBlade - 0.06);
        expect(f.speed).toBeGreaterThan(0);
        expect(f.speed).toBeLessThan(2); // slow: well under one turn a second
      }
      const aw = marketAwnings(L);
      expect(aw.map(a => a.stall)).toEqual([...MARKET_STALLS]);
      for (const a of aw) expect(a.yEdge).toBeGreaterThanOrEqual(2.4);
    }
  });
});
