// Task studio-bunker-rework-20261109-205115-01: THE BUNKER, layout version 2 — the whole level over a bounded seed set (the lead's
// integration test; each floor designer's own tests are tests/bunker-v2-floorN.test.ts):
//  - the version policy: a new / unvisited station builds version 2, an entered version-1 station keeps version 1 (frozen: tests/
//    bunker-v1-frozen.test.ts);
//  - validity: bunkerIssues (reachability from the train, two stairs + loops, objectives' fronts, gas + clean routes, levelIssues /
//    traversal / doorways / railings, enemy placement) + bunkerV2Issues (the spine: shaft solid, every anchor apron served, the landing
//    doors cut, the voids owned / left open with a gallery rim, the envelopes, the bulkhead's one way through);
//  - the record: storeys, three generators on storeys 2 / 3 / 4 (gen-0 .. gen-2), the core cluster on the lowest storey, the cargo lift,
//    the voids, the floors' titles; the vault's round bore (fix 2); determinism and the generation budget;
//  - enemies: the shared profile's contexts, the Siren in shelter rooms, a rare damp Strainer, no hordes, the arrival keep-off.

import {describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {generateBunkerLevel, bunkerIssues} from '../src/gen/bunker/index';
import {BUNKER_V2_STATS} from '../src/gen/bunker/v2/index';
import {bunkerV2Issues} from '../src/gen/bunker/v2/validate';
import {BUNKER_LAYOUT_LANE, BUNKER_LAYOUT_VERSION, bunkerLayoutVersionFor} from '../src/gen/bunker/layoutVersion';
import {V2, V2_BASES, V2_CORE_LEVEL, V2_LEVELS, V2_PROGRAMMES, bunkerSpine} from '../src/gen/bunker/v2/spine';
import {VAULT_CHEEK_CELLS, VAULT_CUT_TOP} from '../src/gen/bunker/v2/vault';
import {BUNKER_CORE_KIND, BUNKER_GENERATOR_KIND} from '../src/gen/bunker/bunkerTypes';
import {BUNKER_SPAWN_PROFILE, spawnContextOf} from '../src/ai/spawnTables';
import {bunkerSpawnContext} from '../src/gen/bunker/spawns';
import {levelDistance} from '../src/gen/levelGen';
import {CELL, FLOOR} from '../src/gen/grid';
import {isLootHolderKind} from '../src/items/loot';
import {ROOM_PURPOSES} from '../src/gen/purposes';
import type {StationLayout} from '../src/gen/stationTypes';

const LOG = '/tmp/bunker-v2-level.log';
const log = (s: string) => appendFileSync(LOG, s + '\n');
const SEEDS = Array.from({length: 8}, (_, k) => 9001 + k * 7919);
const CENSUS = Array.from({length: 16}, (_, k) => 4401 + k * 7919);

describe('Bunker v2: the whole level', () => {
  writeFileSync(LOG, '');
  const cache = new Map<number, StationLayout>();
  const gen = (seed: number): StationLayout => {
    let l = cache.get(seed);
    if (!l) {
      l = generateBunkerLevel({levelSeed: seed});
      cache.set(seed, l);
      log(`seed ${seed}: ${BUNKER_V2_STATS.ms.toFixed(0)} ms, attempts ${BUNKER_V2_STATS.attempts}, refused ${JSON.stringify(BUNKER_V2_STATS.refused)}, areas ${l.areas.length} props ${l.props.length} lights ${l.lights.length} zombies ${l.zombies.length} pickups ${l.pickups.length}`);
    }
    return l;
  };

  it('the version policy: new / unvisited -> 2; an entered version-1 station keeps 1; the dispatch', () => {
    expect(BUNKER_LAYOUT_VERSION).toBe(2);
    expect(bunkerLayoutVersionFor(undefined)).toBe(2);
    expect(bunkerLayoutVersionFor({visits: 0, lanes: {}})).toBe(2);
    expect(bunkerLayoutVersionFor({visits: 2, lanes: {[BUNKER_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    expect(bunkerLayoutVersionFor({visits: 2, lanes: {}})).toBe(1); // (entered with no record: the safe reading)
    expect(bunkerLayoutVersionFor({visits: 1, lanes: {[BUNKER_LAYOUT_LANE]: {v: 2}}})).toBe(2);
    expect(generateBunkerLevel({levelSeed: SEEDS[0], layoutVersion: 1}).bunker!.version).toBe(1);
    expect(gen(SEEDS[0]).bunker!.version).toBe(2);
    expect(generateBunkerLevel({levelSeed: SEEDS[0], layoutVersion: 2}).areas.length).toBe(gen(SEEDS[0]).areas.length);
  });

  it('every seed is valid (bunkerIssues + bunkerV2Issues), within the budget and deterministic', () => {
    let worst = 0;
    for (const s of SEEDS) {
      const t0 = performance.now();
      const l = gen(s);
      worst = Math.max(worst, performance.now() - t0);
      const issues = [...bunkerIssues(l), ...bunkerV2Issues(l)];
      if (issues.length) log(`seed ${s} issues ${JSON.stringify(issues.slice(0, 8))}`);
      expect(issues, `seed ${s}`).toEqual([]);
    }
    log(`worst generation ${worst.toFixed(0)} ms`);
    expect(worst).toBeLessThan(6000);
    const a = gen(SEEDS[1]), b = generateBunkerLevel({levelSeed: SEEDS[1]});
    expect(JSON.stringify({areas: b.areas, doors: b.doors, props: b.props, zombies: b.zombies, pickups: b.pickups, bunker: b.bunker}))
      .toBe(JSON.stringify({areas: a.areas, doors: a.doors, props: a.props, zombies: a.zombies, pickups: a.pickups, bunker: a.bunker}));
  });

  it('the record: six descending storeys, three generators on 2 / 3 / 4, the core cluster on the lowest, the lift, the voids, six floors', () => {
    for (const s of SEEDS) {
      const l = gen(s), b = l.bunker!;
      expect(b.storeys.map(q => [q.level, q.baseY, q.programme])).toEqual(V2_BASES.map((y, i) => [i, y, V2_PROGRAMMES[i]]));
      expect(b.generators.map(g => [g.id, g.level])).toEqual([['gen-0', 2], ['gen-1', 3], ['gen-2', 4]]);
      for (const g of b.generators) expect(l.props[g.prop].kind).toBe(BUNKER_GENERATOR_KIND);
      expect(b.core.level).toBe(V2_CORE_LEVEL);
      expect(l.props[b.core.prop].kind).toBe(BUNKER_CORE_KIND);
      expect(b.lift?.stops.map(q => q.level)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(b.voids?.map(v => v.id)).toEqual(['V12', 'V45']);
      expect(b.floors).toHaveLength(V2_LEVELS);
    }
  });

  it('the vault entry: a bore wider and taller than the blast door\'s ring, the 3-cell lane walkable over the threshold, its cheeks collision, no frame trim', () => {
    const sp = bunkerSpine();
    for (const s of SEEDS.slice(0, 4)) {
      const l = gen(s), g = l.grid, L = sp.station.lane;
      const lane = l.doors.find(d => d.x === L.x && d.y === L.y && d.w === L.w && d.h === L.h)!;
      expect(lane.noFrame).toBe(true);
      for (let y = L.y; y < L.y + L.h; y++) for (let x = L.x - VAULT_CHEEK_CELLS; x < L.x + L.w + VAULT_CHEEK_CELLS; x++) {
        const i = g.idx(x, y);
        expect(g.cells[i]).toBe(FLOOR);
        expect(g.ceil[i]).toBeCloseTo(VAULT_CUT_TOP, 5);
        const inLane = x >= L.x && x < L.x + L.w;
        expect(!!g.blocked[i], `cell ${x},${y}`).toBe(!inLane); // lane open, cheeks solid
      }
      const vp = l.props[l.bunker!.vaultDoor.prop];
      expect(vp.kind).toBe('blastDoor');
      expect(vp.variant).toBe(0);
      expect(Math.abs(l.bunker!.vaultDoor.x - (L.x + L.w / 2) * CELL)).toBeLessThan(1e-6);
    }
  });

  it('the voids: the owner\'s tall hall over the void, the upper storey\'s well open with a walkable rim; the lift apron clear on every storey', () => {
    const sp = bunkerSpine();
    for (const s of SEEDS.slice(0, 4)) {
      const l = gen(s);
      for (const v of sp.voids) {
        const lo = l.levels[v.lower].grid, up = l.levels[v.upper].grid;
        const i = lo.idx(v.rect.x + 2, v.rect.y + 2);
        expect(lo.cells[i]).toBe(FLOOR);
        expect(lo.ceil[i] - V2_BASES[v.lower]).toBeGreaterThan(10);
        expect(up.cells[i]).not.toBe(FLOOR);
      }
      for (let L = 0; L < V2_LEVELS; L++) {
        const an = sp.storeys[L].anchors.find(a => a.id === 'lift')!, g = l.levels[L].grid;
        for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) {
          const k = g.idx(x, y);
          expect(g.cells[k] === FLOOR && !g.blocked[k], `L${L} lift apron ${x},${y}`).toBe(true);
        }
      }
    }
    expect(V2.liftCabH).toBeGreaterThanOrEqual(3);
  });

  it('the architecture: every storey has a large open space AND constrained rooms (a real change of scale), the two tall voids', () => {
    for (const s of SEEDS.slice(0, 4)) {
      const l = gen(s);
      for (let L = 0; L < V2_LEVELS; L++) {
        const own = l.areas.filter(a => (a.level ?? 0) === L && a.role !== 'stair' && a.role !== 'landing' && a.type !== 'platform');
        const m2 = own.map(a => a.w * a.h * CELL * CELL).sort((a, b) => b - a);
        expect(m2[0], `seed ${s} storey ${L} largest space`).toBeGreaterThanOrEqual(140);
        expect(m2.filter(v => v <= 40).length, `seed ${s} storey ${L} small rooms`).toBeGreaterThanOrEqual(L === 0 ? 2 : 3);
        const tallest = Math.max(...own.map(a => a.ceil - V2_BASES[L]));
        expect(tallest, `seed ${s} storey ${L} tallest`).toBeGreaterThanOrEqual(5.2);
      }
    }
  });

  it('loot parity: the level carries about as many loot holders as version 1 (the rework is no loot cut), never more food holders', () => {
    const seeds = SEEDS.slice(0, 6);
    let v1 = 0, v2 = 0, f1 = 0, f2 = 0;
    const food = (l: StationLayout, p: StationLayout['props'][number]) => {
      const pu = (p as {purpose?: string}).purpose ?? l.areas[p.area]?.purpose ?? '';
      return (ROOM_PURPOSES as Record<string, {theme?: string}>)[pu]?.theme === 'food';
    };
    for (const s of seeds) {
      const a = generateBunkerLevel({levelSeed: s, layoutVersion: 1}), b = gen(s);
      for (const p of a.props) if (isLootHolderKind(p.kind)) { v1++; if (food(a, p)) f1++; }
      for (const p of b.props) if (isLootHolderKind(p.kind)) { v2++; if (food(b, p)) f2++; }
    }
    log(`loot holders / level: v1 ${(v1 / seeds.length).toFixed(1)} (food ${(f1 / seeds.length).toFixed(1)}), v2 ${(v2 / seeds.length).toFixed(1)} (food ${(f2 / seeds.length).toFixed(1)})`);
    expect(v2 / v1).toBeGreaterThanOrEqual(0.88);
    expect(v2 / v1).toBeLessThanOrEqual(1.15);
    expect(f2).toBeLessThanOrEqual(f1); // (no compensation for the natural-food cut: never more food holders than the first Bunker)
  });

  it('enemies (census): storey contexts, the Siren only in shelter rooms, a rare damp Strainer, no hordes, the keep-off; a budget like v1', () => {
    let total = 0, sirens = 0, withSiren = 0, strainers = 0, maxSiren = 0;
    for (const s of CENSUS) {
      const l = gen(s), b = l.bunker!, damp = new Set(b.damp);
      const g0 = l.grid, [sx, sy] = g0.cellOf(b.start.x, b.start.z);
      const dist = levelDistance(l.levels, sx, sy, 0, l.levelLinks);
      let si = 0;
      l.zombies.forEach((z, i) => {
        const lv = z.level ?? 0, ctx = spawnContextOf(l, BUNKER_SPAWN_PROFILE, i) ?? '?';
        if (ctx !== 'damp') expect(ctx).toBe(bunkerSpawnContext(lv));
        expect(z.horde).toBeUndefined();
        expect(z.look).toBeUndefined();
        const g = l.levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z);
        expect(dist[lv][g.idx(cx, cy)]).toBeGreaterThanOrEqual(BUNKER_SPAWN_PROFILE.contexts.station!.placement.startCells);
        const a = l.areas[z.area ?? -1];
        if (z.archetype === 'siren') { si++; expect(lv).toBeGreaterThan(0); expect(a?.kind).toBe('room'); }
        if (z.archetype === 'strainer') { strainers++; expect(ctx).toBe('damp'); expect(damp.has(z.area ?? -1)).toBe(true); }
      });
      total += l.zombies.length; sirens += si; maxSiren = Math.max(maxSiren, si); if (si) withSiren++;
      expect(l.zombies.filter(z => z.archetype === 'strainer').length).toBeLessThanOrEqual(1);
      expect(b.damp.length).toBeGreaterThan(0);
    }
    log(`census ${CENSUS.length}: ${(total / CENSUS.length).toFixed(1)} enemies / level, sirens ${(sirens / CENSUS.length).toFixed(2)} (on ${withSiren}), max ${maxSiren}, strainers ${strainers}`);
    expect(total / CENSUS.length).toBeGreaterThan(30);
    expect(total / CENSUS.length).toBeLessThanOrEqual(46);
    expect(maxSiren).toBeLessThanOrEqual(3);
    expect(withSiren).toBeGreaterThan(CENSUS.length / 2);
    expect(strainers).toBeLessThan(CENSUS.length);
  });
});
