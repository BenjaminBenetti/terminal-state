// Track 2 (lane GEN): grid window copy of the layout re-framing (gen/trackExt/core.ts).

import type {Grid} from '../grid';

/**
 * Copies the window [ox, ox + out.w) x [oy, oy + out.h) of `src` into `out` (cells, areas, ceilings, floors, ramp indices; with
 * `props` also the blocked / sight-blocked prop footprints); parts of the window outside `src` stay rock.
 */
export function copyWindow(src: Grid, out: Grid, ox: number, oy: number, props = false): void {
  const sx0 = Math.max(0, ox), sx1 = Math.min(src.w, ox + out.w);
  if (sx1 <= sx0) return;
  const n = sx1 - sx0;
  for (let y = 0; y < out.h; y++) {
    const sy = y + oy;
    if (sy < 0 || sy >= src.h) continue;
    const s = sy * src.w + sx0, d = y * out.w + (sx0 - ox);
    out.cells.set(src.cells.subarray(s, s + n), d);
    out.area.set(src.area.subarray(s, s + n), d);
    out.ceil.set(src.ceil.subarray(s, s + n), d);
    out.floor.set(src.floor.subarray(s, s + n), d);
    out.rampIdx.set(src.rampIdx.subarray(s, s + n), d);
    if (props) { out.blocked.set(src.blocked.subarray(s, s + n), d); out.sightBlocked.set(src.sightBlocked.subarray(s, s + n), d); }
  }
}
