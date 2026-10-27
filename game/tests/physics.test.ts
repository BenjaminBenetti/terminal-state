// Lane D (iteration 03): ragdoll + casing physics stability. Uses the real 18-joint skeleton from
// derivatives/zombie-rigged.json (bind positions, identity bind rotations) on a bare THREE skeleton.

import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CELL, FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import type {PropPlacement} from '../src/gen/props';
import {PhysicsSystem, MAX_SIMULATING_RAGDOLLS, killImpulseStrength} from '../src/physics/world';
import type {RagdollTarget} from '../src/physics/ragdoll';
import {MAX_CASINGS} from '../src/physics/casings';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ZombieActor} from '../src/ai/zombieActor';

const rig = JSON.parse(readFileSync(fileURLToPath(new URL('../public/assets/derivatives/zombie-rigged.json', import.meta.url)), 'utf8')) as {skeleton: {joints: {name: string; parent: string | null; bindWorldPosition: [number, number, number]}[]}};

class TestZombie implements RagdollTarget {
  readonly root = new THREE.Group();
  readonly bones = new Map<string, THREE.Bone>();
  ragdolled = false;
  cull = new THREE.Sphere();
  constructor(x: number, z: number, yaw: number, readonly scale = 1, readonly coated = false, private readonly vel = new THREE.Vector3()) {
    for (const j of rig.skeleton.joints) {
      const b = new THREE.Bone();
      b.name = j.name;
      const p = j.parent ? rig.skeleton.joints.find(q => q.name === j.parent)!.bindWorldPosition : [0, 0, 0];
      b.position.set(j.bindWorldPosition[0] - p[0], j.bindWorldPosition[1] - p[1], j.bindWorldPosition[2] - p[2]);
      (j.parent ? this.bones.get(j.parent)! : this.root).add(b);
      this.bones.set(j.name, b);
    }
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.root.scale.setScalar(scale);
    this.root.updateMatrixWorld(true);
  }
  bone(n: string) { return this.bones.get(n); }
  boneVelocity(_n: string, out: THREE.Vector3) { return out.copy(this.vel); }
  beginRagdoll() { this.ragdolled = true; }
  setCullSphere(c: THREE.Vector3, r: number) { this.cull.set(c.clone(), r); }
  /** Pose helper: rotate a bone locally (radians about a bind-frame axis). */
  rot(name: string, axis: [number, number, number], a: number) { this.bones.get(name)!.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), a)); this.root.updateMatrixWorld(true); return this; }
  worldPoints(): THREE.Vector3[] {
    this.root.updateMatrixWorld(true);
    return [...this.bones.values()].map(b => b.getWorldPosition(new THREE.Vector3()));
  }
}

/** 24 x 16 m room: solid border, floor, and a track-bed trench along the far side (z 12..15 m). */
function testLayout(props: PropPlacement[] = []) {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
    const border = x < 2 || y < 2 || x >= 46 || y >= 30;
    g.set(x, y, border ? SOLID : y >= 24 ? VOID : FLOOR);
  }
  return {grid: g, props, trench: {floorY: -1.15}};
}

function run(ph: PhysicsSystem, seconds: number, dt = 1 / 60, each?: () => void) {
  for (let t = 0; t < seconds; t += dt) { ph.update(dt); each?.(); }
}

function allFinite(z: TestZombie) {
  return z.worldPoints().every(p => Number.isFinite(p.x + p.y + p.z));
}

