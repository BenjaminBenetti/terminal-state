// Task studio-alpha-beyond-station-round4-20261101-01 (lane ASSET): the Strainer runtime derivative (enemy-strainer.glb) —
// the locally rigged / animated derivative of the accepted Meshy T2.5 image-to-3D body, its GLB extras contract (height,
// headshot sphere, claw reach / hit frame, clips) and its provenance sidecar / allowlist / credits. Runtime-independent: the
// GLB is parsed by three's GLTFLoader (textures stripped: no image decoder in node) and CPU-skinned through three's own
// AnimationMixer + SkinnedMesh path. (The runtime model table / spawning is the enemy-family integration's concern.)

import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const GLB = 'assets/models/enemy-strainer.glb';
const SIDECAR = 'assets/derivatives/enemy-strainer.json';
const SOURCE_SHA = 'cfaa5c7068aab8271fc2f9c13076082aca8e473dbe1fff131ee2ac7f2a6b8b64';
const MESHY_TASK = '01a195f6-f769-7638-9bb6-48d52ba3c491';
const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const prov = JSON.parse(readFileSync(pub(SIDECAR), 'utf8'));

interface Extras {
  heightM: number; joints: string[]; bodyMesh: string; sourceSha256: string; meshyTaskId: string;
  headCenter: number[]; headRadius: number; head: {bone: string; offset: number[]};
  attackHitTime: number; reachM: number; attack: {hitTime: number; reachM: number; clawTipR: number[]; centreLineCrossingR: {t: number; y: number; z: number}};
  clipDurations: Record<string, number>;
  clips: Record<string, {duration: number; loop: boolean; groundSpeed?: number; impactTime?: number}>;
  hitRadii: {head: number; torso: number; arm: number; leg: number}; radius: number;
  footprint: {collider: {radius: number; narrowestOpeningM: number}};
}

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const skinnedMeshes = (root: THREE.Object3D) => { const out: THREE.SkinnedMesh[] = []; root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); }); return out; };

let gltf: GLTF, blight: GLTF;
let X: Extras;
beforeAll(async () => {
  [gltf, blight] = await Promise.all([loadStripped(GLB), loadStripped('assets/models/enemy-blightbelly.glb')]);
  X = gltf.scene.userData.enemyStrainer as Extras;
});

