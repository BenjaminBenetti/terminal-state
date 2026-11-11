// Task studio-screacher-production-20261110-221858-01 (lane RIG): the four Screacher runtime derivatives
// (enemy-screacher-sc01..sc04.glb) — the locally rigged / animated derivatives of the four accepted Meshy T2.5 image-to-3D bodies
// (headless lanky humanoids; one enemy, four looks), their GLB extras contract (`enemyScreacher`: height to the top of the neck
// stump, stump top, hand reach / hit frame, scream cue, the seven shared clips, hit radii WITHOUT a head) and their hash-only
// provenance sidecars / allowlist / credits. Runtime-independent: each GLB is parsed by three's GLTFLoader (textures stripped: no
// image decoder in node) and CPU-skinned through three's own AnimationMixer + SkinnedMesh path. Needs neither the private raw
// masters nor git history.

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
const TASK = 'studio-screacher-production-20261110-221858-01';

/** The shared 18-joint humanoid skeleton (zombie bodies, Blightbelly, Strainer): names and order. */
const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
/** The clip contract shared by the four variants (one AI). */
const CLIPS: Record<string, {duration: number; loop: boolean; groundSpeed?: number; impactTime?: number; cueTime?: number}> = {
  Idle: {duration: 3.6, loop: true},
  Walk: {duration: 1.3, loop: true, groundSpeed: 1.25},
  Run: {duration: 0.72, loop: true, groundSpeed: 3.9},
  Attack: {duration: 1.0, loop: false, impactTime: 0.42},
  Hit: {duration: 0.35, loop: false},
  Death: {duration: 1.8, loop: false},
  Scream: {duration: 1.6, loop: false, cueTime: 0.5},
};
const CLIP_NAMES = Object.keys(CLIPS);

/**
 * The four accepted Meshy bodies (hash-only public provenance) and the three texture images each runtime GLB carries: the
 * provider's own maps, resized / re-encoded only ("Meshy maps kept": root CLAUDE.md texture rule). A replacement texture, a
 * repaint or a different source would change these hashes.
 */
const VARIANTS = [
  {v: 'sc01', id: 'SC01', name: 'Hollow Commuter', triangles: 16025, meshyTask: '01a1c79e-a37b-7105-bfd5-f5ccc500aa07',
    source: {sha256: '3a3534a9f4d9e29b88232d0dbfb1b362b98d3e0832561927520582e80028da38', bytes: 7884036}, inputImage: '41036303086b66d1260d507c92b4a718c199c08be053ff15014e71dec0eb0899',
    images: {baseColor: '590f74cfb546eb0e9365f731c680aab91f487a37341e6a349ca81c6e3b0dda89', metallicRoughness: '5664634d6d9ff0c6f1f7a88ff3b34959ef827ef23feb6cdbcc1e83d0bb7bf23c', normal: 'adc022ea77c98a7a1a1b6d0f7923fffc5d214eb817b4a1af3dd1937b493157d6'}},
  {v: 'sc02', id: 'SC02', name: 'Track Ganger', triangles: 20063, meshyTask: '01a1c79e-ab85-767c-bb51-d32482b9d9cf',
    source: {sha256: 'ee5c45c168cb04ea54f16804ece9d38b31e8ef555bedf53c71d3dd9b904a14ff', bytes: 8076608}, inputImage: '35bf827b54a8afcea6012dc52db6a432a09ffb7bdd758444e474d2846c6ab494',
    images: {baseColor: '05b3510b47ee8678b509f394e721bd85f981897264402e9b41721b6f5d0e1d77', metallicRoughness: 'a3b934ab441508588b20ff10f48e4385168d5ebe2c0b1338d7d3825d3eb5fb89', normal: 'a87fd33bfae89198d221968a2d8071d2cb97d526e34a78052e7c9e56d5cbf053'}},
  {v: 'sc03', id: 'SC03', name: 'Lopsided Sleeper', triangles: 19847, meshyTask: '01a1c79e-b350-7726-8c6b-9ed1cccd1ef8',
    source: {sha256: '2f303e252fc93a933f96b34a3d6231923ef740f210d4a7ecf28119af89e4deb6', bytes: 7945016}, inputImage: 'a85122e76c7bf99aa8568a8f03ecd81503c3b8a61db95672360871eafe97754e',
    images: {baseColor: '06f8851a32386305517553744a04f8bad4d460b7e49b7bc767b157dfbece850c', metallicRoughness: 'bafaaef08d0c12952ae7ff5852489c27799b7468aa16b11196c5764f62aae15d', normal: '25ddf3ebdf68583bc9d3a7a2f821b1fad721816a4a881eeed56a7f0697f7be7e'}},
  {v: 'sc04', id: 'SC04', name: 'Long-Stride Runner', triangles: 20647, meshyTask: '01a1c79d-2dc8-7345-b577-f12daca5f86f',
    source: {sha256: '4b25e46ac6cff7470ae4864d9270d310e998442b4541c313b8e0decd8dd9a772', bytes: 8425072}, inputImage: 'b105ea7cf585dac7f38484c286430a04b123f1e4443dcdc7e538b57bbb1991a9',
    images: {baseColor: '5bd9ee4a1d8c025eded83ae0f121ea5c745f48e077df4f8e0b80424b0107b60d', metallicRoughness: 'd137584d5652657ce5f3b847e5880212ac318dc3fd58318876cbabe71e8d3ef9', normal: '3a051c89d30e0bfa13ccdbac2eadd37d103b8077cfb87d52819f92165371ba89'}},
] as const;
type Variant = (typeof VARIANTS)[number];
const glbOf = (v: string) => `assets/models/enemy-screacher-${v}.glb`;
const sidecarOf = (v: string) => `assets/derivatives/enemy-screacher-${v}.json`;

