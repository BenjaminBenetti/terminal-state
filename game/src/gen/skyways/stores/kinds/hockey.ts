// Task studio-alpha-skyways-shops-20261107-054512-01: the HOCKEY store's OWN new prop kinds (lane STORE-HOCKEY), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_HOCKEY_KINDS = [] as const;
export type StoreHockeyKind = (typeof STORE_HOCKEY_KINDS)[number];
export const STORE_HOCKEY_SPECS: Readonly<Record<StoreHockeyKind, DestKindSpec>> = {};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 */
export const STORE_HOCKEY_MALL_MODELS: readonly string[] = [];
