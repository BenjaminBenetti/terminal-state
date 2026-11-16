// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the SMALL SHOPPING CENTRES — every unit its own mini-programme
// (a Mall shop programme: phone shop, jeweller, optician, florist, shoe shop, pet shop, record shop, café, a food counter … each with its
// stock room dressed by the Mall's stock-room recipe), off a shared walkway:
//  - 'strip-centre': a glazed GALLERY along the street front, 3-6 units behind it, a passage to the toilets and the SERVICE CORRIDOR along
//    the back (deliveries: every stock room has a staff door onto it); with a second storey the stair core sits on the back wall behind
//    the service corridor and the upper floor is OFFICE SUITES over the shops (dentist, insurance, accountant …) off an upper corridor;
//  - 'arcade': a covered ARCADE running in from the street door with units both sides, a rear concourse with the toilets and, with a
//    second storey, the stair core at the arcade's far end and a second arcade of units above.

import type {MallProgram} from '../../mall/mallTypes';
import type {Rng} from '../../../core/rng';
import type {InteriorBuilder, LRect, LSide, RoomInfo} from './builder';
import {
  backOffice, backRoom, copyRoom, janitor, meetingRoom, openPlan, privateOffice, sales, washroom,
} from './dress';
import {examRoom} from './civic';

/** Unit programmes (Mall shop programmes that dress without a Mall shop record). */
export const UNIT_PROGRAMMES: readonly MallProgram[] = [
  'phone', 'jewelry', 'beauty', 'optical', 'florist', 'shoes', 'luggage', 'toys', 'pet', 'music', 'books', 'cafe', 'food-court', 'clothing',
  'womenswear', 'electronics', 'pharmacy', 'outdoors', 'home', 'sports',
];
const CUISINES = ['burger', 'pizza', 'noodles', 'deli', 'sushi', 'shawarma', 'hotdog'] as const;
const CAFES = ['coffee', 'bakery', 'donut', 'juice'] as const;
const LABEL: Partial<Record<MallProgram, string>> = {
  phone: 'Phone shop', jewelry: 'Jeweller', beauty: 'Beauty bar', optical: 'Optician', florist: 'Florist', shoes: 'Shoe shop', luggage: 'Luggage shop',
  toys: 'Toy shop', pet: 'Pet shop', music: 'Record shop', books: 'Bookshop', cafe: 'Café', 'food-court': 'Take-away', clothing: 'Clothes shop',
  womenswear: 'Boutique', electronics: 'Electronics shop', pharmacy: 'Chemist', outdoors: 'Outdoor shop', home: 'Homewares', sports: 'Sports shop', vacant: 'Vacant unit',
};

interface Unit { prog: MallProgram; sale: RoomInfo | null; stock: RoomInfo | null; front: LSide; cuisine?: string }

/** Picks distinct unit programmes for a centre (seeded), with now and then a vacant unit. */
function pickUnits(rng: Rng, n: number): MallProgram[] {
  const pool = rng.shuffle(UNIT_PROGRAMMES.slice());
  const out: MallProgram[] = [];
  for (let k = 0; k < n; k++) out.push(k > 1 && rng.chance(0.12) ? 'vacant' : pool[k % pool.length]);
  return out;
}

/** One unit: the sales floor toward the walkway, its stock room behind (when deep enough), doors between. */
function unit(b: InteriorBuilder, k: number, L: LRect, frontSide: LSide, prog: MallProgram, rng: Rng, walk: RoomInfo | null): Unit {
  const along: 'u' | 'v' = frontSide === 'F' || frontSide === 'B' ? 'v' : 'u';
  const depth = along === 'v' ? L.dv : L.du;
  const label = LABEL[prog] ?? 'Shop';
  const cuisine = prog === 'food-court' ? rng.pick(CUISINES) : prog === 'cafe' ? rng.pick(CAFES) : undefined;
  let saleL = L, stockL: LRect | null = null;
  if (depth >= 22) {
    const sd = Math.max(7, Math.min(12, Math.round(depth * 0.3)));
    // the stock room at the far end from the walkway
    if (frontSide === 'F') { saleL = {...L, dv: L.dv - sd - 1}; stockL = {...L, v: L.v + L.dv - sd, dv: sd}; }
    else if (frontSide === 'B') { saleL = {...L, v: L.v + sd + 1, dv: L.dv - sd - 1}; stockL = {...L, dv: sd}; }
    else if (frontSide === 'L') { saleL = {...L, du: L.du - sd - 1}; stockL = {...L, u: L.u + L.du - sd, du: sd}; }
    else { saleL = {...L, u: L.u + sd + 1, du: L.du - sd - 1}; stockL = {...L, du: sd}; }
  }
  const food = prog === 'food-court' || prog === 'cafe';
  const sale = b.room(k, saleL, {type: food ? 'eatery' : 'shop', label: `${label}`, role: 'unit', front: true, windows: 'shop', enemies: 1.2});
  const stock = stockL ? b.room(k, stockL, {type: 'stock-room', label: `${label} · Stock room`, role: 'unit-stock', windows: 'none', enemies: 0.6}) : null;
  // the shop door onto the walkway: a wide opening (a shopfront's doorway), the stock room's staff door behind the counter
  b.door(sale, walk, prog === 'vacant' ? 3 : Math.min(6, Math.max(3, Math.round((along === 'v' ? L.du : L.dv) * 0.35))), {at: 'mid', margin: 2});
  b.door(stock, sale, 2, {at: rng.chance(0.5) ? 'lo' : 'hi', staff: true});
  return {prog, sale, stock, front: frontSide, ...(cuisine ? {cuisine} : {})};
}

