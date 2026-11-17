// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, follow-up 3): the version-2 cargo lift rendered nearly BLACK
// with the flashlight off (the lead's Firefox WebGL2 spot check: the Subway hall's lift at rest and through the ride). Two parts, no
// runtime THREE light, no global material / exposure change:
//  - GEN: every version-2 lift end has a light over its landing, appended (RNG-neutral) — the Subway hall's and the Office / Mall
//    landing's: one steady ceiling fixture in front of the gate (gen/surface/accessLift.ts liftLandingLight: the version-1 stairwell's
//    power rule); the command tent's: a second work lamp under its ridge over the landing (gen/surface/checkpoint.ts). Version 1 has none
//    (its station / district bytes: tests/surface-v1-compat.test.ts).
//  - THE CAR: its own lit finish (world/elevator.ts cargoLitMaterials: own names, light enamel stock, a self-glow in each finish's own
//    colour), so it reads in the rock / between storeys where no baked light reaches; the Bunker's cargo car keeps its finish.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {LIFT_CAR, LIFT_LANDING_LIGHT, outward} from '../src/gen/surface/accessLift';
import {installCanvasShim} from './helpers/canvas2d';
import {cargoMaterials} from '../src/world/elevator';
import type {StationLayout} from '../src/gen/stationTypes';

