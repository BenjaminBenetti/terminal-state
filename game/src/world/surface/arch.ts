// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): THE SURFACE ARCH — the finish mapper and facade builder of a
// Surface Run district layout (the builder's arch chain asks SurfaceArch exactly like OfficeArch / MallArch / ReactorArch / SkywaysArch /
// MarketArch / BunkerArch on their levels; null on every other layout — gated on `layout.surface`).
//
//  - FLOORS: the plan's ground class per cell (asphalt carriageway, concrete sidewalk slabs, lots, paved plazas, yards, the checkpoint
//    compound, the tent's boards, the cordon verge) and each building's interior floor by programme (archStyles.ts INTERIOR_LOOKS);
//  - CEILINGS: none outdoors (open sky; drawn = -1 for the enhanced bake), the programme's ceiling indoors, none over the tent (its
//    pitched roof is drawn here);
//  - WALLS (remapFaces): the outdoor faces of each building take its facade (style + tint), clipped to its roof line (the ruin profile
//    of a damaged / gutted / collapsed building), its decorative windows cut out of the OUTER face, GEN's live window spans (AIR's
//    panes) cut out of BOTH wall planes at their sill / head (never glazed here); interior faces take the programme's walls; the
//    SOLID boundary ring becomes the cordon wall (3.4 m), other SOLID debris a low barrier, the tent's carved walls its canvas;
//  - BUILD (buildSteps): window reveals, dark rooms behind decorative panes (glass / broken / boarded / shutter), AIR span reveals +
//    frames + sills (NO glass), door frames, boarded doors, fascia signs (runtime text atlas), cornices, string courses, copings,
//    parapets, roof decks, the step faces of ruined tops, scorch, fire escapes, the cordon coping, the command tent (canvas walls,
//    pitched roof, guy lines, the door flap as its own object: AIR's open / closed seam, setTentFlap).
// Geometry merges per (material, 96 m cell: SURFACE_CHUNK) on level 0 (the culler's distance + frustum work per cell); roof-top
// surfaces stand on SOLID columns (no light-field slot there) and use the outdoor look (lookSky.ts: overcast hemisphere + scene fog).
// Follow-up 1 (draws): the facade wall families and the trims draw through their family's SHARED tinted material (archMaterials.ts
// surfaceTintFamily: one material per family, the building's tint in a 'color' attribute), so a 96 m cell holds one mesh per family —
// LOOK's own parts and the builder's walls (coarsenSurfaceArch) alike — instead of one per building tint.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {CELL} from '../../gen/grid';
import type {Level} from '../../gen/levels';
import type {Area, Side, StationLayout} from '../../gen/stationTypes';
import type {BuiltFace} from '../levelGeometry';
import type {WorldMaterials} from '../materials';
import {drainSync, type BuildSteps} from '../../core/pacedBuild';
import {GROUND, GROUND_KEYS, LOOK_TUNE, OWNER, SIDE_NORMAL, entranceFloor, sideOfPlane, streetEndSpans, surfaceLookPlan, topAt, type BuildingLook, type FacadeHole, type SurfaceLookPlan, type TopSeg} from './archPlan';
import {interiorKeys, surfaceArchMaterial, surfaceArchScale, surfaceSignMaterial, surfaceTintFamily, surfaceTintOf, isSurfaceKey} from './archMaterials';
import {outdoorFlatMaterial} from './lookSky';

/**
 * Geometry chunk (m) of the facade parts: twice the builder's architecture chunk (CHUNK_M 48). A district is ~530 m square and its
 * fog reaches ~300 m, so most chunks are inside the cull distance anyway; frustum culling does the work and fewer, larger chunks
 * cut the draw count (48 m: ~1120 facade meshes on the 8 x 8 frame).
 */
export const SURFACE_CHUNK = 96;
/**
 * Follow-up 2 (draws): the chunk of LOOK's OWN facade parts — twice SURFACE_CHUNK. In the district's views each facade material was
 * drawn once per 96 m cell in view (~17 cells: ~330 of the ~860 draws at the portal); the level culler's slab / storey occlusion and
 * the fog do the culling inside a cell, so the larger cells cost few triangles. The builder's coarsened architecture and the trims
 * keep SURFACE_CHUNK.
 */
export const FACADE_CHUNK = 192;

