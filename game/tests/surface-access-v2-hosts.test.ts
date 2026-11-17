// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, follow-up 2): SURFACE RUN version 2 — the OFFICE / MALL cargo
// lift (gen/surface/accessLiftHost.ts), through the level registry:
//  - every present station (a sweep) gets its lift inside the building on the access storey, near the version-1 door's way out;
//  - a real room: the car's FLOOR cells at the storey floor under the car's ceiling, the gate's doorway, the ring SOLID, the landing open;
//  - connectivity: every cell reachable on foot in the plain station is reachable with the lift, and the car is;
//  - append-only / RNG-neutral: the plain station's props, pickups, lights, enemies, doors and spawn unchanged; one area and one sign
//    appended; the grid differs only inside the footprint;
//  - version 1 keeps its street door (tests/surface-access.test.ts / surface-v1-compat.test.ts pin it).
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {LIFT_CAR, outward} from '../src/gen/surface/accessLift';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceLift} from '../src/gen/surface/surfaceTypes';

const seeds = (host: SurfaceHost, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < n && s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) out.push(s);
  return out;
};
const gen = (host: SurfaceHost, s: number, v?: number): StationLayout => LEVELS[host].generate('main', {levelSeed: s, ...(v !== undefined ? {surfaceVersion: v} : {})});
const plain = (x: unknown) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const SWEEP = Number(process.env.SURFACE_HOST_SWEEP ?? 6);

/** The car room on its storey's grid: FLOOR at the floor under the car's ceiling, the gate doorway, the ring SOLID beside the gate. */
function expectCarRoom(L: StationLayout, l: SurfaceLift): void {
  const g = L.levels[l.level].grid;
  for (let z = l.cab.z0 + CELL / 2; z < l.cab.z1; z += CELL) for (let x = l.cab.x0 + CELL / 2; x < l.cab.x1; x += CELL) {
    const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
    expect(g.cells[i]).toBe(FLOOR);
    expect(g.area[i]).toBe(l.area);
    expect(g.floor[i]).toBeCloseTo(l.y - LIFT_CAR.sink, 4);
    expect(g.ceil[i]).toBeCloseTo(l.y + LIFT_CAR.cabH + LIFT_CAR.ceilGap, 4);
  }
  const n = outward(l.doorSide), gx = l.door.x + n[0] * CELL / 2, gz = l.door.z + n[1] * CELL / 2;
  const [dx, dy] = g.cellOf(gx, gz);
  expect(g.cells[g.idx(dx, dy)], 'the gate doorway').toBe(FLOOR);
  const side = (k: number) => { const [sx, sy] = g.cellOf(gx + (n[1] !== 0 ? k : 0), gz + (n[0] !== 0 ? k : 0)); return g.cells[g.idx(sx, sy)]; };
  expect(side(LIFT_CAR.width * CELL / 2 + 0.25), 'the ring beside the gate').toBe(SOLID);
  expect(side(-(LIFT_CAR.width * CELL / 2 + 0.25))).toBe(SOLID);
  // the landing in front of the gate: open floor at the car's floor
  const [lx, ly] = g.cellOf(l.door.x + n[0] * 1.2, l.door.z + n[1] * 1.2);
  expect(g.cells[g.idx(lx, ly)], 'the landing').toBe(FLOOR);
  expect(g.blocked[g.idx(lx, ly)]).toBe(0);
}

