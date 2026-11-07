// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-MUSIC): DRAWS Northern Groove Records' own kinds (gen/skyways/stores/
// kinds/music.ts) — called by world/skywaysDestinations.ts buildSkywaysDestProp for those kinds only:
//  - the RECORD STOCK: skyMuBinRecords (a filed block of ten-inch sleeves in one bin bay; one geometry per block style, built from the
//    same pure data the dresser placed it with: gen/skyways/stores/musicStock.ts binBlock) and skyMuFacedRecords (twelve-inch LPs stood
//    face-out on a ledge). Every sleeve is a thin card slab: its front face shows a cover of the Codex covers atlas, its top / side edges
//    a sliver of that cover's own edge (a sleeve's folded card), the rearmost sleeve's back another cover (the record's back);
//  - the drawn fixtures / equipment (turntable, headphones, counter stool, the new-arrivals board, the genre cards, gig posters, the
//    booths' sign): boxes / cylinders in the shared shape materials (gen/skyways/stores/musicShapes.ts), merged per material, and their
//    flat art faces from the Codex signs atlas.
// Instanced per storey (userData.level: the level culler), named `prop-<kind>-<suffix>` so damage/propDamage.ts and the loose-prop
// physics find each instance like every model prop. The two atlases come from world/skywaysDestRuntime.ts's preload
// (preloadStoreMusicArt: level-only textures released with the level); without them a plain card / board stands in (never drawn art).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import type {ShapeMat} from '../gen/propShapes';
import {BIN_SLEEVE, COVER_WALL, LP_SLEEVE, MUSIC_COVER_COUNT, binBlock, facedLean, facedRow} from '../gen/skyways/stores/musicStock';
import {MUSIC_GENRES, binLabelParts, coverWallParts, headphonesParts, posterParts, signParts, stoolParts, turntableParts, type MusicFace, type MusicPart} from '../gen/skyways/stores/musicShapes';
import {MUSIC_ART} from '../gen/skyways/stores/musicArt';
import {STORE_MUSIC_KINDS, type StoreMusicKind} from '../gen/skyways/stores/kinds/music';
import {shapeMaterials} from './shapeMaterials';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';

const KIND_SET: ReadonlySet<string> = new Set(STORE_MUSIC_KINDS);
export const isStoreMusicKind = (k: string): k is StoreMusicKind => KIND_SET.has(k);
export type MusicAtlas = 'covers' | 'signs';

// ---------------------------------------------------------------------------------------------
// Atlas materials (set by the preload)

const ART = new Map<MusicAtlas, THREE.Material>();
const PLAIN = new Map<MusicAtlas, THREE.Material>();
export function setStoreMusicArtMaterial(atlas: MusicAtlas, m: THREE.Material | null): void { if (m) ART.set(atlas, m); else ART.delete(atlas); }
/** The atlas material, or the plain stand-in (sleeves: bare grey-brown card; boards: a light board) when the atlas is not loaded. */
export function storeMusicArtMaterial(atlas: MusicAtlas): THREE.Material {
  const m = ART.get(atlas);
  if (m) return m;
  let p = PLAIN.get(atlas);
  if (!p) { p = new SurfaceNodeMaterial({color: atlas === 'covers' ? 0x8a7d6c : 0xd9d5cc, roughness: 0.85, metalness: 0}); p.name = `store-music-${atlas}-plain`; PLAIN.set(atlas, p); }
  return p;
}
export const storeMusicArtLoaded = (atlas: MusicAtlas): boolean => ART.has(atlas);
/** The atlases a layout's placed music kinds show. */
export function storeMusicAtlases(kinds: Iterable<string>): MusicAtlas[] {
  const out = new Set<MusicAtlas>();
  for (const k of kinds) {
    if (k === 'skyMuBinRecords' || k === 'skyMuFacedRecords') out.add('covers');
    if (k === 'skyMuCoverWall' || k === 'skyMuBinLabel' || k === 'skyMuGigPoster' || k === 'skyMuSign') out.add('signs');
  }
  return [...out].sort();
}

