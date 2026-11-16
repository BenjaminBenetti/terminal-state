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
    const out = {x: (s.extent.x0 + e.x0) / 2 - 0.5, z: (s.extent.z0 + s.extent.z1) / 2, yaw: 0};
    const m = buildPlanningMap(s, {explore: exploreGridFor(s.extent), entered: new Set(), truck: out, player: {x: e.x0 - 40, z: out.z, yaw: 0}});
    expect(m.markers.some(k => k.kind === 'truck'), 'truck in the outer fog').toBe(true);
    expect(m.markers.some(k => k.kind === 'player'), 'beyond the edge').toBe(false);
  }, 120_000);

  it('v1: the extent rule is unchanged', () => {
    const s = LEVELS.subway.generate('surface', {levelSeed: firstPresent(), surfaceVersion: 1}).surface as SurfaceInfo;
    expect(s.boundary).toBeUndefined();
    expect(markerBounds(s)).toEqual(s.extent);
  }, 120_000);
});
