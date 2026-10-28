// Lane E (iteration 04): see-through rifle optic — derivative geometry, ADS alignment math and the viewmodel wiring.

import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NodeIO, type Document} from '@gltf-transform/core';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';

vi.mock('../src/world/canvasTextures', () => ({canvasTexture: () => new THREE.Texture()}));

const {WEAPONS} = await import('../src/weapons/weapons');
const {Viewmodel} = await import('../src/weapons/viewmodel');
const {OPTIC_LOOK, opticAimPosition, opticClarity, reticleFrame, createOpticLensMaterial} = await import('../src/weapons/optic');

const file = (rel: string) => fileURLToPath(new URL(`../public/assets/${rel}`, import.meta.url));
const sha = (f: string) => crypto.createHash('sha256').update(readFileSync(f)).digest('hex');
const io = new NodeIO();
const optDoc = await io.read(file('models/rifle-optic.glb'));
const oldDoc = await io.read(file('models/rifle.glb'));
const prov = JSON.parse(readFileSync(file('derivatives/rifle-optic-iteration04.json'), 'utf8'));
// 2026-10-28: the rifle def no longer carries the iteration-04 optic spec (the user's red-dot rifle has no see-through
// optic parts; ADS sights via its `Sight` marker, tests/weapon-sights.test.ts). The optic module + rifle-optic.glb stay.
const spec = {eyeRelief: 0.105};

const node = (d: Document, name: string) => d.getRoot().listNodes().find(n => n.getName() === name);
const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const tris = (d: Document) => d.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + p.getIndices()!.getCount() / 3, 0), 0);
const anchor = (name: string) => v3(node(optDoc, name)!.getWorldTranslation());
const lensRadius = (() => {
  const P = node(optDoc, 'OpticGlassRear')!.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getArray()!;
  const c = anchor('OpticRear');
  let r = 0;
  for (let i = 0; i < P.length; i += 3) r = Math.max(r, Math.hypot(P[i] - c.x, P[i + 1] - c.y));
  return r;
})();

/** Opaque triangles (non-BLEND materials) hit by a ray, as hit z values (model space). */
function opaqueHits(d: Document, o: THREE.Vector3, dir: THREE.Vector3): number[] {
  const hits: number[] = [];
  const ray = new THREE.Ray(o, dir), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), out = new THREE.Vector3();
  for (const n of d.getRoot().listNodes()) {
    for (const p of n.getMesh()?.listPrimitives() ?? []) {
      if (p.getMaterial()?.getAlphaMode() === 'BLEND') continue;
      const P = p.getAttribute('POSITION')!.getArray()!, I = p.getIndices()!.getArray()!;
      for (let f = 0; f < I.length; f += 3) {
        a.fromArray(P, 3 * I[f]); b.fromArray(P, 3 * I[f + 1]); c.fromArray(P, 3 * I[f + 2]);
        if (ray.intersectTriangle(a, b, c, false, out)) hits.push(out.z);
      }
    }
  }
  return hits;
}

