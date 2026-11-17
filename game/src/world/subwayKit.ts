// Task studio-subway-architecture-materials-rework-20261117-072826-01: THE SUBWAY ARCHITECTURAL KIT — the hand-made relief of a version-2+
// station (render-only geometry; no collision, nav or layout field changes).
//
// User: "Build a cohesive handmade modular architectural kit with proper wall / base / upper treatments, openings, reveals, ribs / bays /
// arches / coffers or suitable structural forms, purposeful ceiling transitions, junctions and human-scale detail", and the Grand Hall's
// "about 50 hanging lights" must give way to lights "in the architectural rhythm". On every public wall of a station with an identity:
//  - a proud granite base, a dado cap where the dado changes finish, fillets around the accent band, a stepped cornice where the wall meets
//    its ceiling (or the vault's springing);
//  - in a hall with a ceiling form (gen/subwayCeilings.ts) pilasters with base + capital on the long walls at every bay line
//    (gen/subwayBays.ts), carrying the transverse beams; coffer grids between them; shallow jack arches between them; a barrel vault with
//    transverse ribs over an interchange hall; a rock vault over a cavern space;
//  - a hall's clerestory (a long upper wall over a lower ceiling: a version-3 nave over its aisles) gets an arcade beam, a string course,
//    piers on the bay lines and framed blind panels between them;
//  - the styled fixtures of the hall lighting (LightPlacement.style): a square lantern under its stem ('drum'), a recessed trim ('downlight')
//    and a lipped trough around each concealed strip ('cove'); their glowing parts are the builder's flickering tube instances.
// Everything goes through the builder's trim sink (merged per material / level / trim chunk: a handful of draw calls per station). Beams keep
// clear of existing unstyled fixtures (shifted along the hall, else dropped), so a reloaded saved station never has a beam through a lamp.
// Deterministic from the layout alone (no RNG): the same saved station draws the same kit on every reload.

import * as THREE from 'three';
import {CELL, type Grid} from '../gen/grid';
import {VAULT_GAP, ceilingFormOf, soffitAt, type CeilingForm} from '../gen/subwayCeilings';
import type {Area, LightPlacement, StationLayout} from '../gen/stationTypes';
import type {BuiltFace} from './levelGeometry';
import {normalizeFaces, type TreatFace} from './wallDetailFaces';
import {ZONES} from './subwayFinish';
import type {SubwayArch} from './subwayArch';
import {buildCavernKit, type CavernKitStats} from './subwayKitCavern';

/** The builder's trim sink. */
export interface KitSink {
  box(mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void;
  geo(mat: string, geo: THREE.BufferGeometry, cx: number, cy: number, cz: number): void;
}

export interface KitStats { boxes: number; strips: number; pilasters: number; beams: number; shifted: number; dropped: number; lanterns: number; coves: number; panels: number;
  /** (task studio-subway-rework-m2-finishing-20261117-111246-01) piers drawn as deep fins; the cavern's neutral relief (world/subwayKitCavern.ts). */
  fins?: number; cavern?: CavernKitStats }

/** Lantern ('drum') body: outer size (m) and height above its underside. */
export const LANTERN = {w: 1.0, h: 0.46, glass: 0.9, glassH: 0.4} as const;
export const PILASTER = {w: 0.6, proud: 0.14} as const;
/**
 * Task studio-subway-rework-m2-finishing-20261117-111246-01: a brutalist scheme's board-formed structural FIN (instead of an applied
 * pilaster): narrower and ~3x deeper, from the floor to the beam's underside with no base or capital. Up to `step` above the floor it
 * stands `low` proud (the player's own radius: no walking into it), above that the full `proud` depth (a haunched blade). Its coffer
 * ribs are wider and deeper (ribW, ribDeep x the form's rib, kept above every cove ledge).
 */
export const FIN = {w: 0.32, proud: 0.45, low: 0.3, step: 2.6, ribW: 0.34, ribDeep: 1.5} as const;
const CAP = {h: 0.05, proud: 0.035} as const;
const BASE_PROUD = 0.025;
/** A clerestory's (an upper wall over a lower ceiling) arcade beam (under it, from beamFrom m above the floor), string course, panels. */
export const CLERESTORY = {beamH: 0.36, beamD: 0.5, beamFrom: 3.8, course: 0.24, inset: 0.45, frame: 0.07} as const;
/** Unstyled fixtures keep this far (m, along the hall) from a beam's side (half a 1.2 m tube fixture + margin, whichever way it turns). */
const BEAM_CLEAR = 0.75;

// ---------------------------------------------------------------------------------------------
// curved strips (vaults, jack arches, ribs): indexed quads with outward normals and auto winding

class Strips {
  pos: number[] = []; nor: number[] = []; idx: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3): void {
    const o = this.pos.length / 3;
    for (const v of [a, b, c, d]) { this.pos.push(v.x, v.y, v.z); this.nor.push(n.x, n.y, n.z); }
    const g = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    if (g.dot(n) >= 0) this.idx.push(o, o + 1, o + 3, o + 1, o + 2, o + 3);
    else this.idx.push(o, o + 3, o + 1, o + 1, o + 3, o + 2);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((this.pos.length / 3) * 2), 2));
    g.setIndex(this.idx);
    return g;
  }
}

