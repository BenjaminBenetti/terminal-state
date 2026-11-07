// Task studio-alpha-skyways-shops-20261107-054512-01: the DESIGN store's OWN new prop kinds (lane STORE-DESIGN), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// LARCH & LOOM HOME furnishes with existing kinds (the destination kit's sofa / egg chair / arc lamp / dining table / showroom bed; the
// Mall's dresser, bookcase, cash-wrap, vitrine, ottoman, cartons and totes; the Subway / Office kitchenette, lockers, footlocker,
// fridge). Two things no existing kind is:
//  - skyDsRug: a flat wool RUG under each room vignette (a field and a border band, sized per placement: hx / hz / h on the
//    placement). Static 'flat' (a covering lying under furniture: nothing to shove or tip; the furniture stands on it).
//  - skyDsTextiles: a stack of folded THROWS / TOWELS on a display table (the textiles department): light loose merchandise
//    (on-host, ~2 kg), knocked off its table when shot or bumped like the bookshop's stacks.
// Both are drawn by code (world/skywaysStoreDesignDraw.ts): boxes in the Office architecture's tinted CARPET material (the approved
// Codex office carpet texture, re-tinted per colourway; no new or hand-drawn texture). Rule 4: neither bakes anything loose in.

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_DESIGN_KINDS = ['skyDsRug', 'skyDsTextiles'] as const;
export type StoreDesignKind = (typeof STORE_DESIGN_KINDS)[number];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Rug: pile height (m) and the border band width (m) by the rug's shorter side; nominal size of the kind's box (each rug: its own). */
export const DESIGN_RUG = {h: 0.012, field: 0.01, border: (short: number) => r3(Math.min(0.16, Math.max(0.08, short * 0.05))), w: 3.0, d: 2.0} as const;

/**
 * The colourways (sRGB hex): a calm Scandinavian palette — oatmeal, charcoal, sage, cream, terracotta, dusty blue, mustard and the
 * towel whites / greys. Each one is a tint of the Office carpet material (world/skywaysStoreDesignDraw.ts: one material per tint).
 */
export const DESIGN_TINT = {
  oatmeal: 0xd6c9b0, charcoal: 0x4a4a47, sage: 0x8f9d86, cream: 0xe9e1cf, terracotta: 0xb1653f, blue: 0x7c92a6, mustard: 0xc39d45,
  towelWhite: 0xeceae4, towelGrey: 0xa9aaa6,
} as const;
export type DesignTint = keyof typeof DESIGN_TINT;

/** Rug colourways (variant): [field, border]. */
export const DESIGN_RUGS: readonly (readonly [DesignTint, DesignTint])[] = [
  ['oatmeal', 'charcoal'], ['sage', 'cream'], ['cream', 'terracotta'], ['blue', 'oatmeal'], ['charcoal', 'oatmeal'], ['mustard', 'cream'],
];

/** One box of a code-drawn piece (prop frame: origin bottom centre, front +Z; metres) in a tint. */
export interface DesignPart { t: DesignTint; s: readonly [number, number, number]; p: readonly [number, number, number] }

/** Textile stack: its box (the kind's def) and the layers per variant. Variants 0-3 folded throws, 4-5 folded towels. */
export const DESIGN_TEXTILES = {w: 0.44, d: 0.34, h: 0.17, variants: 6, throws: [0, 1, 2, 3], towels: [4, 5]} as const;
const THROW_PALETTES: readonly (readonly DesignTint[])[] = [
  ['oatmeal', 'charcoal', 'oatmeal', 'sage'], ['cream', 'terracotta', 'cream', 'mustard'], ['blue', 'cream', 'blue', 'oatmeal'], ['sage', 'sage', 'cream', 'charcoal'],
];
const TOWEL_PALETTES: readonly (readonly DesignTint[])[] = [
  ['towelWhite', 'towelWhite', 'towelGrey', 'towelWhite', 'towelGrey'], ['towelGrey', 'blue', 'towelGrey', 'blue', 'towelWhite'],
];

/**
 * The layers of a textile stack variant: folded throws (4 x 4 cm, 0.42 x 0.32 m, each a little offset like a hand-made pile) or
 * folded towels (5 x 3 cm, 0.34 x 0.24 m). Deterministic per variant (no rng: every instance of a variant looks the same).
 */
