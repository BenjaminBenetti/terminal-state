// Task track3-eaton-centre-20261031 (lane GEN): QA poses into The Eaton's Center for the primary's short serial browser spot checks
// (qa.ts `__LL.goMall(name, ring?)`). Pure data: a standing pose {x, y (feet), z, yaw, pitch, level} on walkable floor, or null.
//
//  - 'platform-lookup': on platform 1 under the open void, looking steeply up at the rings and the glass roof;
//  - 'court': in the fountain court (north), looking across the platforms and up the void;
//  - 'ring-edge' (ring 1..6, default 3): on that ring's gallery at the void's rail, looking across and down the atrium;
//  - 'shopfront' (ring, default 2): on the gallery 3 m in front of the ring's widest shopfront, facing it;
//  - 'escalator' (ring = the lower storey 0..5, default 0): 3 m in front of the bottom of an escalator bank, looking up it;
//  - 'bridge' (default: the first bridge): at a bridge deck's end, looking along it;
//  - 'elevator': on the glass elevator's landing (station storey), facing the doors;
//  - 'washrooms' (ring, default 1): at the gallery mouth of the ring's washroom passage.
// Yaw convention: forward = (-sin yaw, -cos yaw).

import {CELL, FLOOR} from '../grid';
import type {StationLayout} from '../stationTypes';

export type MallPoseName = 'platform-lookup' | 'court' | 'ring-edge' | 'shopfront' | 'escalator' | 'bridge' | 'elevator' | 'washrooms';
export const MALL_POSE_NAMES: readonly MallPoseName[] = ['platform-lookup', 'court', 'ring-edge', 'shopfront', 'escalator', 'bridge', 'elevator', 'washrooms'];
export interface MallPose { x: number; y: number; z: number; yaw: number; pitch: number; level: number; name: MallPoseName }

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));

/** Nearest walkable flat cell centre to (x, z) on `level` (within 6 m), else null. */
function stand(layout: StationLayout, level: number, x: number, z: number): [number, number] | null {
  const g = layout.levels[level]?.grid;
  if (!g) return null;
  const [cx, cy] = g.cellOf(x, z);
  for (let r = 0; r <= 12; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
    const qx = cx + ox, qy = cy + oy;
    if (!g.walkable(qx, qy) || g.rampIdx[g.idx(qx, qy)] >= 0 || !g.circleClear((qx + 0.5) * CELL, (qy + 0.5) * CELL, 0.35)) continue;
    return g.center(qx, qy);
  }
  return null;
}

export function mallQaPose(layout: StationLayout, name: MallPoseName, ring?: number): MallPose | null {
  const m = layout.mall;
  if (!m) return null;
  const vb = m.void.bounds, vcx = (vb.x0 + vb.x1) / 2, vcz = (vb.z0 + vb.z1) / 2;
  const base = (lv: number) => layout.levels[lv]?.baseY ?? 0;
  const pose = (lv: number, x: number, z: number, yaw: number, pitch: number): MallPose => ({x: r3(x), y: base(lv), z: r3(z), yaw: r3(yaw), pitch, level: lv, name});
  switch (name) {
    case 'platform-lookup': {
      const s = m.start;
      return pose(0, s.x, s.z, yawTo(s.x, s.z, vcx, vcz), 1.0);
    }
    case 'court': {
      const p = stand(layout, 0, vcx - (vb.x1 - vb.x0) * 0.2, vb.z0 + 1.5);
      return p ? pose(0, p[0], p[1], yawTo(p[0], p[1], vcx, vcz + 6), 0.55) : null;
    }
    case 'ring-edge': {
      const lv = Math.max(1, Math.min(6, ring ?? 3));
      // The gallery cell on the void's north rim nearest the void's middle column, 0.6 m back from the rail.
      const g = layout.levels[lv].grid;
      const [cx] = g.cellOf(vcx, vcz);
      for (let d = 0; d < g.w; d++) for (const x of [cx + d, cx - d]) {
        for (let y = 1; y < g.h - 1; y++) {
          const i = g.idx(x, y);
          if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || g.blocked[i]) continue;
          const below = g.idx(x, y + 1);
          if (g.cells[below] === FLOOR) continue;
          const [wx, wz] = g.center(x, y);
          if (wz < vb.z0 - 1 || wz > vcz) continue;
          // the next cell south is the void (not a wall): its station band rises past this storey
          if (layout.grid.cells[below] === 0 || layout.grid.ceil[below] < base(lv) + 2) continue;
          return pose(lv, wx, wz - 0.35, yawTo(wx, wz, vcx, vb.z1), -0.35);
        }
      }
      return null;
    }
    case 'shopfront': {
      const lv = Math.max(1, Math.min(6, ring ?? 2));
      const s = m.shops.filter(q => q.level === lv).sort((a, b) => b.width - a.width)[0];
      if (!s) return null;
      const f = s.frontage, fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2;
      const [nx, nz] = f.side === 'N' ? [0, 1] : f.side === 'S' ? [0, -1] : f.side === 'W' ? [1, 0] : [-1, 0];
      const p = stand(layout, lv, fx + nx * 3, fz + nz * 3);
      return p ? pose(lv, p[0], p[1], yawTo(p[0], p[1], fx, fz), 0.05) : null;
    }
    case 'escalator': {
      const lv = Math.max(0, Math.min(5, ring ?? 0));
      const v = m.verticals.find(q => q.kind === 'escalator' && q.lower === lv);
      if (!v) return null;
      const dx = v.head.x - v.foot.x, dz = v.head.z - v.foot.z, d = Math.hypot(dx, dz) || 1;
      const p = stand(layout, lv, v.foot.x - dx / d * 3, v.foot.z - dz / d * 3);
      return p ? pose(lv, p[0], p[1], yawTo(p[0], p[1], v.head.x, v.head.z), 0.3) : null;
    }
    case 'bridge': {
      const b = m.bridges[0];
      if (!b) return null;
      const p = stand(layout, b.level, b.from.x, b.from.z - 1.5);
      return p ? pose(b.level, p[0], p[1], yawTo(p[0], p[1], b.to.x, b.to.z), -0.05) : null;
    }
    case 'elevator': {
      const v = m.verticals.find(q => q.kind === 'elevator');
      if (!v) return null;
      const e = m.elevators[0], cx = (e.cab.x0 + e.cab.x1) / 2, cz = (e.cab.z0 + e.cab.z1) / 2;
      const p = stand(layout, 0, v.foot.x, v.foot.z);
      return p ? pose(0, p[0], p[1], yawTo(p[0], p[1], cx, cz), 0.1) : null;
    }
    case 'washrooms': {
      const lv = Math.max(1, Math.min(6, ring ?? 1));
      const a = layout.areas.find(q => q.level === lv && q.type === 'passage' && q.label.startsWith('Washrooms'));
      if (!a) return null;
      const d = layout.doors.find(q => (q.a === a.id || q.b === a.id) && !q.staff && (q.level ?? 0) === lv && layout.areas[q.a === a.id ? q.b : q.a]?.role === 'mall');
      if (!d) return null;
      const dx = (d.x + d.w / 2) * CELL, dz = (d.y + d.h / 2) * CELL;
      const toward = dx < vcx ? 1 : -1;
      const p = stand(layout, lv, dx + toward * 3, dz);
      return p ? pose(lv, p[0], p[1], yawTo(p[0], p[1], dx, dz), 0) : null;
    }
  }
  return null;
}
