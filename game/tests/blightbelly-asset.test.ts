// Task track1-siren-blightbelly-20261031 (lane RIGB): the Blightbelly runtime derivative (enemy-blightbelly.glb) — the
// rigged / animated / pustule-covered derivative of the accepted Meshy T2.5 model, its GLB extras contract (clips, hit
// volumes, collider, burst points) and its provenance sidecar. Runtime-independent: the GLB is parsed by three's GLTFLoader
// (textures stripped: no image decoder in node) and CPU-skinned through three's own AnimationMixer + SkinnedMesh path.

import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MODEL_FILES} from '../src/assets/manifest';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const GLB = 'assets/models/enemy-blightbelly.glb';
const SOURCE_SHA = '478b2b338ceaf98ffa57ad37796744f64365b74b5ea8d935813b21b77e0346a5';
const PREVIEW_TASK = '01a18f47-ef88-70c2-add2-230a05fe5cd1';
const REFINE_TASK = '01a18f48-a0cd-744a-83e4-92ffccf69b39';
const JOINT_NAMES = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const prov = JSON.parse(readFileSync(pub('assets/derivatives/enemy-blightbelly.json'), 'utf8'));

interface Extras {
  heightM: number; radius: number; joints: string[]; bodyMesh: string; pustuleMesh: string;
  clips: Record<string, {duration: number; loop: boolean; groundSpeed?: number; impactTime?: number; burstTime?: number}>;
  hitRadii: {head: number; torso: number; torsoP90: number; arm: number; leg: number; belly: {bone: string; offset: number[]; r: number}};
  footprint: {torsoRadiusP95: number; collider: {radius: number; narrowestOpeningM: number; clearancePerSideM: number}};
  pustules: {bone: string; offset: number[]; r: number; normal?: number[]}[];
}

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

let gltf: GLTF;
let X: Extras;
beforeAll(async () => { gltf = await loadStripped(GLB); X = gltf.scene.userData.enemyBlightbelly as Extras; });

const skinnedMeshes = (root: THREE.Object3D) => { const out: THREE.SkinnedMesh[] = []; root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); }); return out; };

