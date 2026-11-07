// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-MUSIC): the CODE-DRAWN parts of Northern Groove Records' own kinds
// (stores/kinds/music.ts): the listening booth's turntable / headphones / counter stool, the new-arrivals wall board, the bin genre
// header card's clip, the poster / sign frames. Pure data (no three.js): boxes and upright cylinders in the prop frame (origin bottom
// centre, front +Z, metres) with the shared shape materials (gen/propShapes.ts ShapeMat), drawn by world/skywaysStoreMusic.ts and
// exported to GLB for the scale check (tools/asset-pipeline/skyways-stores/music/shapes-glb.mjs). Flat ART faces (covers, posters, sign
// boards) come from the store's Codex atlases (never drawn in code): `face` entries name the atlas piece.

import type {ShapeMat} from '../../propShapes';
import {COVER_WALL} from './musicStock';
import {MUSIC_ART} from './musicArt';

/** A sign board's height at width w, at its Codex art's own aspect (never stretched; 6.3 : 1 when the table lacks it). */
const signH = (piece: string, w: number): number => Math.round(w / (MUSIC_ART.signs.pieces[piece]?.aspect ?? 6.3) * 1000) / 1000;
/** The NEW ARRIVALS header board on the cover wall. */
export const COVER_HEADER = {w: COVER_WALL.headerW, h: signH('new-arrivals', COVER_WALL.headerW)} as const;

/** A box (s = size, p = centre) or an upright cylinder (r = radius, h = height, p = centre); optional rotation about X / Z (rad). */
export type MusicPart =
  | {m: ShapeMat; box: readonly [number, number, number]; p: readonly [number, number, number]; rx?: number; rz?: number}
  | {m: ShapeMat; cyl: {r: number; h: number; seg?: number}; p: readonly [number, number, number]; rx?: number; rz?: number};
/** A flat art face (a quad facing +Z, rotated about X by rx) showing an atlas piece. */
export interface MusicFace { atlas: 'covers' | 'signs'; piece: string; w: number; h: number; p: readonly [number, number, number]; rx?: number }

/** Footprints / heights of the drawn kinds (m). */
export const MUSIC_DIMS = {
  turntable: {w: 0.45, h: 0.135, d: 0.36},
  headphones: {w: 0.19, h: 0.07, d: 0.2},
  stool: {w: 0.4, h: 0.66, d: 0.4},
  binLabel: {w: 0.25, h: 0.115, d: 0.006},
  poster: {w: 0.62, h: 0.93, d: 0.025},
  sign: {w: 1.6, h: signH('listening-booths', 1.6), d: 0.04},
} as const;

/** Belt-drive turntable: walnut plinth, black platter with a record on it, a steel tonearm on its pillar, a dust-cover hinge block. */
export function turntableParts(): MusicPart[] {
  const {w, d} = MUSIC_DIMS.turntable;
  return [
    {m: 'woodVeneer', box: [w, 0.07, d], p: [0, 0.035, 0]},
    {m: 'black', box: [w - 0.01, 0.006, d - 0.01], p: [0, 0.073, 0]},
    // feet
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({m: 'black' as ShapeMat, cyl: {r: 0.02, h: 0.012, seg: 10}, p: [sx * (w / 2 - 0.04), 0.006, sz * (d / 2 - 0.04)] as const})),
    // platter (record on it: the black disc and its paper label)
    {m: 'steelBright', cyl: {r: 0.15, h: 0.02, seg: 32}, p: [-0.05, 0.086, 0.0]},
    {m: 'black', cyl: {r: 0.149, h: 0.003, seg: 32}, p: [-0.05, 0.0975, 0.0]},
    {m: 'accent', cyl: {r: 0.045, h: 0.001, seg: 20}, p: [-0.05, 0.0995, 0.0]},
    {m: 'steelBright', cyl: {r: 0.004, h: 0.012, seg: 8}, p: [-0.05, 0.104, 0.0]},
    // tonearm: pillar, arm, headshell
    {m: 'steelDark', cyl: {r: 0.018, h: 0.03, seg: 12}, p: [0.165, 0.091, -0.11]},
    {m: 'steelBright', box: [0.008, 0.008, 0.23], p: [0.15, 0.108, -0.01], rz: 0},
    {m: 'black', box: [0.022, 0.012, 0.035], p: [0.135, 0.105, 0.105]},
    // speed knob / start button
    {m: 'steelBright', cyl: {r: 0.012, h: 0.01, seg: 12}, p: [-0.19, 0.08, 0.15]},
    // dust-cover hinge blocks at the back
    {m: 'black', box: [0.03, 0.03, 0.02], p: [-0.12, 0.085, -d / 2 + 0.01]},
    {m: 'black', box: [0.03, 0.03, 0.02], p: [0.12, 0.085, -d / 2 + 0.01]},
  ];
}

