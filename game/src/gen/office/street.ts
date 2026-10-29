// Iteration 16 (WORLD-GEN): the 'street' section — a COMPACT subway stop (same Kit / archetype pieces / dressers / storefronts as
// gen/station.ts, about one sixth of the base Subway's walkable area) whose UPPER storey is the office tower's LOBBY, joined by a
// real stair run (one Ramp per flight carved into both level grids, the iteration-08 stair-core pattern: lobby → run → landing).
//
// Main level (y 0), south of the tower footprint (tower-local rows >= TD): an island platform between two one-track beds, an end
// passage through the tunnel walls to a paid concourse, a fare line into the ticket hall, washrooms, the station agent office, a
// sealed street exit, kiosk storefronts, a utility room and a closet; the tower connection: a stair-core lobby off the ticket
// hall's north wall and the run climbing east under the tower's south edge to its top landing in the lobby.
// Upper level (the lobby, y = hu): the main hall (reception, waiting area, boarded street entrance on the north facade), the
// core (elevator, stairwell vestibule with the stair door UP to floor 2, washrooms, closets), the building security office, the
// east wing and the transit concourse with the landing door "to the trains".
// Pure data: carving only (gen/office/index.ts dresses, spawns, lights and validates).

import type {Rng} from '../../core/rng';
import {Kit} from '../stationKit';
import {carveStorefronts} from '../storefronts';
import {CORE, SLAB} from '../levelGen';
import {STAIR, layStairRun, stairRunCells} from '../traversal';
import {DOOR_HEIGHT, type Area, type Rect, type Side, type Storefront} from '../stationTypes';
import {CEIL, MARGIN, type TowerFrame} from './frame';
import {TOWER_CANVAS, cropKit, type Cropped} from './common';
import {carveCore, type CarvedTower, type OfficeAreaMeta, type TowerAt} from './tower';

const STREETS = ['Hollis', 'Wexford', 'Garnet', 'Linden', 'Carver', 'Dorset', 'Marlowe', 'Ashby', 'Kessler', 'Fulton', 'Bramley', 'Ostend', 'Pruitt', 'Calder', 'Halsey', 'Juniper', 'Rowan', 'Tilden'];
const SUFFIX = ['Street', 'Avenue', 'Square', 'Plaza', 'Centre', 'Place'];
const TERMINALS = ['Northgate', 'Harbourfront', 'Elm Park', 'Union Yards', 'Kingsway', 'Lakeshore', 'Bayview', 'Westmount', 'Riverdale', 'Cedar Hill', 'Port Ellis', 'Midtown'];
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface StreetCarve {
  kit: Kit;
  name: string;
  towards: [string, string];
  hu: number;
  tower: CarvedTower;
  storefronts: Storefront[];
  platform: Area;
  /** Station areas (main level) and stair-core ids. */
  coreLobby: Area; run: Area; landing: Area;
  ticketHall: Area; paidHall: Area;
  /** Lobby halls (upper level). */
  hall: Area; transit: Area; security: Area; east: Area;
  /** Street entrance span (tower-local cells on the north facade). */
  entrance: {x0: number; x1: number};
  cropped: Cropped;
}

/** One carving attempt; null when the program does not fit (the caller retries with another seed). */
/** Why the last attempts failed (QA / tests). */
export const STREET_FAILS: Record<string, number> = {};
const fail = (why: string): null => { STREET_FAILS[why] = (STREET_FAILS[why] ?? 0) + 1; return null; };

