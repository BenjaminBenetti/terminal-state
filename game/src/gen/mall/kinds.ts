// Task track3-eaton-centre-20261031 (lane SHOPS): the NEW shop-fixture prop kinds of The Eaton's Center — pure data (no three.js),
// merged into gen/office/kinds.ts OFFICE_KINDS like the company / clutter kinds (so PROP_DEFS, the damage specs, the office render
// path world/officeProps.ts, the physics table gen/office/physics.ts OFFICE_PHYS and the openables audit OFFICE_OPEN_AUDIT all pick
// them up, typed: a mall kind does not compile until it is classified in each).
//
// Most of a mall interior REUSES the existing catalogue (storefront counters / displays / back counters / coolers, stock shelving,
// steel shelving, cabinets, crates, staff lockers, safes, the office / company furniture: clothing rails, dress forms, sneaker walls,
// arcade cabinets, sofas, exam tables ...). These kinds fill the gaps a real mall needs and nothing existing reads as:
//
//  holders (open loot surfaces; static — a holder never floats its finite lots):
//   - glassCounter  glass display counter on a solid plinth (gun / jewellery / optical / phone / cosmetics counters): felt deck +
//                   glass shelf INSIDE the case, the staff side open (no doors): role 'surface', class 'open';
//   - merchTable    two-tier merchandising table (clothing / books / home / gifts): top + lower shelf;
//   - wallBay       slatwall shelving bay (clothing / shoes / toys / sports / beauty / books): five shelves on a slatwall back;
//   - produceStand  tiered produce stand (grocery): two angled bin decks;
//   - bookstoreBookcase  open timber bookcase, EMPTY (books are not items; lane ASSETS' M09 model swaps in when delivered).
//  fixtures / furniture:
//   - gunDisplay    felt-topped display bench of the gun shop: the mall weapon plan's finds lie ON it (layout pickups,
//                   gen/mall/shopsWeapons.ts), it is not a loot holder (no lots compete for its top);
//   - gunRack       EMPTY floor-standing long-gun rack (M14: cradle shelf + hook bars, its modelled rifles removed): anchored, nothing
//                   to open (the real guns are the weapon plan's finds);
//   - fittingRooms  two curtained fitting cubicles (partitions, bench, mirror): static partition block;
//   - tvWall        bank of six display screens on a floor-standing frame (electronics; lane ASSETS M41 stands on feet against
//                   the wall): anchored equipment;
//   - displayBed    bed frame + mattress (home store floor model);
//   - ottoman       upholstered try-on ottoman (shoes / clothing): light, DYNAMIC (shoved when walked into / shot);
//   - salonChair    hydraulic salon / barber chair bolted to the floor (beauty / service);
//   - kiddieRide    coin-operated kiddie ride (toys / arcade; M50 a cartoon car on a rocking pedestal): locked coin box, too heavy;
//   - tentDisplay   pitched display tent pegged to its plinth (outdoors);
//   - garmentRail   EMPTY chrome garment rail on castors (clothing / department / sports / outdoors): light, DYNAMIC. The office
//                   clothing rack / sneaker wall / law bookcase (baked garments / shoes / books) are NOT used in the mall (rule 4).
//
// No loose items are baked into any of them (root CLAUDE.md rule 4): the counters, tables, bays and stands are EMPTY fixtures; what
// lies on them is real loot (items/loot.ts) or real props. Procedural box forms (mallShape) render until lane ASSETS delivers a model
// for a kind (MALL_KIND_ASSET: asset id -> lazy library key officeModelKey(id) = `office-<id>`, file faces -Z like every office /
// company GLB; footprints switch to the delivered model's measured dims through MALL_MODEL_DIMS). Dimensions are real-world sizes
// (rule 5): counters 1.0 m, tables 0.84 m, bay 2.2 m, bed top 0.55 m, seat 0.42 / 0.5 m.

import type {PropDef, SurfaceSpec} from '../props';
import type {ShapeMat, ShapePart} from '../propShapes';
import type {DamageClass, PhysMat, StaticWhy} from '../../damage/materials';
// Lane ASSETS' three-free measured bounds of the DELIVERED mall models (rewritten by tools/asset-pipeline/props/build-mall-track3.mjs).
import {MALL_DIMS} from '../../assets/mallDims.generated';

interface MallKindSpec {
  /** Nominal real-world box [w (x), d (z), h (y)] m (the procedural form is built to it; a delivered model's dims replace it). */
  box: readonly [number, number, number];
  blocksSight?: boolean;
  cls: DamageClass;
}

