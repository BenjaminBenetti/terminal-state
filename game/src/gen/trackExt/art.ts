// Track 2 playtest revision (task studio-alpha-track2-playtest-revision-20261031-01, lane ART): STATION-SURFACE INVITATION ART.
//
// User: "Graffie indication should also display within the station area, with more 'cool' graffity art looking stuff. As to make
// it a little more obvious. Right now you need to really look for it. I want a player to be able to naturally see the art, think
// hhmmmmm whats down here! And discover something cool!"
//
// The tunnel / hatch clue records (TrackTunnel.clues, BedEntry.clues) only ever put small marks INSIDE a tunnel or low on a bed
// wall. This planner adds a few coherent breadcrumbs on the bed walls the PLATFORMS look at, at the bed end of every real annex
// entrance (a tunnel that leads to an annex door, or a service hatch):
//   - 'piece'     a large full-colour letter piece (the eye-catcher; non-directional),
//   - 'character' the crew's gas-mask "watcher" (non-directional; the second wall of a two-platform bed),
//   - 'stencil'   a stencilled SERVICE mark with an arrow (DIRECTIONAL: toward the tunnel mouth / the hatch door).
// Then the existing in-tunnel / hatch clues and the door plates take over (world/trackExt/graffiti.ts paints all of them).
//
// Rules (tests/track-ext-art.test.ts, extensionIssues):
//   - art exists ONLY at the bed end of a real, reachable annex entrance (a tunnel with an annex door, or a hatch); a level / bed end
//     without one gets none (no orphan lure). Directional records point along their bed toward that entrance (`target`).
//   - only on solid rock wall (the bed's side-wall row is SOLID, the bed cell in front is the bed) that a platform faces across the
//     bed, clear of hatch openings / plates, hatch clue marks, wall signs and props against the wall; never across an opening.
//   - DATA ONLY in layout.extensions.art, planned AFTER the extensions are attached (finishExtensions) on its own rng fork of the
//     track-ext stream (rng.fork('station-art'): forks never advance their parent) — every core record, pin and RNG stream is
//     unchanged; coreView drops it with the extensions. Presentation: one shared atlas, one merged decal mesh (world/trackExt).
// Bed frame (as BedEntry): s = metres from the bed end face into the station, side +1 = left of that travel.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, VOID} from '../grid';
import type {StationLayout, Trench} from '../stationTypes';
import type {BedEnd, StationArt, TrackExtensions} from './types';

/** Sizes (m) and heights (m above the bed floor, centres) of the station art; the searched bed-frame range. */
export const STATION_ART = {
  /** Bed-frame range searched for wall (m from the end face): the stub past the platform end and the first metres beside it. */
  sMin: 0.4, sMax: 16,
  piece: {wMin: 3.2, wMax: 5.4, aspect: 0.5, y: 2.55},
  character: {w: 2.3, h: 2.3, y: 2.6},
  stencil: {w: 2.4, h: 1.2, y: 2.3},
  /** Platform end walls: the stencil's centre height above the platform floor, the gap kept to the bed corner. */
  endY: 1.75, endCorner: 0.3, endMinW: 1.8,
  /** Gap kept between two art records and to every obstacle (m). */
  gap: 0.35,
  /** Clearance kept around a hatch opening (m, either side; its plate sits over it). */
  hatchClear: 0.6,
  /** Half-width (m) kept clear around a hatch clue mark (arrows 2.0 m, tags 2.2 m wide) and a wall sign. */
  clueHalf: 1.4, signHalf: 1.25,
  /** Highest art top below the bed / platform ceiling (m). */
  ceilClear: 0.35,
} as const;

/** Bed-frame side of a bed wall (BedEntry convention: +1 = left of travel from the end face into the station). */
export const wallSide = (wall: 'N' | 'S', from: BedEnd): 1 | -1 => ((wall === 'S') === (from === 'x1') ? 1 : -1);

/** World X of bed-frame arc position s at a bed end. */
export const artX = (tr: Pick<Trench, 'x0' | 'x1'>, from: BedEnd, s: number) => (from === 'x1' ? tr.x1 - s : tr.x0 + s);

type Span = [number, number];

/** Free bed-frame intervals [s0, s1] of `all` minus `cut` (sorted, merged). */
function subtract(all: Span[], cut: Span[]): Span[] {
  let out = all.slice();
  for (const [c0, c1] of cut) {
    const next: Span[] = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > 1e-6);
}

