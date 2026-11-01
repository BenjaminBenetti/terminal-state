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

import {Rng} from '../../core/rng';
import {CELL, FLOOR, NAV_STEP, SOLID, VOID, type Grid} from '../grid';
import {planStationArt, stationArtIssues} from './art';
import type {Kit} from '../stationKit';
import type {Rect, StationLayout} from '../stationTypes';
import {levelDistance, registerApertures} from '../levelGen';
import {Carver, type BedEndInfo, type Carve} from './carve';
import {reframe} from './core';
import {adoptComposition} from '../compose';
import {CORE_XZ_KEYS, isExtensionArea, type CoreXZKey, type TrackExtConfig, type TrackExtContext, type TrackExtensions} from './types';
import {BTS_AREA_CHANCE, TRACK_EXT, btsAreaRoll} from './config';

export * from './types';
export {TRACK_EXT, TRACK_EXT_MALL, TRACK_EXT_OFFICE, SUBWAY_WALK_BASELINE_M2, trackExtConfig} from './config'; // (+ TRACK_EXT_MALL: task track3, lane INTEG)
export {BTS_AREA_CHANCE, BTS_AREA_SALT, btsAreaPresent, btsAreaRoll} from './config'; // (2026-11-01, lane AREA: the one area roll)
export {copyWindow} from './window';
export {coreView, hasExtensionGrowth, reframe} from './core';
export {STATION_ART, HATCH_CLUE_KEEPOUT, endWall, planStationArt, rockSpans, stationArtIssues, stationArtKeepouts, stationArtRecordIssues, wallFacesPlatform, wallSide, artX, type ArtKeepout} from './art'; // (playtest revision, lane ART)

