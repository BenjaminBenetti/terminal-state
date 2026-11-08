// Task studio-skywalk-encounters-20261108-074144-01 (Skywalk user feedback): layout version 5's ENCOUNTERS —
//  1. "It feels like the siren cannot spawn on this level, It should spawn the same amount as the mall": she could not (versions 1-4:
//     siren weight 0, no eligibility); version 5 rolls the MALL'S rules (draw 0.8, retail placement with shops x 6, enclosed-room gates,
//     cap 4, 24 m spacing) on the street / skyway storeys — census in ai/spawnTables.ts SKYWAYS_SIREN_WEIGHT (48 levels: 1.79 / level,
//     the Mall 1.96);
//  2. "I want to have at least 1 random zombie hoard spawn on this map (just like the mall hoard)": the Mall's horde pool and placement
//     on a Skyways patrol graph (gen/skyways/patrol.ts), >= 1 group on every new level, never on the station storey / a stair / near
//     the start; stable group ids and members (layout.zombies indices: the normal kill memory keeps the dead dead).
// Versions 1-4 are untouched (their fingerprints: tests/skyways-dest-layout-version.test.ts).
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {
  MALL_HORDE, MALL_RING_PLACEMENT, MALL_SIREN_ELIGIBILITY, MALL_SIREN_SPACING, MALL_SIREN_WEIGHT, SKYWAYS_HORDE, SKYWAYS_SIREN_ELIGIBILITY,
  SKYWAYS_SPAWN_PROFILE, SKYWAYS_V4_SPAWN_PROFILE, SPAWN_PROFILES, eligibleFamily, skywaysSpawnProfileFor, spawnContextOf, validateSpawnProfile,
} from '../src/ai/spawnTables';
import {SKYWAYS_ENCOUNTERS_MIN_VERSION, SKYWAYS_LAYOUT_VERSION} from '../src/gen/skyways/layoutVersion';
import {SKYWAYS_PATROL_STOREYS} from '../src/gen/skyways/patrol';
import {levelDistance} from '../src/gen/levelGen';
import {CELL} from '../src/gen/grid';

