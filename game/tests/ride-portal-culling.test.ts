// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead): the level culler's EYE STAND-IN (world/levelCulling.ts
// LevelCuller.eyeProxy) and the ride portals' stand-in point (world/ridePortal.ts portalEye). An eye riding in the ride tunnel is
// beyond the station's grid — in rock, or in rooms the tunnel is drawn through — where the culler's position rules (its storey, slab
// and same-storey occlusion) would hide the station the rider still sees behind them through the portal's opening. With the stand-in
// the station is decided from the opening; the camera's own frustum still applies. Small synthetic two-storey plan, no models.
//
// Plan (cells 0.5 m; storey 0 at y 0, 4 m ceilings; storey 1 at y 5): storey 0 has a "bed" corridor (x 0..30 m, z 0..4 m) with a room
// (x 10..20, z 6..16) behind a wall with a doorway (x 14..16); storey 1 has a gallery over the corridor. East of x = 30 everything is
// rock on both storeys: the ride tunnel runs there (portal plane x = 30, out +1), except a back room (x 36..44, z 0..4, storey 0) that
// the tunnel is drawn through.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, Grid} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import {CULL_LAYER, LevelCuller} from '../src/world/levelCulling';
import {LevelColumns} from '../src/world/levelGeometry';
import {PORTAL_EYE, RIDE_BOX, portalEye, type RidePortal} from '../src/world/ridePortal';

const W = 100, H = 44;
type Rect = [number, number, number, number];
function storey(base: number, open: Rect[]): Grid {
  const g = new Grid(W, H);
  for (const r of open) for (let cy = Math.round(r[1] / CELL); cy < Math.round(r[3] / CELL); cy++) for (let cx = Math.round(r[0] / CELL); cx < Math.round(r[2] / CELL); cx++) {
    g.set(cx, cy, FLOOR); const i = g.idx(cx, cy); g.floor[i] = base; g.ceil[i] = base + 4;
  }
  return g;
}
function plan(): {levels: Level[]; cols: LevelColumns} {
  const g0 = storey(0, [[0, 0, 30, 4], [14, 4, 16, 6], [10, 6, 20, 16], [36, 0, 44, 4]]);
  const g1 = storey(5, [[0, 0, 30, 4]]);
  const levels: Level[] = [{id: 0, role: 'main', grid: g0, baseY: 0} as Level, {id: 1, role: 'upper', grid: g1, baseY: 5} as unknown as Level];
  return {levels, cols: new LevelColumns(levels)};
}
const levelAt = (_x: number, y: number) => (y >= 4.7 ? 1 : 0);

function box(root: THREE.Group, x: number, y: number, z: number, level: number, name: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  m.position.set(x, y + 0.5, z);
  m.name = name;
  m.userData.level = level;
  root.add(m);
  return m;
}
function cam(x: number, y: number, z: number, lx: number, ly: number, lz: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  c.position.set(x, y, z);
  c.lookAt(lx, ly, lz);
  c.updateMatrixWorld(true);
  return c;
}
const CULLED = new THREE.Layers();
CULLED.set(CULL_LAYER);
const culled = (m: THREE.Mesh) => m.layers.mask === CULLED.mask;

/** The portal of this plan: the bed's east end face (x = 30), the ride-box opening around the track at z = 2. */
const PORTAL: Pick<RidePortal, 'x' | 'out' | 'opening'> = {x: 30, out: 1, opening: {z0: 2 - RIDE_BOX.half, z1: 2 + RIDE_BOX.half, y0: 0, y1: RIDE_BOX.ceil}};

function scene(mall: boolean) {
  const {levels, cols} = plan();
  const root = new THREE.Group();
  const meshes = {
    bedNear: box(root, 26, 0, 2, 0, 'bed-near'),
    bedFar: box(root, 6, 0, 2, 0, 'bed-far'),
    room: box(root, 15, 0, 12, 0, 'room'), // behind the wall, in line with the doorway
    corner: box(root, 10.6, 0, 6.6, 0, 'room-corner'), // tucked behind the wall west of the doorway
    gallery: box(root, 20, 5, 2, 1, 'gallery-1'),
  };
  root.updateMatrixWorld(true);
  const culler = new LevelCuller(levels, cols, levelAt, mall ? {slabs: {see: []}} : undefined);
  culler.register(root);
  culler.maxDistance = 200;
  return {culler, meshes, all: Object.values(meshes)};
}
const state = (all: THREE.Mesh[]) => all.map(m => `${m.name}:${culled(m) ? 'hidden' : 'shown'}`).join(' ');

