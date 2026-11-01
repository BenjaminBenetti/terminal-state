// Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): THE SURVIVOR'S TRAIL — graffiti clues that guide from the annex entrance
// to the hideout. User (round 3): "additional graffite clues in the area should guid the player to the hideout / cache … it needs to
// be a good pay off for navigating the confusing maze of rooms."
//
// planCacheMarks runs right after the survivor caches (gen/annexContent.ts populateExtensions, fork `marks:<annexId>`), DATA ONLY:
// records in layout.extensions.cacheMarks (world/trackExt/graffiti.ts cacheMarkDecals paints them into the ONE graffiti mesh with the
// shared atlas; gen/trackExt/art.ts stationArtKeepouts keeps the wall treatment off them). No annex -> no marks.
//
// The trail: the shortest door-hop path (BFS over the annex's own door graph, door order = layout order) from the annex's entry area to
// its FIRST cache room (the hideout). In each area on the path the player must leave by the path's next doorway; a mark goes on that
// area's wall right beside that doorway (the side the player stands on), an arrow + the recurring survivor symbol (a circled
// triangle) pointing at the opening:
//   - always in the entry area (the start of the trail: the first time the player meets the symbol);
//   - at every JUNCTION — an area with 3+ doorways, where the player must choose;
//   - on every doorway of the last `dense` areas before the hideout (denser near the end);
//   - the doorway INTO the hideout gets the distinctive HIDEOUT mark instead (the symbol + "SAFE"); a second cache in a large annex gets
//     one too, on the last doorway of its own path;
//   - inside the hideout (and a second cache), the survivor's TALLY (days counted) on a quiet wall.
// Placement rule: on a real wall face (the grid cells behind the whole mark + a frame margin are rock, the cells in front are the
// area's floor), on the doorway's own wall beside its frame (either side, up to 1 m along), else on the perpendicular wall at a corner
// the doorway meets (the arrow then points into that corner); clear of door frames (frameGap), signs (door plates), props against the
// wall (anything within `propReach` of the wall reaching the mark's height), steam vents and other marks; under the ceiling. A doorway
// with no valid spot gets no mark (counted: CacheMarkReport.missed).

import type {Rng} from '../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from './grid';
import {doorSide, levelGrid, wallRange} from './placeKit';
import type {Area, Door, Side, StationLayout} from './stationTypes';
import type {CacheMark, ServiceAnnex} from './trackExt/types';
import type {AnnexCacheRecord} from './annexCache';

/** THE trail config (docs/track-extensions.md "The survivor's trail"). */
export const CACHE_MARKS = {
  /** Mark sizes (m, 2:1 like the atlas cells) and centre heights over the floor. */
  arrow: {w: 0.9, h: 0.45, y: 1.5},
  hideout: {w: 1.0, h: 0.5, y: 1.55},
  tally: {w: 0.8, h: 0.4, y: 1.35},
  /** A doorway whose wall has no room for the full mark (a doorway filling a narrow end wall, flanked by other doorways) gets a SMALL one. */
  small: {w: 0.6, h: 0.3, frameGap: 0.15},
  /** Gap from a doorway's opening to the mark (the frame trim + a hand's width). */
  frameGap: 0.3,
  /** Slide along the wall away from the doorway in `step` m steps up to `slide` m when the first spot is taken. */
  step: 0.25, slide: 2.0,
  /**
   * A doorway this close to a corner (m) may be marked on the perpendicular wall at that corner instead (the arrow points into the
   * corner; at the corner the doorway is the nearest one on the wall meeting it there — corridors: its far end).
   */
  cornerReach: 6.0,
  /** A prop within this distance of the wall plane (m) that reaches the mark's height blocks it. */
  propReach: 0.6,
  /** Keep this far from a corner (m) and from the ceiling (m); this far from a steam vent (m); between two marks on one wall (m). */
  corner: 0.1, ceil: 0.15, vent: 0.8, gap: 0.3,
  /** Height offsets tried in order (m): the mark's own height, then lower (under a door plate), then higher. */
  heights: [0, -0.5, 0.45] as readonly number[],
  /** Every doorway of the last `dense` areas before the hideout gets a mark (denser near the end). */
  dense: 3,
};