const cache = new Map<string, StationLayout>();
const gen = (seed: number, layoutVersion?: number): StationLayout => {
  const k = `${seed}:${layoutVersion ?? 'cur'}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion ? {layoutVersion} : {})} as never)));
  return l;
};
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('Skyways version 5 rolls the Mall\'s Siren and horde rules; versions 1-4 keep the frozen profile', () => {
  it('the profiles: version 5 = the Mall\'s Siren draw / room gates / cap / spacing / retail placement and horde pool; 1-4 frozen (none)', () => {
    expect(SKYWAYS_LAYOUT_VERSION).toBe(SKYWAYS_ENCOUNTERS_MIN_VERSION);
    expect(SPAWN_PROFILES.skyways).toBe(SKYWAYS_SPAWN_PROFILE);
    for (const v of [1, 2, 3, 4]) expect(skywaysSpawnProfileFor(v), `v${v}`).toBe(SKYWAYS_V4_SPAWN_PROFILE);
    expect(skywaysSpawnProfileFor(5)).toBe(SKYWAYS_SPAWN_PROFILE);
    expect(validateSpawnProfile(SKYWAYS_SPAWN_PROFILE)).toEqual([]);
    // versions 1-4: no Siren, no horde (as shipped)
    expect(SKYWAYS_V4_SPAWN_PROFILE.families.find(([f]) => f === 'siren')?.[1] ?? 0).toBe(0);
    expect(SKYWAYS_V4_SPAWN_PROFILE.eligibility).toBeUndefined();
    expect(SKYWAYS_V4_SPAWN_PROFILE.horde).toBeUndefined();
    // version 5: the Mall's numbers, literally
    expect(SKYWAYS_SPAWN_PROFILE.families.find(([f]) => f === 'siren')?.[1]).toBe(MALL_SIREN_WEIGHT);
    const {contexts: _a, why: _w1, ...gates} = SKYWAYS_SIREN_ELIGIBILITY;
    const {contexts: _b, why: _w2, ...mallGates} = MALL_SIREN_ELIGIBILITY;
    expect(gates).toEqual(mallGates);
    expect(SKYWAYS_SIREN_ELIGIBILITY.contexts).toEqual(['street', 'floor']);
    expect(SKYWAYS_SPAWN_PROFILE.spacing?.siren?.spacingM).toBe(MALL_SIREN_SPACING.spacingM);
    expect(SKYWAYS_SPAWN_PROFILE.contexts.street!.placement).toBe(MALL_RING_PLACEMENT);
    expect(SKYWAYS_SPAWN_PROFILE.contexts.floor!.placement).toBe(MALL_RING_PLACEMENT);
    // the counts and the station storey are unchanged (no ambient enemy is taken away to fund anything)
    for (const c of ['station', 'street', 'floor', 'service'] as const) expect(SKYWAYS_SPAWN_PROFILE.contexts[c]!.count, c).toEqual(SKYWAYS_V4_SPAWN_PROFILE.contexts[c]!.count);
    expect(SKYWAYS_SPAWN_PROFILE.contexts.station).toBe(SKYWAYS_V4_SPAWN_PROFILE.contexts.station);
    // the horde = the Mall's pool / sizes / budget / spacing / patrol pace, on the street / skyway storeys
    const {placement: hp, ...rest} = SKYWAYS_HORDE, {placement: mp, ...mrest} = MALL_HORDE;
    expect(rest).toEqual(mrest);
    expect({...hp, storeys: 'x'}).toEqual({...mp, storeys: 'x'});
    expect(hp.storeys).toEqual([...SKYWAYS_PATROL_STOREYS]);
  });

  it('versions 1-4 place no Siren and no horde (the frozen generators and version 4)', () => {
    for (const v of [1, 3, 4]) {
      const l = gen(4, v);
      expect(l.zombies.some(z => z.archetype === 'siren'), `v${v}`).toBe(false);
      expect(l.hordes ?? [], `v${v}`).toEqual([]);
      expect(l.skyways?.patrol, `v${v}`).toBeUndefined();
    }
  }, 120000);
});

describe('version 5 levels: Sirens in enclosed street / skyway rooms only; at least one Mall-style horde', () => {
  it('Sirens: only street / skyway enclosed rooms passing the gates, <= 4 per level, 24 m apart; some levels have them', () => {
    let total = 0;
    for (const seed of SEEDS) {
      const l = gen(seed), P = SKYWAYS_SPAWN_PROFILE;
      const sirens = l.zombies.map((z, i) => ({z, i})).filter(e => e.z.archetype === 'siren');
      total += sirens.length;
      expect(sirens.length, `seed ${seed}`).toBeLessThanOrEqual(4);
      for (const {z, i} of sirens) {
        expect(['street', 'floor'], `seed ${seed} #${i}`).toContain(spawnContextOf(l, P, i));
        expect(l.areas[z.area]?.kind, `seed ${seed} #${i}`).toBe('room');
        expect(eligibleFamily(P, 'siren', l, z, i, new Map()), `seed ${seed} #${i} gates`).toBe('siren');
        expect((z.level ?? 0) > 0).toBe(true); // never the station storey (the train)
      }
      for (let a = 0; a < sirens.length; a++) for (let b = a + 1; b < sirens.length; b++) {
        const p = sirens[a].z, q = sirens[b].z;
        expect(Math.hypot(p.x - q.x, (p.y ?? 0) - (q.y ?? 0), p.z - q.z), `seed ${seed}`).toBeGreaterThanOrEqual(24 - 1e-6);
      }
    }
    expect(total / SEEDS.length).toBeGreaterThan(0.8); // (the 48-level census: 1.79 per level)
  }, 120000);

  it('hordes: >= 1 group on every level, the Mall\'s pool (zombies only), street / skyway storeys, far from the start, off stairs', () => {
    for (const seed of SEEDS) {
      const l = gen(seed), H = l.hordes ?? [];
      expect(H.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(H.length).toBeLessThanOrEqual(SKYWAYS_HORDE.groups[1]);
      const patrol = l.skyways!.patrol!;
      expect(patrol.length).toBeGreaterThan(40);
      expect(patrol.every(n => SKYWAYS_PATROL_STOREYS.includes(n.level) && n.edges.length > 0)).toBe(true);
      expect(patrol.some(n => n.edges.some(e => e.via === 'stair'))).toBe(true); // the storeys are joined
      const [sx, sy] = l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const dist = levelDistance(l.levels, sx, sy, 0, l.levelLinks);
      const ids = new Set<number>();
      let members = 0;
      H.forEach((h, k) => {
        expect(h.id).toBe(k); // stable group ids 0..n-1
        expect(SKYWAYS_PATROL_STOREYS).toContain(h.level);
        expect(h.members.length).toBeGreaterThanOrEqual(SKYWAYS_HORDE.size[0]);
        expect(h.members.length).toBeLessThanOrEqual(SKYWAYS_HORDE.size[1]);
        const node = patrol[h.startNode];
        const g = l.levels[h.level].grid, [cx, cy] = g.cellOf(node.x, node.z);
        expect(dist[h.level][g.idx(cx, cy)] * CELL, `seed ${seed} group ${k} walking from the start`).toBeGreaterThanOrEqual(SKYWAYS_HORDE.placement.startM - 1e-6);
        for (const m of h.members) {
          expect(ids.has(m)).toBe(false);
          ids.add(m);
          const z = l.zombies[m];
          expect(z.horde).toBe(k);
          expect(z.archetype).toBe('zombie');
          expect(spawnContextOf(l, SKYWAYS_SPAWN_PROFILE, m)).toBe('horde');
          expect(z.level ?? 0).toBe(h.level);
          const [mx, my] = g.cellOf(z.x, z.z);
          expect(g.walkable(mx, my)).toBe(true);
          expect(g.rampIdx[g.idx(mx, my)], `seed ${seed} member ${m} on a stair`).toBeLessThan(0);
          members++;
        }
      });
      expect(members).toBeLessThanOrEqual(SKYWAYS_HORDE.budget.total);
    }
  }, 120000);

  it('the ambient enemies keep their counts: hordes are ADDITIVE (appended after every ambient spawn)', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const l = gen(seed), P = SKYWAYS_SPAWN_PROFILE;
      const ctx = l.zombies.map((_z, i) => spawnContextOf(l, P, i));
      const first = ctx.indexOf('horde');
      expect(first).toBeGreaterThan(0);
      // every horde member follows every ambient (station / street / floor) spawn
      expect(ctx.slice(first).every(c => c === 'horde' || c === 'service' || c === undefined || !['station', 'street', 'floor'].includes(c))).toBe(true);
      for (const c of ['station', 'street', 'floor'] as const) {
        const n = ctx.filter(x => x === c).length, [lo, hi] = P.contexts[c]!.count;
        expect(n, `seed ${seed} ${c}`).toBeGreaterThanOrEqual(lo);
        expect(n, `seed ${seed} ${c}`).toBeLessThanOrEqual(hi);
      }
    }
  }, 120000);

  it('deterministic: the same level seed regenerates the same Sirens, groups and members (the kill memory stays valid)', () => {
    const a = gen(3);
    const b = LEVELS.skyways.generate('main', {levelSeed: 3, startWeapon: 'pistol'} as never);
    expect(b.zombies).toEqual(a.zombies);
    expect(b.hordes).toEqual(a.hordes);
    expect(b.skyways!.patrol).toEqual(a.skyways!.patrol);
  }, 120000);
});
