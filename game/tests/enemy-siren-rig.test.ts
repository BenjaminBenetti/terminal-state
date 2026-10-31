// Task track1-siren-blightbelly-20261031 (lane RIGS): invariants of the APPEARANCE-LOCKED Siren rig builder
// (tools/asset-pipeline/enemy/build-siren.mjs + lib/*). User direction: "Don't modify the siren. The siren's already perfect."
//  1. builder on a PROJECT-OWNED procedural stand-in (generated here; CI has no user uploads): native POSITION / NORMAL /
//     TEXCOORD_0 / indices / materials / texture bytes + decoded pixels unchanged, bind pose = uniform fit x native (glTF CPU
//     skinning AND three.js SkinnedMesh), 18 shared joints, 6 clips, weights normalised (rows sum to 255), extras;
//  2. the shipped enemy-siren.glb against its sidecar (accessor / texture sha256 recorded from the verified uploads at build
//     time, pinned upload hashes, clips, joints, weights, file hash) — and, when the uploads are staged locally, the full proof.
import {describe, expect, it, beforeAll, afterAll} from 'vitest';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const lib = async (f: string) => import(pathToFileURL(path.join(ROOT, 'tools/asset-pipeline/enemy/lib', f)).href);
const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
const CLIPS = ['Dormant', 'Rise', 'Run', 'Attack', 'Hit', 'Death'];
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytesOf = (a: ArrayLike<number> & {buffer: ArrayBufferLike; byteOffset: number; byteLength: number}) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function threeParse(file: string): Promise<GLTF> {
  const doc = await io().read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io().writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

type Proof = {ok: boolean; parts: {name: string; attributes: Record<string, {equal: boolean; sha256: string}>; indices: {equal: boolean}; materialEqual: boolean; bindPose: {equal: boolean; maxPositionErrorM: number}; weightRowsNot255: number}[];
  textures: {count: number; encodedBytesEqual: boolean; pixelsEqual: boolean; items: {sha256: string}[]}};

describe('appearance-locked Siren rig builder on a procedural stand-in', () => {
  let out = '', proof: Proof, R: {place: {M: number[]}; dress: {M: number[]}; extras: Record<string, unknown>; skel: {joints: Record<string, number[]>}};
  let bodyFile = '', dressFile = '', dir = '';
  afterAll(() => { if (dir) rmSync(dir, {recursive: true, force: true}); });
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'siren-standin-'));
    const S = await lib('standin.mjs'), N = await lib('native-glb.mjs'), B = await lib('siren-build.mjs'), P = await lib('proof.mjs');
    bodyFile = await S.writeStandinHumanoid(path.join(dir, 'body.glb'));
    const src = await N.readSource(bodyFile), sp = N.singlePrimitive(src.doc, 'stand-in');
    const placed = B.placeBody(sp.prim.getAttribute('POSITION').getArray(), sp.world, 1.70);
    dressFile = await S.writeStandinGarment(path.join(dir, 'dress.glb'), N.transformPositions(sp.prim.getAttribute('POSITION').getArray(), placed.M));
    R = await B.buildSiren({body: {file: bodyFile, sha256: N.sha256File(bodyFile)}, dress: {file: dressFile, sha256: N.sha256File(dressFile)}, heightM: 1.70, hairLumMax: null,
      dressFit: {init: {s: 1, t: [0, 0, 0]}, weights: {strap: 0}, iterations: 25}});
    const {doc} = await B.assemble(R, 'enemy-siren-rig.test.ts');
    out = path.join(dir, 'standin-siren.glb');
    await N.io().write(out, doc);
    proof = await P.proveAppearance(out, [{name: 'SirenBody', srcDoc: (await N.readSource(bodyFile)).doc, M: R.place.M}, {name: 'SirenDress', srcDoc: (await N.readSource(dressFile)).doc, M: R.dress.M}]);
  }, 240_000);

  it('keeps every native vertex attribute, index buffer, material and texture byte-identical (pixels too)', () => {
    expect(proof.ok).toBe(true);
    for (const p of proof.parts) {
      for (const sem of ['POSITION', 'NORMAL', 'TEXCOORD_0']) expect(p.attributes[sem]?.equal, `${p.name} ${sem}`).toBe(true);
      expect(p.indices.equal && p.materialEqual, p.name).toBe(true);
    }
    expect(proof.textures).toMatchObject({count: 3, encodedBytesEqual: true, pixelsEqual: true}); // body PNG + garment JPEG / PNG
  });

  it('applies the fit only as ONE uniform similarity through the inverse bind matrices (bind pose = M x native)', async () => {
    const N = await lib('native-glb.mjs');
    for (const M of [R.place.M, R.dress.M]) expect(() => N.similarityScale(M)).not.toThrow();
    for (const p of proof.parts) { expect(p.bindPose.equal, p.name).toBe(true); expect(p.bindPose.maxPositionErrorM).toBeLessThan(2e-5); }
    // three.js reads it the same way: SkinnedMesh bind pose = M x POSITION (bindMatrix identity, fit carried by boneInverses)
    const gltf = await threeParse(out);
    gltf.scene.updateMatrixWorld(true);
    const meshes: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    expect(meshes.map(m => m.name).sort()).toEqual(['SirenBody', 'SirenDress']);
    for (const m of meshes) {
      expect(m.bindMatrix.equals(new THREE.Matrix4())).toBe(true);
      const M = new THREE.Matrix4().fromArray(m.name === 'SirenBody' ? R.place.M : R.dress.M);
      const pos = m.geometry.getAttribute('position'), v = new THREE.Vector3(), e = new THREE.Vector3();
      let maxErr = 0;
      for (let i = 0; i < pos.count; i += 7) { m.getVertexPosition(i, v); e.fromBufferAttribute(pos, i).applyMatrix4(M); maxErr = Math.max(maxErr, v.distanceTo(e)); }
      expect(maxErr, m.name).toBeLessThan(1e-4);
    }
  });

  it('rigs the shared 18-joint skeleton with 6 clips, normalised weights and the enemySiren extras', async () => {
    const doc = await io().read(out);
    const skins = doc.getRoot().listSkins();
    expect(skins.length).toBe(2);
    for (const s of skins) expect(s.listJoints().map(j => j.getName())).toEqual(JOINTS);
    for (const j of skins[0].listJoints()) expect(j.getRotation()).toEqual([0, 0, 0, 1]); // identity bind rotations (model-metre bone frames)
    expect(doc.getRoot().listAnimations().map(a => a.getName())).toEqual(CLIPS);
    for (const p of proof.parts) expect(p.weightRowsNot255, p.name).toBe(0);
    for (const m of doc.getRoot().listMeshes()) {
      const prim = m.listPrimitives()[0];
      expect(prim.getAttribute('WEIGHTS_0')!.getNormalized()).toBe(true);
      expect(Math.max(...(prim.getAttribute('JOINTS_0')!.getArray() as Uint8Array))).toBeLessThan(18);
    }
    const ex = doc.getRoot().listScenes()[0].getExtras().enemySiren as {clips: Record<string, {duration: number; impactTime?: number}>; hitRadii: Record<string, number>; dormant: {footprintM: Record<string, number>}; heightM: number};
    expect(Object.keys(ex.clips)).toEqual(CLIPS);
    expect(ex.clips.Attack.impactTime).toBeGreaterThan(0.2);
    expect(ex.clips.Attack.impactTime!).toBeLessThan(ex.clips.Attack.duration);
    expect(Object.keys(ex.hitRadii).sort()).toEqual(['arm', 'head', 'leg', 'torso']);
    expect(ex.heightM).toBeCloseTo(1.70, 2);
    expect(ex.dormant.footprintM.maxZ).toBeGreaterThan(ex.dormant.footprintM.minZ);
    expect(R.skel.joints.Head[1]).toBeGreaterThan(R.skel.joints.Neck[1]);
  });
});

