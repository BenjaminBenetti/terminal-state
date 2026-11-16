// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): QA hook of the version-2 district's reachable roofs —
// `__LL.surfaceRoof(i?, at?)` (qa.ts):
//   surfaceRoof()                 every reachable roof of the current district: building, programme, roof height / level, walk and bulkhead
//                                 rects, the roof door (id, state), the roof's areas, and whether the player stands on it now
//   surfaceRoof(i, at = 'roof')   stand at roof i — 'roof': on the roof in front of the bulkhead door, looking at it; 'landing': on the top
//                                 landing inside the bulkhead, looking out of the door; 'street': outside the building's first entrance —
//                                 then the same record (+ placed). Teleport = QA setup, not traversal proof (tests/surface-roof-access.test.ts
//                                 floods the way up on foot).

import type {Game} from '../../game';
import {CELL} from '../../gen/grid';
import {SIDE_NORMAL} from './archPlan';

type Teleport = (x: number, z: number, yaw?: number, level?: number) => boolean;

export function surfaceRoofQaApi(game: Game, teleport: Teleport) {
  const roofs = () => (game.layout?.surface?.buildings ?? []).filter(b => b.roofAccess);
  const record = (i: number) => {
    const b = roofs()[i];
    if (!b) return null;
    const ra = b.roofAccess!, p = game.player, w = ra.walk;
    return {
      i, building: b.id, name: b.name, programme: b.programme, level: ra.level, y: ra.y, walk: {...w}, bulkhead: {...ra.bulkhead},
      door: ra.door ? {id: ra.door.id, gen: ra.door.door, x: ra.door.x, z: ra.door.z, side: ra.door.side} : null, areas: [...(ra.areas ?? [])],
      onRoof: p.x > w.x0 && p.x < w.x1 && p.z > w.z0 && p.z < w.z1 && p.y > ra.y - 0.3,
    };
  };
  return {
    surfaceRoof: (i?: number, at: 'roof' | 'landing' | 'street' = 'roof') => {
      if (i === undefined) return {count: roofs().length, roofs: roofs().map((_, k) => record(k))};
      const b = roofs()[i], ra = b?.roofAccess, e = ra?.door;
      if (!b || !ra || !e) return {placed: false, roof: null};
      const n = SIDE_NORMAL[e.side], nx = n.alongX ? 0 : n.n, nz = n.alongX ? n.n : 0;
      let placed = false;
      if (at === 'street') {
        const s = b.entrances[0];
        if (s) { const m = SIDE_NORMAL[s.side], sx = m.alongX ? 0 : m.n, sz = m.alongX ? m.n : 0; placed = teleport(s.x + sx * 1.5, s.z + sz * 1.5, Math.atan2(sx, sz), 0); }
      } else {
        // (out of the door onto the roof, or in on the landing; facing the door either way)
        const d = at === 'roof' ? 1.4 : -1.2 - CELL;
        placed = teleport(e.x + nx * d, e.z + nz * d, at === 'roof' ? Math.atan2(nx, nz) : Math.atan2(-nx, -nz), ra.level);
      }
      return {placed, roof: record(i)};
    },
  };
}
