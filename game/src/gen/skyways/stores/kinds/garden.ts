// Task studio-alpha-skyways-shops-20261107-054512-01: the GARDEN store's OWN new prop kinds (lane STORE-GARDEN), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Glasshouse Garden Co. reuses the existing kit (plant benches, geranium pots, palms, planter trees, flower stands, spinner racks, tool
// pegboards, potting cabinets, tool chests, Mall cash-wrap counter / plank shelving / totes / cartons, coolers, fridges, lockers). No
// existing kind is a pallet of bagged soil or a hanging-basket rail, so two code-drawn kinds (box parts, no model, no art) fill those:
//  - storeGardenSoilPallet: sealed 40 L bags of potting soil / compost stacked five high on a timber pallet (a garden centre's floor
//    stock). Static, too heavy (~400 kg); the bags are sealed merchandise (soil is not an item): an explicit openables exception.
//  - storeGardenBasketRail: a galvanised basket rail hung from the ceiling on two rods (the rods are drawn to the ceiling per placement:
//    world/skywaysStoreGarden.ts), five hooks each with a hanger (two chains and a ring) — the hanging BASKETS are the existing geranium
//    pots (skyDGeraniumPot, dynamic on-host decor: a shot knocks one off its hook) hung in the rings by the dresser. Mounted, static;
//    nothing to open. Its underside clears >= GARDEN_RAIL_CLEAR above the floor (walk-under; `mounted` props do not block walking).
// Scale checks (root CLAUDE.md rule 5): GARDEN_SCALE below (tools/asset-pipeline/skyways-stores/garden/scale-check.mjs).

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_GARDEN_KINDS = ['storeGardenSoilPallet', 'storeGardenBasketRail'] as const;
export type StoreGardenKind = (typeof STORE_GARDEN_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(STORE_GARDEN_KINDS);
export const isStoreGardenKind = (k: string): k is StoreGardenKind => KIND_SET.has(k);

/** Shape-material keys the parts use (gen/propShapes.ts SHAPE_MAT_KEYS; `accent` is tinted per placement: the bag colour). */
export type GardenPartMat = 'wood' | 'accent' | 'counter' | 'steelDark' | 'steelBright';
/** A box part (prop frame: origin bottom centre, front +Z, metres), optionally turned about X (rx). */
export interface GardenPart { m: GardenPartMat; s: [number, number, number]; p: [number, number, number]; rx?: number }

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// The soil pallet

/** Pallet footprint (a 1.2 x 1.0 m timber pallet), deck height, bag size and the stack's layers. */
export const SOIL_PALLET = {w: 1.2, d: 1.0, deck: 0.144, bag: {w: 0.56, h: 0.125, d: 0.47}, layers: 5} as const;
/** Bag colours per placement variant (dark green compost, brown potting soil, black mulch). */
export const SOIL_BAG_COLORS: readonly number[] = [0x2f4b2c, 0x5a3b26, 0x262626];
/** Pallet height: the deck plus the layers (the top bag's top). */
export const SOIL_PALLET_H = r3(SOIL_PALLET.deck + SOIL_PALLET.layers * SOIL_PALLET.bag.h);

/**
 * The pallet's parts: three runners and the deck boards (wood); per layer four bags (2 x 2, each layer nudged a little: a hand-stacked
 * pile), every bag a body (accent: the bag colour) with a pale label band across its top (counter) and a sealed seam at each end.
 */
export const SOIL_PALLET_PARTS: readonly GardenPart[] = (() => {
  const P = SOIL_PALLET, out: GardenPart[] = [];
  for (const z of [-0.43, 0, 0.43]) out.push({m: 'wood', s: [P.w, 0.1, 0.1], p: [0, 0.05, z]});
  for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) out.push({m: 'wood', s: [0.14, 0.022, P.d], p: [x, 0.111, 0]});
  for (let L = 0; L < P.layers; L++) {
    const y0 = P.deck + L * P.bag.h, nx = (L % 2 ? 1 : -1) * 0.012, nz = (L % 3 === 1 ? 1 : -1) * 0.01;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = r3(sx * (P.bag.w / 2 + 0.006) + nx), cz = r3(sz * (P.bag.d / 2 + 0.008) + nz), cy = r3(y0 + P.bag.h / 2);
      out.push({m: 'accent', s: [P.bag.w, r3(P.bag.h - 0.006), P.bag.d], p: [cx, cy, cz]});
      // label band (lying across the bag's top) and the heat-sealed ends
      out.push({m: 'counter', s: [r3(P.bag.w * 0.42), 0.004, r3(P.bag.d - 0.08)], p: [cx, r3(y0 + P.bag.h - 0.004), cz]});
      for (const e of [-1, 1]) out.push({m: 'accent', s: [0.02, r3(P.bag.h * 0.55), r3(P.bag.d - 0.02)], p: [r3(cx + e * (P.bag.w / 2 + 0.005)), cy, cz]});
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------------------------
// The hanging-basket rail

/** Rail length, the hook slots (rail-local x), the rail's height above the baskets' bottoms, the ceiling rods' x. */
export const BASKET_RAIL = {w: 3.0, d: 0.3, railY: 0.9, pipe: 0.045, slots: [-1.2, -0.6, 0, 0.6, 1.2], rods: [-1.42, 1.42], ring: {y: 0.2, w: 0.3, d: 0.24}} as const;
/** Height of the rail kind (the baskets' bottoms to the rail top). */
export const BASKET_RAIL_H = r3(BASKET_RAIL.railY + BASKET_RAIL.pipe);
/** The baskets' bottoms hang at least this far above the floor (m; walk-under clearance, HUNG_CLEAR of the destination kits + margin). */
export const GARDEN_RAIL_CLEAR = 2.4;
/** The rods' top must be within this of the ceiling to be drawn (a missing ceiling never draws a rod into the sky). */
export const BASKET_ROD = {t: 0.022, maxLen: 6.5} as const;

/**
 * The rail's parts: the galvanised pipe along x, a hook plate at each slot and its hanger — a short drop chain from the hook, two
 * chains splaying to the front / back of a wire ring round the basket's rim (rx-turned), the ring (four thin bars). The rods up to
 * the ceiling are drawn per placement (their length depends on the ceiling over it).
 */
export const BASKET_RAIL_PARTS: readonly GardenPart[] = (() => {
  const R = BASKET_RAIL, out: GardenPart[] = [], t = 0.012;
  out.push({m: 'steelBright', s: [R.w, R.pipe, R.pipe], p: [0, r3(R.railY + R.pipe / 2), 0]});
  for (const ex of [-1, 1]) out.push({m: 'steelBright', s: [0.07, R.pipe, 0.07], p: [r3(ex * R.rods[1]), r3(R.railY + R.pipe / 2), 0]}); // the rods' clamps
  const hookY = R.railY, splitY = 0.62, ringY = R.ring.y, rz = R.ring.d / 2 - 0.01;
  for (const x of R.slots) {
    out.push({m: 'steelDark', s: [0.03, 0.05, 0.06], p: [x, r3(hookY - 0.02), 0]});
    out.push({m: 'steelDark', s: [t, r3(hookY - 0.04 - splitY), t], p: [x, r3((hookY - 0.04 + splitY) / 2), 0]});
    const len = Math.hypot(splitY - ringY, rz), ang = Math.atan2(rz, splitY - ringY);
    // (a +Y bar turned by rx about X points along (0, cos rx, sin rx): up from the ring at z = s * rz to the split at z = 0 -> rx = -s * ang)
    for (const s of [-1, 1]) out.push({m: 'steelDark', s: [t, r3(len), t], p: [x, r3((splitY + ringY) / 2), r3(s * rz / 2)], rx: r3(-s * ang)});
    // the wire ring at the rim (front / back bars along x, side bars along z)
    for (const s of [-1, 1]) out.push({m: 'steelDark', s: [R.ring.w, t, t], p: [x, ringY, r3(s * R.ring.d / 2)]});
    for (const s of [-1, 1]) out.push({m: 'steelDark', s: [t, t, R.ring.d], p: [r3(x + s * R.ring.w / 2), ringY, 0]});
  }
  return out;
})();

// ---------------------------------------------------------------------------------------------
// Kind specs

export const STORE_GARDEN_SPECS: Readonly<Record<StoreGardenKind, DestKindSpec>> = {
  storeGardenSoilPallet: {
    def: {w: SOIL_PALLET.w, d: SOIL_PALLET.d, h: SOIL_PALLET_H, blocksSight: false},
    phys: {dynamic: false, why: 'too heavy', how: 'timber pallet stacked five high with twenty sealed 40 L bags of potting soil / compost (~400 kg): a bump or a bullet does not shove it'},
    damage: 'plastic',
    open: {cls: 'exception', role: 'storage', how: 'sealed, heat-welded bags of soil on a pallet: merchandise, not storage (soil is not an item); the store\'s storage is its openable cabinets / chests / lockers'},
  },
  storeGardenBasketRail: {
    // (task studio-skywalk-variety-20261107-231448-01, lane MERCH: `shelves: []` — it HANGS its pots in the hook rings, nothing under them:
    // a shot pot goes loose and drops out of its ring; physics/merchOnHost.ts. Before, on-host decor below a host's top never went loose.)
    def: {w: BASKET_RAIL.w, d: BASKET_RAIL.d, h: BASKET_RAIL_H, blocksSight: false, shelves: []},
    phys: {dynamic: false, why: 'mounted', how: 'galvanised hanging-basket rail hung from the ceiling on two steel rods (its hanging baskets are separate geranium pots on its hooks: a shot knocks one off)'},
    damage: 'steel',
    open: {cls: 'none', role: 'decor', how: 'ceiling-hung rail with hooks: nothing to open'},
  },
};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * The garden: the cash desk's back counter (drawers + cupboard), the pipe-and-plank supply shelving, lidded storage totes and taped
 * cartons in the back room.
 */
export const STORE_GARDEN_MALL_MODELS: readonly string[] = ['mall-mall-cashwrap-counter.glb', 'mall-outdoors-plank-shelving.glb', 'mall-storage-tote.glb', 'mall-cardboard-box-flaps.glb'];

/**
 * Scale-check record (root CLAUDE.md rule 5; tools/asset-pipeline/skyways-stores/garden/scale-check.mjs: the parts exported as a GLB, rendered
 * by tools/asset-pipeline/props/scale-check.mjs beside zombie `lastshift` at runtime scale 1.0, viewed): W x H x D, contact, heights.
 */
export const GARDEN_SCALE: Readonly<Record<StoreGardenKind, string>> = {
  storeGardenSoilPallet: '1.20 x 0.77 x 1.00 m (the bags within the deck); grounded: 12 contact clusters (runners) over 1.20 x 0.96 m; deck 0.144 m, five bag layers of 0.125 m, top 0.77 m (90 % of the top-down area; below the 0.90 counter line): a waist-high pallet',
  storeGardenBasketRail: '3.00 x 0.95 x 0.25 m with its baskets (rail top 0.945 m over the basket bottoms); hung at the lowest 2.40 m: baskets 2.40-2.61 m, rail 3.35 m (beside the 1.78 m zombie: walk-under); five 0.30 x 0.24 m rings at 0.20 m each hold a 0.26 x 0.35 x 0.19 m geranium pot; two rods to the ceiling (drawn per placement)',
};
