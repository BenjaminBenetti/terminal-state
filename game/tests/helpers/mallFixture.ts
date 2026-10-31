// Task track3-eaton-centre-20261031 (lane ARCH): a fully SYNTHETIC mall for the atrium render / culling / light-field tests (no
// generator: lane GEN's skeleton is tested on its own). Same conventions as tests/helpers/towerFixture.ts (every storey grid has
// the main grid's size / origin, all y absolute) and the GEN representation (lanes/GEN.notes): the pit-bottom storey's band in
// the void rises to the roof apex; every ring CLOSES the void cells (rails on the gallery edges are derived drop edges).
//
//   cells 0.5 m: W 140 (70 m) x H 132 (66 m) — depths like GEN's units: gallery 4 m, sales floor 11.5 m, stock room 4.5 m
//   storeys   0 = station / plaza (y 0, ceiling 4.8 under the galleries), rings 1..6 at y 6 + 5 (k - 1) (clear 3.8, slabs 1.2)
//   void      x 20..50, z 24..40 (the atrium: level-0 band 0..43 = the vault apex); roof spring 36, apex 43, arches every 6 m
//   level 0   concourse x 4..66, z 12..52 (plaza courts); platform x 20..50, z 29..34 (under the void); track bed (VOID,
//             -1.15) x 20..50, z 34..38; glass elevator shaft x 47..50, z 30..33 (SOLID on every storey)
//   rings     gallery x 16..54, z 20..44 around the void; shops north z 8..19.5 (5 units, stock rooms z 3..7.5) and south
//             z 44.5..56 (5 units, stock rooms z 56.5..61), west / east x 4..15.5 / 54.5..66 (1 unit each); back-of-house service
//             corridors z 0.5..2.5 and 61.5..63.5 (21.5 m from the void edge)
//   ring 3    a 3 m bridge across the void at x 33.5..36.5 (deck band to the apex)
import {CELL, FLOOR, Grid, SOLID, VOID} from '../../src/gen/grid';
import type {Level, LevelRole} from '../../src/gen/levels';
import type {Area, Door, LightPlacement, StationLayout, Trench} from '../../src/gen/station';
import type {MallInfo, MallProgram, MallShop, MallStorey} from '../../src/gen/mall/mallTypes';

export const MALL_FIX = {
  W: 140, H: 132, rings: 6, clear: 3.8, stationCeil: 4.8, spring: 36, apex: 43, bedY: -1.15,
  void: {x0: 20, z0: 24, x1: 50, z1: 40},
  concourse: {x0: 4, z0: 12, x1: 66, z1: 52},
  platform: {x0: 20, z0: 29, x1: 50, z1: 34},
  bed: {x0: 20, z0: 34, x1: 50, z1: 38},
  shaft: {x0: 47, z0: 30, x1: 50, z1: 33},
  gallery: {x0: 16, z0: 20, x1: 54, z1: 44},
  bridge: {x0: 33.5, x1: 36.5, ring: 3},
  corridorN: {x0: 2, z0: 0.5, x1: 68, z1: 2.5},
  corridorS: {x0: 2, z0: 61.5, x1: 68, z1: 63.5},
  /** Platform eye / start. */
  start: {x: 30, z: 31.5},
} as const;

/** World floor y of storey L. */
export const mallY = (L: number): number => (L === 0 ? 0 : 6 + 5 * (L - 1));

const PROGRAMS: MallProgram[] = ['guns', 'pharmacy', 'electronics', 'clothing', 'food-court', 'books', 'toys', 'jewelry', 'sports', 'cafe', 'hardware', 'beauty'];
const BRANDS = ['Northline Arms', 'Greenleaf Pharmacy', 'Voltage Electronics', 'Maple & Oak', 'Food Hall', 'Paper Lantern Books', 'Tumble Toys', 'Gilded Hour', 'Peak Athletic', 'Bean There', 'Bolt & Beam', 'Rosewater'];

