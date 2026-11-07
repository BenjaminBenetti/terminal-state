// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-SCIENCE): draws BIG SKY WONDERS' wall-art kinds (gen/skyways/stores/kinds/
// science.ts: skySciStarMap — the star-map wall's mural, skySciChart — the periodic-table-style chart, skySciPoster — the kit posters,
// variant 0..2) — a slim aluminium frame and backing board (the shape materials, merged per material) and the flat art face showing its
// piece of the store's Codex atlas (gen/skyways/stores/scienceArt.generated.ts; cropped to the face's aspect, never stretched). A
// placement whose h differs from its kind's (the double height's mural, hung half as large again) is drawn scaled in x / y.
// The atlas material is made behind the loading screen (preloadScienceArt, called from world/skywaysDestRuntime.ts) through the level's
// resources (released with the level); before / without it the face is a plain light board (never drawn substitute art).
// Called by world/skywaysDestinations.ts buildSkywaysDestProp for these kinds only. Every mesh: userData.level, `prop-<kind>-<suffix>`.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PROP_DEFS, type PropPlacement} from '../gen/props';
import type {ShapeMat} from '../gen/propShapes';
import type {StationLayout} from '../gen/stationTypes';
import {SCI_ART_FACE, SCI_ART_FRAME, SCI_POSTER_VARIANTS, STORE_SCIENCE_KINDS, type StoreScienceKind} from '../gen/skyways/stores/kinds/science';
import {SCIENCE_ART, type ScienceArtPieceKey} from '../gen/skyways/stores/scienceArt.generated';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';

const KINDS: ReadonlySet<string> = new Set(STORE_SCIENCE_KINDS);
/** Is this one of the science store's wall-art kinds? */
export const isScienceArtKind = (kind: string): kind is StoreScienceKind => KINDS.has(kind);

/** The atlas piece a placement shows. */
export function scienceArtPiece(kind: StoreScienceKind, variant: number): ScienceArtPieceKey {
  if (kind === 'skySciStarMap') return 'starMap';
  if (kind === 'skySciChart') return 'chart';
  const n = SCI_POSTER_VARIANTS.length, v = ((Math.trunc(variant) % n) + n) % n;
  return SCI_POSTER_VARIANTS[v] === 'crystals' ? 'crystals' : SCI_POSTER_VARIANTS[v] === 'robot' ? 'robot' : 'chemistry';
}

// ---------------------------------------------------------------------------------------------
// The atlas material (one; set by the preload)

let artMat: THREE.Material | null = null;
let plainBoard: THREE.Material | null = null;
/** The preload hands in the atlas material (null: forget it). */
export function setScienceArtMaterial(m: THREE.Material | null): void { artMat = m; }
/** Does the art show (QA / tests)? */
export const scienceArtLoaded = (): boolean => artMat !== null;
function faceMaterial(): THREE.Material {
  if (artMat) return artMat;
  if (!plainBoard) { plainBoard = new SurfaceNodeMaterial({color: 0xd9d5cc, roughness: 0.85, metalness: 0}); plainBoard.name = 'skyways-science-board-plain'; }
  return plainBoard;
}

/** The level-resources host of the preload (world/skywaysDestRuntime.ts SkywaysDestHost). */
export interface ScienceArtHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>; own<T extends {dispose(): void}>(level: string, r: T): T};
}
/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'skyways';
const mats = new WeakMap<THREE.Texture, THREE.Material>();
/** Behind the loading screen: the atlas material when the layout placed any science wall art (else nothing). Never rejects. */
export async function preloadScienceArt(layout: Pick<StationLayout, 'props'>, host: ScienceArtHost): Promise<void> {
  if (!layout.props.some(p => isScienceArtKind(p.kind))) return;
  const tex = await host.levelResources.load(LEVEL, SCIENCE_ART.url, {srgb: true, repeat: false}).catch(() => null);
  if (!tex) { setScienceArtMaterial(null); return; }
  let m = mats.get(tex);
  if (!m) {
    // printed paper / board: matte
    m = host.levelResources.own(LEVEL, new SurfaceNodeMaterial({map: tex, roughness: 0.8, metalness: 0}));
    m.name = 'skyways-science-art';
    mats.set(tex, m);
  }
  setScienceArtMaterial(m);
}

