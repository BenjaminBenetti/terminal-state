// Task studio-alpha-track2-round2-20261031-01 (R6): the service annexes' own ambient family pool. User (round 2): "the rat-dog spawn
// rate should be boosted to 20% in this area." The CONFIGURED share is a per-spawn selection probability (the existing single
// (seed, index) roll on SERVICE_FAMILY_POOL); the census below reports the selected / placed outcomes of a bounded sample separately
// and never asserts a per-annex quota.
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {assignEnemyArchetypes, enemyRoll, pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {
  DEFAULT_FAMILY_SHARES, ENEMY_POOL, SERVICE_CONTEXT, SERVICE_FAMILY_POOL, SERVICE_FAMILY_SHARES, SERVICE_ZONE_BUDGET, SPAWN_PROFILES,
  spawnContextOf, validateSpawnProfile, type SpawnProfile,
} from '../src/ai/spawnTables';
import {isExtensionArea} from '../src/gen/trackExt/types';
import {freshLayout} from './helpers/annexRoute';
import type {StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';
import {FRESH} from './helpers/btsArea';

const share = (pool: typeof ENEMY_POOL, f: string) => pool.find(r => r[0] === f)![1];
/** The same profile without the service context's own pool (the pre-R6 behaviour): the comparison baseline for core isolation. */
const withoutServicePool = (p: SpawnProfile): SpawnProfile => {
  const {families: _f, ...service} = p.contexts.service!;
  return {...p, contexts: {...p.contexts, service}};
};
/** Bounded sample: two Subway runs (tunnel; tunnel + hatch), an Office and a Mall annex; Subway seed 1 is the no-annex control. */
// (2026-11-01, lane AREA: the area exists only where the level's one roll succeeds; the old playtest seeds roll it absent — FRESH,
// tests/helpers/btsArea.ts, holds the first seeds at / after them rolling PRESENT in the same role.)
const SAMPLE: readonly [LevelId, number][] = [['subway', FRESH.subwayTunnel], ['subway', FRESH.subwayHatch], ['office', FRESH.office], ['mall', FRESH.mall], ['subway', 1]];
const layouts = new Map<string, StationLayout>();
const fresh = (l: LevelId, s: number) => layouts.get(`${l}:${s}`) ?? (layouts.set(`${l}:${s}`, freshLayout(l, s)), layouts.get(`${l}:${s}`)!);

describe('R6: service-only family pool', () => {
  // round 4 (task studio-alpha-beyond-station-round4-20261101-01, lane FAMILY): + the Strainer 0.08, absorbed by the zombies 0.75 -> 0.67
  it('configured: rat/dog 0.20, Blightbelly 0.05 (unchanged), Siren 0, Strainer 0.08, zombies 0.67 — in every level\'s service context only', () => {
    expect(share(SERVICE_FAMILY_POOL, 'ratdog')).toBe(0.2);
    expect(share(SERVICE_FAMILY_POOL, 'blightbelly')).toBe(DEFAULT_FAMILY_SHARES.blightbelly);
    expect(share(SERVICE_FAMILY_POOL, 'siren')).toBe(0);
    expect(share(SERVICE_FAMILY_POOL, 'strainer')).toBe(0.08);
    expect(share(SERVICE_FAMILY_POOL, 'zombie')).toBe(0.67);
    expect(SERVICE_FAMILY_SHARES).toEqual({ratdog: 0.2, blightbelly: 0.05, siren: 0, strainer: 0.08});
    expect(SERVICE_CONTEXT.count).toEqual(SERVICE_ZONE_BUDGET);
    expect(SERVICE_ZONE_BUDGET).toEqual([5, 6]);
    for (const [id, p] of Object.entries(SPAWN_PROFILES)) {
      expect(validateSpawnProfile(p), id).toEqual([]);
      expect(p.contexts.service?.families, `${id} service`).toBe(SERVICE_FAMILY_POOL);
      // task reactor-build-20261101: the ONE deliberate exception — the Reactor grades its families by DEPTH with its own pools on its
      // walkway tiers / core floor (REACTOR_SPAWN_PROFILE: 'floor' / 'ring' / 'pit'; docs/enemy-spawns.md "The Reactor"); never a
      // Strainer there, the Siren only where its eligibility rule lists the context. Every other level / context: the level pool.
      for (const [c, rule] of Object.entries(p.contexts)) {
        if (c === 'service') continue;
        if (id === 'reactor' && ['floor', 'ring', 'pit'].includes(c)) {
          expect(rule?.families, `${id} ${c}`).toBeDefined();
          expect(share(rule!.families!, 'strainer'), `${id} ${c}: no Strainer`).toBe(0);
          if (share(rule!.families!, 'siren') > 0) expect(p.eligibility?.siren?.contexts, `${id} ${c}: Siren rule`).toContain(c);
          continue;
        }
        expect(rule?.families, `${id} ${c}`).toBeUndefined();
      }
      // the level pools themselves are untouched: never the service pool
      expect(p.families, id).not.toBe(SERVICE_FAMILY_POOL);
      expect(share(p.families, 'ratdog'), id).toBeLessThanOrEqual(0.05);
      expect(share(p.families, 'strainer'), `${id}: no Strainer in a level pool`).toBe(0);
    }
    expect(SPAWN_PROFILES.subway.families).toBe(ENEMY_POOL);
    expect(share(ENEMY_POOL, 'ratdog')).toBe(0.05);
    // a context pool is validated like the level pool (every family once; the Siren needs an eligibility rule naming the context)
    const bad = {...SPAWN_PROFILES.subway, contexts: {...SPAWN_PROFILES.subway.contexts, service: {...SERVICE_CONTEXT, families: [['zombie', 1], ['siren', 0.5]] as never}}};
    expect(validateSpawnProfile(bad).join('\n')).toMatch(/service\.families.*(missing|eligibility)/);
  });

  it('the roll: 20,000 (seed, index) draws on the service pool select rat/dogs at ~20 % (selection share, not a placement quota)', () => {
    let rat = 0, bb = 0, siren = 0, strainer = 0;
    for (let i = 0; i < 20000; i++) {
      const f = pickEnemyArchetype(7919 + (i >> 6), i & 63, SERVICE_FAMILY_POOL);
      if (f === 'ratdog') rat++;
      else if (f === 'blightbelly') bb++;
      else if (f === 'siren') siren++;
      else if (f === 'strainer') strainer++;
    }
    expect(rat / 20000).toBeGreaterThan(0.19);
    expect(rat / 20000).toBeLessThan(0.21);
    expect(bb / 20000).toBeGreaterThan(0.044);
    expect(bb / 20000).toBeLessThan(0.056);
    expect(siren).toBe(0);
    // round 4 (lane FAMILY): the Strainer's configured 0.08 selection share
    expect(strainer / 20000).toBeGreaterThan(0.072);
    expect(strainer / 20000).toBeLessThan(0.088);
    expect(enemyRoll(1, 2)).toBe(enemyRoll(1, 2));
  });

  it('isolation on real fresh New Game layouts: core and horde draws bit-identical, service spawns on the service pool; census', () => {
    const lines: string[] = [];
    let svc = 0, svcRat = 0, svcBb = 0, svcStrainer = 0, coreN = 0, coreRat = 0;
    for (const [level, seed] of SAMPLE) {
      const L = fresh(level, seed), P = SPAWN_PROFILES[level];
      const generated = L.zombies.map(z => z.archetype);
      const ctx = L.zombies.map((_, i) => spawnContextOf(L, P, i));
      // pre-R6 assignment (no service pool) vs the shipped one, on the same layout and tags
      assignEnemyArchetypes(L, withoutServicePool(P));
      const before = L.zombies.map(z => z.archetype);
      assignEnemyArchetypes(L, P);
      const after = L.zombies.map(z => z.archetype);
      L.zombies.forEach((z, i) => {
        if (ctx[i] === 'service') {
          expect(isExtensionArea(L.areas[z.area]), `${level} ${seed} #${i} service spawn in an annex`).toBe(true);
          expect(after[i]).not.toBe('siren');
          // the generated layout already carries the service draw (the Mall's Siren spacing only touches Sirens)
          expect(generated[i], `${level} ${seed} #${i}`).toBe(after[i]);
          svc++; if (after[i] === 'ratdog') svcRat++; if (after[i] === 'blightbelly') svcBb++; if (after[i] === 'strainer') svcStrainer++;
        } else {
          expect(after[i], `${level} ${seed} #${i} (${ctx[i] ?? 'untagged'}${z.horde !== undefined ? ', horde' : ''}) unchanged`).toBe(before[i]);
          expect(after[i], `${level} ${seed} #${i}: a Strainer only in a service spawn (round 4, lane FAMILY)`).not.toBe('strainer');
          if (z.horde === undefined) { coreN++; if (after[i] === 'ratdog') coreRat++; }
        }
      });
      // restore the generated values (the Mall's spacing post-pass may have turned a Siren into a zombie after the assignment)
      L.zombies.forEach((z, i) => { z.archetype = generated[i]; });
      const sv = L.zombies.filter((_, i) => ctx[i] === 'service');
      lines.push(`${level} ${seed}: annexes ${L.extensions?.annexes.length ?? 0}, service placed ${sv.length} [${sv.map(z => z.archetype).join(', ')}]`);
    }
    // the no-annex control has no service spawns at all
    expect(fresh('subway', 1).zombies.every((_, i) => spawnContextOf(fresh('subway', 1), SPAWN_PROFILES.subway, i) !== 'service')).toBe(true);
    lines.push(`sample: service ${svc} placed, rat/dog ${svcRat} (${(100 * svcRat / Math.max(1, svc)).toFixed(0)} %), Blightbelly ${svcBb}, Strainer ${svcStrainer}; core ambient ${coreN}, rat/dog ${coreRat}`);
    lines.push('configured service shares (rat/dog 0.20, Strainer 0.08) are per-spawn selection probabilities; a 5-6 enemy annex may hold none or several');
    writeFileSync('/tmp/r6-service-census.txt', lines.join('\n') + '\n');
    expect(svc).toBeGreaterThan(0);
  }, 120000);
});
