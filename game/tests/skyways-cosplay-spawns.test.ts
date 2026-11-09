// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the Skyways anime convention's COSPLAY ZOMBIES — generation.
// User: "the animie convention "event" should have special "cosplay zombies" spawned, which are just zombies wearing special clothing."
// Pins: version gate (1-4 untouched: no context, no spawn), only with the convention add-on (never the prize display), the venue's event
// floor only and fair (doors / entry / greeter / stage / landings / start / passage), the zone context's own zombie-only pool, appended
// LAST on its own fork (every other spawn byte-identical to a run without the context), deterministic, killed ones stay dead.
import {describe, expect, it} from 'vitest';
import {Rng, hashString} from '../src/core/rng';
import {FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {clearAround} from '../src/gen/stationDress';
import {LEVELS} from '../src/levels/registry';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import {generateSkywaysLevel, skywaysAddonOf, skywaysIssues} from '../src/gen/skyways/index';
import {doorPoint} from '../src/gen/skyways/addonFrame';
import {SKYWAYS_ENCOUNTERS_MIN_VERSION} from '../src/gen/skyways/layoutVersion';
import {COSPLAY_SPAWN_LOOK, COSPLAY_SPAWN_RULES, COSPLAY_SPAWN_STATS, cosplayVenueAreas, placeCosplaySpawns} from '../src/gen/skyways/cosplaySpawns';
import {COSPLAY_CONTEXT, COSPLAY_FAMILY_POOL, COSPLAY_PLACEMENT, COSPLAY_ZONE_BUDGET} from '../src/ai/cosplayContext';
import {CONTEXT_LOCKED_FAMILIES, ENEMY_FAMILY_IDS, SKYWAYS_SPAWN_PROFILE, SKYWAYS_V4_SPAWN_PROFILE, SPAWN_CONTEXT_IDS, familyPool, sealsPassage, skywaysSpawnProfileFor,
  spawnContextOf, validateSpawnProfile, type SpawnProfile} from '../src/ai/spawnTables';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 707, 4242, 103855126, 9001, 31337];
const CONVENTION = SEEDS.filter(s => skywaysAddonOf(s) === 'convention');
const PRIZE = SEEDS.filter(s => skywaysAddonOf(s) !== 'convention');
// (task studio-cosplay-general-20261108-225231-01, lane UPPER: these pins are the VERSION-5 venue run; version 6 appends the second-floor
// run after it — tests/skyways-cosplay-floors.test.ts)
const gen = (seed: number, layoutVersion = SKYWAYS_ENCOUNTERS_MIN_VERSION): StationLayout => LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion} as never);
const cache = new Map<number, StationLayout>();
const v5 = (seed: number) => { let l = cache.get(seed); if (!l) cache.set(seed, (l = gen(seed))); return l; };
const tagged = (l: StationLayout) => l.zombies.flatMap((z, i) => (z.look === COSPLAY_SPAWN_LOOK ? [i] : []));

