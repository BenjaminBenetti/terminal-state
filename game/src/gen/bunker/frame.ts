// Task studio-bunker-level-20261109-072224-01: THE BUNKER's frame — the fixed dimensions of the buried shelter and the seeded free
// parameters of one station (gen/bunker/index.ts). Pure data.
//
// Canonical frame (canvas cells, 0.5 m; the layout grid IS the canvas: crop origin 0, 0; a mirrored station stamps every rect at
// W - x - w):
//   - storey 0 (y 0, the STATION): the track bed (one track) and the side platform along x at the north, the ARRIVAL HALL behind the
//     platform wall, the 1 m vault BULKHEAD holding the Reactor's round blast door (standing open), the VAULT VESTIBULE behind it,
//     the guard booth / station office off the hall; the main stair core's north end opens off the vestibule;
//   - two stacked SCISSOR STAIR CORES (lanes side by side, landings at alternating ends storey by storey — the Mall's service core
//     on a 7 m storey): the MAIN stair (core A, storeys 0-5) west, the SERVICE stair (core B, storeys 1-5) east, each with its stair
//     lobby along its inner flank on every shelter storey; their footprints never change between storeys (real shafts);
//   - storeys 1-5 (y -7 … -35, DESCENDING): each a seeded room graph (gen/reactor/complex/bunkerPlan.ts Planner) inside its own
//     footprint round the two cores: the storey's spine corridor between the two lobbies at a seeded row, more corridors grown off
//     them, the storey's PROGRAMME grown on by function (gen/bunker/programme.ts).

import {Rng, hashString} from '../../core/rng';
import {STAIR, stairRunCells} from '../traversal';
import {bunkerNameOf} from './names';

/** Storeys (layout.levels): 0 = the station, 1..5 the shelter descending (5 = the central processing core, the lowest walkable). */
export const BUNKER_LEVELS = 6;
/** The lowest storey (the processing core). */
export const BUNKER_CORE_LEVEL = 5;
/** Storey rise (m) and the absolute floor of every storey. */
export const BUNKER_RISE = 7;
export const BUNKER_BASES: readonly number[] = Array.from({length: BUNKER_LEVELS}, (_, i) => -i * BUNKER_RISE);

/** One storey run of a scissor core (cells along the run: flights + the top landing). */
export const BUNKER_RUN_CELLS = stairRunCells(BUNKER_RISE, STAIR);

/** Fixed module sizes (cells unless noted). */
export const BUNKER = {
  /** Scissor cores: lane width (A main / B service), the 1-cell divider, the landing depth at each end; their length. */
  core: {laneA: 5, laneB: 4, landing: 4, len: 4 + BUNKER_RUN_CELLS + 4},
  /** Stair lobby width along a core's inner flank; the spine corridor's width. */
  lobby: 5,
  spine: 6,
  /** Station: track bed first row, platform depth / length range, the hall / vestibule / booth sizes. */
  station: {bedY: 3, pd: [10, 12] as const, lp: [64, 72] as const, hallD: [14, 17] as const, hallW: [34, 44] as const, vestD: [12, 15] as const, vestW: [19, 23] as const, booth: [8, 10] as const},
  /** The bulkhead (rows) holding the blast door, its 3-cell lane, and the threshold risers each side. */
  bulkhead: 2,
  /** Clear heights (m): platform / hall / vestibule (>= the blast door's 4.0 m frame + air), booth, ordinary rooms, stores, corridors, halls. */
  clear: {platform: 5.2, hall: 4.8, vest: 4.6, booth: 3.2, room: 3.4, store: 3.2, corridor: 3.2, lobby: 3.6, hall2: 5.2, core: 6.4},
  /** Door heights (m): rooms, junctions, the platform openings, the stair landings. */
  door: {room: 2.4, junction: 3.0, platform: 3.2, landing: 2.6},
  /** Storey footprint margins round the cores (cells, seeded per storey). */
  margin: {w: [8, 24] as const, e: [8, 24] as const, n: [10, 26] as const, s: [10, 26] as const},
  /** The hub length between the two lobbies (cells). */
  gap: [44, 62] as const,
} as const;