/** What the planner did for one annex (census / tests). */
export interface CacheMarkReport { annex: number; path: number[]; doors: number[]; marks: number; missed: number; junctions: number }

const REPORTS = new WeakMap<StationLayout, CacheMarkReport[]>();
/** The trail reports of a populated layout (one per annex with a cache). */
export function cacheMarkReportsOf(layout: StationLayout): readonly CacheMarkReport[] { return REPORTS.get(layout) ?? []; }

/** The annex side of its entry door (a tunnel annex: the corridor beyond the tunnel; a hatch annex: a === b === the corridor). */
export function annexEntryArea(layout: StationLayout, n: ServiceAnnex): number {
  const d = layout.doors[n.door], ids = new Set(n.areas);
  return d ? (ids.has(d.b) ? d.b : d.a) : n.areas[0];
}

/**
 * The shortest door-hop path inside the annex from `from` to `to` (BFS, doors in layout order): the areas and the doors between
 * them (doors[i] joins areas[i] and areas[i + 1]); null when unreachable.
 */
export function annexPath(layout: StationLayout, n: ServiceAnnex, from: number, to: number): {areas: number[]; doors: number[]} | null {
  const ids = new Set(n.areas), nb = new Map<number, [number, number][]>();
  layout.doors.forEach((d, i) => {
    if (d.a === d.b || !ids.has(d.a) || !ids.has(d.b)) return;
    for (const [p, q] of [[d.a, d.b], [d.b, d.a]] as const) { let l = nb.get(p); if (!l) nb.set(p, (l = [])); l.push([q, i]); }
  });
  const prev = new Map<number, [number, number]>([[from, [-1, -1]]]), queue = [from];
  for (let h = 0; h < queue.length && !prev.has(to); h++) {
    for (const [q, di] of nb.get(queue[h]) ?? []) if (!prev.has(q)) { prev.set(q, [queue[h], di]); queue.push(q); }
  }
  if (!prev.has(to)) return null;
  const areas = [to], doors: number[] = [];
  for (let c = to; c !== from;) { const [p, di] = prev.get(c)!; doors.unshift(di); areas.unshift(p); c = p; }
  return {areas, doors};
}

/** The wall frame of side `s` of area `a`: plane axis / coordinate, inward normal sign, the along-wall axis direction. */
export function wallFrame(a: Area, s: Side): {axis: 'x' | 'z'; plane: number; n: 1 | -1} {
  if (s === 'N') return {axis: 'z', plane: a.y * CELL, n: 1};
  if (s === 'S') return {axis: 'z', plane: (a.y + a.h) * CELL, n: -1};
  if (s === 'W') return {axis: 'x', plane: a.x * CELL, n: 1};
  return {axis: 'x', plane: (a.x + a.w) * CELL, n: -1};
}

/** The world span of door `d` along the wall it opens in (world x for an N / S wall, z for W / E). */
export function doorSpan(d: Door, s: Side): [number, number] {
  return s === 'N' || s === 'S' ? [d.x * CELL, (d.x + d.w) * CELL] : [d.y * CELL, (d.y + d.h) * CELL];
}

/** For a viewer facing a wall (inward normal n on `axis`), whether world coordinate `toward` lies to their right of `c`. */
export function arrowDir(axis: 'x' | 'z', n: 1 | -1, c: number, toward: number): 'left' | 'right' {
  // viewer's right r = (n_z, 0, -n_x): an X-wall (axis 'z', normal (0,0,n)) has right = +x * n; a Z-wall (axis 'x') right = -z * n
  const r = axis === 'z' ? n : -n;
  return (toward - c) * r >= 0 ? 'right' : 'left';
}

/** World point (x, z) of along-wall coordinate `c` on a wall frame, `off` metres off the plane into the area. */
export function markXZ(m: Pick<CacheMark, 'axis' | 'plane' | 'n' | 'c'>, off = 0): [number, number] {
  return m.axis === 'z' ? [m.c, m.plane + m.n * off] : [m.plane + m.n * off, m.c];
}

/**
 * Plans the survivor's trail of ONE annex (see the header) into `out` (appended records). `caches`: this annex's caches (the first =
 * the hideout). Deterministic for (layout, rng seed).
 */
