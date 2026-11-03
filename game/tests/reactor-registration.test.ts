// Task reactor-build-20261101 (primary): THE REACTOR is a proper registered level (LevelId 'reactor', tier 3) — the registry entry, its
// spawn / loot / mask profiles, the track-extension declaration and the menu / deep-link plumbing. Pure (no generation here: the real
// layout is covered by the lane tests and tests/reactor-level.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {LEVEL_IDS, LEVELS, clearLabel, isLevelId, levelTier, sectionLabel, travelTargets} from '../src/levels/registry';
import {validateLevelRegistry} from '../src/levels/levelContract';
import {SPAWN_PROFILES, STRAINER_CONTEXTS, spawnProfile} from '../src/ai/spawnTables';
import {PROFILES} from '../src/items/lootTables';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {TRACK_EXT_REACTOR, trackExtConfig} from '../src/gen/trackExt/config';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the Reactor registration', () => {
  it('is a registered LevelId with tier 3, one continuous section and travel both ways', () => {
    expect(isLevelId('reactor')).toBe(true);
    expect(LEVEL_IDS[LEVEL_IDS.length - 1]).toBe('reactor');
    expect(levelTier('reactor')).toBe(3);
    expect(LEVELS.reactor.sections(1)).toEqual(['main']);
    expect(LEVELS.reactor.entry).toBe('main');
    expect(LEVELS.reactor.name).toBe('Reactor');
    for (const l of LEVEL_IDS) if (l !== 'reactor') expect(travelTargets(l)).toContain('reactor');
    expect(travelTargets('reactor')).toEqual(['subway', 'office', 'mall']);
    expect(sectionLabel({level: 'reactor', section: 'main'})).toBe('Station and pit');
    expect(clearLabel({level: 'reactor', section: 'main'})).toBe('Pit clear');
    expect(validateLevelRegistry()).toEqual([]);
  });

  it('declares a real track extension (tunnels + at most one BTS annex) — the future train arrival comes through the rim beds', () => {
    expect(LEVELS.reactor.trackExtensions).toBe(TRACK_EXT_REACTOR);
    expect(trackExtConfig('reactor')).toBe(TRACK_EXT_REACTOR);
    expect(TRACK_EXT_REACTOR.annex.max).toBe(1);
    expect(TRACK_EXT_REACTOR.coreReserveM).toBe(0);
  });

  it('spawns: existing families only, density + nastier families rising with depth, the Siren only in deep side rooms, the Strainer service-only', () => {
    const p = spawnProfile('reactor');
    expect(SPAWN_PROFILES.reactor).toBe(p);
    expect(Object.keys(p.contexts).sort()).toEqual(['floor', 'pit', 'ring', 'service', 'station']);
    const hi = (c: 'station' | 'floor' | 'ring' | 'pit') => p.contexts[c]!.count[1];
    expect(hi('station')).toBeLessThan(hi('floor'));
    expect(hi('floor')).toBeLessThan(hi('ring'));
    expect(hi('ring')).toBeLessThan(hi('pit'));
    const w = (c: 'floor' | 'ring' | 'pit', f: string) => (p.contexts[c]!.families ?? p.families).find(([id]) => id === f)?.[1] ?? 0;
    expect(w('floor', 'blightbelly')).toBeLessThan(w('ring', 'blightbelly'));
    expect(w('floor', 'siren')).toBe(0);
    expect(w('ring', 'siren')).toBeGreaterThan(0);
    expect(p.eligibility?.siren?.contexts).toEqual(['ring', 'pit']);
    expect(p.eligibility?.siren?.maxPerLevel).toBe(2);
    for (const c of ['station', 'floor', 'ring', 'pit'] as const) expect(w(c as 'floor', 'strainer')).toBe(0);
    expect(STRAINER_CONTEXTS).toEqual(['service']); // registry lock unchanged
  });

  it('loot: the mall tables under the culminating level pressure; always one gas mask and a tight filter supply', () => {
    expect(PROFILES.reactor.id).toBe('reactor');
    const cw = PROFILES.reactor.overrides.categoryWeight ?? {};
    for (const k of ['ammo', 'med', 'battery'] as const) expect(cw[k]).toBeLessThan(1);
    expect(MASK_LOOT.levels.reactor).toEqual({masks: [1, 1], filters: [3, 5]});
  });

  it('menus: a dev-start level, a third travel slot, New game buttons and the ?reactorSeed= deep link', () => {
    const html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
    const main = fs.readFileSync(path.join(GAME, 'src/main.ts'), 'utf8');
    // (task campaign-foundation-20261102, lane MENU: the title's level cards became the main menu's Dev start picker, which offers
    // every registered level; the deep-link seeds are parsed by main.ts devStartFromUrl)
    expect(LEVEL_IDS).toContain('reactor');
    expect(main).toMatch(/devLevels: LEVEL_IDS/);
    expect(main).toMatch(/\['reactor', 'reactorSeed'\]/);
    expect(html).toMatch(/id="btn-travel-3"/);
    expect(html).toMatch(/id="btn-win-travel-3"/);
    expect(html).toMatch(/id="btn-death-new-fourth"/);
    expect(html.match(/class="btn-new-level[^"]*" type="button" data-level="reactor"/g)?.length).toBe(2);
  });
});
