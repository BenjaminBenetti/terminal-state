// Task studio-alpha-skyways-shops-20261107-054512-01: the HOBBY store's OWN new prop kinds (lane STORE-HOBBY), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Grain Elevator Models needs NO new kind: every fixture is an existing, already classified kind (gen/skyways/stores/hobbyDress.ts) —
// the destinations kit's diorama / robot / boxed kits / airship, the Mall's back counter, glass cases, glass counter, gondolas, cartons
// and tote, the Subway / P7 counters, shelving, desk, tool chest, pegboard, parts bins, lockers and cabinets.

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_HOBBY_KINDS = [] as const;
export type StoreHobbyKind = (typeof STORE_HOBBY_KINDS)[number];
export const STORE_HOBBY_SPECS: Readonly<Record<StoreHobbyKind, DestKindSpec>> = {};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * (the M01 back counter, M02 glass display cabinet, M15 glass display counter, M03 gondola, M47 openable carton, M18 storage tote)
 */
export const STORE_HOBBY_MALL_MODELS: readonly string[] = [
  'mall-mall-cashwrap-counter.glb', 'mall-glass-display-cabinet.glb', 'mall-glass-display-counter.glb', 'mall-retail-gondola.glb',
  'mall-cardboard-box-flaps.glb', 'mall-storage-tote.glb',
];
