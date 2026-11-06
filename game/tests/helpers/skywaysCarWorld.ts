// Task studio-skyways-level-20261106-054448 (lane CAR): a hand-built two-storey test world for the prize car (no Skyways generator yet):
//  - storey 0: a 40 x 30 m hall (0.5 m cells, walls all round, floor 0, ceiling 4) with
//      a stair RAMP (cells x 10..12 m, z 20..25 m) rising 0 -> 1.2 m along z,
//      a DROP: everything at x >= 30 m is 3 m lower (an unrailed edge),
//      a RAILING along x = 20 m, z 2..10 m (the explicit rail list),
//      a low SOFFIT (ceiling 1.2 m) over x 4..6 m, z 2..4 m;
//  - storey 1 (role 'upper', floor 5): a deck over x 2..8 m, z 2..8 m (another storey's floor at the same x / z).
import {CELL, FLOOR, Grid, SOLID, type Ramp} from '../../src/gen/grid';
import {Levels, type RailRun} from '../../src/gen/levels';
import {PropIndex} from '../../src/core/physics';
import type {PropPlacement} from '../../src/gen/props';

export const HALL = {w: 40, d: 30, wall: 0.5, drop: 30, rail: {x: 20, z0: 2, z1: 10}, ramp: {x0: 10, x1: 12, z0: 20, z1: 25, h: 1.2}, soffit: {x0: 4, x1: 6, z0: 2, z1: 4, ceil: 1.2}} as const;

export function hallLevels(): Levels {
  const W = HALL.w / CELL, H = HALL.d / CELL;
  const g0 = new Grid(W, H), g1 = new Grid(W, H);
  const ramp: Ramp = {x: HALL.ramp.x0 / CELL, y: HALL.ramp.z0 / CELL, w: (HALL.ramp.x1 - HALL.ramp.x0) / CELL, h: (HALL.ramp.z1 - HALL.ramp.z0) / CELL,
    axis: 'z', s0: HALL.ramp.z0, s1: HALL.ramp.z1, h0: 0, h1: HALL.ramp.h, risers: 8, headroom: 2.4};
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = g0.idx(cx, cy), x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
    if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) { g0.cells[i] = SOLID; g1.cells[i] = SOLID; continue; }
    g0.cells[i] = FLOOR;
    g0.area[i] = 0;
    g0.floor[i] = x >= HALL.drop ? -3 : 0;
    g0.ceil[i] = x > HALL.soffit.x0 && x < HALL.soffit.x1 && z > HALL.soffit.z0 && z < HALL.soffit.z1 ? HALL.soffit.ceil : 4;
    // the upper deck
    if (x > 2 && x < 8 && z > 2 && z < 8) { g1.cells[i] = FLOOR; g1.area[i] = 1; g1.floor[i] = 5; g1.ceil[i] = 8; }
    else g1.cells[i] = SOLID;
  }
  g0.addRamp(ramp);
  const rails: RailRun[] = [{level: 0, x0: HALL.rail.x, z0: HALL.rail.z0, x1: HALL.rail.x, z1: HALL.rail.z1, y0: 0, y1: 0, nx: -1, nz: 0}];
  return new Levels([{id: 0, role: 'main', grid: g0, baseY: 0}, {id: 1, role: 'upper', grid: g1, baseY: 5}], [], rails);
}

export const prop = (kind: string, x: number, z: number, hx: number, hz: number, h: number, y = 0): PropPlacement =>
  ({kind: kind as PropPlacement['kind'], x, z, y, rot: 0, area: 0, hx, hz, h, blocksSight: false, variant: 0, level: 0});

export function propIndex(levels: Levels, props: PropPlacement[]): PropIndex {
  return new PropIndex(levels, props);
}
