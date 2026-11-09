// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 2, HABITATION (contract: gen/bunker/v2/floorApi.ts; frame:
// gen/bunker/v2/spine.ts; dressing: ./floor2Dress.ts). The shelter's communal heart, planned as a small buried TOWN round its square:
//
//  - THE COMMONS (the V12 void, 14 x 12 m, 11.6 m clear): the great shared room under storey 1's gallery — a basilica-like NAVE with a
//    low colonnaded AISLE on each long side (the Green Walk west, the Arcade east), the MESS HALL opening wide on its north, the STAGE
//    against its blind south wall, and THE LAMP RING (a big hung ring of lamps, the shelter's artificial sun) over the hearth tree in
//    its middle;
//  - the CIVIC BLOCK round it: the mess hall (5.2 m) with the kitchen and pantry behind its servery, the main LANDING (main stair +
//    cargo lift: a freight lobby, 4.4 m) opening wide into the mess, the Green Walk (a planted 3 m aisle, grow lamps) and the Arcade
//    (a 2 m colonnade beside the nave whose blind wall is the residents' wall of notes);
//  - the SCHOOL and the NURSERY between the commons and the street (the children kept close to the square);
//  - THE STREET (two 2 m x 3 m sleeping streets, a fire-door portal between them, 47 m of straight perspective) with the private
//    QUARTERS off it: the barracks dormitory, the family bays, the latrines & showers, the laundry;
//  - the FREIGHT CORRIDOR from the cargo lift's loading bay down to the street (the loop round the main stair core), the GAMES HALL
//    (a 5.6 m recreation / exercise hall) off it;
//  - the UTILITY WING at the service stair: the service landing, the laundry, and the HABITATION PLANT ROOM (generator gen-0).
// Changes of scale are the point: 2 m streets and 3 m cabins, 4-5 m halls, the 11.6 m commons. The architecture is fixed (it is the
// storey's character); seeds vary the secondary choices (which quarters house families, the aged wing, the weak laundry leak, the
// dressing).

import type {Area, AreaKind, Rect, RoomType} from '../../stationTypes';
import {BUNKER_PURPOSE} from '../../reactor/complex/bunkerPurposes';
import type {BunkerFloorModule, FloorAreaOpts, FloorCarveCtx, FloorCarveResult, FloorDressCtx} from './floorApi';
import {dressFloor2} from './floor2Dress';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});

/** One planned area of the storey (cells; `clear` above the storey floor, m). */
export interface F2Spec {
  key: string;
  rect: Rect;
  clear: number;
  kind: AreaKind;
  type: RoomType;
  label: string;
  purpose: string;
  publicSpace?: boolean;
  noFloorLoot?: boolean;
}

