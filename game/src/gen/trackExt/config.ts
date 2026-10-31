// Track 2 (lane GEN): THE balance / geometry config of the track extensions (one exported block, TRACK_EXT) and the measured
// Subway walkable-exploration baseline the annex size target is a share of. Per-level variants only differ where the level's
// structure requires it (none today: the level-specific grid budgets / crop rules are the generator's TrackExtContext).

import type {TrackExtConfig} from './types';

/**
 * The Subway walkable-exploration BASELINE (m²) — the annex size target is a share of it (TRACK_EXT.annex.share).
 * Basis (DESIGN §2): Σ over ALL levels (main, upper, lower) of the core Subway station of the walkable FLOOR cells that carry an
 * area id, track beds (VOID) excluded, × 0.25 m² per cell — geometric floor (props not subtracted; annexes are measured the same
 * way, undressed). Stair runs carved into two level grids count on both.
 * Measured by lane GEN over the 64-seed corpus seeds (i * 2654435761 + 12345) >>> 0, i = 0..63, generateStation(seed,
 * {trackExtensions: 'none'}) (= main): mean 7347 m², median 7300 m², min 5061 m², max 9513 m² (tests/track-ext.test.ts re-measures
 * a 24-seed sample and checks this constant stays within 5 % of it).
 */
export const SUBWAY_WALK_BASELINE_M2 = 7347;

/** Track extension config (every track-bearing level today: the Subway and the Office street station). */
export const TRACK_EXT: TrackExtConfig = {
  tunnel: {
    length: [30, 110],
    arcWeights: [0.35, 0.45, 0.2],
    radius: [14, 30],
    maxTurnDeg: 80,
    turnsDeg: [20, 30, 45, 60, 80],
    firstStraight: [6, 44],
    caps: {rubble: 0.45, bulkhead: 0.3, gate: 0.25},
    capDepth: 1.5,
  },
  margin: {core: 1, ext: 2},
  annex: {
    chance: 0.6,
    max: 2,
    share: 0.25,
    jitter: [0.85, 1.15],
    minShare: 0.15,
    doorMinS: 15,
    doorEndClear: 10,
    corridorWidth: [1.5, 2],
    corridorLength: [6, 18],
    roomMin: [3, 3],
    roomMax: [8, 10],
    closetMax: 3.5,
    ceil: [2.4, 2.8],
    doorHeight: 2.3,
    doorCells: 3,
    loopChance: 0.7,
    steps: 420,
  },
  coreReserveM: 0,
  clues: {
    chance: 0.85,
    mouthS: [3, 7],
    beforeDoor: 10,
    tagChance: 0.5,
  },
};

/** Per-level track-extension config (levels/registry.ts LEVELS[..].trackExtensions reads it). */
export function trackExtConfig(_levelId: string): TrackExtConfig {
  return TRACK_EXT;
}
