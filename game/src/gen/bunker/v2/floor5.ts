// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 5, the CENTRAL PROCESSING CORE (contract: gen/bunker/v2/floorApi.ts;
// frame: gen/bunker/v2/spine.ts; dressing: ./floor5Dress.ts). The deepest walkable storey: the shelter's brain, where the operators
// lived beside the machines in shifts.
//
// Spatial idea — one strong axis, two scales of industry, a lived-in commons, tight technical rooms between them:
//  - THE NAVE (the V45 void, 21 x 10 m, 11.6 m clear, seen from storey 4's catwalk): the processing hall. Its long axis runs west ->
//    east from a low CLEAN-ROOM LOBBY (the narthex, 3.0 m: lockers, benches) through the west portal to the CORE CLUSTER standing
//    against the east wall (the screen wall terminates the axis). A cross axis comes in from the north (the operators' gallery) and
//    ends on the coolant risers in the middle of the south wall; ranks of reel-to-reel tape cabinets and server racks line both long
//    walls either side of that crossing, the operators' console desks face the screen.
//  - The OPERATORS' GALLERY (3.4 m, 4.5 m wide): the low artery along the nave's north side where the main stair lands.
//  - North of it, on the cross axis: the CORE CONTROL ROOM (3.6 m), then the COOLING PLANT (6.4 m, the second big volume: coolant
//    pumps, pipe banks, air handlers), then the FREIGHT LOBBY of the cargo lift (4.0 m, a generous loading bay): one straight
//    freight route lift -> cooling -> control -> gallery -> nave, ~37 m long.
//  - Tight technical rooms in the slot between core A and the axis: the CHILLER ROOM (dead end, a weak refrigerant leak) and the
//    SWITCH ROOM (a through room: the second way between the gallery and the control room — a loop).
//  - Off the freight lobby: the TAPE LIBRARY (records vault, 3.0 m, narrow aisles of shelving) to the west and the OPERATORS'
//    COMMONS (5.2 m: where the night shift ate, played and kept a few plants alive under the lamps; the service stair lands in it)
//    to the east, with the shift's BUNK ROOM and WASHROOM off its north side.
// Seeded inside the fixed anchors: the narthex door, the library's and the commons' extents, the bunk room / washroom order, the
// chiller / switch split.

import type {Area, AreaKind, Rect, RoomType} from '../../stationTypes';
import {BUNKER_PURPOSE} from '../../reactor/complex/bunkerPurposes';
import type {BunkerFloorModule, FloorCarveCtx, FloorCarveResult} from './floorApi';
import {dressFloor5} from './floor5Dress';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});

/** Clear heights (m above the storey floor). */
export const F5_CLEAR = {gallery: 3.4, narthex: 3.0, control: 3.6, cooling: 6.4, chiller: 3.4, switch: 3.2, bay: 4.0, library: 3.0, commons: 5.2, bunks: 3.0, wash: 3.0, cableway: 2.8, battery: 3.2} as const;
/** Door heights (m). */
const DOOR = {grand: 3.0, wide: 3.0, room: 2.6} as const;

/** The cross axis (cells): the nave's north door, the control room's doors and the cooling plant's north door share these columns. */
export const F5_AXIS = {x: 69, w: 6} as const;

/** Area keys (FloorCarveResult.areas) of this storey. */
export type F5Key = 'nave' | 'narthex' | 'gallery' | 'control' | 'cooling' | 'chiller' | 'switch' | 'bay' | 'library' | 'commons' | 'bunks' | 'wash' | 'cableway' | 'battery';

