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
//   - gunRack       EMPTY wall-mounted long-gun rack (cradle + hook bars, a cut cable lock): mounted, nothing to open;
//   - fittingRooms  two curtained fitting cubicles (partitions, bench, mirror): static partition block;
//   - tvWall        wall-mounted bank of six display screens (electronics): mounted equipment;
//   - displayBed    bed frame + mattress (home store floor model);
//   - ottoman       upholstered try-on ottoman (shoes / clothing): light, DYNAMIC (shoved when walked into / shot);
//   - salonChair    hydraulic salon / barber chair bolted to the floor (beauty / service);
//   - kiddieRide    coin-operated kiddie ride (toys / arcade): locked coin vault, too heavy;
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
  glassCounter: {box: [1.5, 0.65, 1.0], cls: 'glass'},
  merchTable: {box: [1.6, 0.9, 0.84], cls: 'laminate'},
  wallBay: {box: [1.2, 0.5, 2.2], cls: 'laminate'},
  produceStand: {box: [1.6, 1.0, 0.95], cls: 'wood'},
  bookstoreBookcase: {box: [1.2, 0.547, 2.257], blocksSight: true, cls: 'wood'},
  // --- fixtures / furniture ---
  gunDisplay: {box: [1.4, 0.7, 0.9], cls: 'wood'},
  gunRack: {box: [2.0, 0.25, 1.3], cls: 'wood'},
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
} as const satisfies Record<string, MallKindSpec>;

export type MallKind = keyof typeof SPECS;
export const MALL_KINDS = Object.keys(SPECS) as MallKind[];
export function isMallKind(kind: string): kind is MallKind {
  return kind in SPECS;
}

/** Holder kinds among them (items/loot.ts SURFACE_KINDS; their surfaces: MALL_SURFACES). */
export const MALL_HOLDER_KINDS = ['glassCounter', 'merchTable', 'wallBay', 'produceStand'] as const satisfies readonly MallKind[];
export type MallHolderKind = (typeof MALL_HOLDER_KINDS)[number];
export function isMallHolderKind(kind: string): kind is MallHolderKind {
  return (MALL_HOLDER_KINDS as readonly string[]).includes(kind);
}
/** Kinds hung on a wall with gen/placeKit.ts mountProp (base `MALL_MOUNT_Y` above the floor). */
export const MALL_MOUNT_Y: Readonly<Partial<Record<MallKind, number>>> = {gunRack: 1.0, tvWall: 1.05};

/**
 * Lane ASSETS hook: asset id a kind renders with once its Meshy model is delivered (assets/mallAssets.ts; library key
 * `office-<assetId>`, the file faces -Z). Empty until a model lands: the procedural forms below render meanwhile.
 */