interface Extras {
  version: number; archetype: string; variant: string; name: string; task: string;
  heightM: number; joints: string[]; bodyMesh: string; sourceSha256: string; meshyTaskId: string;
  stump: {top: number[]};
  attackHitTime: number; reachM: number; screamCueTime: number;
  clips: Record<string, {duration: number; loop: boolean; frames: number; groundSpeed?: number; impactTime?: number; cueTime?: number}>;
  hitRadii: {torso: number; arm: number; leg: number}; radius: number;
  boundsM: {min: number[]; max: number[]}; deathPoseBoundsM: {min: number[]; max: number[]};
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
/** Pose a loaded GLB at time t of a clip through three's mixer; returns the skinned body + helpers. */
function poser(gltf: GLTF) {
  const root = gltf.scene, body = skinnedMeshes(root)[0], mixer = new THREE.AnimationMixer(root), v = new THREE.Vector3();
  const pos = body.geometry.getAttribute('position'), ji = body.geometry.getAttribute('skinIndex'), jw = body.geometry.getAttribute('skinWeight');
  const boneIndex = (name: string) => body.skeleton.bones.findIndex(b => b.name === name);
  /** Vertices whose dominant bone is `name`. */
  const dominant = (name: string) => { const bi = boneIndex(name), out: number[] = []; for (let i = 0; i < pos.count; i++) { let best = 0; for (let k = 1; k < 4; k++) if (jw.getComponent(i, k) > jw.getComponent(i, best)) best = k; if (ji.getComponent(i, best) === bi) out.push(i); } return out; };
  /** Pose at time t of a clip (null: the bind pose). Always starts from the bind pose: no state leaks between tests. */
  const at = (clipName: string | null, t: number) => {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    toBind(gltf);
    if (clipName) { const action = mixer.clipAction(gltf.animations.find(a => a.name === clipName)!); action.reset().play(); action.time = t; mixer.update(0); }
    root.updateMatrixWorld(true);
    body.skeleton.update();
  };
  const vertex = (i: number) => { body.getVertexPosition(i, v); return v.clone().applyMatrix4(body.matrixWorld); };
  const bone = (name: string) => root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
  const minY = (step = 1) => { let m = Infinity; for (let i = 0; i < pos.count; i += step) m = Math.min(m, vertex(i).y); return m; };
  return {root, body, at, vertex, bone, minY, dominant, count: pos.count};
}

const loaded = new Map<string, GLTF>();
const bindLocal = new WeakMap<GLTF, Map<THREE.Object3D, {p: THREE.Vector3; q: THREE.Quaternion}>>();
let strainer: GLTF;
/** Load (once) the variants a suite needs + the Strainer (the shared-skeleton reference); remember each bind pose. */
async function need(vs: readonly string[]) {
  strainer ??= await loadStripped('assets/models/enemy-strainer.glb');
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
const extrasOf = (V: Variant) => loaded.get(V.v)!.scene.userData.enemyScreacher as Extras;

describe.each(VARIANTS.map(V => [V.v, V] as const))('Screacher derivative %s (enemy-screacher-<variant>.glb)', (_v, V) => {
  beforeAll(() => need([V.v]), 120_000);

  it('is the sidecar-recorded derivative of its accepted Meshy T2.5 body, with honest hash-only provenance', () => {
    const prov = provOf(V), X = extrasOf(V);
    const bytes = readFileSync(pub(glbOf(V.v)));
    expect(sha(bytes)).toBe(prov.outputs.glb.sha256);
    expect(bytes.length).toBe(prov.outputs.glb.bytes);
    expect(prov.outputs.glb.path).toBe('game/public/' + glbOf(V.v));
    expect(bytes.length).toBeLessThanOrEqual(3_200_000); // compact: not the raw ~8 MB download
    expect(prov.asset).toBe(`enemy-screacher-${V.v}`);
    expect(prov.task).toBe(TASK);
    expect(prov.generatedBy).toBe('tools/asset-pipeline/enemy/build-screacher.mjs');
    expect(prov.family).toMatchObject({archetype: 'screacher', variant: V.v, id: V.id, name: V.name, variants: ['sc01', 'sc02', 'sc03', 'sc04']});
    // the pinned source and its Meshy record: hashes, tool, settings, credits — nothing else
    expect(prov.source.sha256Verified).toBe(V.source.sha256);
    expect(prov.source.bytes).toBe(V.source.bytes);
    expect(prov.source.readOnly).toBe(true);
    expect(X.sourceSha256).toBe(V.source.sha256);
    expect(X.meshyTaskId).toBe(V.meshyTask);
    const m = prov.source.meshy;
    expect(m).toMatchObject({taskId: V.meshyTask, aiModel: 'meshy-t2.5', smartTopology: true, attempts: 1, credits: 15, accepted: true});
    expect(m.settings).toMatchObject({ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, texture_resolution: '2k', enable_pbr: true, target_polycount: 20000, target_formats: ['glb']});
    expect(m.raw.glb).toEqual(V.source);
    expect(Object.keys(m.raw.providerMaps).sort()).toEqual(['base_color', 'metallic', 'normal', 'roughness']);
    for (const e of Object.values(m.raw.providerMaps) as {sha256: string; bytes: number}[]) { expect(e.sha256).toMatch(/^[0-9a-f]{64}$/); expect(e.bytes).toBeGreaterThan(1000); }
    expect(m.inputImage.sha256).toBe(V.inputImage);
    // honest status: generated by Meshy; rig, weights and clips local and procedural; not approved in game by a human
    expect(prov.status).toMatchObject({approved: false, gameReady: false});
    expect(prov.status.stage).toMatch(/generated by Meshy/);
    expect(prov.status.stage).toMatch(/local and procedural/);
    expect(prov.status.stage).toMatch(/not approved in game by a human/);
    expect(prov.status.licenseClearance).toMatch(/^none/);
    expect(prov.honesty.sourceHadSkeleton).toBe(false);
    expect(prov.honesty.generation).toMatch(/no AI generation/);
    expect(prov.honesty.animation).toMatch(/NOT motion capture/);
    expect(prov.honesty.mesh).toMatch(/no decimation/);
    // hash-only: no private path (nothing under reference/), no absolute path, no URL, no credential, no prompt
    const text = readFileSync(pub(sidecarOf(V.v)), 'utf8');
    expect(text).not.toMatch(/reference\/|\/workspaces?\/|\/home\/|\/tmp\/|[A-Za-z]:\\|https?:\/\/|api[_-]?key|\btokens?\b|secret/i);
    // the only location-like fields are the two repository-relative output locations
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
    const begin = credits.indexOf('<!-- BEGIN enemy-screacher-20261110'), end = credits.indexOf('<!-- END enemy-screacher-20261110 -->');
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(credits.indexOf('<!-- BEGIN enemy-screacher-20261110', begin + 1)).toBe(-1); // one section, rewritten in place
    const sec = credits.slice(begin, end);
    expect(sec).toContain(glbOf(V.v));
    expect(sec).toContain(V.meshyTask);
    expect(sec).toContain(V.name);
    expect(sec).toMatch(/Meshy T2\.5 image-to-3D/);
    expect(sec).toMatch(/Codex/);
    expect(sec).toMatch(/AI-generated assets/);
    expect(sec).toMatch(/no licence or commercial clearance implied/);
    expect(sec).not.toMatch(/reference\/|\/workspaces?\/|\/home\/|https?:\/\//);
  });

  it('has the shared 18-joint skeleton with identity bind rotations, one skinned body as generated and normalised weights', () => {
    const gltf = loaded.get(V.v)!, prov = provOf(V), X = extrasOf(V);
    toBind(gltf);
    const meshes = skinnedMeshes(gltf.scene);
    expect(meshes.map(m => m.name)).toEqual(['ScreacherBody']);
    expect(X.bodyMesh).toBe('ScreacherBody');
    expect(gltf.scene.name).toBe('Screacher-' + V.id);
    const body = meshes[0];
    expect(body.userData.slot).toBe('body');
    const shared = skinnedMeshes(strainer.scene)[0].skeleton.bones.map(b => b.name);
    expect(shared).toEqual(JOINTS);
    expect(body.skeleton.bones.map(b => b.name)).toEqual(JOINTS);
    expect(X.joints).toEqual(JOINTS);
    for (const b of body.skeleton.bones) expect(b.quaternion.angleTo(new THREE.Quaternion()), b.name).toBeLessThan(1e-6);
    // translation-only inverse bind matrices (bone frames aligned with model space)
    for (const inv of body.skeleton.boneInverses) { const e = inv.elements; for (const [i, val] of [[0, 1], [5, 1], [10, 1], [15, 1], [1, 0], [2, 0], [4, 0], [6, 0], [8, 0], [9, 0]] as const) expect(e[i]).toBeCloseTo(val, 6); }
    // the mesh as generated: no decimation
    expect(body.geometry.index!.count / 3).toBe(V.triangles);
    expect(prov.mesh.triangles).toBe(V.triangles);
    expect(prov.source.triangles).toBe(V.triangles);
    const w = body.geometry.getAttribute('skinWeight'), ji = body.geometry.getAttribute('skinIndex');
    let bad = 0;
    const used = new Set<number>();
    for (let i = 0; i < w.count; i++) {
      if (Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) > 0.01) bad++;
      for (let k = 0; k < 4; k++) if (w.getComponent(i, k) > 0.05) used.add(ji.getComponent(i, k));
    }
    expect(bad).toBe(0);
    expect(used.has(0)).toBe(false); // Root carries nothing
    // every other joint moves some skin; only the technical Head joint (the top of the stump) may carry nothing
    for (let j = 1; j < JOINTS.length; j++) if (JOINTS[j] !== 'Head') expect(used.has(j), JOINTS[j]).toBe(true);
  });

  it('is placed to the contract: 2.00 m to the top of the stump, feet midpoint at the origin, facing +Z', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V);
    toBind(gltf);
    expect(X.heightM).toBe(2);
    const body = skinnedMeshes(gltf.scene)[0];
    body.geometry.computeBoundingBox();
    const bb = body.geometry.boundingBox!;
    expect(Math.abs(bb.min.y)).toBeLessThan(0.002);
    expect(Math.abs(bb.max.y - 2.0)).toBeLessThan(0.002);
    expect(X.boundsM.max[1]).toBeCloseTo(2.0, 2);
    // feet: the vertices below 4 cm split left / right, their bbox-centre midpoint at the origin; toes toward +Z
    const p = body.geometry.getAttribute('position');
    const L = {x: [Infinity, -Infinity], z: [Infinity, -Infinity]}, R = {x: [Infinity, -Infinity], z: [Infinity, -Infinity]};
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.04) continue;
      const s = p.getX(i) > 0 ? L : R;
      s.x = [Math.min(s.x[0], p.getX(i)), Math.max(s.x[1], p.getX(i))]; s.z = [Math.min(s.z[0], p.getZ(i)), Math.max(s.z[1], p.getZ(i))];
    }
    expect(Math.abs((L.x[0] + L.x[1] + R.x[0] + R.x[1]) / 4)).toBeLessThan(0.01);
    expect(Math.abs((L.z[0] + L.z[1] + R.z[0] + R.z[1]) / 4)).toBeLessThan(0.01);
    // facing +Z: the toes reach well forward of the ankle joints, the heels only a little behind them
    gltf.scene.updateMatrixWorld(true);
    const ankleZ = gltf.scene.getObjectByName('L_Foot')!.getWorldPosition(new THREE.Vector3()).z;
    expect(L.z[1] - ankleZ).toBeGreaterThan(2 * (ankleZ - L.z[0]));
    // L_ = character left = +X
    expect(gltf.scene.getObjectByName('L_Hand')!.getWorldPosition(new THREE.Vector3()).x).toBeGreaterThan(0.2);
    expect(gltf.scene.getObjectByName('R_Hand')!.getWorldPosition(new THREE.Vector3()).x).toBeLessThan(-0.2);
  });

  it('is HEADLESS: no head field or head sphere in the extras; Neck = the base of the stump, Head = a technical joint under its top', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V) as unknown as Record<string, unknown>, prov = provOf(V);
    toBind(gltf);
    for (const k of ['head', 'headCenter', 'headRadius', 'headSphere']) expect(k in X, k).toBe(false);
    expect(Object.keys(X.hitRadii as object).sort()).toEqual(['arm', 'leg', 'torso']);
    expect(Object.keys(prov.hit.radii).sort()).toEqual(['arm', 'leg', 'torso']);
    expect(JSON.stringify(prov.hit)).not.toMatch(/headSphere|headRadius/);
    const E = extrasOf(V);
    for (const k of ['torso', 'arm', 'leg'] as const) { expect(E.hitRadii[k], k).toBeGreaterThan(0.03); expect(E.hitRadii[k], k).toBeLessThan(0.3); }
    expect(E.hitRadii.torso).toBeGreaterThan(E.hitRadii.leg);
    expect(E.hitRadii.leg).toBeGreaterThan(E.hitRadii.arm); // lanky: thin arms
    expect(E.radius).toBe(0.34);
    // the stump top: the centre of the top of the neck stump, within the top 3 cm of the bounds, over the neck column
    expect(E.stump.top).toHaveLength(3);
    expect(E.stump.top.every(Number.isFinite)).toBe(true);
    expect(E.stump.top[1]).toBeGreaterThanOrEqual(E.boundsM.max[1] - 0.03);
    expect(E.stump.top[1]).toBeLessThanOrEqual(E.boundsM.max[1] + 1e-6);
    expect(Math.abs(E.stump.top[0])).toBeLessThan(0.08);
    gltf.scene.updateMatrixWorld(true);
    const neck = gltf.scene.getObjectByName('Neck')!.getWorldPosition(new THREE.Vector3()), head = gltf.scene.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeGreaterThan(neck.y + 0.02); // a few cm above the Neck
    expect(head.y).toBeLessThan(neck.y + 0.15);
    expect(head.y).toBeLessThanOrEqual(2.0); // inside the stump: nothing above it
    expect(new THREE.Vector3(...E.stump.top).distanceTo(head)).toBeLessThan(0.06);
    // the shoulders are below the stump base: the Neck sits between them
    for (const s of ['L', 'R']) expect(gltf.scene.getObjectByName(s + '_UpperArm')!.getWorldPosition(new THREE.Vector3()).y, s).toBeLessThan(neck.y);
    // nothing was added above the stump (no head, no cap): the stump's own rim is the top of the mesh
    const body = skinnedMeshes(gltf.scene)[0], p = body.geometry.getAttribute('position');
    let above = 0, rim = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 2.0005) above++;
      if (p.getY(i) > 1.985 && Math.hypot(p.getX(i) - E.stump.top[0], p.getZ(i) - E.stump.top[2]) < 0.07) rim++;
    }
    expect(above).toBe(0);
    expect(rim).toBeGreaterThan(6);
  });

  it('carries exactly the seven clips of the shared contract (names, durations, hit / cue times, ground speeds)', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V), prov = provOf(V);
    expect(gltf.animations.map(a => a.name).sort()).toEqual([...CLIP_NAMES].sort());
    expect(Object.keys(X.clips).sort()).toEqual([...CLIP_NAMES].sort());
    for (const [name, C] of Object.entries(CLIPS)) {
      const clip = gltf.animations.find(a => a.name === name)!;
      expect(clip.duration, name).toBeCloseTo(C.duration, 4);
      const {frames, ...meta} = X.clips[name];
      expect(meta, name).toEqual(C);
      expect(frames, name).toBe(Math.round(C.duration * 30) + 1); // 30 fps + the end time
      expect(prov.clips.meta[name], name).toEqual(X.clips[name]);
      // the Strainer's track layout: a rotation track per non-Root joint + the Hips translation, one shared time track
      expect(clip.tracks.length, name).toBe(18);
      expect(clip.tracks.filter(t => t.name.endsWith('.position')).map(t => t.name), name).toEqual(['Hips.position']);
      for (const t of clip.tracks) expect(t.times.length, `${name} ${t.name}`).toBe(frames);
    }
    expect(X.attackHitTime).toBe(0.42);
    expect(X.screamCueTime).toBe(0.5);
    expect(prov.clips.runtime).toMatchObject({attackDuration: 1.0, attackImpact: 0.42, attackReachM: X.reachM, walkGroundSpeed: 1.25, runGroundSpeed: 3.9, screamDuration: 1.6, screamCueTime: 0.5});
    expect(prov.clips.fps).toBe(30);
  });

  it('rakes with the right hand to the contract reach at the hit frame, at chest height in front (three.js skinning)', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V), prov = provOf(V), P = poser(gltf);
    expect(X.reachM).toBeGreaterThanOrEqual(1.1);
    expect(X.reachM).toBeLessThanOrEqual(1.3);
    const rHand = P.dominant('R_Hand');
    expect(rHand.length).toBeGreaterThan(50);
    const tipAt = (t: number) => { P.at('Attack', t); let best = new THREE.Vector3(), d = 0; for (const i of rHand) { const q = P.vertex(i), r = Math.hypot(q.x, q.z); if (r > d) { d = r; best = q; } } return {tip: best, reach: d}; };
    const hit = tipAt(X.attackHitTime);
    expect(Math.abs(hit.reach - X.reachM)).toBeLessThan(0.02); // the recorded reach IS the skinned hand tip at the hit frame
    expect(hit.tip.z).toBeGreaterThan(1.0); // in front of the feet origin
    expect(Math.abs(hit.tip.x)).toBeLessThan(0.35); // on the target in front, not out to the side
    expect(hit.tip.y).toBeGreaterThan(1.15); // chest height of a 1.78 m target
    expect(hit.tip.y).toBeLessThan(1.6);
    // the hit frame is the reach peak: clearly further than at the start and than after the rake
    expect(hit.tip.z).toBeGreaterThan(tipAt(0).tip.z + 0.7);
    expect(hit.tip.z).toBeGreaterThan(tipAt(0.3).tip.z + 0.6); // wound up: the hand is still out to the side / behind
    expect(hit.tip.z).toBeGreaterThan(tipAt(0.62).tip.z + 0.1); // raked down and back in
    expect(tipAt(0.62).tip.y).toBeLessThan(hit.tip.y - 0.25);
    expect(prov.verification.attack.hit).toMatchObject({t: 0.42, reachM: X.reachM});
    expect(prov.clips.attackSolve.target).toBe(1.2);
  });

  it('screams with the feet planted: arched with the stump thrown back and the arms flung down, back and out by the cue; ends in the Idle pose', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V), prov = provOf(V), P = poser(gltf);
    const snap = (clip: string, t: number) => { P.at(clip, t); return Object.fromEntries(JOINTS.slice(1).map(n => [n, P.bone(n)])); };
    const idle0 = snap('Idle', 0), start = snap('Scream', 0), cue = snap('Scream', X.screamCueTime), end = snap('Scream', 1.6 * 0.9999);
    // starts and ends on the Idle frame-0 pose
    for (const n of JOINTS.slice(1)) { expect(start[n].distanceTo(idle0[n]), `start ${n}`).toBeLessThan(0.004); expect(end[n].distanceTo(idle0[n]), `end ${n}`).toBeLessThan(0.004); }
    // feet planted throughout: the ankle joints never move
    for (let k = 0; k <= 32; k++) { const s = snap('Scream', (k / 32) * 1.6 * 0.9999); for (const f of ['L_Foot', 'R_Foot']) expect(s[f].distanceTo(idle0[f]), `${f} at ${k}`).toBeLessThan(0.004); }
    expect(prov.verification.footSkate.Scream.maxSoleTravelM).toBeLessThan(0.004);
    // by the cue: the chest is thrust up (its front faces upward, the body has not sunk), the back arched and the stump thrown
    // back (Neck -> Head leans back)
    expect(cue.Chest.y).toBeGreaterThan(idle0.Chest.y - 0.02);
    expect(cue.Hips.y).toBeGreaterThanOrEqual(idle0.Hips.y - 0.002); // the legs straighten: it rises, never crouches, at the cue
    const chestFront = (t: number) => { P.at('Scream', t); return new THREE.Vector3(0, 0, 1).applyQuaternion(P.root.getObjectByName('Chest')!.getWorldQuaternion(new THREE.Quaternion())).y; };
    expect(chestFront(X.screamCueTime)).toBeGreaterThan(0.3);
    expect(chestFront(0)).toBeLessThan(0);
    const lean = (s: Record<string, THREE.Vector3>, a: string, b: string) => Math.atan2(s[b].z - s[a].z, s[b].y - s[a].y) * 180 / Math.PI; // + = leaning forward
    expect(lean(cue, 'Neck', 'Head')).toBeLessThan(lean(idle0, 'Neck', 'Head') - 35);
    expect(lean(cue, 'Hips', 'Neck')).toBeLessThan(lean(idle0, 'Hips', 'Neck') - 8);
    // the arms: flung back and out, still pointing down (hands below the shoulders)
    for (const [s, sg] of [['L', 1], ['R', -1]] as const) {
      expect(cue[s + '_Hand'].z, s).toBeLessThan(idle0[s + '_Hand'].z - 0.15);
      expect(sg * cue[s + '_Hand'].x, s).toBeGreaterThan(sg * idle0[s + '_Hand'].x + 0.12);
      expect(cue[s + '_Hand'].y, s).toBeLessThan(cue[s + '_UpperArm'].y - 0.3);
    }
    // the gather before it: a crouch (the pelvis dips) — and the cue is the peak of the arch
    const gather = snap('Scream', 0.2);
    expect(gather.Hips.y).toBeLessThan(idle0.Hips.y - 0.03);
    expect(lean(cue, 'Neck', 'Head')).toBeLessThan(lean(snap('Scream', 0.3), 'Neck', 'Head'));
  });

  it('keeps the feet on the floor, does not skate, does not tear, and ends its Death lying on the floor (three.js mixer + the builder audits)', () => {
    const gltf = loaded.get(V.v)!, X = extrasOf(V), prov = provOf(V), P = poser(gltf);
    for (const c of CLIP_NAMES) {
      const clip = gltf.animations.find(a => a.name === c)!;
      let lowest = Infinity;
      for (let k = 0; k <= 8; k++) {
        P.at(c, (k / 8) * clip.duration * 0.999);
        const minY = P.minY(3);
        lowest = Math.min(lowest, minY);
        // a foot on the floor in the planted clips; the Run has flight phases (both feet off): only its contacts are on the floor
        if (c === 'Idle' || c === 'Walk' || c === 'Scream') expect(minY, `${c} frame ${k}: a foot on the floor`).toBeLessThan(0.03);
      }
      expect(lowest, `${c}: nothing sinks below the floor`).toBeGreaterThan(-0.01);
      if (c === 'Run') expect(lowest, 'Run: the contacts reach the floor').toBeLessThan(0.02);
    }
    const Vf = prov.verification;
    for (const c of CLIP_NAMES) { expect(Vf.cpuSkinningFloor[c].framesBelowMinus1cm, c).toBe(0); expect(Vf.cpuSkinningFloor[c].minY, c).toBeGreaterThan(-0.005); expect(Vf.cpuSkinningFloor[c].maxLegReach, `${c}: no clamped leg IK`).toBeLessThan(0.9995); }
    // (Run: the toe-off of a boot with toe spring leaves the sole's lowest point a little higher than a flat foot's)
    for (const c of ['Walk', 'Run']) for (const s of ['L', 'R']) expect(Vf.cpuSkinningFloor[c].feet[s].stanceLowestPointMaxY, `${c} ${s} planted`).toBeLessThan(c === 'Run' ? 0.03 : 0.02);
    for (const c of ['Idle', 'Walk', 'Run', 'Scream']) expect(Vf.footSkate[c].maxSlipMps, `${c} no skating`).toBeLessThan(0.05);
    expect(Vf.footSkate.Walk.groundSpeed).toBe(1.25);
    expect(Vf.footSkate.Run.groundSpeed).toBe(3.9);
    expect(Vf.footSkate.Walk.framesTested).toBeGreaterThan(8);
    expect(Vf.motionStretch.p99).toBeLessThan(2.5);
    expect(Vf.motionStretch.fractionOver).toBeLessThan(0.01);
    // hands / forearms never end up under the torso shells or inside the legs — and the audit does see a real penetration
    // (counted in vertices deeper than 1 cm under a surface: a stray torn-cuff vertex is not a hand through a thigh)
    for (const k of ['armsVsTorso', 'handsVsLegs']) {
      expect(Vf.clearance.testedVertices[k], k).toBeGreaterThan(800);
      expect(Vf.clearance[k].Bind.maxVertsDeeperThan1cm, `${k} bind`).toBe(0);
      for (const c of CLIP_NAMES) expect(Vf.clearance[k][c].maxVertsDeeperThan1cm, `${c} ${k}`).toBeLessThanOrEqual(8);
    }
    expect(Vf.clearance.handsVsLegs.ProbeArmsPressedIn.maxVertsDeeperThan1cm, 'self-check: a hand pressed into the thigh is seen').toBeGreaterThan(150);
    expect(Vf.clearance.handsVsLegs.ProbeArmsPressedIn.maxDepthM).toBeGreaterThan(0.03);
    // Death: the last frame lies on the floor (low, long), nothing under it
    expect(X.deathPoseBoundsM.min[1]).toBeGreaterThan(-0.005);
    expect(X.deathPoseBoundsM.max[1]).toBeLessThan(0.75);
    expect(X.deathPoseBoundsM.max[2] - X.deathPoseBoundsM.min[2]).toBeGreaterThan(1.5);
    P.at('Death', 1.8 * 0.9999);
    expect(P.bone('Chest').y).toBeLessThan(0.35);
    expect(P.bone('Hips').y).toBeLessThan(0.35);
    for (const c of Object.values(prov.clips.deathSolve.contact) as number[]) { expect(c).toBeGreaterThan(-0.005); expect(c).toBeLessThan(0.06); } // every body region rests on / just above the floor
    expect(JSON.stringify(prov.clips.deathSolve)).not.toMatch(/"head/i); // no head term in the solve
  });

  it('keeps the Meshy maps: one material whose three images are exactly the pinned re-encodes of the provider maps', async () => {
    const prov = provOf(V);
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(pub(glbOf(V.v)));
    const root = doc.getRoot(), mats = root.listMaterials();
    expect(mats.length).toBe(1);
    expect(root.listTextures().length).toBe(3);
    expect(root.listMeshes().length).toBe(1);
    expect(root.listMeshes()[0].listPrimitives().length).toBe(1);
    expect(doc.getRoot().listExtensionsRequired().map(e => e.extensionName)).toEqual(['KHR_mesh_quantization']);
    const m = mats[0], image = (t: ReturnType<typeof m.getBaseColorTexture>) => t!.getImage()!;
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
    // the material stays the Meshy output's: no factor tweak stands in for a texture
    expect({roughness: m.getRoughnessFactor(), metallic: m.getMetallicFactor(), base: m.getBaseColorFactor()}).toEqual({roughness: 1, metallic: 1, base: [1, 1, 1, 1]});
    // the source's own embedded maps are recorded by hash; nothing in the provenance speaks of a replacement texture source
    for (const k of ['baseColor', 'metallicRoughness', 'normal']) expect(prov.source.embeddedTextures[k].sha256, k).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.honesty.textures).toMatch(/resized \/ re-encoded only/);
    expect(readFileSync(pub(sidecarOf(V.v)), 'utf8')).not.toMatch(/texture-bake|retexture|hand-?painted|canvas/i);
  });
});