async function gltfOf(rel: string): Promise<GLTF> { // textures stripped: no DOM image decoding in node
  const d = await io.read(file(rel));
  for (const t of d.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(d);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

describe('rifle-optic.glb derivative', () => {
  it('keeps the original rifle.glb untouched and its provenance hash matches', () => {
    expect(sha(file('models/rifle.glb'))).toBe('eb8b2f43f56629db2f95a1d2738be15a6922f7a4c368b9f04aa8fea402692623');
    expect(prov.source.sha256).toBe(sha(file('models/rifle.glb')));
    expect(prov.output.sha256).toBe(sha(file('models/rifle-optic.glb')));
  });

  it('stays within the triangle budget and keeps the Muzzle/Grip anchors and baked textures', () => {
    const t = tris(optDoc);
    expect(t).toBe(prov.output.triangles);
    expect(t).toBeLessThanOrEqual(26_000);
    expect(t).toBeGreaterThan(tris(oldDoc) - 400); // only the lens caps / bore interior were cut
    for (const n of ['Muzzle', 'Grip']) expect(node(optDoc, n)!.getTranslation()).toEqual(node(oldDoc, n)!.getTranslation());
    const img = (d: Document, n: string) => crypto.createHash('sha256').update(d.getRoot().listTextures().find(t => t.getName() === n)!.getImage()!).digest('hex');
    for (const n of ['rifle-color', 'rifle-orm', 'rifle-normal']) expect(img(optDoc, n)).toBe(img(oldDoc, n));
    for (const n of ['OpticBody', 'OpticGlassRear', 'OpticGlassFront', 'OpticRear', 'OpticFront']) expect(node(optDoc, n), n).toBeTruthy();
    const glass = node(optDoc, 'OpticGlassRear')!.getMesh()!.listPrimitives()[0].getMaterial()!;
    expect(glass.getAlphaMode()).toBe('BLEND');
    expect(glass.getBaseColorFactor()[3]).toBeLessThan(0.5);
    expect(node(optDoc, 'OpticBody')!.getMesh()!.listPrimitives()[0].getMaterial()!.getBaseColorTexture()).toBeTruthy(); // authored parts are textured
  });

  it('is genuinely see-through along the bore line: no opaque surface between the eye and beyond the objective glass', () => {
    const rear = anchor('OpticRear'), front = anchor('OpticFront');
    expect(rear.x).toBeCloseTo(front.x, 6); // axis parallel to the bore (model -Z)
    expect(rear.y).toBeCloseTo(front.y, 6);
    const eye = rear.clone().add(new THREE.Vector3(0, 0, spec.eyeRelief));
    const dir = new THREE.Vector3(0, 0, -1);
    let blockedNew = 0, blockedOld = 0, rays = 0;
    for (let iy = -4; iy <= 4; iy++) for (let ix = -4; ix <= 4; ix++) {
      const off = new THREE.Vector3(ix, iy, 0).multiplyScalar(lensRadius * 0.9 / 4);
      if (Math.hypot(off.x, off.y) > lensRadius * 0.9) continue;
      rays++;
      const inOptic = (z: number) => z >= front.z - 0.01; // the scope itself (the front sight post far down the barrel is not part of it)
      if (opaqueHits(optDoc, eye.clone().add(off), dir).some(inOptic)) blockedNew++;
      if (opaqueHits(oldDoc, eye.clone().add(off), dir).some(inOptic)) blockedOld++;
    }
    expect(rays).toBeGreaterThan(40);
    expect(blockedNew).toBe(0);
    expect(blockedOld).toBe(rays); // diagnosis: the AI optic is an opaque block
  });
});

describe('ADS alignment math', () => {
  const grip = anchor('Grip'), opticPoint = anchor('OpticRear').sub(grip);
  const aim = opticAimPosition(opticPoint, spec);

  it('puts the eye on the optic axis, eyeRelief behind the rear glass, and the lens centre at screen centre', () => {
    const rearCam = aim.clone().add(opticPoint); // pivot (Grip) at `aim`, no rotation at rest
    expect(rearCam.x).toBeCloseTo(0, 9);
    expect(rearCam.y).toBeCloseTo(0, 9);
    expect(rearCam.z).toBeCloseTo(-spec.eyeRelief, 9);
    const cam = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 20);
    cam.updateMatrixWorld();
    const ndc = rearCam.clone().project(cam);
    expect(Math.hypot(ndc.x, ndc.y)).toBeLessThan(1e-9);
    // the lens is comfortably large and clear of the viewmodel near plane
    expect(lensRadius / spec.eyeRelief / Math.tan(THREE.MathUtils.degToRad(27))).toBeGreaterThan(0.3); // > 30% of half-height
    expect(spec.eyeRelief - 0.01).toBeGreaterThan(0.05);
  });

  it('draws the reticle on the camera forward axis (the hitscan line) at full ADS, even mid-kick/sway', () => {
    const dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    for (const e of [new THREE.Euler(0, 0, 0), new THREE.Euler(0.05, -0.04, 0.01), new THREE.Euler(-0.2, 0.3, 0)]) {
      reticleFrame(new THREE.Quaternion().setFromEuler(e), 1, dir, right, up);
      expect(dir.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-9);
      expect(right.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-9);
      expect(up.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
    }
    // during the raise it rides with the gun (collimated to the bore)
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, 0));
    reticleFrame(q, 0, dir, right, up);
    expect(dir.distanceTo(new THREE.Vector3(0, 0, -1).applyQuaternion(q))).toBeLessThan(1e-9);
  });

  it('opens the exit pupil only near the axis', () => {
    expect(opticClarity({x: 0, y: 0, z: spec.eyeRelief}, spec)).toBe(1);
    expect(opticClarity({x: OPTIC_LOOK.eyeBoxInner * 0.9, y: 0, z: spec.eyeRelief}, spec)).toBe(1);
    expect(opticClarity({x: 0.05, y: 0.02, z: spec.eyeRelief}, spec)).toBe(0);
    expect(opticClarity({x: 0, y: 0, z: -0.01}, spec)).toBe(0);
  });

  it('lens material: transparent, no depth write, untone-mapped reticle', () => {
    const m = createOpticLensMaterial();
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.toneMapped).toBe(false);
    expect(m.side).toBe(THREE.FrontSide);
  });
});

