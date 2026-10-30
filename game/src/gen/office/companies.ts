// Task office-overhaul-20261030 (lane TENANTS): the 20 fictional companies of the office tower's tenant pool — pure data.
//
// User: "each floor has a different company or maybe sometimes two floors have the same company … each company has a different
// feeling … some companies may have common room / lounge areas … plants and a reception … oh wow I'm at the bubblegum company now".
// Each company is a coherent, grounded identity: a name + tagline (the reception logo wall, the lobby directory, door plates and
// HUD area names "Pixelforge · Game lounge"), a palette + finish (lane ARCH paints its walls / carpet / trim from it), a signage
// style (plate colours + typeface), a FLOOR PROGRAM (which rooms its floors carve in gen/office/tower.ts and how each is dressed in
// gen/office/companyDress.ts: the trading floor's rows of trading desks, the law library's book stacks, the clinic's exam rooms,
// the game lounge's arcade cabinets …), its TWO signature props (assets/manifest.json D01-D40, one hero in its reception + repeats
// in its themed rooms), the supporting props it uses (E-codes) and a LOOT TILT inside the existing scarcity (the item MIX of its
// floor shifts — the clinic toward dressings, the café toward food and drink, the security firm toward ammo — never the totals).
// Abandonment stays: the dresser's decay, debris, dead plants, broken lights and the top floor's collapse are untouched.
//
// Room keys (ROOMS) are shared building blocks with default recipes; a company may override a room's recipe (`steps`).

import type {PropKind} from '../props';
import type {CompanyId, TenantFinish, TenantPalette} from './overhaulTypes';
import type {CompanyKind} from './companyKinds';

// ---------------------------------------------------------------------------------------------
// Rooms, open-plan styles, office runs

/** Inclusive count range. */
export type Range = readonly [number, number];
/** Which wall, relative to the room's main door (as gen/purposes.ts WallSel). */
export type WallPick = 'far' | 'side' | 'near' | 'any';

/**
 * Dressing step of a company room (executed by gen/office/companyDress.ts before the station dresser runs, through the shared
 * placement primitive: door zones, access strips, room connectivity; a step that cannot fit is skipped).
 */
export type Step =
  /** Back to a wall (`wall` relative to the main door). */
  | {at: 'wall'; kind: PropKind; n: Range; wall?: WallPick; front?: number; chance?: number}
  /** Side by side along one wall. */
  | {at: 'row'; kind: PropKind; n: Range; wall?: WallPick; front?: number; chance?: number}
  /** Free-standing rows across the room (desks, benches, treadmills, shelving); back-to-back pairs when `pair`. */
  | {at: 'rows'; kind: PropKind; n: Range; pair?: boolean; aisle?: number; chance?: number}
  /** Islands near the centre with a walkway ring. */
  | {at: 'island'; kind: PropKind; n: Range; ring?: number; chance?: number}
  /** Free-standing pieces scattered over open floor. */
  | {at: 'scatter'; kind: PropKind; n: Range; ring?: number; chance?: number}
  /** A seating group: a sofa with its back to a wall, armchairs facing it, a low table between. */
  | {at: 'seating'; sofa: PropKind; chair?: PropKind; table?: boolean; chance?: number}
  /** Against the facade (by the windows): placed after dress() released the window strip (postDress). */
  | {at: 'window'; kind: PropKind; n: Range; chance?: number}
  /** Planters in the room's corners (never in door zones). */
  | {at: 'corners'; kind: PropKind; n: Range; chance?: number}
  /** Pieces in front of the room's first `host` prop, turned toward it (studio cameras on the anchor desk). */
  | {at: 'facing'; kind: PropKind; host: PropKind; n: Range; dist: number; chance?: number};

/** Coarse role of a company room (gen/office/tower.ts OfficeAreaMeta.role: lighting, gear spots, signage). */
export type RoomRole = 'meeting' | 'break' | 'copy' | 'storage' | 'server' | 'exec' | 'reception' | 'security' | 'amenity';

export interface RoomInfo {
  label: string;
  /** gen/purposes.ts room purpose (loot table + theme + holder rules + lighting). */
  purpose: string;
  role: RoomRole;
  /** Band segment width range (cells, 0.5 m); end zones take the zone's size. */
  w: Range;
  /** Wide opening(s) onto the corridor instead of a door (lounges, showrooms). */
  open?: boolean;
  /** Door plate text (defaults to the label, upper case). */
  plate?: string;
  /** Default recipe (companies may override it). */
  steps: readonly Step[];
}

const SEATING: Step = {at: 'seating', sofa: 'lobbySofa', chair: 'loungeArmchair', table: true};

