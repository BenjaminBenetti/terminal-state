// Iteration 08 (Lane W): wall identity + convincing deterioration — the builder hook.
//
// buildWallDetail(world group, layout, materials, faces) plans the station's wall treatment
// (world/wallDetailPlan.ts), cuts the planned insets / breaches out of the builder's merged base-wall
// meshes, and adds ONE group of merged meshes, one per material:
//   flush   - accent tile bands, tile pilasters, expansion joints, panel joints, formwork (cut-out atlas)
//   frieze  - station-name mosaic tablets (per-station canvas texture)
//   decal   - cracks, chipped edges / corners, repair patches, breach / spall rims (cut-out atlas)
//   soft    - water streaks, efflorescence, damp tide marks, soot, grime, scuffs (alpha atlas, tinted)
//   cavity  - inset backs / sides (mortar bed, bare block, raw concrete, broken blockwork), rubble
//   steel / rust / cable - conduits, boxes and brackets / pipes and rebar / tunnel cables (existing materials)
// so the whole treatment costs at most 8 draw calls, independent of how many chips there are.
// Materials and atlases are generated once per page and shared by every station.

import * as THREE from 'three';
import type {StationLayout} from '../gen/station';
import type {WallFace} from './wallFaces';
import {thinTrim, type WorldMaterials, type MatKey} from './materials';
import {cloneWithShaderHooks} from '../render/shaderHooks';
import {shapeMaterial} from './shapeMaterials';
import {planWallDetail, type FeatureKind, type Treatment, type WallDetailPlan, type Feature} from './wallDetailPlan';
import {FRIEZE_SIZE, atlasCells, friezeTexture, wallDetailTextures, type CellRect} from './wallDetailAtlas';
import {Buf, LAYER_OFFSET, cutPolyC, cylinder, faceBox, flatFeature, frameOf, insetPrism, prepareCuts, pt, rimRing, rubble, type CutSpec, type DetailMat, type Frame} from './wallDetailGeometry';

export interface WallDetailStats {
  faces: number;
  treatments: Partial<Record<Treatment, number>>;
  features: Record<FeatureKind, number>;
  /** Planned cut features, cuts applied to the base walls, cuts rejected (no single host quad). */
  cuts: {planned: number; applied: number; rejected: number; wallMeshes: number};
  dropped: number;
  hotspots: number;
  drawCalls: number;
  triangles: number;
  vertices: number;
  /** Triangles added to the base walls by re-triangulating around cuts. */
  wallTriangles: number;
  /** GPU texture memory of the wall-detail atlases + this station's frieze (incl. mips). */
  textureBytes: number;
  ms: number;
  /** Build time split (ms): planning, insets, wall cutting, flat layers + fittings, mesh creation. */
  timing: {plan: number; insets: number; cut: number; flat: number; meshes: number};
}

export interface WallDetailResult { group: THREE.Group; stats: WallDetailStats; plan: WallDetailPlan }

/** Base-wall finishes the builder renders (meshes with these materials may be cut). */
const BASE_KEYS: MatKey[] = ['tileLower', 'tileUpper', 'paint', 'tunnel', 'platformFace', 'concrete'];

interface DetailMaterials { flush: THREE.MeshStandardMaterial; decal: THREE.MeshStandardMaterial; soft: THREE.MeshStandardMaterial; cavity: THREE.MeshStandardMaterial }
const shared = new WeakMap<WorldMaterials, DetailMaterials>();
const friezeMats = new Map<THREE.Texture, THREE.MeshStandardMaterial>();

