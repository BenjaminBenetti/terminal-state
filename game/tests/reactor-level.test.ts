// Task reactor-build-20261101 (primary): THE REACTOR end to end on REAL generated layouts — the lanes' own tests run on hand-built
// fixtures; this file joins them on the generator's output: the restart chain is complete and usable, the generator route never
// needs a mask (no gas deadlock), the mask route is real (the deep air hurts), the kit plans every set piece within a bounded cost,
// and the level regenerates identically. Pure (no renderer / DOM).
// Task reactor-playtest-round2-20261102 (lane GAS, user design change): the final generator now JAMS (gen/reactor/gasJam.ts), so the
// generator route needs no mask down to the final generator's deck, and the core floor needs the mask until the reactor is online
// (tests/reactor-gas-jam.test.ts: the rule, the upstream supply, the filter budget, the surfaces).
import {describe, expect, it} from 'vitest';
import {LEVELS, arrivalPose} from '../src/levels/registry';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {levelsOf} from '../src/gen/levels';
import {GAS} from '../src/world/gas/field';
import {ReactorAir} from '../src/world/reactor/air';
import {layoutRect} from '../src/world/reactor/generators';
import {emptyReactorState} from '../src/world/reactor/runState';
import {RESTART_CONTROL_IDS} from '../src/world/reactor/restartLogic';
import {planReactorKit} from '../src/world/reactor/archKit';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {reactorJam} from '../src/gen/reactor/gasJam'; // task reactor-playtest-round2-20261102 (lane GAS)
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [9100, 218558, 637474];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = LEVELS.reactor.generate('main', {levelSeed: seed}); cache.set(seed, L); }
  return L;
};
const EYE = 1.6;

