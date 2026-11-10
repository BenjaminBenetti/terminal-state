// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): the stepped station builders build EXACTLY the same station as
// their synchronous wrappers, on EVERY level kind (LEVEL_IDS at run time: a level added later is covered automatically). Per kind, the
// same generated layout (generated twice) is built twice with the real (texture-stripped) models the game's lazy library fetches:
//   A — the synchronous APIs every other caller uses (buildWorld, ContainerManager.build, ShelfStock.build, new StationLighting,
//       VolumetricAtmosphere.setStation);
//   B — the stepped builders the journey paces (buildWorldSteps, buildSteps, StationLighting.steps, setStationSteps), drained by the
//       real paced runner with a PAUSE AT EVERY YIELD (sliceMs 0: the event loop turns between steps and other code draws from
//       Math.random there, like the riding car's frames).
// Compared: every object of the world / holders / shelf stock / the lighting's scene additions in traversal order (type, name, flags,
// layers, matrices, userData, geometry attribute / index hashes, instance matrices / colours, a material key), the world's fixtures /
// stats / wall faces / rails, every holder's lots, the light field bytes, the density and air map bytes. Plus the structure the pacing
// relies on: every stepped builder yields, and often enough per ms of work (a count, never a wall-clock bound).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {layoutFor, linesHash, materialsFor, modelsFor, objectLines, hashBytes, stableText, SHELF_JUNK_KEY, type LevelModels} from './helpers/pacedBuildFixture';
import {buildWorld, buildWorldSteps} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {ShelfStock} from '../src/world/shelfStock';
import {StationLighting, MOOD} from '../src/world/lights';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {Inventory} from '../src/items/inventory';
import {lootProfile} from '../src/items/lootTables';
import {pantryHolderRealizer} from '../src/items/pantryVariety';
import {placementBox} from '../src/items/lootLayout';
import {captureHolders} from '../src/run/worldMemory';
import {dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import {setAttributeInstancing} from '../src/render/instancing';
import {applySkywaysStageSupport} from '../src/gen/skyways/stageSupport';
import {levelsOf} from '../src/gen/levels';
import {LEVEL_HEURISTIC_MIN_LEVELS, PathFinder} from '../src/gen/grid';
import type {WorldMaterials} from '../src/world/materials';
import {newPacedStats, runPaced, type BuildSteps, type PacedBuildStats} from '../src/core/pacedBuild';

const SEED = 4242;

interface Built { parts: Record<string, string[]>; stats: Record<string, PacedBuildStats>; navLevels: number }

/** The Game.buildSection share of the station builders, in its order; `paced` = the stepped twins through the paced runner. */
async function buildStation(level: LevelId, models: LevelModels, mats: WorldMaterials, paced: boolean): Promise<Built> {
  const layout = layoutFor(level, SEED);
  dropUnloadedP7(layout, new Set(p7ModelKeysFor(layout).filter(k => models.lazy[k])));
  setAttributeInstancing(!!layout.mall || !!(layout as {reactor?: unknown}).reactor);
  const stats: Record<string, PacedBuildStats> = {};
  // a pause at every yield: the event loop turns, and other code draws from the global RNG meanwhile (as the riding car's frames may)
  const step = <T>(name: string, g: BuildSteps<T>): Promise<T> => runPaced(g, {sliceMs: 0, stats: (stats[name] = newPacedStats()), hidden: () => false,
    frame: go => { setImmediate(() => { Math.random(); Math.random(); go(); }); }});
  const world = paced ? await step('world', buildWorldSteps(layout, mats, models.all)) : buildWorld(layout, mats, models.all);
  const cm = new ContainerManager(models.boot, mats, () => new Inventory());
  const realize = pantryHolderRealizer(level, {}, lootProfile(level));
  if (paced) await step('holders', cm.buildSteps(layout, models.lazy, lootProfile(level), realize)); else cm.build(layout, models.lazy, lootProfile(level), realize);
  applySkywaysStageSupport(layout);
  // the navigation finder (a stacked station's level distance fields: one level per step)
  const nav = levelsOf(layout);
  const pf = paced ? await step('pathfinder', PathFinder.steps(nav)) : new PathFinder(nav);
  const pfData = pf as unknown as {levelDist: Float32Array[] | null; levelNode: Int32Array | null; levelEntries: Int32Array[] | null; wallCost: Float32Array; walk: Uint8Array};
  const g0 = layout.grid, sp = layout.playerSpawn;
  const routes = layout.zombies.slice(0, 6).map(z => stableText(pf.find(sp.x, sp.z, z.x, z.z, 0.34, 26000, {ay: 0, by: z.y ?? 0})));
  const stock = new ShelfStock();
  const deps = {models: {...models.boot, [SHELF_JUNK_KEY]: models.lazy[SHELF_JUNK_KEY]} as never, lotsOf: (p: Parameters<ContainerManager['holderFor']>[0]) => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []};
  if (paced) await step('stock', stock.buildSteps(layout, deps)); else stock.build(layout, deps);
  const scene = new THREE.Scene();
  const lopts = {hemi: new THREE.HemisphereLight(), fogDensity: MOOD.fogDensity, far: 70, max3DTextureSize: 2048};
  const lighting = paced ? await step('lighting', StationLighting.steps(scene, layout, world.fixtures, world.tubes, lopts)) : new StationLighting(scene, layout, world.fixtures, world.tubes, lopts);
  const atmo = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
  if (paced) await step('fog', atmo.setStationSteps(layout, lighting.volume)); else atmo.setStation(layout, lighting.volume);
  const maps = atmo as unknown as {densityMap: {data: Uint8Array; w: number; h: number; slots: number}; airMap: {data: Uint8Array}; params: unknown};
  const parts: Record<string, string[]> = {
    world: objectLines(world.group),
    worldData: [stableText(world.stats), stableText(world.fixtures), stableText(world.wallFaces), stableText(world.rails)],
    holders: objectLines(cm.group),
    lots: [stableText(captureHolders(cm))],
    stock: objectLines(stock.group),
    lighting: [hashBytes(lighting.field.data), hashBytes(lighting.field.groups), `${lighting.field.w}x${lighting.field.h}x${lighting.field.depth}`, stableText(lighting.levels), stableText(lighting.field.slotY), ...objectLines(scene)],
    pathfinder: [...(pfData.levelDist ?? []).map(d => hashBytes(d)), hashBytes(pfData.levelNode), ...(pfData.levelEntries ?? []).map(e => hashBytes(e)), hashBytes(pfData.wallCost), hashBytes(pfData.walk), `grid ${g0.w}x${g0.h}`, ...routes],
    fog: [hashBytes(maps.densityMap.data), hashBytes(maps.airMap.data), `${maps.densityMap.w}x${maps.densityMap.h}x${maps.densityMap.slots}`, stableText(maps.params)],
  };
  lighting.dispose(scene);
  return {parts, stats, navLevels: nav.list.length};
}

/** The first line where two builds differ (a readable failure instead of a 1000-line diff). */
function firstDiff(a: readonly string[], b: readonly string[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `line ${i}/${a.length}:${b.length}\n  sync:  ${a[i]?.slice(0, 600)}\n  paced: ${b[i]?.slice(0, 600)}`;
  return null;
}

describe('stepped station builders: identical to the synchronous build on every level kind (lane BUILD)', () => {
  for (const level of LEVEL_IDS) {
    it(`${level}: world, holders + lots, shelf stock, light field, fog maps — sync vs paused at every yield`, async () => {
      const models = await modelsFor(level, layoutFor(level, SEED));
      const mats = materialsFor(models);
      const A = await buildStation(level, models, mats, false);
      const B = await buildStation(level, models, mats, true);
      for (const k of Object.keys(A.parts)) {
        expect(firstDiff(A.parts[k], B.parts[k]), `${level} ${k}`).toBeNull();
        expect(linesHash(B.parts[k]), `${level} ${k}`).toBe(linesHash(A.parts[k]));
      }
      expect(A.parts.world.length).toBeGreaterThan(20);
      // structure: every stepped builder yields (a pause point per step: sliceMs 0), and the world / bake yield at many points; the path
      // finder yields once per level field (stacks of LEVEL_HEURISTIC_MIN_LEVELS+ levels; fewer levels: one step, no fields)
      for (const [name, s] of Object.entries(B.stats)) {
        expect(s.waits, `${level} ${name}`).toBe(s.steps - 1);
        if (name === 'pathfinder') expect(s.steps, `${level} ${name}`).toBe(B.navLevels >= LEVEL_HEURISTIC_MIN_LEVELS ? 2 + B.navLevels : 1);
        else expect(s.steps, `${level} ${name}`).toBeGreaterThan(1);
      }
      expect(B.stats.world.steps).toBeGreaterThan(40);
      expect(B.stats.lighting.steps).toBeGreaterThan(8);
    }, 240000);
  }
});
