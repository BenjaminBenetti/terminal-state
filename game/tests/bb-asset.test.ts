// Task studio-bb-models-20261112-234540-01: the four BB runtime bodies (enemy-bb-<variant>.glb), the locally rigged / skinned
// derivatives of the four Meshy T2.5 image-to-3D bodies (one enemy family, four looks: Lullaby, Binky, Teddy, Changeling), their
// GLB extras contract (`enemyBb`, BB-ASSET-CONTRACT v1: standing bind at 0.85 m, head sphere, hit radii, palm / knee / toe / heel
// contacts, crown and fingertip ends, collider radius, skin audit) and their hash-only provenance sidecars / allowlist / credits.
// The bodies carry NO clips: the game poses the bind joints at runtime. Runtime-independent: each GLB is parsed by three's
// GLTFLoader (textures stripped: no image decoder in node) and skinned through three's own SkinnedMesh path. Needs neither the
// private raw masters nor git history.

import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const TASK = 'studio-bb-models-20261112-234540-01';

/** The shared 18-joint humanoid skeleton (zombie bodies, Blightbelly, Strainer, Screacher): names and order. */
const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
/** The contract's pose envelope (degrees from the bind; arms from hanging) and its four key poses: the skin audit covers them all. */
const ENVELOPE: Record<string, [number, number]> = {
  hipFlexion: [-25, 110], hipAbduction: [0, 40], kneeFlexion: [0, 135],
  shoulderFlexionFromHanging: [-30, 170], shoulderAbductionFromHanging: [0, 110], elbowFlexion: [0, 125],
  trunkForwardBend: [-25, 35], trunkTwist: [-25, 25], trunkSideBend: [-20, 20],
  neckPlusHeadExtension: [-30, 75], headYaw: [-70, 70], headRoll: [-25, 25],
};
const KEY_POSES = ['CRAWL', 'WINDUP', 'POUNCE', 'TWITCH'];

/**
 * The four Meshy bodies (hash-only public provenance) and the three texture images each runtime GLB carries: the provider's own
 * maps, resized / re-encoded only ("Meshy maps kept": root CLAUDE.md texture rule). A replacement texture, a repaint or a
 * different source would change these hashes.
 */
