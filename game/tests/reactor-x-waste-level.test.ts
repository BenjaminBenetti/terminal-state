// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY in the REAL Reactor level (lane HOST's slot on tier 4,
// LEVELS.reactor.generate over 8 seeds): carved on every seed, complexIssues / reactorIssues clean, zone 2's generator inside it and
// reachable by stairs through the entrance, the decor record, the prop rules on the real dressing, carve + dress time. Focused.
// Task studio-reactor-playtest-round2-20261102 (lane WASTE): the seeded room graph on the REAL slot — coherent on all 24 seeds
// (tests/reactor-x-waste-graph.ts), map labels for every space, and a different facility per seed (distinct graphs / positions).
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {reactorIssues} from '../src/gen/reactor/index';
import {COMPLEX_HOST_STATS, complexIssues} from '../src/gen/reactor/complex/host';
import {WASTE_DRESS_STATS} from '../src/gen/reactor/complex/wasteDress';
import {CELL, FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {propBlocksDoorway} from '../src/gen/placeKit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import type {StationLayout} from '../src/gen/stationTypes';
import {planStoreys} from '../src/world/reactor/mapBoardPlan';
import {MINES_FIT} from '../src/world/reactor/minesAssets';
import {cellsOfWorld, wasteCoherence, wasteSignature, type WasteSignature} from './reactor-x-waste-graph';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const cache = new Map<number, {L: StationLayout; carveMs: number; dressMs: number}>();
const level = (seed: number) => {
  let e = cache.get(seed);
  if (!e) {
    const L = LEVELS.reactor.generate('main', {levelSeed: seed});
    e = {L, carveMs: COMPLEX_HOST_STATS.ms.waste ?? NaN, dressMs: WASTE_DRESS_STATS.ms};
    cache.set(seed, e);
  }
  return e;
};

describe('Reactor waste repository (lane WASTE) in the real level', () => {
  it('is carved on every seed: complexIssues and reactorIssues clean, zone 2 generator inside, >= 11 spaces', () => {
    for (const seed of SEEDS) {
      const {L} = level(seed);
      const c = L.reactor!.complexes?.find(q => q.id === 'waste');
      expect(c, `seed ${seed}: waste complex carved`).toBeTruthy();
      expect(complexIssues(L), `seed ${seed}`).toEqual([]);
      expect(reactorIssues(L), `seed ${seed}`).toEqual([]);
      expect(c!.zone).toBe(2);
      expect(c!.areas.length).toBeGreaterThanOrEqual(11);
      const gen = L.reactor!.generators[c!.generator];
      expect(gen.zone).toBe(2);
      expect(c!.areas).toContain(gen.area);
      expect(L.areas[gen.area].label).toMatch(/Generator/);
      // walkable floor of the complex
      const g = L.levels[c!.level].grid, ids = new Set(c!.areas);
      let walk = 0;
      for (let i = 0; i < g.cells.length; i++) if (ids.has(g.area[i]) && g.cells[i] === FLOOR && !g.blocked[i]) walk++;
      expect(walk * CELL * CELL, `seed ${seed}`).toBeGreaterThanOrEqual(700);
      // the room graph: the logical entry sequence, the sealed controlled area, the service side, >= 2 loops
      expect(wasteCoherence(L, c!.slot!.frontArea), `seed ${seed}`).toEqual([]);
    }
  });

  it('labels every space for the map boards (the HUD / map label of each room, drawn on its storey\'s plan)', () => {
    for (const seed of SEEDS) {
      const {L} = level(seed);
      const c = L.reactor!.complexes!.find(q => q.id === 'waste')!;
      const plan = planStoreys(L, L.reactor!), st = plan.storeys.find(q => q.level === c.level)!;
      for (const r of c.rooms) {
        expect(r.label.length, r.key).toBeGreaterThan(3);
        expect(L.areas[r.area].label, r.key).toBe(r.label);
        expect(st.rooms.some(q => q.label === r.label.toUpperCase()), `seed ${seed}: ${r.label} on the map`).toBe(true);
      }
      for (const lb of ['Receiving bay', 'Health-physics checkpoint', 'Vault airlock', 'Dry-cask hall', 'Generator & ventilation plant']) expect(c.rooms.some(r => r.label === lb), lb).toBe(true);
    }
  });

  it('every walkable cell of the complex is reachable from the platform by stairs; the use point is clear', () => {
    for (const seed of SEEDS) {
      const {L} = level(seed);
      const c = L.reactor!.complexes!.find(q => q.id === 'waste')!, gen = L.reactor!.generators[c.generator];
      const st = L.reactor!.start, g0 = L.grid, [sx, sy] = g0.cellOf(st.x, st.z);
      const dist = levelDistance(L.levels, sx, sy, 0, L.levelLinks.filter(k => k.kind === 'stairs'));
      const g = L.levels[c.level].grid, ids = new Set(c.areas);
      let bad = 0;
      for (let i = 0; i < g.cells.length; i++) if (ids.has(g.area[i]) && g.cells[i] === FLOOR && !g.blocked[i] && dist[c.level][i] < 0) bad++;
      expect(bad, `seed ${seed}`).toBe(0);
      expect(g.circleClear(gen.use.x, gen.use.z, 0.3)).toBe(true);
      expect(Math.hypot(gen.panel.x - gen.use.x, gen.panel.z - gen.use.z)).toBeLessThanOrEqual(2.0);
    }
  });

  it('dresses the repository: decor record, hero models, anchored stores, plates and lamps; props follow the rules', () => {
    const audited = new Set(OPENABLE_AUDIT.map(e => e.kind));
    for (const seed of SEEDS) {
      const {L} = level(seed);
      const c = L.reactor!.complexes!.find(q => q.id === 'waste')!, ids = new Set(c.areas), D = L.reactorWaste!;
      expect(D, `seed ${seed}`).toBeTruthy();
      expect(D.level).toBe(c.level);
      const n = (p: string) => D.models.filter(m => m.piece === p).length;
      expect(n('wasteDrum'), `seed ${seed} drums`).toBeGreaterThanOrEqual(60);
      expect(n('storageCask'), `seed ${seed} casks`).toBeGreaterThanOrEqual(2);
      expect(n('deconShower') + n('hotCellWindow'), `seed ${seed} showers / hot cell`).toBeGreaterThanOrEqual(2);
      // (user bullet 13, via lane PROPS: no floating status beacons — a user-requested removal)
      expect(D.beacons.length).toBe(0);
      // one generator cable: the host's (panel -> through the entrance -> the fans); the repository draws none of its own
      expect((D as {cable?: unknown}).cable).toBeUndefined();
      expect(L.reactor!.generators[c.generator].cable.length).toBeGreaterThanOrEqual(2);
      expect(n('switchgear'), `seed ${seed} switchgear`).toBeGreaterThanOrEqual(1);
      expect(n('controlConsole'), `seed ${seed} console`).toBe(1);
      expect(D.fans.length, `seed ${seed} fans`).toBeGreaterThanOrEqual(1);
      const g = L.levels[c.level].grid;
      for (const p of L.props) {
        if (!ids.has(p.area) || (p.level ?? 0) !== c.level) continue;
        const [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(g.cells[i]).toBe(FLOOR);
        expect(p.y).toBeGreaterThanOrEqual(L.levels[c.level].baseY - 0.02);
        expect(p.y + p.h).toBeLessThanOrEqual(L.areas[p.area].ceil + 0.05);
        expect(audited.has(p.kind), p.kind).toBe(true);
        if (p.purpose?.startsWith('waste:')) expect(propBlocksDoorway(L, p.x, p.z, p.hx, p.hz, p.y, p.h), p.purpose).toBeNull();
      }
      // lights / plates of the complex hang inside it, at absolute heights on its storey
      const lights = L.lights.filter(l => ids.has(l.area));
      expect(lights.length).toBeGreaterThanOrEqual(20);
      for (const l of lights) { expect(l.level).toBe(c.level); expect(l.y).toBeLessThanOrEqual(L.areas[l.area].ceil + 1e-6); expect(l.y - L.levels[c.level].baseY).toBeGreaterThanOrEqual(1.9); }
      const signs = L.signs.filter(s => ids.has(s.area));
      expect(signs.length).toBeGreaterThanOrEqual(8);
      for (const s of signs) expect(s.level).toBe(c.level);
    }
  });

  it('every repository gets its control console and switchgear, coherent (16 more seeds); a different facility per seed over all 24', () => {
    const sigs: WasteSignature[] = [];
    const sig = (L: StationLayout) => { const c = L.reactor!.complexes!.find(q => q.id === 'waste')!; sigs.push(wasteSignature(L, cellsOfWorld(c.slot!.region), c.slot!.inward)); };
    for (const seed of SEEDS) sig(level(seed).L);
    for (let seed = 9; seed <= 24; seed++) {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed});
      const D = L.reactorWaste;
      if (!L.reactor!.complexes?.some(q => q.id === 'waste')) continue; // (a seed whose slot the host could not plan keeps its landing generator)
      expect(D, `seed ${seed}`).toBeTruthy();
      expect(D!.models.filter(m => m.piece === 'switchgear').length, `seed ${seed} switchgear`).toBeGreaterThanOrEqual(1);
      expect(D!.models.filter(m => m.piece === 'controlConsole').length, `seed ${seed} console`).toBe(1);
      expect(D!.models.filter(m => m.piece === 'wasteDrum').length, `seed ${seed} drums`).toBeGreaterThanOrEqual(60);
      expect(complexIssues(L), `seed ${seed}`).toEqual([]);
      const c = L.reactor!.complexes!.find(q => q.id === 'waste')!;
      expect(wasteCoherence(L, c.slot!.frontArea), `seed ${seed}`).toEqual([]);
      sig(L);
    }
    expect(sigs.length).toBeGreaterThanOrEqual(20);
    const distinct = (k: (s: WasteSignature) => string | number) => new Set(sigs.map(k)).size;
    expect(distinct(s => s.topo)).toBeGreaterThanOrEqual(sigs.length - 2);
    expect(distinct(s => s.geo)).toBeGreaterThanOrEqual(sigs.length - 4);
    expect(distinct(s => s.cask)).toBeGreaterThanOrEqual(4);
    expect(distinct(s => s.plant)).toBeGreaterThanOrEqual(4);
    expect(distinct(s => s.vault)).toBeGreaterThanOrEqual(10);
    expect(distinct(s => s.corridors)).toBeGreaterThanOrEqual(2);
    expect(distinct(s => s.switchgear)).toBeGreaterThanOrEqual(2);
  });

  it('keeps every guaranteed piece when the shared station dresser\'s draws shift upstream (the mines drill at fits 1.5 / 1.9, 12 seeds)', () => {
    // (lead / lane PROPS: the drill's real size moves tier 2's dressing, so tier 4 meets a different furnishing: the booths, the
    // hot-cell window, the casks, the fans, the switchgear, the console, the drums and the graph must not depend on it)
    const keep = MINES_FIT.drillRig;
    try {
      for (const [fit, seeds] of [[1.9, [1, 2, 3, 4, 5, 6, 7, 8]], [1.5, [9, 12, 15, 18]]] as const) {
        MINES_FIT.drillRig = fit;
        for (const seed of seeds) {
          const L = LEVELS.reactor.generate('main', {levelSeed: seed});
          const c = L.reactor!.complexes?.find(q => q.id === 'waste');
          expect(c, `fit ${fit} seed ${seed}`).toBeTruthy();
          const D = L.reactorWaste!, n = (p: string) => D.models.filter(m => m.piece === p).length, tag = `fit ${fit} seed ${seed}`;
          expect(n('deconShower') + n('hotCellWindow'), `${tag} showers / hot cell`).toBeGreaterThanOrEqual(2);
          expect(n('hotCellWindow'), tag).toBe(1);
          expect(n('switchgear'), tag).toBeGreaterThanOrEqual(1);
          expect(n('controlConsole'), tag).toBe(1);
          expect(n('wasteDrum'), tag).toBeGreaterThanOrEqual(60);
          expect(n('storageCask'), tag).toBeGreaterThanOrEqual(2);
          expect(D.fans.length, tag).toBeGreaterThanOrEqual(1);
          expect(D.genSign, tag).toBeTruthy();
          expect(wasteCoherence(L, c!.slot!.frontArea), tag).toEqual([]);
          expect(complexIssues(L), tag).toEqual([]);
        }
      }
    } finally { MINES_FIT.drillRig = keep; }
  }, 120_000);

  it('carves in < 60 ms and dresses in < 150 ms (mean over the seeds)', () => {
    let carve = 0, dress = 0;
    for (const seed of SEEDS) { const e = level(seed); carve += e.carveMs; dress += e.dressMs; }
    expect(carve / SEEDS.length).toBeLessThan(60);
    expect(dress / SEEDS.length).toBeLessThan(150);
  });
});
