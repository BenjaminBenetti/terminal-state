// Task studio-alpha-skyways-shops-20261107-054512-01: THE GARDEN STORE (layout version >= 3) — owned by its store agent (lane
// STORE-GARDEN). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). The dresser: stores/gardenDress.ts (Glasshouse Garden Co.:
// a real garden centre — tiered plant benches and big planters, potting benches with cupboards under tool pegboards, seed racks,
// soil pallets, hanging baskets in the tall glasshouse, a cash desk with its openable back counter, a stocked potting shed).
//
// LOOT (existing purposes only; user: "garden = only water" is not acceptable). Area roles (types.ts StorePurposes):
//  - the sales floor -> 'mall-hardware' (garden supplies: cells for lamps / timers, flares, bottled water, dressings): its tills,
//    potting-bench cupboards (cabinetLow), the tool chest, the supply shelving and the cash desk's back counter roll those rows;
//  - the stock room (the potting shed) -> 'mall-hardware-back' (cells, flares, water; crates / totes add tinned food and dressings;
//    lockers personal stock; the tool locker cells / flares / dressings / water);
//  - the office -> 'mall-management' (snacks, water, dressings, a cell; desk drawers / cabinets as the Mall's management office).
// Per holder (PropPlacement.purpose, gardenDress.ts GARDEN_HOLDER_PURPOSE): the pipe-and-plank shelving 'mall-outdoors' (outdoor-living
// supplies: flares, cells, water, tinned food), staff fridges 'mall-food-back' (food and drink), first-aid kits 'mall-first-aid'
// (dressings). The drinks cooler rolls the Mall sales cooler (water, cola, juice). No floor piles (the store areas are noFloorLoot).
//
// FINISH (the user's references 06 / 02: brick walls, timber, brick-paver floor, a raw glasshouse roof): warm brick-red glazed tile
// floor to ceiling, a terracotta paver floor, a dark timber-toned raw ceiling.

import type {SkywaysStoreSpec, StorePurposes} from './types';
import {dressGarden} from './gardenDress';

export const GARDEN_PURPOSES: StorePurposes = {floor: 'mall-hardware', stock: 'mall-hardware-back', office: 'mall-management'};

export const STORE_GARDEN: SkywaysStoreSpec = {
  family: 'garden',
  owner: 'lane STORE-GARDEN',
  dress: (layout, rng, anchor) => dressGarden(layout, rng, anchor),
  purposes: GARDEN_PURPOSES,
  finish: {
    // brick-red glazed tile to the ceiling (lowerTop past the 7.5 m glasshouse: no painted band), dark timber skirting
    wall: {paint: 0xd8cdbb, lower: 0x8c4a35, trim: 0x3a2a1f, kind: 'tile', lowerTop: 9, skirt: 0.12, rail: 0, peel: 0.18, panel: 0},
    // terracotta pavers
    floor: ['tile', 0xa0603f],
    // the raw roof structure in a dark timber tone (the slatted-wood ceiling of the court reference)
    ceil: ['raw', 0x5c4331],
  },
};