/**
 * Bed-frame spans of solid rock wall on one side wall of a bed end, within [sMin, sMax]: the wall row cell is SOLID on the main
 * grid and the bed cell in front is the bed (VOID). Pure grid ground truth (exported for extensionIssues / tests).
 */
export function rockSpans(layout: Pick<StationLayout, 'grid'>, tr: Trench, from: BedEnd, wall: 'N' | 'S', sMin: number = STATION_ART.sMin, sMax: number = STATION_ART.sMax): Span[] {
  const g = layout.grid;
  const z0 = Math.round(tr.z0 / CELL), z1 = Math.round(tr.z1 / CELL);
  const row = wall === 'N' ? z0 - 1 : z1, bedRow = wall === 'N' ? z0 : z1 - 1;
  const out: Span[] = [];
  const xs0 = Math.round(tr.x0 / CELL), xs1 = Math.round(tr.x1 / CELL);
  for (let x = xs0; x < xs1; x++) {
    if (!g.inBounds(x, row) || !g.inBounds(x, bedRow)) continue;
    if (g.cells[g.idx(x, row)] !== SOLID || g.cells[g.idx(x, bedRow)] !== VOID) continue;
    const a = from === 'x1' ? tr.x1 - (x + 1) * CELL : x * CELL - tr.x0, b = a + CELL;
    if (b <= sMin || a >= sMax) continue;
    const s0 = Math.max(sMin, a), s1 = Math.min(sMax, b);
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - s0) < 1e-6) last[1] = s1;
    else if (last && Math.abs(s1 - last[0]) < 1e-6) last[0] = s0;
    else out.push([s0, s1]);
  }
  out.sort((p, q) => p[0] - q[0]);
  // merge runs that met out of order (x1 ends walk s downward)
  const merged: Span[] = [];
  for (const sp of out) { const l = merged[merged.length - 1]; if (l && sp[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], sp[1]); else merged.push([...sp] as Span); }
  return merged;
}

/** Whether a platform faces this bed wall across the bed (a player standing on it sees the wall). */
export function wallFacesPlatform(layout: Pick<StationLayout, 'areas' | 'platforms'>, tr: Trench, wall: 'N' | 'S'): boolean {
  const z0 = Math.round(tr.z0 / CELL), z1 = Math.round(tr.z1 / CELL), x0 = tr.x0 / CELL, x1 = tr.x1 / CELL;
  return layout.platforms.some(id => {
    const a = layout.areas[id];
    if (!a || ((a as {level?: number}).level ?? 0) !== 0 || a.x + a.w <= x0 || a.x >= x1) return false;
    // the N wall (z0 row, facing +Z) is seen from a platform along the bed's S edge, and vice versa
    return wall === 'N' ? a.y === z1 : a.y + a.h === z0;
  });
}

/** Obstacles (bed-frame spans) on one bed wall: hatch openings + plates, hatch clue marks, wall signs, props against the wall. */
function obstacles(layout: StationLayout, ext: TrackExtensions, ti: number, tr: Trench, from: BedEnd, wall: 'N' | 'S'): Span[] {
  const A = STATION_ART, out: Span[] = [];
  const wz = wall === 'N' ? tr.z0 : tr.z1, nz = wall === 'N' ? 1 : -1;
  const sOf = (x: number) => (from === 'x1' ? tr.x1 - x : x - tr.x0);
  for (const n of ext.annexes) {
    const b = n.bed;
    if (!b || b.trench !== ti || b.wall !== wall) continue;
    const s = sOf(b.x);
    out.push([s - b.width / 2 - A.hatchClear, s + b.width / 2 + A.hatchClear]);
    for (const c of b.clues) {
      // clue s is in the hatch's own bed frame (its end): back to world X, then into this end's frame
      const x = artX(tr, b.from, c.s), cs = sOf(x);
      out.push([cs - A.clueHalf, cs + A.clueHalf]);
    }
  }
  for (const sg of layout.signs) {
    if (sg.hang || Math.abs(sg.z - wz) > 0.35 || Math.cos(sg.rot) * nz < 0.9) continue;
    if (sg.x < tr.x0 - 2 || sg.x > tr.x1 + 2) continue;
    const s = sOf(sg.x), half = Math.max(A.signHalf, (sg.w ?? 0) / 2 + 0.35);
    out.push([s - half, s + half]);
  }
  for (const p of layout.props) {
    const near = nz > 0 ? p.z - p.hz - wz : wz - (p.z + p.hz);
    if (near > 0.8 || near < -0.3 || p.x + p.hx < tr.x0 - 1 || p.x - p.hx > tr.x1 + 1) continue;
    const a = sOf(p.x - p.hx), b = sOf(p.x + p.hx);
    out.push([Math.min(a, b) - A.gap, Math.max(a, b) + A.gap]);
  }
  return out;
}

