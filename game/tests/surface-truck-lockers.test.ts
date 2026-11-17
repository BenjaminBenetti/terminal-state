// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK, follow-up 1; lead: "Compartments as openable: the two lockers should visibly
// open (a door / lid swings in the openables style while the storage view is open, closes after) and be classified (OPENABLE_AUDIT /
// physics classification entries with honest reasons: part of the vehicle, contents player-stored, start empty — no seeded loot needed)"):
//  - every storage compartment (registry-driven: TRUCK_COMPARTMENTS) has a hinged DOOR on its side of the truck's view, shut at rest, over
//    its measured face (world/surface/truckModel.ts TruckLockerDoor);
//  - [E] on a compartment opens its view and its door swings OUT (eased, not snapped) to the open angle, the other door stays shut; the
//    view closed, it swings shut again;
//  - classified: one 'openable' storage row per compartment (world/openablesSpec.ts VEHICLE_OPEN_AUDIT) and a physics row for the body
//    and each compartment (damage/physicsAudit.ts VEHICLE_PHYSICS_AUDIT) with the honest reasons; none of them is a prop kind (the prop
//    audits stay exactly the catalogue's), and an unclassified compartment fails here.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {PROP_DEFS} from '../src/gen/props';
import {OPENABLE_AUDIT, VEHICLE_OPEN_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT, VEHICLE_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {TRUCK_FIXED_PARTS, truckAuditKind} from '../src/world/surface/truckAudit';
import {TRUCK_LOCKER_DOOR, type TruckView} from '../src/world/surface/truckModel';
import {TRUCK_COMPARTMENT_BOXES, TRUCK_STORAGE_TEXT} from '../src/world/surface/truckStorage';
import {TRUCK_COMPARTMENTS} from '../src/world/surface/truckStore';
import type {SkywaysCar} from '../src/world/skywaysCar';
import {frame, lookAt, press, run, type CarTestHost} from './helpers/skywaysCarHost';
import {truckHost} from './helpers/surfaceTruckHost';

/** Stand beside compartment i (outside its face), look at its door (tests/surface-truck-storage.test.ts standBy). */
function standBy(h: CarTestHost, car: SkywaysCar, i: number, out = 0.6): void {
  const b = car.body!, c = TRUCK_COMPARTMENT_BOXES[i], zc = (c.z0 + c.z1) / 2;
  const at = carToWorld(b.x, b.z, b.yaw, c.faceX + c.side * out, zc), face = carToWorld(b.x, b.z, b.yaw, c.faceX, zc);
  h.player.place(at.x, at.z, 0, b.y);
  frame(h, car);
  lookAt(h, face.x, b.y + (c.y0 + c.y1) / 2, face.z);
  frame(h, car);
}

/** The door's free (unhinged) edge in the truck's frame now. */
function freeEdge(v: TruckView, i: number): THREE.Vector3 {
  const d = v.lockers[i], c = TRUCK_ANCHORS.storage[i];
  d.pivot.updateMatrix();
  return new THREE.Vector3(0, 0, c.z1 - c.z0 + 2 * TRUCK_LOCKER_DOOR.lap).applyMatrix4(d.pivot.matrix);
}

describe('the truck compartments open like the openables', () => {
  it('every compartment has a hinged door on its side of the view, shut over its measured face at rest', () => {
    const {car} = truckHost({storage: true});
    const v = car.view as TruckView;
    expect(v.lockers.map(d => d.id)).toEqual(TRUCK_COMPARTMENTS.map(c => c.id));
    v.lockers.forEach((d, i) => {
      const c = TRUCK_ANCHORS.storage[i];
      expect([d.open, d.pivot.rotation.y, d.side]).toEqual([0, 0, c.side]);
      expect(d.pivot.parent).toBe(v.group);
      const door = d.pivot.children.find(m => m.name.endsWith('-door')) as THREE.Mesh;
      expect(door, c.id).toBeTruthy();
      // proud of the outer face (never inside the body), the hinge at the compartment's front edge, the free edge at its back edge
      expect(d.pivot.position.x * c.side).toBeGreaterThan(Math.abs(c.faceX));
      expect(d.pivot.position.x * c.side).toBeLessThan(Math.abs(c.faceX) + 0.05);
      expect(d.pivot.position.z).toBeCloseTo(c.z0 - TRUCK_LOCKER_DOOR.lap, 6);
      expect(freeEdge(v, i).z).toBeCloseTo(c.z1 + TRUCK_LOCKER_DOOR.lap, 6);
      expect(door.scale.y).toBeCloseTo(c.y1 - c.y0 + 2 * TRUCK_LOCKER_DOOR.lap, 6);
    });
  });

  it('[E] opens the view and its door swings OUT (eased) while the other stays shut; closed, it swings shut again', () => {
    for (let i = 0; i < TRUCK_COMPARTMENTS.length; i++) {
      const {h, car, storage} = truckHost({storage: true});
      const v = car.view as TruckView, d = v.lockers[i], c = TRUCK_ANCHORS.storage[i], other = v.lockers.filter((_, k) => k !== i);
      standBy(h, car, i);
      expect(car.prompt).toBe(TRUCK_STORAGE_TEXT.open(TRUCK_COMPARTMENTS[i].name));
      press(h, car, 'KeyE');
      expect(storage!.openId).toBe(c.id);
      // a swing, not a snap: part-way after a few frames
      run(h, car, 0.1);
      expect(d.open).toBeGreaterThan(0.15);
      expect(d.open).toBeLessThan(0.6);
      run(h, car, 0.5);
      expect(d.open).toBe(1);
      expect(d.pivot.rotation.y).toBeCloseTo(c.side * TRUCK_LOCKER_DOOR.angle, 9);
      // the free edge out from the body's side by about the door's width, swung past square to it (ahead of the hinge)
      expect(freeEdge(v, i).x * c.side).toBeGreaterThan(Math.abs(c.faceX) + 0.9 * (c.z1 - c.z0));
      expect(freeEdge(v, i).z).toBeLessThan(c.z0);
      for (const o of other) expect([o.open, o.pivot.rotation.y]).toEqual([0, 0]);
      storage!.close('user');
      run(h, car, 0.1);
      expect(d.open).toBeGreaterThan(0.4);
      expect(d.open).toBeLessThan(0.85);
      run(h, car, 0.5);
      expect([d.open, d.pivot.rotation.y]).toEqual([0, 0]);
      expect(freeEdge(v, i).x * c.side).toBeLessThan(Math.abs(c.faceX) + 0.05);
    }
  });

  it('classified with honest reasons: openable player storage, part of the vehicle, starting empty; static built-in parts of a too-heavy body', () => {
    // registry-driven: every compartment present now and later has its rows
    // (re-pin, field follow-up: the fixed non-storage parts — the map board — follow the compartments; tests/surface-truck-board.test.ts)
    const parts = TRUCK_FIXED_PARTS.map(p => truckAuditKind(p.id));
    expect(VEHICLE_OPEN_AUDIT.map(r => r.kind)).toEqual([...TRUCK_COMPARTMENTS.map(c => truckAuditKind(c.id)), ...parts]);
    for (const r of VEHICLE_OPEN_AUDIT.filter(e => !parts.includes(e.kind))) {
      expect([r.cls, r.role], r.kind).toEqual(['openable', 'storage']);
      expect(r.how, r.kind).toMatch(/part of the vehicle/);
      expect(r.how, r.kind).toMatch(/door swings out/);
      expect(r.how, r.kind).toMatch(/player's own/);
      expect(r.how, r.kind).toMatch(/starts EMPTY/);
      expect(r.how, r.kind).toMatch(/no loot table/);
    }
    expect(VEHICLE_PHYSICS_AUDIT.map(r => r.kind)).toEqual([truckAuditKind(), ...TRUCK_COMPARTMENTS.map(c => truckAuditKind(c.id)), ...parts]);
    const [body, ...rest] = VEHICLE_PHYSICS_AUDIT;
    expect([body.cls, body.why, body.src]).toEqual(['static', 'too heavy', 'surface']);
    expect(body.how).toMatch(/bullets stop on its body/);
    for (const p of rest) {
      expect([p.cls, p.why], p.kind).toEqual(['static', 'built-in']);
      expect(p.how, p.kind).toMatch(/never detaching/);
    }
    // a vehicle, not a prop kind: the prop audits stay exactly the catalogue's (tests/openables.test.ts, tests/office-physics.test.ts)
    for (const r of [...VEHICLE_OPEN_AUDIT, ...VEHICLE_PHYSICS_AUDIT]) {
      expect(r.kind in PROP_DEFS, r.kind).toBe(false);
      expect(OPENABLE_AUDIT.some(e => e.kind === r.kind), r.kind).toBe(false);
      expect(r.kind in PROP_PHYSICS_AUDIT, r.kind).toBe(false);
    }
  });
});
