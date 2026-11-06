// Task studio-skyways-destinations-20261106-170011-01: the destinations' flat ART pieces (lane ART2D's Codex originals packed into
// assets/skywaysDestArt.generated.ts atlases). A `skyDPoster` prop's variant indexes DEST_POSTER_PIECES; a `skyDPlaque`'s indexes
// DEST_PLAQUE_PIECES. The renderer (lane LANDMARKS) maps the piece to its atlas rect; without the atlas: a plain board.

import type {SkywaysLandmarkFamily, SkywaysShopFamily} from '../skywaysTypes';

export const DEST_POSTER_PIECES = ['cinema1', 'cinema2', 'cinema3', 'music1', 'music2', 'books', 'outfitter', 'science', 'arcade', 'hockey', 'hobby', 'design', 'garden'] as const;
export type DestPosterPiece = (typeof DEST_POSTER_PIECES)[number];
export const DEST_PLAQUE_PIECES = ['plaque_clock', 'plaque_dinosaur', 'plaque_fig_tree', 'plaque_fountain', 'plaque_geese', 'plaque_orrery'] as const;
export type DestPlaquePiece = (typeof DEST_PLAQUE_PIECES)[number];

/** A shop family's posters (variants of skyDPoster). */
export const DEST_POSTERS_OF: Readonly<Record<SkywaysShopFamily, readonly number[]>> = {
  cinema: [0, 1, 2], music: [3, 4], books: [5], outfitter: [6], science: [7], arcade: [8], hockey: [9], hobby: [10], design: [11], garden: [12],
};
/** A landmark family's plaque (variant of skyDPlaque). */
export const DEST_PLAQUE_OF: Readonly<Record<SkywaysLandmarkFamily, number>> = {clock: 0, dinosaur: 1, 'fig-tree': 2, fountain: 3, geese: 4, orrery: 5};
/** Wall poster: the paper's size (m, inside its snap frame) and its centre height above the floor. */
export const DEST_POSTER = {w: 0.62, h: 0.92, y: 1.5} as const;
