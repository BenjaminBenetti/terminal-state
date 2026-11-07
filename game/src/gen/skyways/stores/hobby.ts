// Task studio-alpha-skyways-shops-20261107-054512-01: THE HOBBY STORE (layout version >= 3) — GRAIN ELEVATOR MODELS, owned by its store
// agent (lane STORE-HOBBY). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). The dresser: stores/hobbyDress.ts (cash desk with
// its openable back counter, the grain-elevator railway layout table, the workbench / paint-rack corner, glass display cases, kit walls
// and kit aisles, stocked back rooms).
//
// Loot (existing purposes only, Skyways-scoped): the sales floor is the Mall toy store's ('mall-toys'), its back rooms the toy store's
// stock room ('mall-toys-back' — the office too, instead of the station agent office's ammunition rows); per holder (hobbyDress.ts
// HOBBY_HOLDER_PURPOSE): the workbench / tool chest / paint rack roll the Mall hardware store, the glass cases the Mall electronics store.
//
// Finish: prairie grain-elevator colours — wheat-gold painted plaster over a barn-red stained board wainscot (narrow boards, a chair
// rail, a dark green trim), an old buff vinyl-tile floor, a lay-in grid ceiling.

import type {SkywaysStoreSpec} from './types';
import {dressHobbyStore} from './hobbyDress';

export const STORE_HOBBY: SkywaysStoreSpec = {
  family: 'hobby',
  owner: 'lane STORE-HOBBY',
  dress: (layout, rng, anchor) => dressHobbyStore(layout, rng, anchor),
  purposes: {floor: 'mall-toys', stock: 'mall-toys-back', office: 'mall-toys-back'},
  finish: {
    wall: {paint: 0xe2cd96, lower: 0x8a3b27, trim: 0x2e3b2a, kind: 'wood', lowerTop: 1.05, skirt: 0.14, rail: 0.05, peel: 0.22, panel: 0.42},
    floor: ['vinyl', 0xb2a487],
    ceil: ['grid', undefined],
  },
};
