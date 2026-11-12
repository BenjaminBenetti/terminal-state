// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): THE COOKED ROOF TURRET through the sentry's view and rules — the REAL
// GLB (assets/models/train-turret.glb, loaded as the game's loader gives it: its named nodes, textures stripped for Node).
//  - world/sentryTurretView.ts finds 'turret-base' / 'turret-yoke' / 'turret-head' and re-parents them under its yaw / pitch pivots
//    WITHOUT moving anything: at yaw 0 / pitch 0 every node's world matrix is the cooked rest pose (no tearing), and the library's
//    scene is left untouched;
//  - the kinematics are the rules' (craft/sentry.ts): the yoke turns rigidly about the yaw axis, the head tilts about the cooked pitch
//    pivot — which ORBITS the yaw axis (turretPivot(yaw)) —, elevation up = NEGATIVE rotation.x (the cook: positive = muzzle down),
//    and the real barrel tip is where turretMuzzle says, at every pose between the stops;
//  - the numbers the rules use are true for this model on the hatch: its height over the elevation range (turretReach /
//    SENTRY.topDepressed: the headroom), the swept radius, the tip over the mounting plane at the lower stop, the head clear of the
//    roof outline at every yaw at the lower stop; stowed, all of it is below its seat and above the saloon's ceiling;
//  - the running system swaps the stand-in for it and fires from its real barrel tip.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';
import {loadZombieModels, placeZombie, sentryWorld, teardownSentryWorlds} from './helpers/sentryFixture';
import {TRAIN_EQUIPMENT_MODELS, TRAIN_TURRET_MEASURED as TM} from '../src/assets/trainEquipment.generated';
import {SENTRY, turretMuzzle, turretPivot, turretReach, turretSweep} from '../src/craft/sentry';
import {TRAIN_ROOF, roofTopAtPoint, turretMount} from '../src/craft/trainFixtures';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {SentryTurretView} from '../src/world/sentryTurretView';

installCanvasShim(false);
afterEach(teardownSentryWorlds);

const DEG = Math.PI / 180, MNT = turretMount(SPEC), PARTS = ['turret-base', 'turret-yoke', 'turret-head'] as const;
let gltf: GLTF;
beforeAll(async () => {
  gltf = await loadStripped(TRAIN_EQUIPMENT_MODELS.turret.url);
  await loadZombieModels();
}, 180000);

const part = (root: THREE.Object3D, name: string): THREE.Mesh => {
  const o = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (!o) throw new Error(`no node ${name}`);
  o.updateWorldMatrix(true, false);
  return o;
};
/** The largest element-wise difference of two matrices. */
const diff = (a: THREE.Matrix4, b: THREE.Matrix4) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
/** Every vertex of a mesh in the frame its world matrix maps to. */
function eachVertex(o: THREE.Mesh, f: (p: THREE.Vector3) => void): void {
  o.updateWorldMatrix(true, false);
  const P = o.geometry.getAttribute('position'), p = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) f(p.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld));
}
/** The centre of the barrel's tip: the middle of the head's vertices within 3 mm of its foremost one, in the head's OWN frame. */
function tipLocal(head: THREE.Mesh): THREE.Vector3 {
  const P = head.geometry.getAttribute('position'), p = new THREE.Vector3(), lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let zMax = -Infinity;
  for (let i = 0; i < P.count; i++) zMax = Math.max(zMax, P.getZ(i));
  for (let i = 0; i < P.count; i++) if (P.getZ(i) > zMax - 0.003) { p.fromBufferAttribute(P, i); lo.min(p); hi.max(p); }
  return lo.add(hi).multiplyScalar(0.5).setZ(zMax);
}
/** The cooked rest pose: each part's matrix in the model frame. */
function restPose(): Map<string, THREE.Matrix4> {
  gltf.scene.updateMatrixWorld(true);
  return new Map(PARTS.map(n => [n, part(gltf.scene, n).matrixWorld.clone()]));
}
/** The poses checked: every quarter and some odd yaws x the stops, the scan pitch, level and between. */
const POSES: [number, number][] = [];
for (const yaw of [0, 37, 90, 141, 180, 233, 270, 322]) for (const pitch of [SENTRY.pitchMin / DEG, -20, SENTRY.scanPitch / DEG, 0, 4, SENTRY.pitchMax / DEG]) POSES.push([yaw * DEG, pitch * DEG]);