/** Room catalogue. Base office rooms keep the iteration-16 dressing (purpose rules / gen/office/dress.ts) unless steps are listed. */
export const ROOMS = {
  // --- base office rooms (every company may use them) --------------------------------------------------------------------------
  meeting: {label: 'Meeting room', purpose: 'office-meeting', role: 'meeting', w: [10, 14], steps: []},
  break: {label: 'Break room', purpose: 'office-break', role: 'break', w: [10, 13], steps: []},
  copy: {label: 'Copy & mail room', purpose: 'office-copy', role: 'copy', w: [7, 9], plate: 'COPY · MAIL', steps: []},
  storage: {label: 'Supply storage', purpose: 'office-storage', role: 'storage', w: [6, 8], steps: []},
  server: {label: 'Server room', purpose: 'office-server', role: 'server', w: [10, 13], plate: 'SERVER ROOM · AUTHORIZED ONLY', steps: []},
  exec: {label: 'Executive suite', purpose: 'office-exec', role: 'exec', w: [13, 17], steps: []},
  /**
   * Task office-interactions-layout-20261030 (lane LAYOUT): a small glass-walled meeting room carved out of a very long open-plan
   * area (gen/office/tower.ts huddles) or into a split end zone — a conference table and chairs (the meeting dressing).
   */
  huddle: {label: 'Huddle room', purpose: 'office-meeting', role: 'meeting', w: [10, 12], plate: 'HUDDLE ROOM', steps: []},
  // --- company rooms -----------------------------------------------------------------------------------------------------------
  /** The company's reception off the elevator lobby (first floor of every tenant): dressed by companyDress.reception. */
  reception: {label: 'Reception', purpose: 'office-tenant-reception', role: 'reception', w: [14, 18], open: true, steps: []},
  lounge: {label: 'Staff lounge', purpose: 'office-lounge', role: 'break', w: [12, 16], open: true, steps: [
    SEATING, {at: 'scatter', kind: 'beanBag', n: [1, 3], ring: 0.6}, {at: 'wall', kind: 'officeWaterCooler', n: [0, 1], front: 0.7},
    {at: 'island', kind: 'foosballTable', n: [0, 1], ring: 0.9, chance: 0.6}, {at: 'corners', kind: 'planterTree', n: [1, 2]}]},
  gameroom: {label: 'Game lounge', purpose: 'office-gameroom', role: 'break', w: [14, 18], open: true, steps: []},
  gym: {label: 'Staff gym', purpose: 'office-gym', role: 'amenity', w: [14, 18], steps: []},
  showroom: {label: 'Showroom', purpose: 'office-showroom', role: 'amenity', w: [14, 18], open: true, steps: []},
  lab: {label: 'Laboratory', purpose: 'office-lab', role: 'amenity', w: [14, 18], steps: []},
  coldroom: {label: 'Biohazard cold storage', purpose: 'office-coldroom', role: 'storage', w: [9, 12], plate: 'BIOHAZARD · SAMPLE QUARANTINE', steps: []},
  library: {label: 'Law library', purpose: 'office-library', role: 'meeting', w: [14, 18], steps: []},
  boardroom: {label: 'Boardroom', purpose: 'office-boardroom', role: 'meeting', w: [13, 16], steps: [
    {at: 'island', kind: 'conferenceTable', n: [1, 2], ring: 0.6}, {at: 'wall', kind: 'globeBar', n: [0, 1], front: 0.5},
    {at: 'row', kind: 'officeShelf', n: [1, 2], wall: 'near', front: 0.6}, {at: 'corners', kind: 'planterTree', n: [0, 1]}]},
  archive: {label: 'Records archive', purpose: 'office-archive', role: 'storage', w: [12, 16], steps: []},
  vault: {label: 'Vault room', purpose: 'office-vault', role: 'storage', w: [9, 12], plate: 'VAULT · AUTHORIZED ONLY', steps: []},
  kitchen: {label: 'Test kitchen', purpose: 'office-kitchen', role: 'amenity', w: [12, 16], steps: []},
  cafe: {label: 'Coffee bar', purpose: 'office-cafe', role: 'break', w: [12, 16], open: true, steps: []},
  roastery: {label: 'Roastery', purpose: 'office-roastery', role: 'amenity', w: [12, 16], steps: []},
  dispensary: {label: 'Dispensary', purpose: 'office-dispensary', role: 'storage', w: [9, 12], steps: []},
  waiting: {label: 'Waiting room', purpose: 'office-waiting', role: 'break', w: [12, 16], open: true, steps: []},
  recording: {label: 'Recording studio', purpose: 'office-recording', role: 'amenity', w: [12, 16], steps: []},
  listening: {label: 'Listening lounge', purpose: 'office-listening', role: 'break', w: [12, 16], steps: []},
  studio: {label: 'Broadcast studio', purpose: 'office-studio', role: 'amenity', w: [14, 18], plate: 'STUDIO · ON AIR', steps: []},
  gallery: {label: 'Production gallery', purpose: 'office-gallery', role: 'amenity', w: [10, 14], steps: []},
  control: {label: 'Control room', purpose: 'office-control', role: 'security', w: [12, 16], plate: 'CONTROL ROOM · AUTHORIZED ONLY', steps: []},
  armory: {label: 'Equipment room', purpose: 'office-armory', role: 'storage', w: [9, 12], plate: 'EQUIPMENT · KEY HOLDERS ONLY', steps: []},
  mailroom: {label: 'Parcel room', purpose: 'office-mailroom', role: 'storage', w: [12, 16], steps: []},
  naproom: {label: 'Nap room', purpose: 'office-naproom', role: 'break', w: [10, 14], steps: []},
  playtest: {label: 'Play-test room', purpose: 'office-playtest', role: 'break', w: [12, 16], steps: []},
  workshop: {label: 'Prototype workshop', purpose: 'office-workshop', role: 'amenity', w: [12, 16], steps: []},
  modelroom: {label: 'Model room', purpose: 'office-modelroom', role: 'amenity', w: [12, 16], steps: []},
  mission: {label: 'Mission room', purpose: 'office-mission', role: 'meeting', w: [14, 18], steps: []},
  observatory: {label: 'Observation room', purpose: 'office-observatory', role: 'amenity', w: [12, 16], steps: []},
  tasting: {label: 'Tasting lounge', purpose: 'office-tasting', role: 'break', w: [12, 16], open: true, steps: []},
  petlounge: {label: 'Pet lounge', purpose: 'office-petlounge', role: 'break', w: [12, 16], steps: []},
  bakery: {label: 'Bakery counter', purpose: 'office-bakery', role: 'break', w: [12, 16], open: true, steps: []},
  qa: {label: 'QA lab', purpose: 'office-qa', role: 'amenity', w: [12, 16], steps: []},
} as const satisfies Record<string, RoomInfo>;
export type RoomKey = keyof typeof ROOMS;
/** Rooms the iteration-16 office dressing already handles (meeting tables, break kitchenettes, copy, storage). */
export const BASE_ROOMS: ReadonlySet<RoomKey> = new Set(['meeting', 'break', 'copy', 'storage', 'server', 'exec', 'huddle']);

/** Open-plan styles (what an open area of a company floor becomes). */
export const OPEN_STYLES = {
  cubicles: {label: 'Open-plan office', purpose: 'office-open'},
  pods: {label: 'Open studio', purpose: 'office-open'},
  trading: {label: 'Trading floor', purpose: 'office-trading'},
  benches: {label: 'Lab floor', purpose: 'office-labfloor'},
  drafting: {label: 'Drafting studio', purpose: 'office-drafting'},
  newsroom: {label: 'Newsroom', purpose: 'office-open'},
  dispatch: {label: 'Dispatch floor', purpose: 'office-dispatch'},
  atelier: {label: 'Atelier', purpose: 'office-atelier'},
  showroom: {label: 'Showroom floor', purpose: 'office-showroom'},
} as const satisfies Record<string, {label: string; purpose: string}>;
export type OpenStyle = keyof typeof OPEN_STYLES;

