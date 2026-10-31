// Task mall-playtest-revision-20261031 (lane GEN): the MALL FRAME — the seeded named variant and every dimension the ONE continuous
// mall layout shares (pure data; derived from the LEVEL seed only, before any carving). Replaces the Track3 six-ring frame.
//
// User (playtest): "the mall is too big ... too many stories tall ... about half the height ... more varied shape, jutting in and
// out of the atrium kind of in a cone shape ... generally you'll start in an atrium area where you can see up, but then the exact
// layout of the mall does not have to follow the atrium. There could be corridors off with shops".
//
// World frame (the Office's conventions): x east, z south, y up, metres; CELL = 0.5 m. layout.levels[0] = the subway station at the
// bottom of the atrium (y 0), layout.levels[k] = retail floor k (k = 1..FLOORS) at y = STOREY * k. Every storey grid has the same size
// and origin.
//
// Plan (canvas cells; gen/mall/skeleton.ts places it, gen/mall/carve.ts carves it):
//  - the STATION (level 0): the shared Kit.sideBlock (two side platforms on one double track bed along X, k.trenches for Track2), a
//    "Fountain court" behind the north platform holding the escalators / the glass elevator, back of house off the platforms;
//  - the ATRIUM: a small irregular opening over the track bed, nested and widening upward floor by floor (stepped setbacks, a cone /
//    offset quality per variant); glass roof over the top opening only; the station sees the sky through it;
//  - the COURT: the gallery walkways around the atrium on every retail floor (escalator / elevator strip on its north side, the
//    second escalator strip on its south side);
//  - WINGS: corridor wings / branches / loops off the court (variant topology; upper floors may omit a wing: the massing steps back);
//  - LOTS: shop units of the ten lot families (gen/mall/lots.ts) extruded from the walkway edges, end units closing corridor ends,
//    two service-stair cores, a washroom passage per floor.

import {Rng, hashString} from '../../core/rng';
import {transitSpecs} from '../traversal';
import {mallNameOf} from './names';

/** Named seeded layout variants (layout.mall.variant): genuinely different topologies, not decoration. */
export type MallVariant = 'terrace-cross' | 'arcade-loop' | 'elbow-branch';
export const MALL_VARIANTS: readonly MallVariant[] = ['terrace-cross', 'arcade-loop', 'elbow-branch'];

/** Retail floors above the station (the user: "about half the height"; old: six rings). */
export const FLOORS = 3;
/** Back-compat alias (Track3 code / tests called the retail storeys "rings"). */
export const RINGS = FLOORS;
/** Storey height (m): floor k at y = STOREY * k; the station platforms are at y 0. */
export const STOREY = 5.0;
/** Clear heights above a storey floor (m): galleries, shop sales floors, backrooms, corridors / cores, station courts. */
export const CLEAR = {gallery: 4.2, shop: 4.0, back: 3.2, corridor: 3.0, core: 3.0, court: 4.6, platform: 4.4, door: 2.3, shopfront: 3.4, core0: 4.4};
/** Glass roof over the TOP atrium opening: springing line above the top floor's floor (m); vault rise as a fraction of its width. */
export const ROOF = {spring: 5.6, riseFrac: 0.28, archSpacing: 4.5};
/** Canvas: generous room east / south of the mall for Track2's tunnels / annexes (fixed crop origin: grow east / south only). */
export const MALL_CANVAS = {w: 400, h: 320, levels: FLOORS + 1, org: 8};
/** SOLID cells kept between the crop edge and the outermost carved floor (>= 2 per the Track2 contract; + the outer wall). */
export const CROP_MARGIN = 3;
/** Public vertical runs (escalators / stairs) climb one storey at the transit pitch (30 degrees): run length in cells. */
export const RUN = transitSpecs(STOREY);
export const RUN_CELLS = RUN.cells;
/** Escalator lane width (cells: 1.5 m = step band + balustrades), banks of two lanes; public stair lane width. */
export const LANE = {escalator: 3, stair: 5};
/** Width (cells) of an escalator strip beside the atrium and the minimum walkway (cells) beside it / beside the void. */
export const STRIP = 6;
export const WALK = 8;
/** Service-stair core (cells): two 4-cell lanes + a 1-cell divider; 3-cell landings at both ends. */
export const CORE = {lane: 4, divider: 1, landing: 3};

