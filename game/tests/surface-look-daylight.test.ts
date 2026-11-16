// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): the district's baked daylight (world/surface/lookDaylight.ts),
// read back from the real station light field bake: open streets bright under the overcast, a facade's foot darker than the street,
// interiors dim (lit only through their openings, falling off with depth), the tent between, never a green cast, the term paced in
// steps, and the light field's downsampled form (the byte budget's k = 2 on a ~1000-cell grid) close to the full-resolution one.

import {describe, expect, it} from 'vitest';
import {drainSync} from '../src/core/pacedBuild';
import {bakeLightFieldSteps, downsampleField, sampleField, type BakedField, type FieldSource} from '../src/world/lightField';
import {StationLighting, stationFieldSource} from '../src/world/lights';
import {surfaceLookPlan} from '../src/world/surface/archPlan';
import {DAYLIGHT, daylightStats, surfaceSkyField} from '../src/world/surface/lookDaylight';
import {lookFixture} from './helpers/surfaceLookFixture';

type V3 = [number, number, number];
const UP: V3 = [0, 1, 0];

let baked: {f: BakedField; steps: number} | null = null;
/** The fixture district's field (baked once; the daylight term's own yields counted). */
function field(): {f: BakedField; steps: number} {
  if (baked) return baked;
  const d = lookFixture().layout;
  const src: FieldSource = stationFieldSource(d);
  const inner = src.extraDirectSteps!;
  let steps = 0;
  src.extraDirectSteps = function* (ctx) {
    const g = inner(ctx);
    for (let r = g.next(); ; r = g.next()) { if (r.done) return r.value; steps++; yield r.value; }
  };
  baked = {f: drainSync(bakeLightFieldSteps(src, StationLighting.fieldParams({}))), steps};
  return baked;
}

/** Luminance a surface of normal n receives at a point (the field's ambient + its directional part toward n). */
function lum(f: BakedField, x: number, y: number, z: number, n: V3 = UP): number {
  const s = sampleField(f, x, y, z, [1, 1, 1], n);
  const l = (c: ArrayLike<number>) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return l(s.amb) + l(s.dirColor) * Math.max(0, s.dir[0] * n[0] + s.dir[1] * n[1] + s.dir[2] * n[2]);
}

describe('Surface Run look: the baked daylight', () => {
  it('streets are lit by the overcast, facades less at their foot, interiors dim and falling off with depth, the tent between', () => {
    const {layout: d, spans} = lookFixture();
    const {f} = field();
    const S = d.surface!, plan = surfaceLookPlan(d)!;
    const st = daylightStats()!;
    expect(st.receivers).toBeGreaterThan(100_000);
    expect(st.openings).toBeGreaterThan(S.windows.length);
    // an open street (the middle of the first segment) at the eye, and higher up
    const g = plan.segments[0];
    const sx = g.axis === 'x' ? (g.s0 + g.s1) / 2 : g.c, sz = g.axis === 'x' ? g.c : (g.s0 + g.s1) / 2;
    const street = lum(f, sx, 1.5, sz);
    expect(street).toBeGreaterThan(1);
    expect(lum(f, sx, 10, sz)).toBeGreaterThanOrEqual(street - 1e-3);
    // a facade (facing the street) is lit less than the open street's ground
    const b = S.buildings.find(q => q.enterable && q.windows.some(w => spans.includes(w)))!, fp = b.footprint, e = b.entrances[0];
    const facade = lum(f, e.x - 6, 1.5, fp.z1 + 0.01, [0, 0, 1]);
    expect(facade).toBeGreaterThan(0.2);
    expect(facade).toBeLessThan(street);
    // inside: near the window span and the doorway lit, the back of the room dark (dim interiors; the flashlight's)
    const sp = S.windows.find(q => q.building === b.id && spans.includes(q.id))!;
    const byWindow = lum(f, (sp.x0 + sp.x1) / 2, 1.2, fp.z1 - 1.5), byDoor = lum(f, e.x, 1.2, fp.z1 - 1.5);
    const deep = lum(f, (fp.x0 + fp.x1) / 2, 1.2, fp.z0 + 2);
    expect(byWindow).toBeGreaterThan(deep + 0.05);
    expect(byDoor).toBeGreaterThan(deep);
    expect(byWindow).toBeLessThan(street / 4);
    // the command tent: diffuse daylight through its canvas — dimmer than the street, brighter than a deep interior
    const T = plan.tent!;
    const tent = lum(f, (T.rect.x0 + T.rect.x1) / 2, 0.5, (T.rect.z0 + T.rect.z1) / 2);
    expect(tent).toBeGreaterThan(deep + 0.1);
    expect(tent).toBeLessThan(street / 2);
  });

  it('the daylight is never green (the toxic gas is the only green: lane AIR)', () => {
    const [r, gg, b] = DAYLIGHT.tint;
    expect(gg).toBeLessThanOrEqual(r);
    expect(b).toBeLessThan(gg);
    const {f} = field();
    const plan = surfaceLookPlan(lookFixture().layout)!;
    for (const g of plan.segments.slice(0, 12)) {
      const x = g.axis === 'x' ? (g.s0 + g.s1) / 2 : g.c, z = g.axis === 'x' ? g.c : (g.s0 + g.s1) / 2;
      const s = sampleField(f, x, 1.5, z, [1, 1, 1], UP);
      expect(s.amb[1]).toBeLessThanOrEqual(s.amb[0] * 1.001 + 1e-4);
    }
  });

  it('the term is paced (it yields between its rows) and the downsampled field (k = 2) stays close to the full one', () => {
    const {f, steps} = field();
    expect(steps).toBeGreaterThan(10);
    expect(typeof surfaceSkyField(lookFixture().layout).extraDirectSteps).toBe('function');
    const f2 = downsampleField(f, 2);
    const plan = surfaceLookPlan(lookFixture().layout)!;
    let worst = 0, n = 0;
    for (const g of plan.segments) {
      const x = g.axis === 'x' ? (g.s0 + g.s1) / 2 : g.c, z = g.axis === 'x' ? g.c : (g.s0 + g.s1) / 2;
      // the street's middle and its edge by the kerb (half a sidewalk in from the facade line)
      for (const off of [0, g.w / 2 + 1]) {
        const px = g.axis === 'x' ? x : x + off, pz = g.axis === 'x' ? z + off : z;
        const a = lum(f, px, 1.5, pz), b = lum(f2, px, 1.5, pz);
        if (a > 0.3) { worst = Math.max(worst, Math.abs(a - b) / a); n++; }
      }
    }
    expect(n).toBeGreaterThan(40);
    expect(worst).toBeLessThan(0.2);
  });
});