describe('Surface Run v2: the Office / Mall cargo lift inside the building', () => {
  for (const host of ['office', 'mall'] as const) {
    it(`${host}: every present station of a sweep gets its lift on the access storey; a real, reachable room; nothing generated moved`, () => {
      const report: string[] = [];
      for (const s of seeds(host, SWEEP)) {
        const L = gen(host, s, SURFACE_VERSION), P = gen(host, s, 0), a = L.surfaceAccess!;
        expect(a, `${host} ${s}`).toBeTruthy();
        expect(a.kind, `${host} ${s}: the lift`).toBe('lift');
        expect(a.v).toBe(2);
        const l = a.lift!;
        expectCarRoom(L, l);
        // near the version-1 door's way out (the Office lobby's entrance / the Mall's street exit storey)
        const v1 = gen(host, s, 1).surfaceAccess!;
        expect(l.level, `${host} ${s}: the access storey`).toBe(v1.returnPose.level);
        const dist = Math.hypot((l.cab.x0 + l.cab.x1) / 2 - v1.returnPose.x, (l.cab.z0 + l.cab.z1) / 2 - v1.returnPose.z);
        report.push(`${host} ${s}: ${l.doorSide} gate, storey ${l.level}, ${dist.toFixed(1)} m from the version-1 door`);
        expect(dist).toBeLessThan(75);
        // the return pose stands in the car on a free floor
        const g = L.levels[l.level].grid, p = a.returnPose;
        expect(p.x > l.cab.x0 && p.x < l.cab.x1 && p.z > l.cab.z0 && p.z < l.cab.z1).toBe(true);
        expect(g.circleClear(p.x, p.z, 0.4)).toBe(true);
        // connectivity: the plain station's reachable cells all stay reachable, and the car is reached
        const sp = L.levels[0].grid.cellOf(L.playerSpawn.x, L.playerSpawn.z);
        const before = levelDistance(P.levels, sp[0], sp[1], 0, P.levelLinks), after = levelDistance(L.levels, sp[0], sp[1], 0, L.levelLinks);
        let lost = 0;
        before.forEach((b, k) => { const gk = L.levels[k].grid; for (let i = 0; i < b.length; i++) if (b[i] >= 0 && after[k][i] < 0) {
          const x = (i % gk.w + 0.5) * CELL, z = (Math.floor(i / gk.w) + 0.5) * CELL;
          if (!(k === l.level && x > l.shaft.x0 && x < l.shaft.x1 && z > l.shaft.z0 && z < l.shaft.z1)) lost++;
        } });
        expect(lost, `${host} ${s}: cells cut off`).toBe(0);
        const [mx, my] = g.cellOf(p.x, p.z);
        expect(after[l.level][g.idx(mx, my)], 'the car is reachable on foot').toBeGreaterThanOrEqual(0);
        // append-only: nothing generated moved; one area, one sign appended
        expect(plain(L.props)).toEqual(plain(P.props));
        expect(plain(L.pickups)).toEqual(plain(P.pickups));
        expect(plain(L.lights)).toEqual(plain(P.lights));
        expect(plain(L.zombies)).toEqual(plain(P.zombies));
        expect(plain(L.doors)).toEqual(plain(P.doors));
        expect(plain(L.playerSpawn)).toEqual(plain(P.playerSpawn));
        expect(plain(L.areas.slice(0, P.areas.length))).toEqual(plain(P.areas));
        expect(L.areas.length).toBe(P.areas.length + 1);
        expect(plain(L.signs.slice(0, P.signs.length))).toEqual(plain(P.signs));
        expect(L.signs.slice(P.signs.length).map(x => x.text)).toEqual(['LIFT TO STREET']);
        // the grids differ only inside the shaft
        L.levels.forEach((Lv, k) => {
          const a2 = Lv.grid.cells, b2 = P.levels[k].grid.cells, gk = Lv.grid;
          for (let i = 0; i < a2.length; i++) if (a2[i] !== b2[i]) {
            const x = (i % gk.w + 0.5) * CELL, z = (Math.floor(i / gk.w) + 0.5) * CELL;
            expect(k === l.level && x > l.shaft.x0 && x < l.shaft.x1 && z > l.shaft.z0 && z < l.shaft.z1, `${host} ${s}: cell ${i} of storey ${k}`).toBe(true);
          }
        });
        // version 1: its door
        expect(v1.kind).toBe(host === 'office' ? 'office-door' : 'mall-door');
      }
      if (process.env.SURFACE_HOST_LOG) process.stdout.write(`${report.join('\n')}\n`);
    }, 600_000);
  }
});
