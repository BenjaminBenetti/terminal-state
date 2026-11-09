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

import {CELL} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import type {Area, LightPlacement, Side} from '../../stationTypes';
import {begin, commit, doorSide, placeAgainstWall, rollback, strictWallOk, tryPlaceProp, wallRange, wallSpot, mountProp} from '../../placeKit';
import {NORMAL, ceilingDuct, doorPlate, dormitory, face, radioRoom, rotFacing, scanWall, sealOrDrop, sweepPockets, wallBox, wallSign, type Dx} from '../../reactor/complex/bunkerDress';
import {BUNKER_CORE_KIND} from '../bunkerTypes';
import {shelterDx} from '../dress';
import type {FloorDressCtx} from './floorApi';
import {V2_STOREY_PLATES} from './spine';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** QA / tests: what the last storey-5 dress placed. */
export const F5_DRESS_STATS = {props: 0, decor: 0, lights: 0, signs: 0, mainframes: 0, racks: 0, consoles: 0, pumps: 0, planters: 0, stocked: 0, skipped: [] as string[]};


/** A wall-backed placement at `t` along `side` (strict real-wall check + the placement primitive); hero kinds sealed. */
function atWall(D: Dx, a: Area, side: Side, t: number, kind: PropKind, front: number, seal = false): PropPlacement | null {
  if (!strictWallOk(D.ctx, a, side, t, kind)) { F5_REFUSED[`${kind} wall`] = (F5_REFUSED[`${kind} wall`] ?? 0) + 1; return null; }
  const s = wallSpot(a, side, t, kind);
  if (seal) {
    // a sealed hero body: its front face on a cell boundary (its collision cells = the cells it visibly covers, none half-taken)
    const d = PROP_DEFS[kind].d, off = Math.ceil((d + 0.01) / CELL - 1e-6) * CELL - d / 2 - 0.003;
    const [nx, nz] = NORMAL[side], fc = face(a, side);
    if (side === 'N' || side === 'S') s.z = fc - nz * off; else s.x = fc - nx * off;
  }
  const p = tryPlaceProp(D.ctx, a, kind, r3(s.x), r3(s.z), s.rot, {front});
  if (!p) F5_REFUSED[`${kind} place`] = (F5_REFUSED[`${kind} place`] ?? 0) + 1;
  if (p && seal && !sealOrDrop(D, a, p)) { F5_REFUSED[`${kind} seal`] = (F5_REFUSED[`${kind} seal`] ?? 0) + 1; return null; }
  return p;
}
/** QA / tests: placements of the last storey-5 dress refused, by kind and check (wall backing / placement / seal). */
export const F5_REFUSED: Record<string, number> = {};

