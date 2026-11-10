// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): the SLICE structure of the stepped station builders on real
// levels — the Subway, the Office tower and the Reactor (the common station and the two heaviest stacks). The journey's paced build
// (core/pacedBuild.ts) can only pause where a builder yields, so each builder must yield often enough per ms of work and no single step
// may hold a large share of its builder's work. Asserted as counts and ratios of the same run (independent of the machine's speed: CI
// runs ~1.5x slower than the studio pod), plus one very generous wall-clock bound on the worst step that only catches a lost yield.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {layoutFor, materialsFor, modelsFor, SHELF_JUNK_KEY} from './helpers/pacedBuildFixture';
import {buildWorldSteps} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {ShelfStock} from '../src/world/shelfStock';
import {StationLighting, MOOD} from '../src/world/lights';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {Inventory} from '../src/items/inventory';
import {lootProfile} from '../src/items/lootTables';
import {pantryHolderRealizer} from '../src/items/pantryVariety';
import {placementBox} from '../src/items/lootLayout';
import {dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import {setAttributeInstancing} from '../src/render/instancing';
import {applySkywaysStageSupport} from '../src/gen/skyways/stageSupport';
import {levelsOf} from '../src/gen/levels';
import {PathFinder} from '../src/gen/grid';
import type {LevelId} from '../src/levels/types';
import type {BuildSteps} from '../src/core/pacedBuild';

interface Slices { steps: number; workMs: number; maxMs: number; maxAt: string }
/** Every step of `g` timed on its own (the label of the stage it ran in for the failure message). */
function slices<T>(g: BuildSteps<T>): {r: T; s: Slices} {
  let steps = 0, workMs = 0, maxMs = 0, maxAt = '', stage = '(start)';
  for (;;) {
    const t0 = performance.now(), r = g.next(), ms = performance.now() - t0;
    steps++; workMs += ms;
    if (ms > maxMs) { maxMs = ms; maxAt = stage; }
    if (r.done) return {r: r.value, s: {steps, workMs, maxMs, maxAt}};
    if (typeof r.value === 'string') stage = r.value;
  }
}

/**
 * Per builder: at least `perSec` steps per second of work (average step <= 1000 / perSec ms) and no step above `share` of the builder's
 * total. Set from the studio pod's measurements with a wide margin (see the lane report); `maxMs` = the lost-yield guard.
 */
const BOUNDS: Record<string, {perSec: number; share: number}> = {
  world: {perSec: 60, share: 0.3}, holders: {perSec: 60, share: 0.5}, stock: {perSec: 40, share: 0.45}, lighting: {perSec: 60, share: 0.4},
  fog: {perSec: 15, share: 0.65}, pathfinder: {perSec: 15, share: 0.7},
};
const LOST_YIELD_MS = 1500;

describe('stepped station builders: slices bounded by structure (lane BUILD)', () => {
  for (const level of ['subway', 'office', 'reactor'] as LevelId[]) {
    it(`${level}: every builder yields often enough and no step holds a large share of its work`, async () => {
      const layout = layoutFor(level, 4242);
      const models = await modelsFor(level, layout);
      const mats = materialsFor(models);
      dropUnloadedP7(layout, new Set(p7ModelKeysFor(layout).filter(k => models.lazy[k])));
      setAttributeInstancing(!!layout.mall || !!(layout as {reactor?: unknown}).reactor);
      const out: Record<string, Slices> = {};
      const w = slices(buildWorldSteps(layout, mats, models.all));
      out.world = w.s;
      const cm = new ContainerManager(models.boot, mats, () => new Inventory());
      out.holders = slices(cm.buildSteps(layout, models.lazy, lootProfile(level), pantryHolderRealizer(level, {}, lootProfile(level)))).s;
      applySkywaysStageSupport(layout);
      const nav = levelsOf(layout);
      if (nav.list.length >= 4) out.pathfinder = slices(PathFinder.steps(nav)).s; // (fewer levels: no level fields, one step by design)
      const stock = new ShelfStock();
      out.stock = slices(stock.buildSteps(layout, {models: {...models.boot, [SHELF_JUNK_KEY]: models.lazy[SHELF_JUNK_KEY]} as never, lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []})).s;
      const scene = new THREE.Scene();
      const li = slices(StationLighting.steps(scene, layout, w.r.fixtures, w.r.tubes, {hemi: new THREE.HemisphereLight(), fogDensity: MOOD.fogDensity, far: 70, max3DTextureSize: 2048}));
      out.lighting = li.s;
      out.fog = slices(new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high').setStationSteps(layout, li.r.volume)).s;
      li.r.dispose(scene);
      for (const [name, s] of Object.entries(out)) {
        const b = BOUNDS[name], tag = `${level} ${name}: ${s.steps} steps, ${s.workMs.toFixed(0)} ms, worst ${s.maxMs.toFixed(0)} ms (${s.maxAt})`;
        expect(s.steps / (s.workMs / 1000), tag).toBeGreaterThanOrEqual(b.perSec);
        expect(s.maxMs / s.workMs, tag).toBeLessThanOrEqual(b.share);
        expect(s.maxMs, tag).toBeLessThan(LOST_YIELD_MS);
      }
    }, 240000);
  }
});
