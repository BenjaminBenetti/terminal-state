// Task studio-bunker-level-20261109-072224-01: THE BUNKER's storey PROGRAMMES — the rooms each shelter storey grows onto its corridor
// skeleton, as specs of the Reactor shelter's seeded room-graph planner (gen/reactor/complex/bunkerPlan.ts Planner / Spec / room:
// sizes in 0.5 m cells [long min, long max, short min, short max], the rooms they open off by class — 'hub' = the storey's MAIN stair
// lobby (planner key 'muster'), 'corr' = any other corridor (the spine, the service stair lobby, grown corridors), else a room key —,
// wing affinity, growth caps). Pure data.
//
// Purposes reuse the existing ids (gen/purposes.ts + the Reactor shelter's REACTOR_BUNKER_PURPOSES): the station dresser furnishes /
// lights / loots the rooms by them (dormitories, armoury, radio / control rooms, filtration and the big halls get the shelter's own
// furnishing in gen/bunker/dress.ts). Loot comes from the named tables those purposes carry — never a new literal item list.

import type {RoomType} from '../stationTypes';
import {room, type Spec} from '../reactor/complex/bunkerPlan';
import {BUNKER_PURPOSE} from '../reactor/complex/bunkerPurposes';
import {BUNKER} from './frame';

const C = BUNKER.clear;

/** A storey's programme: rooms every seed has (placed in order), the optional rooms (a seeded subset) and the void-filling spare. */
export interface StoreyProgramme {
  id: string;
  required: readonly Spec[];
  optional: readonly Spec[];
  spare: Spec;
  /** Extra corridors grown off the skeleton: weighted counts. */
  corridors: readonly (readonly [number, number])[];
}

const store = (key: string, label: string, type: RoomType = 'storage', purpose = 'storage', parents: Readonly<Record<string, number>> = {corr: 1, hub: 0.4}): Spec =>
  room(key, label, type, purpose, {role: 'store', clear: C.store, size: [8, 12, 8, 10], parents, cap: [13, 11]});
const latrine = (label: string, near?: string): Spec =>
  room('washroom', label, 'washroom', 'washroom', {size: [9, 12, 8, 10], parents: {corr: 1, hub: 0.4, ...(near ? {[near]: 0.9} : {})}, req: true, ...(near ? {near} : {}), cap: [14, 12]});
const genroom = (label: string): Spec =>
  room('genroom', label, 'utility', 'generator-room', {role: 'generator', clear: C.hall2, size: [17, 22, 12, 14], parents: {corr: 1, hub: 0.3}, wing: 'plant', req: true,
    maxDoors: 2, deep: 0.5, cap: [24, 16], kids: 1});

/** Storey 1 — ENTRY & SECURITY: decontamination off the main stair, the muster hall, the security checkpoint and its armoury, operations. */
const ENTRY: StoreyProgramme = {
  id: 'entry',
  required: [
    room('decon', 'Decontamination', 'utility', BUNKER_PURPOSE.decon, {clear: C.room, size: [12, 16, 9, 12], parents: {hub: 2, corr: 0.2}, wing: 'entry', req: true, cap: [18, 14], maxDoors: 3}),
    room('hall', 'Muster hall', 'crew-room', BUNKER_PURPOSE.lock, {role: 'hall', clear: C.hall2, size: [22, 30, 14, 18], parents: {decon: 2, hub: 0.6, corr: 0.8}, wing: 'hub', req: true,
      door: 'junction', dw: [4, 5], cap: [34, 22], maxDoors: 5}),
    room('guard', 'Security checkpoint', 'utility', 'security-office', {size: [10, 14, 9, 11], parents: {hub: 1.2, corr: 0.8, hall: 0.6}, wing: 'ops', req: true, cap: [16, 13]}),
    room('armoury', 'Armoury', 'storage', BUNKER_PURPOSE.armoury, {role: 'vault', clear: C.store, size: [9, 12, 9, 11], parents: {guard: 2, corr: 0.3}, wing: 'ops', req: true, leaf: true, cap: [14, 12]}),
    room('radio', 'Operations room', 'utility', BUNKER_PURPOSE.radio, {size: [12, 16, 11, 13], parents: {corr: 1, hall: 0.6, guard: 0.6}, wing: 'ops', req: true, maxDoors: 2, cap: [18, 14]}),
    latrine('Latrines'),
  ],
  optional: [
    room('warden', 'Shelter warden\'s office', 'agent-office', 'agent-office', {size: [9, 11, 9, 10], parents: {corr: 1, guard: 0.8, hall: 0.5}, wing: 'ops', cap: [13, 11]}),
    room('lockers', 'Locker room', 'crew-room', 'locker-room', {size: [9, 12, 10, 11], parents: {corr: 1, decon: 0.8, hub: 0.5}, wing: 'living', cap: [14, 12]}),
    room('records', 'Records office', 'agent-office', 'agent-office', {size: [9, 11, 8, 10], parents: {corr: 1, hall: 0.4}, wing: 'ops', cap: [13, 11]}),
    store('stores', 'Entry stores'),
  ],
  spare: store('store', 'Storeroom'),
  corridors: [[1, 3], [2, 4], [3, 2]],
};

