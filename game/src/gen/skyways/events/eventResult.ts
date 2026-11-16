// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): what a new event's dresser returns (gen/skyways/addon.ts keeps it
// for QA / tests: skywaysAddonDressOf). Pure data.

import type {PropPlacement} from '../../props';

export interface EventDressResult {
  /** Every prop the event's dresser placed (layout.props order). */
  props: PropPlacement[];
  /** Pieces that could not be placed (QA; a small venue placing less than its target is a note, not a failure). */
  skipped: string[];
  /** Per-area props (area id -> placements; hosted decor under its host's area). */
  byArea: Record<number, PropPlacement[]>;
}
