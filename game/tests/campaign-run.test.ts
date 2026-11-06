// Task studio-alpha-campaign-foundation-20261102-230708-01 (primary): the station-keyed run — a campaign node is ONE persistent
// world (its own seed / gear / section memories / Retry scope); two Subway nodes never share or overwrite state; legacy archetype
// runs (no campaign) keep their old keys.
import {describe, expect, it} from 'vitest';
import {createRun} from '../src/run/runState';
import {parseSectionId} from '../src/run/bagStore';
import {sectionId, type LevelId} from '../src/levels/types';
import type {CampaignState, SubwayNetwork} from '../src/campaign/types';

const LEVELS = {subway: {sections: () => ['main']}, office: {sections: () => ['main']}, mall: {sections: () => ['main']}, skyways: {sections: () => ['main']}, reactor: {sections: () => ['main']}} as Record<LevelId, {sections(s: number): string[]}>;
const SEEDS = {subway: 11, office: 22, mall: 33, skyways: 707, reactor: 44};

function fixture(): CampaignState {
  const network: SubwayNetwork = {
    v: 1, seed: 7, start: 'st-00', reactor: 'st-02',
    nodes: [
      {id: 'st-00', name: 'Calder Park', archetype: 'subway', levelSeed: 1001, x: 0, y: 0, lines: ['a']},
      {id: 'st-01', name: 'Wexford Street', archetype: 'subway', levelSeed: 2002, x: 10, y: 0, lines: ['a']},
      {id: 'st-02', name: 'Core Works', archetype: 'reactor', levelSeed: 3003, x: 20, y: 0, lines: ['a']},
    ],
    edges: [['st-00', 'st-01'], ['st-01', 'st-02']],
    lines: [{id: 'a', name: 'Red Line', color: '#b33', stations: ['st-00', 'st-01', 'st-02']}],
  };
  return {v: 1, network, current: 'st-00', known: ['st-00'], visited: ['st-00'], cheat: false, won: null, transit: null};
}

describe('campaign run: one persistent world per station', () => {
  it('seeds, gear and memories follow the STATION, not the archetype', () => {
    const rolls: number[] = [];
    const run = createRun({seeds: SEEDS, start: {level: 'subway', section: 'main', station: 'st-00'}, levels: LEVELS, campaign: fixture(),
      rollGear: seed => { rolls.push(seed); return {main: [{itemId: `gear-${seed}`}]}; }});
    const a = {level: 'subway' as const, section: 'main', station: 'st-00'}, b = {level: 'subway' as const, section: 'main', station: 'st-01'};
    expect(run.seedFor(a)).toBe(1001);
    expect(run.seedFor(b)).toBe(2002); // the same archetype, a different world
    expect(run.seedFor({level: 'subway', section: 'main'})).toBe(11); // legacy key: the archetype seed
    expect(run.gearFor(a)).toEqual([{itemId: 'gear-1001'}]);
    expect(run.gearFor(b)).toEqual([{itemId: 'gear-2002'}]);
    expect(run.gearFor(a)).toEqual([{itemId: 'gear-1001'}]);
    expect(rolls).toEqual([1001, 2002]); // lazily, once per station
    expect(sectionId(a)).toBe('st-00:main');
    run.memory(a).killed.push(3);
    run.memory(b).killed.push(9);
    run.setLaneStore('reactor.state', {v: 1, x: 'a'}, a);
    expect(run.memory(a).killed).toEqual([3]);
    expect(run.memory(b).killed).toEqual([9]);
    expect(run.laneStore('reactor.state', b)).toBeUndefined();
    // the Retry scope is the station: restoring st-00 leaves st-01 untouched
    const snap = run.scopeMemories(a);
    expect(Object.keys(snap)).toEqual(['st-00:main']);
    run.memory(a).killed.push(4);
    run.memory(b).killed.push(10);
    run.restoreScopeMemories(a, snap);
    expect(run.memory(a).killed).toEqual([3]);
    expect(run.memory(b).killed).toEqual([9, 10]);
  });

  it('memory ids round-trip through the bag store parser; export / import is a deep copy of every station', () => {
    const run = createRun({seeds: SEEDS, start: {level: 'subway', section: 'main', station: 'st-00'}, levels: LEVELS, campaign: fixture()});
    run.memory({level: 'subway', section: 'main', station: 'st-01'}).visits = 2;
    for (const id of run.memoryIds()) expect(sectionId(parseSectionId(id))).toBe(id);
    expect(parseSectionId('office:main')).toEqual({level: 'office', section: 'main'});
    const dump = run.exportMemories();
    dump['st-01:main'].visits = 99;
    expect(run.peekMemory({level: 'subway', section: 'main', station: 'st-01'})!.visits).toBe(2);
    const other = createRun({seeds: SEEDS, start: {level: 'subway', section: 'main', station: 'st-00'}, levels: LEVELS, campaign: fixture()});
    other.importMemories(run.exportMemories());
    expect(other.memoryIds()).toEqual(run.memoryIds());
    expect(other.peekMemory({level: 'subway', section: 'main', station: 'st-01'})!.visits).toBe(2);
  });

  it('legacy archetype runs keep their keys and eager gear roll', () => {
    const rolls: string[] = [];
    const run = createRun({seeds: SEEDS, start: {level: 'subway', section: 'main'}, levels: LEVELS, rollGear: (_s, l) => { rolls.push(l); return {main: []}; }});
    expect(run.campaign).toBeNull();
    expect(rolls.sort()).toEqual(['mall', 'office', 'reactor', 'skyways', 'subway']);
    expect(run.sectionId).toBe('subway:main');
    expect(run.scopeOf()).toBe('subway');
  });
});