function carve5(ctx: FloorCarveCtx): FloorCarveResult | null {
  const rng = ctx.rng, own = ctx.frame.owns;
  if (!own) return null;
  const areas: Record<string, number> = {};
  const add = (key: F5Key, r: Rect, kind: AreaKind, type: RoomType, clear: number, parent: Area | null, label: string, purpose: string, noFloorLoot = false): Area | null => {
    const a = ctx.room(r, kind, type, clear, parent ? parent.id : -1, {label, purpose, publicSpace: false, noFloorLoot});
    if (a) areas[key] = a.id;
    return a;
  };
  const V = own.rect; // the nave = the void rect exactly (x 50..91, rows 124..143)
  // --- the south band: gallery (main stair apron), narthex, nave -------------------------------------------------------------------
  const gallery = add('gallery', R(36, V.y - 10, V.x + V.w - 36, 9), 'passage', 'utility', F5_CLEAR.gallery, null, 'Operators\' gallery', BUNKER_PURPOSE.lock);
  if (!gallery) return null;
  // (purpose 'office-server': the tech theme — the racks' and desks' finds read as computing spares, not generic supplies)
  const nave = add('nave', {...V}, 'room', 'utility', own.ceil - ctx.base, gallery, 'Central processing hall', 'office-server');
  // the clean-room lobby west of the nave: its east wall is the nave's west wall (the portal)
  const nx0 = 38 - rng.int(0, 2);
  const narthex = add('narthex', R(nx0, V.y, V.x - 1 - nx0, 14), 'room', 'crew-room', F5_CLEAR.narthex, gallery, 'Clean-room lobby', 'locker-room');
  if (!nave || !narthex) return null;
  // --- the cross axis north of the gallery: control room, cooling plant, freight lobby -------------------------------------------
  const B = ctx.spine.cores[1].rect; // core B (x 98..106)
  const cx0 = F5_AXIS.x - 1, cx1 = B.x - 2; // x 68 .. 96
  const control = add('control', R(cx0, 100, cx1 - cx0 + 1, gallery.y - 1 - 100), 'room', 'utility', F5_CLEAR.control, gallery, 'Core control room', BUNKER_PURPOSE.radio);
  const cooling = add('cooling', R(cx0, 72, cx1 - cx0 + 1, 99 - 72), 'room', 'utility', F5_CLEAR.cooling, control, 'Cooling plant', 'ventilation-plant');
  const lift = ctx.frame.anchors.find(a => a.id === 'lift')!;
  const bay = add('bay', R(lift.apron.x, 58, cx1 - lift.apron.x + 1, lift.apron.y + lift.apron.h - 58), 'room', 'storage', F5_CLEAR.bay, cooling, 'Freight lobby', BUNKER_PURPOSE.lock);
  if (!control || !cooling || !bay) return null;
  // --- the technical slot between core A and the axis (x 56..66): chiller (dead end) over the switch room (through room) -----------
  const split = 96 + rng.int(-2, 1); // the wall row between them
  const chiller = add('chiller', R(56, 84, 11, split - 84), 'room', 'utility', F5_CLEAR.chiller, cooling, 'Chiller room', 'pump-room');
  const sw = add('switch', R(56, split + 1, 11, gallery.y - 1 - (split + 1)), 'room', 'utility', F5_CLEAR.switch, gallery, 'Switch room', 'electrical-room');
  if (!chiller || !sw) return null;
  // --- off the freight lobby: the tape library (west), the operators' commons (east) + its bunk room / washroom ---------------------
  const lx0 = 38 - rng.int(0, 6), ly0 = 56 - rng.int(0, 3);
  const library = add('library', R(lx0, ly0, bay.x - 1 - lx0, 71 - ly0), 'room', 'storage', F5_CLEAR.library, bay, 'Tape library', 'office-server');
  const cmW = 26 + rng.int(-2, 3), cmY = 52 - rng.int(0, 2);
  // (lead, integration: the operators' commons is the crew's locker / rest room — no kitchen of its own: the level keeps the first Bunker's
  // food holders, never more — task studio-bunker-rework-20261109-205115-01)
  const commons = add('commons', R(B.x, cmY, cmW, 79 - cmY), 'room', 'crew-room', F5_CLEAR.commons, bay, 'Operators\' commons', 'locker-room');
  if (!library || !commons) return null;
  const nTop = commons.y - 1 - 13, bunksW = 15 + rng.int(-1, 2), washW = commons.w - bunksW - 1;
  const bunksWest = rng.chance(0.5);
  const bx = bunksWest ? commons.x : commons.x + washW + 1, wx = bunksWest ? commons.x + bunksW + 1 : commons.x;
  const bunks = add('bunks', R(bx, nTop, bunksW, 13), 'room', 'crew-room', F5_CLEAR.bunks, commons, 'Night-shift bunk room', BUNKER_PURPOSE.dorm);
  const wash = add('wash', R(wx, nTop, washW, 13), 'room', 'washroom', F5_CLEAR.wash, commons, 'Operators\' washroom', 'washroom');
  if (!bunks || !wash) return null;
  // --- behind the core cluster: the CABLE WAY (2 m wide, 2.8 m: the tightest space on the storey, the core's supply runs along the
  // nave's east wall) from the gallery's east end, and off it the dead-end UPS BATTERY ROOM under core B's foot
  const cwH = 22 + rng.int(0, 4);
  const cableway = add('cableway', R(V.x + V.w + 1, gallery.y, B.x - 1 - (V.x + V.w + 1), cwH), 'passage', 'utility', F5_CLEAR.cableway, gallery, 'Cable way', BUNKER_PURPOSE.lock);
  if (!cableway) return null;
  const btY = V.y + rng.int(0, 2), btW = 12 + rng.int(0, 3);
  const battery = add('battery', R(B.x, btY, btW, Math.min(12, cableway.y + cableway.h - 1 - btY)), 'room', 'utility', F5_CLEAR.battery, cableway, 'UPS battery room', 'electrical-closet');
  if (!battery) return null;

  // --- doors ----------------------------------------------------------------------------------------------------------------------
  const ax = F5_AXIS.x, aw = F5_AXIS.w;
  // the nave: the west portal (on the axis of the core cluster) and the north door on the cross axis
  const portalH = 8, py = V.y + Math.floor((V.h - portalH) / 2);
  ctx.door(R(V.x - 1, py, 1, portalH), narthex, nave, DOOR.grand);
  ctx.door(R(ax, V.y - 1, aw, 1), gallery, nave, DOOR.grand);
  // gallery -> narthex (west of the main stair's door), gallery -> control (the axis), gallery -> switch room
  // (the lobby's door sits in front of the main stair's landing door: step off the stair, the clean-room lobby is straight ahead)
  const sa = ctx.frame.anchors.find(a => a.id === 'stairA')!;
  const ndx = Math.min(sa.gate.x - 1, V.x - 2 - 4);
  ctx.door(R(ndx, V.y - 1, 4, 1), gallery, narthex, DOOR.room);
  ctx.door(R(ax, gallery.y - 1, aw, 1), gallery, control, DOOR.wide);
  ctx.door(R(58 + rng.int(0, 3), gallery.y - 1, 4, 1), gallery, sw, DOOR.room);
  // the axis north: control -> cooling -> freight lobby
  ctx.door(R(ax, control.y - 1, aw, 1), control, cooling, DOOR.wide);
  ctx.door(R(ax, bay.y + bay.h, aw, 1), bay, cooling, DOOR.wide);
  // the slot: switch room <-> control room, cooling plant -> chiller room (its only door)
  {
    const y0 = Math.max(control.y, sw.y) + 1, y1 = Math.min(control.y + control.h, sw.y + sw.h) - 1 - 4; // both rooms' rows, 1-cell margins
    ctx.door(R(cx0 - 1, y0 + rng.int(0, Math.max(0, y1 - y0)), 1, 4), control, sw, DOOR.room);
  }
  ctx.door(R(cx0 - 1, chiller.y + 2 + rng.int(0, Math.max(0, chiller.h - 8)), 1, 4), cooling, chiller, DOOR.room);
  // the freight lobby: west to the tape library, east to the commons (a wide double door)
  ctx.door(R(bay.x - 1, bay.y + 1 + rng.int(0, 3), 1, 4), bay, library, DOOR.room);
  ctx.door(R(bay.x + bay.w, bay.y + 2 + rng.int(0, 3), 1, 6), bay, commons, DOOR.wide);
  // the cable way: off the gallery's east end, a narrow door up from the core control room (a loop), the battery room off its side
  ctx.door(R(cableway.x - 1, gallery.y + 2, 1, 4), gallery, cableway, DOOR.room);
  ctx.door(R(cableway.x + 1, control.y + control.h, 2, 1), control, cableway, DOOR.room);
  ctx.door(R(battery.x - 1, battery.y + 2 + rng.int(0, Math.max(0, battery.h - 8)), 1, 4), cableway, battery, DOOR.room);
  // the commons -> bunk room / washroom
  ctx.door(R(bunks.x + 2 + rng.int(0, Math.max(0, bunks.w - 7)), commons.y - 1, 3, 1), commons, bunks, DOOR.room);
  ctx.door(R(wash.x + 2 + rng.int(0, Math.max(0, wash.w - 7)), commons.y - 1, 3, 1), commons, wash, DOOR.room);

  return {
    areas,
    core: {area: nave.id, walls: ['E']},
    gas: [{area: chiller.id, strength: 'weak'}],
    damp: [],
    aged: [library.id],
  };
}

export const FLOOR_5: BunkerFloorModule = {
  level: 5,
  title: 'Central processing core: the nave of tape cabinets round the core cluster, the cooling plant on the freight axis, the operators\' commons',
  carve: carve5,
  dress: dressFloor5,
};
