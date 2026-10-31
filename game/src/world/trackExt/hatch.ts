// Track 2 (Beyond the Station), lane VIS — the GEN-2 entry type: SERVICE HATCHES. A service annex may be entered through a
// door in a track bed's SIDE WALL near a bed end that no tunnel continues (gen/trackExt/types.ts ServiceAnnex.bed / BedEntry).
//
// The grid already builds everything structural: the bed wall face with the opening and its lintel up to the bed ceiling, the
// door cell's reveals, the annex behind it (lower-zone service look via Area.ext), the builder's default steel door frame;
// the bed end keeps its black end plane and hazard barricade (no tunnel continues it: TrackExtView.continued). This module
// adds the presentation the tunnel doors get from the shell: the SERVICE · STAFF ONLY plate over the opening on the bed side,
// and the graffiti decals at the hatch's clue records on the same bed wall (graffiti.ts, drawn in the bed frame).

import {graffitiDecals, type GraffitiDecal} from './graffiti';
import type {Acc, V3} from './mesh';
import type {HatchView} from './view';

/** Plate size limits (m) and its height above the opening head; same plate as the tunnel doors' (shell.ts doorFrame). */
export const HATCH_PLATE = {minW: 0.8, maxW: 1.25, above: 0.4, aspect: (220 / 1024) * 1.05, proud: 0.012} as const;

/** One placed plate (tests / QA): centre on the wall plane, size, and the wall's inward normal (z sign). */
export interface HatchPlate { annex: number; x: number; y: number; z: number; w: number; h: number; nz: 1 | -1 }

/** Steel backing + sign face over every hatch opening, on the bed side of its wall. */
export function hatchPlates(steel: Acc, sign: Acc, hatches: readonly HatchView[]): HatchPlate[] {
  const out: HatchPlate[] = [];
  for (const {annex, b, trench} of hatches) {
    const nz: 1 | -1 = b.wall === 'N' ? 1 : -1; // the N wall (bed z0) faces +Z into the bed
    const inward: V3 = [0, 0, nz];
    const pw = Math.min(HATCH_PLATE.maxW, Math.max(HATCH_PLATE.minW, b.width)), ph = pw * HATCH_PLATE.aspect;
    const py = Math.min(b.head + HATCH_PLATE.above, trench.ceil - ph / 2 - 0.1);
    steel.box([b.x, py, b.z + nz * HATCH_PLATE.proud], [pw / 2 + 0.02, ph / 2 + 0.02, HATCH_PLATE.proud], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    // The face reads left-to-right for a viewer facing the wall (shell.ts doorFrame: right = cross(view, up), view = -inward).
    const right: V3 = [inward[2], 0, -inward[0]];
    const rx = right[0] * pw / 2, cz = b.z + nz * (2 * HATCH_PLATE.proud + 0.002);
    const ids = [
      sign.v([b.x - rx, py - ph / 2, cz], inward, 0, 0), sign.v([b.x + rx, py - ph / 2, cz], inward, 1, 0),
      sign.v([b.x + rx, py + ph / 2, cz], inward, 1, 1), sign.v([b.x - rx, py + ph / 2, cz], inward, 0, 1),
    ];
    sign.quad(ids[0], ids[1], ids[2], ids[3]);
    out.push({annex: annex.id, x: b.x, y: py, z: b.z, w: pw, h: ph, nz});
  }
  return out;
}

/** Graffiti at every hatch's clue records (only those), on its bed wall, kept off the opening. Decal `tunnel` = 1000 + annex id. */
export function hatchGraffiti(acc: Acc, hatches: readonly HatchView[], seed: number): GraffitiDecal[] {
  const out: GraffitiDecal[] = [];
  for (const {annex, b, f} of hatches) {
    if (!b.clues.length) continue;
    const opening = {s0: b.s - b.width / 2 - 0.1, s1: b.s + b.width / 2 + 0.1, side: b.side};
    out.push(...graffitiDecals(acc, {id: 1000 + annex.id, floorY: b.floorY, clues: b.clues}, f, seed, [opening]));
  }
  return out;
}
