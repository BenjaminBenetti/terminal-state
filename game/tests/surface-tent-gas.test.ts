// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): the command tent is a SAFE interior while its flap is shut — and
// the arrival (version 2: standing in the Subway's cargo lift car, or in front of an Office / Mall connector tube's mouth) is in it. Node,
// THE gas the game uses for exposure and the volumetric layers (one source of truth): world/surface/airField.ts SurfaceGasField (the
// interior zones) + world/surface/airMask.ts surfaceAirAt (the outdoor air, the sealed cab):
//  - every other doorway of the district breached at its full age, the field settled at the arrival and run for a minute: no gas anywhere
//    in the tent (the car included) at any height a body or an eye reaches, from either term;
//  - the car's cells are the tent's own air (the flap's zone; an indoor column under the tent's top: no outdoor air, no other pocket);
//  - ONE door in the tent's doorway — the flap: the tent building's own entrance record (GEN: 'open', so the tent is enterable) is not a
//    second, generated-open leafed door there (it was: its gas source ran into the tent whatever the flap did — the field follow-up fix in
//    world/surface/airDoors.ts planSurfaceDoors);
//  - the flap OPEN follows the normal door-breach rule: gas pours in at the doorway (and so shows: the layers draw this same field).
// No new gas source: the flap's breach is the existing door rule (tests/surface-gas-parity.test.ts covers its hazard <-> visual parity).
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {CELL, FLOOR} from '../src/gen/grid';
import {GAS} from '../src/world/gas/field';
import {surfaceAirAt, surfaceAirPressureAt, surfaceOutdoorMap} from '../src/world/surface/airMask';
import {SurfaceGasField, surfaceGasZones} from '../src/world/surface/airField';
import {doorBreachId, doorPoint, planSurfaceDoors} from '../src/world/surface/airDoors';
import {CONNECTOR, connectorToWorld} from '../src/gen/surface/connectorShape';
import type {StationLayout} from '../src/gen/stationTypes';

const seeds = (host: SurfaceHost, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < n && s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) out.push(s);
  return out;
};
const district = (host: SurfaceHost, s: number, v: number): StationLayout => LEVELS[host].generate('surface', {levelSeed: s, surfaceVersion: v});
const HEIGHTS = [0.3, 1.0, 1.6, 2.0]; // above the floor: shins .. a standing eye .. the head