describe('ragdoll', () => {
  it('a standing pose collapses, settles on the floor, freezes and keeps the pose', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    const z = new TestZombie(8, 6, 0.6, 1.02, false, new THREE.Vector3(0.6, 0, 1.2));
    const fwd = new THREE.Vector3(Math.sin(0.6 + Math.PI), -0.1, Math.cos(0.6 + Math.PI));
    expect(ph.ragdoll(z, {dir: fwd, point: {x: 8, y: 1.3, z: 6}, strength: killImpulseStrength('rifle', 1, 1)})).toBe(true);
    expect(z.ragdolled).toBe(true);
    let maxSpeed = 0, minY = Infinity, settledAt = -1, t = 0;
    const t0 = performance.now();
    run(ph, 6, 1 / 60, () => {
      t += 1 / 60;
      for (const p of z.worldPoints()) minY = Math.min(minY, p.y);
      const s = ph.stats();
      if (s.ragdollsActive === 0 && settledAt < 0) settledAt = t;
      for (const r of ph.debugRagdolls()) if (!r.frozen) maxSpeed = Math.max(maxSpeed, 0);
    });
    const ms = performance.now() - t0;
    expect(allFinite(z)).toBe(true);
    expect(settledAt).toBeGreaterThan(0);
    expect(settledAt).toBeLessThan(6);
    const s = ph.stats();
    expect(s.ragdollsActive).toBe(0);
    expect(s.ragdollsFrozen).toBe(1);
    expect(s.ragdollsFailed).toBe(0);
    expect(s.bodies).toBe(0); // bodies and static chunks removed once frozen
    // bone origins never sank meaningfully below the floor (joint centres sit inside the limbs)
    expect(minY).toBeGreaterThan(-0.03);
    const pelvis = z.bones.get('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(pelvis.y).toBeGreaterThan(0.04);
    expect(pelvis.y).toBeLessThan(0.45); // lying down, not standing
    expect(Math.hypot(pelvis.x - 8, pelvis.z - 6)).toBeLessThan(2.5);
    // frozen pose stays put
    const before = z.worldPoints();
    run(ph, 1);
    z.worldPoints().forEach((p, i) => expect(p.distanceTo(before[i])).toBeLessThan(1e-9));
    void maxSpeed;
    console.log(`[physics.test] standing ragdoll settled at ${settledAt.toFixed(2)} s; 6 s sim took ${ms.toFixed(1)} ms (${(ms / 360).toFixed(3)} ms/frame)`);
  });

  it('survives awkward poses, heavy shotgun impulses, walls and the trench edge without NaN or tunnelling', () => {
    const ph = new PhysicsSystem(null);
    const crate: PropPlacement = {kind: 'crate', x: 15, z: 5, y: 0, rot: 0, area: 0, hx: 0.31, hz: 0.22, h: 0.43, blocksSight: false, variant: 0};
    ph.build(testLayout([crate]));
    const zs = [
      // arms reaching into the wall (wall face at x = 1.0 m), knees bent
      new TestZombie(1.45, 8, -Math.PI / 2, 1, true).rot('L_UpperArm', [1, 0, 0], -1.2).rot('R_UpperArm', [1, 0, 0], -1.2).rot('L_Shin', [1, 0, 0], 1.0),
      // at the platform edge (edge at z = 12 m), shot toward the track
      new TestZombie(10, 11.6, 0, 0.97, false).rot('L_Thigh', [1, 0, 0], -0.6).rot('R_Shin', [1, 0, 0], 1.3),
      // next to a crate, shotgun blast from the side
      new TestZombie(14.4, 5, Math.PI / 2, 1.05, true, new THREE.Vector3(2.4, 0, 0)),
      // twisted torso / head, hit in the head
      new TestZombie(6, 4, 2.0).rot('Spine', [0, 1, 0], 0.7).rot('Neck', [1, 0, 0], 0.6).rot('L_Forearm', [0, 1, 0], 0.8),
    ];
    ph.ragdoll(zs[0], {dir: {x: -1, y: 0, z: 0}, point: {x: 1.3, y: 1.3, z: 8}, strength: killImpulseStrength('shotgun', 9, 9)});
    ph.ragdoll(zs[1], {dir: {x: 0, y: -0.1, z: 1}, point: {x: 10, y: 1.2, z: 11.6}, strength: killImpulseStrength('shotgun', 9, 9)});
    ph.ragdoll(zs[2], {dir: {x: 1, y: -0.05, z: 0}, point: {x: 14.4, y: 1.0, z: 5}, strength: killImpulseStrength('shotgun', 7, 9)});
    ph.ragdoll(zs[3], {dir: {x: 0, y: -0.2, z: -1}, point: {x: 6, y: 1.7, z: 4}, strength: killImpulseStrength('rifle', 1, 1), bone: 'head'});
    expect(ph.stats().ragdollsActive).toBe(4);
    let worst = 0, peakMs = 0, sumMs = 0, frames = 0;
    const t4 = performance.now();
    run(ph, 9, 1 / 60, () => {
      const st = ph.stats();
      if (st.ragdollsActive === 4) { peakMs = Math.max(peakMs, st.stepMsMax); sumMs += st.stepMs; frames++; }
      const s = ph.stats();
      worst = Math.max(worst, s.bodies);
      for (const z of zs) for (const p of z.worldPoints()) {
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(p.y).toBeGreaterThan(-1.2); // never below the trench floor
        expect(p.x).toBeGreaterThan(0.8); // never through the 1 m border wall
      }
    });
    console.log(`[physics.test] 4 simultaneous ragdolls: ~${(sumMs / Math.max(1, frames)).toFixed(2)} ms/frame smoothed, peak ${peakMs.toFixed(2)} ms, max bodies ${worst}; 9 s sim ${(performance.now() - t4).toFixed(0)} ms incl. per-frame assertions`);
    const s = ph.stats();
    expect(s.ragdollsActive).toBe(0);
    expect(s.ragdollsFrozen).toBe(4);
    expect(s.ragdollsFailed).toBe(0);
    expect(worst).toBeLessThan(4 * 11 + 80);
    // the edge zombie went over into the trench and lies on its floor
    const hips1 = zs[1].bones.get('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(hips1.z).toBeGreaterThan(11.8);
    // nobody is left standing
    for (const z of zs) expect(z.bones.get('Head')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.9);
  });

  it('caps simulating ragdolls at 4 (oldest frozen early) and rebuilds per station without leaking bodies', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    for (let i = 0; i < 6; i++) {
      ph.ragdoll(new TestZombie(4 + i * 2.5, 8, 0), {dir: {x: 0, y: 0, z: -1}, point: {x: 4 + i * 2.5, y: 1.2, z: 8}, strength: 38});
      run(ph, 0.1);
      expect(ph.stats().ragdollsActive).toBeLessThanOrEqual(MAX_SIMULATING_RAGDOLLS);
    }
    expect(ph.stats().ragdollsFrozen).toBeGreaterThanOrEqual(2);
    const busy = ph.stats().bodies;
    expect(busy).toBeGreaterThan(0);
    ph.casings.eject(new THREE.Vector3(5, 1.2, 5), new THREE.Vector3(1, 0.5, 0), 'rifle');
    ph.build(testLayout()); // New Station
    expect(ph.stats()).toMatchObject({ragdollsActive: 0, ragdollsFrozen: 0, bodies: 0, casingsLive: 0});
    ph.ragdoll(new TestZombie(8, 8, 0), {dir: {x: 0, y: 0, z: 1}, point: {x: 8, y: 1.2, z: 8}, strength: 38});
    expect(ph.stats().bodies).toBeLessThan(busy);
    ph.dispose();
    expect(ph.stats().bodies).toBe(0);
  });
});

