// Task studio-alpha-reactor-ending-polish-20261104-034806-01 (primary; user: "the under sides of stairs in the reactor pit are see
// through"). The flight builder (world/traversalBuilder.ts buildFlight) drew one-sided treads / risers (and, in a shaft, a ceiling
// following the flight) but no underside: a flight hanging over the open pit was see-through from below. Every Reactor flight now has a
// down-facing slab underside under its pitch line (below every step's inner corner); Subway flights (in their shafts) are unchanged.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {CELL, rampHeight, type Ramp} from '../src/gen/grid';
import {buildTraversal, FLIGHT_SOFFIT, type QuadSink} from '../src/world/traversalBuilder';
import {LevelColumns, stationLevels} from '../src/world/levelGeometry';
import {WorldMaterials} from '../src/world/materials';
import type {StationLayout} from '../src/gen/stationTypes';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);

interface Q { p: number[][]; n: readonly number[] }
function quads(L: StationLayout): Q[] {
  const out: Q[] = [];
  const sink: QuadSink = {quad: (p, n) => out.push({p, n})};
  const levels = stationLevels(L);
  buildTraversal(new THREE.Group(), L as never, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => sink, {levels, cols: new LevelColumns(levels)});
  return out;
}
const inFlight = (r: Ramp, x: number, z: number) => x >= r.x * CELL - 1e-6 && x <= (r.x + r.w) * CELL + 1e-6 && z >= r.y * CELL - 1e-6 && z <= (r.y + r.h) * CELL + 1e-6;
const along = (r: Ramp, x: number, z: number) => (r.axis === 'x' ? x : z);
/** Down-facing quads lying UNDER flight r's pitch line (a soffit), with their depth below it at every corner. */
function undersides(r: Ramp, qs: Q[]): number[][] {
  return qs.filter(q => q.n[1] < -0.5 && q.p.every(([x, , z]) => inFlight(r, x, z))).map(q => q.p.map(([x, y, z]) => rampHeight(r, along(r, x, z)) - y)).filter(d => d.every(v => v > 0 && v < 1)); // (its own slab: stacked scissor flights' undersides lie metres lower)
}

describe('reactor pit stairs: every flight has a solid underside (not see-through from below)', () => {
  for (const seed of [9100, 4242]) {
    it(`seed ${seed}: one down-facing slab under each flight, below every step's inner corner and inside the stringers' depth`, () => {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}) as StationLayout;
      const qs = quads(L), seen = new Set<string>();
      let flights = 0;
      for (const lv of stationLevels(L)) for (const r of lv.grid.ramps) {
        const key = `${r.x},${r.y},${r.w},${r.h},${r.h0},${r.h1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        flights++;
        const u = undersides(r, qs);
        expect(u.length, `flight ${key}`).toBeGreaterThan(0);
        const half = Math.abs(r.h1 - r.h0) / Math.max(1, r.risers) / 2;
        for (const d of u) for (const v of d) {
          expect(v, `under the steps' inner corners (${key})`).toBeGreaterThanOrEqual(half + FLIGHT_SOFFIT.clear - 1e-6);
          expect(v).toBeGreaterThanOrEqual(FLIGHT_SOFFIT.below - 1e-6);
          expect(v, "inside the open sides' 0.32 m stringers").toBeLessThanOrEqual(Math.max(FLIGHT_SOFFIT.below, half + FLIGHT_SOFFIT.clear) + 1e-6);
        }
      }
      expect(flights).toBeGreaterThan(5);
    }, 120_000);
  }

  it('a Subway station\'s flights (in their own shafts) keep exactly their old geometry: no underside', () => {
    const L = LEVELS.subway.generate('main', {levelSeed: 31}) as StationLayout;
    const qs = quads(L);
    let flights = 0;
    for (const lv of stationLevels(L)) for (const r of lv.grid.ramps) { flights++; expect(undersides(r, qs)).toEqual([]); }
    expect(flights).toBeGreaterThan(0);
  }, 120_000);
});