describe('shipped enemy-siren.glb (user-supplied Siren, appearance-locked)', () => {
  const PUB = path.join(ROOT, 'game/public');
  const glb = path.join(PUB, 'assets/models/enemy-siren.glb');
  const side = JSON.parse(readFileSync(path.join(PUB, 'assets/derivatives/enemy-siren.json'), 'utf8'));
  const UPLOADS = {body: {id: '1f8ac189e97848b984697f9ab4f4a7c7', sha256: '6437be9e8ce2d0c254ad9ef12d22ac6f521c640ab7844d36e84825dc232900b4'}, dress: {id: 'fbe47869acac46f3a52d808bab79f80a', sha256: 'aa3e731f0bfd6f1a80c5c0ee56c019f1c0d1625c347c5978db56988fa55a2a8c'}};

  it('is the recorded build of the two pinned uploads, under the single-file guard', () => {
    const bytes = readFileSync(glb);
    expect(sha(bytes)).toBe(side.output.sha256);
    expect(bytes.length).toBe(side.output.bytes);
    expect(statSync(glb).size).toBeLessThan(25 * 1024 * 1024);
    expect(side.provenance.sources.map((s: {uploadId: string; sha256: string}) => [s.uploadId, s.sha256])).toEqual([[UPLOADS.body.id, UPLOADS.body.sha256], [UPLOADS.dress.id, UPLOADS.dress.sha256]]);
    expect(side.provenance.status).toMatch(/appearance-locked, technical rig \/ fit only; no licence clearance implied/);
    expect(side.appearanceLock.proof.ok).toBe(true);
  });

  it('carries the uploads\' native accessors and texture bytes exactly as recorded from the verified sources', async () => {
    const doc = await io().read(glb);
    const proof = side.appearanceLock.proof as Proof;
    for (const p of proof.parts) {
      const prim = doc.getRoot().listMeshes().find(m => m.getName() === p.name)!.listPrimitives()[0];
      for (const [sem, a] of Object.entries(p.attributes)) expect(sha(bytesOf(prim.getAttribute(sem)!.getArray()!)), `${p.name} ${sem}`).toBe(a.sha256);
    }
    expect(doc.getRoot().listTextures().map(t => sha(t.getImage()!)).sort()).toEqual(proof.textures.items.map(t => t.sha256).sort());
    expect(doc.getRoot().listTextures().length).toBe(4); // body base colour PNG + dress base colour / metallic-roughness / normal JPEGs
    expect(doc.getRoot().listSkins().map(s => s.listJoints().map(j => j.getName()))).toEqual([JOINTS, JOINTS]);
    expect(doc.getRoot().listAnimations().map(a => a.getName())).toEqual(CLIPS);
    for (const m of doc.getRoot().listMeshes()) {
      const w = m.listPrimitives()[0].getAttribute('WEIGHTS_0')!.getArray() as Uint8Array;
      let bad = 0; for (let i = 0; i < w.length; i += 4) if (w[i] + w[i + 1] + w[i + 2] + w[i + 3] !== 255) bad++;
      expect(bad, m.getName()).toBe(0);
    }
  });

  const staged = path.join(ROOT, '.cache/track1-siren-20261031');
  it.skipIf(!existsSync(path.join(staged, UPLOADS.body.id + '.glb')))('full appearance proof against the staged uploads (local only)', async () => {
    const N = await lib('native-glb.mjs'), P = await lib('proof.mjs');
    const body = await N.readSource(path.join(staged, UPLOADS.body.id + '.glb'), UPLOADS.body.sha256);
    const dress = await N.readSource(path.join(staged, UPLOADS.dress.id + '.glb'), UPLOADS.dress.sha256);
    const proof = await P.proveAppearance(glb, [{name: 'SirenBody', srcDoc: body.doc, M: side.fit.body.matrix}, {name: 'SirenDress', srcDoc: dress.doc, M: side.fit.dress.matrix}]) as Proof;
    expect(proof.ok).toBe(true);
  }, 120_000);
});
