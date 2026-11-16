// Task studio-surface-run-field-followup-20261116-211729-01 (primary, integration): the dash plate is a live instrument — its bar shows
// the fog pressure at the truck (world/surface/truckPressureDash.ts dashLevel / setDashPressure), dark at no pressure, full from 1.
import {describe, expect, it} from 'vitest';
import {DASH_SEGMENTS, buildTruckDash, dashLevel, setDashPressure} from '../src/world/surface/truckPressureDash';

describe('Surface Run truck dash: the live FOG PRESSURE readout', () => {
  it('lit segments follow the pressure (0 dark, any pressure lights one, 1 and beyond all)', () => {
    expect(dashLevel(0)).toBe(0);
    expect(dashLevel(-1)).toBe(0);
    expect(dashLevel(0.01)).toBe(1);
    expect(dashLevel(0.5)).toBe(DASH_SEGMENTS / 2);
    expect(dashLevel(1)).toBe(DASH_SEGMENTS);
    expect(dashLevel(3)).toBe(DASH_SEGMENTS);
    for (let p = 0; p < 1.2; p += 0.05) expect(dashLevel(p + 0.05)).toBeGreaterThanOrEqual(dashLevel(p));
  });

  it('a view starts empty and its bar follows setDashPressure', () => {
    const d = buildTruckDash();
    expect(d.level).toBe(0);
    setDashPressure(d, 0.3);
    expect(d.level).toBe(dashLevel(0.3));
    setDashPressure(d, 0);
    expect(d.level).toBe(0);
    expect(buildTruckDash().level).toBe(0);
  });
});
