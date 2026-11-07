// Task studio-skyways-destinations-20261106-170011-01: the MERGED registry of every Skyways DESTINATION prop kind (the three lanes'
// kinds files), spread into the shared tables by one tagged line each (gen/props.ts, damage/materials.ts, damage/physicsAudit.ts,
// world/openablesSpec.ts). Pure data.

import type {PropDef} from '../../props';
import type {DamageClass} from '../../../damage/materials';
import type {DestKindSpec, DestOpen, DestPhys} from './kindTypes';
import {LANDMARKS_KINDS, LANDMARKS_SPECS, type LandmarksKind} from './kindsLandmarks';
import {SHOPS_A_KINDS, SHOPS_A_SPECS, type ShopsAKind} from './kindsShopsA';
import {SHOPS_B_KINDS, SHOPS_B_SPECS, type ShopsBKind} from './kindsShopsB';
// task studio-alpha-skyways-shops-20261107-054512-01: + the ten major stores' own kinds (gen/skyways/stores/kinds/<family>.ts)
import {SKYWAYS_STORE_KINDS, SKYWAYS_STORE_SPECS, type SkywaysStoreKind} from '../stores/kinds/index';

export type SkywaysDestKind = LandmarksKind | ShopsAKind | ShopsBKind | SkywaysStoreKind;
export const SKYWAYS_DEST_KINDS: readonly SkywaysDestKind[] = [...LANDMARKS_KINDS, ...SHOPS_A_KINDS, ...SHOPS_B_KINDS, ...SKYWAYS_STORE_KINDS];
const KIND_SET: ReadonlySet<string> = new Set(SKYWAYS_DEST_KINDS);
export const isSkywaysDestKind = (k: string): k is SkywaysDestKind => KIND_SET.has(k);
export const SKYWAYS_DEST_SPECS: Readonly<Record<SkywaysDestKind, DestKindSpec>> = {...LANDMARKS_SPECS, ...SHOPS_A_SPECS, ...SHOPS_B_SPECS, ...SKYWAYS_STORE_SPECS};
const SPEC = SKYWAYS_DEST_SPECS as Readonly<Record<string, DestKindSpec>>;

const map = <T>(f: (s: DestKindSpec) => T): Record<SkywaysDestKind, T> => Object.fromEntries(SKYWAYS_DEST_KINDS.map(k => [k, f(SPEC[k])])) as Record<SkywaysDestKind, T>;
export const SKYWAYS_DEST_PROP_DEFS: Readonly<Record<SkywaysDestKind, PropDef>> = map(s => s.def);
export const SKYWAYS_DEST_PHYS: Readonly<Record<SkywaysDestKind, DestPhys>> = map(s => s.phys);
export const SKYWAYS_DEST_DAMAGE_CLASS: Readonly<Record<SkywaysDestKind, DamageClass>> = map(s => s.damage);
export const SKYWAYS_DEST_OPEN_AUDIT: readonly ({kind: SkywaysDestKind} & DestOpen)[] = SKYWAYS_DEST_KINDS.map(k => ({kind: k, ...SPEC[k].open}));