export interface MallFrame {
  levelSeed: number;
  variant: MallVariant;
  /** Seeded display name ("Harbourline Center"): gen/mall/names.ts mallNameOf(levelSeed). */
  name: string;
  /** Platform length (cells). */
  Lp: number;
  /** Atrium (L1 opening) width along X (cells), its position along the platforms (0..1), rows over each platform (cells). */
  VW: number;
  atX: number;
  overN: number;
  overS: number;
  /** Setback per floor step (cells) on each side: [W, E, N, S] for floor 2 and floor 3 (nested, widening upward). */
  step2: readonly [number, number, number, number];
  step3: readonly [number, number, number, number];
  /** Irregular jut / notch on the L1 opening: which corner is notched, which side carries a bay. */
  notch: 'NW' | 'NE' | 'SW' | 'SE' | null;
  bay: 'W' | 'E' | 'S' | null;
  /** Court gallery margins beside the top opening (cells): W / E (N / S are the escalator strips + walkways). */
  gW: number;
  gE: number;
  /** Corridor wing walkway width (cells), wing lengths (cells), offsets (cells) — read per variant by the skeleton. */
  WW: number;
  wingA: number;
  wingB: number;
  wingOff: number;
  branchLen: number;
  /** Band (lot) depth behind a walkway edge (cells). */
  band: number;
  /** Retail floor holding the food court (1..FLOORS). */
  foodFloor: number;
  /** Escalator / elevator positions along the court's north strip (0..1). */
  escAt: number;
  liftAt: number;
}

/** Session-only QA override of the variant (main.ts `?mallVariant=`); undefined = the seed's. */
let variantOverride: MallVariant | undefined;
export function setMallVariantOverride(v: string | null | undefined): MallVariant | undefined {
  variantOverride = (MALL_VARIANTS as readonly string[]).includes(v ?? '') ? v as MallVariant : undefined;
  return variantOverride;
}

/** The variant of a level seed (deterministic; tests / QA may force one through generateMallLevel's options / the override). */
export function mallVariantOf(levelSeed: number): MallVariant {
  return variantOverride ?? MALL_VARIANTS[hashString('mall-variant-v2', levelSeed >>> 0) % MALL_VARIANTS.length];
}

/**
 * The mall frame of a level seed (optionally forcing the variant). `salt` > 0 re-rolls the frame's free parameters (sizes, slot
 * positions) of the SAME variant: generateMallLevel moves to the next salt when a frame's program does not fit.
 */
export function mallFrame(levelSeed: number, variant: MallVariant = mallVariantOf(levelSeed), salt = 0): MallFrame {
  const rng = new Rng(hashString(`mall-frame-v2:${variant}${salt ? `:${salt}` : ''}`, levelSeed >>> 0));
  const pick4 = (a: number, b: number): [number, number, number, number] => [rng.int(a, b), rng.int(a, b), rng.int(a, b), rng.int(a, b)];
  // Atrium cone per variant: 'terrace-cross' widens on every side (stepped terraces), 'arcade-loop' steps one way (an offset court
  // drifting east / south), 'elbow-branch' twists (floor 2 grows north-west, floor 3 south-east).
  let step2: [number, number, number, number], step3: [number, number, number, number];
  if (variant === 'terrace-cross') { step2 = pick4(3, 5); step3 = pick4(3, 5); }
  else if (variant === 'arcade-loop') { step2 = [0, rng.int(6, 9), rng.int(2, 4), rng.int(3, 5)]; step3 = [rng.int(0, 2), rng.int(6, 9), rng.int(2, 4), rng.int(2, 4)]; }
  else { step2 = [rng.int(6, 8), 0, rng.int(4, 6), 0]; step3 = [0, rng.int(6, 8), rng.int(1, 3), rng.int(4, 6)]; }
  const corners = ['NW', 'NE', 'SW', 'SE'] as const;
  return {
    levelSeed: levelSeed >>> 0, variant, name: mallNameOf(levelSeed),
    Lp: rng.int(104, 124),
    VW: rng.int(28, 36), atX: variant === 'arcade-loop' ? rng.range(0.3, 0.42) : variant === 'elbow-branch' ? rng.range(0.5, 0.62) : rng.range(0.42, 0.58),
    overN: rng.int(2, 4), overS: rng.int(2, 5),
    step2, step3,
    notch: rng.chance(0.75) ? rng.pick(corners) : null,
    bay: rng.chance(0.6) ? rng.pick(['W', 'E', 'S'] as const) : null,
    gW: rng.int(9, 12), gE: rng.int(9, 12),
    WW: rng.int(12, 14),
    wingA: rng.int(40, 54), wingB: rng.int(30, 42), wingOff: rng.int(-6, 6), branchLen: rng.int(18, 26),
    band: rng.int(24, 28),
    foodFloor: rng.int(1, FLOORS),
    escAt: rng.range(0.1, 0.3), liftAt: rng.range(0.62, 0.8),
  };
}

/** Layout seed of the mall level. */
export function mallSeed(levelSeed: number): number {
  return hashString('mall:main', levelSeed >>> 0) >>> 0;
}

/** HUD storey label of a mall layout level ('Subway', 'Level 1' … 'Level 3'). */
export function mallStoreyLabel(level: number): string {
  return level === 0 ? 'Subway' : `Level ${level}`;
}
