// Iteration 16 (primary, shared contract) / iteration 17 (seamless): logical levels and travel between them.
//
// A LOGICAL LEVEL is a location of the run (the Subway, Office Space; later more, reached by train). Each logical level
// is ONE continuous built world (a single section, 'main'): a StationLayout with all its storeys (gen/levels.ts).
//  - subway: the full station (unchanged).
//  - office: a compact subway station, the tower lobby above it and office floors 2–8 above that, at their real heights
//    in one world — walked by stairs and ridden by a physically moving elevator. Moving between storeys is never a travel.
// TRAVEL only changes the logical level (the pause / clear menus): full loading screen, the run's carry-over kept.
//
// Ownership: types + registry + run state + Game lifecycle = primary. The office generator (gen/office/*) = lane GEN;
// elevator / windows / exterior runtime = lane LIFT.

import type {StationLayout} from '../gen/stationTypes';
import type {TrackExtConfig} from '../gen/trackExt/types';

// Task track3-eaton-centre-20261031 (lane GEN): + 'mall' — the mall (tier 2; gen/mall/index.ts generateMallLevel; seeded "<Name> Center").
// Task reactor-build-20261101 (primary): + 'reactor' — THE REACTOR (tier 3; gen/reactor/index.ts generateReactorLevel): the selected B
// "Industrial Service Cathedral" pit under a rim station.
export type LevelId = 'subway' | 'office' | 'mall' | 'reactor';

/** A section of a logical level: every level is one section, 'main' (one continuous world). */
export interface SectionKey {
  /** The ARCHETYPE (which generator builds it). */
  level: LevelId;
  section: string;
  /**
   * Task studio-alpha-campaign-foundation-20261102-230708-01: the campaign network STATION (campaign/types.ts StationId) — one
   * persistent world per node; two Subway nodes are two worlds. Absent = the legacy one-world-per-archetype key (QA / dev runs).
   */
  station?: string;
}

/** Memory / lane-store key: `${station}:${section}` for a campaign station, else `${level}:${section}`. */
export const sectionId = (k: SectionKey): string => `${k.station ?? k.level}:${k.section}`;

/** How the player arrives in a level: its start ('return' = the same start, used when coming back to a level). */
export type ArrivalKind = 'start' | 'return';

export interface Arrival {
  kind: ArrivalKind;
}

/** A travel request: a level change chosen in a menu (full loading screen). Game owns the single in-flight travel. */
export interface TravelRequest {
  to: SectionKey;
  arrival: Arrival;
  /** UI text while travelling ("Travelling to Office Space"). */
  label: string;
  /** 'menu' (the legacy pause / clear menus, QA) or 'train' (campaign: the player's train between network stations). */
  via: 'menu' | 'train';
}

/** Generation context handed to a section generator. */
export interface SectionGenContext {
  /** The logical level's seed for this run (fixed per run; the same section regenerates identically). */
  levelSeed: number;
  startWeapon?: 'rifle' | 'pistol';
  /**
   * Iteration 16 (GEAR): gear items of the level-wide gear roll (gen/gearLoot.ts), all placed in the level's one section.
   * Task gasmask-breach-20261030 (mask lane): followed by the level's gas masks (with their seeded `filter` seconds) and filters.
   */
  gear?: readonly {itemId: string; filter?: number}[];
}

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): a level's DIFFICULTY TIER — an integer >= 0 (Subway 0 = the starting level,
 * Office Space 1). Metadata only: nothing scales counts / damage / loot by it and no enemy family is enabled by it (a level opts in
 * to e.g. the Siren in its own spawn profile). levels/levelContract.ts validates every registered level declares one.
 */
export type LevelTier = number;

/** A logical level as the registry describes it (levels/registry.ts, lane RUN). */
export interface LevelDef {
  id: LevelId;
  /** Difficulty tier (task track1, lane SPAWN): explicit for every level — never defaulted. */
  tier: LevelTier;
  name: string;
  /** Short line for the level-select menu. */
  blurb: string;
  /** Section the level starts in from the menu. */
  entry: string;
  /** Every section of the level for this seed (iteration 17: always ['main']; used by the level-wide gear roll). */
  sections(levelSeed: number): string[];
  /** Deterministic section layout. */
  generate(section: string, ctx: SectionGenContext): StationLayout;
  /**
   * Track 2 (lane GEN): the level's track extensions — tunnels past its track-bed ends and service annexes (gen/trackExt), or
   * 'none' (the beds keep their black end walls). REQUIRED on every level: a level whose layouts carry track beds must decide
   * (tests/track-ext-coverage.test.ts fails for a track-bearing level whose generator ignores its config).
   */
  trackExtensions: TrackExtConfig | 'none';
}
