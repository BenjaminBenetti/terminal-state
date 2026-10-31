// Track 2 (Beyond the Station), lane VIS: what the world builder must NOT draw where a track tunnel continues a bed,
// and which grid cells / faces the smooth tunnel shell owns instead (no three.js).
//
// - Wall faces (levelGeometry.extractWallFaces) are clipped against every tunnel corridor: the stair-stepped faces of
//   the conservatively rasterised tunnel cells, the bed end-face stubs beside the mouth and the door reveals inside
//   the shell wall disappear; reveals beyond the wall stay (they are the door passage).
// - Floors / ceilings of open cells that touch a corridor are left to the shell (TrackExtView.cellMode); the part of
//   such a cell outside the shell wall (a door passage on a bend) is drawn by the shell, clipped at the wall line.
// - The black end plane and the hazard barricade of a bed end are suppressed only where a tunnel continues it
//   (`continued`), and the default steel frame of a tunnel entry door is replaced by the shell's door frame.

import {CELL, FLOOR, VOID, type Grid} from '../../gen/grid';
import type {Area, StationLayout, Trench} from '../../gen/station';
import type {TrackExtensions, TrackTunnel} from '../../gen/trackExt/types';
import type {BuiltFace} from '../levelGeometry';
import {TunnelFrame} from './frame';

/** Extension marker of an area (DESIGN §1: Area.ext), undefined for core areas. */
export function extOf(area: Area | undefined | null): 'tunnel' | 'annex' | undefined {
  return (area as {ext?: 'tunnel' | 'annex'} | undefined | null)?.ext;
}

/** The layout's track extensions (StationLayout.extensions, GEN), or null. */
export function extensionsOf(layout: object): TrackExtensions | null {
  const e = (layout as {extensions?: TrackExtensions}).extensions;
  return e && Array.isArray(e.tunnels) ? e : null;
}

/** Key of a bed end in `TrackExtView.continued`. */
export const endKey = (trench: number, from: 'x0' | 'x1') => `${trench}:${from}`;

/** Bed ends (trench index + end) from which a tunnel continues; empty without extensions. */
export function continuedEnds(layout: object): Set<string> {
  const e = extensionsOf(layout);
  return new Set(e ? e.tunnels.map(t => endKey(t.trench, t.from)) : []);
}

export interface TunnelView {
  t: TrackTunnel;
  f: TunnelFrame;
  trench: Trench;
}

/** Cell modes: 0 the builder draws it as usual; 1 the shell owns the cell (centre inside a corridor); 2 the cell straddles a shell wall. */
export const CELL_BUILDER = 0, CELL_SHELL = 1, CELL_STRADDLE = 2;

export class TrackExtView {
  readonly tunnels: TunnelView[];
  /** endKey(trench, from) of every bed end a tunnel continues. */
  readonly continued: Set<string>;
  /** layout.doors indices of tunnel entry doors (their frame is the shell's). */
  readonly doorIds: Set<number>;
  /** Per main-grid cell: CELL_BUILDER / CELL_SHELL / CELL_STRADDLE (open cells only). */
  readonly mode: Uint8Array;
  /** Tunnel index of each non-builder cell (-1 otherwise). */
  readonly owner: Int16Array;
  /** Convention warnings (mirrored left normal data), for QA. */
  readonly notes: string[] = [];

  private constructor(readonly layout: StationLayout, readonly ext: TrackExtensions) {
    this.tunnels = ext.tunnels.map(t => {
      const trench = layout.trenches[t.trench];
      const sign = resolveLeftSign(t, layout, trench, this.notes);
      return {t, f: new TunnelFrame(t, sign), trench};
    });
    this.continued = new Set(ext.tunnels.map(t => endKey(t.trench, t.from)));
    this.doorIds = new Set(ext.tunnels.flatMap(t => t.doors.map(d => d.door)));
    const g = layout.grid;
    this.mode = new Uint8Array(g.w * g.h);
    this.owner = new Int16Array(g.w * g.h).fill(-1);
    this.tunnels.forEach((v, k) => markCells(g, v.f, k, this.mode, this.owner));
  }

