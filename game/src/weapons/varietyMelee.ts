// Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): the six new melee weapons' WeaponDefs (ids: weapons/varietyIds.ts
// VARIETY_MELEE_IDS). STUB (lead contract) until the MELEE lane fills it; weapons.ts spreads it into WEAPONS after the baseline four.
// A leaf module: import only TYPES from weapons.ts, never weapons.ts values (import cycle).
import type {WeaponDef} from './weapons';

export const VARIETY_MELEE_DEFS: Readonly<Record<string, WeaponDef>> = {};
