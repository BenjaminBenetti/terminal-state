// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): DRESSING of the Surface Run interiors — every piece goes through the
// station placement kit (gen/placeKit.ts tryPlaceProp: door zones, openable swing / drawer strips, stocked-display fronts, island walkway
// rings, stair / landing keep-outs, ROOM CONNECTIVITY: a piece that cannot fit is skipped, never forced) on the builder's per-storey
// context, and REUSES the existing interior kits:
//  - sales floors: the Mall's shop programmes (gen/mall/shopsDress.ts ShopDresser + dressMallRecipe: the same recipes the Skyways lifted
//    into its units, gen/skyways/skywaysMallStores.ts), plus a convenience / liquor recipe built from the same ShopDresser primitives;
//  - offices: the Office kit (gen/office/dress.ts cubicleFarm / conferenceTable / hostDecor — the Skyways office wing's stub pattern);
//  - back of house: the station's back-room furniture (stock shelving, lockers, kitchenettes, washroom stalls, tool chests ...).
// Loot: holders take their room's PURPOSE (Area.purpose, gen/purposes.ts: the Mall's `mall-<programme>` / `-back`, the Office's
// `office-*`, the station's staff / workshop / washroom purposes) — the loot-table foundation decides contents; nothing is listed here.
// No baked loose clutter: merchandise the fixture models draw (demo tables, device walls) is split into separate stock props
// (gen/skyways/skywaysMerchSplit.ts), desk monitors / chairs are separate host decor. Props are authored in each storey's LOCAL height
// frame and lifted once at the end (finishProps).

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {WALL_ROT, cellsOfBox, mountProp, reserveAhead, rowAlongWall, strictWallOk, tryPlaceProp, wallRange, wallSpot, type PlaceCtx} from '../../placeKit';
import {stockVariant, type StockTheme} from '../../purposeShapes';
import type {Area, Side} from '../../stationTypes';
import {ShopDresser, dressBack, dressMallRecipe, frameOf} from '../../mall/shopsDress';
import {MALL_PROGRAMS, inferLot, type MallShopFit} from '../../mall/shops';
import type {MallProgram, MallShop} from '../../mall/mallTypes';
import {mallLot} from '../../mall/lots';
import {conferenceTable, cubicleFarm, hostDecor, type OfficeDress} from '../../office/dress';
import {splitSkywaysMerch} from '../../skyways/skywaysMerchSplit';
import {markSkywaysGenVersion} from '../../skyways/layoutVersion';
import {NOTICE_BOARD_Y} from '../../props';
import type {InteriorBuilder, LSide, RoomInfo} from './builder';

const SIDES: Side[] = ['N', 'S', 'E', 'W'];
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const sv = (t: StockTheme) => stockVariant(t);

/** The office kit's dressers read only the layout / placement context for these roles (no tower), as in gen/skyways/officeWing.ts. */
const stubDress = (b: InteriorBuilder, level: number): OfficeDress => ({layout: b.stub, level, tower: {meta: new Map()}} as unknown as OfficeDress);

// ---------------------------------------------------------------------------------------------------------------------------
// Placement helpers

