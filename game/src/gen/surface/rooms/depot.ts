// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the TRAIN-REPAIR DEPOT — a big double-height maintenance shed
// behind the roller door (GEN's main entrance on the rail-spur side, 6 m, 4.2 m clear: the track runs in through it), a loading-bay door
// on a long side (GEN's second wide door: the loading yard, where the truck backs up), a support wing along the other long side (foreman's
// office, parts store, crew room, washroom, locker room) and a mezzanine office floor over the wing, reached by its stair core
// (GEN always gives the depot two walkable storeys; one storey still plans: no mezzanine).
//
// The shed: the first rail track runs on the roller door's centre line the full depth of the shed (a second one when the shed is wide),
// an inspection pit between the rails of the first (a grated pit: walkable floor, drawn by LOOK from `features.depot.pits`), an overhead
// travelling crane over the shed (`features.depot.crane`: runway + bridge + hook, drawn by LOOK with the Reactor kit's industrial
// pieces), work benches / tool chests / machinery along its outer wall, parts racks at the back, lockers and switchgear on the wing wall.
//
// The RECOVERABLES (InteriorPlan.recoverables: 'radar' | 'sentry' | 'scanner' | 'chest' craft/equipment.ts EquipmentKind + the 'armor'
// upgrade kit; lane CARGO builds their bodies) stand in the PARTS BAY by the loading door: each in its own 2 x 2 m clear square that opens
// onto a DOLLY LANE (3.5 m wide, kept clear of every prop) from the loading door across the shed to the track corridor, which is kept
// clear from the roller door to the back wall — so a dolly (craft/equipment.ts DOLLY_RADIUS 0.36 m) with its load rolls from any of them
// out through either wide door. No loading door: the bay is beside the track corridor instead.

import {CELL} from '../../grid';
import {PROP_DEFS, type PropPlacement} from '../../props';
import {stockVariant} from '../../purposeShapes';
import type {Side} from '../../stationTypes';
import type {SurfaceRecoverable} from '../surfaceTypes';
import type {EntranceInfo, InteriorBuilder, LRect, RoomInfo} from './builder';
import {along, anyWall, backOffice, copyRoom, crewRoom, lockerRoom, mountAbove, privateOffice, stockRoom, washroom, wallRow} from './dress';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const DEPOT_RECOVERABLES = ['radar', 'sentry', 'scanner', 'chest', 'armor'] as const;
/** Dolly lane half-width (cells: the lane is 2 * HALF + 1 cells = 3.5 m) and a recoverable's clear square (cells). */
export const DEPOT_LANE = {half: 3, square: 4} as const;

export interface DepotFeatures {
  /** The maintenance shed (area id). */
  shed: number;
  /** Rail tracks: centre line (world m) from the roller-door wall to the back wall; standard gauge. */
  tracks: {x0: number; z0: number; x1: number; z1: number; gauge: number}[];
  /** Inspection pits (world rect between the rails of the first track; grated, walkable). */
  pits: {x0: number; z0: number; x1: number; z1: number; depth: number}[];
  /** Overhead travelling crane: the runway's box (world m), bridge span, rail height (abs), bridge position (0..1 along `axis`), hook height. */
  crane: {x0: number; z0: number; x1: number; z1: number; span: number; y: number; at: number; hookY: number; axis: 'x' | 'z'} | null;
  /** The dolly lanes (level-0 grid indices): the track corridor and the loading-door lane. */
  lane: number[];
  /** The loading-bay entrance id when there is one (the truck's door), else the roller door's. */
  exit: string | null;
}

