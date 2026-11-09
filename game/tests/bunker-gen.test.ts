// Task studio-bunker-level-20261109-072224-01: THE BUNKER generator over a bounded seed set — validity (bunkerIssues: reachability,
// stairs + loops, objectives, hazards, levelIssues / traversal / doorways / railings), descending storeys, the storey programmes, the
// generators / core placement, determinism and the generation budget.

import {describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {BUNKER_GEN_STATS, BUNKER_REJECTS, bunkerIssues, generateBunkerLevel} from '../src/gen/bunker/index';
import {BUNKER_CARVE_FAILS} from '../src/gen/bunker/carve';
import {BUNKER_PLAN_FAILS} from '../src/gen/bunker/plan';
import {BUNKER_DRESS_STATS, HERO_FAILS} from '../src/gen/bunker/dress';
import {BUNKER_CORE_KIND, BUNKER_GENERATOR_KIND} from '../src/gen/bunker/bunkerTypes';
import {BUNKER_LEVELS, BUNKER_PROGRAMMES} from '../src/gen/bunker/frame';
import type {StationLayout} from '../src/gen/stationTypes';

const LOG = '/tmp/bunker-gen.log';
const log = (s: string) => appendFileSync(LOG, s + '\n');
const SEEDS = Array.from({length: 12}, (_, k) => 9001 + k * 7919);

describe('bunker generation', () => {
  writeFileSync(LOG, '');
  const layouts = new Map<number, StationLayout>();
  const gen = (seed: number) => {
    let l = layouts.get(seed);
    if (!l) {
      try { l = generateBunkerLevel({levelSeed: seed}); } catch (e) {
        log(`seed ${seed} FAILED: carve ${JSON.stringify(BUNKER_CARVE_FAILS)} plan ${JSON.stringify(BUNKER_PLAN_FAILS)} dress ${JSON.stringify(BUNKER_DRESS_STATS.skipped)} hero ${JSON.stringify(HERO_FAILS)}`);
        throw e;
      }
      layouts.set(seed, l);
      log(`seed ${seed}: ${BUNKER_GEN_STATS.ms.toFixed(0)} ms, attempts ${BUNKER_GEN_STATS.attempts}, carveFails ${BUNKER_GEN_STATS.carveFails}, issues ${JSON.stringify(BUNKER_GEN_STATS.issues.slice(0, 6))}`);
      log(`  grid ${l.grid.w}x${l.grid.h} areas ${l.areas.length} props ${l.props.length} lights ${l.lights.length} zombies ${l.zombies.length} pickups ${l.pickups.length} dress ${JSON.stringify(BUNKER_DRESS_STATS.skipped.slice(0, 4))}`);
    }
    return l;
  };

  it('every seed generates a valid layout (bunkerIssues empty)', () => {
    const bad: string[] = [];
    for (const s of SEEDS) {
      const l = gen(s);
      const issues = bunkerIssues(l);
      if (issues.length) bad.push(`${s}: ${issues.slice(0, 5).join(' | ')}`);
    }
    log(`carve fails ${JSON.stringify(BUNKER_CARVE_FAILS)}`);
    log(`plan fails ${JSON.stringify(BUNKER_PLAN_FAILS)}`);
    log(`rejects ${JSON.stringify([...BUNKER_REJECTS])}`);
    expect(bad).toEqual([]);
  });

  it('storeys descend with their programmes; three generators on storeys 2-4; the core on the lowest storey', () => {
    for (const s of SEEDS) {
      const l = gen(s), b = l.bunker!;
      expect(l.levels.length).toBe(BUNKER_LEVELS);
      for (let i = 1; i < l.levels.length; i++) expect(l.levels[i].baseY).toBeLessThan(l.levels[i - 1].baseY);
      expect(b.storeys.map(q => q.programme)).toEqual(BUNKER_PROGRAMMES);
      expect(b.generators.map(g => g.id)).toEqual(['gen-0', 'gen-1', 'gen-2']);
      expect(b.generators.map(g => g.level)).toEqual([2, 3, 4]);
      for (const g of b.generators) expect(l.props[g.prop].kind).toBe(BUNKER_GENERATOR_KIND);
      expect(l.props.filter(p => p.kind === BUNKER_GENERATOR_KIND).length).toBe(3);
      expect(l.props[b.core.prop].kind).toBe(BUNKER_CORE_KIND);
      expect(b.core.level).toBe(BUNKER_LEVELS - 1);
      expect(Math.max(...l.levels.map(q => q.id))).toBe(b.core.level);
    }
  });

  it('is deterministic (same seed, same layout)', () => {
    const s = SEEDS[0];
    const a = gen(s), b = generateBunkerLevel({levelSeed: s});
    expect(JSON.stringify({areas: b.areas, doors: b.doors, props: b.props, zombies: b.zombies, pickups: b.pickups, bunker: b.bunker}))
      .toBe(JSON.stringify({areas: a.areas, doors: a.doors, props: a.props, zombies: a.zombies, pickups: a.pickups, bunker: a.bunker}));
  });
});
