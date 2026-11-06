// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): the small ADAPTER between the destinations' art kinds
// (skyDPoster / skyDPlaque: variant = art.ts DEST_POSTER_PIECES / DEST_PLAQUE_PIECES index) and lane ART2D's packed atlases
// (assets/skywaysDestArt.generated.ts SKYWAYS_DEST_ART: atlas -> {url, width, height, pieces: piece key -> UV rect}; Codex originals,
// crop / pack only). Pure data (no three.js). An atlas or piece missing from the table (not generated yet / not merged) answers null:
// the renderer then shows a plain board (never drawn substitute art).

import * as DEST_ART from '../../../assets/skywaysDestArt.generated';
import {DEST_PLAQUE_PIECES, DEST_POSTER_PIECES} from './art';

export type DestArtAtlasKey = 'posters' | 'plaques';
/** A piece's UV rect (three.js convention: v = 0 at the image bottom) in its atlas. */
export interface DestArtRect { u0: number; v0: number; u1: number; v1: number }
export interface DestArtAtlas { url: string; width: number; height: number; pieces: Readonly<Record<string, DestArtRect>> }

const TABLE = ((DEST_ART as unknown as {SKYWAYS_DEST_ART?: Readonly<Partial<Record<string, DestArtAtlas>>>}).SKYWAYS_DEST_ART ?? {});

/** The atlas record (null: not in the generated table). */
export function destArtAtlas(atlas: DestArtAtlasKey): DestArtAtlas | null {
  const a = TABLE[atlas];
  return a && typeof a.url === 'string' && a.pieces ? a : null;
}
/** A piece's rect and pixel aspect (w / h), or null. */
export function destArtPiece(atlas: DestArtAtlasKey, piece: string): (DestArtRect & {aspect: number}) | null {
  const a = destArtAtlas(atlas), r = a?.pieces[piece];
  if (!a || !r) return null;
  const aspect = ((r.u1 - r.u0) * a.width) / Math.max(1e-6, (r.v1 - r.v0) * a.height);
  return {u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1, aspect};
}
/** The rect of a piece cropped (centred) to a face aspect, so a face never stretches its art. */
export function destArtCrop(r: DestArtRect & {aspect: number}, faceAspect: number): DestArtRect {
  if (r.aspect > faceAspect) { const k = faceAspect / r.aspect, du = (r.u1 - r.u0) * (1 - k) / 2; return {u0: r.u0 + du, v0: r.v0, u1: r.u1 - du, v1: r.v1}; }
  const k = r.aspect / faceAspect, dv = (r.v1 - r.v0) * (1 - k) / 2;
  return {u0: r.u0, v0: r.v0 + dv, u1: r.u1, v1: r.v1 - dv};
}
const wrap = (v: number, n: number) => ((Math.trunc(v) % n) + n) % n;
/** The atlas piece a poster / plaque variant shows. */
export const destArtOf = (kind: 'skyDPoster' | 'skyDPlaque', variant: number): {atlas: DestArtAtlasKey; piece: string} =>
  kind === 'skyDPoster' ? {atlas: 'posters', piece: DEST_POSTER_PIECES[wrap(variant, DEST_POSTER_PIECES.length)]}
    : {atlas: 'plaques', piece: DEST_PLAQUE_PIECES[wrap(variant, DEST_PLAQUE_PIECES.length)]};
