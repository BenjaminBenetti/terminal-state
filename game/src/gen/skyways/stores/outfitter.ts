// Task studio-alpha-skyways-shops-20261107-054512-01: THE OUTFITTER STORE (layout version >= 3) — owned by its store agent (lane
// STORE-OUTFITTER). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). COULEE & CANOE OUTFITTERS: a rustic-lodge outdoor
// store (timber-panelled walls under a forest-green upper wall, a dark plank floor, the raw / exposed ceiling) — the cash desk with its
// openable back counter, the campsite under the hung canoe(s), the pack wall with ONE real backpack (a genuine `backpack` gear find,
// never a decoration-only lookalike), the boot wall, outerwear, camp-kitchen shelving and the stocked back rooms: stores/outfitterDress.ts.
//
// Loot (existing purposes only, Skyways-scoped): the sales floor rolls the Mall's outdoor outfitter ('mall-outdoors': flares, torch
// cells, water, beans, noodles, a dressing; its counters / coolers their till / drinks rows), the back rooms its stock room
// ('mall-outdoors-back': water, beans, noodles, flares + back-of-house leftovers; lockers / desks their own rows), and the first-aid
// wall kit at the cash desk a first-aid room's dressings (per-holder override). No floor piles (the store areas are noFloorLoot).

import type {SkywaysStoreSpec} from './types';
import {dressOutfitter} from './outfitterDress';

export const STORE_OUTFITTER: SkywaysStoreSpec = {
  family: 'outfitter',
  owner: 'lane STORE-OUTFITTER',
  dress: (layout, rng, anchor) => dressOutfitter(layout, rng, anchor),
  purposes: {floor: 'mall-outdoors', stock: 'mall-outdoors-back', office: 'mall-outdoors-back'},
  finish: {
    // timber wainscot to 2.7 m (honey pine boards, 0.9 m panel seams) under a deep forest-green upper wall, dark walnut trim
    wall: {paint: 0x3e4c3a, lower: 0xa47448, trim: 0x33251a, kind: 'wood', lowerTop: 2.7, skirt: 0.15, rail: 0.05, peel: 0.3, panel: 0.9},
    // dark oiled plank floor; the exposed (raw) structure overhead — the double-height hall's void shows its steel and services
    floor: ['wood', 0x6b4e36],
    ceil: ['raw', undefined],
  },
};