const SPECS = {
  // --- holders (open surfaces) ---
  glassCounter: {box: [1.5, 0.706, 1.355], cls: 'glass'},
  merchTable: {box: [1.6, 0.9, 0.84], cls: 'laminate'},
  wallBay: {box: [1.2, 0.5, 2.2], cls: 'laminate'},
  produceStand: {box: [1.6, 0.919, 1.14], cls: 'wood'},
  bookstoreBookcase: {box: [1.2, 0.547, 2.257], blocksSight: true, cls: 'wood'},
  // --- fixtures / furniture ---
  gunDisplay: {box: [1.4, 0.7, 0.9], cls: 'wood'},
  gunRack: {box: [2.0, 0.308, 1.476], cls: 'steel'},
  fittingRooms: {box: [2.4, 1.5, 2.2], blocksSight: true, cls: 'laminate'},
  tvWall: {box: [2.4, 0.15, 1.4], cls: 'plastic'},
  displayBed: {box: [1.6, 2.1, 1.05], cls: 'fabric'},
  ottoman: {box: [0.9, 0.45, 0.42], cls: 'fabric'},
  salonChair: {box: [0.7, 0.7, 1.1], cls: 'steel'},
  kiddieRide: {box: [0.9, 1.3, 1.3], cls: 'plastic'},
  tentDisplay: {box: [2.2, 2.2, 1.5], cls: 'fabric'},
  garmentRail: {box: [1.5, 0.6, 1.55], cls: 'steel'},
  // delivered by lane ASSETS (batch 1): a full-figure display mannequin (M07) and a flat-screen TV on its stand (M10, on display tables)
  mannequinFull: {box: [0.449, 0.447, 1.85], cls: 'plastic'},
  flatScreenTv: {box: [1.23, 0.5, 0.819], cls: 'plastic'},
  // M06: a group of garments on hangers, hung on a garment rail (decor filler separated from the rail: root CLAUDE.md rule 4)
  garmentHangingGroup: {box: [0.89, 0.59, 0.85], cls: 'fabric'},
  // M05: an empty round garment rack (chrome ring on a centre post, castor base)
  garmentRailRound: {box: [1.2, 1.19, 1.545], cls: 'steel'},
  // --- lane ASSETS batch 1, the rest (lanes/ASSETS.notes section 10): every kind renders its delivered model; the boxes below are the
  // measured runtime bounds (MALL_DIMS replaces them) and the procedural fallback forms are built to them ---
  /** M01 till / back counter: wall-backed (oak screen to the wall), 5 drawers + a cupboard + an open niche + hutch to the room. */
  mallCashwrapCounter: {box: [2.0, 0.781, 2.043], blocksSight: true, cls: 'wood'},
  /** M02 glass display cabinet: 2 hinged glass-frame doors over 5 glass shelves (the panes are open frames: contents visible). */
  glassDisplayCabinet: {box: [0.918, 0.696, 1.9], blocksSight: true, cls: 'glass'},
  /** M03 single-sided gondola section (thin back at -Z in the prop frame): back-to-back pairs make a double-sided aisle run. */
  retailGondola: {box: [1.95, 0.493, 1.4], cls: 'sheetMetal'},
  /** M08 open clothing bay: back panel, a rail at 1.915 m (garment groups hang on it) and two top cubbies. */
  clothingWallUnit: {box: [2.4, 0.789, 2.373], blocksSight: true, cls: 'wood'},
  /** M11 pharmacy dispensary back counter: 4-drawer stack, 5 cupboard doors, a tall mirror-door cupboard, an open hutch shelf. */
  pharmacyDispensaryCounter: {box: [3.2, 0.692, 2.562], blocksSight: true, cls: 'laminate'},
  /** M12 checkout lane: a long counter with a belt deck (0.9 m), closed side panels, an empty bagging well at its +X end. */
  checkoutLane: {box: [2.6, 0.849, 0.898], cls: 'laminate'},
  /** M16 pipe-and-plank shelving: three planks on pipe posts. */
  outdoorsPlankShelving: {box: [1.5, 0.481, 1.742], cls: 'wood'},
  /** M17 mall kiosk cart: a 2-door lower cabinet, an open double-sided display box above, a canopy, push handles. */
  mallKioskCart: {box: [2.5, 1.46, 1.707], cls: 'laminate'},
  /** M18 storage tote: its two lid flaps are modelled RAISED OPEN over an inner tray (0.376 m). */
  storageTote: {box: [0.6, 0.59, 0.627], cls: 'plastic'},
  /** M19 shoe wall display: 6 shallow ledge rows in 3 columns on a wall panel. */
  shoeWallDisplay: {box: [2.0, 0.225, 1.995], cls: 'laminate'},
  /** M20 food-court table set: a table (top 0.75 m) and four stools on one floor-fixed frame. */
  foodCourtTableSet: {box: [1.499, 1.484, 0.75], cls: 'laminate'},
  // --- lane ASSETS batch 2 (lanes/ASSETS.notes section 12): M24 ottoman, M36 tent, M41 TV bank, M50 kiddie ride, M51 salon chair and M52
  // bed render their models through the existing kinds above; M29 is a new kind ---
  /** M29 medicine drawer cabinet: a 3 x 11 grid of small drawers + a top cupboard (left), one full-height door over an inner drawer
   *  bank and three shelves (right). */
  medicineDrawerCabinet: {box: [0.936, 0.65, 1.9], blocksSight: true, cls: 'sheetMetal'},
  // --- task track3 (lane ARCH): landmarks / navigation (gen/mall/landmarks.ts places them, world/mallArch.ts draws them) ---
  /** Pit-plaza fountain basin: square stone basin with a 0.4 m sitting ledge (half size 1.6 m; a 1.25 m fallback). */
  fountainBasin: {box: [3.2, 3.2, 0.5], cls: 'terrazzo'},
  /** The fountain's tiered bronze centrepiece: round bowls on a column (inside the basin; collider = the widest bowl's square). */
  fountainSpire: {box: [1.7, 1.7, 2.3], cls: 'steel'},
  /** Freestanding directory pylon (both faces: the storey plan with a "You are here" dot). */
  directoryPylon: {box: [0.9, 0.3, 2.1], cls: 'sheetMetal'},
} as const satisfies Record<string, MallKindSpec>;

export type MallKind = keyof typeof SPECS;
export const MALL_KINDS = Object.keys(SPECS) as MallKind[];
export function isMallKind(kind: string): kind is MallKind {
  return kind in SPECS;
}

/** Holder kinds among them (items/loot.ts SURFACE_KINDS; their surfaces: MALL_SURFACES). */
export const MALL_HOLDER_KINDS = ['glassCounter', 'merchTable', 'wallBay', 'produceStand',
  // lane ASSETS batch 1 open holders
  'retailGondola', 'clothingWallUnit', 'checkoutLane', 'outdoorsPlankShelving', 'storageTote', 'shoeWallDisplay', 'foodCourtTableSet'] as const satisfies readonly MallKind[];
/** Openable mall containers (world/openablesSpec.ts OPENABLE_SPECS; derived drawers / doors measured on their models). */
export const MALL_OPENABLE_KINDS = ['bookstoreBookcase', 'mallCashwrapCounter', 'glassDisplayCabinet', 'pharmacyDispensaryCounter', 'mallKioskCart',
  'medicineDrawerCabinet'] as const satisfies readonly MallKind[];
export type MallOpenableKind = (typeof MALL_OPENABLE_KINDS)[number];
export type MallHolderKind = (typeof MALL_HOLDER_KINDS)[number];
export function isMallHolderKind(kind: string): kind is MallHolderKind {
  return (MALL_HOLDER_KINDS as readonly string[]).includes(kind);
}
/** Kinds hung on a wall with gen/placeKit.ts mountProp (base `MALL_MOUNT_Y` above the floor). */
export const MALL_MOUNT_Y: Readonly<Partial<Record<MallKind, number>>> = {}; // (the delivered M14 gun rack and M41 TV bank stand on the floor)

/**
 * Lane ASSETS hook: asset id a kind renders with once its Meshy model is delivered (assets/mallAssets.ts; library key
 * `office-<assetId>`, the file faces -Z). Empty until a model lands: the procedural forms below render meanwhile.
 */
