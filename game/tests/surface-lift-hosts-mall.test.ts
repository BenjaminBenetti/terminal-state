// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, follow-up 2): SURFACE RUN version 2 — the cargo lift ride from
// a Mall, both ways, on the REAL Game in Node (tests/helpers/surfaceLiftHostRide.ts: the doors shut until the destination's warm-up
// reports complete, never a loading state, the host exactly as left). One host per file (CI shards: each file ~4-5 min on one worker).
import {afterAll, describe, it, vi} from 'vitest';
import {liftHostRide} from './helpers/surfaceLiftHostRide';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Surface Run v2: the cargo lift ride from a Mall (real Game, validating device)', () => {
  it('mall: rides up from the building\'s lift and back down; doors shut until the warm-up completes; the host exactly as left', () => liftHostRide('mall'), 600_000);
});
