// Task reactor-build-20261101 (lane GEN): the REACTOR FRAME — the seeded kit variant and every dimension the ONE continuous Reactor
// layout shares (pure data; derived from the LEVEL seed only, before any carving). B "Industrial Service Cathedral".
//
// World frame (the Office / Mall conventions): x east, z south, y up, metres; CELL = 0.5 m. Canvas cells during generation.
//
// CANONICAL FRAME (gen/reactor/carve.ts works in it; the 'E' variants mirror x): the pit is a rectangular shaft PW x PD cells,
//  - the RIM STATION lies NORTH of the pit (track bed along x, one platform); task reactor-playtest-round2-20261102 (lane ARRIVAL):
//    `sep` rows of rock separate the platform from the pit's north wall — the arrival approach (station area, breach, tunnel) is cut
//    into them (gen/reactor/arrival.ts);
//  - the STAIR WALL (wall switchbacks, generator landings) is WEST (stairWall 'W'; 'E' mirrors), its runs between pz ∈ [PD-u1, PD-u0);
//    its A end (south corner) holds the rim / tier-2 / tier-4 landings, its B end (north corner) the tier-1 / tier-3 / core ends;
//  - the SOUTH wall carries the second flight set (route 2, 'bridge' line) with a continuous outer gallery on every tier;
//  - the NORTH wall carries the b-half galleries of the odd / bridge tiers (bridges cross the pit north-south to the south gallery,
//    through 1-2 free-standing lattice towers);
//  - the ORGAN wall (opposite the stair wall) carries the organ-pipe bank and, at its south corner, the stepped maintenance terraces
//    the ladders (route 3) climb between.

import {Rng, hashString} from '../../core/rng';
import {STAIR, stairRunCells} from '../traversal';

/** Walkway tiers below the rim (the core floor follows them). */
export const TIERS = 4;
/** Level count: rim + TIERS + core floor. */
export const REACTOR_LEVELS = TIERS + 2;
/** layout.levels index of the core floor. */
export const CORE_LEVEL = TIERS + 1;
/** Canvas margin (cells) kept as rock around everything carved (>= 2 for Track2). */
export const ORG = 3;
/** Rock margin (cells) beside the pit for the rooms cut into the walls (room depth <= 24 + the wall). */
export const ROOM_MARGIN = 28;
/** Scissor lanes (cells): each lane 1.5 m wide; lane A against the wall, lane B outside it. */
export const LANE = 3;
/** Depth of the generator landings (cells: 6 m) and their along-wall reserve (cells: >= 8 m). */
export const GEN_LANDING = {deep: 12, along: 17};
/** Clear heights above a tier deck for room ceilings (m). */
export const CLEAR = {room: 3.4, store: 3.2, hall: 4.2, station: 5.0, door: 2.4, portal: 4.0};
/** Generator skid (m): long axis along the wall. */
export const GENSET = {w: 3.6, d: 1.6, h: 2.3};
/** Vessel radius (m) and height above the core floor (m). */
export const VESSEL = {r: 7.0, h: 12.0};
/** Pipe bank depth off the organ wall (cells: 1.5 m). */
export const BANK_CELLS = 3;
/** Track bed rows (cells) of a single / double bed. */
export const BED = {single: 9, double: 16};

export type ReactorWallSide = 'W' | 'E';

