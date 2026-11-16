import * as THREE from 'three';
import {afterAll, describe, expect, it} from 'vitest';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {CELL, FLOOR} from '../src/gen/grid';
import {generateSurfaceLevel} from '../src/gen/surface';
import {generateStation} from '../src/gen/station';
import type {Area, StationLayout} from '../src/gen/stationTypes';
import {buildWorld} from '../src/world/builder';
import {finishClass} from '../src/damage/impactFinish';
import {DECAY_HOOK} from '../src/world/decay';
import {hasNodeHook} from '../src/render/nodeHooks';
import {WorldMaterials} from '../src/world/materials';
import {stationLevels} from '../src/world/levelGeometry';
import {SurfaceArch} from '../src/world/surface/arch';
import {surfaceAlbedo, ALB_CEIL, ALBEDO_STRIDE} from '../src/world/surfaceAlbedo';
import {levelGeometries} from '../src/world/lightField';
import {stationFieldSource} from '../src/world/lights';
import {finishFamily, treatmentOf} from '../src/world/wallDetailPlan';
import {installCanvasShim} from './helpers/canvas2d';

const uninstall = installCanvasShim(false); afterAll(uninstall);
const fakeEnv = (): Record<TextureKey, THREE.Texture> => Object.fromEntries(Object.keys(TEXTURE_FILES).map(key =>
  [key, new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement)])) as Record<TextureKey, THREE.Texture>;
const fixture = () => generateSurfaceLevel({levelSeed: 93, surfaceVersion: 1}, 'subway');
const materials = () => new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
const cell = (layout: StationLayout, x: number, z: number) => Math.floor(z / CELL) * layout.grid.w + Math.floor(x / CELL);
function roomCells(layout: StationLayout): Map<number, number> {
  const out = new Map<number, number>(), g = layout.grid;
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && !out.has(g.area[i])) out.set(g.area[i], i);
  return out;
}
const point = (layout: StationLayout, i: number) => ({x: (i % layout.grid.w + 0.5) * CELL, z: (Math.floor(i / layout.grid.w) + 0.5) * CELL});
function containingRect(list: readonly number[], x: number, z: number): number | undefined {
  for (let q = 0; q + 6 < list.length; q += 7) if (x >= list[q + 1] && x < list[q + 3] && z >= list[q + 2] && z < list[q + 4]) return q;
  return undefined;
}

