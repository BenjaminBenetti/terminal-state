// Task reactor-expansion-20261101 (lane PATHS): the generator side of the Reactor's PATHWAY fixes (user feedback: "bars going through the
// stair wells", "the railing is not cut out for ladders", "large steel beams often intersect walk ways"). Pure data; the audit that
// found these causes is world/reactor/pathsAudit.ts.
//
//  1. DECK FOOTPRINTS: a carved deck rect may contain cells that belong to something else on its storey (a stair run carved first, an
//     earlier deck, the reserved organ bank / tower legs). layout.reactor.decks lists the deck's ACTUAL cells as rectangles, so the kit
//     never hangs stringers / cross beams / knee braces over a stairwell that passes through the deck plane.
//  2. SEAM RAILS: a stair run is carved into BOTH storeys' grids; its flat top lead on the LOWER storey's grid borders the upper deck,
//     which is an aperture on that grid — the aperture rule put a railing ACROSS every run's top mouth (the "bars" the player walked
//     through). A rail edge whose far side is a walkable floor at the rail's base height (within a step) on any storey is a seam between
//     storeys, never a drop: no rail there.
//  3. LADDER OPENINGS: every maintenance ladder head is a real opening in the deck-edge railing (collision + drawn): LADDER_OPENING m
//     either side of the ladder's centre line. The climb (player and AI share ladderClimbPath) passes it; a body walking into it drops
//     to the terrace below (no fall damage, like the platform edge).
//  4. VALIDATION: the shared well-edge / unrailed-drop checks accept exactly those two designed gaps (seams, ladder openings) and
//     nothing else.
//  5. FAN CLEARANCE: an extraction fan's housing (the delivered model, ring-fitted to the fan radius) never hangs in walkable space.

import {CELL, FLOOR, STEP_UP, VOID, rampHeight, type Grid} from '../grid';
import {floorNearCell, type Level, type RailRun} from '../levels';
import {deriveRails} from '../levelGen';
import type {Ladder} from '../traversal';
import type {Rect, StationLayout} from '../stationTypes';

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Deck footprints

/** The cells of `rect` on grid g that belong to `area` (FLOOR, blocked or not) as row-merged rectangles (canvas = grid cells). */
export function deckFootprint(g: Grid, rect: Rect, area: number): Rect[] {
  const out: Rect[] = [];
  let open: Rect[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const runs: [number, number][] = [];
    let s = -1;
    for (let x = rect.x; x <= rect.x + rect.w; x++) {
      const on = x < rect.x + rect.w && g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && g.area[g.idx(x, y)] === area;
      if (on && s < 0) s = x;
      if (!on && s >= 0) { runs.push([s, x]); s = -1; }
    }
    const next: Rect[] = [];
    for (const [a, b] of runs) {
      const k = open.findIndex(r => r.x === a && r.x + r.w === b && r.y + r.h === y);
      if (k >= 0) { const r = open[k]; r.h++; next.push(r); open.splice(k, 1); }
      else next.push({x: a, y, w: b - a, h: 1});
    }
    out.push(...open);
    open = next;
  }
  out.push(...open);
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2-3. Rails: seams between storeys, ladder openings

/** Half width (m) of a ladder-head opening in the deck-edge railing (the 0.6 m body + 0.15 m each side). */
export const LADDER_OPENING = 0.45;

export interface RailOpening { level: number; x0: number; z0: number; x1: number; z1: number; y: number; ladder: number }

/** The railing openings at the maintenance ladder heads (a z-face: the opening runs along x at faceZ on the ladder's top storey). */
export function ladderOpenings(layout: StationLayout): RailOpening[] {
  return (layout.traversal?.ladders ?? []).filter((l: Ladder) => l.kind === 'maintenance').map((l: Ladder) => ({
    level: l.topLevel ?? 0, x0: l.x - LADDER_OPENING, z0: l.faceZ, x1: l.x + LADDER_OPENING, z1: l.faceZ, y: l.topY, ladder: l.id,
  }));
}

const levelsOfLayout = (layout: StationLayout): readonly Level[] => (layout.levels?.length ? layout.levels : [{id: 0, role: 'main', grid: layout.grid, baseY: 0}]);

/** Some storey has an open floor at (x, z) within a step of y: the far side of a rail edge there is walkable, not a drop. */
export function walkableAt(layout: StationLayout, x: number, z: number, y: number): boolean {
  const voidY = layout.trench?.floorY;
  for (const L of levelsOfLayout(layout)) {
    const g = L.grid, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
    if (Math.abs(floorNearCell(g, i, cx, cy, x, z, voidY) - y) <= STEP_UP) return true;
  }
  return false;
}

/** Base height of a rail at the point of its line nearest (x, z). */
export function railBase(r: RailRun, x: number, z: number): number {
  const lx = r.x1 - r.x0, lz = r.z1 - r.z0, l2 = lx * lx + lz * lz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - r.x0) * lx + (z - r.z0) * lz) / l2)) : 0;
  return r.y0 + (r.y1 - r.y0) * t;
}

