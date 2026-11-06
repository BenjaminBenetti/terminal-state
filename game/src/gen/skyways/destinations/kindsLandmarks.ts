// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): this lane's Skyways DESTINATION prop kinds (kindTypes.ts
// DestKindSpec each). Merged by registry.ts into the shared tables — never edit the shared tables for these kinds.

import type {DestKindSpec} from './kindTypes';

export const LANDMARKS_KINDS = [] as const;
export type LandmarksKind = (typeof LANDMARKS_KINDS)[number];
export const LANDMARKS_SPECS: Readonly<Record<LandmarksKind, DestKindSpec>> = {};
