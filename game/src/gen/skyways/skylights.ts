// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): the SKYLIT COURTS of a Skyways level (layout version 3, the live
// generator only) — the reference: a skylit public court whose dark slatted ceiling is cut by a grid of deep square light wells. On the
// TOP storey (the +15 skyway level) every public court / concourse of a usable size that is not an atrium opening gets SKYLIGHT
// COFFERS: square wells SKYLIGHT.size cells wide on a SKYLIGHT.pitch grid, centred in the area, each kept SKYLIGHT.ring cells clear of
// walls, doors, stairs, other areas and anything tall or hung (a coffer only where the flat ceiling runs on all round it).
//  - layout.skyways.skylights: one record per coffer {level, area, rect, ceilY, topY};
//  - the grid: the coffer cells' ceiling rises by SKYLIGHT.depth (the builder then draws the well's walls as the area's ceiling step
//    faces and no slab ceiling over it: world/skywaysArch.ts ceilKey; world/skywaysSkylights.ts the glass and the sky at its top).
//    Walkability, floors, doors and props are untouched (the coffer is above the ceiling line);
//  - the glazed bridges (layout version 3 roofs): their decks' ceiling fixtures become daylight sources under the glass
//    (glazedBridgeDaylight: nothing hangs at the roof's ridge);
//  - daylight: one fixture-less (virtual) light-field source under each coffer (the Office's DAYLIGHT_TINT); ceiling fixtures that
//    hung where a coffer now opens are dropped by index.ts dropFloatingFixtures (this pass runs before it).
// Excluded: the add-on's rooms, anchor stores / shops, bridges, back of house, stair cores, tenant office wings (class 'public' areas
// only), the courts with a hung landmark (the bronze geese hang from the ceiling).

import {CELL, FLOOR} from '../grid';
import type {LightPlacement, StationLayout} from '../stationTypes';
import {DAYLIGHT_TINT} from '../office/windows';
import {isSkywaysDestKind} from './destinations/registry';
import {destModelHung, destModelOf} from './destinations/skywaysDestModels';
import {SKYWAYS_LEVEL, type SkywaysSkylight} from './skywaysTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Coffer sizes in cells (CELL 0.5 m): a 3 m well every 4.5 m, 1 m clear all round, 1.3 m deep; usable courts and caps. */
export const SKYLIGHT = {
  size: 6, pitch: 9, ring: 2, depth: 1.3,
  /** A court / concourse qualifies with its rect's short side >= minSide cells and >= minArea m2. */
  minSide: 12, minArea: 90,
  /** Coffers per area / per level. */
  maxPerArea: 16, maxPerLevel: 48,
  /** Daylight source under each coffer (light-field power) and its drop below the ceiling line (m). */
  power: 0.55, below: 0.15,
} as const;

/** Area labels that are never skylit (the atrium galleries look up into the atrium vault already). */
const NOT_SKYLIT = /^(Atrium gallery|Atrium court)/;

