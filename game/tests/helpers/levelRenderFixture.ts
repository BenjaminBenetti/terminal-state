// Iteration 08 (Lane G): a small, fully synthetic 3-level station for render/lighting tests (no
// generator involved). Same conventions as Lane A's data plan (reference/tasks/vertical-slice-
// iteration08-20261027/lanes/lane-A.notes): every level grid has the main grid's size/origin, all y
// absolute, stair flights carved identically into both connected grids with ONE shared ramps array.
//
//   rows 1-4   stair core A: main bottom landing (x 52-55) + UP flight (x 56-71, main+upper) + upper top landing (x 72-75)
//   row 5      wall; doors at x 53-55 (main) and x 73-75 (upper)
//   rows 6-15  platform 1 (main, ceil 4.4) under deck 1 (upper, floor 4.75, ceil 7.95)
//   rows 16-31 track bed (main VOID, -1.15): bridge above at x 10-19 (upper), LIGHT WELL x 30-49 (upper SOLID,
//              main bed ceiling raised to 7.95), elsewhere the bed ceiling stays 4.4
//   rows 32-41 platform 2 under deck 2
//   row 42     wall; door x 61-63 (main)
//   rows 43-46 stair core B: main top landing (x 60-63) + DOWN flight (x 46-59, main+lower)
//   lower      service crossing x 40-45, rows 8-46 (floor -4, ceil -1.5) under both platforms and the bed
import {CELL, FLOOR, Grid, SOLID, VOID, rampHeight, type Ramp} from '../../src/gen/grid';
import type {Level, LevelLink} from '../../src/gen/levels';
import type {Area, Door, LightPlacement, StationLayout, Trench} from '../../src/gen/station';

export const FIX = {W: 80, H: 50, upperY: 4.75, upperCeil: 7.95, lowerY: -4, lowerCeil: -1.5, bedY: -1.15, platCeil: 4.4} as const;

type Rect = {x: number; y: number; w: number; h: number};

export interface LevelFixture {
  layout: StationLayout;
  levels: Level[];
  /** Area ids by name. */
  ids: Record<string, number>;
  rampUp: Ramp;
  rampDown: Ramp;
}

