// Task studio-alpha-skyways-shops-20261107-054512-01: THE HOCKEY STORE (layout version >= 3) — owned by its store agent (lane
// STORE-HOCKEY). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsB.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsB} from '../destinations/shopsB';

export const STORE_HOCKEY: SkywaysStoreSpec = {
  family: 'hockey',
  owner: 'lane STORE-HOCKEY',
  dress: (layout, rng, anchor) => dressShopsB(layout, rng, anchor),
  purposes: {floor: 'mall-sports', stock: 'mall-sports-back'},
  finish: {
    wall: {paint: 0xe7ebef, lower: 0x1d3f8f, trim: 0xb02a2a, kind: 'paint', lowerTop: 1.2, skirt: 0.12, rail: 0.04, peel: 0.2, panel: 0},
    floor: ['vinyl', 0xb9c2cc],
    ceil: ['grid', undefined],
  },
};