/** The unit edge (rail, s0..s1 along it) is a seam: its far side is walkable at its base height. */
function seamAt(layout: StationLayout, r: RailRun, s: number, len: number): boolean {
  const u = s / len, x = r.x0 + (r.x1 - r.x0) * u, z = r.z0 + (r.z1 - r.z0) * u, y = r.y0 + (r.y1 - r.y0) * u;
  return walkableAt(layout, x - r.nx * 0.15, z - r.nz * 0.15, y);
}

/** A point on a rail line lies inside a ladder opening of its storey. */
export function inOpening(openings: readonly RailOpening[], level: number, x: number, z: number, y: number): boolean {
  return openings.some(o => o.level === level && Math.abs(z - o.z0) < 0.05 && x > o.x0 - 1e-6 && x < o.x1 + 1e-6 && Math.abs(y - o.y) < 0.6);
}

/** Sub-run of r between s0 and s1 (m along it). */
function subRail(r: RailRun, s0: number, s1: number, len: number): RailRun {
  const a = s0 / len, b = s1 / len, L = (t: number, p: number, q: number) => p + (q - p) * t;
  const r3 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {...r, x0: r3(L(a, r.x0, r.x1)), z0: r3(L(a, r.z0, r.z1)), x1: r3(L(b, r.x0, r.x1)), z1: r3(L(b, r.z0, r.z1)), y0: r3(L(a, r.y0, r.y1)), y1: r3(L(b, r.y0, r.y1))};
}

/**
 * THE Reactor railings after the path fixes: every run split where its far side is a walkable seam (no rail across a stair mouth /
 * between storeys at one height) and cut open at every maintenance ladder head. Runs that keep all their edges stay identical.
 */
export function pathRails(layout: StationLayout, rails: readonly RailRun[]): RailRun[] {
  const openings = ladderOpenings(layout);
  const out: RailRun[] = [];
  for (const r of rails) {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    if (len < 1e-6 || r.kind === 'parapet') { out.push(r); continue; }
    // keep-mask per unit edge (rails run along cell edges: whole cells, a last partial piece)
    const n = Math.max(1, Math.ceil(len / CELL - 1e-6));
    const keep: boolean[] = [];
    for (let k = 0; k < n; k++) keep.push(!seamAt(layout, r, Math.min(len, (k + 0.5) * CELL), len));
    // kept spans (m), then the ladder cuts (only along x at a z-face)
    let spans: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      if (!keep[k]) continue;
      const s0 = k * CELL, s1 = Math.min(len, (k + 1) * CELL);
      const last = spans[spans.length - 1];
      if (last && Math.abs(last[1] - s0) < 1e-6) last[1] = s1; else spans.push([s0, s1]);
    }
    for (const o of openings) {
      if (o.level !== r.level || Math.abs(r.z0 - o.z0) > 0.05 || Math.abs(r.z1 - o.z0) > 0.05 || r.nx !== 0) continue;
      const dirX = Math.sign(r.x1 - r.x0) || 1;
      const a = (o.x0 - r.x0) * dirX, b = (o.x1 - r.x0) * dirX, c0 = Math.min(a, b), c1 = Math.max(a, b);
      const base = railBase(r, (o.x0 + o.x1) / 2, o.z0);
      if (Math.abs(base - o.y) > 0.6) continue;
      const next: [number, number][] = [];
      for (const [s0, s1] of spans) {
        if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
        if (c0 - s0 > 0.05) next.push([s0, c0]);
        if (s1 - c1 > 0.05) next.push([c1, s1]);
      }
      spans = next;
    }
    if (spans.length === 1 && spans[0][0] < 1e-6 && Math.abs(spans[0][1] - len) < 1e-6) { out.push(r); continue; }
    for (const [s0, s1] of spans) out.push(subRail(r, s0, s1, len));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// 4. Validation: the designed gaps

/** An unrailed drop (Levels.unrailedDrops run: whole cell edges) that lies inside a ladder opening (the designed gap at a ladder head). */
export function dropInLadderOpening(layout: StationLayout, d: RailRun): boolean {
  const xa = Math.min(d.x0, d.x1), xb = Math.max(d.x0, d.x1), y = (d.y0 + d.y1) / 2;
  return d.nx === 0 && Math.abs(d.z0 - d.z1) < 1e-6 && ladderOpenings(layout).some(o =>
    o.level === d.level && Math.abs(d.z0 - o.z0) < 0.05 && Math.abs(y - o.y) < 0.6 && xa >= o.x0 - CELL / 2 - 1e-6 && xb <= o.x1 + CELL / 2 + 1e-6);
}

/**
 * The shared well-edge rule (levelIssues: every aperture edge railed, matched by exact run key) with the Reactor's designed gaps:
 * every unit edge of every aperture rail (levelGen deriveRails) is covered by a layout rail of its storey at its base height, or is a
 * seam (walkable continuation on another storey at that height), or lies in a ladder opening. Returns the uncovered edges.
 */
export function uncoveredWellEdges(layout: StationLayout): RailRun[] {
  const levels = levelsOfLayout(layout);
  const openings = ladderOpenings(layout);
  const byLevel = new Map<number, RailRun[]>();
  for (const r of layout.rails) { let l = byLevel.get(r.level); if (!l) byLevel.set(r.level, (l = [])); l.push(r); }
  const out: RailRun[] = [];
  for (const r of deriveRails(levels)) {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0), n = Math.max(1, Math.round(len / CELL));
    const mine = byLevel.get(r.level) ?? [];
    for (let k = 0; k < n; k++) {
      const s = Math.min(len, (k + 0.5) * CELL), u = s / len;
      const x = r.x0 + (r.x1 - r.x0) * u, z = r.z0 + (r.z1 - r.z0) * u, y = r.y0 + (r.y1 - r.y0) * u;
      const covered = mine.some(q => {
        const xa = Math.min(q.x0, q.x1) - 0.01, xb = Math.max(q.x0, q.x1) + 0.01, za = Math.min(q.z0, q.z1) - 0.01, zb = Math.max(q.z0, q.z1) + 0.01;
        return x >= xa && x <= xb && z >= za && z <= zb && Math.abs(railBase(q, x, z) - y) < 0.05;
      });
      if (covered || seamAt(layout, r, s, len) || inOpening(openings, r.level, x, z, y)) continue;
      out.push(subRail(r, k * CELL, Math.min(len, (k + 1) * CELL), len));
    }
  }
  return out;
}