describe('ragdoll on the real rigged derivative', () => {
  it('takes over a running / attacking ZombieActor (both skins) and lays it down without NaN', async () => {
    // zombie-rigged.glb without its JPEG textures (no DOM image decoding in node)
    const io = new NodeIO();
    const doc = await io.read(fileURLToPath(new URL('../public/assets/models/zombie-rigged.glb', import.meta.url)));
    for (const t of doc.getRoot().listTextures()) t.dispose();
    const bin = await io.writeBinary(doc);
    const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [anim, type] of [['Run', 'shambler'], ['Attack', 'coated']] as const) {
      const z = new ZombieActor(gltf, {x: 8, z: 6, yaw: 0.4, type, area: 0}, rand);
      expect(z.hasRig).toBe(true);
      for (let i = 0; i < 30; i++) {
        if (anim === 'Run') { z.brain.x += 2.4 / 60 * Math.sin(0.4); z.brain.z += 2.4 / 60 * Math.cos(0.4); }
        z.animate(1 / 60, anim, anim === 'Run' ? 2.4 : 0);
        z.syncTransform();
        z.updateVolumes();
      }
      const run = z.boneVelocity('Hips', new THREE.Vector3());
      if (anim === 'Run') expect(run.length()).toBeGreaterThan(1.5); // animated momentum is carried over
      z.brain.damage(999, 8, 0);
      expect(ph.ragdoll(z, {dir: {x: 0, y: -0.1, z: -1}, point: {x: z.brain.x, y: 1.25, z: z.brain.z}, strength: 38})).toBe(true);
      const rootAt = z.root.position.clone();
      for (let i = 0; i < 300; i++) { ph.update(1 / 60); z.animate(1 / 60, 'Death', 0); z.syncTransform(); z.updateVolumes(); }
      expect(z.root.position.distanceTo(rootAt)).toBe(0); // root stays; the bones carry the body
      const bonesY: number[] = [];
      z.root.updateMatrixWorld(true);
      z.root.traverse(o => { if ((o as THREE.Bone).isBone) bonesY.push(o.getWorldPosition(new THREE.Vector3()).y); });
      expect(bonesY.every(Number.isFinite)).toBe(true);
      expect(Math.min(...bonesY)).toBeGreaterThan(-0.03);
      expect(z.bone('Head')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.5);
      const hips = z.bone('Hips')!.getWorldPosition(new THREE.Vector3());
      expect(Math.hypot(hips.x - z.brain.x, hips.z - z.brain.z)).toBeLessThan(0.3); // brain follows the corpse
    }
    expect(ph.stats()).toMatchObject({ragdollsActive: 0, ragdollsFrozen: 2, ragdollsFailed: 0, bodies: 0});
  });
});

