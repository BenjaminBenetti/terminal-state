// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE PLANNING MAP ON THE TRUCK'S SIDE (world/surface/truckBoard.ts;
// user: "Put the usable planning map on the SIDE OF THE TRUCK, physically visible and accessible on foot during exploration. Keep real
// roads/destinations, explored blocks and player/truck markers tied to actual state. It must not remain usable only at the tent table."):
//  - physical: a panel on two rails and the map sheet on the bed's right side, outside the bed's cargo space, clear of the compartment
//    doors and the cab doors, facing out; part of the truck's view (it moves with it);
//  - usable on foot: [E] aimed at it from beside the truck's right side opens the SAME planning map as the tent table (the map runtime's
//    open()), through the controller's one [E] handler; refused seated, from the other side, far off, outside play, in a world without
//    the truck;
//  - tied to actual state: the sheet draws the map runtime's live model (a real generated district's streets / destinations, explored
//    blocks, YOU / TRUCK markers) and redraws when that changes, near the truck only;
//  - classified in the audits (not storage; a static built-in part of the vehicle); its shared resources released with the truck.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {PROP_DEFS} from '../src/gen/props';
import {OPENABLE_AUDIT, VEHICLE_OPEN_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT, VEHICLE_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {exploreGridFor} from '../src/world/surface/mapExplore';
import {buildPlanningMap, type PlanningMap} from '../src/world/surface/mapModel';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {TRUCK_FIXED_PARTS, truckAuditKind} from '../src/world/surface/truckAudit';
import {TRUCK_BOARD, TRUCK_BOARD_TEXT} from '../src/world/surface/truckBoard';
import type {TruckView} from '../src/world/surface/truckModel';
import {TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {TRUCK_COMPARTMENT_BOXES, TRUCK_STORAGE_TEXT} from '../src/world/surface/truckStorage';
import {build, frame, lookAt, press, run, teardown} from './helpers/skywaysCarHost';
import {getInTruck, setTruckLayout} from './helpers/surfaceTruckHost';
import {fieldHost, type FieldTestHost} from './helpers/surfaceTruckFieldHost';
import type {SkywaysCar} from '../src/world/skywaysCar';

installCanvasShim(false); // (the sheet's runtime canvas; no rasterising: structural)

const ZC = (TRUCK_BOARD.z0 + TRUCK_BOARD.z1) / 2, YC = (TRUCK_BOARD.y0 + TRUCK_BOARD.y1) / 2;

/** Stand `out` m off the truck's side (`side` +1 right / -1 left) at the board's z (+ `dz`), looking at the board's centre. */
function beside(h: FieldTestHost, car: SkywaysCar, out = 1.1, side = 1, dz = 0): void {
  const b = car.body!, x = side > 0 ? TRUCK_BOARD.face + out : -TRUCK_SPEC.width / 2 - out;
  const at = carToWorld(b.x, b.z, b.yaw, x, ZC + dz), c = carToWorld(b.x, b.z, b.yaw, TRUCK_BOARD.face, ZC);
  h.player.place(at.x, at.z, 0, b.y);
  frame(h, car);
  lookAt(h, c.x, b.y + YC, c.z);
  frame(h, car);
}

describe('the planning-map board: physical, on the truck\'s right side', () => {
  it('a panel on rails and the sheet facing out, outside the bed\'s cargo space, clear of the compartment doors and the cab doors', () => {
    const {car} = fieldHost();
    const v = car.view as TruckView;
    expect(v.board).not.toBeNull();
    const B = TRUCK_BOARD, g = v.board!.group, sheet = v.board!.sheet;
    expect(g.parent).toBe(v.group); // (part of the truck's view: it moves with the body)
    const n = new THREE.Vector3(0, 0, 1).applyEuler(sheet.rotation);
    expect(n.x).toBeCloseTo(1, 6); // (facing out of the right side)
    expect(sheet.position.x).toBeGreaterThan(B.face);
    const box = new THREE.Box3(); // (truck frame: the group sits at the view's origin)
    expect(g.position.length() + g.rotation.x + g.rotation.y + g.rotation.z).toBe(0);
    for (const m of g.children as THREE.Mesh[]) { m.updateMatrix(); m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrix)); }
    expect(box.min.x).toBeGreaterThanOrEqual(TRUCK_ANCHORS.bed.x1); // (never in the cargo space under the cover)
    expect(box.max.x).toBeLessThanOrEqual(TRUCK_SPEC.width / 2 + 0.1);
    expect(box.min.y).toBeGreaterThan(1.3);
    expect(box.max.y).toBeLessThan(2.45); // (at eye height for a standing player)
    for (const c of TRUCK_COMPARTMENT_BOXES) expect(c.z1 + 0.35 < box.min.z || c.z0 > box.max.z, c.name).toBe(true); // (a door's swing is clear)
    expect(box.min.z).toBeGreaterThan(Math.max(TRUCK_SPEC.exits.left.z, TRUCK_SPEC.exits.right.z) + 1); // (behind the cab doors)
    expect(box.max.z).toBeLessThan(TRUCK_SPEC.length / 2 - 0.5); // (ahead of the rear opening)
    expect(sheet.scale.x * sheet.scale.y).toBeCloseTo(B.sheet * B.sheet, 6);
  });

  it('[E] on it from beside the truck, on foot, opens the planning map (one action per press); the right locker keeps its own prompt', () => {
    const {h, car, map, storage, sys} = fieldHost();
    beside(h, car);
    expect(sys.board.standingBy()).toBe(true);
    expect(car.prompt).toBe(TRUCK_BOARD_TEXT.read);
    press(h, car, 'KeyE');
    expect(map.opens).toBe(1);
    expect(car.driving).toBe(false);
    expect(storage.isOpen).toBe(false);
    expect(sys.board.counts.opens).toBe(1);
    // the right locker (ahead of it on the same side) still opens itself
    const b = car.body!, c = TRUCK_COMPARTMENT_BOXES[1], zc = (c.z0 + c.z1) / 2;
    const at = carToWorld(b.x, b.z, b.yaw, c.faceX + 0.6, zc), face = carToWorld(b.x, b.z, b.yaw, c.faceX, zc);
    h.player.place(at.x, at.z, 0, b.y);
    frame(h, car);
    lookAt(h, face.x, b.y + (c.y0 + c.y1) / 2, face.z);
    frame(h, car);
    expect(car.prompt).toBe(TRUCK_STORAGE_TEXT.open('Right locker'));
  });

  it('refused: from the other side, far off, seated, outside play, without a map, in a world without the truck', () => {
    const {h, car, map, sys} = fieldHost();
    beside(h, car, 1.1, -1);
    expect(sys.board.aimed()).toBe(false);
    beside(h, car, 4);
    expect(sys.board.aimed()).toBe(false);
    expect(car.prompt).not.toBe(TRUCK_BOARD_TEXT.read);
    getInTruck(h, car);
    expect(sys.board.open()).toBe(false);
    press(h, car, 'KeyE'); // (seated, E gets out first)
    expect(car.driving).toBe(false);
    (h as {state: string}).state = 'paused';
    expect(sys.board.open()).toBe(false);
    (h as {state: string}).state = 'playing';
    expect(map.opens).toBe(0);
    teardown(h);
    setTruckLayout(h, null);
    build(h);
    expect(sys.board.open()).toBe(false);
    expect(sys.board.anchor()).toBeNull();
    expect(map.opens).toBe(0);
  });
});

