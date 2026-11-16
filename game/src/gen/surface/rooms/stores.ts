// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the STORE programmes — a sales floor behind the shopfront and a
// back-of-house strip behind it, each programme with its own back rooms (the grocery's stock room / walk-in cooler / deli prep / office /
// staff room, the pharmacy's dispensary, the hardware store's stock yard, the clothing store's stock and alterations, the electronics repair
// room, the gun counter's armoury, the diner's kitchen line and walk-in, the bookstore's café …) and, where GEN gives the building a
// second walkable storey, a stair core on the back wall with an upper sales floor (clothing / sports / books / hardware / electronics) or
// the store's offices and storage above.
//
// Sales floors reuse the Mall's shop recipes (gen/mall/shopsDress.ts through rooms/dress.ts sales: checkout lanes, aisles, coolers,
// counters, racks, the dispensary counter, gun counters, the kitchen line …); back rooms the Mall's stock-room recipe per programme
// (rooms/dress.ts backRoom) or the station / office back-room dressers.
//
// Layout (local frame, rooms/builder.ts): sales floor v in [0, S), wall at v = S, back strip v in (S, D); with a second storey the core
// sits on the back wall at one end of the strip (InteriorBuilder.backCore) with the strip's first room in front of it on each storey.

import type {MallProgram} from '../../mall/mallTypes';
import type {RoomType} from '../../stationTypes';
import type {SurfaceProgrammeId} from './programmes';
import type {InteriorBuilder, LRect, RoomInfo, WindowStyle} from './builder';
import {
  backOffice, backRoom, breakRoom, coldRoom, convenienceFloor, copyRoom, crewRoom, janitor, kitchen, privateOffice, sales, stockRoom, washroom,
} from './dress';

type Dress = (b: InteriorBuilder, r: RoomInfo, sales: RoomInfo | null) => void;
interface Back {
  role: string; label: string; type: RoomType; w: number; dress: Dress;
  windows?: WindowStyle; enemies?: number; door?: number; front?: boolean;
}
interface StoreSpec {
  /** The sales floor's recipe (a Mall programme; picked per building when several). */
  floor: readonly (readonly [MallProgram | 'convenience' | 'liquor', number])[];
  label: string;
  type?: RoomType;
  /** Back strip depth as a share of the plot depth (cells clamped 10..18). */
  back: number;
  rooms: readonly Back[];
  /** Upper storey: another sales floor (its recipe) or the store's offices / storage. */
  upper: MallProgram | 'offices';
  /** A café corner split off the sales floor (bookstore). */
  cafe?: boolean;
  /** Food recipes: the cuisine (gen/stationTypes ShopUse) of the floor. */
  cuisine?: readonly string[];
}

const office: Back = {role: 'office', label: 'Office', type: 'agent-office', w: 0.8, dress: (b, r) => backOffice(b, r, 'mall-management', true), windows: 'office'};
const wc: Back = {role: 'washroom', label: 'Washroom', type: 'washroom', w: 0.55, dress: b2(washroom), windows: 'small', enemies: 0.5};
const staff: Back = {role: 'staff', label: 'Staff room', type: 'crew-room', w: 0.8, dress: (b, r) => crewRoom(b, r), windows: 'office'};
function b2(f: (b: InteriorBuilder, r: RoomInfo) => void): Dress { return (b, r) => f(b, r); }
const stock = (prog: MallProgram, label = 'Stock room', w = 1.6): Back => ({role: 'stock', label, type: 'stock-room', w, dress: (b, r, s) => backRoom(b, r, s, prog), door: 4});