/** Writes layout.skyways.skylights, raises the coffer cells' ceiling and adds their daylight. Returns the coffers placed. */
export function skywaysSkylights(layout: StationLayout): number {
  const info = layout.skyways;
  if (!info) return 0;
  const lv = SKYWAYS_LEVEL.skyway, L = layout.levels?.[lv];
  if (!L) return 0;
  const g = L.grid;
  const out: SkywaysSkylight[] = [];
  const bridges = new Set(info.bridges.map(b => b.area));
  const addon = new Set(info.addon.areas);
  const anchors = new Set<number>();
  for (const an of info.anchors ?? []) for (const id of [an.floor, ...(an.upper !== undefined ? [an.upper] : []), ...an.zones, ...an.stock]) anchors.add(id);
  const hungLandmark = new Set((info.landmarks ?? []).filter(m => m.level === lv && m.family === 'geese').map(m => m.area));
  // what reaches the ceiling (or hangs from it) on this storey: never under a coffer
  const tall: {x0: number; z0: number; x1: number; z1: number}[] = [];
  for (const p of layout.props) {
    if ((p.level ?? 0) !== lv) continue;
    const m = isSkywaysDestKind(p.kind) ? destModelOf(p.kind) : null;
    const hung = (m !== null && destModelHung(m)) || p.kind === 'skywaysConBanner';
    const [cx, cy] = g.cellOf(p.x, p.z);
    const ceil = g.inBounds(cx, cy) ? g.ceil[g.idx(cx, cy)] : Infinity;
    if (!hung && p.y + p.h < ceil - 0.6) continue;
    const pad = 0.5;
    tall.push({x0: p.x - p.hx - pad, z0: p.z - p.hz - pad, x1: p.x + p.hx + pad, z1: p.z + p.hz + pad});
  }
  // stairs / escalators at ANY storey (a run's open well band rises through the storeys above it: never a coffer over one)
  const rampNear = new Uint8Array(g.w * g.h);
  for (const lvl of layout.levels) for (let i = 0; i < rampNear.length; i++) if (lvl.grid.rampIdx[i] >= 0) rampNear[i] = 1;
  const doorNear = new Uint8Array(g.w * g.h);
  for (const d of layout.doors) {
    const dl = (d as {level?: number}).level ?? layout.areas[d.a]?.level ?? 0;
    if (dl !== lv) continue;
    for (let y = d.y - 1; y <= d.y + d.h; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (g.inBounds(x, y)) doorNear[g.idx(x, y)] = 1;
  }
  const areas = layout.areas.filter(a => skylightCandidate(layout, a) && !bridges.has(a.id) && !addon.has(a.id) && !anchors.has(a.id) && !hungLandmark.has(a.id))
    .sort((p, q) => q.w * q.h - p.w * p.h || p.id - q.id);
  for (const a of areas) {
    if (out.length >= SKYLIGHT.maxPerLevel) break;
    const c0 = nominalCeil(g, a);
    if (c0 === null) continue;
    const S = SKYLIGHT.size, P = SKYLIGHT.pitch, R = SKYLIGHT.ring;
    const fit = (len: number) => Math.max(0, Math.floor((len - 2 * R - S) / P) + 1);
    const nx = fit(a.w), ny = fit(a.h);
    if (!nx || !ny) continue;
    const ox = a.x + Math.floor((a.w - ((nx - 1) * P + S)) / 2), oy = a.y + Math.floor((a.h - ((ny - 1) * P + S)) / 2);
    let n = 0;
    for (let j = 0; j < ny && n < SKYLIGHT.maxPerArea; j++) for (let i = 0; i < nx && n < SKYLIGHT.maxPerArea; i++) {
      if (out.length >= SKYLIGHT.maxPerLevel) break;
      const x0 = ox + i * P, y0 = oy + j * P;
      if (!cofferFits(g, a.id, x0, y0, S, R, c0, rampNear, doorNear)) continue;
      const rect = {x0: r3(x0 * CELL), z0: r3(y0 * CELL), x1: r3((x0 + S) * CELL), z1: r3((y0 + S) * CELL)};
      if (tall.some(t => t.x0 < rect.x1 && t.x1 > rect.x0 && t.z0 < rect.z1 && t.z1 > rect.z0)) continue;
      const top = r3(c0 + SKYLIGHT.depth);
      for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) g.ceil[g.idx(x, y)] = top;
      out.push({level: lv, area: a.id, rect, ceilY: r3(c0), topY: top});
      const l: LightPlacement = {x: r3((rect.x0 + rect.x1) / 2), y: r3(c0 - SKYLIGHT.below), z: r3((rect.z0 + rect.z1) / 2), rot: 0, area: a.id, broken: false, flicker: false,
        warm: false, power: SKYLIGHT.power, dying: false, virtual: true, tint: DAYLIGHT_TINT, level: lv};
      layout.lights.push(l);
      n++;
    }
  }
  info.skylights = out;
  moveFixturesOutOfWells(layout, out);
  glazedBridgeDaylight(layout);
  return out.length;
}

/** A glazed bridge's daylight source: its drop under the springing line and its power (the lighting pass's fixtures it replaces). */
export const BRIDGE_DAYLIGHT = {below: 0.3, power: 0.42} as const;

/**
 * Under a glazed bridge roof (layout version 3: the deck's ceiling is the roof's apex, nothing to hang a fixture from but the glass)
 * the lighting pass's ceiling fixtures of the deck become fixture-less DAYLIGHT sources (virtual, the Office's DAYLIGHT_TINT) at the
 * same spots, BRIDGE_DAYLIGHT.below under the springing line: the tube is lit by the sky through its glass, no lamp floats at the ridge.
 */