function dressUnits(b: InteriorBuilder, units: readonly Unit[]): void {
  for (const u of units) {
    if (!u.sale) continue;
    sales(b, u.sale, u.prog, {front: u.front, ...(u.cuisine ? {cuisine: u.cuisine} : {})});
    if (u.stock) backRoom(b, u.stock, u.sale, u.prog === 'vacant' ? 'home' : u.prog);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Strip centre

export function planStripCentre(b: InteriorBuilder): void {
  const rng = b.rng.fork('strip');
  const {W, D} = b;
  let n = Math.min(b.storeys.length, 2);
  const G = D >= 44 ? 8 : 6;
  // the back: a 2 m service corridor and, behind it on the back wall, a 2 m strip for the toilets / centre office (and the core)
  const deep = D - G - 1 - 10 >= 22;
  const sd = deep ? 9 : 5;
  let core: ReturnType<InteriorBuilder['backCore']> = null;
  if (n >= 2 && deep) core = b.backCore(2, 4);
  if (!core) n = 1;
  const L = core ? core.core.du : 0;
  const Dz = D - sd - 1; // units zone v in [G + 1, Dz)
  const gallery = b.room(0, {u: 0, v: 0, du: W, dv: G}, {type: 'retail-arcade', label: 'Gallery', role: 'gallery', front: true, windows: 'shop', enemies: 1.4, publicSpace: true});
  const corrL: LRect = {u: 0, v: Dz + 1, du: W, dv: deep ? 4 : sd};
  const corridor = b.room(0, corrL, {type: 'service-corridor', label: 'Service corridor', role: 'service', windows: 'none', noLoose: true, enemies: 0.6});
  // the slots: 3-6 units and the toilet passage (never at the very end: the end units keep the side windows)
  const nUnits = Math.max(3, Math.min(6, Math.round(W / 24)));
  const weights = Array.from({length: nUnits + 1}, (_, k) => (k === 1 ? 0.45 : rng.range(0.8, 1.4)));
  const spans = b.split('u', 0, W, weights, 8, [G + 1, Dz - 1]);
  const progs = pickUnits(rng, spans.length);
  const units: Unit[] = [];
  let passage: RoomInfo | null = null;
  spans.forEach(([s, e], k) => {
    if (k === 1 && spans.length > 2) {
      passage = b.room(0, {u: s, v: G + 1, du: e - s, dv: Dz - G - 1}, {type: 'passage', label: 'Toilets passage', role: 'passage', windows: 'none', noLoose: true, enemies: 0.4, publicSpace: true});
      b.door(passage, gallery, Math.min(4, e - s - 2), {at: 'mid', margin: 1});
      b.door(passage, corridor, Math.min(3, e - s - 2), {at: 'mid', staff: true});
      return;
    }
    const un = unit(b, 0, {u: s, v: G + 1, du: e - s, dv: Dz - G - 1}, 'F', progs[k], rng, gallery);
    units.push(un);
    b.door(un.stock ?? un.sale, corridor, 2, {at: 'mid', staff: true});
  });
  // the toilets and the centre office on the back wall behind the service corridor (beside the core when there is one)
  const backZone: LRect | null = !deep ? null : core ? (core.at === 'hi' ? {u: 0, v: D - 4, du: W - L - 1, dv: 4} : {u: L + 1, v: D - 4, du: W - L - 1, dv: 4})
    : {u: 0, v: D - 4, du: W, dv: 4};
  const backRooms: RoomInfo[] = [];
  if (backZone && backZone.du >= 8) {
    const bs = b.split('u', backZone.u, backZone.u + backZone.du, [1, 1, 0.8, 0.6], 6, [backZone.v, D - 1]);
    const roles = [['Washrooms', 'washroom'], ['Washrooms', 'washroom'], ['Centre office', 'office'], ['Cleaner\'s store', 'janitor']] as const;
    bs.forEach(([s, e], k) => {
      const q = roles[k];
      const r = b.room(0, {u: s, v: backZone.v, du: e - s, dv: backZone.dv}, {type: q[1] === 'washroom' ? 'washroom' : q[1] === 'office' ? 'agent-office' : 'janitor-closet',
        label: q[0], role: q[1], windows: 'none', enemies: 0.3});
      if (r) { backRooms.push(r); b.door(r, corridor, 2, {at: 'mid', staff: q[1] !== 'washroom'}); }
    });
  }
  let landings: RoomInfo[] = [];
  if (core) {
    landings = b.carveCore(core.core, 'u', core.at === 'hi' ? 'lo' : 'hi', 2);
    if (landings[0]) b.landingDoor(landings[0], corridor);
  }
  b.connectAll(0, gallery);
  // --- the office suites upstairs -------------------------------------------------------------------------------------------
  const suites: {front: RoomInfo | null; back: RoomInfo | null; kind: string}[] = [];
  if (core && landings[1]) {
    const upCorr = b.room(1, corrL, {type: 'office-corridor', label: 'Upper corridor', role: 'corridor', windows: 'none', noLoose: true, enemies: 0.5});
    b.landingDoor(landings[1], upCorr);
    const ss = b.split('u', 0, W, Array.from({length: Math.max(2, Math.min(5, Math.round(W / 30)))}, () => rng.range(0.8, 1.3)), 14, [0, Dz - 1]);
    const kinds = rng.shuffle(['dentist', 'insurance', 'accountant', 'lawyer', 'travel', 'realty'] as const);
    ss.forEach(([s, e], k) => {
      const kind = kinds[k % kinds.length];
      const fd = Math.round(Dz * 0.55);
      const name = SUITE_LABEL[kind];
      const front = b.room(1, {u: s, v: 0, du: e - s, dv: fd}, {type: 'office-room', label: `${name}`, role: 'suite', front: true, windows: 'office', enemies: 1});
      const back = b.room(1, {u: s, v: fd + 1, du: e - s, dv: Dz - fd - 1}, {type: 'office-room', label: `${name} · Back office`, role: 'suite-back', windows: 'none', enemies: 0.6});
      b.door(front, back, 2, {at: 'mid'});
      b.door(back, upCorr, 2, {at: 'mid'});
      suites.push({front, back, kind});
    });
    if (backZone && backZone.du >= 8) {
      const r = b.room(1, backZone, {type: 'storage', label: 'Plant room', role: 'plant', windows: 'none', enemies: 0.2});
      b.door(r, upCorr, 2, {at: 'mid', staff: true});
      if (r) backRooms.push(r);
    }
    b.connectAll(1, upCorr);
  }
  // --- dressing --------------------------------------------------------------------------------------------------------------
  dressUnits(b, units);
  if (passage) janitor(b, passage);
  for (const r of backRooms) {
    if (r.role === 'washroom') washroom(b, r);
    else if (r.role === 'office') backOffice(b, r, 'mall-management', true);
    else if (r.role === 'janitor') janitor(b, r);
    else if (r.role === 'plant') backRoom(b, r, null, 'home', 'storage');
  }
  for (const s of suites) dressSuite(b, s.front, s.back, s.kind);
}

const SUITE_LABEL: Record<string, string> = {
  dentist: 'Dental surgery', insurance: 'Insurance office', accountant: 'Accountants', lawyer: 'Law office', travel: 'Travel agent', realty: 'Estate agent',
};
function dressSuite(b: InteriorBuilder, front: RoomInfo | null, back: RoomInfo | null, kind: string): void {
  if (kind === 'dentist') { examRoom(b, front, 'reception'); examRoom(b, back); return; }
  if (front && front.area.w * front.area.h >= 300) openPlan(b, front, 'office-open'); else privateOffice(b, front);
  if (kind === 'lawyer' || kind === 'accountant') copyRoom(b, back, true);
  else if (kind === 'insurance') meetingRoom(b, back);
  else backOffice(b, back, 'office-private');
}

// ---------------------------------------------------------------------------------------------------------------------------
// Arcade

export function planArcade(b: InteriorBuilder): void {
  const rng = b.rng.fork('arcade');
  const {W, D} = b;
  let n = Math.min(b.storeys.length, 2);
  const main = b.ents.find(e => e.e.main && e.local === 'F') ?? b.ents.find(e => e.local === 'F');
  // the arcade is at least the main door's width plus its jambs wide (the doorway lands inside it)
  const Sw = Math.min(W - 2, Math.max(W >= 60 ? 10 : 8, main ? main.s1 - main.s0 + 3 : 0));
  const mid = main ? Math.round((main.s0 + main.s1 + 1) / 2) : Math.round(W / 2);
  let su = Math.max(10, Math.min(W - Sw - 10, mid - Math.floor(Sw / 2)));
  // the arcade's walls clear of the main door (the door lands inside the arcade)
  if (main && (main.s0 < su || main.s1 >= su + Sw)) su = Math.max(1, Math.min(W - Sw - 1, main.s0 - Math.max(1, Math.floor((Sw - (main.s1 - main.s0 + 1)) / 2))));
  const CW = b.coreWidth(2), L = b.coreLength(2);
  if (n >= 2 && (D < L + 14 || Sw < CW + 4)) n = 1;
  const coreV = D - L; // the core along v at the arcade's far end, against its right-hand wall
  const arcade = b.room(0, {u: su, v: 0, du: Sw, dv: n >= 2 ? coreV - 1 : D}, {type: 'retail-arcade', label: 'Arcade', role: 'arcade', front: true, windows: 'shop', enemies: 1.6, publicSpace: true});
  let rear: RoomInfo | null = null, landings: RoomInfo[] = [];
  const rearL: LRect = {u: su, v: coreV, du: Sw - CW - 1, dv: L};
  if (n >= 2) {
    landings = b.carveCore({u: su + Sw - CW, v: coreV, du: CW, dv: L}, 'v', 'lo', 2);
    rear = b.room(0, rearL, {type: 'passage', label: 'Rear concourse', role: 'rear', windows: 'none', noLoose: true, enemies: 0.5, publicSpace: true});
    b.door(rear, arcade, Math.min(4, rearL.du - 2), {at: 'mid', margin: 1});
    if (landings[0]) b.landingDoor(landings[0], arcade);
  }
  const side = (k: number, walk: RoomInfo | null): {units: Unit[]; extra: RoomInfo[]} => {
    const units: Unit[] = [], extra: RoomInfo[] = [];
    const blocks: [LRect, LSide][] = [[{u: 0, v: 0, du: su - 1, dv: D}, 'R'], [{u: su + Sw + 1, v: 0, du: W - su - Sw - 1, dv: D}, 'L']];
    for (const [Z, face] of blocks) {
      if (Z.du < 8) continue;
      const nU = Math.max(2, Math.min(4, Math.round(Z.dv / 18)));
      const spans = b.split('v', 0, D, Array.from({length: nU}, () => rng.range(0.8, 1.3)), 12, [Z.u, Z.u + Z.du - 1]);
      const progs = pickUnits(rng, spans.length);
      spans.forEach(([s, e], j) => {
        // the back unit on the left-hand side: the toilets block (off the arcade / the rear concourse beside the core)
        if (k === 0 && j === spans.length - 1 && face === 'R' && e - s >= 10) {
          const wcA = b.room(k, {u: Z.u, v: s, du: Z.du, dv: e - s}, {type: 'washroom', label: 'Washrooms', role: 'washroom', windows: 'none', enemies: 0.3});
          if (wcA) extra.push(wcA);
          return;
        }
        units.push(unit(b, k, {u: Z.u, v: s, du: Z.du, dv: e - s}, face, progs[j], rng, walk));
      });
    }
    return {units, extra};
  };
  const g0 = side(0, arcade);
  b.connectAll(0, arcade);
  let g1: ReturnType<typeof side> | null = null;
  if (n >= 2 && landings[1]) {
    const upper = b.room(1, {u: su, v: 0, du: Sw, dv: coreV - 1}, {type: 'retail-arcade', label: 'Upper arcade', role: 'arcade', front: true, windows: 'office', enemies: 1.2, publicSpace: true});
    const upRear = b.room(1, rearL, {type: 'passage', label: 'Upper concourse', role: 'rear', windows: 'none', noLoose: true, enemies: 0.3, publicSpace: true});
    b.landingDoor(landings[1], upRear);
    b.door(upRear, upper, Math.min(4, rearL.du - 2), {at: 'mid', margin: 1});
    g1 = side(1, upper);
    b.connectAll(1, upper);
  }
  // --- dressing ---------------------------------------------------------------------------------------------------------------
  dressUnits(b, g0.units);
  for (const r of g0.extra) washroom(b, r);
  if (g1) { dressUnits(b, g1.units); for (const r of g1.extra) washroom(b, r); }
  if (rear) janitor(b, rear);
}