describe('the planning-map board: tied to the actual state', () => {
  it('draws the map runtime\'s live model (a real district) near the truck, redraws when it changes, never far off', () => {
    const layout = LEVELS.subway.generate('surface', {levelSeed: 7}) as StationLayout;
    const s = layout.surface as SurfaceInfo;
    const grid = exploreGridFor(s.extent);
    let you = {x: s.portal.pose.x, z: s.portal.pose.z, yaw: 0};
    const model = (): PlanningMap => buildPlanningMap(s, {explore: grid, entered: new Set(), player: you, truck: {x: s.truck.x, z: s.truck.z, yaw: s.truck.yaw}});
    const m0 = model();
    expect(m0.markers.some(k => k.kind === 'destination')).toBe(true);
    let calls = 0;
    const {h, car, sys} = fieldHost({map: () => { calls++; return model(); }});
    beside(h, car);
    run(h, car, 0.1);
    expect(sys.board.counts.draws).toBe(1); // (the first frame near it: drawn)
    run(h, car, TRUCK_BOARD.redrawS * 2 + 0.1);
    expect(sys.board.counts.draws).toBe(1); // (nothing changed: not redrawn)
    expect(calls).toBeGreaterThanOrEqual(2); // (but looked at: the live model)
    you = {x: you.x + 40, z: you.z + 25, yaw: 1};
    run(h, car, TRUCK_BOARD.redrawS + 0.1);
    expect(sys.board.counts.draws).toBe(2); // (the YOU marker moved)
    // far off (the hall's farthest corner from the board): no work
    const a = sys.board.anchor()!;
    const corner = [[1.5, 1.5], [38.5, 1.5], [1.5, 28.5], [38.5, 28.5]].sort((p, q) => Math.hypot(q[0] - a.x, q[1] - a.z) - Math.hypot(p[0] - a.x, p[1] - a.z))[0];
    h.player.place(corner[0], corner[1], 0, 0);
    expect(Math.hypot(h.player.x - a.x, h.player.z - a.z)).toBeGreaterThan(TRUCK_BOARD.nearM);
    you = {x: you.x - 30, z: you.z, yaw: 2};
    const before = calls;
    run(h, car, TRUCK_BOARD.redrawS * 2 + 0.1);
    expect(sys.board.counts.draws).toBe(2);
    expect(calls).toBe(before);
    // a rebuild always redraws (the sheet is fresh)
    teardown(h);
    build(h);
    beside(h, car);
    run(h, car, 0.1);
    expect(sys.board.counts.draws).toBe(3);
  });
});