describe('portalEye: the stand-in point of an eye beyond a portal plane', () => {
  it('leaves an eye on the station side alone; beyond the plane: the nearest point of the opening, a step on the station side', () => {
    const e = {x: 29.9, y: 1.7, z: 2.4};
    expect(portalEye(PORTAL, e)).toBe(false);
    expect(e).toEqual({x: 29.9, y: 1.7, z: 2.4});
    const d = {x: 55, y: 1.7, z: 2.4};
    expect(portalEye(PORTAL, d)).toBe(true);
    expect(d).toEqual({x: 30 - PORTAL_EYE.back, y: 1.7, z: 2.4});
    // an eye off the opening's rectangle (a tilted car, a jostle) is clamped inside it
    const k = {x: 31, y: 9, z: -3};
    portalEye(PORTAL, k);
    expect(k.y).toBeCloseTo(RIDE_BOX.ceil - PORTAL_EYE.inset, 9);
    expect(k.z).toBeCloseTo(2 - RIDE_BOX.half + PORTAL_EYE.inset, 9);
    // the other direction (out -1): the plane's other side is the tunnel
    const w = {x: 10, y: 1.5, z: 2};
    expect(portalEye({...PORTAL, out: -1}, w)).toBe(true);
    expect(w.x).toBeCloseTo(30 + PORTAL_EYE.back, 9);
    expect(portalEye({...PORTAL, out: -1}, {x: 31, y: 1.5, z: 2})).toBe(false);
  });
});

describe('LevelCuller.eyeProxy: an eye in the ride tunnel decides the station from the portal\'s opening', () => {
  for (const mall of [false, true]) {
    it(`${mall ? 'occlusion-culled level (mall rules)' : 'plain level rule'}: with the stand-in, the decision equals the one made at the opening with the same view`, () => {
      // looking back at the station from 3 m, 20 m and 50 m inside the tunnel (in rock), and from inside the back room it is drawn through
      for (const ex of [33, 40, 50, 80]) {
        const A = scene(mall), B = scene(mall);
        A.culler.eyeProxy = e => { portalEye(PORTAL, e); };
        A.culler.update(cam(ex, 1.7, 2.3, 0, 1.4, 2.3), true);
        // the reference: a camera AT the stand-in point with the same orientation
        const ref = cam(ex, 1.7, 2.3, 0, 1.4, 2.3);
        const p = {x: ex, y: 1.7, z: 2.3};
        portalEye(PORTAL, p);
        ref.position.set(p.x, p.y, p.z);
        ref.updateMatrixWorld(true);
        B.culler.update(ref, true);
        expect(state(A.all), `eye x ${ex}`).toBe(state(B.all));
        // what the rider sees through the opening stays drawn; what the wall hides from the bed is still decided as from the bed
        expect(culled(A.meshes.bedNear), `eye x ${ex}`).toBe(false);
        expect(culled(A.meshes.bedFar), `eye x ${ex}`).toBe(false);
        if (mall) expect(culled(A.meshes.corner), `eye x ${ex}`).toBe(true);
      }
    });
  }

  it('why it is needed: without the stand-in the occlusion rules hide the station bed from an eye in the rock behind its end face', () => {
    const {culler, meshes} = scene(true);
    culler.update(cam(40, 1.7, 2.3, 0, 1.4, 2.3), true);
    const hiddenWithout = [meshes.bedNear, meshes.bedFar].filter(culled).length;
    culler.eyeProxy = e => { portalEye(PORTAL, e); };
    culler.update(cam(40, 1.7, 2.3, 0, 1.4, 2.3), true);
    expect([meshes.bedNear, meshes.bedFar].filter(culled).length).toBe(0);
    expect(hiddenWithout).toBeGreaterThan(0);
  });

  it('null stand-in, or an eye on the station side: exactly the plain decision (nothing changes outside a ride)', () => {
    const poses: [number, number, number, number, number, number][] = [[2, 1.62, 2, 30, 1.2, 8], [15, 1.62, 2, 15, 1.0, 12], [25, 1.62, 2, 0, 1.2, 2]];
    for (const mall of [false, true]) for (const c of poses) {
      const A = scene(mall), B = scene(mall);
      A.culler.eyeProxy = e => { portalEye(PORTAL, e); };
      A.culler.update(cam(...c), true);
      B.culler.update(cam(...c), true);
      expect(state(A.all)).toBe(state(B.all));
      expect(A.culler.stats.culled).toBe(B.culler.stats.culled);
    }
  });

  it('the stand-in is asked on every update, so a still eye beyond the plane skips the re-decision like any still eye', () => {
    const {culler, meshes} = scene(true);
    let calls = 0;
    culler.eyeProxy = e => { calls++; portalEye(PORTAL, e); };
    culler.update(cam(40, 1.7, 2.3, 0, 1.4, 2.3), true);
    const before = state(Object.values(meshes));
    // deeper into the tunnel, same view: the stand-in point does not move, the decision stands
    culler.update(cam(48, 1.7, 2.3, 8, 1.4, 2.3));
    expect(calls).toBe(2);
    expect(state(Object.values(meshes))).toBe(before);
  });
});
