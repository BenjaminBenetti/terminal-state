// Task reactor-submit-roof-fog-20261102 (lane ROOF): THE PIT ROOF's STEEL under a SOLID slab with ONE round opening over the core.
// User: "the roof, is not looking correct … I want a single hole above the reactor not a totally open roof."
//
// Root cause (the previous build): the generator opened the whole pit top (levels[0].sky without a mask: no roof slab anywhere) and
// planRoof drew a bare row of I-beams spanning it against the green sky. Now (gen/reactor/roofOpening.ts): the roof line is solid
// except the opening's cells (rays), the SLAB is one mesh over the pit with a round hole (buildRoofSlab: the builder's dark concrete
// 'reactor-roof' surface material, one draw instead of the builder's per-level / per-chunk ceiling runs) and this plans the steel that
// carries it, as kit instances / two merged meshes (no new art payload: the kit's existing steel / concrete materials):
//  - PRIMARY GIRDERS spanning the short way ~6 m apart (the old grid's lines and section) and SECONDARY BEAMS across them ~3 m apart,
//    their tops just under the slab: a structural grid read from every tier. Each runs wall to wall inside the pit outline, TRIMMED at
//    the opening's curb ring (its end tucked into the ring girder: no beam crosses the hole) and clear of the crane trolley's body (the
//    approved crane is unchanged; the trolley tops out at the slab, so no member runs through it);
//  - the CURB: a closed steel ring girder under the slab round the opening (inner face on the opening radius, ROOF_OPENING.curb wide:
//    the grid's stepped hole edge hides above its box) and a 0.6 m concrete upstand above the slab — one lathe mesh per material.
// Instances join the kit's existing 'ibeam|steelDark' band-0 InstancedMesh (no new draw call); the curb adds two merged meshes.

import * as THREE from 'three';
import {ROOF_OPENING, roofOpeningOf, type RoofOpening} from '../../gen/reactor/roofOpening';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import type {KitPlan} from './archKit';

/** The roof steel tunables (m). */
export const ROOF_KIT = {
  /** Primary girders: pitch (the old open grid's), section width x depth. */
  girderPitch: 6, girderW: 0.4, girderD: 1.0,
  /** Secondary beams across the girders: pitch, section width x depth. */
  beamPitch: 3, beamW: 0.24, beamD: 0.5,
  /** Gap between the steel tops and the slab soffit (roofY). */
  gap: 0.05,
  /** A trimmed member's end tucks this far into the ring girder's outer face. */
  tuck: 0.3,
  /** Curb: the ring girder's depth under the slab (its width is ROOF_OPENING.curb), the concrete upstand's height / thickness. */
  ringD: 0.9, upstandH: 0.6, upstandT: 0.45,
  /** Lathe segments of the curb ring (chord error ~1 cm on a 8.4 m radius). */
  segments: 64,
  /** Crane trolley body half extents along / across the runway (the model's 4 x 2.42 m; the procedural box + drum fit) and clearance. */
  trolleyAlong: 2.05, trolleyAcross: 1.3, trolleyClear: 0.25,
  /** Shortest member piece kept. */
  minPiece: 0.6,
} as const;

/** What planPitRoof did (QA / tests). */
export interface RoofKitStats {
  opening: RoofOpening | null;
  girders: number;
  beams: number;
  /** Member lines cut at the curb ring / round the crane trolley. */
  trimmedAtCurb: number;
  trimmedAtCrane: number;
  /** The curb ring's merged meshes planned (steel ring girder + concrete upstand). */
  curb: boolean;
  /** World-space AABB (x / z) of the crane trolley keep-out (null: no crane). */
  trolley: {x0: number; z0: number; x1: number; z1: number} | null;
}

const stats = new WeakMap<KitPlan, RoofKitStats>();
/** The stats of planPitRoof on that plan (null: it never ran). */
export const roofKitStats = (plan: KitPlan): RoofKitStats | null => stats.get(plan) ?? null;

type Iv = [number, number];
/** Free intervals of [a, b] minus the open interval (c0, c1). */
function cut(list: Iv[], c0: number, c1: number): Iv[] {
  const out: Iv[] = [];
  for (const [p, q] of list) { if (c1 <= p || c0 >= q) out.push([p, q]); else { if (c0 > p) out.push([p, c0]); if (c1 < q) out.push([c1, q]); } }
  return out;
}
const span = (list: readonly Iv[]): number => list.reduce((s, [p, q]) => s + q - p, 0);

/**
 * The pit roof's steel (girders + secondary beams trimmed round the opening's curb and the crane trolley) and the curb ring, into the
 * kit plan. Called by world/reactor/archKit.ts planRoof (its 'roof' step: the instances carry the paths-audit tag 'roof').
 */