/** Carves of extendTracks results (canvas frame) until attachExtensions applies them. */
const CARVES = new WeakMap<TrackExtensions, Carve>();
/** (Track 2 playtest revision, lane ART) Seed of each plan's station-art fork (rng.fork('station-art') of the track-ext stream). */
const ART_SEEDS = new WeakMap<TrackExtensions, number>();

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
  const A = cfg.annex;
  // (2026-11-01, lane AREA) THE level's ONE Beyond the Station area roll: a pure function of the logical level seed (config.ts
  // btsAreaRoll; no generation stream is consumed, every retry / revisit rolls the same). Failed: no annex is planned at all.
  const roll = btsAreaRoll(ctx.levelSeed), present = roll < BTS_AREA_CHANCE;
  ext.area = {roll, chance: BTS_AREA_CHANCE, present};
  // (GEN-2) the incidence planner: a seeded per-level wanted annex count (own fork: the original planner's draws are untouched) —
  // (lane AREA) only for a level that has the area, from the weights of 1 / 2 annexes (absence is the area roll's alone; a config
  // whose 1 / 2 weights are both 0 wants none)
  const counts = A.count ? A.count.map((w, i) => [i, w] as [number, number]).filter(([i, w]) => i >= 1 && w > 0) : [];
  const want = present && counts.length ? Math.min(A.max, rng.fork('annex-count').weighted(counts)) : 0;
  let hosts = 0;
  const open: BedEndInfo[] = [];
  // tunnels: bed ends in a seeded order, each on its own fork (independent of the others' draws)
  for (const e of rng.fork('order').shuffle(C.bedEnds())) {
    // (GEN-2) annex-aware first straight while the level still wants an annex host
    const host = A.count && A.hostFirstStraight && hosts < want ? A.hostFirstStraight : 0;
    const r = C.planTunnel(e, rng.fork(`tunnel:${e.trench}:${e.from}`), host);
    ext.log.push({trench: e.trench, from: e.from, result: typeof r === 'string' ? `none: ${r}` : `tunnel ${r.length} m`});
    if (typeof r === 'string') open.push(e);
    else if (host && C.doorWindow(r)) hosts++;
  }
  const planned = C.planned;
  ext.tunnels = planned.map(pt => C.tunnelRecord(pt));
  const addTunnelAnnex = (res: Exclude<ReturnType<Carver['planAnnex']>, string>, tr: TrackExtensions['tunnels'][number], ln: (s: string) => void) => {
    ext.annexes.push(res.annex);
    tr.doors.push({annex: res.annex.id, door: res.door, s: r4(res.doorS), side: res.side});
    ln(`annex ${res.annex.id}: ${Math.round(res.annex.areaM2)} m² in ${res.annex.areas.length} areas`);
  };
  const ar = rng.fork('annexes');
  if (!present) {
    // (lane AREA) the level's one area roll failed: no annex, no hatch — the tunnels stay ordinary tunnels (no door, no clue)
    for (const tr of ext.tunnels) ext.log.push({trench: tr.trench, from: tr.from, result: `annex: no area (level roll ${roll.toFixed(4)} >= ${BTS_AREA_CHANCE})`});
  } else if (!A.count) {
    // annexes: up to cfg.annex.max, each on a different eligible tunnel, in a seeded order. (lane AREA) The old seeded 0.6 chance
    // per eligible tunnel is replaced by the level's one area roll: every eligible tunnel takes one until the max.
    for (const pt of ar.shuffle(planned.slice())) {
      if (ext.annexes.length >= A.max) break;
      const tr = ext.tunnels[pt.id], ln = (result: string) => ext.log.push({trench: tr.trench, from: tr.from, result});
      if (!C.doorWindow(pt)) { ln('annex: not eligible (first straight too short)'); continue; }
      const fr = rng.fork(`annex:${pt.id}`);
      // the retired per-tunnel roll's draw is still taken (and ignored), so each annex's own stream — its layout — is unchanged
      fr.next();
      const res = C.planAnnex(pt, ext.annexes.length, fr);
      if (typeof res === 'string') { ln(`annex: omitted (${res})`); continue; }
      addTunnelAnnex(res, tr, ln);
    }
  } else {
    // (GEN-2) the wanted count over the candidates in a seeded order: eligible tunnels first, then service hatches at the bed
    // ends no tunnel continues (cfg.hatch) — each candidate at most one annex, until the count is met
    const tunnels = ar.shuffle(planned.slice()), hatches = cfg.hatch ? ar.shuffle(open.slice()) : [];
    for (const pt of tunnels) {
      const tr = ext.tunnels[pt.id], ln = (result: string) => ext.log.push({trench: tr.trench, from: tr.from, result});
      if (ext.annexes.length >= want) { ln(`annex: not wanted (level wants ${want})`); continue; }
      if (!C.doorWindow(pt)) { ln('annex: not eligible (first straight too short)'); continue; }
      const res = C.planAnnex(pt, ext.annexes.length, rng.fork(`annex:${pt.id}`));
      if (typeof res === 'string') { ln(`annex: omitted (${res})`); continue; }
      addTunnelAnnex(res, tr, ln);
    }
    for (const e of hatches) {
      const ln = (result: string) => ext.log.push({trench: e.trench, from: e.from, result});
      if (ext.annexes.length >= want) { ln(`hatch: not wanted (level wants ${want})`); continue; }
      const res = C.planHatch(e, ext.annexes.length, rng.fork(`hatch:${e.trench}:${e.from}`));
      if (typeof res === 'string') { ln(`hatch: omitted (${res})`); continue; }
      ext.annexes.push({...res.annex, bed: {...res.entry, clues: []}});
      ln(`annex ${res.annex.id} via a bed hatch (${res.entry.wall} wall, ${res.entry.s.toFixed(1)} m from the end): ${Math.round(res.annex.areaM2)} m² in ${res.annex.areas.length} areas`);
    }
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
  // (GEN-2) service hatches: graffiti on the hatch's own bed wall only (the route exists), on solid wall clear of the opening —
  // an arrow on the approach from the platforms pointing back toward the door, sometimes a tag beside it
  for (const n of ext.annexes) {
    const b = n.bed;
    if (!b) continue;
    const cr = rng.fork(`hatch-clues:${n.id}`);
    if (!cr.chance(cfg.clues.chance)) continue;
    const span = 1.25, beside = b.s + b.width / 2 + 0.4 + span;
    for (const s of [b.s + cfg.clues.beforeDoor, b.s + 7, beside]) {
      if (C.bedWallSolid(b, s - span, s + span)) { b.clues.push({s: r4(s), side: b.side, kind: 'arrow', toward: -1}); break; }
    }
    if (cr.chance(cfg.clues.tagChance) && C.bedWallSolid(b, beside - span, beside + span) && !b.clues.some(c => Math.abs(c.s - beside) < 2 * span)) {
      b.clues.push({s: r4(beside), side: b.side, kind: 'tag', toward: -1});
    }
  }
  if (ctx.rockLevels) ext.rockLevels = [...ctx.rockLevels]; // (task track3 lane INTEG, opt-in: attach / validation read it)
  CARVES.set(ext, C.carve);
  // (Track 2 playtest revision, lane ART) the station art is planned after the attach (it needs the finished station's walls,
  // platforms and signs); its own fork (a fork never advances its parent: every draw above is unchanged)
  ART_SEEDS.set(ext, rng.fork('station-art').seed);
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
 * or east / south only ('east-south': a fixed origin) — then attaches them. Re-frames IN PLACE: returns the same layout object.
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
  const moved = x0 !== ox || y0 !== oy;
  const coreXZ = moved ? Object.fromEntries(CORE_XZ_KEYS.map(k => [k, (layout[k] as {x: number; z: number}[]).flatMap(p => [p.x, p.z])])) as Record<CoreXZKey, number[]> : null;
  if (moved || x1 !== ox + W - 1 || y1 !== oy + H - 1) {
    // IN PLACE: the generator's layout object keeps its identity (attempt matching, generation-time hooks); its grids / records
    // become the re-framed ones and its composition record the translated one
    const view = reframe(layout, x0 - ox, y0 - oy, x1 - x0 + 1, y1 - y0 + 1);
    Object.assign(layout, view);
    adoptComposition(view, layout);
  }
  attachExtensions(layout, ext, {ox: x0, oy: y0, core: {x: ox - x0, y: oy - y0, w: W, h: H}});
  if (coreXZ) ext.coreXZ = coreXZ;
  // (Track 2 playtest revision, lane ART) station-surface invitation art at every real annex entrance (data only; appended to
  // the extensions record: every core record stays as it is)
  const seed = ART_SEEDS.get(ext);
  if (seed !== undefined) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    ext.art = planStationArt(layout, ext, new Rng(seed));
    TRACK_EXT_STATS.ms += (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  }
  return layout;
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
    // (task track3 lane INTEG, opt-in ext.rockLevels: only the station's storeys must be rock; extensionIssues checks the others' slab)
    for (const L of layout.levels ?? []) if (L.grid !== g && (!ext.rockLevels || ext.rockLevels.includes(L.id)) && L.grid.cells[i] !== SOLID) throw new Error(`attachExtensions: cell ${x},${y} open on level ${L.id}`);
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
    if (n.hideout !== undefined) n.hideout = A(n.hideout); // (round 3, lane LAYOUT)
    n.exit = {x: r4(n.exit.x - dx), z: r4(n.exit.z - dz)};
    if (n.bed) { n.bed.door = D(n.bed.door); n.bed.x = r4(n.bed.x - dx); n.bed.z = r4(n.bed.z - dz); }
  }
  ext.core = {...crop.core};
  ext.shift = {x: crop.core.x * CELL, z: crop.core.y * CELL};
  layout.extensions = ext;
  // per-levels-array caches (levelArrays, levelsOf) were built on the core grid: a fresh array key rebuilds them; the light-well
  // apertures are re-derived from the final grids (extension cells are open on the main level only: the masks do not change)
  if (layout.levels?.length) {
    layout.levels = layout.levels.slice();
    if (layout.levels.length > 1) registerApertures(layout.levels);
  }
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
    for (let i = 0; i < g.cells.length; i++) if (g.area[i] >= first) { g.cells[i] = SOLID; g.area[i] = -1; g.floor[i] = 0; g.ceil[i] = 0; g.blocked[i] = 0; g.sightBlocked[i] = 0; }
    layout.areas.length = first;
    const firstDoor = layout.doors.findIndex(d => d.a >= first || d.b >= first);
    if (firstDoor >= 0) layout.doors.length = firstDoor;
    // (lane CONTENT) their appended content (gen/annexContent.ts: props, plates, fixtures, loose finds, service spawns) goes too
    const keep = <T extends {area: number}>(list: T[]) => { const k = list.filter(r => r.area < first); list.length = 0; list.push(...k); };
    keep(layout.props); keep(layout.signs); keep(layout.lights); keep(layout.pickups); keep(layout.zombies);
  }
  ext.tunnels = []; ext.annexes = []; delete ext.vents; delete ext.art; delete ext.machines; delete ext.cacheMarks;
  ext.log.push({trench: -1, from: 'x0', result: 'dropped: the finished layout failed validation with them'});
  if (layout.levels?.length) layout.levels = layout.levels.slice();
}

