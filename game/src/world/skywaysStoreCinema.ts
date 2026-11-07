// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-CINEMA): draws the Aurora Picture House's three ART kinds (the NOW SHOWING
// poster cases, the freestanding poster stands, the concession's REFRESHMENTS board: gen/skyways/stores/kinds/cinema.ts) and preloads
// their Codex art atlas. Called from world/skywaysDestinations.ts buildSkywaysDestProp for these kinds only (one dispatch line).
//
//  - Box parts (gen/skyways/stores/cinemaArt.ts cinemaArtShape: the black backing, the brass frame bars, the case's glass) merged per
//    material and instanced per storey (`prop-<kind>-<material>`: damage / the loose-prop physics find each instance), the brass a
//    polished-brass colour (no texture), the rest the shared shape materials;
//  - the art: one quad per variant (`prop-<kind>-art<variant>`) with the atlas piece cropped to the face's aspect, a lit poster case /
//    board a little self-lit (a backlit case). The atlas material is made behind the loading screen (preloadStoreCinemaArt, through the
//    level's LevelResources: released with the level); before / without it a plain board stands in (never substitute drawn art).
// Every mesh carries userData.level (the level culler).

import * as THREE from 'three';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {cinemaArtAtlas, cinemaArtCrop, cinemaArtPiece, cinemaArtShape, type CinemaArtKind, type CinemaFace, type CinemaPart, type CinemaPartMat} from '../gen/skyways/stores/cinemaArt';
import {STORE_CINEMA_KINDS} from '../gen/skyways/stores/kinds/cinema';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';

const KINDS: ReadonlySet<string> = new Set(STORE_CINEMA_KINDS);
/** Is this one of the cinema's art kinds (drawn here)? */
export const isStoreCinemaArtKind = (kind: string): kind is CinemaArtKind => KINDS.has(kind);

// ---------------------------------------------------------------------------------------------
// Materials

/** The art material per glow level (set by the preload; absent: the plain board). */
const ART = new Map<number, THREE.Material>();
let artTexture: THREE.Texture | null = null;
let plainBoard: THREE.Material | null = null;
let brass: THREE.Material | null = null;

/** The preload hands in the atlas texture (null: forget it); the per-glow materials are made from it on demand. */
export function setStoreCinemaArtTexture(tex: THREE.Texture | null, own?: <T extends {dispose(): void}>(r: T) => T): void {
  if (tex === artTexture) return;
  ART.clear();
  artTexture = tex;
  if (tex) for (const glow of [0, 0.35, 0.45]) {
    // matte printed paper; a backlit case / board self-lit by its own art
    const m = new SurfaceNodeMaterial(glow > 0 ? {map: tex, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow} : {map: tex, roughness: 0.78, metalness: 0});
    m.name = `skyways-store-cinema-art-${glow}`;
    ART.set(glow, own ? own(m) : m);
  }
}
/** Does the art show (QA / tests)? */
export const storeCinemaArtLoaded = (): boolean => ART.size > 0;
function artMaterial(glow: number): THREE.Material {
  const m = ART.get(glow);
  if (m) return m;
  if (!plainBoard) { plainBoard = new SurfaceNodeMaterial({color: 0xd9d5cc, roughness: 0.85, metalness: 0}); plainBoard.name = 'skyways-store-cinema-board-plain'; }
  return plainBoard;
}
function partMaterial(m: CinemaPartMat, wm: WorldMaterials): THREE.Material {
  if (m !== 'brass') return shapeMaterials(wm)[m];
  if (!brass) { brass = new SurfaceNodeMaterial({color: 0xb8913a, roughness: 0.35, metalness: 0.75}); brass.name = 'skyways-store-cinema-brass'; }
  return brass;
}

// ---------------------------------------------------------------------------------------------
// Geometry

const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

function partGeo(part: CinemaPart): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(part.s[0], part.s[1], part.s[2]);
  g.translate(part.p[0], part.p[1], part.p[2]);
  return g;
}
/** The art quad: its atlas piece cropped to the face's aspect (no atlas: the whole quad, the plain board). */
export function storeCinemaFaceGeometry(f: CinemaFace): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(f.w, f.h);
  const piece = cinemaArtPiece(f.piece);
  if (piece) {
    const r = cinemaArtCrop(piece, f.w / f.h), uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  }
  g.translate(f.p[0], f.p[1], f.p[2]);
  return g;
}

/** Instanced per storey (userData.level), named `prop-<kind>-<suffix>`. */
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

/** Renders one cinema art kind's placements: its box parts and one art quad per variant. Returns the instance count. */
export function buildStoreCinemaArt(group: THREE.Group, kind: CinemaArtKind, list: readonly PropPlacement[], wm: WorldMaterials): number {
  if (!list.length) return 0;
  const byMat = new Map<CinemaPartMat, THREE.BufferGeometry[]>();
  for (const part of cinemaArtShape(kind, 0).parts) { let l = byMat.get(part.m); if (!l) byMat.set(part.m, (l = [])); l.push(partGeo(part)); }
  for (const [m, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) for (const g of geos) g.dispose();
    instanced(group, geo, partMaterial(m, wm), list, `prop-${kind}-${m}`);
  }
  const byVariant = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byVariant.get(p.variant); if (l) l.push(p); else byVariant.set(p.variant, [p]); }
  for (const [variant, ps] of byVariant) {
    const {face} = cinemaArtShape(kind, variant);
    instanced(group, storeCinemaFaceGeometry(face), artMaterial(face.glow), ps, `prop-${kind}-art${variant}`);
  }
  return list.length;
}

// ---------------------------------------------------------------------------------------------
// Preload (behind the loading screen)

/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'skyways';
export interface StoreCinemaArtHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>; own<T extends {dispose(): void}>(level: string, r: T): T};
}
/** Counters (QA / tests). */
export const STORE_CINEMA_ART_COUNTS = {loaded: 0, missing: 0};

/** The atlas, when this layout placed any cinema art kind (else nothing). Never rejects. */
export async function preloadStoreCinemaArt(host: StoreCinemaArtHost, layout: StationLayout): Promise<void> {
  if (!layout.props.some(p => KINDS.has(p.kind))) return;
  const rec = cinemaArtAtlas();
  const tex = rec ? await host.levelResources.load(LEVEL, rec.url, {srgb: true, repeat: false}).catch(() => null) : null;
  if (!tex) { setStoreCinemaArtTexture(null); STORE_CINEMA_ART_COUNTS.missing++; return; }
  setStoreCinemaArtTexture(tex, r => host.levelResources.own(LEVEL, r));
  STORE_CINEMA_ART_COUNTS.loaded++;
}