export interface ReactorFrame {
  levelSeed: number;
  /** Seeded kit variant name (layout.reactor.pit.variant). */
  variant: string;
  stairWall: ReactorWallSide;
  /** Pit size (cells along x / z). */
  PW: number;
  PD: number;
  /** Absolute deck heights: [rim 0, tier 1..4, core floor]. */
  bases: number[];
  /** Top of the pit column (crane runway / pipe tops below it). */
  roofY: number;
  /** Run length (cells) of every straight stair run between consecutive tiers (the largest rise's; shorter rises get a longer top landing). */
  R: number;
  /** Stair-wall run start from the south corner (cells). Runs span u ∈ [u0, u0 + R). */
  u0: number;
  /** South-wall route-2 run start from the stair corner (cells). Runs span [r0, r0 + R). */
  r0: number;
  /** Gallery widths (cells): rim gallery, north (b-half) galleries, south (route-2 wall) outer galleries. */
  gwR: number;
  gwN: number;
  gwS: number;
  /** North gallery length per tier (fraction of PW, from the stair corner). */
  lenN: number[];
  /** Bridge lines (pit-local px of the 4-cell bridge's west edge in the canonical frame) and the tiers each carries; tower z (pz). */
  lines: {px: number; tiers: number[]; tz: number}[];
  /** Platform length / depth (cells), double bed, platform shift (cells beyond the pit's stair-side wall). */
  Lp: number;
  Pd: number;
  double: boolean;
  shift: number;
  /** Platform openings onto the rim gallery (2-3). (task reactor-playtest-round2-20261102: unused since the arrival approach; drawn to keep the stream) */
  openings: number;
  /** Organ bank(s): pz ranges along the organ wall (canonical pit-local), split in one or two banks. */
  banks: [number, number][];
  /** Crane runway axis. */
  craneAxis: 'x' | 'z';
  /**
   * Task reactor-playtest-round2-20261102 (lane ARRIVAL): rows of rock between the platform's south wall and the pit's north wall (the
   * station area + breach tunnel band, gen/reactor/arrival.ts). Its own stream: every other frame parameter is unchanged.
   */
  sep: number;
  /**
   * Task reactor-playtest-round2-20261102 (lane ARRIVAL, route variety): the south flight set (route 2) runs the other way round — its
   * lane A tops at the FAR end (from the stair corner), so every tier's south landing swaps ends and the descent zig-zags mirrored.
   */
  southFlip: boolean;
}