/** Small rooms of a private-office run along the facade (run = rooms + an admin bay toward the corridor). */
export const RUNS = {
  private: {label: 'Private office', purpose: 'office-private', bay: 'Admin bay'},
  partner: {label: "Attorney's office", purpose: 'office-private', bay: 'Paralegal bay'},
  exam: {label: 'Exam room', purpose: 'office-exam', bay: "Nurses' station"},
  booth: {label: 'Production suite', purpose: 'office-booth', bay: 'Studio hallway'},
} as const satisfies Record<string, {label: string; purpose: string; bay: string}>;
export type RunKind = keyof typeof RUNS;

// ---------------------------------------------------------------------------------------------
// Companies

export type LootTilt = 'medical' | 'food' | 'ammo' | 'light' | 'none';
export type SignFont = 'sans' | 'serif' | 'mono' | 'rounded' | 'condensed';

export interface CompanyProgram {
  /** Open-plan styles: [the first open area of each floor, the others]. */
  open: readonly [OpenStyle, OpenStyle];
  /** Themed band rooms of its reception floor and of its second floor (when it takes two). */
  rooms: readonly [readonly RoomKey[], readonly RoomKey[]];
  /** The two end-zone rooms beside the core: reception floor, second floor. */
  ends: readonly [readonly [RoomKey, RoomKey], readonly [RoomKey, RoomKey]];
  /** Private-office runs per floor and what their small rooms are. */
  runs: number;
  run: RunKind;
  /** An executive suite on the company's top floor (floor 8 always has one). */
  exec: boolean;
  /** Company-specific recipes of its rooms (override ROOMS[key].steps), and of its reception (extra pieces). */
  steps: Partial<Record<RoomKey | OpenStyle | RunKind, readonly Step[]>>;
  /** Room label overrides ("Crit room"). */
  labels?: Partial<Record<RoomKey | OpenStyle, string>>;
}

export interface Company {
  id: CompanyId;
  /** Display name on the logo wall / directory ("Bubblr Gum Co."). */
  name: string;
  /** Short name for HUD area labels and door plates ("Bubblr"). */
  short: string;
  tagline: string;
  palette: TenantPalette;
  finish: TenantFinish;
  font: SignFont;
  /** The two signature props (manifest D-codes) and which one greets you in the reception. */
  signature: readonly [CompanyKind, CompanyKind];
  hero: CompanyKind;
  /** Supporting props (E-codes) its rooms use. */
  support: readonly CompanyKind[];
  program: CompanyProgram;
  loot: LootTilt;
  /** Who they were (QA / docs). */
  note: string;
}

const W = (kind: PropKind, n: Range, o: {wall?: WallPick; front?: number; chance?: number} = {}): Step => ({at: 'wall', kind, n, ...o});
const ROW = (kind: PropKind, n: Range, o: {wall?: WallPick; front?: number; chance?: number} = {}): Step => ({at: 'row', kind, n, ...o});
const ROWS = (kind: PropKind, n: Range, o: {pair?: boolean; aisle?: number; chance?: number} = {}): Step => ({at: 'rows', kind, n, ...o});
const ISLE = (kind: PropKind, n: Range, ring = 0.8, chance?: number): Step => ({at: 'island', kind, n, ring, ...(chance !== undefined ? {chance} : {})});
const SCAT = (kind: PropKind, n: Range, ring = 0.6, chance?: number): Step => ({at: 'scatter', kind, n, ring, ...(chance !== undefined ? {chance} : {})});
const WIN = (kind: PropKind, n: Range): Step => ({at: 'window', kind, n});
const CORNERS = (kind: PropKind, n: Range): Step => ({at: 'corners', kind, n});

