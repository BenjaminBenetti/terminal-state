// Task track3-eaton-centre-20261031 (lane ARCH) -> task mall-playtest-revision-20261031 (lane ARCH): a fully SYNTHETIC mall for the
// atrium render / culling / light-field / elevator tests (no generator: lane GEN's skeleton is tested on its own). Same conventions
// as tests/helpers/towerFixture.ts (every storey grid has the main grid's size / origin, all y absolute) and lane GEN's MallInfo v2
// representation (lanes/GEN.notes CONTRACT): station + THREE retail floors; a SMALL IRREGULAR atrium whose openings are NESTED and
// WIDEN upward (stepped setbacks: `void.openings[]`, floor k's cells inside openings[k+1] but outside openings[k] are a jutting
// gallery open to the roof apex; the station's band inside openings[0] rises to the apex), glass only over the TOP opening
// (`roof.polygon`); a shopping corridor branching off the gallery beyond the atrium; the glass elevator in the gallery; no bridges.
//
//   cells 0.5 m: W 120 (60 m) x H 108 (54 m)
//   storeys   0 = station / plaza (y 0, ceiling 4.8 under the floors), floors 1..3 at y 6 + 5 (k - 1) (clear 3.8, slabs 1.2)
//   openings  O1 (floor 1 = void.outline): (20,22) (26,22) (26,18) (34,18) (34,22) (40,22) (40,30) (36,30) (36,34) (20,34)
//             O2: (18.5,20.5) (24.5,20.5) (24.5,16.5) (35.5,16.5) (35.5,20.5) (41.5,20.5) (41.5,35.5) (18.5,35.5)
//             O3 (= roof.polygon): (17,19) (23,19) (23,15) (37,15) (37,19) (43,19) (43,37) (17,37)
//   roof      spring 22, apex 27 over O3's bounds x 17..43, z 15..37; arches every 5 m
//   level 0   concourse x 6..54, z 10..46 (plaza courts); platform x 20..36, z 25..29 (under O1); track bed (VOID, -1.15)
//             x 20..36, z 29..32.5; glass elevator shaft x 44..47.5, z 23..26 (SOLID on every storey; cab inset 0.5 m, door N)
//   floors    gallery x 12..48, z 12..41.5; shops north z 2.5..11.5 (4 units of different widths), south z 42..49.5 (3 units,
//             stock rooms z 50..52, staff doors into the service corridor x 2..58, z 52.5..53.5), west x 2..11.5 (one deep unit);
//             an EAST CORRIDOR x 48..58, z 28..32 off the gallery with a small unit either side (x 49..57, z 22.5..27.5 / 32.5..37.5)
//   exits     (opt-in `{exits: true}`, task mall-round2-20261031 lane ARCH, M09) one LOCKED street exit in lane GEN's MallStreetExit shape
//             (lanes/GEN.notes CONTRACT) at the floor-1 east corridor's end: plane x 58, opening z 28.5..31.5 (panes as gen/mall/exits.ts
//             panelsOf), head y 9, a 2.5 m SOLID vestibule (collider x 58..60.5), the view volume x 60.5..80.5 (off the grid), z 22..38
import {CELL, FLOOR, Grid, SOLID, VOID} from '../../src/gen/grid';
import type {Level, LevelRole} from '../../src/gen/levels';
import type {Area, Door, LightPlacement, StationLayout, Trench} from '../../src/gen/station';
import type {MallInfo, MallProgram, MallShop, MallStorey} from '../../src/gen/mall/mallTypes';

