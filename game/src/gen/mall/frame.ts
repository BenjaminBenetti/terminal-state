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

/**
 * Named seeded layout variants (layout.mall.variant): genuinely different topologies, not decoration.
 * Task mall-round2-20261031 (lane GEN, M08: "increase floor plan diversity a bit more"): + three topologies, each with a floor-1
 * street arcade ending at the locked glass street doors (M09):
 *  - 'tee-junction': a south spine off the court meets a cross corridor (a T away from the court: a three-way junction); one arm runs
 *    on to the street (floor 1), the other ends in an anchor; floor 3 keeps the spine;
 *  - 'twin-court': a west corridor to a SECOND court (a hub with its own anchor and a street arcade off it) + an east wing;
 *  - 'offset-arcade': a south arcade offset from the court by a block of back-to-back shops, joined to it by two links (a loop on
 *    floors 1-2), continuing on floor 1 to the street; a west wing on every floor.
 * The three original variants keep their exact output for a given (seed, variant) (their branches / draws are untouched).
 */
export type MallAtriumVariant = 'terrace-cross' | 'arcade-loop' | 'elbow-branch' | 'tee-junction' | 'twin-court' | 'offset-arcade';
/**
 * Task studio-mall-layout-variety-20261117-005520-01: the PLAN FAMILIES of layout version 2 (gen/mall/plans.ts; real-mall research:
 * reference/tasks/mall-layout-variety-20261117-005520/research/RESEARCH.md) — each a different overall organisation, not a reskin of
 * the one atrium pit:
 *  - 'galleria': a long, narrow, skylit galleria (one barrel-vaulted nave running far past the station both ways), balconies with
 *    bridges across it on the upper floors, an anchor closing each end (the dumbbell plan) and a glazed end wall over a parking lot;
 *  - 'crossroads': a small domed crossing over the station and three skylit ARMS off it (the cruciform / T galleria), each arm its own
 *    gallery street ending at an anchor or the street;
 *  - 'promenade': an outward-facing plan — a small light well over the station, then a long single-loaded promenade along the outer
 *    wall, its whole length glazed toward the parking lot, shops on the inner side, anchors at both ends, a food-court terrace above.
 */
export type MallPlanVariant = 'galleria' | 'crossroads' | 'promenade';
export type MallVariant = MallAtriumVariant | MallPlanVariant;
/** The atrium family's six variants (every Mall of layout version 1; still eligible in version 2). */
export const MALL_VARIANTS: readonly MallAtriumVariant[] = ['terrace-cross', 'arcade-loop', 'elbow-branch', 'tee-junction', 'twin-court', 'offset-arcade'];
/** The plan families added by layout version 2 (gen/mall/layoutVersion.ts). */
export const MALL_PLAN_VARIANTS: readonly MallPlanVariant[] = ['galleria', 'crossroads', 'promenade'];
/** Every variant a Mall can have (the atrium family first). */
export const MALL_ALL_VARIANTS: readonly MallVariant[] = [...MALL_VARIANTS, ...MALL_PLAN_VARIANTS];
export const isPlanVariant = (v: string): v is MallPlanVariant => (MALL_PLAN_VARIANTS as readonly string[]).includes(v);
/** The plan family of a variant ('atrium' for the six original variants). */
export type MallPlanFamily = 'atrium' | MallPlanVariant;
export const mallPlanFamilyOf = (v: MallVariant): MallPlanFamily => (isPlanVariant(v) ? v : 'atrium');
/** Version-2 share of the atrium family (the rest is split evenly over MALL_PLAN_VARIANTS). */
export const MALL_ATRIUM_SHARE = 0.4;
/** The original three (playtest revision) and the round-2 additions. */
export const MALL_VARIANTS_V2: readonly MallAtriumVariant[] = MALL_VARIANTS.slice(0, 3);
export const MALL_VARIANTS_ADDED: readonly MallAtriumVariant[] = MALL_VARIANTS.slice(3);

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
  /** Atrium (floor-1 opening) width along X (cells), its position along the platforms (0..1); rows of the north platform's back
   *  kept outside it (the opening covers the rest of that platform: the start stands under it) and rows of the track bed under it. */
  VW: number;
  atX: number;
  nOff: number;
  bedOver: number;
  /** Setback per floor step (cells) on each side: [W, E, N, S] for floor 2 and floor 3 (nested, widening upward). */
  step2: readonly [number, number, number, number];
  step3: readonly [number, number, number, number];
  /** Irregular jut / notch on the L1 opening: which corner is notched, which side carries a bay. */
  notch: 'NW' | 'NE' | 'SW' | 'SE' | null;
  bay: 'W' | 'E' | 'S' | null;
  /** Court gallery margins beside the top opening (cells): W / E / S (the north side is the escalator strip + its walkway). */
  gW: number;
  gE: number;
  gS: number;
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
  /** Task studio-mall-layout-variety-20261117-005520-01: the plan family's own parameters (layout version 2 plan variants only). */
  plan?: MallPlanFrame;
}