export const MALL_KIND_ASSET: Readonly<Partial<Record<MallKind, string>>> = {
  // batch 1 (lane ASSETS DELIVERED.json): M09 the empty bookcase (its shelf decks measured: MALL_SURFACES below), M07, M10
  bookstoreBookcase: 'bookstore-bookcase', mannequinFull: 'mannequin-full', flatScreenTv: 'flat-screen-tv', garmentHangingGroup: 'garment-hanging-group',
  // batch 1 group 2-3: M04 the wall bay (its decks measured: WALL_BAY_DECKS), M05 the round garment rack
  wallBay: 'retail-wall-bay', garmentRailRound: 'garment-rail-round',
  // batch 1 complete (lanes/ASSETS.notes section 10): the remaining fixtures
  mallCashwrapCounter: 'mall-cashwrap-counter', glassDisplayCabinet: 'glass-display-cabinet', retailGondola: 'retail-gondola', clothingWallUnit: 'clothing-wall-unit',
  pharmacyDispensaryCounter: 'pharmacy-dispensary-counter', checkoutLane: 'checkout-lane', produceStand: 'produce-display-stand', gunRack: 'gun-wall-rack',
  glassCounter: 'glass-display-counter', outdoorsPlankShelving: 'outdoors-plank-shelving', mallKioskCart: 'mall-kiosk-cart', storageTote: 'storage-tote',
  shoeWallDisplay: 'shoe-wall-display', foodCourtTableSet: 'food-court-table-set',
  // batch 2 (lanes/ASSETS.notes section 12; M35 / M45 / M47 and the rest NOT delivered: their kinds keep their existing forms)
  ottoman: 'try-on-ottoman', tentDisplay: 'camping-tent-display', tvWall: 'tv-wall-bank', kiddieRide: 'kiddie-ride', salonChair: 'salon-styling-chair',
  displayBed: 'bed-display', medicineDrawerCabinet: 'medicine-drawer-cabinet',
};
/** Lane ASSETS hook: a delivered model's measured bounds [x, y, z] (m) by asset id (assets/mallDims.generated.ts MALL_DIMS). */
export const MALL_MODEL_DIMS: Readonly<Record<string, readonly [number, number, number]>> = MALL_DIMS;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
function defOf(k: MallKind): PropDef {
  const s: MallKindSpec = SPECS[k];
  const id = MALL_KIND_ASSET[k];
  const dims = id ? MALL_MODEL_DIMS[id] : undefined;
  const [w, d, h] = dims ? [dims[0], dims[2], dims[1]] : s.box;
  return {w: r3(w), d: r3(d), h: r3(h), blocksSight: s.blocksSight ?? false};
}
export const MALL_PROP_DEFS = Object.fromEntries(MALL_KINDS.map(k => [k, defOf(k)])) as Record<MallKind, PropDef>;

/** Damage specs (spread into gen/office/kinds.ts OFFICE_PROP_DAMAGE): fixtures never break. */
export const MALL_PROP_DAMAGE = Object.fromEntries(MALL_KINDS.map(k => [k, {cls: SPECS[k].cls as DamageClass, integrity: Infinity, breaks: 'never' as const}])) as
  Record<MallKind, {cls: DamageClass; integrity: number; breaks: 'never'}>;

// ---------------------------------------------------------------------------------------------
// Loot surfaces of the holder kinds (prop frame, metres; items/lootLayout.ts adds the +2 mm). Built to the procedural forms below.

/**
 * Glass counter (lane ASSETS M15, measured on mall-glass-display-counter.glb in the prop frame, vertical ray casts): a wooden base to the
 * front felt deck 0.434 (z 0.13..0.30) under the sloped glass, a raised staff-side shelf 0.893 (z -0.342..0.121) under the glass top 1.06
 * (z -0.353..0.068), two sign posts to 1.355. The glass panes have no geometry (the case is open: its staff side has no doors).
 */
export const GLASS_COUNTER = {deckY: 0.434, shelfY: 0.893, topY: 1.06} as const;
/** Top of the gun display bench (weapon finds lie here; prop-relative). */
export const GUN_DISPLAY_TOP = 0.9;
/**
 * Wall bay decks (prop-relative) measured on the delivered M04 model (mall-retail-wall-bay.glb, 1.2 x 2.2 x 0.5 m, upward faces in the
 * prop frame): a deep base deck 0.19 (z -0.236..0.25), three shallow shelves 0.52 / 0.80 / 1.08 (z -0.236..0.03) and a deep shelf 1.37
 * (z -0.236..0.199) under the slatwall header (to 2.2). The procedural fallback is built to the same decks: [y, front z].
 */
const WALL_BAY_DECKS: readonly (readonly [number, number])[] = [[0.19, 0.23], [0.52, 0.02], [0.8, 0.02], [1.08, 0.02], [1.37, 0.18]];
/**
 * Bookcase shelf decks (prop-relative) measured on the delivered M09 model (mall-bookstore-bookcase.glb, upward faces in the prop frame
 * after the half turn: decks 0.36 / 0.85 / 1.25 / 1.63 over x +-0.547, z -0.199..0.199; the top board's underside ~2.20). The
 * procedural fallback is built to the same decks.
 */
const BOOKCASE_TIERS = [0.36, 0.85, 1.25, 1.63, 2.2] as const;
/** M03 gondola decks [y, front z] (prop frame). */
const GONDOLA_DECKS: readonly (readonly [number, number])[] = [[0.18, 0.2], [0.36, 0.12], [0.63, 0.12], [0.8, 0.12], [0.98, 0.12], [1.18, 0.12]];
/** Rail height (prop-relative) garment groups hang from, per rail host (M05 ring 1.31 m, M08 rail 1.915 m). */
export const GARMENT_RAIL_Y: Readonly<Partial<Record<MallKind, number>>> = {garmentRail: 1.53, garmentRailRound: 1.31, clothingWallUnit: 1.915};

