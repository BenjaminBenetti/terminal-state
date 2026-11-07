// Task studio-alpha-skyways-shops-20261107-054512-01: the OUTFITTER store's OWN new prop kinds (lane STORE-OUTFITTER), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Lane STORE-OUTFITTER: no new kind. The store is furnished entirely with existing kinds (stores/outfitterDress.ts): Subway / Office
// holders and storage (shop counters, coolers, stock shelving, cabinets, staff lockers, the first-aid wall kit), the destinations kit
// (tent, canoe, lanterns, camp chairs, the tiered display table, posters), the hideout's camp stove / lantern, and the Mall fixtures
// listed below. The real backpack is the existing `backpack` gear item (a layout pickup), not a prop kind.

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_OUTFITTER_KINDS = [] as const;
export type StoreOutfitterKind = (typeof STORE_OUTFITTER_KINDS)[number];
export const STORE_OUTFITTER_SPECS: Readonly<Record<StoreOutfitterKind, DestKindSpec>> = {};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * (assets/mallAssets.ts: M01 cash-wrap counter, M03 gondola, M05 round garment rack, M06 garment group, M08 clothing bay, M16 plank
 * shelving, M18 storage tote, M19 boot / shoe wall, M24 try-on ottoman, M36 display tent, M47 carton. The straight garment rail and the
 * merchandising table have no model: their procedural forms.)
 */
export const STORE_OUTFITTER_MALL_MODELS: readonly string[] = [
  'mall-mall-cashwrap-counter.glb', 'mall-retail-gondola.glb', 'mall-garment-rail-round.glb', 'mall-garment-hanging-group.glb', 'mall-clothing-wall-unit.glb',
  'mall-outdoors-plank-shelving.glb', 'mall-storage-tote.glb', 'mall-shoe-wall-display.glb', 'mall-try-on-ottoman.glb', 'mall-camping-tent-display.glb',
  'mall-cardboard-box-flaps.glb',
];
