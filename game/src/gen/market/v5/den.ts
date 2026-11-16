// Task studio-survivor-market-crevice-20261116-074419: THE CORPSE BUYER'S DEN of layout version 5 (the crevice) — version 4's den
// (gen/market/v4/: the same booth / chute kinds, the same plan and its dealing rules, the same record: gen/market/marketTypes.ts MarketDen)
// carved into the rock behind its ENTRY CONTAINER by the Arrival Square (the den side's first ground box, gen/market/v5/carve.ts 'den'):
// the train's gate is a few metres away and the way from the platform to the chute is flat (a carried body never meets a stair).
//
// Plan (cells, 0.5 m) in the DEN FRAME: column c = 0 is the entry container's back wall, c < 0 the entry (its interior c = -5 .. -1, its
// front wall c = -6 on the square), c > 0 deeper into the rock (world x = the back wall's column + dir * c, dir = away from the walk):
//   - the ENTRY (the container, version 4's back passage): its own front door off the square (the record's door), empty floor;
//   - the CUSTOMER ROOM: c [1, 13) (6 m), the entry's rows (its 10 rows: 5 m), opening off the entry through a DEN.doorW-cell cut in its
//     back wall in its first rows (the way in along the room's north band);
//   - the BOOTH WALL: column 13; its opening closed by the buyer's booth standing in it, the lintel brought down onto the booth's top;
//   - the buyer's sealed BACK ROOM: c [14, 18) behind the booth (no door).
// Ground storey, container height. Drawn on its own fork only, after everything else: no other output moves.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, SOLID} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {isLootHolderKind} from '../../../items/loot';
import {cellsOfBox, makePlaceCtx, markCell, tryPlaceProp} from '../../placeKit';
import type {Area, AreaKind, Door, LightPlacement, Rect, RoomType, SignPlacement, StationLayout} from '../../stationTypes';
import {MARKET_EMPTY_KEY} from '../dress';
import {DEN, type DenCarve} from '../v4/denCarve';
import {DEN_LIGHTS, DEN_RED, DEN_SIGNS, DEN_SIGN_STYLE, type DenDressed} from '../v4/denDress';
import {denRecord} from '../v4/denRecord';
import {CORPSE_BOOTH_KIND, CORPSE_CHUTE_KIND, CORPSE_DEN_PROP_DEFS} from '../v4/denKinds';
import {CREVICE} from './frame';
import type {CreviceCarve} from './carve';

/** The version-5 den's plan (den-frame columns). */
export const CREVICE_DEN = {
  /** The customer room's columns [room0, divider), the booth wall, the back room's width. */
  room0: 1,
  divider: 13,
  backW: 4,
  /** The entry's interior columns [entry0, 0). */
  entry0: -5,
} as const;

