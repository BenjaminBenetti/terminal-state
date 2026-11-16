// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the OFFICE BUILDING (GEN's 'office-block': 1-3 walkable storeys)
// and the CORRIDOR FRAME the civic buildings share — a double-loaded corridor across the building at about 40 % depth, a front row of
// rooms on the street facade, a back row behind, the stair core in the back row with every storey's landing on the corridor.
//
// Office storeys: the street storey is the reception LOBBY round the main door (the desk facing the way in), a security office, the
// mail room and a meeting room in the front row, washrooms / break room / copy room / storage in the back; the upper storeys an
// OPEN-PLAN floor (the Office kit's cubicle farms: desks with drawers, filing cabinets) beside private offices and a meeting room, the
// back row offices / washrooms / kitchen / copy and records rooms, an executive office on the top storey.

import type {RoomType} from '../../stationTypes';
import {rowAlongWall} from '../../placeKit';
import type {InteriorBuilder, LRect, RoomInfo, WindowStyle} from './builder';
import {
  backOffice, breakRoom, copyRoom, janitor, lobby, meetingRoom, openPlan, privateOffice, washroom,
} from './dress';

export interface RoomDef {
  role: string; label: string; type: RoomType; w: number;
  windows?: WindowStyle; enemies?: number; front?: boolean; noLoose?: boolean;
}
export interface CorridorFrame {
  n: number;
  /** Corridor band v in [cv, cv + C). */
  cv: number; C: number;
  core: LRect | null;
  landings: RoomInfo[];
  corridors: (RoomInfo | null)[];
  /** Back-row zones beside the core (or the whole back row) and the room behind the core. */
  backZones: LRect[];
  behind: LRect | null;
}

/** Carves the corridor of every storey and the stair core in the back row (storeys without a core fit are dropped). */
export function corridorFrame(b: InteriorBuilder, maxStoreys: number, depthShare = 0.42): CorridorFrame {
  const {W, D} = b;
  let n = Math.min(b.storeys.length, maxStoreys);
  const C = 5;
  let cv = Math.max(9, Math.round(D * depthShare));
  cv = b.clearLine('v', cv - 1, cv - 4, cv + 3, [0, W - 1]) + 1; // the wall line in front of the corridor clear of side doors
  let cb = b.clearLine('v', cv + C, cv + C, cv + C + 3, [0, W - 1]); // and the one behind it
  if (cb - cv > C + 2) cb = cv + C;
  const Cc = cb - cv;
  let core: LRect | null = null;
  if (n >= 2) {
    const L = b.coreLength(n), CW = b.coreWidth(n);
    const room = D - (cb + 1);
    if (L <= W - 18 && CW <= room - 1) {
      const c0 = Math.max(8, Math.min(W - L - 8, Math.round((W - L) / 2) + b.rng.fork('core').int(-6, 6)));
      core = {u: c0, v: cb + 1, du: L, dv: CW};
    } else n = 1;
  }
  const corridors: (RoomInfo | null)[] = [];
  for (let k = 0; k < n; k++) {
    corridors.push(b.room(k, {u: 0, v: cv, du: W, dv: Cc}, {type: 'office-corridor', label: k === 0 ? 'Ground corridor' : `Corridor · floor ${k + 1}`, role: 'corridor',
      windows: 'office', noLoose: true, enemies: 0.6, publicSpace: true}));
  }
  let landings: RoomInfo[] = [];
  if (core) {
    landings = b.carveCore(core, 'u', 'lo', n);
    landings.forEach((l, k) => b.landingDoor(l, corridors[k] ?? null));
  }
  const backZones: LRect[] = core
    ? [{u: 0, v: cb + 1, du: core.u - 1, dv: D - cb - 1}, {u: core.u + core.du + 1, v: cb + 1, du: W - core.u - core.du - 1, dv: D - cb - 1}].filter(z => z.du >= 6)
    : [{u: 0, v: cb + 1, du: W, dv: D - cb - 1}];
  const bv = core ? core.v + core.dv + 1 : 0;
  const behind = core && D - bv >= 4 ? {u: core.u, v: bv, du: core.du, dv: D - bv} : null;
  return {n, cv, C: Cc, core, landings, corridors, backZones, behind};
}

