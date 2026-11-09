// Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): the six new guns' data-driven WeaponDefs (ids: weapons/varietyIds.ts
// VARIETY_GUN_IDS). STUB (lead contract) until the GUNS lane fills it; weapons.ts spreads it into WEAPONS after the baseline four.
// A leaf module: import only TYPES from weapons.ts (runtime helpers: weapons/recoil.ts), never weapons.ts values (import cycle).
import type {WeaponDef} from './weapons';

export const VARIETY_GUN_DEFS: Readonly<Record<string, WeaponDef>> = {};
