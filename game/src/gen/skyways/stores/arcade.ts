// Task studio-alpha-skyways-shops-20261107-054512-01: THE ARCADE STORE (layout version >= 3) — owned by its store agent (lane
// STORE-ARCADE). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsB.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsB} from '../destinations/shopsB';

export const STORE_ARCADE: SkywaysStoreSpec = {
  family: 'arcade',
  owner: 'lane STORE-ARCADE',
  dress: (layout, rng, anchor) => dressShopsB(layout, rng, anchor),
  purposes: {floor: 'mall-arcade', stock: 'mall-arcade-back'},
  finish: {
    wall: {paint: 0x1f1a2e, lower: 0x15121f, trim: 0x7b1fa2, kind: 'paint', lowerTop: 1.0, skirt: 0.1, rail: 0.02, peel: 0.2, panel: 0},
    floor: ['carpet', 0x2a2440],
    ceil: ['raw', undefined],
  },
};