describe('the cooked turret through the sentry view (the real GLB)', () => {
  it('has the documented nodes; the view re-parents them without moving anything: yaw 0 / pitch 0 is the cooked rest pose', () => {
    const src = gltf.scene, rest = restPose(), P = TM.pitchPivot;
    // the cook's frame: base and yoke at the origin, the head a child of the yoke at the pitch pivot
    const srcHead = part(src, 'turret-head'), srcYoke = part(src, 'turret-yoke'), srcBase = part(src, 'turret-base');
    expect([srcHead.isMesh, srcYoke.isMesh, srcBase.isMesh]).toEqual([true, true, true]);
    expect(srcHead.parent).toBe(srcYoke);
    expect(srcHead.position.distanceTo(new THREE.Vector3(P.x, P.y, P.z))).toBeLessThan(1e-6);
    expect(diff(rest.get('turret-yoke')!, new THREE.Matrix4())).toBeLessThan(1e-9);
    expect(diff(rest.get('turret-base')!, new THREE.Matrix4())).toBeLessThan(1e-9);
    const v = new SentryTurretView(SPEC);
    expect(v.setModel(src)).toBe(true);
    expect(v.model).not.toBe(src); // a clone
    expect(v.tilts).toBe(true);
    expect(v.root.getObjectByName('turret-barrel')).toBeUndefined(); // the stand-in is gone
    v.pose(1, 0, 0);
    expect(v.root.position.toArray()).toEqual([MNT.x, MNT.y, MNT.z]);
    // (the view's root is in the train-local frame here: the model frame moved to the mount)
    const toMount = new THREE.Matrix4().makeTranslation(MNT.x, MNT.y, MNT.z);
    for (const n of PARTS) expect(diff(part(v.root, n).matrixWorld, toMount.clone().multiply(rest.get(n)!)), n).toBeLessThan(1e-9);
    // under the pivots: base fixed in the model, yoke under the yaw pivot ON the axis, head under the pitch pivot AT the cooked pivot
    const head = part(v.root, 'turret-head'), yoke = part(v.root, 'turret-yoke'), base = part(v.root, 'turret-base');
    expect([head.parent!.name, head.parent!.parent!.name, yoke.parent!.name, base.parent!.name]).toEqual(['train-turret-pitch', 'train-turret-yaw', 'train-turret-yaw', 'train-turret-model']);
    expect(head.parent!.position.distanceTo(new THREE.Vector3(P.x, P.y, P.z))).toBeLessThan(1e-12);
    expect(yoke.parent!.position.length()).toBe(0);
    expect(head.position.length()).toBeLessThan(1e-6); // (the head's own origin is the pivot: nothing to offset)
    expect(head.geometry).toBe(srcHead.geometry); // the library's geometry, shared
    // the library's scene was not touched
    expect(part(src, 'turret-head').parent).toBe(srcYoke);
    for (const n of PARTS) expect(diff(part(src, n).matrixWorld, rest.get(n)!)).toBe(0);
    // nothing of it answers the interaction raycasts
    expect(new THREE.Raycaster(new THREE.Vector3(MNT.x, 10, 0), new THREE.Vector3(0, -1, 0)).intersectObject(v.root, true)).toEqual([]);
    v.dispose();
  });

  it('turns and tilts as the rules say, rigidly: the pivot orbits the yaw axis, elevation is NEGATIVE rotation.x, the real barrel tip is the rules muzzle', () => {
    const rest = restPose(), v = new SentryTurretView(SPEC);
    v.setModel(gltf.scene);
    const head = part(v.root, 'turret-head'), yoke = part(v.root, 'turret-yoke'), base = part(v.root, 'turret-base');
    const toMount = new THREE.Matrix4().makeTranslation(MNT.x, MNT.y, MNT.z), tip = tipLocal(head);
    // the cook's muzzle constant is this model's barrel tip (model frame at rest)
    const tipRest = tip.clone().applyMatrix4(rest.get('turret-head')!);
    expect(tipRest.z).toBeCloseTo(TM.muzzle.z, 2);
    expect(tipRest.distanceTo(new THREE.Vector3(TM.muzzle.x, TM.muzzle.y, TM.muzzle.z))).toBeLessThan(0.012);
    const muzzleInHead = new THREE.Vector3(TM.muzzle.x, TM.muzzle.y, TM.muzzle.z).applyMatrix4(rest.get('turret-head')!.clone().invert());
    for (const [yaw, pitch] of POSES) {
      v.pose(1, yaw, pitch);
      const at = `yaw ${(yaw / DEG).toFixed(0)} pitch ${(pitch / DEG).toFixed(0)}`;
      // the base ring never moves; the yoke only turns about the yaw axis
      expect(diff(part(v.root, 'turret-base').matrixWorld, toMount.clone().multiply(rest.get('turret-base')!)), at).toBeLessThan(1e-9);
      const turn = toMount.clone().multiply(new THREE.Matrix4().makeRotationY(yaw));
      expect(diff(part(v.root, 'turret-yoke').matrixWorld, turn.clone().multiply(rest.get('turret-yoke')!)), at).toBeLessThan(1e-9);
      // the head: the yoke's turn, then the tilt about the X axis through the cooked pivot — up = negative rotation.x
      const P = TM.pitchPivot, tilt = new THREE.Matrix4().makeTranslation(P.x, P.y, P.z).multiply(new THREE.Matrix4().makeRotationX(-pitch)).multiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z));
      expect(diff(part(v.root, 'turret-head').matrixWorld, turn.clone().multiply(tilt).multiply(rest.get('turret-head')!)), at).toBeLessThan(1e-9);
      expect(head.parent!.rotation.x).toBeCloseTo(-pitch, 12);
      // its origin (the tilt axis' middle) is the rules' pivot AT THAT YAW: off the yaw axis, orbiting it
      const piv = turretPivot(yaw), o = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
      expect(o.distanceTo(new THREE.Vector3(piv.x, piv.y, piv.z)), at).toBeLessThan(1e-9);
      expect(Math.hypot(o.x - MNT.x, o.z - MNT.z)).toBeCloseTo(TM.pitchPivot.z, 9);
      // the measured muzzle point carried by the real head = turretMuzzle; the real barrel tip is within a centimetre of it
      const want = turretMuzzle(yaw, pitch), w = new THREE.Vector3(want.x, want.y, want.z);
      expect(muzzleInHead.clone().applyMatrix4(head.matrixWorld).distanceTo(w), at).toBeLessThan(1e-9);
      expect(tip.clone().applyMatrix4(head.matrixWorld).distanceTo(w), at).toBeLessThan(0.012);
    }
    // the sign, plainly: muzzle down = positive rotation.x on the pitch pivot, and the real tip goes down
    const tipY = () => { head.updateWorldMatrix(true, false); return tip.clone().applyMatrix4(head.matrixWorld).y; };
    v.pose(1, 0, 0);
    const level = tipY();
    v.pose(1, 0, -20 * DEG);
    expect(head.parent!.rotation.x).toBeGreaterThan(0);
    expect(tipY()).toBeLessThan(level - 0.15);
    v.pose(1, 0, SENTRY.pitchMax);
    expect(head.parent!.rotation.x).toBeLessThan(0);
    expect(tipY()).toBeGreaterThan(level + 0.05);
    expect([yoke.parent!.rotation.x, yoke.parent!.rotation.z, base.rotation.y]).toEqual([0, 0, 0]);
    v.dispose();
  });

  it('the numbers the rules use are this model\'s: height over the elevation range (headroom), swept radius, the tip over the mounting plane', () => {
    const v = new SentryTurretView(SPEC);
    v.setModel(gltf.scene);
    const head = part(v.root, 'turret-head'), yoke = part(v.root, 'turret-yoke'), base = part(v.root, 'turret-base');
    const measure = (pitch: number) => {
      v.pose(1, 0, pitch);
      let top = -Infinity, low = Infinity, rad = 0;
      eachVertex(head, p => { top = Math.max(top, p.y - MNT.y); low = Math.min(low, p.y - MNT.y); rad = Math.max(rad, Math.hypot(p.x - MNT.x, p.z - MNT.z)); });
      eachVertex(yoke, p => { top = Math.max(top, p.y - MNT.y); rad = Math.max(rad, Math.hypot(p.x - MNT.x, p.z - MNT.z)); });
      return {top, low, rad};
    };
    // at rest: the cook's size, sweep and base ring
    const rest = measure(0);
    expect(rest.top).toBeCloseTo(TM.size.h, 2);
    expect(rest.rad).toBeCloseTo(TM.swingRadius, 2);
    let baseR = 0, baseLow = Infinity;
    eachVertex(base, p => { baseR = Math.max(baseR, Math.hypot(p.x - MNT.x, p.z - MNT.z)); baseLow = Math.min(baseLow, p.y - MNT.y); });
    expect(baseR).toBeCloseTo(TM.baseRadius, 3);
    expect(baseLow).toBeCloseTo(0, 6); // it stands on the mount's plane
    // over the whole elevation range, degree by degree
    let top = -Infinity, topAt = 0, rad = 0;
    for (let d = Math.round(SENTRY.pitchMin / DEG); d <= Math.round(SENTRY.pitchMax / DEG); d++) {
      const m = measure(d * DEG);
      if (m.top > top) { top = m.top; topAt = d; }
      rad = Math.max(rad, m.rad);
    }
    // THE HIGHEST POINT is at the lower stop (the sensor box at the head's rear rises as the muzzle goes down): SENTRY.topDepressed,
    // rounded up to the millimetre — what the headroom check adds over the mount
    expect(topAt).toBe(Math.round(SENTRY.pitchMin / DEG));
    expect(top).toBeLessThanOrEqual(SENTRY.topDepressed);
    expect(top).toBeGreaterThan(SENTRY.topDepressed - 0.001);
    expect(turretReach()).toBe(SENTRY.topDepressed);
    expect(top).toBeGreaterThan(TM.size.h + 0.04); // (4.7 cm more than at rest: the rest height alone would not do)
    // the swept radius: the cook's (measured at rest) to within 4 mm over the range (largest a few degrees below level)
    expect(turretSweep()).toBe(TM.swingRadius);
    expect(rad).toBeLessThan(TM.swingRadius + 0.004);
    // at the lower stop the barrel's tip is still 1 cm above the plane the base stands on; one stop lower it would not be
    expect(measure(SENTRY.pitchMin).low).toBeGreaterThan(0.01);
    expect(measure(SENTRY.pitchMin - 2 * DEG).low).toBeLessThan(0);
    v.dispose();
  });

  it('on the hatch: at the lower stop the head clears the roof outline at every yaw; stowed, all of it is below its seat and above the saloon', () => {
    const v = new SentryTurretView(SPEC);
    v.setModel(gltf.scene);
    const head = part(v.root, 'turret-head'), yoke = part(v.root, 'turret-yoke');
    const least = (pitch: number) => {
      let worst = Infinity;
      for (let yaw = 0; yaw < 360; yaw += 5) {
        v.pose(1, yaw * DEG, pitch);
        eachVertex(head, p => { worst = Math.min(worst, p.y - roofTopAtPoint(p.x, p.z, SPEC)); });
      }
      return worst;
    };
    // (the outline is the HIGHEST roof point of its 2 cm band of the hatch: the tip's underside just reaches it over the hatch's end
    // at one yaw — 0.2 mm — and is clear everywhere else; level and raised there are 14 cm and more)
    expect(least(SENTRY.pitchMin)).toBeGreaterThan(-0.001);
    expect(least(0)).toBeGreaterThan(0.14);
    expect(least(SENTRY.pitchMax)).toBeGreaterThan(0.14);
    // two degrees lower (the cook's `down` limit over a roof that falls away) it would dip 2 cm into the hatch's end: why the stop is
    // the flat-plane one
    expect(TM.pitchClear.down).toBe(31);
    expect(least(-TM.pitchClear.down * DEG)).toBeLessThan(-0.015);
    // the turning yoke: the base ring is bedded into the hatch's crowned top (the seat: its lowest point under the ring), and the
    // yoke's rear lower rim reaches 1.5 cm past the ring — turned along the car it is over the crown, 1.2 cm below the outline there:
    // never deeper than the ring's own bedding (a cosmetic sliver at the foot of the turret, not a rule)
    let yokeLeast = Infinity;
    for (let yaw = 0; yaw < 360; yaw += 5) {
      v.pose(1, yaw * DEG, 0);
      eachVertex(yoke, p => { if (Math.hypot(p.x - MNT.x, p.z - MNT.z) > TM.baseRadius) yokeLeast = Math.min(yokeLeast, p.y - roofTopAtPoint(p.x, p.z, SPEC)); });
    }
    expect(yokeLeast).toBeGreaterThan(-(TRAIN_ROOF.seat.hi - TRAIN_ROOF.seat.lo));
    expect(yokeLeast).toBeLessThan(0);
    // STOWED (hidden): sunk into the cavity under the hatch — at any pitch its top is below its seat (so below the hatch's top), and
    // its underside above the saloon's ceiling lining
    expect(v.sink).toBeGreaterThanOrEqual(turretReach());
    for (const pitch of [SENTRY.pitchMin, SENTRY.scanPitch, 0, SENTRY.pitchMax]) for (const yaw of [0, 1.3, 3.0]) {
      v.pose(0, yaw, pitch);
      expect(v.root.visible).toBe(false);
      const box = new THREE.Box3().setFromObject(v.root, true);
      expect(box.max.y).toBeLessThanOrEqual(TRAIN_ROOF.seat.lo + 1e-9);
      expect(box.max.y).toBeLessThan(roofTopAtPoint(MNT.x, 0, SPEC));
      expect(box.min.y).toBeGreaterThan(SPEC.ceilingY);
    }
    v.dispose();
  });
});

