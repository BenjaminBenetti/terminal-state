// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-A (B)): the interiors of this lane's DESTINATION anchor shop families — each
// family's kit (kindsShopsA.ts) plus existing fixtures / holders, laid out over the anchor's floors / zones / back rooms
// (layout.skyways.anchors). Called by destinations/index.ts.

import type {Rng} from '../../../core/rng';
import type {StationLayout} from '../../stationTypes';
import type {SkywaysAnchor, SkywaysShopFamily} from '../skywaysTypes';

export const SHOPS_A_FAMILIES: readonly SkywaysShopFamily[] = ['books', 'outfitter', 'music', 'hobby', 'design'];

/** Dresses one anchor of this lane's families; returns the props placed. */
export function dressShopsA(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  void layout; void rng; void anchor;
  return 0;
}
