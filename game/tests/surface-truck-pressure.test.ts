// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE TRUCK IN THE FOG PRESSURE (world/surface/truckPressure.ts,
// truckPressureDash.ts, truckConditionRuntime.ts) over lane FOG's field (world/surface/fogPressure.ts fogPressureAt) with a SYNTHETIC
// SurfaceBoundary on the REAL vehicle controller (user: "On the truck dash show a red blinking light and 'Fog Pressure'; escalating
// mechanical groans and truck damage get stronger deeper out. The truck must lose mobility and break down before reaching the geometry
// edge, even approaching at speed."):
//  - a version-1 district has no boundary: no pressure, no lamp, no groans, no wear;
//  - the dash: a red lamp + a FOG PRESSURE label on the dash top in the driver's view (under the sight line to the windscreen's base,
//    clear of the steering wheel's rim); it blinks from the warning line, faster deeper; groans while seated, more often and stronger
//    deeper; never for a parked, empty truck;
//  - damage grows outward and the truck is broken down AT THE LATEST on the frame it reaches pressure 1 going out (a long ramp, a short
//    one at top speed, a truck repaired inside the ramp) and comes to rest within TRUCK_PRESSURE_STOP_M of that line (measured here);
//    coming back in costs no strain, so a truck repaired past the line can still be reversed back in.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {FOG_PRESSURE, fogPressureAt} from '../src/world/surface/fogPressure';
import {TRUCK_PHYS, TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {truckCabLayout} from '../src/world/surface/truckCab';
import type {TruckView} from '../src/world/surface/truckModel';
import {DASH_LAMP, truckDashLayout} from '../src/world/surface/truckPressureDash';
import {TRUCK_PRESSURE, TRUCK_PRESSURE_STOP_M, TRUCK_PRESSURE_TEXT, dashBlinkHz, pressureStrain, truckPressureLoss, truckStopBound} from '../src/world/surface/truckPressure';
import {truckStateOf} from '../src/world/surface/truckCondition';
import type {SurfaceBoundary} from '../src/gen/surface/surfaceTypes';
import {run} from './helpers/skywaysCarHost';
import {getInTruck} from './helpers/surfaceTruckHost';
import {eastBoundary, fieldHost, flatLevels} from './helpers/surfaceTruckFieldHost';

const ROAD = flatLevels(330, 30);
const START = {x: 20, z: 15}; // (yaw -PI/2: facing +X, down the long road)

/** The x where the field first reaches `p` along z = 15 (bisection on the real field: any shape lane FOG gives it). */
function lineX(b: SurfaceBoundary, p: number, x0: number, x1: number): number {
  let lo = x0, hi = x1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (fogPressureAt(b, m, START.z) >= p) hi = m; else lo = m; }
  return hi;
}

/**
 * Seated, full throttle east from START into the boundary (optionally repaired — condition 1 — once the pressure first reaches
 * `repairAt`) until it is broken down and at rest: where it broke down, whether / how fast it reached pressure 1 and its condition then.
 */
function driveOut(boundary: SurfaceBoundary, o: {repairAt?: number} = {}) {
  const w = fieldHost({levels: ROAD, pose: START, boundary});
  const {h, car, sys} = w;
  getInTruck(h, car);
  h.keys.held.add('KeyW');
  let crossV: number | null = null, crossC: number | null = null, condAtHalf = NaN, repaired = false, frames = 0, maxP = 0, downV: number | null = null;
  while (frames++ < 60 * 40) {
    run(h, car, 1 / 60);
    const p = sys.condition.pressure, c = truckStateOf(car).condition;
    maxP = Math.max(maxP, p);
    if (o.repairAt !== undefined && !repaired && p >= o.repairAt) { sys.condition.setCondition(1); repaired = true; }
    if (Number.isNaN(condAtHalf) && p >= 0.5) condAtHalf = c;
    if (crossV === null && p >= FOG_PRESSURE.full) { crossV = car.body!.v; crossC = c; }
    if (downV === null && c <= 0) downV = car.body!.v;
    if (c <= 0 && Math.abs(car.body!.v) < 0.02) break;
  }
  h.keys.held.clear();
  return {...w, crossV, crossC, downV, maxP, restX: car.body!.x, condAtHalf, repaired, condition: truckStateOf(car).condition};
}

