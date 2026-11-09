// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 5's own dressing (the CENTRAL PROCESSING CORE; carve: ./floor5.ts).
// Runs after the ONE station dresser (purposes: lockers in the clean-room lobby, the commons' kitchenette / fridge / table / couch,
// the control room's racks, the switch room's panels, the chiller's pumps …), in this storey's local height frame (the pipeline lifts
// the props onto the floor; decor / lights / signs are absolute here). Every kind is an existing one (no new kinds / models):
//  - the NAVE: ranks of reel-to-reel mainframe tape cabinets and server racks (openable: electronics spares) along both long walls,
//    either side of the cross axis; the coolant pipe bank terminating the cross axis on the south wall with its risers climbing to
//    the ceiling; two pairs of operator console desks (CRT terminals on top, swivel chairs) facing the core cluster's screen wall;
//    cable trays across the hall at 6 m, a painted aisle from the portal to the cluster, two extra rows of pendants;
//  - the CONTROL ROOM: the radio console + chair + filing cabinet (the Reactor shelter's radio room), the steel control console
//    facing the axis, a desk with a CRT terminal, wall data cabinets;
//  - the COOLING PLANT: coolant pumps on their skids in a line (islands), pipe banks against the east wall, computer-room air
//    handlers (CRAC) and air filtration units round the walls, a supply duct;
//  - the FREIGHT LOBBY: crate stacks and a pallet by the walls (never on the loading bay), a rolling tool chest, a work light, the
//    hazard-striped loading bay;
//  - the TAPE LIBRARY: back-to-back shelving stacks with narrow aisles, archive boxes, filing cabinets, the librarian's desk;
//  - the OPERATORS' COMMONS: a planter garden under a warm lamp, a lounge corner, two mess tables with folding chairs, the night
//    shift's ping-pong table; the BUNK ROOM (bunks + footlockers + lockers);
//  - plates in the shelter's words at every door, the storey plate at both stair doors, wayfinding to the processing hall.
// Storage opens (server racks, cabinets, filing cabinets, footlockers, tool chest, archive boxes: existing openables, loot by the
// room's purpose / the container); loose things move (chairs, crates, plants: their kinds' physics); anchored plant is classified.

import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import type {Area, LightPlacement, Side} from '../../stationTypes';
import {doorSide, placeAgainstWall, strictWallOk, tryPlaceProp, wallRange, wallSpot, mountProp} from '../../placeKit';
import {NORMAL, OPP, ceilingDuct, doorPlate, dormitory, face, island, radioRoom, scanWall, sealOrDrop, sweepPockets, wallBox, wallSign, rotFacing, type Dx} from '../../reactor/complex/bunkerDress';
import {BUNKER_CORE_KIND} from '../bunkerTypes';
import {shelterDx} from '../dress';
import type {FloorDressCtx} from './floorApi';
import {V2_STOREY_PLATES} from './spine';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** QA / tests: what the last storey-5 dress placed. */
export const F5_DRESS_STATS = {props: 0, decor: 0, lights: 0, signs: 0, mainframes: 0, racks: 0, consoles: 0, pumps: 0, planters: 0, skipped: [] as string[]};


/** A wall-backed placement at `t` along `side` (strict real-wall check + the placement primitive); hero kinds sealed. */
function atWall(D: Dx, a: Area, side: Side, t: number, kind: PropKind, front: number, seal = false): PropPlacement | null {
  if (!strictWallOk(D.ctx, a, side, t, kind)) { WHY[`${kind} wall`] = (WHY[`${kind} wall`] ?? 0) + 1; return null; }
  const s = wallSpot(a, side, t, kind);
  if (seal) {
    // a sealed hero body: its front face on a cell boundary (its collision cells = the cells it visibly covers, none half-taken)
    const d = PROP_DEFS[kind].d, off = Math.ceil((d + 0.01) / CELL - 1e-6) * CELL - d / 2 - 0.003;
    const [nx, nz] = NORMAL[side], fc = face(a, side);
    if (side === 'N' || side === 'S') s.z = fc - nz * off; else s.x = fc - nx * off;
  }
  const p = tryPlaceProp(D.ctx, a, kind, r3(s.x), r3(s.z), s.rot, {front});
  if (!p) WHY[`${kind} place`] = (WHY[`${kind} place`] ?? 0) + 1;
  if (p && seal && !sealOrDrop(D, a, p)) { WHY[`${kind} seal`] = (WHY[`${kind} seal`] ?? 0) + 1; return null; }
  return p;
}
export const WHY: Record<string, number> = {};

