// Task track3-eaton-centre-20261031 (lane GEN): THE EATON'S CENTER — the MALL FRAME: the seeded named variant and every dimension
// the ONE continuous mall layout shares (pure data; derived from the LEVEL seed only, before any carving).
//
// World frame (the Office's conventions): x east, z south, y up, metres; CELL = 0.5 m. layout.levels[0] = the subway station at the
// bottom of the pit (y 0), layout.levels[k] = retail ring k (k = 1..6) at y = STOREY * k. Every storey grid has the same size and
// origin; the void (atrium) outline, the gallery ring, the shop bands, the service-corridor loop and the corner stair cores are at
// the SAME X/Z on every ring.
//
// Plan (canvas cells; every ring identical, the station below):
//
//   ┌──────────────────────── service corridor loop (CW wide, all four sides) ─────────────────────────┐
//   │ ┌ core ┐ ┌──────── N shop band: backrooms (Db) / sales floors (Ds), shopfronts on the gallery ───┐ ┌ core ┐ │
//   │ │ NW   │ │                                                                                          │ │ NE   │ │
//   │ └──────┘ └──────────────────────────────────────────────────────────────────────────────────────────┘ └──────┘ │
//   │ ┌ W  ┐  ┌─ GR: gallery ring (walkways >= 4 m, escalator / stair wells) around the VOID ─────────────┐  ┌ E  ┐ │
//   │ │band│  │            ┌──────────────── VOID (open from the station floor to the glass roof) ────────┐ │  │band│ │
//   │ │    │  │            └───────────────────────────────────────────────────────────────────────────────┘ │  │    │ │
//   │ └────┘  └─────────────────────────────────────────────────────────────────────────────────────────────────┘  └────┘ │
//   │ ┌ core ┐ ┌──────── S shop band ──────────────────────────────────────────────────────────────────────┐ ┌ core ┐ │
//   └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Station (level 0): two side platforms on ONE double track bed along X (the shared Kit.sideBlock, so the pre-crop Kit carries
// k.trenches for Track2) lie under the void; the north / south COURTS (y 0) adjoin the platforms' back edges with no wall and run
// out under the ring-1 galleries; the bed continues as tunnels under the end galleries (tunnel mouths = the bed ends).

import {Rng, hashString} from '../../core/rng';
import {transitSpecs} from '../traversal';

/** Named seeded layout variants (layout.mall.variant). */
export type MallVariant = 'galleria' | 'oval-court' | 'cross-galleria';
export const MALL_VARIANTS: readonly MallVariant[] = ['galleria', 'oval-court', 'cross-galleria'];

/** Retail rings above the station (mallTypes.ts MALL_RINGS). */
export const RINGS = 6;
/** Storey height (m): ring k floor = STOREY * k; the station platforms are at y 0. */
export const STOREY = 5.0;
/** Clear heights above a storey floor (m): galleries, shop sales floors, backrooms, service corridor / cores, station courts. */
export const CLEAR = {gallery: 4.2, shop: 4.0, back: 3.2, corridor: 3.0, core: 3.0, court: 4.6, platform: 4.4, door: 2.3, shopfront: 3.4, core0: 4.4};
/** Glass roof over the void: springing line above the top ring's floor (m); vault rise as a fraction of the void width. */
export const ROOF = {spring: 6.0, riseFrac: 0.34, archSpacing: 6.0};
/** Canvas: generous room east / south of the mall for Track2's tunnels / annexes (fixed crop origin: grow east / south only). */
export const MALL_CANVAS = {w: 400, h: 300, levels: RINGS + 1, org: 8};
/** SOLID cells kept between the crop edge and the outermost carved floor (>= 2 per the Track2 contract; + the outer wall). */
export const CROP_MARGIN = 3;
/** Public vertical runs (escalators / stairs) climb one storey at the transit pitch (30 degrees): run length in cells. */
export const RUN = transitSpecs(STOREY);
export const RUN_CELLS = RUN.cells;
/** Escalator lane width (cells: 1.5 m = step band + balustrades), banks of two lanes; public stair lane width. */
export const LANE = {escalator: 3, stair: 5};
/** Gallery depth (cells) from the void bbox to the shopfront line: long (N / S) sides carry the escalator wells, ends the stairs. */
export const GALLERY = {long: 14, end: 14, strip: 6, walkway: 8};
/** Service corridor width (cells). */
export const CORRIDOR = 5;
/** Corner stair core (cells): two 4-cell lanes + a 1-cell divider; 3-cell landings at both ends. */
export const CORE = {lane: 4, divider: 1, landing: 3};

