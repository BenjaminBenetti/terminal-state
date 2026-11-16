// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract SKELETON — lane GEN replaces the body): SURFACE RUN's district
// generator, `LEVELS[host].generate('surface', ctx)` (levels/registry.ts). Deterministic from the host station's level seed through
// surfaceSeed (gen/surface/surfaceRun.ts), never the host's streams.
//
// This skeleton is a structurally faithful placeholder the runtime lanes build against before GEN lands: the real 8 x 8-block frame and
// boundary, one closed building per block, a plain enterable room per core building, the portal, checkpoint, truck pose and depot
// recoverables in their contract shapes (gen/surface/surfaceTypes.ts). Everything else (streets / sidewalks / lots, varied programmes and
// interiors, storeys, dressing, loot, interior enemies, window spans, map notes) is GEN's.

import {CELL, FLOOR, Grid, SOLID} from '../grid';
import type {Area, StationLayout} from '../stationTypes';
import type {SectionGenContext} from '../../levels/types';
import {emptyTraversal} from '../traversal';
import {surfaceSeed, type SurfaceHost} from './surfaceRun';
import type {SRect, SurfaceBlock, SurfaceBuilding, SurfaceInfo} from './surfaceTypes';

/** Block frame (metres): 8 x 8 blocks at PITCH, streets STREET wide on every block line, MARGIN outside the perimeter road. */
export const SURFACE_FRAME = {blocks: 8, pitch: 64, street: 16, margin: 8, sidewalk: 3, coreFrom: 2, coreTo: 5} as const;

/** Open-sky ceiling over outdoor cells (absolute). */
const SKY_CEIL = 40;
const INTERIOR_CEIL = 3.6;