interface WallPlan { wall: 'N' | 'S'; side: 1 | -1; free: Span[]; faces: boolean }

/**
 * The END WALL of platform `id` at a bed end, when the platform lies along that bed and ends at its platform span: the wall plane
 * (world x), inward normal, the bed edge z and the direction into the platform, the solid run (m) of that wall from the bed corner
 * (the wall column SOLID on the main grid, the platform floor in front), the blocked intervals (distance from the corner) under
 * wall signs and props against it, the platform floor and ceiling there, and the bed-frame side of the platform. Else null.
 */
export function endWall(layout: StationLayout, tr: Trench, from: BedEnd, id: number): {x: number; nx: 1 | -1; edgeZ: number; dirZ: 1 | -1; len: number; blocked: Span[]; floor: number; ceil: number; side: 1 | -1} | null {
  const a = layout.areas[id], g = layout.grid;
  if (!a || ((a as {level?: number}).level ?? 0) !== 0) return null;
  const z0 = Math.round(tr.z0 / CELL), z1 = Math.round(tr.z1 / CELL);
  const south = a.y === z1, north = a.y + a.h === z0;
  if (!south && !north) return null;
  const east = from === 'x1';
  const x = (east ? a.x + a.w : a.x) * CELL;
  if (Math.abs(x - (east ? tr.platformX1 : tr.platformX0)) > 0.75) return null;
  const col = east ? a.x + a.w : a.x - 1, front = east ? a.x + a.w - 1 : a.x;
  const dirZ: 1 | -1 = south ? 1 : -1, edgeRow = south ? a.y : a.y + a.h - 1, edgeZ = south ? tr.z1 : tr.z0;
  let n = 0;
  for (let k = 0; k < a.h; k++) {
    const row = edgeRow + dirZ * k;
    if (!g.inBounds(col, row) || g.cells[g.idx(col, row)] !== SOLID || g.cells[g.idx(front, row)] !== FLOOR || g.area[g.idx(front, row)] !== id) break;
    n++;
  }
  if (!n) return null;
  const nx: 1 | -1 = east ? -1 : 1, fi = g.idx(front, edgeRow);
  const blocked: Span[] = [];
  const dOf = (z: number) => (z - edgeZ) * dirZ;
  for (const sg of layout.signs) {
    if (sg.hang || Math.abs(sg.x - x) > 0.35 || Math.sin(sg.rot) * nx < 0.9) continue;
    const d = dOf(sg.z), half = Math.max(STATION_ART.signHalf, (sg.w ?? 0) / 2 + 0.35);
    blocked.push([d - half, d + half]);
  }
  for (const p of layout.props) {
    const near = nx > 0 ? p.x - p.hx - x : x - (p.x + p.hx);
    if (near > 0.8 || near < -0.3) continue;
    const da = dOf(p.z - p.hz), db = dOf(p.z + p.hz);
    blocked.push([Math.min(da, db) - STATION_ART.gap, Math.max(da, db) + STATION_ART.gap]);
  }
  return {x, nx, edgeZ, dirZ, len: n * CELL, blocked, floor: g.floorOf(fi), ceil: g.hasCeil(fi) ? g.ceil[fi] : g.floorOf(fi) + 3.2, side: wallSide(south ? 'S' : 'N', from)};
}

/**
 * Plans the station-surface invitation art of a finished, attached layout (layout frame). Deterministic for (layout, rng seed).
 * Returns the records (possibly none); never touches any other record.
 */
