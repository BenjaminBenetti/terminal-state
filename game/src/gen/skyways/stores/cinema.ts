// Task studio-alpha-skyways-shops-20261107-054512-01: THE CINEMA STORE (layout version >= 3) — owned by its store agent (lane
// STORE-CINEMA). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Until the store agent lands its design, the store keeps the
// destinations pass's dresser (shopsB.ts) with its family's Mall purposes and a first-pass palette.

import type {SkywaysStoreSpec} from './types';
import {dressShopsB} from '../destinations/shopsB';

export const STORE_CINEMA: SkywaysStoreSpec = {
  family: 'cinema',
  owner: 'lane STORE-CINEMA',
  dress: (layout, rng, anchor) => dressShopsB(layout, rng, anchor),
  purposes: {floor: 'newsstand', zones: 'newsstand', stock: 'stock-room'},
  finish: {
    wall: {paint: 0x5a1a22, lower: 0x3a0f15, trim: 0xc9a24a, kind: 'wood', lowerTop: 1.1, skirt: 0.12, rail: 0.04, peel: 0.2, panel: 0.8},
    floor: ['carpet', 0x6e1e2a],
    ceil: ['plain', 0x2a1a1e],
  },
};
