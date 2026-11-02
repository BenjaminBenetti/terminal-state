// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY in the REAL Reactor level (lane HOST's slot on tier 4,
// LEVELS.reactor.generate over 8 seeds): carved on every seed, complexIssues / reactorIssues clean, zone 2's generator inside it and
// reachable by stairs through the entrance, the decor record, the prop rules on the real dressing, carve + dress time. Focused.
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

  it('every repository gets its control console and switchgear (16 more seeds: the dresser / collider changes of other lanes move wall space)', () => {
    for (let seed = 9; seed <= 24; seed++) {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed});
      const D = L.reactorWaste;
      if (!L.reactor!.complexes?.some(q => q.id === 'waste')) continue; // (a seed whose slot the host could not plan keeps its landing generator)
      expect(D, `seed ${seed}`).toBeTruthy();
      expect(D!.models.filter(m => m.piece === 'switchgear').length, `seed ${seed} switchgear`).toBeGreaterThanOrEqual(1);
      expect(D!.models.filter(m => m.piece === 'controlConsole').length, `seed ${seed} console`).toBe(1);
      expect(complexIssues(L), `seed ${seed}`).toEqual([]);
    }
  });

  it('carves in < 60 ms and dresses in < 150 ms (mean over the seeds)', () => {
    let carve = 0, dress = 0;
    for (const seed of SEEDS) { const e = level(seed); carve += e.carveMs; dress += e.dressMs; }
    expect(carve / SEEDS.length).toBeLessThan(60);
    expect(dress / SEEDS.length).toBeLessThan(150);
  });
});
