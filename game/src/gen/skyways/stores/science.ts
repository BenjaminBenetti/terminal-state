// Task studio-alpha-skyways-shops-20261107-054512-01: THE SCIENCE STORE (layout version >= 3) — owned by its store agent (lane
// STORE-SCIENCE). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsB.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsB} from '../destinations/shopsB';

export const STORE_SCIENCE: SkywaysStoreSpec = {
  family: 'science',
  owner: 'lane STORE-SCIENCE',
  dress: (layout, rng, anchor) => dressShopsB(layout, rng, anchor),
  purposes: {floor: 'mall-toys', stock: 'mall-toys-back'},
  finish: {
    wall: {paint: 0xe4ebf2, lower: 0x1f4e79, trim: 0x16324d, kind: 'paint', lowerTop: 1.0, skirt: 0.1, rail: 0.03, peel: 0.15, panel: 0},
    floor: ['vinyl', 0xc5ccd3],
    ceil: ['grid', undefined],
  },
};
