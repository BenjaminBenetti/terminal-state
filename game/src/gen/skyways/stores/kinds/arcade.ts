// Task studio-alpha-skyways-shops-20261107-054512-01: the ARCADE store's OWN new prop kinds (lane STORE-ARCADE), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Lane STORE-ARCADE: NO new kinds. Starfall Arcade is furnished entirely from existing kinds (stores/arcadeDress.ts): the company
// arcade cabinet / giant teddy / gumball machine / jukebox, the Skyways destination claw crane / air hockey / pinball, the Subway coin
// machine form (the token changer), capsule-toy machines, rolling tool chest, TV cart, the purpose repair bench / lockers / shelving,
// and these Mall models.

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_ARCADE_KINDS = [] as const;
export type StoreArcadeKind = (typeof STORE_ARCADE_KINDS)[number];
export const STORE_ARCADE_SPECS: Readonly<Record<StoreArcadeKind, DestKindSpec>> = {};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * (gen/mall/kinds.ts MALL_KIND_ASSET: glassCounter, glassDisplayCabinet, mallCashwrapCounter, kiddieRide, foodCourtTableSet,
 * storageTote, cardboardBoxFlaps.)
 */
export const STORE_ARCADE_MALL_MODELS: readonly string[] = [
  'mall-glass-display-counter.glb', 'mall-glass-display-cabinet.glb', 'mall-mall-cashwrap-counter.glb', 'mall-kiddie-ride.glb',
  'mall-food-court-table-set.glb', 'mall-storage-tote.glb', 'mall-cardboard-box-flaps.glb',
];