export const MALL_KIND_ASSET: Readonly<Partial<Record<MallKind, string>>> = {
  // batch 1 (lane ASSETS DELIVERED.json): M09 the empty bookcase (its shelf decks measured: MALL_SURFACES below), M07, M10
  bookstoreBookcase: 'bookstore-bookcase', mannequinFull: 'mannequin-full', flatScreenTv: 'flat-screen-tv', garmentHangingGroup: 'garment-hanging-group',
  // batch 1 group 2-3: M04 the wall bay (its decks measured: WALL_BAY_DECKS), M05 the round garment rack
  wallBay: 'retail-wall-bay', garmentRailRound: 'garment-rail-round',
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

/** Glass counter: the felt deck inside the case and the glass shelf over its back half. */
export const GLASS_COUNTER = {deckY: 0.44, shelfY: 0.725, topY: 0.98} as const;
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

/** Exposed loot surfaces of the open mall holders and of the bookcase (an openable container: its shelves + its drawers' trays). */
export const MALL_SURFACES: Readonly<Record<MallHolderKind | 'bookstoreBookcase', readonly SurfaceSpec[]>> = {
  glassCounter: [
    {y: GLASS_COUNTER.deckY, x0: -0.69, x1: 0.69, z0: -0.27, z1: 0.27, clear: 0.26},
    {y: GLASS_COUNTER.shelfY, x0: -0.67, x1: 0.67, z0: -0.17, z1: 0.17, clear: 0.24},
  ],
  merchTable: [
    {y: 0.84, x0: -0.72, x1: 0.72, z0: -0.37, z1: 0.37, clear: 0.5},
    {y: 0.2625, x0: -0.66, x1: 0.66, z0: -0.33, z1: 0.33, clear: 0.5},
  ],
  wallBay: WALL_BAY_DECKS.map(([y, zf], i) => ({y, x0: -0.55, x1: 0.55, z0: -0.22, z1: zf, clear: r3(Math.min(0.5, (WALL_BAY_DECKS[i + 1]?.[0] ?? 1.9) - y - 0.03))})),
  produceStand: [
    {y: 0.565, x0: -0.74, x1: 0.74, z0: 0.06, z1: 0.43, clear: 0.35},
    {y: 0.83, x0: -0.74, x1: 0.74, z0: -0.43, z1: -0.06, clear: 0.4},
  ],
  bookstoreBookcase: BOOKCASE_TIERS.slice(0, 4).map((y, i) => ({y, x0: -0.52, x1: 0.52, z0: -0.18, z1: 0.18, clear: r3(BOOKCASE_TIERS[i + 1] - y - 0.03)})),
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
  gunRack: S('mounted', 'empty long-gun rack screwed to the wall'),
  fittingRooms: S('partition', 'fitting cubicles: partition walls fixed to the floor and ceiling track'),
  tvWall: S('mounted', 'display screen bank on a wall bracket'),
  displayBed: S('too heavy', 'bed frame with a mattress (~70 kg, no castors): a bump cannot slide it'),
  ottoman: {dynamic: true, mass: 12, mat: 'pad', how: 'upholstered try-on ottoman (~12 kg): shoved aside when walked into, slides / tips under buckshot'},
  salonChair: S('anchored', 'hydraulic salon chair bolted to the floor (~60 kg)'),
  kiddieRide: S('too heavy', 'coin-operated kiddie ride (~150 kg) on its base'),
  tentDisplay: S('anchored', 'display tent guyed and screwed down to its timber plinth'),
  garmentRail: {dynamic: true, mass: 14, mat: 'castor', how: 'empty chrome garment rail on castors (~14 kg): rolls away when walked into, slides / tips when shot'},
  // (collider 1.2x its slim model box: the shoulders / base plate the walker meets first — a 0.45 m box let the camera clip 16 cm in)
  mannequinFull: {dynamic: true, mass: 7, mat: 'pad', fit: 1.2, how: 'full-figure hollow plastic display mannequin on a base (~7 kg, tall and narrow): tips over when shot or bumped'},
  garmentRailRound: {dynamic: true, mass: 18, mat: 'pad', how: 'empty round chrome garment rack (~18 kg): shoved across the floor when walked into, slides / tips when shot'},
  garmentHangingGroup: S('host decor', 'garments on hangers riding their garment rail (decor filler, not items): they stay with the rail and the rail stays put while they hang on it (no floating stock)'),
  flatScreenTv: {dynamic: true, mass: 15, mat: 'pad', onHost: true, how: 'flat-screen TV on its stand (~15 kg) on a display table: a shot slides / topples it off the table, a bump shoves it'},
} satisfies Record<MallKind, MallPhys>;

// ---------------------------------------------------------------------------------------------
// Openables audit (world/openablesSpec.ts OFFICE_OPEN_AUDIT spreads these): role + class + honest reason.

type Role = 'storage' | 'surface' | 'equipment' | 'decor';
type Cls = 'openable' | 'existing' | 'open' | 'exception' | 'none';
export const MALL_OPEN_AUDIT: Readonly<Record<MallKind, {role: Role; cls: Cls; how: string}>> = {
  glassCounter: {role: 'surface', cls: 'open', how: 'glass display counter: no doors — its staff side is open; loot lies on the felt deck and glass shelf inside the case, reachable'},
  merchTable: {role: 'surface', cls: 'open', how: 'open merchandising table: loot on its top and lower shelf is reachable, nothing closes'},
  wallBay: {role: 'surface', cls: 'open', how: 'open slatwall shelving bay: loot on its shelves is reachable, no doors'},
  produceStand: {role: 'surface', cls: 'open', how: 'open produce stand: loot in its two bin decks is reachable, no lids'},
  bookstoreBookcase: {role: 'storage', cls: 'openable', how: 'bookstore bookcase (EMPTY: no baked books): 2 derived base drawers + 4 open shelves'},
  gunDisplay: {role: 'surface', cls: 'none', how: 'solid felt-topped display bench: no door or drawer (the weapon finds lie on its top as pickups)'},
  gunRack: {role: 'decor', cls: 'none', how: 'empty open wall rack (cradle and hook bars, a cut cable lock): no door, lid or drawer'},
  fittingRooms: {role: 'decor', cls: 'none', how: 'curtained fitting cubicles: fixed cloth curtains, a bench and a mirror — nothing to open'},
  tvWall: {role: 'equipment', cls: 'none', how: 'bank of display screens on a wall bracket: no door, lid or drawer'},
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
};

// ---------------------------------------------------------------------------------------------
// Procedural forms (box parts, prop frame: origin bottom centre, front +Z) — rendered until a model is delivered.

const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number]): ShapePart => ({m, s, p});