/** Session-only QA override of the variant (`?reactorVariant=`); undefined = the seed's. */
let variantOverride: ReactorWallSide | undefined;
export function setReactorVariantOverride(v: string | null | undefined): ReactorWallSide | undefined {
  variantOverride = v === 'W' || v === 'E' ? v : v?.startsWith('west') ? 'W' : v?.startsWith('east') ? 'E' : undefined;
  return variantOverride;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Layout seed of the reactor level. */
export function reactorSeed(levelSeed: number): number {
  return hashString('reactor:main', levelSeed >>> 0) >>> 0;
}

/**
 * The reactor frame of a level seed. `force` = a stair wall ('W' / 'E') or a variant name prefix ('west…' / 'east…'); `salt` > 0
 * re-rolls the free parameters of the same stair wall (generateReactorLevel moves to the next salt when a program does not fit).
 */
export function reactorFrame(levelSeed: number, force?: string, salt = 0): ReactorFrame {
  const pre = new Rng(hashString('reactor-wall', levelSeed >>> 0));
  const forced = force === 'W' || force === 'E' ? force : force?.startsWith('west') ? 'W' : force?.startsWith('east') ? 'E' : undefined;
  const stairWall: ReactorWallSide = forced ?? variantOverride ?? (pre.chance(0.5) ? 'W' : 'E');
  const rng = new Rng(hashString(`reactor-frame:${stairWall}${salt ? `:${salt}` : ''}`, levelSeed >>> 0));
  const even = (a: number, b: number) => 2 * rng.int(a / 2, b / 2);
  const PW = even(86, 96), PD = even(86, 96);
  // depths: four walkway tiers ~5.6-6.4 m apart, the core floor 5.6-6.4 m below tier 4 (-28 … -33)
  const bases = [0];
  for (let k = 1; k <= TIERS + 1; k++) bases.push(r1(bases[k - 1] - rng.range(5.6, 6.4)));
  const roofY = r1(rng.range(14, 18));
  let R = 0;
  for (let k = 0; k <= TIERS; k++) R = Math.max(R, stairRunCells(bases[k] - bases[k + 1], STAIR));
  // stair-wall runs: generator landings at both ends (>= GEN_LANDING.along each)
  const u0 = rng.int(GEN_LANDING.along + 1, Math.max(GEN_LANDING.along + 1, PD - GEN_LANDING.along - 1 - R));
  // south-wall runs: the stair landing (12 deep) + a room-sized near landing before them, the organ terraces after them
  const r0 = rng.int(GEN_LANDING.deep + 18, Math.max(GEN_LANDING.deep + 18, PW - 14 - R));
  const gwR = rng.int(8, 12), gwN = rng.int(6, 10), gwS = rng.int(6, 8);
  const lenN = Array.from({length: TIERS + 1}, () => rng.range(0.55, 0.85));
  // bridge lines: the stair-side band (between the generator landings and the vessel) or the organ side
  const cx = PW / 2, vr = Math.ceil(VESSEL.r / 0.5);
  const stairBand: [number, number] = [GEN_LANDING.deep + 4, Math.floor(cx - vr - 8)];
  const organBand: [number, number] = [Math.ceil(cx + vr + 4), PW - 14];
  const tz = () => rng.int(Math.round(PD * 0.36), Math.round(PD * 0.56));
  const twin = rng.chance(0.5);
  const extra = rng.pick([0, 0, 2, 4]);
  const first = rng.chance(0.5) ? stairBand : organBand, second = first === stairBand ? organBand : stairBand;
  const lines: ReactorFrame['lines'] = [];
  if (twin) {
    lines.push({px: rng.int(first[0], first[1]), tiers: [1], tz: tz()});
    lines.push({px: rng.int(second[0], second[1]), tiers: [3], tz: tz()});
    if (extra) lines[rng.int(0, 1)].tiers.push(extra);
  } else {
    lines.push({px: rng.int(first[0], first[1]), tiers: [1, 3, ...(extra ? [extra] : [])], tz: tz()});
  }
  for (const l of lines) l.tiers.sort((a, b) => a - b);
  const Lp = Math.max(rng.int(124, 140), PW + 34);
  // ladder terraces at the organ wall's south corner reach L0 + 3 * TIERS cells; the bank(s) stop short of them
  const L4 = 3 + gwR + 3 * TIERS + 3;
  const b0 = 22, b1 = PD - L4 - 4;
  const banks: [number, number][] = rng.chance(0.5) && b1 - b0 > 30 ? (() => { const m = rng.int(b0 + 12, b1 - 14); return [[b0, m - 2], [m + 2, b1]] as [number, number][]; })() : [[b0, b1]];
  const twinName = twin ? 'twin-tower' : 'single-tower';
  return {
    levelSeed: levelSeed >>> 0, variant: `${stairWall === 'W' ? 'west' : 'east'}-stairs-${twinName}`, stairWall, PW, PD, bases, roofY, R, u0, r0,
    gwR, gwN, gwS, lenN, lines, Lp, Pd: rng.int(14, 18), double: rng.chance(0.5), shift: rng.int(20, 26), openings: rng.int(2, 3), banks,
    craneAxis: rng.chance(0.5) ? 'x' : 'z',
    // task reactor-playtest-round2-20261102 (lane ARRIVAL): the arrival band and the south flight set's direction (their own stream; a
    // salt re-roll re-draws them too; every other frame parameter keeps its old draw)
    ...(() => { const r2 = new Rng(hashString(`reactor-approach${salt ? `:${salt}` : ''}`, levelSeed >>> 0)); return {sep: r2.int(...ARRIVAL_SEP), southFlip: r2.chance(0.5)}; })(),
  };
}

/** Task reactor-playtest-round2-20261102 (lane ARRIVAL): the arrival band's row range (gen/reactor/arrival.ts ARRIVAL.sep). */
export const ARRIVAL_SEP: [number, number] = [28, 34];

/** HUD label of a reactor layout level. */
export function reactorStoreyLabel(level: number): string {
  return level === 0 ? 'Rim' : level === CORE_LEVEL ? 'Core floor' : `Tier ${level}`;
}
