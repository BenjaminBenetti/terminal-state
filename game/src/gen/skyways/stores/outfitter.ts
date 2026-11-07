// Task studio-alpha-skyways-shops-20261107-054512-01: THE OUTFITTER STORE (layout version >= 3) — owned by its store agent (lane
// STORE-OUTFITTER). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsA.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsA} from '../destinations/shopsA';

export const STORE_OUTFITTER: SkywaysStoreSpec = {
  family: 'outfitter',
  owner: 'lane STORE-OUTFITTER',
  dress: (layout, rng, anchor) => dressShopsA(layout, rng, anchor),
  purposes: {floor: 'mall-outdoors', stock: 'mall-outdoors-back'},
  finish: {
    wall: {paint: 0xd9d2c0, lower: 0x7a5a3a, trim: 0x2f2a22, kind: 'wood', lowerTop: 1.2, skirt: 0.12, rail: 0.04, peel: 0.25, panel: 1.2},
    floor: ['wood', 0x9b7a55],
    ceil: ['raw', undefined],
  },
};
