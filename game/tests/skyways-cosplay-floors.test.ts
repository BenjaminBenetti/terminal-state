// Task studio-cosplay-general-20261108-225231-01 (lane UPPER): the convention's cosplay crowd on BOTH public floors of its building
// (Skyways layout version 6, gen/skyways/cosplayFloors.ts). User: "Convention cosplay zombies need upper-floor presence too, not just
// bottom." Pins: the diagnosis (the venue is one storey, joined by the host's own stair to its other public floor), version 6 puts
// cosplayers on both floors, every second-floor spawn on real walkable floor of the host's public concourse at that storey's height,
// reachable on foot from the start and from the venue, fair (landings / doors / street entrances / passage / spacing), APPENDED after the
// venue run on its own fork (every other spawn, horde and prop byte-identical to version 5), deterministic, killed ones stay dead;
// versions 1-5 untouched (GAME87 pins in tests/skyways-dest-layout-version.test.ts).
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {Rng, hashString} from '../src/core/rng';
import {FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {clearAround} from '../src/gen/stationDress';
import {LEVELS} from '../src/levels/registry';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import {skywaysAddonOf, skywaysIssues} from '../src/gen/skyways/index';
import {doorPoint} from '../src/gen/skyways/addonFrame';
import {SKYWAYS_COSPLAY_FLOORS_MIN_VERSION, SKYWAYS_ENCOUNTERS_MIN_VERSION, SKYWAYS_LAYOUT_VERSION} from '../src/gen/skyways/layoutVersion';
import {COSPLAY_SPAWN_LOOK} from '../src/gen/skyways/cosplaySpawns';
import {COSPLAY_FLOOR_BUDGET, COSPLAY_FLOOR_RULES, COSPLAY_FLOOR_STATS, cosplayFloorAreas, cosplayFloorLevels, placeCosplayFloorSpawns} from '../src/gen/skyways/cosplayFloors';
import {COSPLAY_PLACEMENT, COSPLAY_ZONE_BUDGET} from '../src/ai/cosplayContext';
import {SKYWAYS_SPAWN_PROFILE, SKYWAYS_V4_SPAWN_PROFILE, sealsPassage, skywaysSpawnProfileFor, spawnContextOf} from '../src/ai/spawnTables';
import type {StationLayout} from '../src/gen/stationTypes';

const CANDIDATES = Array.from({length: 60}, (_, i) => i + 1);
const CONVENTION = CANDIDATES.filter(s => skywaysAddonOf(s) === 'convention').slice(0, 10);
const PRIZE = CANDIDATES.filter(s => skywaysAddonOf(s) !== 'convention').slice(0, 2);
const cache = new Map<string, StationLayout>();
const gen = (seed: number, layoutVersion: number): StationLayout => {
  const k = `${seed}:${layoutVersion}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion} as never)));
  return l;
};
const v6 = (seed: number) => gen(seed, 6), v5 = (seed: number) => gen(seed, 5);
const tagged = (l: StationLayout) => l.zombies.flatMap((z, i) => (z.look === COSPLAY_SPAWN_LOOK ? [i] : []));
const rectDist = (r: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

describe('Skyways cosplay floors: the version gate and the budget', () => {
  it('version 6 is current, gates the second-floor run and shares the version-5 profile; U{2..4} additive to the venue run', () => {
    expect(SKYWAYS_COSPLAY_FLOORS_MIN_VERSION).toBe(6);
    expect(SKYWAYS_LAYOUT_VERSION).toBe(SKYWAYS_COSPLAY_FLOORS_MIN_VERSION);
    expect(skywaysSpawnProfileFor(6)).toBe(SKYWAYS_SPAWN_PROFILE);
    expect(skywaysSpawnProfileFor(5)).toBe(SKYWAYS_SPAWN_PROFILE);
    expect(COSPLAY_FLOOR_BUDGET).toEqual([2, 4]);
    expect(COSPLAY_ZONE_BUDGET).toEqual([4, 6]); // the venue run is unchanged
    expect(CONVENTION.length).toBeGreaterThanOrEqual(8);
    expect(PRIZE.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Skyways cosplay floors: the convention building (diagnosis)', () => {
  it('the venue is ONE storey (the skyway floor); the host\'s own stair joins it to its street floor, its only other public floor', () => {
    for (const seed of CONVENTION) {
      const l = v6(seed), a = l.skyways!.addon, b = l.skyways!.buildings.find(q => q.id === a.building)!;
      expect(a.id).toBe('convention');
      expect(a.level, `seed ${seed}`).toBe(2);
      for (const v of a.venue ?? []) expect(l.areas[v.area].level ?? 0, `seed ${seed} ${v.role}`).toBe(a.level);
      expect(l.levels.length).toBe(3); // nothing above the venue storey
      expect(b.atrium, `seed ${seed}`).toBeUndefined(); // no opening / gallery ring over the street floor
      const floors = cosplayFloorLevels(l);
      expect(floors.map(f => f.level), `seed ${seed}`).toEqual([1]);
      for (const p of floors[0].landings) expect(p.x >= b.rect.x0 && p.x <= b.rect.x1 && p.z >= b.rect.z0 && p.z <= b.rect.z1).toBe(true);
      // the hosting areas: the host's public concourse there, never a shop, washroom, stair core, the venue or another building
      const hosts = cosplayFloorAreas(l, 1);
      expect(hosts.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const id of hosts) {
        const q = l.areas[id];
        expect(q.level).toBe(1);
        expect(q.publicSpace).toBe(true);
        expect(COSPLAY_FLOOR_RULES.kinds).toContain(q.kind);
        expect(COSPLAY_FLOOR_RULES.types).toContain(q.type);
        expect(q.ext).toBeUndefined();
      }
    }
  }, 300000);
});

describe('Skyways cosplay floors: version 6 levels', () => {
  it('cosplayers on BOTH convention floors (the per-floor distribution over the seed set)', () => {
    const rows: string[] = [];
    let venue = 0, other = 0;
    for (const seed of CONVENTION) {
      const l = v6(seed), lv = l.skyways!.addon.level, idx = tagged(l);
      const onVenue = idx.filter(i => (l.zombies[i].level ?? 0) === lv).length, onOther = idx.length - onVenue;
      expect(onVenue, `seed ${seed} venue floor`).toBeGreaterThanOrEqual(3);
      expect(onVenue).toBeLessThanOrEqual(COSPLAY_ZONE_BUDGET[1]);
      expect(onOther, `seed ${seed} street floor`).toBeGreaterThanOrEqual(COSPLAY_FLOOR_BUDGET[0]);
      expect(onOther).toBeLessThanOrEqual(COSPLAY_FLOOR_BUDGET[1]);
      venue += onVenue; other += onOther;
      rows.push(`seed ${seed}: venue storey ${lv} ${onVenue}, storey ${cosplayFloorLevels(l).map(f => f.level).join('/')} ${onOther} (${idx.filter(i => (l.zombies[i].level ?? 0) !== lv).map(i => l.areas[l.zombies[i].area].label).join('; ')})`);
    }
    rows.push(`total over ${CONVENTION.length} convention seeds: venue ${venue} (${(venue / CONVENTION.length).toFixed(2)}/level), other floor ${other} (${(other / CONVENTION.length).toFixed(2)}/level)`);
    writeFileSync('/tmp/skyways-cosplay-floors-distribution.txt', rows.join('\n') + '\n');
    expect(other / CONVENTION.length).toBeGreaterThanOrEqual(2);
  }, 300000);

  it('every second-floor spawn: walkable floor of the host\'s public concourse at that storey\'s height, reachable, fair', () => {
    for (const seed of CONVENTION) {
      const l = v6(seed), a = l.skyways!.addon, b = l.skyways!.buildings.find(q => q.id === a.building)!;
      const st = l.skyways!.start, [sx, sy] = l.levels[st.level].grid.cellOf(st.x, st.z);
      const fromStart = levelDistance(l.levels, sx, sy, st.level, l.levelLinks);
      const ga = l.levels[a.level].grid, [ex, ey] = ga.cellOf(a.entry.x, a.entry.z);
      const fromVenue = levelDistance(l.levels, ex, ey, a.level, l.levelLinks);
      const keep = l.levelLinks.flatMap(k => [{level: k.lower, ...k.bottom}, {level: k.upper, ...k.top}]);
      const own = new Set([...a.areas, ...(a.venue ?? []).map(v => v.area)]);
      const second = tagged(l).filter(i => (l.zombies[i].level ?? 0) !== a.level);
      expect(second.length).toBeGreaterThan(0);
      for (const i of second) {
        const z = l.zombies[i], lv = z.level ?? 0, g = l.levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z), c = g.idx(cx, cy);
        const hosts = new Set(cosplayFloorAreas(l, lv));
        expect(cosplayFloorLevels(l).map(f => f.level)).toContain(lv);
        // real walkable support at that storey's height (never the roof, a void, a prop top, the stage, a doorway or a stair)
        expect(z.y, `seed ${seed} #${i} height`).toBe(l.levels[lv].baseY);
        expect(g.floorOf(c)).toBe(z.y);
        expect(g.cells[c]).toBe(FLOOR);
        expect(g.walkable(cx, cy)).toBe(true);
        expect(g.rampIdx[c]).toBeLessThan(0);
        expect(clearAround(g, cx, cy, 1)).toBe(true);
        expect(g.area[c]).toBe(z.area);
        expect(hosts.has(z.area), `seed ${seed} #${i} area ${l.areas[z.area].label}`).toBe(true);
        expect(own.has(z.area)).toBe(false);
        expect(z.x >= b.rect.x0 && z.x <= b.rect.x1 && z.z >= b.rect.z0 && z.z <= b.rect.z1, `seed ${seed} #${i} inside the host`).toBe(true);
        // reachable on foot: from the start (>= the validator's 36 cells) and from the venue's entry (up / down the host's stair)
        expect(fromStart[lv][c], `seed ${seed} #${i} from the start`).toBeGreaterThanOrEqual(COSPLAY_PLACEMENT.startCells);
        expect(fromVenue[lv][c], `seed ${seed} #${i} from the venue`).toBeGreaterThanOrEqual(0);
        // fair: off every landing, door of a hosting area, boarded street entrance; never sealing a passage; spaced
        for (const k of keep) if (k.level === lv) expect(Math.hypot(k.x - z.x, k.z - z.z), `seed ${seed} #${i} landing`).toBeGreaterThanOrEqual(COSPLAY_PLACEMENT.landingKeepM!);
        for (const dr of l.doors) {
          if (!hosts.has(dr.a) && !hosts.has(dr.b)) continue;
          const p = doorPoint(dr, l.areas[hosts.has(dr.a) ? dr.a : dr.b]);
          expect(Math.hypot(p.x - z.x, p.z - z.z), `seed ${seed} #${i} door`).toBeGreaterThanOrEqual(COSPLAY_FLOOR_RULES.doorKeepM);
        }
        for (const w of l.skyways!.windows) if (w.kind === 'entrance' && w.level === lv) expect(rectDist(w, z.x, z.z) >= COSPLAY_FLOOR_RULES.doorKeepM || !('building' in w.host) || w.host.building !== b.id).toBe(true);
        for (const s of a.convention?.statues ?? []) if (s.level === lv) expect(Math.hypot(s.x - z.x, s.z - z.z)).toBeGreaterThanOrEqual(COSPLAY_FLOOR_RULES.statueKeepM);
        expect(sealsPassage(g, z.x, z.z, COSPLAY_FLOOR_RULES.passageRadiusM)).toBe(false);
        for (const o of l.zombies) if (o !== z && (o.level ?? 0) === lv) expect(Math.hypot(o.x - z.x, o.z - z.z)).toBeGreaterThanOrEqual(COSPLAY_PLACEMENT.spacingM);
      }
      expect(skywaysIssues(l, {startCells: 36}), `seed ${seed}`).toEqual([]);
    }
  }, 300000);

  it('APPENDED after the venue run: every other spawn, horde, prop and pickup is version 5\'s; the cosplay tags / families / types hold', () => {
    for (const seed of CONVENTION) {
      const a = v6(seed), b = v5(seed), P = SKYWAYS_SPAWN_PROFILE, idx = tagged(a), n5 = b.zombies.length;
      // version 5 + the second-floor run, nothing else
      expect(JSON.stringify(a.zombies.slice(0, n5)), `seed ${seed}`).toBe(JSON.stringify(b.zombies));
      expect(JSON.stringify(a.hordes ?? [])).toBe(JSON.stringify(b.hordes ?? []));
      expect(JSON.stringify(a.props)).toBe(JSON.stringify(b.props));
      expect(JSON.stringify(a.pickups)).toBe(JSON.stringify(b.pickups));
      const extra = a.zombies.length - n5;
      expect(extra, `seed ${seed}`).toBeGreaterThanOrEqual(COSPLAY_FLOOR_BUDGET[0]);
      expect(extra).toBeLessThanOrEqual(COSPLAY_FLOOR_BUDGET[1]);
      // the cosplay spawns: contiguous, LAST (the venue run, then the second-floor run)
      expect(idx).toEqual(Array.from({length: idx.length}, (_, k) => a.zombies.length - idx.length + k));
      for (let i = n5; i < a.zombies.length; i++) expect(a.zombies[i].level ?? 0).not.toBe(a.skyways!.addon.level);
      for (const i of idx) {
        const z = a.zombies[i];
        expect(spawnContextOf(a, P, i), `seed ${seed} #${i}`).toBe('cosplay');
        expect(z.archetype ?? 'zombie').toBe('zombie');
        expect(z.type).toBe('shambler');
        expect(z.horde).toBeUndefined();
      }
      // the ordinary / Siren / horde / service spawns: the same in number (and context) as version 5's
      const ctxCount = (l: StationLayout, c: string) => l.zombies.filter((_, i) => spawnContextOf(l, P, i) === c).length;
      for (const c of ['station', 'street', 'floor', 'horde', 'service']) expect(ctxCount(a, c), `seed ${seed} ${c}`).toBe(ctxCount(b, c));
      expect(a.zombies.filter(z => z.archetype === 'siren').length).toBe(b.zombies.filter(z => z.archetype === 'siren').length);
      expect(ctxCount(a, 'cosplay')).toBe(ctxCount(b, 'cosplay') + extra);
    }
  }, 300000);

  it('deterministic (revisit / streaming / Retry regenerate the same crowd); killed second-floor cosplayers stay dead', () => {
    const seed = CONVENTION[0], a = v6(seed);
    const b = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol'} as never) as StationLayout; // (current = 6)
    expect(JSON.stringify(b.zombies)).toBe(JSON.stringify(a.zombies));
    const last = a.zombies.length - 1;
    expect(a.zombies[last].look).toBe(COSPLAY_SPAWN_LOOK);
    expect(a.zombies[last].level ?? 0).not.toBe(a.skyways!.addon.level);
    const mem = createMemory({level: 'skyways', section: 'main'});
    mem.killed = [last];
    const alive = enemiesToSpawn(b.zombies.length, mem);
    expect(alive).not.toContain(last);
    expect(alive.length).toBe(b.zombies.length - 1);
  }, 300000);

  it('the prize display gets none; the pass itself draws nothing without the context / the convention', () => {
    for (const seed of PRIZE) {
      const l = v6(seed);
      expect(l.skyways!.addon.id).not.toBe('convention');
      expect(tagged(l), `seed ${seed}`).toEqual([]);
      expect(cosplayFloorLevels(l)).toEqual([]);
      const rng = new Rng(hashString('floors-test', seed)), probe = new Rng(hashString('floors-test', seed));
      expect(placeCosplayFloorSpawns(l, rng, [], SKYWAYS_SPAWN_PROFILE)).toBeNull();
      expect(rng.int(0, 1e9)).toBe(probe.int(0, 1e9));
    }
    const l = v6(CONVENTION[0]), before = l.zombies.length;
    const rng = new Rng(hashString('floors-test', 1)), probe = new Rng(hashString('floors-test', 1));
    expect(placeCosplayFloorSpawns(l, rng, [], SKYWAYS_V4_SPAWN_PROFILE)).toBeNull();
    expect(l.zombies.length).toBe(before);
    expect(rng.int(0, 1e9)).toBe(probe.int(0, 1e9));
    expect(COSPLAY_FLOOR_STATS.run).toBeNull();
  }, 300000);
});

describe('Skyways cosplay floors: versions 1-5 untouched', () => {
  it('a version-5 convention keeps its crowd on the venue storey only (the GAME87 pins hold in skyways-dest-layout-version.test.ts)', () => {
    expect(SKYWAYS_ENCOUNTERS_MIN_VERSION).toBeLessThan(SKYWAYS_COSPLAY_FLOORS_MIN_VERSION);
    for (const seed of CONVENTION.slice(0, 4)) {
      const l = v5(seed), lv = l.skyways!.addon.level, idx = tagged(l);
      expect(idx.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const i of idx) expect(l.zombies[i].level ?? 0, `seed ${seed} #${i}`).toBe(lv);
    }
  }, 300000);
});