/** Splits a zone along u into the listed rooms (weights; fewer when narrow: the leading ones kept, the last kept last) on storey k. */
export function rowRooms(b: InteriorBuilder, k: number, Z: LRect, defs: readonly RoomDef[], min = 8): RoomInfo[] {
  if (Z.du < 4 || Z.dv < 4 || !defs.length) return [];
  const spans = b.split('u', Z.u, Z.u + Z.du, defs.map(d => d.w), min, [Z.v, Z.v + Z.dv - 1]);
  const kept = spans.length >= defs.length ? defs : [...defs.slice(0, spans.length - 1), defs[defs.length - 1]].slice(0, spans.length);
  const out: RoomInfo[] = [];
  spans.forEach(([s, e], j) => {
    const q = kept[j];
    const r = b.room(k, {u: s, v: Z.v, du: e - s, dv: Z.dv}, {type: q.type, label: q.label, role: q.role, front: q.front, windows: q.windows ?? 'office',
      enemies: q.enemies ?? 1, noLoose: q.noLoose});
    if (r) out.push(r);
  });
  return out;
}

/** The front row split round a centre room (the lobby / the apparatus bay) that holds the main entrance. */
export function frontAround(b: InteriorBuilder, k: number, f: CorridorFrame, centre: RoomDef, minW: number, left: readonly RoomDef[], right: readonly RoomDef[]): {centre: RoomInfo | null; rooms: RoomInfo[]} {
  const {W} = b;
  const main = k === 0 ? b.ents.find(e => e.e.main && e.local === 'F') ?? b.ents.find(e => e.local === 'F') : undefined;
  const mid = main ? Math.round((main.s0 + main.s1 + 1) / 2) : Math.round(W / 2);
  const half = Math.max(Math.ceil(minW / 2), main ? Math.ceil((main.s1 - main.s0 + 1) / 2) + 4 : 0);
  let l0 = Math.max(0, mid - half), l1 = Math.min(W, mid + half);
  if (l0 < 7) l0 = 0;
  if (W - l1 < 7) l1 = W;
  if (l0 > 0) l0 = b.clearLine('u', l0 - 1, Math.max(6, l0 - 6), l0 + 2, [0, f.cv - 2]) + 1;
  if (l1 < W) l1 = b.clearLine('u', l1, l1 - 2, Math.min(W - 7, l1 + 6), [0, f.cv - 2]);
  const dv = f.cv - 1;
  const c = b.room(k, {u: l0, v: 0, du: l1 - l0, dv}, {type: centre.type, label: centre.label, role: centre.role, front: centre.front ?? true, windows: centre.windows ?? 'office',
    enemies: centre.enemies ?? 1.2, noLoose: centre.noLoose});
  const rooms = [
    ...(l0 > 0 ? rowRooms(b, k, {u: 0, v: 0, du: l0 - 1, dv}, left) : []),
    ...(l1 < W ? rowRooms(b, k, {u: l1 + 1, v: 0, du: W - l1 - 1, dv}, right) : []),
  ];
  return {centre: c, rooms};
}

/** Every room of the storey opens onto its corridor (or, failing a shared wall, onto a neighbour: connectAll). */
export function openOnto(b: InteriorBuilder, k: number, corridor: RoomInfo | null, rooms: readonly (RoomInfo | null)[], width = 2): void {
  for (const r of rooms) if (r) b.door(r, corridor, r.role === 'lobby' || r.role === 'bay' ? 6 : width, {at: 'mid'});
  b.connectAll(k, corridor);
}

const D_ = (role: string, label: string, type: RoomType, w: number, o: Partial<RoomDef> = {}): RoomDef => ({role, label, type, w, ...o});