const SPECS: Readonly<Partial<Record<SurfaceProgrammeId, StoreSpec>>> = {
  grocery: {floor: [['grocery', 1]], label: 'Sales floor', back: 0.3, upper: 'offices', rooms: [
    stock('grocery', 'Stock room', 2.2),
    {role: 'cold', label: 'Walk-in cooler', type: 'storage', w: 0.9, dress: (b, r) => coldRoom(b, r, 'mall-grocery-back')},
    {role: 'prep', label: 'Deli prep', type: 'stock-room', w: 0.9, dress: (b, r) => kitchen(b, r, 'mall-food-back')},
    office, staff, wc,
  ]},
  pharmacy: {floor: [['pharmacy', 1]], label: 'Sales floor', back: 0.32, upper: 'offices', rooms: [
    {role: 'dispensary', label: 'Dispensary', type: 'stock-room', w: 1.4, dress: (b, r, s) => backRoom(b, r, s, 'pharmacy', 'mall-pharmacy-back'), door: 3},
    {role: 'stock', label: 'Stock room', type: 'stock-room', w: 1.0, dress: (b, r) => stockRoom(b, r, 'mall-pharmacy-back', 'pharmacy'), door: 3},
    office, wc,
  ]},
  hardware: {floor: [['hardware', 1]], label: 'Sales floor', back: 0.34, upper: 'home', rooms: [
    stock('hardware', 'Stock yard', 2.4),
    {role: 'paint', label: 'Paint store', type: 'storage', w: 0.9, dress: (b, r) => stockRoom(b, r, 'workshop', 'cleaning'), door: 3},
    office, wc,
  ]},
  clothing: {floor: [['clothing', 0.55], ['womenswear', 0.45]], label: 'Sales floor', back: 0.28, upper: 'shoes', rooms: [
    stock('clothing', 'Stock room', 1.6),
    {role: 'alterations', label: 'Alterations', type: 'storage', w: 0.8, dress: (b, r) => copyRoom(b, r, true), windows: 'office'},
    office, wc,
  ]},
  electronics: {floor: [['electronics', 0.7], ['phone', 0.3]], label: 'Sales floor', back: 0.3, upper: 'music', rooms: [
    {role: 'repair', label: 'Repair room', type: 'stock-room', w: 1.2, dress: (b, r, s) => backRoom(b, r, s, 'electronics'), door: 3, windows: 'office'},
    {role: 'stock', label: 'Stock room', type: 'stock-room', w: 1.2, dress: (b, r) => stockRoom(b, r, 'mall-electronics-back', 'devices'), door: 3},
    office, wc,
  ]},
  convenience: {floor: [['convenience', 1]], label: 'Shop floor', back: 0.3, upper: 'offices', rooms: [
    {role: 'stock', label: 'Stock room', type: 'stock-room', w: 1.4, dress: (b, r) => stockRoom(b, r, 'stock-room', 'snacks'), door: 3},
    {role: 'cold', label: 'Walk-in cooler', type: 'storage', w: 0.8, dress: (b, r) => coldRoom(b, r, 'convenience')},
    office, wc,
  ]},
  liquor: {floor: [['liquor', 1]], label: 'Shop floor', back: 0.3, upper: 'offices', rooms: [
    {role: 'stock', label: 'Stock room', type: 'stock-room', w: 1.6, dress: (b, r) => stockRoom(b, r, 'stock-room', 'cartons'), door: 3},
    office, wc,
  ]},
  'sporting-goods': {floor: [['sports', 0.5], ['outdoors', 0.3], ['guns', 0.2]], label: 'Sales floor', back: 0.3, upper: 'outdoors', rooms: [
    stock('sports', 'Stock room', 1.6),
    {role: 'armoury', label: 'Gun room', type: 'storage', w: 0.9, dress: (b, r, s) => backRoom(b, r, s, 'guns', 'mall-guns-back'), door: 2},
    office, wc,
  ]},
  gunstore: {floor: [['guns', 1]], label: 'Sales floor', back: 0.32, upper: 'offices', rooms: [
    {role: 'armoury', label: 'Armoury', type: 'storage', w: 1.3, dress: (b, r, s) => backRoom(b, r, s, 'guns', 'mall-guns-back'), door: 2},
    {role: 'stock', label: 'Stock room', type: 'stock-room', w: 1.0, dress: (b, r) => stockRoom(b, r, 'mall-guns-back', 'cartons'), door: 3},
    office, wc,
  ]},
  bookstore: {floor: [['books', 1]], label: 'Bookshop', back: 0.28, upper: 'toys', cafe: true, rooms: [
    stock('books', 'Stock room', 1.5),
    {role: 'kitchen', label: 'Café kitchen', type: 'stock-room', w: 0.9, dress: (b, r) => kitchen(b, r, 'mall-food-back')},
    office, wc,
  ]},
  cafe: {floor: [['cafe', 1]], label: 'Café', type: 'eatery', back: 0.32, upper: 'offices', cuisine: ['coffee', 'coffee', 'bakery', 'donut'], rooms: [
    {role: 'kitchen', label: 'Kitchen', type: 'stock-room', w: 1.4, dress: (b, r) => kitchen(b, r, 'mall-food-back')},
    {role: 'store', label: 'Dry store', type: 'storage', w: 0.9, dress: (b, r) => stockRoom(b, r, 'mall-food-back', 'grocery'), door: 3},
    {...wc, label: 'Washroom', front: true}, office,
  ]},
  diner: {floor: [['food-court', 1]], label: 'Dining room', type: 'eatery', back: 0.36, upper: 'offices', cuisine: ['burger', 'burger', 'deli', 'pizza', 'hotdog'], rooms: [
    {role: 'kitchen', label: 'Kitchen', type: 'stock-room', w: 1.7, dress: (b, r) => kitchen(b, r, 'mall-food-back'), door: 3},
    {role: 'cold', label: 'Walk-in fridge', type: 'storage', w: 0.8, dress: (b, r) => coldRoom(b, r, 'mall-food-back')},
    {role: 'store', label: 'Dry store', type: 'storage', w: 0.7, dress: (b, r) => stockRoom(b, r, 'mall-food-back', 'grocery')},
    {...wc, label: 'Washrooms', front: true}, office,
  ]},
};

