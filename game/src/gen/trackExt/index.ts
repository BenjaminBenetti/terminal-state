// Track 2 — Beyond the Station (lane GEN): the TRACK-BEARING INTERFACE. Any generator that builds track beds with the Kit's
// block builders (gen/stationKit.ts sideBlock / islandBlock / expressBlock) opts in like this:
//
//   1. after ALL of its own carving, before its crop:   const ext = extendTracks(k, rng.fork('track-ext'), cfg, ctx);
//   2. include extensionRects(ext) in the crop bbox      (and copy canvas windows that may reach past the canvas: copyWindow)
//   3. run every core pass exactly as before             (the extension cells are NOT in the grid yet: core content unchanged)
//   4. after the last core pass:                         attachExtensions(layout, ext, {ox, oy, core})
//
// Levels declare `trackExtensions: TrackExtConfig | 'none'` in levels/registry.ts LEVELS (coverage test: tests/track-ext*.ts).
// Extension areas carry area.ext; every existing global pass skips them (isExtensionArea) — by construction for the generation
// passes (they run before attachExtensions), explicitly for passes that run on the finished layout (gear / mask placement,
// runtime fields). Their content comes from appended passes on their own forks (lanes VIS / CONTENT).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, NAV_STEP, SOLID, VOID, type Grid} from '../grid';
import type {Kit} from '../stationKit';
import type {Rect, StationLayout} from '../stationTypes';
import {levelDistance} from '../levelGen';
import {Carver, type Carve} from './carve';
import {reframe} from './core';
import {isExtensionArea, type TrackExtConfig, type TrackExtContext, type TrackExtensions} from './types';

export * from './types';
export {TRACK_EXT, SUBWAY_WALK_BASELINE_M2, trackExtConfig} from './config';
export {copyWindow} from './window';
export {coreView, hasExtensionGrowth, reframe} from './core';

/** Carves of extendTracks results (canvas frame) until attachExtensions applies them. */
const CARVES = new WeakMap<TrackExtensions, Carve>();

/**
 * Census / QA counters: extendTracks calls / time, layouts whose extensions were dropped (the attempt failed validation) and
 * `rescued` = attempts that passed ONLY after dropping them (an invalid extension; tests require 0).
 */
export const TRACK_EXT_STATS = {calls: 0, dropped: 0, rescued: 0, ms: 0};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Plans the tunnels (every bed end of every trench) and service annexes of a carved Kit into its VIRTUAL canvas (canvas cells;
 * beyond the canvas is rock). Writes nothing into the Kit. `rng` should be a fork ('track-ext'): the Kit's main stream is never
 * consumed. Coordinates of the returned records are in the CANVAS frame until attachExtensions shifts them.
 */
