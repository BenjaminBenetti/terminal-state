// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the EVACUATION CENTRE's record on layout.skyways.addon.evac
// (gen/skyways/events/evacDress.ts). Pure data. Owned by lane EVAC.

/** A discoverable note: its text (gen/skyways/events/evacNotes.ts EVAC_NOTES[text], id = its id) and where it lies (world m, absolute y). */
export interface SkywaysEvacNote {
  id: string;
  text: number;
  x: number; y: number; z: number;
  area: number;
  /** What it lies on: a table / desk top, a bedroll, the floor, pinned to a notice board. */
  on: 'table' | 'desk' | 'bedroll' | 'floor' | 'board';
  /** Its layout.props index (the note prop). */
  prop: number;
}

export type SkywaysEvacSectionRole = 'registration' | 'sleeping' | 'rations' | 'medical' | 'barricaded' | 'office' | 'supplies' | 'family';

export interface SkywaysEvacRecord {
  /** The shelter's printed name (its signs; per seed). */
  name: string;
  /** Sections by what they are for (layout.areas ids). */
  sections: {role: SkywaysEvacSectionRole; area: number}[];
  notes: SkywaysEvacNote[];
  /**
   * The barricaded / abandoned quarantine: a room (panel room B, else the lounge) behind a barricade with a squeeze gap, or a cordoned
   * corner of the dormitory hall (`corner`: its rect, world m). `gap` = the way in (world m, centre).
   */
  quarantine: {area: number; corner: {x0: number; z0: number; x1: number; z1: number} | null; gap: {x: number; z: number}} | null;
  /** The dormitory's central aisle (world m) and its cot count. */
  dorm: {spine: {ax: number; az: number; bx: number; bz: number}; cots: number} | null;
}

/** The shelter's room names (gen/skyways/events/eventVenue.ts relabels the venue carve with them). */
export const EVAC_ROOM_NAMES = {
  hall: 'Dormitory hall', foyer: 'Intake foyer', exhibitors: 'Shelter commons', registration: 'Evacuee registration',
  panels: ['Medical bay', 'Quarantine room'], lounge: 'Family room', backstage: 'Shelter office', storage: 'Supply store',
} as const;