describe('Strainer derivative (enemy-strainer.glb)', () => {
  it('is the sidecar-recorded derivative of the accepted Meshy T2.5 body, with honest provenance', () => {
    const bytes = readFileSync(pub(GLB));
    expect(sha(bytes)).toBe(prov.outputs.glb.sha256);
    expect(bytes.length).toBe(prov.outputs.glb.bytes);
    expect(bytes.length).toBeLessThanOrEqual(3_200_000); // compact: not the raw 9.4 MB download
    expect(prov.source.sha256Verified).toBe(SOURCE_SHA);
    expect(prov.source.readOnly).toBe(true);
    expect(X.sourceSha256).toBe(SOURCE_SHA);
    expect(X.meshyTaskId).toBe(MESHY_TASK);
    const m = prov.source.meshy;
    expect(m.taskId).toBe(MESHY_TASK);
    expect(m.aiModel).toBe('meshy-t2.5');
    expect(m.settings).toMatchObject({ai_model: 'meshy-t2.5', model_type: 'smart-topology', pose_mode: 't-pose'});
    expect(m.smartTopology).toBe(true);
    expect(m.raw.glb.sha256).toBe(SOURCE_SHA);
    expect(m.inputImage.sha256).toMatch(/^bb297b9a/);
    expect(m.ledgerTotal).toMatchObject({bodyAttempts: 1, billedCredits: 15, accepted: 1});
    expect(prov.status).toMatchObject({approved: false, gameReady: false});
    expect(prov.status.licenseClearance).toMatch(/^none/);
    expect(prov.honesty.sourceHadSkeleton).toBe(false);
    expect(prov.honesty.generation).toMatch(/no AI generation/);
    expect(prov.honesty.animation).toMatch(/NOT motion capture/);
    expect(prov.generatedBy).toBe('tools/asset-pipeline/enemy/build-strainer.mjs');
    // public provenance carries repository-relative paths only (no local absolute paths, URLs or tokens)
    const text = readFileSync(pub(SIDECAR), 'utf8');
    expect(text).not.toMatch(/\/workspaces?\/|\/home\/|https?:\/\/|api[_-]?key|token/i);
    // the raw source (external reference/, not in Git) is never written by the builder
    const raw = repo(prov.source.file);
    if (existsSync(raw)) expect(sha(readFileSync(raw))).toBe(SOURCE_SHA);
  });

  it('is allowlisted at its current bytes and credited', () => {
    const allow = JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    for (const rel of [GLB, SIDECAR, 'assets/CREDITS.md']) {
      const e = allow.files.find(f => f.path === rel)!;
      expect(e, rel).toBeTruthy();
      const b = readFileSync(pub(rel));
      expect(e.bytes, rel).toBe(b.length);
      expect(e.sha256, rel).toBe(sha(b));
    }
    const credits = readFileSync(pub('assets/CREDITS.md'), 'utf8');
    const sec = credits.slice(credits.indexOf('<!-- BEGIN enemy-strainer-20261101'), credits.indexOf('<!-- END enemy-strainer-20261101 -->'));
    expect(sec).toContain(GLB);
    expect(sec).toContain(MESHY_TASK);
    expect(sec).toMatch(/Meshy T2\.5 image-to-3D/);
    expect(sec).toMatch(/Codex/);
    expect(sec).toMatch(/AI-generated asset/);
    expect(sec).toMatch(/no licence or commercial clearance implied/);
    expect(sec).not.toMatch(/\/workspaces?\/|\/home\//);
  });

  it('has the shared 18-joint skeleton (same names / order as the Blightbelly), one skinned body and normalised weights', () => {
    const meshes = skinnedMeshes(gltf.scene);
    expect(meshes.map(m => m.name)).toEqual(['StrainerBody']);
    const body = meshes[0];
    const shared = skinnedMeshes(blight.scene)[0].skeleton.bones.map(b => b.name);
    expect(shared.length).toBe(18);
    expect(body.skeleton.bones.map(b => b.name)).toEqual(shared);
    expect(X.joints).toEqual(shared);
    for (const b of body.skeleton.bones) expect(b.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    expect(body.geometry.index!.count / 3).toBe(prov.mesh.triangles);
    expect(prov.mesh.triangles).toBeGreaterThan(20_000);
    const w = body.geometry.getAttribute('skinWeight');
    let bad = 0;
    for (let i = 0; i < w.count; i++) if (Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) > 0.01) bad++;
    expect(bad).toBe(0);
    const used = new Set<number>();
    const ji = body.geometry.getAttribute('skinIndex');
    for (let i = 0; i < ji.count; i++) for (let k = 0; k < 4; k++) if (w.getComponent(i, k) > 0.05) used.add(ji.getComponent(i, k));
    expect(used.has(0)).toBe(false);
    for (let j = 1; j < shared.length; j++) expect(used.has(j), shared[j]).toBe(true);
  });

  it('is placed like the Blightbelly: 2.15 m tall, feet midpoint at the origin, facing +Z', () => {
    expect(X.heightM).toBeCloseTo(2.15, 1);
    expect(Math.abs(X.heightM - 2.15)).toBeLessThanOrEqual(0.02);
    const body = skinnedMeshes(gltf.scene)[0];
    body.geometry.computeBoundingBox();
    const bb = body.geometry.boundingBox!;
    expect(bb.min.y).toBeCloseTo(0, 2);
    expect(Math.abs(bb.max.y - 2.15)).toBeLessThanOrEqual(0.02);
    // feet: the vertices below 4 cm split left / right, their bbox-centre midpoint at the origin; toes toward +Z
    const p = body.geometry.getAttribute('position');
    const L = {x: [Infinity, -Infinity], z: [Infinity, -Infinity]}, R = {x: [Infinity, -Infinity], z: [Infinity, -Infinity]};
    let toeZ = -Infinity, heelZ = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.04) continue;
      const s = p.getX(i) > 0 ? L : R;
      s.x = [Math.min(s.x[0], p.getX(i)), Math.max(s.x[1], p.getX(i))]; s.z = [Math.min(s.z[0], p.getZ(i)), Math.max(s.z[1], p.getZ(i))];
      toeZ = Math.max(toeZ, p.getZ(i)); heelZ = Math.min(heelZ, p.getZ(i));
    }
    expect(Math.abs((L.x[0] + L.x[1] + R.x[0] + R.x[1]) / 4)).toBeLessThan(0.01);
    expect(Math.abs((L.z[0] + L.z[1] + R.z[0] + R.z[1]) / 4)).toBeLessThan(0.01);
    expect(toeZ).toBeGreaterThan(-heelZ * 0.5); // toes forward of the heels
    expect(X.headCenter[2]).toBeGreaterThan(0); // the hunched crown leans forward (+Z)
  });

  it('carries the six clips with the Blightbelly clip names and the documented contract', () => {
    expect(gltf.animations.map(a => a.name).sort()).toEqual(blight.animations.map(a => a.name).sort());
    expect(gltf.animations.map(a => a.name).sort()).toEqual([...CLIPS].sort());
    for (const c of CLIPS) {
      const clip = gltf.animations.find(a => a.name === c)!;
      expect(clip.duration, c).toBeCloseTo(X.clips[c].duration, 3);
      expect(X.clipDurations[c]).toBe(X.clips[c].duration);
      expect(prov.clips.meta[c].duration).toBe(X.clips[c].duration);
      expect(X.clips[c].loop).toBe(['Idle', 'Walk', 'Run'].includes(c));
    }
    expect(X.clips.Walk.groundSpeed!).toBeGreaterThan(0.3);
    expect(X.clips.Run.groundSpeed!).toBeGreaterThan(X.clips.Walk.groundSpeed!);
    expect(X.attackHitTime).toBe(X.clips.Attack.impactTime);
    expect(X.attack.hitTime).toBe(X.attackHitTime);
    expect(X.attackHitTime).toBeGreaterThan(0.2);
    expect(X.attackHitTime).toBeLessThan(X.clips.Attack.duration);
    expect(prov.clips.runtime).toMatchObject({attackDuration: X.clips.Attack.duration, attackImpact: X.attackHitTime, attackReachM: X.reachM});
  });

  it('exports a headshot sphere on the crown and a long claw reach through the chest-height target zone', () => {
    expect(X.headCenter).toHaveLength(3);
    expect(X.headCenter.every(Number.isFinite)).toBe(true);
    expect(X.headCenter[1]).toBeGreaterThan(1.75);
    expect(X.headRadius).toBeGreaterThan(0.1);
    expect(X.headRadius).toBeLessThan(0.4);
    // the sphere rides the Head bone: bind Head joint + offset = centre
    gltf.scene.updateMatrixWorld(true);
    const head = gltf.scene.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
    expect(X.head.bone).toBe('Head');
    expect(head.clone().add(new THREE.Vector3(...X.head.offset)).distanceTo(new THREE.Vector3(...X.headCenter))).toBeLessThan(1e-3);
    // the claw reach at the hit frame: horizontal root -> claw tip, longer than an ordinary zombie's arm
    expect(X.reachM).toBe(X.attack.reachM);
    expect(X.reachM).toBeGreaterThan(1.2);
    expect(X.reachM).toBeLessThan(2.0);
    expect(X.attack.clawTipR[1]).toBeGreaterThan(1.1); // chest height (~1.3 m on a 1.78 m target)
    expect(X.attack.clawTipR[1]).toBeLessThan(1.6);
    expect(X.attack.clawTipR[2]).toBeGreaterThan(1.0); // in front
    const cross = X.attack.centreLineCrossingR;
    expect(Math.abs(cross.t - X.attackHitTime)).toBeLessThan(0.05);
    expect(cross.y).toBeGreaterThan(1.1);
    expect(cross.y).toBeLessThan(1.6);
    // hit volumes / collider still pass a 1.0 m doorway
    for (const k of ['head', 'torso', 'arm', 'leg'] as const) { expect(X.hitRadii[k], k).toBeGreaterThan(0); expect(X.hitRadii[k], k).toBeLessThan(0.5); }
    expect(2 * X.radius).toBeLessThan(1.0 - 0.1);
    expect(X.footprint.collider).toMatchObject({radius: X.radius, narrowestOpeningM: 1});
  });

  it('keeps the feet on the floor in every clip (three.js mixer + CPU skinning of the GLB) and passed the builder audits', () => {
    const root = gltf.scene;
    const body = skinnedMeshes(root)[0];
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
    const V = prov.verification;
    for (const c of CLIPS) expect(V.cpuSkinningFloor[c].framesBelowMinus1cm, c).toBe(0);
    for (const c of ['Walk', 'Run']) for (const s of ['L', 'R']) expect(V.cpuSkinningFloor[c].feet[s].stanceLowestPointMaxY, `${c} ${s} planted`).toBeLessThan(0.02);
    for (const c of ['Idle', 'Walk', 'Run']) expect(V.footSkate[c].maxSlipMps, `${c} no skating`).toBeLessThan(0.05);
    expect(V.motionStretch.p99).toBeLessThan(2.5);
    expect(V.motionStretch.fractionOver).toBeLessThan(0.01);
    for (const c of CLIPS) expect(V.clearance.armsVsTorso[c].maxDepthM, `${c} arms clear of the torso`).toBeLessThan(0.05);
    for (const c of CLIPS) expect(V.clearance.clawsVsLegs[c].maxDepthM, `${c} claws clear of the legs`).toBeLessThan(0.05);
  });
});

