// Task studio-market-rework-20261108-074144-01 (lane LAYOUT; user: "the over all vibe of the are, is way to "one big box" it needs to feel
// more like Tokoy, more cramped, more assembly of shipping containers, more lived in. Shopes need to feel more like shops"): THE SURVIVOR
// MARKET's layout version 2 (gen/market/v2/: the dense container settlement, the default for unvisited / new markets) over a seed sample —
//  - every station valid on its first attempts, deterministic, quick; the player's train docks at its platform, as in version 1;
//  - three storeys (the lanes, the catwalks over the ground containers, the rooftops over the upper containers): every walkable cell
//    reachable from the train door (stairs + the player-only rooftop ladders), the ground and the catwalks on foot (the residents' graph);
//  - the dense assemblage: dozens of containers, cramped lanes, bridges over them, and NO solid column rising from a container top to the
//    roof (every ground container has a catwalk or an upper container + rooftop over it: the stacks step back, never "one big box");
//  - six real shops: a counter with the trader behind it and the customer in front, the trade's fixtures, and display surfaces on real
//    item surfaces of the shop (empty-keyed holders / a solid bench top) that hold the ~18 stacks a stall shows (market/wares planner);
//  - resident spots of every kind on the ground and the catwalks (never the rooftops), the calm rules (no enemies / hordes / annexes / gas /
//    free loot), the station fuel plan's cans in the workshop only.
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {levelsOf} from '../src/gen/levels';
import {extraSalvageRule, isLootHolderKind, holderTable} from '../src/items/loot';
import {MARKET_WORKSHOP_KEY, lootProfile} from '../src/items/lootTables';
import {itemDims} from '../src/items/items';
import {rollLevelGear} from '../src/levels/gearAdapter';
import {LEVELS, arrivalPose, storeyLabel} from '../src/levels/registry';
import {MARKET_STALLS} from '../src/gen/market/marketTypes';
import {MARKET_EMPTY_KEY, MARKET_POPULATION, generateMarketLevel, marketLayoutIssues, marketStandOk} from '../src/gen/market/index';
import {SETTLE_GEN_STATS} from '../src/gen/market/v2/index';
import {SETTLE} from '../src/gen/market/v2/frame';
import {SETTLE_DISPLAY} from '../src/gen/market/v2/validate';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {SPAWN_PROFILES} from '../src/ai/spawnTables';
import {placeStationFuel} from '../src/gen/fuelPlacement';
import {FUEL} from '../src/fuel/fuel';
import {WARES, stallSurfaces} from '../src/market/wares/slots';
import {planStall} from '../src/market/wares/plan';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {P7_FILES, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {officeModelKeysFor} from '../src/gen/office/index';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 42, 777, 4242, 9001, 123456, 0xdeadbeef, 20261108];
const layouts = SEEDS.map(s => {
  const L = generateMarketLevel({levelSeed: s});
  return {seed: s, L, attempts: SETTLE_GEN_STATS.attempts, ms: SETTLE_GEN_STATS.ms};
});

/** The walking distance field from the point outside the car's middle platform-side door (gen/fuelPlacement.ts's door point). */
function fromTrainDoor(L: StationLayout, ladders = true): Int32Array[] {
  const tp = playerTrainPlacement(L)!;
  const doors = PLAYER_TRAIN_SPEC.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const w = trainToWorld(tp, doors[Math.floor(doors.length / 2)], PLAYER_TRAIN_SPEC.floorY, -(PLAYER_TRAIN_SPEC.width / 2 + 0.75));
  const [sx, sy] = L.grid.cellOf(w.x, w.z);
  return levelDistance(L.levels, sx, sy, 0, ladders ? L.levelLinks : []);
}