/**
 * Coverage rule of the track-bearing interface (tests/track-ext-coverage.test.ts): a level whose layout carries track beds must
 * declare `trackExtensions` (a config or 'none'), and its generator must honour the declaration — a config yields
 * layout.extensions with a log entry for every bed end; 'none' yields none.
 */
export function trackExtCoverageIssues(levelId: string, decl: TrackExtConfig | 'none' | undefined, layout: StationLayout): string[] {
  if (!layout.trenches.length) return [];
  if (decl === undefined) return [`${levelId}: track beds but no trackExtensions declaration (a config or 'none')`];
  if (decl === 'none') return layout.extensions ? [`${levelId}: declared 'none' but the layout carries extensions`] : [];
  const ext = layout.extensions;
  if (!ext) return [`${levelId}: trackExtensions declared but the generator never called extendTracks (no layout.extensions)`];
  const issues: string[] = [];
  layout.trenches.forEach((_, ti) => {
    for (const from of ['x0', 'x1'] as const) {
      if (!ext.log.some(g => g.trench === ti && g.from === from && /^(tunnel|none)/.test(g.result))) issues.push(`${levelId}: bed end ${ti}${from} never planned`);
    }
  });
  return issues;
}

/** Ids of the extension areas of a layout (tunnels / annexes), ascending. */
export function extensionAreaIds(layout: StationLayout): number[] {
  return layout.areas.filter(a => isExtensionArea(a)).map(a => a.id);
}

