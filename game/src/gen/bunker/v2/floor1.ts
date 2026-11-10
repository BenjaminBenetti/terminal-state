// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 1, ENTRY & SECURITY (floor y -7, level role 'ring'; contract:
// gen/bunker/v2/floorApi.ts; frame: gen/bunker/v2/spine.ts). Everyone who comes through the vault walks down the main stair to here
// first, and the storey is built as the shelter's ADMISSION LINE round its first big reveal, the V12 well over the habitation commons.
//
// The processing route (south-west), a deliberate squeeze-and-release:
//   the main stair's south landing → the ARRIVAL LOBBY (low, long: 3.4 m) → DECONTAMINATION (showers, wash troughs: 3.2 m; the weak
//   residue leak) → the INTAKE HALL (the storey's generous open space: 20 x 8.5 m, 6 m tall; registration counter, queue barriers,
//   waiting benches) → the CHECKPOINT (three 3.5 m lanes through the screening wall, a walk-through detector filling half of each,
//   two 2 m guard booths between them: 3.0 m) → the OVERLOOK: the south side of a GALLERY RING round the well (4.6 m, the void's own
//   ceiling), the commons 7 m below and 11.6 m of air over it — the shelter's first big view, straight ahead as you leave a lane.
// The gallery ring: the south overlook, the narrow east walk between the well and the main stair's shaft, the west walk on the
// envelope's edge and the deep north MUSTER GALLERY (roll-call boards, benches facing the rail, planters) that opens onto the freight
// lobby round the cargo lift's landing.
// The security wing (east, behind the cores): the duty hall at the service stair's landing (the duty desk, the staff lockers), a long
// 2 m guard corridor from the freight lobby down to the arrival lobby (the staff route that skips decontamination), four holding cells
// off its west side, operations, the warden's office (with the shelter's records), the guard room and its dead-end armoury off the
// east side. Below the intake hall: the latrines, the confiscated-property store and the registry; the search room off the hall's
// west end.
// Loot reads as the storey's programme: the rooms carry security-office / armoury / locker-room / lost-property / agent-office /
// decontamination purposes; the halls and passages dressed here keep the generic shelter purpose, and the holders standing in them
// carry their own purpose (the registration desks: agent-office; the booths' monitor desks: security-office).

import type {Area, AreaKind, Rect, RoomType} from '../../stationTypes';
import {BUNKER_PURPOSE} from '../../reactor/complex/bunkerPurposes';
import type {BunkerFloorModule, FloorCarveCtx, FloorCarveResult, FloorAreaOpts} from './floorApi';
import {V2} from './spine';
import {dressFloor1} from './floor1Dress';
import {F1_LANES} from './floor1Plan';

const R = (x: number, y: number, w: number, h: number): Rect => ({x, y, w, h});

/** Clear heights (m above the storey floor). */
export const F1_CLEAR = {gallery: V2.clear.gallery, intake: 6.0, freight: 4.2, duty: 4.2, ops: 3.6, room: 3.2, lobby: 3.4, corridor: 3.2, lane: 3.0, cell: 3.0, store: 3.0} as const;
/** Door heights (m). */
const DOOR = {main: 3.0, room: 2.6, lane: 2.6, cell: 2.4} as const;

/** The storey's area keys (FloorCarveResult.areas; floor1Dress.ts reads them). */
export type F1Key =
  | 'galN' | 'galE' | 'galS' | 'galW' | 'freight' | 'duty' | 'guardCorr' | 'ops' | 'warden' | 'guard' | 'armoury'
  | 'arrival' | 'decon' | 'intake' | 'search' | 'lane1' | 'lane2' | 'lane3' | 'booth1' | 'booth2' | 'latrines' | 'store' | 'registry'
  | 'cell1' | 'cell2' | 'cell3' | 'cell4';