describe('truck in the fog pressure: none in a version-1 district', () => {
  it('no boundary: no pressure anywhere, the lamp dark, no groans, no wear, no note — however far it drives', () => {
    const {h, car, sys, log} = fieldHost({levels: ROAD, pose: START});
    getInTruck(h, car);
    h.keys.held.add('KeyW');
    let lit = 0;
    for (let i = 0; i < 60 * 12; i++) { run(h, car, 1 / 60); if (sys.condition.lamp) lit++; }
    h.keys.held.clear();
    expect(car.body!.x - START.x).toBeGreaterThan(80);
    expect(sys.condition.pressure).toBe(0);
    expect(lit).toBe(0);
    expect(log.groans).toHaveLength(0);
    expect(truckStateOf(car).condition).toBe(1);
    expect(h.toasts).not.toContain(TRUCK_PRESSURE_TEXT.warn);
    expect(fogPressureAt(undefined, 1e4, 1e4)).toBe(0);
  });
});

describe('truck in the fog pressure: the dash and the groans', () => {
  it('a red lamp and a FOG PRESSURE label on the dash top, in the driver\'s view: under the sight line to the windscreen base, clear of the wheel rim', () => {
    const {car} = fieldHost();
    const v = car.view as TruckView, d = v.dash!;
    expect(d.group.parent).toBe(v.cockpit); // (in the cab)
    const L = truckDashLayout(), E = TRUCK_ANCHORS.eye, lay = truckCabLayout();
    const ws = TRUCK_ANCHORS.glass.filter(g => g.name.startsWith('windscreen'));
    const base = {y: Math.min(...ws.map(g => g.y0)), z: Math.max(...ws.map(g => g.z1))};
    const sight = (z: number) => E.y + (base.y - E.y) * ((z - E.z) / (base.z - E.z)); // (the eye's line to the windscreen base)
    expect(L.housing.y1).toBeLessThan(sight(L.housing.z0));
    expect(L.label.y + L.label.h * Math.cos(L.label.tilt)).toBeLessThan(sight(L.label.z));
    expect(L.housing.y0).toBeCloseTo(lay.dashTop, 6); // (standing on the dash top)
    // the eye -> lens line passes outside the steering wheel's rim (its plane through the hub)
    const W = lay.wheel, n = new THREE.Vector3(...W.normal), e = new THREE.Vector3(E.x, E.y, E.z), l = new THREE.Vector3(L.lens.x, L.lens.y, L.lens.z);
    const dir = l.clone().sub(e), hub = new THREE.Vector3(W.x, W.y, W.z);
    const t = hub.clone().sub(e).dot(n) / dir.dot(n), p = e.clone().addScaledVector(dir, t);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
    expect(p.distanceTo(hub)).toBeGreaterThan(W.r + 0.04);
    // the label faces the eye; the lens is red and dark until lit
    const ln = new THREE.Vector3(0, 0, 1).applyEuler(d.label.rotation), toEye = e.clone().sub(d.label.position).normalize();
    expect(ln.dot(toEye)).toBeGreaterThan(0.97);
    const lens = d.lens.material as THREE.MeshStandardMaterial;
    expect(lens.emissive.r).toBeGreaterThan(lens.emissive.g * 4);
    expect(lens.emissive.r).toBeGreaterThan(lens.emissive.b * 4);
    expect([lens.emissiveIntensity, d.on]).toEqual([0, false]);
    expect(DASH_LAMP.on).toBeGreaterThan(1);
  });

  /** Seated and still at pressure p for `s` s: lamp blinks (off -> on), groans and their mean strength, the lamp's lit intensity seen. */
  function sitAt(p: number, s: number, seated = true) {
    const ramp = 40, boundary = eastBoundary(START.x - p * ramp, ramp);
    const {h, car, sys, log} = fieldHost({levels: ROAD, pose: START, boundary});
    if (seated) getInTruck(h, car);
    else h.player.place(START.x - 3, START.z + 3, 0, 0);
    let blinks = 0, was = false, lit = 0;
    for (let i = 0; i < 60 * s; i++) {
      run(h, car, 1 / 60);
      const on = sys.condition.lamp;
      if (on && !was) blinks++;
      if (on) lit = Math.max(lit, ((car.view as TruckView).dash!.lens.material as THREE.MeshStandardMaterial).emissiveIntensity);
      was = on;
    }
    const mean = log.groans.length ? log.groans.reduce((a, b) => a + b, 0) / log.groans.length : 0;
    return {blinks, groans: log.groans.length, mean, lit, pressure: sys.condition.pressure, toasts: h.toasts, condition: truckStateOf(car).condition};
  }

  it('the lamp blinks from the warning line, faster deeper (and is dark below it); lit at DASH_LAMP.on', () => {
    const below = sitAt(FOG_PRESSURE.warn * 0.5, 4), mid = sitAt(0.3, 4), deep = sitAt(0.95, 4);
    expect(below.pressure).toBeCloseTo(FOG_PRESSURE.warn * 0.5, 6);
    expect(below.blinks).toBe(0);
    expect(mid.blinks).toBeGreaterThanOrEqual(Math.floor(dashBlinkHz(0.3) * 4) - 1);
    expect(deep.blinks).toBeGreaterThan(mid.blinks + 4);
    expect(deep.lit).toBe(DASH_LAMP.on);
    expect(mid.toasts).toContain(TRUCK_PRESSURE_TEXT.warn);
  });

  it('groans while seated: more often and stronger deeper out; none for a parked, empty truck (and no wear)', () => {
    const shallow = sitAt(0.1, 30), deep = sitAt(0.9, 30), empty = sitAt(0.9, 30, false);
    expect(shallow.groans).toBeGreaterThan(2);
    expect(deep.groans).toBeGreaterThan(shallow.groans * 2);
    expect(deep.mean).toBeGreaterThan(shallow.mean + 0.3);
    expect(empty.groans).toBe(0);
    expect(empty.condition).toBe(1);
    expect(deep.condition).toBeLessThan(shallow.condition); // (seated wear: stronger deeper)
    expect(empty.blinks).toBeGreaterThan(0); // (the lamp is the truck's: it shows the pressure where it stands)
  });
});

