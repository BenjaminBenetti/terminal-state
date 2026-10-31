// Task track3-eaton-centre-20261031 (lane SHOPS): a SYNTHETIC multi-ring mall for the shop tests (independent of lane GEN's generator).
// Each ring storey L (1..rings) at y = 5 L: a north service corridor, north stock rooms, north shop units (12 m deep), the gallery
// (6 m), south shop units (8 m deep), south stock rooms and a south service corridor; 1-cell walls between bands / units, a shopfront
// door per unit onto the gallery (piers either side), a staff door unit -> stock room and a service door stock room -> corridor.
// mall.galleries lists each ring's gallery (the gallery commons pass furnishes it); no void / rails / runs (synthetic).
// Storey 0 is a token station floor. Every grid has the same size / origin, y absolute (Area.floorY / ceil, grid floor / ceil).

import {CELL, FLOOR, Grid} from '../../src/gen/grid';
import type {Level} from '../../src/gen/levels';
import type {Area, Door, StationLayout} from '../../src/gen/stationTypes';
import type {MallInfo, MallShop, MallStorey} from '../../src/gen/mall/mallTypes';
import {MALL_LOTS, type MallLotId} from '../../src/gen/mall/lots';

export const STOREY_H = 5;
const ROWS = {corrN: [1, 4], wallN: 5, backN: [6, 13], wallS1: 14, shopN: [15, 38], frontN: 39, gallery: [40, 51], frontS: 52, shopS: [53, 68], wallS2: 69,
  backS: [70, 77], wallS3: 78, corrS: [79, 82]} as const;
/** Unit widths (cells) along x, west to east; `d` = an optional shallower depth (cells) for kiosk-size units. */
const NORTH: {w: number; d?: number}[] = [{w: 18}, {w: 26}, {w: 14}, {w: 64}, {w: 20}, {w: 6, d: 7}, {w: 30}, {w: 22}];
const SOUTH: {w: number; d?: number}[] = [{w: 24}, {w: 16}, {w: 34}, {w: 12}, {w: 28}, {w: 20}, {w: 40}, {w: 22}];

export interface MallShopsFixture { layout: StationLayout; levels: Level[]; rings: number }

