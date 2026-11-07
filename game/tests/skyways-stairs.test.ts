// Task studio-skyways-rework-20261107-054512-01 (user bug report + screenshot): the Skyways stairs.
//  - "stair bulkhead / ceiling intrudes across approach, low clearance": the runs' flights kept a 2.5 m flight-following headroom under
//    their open well (a sloped soffit and a fascia hanging to 2.5 m at the stair foot). Every Skyways flight is now an OPEN well: its
//    band (collision, rays and the drawn ceiling alike) rises to the well's ceiling (Ramp.capCeil).
//  - "invisible solid barriers at varying stair seams, not always centre": every inner lane seam carried a hidden collision rail and
//    Skyways never drew escalators. Two fixed stair lanes now form one wide stair (no seam rail); an escalator lane is a drawn stopped
//    escalator whose glass balustrades carry its rails.
// Evidence with a REAL Player (player/player.ts) on generated levels: up and down every fixed stair lane, across a stair | stair seam
// mid-flight; the bands / drawn ceilings over the flights; the escalator visuals.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {levelsOf, type Levels} from '../src/gen/levels';
import {CELL, rampHeight} from '../src/gen/grid';
import {Player} from '../src/player/player';
import type {StationLayout} from '../src/gen/stationTypes';
import type {StairFlight} from '../src/gen/traversal';
import {cellCeil} from '../src/world/levelGeometry';
import {skywaysEscalatorFlights} from '../src/world/traversalBuilder';

const DT = 1 / 60;
class Keys { held = new Set<string>(); down(c: string) { return this.held.has(c); } hit() { return false; } }
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
const cache = new Map<string, StationLayout>();
const gen = (seed: number, layoutVersion?: number): StationLayout => {
  const key = `${seed}:${layoutVersion ?? ''}`;
  if (!cache.has(key)) cache.set(key, LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion ? {layoutVersion} : {})} as never));
  return cache.get(key)!;
};

/** Walks with W toward (tx, tz) until within `tol` or stuck; per-step stats. */
function walkTo(p: Player, L: Levels, tx: number, tz: number, cap = 60 * 25, tol = 0.3) {
  const keys = new Keys(); keys.held.add('KeyW');
  let maxDy = 0, minVy = 0, steps = 0, stuck = 0, last = Infinity;
  while (steps < cap && Math.hypot(tx - p.x, tz - p.z) > tol) {
    p.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
    const y0 = p.y;
    p.update(DT, keys, L, null, OPTS);
    maxDy = Math.max(maxDy, Math.abs(p.y - y0)); minVy = Math.min(minVy, p.vy);
    const d = Math.hypot(tx - p.x, tz - p.z);
    stuck = d > last - 1e-3 ? stuck + 1 : 0; last = d;
    if (stuck > 60) break;
    steps++;
  }
  return {maxDy, minVy, reached: Math.hypot(tx - p.x, tz - p.z) <= tol};
}

/** The runs of a layout: flights grouped by their run area (lane order across the run). */
function runsOf(l: StationLayout): StairFlight[][] {
  const by = new Map<number, StairFlight[]>();
  for (const k of l.levelLinks) { const f = l.traversal.stairs[k.traversalId ?? -1]; if (f) { const a = by.get(f.area) ?? []; a.push(f); by.set(f.area, a); } }
  return [...by.values()].map(fl => fl.sort((p, q) => p.a0 - q.a0));
}
const sTopOf = (f: StairFlight) => (f.h0 > f.h1 ? f.s0 : f.s1);
const sBotOf = (f: StairFlight) => (f.h0 > f.h1 ? f.s1 : f.s0);
const at = (f: StairFlight, s: number, a: number): [number, number] => (f.axis === 'x' ? [s, a] : [a, s]);