/** Storey 2 — HABITATION: dormitories, mess hall + kitchen + pantry, latrines / showers, recreation, generator #1's plant room. */
const HABITATION: StoreyProgramme = {
  id: 'habitation',
  required: [
    genroom('Habitation plant room'),
    room('mess', 'Mess hall', 'crew-room', 'staff-room', {role: 'hall', size: [18, 26, 12, 17], parents: {corr: 1, hub: 0.8}, wing: 'living', req: true, door: 'junction', dw: [4, 5],
      cap: [30, 20], avoid: ['genroom'], maxDoors: 5}),
    room('kitchen', 'Kitchen', 'crew-room', 'staff-room', {size: [10, 14, 9, 11], parents: {mess: 2, corr: 0.3}, wing: 'living', req: true, near: 'mess', cap: [16, 12]}),
    room('rations', 'Pantry', 'stock-room', 'stock-room', {role: 'store', clear: C.store, size: [9, 12, 8, 10], parents: {mess: 1.5, kitchen: 1.5, corr: 0.4}, wing: 'living', req: true, near: 'kitchen', cap: [14, 12]}),
    room('dorm', 'Dormitory A', 'crew-room', BUNKER_PURPOSE.dorm, {size: [16, 22, 13, 16], parents: {corr: 1, hub: 0.4}, wing: 'living', req: true, kids: 1, cap: [26, 18], avoid: ['genroom']}),
    room('dorm2', 'Dormitory B', 'crew-room', BUNKER_PURPOSE.dorm, {size: [15, 20, 13, 15], parents: {corr: 1, hub: 0.3}, wing: 'living', req: true, kids: 1, cap: [24, 16], avoid: ['genroom']}),
    latrine('Latrines & showers', 'dorm'),
    room('rec', 'Recreation room', 'crew-room', 'staff-room', {size: [12, 16, 10, 13], parents: {corr: 1, mess: 0.8, hub: 0.4}, wing: 'living', req: true, cap: [18, 14]}),
  ],
  optional: [
    room('dorm3', 'Dormitory C', 'crew-room', BUNKER_PURPOSE.dorm, {size: [14, 18, 12, 14], parents: {corr: 1}, wing: 'living', kids: 1, cap: [22, 15], avoid: ['genroom']}),
    room('lockers', 'Locker room', 'crew-room', 'locker-room', {size: [9, 12, 10, 11], parents: {corr: 1, dorm: 0.7, dorm2: 0.7}, wing: 'living', cap: [14, 12]}),
    room('laundry', 'Laundry', 'utility', 'custodial-room', {size: [9, 12, 8, 10], parents: {corr: 1, washroom: 0.6}, wing: 'living', cap: [14, 12]}),
    store('stores', 'Linen store'),
  ],
  spare: store('store', 'Storeroom'),
  corridors: [[1, 2], [2, 4], [3, 3]],
};