export function planDepot(b: InteriorBuilder): void {
  const {W, D} = b;
  const two = b.storeys.length >= 2;
  const main = b.ents.find(e => e.e.main && e.local === 'F') ?? b.ents.find(e => e.local === 'F') ?? null;
  const ms0 = main ? main.s0 : Math.floor(W / 2) - 4, ms1 = main ? main.s1 : Math.floor(W / 2) + 4;
  // the loading door: the widest entrance on a long (L / R) wall
  const load = b.ents.filter(e => (e.local === 'L' || e.local === 'R') && e.inner.length >= 8).sort((p, q) => q.inner.length - p.inner.length)[0] ?? null;
  // --- the support wing: the long side away from the loading door (else the side with more room beside the roller door) ---------
  let wing: 'L' | 'R' = load ? (load.local === 'L' ? 'R' : 'L') : (W - 1 - ms1 >= ms0 ? 'R' : 'L');
  let S = Math.max(12, Math.min(20, Math.round(W * 0.34)));
  const fits = (s: 'L' | 'R', w: number) => (s === 'R' ? ms1 + DEPOT_LANE.half + 6 < W - w - 1 : ms0 - DEPOT_LANE.half - 6 > w);
  // at the least the roller door (and a jamb) lands in the shed, clear of the wing wall
  const inShed = (s: 'L' | 'R', w: number) => (s === 'R' ? ms1 + 2 < W - w - 1 : ms0 - 2 > w);
  while (S > 10 && !fits(wing, S)) S--;
  if (!fits(wing, S) && !load) { wing = wing === 'R' ? 'L' : 'R'; S = 10; }
  while (S > 8 && !inShed(wing, S)) S--;
  // a plot too narrow for a wing beside the roller door: the shed takes the whole floor (no wing, no mezzanine)
  const hasWing = inShed(wing, S);
  if (!hasWing) S = 0;
  const wu0 = wing === 'R' ? W - S : 0; // wing u range [wu0, wu0 + S)
  const shedL: LRect = !hasWing ? {u: 0, v: 0, du: W, dv: D} : wing === 'R' ? {u: 0, v: 0, du: W - S - 1, dv: D} : {u: S + 1, v: 0, du: W - S - 1, dv: D};
  const n = hasWing && two && D >= b.coreLength(2) + 20 ? 2 : 1;
  const coreLen = n === 2 ? b.coreLength(2) : 0;
  const shed = b.room(0, shedL, {type: 'utility', label: 'Maintenance shed', role: 'shed', front: true, purpose: 'workshop', windows: 'high', enemies: 3, publicSpace: false});
  if (!shed) return;
  if (n === 2) {
    // double height: the shed rises to the mezzanine storey's ceiling (nothing is built over it on the upper storey)
    shed.area.ceil = b.storeys[1].ceil;
    const g = b.grid(0);
    for (let y = shed.area.y; y < shed.area.y + shed.area.h; y++) for (let x = shed.area.x; x < shed.area.x + shed.area.w; x++) g.ceil[g.idx(x, y)] = shed.area.ceil;
  }
  // --- the wing (street storey) --------------------------------------------------------------------------------------------
  const wingEnd = n === 2 ? D - coreLen - 1 : D;
  const spans = hasWing ? b.split('v', 0, wingEnd, [1.0, 1.8, 1.2, 0.6, 0.8], 7, [wu0, wu0 + S - 1]) : [];
  const roles = [
    {type: 'agent-office' as const, label: 'Foreman\'s office', role: 'office', windows: 'office' as const},
    {type: 'stock-room' as const, label: 'Parts store', role: 'parts', windows: 'high' as const},
    {type: 'crew-room' as const, label: 'Crew room', role: 'crew', windows: 'office' as const},
    {type: 'washroom' as const, label: 'Washroom', role: 'washroom', windows: 'small' as const},
    {type: 'crew-room' as const, label: 'Locker room', role: 'lockers', windows: 'none' as const},
  ];
  const kept = spans.length >= roles.length ? roles : roles.slice(0, spans.length);
  const wingRooms: RoomInfo[] = [];
  spans.forEach(([s, e], k) => {
    const q = kept[k];
    const r = b.room(0, {u: wu0, v: s, du: S, dv: e - s}, {type: q.type, label: q.label, role: q.role, windows: q.windows, enemies: q.role === 'washroom' ? 0.4 : 1});
    if (r) wingRooms.push(r);
  });
  const byRole = (role: string) => wingRooms.find(r => r.role === role) ?? null;
  // doors: the office / parts store (a dolly-wide door) / crew room / locker room onto the shed; the washroom off the crew room
  for (const r of wingRooms) if (r.role !== 'washroom') b.door(r, shed, r.role === 'parts' ? 6 : 3, {at: 'mid', staff: true});
  if (!b.door(byRole('crew'), byRole('washroom'), 2, {at: 'mid', staff: true})) b.door(byRole('washroom'), shed, 2, {at: 'mid', staff: true});
  // --- the mezzanine: the stair core at the back of the wing, offices over the wing ----------------------------------------------
  const ups: RoomInfo[] = [];
  let crib: RoomInfo | null = null;
  if (n === 2) {
    const WH = b.coreWidth(2);
    const coreL: LRect = wing === 'R' ? {u: W - WH, v: D - coreLen, du: WH, dv: coreLen} : {u: 0, v: D - coreLen, du: WH, dv: coreLen};
    const spareL: LRect = wing === 'R' ? {u: wu0, v: D - coreLen, du: S - WH - 1, dv: coreLen} : {u: WH + 1, v: D - coreLen, du: S - WH - 1, dv: coreLen};
    const landings = b.carveCore(coreL, 'v', 'lo', 2);
    crib = b.room(0, spareL, {type: 'storage', label: 'Tool crib', role: 'crib', windows: 'none'});
    b.door(crib, shed, 4, {at: 'mid', staff: true});
    if (landings[0] && !b.landingDoor(landings[0], wingRooms[wingRooms.length - 1] ?? null)) b.landingDoor(landings[0], crib);
    if (landings[1]) {
      const hall = b.room(1, spareL, {type: 'office-corridor', label: 'Mezzanine hall', role: 'hall', windows: 'none', noLoose: true, enemies: 0.4});
      b.landingDoor(landings[1], hall);
      const us = b.split('v', 0, D - coreLen - 1, [1.4, 1.0, 1.0, 0.7], 8, [wu0, wu0 + S - 1]);
      const labels = [['Planning office', 'planning'], ['Records room', 'records'], ['Supervisor\'s office', 'supervisor'], ['Washroom', 'washroom']] as const;
      us.forEach(([s, e], k) => {
        const q = labels[k];
        const r = b.room(1, {u: wu0, v: s, du: S, dv: e - s}, q[1] === 'washroom' ? {type: 'washroom', label: q[0], role: q[1], windows: 'small', enemies: 0.3}
          : {type: 'office-room', label: q[0], role: q[1], windows: 'office'});
        if (r) ups.push(r);
      });
      b.connectAll(1, hall);
    }
  }
  b.connectAll(0, shed);
  // --- the shed: tracks, the dolly lanes, the parts bay with the recoverables ------------------------------------------------------
  const shedU0 = shedL.u, shedU1 = shedL.u + shedL.du; // [u0, u1)
  const c1 = Math.max(shedU0 + DEPOT_LANE.half + 1, Math.min(shedU1 - DEPOT_LANE.half - 2, Math.round((ms0 + ms1) / 2)));
  const tracks = [c1];
  const c2 = wing === 'R' ? c1 - 11 : c1 + 11;
  if (c2 - DEPOT_LANE.half - 1 >= shedU0 + 6 && c2 + DEPOT_LANE.half + 1 <= shedU1 - 6 && (!load || Math.abs(c2 - (load.local === 'L' ? shedU0 : shedU1)) > 18)) tracks.push(c2);
  const lane: number[] = [];
  const g0 = b.grid(0);
  const add = (u: number, v: number) => {
    const p = b.cell(u, v);
    if (!g0.inBounds(p.x, p.y)) return;
    const i = g0.idx(p.x, p.y);
    if (g0.area[i] === shed.area.id) lane.push(i);
  };
  for (let v = 0; v < D; v++) for (let u = c1 - DEPOT_LANE.half; u <= c1 + DEPOT_LANE.half; u++) add(u, v);
  if (load) {
    const lu0 = load.local === 'L' ? shedU0 : c1, lu1 = load.local === 'L' ? c1 : shedU1 - 1;
    for (let v = load.s0 - 1; v <= load.s1 + 1; v++) for (let u = lu0; u <= lu1; u++) add(u, v);
  }
  b.keepCells(0, lane);
  b.recoverables = parkRecoverables(b, shed, c1, load, wing, shedU0, shedU1);
  // --- dressing ---------------------------------------------------------------------------------------------------------------
  for (const r of wingRooms) {
    if (r.role === 'office') backOffice(b, r, 'agent-office', true);
    else if (r.role === 'parts') { stockRoom(b, r, 'workshop', 'parts'); anyWall(b, r, 'rollingToolChest'); anyWall(b, r, 'signalHeadSpare'); }
    else if (r.role === 'crew') crewRoom(b, r);
    else if (r.role === 'washroom') washroom(b, r);
    else if (r.role === 'lockers') lockerRoom(b, r);
  }
  if (crib) stockRoom(b, crib, 'workshop', 'parts');
  for (const r of ups) {
    if (r.role === 'planning') privateOffice(b, r);
    else if (r.role === 'records') copyRoom(b, r, true);
    else if (r.role === 'supervisor') privateOffice(b, r, true);
    else if (r.role === 'washroom') washroom(b, r);
  }
  dressShed(b, shed, wing);
  const exit = load ? entranceId(b, load) : main ? entranceId(b, main) : null;
  b.features = {depot: {shed: shed.area.id, ...depotGeometry(b, shed, tracks), lane, exit} satisfies DepotFeatures};
}

