// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): the district's baked daylight (world/surface/lookDaylight.ts),
// read back from the real station light field bake: open streets bright under the overcast, a facade's foot darker than the street,
// interiors dim (lit only through their openings, falling off with depth), the tent between, never a green cast, the term paced in
// steps, and the light field's downsampled form (the byte budget's k = 2 on a ~1000-cell grid) close to the full-resolution one.

import {describe, expect, it} from 'vitest';
import {drainSync} from '../src/core/pacedBuild';
import {bakeLightFieldSteps, downsampleField, sampleField, type BakedField, type FieldSource} from '../src/world/lightField';
import {StationLighting, stationFieldSource} from '../src/world/lights';
import {SIDE_NORMAL, surfaceLookPlan} from '../src/world/surface/archPlan';
import {CELL, FLOOR} from '../src/gen/grid';
import {DAYLIGHT, daylightStats, surfaceSkyField} from '../src/world/surface/lookDaylight';
import {lookFixture} from './helpers/surfaceLookFixture';

type V3 = [number, number, number];
const UP: V3 = [0, 1, 0];

let baked: {f: BakedField; steps: number} | null = null;
/** The fixture district's field (baked once; the daylight term's own yields counted). */
function field(): {f: BakedField; steps: number} {
  if (baked) return baked;
  const d = lookFixture().layout;
  // the daylight term alone: the district's own fixtures (ROOMS' interior lamps) are left out, so dim / bright reads the sky
  const src: FieldSource = {...stationFieldSource(d), lights: []};
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
    // a building with an entrance and its own street-storey interior cells (and, when ROOMS published them, a window span)
    const g0 = d.levels[0].grid;
    const cellsOf = (b: (typeof S.buildings)[number]) => {
      const out: number[] = [];
      const fp = b.footprint, areas = new Set(b.areas);
      for (let z = Math.floor(fp.z0 / CELL); z < Math.ceil(fp.z1 / CELL); z++) for (let x = Math.floor(fp.x0 / CELL); x < Math.ceil(fp.x1 / CELL); x++) {
        const i = z * g0.w + x;
        if (g0.cells[i] === FLOOR && areas.has(g0.area[i])) out.push(i);
      }
      return out;
    };
    const cand = S.buildings.filter(q => q.enterable && !q.host && q.entrances.some(e => e.level === 0 && e.door !== 'boarded'))
      .map(q => ({b: q, cells: cellsOf(q)})).filter(q => q.cells.length > 200)
      .sort((p, q) => Number(spans.some(w => p.b.windows.includes(w))) - Number(spans.some(w => q.b.windows.includes(w))) || q.cells.length - p.cells.length)
      .reverse();
    const {b, cells} = cand[0];
    const e = b.entrances.find(q => q.level === 0 && q.door !== 'boarded')!;
    const at = (i: number) => ({x: (i % g0.w + 0.5) * CELL, z: (Math.floor(i / g0.w) + 0.5) * CELL, y: g0.floor[i] + 1.2});
    const nearest = (px: number, pz: number, d0: number) => cells.reduce((best, i) => { const p = at(i), q = at(best); return Math.abs(Math.hypot(p.x - px, p.z - pz) - d0) < Math.abs(Math.hypot(q.x - px, q.z - pz) - d0) ? i : best; }, cells[0]);
    // a facade beside the entrance (facing out) is lit less than the open street's ground
    const {alongX, n} = SIDE_NORMAL[e.side], fp = b.footprint;
    const plane = alongX ? (n > 0 ? fp.z1 : fp.z0) : (n > 0 ? fp.x1 : fp.x0);
    const fn: V3 = alongX ? [0, 0, n] : [n, 0, 0];
    const fx = alongX ? e.x - 3 : plane + n * 0.01, fz = alongX ? plane + n * 0.01 : e.z - 3;
    const facade = lum(f, fx, 1.65, fz, fn);
    expect(facade).toBeGreaterThan(0.2);
    expect(facade).toBeLessThan(street);
    // inside: by the doorway lit, the cell farthest from every opening dark (dim interiors: the flashlight's)
    const opens: {x: number; z: number}[] = [{x: e.x, z: e.z}];
    const sp = S.windows.find(q => q.building === b.id && q.level === 0 && spans.includes(q.id));
    if (sp) opens.push({x: (sp.x0 + sp.x1) / 2, z: (sp.z0 + sp.z1) / 2});
    for (const q of b.entrances) opens.push({x: q.x, z: q.z});
    for (const q of S.windows) if (q.building === b.id && q.level === 0) opens.push({x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2});
    const deepI = cells.reduce((best, i) => { const p = at(i), q = at(best); const dp = Math.min(...opens.map(o => Math.hypot(p.x - o.x, p.z - o.z))), dq = Math.min(...opens.map(o => Math.hypot(q.x - o.x, q.z - o.z))); return dp > dq ? i : best; }, cells[0]);
    const dI = nearest(e.x, e.z, 1.5);
    const deep = lum(f, at(deepI).x, at(deepI).y, at(deepI).z), byDoor = lum(f, at(dI).x, at(dI).y, at(dI).z);
    expect(byDoor).toBeGreaterThan(deep + 0.02);
    expect(byDoor).toBeLessThan(street / 2);
    if (sp) {
      const wI = nearest((sp.x0 + sp.x1) / 2, (sp.z0 + sp.z1) / 2, 1.5);
      const byWindow = lum(f, at(wI).x, at(wI).y, at(wI).z);
      expect(byWindow).toBeGreaterThan(deep);
      expect(byWindow).toBeLessThan(street / 2);
    }
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
