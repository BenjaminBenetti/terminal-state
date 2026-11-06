// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): draws EVERY Skyways DESTINATION prop kind (all three lanes'
// kinds: gen/skyways/destinations/registry.ts SKYWAYS_DEST_SPECS — data-driven, so a lane adding kinds needs no edit here) on its
// placements. Called by world/builder.ts for those kinds only (nothing changes for any other kind or level). Like world/skywaysAddon.ts:
//
//  - MODEL kinds (a spec `model` key): the lazy, level-only `skyways-d-*` library models (gen/skyways/destinations/skywaysDestModels.ts,
//    game.ts sectionModelKeys), front +Z like the prop frame (no turn), uniformly fitted to the model table's real size (k = min(row w
//    / model x, row d / model z): the measured runtime files ~1) and grounded at the placement's y — so a hung piece (the geese, the
//    canoe, the planet mobile) is drawn where the dresser hung it. Instanced per storey through the builder's instanceModel
//    (`prop-<kind>` meshes: damage/propDamage.ts and the loose-prop physics find each instance like every model prop). A placement
//    whose h differs from its kind's h was scaled by its dresser to fit a low court: drawn uniformly scaled by p.h / def.h. Hung rows
//    get their suspension cables drawn straight up to the ceiling over them (render only). Not loaded (Node tests, a 404, a row still
//    `planned`): a plain box stand-in of the model's size in the existing shape materials (never presented as the art; the collision
//    is the same either way). Collision-only placements (a hero's upper part: kindsLandmarks.ts destCollisionOnly) draw nothing.
//  - ART kinds (skyDPoster wall posters, skyDPlaque court plaques): their frame / lectern boxes (merged per shape material) and a flat
//    quad of lane ART2D's Codex atlas piece (gen/skyways/destinations/skywaysDestArtMap.ts; cropped to the face's aspect, never
//    stretched). The atlas materials are made by world/skywaysDestRuntime.ts behind the loading screen and handed in with
//    setSkywaysDestArtMaterial; before / without them (or without the atlas table) a plain light board stands in.
// Every mesh carries userData.level (the level culler) and a `prop-<kind>[-<suffix>]` name.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import type {ShapeMat} from '../gen/propShapes';
import type {StationLayout} from '../gen/stationTypes';
import {DEST_POSTER} from '../gen/skyways/destinations/art';
import {DEST_PLAQUE, destCollisionOnly} from '../gen/skyways/destinations/kindsLandmarks';
import type {SkywaysDestKind} from '../gen/skyways/destinations/registry';
import {destHangCables, destModelHung, destModelKey, destModelOf, destModelRow} from '../gen/skyways/destinations/skywaysDestModels';
import {destArtCrop, destArtOf, destArtPiece, type DestArtAtlasKey} from '../gen/skyways/destinations/skywaysDestArtMap';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';

type Fit = {w: number; h: number; d: number; anchor: 'bottom' | 'top'};
type InstanceModel = (group: THREE.Group, gltf: GLTF, placements: THREE.Matrix4[], fit: Fit, name: string) => number;

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));
/** Suspension cable section (m). */
export const DEST_CABLE = {t: 0.012, maxLen: 12} as const;

// ---------------------------------------------------------------------------------------------
// Art materials (one per atlas; set by the runtime's preload)