const VARIANTS = [
  {v: 'lullaby', look: 'A', name: 'Lullaby', triangles: 20201, meshyTask: '01a1d238-d41c-7639-a90a-89eee05f533c',
    source: {sha256: '2365e02689bca0781772e4ab6c8c50b2fd03c1908d3aec9524614272e0e29eed', bytes: 9458728}, inputImage: '9c0f695e480d75e9974f364f119c38e8ed638221225bc9dafbce250e95a165c1', concept: '72242713fa5329fd158f5c4ab25b36c222a2164d7e4ccce05cc12c4bdd0dc17f',
    images: {baseColor: '503661dceec9d0824856052cbe570587e51770c485efe6a70147ede7f47d67df', metallicRoughness: 'f7029172ffa66eb87cc06cd18aa3681a18ee3885bb31e27d1a956738ccb76ea1', normal: '821bf0e1f71b1cc79dfd51f134e7503a893438584d9a96f530d039d47fc0124e'}},
  {v: 'binky', look: 'B', name: 'Binky', triangles: 20302, meshyTask: '01a1d238-dbe9-75fb-80a8-31186ca71e65',
    source: {sha256: '55e79a322ecd9dbda8477c62d4492eadf283d945984ac6618747dcbf9e4014e0', bytes: 9400484}, inputImage: 'eff082742986dc2c2e0e568fbd51ce052ffe9ff6908ef1747c94ddf2332f8806', concept: '697c27e592e436efe554b8144abd084d560e7e3336c5098a1af256480d44f395',
    images: {baseColor: '368466589fb7ad4d2b896cad36e1830ca0cece351169cf01fa3a0ceab5f1a1d7', metallicRoughness: '2befe97d080ef8c531301eb2ce0849de22c04bfaed952106064e1158c4b08f23', normal: 'd2e83121a5cebde891d097c41c6b4059635da84eb9cf113b86cb53cb6b54fbce'}},
  {v: 'teddy', look: 'C', name: 'Teddy', triangles: 20728, meshyTask: '01a1d238-e41c-7526-8481-9f7377b26d46',
    source: {sha256: '172b9dbd15d4cb0c46659dba4888a7dcda428ce26bb7f7ac99d9e8a2eae4cb52', bytes: 9116644}, inputImage: '97fbdbadd93179d81c144631b9e3f1a59593403ac53ff1465c360137e2aa83bd', concept: 'f35c4a77406fb8d5fad7fbcd7a2fb0528456e858f74d6f8b202ff26686b04ce9',
    images: {baseColor: '0209057374749a1c06cf6e7c1a6d0125b627508dd0eaf2f3e561c7faa2feed78', metallicRoughness: 'b475f01e6b581248bfd80be29972500101f028f185d0a2e11ba70aab21f107ea', normal: '85499312bbd51ae56ec7069874a6b0e1d6bdc364ad147f7c3c4016f779edc895'}},
  {v: 'changeling', look: 'D', name: 'Changeling', triangles: 21096, meshyTask: '01a1d238-ec04-76ee-a49d-62e84a27a0e0',
    source: {sha256: 'c1f141338d4f87437cd9fe567660de3c8cfa28effb6d6f4ea69297f064cf5318', bytes: 8888248}, inputImage: 'd62a008250810bba8f928740b80925bb2a53615efc976879a4e9907d2ff92b2a', concept: 'fc61ab20af9ea43a9e07bb05e4cceb238d281d86d1130aae543747123a9f0e1c',
    images: {baseColor: 'd8698209966b8422281762f9f7e1b08d8b30a1d3e66d78618e943358baf0f9e7', metallicRoughness: '0fda98008dc2b4973ad0bec1730cb14bb420c5c39412db1889d95f06bb740c98', normal: '08aa5273d5c7c724c72ba1182f8311c8496886cc20857a5f4472dba156387866'}},
] as const;
type Variant = (typeof VARIANTS)[number];
const glbOf = (v: string) => `assets/models/enemy-bb-${v}.glb`;
const sidecarOf = (v: string) => `assets/derivatives/enemy-bb-${v}.json`;

type V3 = [number, number, number];
interface Extras {
  version: number; archetype: string; variant: string; name: string; task: string; bindPose: string;
  heightM: number; joints: string[]; bodyMesh: string; sourceSha256: string; meshyTaskId: string;
  head: {centre: V3; radius: number};
  hitRadii: {torso: number; arm: number; leg: number}; radius: number;
  contact: {palm: {L: V3; R: V3}; kneeFront: {L: number; R: number}; toe: {L: V3; R: V3}; heel: {L: V3; R: V3}};
  ends: {Head: V3; L_Hand: V3; R_Hand: V3};
  skinAudit: {maxStretch: number; p99: number; over3x: number; poses: {pose: string; p99: number; max: number}[]; crawlPose: {lengthM: number; widthM: number; heightM: number}};
  boundsM: {min: V3; max: V3};
}

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const skinnedMeshes = (root: THREE.Object3D) => { const out: THREE.SkinnedMesh[] = []; root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); }); return out; };
/** Width / height of a baseline or progressive JPEG (SOF0..SOF2 marker). */
function jpegSize(b: Uint8Array): [number, number] {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('bad JPEG marker');
    const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xc2) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

const loaded = new Map<string, GLTF>();
const bindLocal = new WeakMap<GLTF, Map<THREE.Object3D, {p: THREE.Vector3; q: THREE.Quaternion}>>();
async function need(vs: readonly string[]) {
  for (const v of vs) {
    if (loaded.has(v)) continue;
    const g = await loadStripped(glbOf(v));
    const m = new Map<THREE.Object3D, {p: THREE.Vector3; q: THREE.Quaternion}>();
    for (const b of skinnedMeshes(g.scene)[0].skeleton.bones) m.set(b, {p: b.position.clone(), q: b.quaternion.clone()});
    bindLocal.set(g, m);
    loaded.set(v, g);
  }
}
/** Put a loaded GLB back into its bind pose (the tests share the loaded scenes; an earlier test may have left it posed). */
function toBind(gltf: GLTF) {
  for (const [b, t] of bindLocal.get(gltf)!) { b.position.copy(t.p); b.quaternion.copy(t.q); }
  gltf.scene.updateMatrixWorld(true);
  for (const m of skinnedMeshes(gltf.scene)) m.skeleton.update();
}
const provOf = (V: Variant) => JSON.parse(readFileSync(pub(sidecarOf(V.v)), 'utf8'));
const extrasOf = (V: Variant) => loaded.get(V.v)!.scene.userData.enemyBb as Extras;
const boneWorld = (gltf: GLTF, name: string) => gltf.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());