describe('the Survivor Market, layout version 2 (the container settlement)', () => {
  it('is the default: valid for every seed on its first attempts, deterministic, quick; seeded variety', () => {
    for (const {seed, L, attempts, ms} of layouts) {
      expect(L.market!.v, `seed ${seed}`).toBe(2);
      expect([seed, marketLayoutIssues(L)]).toEqual([seed, []]);
      expect(attempts, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(ms, `seed ${seed}`).toBeLessThan(400);
    }
    const sig = (L: StationLayout) => JSON.stringify({areas: L.areas, doors: L.doors, props: L.props, lights: L.lights, signs: L.signs, market: L.market, rails: L.rails, links: L.levelLinks});
    expect(sig(generateMarketLevel({levelSeed: SEEDS[0]}))).toBe(sig(layouts[0].L));
    expect(sig(generateMarketLevel({levelSeed: SEEDS[0], layoutVersion: 2}))).toBe(sig(layouts[0].L));
    expect(new Set(layouts.map(({L}) => L.market!.stalls.map(s => s.name).join('|'))).size).toBeGreaterThan(5);
    expect(new Set(layouts.map(({L}) => L.levelLinks[0].bottom.x > L.grid.w * CELL / 2)).size).toBe(2); // both mirror states
    // the stalls sit in different containers from station to station
    expect(new Set(layouts.map(({L}) => L.market!.stalls.map(s => Math.round(s.front.x)).join(','))).size).toBeGreaterThan(5);
  });

  it('three storeys: the train docks; every walkable cell is reachable from its door (the rooftops by ladder), the ground and catwalks on foot', () => {
    for (const {seed, L} of layouts) {
      expect(L.levels.map(l => [l.id, l.role, l.baseY])).toEqual([[0, 'main', 0], [1, 'ring', SETTLE.bases[1]], [2, 'ring', SETTLE.bases[2]]]);
      expect([0, 1, 2].map(lv => storeyLabel(L, lv))).toEqual(['Market lanes', 'Catwalks', 'Rooftops']);
      const tp = playerTrainPlacement(L);
      expect(tp, `seed ${seed}`).not.toBeNull();
      expect(tp!.platformArea).toBe(L.platform);
      expect(arrivalPose(L, {kind: 'start'}, tp).source).toBe('train');
      // two stair runs up to the catwalks; one player-only ladder per rooftop (drawn / climbed as a maintenance ladder, never in the AI graph)
      expect(L.levelLinks.filter(k => k.kind === 'stairs' && k.lower === 0 && k.upper === 1).length).toBe(2);
      const ladders = L.levelLinks.filter(k => k.kind === 'ladder');
      expect(ladders.length).toBe(2 + 3);
      for (const k of ladders) expect([k.lower, k.upper, k.traversalId]).toEqual([1, 2, undefined]);
      expect(L.traversal.ladders.filter(l => l.kind === 'maintenance').length).toBe(ladders.length);
      const d = fromTrainDoor(L), walk = fromTrainDoor(L, false);
      for (const Lv of L.levels) {
        const g = Lv.grid;
        let bad = 0, onFoot = 0;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] !== FLOOR || g.blocked[i] || g.rampIdx[i] >= 0) continue;
          if (d[Lv.id][i] < 0) bad++;
          if (walk[Lv.id][i] >= 0) onFoot++;
        }
        expect([seed, Lv.id, bad]).toEqual([seed, Lv.id, 0]);
        if (Lv.id < 2) expect(onFoot, `${seed} storey ${Lv.id} on foot`).toBeGreaterThan(0);
        else expect(onFoot, `${seed}: the rooftops are ladder-only`).toBe(0);
      }
      // every catwalk / bridge cell is on foot (stairs + bridges join them all)
      const g1 = L.levels[1].grid;
      for (let i = 0; i < g1.cells.length; i++) if (g1.cells[i] === FLOOR && !g1.blocked[i] && g1.rampIdx[i] < 0) expect(walk[1][i], `${seed} catwalk cell ${i}`).toBeGreaterThanOrEqual(0);
      expect(levelsOf(L).unrailedDrops().filter(r => r.level !== 2 || Math.abs(r.y0 - SETTLE.bases[2]) > 0.05).length, `${seed} unrailed drops`).toBe(0);
    }
  });

  it('a dense assemblage of containers: cramped lanes, bridges overhead, and no solid column from a container top to the roof', () => {
    for (const {seed, L} of layouts) {
      const g0 = L.levels[0].grid, g1 = L.levels[1].grid, g2 = L.levels[2].grid;
      const rooms = L.areas.filter(a => a.kind === 'room');
      expect(rooms.filter(a => !a.level).length, `${seed} ground containers`).toBeGreaterThanOrEqual(20);
      expect(rooms.filter(a => a.level === 1).length, `${seed} upper homes`).toBeGreaterThanOrEqual(8);
      for (const label of ['Market Lane', 'Back Lane']) {
        const a = L.areas.find(q => q.label === label)!;
        expect(a.h * CELL, `${seed} ${label} width`).toBeLessThanOrEqual(3.5);
      }
      expect(L.areas.filter(a => a.level === 1 && a.role === 'crossover').length, `${seed} bridges`).toBeGreaterThanOrEqual(4);
      expect(L.areas.find(a => a.label === 'The Yard'), `${seed} the yard`).toBeDefined();
      for (const label of ['Communal kitchen', 'Bunk room', 'Workshop']) expect(rooms.some(a => a.label === label), `${seed} ${label}`).toBe(true);
      // every ground container's column carries a catwalk (storey 1) or an upper container with its rooftop (storey 1 solid, storey 2
      // open): the stacks step back and the space above them stays open to the shed roof
      let bad = 0;
      for (const a of rooms.filter(q => !q.level)) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
        const i = g0.idx(x, y);
        if (g0.area[i] !== a.id) continue;
        if (!(g1.cells[i] === FLOOR || (g1.cells[i] === SOLID && g2.cells[i] === FLOOR) || g1.area[i] >= 0 && L.areas[g1.area[i]].kind === 'room' && g2.cells[i] === FLOOR)) bad++;
      }
      expect([seed, bad]).toEqual([seed, 0]);
      // ... and every upper home has its rooftop over it
      for (const a of rooms.filter(q => q.level === 1)) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) expect(g2.cells[g2.idx(x, y)], `${seed} home ${a.id}`).toBe(FLOOR);
      // the containers' headroom and slabs: ground 2.6 m, upper homes 2.55 m, the rooftops under the shed roof
      for (const a of rooms) expect(a.ceil - (a.level ? SETTLE.bases[a.level] : 0)).toBeGreaterThanOrEqual(2.4);
    }
  });

  it('six real shops: counter, trader behind it, the customer in front, the trade\'s fixtures, displays on real item surfaces holding ~18 stacks', () => {
    const want: Record<string, string[]> = {gun: ['gunRack'], medical: ['medCabinet'], fuel: ['outdoorsPlankShelving'], general: ['outdoorsPlankShelving'], gear: ['outdoorsPlankShelving'], scrap: ['outdoorsPlankShelving']};
    const mixed = Array.from({length: 30}, (_, i) => ({uid: 1000 + i, itemId: ['beans', 'water', 'ammo_9mm', 'medkit', 'chips', 'bandage', 'battery', 'ammo_12ga'][i % 8]}));
    for (const {seed, L} of layouts) {
      const m = L.market!, walk = fromTrainDoor(L, false);
      expect(m.stalls.map(s => s.id)).toEqual([...MARKET_STALLS]);
      for (const s of m.stalls) {
        const a = L.areas[s.area], tag = `${seed} ${s.id}`;
        expect(a.label, tag).toBe(s.name);
        expect(a.type, tag).toBe('shop');
        const own = L.props.filter(p => p.area === s.area);
        expect(own.filter(p => p.kind === 'shopCounter').length, tag).toBeGreaterThanOrEqual(2);
        for (const k of want[s.id]) expect(own.some(p => p.kind === k), `${tag} ${k}`).toBe(true);
        for (const p of [s.trader, s.front]) {
          expect(marketStandOk(L.levels[p.level].grid, p.x, p.z), tag).toBe(true);
          expect(walk[p.level][L.grid.idx(...L.grid.cellOf(p.x, p.z))], `${tag} on foot from the train`).toBeGreaterThanOrEqual(0);
        }
        // across the counter (it runs along x), the trader facing the customer
        expect(Math.sign(s.trader.z - s.counter.z) * Math.sign(s.front.z - s.counter.z), tag).toBe(-1);
        expect(-Math.cos(s.trader.yaw) * Math.sign(s.front.z - s.trader.z), tag).toBeCloseTo(1, 6);
        // displays: on the shop's own empty-keyed holders / a solid bench top, with free height, nearest the customer first
        const disp = s.displays!;
        expect(disp.length, tag).toBeGreaterThanOrEqual(8);
        const far = disp.map(d => Math.hypot(d.x - s.front.x, d.z - s.front.z, d.y - (s.front.y + 1.6)));
        for (let k = 1; k < far.length; k++) expect(far[k], tag).toBeGreaterThanOrEqual(far[k - 1] - 1e-9);
        for (const d of disp) {
          const h = L.props[d.host!];
          expect(h.area, tag).toBe(s.area);
          expect(isLootHolderKind(h.kind) ? h.purpose === MARKET_EMPTY_KEY : SETTLE_DISPLAY.solidTops.includes(h.kind), `${tag} ${h.kind}`).toBe(true);
          expect(h.kind, tag).not.toBe('gunRack'); // (a decor rack: no item collision inside it)
          expect(Math.abs(d.x - h.x) <= h.hx + 1e-3 && Math.abs(d.z - h.z) <= h.hz + 1e-3 && d.y > h.y && d.y <= h.y + h.h + 0.01, tag).toBe(true);
          expect(d.clear!, tag).toBeGreaterThan(0.1);
          expect(d.level).toBe(s.front.level);
        }
        // the wares planner (market/wares) takes them as given and fits a full stall's worth of mixed stock
        const surfaces = stallSurfaces(L, s);
        expect(surfaces.length).toBe(disp.length);
        expect(planStall(mixed, surfaces, id => itemDims(id)).count, tag).toBe(WARES.maxPerStall);
      }
    }
  });

  it('resident spots of every kind on the ground and the catwalks (never the ladder-only rooftops), reachable on foot', () => {
    for (const {seed, L} of layouts) {
      const m = L.market!, walk = fromTrainDoor(L, false), tp = playerTrainPlacement(L)!;
      expect(m.spots.length, `seed ${seed}`).toBeGreaterThanOrEqual(MARKET_POPULATION.minSpots);
      expect(new Set(m.spots.map(s => s.kind))).toEqual(new Set(['idle', 'sit', 'work', 'cook', 'sleep', 'chat']));
      expect(new Set(m.spots.map(s => s.level))).toEqual(new Set([0, 1]));
      expect(m.residents).toBeGreaterThanOrEqual(MARKET_POPULATION.residents[0]);
      expect(m.residents).toBeLessThanOrEqual(MARKET_POPULATION.residents[1]);
      for (const s of m.spots) {
        expect(marketStandOk(L.levels[s.level].grid, s.x, s.z), `${seed} ${s.kind}`).toBe(true);
        expect(s.y).toBe(SETTLE.bases[s.level]);
        expect(walk[s.level][L.grid.idx(...L.grid.cellOf(s.x, s.z))], `${seed} ${s.kind} on foot`).toBeGreaterThanOrEqual(0);
        expect(s.z > tp.platformEdgeZ || s.level > 0, `${seed} ${s.kind} off the bed`).toBe(true);
      }
    }
  });

  it('the calm rules: no enemies, hordes, annexes, gas records or free loot; holders empty; the station fuel stays in the workshop', () => {
    const P = lootProfile('market');
    for (const {seed, L} of layouts) {
      expect([seed, L.zombies.length, L.hordes?.length ?? 0, L.pickups.length]).toEqual([seed, 0, 0, 0]);
      expect(L.extensions).toBeUndefined();
      expect(L.office ?? L.mall ?? L.reactor ?? L.skyways).toBeUndefined();
      // (task studio-base-salvage-20261108-073314-01) the ONE exception, as in version 1: the community stores — the workshop's tool chest and
      // the one store room's holders — carry the workshop key (its own table empty; only the market's additive basic-salvage lot can
      // appear there); every other holder (stalls and their displays, kitchen, bunks, homes, other containers) keeps the exact empty key
      let stores = 0;
      const storeAreas = new Set<number>();
      for (const p of L.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const a = L.areas[p.area], community = a.purpose === 'workshop' || a.label === 'Store room';
        const store = p.purpose === MARKET_WORKSHOP_KEY;
        expect([seed, p.kind, p.purpose]).toEqual([seed, p.kind, store ? MARKET_WORKSHOP_KEY : MARKET_EMPTY_KEY]);
        if (store) { stores++; storeAreas.add(p.area); expect(community, `${seed} ${p.kind} in ${a.label}`).toBe(true); }
        const t = holderTable(p.kind, p.purpose!, P);
        expect(t.empty === 1 || t.lots[1] === 0 || !t.rows.length, `${seed} ${p.kind}`).toBe(true);
        expect(!!extraSalvageRule(p.kind, p.purpose!, P), `${seed} ${p.kind} salvage`).toBe(store);
      }
      expect(stores, `${seed} community stores`).toBeGreaterThanOrEqual(2);
      expect(storeAreas.size, `${seed}`).toBeLessThanOrEqual(2); // the workshop + one store room (version 1's share, not every container)
      for (const s of L.market!.stalls) for (const d of s.displays ?? []) if (d.host !== undefined) expect(L.props[d.host]?.purpose, `${seed} ${s.id} display`).not.toBe(MARKET_WORKSHOP_KEY);
      const fp = placeStationFuel(L, {units: 4 * FUEL.canUnits, cans: 4, cart: 0}, 'st-07');
      expect(fp.cans.length).toBe(4);
      expect(new Set(fp.cans.map(c => L.areas[c.area].purpose)), `${seed}`).toEqual(new Set(['workshop']));
    }
    for (const s of SEEDS.slice(0, 4)) {
      const gear = rollLevelGear(s, 'market', ['main']);
      expect(gear.main).toEqual([]);
      expect(LEVELS.market.generate('main', {levelSeed: s, gear: gear.main}).pickups).toEqual([]);
    }
    expect(SPAWN_PROFILES.market.contexts.station!.count).toEqual([0, 0]);
    expect(SPAWN_PROFILES.market.horde).toBeUndefined();
    expect(LEVELS.market.trackExtensions).toBe('none');
  });

  it('existing art only: every lazy model it places is shared or one the market may load (no other level\'s own art)', () => {
    const files = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...MALL_MODEL_FILES};
    for (const {seed, L} of layouts) {
      const keys = [...new Set([...p7ModelKeysFor(L), ...officeModelKeysFor(L)])];
      expect(selectLevelKeys('market', keys, files).foreign, `${seed}`).toEqual([]);
    }
  });
});