/** scanWall for a sealed hero body: every 0.25 m along the walls (nearest `prefer` first), front face on a cell boundary. */
function scanSeal(D: Dx, a: Area, kind: PropKind, sides: readonly Side[], front: number, prefer?: number, maxOff = Infinity): PropPlacement | null {
  const w = PROP_DEFS[kind].w;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd);
    const ts: number[] = [];
    const c = prefer ?? (lo + hi) / 2;
    for (let t = lo + w / 2 + 0.1; t <= hi - w / 2 - 0.1 + 1e-6; t += 0.25) if (Math.abs(t - c) <= maxOff) ts.push(Math.round(t * 4) / 4);
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
    if (!strictWallOk(D.ctx, a, side, t, kind)) { F5_REFUSED[`${kind} wall`] = (F5_REFUSED[`${kind} wall`] ?? 0) + 1; continue; }
    const off = kind === 'bunkerMainframe' ? 0.5 : PROP_DEFS[kind].d / 2 + 0.03;
    const x = alongX ? t : fc - nx * off, z = alongX ? fc - nz * off : t;
    const p = tryPlaceProp(D.ctx, a, kind, r3(x), r3(z), wallSpot(a, side, t, kind).rot, {front});
    if (p) out.push(p); else F5_REFUSED[`${kind} place`] = (F5_REFUSED[`${kind} place`] ?? 0) + 1;
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
  // (the ranks stop at the cluster's face: it stands free against the east wall, the corners beside it open)
  const east = core ? core.x - core.hx - 0.05 : x1 - 0.05;
  // 1) the coolant risers: the pipe bank against the south wall on the cross axis (it terminates the view in from the gallery)
  // (on the axis, else the nearest free stretch of the south wall within 4 m: the dresser's few cabinets may hold the exact spot)
  const pipe = scanSeal(D, a, 'bunkerPipeBank', ['S'], 0.9, axc, 4.0);
  if (pipe) {
    // the risers climb on to the ceiling: three steel pipes and a cable ladder above the bank's top
    const top = PROP_DEFS.bunkerPipeBank.h, rel = a.ceil - D.base;
    for (const dx of [-1.2, -0.2, 0.8]) D.decor('steelBright', wallBox(a, 'S', pipe.x + dx - 0.11, pipe.x + dx + 0.11, 0.25, 0.47), top - 0.2, rel - 0.05);
    D.decor('steelDark', wallBox(a, 'S', pipe.x + 1.35, pipe.x + 1.75, 0.05, 0.12), top - 0.2, rel - 0.05);
  }
  // 2) the ranks along both long walls, either side of the crossing, in banks of four: the north wall is the TAPE WALL (reel-to-reel
  //    cabinets only, facing the operators' desks), the south wall alternates server racks (openable: the storey's electronics spares)
  //    and tape cabinets either side of the coolant risers
  const west0 = x0 + 0.05, west1 = ax0 - 1.0, east0 = ax1 + 1.0;
  for (const side of ['N', 'S'] as Side[]) {
    const order: PropKind[] = side === 'N' ? ['bunkerMainframe'] : ['serverRack', 'bunkerMainframe'];
    const sideEast = side === 'S' && pipe ? Math.max(east0, pipe.x + pipe.hx + 0.5) : east0;
    const sideWest1 = side === 'S' && pipe ? Math.min(west1, pipe.x - pipe.hx - 0.5) : west1;
    for (const p of [...rank(D, a, side, west0, sideWest1, order, 4, 0.5), ...rank(D, a, side, sideEast, east, order, 4, 0.5)]) {
      if (p.kind === 'bunkerMainframe') S.mainframes++; else S.racks++;
    }
  }
  // 3) the operators' console desks: two rows of two either side of the painted aisle, west of the crossing, facing the screen wall
  //    across the hall (the operator sits on the west side; the CRT on the desk faces him)
  for (const sz of [-1, 1]) for (const dxm of [ax0 - 5.0, ax0 - 2.4]) {
    const z = r3(zc + sz * 2.25), x = Math.round(dxm * 4) / 4;
    const desk = tryPlaceProp(D.ctx, a, 'desk', x, z, -Math.PI / 2);
    if (!desk) { F5_REFUSED['nave desk'] = (F5_REFUSED['nave desk'] ?? 0) + 1; continue; }
    S.consoles++;
    HOSTED.push(desk);
    tryPlaceProp(D.ctx, a, 'officeSwivelChair', r3(x - PROP_DEFS.desk.d / 2 - 0.4), z, Math.PI / 2, {laneOk: true});
  }
  // 4) the architecture of the tall hall: steel pilasters climbing the long walls to the ceiling between the banks, a steel band at
  //    the storey-4 slab line, cable trays across the hall at 6 m, a painted aisle from the portal to the cluster
  const rel = a.ceil - D.base;
  for (let x = x0 + 3.0; x < x1 - 1.0; x += 5.0) for (const side of ['N', 'S'] as Side[]) {
    if (pipe && side === 'S' && Math.abs(x - pipe.x) < pipe.hx + 0.6) continue;
    D.decor('steelDark', wallBox(a, side, x - 0.22, x + 0.22, 0, 0.22), 2.3, rel - 0.02);
  }
  for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
    const [lo, hi] = wallRange(a, side);
    D.decor('steelDark', wallBox(a, side, lo, hi, 0, 0.12), 6.75, 7.0);
  }
  for (let x = x0 + 2; x < x1 - 1.5; x += 4) {
    D.decor('grille', {x0: x - 0.3, x1: x + 0.3, z0: z0 + 0.05, z1: z1 - 0.05}, 6.0, 6.08);
    D.decor('steelDark', {x0: x - 0.32, x1: x + 0.32, z0: z0 + 0.05, z1: z1 - 0.05}, 5.98, 6.0);
  }
  const ae = core ? core.x - core.hx - 3.1 : x1 - 1;
  D.decor('plasticSeat', {x0: x0 + 0.1, x1: ae, z0: zc - 1.55, z1: zc - 1.45}, 0, 0.008);
  D.decor('plasticSeat', {x0: x0 + 0.1, x1: ae, z0: zc + 1.45, z1: zc + 1.55}, 0, 0.008);
  // 5) the STATUS BOARD over the cluster: a 7 x 3 m black board in a steel frame on the east wall (the landmark that ends the axis,
  //    seen from the portal and from storey 4's catwalk), rows of indicator lamps (a few dead), an amber band, the board's name
  if (core) {
    const bz0 = core.z - 3.5, bz1 = core.z + 3.5, by0 = 4.4, by1 = 7.4;
    const fb = (t0: number, t1: number, o0: number, o1: number) => wallBox(a, 'E', t0, t1, o0, o1);
    D.decor('black', fb(bz0, bz1, 0, 0.06), by0, by1);
    for (const [t0, t1, y0, y1] of [[bz0 - 0.15, bz1 + 0.15, by0 - 0.15, by0], [bz0 - 0.15, bz1 + 0.15, by1, by1 + 0.15], [bz0 - 0.15, bz0, by0, by1], [bz1, bz1 + 0.15, by0, by1]] as const) {
      D.decor('steelDark', fb(t0, t1, 0, 0.1), y0, y1);
    }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      if ((r * 7 + c * 3) % 5 === 0) continue;
      const t = bz0 + 0.7 + c * 1.12, y = by0 + 0.55 + r * 0.6;
      D.decor(r === 3 ? 'plasticSeat' : 'accent', fb(t - 0.09, t + 0.09, 0.06, 0.08), y - 0.09, y + 0.09);
    }
    D.decor('plasticSeat', fb(bz0, bz1, 0.06, 0.075), by1 - 0.42, by1 - 0.36);
    wallSign(D, a, 'E', core.z, by1 + 0.6, {kind: 'service', text: 'CENTRAL PROCESSING CORE', w: 3.6});
    light(D, a, core.x - core.hx - 4.0, core.z, 8.6, Math.PI / 2, false, 0.8);
  }
  // 6) the light: two more rows of pendants over the ranks (the dresser hung one down the middle)
  for (let x = x0 + 3; x < x1 - 2; x += 4.5) for (const z of [z0 + 2.2, z1 - 2.2]) light(D, a, x, z, 5.4, 0, false, 0.9);
  // 7) the hall's name over the portal
  wallSign(D, a, 'W', zc, 4.2, {kind: 'service', text: 'CENTRAL PROCESSING · LEVEL 5', w: 3.2});
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
  // the freight walkway on the axis (the plant's west side, door to door): painted edges; the machinery stands east of it
  const ax0 = a.x * CELL, z0 = a.y * CELL, z1 = (a.y + a.h) * CELL;
  const nd = D.doors(a).find(d => doorSide(d, a) === 'N' && d.w > 1);
  const wx0 = nd ? nd.x * CELL : ax0 + 0.5, wx1 = nd ? (nd.x + nd.w) * CELL : ax0 + 3.5;
  for (const x of [wx0 - 0.1, wx1]) D.decor('plasticSeat', {x0: x, x1: x + 0.1, z0: z0 + 0.1, z1: z1 - 0.1}, 0, 0.008);
  // two columns of coolant pumps on their skids (islands, cell-aligned: a skid's 1.36 m covers three whole cells, its 3.5 m seven)
  const pumps: PropPlacement[] = [];
  const cols = [wx1 + 3.25, wx1 + 6.25].map(x => (Math.floor(x / CELL) + 0.5) * CELL);
  for (const x of cols) for (const f of [0.3, 0.72]) {
    const z = Math.round((z0 + (z1 - z0) * f - 0.25) * 2) / 2 + 0.25;
    const p = tryPlaceProp(D.ctx, a, 'bunkerCoolantPump', r3(x), r3(z), Math.PI / 2, {ring: 0.7});
    if (p && sealOrDrop(D, a, p)) { S.pumps++; pumps.push(p); }
  }
  // the overhead coolant headers: two pipes on a rack down the plant over the walkway's edge, a drop to every pump, hangers
  const hx = wx1 + 1.2, yh = Math.min(rel - 0.9, 4.9);
  for (const [o, m] of [[0, 'steelBright'], [0.45, 'plasticSeat']] as const) D.decor(m, {x0: hx + o, x1: hx + o + 0.28, z0: z0 + 0.3, z1: z1 - 0.3}, yh, yh + 0.28);
  for (let z = z0 + 1.5; z < z1 - 1; z += 3) D.decor('steelDark', {x0: hx - 0.1, x1: hx + 0.85, z0: z, z1: z + 0.08}, yh - 0.08, rel);
  for (const p of pumps) {
    D.decor('steelBright', {x0: hx + 0.28, x1: p.x, z0: p.z - 1.3, z1: p.z - 1.05}, yh + 0.02, yh + 0.26);
    D.decor('steelBright', {x0: p.x - 0.12, x1: p.x + 0.12, z0: p.z - 1.3, z1: p.z - 1.05}, PROP_DEFS.bunkerCoolantPump.h - 0.3, yh + 0.26);
  }
  // air handlers: CRAC units along the north wall, air filtration on the south
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'cracUnit', {sides: ['N'], front: 1.0, tries: 16});
  for (let i = 0; i < 2; i++) if (!scanWall(D, a, 'airFilterUnit', ['S', 'E'], 1.0, (a.x + a.w * 0.75) * CELL)) break;
  ceilingDuct(D, a, 'E', 0.62);
  // a row of fixtures over the pumps (the dresser hung one down the middle)
  for (const f of [0.2, 0.5, 0.8]) light(D, a, (cols[0] + cols[1]) / 2, z0 + (z1 - z0) * f, Math.min(rel - 0.1, 4.5), Math.PI / 2, false, 0.85);
}