  /** View of a layout's extensions, or null when it has none (the builder then runs exactly as before). */
  static of(layout: StationLayout): TrackExtView | null {
    const e = extensionsOf(layout);
    return e && e.tunnels.length ? new TrackExtView(layout, e) : null;
  }

  /** The shell owns this cell's floor and ceiling (level index 0 = the main grid the beds are carved in). */
  ownsCell(level: number, i: number): boolean {
    return level === 0 && this.mode[i] !== CELL_BUILDER;
  }

  /** A point inside any tunnel corridor (margin: distance kept from the shell walls). */
  insideAny(x: number, z: number, margin = 0, eps = 0.01): boolean {
    for (const v of this.tunnels) if (v.f.inside(x, z, margin, eps)) return true;
    return false;
  }

  /**
   * Wall faces minus every tunnel corridor: a face inside a corridor goes, a face crossing a shell wall keeps the part
   * outside it (openings shifted), slivers < 2 cm are dropped / absorbed. Only main-level faces are tested.
   */
  clipFaces(faces: readonly BuiltFace[]): BuiltFace[] {
    const out: BuiltFace[] = [];
    const tunnelAreas = new Set(this.tunnels.flatMap(v => v.t.areas));
    for (const f of faces) {
      if (f.level !== 0 || !this.tunnels.some(v => overlapsBounds(v.f, f))) { out.push(f); continue; }
      // A tunnel cell's faces all lie inside (or straddle, by < 6 cm, into the rock behind) the shell: none survive.
      if (tunnelAreas.has(f.area)) continue;
      const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
      const a0 = alongX ? f.x0 : f.z0, a1 = alongX ? f.x1 : f.z1, plane = alongX ? f.z0 : f.x0;
      // Points are tested a hair in front of the face (on its open side): a face ON a corridor boundary belongs to the
      // side it faces (on a shell wall line facing in: gone; facing out into a door passage / annex: kept).
      const nOff = 0.004;
      const pt = (a: number): [number, number] => (alongX ? [a, plane + f.nz * nOff] : [plane + f.nx * nOff, a]);
      const inside = (a: number) => { const [x, z] = pt(a); return this.insideAny(x, z, 0, 0.01); };
      const keep = outsideIntervals(a0, a1, inside);
      if (keep.length === 1 && keep[0][0] === a0 && keep[0][1] === a1) { out.push(f); continue; }
      if (f.slope) continue; // sloped stair walls never reach a tunnel; drop a touched one rather than distort it
      for (const [b0, b1] of keep) {
        const ops = f.openings
          .map(o => ({s0: o.s0 - (b0 - a0), s1: o.s1 - (b0 - a0), top: o.top}))
          .filter(o => o.s1 > 1e-6 && o.s0 < b1 - b0 - 1e-6)
          .map(o => ({...o, s0: Math.max(0, o.s0), s1: Math.min(b1 - b0, o.s1)}));
        out.push(alongX ? {...f, x0: b0, x1: b1, openings: ops} : {...f, z0: b0, z1: b1, openings: ops});
      }
    }
    return out;
  }
}