/** The storey's areas (the commons first: it is the void's area). Keys are FloorCarveResult.areas keys (QA, tests, dress). */
export const F2_PLAN: readonly F2Spec[] = [
  // the civic block
  {key: 'commons', rect: R(10, 78, 28, 24), clear: 11.6, kind: 'room', type: 'crew-room', label: 'The Commons', purpose: BUNKER_PURPOSE.lock, publicSpace: true},
  {key: 'mess', rect: R(10, 56, 33, 21), clear: 5.2, kind: 'room', type: 'crew-room', label: 'Mess hall', purpose: BUNKER_PURPOSE.lock, publicSpace: true},
  {key: 'kitchen', rect: R(10, 41, 20, 14), clear: 3.6, kind: 'room', type: 'crew-room', label: 'Kitchen', purpose: 'staff-room'},
  {key: 'pantry', rect: R(31, 45, 12, 10), clear: 3.2, kind: 'room', type: 'stock-room', label: 'Pantry', purpose: 'stock-room'},
  {key: 'landing', rect: R(44, 56, 37, 15), clear: 4.4, kind: 'room', type: 'crew-room', label: 'Main landing', purpose: BUNKER_PURPOSE.lock, publicSpace: true},
  {key: 'green', rect: R(3, 62, 6, 54), clear: 3.6, kind: 'room', type: 'crew-room', label: 'The Green Walk', purpose: BUNKER_PURPOSE.lock, publicSpace: true},
  {key: 'arcade', rect: R(39, 78, 4, 38), clear: 3.2, kind: 'room', type: 'crew-room', label: 'The Arcade', purpose: BUNKER_PURPOSE.lock, publicSpace: true},
  // the children, between the square and the street
  {key: 'school', rect: R(10, 103, 14, 13), clear: 3.4, kind: 'room', type: 'crew-room', label: 'Schoolroom', purpose: BUNKER_PURPOSE.dorm},
  {key: 'nursery', rect: R(25, 103, 13, 13), clear: 3.2, kind: 'room', type: 'crew-room', label: 'Nursery', purpose: BUNKER_PURPOSE.dorm},
  // the street and the quarters
  {key: 'westSt', rect: R(3, 117, 40, 4), clear: 3.0, kind: 'room', type: 'crew-room', label: 'Sleeping street', purpose: BUNKER_PURPOSE.dorm},
  {key: 'southSt', rect: R(44, 117, 53, 4), clear: 3.0, kind: 'room', type: 'crew-room', label: 'South street', purpose: BUNKER_PURPOSE.dorm},
  {key: 'dormA', rect: R(3, 122, 19, 16), clear: 3.2, kind: 'room', type: 'crew-room', label: 'Dormitory A', purpose: BUNKER_PURPOSE.dorm},
  {key: 'latrines', rect: R(25, 122, 16, 12), clear: 3.2, kind: 'room', type: 'washroom', label: 'Latrines & showers', purpose: 'washroom'},
  {key: 'dormB', rect: R(44, 122, 19, 16), clear: 3.2, kind: 'room', type: 'crew-room', label: 'Dormitory B', purpose: BUNKER_PURPOSE.dorm},
  {key: 'laundry', rect: R(64, 122, 13, 12), clear: 3.4, kind: 'room', type: 'utility', label: 'Laundry', purpose: 'custodial-room'},
  // the freight route and the games hall
  {key: 'freight', rect: R(68, 72, 6, 44), clear: 3.4, kind: 'room', type: 'utility', label: 'Freight corridor', purpose: BUNKER_PURPOSE.lock},
  {key: 'games', rect: R(75, 92, 22, 24), clear: 5.6, kind: 'room', type: 'crew-room', label: 'Games hall', purpose: 'locker-room'},
  // the utility wing at the service stair
  {key: 'lobby', rect: R(78, 122, 41, 10), clear: 3.6, kind: 'room', type: 'utility', label: 'Service landing', purpose: BUNKER_PURPOSE.lock},
  {key: 'plant', rect: R(108, 103, 22, 18), clear: 5.6, kind: 'room', type: 'utility', label: 'Habitation plant room', purpose: 'generator-room'},
];

/** The openings: [a, b, gap rect, height (m)] — a / b plan keys (the cells join b). */
export const F2_DOORS: readonly (readonly [string, string, Rect, number])[] = [
  // the commons: the mess opens wide on its north; three arches each side into the aisles (the nave's colonnades)
  ['mess', 'commons', R(16, 77, 16, 1), 4.2],
  ['arcade', 'commons', R(38, 79, 1, 6), 3.0], ['arcade', 'commons', R(38, 87, 1, 6), 3.0], ['arcade', 'commons', R(38, 95, 1, 6), 3.0],
  ['green', 'commons', R(9, 79, 1, 6), 3.2], ['green', 'commons', R(9, 87, 1, 6), 3.2], ['green', 'commons', R(9, 95, 1, 6), 3.2],
  // the mess: its landing front, the servery, the aisles' heads
  ['landing', 'mess', R(43, 58, 1, 11), 4.0],
  ['mess', 'kitchen', R(15, 55, 4, 1), 2.6],
  ['kitchen', 'pantry', R(30, 48, 1, 3), 2.4],
  ['mess', 'arcade', R(39, 77, 4, 1), 3.0],
  ['mess', 'green', R(9, 66, 1, 7), 3.2],
  // the children
  ['arcade', 'nursery', R(38, 106, 1, 3), 2.6],
  ['school', 'nursery', R(24, 108, 1, 3), 2.4],
  ['westSt', 'school', R(15, 116, 3, 1), 2.6],
  // the street: the aisles' feet, the fire-door portal, the quarters
  ['green', 'westSt', R(3, 116, 6, 1), 3.0],
  ['arcade', 'westSt', R(39, 116, 4, 1), 3.0],
  ['westSt', 'southSt', R(43, 117, 1, 4), 3.0],
  ['westSt', 'dormA', R(10, 121, 3, 1), 2.6],
  ['westSt', 'latrines', R(31, 121, 3, 1), 2.6],
  ['southSt', 'dormB', R(51, 121, 3, 1), 2.6],
  ['southSt', 'laundry', R(68, 121, 3, 1), 2.6],
  // the freight route, the games hall
  ['landing', 'freight', R(68, 71, 6, 1), 3.0],
  ['freight', 'southSt', R(68, 116, 6, 1), 3.0],
  ['freight', 'games', R(74, 100, 1, 4), 3.0],
  ['southSt', 'games', R(84, 116, 4, 1), 3.0],
  // the utility wing
  ['southSt', 'lobby', R(82, 121, 6, 1), 3.0],
  ['lobby', 'laundry', R(77, 125, 1, 3), 2.6],
  ['lobby', 'plant', R(110, 121, 6, 1), 3.0],
];

