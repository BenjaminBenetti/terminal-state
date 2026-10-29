// Iteration 16 (lane GEAR) / seamless (GEN): level-wide gear rarity (rollLevelGear) and deterministic, plausible placement
// (placeGear) — the office is ONE section now ('main', one layout of 9 storeys), so its one roll lands in the one layout.
import {describe, expect, it} from 'vitest';
import {GEAR_CAP_PER_LEVEL, GEAR_MIN_SPAWN_M, GEAR_WEIGHTS, gearAreaWeight, gearCountFor, placeGear, placeSectionGear, rollLevelGear} from '../src/gen/gearLoot';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {Rng, hashString} from '../src/core/rng';
import {GEAR_ITEMS} from '../src/items/gear';
import {levelsOf} from '../src/gen/levels';

/** The office level's sections (levels/registry.ts LEVELS.office.sections()): ONE. */
const OFFICE_SECTIONS = ['main'];
/** Iteration-16 style multi-section deal (still supported by rollLevelGear for any section list). */
const MANY = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

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
      if (level === 'office') expect(st.perSection.main).toBe(st.total); // the one section holds the whole tower's roll
    }
  });

  it('the whole office tower is ONE level: the count does not grow with the number of sections', () => {
    const one = stats('office', OFFICE_SECTIONS, 6000), eight = stats('office', MANY, 6000);
    expect(Math.abs(one.mean - eight.mean)).toBeLessThan(0.06);
    for (const s of MANY) expect(eight.perSection[s]).toBeGreaterThan(0.08 * eight.total);
  });

  it('is deterministic and level-specific', () => {
    const a = rollLevelGear(1234, 'office', MANY), b = rollLevelGear(1234, 'office', MANY);
    expect(a).toEqual(b);
    let differs = 0;
    for (let s = 0; s < 200; s++) if (JSON.stringify(rollLevelGear(s, 'office', ['main'])['main']) !== JSON.stringify(rollLevelGear(s, 'subway', ['main'])['main'])) differs++;
    expect(differs).toBeGreaterThan(50);
    for (const list of Object.values(a)) for (const g of list) expect(GEAR_ITEMS[g.itemId]).toBeTruthy();
  });
});

describe('gear spots by room (gearAreaWeight)', () => {
  const area = (kind: string, type: string, purpose?: string, extra: Record<string, unknown> = {}) =>
    ({id: 1, x: 0, y: 0, w: 8, h: 8, kind, type, label: type, ceil: 3, parent: 0, depth: 1, publicSpace: false, lighting: 'dim', ...(purpose ? {purpose} : {}), ...extra}) as never;
  it('office tower: storage / back rooms first, open plan and meeting rooms rarely, never corridors / cab / stairwell', () => {
    const w = (k: string, t: string, p?: string, e?: Record<string, unknown>) => gearAreaWeight(area(k, t, p, e));
    expect(w('room', 'office-room', 'office-storage')).toBe(3);
    expect(w('room', 'office-room', 'office-storage')).toBeGreaterThan(w('room', 'office-room', 'office-exec'));
    expect(w('room', 'office-room', 'office-exec')).toBeGreaterThan(w('room', 'office-open', 'office-open'));
    expect(w('room', 'office-open', 'office-open')).toBeGreaterThan(w('room', 'office-room', 'office-meeting'));
    expect(w('room', 'office-room', 'office-meeting')).toBeGreaterThan(w('room', 'office-lobby', undefined, {publicSpace: true}));
    expect(w('passage', 'office-corridor', 'office-corridor')).toBe(0);
    expect(w('room', 'office-elevator', 'office-elevator')).toBe(0);
    expect(w('room', 'office-stair', 'office-stair')).toBe(0);
    expect(w('closet', 'janitor-closet', 'janitor-closet')).toBeGreaterThan(0);
  });
  it('subway: back-of-house rooms yes; platforms, passages, concourses, stair cores no', () => {
    expect(gearAreaWeight(area('room', 'storage', 'security-office'))).toBe(3);
    expect(gearAreaWeight(area('platform', 'platform'))).toBe(0);
    expect(gearAreaWeight(area('passage', 'passage'))).toBe(0);
    expect(gearAreaWeight(area('concourse', 'fare-hall'))).toBe(0);
    expect(gearAreaWeight(area('room', 'stair-core'))).toBe(0);
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

  it('office level: placed across the storeys of the ONE layout, reachable on foot, off the shaft / landing strip, 3D-far from the start', () => {
    for (const seed of [11, 4242]) {
      const a = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'});
      const o = a.office!, e = o.elevator;
      const n0 = a.pickups.length;
      const placed = placeSectionGear(a, items);
      expect(placed.length).toBe(items.length);
      expect(a.pickups.length).toBe(n0 + items.length);
      const b = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'});
      expect(placeSectionGear(b, items)).toEqual(placed);
      const L = levelsOf(a);
      const reach = L.reachable(0, ...a.grid.cellOf(o.start.x, o.start.z), {drops: true});
      for (const p of placed) {
        const area = a.areas[p.area], lv = p.level ?? 0, g = L.grid(lv);
        expect(gearAreaWeight(area), `${area.type}/${area.purpose ?? '-'}`).toBeGreaterThan(0);
        expect(area.level ?? 0).toBe(lv);
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(g.walkable(cx, cy)).toBe(true);
        expect(g.rampIdx[g.idx(cx, cy)]).toBeLessThan(0);
        expect(Math.abs(p.y - g.floorAt(p.x, p.z))).toBeLessThan(0.05);
        expect(reach[L.node(lv, g.idx(cx, cy))]).toBeGreaterThanOrEqual(0);
        // never in / at the shaft or on the elevator landing strip of any storey; never in the stairwell
        const inShaftZone = p.x > e.shaft.x0 - 0.6 && p.x < e.shaft.x1 + 0.6 && p.z > e.shaft.z0 - 2.2 && p.z < e.shaft.z1 + 0.6;
        expect(lv >= 1 && inShaftZone).toBe(false);
        const w = o.stairs.well;
        expect(lv >= 1 && p.x > w.x0 && p.x < w.x1 && p.z > w.z0 && p.z < w.z1).toBe(false);
        expect(Math.hypot(p.x - o.start.x, p.z - o.start.z, p.y - 0)).toBeGreaterThanOrEqual(GEAR_MIN_SPAWN_M);
      }
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
