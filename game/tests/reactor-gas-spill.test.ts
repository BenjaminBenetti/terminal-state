// Task reactor-playtest-round2-20261102 (lane GAS, user bullet 5): "on the level above the level that is covered in fog, there is also
// fog … right now its a little high. It doesn't damage you … Make it lower, about knee high. This is actually only an issue on the 2nd
// level below the starting level." The spill is zone 0's soft top on TIER 1 (the gassed tier 2 below it): zone 0's band top was mid-
// storey (~3 m above tier 1's deck), so its sub-threshold haze stood visibly to ~1.8 m (c >= 0.06) / ~2.2 m (c >= 0.03) on tier 1.
// gen/reactor/structure.ts ZONE0_TOP_ABOVE_DECK now puts it ~1.1 m lower: knee high, the eye clean, tier 2's hazard unchanged. Every
// other deck already stands 3 m above the next zone's top. Real generated layouts; render and exposure read one table.
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {GAS} from '../src/world/gas/field';
import {ReactorAir} from '../src/world/reactor/air';
import {layoutRect} from '../src/world/reactor/generators';
import {emptyReactorState} from '../src/world/reactor/runState';
import {ZONE0_TOP_ABOVE_DECK} from '../src/gen/reactor/structure';
import type {ReactorInfo} from '../src/gen/reactor/reactorTypes';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [9100, 218558, 637474];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = LEVELS.reactor.generate('main', {levelSeed: seed}); cache.set(seed, L); }
  return L;
};
const airOf = (L: StationLayout, info: ReactorInfo, cleared: number[] = []) => {
  const st = emptyReactorState(info.generators.length, info.zones.length);
  for (const z of cleared) st.zoneClear[z] = 1;
  const a = new ReactorAir(info, layoutRect(L), st);
  a.update(0, true);
  return a;
};
/** Highest height above `floor` (0..3 m, 5 cm steps) where the gas is at least c (-1 = none at all). */
const topAt = (a: ReactorAir, x: number, z: number, floor: number, c: number) => {
  let top = -1;
  for (let k = 0; k <= 60; k++) if (a.depthGasAt(x, floor + k * 0.05, z) >= c) top = k * 0.05;
  return top;
};
const e2bOf = (a: ReactorAir, x: number, z: number, r: ReactorInfo) => a.depthGasAt(x, r.tiers[2].baseY + 1.6, z).toFixed(3);
/** The same layout with zone 0's top where it used to be (mid-storey between the rim and tier 1): the before measurement. */
const oldRule = (r: ReactorInfo): ReactorInfo => ({...r, zones: r.zones.map((z, i) => (i === 0 ? {...z, yTop: Math.round((r.tiers[0].baseY + r.tiers[1].baseY) / 2 * 1000) / 1000} : z))});