// ---------------------------------------------------------------------------------------------
// Shape (prop frame: origin bottom centre, front +Z into the room, the back on the wall at z -d/2; metres)

interface Part { m: ShapeMat; s: readonly [number, number, number]; p: readonly [number, number, number] }
/** The frame bars and the backing board of a kind (its unscaled size) and its art face (w, h, centre). */
export function scienceArtShape(kind: StoreScienceKind): {parts: Part[]; face: {w: number; h: number; p: [number, number, number]}} {
  const {w, h} = SCI_ART_FACE[kind], f = SCI_ART_FRAME.bar, d = PROP_DEFS[kind].d;
  const parts: Part[] = [
    {m: 'steelBright', s: [w + 2 * f, f, d], p: [0, f / 2, 0]},
    {m: 'steelBright', s: [w + 2 * f, f, d], p: [0, h + 1.5 * f, 0]},
    {m: 'steelBright', s: [f, h, d], p: [-(w + f) / 2, h / 2 + f, 0]},
    {m: 'steelBright', s: [f, h, d], p: [(w + f) / 2, h / 2 + f, 0]},
    {m: 'panel', s: [w, h, 0.01], p: [0, h / 2 + f, -d / 2 + 0.005]},
  ];
  return {parts, face: {w, h, p: [0, h / 2 + f, -d / 2 + 0.012]}};
}

const UP = new THREE.Vector3(0, 1, 0);
/** World matrix of a placement, scaled in x / y by its h over its kind's h (the wall depth stays). */
function placeM(p: PropPlacement): THREE.Matrix4 {
  const h = PROP_DEFS[p.kind].h, s = h > 0 && Math.abs(p.h / h - 1) > 0.005 ? p.h / h : 1;
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(s, s, 1));
}
function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string): void {
  geo.computeBoundingSphere();
  const byLevel = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byLevel.get(p.level ?? 0); if (l) l.push(p); else byLevel.set(p.level ?? 0, [p]); }
  for (const [level, ps] of byLevel) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}

/** Renders one science wall-art kind's placements (frames + art faces). Returns the instance count. */
export function drawScienceArt(group: THREE.Group, kind: StoreScienceKind, list: readonly PropPlacement[], wm: WorldMaterials): number {
  if (!list.length) return 0;
  const {parts, face} = scienceArtShape(kind), pm = shapeMaterials(wm);
  const byMat = new Map<ShapeMat, THREE.BufferGeometry[]>();
  for (const part of parts) {
    const g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
    g.translate(part.p[0], part.p[1], part.p[2]);
    let l = byMat.get(part.m);
    if (!l) byMat.set(part.m, (l = []));
    l.push(g);
  }
  for (const [m, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    instanced(group, geo, pm[m], list, `prop-${kind}-${m}`);
  }
  // one art quad per piece shown
  const byPiece = new Map<ScienceArtPieceKey, PropPlacement[]>();
  for (const p of list) { const k = scienceArtPiece(kind, p.variant); const l = byPiece.get(k); if (l) l.push(p); else byPiece.set(k, [p]); }
  for (const [piece, ps] of byPiece) {
    const g = new THREE.PlaneGeometry(face.w, face.h), r = scienceArtCrop(piece, face.w / face.h), uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    g.translate(face.p[0], face.p[1], face.p[2]);
    instanced(group, g, faceMaterial(), ps, `prop-${kind}-art-${piece}`);
  }
  return list.length;
}

/** A piece's UV rect cropped (centred) to a face aspect, so a face never stretches its art. */
export function scienceArtCrop(piece: ScienceArtPieceKey, faceAspect: number): {u0: number; v0: number; u1: number; v1: number} {
  const r = SCIENCE_ART.pieces[piece];
  if (r.aspect > faceAspect) { const k = faceAspect / r.aspect, du = (r.u1 - r.u0) * (1 - k) / 2; return {u0: r.u0 + du, v0: r.v0, u1: r.u1 - du, v1: r.v1}; }
  const k = r.aspect / faceAspect, dv = (r.v1 - r.v0) * (1 - k) / 2;
  return {u0: r.u0, v0: r.v0 + dv, u1: r.u1, v1: r.v1 - dv};
}