function carve(ctx: FloorCarveCtx): FloorCarveResult | null {
  const a: Record<string, number> = {};
  const rng = ctx.rng;
  const add = (key: F1Key, r: Rect, kind: AreaKind, type: RoomType, clear: number, label: string, opts: FloorAreaOpts = {}): Area | null => {
    const ar = ctx.room(r, kind, type, clear, -1, {label, ...opts});
    if (ar) a[key] = ar.id;
    return ar;
  };
  const well = ctx.frame.well!.rect; // x 10..37, rows 78..101
  const A = ctx.spine.cores[0].rect; // x 44..54, rows 72..112
  const shaft = ctx.spine.shaft; // x 57..66, rows 71..82
  const wx0 = well.x, wx1 = well.x + well.w, wy0 = well.y, wy1 = well.y + well.h; // (exclusive ends)
  const aW = A.x - 1; // core A's west wall column (43)

  // --- the gallery ring round the well (the void's own ceiling: 4.6 m) -----------------------------------------------------------
  const pub = {publicSpace: true, purpose: BUNKER_PURPOSE.lock, noFloorLoot: false};
  const nTop = 62 - rng.int(0, 1) * 2; // the muster gallery's depth varies (8 / 9 m)
  const galN = add('galN', R(3, nTop, aW - 3, wy0 - nTop), 'room', 'crew-room', F1_CLEAR.gallery, 'Muster gallery', pub);
  const galW = add('galW', R(3, wy0 + 1, wx0 - 3, well.h - 2), 'room', 'crew-room', F1_CLEAR.gallery, 'West gallery walk', pub);
  const galE = add('galE', R(wx1, wy0 + 1, aW - wx1, well.h - 2), 'room', 'crew-room', F1_CLEAR.gallery, 'East gallery walk', pub);
  const galS = add('galS', R(3, wy1, aW - 3, 8), 'room', 'crew-room', F1_CLEAR.gallery, 'Overlook gallery', pub);
  if (!galN || !galW || !galE || !galS) return null;
  // the ring's corners: the walks open full width (no wall stub, no door frame: one continuous gallery) into the north / south
  // galleries, the void's full height
  for (const g of [galW, galE]) {
    ctx.door(R(g.x, wy0, g.w, 1), galN, g, F1_CLEAR.gallery).noFrame = true;
    ctx.door(R(g.x, wy1 - 1, g.w, 1), galS, g, F1_CLEAR.gallery).noFrame = true;
  }

  // --- the checkpoint: three screening lanes through the wall south of the overlook, two guard booths between them -----------------
  // (x: search 3..8 | lane 10..16 | booth 18..21 | lane 23..29 | booth 31..34 | lane 36..42, core A's wall behind it; rows 111..120).
  // Every lane: the walk-through detector against one side wall, a 1.5 m walkway beside it between the two doorways (F1_LANES).
  const cy0 = galS.y + galS.h + 1, ch = 10;
  const lanes: Area[] = [];
  const booths: Area[] = [];
  for (let i = 0; i < 3; i++) {
    const lx = 10 + i * 13;
    const ln = add(`lane${i + 1}` as F1Key, R(lx, cy0, 7, ch), 'room', 'crew-room', F1_CLEAR.lane, `Screening lane ${i + 1}`, {publicSpace: true, purpose: BUNKER_PURPOSE.lock, noFloorLoot: true});
    if (!ln) return null;
    lanes.push(ln);
    if (i < 2) {
      const b = add(`booth${i + 1}` as F1Key, R(lx + 8, cy0, 4, ch), 'room', 'utility', F1_CLEAR.lane, `Guard booth ${i + 1}`, {purpose: BUNKER_PURPOSE.lock});
      if (!b) return null;
      booths.push(b);
    }
  }
  const search = add('search', R(3, cy0, 6, ch), 'room', 'utility', F1_CLEAR.room, 'Search room', {purpose: 'security-office'});
  // the intake hall: the storey's big open room under the lanes
  const intake = add('intake', R(3, cy0 + ch + 1, aW - 3, 17), 'room', 'crew-room', F1_CLEAR.intake, 'Intake hall', pub);
  if (!intake || !search) return null;
  lanes.forEach((ln, i) => {
    const wx = F1_LANES[i] === 'W' ? ln.x + 4 : ln.x; // the walkway's three cells
    ctx.door(R(wx, galS.y + galS.h, 3, 1), galS, ln, DOOR.lane);
    ctx.door(R(wx, intake.y - 1, 3, 1), intake, ln, DOOR.lane);
  });
  // each booth opens onto the walkway of the lane west of it (the guard faces the people he screens); the search room off the hall
  if (!ctx.connect(lanes[0], booths[0], 2, DOOR.cell, 'mid')) return null;
  if (!ctx.connect(lanes[1], booths[1], 2, DOOR.cell, 'mid')) return null;
  if (!ctx.connect(intake, search, 2, DOOR.cell, 'mid')) return null;

  // --- below the intake hall: the latrines, the confiscated-property store, the registry (the admission cards on file) --------------
  const by = intake.y + intake.h + 1, bh = 147 - by; // rows 140..146
  const latr = add('latrines', R(3, by, 12, bh), 'room', 'washroom', F1_CLEAR.room, 'Latrines', {purpose: 'washroom'});
  const store = add('store', R(16, by, 12, bh), 'room', 'storage', F1_CLEAR.store, 'Confiscated property', {purpose: 'lost-property'});
  const reg = add('registry', R(29, by, aW - 29, bh), 'room', 'agent-office', F1_CLEAR.room, 'Registry', {purpose: 'agent-office'});
  if (!latr || !store || !reg) return null;
  for (const r of [latr, store, reg]) if (!ctx.connect(intake, r, 3, DOOR.room, rng.range(0.25, 0.75))) return null;

  // --- the main stair's arrival lobby (south of core A) and decontamination -------------------------------------------------------
  const arrival = add('arrival', R(A.x, A.y + A.h + 1, 30, 8), 'room', 'crew-room', F1_CLEAR.lobby, 'Arrival lobby', pub);
  if (!arrival) return null;
  const decon = add('decon', R(A.x, arrival.y + arrival.h + 1, 22, 12), 'room', 'utility', F1_CLEAR.room, 'Decontamination', {purpose: BUNKER_PURPOSE.decon});
  if (!decon) return null;
  if (!ctx.connect(arrival, decon, 4, DOOR.main, 0.3)) return null;
  if (!ctx.connect(decon, intake, 4, DOOR.main, 'mid')) return null;

  // --- the freight lobby round the cargo lift's landing (the apron runs up to the shaft's north wall) ---------------------------------
  const fy0 = 54;
  const freight = add('freight', R(A.x, fy0, shaft.x + shaft.w + 5 - A.x, shaft.y - fy0), 'room', 'storage', F1_CLEAR.freight, 'Freight lobby', {purpose: BUNKER_PURPOSE.lock});
  if (!freight) return null;
  if (!ctx.connect(galN, freight, 7, DOOR.main + 0.4, 'mid')) return null;

  // --- the security wing ----------------------------------------------------------------------------------------------------------
  const B = ctx.spine.cores[1].rect; // x 98..106, rows 80..120
  const gx = freight.x + freight.w - 4; // the guard corridor (4 cells) under the freight lobby's east end
  const guardCorr = add('guardCorr', R(gx, shaft.y + 1, 4, arrival.y - 2 - shaft.y), 'service', 'service-corridor', F1_CLEAR.corridor, 'Guard corridor', {purpose: 'service-corridor'});
  if (!guardCorr) return null;
  ctx.door(R(gx, shaft.y, 4, 1), freight, guardCorr, DOOR.main);
  ctx.door(R(gx, arrival.y - 1, 4, 1), arrival, guardCorr, DOOR.main);
  const ex = gx + 5; // the east rooms' west column (73)
  const duty = add('duty', R(ex, 64, B.x + B.w + 3 - ex, B.y - 1 - 64), 'room', 'crew-room', F1_CLEAR.duty, 'Duty hall', {purpose: 'locker-room'});
  if (!duty) return null;
  if (!ctx.connect(freight, duty, 4, DOOR.main, 'mid')) return null;
  if (!ctx.connect(guardCorr, duty, 3, DOOR.main, 'mid')) return null;
  const eW = B.x - 2 - ex; // the east rooms' width up to core B's wall (x 73..95)
  const ops = add('ops', R(ex, B.y, eW, 13), 'room', 'utility', F1_CLEAR.ops, 'Operations room', {purpose: BUNKER_PURPOSE.radio});
  if (!ops) return null;
  if (!ctx.connect(guardCorr, ops, 3, DOOR.room, 'mid')) return null;
  if (!ctx.connect(duty, ops, 4, DOOR.room, 0.3)) return null;
  // below operations: the warden's office (his desk, the shelter's records) and the guard room + its dead-end armoury (seeded order)
  const rowA = ops.y + ops.h + 1, rowB = rowA + 10;
  const wardenFirst = rng.chance(0.5);
  const wy = wardenFirst ? rowA : rowB, gy = wardenFirst ? rowB : rowA;
  const warden = add('warden', R(ex, wy, eW, 9), 'room', 'agent-office', F1_CLEAR.room, "Warden's office", {purpose: 'agent-office'});
  const guard = add('guard', R(ex, gy, 12, 9), 'room', 'utility', F1_CLEAR.room, 'Guard room', {purpose: 'security-office'});
  const armoury = add('armoury', R(ex + 13, gy, eW - 13, 9), 'room', 'storage', F1_CLEAR.store, 'Armoury', {purpose: BUNKER_PURPOSE.armoury});
  if (!warden || !guard || !armoury) return null;
  if (!ctx.connect(guardCorr, warden, 3, DOOR.room, 'mid')) return null;
  if (!ctx.connect(guardCorr, guard, 3, DOOR.room, 'mid')) return null;
  if (!ctx.connect(guard, armoury, 2, DOOR.room, 'mid')) return null;
  // the holding cells off the guard corridor's west side (3 m x 3 m), under the lift shaft
  const nCells = 4;
  const cells: Area[] = [];
  const cTop = shaft.y + shaft.h + 1;
  for (let i = 0; i < nCells; i++) {
    const c = add(`cell${i + 1}` as F1Key, R(gx - 7, cTop + i * 7, 6, 6), 'room', 'crew-room', F1_CLEAR.cell, `Holding cell ${i + 1}`, {purpose: BUNKER_PURPOSE.lock});
    if (!c) return null;
    if (!ctx.connect(guardCorr, c, 2, DOOR.cell, 'mid')) return null;
    cells.push(c);
  }

  return {
    areas: a,
    gas: [{area: decon.id, strength: 'weak'}],
    damp: [],
    aged: cells.map(c => c.id),
  };
}

export const FLOOR_1: BunkerFloorModule = {
  level: 1,
  title: 'Entry & security: the admission line (arrival, decontamination, intake hall, screening lanes) onto the gallery ring round the commons well; the security wing',
  carve,
  dress: dressFloor1,
};
