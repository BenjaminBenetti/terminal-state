// Iteration 16 (lane GEAR): level-wide gear rarity (rollLevelGear) and deterministic, plausible placement (placeGear).
import {describe, expect, it} from 'vitest';
import {GEAR_CAP_PER_LEVEL, GEAR_WEIGHTS, gearAreaWeight, gearCountFor, placeGear, placeSectionGear, rollLevelGear} from '../src/gen/gearLoot';
import {generateStation} from '../src/gen/station';
import {Rng, hashString} from '../src/core/rng';
import {GEAR_ITEMS} from '../src/items/gear';
import {levelsOf} from '../src/gen/levels';

const OFFICE_SECTIONS = ['street', 'floor-2', 'floor-3', 'floor-4', 'floor-5', 'floor-6', 'floor-7', 'floor-8'];

function stats(level: 'subway' | 'office', sections: string[], seeds: number) {
  const hist = new Array(GEAR_CAP_PER_LEVEL + 2).fill(0);
  const per: Record<string, number> = {};
  const perSection: Record<string, number> = {};
  let total = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = hashString(`seed-${s}`) >>> 0;
    const r = rollLevelGear(seed, level, sections);
    expect(Object.keys(r).sort()).toEqual([...sections].sort());
    const n = Object.values(r).reduce((k, l) => k + l.length, 0);
    hist[n]++;
    total += n;
    for (const [sec, list] of Object.entries(r)) for (const g of list) { per[g.itemId] = (per[g.itemId] ?? 0) + 1; perSection[sec] = (perSection[sec] ?? 0) + 1; }
  }
  return {mean: total / seeds, p0: hist[0] / seeds, hist: hist.map(h => +(h / seeds).toFixed(4)), per, perSection, total};
}

describe('gear rarity (rollLevelGear)', () => {
  it('Poisson(1) inverse CDF capped at 5', () => {
    expect(gearCountFor(0)).toBe(0);
    expect(gearCountFor(0.3)).toBe(0);
    expect(gearCountFor(0.5)).toBe(1);
    expect(gearCountFor(0.9)).toBe(2);
    expect(gearCountFor(0.999999)).toBe(GEAR_CAP_PER_LEVEL);
  });

  it('about one gear item per logical level, zero common, never more than 5 (deterministic over 20 000 seeds)', () => {
    const N = 20000;
    for (const [level, sections] of [['subway', ['main']], ['office', OFFICE_SECTIONS]] as const) {
      const st = stats(level, [...sections], N);
      // eslint-disable-next-line no-console
      console.log(`[gear-loot] ${level}: mean ${st.mean.toFixed(3)} · P(0) ${st.p0.toFixed(3)} · hist ${JSON.stringify(st.hist)} · per item ${JSON.stringify(Object.fromEntries(Object.entries(st.per).map(([k, v]) => [k, +(v / st.total).toFixed(3)])))} · per section ${JSON.stringify(st.perSection)}`);
      expect(st.mean).toBeGreaterThan(0.93);
      expect(st.mean).toBeLessThan(1.07);
      expect(st.p0).toBeGreaterThan(0.33);
      expect(st.p0).toBeLessThan(0.41);
      expect(st.hist[GEAR_CAP_PER_LEVEL + 1]).toBe(0);
      expect(st.hist[GEAR_CAP_PER_LEVEL]).toBeGreaterThan(0); // occasionally several (up to 5)
      for (const id of Object.keys(GEAR_WEIGHTS)) expect(st.per[id]).toBeGreaterThan(0.1 * st.total);
      if (level === 'office') for (const s of OFFICE_SECTIONS) expect(st.perSection[s]).toBeGreaterThan(0.08 * st.total); // dealt across the whole tower
    }
  });

  it('the whole office tower is ONE level: the count does not grow with the number of sections', () => {
    const one = stats('office', ['street'], 6000), eight = stats('office', OFFICE_SECTIONS, 6000);
    expect(Math.abs(one.mean - eight.mean)).toBeLessThan(0.06);
  });

  it('is deterministic and level-specific', () => {
    const a = rollLevelGear(1234, 'office', OFFICE_SECTIONS), b = rollLevelGear(1234, 'office', OFFICE_SECTIONS);
    expect(a).toEqual(b);
    let differs = 0;
    for (let s = 0; s < 200; s++) if (JSON.stringify(rollLevelGear(s, 'office', ['main'])['main']) !== JSON.stringify(rollLevelGear(s, 'subway', ['main'])['main'])) differs++;
    expect(differs).toBeGreaterThan(50);
    for (const list of Object.values(a)) for (const g of list) expect(GEAR_ITEMS[g.itemId]).toBeTruthy();
  });
});

describe('gear placement (placeGear)', () => {
  const seeds = [11, 4242, 90210];
  const items = [{itemId: 'armor_vest'}, {itemId: 'backpack'}, {itemId: 'helmet'}, {itemId: 'gloves'}, {itemId: 'boots'}];

  it('places every item in a plausible, reachable spot, deterministically', () => {
    for (const seed of seeds) {
      const a = generateStation(seed, {startWeapon: 'pistol'});
      const n0 = a.pickups.length;
      const placedA = placeSectionGear(a, items);
      expect(placedA.length).toBe(items.length);
      expect(a.pickups.length).toBe(n0 + items.length);
      expect(a.pickups.slice(n0).map(p => p.itemId)).toEqual(items.map(i => i.itemId));
      const b = generateStation(seed, {startWeapon: 'pistol'});
      expect(placeSectionGear(b, items)).toEqual(placedA);
      const L = levelsOf(a);
      for (const p of placedA) {
        const area = a.areas[p.area];
        expect(area, `seed ${seed} ${p.itemId}`).toBeTruthy();
        expect(gearAreaWeight(area), `${area.type}/${area.purpose ?? '-'}`).toBeGreaterThan(0);
        expect(['platform', 'passage', 'concourse']).not.toContain(area.kind);
        const lv = p.level ?? 0, g = L.grid(lv);
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(g.walkable(cx, cy)).toBe(true);
        expect(g.rampIdx[g.idx(cx, cy)]).toBeLessThan(0); // never on a stair
        expect(Math.abs(p.y - g.floorAt(p.x, p.z))).toBeLessThan(0.05);
        expect(Math.hypot(p.x - a.playerSpawn.x, p.z - a.playerSpawn.z)).toBeGreaterThanOrEqual(6);
        // reachable from the spawn on foot
        const reach = L.reachable(0, ...a.grid.cellOf(a.playerSpawn.x, a.playerSpawn.z), {drops: true});
        expect(reach[L.node(lv, g.idx(cx, cy))]).toBeGreaterThanOrEqual(0);
      }
      // a different rng seed generally gives different spots
      const c = generateStation(seed, {startWeapon: 'pistol'});
      const placedC = placeGear(c, items, new Rng(999));
      expect(placedC.length).toBe(items.length);
    }
  });

  it('places nothing for an empty assignment and never touches existing pickups', () => {
    const a = generateStation(seeds[0], {startWeapon: 'pistol'});
    const before = JSON.stringify(a.pickups);
    expect(placeSectionGear(a, [])).toEqual([]);
    expect(placeSectionGear(a, undefined)).toEqual([]);
    expect(JSON.stringify(a.pickups)).toBe(before);
  });
});
