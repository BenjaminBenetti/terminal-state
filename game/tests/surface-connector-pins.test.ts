// Task studio-surface-host-ground-connectors-20261118-053602-01: INDEX STABILITY of the Surface Run version-2 Office / Mall CONNECTOR —
// the connector layouts against the LIFT-ERA baseline (tests/helpers/surfaceConnectorBaseline.ts, captured at b0cce3a before any change)
// of the three official starters (Office network 2 st-02, Mall network 8 st-17, Subway network 1 st-00) and the first ten present seeds
// of each host. Per list / storey digests (tests/helpers/surfaceConnectorPins.ts), normalized so they compare equal exactly when the
// only differences are the INTENDED ones:
//  - HOST (Office / Mall 'main'): the lift era's appended car area, landing light and 'LIFT TO STREET' sign are gone and its car room's
//    cells are back (masked: the lift's footprint); the Office's barricade pieces in front of the version-1 door are MOVED aside
//    (restored here from their memory anchor, PropPlacement.memAt; loose items on their tops with them; the prop masks re-derived) and its
//    'EXIT · STREET' plate is appended; surfaceAccess is the connector's. Everything else — every prop's index / kind / rotation / size,
//    every pickup, enemy, light, area, sign, door, the spawn, every storey's grid, every holder's memory key — is the lift era's exactly.
//  - DISTRICT ('surface'): the tent's floor where the lift era's car room stood (masked: the car's footprint) and the tube's footprint
//    (masked: SOLID now) differ; the portal (kind 'connector') and the spawn (its arrival pose) are new. Every prop (the tent's tables,
//    crate, gear; the compound), pickup, enemy, light (both ridge lamps), sign, door, area and the rest of the surface record is the
//    lift era's exactly.
//  - SUBWAY: both worlds byte-identical (full-layout digests): its cargo lift stays.
// The same generation also sweeps what the brief requires of every case: the tube footprint clear of props / pickups / enemies / signs /
// lights, the records' values, and the loading-screen poses (walkable, the record's area and level, facing the right way).
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION} from '../src/gen/surface/surfaceRun';
import {CONNECTOR, worldToConnector} from '../src/gen/surface/connectorShape';
import {connectorRect, connectorHalf, CONNECTOR_PLAZA} from '../src/gen/surface/connectorFootprint';
import {KERB} from '../src/gen/surface/cityBlocks';
import {FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceConnector} from '../src/gen/surface/surfaceTypes';
import {CONNECTOR_BASELINE} from './helpers/surfaceConnectorBaseline';
import {districtPins, hostPins, layoutDigest} from './helpers/surfaceConnectorPins';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Nothing generated in a district's tube footprint (its rect, + the item / fixture margins). */
function footprintClear(D: StationLayout, c: SurfaceConnector): string[] {
  const r = connectorRect(c), bad: string[] = [];
  const near = (x: number, z: number, m: number) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
  D.props.forEach((p, i) => { if ((p.level ?? 0) === 0 && p.x + p.hx > r.x0 && p.x - p.hx < r.x1 && p.z + p.hz > r.z0 && p.z - p.hz < r.z1) bad.push(`prop ${i} ${p.kind}`); });
  D.pickups.forEach((k, i) => { if ((k.level ?? 0) === 0 && near(k.x, k.z, 0.1)) bad.push(`pickup ${i} ${k.itemId}`); });
  D.zombies.forEach((z, i) => { if ((z.level ?? 0) === 0 && near(z.x, z.z, 0.4)) bad.push(`zombie ${i}`); });
  D.signs.forEach((s, i) => { if ((s.level ?? 0) === 0 && near(s.x, s.z, 0.1)) bad.push(`sign ${i} ${s.text}`); });
  D.lights.forEach((l, i) => { if (((l as {level?: number}).level ?? 0) === 0 && near(l.x, l.z, 0.1)) bad.push(`light ${i}`); });
  return bad;
}

