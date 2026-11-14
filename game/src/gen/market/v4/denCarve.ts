// Task studio-corpse-market-shop-20261114-031614-01 (lane LAYOUT): THE CORPSE BUYER'S DEN — layout version 4's CARVE (version 3 plus the
// den: gen/market/marketTypes.ts MarketDen). It runs on version 3's FINISHED layout (after its record) and draws nothing at random: the
// den is fully determined by the frame (its rows, its mirror), the Back Lane's west end and the real size of its two model-backed kinds
// (gen/market/v4/denKinds.ts), so not one version-3 cell, area, door, prop, light, sign, stall or spot moves — the den's cells were rock,
// its areas / door are APPENDED to layout.areas / layout.doors (gen/market/v4/den.ts appends its props, lights and signs last too).
//
// Canonical plan (cells, 0.5 m; a mirrored station flips x like everything else: gen/market/v2/frame.ts), all of it in the rock the canvas
// leaves outside the shed (one rock cell kept at the canvas border):
//   - the DOOR: DEN.doorW cells through the shed's west wall (x = SETTLE.x0 - 1) off the BACK LANE's west end, centred on the lane (a row
//     up or down when the lane's wall clutter stands in front of it); a painted board over it on the lane side (gen/market/v4/denDress.ts);
//   - the BACK PASSAGE: x [DEN.passageX, + DEN.passageW) (2 m wide) from the door south past the back row's west end;
//   - the CUSTOMER ROOM: rows [R.end, canvas h - 1) south of the back row (3-5 m deep), x [DEN.passageX, DEN.divider) (6 m), the passage
//     opening into its west end;
//   - the BOOTH WALL: column DEN.divider; its opening (floor(booth w / 0.5) cells, centred on the room's rows) is closed by the buyer's
//     booth standing in it, its lintel brought down onto the booth's top;
//   - the buyer's sealed BACK ROOM: x [DEN.divider + 1, + DEN.backW) behind the booth (no door: the player never enters it).
// Ground storey only, container height (SETTLE.cont); the den's areas take no floor loot / gear / fuel (noFloorLoot) and are never a
// market person's refuge (kinds 'passage' / 'service': market/people/refuges.ts reads rooms only).

import {CELL, FLOOR, SOLID} from '../../grid';
import type {Area, AreaKind, Door, Rect, RoomType, StationLayout} from '../../stationTypes';
import {SETTLE} from '../v2/frame';
import type {SettleCarve} from '../v2/carve';
import {CORPSE_BOOTH_KIND, CORPSE_CHUTE_KIND, CORPSE_DEN_PROP_DEFS} from './denKinds';

/** The den's fixed plan (cells / metres, canonical). */
export const DEN = {
  /** The back passage's first column and width (cells): west of the shed's west wall (x = SETTLE.x0 - 1). */
  passageX: 1,
  passageW: 4,
  /** The door through the shed wall (cells along the wall) and its head (m). */
  doorW: 3,
  doorH: SETTLE.doorH,
  /** The booth wall's column (the customer room x [passageX, divider), the back room behind it) and the back room's width (cells). */
  divider: 13,
  backW: 4,
  /** Rock kept at the canvas border (cells). */
  border: 1,
  /** Ceiling above the floor (m): a container's. */
  ceil: SETTLE.cont,
  /** In front of the booth's front face (m): the payout spot on the floor (at least, and its clear disc's radius off the booth's
   *  blocked cell), the customer's spot; the chute's near face. */
  trayOut: 0.4,
  trayDisc: 0.36,
  frontOut: 1.1,
  chuteGap: 1.55,
  /** The clear band (m) between the room's north wall and the chute (the way in from the passage); the buyer's post behind the booth. */
  band: 1.5,
  buyerBack: 0.6,
  /** The buyer's post off the booth's centre line, toward the way in (m): the cooked booth's bars stand at 0 and +-0.47 m, so his face shows in
   *  the gap beside the middle bar (from the customer's spot on the centre line too), not behind it. */
  buyerSide: 0.28,
  /** The fewest rows the customer room needs (3 m). */
  minRows: 6,
} as const;

/** The carved den: its areas / door (world), the booth opening, and the plan's world points (metres; rot / yaw as the record has them). */
export interface DenCarve {
  mirror: boolean;
  /** The Back Lane (area id) the door opens off. */
  lane: number;
  passage: Area;
  room: Area;
  back: Area;
  door: Door;
  /** The booth opening's cells (world rect in the divider column) and its lintel height (m). */
  opening: Rect;
  lintel: number;
  /** Canonical rows of the room [r0, r1) and the door's first row. */
  rows: {r0: number; r1: number; door: number};
  booth: {x: number; z: number; rot: number};
  chute: {x: number; z: number; rot: number};
  tray: {x: number; z: number};
  front: {x: number; z: number};
  buyer: {x: number; z: number; yaw: number};
  /** The plan in CANONICAL metres (the dressing lays its decor / lamps / boards out in it): the booth's centre x and front face x, the
   *  booth's / the door's centre z, the chute's centre, the room's z span, the back room's far wall x, the shed wall's lane face x. */
  plan: {xb: number; xf: number; zb: number; doorZ: number; cx: number; cz: number; z0: number; z1: number; backX1: number; laneX: number};
  /** Canonical metres -> world: x, a rot / yaw (front (sin, cos) / forward (-sin, -cos): both flip with x), a cell rect. */
  wx: (x: number) => number;
  wr: (rot: number) => number;
  rect: (r: Rect) => Rect;
}

