// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-BOOKS): draws Paper Prairie Books' two code-drawn kinds
// (gen/skyways/stores/kinds/books.ts) and loads their art:
//  - skyBooksSign: the carved walnut category header — a walnut board (the shape library's wood) with lane STORE-BOOKS' Codex sign art
//    on BOTH faces (the back quad turned half round, so its lettering reads from behind: island end-caps are seen from either side), the face
//    quad sized to the piece's own aspect (never stretched); a table sign is the same board drawn at its placement's scale (p.h / def.h);
//  - skyBooksRug: the rug's art on a flat quad 1.2 cm over the floor (the rug's pile height).
// The art is one atlas (gen/skyways/stores/booksArt.generated.ts: crop / resize / pack of two Codex native image_gen outputs), loaded
// behind the loading screen through LevelResources (released with the level) by the section preload this module installs; before /
// without it the faces show a plain stand-in (the board's wood, a plain rug colour: never substitute drawn art). Instanced per storey
// (userData.level: the level culler), meshes named `prop-<kind>-<suffix>` (damage / physics find each instance). Nothing per frame.
// Hooked by world/skywaysDestinations.ts (buildSkywaysDestProp) and world/skywaysDestRuntime.ts (installSkywaysDestinations).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {PROP_DEFS, levelArtWanted, type PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {BOOKS_ART, type BooksArtKey} from '../gen/skyways/stores/booksArt.generated';
import {BOOKS_RUG_PIECES, BOOKS_RUG_SIZE, BOOKS_SIGN_BOARD, BOOKS_SIGN_PIECES} from '../gen/skyways/stores/kinds/books';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';

export const STORE_BOOKS_DRAWN_KINDS: readonly string[] = ['skyBooksSign', 'skyBooksRug'];
/** Is `kind` one of the bookshop's code-drawn kinds (this module draws it)? */
export const isStoreBooksDrawnKind = (kind: string): boolean => STORE_BOOKS_DRAWN_KINDS.includes(kind);

// ---------------------------------------------------------------------------------------------
// The atlas material (set by the section preload; a plain stand-in until then)

let artMat: THREE.Material | null = null;
let plainSign: THREE.Material | null = null, plainRug: THREE.Material | null = null;
/** The preload hands in the atlas material (null: forget it). */
export function setStoreBooksArtMaterial(m: THREE.Material | null): void { artMat = m; }
/** Does the bookshop's art show (QA / tests)? */
export const storeBooksArtLoaded = (): boolean => artMat !== null;
function faceMaterial(kind: 'skyBooksSign' | 'skyBooksRug'): THREE.Material {
  if (artMat) return artMat;
  if (kind === 'skyBooksSign') {
    if (!plainSign) { plainSign = new SurfaceNodeMaterial({color: 0x3a2416, roughness: 0.7, metalness: 0}); plainSign.name = 'store-books-sign-plain'; }
    return plainSign;
  }
  if (!plainRug) { plainRug = new SurfaceNodeMaterial({color: 0x6e3a30, roughness: 0.95, metalness: 0}); plainRug.name = 'store-books-rug-plain'; }
  return plainRug;
}

/** The atlas piece a sign / rug variant shows. */
export function storeBooksPiece(kind: 'skyBooksSign' | 'skyBooksRug', variant: number): BooksArtKey {
  const list = kind === 'skyBooksSign' ? BOOKS_SIGN_PIECES : BOOKS_RUG_PIECES, n = list.length;
  return list[((Math.trunc(variant) % n) + n) % n];
}

// ---------------------------------------------------------------------------------------------
// Geometry (prop frame: origin bottom centre, front +Z, metres)

/** A quad w x h (XY plane, facing +Z) with an atlas piece's UVs. */
function pieceQuad(w: number, h: number, key: BooksArtKey): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h), r = BOOKS_ART.pieces[key], uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  return g;
}

/** The sign's art faces for a variant: the front at +Z, the back at -Z (the same quad turned half round: it reads left to right from
 *  behind too); sized to the piece's aspect. */