/** scanWall for a sealed hero body: every 0.25 m along the walls (nearest `prefer` first), front face on a cell boundary. */
function scanSeal(D: Dx, a: Area, kind: PropKind, sides: readonly Side[], front: number, prefer?: number): PropPlacement | null {
  const w = PROP_DEFS[kind].w;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd);
    const ts: number[] = [];
    for (let t = lo + w / 2 + 0.1; t <= hi - w / 2 - 0.1 + 1e-6; t += 0.25) ts.push(Math.round(t * 4) / 4);
    const c = prefer ?? (lo + hi) / 2;
    ts.sort((p, q) => Math.abs(p - c) - Math.abs(q - c) || p - q);
    for (const t of ts) { const p = atWall(D, a, sd, t, kind, front, true); if (p) return p; }
  }
  return null;
}

/**
 * A rank along one wall between t0 and t1 (world m along it) on the 1.0 m cell-pair pitch (every unit centred on a cell boundary
 * k + 0.5, so neighbours never share a grid cell and each unit's collision is its own two cells): banks of `bank` units, one empty
 * pitch between banks, the kinds alternating bank by bank. A tape cabinet (0.52 m deep) stands centred on the wall's first cell
 * row pair (its collision = the two rows it covers); a rack (1.0 m deep) backs onto the wall. A spot that does not fit (door zone,
 * held cells) is skipped. Returns the placements.
 */
function rank(D: Dx, a: Area, side: Side, t0: number, t1: number, kinds: readonly PropKind[], bank: number, front: number): PropPlacement[] {
  const out: PropPlacement[] = [];
  const alongX = side === 'N' || side === 'S';
  const fc = face(a, side), [nx, nz] = NORMAL[side];
  let k = 0;
  for (let t = Math.ceil(t0 - 0.5 - 1e-6) + 0.5; t + 0.5 <= t1 + 1e-6; t += 1.0) {
    const slot = k++ % (bank + 1);
    if (slot === bank) continue; // the gap between banks
    const kind = kinds[Math.floor((k - 1) / (bank + 1)) % kinds.length];
    if (!strictWallOk(D.ctx, a, side, t, kind)) { WHY[`${kind} wall`] = (WHY[`${kind} wall`] ?? 0) + 1; continue; }
    const off = kind === 'bunkerMainframe' ? 0.5 : PROP_DEFS[kind].d / 2 + 0.03;
    const x = alongX ? t : fc - nx * off, z = alongX ? fc - nz * off : t;
    const p = tryPlaceProp(D.ctx, a, kind, r3(x), r3(z), wallSpot(a, side, t, kind).rot, {front});
    if (p) out.push(p); else WHY[`${kind} place`] = (WHY[`${kind} place`] ?? 0) + 1;
  }
  return out;
}

/** Up to `n` wall-mounted pieces of a kind at height `y` (every 0.5 m along the given walls, middle first). */
function mountOn(D: Dx, a: Area, sides: readonly Side[], kind: PropKind, y: number, n: number): number {
  let got = 0;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd), mid = (lo + hi) / 2, w = PROP_DEFS[kind].w;
    const ts: number[] = [];
    for (let t = lo + w / 2 + 0.4; t <= hi - w / 2 - 0.4; t += 0.5) ts.push(Math.round(t * 4) / 4);
    ts.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
    const used: number[] = [];
    for (const t of ts) {
      if (got >= n) return got;
      if (used.some(u => Math.abs(u - t) < w + 1.0)) continue;
      if (mountProp(D.ctx, a, sd, t, kind, y, D.base)) { got++; used.push(t); }
    }
  }
  return got;
}

/** A light fixture (absolute y = base + rel). */
function light(D: Dx, a: Area, x: number, z: number, rel: number, rot: number, warm = false, power = 1): void {
  const l: LightPlacement = {x: r3(x), y: r3(D.base + rel), z: r3(z), rot, area: a.id, broken: false, flicker: false, warm, power, dying: false, level: D.lv};
  D.layout.lights.push(l);
  F5_DRESS_STATS.lights++;
}