/** Up to `n` of `kind` along the room's walls (sides in a seeded order, or the given ones). */
export function wallRow(ctx: PlaceCtx, a: Area, kind: PropKind, n: number, rng: Rng, o: {sides?: readonly Side[]; front?: number; variant?: number} = {}): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const s of o.sides ?? rng.shuffle(SIDES.slice())) {
    if (out.length >= n) break;
    out.push(...rowAlongWall(ctx, a, s, kind, {max: n - out.length, front: o.front ?? 0.8, ...(o.variant !== undefined ? {variant: () => o.variant!} : {})}));
  }
  return out;
}
/** One free-standing piece near the room's centre (walkway ring kept). */
export function centre(ctx: PlaceCtx, a: Area, kind: PropKind, rot: number, ring = 0.8, variant = 0): PropPlacement | null {
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0.5], [-1, -0.5], [1, -1], [-1, 1]]) {
    const p = tryPlaceProp(ctx, a, kind, r3(cx + dx), r3(cz + dz), rot, {ring, variant});
    if (p) return p;
  }
  return null;
}
/** Chairs pulled up round a table (host decor on its floor, never blocking the walk grid). */
function chairsRound(b: InteriorBuilder, level: number, t: PropPlacement, kind: PropKind, rng: Rng): void {
  const d = stubDress(b, level), ti = b.stub.props.indexOf(t);
  if (ti < 0) return;
  const def = PROP_DEFS[t.kind];
  const lx = Math.cos(t.rot), lz = -Math.sin(t.rot), fx = Math.sin(t.rot), fz = Math.cos(t.rot);
  const per = Math.max(1, Math.floor(def.w / 0.7));
  for (const sgn of [-1, 1]) for (let i = 0; i < per; i++) {
    if (rng.chance(0.25)) continue;
    const s = (i + 0.5) / per * def.w - def.w / 2, off = def.d / 2 + 0.3;
    hostDecor(d, t, ti, kind, t.x + lx * s + fx * off * sgn, t.z + lz * s + fz * off * sgn, sgn > 0 ? t.rot + Math.PI : t.rot, t.y, level ? {level} : {});
  }
}
/** A notice board on a free wall (wall-mounted, above the floor props). */
function noticeBoard(ctx: PlaceCtx, a: Area, rng: Rng): void {
  for (const s of rng.shuffle(SIDES.slice())) {
    const alongX = s === 'N' || s === 'S';
    const lo = (alongX ? a.x : a.y) * CELL + 0.9, hi = (alongX ? a.x + a.w : a.y + a.h) * CELL - 0.9;
    if (hi < lo) continue;
    const t = Math.round(rng.range(lo, hi) * 4) / 4;
    if (mountProp(ctx, a, s, t, 'noticeBoard', NOTICE_BOARD_Y, 0)) return;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Sales floors (the Mall's shop programmes)

/** Entry span (world metres along the frontage) of the openings on a room's `front` wall: the building's entrances, or its doors. */
function entrySpan(b: InteriorBuilder, r: RoomInfo, front: Side): [number, number] | null {
  const a = r.area, alongX = front === 'N' || front === 'S';
  const lo = alongX ? a.x : a.y, hi = lo + (alongX ? a.w : a.h);
  const spans: [number, number][] = [];
  if (r.storey === 0) for (const en of b.ents) {
    if (en.e.side !== front) continue;
    const cs = en.inner.filter(c => b.kit.g.area[c.i] === a.id).map(c => (alongX ? c.x : c.y));
    if (cs.length) spans.push([Math.min(...cs), Math.max(...cs) + 1]);
  }
  for (const d of b.kit.doors) {
    if (d.a !== a.id && d.b !== a.id) continue;
    const wallSide: Side = d.h === 1 && d.w > 1 ? (d.y < a.y ? 'N' : 'S') : (d.x < a.x ? 'W' : 'E');
    if (wallSide !== front) continue;
    spans.push(alongX ? [d.x, d.x + d.w] : [d.y, d.y + d.h]);
  }
  if (!spans.length) return null;
  const s0 = Math.max(lo, Math.min(...spans.map(s => s[0]))), s1 = Math.min(hi, Math.max(...spans.map(s => s[1])));
  return [s0 * CELL, s1 * CELL];
}

export interface SalesOpts {
  /** Frontage wall (local side) of the room; default the main facade. */
  front?: LSide | Side;
  brand?: string;
  /** Food / café recipes: the menu (gen/mall/shops.ts FOOD_CUISINES / CAFE_MENUS). */
  cuisine?: string;
  /** Purpose override (default the Mall programme's sales purpose). */
  purpose?: string;
}

/** Dresses a sales floor with a Mall programme's recipe (its focal display, then the recipe), the way in kept open. Returns the props. */
export function sales(b: InteriorBuilder, r: RoomInfo | null, program: MallProgram, o: SalesOpts = {}): PropPlacement[] {
  if (!r) return [];
  const def = MALL_PROGRAMS[program];
  const a = r.area;
  a.purpose = o.purpose ?? (program === 'food-court' || program === 'cafe' ? o.cuisine ?? def.purpose : def.purpose);
  const front: Side = o.front === undefined ? b.side('F') : (['F', 'B', 'L', 'R'] as readonly string[]).includes(o.front) ? b.side(o.front as LSide) : o.front as Side;
  const entry = entrySpan(b, r, front);
  const ctx = b.ctx(r.storey);
  const rng = b.rng.fork(`sales:${a.id}`);
  const fr = frameOf(a, front, entry ?? undefined, entry ? 0 : undefined);
  const d = new ShopDresser(b.stub, ctx, fr, rng);
  d.lot = mallLot(inferLot({width: fr.W, depth: fr.D} as MallShop, fr.W * fr.D));
  const first = b.stub.props.length;
  d.keep(fr.entry[0] - 0.25, fr.entry[1] + 0.25, 0, Math.min(2.0, fr.D * 0.4));
  const fit: MallShopFit = {program, kind: program === 'food-court' ? 'food' : 'store', brand: o.brand ?? b.b.name, purpose: a.purpose, recipe: def.recipe,
    ...(o.cuisine ? {cuisine: o.cuisine} : {}), finish: def.finishes[0], sign: {text: o.brand ?? b.b.name, style: def.sign, lit: 'dead', blade: false},
    front: 'glazed', shutter: 'open', entry: fr.entry};
  dressMallRecipe(d, fit);
  return b.stub.props.slice(first);
}

/** A convenience / liquor store floor from the ShopDresser primitives: the till by the door, coolers on the back wall, shelf aisles. */
export function convenienceFloor(b: InteriorBuilder, r: RoomInfo | null, liquor: boolean): void {
  if (!r) return;
  const a = r.area;
  a.purpose = 'convenience';
  const front = b.side('F');
  const entry = entrySpan(b, r, front);
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`conv:${a.id}`);
  const fr = frameOf(a, front, entry ?? undefined, entry ? 0 : undefined);
  const d = new ShopDresser(b.stub, ctx, fr, rng);
  const {W, D} = d;
  d.keep(fr.entry[0] - 0.25, fr.entry[1] + 0.25, 0, Math.min(2.0, D * 0.4));
  // the till: a counter run beside the entry (the side with more frontage), the register on it, an impulse rack in front
  const left = fr.entry[0] > W - fr.entry[1];
  const run = d.counterRun([['shopCounter', 0], ['shopCounter', 0]], 1.0, left ? 0.3 : fr.entry[1] + 0.6, left ? fr.entry[0] - 0.6 : W - 0.3, {max: 2});
  if (run[0]) d.onTop(run[0], 'cashRegister', 0.3);
  d.islands('snackRack', 1, {u0: left ? 0.8 : W - 2.2, u1: left ? 2.2 : W - 0.8, v0: Math.min(D - 1, 3.2), v1: Math.min(D - 1, 3.8)}, {ring: 0.5});
  // coolers along the back wall (drinks), a chest freezer when it fits
  d.backRow(liquor ? [['shopCooler', 0], ['multideckOpenCooler', 0], ['shopCooler', 0]] : [['shopCooler', 0], ['shopCooler', 0], ['multideckOpenCooler', 0]], 0.3, W - 0.3);
  if (!liquor) d.islands('chestFreezer', 1, {u0: 1.5, u1: W - 1.5, v0: D - 3.2, v1: D - 2.4}, {ring: 0.8});
  // shelving along the side walls and aisles down the floor
  d.sideRows(liquor ? [['wallBay', 0], ['shelf', 0]] : [['stockShelf', sv('snacks')], ['stockShelf', sv('grocery')]], 3.0, D - 1.6);
  d.aisles(liquor ? 'retailGondola' : 'stockShelf', liquor ? [0] : [sv('snacks'), sv('grocery'), sv('cleaning')], {u0: 1.3, u1: W - 1.3, v0: 3.6, v1: D - 2.2}, 1.2);
  d.againstWall('bin', 1);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Back of house

export function stockRoom(b: InteriorBuilder, r: RoomInfo | null, purpose: string, theme: StockTheme = 'cartons'): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`stock:${a.id}`);
  a.purpose = purpose;
  const sides = rng.shuffle(SIDES.slice());
  rowAlongWall(ctx, a, sides[0], 'stockShelf', {max: 6, front: 0.8, variant: () => sv(theme)});
  rowAlongWall(ctx, a, sides[1], 'shelf', {max: 4, front: 0.8});
  const big = a.w * a.h * CELL * CELL >= 30;
  if (big) rowAlongWall(ctx, a, sides[2], 'stockShelf', {max: 4, front: 0.8, variant: () => sv(theme === 'cartons' ? 'cleaning' : 'cartons')});
  for (const k of ['crate', 'crate', 'cartonStack', 'cardboardBoxFlaps', 'storageTote'] as const) if (rng.chance(k === 'crate' ? 0.8 : 0.6)) againstWall(b, ctx, a, k);
  if (big && rng.chance(0.6)) againstWall(b, ctx, a, rng.chance(0.5) ? 'handTruck' : 'palletJack');
  if (rng.chance(0.5)) againstWall(b, ctx, a, 'stepLadder');
}

export function backOffice(b: InteriorBuilder, r: RoomInfo | null, purpose = 'office-private', safe = false): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`office:${a.id}`);
  a.purpose = purpose;
  wallRow(ctx, a, 'desk', 1, rng);
  wallRow(ctx, a, rng.chance(0.5) ? 'filingCabinet' : 'officeFiling', 1, rng);
  if (rng.chance(0.6)) wallRow(ctx, a, 'cabinetTall', 1, rng);
  if (safe || rng.chance(0.25)) wallRow(ctx, a, 'safe', 1, rng);
  if (rng.chance(0.5)) wallRow(ctx, a, 'officeShelf', 1, rng);
  if (rng.chance(0.4)) againstWall(b, ctx, a, rng.chance(0.5) ? 'deadPlant' : 'pottedPlantSmall');
  noticeBoard(ctx, a, rng);
}

