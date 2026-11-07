// Task studio-alpha-skyways-shops-20261107-054512-01: THE GARDEN STORE (layout version >= 3) — owned by its store agent (lane
// STORE-GARDEN). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsB.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsB} from '../destinations/shopsB';

export const STORE_GARDEN: SkywaysStoreSpec = {
  family: 'garden',
  owner: 'lane STORE-GARDEN',
  dress: (layout, rng, anchor) => dressShopsB(layout, rng, anchor),
  purposes: {floor: 'mall-florist', stock: 'mall-florist-back'},
  finish: {
    wall: {paint: 0xdfe3d6, lower: 0x8a5a43, trim: 0x2f3a2c, kind: 'tile', lowerTop: 1.0, skirt: 0.1, rail: 0.03, peel: 0.25, panel: 0},
    floor: ['tile', 0x9a8f80],
    ceil: ['raw', undefined],
  },
};
