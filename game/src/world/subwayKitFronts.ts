// Task studio-subway-rework-m2-finishing-20261117-111246-01 (lane FRONTS): THE FRONTS KIT — the architecture of a version-3 grand hall's
// functional destinations and of its purposeful clerestory bays (render-only geometry; no collision, nav or layout field changes).
//
// User review (M2): the hall "still reads as a huge mostly empty nave with small edge silhouettes"; the lower ticket / service / waiting
// bays must "read as destinations rather than black silhouettes"; "the huge repeated blind upper-wall panels remain visually blank —
// break selected bays with purposeful architectural / sign hierarchy or service / clock / route features". From the dresser's records
// (HallSection.fronts / .upper, gen/stationTypes.ts; world coordinates via gen/hallSection.ts):
//  - an OFFICE front: a fascia band over the booths (gen/hallFrontGeometry.ts OFFICE_FASCIA: 2.85-3.35 m, 0.3 m out of the wall) with a
//    slim cornice lip, a shallow canopy soffit under it with a front lip, framing piers at both ends from the base to the fascia top;
//  - a WAITING front: a double-faced station clock hung on a rod from the visible soffit over the front's centre (dials facing along
//    the hall, read from its long views); against a wall, a framed backdrop panel above the bench backs with an accent cap;
//  - a KIOSK / SERVICE front: a floor inlay border round its floor zone (never across a doorway) and, against a wall, a header band;
//  - the clerestory's purposeful bays (world/subwayKit.ts asks panel() in place of each framed blind panel): a large station clock, a
//    stone surround round the dresser's sign tablet, a framed ventilation louvre.
// Existing finish keys only (the scheme's pier / accent / trim / base / ceiling keys and the builder's 'steel'); simple boxes, cylinders and
// tori — no texture is drawn. Deterministic from the layout alone; every piece keeps clear of openings, wall-backed props and wall signs.

import * as THREE from 'three';
import {CELL, FLOOR, type Grid} from '../gen/grid';
import {soffitAt, type CeilingForm} from '../gen/subwayCeilings';
import {hallSectionWorld} from '../gen/hallSection';
import {signDims} from '../gen/doorways';
import {OFFICE_FASCIA, STATION_CLOCK, clockCentreY, frontClockSpot, frontWall} from '../gen/hallFrontGeometry';
import type {Area, HallFront, HallSection, HallUpperFeature, StationLayout} from '../gen/stationTypes';
import type {TreatFace} from './wallDetailFaces';
import {ZONES} from './subwayFinish';
import {subwayArchAlbedo} from './subwayArchTextures';
import type {SubwayArch} from './subwayArch';

