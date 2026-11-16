// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): the depot shed's gear drawn from lane ROOMS' features
// (layout.surface.depot.features: rail tracks, the grated inspection pit, the overhead travelling crane) — on GEN's real district,
// with the features laid into its rail depot here (ROOMS publishes the same shape): flush with the shed floor or above reach, inside the
// shed, one merged mesh per material, distance culled, released with the view; nothing drawn without them. Plus the rail spur's sleepers
// lie ACROSS the track.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {lookFixture} from './helpers/surfaceLookFixture';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {SIDE_NORMAL, surfaceLookPlan, type DepotFeaturesIn} from '../src/world/surface/archPlan';
import {DEPOT_KEYS, LOOK_DECOR, buildSurfaceLookView, depotGearMeshes, disposeSurfaceLookView, surfaceQaPoses} from '../src/world/surface/look';

installCanvasShim(false);

const fakeModels = (): ((key: string) => GLTF | undefined) => () => undefined;
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

/** The real district with `features` on its depot (a fresh layout object: the look plan is memoized per layout). */
function withFeatures(features: DepotFeaturesIn | null): StationLayout {
  const {layout} = lookFixture();
  const S = layout.surface!;
  return {...layout, surface: {...S, depot: {building: S.depot.building, recoverables: S.depot.recoverables, ...(features ? {features} : {})}}} as StationLayout;
}

/** Features like ROOMS' planDepot: a track from the widest doorway to the back wall, a pit between its rails, a crane over the shed. */
function shedFeatures(): {F: DepotFeaturesIn; fp: {x0: number; z0: number; x1: number; z1: number}; floor: number} {
  const {layout} = lookFixture();
  const S = layout.surface!, g = layout.grid;
  const b = S.buildings.find(q => q.id === S.depot.building)!;
  const e = [...b.entrances].sort((p, q) => q.width - p.width)[0];
  const fp = b.footprint, {alongX, n} = SIDE_NORMAL[e.side];
  const plane = alongX ? (n > 0 ? fp.z1 : fp.z0) : (n > 0 ? fp.x1 : fp.x0), back = alongX ? (n > 0 ? fp.z0 : fp.z1) : (n > 0 ? fp.x0 : fp.x1);
  const c = alongX ? e.x : e.z;
  const P = (s: number) => (alongX ? {x: c, z: s} : {x: s, z: c});
  const a = P(plane - n * 0.4), z = P(back + n * 0.4);
  const mid = P((plane + back) / 2), floor = g.floor[Math.floor(mid.z / CELL) * g.w + Math.floor(mid.x / CELL)];
  const lo = Math.min(plane, back) + 4, hi = Math.max(plane, back) - 4;
  const pit = alongX ? {x0: c - 0.375, z0: lo, x1: c + 0.375, z1: hi, depth: 1.4} : {x0: lo, z0: c - 0.375, x1: hi, z1: c + 0.375, depth: 1.4};
  const crane = {x0: fp.x0 + 0.6, z0: fp.z0 + 0.6, x1: fp.x1 - 0.6, z1: fp.z1 - 0.6, span: 0, y: floor + 5.4, at: 0.45, hookY: floor + 2.6, axis: (alongX ? 'z' : 'x') as 'x' | 'z'};
  return {F: {tracks: [{x0: a.x, z0: a.z, x1: z.x, z1: z.z, gauge: 1.435}], pits: [pit], crane}, fp, floor};
}

const bboxOf = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };

