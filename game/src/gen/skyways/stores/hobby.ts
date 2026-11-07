// Task studio-alpha-skyways-shops-20261107-054512-01: THE HOBBY STORE (layout version >= 3) — owned by its store agent (lane
// STORE-HOBBY). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsA.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsA} from '../destinations/shopsA';

export const STORE_HOBBY: SkywaysStoreSpec = {
  family: 'hobby',
  owner: 'lane STORE-HOBBY',
  dress: (layout, rng, anchor) => dressShopsA(layout, rng, anchor),
  purposes: {floor: 'mall-toys', stock: 'mall-toys-back'},
  finish: {
    wall: {paint: 0xe9e1c7, lower: 0x8c6a3f, trim: 0x3b2c1a, kind: 'wood', lowerTop: 1.0, skirt: 0.12, rail: 0.04, peel: 0.2, panel: 0.6},
    floor: ['vinyl', 0xb8ad94],
    ceil: ['grid', undefined],
  },
};