describe('Skyways stairs (user bug: low bulkhead over the approach, invisible barriers at lane seams)', () => {
  it('every flight is an open well: the collision band and the drawn ceiling over it rise to the well ceiling (never a 2.5 m soffit)', () => {
    for (const seed of [1, 2, 4]) {
      const l = gen(seed), L = levelsOf(l);
      for (const run of runsOf(l)) for (const f of run) {
        const lk = l.levelLinks.find(k => k.traversalId === f.id)!;
        const well = l.areas[f.area].ceil;
        const g = l.levels[lk.lower].grid, r = g.ramps[f.ramp];
        expect(r.capCeil, `seed ${seed} flight ${f.id}`).toBe(true);
        for (const u of [0.15, 0.5, 0.85]) {
          const s = sBotOf(f) + (sTopOf(f) - sBotOf(f)) * u, [x, z] = at(f, s, (f.a0 + f.a1) / 2);
          const fy = L.floorAt(x, z, rampHeight(r, s) + 0.2);
          expect(L.ceilAt(x, z, fy + 0.1), `seed ${seed} flight ${f.id} band at ${u}`).toBeCloseTo(well, 3);
          const [cx, cy] = g.cellOf(x, z);
          expect(cellCeil(g, g.idx(cx, cy)), `seed ${seed} flight ${f.id} drawn ceiling at ${u}`).toBeCloseTo(well, 3);
        }
      }
    }
  });

  it('a REAL Player walks up and down every fixed stair lane (continuous, never falls)', () => {
    for (const seed of [1, 4]) {
      const l = gen(seed), L = levelsOf(l);
      for (const run of runsOf(l)) for (const f of run.filter(q => q.spec !== 'escalator')) {
        const lk = l.levelLinks.find(k => k.traversalId === f.id)!;
        const up = Math.sign(sTopOf(f) - sBotOf(f)), a = (f.a0 + f.a1) / 2;
        const p = new Player();
        p.spawn(lk.bottom.x, lk.bottom.z, 0, 0);
        p.y = lk.bottom.y;
        const [tx, tz] = at(f, sTopOf(f) + up * 1.2, a);
        const w1 = walkTo(p, L, tx, tz);
        expect(w1.reached, `seed ${seed} flight ${f.id} up`).toBe(true);
        expect(p.y, `seed ${seed} flight ${f.id} top`).toBeCloseTo(lk.top.y, 1);
        expect(w1.maxDy).toBeLessThan(0.12);
        expect(w1.minVy).toBeGreaterThan(-1);
        const w2 = walkTo(p, L, lk.bottom.x, lk.bottom.z);
        expect(w2.reached, `seed ${seed} flight ${f.id} down`).toBe(true);
        expect(p.y).toBeCloseTo(lk.bottom.y, 1);
        expect(w2.minVy).toBeGreaterThan(-1);
      }
    }
  });

  it('two fixed stair lanes side by side are one wide stair: a sideways walk across the seam mid-flight is never blocked', () => {
    let crossed = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const l = gen(seed), L = levelsOf(l);
      for (const run of runsOf(l)) {
        for (let i = 0; i + 1 < run.length; i++) {
          const A = run[i], B = run[i + 1];
          if (A.spec === 'escalator' || B.spec === 'escalator') continue;
          const s = (sBotOf(A) + sTopOf(A)) / 2;
          const [x0, z0] = at(A, s, A.a0 + 0.6), [x1, z1] = at(B, s, B.a1 - 0.6);
          const p = new Player();
          p.spawn(x0, z0, 0, 0);
          p.y = L.floorAt(x0, z0, rampHeight(l.levels[0].grid.ramps[A.ramp], s) + 0.2);
          expect(walkTo(p, L, x1, z1, 60 * 8).reached, `seed ${seed} seam ${A.id}|${B.id}`).toBe(true);
          crossed++;
        }
      }
    }
    expect(crossed).toBeGreaterThan(0);
  });

  it('escalator lanes are drawn stopped escalators (their balustrades carry the seam rails); no rail is hidden between two stair lanes', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const l = gen(seed);
      const esc = l.traversal.stairs.filter(f => f.spec === 'escalator');
      expect(skywaysEscalatorFlights(l).length, `seed ${seed}`).toBe(esc.length);
      for (const run of runsOf(l)) {
        for (let i = 0; i + 1 < run.length; i++) {
          const A = run[i], B = run[i + 1];
          const line = A.a1, s0 = Math.min(A.s0, A.s1) - 2, s1 = Math.max(A.s0, A.s1) + 2;
          // rails along the seam line within the run's own extent (other rails elsewhere on the map may share the coordinate)
          const onSeam = l.rails.filter(r => (A.axis === 'x' ? Math.abs(r.z0 - line) < 1e-3 && Math.abs(r.z1 - line) < 1e-3 && Math.max(r.x0, r.x1) > s0 && Math.min(r.x0, r.x1) < s1
            : Math.abs(r.x0 - line) < 1e-3 && Math.abs(r.x1 - line) < 1e-3 && Math.max(r.z0, r.z1) > s0 && Math.min(r.z0, r.z1) < s1));
          if (A.spec !== 'escalator' && B.spec !== 'escalator') expect(onSeam.length, `seed ${seed} stair|stair seam`).toBe(0);
          else expect(onSeam.length, `seed ${seed} escalator seam`).toBeGreaterThan(0);
        }
      }
    }
    void CELL;
  });

  it('the fixes reach the stations entered before the rework (the frozen GAME77 generator): open wells there too', () => {
    const l = gen(4, 2);
    for (const f of l.traversal.stairs) expect(l.levels[0].grid.ramps[f.ramp].capCeil).toBe(true);
    expect(skywaysEscalatorFlights(l).length).toBe(l.traversal.stairs.filter(f => f.spec === 'escalator').length);
  });
});
