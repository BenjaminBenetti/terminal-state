// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF): the MINI-GOLF course's record on layout.skyways.addon.golf
// (gen/skyways/events/golfDress.ts). Pure data. Owned by the golf lanes.

/** The hole designs (gen/skyways/events/golfCourse.ts): each course plays them in a seeded order, as many different ones as fit. */
export type GolfDesign = 'straight' | 'dogleg' | 'zigzag' | 'gate' | 'obstacle' | 'island' | 'tier' | 'hairpin' | 'plateau';

/** One hole of the course: its number, area, tee spot and cup (world m, absolute y = the green's top). */
export interface SkywaysGolfHole {
  n: number;
  area: number;
  par: number;
  tee: {x: number; y: number; z: number};
  cup: {x: number; y: number; z: number; r: number};
  /** (lane GOLF-COURSE) the hole's design, its turf tint (golfKinds.ts GOLF_TINTS index), the ball's line tee -> corners -> cup (world m). */
  design?: GolfDesign;
  tint?: number;
  path?: {x: number; z: number}[];
  /** (lane GOLF-COURSE) the ball standing on its tee (a layout.pickups index), the hole's tee sign / flag (layout.props indices). */
  ball?: number;
  sign?: number;
  flag?: number;
}

export interface SkywaysGolfRecord {
  /** The course's printed name (its signs; per seed). */
  name: string;
  holes: SkywaysGolfHole[];
  /** The front desk (its area and the desk's centre, world m). */
  desk: {area: number; x: number; z: number; putter?: number; balls?: number[]} | null;
}

/** The course's room names (gen/skyways/events/eventVenue.ts relabels the venue carve with them). */
export const GOLF_ROOM_NAMES = {
  hall: 'Mini-golf course', foyer: 'Course entrance', exhibitors: 'Clubhouse', registration: 'Front desk',
  panels: ['Party room A', 'Party room B'], lounge: 'Snack bar', backstage: 'Staff room', storage: 'Course storage',
} as const;

/** The course names (per seed: the signs, the scorecard, the record). Fictional. */
export const GOLF_COURSE_NAMES = [
  'Skyline Putt Club', 'Fairway Fun Mini Golf', 'Hole in Fun', 'Par-Tee Palace', 'Lucky Putt Links', 'Tiny Links Mini Golf',
  'Up & Down Putt Course', 'Birdie Bay Mini Golf', 'Rooftop Putt Hall', 'Putter Pines', 'Ace Alley Mini Golf', 'Greenlight Putt Club',
] as const;

/** (lane GOLF-COURSE) The birthday names on the party rooms' banners (fictional; the banner's variant). */
export const GOLF_PARTY_NAMES = ['MAYA', 'OWEN', 'PRIYA', 'LIAM', 'ZOE', 'NOAH', 'AVA', 'ELI'] as const;
