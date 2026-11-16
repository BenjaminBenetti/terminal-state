// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the optional CIVIC buildings on the office corridor frame
// (rooms/office.ts corridorFrame: front row on the street, corridor, back row, the stair core in the back row):
//  - 'police': the public lobby with the front desk, interview rooms and the duty office in front; the squad room (desks), holding cells,
//    the evidence room, the ARMOURY (gun lockers: the Mall security office's existing gun-locker rule, purpose 'mall-security') and the
//    locker room behind; detectives' offices, the chief's office, records and a break room upstairs;
//  - 'fire-station': the APPARATUS BAY round the main door (hose / gear racks along its walls), the watch office, the turnout-gear room
//    and the day room; the kitchen, workshop and washrooms behind; the BUNK ROOM, offices and a gym upstairs;
//  - 'clinic': the waiting room with the reception desk, EXAM ROOMS along the corridor (exam table, vitals monitor, med cabinets), the
//    treatment room, the supply room (dispensary cabinets) and the staff room; offices, records and more exam rooms upstairs.

import type {Rng} from '../../../core/rng';
import type {Side} from '../../stationTypes';
import {rowAlongWall} from '../../placeKit';
import {stockVariant} from '../../purposeShapes';
import type {InteriorBuilder, RoomInfo} from './builder';
import {
  againstWall, backOffice, backRoom, centre, crewRoom, kitchen, lobby, lockerRoom, openPlan, privateOffice, stockRoom, wallRow,
} from './dress';
import {corridorFrame, dressOfficeRoom, frontAround, openOnto, rowRooms, type RoomDef} from './office';

const SIDES: Side[] = ['N', 'S', 'E', 'W'];
const D_ = (role: string, label: string, type: RoomDef['type'], w: number, o: Partial<RoomDef> = {}): RoomDef => ({role, label, type, w, ...o});

/** An exam room (or, 'reception', a small waiting area with a desk): the Mall clinic recipe's pieces in their own room. */
export function examRoom(b: InteriorBuilder, r: RoomInfo | null, as: 'exam' | 'reception' = 'exam'): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`exam:${a.id}`);
  if (as === 'reception') {
    a.purpose = 'mall-clinic';
    wallRow(ctx, a, 'desk', 1, rng);
    wallRow(ctx, a, 'plasticStackChair', rng.int(2, 4), rng, {front: 0.4});
    if (rng.chance(0.6)) againstWall(b, ctx, a, 'pottedPlantSmall');
    return;
  }
  a.purpose = 'mall-clinic-back';
  wallRow(ctx, a, 'examTable', 1, rng, {front: 0.9});
  wallRow(ctx, a, 'vitalsMonitor', 1, rng);
  wallRow(ctx, a, 'medCabinet', 1, rng);
  if (rng.chance(0.6)) wallRow(ctx, a, 'desk', 1, rng);
  if (rng.chance(0.5)) againstWall(b, ctx, a, 'ivPole');
  if (rng.chance(0.3)) againstWall(b, ctx, a, 'physicianScale');
}