describe.each(VARIANTS.map(V => [V.v, V] as const))('BB body %s (enemy-bb-<variant>.glb)', (_v, V) => {
  beforeAll(() => need([V.v]), 120_000);

  it('is the sidecar-recorded derivative of its Meshy T2.5 body, with honest hash-only provenance', () => {
    const prov = provOf(V), X = extrasOf(V);
    const bytes = readFileSync(pub(glbOf(V.v)));
    expect(sha(bytes)).toBe(prov.outputs.glb.sha256);
    expect(bytes.length).toBe(prov.outputs.glb.bytes);
    expect(prov.outputs.glb.path).toBe('game/public/' + glbOf(V.v));
    expect(bytes.length).toBeLessThanOrEqual(2_800_000); // the contract's maxBytes (not the raw ~9 MB download)
    expect(prov.asset).toBe(`enemy-bb-${V.v}`);
    expect(prov.task).toBe(TASK);
    expect(prov.generatedBy).toBe('tools/asset-pipeline/enemy/build-bb.mjs');
    expect(prov.family).toMatchObject({archetype: 'bb', variant: V.v, look: V.look, name: V.name, variants: ['lullaby', 'binky', 'teddy', 'changeling']});
    expect(prov.runtime).toMatchObject({modelKey: `enemy_bb_${V.v}`, url: glbOf(V.v), extras: 'gltf.scene.userData.enemyBb', meshes: {body: 'BBBody'}});
    // the pinned source and its Meshy record: hashes, tool, settings, credits — nothing else
    expect(prov.source.sha256Verified).toBe(V.source.sha256);
    expect(prov.source.bytes).toBe(V.source.bytes);
    expect(prov.source.readOnly).toBe(true);
    expect(prov.source.pinChecks).toEqual({rawGlb: true, providerMaps: true, inputImage: true});
    expect(X.sourceSha256).toBe(V.source.sha256);
    expect(X.meshyTaskId).toBe(V.meshyTask);
    const m = prov.source.meshy;
    expect(m).toMatchObject({taskId: V.meshyTask, aiModel: 'meshy-t2.5', smartTopology: true, attempts: 1, credits: 15, accepted: true});
    expect(m.settings).toMatchObject({ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, texture_resolution: '2k', enable_pbr: true, target_polycount: 20000, target_formats: ['glb']});
    expect(m.raw.glb).toEqual(V.source);
    expect(Object.keys(m.raw.providerMaps).sort()).toEqual(['base_color', 'metallic', 'normal', 'roughness']);
    for (const e of Object.values(m.raw.providerMaps) as {sha256: string; bytes: number}[]) { expect(e.sha256).toMatch(/^[0-9a-f]{64}$/); expect(e.bytes).toBeGreaterThan(1000); }
    expect(m.inputImage.sha256).toBe(V.inputImage);
    expect(m.selectedConcept.sha256).toBe(V.concept);
    // honest status: generated by Meshy; rig and weights local and automatic; no clips; not approved in game by a human
    expect(prov.status).toMatchObject({approved: false, gameReady: false});
    expect(prov.status.stage).toMatch(/generated by Meshy/);
    expect(prov.status.stage).toMatch(/local and automatic/);
    expect(prov.status.stage).toMatch(/not approved in game by a human/);
    expect(prov.status.licenseClearance).toMatch(/^none/);
    expect(prov.honesty.sourceHadSkeleton).toBe(false);
    expect(prov.honesty.generation).toMatch(/no AI generation/);
    expect(prov.honesty.animation).toMatch(/none baked/);
    expect(prov.honesty.mesh).toMatch(/no decimation/);
    // hash-only: no private path (nothing under reference/), no absolute path, no URL, no credential, no prompt
    const text = readFileSync(pub(sidecarOf(V.v)), 'utf8');
    expect(text).not.toMatch(/reference\/|\/workspaces?\/|\/home\/|\/tmp\/|[A-Za-z]:\\|https?:\/\/|api[_-]?key|\btokens?\b|secret/i);
    const located: [string, unknown][] = [];
    (function walk(o: unknown) { if (o && typeof o === 'object') for (const [k, val] of Object.entries(o as object)) { if (/prompt/i.test(k) || /^(url|uri|file|path|ledger|rollout|session)$/i.test(k)) located.push([k, val]); walk(val); } })(prov);
    expect(located).toEqual([['path', 'game/public/' + glbOf(V.v)], ['url', glbOf(V.v)]]);
  });

  it('is allowlisted at its current bytes and credited', () => {
    const allow = JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    for (const rel of [glbOf(V.v), sidecarOf(V.v), 'assets/CREDITS.md']) {
      const e = allow.files.filter(f => f.path === rel);
      expect(e.length, rel).toBe(1);
      const b = readFileSync(pub(rel));
      expect(e[0].bytes, rel).toBe(b.length);
      expect(e[0].sha256, rel).toBe(sha(b));
    }
    const credits = readFileSync(pub('assets/CREDITS.md'), 'utf8');
    const begin = credits.indexOf('<!-- BEGIN enemy-bb-20261113'), end = credits.indexOf('<!-- END enemy-bb-20261113 -->');
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(credits.indexOf('<!-- BEGIN enemy-bb-20261113', begin + 1)).toBe(-1); // one section, rewritten in place
    const sec = credits.slice(begin, end);
    expect(sec).toContain(glbOf(V.v));
    expect(sec).toContain(V.meshyTask);
    expect(sec).toContain(`"${V.name}"`);
    expect(sec).toMatch(/Meshy T2\.5 image-to-3D/);
    expect(sec).toMatch(/Codex/);
    expect(sec).toMatch(/AI-generated assets/);
    expect(sec).toMatch(/no licence or commercial clearance implied/);
    expect(sec).not.toMatch(/reference\/|\/workspaces?\/|\/home\/|https?:\/\//);
  });

  it('has the shared 18-joint skeleton with identity bind rotations, one skinned body as generated, normalised weights and no clips', () => {
    const gltf = loaded.get(V.v)!, prov = provOf(V), X = extrasOf(V);
    toBind(gltf);
    const meshes = skinnedMeshes(gltf.scene);
    expect(meshes.map(m => m.name)).toEqual(['BBBody']);
    expect(X.bodyMesh).toBe('BBBody');
    const body = meshes[0];
    expect(body.skeleton.bones.map(b => b.name)).toEqual(JOINTS);
    expect(X.joints).toEqual(JOINTS);
    expect(gltf.scene.getObjectByName('Root')!.getWorldPosition(new THREE.Vector3()).length()).toBeLessThan(1e-6);
    for (const b of body.skeleton.bones) expect(b.quaternion.angleTo(new THREE.Quaternion()), b.name).toBeLessThan(1e-6);
    // translation-only inverse bind matrices (bone frames aligned with model space)
    for (const inv of body.skeleton.boneInverses) { const e = inv.elements; for (const [i, val] of [[0, 1], [5, 1], [10, 1], [15, 1], [1, 0], [2, 0], [4, 0], [6, 0], [8, 0], [9, 0]] as const) expect(e[i]).toBeCloseTo(val, 6); }
    // no clips (the game builds them), no morph targets
    expect(gltf.animations).toEqual([]);
    expect(body.geometry.morphAttributes.position).toBeUndefined();
    // the mesh as generated: no decimation, inside the contract's ~12k-22k
    expect(body.geometry.index!.count / 3).toBe(V.triangles);
    expect(prov.mesh.triangles).toBe(V.triangles);
    expect(prov.source.triangles).toBe(V.triangles);
    expect(V.triangles).toBeGreaterThanOrEqual(12_000);
    expect(V.triangles).toBeLessThanOrEqual(22_000);
    const w = body.geometry.getAttribute('skinWeight'), ji = body.geometry.getAttribute('skinIndex');
    let bad = 0;
    const used = new Set<number>();
    for (let i = 0; i < w.count; i++) {
      if (Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) > 0.01) bad++;
      for (let k = 0; k < 4; k++) if (w.getComponent(i, k) > 0.05) used.add(ji.getComponent(i, k));
    }
    expect(bad).toBe(0);
    expect(used.has(0)).toBe(false); // Root carries nothing
    for (let j = 1; j < JOINTS.length; j++) expect(used.has(j), JOINTS[j]).toBe(true); // every other joint moves some skin
  });

  it('is placed to the contract: 0.85 m floor to head top in the standing bind, feet midpoint at the origin, facing +Z, left = +X', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V);
    toBind(gltf);
    expect(X.heightM).toBe(0.85);
    expect(X.bindPose).toBe('stand');
    const body = skinnedMeshes(gltf.scene)[0];
    body.geometry.computeBoundingBox();
    const bb = body.geometry.boundingBox!;
    expect(Math.abs(bb.min.y)).toBeLessThan(0.002);
    expect(Math.abs(bb.max.y - 0.85)).toBeLessThan(0.002);
    expect(X.boundsM.max[1]).toBeCloseTo(0.85, 2);
    // feet: the vertices below 2 cm split left / right, their bbox-centre midpoint at the origin; toes toward +Z
    const p = body.geometry.getAttribute('position');
    const L = {x: [Infinity, -Infinity], z: [Infinity, -Infinity]}, R = {x: [Infinity, -Infinity], z: [Infinity, -Infinity]};
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.02) continue;
      const s = p.getX(i) > 0 ? L : R;
      s.x = [Math.min(s.x[0], p.getX(i)), Math.max(s.x[1], p.getX(i))]; s.z = [Math.min(s.z[0], p.getZ(i)), Math.max(s.z[1], p.getZ(i))];
    }
    expect(Math.abs((L.x[0] + L.x[1] + R.x[0] + R.x[1]) / 4)).toBeLessThan(0.01);
    expect(Math.abs((L.z[0] + L.z[1] + R.z[0] + R.z[1]) / 4)).toBeLessThan(0.015);
    // facing +Z: the toes reach further forward of the ankle joints than the heels reach behind them
    const ankleZ = boneWorld(gltf, 'L_Foot').z;
    expect(L.z[1] - ankleZ).toBeGreaterThan(ankleZ - L.z[0]);
    // L_ = character left = +X; a toddler: the head joint high, the hips low
    for (const n of ['L_UpperArm', 'L_Hand', 'L_Thigh', 'L_Foot']) expect(boneWorld(gltf, n).x, n).toBeGreaterThan(0.03);
    for (const n of ['R_UpperArm', 'R_Hand', 'R_Thigh', 'R_Foot']) expect(boneWorld(gltf, n).x, n).toBeLessThan(-0.03);
    expect(boneWorld(gltf, 'Hips').y).toBeLessThan(0.45);
    expect(boneWorld(gltf, 'Head').y).toBeGreaterThan(0.55);
    const chain = ['Hips', 'Spine', 'Chest', 'Neck', 'Head'].map(n => boneWorld(gltf, n).y);
    for (let k = 1; k < chain.length; k++) expect(chain[k]).toBeGreaterThan(chain[k - 1]);
  });

  it('carries every enemyBb contract field, measured on this body and consistent with the skinned mesh', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V), prov = provOf(V);
    toBind(gltf);
    expect(X).toMatchObject({version: 1, archetype: 'bb', variant: V.v, name: V.name, task: TASK, radius: 0.22});
    for (const k of ['variant', 'name', 'bindPose', 'heightM', 'head', 'hitRadii', 'contact', 'ends', 'radius', 'skinAudit']) expect(k in X, k).toBe(true);
    // head: the skull sphere (model space, bind) sits on the head joint's column, inside the bounds, under the crown
    const head = boneWorld(gltf, 'Head'), neck = boneWorld(gltf, 'Neck');
    expect(X.head.radius).toBeGreaterThan(0.06);
    expect(X.head.radius).toBeLessThan(0.13);
    expect(X.head.centre[1]).toBeGreaterThan(head.y);
    expect(X.head.centre[1] + X.head.radius).toBeLessThanOrEqual(0.85 + 1e-6);
    expect(Math.hypot(X.head.centre[0], X.head.centre[2] - head.z)).toBeLessThan(0.05);
    expect(prov.hit.head).toEqual(X.head);
    // hit radii: measured (not the defaults), plausible for a 0.85 m toddler; the trunk is the thickest
    for (const k of ['torso', 'arm', 'leg'] as const) { expect(X.hitRadii[k], k).toBeGreaterThan(0.012); expect(X.hitRadii[k], k).toBeLessThan(0.2); }
    expect(X.hitRadii.torso).toBeGreaterThan(X.hitRadii.leg);
    expect(X.hitRadii.torso).toBeGreaterThan(X.hitRadii.arm);
    expect(prov.hit.radii).toEqual(X.hitRadii);
    // ends: the crown is the top of the body above the Head joint; the fingertips reach out / down beyond the wrists
    // (on the skull column: Teddy's hood ears rise a little above it)
    const crown = head.clone().add(new THREE.Vector3(...X.ends.Head));
    expect(crown.y).toBeGreaterThan(0.8);
    expect(crown.y).toBeLessThanOrEqual(0.85 + 1e-6);
    expect(crown.y).toBeGreaterThan(X.head.centre[1] + 0.5 * X.head.radius);
    for (const [s, sg] of [['L', 1], ['R', -1]] as const) {
      const tip = X.ends[`${s}_Hand`], len = Math.hypot(...tip);
      expect(len, s).toBeGreaterThan(0.04);
      expect(len, s).toBeLessThan(0.12);
      expect(sg * tip[0], s).toBeGreaterThan(0); // outward
      expect(tip[1], s).toBeLessThan(0); // down: the A-pose arms hang
      // contacts: the palm under the hand (its down side), the toe in front of the ankle, the heel behind it, both on the floor
      const c = X.contact;
      expect(c.palm[s][1], s).toBeLessThan(-0.02);
      expect(Math.hypot(...c.palm[s]), s).toBeLessThan(0.09);
      expect(c.kneeFront[s], s).toBeGreaterThan(0.015);
      expect(c.kneeFront[s], s).toBeLessThan(0.1);
      const ankle = boneWorld(gltf, `${s}_Foot`);
      expect(c.toe[s][2], s).toBeGreaterThan(0.03);
      expect(c.heel[s][2], s).toBeLessThan(0);
      expect(ankle.y + c.toe[s][1], s).toBeCloseTo(0, 3);
      expect(ankle.y + c.heel[s][1], s).toBeCloseTo(0, 3);
    }
    expect(neck.y).toBeLessThan(head.y);
  });

  it('records a skin audit over every envelope range end and the four key poses, with bounded stretch', () => {
    const X = extrasOf(V), prov = provOf(V);
    const names = X.skinAudit.poses.map(p => p.pose);
    for (const k of KEY_POSES) expect(names, k).toContain(k);
    for (const [k, [a, b]] of Object.entries(ENVELOPE)) { expect(names, k).toContain(`${k} ${a}`); expect(names, k).toContain(`${k} ${b}`); }
    expect(names.length).toBe(KEY_POSES.length + 2 * Object.keys(ENVELOPE).length);
    // linear-blend skinning of an automatic rig: local stretch at seams / hems / knees, never a torn limb
    expect(X.skinAudit.maxStretch).toBeLessThan(12);
    for (const p of X.skinAudit.poses) expect(p.p99, p.pose).toBeLessThan(2.8);
    expect(Math.max(...X.skinAudit.poses.map(p => p.max))).toBe(X.skinAudit.maxStretch);
    // the CRAWL audit pose: a small body on all fours (the runtime plants palms / knees / toes itself)
    const cp = X.skinAudit.crawlPose;
    expect(cp.lengthM).toBeGreaterThan(0.45); expect(cp.lengthM).toBeLessThan(0.75);
    expect(cp.widthM).toBeGreaterThan(0.25); expect(cp.widthM).toBeLessThan(0.45);
    expect(cp.heightM).toBeGreaterThan(0.4); expect(cp.heightM).toBeLessThan(0.7);
    expect(prov.verification.skinAudit.poses).toEqual(X.skinAudit.poses);
  });

  it('moves its skin with its own joints through three.js skinning: the head with Head, the hands with the wrists, the shins with the knees', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V), body = skinnedMeshes(gltf.scene)[0];
    const pos = body.geometry.getAttribute('position'), v = new THREE.Vector3();
    const near = (c: THREE.Vector3, r: number) => { const out: number[] = []; for (let i = 0; i < pos.count; i++) if (v.fromBufferAttribute(pos, i).distanceTo(c) < r) out.push(i); return out; };
    const skinned = (ids: number[]) => ids.map(i => body.getVertexPosition(i, new THREE.Vector3()));
    const at = (name: string, axis: V3, deg: number) => { toBind(gltf); gltf.scene.getObjectByName(name)!.quaternion.setFromAxisAngle(new THREE.Vector3(...axis), deg * Math.PI / 180); gltf.scene.updateMatrixWorld(true); body.skeleton.update(); };
    toBind(gltf);
    const head = boneWorld(gltf, 'Head');
    const crownIds = near(head.clone().add(new THREE.Vector3(...X.ends.Head)), 0.02);
    const tipIds = near(boneWorld(gltf, 'L_Hand').add(new THREE.Vector3(...X.ends.L_Hand)), 0.015);
    const toeIds = near(boneWorld(gltf, 'R_Foot').add(new THREE.Vector3(...X.contact.toe.R)), 0.02);
    for (const ids of [crownIds, tipIds, toeIds]) expect(ids.length).toBeGreaterThan(2);
    const bindCrown = skinned(crownIds), bindTip = skinned(tipIds), bindToe = skinned(toeIds);
    // the head tipped back 60 deg about +X (extension: the face turns up): the crown swings back and down rigidly
    at('Head', [-1, 0, 0], 60);
    const rCrown = X.ends.Head[1] + 0, moved = skinned(crownIds);
    for (let k = 0; k < moved.length; k++) { expect(moved[k].z, 'crown back').toBeLessThan(bindCrown[k].z - 0.5 * rCrown * Math.sin(Math.PI / 3)); expect(moved[k].distanceTo(head), 'rigid').toBeCloseTo(bindCrown[k].distanceTo(head), 2); }
    // the left wrist bent 60 deg: the fingertips follow
    at('L_Hand', [0, 0, 1], 60);
    const tips = skinned(tipIds);
    expect(tips.reduce((a, p, k) => a + p.distanceTo(bindTip[k]), 0) / tips.length).toBeGreaterThan(0.03);
    // the right knee folded 90 deg: the toe swings back behind the knee
    at('R_Shin', [1, 0, 0], 90);
    const knee = boneWorld(gltf, 'R_Shin'), toes = skinned(toeIds);
    for (let k = 0; k < toes.length; k++) { expect(toes[k].z).toBeLessThan(knee.z - 0.08); expect(toes[k].distanceTo(bindToe[k])).toBeGreaterThan(0.1); }
    toBind(gltf);
  });

  it('keeps the Meshy maps: one opaque material whose three images are exactly the pinned re-encodes of the provider maps', async () => {
    const prov = provOf(V);
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(pub(glbOf(V.v)));
    const root = doc.getRoot(), mats = root.listMaterials();
    expect(mats.length).toBe(1);
    expect(root.listTextures().length).toBe(3);
    expect(root.listMeshes().length).toBe(1);
    expect(root.listMeshes()[0].listPrimitives().length).toBe(1);
    expect(root.listScenes().length).toBe(1);
    expect(root.listCameras().length).toBe(0);
    // no Draco / meshopt / KTX2 (the game's GLTFLoader registers no decoders); quantization is fine
    expect(root.listExtensionsUsed().map(e => e.extensionName).filter(n => /draco|meshopt|basisu|ktx/i.test(n))).toEqual([]);
    expect(root.listExtensionsRequired().map(e => e.extensionName)).toEqual(['KHR_mesh_quantization']);
    const m = mats[0], image = (t: ReturnType<typeof m.getBaseColorTexture>) => t!.getImage()!;
    expect(['OPAQUE', 'MASK']).toContain(m.getAlphaMode());
    const imgs = {baseColor: image(m.getBaseColorTexture()), metallicRoughness: image(m.getMetallicRoughnessTexture()), normal: image(m.getNormalTexture())};
    expect({baseColor: sha(imgs.baseColor), metallicRoughness: sha(imgs.metallicRoughness), normal: sha(imgs.normal)}).toEqual(V.images);
    const T = prov.outputs.textures;
    for (const k of ['baseColor', 'metallicRoughness', 'normal'] as const) {
      expect(T[k].sha256, k).toBe(V.images[k]);
      expect(T[k].bytes, k).toBe(imgs[k].byteLength);
      expect(T[k].edits, k).toMatch(/^none \((resize \+ )?re-encode only\)$/);
      expect(jpegSize(imgs[k]), k).toEqual(k === 'baseColor' ? [2048, 2048] : [1024, 1024]);
    }
    expect(T.baseColor).toMatchObject({size: 2048, quality: 86});
    expect(T.metallicRoughness).toMatchObject({size: 1024, quality: 88});
    expect(T.normal).toMatchObject({size: 1024, quality: 92});
    // the material stays the Meshy output's: no factor tweak stands in for a texture, no emissive (the runtime drives it)
    expect({roughness: m.getRoughnessFactor(), metallic: m.getMetallicFactor(), base: m.getBaseColorFactor()}).toEqual({roughness: 1, metallic: 1, base: [1, 1, 1, 1]});
    expect(m.getEmissiveTexture()).toBeNull();
    for (const k of ['baseColor', 'metallicRoughness', 'normal']) expect(prov.source.embeddedTextures[k].sha256, k).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.honesty.textures).toMatch(/resized \/ re-encoded only/);
    expect(readFileSync(pub(sidecarOf(V.v)), 'utf8')).not.toMatch(/texture-bake|retexture|hand-?painted|canvas/i);
  });
});