export function planPitRoof(plan: KitPlan): RoofKitStats {
  const {pit, crane} = plan.info, b = pit.bounds, Y = pit.roofY;
  const st: RoofKitStats = {opening: null, girders: 0, beams: 0, trimmedAtCurb: 0, trimmedAtCrane: 0, curb: false, trolley: null};
  stats.set(plan, st);
  if (!(pit.roofY > pit.rimY + 1.5)) return st;
  const o = roofOpeningOf(plan.info);
  st.opening = o;
  // (u, v): u along the girders (they span the SHORT way, as the old grid), v across them
  const alongX = b.x1 - b.x0 <= b.z1 - b.z0;
  const toUV = (x: number, z: number): [number, number] => (alongX ? [x, z] : [z, x]);
  const W = (u: number, y: number, v: number) => (alongX ? {x: u, y, z: v} : {x: v, y, z: u});
  const poly = pit.outline.map(p => toUV(p.x, p.z));
  const V0 = alongX ? b.z0 : b.x0, V1 = alongX ? b.z1 : b.x1, U0 = alongX ? b.x0 : b.z0, U1 = alongX ? b.x1 : b.z1;
  // the crane trolley's body (world AABB, the bridge at bridgeAt along the runway axis, the trolley at trolleyAt across it)
  if (crane && Math.abs(crane.a1 - crane.a0) > 2 && Math.abs(crane.b1 - crane.b0) > 2) {
    const ax = crane.axis === 'x', ha = ROOF_KIT.trolleyAlong + ROOF_KIT.trolleyClear, hb = ROOF_KIT.trolleyAcross + ROOF_KIT.trolleyClear;
    const cx = ax ? crane.bridgeAt : crane.trolleyAt, cz = ax ? crane.trolleyAt : crane.bridgeAt;
    st.trolley = {x0: cx - (ax ? ha : hb), z0: cz - (ax ? hb : ha), x1: cx + (ax ? ha : hb), z1: cz + (ax ? hb : ha)};
  }
  const tro = st.trolley ? (() => { const [a0, c0] = toUV(st.trolley!.x0, st.trolley!.z0), [a1, c1] = toUV(st.trolley!.x1, st.trolley!.z1); return {u0: Math.min(a0, a1), u1: Math.max(a0, a1), v0: Math.min(c0, c1), v1: Math.max(c0, c1)}; })() : null;
  const [ou, ov] = o ? toUV(o.x, o.z) : [0, 0];
  const Ro = o ? o.r + ROOF_OPENING.curb : 0;
  /**
   * The pieces of a member line: `across` = its coordinate across (v for a girder along u, u for a beam along v), `half` its half
   * width; spans inside the pit outline, minus the curb ring's chord and the trolley.
   */
  const pieces = (along: 'u' | 'v', across: number, half: number): Iv[] => {
    // inside the outline: crossings of the line with the polygon edges (even-odd pairs)
    const xs: number[] = [];
    const ci = along === 'u' ? 1 : 0, ai = along === 'u' ? 0 : 1, c = across + 1e-6;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[i], q = poly[j];
      if ((p[ci] > c) !== (q[ci] > c)) xs.push(p[ai] + ((c - p[ci]) / (q[ci] - p[ci])) * (q[ai] - p[ai]));
    }
    xs.sort((a, b) => a - b);
    let free: Iv[] = [];
    for (let k = 0; k + 1 < xs.length; k += 2) free.push([xs[k], xs[k + 1]]);
    if (o) {
      // the curb ring: the member's NEAR edge (closest to the centre) decides — cut at the ring girder's outer face, tucked in
      const oc = along === 'u' ? ov : ou, oa = along === 'u' ? ou : ov;
      const near = Math.max(0, Math.abs(across - oc) - half);
      if (near < Ro) {
        const e = Math.sqrt(Ro * Ro - near * near) - ROOF_KIT.tuck;
        if (e > 0) { const l0 = span(free); free = cut(free, oa - e, oa + e); if (span(free) < l0) st.trimmedAtCurb++; }
      }
    }
    if (tro) {
      const t0 = along === 'u' ? tro.v0 : tro.u0, t1 = along === 'u' ? tro.v1 : tro.u1;
      if (across + half > t0 && across - half < t1) {
        const l0 = span(free);
        free = along === 'u' ? cut(free, tro.u0, tro.u1) : cut(free, tro.v0, tro.v1);
        if (span(free) < l0) st.trimmedAtCrane++;
      }
    }
    return free.filter(([p, q]) => q - p >= ROOF_KIT.minPiece);
  };
  // primary girders (the old open grid's lines: the short span, ~6 m apart across the long side)
  const yG = Y - ROOF_KIT.gap - ROOF_KIT.girderD / 2;
  const nG = Math.max(1, Math.round((V1 - V0) / ROOF_KIT.girderPitch));
  for (let k = 1; k < nG; k++) {
    const v = V0 + ((V1 - V0) * k) / nG;
    for (const [p, q] of pieces('u', v, ROOF_KIT.girderW / 2)) if (plan.member('ibeam', 'steelDark', W(p, yG, v), W(q, yG, v), ROOF_KIT.girderW, ROOF_KIT.girderD)) st.girders++;
  }
  // secondary beams across them (~3 m apart along the span), tops flush with the girders'
  const yB = Y - ROOF_KIT.gap - ROOF_KIT.beamD / 2;
  const nB = Math.max(1, Math.round((U1 - U0) / ROOF_KIT.beamPitch));
  for (let k = 1; k < nB; k++) {
    const u = U0 + ((U1 - U0) * k) / nB;
    for (const [p, q] of pieces('v', u, ROOF_KIT.beamW / 2)) if (plan.member('ibeam', 'steelDark', W(u, yB, p), W(u, yB, q), ROOF_KIT.beamW, ROOF_KIT.beamD)) st.beams++;
  }
  plan.stats.roofBeams += st.girders + st.beams;
  // the curb ring round the opening: steel ring girder under the slab + concrete upstand above it (one lathe mesh per material)
  if (o) {
    const {steel, concrete} = curbGeometry(o, Y);
    plan.merged.push({mat: 'steelDark', geos: steel, band: plan.bandOf(Y - ROOF_KIT.ringD), name: 'reactor-roof-curb-steel'});
    plan.merged.push({mat: 'concrete', geos: concrete, band: plan.bandOf(Y - ROOF_KIT.ringD), name: 'reactor-roof-curb-concrete'});
    st.curb = true;
  }
  return st;
}