/** Free parameters of a version-2 plan family (cells unless noted; read by gen/mall/plans.ts). */
export interface MallPlanFrame {
  /** Galleria / arm slot width (the void between the balconies) and the balcony width beside it (north / south or each side). */
  slot: number;
  balcony: number;
  /** Galleria: the nave's reach west / east of the station opening; crossroads: the west / east / south arm lengths. */
  reachW: number;
  reachE: number;
  reachS: number;
  /** Bridges per upper floor (galleria / crossroads arms) and their deck width. */
  bridges: number;
  bridgeW: number;
  /** Promenade: the light well's size beyond the station opening and the promenade's width; which facade carries it. */
  promW: number;
  /** Which end (galleria) / arm (crossroads) is glazed toward the parking lot instead of closed by a unit: 'W' | 'E' | 'S'. */
  glazed: 'W' | 'E' | 'S';
  /** Which side the floor-1 street exit arcade leaves the plan on. */
  street: 'W' | 'E' | 'S';
}

/** Session-only QA override of the variant (main.ts `?mallVariant=`); undefined = the seed's. */
let variantOverride: MallVariant | undefined;
export function setMallVariantOverride(v: string | null | undefined): MallVariant | undefined {
  variantOverride = (MALL_ALL_VARIANTS as readonly string[]).includes(v ?? '') ? v as MallVariant : undefined;
  return variantOverride;
}

/**
 * The variant of a level seed (deterministic; tests / QA may force one through generateMallLevel's options / the override).
 * Round 2: a seed first draws original-vs-added (each variant ~1/6 of seeds); seeds that stay on the originals keep EXACTLY their
 * previous variant (the v2 draw), so their mall is unchanged; the others take one of the added topologies.
 */
export function mallVariantOf(levelSeed: number): MallVariant {
  if (variantOverride) return variantOverride;
  return mallAtriumVariantOf(levelSeed);
}

/** The atrium family's variant of a level seed (the version-1 draw; no override). */
export function mallAtriumVariantOf(levelSeed: number): MallAtriumVariant {
  const s = levelSeed >>> 0;
  // drawn through the mulberry32 mixer (a raw FNV hash of a sibling salt would correlate with the v2 draw mod 3)
  const r = new Rng(hashString('mall-variant-v3', s));
  if (r.next() * MALL_VARIANTS.length < MALL_VARIANTS_V2.length) return mallVariantV2Of(s);
  return MALL_VARIANTS_ADDED[Math.floor(r.next() * MALL_VARIANTS_ADDED.length)];
}

/** The variant a level seed drew before round 2 (one of the original three) — for samples tuned on those layouts. */
export function mallVariantV2Of(levelSeed: number): MallAtriumVariant {
  return MALL_VARIANTS_V2[hashString('mall-variant-v2', levelSeed >>> 0) % MALL_VARIANTS_V2.length];
}