export function levelFixture(opts: {lights?: boolean} = {}): LevelFixture {
  const {W, H} = FIX;
  const main = new Grid(W, H), upper = new Grid(W, H), lower = new Grid(W, H);
  main.voidFloor = FIX.bedY;
  const areas: Area[] = [];
  const ids: Record<string, number> = {};
  const area = (name: string, r: Rect, level: number, kind: Area['kind'], type: Area['type'], ceil: number, publicSpace: boolean, extra: Partial<Area> = {}): Area => {
    const a: Area = {...r, id: areas.length, kind, type, label: name, ceil, parent: -1, depth: 0, publicSpace, lighting: 'lit', level, ...extra} as Area;
    if (level !== 0) a.floorY = level === 1 ? FIX.upperY : FIX.lowerY;
    areas.push(a);
    ids[name] = a.id;
    return a;
  };
  const carve = (g: Grid, r: Rect, cell: number, floor: number, ceil: number, areaId: number) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      g.cells[i] = cell; g.floor[i] = floor; g.ceil[i] = ceil; g.area[i] = areaId;
    }
  };
  const carveArea = (g: Grid, a: Area, floor: number) => carve(g, a, FLOOR, floor, a.ceil, a.id);

  // --- main level --------------------------------------------------------------------------
  const P1 = area('platform1', {x: 4, y: 6, w: 72, h: 10}, 0, 'platform', 'platform', FIX.platCeil, true, {edge: 'S', platformNo: 1});
  const P2 = area('platform2', {x: 4, y: 32, w: 72, h: 10}, 0, 'platform', 'platform', FIX.platCeil, true, {edge: 'N', platformNo: 2});
  carveArea(main, P1, 0); carveArea(main, P2, 0);
  // Track bed (full width = tunnel continues), ceiling raised to the upper ceiling over the light well.
  carve(main, {x: 0, y: 16, w: W, h: 16}, VOID, FIX.bedY, FIX.platCeil, -1);
  carve(main, {x: 30, y: 16, w: 20, h: 16}, VOID, FIX.bedY, FIX.upperCeil, -1);
  const coreA = area('coreA', {x: 52, y: 1, w: 24, h: 4}, 0, 'passage', 'stair-core' as Area['type'], 3.0, true, {role: 'stair-core'} as Partial<Area>);
  carve(main, {x: 52, y: 1, w: 4, h: 4}, FLOOR, 0, 3.0, coreA.id);
  const coreB = area('coreB', {x: 46, y: 43, w: 18, h: 4}, 0, 'passage', 'stair-core' as Area['type'], 3.0, true, {role: 'stair-core'} as Partial<Area>);
  carve(main, {x: 60, y: 43, w: 4, h: 4}, FLOOR, 0, 3.0, coreB.id);

  // --- upper level ---------------------------------------------------------------------------
  const D1 = area('deck1', {x: 4, y: 6, w: 72, h: 10}, 1, 'concourse', 'concourse', FIX.upperCeil, true, {role: 'upper-concourse'} as Partial<Area>);
  const D2 = area('deck2', {x: 4, y: 32, w: 72, h: 10}, 1, 'concourse', 'concourse', FIX.upperCeil, true, {role: 'upper-concourse'} as Partial<Area>);
  const BR = area('bridge', {x: 10, y: 16, w: 10, h: 16}, 1, 'concourse', 'concourse', FIX.upperCeil, true, {role: 'crossover'} as Partial<Area>);
  carveArea(upper, D1, FIX.upperY); carveArea(upper, D2, FIX.upperY); carveArea(upper, BR, FIX.upperY);
  carve(upper, {x: 72, y: 1, w: 4, h: 4}, FLOOR, FIX.upperY, FIX.upperY + 3.0, coreA.id);

  // --- lower level ---------------------------------------------------------------------------
  const X = area('crossing', {x: 40, y: 8, w: 6, h: 39}, 2, 'service', 'service-corridor', FIX.lowerCeil, false, {role: 'service-crossing'} as Partial<Area>);
  carveArea(lower, X, FIX.lowerY);

  // --- doors ---------------------------------------------------------------------------------
  const doors: Door[] = [];
  const door = (g: Grid, r: Rect, a: Area, b: Area, floor: number, level: number) => {
    carve(g, r, FLOOR, floor, floor + 2.3, b.id);
    doors.push({...r, id: doors.length, a: a.id, b: b.id, height: 2.3, arch: false, level} as Door);
  };
  door(main, {x: 53, y: 5, w: 3, h: 1}, P1, coreA, 0, 0);
  door(upper, {x: 73, y: 5, w: 3, h: 1}, D1, coreA, FIX.upperY, 1);
  door(main, {x: 61, y: 42, w: 3, h: 1}, P2, coreB, 0, 0);

  // --- stair flights (shared ramps array) ------------------------------------------------------
  const rampUp: Ramp = {x: 56, y: 1, w: 16, h: 4, axis: 'x', s0: 28.1, s1: 35.9, h0: 0, h1: FIX.upperY, risers: 28, headroom: 2.5};
  const rampDown: Ramp = {x: 46, y: 43, w: 14, h: 4, axis: 'x', s0: 29.85, s1: 23.15, h0: 0, h1: FIX.lowerY, risers: 24, headroom: 2.5};
  upper.ramps = main.ramps; lower.ramps = main.ramps;
  const stamp = (r: Ramp, grids: Grid[], areaId: number) => {
    const id = main.ramps.length;
    main.ramps.push(r);
    for (const g of grids) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x;
      g.cells[i] = FLOOR; g.area[i] = areaId; g.rampIdx[i] = id;
      g.floor[i] = rampHeight(r, (x + 0.5) * CELL);
      g.ceil[i] = Math.max(rampHeight(r, x * CELL), rampHeight(r, (x + 1) * CELL)) + r.headroom;
    }
    return id;
  };
  const upId = stamp(rampUp, [main, upper], coreA.id);
  const downId = stamp(rampDown, [main, lower], coreB.id);

  const levels: Level[] = [
    {id: 0, role: 'main', grid: main, baseY: 0},
    {id: 1, role: 'upper', grid: upper, baseY: FIX.upperY},
    {id: 2, role: 'lower', grid: lower, baseY: FIX.lowerY},
  ];
  const levelLinks: LevelLink[] = [
    {id: 0, kind: 'stairs', lower: 0, upper: 1, ramp: upId, bottom: {x: 27, y: 0, z: 1.5}, top: {x: 37, y: FIX.upperY, z: 1.5}},
    {id: 1, kind: 'stairs', lower: 2, upper: 0, ramp: downId, bottom: {x: 22, y: FIX.lowerY, z: 22.5}, top: {x: 30.5, y: 0, z: 22.5}},
  ];

  // --- lights ----------------------------------------------------------------------------------
  const lights: LightPlacement[] = [];
  const light = (x: number, y: number, z: number, areaId: number, level: number, rot = 0) =>
    lights.push({x, y, z, rot, area: areaId, broken: false, flicker: false, warm: false, power: 1, dying: false, level});
  if (opts.lights !== false) {
    for (let x = 4; x <= 36; x += 4) { light(x, 4.25, 5.5, P1.id, 0); light(x, 4.25, 18.5, P2.id, 0); }
    for (let x = 4; x <= 36; x += 4) { light(x, FIX.upperCeil - 0.15, 5.5, D1.id, 1); light(x, FIX.upperCeil - 0.15, 18.5, D2.id, 1); }
    light(15, FIX.upperCeil - 0.15, 12, BR.id, 1, Math.PI / 2);
    for (let z = 5; z <= 22; z += 4) light(21.5, FIX.lowerCeil - 0.12, z, X.id, 2, Math.PI / 2);
    light(27, 2.85, 1.5, coreA.id, 0); light(37, FIX.upperY + 2.85, 1.5, coreA.id, 1); light(31, 2.85, 22.5, coreB.id, 0);
  }

  const trench: Trench = {x0: 0, x1: W * CELL, z0: 8, z1: 16, floorY: FIX.bedY, platformX0: 2, platformX1: 38, tracks: [10, 14], third: [-1, 1], columns: false, ceil: FIX.platCeil};
  const layout = {
    seed: 0, attempt: 0, name: 'Fixture', archetype: 'side-mezzanine', towards: ['North', 'South'],
    grid: main, areas, doors, props: [], lights, signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 10, z: 5.5, yaw: 0}, trench, trenches: [trench], platform: P1.id, platforms: [P1.id, P2.id],
    traversal: {stairs: [], ladders: [], underpasses: []},
    levels, levelLinks,
  } as unknown as StationLayout;
  return {layout, levels, ids, rampUp, rampDown};
}

export {SOLID};
