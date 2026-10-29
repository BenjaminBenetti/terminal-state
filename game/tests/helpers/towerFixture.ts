// Task office-seamless-20261029 (ENGINE): a fully synthetic 9-storey tower for the N-storey engine tests (no generator).
// The same conventions as tests/helpers/levelRenderFixture.ts: every storey grid has the main grid's size / origin, all y
// absolute, each stair run carved identically into BOTH grids it joins with ONE shared ramps array and a LevelLink.
//
//   storeys    0 = station (role main, y 0, ceiling 4.4), 1 = lobby (role upper, y 5.6), 2..8 = office (y 5.6 + 4.4 (n - 1),
//              floor 8 at 36.4 m), clear height 3.0 m above the lobby (1.4 m slabs between storeys)
//   rows 4-33  the storey's floor plate (one open area), the same footprint on every storey; fixtures every 4 m
//   row 34     wall; a doorway (4 cells) onto that storey's stair landing
//   rows 35-41 SCISSOR STAIR: lane A rows 35-37 (rises west -> east), divider row 38 (solid), lane B rows 39-41 (rises
//              east -> west); run L -> L + 1 in lane A for even L, lane B for odd L; each run 18 cells (9 m) between the
//              west landing (x 18-21: storeys 0, 2, 4, 6, 8) and the east landing (x 40-43: storeys 1, 3, 5, 7)
//   x 66-71    a solid elevator shaft on every storey (never carved)
import {CELL, FLOOR, Grid, rampHeight, type Ramp} from '../../src/gen/grid';
import type {Level, LevelLink, LevelRole} from '../../src/gen/levels';
import type {Area, Door, LightPlacement, StationLayout, Trench} from '../../src/gen/station';

export const TOWER = {
  W: 80, H: 46, storeys: 9, lobbyY: 5.6, floorH: 4.4, clear: 3.0, stationCeil: 4.4,
  room: {x: 4, y: 4, w: 72, h: 30}, wallRow: 34, laneA: 35, laneB: 39, laneRows: 3, divider: 38,
  lane: {x0: 22, x1: 40}, west: {x0: 18, x1: 22}, east: {x0: 40, x1: 44}, shaft: {x: 66, y: 36, w: 6, h: 6},
} as const;

/** World floor height of storey L. */
export const storeyY = (L: number): number => (L === 0 ? 0 : Math.round((TOWER.lobbyY + TOWER.floorH * (L - 1)) * 1000) / 1000);
/** Ceiling of storey L's floor plate. */
export const storeyCeil = (L: number): number => storeyY(L) + (L === 0 ? TOWER.stationCeil : TOWER.clear);
/** Landing end of storey L (even: west, odd: east) and the lane of run L -> L + 1 (even L: A rising east, odd: B rising west). */
export const landingOf = (L: number) => (L % 2 === 0 ? TOWER.west : TOWER.east);
export const laneOf = (L: number): 'A' | 'B' => (L % 2 === 0 ? 'A' : 'B');

export interface TowerFixture {
  layout: StationLayout;
  levels: Level[];
  links: LevelLink[];
  /** Ramp of run L -> L + 1 (index L). */
  ramps: Ramp[];
  /** Area ids: room / stair core of storey L. */
  room: number[];
  stair: number[];
}

type Rect = {x: number; y: number; w: number; h: number};

