// Task studio-surface-run-field-followup-20261116-211729-01 (primary): the planning map keeps the LIVE truck / player markers on the sheet
// out to a v2 district's fog-pressure edge (a truck broken down in the outer fog stays on the map); a v1 district keeps its extent rule.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {surfacePresent} from '../src/gen/surface/surfaceRun';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {buildPlanningMap, markerBounds} from '../src/world/surface/mapModel';
import {exploreGridFor} from '../src/world/surface/mapExplore';

const firstPresent = (): number => { let s = 1; while (!surfacePresent('subway', s, 2)) s++; return s; };

describe('Surface Run planning map: live markers in the outer fog', () => {
  it('v2: a truck / player between the extent and the fog edge is still marked; beyond the edge is not', () => {
    const s = LEVELS.subway.generate('surface', {levelSeed: firstPresent(), surfaceVersion: 2}).surface as SurfaceInfo;
    expect(s.boundary).toBeTruthy();
    const B = markerBounds(s), e = s.boundary!.edge;
    expect(B.x0).toBeLessThanOrEqual(Math.min(e.x0, s.extent.x0));
    // the side where the walkable edge reaches furthest beyond the drawn extent (the padding is only where the edge needs room)
    const E = s.extent, cz = (E.z0 + E.z1) / 2, cx = (E.x0 + E.x1) / 2;
    const sides = [
      {gap: E.x0 - e.x0, at: (d: number) => ({x: E.x0 - d, z: cz}), pinned: {x: E.x0, z: cz}},
      {gap: e.x1 - E.x1, at: (d: number) => ({x: E.x1 + d, z: cz}), pinned: {x: E.x1, z: cz}},
      {gap: E.z0 - e.z0, at: (d: number) => ({x: cx, z: E.z0 - d}), pinned: {x: cx, z: E.z0}},
      {gap: e.z1 - E.z1, at: (d: number) => ({x: cx, z: E.z1 + d}), pinned: {x: cx, z: E.z1}},
    ].sort((a, b) => b.gap - a.gap);
    const side = sides[0];
    expect(side.gap, 'the fog edge lies beyond the drawn extent somewhere').toBeGreaterThan(2);
    const out = {...side.at(side.gap / 2), yaw: 0}, far = side.at(side.gap + 40);
    const m = buildPlanningMap(s, {explore: exploreGridFor(s.extent), entered: new Set(), truck: out, player: {...far, yaw: 0}});
    const t = m.markers.find(k => k.kind === 'truck');
    expect(t, 'truck in the outer fog').toBeTruthy();
    // pinned to the drawn sheet's edge, labelled
    expect({x: t!.x, z: t!.z}).toEqual(side.pinned);
    expect(t!.label).toBe('Truck (in the fog)');
    expect(m.markers.some(k => k.kind === 'player'), 'beyond the edge').toBe(false);
  }, 120_000);

  it('v1: the extent rule is unchanged', () => {
    const s = LEVELS.subway.generate('surface', {levelSeed: firstPresent(), surfaceVersion: 1}).surface as SurfaceInfo;
    expect(s.boundary).toBeUndefined();
    expect(markerBounds(s)).toEqual(s.extent);
  }, 120_000);
});