function glazedBridgeDaylight(layout: StationLayout): number {
  const info = layout.skyways!;
  let n = 0;
  for (const b of info.bridges) {
    if (!b.roof) continue;
    for (const l of layout.lights) {
      if (l.virtual || l.area !== b.area) continue;
      l.virtual = true;
      l.y = r3(b.roof.springY - BRIDGE_DAYLIGHT.below);
      l.tint = DAYLIGHT_TINT;
      l.warm = false; l.broken = false; l.flicker = false; l.dying = false;
      l.power = BRIDGE_DAYLIGHT.power;
      l.level = b.level;
      n++;
    }
  }
  return n;
}

/**
 * Ceiling fixtures (and a landmark court's accent lights) that the generator hung where a coffer now opens move onto the slatted ceiling
 * beside it (just past its nearest edge, in the same area under the flat ceiling); one that cannot is left to dropFloatingFixtures.
 */
function moveFixturesOutOfWells(layout: StationLayout, wells: readonly SkywaysSkylight[]): void {
  if (!wells.length) return;
  const g = layout.levels[SKYWAYS_LEVEL.skyway].grid, pad = 0.6;
  for (const l of layout.lights) {
    if (l.virtual || (l.level ?? layout.areas[l.area]?.level ?? 0) !== SKYWAYS_LEVEL.skyway) continue;
    const s = wells.find(w => l.x > w.rect.x0 - 0.2 && l.x < w.rect.x1 + 0.2 && l.z > w.rect.z0 - 0.2 && l.z < w.rect.z1 + 0.2);
    if (!s) continue;
    const r = s.rect;
    const cands = [{x: r.x0 - pad, z: l.z, d: l.x - r.x0}, {x: r.x1 + pad, z: l.z, d: r.x1 - l.x}, {x: l.x, z: r.z0 - pad, d: l.z - r.z0}, {x: l.x, z: r.z1 + pad, d: r.z1 - l.z}].sort((p, q) => p.d - q.d);
    for (const c of cands) {
      const [cx, cy] = g.cellOf(c.x, c.z);
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || g.area[i] !== s.area || Math.abs(g.ceil[i] - s.ceilY) > 0.01) continue;
      if (wells.some(w => c.x > w.rect.x0 - 0.2 && c.x < w.rect.x1 + 0.2 && c.z > w.rect.z0 - 0.2 && c.z < w.rect.z1 + 0.2)) continue;
      l.x = r3(c.x); l.z = r3(c.z);
      break;
    }
  }
}

/** A skyway-storey public court / concourse of a usable size (the skylit courts' and the court bench-planters' candidates). */
export function skylightCandidate(layout: StationLayout, a: StationLayout['areas'][number]): boolean {
  return (a.level ?? 0) === SKYWAYS_LEVEL.skyway && a.publicSpace && a.kind !== 'passage' && a.type !== 'shop' && a.type !== 'eatery' && a.type !== 'washroom'
    && (a.type as string) !== 'stair-core' && !/^office-/.test(a.type as string) && !NOT_SKYLIT.test(a.label ?? '') && !layout.skyways?.bridges.some(b => b.area === a.id)
    && Math.min(a.w, a.h) >= SKYLIGHT.minSide && a.w * a.h * CELL * CELL >= SKYLIGHT.minArea;
}

/** The area's flat ceiling (the most common ceiling of its open cells), or null. */
function nominalCeil(g: StationLayout['grid'], a: {id: number; x: number; y: number; w: number; h: number}): number | null {
  const count = new Map<number, number>();
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.cells[i] !== FLOOR || g.area[i] !== a.id || !g.hasCeil(i)) continue;
    const c = Math.round(g.ceil[i] * 100) / 100;
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  let best: number | null = null, bn = 0;
  for (const [c, k] of count) if (k > bn) { best = c; bn = k; }
  return best;
}

/** Every cell of the coffer and of its ring is an open, flat, stair- / door-free cell of the area under the nominal ceiling. */
function cofferFits(g: StationLayout['grid'], area: number, x0: number, y0: number, S: number, R: number, c0: number, ramp: Uint8Array, door: Uint8Array): boolean {
  for (let y = y0 - R; y < y0 + S + R; y++) for (let x = x0 - R; x < x0 + S + R; x++) {
    if (!g.inBounds(x, y)) return false;
    const i = g.idx(x, y);
    if (g.cells[i] !== FLOOR || g.area[i] !== area || ramp[i] || door[i] || !g.hasCeil(i) || Math.abs(g.ceil[i] - c0) > 0.01) return false;
  }
  return true;
}