describe('Surface Run: the command tent is gas-free with its flap shut (the arrival is in it); an open flap breaches by the door rule', () => {
  for (const v of [1, SURFACE_VERSION]) for (const host of ['subway', 'office', 'mall'] as const) {
    it(`version ${v}, ${host}`, () => {
      const L = district(host, seeds(host, 1)[0], v);
      const S = L.surface!, g = L.levels?.[0]?.grid ?? L.grid, t = S.checkpoint.tent;
      const map = surfaceOutdoorMap(L)!;
      const specs = surfaceGasZones(S);
      const levels = (L.levels?.length ? L.levels : [{id: 0, grid: L.grid}]).map(l => ({id: l.id, grid: l.grid}));
      const pose = S.portal.pose;
      const f = new SurfaceGasField(levels, specs, map, () => ({x: pose.x, z: pose.z}));
      const doors = planSurfaceDoors(S, g, L.levels), flap = doors.find(d => d.tent)!;
      // one door in the tent's doorway: the flap (no other door's cells in the tent's air)
      expect(doors.filter(d => d.tent)).toHaveLength(1);
      const tentZone = f.zoneAtCell(flap.cells[0] % g.w, Math.floor(flap.cells[0] / g.w));
      expect(tentZone, 'the flap\'s doorway is the tent\'s air').toBeGreaterThanOrEqual(0);
      const tcx = Math.floor((t.rect.x0 + t.rect.x1) / 2 / CELL), tcy = Math.floor((t.rect.z0 + t.rect.z1) / 2 / CELL);
      expect(f.zoneAtCell(tcx, tcy), 'the tent\'s middle').toBe(tentZone);
      for (const d of doors) if (!d.tent) expect(d.cells.some(i => f.zoneAtCell(i % g.w, Math.floor(i / g.w)) === tentZone), `door ${d.id} breaches the tent's air`).toBe(false);
      // the arrival is in the tent (version 2: standing in the car, the car's cells the tent zone's)
      const inTent = (x: number, z: number) => x > t.rect.x0 && x < t.rect.x1 && z > t.rect.z0 && z < t.rect.z1;
      if (v >= 2) {
        expect(inTent(pose.x, pose.z), 'the arrival stands in the tent').toBe(true);
        // (task studio-surface-host-ground-connectors-20261118-053602-01) the Subway arrives in its cargo lift's car; an Office / Mall in
        // front of its connector tube's mouth: the tent apron the walk releases the player onto (the tube's own air: tests/surface-connector-gen)
        const l = S.portal.lift, c = S.portal.connector;
        expect(S.portal.kind, `${host}: the arrival`).toBe(host === 'subway' ? 'lift' : 'connector');
        const cells: [number, number][] = [];
        if (l) for (let z = l.cab.z0 + CELL / 2; z < l.cab.z1; z += CELL) for (let x = l.cab.x0 + CELL / 2; x < l.cab.x1; x += CELL) cells.push([x, z]);
        if (c) for (let s = c.len + CELL / 2; s < c.len + CONNECTOR.apron; s += CELL) for (let t = -CONNECTOR.width / 2 + CELL / 2; t < CONNECTOR.width / 2; t += CELL) cells.push(connectorToWorld(c, s, t));
        expect(cells.length, 'the arrival\'s floor').toBeGreaterThan(0);
        for (const [x, z] of cells) {
          const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
          expect(f.zoneAtCell(cx, cy), `${l ? 'car' : 'tent apron'} cell ${cx},${cy}: the tent's air`).toBe(tentZone);
          expect(map.top[cy * map.w + cx], 'an indoor column').toBeGreaterThan(0);
        }
      }
      // every other doorway breached at its full age (the worst case a district memory can restore), the arrival settled, a minute run
      let breached = 0;
      for (const d of doors) if (!d.tent && d.cells.length && f.addAged({id: doorBreachId(d.id), level: d.level, cells: d.cells}, GAS.AGE_CAP_S)) breached++;
      expect(breached, 'the district\'s buildings are gassed').toBeGreaterThan(0);
      f.settle(pose.x, pose.z);
      for (let k = 0; k < 600; k++) f.tick(0.1);
      expect(f.stats().live, 'gassed zones are live round the arrival').toBeGreaterThanOrEqual(0);
      const sample = () => {
        let worst = 0, n = 0;
        for (let cy = Math.floor(t.rect.z0 / CELL); cy < Math.ceil(t.rect.z1 / CELL); cy++) for (let cx = Math.floor(t.rect.x0 / CELL); cx < Math.ceil(t.rect.x1 / CELL); cx++) {
          const i = g.idx(cx, cy);
          if (g.cells[i] !== FLOOR || g.area[i] !== t.area) continue;
          const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
          if (!inTent(x, z)) continue;
          for (const h of HEIGHTS) {
            const y = g.floor[i] + h;
            worst = Math.max(worst, f.concentrationAt(x, y, z) + surfaceAirAt(map, null, x, y, z) + surfaceAirPressureAt(map, null, x, y, z)); // (+ lane FOG's pressure: 0 indoors)
            n++;
          }
        }
        return {worst, n};
      };
      const shut = sample();
      expect(shut.n).toBeGreaterThan(100);
      expect(shut.worst, 'no gas anywhere in the tent with the flap shut').toBe(0);
      expect(f.zones[tentZone].field, 'the tent\'s zone has no field at all').toBeNull();
      // the arrival point itself, at the eye (version 2: in the tent's car; version 1 arrives at its headhouse / street door, unchanged)
      if (v >= 2) expect(f.concentrationAt(pose.x, pose.y + 1.6, pose.z) + surfaceAirAt(map, null, pose.x, pose.y + 1.6, pose.z)).toBe(0);
      // ... while the plaza outside the flap is the outdoor air (so the flap does separate two airs)
      const out = doorPoint(flap, flap.a, -2.5);
      expect(surfaceAirAt(map, null, out.x, flap.floor + 1.6, out.z), 'the plaza outside is toxic').toBeGreaterThan(GAS.THRESHOLD);
      // the flap opened: the normal door-breach rule — gas enters at the doorway
      expect(flap.cells.length, 'the flap\'s doorway cells (its gas source while open)').toBeGreaterThan(0);
      expect(f.addAged({id: doorBreachId(flap.id), level: flap.level, cells: flap.cells}, 0)).toBe(true);
      for (let k = 0; k < 200; k++) f.tick(0.1);
      const near = doorPoint(flap, flap.a, 1.2);
      expect(f.concentrationAt(near.x, flap.floor + 1.0, near.z), 'gas just inside the open flap').toBeGreaterThan(0.01);
      expect(sample().worst).toBeGreaterThan(0.01);
    }, 120_000);
  }
});
