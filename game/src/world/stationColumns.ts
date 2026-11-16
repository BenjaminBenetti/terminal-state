// Task studio-subway-platform-pillars-20261116-214939-01 (user: the platform pillars "just not look 'real' they are sorta shiny metal
// rectangles … don't appear convincing / true to life"): the STATION COLUMNS ('column' props of gen/stationDress.ts — platform rows,
// the columns between two tracks, concourse rows; on every level's station storey) drawn as what a cut-and-cover subway's columns are:
// RIVETED BUILT-UP STEEL H-COLUMNS, painted (the vision's "charcoal-painted steel, desaturated teal": WorldMaterials 'columnPaint').
//  - SECTION: two flange plates facing the tracks / the wall (±z), a web plate between them (x = 0) and the four angles that tie them
//    (two legs each, in the web-flange corners), inside the 0.5 m footprint (0.44 m over the flanges): the collision box, the cover
//    and the clearances are the placement's, unchanged. Bullet marks land on the drawn steel (damage/propDamage.ts re-casts a hit onto
//    the detached meshes), the sight line is shut by the web.
//  - RIVETS: two rows on each flange face (through the flange and the angles' flange legs) and two in each channel (through the web
//    and the angles' web legs), at a 0.3 m pitch, from the base stiffeners to the head; none across the splice.
//  - BASE: a 0.5 m base plate on the floor (the footprint), a stiffener across each channel, two anchor bolts each side of it (square
//    washer, hex nut, the stud's end) and two small gussets at each flange's foot.
//  - SPLICE at eye height (a field splice, as real columns are spliced a little above the floor): bolted cover plates on the flanges
//    and on the web in each channel.
//  - HEAD: a 0.5 m cap plate under the ceiling, a bracket stiffener in each channel and a bolted cleat on each flange.
// One geometry per column HEIGHT (the platform, track-bed and concourse ceilings differ: a handful per level; nothing is scaled, so
// rivets and plates keep their size), instanced per level and 48 m cohort (world/staticCohorts.ts planCohorts — the architecture's
// chunk): a few draws a view, one shared material, one BLAS per height for the traced flashlight. Position, normal, uv and an index,
// like the builder's merged boxes (one vertex layout). Deterministic: the layout's columns only (no random draw).
// A level's OWN colonnade (the Bunker vault hall's, with its own capitals and beams: gen/bunker/v2/floor0Dress.ts vaultHall) is not a
// station column and keeps the plain clad box (builder.ts).

import * as THREE from 'three';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {F0_LABELS} from '../gen/bunker/v2/floor0Spec';
import {planCohorts} from './staticCohorts';
import {CHUNK_M} from './levelGeometry';

/** The column's construction (m). Local frame: origin = the base's centre on the column's floor, +y up, flanges facing ±z. */
export const STATION_COLUMN = {
  /** Flange width (along x) and depth over the flanges (along z): inside the 0.5 m footprint. */
  bf: 0.44, d: 0.44,
  /** Flange and web plate thickness; the flange plates' broken edges. */
  tf: 0.026, tw: 0.018, chamfer: 0.006,
  /** The web-flange angles: leg length, thickness. */
  angleLeg: 0.09, angleT: 0.013,
  /** Rivet heads: radius, height, pitch along a row; first row height above the floor; clearance under the head. */
  rivet: {r: 0.016, h: 0.011, pitch: 0.3, from: 0.36, headClear: 0.5},
  /** Base plate (the footprint) and its thickness; channel stiffener height; anchor bolts (x from the web, ±z). */
  base: {plate: 0.5, t: 0.04, stiffH: 0.22, anchorX: 0.15, anchorZ: 0.1},
  /** Cap plate and thickness; channel bracket depth below the cap; flange cleat height. */
  cap: {plate: 0.5, t: 0.03, bracketH: 0.3, cleatH: 0.13},
  /** Eye-height field splice: bottom, height. */
  splice: {y: 1.18, h: 0.42},
  /** Splice cover plates (flange, web) thickness. */
  coverT: 0.014, webCoverT: 0.012,
  /** Hex bolt heads (across flats, height) and anchor nuts. */
  bolt: {af: 0.036, h: 0.016},
  nut: {af: 0.044, h: 0.034, washer: 0.075, washerT: 0.01, stud: 0.012, studH: 0.026},
} as const;