describe('reactor gas: the visible spill onto the storey above a gassed storey is knee high (lane GAS)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: tier 1 over the gassed tier 2 — the haze ends about knee high (~1 m lower than before), the eye clean, tier 2 still deadly`, () => {
      const L = level(seed), r = L.reactor!, t1 = r.tiers[1], t2 = r.tiers[2];
      expect(r.zones[0].yTop).toBeCloseTo(t1.baseY + ZONE0_TOP_ABOVE_DECK, 3);
      const g0 = r.generators.find(g => g.zone === 0)!; // in the tier-1 bunker
      const now = airOf(L, r), before = airOf(L, oldRule(r));
      const x = g0.use.x, z = g0.use.z;
      const vis = topAt(now, x, z, t1.baseY, 0.06), faint = topAt(now, x, z, t1.baseY, 0.03);
      const vis0 = topAt(before, x, z, t1.baseY, 0.06), faint0 = topAt(before, x, z, t1.baseY, 0.03);
      // knee high: the clearly visible layer by ~0.75 m, faint wisps by ~1.25 m; before: waist / head high
      expect(vis, 'c >= 0.06 top').toBeGreaterThan(0.2); // still visible at the floor (the gas below is never hidden)
      expect(vis, 'c >= 0.06 top').toBeLessThanOrEqual(0.75);
      expect(faint, 'c >= 0.03 top').toBeLessThanOrEqual(1.25);
      expect(vis0 - vis, 'lowered ~1 m (clear layer)').toBeGreaterThanOrEqual(0.9);
      expect(faint0 - faint, 'lowered ~1 m (faint top)').toBeGreaterThanOrEqual(0.9);
      expect(vis0).toBeGreaterThan(1.4); // the user's "a little high"
      if (process.env.LL_GAS_OUT) writeFileSync(process.env.LL_GAS_OUT, `seed ${seed} tier 1: c>=0.06 ${vis0.toFixed(2)} -> ${vis.toFixed(2)} m, c>=0.03 ${faint0.toFixed(2)} -> ${faint.toFixed(2)} m, eye ${before.depthGasAt(x, t1.baseY + 1.6, z).toFixed(3)} -> ${now.depthGasAt(x, t1.baseY + 1.6, z).toFixed(3)}, floor ${before.depthGasAt(x, t1.baseY, z).toFixed(3)} -> ${now.depthGasAt(x, t1.baseY, z).toFixed(3)}; tier 2 eye ${e2bOf(before, x, z, r)} -> ${e2bOf(now, x, z, r)}\n`, {flag: 'a'});
      // what looks gassy hurts: below the threshold where it is thin; the eye (standing / crouched) breathes clean air
      expect(now.depthGasAt(x, t1.baseY + 1.6, z)).toBeLessThan(0.02);
      expect(now.depthGasAt(x, t1.baseY + 1.0, z)).toBeLessThan(GAS.THRESHOLD);
      for (let h = 0; h <= 3; h += 0.25) expect(now.depthGasAt(x, t1.baseY + h, z)).toBeLessThanOrEqual(before.depthGasAt(x, t1.baseY + h, z) + 1e-9);
      // tier 2 (the storey covered in fog) keeps its hazard: deadly at the eye, within 5 % of before
      const e2 = now.depthGasAt(x, t2.baseY + 1.6, z), e2b = before.depthGasAt(x, t2.baseY + 1.6, z);
      expect(e2).toBeGreaterThan(GAS.THRESHOLD + 0.05);
      expect(Math.abs(e2 - e2b) / e2b).toBeLessThan(0.05);
      expect(topAt(now, x, z, t2.baseY, GAS.THRESHOLD)).toBeGreaterThanOrEqual(3);
      // zone 0's bottom / the deeper zones are untouched; the rim stays clean
      expect(now.zones.slice(1)).toEqual(before.zones.slice(1));
      expect(now.zones[0].yBottom).toBe(before.zones[0].yBottom);
      expect(now.depthGasAt(x, 0 + 1.6, z)).toBe(0);
      // render = exposure: the drawn table at those heights is the sampled exposure
      for (const h of [0.1, 0.5, 1.0, 1.6]) expect(now.tableAt(t1.baseY + h)).toBe(now.depthGasAt(x, t1.baseY + h, z));
    }, 60_000);

    it(`seed ${seed}: no other deck has a spill — tier 2 over the gassed tier 3, tier 4 over the gassed core floor`, () => {
      const L = level(seed), r = L.reactor!, x = r.pit.cx, z = r.pit.cz;
      const z0 = airOf(L, r, [0]), z01 = airOf(L, r, [0, 1]);
      expect(topAt(z0, x, z, r.tiers[2].baseY, 0.01), 'tier 2, zone 0 cleared').toBe(-1);
      expect(topAt(z0, x, z, r.tiers[3].baseY, GAS.THRESHOLD), 'tier 3 gassed').toBeGreaterThanOrEqual(1.6);
      expect(topAt(z01, x, z, r.tiers[4].baseY, 0.01), 'tier 4, zones 0-1 cleared').toBe(-1);
      expect(topAt(z01, x, z, r.tiers[5].baseY, GAS.THRESHOLD), 'core floor gassed').toBeGreaterThanOrEqual(1.6);
    }, 60_000);
  }
});