describe('casings', () => {
  it('fall, bounce, roll and come to rest on the floor; fade out after their lifetime', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    let seed = 7;
    ph.casings.rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sounds: number[] = [];
    ph.casings.audio = {casing: (_x, _y, _z, speed) => sounds.push(speed)};
    for (let i = 0; i < 10; i++) ph.casings.eject(new THREE.Vector3(6 + i * 0.3, 1.25, 6), new THREE.Vector3(1, 0.5, 0.2), i % 2 ? 'rifle' : 'shell', {x: 0.5, y: 0, z: 0});
    let peakAfterBounce = 0;
    const firstBounce = new Map<number, boolean>();
    run(ph, 6, 1 / 60, () => {
      ph.casings.list().forEach((c, i) => {
        if (c.bounces > 0) firstBounce.set(i, true);
        if (firstBounce.get(i) && c.mode === 0) peakAfterBounce = Math.max(peakAfterBounce, c.y);
      });
    });
    const list = ph.casings.list();
    expect(list.length).toBe(10);
    for (const c of list) {
      expect(c.mode).toBe(2); // at rest
      expect(c.y).toBeGreaterThan(0.003);
      expect(c.y).toBeLessThan(0.012); // lying on its side on the y 0 floor
      expect(c.bounces).toBeGreaterThan(0);
      expect(c.x).toBeGreaterThan(6); // thrown to the right
    }
    expect(peakAfterBounce).toBeGreaterThan(0.012); // they actually bounced back up
    expect(sounds.length).toBeGreaterThan(5);
    run(ph, 20);
    expect(ph.casings.live).toBe(0);
  });

  it('bounce off walls, drop into the trench, and respect the 48-casing pool', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    // straight at the border wall (x = 1 m) — must stay inside the room
    ph.casings.eject(new THREE.Vector3(1.4, 1.2, 6), new THREE.Vector3(-1, 0.2, 0), 'rifle', undefined, 4);
    // over the platform edge (z = 12 m) into the trench (floor -1.15 m)
    ph.casings.eject(new THREE.Vector3(8, 1.2, 11.8), new THREE.Vector3(0, 0.3, 1), 'shell', undefined, 2.5);
    run(ph, 6);
    const [a, b] = ph.casings.list();
    expect(a.x).toBeGreaterThan(1.0);
    expect(a.y).toBeLessThan(0.012);
    expect(b.z).toBeGreaterThan(12);
    expect(b.y).toBeLessThan(-1.1);
    expect(b.y).toBeGreaterThan(-1.15);
    for (let i = 0; i < 70; i++) ph.casings.eject(new THREE.Vector3(10, 1.2, 8), new THREE.Vector3(1, 0.5, 0), 'rifle');
    expect(ph.casings.live).toBe(MAX_CASINGS);
    void CELL;
  });
});
