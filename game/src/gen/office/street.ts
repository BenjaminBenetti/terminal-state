// Iteration 16 (WORLD-GEN) / seamless (GEN): the station + lobby part of the ONE office layout — a COMPACT subway stop (same Kit /
// archetype pieces / dressers / storefronts as gen/station.ts, about one sixth of the base Subway's walkable area) on level 0 whose
// level 1 storey is the office tower's LOBBY, joined by a real stair run (one Ramp per flight carved into both level grids, the
// iteration-08 stair-core pattern: lobby → run → landing). Office floors 2..8 and the scissor stair are carved into the same kit
// afterwards (gen/office/index.ts); the crop happens once for every storey there.
//
// Main level (y 0), south of the tower footprint (tower-local rows >= TD): an island platform between two one-track beds, an end
// passage through the tunnel walls to a paid concourse, a fare line into the ticket hall, washrooms, the station agent office, a
// sealed street exit, kiosk storefronts, a utility room and a closet; the tower connection (see TRANSIT HALL below).
// Upper level (the lobby, y = hu): the main hall (reception, waiting area, boarded street entrance on the north facade), the
// core (the solid elevator shaft, the scissor stair's lobby landing, washrooms, closets), the building security office, the
// east wing and the transit concourse in front of the escalator mouth.
// Pure data: carving only (gen/office/index.ts crops, dresses, spawns, lights and validates).
//
// TRANSIT HALL (task office-overhaul-20261030, lane STRUCT; replaces the single 2 m stair core): a broad public-transit
// connection sized for crowds — a fixed stair 4.5-5 m wide flanked by two (stopped: the power is out) escalators, side by side on
// ONE shared 30 degree pitch line (gen/traversal.ts transitSpecs: each lane its own straight layStairRun, so the lanes meet with no
// wall or drop and the glass balustrades between them are railings). The run rises NORTH from the ticket hall — its bottom mouth
// is the full lane width (7.5-8 m) of the ticket hall's north wall — under the street and the lobby floor (level 0 only while its
// ceiling, following the pitch, stays a slab below the lobby) into a walled BOX in the lobby's south band (the run's top rows,
// carved into both grids: the stair hand-over), whose open north end (7.5-8 m) is the arrival onto the lobby's transit concourse.

import type {Rng} from '../../core/rng';
import {Kit} from '../stationKit';
import {CELL, FLOOR} from '../grid';
import {carveStorefronts} from '../storefronts';
import {SLAB} from '../levelGen';
import {TRANSIT, layStairRun, transitSpecs} from '../traversal';
import {DOOR_HEIGHT, type Area, type Door, type Rect, type Side, type Storefront} from '../stationTypes';
import {CEIL, type TowerFrame} from './frame';
import {TOWER_CANVAS} from './common';
import {carveCore, type CarvedTower, type OfficeAreaMeta, type TowerAt} from './tower';

const STREETS = ['Hollis', 'Wexford', 'Garnet', 'Linden', 'Carver', 'Dorset', 'Marlowe', 'Ashby', 'Kessler', 'Fulton', 'Bramley', 'Ostend', 'Pruitt', 'Calder', 'Halsey', 'Juniper', 'Rowan', 'Tilden'];
const SUFFIX = ['Street', 'Avenue', 'Square', 'Plaza', 'Centre', 'Place'];
const TERMINALS = ['Northgate', 'Harbourfront', 'Elm Park', 'Union Yards', 'Kingsway', 'Lakeshore', 'Bayview', 'Westmount', 'Riverdale', 'Cedar Hill', 'Port Ellis', 'Midtown'];
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Task office-overhaul-20261030 (lane STRUCT): one lane of the transit run (tower-local columns [x0, x1); kit.flights ids). */
export interface TransitLane { kind: 'escalator' | 'stair'; x0: number; x1: number; flights: number[] }
/** Task office-overhaul-20261030 (lane STRUCT): the transit hall's run (tower-local cells: x0..x1 lanes, rows y0..y0 + len). */
export interface TransitCarve {
  /** The run area (level 0; its top `box` rows are carved into the lobby grid too). */
  run: Area;
  lanes: TransitLane[];
  x0: number; x1: number; y0: number; len: number;
  /** Rows of the run (from y0) open on the lobby grid: the walled box in the lobby's south band. */
  box: number;
  /** Flat top landing (m) before the flights begin; pitch (rise per metre). */
  lead: number; slope: number;
  /** The bottom mouth (the full-width opening in the ticket hall's north wall). */
  mouth: Door;
}