/** Display label of a storey (HUD / directory plates). */
export const BUNKER_STOREY_LABELS: readonly string[] = [
  'Station', 'Level 1 — Entry & security', 'Level 2 — Habitation', 'Level 3 — Services & medical', 'Level 4 — Maintenance & water', 'Level 5 — Central processing core',
];
/** The programme id of a storey (BunkerStorey.programme). */
export const BUNKER_PROGRAMMES: readonly string[] = ['station', 'entry', 'habitation', 'services', 'maintenance', 'core'];
/** Short plate text of a storey ("LEVEL 2 · HABITATION"). */
export const BUNKER_STOREY_PLATES: readonly string[] = ['STATION', 'LEVEL 1 · ENTRY & SECURITY', 'LEVEL 2 · HABITATION', 'LEVEL 3 · SERVICES & MEDICAL', 'LEVEL 4 · MAINTENANCE & WATER', 'LEVEL 5 · PROCESSING CORE'];

/** One storey's seeded footprint margins round the cores and its spine row (fraction of the cores' shared rows). */
export interface StoreyFrame { mw: number; me: number; mn: number; ms: number; spine: number }

/** Seeded free parameters of one Bunker station. */
export interface BunkerFrame {
  mirror: boolean;
  /** Platform length / depth, arrival hall width / depth, vestibule width / depth (cells). */
  Lp: number; Pd: number; hallW: number; hallD: number; vestW: number; vestD: number;
  /** Where the hall sits along the platform (fraction of the slack), the vestibule's west overhang past core A (cells). */
  hallSlide: number; vestOver: number;
  /** The booth's side of the hall (canonical), the station office on the other side or none. */
  boothEast: boolean; office: boolean;
  /** Hub length between the lobbies (cells), core B's row offset from core A. */
  gap: number; dyB: number;
  /** Core A's landing end on storey 0 ('lo' = north), core B's on storey 1. */
  endB1: 'lo' | 'hi';
  storeys: StoreyFrame[];
  name: string;
  salt: number;
}

/** The Bunker's generation seed of a level seed. */
export function bunkerSeed(levelSeed: number): number {
  return hashString('terminal-state:bunker', levelSeed >>> 0);
}

/** The station's frame (salt > 0: a re-roll of the free parameters after a programme that did not fit). */
export function bunkerFrame(levelSeed: number, salt = 0): BunkerFrame {
  const r = new Rng(hashString(`bunker-frame:${salt}`, levelSeed >>> 0));
  const S = BUNKER.station, M = BUNKER.margin;
  const storeys: StoreyFrame[] = [];
  for (let i = 0; i < BUNKER_LEVELS; i++) storeys.push({mw: r.int(M.w[0], M.w[1]), me: r.int(M.e[0], M.e[1]), mn: r.int(M.n[0], M.n[1]), ms: r.int(M.s[0], M.s[1]), spine: r.range(0.15, 0.85)});
  return {
    mirror: r.chance(0.5),
    Lp: r.int(S.lp[0], S.lp[1]), Pd: r.int(S.pd[0], S.pd[1]), hallW: r.int(S.hallW[0], S.hallW[1]), hallD: r.int(S.hallD[0], S.hallD[1]),
    vestW: r.int(S.vestW[0], S.vestW[1]), vestD: r.int(S.vestD[0], S.vestD[1]),
    hallSlide: r.range(0.2, 0.8), vestOver: r.int(2, 5),
    boothEast: r.chance(0.5), office: r.chance(0.7),
    gap: r.int(BUNKER.gap[0], BUNKER.gap[1]), dyB: r.int(-14, 14),
    endB1: r.chance(0.5) ? 'lo' : 'hi',
    storeys, name: bunkerNameOf(levelSeed), salt,
  };
}