export function generateSurfaceDistrict(host: SurfaceHost, ctx: SectionGenContext): StationLayout {
  const F = SURFACE_FRAME;
  const seed = surfaceSeed(ctx.levelSeed);
  const size = 2 * F.margin + F.blocks * F.pitch; // 528 m
  const W = Math.round(size / CELL), H = W;
  const g = new Grid(W, H);
  const cell = (m: number) => Math.floor(m / CELL);
  const areas: Area[] = [];
  const addArea = (r: SRect, type: Area['type'], kind: Area['kind'], label: string, ceil: number, lighting: Area['lighting']): Area => {
    const a = {id: areas.length, kind, type, label, ceil, parent: -1, depth: 0, publicSpace: true, lighting,
      x: cell(r.x0), y: cell(r.z0), w: cell(r.x1) - cell(r.x0), h: cell(r.z1) - cell(r.z0)} as Area;
    areas.push(a);
    return a;
  };
  const fill = (r: SRect, v: number, area: number, ceil: number) => {
    for (let y = cell(r.z0); y < cell(r.z1); y++) for (let x = cell(r.x0); x < cell(r.x1); x++) {
      const i = g.idx(x, y);
      g.cells[i] = v; g.area[i] = v === FLOOR ? area : -1; g.ceil[i] = v === FLOOR ? ceil : 0; g.floor[i] = 0;
    }
  };
  // outdoors: everything inside the perimeter wall
  const extent: SRect = {x0: 0, z0: 0, x1: size, z1: size};
  const street = addArea(extent, 'street', 'concourse', 'Street', SKY_CEIL, 'lit');
  fill({x0: 1, z0: 1, x1: size - 1, z1: size - 1}, FLOOR, street.id, SKY_CEIL);
  const line = (i: number) => F.margin + i * F.pitch;
  const blocks: SurfaceBlock[] = [], buildings: SurfaceBuilding[] = [];
  for (let row = 0; row < F.blocks; row++) for (let col = 0; col < F.blocks; col++) {
    const rect: SRect = {x0: line(col) + F.street / 2, z0: line(row) + F.street / 2, x1: line(col + 1) - F.street / 2, z1: line(row + 1) - F.street / 2};
    const core = col >= F.coreFrom && col <= F.coreTo && row >= F.coreFrom && row <= F.coreTo;
    const fp: SRect = {x0: rect.x0 + F.sidewalk, z0: rect.z0 + F.sidewalk, x1: rect.x1 - F.sidewalk, z1: rect.z1 - F.sidewalk};
    fill(fp, SOLID, -1, 0);
    const b: SurfaceBuilding = {id: buildings.length, block: blocks.length, kind: core ? 'store' : 'ruin', programme: core ? 'general-store' : 'ruin',
      name: core ? `Block ${col}-${row} Store` : '', footprint: fp, storeys: core ? 2 : 3, height: core ? 8 : 11, facade: 'brick', condition: core ? 'intact' : 'gutted',
      enterable: core, destination: core, levels: core ? [0] : [], areas: [], entrances: [], windows: []};
    if (core) {
      const inner: SRect = {x0: fp.x0 + CELL, z0: fp.z0 + CELL, x1: fp.x1 - CELL, z1: fp.z1 - CELL};
      const room = addArea(inner, 'shop', 'room', b.name, INTERIOR_CEIL, 'dim');
      fill(inner, FLOOR, room.id, INTERIOR_CEIL);
      const dx = (fp.x0 + fp.x1) / 2, door: SRect = {x0: dx - 1, z0: fp.z1 - CELL, x1: dx + 1, z1: fp.z1};
      fill(door, FLOOR, room.id, 2.4);
      const cells: number[] = [];
      for (let y = cell(door.z0); y < cell(door.z1); y++) for (let x = cell(door.x0); x < cell(door.x1); x++) cells.push(g.idx(x, y));
      b.areas.push(room.id);
      b.entrances.push({id: `b${b.id}-e0`, building: b.id, level: 0, x: dx, z: fp.z1, side: 'S', width: 2, height: 2.4, inner: room.id, outer: street.id, door: 'smashed', cells});
    }
    blocks.push({id: blocks.length, col, row, rect, core, buildings: [b.id]});
    buildings.push(b);
  }
  // portal on the core's south-west street corner, the checkpoint east of it, the truck beside the checkpoint
  const px = line(F.coreFrom) + 2, pz = line(F.coreTo + 1);
  const portalBox = {x0: px - 1, z0: pz - 1, x1: px + 1, z1: pz + 1, y0: 0, y1: 2.4};
  const checkpoint: SRect = {x0: px + 3, z0: pz - 6, x1: px + 23, z1: pz + 6};
  const cp = addArea(checkpoint, 'street', 'concourse', 'Checkpoint', SKY_CEIL, 'lit');
  for (let y = cell(checkpoint.z0); y < cell(checkpoint.z1); y++) for (let x = cell(checkpoint.x0); x < cell(checkpoint.x1); x++) g.area[g.idx(x, y)] = cp.id;
  const depotB = buildings.find(b => b.enterable)!;
  depotB.kind = 'depot'; depotB.programme = 'rail-depot'; depotB.name = 'Rail Depot';
  const dc = {x: (depotB.footprint.x0 + depotB.footprint.x1) / 2, z: (depotB.footprint.z0 + depotB.footprint.z1) / 2};
  const surface: SurfaceInfo = {
    v: 1, name: 'Surface District', host, seed, extent, core: {x0: line(F.coreFrom), z0: line(F.coreFrom), x1: line(F.coreTo + 1), z1: line(F.coreTo + 1)},
    cols: F.blocks, rows: F.blocks, blocks, streets: [], buildings, windows: [], outdoorAreas: [street.id, cp.id],
    portal: {kind: host === 'subway' ? 'stair' : 'door', pose: {x: px, z: pz - 2.5, yaw: -Math.PI / 2, level: 0, y: 0}, trigger: portalBox, building: null, label: 'Back down'},
    checkpoint: {area: cp.id, rect: checkpoint, tent: {rect: {x0: checkpoint.x0 + 1, z0: checkpoint.z0 + 1, x1: checkpoint.x0 + 7, z1: checkpoint.z0 + 6}, area: cp.id,
      door: {x: checkpoint.x0 + 4, z: checkpoint.z0 + 6, side: 'S'}}, mapTable: {prop: -1, read: {x: checkpoint.x0 + 4, z: checkpoint.z0 + 4, yaw: 0, level: 0, y: 0}}},
    truck: {x: checkpoint.x0 + 14, z: pz, yaw: -Math.PI / 2, level: 0, y: 0},
    depot: {building: depotB.id, recoverables: (['radar', 'sentry', 'scanner', 'chest', 'armor'] as const).map((kind, k) => ({kind, pose: {x: dc.x - 8 + k * 4, z: dc.z, yaw: 0, level: 0, y: 0}}))},
    outdoor: {areas: [street.id], spawnZones: [], safe: {x0: px - 30, z0: pz - 30, x1: px + 40, z1: pz + 30}},
    notes: [], storeys: [{level: 0, label: 'Street', y: 0}],
  };
  return {
    seed, attempt: 0, name: surface.name, archetype: 'side-mezzanine', towards: ['', ''], grid: g, areas, doors: [], props: [], lights: [], signs: [], pickups: [], zombies: [],
    storefronts: [], decor: [], playerSpawn: {x: surface.portal.pose.x, z: surface.portal.pose.z, yaw: surface.portal.pose.yaw},
    trench: {x0: 0, x1: 0, z0: 0, z1: 0, floorY: 0, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0}, trenches: [],
    platform: cp.id, platforms: [cp.id], traversal: emptyTraversal(), levels: [{id: 0, role: 'main', grid: g, baseY: 0}], levelLinks: [], rails: [],
    surface,
  };
}