/** Sub-intervals of [a0, a1] where `inside` is false (5 cm sampling, edges refined to 1 mm; pieces < 2 cm dropped, ends snapped). */
export function outsideIntervals(a0: number, a1: number, inside: (a: number) => boolean): [number, number][] {
  const len = a1 - a0;
  const n = Math.max(2, Math.ceil(len / 0.05));
  const at = (k: number) => a0 + (len * k) / n;
  const vals: boolean[] = [];
  for (let k = 0; k <= n; k++) vals.push(inside(at(k)));
  if (!vals.some(v => v)) return [[a0, a1]];
  if (vals.every(v => v)) return [];
  const edge = (lo: number, hi: number, loIn: boolean) => {
    for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (inside(m) === loIn) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const out: [number, number][] = [];
  let start: number | null = vals[0] ? null : a0;
  for (let k = 1; k <= n; k++) {
    if (vals[k] === vals[k - 1]) continue;
    const e = edge(at(k - 1), at(k), vals[k - 1]);
    if (!vals[k]) start = e;
    else if (start !== null) { out.push([start, e]); start = null; }
  }
  if (start !== null) out.push([start, a1]);
  const snapped = out.map(([p, q]) => [p - a0 < 0.02 ? a0 : p, a1 - q < 0.02 ? a1 : q] as [number, number]);
  return snapped.filter(([p, q]) => q - p >= 0.02);
}

function overlapsBounds(f: TunnelFrame, face: {x0: number; z0: number; x1: number; z1: number}): boolean {
  const b = f.bounds;
  return Math.max(face.x0, face.x1) >= b.x0 && Math.min(face.x0, face.x1) <= b.x1 && Math.max(face.z0, face.z1) >= b.z0 && Math.min(face.z0, face.z1) <= b.z1;
}

/** Mark open cells touching a corridor: centre inside -> shell; else any probe point strictly inside -> straddle. */
function markCells(g: Grid, f: TunnelFrame, k: number, mode: Uint8Array, owner: Int16Array): void {
  const b = f.bounds;
  const cx0 = Math.max(0, Math.floor(b.x0 / CELL)), cx1 = Math.min(g.w - 1, Math.floor(b.x1 / CELL));
  const cy0 = Math.max(0, Math.floor(b.z0 / CELL)), cy1 = Math.min(g.h - 1, Math.floor(b.z1 / CELL));
  const probes = [[0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98], [0.5, 0.02], [0.5, 0.98], [0.02, 0.5], [0.98, 0.5]];
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
    const i = y * g.w + x, c = g.cells[i];
    if ((c !== FLOOR && c !== VOID) || mode[i] === 1) continue;
    if (f.inside((x + 0.5) * CELL, (y + 0.5) * CELL, 0, 0)) { mode[i] = 1; owner[i] = k; continue; }
    // Straddling: some part strictly inside the corridor (bed cells only touch the mouth plane: never straddle).
    if (probes.some(([u, v]) => f.inside((x + u) * CELL, (y + v) * CELL, 0.01, -0.01))) { mode[i] = 2; owner[i] = k; }
  }
}

/**
 * The left-normal convention the tunnel's data was written in (+1 = TunnelFrame's documented (tz, -tx); -1 = mirrored),
 * from ground truth in the grid: which side of the path each entry door rect really lies on, else whether `rails`
 * reproduce the bed's track positions at the mouth. Defaults to +1.
 */
export function resolveLeftSign(t: TrackTunnel, layout: StationLayout, trench: Trench | undefined, notes?: string[]): 1 | -1 {
  let vote = 0;
  const probe = new TunnelFrame(t, 1);
  for (const d of t.doors) {
    const r = layout.doors[d.door];
    if (!r) continue;
    const c = probe.project((r.x + r.w / 2) * CELL, (r.y + r.h / 2) * CELL);
    if (Math.abs(c.lat) > 0.25) vote += Math.sign(c.lat) === d.side ? 1 : -1;
  }
  if (vote === 0 && trench && t.rails.length) {
    const p = probe.first;
    const fits = (sign: number) => t.rails.every(r => trench.tracks.some(tz => Math.abs(p.z + sign * p.lz * r - tz) < 0.08 && Math.abs(p.lx) < 0.2));
    if (fits(1) && !fits(-1)) vote = 1;
    else if (fits(-1) && !fits(1)) vote = -1;
  }
  if (vote < 0) {
    notes?.push(`tunnel ${t.id}: data uses the mirrored left normal (+left = (-tz, tx)); presentation follows the data`);
    return -1;
  }
  return 1;
}
