// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): the shape of the new events' PROP KINDS — a Skyways destination
// kind spec (gen/skyways/destinations/kindTypes.ts: def / phys / damage / open / code-drawn parts, spread into the shared tables through
// gen/skyways/destinations/registry.ts) plus optional CANVAS FACES: flat quads showing a locally drawn graphic (screens, signs, notes,
// scorecards). Faces are DYNAMIC textures (root CLAUDE.md: runtime-composited per-seed text / data over code shapes — fictional names,
// slide text, hole numbers, note text), painted by the event's world/skywaysEvent*Draw.ts painter `paint`. Pure data (no three.js).

import type {DestKindSpec} from '../destinations/kindTypes';

/**
 * A canvas face of a kind (prop frame: origin bottom centre, front +Z, metres): a w x h quad centred at p facing +Z (rx about X, then
 * ry about Y), showing painter `paint` (its id in the event's painter table) drawn for the placement's variant; `glow` > 0 = self-lit
 * (a screen), `back` = also on the reverse face.
 */
export interface EventFace { paint: string; w: number; h: number; p: readonly [number, number, number]; rx?: number; ry?: number; glow?: number; back?: boolean }

export interface EventKindSpec extends DestKindSpec {
  /** The canvas faces per placement variant (world/skywaysEventDraw.ts: one batch per kind / variant / face). */
  faces?: (variant: number) => readonly EventFace[];
}
