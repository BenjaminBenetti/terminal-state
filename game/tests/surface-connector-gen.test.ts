// Task studio-surface-host-ground-connectors-20261118-053602-01: the Surface Run version-2 Office / Mall CONNECTOR's generation and
// static views (lane GEN) — beside the index-stability pins (tests/surface-connector-pins.test.ts):
//  - DISTRICT: the tube's footprint holds clean air to the tube's crown (one field: exposure = the fog march's column map), its canvas
//    ring and the air above it stay outdoors, every other column is exactly as without the tube; the compound round it stays reachable
//    on foot; the look plan owns its cells (ring ground), keeps every tent guy line off it and the host facade plain over its mouth.
//  - OFFICE: the way out is version 1's exactly (every prop / pickup where version 1 puts it), each moved barricade piece keyed at its
//    lift-era spot (PropPlacement.memAt); a remembered loose item on a moved piece's top goes with it once (run/memory.ts
//    rebaseMovedPieceItems); the boarding has an open doorway (no plank / frame in it, the boarding beside it), the street's ground is
//    open under the tube and no street prop stands near it.
//  - MALL: the usable street exit's walk span has no leaf / mullion of either door set in it, and nothing (fog card, wreck, rubble) stands
//    in the tube's reach on the street.
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION} from '../src/gen/surface/surfaceRun';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceConnector} from '../src/gen/surface/surfaceTypes';
import {CONNECTOR, connectorToWorld} from '../src/gen/surface/connectorShape';
import {connectorCells, connectorRect} from '../src/gen/surface/connectorFootprint';
import {footFlood} from '../src/gen/surface/cityCheck';
import {SURFACE_AIR, surfaceOutdoorGasAt, surfaceOutdoorMap} from '../src/world/surface/airMask';
import {CONNECTOR_FACADE, OWNER, guyCrosses, surfaceLookPlan} from '../src/world/surface/archPlan';
import {MOVED_PIECES_LANE, createMemory, propHolderKey, rebaseMovedPieceItems, type PickupRecord} from '../src/run/memory';
import {officeConnectorTube, readTowerInfo} from '../src/world/towerShared';
import {buildWindows, planWindows} from '../src/world/officeWindows';
import {WorldMaterials} from '../src/world/materials';
import {buildExterior, planExterior} from '../src/world/exterior';
import {buildStreetExit, exitFrame, streetExitSpecs} from '../src/world/mallStreetExit';

installCanvasShim(false);

const OFFICE = 61488949, MALL = 1452570507; // net2:st-02, net8:st-17
const gen = (host: 'office' | 'mall', seed: number, section: 'main' | 'surface', surfaceVersion = SURFACE_VERSION) =>
  LEVELS[host].generate(section, {levelSeed: seed, surfaceVersion});

const DISTRICTS: [('office' | 'mall'), number][] = [['office', OFFICE], ['mall', MALL], ['office', 6], ['mall', 15]];
const districts: {host: 'office' | 'mall'; seed: number; D: StationLayout; c: SurfaceConnector}[] = [];
beforeAll(() => {
  for (const [host, seed] of DISTRICTS) { const D = gen(host, seed, 'surface'); districts.push({host, seed, D, c: D.surface!.portal.connector!}); }
}, 300000);