export interface VoidRect { x0: number; z0: number; x1: number; z1: number }

export interface MallFrame {
  levelSeed: number;
  variant: MallVariant;
  name: string;
  /** Void length / width of its main rect (cells) and the variant's extra rects (canvas cells, absolute after placement). */
  VL: number;
  /** Shop sales depth / backroom depth (cells); D = Ds + 1 + Db. */
  Ds: number; Db: number; D: number;
  /** Bridge storeys (rings that carry a bridge across the void). */
  bridgeRings: number[];
  /**
   * Glass elevators: ONE multi-stop cab (the Office ElevatorLogic / towerRuntime, which runs one cab per world) at the void edge of
   * the `liftSide` long gallery; its position along the void is seeded (`liftAt`).
   */
  elevators: number;
  liftSide: 'N' | 'S';
  liftAt: number;
  /** Arm / tier extension of the void beyond its main rect (cells, z). */
  AE: number;
  /** Apse / tier inset (cells). */
  inset: number;
  /** Fraction positions of the two escalator slots along the void (west / east). */
  escA: number; escB: number;
  /** Anchor (department store) placement: ring -> band side. */
  anchors: {ring: number; side: 'N' | 'S'}[];
}

const NAMES = ["The Eaton's Center"];

/** Session-only QA override of the variant (main.ts `?mallVariant=galleria|oval-court|cross-galleria`); undefined = the seed's. */
let variantOverride: MallVariant | undefined;
export function setMallVariantOverride(v: string | null | undefined): MallVariant | undefined {
  variantOverride = (MALL_VARIANTS as readonly string[]).includes(v ?? '') ? v as MallVariant : undefined;
  return variantOverride;
}

/** The variant of a level seed (deterministic; tests / QA may force one through generateMallLevel's options / the override). */
export function mallVariantOf(levelSeed: number): MallVariant {
  return variantOverride ?? MALL_VARIANTS[hashString('mall-variant', levelSeed >>> 0) % MALL_VARIANTS.length];
}

/**
 * The mall frame of a level seed (optionally forcing the variant). `salt` > 0 re-rolls the frame's free parameters (sizes, slot /
 * lift / bridge positions) of the SAME variant: generateMallLevel moves to the next salt when a frame's program does not fit.
 */
export function mallFrame(levelSeed: number, variant: MallVariant = mallVariantOf(levelSeed), salt = 0): MallFrame {
  const rng = new Rng(hashString(`mall-frame-v1:${variant}${salt ? `:${salt}` : ''}`, levelSeed >>> 0));
  const Ds = rng.int(20, 24), Db = rng.int(8, 10);
  // Void length (cells): the galleria is the long one (the reference photo), the oval court shorter and wider (its tiers), the
  // cross-galleria long with a transverse arm.
  const VL = variant === 'galleria' ? rng.int(140, 160) : variant === 'oval-court' ? rng.int(112, 128) : rng.int(132, 150);
  const AE = variant === 'galleria' ? 0 : variant === 'oval-court' ? rng.int(8, 10) : rng.int(10, 14);
  const inset = variant === 'galleria' ? rng.int(12, 16) : variant === 'oval-court' ? rng.int(14, 18) : rng.int(22, 28);
  const bridgeRings = variant === 'galleria' ? [2, 4] : variant === 'oval-court' ? [3] : [2, 5];
  const anchors: MallFrame['anchors'] = [];
  for (let ring = 1; ring <= RINGS; ring++) if (ring % 2 === 1 || rng.chance(0.35)) anchors.push({ring, side: rng.chance(0.5) ? 'N' : 'S'});
  return {
    levelSeed: levelSeed >>> 0, variant, name: NAMES[0], VL, Ds, Db, D: Ds + 1 + Db, bridgeRings,
    elevators: 1, liftSide: variant === 'oval-court' ? 'S' : rng.chance(0.5) ? 'N' : 'S', liftAt: rng.range(0.4, 0.5), AE, inset,
    escA: rng.range(0.14, 0.2), escB: rng.range(0.6, 0.66), anchors,
  };
}

/** Layout seed of the mall level. */
export function mallSeed(levelSeed: number): number {
  return hashString('mall:main', levelSeed >>> 0) >>> 0;
}

/** HUD storey label of a mall layout level ('Subway', 'Level 1' … 'Level 6'). */
export function mallStoreyLabel(level: number): string {
  return level === 0 ? 'Subway' : `Level ${level}`;
}