export function designTextileParts(variant: number): DesignPart[] {
  const v = ((Math.trunc(variant) % DESIGN_TEXTILES.variants) + DESIGN_TEXTILES.variants) % DESIGN_TEXTILES.variants;
  const towels = v >= 4, pal = towels ? TOWEL_PALETTES[v - 4] : THROW_PALETTES[v];
  const [w, d, t] = towels ? [0.34, 0.24, 0.03] : [0.42, 0.32, 0.04];
  // small alternating offsets (within the kind's 0.44 x 0.34 box)
  const off: readonly (readonly [number, number])[] = [[0, 0], [0.008, -0.006], [-0.007, 0.007], [0.006, 0.004], [-0.004, -0.007]];
  return pal.map((tint, i) => ({t: tint, s: [w, r3(t - 0.002), d] as const, p: [off[i][0], r3(i * t + t / 2), off[i][1]] as const}));
}

/**
 * The parts of a rug of half extents (hx, hz) (prop frame, rot 0): the field inset by the border band, the band as four strips a hair
 * higher (a bound edge). `variant` picks the colourway.
 */
export function designRugParts(hx: number, hz: number, variant: number): DesignPart[] {
  const [field, edge] = DESIGN_RUGS[((Math.trunc(variant) % DESIGN_RUGS.length) + DESIGN_RUGS.length) % DESIGN_RUGS.length];
  const b = DESIGN_RUG.border(2 * Math.min(hx, hz)), H = DESIGN_RUG.h, F = DESIGN_RUG.field;
  const W = 2 * hx, D = 2 * hz;
  return [
    {t: field, s: [r3(W - 2 * b), F, r3(D - 2 * b)], p: [0, r3(F / 2), 0]},
    {t: edge, s: [r3(W), H, b], p: [0, r3(H / 2), r3(-hz + b / 2)]},
    {t: edge, s: [r3(W), H, b], p: [0, r3(H / 2), r3(hz - b / 2)]},
    {t: edge, s: [b, H, r3(D - 2 * b)], p: [r3(-hx + b / 2), r3(H / 2), 0]},
    {t: edge, s: [b, H, r3(D - 2 * b)], p: [r3(hx - b / 2), r3(H / 2), 0]},
  ];
}

export const STORE_DESIGN_SPECS: Readonly<Record<StoreDesignKind, DestKindSpec>> = {
  skyDsRug: {
    def: {w: DESIGN_RUG.w, d: DESIGN_RUG.d, h: DESIGN_RUG.h, blocksSight: false},
    phys: {dynamic: false, why: 'flat', how: 'flat wool rug (1.2 cm pile, ~6-12 kg) lying under a room vignette with the furniture standing on it: no rigid body to shove or tip; a bump or a bullet only scuffs the pile'},
    damage: 'fabric',
    open: {cls: 'none', role: 'decor', how: 'flat rug: nothing to open'},
  },
  skyDsTextiles: {
    def: {w: DESIGN_TEXTILES.w, d: DESIGN_TEXTILES.d, h: DESIGN_TEXTILES.h, blocksSight: false,
      physics: {mass: 2.2, dynamic: true, shape: 'box', mat: 'pad', contact: true, onHost: true}},
    phys: {dynamic: true, mass: 2.2, mat: 'pad', shape: 'box', onHost: true, how: 'pile of four folded wool throws / five folded towels (~2 kg) on a display table: a shot knocks it off the table (on-host decor; its host table stays put)'},
    damage: 'fabric',
    open: {cls: 'none', role: 'decor', how: 'folded throws / towels: merchandise on display, nothing to open'},
  },
};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * The dresser (M45), the bookcase (M09), the cash-wrap counter (M01), the glass vitrine (M02), the try-on ottoman (M24), the cartons
 * (M47), the storage totes (M18) and the café chairs / bistro tables (already Skyways-eligible: the ramen restaurant's; listed as a record).
 */
export const STORE_DESIGN_MALL_MODELS: readonly string[] = [
  'mall-dresser-drawers.glb', 'mall-bookstore-bookcase.glb', 'mall-mall-cashwrap-counter.glb', 'mall-glass-display-cabinet.glb', 'mall-try-on-ottoman.glb',
  'mall-cardboard-box-flaps.glb', 'mall-storage-tote.glb', 'mall-cafe-chair.glb', 'mall-cafe-bistro-table.glb',
];