const ART = new Map<DestArtAtlasKey, THREE.Material>();
let plainBoard: THREE.Material | null = null;
/** The runtime hands in an atlas's material (null: forget it). */
export function setSkywaysDestArtMaterial(atlas: DestArtAtlasKey, m: THREE.Material | null): void {
  if (m) ART.set(atlas, m); else ART.delete(atlas);
}
/** The atlas material, or the plain board stand-in when the atlas is not loaded (never drawn art). */
export function skywaysDestArtMaterial(atlas: DestArtAtlasKey): THREE.Material {
  const m = ART.get(atlas);
  if (m) return m;
  if (!plainBoard) { plainBoard = new SurfaceNodeMaterial({color: 0xd9d5cc, roughness: 0.85, metalness: 0}); plainBoard.name = 'skyways-dest-board-plain'; }
  return plainBoard;
}
/** Does the art of this atlas show (QA / tests)? */
export const skywaysDestArtLoaded = (atlas: DestArtAtlasKey): boolean => ART.has(atlas);
/** The atlases the art kinds among `kinds` show. */
export function skywaysDestAtlases(kinds: Iterable<string>): DestArtAtlasKey[] {
  const out = new Set<DestArtAtlasKey>();
  for (const k of kinds) { if (k === 'skyDPoster') out.add('posters'); if (k === 'skyDPlaque') out.add('plaques'); }
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------
// Art kinds: frame / lectern parts and the art face (prop frame: origin bottom centre, front +Z, metres)

export interface DestPart { m: ShapeMat; s: readonly [number, number, number]; p: readonly [number, number, number]; rx?: number }
export interface DestFace { atlas: DestArtAtlasKey; piece: string; w: number; h: number; p: readonly [number, number, number]; rx?: number }

/** Boxes and the art face of a poster (aluminium snap frame on the wall, the paper inside) or a plaque (cast head on a pedestal). */
export function skywaysDestArtShape(kind: 'skyDPoster' | 'skyDPlaque', variant: number): {parts: DestPart[]; face: DestFace} {
  const parts: DestPart[] = [];
  const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number], rx?: number) => parts.push({m, s, p, ...(rx ? {rx} : {})});
  const {atlas, piece} = destArtOf(kind, variant);
  if (kind === 'skyDPoster') {
    // the frame's back on the wall (z -d/2); bars round the paper, a backing board under it
    const {w, h} = DEST_POSTER, f = 0.02, d = PROP_DEFS.skyDPoster.d;
    box('steelBright', [w + 2 * f, f, d], [0, f / 2, 0]); box('steelBright', [w + 2 * f, f, d], [0, h + 1.5 * f, 0]);
    box('steelBright', [f, h, d], [-(w + f) / 2, h / 2 + f, 0]); box('steelBright', [f, h, d], [(w + f) / 2, h / 2 + f, 0]);
    box('panel', [w, h, 0.01], [0, h / 2 + f, -d / 2 + 0.005]);
    return {parts, face: {atlas, piece, w, h, p: [0, h / 2 + f, -d / 2 + 0.011]}};
  }
  // lectern: a base plate bolted down, a cast post, the sloped cast head (faces up and toward +Z) carrying the plaque art
  const H = PROP_DEFS.skyDPlaque.h, W = PROP_DEFS.skyDPlaque.w, t = DEST_PLAQUE.tilt, slab = 0.54, th = 0.05;
  const vert = slab * Math.cos(t) + th * Math.abs(Math.sin(t)), cy = H - vert / 2 - 0.002;
  box('steelDark', [0.56, 0.05, 0.32], [0, 0.025, 0]);
  box('steelDark', [0.14, cy - 0.05, 0.12], [0, 0.05 + (cy - 0.05) / 2, -0.02]);
  box('steelDark', [W, slab, th], [0, cy, 0], t);
  const off = th / 2 + 0.002, ny = -Math.sin(t), nz = Math.cos(t);
  return {parts, face: {atlas, piece, w: DEST_PLAQUE.w, h: DEST_PLAQUE.h, p: [0, cy + ny * off, nz * off], rx: t}};
}

/** The quad of an art face: its atlas piece cropped to the face's aspect (null rect: the whole quad, the plain board). */
export function destFaceGeometry(f: DestFace): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(f.w, f.h);
  const piece = destArtPiece(f.atlas, f.piece);
  if (piece) {
    const r = destArtCrop(piece, f.w / f.h), uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  }
  if (f.rx) g.rotateX(f.rx);
  g.translate(f.p[0], f.p[1], f.p[2]);
  return g;
}

function partGeo(part: DestPart): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
  if (part.rx) g.rotateX(part.rx);
  g.translate(part.p[0], part.p[1], part.p[2]);
  return g;
}

const byLevel = <T extends {level?: number}>(list: readonly T[]) => {
  const m = new Map<number, T[]>();
  for (const p of list) { const l = m.get(p.level ?? 0); if (l) l.push(p); else m.set(p.level ?? 0, [p]); }
  return m;
};

/** Instanced per storey (userData.level: the level culler), named `prop-<kind>-<suffix>` (damage / physics find each instance). */
function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string, local?: (p: PropPlacement) => THREE.Matrix4): number {
  geo.computeBoundingSphere();
  for (const [level, ps] of byLevel(list)) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, local ? placeM(p).multiply(local(p)) : placeM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
  return list.length;
}

/** Boxes merged per shape material, instanced on `list`. */
function drawParts(group: THREE.Group, kind: string, parts: readonly DestPart[], list: readonly PropPlacement[], wm: WorldMaterials, local?: (p: PropPlacement) => THREE.Matrix4): void {
  const pm = shapeMaterials(wm), byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const part of parts) { let l = byMat.get(part.m); if (!l) byMat.set(part.m, (l = [])); l.push(partGeo(part)); }
  for (const [m, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    instanced(group, geo, pm[m], list, `prop-${kind}-${m}`, local);
  }
}

/** Posters / plaques: the frame (same for every variant) and one art quad geometry per variant. */
function drawArt(group: THREE.Group, kind: 'skyDPoster' | 'skyDPlaque', list: readonly PropPlacement[], wm: WorldMaterials): number {
  drawParts(group, kind, skywaysDestArtShape(kind, 0).parts, list, wm);
  const byVariant = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byVariant.get(p.variant); if (l) l.push(p); else byVariant.set(p.variant, [p]); }
  for (const [variant, ps] of byVariant) {
    const {face} = skywaysDestArtShape(kind, variant);
    instanced(group, destFaceGeometry(face), skywaysDestArtMaterial(face.atlas), ps, `prop-${kind}-art${variant}`);
  }
  return list.length;
}