/** Columns lower than this get no splice (a short concourse column): the rows run through. */
const SPLICE_MIN_H = 2.6;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** An axis direction of a fastener / plate face: the outward normal and two tangents (t1 × t2 = n). */
interface Frame { n: V3; t1: V3; t2: V3 }
const FRAMES: Record<'+x' | '-x' | '+z' | '-z' | '+y', Frame> = {
  '+x': {n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1]},
  '-x': {n: [-1, 0, 0], t1: [0, 0, 1], t2: [0, 1, 0]},
  '+z': {n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0]},
  '-z': {n: [0, 0, -1], t1: [0, 1, 0], t2: [1, 0, 0]},
  '+y': {n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0]},
};
const at = (o: V3, f: Frame, a: number, b: number, c: number): V3 =>
  [o[0] + f.t1[0] * a + f.t2[0] * b + f.n[0] * c, o[1] + f.t1[1] * a + f.t2[1] * b + f.n[1] * c, o[2] + f.t1[2] * a + f.t2[2] * b + f.n[2] * c];

/** Indexed position / normal / uv accumulator (flat faces with their own vertices; smooth domes share theirs). */
class Mesher {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  private vert(p: V3, n: V3): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    // a box projection in metres by the dominant normal axis (the world-mapped material samples its maps by world position; this
    // only keeps the attribute meaningful)
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (ax >= ay && ax >= az) this.uv.push(p[2], p[1]); else if (ay >= az) this.uv.push(p[0], p[2]); else this.uv.push(p[0], p[1]);
    return i;
  }
  /** A flat convex polygon facing `outward` (its winding is fixed to face it). */
  face(pts: V3[], outward: V3): void {
    let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    if (dot(n, outward) < 0) { pts = [...pts].reverse(); n = [-n[0], -n[1], -n[2]]; }
    const b = pts.map(p => this.vert(p, n));
    for (let i = 1; i + 1 < b.length; i++) this.idx.push(b[0], b[i], b[i + 1]);
  }
  /** An axis-aligned box; `skip` names faces never seen (against the floor, the ceiling or another part). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, skip = ''): void {
    if (!skip.includes('-x')) this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    if (!skip.includes('+x')) this.face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
    if (!skip.includes('-y')) this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
    if (!skip.includes('+y')) this.face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0]);
    if (!skip.includes('-z')) this.face([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1]);
    if (!skip.includes('+z')) this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  }
  /** A plate whose outline (convex, (u, y) points) lies in the vertical plane along `u` ('x' or 'z'), `w0..w1` thick across it. */
  plate(outline: [number, number][], u: 'x' | 'z', w0: number, w1: number): void {
    const P = (uu: number, y: number, w: number): V3 => (u === 'x' ? [uu, y, w] : [w, y, uu]);
    const across: V3 = u === 'x' ? [0, 0, 1] : [1, 0, 0];
    this.face(outline.map(([a, y]) => P(a, y, w1)), across);
    this.face(outline.map(([a, y]) => P(a, y, w0)), [-across[0], -across[1], -across[2]]);
    const cu = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
    for (let i = 0; i < outline.length; i++) {
      const [a0, y0] = outline[i], [a1, y1] = outline[(i + 1) % outline.length];
      // the edge's outward normal in the outline's plane
      let eu = y1 - y0, ey = -(a1 - a0);
      if (eu * ((a0 + a1) / 2 - cu) + ey * ((y0 + y1) / 2 - cy) < 0) { eu = -eu; ey = -ey; }
      this.face([P(a0, y0, w0), P(a1, y1, w0), P(a1, y1, w1), P(a0, y0, w1)], u === 'x' ? [eu, ey, 0] : [0, ey, eu]);
    }
  }
  /** The sides of a vertical prism: a convex outline of (x, z) points from y0 to y1 (its ends sit against other parts). */
  extrudeY(outline: [number, number][], y0: number, y1: number): void {
    const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
    for (let i = 0; i < outline.length; i++) {
      const [x0, z0] = outline[i], [x1, z1] = outline[(i + 1) % outline.length];
      let nx = z1 - z0, nz = -(x1 - x0);
      if (nx * ((x0 + x1) / 2 - cx) + nz * ((z0 + z1) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      this.face([[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], [nx, 0, nz]);
    }
  }
  /** A flat-sided prism of `sides` (hex nut / bolt head) standing `h` out of the surface at `o` along the frame's normal. */
  prism(o: V3, f: Frame, sides: number, r: number, h: number, rot = 0): void {
    const ring = (c: number) => Array.from({length: sides}, (_, k) => { const a = rot + k / sides * Math.PI * 2; return at(o, f, Math.cos(a) * r, Math.sin(a) * r, c); });
    const lo = ring(0), hi = ring(h);
    this.face(hi, f.n);
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides, a = rot + (k + 0.5) / sides * Math.PI * 2;
      this.face([lo[k], lo[k1], hi[k1], hi[k]], [f.t1[0] * Math.cos(a) + f.t2[0] * Math.sin(a), f.t1[1] * Math.cos(a) + f.t2[1] * Math.sin(a), f.t1[2] * Math.cos(a) + f.t2[2] * Math.sin(a)]);
    }
  }
  /** A rivet's snap head: a low smooth dome of radius r and height h on the surface at `o`. */
  dome(o: V3, f: Frame, r: number, h: number, segs = 6): void {
    // rings: the base (on the surface), the shoulder, the crown; normals of a squashed sphere (smooth)
    const rings: {rr: number; y: number}[] = [{rr: r, y: 0}, {rr: r * 0.78, y: h * 0.72}];
    const base = this.pos.length / 3;
    const nAt = (rr: number, y: number, a: number): V3 => norm([Math.cos(a) * rr / (r * r), Math.sin(a) * rr / (r * r), y / (h * h)]);
    for (const {rr, y} of rings) for (let k = 0; k < segs; k++) {
      const a = k / segs * Math.PI * 2, nl = nAt(rr, y, a);
      this.vert(at(o, f, Math.cos(a) * rr, Math.sin(a) * rr, y), [f.t1[0] * nl[0] + f.t2[0] * nl[1] + f.n[0] * nl[2], f.t1[1] * nl[0] + f.t2[1] * nl[1] + f.n[1] * nl[2], f.t1[2] * nl[0] + f.t2[2] * nl[1] + f.n[2] * nl[2]]);
    }
    const top = this.vert(at(o, f, 0, 0, h), f.n);
    // t1 × t2 = n: counter-clockwise around n seen from outside
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs, a0 = base + k, a1 = base + k1, b0 = base + segs + k, b1 = base + segs + k1;
      this.idx.push(a0, a1, b1, a0, b1, b0, b0, b1, top);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Heights of the rivets of one row: every pitch from the base stiffeners up to under the head, none across the splice. */
export function rivetHeights(h: number): number[] {
  const R = STATION_COLUMN.rivet, S = STATION_COLUMN.splice, out: number[] = [];
  const spliced = h >= SPLICE_MIN_H;
  for (let y = R.from; y <= h - R.headClear + 1e-6; y += R.pitch) {
    if (spliced && y > S.y - 0.06 && y < S.y + S.h + 0.06) continue;
    out.push(+y.toFixed(4));
  }
  return out;
}

/** The whole column of height `h` (m) in its local frame (see STATION_COLUMN). */
export function stationColumnGeometry(h: number): THREE.BufferGeometry {
  const C = STATION_COLUMN, M = new Mesher();
  const hb = C.bf / 2, hd = C.d / 2, zf = hd - C.tf, xw = C.tw / 2, L = C.angleLeg, t = C.angleT;
  const yb = C.base.t, yc = h - C.cap.t;
  // ---- shaft: flanges, web, the four angles (between the base plate and the cap plate) -------------------------------------------
  // flange plates with their four long edges broken (C.chamfer): the edges catch the light along the column as a plate's do
  const e = C.chamfer;
  for (const s of [-1, 1]) {
    const zi = s * zf, zo = s * hd;
    M.extrudeY([[-hb + e, zi], [hb - e, zi], [hb, zi + s * e], [hb, zo - s * e], [hb - e, zo], [-hb + e, zo], [-hb, zo - s * e], [-hb, zi + s * e]], yb, yc);
  }
  M.box(-xw, xw, yb, yc, -zf, zf, '-y+y-z+z');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // flange leg (along the flange's inner face) and web leg (along the web), meeting at the heel in the corner
    const x0 = sx > 0 ? xw : -xw - L, x1 = sx > 0 ? xw + L : -xw;
    const zA0 = sz > 0 ? zf - t : -zf, zA1 = sz > 0 ? zf : -zf + t;
    M.box(x0, x1, yb, yc, zA0, zA1, `-y+y${sz > 0 ? '+z' : '-z'}${sx > 0 ? '-x' : '+x'}`);
    const xB0 = sx > 0 ? xw : -xw - t, xB1 = sx > 0 ? xw + t : -xw;
    const zB0 = sz > 0 ? zf - L : -zf, zB1 = sz > 0 ? zf - t : -zf + L;
    M.box(xB0, xB1, yb, yc, zB0, zB1, `-y+y${sx > 0 ? '-x' : '+x'}${sz > 0 ? '+z' : '-z'}`);
  }
  // ---- rivets ---------------------------------------------------------------------------------------------------------------------
  const R = C.rivet, ys = rivetHeights(h);
  const flangeX = xw + L * 0.55, webZ = zf - L * 0.55;
  for (const y of ys) {
    for (const s of [-1, 1]) for (const x of [-flangeX, flangeX]) M.dome([x, y, s * hd], FRAMES[s > 0 ? '+z' : '-z'], R.r, R.h);
    for (const s of [-1, 1]) for (const z of [-webZ, webZ]) M.dome([s * (xw + t), y, z], FRAMES[s > 0 ? '+x' : '-x'], R.r * 0.9, R.h * 0.9);
  }
  // ---- base -----------------------------------------------------------------------------------------------------------------------
  const B = C.base, hp = B.plate / 2;
  M.box(-hp, hp, 0, B.t, -hp, hp, '-y');
  for (const s of [-1, 1]) {
    // the stiffener across each channel (perpendicular to the web, at z = 0): tall at the web, clipped at the flange tips
    const xo = s * (hb - 0.012);
    M.plate([[s * xw, yb], [xo, yb], [xo, yb + 0.05], [s * xw, yb + B.stiffH]], 'x', -0.008, 0.008);
    // two anchor bolts each side of it: square washer, hex nut, the stud's end
    for (const z of [-B.anchorZ, B.anchorZ]) {
      const N = C.nut, x = s * B.anchorX, w = N.washer / 2;
      M.box(x - w, x + w, yb, yb + N.washerT, z - w, z + w, '-y');
      M.prism([x, yb + N.washerT, z], FRAMES['+y'], 6, N.af / Math.sqrt(3), N.h, Math.PI / 6);
      M.prism([x, yb + N.washerT + N.h, z], FRAMES['+y'], 8, N.stud, N.studH);
    }
    // gussets at the flange's foot (in the 3 cm of base plate outside it)
    for (const x of [-0.15, 0.15]) M.plate([[s * hd, yb], [s * (hp - 0.004), yb], [s * hd, yb + 0.13]], 'z', x - 0.006, x + 0.006);
  }
  // ---- eye-height splice: cover plates on the flanges and on the web in each channel, bolted -------------------------------------
  if (h >= SPLICE_MIN_H) {
    const S = C.splice, Bo = C.bolt, ct = C.coverT, wt = C.webCoverT;
    for (const s of [-1, 1]) {
      M.box(-0.2, 0.2, S.y, S.y + S.h, s > 0 ? hd : -hd - ct, s > 0 ? hd + ct : -hd, s > 0 ? '-z' : '+z');
      for (const x of [-0.14, 0.14]) for (const dy of [0.08, 0.21, 0.34]) M.prism([x, S.y + dy, s * (hd + ct)], FRAMES[s > 0 ? '+z' : '-z'], 6, Bo.af / Math.sqrt(3), Bo.h);
      const xi = s * xw, xo = s * (xw + wt), zw = zf - L - 0.006;
      M.box(Math.min(xi, xo), Math.max(xi, xo), S.y + 0.04, S.y + S.h - 0.04, -zw, zw, s > 0 ? '-x' : '+x');
      for (const z of [-0.05, 0.05]) for (const dy of [0.12, 0.3]) M.prism([xo, S.y + dy, z], FRAMES[s > 0 ? '+x' : '-x'], 6, Bo.af / Math.sqrt(3), Bo.h);
    }
  }
  // ---- head: cap plate, a bracket in each channel, a bolted cleat on each flange -------------------------------------------------
  const K = C.cap, hc = K.plate / 2;
  M.box(-hc, hc, yc, h, -hc, hc, '+y');
  for (const s of [-1, 1]) {
    M.plate([[s * xw, yc], [s * (hc - 0.006), yc], [s * xw, yc - K.bracketH]], 'x', -0.008, 0.008);
    const z0 = s > 0 ? hd : -hd - 0.012, z1 = s > 0 ? hd + 0.012 : -hd;
    M.box(-0.16, 0.16, yc - K.cleatH, yc, z0, z1, s > 0 ? '-z+y' : '+z+y');
    for (const x of [-0.09, 0.09]) M.prism([x, yc - K.cleatH * 0.5, s * (hd + 0.012)], FRAMES[s > 0 ? '+z' : '-z'], 6, C.bolt.af / Math.sqrt(3), C.bolt.h);
  }
  return M.geometry();
}

/**
 * A column of a level's OWN architecture, not a station column: the Bunker vault hall's colonnade (its own steelDark capitals and
 * beams, gen/bunker/v2/floor0Dress.ts vaultHall). Read from the layout as generated (no stored flag: saved stations draw the same).
 */
export function isLevelOwnColumn(layout: Pick<StationLayout, 'areas'> & {bunker?: unknown}, p: PropPlacement): boolean {
  return !!layout.bunker && layout.areas[p.area]?.label === F0_LABELS.vaultHall;
}

/** Height key (mm): columns of one height share a geometry. */
const heightKey = (h: number) => Math.round(h * 1000);

/**
 * Draws the station columns into `group`: one InstancedMesh (`prop-column`, material `mat`) per level, 48 m cohort and height.
 * Returns the instance count (one per column).
 */
export function buildStationColumns(group: THREE.Group, list: readonly PropPlacement[], mat: THREE.Material): number {
  if (!list.length) return 0;
  const geos = new Map<number, THREE.BufferGeometry>();
  const geoOf = (h: number) => {
    const k = heightKey(h);
    let g = geos.get(k);
    if (!g) geos.set(k, (g = stationColumnGeometry(k / 1000)));
    return g;
  };
  const cohorts = planCohorts(list, p => ({x: p.x, z: p.z, level: p.level ?? 0}), CHUNK_M, Infinity, false);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  for (const {list: cohort} of cohorts.values()) {
    const byH = new Map<number, PropPlacement[]>();
    for (const p of cohort) { const k = heightKey(p.h); const l = byH.get(k); if (l) l.push(p); else byH.set(k, [p]); }
    for (const [k, ps] of byH) {
      const im = new THREE.InstancedMesh(geoOf(k / 1000), mat, ps.length);
      ps.forEach((p, i) => im.setMatrixAt(i, m4.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(UP, p.rot), ONE)));
      im.name = 'prop-column';
      im.computeBoundingBox();
      im.computeBoundingSphere();
      group.add(im);
    }
  }
  return list.length;
}
