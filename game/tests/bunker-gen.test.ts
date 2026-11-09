// Task studio-bunker-level-20261109-072224-01: THE BUNKER generator over a bounded seed set — validity (bunkerIssues: reachability,
// stairs + loops, objectives, hazards, levelIssues / traversal / doorways / railings), descending storeys, the storey programmes, the
// generators / core placement, determinism and the generation budget.

import {describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {BUNKER_GEN_STATS, BUNKER_REJECTS, bunkerIssues, generateBunkerLevel} from '../src/gen/bunker/index';
import {BUNKER_CARVE_FAILS} from '../src/gen/bunker/carve';
import {BUNKER_PLAN_FAILS} from '../src/gen/bunker/plan';
import {BUNKER_DRESS_STATS, HERO_FAILS} from '../src/gen/bunker/dress';
import {BUNKER_CORE_KIND, BUNKER_GENERATOR_KIND} from '../src/gen/bunker/bunkerTypes';
import {BUNKER_LEVELS, BUNKER_PROGRAMMES} from '../src/gen/bunker/frame';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {frontCells} from '../src/gen/bunker/validate';
import {GAS_STRONG} from '../src/gen/bunker/hazards';
import {playerTrainPlacement} from '../src/gen/playerTrain';

const LOG = '/tmp/bunker-gen.log';
const log = (s: string) => appendFileSync(LOG, s + '\n');
const SEEDS = Array.from({length: 12}, (_, k) => 9001 + k * 7919);

describe('bunker generation', () => {
  writeFileSync(LOG, '');
  const layouts = new Map<number, StationLayout>();
  const gen = (seed: number) => {
    let l = layouts.get(seed);
    if (!l) {
      try { l = generateBunkerLevel({levelSeed: seed}); } catch (e) {
        log(`seed ${seed} FAILED: carve ${JSON.stringify(BUNKER_CARVE_FAILS)} plan ${JSON.stringify(BUNKER_PLAN_FAILS)} dress ${JSON.stringify(BUNKER_DRESS_STATS.skipped)} hero ${JSON.stringify(HERO_FAILS)}`);
        throw e;
      }
      layouts.set(seed, l);
      log(`seed ${seed}: ${BUNKER_GEN_STATS.ms.toFixed(0)} ms, attempts ${BUNKER_GEN_STATS.attempts}, carveFails ${BUNKER_GEN_STATS.carveFails}, issues ${JSON.stringify(BUNKER_GEN_STATS.issues.slice(0, 6))}`);
      log(`  grid ${l.grid.w}x${l.grid.h} areas ${l.areas.length} props ${l.props.length} lights ${l.lights.length} zombies ${l.zombies.length} pickups ${l.pickups.length} dress ${JSON.stringify(BUNKER_DRESS_STATS.skipped.slice(0, 4))}`);
    }
    return l;
  };

  it('every seed generates a valid layout (bunkerIssues empty)', () => {
    const bad: string[] = [];
    for (const s of SEEDS) {
      const l = gen(s);
      const issues = bunkerIssues(l);
      if (issues.length) bad.push(`${s}: ${issues.slice(0, 5).join(' | ')}`);
    }
    log(`carve fails ${JSON.stringify(BUNKER_CARVE_FAILS)}`);
    log(`plan fails ${JSON.stringify(BUNKER_PLAN_FAILS)}`);
    log(`rejects ${JSON.stringify([...BUNKER_REJECTS])}`);
    expect(bad).toEqual([]);
  });

  it('storeys descend with their programmes; three generators on storeys 2-4; the core on the lowest storey', () => {
    for (const s of SEEDS) {
      const l = gen(s), b = l.bunker!;
      expect(l.levels.length).toBe(BUNKER_LEVELS);
      for (let i = 1; i < l.levels.length; i++) expect(l.levels[i].baseY).toBeLessThan(l.levels[i - 1].baseY);
      expect(b.storeys.map(q => q.programme)).toEqual(BUNKER_PROGRAMMES);
      expect(b.generators.map(g => g.id)).toEqual(['gen-0', 'gen-1', 'gen-2']);
      expect(b.generators.map(g => g.level)).toEqual([2, 3, 4]);
      for (const g of b.generators) expect(l.props[g.prop].kind).toBe(BUNKER_GENERATOR_KIND);
      expect(l.props.filter(p => p.kind === BUNKER_GENERATOR_KIND).length).toBe(3);
      expect(l.props[b.core.prop].kind).toBe(BUNKER_CORE_KIND);
      expect(b.core.level).toBe(BUNKER_LEVELS - 1);
      expect(Math.max(...l.levels.map(q => q.id))).toBe(b.core.level);
    }
  });

  it('connected train -> every generator -> the core -> train; the vault door passable both ways; two stairs per shelter storey pair', () => {
    for (const s of SEEDS) {
      const l = gen(s), b = l.bunker!;
      const from = (lv: number, x: number, z: number) => { const g = l.levels[lv].grid, [cx, cy] = g.cellOf(x, z); return levelDistance(l.levels, cx, cy, lv, l.levelLinks); };
      const reach = (d: Int32Array[], lv: number, prop: number) => frontCells(l.levels[lv].grid, l.props[prop], 3).some(i => d[lv][i] >= 0);
      const dTrain = from(0, b.start.x, b.start.z);
      for (const g of b.generators) expect(reach(dTrain, g.level, g.prop), `${s} train -> ${g.id}`).toBe(true);
      expect(reach(dTrain, b.core.level, b.core.prop), `${s} train -> core`).toBe(true);
      // and back: from the core's front to the platform and to every generator (the walk graph is undirected, checked anyway)
      const cp = l.props[b.core.prop], cf = frontCells(l.levels[b.core.level].grid, cp, 3).find(i => l.levels[b.core.level].grid.cells[i] === FLOOR)!;
      const gC = l.levels[b.core.level].grid, dCore = levelDistance(l.levels, cf % gC.w, Math.floor(cf / gC.w), b.core.level, l.levelLinks);
      const [px, py] = l.grid.cellOf(b.start.x, b.start.z);
      expect(dCore[0][l.grid.idx(px, py)], `${s} core -> train`).toBeGreaterThanOrEqual(0);
      for (const g of b.generators) expect(reach(dCore, g.level, g.prop), `${s} core -> ${g.id}`).toBe(true);
      // the vault: the hall side and the vestibule side of the bulkhead reach each other through the lane
      const vz = b.vaultDoor.z, vx = b.vaultDoor.x;
      const dHall = from(0, vx, vz - 3.5);
      const [ix, iy] = l.grid.cellOf(vx, vz + 3.0);
      expect(dHall[0][l.grid.idx(ix, iy)], `${s} hall -> vestibule`).toBeGreaterThanOrEqual(0);
      const dVest = from(0, vx, vz + 3.0), [hx, hy] = l.grid.cellOf(vx, vz - 3.5);
      expect(dVest[0][l.grid.idx(hx, hy)], `${s} vestibule -> hall`).toBeGreaterThanOrEqual(0);
      expect(l.props[b.vaultDoor.prop].kind).toBe('blastDoor');
      // the player's train parks on the bed beside the platform, its start inside the car
      const train = playerTrainPlacement(l);
      expect(train, `${s} train`).not.toBeNull();
      expect(train!.platformArea).toBe(l.platform);
      for (let lv = 0; lv + 1 < BUNKER_LEVELS; lv++) {
        const n = l.levelLinks.filter(k => k.kind === 'stairs' && k.upper === lv && k.lower === lv + 1).length;
        expect(n, `${s} storeys ${lv}-${lv + 1}`).toBe(lv === 0 ? 1 : 2);
      }
    }
  });

  it('each storey holds its programme; footprints 40-70 m; damp areas on the maintenance storey; gas zones 3-6 with a strong one', () => {
    const want: Record<number, string[]> = {
      1: ['Decontamination', 'Muster hall', 'Security checkpoint', 'Armoury', 'Operations room', 'Latrines'],
      2: ['Habitation plant room', 'Mess hall', 'Kitchen', 'Pantry', 'Dormitory A', 'Dormitory B', 'Latrines & showers', 'Recreation room'],
      3: ['Services plant room', 'Warehouse', 'Infirmary', 'Isolation ward', 'Shelter stores', 'Workshop'],
      4: ['Maintenance plant room', 'Pump hall', 'Water treatment', 'Air filtration plant', 'Boiler room', 'Maintenance workshop'],
      5: ['Central processing hall', 'Cooling plant', 'Core control room', 'Switch room'],
    };
    for (const s of SEEDS) {
      const l = gen(s), b = l.bunker!;
      for (const [lv, labels] of Object.entries(want)) {
        const have = new Set(l.areas.filter(a => (a.level ?? 0) === Number(lv)).map(a => a.label));
        for (const lab of labels) expect(have.has(lab), `${s} L${lv} ${lab}`).toBe(true);
      }
      for (let lv = 1; lv < BUNKER_LEVELS; lv++) {
        const as = l.areas.filter(a => (a.level ?? 0) === lv);
        const w = (Math.max(...as.map(a => a.x + a.w)) - Math.min(...as.map(a => a.x))) * CELL, d = (Math.max(...as.map(a => a.y + a.h)) - Math.min(...as.map(a => a.y))) * CELL;
        expect(Math.max(w, d), `${s} L${lv} footprint`).toBeLessThanOrEqual(70);
        expect(Math.max(w, d), `${s} L${lv} footprint`).toBeGreaterThanOrEqual(36);
      }
      expect(b.damp.length).toBeGreaterThan(0);
      for (const id of b.damp) expect(l.areas[id].level).toBe(4);
      expect(l.levels[4].role).toBe('lower');
      expect(b.gasZones.length).toBeGreaterThanOrEqual(3);
      expect(b.gasZones.length).toBeLessThanOrEqual(6);
      expect(b.gasZones.some(z => z.strength >= GAS_STRONG)).toBe(true);
      // the processing hall: tall, its rack rows, the cluster with 3 m of its own floor in front
      const hall = l.areas[b.core.area];
      expect(hall.ceil - l.levels[b.core.level].baseY).toBeGreaterThanOrEqual(3.6);
      expect(l.props.filter(p => p.area === hall.id && p.kind === 'serverRack').length).toBeGreaterThanOrEqual(8);
    }
  });

  it('stays inside the generation budget', () => {
    let worst = 0;
    for (const s of SEEDS.slice(0, 6)) { const t0 = performance.now(); generateBunkerLevel({levelSeed: s}); worst = Math.max(worst, performance.now() - t0); }
    log(`worst generation ${worst.toFixed(0)} ms`);
    expect(worst).toBeLessThan(6000);
  });

  it('is deterministic (same seed, same layout)', () => {
    const s = SEEDS[0];
    const a = gen(s), b = generateBunkerLevel({levelSeed: s});
    expect(JSON.stringify({areas: b.areas, doors: b.doors, props: b.props, zombies: b.zombies, pickups: b.pickups, bunker: b.bunker}))
      .toBe(JSON.stringify({areas: a.areas, doors: a.doors, props: a.props, zombies: a.zombies, pickups: a.pickups, bunker: a.bunker}));
  });
});