describe('the running sentry with the cooked turret', () => {
  it('swaps the stand-in for the model and fires from its real barrel tip', () => {
    const s = sentryWorld({ammo: 3, rand: () => 0, model: () => gltf.scene});
    const f = s.stand(MNT.x + 3, -7.5)!, z = placeZombie(f);
    z.brain.hp = 1e6;
    s.host.zombies.push(z);
    s.deploy();
    expect(s.sys.qa()).toMatchObject({model: true, deployed: true, visible: true});
    expect(s.sys.view.root.getObjectByName('turret-barrel')).toBeUndefined();
    s.until(() => s.sys.counts.shots >= 1);
    expect(s.sys.counts).toMatchObject({shots: 1, hits: 1});
    // the flash / tracer start at the real head's barrel tip, in the world, at the pose the gun had
    const head = part(s.sys.view.root, 'turret-head'), tip = tipLocal(head).applyMatrix4(head.matrixWorld);
    const flash = s.fx.of('muzzleFlash')[0].args[0] as THREE.Vector3;
    expect(flash.distanceTo(tip)).toBeLessThan(0.012);
    const m = turretMuzzle(s.sys.yaw, s.sys.pitch), mw = s.mount();
    expect(flash.y - mw.y).toBeCloseTo(m.y - MNT.y, 9);
    expect(s.sys.pitch).toBeLessThan(0); expect(s.sys.pitch).toBeGreaterThanOrEqual(SENTRY.pitchMin);
    // the line of fire started at the real head's tilt axis (its node origin), the round went on into the body
    const pivot = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld), shot = s.sys.lastShot!;
    expect(pivot.distanceTo(new THREE.Vector3(shot.pivot.x, shot.pivot.y, shot.pivot.z))).toBeLessThan(1e-6);
    expect(shot).toMatchObject({result: 'enemy'});
    // every mesh carries the car's storey and is skipped by the interaction raycasts
    let meshes = 0;
    s.sys.view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; expect(o.userData.level).toBe(s.p.level); } });
    expect(meshes).toBe(3);
    expect(s.host.warmRegistry.poolRoots()).toContain(s.sys.view.root);
  });
});
