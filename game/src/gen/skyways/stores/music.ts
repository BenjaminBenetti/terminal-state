// Task studio-alpha-skyways-shops-20261107-054512-01: THE MUSIC STORE (layout version >= 3) — owned by its store agent (lane
// STORE-MUSIC). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsA.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsA} from '../destinations/shopsA';

export const STORE_MUSIC: SkywaysStoreSpec = {
  family: 'music',
  owner: 'lane STORE-MUSIC',
  dress: (layout, rng, anchor) => dressShopsA(layout, rng, anchor),
  purposes: {floor: 'mall-music', zones: 'mall-music', stock: 'mall-music-back'},
  finish: {
    wall: {paint: 0x2b2733, lower: 0x1c1a21, trim: 0x0f0e12, kind: 'paint', lowerTop: 1.0, skirt: 0.1, rail: 0.02, peel: 0.3, panel: 0},
    floor: ['concrete', 0x5a5650],
    ceil: ['raw', undefined],
  },
};
