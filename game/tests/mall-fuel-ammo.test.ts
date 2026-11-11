// Task gameplay-feedback-20261111 (lane FUEL-LOOT): does station fuel DISPLACE ammo in Mall loot? A guard of the measured answer (no):
//  - the fuel cans are ADDED lots (gen/fuelHolders.ts chooseFuelSlots in free spots + ContainerManager.addLots): every rolled lot of
//    every Mall holder — every ammo lot included — keeps its id, item, count and spot; only the additive base salvage lot may yield
//    to a can (its documented rule);
//  - the cans rarely sit where ammo can spawn: in the Mall about 1 in 10 placed cans lands in an ammo-capable holder (Subway / Office
//    ~0.45: their back rooms are where both live), gun shops get ~3 %;
//  - the fuel plan is the same per station on every level (fuel/fuel.ts stationFuelPlan), so no Mall-specific fuel surplus exists.
// Real generated Mall layouts (2 seeds) and the real holder roll with the Mall profile; 10 station plans of one network per layout.

import {describe, expect, it} from 'vitest';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {FUEL, stationFuelPlan} from '../src/fuel/fuel';
import {chooseFuelSlots, fuelHolderSlots, type FuelHolderIn} from '../src/gen/fuelHolders';
import {ContainerManager} from '../src/world/containers';
import {WorldMaterials} from '../src/world/materials';
import {holderKeyOf} from '../src/run/worldMemory';
import {Inventory} from '../src/items/inventory';
import {econCat, lootProfile} from '../src/items/lootTables';
import {compartmentTable, holderTable, isSalvageLotId} from '../src/items/loot';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const NET = 424242;
const STATIONS = Array.from({length: 10}, (_, k) => `st-${String(k + 1).padStart(2, '0')}`);

describe('Mall loot: station fuel does not displace ammo', () => {
  for (const seed of [11, 222]) it(`mall seed ${seed}: cans are additive (no rolled lot moves or vanishes) and rarely sit in ammo-capable holders`, () => {
    const l = LEVELS.mall.generate('main', {levelSeed: seed, startWeapon: 'pistol'});
    const prof = lootProfile('mall');
    let placed = 0, inAmmo = 0;
    for (const st of STATIONS) {
      const cm = new ContainerManager({}, mats, () => new Inventory());
      cm.build(l, {}, prof);
      const ammoCapable = new Set(cm.all.filter(h => {
        const rows = [...holderTable(h.kind, h.state.areaType, prof).rows, ...(compartmentTable(h.kind, h.state.areaType, prof)?.rows ?? [])];
        return rows.some(([id]) => econCat(id) === 'ammo');
      }).map(h => holderKeyOf(h)));
      const before = new Map(cm.all.map(h => [holderKeyOf(h), JSON.stringify(h.state.lots.filter(x => !isSalvageLotId(x.id)))]));
      const ammoBefore = cm.all.reduce((s, h) => s + h.state.lots.filter(x => econCat(x.itemId) === 'ammo').reduce((a, x) => a + x.count, 0), 0);
      const ins: FuelHolderIn[] = cm.all.map(h => ({key: holderKeyOf(h), kind: h.kind, index: h.index, area: h.prop.area, level: h.prop.level ?? 0, x: h.prop.x, z: h.prop.z, surfaces: h.surfaces, lots: h.state.lots}));
      const plan = stationFuelPlan(NET, st);
      const pick = chooseFuelSlots(fuelHolderSlots(l, ins, st), plan.cans);
      expect(pick.chosen.length, st).toBe(plan.cans); // (the Mall has room for every planned can)
      const byKey = new Map(cm.all.map(h => [holderKeyOf(h), h]));
      const adds = new Map<(typeof cm.all)[number], (typeof pick.chosen)[number]['lot'][]>();
      for (const s of pick.chosen) { const h = byKey.get(s.holder)!; adds.set(h, [...(adds.get(h) ?? []), s.lot]); }
      cm.addLots([...adds].map(([holder, lots]) => ({holder, lots})));
      for (const h of cm.all) {
        const now = JSON.stringify(h.state.lots.filter(x => x.itemId !== FUEL.canItem && !isSalvageLotId(x.id)));
        expect(now, `${st} ${holderKeyOf(h)}`).toBe(before.get(holderKeyOf(h)));
      }
      const ammoAfter = cm.all.reduce((s, h) => s + h.state.lots.filter(x => econCat(x.itemId) === 'ammo').reduce((a, x) => a + x.count, 0), 0);
      expect(ammoAfter).toBe(ammoBefore);
      placed += pick.chosen.length;
      inAmmo += pick.chosen.filter(s => ammoCapable.has(s.holder)).length;
    }
    expect(placed).toBeGreaterThan(50);
    // measured over 6 Mall seeds: 0.10 of the placed cans in ammo-capable holders (Subway 0.46, Office 0.43)
    expect(inAmmo / placed).toBeLessThan(0.25);
  });
});
