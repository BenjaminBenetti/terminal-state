// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EXPO): the TECHNOLOGY EXPO's record on layout.skyways.addon.expo
// (what gen/skyways/events/expoDress.ts placed: QA / tests / the runtime's screens) and its fictional content tables (the expo names,
// the exhibitors, the talk titles: every name is made up, no real brand). The canvas painters (world/skywaysExpoDraw.ts) draw their
// screens / signs from these tables by placement variant. Pure data. Owned by lane EXPO.

/** What the expo's dresser placed (layout.props indices are not stored: placements are found by kind / area). */
export interface SkywaysExpoRecord {
  /** The fictional expo's printed name (its signs / screens; per seed) and its index in EXPO_NAMES. */
  name: string;
  nameIdx: number;
  /** Exhibitor booths (one per booth: its area, a fictional exhibitor, its theme and its centre, world m). */
  booths: {area: number; name: string; exhibitor: number; theme: ExpoBoothTheme; x: number; z: number}[];
  /** The keynote stage (world m) and the demo theatres' areas. */
  keynote: {area: number; x: number; z: number} | null;
  theatres: number[];
}

/** The expo's room names (gen/skyways/events/eventVenue.ts relabels the venue carve with them). */
export const EXPO_ROOM_NAMES = {
  hall: 'Keynote hall', foyer: 'Keynote foyer', exhibitors: 'Expo floor', registration: 'Expo registration',
  panels: ['Demo theatre A', 'Demo theatre B'], lounge: 'Developer lounge', backstage: 'Exhibitor staff room', storage: 'Expo storage',
} as const;

/** The fictional expos (one per seed: the dresser's first draw). */
export const EXPO_NAMES: readonly {name: string; short: string; year: string; tag: string}[] = [
  {name: 'NORTHLIGHT TECH EXPO', short: 'NORTHLIGHT', year: '2026', tag: 'Build what comes next'},
  {name: 'PLUS FIFTEEN TECH SHOW', short: '+15 TECH', year: '2026', tag: 'Connected above the street'},
  {name: 'FUTUREGRID EXPO', short: 'FUTUREGRID', year: '2026', tag: 'Power. Data. People.'},
  {name: 'BOW VALLEY INNOVATION FAIR', short: 'BOW VALLEY', year: '2026', tag: 'Ideas from the foothills'},
  {name: 'BRIGHTWIRE TECH WEEK', short: 'BRIGHTWIRE', year: '2026', tag: 'Five days of demos'},
  {name: 'PRAIRIE SILICON SUMMIT', short: 'PRAIRIE SI', year: '2026', tag: 'Chips, code and coffee'},
];

/** What an exhibitor's booth shows (its fixtures: gen/skyways/events/expoDress.ts BOOTH_PLANS). */
export type ExpoBoothTheme = 'mobile' | 'display' | 'data' | 'retro' | 'games' | 'workstation' | 'showcase';
export const EXPO_THEMES: readonly ExpoBoothTheme[] = ['mobile', 'display', 'data', 'retro', 'games', 'workstation', 'showcase'];

/** The fictional exhibitors (variant of their booth wall / counter / hanging sign = the index here). Two per theme. */
export const EXPO_EXHIBITORS: readonly {name: string; tag: string; theme: ExpoBoothTheme; color: string; ink: string}[] = [
  {name: 'COPPERLEAF MOBILE', tag: 'Phones that last all week', theme: 'mobile', color: '#1f6f5c', ink: '#f4fff9'},
  {name: 'QUILLON LABS', tag: 'Tablets for the field', theme: 'mobile', color: '#3a3f9e', ink: '#f2f3ff'},
  {name: 'LANTERNFISH DISPLAYS', tag: 'Brighter panels, less power', theme: 'display', color: '#0d2b45', ink: '#7fe6ff'},
  {name: 'HALCYRA VISION', tag: 'Every pixel, true colour', theme: 'display', color: '#5a1f6e', ink: '#ffe9ff'},
  {name: 'STRATAVAULT CLOUD', tag: 'Racks you can trust', theme: 'data', color: '#22303c', ink: '#9bf2a8'},
  {name: 'TUNDRABYTE DATA', tag: 'Cold storage, warm support', theme: 'data', color: '#16465e', ink: '#e3f7ff'},
  {name: 'RETROBYTE ARCHIVE', tag: 'Computing history, hands on', theme: 'retro', color: '#6b4a1e', ink: '#ffd98a'},
  {name: 'GREENSCREEN SOCIETY', tag: 'Terminals of the eighties', theme: 'retro', color: '#1d3a1f', ink: '#7dff8c'},
  {name: 'FERNWAY GAMES', tag: 'Play the demo', theme: 'games', color: '#8a1f2b', ink: '#fff0d6'},
  {name: 'PIXELMOOR STUDIOS', tag: 'Indie worlds, big hearts', theme: 'games', color: '#c2551b', ink: '#fff6e8'},
  {name: 'KESTREL COMPUTE', tag: 'Workstations for makers', theme: 'workstation', color: '#2c2c34', ink: '#ffb547'},
  {name: 'OSTRANDER ROBOTICS', tag: 'Automation for small shops', theme: 'workstation', color: '#24506b', ink: '#ffffff'},
  {name: 'GLIMMERPINE WEARABLES', tag: 'Smart gear, quiet design', theme: 'showcase', color: '#4c5a2a', ink: '#f6ffe0'},
  {name: 'VOLTAIC WORKS', tag: 'Batteries for everything', theme: 'showcase', color: '#a0821c', ink: '#1d1a10'},
];

/** The demo theatres' talks (title slide per room / seed) and the keynote's (the LED wall's slides). */
export const EXPO_TALKS: readonly {title: string; who: string}[] = [
  {title: 'Shipping Firmware Without Fear', who: 'Quillon Labs'},
  {title: 'Cooling a Server Room at -30', who: 'Tundrabyte Data'},
  {title: 'Pixels per Watt: Display Myths', who: 'Lanternfish Displays'},
  {title: 'Restoring a 1983 Terminal', who: 'Retrobyte Archive'},
  {title: 'Small Robots, Big Payroll Savings', who: 'Ostrander Robotics'},
  {title: 'Designing a Game in 48 Hours', who: 'Fernway Games'},
];
/** The keynote's slides (LED wall variants: name index x EXPO_KEYNOTE_SLIDES + slide). */
export const EXPO_KEYNOTE_SLIDES = 3;
