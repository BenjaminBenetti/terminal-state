import {describe, expect, it} from 'vitest';
import {CELL, Grid} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {generateSurfaceLevel} from '../src/gen/surface';
import {bakeLightField, sampleField, type BakedField, type FieldSource} from '../src/world/lightField';
import {stationBakeInput} from '../src/world/lights';

/** Crop actual flat Surface Run cells rather than baking the whole 232m city to test a few light pools. */
function crop(layout: StationLayout, x: number, z: number, w: number, d: number): FieldSource {
  const grid = new Grid(w / CELL, d / CELL), original = layout.grid;
  for (let cz = 0; cz < grid.h; cz++) for (let cx = 0; cx < grid.w; cx++) {
    const from = original.idx(cx + x / CELL, cz + z / CELL), to = grid.idx(cx, cz);
    for (const key of ['cells', 'area', 'floor', 'ceil', 'blocked', 'sightBlocked'] as const) grid[key][to] = original[key][from];
  }
  return {grid, trenchFloorY: layout.trench.floorY,
    lights: layout.lights.filter(l => l.x >= x && l.x < x + w && l.z >= z && l.z < z + d).map(l => ({...l, x: l.x - x, z: l.z - z}))};
}

const up = [0, 1, 0] as const;
function floorLight(field: BakedField, x: number, y: number, z: number): [number, number, number] {
  const s = sampleField(field, x, y, z, [1, 1, 1], up), cosine = Math.max(0, s.dir[1]);
  return s.amb.map((v, i) => v + s.dirColor[i] * cosine) as [number, number, number];
}
const luminance = (rgb: readonly number[]) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

describe('Surface Run local lighting reaches the surfaces it stages', () => {
  const layout = generateSurfaceLevel({levelSeed: 4242}, 'subway'), params = stationBakeInput(layout).params;

  it('the bounded street daylight lights real ground without enhanced GI or a global ambient fill', () => {
    const street = crop(layout, 0, 0, 24, 24), field = bakeLightField(street, params);
    const light = floorLight(field, 9, 0.05, 9);
    expect(luminance(light), 'street-level irradiance under the generated daylight').toBeGreaterThan(0.2);
    expect(light[1]).toBeGreaterThan(light[0]); // the existing toxic-green tint survives the bake
    expect(luminance(floorLight(field, 21, 0.05, 7)), 'the source remains a bounded pool').toBeLessThan(luminance(light) / 10);
  });

  it('the actual checkpoint lantern warms its planning table, and both truck-staging pools reach the ground', () => {
    const source = crop(layout, 32, 168, 40, 40), lantern = layout.props.find(p => p.kind === 'campLantern')!;
    const warm = source.lights.find(l => l.virtual && l.warm && l.x === lantern.x - 32 && l.z === lantern.z - 168);
    expect(warm, 'a source is paired with the actual placed lantern').toBeDefined();
    const field = bakeLightField(source, params), unlitLantern = bakeLightField({...source, lights: source.lights.filter(l => l !== warm)}, params);
    const table = layout.surface!.checkpoint.map;
    const lit = floorLight(field, table.x - 32, table.y, table.z - 168), unlit = floorLight(unlitLantern, table.x - 32, table.y, table.z - 168);
    const contribution = lit.map((v, i) => v - unlit[i]);
    expect(luminance(contribution), 'real lantern contribution on the planning table').toBeGreaterThan(0.05);
    expect(contribution[0]).toBeGreaterThan(contribution[1]);
    expect(contribution[1]).toBeGreaterThan(contribution[2]);
    const truck = layout.surface!.truck;
    for (const z of [truck.z, truck.z - 6]) expect(luminance(floorLight(field, truck.x - 32, truck.y + 0.05, z - 168)), `truck staging at ${truck.x},${z}`).toBeGreaterThan(0.2);
    // Keep the sparse city grid plus three checkpoint-only sources; interior fixtures remain a separate population.
    expect(layout.lights.filter(l => l.virtual && l.area === 0)).toHaveLength(35);
  });
});
