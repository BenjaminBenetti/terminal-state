// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): the version-2 districts of the deep-interior tests (tests/
// surface-interior-v2*.test.ts, surface-roof-*.test.ts, surface-storeys-*.test.ts) — GEN's real district (gen/surface/index.ts) on every
// host and several seeds, each built once per (host, seed, version) with its generation time.

import type {StationLayout} from '../../src/gen/stationTypes';
import {generateSurfaceDistrict} from '../../src/gen/surface/index';
import type {SurfaceHost} from '../../src/gen/surface/surfaceRun';
import type {SurfaceBuilding} from '../../src/gen/surface/surfaceTypes';
import {CELL} from '../../src/gen/grid';

export const DEEP_HOSTS: readonly SurfaceHost[] = ['subway', 'office', 'mall'];
export const DEEP_SEEDS: readonly number[] = [3, 8, 13, 21];

export interface DeepCase { host: SurfaceHost; seed: number; v: number; L: StationLayout; ms: number; tag: string }
const cache = new Map<string, DeepCase>();

/** The district of (host, seed) at version v (default 2), cached. */
export function deepDistrict(host: SurfaceHost, seed: number, v = 2): DeepCase {
  const k = `${host}/${seed}/${v}`;
  let c = cache.get(k);
  if (!c) {
    const t0 = performance.now();
    const L = generateSurfaceDistrict(host, {levelSeed: seed, surfaceVersion: v});
    c = {host, seed, v, L, ms: performance.now() - t0, tag: `${host} seed ${seed} v${v}`};
    cache.set(k, c);
  }
  return c;
}

/** Every (host, seed) district at version v. */
export const deepCases = (v = 2): DeepCase[] => DEEP_HOSTS.flatMap(h => DEEP_SEEDS.map(s => deepDistrict(h, s, v)));

/** The enterable destination buildings of a district (the ones a player goes into). */
export const destinations = (L: StationLayout): SurfaceBuilding[] => L.surface!.buildings.filter(b => b.destination && b.enterable);

/** Grid cell index of world (x, z) on the district grid. */
export const cellAt = (L: StationLayout, x: number, z: number): number => Math.floor(z / CELL) * L.grid.w + Math.floor(x / CELL);

/** The cells of an area on its own level's grid. */
export function areaCellsOf(L: StationLayout, area: number): number[] {
  const a = L.areas[area], g = L.levels![a.level ?? 0].grid, out: number[] = [];
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { const i = y * g.w + x; if (g.area[i] === area) out.push(i); }
  return out;
}