/** Exposed loot surfaces of the open mall holders and of the bookcase (an openable container: its shelves + its drawers' trays). */
export const MALL_SURFACES: Readonly<Record<MallHolderKind | MallOpenableKind, readonly SurfaceSpec[]>> = {
  glassCounter: [
    {y: GLASS_COUNTER.deckY, x0: -0.67, x1: 0.67, z0: 0.14, z1: 0.29, clear: 0.3},
    {y: GLASS_COUNTER.shelfY, x0: -0.67, x1: 0.67, z0: -0.32, z1: 0.1, clear: 0.15},
    {y: GLASS_COUNTER.topY, x0: -0.67, x1: 0.67, z0: -0.33, z1: 0.05, clear: 0.28},
  ],
  merchTable: [
    {y: 0.84, x0: -0.72, x1: 0.72, z0: -0.37, z1: 0.37, clear: 0.5},
    {y: 0.2625, x0: -0.66, x1: 0.66, z0: -0.33, z1: 0.33, clear: 0.5},
  ],
  wallBay: WALL_BAY_DECKS.map(([y, zf], i) => ({y, x0: -0.55, x1: 0.55, z0: -0.22, z1: zf, clear: r3(Math.min(0.5, (WALL_BAY_DECKS[i + 1]?.[0] ?? 1.9) - y - 0.03))})),
  // M13 crate tiers (upward faces: 0.18 / 0.48 / 0.93 over x +-0.73, z -0.427..0.43; the top tier to z 0.36)
  produceStand: [
    {y: 0.18, x0: -0.7, x1: 0.7, z0: -0.41, z1: 0.41, clear: 0.27},
    {y: 0.48, x0: -0.7, x1: 0.7, z0: -0.41, z1: 0.41, clear: 0.42},
    {y: 0.93, x0: -0.7, x1: 0.7, z0: -0.41, z1: 0.34, clear: 0.4},
  ],
  bookstoreBookcase: BOOKCASE_TIERS.slice(0, 4).map((y, i) => ({y, x0: -0.52, x1: 0.52, z0: -0.18, z1: 0.18, clear: r3(BOOKCASE_TIERS[i + 1] - y - 0.03)})),
  // --- lane ASSETS batch 1 (measured on the runtime GLBs: upward faces in the prop frame + vertical / horizontal ray casts) ---
  // M03 gondola: base deck 0.18, shelves 0.36 / 0.63 / 0.80 / 0.98 / 1.18 (z -0.235..0.135), back panel at z -0.24
  retailGondola: GONDOLA_DECKS.map(([y, z1], i) => ({y, x0: -0.93, x1: 0.93, z0: -0.22, z1, clear: r3(Math.min(0.22, (GONDOLA_DECKS[i + 1]?.[0] ?? 1.42) - y - 0.05))})),
  // M08 clothing bay: the two top cubbies (floor 2.065, divider at x 0); its rail (1.915) carries garment groups, not loot
  clothingWallUnit: [
    {y: 2.065, x0: -1.13, x1: -0.06, z0: -0.32, z1: 0.36, clear: 0.24},
    {y: 2.065, x0: 0.06, x1: 1.13, z0: -0.32, z1: 0.36, clear: 0.24},
  ],
  // M12 checkout lane: the belt deck (plane 0.89 over x -1.30..1.26, z +-0.36, inside a 0.90 rim)
  checkoutLane: [{y: 0.89, x0: -1.22, x1: 1.2, z0: -0.32, z1: 0.32, clear: 0.5}],
  // M16 plank shelving: planks 0.41 / 0.87 (z -0.217..0.24) and the top plank 1.14
  outdoorsPlankShelving: [
    {y: 0.41, x0: -0.67, x1: 0.67, z0: -0.2, z1: 0.22, clear: 0.42},
    {y: 0.87, x0: -0.67, x1: 0.67, z0: -0.2, z1: 0.22, clear: 0.24},
    {y: 1.14, x0: -0.7, x1: 0.7, z0: -0.22, z1: 0.22, clear: 0.5},
  ],
  // M18 tote: the inner tray (0.376; walls at +-0.24, the raised lid flaps above the rim)
  storageTote: [{y: 0.376, x0: -0.22, x1: 0.22, z0: -0.22, z1: 0.22, clear: 0.15}],
  // M19 shoe wall: ledges 0.30 / 0.54 / 1.01 / 1.24 full width, 0.78 left two columns, 1.46 centre column (z -0.11..0.113)
  shoeWallDisplay: ([[0.3, -0.97, 0.97], [0.54, -0.97, 0.97], [0.78, -0.96, 0.31], [1.01, -0.97, 0.97], [1.24, -0.97, 0.97], [1.46, -0.3, 0.31]] as const)
    .map(([y, x0, x1]) => ({y, x0, x1, z0: -0.1, z1: 0.1, clear: y === 1.46 ? 0.3 : 0.19})),
  // M20 table set: the table top
  foodCourtTableSet: [{y: 0.75, x0: -0.42, x1: 0.42, z0: -0.42, z1: 0.42, clear: 0.5}],
  // --- exposed surfaces of the openable containers (their compartments: world/openablesSpec.ts) ---
  // M01: counter top 0.951 in front of the hutch screen, the open niche 0.689 (left column), the two hutch shelves 1.16 / 1.344
  mallCashwrapCounter: [
    {y: 0.951, x0: -0.95, x1: 0.95, z0: -0.14, z1: 0.35, clear: 0.5},
    {y: 0.689, x0: -0.8, x1: -0.18, z0: -0.36, z1: 0.3, clear: 0.18},
    {y: 1.16, x0: -0.86, x1: 0.86, z0: -0.36, z1: -0.18, clear: 0.12},
    {y: 1.344, x0: -0.86, x1: 0.86, z0: -0.36, z1: -0.18, clear: 0.5},
  ],
  // M02: none exposed (every shelf is behind a door)
  glassDisplayCabinet: [],
  // M29: none exposed (drawers, the top cupboard and the door bay; its 1.9 m top is out of reach)
  medicineDrawerCabinet: [],
  // M11: counter top 0.951 (in front of the hutch back), the open hutch shelf 2.054
  pharmacyDispensaryCounter: [
    {y: 0.951, x0: -1.36, x1: 1.34, z0: -0.27, z1: 0.32, clear: 0.5},
    {y: 2.054, x0: -0.8, x1: 1.3, z0: -0.29, z1: -0.03, clear: 0.38},
  ],
  // M17: the open display box (deck 0.646, shelves 0.793 / 0.917 / 1.051) on both long sides of its centre divider
  mallKioskCart: ([0.646, 0.793, 0.917, 1.051] as const).flatMap(y => [
    {y, x0: -0.48, x1: 0.78, z0: 0.12, z1: 0.33, clear: 0.1},
    {y, x0: -0.48, x1: 0.78, z0: -0.26, z1: -0.04, clear: 0.1},
  ]),
};

// ---------------------------------------------------------------------------------------------
// Physics affordance (gen/office/physics.ts OFFICE_PHYS spreads these; damage/physicsAudit.ts PROP_PHYSICS_AUDIT reads them).

type MallPhys = {dynamic: true; mass: number; mat: PhysMat; how: string; onHost?: boolean; fit?: number} | {dynamic: false; why: StaticWhy; how: string};
const S = (why: StaticWhy, how: string): MallPhys => ({dynamic: false, why, how});

