// Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): THE STRAINER's runtime GLB against the ASSET CONTRACT that the
// family code is written to (lane ASSET builds game/public/assets/models/enemy-strainer.glb in parallel). SKIPPED WITH A REASON until
// the file exists in this checkout; once it lands every check runs, and the provisional STRAINER_ASSET numbers (TODO-ASSET in
// game/src/ai/strainer.ts) must be set to the GLB's `enemyStrainer` extras for the agreement checks to pass:
//  - one skinned body on the SHARED 18-joint skeleton (the Blightbelly's / zombies' names), clips exactly Idle / Walk / Run / Attack /
//    Hit / Death, feet at the origin, +Z facing, bind height 2.15 m;
//  - scene extras enemyStrainer {heightM, headCenter, headRadius, reachM, attackHitTime, clips} === STRAINER_ASSET (the static stats
//    and the reference read STRAINER_ASSET); ENEMY_MODEL_FILES.enemy_strainer.bytes within 10 % of the file;
//  - the real actor: a rig, the head zone hunched forward of the body, the crown under 2.25 m at the largest runtime scale.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {STRAINER_ASSET, STRAINER_MAX_TOP_M, STRAINER_SCALE, STRAINER_STATS, strainerAttackRange} from '../src/ai/strainer';
import {STRAINER_CLIPS, StrainerActor, type StrainerExtras} from '../src/ai/strainerActor';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const GLB = pub(ENEMY_MODEL_FILES.enemy_strainer.url);
const HAVE = existsSync(GLB);
/** The shared 18-joint humanoid skeleton (tests/blightbelly-asset.test.ts JOINT_NAMES). */
const JOINT_NAMES = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];

async function loadStripped(path: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const skinned = (root: THREE.Object3D) => { const out: THREE.SkinnedMesh[] = []; root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); }); return out; };

describe.skipIf(!HAVE)('Strainer GLB vs the asset contract (skipped until lane ASSET\'s enemy-strainer.glb exists in this checkout)', () => {
  let gltf: GLTF;
  let X: StrainerExtras;
  beforeAll(async () => {
    gltf = await loadStripped(GLB);
    X = (gltf.scene.userData.enemyStrainer ?? {}) as StrainerExtras;
  });

  it('one skinned body on the shared 18-joint skeleton; clips exactly Idle / Walk / Run / Attack / Hit / Death', () => {
    const meshes = skinned(gltf.scene);
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    for (const m of meshes) expect(m.skeleton.bones.map(b => b.name)).toEqual(JOINT_NAMES);
    expect(gltf.animations.map(a => a.name).sort()).toEqual([...STRAINER_CLIPS].sort());
  });

  it('feet at the origin, +Z facing, bind height 2.15 m; extras enemyStrainer present', () => {
    expect(Object.keys(X).length).toBeGreaterThan(0);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    expect(Math.abs(box.min.y)).toBeLessThan(0.03);
    expect(box.max.y).toBeCloseTo(2.15, 1);
    expect(X.heightM).toBeCloseTo(2.15, 2);
    expect(X.headCenter![2]).toBeGreaterThan(0); // the head hunched forward (+Z)
    expect(X.headRadius).toBeGreaterThan(0.05);
    expect(X.reachM).toBeGreaterThan(0.8);
    const attack = gltf.animations.find(a => a.name === 'Attack')!;
    expect(X.attackHitTime).toBeGreaterThan(0);
    expect(X.attackHitTime).toBeLessThan(attack.duration);
  });

  it('STRAINER_ASSET (the stats / reference numbers) === the GLB extras (wire the real numbers when this fails)', () => {
    const attack = gltf.animations.find(a => a.name === 'Attack')!;
    expect(STRAINER_ASSET.heightM).toBeCloseTo(X.heightM!, 3);
    for (let k = 0; k < 3; k++) expect(STRAINER_ASSET.headCenter[k]).toBeCloseTo(X.headCenter![k], 3);
    expect(STRAINER_ASSET.headRadius).toBeCloseTo(X.headRadius!, 3);
    expect(STRAINER_ASSET.reachM).toBeCloseTo(X.reachM!, 3);
    expect(STRAINER_ASSET.attackHitTime).toBeCloseTo(X.attackHitTime!, 3);
    expect(STRAINER_ASSET.attackDuration).toBeCloseTo(X.clips?.Attack?.duration ?? attack.duration, 3);
    if (X.clips?.Walk?.groundSpeed) expect(STRAINER_ASSET.walkGroundSpeed).toBeCloseTo(X.clips.Walk.groundSpeed, 3);
    if (X.clips?.Run?.groundSpeed) expect(STRAINER_ASSET.runGroundSpeed).toBeCloseTo(X.clips.Run.groundSpeed, 3);
    expect(STRAINER_STATS.attackRange).toBe(strainerAttackRange(X.reachM!));
    const bytes = statSync(GLB).size;
    expect(Math.abs(ENEMY_MODEL_FILES.enemy_strainer.bytes - bytes) / bytes).toBeLessThan(0.1);
  });

  it('the real actor: a rig; the head zone forward of the hips; the crown under 2.25 m at the largest runtime scale', () => {
    const a = new StrainerActor(gltf, {x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, archetype: 'strainer'}, () => 0.999);
    a.root.position.y = 0;
    expect(a.hasRig).toBe(true);
    expect(a.scale).toBeLessThanOrEqual(STRAINER_SCALE.max);
    const v = a.updateVolumes();
    const head = v.find(h => h.part === 'head')!;
    const hips = a.bone('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(head.a.y).toBeGreaterThan(1.7);
    expect(head.a.z).toBeGreaterThan(hips.z);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    expect(box.max.y * STRAINER_SCALE.max).toBeLessThan(STRAINER_MAX_TOP_M);
  });
});

describe('Strainer GLB availability', () => {
  it(HAVE ? 'enemy-strainer.glb is present (contract checks above run)' : 'enemy-strainer.glb not landed yet: contract checks skipped (the game uses the counted zombie stand-in)', () => {
    expect(ENEMY_MODEL_FILES.enemy_strainer.url).toBe('assets/models/enemy-strainer.glb');
  });
});