export function planStationArt(layout: StationLayout, ext: TrackExtensions, rng: Rng): StationArt[] {
  const A = STATION_ART, out: StationArt[] = [];
  // every real annex entrance at a bed end: tunnels that lead to an annex door (their mouth, s = 0), and service hatches
  const entrances: {annex: number; entry: 'tunnel' | 'hatch'; trench: number; from: BedEnd; target: number; wall?: 'N' | 'S'}[] = [];
  for (const t of ext.tunnels) if (t.doors.length) entrances.push({annex: t.doors[0].annex, entry: 'tunnel', trench: t.trench, from: t.from, target: 0});
  for (const n of ext.annexes) if (n.bed) entrances.push({annex: n.id, entry: 'hatch', trench: n.bed.trench, from: n.bed.from, target: n.bed.s, wall: n.bed.wall});
  for (const en of entrances) {
    const tr = layout.trenches[en.trench];
    if (!tr) continue;
    const r = rng.fork(`entrance:${en.entry}:${en.annex}`);
    const head = tr.ceil - tr.floorY - A.ceilClear; // usable wall height above the bed floor
    const walls: WallPlan[] = (['N', 'S'] as const).map(wall => {
      const ob = obstacles(layout, ext, en.trench, tr, en.from, wall);
      // another entrance's art on this wall (same bed, the other end's frame): world X back into this frame
      for (const o of out) if (o.trench === en.trench && o.wall === wall) {
        const x = artX(tr, o.from, o.s), s = en.from === 'x1' ? tr.x1 - x : x - tr.x0;
        ob.push([s - o.w / 2 - A.gap, s + o.w / 2 + A.gap]);
      }
      return {wall, side: wallSide(wall, en.from), free: subtract(rockSpans(layout, tr, en.from, wall), ob), faces: wallFacesPlatform(layout, tr, wall)};
    });
    const visible = walls.filter(w => w.faces && w.free.length);
    if (!visible.length) continue;
    // a span of length `len` on a wall nearest to the entrance's target (s): returns its start, or null
    const place = (w: WallPlan, len: number, near: number, after = -Infinity): number | null => {
      let best: number | null = null, bd = Infinity;
      for (const [a, b] of w.free) {
        const lo = Math.max(a, after), hi = b - len;
        if (hi < lo - 1e-9) continue;
        // the start in [lo, hi] closest to `near` (the art's near edge toward the entrance)
        const s0 = Math.max(lo, Math.min(hi, near));
        const d = Math.abs(s0 + len / 2 - near);
        if (d < bd) { bd = d; best = s0; }
      }
      return best;
    };
    const claim = (w: WallPlan, s0: number, s1: number) => { w.free = subtract(w.free, [[s0 - A.gap, s1 + A.gap]]); };
    const push = (w: WallPlan, kind: StationArt['kind'], s0: number, len: number, h: number, yc: number, toward: -1 | 0 | 1) => {
      const y = tr.floorY + Math.min(yc, head - h / 2);
      out.push({annex: en.annex, entry: en.entry, trench: en.trench, from: en.from, wall: w.wall, side: w.side, kind,
        s: r4(s0 + len / 2), y: r4(y), w: r4(len), h: r4(h), toward, target: r4(en.target), variant: r.int(0, 1023)});
      claim(w, s0, s0 + len);
    };
    // primary wall: for a hatch, its own wall when a platform faces it; else the visible wall with the most room near the entrance
    const room = (w: WallPlan) => w.free.reduce((m, [a, b]) => Math.max(m, Math.min(b, en.target + 9) - Math.max(a, en.target - 9)), 0);
    const order = visible.slice().sort((p, q) => (en.wall ? Number(q.wall === en.wall) - Number(p.wall === en.wall) : 0) || room(q) - room(p) || (r.chance(0.5) ? 1 : -1));
    const primary = order[0], secondary = order.find(w => w !== primary);
    // 1. the piece: as large as the wall allows (wMin..wMax), as near to the entrance as it fits
    let pieceW = 0;
    for (let w = A.piece.wMax; w >= A.piece.wMin - 1e-9; w -= 0.2) if (place(primary, w, en.target) !== null) { pieceW = w; break; }
    if (pieceW > 0) {
      const s0 = place(primary, pieceW, en.target)!;
      push(primary, 'piece', s0, pieceW, pieceW * A.piece.aspect, A.piece.y, 0);
    }
    // 2. the directional stencil on the primary wall, pointing back toward the entrance (beyond the piece, on the platform side)
    const stencilOn = (w: WallPlan): boolean => {
      // prefer the approach side (between the entrance and the platforms), else anywhere on the wall
      const s0 = place(w, A.stencil.w, en.target, en.target) ?? place(w, A.stencil.w, en.target);
      if (s0 === null) return false;
      const sc = s0 + A.stencil.w / 2;
      if (Math.abs(sc - en.target) < A.stencil.w / 2 + 0.05) return false;
      push(w, 'stencil', s0, A.stencil.w, A.stencil.h, A.stencil.y, sc > en.target ? -1 : 1);
      return true;
    };
    stencilOn(primary);
    // 3. the second wall a platform faces (a bed between two platforms): the watcher + its own stencil
    if (secondary) {
      const s0 = place(secondary, A.character.w, en.target);
      if (s0 !== null) push(secondary, 'character', s0, A.character.w, A.character.h, A.character.y, 0);
      stencilOn(secondary);
    } else if (pieceW > 0) {
      // one visible wall: the watcher beside the piece when it fits (never across the entrance)
      const s0 = place(primary, A.character.w, en.target);
      if (s0 !== null && r.chance(0.6)) push(primary, 'character', s0, A.character.w, A.character.h, A.character.y, 0);
    }
    // 4. the END WALL of every platform beside this bed at this end — the wall a player walking down the platform faces: a
    // stencil next to the bed corner, pointing toward the bed (the way in: down past the platform end)
    for (const id of layout.platforms) {
      const e = endWall(layout, tr, en.from, id);
      if (!e) continue;
      const free = subtract([[A.endCorner, e.len]], e.blocked);
      const sp = free.find(([a, b]) => b - a >= A.endMinW);
      if (!sp) continue;
      const sw = Math.min(A.stencil.w, sp[1] - sp[0]), sh = sw / 2, d = sp[0] + sw / 2, z = e.edgeZ + e.dirZ * d;
      const y = Math.min(e.floor + A.endY, e.ceil - A.ceilClear - sh / 2);
      out.push({annex: en.annex, entry: en.entry, trench: en.trench, from: en.from, wall: 'end', side: e.side, kind: 'stencil',
        s: r4(en.from === 'x1' ? tr.x1 - e.x : e.x - tr.x0), y: r4(y), w: r4(sw), h: r4(sh), toward: (-e.dirZ) as 1 | -1,
        target: r4((tr.z0 + tr.z1) / 2), variant: r.int(0, 1023), end: {platform: id, x: r4(e.x), nx: e.nx, z: r4(z)}});
    }
  }
  // defensive: a record that would fail the invariants is left out (art never invalidates a level, never drops an annex)
  return out.filter(a => stationArtRecordIssues(layout, ext, a).length === 0);
}