/** The store programmes the planner implements here. */
export const STORE_SPEC_IDS = Object.keys(SPECS) as SurfaceProgrammeId[];

export function planStore(b: InteriorBuilder): void {
  const spec = SPECS[b.pid as SurfaceProgrammeId] ?? SPECS.convenience!;
  const rng = b.rng.fork('store');
  const {W, D} = b;
  const floor = rng.weighted(spec.floor);
  // --- storeys and the core -------------------------------------------------------------------------------------------------
  let n = Math.min(b.storeys.length, 3);
  let bd = Math.max(10, Math.min(18, Math.round(D * spec.back)));
  let core: ReturnType<InteriorBuilder['backCore']> = null;
  if (n >= 2) {
    const need = b.coreWidth(n) + 1 + 6;
    bd = Math.max(bd, Math.min(D - 16, need));
    core = b.backCore(n, bd - b.coreWidth(n) - 1);
    if (!core) n = 1;
  }
  let S = D - bd - 1; // the wall line between the sales floor and the back strip
  S = b.clearLine('v', S, Math.max(8, S - 4), S + 2, [0, W - 1]);
  if (core) {
    // the hall in front of the core starts just behind the wall line
    core.front = {...core.front, v: S + 1, dv: core.core.v - 1 - (S + 1)};
  }
  // --- street storey -------------------------------------------------------------------------------------------------------
  const front = (): LRect => ({u: 0, v: 0, du: W, dv: S});
  const region = (): LRect => core ? (core.at === 'hi' ? {u: 0, v: S + 1, du: W - core.core.du - 1, dv: D - S - 1} : {u: core.core.du + 1, v: S + 1, du: W - core.core.du - 1, dv: D - S - 1})
    : {u: 0, v: S + 1, du: W, dv: D - S - 1};
  let salesL = front(), cafeL: LRect | null = null;
  if (spec.cafe && W >= 30) {
    // the café corner: a third of the frontage at one end, a wide opening onto the shop
    const cw = Math.max(10, Math.round(W * 0.34));
    const right = rng.chance(0.5);
    let c = right ? W - cw - 1 : cw;
    c = b.clearLine('u', c, c - 4, c + 4, [0, S - 1]);
    salesL = right ? {u: 0, v: 0, du: c, dv: S} : {u: c + 1, v: 0, du: W - c - 1, dv: S};
    cafeL = right ? {u: c + 1, v: 0, du: W - c - 1, dv: S} : {u: 0, v: 0, du: c, dv: S};
  }
  const sale = b.room(0, salesL, {type: spec.type ?? 'shop', label: spec.label, role: 'sales', front: true, windows: 'shop', enemies: 2.2});
  const cafe = cafeL ? b.room(0, cafeL, {type: 'eatery', label: 'Café', role: 'cafe', front: true, windows: 'shop', enemies: 1}) : null;
  if (cafe) b.door(sale, cafe, 6, {at: 'mid', margin: 2});
  // the back strip: the first room (the stock room / dispensary / kitchen) stands in front of the core when there is one
  const rooms: {spec: Back; r: RoomInfo | null}[] = [];
  const order = spec.rooms.slice();
  if (core) {
    const first = order.shift()!;
    rooms.push({spec: first, r: b.room(0, core.front, {type: first.type, label: first.label, role: first.role, front: first.front, windows: first.windows ?? 'none', enemies: first.enemies ?? 1})});
  }
  const R = region();
  if (R.du >= 6) {
    const spans = b.split('u', R.u, R.u + R.du, order.map(q => q.w), 6, [R.v, R.v + R.dv - 1]);
    // fewer rooms than listed: the leading ones (the programme's defining rooms) are kept, the washroom last
    const kept = spans.length >= order.length ? order : [...order.slice(0, spans.length - 1), order[order.length - 1]].slice(0, spans.length);
    spans.forEach(([s, e], k) => {
      const q = kept[k];
      rooms.push({spec: q, r: b.room(0, {u: s, v: R.v, du: e - s, dv: R.dv}, {type: q.type, label: q.label, role: q.role, front: q.front, windows: q.windows ?? 'none', enemies: q.enemies ?? 1})});
    });
  }
  // doors: every back room onto the sales floor (or the café when it is the one in front of it), the rest chained
  for (const {spec: q, r} of rooms) {
    if (!r) continue;
    if (!b.door(r, sale, q.door ?? 2, {at: 'mid', staff: !q.front})) b.door(r, cafe, q.door ?? 2, {at: 'mid', staff: !q.front});
  }
  let landings: RoomInfo[] = [];
  if (core && n >= 2) {
    landings = b.carveCore(core.core, 'u', core.at === 'hi' ? 'lo' : 'hi', n);
    if (landings[0]) b.landingDoor(landings[0], rooms[0]?.r ?? null);
  }
  b.connectAll(0, sale);
  // --- upper storeys ---------------------------------------------------------------------------------------------------------
  const ups: {k: number; sales: RoomInfo | null; rest: RoomInfo[]; hall: RoomInfo | null}[] = [];
  for (let k = 1; k < n; k++) {
    if (!landings[k]) break;
    const hall = b.room(k, core!.front, {type: 'service-corridor', label: 'Upstairs hall', role: 'hall', windows: 'none', noLoose: true, enemies: 0.4});
    b.landingDoor(landings[k], hall);
    const top = spec.upper !== 'offices' && k === 1;
    const rest: RoomInfo[] = [];
    let upSales: RoomInfo | null = null;
    if (top) {
      upSales = b.room(k, front(), {type: 'shop', label: 'Upper floor', role: 'sales', front: true, windows: 'office', enemies: 1.6});
      b.door(hall, upSales, 4, {at: 'mid'});
    } else {
      const fs = b.split('u', 0, W, [1.2, 1.0, 0.8], 10, [0, S - 1]);
      const labels = [['Manager\'s office', 'office'], ['Storage', 'storage'], ['Staff room', 'staff']] as const;
      fs.forEach(([s, e], j) => {
        const r = b.room(k, {u: s, v: 0, du: e - s, dv: S}, {type: j === 1 ? 'storage' : j === 0 ? 'office-room' : 'crew-room', label: labels[j][0], role: labels[j][1], windows: 'office'});
        if (r) rest.push(r);
      });
    }
    if (R.du >= 6) {
      const bs = b.split('u', R.u, R.u + R.du, [1.4, 0.6], 6, [R.v, R.v + R.dv - 1]);
      bs.forEach(([s, e], j) => {
        const r = b.room(k, {u: s, v: R.v, du: e - s, dv: R.dv}, j === bs.length - 1 && bs.length > 1
          ? {type: 'washroom', label: 'Washroom', role: 'washroom', windows: 'small', enemies: 0.3}
          : {type: 'storage', label: 'Back store', role: 'store', windows: 'none'});
        if (r) rest.push(r);
      });
    }
    b.connectAll(k, hall);
    ups.push({k, sales: upSales, rest, hall});
  }
  // --- dressing -----------------------------------------------------------------------------------------------------------
  const cuisine = spec.cuisine ? rng.pick(spec.cuisine) : undefined;
  if (floor === 'convenience' || floor === 'liquor') convenienceFloor(b, sale, floor === 'liquor');
  else sales(b, sale, floor, cuisine ? {cuisine} : {});
  if (cafe) sales(b, cafe, 'cafe', {cuisine: 'coffee'});
  for (const {spec: q, r} of rooms) if (r) q.dress(b, r, sale);
  for (const u of ups) {
    if (u.sales) sales(b, u.sales, spec.upper as MallProgram, {front: 'B'});
    for (const r of u.rest) {
      if (r.role === 'office') privateOffice(b, r, true);
      else if (r.role === 'storage') copyRoom(b, r, true);
      else if (r.role === 'staff') breakRoom(b, r);
      else if (r.role === 'washroom') washroom(b, r);
      else if (r.role === 'store') stockRoom(b, r, 'storage', 'cartons');
    }
    if (u.hall && u.rest.length === 0 && !u.sales) janitor(b, u.hall);
  }
}