describe('connector district: air, reach, look', () => {
  it('the tube holds clean air to its crown; its ring and the air above it are outdoors; every other column is as without the tube', () => {
    for (const {host, seed, D, c} of districts) {
      const m = surfaceOutdoorMap(D)!, W = D.grid.w, H = D.grid.h;
      // the same layout's map without the tube record: what the columns would be
      const bare = surfaceOutdoorMap({grid: D.grid, levels: D.levels, surface: {...D.surface!, portal: {...D.surface!.portal, connector: undefined}}})!;
      const crown = c.y + CONNECTOR.crownH, crownTop = Math.ceil(crown / SURFACE_AIR.TOP_STEP - 1e-9);
      let outside = 0;
      for (const {i, role} of connectorCells(c, W, H)) {
        const x = ((i % W) + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL, tag = `${host} ${seed} ${role} ${x},${z}`;
        if (role === 'clear') {
          for (const dy of [0.1, 1.0, 1.7, 1.95]) expect(surfaceOutdoorGasAt(m, x, c.y + dy, z), `${tag} +${dy}`).toBe(0);
          // indoors to the crown (the tent's own taller columns at its mouth stay the tent's)
          expect(m.top[i], tag).toBe(Math.max(bare.top[i], crownTop));
          if (bare.top[i] === 0) {
            outside++;
            expect(surfaceOutdoorGasAt(m, x, crownTop * SURFACE_AIR.TOP_STEP + 0.05, z), `${tag}: above the crown`).toBeGreaterThan(0);
          }
        } else if (role === 'ring') expect(surfaceOutdoorGasAt(m, x, c.y + 1.0, z), `${tag}: beside the tube`).toBeGreaterThan(0);
      }
      expect(outside, `${host} ${seed}: the tube's open-air run`).toBe((CONNECTOR.len - CELL) / CELL * (CONNECTOR.width / CELL));
      // the arrival and the tent: clean
      const p = D.surface!.portal.pose;
      expect(surfaceOutdoorGasAt(m, p.x, p.y + 1.6, p.z), `${host} ${seed}: arrival`).toBe(0);
      // every other column: as without the tube
      const clear = new Set(connectorCells(c, W, H).filter(q => q.role === 'clear').map(q => q.i));
      let diff = 0;
      for (let i = 0; i < m.top.length; i++) if (!clear.has(i) && m.top[i] !== bare.top[i]) diff++;
      expect(diff, `${host} ${seed}: columns changed outside the tube`).toBe(0);
    }
  });

  it('the compound round the footprint stays reachable on foot from the arrival', () => {
    for (const {host, seed, D, c} of districts) {
      const g = D.grid, p = D.surface!.portal.pose, foot = footFlood(D, p.x, p.z, 0)[0];
      const r = connectorRect(c), R = 3, hb = D.surface!.buildings.find(b => b.host === host)!.footprint;
      const lost: string[] = [];
      let near = 0;
      for (let cy = Math.floor((r.z0 - R) / CELL); cy < Math.ceil((r.z1 + R) / CELL); cy++) for (let cx = Math.floor((r.x0 - R) / CELL); cx < Math.ceil((r.x1 + R) / CELL); cx++) {
        if (!g.walkable(cx, cy)) continue;
        const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
        if (x > hb.x0 && x < hb.x1 && z > hb.z0 && z < hb.z1) continue; // (inside the host building's shell)
        near++;
        if (foot[g.idx(cx, cy)] < 0) lost.push(`${x},${z}`);
      }
      expect(near, `${host} ${seed}`).toBeGreaterThan(40);
      expect(lost, `${host} ${seed}: walkable floor near the tube cut off`).toEqual([]);
      // and the tube's own cells are never walked (the walk model carries the player)
      for (const {i} of connectorCells(c, g.w, g.h)) expect(g.cells[i] === FLOOR && !g.blocked[i], `${host} ${seed}: cell ${i}`).toBe(false);
    }
  });

  it('the look plan: footprint cells owned by the tube (ring ground), no guy line over it, the host facade plain over its mouth', () => {
    for (const {host, seed, D, c} of districts) {
      const plan = surfaceLookPlan(D)!, tag = `${host} ${seed}`;
      expect(plan.connector?.rec, tag).toBe(c);
      const cells = connectorCells(c, D.grid.w, D.grid.h);
      expect(plan.connector!.ring.length, tag).toBe(cells.filter(q => q.role === 'ring').length);
      for (const {i, role} of cells) if (role !== 'tent') expect(plan.owner[i], `${tag} cell ${i}`).toBe(OWNER.connector);
      expect(plan.tent!.guys.length, `${tag}: the tent keeps its guy lines`).toBeGreaterThan(0);
      for (const q of plan.tent!.guys) expect(guyCrosses(connectorRect(c), q), tag).toBe(false);
      const bl = plan.buildings.find(b => b.b.host === host)!, alongX = Math.abs(Math.sin(c.yaw)) < 0.5;
      const sd = bl.sides.find(q => q.alongX === alongX && Math.abs(q.plane - (alongX ? c.z : c.x)) < 0.01)!;
      expect(sd, `${tag}: the host facade the tube meets`).toBeTruthy();
      const r = connectorRect(c), lo = (alongX ? r.x0 : r.z0) - CONNECTOR_FACADE.margin, hi = (alongX ? r.x1 : r.z1) + CONNECTOR_FACADE.margin;
      const top = c.y + CONNECTOR.crownH + CONNECTOR_FACADE.above;
      const over = (o: {side: string; s0: number; s1: number}, y0: number) => o.side === sd.side && o.s1 > lo && o.s0 < hi && y0 < top;
      expect(bl.holes.filter(h => over(h, h.y0)), `${tag}: openings`).toEqual([]);
      expect(bl.signs.filter(h => over(h, h.y0)), `${tag}: signs`).toEqual([]);
      expect(bl.escapes.filter(e => e.side === sd.side && e.s > lo - 0.6 && e.s < hi + 0.6), `${tag}: fire escapes`).toEqual([]);
      expect(bl.detail.blinds.filter(h => over(h, h.y0)), `${tag}: blinds`).toEqual([]);
      expect(bl.detail.awnings.filter(h => over(h, h.y - h.drop)), `${tag}: awnings`).toEqual([]);
      expect(bl.detail.relief.filter(h => over(h, h.y0)), `${tag}: relief`).toEqual([]);
    }
  });
});

describe('connector office: the version-1 way out, keyed at the lift era', () => {
  const SEEDS = [OFFICE, 6, 15, 17];
  it('every prop and pickup stands where version 1 puts it; the moved pieces keep their lift-era holder keys', () => {
    for (const seed of SEEDS) {
      const M = gen('office', seed, 'main'), V = gen('office', seed, 'main', 1);
      expect(M.props.length).toBe(V.props.length);
      M.props.forEach((p, i) => expect([p.kind, p.x, p.z, p.y], `${seed} prop ${i}`).toEqual([V.props[i].kind, V.props[i].x, V.props[i].z, V.props[i].y]));
      expect(M.pickups.map(k => [k.itemId, k.x, k.y, k.z])).toEqual(V.pickups.map(k => [k.itemId, k.x, k.y, k.z]));
      const moved = M.props.filter(p => p.memAt);
      expect(moved.length, `${seed}: barricade pieces moved`).toBeGreaterThan(0);
      for (const p of moved) {
        expect(['crate', 'cartonStack', 'wetFloorSign']).toContain(p.kind);
        expect(propHolderKey(p.kind, p)).not.toBe(propHolderKey(p.kind, {level: p.level, x: p.x, z: p.z}));
        expect(Math.hypot(p.x - p.memAt!.x, p.z - p.memAt!.z), `${seed}: moved aside`).toBeLessThan(4);
      }
      // (no moved piece's key is any other placement's: the lift-era keys, tests/surface-connector-pins.test.ts pins them all)
      const keys = M.props.map(p => propHolderKey(p.kind, p));
      for (const p of moved) expect(keys.filter(k => k === propHolderKey(p.kind, p)).length, `${seed} ${p.kind}`).toBe(1);
    }
  }, 300000);

  it('a remembered loose item on a moved piece goes with it, once; nothing else moves; other layouts write nothing', () => {
    const piece = {x: 12, z: 5, y: 0, h: 0.8, hx: 0.4, hz: 0.3, memAt: {x: 10, z: 5}};
    const rec = (x: number, y: number, z: number): PickupRecord => ({stack: {itemId: 'water', count: 1}, pose: {p: [x, y + 0.02, z], q: [0, 0, 0, 1]}, anchor: [x, y, z]});
    const mem = createMemory({level: 'office', section: 'main'});
    mem.pickups = [rec(10.1, 0.82, 5.1), rec(10.1, 0, 5.1), rec(14, 0.82, 5), rec(10.1, 2.0, 5.1)];
    expect(rebaseMovedPieceItems(mem, [piece, {x: 1, z: 1, y: 0, h: 1, hx: 0.5, hz: 0.5}])).toBe(1);
    expect(mem.pickups[0].anchor).toEqual([12.1, 0.82, 5.1]);
    expect(mem.pickups[0].pose.p).toEqual([12.1, 0.84, 5.1]);
    expect(mem.pickups.slice(1).map(r => r.anchor)).toEqual([[10.1, 0, 5.1], [14, 0.82, 5], [10.1, 2.0, 5.1]]);
    expect(mem.lanes[MOVED_PIECES_LANE]).toBe(true);
    expect(rebaseMovedPieceItems(mem, [piece]), 'once').toBe(0);
    expect(mem.pickups[0].anchor).toEqual([12.1, 0.82, 5.1]);
    const other = createMemory({level: 'office', section: 'main'});
    other.pickups = [rec(10.1, 0.82, 5.1)];
    expect(rebaseMovedPieceItems(other, [{...piece, memAt: undefined}])).toBe(0);
    expect(other.lanes).toEqual({});
  });

  it('the boarding has an open doorway at the record (boarding beside it); the street ground is open under the tube', () => {
    const M = gen('office', OFFICE, 'main'), c = M.surfaceAccess!.connector!;
    const info = readTowerInfo(M)!, ent = info.windows.find(w => w.doorway)!;
    expect(ent.kind).toBe('entrance');
    const along = Math.abs(Math.sin(c.yaw)) < 0.5 ? 'x' : 'z', mid = along === 'x' ? c.x : c.z;
    expect(ent.doorway).toEqual({a0: mid - c.door.width / 2, a1: mid + c.door.width / 2, y1: c.y + c.door.height});
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const view = buildWindows(planWindows(info), mats, null);
    view.root.updateMatrixWorld(true);
    const meshes: THREE.Object3D[] = [];
    view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
    const ray = new THREE.Raycaster();
    const [fx, fz] = [-Math.sin(c.yaw), -Math.cos(c.yaw)];
    const shoot = (t: number, dy: number) => {
      const [x, z] = connectorToWorld(c, -c.door.depth - 0.6, t);
      ray.set(new THREE.Vector3(x, c.y + dy, z), new THREE.Vector3(fx, 0, fz));
      ray.far = c.door.depth + 1.2;
      return ray.intersectObjects(meshes, false).length;
    };
    const W = c.door.width / 2 - 0.08;
    for (const t of [-W, 0, W]) for (const dy of [0.05, 0.5, 1.0, 1.6, c.door.height - 0.08]) expect(shoot(t, dy), `doorway t ${t} +${dy}`).toBe(0);
    let beside = 0;
    for (let dy = 0.2; dy < 2.0; dy += 0.1) beside += shoot(c.door.width / 2 + 0.3, dy) + shoot(-c.door.width / 2 - 0.3, dy);
    expect(beside, 'the boarding beside it').toBeGreaterThan(4);
    // the street: no ground under the tube's clear width, no street prop near it
    const tube = officeConnectorTube(M)!;
    expect(info.tube).toEqual(tube);
    const plan = planExterior({foot: info.exterior, groundY: info.groundY, eyeAbove: 30, seed: info.seed, cuts: [tube]});
    for (const p of plan.props) expect(p.x < tube.x0 - 1.5 || p.x > tube.x1 + 1.5 || p.z < tube.z0 - 1.5 || p.z > tube.z1 + 1.5, `${p.kind} at ${p.x},${p.z}`).toBe(true);
    const ext = buildExterior(plan);
    const ground = ext.root.getObjectByName('tower-ext-ground') as THREE.Mesh;
    const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    ext.root.updateMatrixWorld(true);
    const hitAt = (s: number, t: number) => { const [x, z] = connectorToWorld(c, s, t); down.set(new THREE.Vector3(x, c.y + 1, z), new THREE.Vector3(0, -1, 0)); return down.intersectObject(ground, false).length; };
    for (const s of [0.3, c.len / 2, c.len - 0.3]) for (const t of [-0.9, 0, 0.9]) expect(hitAt(s, t), `ground under the tube ${s},${t}`).toBe(0);
    expect(hitAt(c.len / 2, CONNECTOR.width / 2 + 0.3), 'the street beside it').toBeGreaterThan(0);
  });
});

describe('connector mall: the walk span is open', () => {
  it('no leaf or mullion in the walk span, nothing on the street in the tube’s reach', () => {
    const M = gen('mall', MALL, 'main'), c = M.surfaceAccess!.connector!;
    const s = streetExitSpecs(M, () => NaN).find(q => q.usable)!;
    expect(s.connector).toEqual({width: c.door.width, len: c.len, half: CONNECTOR.width / 2 + CONNECTOR.ring, clear: CONNECTOR.width / 2});
    expect(c.door.width).toBeGreaterThanOrEqual(1);
    expect(c.door.collar).toBeGreaterThanOrEqual(c.door.width);
    const v = buildStreetExit(s);
    for (const m of v.meshes) m.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const [fx, fz] = [-Math.sin(c.yaw), -Math.cos(c.yaw)];
    const shoot = (t: number, dy: number, far: number) => {
      const [x, z] = connectorToWorld(c, -c.door.depth - 0.6, t);
      ray.set(new THREE.Vector3(x, c.y + dy, z), new THREE.Vector3(fx, 0, fz));
      ray.far = far;
      return ray.intersectObjects(v.meshes, false).map(h => `${h.object.name}@${h.distance.toFixed(2)}`);
    };
    const W = c.door.width / 2 - 0.08;
    for (const t of [-W, 0, W]) for (const dy of [0.3, 1.0, 1.7]) expect(shoot(t, dy, c.door.depth + 0.6 + c.len), `walk span t ${t} +${dy}`).toEqual([]);
    expect(v.frame).toBeTruthy();
    expect(exitFrame(s).origin.distanceTo(v.frame.origin)).toBeLessThan(1e-6);
  });
});