/** The door between two areas (if any). */
function doorBetween(D: Dx, a: Area, b: Area) {
  return D.doors(a).find(d => (d.a === a.id && d.b === b.id) || (d.a === b.id && d.b === a.id));
}

/** A shelter plate on `outside`'s side of the door between `outside` and `room` (the dresser's stock plate by it gives way). */
function plate(D: Dx, room: Area, outside: Area, text: string): void {
  const d = doorBetween(D, room, outside);
  if (!d) return;
  const cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL;
  D.layout.signs = D.layout.signs.filter(sg => !(sg.area === outside.id && sg.kind === 'service' && Math.hypot(sg.x - cx, sg.z - cz) < 2.6 && !/AUTHORI[SZ]ED/.test(sg.text)));
  const w = text.length > 14 ? 2.0 : 1.4;
  if (!doorPlate(D, d, outside, text, w) && w > 1.4) doorPlate(D, d, outside, text, 1.4);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The nave

function dressNave(D: Dx, a: Area, gallery: Area | undefined): void {
  const S = F5_DRESS_STATS;
  const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL, z0 = a.y * CELL, z1 = (a.y + a.h) * CELL, zc = (z0 + z1) / 2;
  const core = D.layout.props.find(p => p.kind === BUNKER_CORE_KIND && p.area === a.id && (p.level ?? 0) === D.lv);
  // the cross axis: the north door's span (the gallery side), else the hall's middle
  const nd = gallery ? doorBetween(D, a, gallery) : undefined;
  const ax0 = nd ? nd.x * CELL : (x0 + x1) / 2 - 1.5, ax1 = nd ? (nd.x + nd.w) * CELL : (x0 + x1) / 2 + 1.5, axc = (ax0 + ax1) / 2;
  // (the ranks run on to the east wall: the cluster's held front strip refuses placements in front of it)
  const east = x1 - 0.05;
  // 1) the coolant risers: the pipe bank against the south wall on the cross axis (it terminates the view in from the gallery)
  const pipe = atWall(D, a, 'S', axc, 'bunkerPipeBank', 0.9, true);
  if (pipe) {
    // the risers climb on to the ceiling: three steel pipes and a cable ladder above the bank's top
    const top = PROP_DEFS.bunkerPipeBank.h, rel = a.ceil - D.base;
    for (const dx of [-1.2, -0.2, 0.8]) D.decor('steelBright', wallBox(a, 'S', axc + dx - 0.11, axc + dx + 0.11, 0.25, 0.47), top - 0.2, rel - 0.05);
    D.decor('steelDark', wallBox(a, 'S', axc + 1.35, axc + 1.75, 0.05, 0.12), top - 0.2, rel - 0.05);
  }
  // 2) the ranks along both long walls, either side of the crossing: tape cabinets and server racks in banks of four (the west
  //    ranks start with tape cabinets on the north wall / racks on the south wall, the east ranks the other way round)
  const west0 = x0 + 0.05, west1 = ax0 - 1.0, east0 = ax1 + 1.0;
  for (const side of ['N', 'S'] as Side[]) {
    const order: PropKind[] = side === 'N' ? ['bunkerMainframe', 'serverRack'] : ['serverRack', 'bunkerMainframe'];
    const sideEast = side === 'S' && pipe ? Math.max(east0, pipe.x + pipe.hx + 0.5) : east0;
    const sideWest1 = side === 'S' && pipe ? Math.min(west1, pipe.x - pipe.hx - 0.5) : west1;
    for (const p of [...rank(D, a, side, west0, sideWest1, order, 4, 0.9), ...rank(D, a, side, sideEast, east, [order[1], order[0]], 4, 0.9)]) {
      if (p.kind === 'bunkerMainframe') S.mainframes++; else S.racks++;
    }
  }
  // 3) the operators' console desks: two rows of two either side of the painted aisle, west of the crossing, facing the screen wall
  //    across the hall (the operator sits on the west side; the CRT on the desk faces him)
  for (const sz of [-1, 1]) for (const dxm of [ax0 - 5.0, ax0 - 2.4]) {
    const z = r3(zc + sz * 2.25), x = Math.round(dxm * 4) / 4;
    const desk = tryPlaceProp(D.ctx, a, 'desk', x, z, -Math.PI / 2);
    if (!desk) { WHY['nave desk'] = (WHY['nave desk'] ?? 0) + 1; continue; }
    S.consoles++;
    HOSTED.push(desk);
    tryPlaceProp(D.ctx, a, 'officeSwivelChair', r3(x - PROP_DEFS.desk.d / 2 - 0.4), z, Math.PI / 2, {laneOk: true});
  }
  // 4) the long-wall pilasters (to the storey-4 slab) and the cable trays across the hall at 6 m; a painted aisle to the cluster
  const rel = a.ceil - D.base;
  for (let x = x0 + 3.5; x < x1 - 3; x += 7) for (const side of ['N', 'S'] as Side[]) D.decor('steelDark', wallBox(a, side, x - 0.25, x + 0.25, 0, 0.18), 2.4, Math.min(rel, 7.2));
  for (let x = x0 + 2; x < x1 - 1.5; x += 4) {
    D.decor('grille', {x0: x - 0.3, x1: x + 0.3, z0: z0 + 0.05, z1: z1 - 0.05}, 6.0, 6.08);
    D.decor('steelDark', {x0: x - 0.32, x1: x + 0.32, z0: z0 + 0.05, z1: z1 - 0.05}, 5.98, 6.0);
  }
  const ae = core ? core.x - core.hx - 3.1 : x1 - 1;
  D.decor('plasticSeat', {x0: x0 + 0.1, x1: ae, z0: zc - 1.55, z1: zc - 1.45}, 0, 0.008);
  D.decor('plasticSeat', {x0: x0 + 0.1, x1: ae, z0: zc + 1.45, z1: zc + 1.55}, 0, 0.008);
  // 5) the light: two more rows of pendants over the ranks (the dresser hung one down the middle), high work lights over the cluster
  for (let x = x0 + 3; x < x1 - 2; x += 4.5) for (const z of [z0 + 2.2, z1 - 2.2]) light(D, a, x, z, 5.4, 0, false, 0.9);
  // 6) plates: the hall's name over the portal side, the shelter's motto over the cluster
  wallSign(D, a, 'W', zc, 4.2, {kind: 'service', text: 'CENTRAL PROCESSING · LEVEL 5', w: 3.2});
  wallSign(D, a, 'E', zc, 5.4, {kind: 'info', text: 'CORE · DO NOT POWER DOWN', w: 3.0});
}

/** Control-room / console desks that take a CRT terminal on their top once the pocket sweep is done. */
const HOSTED: PropPlacement[] = [];

function hostTerminals(D: Dx): void {
  for (const desk of HOSTED.splice(0)) {
    const host = D.layout.props.indexOf(desk);
    if (host < 0) continue;
    const crt = PROP_DEFS.crtTerminal, top = PROP_DEFS.desk.h, back = (PROP_DEFS.desk.d - crt.d) / 2 - 0.04;
    const fx = Math.round(Math.sin(desk.rot)), fz = Math.round(Math.cos(desk.rot));
    const {hx, hz} = footprint('crtTerminal', desk.rot);
    D.layout.props.push({kind: 'crtTerminal', x: r3(desk.x - fx * back), z: r3(desk.z - fz * back), y: r3(desk.y + top), rot: desk.rot, area: desk.area, hx, hz, h: crt.h, blocksSight: false, variant: 0, host, level: D.lv});
    desk.cut = [...(desk.cut ?? []), {y: top, x0: -crt.w / 2 - 0.02, x1: crt.w / 2 + 0.02}];
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The rooms

function dressControl(D: Dx, a: Area): void {
  radioRoom(D, a);
  // the steel control console on the far (north) wall's east part, facing the room; a desk + CRT, wall data cabinets
  const cons = scanSeal(D, a, 'bunkerControlConsole', ['N', 'E', 'S'], 1.2, (a.x + a.w * 0.65) * CELL);
  if (cons) {
    F5_DRESS_STATS.consoles++;
    const fx = Math.round(Math.sin(cons.rot)), fz = Math.round(Math.cos(cons.rot)), off = PROP_DEFS.bunkerControlConsole.d / 2 + 0.45;
    for (const s of [-0.8, 0.8]) tryPlaceProp(D.ctx, a, 'officeSwivelChair', r3(cons.x + fx * off + fz * s), r3(cons.z + fz * off + fx * s), rotFacing(-fx, -fz), {laneOk: true});
  }
  const desk = scanWall(D, a, 'desk', ['E', 'S', 'N'], 0.8);
  if (desk) HOSTED.push(desk);
  mountOn(D, a, ['N', 'E', 'S'], 'wallDataCabinet', 1.4, 3);
}

function dressCooling(D: Dx, a: Area): void {
  const S = F5_DRESS_STATS;
  const rel = a.ceil - D.base;
  // pipe banks against the east wall (where the ceiling clears them)
  if (rel >= PROP_DEFS.bunkerPipeBank.h + 0.3) for (let i = 0; i < 2; i++) scanSeal(D, a, 'bunkerPipeBank', ['E'], 0.9, (a.y + a.h * (i ? 0.75 : 0.3)) * CELL);
  // a line of coolant pumps on their skids down the plant (islands, their motors toward the walkway on the axis side)
  const xs = (Math.floor(a.x + a.w * 0.62) + 0.5) * CELL; // (a cell centre: the 1.36 m skid covers three whole cells)
  for (const f of [0.22, 0.5, 0.78]) {
    const z = Math.round((a.y + a.h * f) * CELL * 2) / 2;
    const p = tryPlaceProp(D.ctx, a, 'bunkerCoolantPump', r3(xs), r3(z), Math.PI / 2, {ring: 0.7});
    if (p && sealOrDrop(D, a, p)) S.pumps++;
  }
  // air handlers: CRAC units along the north wall, air filtration on the south
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'cracUnit', {sides: ['N'], front: 1.0, tries: 16});
  for (let i = 0; i < 2; i++) if (!scanWall(D, a, 'airFilterUnit', ['S', 'E'], 1.0, (a.x + a.w * 0.75) * CELL)) break;
  ceilingDuct(D, a, 'E', 0.62);
  ceilingDuct(D, a, 'N', 0.45);
  // a second row of fixtures over the pumps
  for (const f of [0.25, 0.75]) light(D, a, xs, (a.y + a.h * f) * CELL, Math.min(rel - 0.1, 4.8), Math.PI / 2, false, 0.85);
}

function dressBay(D: Dx, a: Area, lift: {x: number; y: number; w: number; h: number}): void {
  // the loading bay: hazard stripes round the lift apron (floor finish), crate stacks, a pallet, a tool chest, a work light
  const bx0 = lift.x * CELL, bx1 = (lift.x + lift.w) * CELL, bz0 = lift.y * CELL, bz1 = (lift.y + lift.h) * CELL;
  for (const b of [{x0: bx0, x1: bx1, z0: bz0, z1: bz0 + 0.15}, {x0: bx0, x1: bx0 + 0.15, z0: bz0, z1: bz1}, {x0: bx1 - 0.15, x1: bx1, z0: bz0, z1: bz1}]) D.decor('plasticSeat', b, 0, 0.008);
  for (let x = bx0 + 0.4; x < bx1 - 0.3; x += 0.8) D.decor('black', {x0: x, x1: x + 0.3, z0: bz0 + 0.01, z1: bz0 + 0.14}, 0.008, 0.01);
  wallSign(D, a, 'S', (bx0 + bx1) / 2, 3.45, {kind: 'service', text: 'CARGO LIFT · LEVEL 5', w: 2.4});
  const far: Side[] = ['N', 'E'];
  for (let i = 0; i < 4; i++) placeAgainstWall(D.ctx, a, 'crate', {sides: far, tries: 16});
  placeAgainstWall(D.ctx, a, 'parcelPallet', {sides: far, tries: 16});
  placeAgainstWall(D.ctx, a, 'rollingToolChest', {sides: ['N'], tries: 16});
  placeAgainstWall(D.ctx, a, 'tripodWorkLight', {sides: ['N', 'E'], tries: 12});
}

function dressLibrary(D: Dx, a: Area): void {
  // back-to-back shelving stacks running north-south, 1.2 m aisles between them; archive boxes / filing cabinets on the walls
  const sh = PROP_DEFS.shelf;
  const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL, z0 = a.y * CELL + 1.4, z1 = (a.y + a.h) * CELL - 1.6;
  const pitch = 2 * sh.d + 1.6;
  let n = 0;
  for (let x = x0 + 2.0; x + sh.d <= x1 - 1.6 && n < 8; x += pitch) {
    for (let z = z0 + sh.w / 2; z + sh.w / 2 <= z1 && n < 8; z += sh.w + 0.02) {
      for (const sg of [-1, 1]) {
        const p = tryPlaceProp(D.ctx, a, 'shelf', r3(x + sg * (sh.d / 2 + 0.01)), r3(z), sg < 0 ? -Math.PI / 2 : Math.PI / 2, {laneOk: true});
        if (p) n++;
      }
    }
  }
  for (let i = 0; i < 3; i++) placeAgainstWall(D.ctx, a, 'archiveBoxes', {tries: 16});
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'filingCabinet', {tries: 16});
  const desk = scanWall(D, a, 'desk', ['W', 'N', 'S'], 0.8);
  if (desk) HOSTED.push(desk);
}

function dressCommons(D: Dx, a: Area): void {
  const S = F5_DRESS_STATS;
  const rel = a.ceil - D.base;
  // the planter garden on the wall opposite the service stair's landing (north), a warm lamp over it
  const ds = D.doors(a).filter(d => doorSide(d, a) === 'N');
  const [lo, hi] = wallRange(a, 'N');
  let first = -1, last = -1;
  for (let t = lo + 0.8; t <= hi - 0.8 && S.planters < 4; t += 0.25) {
    if (ds.some(d => Math.abs(t - (d.x + d.w / 2) * CELL) < d.w * CELL / 2 + 1.6)) continue;
    const p = atWall(D, a, 'N', t, 'planterTree', 0.6);
    if (p) { S.planters++; if (first < 0) first = t; last = t; t += 1.2; }
  }
  if (first >= 0) light(D, a, (first + last) / 2, a.y * CELL + 1.2, Math.min(rel - 0.1, 3.4), 0, true, 0.9);
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'pottedPlantSmall', {tries: 12});
  // a lounge corner (armchairs) and two mess tables with folding chairs, the ping-pong table
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'loungeArmchair', {sides: ['E', 'N'], front: 0.6, tries: 16});
  const tbl = PROP_DEFS.table, ch = PROP_DEFS.foldingChair;
  const cx = (a.x + a.w * 0.62) * CELL, cz = (a.y + a.h * 0.42) * CELL;
  let tables = 0;
  for (const [ox, oz] of [[0, 0], [0, 3.2], [-3.0, 0], [-3.0, 3.2], [3.0, 0]] as const) {
    if (tables >= 2) break;
    const x = Math.round((cx + ox) * 4) / 4, z = Math.round((cz + oz) * 4) / 4;
    const t = tryPlaceProp(D.ctx, a, 'table', x, z, 0, {ring: 0.5});
    if (!t) continue;
    tables++;
    for (const sg of [-1, 1]) for (const sl of [-0.35, 0.35]) {
      if (!D.rng.chance(0.75)) continue;
      tryPlaceProp(D.ctx, a, 'foldingChair', r3(x + sl), r3(z + sg * (tbl.d / 2 + ch.d / 2 + 0.05)), rotFacing(0, -sg), {laneOk: true});
    }
  }
  const pp = PROP_DEFS.pingPongTable;
  for (const [fx, fz] of [[0.3, 0.75], [0.7, 0.8], [0.35, 0.3]] as const) {
    const x = Math.round((a.x + a.w * fx) * CELL * 4) / 4, z = Math.round((a.y + a.h * fz) * CELL * 4) / 4;
    if (tryPlaceProp(D.ctx, a, 'pingPongTable', x, z, pp.w >= pp.d ? 0 : Math.PI / 2, {ring: 0.9})) break;
  }
}

