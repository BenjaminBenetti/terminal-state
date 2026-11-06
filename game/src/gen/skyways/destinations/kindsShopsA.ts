// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-A (B): books, outfitter, music, hobby, design): this lane's Skyways DESTINATION prop kinds (kindTypes.ts
// DestKindSpec each). Merged by registry.ts into the shared tables — never edit the shared tables for these kinds.

import type {DestKindSpec} from './kindTypes';

export const SHOPS_A_KINDS = [] as const;
export type ShopsAKind = (typeof SHOPS_A_KINDS)[number];
export const SHOPS_A_SPECS: Readonly<Record<ShopsAKind, DestKindSpec>> = {};