/** The entrance id planEntrances gives an entrance (rooms/finish.ts: `b<building>-e<index>`). */
const entranceId = (b: InteriorBuilder, e: EntranceInfo): string => `b${b.b.id}-e${b.ents.indexOf(e)}`;

/**
 * The recoverables in the parts bay: clear squares touching the loading-door lane (both sides of it, from the loading wall inward), else
 * beside the track corridor (the wing side) from the roller door inward.
 */
function parkRecoverables(b: InteriorBuilder, shed: RoomInfo, c1: number, load: EntranceInfo | null, wing: 'L' | 'R', u0: number, u1: number): SurfaceRecoverable[] {
  const rng = b.rng.fork('depot-recoverables');
  const g = b.grid(0);
  const kinds = rng.shuffle(DEPOT_RECOVERABLES.slice());
  const Q = DEPOT_LANE.square;
  const free = (su: number, sv: number) => {
    for (let du = 0; du < Q; du++) for (let dv = 0; dv < Q; dv++) {
      const p = b.cell(su + du, sv + dv);
      if (!g.inBounds(p.x, p.y)) return false;
      const i = g.idx(p.x, p.y);
      if (g.area[i] !== shed.area.id || !g.walkable(p.x, p.y)) return false;
    }
    return true;
  };
  // candidate squares (local low corner) and the side they face (toward the lane: the dolly comes from there)
  const cands: {u: number; v: number; face: 'F' | 'B' | 'L' | 'R'}[] = [];
  if (load) {
    const step = load.local === 'L' ? 1 : -1;
    const wallU = load.local === 'L' ? u0 + 2 : u1 - 2 - Q;
    for (let k = 0; k < 4; k++) {
      const su = wallU + step * k * (Q + 1);
      if (su + Q > c1 - DEPOT_LANE.half - 1 && su < c1 + DEPOT_LANE.half + 2) break;
      cands.push({u: su, v: load.s1 + 2, face: 'F'}, {u: su, v: load.s0 - 1 - Q, face: 'B'});
    }
  }
  const dir = wing === 'R' ? 1 : -1;
  const su = dir > 0 ? c1 + DEPOT_LANE.half + 1 : c1 - DEPOT_LANE.half - Q;
  for (let v = 6; v + Q < b.D - 3; v += Q + 1) cands.push({u: su, v, face: dir > 0 ? 'L' : 'R'});
  const out: SurfaceRecoverable[] = [];
  const used: {u: number; v: number}[] = [];
  for (const kind of kinds) {
    const c = cands.find(q => !used.some(o => Math.abs(o.u - q.u) < Q + 1 && Math.abs(o.v - q.v) < Q + 1) && free(q.u, q.v));
    if (!c) continue;
    used.push(c);
    const cells: number[] = [];
    for (let du = 0; du < Q; du++) for (let dv = 0; dv < Q; dv++) { const p = b.cell(c.u + du, c.v + dv); cells.push(g.idx(p.x, p.y)); }
    b.keepCells(0, cells);
    const w = b.world(c.u + Q / 2, c.v + Q / 2);
    // facing the lane (local face side -> world yaw; yaw 0 faces +Z)
    const yaw = ({N: Math.PI, S: 0, W: -Math.PI / 2, E: Math.PI / 2} as Record<Side, number>)[b.side(c.face)];
    out.push({kind, pose: {x: r3(w.x), z: r3(w.z), yaw: r3(yaw), level: b.storeys[0].level, y: r3(b.floorY(0))}});
  }
  return out;
}

