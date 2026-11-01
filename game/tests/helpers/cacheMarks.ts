// Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): READING the survivor's trail like a player (tests / the opt-in route walker).
// A mark is interpreted from what a player SEES only — its wall, its position on it and its arrow (or the hideout mark's place beside a
// doorway) — never from the record's `door` / `next` / `step` fields or any knowledge of the cache.

import {readMarkDoor} from '../../src/gen/annexMarks';
import type {Area, StationLayout} from '../../src/gen/stationTypes';
import type {CacheMark} from '../../src/gen/trackExt/types';

/** The doorways (layout.doors indices) of area `a` (an annex's own doors; a hatch's a === b entry included). */
export function doorsOfArea(layout: StationLayout, a: Area): number[] {
  const out: number[] = [];
  layout.doors.forEach((d, i) => { if (d.a === a.id || d.b === a.id) out.push(i); });
  return out;
}

/** The doorway a player reads off mark `m` in area `a` (gen/annexMarks.ts readMarkDoor: the mark's wall, place and arrow only). */
export function doorOfMark(layout: StationLayout, a: Area, m: CacheMark): number {
  return readMarkDoor(layout, a, m);
}

/** The trail marks (arrow / hideout) a player standing in area `id` sees: every one on its walls. */
export function marksIn(layout: StationLayout, id: number): CacheMark[] {
  return (layout.extensions?.cacheMarks ?? []).filter(m => m.area === id && m.kind !== 'tally');
}

/**
 * Follows the trail through the annex's door graph WITHOUT walking (the CI check): from `entry`, in each area read its mark (the doorway
 * it points at); an unmarked area with exactly one other doorway than the one just used is a corridor (go on); otherwise the player is
 * lost. Stops at `goal` (the test's target(s): a cache room — never consulted to choose). Returns the areas visited and whether it arrived.
 */
export function followTrail(layout: StationLayout, entry: number, goal: number | ReadonlySet<number>, maxSteps = 200): {areas: number[]; arrived: boolean; lost: number | null} {
  const areas = [entry], done = (id: number) => (typeof goal === 'number' ? id === goal : goal.has(id));
  let cur = entry, came = -1;
  for (let k = 0; k < maxSteps && !done(cur); k++) {
    const a = layout.areas[cur];
    const ms = marksIn(layout, cur);
    let door = -1;
    for (const m of ms) { const d = doorOfMark(layout, a, m); if (d >= 0 && d !== came) { door = d; break; } }
    if (door < 0) {
      const others = doorsOfArea(layout, a).filter(i => i !== came && layout.doors[i].a !== layout.doors[i].b);
      if (others.length !== 1) return {areas, arrived: false, lost: cur};
      door = others[0];
    }
    const d = layout.doors[door];
    const next = d.a === cur ? d.b : d.a;
    if (next === cur) return {areas, arrived: false, lost: cur};
    came = door; cur = next; areas.push(cur);
  }
  return {areas, arrived: done(cur), lost: done(cur) ? null : cur};
}