export function carveStreet(rng: Rng, f: TowerFrame): StreetCarve | null {
  const k = new Kit(rng);
  const TX = TOWER_CANVAS.x, TY = TOWER_CANVAS.y;
  const {TW, TD, cx0, cx1, cy0, cy1} = f;
  const name = `${rng.pick(STREETS)} ${rng.pick(SUFFIX)}`;
  const terms = rng.shuffle(TERMINALS.slice());
  // Lobby height (street level above the platforms): every station ceiling stays a slab below it.
  const hu = r2(rng.range(5.4, 5.9));
  const at: TowerAt = {ox: TX, oy: TY, level: 1, base: hu};
  const up = {level: 1, floorY: hu};
  const meta = new Map<number, OfficeAreaMeta>();

  // --- Stair strip geometry (tower-local): [core lobby LB][run UL][landing TL], rows [TD-5, TD-1) -------------------------
  const LB = CORE.lobby, TL = CORE.top, CW = CORE.width, UL = stairRunCells(hu);
  const stripLen = LB + UL + TL;
  if (stripLen + 4 > TW) return fail('strip-too-long');
  const csx = rng.int(2, TW - stripLen - 2);
  const sy = TD - 1 - CW;

  // --- Lobby (upper level) -----------------------------------------------------------------------------------------------
  const lobbyArea = (r: Rect, label: string, purpose: string, parent: number, role: OfficeAreaMeta['role'], facade: OfficeAreaMeta['facade']) => {
    const a = k.addArea({x: TX + r.x, y: TY + r.y, w: r.w, h: r.h}, 'room', 'office-lobby', r2(hu + CEIL.lobby), parent, {...up, label, publicSpace: true});
    a.purpose = purpose;
    meta.set(a.id, {role, facade});
    return a;
  };
  const hall = lobbyArea({x: 0, y: 0, w: TW, h: cy0 - 1}, 'Lobby', 'office-reception', -1, 'reception', ['N', 'W', 'E']);
  const transit = lobbyArea({x: 0, y: cy1 + 1, w: TW, h: TD - 6 - (cy1 + 1)}, 'Transit concourse', 'office-lobby', hall.id, 'transit', ['W', 'E']);
  if (transit.h < 5) return fail('transit-too-shallow');
  const core = carveCore(k, f, at, hall, transit, meta);
  const security = k.addArea({x: TX, y: TY + cy0, w: cx0 - 1, h: cy1 - cy0}, 'room', 'office-room', r2(hu + CEIL.office), hall.id, {...up, label: 'Building security office', publicSpace: false});
  security.purpose = 'office-security';
  meta.set(security.id, {role: 'security', facade: ['W']});
  if (!k.connect(security, hall, 3, CEIL.door, {arch: false, margin: 2})) return fail('security-door');
  const east = lobbyArea({x: cx1 + 1, y: cy0 - 1, w: TW - cx1 - 1, h: cy1 - cy0 + 2}, 'Lobby', 'office-lobby', hall.id, 'lobby', ['E']);
  void east;
  // Pockets of the transit concourse beside the stair strip (touch the concourse directly: one open floor).
  if (csx - 1 >= 4) lobbyArea({x: 0, y: TD - 6, w: csx - 1, h: 6}, 'Transit concourse', 'office-lobby', transit.id, 'transit', ['W', 'S']);
  const ex0 = csx + stripLen + 1;
  if (TW - ex0 >= 4) lobbyArea({x: ex0, y: TD - 6, w: TW - ex0, h: 6}, 'Transit concourse', 'office-lobby', transit.id, 'transit', ['E', 'S']);

  // --- Station hall under the street, south of the tower: the ticket hall first (the stair core opens off its north wall) ---
  const thw = rng.int(28, 36), thd = rng.int(24, 30);
  const thx = Math.max(0, Math.min(csx - 1, rng.int(csx + LB + 1 - thw, csx - 1)));
  const T: Rect = {x: TX + thx, y: TY + TD, w: thw, h: thd};
  if (T.x + T.w < TX + csx + LB || !k.rectFree(T)) return fail('ticket-hall');
  const ticket = k.addArea(T, 'concourse', 'fare-hall', r1(rng.range(4.0, 4.6)), -1, {role: 'ticket-hall', label: 'Ticket hall'});

  // --- Tower connection: stair-core lobby (main), the run (main + upper), the top landing (upper) ---------------------------
  const lobbyR: Rect = {x: TX + csx, y: TY + sy, w: LB, h: CW};
  const runR: Rect = {x: TX + csx + LB, y: TY + sy, w: UL, h: CW};
  const landR: Rect = {x: TX + csx + LB + UL, y: TY + sy, w: TL, h: CW};
  if (!k.rectFree(lobbyR) || !k.solid({...runR, x: runR.x - 1, y: runR.y - 1, w: runR.w + 2, h: runR.h + 2})) return fail('stair-strip');
  const coreLobby = k.addArea(lobbyR, 'passage', 'stair-core', CORE.lobbyCeil, ticket.id, {role: 'stair-core', label: 'Stairs · Office tower'});
  k.carveDoor({x: lobbyR.x + 1, y: lobbyR.y + CW, w: LB - 2, h: 1}, ticket, coreLobby, CORE.doorH, true);
  const run = k.addArea(runR, 'passage', 'stair-core', STAIR.headroom, coreLobby.id, {role: 'stair', label: 'Stairs · Tower lobby', also: [1]});
  for (const fl of layStairRun([k.grid(0), k.grid(1)], runR, run.id, 'x', 'lo', 0, hu)) { fl.id = k.flights.length; k.flights.push(fl); }
  const landing = k.addArea(landR, 'passage', 'stair-core', r2(hu + CORE.landingClear), run.id, {...up, role: 'landing', label: 'Stairs · To the trains'});
  for (let y = landR.y - 1; y <= landR.y + CW; y++) for (let x = landR.x; x < landR.x + TL; x++) k.keepRock[k.g.idx(x, y)] = 1;
  k.carveDoor({x: landR.x, y: landR.y - 1, w: TL, h: 1}, transit, landing, CORE.landingDoorH, true);
  meta.set(landing.id, {role: 'transit', facade: []});

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

  // --- Crop: tower interior NW corner at grid cell (MARGIN, MARGIN) -------------------------------------------------------
  let x1 = TX + TW, y1 = TY + TD;
  for (const r of [...k.areas, ...k.doors, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    x1 = Math.max(x1, r.x + r.w - 1); y1 = Math.max(y1, r.y + r.h - 1);
  }
  const ox = TX - MARGIN, oy = TY - MARGIN;
  const cropped = cropKit(k, [0, 1], ox, oy, x1 - ox + 3, y1 - oy + 3, shops.storefronts);
  // Street entrance: the north facade, centred on the main hall with a little jitter (boarded scenery).
  const ew = rng.int(6, 8);
  const ec = Math.round(TW / 2 + rng.int(-6, 6));
  const tower: CarvedTower = {at: {ox: MARGIN, oy: MARGIN, level: 1, base: hu}, core, meta, north: hall, south: transit};
  return {
    kit: k, name, towards: [terms[0], terms[1]], hu, tower, storefronts: shops.storefronts, platform: I,
    coreLobby, run, landing, ticketHall: ticket, paidHall: paid, hall, transit, security, east,
    entrance: {x0: ec - Math.floor(ew / 2), x1: ec - Math.floor(ew / 2) + ew}, cropped,
  };
}