function dressBay(D: Dx, a: Area, lift: {x: number; y: number; w: number; h: number}): void {
  // the loading bay: hazard stripes round the lift apron (floor finish), crate stacks, a pallet, a tool chest, a work light
  const bx0 = lift.x * CELL, bx1 = (lift.x + lift.w) * CELL, bz0 = lift.y * CELL, bz1 = (lift.y + lift.h) * CELL;
  for (const b of [{x0: bx0, x1: bx1, z0: bz0, z1: bz0 + 0.15}, {x0: bx0, x1: bx0 + 0.15, z0: bz0, z1: bz1}, {x0: bx1 - 0.15, x1: bx1, z0: bz0, z1: bz1}]) D.decor('plasticSeat', b, 0, 0.008);
  for (let x = bx0 + 0.4; x < bx1 - 0.3; x += 0.8) D.decor('black', {x0: x, x1: x + 0.3, z0: bz0 + 0.01, z1: bz0 + 0.14}, 0.008, 0.01);
  wallSign(D, a, 'S', (bx0 + bx1) / 2, 3.45, {kind: 'service', text: 'CARGO LIFT · LEVEL 5', w: 2.4});
  // (the freight lobby is a hall with no loot purpose of its own: what waits here is consignments — carton stacks and pallets, not
  // loot holders; the storey's finds sit in its programme rooms)
  const far: Side[] = ['N', 'E'];
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'cartonStack', {sides: far, tries: 16});
  placeAgainstWall(D.ctx, a, 'parcelPallet', {sides: far, tries: 16});
  placeAgainstWall(D.ctx, a, 'handTruck', {sides: ['N'], tries: 16});
  placeAgainstWall(D.ctx, a, 'tripodWorkLight', {sides: ['N', 'E'], tries: 12});
}

