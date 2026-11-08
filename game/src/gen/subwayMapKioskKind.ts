// Task studio-ui-subway-maps-20261108-074144-01 (user: "add map kiosks to the subway level, similar to the mall level"): the SUBWAY LOCAL MAP
// KIOSK prop kind — `subwayMapKiosk`, a wall-backed "STATION MAP" pylon in the Mall directory's proportions (gen/mall/kinds.ts
// directoryPylon 0.9 x 0.3 x 2.1 m): a painted-steel cabinet on a plinth whose front carries a printed plan of THIS generated station
// behind a glazed panel, a header band on top. Pure data (no three.js). Placed by gen/subwayMapKiosks.ts (after generation: the station's
// own output is untouched), drawn by world/subwayMapKiosks.ts, read up close by world/subwayMapRead.ts.
//
// Classified for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md) and spread into the shared tables by
// one tagged line each: gen/props.ts PROP_DEFS (+ PropKind), damage/materials.ts PROP_DAMAGE, damage/physicsAudit.ts SUBWAY_STATIC,
// world/openablesSpec.ts OPENABLE_AUDIT:
//  - rule 1: a sealed sign, not storage (the plan behind a screwed glazed panel in a welded cabinet: no door, lid or drawer);
//  - rule 2 / 3: static, `anchored` — a ~120 kg steel cabinet bolted to the floor and the wall behind it;
//  - rule 4: nothing loose is part of it; rule 5: SUBWAY_MAP_KIOSK_SCALE below.

import type {PropDef} from './props';
import type {DamageClass, StaticWhy} from '../damage/materials';

export const SUBWAY_MAP_KIOSK_KINDS = ['subwayMapKiosk'] as const;
export type SubwayMapKioskKind = (typeof SUBWAY_MAP_KIOSK_KINDS)[number];
export const isSubwayMapKioskKind = (k: string): k is SubwayMapKioskKind => k === 'subwayMapKiosk';

/**
 * The kiosk's shape (prop frame: origin bottom centre, front +Z, back against the wall at -d/2; metres). A plinth (`plinthH` high, the
 * full footprint), the cabinet (`w` x `d`, up to `top`), a header band (`headerY0`..`top`, the "STATION MAP" line printed with the plan),
 * and the printed panel: `faceW` x `faceH`, centred on the front, from `faceY0` up, `faceInset` behind the cabinet's front frame.
 */
export const SUBWAY_MAP_KIOSK = {
  w: 0.9, d: 0.3, top: 2.1, plinthH: 0.1, plinthOut: 0.02,
  faceW: 0.76, faceH: 1.14, faceY0: 0.8, faceInset: 0.012, frame: 0.05,
} as const;

/** Collision box: the cabinet (the plinth's lip is inside the 0.5 m cell footprint). */
export const SUBWAY_MAP_KIOSK_PROP_DEFS: Readonly<Record<SubwayMapKioskKind, PropDef>> = {
  subwayMapKiosk: {w: SUBWAY_MAP_KIOSK.w, d: SUBWAY_MAP_KIOSK.d, h: SUBWAY_MAP_KIOSK.top, blocksSight: false},
};

export const SUBWAY_MAP_KIOSK_DAMAGE_CLASS: Readonly<Record<SubwayMapKioskKind, DamageClass>> = {subwayMapKiosk: 'sheetMetal'};

/** Physics-affordance row (damage/physicsAudit.ts SUBWAY_STATIC). */
export const SUBWAY_MAP_KIOSK_STATIC: Readonly<Record<SubwayMapKioskKind, readonly [StaticWhy, string]>> = {
  subwayMapKiosk: ['anchored', 'station map kiosk: a ~120 kg steel cabinet bolted to the floor and the wall behind it (a bump or a bullet never shifts it)'],
};

export const SUBWAY_MAP_KIOSK_OPEN_AUDIT: readonly {kind: SubwayMapKioskKind; cls: 'none'; role: 'equipment'; how: string}[] = [
  {kind: 'subwayMapKiosk', cls: 'none', role: 'equipment', how: 'sealed map sign: the printed station plan behind a screwed glazed panel in a welded steel cabinet, no door, lid or drawer'},
];

/**
 * Scale-check record (rule 5; tools/asset-pipeline/props/scale-check.mjs on the kiosk's exact runtime geometry — world/subwayMapKiosks.ts
 * subwayMapKioskBody + subwayMapKioskFaceGeometry exported to a GLB — beside a runtime-scaled standing zombie, front and side views looked
 * at; render in the task's private qa folder): W x H x D, grounded contact, notes.
 */
export const SUBWAY_MAP_KIOSK_SCALE = '0.94 x 2.10 x 0.34 m (plinth lip included; cabinet 0.90 x 0.30); grounded on its plinth (contact 0.94 x 0.34 m), ' +
  'back to the wall; the printed panel from 0.80 to 1.94 m: an adult reads the plan at eye height, a head taller than a standing zombie, like a station map pylon';
