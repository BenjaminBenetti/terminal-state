// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-CINEMA): the Aurora Picture House's OWN flat art pieces and the box
// parts of the three art kinds that show them (stores/kinds/cinema.ts). Pure data (no three.js, no props.ts: the kinds file imports it).
//
// The art: original Codex native image_gen sources (four invented now-showing film posters and the concession's REFRESHMENTS board;
// one call each, raw originals in the private backup), cropped / resized / packed into one JPEG atlas by
// tools/asset-pipeline/skyways-stores/cinema/build-art.mjs -> cinemaArt.generated.ts. Nothing is drawn by code: the frames / glass /
// backing below are box parts (shape materials + a brass colour), the art is the atlas piece on one quad. Without the atlas (Node tests,
// a 404) the renderer shows a plain board (world/skywaysStoreCinema.ts), never substitute art.

import * as ART from './cinemaArt.generated';

/** The now-showing posters (a poster case / stand's variant indexes this list) and the concession board's piece. */
export const CINEMA_POSTER_PIECES = ['coulee', 'hoppers', 'midway', 'skywalk'] as const;
export type CinemaPosterPiece = (typeof CINEMA_POSTER_PIECES)[number];
export const CINEMA_MENU_PIECE = 'refreshments';

/** A piece's UV rect (three.js convention: v = 0 at the image bottom) and its pixel aspect (w / h). */
export interface CinemaArtRect { u0: number; v0: number; u1: number; v1: number; aspect: number }
export interface CinemaArtAtlas { url: string; width: number; height: number; pieces: Readonly<Record<string, CinemaArtRect>> }
const TABLE = (ART as unknown as {STORE_CINEMA_ART?: CinemaArtAtlas}).STORE_CINEMA_ART;
/** The atlas record (null: not generated / not merged). */
export const cinemaArtAtlas = (): CinemaArtAtlas | null => (TABLE && typeof TABLE.url === 'string' && TABLE.pieces ? TABLE : null);
/** A piece's rect, or null. */
export const cinemaArtPiece = (piece: string): CinemaArtRect | null => cinemaArtAtlas()?.pieces[piece] ?? null;
/** The rect of a piece cropped (centred) to a face aspect: a face never stretches its art. */
export function cinemaArtCrop(r: CinemaArtRect, faceAspect: number): Omit<CinemaArtRect, 'aspect'> {
  if (r.aspect > faceAspect) { const k = faceAspect / r.aspect, du = (r.u1 - r.u0) * (1 - k) / 2; return {u0: r.u0 + du, v0: r.v0, u1: r.u1 - du, v1: r.v1}; }
  const k = r.aspect / faceAspect, dv = (r.v1 - r.v0) * (1 - k) / 2;
  return {u0: r.u0, v0: r.v0 + dv, u1: r.u1, v1: r.v1 - dv};
}

/**
 * Sizes (m). CASE: a wall-mounted one-sheet poster case (a 27 x 41 in sheet ~0.70 x 1.05 m behind glass in a brass frame), its bottom
 * `y` above the floor (eye level: the sheet's centre ~1.46 m). STAND: a freestanding brass poster stand (weighted base, one post, the
 * framed sheet from `frameY`). MENU: the concession's framed REFRESHMENTS board (3:2) over the back counter, its bottom `y` up.
 */
export const CINEMA_CASE = {w: 0.86, h: 1.28, d: 0.09, y: 0.82, art: {w: 0.7, h: 1.05}, bar: 0.06} as const;
export const CINEMA_STAND = {w: 0.8, h: 1.8, d: 0.42, frameY: 0.63, art: {w: 0.7, h: 1.05}, bar: 0.04, base: {w: 0.56, d: 0.42, h: 0.035}} as const;
export const CINEMA_MENU = {w: 1.8, h: 1.24, d: 0.07, y: 2.1, art: {w: 1.68, h: 1.12}, bar: 0.06} as const;

