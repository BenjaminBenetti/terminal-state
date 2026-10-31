// Task track3-eaton-centre-20261031 (Studio Beta, lane ASSETS): pure-data (three.js-free) measured bounds + nominal specs of the
// NEW mall-art models (assets/mallAssets.ts), for gen/ code (footprints, placement, surfaces): gen/mall/kinds.ts MALL_MODEL_DIMS.
// Rewritten by tools/asset-pipeline/props/build-mall-track3.mjs. MALL_DIMS lists DELIVERED models only: [x, y, z] metres of the
// runtime GLB (front -Z, +Y up, grounded, centred on x/z). MALL_ASSET_SPECS lists every asset of a FROZEN batch (delivered or not):
// the nominal real-world target (fall back to it, or to the kind's procedural box, until a model lands).
// No imports: safe for the generator, workers and tests.

export type MallAssetSizeAxis = 'h' | 'w' | 'longest';

export interface MallAssetSpec {
  /** Attempt-manifest code (M01..M80). */
  code: string;
  /** fixture / holder / loose-stock / furniture / decor / machine (manifest role). */
  role: string;
  /** Shop programs it serves (gen/mall/mallTypes.ts MallProgram ids or 'all stores' / common-area tags). */
  programs: readonly string[];
  /** Nominal real-world size (m) along sizeAxis; the runtime model is scaled to exactly this. */
  sizeM: number;
  sizeAxis: MallAssetSizeAxis;
  /** Planned target [w (x), h (y), d (z)] metres (the measured runtime dims may differ off the sizeAxis). */
  target: readonly [number, number, number];
  /** Placement hint ('wall' = back against a wall, its front -Z into the room). */
  placement: string;
  /** SHOPS kind it renders (existing gen/mall/kinds.ts kind) or the suggested new kind name. */
  shopsKind: string | null;
}

// BEGIN GENERATED (build-mall-track3.mjs) — do not hand-edit between the markers
export const MALL_DIMS: Readonly<Record<string, readonly [number, number, number]>> = {
};

export const MALL_ASSET_SPECS: Readonly<Record<string, MallAssetSpec>> = {
};
// END GENERATED