/**
 * Invariants of one station-art record (extensionIssues): it belongs to a real annex entrance at its bed end (a tunnel that
 * continues that end and leads to the annex, or the annex's own hatch); a directional record points along the bed toward it; it lies
 * on solid rock wall a platform faces, inside the searched range, under the bed ceiling, clear of every hatch opening.
 */
export function stationArtRecordIssues(layout: StationLayout, ext: TrackExtensions, a: StationArt): string[] {
  const out: string[] = [];
  const n = ext.annexes[a.annex], tr = layout.trenches[a.trench];
  if (!n || !tr) return ['no annex / bed'];
  if (a.entry === 'tunnel') {
    const t = ext.tunnels[n.tunnel];
    if (!t || t.trench !== a.trench || t.from !== a.from || !t.doors.some(d => d.annex === n.id)) out.push(`no tunnel to annex ${n.id} at bed ${a.trench}${a.from}`);
    if (a.wall !== 'end' && Math.abs(a.target) > 1e-6) out.push('tunnel target is not the mouth');
  } else if (!n.bed || n.bed.trench !== a.trench || n.bed.from !== a.from || (a.wall !== 'end' && Math.abs(n.bed.s - a.target) > 1e-3)) out.push(`no hatch of annex ${n.id} at bed ${a.trench}${a.from}`);
  if (a.toward !== 0 && a.kind !== 'stencil') out.push(`a directional ${a.kind}`);
  if (a.toward === 0 && a.kind === 'stencil') out.push('a stencil without a direction');
  if (a.wall === 'end') {
    // a platform END WALL beside this bed at this end: solid wall under the whole mark, the platform in front, pointing to the bed
    const e = a.end ? endWall(layout, tr, a.from, a.end.platform) : null;
    if (!e || !a.end) return [...out, 'no platform end wall at this bed end'];
    if (Math.abs(e.x - a.end.x) > 1e-3 || e.nx !== a.end.nx || e.side !== a.side) out.push('end wall record');
    const d = (a.end.z - e.edgeZ) * e.dirZ;
    if (d - a.w / 2 < STATION_ART.endCorner - 1e-3 || d + a.w / 2 > e.len + 1e-3) out.push('not on solid end wall');
    if (e.blocked.some(([b0, b1]) => d + a.w / 2 > b0 + 1e-3 && d - a.w / 2 < b1 - 1e-3)) out.push('over a sign / prop');
    if (a.toward !== -e.dirZ || Math.sign(a.target - a.end.z) !== a.toward) out.push('arrow does not point toward the bed');
    if (a.y - a.h / 2 < e.floor + 0.4 || a.y + a.h / 2 > e.ceil - 0.1) out.push('height');
    return out;
  }
  if (a.toward !== 0 && Math.sign(a.target - a.s) !== a.toward) out.push('arrow does not point toward the entrance');
  if (a.side !== wallSide(a.wall, a.from)) out.push('side');
  const free = rockSpans(layout, tr, a.from, a.wall);
  if (!free.some(([s0, s1]) => a.s - a.w / 2 >= s0 - 1e-6 && a.s + a.w / 2 <= s1 + 1e-6)) out.push('not on solid rock wall');
  if (!wallFacesPlatform(layout, tr, a.wall)) out.push('no platform faces its wall');
  if (a.y - a.h / 2 < tr.floorY + 0.4 || a.y + a.h / 2 > tr.ceil - 0.1) out.push('height');
  for (const m of ext.annexes) {
    const b = m.bed;
    if (!b || b.trench !== a.trench || b.wall !== a.wall) continue;
    if (Math.abs(artX(tr, a.from, a.s) - b.x) < a.w / 2 + b.width / 2 + 0.3) out.push('over a hatch opening');
  }
  return out;
}