/** The shared wall-detail materials (created on first use; one set per WorldMaterials). */
export function wallDetailMaterials(mats: WorldMaterials): DetailMaterials {
  let m = shared.get(mats);
  if (m) return m;
  const t = wallDetailTextures();
  // Wall-hugging layers do not write depth: overlapping coplanar pieces then resolve by draw order
  // (no z-fighting at any distance), they never cast flashlight shadows onto the wall they sit on,
  // and their meshes draw after the walls (renderOrder 1) so the wall can never cover them.
  const cutout = (units: number, name: string) => {
    const mat = new THREE.MeshStandardMaterial({map: t.detail.map, roughnessMap: t.detail.roughnessMap, normalMap: t.detail.normalMap, vertexColors: true,
      alphaTest: 0.5, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -units, polygonOffsetUnits: -units});
    mat.normalScale.set(0.9, 0.9);
    mat.name = name;
    return mat;
  };
  // Same feature set as the cut-out layers (alphaTest on opaque cells is a no-op): one shader program
  // serves flush / decal / cavity / tablet (fewer program variants to compile, notably on software GL).
  const cavity = new THREE.MeshStandardMaterial({map: t.detail.map, roughnessMap: t.detail.roughnessMap, normalMap: t.detail.normalMap, vertexColors: true, alphaTest: 0.5, roughness: 1, metalness: 0});
  cavity.normalScale.set(0.9, 0.9);
  cavity.name = 'wall-detail-cavity';
  const soft = new THREE.MeshStandardMaterial({map: t.soft, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  soft.name = 'wall-detail-soft';
  m = {flush: cutout(1, 'wall-detail-flush'), decal: cutout(2, 'wall-detail-decal'), soft, cavity};
  shared.set(mats, m);
  return m;
}

let flatMaps: {normal: THREE.DataTexture; rough: THREE.DataTexture} | null = null;
function friezeMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  let m = friezeMats.get(tex);
  if (!m) {
    for (const old of friezeMats.values()) old.dispose(); // one station at a time
    friezeMats.clear();
    // Flat 1x1 normal / roughness maps give the tablet the cut-out layers' exact feature set (shared program).
    if (!flatMaps) {
      const one = (r: number, g: number, b: number) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.needsUpdate = true; return t; };
      flatMaps = {normal: one(128, 128, 255), rough: one(140, 140, 140)};
    }
    m = new THREE.MeshStandardMaterial({map: tex, normalMap: flatMaps.normal, roughnessMap: flatMaps.rough, vertexColors: true, alphaTest: 0.5, roughness: 1, metalness: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1});
    m.normalScale.set(0.9, 0.9);
    m.name = 'wall-detail-frieze';
    friezeMats.set(tex, m);
  }
  return m;
}

/**
 * Plan + build the wall treatment of a station into `world` (the builder's group): cuts the base walls
 * in place and adds a 'wall-detail' child group. `faces` = the builder's published WallFace[].
 */
/**
 * Iteration 08 (primary): tunnel cables are thin world-mapped cylinders; they get their own copy of the black shape
 * material sampled without anisotropy (materials.ts thinTrim: with 8x, Mesa llvmpipe spent 65-88 s per frame on
 * views along a cabled tunnel wall). One per WorldMaterials, shared across stations; props keep the shared material.
 */
const thinCable = new WeakMap<WorldMaterials, THREE.Material>();
function cableMaterial(mats: WorldMaterials): THREE.Material {
  let m = thinCable.get(mats);
  if (!m) {
    m = thinTrim(cloneWithShaderHooks(shapeMaterial(mats, 'black') as THREE.MeshStandardMaterial));
    m.name = 'shape-black-thin'; // same program as the shared black material (anisotropy is sampler state)
    thinCable.set(mats, m);
  }
  return m;
}

