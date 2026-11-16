// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN connectivity checks (tests / QA; not on the generation
// path). The FOOT check is the game's own multi-level nav flood (gen/levelGen.ts levelDistance over layout.levels); the VEHICLE check is a
// clearance flood on the street level: a disc of `radius` (the truck's ~2.5 x 7 m body as a turning circle) must fit on open, unblocked,
// near-flat street-level ground, and moves between neighbouring centres step at most `step` (the vehicle controller's floor tolerance).
// Pending (not yet defined) outdoor props count as obstacles too (gen/surface/outdoorKinds.ts: their cells are `taken`).

import {CELL, FLOOR} from '../grid';
import type {StationLayout} from '../stationTypes';
import {levelDistance} from '../levelGen';

export interface VehicleFlood {
  /** Per level-0 cell: 1 = a valid disc centre reached from the start. */
  reach: Uint8Array;
  /** Valid disc centres (reached or not). */
  ok: Uint8Array;
  reached: number;
}

/**
 * Vehicle clearance flood from world (x, z) on level 0. `outdoor`: the outdoor area ids (a vehicle stays outdoors: doorway cells belong to
 * the building); `extra`: more obstacle cells (pending props' cells).
 */
export function vehicleFlood(layout: StationLayout, x: number, z: number, outdoor: ReadonlySet<number>, o: {radius?: number; step?: number; spread?: number; extra?: Uint8Array} = {}): VehicleFlood {
  const g = layout.grid, W = g.w, H = g.h, n = W * H;
  const R = (o.radius ?? 1.4) / CELL, step = o.step ?? 0.25, spread = o.spread ?? 0.3;
  const free = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0 && !g.blocked[i] && outdoor.has(g.area[i]) && !(o.extra && o.extra[i])) free[i] = 1;
  // disc offsets
  const r = Math.ceil(R);
  const offs: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= R * R) offs.push(dx + dy * W);
  const ok = new Uint8Array(n);
  for (let y = r; y < H - r; y++) for (let x0 = r; x0 < W - r; x0++) {
    const i = y * W + x0;
    if (!free[i]) continue;
    const f = g.floor[i];
    let good = true;
    for (const d of offs) { const j = i + d; if (!free[j] || Math.abs(g.floor[j] - f) > spread) { good = false; break; } }
    if (good) ok[i] = 1;
  }
  const reach = new Uint8Array(n);
  const [sx, sy] = g.cellOf(x, z);
  let s = sx + sy * W;
  if (!ok[s]) {
    // nearest valid centre within 4 m
    let best = -1, bd = Infinity;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const j = s + dx + dy * W; if (j >= 0 && j < n && ok[j] && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = j; } }
    if (best < 0) return {reach, ok, reached: 0};
    s = best;
  }
  const q = new Int32Array(n);
  let head = 0, tail = 0, reached = 1;
  reach[s] = 1; q[tail++] = s;
  while (head < tail) {
    const c = q[head++], cx = c % W, f = g.floor[c];
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? (cx > 0 ? c - 1 : -1) : k === 1 ? (cx < W - 1 ? c + 1 : -1) : k === 2 ? c - W : c + W;
      if (j < 0 || j >= n || reach[j] || !ok[j] || Math.abs(g.floor[j] - f) > step) continue;
      reach[j] = 1; reached++; q[tail++] = j;
    }
  }
  return {reach, ok, reached};
}

/** Does the vehicle reach anywhere inside the world rect (m)? */
export function vehicleReachesRect(v: VehicleFlood, W: number, r: {x0: number; z0: number; x1: number; z1: number}): boolean {
  for (let y = Math.floor(r.z0 / CELL); y < Math.ceil(r.z1 / CELL); y++) for (let x = Math.floor(r.x0 / CELL); x < Math.ceil(r.x1 / CELL); x++) if (v.reach[x + y * W]) return true;
  return false;
}

/** Foot distance field (cells) over every level from world (x, z) on `level` (the game's nav rules; -1 = unreachable). */
export function footFlood(layout: StationLayout, x: number, z: number, level = 0): Int32Array[] {
  const [sx, sy] = layout.grid.cellOf(x, z);
  return levelDistance(layout.levels, sx, sy, level, layout.levelLinks);
}