/**
 * A wall rect kept clear of the wall treatment (world/wallDetailPlan.ts keep-outs: no cables, stains, cuts or fittings across the
 * paint): `axis` 'z' = a wall along X (plane z = const), 'x' = a wall along Z; `n` the face normal's sign on that axis; [c0, c1]
 * the world range along the wall, [y0, y1] the heights.
 */
export interface ArtKeepout { axis: 'x' | 'z'; plane: number; n: 1 | -1; c0: number; c1: number; y0: number; y1: number; why: 'station-art' | 'hatch-clue' }

/** Covers a hatch clue's marks (world/trackExt/graffiti.ts GRAFFITI: arrows 2.0 x 1.0 m at 1.7 m, tags 2.2 x 1.1 m at 2.3 m + their arrow). */
export const HATCH_CLUE_KEEPOUT = {half: 1.35, y0: 0.9, y1: 3.0} as const;

/** Every painted bed / platform-end wall rect of a layout: its station art and its service hatches' clue marks (bed walls). */
export function stationArtKeepouts(layout: Pick<StationLayout, 'extensions' | 'trenches'>): ArtKeepout[] {
  const ext = layout.extensions, out: ArtKeepout[] = [], m = 0.15;
  if (!ext) return out;
  for (const a of ext.art ?? []) {
    const tr = layout.trenches[a.trench];
    if (!tr) continue;
    const y0 = a.y - a.h / 2 - m, y1 = a.y + a.h / 2 + m;
    if (a.wall === 'end') {
      if (a.end) out.push({axis: 'x', plane: a.end.x, n: a.end.nx, c0: a.end.z - a.w / 2 - m, c1: a.end.z + a.w / 2 + m, y0, y1, why: 'station-art'});
      continue;
    }
    const xa = artX(tr, a.from, a.s - a.w / 2), xb = artX(tr, a.from, a.s + a.w / 2);
    out.push({axis: 'z', plane: a.wall === 'N' ? tr.z0 : tr.z1, n: a.wall === 'N' ? 1 : -1, c0: Math.min(xa, xb) - m, c1: Math.max(xa, xb) + m, y0, y1, why: 'station-art'});
  }
  for (const n of ext.annexes) {
    const b = n.bed, tr = b ? layout.trenches[b.trench] : undefined;
    if (!b || !tr) continue;
    for (const c of b.clues) {
      const x = artX(tr, b.from, c.s), K = HATCH_CLUE_KEEPOUT;
      out.push({axis: 'z', plane: b.wall === 'N' ? tr.z0 : tr.z1, n: b.wall === 'N' ? 1 : -1, c0: x - K.half, c1: x + K.half, y0: b.floorY + K.y0, y1: b.floorY + K.y1, why: 'hatch-clue'});
    }
  }
  return out;
}

/** Every station-art record's issues (extensionIssues). */
export function stationArtIssues(layout: StationLayout): string[] {
  const ext = layout.extensions;
  if (!ext?.art?.length) return [];
  return ext.art.flatMap((a, i) => stationArtRecordIssues(layout, ext, a).map(m => `station art ${i}: ${m}`));
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