/** Why the last den carves failed (QA / tests: a frame the den's fixed plan does not fit). */
export const DEN_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { DEN_CARVE_FAILS[why] = (DEN_CARVE_FAILS[why] ?? 0) + 1; return null; };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Cells (0.5 m) a footprint half-extent `half` centred at `c` covers (gen/placeKit.ts cellsOfBox's 4 cm margin). */
function cellsCovered(c: number, half: number): number {
  return Math.floor((c + half - 0.04) / CELL) - Math.floor((c - half + 0.04) / CELL) + 1;
}
/** `v` moved onto the quarter-cell lattice (cell centres / edges) in direction `dir` (never back past `v`), on the candidate that covers
 *  the fewest cells (the nearest on a tie): the chute's footprint stays tight on the grid. */
function snap(v: number, half: number, dir: 1 | -1): number {
  const q = CELL / 2;
  const a = dir > 0 ? Math.ceil(v / q - 1e-9) * q : Math.floor(v / q + 1e-9) * q, b = a + dir * q;
  return cellsCovered(b, half) < cellsCovered(a, half) ? b : a;
}

/** Carves the den into a finished version-3 settlement (level 0 only); null when the frame leaves no room for its plan. */
export function carveDen(layout: StationLayout, sc: SettleCarve): DenCarve | null {
  const g = layout.grid, W = g.w, H = g.h, f = sc.f, R = sc.rows, mirror = f.mirror;
  const rect = (r: Rect): Rect => (mirror ? {x: W - r.x - r.w, y: r.y, w: r.w, h: r.h} : {...r});
  const wx = (x: number) => r3(mirror ? W * CELL - x : x);
  const wr = (rot: number) => (!mirror || rot === 0 || Math.abs(Math.abs(rot) - Math.PI) < 1e-9 ? rot : -rot);
  const mx = (x: number) => (mirror ? W - 1 - x : x); // a canonical column -> world column
  const wallX = SETTLE.x0 - 1;
  const r0 = R.end, r1 = H - DEN.border, D = r1 - r0;
  if (D < DEN.minRows) return fail('room rows');
  const lane = sc.lanes.back;
  if (lane.y + lane.h > r0 || lane.h < DEN.doorW + 2) return fail('back lane');
  const B = CORPSE_DEN_PROP_DEFS[CORPSE_BOOTH_KIND], C = CORPSE_DEN_PROP_DEFS[CORPSE_CHUTE_KIND];

  // --- the door's rows: centred on the Back Lane (a lane row clear at each side), its lane-side approach (2 cells) clear floor -----
  const centre = lane.y + Math.floor((lane.h - DEN.doorW) / 2);
  const rowsOk = (y: number) => y >= lane.y + 1 && y + DEN.doorW <= lane.y + lane.h - 1;
  const clear = (y: number) => {
    for (let r = y; r < y + DEN.doorW; r++) for (const x of [wallX + 1, wallX + 2]) {
      const i = g.idx(mx(x), r);
      if (g.cells[i] !== FLOOR || g.blocked[i] || g.area[i] !== lane.id) return false;
    }
    return true;
  };
  const dy0 = [0, -1, 1, -2, 2].map(d => centre + d).find(y => rowsOk(y) && clear(y)) ?? centre;

  // --- the booth opening: as many whole cells as the booth's width covers (the booth always overlaps it), a jamb cell each side -------
  const n = Math.max(2, Math.min(D - 2, Math.floor(B.w / CELL + 1e-6)));
  const o0 = r0 + Math.floor((D - n) / 2);

  const pRect: Rect = {x: DEN.passageX, y: dy0, w: DEN.passageW, h: r0 - dy0};
  const roomRect: Rect = {x: DEN.passageX, y: r0, w: DEN.divider - DEN.passageX, h: D};
  const backRect: Rect = {x: DEN.divider + 1, y: r0, w: DEN.backW, h: D};
  const dRect: Rect = {x: wallX, y: dy0, w: 1, h: DEN.doorW};
  const oRect: Rect = {x: DEN.divider, y: o0, w: 1, h: n};
  // every cell of it is rock on every storey now (the canvas outside the shed), the rock border kept
  for (const r of [pRect, roomRect, backRect, dRect, oRect]) {
    const w = rect(r);
    if (w.x < DEN.border || w.x + w.w > W - DEN.border || w.y + w.h > H - DEN.border) return fail('border');
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) {
      for (const L of layout.levels) if (L.grid.cells[L.grid.idx(x, y)] !== SOLID) return fail('not rock');
    }
  }

  // --- the plan (canonical metres; the customer west of the booth, the buyer east of it) -------------------------------------------
  const xb = (DEN.divider + 0.5) * CELL, zb = (o0 + n / 2) * CELL;
  const xf = xb - B.d / 2; // the booth's front face (the customer side)
  // the chute: its near face DEN.chuteGap in front of the booth face, the DEN.band way in north of it (centred in a deeper room), a clear
  // row south of it; its open side north (toward the way in) — turned a quarter (open side west, toward the passage: its shorter side
  // along z) when the room is too shallow for that
  const place = (hx: number, hz: number) => {
    const z = snap(Math.max(r0 * CELL + DEN.band + hz, (r0 + r1) / 2 * CELL), hz, 1);
    return {x: snap(xf - DEN.chuteGap - hx, hx, -1), z, fits: Math.floor((z + hz - 0.04) / CELL) <= r1 - 2};
  };
  const north = place(C.w / 2, C.d / 2), turned = north.fits ? null : place(C.d / 2, C.w / 2);
  if (turned && !turned.fits) return fail('chute');
  const {x: cx, z: cz} = turned ?? north, crot = turned ? wr(-Math.PI / 2) : Math.PI;

  // --- the areas (appended: every version-3 area id stays) and their cells --------------------------------------------------------
  const stamp = (r: Rect, area: number, ceil: number) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = g.idx(x, y);
      g.cells[i] = FLOOR; g.area[i] = area; g.ceil[i] = ceil; g.floor[i] = 0;
    }
  };
  const add = (r: Rect, kind: AreaKind, type: RoomType, label: string, parent: number): Area => {
    const w = rect(r);
    const a: Area = {...w, id: layout.areas.length, kind, type, label, ceil: DEN.ceil, parent, depth: (layout.areas[parent]?.depth ?? 0) + 1, publicSpace: false, lighting: 'dim', noFloorLoot: true};
    layout.areas.push(a);
    stamp(w, a.id, DEN.ceil);
    return a;
  };
  const passage = add(pRect, 'passage', 'service-corridor', 'Back passage', lane.id);
  const room = add(roomRect, 'service', 'storage', 'Corpse buyer', passage.id);
  const back = add(backRect, 'service', 'storage', 'Back room', room.id);
  // the door (Kit.carveDoor's rule: its cells the inner area's, the head at the lower of the door / both ceilings)
  const dw = rect(dRect), height = Math.min(DEN.doorH, layout.areas[lane.id].ceil, passage.ceil);
  stamp(dw, passage.id, height);
  const door: Door = {...dw, id: layout.doors.length, a: lane.id, b: passage.id, height, arch: false};
  layout.doors.push(door);
  // the booth opening: the room's floor under the booth, its lintel down on the booth's top (the back room sealed above it too)
  const ow = rect(oRect), lintel = r3(Math.min(DEN.ceil, B.h + 0.02));
  stamp(ow, room.id, lintel);
  // (the storeys' cached derived arrays are keyed by the levels array: a fresh array, so every later query sees the den)
  layout.levels = layout.levels.slice();
  return {
    mirror, lane: lane.id, passage, room, back, door, opening: ow, lintel, rows: {r0, r1, door: dy0},
    // booth: front (+Z) toward the customer (canonical -x); chute: its open side (+Z) toward the way in (north, -z; turned: canonical -x)
    booth: {x: wx(xb), z: r3(zb), rot: wr(-Math.PI / 2)},
    chute: {x: wx(cx), z: r3(cz), rot: crot},
    tray: {x: wx(Math.min(xf - DEN.trayOut, DEN.divider * CELL - DEN.trayDisc)), z: r3(zb)},
    front: {x: wx(xf - DEN.frontOut), z: r3(zb)},
    // the buyer faces the customer: forward (-sin yaw, -cos yaw) = canonical -x; his face in a gap between the bars (DEN.buyerSide)
    buyer: {x: wx(xb + B.d / 2 + DEN.buyerBack), z: r3(zb - DEN.buyerSide), yaw: wr(Math.PI / 2)},
    plan: {xb, xf, zb, doorZ: (dy0 + DEN.doorW / 2) * CELL, cx, cz, z0: r0 * CELL, z1: r1 * CELL, backX1: (DEN.divider + 1 + DEN.backW) * CELL, laneX: SETTLE.x0 * CELL},
    wx, wr, rect,
  };
}
