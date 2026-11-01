// Task studio-alpha-beyond-station-round4-20261101-01 (lane ASSET; textures: lane TEXTURE of the compliance follow-up, Codex
// projection bake) : the Strainer runtime derivative (enemy-strainer.glb) —
// the locally rigged / animated derivative of the accepted Meshy T2.5 image-to-3D body, its GLB extras contract (height,
// headshot sphere, claw reach / hit frame, clips) and its provenance sidecar / allowlist / credits. Runtime-independent: the
// GLB is parsed by three's GLTFLoader (textures stripped: no image decoder in node) and CPU-skinned through three's own
// AnimationMixer + SkinnedMesh path. (The runtime model table / spawning is the enemy-family integration's concern.)

import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
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
// lane TEXTURE (task studio-alpha-bts-round4-compliance-followup-20261101-01): the runtime maps are baked from two CODEX images
const CODEX_FRONT_SHA = 'bb297b9a04db913e85d51f40ae6d4c4ef9d7539344d87fe00b0198e9ae1987be'; // user-approved front T-pose
const CODEX_BACK_SHA = '0a0bf26d4ba808af2442138b375ef2677b028d3e30a2e633e8d78807a0963a6e'; // accepted Codex back view
// embedded images that must NOT ship: the Meshy provider maps (raw) and their re-encodes in the pre-bake GLB (30d4347c...)
const MESHY_MAP_SHAS = [
  'cb283413b22029bcee569c5f9f82a433191f92f52db0295af260b7cfe314d696', 'fc7973512a65278b5a71a9d30c6eba954a1af7a3b167c02ec258da851aa1a7f0', '750f66a14069eb77cc8bf5f12268b2063e63ef878e043c5ef279cf16c1be3af0',
  'be4b71251964d3e9d940362130c7816dce8b11bb08474618fc3a5489ce0556b5', '956c0f68ec0e8ad0971c84f9a50ac41f06c170e3db4e0972d530fa427289015c', '3319c11d8bddbef5075e064c282cd55fc8b969a1ea82c4d8f3771bef4858ff18',
];
// geometry / skin / animation / scene / material identity of the pre-bake GLB (tools/asset-pipeline/enemy/lib/strainer-texture-identity.mjs)
const IDENTITY = {
  geometry: '75d40fcf82867944630d3a60ee7b3393bc72f970f6682cf88d46e760b90f8f4e',
  skin: '1a32b0b9a4d8ef8b5a70e1ee08b0588961b940845ba17aa96dc5ebec8cfaf589',
  animation: 'dfdfc819d8977d59c2c827b7f1642a55f1a3e8ac154d55e237e94dff34d88260',
  scene: '813f854bb0c3515b92a38e37de7f636066f6999793dc9752ca3c20bbe96a99e6',
  material: '89d343d836fa2d1d7522c736acae6a871790fff0776fa259318988cdf2b3ea43',
};

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

  it('ships textures baked from the two Codex images only (no Meshy provider map at runtime)', async () => {
    const T = prov.textures;
    expect(T.runtimeSources).toBe('codex');
    expect(T.providerMapsUsedAtRuntime).toBe(false);
    expect(T.sources.front.sha256).toBe(CODEX_FRONT_SHA);
    expect(T.sources.back.sha256).toBe(CODEX_BACK_SHA);
    expect(T.sources.front.file).toBe('reference/tasks/strainer-tpose-20261101/pose/strainer-tpose-attempt2.png');
    expect(T.sources.back.file).toBe('reference/tasks/beyond-station-round4-followup-20261101/codex/strainer-back-attempt1.png');
    expect(T.sources.front.codex.route).toMatch(/codex-cli 0\.163\.0.*image_gen/);
    expect(T.sources.back.codex).toMatchObject({attempt: 1, promptSha256: expect.stringMatching(/^52df94c6/)});
    expect(prov.honesty.textures).toMatch(/ONLY from two Codex-generated images/);
    expect(prov.honesty.textures).toMatch(/Meshy provider maps are NOT used at runtime/);
    for (const k of ['baseColor', 'metallicRoughness', 'normal']) expect(prov.source.providerMaps[k].runtimeUse, k).toBe(false);
    // the bake is recorded with its registration and fill (IoU of the projected silhouette vs each Codex figure)
    for (const v of ['front', 'back']) {
      expect(T.registrationIoU[v].iou, v).toBeGreaterThan(0.8);
      for (const [r, iou] of Object.entries(T.registrationIoU[v].regions)) expect(iou as number, `${v} ${r}`).toBeGreaterThan(0.6);
    }
    expect(T.filledFraction).toBeGreaterThanOrEqual(0);
    expect(T.filledFraction).toBeLessThan(0.6);
    // the embedded images ARE the recorded bake outputs (sizes as documented) and none is a Meshy map / re-encode
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(pub(GLB));
    const mat = doc.getRoot().listMaterials()[0];
    const tex = {baseColor: mat.getBaseColorTexture()!, metallicRoughness: mat.getMetallicRoughnessTexture()!, normal: mat.getNormalTexture()!};
    for (const [k, t] of Object.entries(tex)) {
      const img = Buffer.from(t.getImage()!);
      expect(sha(img), k).toBe(T.bake.outputs[k].sha256);
      expect(MESHY_MAP_SHAS, k).not.toContain(sha(img));
      expect(t.getMimeType(), k).toBe('image/jpeg');
      expect(t.getSize(), k).toEqual(k === 'baseColor' ? [2048, 2048] : [1024, 1024]);
    }
    expect(doc.getRoot().listTextures()).toHaveLength(3);
    // the Codex sources live in the external reference/ tree (not in Git): re-verified when mounted
    for (const s of [T.sources.front, T.sources.back]) { const f = repo(s.file); if (existsSync(f)) expect(sha(readFileSync(f)), s.file).toBe(s.sha256); }
  });

  it('only the images changed: geometry, skin, animation, scene extras and material parameters equal the pre-bake GLB', async () => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(pub(GLB));
    const {strainerIdentity, STRAINER_IDENTITY} = await import(pathToFileURL(repo('tools/asset-pipeline/enemy/lib/strainer-texture-identity.mjs')).href);
    const got = strainerIdentity(doc);
    expect(got).toEqual(IDENTITY);
    expect(STRAINER_IDENTITY).toMatchObject(IDENTITY);
    expect(prov.textures.identity).toMatchObject(IDENTITY);
    expect(prov.mesh.geometryHash).toBe('29d46598dea492bb');
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
    expect(sec).toMatch(/Textures: derived only from Codex-generated sources/);
    expect(sec).toMatch(/Meshy provider texture maps are not used at runtime/);
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
