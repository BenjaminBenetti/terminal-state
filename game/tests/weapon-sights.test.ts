// User weapon models (2026-10-28): rifle-user.glb (red dot), shotgun-user.glb, pistol.glb — manifest wiring, the
// Grip/Muzzle/Sight/Eject marker contract, sight-based ADS (aim = (0, 0, -sightRelief) - (Sight - Grip)) and the
// Eject marker overriding the casing-port constants.

import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';

vi.mock('../src/world/canvasTextures', () => ({canvasTexture: () => new THREE.Texture()}));

const {WEAPONS} = await import('../src/weapons/weapons');
const {Viewmodel, sightAimPosition} = await import('../src/weapons/viewmodel');
const {MODEL_FILES} = await import('../src/assets/manifest');
const {PhysicsSystem} = await import('../src/physics/world');

const pub = (url: string) => fileURLToPath(new URL(`../public/${url}`, import.meta.url));
const io = new NodeIO();
const GUNS = ['rifle', 'shotgun', 'pistol'] as const;
const FILES = {rifle: 'assets/models/rifle-user.glb', shotgun: 'assets/models/shotgun-user.glb', pistol: 'assets/models/pistol.glb'};
const LENGTH = {rifle: 0.88, shotgun: 0.98, pistol: 0.185};
// Iteration 12 (LIGHT, user #6): pistol ADS lower (sightLift 0.014) and closer (relief 0.32 -> 0.28).
const RELIEF = {rifle: 0.26, shotgun: 0.30, pistol: 0.28};
const LIFT = {rifle: 0.04, shotgun: 0.022, pistol: 0.014};