/** (Round 3, lane LAYOUT) The machinery-signature purposes (gen/annexRooms.ts ROOM_SIGNATURES): a hideout never takes one. */
const SIGNATURE_PURPOSES = new Set(['boiler-room', 'generator-room', 'sewage-room', 'overflow-chamber', 'spillway', 'turbine-hall', 'ventilation-plant']);

/** Minimum clear height (m) on every extension cell (doorways included). */
export const EXT_HEAD_CLEARANCE = 2.2;
/** (task track3 lane INTEG, opt-in rockLevels) Minimum slab (m) between an extension's ceiling and a storey standing above it. */
export const EXT_STOREY_SLAB = 0.3;

/**
 * Invariants of a layout's extensions (tests / QA; the generator's safety net): cells FLOOR at their area's floor with >= 2.2 m
 * head clearance and rock on every other level grid; no walkable extension cell borders the grid edge or a track bed (except a
 * tunnel mouth onto its own bed); every extension cell reachable from the start (walking, drops, ladders) AND walkable back to a
 * rescue ladder of its own bed without drops; caps solid; entry doors join exactly a tunnel area and an annex corridor; clues
 * only on tunnels with a door, before it, pointing toward it. (GEN-2) Service-hatch annexes: their door cells are the only annex
 * cells that may touch a bed (their own), the walk back runs to a ladder of that bed, and hatchIssues checks the entry.
 */
