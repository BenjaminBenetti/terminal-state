// Task studio-subway-architecture-materials-rework-20261117-072826-01: the STRUCTURAL BAY RHYTHM of a Subway hall (pure data, no three.js).
//
// User: a grand hall "is a huge empty room with about 50 hanging lights … unrealistic"; the station needs architecture, not boxes. A big
// underground hall reads as architecture when its ceiling structure, wall pilasters, lights and furnishing all keep ONE rhythm: transverse
// beams land on the column rows (or on wall pilasters where a hall has none), the lights sit in the bays between them, waiting pockets and
// kiosks fill bays instead of a uniform scatter. This module is that single source of truth, read by the generator's hall lighting
// (gen/subwayHallLights.ts) and by the renderer's architectural kit (world/subwayKit.ts), so the two can never drift apart.
//
// A hall's bays come from its own column props when it has rows of them (the dresser's columnRow / the version-3 arcades): the along
// positions of its longest row are the bay lines. A hall without column rows gets an even rhythm of BAY_TARGET m between its end walls.
// Deterministic, RNG-free, from the layout alone (so an existing saved station draws the same bays on every reload).

import {CELL} from './grid';
import type {Area, StationLayout} from './stationTypes';

/** Preferred bay length (m) of a hall without column rows. */
export const BAY_TARGET = 7.5;
/** Shortest / longest bay accepted from an even split (m). */
const BAY_MIN = 5.5, BAY_MAX = 9.5;

export interface HallBays {
  area: number;
  /** The hall's long axis runs along world X (else Z). Bay lines are transverse to it. */
  alongX: boolean;
  /** World extent of the hall along / across its long axis (m). */
  a0: number; a1: number; c0: number; c1: number;
  /** World positions ALONG the long axis of the transverse bay lines (sorted; the end walls are not included). */
  lines: number[];
  /** World positions ACROSS the long axis of the hall's column rows (sorted; empty without rows). */
  rows: number[];
  /** True when the lines come from the hall's own column rows (else an even split). */
  fromColumns: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The bay rhythm of a (rectangular) hall area. */
export function hallBays(layout: Pick<StationLayout, 'props'>, a: Area): HallBays {
  const alongX = a.w >= a.h;
  const a0 = (alongX ? a.x : a.y) * CELL, a1 = (alongX ? a.x + a.w : a.y + a.h) * CELL;
  const c0 = (alongX ? a.y : a.x) * CELL, c1 = (alongX ? a.y + a.h : a.x + a.w) * CELL;
  // column rows: the area's column props grouped by their across coordinate (a row = >= 2 columns)
  const byRow = new Map<number, number[]>();
  for (const p of layout.props) {
    if (p.kind !== 'column' || p.area !== a.id) continue;
    const across = r2(alongX ? p.z : p.x), along = alongX ? p.x : p.z;
    let row = byRow.get(across);
    if (!row) byRow.set(across, (row = []));
    row.push(along);
  }
  const rows = [...byRow.entries()].filter(([, v]) => v.length >= 2).sort((x, y) => x[0] - y[0]);
  if (rows.length) {
    // the longest row sets the lines (ties: the row nearest the hall's centre line)
    const mid = (c0 + c1) / 2;
    const best = rows.reduce((b, r) => (r[1].length > b[1].length || (r[1].length === b[1].length && Math.abs(r[0] - mid) < Math.abs(b[0] - mid)) ? r : b));
    const lines = [...new Set(best[1].map(r2))].sort((x, y) => x - y);
    return {area: a.id, alongX, a0, a1, c0, c1, lines, rows: rows.map(r => r[0]), fromColumns: true};
  }
  return {area: a.id, alongX, a0, a1, c0, c1, lines: evenLines(a0, a1), rows: [], fromColumns: false};
}

/** Interior lines of an even split of [a0, a1] into bays near BAY_TARGET m (none when the span is shorter than one bay). */
export function evenLines(a0: number, a1: number, target = BAY_TARGET): number[] {
  const len = a1 - a0;
  if (len < BAY_MIN * 1.5) return [];
  let n = Math.max(2, Math.round(len / target));
  while (n > 2 && len / n < BAY_MIN) n--;
  while (len / n > BAY_MAX) n++;
  const out: number[] = [];
  for (let i = 1; i < n; i++) out.push(r2(a0 + (len * i) / n));
  return out;
}

/** The bays of a hall as [start, end] spans along its long axis (end walls included as the outer bounds). */
export function bayBounds(b: HallBays): [number, number][] {
  const edges = [b.a0, ...b.lines.filter(l => l > b.a0 + 0.5 && l < b.a1 - 0.5), b.a1];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < edges.length; i++) out.push([edges[i], edges[i + 1]]);
  return out;
}
