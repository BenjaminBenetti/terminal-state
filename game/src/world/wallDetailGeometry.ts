// Iteration 08 (Lane W): geometry for the planned wall treatment (world/wallDetailPlan.ts).
//
// - Flush finishes, decals and soft stains: quads on the face plane at small stand-offs (layered
//   0.8 / 1.6 / 2.4 mm, plus per-material polygon offset), UVs into the shared atlases, tints as
//   vertex colours. Tiled finishes are split on their cell period from an origin aligned to the base
//   finish's world grid, so their joints meet the wall's.
// - Cuts (missing tiles, spalls, breaches): the cut outline is subtracted from the ONE base-wall
//   quad that contains it (the builder's merged wall meshes are re-triangulated around the hole with
//   earcut; every attribute interpolated over the quad), and a closed inset prism (sides + back) is
//   built behind the plane on exactly the same outline vertices: watertight, no gap / light leak, and
//   it stays inside the solid wall, so collision is unchanged. Rim rings, exposed rebar and rubble
//   finish breaches.
// - Proud service fittings: conduits, pipes, tunnel cables (cylinders), brackets and boxes.
// Everything is accumulated per material into a handful of merged meshes for the whole station.

import * as THREE from 'three';
import type {WallFace} from './wallFaces';
import {faceFrame} from './wallDetailFaces';
import type {Feature, PlannedFace} from './wallDetailPlan';
import {atlasCells, type AtlasCell, type CellRect} from './wallDetailAtlas';
import {mulberry32} from '../core/rng';

/** Stand-off from the wall plane per layer (m). Damage craters sit at 4 mm (damage/craters.ts). */
export const LAYER_OFFSET = {flush: 0.0008, decal: 0.0016, soft: 0.0024} as const;

export type DetailMat = 'flush' | 'frieze' | 'decal' | 'soft' | 'cavity' | 'steel' | 'rust' | 'cable';