export function planCivic(b: InteriorBuilder): void {
  if (b.pid === 'police') planPolice(b);
  else if (b.pid === 'fire-station') planFire(b);
  else planClinic(b);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Police station

function planPolice(b: InteriorBuilder): void {
  const rng = b.rng.fork('police');
  const f = corridorFrame(b, 2);
  const all: RoomInfo[] = [];
  for (let k = 0; k < f.n; k++) {
    const rooms: RoomInfo[] = [];
    if (k === 0) {
      const fr = frontAround(b, 0, f, D_('lobby', 'Public lobby', 'office-lobby', 1, {front: true}), 18,
        [D_('interview', 'Interview room', 'office-room', 0.6, {windows: 'none'}), D_('interview', 'Interview room', 'office-room', 0.6, {windows: 'none'})],
        rng.shuffle([D_('duty', 'Duty office', 'office-room', 0.9), D_('meeting', 'Briefing room', 'office-room', 1.1)]));
      if (fr.centre) rooms.push(fr.centre);
      rooms.push(...fr.rooms);
      const back = [D_('squad', 'Squad room', 'office-open', 2.0, {enemies: 2}), D_('cells', 'Holding cells', 'office-room', 1.2, {windows: 'small'}),
        D_('evidence', 'Evidence room', 'office-room', 0.8, {windows: 'none'}), D_('armoury', 'Armoury', 'office-room', 0.6, {windows: 'none'}),
        D_('lockers', 'Locker room', 'crew-room', 0.8, {windows: 'none'}), D_('washroom', 'Washrooms', 'washroom', 0.6, {windows: 'small', enemies: 0.3})];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, 0, Z, j === 0 ? back.slice(0, 3) : back.slice(3)));
    } else {
      rooms.push(...rowRooms(b, k, {u: 0, v: 0, du: b.W, dv: f.cv - 1}, rng.shuffle([D_('open', 'Detectives\' office', 'office-open', 2.0, {front: true, enemies: 1.6}),
        D_('exec', 'Chief\'s office', 'office-room', 0.9), D_('meeting', 'Incident room', 'office-room', 1.0)]), 12));
      const back = [D_('records', 'Records', 'office-room', 1.0, {windows: 'none'}), D_('break', 'Break room', 'office-room', 0.9),
        D_('washroom', 'Washrooms', 'washroom', 0.6, {windows: 'small', enemies: 0.3}), D_('private', 'Office', 'office-room', 0.8)];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, k, Z, j === 0 ? back.slice(0, 2) : back.slice(2)));
    }
    if (f.behind) { const r = b.room(k, f.behind, {type: 'office-room', label: k === 0 ? 'Property store' : 'Archive', role: 'storage', windows: 'none', enemies: 0.3}); if (r) rooms.push(r); }
    openOnto(b, k, f.corridors[k], rooms);
    all.push(...rooms);
  }
  for (const r of all) {
    if (r.role === 'lobby') { lobby(b, r, 'office-reception'); continue; }
    if (r.role === 'interview') { interview(b, r); continue; }
    if (r.role === 'duty') { backOffice(b, r, 'security-office', false); continue; }
    if (r.role === 'squad') { openPlan(b, r, 'office-open'); continue; }
    if (r.role === 'cells') { cells(b, r); continue; }
    if (r.role === 'evidence') { stockRoom(b, r, 'security-office', 'cartons'); continue; }
    if (r.role === 'armoury') { armoury(b, r); continue; }
    if (r.role === 'lockers') { lockerRoom(b, r); continue; }
    dressOfficeRoom(b, r);
  }
}

/** Interview room: a table with chairs either side. */
function interview(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'office-meeting';
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`interview:${r.area.id}`);
  centre(ctx, r.area, 'table', r.area.w >= r.area.h ? 0 : Math.PI / 2, 0.8);
  wallRow(ctx, r.area, 'foldingChair', 2, rng, {front: 0.4});
}
/** Holding cells: benches along the walls and the cells' toilets (one room: the cell fronts are the room's partitions). */
function cells(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'security-office';
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`cells:${r.area.id}`);
  const sides = rng.shuffle(SIDES.slice());
  rowAlongWall(ctx, r.area, sides[0], 'bench', {max: 3, front: 0.6});
  rowAlongWall(ctx, r.area, sides[1], 'toiletStall', {max: 2, front: 0.9});
}
/** The armoury: gun lockers and racks (the Mall security office's gun-locker rule decides any ammo), a tall cabinet. */
function armoury(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'mall-security';
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`armoury:${r.area.id}`);
  wallRow(ctx, r.area, 'gunLocker', 2, rng);
  wallRow(ctx, r.area, 'gunRack', 1, rng);
  wallRow(ctx, r.area, 'cabinetTall', 1, rng);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Fire station

