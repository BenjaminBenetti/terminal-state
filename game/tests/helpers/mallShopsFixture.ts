// Task track3-eaton-centre-20261031 (lane SHOPS): a SYNTHETIC multi-ring mall for the shop tests (independent of lane GEN's generator).
// Each ring storey L (1..rings) at y = 5 L: a north service corridor, north stock rooms, north shop units (12 m deep), the gallery
// (6 m), south shop units (8 m deep), south stock rooms and a south service corridor; 1-cell walls between bands / units, a shopfront
// door per unit onto the gallery (piers either side), a staff door unit -> stock room and a service door stock room -> corridor.
// Storey 0 is a token station floor. Every grid has the same size / origin, y absolute (Area.floorY / ceil, grid floor / ceil).

import {CELL, FLOOR, Grid} from '../../src/gen/grid';
import type {Level} from '../../src/gen/levels';
import type {Area, Door, StationLayout} from '../../src/gen/stationTypes';
import type {MallInfo, MallShop, MallStorey} from '../../src/gen/mall/mallTypes';

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
  for (let L = 1; L <= rings; L++) {
    const gal = area({x: 2, y: ROWS.gallery[0], w: W - 4, h: ROWS.gallery[1] - ROWS.gallery[0] + 1}, L, 'concourse', 'concourse', `Level ${L} gallery`, true, 4.6);
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
  const mall = {version: 1, variant: 'synthetic', name: 'The Eaton\'s Center', storeys, void: null, galleries: [], shops, bridges: [], verticals: [], elevators: [],
    roof: null, patrol: [], subwayRoot: null, start: {x: 4, z: 23, yaw: 0, level: 0}} as unknown as MallInfo;
  const layout = {
    seed: 1, attempt: 0, name: 'synthetic mall', grid: grids[0], areas, doors, props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 4, z: 23, yaw: 0}, levels, levelLinks: [], rails: [], mall,
  } as unknown as StationLayout;
  return {layout, levels, rings};
}
