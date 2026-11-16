// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the truck's FIRST-PERSON driving position — the handmade cab
// (world/surface/truckCab.ts) on the measured anchors: the seated eye over the seat's H-point, the eye inside the cab's free box with
// every cab part well beyond the camera's near plane; the steering wheel in front of the eye within reach, below it and under the sight
// line to the windscreen's base (the road stays in view), and IN the forward view with the dash; the windscreen fills the view ahead;
// the dash / binnacle / door cards clear of the glazing; the passenger seat mirrored; a few hundred triangles in a handful of meshes,
// none casting shadows; the steering wheel turns about its own axis.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {buildTruckCab, truckCabLayout, type CabBox} from '../src/world/surface/truckCab';

const A = TRUCK_ANCHORS, E = A.eye, L = truckCabLayout();
const box = (n: string): CabBox => { const b = L.boxes.find(x => x.name === n); if (!b) throw new Error(n); return b; };
/** The eye -> windscreen-base sight line's height at truck-frame z (in front of the eye). */
const sightY = (z: number) => E.y + (A.cowl.y - E.y) * ((z - E.z) / (A.cowl.z - E.z));
const distToBox = (p: {x: number; y: number; z: number}, b: CabBox) => Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1), Math.max(b.z0 - p.z, 0, p.z - b.z1));

/** The game's first-person camera at the seated eye looking straight ahead (nose -Z), its default 75° vertical field of view. */
function eyeCamera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  c.position.set(E.x, E.y, E.z);
  c.lookAt(E.x, E.y, E.z - 1);
  c.updateMatrixWorld(true);
  return c;
}
const inView = (c: THREE.Camera, p: THREE.Vector3) => { const q = p.clone().project(c); return Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z > -1 && q.z < 1; };