type BoxFn = (mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => void;
type GeoFn = (mat: string, geo: THREE.BufferGeometry, cx: number, cy: number, cz: number) => void;

/** A clerestory clock: dial diameter (m, shrunk to fit a short bay), case depth, surround margin. */
export const UPPER_CLOCK = {d: 1.8, case: 0.24, surround: 0.3} as const;
/** The ventilation louvre: at most this wide / tall (m), slat count range. */
export const GRILLE = {w: 3.6, h: 1.7, slats: [8, 12] as const, frame: 0.12} as const;
/** Floor inlay border: width / thickness (m). */
export const INLAY = {w: 0.1, t: 0.006} as const;
/** A wall kiosk / service front's header band (heights over the floor). */
export const HEADER = {y0: 2.5, y1: 2.7, proud: 0.1} as const;
/** A wall waiting front's backdrop panel (heights over the floor): above the bench backs, an accent cap at ~2.2 m. */
export const BACKDROP = {y0: 0.9, y1: 2.2, frame: 0.1, proud: 0.03, cap: 0.07} as const;

export interface FrontKitStats {
  fronts: number; fascias: number; canopies: number; piers: number; clocks: number; backdrops: number; inlays: number; headers: number;
  features: number; upperClocks: number; tablets: number; grilles: number;
}

/** What the kit knows of a hall with a ceiling form (world/subwayKit.ts HallKit). */
export interface FrontHall { a: Area; form: CeilingForm; g: Grid }

/** A clerestory face in the kit's frame (world/subwayKit.ts: along `s` from s0w in `dir`, plane + n out of the wall). */
export interface PanelFace { alongX: boolean; plane: number; n: number; s0w: number; dir: number; openings: readonly {s0: number; s1: number; top: number}[] }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const lumOf = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** [lo, hi] minus the blocked spans (pieces shorter than `min` dropped). */
function cut(lo: number, hi: number, blocked: readonly [number, number][], min = 0.2): [number, number][] {
  const s = blocked.filter(([p, q]) => q > lo && p < hi).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let pos = lo;
  for (const [p, q] of s) { if (p > pos) out.push([pos, Math.min(p, hi)]); pos = Math.max(pos, q); }
  if (hi > pos) out.push([pos, hi]);
  return out.filter(([p, q]) => q - p >= min);
}

export class HallFrontsKit {
  readonly stats: FrontKitStats = {fronts: 0, fascias: 0, canopies: 0, piers: 0, clocks: 0, backdrops: 0, inlays: 0, headers: 0, features: 0, upperClocks: 0, tablets: 0, grilles: 0};
  private readonly sections = new Map<number, HallSection>();

  constructor(private readonly box: BoxFn, private readonly sinkGeo: GeoFn, private readonly layout: StationLayout, private readonly sub: SubwayArch,
    private readonly halls: ReadonlyMap<number, FrontHall>, private readonly faces: readonly TreatFace[]) {
    for (const h of halls.values()) { const S = hallSectionWorld(h.a); if (S && (S.fronts?.length || S.upper?.length)) this.sections.set(h.a.id, S); }
  }

  private geo(mat: string, g: THREE.BufferGeometry): void {
    g.computeBoundingSphere();
    const c = g.boundingSphere!.center;
    this.sinkGeo(mat, g, c.x, c.y, c.z);
  }

  /** A box in a hall frame: along [a0, a1], y [y0, y1], across [c0, c1] (either order). */
  private hb(mat: string, alongX: boolean, a0: number, a1: number, y0: number, y1: number, c0: number, c1: number): void {
    const al = Math.min(a0, a1), ah = Math.max(a0, a1), cl = Math.min(c0, c1), ch = Math.max(c0, c1);
    if (ah - al < 1e-3 || y1 - y0 < 1e-3 || ch - cl < 1e-3) return;
    if (alongX) this.box(mat, (al + ah) / 2, (y0 + y1) / 2, (cl + ch) / 2, ah - al, y1 - y0, ch - cl);
    else this.box(mat, (cl + ch) / 2, (y0 + y1) / 2, (al + ah) / 2, ch - cl, y1 - y0, ah - al);
  }

  /** A pale finish for the clock dials: the hall ceiling's, else the scheme trim's, else the accent. */
  private dialKey(a: Area): string {
    const ceil = this.sub.zoneFinish('ceil', a), trim = this.sub.scheme.trim;
    const lc = lumOf(subwayArchAlbedo(ceil.finish.tex, ceil.finish.tint)), lt = lumOf(subwayArchAlbedo(trim.tex, trim.tint));
    if (lc >= 0.3 || lc >= lt) return ceil.key;
    return this.sub.trimKey();
  }

  // -------------------------------------------------------------------------------------------
  // the wall a front stands against

  /** Along spans of a hall wall plane that are wall (faces of the hall there), and its openings (with their heads). */
  private wallOf(a: Area, alongX: boolean, plane: number, n: number): {cover: [number, number][]; open: {lo: number; hi: number; top: number}[]} {
    const cover: [number, number][] = [], open: {lo: number; hi: number; top: number}[] = [];
    for (const f of this.faces) {
      if (f.area !== a.id || f.slope) continue;
      const fx = Math.abs(f.z1 - f.z0) < 1e-6;
      if (fx !== alongX) continue;
      const p = alongX ? f.z0 : f.x0, fn = alongX ? f.nz : f.nx;
      if (Math.abs(p - plane) > 0.02 || Math.sign(fn) !== Math.sign(n)) continue;
      const s0w = alongX ? f.x0 : f.z0, s1w = alongX ? f.x1 : f.z1, dir = Math.sign(s1w - s0w) || 1;
      cover.push([Math.min(s0w, s1w), Math.max(s0w, s1w)]);
      for (const o of f.openings) { const u = s0w + dir * o.s0, v = s0w + dir * o.s1; open.push({lo: Math.min(u, v), hi: Math.max(u, v), top: o.top}); }
    }
    return {cover, open};
  }

  /** Along spans blocked on a wall for a piece at [y0, y1] reaching `proud` out: openings, wall-backed props, wall signs (optional). */
  private blockedOn(a: Area, alongX: boolean, plane: number, n: number, y0: number, y1: number, proud: number, signs: boolean, pad = 0.05): [number, number][] {
    const {open} = this.wallOf(a, alongX, plane, n);
    const out: [number, number][] = open.filter(o => o.top > y0 - 0.02).map(o => [o.lo - 0.08, o.hi + 0.08]);
    for (const p of this.layout.props) {
      const off = ((alongX ? p.z : p.x) - plane) * n, half = alongX ? p.hz : p.hx;
      if (off - half > proud + 0.03 || off + half < -0.05) continue;
      if ((p.y ?? 0) + p.h < y0 - 0.02 || (p.y ?? 0) > y1) continue;
      const c = alongX ? p.x : p.z, e = alongX ? p.hx : p.hz;
      out.push([c - e - pad, c + e + pad]);
    }
    if (signs) for (const s of this.layout.signs) {
      if (s.hang) continue;
      const off = ((alongX ? s.z : s.x) - plane) * n;
      if (off < -0.05 || off > proud + 0.12) continue;
      const {w, h} = signDims(s);
      if (s.y + h / 2 < y0 - 0.02 || s.y - h / 2 > y1 + 0.02) continue;
      const c = alongX ? s.x : s.z;
      out.push([c - w / 2 - 0.08, c + w / 2 + 0.08]);
    }
    return out;
  }

  /** The pieces of [lo, hi] on a wall that are wall and free at [y0, y1] / `proud`. */
  private wallSpans(a: Area, alongX: boolean, plane: number, n: number, lo: number, hi: number, y0: number, y1: number, proud: number, signs: boolean, min = 0.3, pad = 0.05): [number, number][] {
    const {cover} = this.wallOf(a, alongX, plane, n);
    const blocked = this.blockedOn(a, alongX, plane, n, y0, y1, proud, signs, pad);
    const out: [number, number][] = [];
    for (const [c0, c1] of cover) {
      const l = Math.max(lo, c0), h = Math.min(hi, c1);
      if (h - l >= min) out.push(...cut(l, h, blocked, min));
    }
    return out.sort((p, q) => p[0] - q[0]);
  }

  // -------------------------------------------------------------------------------------------
  // fronts

  /** Every hall's fronts. */
  fronts(): void {
    for (const [id, S] of this.sections) {
      const h = this.halls.get(id)!;
      for (const f of S.fronts ?? []) {
        const before = this.stats.fascias + this.stats.clocks + this.stats.inlays + this.stats.headers + this.stats.backdrops;
        if (f.kind === 'office') this.office(h, S, f);
        else if (f.kind === 'waiting') this.waiting(h, S, f);
        else this.kiosk(h, S, f);
        if (this.stats.fascias + this.stats.clocks + this.stats.inlays + this.stats.headers + this.stats.backdrops > before) this.stats.fronts++;
      }
    }
  }

  private office(h: FrontHall, S: HallSection, f: HallFront): void {
    const w = frontWall(h.a, S, f);
    if (!w) return;
    const {plane, n} = w, al = S.alongX, F = OFFICE_FASCIA, floor = h.form.floor;
    const lo = Math.min(f.along[0], f.along[1]), hi = Math.max(f.along[0], f.along[1]);
    const y0 = floor + F.y0, y1 = floor + F.y1, out = (d: number) => plane + n * d;
    const accent = this.sub.accentKey(), trim = this.sub.trimKey(), ceil = this.sub.zoneFinish('ceil', h.a).key;
    // the fascia, its cornice lip and the canopy (the fascia's own sign sits 0.32 m out on it: signs never cut the fascia)
    const spans = this.wallSpans(h.a, al, plane, n, lo - F.pierW, hi + F.pierW, y0, y1 + F.lip, F.canopy + 0.05, false, 0.8);
    for (const [s0, s1] of spans) {
      this.hb(accent, al, s0, s1, y0 + F.canopyT, y1, out(0), out(F.depth));
      this.hb(trim, al, s0, s1, y1, y1 + F.lip, out(0), out(F.depth + 0.06));
      this.hb(ceil, al, s0, s1, y0, y0 + F.canopyT, out(0), out(F.canopy));
      // (the front lip rises only 2 cm over the canopy slab: the fascia's sign plate, 0.32 m out from ~2.93 m up, stays in view)
      this.hb(accent, al, s0, s1, y0, y0 + F.canopyT + 0.02, out(F.canopy - 0.05), out(F.canopy));
      this.stats.fascias++; this.stats.canopies++;
    }
    if (!spans.length) return;
    // framing piers at both ends of the fascia run, from the base to the fascia top (each only where the wall below is free)
    const first = spans[0][0], last = spans[spans.length - 1][1], pier = this.sub.pierKey(h.a), base = this.sub.baseKey();
    for (const [p0, p1] of [[first, first + F.pierW], [last - F.pierW, last]] as [number, number][]) {
      const free = this.wallSpans(h.a, al, plane, n, p0, p1, floor, y0, F.depth + 0.04, true, F.pierW - 1e-3, 0.01);
      if (!free.length) continue;
      this.hb(pier, al, p0, p1, floor + ZONES.plinth, y1, out(0), out(F.depth));
      this.hb(base, al, p0 - 0.03, p1 + 0.03, floor, floor + ZONES.plinth + 0.08, out(0), out(F.depth + 0.03));
      this.stats.piers++;
    }
  }

  private waiting(h: FrontHall, S: HallSection, f: HallFront): void {
    const al = S.alongX, floor = h.form.floor;
    // the hung double-faced clock over the front's centre
    const {along, across} = frontClockSpot(h.a, S, f);
    const [x, z] = al ? [along, across] : [across, along];
    const local = this.ceilingAbove(h, x, z);
    const cy = clockCentreY(floor, local);
    if (cy + STATION_CLOCK.d / 2 + 0.1 < local) {
      // dials face along the hall (its long views); the rod runs up to the visible soffit
      const N = al ? V(1, 0, 0) : V(0, 0, 1);
      this.clock(h.a, V(x, cy, z), N, STATION_CLOCK.d, STATION_CLOCK.t, true);
      const top = cy + STATION_CLOCK.d / 2 + 0.02;
      this.box('steel', x, (top + local) / 2, z, 0.04, local - top, 0.04);
      this.box('steel', x, top, z, 0.12, 0.05, 0.12);
      this.stats.clocks++;
    }
    // a wall front: the framed backdrop panel above the bench backs
    const w = frontWall(h.a, S, f);
    if (!w) return;
    const {plane, n} = w, B = BACKDROP, out = (d: number) => plane + n * d;
    const lo = Math.min(f.along[0], f.along[1]), hi = Math.max(f.along[0], f.along[1]);
    const y0 = floor + B.y0, y1 = floor + B.y1, pier = this.sub.pierKey(h.a), accent = this.sub.accentKey();
    for (const [s0, s1] of this.wallSpans(h.a, al, plane, n, lo, hi, y0, y1 + B.cap, B.proud + 0.06, true, 1.2)) {
      this.hb(pier, al, s0, s1, y0, y0 + B.frame, out(0), out(B.proud));
      this.hb(pier, al, s0, s1, y1 - B.frame, y1, out(0), out(B.proud));
      this.hb(pier, al, s0, s0 + B.frame, y0 + B.frame, y1 - B.frame, out(0), out(B.proud));
      this.hb(pier, al, s1 - B.frame, s1, y0 + B.frame, y1 - B.frame, out(0), out(B.proud));
      this.hb(accent, al, s0 - 0.03, s1 + 0.03, y1, y1 + B.cap, out(0), out(B.proud + 0.04));
      this.stats.backdrops++;
    }
  }

  private kiosk(h: FrontHall, S: HallSection, f: HallFront): void {
    const al = S.alongX, floor = h.form.floor, key = this.sub.accentKey();
    const lo = Math.min(f.along[0], f.along[1]), hi = Math.max(f.along[0], f.along[1]);
    const c0 = Math.min(f.across[0], f.across[1]), c1 = Math.max(f.across[0], f.across[1]);
    const w = frontWall(h.a, S, f);
    // the floor inlay border (cells of the hall's floor only: never across a doorway, a flight or another space)
    const t = INLAY.w, y0 = floor, y1 = floor + INLAY.t;
    const edges: {along: boolean; q: number; from: number; to: number}[] = [];
    if (hi - lo > 2 * t && c1 - c0 > 2 * t) {
      for (const q of [c0 + t / 2, c1 - t / 2]) if (!w || Math.abs(q - w.plane) > 0.15) edges.push({along: true, q, from: lo, to: hi});
      for (const q of [lo + t / 2, hi - t / 2]) edges.push({along: false, q, from: c0 + t, to: c1 - t});
    }
    let any = false;
    for (const e of edges) {
      for (const [p0, p1] of this.floorRuns(h, e.along, e.q, e.from, e.to)) {
        if (e.along) this.hb(key, al, p0, p1, y0, y1, e.q - t / 2, e.q + t / 2);
        else this.hb(key, al, e.q - t / 2, e.q + t / 2, y0, y1, p0, p1);
        any = true;
      }
    }
    if (any) this.stats.inlays++;
    // a wall front: the header band over its span — or, where the dresser hung the pocket's name plate on the wall (~2.75 m), a header
    // just over the plate and a sill under it, framing it (the plate is never covered)
    if (!w) return;
    const {plane, n} = w, out = (d: number) => plane + n * d;
    const plate = this.layout.signs.find(s => {
      if (s.hang) return false;
      const off = ((al ? s.z : s.x) - plane) * n, c = al ? s.x : s.z;
      return off > -0.05 && off < 0.15 && c > lo && c < hi && s.y - floor > 2.2 && s.y - floor < 3.3;
    });
    let Y0 = floor + HEADER.y0, Y1 = floor + HEADER.y1;
    if (plate) {
      const {w: pw, h: ph} = signDims(plate), pc = al ? plate.x : plate.z;
      Y0 = plate.y + ph / 2 + 0.05; Y1 = Y0 + (HEADER.y1 - HEADER.y0);
      const sy1 = plate.y - ph / 2 - 0.03;
      for (const [s0, s1] of this.wallSpans(h.a, al, plane, n, pc - pw / 2 - 0.1, pc + pw / 2 + 0.1, sy1 - 0.05, sy1, 0.09, true, 0.5)) this.hb(this.sub.trimKey(), al, s0, s1, sy1 - 0.05, sy1, out(0), out(0.06));
    }
    for (const [s0, s1] of this.wallSpans(h.a, al, plane, n, lo, hi, Y0, Y1 + 0.04, HEADER.proud + 0.03, true, 0.8)) {
      this.hb(key, al, s0, s1, Y0, Y1, out(0), out(HEADER.proud));
      this.hb(this.sub.trimKey(), al, s0, s1, Y1, Y1 + 0.04, out(0), out(HEADER.proud + 0.03));
      this.stats.headers++;
    }
  }

  /** Runs of [from, to] along a line (q fixed on the other axis) whose cells are the hall's open floor, off flights and doorways. */
  private floorRuns(h: FrontHall, alongLine: boolean, q: number, from: number, to: number): [number, number][] {
    const {g, a} = h, al = this.sections.get(a.id)!.alongX;
    const doorCells = new Set<number>();
    for (const d of this.layout.doors) {
      if ((d.level ?? 0) !== (a.level ?? 0)) continue;
      for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) if (g.inBounds(x, y)) doorCells.add(g.idx(x, y));
    }
    const ok = (p: number) => {
      // (p runs along the line; the hall frame's along / across map to world x / z by the section's axis)
      const [x, z] = alongLine === al ? [p, q] : [q, p];
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (!g.inBounds(cx, cz)) return false;
      const i = g.idx(cx, cz);
      return g.cells[i] === FLOOR && g.area[i] === a.id && g.rampIdx[i] < 0 && !doorCells.has(i);
    };
    const out: [number, number][] = [];
    let start: number | null = null;
    const step = CELL / 2;
    for (let p = from; p < to - 1e-6; p += step) {
      const e = Math.min(to, p + step), good = ok((p + e) / 2);
      if (good && start === null) start = p;
      if (!good && start !== null) { out.push([start, p]); start = null; }
    }
    if (start !== null) out.push([start, to]);
    return out.filter(([p, r]) => r - p >= 0.15);
  }

  /** The ceiling a hung piece's rod meets: the cell's own ceiling in a coffered hall (the rod passes any rib), else the visible soffit. */
  private ceilingAbove(h: FrontHall, x: number, z: number): number {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const cell = h.g.inBounds(cx, cz) && h.g.hasCeil(h.g.idx(cx, cz)) ? h.g.ceil[h.g.idx(cx, cz)] : h.form.ceil;
    if (h.form.kind === 'coffer' || h.form.kind === 'flat') return Math.min(h.form.ceil, cell);
    return soffitAt(h.form, x, z, h.g);
  }

  // -------------------------------------------------------------------------------------------
  // the clerestory's purposeful bays

  /**
   * The clerestory panel hook (world/subwayKit.ts, for each framed blind panel [s0, s1] x [bot, top] of a face): draws the bay's upper
   * feature instead and returns true (the kit skips the panel); false: no feature here (or it would reach an opening), the panel stays.
   */
  panel(a: Area, face: PanelFace, s0: number, s1: number, bot: number, top: number): boolean {
    const S = this.sections.get(a.id), h = this.halls.get(a.id);
    if (!S?.upper?.length || !h || face.alongX !== S.alongX) return false;
    const w0 = face.s0w + face.dir * s0, w1 = face.s0w + face.dir * s1, lo = Math.min(w0, w1), hi = Math.max(w0, w1);
    const u = S.upper.find(q => Math.abs(q.face - face.plane) < 0.3 && Math.sign(face.n) === q.facing
      && Math.min(hi, Math.max(q.along[0], q.along[1])) - Math.max(lo, Math.min(q.along[0], q.along[1])) > 0.5 * Math.min(hi - lo, Math.abs(q.along[1] - q.along[0])));
    if (!u) return false;
    // features stay inside the panel's frame: never in an opening of the face
    if (face.openings.some(o => o.top > bot && o.s1 > Math.min(s0, s1) - 0.1 && o.s0 < Math.max(s0, s1) + 0.1)) return false;
    const drawn = u.kind === 'clock' ? this.upperClock(h, face, lo, hi, bot, top) : u.kind === 'tablet' ? this.tablet(h, face, u, lo, hi, bot, top) : this.grille(h, face, lo, hi, bot, top);
    if (drawn) this.stats.features++;
    return drawn;
  }

  /** A face-frame box: along [a0, a1] (world), y [y0, y1], out of the wall [o0, o1]. */
  private fb(mat: string, face: PanelFace, a0: number, a1: number, y0: number, y1: number, o0: number, o1: number): void {
    this.hb(mat, face.alongX, a0, a1, y0, y1, face.plane + face.n * o0, face.plane + face.n * o1);
  }

  private upperClock(h: FrontHall, face: PanelFace, lo: number, hi: number, bot: number, top: number): boolean {
    const C = UPPER_CLOCK, room = Math.min(hi - lo, top - bot) - 2 * C.surround;
    const d = Math.min(C.d, room);
    if (d < 1.0) return false;
    const mid = (lo + hi) / 2, cy = (bot + top) / 2, side = d + 2 * C.surround;
    // the square surround (pier finish) with an accent border, then the round clock proud of it
    const pier = this.sub.pierKey(h.a), accent = this.sub.accentKey(), t = 0.09;
    this.fb(pier, face, mid - side / 2, mid + side / 2, cy - side / 2, cy + side / 2, 0, 0.05);
    this.fb(accent, face, mid - side / 2, mid + side / 2, cy + side / 2 - t, cy + side / 2, 0, 0.08);
    this.fb(accent, face, mid - side / 2, mid + side / 2, cy - side / 2, cy - side / 2 + t, 0, 0.08);
    this.fb(accent, face, mid - side / 2, mid - side / 2 + t, cy - side / 2 + t, cy + side / 2 - t, 0, 0.08);
    this.fb(accent, face, mid + side / 2 - t, mid + side / 2, cy - side / 2 + t, cy + side / 2 - t, 0, 0.08);
    const N = face.alongX ? V(0, 0, Math.sign(face.n)) : V(Math.sign(face.n), 0, 0);
    const centre = face.alongX ? V(mid, cy, face.plane) : V(face.plane, cy, mid);
    centre.addScaledVector(N, 0.05 + C.case / 2);
    this.clock(h.a, centre, N, d, C.case, false);
    this.stats.upperClocks++;
    return true;
  }

  private tablet(_h: FrontHall, face: PanelFace, u: HallUpperFeature, lo: number, hi: number, bot: number, top: number): boolean {
    // the dresser's tablet sign on this face in the bay (its plate sizes the surround), else the feature's own span
    const sign = this.layout.signs.find(s => !s.hang && Math.abs((face.alongX ? s.z : s.x) - face.plane) < 0.3 && (face.alongX ? s.x : s.z) > lo && (face.alongX ? s.x : s.z) < hi && s.y > bot && s.y < top);
    let mid: number, cy: number, w: number, hh: number;
    if (sign) { const dm = signDims(sign); mid = face.alongX ? sign.x : sign.z; cy = sign.y; w = dm.w; hh = dm.h; }
    else { const a0 = Math.max(lo, Math.min(u.along[0], u.along[1])), a1 = Math.min(hi, Math.max(u.along[0], u.along[1])); mid = (a0 + a1) / 2; w = Math.min(a1 - a0 - 1.6, 4.5); hh = 0.5; cy = (bot + top) / 2; }
    const m = 0.16, t = 0.12, W = w + 2 * m, H = hh + 2 * m;
    if (W > hi - lo || cy - H / 2 - 0.1 < bot || cy + H / 2 > top) return false;
    const accent = this.sub.accentKey(), trim = this.sub.trimKey();
    // a raised stone border round the plate (the scheme's trim stone, proud of the plate's 0.06 m face), a sill under it and a cap over it
    // in the scheme's accent (its line colour: the tablet reads as part of the station's sign hierarchy)
    this.fb(trim, face, mid - W / 2, mid + W / 2, cy + H / 2 - t, cy + H / 2, 0, 0.09);
    this.fb(trim, face, mid - W / 2, mid + W / 2, cy - H / 2, cy - H / 2 + t, 0, 0.09);
    this.fb(trim, face, mid - W / 2, mid - W / 2 + t, cy - H / 2 + t, cy + H / 2 - t, 0, 0.09);
    this.fb(trim, face, mid + W / 2 - t, mid + W / 2, cy - H / 2 + t, cy + H / 2 - t, 0, 0.09);
    this.fb(accent, face, mid - W / 2 - 0.08, mid + W / 2 + 0.08, cy - H / 2 - 0.07, cy - H / 2, 0, 0.14);
    this.fb(accent, face, mid - W / 2 - 0.04, mid + W / 2 + 0.04, cy + H / 2, cy + H / 2 + 0.05, 0, 0.11);
    this.stats.tablets++;
    return true;
  }

  private grille(h: FrontHall, face: PanelFace, lo: number, hi: number, bot: number, top: number): boolean {
    const G = GRILLE, W = Math.min(G.w, (hi - lo) * 0.6), H = Math.min(G.h, (top - bot) * 0.7);
    if (W < 1.2 || H < 0.9) return false;
    const mid = (lo + hi) / 2, cy = (bot + top) / 2, f = G.frame, pier = this.sub.pierKey(h.a);
    // the frame (pier finish) and a recessed back, then the angled steel slats
    this.fb(pier, face, mid - W / 2, mid + W / 2, cy + H / 2 - f, cy + H / 2, 0, 0.16);
    this.fb(pier, face, mid - W / 2, mid + W / 2, cy - H / 2, cy - H / 2 + f, 0, 0.16);
    this.fb(pier, face, mid - W / 2, mid - W / 2 + f, cy - H / 2 + f, cy + H / 2 - f, 0, 0.16);
    this.fb(pier, face, mid + W / 2 - f, mid + W / 2, cy - H / 2 + f, cy + H / 2 - f, 0, 0.16);
    this.fb('steel', face, mid - W / 2 + f, mid + W / 2 - f, cy - H / 2 + f, cy + H / 2 - f, 0, 0.012);
    const inner = H - 2 * f, n = Math.max(G.slats[0], Math.min(G.slats[1], Math.round(inner / 0.13)));
    const A = face.alongX ? V(1, 0, 0) : V(0, 0, 1), N = face.alongX ? V(0, 0, Math.sign(face.n)) : V(Math.sign(face.n), 0, 0);
    // slats tilted 35 deg about the along axis (their outer edge down: a weather louvre), inside the frame's depth
    const tilt = (35 * Math.PI) / 180, Y = UP.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(N, Math.sin(tilt));
    const Z = new THREE.Vector3().crossVectors(A, Y);
    for (let k = 0; k < n; k++) {
      const y = cy - inner / 2 + inner * (k + 0.5) / n;
      const c = face.alongX ? V(mid, y, face.plane) : V(face.plane, y, mid);
      c.addScaledVector(N, 0.075);
      const g = new THREE.BoxGeometry(W - 2 * f, 0.012, inner / n * 1.25);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(A, Y, Z).setPosition(c));
      this.geo('steel', g);
    }
    this.stats.grilles++;
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // a station clock (geometry: case, bezel, dial, hour batons, hands — fixed at ten past ten)

  /**
   * A clock of diameter d and case depth t centred at `c`, its dial normal N (double: dials on both faces). Case in the accent finish,
   * bezel rings and the hour batons / hands in steel, the dial in a pale finish.
   */
  private clock(a: Area, c: THREE.Vector3, N: THREE.Vector3, d: number, t: number, double: boolean): void {
    const r = d / 2, accent = this.sub.accentKey(), dial = this.dialKey(a);
    const R = new THREE.Vector3().crossVectors(UP, N).normalize();
    // the case: a cylinder along N
    const caseG = new THREE.CylinderGeometry(r, r, t, 32);
    caseG.applyMatrix4(new THREE.Matrix4().makeBasis(R, N, new THREE.Vector3().crossVectors(R, N)).setPosition(c));
    this.geo(accent, caseG);
    for (const s of double ? [1, -1] : [1]) {
      const n = N.clone().multiplyScalar(s), right = new THREE.Vector3().crossVectors(UP, n).normalize();
      const face = c.clone().addScaledVector(n, t / 2);
      // the dial (a thin disc just proud of the case) and its bezel ring
      const dg = new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.012, 32);
      dg.applyMatrix4(new THREE.Matrix4().makeBasis(right, n, new THREE.Vector3().crossVectors(right, n)).setPosition(face.clone().addScaledVector(n, 0.006)));
      this.geo(dial, dg);
      const ring = new THREE.TorusGeometry(r * 0.92, r * 0.06, 6, 32);
      ring.applyMatrix4(new THREE.Matrix4().makeBasis(right, UP, n).setPosition(face.clone().addScaledVector(n, 0.012)));
      this.geo('steel', ring);
      // twelve batons (the quarters longer) and two hands, as thin steel bars in the dial's plane
      const bar = (theta: number, from: number, to: number, width: number, lift: number) => {
        const radial = UP.clone().multiplyScalar(Math.cos(theta)).addScaledVector(right, Math.sin(theta));
        const tangent = new THREE.Vector3().crossVectors(radial, n);
        const g = new THREE.BoxGeometry(width, to - from, 0.008);
        g.applyMatrix4(new THREE.Matrix4().makeBasis(tangent, radial, n).setPosition(face.clone().addScaledVector(radial, (from + to) / 2).addScaledVector(n, 0.012 + lift)));
        this.geo('steel', g);
      };
      for (let k = 0; k < 12; k++) bar((k * Math.PI) / 6, r * (k % 3 === 0 ? 0.6 : 0.68), r * 0.8, r * (k % 3 === 0 ? 0.07 : 0.045), 0);
      bar(((10 + 10 / 60) / 12) * 2 * Math.PI, -r * 0.1, r * 0.5, r * 0.07, 0.006); // hour hand at ten past ten
      bar((10 / 60) * 2 * Math.PI, -r * 0.12, r * 0.76, r * 0.05, 0.012); // minute hand
    }
  }
}