type P2 = {readonly x: number; readonly z: number};
const O1: readonly P2[] = [{x: 20, z: 22}, {x: 26, z: 22}, {x: 26, z: 18}, {x: 34, z: 18}, {x: 34, z: 22}, {x: 40, z: 22}, {x: 40, z: 30}, {x: 36, z: 30}, {x: 36, z: 34}, {x: 20, z: 34}];
const O2: readonly P2[] = [{x: 18.5, z: 20.5}, {x: 24.5, z: 20.5}, {x: 24.5, z: 16.5}, {x: 35.5, z: 16.5}, {x: 35.5, z: 20.5}, {x: 41.5, z: 20.5}, {x: 41.5, z: 35.5}, {x: 18.5, z: 35.5}];
const O3: readonly P2[] = [{x: 17, z: 19}, {x: 23, z: 19}, {x: 23, z: 15}, {x: 37, z: 15}, {x: 37, z: 19}, {x: 43, z: 19}, {x: 43, z: 37}, {x: 17, z: 37}];
const boundsOf = (o: readonly P2[]) => ({x0: Math.min(...o.map(p => p.x)), z0: Math.min(...o.map(p => p.z)), x1: Math.max(...o.map(p => p.x)), z1: Math.max(...o.map(p => p.z))});

/** Even-odd point-in-polygon (x / z). */
function inPoly(poly: readonly P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

export const MALL_FIX = {
  W: 120, H: 108, rings: 3, clear: 3.8, stationCeil: 4.8, spring: 22, apex: 27, bedY: -1.15,
  /** Floor-1 opening bounds (= void.bounds) and the per-floor nested openings (floor 1, 2, 3; O3 = the glazed roof). */
  void: boundsOf(O1),
  openings: [O1, O2, O3] as const,
  roof: boundsOf(O3),
  concourse: {x0: 6, z0: 10, x1: 54, z1: 46},
  platform: {x0: 20, z0: 25, x1: 36, z1: 29},
  bed: {x0: 20, z0: 29, x1: 36, z1: 32.5},
  shaft: {x0: 44, z0: 23, x1: 47.5, z1: 26},
  cab: {x0: 44.5, z0: 23.5, x1: 47, z1: 25.5},
  gallery: {x0: 12, z0: 12, x1: 48, z1: 41.5},
  corridorE: {x0: 48, z0: 28, x1: 58, z1: 32},
  corridorS: {x0: 2, z0: 52.5, x1: 58, z1: 53.5},
  /** Platform eye / start. */
  start: {x: 28, z: 27},
} as const;

/** World floor y of storey L. */
export const mallY = (L: number): number => (L === 0 ? 0 : 6 + 5 * (L - 1));

/** Whether (x, z) lies inside the opening of floor L (1..3). */
export const inOpening = (L: number, x: number, z: number): boolean => L >= 1 && L <= 3 && inPoly(MALL_FIX.openings[L - 1], x, z);

const PROGRAMS: MallProgram[] = ['guns', 'pharmacy', 'electronics', 'clothing', 'food-court', 'books', 'toys', 'jewelry', 'sports', 'cafe', 'hardware', 'beauty'];
const BRANDS = ['Northline Arms', 'Greenleaf Pharmacy', 'Voltage Electronics', 'Maple & Oak', 'Food Hall', 'Paper Lantern Books', 'Tumble Toys', 'Gilded Hour', 'Peak Athletic', 'Bean There', 'Bolt & Beam', 'Rosewater'];

export interface MallFixture {
  layout: StationLayout & {mall: MallInfo};
  levels: Level[];
  /** Area ids: gallery / corridors (per floor: [service, east corridor]) / shops. */
  gallery: number[];
  corridors: number[][];
  shops: MallShop[];
  plaza: number;
  platform: number;
}

type MRect = {x0: number; z0: number; x1: number; z1: number};
const cellsOf = (r: MRect) => ({x: Math.round(r.x0 / CELL), y: Math.round(r.z0 / CELL), w: Math.round((r.x1 - r.x0) / CELL), h: Math.round((r.z1 - r.z0) / CELL)});

/** The fixture's opt-in street exit (lane GEN's MallStreetExit record shape; floor 1 = the street storey). */
export const FIX_EXIT = {
  id: 'exit-1', kind: 'corridor-end', level: 1, streetY: 6, side: 'E',
  door: {plane: 58, s0: 28.5, s1: 31.5, y0: 6, y1: 9},
  panels: [
    {kind: 'sidelight', s0: 28.5, s1: 29.1, y0: 6, y1: 8.3}, {kind: 'door', s0: 29.1, s1: 30, y0: 6, y1: 8.3},
    {kind: 'door', s0: 30, s1: 30.9, y0: 6, y1: 8.3}, {kind: 'sidelight', s0: 30.9, s1: 31.5, y0: 6, y1: 8.3},
    {kind: 'transom', s0: 28.5, s1: 31.5, y0: 8.35, y1: 9},
  ],
  vestibule: 2.5, facade: 60.5,
  collider: {x0: 58, z0: 27.5, x1: 60.5, z1: 32.5, y0: 6, y1: 9.4},
  view: {x0: 60.5, z0: 22, x1: 80.5, z1: 38, y0: 5, y1: 36},
  hall: {area: -1, depth: 10, width: 4, ceil: 9.4},
  locked: true, sign: 'EXIT CLOSED', seed: 4242,
} as const;

export function mallFixture(opts: {lights?: boolean; exits?: boolean} = {}): MallFixture {
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
  /** Each open cell of g whose centre lies in `poly`: fn(i). */
  const eachIn = (g: Grid, poly: readonly P2[], fn: (i: number) => void) => {
    const b = boundsOf(poly);
    for (let cy = Math.floor(b.z0 / CELL); cy < Math.ceil(b.z1 / CELL); cy++) for (let cx = Math.floor(b.x0 / CELL); cx < Math.ceil(b.x1 / CELL); cx++) {
      if (inPoly(poly, (cx + 0.5) * CELL, (cy + 0.5) * CELL)) fn(cy * W + cx);
    }
    void g;
  };
  const lights: LightPlacement[] = [];
  const light = (x: number, z: number, L: number, ceil: number, areaId: number) =>
    lights.push({x, y: ceil - 0.15, z, rot: 0, area: areaId, broken: false, flicker: false, warm: false, power: 1, dying: false, level: L});
  const doors: Door[] = [];
  // --- storey 0: plaza courts, the platform and the track bed under the atrium, the atrium band to the apex ----------------
  const g0 = grids[0];
  const plaza = area(MALL_FIX.concourse, 0, 'concourse', 'concourse', 'Fountain court', true, MALL_FIX.stationCeil);
  carve(g0, MALL_FIX.concourse, 0, MALL_FIX.stationCeil, plaza.id);
  eachIn(g0, O1, i => { g0.ceil[i] = MALL_FIX.apex; });
  const platform = area(MALL_FIX.platform, 0, 'platform', 'platform', 'Platform 1', true, MALL_FIX.apex);
  platform.edge = 'S';
  carve(g0, MALL_FIX.platform, 0, MALL_FIX.apex, platform.id);
  const bed = area(MALL_FIX.bed, 0, 'service', 'storage', 'Track bed', false, MALL_FIX.apex);
  carve(g0, MALL_FIX.bed, MALL_FIX.bedY, MALL_FIX.apex, bed.id, VOID);
  for (const g of grids) close(g, MALL_FIX.shaft);
  if (opts.lights !== false) {
    for (let x = 9; x <= 51; x += 6) for (const z of [11.5, 44]) light(x, z, 0, MALL_FIX.stationCeil, plaza.id);
  }
  // --- retail floors ----------------------------------------------------------------------------------------------------
  const gallery: number[] = [], corridors: number[][] = [], shops: MallShop[] = [];
  let pi = 0;
  for (let L = 1; L < N; L++) {
    const g = grids[L], y0 = mallY(L), c0 = y0 + MALL_FIX.clear;
    const gal = area(MALL_FIX.gallery, L, 'concourse', 'concourse', `Level ${L} gallery`, true, c0);
    gallery.push(gal.id);
    carve(g, MALL_FIX.gallery, y0, c0, gal.id);
    // the jutting gallery (inside the next floor's opening): open to the roof apex; this floor's own opening is void (closed)
    if (L < N - 1) eachIn(g, MALL_FIX.openings[L], i => { g.ceil[i] = MALL_FIX.apex; });
    eachIn(g, MALL_FIX.openings[L - 1], i => { g.cells[i] = SOLID; g.area[i] = -1; });
    close(g, MALL_FIX.shaft);
    // the east shopping corridor beyond the atrium (an opening in the gallery's east edge)
    const ec = area(MALL_FIX.corridorE, L, 'concourse', 'concourse', `Level ${L} east corridor`, true, y0 + 3.4);
    carve(g, MALL_FIX.corridorE, y0, y0 + 3.4, ec.id);
    // shops: 4 north (different widths), 3 south (stock rooms), 1 west, 2 small ones on the east corridor
    type Unit = MRect & {side: 'N' | 'S' | 'E' | 'W'; front: MRect; stock?: MRect; sdoor?: MRect; gallery: number};
    const units: Unit[] = [];
    for (const [x0, x1] of [[4, 12], [12.5, 22], [22.5, 34], [34.5, 48]] as [number, number][]) {
      const xm = (x0 + x1) / 2;
      units.push({x0, z0: 2.5, x1, z1: 11.5, side: 'S', front: {x0: xm - 1.5, z0: 11.5, x1: xm + 1.5, z1: 12}, gallery: gal.id});
    }
    for (const [x0, x1] of [[6, 18], [18.5, 30], [30.5, 48]] as [number, number][]) {
      const xm = (x0 + x1) / 2;
      units.push({x0, z0: 42, x1, z1: 49.5, side: 'N', front: {x0: xm - 1.5, z0: 41.5, x1: xm + 1.5, z1: 42}, gallery: gal.id,
        stock: {x0, z0: 50, x1, z1: 52}, sdoor: {x0: xm - 0.5, z0: 49.5, x1: xm + 0.5, z1: 50}});
    }
    units.push({x0: 2, z0: 12.5, x1: 11.5, z1: 40.5, side: 'E', front: {x0: 11.5, z0: 25, x1: 12, z1: 28}, gallery: gal.id});
    units.push({x0: 49, z0: 22.5, x1: 57, z1: 27.5, side: 'S', front: {x0: 51.5, z0: 27.5, x1: 54.5, z1: 28}, gallery: ec.id});
    units.push({x0: 49, z0: 32.5, x1: 57, z1: 37.5, side: 'N', front: {x0: 51.5, z0: 32, x1: 54.5, z1: 32.5}, gallery: ec.id});
    for (const u of units) {
      const program = PROGRAMS[pi % PROGRAMS.length], brand = BRANDS[pi % BRANDS.length];
      pi++;
      const a = area(u, L, 'room', 'shop', brand, true, c0);
      carve(g, u, y0, c0, a.id);
      carve(g, u.front, y0, y0 + 3, a.id);
      doors.push({...cellsOf(u.front), id: doors.length, a: u.gallery, b: a.id, height: 3, arch: false, shopfront: true, level: L} as Door);
      let backroom: number | undefined;
      if (u.stock && u.sdoor) {
        const st = area(u.stock, L, 'service', 'storage', `${brand} stock room`, false, y0 + 3);
        carve(g, u.stock, y0, y0 + 3, st.id);
        carve(g, u.sdoor, y0, y0 + 2.2, st.id);
        doors.push({...cellsOf(u.sdoor), id: doors.length, a: a.id, b: st.id, height: 2.2, arch: false, staff: true, level: L} as Door);
        backroom = st.id;
      }
      const ns = u.side === 'N' || u.side === 'S';
      shops.push({id: `L${L}-${u.side}${shops.length}`, area: a.id, ...(backroom !== undefined ? {backroom} : {}), level: L, program, kind: 'store', brand, frontage: {...u.front, side: u.side},
        salesArea: (u.x1 - u.x0) * (u.z1 - u.z0), depth: ns ? u.z1 - u.z0 : u.x1 - u.x0, width: ns ? u.x1 - u.x0 : u.z1 - u.z0});
      if (opts.lights !== false) light((u.x0 + u.x1) / 2, (u.z0 + u.z1) / 2, L, c0, a.id);
    }
    const sc = area(MALL_FIX.corridorS, L, 'service', 'storage', `Level ${L} service corridor`, false, y0 + 3);
    carve(g, MALL_FIX.corridorS, y0, y0 + 3, sc.id);
    for (const s of shops.filter(q => q.level === L && q.backroom !== undefined)) {
      const st = areas[s.backroom!], xm = (st.x + st.w / 2) * CELL;
      const dr = {x0: xm - 0.5, z0: 52, x1: xm + 0.5, z1: 52.5};
      carve(g, dr, y0, y0 + 2.2, sc.id);
      doors.push({...cellsOf(dr), id: doors.length, a: st.id, b: sc.id, height: 2.2, arch: false, staff: true, level: L} as Door);
    }
    corridors.push([sc.id, ec.id]);
    if (opts.lights !== false) {
      light(30, 53, L, y0 + 3, sc.id);
      for (let x = 14; x <= 46; x += 8) for (const z of [13.5, 39.5]) light(x, z, L, c0, gal.id);
      light(53, 30, L, y0 + 3.4, ec.id);
    }
  }
  const levels: Level[] = grids.map((grid, L) => ({id: L, role: role(L), grid, baseY: mallY(L)}));
  const storeys: MallStorey[] = levels.map(l => ({level: l.id, label: l.id === 0 ? 'Subway' : `Level ${l.id}`, baseY: l.baseY, clear: l.id === 0 ? MALL_FIX.stationCeil : MALL_FIX.clear, role: l.id === 0 ? 'station' : 'ring'}));
  const v = MALL_FIX.void, r = MALL_FIX.roof;
  const openings = MALL_FIX.openings.map((o, k) => ({level: k + 1, outline: o.map(p => ({...p})), bounds: boundsOf(o), area: gallery[k]}));
  const mall = {
    version: 2, variant: 'fixture', name: 'Harrowgate Center', storeys,
    void: {outline: O1.map(p => ({...p})), bounds: {...v}, openLevels: [1, 2, 3], floorLevel: 0, roofSpringY: MALL_FIX.spring, roofApexY: MALL_FIX.apex, openings},
    galleries: gallery.map((a, k) => ({level: k + 1, areas: [a, corridors[k][1]]})),
    courts: gallery.map((a, k) => ({level: k + 1, areas: [a]})),
    corridors: corridors.map((c, k) => ({level: k + 1, areas: [c[1]]})),
    service: corridors.map((c, k) => ({level: k + 1, areas: [c[0]]})),
    shops,
    bridges: [],
    verticals: [],
    elevators: [{cab: {...MALL_FIX.cab}, shaft: {...MALL_FIX.shaft}, stops: levels.map(l => ({level: l.id, y: l.baseY})), glass: true}],
    roof: {outline: {...r}, polygon: O3.map(p => ({...p})), springY: MALL_FIX.spring, apexY: MALL_FIX.apex, archSpacing: 5},
    patrol: [],
    subwayRoot: {level: 'mall', storey: 0, platformY: 0, trackBedY: MALL_FIX.bedY, platforms: [platform.id], tunnelMouths: [], keepClear: [{...v}]},
    start: {x: MALL_FIX.start.x, z: MALL_FIX.start.z, yaw: 0, level: 0},
    ...(opts.exits ? {exits: [JSON.parse(JSON.stringify({...FIX_EXIT, hall: {...FIX_EXIT.hall, area: corridors[0][1]}}))]} : {}),
  } as unknown as MallInfo;
  const trench: Trench = {x0: MALL_FIX.bed.x0, x1: MALL_FIX.bed.x1, z0: MALL_FIX.bed.z0, z1: MALL_FIX.bed.z1, floorY: MALL_FIX.bedY, platformX0: MALL_FIX.bed.x0, platformX1: MALL_FIX.bed.x1, tracks: [], third: [], columns: false, ceil: MALL_FIX.apex} as unknown as Trench;
  const layout = {
    seed: 3131, attempt: 0, name: 'Harrowgate Center', archetype: 'side-mezzanine', towards: ['North', 'South'],
    grid: grids[0], areas, doors, props: [], lights, signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: mall.start.x, z: mall.start.z, yaw: 0}, trench, trenches: [], platform: platform.id, platforms: [platform.id],
    traversal: {stairs: [], ladders: [], underpasses: []},
    levels, levelLinks: [], mall,
  } as unknown as StationLayout & {mall: MallInfo};
  return {layout, levels, gallery, corridors, shops, plaza: plaza.id, platform: platform.id};
}