describe('BB family: one enemy, four real bodies', () => {
  beforeAll(() => need(VARIANTS.map(V => V.v)), 120_000);

  it('four distinct meshes from four Meshy tasks (not one mesh with four skins), on one shared skeleton naming and contract', () => {
    const geo = new Set<string>(), src = new Set<string>(), task = new Set<string>(), out = new Set<string>(), tris = new Set<number>(), img = new Set<string>();
    for (const V of VARIANTS) {
      const X = extrasOf(V), prov = provOf(V);
      expect(X).toMatchObject({version: 1, archetype: 'bb', heightM: 0.85, radius: 0.22, bindPose: 'stand'});
      expect(X.joints).toEqual(JOINTS);
      geo.add(prov.mesh.geometryHash); src.add(X.sourceSha256); task.add(X.meshyTaskId); out.add(prov.outputs.glb.sha256);
      tris.add(skinnedMeshes(loaded.get(V.v)!.scene)[0].geometry.index!.count); img.add(V.images.baseColor);
    }
    for (const s of [geo, src, task, out, tris, img]) expect(s.size).toBe(4);
  });

  it('keeps each look\'s own proportions: the bind joints are measured per body, not normalised between variants', () => {
    const J = VARIANTS.map(V => { const g = loaded.get(V.v)!; toBind(g); return JOINTS.map(n => boneWorld(g, n)); });
    for (let a = 0; a < J.length; a++) for (let b = a + 1; b < J.length; b++) {
      const d = Math.max(...JOINTS.map((_n, k) => J[a][k].distanceTo(J[b][k])));
      expect(d, `${VARIANTS[a].v} vs ${VARIANTS[b].v}`).toBeGreaterThan(0.03);
    }
    expect(new Set(VARIANTS.map(V => extrasOf(V).head.radius)).size).toBe(4);
  });
});
