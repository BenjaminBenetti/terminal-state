// Task studio-screacher-production-20261110-221858-01: THE SCREACHER's four runtime GLBs against the ASSET CONTRACT the family code is
// written to (game/public/assets/models/enemy-screacher-sc01..sc04.glb, built by tools/asset-pipeline/enemy/build-screacher.mjs; their
// own derivative checks live in tests/screacher-asset.test.ts). The files are checked-in runtime inputs, so every check here always
// runs (a missing GLB FAILS). One enemy type, four bodies: every variant must satisfy the SAME contract —
//  - one skinned body on the SHARED 18-joint skeleton, clips exactly Idle / Walk / Run / Attack / Hit / Death / Scream with the same
//    durations and timings in all four (one AI), feet at the origin, bind height 2.00 m to the top of the neck stump;
//  - scene extras enemyScreacher === SCREACHER_ASSET where the gameplay reads them; NO head sphere of any kind;
//  - the real actor: a rig, no head hit volume, the hit volumes end at the stump, a shot over the stump misses.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {SCREACHER_ASSET, SCREACHER_ECHO, SCREACHER_MAX_TOP_M, SCREACHER_SCALE, SCREACHER_STATS, SCREACHER_VARIANTS, type ScreacherVariantId} from '../src/ai/screacher';
import {SCREACHER_CLIPS, ScreacherActor, type ScreacherExtras} from '../src/ai/screacherActor';
import {nearestEnemyHit} from '../src/combat/enemyRay';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const VARIANTS = Object.keys(SCREACHER_VARIANTS) as ScreacherVariantId[];
const glbOf = (v: ScreacherVariantId) => pub(ENEMY_MODEL_FILES[SCREACHER_VARIANTS[v].model].url);
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

