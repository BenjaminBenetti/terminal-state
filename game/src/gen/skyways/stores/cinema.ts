// Task studio-alpha-skyways-shops-20261107-054512-01: THE CINEMA STORE (layout version >= 3) — owned by its store agent (lane
// STORE-CINEMA). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec).
//
// The Aurora Picture House: an old picture house in the multi-zone format — a LOBBY (box office, concession stand, poster cases, rope
// queue, benches) and the AUDITORIUM behind it (screen, seat rows, aisles, exit plate), with its back of house (stock room / office).
// The dresser: stores/cinemaDress.ts (placement kit stores/cinemaKit.ts; its art kinds stores/kinds/cinema.ts + stores/cinemaArt.ts).
//
// Loot (existing purposes only, Skyways-scoped; no new tables, no floor piles):
//  - floor (the lobby = the concession): `mall-kiosk` — the Mall's snack kiosk: candy and chips on the display case / snack rack / back
//    units, drinks in the cooler, a kiosk till (what people leave behind) — the concession's stock;
//  - zones (the auditorium = front of house): `mall-customer-service` — the Mall's customer-service desk: dropped snacks and drinks, an
//    usher's cupboard with dressings and torch cells;
//  - stock (the stock room): `mall-food-back` — the Mall's kitchen store room: the concession's dry stock (beans, noodles, chips, cola,
//    juice, water; frozen-case rows in the chest freezer);
//  - office (the agent-office room when carved): `office-private` — the Office's private office (desk drawers, filing, cabinets).
//  Per-holder keys (stores/cinemaDress.ts): the staff filing cabinet / lockers placed outside the office carry `office-private`.
//
// Palette (render-only, world/skywaysStoreFinish.ts): deep red plaster over a walnut dado with gold trim, burgundy carpet, a dark plum
// ceiling in the lobby; the auditorium darker still (oxblood walls over a dark wood dado, near-black ceiling, darker carpet).

import type {SkywaysStoreSpec} from './types';
import {CINEMA_PURPOSES, dressCinema} from './cinemaDress';

export const STORE_CINEMA: SkywaysStoreSpec = {
  family: 'cinema',
  owner: 'lane STORE-CINEMA',
  dress: (layout, rng, anchor) => dressCinema(layout, rng, anchor),
  purposes: {...CINEMA_PURPOSES},
  finish: {
    wall: {paint: 0x6e1c26, lower: 0x3f2416, trim: 0xc9a24a, kind: 'wood', lowerTop: 1.15, skirt: 0.14, rail: 0.05, peel: 0.22, panel: 0.6},
    floor: ['carpet', 0x6a1824],
    ceil: ['plain', 0x2e1c22],
    zones: {
      wall: {paint: 0x3e0f16, lower: 0x2a170e, trim: 0x9c7a34, kind: 'wood', lowerTop: 1.0, skirt: 0.12, rail: 0.04, peel: 0.18, panel: 0.9},
      floor: ['carpet', 0x3c0e16],
      ceil: ['plain', 0x141012],
    },
  },
};