export function planCacheMarks(layout: StationLayout, n: ServiceAnnex, caches: readonly AnnexCacheRecord[], rng: Rng, out: CacheMark[]): CacheMarkReport | null {
  if (!caches.length) return null;
  const M = CACHE_MARKS, ids = new Set(n.areas);
  const entry = annexEntryArea(layout, n);
  const path = annexPath(layout, n, entry, caches[0].area);
  const rep: CacheMarkReport = {annex: n.id, path: path?.areas ?? [], doors: path?.doors ?? [], marks: 0, missed: 0, junctions: 0};
  const all = REPORTS.get(layout) ?? [];
  all.push(rep);
  REPORTS.set(layout, all);
  if (!path) return rep;
  const degree = new Map<number, number>();
  for (const d of layout.doors) { if (ids.has(d.a)) degree.set(d.a, (degree.get(d.a) ?? 0) + 1); if (ids.has(d.b) && d.b !== d.a) degree.set(d.b, (degree.get(d.b) ?? 0) + 1); }
  const propsOf = new Map<number, number[]>();
  layout.props.forEach((p, i) => { if (ids.has(p.area)) { let l = propsOf.get(p.area); if (!l) propsOf.set(p.area, (l = [])); l.push(i); } });
  // the signs on / near the annex's walls (door plates beside its doorways), bucketed once
  const box = {x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity};
  for (const id of n.areas) { const a = layout.areas[id]; if (!a) continue; box.x0 = Math.min(box.x0, a.x * CELL - 1); box.z0 = Math.min(box.z0, a.y * CELL - 1); box.x1 = Math.max(box.x1, (a.x + a.w) * CELL + 1); box.z1 = Math.max(box.z1, (a.y + a.h) * CELL + 1); }
  const signs = layout.signs.filter(sg => sg.x >= box.x0 && sg.x <= box.x1 && sg.z >= box.z0 && sg.z <= box.z1);
  const vents = (layout.extensions?.vents ?? []).filter(v => ids.has(v.area));
  const K = path.doors.length;
  const doorsOf = new Map<number, number[]>();
  layout.doors.forEach((d, i) => { if (d.a === d.b) return; for (const id of [d.a, d.b]) if (ids.has(id)) { let l = doorsOf.get(id); if (!l) doorsOf.set(id, (l = [])); l.push(i); } });
  const ctx: MarkCtx = {layout, n, rng, out, propsOf, signs, vents, doorsOf};
  for (let i = 0; i < K; i++) {
    const a = layout.areas[path.areas[i]], d = path.doors[i];
    const junction = (degree.get(a.id) ?? 0) >= 3;
    if (junction) rep.junctions++;
    const last = i === K - 1;
    if (!(i === 0 || junction || i >= K - M.dense || last)) continue;
    const ok = placeDoorMark(ctx, a, d, path.areas[i + 1], last ? 'hideout' : 'arrow', i);
    if (ok) rep.marks++; else rep.missed++;
  }
  // a second cache (large annexes): its own hideout mark on the last doorway of its path
  for (const c of caches.slice(1)) {
    const p2 = annexPath(layout, n, entry, c.area);
    if (!p2 || !p2.doors.length) continue;
    const k = p2.doors.length - 1;
    if (placeDoorMark(ctx, layout.areas[p2.areas[k]], p2.doors[k], c.area, 'hideout', k)) rep.marks++; else rep.missed++;
  }
  // the survivor's tally inside every cache room (a quiet wall first)
  for (const c of caches) { const h = layout.areas[c.area]; if (h && placeTally(ctx, h, K)) rep.marks++; }
  return rep;
}

interface MarkCtx {
  layout: StationLayout; n: ServiceAnnex; rng: Rng; out: CacheMark[]; propsOf: Map<number, number[]>;
  signs: readonly StationLayout['signs'][number][]; vents: readonly {x: number; y: number; z: number}[];
  /** Each annex area's doorways (layout.doors indices; a hatch's a === b entry left out). */
  doorsOf: Map<number, number[]>;
}

