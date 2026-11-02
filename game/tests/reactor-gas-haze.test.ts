// Task reactor-playtest-round2-20261102 (lane GAS, user bullet 6): "side areas (the ones with generators) have really heavy white fog.
// Reduce it so that its more a "normal" amount of fog. Its like a fog machine party in there!" The ambient (white, non-hazard) haze of
// the rooms cut into the rock (world/reactor/archHaze.ts reactorRockRooms: the side complexes + the pit's side rooms) now takes the
// Reactor's `rockRoom` multiplier / class odds instead of the Subway back-of-house ones (utility 1.4, service 1.35, 'service' group: half
// dense x 1.4). Measured with the CPU mirror of the march (render/atmosphere.ts mediumAt, the moving noise included) on real layouts,
// against a normal Subway station. The pit galleries, every other level and the green toxic strata are untouched.
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {generateStation} from '../src/gen/station';
import {CELL, FLOOR} from '../src/gen/grid';
import {cellFloorFn} from '../src/world/lightField';
import {
  ATMOSPHERE, atmosphereFor, buildAirMap, buildDensityMap, buildNoiseVolume, fogMotion, mediumAt, mediumStats, type AtmosphereParams, type MediumMaps,
} from '../src/render/atmosphere';
import {REACTOR_ATMOSPHERE, reactorRockRooms} from '../src/world/reactor/archHaze';
import {REACTOR_GAS_LOOK} from '../src/world/reactor/air';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [9100, 218558, 637474];
const noise = buildNoiseVolume();
const mapsOf = (l: StationLayout, p: AtmosphereParams): MediumMaps => ({map: buildDensityMap(l, p), air: buildAirMap(l), noise, motion: fogMotion(l.seed, p)});

/** Mean haze sigma 1.4 m above the floor over the cells of the chosen areas on every storey, averaged over three fog times. */
function meanSigma(L: StationLayout, p: AtmosphereParams, pick: (area: number) => boolean, stride = 3): {mean: number; n: number} {
  const maps = mapsOf(L, p);
  let sum = 0, n = 0;
  L.levels.forEach((lv, s) => {
    const g = lv.grid, fl = cellFloorFn(g, L.trench.floorY);
    for (let i = 0; i < g.w * g.h; i += stride) {
      if (g.cells[i] !== FLOOR || !pick(g.area[i])) continue;
      const cx = i % g.w, cy = (i - cx) / g.w;
      for (const t of [0, 40, 95]) { sum += mediumAt([(cx + 0.5) * CELL, fl(cx, cy) + 1.4, (cy + 0.5) * CELL], maps, p, t, s).sigma; n++; }
    }
  });
  return {mean: n ? sum / n : 0, n};
}

describe('reactor gas: the side complexes\' white haze is a normal amount (lane GAS)', () => {
  // "normal elsewhere": the walking-height mean of ordinary Subway stations (the game's reference fog)
  const subwayMean = [11, 23, 37].map(seed => { const st = generateStation(seed); const p = atmosphereFor(st); return mediumStats(st, mapsOf(st, p), p, 0, 5).mean; }).reduce((a, b) => a + b) / 3;

  for (const seed of SEEDS) {
    it(`seed ${seed}: complex rooms drop to about a normal room's haze; the pit galleries and their look are unchanged`, () => {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}), r = L.reactor!;
      const p = atmosphereFor(L), before: AtmosphereParams = {...p, rockRoom: undefined};
      expect(p.rockRoom).toEqual(REACTOR_ATMOSPHERE.rockRoom);
      const rock = reactorRockRooms(L);
      const cplx = new Set(r.complexes!.flatMap(c => c.areas));
      expect(cplx.size).toBeGreaterThan(20);
      for (const a of cplx) expect(rock.has(a), `complex area ${a}`).toBe(true);
      for (const s of r.sites) expect(rock.has(s.area), `site ${s.id}`).toBe(true); // the pit's side rooms (switchgear, pump hall …)
      const inC = (a: number) => cplx.has(a);
      const was = meanSigma(L, before, inC), now = meanSigma(L, p, inC);
      // the fog-machine party: ~3-6x a normal Subway room before; now about the normal amount (still a haze, never removed)
      expect(was.mean / subwayMean, 'before vs a normal station').toBeGreaterThan(2.5);
      expect(now.mean / was.mean, 'reduction').toBeLessThan(0.45);
      expect(now.mean / subwayMean, 'now vs a normal station').toBeLessThan(1.5);
      expect(now.mean / subwayMean, 'still a haze').toBeGreaterThan(0.4);
      // per complex: none stays a fog bank
      for (const c of r.complexes!) {
        const set = new Set(c.areas);
        expect(meanSigma(L, p, a => set.has(a)).mean / subwayMean, c.id).toBeLessThan(1.9);
      }
      // the open pit (galleries, bridges, landings, stairs: not rock rooms) keeps exactly its classes / multipliers
      const mB = buildDensityMap(L, before), mA = buildDensityMap(L, p);
      L.areas.forEach((_a, i) => { if (!rock.has(i)) expect(mA.areas![i], `area ${i}`).toEqual(mB.areas![i]); });
      const notRock = (a: number) => !rock.has(a) && a >= 0;
      const pitB = meanSigma(L, before, notRock, 7), pitA = meanSigma(L, p, notRock, 7);
      expect(Math.abs(pitA.mean - pitB.mean) / pitB.mean, 'pit + rim haze unchanged (only the boundary blur)').toBeLessThan(0.03);
      if (process.env.LL_GAS_OUT) writeFileSync(process.env.LL_GAS_OUT, `seed ${seed} haze@1.4m: complexes ${was.mean.toFixed(4)} -> ${now.mean.toFixed(4)} /m (Subway normal ${subwayMean.toFixed(4)}), ${r.complexes!.map(c => { const s = new Set(c.areas); return `${c.id} ${meanSigma(L, before, a => s.has(a)).mean.toFixed(4)} -> ${meanSigma(L, p, a => s.has(a)).mean.toFixed(4)}`; }).join(', ')}; pit/rim ${pitB.mean.toFixed(4)} -> ${pitA.mean.toFixed(4)}\n`, {flag: 'a'});
    }, 120_000);
  }

  it('every other level is exactly as before (no rock rooms, no rockRoom param); the green toxic look is not the ambient haze', () => {
    const st = generateStation(11);
    expect(atmosphereFor(st).rockRoom).toBeUndefined();
    expect(ATMOSPHERE.rockRoom).toBeUndefined();
    expect(reactorRockRooms(st).size).toBe(0);
    const a = buildDensityMap(st, atmosphereFor(st)), b = buildDensityMap(st, {...atmosphereFor(st), rockRoom: {density: 0.1, group: 'hall'}});
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true); // no rock rooms on a Subway: the param changes nothing
    // the ambient haze is neutral (no tint parameter); the hazard keeps its own green look
    expect(REACTOR_GAS_LOOK.tint[1]).toBeGreaterThan(REACTOR_GAS_LOOK.tint[0] * 1.5);
  });
});
