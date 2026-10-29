// Iteration 16 (primary, shared contract): logical levels, their sections and travel between them.
//
// A LOGICAL LEVEL is a location of the run (the Subway, Office Space; later more, reached by train). Each logical level
// is made of one or more SECTIONS. A section is what is built and rendered at a time; it is a StationLayout with its own
// storeys (gen/levels.ts, within the engine's per-section limits: light field / fog / decay support up to 4 storeys).
//  - subway: one section, 'main' (the existing full station, unchanged).
//  - office: 'street' (a small subway station whose upper storey is the office tower lobby, joined by real stairs)
//    plus 'floor-2' … 'floor-N' (one office storey each), joined to the lobby and to each other by the elevator and the
//    stairwell. Moving between sections is a TRAVEL: gameplay freezes, the section is built and warmed up, the player
//    arrives at the matching point (inside the elevator cab, at the stairwell door, …).
// Storeys INSIDE a section are not travel: they are walked (stairs, ladders), as before.
//
// Ownership: types here = primary. levels/registry.ts + run state + Game lifecycle = lane RUN. The office section
// generator (gen/office/*) = lane WORLD-GEN. Elevator / stairwell doors / windows / exterior = lane TOWER.

import type {StationLayout} from '../gen/stationTypes';

export type LevelId = 'subway' | 'office';

/** A section of a logical level: 'main' (subway), 'street' / 'floor-2' … (office). */
export interface SectionKey {
  level: LevelId;
  section: string;
}

export const sectionId = (k: SectionKey): string => `${k.level}:${k.section}`;

/** How the player arrives in a section (picks the arrival pose; an 'elevator' arrival starts inside the cab). */
export type ArrivalKind = 'start' | 'elevator' | 'stairs-up' | 'stairs-down' | 'return';

export interface Arrival {
  kind: ArrivalKind;
  /** Elevator: the floor index the cab arrives at (the cab is rebuilt there, doors closed, then they open). */
  floor?: number;
}

/** A travel request (menu level select, elevator ride, stairwell door). Game owns the single in-flight travel. */
export interface TravelRequest {
  to: SectionKey;
  arrival: Arrival;
  /** UI text while travelling ("Elevator · floor 5", "Travelling to Office Space"). */
  label: string;
  /** 'menu' = from the level-select menu (full loading screen); 'local' = elevator / stair (in-world overlay). */
  via: 'menu' | 'local';
}

/** Generation context handed to a section generator. */
export interface SectionGenContext {
  /** The logical level's seed for this run (fixed per run; the same section regenerates identically). */
  levelSeed: number;
  startWeapon?: 'rifle' | 'pistol';
  /** Iteration 16 (GEAR): gear items assigned to THIS section by the level-wide gear roll (gen/gearLoot.ts). */
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
  /** Every section of the level for this seed (generation order; used by the level-wide gear roll). */
  sections(levelSeed: number): string[];
  /** Deterministic section layout. */
  generate(section: string, ctx: SectionGenContext): StationLayout;
}