/** Washroom: stalls along the wall away from the door, the wash counter on a side wall (gen/stationDress.ts dressWashroom's scheme). */
export function washroom(b: InteriorBuilder, r: RoomInfo | null): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`wc:${a.id}`);
  a.purpose = 'washroom';
  const door = b.kit.doors.find(d => d.a === a.id || d.b === a.id);
  const doorSide: Side = !door ? 'S' : door.h === 1 && door.w > 1 ? (door.y < a.y ? 'N' : 'S') : (door.x < a.x ? 'W' : 'E');
  const far: Side = ({N: 'S', S: 'N', E: 'W', W: 'E'} as const)[doorSide];
  const stalls = rowAlongWall(ctx, a, far, 'toiletStall', {max: 4, front: 0.9});
  if (!stalls.length) wallRow(ctx, a, 'toiletStall', 1, rng, {front: 0.9});
  const lat: Side[] = far === 'N' || far === 'S' ? ['W', 'E'] : ['N', 'S'];
  if (!wallRow(ctx, a, 'washCounter', 1, rng, {sides: rng.shuffle(lat.slice()), front: 0.8}).length) wallRow(ctx, a, 'washCounter', 1, rng, {front: 0.8});
  if (rng.chance(0.35)) againstWall(b, ctx, a, 'wetFloorSign');
}