export function buildWallDetail(world: THREE.Group, layout: StationLayout, mats: WorldMaterials, faces?: readonly WallFace[]): WallDetailResult {
  const t0 = performance.now();
  const existing = world.children.find(c => c.name === 'wall-detail') as THREE.Group | undefined;
  if (existing?.userData.wallDetailResult) return existing.userData.wallDetailResult as WallDetailResult; // already treated (never cut twice)
  const plan = planWallDetail(layout, {faces});
  const tPlan = performance.now();
  const group = new THREE.Group();
  group.name = 'wall-detail';
  const dm = wallDetailMaterials(mats);
  const tex = wallDetailTextures();
  const cells = atlasCells();
  const friezeTex = plan.counts.frieze > 0 ? friezeTexture(layout.name, plan.accent) : null;
  const friezeRect: CellRect = {atlas: 'detail', x: 0, y: 0, w: 0, h: 0, u0: 0, u1: 1, v0: 0, v1: 1, mw: FRIEZE_SIZE.w, mh: FRIEZE_SIZE.h};
  const bufs = new Map<DetailMat, Buf>();
  const B = (k: DetailMat) => { let b = bufs.get(k); if (!b) bufs.set(k, (b = new Buf())); return b; };
  const frames = plan.faces.map(frameOf);

  // --- cuts: find the ONE base-wall quad hosting each outline (walls are only modified at commit) ---
  const baseMats = new Set<THREE.Material>(BASE_KEYS.map(k => { try { return mats.get(k); } catch { return null; } }).filter((m): m is THREE.Material => !!m));
  baseMats.add(shapeMaterial(mats, 'tileShop'));
  const baseMeshes: THREE.Mesh[] = [];
  world.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && baseMats.has(m.material)) baseMeshes.push(m);
  });
  const cutFeatures = plan.features.filter(f => f.layer === 'cut');
  const specs: CutSpec[] = cutFeatures.map(f => {
    const F = frames[f.face];
    return {axis: F.axis, plane: F.plane, nSign: F.axis === 'z' ? F.f.nz : F.f.nx, poly: cutPolyC(F, f)};
  });
  const cuts = prepareCuts(baseMeshes, specs);

  // --- insets (all-or-nothing per cut), then the walls are cut for the insets that exist -----------
  cutFeatures.forEach((f, i) => {
    if (!specs[i].applied) return;
    const local = new Map<DetailMat, Buf>();
    const L = (k: DetailMat) => { let b = local.get(k); if (!b) local.set(k, (b = new Buf())); return b; };
    try {
      cutDetail(L, frames[f.face], f, specs[i].poly, cells);
      for (const [k, b] of local) B(k).append(b);
    } catch (e) { specs[i].applied = false; console.warn('wall detail: cut skipped', f.kind, e); }
  });
  const tInsets = performance.now();
  const cutRes = cuts.commit();
  const tCut = performance.now();

  // --- flat layers, fittings ---------------------------------------------------------------------
  for (const f of plan.features) {
    const F = frames[f.face];
    try {
      if (f.layer === 'flush') flatFeature(B(f.cell === 'frieze' ? 'frieze' : 'flush'), F, f, LAYER_OFFSET.flush, friezeRect);
      else if (f.layer === 'decal') flatFeature(B('decal'), F, f, LAYER_OFFSET.decal);
      else if (f.layer === 'soft') flatFeature(B('soft'), F, f, LAYER_OFFSET.soft);
      else if (f.layer === 'proud') fitting(B, F, f);
    } catch (e) { console.warn('wall detail: feature skipped', f.kind, e); }
  }

  const tFlat = performance.now();
  // --- meshes ----------------------------------------------------------------------------------------
  const matFor: Record<DetailMat, () => THREE.Material | null> = {
    flush: () => dm.flush, decal: () => dm.decal, soft: () => dm.soft, cavity: () => dm.cavity,
    frieze: () => (friezeTex ? friezeMaterial(friezeTex) : null),
    steel: () => mats.get('steel'), rust: () => mats.get('rail'), cable: () => cableMaterial(mats),
  };
  let triangles = 0, vertices = 0;
  for (const k of ['cavity', 'flush', 'frieze', 'decal', 'steel', 'rust', 'cable', 'soft'] as DetailMat[]) {
    const b = bufs.get(k), geo = b?.geometry(), mat = matFor[k]();
    if (!geo || !mat) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `wall-detail-${k}`;
    mesh.matrixAutoUpdate = false;
    // Wall layers after the walls (opaque list is sorted by renderOrder first); they receive the
    // flashlight shadow like the wall under them (markShadows only marks depth-writing meshes).
    if (k === 'flush' || k === 'frieze' || k === 'decal' || k === 'soft') { mesh.renderOrder = k === 'soft' ? 0 : 1; mesh.receiveShadow = true; mesh.castShadow = false; }
    group.add(mesh);
    triangles += geo.index!.count / 3;
    vertices += geo.attributes.position.count;
  }
  group.updateMatrixWorld(true);
  world.add(group);

  const treatments: Partial<Record<Treatment, number>> = {};
  for (const pf of plan.faces) treatments[pf.treatment] = (treatments[pf.treatment] ?? 0) + 1;
  const stats: WallDetailStats = {
    faces: plan.faces.length, treatments, features: plan.counts,
    cuts: {planned: cutFeatures.length, applied: cutRes.applied, rejected: cutRes.rejected, wallMeshes: cutRes.meshes},
    dropped: plan.dropped, hotspots: plan.hotspots, drawCalls: group.children.length, triangles, vertices, wallTriangles: cutRes.triangles,
    textureBytes: tex.bytes + (friezeTex ? Math.round(1024 * 288 * 4 * 4 / 3) : 0), ms: Math.round(performance.now() - t0),
    timing: {plan: Math.round(tPlan - t0), insets: Math.round(tInsets - tPlan), cut: Math.round(tCut - tInsets), flat: Math.round(tFlat - tCut), meshes: Math.round(performance.now() - tFlat)},
  };
  group.userData.wallDetail = stats;
  const result: WallDetailResult = {group, stats, plan};
  group.userData.wallDetailResult = result;
  return result;
}

