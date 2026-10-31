// Track 2 (lane GEN): THE balance / geometry config of the track extensions (one exported block, TRACK_EXT) and the measured
// Subway walkable-exploration baseline the annex size target is a share of. Per-level variants only differ where the level's
// structure requires it (the level-specific grid budgets / crop rules are the generator's TrackExtContext): the Office street
// station keeps the original planner (TRACK_EXT_OFFICE), the Subway adds the GEN-2 incidence options.

import type {TrackExtConfig} from './types';

/**
 * The Subway walkable-exploration BASELINE (m²) — the annex size target is a share of it (TRACK_EXT.annex.share).
 * Basis (DESIGN §2): Σ over ALL levels (main, upper, lower) of the core Subway station of the walkable FLOOR cells that carry an
 * area id, track beds (VOID) excluded, × 0.25 m² per cell — geometric floor (props not subtracted; annexes are measured the same
 * way, undressed). Stair runs carved into two level grids count on both.
 * Measured by lane GEN over the 64-seed corpus seeds (i * 2654435761 + 12345) >>> 0, i = 0..63, generateStation(seed,
 * {trackExtensions: 'none'}) (= the core station): mean 7370.6 m², median 7312.5 m², min 5060.8 m², max 9512.8 m² (the constant
 * is the mean; tests/track-ext.test.ts re-measures a 16-seed sample and checks it stays within 6 %).
 */
export const SUBWAY_WALK_BASELINE_M2 = 7371;

/**
 * Track extension config of the Subway (the Office street station uses TRACK_EXT_OFFICE: the same block minus the GEN-2 options).
 *
 * GEN-2 (user: service annexes "present randomly on basically every level that has a subway track", "multiple can spawn, two"):
 *  - coreReserveM 40: AUTHORIZED, documented CORE-CHANGING Subway layout change (decided by the primary for the incidence
 *    requirement): 40 m of rock stay free straight past every bed end that is still open right after the archetype skeleton,
 *    so the station's later growth leaves room for a tunnel there (gen/trackExt/index.ts reserveTunnelRoom);
 *  - annex.count: seeded per-level weights of wanting 0 / 1 / 2 annexes, attempted over the level's candidates (tunnels first,
 *    then service hatches) — `annex.chance` is the Office's per-tunnel roll and unused here;
 *  - annex.hostFirstStraight: a tunnel planned while the level still wants an annex host gets a first straight long enough for
 *    the door (doorMinS + the door + a few metres of door positions);
 *  - hatch: where no tunnel continues a bed end (island-ends / express: the paid end halls stand 1.5-4 m past every bed end),
 *    the annex may be entered by a service door in the bed's side wall 2-10 m from that end (ServiceAnnex.bed).
 */
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
    count: [0.07, 0.53, 0.4],
    hostFirstStraight: 21,
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
  coreReserveM: 40,
  hatch: {s: [2, 10]},
  clues: {
    chance: 0.85,
    mouthS: [3, 7],
    beforeDoor: 10,
    tagChance: 0.5,
  },
};

/**
 * The Office street station: TRACK_EXT without the GEN-2 options — the original planner (one `annex.chance` roll per eligible
 * tunnel, annexes off tunnels only) and no core reserve (its fixed-origin canvas only grows east / south; the reserve is a Subway
 * layout change). Its extensions, and every Office pin, stay exactly as before GEN-2.
 */
export const TRACK_EXT_OFFICE: TrackExtConfig = {
  ...TRACK_EXT,
  annex: {...TRACK_EXT.annex, count: undefined, hostFirstStraight: undefined},
  coreReserveM: 0,
  hatch: undefined,
};

/**
 * Task track3-eaton-centre-20261031 (lane INTEG, Track2 integration): THE EATON'S CENTER's pit station — TRACK_EXT (the GEN-2
 * incidence planner: 0 / 1 / 2 wanted annexes, tunnels first, then service hatches) WITHOUT the core reserve: coreReserveM is a
 * Subway skeleton step (gen/station.ts reserveTunnelRoom) the mall generator never runs, so the mall's core layout is unchanged.
 * Its canvas has a fixed crop origin (east / south growth only: gen/mall/index.ts).
 */
export const TRACK_EXT_MALL: TrackExtConfig = {...TRACK_EXT, coreReserveM: 0, annex: {...TRACK_EXT.annex, max: 1}};
// (task mall-playtest-revision-20261031, lane GEN: annex.max 1 — the compact mall keeps AT MOST ONE service annex. Its smaller court
// no longer covers the west bed end's tunnel stub, so a service hatch there could host a second annex next to the east tunnel's; the
// brief keeps one per mall, proportionate to the ~8-10k m² core. Subway / Office configs are untouched.)

/** Per-level track-extension config (levels/registry.ts LEVELS[..].trackExtensions reads it). */
export function trackExtConfig(levelId: string): TrackExtConfig {
  return levelId === 'office' ? TRACK_EXT_OFFICE : levelId === 'mall' ? TRACK_EXT_MALL : TRACK_EXT;
}
