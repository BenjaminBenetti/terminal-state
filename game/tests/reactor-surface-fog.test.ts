// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (primary): THE FOG PILLARS (user screenshot: "strange fog
// pillars" on the Reactor's surface). The march's height profile never drops under 0.25 and the light field lights whole columns, so
// over the surface deck the picked band's haze rose into the sky as lit pillars. A Reactor with a surface exit now caps the HAZE term
// a few metres over its deck (render/atmosphere.ts AtmosphereParams.skyCap: the march's reactor programs and the CPU mirror mediumAt);
// the toxic gas / smoke / depth strata are separate terms and untouched; every other level has no cap.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {REACTOR_SKY_CAP, atmosphereFor, buildDensityMap, densityAt} from '../src/render/atmosphere';
import type {StationLayout} from '../src/gen/stationTypes';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);

describe('reactor surface: the outdoor haze stops a few metres over the deck (no pillars into the sky)', () => {
  const L = LEVELS.reactor.generate('main', {levelSeed: 9100}) as StationLayout;
  const s = L.reactor!.surface!;
  const params = atmosphereFor(L);
  const map = buildDensityMap(L, params);
  const sig = (x: number, y: number, z: number) => densityAt([x, y, z], map, null, params, 0);

  it('the cap comes from the layout\'s surface deck; layouts without one (Subway, a Reactor-less atmosphere) have none', () => {
    expect(params.skyCap).toEqual({y0: s.y + REACTOR_SKY_CAP.from, y1: s.y + REACTOR_SKY_CAP.to});
    expect(atmosphereFor(LEVELS.subway.generate('main', {levelSeed: 3}) as StationLayout).skyCap).toBeUndefined();
    expect(atmosphereFor(null).skyCap).toBeUndefined();
  });

  it('over the aperture and over the plaza: haze at walking height, none above the cap (was >= 25 % of the base all the way up)', () => {
    const uncapped = {...params, skyCap: undefined};
    for (const [x, z] of [[s.hole.x, s.hole.z], [s.hole.x + s.hole.r + 4, s.hole.z], [s.exit.x, s.exit.z]]) {
      expect(sig(x, s.y + 1.2, z), `walking height at ${x},${z}`).toBeGreaterThan(0);
      for (const dy of [REACTOR_SKY_CAP.to + 0.01, 8, 20, 40]) {
        expect(sig(x, s.y + dy, z), `${dy} m over the deck at ${x},${z}`).toBe(0);
        expect(densityAt([x, s.y + dy, z], map, null, uncapped, 0), `(before the fix: a column at ${dy} m)`).toBeGreaterThan(0);
      }
    }
  });

  it('inside the pit (everything under the roof) the haze is exactly as before', () => {
    const uncapped = {...params, skyCap: undefined};
    const b = L.reactor!.pit.bounds;
    for (const y of [L.reactor!.pit.roofY - 1, 0, -10]) {
      for (const [x, z] of [[(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], [b.x0 + 3, b.z0 + 3]]) {
        expect(sig(x, y, z)).toBe(densityAt([x, y, z], map, null, uncapped, 0));
      }
    }
  });
});
