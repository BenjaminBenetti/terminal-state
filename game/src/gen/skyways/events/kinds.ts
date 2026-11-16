// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): the MERGED new-event prop kinds (lanes EXPO / GOLF / EVAC kinds
// files), spread into the Skyways destination registry (gen/skyways/destinations/registry.ts) and from there into every shared table.

import type {EventKindSpec} from './eventKindTypes';
import {EXPO_KINDS, EXPO_SPECS, type ExpoKind} from './expoKinds';
import {GOLF_KINDS, GOLF_SPECS, type GolfKind} from './golfKinds';
import {EVAC_KINDS, EVAC_SPECS, type EvacKind} from './evacKinds';

export type SkywaysEventKind = ExpoKind | GolfKind | EvacKind;
export const SKYWAYS_EVENT_KINDS: readonly SkywaysEventKind[] = [...EXPO_KINDS, ...GOLF_KINDS, ...EVAC_KINDS];
const KIND_SET: ReadonlySet<string> = new Set(SKYWAYS_EVENT_KINDS);
export const isSkywaysEventKind = (k: string): k is SkywaysEventKind => KIND_SET.has(k);
export const SKYWAYS_EVENT_SPECS: Readonly<Record<SkywaysEventKind, EventKindSpec>> = {...EXPO_SPECS, ...GOLF_SPECS, ...EVAC_SPECS};