export function towerFixture(opts: {storeys?: number; lights?: boolean; lightStep?: number} = {}): TowerFixture {
  const {W, H} = TOWER;
  const N = opts.storeys ?? TOWER.storeys;
  const grids = Array.from({length: N}, () => new Grid(W, H));
  const ramps: Ramp[] = [];
  for (const g of grids) g.ramps = ramps;
  const areas: Area[] = [];
  const role = (L: number): LevelRole => (L === 0 ? 'main' : L === 1 ? 'upper' : 'office');
  const area = (r: Rect, L: number, kind: Area['kind'], type: Area['type'], label: string, publicSpace = true): Area => {
    const a = {...r, id: areas.length, kind, type, label, ceil: storeyCeil(L), parent: -1, depth: 0, publicSpace, lighting: 'lit', level: L} as Area;
    if (L !== 0) a.floorY = storeyY(L);
    areas.push(a);
    return a;
  };
  const carve = (g: Grid, r: Rect, floor: number, ceil: number, areaId: number) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      g.cells[i] = FLOOR; g.floor[i] = floor; g.ceil[i] = ceil; g.area[i] = areaId;
    }
  };
  const room: number[] = [], stair: number[] = [];
  const doors: Door[] = [];
  const lights: LightPlacement[] = [];
  const stairRows = {y: TOWER.laneA, h: TOWER.laneB + TOWER.laneRows - TOWER.laneA};
  for (let L = 0; L < N; L++) {
    const g = grids[L], y0 = storeyY(L), c0 = storeyCeil(L);
    const R = area(TOWER.room, L, L === 0 ? 'concourse' : 'room', L === 0 ? 'concourse' : L === 1 ? 'office-lobby' : 'office-open', `room ${L}`);
    const end = landingOf(L);
    const S = area({x: TOWER.west.x0, y: stairRows.y, w: TOWER.east.x1 - TOWER.west.x0, h: stairRows.h}, L, 'passage', 'office-stair', `stair ${L}`);
    room.push(R.id); stair.push(S.id);
    carve(g, R, y0, c0, R.id);
    // this storey's landing (both lanes + the divider row) and its doorway from the floor plate
    carve(g, {x: end.x0, y: stairRows.y, w: end.x1 - end.x0, h: stairRows.h}, y0, y0 + TOWER.clear, S.id);
    const d = {x: end.x0, y: TOWER.wallRow, w: end.x1 - end.x0, h: 1};
    carve(g, d, y0, y0 + 2.3, S.id);
    doors.push({...d, id: doors.length, a: R.id, b: S.id, height: 2.3, arch: false, level: L} as Door);
    if (opts.lights !== false) {
      const st = opts.lightStep ?? 4;
      for (let x = 4; x <= 36; x += st) for (let z = 4; z <= 16; z += st) lights.push({x, y: c0 - 0.15, z, rot: 0, area: R.id, broken: false, flicker: (x + z + L) % 7 === 0, warm: false, power: 1, dying: false, level: L});
      lights.push({x: (end.x0 + end.x1) / 2 * CELL, y: y0 + TOWER.clear - 0.15, z: (stairRows.y + stairRows.h / 2) * CELL, rot: 0, area: S.id, broken: false, flicker: false, warm: false, power: 0.9, dying: false, level: L});
    }
  }
  // Scissor runs: straight ramps carved into both grids they join.
  const links: LevelLink[] = [];
  const zMid = (row: number) => (row + TOWER.laneRows / 2) * CELL;
  for (let L = 0; L + 1 < N; L++) {
    const lane = laneOf(L), row = lane === 'A' ? TOWER.laneA : TOWER.laneB;
    const xs = TOWER.lane.x0 * CELL, xe = TOWER.lane.x1 * CELL;
    const [s0, s1] = lane === 'A' ? [xs, xe] : [xe, xs];
    const r: Ramp = {x: TOWER.lane.x0, y: row, w: TOWER.lane.x1 - TOWER.lane.x0, h: TOWER.laneRows, axis: 'x', s0, s1, h0: storeyY(L), h1: storeyY(L + 1), risers: 24, headroom: 2.5};
    const id = ramps.length;
    ramps.push(r);
    for (const g of [grids[L], grids[L + 1]]) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      g.cells[i] = FLOOR; g.area[i] = stair[L]; g.rampIdx[i] = id;
      g.floor[i] = rampHeight(r, (x + 0.5) * CELL);
      g.ceil[i] = Math.max(rampHeight(r, x * CELL), rampHeight(r, (x + 1) * CELL)) + r.headroom;
    }
    const off = 0.6;
    links.push({id, kind: 'stairs', lower: L, upper: L + 1, ramp: id,
      bottom: {x: lane === 'A' ? xs - off : xe + off, y: storeyY(L), z: zMid(row)},
      top: {x: lane === 'A' ? xe + off : xs - off, y: storeyY(L + 1), z: zMid(row)}});
  }
  const levels: Level[] = grids.map((grid, L) => ({id: L, role: role(L), grid, baseY: storeyY(L)}));
  const trench: Trench = {x0: 0, x1: 0, z0: 0, z1: 0, floorY: -1.15, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0};
  const layout = {
    seed: 4242, attempt: 0, name: 'Tower fixture', archetype: 'side-mezzanine', towards: ['North', 'South'],
    grid: grids[0], areas, doors, props: [], lights, signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 20, z: 10, yaw: 0}, trench, trenches: [], platform: room[0], platforms: [],
    traversal: {stairs: [], ladders: [], underpasses: []},
    levels, levelLinks: links,
  } as unknown as StationLayout;
  return {layout, levels, links, ramps, room, stair};
}
