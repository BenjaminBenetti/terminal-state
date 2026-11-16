// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): a synthetic district plot for the interior planner
// (gen/surface/rooms/api.ts InteriorPlot) — a Kit with three level grids, a street ring round one building footprint (SOLID, kerb height
// outside), GEN-like storeys (gen/surface/cityInteriors.ts floorsOf: KERB + floor-to-floor, ceilings under a 0.35 m slab) and GEN-like
// street doorways (main on the frontage, a side door, the depot's track door + loading-bay door). After planning, `carve` cuts the kept
// doorways the way GEN does, and `levelsOf` / `reach` give the station's multi-level reachability over the result.

import {Rng} from '../../src/core/rng';
import {Kit} from '../../src/gen/stationKit';
import {CELL, FLOOR, type Grid} from '../../src/gen/grid';
import {levelDistance} from '../../src/gen/levelGen';
import type {Level} from '../../src/gen/levels';
import type {Area, Rect, Side} from '../../src/gen/stationTypes';
import type {SurfaceBuilding, SurfaceBuildingKind, SurfaceCondition} from '../../src/gen/surface/surfaceTypes';
import type {InteriorFloor, InteriorPlan, InteriorPlot, PlannedEntrance} from '../../src/gen/surface/rooms/api';
import {planInterior} from '../../src/gen/surface/rooms';
import {surfaceProgramme} from '../../src/gen/surface/rooms/programmes';

export const KERB = 0.15, SLAB = 0.35;
const M = 8; // street margin (cells)

export interface PlotOpts {
  programme: string;
  kind?: SurfaceBuildingKind;
  /** Frontage (along the main door's facade) x depth, OUTER footprint in cells. */
  frontage: number; depth: number;
  /** Floor-to-floor heights of the walkable storeys (m). */
  storeys: readonly number[];
  seed: number;
  front?: Side;
  condition?: SurfaceCondition;
  /** Door widths in cells: the main door, an optional side door (on the local right-hand wall), an optional back door. */
  main?: number; side?: number; back?: number;
  /** Depot: the loading-bay door (cells) on the local left-hand wall. */
  load?: number;
}

export interface Fixture {
  kit: Kit; plot: InteriorPlot; rect: Rect; streets: Area[]; opts: PlotOpts;
}

const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};
/** Local L / R wall of a front side (rooms/builder.ts InteriorBuilder.side). */
const leftOf = (f: Side): Side => (f === 'N' || f === 'S' ? 'W' : 'N');
const rightOf = (f: Side): Side => (f === 'N' || f === 'S' ? 'E' : 'S');

/** GEN's door widths (cells) per programme: [main, side] (gen/surface/cityInteriors.ts DOOR_W). */
const DOOR_W: Record<string, readonly [number, number]> = {
  grocery: [6, 3], hardware: [6, 3], 'sporting-goods': [4, 3], 'strip-centre': [8, 4], arcade: [8, 4], 'office-block': [6, 3], police: [6, 3], 'fire-station': [6, 3],
  clinic: [6, 3], 'rail-depot': [12, 3],
};

