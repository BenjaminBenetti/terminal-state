// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 3, SERVICES & MEDICAL (contract: gen/bunker/v2/floorApi.ts;
// frame: gen/bunker/v2/spine.ts). The working floor that keeps the shelter alive.
//
// THE IDEA: a SERVICE STREET. One long, tall (5.6 m) internal street runs north-south through the storey between the two stair cores,
// cut into two compartments by a low bulkhead gate (3 m), lit along its crown by a continuous ceiling light trough. Everything that
// keeps people alive opens off it, the way a hospital street or a covered market street works:
//  - west, the SUPPLY DEPOT: the biggest volume of the shelter's working floors (6.4 m), five runs of high pallet racking (picked
//    bare: the stores were drawn down) with the stock that is left on pallets at their feet; the FREIGHT LOBBY in front of the cargo
//    lift is its goods-in bay, the LAUNDRY beside it (linen goes up and down by the lift);
//  - east, the FABRICATION HALL (6 m) under its yellow gantry crane, its WORKS YARD where the service stair lands, the SERVICES PLANT
//    ROOM (generator gen-1) off the yard, a medical-gas cylinder store on the street;
//  - south, where the main stair lands, the INFIRMARY: a waiting hall at the foot of the stair, the long low CASUALTY WARD of curtained
//    bays behind it, a narrow clinical corridor (2.5 m, 3 m clear) of small rooms — treatment, dispensary — ending in an airlock and the
//    dead-end ISOLATION WARD (the medium gas leak).
// Spatial rhythm: the street's long sightline (≈ 48 m) → the compression of the bulkhead gate → the depot's high racks and the
// crane hall → the low ward and the tight clinical corridor. Landmarks: the bulkhead gate, the crane, the racks, the ward's bays, the
// red-cross wall at the street's south end.

import type {Area, AreaKind, Rect, RoomType} from '../../stationTypes';
import {BUNKER_PURPOSE} from '../../reactor/complex/bunkerPurposes';
import type {BunkerFloorModule, FloorAreaOpts, FloorCarveCtx, FloorCarveResult, V2GasClass} from './floorApi';
import {dressFloor3} from './floor3Dress';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});

/** Clear heights above the storey floor (m). */
export const F3_CLEAR = {street: 5.6, depot: 6.4, fab: 6.0, plant: 6.0, yard: 4.6, lobby: 4.2, clinic: 4.0, ward: 3.6, room: 3.4, corr: 3.0, store: 3.2} as const;
/** Door heights (m): the brief's 2.4-3.0 m. */
const DOOR = {wide: 3.0, room: 2.7, narrow: 2.5} as const;

/** The floor's area keys (QA / tests / dress). */
export type F3Key =
  | 'streetN' | 'streetS' | 'depot' | 'ration' | 'lobby' | 'laundry' | 'fab' | 'yard' | 'plant' | 'gasStore' | 'washroom' | 'medStores'
  | 'clinic' | 'ward' | 'corridor' | 'treatment' | 'dispensary' | 'airlock' | 'isolation';

/** The isolation ward's leak (medium) and the cylinder store's (weak, seeded). */
export const F3_GAS = {isolation: 'medium', gasStore: 'weak', gasStoreChance: 0.6} as const;