/** Storey 3 — SERVICES & MEDICAL: infirmary + isolation ward, stores and the warehouse, the workshop, generator #2's plant room. */
const SERVICES: StoreyProgramme = {
  id: 'services',
  required: [
    genroom('Services plant room'),
    room('hall', 'Warehouse', 'stock-room', 'stock-room', {role: 'hall', clear: C.hall2, size: [22, 30, 14, 18], parents: {corr: 1, hub: 0.5}, wing: 'plant', req: true, door: 'junction', dw: [4, 5],
      cap: [32, 20], maxDoors: 4}),
    room('infirmary', 'Infirmary', 'crew-room', 'first-aid-room', {size: [12, 16, 10, 13], parents: {corr: 1, hub: 0.8}, wing: 'ops', req: true, cap: [18, 15], avoid: ['genroom']}),
    room('isolation', 'Isolation ward', 'crew-room', 'first-aid-room', {size: [12, 16, 10, 12], parents: {infirmary: 1.6, corr: 0.5}, wing: 'ops', req: true, cap: [18, 14], avoid: ['genroom']}),
    room('stores', 'Shelter stores', 'storage', 'storage', {role: 'store', clear: C.store, size: [11, 15, 9, 12], parents: {corr: 1, hall: 0.8}, wing: 'plant', req: true, cap: [16, 13]}),
    room('workshop', 'Workshop', 'utility', 'workshop', {size: [10, 14, 10, 12], parents: {corr: 1, hall: 0.8}, wing: 'plant', req: true, cap: [16, 14]}),
    latrine('Washroom'),
  ],
  optional: [
    room('medstore', 'Medical stores', 'storage', 'first-aid-room', {role: 'store', clear: C.store, size: [8, 11, 8, 10], parents: {infirmary: 1.5, corr: 0.5}, wing: 'ops', cap: [12, 11]}),
    room('records', 'Records office', 'agent-office', 'agent-office', {size: [9, 11, 8, 10], parents: {corr: 1}, wing: 'ops', cap: [13, 11]}),
    room('laundry', 'Laundry', 'utility', 'custodial-room', {size: [9, 12, 8, 10], parents: {corr: 1}, wing: 'living', cap: [14, 12]}),
    store('stores2', 'Ration store', 'stock-room', 'stock-room', {corr: 1, hall: 1}),
  ],
  spare: store('store', 'Storeroom'),
  corridors: [[1, 2], [2, 4], [3, 3]],
};

/** Storey 4 — MAINTENANCE & WATER: the pump hall, water treatment, air filtration, the boiler room, generator #3's (damp) plant room. */
const MAINTENANCE: StoreyProgramme = {
  id: 'maintenance',
  required: [
    genroom('Maintenance plant room'),
    room('hall', 'Pump hall', 'utility', 'pump-room', {role: 'hall', clear: C.hall2, size: [24, 32, 14, 18], parents: {corr: 1, hub: 0.5}, wing: 'plant', req: true, door: 'junction', dw: [4, 5],
      cap: [34, 20], maxDoors: 4}),
    room('treatment', 'Water treatment', 'utility', 'pump-room', {size: [14, 18, 10, 13], parents: {hall: 1.5, corr: 0.8}, wing: 'plant', req: true, cap: [20, 15]}),
    room('filtration', 'Air filtration plant', 'utility', 'ventilation-plant', {size: [13, 17, 10, 13], parents: {corr: 1, hall: 0.6}, wing: 'plant', req: true, maxDoors: 2, cap: [19, 14]}),
    room('boiler', 'Boiler room', 'utility', 'boiler-room', {size: [12, 16, 10, 12], parents: {corr: 1, hall: 0.5}, wing: 'plant', req: true, cap: [18, 14]}),
    room('workshop', 'Maintenance workshop', 'utility', 'workshop', {size: [10, 14, 10, 12], parents: {corr: 1}, wing: 'plant', req: true, cap: [16, 14]}),
  ],
  optional: [
    room('valves', 'Valve room', 'utility', 'electrical-room', {size: [9, 12, 8, 10], parents: {hall: 1.2, corr: 0.6}, wing: 'plant', cap: [14, 12]}),
    store('stores', 'Maintenance stores'),
    room('lockers', 'Crew locker room', 'crew-room', 'locker-room', {size: [9, 12, 9, 11], parents: {corr: 1}, wing: 'living', cap: [14, 12]}),
    latrine('Washroom'),
  ],
  spare: store('store', 'Storeroom'),
  corridors: [[1, 2], [2, 4], [3, 3]],
};