describe('surface truck cab: the driving position', () => {
  it('the seated eye over the seat (H-point 0.74 m under the eye, the cushion over the cab floor), inside the cab\'s free box', () => {
    expect(A.seat.x).toBe(E.x);
    expect(E.y - A.seat.y).toBeCloseTo(0.74, 6);
    expect(A.seat.z - E.z).toBeCloseTo(0.1, 6);
    expect(A.seat.y - L.floorY).toBeCloseTo(0.36, 6); // (a truck seat's H-point over the floor)
    expect(box('seat-driver-cushion').y1).toBeLessThan(E.y - 0.6);
    const C = A.clear;
    expect(E.x > C.x0 && E.x < C.x1 && E.y > C.y0 && E.y < C.y1 && E.z > C.z0 && E.z < C.z1).toBe(true);
    expect(E.y + 0.12).toBeLessThan(A.interior.y1); // (headroom under the roof)
    expect(E.x).toBeLessThan(0); // (the driver's LEFT seat)
  });

  it('every cab part is well beyond the camera\'s near plane (nothing clips the view)', () => {
    for (const b of L.boxes) expect(distToBox(E, b), b.name).toBeGreaterThan(0.2);
    const W = L.wheel;
    expect(Math.hypot(W.x - E.x, W.y - E.y, W.z - E.z) - W.r).toBeGreaterThan(0.2);
  });

  it('the steering wheel: ahead of the eye within reach, below it, its rim under the sight line to the windscreen base; in the forward view with the dash', () => {
    const W = L.wheel, d = Math.hypot(W.x - E.x, W.y - E.y, W.z - E.z);
    expect(W.x).toBe(E.x);
    expect(W.z).toBeLessThan(E.z);
    expect(d).toBeGreaterThan(0.45);
    expect(d).toBeLessThan(0.75);
    // the rim's top: the hub + r along the wheel plane's in-plane up direction (perpendicular to its normal, up and forward)
    const n = new THREE.Vector3(...W.normal), up = new THREE.Vector3(0, n.z, -n.y);
    expect(up.y).toBeGreaterThan(0);
    const top = new THREE.Vector3(W.x, W.y, W.z).addScaledVector(up, W.r);
    expect(top.y).toBeLessThan(E.y);
    expect(top.y).toBeLessThan(sightY(top.z)); // (the road over the wheel stays in view)
    const cam = eyeCamera();
    expect(inView(cam, top)).toBe(true); // (the wheel's rim in the first-person view)
    const dash = box('dash'), binn = box('binnacle');
    expect(inView(cam, new THREE.Vector3(E.x + 0.3, dash.y1, dash.z0))).toBe(true);
    expect(inView(cam, new THREE.Vector3(E.x, binn.y1, binn.z1))).toBe(true);
    // the windscreen ahead: the driver's pane whole (its corners), the passenger's pane from its inner edge (its far side is peripheral)
    const wl = A.glass.find(x => x.name === 'windscreen-left')!, wr = A.glass.find(x => x.name === 'windscreen-right')!;
    for (const [x, y] of [[wl.x0, wl.y0], [wl.x1, wl.y0], [wl.x0, wl.y1], [wl.x1, wl.y1]]) expect(inView(cam, new THREE.Vector3(x, y, (wl.z0 + wl.z1) / 2)), `left ${x}, ${y}`).toBe(true);
    for (const y of [wr.y0, wr.y1]) expect(inView(cam, new THREE.Vector3(wr.x0 + 0.2, y, (wr.z0 + wr.z1) / 2)), `right ${y}`).toBe(true);
    // the road ahead: the ground 8 m in front of the nose is seen over the cowl
    const ground = new THREE.Vector3(E.x, 0, -A.length / 2 - 8);
    expect(inView(cam, ground)).toBe(true);
    expect(E.y + (ground.z - E.z) * ((A.cowl.y - E.y) / (A.cowl.z - E.z))).toBeLessThan(ground.y); // (seen over the cowl: the sight line past it meets the road nearer)
  });

  it('the dash and binnacle stay under the eye\'s sight line to the windscreen base; the door cards under the side windows\' sills', () => {
    for (const n of ['dash', 'binnacle', 'toe-board', 'centre-stack', 'gear-lever', 'gear-knob']) {
      const b = box(n);
      expect(b.y1, n).toBeLessThan(sightY(b.z0)); // (the far top edge: the highest the sight line has to clear)
    }
    const sill = Math.min(...A.glass.filter(g => !g.name.startsWith('windscreen')).map(g => g.y0));
    for (const n of ['door-card-left', 'door-card-right']) expect(box(n).y1, n).toBeLessThan(sill);
    expect(box('dash').z0).toBeGreaterThanOrEqual(A.interior.z0);
  });

  it('the passenger seat mirrors the driver\'s about the windscreen\'s middle; the bed floor at the opened rear\'s sill', () => {
    const d = box('seat-driver-cushion'), p = box('seat-passenger-cushion');
    expect((d.x0 + d.x1) / 2 + (p.x0 + p.x1) / 2).toBeCloseTo(2 * L.cabCx, 6);
    expect([p.y0, p.y1, p.z0, p.z1]).toEqual([d.y0, d.y1, d.z0, d.z1]);
    expect(box('bed-floor').y1).toBeCloseTo(A.bed.y0 + 0.015, 6);
  });

  it('built: a handful of merged meshes (a few hundred triangles), none casting shadows; the steering wheel turns about its own axis', () => {
    const cab = buildTruckCab();
    const meshes: THREE.Mesh[] = [];
    cab.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeLessThanOrEqual(13);
    const tris = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);
    expect(tris).toBeLessThan(3000);
    for (const m of meshes) { expect(m.castShadow).toBe(false); expect(m.userData.carPart).toBe('cockpit'); }
    cab.group.updateMatrixWorld(true);
    const spoke = cab.group.getObjectByName('surface-truck-steering-spoke')!, hub = new THREE.Vector3(L.wheel.x, L.wheel.y, L.wheel.z);
    const end = () => { cab.group.updateMatrixWorld(true); return new THREE.Vector3(L.wheel.r, 0, 0).applyMatrix4(spoke.matrixWorld); };
    const n = new THREE.Vector3(...L.wheel.normal), e0 = end();
    cab.wheel.rotation.z = 1.2;
    const e1 = end();
    expect(e0.distanceTo(e1)).toBeGreaterThan(0.1);
    expect(e1.distanceTo(hub)).toBeCloseTo(e0.distanceTo(hub), 6);
    expect(e1.clone().sub(hub).dot(n)).toBeCloseTo(0, 6); // (in the wheel's plane)
    expect(e0.clone().sub(hub).dot(n)).toBeCloseTo(0, 6);
  });
});
