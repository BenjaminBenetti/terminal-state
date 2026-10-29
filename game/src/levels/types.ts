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

export type LevelId = 'subway' | 'office';

/** A section of a logical level: every level is one section, 'main' (one continuous world). */
export interface SectionKey {
  level: LevelId;
  section: string;
}

export const sectionId = (k: SectionKey): string => `${k.level}:${k.section}`;

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
  /** Always 'menu' (iteration 17: nothing inside a level travels). */
  via: 'menu';
}

/** Generation context handed to a section generator. */
export interface SectionGenContext {
  /** The logical level's seed for this run (fixed per run; the same section regenerates identically). */
  levelSeed: number;
  startWeapon?: 'rifle' | 'pistol';
  /** Iteration 16 (GEAR): gear items of the level-wide gear roll (gen/gearLoot.ts), all placed in the level's one section. */
  gear?: readonly {itemId: string}[];
}

/** A logical level as the registry describes it (levels/registry.ts, lane RUN). */
export interface LevelDef {
  id: LevelId;
  name: string;
  /** Short line for the level-select menu. */
  blurb: string;
  /** Section the level starts in from the menu. */
  entry: string;
  /** Every section of the level for this seed (iteration 17: always ['main']; used by the level-wide gear roll). */
  sections(levelSeed: number): string[];
  /** Deterministic section layout. */
  generate(section: string, ctx: SectionGenContext): StationLayout;
}