describe('the Reactor on real generated layouts', () => {
  it('regenerates identically from its seed (revisits / Retry never re-roll the pit)', () => {
    const a = LEVELS.reactor.generate('main', {levelSeed: SEEDS[0]}), b = level(SEEDS[0]);
    expect(JSON.stringify(a.reactor)).toBe(JSON.stringify(b.reactor));
    expect(a.zombies.length).toBe(b.zombies.length);
    expect(JSON.stringify(a.pickups)).toBe(JSON.stringify(b.pickups));
  }, 60_000);

  for (const seed of SEEDS) {
    it(`seed ${seed}: a rim station on top, tiers going down, the core at the bottom, three zones with their generators`, () => {
      const L = level(seed), r = L.reactor!;
      expect(r).toBeDefined();
      expect(r.tiers[0].role).toBe('rim');
      expect(r.tiers[0].zone).toBe(-1);
      expect(r.tiers[r.tiers.length - 1].role).toBe('core');
      for (let i = 1; i < r.tiers.length; i++) expect(r.tiers[i].baseY).toBeLessThan(r.tiers[i - 1].baseY);
      expect(r.pit.floorY - r.pit.rimY).toBeLessThan(-25); // a deep pit
      expect(r.pit.roofY - r.pit.rimY).toBeGreaterThan(10); // the crane / pipes rise above the rim
      expect(r.zones.length).toBe(3);
      expect(r.generators.length).toBe(3);
      for (const z of r.zones) expect(r.generators.filter(g => g.zone === z.id).length).toBe(1);
      expect(r.arrival.stop1 - r.arrival.stop0).toBeGreaterThanOrEqual(30);
      expect(L.platforms).toContain(r.arrival.platform);
      for (const k of ['stairs', 'bridge', 'ladder'] as const) expect(r.routes.some(x => x.kind === k), k).toBe(true);
    }, 60_000);

    it(`seed ${seed}: the shared player train (PR 33 contract) parks at the rim station inside the Reactor's arrival stop window`, () => {
      const L = level(seed), r = L.reactor!;
      const p = playerTrainPlacement(L);
      expect(p, 'train placement').not.toBeNull();
      expect(p!.level).toBe(0);
      expect(p!.trenchIndex).toBe(r.arrival.trench);
      expect(p!.x0).toBeGreaterThanOrEqual(Math.min(r.arrival.stop0, r.arrival.stop1) - 1e-6);
      expect(p!.x1).toBeLessThanOrEqual(Math.max(r.arrival.stop0, r.arrival.stop1) + 1e-6);
      expect(arrivalPose(L, {kind: 'start'}, p).source).toBe('train'); // New game / Travel / Retry arrive in the car
      expect(arrivalPose(L, {kind: 'start'}).source).toBe('start'); // without a train: the rim platform start (layout.reactor.start)
    }, 60_000);

    it(`seed ${seed}: the restart chain is complete — every control at a walkable stand point, parts guaranteed, never behind their own lock`, () => {
      const L = level(seed), r = L.reactor!, lv = levelsOf(L);
      const controls = r.sites.flatMap(s => s.controls.map(c => ({site: s, c})));
      for (const id of RESTART_CONTROL_IDS) expect(controls.filter(x => x.c.id === id).length, id).toBe(1);
      for (const {c} of controls) {
        const y = L.levels[c.stand.level].baseY;
        const sup = lv.supportAt(c.stand.x, c.stand.z, y + 0.5);
        expect(sup, `${c.id} stand`).not.toBeNull();
        expect(Math.abs(sup!.floor - y), `${c.id} stand floor`).toBeLessThan(0.6);
        expect(Math.hypot(c.at.x - c.stand.x, c.at.z - c.stand.z), `${c.id} reach`).toBeLessThan(2.2);
      }
      const keys = r.components.filter(c => c.item === 'reactor_key'), fuses = r.components.filter(c => c.item === 'fuse_cartridge');
      expect(keys.length).toBe(1);
      expect(fuses.length).toBeGreaterThanOrEqual(2);
      const switchgear = r.sites.find(s => s.id === 'switchgear')!;
      for (const c of r.components) {
        expect(L.pickups[c.pickup].itemId).toBe(c.item);
        expect(L.pickups[c.pickup].count).toBe(1);
        if (c.item === 'fuse_cartridge') expect(c.area).not.toBe(switchgear.area);
      }
      for (const id of ['rimOffice', 'switchgear', 'pumpHall', 'control'] as const) expect(r.sites.some(s => s.id === id), id).toBe(true);
      for (const id of ['pitBoard', 'switchgearBoard', 'pumpBoard', 'controlMonitor'] as const) expect(r.screens.some(s => s.id === id), id).toBe(true);
    }, 60_000);

    it(`seed ${seed}: generator route without a mask (each generator stands in clean / cleared air); the final one jams, so the core floor needs the mask`, () => {
      const L = level(seed), r = L.reactor!, rect = layoutRect(L);
      const st = emptyReactorState(r.generators.length, r.zones.length);
      const fresh = new ReactorAir(r, rect, st);
      fresh.update(0, true);
      // the rim breathes; the core floor is deadly without a mask (the mask + filter route is a genuine choice)
      expect(fresh.depthGasAt(r.start.x, r.tiers[0].baseY + EYE, r.start.z)).toBeLessThan(GAS.HUD_MIN);
      const core = r.tiers[r.tiers.length - 1];
      expect(fresh.depthGasAt(r.core.x + r.core.radius + 3, core.baseY + EYE, r.core.z)).toBeGreaterThan(0.5);
      // no deadlock: with every zone ABOVE generator k's zone cleared, the air at generator k's use point does not hurt
      const order = [...r.generators].sort((a, b) => r.zones[a.zone].yTop > r.zones[b.zone].yTop ? -1 : 1);
      for (const g of order) {
        const s2 = emptyReactorState(r.generators.length, r.zones.length);
        for (const z of r.zones) if (z.yTop > r.zones[g.zone].yTop) s2.zoneClear[z.id] = 1;
        const air = new ReactorAir(r, rect, s2);
        air.update(0, true);
        const y = L.levels[g.use.level].baseY + EYE;
        expect(air.depthGasAt(g.use.x, y, g.use.z), `generator ${g.id} (zone ${g.zone}) use point`).toBeLessThan(GAS.THRESHOLD);
      }
      // (lane GAS) the final generator jams: with every working generator's zone cleared the core floor is still deadly unmasked
      const jam = reactorJam(r)!;
      const s3 = emptyReactorState(r.generators.length, r.zones.length);
      for (const z of r.zones) if (z.id !== jam.zone) s3.zoneClear[z.id] = 1;
      const air3 = new ReactorAir(r, rect, s3);
      air3.update(0, true);
      expect(air3.depthGasAt(r.core.x + r.core.radius + 3, core.baseY + EYE, r.core.z)).toBeGreaterThan(0.5);
      // the guaranteed mask + a finite filter supply (the filter route never depends on an earlier level)
      expect(MASK_LOOT.levels.reactor.masks[0]).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it(`seed ${seed}: the kit plans every set piece, bounded`, () => {
      const r = level(seed).reactor!;
      const plan = planReactorKit(r);
      expect(plan.stats.decksSupported).toBe(plan.stats.decks);
      expect(plan.stats.fans).toBe(r.fans.length);
      expect(plan.stats.generators).toBe(r.generators.length);
      expect(plan.stats.towers).toBe(r.towers.length);
      expect(plan.stats.crdm).toBeGreaterThan(0);
      expect(plan.parts.size + plan.merged.length).toBeLessThan(160); // instanced parts + merged batches ≈ the kit's draw calls
    }, 60_000);
  }
});