export interface StoreMusicHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>; own<T extends {dispose(): void}>(level: string, r: T): T};
}
/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'skyways';
const URLS: Readonly<Record<MusicAtlas, string>> = {covers: MUSIC_ART.covers.url, signs: MUSIC_ART.signs.url};
const MATS = new WeakMap<THREE.Texture, THREE.Material>();
/** Behind the loading screen: the atlases this layout's music kinds show -> one material each (released with the level). Never rejects. */
export async function preloadStoreMusicArt(host: StoreMusicHost, layout: StationLayout): Promise<{loaded: number; missing: number}> {
  const res = {loaded: 0, missing: 0};
  await Promise.all(storeMusicAtlases(new Set(layout.props.map(p => p.kind))).map(async atlas => {
    const tex = await host.levelResources.load(LEVEL, URLS[atlas], {srgb: true, repeat: false}).catch(() => null);
    if (!tex) { setStoreMusicArtMaterial(atlas, null); res.missing++; return; }
    let m = MATS.get(tex);
    if (!m) {
      // printed card: matte, a little sheen on the sleeves' gloss
      m = host.levelResources.own(LEVEL, new SurfaceNodeMaterial({map: tex, roughness: atlas === 'covers' ? 0.62 : 0.8, metalness: 0}));
      m.name = `store-music-${atlas}`;
      MATS.set(tex, m);
    }
    setStoreMusicArtMaterial(atlas, m);
    res.loaded++;
  }));
  return res;
}

// ---------------------------------------------------------------------------------------------
// Sleeve geometry

/** A cover's UV rect in the covers atlas (three.js: v = 0 at the bottom; the cell's padding excluded). */
export function coverRect(cover: number): {u0: number; v0: number; u1: number; v1: number} {
  const {grid, cell, pad, width, height} = MUSIC_ART.covers;
  const c = ((Math.trunc(cover) % MUSIC_COVER_COUNT) + MUSIC_COVER_COUNT) % MUSIC_COVER_COUNT;
  const x = (c % grid) * cell + pad, y = Math.floor(c / grid) * cell + pad, s = cell - 2 * pad;
  return {u0: x / width, u1: (x + s) / width, v1: 1 - y / height, v0: 1 - (y + s) / height};
}

class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  /** A quad a-b-c-d (counter-clockwise seen from its normal side) with its UVs. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, uv: [number, number][]): void {
    const i0 = this.pos.length / 3;
    for (const [k, p] of [a, b, c, d].entries()) { this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(uv[k][0], uv[k][1]); }
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * One sleeve: a slab `s` x `s` x `t`, its bottom edge centred at (x, y, z) (prop frame), leaning back by `lean` (rad; its top toward -Z).
 * Faces: the front cover, the top edge and both side edges (slivers of the cover's own edge); the back cover when `back` >= 0.
 */
function sleeve(b: GeoBuilder, x: number, y: number, z: number, lean: number, s: number, t: number, cover: number, back: number): void {
  const X = new THREE.Vector3(1, 0, 0), D = new THREE.Vector3(0, Math.cos(lean), -Math.sin(lean)), N = new THREE.Vector3(0, Math.sin(lean), Math.cos(lean));
  const P = (ax: number, ad: number, an: number) => new THREE.Vector3(x, y, z).addScaledVector(X, ax).addScaledVector(D, ad).addScaledVector(N, an);
  const r = coverRect(cover), px = 3 / MUSIC_ART.covers.width, h = s / 2, f = t / 2;
  // front (the cover), seen from +N
  b.quad(P(-h, 0, f), P(h, 0, f), P(h, s, f), P(-h, s, f), N, [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]]);
  // top edge (the cover's top sliver), seen from +D
  b.quad(P(-h, s, f), P(h, s, f), P(h, s, -f), P(-h, s, -f), D, [[r.u0, r.v1 - px], [r.u1, r.v1 - px], [r.u1, r.v1], [r.u0, r.v1]]);
  // side edges (the cover's left / right slivers)
  b.quad(P(h, 0, f), P(h, 0, -f), P(h, s, -f), P(h, s, f), X, [[r.u1 - px, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u1 - px, r.v1]]);
  b.quad(P(-h, 0, -f), P(-h, 0, f), P(-h, s, f), P(-h, s, -f), X.clone().negate(), [[r.u0, r.v0], [r.u0 + px, r.v0], [r.u0 + px, r.v1], [r.u0, r.v1]]);
  if (back >= 0) {
    const q = coverRect(back);
    b.quad(P(h, 0, -f), P(-h, 0, -f), P(-h, s, -f), P(h, s, -f), N.clone().negate(), [[q.u0, q.v0], [q.u1, q.v0], [q.u1, q.v1], [q.u0, q.v1]]);
  }
}