/** World point of (along, y, across) in a hall frame. */
const W = (alongX: boolean, along: number, y: number, across: number) => (alongX ? new THREE.Vector3(along, y, across) : new THREE.Vector3(across, y, along));

/**
 * A surface following a path in the (p, y) plane, extruded over [e0, e1] on the other horizontal axis. `pAlong`: the path runs along the
 * hall (jack arches) else across it (vaults). Its normal faces down / into the room (the path is ordered by increasing p). With `depth`, a
 * rib: the underside `depth` below the path plus its two side faces.
 */
function pathStrip(S: Strips, alongX: boolean, pAlong: boolean, path: [number, number][], e0: number, e1: number, depth = 0): void {
  const P = (p: number, y: number, e: number) => (pAlong ? W(alongX, p, y, e) : W(alongX, e, y, p));
  for (let i = 0; i + 1 < path.length; i++) {
    const [p0, y0] = path[i], [p1, y1] = path[i + 1];
    const dp = p1 - p0, dy = y1 - y0, l = Math.hypot(dp, dy) || 1;
    // normal (dy, -dp) in the (p, y) plane
    const np = dy / l, ny = -dp / l;
    const n = pAlong ? W(alongX, np, ny, 0) : W(alongX, 0, ny, np);
    S.quad(P(p0, y0 - depth, e0), P(p1, y1 - depth, e0), P(p1, y1 - depth, e1), P(p0, y0 - depth, e1), n);
    if (depth > 0) {
      const ne0 = pAlong ? W(alongX, 0, 0, -1) : W(alongX, -1, 0, 0), ne1 = ne0.clone().negate();
      S.quad(P(p0, y0, e0), P(p1, y1, e0), P(p1, y1 - depth, e0), P(p0, y0 - depth, e0), ne0);
      S.quad(P(p0, y0, e1), P(p1, y1, e1), P(p1, y1 - depth, e1), P(p0, y0 - depth, e1), ne1);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// helpers

/** Merged [s0, s1] intervals of a list (sorted, overlaps joined). */
function joinSpans(list: [number, number][]): [number, number][] {
  const s = list.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) { const last = out[out.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
/** [0, len] minus the blocked spans, pieces shorter than `min` dropped. */
export function freeSpans(len: number, blocked: [number, number][], min = 0.2): [number, number][] {
  const out: [number, number][] = [];
  let pos = 0;
  for (const [a, b] of joinSpans(blocked)) { if (a > pos + min) out.push([pos, Math.min(a, len)]); pos = Math.max(pos, b); }
  if (len > pos + min) out.push([pos, len]);
  return out.filter(([a, b]) => b - a >= min);
}

/** Lights of an area that carry no hall style (the dresser's fixtures: beams keep clear of them). */
const plainLights = (layout: StationLayout, a: Area) => layout.lights.filter(l => l.area === a.id && !l.virtual && !l.style);

/** Lengths (m) of each cove light's strip: the spacing to its nearest neighbour on the same ledge line (capped). */
export function coveLengths(lights: readonly LightPlacement[]): Map<number, number> {
  const out = new Map<number, number>();
  const coves = lights.map((l, i) => ({l, i})).filter(c => c.l.style === 'cove');
  for (const c of coves) {
    const ax = Math.cos(c.l.rot), az = -Math.sin(c.l.rot);
    let best = Infinity;
    for (const d of coves) {
      if (d === c || d.l.area !== c.l.area || Math.abs(d.l.y - c.l.y) > 0.05) continue;
      const dx = d.l.x - c.l.x, dz = d.l.z - c.l.z, along = Math.abs(dx * ax + dz * az), perp = Math.abs(-dx * az + dz * ax);
      if (perp < 0.15 && along > 0.2) best = Math.min(best, along);
    }
    out.set(c.i, Number.isFinite(best) ? Math.min(best, 6) : 2);
  }
  return out;
}

const TUBE = (fixture: {w: number; h: number; d: number}) => ({x: fixture.w * 0.82, y: 0.025, z: fixture.d * 0.42, dy: -fixture.h - 0.004});

/**
 * The tube instance matrix of a styled light (null: unstyled, the builder's own): the lantern's glass ('drum'), a recessed lens
 * ('downlight'), the concealed strip of a cove ('cove', `len` long along the light's rot).
 */
export function styledTubeMatrix(l: LightPlacement, fixture: {w: number; h: number; d: number}, len = 2): THREE.Matrix4 | null {
  if (!l.style) return null;
  const t = TUBE(fixture);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot);
  const size = l.style === 'drum' ? [LANTERN.glass, LANTERN.glassH, LANTERN.glass] : l.style === 'downlight' ? [0.36, 0.015, 0.36] : [len, 0.025, 0.05];
  const cy = l.style === 'drum' ? l.y + 0.04 + LANTERN.glassH / 2 : l.y;
  return new THREE.Matrix4().compose(new THREE.Vector3(l.x, cy, l.z), q, new THREE.Vector3(size[0] / t.x, size[1] / t.y, size[2] / t.z))
    .multiply(new THREE.Matrix4().makeTranslation(0, -t.dy, 0));
}

/**
 * The form the kit draws in an area and its fixture-clear bay lines (null: flat). A low hall whose dresser's fixtures sit flush under the
 * ceiling keeps plain downstand beams between them (no jack-arch vault or coffer grid the fixtures would sit inside). Beam lines shift
 * along the hall (or drop) to clear every unstyled fixture by BEAM_CLEAR.
 */
export function hallKit(layout: StationLayout, a: Area): {form: CeilingForm; lines: number[]; shifted: number; dropped: number} | null {
  let form = ceilingFormOf(layout, a);
  if (form.kind === 'flat') return null;
  const plain = plainLights(layout, a), b = form.bays;
  if ((form.kind === 'jack' || form.kind === 'coffer') && plain.some(l => l.y > form.ceil - 0.6)) form = {...form, kind: 'beams', rise: 0, rib: 0};
  const lamps = plain.map(l => (b.alongX ? l.x : l.z));
  const clear = (l: number) => lamps.every(p => Math.abs(p - l) > form.beamW / 2 + BEAM_CLEAR);
  const lines: number[] = [];
  let shifted = 0, dropped = 0;
  if (form.beam > 0) for (const l of b.lines) {
    if (clear(l)) { lines.push(l); continue; }
    const alt = [1, -1, 1.5, -1.5, 2, -2].map(d => l + d).find(v => v > b.a0 + 1 && v < b.a1 - 1 && clear(v));
    if (alt !== undefined) { lines.push(alt); shifted++; } else dropped++;
  }
  return {form, lines: lines.sort((x, y) => x - y), shifted, dropped};
}
export const KIT_BEAM_CLEAR = BEAM_CLEAR;

// ---------------------------------------------------------------------------------------------

export interface KitInput {
  layout: StationLayout;
  /** Grid of a level id. */
  gridOf: (level: number) => Grid;
  /** The builder's (remapped) wall faces. */
  faces: readonly BuiltFace[];
  sub: SubwayArch;
}

interface HallKit { a: Area; form: CeilingForm; g: Grid; lines: number[] }

export function buildSubwayKit(sink: KitSink, inp: KitInput): KitStats {
  const {layout, sub} = inp;
  const st: KitStats = {boxes: 0, strips: 0, pilasters: 0, beams: 0, shifted: 0, dropped: 0, lanterns: 0, coves: 0, panels: 0};
  const box = (mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => {
    if (sx <= 1e-3 || sy <= 1e-3 || sz <= 1e-3) return;
    sink.box(mat, cx, cy, cz, sx, sy, sz); st.boxes++;
  };
  const scheme = sub.scheme, trim = sub.trimKey(), baseKey = sub.baseKey(), rock = !!scheme.rock;
  // (task studio-subway-rework-m2-finishing-20261117-111246-01) the scheme's structural language: piers / fins and its accent trim
  const fins = sub.pierForm === 'fin', accent = sub.accentKey();

  // --- the halls with a ceiling form, their (fixture-clear) bay lines --------------------------------------------------------------
  const halls = new Map<number, HallKit>();
  for (const a of layout.areas) {
    if (!sub.publicArea(a)) continue;
    const k = hallKit(layout, a);
    if (!k) continue;
    st.shifted += k.shifted; st.dropped += k.dropped;
    halls.set(a.id, {a, form: k.form, g: inp.gridOf(a.level ?? 0), lines: k.lines});
  }

  /** Is the cell at a world point part of a hall's high nave (its own area, ceiling at the form's)? */
  const nave = (h: HallKit, x: number, z: number): boolean => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= h.g.w || cz >= h.g.h) return false;
    const i = cz * h.g.w + cx;
    return h.g.area[i] === h.a.id && Math.abs(h.g.ceil[i] - h.form.ceil) < 0.05;
  };
  /** Runs [c0, c1] across the hall at an along position where the cells are nave. */
  const acrossRuns = (h: HallKit, along: number): [number, number][] => {
    const b = h.form.bays, out: [number, number][] = [];
    let start: number | null = null;
    for (let c = b.c0; c < b.c1 - 1e-6; c += CELL) {
      const ok = nave(h, b.alongX ? along : c + CELL / 2, b.alongX ? c + CELL / 2 : along);
      if (ok && start === null) start = c;
      if (!ok && start !== null) { out.push([start, c]); start = null; }
    }
    if (start !== null) out.push([start, b.c1]);
    return out;
  };
  /** Runs [a0, a1] along the hall at an across position where the cells are nave. */
  const alongRuns = (h: HallKit, across: number): [number, number][] => {
    const b = h.form.bays, out: [number, number][] = [];
    let start: number | null = null;
    for (let s = b.a0; s < b.a1 - 1e-6; s += CELL) {
      const ok = nave(h, b.alongX ? s + CELL / 2 : across, b.alongX ? across : s + CELL / 2);
      if (ok && start === null) start = s;
      if (!ok && start !== null) { out.push([start, s]); start = null; }
    }
    if (start !== null) out.push([start, b.a1]);
    return out;
  };
  /** A straight member: [p0, p1] along `axisAlong ? along : across`, at the other coordinate q, width w, from y0 to y1. */
  const member = (mat: string, h: HallKit, axisAlong: boolean, p0: number, p1: number, q: number, w: number, y0: number, y1: number) => {
    const alongX = h.form.bays.alongX, mid = (p0 + p1) / 2, len = p1 - p0;
    const [along, across, sa, sc] = axisAlong ? [mid, q, len, w] : [q, mid, w, len];
    if (alongX) box(mat, along, (y0 + y1) / 2, across, sa, y1 - y0, sc);
    else box(mat, across, (y0 + y1) / 2, along, sc, y1 - y0, sa);
  };

  // --- ceilings ----------------------------------------------------------------------------------------------------------------------
  for (const h of halls.values()) {
    const {form} = h, b = form.bays, struct = sub.structKey(h.a);
    const S = new Strips();
    const lights = layout.lights.filter(l => l.area === h.a.id && !l.virtual);
    /** Cut a member run around lights near its line (coffer ribs): gaps of +-0.6 m. */
    const gapRuns = (runs: [number, number][], axisAlong: boolean, q: number, half: number): [number, number][] => {
      const near = lights.filter(l => Math.abs((axisAlong ? (b.alongX ? l.z : l.x) : (b.alongX ? l.x : l.z)) - q) < half + 0.55);
      if (!near.length) return runs;
      const out: [number, number][] = [];
      for (const [r0, r1] of runs) {
        const blocked = near.map(l => (axisAlong ? (b.alongX ? l.x : l.z) : (b.alongX ? l.z : l.x)) - r0).map(p => [p - 0.6, p + 0.6] as [number, number]);
        for (const [s0, s1] of freeSpans(r1 - r0, blocked, 0.3)) out.push([r0 + s0, r0 + s1]);
      }
      return out;
    };
    if (form.kind === 'beams' || form.kind === 'coffer' || form.kind === 'jack') {
      for (const l of h.lines) {
        for (const [c0, c1] of acrossRuns(h, l)) { member(struct, h, false, c0, c1, l, form.beamW, form.ceil - form.beam, form.ceil - 0.005); st.beams++; }
      }
    }
    if (form.kind === 'coffer') {
      // coffer ribs: an odd count per bay and across the width, so every bay centre (where the hall's lantern hangs) is a coffer centre
      const odd = (len: number) => { let n = Math.max(1, Math.round(len / form.module)); if (n % 2 === 0) n += len / n > form.module ? 1 : -1; return Math.max(1, n); };
      const edges = [b.a0, ...h.lines, b.a1];
      // (fins: a heavier waffle — wider ribs, deeper where no cove ledge runs under them: they stay above every cove's lips)
      const coveTop = Math.max(-Infinity, ...lights.filter(l => l.style === 'cove').map(l => l.y + 0.1));
      const rib = fins ? Math.max(form.rib, Math.min(form.rib * FIN.ribDeep, form.beam - 0.1, form.ceil - coveTop)) : form.rib;
      const ribY0 = form.ceil - rib, ribY1 = form.ceil - 0.005, rw = fins ? FIN.ribW : 0.22;
      for (let i = 0; i + 1 < edges.length; i++) {
        const lo = edges[i], hi = edges[i + 1], n = odd(hi - lo);
        for (let k = 1; k < n; k++) {
          const p = lo + ((hi - lo) * k) / n;
          for (const [c0, c1] of gapRuns(acrossRuns(h, p), false, p, rw / 2)) member(struct, h, false, c0, c1, p, rw, ribY0, ribY1);
        }
      }
      const nc = odd(b.c1 - b.c0);
      for (let k = 1; k < nc; k++) {
        const q = b.c0 + ((b.c1 - b.c0) * k) / nc;
        for (const [a0, a1] of gapRuns(alongRuns(h, q), true, q, rw / 2)) member(struct, h, true, a0, a1, q, rw, ribY0, ribY1);
      }
    }
    if (form.kind === 'jack') {
      // shallow segmental vaults between the beams (and from the end walls), across the nave's width
      const edges = [b.a0, ...h.lines, b.a1];
      const springY = form.ceil - form.beam + 0.12, crown = form.ceil - VAULT_GAP;
      for (let i = 0; i + 1 < edges.length; i++) {
        const lo = edges[i] + (i > 0 ? form.beamW / 2 : 0), hi = edges[i + 1] - (i + 1 < edges.length - 1 ? form.beamW / 2 : 0);
        if (hi - lo < 1) continue;
        const N = 10, path: [number, number][] = [];
        for (let k = 0; k <= N; k++) { const t = k / N; path.push([lo + (hi - lo) * t, springY + (crown - springY) * (1 - (2 * t - 1) * (2 * t - 1))]); }
        for (const [c0, c1] of acrossRuns(h, (lo + hi) / 2)) pathStrip(S, b.alongX, true, path, c0, c1);
      }
    }
    if (form.kind === 'vault' || form.kind === 'rock') {
      const key = form.kind === 'rock' ? sub.rockCeilKey() : struct;
      const N = 16, path: [number, number][] = [];
      for (let k = 0; k <= N; k++) { const t = k / N; path.push([b.c0 + (b.c1 - b.c0) * t, form.ceil - VAULT_GAP - form.rise * (2 * t - 1) * (2 * t - 1)]); }
      const V = form.kind === 'rock' ? new Strips() : S;
      for (const [a0, a1] of alongRuns(h, (b.c0 + b.c1) / 2)) pathStrip(V, b.alongX, false, path, a0, a1);
      if (form.kind === 'vault') {
        // transverse ribs on the bay lines, following the vault
        for (const l of h.lines) pathStrip(S, b.alongX, false, path, l - form.beamW / 2, l + form.beamW / 2, form.beam);
      }
      if (V !== S) emit(key, V);
    }
    emit(struct, S);
  }
  function emit(mat: string, S: Strips): void {
    const g = S.geometry();
    if (!g) return;
    g.computeBoundingSphere();
    const c = g.boundingSphere!.center;
    sink.geo(mat, g, c.x, c.y, c.z);
    st.strips++;
  }

  // --- walls -------------------------------------------------------------------------------------------------------------------------
  const nearWall = (f: TreatFace) => {
    const alongX = Math.abs(f.z1 - f.z0) < 1e-6, plane = alongX ? f.z0 : f.x0, n = alongX ? f.nz : f.nx;
    const s0 = alongX ? f.x0 : f.z0, dir = Math.sign(alongX ? f.x1 - f.x0 : f.z1 - f.z0) || 1;
    const sOf = (w: number) => (w - s0) * dir;
    const out: [number, number][] = [];
    for (const p of layout.props) {
      const off = ((alongX ? p.z : p.x) - plane) * n, half = alongX ? p.hz : p.hx;
      if (off - half > 0.35 || off + half < -0.05) continue;
      const c = alongX ? p.x : p.z, e = alongX ? p.hx : p.hz, a = sOf(c - e), bb = sOf(c + e);
      out.push([Math.min(a, bb) - 0.08, Math.max(a, bb) + 0.08]);
    }
    for (const s of layout.signs) {
      if (s.hang) continue;
      const off = ((alongX ? s.z : s.x) - plane) * n;
      if (off < -0.05 || off > 0.3) continue;
      const c = sOf(alongX ? s.x : s.z), w = (s.w ?? 1.4) / 2 + 0.1;
      out.push([c - w, c + w]);
    }
    return out;
  };
  const faces = normalizeFaces(inp.faces).filter(f => !f.slope && /^subway-/.test(f.finish));
  for (const f of faces) {
    const a = f.area >= 0 ? layout.areas[f.area] : undefined;
    const alongX = Math.abs(f.z1 - f.z0) < 1e-6;
    const len = alongX ? Math.abs(f.x1 - f.x0) : Math.abs(f.z1 - f.z0);
    if (len < 0.4) continue;
    const dir = Math.sign(alongX ? f.x1 - f.x0 : f.z1 - f.z0) || 1, s0w = alongX ? f.x0 : f.z0;
    const plane = alongX ? f.z0 : f.x0, n = alongX ? f.nz : f.nx;
    const floor = f.base;
    /** A run along the face at [s0, s1], [y0, y1], `proud` out of the wall. */
    const run = (mat: string, sa: number, sb: number, y0: number, y1: number, proud: number) => {
      const w0 = s0w + dir * sa, w1 = s0w + dir * sb, mid = (w0 + w1) / 2, L = Math.abs(w1 - w0), q = plane + n * proud / 2;
      if (alongX) box(mat, mid, (y0 + y1) / 2, q, L, y1 - y0, proud); else box(mat, q, (y0 + y1) / 2, mid, proud, y1 - y0, L);
    };
    /** Openings blocking a height (their top above y). */
    const openAt = (y: number, pad = 0.02): [number, number][] => f.openings.filter(o => o.top > y).map(o => [o.s0 - pad, o.s1 + pad]);
    const keep = nearWall(f);
    const covers = (y0: number, y1: number) => f.y0 <= y0 + 1e-3 && f.y1 >= y1 - 1e-3;
    // proud granite base
    if (covers(floor, floor + ZONES.plinth)) for (const [sa, sb] of freeSpans(len, openAt(floor), 0.15)) run(baseKey, sa, sb, floor, floor + ZONES.plinth, BASE_PROUD);
    if (rock) continue; // painted rock: no tile mouldings
    // dado cap (where the dado changes finish)
    const dadoY = floor + ZONES.dado;
    if (scheme.dado.tex !== sub.zoneFinish('field', a).finish.tex && covers(dadoY - CAP.h, dadoY + CAP.h))
      for (const [sa, sb] of freeSpans(len, [...openAt(dadoY), ...keep], 0.25)) run(trim, sa, sb, dadoY - CAP.h / 2, dadoY + CAP.h / 2, CAP.proud);
    // band fillets
    const top = Math.max(f.y1, a?.ceil ?? f.y1);
    if (scheme.band && top - floor >= 3.45) for (const y of [floor + ZONES.band0, floor + ZONES.band1]) {
      if (covers(y - 0.02, y + 0.02)) for (const [sa, sb] of freeSpans(len, openAt(y), 0.25)) run(trim, sa, sb, y - 0.015, y + 0.015, 0.02);
    }
    // cornice: at the wall's top under its ceiling, at the springing of a vault (long walls only)
    const h = a ? halls.get(a.id) : undefined;
    const longWall = !!h && h.form.bays.alongX === alongX;
    const vaulted = !!h && (h.form.kind === 'vault' || h.form.kind === 'rock');
    let corniceTop = vaulted ? (longWall ? h!.form.spring - VAULT_GAP : NaN) : a && f.y1 >= a.ceil - 0.05 && f.y1 - floor >= 3.6 ? f.y1 : NaN;
    if (Number.isFinite(corniceTop) && corniceTop > f.y1 + 1e-3) corniceTop = NaN;
    if (Number.isFinite(corniceTop)) {
      const blocked = openAt(corniceTop - 0.4, 0.05);
      for (const [sa, sb] of freeSpans(len, blocked, 0.3)) {
        run(trim, sa, sb, corniceTop - 0.24, corniceTop - 0.14, 0.06);
        run(trim, sa, sb, corniceTop - 0.14, corniceTop - 0.005, 0.15);
      }
    }
    // pilasters (with base and capital) on the long walls at the hall's bay lines, carrying the beams / ribs (in the scheme's PIER finish;
    // a fin scheme's deep board-formed fins from the floor to the beam, no base or capital)
    if (h && longWall && h.form.kind !== 'rock' && h.lines.length) {
      const pTop = h.form.kind === 'vault' ? h.form.spring - VAULT_GAP - 0.24 : h.form.ceil - h.form.beam;
      if (pTop - floor > 2.6 && covers(floor, pTop)) {
        const pier = sub.pierKey(h.a), pw = fins ? FIN.w : PILASTER.w;
        const blocked = [...openAt(floor, 0.35), ...keep];
        for (const l of h.lines) {
          const s = (l - s0w) * dir, a0 = s - pw / 2, a1 = s + pw / 2;
          if (a0 < 0.15 || a1 > len - 0.15 || blocked.some(([p, q]) => a1 > p && a0 < q)) continue;
          if (fins) {
            run(pier, a0, a1, floor, floor + FIN.step, FIN.low);
            run(pier, a0, a1, floor + FIN.step, pTop, FIN.proud);
            st.fins = (st.fins ?? 0) + 1;
          } else {
            run(pier, a0, a1, floor + ZONES.plinth, pTop - 0.16, PILASTER.proud);
            run(baseKey, a0 - 0.04, a1 + 0.04, floor, floor + ZONES.plinth + 0.08, PILASTER.proud + 0.04);
            run(trim, a0 - 0.05, a1 + 0.05, pTop - 0.16, pTop, PILASTER.proud + 0.05);
          }
          st.pilasters++;
        }
      }
    }
    // clerestory: a long upper wall standing on a lower ceiling (a version-3 nave over its aisles; a tall lintel wall) gets an arcade
    // beam under it, a string course, piers on the bay lines up to the beams and framed blind panels between them
    if (h && longWall && f.y0 - floor >= 2.4 && f.y1 - f.y0 >= 1.5) {
      // (the arcade beam and the piers in the scheme's PIER finish, the string course in its ACCENT: an oxblood / navy / signal-orange line)
      const y0 = f.y0, sc = CLERESTORY.course, pier = sub.pierKey(h.a);
      for (const [sa, sb] of freeSpans(len, openAt(y0 - 0.4, 0.05), 0.3)) {
        if (y0 - floor >= CLERESTORY.beamFrom) {
          // (only over a real arcade: a lower lintel wall keeps its opening's full height)
          const w0 = s0w + dir * sa, w1 = s0w + dir * sb, mid = (w0 + w1) / 2, L = Math.abs(w1 - w0), D = CLERESTORY.beamD, Y = y0 - CLERESTORY.beamH / 2;
          if (alongX) box(pier, mid, Y, plane, L, CLERESTORY.beamH, D); else box(pier, plane, Y, mid, D, CLERESTORY.beamH, L);
        }
        run(accent, sa, sb, y0, y0 + sc, 0.12);
      }
      const pTop = Math.min(f.y1, h.form.kind === 'vault' ? h.form.spring - VAULT_GAP - 0.24 : h.form.ceil - h.form.beam);
      const piers: [number, number][] = [];
      const pw = fins ? FIN.w : PILASTER.w;
      if (pTop - y0 > 1.2) for (const l of h.lines) {
        const s = (l - s0w) * dir, a0 = s - pw / 2, a1 = s + pw / 2;
        if (a0 < 0.15 || a1 > len - 0.15) continue;
        if (fins) { run(pier, a0, a1, y0 + sc, pTop, FIN.proud); st.fins = (st.fins ?? 0) + 1; } else {
          run(pier, a0, a1, y0 + sc, pTop - 0.16, PILASTER.proud);
          run(trim, a0 - 0.05, a1 + 0.05, pTop - 0.16, pTop, PILASTER.proud + 0.05);
        }
        piers.push([a0, a1]);
        st.pilasters++;
      }
      piers.sort((p, q) => p[0] - q[0]);
      const top = (pTop - y0 > 1.2 ? pTop - 0.16 : f.y1) - CLERESTORY.inset, bot = y0 + sc + CLERESTORY.inset, t = CLERESTORY.frame;
      let p0 = 0;
      for (const [a0, a1] of [...piers, [len, len] as [number, number]]) {
        const s0 = p0 + CLERESTORY.inset, s1 = a0 - CLERESTORY.inset;
        p0 = a1;
        if (s1 - s0 < 1.2 || top - bot < 1.2) continue;
        run(trim, s0, s1, bot, bot + t, 0.03);
        run(trim, s0, s1, top - t, top, 0.03);
        run(trim, s0, s0 + t, bot + t, top - t, 0.03);
        run(trim, s1 - t, s1, bot + t, top - t, 0.03);
        st.panels++;
      }
    }
  }

  // --- a cavern's neutral relief (task studio-subway-rework-m2-finishing-20261117-111246-01: world/subwayKitCavern.ts) ---------------------
  if (rock) st.cavern = buildCavernKit({layout, sub, faces, box, freeSpans, nearWall, formOf: a => halls.get(a.id)?.form ?? null});

  // --- styled fixtures ---------------------------------------------------------------------------------------------------------------
  const cov = coveLengths(layout.lights);
  layout.lights.forEach((l, i) => {
    if (l.virtual || !l.style) return;
    const a = layout.areas[l.area], h = a ? halls.get(a.id) : undefined;
    if (l.style === 'drum') {
      const w = LANTERN.w, top = l.y + LANTERN.h, bar = 0.045;
      box('steel', l.x, top - 0.035, l.z, w, 0.07, w); // cap
      box('steel', l.x, top + 0.05, l.z, 0.3, 0.1, 0.3); // canopy
      for (const s of [-1, 1]) {
        box('steel', l.x + s * (w / 2 - bar / 2), l.y + 0.02, l.z, bar, 0.04, w); // bottom frame
        box('steel', l.x, l.y + 0.02, l.z + s * (w / 2 - bar / 2), w, 0.04, bar);
        for (const t of [-1, 1]) box('steel', l.x + s * (w / 2 - bar / 2), l.y + LANTERN.h / 2, l.z + t * (w / 2 - bar / 2), bar, LANTERN.h, bar); // corner posts
      }
      // the stem to the visible soffit above (beam, vault, coffer or the cell ceiling)
      const g = inp.gridOf(a?.level ?? 0), soffit = h ? soffitAt(h.form, l.x, l.z, g) : Math.min(a?.ceil ?? top + 1, g.ceilAt(l.x, l.z));
      const stem = soffit - (top + 0.1);
      if (stem > 0.05) box('steel', l.x, top + 0.1 + stem / 2, l.z, 0.04, stem, 0.04);
      st.lanterns++;
    } else if (l.style === 'downlight') {
      const r = 0.25, t = 0.035;
      for (const s of [-1, 1]) {
        box(trim, l.x + s * (r - t / 2), l.y + 0.01, l.z, t, 0.03, 2 * r);
        box(trim, l.x, l.y + 0.01, l.z + s * (r - t / 2), 2 * r, 0.03, t);
      }
    } else if (l.style === 'cove') {
      // the trough the strip sits in: a ledge and two lips that hide the strip from the floor, so the cove washes the soffit instead of
      // reading as a bare glowing line (the strip itself is the light's tube instance)
      const L = cov.get(i) ?? 2, alongX = Math.abs(Math.cos(l.rot)) > 0.5, W = 0.16, lip = 0.03;
      box(trim, l.x, l.y - 0.06, l.z, alongX ? L : W, 0.08, alongX ? W : L);
      for (const s of [-1, 1]) {
        const o = s * (W / 2 - lip / 2);
        box(trim, l.x + (alongX ? 0 : o), l.y + 0.02, l.z + (alongX ? o : 0), alongX ? L : lip, 0.08, alongX ? lip : L);
      }
      st.coves++;
    }
  });
  return st;
}