function dressLibrary(D: Dx, a: Area): void {
  // back-to-back shelving stacks running north-south, 1.2 m aisles between them; archive boxes / filing cabinets on the walls
  const sh = PROP_DEFS.shelf;
  const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL, z0 = a.y * CELL + 1.4, z1 = (a.y + a.h) * CELL - 1.6;
  const pitch = 2 * sh.d + 1.6;
  let n = 0;
  for (let x = x0 + 2.0; x + sh.d <= x1 - 1.6 && n < 6; x += pitch) {
    for (let z = z0 + sh.w / 2; z + sh.w / 2 <= z1 && n < 6; z += sh.w + 0.02) {
      for (const sg of [-1, 1]) {
        const p = tryPlaceProp(D.ctx, a, 'shelf', r3(x + sg * (sh.d / 2 + 0.01)), r3(z), sg < 0 ? -Math.PI / 2 : Math.PI / 2, {laneOk: true});
        if (p) n++;
      }
    }
  }
  const desk = scanWall(D, a, 'desk', ['W', 'N', 'S'], 0.8);
  if (desk) HOSTED.push(desk);
}

/**
 * The storey's STORAGE (lead follow-up after the integration: version 2 must not quietly cut version 1's loot) — real, openable
 * holders where the programme keeps things, never food: the tape library's archive boxes, lateral files and filing cabinets; the
 * switch room's spares cabinets and tool chest; the control room's operator desks (CRT on top), log filing cabinet and data cabinet;
 * the cooling plant's spares cabinets and tool chest; the battery room's spares cabinet; the operators' lockers in the bunk room and
 * the commons. Each placed deterministically along the room's walls (scanWall: every 0.25 m, access strips and connectivity kept).
 */
