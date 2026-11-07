// Task studio-alpha-skyways-shops-20261107-054512-01: THE BOOKS STORE (layout version >= 3) — owned by its store agent (lane
// STORE-BOOKS). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsA.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsA} from '../destinations/shopsA';

export const STORE_BOOKS: SkywaysStoreSpec = {
  family: 'books',
  owner: 'lane STORE-BOOKS',
  dress: (layout, rng, anchor) => dressShopsA(layout, rng, anchor),
  purposes: {floor: 'mall-books', upper: 'mall-books', stock: 'mall-books-back'},
  finish: {
    wall: {paint: 0xe6dccb, lower: 0x6b4428, trim: 0x2e1d12, kind: 'wood', lowerTop: 4.0, skirt: 0.12, rail: 0.03, peel: 0.2, panel: 0.9},
    floor: ['wood', 0x8a5f3c],
    ceil: ['plain', 0xe8e0d0],
  },
};
