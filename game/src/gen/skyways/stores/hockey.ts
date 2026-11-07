// Task studio-alpha-skyways-shops-20261107-054512-01: THE HOCKEY STORE (layout version >= 3) — owned by its store agent (lane
// STORE-HOCKEY). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). Blue Line Sports: a hockey pro shop (stores/hockeyDress.ts:
// cash desk, skate-sharpening counter, shooting lane, team lockers, jersey wall, boot / gear walls, stick racks, back room), its own
// drawn stock and fixtures (stores/kinds/hockey.ts, stores/hockeyParts.ts), Mall sporting-goods loot and a rink palette.

import type {SkywaysStoreSpec} from './types';
import {HOCKEY_PURPOSE, dressHockeyStore} from './hockeyDress';

export const STORE_HOCKEY: SkywaysStoreSpec = {
  family: 'hockey',
  owner: 'lane STORE-HOCKEY',
  dress: (layout, rng, anchor) => dressHockeyStore(layout, rng, anchor),
  // the Mall's sporting-goods tables (water / dressings / energy bars / juice; the till's leftovers; the cooler's drinks), its stock
  // room's for the back rooms (the store's office too: its desk / safe / cabinets roll the sports back office, not a station agent's)
  purposes: {floor: HOCKEY_PURPOSE.floor, stock: HOCKEY_PURPOSE.back, office: HOCKEY_PURPOSE.back},
  // the rink: ice-white walls over Blue Line blue dasher boards to 1.07 m (2 m board sections, a red cap rail and skirting), the black
  // rubber floor of a skate shop (skates walk on it), a white grid ceiling
  finish: {
    wall: {paint: 0xe9eef2, lower: 0x1d3f8f, trim: 0xb02a2a, kind: 'paint', lowerTop: 1.07, skirt: 0.2, rail: 0.05, peel: 0.18, panel: 2.0},
    floor: ['vinyl', 0x2c3034],
    ceil: ['grid', undefined],
  },
};