export function planOffice(b: InteriorBuilder): void {
  const rng = b.rng.fork('office');
  const f = corridorFrame(b, 3);
  const all: RoomInfo[] = [];
  for (let k = 0; k < f.n; k++) {
    const corridor = f.corridors[k];
    const top = k === f.n - 1 && k > 0;
    const rooms: RoomInfo[] = [];
    if (k === 0) {
      const fr = frontAround(b, 0, f, D_('lobby', 'Lobby', 'office-lobby', 1, {front: true, enemies: 1, noLoose: false}), 22,
        rng.shuffle([D_('security', 'Security office', 'office-room', 0.8), D_('mail', 'Mail room', 'office-room', 0.7)]),
        rng.shuffle([D_('meeting', 'Meeting room', 'office-room', 1.0), D_('private', 'Office', 'office-room', 0.8)]));
      if (fr.centre) rooms.push(fr.centre);
      rooms.push(...fr.rooms);
      const back = [D_('washroom', 'Washrooms', 'washroom', 0.6, {windows: 'small', enemies: 0.3}), D_('break', 'Break room', 'office-room', 1.0),
        D_('storage', 'Storage', 'office-room', 0.7, {windows: 'none'}), D_('copy', 'Copy room', 'office-room', 0.7)];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, 0, Z, j === 0 ? back.slice(0, 2) : back.slice(2)));
    } else {
      const openW = rng.range(1.8, 2.6);
      const frontDefs = rng.shuffle([D_('open', 'Open-plan office', 'office-open', openW, {front: true, enemies: 2}), D_('meeting', 'Meeting room', 'office-room', 1.0),
        D_(top ? 'exec' : 'private', top ? 'Executive office' : 'Office', 'office-room', 0.9)]);
      rooms.push(...rowRooms(b, k, {u: 0, v: 0, du: b.W, dv: f.cv - 1}, frontDefs, 12));
      const back = [D_('private', 'Office', 'office-room', 0.8), D_('washroom', 'Washrooms', 'washroom', 0.6, {windows: 'small', enemies: 0.3}),
        D_('break', 'Kitchen', 'office-room', 0.8), D_('copy', 'Copy room', 'office-room', 0.6), D_('records', 'Records', 'office-room', 0.7, {windows: 'none'}),
        D_('private', 'Office', 'office-room', 0.8)];
      for (const [j, Z] of f.backZones.entries()) rooms.push(...rowRooms(b, k, Z, j === 0 ? back.slice(0, 3) : back.slice(3)));
    }
    if (f.behind) {
      const r = b.room(k, f.behind, k === 0 ? {type: 'office-room', label: 'Plant room', role: 'plant', windows: 'none', enemies: 0.3}
        : {type: 'office-room', label: 'Server room', role: 'server', windows: 'none', enemies: 0.3});
      if (r) rooms.push(r);
    }
    openOnto(b, k, corridor, rooms);
    all.push(...rooms);
  }
  // --- dressing ---------------------------------------------------------------------------------------------------------------
  for (const r of all) dressOfficeRoom(b, r);
}

export function dressOfficeRoom(b: InteriorBuilder, r: RoomInfo): void {
  switch (r.role) {
    case 'lobby': lobby(b, r); break;
    case 'security': backOffice(b, r, 'office-security', false); break;
    case 'mail': copyRoom(b, r); break;
    case 'meeting': meetingRoom(b, r); break;
    case 'private': privateOffice(b, r); break;
    case 'exec': privateOffice(b, r, true); break;
    case 'open': openPlan(b, r, 'office-open', b.rng.fork(`pods:${r.area.id}`).chance(0.35)); break;
    case 'washroom': washroom(b, r); break;
    case 'break': breakRoom(b, r); break;
    case 'copy': copyRoom(b, r); break;
    case 'storage': case 'records': copyRoom(b, r, true); break;
    case 'server': serverRoom(b, r); break;
    case 'plant': janitor(b, r); break;
    default: break;
  }
}

/** Server room: rows of the Office kit's server racks along two walls (their fronts 1.2 m clear). */
function serverRoom(b: InteriorBuilder, r: RoomInfo): void {
  r.area.purpose = 'office-server';
  const rng = b.rng.fork(`server:${r.area.id}`);
  for (const s of rng.shuffle(['N', 'S', 'E', 'W'] as const).slice(0, 2)) rowAlongWall(b.ctx(r.storey), r.area, s, 'serverRack', {max: 4, front: 1.2});
}