const seeds = (host: SurfaceHost, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < n && s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) out.push(s);
  return out;
};
const gen = (host: SurfaceHost, s: number, v: number, section = 'main'): StationLayout => LEVELS[host].generate(section as 'main', {levelSeed: s, surfaceVersion: v});
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('Surface Run v2: the lift ends are lit (gen fixtures) and the car carries its own lit finish', () => {
  for (const host of ['subway', 'office', 'mall'] as const) {
    it(`${host}: one steady fixture appended over the landing in front of the gate; the plain station's lights unchanged`, () => {
      for (const s of seeds(host, 3)) {
        const P = gen(host, s, 0), L = gen(host, s, SURFACE_VERSION), a = L.surfaceAccess!, l = a.lift!;
        expect(a.kind, `${host} ${s}`).toBe('lift');
        // append-only: the plain station's list is a prefix, one light after it
        expect(plain(L.lights.slice(0, P.lights.length))).toEqual(plain(P.lights));
        expect(L.lights.length, `${host} ${s}`).toBe(P.lights.length + 1);
        const f = L.lights[P.lights.length], n = outward(l.doorSide);
        // over the landing: LIFT_LANDING_LIGHT.out in front of the gate's centre, on the lift's storey, in the landing's area
        expect(f.x).toBeCloseTo(l.door.x + n[0] * LIFT_LANDING_LIGHT.out, 3);
        expect(f.z).toBeCloseTo(l.door.z + n[1] * LIFT_LANDING_LIGHT.out, 3);
        expect(f.level ?? 0).toBe(l.level);
        expect(f.area, 'the landing area (the hall / the lift\'s parent)').toBe(a.areas[0]);
        const g = L.levels[l.level].grid, [cx, cy] = g.cellOf(f.x, f.z), i = g.idx(cx, cy);
        expect(g.area[i], 'the landing cell').toBe(a.areas[0]);
        expect(f.y).toBeLessThan(g.ceil[i]);
        expect(f.y).toBeGreaterThan(l.y + LIFT_CAR.gateH);
        // a real, steady fixture (drawn: not virtual), its power by the landing's lighting (the version-1 stairwell's rule)
        expect(f).toMatchObject({broken: false, flicker: false, dying: false});
        expect(f.virtual).toBeUndefined();
        const lighting = L.areas[f.area].lighting;
        expect(f.power).toBe(lighting === 'dark' ? 0.45 : lighting === 'dim' ? 0.7 : 1);
        // the tube along the gate (its axis (cos rot, -sin rot) across the gate's normal)
        expect(Math.abs(Math.cos(f.rot) * n[0] - Math.sin(f.rot) * n[1])).toBeLessThan(1e-9);
        // version 1 (its own stair / door): nothing at that spot
        expect(gen(host, s, 1).lights.some(q => Math.hypot(q.x - f.x, q.z - f.z) < 0.05 && Math.abs(q.y - f.y) < 0.05)).toBe(false);
      }
    });
  }

  it('the command tent (each host): version 2 adds a work lamp under the ridge over the lift\'s landing; version 1 keeps its one lamp', () => {
    for (const host of ['subway', 'office', 'mall'] as const) {
      const s = seeds(host, 1)[0];
      const D2 = gen(host, s, SURFACE_VERSION, 'surface'), D1 = gen(host, s, 1, 'surface');
      const t2 = D2.surface!.checkpoint.tent, t1 = D1.surface!.checkpoint.tent, l = D2.surface!.portal.lift!;
      const inTent2 = D2.lights.filter(q => q.area === t2.area), inTent1 = D1.lights.filter(q => q.area === t1.area);
      expect(inTent1.length, `${host} ${s}: version 1`).toBe(1);
      expect(inTent2.length, `${host} ${s}: version 2`).toBe(2);
      const n = outward(l.doorSide), f = inTent2[1];
      expect(f.x).toBeCloseTo(l.door.x + n[0] * LIFT_LANDING_LIGHT.out, 3);
      expect(f.z).toBeCloseTo(l.door.z + n[1] * LIFT_LANDING_LIGHT.out, 3);
      expect(f.x > t2.rect.x0 && f.x < t2.rect.x1 && f.z > t2.rect.z0 && f.z < t2.rect.z1, 'under the canvas').toBe(true);
      expect(f).toMatchObject({broken: false, flicker: false, dying: false, virtual: true, y: inTent2[0].y, power: inTent2[0].power});
      // the landing side of the gate, outside the car
      expect((f.x - l.door.x) * n[0] + (f.z - l.door.z) * n[1]).toBeGreaterThan(0.5);
    }
  });

  it('the car\'s lit finish: its own materials (the Bunker\'s set unchanged), a self-glow in each finish\'s colour, no light object', () => {
    installCanvasShim(false);
    const base = cargoMaterials(), lit = cargoMaterials(true);
    // the Bunker's (default) set: its names and glow as before
    expect(Object.fromEntries(Object.entries(base).map(([k, m]) => [k, [m.name, m.emissiveIntensity]]))).toEqual({
      paint: ['cargo-cab-paint', 0.12], deck: ['cargo-cab-deck', 0.1], hazard: ['cargo-hazard', 0.14], bars: ['cargo-gate-bars', 0.08],
      door: ['cargo-landing-door', 0.08], liner: ['cargo-shaft-liner', 0.06],
    });
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      const m = lit[k], b = base[k];
      expect(m, k).not.toBe(b);
      expect(m.name).toBe(`${b.name}@lit`);
      expect(m.color.getHex(), `${k}: the same colour`).toBe(b.color.getHex());
      expect(m).not.toBeInstanceOf(THREE.Light);
      // the self-glow: emissive x the albedo map x intensity, well above the Bunker's (a lit car with no light around it)
      expect(m.emissiveMap, k).toBe(m.map);
      const e = m.emissive.clone().multiplyScalar(m.emissiveIntensity), eb = b.emissive.clone().multiplyScalar(b.emissiveIntensity);
      expect(e.r + e.g + e.b, k).toBeGreaterThan(1.5 * (eb.r + eb.g + eb.b));
      if (k !== 'bars') {
        // in the finish's own colour: emissive / colour = the warm white for every channel (the hazard stays yellow)
        const c = m.color, w = [e.r / c.r, e.g / c.g, e.b / c.b].map(x => x / m.emissiveIntensity);
        expect(w[0]).toBeCloseTo(1, 4); expect(w[1]).toBeCloseTo(0.93, 4); expect(w[2]).toBeCloseTo(0.82, 4);
      }
    }
    expect(cargoMaterials(true).paint, 'cached: one material per finish').toBe(lit.paint);
  });
});
