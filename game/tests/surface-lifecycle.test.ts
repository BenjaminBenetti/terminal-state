import {describe, expect, it} from 'vitest';
import {surfaceBaseKey, surfaceVersionFor, SURFACE_VERSION_LANE, isSurfaceTransition} from '../src/run/surfaceRun';
import {createMemory} from '../src/run/memory';
import {travelRefusal} from '../src/run/travelGate';
import type {SectionKey, TravelRequest} from '../src/levels/types';

describe('Surface Run first visit and local transition contract', () => {
  const key: SectionKey = {level: 'subway', station: 'st-7', section: 'main'};
  it('pins old visited layouts off and new/unvisited layouts on without changing the old memory', () => {
    const old = createMemory(key); old.visits = 2; old.killed = [0, 4]; old.lanes.other = {fixed: true};
    const before = structuredClone(old);
    expect(surfaceVersionFor(old)).toBe(0); expect(old).toEqual(before);
    expect(surfaceVersionFor(undefined)).toBe(1); expect(surfaceVersionFor(createMemory(key))).toBe(1);
    old.lanes[SURFACE_VERSION_LANE] = {v: 1}; expect(surfaceVersionFor(old)).toBe(1);
    old.lanes[SURFACE_VERSION_LANE] = {v: 0}; expect(surfaceVersionFor(old)).toBe(0);
    expect(surfaceBaseKey({...key, section: 'surface'})).toEqual(key);
  });
  it('only the explicit same-station surface crossing bypasses normal same-level refusal', () => {
    const to = {...key, section: 'surface'};
    const req: TravelRequest = {to, arrival: {kind: 'start'}, via: 'surface', label: 'Surface Run'};
    const gate = {busy: false, alive: true, ready: true, state: 'playing', current: key.level, currentKey: key, sections: () => ['main', 'surface']};
    expect(travelRefusal(req, gate)).toBeNull();
    expect(travelRefusal({...req, via: 'menu'}, gate)).toBe('same-level');
    expect(travelRefusal({...req, to: {...to, station: 'st-8'}}, gate)).toBe('unknown-section');
    expect(travelRefusal(req, {...gate, busy: true})).toBe('busy');
    expect(travelRefusal(req, {...gate, alive: false})).toBe('dead');
    expect(isSurfaceTransition(to, key)).toBe(true);
    expect(isSurfaceTransition({...key, level: 'reactor'}, {...to, level: 'reactor'})).toBe(false);
  });
});