/** Closed-back studio headphones lying folded on the counter: two ear cups, the padded band arching over them. */
export function headphonesParts(): MusicPart[] {
  return [
    {m: 'black', cyl: {r: 0.045, h: 0.04, seg: 16}, p: [-0.05, 0.02, 0.0]},
    {m: 'black', cyl: {r: 0.045, h: 0.04, seg: 16}, p: [0.05, 0.02, 0.0]},
    {m: 'plasticSeat', cyl: {r: 0.038, h: 0.006, seg: 16}, p: [-0.05, 0.043, 0.0]},
    {m: 'plasticSeat', cyl: {r: 0.038, h: 0.006, seg: 16}, p: [0.05, 0.043, 0.0]},
    // the band: three flat segments arching from cup to cup (lying flat, toward -Z)
    {m: 'steelDark', box: [0.03, 0.012, 0.06], p: [-0.085, 0.02, -0.055], rx: 0},
    {m: 'steelDark', box: [0.03, 0.012, 0.06], p: [0.085, 0.02, -0.055], rx: 0},
    {m: 'black', box: [0.2, 0.014, 0.03], p: [0, 0.02, -0.085]},
  ];
}

/** Counter stool: a round padded seat on four splayed-looking steel legs with a footring (seat 0.66 m: a counter-height stool). */
export function stoolParts(): MusicPart[] {
  const {h} = MUSIC_DIMS.stool, legs: MusicPart[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) legs.push({m: 'steelDark', box: [0.025, h - 0.06, 0.025], p: [sx * 0.15, (h - 0.06) / 2, sz * 0.15]});
  return [
    ...legs,
    {m: 'plasticSeat', cyl: {r: 0.19, h: 0.05, seg: 24}, p: [0, h - 0.025, 0]},
    {m: 'steelDark', cyl: {r: 0.17, h: 0.015, seg: 24}, p: [0, h - 0.065, 0]},
    // footring (four bars between the legs)
    {m: 'steelBright', box: [0.3, 0.018, 0.018], p: [0, 0.24, -0.15]},
    {m: 'steelBright', box: [0.3, 0.018, 0.018], p: [0, 0.24, 0.15]},
    {m: 'steelBright', box: [0.018, 0.018, 0.3], p: [-0.15, 0.24, 0]},
    {m: 'steelBright', box: [0.018, 0.018, 0.3], p: [0.15, 0.24, 0]},
  ];
}

/**
 * The new-arrivals wall: a black-stained board screwed to the wall (its back at z = -d/2), three oak ledges with a front lip, and the
 * painted NEW ARRIVALS header board above it (the Codex sign art face). Prop frame origin at the board's base.
 */
