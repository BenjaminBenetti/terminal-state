// Task studio-alpha-reactor-ending-polish-20261104-034806-01 (primary; user: "surface exit door has the light in the middle of the sign
// (clipping)"): the exterior door's status lamp (world/reactor/endingViews.ts buildDoorView) stood over the lintel exactly where lane
// ENDING's SURFACE EXIT plate hangs (gen/reactor/surface.ts: door top + 0.55 m, 2 cm off the wall), so the box came through the plate's
// middle. The lamp is mounted on the yellow lintel's face now: the plate and the lamp never overlap, the lamp stays inside the lintel band.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {signDims} from '../src/gen/doorways';
import {buildDoorView, DOOR_VIEW} from '../src/world/reactor/endingViews';
import type {StationLayout} from '../src/gen/stationTypes';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);

describe('reactor exit door: the status lamp and the SURFACE EXIT plate are separately mounted (no clipping)', () => {
  for (const seed of [9100, 4242, 777]) {
    it(`seed ${seed}`, () => {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}) as StationLayout, s = L.reactor!.surface!, d = s.door;
      const sign = L.signs.find(q => q.kind === 'exit' && q.text === 'SURFACE EXIT')!;
      expect(sign).toBeTruthy();
      const {h} = signDims(sign), signBottom = sign.y - h / 2;
      const v = buildDoorView(s);
      v.root.updateMatrixWorld(true);
      const lampParts = v.root.children.filter(o => /lamp/.test(o.name));
      expect(lampParts.length).toBe(3);
      const box = new THREE.Box3();
      for (const o of lampParts) {
        box.setFromObject(o);
        expect(box.max.y, `${o.name} under the plate`).toBeLessThan(signBottom);
        expect(box.min.y, `${o.name} on the lintel band`).toBeGreaterThanOrEqual(d.y + d.h - 1e-6);
        expect(box.max.y).toBeLessThanOrEqual(d.y + d.h + DOOR_VIEW.lintel + 1e-6);
      }
    });
  }
});

// (same task; user: "some z-fighting around the frame") found by a coplanar-face scan of the built door: (1) the portal's jambs ran up
// through the full-width lintel (their front / top / end faces coplanar in both top corners), (2) the pit-wall pilaster (archKit.ts
// planWallRibs) skipped doorways only up to 2.45 m, so on the 2.8 m exit door its I-beam came down through the door head with its face
// in the lintel's plane. Now no face of the portal shares a plane with an overlapping face of any other mesh (the two status lenses swap
// visibility and are excluded).
describe('reactor exit door: no coplanar overlapping faces round the portal', async () => {
  const {buildWorld} = await import('../src/world/builder');
  const {WorldMaterials} = await import('../src/world/materials');
  const {fakeEnvTextures} = await import('./helpers/openablesFixture');
  for (const seed of [9100, 4242]) {
    it(`seed ${seed}`, () => {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}) as StationLayout, s = L.reactor!.surface!, d = s.door;
      const w = buildWorld(L as never, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
      const dv = buildDoorView(s);
      w.group.add(dv.root);
      w.group.updateMatrixWorld(true);
      const region = new THREE.Box3(new THREE.Vector3(d.x - 2, d.y - 0.2, d.z - 2), new THREE.Vector3(d.x + 2, d.y + 4.2, d.z + 2));
      interface T { name: string; v: THREE.Vector3[]; n: THREE.Vector3; dist: number }
      const tris: T[] = [];
      const m4 = new THREE.Matrix4();
      w.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry, pos = g.attributes.position, idx = g.index, im = o as THREE.InstancedMesh;
        const mats = im.isInstancedMesh ? Array.from({length: im.count}, (_, k) => { im.getMatrixAt(k, m4); return m4.clone().premultiply(im.matrixWorld); }) : [m.matrixWorld.clone()];
        const n = idx ? idx.count : pos.count;
        for (const M of mats) for (let t = 0; t < n; t += 3) {
          const v = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(M));
          if (!v.some(p => region.containsPoint(p))) continue;
          const nn = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
          if (nn.length() / 2 < 1e-4) continue;
          nn.normalize();
          tris.push({name: m.name, v, n: nn, dist: nn.dot(v[0])});
        }
      });
      const portal = tris.filter(t => /reactor-ending-door-(jamb|lintel|lamp-box)/.test(t.name));
      expect(portal.length).toBeGreaterThan(20);
      const on = (p: THREE.Vector3, t: T) => { const q = new THREE.Vector3(); new THREE.Triangle(t.v[0], t.v[1], t.v[2]).closestPointToPoint(p, q); return q.distanceTo(p) < 2e-3; };
      const cen = (t: T) => new THREE.Vector3().add(t.v[0]).add(t.v[1]).add(t.v[2]).multiplyScalar(1 / 3);
      const fights: string[] = [];
      for (const A of portal) for (const B of tris) {
        if (A.name === B.name || A.n.dot(B.n) < 0.9995 || Math.abs(A.dist - B.dist) > 2e-3) continue; // same facing, same plane
        if (on(cen(A), B) || on(cen(B), A)) fights.push(`${A.name} <> ${B.name}`);
      }
      expect([...new Set(fights)]).toEqual([]);
    }, 180_000);
  }
});