/** Walk-in cooler / cold store: shelving, a chest freezer, a fridge (food & drink by the room's purpose). */
export function coldRoom(b: InteriorBuilder, r: RoomInfo | null, purpose: string): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`cold:${a.id}`);
  a.purpose = purpose;
  const sides = rng.shuffle(SIDES.slice());
  rowAlongWall(ctx, a, sides[0], 'stockShelf', {max: 4, front: 0.8, variant: () => sv('grocery')});
  wallRow(ctx, a, 'chestFreezer', 1, rng, {front: 0.6});
  wallRow(ctx, a, 'fridge', rng.chance(0.5) ? 2 : 1, rng);
  if (rng.chance(0.6)) againstWall(b, ctx, a, 'crate');
}

/** Crew / staff room: lockers, the kitchenette and fridge, a table with chairs, a couch, the notice board. */
export function crewRoom(b: InteriorBuilder, r: RoomInfo | null, purpose = 'staff-room'): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`crew:${a.id}`);
  a.purpose = purpose;
  wallRow(ctx, a, 'staffLockers', rng.int(2, 3), rng);
  wallRow(ctx, a, 'kitchenette', 1, rng);
  wallRow(ctx, a, 'fridge', 1, rng);
  if (rng.chance(0.6)) wallRow(ctx, a, 'couch', 1, rng);
  if (rng.chance(0.3)) wallRow(ctx, a, 'vending', 1, rng);
  const t = centre(ctx, a, 'table', a.w >= a.h ? 0 : Math.PI / 2, 0.8);
  if (t) chairsRound(b, b.storeys[r.storey].level, t, rng.chance(0.5) ? 'plasticStackChair' : 'foldingChair', rng);
  noticeBoard(ctx, a, rng);
  if (rng.chance(0.5)) againstWall(b, ctx, a, 'bin');
}

/** Locker room: rows of lockers and a bench. */
export function lockerRoom(b: InteriorBuilder, r: RoomInfo | null): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`lockers:${a.id}`);
  a.purpose = 'locker-room';
  const sides = rng.shuffle(SIDES.slice());
  rowAlongWall(ctx, a, sides[0], 'staffLockers', {max: 5, front: 0.8});
  rowAlongWall(ctx, a, sides[1], 'staffLockers', {max: 4, front: 0.8});
  centre(ctx, a, 'bench', a.w >= a.h ? 0 : Math.PI / 2, 0.7);
}

/** Janitor closet: the cart, a mop sink, a shelf. */
export function janitor(b: InteriorBuilder, r: RoomInfo | null): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`jan:${a.id}`);
  a.purpose = 'janitor-closet';
  wallRow(ctx, a, 'mopSink', 1, rng);
  wallRow(ctx, a, 'stockShelf', 1, rng, {variant: sv('cleaning')});
  againstWall(b, ctx, a, 'janitorCart');
  if (rng.chance(0.5)) againstWall(b, ctx, a, 'mopBucketWringer');
}

/** Restaurant kitchen: the cook lines along the walls, a back counter, the fridge and freezer, a mop sink. */
export function kitchen(b: InteriorBuilder, r: RoomInfo | null, purpose = 'mall-food-back'): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`kitchen:${a.id}`);
  a.purpose = purpose;
  const sides = rng.shuffle(SIDES.slice());
  const lines = rowAlongWall(ctx, a, sides[0], 'grillLine', {max: 2, front: 0.9});
  rowAlongWall(ctx, a, lines.length ? sides[0] : sides[1], 'deliLine', {max: 1, front: 0.9});
  rowAlongWall(ctx, a, sides[1], 'shopBackbar', {max: 2, front: 0.9});
  wallRow(ctx, a, 'fridge', 1, rng);
  wallRow(ctx, a, 'chestFreezer', 1, rng, {front: 0.6});
  wallRow(ctx, a, 'kitchenette', 1, rng);
  if (rng.chance(0.6)) wallRow(ctx, a, 'mopSink', 1, rng);
  if (rng.chance(0.5)) againstWall(b, ctx, a, 'bin');
}

