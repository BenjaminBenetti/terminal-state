// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): the SURFACE RUN crossing end to end on the REAL Game in Node —
// station -> district -> station -> save -> Continue -> district, in a VERSION-1 world (the legacy crossing behind the loading screen, the
// stairwell and its street door). The journey's steps and checks: tests/helpers/surfaceRunJourney.ts. Version 2 (the cargo lift ride):
// tests/surface-run-journey-v2.test.ts (lane ACCESS, field follow-up: one version per file for the CI shards).
import {afterAll, describe, it, vi} from 'vitest';
import {surfaceRunJourney} from './helpers/surfaceRunJourney';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The version-1 world case: an unvisited station records version 1 (Game.sectionGenInputs reads surfaceVersionFor). */
const FORCE = vi.hoisted(() => ({v1: false}));
vi.mock('../src/gen/surface/surfaceRun', async importOriginal => {
  const m = await importOriginal<typeof import('../src/gen/surface/surfaceRun')>();
  return {...m, surfaceVersionFor: (mem: Parameters<typeof m.surfaceVersionFor>[0]) => {
    const v = m.surfaceVersionFor(mem);
    return FORCE.v1 && v === m.SURFACE_VERSION && !mem?.lanes[m.SURFACE_LANE] ? 1 : v;
  }};
});

describe('Surface Run: station -> district -> station -> save -> Continue -> district (real Game, validating device)', () => {
  it('version 1: crosses both ways behind the loading screen; both worlds and the train exact; the district persists through a save', async () => {
    FORCE.v1 = true;
    try { await surfaceRunJourney(true); } finally { FORCE.v1 = false; vi.restoreAllMocks(); }
  }, 900_000); // (about 5 min on one local worker: headroom for a slower CI shard)
});