/** QA / tests: what the last carve chose. */
export const F2_CARVE_STATS = {family: '', aged: [] as string[], leak: false};

function carve2(ctx: FloorCarveCtx): FloorCarveResult | null {
  const rng = ctx.rng;
  const out: Record<string, number> = {};
  const byKey = new Map<string, Area>();
  const parentOf: Record<string, string> = {
    mess: 'landing', commons: 'mess', kitchen: 'mess', pantry: 'kitchen', green: 'mess', arcade: 'mess', school: 'westSt', nursery: 'arcade',
    westSt: 'arcade', southSt: 'westSt', dormA: 'westSt', latrines: 'westSt', dormB: 'southSt', laundry: 'southSt', freight: 'landing',
    games: 'freight', lobby: 'southSt', plant: 'lobby',
  };
  // seeded secondary choices (the architecture is the storey's character; these vary per shelter)
  const family = rng.chance(0.5) ? 'dormA' : 'dormB';
  const plan = F2_PLAN.map(s => {
    if (s.key === family) return {...s, label: 'Family quarters'};
    if (s.key === 'dormA' || s.key === 'dormB') return {...s, label: 'Dormitory'};
    return s;
  });
  // the landing first (the hub every parent chain reaches), then the rest in plan order
  const order = [...plan].sort((p, q) => +(q.key === 'landing') - +(p.key === 'landing'));
  for (const s of order) {
    const parent = byKey.get(parentOf[s.key] ?? '')?.id ?? -1;
    const opts: FloorAreaOpts = {label: s.label, purpose: s.purpose, publicSpace: s.publicSpace ?? false};
    if (s.noFloorLoot) opts.noFloorLoot = true;
    const a = ctx.room(s.rect, s.kind, s.type, s.key === 'commons' && ctx.frame.owns ? ctx.frame.owns.ceil - ctx.base : s.clear, parent, opts);
    if (!a) return null;
    byKey.set(s.key, a);
    out[s.key] = a.id;
  }
  // parents of areas carved before their parent (the landing went first): fix the chain
  for (const s of plan) {
    const a = byKey.get(s.key)!, p = byKey.get(parentOf[s.key] ?? '');
    if (p && a.parent !== p.id) { a.parent = p.id; a.depth = p.depth + 1; }
  }
  for (const [ka, kb, gap, h] of F2_DOORS) ctx.door(gap, byKey.get(ka)!, byKey.get(kb)!, h, gap.w > 4 || gap.h > 4);
  // the aged wing: the plain dormitory (its fixtures dark / sputtering, fallen panels) — and sometimes the laundry beside it
  const plainDorm = family === 'dormA' ? 'dormB' : 'dormA';
  const aged = [plainDorm, ...(rng.chance(0.4) ? ['laundry'] : [])];
  // gas: a weak chlorine leak in the laundry on about half the shelters (the storey's only one; never strong)
  const leak = rng.chance(0.5);
  F2_CARVE_STATS.family = family; F2_CARVE_STATS.aged = aged; F2_CARVE_STATS.leak = leak;
  return {
    areas: out,
    generator: {area: out.plant, label: 'Habitation plant room'},
    gas: leak ? [{area: out.laundry, strength: 'weak'}] : [],
    damp: [],
    aged: aged.map(k => out[k]),
  };
}

export const FLOOR_2: BunkerFloorModule = {
  level: 2,
  title: 'Habitation — a buried town round the Commons (the 11.6 m nave under the lamp ring), its mess, school, street and quarters',
  carve: carve2,
  dress(ctx: FloorDressCtx): void { dressFloor2(ctx); },
};
