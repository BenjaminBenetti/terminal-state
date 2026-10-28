// Iteration 08 (Lane W): wall faces for the wall-treatment pass.
//
// The faces come from the world builder (Lane G: world/levelGeometry.ts extractWallFaces, published as
// BuiltWorld.wallFaces). `stationWallFaces` runs the same extractor for callers without a built world
// (tests, previews). `normalizeFaces` makes faces uniform for treatment: the builder emits one face
// per material band (tiled walls: 'tileLower' up to the tile line, 'tileUpper' above, same span), so
// those are merged back into one face per wall, keeping the lower band's finish and texture base.

import {LevelColumns, extractWallFaces, stationLevels} from './levelGeometry';
import type {StationLayout} from '../gen/station';
import type {WallFace} from './wallFaces';

/** Height of the base tile band (ENV_TEXTURE_LAYOUT.wall.h; WorldMaterials.tileLowerHeight). */
export const TILE_LINE = 1.8;

/** The builder's wall faces of a station (same extractor and options as world/builder.ts). */
export function stationWallFaces(layout: StationLayout): WallFace[] {
  const levels = stationLevels(layout);
  return extractWallFaces(layout, levels, new LevelColumns(levels), {tileLowerHeight: TILE_LINE});
}

/** A face as the treatment pass sees it: texture base (floor of the finish's v mapping) included. */
export interface TreatFace extends WallFace {
  /** Texture base height (v origin) of the face's finish: tile courses / dado heights count from here. */
  base: number;
}

/**
 * Uniform faces from the builder: faces of one area on the same plane span whose vertical extents touch
 * are merged into one face keeping the lower finish; degenerate faces are dropped; openings are clamped
 * to the face and sorted. Deterministic order (level, plane, span).
 */
export function normalizeFaces(faces: readonly WallFace[]): TreatFace[] {
  const baseOf = (f: WallFace): number => {
    const vb = (f as {vb0?: number}).vb0;
    if (vb === undefined) return f.y0;
    return /tileUpper/.test(f.finish) ? vb - TILE_LINE : vb;
  };
  const list: TreatFace[] = faces
    .filter(f => Math.hypot(f.x1 - f.x0, f.z1 - f.z0) > 0.05 && f.y1 - f.y0 > 0.02)
    .map(f => ({...f, base: baseOf(f), openings: f.openings.map(o => ({...o}))}));
  const key = (f: WallFace) => `${f.level}|${f.area}|${f.nx}|${f.nz}|${f.x0.toFixed(3)}|${f.z0.toFixed(3)}|${f.x1.toFixed(3)}|${f.z1.toFixed(3)}|${f.slope ? 's' : 'r'}`;
  const groups = new Map<string, TreatFace[]>();
  for (const f of list) { const k = key(f); let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(f); }
  const out: TreatFace[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.y0 - b.y0);
    let cur = g[0];
    for (let i = 1; i < g.length; i++) {
      const f = g[i];
      if (!f.slope && !cur.slope && f.y0 <= cur.y1 + 1e-3 && Math.abs(f.base - cur.base) < 1e-3) {
        const openings = [...cur.openings];
        for (const o of f.openings) {
          const same = openings.find(p => Math.abs(p.s0 - o.s0) < 1e-3 && Math.abs(p.s1 - o.s1) < 1e-3);
          if (same) same.top = Math.max(same.top, o.top); else openings.push({...o});
        }
        cur = {...cur, y1: Math.max(cur.y1, f.y1), openings};
      } else { out.push(cur); cur = f; }
    }
    out.push(cur);
  }
  for (const f of out) {
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    f.openings = f.openings.map(o => ({s0: Math.max(0, o.s0), s1: Math.min(len, o.s1), top: Math.min(f.y1, o.top)})).filter(o => o.s1 > o.s0 + 1e-3).sort((a, b) => a.s0 - b.s0);
  }
  out.sort((a, b) => a.level - b.level || a.nx - b.nx || a.nz - b.nz || a.x0 - b.x0 || a.z0 - b.z0 || a.y0 - b.y0 || a.area - b.area);
  return out;
}

/** Face length (m) and the unit direction from (x0, z0) to (x1, z1). */
export function faceFrame(f: WallFace): {len: number; tx: number; tz: number} {
  const dx = f.x1 - f.x0, dz = f.z1 - f.z0, len = Math.hypot(dx, dz) || 1;
  return {len, tx: dx / len, tz: dz / len};
}

/** World point on a face: s metres along it, height y, `off` metres out from the plane. */
export function facePoint(f: WallFace, s: number, y: number, off = 0): [number, number, number] {
  const {tx, tz} = faceFrame(f);
  return [f.x0 + tx * s + f.nx * off, y, f.z0 + tz * s + f.nz * off];
}