/** Shed dressing: the work line on the outer wall, parts racks at the back, lockers and switchgear on the wing wall, loose movables. */
function dressShed(b: InteriorBuilder, shed: RoomInfo, wing: 'L' | 'R'): void {
  const rng = b.rng.fork('depot-shed');
  const outer: Side = b.side(wing === 'R' ? 'L' : 'R'), back: Side = b.side('B'), wingWall: Side = b.side(wing);
  // the outer wall: repair benches with parts bins above, tool chests, a grinder, the air compressor, gas cylinders, a generator
  const benches = along(b, shed, outer, 'repairBench', 3, {front: 1.0, variant: 0});
  for (const p of benches) if (rng.chance(0.7)) mountAbove(b, shed, p, 'partsBinRack', 2.05);
  along(b, shed, outer, 'rollingToolChest', 3, {front: 0.8});
  for (const k of ['benchGrinderStand', 'airCompressor', 'gasCylinderCart', 'portableGenerator'] as const) along(b, shed, outer, k, 1, {front: 0.8});
  // the back wall: steel parts racks, shelving
  along(b, shed, back, 'stockShelf', 6, {variant: stockVariant('parts')});
  along(b, shed, back, 'shelf', 3);
  // the wing wall: lockers, the electrical panel, a signal relay rack, a tall cabinet
  along(b, shed, wingWall, 'staffLockers', 3);
  for (const k of ['electricalPanel', 'signalRack', 'cabinetTall'] as const) along(b, shed, wingWall, k, 1);
  // loose movables and stores along the free walls
  for (const k of ['tripodWorkLight', 'tripodWorkLight', 'drumFan', 'stepLadder', 'handTruck', 'palletJack', 'wheelieBin', 'crate', 'crate', 'crate', 'cartonStack', 'signalHeadSpare', 'foldingBarricade'] as const) {
    if (rng.chance(0.8)) anyWall(b, shed, k);
  }
  // a low cabinet on the work line with a hand toolbox on its top (a separate loose prop, hosted)
  const cab = wallRow(b.ctx(0), shed.area, 'cabinetLow', 1, rng, {sides: [outer, back]})[0];
  if (cab) {
    const hi = b.stub.props.indexOf(cab);
    const def = PROP_DEFS.handToolbox, top = PROP_DEFS.cabinetLow.h;
    const across = Math.abs(Math.cos(cab.rot)) > 0.5;
    const p: PropPlacement = {kind: 'handToolbox', x: cab.x, z: cab.z, y: cab.y + top, rot: cab.rot, area: cab.area,
      hx: across ? def.w / 2 : def.d / 2, hz: across ? def.d / 2 : def.w / 2, h: def.h, blocksSight: false, variant: 0, host: hi};
    (cab.cut ??= []).push({y: top, x0: -def.w / 2 - 0.02, x1: def.w / 2 + 0.02}); // loot surfaces skip the span it takes
    b.stub.props.push(p);
  }
}