export const MALL_PHYS = {
  glassCounter: S('holder', 'glass display counter on a solid plinth (~120 kg): a loot holder stays put so its finite lots never float'),
  merchTable: S('holder', 'merchandising table (~35 kg) holding loot on its top and shelf: a holder stays put so its finite lots never float'),
  wallBay: S('holder', 'slatwall shelving bay fixed to the wall: a loot holder (its finite lots never float)'),
  produceStand: S('holder', 'timber produce stand (~60 kg) holding loot in its bins: a holder stays put'),
  bookstoreBookcase: S('holder', 'tall timber bookcase (~45 kg) screwed to the wall, loot on its shelves: a holder stays put'),
  gunDisplay: S('built-in', 'felt-topped display bench bolted to the gun shop floor; weapon finds lie on it, so it never moves under them'),
  gunRack: S('anchored', 'empty floor-standing steel long-gun rack (M14) bolted to the floor and the wall behind it'),
  fittingRooms: S('partition', 'fitting cubicles: partition walls fixed to the floor and ceiling track'),
  tvWall: S('anchored', 'bank of six display screens on a floor-standing steel frame (M41, ~80 kg) on feet, bolted to the wall behind it'),
  displayBed: S('too heavy', 'bed frame with a mattress (~70 kg, no castors): a bump cannot slide it'),
  ottoman: {dynamic: true, mass: 12, mat: 'pad', how: 'upholstered try-on ottoman (~12 kg): shoved aside when walked into, slides / tips under buckshot'},
  salonChair: S('anchored', 'hydraulic salon chair bolted to the floor (~60 kg)'),
  kiddieRide: S('too heavy', 'coin-operated kiddie ride (M50: a cartoon car on its rocking pedestal, ~90 kg with the motor and coin box): a bump or a shot cannot slide it'),
  tentDisplay: S('anchored', 'display tent guyed and screwed down to its timber plinth'),
  garmentRail: {dynamic: true, mass: 14, mat: 'castor', how: 'empty chrome garment rail on castors (~14 kg): rolls away when walked into, slides / tips when shot'},
  // (collider 1.2x its slim model box: the shoulders / base plate the walker meets first — a 0.45 m box let the camera clip 16 cm in)
  mannequinFull: {dynamic: true, mass: 7, mat: 'pad', fit: 1.2, how: 'full-figure hollow plastic display mannequin on a base (~7 kg, tall and narrow): tips over when shot or bumped'},
  garmentRailRound: {dynamic: true, mass: 18, mat: 'pad', how: 'empty round chrome garment rack (~18 kg): shoved across the floor when walked into, slides / tips when shot'},
  garmentHangingGroup: S('host decor', 'garments on hangers riding their garment rail (decor filler, not items): they stay with the rail and the rail stays put while they hang on it (no floating stock)'),
  flatScreenTv: {dynamic: true, mass: 15, mat: 'pad', onHost: true, how: 'flat-screen TV on its stand (~15 kg) on a display table: a shot slides / topples it off the table, a bump shoves it'},
  mallCashwrapCounter: S('holder', 'till / back counter with hutch (~150 kg) built against the wall: a loot holder (drawers, cupboard, shelves) stays put'),
  glassDisplayCabinet: S('holder', 'glass display cabinet (~70 kg loaded): a loot holder stays put so its finite lots never float'),
  retailGondola: S('holder', 'gondola section bolted into its run (~60 kg loaded): a loot holder stays put'),
  clothingWallUnit: S('holder', 'clothing bay built against the wall (loot in its cubbies, garments on its rail): stays put'),
  pharmacyDispensaryCounter: S('holder', 'dispensary back counter (~250 kg) built against the wall: a loot holder stays put'),
  medicineDrawerCabinet: S('holder', 'steel medicine drawer cabinet (M29, ~90 kg) screwed to the wall: a loot holder (drawers, cupboard, door bay) stays put'),
  checkoutLane: S('holder', 'checkout lane counter fixed to the floor (~120 kg): a loot holder stays put'),
  outdoorsPlankShelving: S('holder', 'pipe-and-plank shelving bracketed to the wall: a loot holder stays put'),
  mallKioskCart: S('holder', 'braked kiosk cart (~150 kg loaded): a loot holder stays put so its finite lots never float'),
  storageTote: S('holder', 'loaded storage tote with its lid flaps open (~15 kg): a holder that does not spill stays put (its finite lots would float); a lid that closes would make it a spill holder (lanes/SHOPS.done)'),
  shoeWallDisplay: S('holder', 'shoe wall display screwed to the wall: a loot holder stays put'),
  foodCourtTableSet: S('anchored', 'food-court table and four stools on one frame bolted to the floor; loot on the table top'),
  // task track3 (lane ARCH): landmarks
  fountainBasin: S('built-in', 'fountain basin: a cast-in-place stone basin built into the plaza slab (several tonnes, plumbed in); it cannot move'),
  fountainSpire: S('built-in', 'bronze fountain centrepiece bolted through the basin floor onto its plumbing riser'),
  directoryPylon: S('anchored', 'mall directory pylon: a steel totem bolted to the floor slab (wired for its long-dead backlight)'),
} satisfies Record<MallKind, MallPhys>;

// ---------------------------------------------------------------------------------------------
// Openables audit (world/openablesSpec.ts OFFICE_OPEN_AUDIT spreads these): role + class + honest reason.

type Role = 'storage' | 'surface' | 'equipment' | 'decor';
type Cls = 'openable' | 'existing' | 'open' | 'exception' | 'none';
export const MALL_OPEN_AUDIT: Readonly<Record<MallKind, {role: Role; cls: Cls; how: string}>> = {
  glassCounter: {role: 'surface', cls: 'open', how: 'glass display counter (M15): no doors — the case has no panes or staff-side doors (ray-tested open); loot on the felt deck, the raised shelf and the glass top'},
  merchTable: {role: 'surface', cls: 'open', how: 'open merchandising table: loot on its top and lower shelf is reachable, nothing closes'},
  wallBay: {role: 'surface', cls: 'open', how: 'open slatwall shelving bay: loot on its shelves is reachable, no doors'},
  produceStand: {role: 'surface', cls: 'open', how: 'open produce stand: loot in its two bin decks is reachable, no lids'},
  bookstoreBookcase: {role: 'storage', cls: 'openable', how: 'bookstore bookcase (EMPTY: no baked books): 2 derived base drawers + 4 open shelves'},
  gunDisplay: {role: 'surface', cls: 'none', how: 'solid felt-topped display bench: no door or drawer (the weapon finds lie on its top as pickups)'},
  gunRack: {role: 'decor', cls: 'none', how: 'empty open floor-standing gun rack (M14: cradle shelf and hook bars, its modelled rifles removed): no door, lid or drawer; the real guns are the weapon plan\'s finds on the display benches'},
  fittingRooms: {role: 'decor', cls: 'none', how: 'curtained fitting cubicles: fixed cloth curtains, a bench and a mirror — nothing to open'},
  tvWall: {role: 'equipment', cls: 'none', how: 'bank of display screens on a floor-standing frame (M41): no door, lid or drawer'},
  displayBed: {role: 'decor', cls: 'none', how: 'bed frame with mattress: no drawers modelled'},
  ottoman: {role: 'decor', cls: 'none', how: 'solid upholstered ottoman: no lid (not a storage ottoman)'},
  salonChair: {role: 'decor', cls: 'none', how: 'salon chair: nothing to open'},
  kiddieRide: {role: 'equipment', cls: 'exception', how: 'coin-operated ride: its coin box is a locked steel vault of a machine and coins are not items; one fused body'},
  tentDisplay: {role: 'decor', cls: 'none', how: 'pitched display tent: its zipped doorway is fabric over an empty floor, not storage'},
  garmentRail: {role: 'decor', cls: 'none', how: 'empty garment rail on castors (no baked garments): nothing to open'},
  mannequinFull: {role: 'decor', cls: 'none', how: 'display mannequin: nothing to open'},
  flatScreenTv: {role: 'equipment', cls: 'none', how: 'flat-screen TV on its stand: no door, lid or drawer (a display set, not an item)'},
  garmentHangingGroup: {role: 'decor', cls: 'none', how: 'garments on hangers on a rail (decor filler, not items): nothing to open'},
  garmentRailRound: {role: 'decor', cls: 'none', how: 'empty round garment rack (no baked garments): nothing to open'},
  mallCashwrapCounter: {role: 'storage', cls: 'openable', how: 'till / back counter (M01): 5 derived drawers + a derived cupboard door; open niche, counter top and hutch shelves'},
  glassDisplayCabinet: {role: 'storage', cls: 'openable', how: 'glass display cabinet (M02): 2 derived hinged glass-frame doors over its 5 modelled glass shelves (contents visible)'},
  retailGondola: {role: 'surface', cls: 'open', how: 'open gondola shelving (M03, single-sided, placed back to back): loot on its decks is reachable'},
  clothingWallUnit: {role: 'surface', cls: 'open', how: 'open clothing bay (M08): NO doors — ray-tested open to its back panel (its board seams are not doors); loot in the two top cubbies, garment groups on the rail'},
  pharmacyDispensaryCounter: {role: 'storage', cls: 'openable', how: 'dispensary back counter (M11): 4 derived drawers, 5 derived cupboard doors, a derived tall mirror-door cupboard; open counter top and hutch shelf'},
  checkoutLane: {role: 'surface', cls: 'open', how: 'checkout lane (M12): closed side panels, the belt deck is the loot surface; its +X bagging well is an empty open bay'},
  outdoorsPlankShelving: {role: 'surface', cls: 'open', how: 'open pipe-and-plank shelving (M16): loot on its planks is reachable'},
  mallKioskCart: {role: 'storage', cls: 'openable', how: 'kiosk cart (M17): 2 derived lower-cabinet doors; its display box is open on both long sides'},
  medicineDrawerCabinet: {role: 'storage', cls: 'openable', how: 'medicine drawer cabinet (M29): 33 derived small drawers + a derived top cupboard door (left), a derived full-height door (right) over shelves; EXCEPTION inside: the bay\'s inner drawer bank is fixed (a drawer behind a door could be left out when the door shuts on it: nested compartments are not supported) — its top and the three shelves are the bay\'s loot surfaces'},
  storageTote: {role: 'storage', cls: 'exception', how: 'storage tote (M18): EXCEPTION — its two lid flaps are modelled RAISED OPEN in the delivered mesh (no closed rest pose for the openables hinge to start from), so there is nothing to shut; the inner tray (0.376 m) is an open loot surface, always reachable. A lid that closes needs a local mesh edit by lane ASSETS (lanes/SHOPS.notes), not a regeneration'},
  shoeWallDisplay: {role: 'surface', cls: 'open', how: 'open shoe wall (M19): loot on its ledges is reachable'},
  foodCourtTableSet: {role: 'surface', cls: 'open', how: 'food-court table set (M20): open table top, stools; nothing to open'},
  // task track3 (lane ARCH): landmarks
  fountainBasin: {role: 'decor', cls: 'none', how: 'fountain basin (stagnant water, debris): a built-in stone basin, nothing to open'},
  fountainSpire: {role: 'decor', cls: 'none', how: 'bronze fountain centrepiece: sealed casting, nothing to open'},
  directoryPylon: {role: 'equipment', cls: 'none', how: 'directory pylon: sealed steel totem with printed plan faces (backlight dead), no door or panel to open'},
};