export function coverWallParts(): {parts: MusicPart[]; faces: MusicFace[]} {
  const {w, h, t, ledges, ledgeD, lip} = COVER_WALL, header = COVER_HEADER, back = -(t + ledgeD) / 2;
  const parts: MusicPart[] = [
    {m: 'black', box: [w, h, t], p: [0, h / 2, back + t / 2]},
    {m: 'woodVeneer', box: [w + 0.04, 0.03, t + 0.01], p: [0, h + 0.015, back + t / 2 + 0.005]},
    {m: 'woodVeneer', box: [0.03, h, t + 0.01], p: [-w / 2 - 0.005, h / 2, back + t / 2 + 0.005]},
    {m: 'woodVeneer', box: [0.03, h, t + 0.01], p: [w / 2 + 0.005, h / 2, back + t / 2 + 0.005]},
  ];
  for (const y of ledges) {
    parts.push({m: 'wood', box: [w - 0.04, 0.02, ledgeD], p: [0, y - 0.01, back + t + ledgeD / 2]});
    parts.push({m: 'wood', box: [w - 0.04, lip, 0.012], p: [0, y + lip / 2, back + t + ledgeD - 0.006]});
  }
  // the header board on two short brackets above the board
  const hy = h + 0.06 + header.h / 2;
  parts.push({m: 'black', box: [header.w + 0.04, header.h + 0.04, 0.025], p: [0, hy, back + 0.0125]});
  return {parts, faces: [{atlas: 'signs', piece: 'new-arrivals', w: header.w, h: header.h, p: [0, hy, back + 0.026]}]};
}
/** Height of the cover wall (the header's top) above its base. */
export const COVER_WALL_TOP = COVER_WALL.h + 0.06 + COVER_HEADER.h + 0.02;
/** Depth of the cover wall (board + ledges) — its footprint off the wall. */
export const COVER_WALL_DEPTH = COVER_WALL.t + COVER_WALL.ledgeD;

/** A genre card screwed to a bin rack's front apron: the Codex card art on a thin board (prop frame: its back at z = -d/2). */
export function binLabelParts(genre: string): {parts: MusicPart[]; faces: MusicFace[]} {
  const {w, h, d} = MUSIC_DIMS.binLabel;
  return {
    parts: [{m: 'panel', box: [w, h, d - 0.001], p: [0, h / 2, -0.0005]}],
    faces: [{atlas: 'signs', piece: `genre-${genre}`, w: w - 0.008, h: h - 0.008, p: [0, h / 2, d / 2 - 0.0004]}],
  };
}

/** A gig poster in a thin black snap frame (its back on the wall at z = -d/2). */
export function posterParts(variant: number): {parts: MusicPart[]; faces: MusicFace[]} {
  const {w, h, d} = MUSIC_DIMS.poster, f = 0.018;
  return {
    parts: [
      {m: 'black', box: [w + 2 * f, f, d], p: [0, f / 2, 0]}, {m: 'black', box: [w + 2 * f, f, d], p: [0, h + 1.5 * f, 0]},
      {m: 'black', box: [f, h, d], p: [-(w + f) / 2, h / 2 + f, 0]}, {m: 'black', box: [f, h, d], p: [(w + f) / 2, h / 2 + f, 0]},
      {m: 'panel', box: [w, h, 0.006], p: [0, h / 2 + f, -d / 2 + 0.003]},
    ],
    faces: [{atlas: 'signs', piece: `poster-${((variant % 4) + 4) % 4}`, w, h, p: [0, h / 2 + f, -d / 2 + 0.0065]}],
  };
}

/** A painted wayfinding sign board (LISTENING BOOTHS) on two stand-off brackets. */
export function signParts(piece: string): {parts: MusicPart[]; faces: MusicFace[]} {
  const {w, h, d} = MUSIC_DIMS.sign;
  return {
    parts: [{m: 'black', box: [w + 0.03, h + 0.03, 0.02], p: [0, (h + 0.03) / 2, d / 2 - 0.01]}, {m: 'steelDark', box: [0.04, 0.04, d - 0.02], p: [-w / 3, (h + 0.03) / 2, -0.01]},
      {m: 'steelDark', box: [0.04, 0.04, d - 0.02], p: [w / 3, (h + 0.03) / 2, -0.01]}],
    faces: [{atlas: 'signs', piece, w, h, p: [0, (h + 0.03) / 2, d / 2 + 0.0005]}],
  };
}

/** The bin header genres (signs atlas pieces genre-<g>). */
export const MUSIC_GENRES = ['rock', 'jazz', 'folk', 'soul', 'punk', 'country', 'blues', 'electronic'] as const;
