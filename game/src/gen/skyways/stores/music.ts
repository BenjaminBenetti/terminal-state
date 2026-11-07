// Task studio-alpha-skyways-shops-20261107-054512-01: THE MUSIC STORE (layout version >= 3) — owned by its store agent (lane
// STORE-MUSIC). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec).
//
// NORTHERN GROOVE RECORDS: a real record shop — rows of record-bin racks with real stock in every bay (filed ten-inch sleeves with the
// Codex cover art), a faced-out NEW ARRIVALS wall, a cash desk with an openable back counter, a stage corner with a guitar wall, gig
// posters, listening booths (a turntable / headphones console and a stool each) and stocked back rooms. The dresser:
// stores/musicDress.ts; the record stock geometry: stores/musicStock.ts; its own kinds: stores/kinds/music.ts; the renderer:
// world/skywaysStoreMusic.ts.
//
// Loot (existing purposes only, scoped to this anchor's areas at layout version 3):
//  - sales floor `mall-music` (the Mall music store: tech theme — torch / player cells first, a flare, water; the till water / cola /
//    cells): the counter till, the back counter's drawers / cupboard, the accessory shelving;
//  - the listening booths `office-listening` (the Office's listening lounge: drinks and snacks — its fridge / table rows): the console
//    sideboards; a hall store's listening-bar consoles carry the same purpose per holder;
//  - the back rooms `mall-music-back` (the music store's stock room: cells and water on the shelving, back-of-house rows in crates /
//    cabinets, personal rows in the lockers, the office desk, the staff fridge's drinks), the office the same;
//  - per holder: the stage's road case (footlocker) `office-studio` (a broadcast studio's supply rows: water, cells, a flare, a
//    dressing, beans).
// Palette: dark plum walls over a black-stained wainscot with a brass rail, worn dark floorboards, a black raw ceiling; the booths
// walnut-panelled to the ceiling over deep teal carpet (acoustic rooms).

import type {SkywaysStoreSpec} from './types';
import {dressMusicStore} from './musicDress';

export const STORE_MUSIC: SkywaysStoreSpec = {
  family: 'music',
  owner: 'lane STORE-MUSIC',
  dress: (layout, rng, anchor) => dressMusicStore(layout, rng, anchor),
  purposes: {floor: 'mall-music', zones: 'office-listening', stock: 'mall-music-back', office: 'mall-music-back'},
  finish: {
    wall: {paint: 0x2d2433, lower: 0x231914, trim: 0xa07d3a, kind: 'wood', lowerTop: 1.15, skirt: 0.12, rail: 0.03, peel: 0.25, panel: 0.6},
    floor: ['wood', 0x4e3426],
    ceil: ['raw', 0x1f1d22],
    zones: {
      wall: {paint: 0x3a2a20, lower: 0x5b3a26, trim: 0x2a1c14, kind: 'wood', lowerTop: 3.6, skirt: 0.1, rail: 0.02, peel: 0.12, panel: 0.85},
      floor: ['carpet', 0x1d4448],
      ceil: ['plain', 0x26222a],
    },
  },
};
