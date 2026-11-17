// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): the SURFACE RUN crossing end to end on the REAL Game in Node —
// station -> district -> station -> save -> Continue -> district, in a VERSION-2 world: the cargo lift at a closed street exit and the lift
// in the command tent; the RIDE is the crossing both ways (no loading state, no hidden-canvas warm-up; the dolly rides along). The
// journey's steps and checks: tests/helpers/surfaceRunJourney.ts; version 1: tests/surface-run-journey.test.ts. The ride's own rules
// (doors shut until the destination compiled, frames drawn meanwhile, pause, the tent's doorway): tests/surface-lift-ride.test.ts.
import {afterAll, describe, it, vi} from 'vitest';
import {surfaceRunJourney} from './helpers/surfaceRunJourney';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Surface Run v2: station -> district -> station -> save -> Continue -> district by the cargo lift (real Game, validating device)', () => {
  it('version 2: crosses both ways by the cargo lift ride; both worlds and the train exact; the district persists through a save', async () => {
    try { await surfaceRunJourney(false); } finally { vi.restoreAllMocks(); }
  }, 900_000);
});