export interface StreetCarve {
  kit: Kit;
  name: string;
  towards: [string, string];
  hu: number;
  tower: CarvedTower;
  storefronts: Storefront[];
  platform: Area;
  /** Task office-overhaul-20261030 (lane STRUCT): the transit hall run (station <-> lobby). */
  hallRun: TransitCarve;
  /** Lobby concourse pockets beside the escalator box (west / east; null when absent). */
  pockets: (Area | null)[];
  ticketHall: Area; paidHall: Area;
  /** Lobby halls (upper level). */
  hall: Area; transit: Area; security: Area; east: Area;
  /** Street entrance span (tower-local cells on the north facade). */
  entrance: {x0: number; x1: number};
}

/** Why the last attempts failed (QA / tests). */
export const STREET_FAILS: Record<string, number> = {};
const fail = (why: string): null => { STREET_FAILS[why] = (STREET_FAILS[why] ?? 0) + 1; return null; };

/**
 * One carving attempt into a FRESH kit (levels 0 = station, 1 = lobby); null when the program does not fit (the caller drops the
 * kit and retries with another seed).
 */
export function carveStreet(k: Kit, rng: Rng, f: TowerFrame): StreetCarve | null {
  const TX = TOWER_CANVAS.x, TY = TOWER_CANVAS.y;
  const {TW, TD, cx0, cx1, cy0, cy1} = f;
  const name = `${rng.pick(STREETS)} ${rng.pick(SUFFIX)}`;
  const terms = rng.shuffle(TERMINALS.slice());
  // Lobby height (street level above the platforms): every station ceiling stays a slab below it.
  const hu = r2(rng.range(5.4, 5.9));
  const at: TowerAt = {ox: TX, oy: TY, level: 1, base: hu};
  const up = {level: 1, floorY: hu};
  const meta = new Map<number, OfficeAreaMeta>();

  // --- Transit hall geometry (tower-local): lanes [escalator 3][fixed stair 9-10][escalator 3] between 1-cell walls --------------
  const spec = transitSpecs(hu);
  const rl = spec.cells, lead = r2(rl * CELL - spec.length);
  // Rows of the run whose ceiling (pitch + headroom, max over the cell) is not yet a slab below the lobby floor: the box.
  const box = Math.ceil(2 * (lead + (TRANSIT.headroom + SLAB) / spec.slope) - 1e-9);
  const SW = rng.int(9, 10), EW = 3, LW = EW + SW + EW;
  const ry0 = TD - box;
  if (ry0 - (cy1 + 1) < 6) return fail('transit-box-deep');
  const bxLo = Math.max(7, cx0 - 8), bxHi = Math.min(TW - 7 - LW, cx1 + 8 - LW);
  if (bxHi < bxLo) return fail('transit-box-wide');
  const bx0 = rng.int(bxLo, bxHi), bx1 = bx0 + LW;

  // --- Lobby (upper level) -----------------------------------------------------------------------------------------------
  const lobbyArea = (r: Rect, label: string, purpose: string, parent: number, role: OfficeAreaMeta['role'], facade: OfficeAreaMeta['facade']) => {
    const a = k.addArea({x: TX + r.x, y: TY + r.y, w: r.w, h: r.h}, 'room', 'office-lobby', r2(hu + CEIL.lobby), parent, {...up, label, publicSpace: true});
    a.purpose = purpose;
    meta.set(a.id, {role, facade});
    return a;
  };
  const hall = lobbyArea({x: 0, y: 0, w: TW, h: cy0 - 1}, 'Lobby', 'office-reception', -1, 'reception', ['N', 'W', 'E']);
  // The transit concourse: the full-width strip in front of the escalator box (the arrival) + pockets beside the box.
  const transit = lobbyArea({x: 0, y: cy1 + 1, w: TW, h: ry0 - (cy1 + 1)}, 'Transit concourse', 'office-lobby', hall.id, 'transit', ['W', 'E']);
  const core = carveCore(k, f, at, 1, hall, transit, meta);
  const security = k.addArea({x: TX, y: TY + cy0, w: cx0 - 1, h: cy1 - cy0}, 'room', 'office-room', r2(hu + CEIL.office), hall.id, {...up, label: 'Building security office', publicSpace: false});
  security.purpose = 'office-security';
  meta.set(security.id, {role: 'security', facade: ['W']});
  if (!k.connect(security, hall, 3, CEIL.door, {arch: false, margin: 2})) return fail('security-door');
  const east = lobbyArea({x: cx1 + 1, y: cy0 - 1, w: TW - cx1 - 1, h: cy1 - cy0 + 2}, 'Lobby', 'office-lobby', hall.id, 'lobby', ['E']);
  void east;
  // Pockets of the transit concourse beside the escalator box (touch the concourse strip directly: one open floor).
  const pockets: (Area | null)[] = [
    bx0 - 1 >= 4 ? lobbyArea({x: 0, y: ry0, w: bx0 - 1, h: TD - ry0}, 'Transit concourse', 'office-lobby', transit.id, 'transit', ['W', 'S']) : null,
    TW - bx1 - 1 >= 4 ? lobbyArea({x: bx1 + 1, y: ry0, w: TW - bx1 - 1, h: TD - ry0}, 'Transit concourse', 'office-lobby', transit.id, 'transit', ['E', 'S']) : null,
  ];

  // --- Station hall under the street, south of the tower: the ticket hall first; the transit run opens off its north wall ----
  const thw = rng.int(28, 36), thd = rng.int(24, 30);
  const thLo = Math.max(0, bx1 + 3 - thw), thHi = bx0 - 3;
  if (thHi < thLo) return fail('ticket-hall-width');
  const thx = rng.int(thLo, thHi);
  const T: Rect = {x: TX + thx, y: TY + ry0 + rl + 1, w: thw, h: thd};
  if (!k.rectFree(T)) return fail('ticket-hall');
  const ticket = k.addArea(T, 'concourse', 'fare-hall', r1(rng.range(4.0, 4.6)), -1, {role: 'ticket-hall', label: 'Ticket hall'});

  // --- Transit run: one area on the station grid, its top rows (the box) also open on the lobby grid; three shared-pitch lanes --
  const runR: Rect = {x: TX + bx0, y: TY + ry0, w: LW, h: rl};
  if (!k.solid({x: runR.x - 1, y: runR.y - 1, w: runR.w + 2, h: runR.h + 1})) return fail('transit-run');
  const run = k.addArea(runR, 'passage', 'stair-core', TRANSIT.headroom, ticket.id, {role: 'stair', label: 'Escalators · Office tower', publicSpace: true});
  const g0 = k.grid(0), g1 = k.grid(1);
  for (let y = runR.y; y < runR.y + box; y++) for (let x = runR.x; x < runR.x + runR.w; x++) { const i = g1.idx(x, y); g1.cells[i] = FLOOR; g1.area[i] = run.id; }
  const lanes: TransitLane[] = [
    {kind: 'escalator', x0: bx0, x1: bx0 + EW, flights: []},
    {kind: 'stair', x0: bx0 + EW, x1: bx0 + EW + SW, flights: []},
    {kind: 'escalator', x0: bx0 + EW + SW, x1: bx1, flights: []},
  ];
  for (const ln of lanes) {
    const r: Rect = {x: TX + ln.x0, y: runR.y, w: ln.x1 - ln.x0, h: rl};
    const cls = ln.kind === 'stair' ? 'transit' as const : 'escalator' as const;
    for (const fl of layStairRun([g0, g1], r, run.id, 'z', 'lo', hu, 0, ln.kind === 'stair' ? spec.stair : spec.escalator)) {
      fl.id = k.flights.length; fl.spec = cls; ln.flights.push(fl.id); k.flights.push(fl);
    }
  }
  // Below the box the run is on the station grid only: clear what layStairRun stamped into the (solid) lobby cells there, and
  // check the run's ceiling really is a slab below the lobby floor from the box down (else the lobby floor would cut into it).
  for (let y = runR.y; y < runR.y + rl; y++) for (let x = runR.x; x < runR.x + runR.w; x++) {
    const i = g1.idx(x, y);
    if (y >= runR.y + box) { g1.rampIdx[i] = -1; g1.floor[i] = 0; g1.ceil[i] = 0; if (g0.ceil[i] > hu - SLAB + 1e-6) return fail('transit-slab'); }
  }
  const mouth = k.carveDoor({x: runR.x, y: runR.y + rl, w: LW, h: 1}, ticket, run, 3.0, true);

  // --- Paid concourse east of the ticket hall, fare line in the shared wall ---------------------------------------------------
  const mw = rng.int(16, 22), mh = rng.int(30, 38);
  const M: Rect = {x: T.x + T.w + 1, y: T.y + rng.int(0, 3), w: mw, h: mh};
  if (!k.rectFree(M)) return fail('paid-concourse');
  const paid = k.addArea(M, 'concourse', 'concourse', r1(rng.range(3.9, 4.4)), ticket.id, {paid: true, role: 'end-hall', label: 'Paid concourse'});
  if (!k.fareLine(paid, ticket, rng.int(4, 5))) return fail('fare-line');

  // --- Island platform east of it, reached through an end passage between the tunnel walls ------------------------------------
  const beyond = rng.int(3, 6);
  const len = 12 + beyond;
  const Lp = rng.int(84, 104);
  const px0 = M.x + M.w + 2 + len;
  const y0 = M.y + Math.floor(mh / 2) - 9 - 11;
  if (!k.rectFree({x: px0 - 12, y: y0, w: Lp + 24, h: 18 + 26})) return fail('island-block');
  const blk = k.islandBlock(px0, y0, Lp, r1(rng.range(4.2, 4.6)), 'Platforms 1 · 2');
  const I = blk.platforms[0];
  I.platformNo = 1; I.towardsN = terms[0]; I.towardsS = terms[1];
  const EP = k.endPassage(blk, I, 'W', beyond, rng.int(10, 12));
  if (!EP || !k.connect(EP, paid, EP.h - 2, 3.2, {pick: 'mid'})) return fail('end-passage');

  // The ticket hall's west wall takes rooms only when it stands far enough east of the tower's west facade.
  const westOk = T.x - TX >= 16;
  const sidesOf = (host: Area, list: Side[]) => list.filter(q => host !== ticket || q !== 'W' || westOk);
  const attachRoom = (host: Area | null, sides: Side[], w: number, h: number, type: Area['type'], ceil: number, doorW: number, kind: 'room' | 'closet' = 'room'): Area | null => {
    if (!host) return null;
    for (const side of rng.shuffle(sidesOf(host, sides))) {
      const wallLen = side === 'N' || side === 'S' ? host.w : host.h;
      if (wallLen < w + 6) continue;
      for (let t = 0; t < 6; t++) {
        const off = rng.int(-Math.floor((wallLen - w) / 2) + 2, Math.floor((wallLen - w) / 2) - 2);
        const a = k.attach(host, side, w, h, off, kind, type, ceil, host.id, {}, false);
        if (!a) continue;
        if (a.x < TX || a.y < TY + TD || !k.connect(host, a, doorW, DOOR_HEIGHT, {arch: false, extra: {staff: true}})) { k.undoLast(a); continue; }
        return a;
      }
    }
    return null;
  };

  // --- Back-of-house: the station agent office, a utility / storage room and a closet --------------------------------------------
  const agent = attachRoom(paid, ['S'], rng.int(10, 12), rng.int(10, 12), 'agent-office', 2.8, 3) ?? attachRoom(ticket, ['S', 'W'], rng.int(10, 12), rng.int(10, 12), 'agent-office', 2.8, 3);
  if (!agent) return fail('agent');
  const utilType = rng.chance(0.5) ? 'utility' : 'storage';
  const util = attachRoom(agent, ['S', 'E', 'W'], rng.int(10, 13), rng.int(9, 12), utilType, 3.0, 3) ?? attachRoom(paid, ['S'], rng.int(9, 12), rng.int(9, 12), utilType, 3.0, 3);
  const closetType = rng.chance(0.5) ? 'supply-closet' : 'janitor-closet';
  if (!attachRoom(util, ['E', 'W', 'S'], rng.int(5, 7), rng.int(5, 7), closetType, 2.6, 2, 'closet')) attachRoom(agent, ['E', 'W', 'S'], rng.int(5, 7), rng.int(5, 7), closetType, 2.6, 2, 'closet');

  // --- Washrooms (men's / women's) off the ticket hall (else the paid concourse) ---------------------------------------------------
  {
    let ok = false;
    const hosts: [Area, Side][] = rng.shuffle(sidesOf(ticket, ['S', 'W']).map(q => [ticket, q] as [Area, Side]));
    hosts.push([paid, 'S']);
    for (const [H, side] of hosts) {
      if (ok) break;
      const ww = rng.int(9, 11), wh = rng.int(11, 13);
      const along = ww * 2 + 1;
      const wallLen = side === 'S' ? H.w : H.h;
      if (wallLen < along + 4) continue;
      for (let t = 0; t < 6 && !ok; t++) {
        const half = Math.max(0, Math.floor((wallLen - along) / 2) - 2);
        const r = k.adjacent(H, side, along, wh, rng.int(-half, half));
        if (r.x < TX || r.y < TY + TD || !k.rectFree(r)) continue;
        const ra: Rect = side === 'S' ? {x: r.x, y: r.y, w: ww, h: wh} : {x: r.x, y: r.y, w: wh, h: ww};
        const rb: Rect = side === 'S' ? {x: r.x + ww + 1, y: r.y, w: ww, h: wh} : {x: r.x, y: r.y + ww + 1, w: wh, h: ww};
        const men = k.addArea(ra, 'room', 'washroom', 2.8, H.id, {label: "Men's washroom", publicSpace: true});
        const women = k.addArea(rb, 'room', 'washroom', 2.8, H.id, {label: "Women's washroom", publicSpace: true});
        if (!k.connect(H, men, 3, DOOR_HEIGHT, {arch: false, pick: 0.85}) || !k.connect(H, women, 3, DOOR_HEIGHT, {arch: false, pick: 0.15})) return fail('washroom-door');
        ok = true;
      }
    }
    if (!ok) return fail('washrooms');
  }
  // --- One sealed street exit (dead-end stair hall with a locked grille) -------------------------------------------------------
  for (const side of rng.shuffle(sidesOf(ticket, ['S', 'W']))) {
    const wallLen = side === 'S' ? T.w : T.h;
    if (wallLen < 14) continue;
    let done = false;
    for (const df of [0, 0.2, -0.2, 0.35, -0.35]) {
      const r = k.adjacent(T, side, 8, 20, Math.round(df * (wallLen - 12)));
      if (r.x < TX || !k.rectFree(r)) continue;
      const a = k.addArea(r, 'passage', 'exit-stair', 5.0, ticket.id);
      const gap: Rect = side === 'S' ? {x: r.x, y: r.y - 1, w: 8, h: 1} : {x: r.x + r.w, y: r.y, w: 1, h: 8};
      k.carveDoor(gap, ticket, a, 3.2, true);
      done = true;
      break;
    }
    if (done) break;
  }

  // --- Kiosk storefronts in the hall walls -----------------------------------------------------------------------------------
  const shops = carveStorefronts(k, [
    {hall: ticket, sides: rng.shuffle(sidesOf(ticket, ['S', 'W'])), mix: 'kiosk', max: rng.int(1, 2)},
    ...(rng.chance(0.5) ? [{hall: paid, sides: ['S'] as Side[], mix: 'kiosk' as const, max: 1}] : []),
  ], new Set<string>(), STREETS);
  // Storefront units / service corridors must stay on the station side (south of the tower, east of its west facade).
  for (const a of k.areas) if (!a.level && a.type !== 'stair-core' && (a.x < TX || a.y < TY + TD)) return fail('outside-station-side');
  // No main-level ceiling may reach the lobby slab.
  for (const a of k.areas) if (!a.level && a.role !== 'stair' && a.ceil > hu - SLAB - 0.05) return fail('ceiling-into-lobby-slab');

  // Street entrance: the north facade, centred on the main hall with a little jitter (boarded scenery).
  const ew = rng.int(6, 8);
  const ec = Math.round(TW / 2 + rng.int(-6, 6));
  const tower: CarvedTower = {at, floor: 1, core, meta, north: hall, south: transit};
  return {
    kit: k, name, towards: [terms[0], terms[1]], hu, tower, storefronts: shops.storefronts, platform: I,
    hallRun: {run, lanes, x0: bx0, x1: bx1, y0: ry0, len: rl, box, lead, slope: spec.slope, mouth}, pockets,
    ticketHall: ticket, paidHall: paid, hall, transit, security, east,
    entrance: {x0: ec - Math.floor(ew / 2), x1: ec - Math.floor(ew / 2) + ew},
  };
}