const GEOS = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry => { let g = GEOS.get(key); if (!g) GEOS.set(key, (g = make())); return g; };

/** A bin block's sleeves in its placement frame (origin: the block box's bottom centre in its bay — gen musicStock binBlockFrame). */
export function binBlockGeometry(variant: number): THREE.BufferGeometry {
  return cached(`bin-${variant}`, () => {
    const blk = binBlock(variant), b = new GeoBuilder(), zc = (blk.z0 + blk.z1) / 2;
    blk.sleeves.forEach((q, k) => sleeve(b, q.dx, q.y - blk.y0, q.z - zc, q.lean, BIN_SLEEVE.s, BIN_SLEEVE.t, q.cover, k === 0 ? q.back : -1));
    return b.build();
  });
}
/** A ledge row's faced-out LPs in its placement frame (origin: the ledge top, centred between the board face and the lip). */
export function facedRowGeometry(variant: number): THREE.BufferGeometry {
  return cached(`faced-${variant}`, () => {
    const b = new GeoBuilder(), {s, t} = LP_SLEEVE, lean = facedLean(), half = COVER_WALL.ledgeD / 2;
    // bottom edge just inside the lip, the back face's top on the board face (z = -half)
    const z = -half + s * Math.sin(lean) + t / 2 * Math.cos(lean);
    for (const q of facedRow(variant)) sleeve(b, q.x, t / 2 * Math.sin(lean), z, lean, s, t, q.cover, -1);
    return b.build();
  });
}

// ---------------------------------------------------------------------------------------------
// Drawn parts and art faces

function partGeo(p: MusicPart): THREE.BufferGeometry {
  const g = 'box' in p ? new THREE.BoxGeometry(p.box[0], p.box[1], p.box[2]) : new THREE.CylinderGeometry(p.cyl.r, p.cyl.r, p.cyl.h, p.cyl.seg ?? 16);
  if (p.rx) g.rotateX(p.rx);
  if (p.rz) g.rotateZ(p.rz);
  g.translate(p.p[0], p.p[1], p.p[2]);
  return g.index ? g.toNonIndexed() : g;
}
/** A face quad showing its atlas piece (cropped centred to the face's aspect, never stretched; no piece: the whole quad). */
export function musicFaceGeometry(f: MusicFace): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(f.w, f.h);
  const piece = f.atlas === 'signs' ? MUSIC_ART.signs.pieces[f.piece] : undefined;
  if (piece) {
    let {u0, v0, u1, v1} = piece;
    const fa = f.w / f.h;
    if (piece.aspect > fa) { const k = fa / piece.aspect, du = (u1 - u0) * (1 - k) / 2; u0 += du; u1 -= du; } else { const k = piece.aspect / fa, dv = (v1 - v0) * (1 - k) / 2; v0 += dv; v1 -= dv; }
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  if (f.rx) g.rotateX(f.rx);
  g.translate(f.p[0], f.p[1], f.p[2]);
  return g;
}

const byLevel = <T extends {level?: number}>(list: readonly T[]) => {
  const m = new Map<number, T[]>();
  for (const p of list) { const l = m.get(p.level ?? 0); if (l) l.push(p); else m.set(p.level ?? 0, [p]); }
  return m;
};
const UP = new THREE.Vector3(0, 1, 0);
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1));

