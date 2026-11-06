// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): this lane's Skyways DESTINATION prop kinds (kindTypes.ts
// DestKindSpec each). Merged by registry.ts into the shared tables — never edit the shared tables for these kinds.
// (The lead pre-defined the two SHARED art kinds every dressing lane places: skyDPoster and skyDPlaque — gen/skyways/destinations/art.ts.)

import type {DestKindSpec} from './kindTypes';
import {DEST_POSTER} from './art';

export const LANDMARKS_KINDS = ['skyDPoster', 'skyDPlaque'] as const;
export type LandmarksKind = (typeof LANDMARKS_KINDS)[number];
export const LANDMARKS_SPECS: Readonly<Record<LandmarksKind, DestKindSpec>> = {
  skyDPoster: {
    def: {w: DEST_POSTER.w + 0.04, d: 0.03, h: DEST_POSTER.h + 0.04, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'paper poster in an aluminium snap frame screwed to a shop wall (variant = art piece, art.ts DEST_POSTER_PIECES)'},
    damage: 'cardboard',
    open: {cls: 'none', role: 'decor', how: 'framed wall poster'},
  },
  skyDPlaque: {
    def: {w: 0.82, d: 0.36, h: 1.22, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'cast-bronze court plaque on a heavy cast-iron lectern pedestal (~70 kg) bolted to the court floor'},
    damage: 'steel',
    open: {cls: 'none', role: 'decor', how: 'solid plaque pedestal: nothing to open'},
  },
};