describe('truck in the fog pressure: broken down before the edge', () => {
  it('the rules: the strain is exactly 1 from the warning line to full; any step out at or past full breaks it down; coming in costs no strain', () => {
    expect(pressureStrain(FOG_PRESSURE.warn)).toBe(0);
    expect(pressureStrain(FOG_PRESSURE.full)).toBeCloseTo(1, 12);
    expect(truckPressureLoss(0.5, 0.4, false, 1)).toBe(0);
    expect(truckPressureLoss(1.2, 1.1, false, 1)).toBe(0);
    expect(truckPressureLoss(0.999, 1, false, 0)).toBeGreaterThanOrEqual(1);
    expect(truckPressureLoss(1.5, 1.5001, false, 0)).toBeGreaterThanOrEqual(1);
    expect(truckPressureLoss(0.2, 0.2, true, 1)).toBeGreaterThan(0); // (seated wear)
    expect(truckPressureLoss(0.2, 0.2, false, 1)).toBe(0);
    expect(truckStopBound()).toBeCloseTo(TRUCK_PHYS.forwardMax * TRUCK_PHYS.maxDt + TRUCK_PHYS.forwardMax ** 2 / (2 * (TRUCK_PHYS.brake + TRUCK_PHYS.roll)), 9);
    expect(TRUCK_PRESSURE_STOP_M).toBeGreaterThanOrEqual(truckStopBound());
    expect(TRUCK_PRESSURE_STOP_M).toBeLessThan(10);
    expect(TRUCK_PRESSURE.shape).toBeGreaterThan(1); // (gentle at first, steeper near full)
  });

  it('a long ramp at speed: damage grows outward, mobility falls, broken down by pressure 1 at the latest, at rest within TRUCK_PRESSURE_STOP_M of it', () => {
    const boundary = eastBoundary(90, 40), r = driveOut(boundary);
    const line = lineX(boundary, FOG_PRESSURE.full, 90, 200);
    expect(r.condAtHalf).toBeLessThan(0.75); // (half way out: already smoking and slowed)
    expect(r.condAtHalf).toBeGreaterThan(0.3);
    expect(r.condition).toBe(0);
    if (r.crossC !== null) expect(r.crossC).toBe(0); // (if it reached pressure 1 at all: broken down on that frame)
    const past = r.restX - line;
    console.info(`[truck pressure] long ramp (40 m): broken down at ${r.downV!.toFixed(2)} m/s, max pressure ${r.maxP.toFixed(3)}, at rest ${past.toFixed(2)} m from the pressure-1 line (body centre; nose +${(TRUCK_SPEC.length / 2).toFixed(2)} m)`);
    expect(past).toBeLessThanOrEqual(TRUCK_PRESSURE_STOP_M);
    expect(r.downV!).toBeLessThan(TRUCK_PHYS.forwardMax * 0.75); // (it had lost mobility on the way)
    expect(r.h.toasts).toContain(TRUCK_PRESSURE_TEXT.warn);
    expect(r.log.stalls).toBeGreaterThanOrEqual(1);
  });

  it('the worst case — a short ramp crossed at top speed — and a truck repaired inside the ramp: still broken down at pressure 1, within the bound', () => {
    const short = eastBoundary(140, 1.5), s = driveOut(short);
    const sLine = lineX(short, FOG_PRESSURE.full, 100, 200);
    expect(s.crossV!).toBeGreaterThan(TRUCK_PHYS.forwardMax * 0.85);
    expect(s.crossC).toBe(0);
    const worst = s.restX - sLine;
    console.info(`[truck pressure] short ramp (1.5 m) at ${s.crossV!.toFixed(2)} m/s: at rest ${worst.toFixed(2)} m past pressure 1 (bound ${truckStopBound().toFixed(2)}, TRUCK_PRESSURE_STOP_M ${TRUCK_PRESSURE_STOP_M})`);
    expect(worst).toBeLessThanOrEqual(TRUCK_PRESSURE_STOP_M);
    expect(worst).toBeGreaterThan(4); // (a real stop distance: the measurement means something)
    const fixed = eastBoundary(90, 40), f = driveOut(fixed, {repairAt: 0.6});
    expect(f.repaired).toBe(true);
    expect(f.condition).toBe(0);
    expect(f.crossC).toBe(0); // (it still had condition left at the line: the step out at pressure 1 broke it down outright)
    expect(f.restX - lineX(fixed, FOG_PRESSURE.full, 90, 200)).toBeLessThanOrEqual(TRUCK_PRESSURE_STOP_M);
  });

  it('coming back in costs no strain: broken down past the line, repaired, it reverses back inside pressure 1', () => {
    const boundary = eastBoundary(140, 1.5), r = driveOut(boundary);
    const {h, car, sys} = r;
    expect(sys.condition.pressure).toBeGreaterThan(1);
    sys.condition.setCondition(1); // (as a repair would: the repair itself is tests/surface-truck-repair.test.ts)
    h.keys.held.add('KeyS');
    let t = 0;
    for (; t < 20 && sys.condition.pressure >= FOG_PRESSURE.full; t += 1 / 60) run(h, car, 1 / 60);
    h.keys.held.clear();
    expect(sys.condition.pressure).toBeLessThan(FOG_PRESSURE.full);
    expect(truckStateOf(car).condition).toBeGreaterThan(0);
  });
});