export function extendTracks(k: Kit, rng: Rng, cfg: TrackExtConfig, ctx: TrackExtContext): TrackExtensions {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  TRACK_EXT_STATS.calls++;
  const C = new Carver(k, cfg, ctx);
  const ext = C.carve.ext;
  // tunnels: bed ends in a seeded order, each on its own fork (independent of the others' draws)
  for (const e of rng.fork('order').shuffle(C.bedEnds())) {
    const r = C.planTunnel(e, rng.fork(`tunnel:${e.trench}:${e.from}`));
    ext.log.push({trench: e.trench, from: e.from, result: typeof r === 'string' ? `none: ${r}` : `tunnel ${r.length} m`});
  }
  const planned = C.planned;
  ext.tunnels = planned.map(pt => C.tunnelRecord(pt));
  // annexes: up to cfg.annex.max, each on a different eligible tunnel, a seeded chance per eligible tunnel
  const ar = rng.fork('annexes');
  for (const pt of ar.shuffle(planned.slice())) {
    if (ext.annexes.length >= cfg.annex.max) break;
    const tr = ext.tunnels[pt.id], ln = (result: string) => ext.log.push({trench: tr.trench, from: tr.from, result});
    if (!C.doorWindow(pt)) { ln('annex: not eligible (first straight too short)'); continue; }
    const fr = rng.fork(`annex:${pt.id}`);
    if (!fr.chance(cfg.annex.chance)) { ln('annex: not rolled'); continue; }
    const res = C.planAnnex(pt, ext.annexes.length, fr);
    if (typeof res === 'string') { ln(`annex: omitted (${res})`); continue; }
    ext.annexes.push(res.annex);
    tr.doors.push({annex: res.annex.id, door: res.door, s: r4(res.doorS), side: res.side});
    ln(`annex ${res.annex.id}: ${Math.round(res.annex.areaM2)} m² in ${res.annex.areas.length} areas`);
  }
  // graffiti clues: only on tunnels that really lead to an annex door, all before (and pointing toward) the door
  for (const tr of ext.tunnels) {
    if (!tr.doors.length) continue;
    const cr = rng.fork(`clues:${tr.id}`), d = tr.doors[0];
    if (!cr.chance(cfg.clues.chance)) continue;
    const mouth = r4(cr.range(cfg.clues.mouthS[0], cfg.clues.mouthS[1]));
    if (mouth < d.s - 1.5) tr.clues.push({s: mouth, side: cr.chance(0.5) ? 1 : -1, kind: 'arrow', toward: 1});
    const before = r4(d.s - cfg.clues.beforeDoor);
    if (before > mouth + 4) tr.clues.push({s: before, side: d.side, kind: 'arrow', toward: 1});
    if (cr.chance(cfg.clues.tagChance) && d.s - 1.6 > 0) tr.clues.push({s: r4(d.s - 1.6), side: d.side, kind: 'tag', toward: 1});
  }
  CARVES.set(ext, C.carve);
  TRACK_EXT_STATS.ms += (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  return ext;
}

/**
 * CORE-CHANGING (cfg.coreReserveM > 0 only): right after the archetype skeleton, keeps `coreReserveM` metres of main-level rock
 * straight past every bed end that is still free then (bed rows + the core margin + a wall either side), so later station growth
 * plans around it (Kit.keepRock: rectFree / solid refuse it). Deterministic, consumes no randomness. Returns the reserved ends.
 */
export function reserveTunnelRoom(k: Kit, cfg: TrackExtConfig): number {
  const len = Math.round(cfg.coreReserveM / CELL);
  if (len <= 0) return 0;
  const g = k.g, m = cfg.margin.core + 1;
  let n = 0;
  for (const t of k.trenches) {
    for (const dir of [-1, 1] as const) {
      const xs = (j: number) => (dir > 0 ? t.x1 + j : t.x0 - 1 - j);
      let free = 0;
      for (let j = 0; j < len; j++) {
        const x = xs(j);
        let ok = x >= 1 && x < g.w - 1;
        for (let y = t.y0 - m; y < t.y1 + m && ok; y++) {
          if (y < 1 || y >= g.h - 1) { ok = false; break; }
          const i = g.idx(x, y);
          for (const L of k.levelGrids) if (L.cells[i] !== SOLID) { ok = false; break; }
        }
        if (!ok) break;
        free++;
      }
      if (free * CELL < cfg.tunnel.length[0] + cfg.tunnel.capDepth) continue;
      for (let j = 0; j < free; j++) for (let y = t.y0 - m; y < t.y1 + m; y++) k.keepRock[g.idx(xs(j), y)] = 1;
      n++;
    }
  }
  return n;
}

/** Rects (canvas cells) the crop bbox must include: tunnel footprints (walls inside the crop), annex areas, doors. */
export function extensionRects(ext: TrackExtensions): Rect[] {
  const c = CARVES.get(ext);
  return c ? [...c.rects, ...c.doors.map(d => ({x: d.x, y: d.y, w: d.w, h: d.h}))] : [];
}

/**
 * After the LAST core pass: re-frames the finished core layout (cropped at canvas origin (ox, oy)) into the grid its extensions
 * need — grown in any direction ('any': a west / north extension translates the core, a pure translation of finished records)
 * or east / south only ('east-south': a fixed origin) — then attaches them. Returns the (possibly new) layout object.
 */
export function finishExtensions(layout: StationLayout, ext: TrackExtensions, crop: {ox: number; oy: number; grow: 'any' | 'east-south'}): StationLayout {
  const {ox, oy} = crop, W = layout.grid.w, H = layout.grid.h;
  let x0 = ox, y0 = oy, x1 = ox + W - 1, y1 = oy + H - 1;
  for (const r of extensionRects(ext)) {
    if (r.w <= 0 || r.h <= 0) continue;
    x0 = Math.min(x0, r.x - 2); y0 = Math.min(y0, r.y - 2); x1 = Math.max(x1, r.x + r.w + 1); y1 = Math.max(y1, r.y + r.h + 1);
  }
  if (crop.grow === 'east-south') {
    if (x0 < ox || y0 < oy) throw new Error('finishExtensions: an east / south level extended west / north');
    x0 = ox; y0 = oy;
  }
  const out = x0 !== ox || y0 !== oy || x1 !== ox + W - 1 || y1 !== oy + H - 1 ? reframe(layout, x0 - ox, y0 - oy, x1 - x0 + 1, y1 - y0 + 1) : layout;
  attachExtensions(out, ext, {ox: x0, oy: y0, core: {x: ox - x0, y: oy - y0, w: W, h: H}});
  return out;
}

/**
 * Applies a planned extension to the cropped layout (crop origin (ox, oy) canvas cells) AFTER every core pass: appends its areas
 * and doors (ids after the core's), stamps its cells into the main level grid (only ever onto rock), shifts every record into the
 * layout frame and stores layout.extensions. `core` = the core window in the final grid (cells).
 */
export function attachExtensions(layout: StationLayout, ext: TrackExtensions, crop: {ox: number; oy: number; core: {x: number; y: number; w: number; h: number}}): void {
  const c = CARVES.get(ext);
  if (!c) throw new Error('attachExtensions: unknown extension plan');
  CARVES.delete(ext);
  const {ox, oy} = crop, g = layout.grid;
  const aBase = layout.areas.length, dBase = layout.doors.length;
  const A = (i: number) => (i < 0 ? i : aBase + i), D = (i: number) => dBase + i;
  for (const a of c.areas) {
    layout.areas.push({...a, id: A(a.id), parent: a.ext === 'tunnel' ? -1 : A(a.parent), x: a.x - ox, y: a.y - oy});
  }
  for (const d of c.doors) layout.doors.push({...d, id: D(d.id), a: A(d.a), b: A(d.b), x: d.x - ox, y: d.y - oy});
  for (const cell of c.cells) {
    const x = cell.x - ox, y = cell.y - oy;
    if (!g.inBounds(x, y)) throw new Error(`attachExtensions: cell ${x},${y} outside the grid`);
    const i = g.idx(x, y);
    if (g.cells[i] !== SOLID || g.area[i] !== -1) throw new Error(`attachExtensions: cell ${x},${y} is not rock`);
    for (const L of layout.levels ?? []) if (L.grid !== g && L.grid.cells[i] !== SOLID) throw new Error(`attachExtensions: cell ${x},${y} open on level ${L.id}`);
    g.cells[i] = FLOOR; g.area[i] = A(cell.area); g.floor[i] = cell.floor; g.ceil[i] = cell.ceil;
  }
  const dx = ox * CELL, dz = oy * CELL;
  for (const t of ext.tunnels) {
    t.path = t.path.map(p => ({x: r4(p.x - dx), z: r4(p.z - dz)}));
    t.areas = t.areas.map(A);
    for (const d of t.doors) d.door = D(d.door);
  }
  for (const n of ext.annexes) {
    n.door = D(n.door);
    n.areas = n.areas.map(A);
    n.exit = {x: r4(n.exit.x - dx), z: r4(n.exit.z - dz)};
  }
  ext.core = {...crop.core};
  ext.shift = {x: crop.core.x * CELL, z: crop.core.y * CELL};
  layout.extensions = ext;
  // per-levels-array caches (levelArrays, levelsOf) were built on the core grid: a fresh array key rebuilds them
  if (layout.levels?.length) layout.levels = layout.levels.slice();
}

/**
 * Removes a layout's extensions again (cells back to rock, appended areas / doors dropped; the grid keeps its size, so the core
 * stays a pure translation). The generator's safety net when the finished layout fails validation only because of them.
 */
export function dropExtensions(layout: StationLayout): void {
  const ext = layout.extensions;
  if (!ext) return;
  TRACK_EXT_STATS.dropped++;
  const g = layout.grid;
  const first = layout.areas.findIndex(a => isExtensionArea(a));
  if (first >= 0) {
    for (let i = 0; i < g.cells.length; i++) if (g.area[i] >= first) { g.cells[i] = SOLID; g.area[i] = -1; g.floor[i] = 0; g.ceil[i] = 0; }
    layout.areas.length = first;
    const firstDoor = layout.doors.findIndex(d => d.a >= first || d.b >= first);
    if (firstDoor >= 0) layout.doors.length = firstDoor;
  }
  ext.tunnels = []; ext.annexes = [];
  ext.log.push({trench: -1, from: 'x0', result: 'dropped: the finished layout failed validation with them'});
  if (layout.levels?.length) layout.levels = layout.levels.slice();
}

/** Ids of the extension areas of a layout (tunnels / annexes), ascending. */
export function extensionAreaIds(layout: StationLayout): number[] {
  return layout.areas.filter(a => isExtensionArea(a)).map(a => a.id);
}

/** Minimum clear height (m) on every extension cell (doorways included). */
export const EXT_HEAD_CLEARANCE = 2.2;

/**
 * Invariants of a layout's extensions (tests / QA; the generator's safety net): cells FLOOR at their area's floor with >= 2.2 m
 * head clearance and rock on every other level grid; no walkable extension cell borders the grid edge or a track bed (except a
 * tunnel mouth onto its own bed); every extension cell reachable from the start (walking, drops, ladders) AND walkable back to a
 * rescue ladder of its own bed without drops; caps solid; entry doors join exactly a tunnel area and an annex corridor; clues
 * only on tunnels with a door, before it, pointing toward it.
 */
export function extensionIssues(layout: StationLayout): string[] {
  const ext = layout.extensions;
  if (!ext) return [];
  const issues: string[] = [];
  const g = layout.grid, W = g.w, levels = layout.levels?.length ? layout.levels : [{id: 0, role: 'main' as const, grid: g, baseY: 0}];
  const isExt = new Uint8Array(layout.areas.length);
  for (const a of layout.areas) if (isExtensionArea(a)) isExt[a.id] = 1;
  const tunnelOfArea = new Map<number, number>(), annexOfArea = new Map<number, number>();
  for (const t of ext.tunnels) for (const a of t.areas) tunnelOfArea.set(a, t.id);
  for (const n of ext.annexes) for (const a of n.areas) annexOfArea.set(a, n.id);
  const trenchOf = (i: number): number => {
    const a = g.area[i];
    if (tunnelOfArea.has(a)) return ext.tunnels[tunnelOfArea.get(a)!].trench;
    if (annexOfArea.has(a)) return ext.tunnels[ext.annexes[annexOfArea.get(a)!].tunnel].trench;
    return -1;
  };
  const start = layout.office?.start ?? {...layout.playerSpawn, level: 0};
  const [sx, sy] = levels[0].grid.cellOf(start.x, start.z);
  const dist = levelDistance(levels, sx, sy, start.level ?? 0, layout.levelLinks)[0];
  const cellsOfTrench = new Map<number, number[]>();
  let bad = {floor: 0, head: 0, levels: 0, edge: 0, unreached: 0};
  for (let i = 0; i < g.cells.length; i++) {
    const a = g.area[i];
    if (a < 0 || !isExt[a]) continue;
    const area = layout.areas[a];
    if (g.cells[i] !== FLOOR || Math.abs(g.floor[i] - (area.floorY ?? 0)) > 1e-6) bad.floor++;
    if (g.ceil[i] - g.floor[i] < EXT_HEAD_CLEARANCE - 1e-6) bad.head++;
    for (const L of levels) if (L.grid !== g && L.grid.cells[i] !== SOLID) { bad.levels++; break; }
    const x = i % W, y = (i - x) / W;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy;
      if (!g.inBounds(nx, ny)) { bad.edge++; continue; }
      if (g.cells[g.idx(nx, ny)] !== VOID) continue;
      // a tunnel's mouth cells touch their own bed; nothing else may border a track bed
      const ti = tunnelOfArea.get(a);
      const tr = ti !== undefined ? layout.trenches[ext.tunnels[ti].trench] : null;
      if (!tr || !(nx * CELL >= tr.x0 - 1e-6 && nx * CELL < tr.x1 && ny * CELL >= tr.z0 - 1e-6 && ny * CELL < tr.z1)) bad.edge++;
    }
    if (dist[i] < 0) bad.unreached++;
    const tr = trenchOf(i);
    let l = cellsOfTrench.get(tr);
    if (!l) cellsOfTrench.set(tr, (l = []));
    l.push(i);
  }
  if (bad.floor) issues.push(`extension cells off their floor: ${bad.floor}`);
  if (bad.head) issues.push(`extension cells under ${EXT_HEAD_CLEARANCE} m clear: ${bad.head}`);
  if (bad.levels) issues.push(`extension cells open on another level: ${bad.levels}`);
  if (bad.edge) issues.push(`extension cells bordering the grid edge / a foreign track bed: ${bad.edge}`);
  if (bad.unreached) issues.push(`extension cells unreachable from the start: ${bad.unreached}`);
  // walk back to a rescue ladder of the own bed (flat steps only: no drops, no links)
  for (const [ti, list] of cellsOfTrench) {
    const feet = layout.traversal.ladders.filter(l => l.trench === ti && l.kind !== 'roof').map(l => g.idx(...g.cellOf(l.bottom.x, l.bottom.z)));
    if (!feet.length) { issues.push(`track bed ${ti}: extension without a ladder`); continue; }
    const seen = flatReach(g, feet);
    const lost = list.filter(i => !seen[i]).length;
    if (lost) issues.push(`track bed ${ti}: ${lost} extension cells without a flat walk back to a ladder`);
  }
  for (const t of ext.tunnels) {
    if (t.areas.length !== 1 || layout.areas[t.areas[0]]?.ext !== 'tunnel') issues.push(`tunnel ${t.id}: area record`);
    // the cap: rock just past the end across the tube
    const n = t.path.length, e = t.path[n - 1], p = t.path[Math.max(0, n - 2)];
    const len = Math.hypot(e.x - p.x, e.z - p.z) || 1, dx = (e.x - p.x) / len, dz = (e.z - p.z) / len;
    for (let u = -t.width / 2 + 0.3; u <= t.width / 2 - 0.3 + 1e-9; u += 0.25) {
      const x = e.x + dx * 0.3 + dz * u, z = e.z + dz * 0.3 - dx * u;
      const [cx, cy] = g.cellOf(x, z);
      if (g.passable(cx, cy)) { issues.push(`tunnel ${t.id}: cap not solid`); break; }
    }
    if (t.clues.length && !t.doors.length) issues.push(`tunnel ${t.id}: clue without an annex door`);
    const lastDoor = Math.max(-Infinity, ...t.doors.map(d => d.s));
    for (const c of t.clues) if (c.toward !== 1 || c.s < 0 || c.s >= lastDoor) issues.push(`tunnel ${t.id}: clue at ${c.s} does not point toward a door ahead`);
    for (const d of t.doors) {
      const door = layout.doors[d.door], an = ext.annexes[d.annex];
      if (!door || !an || an.door !== d.door || an.tunnel !== t.id) { issues.push(`tunnel ${t.id}: door record ${d.door}`); continue; }
      const b = layout.areas[door.b];
      if (door.a !== t.areas[0] || !b || b.ext !== 'annex' || b.kind !== 'service' || !an.areas.includes(b.id)) issues.push(`tunnel ${t.id}: door ${d.door} does not join the tunnel and an annex corridor`);
      // the opening touches tunnel cells on one side and corridor cells on the other
      let tSide = 0, cSide = 0;
      for (let y = door.y - 1; y <= door.y + door.h; y++) for (let x = door.x - 1; x <= door.x + door.w; x++) {
        if (!g.inBounds(x, y) || (x >= door.x && x < door.x + door.w && y >= door.y && y < door.y + door.h)) continue;
        const q = g.area[g.idx(x, y)];
        if (q === door.a) tSide++; else if (q === door.b) cSide++;
      }
      if (!tSide || !cSide) issues.push(`tunnel ${t.id}: door ${d.door} not between its tunnel and corridor cells`);
    }
  }
  for (const n of ext.annexes) {
    for (const id of n.areas) {
      const a = layout.areas[id];
      if (!a || a.ext !== 'annex' || a.extId !== n.id) { issues.push(`annex ${n.id}: area ${id} record`); continue; }
      const h = a.ceil - n.floorY;
      if (h < 2.4 - 1e-6 || h > 2.8 + 1e-6) issues.push(`annex ${n.id}: area ${id} ceiling ${h.toFixed(2)} m`);
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.area[g.idx(x, y)] !== id) { issues.push(`annex ${n.id}: area ${id} rect not its own`); y = a.y + a.h; break; }
    }
  }
  return issues;
}

/** Cells reachable from `starts` over passable cells with |step| <= NAV_STEP (no drops, no links). */
function flatReach(g: Grid, starts: readonly number[]): Uint8Array {
  const seen = new Uint8Array(g.cells.length), q: number[] = [];
  for (const s of starts) if (s >= 0 && s < seen.length && !seen[s]) { seen[s] = 1; q.push(s); }
  const W = g.w;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % W, f = g.floorOf(c);
    for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (n < 0 || n >= seen.length || seen[n]) continue;
      const nx = n % W, ny = (n - nx) / W;
      if (!g.passable(nx, ny) || Math.abs(g.floorOf(n) - f) > NAV_STEP) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  return seen;
}
