// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EXPO): the TECHNOLOGY EXPO's record on layout.skyways.addon.expo
// (what gen/skyways/events/expoDress.ts placed: QA / tests / the runtime's screens). Pure data. Owned by lane EXPO.

/** What the expo's dresser placed (layout.props indices are not stored: placements are found by kind / area). */
export interface SkywaysExpoRecord {
  /** The fictional expo's printed name (its signs / screens; per seed). */
  name: string;
  /** Exhibitor booths (one per booth: its area, a fictional exhibitor name and its centre, world m). */
  booths: {area: number; name: string; x: number; z: number}[];
}

/** The expo's room names (gen/skyways/events/eventVenue.ts relabels the venue carve with them). */
export const EXPO_ROOM_NAMES = {
  hall: 'Keynote hall', foyer: 'Keynote foyer', exhibitors: 'Expo floor', registration: 'Expo registration',
  panels: ['Demo theatre A', 'Demo theatre B'], lounge: 'Developer lounge', backstage: 'Exhibitor staff room', storage: 'Expo storage',
} as const;