function instanced(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, list: readonly PropPlacement[], name: string): void {
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  for (const [level, ps] of byLevel(list)) {
    const im = new THREE.InstancedMesh(geo, mat, ps.length);
    ps.forEach((p, i) => im.setMatrixAt(i, placeM(p)));
    im.name = name;
    im.userData.level = level;
    im.computeBoundingSphere();
    group.add(im);
  }
}
/** Parts merged per shape material, instanced on `list` (one cached geometry per key + material). */
function drawParts(group: THREE.Group, kind: string, key: string, parts: readonly MusicPart[], list: readonly PropPlacement[], wm: WorldMaterials): void {
  const pm = shapeMaterials(wm), by = new Map<ShapeMat, MusicPart[]>();
  for (const p of parts) { const l = by.get(p.m); if (l) l.push(p); else by.set(p.m, [p]); }
  for (const [m, ps] of by) {
    const geo = cached(`parts-${key}-${m}`, () => { const gs = ps.map(partGeo); const g = gs.length > 1 ? mergeGeometries(gs, false) : gs[0]; if (gs.length > 1) for (const q of gs) q.dispose(); return g; });
    instanced(group, geo, pm[m], list, `prop-${kind}-${m}`);
  }
}
function drawFaces(group: THREE.Group, kind: string, key: string, faces: readonly MusicFace[], list: readonly PropPlacement[]): void {
  faces.forEach((f, i) => instanced(group, cached(`face-${key}-${i}`, () => musicFaceGeometry(f)), storeMusicArtMaterial(f.atlas), list, `prop-${kind}-art${i}`));
}
const groupBy = (list: readonly PropPlacement[], key: (p: PropPlacement) => number): Map<number, PropPlacement[]> => {
  const m = new Map<number, PropPlacement[]>();
  for (const p of list) { const k = key(p), l = m.get(k); if (l) l.push(p); else m.set(k, [p]); }
  return m;
};

/** Renders one of the store's kinds' placements. Returns the instance count. */
export function buildStoreMusicProp(group: THREE.Group, kind: StoreMusicKind, list: readonly PropPlacement[], wm: WorldMaterials): number {
  if (!list.length) return 0;
  switch (kind) {
    case 'skyMuBinRecords':
      for (const [v, ps] of groupBy(list, p => p.variant)) instanced(group, binBlockGeometry(v), storeMusicArtMaterial('covers'), ps, `prop-${kind}-s${v}`);
      break;
    case 'skyMuFacedRecords':
      for (const [v, ps] of groupBy(list, p => p.variant)) instanced(group, facedRowGeometry(v), storeMusicArtMaterial('covers'), ps, `prop-${kind}-s${v}`);
      break;
    case 'skyMuCoverWall': { const {parts, faces} = coverWallParts(); drawParts(group, kind, kind, parts, list, wm); drawFaces(group, kind, kind, faces, list); break; }
    case 'skyMuBinLabel':
      drawParts(group, kind, kind, binLabelParts(MUSIC_GENRES[0]).parts, list, wm);
      for (const [v, ps] of groupBy(list, p => ((p.variant % MUSIC_GENRES.length) + MUSIC_GENRES.length) % MUSIC_GENRES.length)) {
        const {faces} = binLabelParts(MUSIC_GENRES[v]);
        faces.forEach((f, i) => instanced(group, cached(`face-label-${v}-${i}`, () => musicFaceGeometry(f)), storeMusicArtMaterial(f.atlas), ps, `prop-${kind}-g${v}`));
      }
      break;
    case 'skyMuGigPoster':
      drawParts(group, kind, kind, posterParts(0).parts, list, wm);
      for (const [v, ps] of groupBy(list, p => ((p.variant % 4) + 4) % 4)) drawFaces(group, kind, `poster-${v}`, posterParts(v).faces, ps);
      break;
    case 'skyMuSign': { const {parts, faces} = signParts('listening-booths'); drawParts(group, kind, kind, parts, list, wm); drawFaces(group, kind, kind, faces, list); break; }
    case 'skyMuTurntable': drawParts(group, kind, kind, turntableParts(), list, wm); break;
    case 'skyMuHeadphones': drawParts(group, kind, kind, headphonesParts(), list, wm); break;
    case 'skyMuStool': drawParts(group, kind, kind, stoolParts(), list, wm); break;
  }
  return list.length;
}