describe('Blightbelly derivative (enemy-blightbelly.glb)', () => {
  it('is the sidecar-recorded derivative of the accepted Meshy T2.5 model, with honest provenance', () => {
    const bytes = readFileSync(pub(GLB));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(prov.outputs.glb.sha256);
    expect(bytes.length).toBe(prov.outputs.glb.bytes);
    expect(bytes.length).toBeLessThanOrEqual(3_000_000); // compact: no raw 8.7 MB maps
    expect(prov.source.sha256Verified).toBe(SOURCE_SHA);
    expect(prov.source.readOnly).toBe(true);
    const m = prov.source.meshy;
    expect(m.aiModel).toBe('meshy-t2.5');
    expect(m.model).toBe('meshy-t2.5');
    expect(m.modelType).toBe('smart-topology');
    expect(m.smartTopology).toBe(true);
    expect(m.preview.taskId).toBe(PREVIEW_TASK);
    expect(m.refine.taskId).toBe(REFINE_TASK);
    expect(m.refine.sha256).toBe(SOURCE_SHA);
    expect(m.refine.inheritsPreview).toContain(PREVIEW_TASK);
    expect(m.ledgerTotal).toMatchObject({posts: 3, credits: 20});
    // derivative honesty: unapproved, no licence clearance, no generation by the builder, procedural (not mocap) clips
    expect(prov.status).toMatchObject({approved: false, gameReady: false});
    expect(prov.status.licenseClearance).toMatch(/^none/);
    expect(prov.honesty.sourceHadSkeleton).toBe(false);
    expect(prov.honesty.generation).toMatch(/no AI generation/);
    expect(prov.honesty.animation).toMatch(/NOT motion capture/);
    expect(prov.generatedBy).toBe('tools/asset-pipeline/enemy/build-blightbelly.mjs');
    // the raw source (external reference/, not in Git) is never written by the builder
    const raw = fileURLToPath(new URL('../../' + prov.source.file, import.meta.url));
    if (existsSync(raw)) expect(createHash('sha256').update(readFileSync(raw)).digest('hex')).toBe(SOURCE_SHA);
  });

  it('is loaded per level (lazy enemy model table), never as an ordinary zombie body', () => {
    expect(ENEMY_MODEL_FILES.enemy_blightbelly.url).toBe(GLB);
    const bytes = readFileSync(pub(GLB)).length;
    expect(Math.abs(ENEMY_MODEL_FILES.enemy_blightbelly.bytes - bytes) / bytes).toBeLessThan(0.1);
    // not in the boot preload and not a wardrobe body / outfit
    expect(Object.values(MODEL_FILES).some(f => f.url === GLB)).toBe(false);
    expect(Object.keys(MODEL_FILES).some(k => /blight/i.test(k))).toBe(false);
    const wardrobe = JSON.parse(readFileSync(pub('assets/derivatives/zombie-wardrobe.json'), 'utf8'));
    expect(Object.keys(wardrobe.bodies)).not.toContain('blightbelly');
  });

  it('has the shared 18-joint skeleton, two skinned meshes on one skin and normalised weights', () => {
    const meshes = skinnedMeshes(gltf.scene);
    expect(meshes.map(m => m.name).sort()).toEqual(['BlightbellyBody', 'BlightbellyPustules']);
    const [body, pust] = [X.bodyMesh, X.pustuleMesh].map(n => meshes.find(m => m.name === n)!);
    expect(body.skeleton.bones.map(b => b.name)).toEqual(JOINT_NAMES);
    expect(pust.skeleton.bones.map(b => b.name)).toEqual(JOINT_NAMES);
    expect(X.joints).toEqual(JOINT_NAMES);
    // identity bind rotations (bind frame = model frame: burst-point offsets / hit offsets are model-space vectors)
    for (const b of body.skeleton.bones) expect(b.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    expect(body.geometry.index!.count / 3).toBeGreaterThan(20_000);
    expect(prov.mesh.triangles).toBe(body.geometry.index!.count / 3);
    for (const m of [body, pust]) {
      const w = m.geometry.getAttribute('skinWeight');
      let bad = 0;
      for (let i = 0; i < w.count; i++) if (Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) > 0.01) bad++;
      expect(bad, m.name).toBe(0);
    }
    // every deforming bone drives skin (Root never does)
    const used = new Set<number>();
    const ji = body.geometry.getAttribute('skinIndex'), wi = body.geometry.getAttribute('skinWeight');
    for (let i = 0; i < ji.count; i++) for (let k = 0; k < 4; k++) if (wi.getComponent(i, k) > 0.05) used.add(ji.getComponent(i, k));
    expect(used.has(0)).toBe(false);
    for (let j = 1; j < JOINT_NAMES.length; j++) expect(used.has(j), JOINT_NAMES[j]).toBe(true);
  });

  it('carries the six heavy clips with the documented clip contract', () => {
    expect(gltf.animations.map(a => a.name).sort()).toEqual([...CLIPS].sort());
    const spec = {Idle: [3.6, true], Walk: [1.4, true], Run: [0.8, true], Attack: [1.5, false], Hit: [0.5, false], Death: [2.3, false]} as const;
    for (const c of CLIPS) {
      const clip = gltf.animations.find(a => a.name === c)!;
      expect(clip.duration, c).toBeCloseTo(spec[c as keyof typeof spec][0], 3);
      expect(X.clips[c]).toMatchObject({duration: spec[c as keyof typeof spec][0], loop: spec[c as keyof typeof spec][1]});
      expect(prov.clips.meta[c].duration).toBe(X.clips[c].duration);
    }
    // heavier / slower than the ordinary zombie (Attack 1.1 s impact 0.45 s, Walk 0.55 / Run 2.3 m/s)
    expect(X.clips.Attack.impactTime).toBe(0.7);
    expect(X.clips.Attack.impactTime!).toBeLessThan(X.clips.Attack.duration);
    expect(prov.clips.runtime).toMatchObject({attackDuration: 1.5, attackImpact: 0.7});
    expect(X.clips.Walk.groundSpeed).toBe(0.4);
    expect(X.clips.Run.groundSpeed).toBe(1.5);
    expect(X.clips.Death.burstTime!).toBeGreaterThan(0);
    expect(X.clips.Death.burstTime!).toBeLessThan(X.clips.Death.duration);
  });

  it('exports hit volumes / collider wider than an ordinary zombie that still pass a 1.0 m doorway', () => {
    expect(X.heightM).toBeGreaterThanOrEqual(1.8);
    expect(X.heightM).toBeLessThanOrEqual(1.9);
    const H = X.hitRadii;
    for (const k of ['head', 'torso', 'torsoP90', 'arm', 'leg'] as const) { expect(H[k], k).toBeGreaterThan(0); expect(H[k], k).toBeLessThan(0.5); }
    expect(H.torso).toBeGreaterThan(0.3); // obese: wider than the wardrobe bodies' capped 0.3
    expect(JOINT_NAMES).toContain(H.belly.bone);
    expect(H.belly.offset[2]).toBeGreaterThan(0.05); // belly sphere sits in FRONT of the spine
    expect(H.belly.r).toBeGreaterThan(0.25);
    expect(X.radius).toBeGreaterThan(0.38); // coated zombie 0.38
    expect(2 * X.radius).toBeLessThan(1.0 - 0.1); // 2-cell doors (1.0 m) with clearance
    expect(X.footprint.collider).toMatchObject({radius: X.radius, narrowestOpeningM: 1});
    expect(X.radius).toBeGreaterThanOrEqual(X.footprint.torsoRadiusP95);
  });

  it('exports seeded rig-bound pustule burst points that sit on the pustule domes', () => {
    expect(X.pustules.length).toBeGreaterThanOrEqual(10);
    expect(X.pustules.length).toBeLessThanOrEqual(30);
    const allowed = new Set(['Chest', 'Spine', 'Hips', 'Neck', 'L_UpperArm', 'R_UpperArm']);
    const pust = skinnedMeshes(gltf.scene).find(m => m.name === X.pustuleMesh)!;
    gltf.scene.updateMatrixWorld(true);
    const pos = pust.geometry.getAttribute('position');
    const bindOf = (name: string) => gltf.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
    for (const p of X.pustules) {
      expect(allowed.has(p.bone), p.bone).toBe(true);
      expect(p.offset.every(Number.isFinite)).toBe(true);
      expect(p.r).toBeGreaterThan(0.01);
      expect(p.r).toBeLessThan(0.2);
      const at = bindOf(p.bone).add(new THREE.Vector3(...p.offset));
      let best = Infinity;
      for (let i = 0; i < pos.count; i++) best = Math.min(best, at.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i)));
      expect(best, `${p.bone} burst point near its domes`).toBeLessThan(0.03);
    }
    expect(prov.pustules.domes).toBeGreaterThanOrEqual(24); // "a few dozen"
    expect(prov.pustules.spec.seed).toBeTypeOf('number');
  });

  it('keeps the feet on the floor in every clip (three.js mixer + CPU skinning of the GLB)', () => {
    const root = gltf.scene;
    const body = skinnedMeshes(root).find(m => m.name === X.bodyMesh)!;
    const mixer = new THREE.AnimationMixer(root);
    const v = new THREE.Vector3();
    for (const c of CLIPS) {
      const clip = gltf.animations.find(a => a.name === c)!;
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.reset().play();
      let lowest = Infinity;
      for (let k = 0; k <= 8; k++) {
        action.time = (k / 8) * clip.duration * 0.999;
        mixer.update(0);
        root.updateMatrixWorld(true);
        body.skeleton.update();
        let minY = Infinity;
        for (let i = 0; i < body.geometry.getAttribute('position').count; i += 3) { body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld); minY = Math.min(minY, v.y); }
        lowest = Math.min(lowest, minY);
        if (c === 'Idle' || c === 'Walk' || c === 'Run') expect(minY, `${c} frame ${k}: a foot on the floor`).toBeLessThan(0.03);
      }
      expect(lowest, `${c}: nothing sinks below the floor`).toBeGreaterThan(-0.01);
      action.stop();
    }
    // the builder's full per-frame verification agrees
    for (const c of CLIPS) expect(prov.verification.cpuSkinningFloor[c].framesBelowMinus1cm, c).toBe(0);
    for (const c of ['Walk', 'Run']) for (const s of ['L', 'R']) expect(prov.verification.cpuSkinningFloor[c].feet[s].stanceLowestPointMaxY, `${c} ${s} planted`).toBeLessThan(0.02);
  });
});