describe('Skyways cosplay zombies: the zone context', () => {
  it('a zone context of its own: declared by the version-5 profile only, zombie-only pool, never a Siren / Strainer context', () => {
    expect(SPAWN_CONTEXT_IDS).toContain('cosplay');
    expect(SKYWAYS_SPAWN_PROFILE.contexts.cosplay).toBe(COSPLAY_CONTEXT);
    expect(SKYWAYS_V4_SPAWN_PROFILE.contexts.cosplay).toBeUndefined();
    for (let v = 1; v < SKYWAYS_ENCOUNTERS_MIN_VERSION; v++) expect(skywaysSpawnProfileFor(v).contexts.cosplay, `v${v}`).toBeUndefined();
    expect(skywaysSpawnProfileFor(SKYWAYS_ENCOUNTERS_MIN_VERSION).contexts.cosplay).toBe(COSPLAY_CONTEXT);
    // the pool = familyPool with every other family at 0 (written out in the leaf module), zombie only
    expect(COSPLAY_FAMILY_POOL).toEqual(familyPool({blightbelly: 0, siren: 0, ratdog: 0, strainer: 0}));
    expect(COSPLAY_FAMILY_POOL.map(r => r[0])).toEqual(ENEMY_FAMILY_IDS);
    expect(COSPLAY_FAMILY_POOL.filter(([, w]) => w > 0).map(([f]) => f)).toEqual(['zombie']);
    expect(CONTEXT_LOCKED_FAMILIES.strainer).not.toContain('cosplay');
    for (const rule of Object.values(SKYWAYS_SPAWN_PROFILE.eligibility ?? {})) expect(rule?.contexts ?? []).not.toContain('cosplay');
    expect(COSPLAY_ZONE_BUDGET).toEqual([4, 6]);
    expect(COSPLAY_CONTEXT.accept).toEqual({min: null, max: 'count'});
    expect(COSPLAY_PLACEMENT.startCells).toBeGreaterThanOrEqual(36);
    expect(validateSpawnProfile(SKYWAYS_SPAWN_PROFILE)).toEqual([]);
    expect(validateSpawnProfile(SKYWAYS_V4_SPAWN_PROFILE)).toEqual([]);
  });

  it('the seed list covers both add-ons', () => {
    expect(CONVENTION.length).toBeGreaterThanOrEqual(3);
    expect(PRIZE.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Skyways cosplay zombies: generation (layout version 5)', () => {
  it('a convention gets U{4..6} costumed ordinary zombies, appended LAST, tagged context + look, zombie family, shamblers', () => {
    for (const seed of CONVENTION) {
      const l = v5(seed), idx = tagged(l), p = SKYWAYS_SPAWN_PROFILE;
      expect(idx.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(idx.length, `seed ${seed}`).toBeLessThanOrEqual(COSPLAY_ZONE_BUDGET[1]);
      // the last spawns of the level, contiguous
      expect(idx, `seed ${seed}`).toEqual(Array.from({length: idx.length}, (_, k) => l.zombies.length - idx.length + k));
      for (const i of idx) {
        const z = l.zombies[i];
        expect(spawnContextOf(l, p, i), `seed ${seed} #${i}`).toBe('cosplay');
        expect(z.archetype ?? 'zombie', `seed ${seed} #${i}`).toBe('zombie');
        expect(z.type).toBe('shambler');
        expect(z.horde).toBeUndefined();
      }
      // nobody else carries the tag or the context
      l.zombies.forEach((z, i) => { if (!idx.includes(i)) { expect(z.look).toBeUndefined(); expect(spawnContextOf(l, p, i)).not.toBe('cosplay'); } });
    }
  });

  it('placed fairly on the venue\'s event floor: walkable, clear, reachable, off doors / entry / statues / stage / landings, never sealing a passage', () => {
    for (const seed of CONVENTION) {
      const l = v5(seed), a = l.skyways!.addon, lv = a.level, g = l.levels[lv].grid;
      const hosts = new Set(cosplayVenueAreas(l));
      expect(hosts.size, `seed ${seed}`).toBeGreaterThan(0);
      const roles = new Map((a.venue ?? []).map(v => [v.area, v.role]));
      const st = l.skyways!.start, [sx, sy] = l.levels[st.level].grid.cellOf(st.x, st.z);
      const d = levelDistance(l.levels, sx, sy, st.level, l.levelLinks)[lv];
      const doors = l.doors.filter(dr => hosts.has(dr.a) || hosts.has(dr.b)).map(dr => doorPoint(dr, l.areas[hosts.has(dr.a) ? dr.a : dr.b]));
      const keep = l.levelLinks.flatMap(k => [{level: k.lower, ...k.bottom}, {level: k.upper, ...k.top}]).filter(k => k.level === lv);
      for (const i of tagged(l)) {
        const z = l.zombies[i], [cx, cy] = g.cellOf(z.x, z.z), c = g.idx(cx, cy);
        expect(z.level ?? 0).toBe(lv);
        expect(hosts.has(z.area), `seed ${seed} #${i} area`).toBe(true);
        expect(g.area[c]).toBe(z.area);
        if (roles.size) expect(['main-hall', 'exhibitors', 'photo-lounge', 'panel']).toContain(roles.get(z.area));
        expect(g.cells[c]).toBe(FLOOR);
        expect(g.walkable(cx, cy)).toBe(true);
        expect(g.rampIdx[c]).toBeLessThan(0);
        expect(clearAround(g, cx, cy, 1)).toBe(true);
        expect(d[c], `seed ${seed} #${i} walking distance`).toBeGreaterThanOrEqual(COSPLAY_PLACEMENT.startCells);
        for (const p of doors) expect(Math.hypot(p.x - z.x, p.z - z.z), `seed ${seed} #${i} door`).toBeGreaterThanOrEqual(COSPLAY_SPAWN_RULES.doorKeepM);
        expect(Math.hypot(a.entry.x - z.x, a.entry.z - z.z)).toBeGreaterThanOrEqual(COSPLAY_SPAWN_RULES.doorKeepM);
        for (const s of a.convention?.statues ?? []) if (s.level === lv) expect(Math.hypot(s.x - z.x, s.z - z.z), `seed ${seed} #${i} statue ${s.role}`).toBeGreaterThanOrEqual(COSPLAY_SPAWN_RULES.statueKeepM);
        const sr = a.convention!.stage, m = COSPLAY_SPAWN_RULES.stageMarginM;
        expect(z.x > sr.x0 - m && z.x < sr.x1 + m && z.z > sr.z0 - m && z.z < sr.z1 + m, `seed ${seed} #${i} stage`).toBe(false);
        for (const k of keep) expect(Math.hypot(k.x - z.x, k.z - z.z)).toBeGreaterThanOrEqual(COSPLAY_PLACEMENT.landingKeepM!);
        expect(sealsPassage(g, z.x, z.z, COSPLAY_SPAWN_RULES.passageRadiusM)).toBe(false);
        for (const o of l.zombies) if (o !== z && (o.level ?? 0) === lv) expect(Math.hypot(o.x - z.x, o.z - z.z)).toBeGreaterThanOrEqual(COSPLAY_PLACEMENT.spacingM);
      }
      expect(skywaysIssues(l, {startCells: 36}), `seed ${seed}`).toEqual([]);
    }
  });

  it('the prize display gets none (and never asks for the costumes)', () => {
    for (const seed of PRIZE) {
      const l = v5(seed);
      expect(l.skyways!.addon.id).not.toBe('convention');
      expect(tagged(l), `seed ${seed}`).toEqual([]);
      expect(cosplayVenueAreas(l)).toEqual([]);
    }
  });

  it('APPENDED on its own fork: every other spawn is byte-identical to a run without the cosplay context', () => {
    const without: SpawnProfile = {...SKYWAYS_SPAWN_PROFILE, contexts: Object.fromEntries(Object.entries(SKYWAYS_SPAWN_PROFILE.contexts).filter(([k]) => k !== 'cosplay'))};
    for (const seed of [...CONVENTION.slice(0, 3), ...PRIZE.slice(0, 1)]) {
      const ctx = {levelSeed: seed, startWeapon: 'pistol' as const, layoutVersion: SKYWAYS_ENCOUNTERS_MIN_VERSION};
      const a = generateSkywaysLevel(ctx), b = generateSkywaysLevel(ctx, {spawns: without});
      const n = tagged(a).length;
      expect(JSON.stringify(a.zombies.slice(0, a.zombies.length - n)), `seed ${seed}`).toBe(JSON.stringify(b.zombies));
      expect(JSON.stringify(a.props)).toBe(JSON.stringify(b.props));
      expect(JSON.stringify(a.pickups)).toBe(JSON.stringify(b.pickups));
    }
  });

  it('deterministic (revisit / streaming / Retry regenerate the same cosplay zombies); killed ones stay dead', () => {
    const seed = CONVENTION[0], a = v5(seed), b = gen(seed), idx = tagged(a);
    expect(JSON.stringify(b.zombies)).toBe(JSON.stringify(a.zombies));
    const mem = createMemory({level: 'skyways', section: 'main'});
    mem.killed = [idx[0], idx[idx.length - 1]];
    const alive = enemiesToSpawn(b.zombies.length, mem);
    expect(alive).not.toContain(idx[0]);
    expect(alive).not.toContain(idx[idx.length - 1]);
    expect(alive.length).toBe(b.zombies.length - 2);
    expect(b.zombies[idx[0]].look).toBe(COSPLAY_SPAWN_LOOK);
  });

  it('the pass itself: no context = no draw, no spawn; a run reports its candidates and places within the budget', () => {
    const l = v5(CONVENTION[0]);
    const rng = new Rng(hashString('cosplay-test', 1)), probe = new Rng(hashString('cosplay-test', 1));
    const before = l.zombies.length;
    expect(placeCosplaySpawns(l, rng, [], SKYWAYS_V4_SPAWN_PROFILE)).toBeNull();
    expect(l.zombies.length).toBe(before);
    expect(rng.int(0, 1e9)).toBe(probe.int(0, 1e9));
    expect(COSPLAY_SPAWN_STATS.run).toBeNull();
  });
});

describe('Skyways cosplay zombies: versions 1-4 untouched', () => {
  it('a version-4 convention layout has no cosplay spawn, tag or context (the GAME84 pins hold in skyways-dest-layout-version.test.ts)', () => {
    for (const seed of CONVENTION.slice(0, 3)) {
      const l = gen(seed, 4);
      expect(l.skyways!.addon.id).toBe('convention');
      expect(tagged(l), `seed ${seed}`).toEqual([]);
      l.zombies.forEach((_, i) => expect(spawnContextOf(l, SKYWAYS_V4_SPAWN_PROFILE, i)).not.toBe('cosplay'));
    }
  });
});
