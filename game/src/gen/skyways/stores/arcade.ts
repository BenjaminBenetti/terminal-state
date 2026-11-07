// Task studio-alpha-skyways-shops-20261107-054512-01: THE ARCADE STORE — "Starfall Arcade" (layout version >= 3), owned by its store
// agent (lane STORE-ARCADE). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). The dresser: stores/arcadeDress.ts (the prize
// counter with its glass prize cases and openable back counter / prize cabinet, token changers, claw cranes, kiddie rides, banks and
// back-to-back rows of arcade cabinets, air hockey, pinball, the party zone, the technician's workshop in the stock room).
//
// Loot (existing purposes only, Skyways anchor areas only — gen/purposes.ts):
//  - sales floor 'mall-arcade' (Arcade): the till / prize counters / shelving roll batteries, chocolate, chips, cola; the vending machine
//    snacks and drinks; the cooler water / cola / juice;
//  - stock room 'mall-arcade-back' (Arcade back room): batteries, cola, water (+ the back-of-house common rows in crates / cupboards),
//    staff lockers personal rows;
//  - office 'mall-management' (the arcade manager's office: desk drawers, cupboards — no ammo rows);
//  - per-holder overrides (arcadeDress.ts ARCADE_HOLDER_PURPOSE): prize cases / cabinet 'mall-toys', party tables 'mall-kiosk',
//    technician's tool chests 'mall-electronics-back', staff lockers 'mall-arcade-back'.
//
// Finish (render-only, world/skywaysStoreFinish.ts): a dark arcade — deep indigo walls over a near-black dado with a violet rail, a
// night-blue loop-pile carpet (the starfield's sky; the Office carpet map tinted), the exposed ceiling painted out near-black.

import type {SkywaysStoreSpec} from './types';
import {dressArcadeStore} from './arcadeDress';

export const STORE_ARCADE: SkywaysStoreSpec = {
  family: 'arcade',
  owner: 'lane STORE-ARCADE',
  dress: dressArcadeStore,
  purposes: {floor: 'mall-arcade', stock: 'mall-arcade-back', office: 'mall-management'},
  finish: {
    wall: {paint: 0x221a40, lower: 0x0e0c18, trim: 0xb03cd0, kind: 'paint', lowerTop: 1.2, skirt: 0.12, rail: 0.05, peel: 0.15, panel: 0.15},
    floor: ['carpet', 0x1b1d4f],
    ceil: ['raw', 0x121018],
  },
};