describe('Surface Run architecture uses the actual local programmes', () => {
  it('does not opt an ordinary Subway into urban finishes or alter its seeded generation', () => {
    const subway = generateStation(9301, {trackExtensions: 'none'}), mats = materials();
    expect(SurfaceArch.for(subway, mats, stationLevels(subway))).toBeNull();
    const repeated = generateStation(9301, {trackExtensions: 'none'});
    expect(subway.grid.cells).toEqual(repeated.grid.cells); expect(subway.grid.ceil).toEqual(repeated.grid.ceil);
    expect([subway.areas, subway.doors, subway.props, subway.pickups, subway.zombies, subway.lights]).toEqual(
      [repeated.areas, repeated.doors, repeated.props, repeated.pickups, repeated.zombies, repeated.lights]);
  });

  it('selects varied mapped room finishes and streets without changing layout, enemies, loot or collision', () => {
    const layout = fixture(), mats = materials(), arch = SurfaceArch.for(layout, mats, stationLevels(layout))!, cells = roomCells(layout);
    const before = {areas: structuredClone(layout.areas), pickups: structuredClone(layout.pickups), zombies: structuredClone(layout.zombies),
      destinations: structuredClone(layout.surface!.destinations), cells: layout.grid.cells.slice(), ceil: layout.grid.ceil.slice(), sky: layout.levels[0].sky!.open!.slice()};
    const keyOf = (purpose: string) => {
      const area = layout.areas.find(a => a.purpose === purpose)!;
      expect(area, purpose).toBeDefined(); return arch.floorKey(0, cells.get(area.id)!);
    };
    expect(keyOf('office-private')).toMatch(/^surface-floor-carpet@/);
    expect(keyOf('office-meeting')).toMatch(/^surface-floor-carpet@/);
    expect(keyOf('office-server')).toMatch(/^surface-floor-server@/);
    expect(keyOf('office-break')).toMatch(/^surface-floor-tile@/);
    expect(keyOf('pharmacy')).toMatch(/^surface-floor-vinyl@/);
    expect(keyOf('coffee')).toMatch(/^surface-floor-wood@/);
    expect(keyOf('workshop')).toMatch(/^surface-floor-concrete@/);
    expect(keyOf('stock-room')).toMatch(/^surface-floor-concrete@/);
    expect(arch.floorKey(0, cell(layout, 8, 8))).toBe('surface-floor-asphalt');
    expect(arch.floorKey(0, cell(layout, 45, 185))).toBe('surface-floor-concrete');
    const known = new Set<string>();
    for (const area of layout.areas) {
      const i = cells.get(area.id); if (i === undefined) continue;
      const floor = arch.floorKey(0, i)!, ceiling = arch.ceilKey(0, area.id, i);
      known.add(floor); if (typeof ceiling === 'string') known.add(ceiling);
    }
    for (const key of known) {
      expect(arch.material(key), key).toBeDefined(); expect(finishClass(key), key).not.toBeNull();
      expect(arch.scale(key)).toEqual({u: 1, v: 1});
    }
    const asphalt = arch.material('surface-floor-asphalt') as THREE.MeshStandardMaterial;
    expect(asphalt.map).toBe((mats.get('concrete') as THREE.MeshStandardMaterial).map);
    expect(asphalt.normalMap).not.toBeNull(); expect(asphalt.roughnessMap).not.toBeNull();
    expect(asphalt.metalness).toBe(0); expect(hasNodeHook(asphalt as never, DECAY_HOOK)).toBe(true);
    const again = SurfaceArch.for(fixture(), mats, stationLevels(layout))!;
    for (const key of known) expect(again.material(key)).toBe(arch.material(key));
    expect({areas: layout.areas, pickups: layout.pickups, zombies: layout.zombies, destinations: layout.surface!.destinations,
      cells: layout.grid.cells, ceil: layout.grid.ceil, sky: layout.levels[0].sky!.open}).toEqual(before);
    const ordinary = {...layout}; delete ordinary.surface;
    expect(SurfaceArch.for(ordinary, mats, stationLevels(layout))).toBeNull();
    expect(arch.material('tileLower')).toBeUndefined(); expect(arch.scale('tileLower')).toBeUndefined();
  });

  it('builds real Surface wall/floor/ceiling materials and publishes the same finishes to damage and the light bake', () => {
    const layout = fixture(), mats = materials();
    // The test exercises the full64-block/16-destination architecture; movable dressing is irrelevant to its finish contract.
    layout.props = []; layout.signs = []; layout.lights = [];
    const world = buildWorld(layout, mats, {}), arch = world.surfaceArch!, drawn = world.drawn!, cells = roomCells(layout);
    expect(layout.surface!.blocks).toHaveLength(64); expect(layout.surface!.destinations).toHaveLength(16);
    expect(arch).toBeDefined(); expect(world.officeArch).toBeUndefined(); expect(world.mallArch).toBeUndefined();
    expect(drawn.floors.length).toBeGreaterThan(0); expect(drawn.faces.length).toBeGreaterThan(0);
    expect(drawn.keys.every(key => key.startsWith('surface-'))).toBe(true);
    expect(drawn.faces.every(face => face.finish.startsWith('surface-wall-'))).toBe(true);
    for (const key of new Set([...drawn.keys, ...drawn.faces.map(face => face.finish)])) {
      expect(drawn.material(key)).toBe(arch.material(key)); expect(finishClass(key), key).not.toBeNull();
    }
    for (const face of world.wallFaces) {
      expect(finishFamily(face.finish)).toBe('office');
      expect(['officeRoof', 'officeWall']).toContain(treatmentOf(face));
    }
    const office: Area = layout.areas.find(a => a.purpose === 'office-private')!, officeCell = cells.get(office.id)!, officePoint = point(layout, officeCell);
    const floorRect = containingRect(drawn.floors, officePoint.x, officePoint.z)!;
    const officeKey = drawn.keys[drawn.floors[floorRect + 6]];
    expect(officeKey).toMatch(/^surface-floor-carpet@/); expect(finishClass(officeKey)).toBe('fabric');
    expect(world.finishAt!('floor', 0, officePoint.x, 0, officePoint.z, 0, 0)).toBe(officeKey);
    const officeCeil = containingRect(drawn.ceils, officePoint.x, officePoint.z)!;
    expect(drawn.keys[drawn.ceils[officeCeil + 6]]).toBe('surface-ceil-grid');
    const street = {x: 8.25, z: 8.25}, streetCeil = containingRect(drawn.ceils, street.x, street.z)!;
    expect(drawn.ceils[streetCeil + 6]).toBe(-1);
    expect(arch.ceilKey(0, 0, cell(layout, street.x, street.z))).toBe(false);
    expect(world.finishAt!('ceiling', 0, street.x, 12, street.z, 0, 0)).toBeNull();
    const upward = new THREE.Raycaster(new THREE.Vector3(street.x, 0.2, street.z), new THREE.Vector3(0, 1, 0), 0, 30);
    expect(upward.intersectObject(world.group, true)).toEqual([]);
    const shelter = {x: 44.25, z: 197.25}, shelterCeil = containingRect(drawn.ceils, shelter.x, shelter.z)!;
    expect(drawn.keys[drawn.ceils[shelterCeil + 6]]).toBe('surface-ceil-raw');
    const albedo = surfaceAlbedo(layout.grid.w, layout.grid.h, stationLevels(layout), levelGeometries(stationFieldSource(layout)), drawn);
    const streetOffset = cell(layout, street.x, street.z) * ALBEDO_STRIDE + ALB_CEIL;
    expect([...albedo.slots[0].slice(streetOffset, streetOffset + 3)]).toEqual([0, 0, 0]);
    expect(albedo.stats.open).toBeGreaterThan(1000);
    const geometries = new Set<THREE.BufferGeometry>();
    world.group.traverse(object => {const mesh = object as THREE.Mesh; if (mesh.isMesh) geometries.add(mesh.geometry);});
    for (const geometry of geometries) geometry.dispose();
  });
});