describe('Surface Run look: the depot shed gear (lane ROOMS features)', () => {
  it('nothing without features; the gear validated, its floors from the grid', () => {
    const plain = surfaceLookPlan(withFeatures(null))!;
    expect(plain.depot).toBeNull();
    expect(plain.stats.depotTracks).toBe(0);
    const {F, floor} = shedFeatures();
    const p = surfaceLookPlan(withFeatures(F))!;
    expect(p.depot, 'drawn when published').not.toBeNull();
    expect(p.depot!.tracks).toHaveLength(1);
    expect(p.depot!.pits).toHaveLength(1);
    expect(p.depot!.crane).not.toBeNull();
    expect(p.depot!.tracks[0].y).toBeCloseTo(floor, 5);
    expect(p.depot!.crane!.floor).toBeCloseTo(floor, 5);
    expect(p.stats).toMatchObject({depotTracks: 1, depotPits: 1, depotCrane: 1});
    // malformed pieces are dropped (a NaN track, an empty pit, a crane 2 m over the floor); nothing valid left = nothing drawn
    const bad = surfaceLookPlan(withFeatures({tracks: [{...F.tracks![0], x1: NaN}], pits: [{...F.pits![0], x1: F.pits![0].x0}], crane: {...F.crane!, y: floor + 2}}))!;
    expect(bad.depot).toBeNull();
    // a hook planned too low is lifted above reach; below the runway it stays
    const low = surfaceLookPlan(withFeatures({crane: {...F.crane!, hookY: floor + 0.5}}))!;
    expect(low.depot!.crane!.hookY).toBeCloseTo(floor + 2.2, 5);
  });

  it('flush rails / grate on the shed floor, the crane above reach and under the roof, all inside the shed', () => {
    const {F, fp, floor} = shedFeatures();
    const G = surfaceLookPlan(withFeatures(F))!.depot!;
    const m = depotGearMeshes(G);
    for (const k of Object.values(DEPOT_KEYS)) expect(m.has(k), k).toBe(true);
    const geo = new Map([...m].map(([k, q]) => [k, q.geometry()!]));
    for (const [k, g] of geo) {
      const b = bboxOf(g);
      expect(b.min.x, k).toBeGreaterThan(fp.x0 - 0.06);
      expect(b.max.x, k).toBeLessThan(fp.x1 + 0.06);
      expect(b.min.z, k).toBeGreaterThan(fp.z0 - 0.06);
      expect(b.max.z, k).toBeLessThan(fp.z1 + 0.06);
    }
    // flush: no tripping lip (rails a hair proud, the grating a hair over its pit)
    for (const k of [DEPOT_KEYS.rail, DEPOT_KEYS.groove, DEPOT_KEYS.pit, DEPOT_KEYS.grate]) {
      const b = bboxOf(geo.get(k)!);
      expect(b.max.y - floor, k).toBeLessThanOrEqual(0.0125);
      expect(b.min.y - floor, k).toBeGreaterThanOrEqual(-0.0101);
    }
    // overhead: the hook's bottom is the lowest point (above a standing player), the bridge top under the roof line
    const c = G.crane!;
    for (const k of [DEPOT_KEYS.steel, DEPOT_KEYS.yellow, DEPOT_KEYS.black]) {
      const b = bboxOf(geo.get(k)!);
      expect(b.min.y, k).toBeGreaterThanOrEqual(c.hookY - 1e-6);
      expect(b.max.y, k).toBeLessThanOrEqual(c.y + 0.72 + 1e-6);
    }
    expect(c.hookY - floor).toBeGreaterThanOrEqual(2.2);
    // the rails on the gauge: the two rail bodies' centre lines 1.435 m apart across the track
    const t = G.tracks[0], alongX = Math.abs(t.z1 - t.z0) < 1e-6;
    const pos = geo.get(DEPOT_KEYS.rail)!.attributes.position;
    const across = new Set<number>();
    for (let i = 0; i < pos.count; i++) across.add(Math.round((alongX ? pos.getZ(i) : pos.getX(i)) * 1000) / 1000);
    const xs = [...across].sort((p, q) => p - q), c0 = alongX ? t.z0 : t.x0;
    expect(xs).toHaveLength(4);
    expect((xs[0] + xs[1]) / 2 - c0).toBeCloseTo(-t.gauge / 2, 3);
    expect((xs[2] + xs[3]) / 2 - c0).toBeCloseTo(t.gauge / 2, 3);
  });

  it('in the runtime view: one mesh per material, distance culled, a QA pose, released with the view', () => {
    const {F} = shedFeatures();
    const L = withFeatures(F);
    const v = buildSurfaceLookView(L, mats(), fakeModels())!;
    const gear = v.root.children.filter(o => o.name.startsWith('surface-depot-')) as THREE.Mesh[];
    expect(gear).toHaveLength(Object.keys(DEPOT_KEYS).length);
    expect(v.stats.depotMeshes).toBe(gear.length);
    expect(v.stats.depotTris).toBeGreaterThan(100);
    for (const m of gear) {
      expect(v.geometries, m.name).toContain(m.geometry);
      expect(v.culled.find(c => c.obj === m)?.near, m.name).toBe(LOOK_DECOR.depotNear);
    }
    const pose = surfaceQaPoses(L).find(p => p.name === 'depot');
    expect(pose, 'the depot QA pose').toBeTruthy();
    const fp = L.surface!.buildings.find(b => b.id === L.surface!.depot.building)!.footprint;
    expect(pose!.x > fp.x0 && pose!.x < fp.x1 && pose!.z > fp.z0 && pose!.z < fp.z1, 'the pose stands in the shed').toBe(true);
    let disposed = 0;
    for (const m of gear) m.geometry.addEventListener('dispose', () => { disposed++; });
    disposeSurfaceLookView(v);
    expect(disposed).toBe(gear.length);
    expect(v.root.parent).toBeNull();
    // the real district as GEN gives it (no features yet on this branch, or ROOMS' when merged): gear drawn exactly when published
    const v0 = buildSurfaceLookView(lookFixture().layout, mats(), fakeModels())!;
    const has = !!(lookFixture().layout.surface!.depot as {features?: unknown}).features;
    expect(v0.root.children.some(o => o.name.startsWith('surface-depot-'))).toBe(has);
    expect(surfaceQaPoses(lookFixture().layout).some(p => p.name === 'depot')).toBe(has);
    disposeSurfaceLookView(v0);
  });

  it('the rail spur: every sleeper lies across the track', () => {
    const {layout} = lookFixture();
    const plan = surfaceLookPlan(layout)!;
    expect(plan.rail, 'a spur in this district').not.toBeNull();
    const v = buildSurfaceLookView(layout, mats(), fakeModels())!;
    const sl = v.root.children.filter(o => o.name.startsWith('surface-decor-surface-sleeper@')) as THREE.Mesh[];
    expect(sl.length).toBeGreaterThan(0);
    const R = plan.rail!, a = R.points[0], b = R.points[1], len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    let checked = 0;
    for (const mesh of sl) for (let q = 0, pos = mesh.geometry.attributes.position; q + 3 < pos.count; q += 4) {
      // only sleepers of the first straight run
      const cx = (pos.getX(q) + pos.getX(q + 2)) / 2, cz = (pos.getZ(q) + pos.getZ(q + 2)) / 2;
      const along = (cx - a.x) * ux + (cz - a.z) * uz, off = -(cx - a.x) * uz + (cz - a.z) * ux;
      if (along < 0 || along > len || Math.abs(off) > 0.05) continue;
      let amin = Infinity, amax = -Infinity, cmin = Infinity, cmax = -Infinity;
      for (let k = 0; k < 4; k++) {
        const x = pos.getX(q + k) - a.x, z = pos.getZ(q + k) - a.z;
        const s = x * ux + z * uz, t = -x * uz + z * ux;
        amin = Math.min(amin, s); amax = Math.max(amax, s); cmin = Math.min(cmin, t); cmax = Math.max(cmax, t);
      }
      expect(cmax - cmin, 'across the track').toBeCloseTo(2.6, 2);
      expect(amax - amin, 'along the track').toBeCloseTo(0.26, 2);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
    disposeSurfaceLookView(v);
  });
});