export function extensionIssues(layout: StationLayout, dists?: readonly Int32Array[]): string[] {
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
    if (annexOfArea.has(a)) { const n = ext.annexes[annexOfArea.get(a)!]; return n.bed ? n.bed.trench : ext.tunnels[n.tunnel]?.trench ?? -1; }
    return -1;
  };
  // (GEN-2) service-hatch door cells: the only annex cells that may touch a track bed (their own)
  const hatchCell = new Map<number, number>();
  for (const n of ext.annexes) {
    const d = n.bed ? layout.doors[n.door] : undefined;
    if (d) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) if (g.inBounds(x, y)) hatchCell.set(g.idx(x, y), n.bed!.trench);
  }
  const start = layout.office?.start ?? {...layout.playerSpawn, level: 0};
  const [sx, sy] = levels[0].grid.cellOf(start.x, start.z);
  // (the caller's reachability from the start, when it has it: validateLayout / officeIssues)
  const dist = (dists ?? levelDistance(levels, sx, sy, start.level ?? 0, layout.levelLinks))[0];
  const cellsOfTrench = new Map<number, number[]>();
  let bad = {floor: 0, head: 0, levels: 0, edge: 0, unreached: 0};
  for (let i = 0; i < g.cells.length; i++) {
    const a = g.area[i];
    if (a < 0 || !isExt[a]) continue;
    const area = layout.areas[a];
    if (g.cells[i] !== FLOOR || Math.abs(g.floor[i] - (area.floorY ?? 0)) > 1e-6) bad.floor++;
    if (g.ceil[i] - g.floor[i] < EXT_HEAD_CLEARANCE - 1e-6) bad.head++;
    // (task track3 lane INTEG, opt-in ext.rockLevels: a storey that is not one of the station's may stand above the cell — solid there,
    // or a floor at least EXT_STOREY_SLAB above the extension ceiling; never its VOID)
    for (const L of levels) {
      if (L.grid === g || L.grid.cells[i] === SOLID) continue;
      if (ext.rockLevels && !ext.rockLevels.includes(L.id) && L.grid.cells[i] !== VOID && L.grid.floor[i] >= g.ceil[i] + EXT_STOREY_SLAB - 1e-6) continue;
      bad.levels++; break;
    }
    const x = i % W, y = (i - x) / W;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy;
      if (!g.inBounds(nx, ny)) { bad.edge++; continue; }
      if (g.cells[g.idx(nx, ny)] !== VOID) continue;
      // a tunnel's mouth cells touch their own bed (and a service hatch's door cells theirs); nothing else may border a track bed
      const ti = tunnelOfArea.get(a), hb = hatchCell.get(i);
      const tr = ti !== undefined ? layout.trenches[ext.tunnels[ti].trench] : hb !== undefined ? layout.trenches[hb] : null;
      if (!tr || !(nx * CELL >= tr.x0 - 1e-6 && nx * CELL < tr.x1 && ny * CELL >= tr.z0 - 1e-6 && ny * CELL < tr.z1)) bad.edge++;
    }
    // (lane CONTENT: cells under the annex dressing's props are not walkable floor — reachability is checked on the rest, exactly
    // as validateLayout counts the core's walkable cells: FLOOR and not blocked)
    if (g.blocked[i]) continue;
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
      // (lane ROOMS: a machinery hall, Area.extHall, has the taller hall ceiling range; every other annex area 2.4-2.8 m)
      const h = a.ceil - n.floorY, [lo, hi] = a.extHall ? TRACK_EXT.annex.hall?.ceil ?? [0, 0] : TRACK_EXT.annex.ceil;
      if (h < lo - 1e-6 || h > hi + 1e-6) issues.push(`annex ${n.id}: area ${id} ceiling ${h.toFixed(2)} m`);
      if (a.extHall && a.kind !== 'room') issues.push(`annex ${n.id}: hall ${id} is not a room`);
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.area[g.idx(x, y)] !== id) { issues.push(`annex ${n.id}: area ${id} rect not its own`); y = a.y + a.h; break; }
    }
    // (round 3, lane LAYOUT) the hideout: one of the annex's rooms — never a closet / corridor / hall, never a machinery signature
    if (n.hideout !== undefined) {
      const h = layout.areas[n.hideout];
      if (!h || !n.areas.includes(n.hideout) || h.kind !== 'room' || h.extHall || (h.purpose && SIGNATURE_PURPOSES.has(h.purpose))) issues.push(`annex ${n.id}: hideout ${n.hideout} is not a plain room of the annex`);
    }
    if (n.tunnel >= 0) {
      if (n.bed) issues.push(`annex ${n.id}: both a tunnel and a bed entry`);
      if (!ext.tunnels[n.tunnel]?.doors.some(d => d.annex === n.id && d.door === n.door)) issues.push(`annex ${n.id}: no door record on tunnel ${n.tunnel}`);
    } else issues.push(...hatchIssues(layout, n, levels));
  }
  // (Track 2 playtest revision, lane ART) station art only at real entrances, pointing toward them, on rock walls platforms face
  issues.push(...stationArtIssues(layout));
  return issues;
}