async function gltfOf(url: string): Promise<GLTF> { // textures stripped: no DOM image decoding in node
  const d = await io.read(pub(url));
  for (const t of d.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(d);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const marker = (g: GLTF, name: string) => { g.scene.updateMatrixWorld(true); return g.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()); };

describe('user weapon models in the manifest', () => {
  it('points rifle / shotgun / pistol at the user derivatives with sane byte estimates (old GLBs stay on disk)', () => {
    for (const id of GUNS) {
      expect(MODEL_FILES[id].url).toBe(FILES[id]);
      expect(existsSync(pub(FILES[id])), FILES[id]).toBe(true);
      expect(Math.abs(statSync(pub(FILES[id])).size - MODEL_FILES[id].bytes), id).toBeLessThan(20_000);
    }
    for (const old of ['rifle.glb', 'rifle-optic.glb', 'shotgun.glb']) expect(existsSync(pub(`assets/models/${old}`)), old).toBe(true);
    // iteration 15: the rifle's see-through optic is back (runtime aperture on rifle-user.glb, tests/optic.test.ts)
    expect(WEAPONS.rifle.view.optic).toMatchObject({eyeRelief: 0.105, aperture: {radius: 0.016}});
    for (const id of ['shotgun', 'pistol'] as const) expect(WEAPONS[id].view.optic, id).toBeUndefined();
    expect(Object.fromEntries(GUNS.map(id => [id, WEAPONS[id].view.sightRelief]))).toEqual(RELIEF);
    expect(Object.fromEntries(GUNS.map(id => [id, WEAPONS[id].view.sightLift]))).toEqual(LIFT);
  });
});

describe('user weapon models: markers and sight-based ADS', async () => {
  const models = Object.fromEntries(await Promise.all(GUNS.map(async id => [id, await gltfOf(FILES[id])] as const))) as Record<(typeof GUNS)[number], GLTF>;
  const state = (aiming: boolean) => ({moving: 0, sprint: false, aiming, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0});

  it('has Grip / Muzzle / Sight / Eject markers, muzzle toward -Z, real-world length, no see-through optic nodes', () => {
    for (const id of GUNS) {
      const g = models[id];
      for (const n of ['Grip', 'Muzzle', 'Sight', 'Eject']) expect(g.scene.getObjectByName(n), `${id} ${n}`).toBeTruthy();
      for (const n of ['OpticGlassRear', 'OpticRear']) expect(g.scene.getObjectByName(n), `${id} ${n}`).toBeUndefined();
      const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3());
      expect(size.z / LENGTH[id], id).toBeGreaterThan(0.95);
      expect(size.z / LENGTH[id], id).toBeLessThan(1.05);
      expect(marker(g, 'Muzzle').z, id).toBeLessThan(marker(g, 'Grip').z);
      expect(marker(g, 'Muzzle').z, id).toBeLessThan(box.min.z + 0.02); // at the barrel tip
      expect(marker(g, 'Sight').y, id).toBeGreaterThan(marker(g, 'Grip').y);
    }
  });

  it('keeps the hip pose, then at full ADS puts the Sight marker on the screen centre `sightRelief` in front of the eye', () => {
    const vm = new Viewmodel(models, {});
    const pivot = vm.camera.children.find(c => c.type === 'Group')!;
    for (const id of ['shotgun', 'pistol'] as const) { // (iteration 15: the rifle aims through its optic, tests/optic.test.ts)
      const g = models[id], view = WEAPONS[id].view;
      vm.setItem(id);
      for (let i = 0; i < 40; i++) vm.update(0.05, state(false));
      pivot.position.toArray().forEach((v, k) => expect(v, `${id} hip`).toBeCloseTo(view.hip[k], 9));
      for (let i = 0; i < 60; i++) vm.update(0.05, state(true));
      expect(vm.heldOptic).toBeNull();
      expect(vm.opticAim).toBe(0);
      const sightRel = marker(g, 'Sight').sub(marker(g, 'Grip'));
      const lift = view.sightLift ?? 0;
      const want = sightAimPosition(sightRel.clone().setY(sightRel.y + lift), view.sightRelief!);
      expect(want.toArray()).toEqual([0, 0, -view.sightRelief!].map((v, k) => v - sightRel.getComponent(k) - (k === 1 ? lift : 0)));
      pivot.position.toArray().forEach((v, k) => expect(v, `${id} aim`).toBeCloseTo(want.getComponent(k), 6));
      // in the actual scene graph: the sight point is on the camera axis at the relief distance (screen centre = hitscan line)
      vm.scene.updateMatrixWorld(true);
      const holder = pivot.children.find(c => c.visible && c.type === 'Group')!;
      const sightCam = holder.getObjectByName('Sight')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(vm.camera.matrixWorldInverse);
      expect(Math.abs(sightCam.x), id).toBeLessThan(1e-4);
      expect(sightCam.y, id).toBeCloseTo(-lift, 4); // the sight sits `sightLift` under the screen centre (eye over a solid optic)
      expect(sightCam.z, id).toBeCloseTo(-view.sightRelief!, 4);
      // the muzzle sits ahead of the sight, on the far side of the viewmodel near plane
      const muzzleCam = holder.getObjectByName('Muzzle')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(vm.camera.matrixWorldInverse);
      expect(muzzleCam.z, id).toBeLessThan(sightCam.z);
    }
  });

  it('Iteration 12 (user #6): the aimed pistol sits lower and closer than iteration 11, sights just under the crosshair, nothing clips', () => {
    const view = WEAPONS.pistol.view;
    expect(view.sightLift!).toBeGreaterThanOrEqual(0.012);
    expect(view.sightLift!).toBeLessThanOrEqual(0.02);
    expect(view.sightRelief!).toBeGreaterThanOrEqual(0.27);
    expect(view.sightRelief!).toBeLessThanOrEqual(0.29);
    const g = models.pistol;
    const sightRel = marker(g, 'Sight').sub(marker(g, 'Grip'));
    const now = sightAimPosition(sightRel.clone().setY(sightRel.y + view.sightLift!), view.sightRelief!);
    const it11 = sightAimPosition(sightRel.clone(), 0.32); // iteration 11: relief 0.32, no lift
    expect(now.y).toBeCloseTo(it11.y - view.sightLift!, 9); // lower by the lift
    expect(now.z - it11.z).toBeCloseTo(0.32 - view.sightRelief!, 9); // closer to the camera
    expect(now.x).toBeCloseTo(it11.x, 9); // same lateral line (still on the hitscan line)
    // the rifle / shotgun ADS are untouched
    expect(WEAPONS.rifle.view.sightRelief).toBe(0.26);
    expect(WEAPONS.shotgun.view.sightRelief).toBe(0.30);
    // full ADS in the real scene graph: every pistol vertex well past the viewmodel near plane (0.01 m), sight 2-4 deg under centre
    const vm = new Viewmodel(models, {});
    vm.setItem('pistol');
    for (let i = 0; i < 80; i++) vm.update(0.05, state(true));
    vm.scene.updateMatrixWorld(true);
    const pivot = vm.camera.children.find(c => c.type === 'Group')!;
    const holder = pivot.children.find(c => c.visible && c.type === 'Group')!;
    let nearest = Infinity;
    const v = new THREE.Vector3();
    holder.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(vm.camera.matrixWorldInverse); nearest = Math.min(nearest, -v.z); }
    });
    expect(nearest).toBeGreaterThan(vm.camera.near * 5);
    const sightCam = holder.getObjectByName('Sight')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(vm.camera.matrixWorldInverse);
    const below = THREE.MathUtils.radToDeg(Math.atan2(-sightCam.y, -sightCam.z));
    expect(below).toBeGreaterThan(2);
    expect(below).toBeLessThan(4);
    console.info(`[ads] pistol: sight ${below.toFixed(2)} deg under the crosshair at ${(-sightCam.z).toFixed(3)} m, nearest vertex ${nearest.toFixed(3)} m (near ${vm.camera.near})`);
  });

  it('casings eject from the model Eject marker (grip-relative), falling back to the EJECTION_PORTS constants', () => {
    const vm = new Viewmodel(models, {});
    for (const id of GUNS) {
      const want = marker(models[id], 'Eject').sub(marker(models[id], 'Grip'));
      expect(vm.ejectionMarker(id)!.distanceTo(want), id).toBeLessThan(1e-6);
    }
    expect(vm.ejectionMarker('bandage')).toBeNull();
    // PhysicsSystem.ejectNow passes the marker (when present) to Viewmodel.ejectionPort in place of the constant
    const seen: THREE.Vector3[] = [];
    const port = {ejectionPort: (_c: THREE.PerspectiveCamera, _id: string, pos: THREE.Vector3) => { seen.push(pos.clone()); return false; }, ejectionMarker: (i: string) => vm.ejectionMarker(i)};
    const phys = Object.create(PhysicsSystem.prototype) as InstanceType<typeof PhysicsSystem>;
    const cam = new THREE.PerspectiveCamera();
    (phys as unknown as {ejectNow: (w: string, p: unknown, c: THREE.PerspectiveCamera, s: {vx: number; vz: number}) => void}).ejectNow('pistol', port, cam, {vx: 0, vz: 0});
    (phys as unknown as {ejectNow: (w: string, p: unknown, c: THREE.PerspectiveCamera, s: {vx: number; vz: number}) => void}).ejectNow('rifle', {ejectionPort: port.ejectionPort}, cam, {vx: 0, vz: 0});
    expect(seen[0].distanceTo(vm.ejectionMarker('pistol')!)).toBeLessThan(1e-9);
    expect(seen[1].toArray()).toEqual([0.0294, 0.1217, -0.1085]); // no marker source → constant
  });
});