/** A trail mark in area `a` beside door `di` (leading to `next`): the doorway's wall, else a perpendicular wall at a corner it meets. */
function placeDoorMark(ctx: MarkCtx, a: Area, di: number, next: number, kind: 'arrow' | 'hideout', step: number): boolean {
  const M = CACHE_MARKS, d = ctx.layout.doors[di], full = kind === 'hideout' ? M.hideout : M.arrow;
  const side = doorSide(d, a), f = wallFrame(a, side), [d0, d1] = doorSpan(d, side), [lo, hi] = wallRange(a, side);
  const dc = (d0 + d1) / 2;
  const sides = ctx.rng.chance(0.5) ? [1, -1] : [-1, 1];
  // the area's other doorways by wall: a mark is never read past one (no other opening between the mark and what it points at)
  const mine = ctx.doorsOf.get(a.id) ?? [], bySide = new Map<Side, [number, number][]>();
  const others = (s: Side) => {
    let l = bySide.get(s);
    if (!l) bySide.set(s, (l = mine.filter(i => i !== di && doorSide(ctx.layout.doors[i], a) === s).map(i => doorSpan(ctx.layout.doors[i], s))));
    return l;
  };
  const clearBetween = (s: Side, c: number, to: number) => others(s).every(([q0, q1]) => q1 <= Math.min(c, to) || q0 >= Math.max(c, to));
  // the full mark everywhere first, then the small one
  for (const [S, gap] of [[full, M.frameGap], [{...full, w: M.small.w, h: M.small.h}, M.small.frameGap]] as const) {
  // 1. the doorway's own wall, beside its frame (sliding away from it while no other doorway comes between)
  for (let k = 0; k * M.step <= M.slide + 1e-9; k++) for (const sg of sides) {
    const c = sg > 0 ? d1 + gap + S.w / 2 + k * M.step : d0 - gap - S.w / 2 - k * M.step;
    if (!clearBetween(side, c, dc)) continue;
    if (tryMark(ctx, a, f, c, S, kind, di, next, step, kind === 'arrow' ? arrowDir(f.axis, f.n, c, dc) : null, gap)) return true;
  }
  // 2. a perpendicular wall at a corner the doorway meets (within `cornerReach` of its edge): the arrow points into that corner (no
  // other doorway on that wall between the mark and the corner, none on the doorway's wall between the corner and the doorway)
  for (const [corner, edge] of [[lo, d0], [hi, d1]] as const) {
    if (Math.abs(edge - corner) > M.cornerReach || !clearBetween(side, corner, dc)) continue;
    const ps: Side = side === 'N' || side === 'S' ? (corner === lo ? 'W' : 'E') : (corner === lo ? 'N' : 'S');
    const pf = wallFrame(a, ps), [plo, phi] = wallRange(a, ps);
    const near = (side === 'N' || side === 'W') ? plo : phi; // the end of the perpendicular wall at this corner (where the doorway's wall is)
    const into = near === plo ? 1 : -1;
    for (let k = 0; k * M.step <= M.slide + 1e-9; k++) {
      const c = near + into * (M.corner + 0.15 + S.w / 2 + k * M.step);
      if (!clearBetween(ps, c, near)) continue;
      if (tryMark(ctx, a, pf, c, S, kind, di, next, step, kind === 'arrow' ? arrowDir(pf.axis, pf.n, c, near) : null, gap)) return true;
    }
  }
  }
  return false;
}

/** The survivor's tally inside the hideout: a wall without a doorway first, centred-ish, any valid spot. */
function placeTally(ctx: MarkCtx, a: Area, step: number): boolean {
  const M = CACHE_MARKS, S = M.tally;
  const doorSides = new Set((ctx.doorsOf.get(a.id) ?? []).map(i => doorSide(ctx.layout.doors[i], a)));
  const order = (['N', 'S', 'W', 'E'] as Side[]).sort((p, q) => Number(doorSides.has(p)) - Number(doorSides.has(q)));
  for (const s of order) {
    const f = wallFrame(a, s), [lo, hi] = wallRange(a, s), spots: number[] = [];
    for (let c = lo + S.w / 2 + 0.3; c <= hi - S.w / 2 - 0.3 + 1e-9; c += M.step) spots.push(Math.round(c * 1000) / 1000);
    for (const c of ctx.rng.shuffle(spots)) if (tryMark(ctx, a, f, c, S, 'tally', -1, a.id, step, null)) return true;
  }
  return false;
}

