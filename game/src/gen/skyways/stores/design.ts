// Task studio-alpha-skyways-shops-20261107-054512-01: THE DESIGN STORE (layout version >= 3) — owned by its store agent (lane
// STORE-DESIGN). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsA.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsA} from '../destinations/shopsA';

export const STORE_DESIGN: SkywaysStoreSpec = {
  family: 'design',
  owner: 'lane STORE-DESIGN',
  dress: (layout, rng, anchor) => dressShopsA(layout, rng, anchor),
  purposes: {floor: 'mall-home', upper: 'mall-home', stock: 'mall-home-back'},
  finish: {
    wall: {paint: 0xf0ede6, lower: 0xd7d1c4, trim: 0x8a8378, kind: 'paint', lowerTop: 0.12, skirt: 0.12, rail: 0, peel: 0.1, panel: 0},
    floor: ['wood', 0xc9a77c],
    ceil: ['plain', 0xf2f0ea],
  },
};