// ---------------------------------------------------------------------------------------------
// Model kinds

const sizes = new WeakMap<object, THREE.Vector3>();
function sizeOf(o: THREE.Object3D): THREE.Vector3 {
  let v = sizes.get(o);
  if (!v) { o.updateMatrixWorld(true); v = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); sizes.set(o, v); }
  return v;
}

/** Uniform runtime fit of a model kind: k = min(row w / model x, row d / model z) — the model table's real size (measured files: k ~ 1). */
export function skywaysDestFit(kind: SkywaysDestKind, size: {x: number; y: number; z: number}): Fit & {k: number} {
  const m = destModelOf(kind), row = m ? destModelRow(m) : PROP_DEFS[kind];
  const k = Math.min(row.w / (size.x || 1), row.d / (size.z || 1));
  return {w: size.x * k, h: size.y * k, d: size.z * k, anchor: 'bottom', k};
}
/** The uniform scale a placement is drawn at (its dresser shrank it to fit: p.h / def.h; else 1). */
export function destPlacementScale(p: PropPlacement): number {
  const h = PROP_DEFS[p.kind].h, s = h > 0 ? p.h / h : 1;
  return Math.abs(s - 1) < 0.005 || !(s > 0) ? 1 : s;
}
const scaleM = (p: PropPlacement) => { const s = destPlacementScale(p); return new THREE.Matrix4().makeScale(s, s, s); };

/** The cables of hung placements: from each attachment point straight up to the ceiling over it (the placement's storey grid). */
function drawCables(group: THREE.Group, kind: string, list: readonly PropPlacement[], wm: WorldMaterials, layout: StationLayout | undefined, k: number): void {
  const m = destModelOf(kind as SkywaysDestKind);
  if (!m || !destModelHung(m) || !layout) return;
  const {y, xs} = destHangCables(m);
  const mats: {level: number; m: THREE.Matrix4}[] = [];
  for (const p of list) {
    const g = layout.levels?.[p.level ?? 0]?.grid ?? layout.grid, s = destPlacementScale(p) * k, c = Math.cos(p.rot), sn = Math.sin(p.rot);
    for (const ox of xs) {
      const wx = p.x + ox * s * c, wz = p.z - ox * s * sn, y0 = p.y + y * s, ceil = g.ceilAt(wx, wz);
      // (no ceiling recorded over it: no cable rather than one into the sky)
      const len = Number.isFinite(ceil) ? Math.min(DEST_CABLE.maxLen, ceil - y0) : 0;
      if (len < 0.05) continue;
      mats.push({level: p.level ?? 0, m: new THREE.Matrix4().makeTranslation(wx, y0, wz).multiply(new THREE.Matrix4().makeScale(1, len, 1))});
    }
  }
  if (!mats.length) return;
  const geo = new THREE.BoxGeometry(DEST_CABLE.t, 1, DEST_CABLE.t);
  geo.translate(0, 0.5, 0);
  geo.computeBoundingSphere();
  for (const [level, ms] of byLevel(mats)) {
    const im = new THREE.InstancedMesh(geo, shapeMaterials(wm).steelDark, ms.length);
    ms.forEach((e, i) => im.setMatrixAt(i, e.m));
    im.name = `prop-${kind}-cable`;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}

/** Box stand-in of a model kind (the model table's size; a code-drawn kind without art: its footprint). */
function standIn(group: THREE.Group, kind: SkywaysDestKind, list: readonly PropPlacement[], wm: WorldMaterials): number {
  const m = destModelOf(kind), row = m ? destModelRow(m) : PROP_DEFS[kind];
  drawParts(group, kind, [{m: 'porcelain', s: [row.w, row.h, row.d], p: [0, row.h / 2, 0]}], list, wm, scaleM);
  return list.length;
}

/** Renders one destination kind's placements (models when loaded, else stand-ins; art panels). Returns the instance count. */
export function buildSkywaysDestProp(group: THREE.Group, kind: SkywaysDestKind, list: PropPlacement[], wm: WorldMaterials, instanceModel: InstanceModel,
  lib: Readonly<Record<string, GLTF | undefined>>, layout?: StationLayout): number {
  const draw = list.filter(p => !destCollisionOnly(p));
  if (!draw.length) return 0;
  if (kind === 'skyDPoster' || kind === 'skyDPlaque') return drawArt(group, kind, draw, wm);
  const m = destModelOf(kind);
  const gltf = m ? lib[destModelKey(m)] : undefined;
  if (!gltf) { const n = standIn(group, kind, draw, wm); drawCables(group, kind, draw, wm, layout, 1); return n; }
  const fit = skywaysDestFit(kind, sizeOf(gltf.scene));
  const n = instanceModel(group, gltf, draw.map(p => placeM(p).multiply(scaleM(p))), fit, kind);
  // the cables attach on the model as drawn (row frame x fit k: the measured files k ~ 1)
  const row = destModelRow(m!);
  drawCables(group, kind, draw, wm, layout, fit.h / (row.h || fit.h));
  return n;
}
