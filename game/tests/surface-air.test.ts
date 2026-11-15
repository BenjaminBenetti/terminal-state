import {describe, expect, it} from 'vitest';
import {GasSystem, type GasHost} from '../src/world/gas/system';
import {GAS} from '../src/world/gas/field';
import type {StationLayout} from '../src/gen/stationTypes';

describe('Surface Run uses the existing exposure pipeline', () => {
  it('enclosed cab protects without equipment; outside requires working mask/filter or airtank protection', () => {
    let hits = 0, driving = false, maskProtects = false;
    const host = {layout: {surface: {version: 1}} as StationLayout,
      player: {x: 40, y: 0, eye: 1.7, z: 50, alive: true, takeDamage: (v: number) => { hits += v; }},
      atmosphere: {active: true, setGasLayer: () => {}}, clock: 0, state: 'playing'} as unknown as GasHost;
    const gas = new GasSystem(host);
    gas.outdoorConcentration = () => host.layout.surface ? GAS.ROOF_OUTDOOR_C : 0;
    gas.protection = () => (!!host.layout.surface && driving) || maskProtects;
    gas.frame(1);
    expect(gas.exposure.source).toBe('outdoor'); expect(hits).toBeGreaterThan(4);
    driving = true; const damaged = hits; gas.frame(1);
    expect(hits).toBe(damaged); expect(gas.exposure.protected).toBe(true); expect(gas.exposure.dps).toBe(0);
    driving = false; maskProtects = true; gas.frame(1);
    expect(hits).toBe(damaged);
    maskProtects = false; gas.frame(1); expect(hits).toBeGreaterThan(damaged);
    // No second damage source or invented oxygen/fuel state; cab does not remove visible toxic air.
    expect(gas.exposure.c).toBe(GAS.ROOF_OUTDOOR_C);
    host.layout = {} as StationLayout; const before = hits; gas.frame(1); expect(hits).toBe(before);
  });
});
