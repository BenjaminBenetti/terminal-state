// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EXPO): the Expo event's own drawing — its canvas PAINTERS (the
// graphics its kinds' faces name: locally painted per-variant screens / signs / cards — dynamic per-seed text over code shapes) and a
// drawer for any kind that needs more than the generic parts + faces of world/skywaysEventDraw.ts. STUB (lead skeleton).

import type * as THREE from 'three';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import type {WorldMaterials} from './materials';
import type {EventPainter} from './skywaysEventDraw';

export const EXPO_PAINTERS: Readonly<Record<string, EventPainter>> = {};

/** Draws a kind this lane draws itself (returns its instance count), or null (the generic parts + faces). */
export function drawExpoProp(group: THREE.Group, kind: string, list: readonly PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number | null {
  void group; void kind; void list; void wm; void layout;
  return null;
}