function stock(D: Dx, A: (k: string) => Area | undefined): number {
  let n = 0;
  const put = (key: string, kind: PropKind, count: number, sides: readonly Side[], front: number, prefer?: (a: Area) => number): void => {
    const a = A(key);
    if (!a) return;
    for (let i = 0; i < count; i++) {
      const p = scanWall(D, a, kind, sides, front, prefer?.(a), true);
      if (!p) break;
      n++;
      if (kind === 'desk') HOSTED.push(p);
    }
  };
  const lo = (a: Area, s: 'x' | 'y') => (s === 'x' ? a.x : a.y) * CELL + 0.5;
  put('library', 'archiveBoxes', 4, ['N', 'S', 'W'], 0.6);
  put('library', 'officeFiling', 1, ['S', 'N', 'W'], 0.8);
  put('library', 'filingCabinet', 2, ['N', 'S', 'W'], 0.8);
  put('switch', 'cabinetTall', 2, ['W', 'N', 'S', 'E'], 0.8);
  put('switch', 'rollingToolChest', 1, ['W', 'S', 'N', 'E'], 0.8);
  put('control', 'desk', 2, ['S', 'E', 'N'], 0.9, a => lo(a, 'x') + a.w * CELL * 0.7);
  put('control', 'filingCabinet', 1, ['E', 'N', 'S'], 0.8);
  put('control', 'serverCabinet', 1, ['N', 'E', 'S'], 0.8);
  put('cooling', 'cabinetTall', 2, ['S', 'W', 'N'], 0.8);
  put('cooling', 'rollingToolChest', 1, ['W', 'S', 'N'], 0.8);
  put('battery', 'cabinetTall', 1, ['E', 'N', 'S'], 0.8);
  put('bunks', 'staffLockers', 2, ['E', 'W', 'N', 'S'], 1.0);
  put('commons', 'staffLockers', 2, ['E', 'N', 'S'], 1.0);
  return n;
}

