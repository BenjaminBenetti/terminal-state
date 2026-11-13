// Task studio-bb-production-20261112-234540-01: the rendered BB — a skinned clone of one of the four look GLBs
// (enemy-bb-lullaby / -binky / -teddy / -changeling.glb: one skinned body on the SHARED 18-joint skeleton, standing bind, no baked
// clips, scene extras `enemyBb`; tools/asset-pipeline/enemy/build-bb.mjs).
//
// STUB (lead contract commit): the smallest EnemyActor that satisfies the game — the bind pose placed and oriented by the brain's
// BbPose, one torso volume. Lane ACTOR replaces this file: runtime clips (ai/bbClips.ts), head / torso / limb volumes from the
// extras, the small ragdoll rig, the non-graphic hit presentation.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type {AnimName} from './brain';
import {BB_ASSET, BB_SCALE, BbBrain, bbVariantOf, type BbVariantId} from './bb';
import type {ZombieSpawn} from '../gen/station';
import type {HitVolume} from './zombieActor';
import type {MeshSlot} from './wardrobe';

/** GLB extras `enemyBb` (the asset contract, reference BB-ASSET-CONTRACT v1). Every field is optional at runtime (BB_ASSET defaults). */
export interface BbExtras {
  variant?: string;
  name?: string;
  bindPose?: string;
  heightM?: number;
  head?: {centre?: [number, number, number]; radius?: number};
  hitRadii?: {torso?: number; arm?: number; leg?: number};
  contact?: Record<string, [number, number, number]>;
  ends?: Record<string, [number, number, number]>;
  radius?: number;
}

export class BbActor {
  readonly archetype = 'bb' as const;
  readonly variant: BbVariantId;
  readonly root: THREE.Object3D;
  readonly brain: BbBrain;
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly scale: number;
  readonly look = null;
  readonly placesRoot = true;
  readonly nonGraphic = true;
  readonly coated = false;
  readonly extras: BbExtras;
  hitFlash = 0;
  groanT: number;
  deadT = 0;
  ragdolled = false;
  private readonly allBones = new Map<string, THREE.Object3D>();
  private volumes: HitVolume[] = [];
  private readonly basis = new THREE.Matrix4();
  private readonly vx = new THREE.Vector3();
  private readonly vy = new THREE.Vector3();
  private readonly vz = new THREE.Vector3();

  constructor(gltf: GLTF, spawn: ZombieSpawn, rand: () => number) {
    this.extras = (gltf.scene.userData.enemyBb ?? {}) as BbExtras;
    this.variant = bbVariantOf(spawn);
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.name = `enemy-bb-${this.variant}`;
    this.brain = new BbBrain(spawn.x, spawn.z, spawn.yaw);
    this.scale = BB_SCALE.min + rand() * (BB_SCALE.max - BB_SCALE.min);
    this.root.scale.setScalar(this.scale);
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone && !this.allBones.has(o.name)) this.allBones.set(o.name, o);
      if (!m.isSkinnedMesh) return;
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 1.2);
      m.userData = {...m.userData, slot: 'body', wearable: null, archetype: 'bb'};
      if (m.visible) this.meshes.push(m);
    });
    this.groanT = 2 + rand() * 5;
    this.syncTransform();
  }

  get hasRig(): boolean {
    return this.allBones.has('Hips') && this.allBones.has('Head');
  }

  slotOf(mesh: THREE.Object3D): MeshSlot | null {
    return this.meshes.includes(mesh as THREE.SkinnedMesh) ? 'body' : null;
  }

  syncTransform(): void {
    if (this.ragdolled) return;
    const P = this.brain.pose;
    this.root.position.set(P.x, P.y, P.z);
    this.vy.set(P.ux, P.uy, P.uz);
    this.vz.set(P.fx, P.fy, P.fz);
    this.vx.crossVectors(this.vy, this.vz);
    this.root.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.vx, this.vy, this.vz));
  }

  animate(dt: number, _anim: AnimName, _speed: number): void {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
  }

  updateVolumes(): HitVolume[] {
    if (!this.brain.alive) { this.volumes = []; return this.volumes; }
    const P = this.brain.pose, s = this.scale, up = 0.2 * s;
    this.volumes = [{part: 'torso', a: {x: P.x + P.ux * up, y: P.y + P.uy * up, z: P.z + P.uz * up}, b: null, r: BB_ASSET.hitRadii.torso * 1.6 * s}];
    return this.volumes;
  }

  get hitVolumes(): HitVolume[] {
    return this.volumes;
  }

  bone(name: string): THREE.Object3D | undefined {
    return this.allBones.get(name);
  }

  boneVelocity(_name: string, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, 0);
  }

  beginRagdoll(): void {
    this.ragdolled = true;
  }

  setCullSphere(): void {}

  ragdollMoved(x: number, z: number): void {
    this.brain.x = x;
    this.brain.z = z;
  }

  dispose(): void {
    this.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) m.skeleton.dispose(); });
  }
}