/** Inset prism, rim ring, rebar and rubble of an applied cut. */
function cutDetail(B: (k: DetailMat) => Buf, F: Frame, f: Feature, poly: [number, number][], cells: ReturnType<typeof atlasCells>): void {
  const breach = f.kind === 'breach';
  const ao = breach ? {front: 0.78, back: 0.42} : f.kind === 'recess' ? {front: 0.8, back: 0.55} : f.kind === 'spall' ? {front: 0.92, back: 0.8} : {front: 0.85, back: 0.78};
  if (f.kind === 'recess' && f.panel) {
    // Equipment panel on the recess back: proud of the back, still behind the wall plane.
    const d = f.depth ?? 0.12, pw = (f.s1 - f.s0) * 0.72, ph = (f.y1 - f.y0) * 0.66;
    faceBox(B('steel'), F, (f.s0 + f.s1) / 2, (f.y0 + f.y1) / 2 + 0.02, -d + 0.035, pw, ph, 0.07);
    faceBox(B('steel'), F, (f.s0 + f.s1) / 2 + pw * 0.3, (f.y0 + f.y1) / 2 + 0.02, -d + 0.075, 0.03, 0.08, 0.02);
  }
  insetPrism(B('cavity'), F, poly, f.depth ?? 0.015, cells[f.back ?? 'mortarBed'], cells[f.side ?? 'breakSide'], f.grid, ao);
  if (f.rim && f.center) rimRing(B('decal'), F, poly, [F.c0 + f.center[0] * F.dir, f.center[1]], cells[f.rim.cell], f.rim.w0, f.rim.w1, f.seed, LAYER_OFFSET.decal);
  for (const b of f.bars ?? []) {
    const a = b.axis === 's' ? pt(F, b.a0, b.at, -b.depth) : pt(F, b.at, b.a0, -b.depth);
    const e = b.axis === 's' ? pt(F, b.a1, b.at, -b.depth) : pt(F, b.at, b.a1, -b.depth);
    // A slight sag / bend where the concrete let go.
    const m = b.axis === 's' ? pt(F, (b.a0 + b.a1) / 2, b.at - 0.015, -b.depth + 0.02) : pt(F, b.at + 0.015, (b.a0 + b.a1) / 2, -b.depth + 0.02);
    cylinder(B('rust'), a, m, 0.007, 6);
    cylinder(B('rust'), m, e, 0.007, 6);
  }
  if (f.rubble) rubble(B('cavity'), F, f.s0, f.s1, F.f.y0, f.rubble, f.seed, cells.concreteRaw);
}

/** Proud service fittings: conduit / pipe runs with brackets and end boxes, tunnel cables, switch boxes. */
function fitting(B: (k: DetailMat) => Buf, F: Frame, f: Feature): void {
  const off = f.off ?? 0.04, r = f.radius ?? 0.012;
  if (f.kind === 'switchBox') { faceBox(B('steel'), F, (f.s0 + f.s1) / 2, (f.y0 + f.y1) / 2, 0.03, f.s1 - f.s0, f.y1 - f.y0, 0.06); return; }
  const path = f.path ?? [];
  if (path.length < 2) return;
  if (f.kind === 'cables') {
    const runs = f.runs ?? [0];
    for (const dy of runs) for (let i = 0; i + 1 < path.length; i++) cylinder(B('cable'), pt(F, path[i][0], path[i][1] + dy, off), pt(F, path[i + 1][0], path[i + 1][1] + dy, off), r, 6);
    const lo = Math.min(...runs), hi = Math.max(...runs);
    for (const s of stations(path, Math.max(1.5, f.brackets ?? 1.5))) {
      faceBox(B('steel'), F, s, path[0][1] + (lo + hi) / 2, off / 2 + 0.01, 0.04, hi - lo + 0.08, off + 0.02);
    }
    return;
  }
  const mat: DetailMat = f.kind === 'pipe' ? 'rust' : 'steel';
  for (let i = 0; i + 1 < path.length; i++) cylinder(B(mat), pt(F, path[i][0], path[i][1], off), pt(F, path[i + 1][0], path[i + 1][1], off), r, f.kind === 'pipe' ? 10 : 7);
  const vertical = Math.abs(path[0][0] - path[path.length - 1][0]) < 1e-3;
  for (const s of stations(path, Math.max(1.2, f.brackets ?? 1.2))) {
    if (vertical) { const y = s; faceBox(B('steel'), F, path[0][0], y, (off + r) / 2, r * 2 + 0.02, 0.025, off + r); }
    else faceBox(B('steel'), F, s, path[0][1], (off + r) / 2, 0.025, r * 2 + 0.02, off + r);
  }
  if (f.kind === 'conduit' && !vertical) for (const end of [path[0], path[path.length - 1]]) faceBox(B('steel'), F, end[0], end[1], 0.035, 0.1, 0.1, 0.07);
}

/** Bracket positions along a straight path (s for horizontal runs, y for vertical ones). */
function stations(path: [number, number][], every: number): number[] {
  const a = path[0], b = path[path.length - 1];
  const vertical = Math.abs(a[0] - b[0]) < 1e-3;
  const lo = vertical ? Math.min(a[1], b[1]) : Math.min(a[0], b[0]), hi = vertical ? Math.max(a[1], b[1]) : Math.max(a[0], b[0]);
  const n = Math.max(1, Math.round((hi - lo) / every));
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push(lo + (hi - lo) * (k === 0 ? 0.04 : k === n ? 0.96 : k / n));
  return out;
}
