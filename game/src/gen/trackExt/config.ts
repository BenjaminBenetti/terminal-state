// Track 2 (lane GEN): THE balance / geometry config of the track extensions (one exported block, TRACK_EXT) and the measured
// Subway walkable-exploration baseline the annex size target is a share of. Per-level variants only differ where the level's
// structure requires it (the level-specific grid budgets / crop rules are the generator's TrackExtContext): the Office street
// station keeps the original planner (TRACK_EXT_OFFICE), the Subway adds the GEN-2 incidence options.

import {Rng, hashString} from '../../core/rng';
import type {TrackExtConfig} from './types';

/**
 * THE BEYOND THE STATION AREA CHANCE (user, 2026-11-01: "drop the spawn chance of the beyond the station area ... twenty percent ...
 * across all levels"). The area itself — the service annexes (doors / hatches, rooms, hideouts, caches, marks, graffiti, invitation
 * art, annex loot / lights / vents / service spawns) — exists on a generated level with this probability, ONE shared constant for
 * every level type that uses the shared attach path (Subway, Office, Mall and any future level declaring a TrackExtConfig).
 */
export const BTS_AREA_CHANCE = 0.2;
/** Salt of the area roll's own stream (a dedicated hash of the LEVEL seed; bump the version only with an authorized re-roll). */
export const BTS_AREA_SALT = 'beyond-the-station-area-v1';

/**
 * The level's ONE Beyond the Station area roll u in [0, 1): a pure function of the logical LEVEL seed (the run's per-level seed,
 * ctx.levelSeed — not an attempt seed and not a per-tunnel / per-entrance stream), so it never re-rolls on a generation retry, on
 * re-entering / reloading / revisiting the level, and draws nothing from any generation stream (the core is untouched by it).
 */
export function btsAreaRoll(levelSeed: number): number {
  return new Rng(hashString(BTS_AREA_SALT, levelSeed >>> 0)).next();
}

/** True when the level's one area roll succeeds (u < BTS_AREA_CHANCE): the level may carry service annexes at all. */
export function btsAreaPresent(levelSeed: number): boolean {
  return btsAreaRoll(levelSeed) < BTS_AREA_CHANCE;
}

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
 * (Round 3, lane LAYOUT) THE SERVICE-AREA PLAN of every annex (TrackExtConfig.annex.layout; gen/trackExt/annexLayout.ts): a 1.5-2 m main
 * service corridor in 10-16 m segments (fire-door openings between them; 3-5 beyond its junction), 2-4 wings of 1-2 segments,
 * rooms lined up along both sides of every corridor — 4-5.5 m deep small staff rooms on the entry passage and the junction, 5-8 m
 * plant rooms beyond, widths along the corridor by weight — wing slots reserved on a spine side with `slotChance`, the hideout rule
 * (>= 3.5 x 4 m and 14 m², 18-32 m² preferred) and the growth-aware choices' crop scale (cells).
 */
export const SERVICE_LAYOUT: NonNullable<TrackExtConfig['annex']['layout']> = {
  spineWidth: [1.5, 2],
  segment: [10, 16],
  spineSegments: [3, 5],
  wings: [2, 4],
  wingSegments: [1, 2],
  wingWidth: [1.5, 2],
  bay: {staff: [4, 5.5], plant: [5, 8]},
  widths: {
    staff: [[3, 3.5, 0.2], [4, 5, 0.5], [5.5, 7, 0.3]],
    plant: [[3, 3.5, 0.1], [4, 5, 0.25], [5.5, 7.5, 0.35], [8, 10, 0.3]],
  },
  slotChance: 0.55,
  hideout: {short: 3.5, long: 4, m2: 14, prefer: [18, 32]},
  growthScale: 2000,
};

/**
 * Track extension config of the Subway (the Office street station uses TRACK_EXT_OFFICE: the same block minus the GEN-2 options).
 *
 * GEN-2 (user: service annexes "present randomly on basically every level that has a subway track", "multiple can spawn, two"):
 *  - coreReserveM 40: AUTHORIZED, documented CORE-CHANGING Subway layout change (decided by the primary for the incidence
 *    requirement): 40 m of rock stay free straight past every bed end that is still open right after the archetype skeleton,
 *    so the station's later growth leaves room for a tunnel there (gen/trackExt/index.ts reserveTunnelRoom);
 *  - annex.count: seeded per-level weights of wanting 0 / 1 / 2 annexes, attempted over the level's candidates (tunnels first,
 *    then service hatches). (2026-11-01, lane AREA) Whether the level has the area at all is BTS_AREA_CHANCE's one level roll; the
 *    weights only shape the count of a level whose roll succeeded — the zero entry is 0 (was 0.07): 1 or 2 in the ratio 0.53 : 0.4;
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
    count: [0, 0.53, 0.4],
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
    // task track2-playtest-revision (lane ROOMS): 2-3 machinery halls per annex (9-12 x 12-16 m, 3.6-4.2 m ceilings) inside the
    // same area target — the tight network stays, punctuated by big signature rooms (user feedback 5)
    hall: {count: [2, 3], short: [9, 12], long: [12, 16], ceil: [3.6, 4.2], spacing: 2, tries: 8, slack: 0.02},
    // round 3 (lane LAYOUT): the logical service-area plan (main corridor, wings, rooms lined up, the hideout)
    layout: SERVICE_LAYOUT,
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
 * The Office street station: TRACK_EXT without the GEN-2 options — the original planner (annexes off tunnels only, on the eligible
 * tunnels in a seeded order, up to annex.max) and no core reserve (its fixed-origin canvas only grows east / south; the reserve is a
 * Subway layout change). (2026-11-01, lane AREA) Its old per-eligible-tunnel 0.6 roll is gone: the level's one BTS_AREA_CHANCE roll
 * decides whether it has the area; when it does, every eligible tunnel takes an annex until the max (at least one where eligible).
 * (2026-11-01, lane OFFICE; user: the ACTUAL area occurrence is 20 % on every level type) `fallbackHatch`: a present level whose
 * eligible tunnels placed NO annex (the fixed east / south canvas often leaves every first straight too short for a door) gets ONE
 * service-hatch annex at an open bed end instead — the Subway's bed-wall entry and 2-10 m window (TRACK_EXT.hatch), on its own fork;
 * the GEN-2 planner (count, host first straights, hatches as further candidates) stays off.
 */
