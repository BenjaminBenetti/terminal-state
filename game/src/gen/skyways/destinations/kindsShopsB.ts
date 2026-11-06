// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-B (C): garden, arcade, cinema, science, hockey): this lane's Skyways DESTINATION prop kinds (kindTypes.ts
// DestKindSpec each). Merged by registry.ts into the shared tables — never edit the shared tables for these kinds.

import type {DestKindSpec} from './kindTypes';

export const SHOPS_B_KINDS = [] as const;
export type ShopsBKind = (typeof SHOPS_B_KINDS)[number];
export const SHOPS_B_SPECS: Readonly<Record<ShopsBKind, DestKindSpec>> = {};