describe('Screacher GLBs vs the asset contract (all four variants)', () => {
  const G = {} as Record<ScreacherVariantId, GLTF>, X = {} as Record<ScreacherVariantId, ScreacherExtras>;
  beforeAll(async () => {
    for (const v of VARIANTS) { G[v] = await loadStripped(glbOf(v)); X[v] = (G[v].scene.userData.enemyScreacher ?? {}) as ScreacherExtras; }
  }, 120_000);

  it('the four files are checked-in runtime inputs (no stand-in in the shipped game); the model table knows their sizes', () => {
    for (const v of VARIANTS) {
      expect(ENEMY_MODEL_FILES[SCREACHER_VARIANTS[v].model].url).toBe(`assets/models/enemy-screacher-${v}.glb`);
      expect(existsSync(glbOf(v)), v).toBe(true);
      const bytes = statSync(glbOf(v)).size;
      expect(Math.abs(ENEMY_MODEL_FILES[SCREACHER_VARIANTS[v].model].bytes - bytes) / bytes, `${v}: ENEMY_MODEL_FILES bytes vs ${bytes}`).toBeLessThan(0.1);
      expect(bytes).toBeLessThanOrEqual(3.2e6);
    }
  });

  it('each: one skinned body on the shared 18-joint skeleton; clips exactly Idle / Walk / Run / Attack / Hit / Death / Scream', () => {
    for (const v of VARIANTS) {
      const meshes = skinned(G[v].scene);
      expect(meshes.length, v).toBe(1);
      expect(meshes[0].skeleton.bones.map(b => b.name), v).toEqual(JOINT_NAMES);
      expect(G[v].animations.map(a => a.name).sort(), v).toEqual([...SCREACHER_CLIPS].sort());
    }
  });

  it('each: feet at the origin, 2.00 m to the top of the stump, its own variant id and name; NO head sphere in the extras', () => {
    for (const v of VARIANTS) {
      const e = X[v] as ScreacherExtras & Record<string, unknown>;
      expect(Object.keys(e).length, v).toBeGreaterThan(0);
      expect([e.variant, e.name]).toEqual([v, SCREACHER_VARIANTS[v].name]);
      const box = new THREE.Box3().setFromObject(G[v].scene);
      expect(Math.abs(box.min.y), v).toBeLessThan(0.03);
      expect(box.max.y, v).toBeGreaterThan(1.97);
      expect(box.max.y, v).toBeLessThan(2.03);
      expect(Math.abs(box.min.x + box.max.x) / 2, `${v}: centred`).toBeLessThan(0.25);
      expect(e.heightM).toBeCloseTo(2.0, 2);
      for (const k of ['head', 'headCenter', 'headRadius']) expect(e[k], `${v}: extras.${k}`).toBeUndefined();
      expect((e.hitRadii as Record<string, unknown> | undefined)?.head).toBeUndefined();
      // the stump's top is the top of the body
      expect(e.stump?.top?.[1], `${v}: stump top`).toBeGreaterThan(1.97);
      expect(e.stump!.top![1]).toBeLessThanOrEqual(2.005);
    }
  });

  it('SCREACHER_ASSET (the stats / reference numbers) === every GLB\'s extras; all four share one clip contract (one AI)', () => {
    for (const v of VARIANTS) {
      const e = X[v], clip = (n: string) => G[v].animations.find(a => a.name === n)!;
      expect(SCREACHER_ASSET.heightM).toBeCloseTo(e.heightM!, 3);
      expect(SCREACHER_ASSET.attackHitTime).toBeCloseTo(e.attackHitTime!, 3);
      expect(SCREACHER_ASSET.attackHitTime).toBeCloseTo(e.clips!.Attack.impactTime!, 3);
      expect(SCREACHER_ASSET.attackDuration).toBeCloseTo(e.clips!.Attack.duration ?? clip('Attack').duration, 3);
      expect(clip('Attack').duration).toBeCloseTo(SCREACHER_ASSET.attackDuration, 2);
      expect(SCREACHER_ASSET.walkGroundSpeed).toBeCloseTo(e.clips!.Walk.groundSpeed!, 3);
      expect(SCREACHER_ASSET.runGroundSpeed).toBeCloseTo(e.clips!.Run.groundSpeed!, 3);
      expect(SCREACHER_ASSET.screamCueTime).toBeCloseTo(e.screamCueTime!, 3);
      expect(SCREACHER_ASSET.screamCueTime).toBeCloseTo(e.clips!.Scream.cueTime!, 3);
      expect(clip('Scream').duration).toBeCloseTo(SCREACHER_ASSET.screamDuration, 2);
      // the striking hand reaches about the contract's 1.2 m in every body (the gameplay uses ONE reach for all four)
      expect(e.reachM, `${v}: reach`).toBeGreaterThanOrEqual(1.1);
      expect(e.reachM).toBeLessThanOrEqual(1.3);
      // per-variant measured hit radii: a lanky body
      expect(e.hitRadii!.torso!).toBeGreaterThan(0.1);
      expect(e.hitRadii!.torso!).toBeLessThan(0.32);
      expect(e.hitRadii!.arm!).toBeLessThan(0.12);
      expect(e.hitRadii!.leg!).toBeLessThan(0.14);
    }
    // identical clip durations across the four bodies
    const dur = (v: ScreacherVariantId) => Object.fromEntries(G[v].animations.map(a => [a.name, +a.duration.toFixed(3)]));
    for (const v of VARIANTS.slice(1)) expect(dur(v)).toEqual(dur(VARIANTS[0]));
    // the brain's timings are the contract's
    expect([SCREACHER_STATS.attackDuration, SCREACHER_STATS.attackImpact, SCREACHER_ECHO.cueS, SCREACHER_ECHO.holdS])
      .toEqual([SCREACHER_ASSET.attackDuration, SCREACHER_ASSET.attackHitTime, SCREACHER_ASSET.screamCueTime, SCREACHER_ASSET.screamDuration]);
  });

  it('the real actor of every variant: a rig; no head hit volume; volumes end at the stump; a shot over the stump misses; under 2.1 m', () => {
    for (const v of VARIANTS) {
      const a = new ScreacherActor(G[v], {x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, archetype: 'screacher', variant: v}, () => 0.999);
      a.root.position.y = 0;
      expect(a.hasRig, v).toBe(true);
      expect(a.variant).toBe(v);
      expect(a.scale).toBeLessThanOrEqual(SCREACHER_SCALE.max);
      a.animate(1 / 30, 'Idle', 0);
      const vols = a.updateVolumes();
      expect(vols.map(h => h.part), v).toEqual(['torso', 'limb', 'limb', 'limb', 'limb']);
      const box = new THREE.Box3().setFromObject(G[v].scene), top = box.max.y * a.scale;
      expect(top, v).toBeLessThan(SCREACHER_MAX_TOP_M);
      // no volume reaches above the body
      for (const h of vols) for (const p of [h.a, h.b ?? h.a]) expect(p.y + h.r, `${v}: volume top`).toBeLessThanOrEqual(top + 0.015);
      const torso = vols[0];
      expect(torso.b!.y, `${v}: the torso capsule ends just under the stump's base`).toBeGreaterThan(1.6 * a.scale);
      expect(torso.b!.y + torso.r, `${v}: its cap reaches the stump's top`).toBeGreaterThan(top - 0.06);
      // shots through the air above the stump (where a head would be): nothing; through the chest: a body hit
      const cx = torso.b!.x, cz = torso.b!.z;
      for (const dy of [0.03, 0.12, 0.2, 0.3]) expect(nearestEnemyHit({x: cx, y: top + dy, z: cz - 6}, {x: 0, y: 0, z: 1}, 20, [a]), `${v}: +${dy} m over the stump`).toBeNull();
      const chest = (torso.a.y + torso.b!.y) / 2;
      expect(nearestEnemyHit({x: (torso.a.x + cx) / 2, y: chest, z: cz - 6}, {x: 0, y: 0, z: 1}, 20, [a])?.part, v).toBe('torso');
    }
  });

  it('the Scream clip really moves the body by its cue time (it is not a copy of Idle), and the feet stay planted', () => {
    for (const v of VARIANTS) {
      const scene = G[v].scene, mixer = new THREE.AnimationMixer(scene);
      const pose = (name: string, t: number) => {
        mixer.stopAllAction();
        const act = mixer.clipAction(G[v].animations.find(c => c.name === name)!);
        act.reset().play();
        mixer.setTime(t);
        scene.updateMatrixWorld(true);
        const at = (b: string) => scene.getObjectByName(b)!.getWorldPosition(new THREE.Vector3());
        return {lh: at('L_Hand'), rh: at('R_Hand'), lf: at('L_Foot'), rf: at('R_Foot'), neck: at('Neck')};
      };
      const idle = pose('Idle', 0), cue = pose('Scream', SCREACHER_ASSET.screamCueTime), start = pose('Scream', 0);
      expect(cue.lh.distanceTo(idle.lh) + cue.rh.distanceTo(idle.rh), `${v}: hands move`).toBeGreaterThan(0.3);
      expect(cue.lf.distanceTo(start.lf), `${v}: left foot planted`).toBeLessThan(0.08);
      expect(cue.rf.distanceTo(start.rf), `${v}: right foot planted`).toBeLessThan(0.08);
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
    }
  });
});
