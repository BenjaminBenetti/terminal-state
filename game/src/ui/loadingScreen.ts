// Task studio-beta-campaign-polish-20261103-063841-01 (lane MENU, item 9): THE LOADING SCREEN shows only the destination's location
// name (a campaign station: its network node's name — the same one adoptStationName prints on its signs; outside a campaign: the
// station's generated name, the mall's seeded name), above the progress bar. No objective text, no infected count, no "clear them
// out". The progress label under the bar is kept in the DOM (warm-up / perf / QA hooks write and read it) but is visually hidden
// (styles: ui/mainMenu.ts CSS) and announced politely to screen readers.
//
// The DEATH screen's last-save line (lane MENU, DEATH): what "Load last save" would restore, or why there is none — short and honest.

import type {SaveMeta} from '../campaign/types';
import type {LevelId} from '../levels/types';

export interface LoadingPlace {
  /** The campaign node being entered (its printed name wins). */
  node?: {name: string} | null;
  level: LevelId;
  /** The built layout's name (after generation; campaign layouts carry the node name). */
  layoutName?: string | null;
  /** The mall's seeded name (layout.mall.name). */
  mallName?: string | null;
  /** The level's display name (levelDisplayName: the seeded mall name, else the static level name). */
  levelName: string;
}

const clean = (s: string | null | undefined): string => (typeof s === 'string' ? s.trim() : '');

/** The loading screen's ONE line: the destination's location name. */
export function loadingPlaceName(p: LoadingPlace): string {
  return clean(p.node?.name) || (p.level === 'mall' ? clean(p.mallName) : '') || clean(p.layoutName) || clean(p.levelName) || 'Loading';
}

/** What the death screen's "Load last save" can do (Game.lastSaveStatus). */
export type LastSaveStatus =
  | {ok: true; slot: number; meta: SaveMeta}
  | {ok: false; reason: 'no-campaign' | 'no-slot' | 'unavailable' | 'empty' | 'invalid'; message: string};

/** The death screen's note under its actions (plain text). */
export function lastSaveNote(s: LastSaveStatus, when: (iso: string) => string = iso => iso): string {
  if (!s.ok) return s.message;
  const m = s.meta;
  return `Last save: ${m.station} · ${when(m.savedAt)} (slot ${s.slot}).`;
}