function dressCommons(D: Dx, a: Area): void {
  const S = F5_DRESS_STATS;
  const rel = a.ceil - D.base;
  // THE GARDEN COURT: four planter trees at the corners of a 4 x 3.5 m court, two benches facing each other inside it, a warm
  // grow lamp low over it — the night shift's patch of green, 35 m underground. Tried round the room's middle (the dresser's table
  // and stock may hold a spot); all four planters or nothing (one transaction).
  const mx = (a.x + a.w / 2) * CELL, mz = (a.y + a.h / 2) * CELL;
  const pd = PROP_DEFS.planterTree, bd = PROP_DEFS.bench;
  const centres: [number, number][] = [];
  for (const dz of [0, -1, 1, -2, 2, -3, 3]) for (const dx of [0, -1, 1, -2, 2, -3, 3]) centres.push([Math.round(mx + dx) , Math.round(mz + dz)]);
  for (const [cx, cz] of centres) {
    begin(D.ctx);
    const hw = 2.0 - pd.w / 2, hd = 1.75 - pd.d / 2;
    let ok = 0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) if (tryPlaceProp(D.ctx, a, 'planterTree', r3(cx + sx * hw), r3(cz + sz * hd), 0)) ok++;
    if (ok < 4) { rollback(D.ctx); continue; }
    for (const sz of [-1, 1]) tryPlaceProp(D.ctx, a, 'bench', r3(cx), r3(cz + sz * (1.75 - bd.d / 2 - 0.15)), sz < 0 ? 0 : Math.PI, {laneOk: true});
    commit(D.ctx);
    S.planters += 4;
    light(D, a, cx, cz, Math.min(rel - 0.1, 3.2), 0, true, 0.9);
    D.decor('woodVeneer', {x0: cx - 2.1, x1: cx + 2.1, z0: cz - 1.85, z1: cz + 1.85}, 0, 0.012);
    break;
  }
  // a lounge corner (armchairs) and two mess tables with folding chairs, the ping-pong table
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'loungeArmchair', {sides: ['E', 'N'], front: 0.6, tries: 16});
  const tbl = PROP_DEFS.table, ch = PROP_DEFS.foldingChair;
  const cx = (a.x + a.w * 0.62) * CELL, cz = (a.y + a.h * 0.42) * CELL;
  let tables = 0;
  for (const [ox, oz] of [[0, 0], [0, 3.2], [-3.0, 0], [-3.0, 3.2], [3.0, 0]] as const) {
    if (tables >= 1) break;
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

/** The cable way behind the core: cable trays down both walls just over head height, isolator switches, a line of lamps. */
function dressCableway(D: Dx, a: Area): void {
  const rel = a.ceil - D.base, alongZ = a.h >= a.w;
  const sides: Side[] = alongZ ? ['W', 'E'] : ['N', 'S'];
  const [lo, hi] = wallRange(a, sides[0]);
  for (const sd of sides) for (const [y, deep] of [[rel - 0.62, 0.32], [rel - 0.3, 0.22]] as const) {
    D.decor('grille', wallBox(a, sd, lo + 0.2, hi - 0.2, 0.04, deep), y, y + 0.04);
    D.decor('black', wallBox(a, sd, lo + 0.2, hi - 0.2, 0.06, deep - 0.04), y + 0.04, y + 0.12);
  }
  mountOn(D, a, [sides[1]], 'disconnectSwitch', 1.2, 2);
  for (let t = lo + 1.5; t < hi - 1; t += 4) light(D, a, alongZ ? (a.x + a.w / 2) * CELL : t, alongZ ? t : (a.y + a.h / 2) * CELL, rel - 0.02, alongZ ? Math.PI / 2 : 0, false, 0.7);
}

/** The UPS battery room: a free-standing string of battery cabinets (back-to-back panel pairs down the room's middle). */
function dressBattery(D: Dx, a: Area): void {
  const pd = PROP_DEFS.electricalPanel, alongX = a.w >= a.h;
  // (cell boundaries: the backs meet on one, the pair's ends on others — no two cabinets share a grid cell)
  const cx = Math.round(a.x + a.w / 2) * CELL, cz = Math.round(a.y + a.h / 2) * CELL;
  begin(D.ctx);
  let n = 0;
  for (const s of [-0.6, 0.6]) for (const sg of [-1, 1]) {
    const off = sg * (pd.d / 2 + 0.005), t = (alongX ? cx : cz) + s;
    const x = alongX ? t : cx + off, z = alongX ? cz + off : t;
    if (tryPlaceProp(D.ctx, a, 'electricalPanel', r3(x), r3(z), alongX ? (sg < 0 ? Math.PI : 0) : (sg < 0 ? -Math.PI / 2 : Math.PI / 2), {front: 0.8, laneOk: true})) n++;
  }
  if (n < 4) rollback(D.ctx); else commit(D.ctx);
}

/** The operators' gallery: benches along the north wall between its doors (the shift change), a rota board, plants, extinguishers. */
function dressGallery(D: Dx, a: Area): void {
  const rel = a.ceil - D.base;
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'bench', {sides: ['N'], front: 0.6, tries: 20});
  placeAgainstWall(D.ctx, a, 'noticeBoard', {sides: ['N', 'S'], y: 1.1, tries: 16});
  mountOn(D, a, ['S', 'N'], 'fireExtinguisherCabinet', 0.6, 1);
  placeAgainstWall(D.ctx, a, 'pottedPlantSmall', {sides: ['N', 'S'], tries: 12});
  ceilingDuct(D, a, 'S', 0.45);
  for (let x = a.x * CELL + 2.5; x < (a.x + a.w) * CELL - 2; x += 5) light(D, a, x, (a.y + a.h / 2) * CELL, rel - 0.05, 0, true, 0.85);
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function dressFloor5(ctx: FloorDressCtx): void {
  const S = F5_DRESS_STATS;
  S.mainframes = S.racks = S.consoles = S.pumps = S.planters = S.lights = S.stocked = 0;
  S.skipped = [];
  HOSTED.length = 0;
  for (const k of Object.keys(F5_REFUSED)) delete F5_REFUSED[k];
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
  step('storage', () => { S.stocked = stock(D, A); });
  if (gallery) step('gallery', () => dressGallery(D, gallery));
  const cableway = A('cableway');
  if (cableway) step('cableway', () => dressCableway(D, cableway));
  const battery = A('battery');
  if (battery) step('battery', () => dressBattery(D, battery));
  // plates in the shelter's words
  step('plates', () => {
    const P: [string, string, string][] = [
      ['nave', 'gallery', 'PROCESSING HALL'], ['nave', 'narthex', 'PROCESSING HALL · CLEAN AREA'], ['narthex', 'gallery', 'PROCESSING HALL · CLEAN ROOM'],
      ['control', 'gallery', 'CORE CONTROL'], ['control', 'cooling', 'CORE CONTROL'], ['cooling', 'bay', 'COOLING PLANT'], ['chiller', 'cooling', 'CHILLER ROOM · DANGER'],
      ['switch', 'gallery', 'SWITCH ROOM · DANGER'], ['library', 'bay', 'TAPE LIBRARY'], ['commons', 'bay', 'OPERATORS\' COMMONS'], ['bunks', 'commons', 'BUNK ROOM · NIGHT SHIFT'],
      ['wash', 'commons', 'WASHROOM'], ['cableway', 'gallery', 'CABLE WAY · CORE SUPPLY'], ['battery', 'cableway', 'UPS BATTERIES · DANGER'],
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
    // the arrival: facing the main stair's door across the gallery, the storey's name beside the clean-room lobby's door
    const narthex = A('narthex');
    if (gallery && narthex) {
      const nd = doorBetween(D, gallery, narthex);
      if (nd) wallSign(D, gallery, 'S', (nd.x + nd.w) * CELL + 1.8, 2.25, {kind: 'service', text: 'CENTRAL PROCESSING CORE', w: 2.6});
    }
  });
  // the guarantee: no floor pocket on the storey (a prop of this pass that closes one off goes again); then the desk terminals
  sweepPockets(D, mine, p0);
  hostTerminals(D);
  S.props = layout.props.length - p0; S.decor = layout.decor.length - d0; S.signs = layout.signs.length - s0;
}