export function mallShape(kind: MallKind): ShapePart[] {
  const {w, d, h} = MALL_PROP_DEFS[kind];
  switch (kind) {
    case 'glassCounter': {
      const gh = GLASS_COUNTER.topY - 0.43, gy = 0.43 + gh / 2;
      return [
        box('woodVeneer', [w, 0.42, d], [0, 0.21, 0]),
        box('steelDark', [w + 0.01, 0.03, d + 0.01], [0, 0.015, 0]),
        box('black', [w - 0.04, 0.02, d - 0.06], [0, 0.43, 0]),
        box('glass', [w - 0.04, gh, 0.012], [0, gy, d / 2 - 0.02]),
        box('glass', [0.012, gh, d - 0.06], [-w / 2 + 0.02, gy, 0]),
        box('glass', [0.012, gh, d - 0.06], [w / 2 - 0.02, gy, 0]),
        box('glass', [w - 0.02, 0.012, d - 0.02], [0, GLASS_COUNTER.topY + 0.006, 0]),
        box('glass', [w - 0.08, 0.01, 0.36], [0, GLASS_COUNTER.shelfY - 0.005, 0]),
        ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => box('steelBright', [0.025, gh, 0.025], [sx * (w / 2 - 0.015), gy, sz * (d / 2 - 0.015)])),
        box('steelBright', [w, 0.02, 0.02], [0, GLASS_COUNTER.topY - 0.01, d / 2 - 0.015]),
        box('steelBright', [w, 0.02, 0.02], [0, GLASS_COUNTER.topY - 0.01, -d / 2 + 0.015]),
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
      box('wood', [w, 0.5, d], [0, 0.25, 0]),
      box('woodVeneer', [w - 0.06, 0.03, 0.42], [0, 0.535, 0.245]),
      box('wood', [w, 0.1, 0.03], [0, 0.6, d / 2 - 0.015]),
      box('wood', [w, 0.3, 0.46], [0, 0.65, -0.24]),
      box('woodVeneer', [w - 0.06, 0.03, 0.42], [0, 0.8, -0.245]),
      box('wood', [w, 0.15, 0.03], [0, h - 0.075, -d / 2 + 0.015]),
      box('wood', [0.03, 0.42, d], [-w / 2 + 0.015, 0.71, 0]),
      box('wood', [0.03, 0.42, d], [w / 2 - 0.015, 0.71, 0]),
    ];
    case 'gunDisplay': return [
      box('woodVeneer', [w, GUN_DISPLAY_TOP - 0.03, d], [0, (GUN_DISPLAY_TOP - 0.03) / 2, 0]),
      box('steelDark', [w + 0.01, 0.04, d + 0.01], [0, 0.02, 0]),
      box('black', [w - 0.04, 0.03, d - 0.04], [0, GUN_DISPLAY_TOP - 0.015, 0]),
    ];
    case 'gunRack': return [
      box('woodVeneer', [w, h, 0.03], [0, h / 2, -d / 2 + 0.015]),
      box('steelDark', [w - 0.1, 0.06, 0.18], [0, 0.15, -d / 2 + 0.12]),
      box('steelDark', [w - 0.1, 0.05, 0.14], [0, h - 0.25, -d / 2 + 0.1]),
      ...Array.from({length: 9}, (_, i) => box('steelDark', [0.02, 0.18, 0.16], [-w / 2 + 0.1 + i * (w - 0.2) / 8, 0.25, -d / 2 + 0.11])),
      box('steelBright', [w - 0.3, 0.012, 0.012], [0, h * 0.55, d / 2 - 0.03]),
      box('accent', [w, 0.06, 0.02], [0, h - 0.03, -d / 2 + 0.04]),
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
    case 'kiddieRide': return [
      box('steelDark', [w, 0.3, d], [0, 0.15, 0]),
      box('accent', [0.5, 0.45, 1.0], [0, 0.55, 0]),
      box('accent', [0.35, 0.42, 0.3], [0, 0.98, d / 2 - 0.2]),
      box('black', [0.4, 0.06, 0.35], [0, 0.8, -0.1]),
      box('steelDark', [0.25, 0.4, 0.2], [0, 0.5, -d / 2 + 0.1]),
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
    case 'tentDisplay': return [
      box('wood', [w, 0.1, d], [0, 0.05, 0]),
      box('accent', [1.8, 1.0, 1.8], [0, 0.6, 0]),
      box('accent', [1.4, 0.4, 1.4], [0, 1.3, 0]),
      box('black', [0.7, 0.8, 0.01], [0, 0.5, 0.905]),
    ];
  }
}