/** A small fitting / changing room: a bench seat and a coat hook rack. */
export function fittingRoom(b: InteriorBuilder, r: RoomInfo | null): void {
  if (!r) return;
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`fit:${r.area.id}`);
  if (!wallRow(ctx, r.area, 'ottoman', 1, rng, {front: 0.5}).length) wallRow(ctx, r.area, 'plasticStackChair', 1, rng, {front: 0.4});
}

// ---------------------------------------------------------------------------------------------------------------------------
// Office kit

export function openPlan(b: InteriorBuilder, r: RoomInfo | null, purpose = 'office-open', pods = false): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`open:${a.id}`);
  a.purpose = purpose;
  cubicleFarm(stubDress(b, b.storeys[r.storey].level), ctx, a, b.b.condition === 'gutted' ? 'collapsed' : 'open', pods);
  for (const kind of ['officePhotocopier', 'officeWaterCooler', 'deadPlant', 'officeFiling'] as const) if (rng.chance(kind === 'officeFiling' ? 0.6 : 0.8)) wallRow(ctx, a, kind, 1, rng);
}
export function meetingRoom(b: InteriorBuilder, r: RoomInfo | null): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`meet:${a.id}`);
  a.purpose = 'office-meeting';
  conferenceTable(stubDress(b, b.storeys[r.storey].level), ctx, a);
  wallRow(ctx, a, 'officeWhiteboard', 1, rng);
  if (rng.chance(0.5)) againstWall(b, ctx, a, 'pottedPlantSmall');
}
export function privateOffice(b: InteriorBuilder, r: RoomInfo | null, exec = false): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`priv:${a.id}`);
  a.purpose = exec ? 'office-exec' : 'office-private';
  if (!(exec && wallRow(ctx, a, 'executiveDesk', 1, rng).length)) wallRow(ctx, a, 'desk', 1, rng);
  wallRow(ctx, a, rng.chance(0.5) ? 'officeFiling' : 'filingCabinet', 1, rng);
  if (rng.chance(0.6)) wallRow(ctx, a, 'officeShelf', 1, rng);
  if (rng.chance(0.4)) againstWall(b, ctx, a, 'deadPlant');
  if (exec && rng.chance(0.6)) wallRow(ctx, a, 'loungeArmchair', 1, rng);
}
export function breakRoom(b: InteriorBuilder, r: RoomInfo | null): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`break:${a.id}`);
  a.purpose = 'office-break';
  wallRow(ctx, a, 'kitchenette', 1, rng);
  wallRow(ctx, a, 'fridge', 1, rng);
  if (rng.chance(0.6)) wallRow(ctx, a, 'couch', 1, rng);
  if (rng.chance(0.4)) wallRow(ctx, a, 'vending', 1, rng);
  const t = centre(ctx, a, 'table', a.w >= a.h ? 0 : Math.PI / 2, 0.8);
  if (t) chairsRound(b, b.storeys[r.storey].level, t, 'officeChair', rng);
}
export function copyRoom(b: InteriorBuilder, r: RoomInfo | null, storage = false): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`copy:${a.id}`);
  a.purpose = storage ? 'office-storage' : 'office-copy';
  if (!storage) wallRow(ctx, a, 'officePhotocopier', 1, rng);
  wallRow(ctx, a, 'officeShelf', storage ? 2 : 1, rng);
  wallRow(ctx, a, 'cabinetTall', 1, rng);
  wallRow(ctx, a, 'filingCabinet', storage ? 2 : 1, rng);
  for (let i = 0; i < (storage ? 3 : 1); i++) againstWall(b, ctx, a, 'archiveBoxes');
}
/** Reception lobby: the desk facing the way in, a sofa or two, a plant, a water cooler. */
export function lobby(b: InteriorBuilder, r: RoomInfo | null, purpose = 'office-reception'): void {
  if (!r) return;
  const a = r.area, ctx = b.ctx(r.storey), rng = b.rng.fork(`lobby:${a.id}`);
  a.purpose = purpose;
  const main = b.ents.find(e => e.e.main && e.inner.some(c => b.kit.g.area[c.i] === a.id));
  if (main) {
    const c = main.inner[Math.floor(main.inner.length / 2)];
    const ex = (c.x + 0.5) * CELL, ez = (c.y + 0.5) * CELL, cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    const dx = cx - ex, dz = cz - ez, l = Math.hypot(dx, dz) || 1;
    const q = Math.round(Math.atan2(-dx / l, -dz / l) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI; // its front toward the entrance
    for (const t of [3.6, 4.2, 4.8, 3.0]) {
      if (tryPlaceProp(ctx, a, 'receptionDesk', r3(ex + (dx / l) * t), r3(ez + (dz / l) * t), q, {ring: 1.0})) break;
    }
  }
  wallRow(ctx, a, 'lobbySofa', rng.int(1, 2), rng);
  for (const k of ['pottedPlantSmall', 'officeWaterCooler', 'deadPlant'] as const) if (rng.chance(0.6)) againstWall(b, ctx, a, k);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Workshop / depot / civic pieces (classified station kinds)

/** A row of `kind` against `side` of the room; returns the placements. */
export function along(b: InteriorBuilder, r: RoomInfo, side: Side, kind: PropKind, max: number, o: {front?: number; variant?: number; from?: number; to?: number} = {}): PropPlacement[] {
  return rowAlongWall(b.ctx(r.storey), r.area, side, kind, {max, front: o.front ?? 0.8, ...(o.variant !== undefined ? {variant: () => o.variant!} : {}),
    ...(o.from !== undefined ? {from: o.from} : {}), ...(o.to !== undefined ? {to: o.to} : {})});
}
/** A mounted kind (tool pegboard, parts bins) on the wall above a floor piece (backed, clear of every prop box). */
export function mountAbove(b: InteriorBuilder, r: RoomInfo, host: PropPlacement, kind: PropKind, y: number): PropPlacement | null {
  const side = sideOfWall(host.rot);
  const t = side === 'N' || side === 'S' ? host.x : host.z;
  return mountProp(b.ctx(r.storey), r.area, side, t, kind, y, 0);
}
const sideOfWall = (rot: number): Side => {
  for (const s of SIDES) if (Math.abs(Math.atan2(Math.sin(WALL_ROT[s] - rot), Math.cos(WALL_ROT[s] - rot))) < 0.1) return s;
  return 'N';
};
/** Any free wall spot for `kind`. */
export function anyWall(b: InteriorBuilder, r: RoomInfo, kind: PropKind, n = 1): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (againstWall(b, b.ctx(r.storey), r.area, kind)) k++;
  return k;
}
/**
 * placeKit.placeAgainstWall (the same seeded wall spots, strict-wall check and approach reserve) that also skips a spot whose footprint
 * would sink more than SETTLE_PEN into a piece already standing there: the kit's cell packing alone lets two neighbours overlap by up to
 * 8 cm, and a loose piece that starts inside another pops when it wakes (tests/office-physics.test.ts: 2 cm).
 */
export function againstWall(b: InteriorBuilder, ctx: PlaceCtx, area: Area, kind: PropKind, tries = 14): PropPlacement | null {
  const def = PROP_DEFS[kind], lv = area.level ?? 0;
  const sides: Side[] = ['N', 'S', 'W', 'E'];
  for (let t = 0; t < tries; t++) {
    const side = ctx.rng.pick(sides);
    const [lo, hi] = wallRange(area, side);
    if (hi - lo < def.w + 0.3) continue;
    const along = Math.round(ctx.rng.range(lo + def.w / 2 + 0.1, hi - def.w / 2 - 0.1) * 4) / 4;
    if (!strictWallOk(ctx, area, side, along, kind)) continue;
    const s = wallSpot(area, side, along, kind), f = footprint(kind, s.rot);
    const me: Box = {x: s.x, z: s.z, hx: f.hx, hz: f.hz};
    if (b.stub.props.some(q => !q.mounted && q.host === undefined && (q.level ?? 0) === lv && penOf(me, q).pen > SETTLE_PEN)) continue;
    const p = tryPlaceProp(ctx, area, kind, s.x, s.z, s.rot, {});
    if (p) { reserveAhead(ctx, area, side, along, kind); return p; }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// After the dressing

/** Desk decor of the office kit (gen/office/dress.ts hostDecor): a chair pulled up and a monitor on desks, chairs round conference tables. */
export function deskDecor(b: InteriorBuilder): void {
  const props = b.stub.props, n0 = props.length;
  const hosts = new Set(props.map(p => p.host).filter((h): h is number => h !== undefined));
  for (let pi = 0; pi < n0; pi++) {
    const p = props[pi];
    if (hosts.has(pi) || (p.kind !== 'desk' && p.kind !== 'receptionDesk' && p.kind !== 'conferenceTable' && p.kind !== 'executiveDesk')) continue;
    const info = b.info(p.area);
    if (!info) continue;
    const lv = p.level ?? 0, d = stubDress(b, lv), rng = b.rng.fork(`decor:${pi}`);
    const def = PROP_DEFS[p.kind];
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot), lx = Math.cos(p.rot), lz = -Math.sin(p.rot), lvo = lv ? {level: lv} : {};
    if (p.kind === 'conferenceTable') {
      const per = Math.max(2, Math.floor(def.w / 0.75));
      for (const sgn of [-1, 1]) for (let i = 0; i < per; i++) {
        if (rng.chance(0.2)) continue;
        const t = (i + 0.5) / per * def.w - def.w / 2, off = def.d / 2 + 0.28;
        hostDecor(d, p, pi, 'officeChair', p.x + lx * t + fx * off * sgn, p.z + lz * t + fz * off * sgn, sgn > 0 ? p.rot + Math.PI : p.rot, p.y, lvo);
      }
      continue;
    }
    if ((p.kind === 'desk' || p.kind === 'executiveDesk') && rng.chance(0.75)) {
      const off = rng.pick([-0.3, -0.2, 0.25]);
      const m = hostDecor(d, p, pi, 'officeMonitor', p.x + lx * off, p.z + lz * off, p.rot, p.y + p.h, lvo);
      if (m) (p.cut ??= []).push({y: p.h, x0: off - 0.3, x1: off + 0.3});
    }
    if (p.kind === 'receptionDesk') hostDecor(d, p, pi, 'officeMonitor', p.x - lx * 0.6 - fx * 0.15, p.z - lz * 0.6 - fz * 0.15, p.rot + Math.PI, p.y + 0.74, lvo);
    if (rng.chance(0.8)) {
      const back = p.kind === 'receptionDesk' ? -1 : 1, off = def.d / 2 + 0.3;
      hostDecor(d, p, pi, p.kind === 'executiveDesk' ? 'executiveChair' : 'officeChair', p.x + fx * off * back, p.z + fz * off * back, back > 0 ? p.rot + Math.PI : p.rot, p.y, lvo);
    }
  }
}

/**
 * Splits fixture-drawn merchandise (demo tables, device walls) into separate stock props, tags every prop with its room's level, settles
 * neighbouring floor pieces apart (settleFloorProps) and lifts every prop onto its storey floor (hosted decor follows its ROOT host: a
 * chair on a desk on a floor, a toolbox on a cabinet).
 */
export function finishProps(b: InteriorBuilder): void {
  markSkywaysGenVersion(b.stub, 4);
  splitSkywaysMerch(b.stub);
  const props = b.stub.props;
  for (const p of props) {
    const lv = b.kit.areas[p.area]?.level ?? 0;
    if (lv) p.level = lv; else delete p.level;
  }
  settleFloorProps(b);
  const floorAt = (p: PropPlacement): number => {
    const lv = p.level ?? 0, g = b.kit.grid(lv), [cx, cy] = g.cellOf(p.x, p.z);
    if (g.inBounds(cx, cy)) { const i = g.idx(cx, cy); if (g.cells[i] !== 0 && g.rampIdx[i] < 0) return g.floorOf(i); }
    return b.storeys.find(f => f.level === lv)?.y ?? 0;
  };
  const root = (i: number): number => {
    let j = i;
    for (let guard = 0; props[j].host !== undefined && guard < 8; guard++) j = props[j].host!;
    return j;
  };
  const lift = props.map((_, i) => floorAt(props[root(i)]));
  for (let i = 0; i < props.length; i++) if (lift[i]) props[i].y = r3(props[i].y + lift[i]);
}

type Box = Pick<PropPlacement, 'x' | 'z' | 'hx' | 'hz'>;
/** Footprint penetration (m, the shallower axis) of two placements; 0 when apart. */
function penOf(p: Box, q: Box): {pen: number; ox: number; oz: number} {
  const ox = p.hx + q.hx - Math.abs(p.x - q.x), oz = p.hz + q.hz - Math.abs(p.z - q.z);
  return {pen: ox > 0 && oz > 0 ? Math.min(ox, oz) : 0, ox, oz};
}
/** Penetration a floor piece may keep with a neighbour (m): a loose piece then wakes without a pop (tests/office-physics.test.ts: 2 cm). */
const SETTLE_PEN = 0.012;
/**
 * Settles neighbouring floor pieces apart: the station placement kit packs footprints by cells inset 4 cm per side (gen/placeKit.ts
 * cellsOfBox), so two pieces in adjacent cells may overlap by up to 8 cm. A piece that does is nudged (<= 5 cm, deterministic) away from
 * its neighbour along the shallower axis, its hosted decor with it — only when it keeps its own cells (the walk / block grids stay exact),
 * stays on its room's floor and moves into no other piece.
 */
function settleFloorProps(b: InteriorBuilder): void {
  const props = b.stub.props;
  const all = props.map((_, i) => i).filter(i => !props[i].mounted && props[i].host === undefined);
  // neighbours within reach of a nudge (sweep along x per level, once: every move is <= 5 cm, two moves <= 10 cm)
  const M = 0.11, near = new Map<number, number[]>();
  const byLevel = new Map<number, number[]>();
  for (const i of all) { const lv = props[i].level ?? 0; byLevel.set(lv, [...(byLevel.get(lv) ?? []), i]); }
  for (const list of byLevel.values()) {
    list.sort((i, j) => (props[i].x - props[i].hx) - (props[j].x - props[j].hx));
    for (let a = 0; a < list.length; a++) {
      const p = props[list[a]];
      for (let c = a + 1; c < list.length; c++) {
        const q = props[list[c]];
        if (q.x - q.hx > p.x + p.hx + M) break;
        if (Math.abs(p.z - q.z) >= p.hz + q.hz + M) continue;
        near.set(list[a], [...(near.get(list[a]) ?? []), list[c]]);
        near.set(list[c], [...(near.get(list[c]) ?? []), list[a]]);
      }
    }
  }
  const floor = all.filter(i => near.has(i));
  const riders = new Map<number, number[]>();
  props.forEach((p, i) => {
    if (p.host === undefined) return;
    let j = p.host;
    for (let g = 0; props[j].host !== undefined && g < 8; g++) j = props[j].host!;
    riders.set(j, [...(riders.get(j) ?? []), i]);
  });
  const rawCells = (x: number, z: number, hx: number, hz: number) => [Math.floor((x - hx) / CELL + 1e-9), Math.floor((z - hz) / CELL + 1e-9),
    Math.floor((x + hx) / CELL - 1e-9), Math.floor((z + hz) / CELL - 1e-9)];
  const same = (a: number[], c: number[]) => a.every((v, k) => v === c[k]);
  for (const i of floor) {
    const p = props[i], lv = p.level ?? 0, g = b.kit.grid(lv);
    const k = b.storeys.findIndex(f => f.level === lv);
    const keep = k >= 0 ? b.ctx(k).keep : null; // kept-clear cells (entrance strips, dolly lanes, recoverable squares) stay clear
    for (let it = 0; it < 3; it++) {
      let worst = 0, wq: PropPlacement | null = null, wo = {ox: 0, oz: 0};
      for (const j of near.get(i)!) {
        const q = props[j];
        const o = penOf(p, q);
        if (o.pen > worst) { worst = o.pen; wq = q; wo = o; }
      }
      if (!wq || worst <= SETTLE_PEN) break;
      const d = worst - SETTLE_PEN / 2;
      if (d > 0.05) break;
      const alongX = wo.ox <= wo.oz;
      const nx = alongX ? p.x + (p.x >= wq.x ? d : -d) : p.x, nz = alongX ? p.z : p.z + (p.z >= wq.z ? d : -d);
      if (!same(cellsOfBox(p.x, p.z, p.hx, p.hz), cellsOfBox(nx, nz, p.hx, p.hz))) break;
      // on its room's floor: every cell the moved box newly reaches is the room's own free floor
      const [a0, b0, a1, b1] = rawCells(p.x, p.z, p.hx, p.hz), [c0, d0, c1, d1] = rawCells(nx, nz, p.hx, p.hz);
      let ok = true;
      for (let cy = d0; cy <= d1 && ok; cy++) for (let cx = c0; cx <= c1; cx++) {
        if (cx >= a0 && cx <= a1 && cy >= b0 && cy <= b1) continue;
        if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== p.area || !g.walkable(cx, cy) || keep?.[g.idx(cx, cy)]) { ok = false; break; }
      }
      const moved = {...p, x: nx, z: nz};
      if (ok) for (const j of near.get(i)!) {
        const q = props[j];
        if (q !== wq && penOf(moved, q).pen > Math.max(SETTLE_PEN, penOf(p, q).pen)) { ok = false; break; }
      }
      if (!ok) break;
      const dx = nx - p.x, dz = nz - p.z;
      p.x = r3(nx); p.z = r3(nz);
      for (const k of riders.get(i) ?? []) { props[k].x = r3(props[k].x + dx); props[k].z = r3(props[k].z + dz); }
    }
  }
}

/** Sides of an area toward another one of the same storey (its door wall). */
export function sideToward(a: Area, o: Area): Side {
  if (o.y + o.h <= a.y) return 'N';
  if (o.y >= a.y + a.h) return 'S';
  if (o.x + o.w <= a.x) return 'W';
  if (o.x >= a.x + a.w) return 'E';
  return a.w >= a.h ? 'S' : 'E';
}

/** A store's back room dressed with the Mall's stock-room recipe of its programme (gen/mall/shopsDress.ts dressBack: the program's extras). */
export function backRoom(b: InteriorBuilder, r: RoomInfo | null, toward: RoomInfo | null, program: MallProgram, purpose?: string): void {
  if (!r) return;
  const def = MALL_PROGRAMS[program];
  const a = r.area;
  a.purpose = purpose ?? def.back ?? `mall-${program}-back`;
  const ctx = b.ctx(r.storey), rng = b.rng.fork(`back:${a.id}`);
  const fr = frameOf(a, toward ? sideToward(a, toward.area) : b.side('F'));
  const d = new ShopDresser(b.stub, ctx, fr, rng);
  const fit: MallShopFit = {program, kind: program === 'food-court' ? 'food' : 'store', brand: b.b.name, purpose: def.purpose, recipe: def.recipe,
    finish: def.finishes[0], sign: {text: b.b.name, style: def.sign, lit: 'dead', blade: false}, front: 'glazed', shutter: 'open', entry: [0, 0]};
  dressBack(d, fit);
}
