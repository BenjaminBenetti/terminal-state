// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the EVACUATION CENTRE's record on layout.skyways.addon.evac
// (gen/skyways/events/evacDress.ts). Pure data. Owned by lane EVAC.

/** A discoverable note (its text id in gen/skyways/events/evacNotes.ts and where it lies, world m). */
export interface SkywaysEvacNote { id: string; x: number; y: number; z: number; area: number }

export interface SkywaysEvacRecord {
  /** The shelter's printed name (its signs; per seed). */
  name: string;
  /** Sections by what they are for (layout.areas ids). */
  sections: {role: 'registration' | 'sleeping' | 'rations' | 'medical' | 'barricaded' | 'office' | 'supplies' | 'family'; area: number}[];
  notes: SkywaysEvacNote[];
}

/** The shelter's room names (gen/skyways/events/eventVenue.ts relabels the venue carve with them). */
export const EVAC_ROOM_NAMES = {
  hall: 'Dormitory hall', foyer: 'Intake foyer', exhibitors: 'Shelter commons', registration: 'Evacuee registration',
  panels: ['Medical bay', 'Quarantine room'], lounge: 'Family room', backstage: 'Shelter office', storage: 'Supply store',
} as const;