export function mallShopsFixture(rings = 2): MallShopsFixture {
  const W = 4 + Math.max(NORTH.reduce((s, u) => s + u.w + 1, 0), SOUTH.reduce((s, u) => s + u.w + 1, 0)), H = 86;
  const grids = Array.from({length: rings + 1}, () => new Grid(W, H));
  const areas: Area[] = [];
  const doors: Door[] = [];
  const shops: MallShop[] = [];
  const area = (r: {x: number; y: number; w: number; h: number}, L: number, kind: Area['kind'], type: Area['type'], label: string, pub: boolean, ceil: number): Area => {
    const a = {...r, id: areas.length, kind, type, label, ceil: L * STOREY_H + ceil, parent: -1, depth: 0, publicSpace: pub, lighting: 'lit', level: L} as Area;
    if (L) a.floorY = L * STOREY_H;
    areas.push(a);
    const g = grids[L];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = g.idx(x, y);
      g.cells[i] = FLOOR; g.floor[i] = L * STOREY_H; g.ceil[i] = L * STOREY_H + ceil; g.area[i] = a.id;
    }
    return a;
  };
  const door = (L: number, x: number, y: number, w: number, a: number, b: number, o: Partial<Door> = {}): Door => {
    const d: Door = {id: doors.length, x, y, w, h: 1, a, b, height: o.shopfront ? 3.2 : 2.3, arch: false, level: L, ...o};
    doors.push(d);
    const g = grids[L];
    for (let k = 0; k < w; k++) {
      const i = g.idx(x + k, y);
      g.cells[i] = FLOOR; g.floor[i] = L * STOREY_H; g.ceil[i] = L * STOREY_H + d.height; g.area[i] = b;
    }
    return d;
  };
  // storey 0: a token station floor
  area({x: 2, y: 40, w: W - 4, h: 12}, 0, 'platform', 'platform', 'platform', true, 4.4);
  const galleries: {level: number; areas: number[]}[] = [];
  for (let L = 1; L <= rings; L++) {
    const gal = area({x: 2, y: ROWS.gallery[0], w: W - 4, h: ROWS.gallery[1] - ROWS.gallery[0] + 1}, L, 'concourse', 'concourse', `Level ${L} gallery`, true, 4.6);
    galleries.push({level: L, areas: [gal.id]});
    const corrN = area({x: 2, y: ROWS.corrN[0], w: W - 4, h: 4}, L, 'service', 'service-corridor', 'service corridor', false, 3.0);
    const corrS = area({x: 2, y: ROWS.corrS[0], w: W - 4, h: 4}, L, 'service', 'service-corridor', 'service corridor', false, 3.0);
    const band = (units: {w: number; d?: number}[], north: boolean) => {
      let x = 2;
      units.forEach((u, k) => {
        const [s0, s1] = north ? ROWS.shopN : ROWS.shopS;
        const depth = u.d ?? s1 - s0 + 1;
        const y = north ? s1 + 1 - depth : s0;
        const sales = area({x, y, w: u.w, h: depth}, L, 'room', 'shop', 'unit', false, 4.4);
        const frontRow = north ? ROWS.frontN : ROWS.frontS;
        const fd = door(L, x + 1, frontRow, u.w - 2, gal.id, sales.id, {shopfront: true});
        let backroom: number | undefined;
        if (!u.d) {
          const [b0, b1] = north ? ROWS.backN : ROWS.backS;
          const back = area({x, y: b0, w: u.w, h: b1 - b0 + 1}, L, 'room', 'stock-room', 'stock room', false, 3.2);
          backroom = back.id;
          door(L, x + 1, north ? ROWS.wallS1 : ROWS.wallS2, 2, sales.id, back.id, {staff: true});
          door(L, x + 1, north ? ROWS.wallN : ROWS.wallS3, 2, north ? corrN.id : corrS.id, back.id, {staff: true});
        }
        shops.push({
          id: `L${L}-${north ? 'N' : 'S'}${String(k + 1).padStart(2, '0')}`, area: sales.id, ...(backroom !== undefined ? {backroom} : {}), level: L,
          program: 'vacant', kind: 'store', brand: '',
          frontage: {x0: fd.x * CELL, x1: (fd.x + fd.w) * CELL, z0: frontRow * CELL, z1: (frontRow + 1) * CELL, side: north ? 'S' : 'N'},
          salesArea: u.w * depth * CELL * CELL, depth: depth * CELL, width: u.w * CELL,
        });
        x += u.w + 1;
      });
    };
    band(NORTH, true);
    band(SOUTH, false);
  }
  const levels: Level[] = grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'upper', grid, baseY: id * STOREY_H}));
  const storeys: MallStorey[] = levels.map(l => ({level: l.id, label: l.id ? `Level ${l.id}` : 'Subway', baseY: l.baseY, clear: 4.4, role: l.id ? 'ring' : 'station'}));
  const mall = {version: 1, variant: 'synthetic', name: 'The Eaton\'s Center', storeys, void: null, galleries, shops, bridges: [], verticals: [], elevators: [],
    roof: null, patrol: [], subwayRoot: null, start: {x: 4, z: 23, yaw: 0, level: 0}} as unknown as MallInfo;
  const layout = {
    seed: 1, attempt: 0, name: 'synthetic mall', grid: grids[0], areas, doors, props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 4, z: 23, yaw: 0}, levels, levelLinks: [], rails: [], mall,
  } as unknown as StationLayout;
  return {layout, levels, rings};
}

// ---------------------------------------------------------------------------------------------
// Task mall-playtest-revision-20261031 (lane SHOPS): a SYNTHETIC LOT-FAMILY storey (independent of lane GEN's carver) — one retail
// floor (level 1, y 5) with every lot family of gen/mall/lots.ts at seeded sizes inside its ranges: a west END unit closing the gallery,
// north / south bands of in-line units along a 6 m gallery (standard, narrow boutique, compact, RECESSED behind a public vestibule,
// food counters, kiosk cells, a deep ANCHOR, a wide SHOWROOM with a side stock room) and a CORNER unit at the north-east end with a
// second shopfront onto an east walkway. Stock rooms follow each family's policy (none / small rear / rear / side / rear + a staff
// door onto a short service corridor). MallShop records carry lot / zone / frontages / stock / stockArea / serviceDoor / recess like
// GEN's contract (gen/mall/mallTypes.ts).