/** Part materials: shape-material keys of world/shapeMaterials.ts, plus `brass` (the renderer's polished brass colour). */
export type CinemaPartMat = 'brass' | 'black' | 'glass' | 'steelDark';
export interface CinemaPart { m: CinemaPartMat; s: readonly [number, number, number]; p: readonly [number, number, number] }
/** The art quad: its piece, size and centre (prop frame: origin bottom centre, front +Z, metres). */
export interface CinemaFace { piece: string; w: number; h: number; p: readonly [number, number, number]; glow: number }

export type CinemaArtKind = 'storeCinemaPosterCase' | 'storeCinemaPosterStand' | 'storeCinemaMenuBoard';
const wrap = (v: number, n: number) => ((Math.trunc(v) % n) + n) % n;
/** The poster piece a case / stand variant shows. */
export const cinemaPosterOf = (variant: number): CinemaPosterPiece => CINEMA_POSTER_PIECES[wrap(variant, CINEMA_POSTER_PIECES.length)];

/** A framed panel (brass bars round a black backing, optional glass) of outer w x h, its bottom at y0, its back at z0, depth d. */
function framed(out: CinemaPart[], w: number, h: number, y0: number, z0: number, d: number, bar: number, glass: boolean): void {
  out.push({m: 'black', s: [w - 0.01, h - 0.01, 0.018], p: [0, y0 + h / 2, z0 + 0.009]});
  out.push({m: 'brass', s: [w, bar, d], p: [0, y0 + bar / 2, z0 + d / 2]}, {m: 'brass', s: [w, bar, d], p: [0, y0 + h - bar / 2, z0 + d / 2]});
  out.push({m: 'brass', s: [bar, h - 2 * bar, d], p: [-(w - bar) / 2, y0 + h / 2, z0 + d / 2]}, {m: 'brass', s: [bar, h - 2 * bar, d], p: [(w - bar) / 2, y0 + h / 2, z0 + d / 2]});
  if (glass) out.push({m: 'glass', s: [w - 2 * bar + 0.01, h - 2 * bar + 0.01, 0.006], p: [0, y0 + h / 2, z0 + d - 0.014]});
}

/** Box parts + art face of a cinema art kind (prop frame: origin bottom centre on the floor / mount height, front +Z). */
export function cinemaArtShape(kind: CinemaArtKind, variant: number): {parts: CinemaPart[]; face: CinemaFace} {
  const parts: CinemaPart[] = [];
  if (kind === 'storeCinemaPosterCase') {
    const C = CINEMA_CASE, z0 = -C.d / 2;
    framed(parts, C.w, C.h, 0, z0, C.d, C.bar, true);
    return {parts, face: {piece: cinemaPosterOf(variant), w: C.art.w, h: C.art.h, p: [0, C.h / 2, z0 + 0.0195], glow: 0.35}};
  }
  if (kind === 'storeCinemaMenuBoard') {
    const M = CINEMA_MENU, z0 = -M.d / 2;
    framed(parts, M.w, M.h, 0, z0, M.d, M.bar, false);
    return {parts, face: {piece: CINEMA_MENU_PIECE, w: M.art.w, h: M.art.h, p: [0, M.h / 2, z0 + 0.0195], glow: 0.45}};
  }
  // the stand: weighted base plate, a post up to the frame, the framed sheet (single-sided: its back is the black backing board)
  const S = CINEMA_STAND, fh = S.h - S.frameY, fd = 0.03;
  parts.push({m: 'steelDark', s: [S.base.w, S.base.h, S.base.d], p: [0, S.base.h / 2, 0]});
  parts.push({m: 'brass', s: [0.05, S.frameY - S.base.h + 0.02, 0.05], p: [0, S.base.h + (S.frameY - S.base.h) / 2, 0]});
  framed(parts, S.w, fh, S.frameY, -fd / 2, fd, S.bar, false);
  return {parts, face: {piece: cinemaPosterOf(variant), w: S.art.w, h: S.art.h, p: [0, S.frameY + fh / 2, -fd / 2 + 0.0195], glow: 0}};
}