function planFire(b: InteriorBuilder): void {
  const rng = b.rng.fork('fire');
  const f = corridorFrame(b, 2, 0.55);
  const all: RoomInfo[] = [];
  for (let k = 0; k < f.n; k++) {
    const rooms: RoomInfo[] = [];
    if (k === 0) {
      const fr = frontAround(b, 0, f, D_('bay', 'Apparatus bay', 'utility', 1, {front: true, windows: 'high', enemies: 2}), Math.round(b.W * 0.5),
        ...(rng.chance(0.5) ? [[D_('watch', 'Watch office', 'office-room', 0.8)], [D_('gear', 'Turnout gear room', 'crew-room', 1.0, {windows: 'none'})]] as const
          : [[D_('gear', 'Turnout gear room', 'crew-room', 1.0, {windows: 'none'})], [D_('watch', 'Watch office', 'office-room', 0.8)]] as const));
      if (fr.centre) rooms.push(fr.centre);
      rooms.push(...fr.rooms);
      const back = [D_('kitchen', 'Kitchen', 'crew-room', 1.0), D_('day', 'Day room', 'crew-room', 1.2), D_('workshop', 'Workshop', 'utility', 1.0, {windows: 'high'}),
        D_('washroom', 'Washrooms', 'washroom', 0.7, {windows: 'small', enemies: 0.3})];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, 0, Z, j === 0 ? back.slice(0, 2) : back.slice(2)));
    } else {
      rooms.push(...rowRooms(b, k, {u: 0, v: 0, du: b.W, dv: f.cv - 1}, [D_('bunks', 'Bunk room', 'crew-room', 2.0, {front: true, enemies: 1.4}),
        D_('exec', 'Captain\'s office', 'office-room', 0.8), D_('gym', 'Gym', 'crew-room', 1.0)], 12));
      const back = [D_('washroom', 'Showers', 'washroom', 0.9, {windows: 'small', enemies: 0.3}), D_('storage', 'Linen store', 'office-room', 0.6, {windows: 'none'}),
        D_('meeting', 'Training room', 'office-room', 1.0), D_('private', 'Office', 'office-room', 0.8)];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, k, Z, j === 0 ? back.slice(0, 2) : back.slice(2)));
    }
    if (f.behind) { const r = b.room(k, f.behind, {type: 'storage', label: k === 0 ? 'Hose store' : 'Store', role: 'hose', windows: 'none', enemies: 0.3}); if (r) rooms.push(r); }
    openOnto(b, k, f.corridors[k], rooms);
    all.push(...rooms);
  }
  for (const r of all) {
    switch (r.role) {
      case 'bay': bay(b, r); break;
      case 'watch': backOffice(b, r, 'agent-office', false); break;
      case 'gear': lockerRoom(b, r); break;
      case 'kitchen': kitchen(b, r, 'staff-room'); break;
      case 'day': crewRoom(b, r); break;
      case 'workshop': stockRoom(b, r, 'workshop', 'parts'); break;
      case 'bunks': bunks(b, r); break;
      case 'gym': gym(b, r); break;
      case 'hose': stockRoom(b, r, 'storage', 'cartons'); break;
      default: dressOfficeRoom(b, r);
    }
  }
}
/** The apparatus bay: gear lockers and tool chests along its walls, cylinders, cones, a work light (the floor stays open for the engine). */
function bay(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'workshop';
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`bay:${r.area.id}`);
  const back = b.side('B');
  rowAlongWall(ctx, r.area, back, 'staffLockers', {max: 6, front: 0.9});
  wallRow(ctx, r.area, 'rollingToolChest', 2, rng);
  wallRow(ctx, r.area, 'shelf', 2, rng);
  for (const k of ['gasCylinderCart', 'tripodWorkLight', 'stepLadder', 'foldingBarricade', 'wheelieBin', 'drumFan'] as const) if (rng.chance(0.7)) againstWall(b, ctx, r.area, k);
}
/** Bunk room: bunk beds along the walls with a footlocker each (its contents personal). */
function bunks(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'locker-room';
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`bunks:${r.area.id}`);
  const sides = rng.shuffle(SIDES.slice());
  rowAlongWall(ctx, r.area, sides[0], 'bunkBed', {max: 5, front: 1.0});
  rowAlongWall(ctx, r.area, sides[1], 'bunkBed', {max: 4, front: 1.0});
  wallRow(ctx, r.area, 'footlocker', rng.int(2, 4), rng, {front: 0.6});
  wallRow(ctx, r.area, 'staffLockers', 2, rng);
}
/** Gym: a bench, lockers, a fan (no new equipment kinds). */
function gym(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'locker-room';
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`gym:${r.area.id}`);
  centre(ctx, r.area, 'bench', r.area.w >= r.area.h ? 0 : Math.PI / 2, 0.8);
  wallRow(ctx, r.area, 'staffLockers', 2, rng);
  if (rng.chance(0.6)) againstWall(b, ctx, r.area, 'drumFan');
}