describe('Screacher family: one enemy, four bodies', () => {
  beforeAll(() => need(VARIANTS.map(V => V.v)), 120_000);

  it('the four variants share the clip contract exactly (names, durations, frame times) and differ only in the body', () => {
    const ref = loaded.get('sc04')!;
    const times = (g: GLTF) => Object.fromEntries(g.animations.map(a => [a.name, Array.from(a.tracks[0].times)]));
    const T0 = times(ref);
    const geo = new Set<string>(), src = new Set<string>(), task = new Set<string>(), out = new Set<string>();
    for (const V of VARIANTS) {
      const g = loaded.get(V.v)!, X = extrasOf(V), prov = provOf(V);
      expect(times(g), V.v).toEqual(T0);
      expect(X).toMatchObject({version: 1, archetype: 'screacher', variant: V.v, name: V.name, task: TASK, heightM: 2, attackHitTime: 0.42, screamCueTime: 0.5, radius: 0.34});
      expect(Object.fromEntries(Object.entries(X.clips).map(([k, c]) => [k, c.duration]))).toEqual(Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => [k, c.duration])));
      geo.add(prov.mesh.geometryHash); src.add(X.sourceSha256); task.add(X.meshyTaskId); out.add(prov.outputs.glb.sha256);
    }
    // four different approved bodies, four different Meshy tasks
    for (const s of [geo, src, task, out]) expect(s.size).toBe(4);
  });

  it('each variant keeps its own carriage: its arms hang where its own bind pose has them (no shared re-pose)', () => {
    const P = Object.fromEntries(VARIANTS.map(V => [V.v, poser(loaded.get(V.v)!)]));
    const handX: Record<string, number> = {};
    for (const V of VARIANTS) {
      const p = P[V.v];
      p.at(null, 0);
      const bindL = p.bone('L_Hand'), bindR = p.bone('R_Hand'), bindSh = p.bone('L_UpperArm');
      expect(bindL.y, `${V.v}: the bind arms hang`).toBeLessThan(bindSh.y - 0.45);
      p.at('Idle', 0);
      // Idle keeps the hands close to where the body was generated (the approved posture lives in the bind geometry)
      expect(p.bone('L_Hand').distanceTo(bindL), V.v).toBeLessThan(0.2);
      expect(p.bone('R_Hand').distanceTo(bindR), V.v).toBeLessThan(0.2);
      handX[V.v] = bindL.x;
    }
    // the Track Ganger carries its arms furthest from the body
    expect(handX.sc02).toBeGreaterThan(Math.max(handX.sc01, handX.sc03, handX.sc04) + 0.05);
  });

  it('the Lopsided Sleeper stays lopsided: one shoulder and hand clearly lower than the other (not symmetrised)', () => {
    const p = poser(loaded.get('sc03')!);
    p.at(null, 0);
    expect(Math.abs(p.bone('L_UpperArm').y - p.bone('R_UpperArm').y)).toBeGreaterThan(0.05);
    expect(Math.abs(p.bone('L_Hand').y - p.bone('R_Hand').y)).toBeGreaterThan(0.08);
    expect(provOf(VARIANTS[2]).skeleton.armsSymmetric).toBe(false);
    // the others were measured symmetric within tolerance
    for (const V of [VARIANTS[0], VARIANTS[1], VARIANTS[3]]) expect(provOf(V).skeleton.armsSymmetric, V.v).toBe(true);
  });
});