/** World geometry of the tracks / pit / crane for LOOK (pure data). */
function depotGeometry(b: InteriorBuilder, shed: RoomInfo, tracks: number[]): Pick<DepotFeatures, 'tracks' | 'pits' | 'crane'> {
  const a = shed.area;
  const line = (c: number, v0: number, v1: number) => {
    const p = b.world(c + 0.5, v0), q = b.world(c + 0.5, v1);
    return {x0: r3(p.x), z0: r3(p.z), x1: r3(q.x), z1: r3(q.z)};
  };
  const tr = tracks.map(c => ({...line(c, 0, b.D), gauge: 1.435}));
  const c = tracks[0], p = b.world(c - 1, 8), q = b.world(c + 2, Math.max(12, b.D - 8));
  const pit = {x0: r3(Math.min(p.x, q.x)), z0: r3(Math.min(p.z, q.z)), x1: r3(Math.max(p.x, q.x)), z1: r3(Math.max(p.z, q.z)), depth: 1.4};
  const runway: 'x' | 'z' = b.front === 'N' || b.front === 'S' ? 'z' : 'x';
  const sx0 = a.x * CELL, sz0 = a.y * CELL, sx1 = (a.x + a.w) * CELL, sz1 = (a.y + a.h) * CELL;
  const span = runway === 'z' ? sx1 - sx0 : sz1 - sz0;
  const crane = a.ceil - b.floorY(0) >= 5.5 ? {x0: r3(sx0 + 0.3), z0: r3(sz0 + 0.3), x1: r3(sx1 - 0.3), z1: r3(sz1 - 0.3), span: r3(span - 0.6), y: r3(a.ceil - 0.9),
    at: r3(b.rng.fork('depot-crane').range(0.3, 0.7)), hookY: r3(b.floorY(0) + 2.6), axis: runway} : null;
  return {tracks: tr, pits: [pit], crane};
}