/** Growable vertex / index buffers for one material (position, normal, uv, colour). */
export class Buf {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  get verts(): number { return this.pos.length / 3; }
  vert(p: readonly number[], n: readonly number[], u: number, v: number, c: readonly number[] = WHITE): number {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(u, v); this.col.push(c[0], c[1], c[2]);
    return this.verts - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  /** Append another buffer (all-or-nothing building of composite features). */
  append(o: Buf): void {
    const base = this.verts;
    for (const v of o.pos) this.pos.push(v);
    for (const v of o.nor) this.nor.push(v);
    for (const v of o.uv) this.uv.push(v);
    for (const v of o.col) this.col.push(v);
    for (const i of o.idx) this.idx.push(base + i);
  }
  /** Merge a three geometry (position/normal/uv; indexed or not) with a constant colour. */
  geo(g: THREE.BufferGeometry, c: readonly number[] = WHITE): void {
    const base = this.verts;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) this.vert([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, c);
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.verts > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const WHITE = [1, 1, 1] as const;

/** Face frame helpers: s along the face, screen handedness (+1: s increases to the viewer's right). */
export interface Frame { f: WallFace; len: number; tx: number; tz: number; n: [number, number, number]; handed: number; axis: 'x' | 'z'; c0: number; dir: number; plane: number }
export function frameOf(pf: PlannedFace): Frame {
  const f = pf.face, {len, tx, tz} = faceFrame(f);
  return {f, len, tx, tz, n: [f.nx, 0, f.nz], handed: tx * f.nz - tz * f.nx >= 0 ? 1 : -1, axis: pf.axis, c0: pf.c0, dir: pf.dir, plane: pf.axis === 'z' ? f.z0 : f.x0};
}
/** World point (exact: the plane coordinate is never recomputed from s). */
export function pt(F: Frame, s: number, y: number, off = 0): [number, number, number] {
  const c = F.c0 + s * F.dir;
  return F.axis === 'z' ? [c, y, F.plane + F.f.nz * off] : [F.plane + F.f.nx * off, y, c];
}
/** World point from the plane axis coordinate c directly. */
export function ptc(F: Frame, c: number, y: number, off = 0): [number, number, number] {
  return F.axis === 'z' ? [c, y, F.plane + F.f.nz * off] : [F.plane + F.f.nx * off, y, c];
}

/** Atlas UV for a cell-local position (mu, mv in metres from the cell's bottom-left). */
function cellUv(r: CellRect, mu: number, mv: number): [number, number] {
  const u = Math.min(1, Math.max(0, mu / r.mw)), v = Math.min(1, Math.max(0, mv / r.mh));
  return [r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v];
}

/** Emit a quad on the face plane (s0..s1 x y0..y1) with the given corner UVs (uv at s0/s1 by y0/y1). */
function planeQuad(buf: Buf, F: Frame, s0: number, s1: number, y0: number, y1: number, off: number, uv: (s: number, y: number) => [number, number], col: readonly number[]): void {
  const a = buf.vert(pt(F, s0, y0, off), F.n, ...uv(s0, y0), col);
  const b = buf.vert(pt(F, s1, y0, off), F.n, ...uv(s1, y0), col);
  const c = buf.vert(pt(F, s1, y1, off), F.n, ...uv(s1, y1), col);
  const d = buf.vert(pt(F, s0, y1, off), F.n, ...uv(s0, y1), col);
  // (s, y) counter-clockwise is front-facing when s runs to the viewer's right.
  if (F.handed > 0) { buf.tri(a, b, c); buf.tri(a, c, d); } else { buf.tri(a, c, b); buf.tri(a, d, c); }
}

/** Cells drawn as one object scaled to the feature (others tile on their real size). */
const FIT = new Set<string>(['crackA', 'crackB', 'streakA', 'streakB', 'streakC', 'efflor', 'blot', 'paintPatch', 'concretePatch']);
/** Cells whose content hangs from the top edge (cropped from the top when shorter). */
const TOP_ANCHOR = new Set<string>(['soot']);

/**
 * Flat feature (flush / decal / soft): split on its cell period from the aligned origin; u runs with
 * world c for grid-aligned features (tile / block patterns are mirror-symmetric) and to the viewer's
 * right otherwise (text, directional chips).
 */
export function flatFeature(buf: Buf, F: Frame, ft: Feature, off: number, frieze?: CellRect): number {
  const cells = atlasCells();
  const r: CellRect | undefined = ft.cell === 'frieze' ? frieze : ft.cell ? cells[ft.cell as AtlasCell] : undefined;
  if (!r) return 0;
  const col = ft.tint ?? WHITE;
  let flip = !!ft.flip;
  if (ft.kind === 'cornerChips') {
    // Chips are drawn on the cell's left edge: mirror when the corner is on the viewer's right.
    const atStart = ft.s0 < F.len / 2;
    flip = atStart ? F.handed < 0 : F.handed > 0;
  }
  const fit = ft.cell === 'frieze' || FIT.has(ft.cell as string);
  // q: horizontal texture coordinate (m) as an affine function of s.
  const aligned = !!ft.grid?.pu;
  const qA = aligned ? F.dir : F.handed, qB = aligned ? F.c0 : 0;
  const q0 = Math.min(qA * ft.s0 + qB, qA * ft.s1 + qB), q1 = Math.max(qA * ft.s0 + qB, qA * ft.s1 + qB);
  const sOfQ = (q: number) => (q - qB) / qA;
  if (fit) {
    planeQuad(buf, F, ft.s0, ft.s1, ft.y0, ft.y1, off, (s, y) => {
      let u = ((qA * s + qB) - q0) / (q1 - q0 || 1);
      if (flip) u = 1 - u;
      return cellUv(r, u * r.mw, (y - ft.y0) / (ft.y1 - ft.y0 || 1) * r.mh);
    }, col);
    return 1;
  }
  const g = ft.grid;
  const qo = g?.pu ? alignDown(q0, g.pu, g.ou) : q0;
  const yo = g?.pv ? alignDown(ft.y0, g.pv, g.ov) : TOP_ANCHOR.has(ft.cell as string) ? ft.y1 - r.mh * Math.ceil((ft.y1 - ft.y0) / r.mh - 1e-6) : ft.y0;
  let quads = 0;
  for (let qa = qo + Math.floor((q0 - qo) / r.mw + 1e-9) * r.mw; qa < q1 - 1e-6; qa += r.mw) {
    const pa = Math.max(q0, qa), pb = Math.min(q1, qa + r.mw);
    if (pb - pa < 1e-4) continue;
    for (let ya = yo + Math.floor((ft.y0 - yo) / r.mh + 1e-9) * r.mh; ya < ft.y1 - 1e-6; ya += r.mh) {
      const y0 = Math.max(ft.y0, ya), y1 = Math.min(ft.y1, ya + r.mh);
      if (y1 - y0 < 1e-4) continue;
      const sa = sOfQ(pa), sb = sOfQ(pb);
      planeQuad(buf, F, Math.min(sa, sb), Math.max(sa, sb), y0, y1, off, (s, y) => {
        let mu = (qA * s + qB) - qa;
        if (flip) mu = r.mw - mu;
        return cellUv(r, mu, y - ya);
      }, col);
      quads++;
    }
  }
  return quads;
}

/** Largest value <= x on the grid {o + k p}. */
export function alignDown(x: number, p: number, o: number): number {
  return o + Math.floor((x - o) / p + 1e-6) * p;
}

// ---------------------------------------------------------------------------------------------
// Cuts: base-wall subtraction + inset prisms

/** A cut in world terms: plane, outward normal sign and the outline in (c, y) (counter-clockwise). */
export interface CutSpec {
  axis: 'x' | 'z';
  plane: number;
  nSign: number;
  poly: [number, number][];
  /** Outline is valid when it lies inside exactly one base-wall quad; filled in by cutBaseWalls. */
  applied?: boolean;
}

interface WallQuad { mesh: THREE.Mesh; q: number; c0: number; c1: number; y0: number; y1: number; corner: [number, number, number, number] }

const planeKey = (axis: 'x' | 'z', plane: number, nSign: number) => (Math.round(plane * 1000) * 2 + (nSign > 0 ? 1 : 0)) * 2 + (axis === 'z' ? 1 : 0);

/**
 * Index the vertical, axis-aligned rectangular quads (builder Accum layout: 4 vertices, indices
 * a a+1 a+2 a a+2 a+3) of the candidate meshes that lie on one of the `needed` planes.
 */
function indexWallQuads(meshes: THREE.Mesh[], needed: Set<number>): Map<number, WallQuad[]> {
  const out = new Map<number, WallQuad[]>();
  for (const mesh of meshes) {
    const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, I = g.index;
    if (!I || !P || !N || P.itemSize !== 3 || N.itemSize !== 3 || (P as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const pa = P.array as ArrayLike<number>, na = N.array as ArrayLike<number>, ia = I.array as ArrayLike<number>;
    for (let q = 0; q * 6 + 5 < I.count; q++) {
      const o = q * 6, a = ia[o];
      if (ia[o + 1] !== a + 1 || ia[o + 2] !== a + 2 || ia[o + 3] !== a || ia[o + 4] !== a + 2 || ia[o + 5] !== a + 3) continue;
      const nx = na[a * 3], ny = na[a * 3 + 1], nz = na[a * 3 + 2];
      if (Math.abs(ny) > 1e-3) continue;
      const axis: 'x' | 'z' | null = Math.abs(nz) > 0.999 ? 'z' : Math.abs(nx) > 0.999 ? 'x' : null;
      if (!axis) continue;
      const ci = axis === 'z' ? 0 : 2, pi = axis === 'z' ? 2 : 0;
      const plane = pa[a * 3 + pi];
      const key = planeKey(axis, plane, axis === 'z' ? nz : nx);
      if (!needed.has(key)) continue;
      let ok = true, c0 = Infinity, c1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const v = (a + k) * 3;
        if (Math.abs(pa[v + pi] - plane) > 1e-5) { ok = false; break; }
        c0 = Math.min(c0, pa[v + ci]); c1 = Math.max(c1, pa[v + ci]); y0 = Math.min(y0, pa[v + 1]); y1 = Math.max(y1, pa[v + 1]);
      }
      if (!ok) continue;
      // Must be an exact rectangle (sloped stair walls are trapezoids: not cuttable).
      for (let k = 0; k < 4 && ok; k++) {
        const v = (a + k) * 3, cc = pa[v + ci], yy = pa[v + 1];
        if ((Math.abs(cc - c0) > 1e-5 && Math.abs(cc - c1) > 1e-5) || (Math.abs(yy - y0) > 1e-5 && Math.abs(yy - y1) > 1e-5)) ok = false;
      }
      if (!ok || c1 - c0 < 1e-4 || y1 - y0 < 1e-4) continue;
      let l = out.get(key);
      if (!l) out.set(key, (l = []));
      l.push({mesh, q, c0, c1, y0, y1, corner: [a, a + 1, a + 2, a + 3]});
    }
  }
  return out;
}

/**
 * Subtract every cut outline from the base-wall quad that strictly contains it (margin 5 mm); cuts
 * with no such quad are marked not applied (their inset is then skipped by the caller). Affected
 * meshes get a rebuilt geometry: untouched quads verbatim, cut quads re-triangulated with holes.
 */
export function cutBaseWalls(meshes: THREE.Mesh[], cuts: CutSpec[]): {applied: number; rejected: number; meshes: number; triangles: number} {
  return prepareCuts(meshes, cuts).commit();
}

/**
 * Two-phase cutting: assign every cut its host quad (sets `applied`) without touching any mesh; the
 * caller builds the insets, may withdraw cuts (applied = false), then `commit()` rebuilds the meshes
 * for the cuts still applied. A failure before commit leaves every wall intact.
 */
export function prepareCuts(meshes: THREE.Mesh[], cuts: CutSpec[]): {commit(): {applied: number; rejected: number; meshes: number; triangles: number}} {
  const quads = indexWallQuads(meshes, new Set(cuts.map(c => planeKey(c.axis, c.plane, c.nSign))));
  const byQuad = new Map<WallQuad, CutSpec[]>();
  let rejected = 0;
  for (const cut of cuts) {
    let c0 = Infinity, c1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [c, y] of cut.poly) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const list = quads.get(planeKey(cut.axis, cut.plane, cut.nSign)) ?? [];
    const M = 0.005;
    const host = list.find(q => c0 > q.c0 + M && c1 < q.c1 - M && y0 > q.y0 + M && y1 < q.y1 - M);
    const clash = host && (byQuad.get(host) ?? []).some(o => bboxOverlap(o.poly, cut.poly));
    if (!host || clash) { cut.applied = false; rejected++; continue; }
    cut.applied = true;
    let l = byQuad.get(host);
    if (!l) byQuad.set(host, (l = []));
    l.push(cut);
  }
  return {commit: () => {
  const perMesh = new Map<THREE.Mesh, Map<number, {quad: WallQuad; cuts: CutSpec[]}>>();
  for (const [q, all] of byQuad) {
    const cs = all.filter(c => c.applied);
    if (!cs.length) continue;
    let m = perMesh.get(q.mesh);
    if (!m) perMesh.set(q.mesh, (m = new Map()));
    m.set(q.q, {quad: q, cuts: cs});
  }
  rejected = cuts.filter(c => !c.applied).length;
  let triangles = 0;
  for (const [mesh, cutQuads] of perMesh) {
    try { triangles += rebuildWithHoles(mesh, cutQuads); } catch (e) {
      // Keep the wall intact; its insets are skipped.
      for (const {cuts: cs} of cutQuads.values()) for (const c of cs) { if (c.applied) rejected++; c.applied = false; }
      console.warn('wall detail: could not cut wall mesh', mesh.name, e);
    }
  }
  return {applied: cuts.filter(c => c.applied).length, rejected, meshes: perMesh.size, triangles};
  }};
}

function bboxOverlap(a: [number, number][], b: [number, number][]): boolean {
  const bb = (p: [number, number][]) => p.reduce((r, [c, y]) => [Math.min(r[0], c), Math.max(r[1], c), Math.min(r[2], y), Math.max(r[3], y)], [Infinity, -Infinity, Infinity, -Infinity]);
  const [a0, a1, a2, a3] = bb(a), [b0, b1, b2, b3] = bb(b);
  return a0 < b1 && a1 > b0 && a2 < b3 && a3 > b2;
}

function rebuildWithHoles(mesh: THREE.Mesh, cutQuads: Map<number, {quad: WallQuad; cuts: CutSpec[]}>): number {
  const g = mesh.geometry;
  const I = g.index!;
  const names = Object.keys(g.attributes);
  const src = names.map(n => g.attributes[n] as THREE.BufferAttribute);
  const data: number[][] = src.map(a => Array.from(a.array as ArrayLike<number>));
  const idx: number[] = [];
  let added = 0;
  const P = g.attributes.position;
  for (let q = 0; q * 6 < I.count; q++) {
    const hit = cutQuads.get(q);
    if (!hit) { for (let k = q * 6; k < Math.min(I.count, q * 6 + 6); k++) idx.push(I.getX(k)); continue; }
    const {quad} = hit;
    const axis = hit.cuts[0].axis;
    const pc = (i: number) => (axis === 'z' ? P.getX(i) : P.getZ(i));
    // Bilinear attribute interpolation over the rectangle (exact for affine attributes).
    const cornerAt = (c: number, y: number) => quad.corner.find(i => Math.abs(pc(i) - c) < 1e-5 && Math.abs(P.getY(i) - y) < 1e-5)!;
    const cBL = cornerAt(quad.c0, quad.y0), cBR = cornerAt(quad.c1, quad.y0), cTR = cornerAt(quad.c1, quad.y1), cTL = cornerAt(quad.c0, quad.y1);
    const contour: [number, number][] = [[quad.c0, quad.y0], [quad.c1, quad.y0], [quad.c1, quad.y1], [quad.c0, quad.y1]];
    const holes = hit.cuts.map(c => ccw(c.poly).slice().reverse());
    const all = [...contour, ...holes.flat()];
    const base = data[0].length / 3;
    for (const [c, y] of all) {
      const u = (c - quad.c0) / (quad.c1 - quad.c0), v = (y - quad.y0) / (quad.y1 - quad.y0);
      src.forEach((a, ai) => {
        const k = a.itemSize, d = data[ai];
        for (let j = 0; j < k; j++) {
          const bl = a.getComponent(cBL, j), br = a.getComponent(cBR, j), tr = a.getComponent(cTR, j), tl = a.getComponent(cTL, j);
          d.push((bl * (1 - u) + br * u) * (1 - v) + (tl * (1 - u) + tr * u) * v);
        }
      });
      // Positions: exact plane and the exact outline coordinates (shared bit-for-bit with the inset prism).
      const pd = data[names.indexOf('position')], o = pd.length - 3;
      if (axis === 'z') { pd[o] = c; pd[o + 1] = y; pd[o + 2] = P.getZ(cBL); } else { pd[o] = P.getX(cBL); pd[o + 1] = y; pd[o + 2] = c; }
    }
    // Facing of the original quad in (c, y): keep it for every new triangle.
    const orient = Math.sign(area2(pc(I.getX(q * 6)), P.getY(I.getX(q * 6)), pc(I.getX(q * 6 + 1)), P.getY(I.getX(q * 6 + 1)), pc(I.getX(q * 6 + 2)), P.getY(I.getX(q * 6 + 2)))) || 1;
    const tris = THREE.ShapeUtils.triangulateShape(contour.map(([c, y]) => new THREE.Vector2(c, y)), holes.map(h => h.map(([c, y]) => new THREE.Vector2(c, y))));
    for (const [a, b, c] of tris) {
      const s = Math.sign(area2(all[a][0], all[a][1], all[b][0], all[b][1], all[c][0], all[c][1]));
      if (s === 0) continue;
      if (s === orient) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
      added++;
    }
    added -= 2;
  }
  const ng = new THREE.BufferGeometry();
  src.forEach((a, ai) => ng.setAttribute(names[ai], new THREE.Float32BufferAttribute(data[ai], a.itemSize, a.normalized)));
  const nv = data[names.indexOf('position')].length / 3;
  ng.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  ng.computeBoundingSphere();
  ng.computeBoundingBox();
  g.dispose();
  mesh.geometry = ng;
  return added;
}

const area2 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
/** Counter-clockwise copy of a polygon. */
export function ccw(p: [number, number][]): [number, number][] {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return a < 0 ? p.slice().reverse() : p;
}

/** Outline of a cut feature in world (c, y), counter-clockwise. */
export function cutPolyC(F: Frame, ft: Feature): [number, number][] {
  return ccw(ft.outline!.map(([s, y]) => [F.c0 + s * F.dir, y] as [number, number]));
}

/**
 * Inset prism behind the plane on the cut outline: side walls (u along the outline, v = depth) and
 * the back (triangulated outline at -depth). Vertex colours carry baked occlusion (darker with depth).
 */
export function insetPrism(buf: Buf, F: Frame, poly: [number, number][], depth: number, back: CellRect, side: CellRect, grid: Feature['grid'], ao: {front: number; back: number}): void {
  const n = F.n;
  // Sides (poly is counter-clockwise in (c, y): the hole interior is on the left of every edge).
  let acc = 0;
  for (let i = 0; i < poly.length; i++) {
    const [c0, y0] = poly[i], [c1, y1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(c1 - c0, y1 - y0);
    if (len < 1e-6) continue;
    // In-plane edge normal pointing into the hole.
    const ec = -(y1 - y0) / len, ey = (c1 - c0) / len;
    const nrm: [number, number, number] = F.axis === 'z' ? [ec, ey, 0] : [0, ey, ec];
    const u0 = pingpong(acc / side.mw), u1 = pingpong((acc + len) / side.mw);
    acc += len;
    const vb = Math.min(1, depth / side.mh);
    const cf = [ao.front, ao.front, ao.front], cb = [ao.back, ao.back, ao.back];
    const a = buf.vert(ptc(F, c0, y0, 0), nrm, ...lerpUv(side, u0, 0), cf);
    const b = buf.vert(ptc(F, c1, y1, 0), nrm, ...lerpUv(side, u1, 0), cf);
    const c = buf.vert(ptc(F, c1, y1, -depth), nrm, ...lerpUv(side, u1, vb), cb);
    const d = buf.vert(ptc(F, c0, y0, -depth), nrm, ...lerpUv(side, u0, vb), cb);
    frontTris(buf, [a, b, c, d], nrm);
  }
  // Back.
  let c0 = Infinity, y0 = Infinity, c1 = -Infinity, y1 = -Infinity;
  for (const [c, y] of poly) { c0 = Math.min(c0, c); y0 = Math.min(y0, y); c1 = Math.max(c1, c); y1 = Math.max(y1, y); }
  let oc = grid?.pu ? alignDown(c0, grid.pu, grid.ou) : c0, oy = grid?.pv ? alignDown(y0, grid.pv, grid.ov) : y0;
  if (c1 - oc > back.mw) oc = c0;
  if (y1 - oy > back.mh) oy = y0;
  const sc = Math.max(1, (c1 - oc) / back.mw), sy = Math.max(1, (y1 - oy) / back.mh);
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(([c, y]) => new THREE.Vector2(c, y)), []);
  const cb = [ao.back, ao.back, ao.back];
  const ids = poly.map(([c, y]) => buf.vert(ptc(F, c, y, -depth), n, ...cellUv(back, (c - oc) / sc, (y - oy) / sy), cb));
  for (const [a, b, c] of tris) frontTris(buf, [ids[a], ids[b], ids[c]], n);
}

const pingpong = (x: number) => { const t = x - 2 * Math.floor(x / 2); return t > 1 ? 2 - t : t; };
const lerpUv = (r: CellRect, u: number, v: number): [number, number] => [r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v];

/** Add a triangle fan (3 or 4 vertex ids) wound so its geometric normal agrees with `nrm`. */
function frontTris(buf: Buf, ids: number[], nrm: readonly number[]): void {
  const p = (i: number) => [buf.pos[i * 3], buf.pos[i * 3 + 1], buf.pos[i * 3 + 2]];
  const A = p(ids[0]), B = p(ids[1]), C = p(ids[2]);
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  const ok = cx * nrm[0] + cy * nrm[1] + cz * nrm[2] >= 0;
  for (let k = 1; k + 1 < ids.length; k++) {
    if (ok) buf.tri(ids[0], ids[k], ids[k + 1]); else buf.tri(ids[0], ids[k + 1], ids[k]);
  }
}

/**
 * Rim ring around a star-shaped cut (on the wall, decal layer): every outline vertex pushed radially
 * out from the star centre (cx, cy) by w0..w1, so ring quads stay in their own angular wedge (no
 * overlapping coplanar triangles).
 */
export function rimRing(buf: Buf, F: Frame, poly: [number, number][], center: [number, number], cell: CellRect, w0: number, w1: number, seed: number, off: number): void {
  const rnd = mulberry32(seed);
  const [cx, cy] = center;
  const outer = poly.map(([c, y]) => {
    const dc = c - cx, dy = y - cy, l = Math.hypot(dc, dy) || 1, w = w0 + (w1 - w0) * (0.5 + 0.5 * Math.sin(Math.atan2(dy, dc) * 3 + seed) * 0.6 + 0.4 * rnd() - 0.2);
    return [c + dc / l * w, y + dy / l * w] as [number, number];
  });
  let c0 = Infinity, y0 = Infinity, c1 = -Infinity, y1 = -Infinity;
  for (const [c, y] of outer) { c0 = Math.min(c0, c); y0 = Math.min(y0, y); c1 = Math.max(c1, c); y1 = Math.max(y1, y); }
  const sc = Math.max(1, (c1 - c0) / cell.mw), sy = Math.max(1, (y1 - y0) / cell.mh);
  const uv = (c: number, y: number) => cellUv(cell, (c - c0) / sc, (y - y0) / sy);
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const ids = [poly[i], poly[j], outer[j], outer[i]].map(([c, y]) => buf.vert(ptc(F, c, y, off), F.n, ...uv(c, y)));
    frontTris(buf, ids, F.n);
  }
}

// ---------------------------------------------------------------------------------------------
// Proud fittings and breach extras

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

/** Longest triangle edge the detail geometry may have (long runs are split; no long slivers). */
export const MAX_SPAN = 4;

/** Cylinder between two world points (split into <= MAX_SPAN lengths). */
export function cylinder(buf: Buf, a: readonly number[], b: readonly number[], r: number, seg = 8, col: readonly number[] = WHITE): void {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.CylinderGeometry(r, r, len, seg, Math.max(1, Math.ceil(len / MAX_SPAN)), false);
  tmpQ.setFromUnitVectors(UPV, d.normalize());
  tmpM.compose(tmpV.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), tmpQ, tmpS.set(1, 1, 1));
  g.applyMatrix4(tmpM);
  buf.geo(g, col);
}

/** Axis-aligned (in the face frame) box: centre at (s, y), stand-off `off` (centre depth), sizes along s / y / normal. */
export function faceBox(buf: Buf, F: Frame, s: number, y: number, off: number, ws: number, hy: number, dn: number, col: readonly number[] = WHITE): void {
  const p = pt(F, s, y, off);
  aabb(buf, p, F.axis === 'z' ? ws / 2 : dn / 2, hy / 2, F.axis === 'z' ? dn / 2 : ws / 2, col, F.n);
}

/**
 * World axis-aligned box written straight into the buffer (no intermediate geometry); the face
 * against the wall (normal -`back`) is skipped when `back` is given (it is never visible).
 */
function aabb(buf: Buf, c: readonly number[], hx: number, hy: number, hz: number, col: readonly number[], back?: readonly number[]): void {
  for (let axis = 0; axis < 3; axis++) for (const sgn of [-1, 1]) {
    const n = [0, 0, 0]; n[axis] = sgn;
    if (back && n[0] === -back[0] && n[1] === -back[1] && n[2] === -back[2]) continue;
    const u = axis === 0 ? 2 : 0, v = axis === 1 ? 2 : 1;
    const h = [hx, hy, hz];
    const corner = (a: number, b: number) => { const q = [c[0], c[1], c[2]]; q[axis] += sgn * h[axis]; q[u] += a * h[u]; q[v] += b * h[v]; return q; };
    const ids = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map((q, k) => buf.vert(q, n, k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0, col));
    frontTris(buf, ids, n);
  }
}

/** How far (m) in front of the wall face a breach's rubble may reach (its chunks' far sides). */
export const RUBBLE_REACH = 0.32;

/** Rubble at the foot of a breach: small rotated chunks on the floor in front of it (within RUBBLE_REACH of the face). */
export function rubble(buf: Buf, F: Frame, s0: number, s1: number, floorY: number, n: number, seed: number, cell: CellRect): void {
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const sz = 0.025 + rnd() * 0.06;
    const g = new THREE.BoxGeometry(sz * (0.8 + rnd() * 0.8), sz * (0.4 + rnd() * 0.5), sz * (0.8 + rnd() * 0.7));
    const uv = g.attributes.uv;
    const ou = rnd() * 0.7, ov = rnd() * 0.7;
    for (let k = 0; k < uv.count; k++) { const [u, v] = lerpUv(cell, ou + uv.getX(k) * 0.25, ov + uv.getY(k) * 0.25); uv.setXY(k, u, v); }
    g.rotateY(rnd() * Math.PI);
    g.rotateX((rnd() - 0.5) * 0.5);
    g.rotateZ((rnd() - 0.5) * 0.5);
    g.computeBoundingBox();
    const bb = g.boundingBox!, lift = -bb.min.y;
    // (round 3, lane LAYOUT: a chunk's far side stays within RUBBLE_REACH of the wall — the stand-off used to be drawn up to 0.35 m
    // before the chunk's own half-size, so a rare draw lay ~0.4 m out, off the wall's footprint; same draws, clamped)
    const half = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
    const s = s0 + (s1 - s0) * rnd(), off = Math.min(0.05 + rnd() * rnd() * 0.3, RUBBLE_REACH - half);
    const p = pt(F, s, floorY + lift * 0.85, off);
    g.translate(p[0], p[1], p[2]);
    const k = 0.6 + rnd() * 0.35;
    buf.geo(g, [k, k, k * 0.97]);
  }
}