/** levelIssues' 'well edge without railing' stands only when an aperture edge is really open (not a seam / ladder opening). */
export function excuseDesignedRailGaps(layout: StationLayout, issues: string[]): string[] {
  const k = issues.indexOf('well edge without railing');
  if (k < 0) return issues;
  const open = uncoveredWellEdges(layout);
  if (open.length) return issues.map((q, i) => (i === k ? `well edge without railing (${open.length}: first ${open[0].x0.toFixed(1)},${open[0].z0.toFixed(1)} level ${open[0].level})` : q));
  return issues.filter((_, i) => i !== k);
}

// ---------------------------------------------------------------------------------------------------------------------------
// 5. Fan clearance

/**
 * The extraction fan housing box (the delivered 'reactor-extraction-fan' model ring-fitted to the fan radius: ring radius 0.70 m about
 * y 1.256 at scale 1, 2.6 x 2.51 x 1.36 m — world/reactor/archAssets.ts REACTOR_MODELS.fanHousing) in hub-relative metres.
 */
export function fanHousingBox(r: number): {along: number; out: number; down: number; up: number} {
  const s = r / 0.7;
  return {along: 1.3 * s + 0.1, out: 1.36 * s + 0.1, down: 1.256 * s + 0.1, up: (2.5124 - 1.256) * s + 0.1};
}

/** No walkable body band (floor + 0.03 .. + 1.9, any storey; stair cells along their pitch) inside the fan's housing box. */
export function fanClear(layout: StationLayout, x: number, z: number, nx: number, nz: number, y: number, r: number): boolean {
  const b = fanHousingBox(r), tx = -nz, tz = nx;
  const y0 = y - b.down, y1 = y + b.up;
  const pts = [[-b.along, 0], [b.along, 0], [-b.along, b.out], [b.along, b.out]].map(([a, o]) => [x + tx * a + nx * o, z + tz * a + nz * o]);
  const xa = Math.min(...pts.map(p => p[0])), xb = Math.max(...pts.map(p => p[0])), za = Math.min(...pts.map(p => p[1])), zb = Math.max(...pts.map(p => p[1]));
  const levels = levelsOfLayout(layout), g0 = levels[0].grid;
  for (let cy = Math.floor(za / CELL); cy <= Math.floor((zb - 1e-6) / CELL); cy++) for (let cx = Math.floor(xa / CELL); cx <= Math.floor((xb - 1e-6) / CELL); cx++) {
    if (!g0.inBounds(cx, cy)) continue;
    const i = g0.idx(cx, cy);
    for (const L of levels) {
      const g = L.grid;
      if (g.cells[i] !== FLOOR && g.cells[i] !== VOID) continue;
      let lo = g.floorOf(i), hi = lo;
      const ri = g.rampIdx[i];
      if (ri >= 0) {
        const R = g.ramps[ri], a = (R.axis === 'x' ? cx : cy) * CELL;
        const h0 = rampHeight(R, a), h1 = rampHeight(R, a + CELL);
        lo = Math.min(h0, h1); hi = Math.max(h0, h1);
      }
      if (lo + 0.03 < y1 && hi + 1.9 > y0) return false;
    }
  }
  return true;
}