/** Why the last den carves failed (QA / tests). */
export const CREVICE_DEN_FAILS: Record<string, number> = {};
const fail = (why: string): null => { CREVICE_DEN_FAILS[why] = (CREVICE_DEN_FAILS[why] ?? 0) + 1; return null; };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The carved den (version 4's DenCarve: `lane` = the square, `passage` = the entry container) and the den frame's column map. */
export interface CrevDenCarve extends DenCarve {
  /** Den-frame column -> world column, and back. */
  col: (c: number) => number;
  canon: (x: number) => number;
}

/** Adds the den to a finished version-5 layout (after its record); false (the attempt is rejected) when the plan does not fit. */
export function addCreviceDen(layout: StationLayout, cc: CreviceCarve, rng: Rng, out?: {carve?: CrevDenCarve; dressed?: DenDressed}): boolean {
  const m = layout.market;
  if (!m) return false;
  const dc = carveCrevDen(layout, cc);
  if (!dc) return false;
  const dd = dressCrevDen(layout, dc, rng);
  layout.market = {...m, den: denRecord(layout, dc, dd)};
  if (out) { out.carve = dc; out.dressed = dd; }
  return true;
}

function cellsCovered(c: number, half: number): number {
  return Math.floor((c + half - 0.04) / CELL) - Math.floor((c - half + 0.04) / CELL) + 1;
}
/** (gen/market/v4/denCarve.ts snap) `v` onto the quarter-cell lattice toward `dir`, on the candidate covering the fewest cells. */
function snap(v: number, half: number, dir: 1 | -1): number {
  const q = CELL / 2;
  const a = dir > 0 ? Math.ceil(v / q - 1e-9) * q : Math.floor(v / q + 1e-9) * q, b = a + dir * q;
  return cellsCovered(b, half) < cellsCovered(a, half) ? b : a;
}

/** The den's carve (cells / areas / doors appended; no draw). */
export function carveCrevDen(layout: StationLayout, cc: CreviceCarve): CrevDenCarve | null {
  const g = layout.grid, W = g.w, H = g.h;
  const ent = cc.containers[cc.denSlot];
  if (!ent || ent.use !== 'den' || ent.area < 0 || !ent.door) return fail('no entry');
  const entry = layout.areas[ent.area], square = layout.areas[cc.square.id];
  // the den frame: dir = world x away from the walk (into the rock), cb = the back wall's world column
  const dir = ent.face === 'E' ? -1 : 1, cb = dir < 0 ? ent.box.x : ent.box.x + ent.box.w - 1;
  const col = (c: number) => cb + dir * c, canon = (x: number) => (x - cb) * dir;
  const wx = (x: number) => r3(dir > 0 ? cb * CELL + x : (cb + 1) * CELL - x);
  const wr = (rot: number) => (dir > 0 || rot === 0 || Math.abs(Math.abs(rot) - Math.PI) < 1e-9 ? rot : -rot);
  const rect = (r: Rect): Rect => (dir > 0 ? {x: cb + r.x, y: r.y, w: r.w, h: r.h} : {x: cb - (r.x + r.w - 1), y: r.y, w: r.w, h: r.h});
  const r0 = ent.rect.y, r1 = ent.rect.y + ent.rect.h, D = r1 - r0;
  if (D < DEN.minRows) return fail('room rows');
  const B = CORPSE_DEN_PROP_DEFS[CORPSE_BOOTH_KIND], C = CORPSE_DEN_PROP_DEFS[CORPSE_CHUTE_KIND];
  const P = CREVICE_DEN;

  const n = Math.max(2, Math.min(D - 2, Math.floor(B.w / CELL + 1e-6)));
  const o0 = r0 + Math.floor((D - n) / 2);
  const roomRect: Rect = {x: P.room0, y: r0, w: P.divider - P.room0, h: D};
  const backRect: Rect = {x: P.divider + 1, y: r0, w: P.backW, h: D};
  const dRect: Rect = {x: 0, y: r0, w: 1, h: DEN.doorW};
  const oRect: Rect = {x: P.divider, y: o0, w: 1, h: n};
  // every cell rock on the ground storey now (the storeys above stand >= a storey higher: their floors over the den's ceiling)
  for (const r of [roomRect, backRect, dRect, oRect]) {
    const w = rect(r);
    if (w.x < DEN.border || w.x + w.w > W - DEN.border || w.y < DEN.border || w.y + w.h > H - DEN.border) return fail('border');
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) if (g.cells[g.idx(x, y)] !== SOLID) return fail('not rock');
  }
  // its jamb / wall ring rock too (the room never touches another room or the hall)
  for (const r of [roomRect, backRect]) {
    const w = rect({x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2});
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) {
      const c = canon(x);
      if (c === 0 && y >= r0 && y < r1) continue; // the entry's back wall (the door goes through it)
      if (c >= P.room0 && c < P.divider + 1 + P.backW && y >= r0 && y < r1) continue;
      if (g.inBounds(x, y) && g.cells[g.idx(x, y)] !== SOLID) return fail('wall ring');
    }
  }

  // --- the plan (den-frame metres: the customer toward the entry, the buyer deeper) ----------------------------------------------
  const xb = (P.divider + 0.5) * CELL, zb = (o0 + n / 2) * CELL, xf = xb - B.d / 2;
  const place = (hx: number, hz: number) => {
    const z = snap(Math.max(r0 * CELL + DEN.band + hz, (r0 + r1) / 2 * CELL), hz, 1);
    return {x: snap(xf - DEN.chuteGap - hx, hx, -1), z, fits: Math.floor((z + hz - 0.04) / CELL) <= r1 - 2};
  };
  const north = place(C.w / 2, C.d / 2), turned = north.fits ? null : place(C.d / 2, C.w / 2);
  if (turned && !turned.fits) return fail('chute');
  const {x: cx, z: cz} = turned ?? north, crot = turned ? wr(-Math.PI / 2) : Math.PI;

  // --- the areas (appended) and their cells --------------------------------------------------------------------------------------
  const stamp = (r: Rect, area: number, ceil: number) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = g.idx(x, y);
      g.cells[i] = FLOOR; g.area[i] = area; g.ceil[i] = ceil; g.floor[i] = 0;
    }
  };
  const add = (r: Rect, kind: AreaKind, type: RoomType, label: string, parent: number): Area => {
    const w = rect(r);
    const a: Area = {...w, id: layout.areas.length, kind, type, label, ceil: CREVICE.cont, parent, depth: (layout.areas[parent]?.depth ?? 0) + 1, publicSpace: false, lighting: 'dim', noFloorLoot: true};
    layout.areas.push(a);
    stamp(w, a.id, CREVICE.cont);
    return a;
  };
  entry.lighting = 'dim';
  entry.noFloorLoot = true;
  const room = add(roomRect, 'service', 'storage', 'Corpse buyer', entry.id);
  const back = add(backRect, 'service', 'storage', 'Back room', room.id);
  // the way in: the entry's back wall cut through at full container height (version 4's passage opens into its room the same way: no door)
  stamp(rect(dRect), room.id, CREVICE.cont);
  const ow = rect(oRect), lintel = r3(Math.min(CREVICE.cont, B.h + 0.02));
  stamp(ow, room.id, lintel);
  layout.levels = layout.levels.slice();
  // the record's door: the entry's own front door off the square
  const fd = ent.door;
  const door: Door | undefined = layout.doors.find(d => (d.level ?? 0) === 0 && d.x === fd.x && d.y === fd.y && d.w === fd.w && d.h === fd.h);
  if (!door || door.b !== entry.id) return fail('entry door');
  // the square's face of the entry's front wall (den-frame metres): c = -6's outer face
  const laneX = (CREVICE_DEN.entry0 - 1) * CELL;
  return {
    mirror: dir < 0, lane: square.id, passage: entry, room, back, door, opening: ow, lintel, rows: {r0, r1, door: r0},
    booth: {x: wx(xb), z: r3(zb), rot: wr(-Math.PI / 2)},
    chute: {x: wx(cx), z: r3(cz), rot: crot},
    tray: {x: wx(Math.min(xf - DEN.trayOut, P.divider * CELL - DEN.trayDisc)), z: r3(zb)},
    front: {x: wx(xf - DEN.frontOut), z: r3(zb)},
    buyer: {x: wx(xb + B.d / 2 + DEN.buyerBack), z: r3(zb - DEN.buyerSide), yaw: wr(Math.PI / 2)},
    plan: {xb, xf, zb, doorZ: (door.y + door.h / 2) * CELL, cx, cz, z0: r0 * CELL, z1: r1 * CELL, backX1: (P.divider + 1 + P.backW) * CELL, laneX},
    wx, wr, rect, col, canon,
  };
}

