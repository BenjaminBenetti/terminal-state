// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF): the MINI-GOLF course's record on layout.skyways.addon.golf
// (gen/skyways/events/golfDress.ts). Pure data. Owned by the golf lanes.

/** One hole of the course: its number, area, tee spot and cup (world m, absolute y = the green's top). */
export interface SkywaysGolfHole {
  n: number;
  area: number;
  par: number;
  tee: {x: number; y: number; z: number};
  cup: {x: number; y: number; z: number; r: number};
}

export interface SkywaysGolfRecord {
  /** The course's printed name (its signs; per seed). */
  name: string;
  holes: SkywaysGolfHole[];
  /** The front desk (its area and the desk's centre, world m). */
  desk: {area: number; x: number; z: number} | null;
}

/** The course's room names (gen/skyways/events/eventVenue.ts relabels the venue carve with them). */
export const GOLF_ROOM_NAMES = {
  hall: 'Mini-golf course', foyer: 'Course entrance', exhibitors: 'Clubhouse', registration: 'Front desk',
  panels: ['Party room A', 'Party room B'], lounge: 'Snack bar', backstage: 'Staff room', storage: 'Course storage',
} as const;
