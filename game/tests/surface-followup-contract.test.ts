// Task studio-surface-run-field-followup-20261116-211729-01 (primary, contract): the follow-up's version gate (gen/surface/surfaceRun.ts
// SURFACE_VERSION 2, surfaceFeatures, districtVersionOf), the district's version from its host, and the fog-pressure field's contract
// (world/surface/fogPressure.ts).
import {describe, expect, it} from 'vitest';
import {SURFACE_VERSION, districtVersionOf, surfaceFeatures, surfacePresent} from '../src/gen/surface/surfaceRun';
import {FOG_PRESSURE, fogPressureAt, outsideRect} from '../src/world/surface/fogPressure';
import {LEVELS} from '../src/levels/registry';

describe('Surface Run follow-up: the version gate', () => {
  it('version 2 is current; every structural change is a v2 feature, none at v1 / v0', () => {
    expect(SURFACE_VERSION).toBe(2);
    for (const v of [undefined, 0, 1]) expect(Object.values(surfaceFeatures(v)).some(Boolean), `v${v}`).toBe(false);
    expect(Object.values(surfaceFeatures(2)).every(Boolean)).toBe(true);
  });

  it('a district follows its host record: absent = 1, clamped to [1, current]', () => {
    expect(districtVersionOf(undefined)).toBe(1);
    expect(districtVersionOf(0)).toBe(1);
    expect(districtVersionOf(1)).toBe(1);
    expect(districtVersionOf(2)).toBe(2);
    expect(districtVersionOf(99)).toBe(SURFACE_VERSION);
    expect(districtVersionOf(1.5)).toBe(1);
  });

  it('the district record carries its version (the registry passes ctx.surfaceVersion through)', () => {
    let s = 1;
    while (!surfacePresent('subway', s, 2)) s++;
    expect(LEVELS.subway.generate('surface', {levelSeed: s}).surface!.v).toBe(1);
    expect(LEVELS.subway.generate('surface', {levelSeed: s, surfaceVersion: 1}).surface!.v).toBe(1);
    expect(LEVELS.subway.generate('surface', {levelSeed: s, surfaceVersion: 2}).surface!.v).toBe(2);
  }, 120_000);
});

describe('Surface Run follow-up: the fog-pressure field', () => {
  const b = {clear: {x0: 100, z0: 100, x1: 300, z1: 300}, ramp: 40, edge: {x0: 20, z0: 20, x1: 380, z1: 380}};

  it('0 inside the clear rect, 1 at ramp metres out, rising beyond; 0 without a boundary (v1)', () => {
    expect(fogPressureAt(b, 200, 200)).toBe(0);
    expect(fogPressureAt(b, 100, 300)).toBe(0);
    expect(fogPressureAt(b, 80, 200)).toBeCloseTo(0.5);
    expect(fogPressureAt(b, 200, 340)).toBeCloseTo(1);
    expect(fogPressureAt(b, 30, 30)).toBeGreaterThan(1);
    expect(fogPressureAt(undefined, 30, 30)).toBe(0);
    expect(fogPressureAt({...b, ramp: 0}, 30, 30)).toBe(0);
    expect(outsideRect(b.clear, 60, 250)).toBe(40);
    expect(FOG_PRESSURE.warn).toBeLessThan(FOG_PRESSURE.foot);
    expect(FOG_PRESSURE.foot).toBeLessThan(FOG_PRESSURE.full);
  });
});