export interface MallFixture {
  layout: StationLayout & {mall: MallInfo};
  levels: Level[];
  /** Area ids: gallery / bridge / corridors / shops per ring. */
  gallery: number[];
  bridge: number;
  corridors: number[][];
  shops: MallShop[];
  plaza: number;
  platform: number;
}

type MRect = {x0: number; z0: number; x1: number; z1: number};
const cellsOf = (r: MRect) => ({x: Math.round(r.x0 / CELL), y: Math.round(r.z0 / CELL), w: Math.round((r.x1 - r.x0) / CELL), h: Math.round((r.z1 - r.z0) / CELL)});

export function mallFixture(opts: {lights?: boolean} = {}): MallFixture {
  const {W, H} = MALL_FIX, N = MALL_FIX.rings + 1;
  const grids = Array.from({length: N}, () => new Grid(W, H));
  grids[0].voidFloor = MALL_FIX.bedY;
  const areas: Area[] = [];
  const role = (L: number): LevelRole => (L === 0 ? 'main' : 'ring');
  const area = (r: MRect, L: number, kind: Area['kind'], type: Area['type'], label: string, publicSpace: boolean, ceil: number): Area => {
    const a = {...cellsOf(r), id: areas.length, kind, type, label, ceil, parent: -1, depth: 0, publicSpace, lighting: 'lit', level: L} as Area;
    if (L !== 0) a.floorY = mallY(L);
    areas.push(a);
    return a;
  };
  const carve = (g: Grid, r: MRect, floor: number, ceil: number, id: number, cell: number = FLOOR) => {
    const c = cellsOf(r);
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) {
      const i = y * W + x;
      g.cells[i] = cell; g.floor[i] = floor; g.ceil[i] = ceil; g.area[i] = id;
    }
  };
  const close = (g: Grid, r: MRect) => {
    const c = cellsOf(r);
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) { const i = y * W + x; g.cells[i] = SOLID; g.area[i] = -1; }
  };
  const lights: LightPlacement[] = [];
  const light = (x: number, z: number, L: number, ceil: number, areaId: number) =>
    lights.push({x, y: ceil - 0.15, z, rot: 0, area: areaId, broken: false, flicker: false, warm: false, power: 1, dying: false, level: L});
  const doors: Door[] = [];
  // --- storey 0: plaza courts, the platform and the track bed under the void, the void band to the apex ------------------
  const g0 = grids[0];
  const plaza = area(MALL_FIX.concourse, 0, 'concourse', 'concourse', 'Fountain court', true, MALL_FIX.stationCeil);
  carve(g0, MALL_FIX.concourse, 0, MALL_FIX.stationCeil, plaza.id);
  carve(g0, MALL_FIX.void, 0, MALL_FIX.apex, plaza.id);
  const platform = area(MALL_FIX.platform, 0, 'platform', 'platform', 'Platform 1', true, MALL_FIX.apex);
  platform.edge = 'S';
  carve(g0, MALL_FIX.platform, 0, MALL_FIX.apex, platform.id);
  const bed = area(MALL_FIX.bed, 0, 'service', 'storage', 'Track bed', false, MALL_FIX.apex);
  carve(g0, MALL_FIX.bed, MALL_FIX.bedY, MALL_FIX.apex, bed.id, VOID);
  for (const g of grids) close(g, MALL_FIX.shaft);
  if (opts.lights !== false) {
    for (let x = 8; x <= 62; x += 6) for (const z of [15, 49]) light(x, z, 0, MALL_FIX.stationCeil, plaza.id);
  }
  // --- rings ------------------------------------------------------------------------------------------------------------
  const gallery: number[] = [], corridors: number[][] = [], shops: MallShop[] = [];
  let bridge = -1, pi = 0;
  for (let L = 1; L < N; L++) {
    const g = grids[L], y0 = mallY(L), c0 = y0 + MALL_FIX.clear;
    const gal = area(MALL_FIX.gallery, L, 'concourse', 'concourse', `Level ${L} gallery`, true, c0);
    gallery.push(gal.id);
    carve(g, MALL_FIX.gallery, y0, c0, gal.id);
    close(g, MALL_FIX.void);
    close(g, MALL_FIX.shaft);
    if (L === MALL_FIX.bridge.ring) {
      const br = {x0: MALL_FIX.bridge.x0, z0: MALL_FIX.void.z0, x1: MALL_FIX.bridge.x1, z1: MALL_FIX.void.z1};
      const b = area(br, L, 'passage', 'concourse', `Level ${L} bridge`, true, MALL_FIX.apex);
      bridge = b.id;
      carve(g, br, y0, MALL_FIX.apex, b.id);
      // the station band under the bridge ends at the deck soffit
      const c = cellsOf(br);
      for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) { const i = y * W + x; if (g0.cells[i] !== SOLID) g0.ceil[i] = y0 - 0.6; }
    }
    // shops: 5 north (z 8..19.5), 5 south (z 44.5..56), 1 west, 1 east; stock rooms behind the north / south units
    const units: (MRect & {side: 'N' | 'S' | 'E' | 'W'; stock?: MRect; sdoor?: MRect})[] = [];
    for (let k = 0; k < 5; k++) {
      const x0 = 4 + k * 12.4, x1 = x0 + 12, xm = (x0 + x1) / 2;
      units.push({x0, z0: 8, x1, z1: 19.5, side: 'S', stock: {x0, z0: 3, x1, z1: 7.5}, sdoor: {x0: xm - 0.5, z0: 7.5, x1: xm + 0.5, z1: 8}});
      units.push({x0, z0: 44.5, x1, z1: 56, side: 'N', stock: {x0, z0: 56.5, x1, z1: 61}, sdoor: {x0: xm - 0.5, z0: 56, x1: xm + 0.5, z1: 56.5}});
    }
    units.push({x0: 4, z0: 20.5, x1: 15.5, z1: 43.5, side: 'E'}, {x0: 54.5, z0: 20.5, x1: 66, z1: 43.5, side: 'W'});
    for (const u of units) {
      const program = PROGRAMS[pi % PROGRAMS.length], brand = BRANDS[pi % BRANDS.length];
      pi++;
      const a = area(u, L, 'room', 'shop', brand, true, c0);
      carve(g, u, y0, c0, a.id);
      // shopfront opening (4 m) onto the gallery: a door cell row in the 0.5 m wall gap
      const mid = u.side === 'N' || u.side === 'S' ? (u.x0 + u.x1) / 2 : (u.z0 + u.z1) / 2;
      const fr: MRect = u.side === 'S' ? {x0: mid - 2, z0: 19.5, x1: mid + 2, z1: 20} : u.side === 'N' ? {x0: mid - 2, z0: 44, x1: mid + 2, z1: 44.5}
        : u.side === 'E' ? {x0: 15.5, z0: mid - 2, x1: 16, z1: mid + 2} : {x0: 54, z0: mid - 2, x1: 54.5, z1: mid + 2};
      carve(g, fr, y0, y0 + 3, a.id);
      const dc = cellsOf(fr);
      doors.push({...dc, id: doors.length, a: gal.id, b: a.id, height: 3, arch: false, shopfront: true, level: L} as Door);
      let backroom: number | undefined;
      if (u.stock && u.sdoor) {
        const st = area(u.stock, L, 'service', 'storage', `${brand} stock room`, false, y0 + 3);
        carve(g, u.stock, y0, y0 + 3, st.id);
        carve(g, u.sdoor, y0, y0 + 2.2, st.id);
        doors.push({...cellsOf(u.sdoor), id: doors.length, a: a.id, b: st.id, height: 2.2, arch: false, staff: true, level: L} as Door);
        backroom = st.id;
      }
      const frontage = {...fr, side: u.side};
      shops.push({id: `L${L}-${u.side}${shops.length}`, area: a.id, ...(backroom !== undefined ? {backroom} : {}), level: L, program, kind: 'store', brand, frontage,
        salesArea: (u.x1 - u.x0) * (u.z1 - u.z0), depth: u.side === 'N' || u.side === 'S' ? u.z1 - u.z0 : u.x1 - u.x0, width: u.side === 'N' || u.side === 'S' ? u.x1 - u.x0 : u.z1 - u.z0});
      if (opts.lights !== false) light((u.x0 + u.x1) / 2, (u.z0 + u.z1) / 2, L, c0, a.id);
    }
    const cs: number[] = [];
    for (const r of [MALL_FIX.corridorN, MALL_FIX.corridorS]) {
      const c = area(r, L, 'service', 'storage', `Level ${L} service corridor`, false, y0 + 3);
      carve(g, r, y0, y0 + 3, c.id);
      cs.push(c.id);
      if (opts.lights !== false) light((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, L, y0 + 3, c.id);
    }
    corridors.push(cs);
    if (opts.lights !== false) for (let x = 18; x <= 52; x += 8) for (const z of [22, 42]) light(x, z, L, c0, gal.id);
  }
  const levels: Level[] = grids.map((grid, L) => ({id: L, role: role(L), grid, baseY: mallY(L)}));
  const storeys: MallStorey[] = levels.map(l => ({level: l.id, label: l.id === 0 ? 'Subway' : `Level ${l.id}`, baseY: l.baseY, clear: l.id === 0 ? MALL_FIX.stationCeil : MALL_FIX.clear, role: l.id === 0 ? 'station' : 'ring'}));
  const v = MALL_FIX.void;
  const mall: MallInfo = {
    version: 1, variant: 'fixture', name: "The Eaton's Center", storeys,
    void: {outline: [{x: v.x0, z: v.z0}, {x: v.x1, z: v.z0}, {x: v.x1, z: v.z1}, {x: v.x0, z: v.z1}], bounds: {...v}, openLevels: [1, 2, 3, 4, 5, 6], floorLevel: 0,
      roofSpringY: MALL_FIX.spring, roofApexY: MALL_FIX.apex},
    galleries: gallery.map((a, k) => ({level: k + 1, areas: [a]})),
    shops,
    bridges: [{level: MALL_FIX.bridge.ring, area: bridge, from: {x: 35, z: v.z0}, to: {x: 35, z: v.z1}, width: 3}],
    verticals: [],
    elevators: [{cab: {x0: 47.2, z0: 30.2, x1: 49.8, z1: 32.8}, shaft: {...MALL_FIX.shaft}, stops: levels.map(l => ({level: l.id, y: l.baseY})), glass: true}],
    roof: {outline: {...v}, springY: MALL_FIX.spring, apexY: MALL_FIX.apex, archSpacing: 6},
    patrol: [],
    subwayRoot: {level: 'mall', storey: 0, platformY: 0, trackBedY: MALL_FIX.bedY, platforms: [platform.id], tunnelMouths: [], keepClear: [{...v}]},
    start: {x: MALL_FIX.start.x, z: MALL_FIX.start.z, yaw: 0, level: 0},
  };
  const trench: Trench = {x0: v.x0, x1: v.x1, z0: MALL_FIX.bed.z0, z1: MALL_FIX.bed.z1, floorY: MALL_FIX.bedY, platformX0: v.x0, platformX1: v.x1, tracks: [], third: [], columns: false, ceil: MALL_FIX.apex} as unknown as Trench;
  const layout = {
    seed: 3131, attempt: 0, name: 'Mall fixture', archetype: 'side-mezzanine', towards: ['North', 'South'],
    grid: grids[0], areas, doors, props: [], lights, signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: mall.start.x, z: mall.start.z, yaw: 0}, trench, trenches: [], platform: platform.id, platforms: [platform.id],
    traversal: {stairs: [], ladders: [], underpasses: []},
    levels, levelLinks: [], mall,
  } as unknown as StationLayout & {mall: MallInfo};
  return {layout, levels, gallery, bridge, corridors, shops, plaza: plaza.id, platform: platform.id};
}