/** Validates one spot (the header's placement rule) and appends the record. */
function tryMark(ctx: MarkCtx, a: Area, f: {axis: 'x' | 'z'; plane: number; n: 1 | -1}, c: number, S: {w: number; h: number; y: number}, kind: CacheMark['kind'], door: number, next: number, step: number, dir: 'left' | 'right' | null, frameGap: number = CACHE_MARKS.frameGap): boolean {
  const M = CACHE_MARKS, layout = ctx.layout;
  const g = levelGrid(layout, a.level ?? 0);
  const side: Side = f.axis === 'z' ? (f.n > 0 ? 'N' : 'S') : (f.n > 0 ? 'W' : 'E');
  const [lo, hi] = wallRange(a, side);
  const c0 = c - S.w / 2, c1 = c + S.w / 2;
  if (c0 < lo + M.corner || c1 > hi - M.corner) return false;
  // rock behind the whole mark + the frame margin, the area's floor in front
  const front = (side === 'N' ? a.y : side === 'S' ? a.y + a.h - 1 : side === 'W' ? a.x : a.x + a.w - 1);
  const back = (side === 'N' ? a.y - 1 : side === 'S' ? a.y + a.h : side === 'W' ? a.x - 1 : a.x + a.w);
  const cellAt = (along: number, across: number) => (f.axis === 'z' ? [along, across] : [across, along]) as [number, number];
  const k0 = Math.floor((c0 - frameGap + 0.05) / CELL), k1 = Math.floor((c1 + frameGap - 0.05) / CELL);
  for (let k = k0; k <= k1; k++) {
    const [bx, by] = cellAt(k, back);
    if (!g.inBounds(bx, by) || g.cells[g.idx(bx, by)] !== SOLID) return false;
  }
  const f0 = Math.floor((c0 + 1e-6) / CELL), f1 = Math.floor((c1 - 1e-6) / CELL);
  let floorY = Infinity;
  for (let k = f0; k <= f1; k++) {
    const [fx, fy] = cellAt(k, front);
    if (!g.inBounds(fx, fy)) return false;
    const i = g.idx(fx, fy);
    if (g.cells[i] !== FLOOR || g.area[i] !== a.id) return false;
    floorY = Math.min(floorY, g.floorOf(i));
  }
  if (!Number.isFinite(floorY)) return false;
  const ceil = ceilOver(g, a, f, c0, c1, front);
  // other marks on this wall
  for (const m of ctx.out) if (m.axis === f.axis && Math.abs(m.plane - f.plane) < 0.05 && m.n === f.n && c0 < m.c + m.w / 2 + M.gap && c1 > m.c - m.w / 2 - M.gap) return false;
  const [mx, mz] = f.axis === 'z' ? [c, f.plane] : [f.plane, c];
  // a door mark must READ as its own doorway (readMarkDoor: what a player sees), else the spot is not used
  if (kind !== 'tally' && readMarkDoor(layout, a, {kind, axis: f.axis, n: f.n, c, w: S.w, dir}, ctx.doorsOf.get(a.id)) !== door) return false;
  // the mark's height: its own first, then lower / higher (a door plate or a wall-hung fixture beside the doorway)
  for (const dy of M.heights) {
    const y = floorY + S.y + dy, y0 = y - S.h / 2, y1 = y + S.h / 2;
    if (y1 > ceil - M.ceil || y0 < floorY + 0.5) continue;
    if (!clearAt(ctx, a, f, c0, c1, y0, y1)) continue;
    // steam vents
    if (ctx.vents.some(v => Math.hypot(v.x - mx, v.z - mz) < M.vent && Math.abs(v.y - y) < 1.2)) continue;
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    ctx.out.push({annex: ctx.n.id, area: a.id, kind, door, next, axis: f.axis, plane: r4(f.plane), n: f.n, c: r4(c), y: r4(y), w: S.w, h: S.h, dir, step, variant: ctx.rng.int(0, 1023)});
    return true;
  }
  return false;
}