export function storeBooksSignFaces(variant: number): THREE.BufferGeometry {
  const key = storeBooksPiece('skyBooksSign', variant), B = BOOKS_SIGN_BOARD;
  const w = B.face.w, h = Math.min(B.face.h + 0.008, w / BOOKS_ART.pieces[key].aspect), y = B.h / 2;
  const front = pieceQuad(w, h, key);
  front.translate(0, y, B.d / 2 + 0.0015);
  const back = pieceQuad(w, h, key);
  back.rotateY(Math.PI);
  back.translate(0, y, -B.d / 2 - 0.0015);
  const g = mergeGeometries([front, back], false);
  front.dispose(); back.dispose();
  return g;
}

/** The rug's quad for a variant (flat, facing up, at its pile height). */
export function storeBooksRugFace(variant: number): THREE.BufferGeometry {
  const g = pieceQuad(BOOKS_RUG_SIZE.w, BOOKS_RUG_SIZE.d, storeBooksPiece('skyBooksRug', variant));
  g.rotateX(-Math.PI / 2);
  g.translate(0, BOOKS_RUG_SIZE.h, 0);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
/** A placement's matrix (a scaled sign: its own uniform scale p.h / def.h). */
function placeM(p: PropPlacement): THREE.Matrix4 {
  const h = PROP_DEFS[p.kind].h, s = p.kind === 'skyBooksSign' && h > 0 && Math.abs(p.h / h - 1) > 0.005 ? p.h / h : 1;
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(s, s, s));
}

function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string): number {
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
  return list.length;
}

/** Renders the bookshop's code-drawn kinds (world/skywaysDestinations.ts buildSkywaysDestProp). Returns the instance count. */
export function buildStoreBooksProp(group: THREE.Group, kind: string, list: PropPlacement[], wm: WorldMaterials): number {
  if (!list.length) return 0;
  const byVariant = new Map<number, PropPlacement[]>();
  for (const p of list) { const l = byVariant.get(p.variant); if (l) l.push(p); else byVariant.set(p.variant, [p]); }
  if (kind === 'skyBooksSign') {
    const B = BOOKS_SIGN_BOARD, board = new THREE.BoxGeometry(B.w, B.h, B.d);
    board.translate(0, B.h / 2, 0);
    instanced(group, board, shapeMaterials(wm).wood, list, 'prop-skyBooksSign-board');
    for (const [v, ps] of byVariant) instanced(group, storeBooksSignFaces(v), faceMaterial('skyBooksSign'), ps, `prop-skyBooksSign-art${v}`);
    return list.length;
  }
  if (kind === 'skyBooksRug') {
    for (const [v, ps] of byVariant) instanced(group, storeBooksRugFace(v), faceMaterial('skyBooksRug'), ps, `prop-skyBooksRug-art${v}`);
    return list.length;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// The section preload (installed by world/skywaysDestRuntime.ts installSkywaysDestinations)

/** Longest wait for the atlas before the world is built (then: the plain stand-ins). */
export const STORE_BOOKS_ART_WAIT_MS = 6000;
/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'skyways';

export interface StoreBooksHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>; own<T extends {dispose(): void}>(level: string, r: T): T};
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
}

/** Installs the atlas preload: inert unless the layout places a sign / rug. Never rejects. */
export function installSkywaysStoreBooks(host: StoreBooksHost): void {
  const mats = new WeakMap<THREE.Texture, THREE.Material>();
  const preload = async (layout: StationLayout): Promise<void> => {
    if (!layout.props.some(p => isStoreBooksDrawnKind(p.kind))) return;
    const tex = await host.levelResources.load(LEVEL, BOOKS_ART.url, {srgb: true, repeat: false}).catch(() => null);
    if (!tex) { setStoreBooksArtMaterial(null); return; }
    let m = mats.get(tex);
    if (!m) {
      // painted / varnished boards and wool pile: matte
      m = host.levelResources.own(LEVEL, new SurfaceNodeMaterial({map: tex, roughness: 0.82, metalness: 0}));
      m.name = 'store-books-art';
      mats.set(tex, m);
    }
    setStoreBooksArtMaterial(m);
  };
  host.sectionPreloads?.push(layout => (levelArtWanted(layout, !!layout.skyways) ? Promise.race([preload(layout), new Promise<void>(r => setTimeout(r, STORE_BOOKS_ART_WAIT_MS))]) : Promise.resolve()));
}