/**
 * Task studio-mall-layout-variety-20261117-005520-01: the variant of a level seed AT A LAYOUT VERSION (gen/mall/layoutVersion.ts).
 * Version 1: the atrium draw (mallVariantOf). Version 2: one plan-family roll on its own salt (no generation stream, no other roll) —
 * the atrium family with MALL_ATRIUM_SHARE, keeping EXACTLY the version-1 variant of the seed (its core is the version-1 core), else
 * one of MALL_PLAN_VARIANTS evenly. The QA override (setMallVariantOverride) wins at every version.
 */
export function mallVariantAt(levelSeed: number, version: number): MallVariant {
  if (variantOverride) return variantOverride;
  if (version < 2) return mallAtriumVariantOf(levelSeed);
  const r = new Rng(hashString('mall-plan-family-v2', levelSeed >>> 0));
  if (r.next() < MALL_ATRIUM_SHARE) return mallAtriumVariantOf(levelSeed);
  return MALL_PLAN_VARIANTS[Math.min(MALL_PLAN_VARIANTS.length - 1, Math.floor(r.next() * MALL_PLAN_VARIANTS.length))];
}

/**
 * The mall frame of a level seed (optionally forcing the variant). `salt` > 0 re-rolls the frame's free parameters (sizes, slot
 * positions) of the SAME variant: generateMallLevel moves to the next salt when a frame's program does not fit.
 */
export function mallFrame(levelSeed: number, variant: MallVariant = mallVariantOf(levelSeed), salt = 0): MallFrame {
  if (isPlanVariant(variant)) return planMallFrame(levelSeed, variant, salt);
  const rng = new Rng(hashString(`mall-frame-v2:${variant}${salt ? `:${salt}` : ''}`, levelSeed >>> 0));
  const pick4 = (a: number, b: number): [number, number, number, number] => [rng.int(a, b), rng.int(a, b), rng.int(a, b), rng.int(a, b)];
  // Atrium cone per variant: 'terrace-cross' widens on every side (stepped terraces), 'arcade-loop' steps one way (an offset court
  // drifting east / south), 'elbow-branch' twists (floor 2 grows north-west, floor 3 south-east).
  let step2: [number, number, number, number], step3: [number, number, number, number];
  if (variant === 'terrace-cross') { step2 = pick4(3, 5); step3 = pick4(3, 5); }
  else if (variant === 'arcade-loop') { step2 = [0, rng.int(6, 9), 0, rng.int(3, 5)]; step3 = [rng.int(0, 2), rng.int(6, 9), 0, rng.int(3, 5)]; }
  // round 2: 'tee-junction' steps deep toward its south spine, 'twin-court' drifts west toward its second court, 'offset-arcade'
  // twists the other way from 'elbow-branch' (floor 2 grows east, floor 3 west / south)
  else if (variant === 'tee-junction') { step2 = [rng.int(2, 4), rng.int(2, 4), 0, rng.int(5, 8)]; step3 = [rng.int(2, 4), rng.int(2, 4), 0, rng.int(5, 8)]; }
  else if (variant === 'twin-court') { step2 = [rng.int(6, 9), 0, 0, rng.int(3, 5)]; step3 = [rng.int(6, 9), rng.int(0, 2), 0, rng.int(3, 5)]; }
  else if (variant === 'offset-arcade') { step2 = [0, rng.int(6, 8), 0, rng.int(0, 2)]; step3 = [rng.int(6, 8), 0, 0, rng.int(4, 6)]; }
  else { step2 = [rng.int(6, 8), 0, 0, rng.int(0, 2)]; step3 = [0, rng.int(6, 8), 0, rng.int(4, 6)]; }
  const corners = ['NW', 'NE', 'SW', 'SE'] as const;
  return {
    levelSeed: levelSeed >>> 0, variant, name: mallNameOf(levelSeed),
    Lp: rng.int(104, 124),
    VW: rng.int(24, 32), atX: variant === 'arcade-loop' ? rng.range(0.3, 0.42) : variant === 'elbow-branch' ? rng.range(0.5, 0.62) : variant === 'twin-court' ? rng.range(0.55, 0.68) : rng.range(0.42, 0.58),
    nOff: rng.int(2, 3), bedOver: rng.int(4, 12),
    step2, step3,
    notch: rng.chance(0.85) ? rng.pick(corners) : null,
    bay: rng.chance(0.7) ? rng.pick(['W', 'E', 'S'] as const) : null,
    gW: rng.int(8, 10), gE: rng.int(8, 10), gS: rng.int(8, 10),
    WW: rng.int(12, 14),
    wingA: rng.int(34, 40), wingB: rng.int(34, 38), wingOff: rng.int(-6, 6), branchLen: rng.int(14, 20),
    band: rng.int(24, 28),
    foodFloor: rng.int(1, FLOORS),
    escAt: rng.range(0.1, 0.3), liftAt: rng.range(0.62, 0.8),
  };
}