/** No prop against the wall (within propReach) and no sign on it overlaps the rect [c0, c1] x [y0, y1]. */
function clearAt(ctx: MarkCtx, a: Area, f: {axis: 'x' | 'z'; plane: number; n: 1 | -1}, c0: number, c1: number, y0: number, y1: number): boolean {
  const M = CACHE_MARKS, layout = ctx.layout;
  for (const pi of ctx.propsOf.get(a.id) ?? []) {
    const p = layout.props[pi];
    const pa0 = f.axis === 'z' ? p.x - p.hx : p.z - p.hz, pa1 = f.axis === 'z' ? p.x + p.hx : p.z + p.hz;
    if (pa1 < c0 - 0.1 || pa0 > c1 + 0.1) continue;
    const pn0 = f.axis === 'z' ? p.z - p.hz : p.x - p.hx, pn1 = f.axis === 'z' ? p.z + p.hz : p.x + p.hx;
    const dist = f.n > 0 ? pn0 - f.plane : f.plane - pn1;
    if (dist > M.propReach) continue;
    if (p.y + p.h < y0 - 0.05 || p.y + (p.lift ?? 0) > y1) continue;
    return false;
  }
  for (const sg of ctx.signs) {
    const across = f.axis === 'z' ? sg.z : sg.x, along = f.axis === 'z' ? sg.x : sg.z;
    if (Math.abs(across - f.plane) > 0.35) continue;
    const half = (sg.w ?? 0.6) / 2 + 0.2;
    if (along + half < c0 || along - half > c1) continue;
    if (sg.y + 0.35 < y0 || sg.y - 0.35 > y1) continue;
    return false;
  }
  return true;
}

/** The lowest ceiling over the mark's front cells (absolute; the area's ceiling where the grid has none). */
function ceilOver(g: Grid, a: Area, f: {axis: 'x' | 'z'}, c0: number, c1: number, front: number): number {
  let ceil = a.ceil;
  for (let k = Math.floor((c0 + 1e-6) / CELL); k <= Math.floor((c1 - 1e-6) / CELL); k++) {
    const [x, y] = f.axis === 'z' ? [k, front] : [front, k];
    if (!g.inBounds(x, y)) continue;
    const i = g.idx(x, y);
    if (g.hasCeil(i)) ceil = Math.min(ceil, g.ceil[i]);
  }
  return ceil;
}

/**
 * READING a mark like a player (the trail's contract; the planner keeps only spots that read as their own doorway, tests/helpers
 * cacheMarks.ts follows the trail with it): from what a player SEES only — the mark's wall, its place on it, its arrow. An ARROW points
 * along its wall at the nearest doorway of the area in its direction on that wall, else (it points into a corner) at the doorway
 * nearest that corner (within cornerReach) on the wall meeting it there; a HIDEOUT mark marks the nearest doorway on its wall (within
 * frameGap + slide of its edge), else the doorway nearest the closer corner. -1: nothing readable (a tally, no doorway).
 */
export function readMarkDoor(layout: StationLayout, a: Area, m: Pick<CacheMark, 'kind' | 'axis' | 'n' | 'c' | 'w' | 'dir'>, areaDoors?: readonly number[]): number {
  if (m.kind === 'tally') return -1;
  const M = CACHE_MARKS;
  const side: Side = m.axis === 'z' ? (m.n > 0 ? 'N' : 'S') : (m.n > 0 ? 'W' : 'E');
  let doors = areaDoors;
  if (!doors) { const l: number[] = []; layout.doors.forEach((d, i) => { if ((d.a === a.id || d.b === a.id) && d.a !== d.b) l.push(i); }); doors = l; }
  const onWall = (s: Side) => doors.filter(i => doorSide(layout.doors[i], a) === s).map(i => {
    const [d0, d1] = doorSpan(layout.doors[i], s);
    return {i, d0, d1, c: (d0 + d1) / 2};
  });
  const same = onWall(side), [lo, hi] = wallRange(a, side);
  const corner = (end: number): number => {
    const meet: Side = m.axis === 'z' ? (end === lo ? 'W' : 'E') : (end === lo ? 'N' : 'S');
    const at = side === 'N' ? a.y * CELL : side === 'S' ? (a.y + a.h) * CELL : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
    let best = -1, bd = Infinity;
    for (const d of onWall(meet)) { const dist = Math.min(Math.abs(d.d0 - at), Math.abs(d.d1 - at)); if (dist < bd) { bd = dist; best = d.i; } }
    return bd <= M.cornerReach + 1e-6 ? best : -1;
  };
  if (m.kind === 'arrow' && m.dir) {
    // the viewer's right along the wall axis: an X-wall (axis 'z') +x * n, a Z-wall (axis 'x') -z * n
    const sgn = (m.dir === 'right' ? 1 : -1) * (m.axis === 'z' ? m.n : -m.n);
    let best = -1, bd = Infinity;
    for (const d of same) { const s = (d.c - m.c) * sgn; if (s > 0 && s < bd) { bd = s; best = d.i; } }
    return best >= 0 ? best : corner(sgn > 0 ? hi : lo);
  }
  let best = -1, bd = Infinity;
  for (const d of same) { const s = Math.max(0, Math.max(d.d0 - (m.c + m.w / 2), (m.c - m.w / 2) - d.d1)); if (s < bd) { bd = s; best = d.i; } }
  if (best >= 0 && bd <= M.frameGap + M.slide + 1e-6) return best;
  return corner(Math.abs(m.c - lo) < Math.abs(m.c - hi) ? lo : hi);
}

