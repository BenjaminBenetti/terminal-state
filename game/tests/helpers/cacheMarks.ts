// Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): READING the survivor's trail like a player (tests / the opt-in route walker).
// A mark is interpreted from what a player SEES only — its wall, its position on it and its arrow (or the hideout mark's place beside a
// doorway) — never from the record's `door` / `next` / `step` fields or any knowledge of the cache.

import {CELL} from '../../src/gen/grid';
import {doorSide, wallRange} from '../../src/gen/placeKit';
import {doorSpan} from '../../src/gen/annexMarks';
import type {Area, Side, StationLayout} from '../../src/gen/stationTypes';
import type {CacheMark} from '../../src/gen/trackExt/types';

const sideOf = (m: Pick<CacheMark, 'axis' | 'n'>): Side => (m.axis === 'z' ? (m.n > 0 ? 'N' : 'S') : (m.n > 0 ? 'W' : 'E'));

/** The doorways (layout.doors indices) of area `a` (an annex's own doors; a hatch's a === b entry included). */
export function doorsOfArea(layout: StationLayout, a: Area): number[] {
  const out: number[] = [];
  layout.doors.forEach((d, i) => { if (d.a === a.id || d.b === a.id) out.push(i); });
  return out;
}

/**
 * The doorway a player reads off mark `m` in area `a`: an ARROW points along its wall at the nearest doorway in its direction on that
 * wall, else (it points into a corner) at the doorway nearest that corner on the wall meeting it there; a HIDEOUT mark sits beside its
 * doorway (the nearest one on its wall, else at a corner it is near). -1: nothing readable (a tally, or no doorway).
 */
export function doorOfMark(layout: StationLayout, a: Area, m: CacheMark): number {
  if (m.kind === 'tally') return -1;
  const side = sideOf(m), doors = doorsOfArea(layout, a);
  const onWall = (s: Side) => doors.filter(i => doorSide(layout.doors[i], a) === s).map(i => {
    const [d0, d1] = doorSpan(layout.doors[i], s);
    return {i, d0, d1, c: (d0 + d1) / 2};
  });
  const same = onWall(side), [lo, hi] = wallRange(a, side);
  // the viewer's right along the wall axis: an X-wall (axis 'z') +x * n, a Z-wall (axis 'x') -z * n
  const r = m.axis === 'z' ? m.n : -m.n;
  const corner = (end: number): number => {
    // the wall meeting this wall at `end`, and the corner's coordinate along that wall
    const meet: Side = m.axis === 'z' ? (end === lo ? 'W' : 'E') : (end === lo ? 'N' : 'S');
    const at = side === 'N' ? a.y * CELL : side === 'S' ? (a.y + a.h) * CELL : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
    let best = -1, bd = Infinity;
    for (const d of onWall(meet)) { const dist = Math.min(Math.abs(d.d0 - at), Math.abs(d.d1 - at)); if (dist < bd) { bd = dist; best = d.i; } }
    return bd <= 1.5 ? best : -1;
  };
  if (m.kind === 'arrow' && m.dir) {
    const sgn = (m.dir === 'right' ? 1 : -1) * r; // +1: toward +axis
    let best = -1, bd = Infinity;
    for (const d of same) { const s = (d.c - m.c) * sgn; if (s > 0 && s < bd) { bd = s; best = d.i; } }
    return best >= 0 ? best : corner(sgn > 0 ? hi : lo);
  }
  let best = -1, bd = Infinity;
  for (const d of same) { const s = Math.abs(d.c - m.c); if (s < bd) { bd = s; best = d.i; } }
  if (best >= 0 && bd < m.w / 2 + 2) return best;
  const c = corner(Math.abs(m.c - lo) < Math.abs(m.c - hi) ? lo : hi);
  return c >= 0 ? c : best;
}

/** The trail marks (arrow / hideout) a player standing in area `id` sees: every one on its walls. */
export function marksIn(layout: StationLayout, id: number): CacheMark[] {
  return (layout.extensions?.cacheMarks ?? []).filter(m => m.area === id && m.kind !== 'tally');
}

/**
 * Follows the trail through the annex's door graph WITHOUT walking (the CI check): from `entry`, in each area read its mark (the doorway
 * it points at); an unmarked area with exactly one other doorway than the one just used is a corridor (go on); otherwise the player is
 * lost. Stops at `goal` (the test's target — never consulted to choose). Returns the areas visited and whether it arrived.
 */
export function followTrail(layout: StationLayout, entry: number, goal: number, maxSteps = 200): {areas: number[]; arrived: boolean; lost: number | null} {
  const areas = [entry];
  let cur = entry, came = -1;
  for (let k = 0; k < maxSteps && cur !== goal; k++) {
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
  return {areas, arrived: cur === goal, lost: cur === goal ? null : cur};
}