/** The operators' gallery: benches along the north wall between its doors (the shift change), a rota board, plants, extinguishers. */
function dressGallery(D: Dx, a: Area): void {
  const rel = a.ceil - D.base;
  for (let i = 0; i < 3; i++) placeAgainstWall(D.ctx, a, 'bench', {sides: ['N'], front: 0.6, tries: 20});
  placeAgainstWall(D.ctx, a, 'noticeBoard', {sides: ['N', 'S'], y: 1.1, tries: 16});
  mountOn(D, a, ['S', 'N'], 'fireExtinguisherCabinet', 0.6, 1);
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'pottedPlantSmall', {sides: ['N', 'S'], tries: 12});
  ceilingDuct(D, a, 'S', 0.45);
  for (let x = a.x * CELL + 2.5; x < (a.x + a.w) * CELL - 2; x += 5) light(D, a, x, (a.y + a.h / 2) * CELL, rel - 0.05, 0, true, 0.85);
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function dressFloor5(ctx: FloorDressCtx): void {
  const S = F5_DRESS_STATS;
  S.mainframes = S.racks = S.consoles = S.pumps = S.planters = S.lights = 0;
  S.skipped = [];
  HOSTED.length = 0;
  for (const k of Object.keys(WHY)) delete WHY[k];
  const {layout, carved} = ctx;
  const A = (k: string): Area | undefined => (carved.areas[k] !== undefined ? layout.areas[carved.areas[k]] : undefined);
  const mine = Object.values(carved.areas).map(id => layout.areas[id]);
  const D = shelterDx(layout, ctx.level, ctx.rng, mine);
  for (const i of ctx.held) D.held.add(i);
  const p0 = layout.props.length, d0 = layout.decor.length, s0 = layout.signs.length;
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { S.skipped.push(`${name}: ${(e as Error).message}`); } };
  const nave = A('nave'), gallery = A('gallery');
  const lift = ctx.frame.anchors.find(an => an.id === 'lift')!;
  if (nave) step('nave', () => dressNave(D, nave, gallery));
  const control = A('control'), cooling = A('cooling'), bay = A('bay'), library = A('library'), commons = A('commons'), bunks = A('bunks');
  if (control) step('control', () => dressControl(D, control));
  if (cooling) step('cooling', () => dressCooling(D, cooling));
  if (bay) step('bay', () => dressBay(D, bay, lift.apron));
  if (library) step('library', () => dressLibrary(D, library));
  if (commons) step('commons', () => dressCommons(D, commons));
  if (bunks) step('bunks', () => dormitory(D, bunks));
  if (gallery) step('gallery', () => dressGallery(D, gallery));
  // plates in the shelter's words
  step('plates', () => {
    const P: [string, string, string][] = [
      ['nave', 'gallery', 'PROCESSING HALL'], ['nave', 'narthex', 'PROCESSING HALL · CLEAN AREA'], ['narthex', 'gallery', 'CLEAN-ROOM LOBBY'],
      ['control', 'gallery', 'CORE CONTROL'], ['control', 'cooling', 'CORE CONTROL'], ['cooling', 'bay', 'COOLING PLANT'], ['chiller', 'cooling', 'CHILLER ROOM · DANGER'],
      ['switch', 'gallery', 'SWITCH ROOM · DANGER'], ['library', 'bay', 'TAPE LIBRARY'], ['commons', 'bay', 'OPERATORS\' COMMONS'], ['bunks', 'commons', 'BUNK ROOM · NIGHT SHIFT'],
      ['wash', 'commons', 'WASHROOM'],
    ];
    for (const [r, o, text] of P) { const ra = A(r), oa = A(o); if (ra && oa) plate(D, ra, oa, text); }
    // the storey at both stair doors (the side the stair lands on)
    for (const an of ctx.frame.anchors) {
      if (an.id !== 'stairA' && an.id !== 'stairB') continue;
      const out = an.id === 'stairA' ? gallery : commons;
      if (!out) continue;
      const side: Side = an.out === 'S' ? 'N' : 'S';
      wallSign(D, out, side, (an.gate.x + an.gate.w / 2) * CELL + an.gate.w * CELL / 2 + 1.4, 2.2, {kind: 'service', text: V2_STOREY_PLATES[ctx.level], w: 2.4});
    }
    // wayfinding from the main stair: the processing hall (west, via the clean-room lobby) and the core control / freight lift
    if (gallery) {
      const nd = A('narthex') && doorBetween(D, gallery, A('narthex')!);
      if (nd) wallSign(D, gallery, 'N', (nd.x + nd.w / 2) * CELL, 2.3, {kind: 'info', text: 'PROCESSING HALL', w: 1.9, arrow: 'down'});
    }
  });
  // the guarantee: no floor pocket on the storey (a prop of this pass that closes one off goes again); then the desk terminals
  sweepPockets(D, mine, p0);
  hostTerminals(D);
  S.skipped.push(JSON.stringify(WHY));
  S.props = layout.props.length - p0; S.decor = layout.decor.length - d0; S.signs = layout.signs.length - s0;
  void FLOOR; void NORMAL; void OPP; void face; void island;
}