const LOT_NORTH: MallLotId[] = ['standard-line', 'narrow-boutique', 'compact-square', 'recessed-arcade', 'food-counter', 'food-counter', 'kiosk-cell', 'anchor-deep', 'corner-double'];
const LOT_SOUTH: MallLotId[] = ['wide-showroom', 'compact-square', 'narrow-boutique', 'standard-line', 'kiosk-cell', 'food-counter', 'compact-square', 'standard-line'];

export interface MallLotsFixture extends MallShopsFixture { gallery: number; walkway: number }

export function mallLotsFixture(seed = 1): MallLotsFixture {
  let st = (seed * 2654435761) >>> 0;
  const rand = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (r: readonly [number, number]) => Math.round((r[0] + (r[1] - r[0]) * rand()) / CELL); // cells
  const L = 1, base = L * STOREY_H;
  const FN = 60, GAL = 12, FS = FN + GAL + 1; // north frontage row, gallery rows FN+1..FN+12, south frontage row
  const unitsN = LOT_NORTH.map(id => ({id, w: pick(MALL_LOTS[id].width), d: pick(MALL_LOTS[id].depth), sd: pick(MALL_LOTS[id].stockSize), rc: MALL_LOTS[id].recess ? pick(MALL_LOTS[id].recess!) : 0}));
  const unitsS = LOT_SOUTH.map(id => ({id, w: pick(MALL_LOTS[id].width), d: Math.min(pick(MALL_LOTS[id].depth), 26), sd: pick(MALL_LOTS[id].stockSize), rc: 0}));
  const end = {id: 'end-unit' as MallLotId, w: pick(MALL_LOTS['end-unit'].width), d: pick(MALL_LOTS['end-unit'].depth), sd: pick(MALL_LOTS['end-unit'].stockSize)};
  const side = (u: {id: MallLotId}) => MALL_LOTS[u.id].stock === 'side';
  const runW = (us: {id: MallLotId; w: number; sd: number}[]) => us.reduce((s, u) => s + u.w + 1 + (side(u) ? u.sd + 1 : 0), 0);
  const X0 = 2 + end.sd + 1 + end.d + 1; // first gallery column (west end unit + its rear store to the west)
  const WALK = 12; // east walkway (6 m)
  const EX = X0 + Math.max(runW(unitsN), runW(unitsS)); // east walkway first column
  const W = EX + WALK + 3, H = FS + 1 + 26 + 1 + 10 + 9;
  const grids = [new Grid(W, H), new Grid(W, H)];
  const areas: Area[] = [];
  const doors: Door[] = [];
  const shops: MallShop[] = [];
  const area = (r: {x: number; y: number; w: number; h: number}, kind: Area['kind'], type: Area['type'], label: string, pub: boolean, ceil: number, lv = L): Area => {
    const a = {...r, id: areas.length, kind, type, label, ceil: lv * STOREY_H + ceil, parent: -1, depth: 0, publicSpace: pub, lighting: 'lit', level: lv} as Area;
    if (lv) a.floorY = lv * STOREY_H;
    areas.push(a);
    const g = grids[lv];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = g.idx(x, y);
      g.cells[i] = FLOOR; g.floor[i] = lv * STOREY_H; g.ceil[i] = lv * STOREY_H + ceil; g.area[i] = a.id;
    }
    return a;
  };
  const door = (x: number, y: number, w: number, h: number, a: number, b: number, o: Partial<Door> = {}): Door => {
    const d: Door = {id: doors.length, x, y, w, h, a, b, height: o.shopfront ? 3.2 : 2.3, arch: false, level: L, ...o};
    doors.push(d);
    const g = grids[L];
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = g.idx(xx, yy);
      g.cells[i] = FLOOR; g.floor[i] = base; g.ceil[i] = base + d.height; g.area[i] = b;
    }
    return d;
  };
  area({x: 2, y: FN, w: W - 4, h: 12}, 'platform', 'platform', 'platform', true, 4.4, 0);
  const gal = area({x: X0, y: FN + 1, w: EX - X0, h: GAL}, 'concourse', 'concourse', 'Level 1 gallery', true, 4.6);
  const walk = area({x: EX, y: FN - 30, w: WALK, h: 30 + 1 + GAL}, 'concourse', 'concourse', 'Level 1 east walkway', true, 4.6);
  const m2 = (cells: number) => cells * CELL * CELL;
  const record = (id: string, lotId: MallLotId, sales: Area, front: {x0: number; x1: number; z0: number; z1: number; side: 'N' | 'S' | 'E' | 'W'}, o: {back?: Area; serviceDoor?: boolean; recess?: number; frontages?: MallShop['frontages']; zone: MallShop['zone']}) => {
    const lot = MALL_LOTS[lotId];
    const along = front.side === 'N' || front.side === 'S';
    shops.push({
      id, area: sales.id, ...(o.back ? {backroom: o.back.id} : {}), level: L, program: 'vacant', kind: 'store', brand: '', frontage: front,
      salesArea: m2(sales.w * sales.h), depth: (along ? sales.h : sales.w) * CELL, width: (along ? sales.w : sales.h) * CELL,
      lot: lotId, zone: o.zone, stock: o.back ? lot.stock : 'none', stockArea: o.back ? m2(o.back.w * o.back.h) : 0, ...(o.serviceDoor ? {serviceDoor: true} : {}),
      ...(o.recess !== undefined ? {recess: o.recess} : {}), ...(o.frontages ? {frontages: o.frontages} : {}),
    });
  };
  /** Rear stock (north: above the unit; south: below), + a short service corridor behind it for 'service-corridor'. */
  const rear = (u: {id: MallLotId; w: number; sd: number}, x: number, salesTop: number, salesBot: number, north: boolean, sales: Area) => {
    const pol = MALL_LOTS[u.id].stock;
    if (pol === 'none' || pol === 'side' || u.sd <= 0) return {back: undefined as Area | undefined, serviceDoor: false};
    const y = north ? salesTop - 1 - u.sd : salesBot + 2;
    const back = area({x, y, w: u.w, h: u.sd}, 'room', 'stock-room', 'stock room', false, 3.2);
    door(x + 1, north ? salesTop - 1 : salesBot + 1, 2, 1, sales.id, back.id, {staff: true});
    if (pol !== 'service-corridor') return {back, serviceDoor: false};
    const cy = north ? y - 1 - 4 : y + u.sd + 1;
    const corr = area({x, y: cy, w: u.w, h: 4}, 'service', 'service-corridor', 'service corridor', false, 3.0);
    door(x + 1, north ? y - 1 : y + u.sd, 2, 1, corr.id, back.id, {staff: true});
    return {back, serviceDoor: true};
  };
  // west end unit: across the gallery's west end, its frontage (E side) facing straight down the gallery; rear store to the west
  {
    const ex = 2 + end.sd + 1, ey = FN + 1 + Math.round(GAL / 2) - Math.round(end.w / 2);
    const sales = area({x: ex, y: ey, w: end.d, h: end.w}, 'room', 'shop', 'unit', false, 4.4);
    const fd = door(ex + end.d, FN + 1, 1, GAL, gal.id, sales.id, {shopfront: true});
    const back = area({x: 2, y: ey, w: end.sd, h: end.w}, 'room', 'stock-room', 'stock room', false, 3.2);
    door(2 + end.sd, ey + 1, 1, 2, sales.id, back.id, {staff: true});
    record('L1-W01', 'end-unit', sales, {x0: fd.x * CELL, x1: (fd.x + 1) * CELL, z0: fd.y * CELL, z1: (fd.y + fd.h) * CELL, side: 'E'}, {back, zone: 'end'});
  }
  for (const [north, list] of [[true, unitsN], [false, unitsS]] as const) {
    let x = X0;
    list.forEach((u, k) => {
      const id = `L1-${north ? 'N' : 'S'}${String(k + 1).padStart(2, '0')}`;
      const lot = MALL_LOTS[u.id];
      if (north && u.id === 'corner-double') {
        // the corner unit: east end of the north band, x .. EX - 1, frontages S (gallery) and E (walkway)
        const w = EX - 1 - x, y = FN - u.d;
        const sales = area({x, y, w, h: u.d}, 'room', 'shop', 'unit', false, 4.4);
        const f1 = door(x + 1, FN, Math.max(2, w - 2), 1, gal.id, sales.id, {shopfront: true});
        const f2 = door(EX - 1, y + 1, 1, Math.max(2, u.d - 2), walk.id, sales.id, {shopfront: true});
        // side store at the unit's west end is the band's previous wall; put it behind (north) instead: a rear closet
        const back = area({x, y: y - 1 - u.sd, w, h: u.sd}, 'room', 'stock-room', 'stock room', false, 3.2);
        door(x + 1, y - 1, 2, 1, sales.id, back.id, {staff: true});
        const fr1 = {x0: f1.x * CELL, x1: (f1.x + f1.w) * CELL, z0: FN * CELL, z1: (FN + 1) * CELL, side: 'S' as const};
        const fr2 = {x0: (EX - 1) * CELL, x1: EX * CELL, z0: f2.y * CELL, z1: (f2.y + f2.h) * CELL, side: 'E' as const};
        record(id, u.id, sales, fr1, {back, frontages: [fr1, fr2], zone: 'corner'});
        return;
      }
      const rc = u.rc;
      const salesTop = north ? FN - rc - u.d : FS + 1, salesBot = north ? FN - rc - 1 : FS + u.d;
      const sales = area({x, y: salesTop, w: u.w, h: u.d}, 'room', 'shop', 'unit', false, lot.shape === 'counter' || lot.shape === 'cell' ? 3.6 : 4.4);
      let recess: number | undefined;
      if (rc) {
        // public vestibule between the gallery and the recessed shopfront (window bays either side); MallShop.recess = its area id
        recess = area({x, y: FN - rc + 1, w: u.w, h: rc}, 'concourse', 'concourse', 'vestibule', true, 4.0).id;
      }
      const frontRow = north ? FN - rc : FS;
      const fd = door(x + 1, frontRow, u.w - 2, 1, recess ?? gal.id, sales.id, {shopfront: true});
      let back: Area | undefined, serviceDoor = false;
      if (lot.stock === 'side' && u.sd > 0) {
        back = area({x: x + u.w + 1, y: salesTop, w: u.sd, h: u.d}, 'room', 'stock-room', 'stock room', false, 3.2);
        door(x + u.w, salesTop + 1, 1, 2, sales.id, back.id, {staff: true});
      } else ({back, serviceDoor} = rear(u, x, salesTop, salesBot, north, sales));
      const zone: MallShop['zone'] = lot.shape === 'counter' ? 'food' : rc ? 'corridor' : lot.shape === 'deep' ? 'court' : 'atrium';
      record(id, u.id, sales, {x0: fd.x * CELL, x1: (fd.x + fd.w) * CELL, z0: frontRow * CELL, z1: (frontRow + 1) * CELL, side: north ? 'S' : 'N'}, {back, serviceDoor, recess, zone});
      x += u.w + 1 + (lot.stock === 'side' && u.sd > 0 ? u.sd + 1 : 0);
    });
  }
  const levels: Level[] = grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: id * STOREY_H}));
  const storeys: MallStorey[] = levels.map(l => ({level: l.id, label: l.id ? `Level ${l.id}` : 'Subway', baseY: l.baseY, clear: 4.4, role: l.id ? 'ring' : 'station'}));
  const mall = {version: 2, variant: 'synthetic-lots', name: 'Synthetic Center', storeys, void: null, galleries: [{level: L, areas: [gal.id, walk.id]}], shops, bridges: [], verticals: [],
    elevators: [], roof: null, patrol: [], subwayRoot: null, start: {x: 4, z: (FN + 6) * CELL, yaw: 0, level: 0}} as unknown as MallInfo;
  const layout = {
    seed, attempt: 0, name: 'synthetic lots mall', grid: grids[0], areas, doors, props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 4, z: (FN + 6) * CELL, yaw: 0}, levels, levelLinks: [], rails: [], mall,
  } as unknown as StationLayout;
  return {layout, levels, rings: 1, gallery: gal.id, walkway: walk.id};
}