// ---------------------------------------------------------------------------------------------
// Procedural forms (box parts, prop frame: origin bottom centre, front +Z) — rendered until a model is delivered.

const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number]): ShapePart => ({m, s, p});

export function mallShape(kind: MallKind): ShapePart[] {
  const {w, d, h} = MALL_PROP_DEFS[kind];
  // task track3 (lane ARCH): the landmarks are drawn by world/mallArch.ts (water, tiers, canvas plan faces): no box form here
  if (kind === 'fountainBasin' || kind === 'fountainSpire' || kind === 'directoryPylon') return [];
  switch (kind) {
    case 'glassCounter': {
      const {deckY, shelfY, topY} = GLASS_COUNTER;
      return [
        box('woodVeneer', [w, deckY, d], [0, deckY / 2, 0]),
        box('woodVeneer', [w, shelfY - deckY, 0.45], [0, deckY + (shelfY - deckY) / 2, -d / 2 + 0.225]),
        box('black', [w - 0.04, 0.012, 0.16], [0, deckY + 0.006, 0.215]),
        box('glass', [w - 0.04, 0.012, 0.42], [0, topY + 0.006, -0.14]),
        box('steelBright', [0.04, h - shelfY, 0.04], [-w / 2 + 0.05, shelfY + (h - shelfY) / 2, -d / 2 + 0.05]),
        box('steelBright', [0.04, h - shelfY, 0.04], [w / 2 - 0.05, shelfY + (h - shelfY) / 2, -d / 2 + 0.05]),
      ];
    }
    case 'merchTable': return [
      box('woodVeneer', [w, 0.04, d], [0, 0.82, 0]),
      box('woodVeneer', [w - 0.1, 0.025, d - 0.1], [0, 0.25, 0]),
      box('black', [0.05, 0.8, d - 0.06], [-w / 2 + 0.06, 0.4, 0]),
      box('black', [0.05, 0.8, d - 0.06], [w / 2 - 0.06, 0.4, 0]),
      box('black', [w - 0.16, 0.05, 0.04], [0, 0.78, -d / 2 + 0.06]),
    ];
    case 'wallBay': return [
      box('panel', [w, h - 0.15, 0.03], [0, (h - 0.15) / 2, -d / 2 + 0.015]),
      ...[0.35, 0.8, 1.25, 1.7].map(y => box('black', [w - 0.06, 0.008, 0.004], [0, y, -d / 2 + 0.032])),
      box('steelBright', [0.03, h, d], [-w / 2 + 0.015, h / 2, 0]),
      box('steelBright', [0.03, h, d], [w / 2 - 0.015, h / 2, 0]),
      box('steelDark', [w - 0.06, WALL_BAY_DECKS[0][0], d - 0.02], [0, WALL_BAY_DECKS[0][0] / 2, 0.01]),
      ...WALL_BAY_DECKS.slice(1).map(([y, zf]) => box('woodVeneer', [w - 0.06, 0.025, zf + d / 2 - 0.03], [0, y - 0.0125, (zf - d / 2 + 0.03) / 2])),
      box('accent', [w, 0.15, 0.05], [0, h - 0.075, -d / 2 + 0.05]),
    ];
    case 'produceStand': return [
      box('steelDark', [0.04, h, 0.04], [-w / 2 + 0.03, h / 2, -d / 2 + 0.03]),
      box('steelDark', [0.04, h, 0.04], [w / 2 - 0.03, h / 2, -d / 2 + 0.03]),
      box('steelDark', [0.04, 0.95, 0.04], [-w / 2 + 0.03, 0.475, d / 2 - 0.03]),
      box('steelDark', [0.04, 0.95, 0.04], [w / 2 - 0.03, 0.475, d / 2 - 0.03]),
      ...[0.18, 0.48, 0.93].map(y => box('wood', [w - 0.1, 0.03, d - 0.08], [0, y - 0.015, 0])),
      box('wood', [w, 0.6, 0.02], [0, 0.55, -d / 2 + 0.01]),
    ];
    case 'gunDisplay': return [
      box('woodVeneer', [w, GUN_DISPLAY_TOP - 0.03, d], [0, (GUN_DISPLAY_TOP - 0.03) / 2, 0]),
      box('steelDark', [w + 0.01, 0.04, d + 0.01], [0, 0.02, 0]),
      box('black', [w - 0.04, 0.03, d - 0.04], [0, GUN_DISPLAY_TOP - 0.015, 0]),
    ];
    case 'gunRack': return [
      box('steelDark', [0.05, h, 0.05], [-w / 2 + 0.03, h / 2, -d / 2 + 0.03]),
      box('steelDark', [0.05, h, 0.05], [w / 2 - 0.03, h / 2, -d / 2 + 0.03]),
      box('steelDark', [w, 0.04, d - 0.04], [0, 0.46, 0]),
      box('steelDark', [w, 0.04, d - 0.04], [0, 0.14, 0]),
      box('steelDark', [w - 0.1, 0.03, 0.03], [0, 0.82, -0.02]),
      box('steelDark', [w - 0.1, 0.03, 0.03], [0, 1.16, -0.02]),
      box('black', [w, 0.06, 0.05], [0, h - 0.03, -d / 2 + 0.03]),
    ];
    case 'fittingRooms': return [
      box('partition', [w, h, 0.05], [0, h / 2, -d / 2 + 0.025]),
      box('partition', [0.05, h, d], [-w / 2 + 0.025, h / 2, 0]),
      box('partition', [0.05, h, d], [w / 2 - 0.025, h / 2, 0]),
      box('partition', [0.05, h, d], [0, h / 2, 0]),
      box('steelBright', [w, 0.03, 0.03], [0, h - 0.15, d / 2 - 0.05]),
      box('accent', [w / 2 - 0.45, h - 0.4, 0.02], [-w / 4 - 0.15, (h - 0.4) / 2 + 0.2, d / 2 - 0.05]),
      box('accent', [w / 2 - 0.45, h - 0.4, 0.02], [w / 4 + 0.15, (h - 0.4) / 2 + 0.2, d / 2 - 0.05]),
      box('wood', [w / 2 - 0.15, 0.05, 0.35], [-w / 4, 0.45, -d / 2 + 0.23]),
      box('wood', [w / 2 - 0.15, 0.05, 0.35], [w / 4, 0.45, -d / 2 + 0.23]),
      box('mirror', [0.5, 1.2, 0.01], [-w / 4, 1.3, -d / 2 + 0.055]),
      box('mirror', [0.5, 1.2, 0.01], [w / 4, 1.3, -d / 2 + 0.055]),
    ];
    case 'tvWall': {
      const out: ShapePart[] = [box('black', [w, h, 0.05], [0, h / 2, -d / 2 + 0.025])];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) out.push(box('screen', [0.76, 0.64, 0.012], [-w / 3 + c * (w / 3), 0.36 + r * 0.68, -d / 2 + 0.056]));
      out.push(box('steelDark', [0.3, 0.3, d - 0.05], [0, h / 2, 0.0]));
      return out;
    }
    case 'displayBed': return [
      box('wood', [w, 0.3, d], [0, 0.15, 0]),
      box('partition', [w - 0.06, 0.25, d - 0.12], [0, 0.425, 0.04]),
      box('woodVeneer', [w, h, 0.08], [0, h / 2, -d / 2 + 0.04]),
    ];
    case 'ottoman': return [
      box('black', [w - 0.05, 0.06, d - 0.05], [0, 0.03, 0]),
      box('partition', [w, h - 0.06, d], [0, 0.06 + (h - 0.06) / 2, 0]),
    ];
    case 'salonChair': return [
      box('steelBright', [0.5, 0.08, 0.5], [0, 0.04, 0]),
      box('steelBright', [0.1, 0.35, 0.1], [0, 0.255, 0]),
      box('black', [0.55, 0.12, 0.55], [0, 0.5, 0.02]),
      box('black', [0.5, 0.55, 0.1], [0, 0.835, -d / 2 + 0.1]),
      box('black', [0.08, 0.06, 0.45], [-0.3, 0.68, 0.02]),
      box('black', [0.08, 0.06, 0.45], [0.3, 0.68, 0.02]),
      box('steelBright', [0.4, 0.04, 0.15], [0, 0.2, d / 2 - 0.08]),
    ];
    case 'kiddieRide': return [ // (the car runs along x)
      box('steelDark', [w, 0.15, d], [0, 0.075, 0]),
      box('accent', [w * 0.8, 0.35, d * 0.8], [0, 0.325, 0]),
      box('black', [0.35, 0.06, d * 0.6], [-0.1, 0.53, 0]),
      box('accent', [0.3, h - 0.5, d * 0.6], [w * 0.3, 0.5 + (h - 0.5) / 2, 0]),
    ];
    case 'bookstoreBookcase': return [
      box('wood', [w, h, 0.02], [0, h / 2, -d / 2 + 0.01]),
      box('wood', [0.05, h, d], [-w / 2 + 0.025, h / 2, 0]),
      box('wood', [0.05, h, d], [w / 2 - 0.025, h / 2, 0]),
      box('wood', [w, BOOKCASE_TIERS[0], d], [0, BOOKCASE_TIERS[0] / 2, 0]),
      ...BOOKCASE_TIERS.slice(1, 4).map(y => box('woodVeneer', [w - 0.1, 0.03, d - 0.05], [0, y - 0.015, 0.0])),
      box('wood', [w, h - BOOKCASE_TIERS[4], d], [0, (h + BOOKCASE_TIERS[4]) / 2, 0]),
    ];
    case 'garmentRail': return [
      box('steelBright', [w, 0.03, 0.03], [0, h - 0.015, 0]),
      box('steelBright', [0.03, h - 0.1, 0.03], [-w / 2 + 0.03, (h - 0.1) / 2 + 0.08, 0]),
      box('steelBright', [0.03, h - 0.1, 0.03], [w / 2 - 0.03, (h - 0.1) / 2 + 0.08, 0]),
      box('steelBright', [0.05, 0.03, d], [-w / 2 + 0.03, 0.08, 0]),
      box('steelBright', [0.05, 0.03, d], [w / 2 - 0.03, 0.08, 0]),
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => box('black', [0.05, 0.06, 0.05], [sx * (w / 2 - 0.03), 0.03, sz * (d / 2 - 0.03)])),
    ];
    case 'mannequinFull': return [
      box('steelDark', [w * 0.8, 0.03, d * 0.8], [0, 0.015, 0]),
      box('steelBright', [0.03, 0.75, 0.03], [0, 0.4, 0]),
      box('porcelain', [w * 0.75, 0.75, d * 0.5], [0, 1.1, 0]),
      box('porcelain', [w * 0.7, 0.2, d * 0.45], [0, 0.85, 0]),
      box('porcelain', [0.2, 0.25, 0.22], [0, h - 0.125, 0]),
    ];
    case 'flatScreenTv': return [
      box('steelDark', [0.4, 0.03, d * 0.7], [0, 0.015, 0]),
      box('steelDark', [0.06, 0.12, 0.06], [0, 0.09, 0]),
      box('black', [w, h - 0.12, 0.05], [0, 0.12 + (h - 0.12) / 2, 0]),
      box('screen', [w - 0.04, h - 0.16, 0.005], [0, 0.12 + (h - 0.12) / 2, 0.028]),
    ];
    case 'garmentRailRound': return [
      box('steelDark', [0.6, 0.05, 0.6], [0, 0.05, 0]),
      box('steelBright', [0.04, h - 0.1, 0.04], [0, (h - 0.1) / 2 + 0.07, 0]),
      box('steelBright', [w, 0.03, 0.03], [0, h - 0.05, 0]),
      box('steelBright', [0.03, 0.03, d], [0, h - 0.05, 0]),
    ];
    case 'garmentHangingGroup': return [
      ...[-0.36, -0.12, 0.12, 0.36].map(x => box('partition', [0.07, h * 0.82, d * 0.8], [x * w, h * 0.55, 0])),
      box('steelBright', [w * 0.9, 0.02, 0.02], [0, h - 0.01, 0]),
    ];
    case 'mallCashwrapCounter': return [
      box('woodVeneer', [w, 0.95, d], [0, 0.475, 0]),
      box('counter', [w, 0.06, d], [0, 0.92, 0]),
      box('wood', [w * 0.9, h - 0.95, 0.22], [0, 0.95 + (h - 0.95) / 2, -d / 2 + 0.11]),
    ];
    case 'glassDisplayCabinet': return [
      box('steelBright', [w, 0.37, d], [0, 0.185, 0]),
      box('glass', [w - 0.04, 1.32, d - 0.04], [0, 1.03, 0]),
      box('steelBright', [w, h - 1.69, d], [0, (h + 1.69) / 2, 0]),
    ];
    case 'retailGondola': return [
      box('panel', [w, h, 0.02], [0, h / 2, -d / 2 + 0.01]),
      box('steelBright', [w, 0.18, d - 0.04], [0, 0.09, 0]),
      ...GONDOLA_DECKS.slice(1).map(([y, z1]) => box('steelBright', [w - 0.04, 0.02, z1 + d / 2 - 0.02], [0, y - 0.01, (z1 - d / 2 + 0.02) / 2])),
    ];
    case 'clothingWallUnit': return [
      box('wood', [w, h, 0.05], [0, h / 2, -d / 2 + 0.025]),
      box('wood', [0.045, h, d], [-w / 2 + 0.0225, h / 2, 0]),
      box('wood', [0.045, h, d], [w / 2 - 0.0225, h / 2, 0]),
      box('wood', [w, 0.055, d], [0, 2.037, 0]),
      box('wood', [w, 0.05, d], [0, h - 0.025, 0]),
      box('steelBright', [w - 0.1, 0.035, 0.035], [0, GARMENT_RAIL_Y.clothingWallUnit!, 0]),
    ];
    case 'pharmacyDispensaryCounter': return [
      box('panel', [w * 0.86, 0.9, d - 0.05], [0, 0.45, -0.02]),
      box('counter', [w * 0.87, 0.05, d], [0, 0.93, 0]),
      box('panel', [w, h - 0.95, 0.06], [0, 0.95 + (h - 0.95) / 2, -d / 2 + 0.03]),
    ];
    case 'checkoutLane': return [
      box('panel', [w, h - 0.03, d], [0, (h - 0.03) / 2, 0]),
      box('black', [w - 0.1, 0.03, d - 0.14], [0, h - 0.015, 0]),
    ];
    case 'outdoorsPlankShelving': return [
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => box('steelDark', [0.035, h, 0.035], [sx * (w / 2 - 0.03), h / 2, sz * (d / 2 - 0.03)])),
      ...[0.41, 0.87, 1.14].map(y => box('wood', [w - 0.04, 0.03, d - 0.02], [0, y - 0.015, 0])),
    ];
    case 'mallKioskCart': return [
      box('woodVeneer', [1.55, 0.6, 0.9], [0.16, 0.33, 0]),
      box('glass', [1.33, 0.5, 0.62], [0.15, 0.9, 0.03]),
      box('accent', [1.5, 0.08, 0.92], [0.15, 1.6, 0]),
      box('steelBright', [0.04, 0.95, 0.04], [-0.55, 1.13, 0]),
      box('steelBright', [0.04, 0.95, 0.04], [0.88, 1.13, 0]),
    ];
    case 'storageTote': return [
      box('plasticSeat', [w * 0.8, 0.37, d * 0.8], [0, 0.185, 0]),
      box('plasticSeat', [w, 0.03, d], [0, 0.38, 0]),
    ];
    case 'shoeWallDisplay': return [
      box('panel', [w, h, 0.03], [0, h / 2, -d / 2 + 0.015]),
      ...[0.3, 0.54, 0.78, 1.01, 1.24, 1.46].map(y => box('steelBright', [w - 0.04, 0.015, d - 0.03], [0, y - 0.008, 0.01])),
    ];
    case 'foodCourtTableSet': return [
      box('laminate', [0.9, 0.03, 0.9], [0, 0.735, 0]),
      box('steelDark', [0.08, 0.72, 0.08], [0, 0.36, 0]),
      ...[[0, 1], [0, -1], [1, 0], [-1, 0]].map(([sx, sz]) => box('plasticSeat', [0.34, 0.04, 0.34], [sx * (w / 2 - 0.17), 0.44, sz * (d / 2 - 0.17)])),
      box('steelDark', [w - 0.2, 0.03, 0.06], [0, 0.03, 0]),
      box('steelDark', [0.06, 0.03, d - 0.2], [0, 0.03, 0]),
    ];
    case 'tentDisplay': return [
      box('wood', [w, 0.08, d], [0, 0.04, 0]),
      box('accent', [w * 0.82, (h - 0.08) * 0.6, d * 0.82], [0, 0.08 + (h - 0.08) * 0.3, 0]),
      box('accent', [w * 0.55, (h - 0.08) * 0.4, d * 0.55], [0, 0.08 + (h - 0.08) * 0.8, 0]),
      box('black', [0.7, 0.55, 0.01], [0, 0.355, d * 0.41 + 0.006]),
    ];
    case 'medicineDrawerCabinet': return [
      box('panel', [w, h, d - 0.07], [0, h / 2, -0.035]),
      ...Array.from({length: 11}, (_, i) => box('steelDark', [w / 2 - 0.05, 0.004, 0.004], [-w / 4, 0.28 + i * 0.105, d / 2 - 0.07])),
      box('panel', [w / 2 - 0.02, h - 0.2, 0.02], [w / 4, 0.16 + (h - 0.2) / 2, d / 2 - 0.045]),
      box('steelBright', [0.02, 0.15, 0.03], [0.18, 1.02, d / 2 - 0.02]),
    ];
  }
}