describe('Surface Run v2 connector: index stability against the lift era (+ the footprint / pose sweep)', () => {
  for (const c of CONNECTOR_BASELINE) {
    it(`${c.host} ${c.tag} (seed ${c.seed})`, () => {
      const M = LEVELS[c.host].generate('main', {levelSeed: c.seed, surfaceVersion: SURFACE_VERSION});
      const D = LEVELS[c.host].generate('surface', {levelSeed: c.seed, surfaceVersion: SURFACE_VERSION});
      if (c.host === 'subway') {
        expect(M.surfaceAccess?.kind, 'the Subway keeps its cargo lift').toBe('lift');
        expect(D.surface?.portal.kind).toBe('lift');
        expect({main: layoutDigest(M), district: layoutDigest(D)}, 'the Subway worlds byte-identical').toEqual({main: c.main, district: c.district});
        return;
      }
      const a = M.surfaceAccess!, P = D.surface!.portal;
      expect(a.kind).toBe('connector');
      expect(a.v).toBe(2);
      expect(a.lift, 'no lift').toBeUndefined();
      expect(P.kind).toBe('connector');
      expect(P.lift).toBeUndefined();
      // index stability: the normalized digests are the lift era's
      expect(hostPins(M, 'connector', c.hostMask!), 'the host station').toEqual(c.hostPins);
      expect(districtPins(D, c.districtMask!), 'the district').toEqual(c.districtPins);
      // the intended differences, explicitly: the Office's moved pieces keep their anchor (memAt) and nothing else moved; the Mall moves none
      const moved = M.props.filter(p => p.memAt);
      if (c.host === 'mall') expect(moved.length).toBe(0);
      for (const p of moved) expect(['crate', 'cartonStack', 'wetFloorSign'].includes(p.kind) || p.host !== undefined, `${p.kind} moved`).toBe(true);
      // the records
      const h = a.connector!, d = P.connector!;
      expect(h).toMatchObject({host: c.host, end: 'host', len: CONNECTOR.len});
      expect(d).toMatchObject({host: c.host, end: 'tent', len: CONNECTOR.len, level: 0, y: KERB, area: D.surface!.checkpoint.tent.area});
      expect(d.len, 'one tube: both records share len').toBe(h.len);
      // the district's tube: from the host facade (plaza v 0, the host building's footprint edge) to the tent's inner wall plane
      const hb = D.surface!.buildings.find(b => b.host === c.host)!, tent = D.surface!.checkpoint.tent.rect;
      const [s0] = worldToConnector(d, d.x, d.z);
      expect(s0).toBeCloseTo(0, 6);
      const alongZ = Math.abs(Math.cos(d.yaw)) > 0.5;
      const facade = alongZ ? (Math.cos(d.yaw) < 0 ? hb.footprint.z1 : hb.footprint.z0) : (Math.sin(d.yaw) < 0 ? hb.footprint.x1 : hb.footprint.x0);
      expect(alongZ ? d.z : d.x, 'the host mouth on the host facade').toBeCloseTo(facade, 3);
      const innerWall = alongZ ? (Math.cos(d.yaw) < 0 ? tent.z0 + 0.5 : tent.z1 - 0.5) : (Math.sin(d.yaw) < 0 ? tent.x0 + 0.5 : tent.x1 - 0.5);
      expect((alongZ ? d.z : d.x) + (alongZ ? -Math.cos(d.yaw) : -Math.sin(d.yaw)) * d.len, 'the tent mouth on the tent\'s inner wall plane').toBeCloseTo(innerWall, 3);
      // the footprint: SOLID, nothing generated in it
      expect(footprintClear(D, d), 'the footprint holds nothing').toEqual([]);
      const g = D.grid, r = connectorRect(d);
      for (let z = r.z0 + 0.25; z < r.z1; z += 0.5) for (let x = r.x0 + 0.25; x < r.x1; x += 0.5) expect(g.cells[g.idx(...g.cellOf(x, z))], `${x},${z}`).not.toBe(FLOOR);
      expect(r.x1 - r.x0 + r.z1 - r.z0, 'the footprint rect').toBeCloseTo(2 * connectorHalf() + CONNECTOR.len, 3);
      // the loading-screen poses: on the walk-in side's floor, in its area, facing into it
      const hp = a.returnPose, hg = M.levels[h.level].grid, [hs, ht] = worldToConnector(h, hp.x, hp.z);
      expect(hp.level, 'host pose level').toBe(h.level);
      expect(hp.y).toBeCloseTo(h.y, 3);
      expect(hg.walkable(...hg.cellOf(hp.x, hp.z)), 'host pose walkable').toBe(true);
      expect(hg.area[hg.idx(...hg.cellOf(hp.x, hp.z))], 'host pose area').toBe(h.area);
      expect(hs, 'host pose ~1.5 m inside the doorway').toBeLessThan(-h.door.depth - 1.0);
      expect(hs).toBeGreaterThan(-h.door.depth - 3.6);
      expect(Math.abs(ht)).toBeLessThanOrEqual(1.0);
      expect(Math.abs(wrap(hp.yaw - (h.yaw + Math.PI))), 'host pose faces into the building').toBeLessThan(1e-3);
      const dp = P.pose, [ds, dt] = worldToConnector(d, dp.x, dp.z);
      expect(dp.level).toBe(0);
      expect(dp.y).toBeCloseTo(d.y, 3);
      expect(g.walkable(...g.cellOf(dp.x, dp.z)), 'district pose walkable').toBe(true);
      expect(g.area[g.idx(...g.cellOf(dp.x, dp.z))], 'district pose in the tent').toBe(d.area);
      expect(ds).toBeCloseTo(d.len + CONNECTOR_PLAZA.arrive, 3);
      expect(dt).toBeCloseTo(0, 3);
      expect(Math.abs(wrap(dp.yaw - d.yaw)), 'district pose faces into the tent').toBeLessThan(1e-3);
      expect(D.playerSpawn).toEqual({x: dp.x, z: dp.z, yaw: dp.yaw});
    }, 60000);
  }
});