/** The den's furnishing (gen/market/v4/denDress.ts in the den frame): the booth and the chute, grim dressing, dim red lamps, boards. */
export function dressCrevDen(layout: StationLayout, dc: CrevDenCarve, rng: Rng): DenDressed {
  const g = layout.grid, P = dc.plan, Q = CREVICE_DEN;
  const fixture = (kind: PropKind, x: number, z: number, rot: number, area: number): number => {
    const def = PROP_DEFS[kind], {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: 0, rot, area, hx, hz, h: def.h, blocksSight: def.blocksSight, variant: 0};
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR) continue;
      g.blocked[g.idx(cx, cy)] = 1;
      if (def.blocksSight) g.sightBlocked[g.idx(cx, cy)] = 1;
    }
    layout.props.push(p);
    return layout.props.length - 1;
  };
  const booth = fixture(CORPSE_BOOTH_KIND, dc.booth.x, dc.booth.z, dc.booth.rot, dc.room.id);
  const chute = fixture(CORPSE_CHUTE_KIND, dc.chute.x, dc.chute.z, dc.chute.rot, dc.room.id);

  const areas = [dc.passage, dc.room, dc.back];
  const ctx = makePlaceCtx(layout, rng, 0, {x0: Math.min(...areas.map(a => a.x)) - 1, y0: Math.min(...areas.map(a => a.y)) - 1, x1: Math.max(...areas.map(a => a.x + a.w)), y1: Math.max(...areas.map(a => a.y + a.h))});
  const cp = layout.props[chute], [kx0, ky0, kx1, ky1] = cellsOfBox(cp.x, cp.z, cp.hx, cp.hz);
  const chuteC0 = Math.min(dc.canon(kx0), dc.canon(kx1));
  const bandRows = Math.ceil(DEN.band / CELL - 1e-6);
  const fx = Math.sin(cp.rot), fz = Math.cos(cp.rot), halfAlong = Math.abs(fx) * cp.hx + Math.abs(fz) * cp.hz, halfAcross = Math.abs(fz) * cp.hx + Math.abs(fx) * cp.hz;
  const mouth = (wx: number, wz: number) => {
    const along = (wx - cp.x) * fx + (wz - cp.z) * fz, across = Math.abs((wx - cp.x) * fz - (wz - cp.z) * fx);
    return along > 0 && along < halfAlong + 1.25 && across < halfAcross + 0.25;
  };
  for (const a of areas) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.area[i] !== a.id) continue;
    const [wx, wz] = g.center(x, y), c = dc.canon(x);
    const keep = a === dc.passage
      || (a === dc.room && (y < dc.rows.r0 + bandRows || (x >= kx0 - 1 && x <= kx1 + 1 && y >= ky0 - 1 && y <= ky1 + 1) || mouth(wx, wz) || c >= chuteC0 - 1))
      || (a === dc.back && Math.hypot(wx - dc.buyer.x, wz - dc.buyer.z) < 0.85);
    if (keep) markCell(ctx, ctx.keep, i);
  }
  const put = (a: Area, kind: PropKind, cx: number, cz: number, crot: number): PropPlacement | null => {
    const p = tryPlaceProp(ctx, a, kind, dc.wx(cx), r3(cz), dc.wr(crot), {checkZone: false});
    if (p && isLootHolderKind(kind)) p.purpose = MARKET_EMPTY_KEY;
    if (p) p.variant = rng.int(0, 11);
    return p;
  };
  // the customer room's far (south) wall from the entry side: bags, a hand truck, a mop bucket
  let c0: number = Q.room0;
  for (const kind of ['trashBagPile', 'handTruck', 'mopBucketWringer'] as PropKind[]) {
    const {hx, hz} = footprint(kind, Math.PI), n = Math.max(1, Math.ceil((2 * hx - 0.08) / CELL - 1e-6));
    put(dc.room, kind, (c0 + n / 2) * CELL, P.z1 - hz - 0.03, Math.PI);
    c0 += n;
  }
  // the back room, against its far wall: empty steel shelving (north), a pile of bags (south)
  {
    const sh = footprint('shelf', -Math.PI / 2), bags = footprint('trashBagPile', -Math.PI / 2);
    put(dc.back, 'shelf', P.backX1 - sh.hx - 0.03, P.z0 + sh.hz + 0.05, -Math.PI / 2);
    put(dc.back, 'trashBagPile', P.backX1 - bags.hx - 0.03, P.z1 - bags.hz - 0.05, -Math.PI / 2);
  }

  // --- the lamps -------------------------------------------------------------------------------------------------------------------
  const lamp = (a: Area, cx: number, cz: number, o: Partial<LightPlacement>) => {
    layout.lights.push({x: dc.wx(cx), y: r3(CREVICE.cont - 0.02), z: r3(cz), rot: dc.wr(Math.PI / 2), area: a.id, broken: false, flicker: false, warm: true, power: 0.45, dying: false, ...o});
  };
  lamp(dc.room, P.xf - 1.3, P.zb, {warm: false, power: DEN_LIGHTS.booth, tint: DEN_RED});
  lamp(dc.back, (Q.divider + 1 + Q.backW / 2) * CELL, P.zb, {warm: false, power: DEN_LIGHTS.back, tint: DEN_RED});
  lamp(dc.passage, Q.entry0 / 2 * CELL, P.doorZ, {power: DEN_LIGHTS.passage});

  // --- the boards: over the entry's door on the square (under the bar's deck when it covers the door: kept below its ceiling), beside
  // the door at eye height the price; hanging in front of the booth the terms
  const sign = (s: Omit<SignPlacement, 'kind' | 'style'>) => { layout.signs.push({kind: 'info', ...s, style: {...DEN_SIGN_STYLE}}); };
  const d = dc.door, sq = layout.areas[dc.lane];
  const [fx0, fz0] = [d.x + (dc.mirror ? d.w : -1), d.y + Math.floor(d.h / 2)];
  const head = g.inBounds(fx0, fz0) && g.area[g.idx(fx0, fz0)] === sq.id ? g.ceil[g.idx(fx0, fz0)] : CREVICE.topY;
  const nameY = head < 3.2 ? r3(head - 0.18) : 2.62;
  const sx = dc.wx(P.laneX - 0.02), srot = dc.wr(-Math.PI / 2);
  sign({text: DEN_SIGNS.door, area: dc.lane, x: sx, z: r3(P.doorZ), y: nameY, rot: srot, w: 1.9});
  // the price board on the wall right beside the door (the longer stretch between the door and the box's end walls), at eye height
  const north = d.y - dc.rows.r0, south = dc.rows.r1 - (d.y + d.h);
  const pz = south >= north ? (d.y + d.h) * CELL + 0.55 : d.y * CELL - 0.55;
  sign({text: DEN_SIGNS.price, area: dc.lane, x: sx, z: r3(pz), y: 1.7, rot: srot, w: 1.0});
  sign({text: DEN_SIGNS.booth, area: dc.room.id, x: dc.wx(P.xf - 0.3), z: r3(P.zb), y: 2.28, rot: dc.wr(-Math.PI / 2), w: 1.8, hang: true});
  return {booth, chute};
}