/**
 * Task studio-mall-layout-variety-20261117-005520-01: the frame of a version-2 plan family (its own salt: the atrium frames' draws are
 * untouched). The station block, the arrival court and the shared sizes keep the atrium family's ranges; `plan` carries the family's own.
 */
function planMallFrame(levelSeed: number, variant: MallPlanVariant, salt: number): MallFrame {
  const rng = new Rng(hashString(`mall-plan-frame-v1:${variant}${salt ? `:${salt}` : ''}`, levelSeed >>> 0));
  const galleria = variant === 'galleria', cross = variant === 'crossroads', prom = variant === 'promenade';
  const plan: MallPlanFrame = {
    slot: galleria ? rng.int(14, 18) : cross ? rng.int(12, 16) : rng.int(8, 10),
    balcony: galleria ? rng.int(9, 11) : cross ? rng.int(8, 10) : rng.int(9, 11),
    reachW: galleria ? rng.int(40, 54) : cross ? rng.int(30, 44) : rng.int(36, 48),
    reachE: galleria ? rng.int(40, 54) : cross ? rng.int(30, 44) : rng.int(36, 48),
    reachS: cross ? rng.int(28, 38) : prom ? rng.int(24, 34) : 0,
    bridges: galleria ? rng.int(2, 3) : cross ? 1 : 0,
    bridgeW: rng.int(7, 9),
    promW: prom ? rng.int(16, 20) : 0,
    glazed: galleria ? (rng.chance(0.5) ? 'W' : 'E') : cross ? (rng.chance(0.5) ? 'W' : 'E') : 'S',
    street: galleria ? 'S' : cross ? 'S' : (rng.chance(0.5) ? 'W' : 'E'),
  };
  return {
    levelSeed: levelSeed >>> 0, variant, name: mallNameOf(levelSeed),
    Lp: rng.int(104, 124),
    // the station opening: a modest look-up column (the galleria's is its nave's middle bay; the crossroads' its crossing)
    VW: galleria ? rng.int(28, 36) : cross ? rng.int(22, 28) : rng.int(18, 24), atX: rng.range(0.4, 0.6),
    nOff: rng.int(2, 3), bedOver: galleria ? rng.int(1, 3) : cross ? rng.int(4, 8) : rng.int(3, 6),
    step2: cross ? [rng.int(3, 5), rng.int(3, 5), 0, rng.int(3, 5)] : [0, 0, 0, 0],
    step3: cross ? [rng.int(2, 3), rng.int(2, 3), 0, rng.int(2, 3)] : [0, 0, 0, 0],
    notch: null, bay: null,
    gW: rng.int(8, 10), gE: rng.int(8, 10), gS: rng.int(8, 10),
    WW: rng.int(12, 14),
    wingA: rng.int(30, 36), wingB: rng.int(30, 36), wingOff: 0, branchLen: rng.int(14, 20),
    band: rng.int(24, 28),
    foodFloor: rng.int(1, FLOORS),
    escAt: rng.range(0.1, 0.3), liftAt: rng.range(0.62, 0.8),
    plan,
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
