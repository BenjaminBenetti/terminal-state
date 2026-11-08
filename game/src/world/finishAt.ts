// Task reactor-expansion-20261101 (lane CONTROLS): the ACTUAL FINISH under a bullet's structural hit (user feedback: "particel effects
// when shooting walls do not match wall material"). damage/materials.ts structuralKeyAt mirrors the plain station builder rules
// (public hall = glazed tile walls / terrazzo floors, service rooms = painted block / concrete …), so on a level whose ARCH remaps the
// finishes — the Reactor's pit concrete / rusted steel plate / bar grating, the Office's drywall / carpet / acoustic tiles — a shot
// chipped glazed tile off pit concrete and puffed concrete dust off steel grating. This resolver answers with the finish key the
// builder really drew at the hit (world/builder.ts hands it the final remapped wall faces and the arch hooks it used):
//  - walls: the remapped face on the hit plane containing the point (one bucket per axis plane);
//  - floors / ceilings: the arch's own floorKey / ceilKey for that storey's cell (the builder's arch branch).
// Only ARCH-OWNED finishes are reported ('office-…', 'mall-…', 'reactor-…', the annexes' board-formed wall): anything else answers
// null and the hit keeps the station rule exactly as before (the Subway is unchanged). damage/impactFinish.ts maps a key to its class.

import {CELL} from '../gen/grid';
import type {Level} from '../gen/levels';

interface FaceLike {
  level: number;
  x0: number; z0: number; x1: number; z1: number;
  y0: number; y1: number;
  nx: number; nz: number;
  finish: string;
  slope?: {b0: number; b1: number; t0: number; t1: number} | null;
}
interface ArchFloors { floorKey(L: number, i: number): string | null; ceilKey(L: number, area: number, i?: number, y?: number): string | false | null }

/** A finish key is arch-owned (an arch remapped it; the station rule would not know it). */
export const isArchFinish = (k: string): boolean => /^(office-|mall-|reactor-|skyways-|market-|annexWall)/.test(k); // (+ skyways-: task studio-skyways-level-20261106-054448, lane VIEW; + market-: task studio-survivor-market-20261108-005807-01)

export type FinishAt = (kind: 'wall' | 'floor' | 'ceiling', levelIndex: number, x: number, y: number, z: number, nx: number, nz: number) => string | null;

/** Builds the resolver (null when no arch owns any finish: a plain Subway station). */
export function finishResolver(levels: readonly Level[], faces: readonly FaceLike[], arch: ArchFloors | null): FinishAt | null {
  const walls = new Map<string, {s0: number; s1: number; y0: number; y1: number; sign: number; finish: string}[]>();
  for (const f of faces) {
    if (!isArchFinish(f.finish)) continue;
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const plane = alongX ? f.z0 : f.x0, sign = Math.sign(alongX ? f.nz : f.nx);
    const s0 = Math.min(alongX ? f.x0 : f.z0, alongX ? f.x1 : f.z1), s1 = Math.max(alongX ? f.x0 : f.z0, alongX ? f.x1 : f.z1);
    const y0 = f.slope ? Math.min(f.slope.b0, f.slope.b1) : f.y0, y1 = f.slope ? Math.max(f.slope.t0, f.slope.t1) : f.y1;
    const key = `${alongX ? 'z' : 'x'}${Math.round(plane * 100)}`;
    let b = walls.get(key);
    if (!b) walls.set(key, (b = []));
    b.push({s0, s1, y0, y1, sign, finish: f.finish});
  }
  if (!walls.size && !arch) return null;
  return (kind, L, x, y, z, nx, nz) => {
    if (kind === 'wall') {
      const alongX = Math.abs(nz) >= Math.abs(nx);
      // the hit lies on a cell boundary plane: snap to it
      const plane = Math.round((alongX ? z : x) / CELL) * CELL, s = alongX ? x : z, sign = Math.sign(alongX ? nz : nx);
      const b = walls.get(`${alongX ? 'z' : 'x'}${Math.round(plane * 100)}`);
      if (!b) return null;
      let best: string | null = null, bd = Infinity;
      for (const f of b) {
        if (f.sign !== sign || s < f.s0 - 1e-3 || s > f.s1 + 1e-3) continue;
        const d = y < f.y0 ? f.y0 - y : y > f.y1 ? y - f.y1 : 0;
        if (d < bd) { bd = d; best = f.finish; }
      }
      return bd <= 0.25 ? best : null;
    }
    if (!arch) return null;
    const lvl = levels[L];
    if (!lvl) return null;
    const g = lvl.grid, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return null;
    const i = cy * g.w + cx;
    const k = kind === 'floor' ? arch.floorKey(L, i) : arch.ceilKey(L, g.area[i], i, y);
    return typeof k === 'string' && isArchFinish(k) ? k : null;
  };
}
