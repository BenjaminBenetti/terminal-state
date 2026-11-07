// Task studio-alpha-skyways-shops-20261107-054512-01: THE SCIENCE STORE (layout version >= 3) — owned by its store agent (lane
// STORE-SCIENCE). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec).
//
// BIG SKY WONDERS, a science / discovery store (double height ~60 % or a hall): the hung solar system over the rocket centrepiece,
// telescopes at the windows, the kit wall, the hands-on demo bench, the glass specimen cabinets under the star-map wall, the cash desk with
// its cash-wrap back counter, the tech wall, stocked back rooms — the dresser and its layout notes: stores/scienceDress.ts.
//
// Loot (docs/skyways-stores/science.md has the full mapping; existing purposes only, Skyways anchor areas only):
//  - sales floor: 'mall-toys' (the Mall toy store: snacks / juice / batteries — what a family discovery store holds) on its open holders
//    (kit shelving, display tables, the till); the TECH holders (device shelving, the till's glass counter) carry a per-holder override
//    'mall-electronics' (torch cells / batteries, the odd flare: scienceDress.ts SCIENCE_TECH_PURPOSE);
//  - stock room: 'mall-toys-back' (batteries, chocolate, water + the back-of-house common rows on its shelving / crates / cabinets);
//  - back office: 'mall-electronics-back' (a science store's back office of spare cells / torches);
//  - the openable containers roll their OWN existing tables (items/lootTables.ts OPENABLE_TABLES): the lab bench drawers (dressings,
//    cells, bio mater), the cash-wrap counter, the glass specimen cabinets (cells, dressings, a flare / kit), cartons, totes, lockers.
//
// Palette: deep night-blue upper walls over white wall tile with a brass rail, white tile floor, a white grid ceiling.

import type {SkywaysStoreSpec} from './types';
import {dressScienceStore} from './scienceDress';

export const STORE_SCIENCE: SkywaysStoreSpec = {
  family: 'science',
  owner: 'lane STORE-SCIENCE',
  dress: (layout, rng, anchor) => dressScienceStore(layout, rng, anchor),
  purposes: {floor: 'mall-toys', stock: 'mall-toys-back', office: 'mall-electronics-back'},
  finish: {
    wall: {paint: 0x22406f, lower: 0xeef2f6, trim: 0xb8923a, kind: 'tile', lowerTop: 1.35, skirt: 0.12, rail: 0.045, peel: 0.12, panel: 0},
    floor: ['tile', 0xe3e8ee],
    ceil: ['grid', 0xeef2f7],
  },
};