/**
 * Invariants of the trail records (tests): every mark lies on rock behind / its area's floor in front, inside its wall, under the
 * ceiling; a trail mark sits on the wall of a doorway of its area (or a perpendicular wall at a corner it meets) that leads to `next`,
 * its arrow pointing at that doorway (or into the corner). Returns the issues (empty = valid).
 */
export function cacheMarkIssues(layout: StationLayout): string[] {
  const out: string[] = [];
  (layout.extensions?.cacheMarks ?? []).forEach((m, i) => {
    const a = layout.areas[m.area];
    if (!a) { out.push(`mark ${i}: no area`); return; }
    const side: Side = m.axis === 'z' ? (m.n > 0 ? 'N' : 'S') : (m.n > 0 ? 'W' : 'E');
    const f = wallFrame(a, side);
    if (Math.abs(f.plane - m.plane) > 1e-3) out.push(`mark ${i}: not on a wall of area ${a.id}`);
    const [lo, hi] = wallRange(a, side);
    if (m.c - m.w / 2 < lo - 1e-3 || m.c + m.w / 2 > hi + 1e-3) out.push(`mark ${i}: off its wall`);
    if (m.kind === 'tally') return;
    if (readMarkDoor(layout, a, m) !== m.door) out.push(`mark ${i}: reads as doorway ${readMarkDoor(layout, a, m)}, not its own ${m.door}`);
    const d = layout.doors[m.door];
    if (!d || !((d.a === m.area && d.b === m.next) || (d.b === m.area && d.a === m.next))) { out.push(`mark ${i}: door ${m.door} does not join ${m.area} -> ${m.next}`); return; }
    const ds = doorSide(d, a), [d0, d1] = doorSpan(d, ds);
    if (ds === side) {
      const fg = Math.min(CACHE_MARKS.frameGap, CACHE_MARKS.small.frameGap); // clear of the doorway's frame
      if (m.c + m.w / 2 > d0 - fg + 1e-3 && m.c - m.w / 2 < d1 + fg - 1e-3) out.push(`mark ${i}: over its doorway`);
      if (Math.min(Math.abs(m.c - d0), Math.abs(m.c - d1)) > m.w / 2 + CACHE_MARKS.frameGap + CACHE_MARKS.slide + 1e-3) out.push(`mark ${i}: not beside its doorway`);
      // no other doorway of the area between the mark and its own
      for (const [j, q] of layout.doors.entries()) {
        if (j === m.door || q.a === q.b || (q.a !== a.id && q.b !== a.id) || doorSide(q, a) !== side) continue;
        const [q0, q1] = doorSpan(q, side), lo2 = Math.min(m.c, (d0 + d1) / 2), hi2 = Math.max(m.c, (d0 + d1) / 2);
        if (q1 > lo2 + 1e-6 && q0 < hi2 - 1e-6) out.push(`mark ${i}: doorway ${j} between it and its doorway`);
      }
      if (m.kind === 'arrow' && m.dir !== arrowDir(m.axis, m.n, m.c, (d0 + d1) / 2)) out.push(`mark ${i}: arrow does not point at its doorway`);
    } else if (m.kind === 'arrow') {
      const [plo, phi] = wallRange(a, side), near = (ds === 'N' || ds === 'W') ? plo : phi;
      if (m.dir !== arrowDir(m.axis, m.n, m.c, near)) out.push(`mark ${i}: arrow does not point into the doorway's corner`);
    }
  });
  return out;
}