export const COMPANIES: Readonly<Record<CompanyId, Company>> = {
  bubblr: {
    id: 'bubblr', name: 'Bubblr Gum Co.', short: 'Bubblr', tagline: 'Confectionery · Brand HQ',
    palette: {wall: 0xf3dbe3, accent: 0xe0559a, floor: 0xc99db4, trim: 0xf7eef2, sign: 0xffffff}, finish: 'creative', font: 'rounded',
    signature: ['gumballMachine', 'gumballJar'], hero: 'gumballMachine', support: ['beanBag', 'loungeArmchair', 'lobbySofa', 'pottedPlantSmall'],
    program: {
      open: ['pods', 'cubicles'], rooms: [['tasting', 'meeting'], ['kitchen', 'lounge']], ends: [['break', 'storage'], ['storage', 'copy']],
      runs: 0, run: 'private', exec: false, labels: {kitchen: 'Flavour kitchen', pods: 'Marketing studio'},
      steps: {
        reception: [W('gumballMachine', [1, 1], {wall: 'near', front: 0.6}), SCAT('gumballJar', [2, 3], 0.5)],
        tasting: [ROW('gumballMachine', [2, 3], {wall: 'far', front: 0.7}), SCAT('gumballJar', [3, 5], 0.5), SEATING, SCAT('beanBag', [1, 2], 0.6)],
        kitchen: [W('kitchenette', [1, 1], {wall: 'far', front: 0.9}), W('fridge', [1, 1], {front: 0.6}), ISLE('table', [1, 1], 0.9), SCAT('gumballJar', [2, 3], 0.5), W('gumballMachine', [0, 1], {front: 0.6})],
        lounge: [SEATING, SCAT('beanBag', [2, 3], 0.6), W('gumballMachine', [1, 1], {front: 0.6}), CORNERS('planterTree', [1, 1])],
      },
    },
    loot: 'food', note: 'Bubblegum maker: candy-pink reception, gumball machines and sample jars everywhere, a tasting lounge and a flavour kitchen.',
  },
  pixelforge: {
    id: 'pixelforge', name: 'Pixelforge Games', short: 'Pixelforge', tagline: 'Interactive Entertainment · Studio 2',
    palette: {wall: 0x3a3f52, accent: 0x7b3cff, floor: 0x2e3340, trim: 0x15171c, sign: 0x39f0ff}, finish: 'creative', font: 'mono',
    signature: ['arcadeCabinet', 'consoleStation'], hero: 'arcadeCabinet', support: ['foosballTable', 'pingPongTable', 'beanBag', 'lobbySofa'],
    program: {
      open: ['pods', 'pods'], rooms: [['gameroom', 'meeting'], ['qa', 'lounge']], ends: [['server', 'break'], ['server', 'storage']],
      runs: 0, run: 'private', exec: false, labels: {pods: 'Dev pods', meeting: 'Sprint room'},
      steps: {
        reception: [W('arcadeCabinet', [1, 1], {front: 0.8}), SCAT('beanBag', [1, 2], 0.6)],
        gameroom: [ROW('arcadeCabinet', [2, 4], {wall: 'far', front: 0.9}), W('consoleStation', [1, 1], {wall: 'side', front: 1.2}), ISLE('foosballTable', [1, 1], 0.9),
          ISLE('pingPongTable', [0, 1], 0.9, 0.6), SCAT('beanBag', [2, 4], 0.6)],
        qa: [ROW('consoleStation', [2, 3], {wall: 'far', front: 1.2}), ROWS('desk', [2, 4]), SCAT('beanBag', [1, 2], 0.6), W('arcadeCabinet', [0, 1], {front: 0.8})],
        lounge: [SEATING, W('consoleStation', [1, 1], {front: 1.2}), SCAT('beanBag', [2, 3], 0.6), ISLE('pingPongTable', [0, 1], 0.9, 0.5)],
      },
    },
    loot: 'food', note: 'Game studio: dark walls and neon trim, dev pods, a game lounge with arcade cabinets, a console station, foosball and bean bags.',
  },
  halden: {
    id: 'halden', name: 'Halden & Rowe LLP', short: 'Halden & Rowe', tagline: 'Attorneys at Law · Est. 1938',
    palette: {wall: 0xe8dfcc, accent: 0x6e1f2a, floor: 0x2f4a3a, trim: 0x4a2e1e, sign: 0xd4af37}, finish: 'warm-wood', font: 'serif',
    signature: ['lawBookcase', 'justiceStatue'], hero: 'justiceStatue', support: ['chesterfieldSofa', 'executiveDesk', 'executiveChair', 'globeBar', 'loungeArmchair'],
    program: {
      open: ['cubicles', 'cubicles'], rooms: [['library', 'boardroom'], ['library', 'meeting']], ends: [['meeting', 'storage'], ['copy', 'break']],
      runs: 2, run: 'partner', exec: true, labels: {cubicles: 'Paralegal pool', meeting: 'Deposition room'},
      steps: {
        reception: [ROW('lawBookcase', [1, 2], {wall: 'side', front: 0.7})],
        library: [ROWS('lawBookcase', [3, 6], {pair: true, aisle: 1.4}), ROW('lawBookcase', [2, 4], {wall: 'far', front: 0.8}), W('chesterfieldSofa', [0, 1], {front: 0.8}),
          ISLE('conferenceTable', [0, 1], 0.7, 0.6), W('justiceStatue', [0, 1], {front: 0.6})],
        boardroom: [ISLE('conferenceTable', [1, 2], 0.6), ROW('lawBookcase', [2, 3], {wall: 'near', front: 0.6}), W('globeBar', [0, 1], {front: 0.5})],
        partner: [W('lawBookcase', [1, 1], {wall: 'side', front: 0.6})],
      },
    },
    loot: 'none', note: 'Old law firm: dark wood, oxblood and gold, Lady Justice in reception, a law library of leather-bound stacks, partners\' offices.',
  },
  crestmark: {
    id: 'crestmark', name: 'Crestmark Capital', short: 'Crestmark', tagline: 'Investment Banking · Global Markets',
    palette: {wall: 0xc9ccd1, accent: 0x1d2c4f, floor: 0x3b4252, trim: 0x9aa3ad, sign: 0xe8c66a}, finish: 'corporate', font: 'condensed',
    signature: ['tradingDesk', 'bullStatue'], hero: 'bullStatue', support: ['executiveDesk', 'executiveChair', 'chesterfieldSofa', 'globeBar', 'lobbySofa'],
    program: {
      open: ['trading', 'cubicles'], rooms: [['boardroom'], ['meeting', 'boardroom']], ends: [['server', 'break'], ['server', 'meeting']],
      runs: 1, run: 'private', exec: true, labels: {cubicles: 'Analyst floor'},
      steps: {
        reception: [],
        trading: [ROWS('tradingDesk', [8, 14], {aisle: 1.6})],
      },
    },
    loot: 'none', note: 'Investment bank: navy and chrome, the charging bull in reception, a trading floor of six-screen desks, boardroom and corner suite.',
  },
  verdant: {
    id: 'verdant', name: 'Verdant Biosciences', short: 'Verdant', tagline: 'Genomics · Clinical Research',
    palette: {wall: 0xf1f4f2, accent: 0x2fa36b, floor: 0xb9c2bf, trim: 0xdfe6e3, sign: 0x2fa36b}, finish: 'clinical', font: 'sans',
    signature: ['labBench', 'biohazardFridge'], hero: 'biohazardFridge', support: ['pottedPlantSmall', 'loungeArmchair'],
    program: {
      open: ['benches', 'cubicles'], rooms: [['lab'], ['lab', 'meeting']], ends: [['coldroom', 'storage'], ['coldroom', 'break']],
      runs: 0, run: 'private', exec: false, labels: {meeting: 'Clean meeting room'},
      steps: {
        reception: [],
        lab: [ROWS('labBench', [4, 8], {pair: true, aisle: 1.3}), ROW('biohazardFridge', [1, 2], {wall: 'far', front: 0.8}), W('medCabinet', [1, 1], {front: 0.7}), W('cabinetTall', [0, 1], {front: 0.8})],
        coldroom: [ROW('biohazardFridge', [3, 5], {wall: 'far', front: 0.8}), ROW('biohazardFridge', [1, 3], {wall: 'side', front: 0.8}), W('crate', [0, 1]), W('ivPole', [0, 1], {front: 0.5})],
        benches: [ROWS('labBench', [4, 8], {pair: true, aisle: 1.3}), ROW('biohazardFridge', [1, 2], {wall: 'any', front: 0.8})],
      },
    },
    loot: 'medical', note: 'Biotech: clinical white and green, lab benches of green-stained flasks, a sealed biohazard cold store (the green fog started somewhere).',
  },
  arcline: {
    id: 'arcline', name: 'Arcline Architects', short: 'Arcline', tagline: 'Architecture · Urban Design',
    palette: {wall: 0xeceae6, accent: 0xe0662f, floor: 0xb59a74, trim: 0x1e1e1e, sign: 0x1e1e1e}, finish: 'industrial', font: 'condensed',
    signature: ['architectModel', 'draftingTable'], hero: 'architectModel', support: ['loungeArmchair', 'planterTree'],
    program: {
      open: ['drafting', 'pods'], rooms: [['modelroom', 'meeting'], ['modelroom', 'copy']], ends: [['copy', 'break'], ['storage', 'break']],
      runs: 0, run: 'private', exec: false, labels: {meeting: 'Crit room', copy: 'Plot room'},
      steps: {
        reception: [],
        drafting: [ROWS('draftingTable', [6, 12], {aisle: 1.3})],
        modelroom: [ISLE('architectModel', [2, 3], 0.8), ROW('officeShelf', [1, 2], {wall: 'far', front: 0.6}), W('cartonStack', [0, 1]), W('crate', [0, 1])],
        meeting: [W('architectModel', [0, 1], {front: 0.6})],
      },
    },
    loot: 'light', note: 'Architecture studio: white walls and oak, rows of drafting tables, foam city models in reception and the model room.',
  },
  metro9: {
    id: 'metro9', name: 'Metro9 News', short: 'Metro9', tagline: 'Live · Local · 24/7',
    palette: {wall: 0xd6dbe3, accent: 0xd2232a, floor: 0x2c3440, trim: 0x1a1f28, sign: 0xffffff}, finish: 'corporate', font: 'condensed',
    signature: ['tvCamera', 'newsDesk'], hero: 'tvCamera', support: ['lobbySofa', 'loungeArmchair'],
    program: {
      open: ['newsroom', 'cubicles'], rooms: [['studio', 'meeting'], ['studio', 'gallery']], ends: [['server', 'break'], ['server', 'storage']],
      runs: 0, run: 'private', exec: false, labels: {meeting: 'Editorial room'},
      steps: {
        reception: [W('newsDesk', [0, 1], {wall: 'side', front: 1.0})],
        studio: [W('newsDesk', [1, 1], {wall: 'side', front: 0.4}), {at: 'facing', kind: 'tvCamera', host: 'newsDesk', n: [2, 3], dist: 1.6}, SCAT('tvCamera', [0, 1], 0.6), W('crtTvCart', [0, 1], {front: 0.7})],
        gallery: [ROW('monitorDesk', [2, 3], {wall: 'far', front: 1.0}), W('crtTvCart', [1, 1], {front: 0.7}), W('tvCamera', [0, 1], {front: 0.6})],
        newsroom: [W('tvCamera', [1, 1], {front: 0.6}), W('crtTvCart', [0, 1], {front: 0.7})],
      },
    },
    loot: 'none', note: 'Local TV news: red and slate, a newsroom of desk pods, a broadcast studio with the anchor desk and studio cameras.',
  },
  ember: {
    id: 'ember', name: 'Ember Coffee Roasters', short: 'Ember', tagline: 'Roastery · Head Office',
    palette: {wall: 0xd9c3a5, accent: 0xb5652b, floor: 0x5a3d2b, trim: 0x231a14, sign: 0xf2e3c6}, finish: 'warm-wood', font: 'serif',
    signature: ['espressoMachine', 'coffeeRoaster'], hero: 'espressoMachine', support: ['loungeArmchair', 'lobbySofa', 'pottedPlantSmall'],
    program: {
      open: ['pods', 'cubicles'], rooms: [['cafe', 'meeting'], ['roastery', 'cafe']], ends: [['roastery', 'storage'], ['storage', 'break']],
      runs: 0, run: 'private', exec: false, labels: {meeting: 'Cupping room'},
      steps: {
        reception: [ISLE('table', [0, 1], 0.8)],
        cafe: [ROW('espressoMachine', [1, 2], {wall: 'far', front: 1.0}), W('fridge', [1, 1], {front: 0.6}), ISLE('table', [2, 3], 0.8), W('couch', [0, 1], {front: 0.7}), SCAT('loungeArmchair', [1, 2], 0.5)],
        roastery: [ISLE('coffeeRoaster', [1, 2], 0.9), ROW('cartonStack', [1, 3], {wall: 'any'}), W('shelf', [1, 1], {front: 0.8}), W('crate', [0, 2]), W('espressoMachine', [0, 1], {front: 0.9})],
        meeting: [W('espressoMachine', [0, 1], {front: 0.9})],
      },
    },
    loot: 'food', note: 'Coffee roaster: brick, copper and dark wood, an espresso bar in reception, a coffee bar and a drum roaster among burlap sacks.',
  },
  stride: {
    id: 'stride', name: 'Stride Athletics', short: 'Stride', tagline: 'Performance Footwear',
    palette: {wall: 0xe6e6e6, accent: 0xd9e021, floor: 0x2a2a2a, trim: 0x111111, sign: 0x111111}, finish: 'industrial', font: 'condensed',
    signature: ['treadmill', 'sneakerWall'], hero: 'sneakerWall', support: ['loungeArmchair', 'beanBag'],
    program: {
      open: ['showroom', 'pods'], rooms: [['gym', 'meeting'], ['gym', 'lounge']], ends: [['break', 'storage'], ['storage', 'copy']],
      runs: 0, run: 'private', exec: false, labels: {gym: 'Gait lab & gym', pods: 'Design studio'},
      steps: {
        reception: [W('sneakerWall', [1, 1], {front: 0.8})],
        showroom: [ROW('sneakerWall', [2, 4], {wall: 'far', front: 1.0}), ISLE('treadmill', [1, 1], 0.8), ROW('sneakerWall', [1, 3], {wall: 'side', front: 1.0}), ISLE('bench', [1, 2], 0.8)],
        gym: [ROWS('treadmill', [3, 6], {aisle: 1.1}), ROW('staffLockers', [1, 2], {wall: 'near', front: 0.8}), W('bench', [0, 1], {front: 0.6}), W('officeWaterCooler', [0, 1], {front: 0.6})],
        lounge: [SEATING, W('sneakerWall', [1, 1], {front: 0.8})],
      },
    },
    loot: 'medical', note: 'Running-shoe brand: black and neon yellow, sneaker walls in the showroom, a gym of treadmills for gait testing.',
  },
  wonderbox: {
    id: 'wonderbox', name: 'Wonderbox Toys', short: 'Wonderbox', tagline: 'Toys & Games · Design Studio',
    palette: {wall: 0xd9ecf7, accent: 0xe8412c, floor: 0x6c8fc4, trim: 0xf2c230, sign: 0xffffff}, finish: 'creative', font: 'rounded',
    signature: ['giantTeddy', 'rockingHorse'], hero: 'giantTeddy', support: ['beanBag', 'loungeArmchair'],
    program: {
      open: ['pods', 'cubicles'], rooms: [['playtest', 'showroom'], ['workshop', 'playtest']], ends: [['storage', 'break'], ['storage', 'copy']],
      runs: 0, run: 'private', exec: false, labels: {showroom: 'Toy showroom'},
      steps: {
        reception: [SCAT('rockingHorse', [1, 1], 0.6)],
        playtest: [SCAT('giantTeddy', [1, 2], 0.6), SCAT('rockingHorse', [2, 3], 0.6), SCAT('beanBag', [2, 3], 0.5), ISLE('table', [1, 1], 0.8)],
        showroom: [ROWS('rockingHorse', [3, 6], {aisle: 1.2}), W('giantTeddy', [1, 2], {front: 0.6}), ROW('shelf', [1, 2], {wall: 'far', front: 0.8}), W('cartonStack', [0, 1])],
        workshop: [ISLE('table', [1, 2], 0.8), ROW('shelf', [1, 2], {wall: 'far', front: 0.8}), W('crate', [1, 2]), SCAT('rockingHorse', [1, 1], 0.6), W('cartonStack', [0, 1])],
      },
    },
    loot: 'food', note: 'Toy maker: sky blue, red and yellow, a giant teddy greeting visitors, rocking horses in the play-test room and toy showroom.',
  },
  lowtide: {
    id: 'lowtide', name: 'Lowtide Records', short: 'Lowtide', tagline: 'Independent Music Label',
    palette: {wall: 0x2f4f55, accent: 0xe58a3a, floor: 0x3a2f2a, trim: 0x1a1a1a, sign: 0xf4c27a}, finish: 'creative', font: 'rounded',
    signature: ['jukebox', 'mixingConsole'], hero: 'jukebox', support: ['lobbySofa', 'loungeArmchair', 'beanBag'],
    program: {
      open: ['pods', 'cubicles'], rooms: [['listening', 'recording'], ['recording', 'lounge']], ends: [['storage', 'break'], ['storage', 'break']],
      runs: 1, run: 'booth', exec: false, labels: {pods: 'A&R desks'},
      steps: {
        reception: [],
        listening: [ROW('jukebox', [1, 2], {wall: 'far', front: 0.9}), SEATING, SCAT('beanBag', [1, 2], 0.6), CORNERS('planterTree', [0, 1])],
        recording: [ISLE('mixingConsole', [1, 1], 0.9), W('jukebox', [0, 1], {front: 0.8}), W('couch', [1, 1], {wall: 'near', front: 0.8}), ROW('officeShelf', [1, 1], {wall: 'side', front: 0.6})],
        booth: [W('mixingConsole', [1, 1], {wall: 'far', front: 0.9}), W('couch', [0, 1], {front: 0.7})],
        lounge: [SEATING, W('jukebox', [1, 1], {front: 0.8}), SCAT('beanBag', [1, 2], 0.6)],
      },
    },
    loot: 'food', note: 'Indie label: deep teal and orange, a jukebox in reception, a listening lounge, a recording studio and production suites.',
  },
  calloway: {
    id: 'calloway', name: 'Calloway Family Clinic', short: 'Calloway Clinic', tagline: 'Primary Care · Walk-ins Welcome',
    palette: {wall: 0xdcefe7, accent: 0x2a8c82, floor: 0xc3cfcb, trim: 0xffffff, sign: 0x1d5c56}, finish: 'clinical', font: 'sans',
    signature: ['examTable', 'vitalsMonitor'], hero: 'vitalsMonitor', support: ['lobbySofa', 'pottedPlantSmall'],
    program: {
      open: ['cubicles', 'cubicles'], rooms: [['waiting'], ['dispensary', 'meeting']], ends: [['dispensary', 'storage'], ['storage', 'break']],
      runs: 2, run: 'exam', exec: false, labels: {cubicles: 'Records & billing', meeting: 'Staff room'},
      steps: {
        reception: [ROW('plasticStackChair', [3, 5], {wall: 'side'}), W('officeWaterCooler', [0, 1], {front: 0.6})],
        waiting: [ROW('plasticStackChair', [4, 6], {wall: 'far'}), ROW('plasticStackChair', [2, 4], {wall: 'side'}), W('lobbySofa', [1, 1], {front: 0.8}), W('vitalsMonitor', [0, 1], {front: 0.5}), W('officeWaterCooler', [0, 1], {front: 0.6})],
        exam: [W('examTable', [1, 1], {wall: 'far', front: 0.7}), W('vitalsMonitor', [1, 1], {front: 0.5}), W('medCabinet', [0, 1], {front: 0.7}), W('ivPole', [0, 1], {front: 0.4})],
        dispensary: [ROW('medCabinet', [2, 3], {wall: 'far', front: 0.7}), W('shelf', [1, 1], {front: 0.8}), W('fridge', [0, 1], {front: 0.6}), W('vitalsMonitor', [0, 1], {front: 0.5})],
        meeting: [W('examTable', [0, 1], {front: 0.7})],
      },
    },
    loot: 'medical', note: 'Walk-in clinic: mint and teal, a waiting room of plastic chairs, exam rooms with exam tables and vitals monitors, a dispensary.',
  },
  ardent: {
    id: 'ardent', name: 'Ardent Atelier', short: 'Ardent', tagline: 'Fashion House · Couture',
    palette: {wall: 0xead6d0, accent: 0x1b1b1b, floor: 0xcfc9c4, trim: 0xc9a96e, sign: 0x1b1b1b}, finish: 'luxury', font: 'serif',
    signature: ['dressForm', 'clothingRack'], hero: 'dressForm', support: ['loungeArmchair', 'chesterfieldSofa', 'planterTree', 'executiveDesk', 'executiveChair', 'globeBar'],
    program: {
      open: ['atelier', 'pods'], rooms: [['showroom', 'meeting'], ['showroom', 'lounge']], ends: [['storage', 'break'], ['storage', 'copy']],
      runs: 0, run: 'private', exec: true, labels: {storage: 'Fabric store', meeting: 'Fitting room'},
      steps: {
        reception: [SCAT('dressForm', [1, 1], 0.6), W('clothingRack', [0, 1], {front: 0.7})],
        atelier: [ISLE('table', [2, 3], 0.8), SCAT('dressForm', [3, 6], 0.5), ROWS('clothingRack', [2, 4], {aisle: 1.2})],
        showroom: [ROWS('clothingRack', [3, 6], {aisle: 1.3}), SCAT('dressForm', [2, 3], 0.6), W('loungeArmchair', [1, 2], {front: 0.6}), CORNERS('planterTree', [0, 1])],
        lounge: [SEATING, W('clothingRack', [1, 1], {front: 0.7})],
        meeting: [SCAT('dressForm', [1, 2], 0.6)],
      },
    },
    loot: 'none', note: 'Couture house: blush, black and gold, dress forms draped in half-sewn gowns, an atelier of cutting tables and a showroom of racks.',
  },
  tidewater: {
    id: 'tidewater', name: 'Tidewater Logistics', short: 'Tidewater', tagline: 'Freight · Shipping · Customs',
    palette: {wall: 0xd3d9de, accent: 0x1f5f7a, floor: 0x46505a, trim: 0xf28c28, sign: 0xffffff}, finish: 'industrial', font: 'condensed',
    signature: ['shipModel', 'parcelPallet'], hero: 'shipModel', support: ['executiveDesk', 'executiveChair', 'chesterfieldSofa', 'globeBar'],
    program: {
      open: ['dispatch', 'cubicles'], rooms: [['mailroom', 'meeting'], ['mailroom', 'boardroom']], ends: [['server', 'storage'], ['server', 'break']],
      runs: 0, run: 'private', exec: true, labels: {meeting: 'Customs office'},
      steps: {
        reception: [W('parcelPallet', [0, 1])],
        dispatch: [ROWS('desk', [6, 10], {aisle: 1.5}), ROW('parcelPallet', [2, 3], {wall: 'any'})],
        mailroom: [ROWS('parcelPallet', [3, 6], {aisle: 1.3}), ROW('shelf', [1, 2], {wall: 'far', front: 0.8}), W('crate', [1, 2]), W('cartonStack', [0, 1])],
        boardroom: [ISLE('conferenceTable', [1, 1], 0.6), W('shipModel', [1, 1], {front: 0.6})],
      },
    },
    loot: 'light', note: 'Freight forwarder: steel blue and safety orange, a ship model in reception, a dispatch floor and parcel room stacked with pallets.',
  },
  nimbus: {
    id: 'nimbus', name: 'Nimbus Labs', short: 'Nimbus', tagline: 'Cloud Software · Series B',
    palette: {wall: 0xf0f0f5, accent: 0x3d8bfd, floor: 0x8a94a6, trim: 0xffffff, sign: 0x3d8bfd}, finish: 'creative', font: 'rounded',
    signature: ['napPod', 'kegerator'], hero: 'napPod', support: ['pingPongTable', 'foosballTable', 'beanBag', 'lobbySofa', 'pottedPlantSmall'],
    program: {
      open: ['pods', 'pods'], rooms: [['lounge', 'naproom'], ['naproom', 'meeting']], ends: [['server', 'break'], ['server', 'storage']],
      runs: 0, run: 'private', exec: false, labels: {pods: 'Hot desks', lounge: 'Social hub'},
      steps: {
        reception: [SCAT('beanBag', [1, 2], 0.6)],
        lounge: [W('kegerator', [1, 2], {wall: 'far', front: 0.8}), ISLE('pingPongTable', [1, 1], 0.9), SCAT('beanBag', [2, 4], 0.6), W('lobbySofa', [0, 1], {front: 0.7})],
        naproom: [ROW('napPod', [2, 4], {wall: 'far', front: 0.6}), ROW('napPod', [0, 2], {wall: 'side', front: 0.6}), SCAT('beanBag', [0, 1], 0.5)],
        meeting: [W('kegerator', [0, 1], {front: 0.8})],
      },
    },
    loot: 'food', note: 'Start-up: white and sky blue, hot desks, a sleep pod showcased in reception, a social hub with the kegerator and ping-pong, and a nap room of sleep pods.',
  },
  ironclad: {
    id: 'ironclad', name: 'Ironclad Security', short: 'Ironclad', tagline: 'Guarding · Alarm Response',
    palette: {wall: 0xbfc3c7, accent: 0x3f4a3a, floor: 0x33373b, trim: 0xb8860b, sign: 0xf2c94c}, finish: 'industrial', font: 'condensed',
    signature: ['cctvConsole', 'metalDetector'], hero: 'metalDetector', support: ['securityTurnstile'],
    program: {
      open: ['cubicles', 'pods'], rooms: [['control'], ['control', 'meeting']], ends: [['armory', 'storage'], ['armory', 'break']],
      runs: 0, run: 'private', exec: false, labels: {meeting: 'Briefing room', pods: 'Dispatch desks'},
      steps: {
        reception: [ROW('securityTurnstile', [2, 3], {wall: 'side'}), W('cctvConsole', [0, 1], {front: 0.9})],
        control: [ROW('cctvConsole', [2, 3], {wall: 'far', front: 1.0}), W('monitorDesk', [1, 1], {front: 0.9}), W('gunLocker', [0, 1], {front: 0.9}), W('cabinetTall', [0, 1], {front: 0.8})],
        armory: [ROW('gunLocker', [1, 2], {wall: 'far', front: 0.9}), ROW('staffLockers', [1, 2], {wall: 'side', front: 0.8}), W('cabinetTall', [0, 1], {front: 0.8}), W('metalDetector', [0, 1]), W('crate', [0, 1])],
        meeting: [W('cctvConsole', [0, 1], {front: 0.9})],
      },
    },
    loot: 'ammo', note: 'Security contractor: gunmetal and amber, a metal-detector checkpoint in reception, a CCTV control room and an equipment room.',
  },
  pemberton: {
    id: 'pemberton', name: 'Pemberton & Co.', short: 'Pemberton', tagline: 'Chartered Accountants · Est. 1952',
    palette: {wall: 0xdcd6c3, accent: 0x2d4f3c, floor: 0x5b5345, trim: 0x3b2f22, sign: 0xe6d7a3}, finish: 'warm-wood', font: 'serif',
    signature: ['vaultSafe', 'archiveBoxes'], hero: 'vaultSafe', support: ['executiveDesk', 'executiveChair', 'chesterfieldSofa', 'globeBar'],
    program: {
      open: ['cubicles', 'cubicles'], rooms: [['archive'], ['archive', 'meeting']], ends: [['vault', 'storage'], ['vault', 'copy']],
      runs: 1, run: 'private', exec: true, labels: {cubicles: 'Audit pool'},
      steps: {
        reception: [W('archiveBoxes', [1, 2])],
        archive: [ROWS('shelf', [4, 8], {pair: true, aisle: 1.1}), SCAT('archiveBoxes', [3, 6], 0.5), W('officeFiling', [0, 1], {front: 0.7})],
        vault: [ROW('vaultSafe', [1, 2], {wall: 'far', front: 0.8}), W('safe', [1, 1], {front: 0.7}), W('cabinetTall', [0, 1], {front: 0.8}), W('archiveBoxes', [1, 2])],
        cubicles: [W('archiveBoxes', [1, 2])],
        private: [W('archiveBoxes', [0, 1])],
      },
    },
    loot: 'none', note: 'Old accountancy: beige and bottle green, an antique safe in reception, a maze of archive stacks and a vault room.',
  },
  pawprint: {
    id: 'pawprint', name: 'Pawprint Pet Foods', short: 'Pawprint', tagline: 'Nutrition for Every Pet',
    palette: {wall: 0xf5e6b8, accent: 0xc8742c, floor: 0x8d7b5e, trim: 0xffffff, sign: 0x5a3a1a}, finish: 'creative', font: 'rounded',
    signature: ['aquarium', 'catTree'], hero: 'aquarium', support: ['beanBag', 'loungeArmchair'],
    program: {
      open: ['pods', 'cubicles'], rooms: [['petlounge', 'meeting'], ['kitchen', 'petlounge']], ends: [['storage', 'break'], ['storage', 'copy']],
      runs: 0, run: 'private', exec: false, labels: {kitchen: 'Recipe kitchen'},
      steps: {
        reception: [W('catTree', [1, 1], {front: 0.5})],
        petlounge: [SCAT('catTree', [2, 3], 0.6), W('aquarium', [1, 1], {wall: 'far', front: 0.8}), SCAT('beanBag', [1, 2], 0.6), W('loungeArmchair', [0, 1], {front: 0.6})],
        kitchen: [W('kitchenette', [1, 1], {wall: 'far', front: 0.9}), W('fridge', [1, 1], {front: 0.6}), ISLE('table', [1, 1], 0.8), ROW('cartonStack', [1, 2], {wall: 'any'}), W('catTree', [1, 1], {front: 0.5})],
        meeting: [W('aquarium', [0, 1], {front: 0.8})],
      },
    },
    loot: 'food', note: 'Pet-food maker: warm yellow and tan, a murky office aquarium in reception, cat trees in the pet lounge, a recipe kitchen.',
  },
  goldencrust: {
    id: 'goldencrust', name: 'Goldencrust Bakeries', short: 'Goldencrust', tagline: 'Baking Since 1961',
    palette: {wall: 0xf3e6c8, accent: 0xc98a2b, floor: 0x9c5b3b, trim: 0x5a3a22, sign: 0xfff4dc}, finish: 'warm-wood', font: 'serif',
    signature: ['doughMixer', 'bakeryCase'], hero: 'bakeryCase', support: ['loungeArmchair', 'pottedPlantSmall'],
    program: {
      open: ['pods', 'cubicles'], rooms: [['bakery', 'meeting'], ['kitchen', 'bakery']], ends: [['kitchen', 'storage'], ['storage', 'break']],
      runs: 0, run: 'private', exec: false, labels: {meeting: 'Tasting room'},
      steps: {
        reception: [],
        bakery: [ROW('bakeryCase', [2, 3], {wall: 'far', front: 1.0}), ISLE('table', [1, 2], 0.8), W('couch', [0, 1], {front: 0.7}), SCAT('loungeArmchair', [0, 2], 0.5)],
        kitchen: [ROW('doughMixer', [2, 3], {wall: 'far', front: 0.8}), W('kitchenette', [1, 1], {front: 0.9}), W('fridge', [1, 1], {front: 0.6}), ISLE('table', [1, 1], 0.8), W('ingredientBin', [0, 2]), W('shelf', [0, 1], {front: 0.8})],
        meeting: [W('bakeryCase', [0, 1], {front: 0.9})],
      },
    },
    loot: 'food', note: 'Industrial bakery: cream, gold and terracotta, a bakery case of stale pastries in reception, a test kitchen of dough mixers.',
  },
  orbital: {
    id: 'orbital', name: 'Orbital Dynamics', short: 'Orbital', tagline: 'Aerospace · Satellite Systems',
    palette: {wall: 0xe4e7ec, accent: 0x1b2a4a, floor: 0x39404d, trim: 0xaab3bf, sign: 0xffffff}, finish: 'corporate', font: 'condensed',
    signature: ['satelliteModel', 'telescope'], hero: 'satelliteModel', support: ['executiveDesk', 'executiveChair', 'chesterfieldSofa', 'globeBar', 'loungeArmchair'],
    program: {
      open: ['cubicles', 'pods'], rooms: [['mission', 'observatory'], ['mission', 'meeting']], ends: [['server', 'storage'], ['server', 'break']],
      runs: 0, run: 'private', exec: true, labels: {pods: 'Engineering bay'},
      steps: {
        reception: [WIN('telescope', [1, 1])],
        mission: [W('satelliteModel', [1, 1], {front: 0.6}), ROW('monitorDesk', [2, 3], {wall: 'far', front: 1.0}), ISLE('conferenceTable', [1, 1], 0.7), W('officeWhiteboard', [1, 1], {front: 0.6})],
        observatory: [WIN('telescope', [2, 3]), W('loungeArmchair', [1, 2], {front: 0.6}), ISLE('table', [0, 1], 0.8), W('satelliteModel', [0, 1], {front: 0.6})],
        meeting: [WIN('telescope', [0, 1])],
      },
    },
    loot: 'light', note: 'Aerospace firm: silver and deep-space blue, a satellite replica in reception, a mission room and telescopes trained on the fog.',
  },
};

export const COMPANY_IDS = Object.keys(COMPANIES) as CompanyId[];

/** Room label on a company's floor (its override, else the catalogue's). */
export function roomLabel(c: Company, key: RoomKey | OpenStyle): string {
  const o = c.program.labels?.[key];
  if (o) return o;
  return key in ROOMS ? ROOMS[key as RoomKey].label : OPEN_STYLES[key as OpenStyle].label;
}

/** Recipe of a company room (its own steps, else the catalogue default). */
export function roomSteps(c: Company, key: RoomKey | OpenStyle | RunKind): readonly Step[] {
  return c.program.steps[key] ?? (key in ROOMS ? ROOMS[key as RoomKey].steps : []);
}

const hex = (v: number) => `#${v.toString(16).padStart(6, '0')}`;
/** CSS colour of a palette entry (sign rendering). */
export const cssOf = hex;