export const TRACK_EXT_OFFICE: TrackExtConfig = {
  ...TRACK_EXT,
  annex: {...TRACK_EXT.annex, count: undefined, hostFirstStraight: undefined},
  coreReserveM: 0,
  hatch: undefined,
  fallbackHatch: TRACK_EXT.hatch,
};

/**
 * Task track3-eaton-centre-20261031 (lane INTEG, Track2 integration): THE EATON'S CENTER's pit station — TRACK_EXT (the GEN-2
 * incidence planner: tunnels first, then service hatches; with annex.max 1 and the 2026-11-01 one-roll rule: ONE annex when the
 * level's BTS_AREA_CHANCE roll succeeds and a candidate fits, none otherwise) WITHOUT the core reserve: coreReserveM is a
 * Subway skeleton step (gen/station.ts reserveTunnelRoom) the mall generator never runs, so the mall's core layout is unchanged.
 * Its canvas has a fixed crop origin (east / south growth only: gen/mall/index.ts).
 */
export const TRACK_EXT_MALL: TrackExtConfig = {...TRACK_EXT, coreReserveM: 0, annex: {...TRACK_EXT.annex, max: 1}};
// (task mall-playtest-revision-20261031, lane GEN: annex.max 1 — the compact mall keeps AT MOST ONE service annex. Its smaller court
// no longer covers the west bed end's tunnel stub, so a service hatch there could host a second annex next to the east tunnel's; the
// brief keeps one per mall, proportionate to the ~8-10k m² core. Subway / Office configs are untouched.)

/**
 * Task reactor-build-20261101 (primary): THE REACTOR's rim station — the mall's rule (no core reserve: the reactor generator never runs
 * the Subway skeleton step; AT MOST ONE Beyond-the-Station annex under the standard one-roll chance). The bed tunnels continue past
 * the rim station's bed ends (the future train arrival comes through them).
 */
export const TRACK_EXT_REACTOR: TrackExtConfig = {...TRACK_EXT, coreReserveM: 0, annex: {...TRACK_EXT.annex, max: 1}};

/**
 * Task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS' station under the station building — the mall's rule (no core
 * reserve; at most ONE Beyond-the-Station annex under the standard one-roll chance; east / south growth from its fixed crop origin).
 */
export const TRACK_EXT_SKYWAYS: TrackExtConfig = {...TRACK_EXT, coreReserveM: 0, annex: {...TRACK_EXT.annex, max: 1}};

/**
 * Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET grows no extensions at all — LEVELS.market.trackExtensions
 * is 'none' (a calm settlement: no Beyond-the-Station annex, no 'service' spawns; the bed ends stay closed). This record only answers the
 * per-level questions asked of every level's config (the annex ceiling the references report): zero annexes.
 */
export const TRACK_EXT_MARKET: TrackExtConfig = {...TRACK_EXT, annex: {...TRACK_EXT.annex, max: 0}};

/**
 * Task studio-bunker-level-20261109-072224-01 (lane LEVEL): THE BUNKER grows no extensions — LEVELS.bunker.trackExtensions is 'none' (the
 * buried station's bed ends stay closed end walls; the level's back of house is the shelter itself, no Beyond-the-Station annex, no
 * 'service' spawns). Like the market's, this record only answers the per-level questions asked of every level's config: zero annexes.
 */
export const TRACK_EXT_BUNKER: TrackExtConfig = {...TRACK_EXT, annex: {...TRACK_EXT.annex, max: 0}};

/** Per-level track-extension config (levels/registry.ts LEVELS[..].trackExtensions reads it; the market and the bunker declare 'none' there). */
export function trackExtConfig(levelId: string): TrackExtConfig {
  return levelId === 'office' ? TRACK_EXT_OFFICE : levelId === 'mall' ? TRACK_EXT_MALL : levelId === 'reactor' ? TRACK_EXT_REACTOR : levelId === 'skyways' ? TRACK_EXT_SKYWAYS : levelId === 'market' ? TRACK_EXT_MARKET : levelId === 'bunker' ? TRACK_EXT_BUNKER : TRACK_EXT; // (+ the bunker's zero-annex record: task studio-bunker-level-20261109-072224-01)
}
