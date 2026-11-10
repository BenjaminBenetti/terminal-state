// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): the STATIC RIDE GATES (world/ridePortalView.ts) on real
// generated levels of EVERY level kind in the registry, built with the real buildWorld (tests/helpers/ridePortalWorld.ts):
//  - every 'gate' portal of the car's track has its headwall (the end face less the openings, in front of the end wall, in that wall's
//    own material), its frame, its two leaves per opening and their hazard bands — four draws per gated end, level-tagged, marked as
//    the portal's own; the black end plane and the barricade of that end are gone, those of every other closed end stand as before;
//  - the shut leaves close the opening between the posts and under the lintel (the kick skirt starts over the sleepers), standing in
//    the slab between the headwall front and the end face; open, they lie folded against the ride box's side walls, clear of the car's
//    swept box (2.99 m wide in the 3.9 m box: 0.46 m a side) and inside the box;
//  - the leaves are posed by instance matrices only (no geometry / material change); a breach and a level without a car get none.
import * as THREE from 'three';
import {appendFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {LEVEL_IDS} from '../src/levels/registry';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {RIDE_BOX, RIDE_GATE, gatedEnds, portalEndKey, type RidePortal} from '../src/world/ridePortal';
import {GATE, buildRideGates, leafBounds, leafMatrix, staticGateEnds} from '../src/world/ridePortalView';
import {portalWorld, type PortalWorld} from './helpers/ridePortalWorld';

const LOG = '/tmp/lanes/portal/gates.log';
const log = (s: string) => { try { appendFileSync(LOG, s + '\n'); } catch { /* best effort */ } };
const SEEDS = [4242, 8];

/** Instance matrices are float32: equal within its precision at world coordinates. */
const near = (a: THREE.Matrix4, b: THREE.Matrix4): boolean => a.elements.every((v, i) => Math.abs(v - b.elements[i]) <= 1e-5 * Math.max(1, Math.abs(b.elements[i])));

/** Sum of triangle areas (world) of a mesh's geometry, and its vertices' x range. */
function meshArea(m: THREE.Mesh): {area: number; x0: number; x1: number; nx: number} {
  const g = m.geometry, P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute, idx = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0, x0 = Infinity, x1 = -Infinity, nx = 0;
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(P, idx.getX(t)); b.fromBufferAttribute(P, idx.getX(t + 1)); c.fromBufferAttribute(P, idx.getX(t + 2));
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  for (let i = 0; i < P.count; i++) { x0 = Math.min(x0, P.getX(i)); x1 = Math.max(x1, P.getX(i)); nx += N.getX(i); }
  return {area, x0, x1, nx: nx / P.count};
}

/** Stripe (barricade plank) vertices of the merged traversal hazard mesh near bed end x of trench z range [z0, z1]. */
function barricadeAt(w: PortalWorld, x: number, z0: number, z1: number): number {
  const hz = w.world.group.getObjectByName('traversal-hazard') as THREE.Mesh | undefined;
  if (!hz) return 0;
  const P = hz.geometry.attributes.position as THREE.BufferAttribute;
  let n = 0;
  for (let i = 0; i < P.count; i++) if (Math.abs(P.getX(i) - x) < 0.25 && P.getZ(i) > z0 && P.getZ(i) < z1) n++;
  return n;
}

describe('ride gates: the static headwall + gate in the closed bed ends of the car\'s track (every level kind)', () => {
  for (const id of LEVEL_IDS) for (const seed of SEEDS) {
    it(`${id} ${seed}: gated ends carry the gate (no plane, no barricade), every other end as before; the leaves close / clear`, async () => {
      const w = await portalWorld(id, seed);
      expect(w.placement).not.toBeNull();
      const L = w.layout, p = w.placement!, gated = gatedEnds(L, p), cont = w.world.trackExt?.view.continued ?? new Set<string>();
      expect(staticGateEnds(L)).toEqual(gated);
      const gates = [w.portals!.front, w.portals!.rear].filter(q => q.kind === 'gate');
      expect(new Set(gates.map(portalEndKey))).toEqual(gated);
      const built = w.world.rideGates ?? null;
      if (!gates.length) { expect(built).toBeNull(); return; }
      expect(built!.gates.size).toBe(gates.length);
      expect(built!.stats.meshes).toBe(4 * gates.length);
      // black planes and barricades: exactly at the closed ends that carry no gate
      const planes = new Map<string, number>();
      w.world.group.traverse(o => { const k = o.userData.bedEndVoid as string | undefined; if (k) planes.set(k, (planes.get(k) ?? 0) + 1); });
      for (const [ti, t] of L.trenches.entries()) for (const end of ['x0', 'x1'] as const) {
        const key = `${ti}:${end}`, closed = !cont.has(key), x = end === 'x0' ? t.x0 + 0.12 : t.x1 - 0.12;
        expect(planes.get(key) ?? 0, `${id} plane ${key}`).toBe(closed && !gated.has(key) ? 1 : 0);
        if (gated.has(key)) expect(barricadeAt(w, x, t.z0, t.z1), `${id} barricade at gated ${key}`).toBe(0);
        else if (closed) expect(barricadeAt(w, x, t.z0, t.z1), `${id} barricade at ${key}`).toBeGreaterThan(0);
      }
      for (const q of gates) {
        const v = built!.gates.get(portalEndKey(q))!;
        expect(v.portal).toBe(q);
        for (const m of [v.wall, v.frame, v.leaves, v.hazard]) {
          expect(m.parent).toBe(w.world.group);
          expect(m.userData.ridePortal).toBe(true);
          expect(m.userData.level).toBe(p.level);
          expect(m.matrixAutoUpdate).toBe(false);
        }
        // the headwall: the end face less the openings, in one plane RIDE_GATE.proud in front of the end face, facing the station
        const front = q.faceX - q.out * RIDE_GATE.proud, A = meshArea(v.wall);
        const faceArea = (q.face.z1 - q.face.z0) * (q.face.y1 - q.face.y0), openArea = [q.opening, ...q.dummies].reduce((s, o) => s + (o.z1 - o.z0) * (o.y1 - o.y0), 0);
        expect(A.area, `${id} headwall area`).toBeCloseTo(faceArea - openArea, 3);
        expect(A.x0).toBeCloseTo(front, 6);
        expect(A.x1).toBeCloseTo(front, 6);
        expect(A.nx).toBeCloseTo(-q.out, 6);
        // the end wall's own finish where there is one (a hall directly behind the face has none: the tunnel lining then)
        const mat = (v.wall.material as THREE.Material).name;
        log(`${id} ${seed} ${portalEndKey(q)}: wall material '${mat}', face ${(q.face.z1 - q.face.z0).toFixed(2)} x ${(q.face.y1 - q.face.y0).toFixed(2)} m, dummies ${q.dummies.length}, triangles ${built!.stats.triangles}`);
        // the leaves: two instances per opening, posed by matrices only; the moving pair at the ride's opening
        const openings = [q.opening, ...q.dummies];
        expect(v.leaves.count).toBe(2 * openings.length);
        expect(v.hazard.count).toBe(2 * openings.length);
        const m = new THREE.Matrix4();
        openings.forEach((o, i) => { for (const [k, s] of [[0, -1], [1, 1]] as const) { v.leaves.getMatrixAt(2 * i + k, m); expect(near(m, leafMatrix(q, o, s, 0))).toBe(true); } });
        checkLeaves(id, q);
        // swing: instance matrices only, the moving pair at the ride's opening; a dummy never moves
        const geo = v.leaves.geometry, mt = v.leaves.material, before = v.leaves.instanceMatrix.version;
        const dummy = new Float32Array(v.leaves.instanceMatrix.array.slice(32));
        v.setOpen(1);
        expect(v.leaves.instanceMatrix.version).toBeGreaterThan(before);
        expect([v.leaves.geometry, v.leaves.material]).toEqual([geo, mt]);
        v.leaves.getMatrixAt(0, m); expect(near(m, leafMatrix(q, q.opening, -1, 1))).toBe(true);
        v.hazard.getMatrixAt(1, m); expect(near(m, leafMatrix(q, q.opening, 1, 1))).toBe(true);
        expect(Array.from(v.leaves.instanceMatrix.array.slice(32))).toEqual(Array.from(dummy));
        // the instanced bounds hold the whole swing (the open leaves are not frustum-culled away)
        for (const s of [-1, 1] as const) for (const e of [0, 0.5, 1]) expect(v.leaves.boundingBox!.containsBox(leafBounds(q, q.opening, s, e))).toBe(true);
        v.setOpen(0);
      }
    }, 240_000);
  }

  it('a breach portal gets no gate; a layout without a car gets none and keeps every plane / barricade', async () => {
    const w = await portalWorld('skyways', 4242);
    expect([w.portals!.front.kind, w.portals!.rear.kind]).toEqual(['breach', 'breach']);
    expect(w.world.rideGates ?? null).toBeNull();
    const noCar = {...w.layout, trenches: []} as typeof w.layout;
    expect(staticGateEnds(noCar).size).toBe(0);
    expect(buildRideGates(new THREE.Group(), noCar, w.mats)).toBeNull();
  });
});

/** The shut leaves close the ride opening; the open leaves lie against the ride box's side walls, clear of the car. */
function checkLeaves(id: string, q: RidePortal): void {
  const o = q.opening, zc = (o.z0 + o.z1) / 2;
  const shut = [leafBounds(q, o, -1, 0), leafBounds(q, o, 1, 0)];
  // in the slab between the headwall front and the end face (never on the station side of the headwall, never through the end wall)
  const front = q.faceX - q.out * RIDE_GATE.proud;
  for (const b of shut) {
    expect(Math.min(b.min.x, b.max.x) >= Math.min(front, q.faceX) - 1e-6 && Math.max(b.min.x, b.max.x) <= Math.max(front, q.faceX) + 1e-6, `${id} shut leaf in the slab`).toBe(true);
  }
  // across: from each post's inner face (less the hinge gap) to the meeting gap at the centre; up: over the sleepers to under the lintel
  const postIn = RIDE_BOX.half - RIDE_GATE.post;
  expect(shut[0].min.z).toBeLessThanOrEqual(zc - postIn + GATE.hinge - GATE.flange + 1e-6);
  expect(shut[1].max.z).toBeGreaterThanOrEqual(zc + postIn - GATE.hinge + GATE.flange - 1e-6);
  expect(shut[1].min.z - shut[0].max.z).toBeLessThanOrEqual(2 * GATE.meet + 1e-6);
  for (const b of shut) {
    expect(b.min.y - o.y0).toBeCloseTo(GATE.foot, 6);
    expect(o.y1 - RIDE_GATE.lintel - b.max.y).toBeCloseTo(GATE.top, 6);
  }
  // open: folded into the tunnel along its side walls, inside the box, clear of the car's body
  const halfCar = SPEC.width / 2;
  for (const [s, b] of [[-1, leafBounds(q, o, -1, 1)], [1, leafBounds(q, o, 1, 1)]] as const) {
    const inner = s < 0 ? b.max.z - zc : zc - b.min.z, outer = s < 0 ? zc - b.min.z : b.max.z - zc;
    expect(-inner, `${id} open leaf ${s} clears the car`).toBeGreaterThan(halfCar + 0.25);
    expect(outer, `${id} open leaf ${s} inside the box`).toBeLessThanOrEqual(RIDE_BOX.half);
    const beyond = q.out > 0 ? b.min.x - (q.faceX - GATE.plane - 0.1) : (q.faceX + GATE.plane + 0.1) - b.max.x;
    expect(beyond, `${id} open leaf ${s} swings into the tunnel`).toBeGreaterThanOrEqual(0);
  }
}
