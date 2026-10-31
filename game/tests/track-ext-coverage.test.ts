// Track 2 — Beyond the Station (lane GEN): COVERAGE of the reusable track-bearing interface. Every registered logical level is
// generated; a level whose layouts carry track beds must declare `trackExtensions` (a config or 'none') and its generator must
// honour it (gen/trackExt/index.ts trackExtCoverageIssues). No level ids are hard-coded: a new level (e.g. a mall station built
// with the shared block builders) is covered the moment it is registered.
import {describe, expect, it} from 'vitest';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {generateStation} from '../src/gen/station';
import {trackExtCoverageIssues} from '../src/gen/trackExt/index';
import type {LevelDef} from '../src/levels/types';

describe('track extensions — every track-bearing level decides', () => {
  it('every registered level declares trackExtensions and its generator honours it', () => {
    for (const id of LEVEL_IDS) {
      const def: LevelDef = LEVELS[id];
      expect(def.trackExtensions, `${id}: trackExtensions`).toBeDefined();
      const layout = def.generate(def.entry, {levelSeed: 4242, startWeapon: 'pistol'});
      expect(trackExtCoverageIssues(id, def.trackExtensions, layout), id).toEqual([]);
      if (layout.trenches.length && def.trackExtensions !== 'none') expect(layout.extensions, id).toBeTruthy();
    }
  });

  it('the rule fails a track-bearing level without a declaration, or whose generator ignores its config', () => {
    const withExt = generateStation(4242);
    const none = generateStation(4242, {trackExtensions: 'none'});
    expect(none.extensions).toBeUndefined();
    expect(trackExtCoverageIssues('synthetic', undefined, withExt).length).toBe(1);
    expect(trackExtCoverageIssues('synthetic', LEVELS.subway.trackExtensions, none)[0]).toMatch(/never called extendTracks/);
    expect(trackExtCoverageIssues('synthetic', 'none', withExt)[0]).toMatch(/declared 'none'/);
    expect(trackExtCoverageIssues('synthetic', 'none', none)).toEqual([]);
    // a level without track beds needs no declaration
    expect(trackExtCoverageIssues('synthetic', undefined, {...none, trenches: []})).toEqual([]);
  });
});