export function makePlot(o: PlotOpts): Fixture {
  const front = o.front ?? 'S';
  const alongX = front === 'N' || front === 'S';
  const w = alongX ? o.frontage : o.depth, h = alongX ? o.depth : o.frontage;
  const kit = new Kit(new Rng((o.seed ^ 0x5f3a) >>> 0), {w: w + 2 * M + 4, h: h + 2 * M + 4, levels: 3});
  const rect: Rect = {x: M + 2, y: M + 2, w, h};
  const g = kit.g;
  const street = (r: Rect, label: string): Area => {
    const a = kit.addArea(r, 'concourse', 'street', 30, -1, {label, publicSpace: true});
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g.floor[g.idx(x, y)] = KERB;
    return a;
  };
  const streets = [
    street({x: 2, y: 2, w: w + 2 * M, h: M}, 'North street'),
    street({x: 2, y: rect.y + h, w: w + 2 * M, h: M}, 'South street'),
    street({x: 2, y: rect.y, w: M, h}, 'West street'),
    street({x: rect.x + w, y: rect.y, w: M, h}, 'East street'),
  ];
  const outerOf: Record<Side, number> = {N: streets[0].id, S: streets[1].id, W: streets[2].id, E: streets[3].id};
  // ring cells of a side (corners excluded), in increasing coordinate
  const ring = (s: Side): {x: number; y: number}[] => {
    const out: {x: number; y: number}[] = [];
    if (s === 'N' || s === 'S') { const y = s === 'N' ? rect.y : rect.y + h - 1; for (let x = rect.x + 1; x < rect.x + w - 1; x++) out.push({x, y}); }
    else { const x = s === 'W' ? rect.x : rect.x + w - 1; for (let y = rect.y + 1; y < rect.y + h - 1; y++) out.push({x, y}); }
    return out;
  };
  const door = (s: Side, width: number, at: number, main: boolean): PlannedEntrance => {
    const cs = ring(s);
    const k0 = Math.max(1, Math.min(cs.length - width - 1, Math.round(at * cs.length - width / 2)));
    return {side: s, cells: cs.slice(k0, k0 + width), main, outer: outerOf[s]};
  };
  const [mw, sw] = DOOR_W[o.programme] ?? [4, 3];
  const rng = new Rng(o.seed);
  const entrances: PlannedEntrance[] = [door(front, o.main ?? mw, rng.range(0.4, 0.6), true)];
  if (o.load) entrances.push(door(leftOf(front), o.load, 0.5, false));
  if (o.side) entrances.push(door(rightOf(front), o.side ?? sw, rng.range(0.25, 0.75), false));
  if (o.back) entrances.push(door(OPP[front], o.back, rng.range(0.2, 0.8), false));
  const floors: InteriorFloor[] = [];
  let y = KERB;
  o.storeys.forEach((fh, k) => { floors.push({level: k, y: r3(y), ceil: r3(y + fh - SLAB)}); y += fh; });
  const kind = o.kind ?? surfaceProgramme(o.programme)?.kind ?? 'store';
  const building: SurfaceBuilding = {
    id: 3, block: 0, kind, programme: o.programme, name: 'Halsey Test', footprint: {x0: rect.x * CELL, z0: rect.y * CELL, x1: (rect.x + w) * CELL, z1: (rect.y + h) * CELL},
    storeys: o.storeys.length, height: y + 1, facade: 'brick-retail', condition: o.condition ?? 'intact', enterable: true, destination: true, levels: [], areas: [],
    entrances: [], windows: [],
  };
  const plot: InteriorPlot = {kit, building, rect, floors, entrances, rng: new Rng(o.seed).fork(`interior-${building.id}`), firstArea: kit.areas.length};
  void sw;
  return {kit, plot, rect, streets, opts: o};
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Plans the fixture and carves the kept doorways the way GEN does (FLOOR at the kerb, the inner area, clear to the door head). */
export function planFixture(f: Fixture): InteriorPlan {
  const plan = planInterior(f.plot);
  carve(f, plan);
  return plan;
}
export function carve(f: Fixture, plan: InteriorPlan): void {
  const g = f.kit.g;
  for (const e of plan.entrances) for (const i of e.cells) { g.cells[i] = FLOOR; g.area[i] = e.inner; g.floor[i] = KERB; g.ceil[i] = KERB + e.height; }
}

/** The station levels over the Kit's grids (role 'office' upstairs). */
export function levelsOf(kit: Kit): Level[] {
  return kit.levelGrids.map((grid, id) => ({id, role: id === 0 ? 'main' as const : 'office' as const, grid, baseY: 0}));
}

/** Multi-level walking distance from a street cell just outside the main entrance (station nav rules: steps, ramps, shared stair cells). */
export function reach(f: Fixture, plan: InteriorPlan): {levels: Level[]; dist: Int32Array[]} {
  const levels = levelsOf(f.kit);
  const main = plan.entrances.find(e => f.plot.entrances.some(p => p.main && p.cells.some(c => e.cells.includes(f.kit.g.idx(c.x, c.y))))) ?? plan.entrances[0];
  const g = f.kit.g;
  const out: Record<Side, number> = {N: -g.w, S: g.w, W: -1, E: 1};
  const s = main.cells[Math.floor(main.cells.length / 2)] + out[main.side];
  return {levels, dist: levelDistance(levels, s % g.w, Math.floor(s / g.w), 0)};
}

/** Cells (level grid indices) of an area on its level. */
export function areaCells(g: Grid, a: Area): number[] {
  const out: number[] = [];
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { const i = g.idx(x, y); if (g.area[i] === a.id) out.push(i); }
  return out;
}

/** GEN-like test plots per programme (realistic GEN footprints / storeys), a front side per case. */
export function programmeCases(programme: string, seed: number): PlotOpts[] {
  const rng = new Rng(seed * 7919 + programme.length);
  const fronts: Side[] = ['S', 'E', 'N', 'W'];
  const front = fronts[seed % 4];
  const pick = (a: number, b: number) => Math.round(rng.range(a, b));
  const P = surfaceProgramme(programme);
  const kind = P?.kind ?? 'store';
  const up = (n: number, a: number, b: number) => Array.from({length: n}, () => Math.round(rng.range(a, b) * 10) / 10);
  const base = {programme, seed, front};
  if (kind === 'depot') {
    return [{...base, frontage: pick(46, 56), depth: pick(60, 74), storeys: [4.8, ...up(1, 5.0, 5.6)], load: 10, side: 3}];
  }
  if (kind === 'centre') {
    const fr = programme === 'arcade' ? pick(118, 152) : pick(126, 168);
    return [
      {...base, frontage: fr, depth: 84, storeys: [5.0], side: 4},
      {...base, frontage: fr, depth: 84, storeys: [5.0, ...up(1, 4.0, 4.3)], back: 4},
    ];
  }
  if (kind === 'office') return [
    {...base, frontage: pick(72, 108), depth: 64, storeys: [4.6], side: 3},
    {...base, frontage: pick(72, 108), depth: 64, storeys: [4.6, ...up(2, 3.7, 3.9)], back: 3},
  ];
  if (kind === 'civic') return [
    {...base, frontage: pick(66, 108), depth: 64, storeys: [4.6], back: 3},
    {...base, frontage: pick(66, 108), depth: 64, storeys: [4.6, ...up(1, 3.8, 4.0)], side: 3},
  ];
  const W: Record<string, [number, number]> = {grocery: [68, 96], hardware: [56, 84], 'sporting-goods': [52, 76], clothing: [44, 68], electronics: [44, 64]};
  const [a, b] = W[programme] ?? [40, 60];
  return [
    {...base, frontage: pick(a, b), depth: 52, storeys: [Math.round(rng.range(4.3, 4.9) * 10) / 10], side: 3},
    {...base, frontage: pick(a, b), depth: 52, storeys: [Math.round(rng.range(4.3, 4.9) * 10) / 10, ...up(1, 3.3, 3.6)], back: 3},
  ];
}