/** The slab's hole radius beyond the opening radius: inside the ring girder's box (hidden by it from below and from the opening). */
export const SLAB_HOLE_PAST = ROOF_OPENING.curb / 2;

/**
 * THE ROOF SLAB: ONE mesh (the builder's dark concrete 'reactor-roof' surface material, its UV scale) over the whole pit outline at
 * roofY, facing down, with a true round hole (radius + SLAB_HOLE_PAST) over the opening — or none without an opening. It replaces
 * the builder's per-level / per-48 m-chunk ceiling runs at the roof line (ReactorArch.ceilKey skips those: up to ~17 draws -> 1) and
 * also spans the open-well wall flights the builder never roofs. Tagged with every storey for the level culler (seen from them all
 * through the pit, like the sky dome). Null: no roof column.
 */
export function buildRoofSlab(info: Pick<ReactorInfo, 'pit' | 'core'>, material: THREE.Material, scale: {u: number; v: number}, levels: readonly number[]): THREE.Mesh | null {
  const p = info.pit;
  if (!(p.roofY > p.rimY + 1.5) || p.outline.length < 3) return null;
  const shape = new THREE.Shape(p.outline.map(q => new THREE.Vector2(q.x, q.z)));
  const o = roofOpeningOf(info);
  if (o) {
    const rh = o.r + SLAB_HOLE_PAST, n = ROOF_KIT.segments;
    shape.holes.push(new THREE.Path(Array.from({length: n}, (_, k) => new THREE.Vector2(o.x + Math.cos((k / n) * Math.PI * 2) * rh, o.z + Math.sin((k / n) * Math.PI * 2) * rh))));
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  // shape (x, z) in the XY plane facing +z -> world XZ at roofY facing down (rotateX +90 deg: (x, y, 0) -> (x, 0, y), +z -> -y)
  g.rotateX(Math.PI / 2);
  g.translate(0, p.roofY, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute; // (x, z) in metres -> the builder's ceilRect UVs (x / u, z / v)
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / scale.u, uv.getY(i) / scale.v);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.name = 'reactor-arch-roof';
  m.userData.levels = [...levels];
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/**
 * The curb ring's faces in world space (lathe bands, flat-shaded per face; each faces out of the solid): the steel ring girder — inner
 * face on the opening radius from the girder's bottom to the slab, its bottom flange plate out to radius + ROOF_OPENING.curb, its outer
 * face — and the concrete upstand above the slab: inner face (continuing the girder's), top, outer face.
 */
export function curbGeometry(o: RoofOpening, roofY: number): {steel: THREE.BufferGeometry[]; concrete: THREE.BufferGeometry[]} {
  const R = o.r, Ro = o.r + ROOF_OPENING.curb, yb = roofY - ROOF_KIT.ringD, yt = roofY + ROOF_KIT.upstandH, Rt = o.r + ROOF_KIT.upstandT;
  // a lathe band from p0 to p1 (radius, y): three's LatheGeometry faces (dy, -dx) — ascending = outward, outward-going = downward
  const band = (r0: number, y0: number, r1: number, y1: number) =>
    new THREE.LatheGeometry([new THREE.Vector2(r0, y0), new THREE.Vector2(r1, y1)], ROOF_KIT.segments).translate(o.x, 0, o.z);
  return {
    steel: [band(R, roofY, R, yb), band(R, yb, Ro, yb), band(Ro, yb, Ro, roofY)],
    concrete: [band(R, yt, R, roofY), band(Rt, yt, R, yt), band(Rt, roofY, Rt, yt)],
  };
}
