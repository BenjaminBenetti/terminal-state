// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): THE SURVIVOR MARKET version 2's dynamic / decorative pieces DERIVED from
// the finished layout (pure, deterministic; nothing stored in the layout) — what world/marketVisuals.ts draws for a version-2 market:
//  - slow ceiling FANS hung from the shed roof over the yard and the lanes (never under a bridge, never over a catwalk or a rooftop:
//    blades high above every walking body);
//  - AWNINGS: a sloped patched canvas over every stall's / tea counter's / the kitchen's opening, on its lane side (their opening may
//    face north or south now), tucked under the catwalk edge, low edge >= 2.4 m; none where a bridge covers the lane;
//  - LINES across the lanes between the catwalk edges: laundry and cables (high over the lane, never in a walking band).
// All visual only, like version 1's (gen/market/art.ts): collision / navigation never need them.

import {CELL} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import type {MarketAwning, MarketFan} from '../art';
import {SETTLE} from './frame';

/** Fan / awning / line dimensions (m). */
export const SETTLE_ART = {
  fan: {r: 0.62, drop: 1.6, spin: [0.9, 1.4] as const},
  awning: {depth: 0.95, drop: 0.28, wallY: 2.86, over: 0.25},
  line: {y: [4.9, 5.6] as const, sag: 0.25, every: 5.5},
} as const;

/** A sagging line across a lane (laundry: cloth pieces hang from it; cable: bare). World endpoints at height y, the sag at the middle. */
export interface MarketLine { x0: number; z0: number; x1: number; z1: number; y: number; sag: number; laundry: boolean; seed: number }

const hash = (a: number, b: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
};
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Open from the ground to the roof here (a lane / the yard column with no bridge, catwalk or rooftop over it). */
function openColumn(layout: StationLayout, x: number, z: number): boolean {
  const g0 = layout.grid, [cx, cy] = g0.cellOf(x, z);
  if (!g0.inBounds(cx, cy)) return false;
  const i = g0.idx(cx, cy);
  if (g0.cells[i] !== 1 || g0.ceil[i] < SETTLE.roofY - 0.05) return false;
  for (let L = 1; L < layout.levels.length; L++) if (layout.levels[L].grid.cells[i] !== 0) return false;
  return true;
}

/** The fans of a version-2 market: a row over the yard, a few down the lanes. */
export function settleFans(layout: StationLayout): MarketFan[] {
  const out: MarketFan[] = [];
  const F = SETTLE_ART.fan;
  const add = (x: number, z: number) => {
    for (const [dx, dz] of [[0, 0], [F.r, 0], [-F.r, 0], [0, F.r], [0, -F.r]]) if (!openColumn(layout, x + dx, z + dz)) return;
    if (out.some(f => Math.hypot(f.x - x, f.z - z) < 4)) return;
    const k = out.length, y = SETTLE.roofY - F.drop;
    out.push({x: r3(x), y: r3(y), z: r3(z), r: F.r, rod: r3(SETTLE.roofY - y), level: 0, speed: r3(F.spin[0] + (F.spin[1] - F.spin[0]) * hash(layout.seed, k)), phase: r3(hash(k, layout.seed) * Math.PI * 2)});
  };
  for (const a of layout.areas) {
    if ((a.level ?? 0) !== 0 || a.kind !== 'concourse') continue;
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    if (a.label === 'The Yard') { for (const t of [-0.25, 0.25]) for (const u of [-0.22, 0.22]) add(cx + a.w * CELL * t, cz + a.h * CELL * u); continue; }
    if (a.w > a.h * 4) for (const t of [0.2, 0.5, 0.8]) add((a.x + a.w * t) * CELL, cz);
  }
  return out;
}

/** The awnings: one over every stall / tea counter / kitchen opening, on the lane side of its wall. */
export function settleAwnings(layout: StationLayout): MarketAwning[] {
  const m = layout.market;
  if (!m) return [];
  const A = SETTLE_ART.awning;
  const out: MarketAwning[] = [];
  const stallOf = new Map(m.stalls.map(s => [s.area, s.id]));
  for (const d of layout.doors) {
    if ((d.level ?? 0) !== 0 || d.h !== 1) continue;
    const a = layout.areas[d.b], onto = layout.areas[d.a];
    if (!a || !onto || a.kind !== 'room' || onto.kind !== 'concourse') continue;
    const stall = stallOf.get(a.id);
    if (!stall && !/^(Tea counter|Communal kitchen|Repair counter)$/.test(a.label)) continue;
    // the opening's wall row d.y: the lane lies north (the room south of it) or south
    const north = a.y > d.y, z = north ? d.y * CELL : (d.y + 1) * CELL, dir: 1 | -1 = north ? -1 : 1;
    const x0 = d.x * CELL - A.over, x1 = (d.x + d.w) * CELL + A.over;
    // never under a bridge (the lane covered at a container's height there)
    let covered = false;
    for (let x = x0 + 0.1; x < x1; x += 0.5) if (layout.grid.ceilAt(x, z + dir * (A.depth - 0.05)) < A.wallY + 0.1) covered = true;
    if (covered) continue;
    out.push({x0: r3(x0), x1: r3(x1), z: r3(z), depth: A.depth, yWall: A.wallY, yEdge: r3(A.wallY - A.drop), stall: stall ?? a.label, dir});
  }
  return out;
}

/** Lines across the lanes between the catwalk edges (laundry / cables), every ~5.5 m where the lane is open to the roof. */
export function settleLines(layout: StationLayout): MarketLine[] {
  const out: MarketLine[] = [];
  const L = SETTLE_ART.line;
  for (const a of layout.areas) {
    if ((a.level ?? 0) !== 0 || a.kind !== 'concourse' || !(a.w > a.h * 4)) continue;
    const z0 = a.y * CELL, z1 = (a.y + a.h) * CELL;
    for (let x = (a.x + 3) * CELL; x < (a.x + a.w - 3) * CELL; x += L.every) {
      const k = out.length, xx = x + (hash(layout.seed, k + 77) - 0.5) * 2;
      if (!openColumn(layout, xx, (z0 + z1) / 2) || !openColumn(layout, xx, z0 + 0.3) || !openColumn(layout, xx, z1 - 0.3)) continue;
      const y = L.y[0] + (L.y[1] - L.y[0]) * hash(k, layout.seed);
      const skew = (hash(layout.seed ^ 0x55, k) - 0.5) * 1.6;
      out.push({x0: r3(xx - skew / 2), z0: r3(z0), x1: r3(xx + skew / 2), z1: r3(z1), y: r3(y), sag: L.sag, laundry: hash(k, 99) < 0.6, seed: k});
    }
  }
  return out;
}