/** Storey 5 — the CENTRAL PROCESSING CORE: the tall hall of racks round the core cluster, cooling plant, control and switch rooms. */
const CORE: StoreyProgramme = {
  id: 'core',
  required: [
    room('hall', 'Central processing hall', 'utility', BUNKER_PURPOSE.lock, {role: 'hall', clear: C.core, size: [36, 48, 22, 28], parents: {corr: 1, hub: 0.6}, wing: 'ops', req: true, door: 'junction',
      dw: [5, 6], cap: [54, 32], maxDoors: 6, loopy: 0.8, kids: 4}),
    room('cooling', 'Cooling plant', 'utility', 'ventilation-plant', {size: [13, 17, 10, 13], parents: {hall: 1.5, corr: 0.6}, wing: 'plant', req: true, maxDoors: 2, cap: [19, 14]}),
    room('control', 'Core control room', 'utility', BUNKER_PURPOSE.radio, {size: [12, 16, 11, 13], parents: {hall: 1.2, corr: 1}, wing: 'ops', req: true, maxDoors: 2, cap: [18, 14]}),
    room('switch', 'Switch room', 'utility', 'electrical-room', {clear: C.room, size: [9, 12, 8, 10], parents: {hall: 1.2, corr: 0.6}, wing: 'plant', req: true, noKids: true, cap: [14, 12]}),
  ],
  optional: [
    room('chiller', 'Chiller room', 'utility', 'pump-room', {size: [11, 15, 9, 12], parents: {corr: 1, cooling: 0.8}, wing: 'plant', cap: [16, 13]}),
    store('tapes', 'Tape store'),
    latrine('Washroom'),
    room('records', 'Operators\' office', 'agent-office', 'agent-office', {size: [9, 11, 8, 10], parents: {corr: 1, control: 0.8}, wing: 'ops', cap: [13, 11]}),
  ],
  spare: store('store', 'Storeroom'),
  corridors: [[1, 3], [2, 4], [3, 2]],
};

/** The programme of shelter storey 1..5 (index = layout level). */
export const BUNKER_STOREY_PROGRAMMES: Readonly<Record<number, StoreyProgramme>> = {1: ENTRY, 2: HABITATION, 3: SERVICES, 4: MAINTENANCE, 5: CORE};

/** Door / wayfinding plate text by planner key (the shelter's own words). */
export const BUNKER_PLATES: Readonly<Record<string, string>> = {
  decon: 'DECONTAMINATION', hall: '', guard: 'SECURITY CHECKPOINT', armoury: 'ARMOURY · AUTHORISED ONLY', radio: 'OPERATIONS', washroom: 'LATRINES',
  warden: 'WARDEN', lockers: 'LOCKER ROOM', records: 'RECORDS', stores: 'STORES', stores2: 'RATION STORE', store: 'STORE', genroom: 'AUX GENERATOR · DANGER',
  mess: 'MESS HALL', kitchen: 'KITCHEN', rations: 'PANTRY', dorm: 'DORMITORY A', dorm2: 'DORMITORY B', dorm3: 'DORMITORY C', rec: 'RECREATION', laundry: 'LAUNDRY',
  infirmary: 'INFIRMARY', isolation: 'ISOLATION WARD · MASKS ON', medstore: 'MEDICAL STORES', workshop: 'WORKSHOP', treatment: 'WATER TREATMENT',
  filtration: 'AIR FILTRATION', boiler: 'BOILER ROOM · DANGER', valves: 'VALVE ROOM', cooling: 'COOLING PLANT', control: 'CORE CONTROL', switch: 'SWITCH ROOM · DANGER',
  chiller: 'CHILLER ROOM', tapes: 'TAPE STORE',
};
/** The big halls' plates by storey (planner key 'hall'). */
export const BUNKER_HALL_PLATES: Readonly<Record<number, string>> = {1: 'MUSTER HALL', 3: 'WAREHOUSE', 4: 'PUMP HALL', 5: 'PROCESSING CORE'};