// User rule (root CLAUDE.md "Textures — Codex for INITIAL sources; Meshy keeps its model maps", user correction 2026-11-01: "You do
// codex -> meshy"): Codex makes the INITIAL source (the approved T-pose), Meshy turns it into the model, and the model KEEPS the
// texture / PBR maps Meshy generated (re-encoded only). The round-4 follow-up wrongly replaced them with a Codex projection bake; it
// was reverted. This contract pins the chain and the exact Meshy-mapped runtime output so a replacement cannot silently return.
describe('Strainer texture source contract: Codex initial source -> Meshy model -> its Meshy maps kept', () => {
  const RUNTIME = {bytes: 2_377_612, sha256: '30d4347c2556f035bc3cd662db4227c2d9255cecf582ea578a35b16b3459736a'};
  const CODEX_TPOSE = 'bb297b9a04db913e85d51f40ae6d4c4ef9d7539344d87fe00b0198e9ae1987be';
  const MESHY_MAPS = ['base_color.png', 'metallic.png', 'normal.png', 'roughness.png'];

  it('the INITIAL source is the approved Codex T-pose, fed to the one accepted Meshy image-to-3D task', () => {
    const m = prov.source.meshy;
    expect(m.inputImage).toMatchObject({file: 'reference/tasks/strainer-tpose-20261101/pose/strainer-tpose-attempt2.png', sha256: CODEX_TPOSE});
    expect(m.taskId).toBe(MESHY_TASK);
    expect(m.raw.glb.sha256).toBe(SOURCE_SHA);
  });

  it('the runtime maps ARE the Meshy model output (re-encoded only): the provider maps are recorded, nothing replaced them', () => {
    expect(Object.keys(prov.source.meshy.raw.providerMaps).sort()).toEqual(MESHY_MAPS);
    for (const f of MESHY_MAPS) expect(prov.source.meshy.raw.providerMaps[f], f).toMatch(/^[0-9a-f]{64}$/);
    const T = prov.outputs.textures;
    expect(T.baseColor).toMatchObject({size: 2048, edits: 'none (re-encode only)'});
    expect(T.metallicRoughness.size).toBe(1024);
    expect(T.metallicRoughness.format).toMatch(/source packed map/);
    expect(T.normal.size).toBe(1024);
    expect(T.normal.format).toMatch(/source map resized/);
    // no projection / bake / replacement texture source anywhere in the provenance
    expect(readFileSync(pub(SIDECAR), 'utf8')).not.toMatch(/projection|reproject|texture-bake|strainer-back|codex\/strainer/i);
  });

  it('ships exactly the Meshy-mapped runtime GLB (the accepted round-4 output), whose three images are the recorded re-encodes', async () => {
    const bytes = readFileSync(pub(GLB));
    expect({bytes: bytes.length, sha256: sha(bytes)}).toEqual(RUNTIME);
    expect(prov.outputs.glb).toMatchObject(RUNTIME);
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(pub(GLB));
    const sizes = doc.getRoot().listTextures().map(t => t.getImage()!.byteLength).sort((a, b) => a - b);
    const T = prov.outputs.textures;
    expect(sizes).toEqual([T.baseColor.bytes, T.metallicRoughness.bytes, T.normal.bytes].sort((a, b) => a - b));
  });
});
