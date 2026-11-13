// Task studio-bb-production-20261112-234540-01 (lane ACTOR): the bodies the BB clip / actor / ragdoll / non-graphic tests run on.
//  - the four REAL BB bodies (enemy-bb-<variant>.glb), parsed by three's GLTFLoader with their textures stripped (node has no image
//    decoder) — the runtime clips are solved on each body's own bind, so every proportion-dependent check runs on all four;
//  - a real Screacher body (a 2 m adult on the same 18 joints) and a SYNTHETIC short-limbed, big-headed 0.85 m skeleton with no
//    `enemyBb` extras: two stand-in proportions the solver was never tuned on (what they prove is proportion-independence, nothing
//    about how a BB looks);
//  - an ordinary zombie (zombie-rigged.glb), the body the graphic damage path is checked on.
// Needs neither the private raw masters nor git history.

import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {BB_JOINTS, bbRigFromBind, bbRigOf, type BbExtras, type BbRig, type V3} from '../../src/ai/bbClips';
import {BB_VARIANT_IDS} from '../../src/ai/enemyRoster';
import {ENEMY_MODEL_FILES} from '../../src/ai/enemyModels';
import {BB_VARIANTS, type BbVariantId} from '../../src/ai/bb';
import type {ZombieSpawn} from '../../src/gen/stationTypes';

const pub = (rel: string): string => fileURLToPath(new URL('../../public/' + rel, import.meta.url));

/** A GLB as the game's loader sees it, minus its images. */
export async function loadStripped(rel: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(pub(rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const cache = new Map<string, Promise<GLTF>>();
const once = (rel: string): Promise<GLTF> => { let p = cache.get(rel); if (!p) cache.set(rel, (p = loadStripped(rel))); return p; };

export const BB_IDS: readonly BbVariantId[] = BB_VARIANT_IDS;
/** One real BB body (the registered model file of its look). */
export const bbGltf = (v: BbVariantId): Promise<GLTF> => once(ENEMY_MODEL_FILES[BB_VARIANTS[v].model].url);
/** A real Screacher body: the shared 18 joints at adult proportions (2 m, long arms). */
export const screacherGltf = (): Promise<GLTF> => once(ENEMY_MODEL_FILES.enemy_screacher_sc01.url);
/** The ordinary zombie's rigged body. */
export const zombieGltf = (): Promise<GLTF> => once('assets/models/zombie-rigged.glb');

/**
 * A synthetic 0.85 m body: a head a third of its height on a short trunk, limbs clearly shorter than any real BB's (thigh 0.11 /
 * shin 0.10 against ~0.145 / 0.13; arm 0.075 + 0.07 against ~0.09 + 0.09), arms hanging straight down (the real ones are in an
 * A-pose), exactly left / right symmetric.
 */
export const SYNTHETIC_BIND: Readonly<Record<string, V3>> = {
  Root: [0, 0, 0], Hips: [0, 0.245, 0], Spine: [0, 0.32, 0.004], Chest: [0, 0.4, 0.006], Neck: [0, 0.5, 0.004], Head: [0, 0.56, 0.006],
  L_UpperArm: [0.1, 0.47, 0.004], L_Forearm: [0.108, 0.395, 0.002], L_Hand: [0.112, 0.325, 0.008],
  R_UpperArm: [-0.1, 0.47, 0.004], R_Forearm: [-0.108, 0.395, 0.002], R_Hand: [-0.112, 0.325, 0.008],
  L_Thigh: [0.06, 0.24, 0], L_Shin: [0.064, 0.13, 0.004], L_Foot: [0.064, 0.03, -0.004],
  R_Thigh: [-0.06, 0.24, 0], R_Shin: [-0.064, 0.13, 0.004], R_Foot: [-0.064, 0.03, -0.004],
};
/** The only extras the synthetic body carries by default: its height (everything else falls back to the bind / BB_ASSET rules). */
export const SYNTHETIC_EXTRAS: BbExtras = {heightM: 0.85};

/** A GLTF-shaped body on the shared joints at `bind` (model space): bones at rest + one skinned box, `enemyBb` extras as given. */
export function syntheticBb(bind: Readonly<Record<string, V3>> = SYNTHETIC_BIND, extras: BbExtras | null = SYNTHETIC_EXTRAS): GLTF {
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name, parent] of BB_JOINTS) {
    const b = new THREE.Bone();
    b.name = name;
    const w = bind[name], pw = parent ? bind[parent] : [0, 0, 0];
    b.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    (parent ? bones.get(parent)! : scene).add(b);
    bones.set(name, b);
  }
  const geo = new THREE.BoxGeometry(0.2, 0.85, 0.16).translate(0, 0.425, 0);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'BBBody';
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BB_JOINTS.map(([j]) => bones.get(j)!)));
  if (extras) scene.userData.enemyBb = extras;
  return {scene, scenes: [scene], animations: [], cameras: [], asset: {}, parser: null, userData: {}} as unknown as GLTF;
}

/** The clip rig of a loaded body, solved on a fresh clone at rest (as the actor does); `extras` default: the scene's own `enemyBb`. */
export function rigOfGltf(gltf: GLTF, extras?: BbExtras): BbRig | null {
  return bbRigOf(SkeletonUtils.clone(gltf.scene), extras ?? ((gltf.scene.userData.enemyBb ?? {}) as BbExtras));
}
/** The synthetic body's rig straight from its joint table. */
export const syntheticRig = (): BbRig => bbRigFromBind({...SYNTHETIC_BIND} as Record<string, V3>, SYNTHETIC_EXTRAS)!;

export const rng = (seed = 1): (() => number) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
export const spawnBb = (x: number, z: number, variant: BbVariantId = 'lullaby', yaw = 0): ZombieSpawn => ({x, z, yaw, type: 'shambler', area: 0, archetype: 'bb', variant});