function carve(ctx: FloorCarveCtx): FloorCarveResult | null {
  const rng = ctx.rng;
  const areas: Record<string, number> = {};
  const room = (key: F3Key, r: Rect, kind: AreaKind, type: RoomType, clear: number, parent: Area | null, opts: FloorAreaOpts): Area | null => {
    const a = ctx.room(r, kind, type, clear, parent ? parent.id : -1, opts);
    if (a) areas[key] = a.id;
    return a;
  };
  // --- the SERVICE STREET (x 70-81): two compartments joined by the bulkhead gate in row 57 ------------------------------------------
  const SX = 70, SW = 12;
  // (a public way: terrazzo; the lock purpose = shelter supplies, no stock furniture, lit-leaning; this floor furnishes it)
  const STREET: FloorAreaOpts = {label: 'Service street', purpose: BUNKER_PURPOSE.lock, publicSpace: true};
  const yN = rng.int(14, 18);
  const streetN = room('streetN', R(SX, yN, SW, 57 - yN), 'room', 'utility', F3_CLEAR.street, null, STREET);
  const streetS = room('streetS', R(SX, 58, SW, 55), 'room', 'utility', F3_CLEAR.street, streetN, STREET);
  if (!streetN || !streetS) return null;
  ctx.door(R(SX + 1, 57, SW - 2, 1), streetN, streetS, DOOR.wide);

  // --- west: the SUPPLY DEPOT, its freight lobby at the cargo lift, the laundry ------------------------------------------------------
  const dy = yN + rng.int(2, 5);
  const depot = room('depot', R(25, dy, 44, 57 - dy), 'room', 'storage', F3_CLEAR.depot, streetN, {label: 'Supply depot', purpose: BUNKER_PURPOSE.lock});
  if (!depot) return null;
  ctx.door(R(SX - 1, rng.int(33, 38), 1, 8), streetN, depot, DOOR.wide);
  // the RATION STORE behind the depot's racks: a modest stock room with one narrow door (the first Bunker's storey-3 ration store;
  // its shelving is the station dresser's stock-room furnishing: parity with version 1's food stock, never more)
  const ration = room('ration', R(10, 38, 14, 16), 'room', 'stock-room', F3_CLEAR.store, depot, {label: 'Ration store', purpose: 'stock-room'});
  if (!ration) return null;
  ctx.door(R(24, rng.int(42, 48), 1, 2), depot, ration, DOOR.narrow);
  // the freight lobby: the lift's loading bay (apron x 56-67, rows 63-70) runs right up to the shaft's north wall
  const lobby = room('lobby', R(46, 58, 23, 13), 'room', 'utility', F3_CLEAR.lobby, streetS, {label: 'Freight lobby', purpose: BUNKER_PURPOSE.lock, noFloorLoot: true});
  if (!lobby) return null;
  ctx.door(R(SX - 1, 59, 1, 10), streetS, lobby, DOOR.wide);
  ctx.door(R(47, 57, 8, 1), lobby, depot, DOOR.wide);
  const laundry = room('laundry', R(24, 59, 21, 11), 'room', 'utility', F3_CLEAR.room, lobby, {label: 'Laundry', purpose: 'supply-closet'});
  if (!laundry) return null;
  ctx.door(R(45, 61, 1, 4), lobby, laundry, DOOR.room);

  // --- east: the FABRICATION HALL, the WORKS YARD (the service stair lands here), the plant room, the cylinder store ----------------
  const fy = yN + rng.int(4, 8), fw = rng.int(34, 38);
  const fab = room('fab', R(83, fy, fw, 57 - fy), 'room', 'utility', F3_CLEAR.fab, streetN, {label: 'Fabrication hall', purpose: 'workshop'});
  if (!fab) return null;
  ctx.door(R(SX + SW, rng.int(fy + 6, 44), 1, 8), streetN, fab, DOOR.wide);
  const yard = room('yard', R(83, 58, 36, 21), 'room', 'utility', F3_CLEAR.yard, streetS, {label: 'Works yard', purpose: BUNKER_PURPOSE.lock});
  if (!yard) return null;
  ctx.door(R(SX + SW, 61, 1, 9), streetS, yard, DOOR.wide);
  ctx.door(R(88, 57, 10, 1), yard, fab, DOOR.wide);
  const ph = rng.int(20, 23);
  const plant = room('plant', R(109, 80, 24, ph), 'room', 'utility', F3_CLEAR.plant, yard, {label: 'Services plant room', purpose: 'generator-room'});
  if (!plant) return null;
  ctx.door(R(111, 79, 5, 1), yard, plant, DOOR.wide);
  const gasStore = room('gasStore', R(83, 81, 13, 12), 'room', 'storage', F3_CLEAR.store, streetS, {label: 'Medical gas store', purpose: BUNKER_PURPOSE.decon});
  if (!gasStore) return null;
  ctx.door(R(SX + SW, 85, 1, 3), streetS, gasStore, DOOR.room);

  // --- the street's west side between the cores: the washroom, the medical stores (the infirmary's supply closet) -------------------
  const washroom = room('washroom', R(56, 84, 13, 11), 'room', 'washroom', F3_CLEAR.room, streetS, {label: 'Washroom', purpose: 'washroom'});
  if (!washroom) return null;
  ctx.door(R(SX - 1, 88, 1, 3), streetS, washroom, DOOR.room);
  const medStores = room('medStores', R(56, 97, 13, 15), 'room', 'storage', F3_CLEAR.store, streetS, {label: 'Medical stores', purpose: 'supply-closet'});
  if (!medStores) return null;
  ctx.door(R(SX - 1, 104, 1, 3), streetS, medStores, DOOR.room);

  // --- south: the INFIRMARY at the main stair (apron x 45-53, rows 114-117) ----------------------------------------------------------
  const clinic = room('clinic', R(36, 114, 46, 14), 'room', 'crew-room', F3_CLEAR.clinic, streetS, {label: 'Infirmary hall', purpose: BUNKER_PURPOSE.decon, publicSpace: true});
  if (!clinic) return null;
  ctx.door(R(SX + 1, 113, SW - 2, 1), streetS, clinic, DOOR.wide);
  const wd = rng.int(14, 16);
  const ward = room('ward', R(36, 129, 46, wd), 'room', 'crew-room', F3_CLEAR.ward, clinic, {label: 'Casualty ward', purpose: BUNKER_PURPOSE.decon});
  if (!ward) return null;
  ctx.door(R(rng.int(55, 59), 128, 6, 1), clinic, ward, DOOR.wide);
  const corridor = room('corridor', R(30, 92, 5, 34), 'room', 'utility', F3_CLEAR.corr, clinic, {label: 'Clinical corridor', purpose: BUNKER_PURPOSE.decon});
  if (!corridor) return null;
  ctx.door(R(35, 116, 1, 4), clinic, corridor, DOOR.room);
  const treatment = room('treatment', R(18, 113, 11, 13), 'room', 'crew-room', F3_CLEAR.room, corridor, {label: 'Treatment room', purpose: 'first-aid-room'});
  if (!treatment) return null;
  ctx.door(R(29, 117, 1, 3), corridor, treatment, DOOR.room);
  const dispensary = room('dispensary', R(18, 100, 11, 11), 'room', 'storage', F3_CLEAR.room, corridor, {label: 'Dispensary', purpose: 'supply-closet'});
  if (!dispensary) return null;
  ctx.door(R(29, 104, 1, 3), corridor, dispensary, DOOR.room);
  // the airlock and the dead-end isolation ward (ONE door: through the airlock)
  const airlock = room('airlock', R(30, 86, 5, 5), 'room', 'utility', F3_CLEAR.corr, corridor, {label: 'Isolation airlock', purpose: BUNKER_PURPOSE.decon, noFloorLoot: true});
  if (!airlock) return null;
  ctx.door(R(31, 91, 3, 1), corridor, airlock, DOOR.narrow);
  const iw = rng.int(24, 28);
  const isolation = room('isolation', R(42 - iw, 71, iw, 14), 'room', 'crew-room', F3_CLEAR.room, airlock, {label: 'Isolation ward', purpose: BUNKER_PURPOSE.decon});
  if (!isolation) return null;
  ctx.door(R(31, 85, 3, 1), airlock, isolation, DOOR.narrow);

  const gas: {area: number; strength: V2GasClass}[] = [{area: isolation.id, strength: F3_GAS.isolation}];
  if (rng.chance(F3_GAS.gasStoreChance)) gas.push({area: gasStore.id, strength: F3_GAS.gasStore});
  return {
    areas,
    generator: {area: plant.id, label: 'Services plant room'},
    gas,
    damp: [],
    aged: [],
  };
}

export const FLOOR_3: BunkerFloorModule = {
  level: 3,
  title: 'Services & medical: the service street (supply depot, fabrication hall, infirmary, isolation ward)',
  carve,
  dress: dressFloor3,
};