/**
 * (GEN-2) The entry of a service-hatch annex: a bed-entry record; a door joining exactly the bed and an annex corridor (a = b =
 * the corridor), one cell row in the bed's side wall inside the bed span, bed cells in front of every opening cell, corridor
 * cells behind, a rock jamb either side on every level grid (a wall, never a platform face); no tunnel continuing that end;
 * record positions matching the door; clues only on its wall, on the approach (beyond the door), pointing to it, over rock.
 */
function hatchIssues(layout: StationLayout, n: TrackExtensions['annexes'][number], levels: readonly {grid: Grid}[]): string[] {
  const ext = layout.extensions!, b = n.bed, g = layout.grid, out: string[] = [];
  if (!b) return [`annex ${n.id}: neither a tunnel nor a bed entry`];
  const tr = layout.trenches[b.trench], door = layout.doors[n.door];
  if (!tr || !door || b.door !== n.door) return [`annex ${n.id}: bed entry record`];
  if (ext.tunnels.some(t => t.trench === b.trench && t.from === b.from)) out.push(`annex ${n.id}: a hatch at a bed end a tunnel continues`);
  const corr = layout.areas[door.b];
  if (door.a !== door.b || !corr || corr.ext !== 'annex' || corr.kind !== 'service' || !n.areas.includes(corr.id)) out.push(`annex ${n.id}: hatch door ${n.door} does not join the bed and an annex corridor`);
  const z0 = Math.round(tr.z0 / CELL), z1 = Math.round(tr.z1 / CELL), bx0 = Math.round(tr.x0 / CELL), bx1 = Math.round(tr.x1 / CELL);
  const row = b.wall === 'N' ? z0 - 1 : z1, bedRow = b.wall === 'N' ? z0 : z1 - 1, outRow = b.wall === 'N' ? row - 1 : row + 1;
  if (door.h !== 1 || door.y !== row || door.x < bx0 + 1 || door.x + door.w > bx1 - 1) out.push(`annex ${n.id}: hatch door ${n.door} not in the bed's ${b.wall} wall`);
  else {
    let bedSide = 0, corrSide = 0;
    for (let x = door.x; x < door.x + door.w; x++) {
      if (g.cells[g.idx(x, bedRow)] === VOID) bedSide++;
      if (g.area[g.idx(x, outRow)] === door.b) corrSide++;
    }
    if (bedSide !== door.w || corrSide !== door.w) out.push(`annex ${n.id}: hatch door ${n.door} not between the bed and its corridor`);
    jamb: for (const x of [door.x - 1, door.x + door.w]) for (const L of levels) if (L.grid.cells[g.idx(x, row)] !== SOLID) { out.push(`annex ${n.id}: hatch door ${n.door} without a wall jamb`); break jamb; }
  }
  const face = b.from === 'x1' ? tr.x1 : tr.x0, cx = (door.x + door.w / 2) * CELL;
  if (Math.abs(b.x - cx) > 1e-3 || Math.abs(b.z - (b.wall === 'N' ? tr.z0 : tr.z1)) > 1e-3 || Math.abs(b.s - Math.abs(face - cx)) > 1e-3 || Math.abs(b.width - door.w * CELL) > 1e-6) out.push(`annex ${n.id}: bed entry position`);
  if (b.side !== ((b.wall === 'S') === (b.from === 'x1') ? 1 : -1)) out.push(`annex ${n.id}: bed entry side`);
  if (Math.abs(b.floorY - n.floorY) > 1e-6 || Math.abs(b.floorY - tr.floorY) > 1e-6 || Math.abs(b.head - g.ceil[g.idx(door.x, door.y)]) > 1e-3) out.push(`annex ${n.id}: bed entry heights`);
  for (const c of b.clues) {
    if (c.side !== b.side || c.toward !== -1 || c.s <= b.s + b.width / 2) { out.push(`annex ${n.id}: hatch clue at ${c.s} does not point toward the door`); continue; }
    const xc = face + (b.from === 'x1' ? -c.s : c.s);
    for (let x = Math.floor((xc - 0.95) / CELL); x <= Math.floor((xc + 0.95) / CELL); x++) if (!g.inBounds(x, row) || g.cells[g.idx(x, row)] !== SOLID) { out.push(`annex ${n.id}: hatch clue at ${c.s} not on a wall`); break; }
  }
  return out;
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