describe('the planning-map board: audits and resources', () => {
  it('classified: not storage (openables none / equipment), a static built-in part of the vehicle; not a prop kind', () => {
    for (const p of TRUCK_FIXED_PARTS) {
      const k = truckAuditKind(p.id);
      const o = VEHICLE_OPEN_AUDIT.filter(r => r.kind === k), ph = VEHICLE_PHYSICS_AUDIT.filter(r => r.kind === k);
      expect(o).toHaveLength(1);
      expect(ph).toHaveLength(1);
      expect([o[0].cls, o[0].role]).toEqual(['none', 'equipment']);
      expect(o[0].how).toMatch(/not storage/);
      expect([ph[0].cls, ph[0].why, ph[0].src]).toEqual(['static', 'built-in', 'surface']);
      expect(ph[0].how).toMatch(/never detaching/);
      expect(k in PROP_DEFS).toBe(false);
      expect(OPENABLE_AUDIT.some(e => e.kind === k)).toBe(false);
      expect(k in PROP_PHYSICS_AUDIT).toBe(false);
    }
    expect(TRUCK_FIXED_PARTS.map(p => p.id)).toEqual(['mapBoard']);
  });

  it('its shared material / texture go with the truck (a world without it) and come back with the next truck world', () => {
    const {h, car} = fieldHost();
    const mat = (car.view as TruckView).board!.sheet.material as THREE.Material;
    const tex = (mat as THREE.MeshStandardMaterial).map!;
    let gone = 0;
    mat.addEventListener('dispose', () => { gone++; });
    tex.addEventListener('dispose', () => { gone++; });
    teardown(h);
    build(h); // (the truck again: kept)
    expect(gone).toBe(0);
    expect((car.view as TruckView).board!.sheet.material).toBe(mat);
    teardown(h);
    setTruckLayout(h, null);
    build(h); // (a world without it: released)
    expect(gone).toBe(2);
    teardown(h);
    setTruckLayout(h, {x: 8, z: 15, yaw: -Math.PI / 2, level: 0, y: 0});
    build(h);
    expect((car.view as TruckView).board!.sheet.material).not.toBe(mat);
  });
});
