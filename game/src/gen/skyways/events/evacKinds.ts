// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the Evac event's NEW prop kinds (hand-built simple meshes:
// code-drawn parts + canvas faces; existing kinds are reused wherever they fit). Every kind is classified honestly for the prop rules
// (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md): physics (dynamic / static reason), openables, damage, and a
// scale record. Merged by gen/skyways/events/kinds.ts. STUB (lead skeleton): lane EVAC adds its kinds.

import type {EventKindSpec} from './eventKindTypes';

export const EVAC_KINDS = [] as const;
export type EvacKind = (typeof EVAC_KINDS)[number];
export const EVAC_SPECS: Readonly<Record<EvacKind, EventKindSpec>> = {};
/** Scale-check records (tools/asset-pipeline/props/scale-check.mjs --kind <kind> beside zombie lastshift, viewed): W x H x D, contact. */
export const EVAC_SCALE: Readonly<Partial<Record<EvacKind, string>>> = {};