/** Where a part's polygons go: an accumulator, or a tinted family's accumulator seen with one member's tint (TintView). */
interface QuadSink {
  quad(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void;
  quadFacing(p: readonly (readonly number[])[], facing: readonly number[], n: readonly number[], uv: readonly (readonly number[])[]): void;
  triFacing(p: readonly (readonly number[])[], facing: readonly number[], n: readonly number[], uv: readonly (readonly number[])[]): void;
  tri(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void;
}

const WHITE: readonly number[] = [1, 1, 1];

/** A quad / triangle accumulator (position, normal, uv, + the linear tint 'color' of a tinted family; 16- or 32-bit index). */
class Quads implements QuadSink {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  /** A tinted family's per-vertex linear tint (the 'color' attribute); null for every other accumulator. */
  readonly col: number[] | null;
  /** The tint the next vertices take (a TintView sets it per call). */
  tint: readonly number[] = WHITE;
  constructor(tinted = false) { this.col = tinted ? [] : null; }
  vert(p: readonly number[], n: readonly number[], uv: readonly number[]): void {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    if (this.col) this.col.push(this.tint[0], this.tint[1], this.tint[2]);
  }
  quad(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) this.vert(p[i], n, uv[i]);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** A quad wound to face `facing` (its geometric normal), with attribute normal `n` (the light-field lookup direction). */
  quadFacing(p: readonly (readonly number[])[], facing: readonly number[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    if (dotCross(p[0], p[1], p[3], facing) < 0) this.quad([p[1], p[0], p[3], p[2]], n, [uv[1], uv[0], uv[3], uv[2]]);
    else this.quad(p, n, uv);
  }
  triFacing(p: readonly (readonly number[])[], facing: readonly number[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    if (dotCross(p[0], p[1], p[2], facing) < 0) this.tri([p[0], p[2], p[1]], n, [uv[0], uv[2], uv[1]]);
    else this.tri(p, n, uv);
  }
  tri(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    const b = this.pos.length / 3;
    for (let i = 0; i < 3; i++) this.vert(p[i], n, uv[i]);
    this.idx.push(b, b + 1, b + 2);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A tinted family's accumulator seen with one member key's tint (every polygon added through it carries that tint). */
class TintView implements QuadSink {
  constructor(private readonly q: Quads, private readonly t: readonly number[]) {}
  quad(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void { this.q.tint = this.t; this.q.quad(p, n, uv); }
  quadFacing(p: readonly (readonly number[])[], f: readonly number[], n: readonly number[], uv: readonly (readonly number[])[]): void { this.q.tint = this.t; this.q.quadFacing(p, f, n, uv); }
  triFacing(p: readonly (readonly number[])[], f: readonly number[], n: readonly number[], uv: readonly (readonly number[])[]): void { this.q.tint = this.t; this.q.triFacing(p, f, n, uv); }
  tri(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void { this.q.tint = this.t; this.q.tri(p, n, uv); }
}

type Hole2 = {s0: number; s1: number; y0: number; y1: number};

/** ((b - a) x (c - a)) . f — the winding test of a polygon a, b, c against a facing vector. */
function dotCross(a: readonly number[], b: readonly number[], c: readonly number[], f: readonly number[]): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return (uy * vz - uz * vy) * f[0] + (uz * vx - ux * vz) * f[1] + (ux * vy - uy * vx) * f[2];
}

/** Per-face cut: the solid pieces of face `f` around `holes` (world s / y) and under the roof line `tops` (null: no clip). */
export function cutFace<F extends BuiltFace>(f: F, holes: readonly Hole2[], tops: readonly TopSeg[] | null, topCap: number): F[] {
  const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
  const s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1;
  const H: Hole2[] = [];
  for (const h of holes) if (h.s1 > s0 + 1e-4 && h.s0 < s1 - 1e-4 && h.y1 > f.y0 + 1e-4 && h.y0 < f.y1 - 1e-4)
    H.push({s0: Math.max(h.s0, s0), s1: Math.min(h.s1, s1), y0: Math.max(h.y0, f.y0), y1: Math.min(h.y1, f.y1)});
  const topOf = (m: number) => Math.min(f.y1, tops ? topAt({tops} as never, m, topCap) : topCap);
  let clips = false;
  if (tops) for (const t of tops) if (t.s1 > s0 && t.s0 < s1 && t.top < f.y1 - 1e-4) { clips = true; break; }
  if (!tops && topCap < f.y1 - 1e-4) clips = true;
  if (!H.length && !clips) return [f];
  for (const o of f.openings) H.push({s0: s0 + o.s0, s1: s0 + o.s1, y0: f.y0, y1: Math.min(f.y1, o.top)});
  const cuts = new Set<number>([s0, s1]);
  for (const h of H) { cuts.add(h.s0); cuts.add(h.s1); }
  if (tops) for (const t of tops) for (const v of [t.s0, t.s1]) if (v > s0 && v < s1) cuts.add(v);
  const xs = [...cuts].sort((a, b) => a - b);
  const runs: {a: number; b: number; ys: [number, number][]}[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const a = xs[k], b = xs[k + 1];
    if (b - a < 1e-4) continue;
    const m = (a + b) / 2, top = topOf(m);
    let ys: [number, number][] = top > f.y0 + 1e-3 ? [[f.y0, top]] : [];
    for (const h of H) if (h.s0 <= m && h.s1 >= m) {
      const nx: [number, number][] = [];
      for (const [p, q] of ys) { if (h.y0 > p + 1e-4) nx.push([p, Math.min(q, h.y0)]); if (h.y1 < q - 1e-4) nx.push([Math.max(p, h.y1), q]); }
      ys = nx.filter(([p, q]) => q - p > 1e-3);
    }
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.b - a) < 1e-6 && last.ys.length === ys.length && last.ys.every(([p, q], i) => Math.abs(p - ys[i][0]) < 1e-6 && Math.abs(q - ys[i][1]) < 1e-6)) last.b = b;
    else runs.push({a, b, ys});
  }
  const out: F[] = [];
  for (const r of runs) for (const [y0, y1] of r.ys) out.push({...f, x0: alongX ? r.a : f.x0, x1: alongX ? r.b : f.x1, z0: alongX ? f.z0 : r.a, z1: alongX ? f.z1 : r.b, y0, y1, openings: []});
  return out;
}

/** The part [a, b] (world, along the face) of a face; its openings re-based (spans from the piece's start). */
export function sliceFace<F extends BuiltFace>(f: F, a: number, b: number): F {
  const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
  const s0 = alongX ? f.x0 : f.z0;
  const piece = {...f, x0: alongX ? a : f.x0, x1: alongX ? b : f.x1, z0: alongX ? f.z0 : a, z1: alongX ? f.z1 : b};
  if (f.openings.length) piece.openings = f.openings.filter(o => s0 + o.s1 > a && s0 + o.s0 < b).map(o => ({...o, s0: Math.max(0, s0 + o.s0 - a), s1: Math.min(b - a, s0 + o.s1 - a)}));
  return piece;
}

/** Hole kind -> its parts' keys (null = none). */
const ROOM = LOOK_TUNE.room, REVEAL = LOOK_TUNE.reveal;

export interface SurfaceArchStats {
  faces: Record<string, number>;
  holes: number; airHoles: number; signs: number; escapes: number; decks: number;
  meshes: number; triangles: number; buildMs: number;
  /** The builder's own district architecture meshes before / after coarsenSurfaceArch (its 48 m chunks -> SURFACE_CHUNK cells). */
  builderMeshesBefore: number; builderMeshes: number;
  /** Of the builder's meshes before: those moved onto their family's shared tinted material (a 'color' attribute added). */
  builderTinted: number;
  /** The builder's door-frame trim meshes of the trim family before / after coarsenTrims. */
  trimMeshesBefore: number; trimMeshes: number;
}

export class SurfaceArch {
  readonly plan: SurfaceLookPlan;
  readonly stats: SurfaceArchStats = {faces: {}, holes: 0, airHoles: 0, signs: 0, escapes: 0, decks: 0, meshes: 0, triangles: 0, buildMs: 0, builderMeshesBefore: 0, builderMeshes: 0, builderTinted: 0, trimMeshesBefore: 0, trimMeshes: 0};
  /** The meshes this arch built (QA / tests). */
  readonly meshes: THREE.Mesh[] = [];
  /** The tent's door flap (AIR's open / closed seam: setTentFlap) and its hinge pivot. */
  flap: THREE.Object3D | null = null;
  /** Owned resources (the sign atlas; geometries are the world group's and disposed with it). */
  readonly owned: {dispose(): void}[] = [];
  private readonly levelIdx = new Map<number, number>();
  /** AIR's span cuts by wall plane ('z<cm>' / 'x<cm>'): both planes of each span, with the face normal sign that takes them. */
  private readonly airCuts = new Map<string, (Hole2 & {sign: number})[]>();

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): SurfaceArch | null {
    const plan = layout.surface && levels.length ? surfaceLookPlan(layout) : null;
    return plan ? new SurfaceArch(layout, mats, levels, plan) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[], plan: SurfaceLookPlan) {
    this.plan = plan;
    levels.forEach((l, i) => this.levelIdx.set(l.id, i));
    for (const sp of plan.spans.values()) {
      const {alongX, n} = SIDE_NORMAL[sp.side];
      const base = layout.levels?.[sp.level]?.baseY ?? 0;
      const outer = alongX ? (n > 0 ? sp.z1 : sp.z0) : (n > 0 ? sp.x1 : sp.x0), inner = alongX ? (n > 0 ? sp.z0 : sp.z1) : (n > 0 ? sp.x0 : sp.x1);
      const h = {s0: alongX ? sp.x0 : sp.z0, s1: alongX ? sp.x1 : sp.z1, y0: base + sp.sill, y1: base + sp.head};
      for (const [plane, sign] of [[outer, n], [inner, -n]] as const) {
        const k = `${alongX ? 'z' : 'x'}${Math.round(plane * 100)}`;
        let l = this.airCuts.get(k);
        if (!l) this.airCuts.set(k, (l = []));
        l.push({...h, sign});
      }
    }
  }

  private count(k: string): void { this.stats.faces[k] = (this.stats.faces[k] ?? 0) + 1; }
  /**
   * A builder face runs on along one plane past where one owner's wall ends (a party wall row of shells, a shell beside the cordon):
   * split it at every change of the owner behind it, so each building's piece takes its own facade (and its side's extent).
   */
  private splitByOwner<F extends BuiltFace>(f: F): F[] {
    if (f.slope) return [f];
    const P = this.plan, W = P.W;
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const plane = alongX ? f.z0 : f.x0, sign = Math.sign(alongX ? f.nz : f.nx);
    const s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1;
    const back = Math.floor((plane - sign * CELL / 2) / CELL);
    const ownerAt = (s: number) => {
      const c = Math.floor(s / CELL), cx = alongX ? c : back, cz = alongX ? back : c;
      return cx < 0 || cz < 0 || cx >= W || cz >= P.H ? OWNER.cordon : P.owner[cz * W + cx];
    };
    const cuts: number[] = [];
    let prev = ownerAt(s0 + CELL / 2);
    for (let c = Math.floor(s0 / CELL + 1e-6) + 1; c * CELL < s1 - 1e-6; c++) {
      const o = ownerAt((c + 0.5) * CELL);
      if (o !== prev) { cuts.push(c * CELL); prev = o; }
    }
    if (!cuts.length) return [f];
    const at = [s0, ...cuts, s1], out: F[] = [];
    for (let k = 0; k + 1 < at.length; k++) if (at[k + 1] - at[k] > 1e-4) out.push(sliceFace(f, at[k], at[k + 1]));
    return out;
  }

  private readonly ends = new Map<string, {s0: number; s1: number}[]>();
  /** The cordon stretches on a plane that face a street end (memoized per plane). */
  private streetEnds(alongX: boolean, plane: number): {s0: number; s1: number}[] {
    const k = `${alongX ? 'z' : 'x'}${Math.round(plane * 100)}`;
    let r = this.ends.get(k);
    if (!r) this.ends.set(k, (r = streetEndSpans(this.plan, alongX, plane)));
    return r;
  }
  private building(id: number): BuildingLook | undefined { return id >= 0 ? this.plan.buildings[id] : undefined; }
  private isOutdoorArea(a: number): boolean { return this.plan.outdoorAreas.has(a) || (a >= 0 && this.layout.areas[a]?.type === 'street' && !this.plan.areaBuilding.has(a)); }

  // --- the builder's finish hooks ------------------------------------------------------------------------------------------------

  /** Floor key of an open cell of level index L (null: the builder's own rule). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const a = lvl.grid.area[i];
    if (this.plan.tentAreas.has(a)) return GROUND_KEYS[GROUND.tent];
    const b = this.plan.areaBuilding.get(a);
    if (b !== undefined) return interiorKeys(this.plan.buildings[b].family).floor;
    if (L !== 0) return null;
    return GROUND_KEYS[this.plan.ground[i]] ?? null;
  }

  /** Ceiling key of a run: none outdoors / over the tent (false), the programme's indoors, else the builder's rule. */
  ceilKey(_L: number, areaId: number, i?: number): string | false | null {
    if (this.isOutdoorArea(areaId) || this.plan.tentAreas.has(areaId)) return false;
    if (i !== undefined && _L === 0 && this.plan.ground[i] === GROUND.tent) return false;
    const b = this.plan.areaBuilding.get(areaId);
    return b !== undefined ? interiorKeys(this.plan.buildings[b].family).ceil : null;
  }

  /** Door opening soffit: the interior side's ceiling, else the builder's rule. */
  doorCeilKey(_L: number, a: Area | undefined, b: Area | undefined): string | null {
    if (a && this.plan.tentAreas.has(a.id) || b && this.plan.tentAreas.has(b.id)) return 'surface-canvas';
    for (const ar of [a, b]) { const id = ar ? this.plan.areaBuilding.get(ar.id) : undefined; if (id !== undefined) return interiorKeys(this.plan.buildings[id].family).ceil; }
    return a && this.isOutdoorArea(a.id) || b && this.isOutdoorArea(b.id) ? 'surface-check' : null;
  }

  /** Door frame trim: the building's trim colour. */
  doorTrimKey(_level: number, a: Area | undefined): string | null {
    const id = a ? this.plan.areaBuilding.get(a.id) : undefined;
    return id !== undefined ? this.plan.buildings[id].trimKey : 'surface-trim-2f3133';
  }

  scale(key: string): {u: number; v: number} | undefined { return surfaceArchScale(key); }
  material(key: string): THREE.Material | undefined {
    if (key === 'surface-roof') return outdoorFlatMaterial('roof');
    if (key === 'surface-coping') return outdoorFlatMaterial('coping');
    return surfaceArchMaterial(this.mats, key);
  }
  meshName(key: string): string | undefined { return isSurfaceKey(key) ? `surface-arch-${key}` : undefined; }
  private readonly tints = new Map<string, readonly number[]>();
  /** The linear tint of a family member key (its own material's colour), memoized; white when it has none. */
  private tint(key: string): readonly number[] {
    let t = this.tints.get(key);
    if (!t) { const c = surfaceTintOf(this.mats, key); this.tints.set(key, (t = c ? [c.r, c.g, c.b] : WHITE)); }
    return t;
  }
  /** A builder mesh's material, when it is a tinted family member: the family's shared material and the member's tint; else null. */
  private tintOfMaterial(m: THREE.Material): {material: THREE.Material; color: THREE.Color} | null {
    const key = m.userData.surfaceArch as string | undefined, fam = key ? surfaceTintFamily(key) : null;
    const shared = fam ? this.material(fam) : undefined, color = (m as THREE.MeshStandardMaterial).color;
    return shared && color ? {material: shared, color} : null;
  }
  /** The finish resolver's hooks (world/finishAt.ts): floorKey / ceilKey above. */

  /** Wall finishes + clipping + window cuts (see module doc). */
  remapFaces<F extends BuiltFace>(faces: F[]): F[] {
    const out: F[] = [];
    const P = this.plan, W = P.W;
    for (const f of faces.flatMap(q => this.splitByOwner(q))) {
      if (f.slope) {
        // a stair flight's side walls inside a building (ROOMS' stair cores, the headhouse's stair): its interior wall finish
        const ib = P.areaBuilding.get(f.area), ibl = ib !== undefined ? P.buildings[ib] : undefined;
        if (ibl) { const key = interiorKeys(ibl.family).wall; this.count(key); out.push({...f, finish: key}); } else out.push(f);
        continue;
      }
      const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
      const plane = alongX ? f.z0 : f.x0, sign = Math.sign(alongX ? f.nz : f.nx);
      const s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1, mid = (s0 + s1) / 2;
      const bx = alongX ? mid : plane - sign * CELL / 2, bz = alongX ? plane - sign * CELL / 2 : mid;
      const fx = alongX ? mid : plane + sign * CELL / 2, fz = alongX ? plane + sign * CELL / 2 : mid;
      const ci = (x: number, z: number) => { const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); return cx < 0 || cz < 0 || cx >= W || cz >= P.H ? -1 : cz * W + cx; };
      const bi = ci(bx, bz), fi = ci(fx, fz);
      const own = bi >= 0 ? P.owner[bi] : OWNER.cordon;
      // the floor in front of the face: low walls (cordon, tent canvas, debris) cap at base + their height (the builder splits a
      // tall face into bands, so a band's own y0 is not the floor)
      const lv = this.levels.find(l => l.id === f.level) ?? this.levels[0];
      const base = fi >= 0 ? lv.grid.floor[fi] : lv.baseY;
      const air = this.airCuts.get(`${alongX ? 'z' : 'x'}${Math.round(plane * 100)}`)?.filter(c => c.sign === sign) ?? [];
      const inside = P.areaBuilding.get(f.area);
      const doorway = fi >= 0 && P.doorCells.has(fi);
      if (P.tentAreas.has(f.area) && !doorway) {
        // the tent's canvas walls, seen from inside, up to the eave (the pitched roof above is the tent build's)
        this.count('surface-canvas');
        out.push(...cutFace({...f, finish: 'surface-canvas'}, [], null, P.tent ? P.tent.eave : base + LOOK_TUNE.tentEave));
        continue;
      }
      if (inside !== undefined && !doorway) {
        const key = interiorKeys(P.buildings[inside].family).wall;
        this.count(key);
        for (const p of cutFace({...f, finish: key}, air, null, Infinity)) out.push(p);
        continue;
      }
      if (!this.isOutdoorArea(f.area) && !doorway) { out.push(f); continue; }
      const bl = this.building(own) ?? (doorway ? this.building(P.doorCells.get(fi)!) : undefined);
      if (bl) {
        const fp = bl.b.footprint;
        const side = doorway ? null : sideOfPlane(fp, alongX, plane, sign);
        const sd = side ? bl.sides.find(s => s.side === side)! : null;
        const holes: Hole2[] = [...air];
        if (side) for (const h of bl.holes) if (h.side === side && h.kind !== 'air' && h.kind !== 'door-boarded') holes.push(h);
        const key = bl.key;
        this.count(key);
        for (const p of cutFace({...f, finish: key}, holes, sd ? sd.tops : null, doorway ? Infinity : bl.minTop)) out.push(p);
        continue;
      }
      // not a building: the cordon ring, the tent's carved walls, debris / barricade blocks, kerb risers
      const y0 = base;
      if (own === OWNER.cordon) {
        // where a street would run on through the cordon, the wall is a steel-plate barricade (the street reads closed, not cut):
        // the face splits at those stretches (a ring side is one long face)
        const cuts = [s0, s1];
        for (const r of this.streetEnds(alongX, plane)) for (const v of [r.s0, r.s1]) if (v > s0 + 1e-4 && v < s1 - 1e-4) cuts.push(v);
        cuts.sort((a, b) => a - b);
        for (let c = 0; c + 1 < cuts.length; c++) {
          const a = cuts[c], b = cuts[c + 1], m = (a + b) / 2;
          if (b - a < 1e-4) continue;
          const k = this.streetEnds(alongX, plane).some(r => m > r.s0 && m < r.s1) ? 'surface-barricade' : 'surface-cordon';
          this.count(k);
          out.push(...cutFace({...sliceFace(f, a, b), finish: k}, [], null, y0 + LOOK_TUNE.cordonH));
        }
        continue;
      }
      if (own === OWNER.tent) { this.count('surface-canvas'); out.push(...cutFace({...f, finish: 'surface-canvas'}, [], null, P.tent ? P.tent.eave : y0 + LOOK_TUNE.tentEave)); continue; }
      if (own === OWNER.debris) { this.count('surface-debris'); out.push(...cutFace({...f, finish: 'surface-debris'}, [], null, y0 + LOOK_TUNE.debrisH)); continue; }
      // a floor step outdoors: a kerb / a lot's raised grade (low), else a debris mound's flank (GEN's rubble: raised FLOOR)
      if (f.y1 - f.y0 < 0.35) { this.count('surface-kerb'); out.push({...f, finish: 'surface-kerb'}); continue; }
      this.count('surface-debris');
      out.push({...f, finish: 'surface-debris'});
    }
    return out;
  }

  // --- the facade parts ---------------------------------------------------------------------------------------------------------

  /** Builds every facade part into `group` (paced: one step per building). */
  *buildSteps(group: THREE.Group): BuildSteps<void> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const acc = new Map<string, {key: string; q: Quads}>();
    // a family member's parts go to its family's accumulator of the cell, carrying the member's tint
    const A = (key: string, x: number, z: number): QuadSink => {
      const fam = surfaceTintFamily(key), ak = fam ?? key;
      const k = `${ak}@${Math.floor(x / FACADE_CHUNK)},${Math.floor(z / FACADE_CHUNK)}`;
      let e = acc.get(k);
      if (!e) acc.set(k, (e = {key: ak, q: new Quads(fam !== null)}));
      return fam ? new TintView(e.q, this.tint(key)) : e.q;
    };
    const P = this.plan;
    // the sign atlas (runtime text; browser only)
    const atlas = signAtlas(P);
    if (atlas) this.owned.push(atlas.texture);
    let k = 0;
    for (const bl of P.buildings) {
      try { this.buildBuilding(bl, A, atlas); } catch (e) { console.warn('surface arch: building parts skipped', bl.id, e); }
      if (++k % 4 === 0) yield 'world.surface.facades';
    }
    yield 'world.surface.tent';
    try { this.buildTent(group); } catch (e) { console.warn('surface arch: tent skipped', e); }
    this.buildCordonCoping(A);
    yield 'world.surface.coarsen';
    try {
      const c = yield* coarsenSurfaceArchSteps(group, SURFACE_CHUNK, m => this.tintOfMaterial(m));
      this.stats.builderMeshesBefore = c.before; this.stats.builderMeshes = c.after; this.stats.builderTinted = c.tinted;
    } catch (e) { console.warn('surface arch: coarsening skipped', e); }
    yield 'world.surface.meshes';
    let made = 0;
    for (const [name, e] of acc) {
      if (++made % 32 === 0) yield 'world.surface.meshes';
      const geo = e.q.geometry();
      if (!geo) continue;
      const mat = e.key === 'surface-sign' ? surfaceSignMaterial(this.mats, atlas?.texture ?? null) : this.material(e.key);
      if (!mat) { geo.dispose(); continue; }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `surface-arch-${name}`;
      mesh.userData.level = this.levels[0].id;
      mesh.userData.surfaceArch = e.key;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      this.meshes.push(mesh);
      this.stats.meshes++;
      this.stats.triangles += (geo.index?.count ?? 0) / 3;
    }
    this.stats.holes = P.stats.holes; this.stats.airHoles = P.stats.airHoles; this.stats.signs = P.stats.signs; this.stats.escapes = P.stats.escapes;
    this.stats.buildMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  }

  private buildBuilding(bl: BuildingLook, A: (key: string, x: number, z: number) => QuadSink, atlas: SignAtlas | null): void {
    const st = bl.style, trim = bl.trimKey, fac = bl.key;
    const sc = surfaceArchScale(fac) ?? {u: 1, v: 1};
    for (const sd of bl.sides) {
      const {alongX, n, plane} = sd;
      const nrm = alongX ? [0, 0, n] : [n, 0, 0];
      // world point on the side: s along, d outward from the facade plane, y up
      const pt = (s: number, d: number, y: number): number[] => (alongX ? [s, y, plane + n * d] : [plane + n * d, y, s]);
      const Q = (key: string, s: number) => A(key, alongX ? s : plane, alongX ? plane : s);
      /** A vertical quad parallel to the facade at offset d (facing outward), s0..s1 x y0..y1. */
      const face = (key: string, s0: number, s1: number, y0: number, y1: number, d: number, m = {u: 1, v: 1}, facing: 1 | -1 = 1) => {
        const u = (s: number) => (alongX ? (n > 0 ? s : -s) : (n > 0 ? -s : s)) / m.u;
        const nn = facing > 0 ? nrm : nrm.map(v => -v);
        Q(key, (s0 + s1) / 2).quadFacing([pt(s0, d, y0), pt(s1, d, y0), pt(s1, d, y1), pt(s0, d, y1)], nn, nn, [[u(s0), y0 / m.v], [u(s1), y0 / m.v], [u(s1), y1 / m.v], [u(s0), y1 / m.v]]);
      };
      /** An axis-aligned box in side space: s0..s1, depth d0..d1 (outward +), y0..y1 (all faces; normals true except `lit`). */
      const box = (key: string, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number) => {
        const [x0, x1] = alongX ? [s0, s1] : [Math.min(plane + n * d0, plane + n * d1), Math.max(plane + n * d0, plane + n * d1)];
        const [z0, z1] = alongX ? [Math.min(plane + n * d0, plane + n * d1), Math.max(plane + n * d0, plane + n * d1)] : [s0, s1];
        boxQuads(A(key, (x0 + x1) / 2, (z0 + z1) / 2), x0, x1, y0, y1, z0, z1);
      };
      /** The reveal of an opening: jambs, head, sill from depth d0 to d1 (inward = negative), lit as the facade (outward normal). */
      const reveal = (key: string, h: {s0: number; s1: number; y0: number; y1: number}, d0: number, d1: number) => {
        const q = Q(key, (h.s0 + h.s1) / 2);
        const uvs = (p: number[][]) => p.map(v => [(v[0] + v[2]) / sc.u, v[1] / sc.v]);
        const sdir = alongX ? [1, 0, 0] : [0, 0, 1], mdir = sdir.map(v => -v);
        // jambs face into the opening along s, the head faces down, the sill up; all lit as the facade (outward normal)
        const parts: [number[][], number[]][] = [
          [[pt(h.s0, d0, h.y0), pt(h.s0, d1, h.y0), pt(h.s0, d1, h.y1), pt(h.s0, d0, h.y1)], sdir],
          [[pt(h.s1, d1, h.y0), pt(h.s1, d0, h.y0), pt(h.s1, d0, h.y1), pt(h.s1, d1, h.y1)], mdir],
          [[pt(h.s0, d0, h.y1), pt(h.s0, d1, h.y1), pt(h.s1, d1, h.y1), pt(h.s1, d0, h.y1)], [0, -1, 0]],
          [[pt(h.s1, d0, h.y0), pt(h.s1, d1, h.y0), pt(h.s0, d1, h.y0), pt(h.s0, d0, h.y0)], [0, 1, 0]],
        ];
        for (const [p, f] of parts) q.quadFacing(p, f, nrm, uvs(p));
      };
      for (const h of bl.holes) {
        if (h.side !== sd.side) continue;
        if (h.kind === 'air') {
          // AIR's live span: the wall's full thickness revealed (outer plane to the span box's inner plane), a frame and a sill; no glass
          const sp = h.span ? this.plan.spans.get(h.span) : undefined;
          const depth = sp ? (alongX ? sp.z1 - sp.z0 : sp.x1 - sp.x0) : CELL;
          reveal(fac, h, 0, -depth);
          box(trim, h.s0 - 0.07, h.s0, -0.02, 0.05, h.y0, h.y1);
          box(trim, h.s1, h.s1 + 0.07, -0.02, 0.05, h.y0, h.y1);
          box(trim, h.s0 - 0.07, h.s1 + 0.07, -0.02, 0.05, h.y1, h.y1 + 0.07);
          box('surface-coping', h.s0 - 0.12, h.s1 + 0.12, -0.02, 0.09, h.y0 - 0.06, h.y0);
          continue;
        }
        if (h.kind === 'door-boarded') { boards(face, h, 0.03); continue; }
        const deep = h.kind === 'shop' ? 1.6 : ROOM;
        reveal(fac, h, 0, -REVEAL);
        reveal('surface-void', h, -REVEAL, -deep);
        face('surface-void', h.s0, h.s1, h.y0, h.y1, -deep);
        if (h.kind === 'glass' || h.kind === 'shop') face(h.kind === 'shop' ? 'surface-glass-shop' : 'surface-glass', h.s0, h.s1, h.y0, h.y1, -REVEAL * 0.6);
        else if (h.kind === 'broken') {
          // a few shards left in the frame corners
          const q = Q('surface-glass', h.s0), w = h.s1 - h.s0, hh = h.y1 - h.y0, d = -REVEAL * 0.6;
          const t1 = [pt(h.s0, d, h.y1), pt(h.s0 + w * 0.35, d, h.y1), pt(h.s0, d, h.y1 - hh * 0.4)];
          const t2 = [pt(h.s1, d, h.y0), pt(h.s1 - w * 0.25, d, h.y0), pt(h.s1, d, h.y0 + hh * 0.3)];
          for (const t of [t1, t2]) q.triFacing(t, nrm, nrm, [[0, 0], [1, 0], [0, 1]]);
        } else if (h.kind === 'boarded') boards(face, h, -0.04);
        else if (h.kind === 'shutter') {
          face('surface-shutter', h.s0, h.s1, h.y0, h.y1, -0.06);
          box(trim, h.s0 - 0.05, h.s1 + 0.05, -0.02, 0.18, h.y1, h.y1 + 0.3);
        }
        // frame / sill (punched windows), scorch above burnt-out openings
        if (h.kind !== 'shutter' && h.kind !== 'shop' && st.windows !== 'curtain') box(trim, h.s0 - 0.1, h.s1 + 0.1, -0.02, 0.06, h.y0 - 0.07, h.y0);
        if (h.kind === 'shop') { box(trim, h.s0 - 0.08, h.s1 + 0.08, -0.04, 0.04, h.y1, h.y1 + 0.12); box(trim, h.s0 - 0.08, h.s0, -0.04, 0.04, h.y0, h.y1); box(trim, h.s1, h.s1 + 0.08, -0.04, 0.04, h.y0, h.y1); }
        if (h.scorch) {
          const topH = Math.min(topAt(sd, (h.s0 + h.s1) / 2, bl.top) - 0.05, h.y1 + 1.6);
          if (topH > h.y1 + 0.2) face('surface-scorch', h.s0 - 0.25, h.s1 + 0.25, h.y1, topH, 0.006);
        }
      }
      if (st.windows === 'curtain') {
        // mullions / transoms over the curtain wall's glazing: one vertical every pane edge, one horizontal per storey line
        for (const h of bl.holes) if (h.side === sd.side && h.kind !== 'air') box(trim, h.s1, h.s1 + 0.1, -0.02, 0.08, h.y0 - 0.25, h.y1 + 0.25);
      }
      // entrances: frames (and the name canopy of a destination); boarded ones are handled as holes above
      for (const e of bl.b.entrances) {
        if (e.side !== sd.side || e.door === 'boarded') continue;
        const c = alongX ? e.x : e.z, base = entranceFloor(this.layout, e), hw = e.width / 2;
        box(trim, c - hw - 0.12, c - hw, -0.02, 0.08, base, base + e.height);
        box(trim, c + hw, c + hw + 0.12, -0.02, 0.08, base, base + e.height);
        box(trim, c - hw - 0.12, c + hw + 0.12, -0.02, 0.08, base + e.height, base + e.height + 0.14);
        if ((st.ground === 'canopy' || st.ground === 'plinth' || st.ground === 'lobby') && e.level === 0 && base + e.height + 0.5 < topAt(sd, c, bl.top))
          box('surface-steel', c - hw - 0.8, c + hw + 0.8, 0, 1.3, base + e.height + 0.25, base + e.height + 0.4);
      }
      // signs (fascia band + text face)
      for (const sg of bl.signs) {
        if (sg.side !== sd.side) continue;
        box(trim, sg.s0 - 0.08, sg.s1 + 0.08, 0, 0.1, sg.y0 - 0.06, sg.y1 + 0.06);
        const uv = atlas?.uv.get(sg) ?? [0, 0, 1, 1];
        const q = Q('surface-sign', (sg.s0 + sg.s1) / 2);
        const a = pt(sg.s0, 0.105, sg.y0), b = pt(sg.s1, 0.105, sg.y0), cc = pt(sg.s1, 0.105, sg.y1), d = pt(sg.s0, 0.105, sg.y1);
        // the text reads left to right seen from outside: s increases to the viewer's right on S / W faces
        const ltr = alongX ? n > 0 : n < 0;
        const [u0, v0, u1, v1] = uv;
        if (ltr) q.quadFacing([a, b, cc, d], nrm, nrm, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        else q.quadFacing([b, a, d, cc], nrm, nrm, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      }
      // roof line parts: cornice (intact runs at the nominal top), string courses, the coping, the parapet's inner face, the ruin steps
      const t = LOOK_TUNE.parapetT;
      for (const seg of sd.tops) {
        const intact = Math.abs(seg.top - bl.top) < 1e-3;
        if (intact && st.cornice.h > 0) box(trim, seg.s0, seg.s1, 0, st.cornice.out, seg.top - st.cornice.h - 0.08, seg.top - 0.08);
        if (st.courses) for (let k = 1; k < bl.storeys; k++) { const y = bl.storeyY[k]; if (y + 0.4 < seg.top) box(fac, seg.s0, seg.s1, 0, 0.05, y - 0.09, y + 0.09); }
        if (st.wall === 'canvas') continue;
        // coping (cap of the wall thickness) and the inner face of the parapet above the deck
        const yTop = seg.top, deckY = Math.min(...bl.decks.map(d => d.y), bl.deck);
        const qc = Q('surface-coping', (seg.s0 + seg.s1) / 2);
        const c0 = pt(seg.s0, 0.04, yTop), c1 = pt(seg.s1, 0.04, yTop), c2 = pt(seg.s1, -t, yTop), c3 = pt(seg.s0, -t, yTop);
        qc.quadFacing([c0, c1, c2, c3], [0, 1, 0], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        if (yTop > deckY + 0.05) face('surface-coping', seg.s0, seg.s1, deckY, yTop, -t, {u: 1, v: 1}, -1);
      }
      for (let i = 0; i + 1 < sd.tops.length; i++) {
        const a = sd.tops[i], b = sd.tops[i + 1];
        if (Math.abs(a.top - b.top) < 1e-3) continue;
        // the exposed end of the higher run (facing the lower run along s)
        const s = a.s1, lo = Math.min(a.top, b.top), hi = Math.max(a.top, b.top), towardHigher = b.top > a.top ? 1 : -1;
        const q = Q('surface-coping', s);
        const p0 = pt(s, 0, lo), p1 = pt(s, -t, lo), p2 = pt(s, -t, hi), p3 = pt(s, 0, hi);
        const sn = alongX ? [-towardHigher, 0, 0] : [0, 0, -towardHigher];
        q.quadFacing([p0, p1, p2, p3], sn, sn, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      // fire escapes
      for (const fe of bl.escapes) if (fe.side === sd.side) this.fireEscape(fe, box);
    }
    // roof decks (the outdoor flat look: SOLID columns have no light-field slot)
    for (const d of bl.decks) {
      if (d.x1 - d.x0 < 0.2 || d.z1 - d.z0 < 0.2) continue;
      this.stats.decks++;
      for (const [xa, xb] of spans(d.x0, d.x1)) for (const [za, zb] of spans(d.z0, d.z1)) {
        A(d.burnt ? 'surface-coping' : 'surface-roof', (xa + xb) / 2, (za + zb) / 2)
          .quad([[xa, d.y, za], [xa, d.y, zb], [xb, d.y, zb], [xb, d.y, za]], [0, 1, 0], [[xa / 2, -za / 2], [xa / 2, -zb / 2], [xb / 2, -zb / 2], [xb / 2, -za / 2]]);
      }
    }
  }

  /** A steel fire escape: a landing per storey (deck, rails), flights between them, a drop ladder from the first landing. */
  private fireEscape(fe: BuildingLook['escapes'][number], box: (key: string, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number) => void): void {
    const w = 1.6, dep = 1.15, k = 'surface-steel';
    fe.levels.forEach((lv, li) => {
      const y = fe.ys[li];
      box(k, fe.s - w, fe.s + w, 0.02, dep, y - 0.06, y);
      box(k, fe.s - w, fe.s + w, dep - 0.04, dep, y + 0.95, y + 1.0);
      box(k, fe.s - w, fe.s - w + 0.04, 0.02, dep, y + 0.95, y + 1.0);
      box(k, fe.s + w - 0.04, fe.s + w, 0.02, dep, y + 0.95, y + 1.0);
      for (let s = fe.s - w; s <= fe.s + w + 1e-6; s += 0.8) box(k, s - 0.02, s + 0.02, dep - 0.04, dep, y, y + 0.95);
      // the flight up to the next landing: a stepped stringer (treads as thin boxes along the slope)
      if (fe.levels[li + 1] === lv + 1) {
        const rise = fe.ys[li + 1] - y, run = w * 1.6, nT = Math.max(6, Math.round(rise / 0.2));
        for (let i = 0; i < nT; i++) {
          const s = fe.s - run / 2 + (i / nT) * run, yy = y + (i + 1) / nT * rise;
          box(k, s, s + run / nT, dep * 0.45, dep - 0.08, yy - 0.04, yy);
        }
      }
    });
    // drop ladder from the lowest landing, ending above head height
    const y0 = fe.ys[0], foot = fe.base + 2.3;
    box(k, fe.s + w - 0.55, fe.s + w - 0.5, dep - 0.1, dep - 0.05, foot, y0);
    box(k, fe.s + w - 0.1, fe.s + w - 0.05, dep - 0.1, dep - 0.05, foot, y0);
    for (let y = foot + 0.2; y < y0 - 0.1; y += 0.3) box(k, fe.s + w - 0.55, fe.s + w - 0.05, dep - 0.09, dep - 0.06, y - 0.02, y + 0.02);
  }

  /** The cordon wall's coping and a top rail of the wall (the SOLID ring's inner edge). */
  private buildCordonCoping(A: (key: string, x: number, z: number) => QuadSink): void {
    const r = this.plan.inner, h = LOOK_TUNE.cordonH;
    for (const [x0, x1, z0, z1] of [[r.x0, r.x1, r.z0 - 0.5, r.z0], [r.x0, r.x1, r.z1, r.z1 + 0.5], [r.x0 - 0.5, r.x0, r.z0, r.z1], [r.x1, r.x1 + 0.5, r.z0, r.z1]]) {
      for (const [xa, xb] of spans(x0, x1)) for (const [za, zb] of spans(z0, z1)) boxQuads(A('surface-coping', (xa + xb) / 2, (za + zb) / 2), xa - 0.05, xb + 0.05, h, h + 0.18, za - 0.05, zb + 0.05);
    }
  }

  /** The command tent: canvas walls (when GEN did not carve them), the pitched roof, gables, guy lines and the door flap. */
  private buildTent(group: THREE.Group): void {
    const T = this.plan.tent;
    if (!T) return;
    const r = T.rect, eave = T.eave, ridge = T.ridge;
    const canvas = this.material('surface-canvas');
    const rope = this.material('surface-trim-tint'); // (the trim family's shared material; the rope's tint in its 'color')
    if (!canvas || !rope) return;
    const q = new Quads(), ropes = new Quads(true);
    ropes.tint = this.tint('surface-trim-3a3a2c');
    const sc = surfaceArchScale('surface-canvas') ?? {u: 1, v: 1};
    const uvOf = (p: number[]) => [(p[0] + p[2]) / sc.u, p[1] / sc.v];
    const two = (p: number[][], nrm: number[]) => {
      q.quad(p, nrm, p.map(uvOf));
      q.quad([p[1], p[0], p[3], p[2]], nrm.map(v => -v), [p[1], p[0], p[3], p[2]].map(uvOf));
    };
    const dw = T.door.width / 2, dh = T.door.height;
    // walls (both sides drawn: the tent is entered); the door side leaves the flap's opening
    if (!T.carved) {
      const walls: [Side, number, number, number][] = [['N', r.z0, r.x0, r.x1], ['S', r.z1, r.x0, r.x1], ['W', r.x0, r.z0, r.z1], ['E', r.x1, r.z0, r.z1]];
      for (const [side, plane, a0, a1] of walls) {
        const alongX = side === 'N' || side === 'S';
        const P3 = (s: number, y: number) => (alongX ? [s, y, plane] : [plane, y, s]);
        const nrm = alongX ? [0, 0, side === 'S' ? 1 : -1] : [side === 'E' ? 1 : -1, 0, 0];
        const door = T.door.side === side ? (alongX ? T.door.x : T.door.z) : null;
        const pieces: [number, number, number][] = door === null ? [[a0, a1, T.base]] : [[a0, door - dw, T.base], [door + dw, a1, T.base], [door - dw, door + dw, T.base + dh]];
        for (const [s0, s1, yb] of pieces) if (s1 - s0 > 0.01) two([P3(s0, yb), P3(s1, yb), P3(s1, eave), P3(s0, eave)], nrm);
      }
    }
    // roof: two slopes from the eaves to the ridge (along the longer axis), gables closing the ends
    if (T.ridgeX) {
      const zm = (r.z0 + r.z1) / 2;
      two([[r.x0, eave, r.z0], [r.x1, eave, r.z0], [r.x1, ridge, zm], [r.x0, ridge, zm]], [0, 0.8, -0.6]);
      two([[r.x1, eave, r.z1], [r.x0, eave, r.z1], [r.x0, ridge, zm], [r.x1, ridge, zm]], [0, 0.8, 0.6]);
      for (const x of [r.x0, r.x1]) { q.tri([[x, eave, r.z0], [x, eave, r.z1], [x, ridge, zm]], [x === r.x0 ? -1 : 1, 0, 0], [[0, 0], [1, 0], [0.5, 1]]); q.tri([[x, eave, r.z1], [x, eave, r.z0], [x, ridge, zm]], [x === r.x0 ? 1 : -1, 0, 0], [[0, 0], [1, 0], [0.5, 1]]); }
    } else {
      const xm = (r.x0 + r.x1) / 2;
      two([[r.x0, eave, r.z1], [r.x0, eave, r.z0], [xm, ridge, r.z0], [xm, ridge, r.z1]], [-0.6, 0.8, 0]);
      two([[r.x1, eave, r.z0], [r.x1, eave, r.z1], [xm, ridge, r.z1], [xm, ridge, r.z0]], [0.6, 0.8, 0]);
      for (const z of [r.z0, r.z1]) { q.tri([[r.x0, eave, z], [r.x1, eave, z], [xm, ridge, z]], [0, 0, z === r.z0 ? -1 : 1], [[0, 0], [1, 0], [0.5, 1]]); q.tri([[r.x1, eave, z], [r.x0, eave, z], [xm, ridge, z]], [0, 0, z === r.z0 ? 1 : -1], [[0, 0], [1, 0], [0.5, 1]]); }
    }
    // guy lines (thin ropes from the eaves to stakes) and frame poles at the corners
    for (const g of T.guys) orientedBar(ropes, [g.ex, g.ey, g.ez], [g.ax, T.base + 0.05, g.az], 0.02);
    for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) boxQuads(ropes, x - 0.04, x + 0.04, T.base, eave, z - 0.04, z + 0.04);
    for (const [geo, mat, name] of [[q.geometry(), canvas, 'surface-tent'], [ropes.geometry(), rope, 'surface-tent-ropes']] as const) {
      if (!geo) continue;
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.userData.level = this.levels[0].id;
      m.matrixAutoUpdate = false;
      group.add(m);
      this.meshes.push(m);
      this.stats.meshes++;
      this.stats.triangles += (geo.index?.count ?? 0) / 3;
    }
    // the door flap: its own mesh under a hinge pivot along the door head (rotation.x/z rolls it up: setTentFlap)
    const flapQ = new Quads();
    const alongX = T.door.side === 'N' || T.door.side === 'S', ns = T.door.side === 'S' || T.door.side === 'E' ? 1 : -1;
    const p = (s: number, y: number, d: number) => (alongX ? [s, y, d] : [d, y, s]);
    const off = 0.03 * ns;
    flapQ.quad([p(-dw - 0.05, -dh, off), p(dw + 0.05, -dh, off), p(dw + 0.05, 0, off), p(-dw - 0.05, 0, off)], alongX ? [0, 0, ns] : [ns, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    flapQ.quad([p(dw + 0.05, -dh, off), p(-dw - 0.05, -dh, off), p(-dw - 0.05, 0, off), p(dw + 0.05, 0, off)], alongX ? [0, 0, -ns] : [-ns, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const fg = flapQ.geometry();
    if (fg) {
      const pivot = new THREE.Group();
      pivot.name = 'surface-tent-flap';
      const plane = alongX ? (T.door.side === 'S' ? r.z1 : r.z0) : (T.door.side === 'E' ? r.x1 : r.x0);
      pivot.position.set(alongX ? T.door.x : plane, T.base + dh, alongX ? plane : T.door.z);
      pivot.userData.flapAxis = alongX ? 'x' : 'z';
      pivot.userData.flapSign = ns;
      const fm = new THREE.Mesh(fg, canvas);
      fm.name = 'surface-tent-flap-leaf';
      fm.userData.level = this.levels[0].id;
      pivot.add(fm);
      group.add(pivot);
      this.flap = pivot;
      this.meshes.push(fm);
    }
  }

  /**
   * AIR's seam: the tent door flap's state, 0 = closed (hanging over the opening) .. 1 = rolled up / tied open. The flap is a plain
   * transform under its pivot (no rebuild, no material change); AIR owns when it opens.
   */
  setTentFlap(open: number): void {
    const f = this.flap;
    if (!f) return;
    const a = Math.max(0, Math.min(1, open)) * (Math.PI / 2) * 0.95 * (f.userData.flapSign as number);
    if (f.userData.flapAxis === 'x') { f.rotation.set(-a, 0, 0); } else f.rotation.set(0, 0, a);
    f.updateMatrix(); // (the built world's objects do not auto-update their matrices: builder world.finish)
    f.updateMatrixWorld(true);
  }

  /**
   * The builder's door-frame trims of the trim family ('trim-…' meshes, merged by the builder after the arch's build: builder.ts
   * world.trimMerge) onto the family's shared material, merged per SURFACE_CHUNK cell (follow-up 1: draws). Other trims untouched.
   */
  coarsenTrims(group: THREE.Group): void {
    try {
      const c = coarsenSurfaceArch(group, SURFACE_CHUNK, m => this.tintOfMaterial(m), {prefix: 'trim-', tintedOnly: true});
      this.stats.trimMeshesBefore = c.before; this.stats.trimMeshes = c.after;
    } catch (e) { console.warn('surface arch: trim coarsening skipped', e); }
  }

  /** Releases what the arch owns beyond the world group's geometry (the sign atlas). */
  dispose(): void {
    for (const r of this.owned.splice(0)) r.dispose();
  }

  /** QA summary. */
  summary(): Record<string, unknown> {
    return {...this.stats, plan: this.plan.stats, buildings: this.plan.buildings.length};
  }
}

function boards(face: (key: string, s0: number, s1: number, y0: number, y1: number, d: number) => void, h: FacadeHole, d: number): void {
  // plywood sheets over the opening: two or three boards with a gap, slightly proud of it
  const n = h.y1 - h.y0 > 1.6 ? 3 : 2, gap = 0.05, bh = (h.y1 - h.y0 - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) face('surface-boards', h.s0 - 0.04, h.s1 + 0.04, h.y0 + i * (bh + gap), h.y0 + i * (bh + gap) + bh, d + 0.002 * i);
}

/**
 * The builder's own district architecture (its walls / floors / ceilings per finish key, level and 48 m chunk: CHUNK_M) merged into
 * SURFACE_CHUNK cells. A district is open ground ~530 m across under a ~300 m fog: the 48 m chunks bought little culling and cost ~3x
 * the draw calls (every ground finish in ~120 chunks). Only meshes with the same material, level (+ tagged storeys), attribute layout
 * and 96 m cell merge; the builder's meshes carry world positions (no transform), so the merge is a concatenation. Mesh state
 * (level tags, shadows, render order, layers) is the first piece's. LOOK's own facade parts (userData.surfaceArch) are not touched.
 * `tint` (follow-up 1): a mesh whose material is a tinted family member moves onto the family's shared material first, its tint
 * written into a 'color' attribute (Float32 x 3, every vertex: the member material's colour), so a cell's walls of one family merge
 * across buildings. `o.prefix`: the mesh names taken ('surface-arch-': the builder's architecture; 'trim-' + `tintedOnly`: its door-
 * frame trims of the trim family, SurfaceArch.coarsenTrims).
 */
export function coarsenSurfaceArch(
  group: THREE.Group, chunk = SURFACE_CHUNK, tint?: (m: THREE.Material) => {material: THREE.Material; color: THREE.Color} | null,
  o: {prefix?: string; tintedOnly?: boolean} = {},
): {before: number; after: number; tinted: number} {
  return drainSync(coarsenSurfaceArchSteps(group, chunk, tint, o));
}

/** coarsenSurfaceArch as build steps (the arch's build: ~50-70 ms on a real district). */
export function* coarsenSurfaceArchSteps(
  group: THREE.Group, chunk = SURFACE_CHUNK, tint?: (m: THREE.Material) => {material: THREE.Material; color: THREE.Color} | null,
  o: {prefix?: string; tintedOnly?: boolean} = {},
): BuildSteps<{before: number; after: number; tinted: number}> {
  const lists = new Map<string, THREE.Mesh[]>();
  const c = new THREE.Vector3();
  const prefix = o.prefix ?? 'surface-arch-';
  let before = 0, tinted = 0, seen = 0;
  for (const ob of group.children) {
    if (++seen % 256 === 0) yield 'world.surface.coarsen';
    const m = ob as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || !m.name.startsWith(prefix) || m.userData.surfaceArch !== undefined) continue;
    const g = m.geometry;
    if (Array.isArray(m.material) || g.groups.length || !m.matrix.equals(IDENTITY) || m.morphTargetInfluences) continue;
    const t = tint && !g.attributes.color ? tint(m.material as THREE.Material) : null;
    if (o.tintedOnly && !t) continue;
    before++;
    if (t) {
      const nv = g.attributes.position.count, a = new Float32Array(nv * 3);
      for (let i = 0; i < nv; i++) { a[3 * i] = t.color.r; a[3 * i + 1] = t.color.g; a[3 * i + 2] = t.color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      m.material = t.material;
      m.name = `${prefix}${t.material.name}`;
      tinted++;
    }
    if (!g.boundingBox) g.computeBoundingBox();
    g.boundingBox!.getCenter(c);
    const attrs = Object.entries(g.attributes).map(([k, a]) => `${k}:${a.itemSize}:${a.normalized ? 1 : 0}:${(a as THREE.BufferAttribute).array?.constructor.name}`).sort().join(',');
    const key = `${m.material.uuid}|${m.userData.level}|${JSON.stringify(m.userData.levels ?? null)}|${attrs}|${g.index ? 'i' : 'n'}|${m.renderOrder}|${Math.floor(c.x / chunk)},${Math.floor(c.z / chunk)}`;
    let l = lists.get(key);
    if (!l) lists.set(key, (l = []));
    l.push(m);
  }
  let after = 0;
  for (const list of lists.values()) {
    after++;
    if (list.length < 2) continue;
    if (after % 16 === 0) yield 'world.surface.coarsen';
    const merged = mergeGeometries(list.map(m => m.geometry), false);
    if (!merged) { after += list.length - 1; continue; }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const first = list[0], mesh = new THREE.Mesh(merged, first.material);
    mesh.name = first.name;
    mesh.userData = {...first.userData};
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder; mesh.layers.mask = first.layers.mask; mesh.frustumCulled = first.frustumCulled;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    for (const m of list) { m.removeFromParent(); m.geometry.dispose(); }
  }
  return {before, after, tinted};
}
const IDENTITY = new THREE.Matrix4();

/** Split [a, b] at multiples of FACADE_CHUNK (the facade parts' cells). */
function spans(a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  while (a < b - 1e-6) { const e = Math.min(b, (Math.floor(a / FACADE_CHUNK + 1e-9) + 1) * FACADE_CHUNK); out.push([a, e]); a = e; }
  return out;
}

/** An axis-aligned box's six faces (outward normals, world-metre UVs). */
export function boxQuads(q: QuadSink, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  if (x1 - x0 < 1e-5 || y1 - y0 < 1e-5 || z1 - z0 < 1e-5) return;
  q.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
  q.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  q.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  q.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
  q.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
  q.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
}

/** A thin square bar between two points (ropes, stays). */
function orientedBar(q: Quads, a: readonly number[], b: readonly number[], t: number): void {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(t, t, len);
  const m = new THREE.Matrix4().lookAt(A, B, Math.abs(d.y / len) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition(A.clone().add(B).multiplyScalar(0.5));
  g.applyMatrix4(m);
  const p = g.attributes.position, nn = g.attributes.normal, ix = g.index!;
  const base = q.pos.length / 3;
  for (let i = 0; i < p.count; i++) q.vert([p.getX(i), p.getY(i), p.getZ(i)], [nn.getX(i), nn.getY(i), nn.getZ(i)], [0, i / p.count]);
  for (let i = 0; i < ix.count; i++) q.idx.push(base + ix.getX(i));
  g.dispose();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The sign atlas (runtime text: shop / institution names drawn into one canvas; browser only)

interface SignAtlas { texture: THREE.CanvasTexture; uv: Map<object, [number, number, number, number]> }
const SIGN_PX = {w: 512, h: 64, cols: 2, maxRows: 64} as const;
const SIGN_BG = ['#1f3b2e', '#4a1e1e', '#1d2b45', '#d8cfb4', '#2b2b2b', '#6b4a1c', '#e2ddd0', '#5a1f3a'];

function signAtlas(P: SurfaceLookPlan): SignAtlas | null {
  if (typeof document === 'undefined') return null;
  const all = P.buildings.flatMap(b => b.signs);
  if (!all.length) return null;
  const n = Math.min(all.length, SIGN_PX.cols * SIGN_PX.maxRows);
  const rows = Math.ceil(n / SIGN_PX.cols);
  let H = 1;
  while (H < rows * SIGN_PX.h) H *= 2;
  const c = document.createElement('canvas');
  c.width = SIGN_PX.w * SIGN_PX.cols;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const uv = new Map<object, [number, number, number, number]>();
  let rnd = (P.seed % 2147483647) || 7;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  all.slice(0, n).forEach((s, i) => {
    const cx = (i % SIGN_PX.cols) * SIGN_PX.w, cy = Math.floor(i / SIGN_PX.cols) * SIGN_PX.h;
    const bg = SIGN_BG[Math.floor(r() * SIGN_BG.length)];
    ctx.fillStyle = bg;
    ctx.fillRect(cx, cy, SIGN_PX.w, SIGN_PX.h);
    const light = bg === '#d8cfb4' || bg === '#e2ddd0';
    // the face is wider / narrower than 8:1: the text is fitted to the sign's real aspect
    const aspect = (s.s1 - s.s0) / Math.max(0.2, s.y1 - s.y0);
    const font = Math.min(44, Math.max(18, SIGN_PX.w / Math.max(4, s.text.length) * 1.5 * Math.min(1, aspect / 8)));
    ctx.font = `bold ${Math.round(font)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = [...s.text];
    const total = ctx.measureText(s.text).width;
    let x = cx + SIGN_PX.w / 2 - total / 2;
    for (const ch of chars) {
      const w = ctx.measureText(ch).width;
      ctx.globalAlpha = r() < 0.08 ? 0.18 : 0.75 + r() * 0.25; // weathered / missing letters
      ctx.fillStyle = light ? '#2a2622' : '#e8e2cf';
      ctx.fillText(ch, x + w / 2, cy + SIGN_PX.h / 2 + 2);
      x += w;
    }
    // grime and fading (soft dark blotches)
    ctx.globalAlpha = 0.18;
    for (let k = 0; k < 5; k++) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(cx + r() * SIGN_PX.w, cy + r() * SIGN_PX.h, 20 + r() * 60, 6 + r() * 18, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    uv.set(s, [cx / c.width, 1 - (cy + SIGN_PX.h) / c.height, (cx + SIGN_PX.w) / c.width, 1 - cy / c.height]);
  });
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.name = 'surface-sign-atlas';
  return {texture, uv};
}