// ---------------------------------------------------------------------------------------------------------------------------
// Walk-in clinic

function planClinic(b: InteriorBuilder): void {
  const rng = b.rng.fork('clinic');
  const f = corridorFrame(b, 2);
  const all: RoomInfo[] = [];
  for (let k = 0; k < f.n; k++) {
    const rooms: RoomInfo[] = [];
    if (k === 0) {
      const fr = frontAround(b, 0, f, D_('waiting', 'Waiting room', 'office-lobby', 1, {front: true, enemies: 1.4}), 22,
        [D_('exam', 'Exam room 1', 'office-room', 0.7), D_('exam', 'Exam room 2', 'office-room', 0.7)],
        [D_('exam', 'Exam room 3', 'office-room', 0.7), D_('office', 'Doctor\'s office', 'office-room', 0.8)]);
      if (fr.centre) rooms.push(fr.centre);
      rooms.push(...fr.rooms);
      const back = [D_('treatment', 'Treatment room', 'office-room', 1.2), D_('supply', 'Supply room', 'stock-room', 0.8, {windows: 'none'}),
        D_('staff', 'Staff room', 'crew-room', 0.9), D_('washroom', 'Washrooms', 'washroom', 0.6, {windows: 'small', enemies: 0.3})];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, 0, Z, j === 0 ? back.slice(0, 2) : back.slice(2)));
    } else {
      rooms.push(...rowRooms(b, k, {u: 0, v: 0, du: b.W, dv: f.cv - 1}, [D_('exam', 'Exam room', 'office-room', 0.8), D_('exam', 'Exam room', 'office-room', 0.8),
        D_('private', 'Office', 'office-room', 0.9), D_('meeting', 'Meeting room', 'office-room', 1.0)], 10));
      const back = [D_('records', 'Records', 'office-room', 1.0, {windows: 'none'}), D_('washroom', 'Washrooms', 'washroom', 0.6, {windows: 'small', enemies: 0.3}),
        D_('break', 'Break room', 'office-room', 0.9)];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, k, Z, j === 0 ? back.slice(0, 2) : back.slice(2)));
    }
    if (f.behind) { const r = b.room(k, f.behind, {type: 'stock-room', label: 'Medical store', role: 'supply', windows: 'none', enemies: 0.3}); if (r) rooms.push(r); }
    openOnto(b, k, f.corridors[k], rooms);
    all.push(...rooms);
  }
  for (const r of all) {
    switch (r.role) {
      case 'waiting': waiting(b, r, rng); break;
      case 'exam': examRoom(b, r); break;
      case 'office': privateOffice(b, r); break;
      case 'treatment': treatment(b, r); break;
      case 'supply': backRoom(b, r, null, 'clinic', 'mall-clinic-back'); break;
      case 'staff': crewRoom(b, r, 'staff-room'); break;
      default: dressOfficeRoom(b, r);
    }
  }
}
function waiting(b: InteriorBuilder, r: RoomInfo, rng: Rng): void {
  lobby(b, r, 'office-reception');
  const ctx = b.ctx(r.storey);
  wallRow(ctx, r.area, 'plasticStackChair', rng.int(3, 6), rng, {front: 0.4});
  if (rng.chance(0.5)) againstWall(b, ctx, r.area, 'vending');
}
function treatment(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'mall-clinic-back';
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`treat:${r.area.id}`);
  wallRow(ctx, r.area, 'wheeledStretcher', 2, rng, {front: 0.9});
  wallRow(ctx, r.area, 'crashCart', 1, rng);
  wallRow(ctx, r.area, 'medCabinet', 2, rng);
  wallRow(ctx, r.area, 'stockShelf', 1, rng, {variant: stockVariant('pharmacy')});
  if (rng.chance(0.6)) againstWall(b, ctx, r.area, 'ivPole');
}