describe('Viewmodel with rifle-optic.glb (retired optic spec)', async () => {
  const [rifle, shotgun] = await Promise.all([gltfOf('models/rifle-optic.glb'), gltfOf('models/shotgun.glb')]);
  const state = (aiming: boolean) => ({moving: 0, sprint: false, aiming, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0});

  it('the rifle def has no optic spec now, so rifle-optic.glb is not wired and markerless models use the legacy aim', () => {
    expect(WEAPONS.rifle.view.optic).toBeUndefined();
    const vm = new Viewmodel({rifle, shotgun}, {});
    const pivot = vm.camera.children.find(c => c.type === 'Group')!;
    vm.setItem('rifle');
    for (let i = 0; i < 60; i++) vm.update(0.05, state(true));
    expect(vm.heldOptic).toBeNull();
    expect(vm.opticAim).toBe(0);
    pivot.position.toArray().forEach((v, k) => expect(v).toBeCloseTo(WEAPONS.rifle.view.aim[k], 6)); // no Sight marker in rifle-optic.glb
    vm.setItem('shotgun');
    for (let i = 0; i < 60; i++) vm.update(0.05, state(true));
    pivot.position.toArray().forEach((v, k) => expect(v).toBeCloseTo(WEAPONS.shotgun.view.aim[k], 6)); // no Sight marker in shotgun.glb
  });

  it('the optic path still works when a def carries a spec (iteration-04 wiring kept, unused by the shipped defs)', () => {
    const saved = WEAPONS.rifle.view.optic;
    WEAPONS.rifle.view.optic = spec;
    let vm: InstanceType<typeof Viewmodel>;
    try { vm = new Viewmodel({rifle, shotgun}, {}); } finally { WEAPONS.rifle.view.optic = saved; }
    const pivot = vm.camera.children.find(c => c.type === 'Group')!;
    vm.setItem('rifle');
    for (let i = 0; i < 40; i++) vm.update(0.05, state(false));
    // iteration-02 hip pose untouched
    pivot.position.toArray().forEach((v, k) => expect(v).toBeCloseTo(WEAPONS.rifle.view.hip[k], 9));
    const {hipPitch, hipYaw, hipRoll} = WEAPONS.rifle.view;
    [pivot.rotation.x, pivot.rotation.y, pivot.rotation.z].forEach((v, k) => expect(v).toBeCloseTo([hipPitch, hipYaw, hipRoll][k], 9));
    const optic = vm.heldOptic!;
    expect(optic).toBeTruthy();
    expect(optic.clarity).toBe(0); // hip: dark lens, no reticle
    expect(vm.opticAim).toBe(0);
    expect(optic.glass.material).toBe(optic.lens);
    expect((optic.mask.material as THREE.Material).colorWrite).toBe(false);
    expect((optic.mask.material as THREE.Material).depthWrite).toBe(true);
    expect(optic.mask.renderOrder).toBeLessThan(0); // drawn before the gun
    expect(optic.mask.position.z).toBeCloseTo(-OPTIC_LOOK.maskOffset, 9); // just behind the glass

    for (let i = 0; i < 60; i++) vm.update(0.05, state(true));
    expect(optic.clarity).toBeGreaterThan(0.999);
    expect(optic.eye.x).toBeCloseTo(0, 4);
    expect(optic.eye.y).toBeCloseTo(0, 4);
    expect(optic.eye.z).toBeCloseTo(spec.eyeRelief, 4);
    expect(vm.opticAim).toBeGreaterThan(0.99);
    const u = optic.lens.uniforms;
    expect((u.uDir.value as THREE.Vector3).distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-4);
    // the rear glass centre projects to the screen centre in the actual scene graph
    vm.scene.updateMatrixWorld(true);
    const rearWorld = optic.glass.parent!.getObjectByName('OpticRear')!.getWorldPosition(new THREE.Vector3());
    expect(Math.hypot(rearWorld.x, rearWorld.y)).toBeLessThan(1e-4);
    expect(rearWorld.z).toBeCloseTo(-spec.eyeRelief, 4);

    // recoil at ADS: the lens stays on the eye and the dot on the aim line
    vm.fire(WEAPONS.rifle);
    let minClarity = 1;
    for (let i = 0; i < 12; i++) { vm.update(1 / 60, state(true)); minClarity = Math.min(minClarity, optic.clarity); }
    expect(minClarity).toBeGreaterThan(0.9);
    expect((u.uDir.value as THREE.Vector3).distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-4);

    // shotgun: iron sights, legacy aim, no optic
    vm.setItem('shotgun');
    for (let i = 0; i < 60; i++) vm.update(0.05, state(true));
    expect(vm.heldOptic).toBeNull();
    expect(vm.opticAim).toBe(0);
    pivot.position.toArray().forEach((v, k) => expect(v).toBeCloseTo(WEAPONS.shotgun.view.aim[k], 6));
  });

  it('falls back to the legacy over-the-top ADS for a model without the optic (original rifle.glb)', async () => {
    const legacy = await gltfOf('models/rifle.glb');
    const vm = new Viewmodel({rifle: legacy, shotgun}, {});
    const pivot = vm.camera.children.find(c => c.type === 'Group')!;
    vm.setItem('rifle');
    for (let i = 0; i < 60; i++) vm.update(0.05, state(true));
    expect(vm.heldOptic).toBeNull();
    pivot.position.toArray().forEach((v, k) => expect(v).toBeCloseTo(WEAPONS.rifle.view.aim[k], 6));
  });
});
