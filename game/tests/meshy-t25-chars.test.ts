// Meshy T2.5 migration (task studio-meshy-game-replacement-20261029-01, lane CHARS): the locally generated characters
// (zombie bodies, fitted garments, the rat-dog) are rebuilt from accepted Meshy T2.5 replacements by the EXISTING local
// CPU rig pipelines - real animated characters, not static statues. Checks, on the REAL shipped derivatives:
//  - class provenance (meshy-t25-chars-20261029.json): Meshy task / native / ORIGINAL input image per replaced master,
//    runtime file hashes, restore map of every superseded path; the live manifest serves the -t25 files;
//  - no legacy runtime reference: no live code path names a superseded runtime file;
//  - rig: the shared 18-joint hierarchy (names, parents, identity bind rotations, inverse binds = joint positions),
//    skin weights normalised over at most 4 of the 18 joints and bound to THIS mesh, every deforming bone used;
//  - clips: the six clips present and sampled sanely with three's AnimationMixer (finite, upright locomotion, death
//    lying on the floor), the build's CPU-skinning floor verification clean;
//  - hit zones: measured radii in human ranges, the derived runtime volumes, the calibration reference body;
//  - garment fit: every variant indexes its body's exact geometry, the fit07 pose gate / motion gate passed for every
//    shipped pair of a replaced body or garment, masks sized to the body;
//  - the ragdoll builds and settles for every replaced body (with its required pants).
import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {readFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {MODEL_FILES} from '../src/assets/manifest';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES, ZombieLookLibrary, outfitNodeName, REFERENCE_HIT, HIT_CALIBRATION, type ZombieLook} from '../src/ai/outfits';
import {ZombieActor} from '../src/ai/zombieActor';
import {PhysicsSystem} from '../src/physics/world';
import {Grid, FLOOR, SOLID} from '../src/gen/grid';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const pub = (rel: string) => here('../public/' + rel);
const deriv = <T>(f: string): T => JSON.parse(readFileSync(pub('assets/derivatives/' + f), 'utf8')) as T;
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const BASE = 'a7a646a1dd62bf1c641fe3dd0d1187ab322afe87';
const JOINTS: [string, string | null][] = [['Root', null], ['Hips', 'Root'], ['Spine', 'Hips'], ['Chest', 'Spine'], ['Neck', 'Chest'], ['Head', 'Neck'],
  ['L_UpperArm', 'Chest'], ['L_Forearm', 'L_UpperArm'], ['L_Hand', 'L_Forearm'], ['R_UpperArm', 'Chest'], ['R_Forearm', 'R_UpperArm'], ['R_Hand', 'R_Forearm'],
  ['L_Thigh', 'Hips'], ['L_Shin', 'L_Thigh'], ['L_Foot', 'L_Shin'], ['R_Thigh', 'Hips'], ['R_Shin', 'R_Thigh'], ['R_Foot', 'R_Shin']];
const CLIPS = ['Attack', 'Death', 'Hit', 'Idle', 'Run', 'Walk'];

interface Rec {
  asset: string; class: string; status: string; oldRuntimePath: string;
  meshy?: {meshyTaskId: string; nativeGlb: string; nativeSha256: string; inputImage: string; inputImageSha256: string; review: string; provider: string};
  runtime?: {path: string; sha256: string; bytes: number; triangles: number; textures: {size: [number, number]}[]; fittedBodies?: string[]};
  restore?: {path: string; baseCommit: string; blob: string} | null;
}
const prov = deriv<{task: string; baseCommit: string; counts: Record<string, number>; masters: Rec[]; rebuiltWithoutSourceChange: {asset: string; runtime: string; restore: {path: string; blob: string}}[]}>('meshy-t25-chars-20261029.json');
const wardrobe = deriv<{fit07: {gate: {limits: {bind: number; animated: number; extreme: number}; variants: {body: string; wearable: string; bind: number; animated: number; extreme: number; pass: boolean}[]}}; pairs: {body: string; wearable: string; motion?: {fraction: number}}[]; quality: {maxFractionOver: number}}>('zombie-wardrobe.json');
const replaced = prov.masters.filter(r => r.status === 'replaced');
const replacedBodies = replaced.filter(r => r.asset.startsWith('body:')).map(r => r.asset.slice(5));
const replacedWear = replaced.filter(r => r.asset.startsWith('garment:')).map(r => r.asset.slice(8));
const fileOf = (model: string) => (MODEL_FILES as Record<string, {url: string; bytes: number} | undefined>)[model];

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const models: Record<string, GLTF> = {};
let lib: ZombieLookLibrary;
beforeAll(async () => {
  for (const d of [...ZOMBIE_BODIES, ...ZOMBIE_WEARABLES]) { const f = fileOf(d.model); if (f && existsSync(pub(f.url))) models[d.model] = await loadStripped(f.url); }
  lib = new ZombieLookLibrary(models);
}, 240000);

describe('Meshy T2.5 characters: provenance and live files', () => {
  it('the pilot set is replaced (heavyset body, hoodie, rat-dog) and every replaced master has full provenance', () => {
    expect(prov.task).toBe('studio-meshy-game-replacement-20261029-01');
    expect(prov.baseCommit).toBe(BASE);
    for (const id of ['body:heavyset', 'garment:hoodie', 'creature:ratdog']) expect(replaced.map(r => r.asset), id).toContain(id);
    for (const r of replaced) {
      expect(r.meshy?.provider, r.asset).toMatch(/meshy-t2\.5/);
      expect(r.meshy?.review, r.asset).toBe('accepted');
      expect(r.meshy?.meshyTaskId, r.asset).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.meshy?.nativeSha256, r.asset).toMatch(/^[0-9a-f]{64}$/);
      expect(r.meshy?.inputImageSha256, r.asset).toMatch(/^[0-9a-f]{64}$/);
      // no signed URLs / secrets in public provenance: only repo-relative paths
      expect(JSON.stringify(r)).not.toMatch(/https?:\/\/|X-Amz|Signature=|api[_-]?key/i);
      // the runtime file is the -t25 derivative actually shipped
      expect(r.runtime!.path, r.asset).toMatch(/-t25\.glb$/);
      expect(sha(here('../../' + r.runtime!.path)), r.asset).toBe(r.runtime!.sha256);
      expect(statSync(here('../../' + r.runtime!.path)).size).toBe(r.runtime!.bytes);
      // restore map: the superseded runtime path in the pushed base commit (git blob)
      expect(r.restore).toMatchObject({path: r.oldRuntimePath, baseCommit: BASE});
      expect(r.restore!.blob, r.asset).toMatch(/^[0-9a-f]{40}$/);
      // the raw native / original image (outside the game) still hash as recorded when present on this machine
      const native = here('../../' + r.meshy!.nativeGlb), img = here('../../' + r.meshy!.inputImage);
      if (existsSync(native)) expect(sha(native), r.asset).toBe(r.meshy!.nativeSha256);
      if (existsSync(img)) expect(sha(img), r.asset).toBe(r.meshy!.inputImageSha256);
    }
    console.log(`[t25 chars] ${JSON.stringify(prov.counts)}; replaced: ${replaced.map(r => r.asset).join(', ')}`);
  });

  it('budgets: bodies <= 20k triangles / 1024 px, creature <= 15k, garments <= 1024 px textures', () => {
    for (const r of replaced) {
      const maxTex = Math.max(...r.runtime!.textures.map(t => Math.max(...t.size)));
      expect(maxTex, r.asset).toBeLessThanOrEqual(1024);
      if (r.asset.startsWith('body:')) expect(r.runtime!.triangles, r.asset).toBeLessThanOrEqual(20000);
      if (r.asset.startsWith('creature:')) expect(r.runtime!.triangles, r.asset).toBeLessThanOrEqual(15000);
    }
  });

  it('the live manifest serves every rebuilt file (and the byte hints match); no live code path names a superseded file', () => {
    const live = [...replaced.map(r => r.runtime!.path), ...prov.rebuiltWithoutSourceChange.map(r => r.runtime)];
    const urls = Object.values(MODEL_FILES).map(f => 'game/public/' + f.url);
    for (const p of live) expect(urls, p).toContain(p);
    for (const [k, f] of Object.entries(MODEL_FILES)) {
      if (!/^(zombieBody_|outfit_|creature_)/.test(k)) continue;
      expect(existsSync(pub(f.url)), k).toBe(true);
      expect(Math.abs(statSync(pub(f.url)).size - f.bytes) / f.bytes, k).toBeLessThan(0.05);
    }
    // superseded runtime paths: not referenced by any game source file (comments may describe history; no URL)
    const superseded = [...replaced, ...prov.rebuiltWithoutSourceChange.map(r => ({restore: r.restore}))].map(r => r.restore?.path).filter((p): p is string => !!p);
    expect(superseded.length).toBeGreaterThanOrEqual(3);
    const srcFiles: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, {withFileTypes: true})) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx|js|mjs|json)$/.test(e.name)) srcFiles.push(f); } };
    walk(here('../src'));
    for (const p of superseded) {
      const url = p.replace(/^game\/public\//, '');
      for (const f of srcFiles) expect(readFileSync(f, 'utf8').includes(`'${url}'`) || readFileSync(f, 'utf8').includes(`"${url}"`), `${f} names ${url}`).toBe(false);
    }
  });
});

describe('Meshy T2.5 bodies: rig, skin, clips, hit zones', () => {
  const bodyModel = (id: string) => ZOMBIE_BODIES.find(b => b.id === id)!.model;
  it('every replaced body: shared 18-joint hierarchy, identity bind rotations, inverse binds at the joint positions', async () => {
    expect(replacedBodies).toContain('heavyset');
    for (const id of replacedBodies) {
      const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
      const doc = await io.read(pub(fileOf(bodyModel(id))!.url));
      const node = doc.getRoot().listNodes().find(n => n.getName() === 'ZombieBody')!;
      const skin = node.getSkin()!, joints = skin.listJoints();
      expect(joints.map(j => j.getName()), id).toEqual(JOINTS.map(j => j[0]));
      for (const [i, [name, parent]] of JOINTS.entries()) {
        const j = joints[i];
        expect(j.getRotation(), `${id} ${name}`).toEqual([0, 0, 0, 1]);
        const par = joints.find(p => p.listChildren().includes(j));
        expect(par?.getName() ?? null, `${id} ${name} parent`).toBe(parent);
      }
      // world bind position from the hierarchy == -translation of the inverse bind matrix
      const ibm = skin.getInverseBindMatrices()!.getArray()!;
      const world = (i: number): number[] => { const j = joints[i], t = j.getTranslation(); const par = joints.findIndex(p => p.listChildren().includes(j)); if (par < 0) return [...t]; const w = world(par); return [w[0] + t[0], w[1] + t[1], w[2] + t[2]]; };
      for (let i = 0; i < joints.length; i++) { const w = world(i); for (let k = 0; k < 3; k++) expect(-ibm[i * 16 + 12 + k], `${id} ${joints[i].getName()}`).toBeCloseTo(w[k], 4); }
      const prim = node.getMesh()!.listPrimitives()[0];
      const W = prim.getAttribute('WEIGHTS_0')!, J = prim.getAttribute('JOINTS_0')!, P = prim.getAttribute('POSITION')!;
      expect(W.getCount()).toBe(P.getCount());
      expect(W.getNormalized()).toBe(true);
      const w = W.getArray()!, ja = J.getArray()!;
      const used = new Set<number>();
      let bad = 0;
      for (let v = 0; v < W.getCount(); v++) {
        let s = 0;
        for (let k = 0; k < 4; k++) { s += w[v * 4 + k]; expect(ja[v * 4 + k]).toBeLessThan(18); if (w[v * 4 + k] > 25) used.add(ja[v * 4 + k]); }
        if (s !== 255) bad++;
      }
      expect(bad, `${id} weights not normalised`).toBe(0);
      for (const n of JOINTS.map(j => j[0]).filter(n => n !== 'Root')) expect(used.has(JOINTS.findIndex(j => j[0] === n)), `${id} bone ${n} drives skin`).toBe(true);
      // bound to THIS mesh: extras triangle count / geometry hash describe the shipped geometry
      const ex = doc.getRoot().listScenes()[0].getExtras().zombieBody as {bodyTriangles: number; geometryHash: string; heightM: number};
      expect(prim.getIndices()!.getCount() / 3).toBe(ex.bodyTriangles);
      const pos = P.getArray() as Float32Array, idx = prim.getIndices()!.getArray()!;
      const idx32 = Uint32Array.from(idx);
      expect(createHash('sha256').update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength)).update(Buffer.from(idx32.buffer)).digest('hex').slice(0, 16), id).toBe(ex.geometryHash);
      // metres, +Y up, feet on the floor, origin between the feet, facing +Z (toes in front of the heels)
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
      expect(minY).toBeGreaterThan(-0.01); expect(minY).toBeLessThan(0.02);
      expect(maxY).toBeCloseTo(ex.heightM, 2);
      const m = deriv<{skeleton: {ends: Record<string, number[]>; joints: {name: string; bindWorldPosition: number[]}[]}; conventions: {facing: string}; source: {sha256Verified: string}; t25: {sourceReplaced: boolean}}>(`zombie-body-${id}.json`);
      expect(m.conventions.facing).toBe('+Z');
      expect(m.t25.sourceReplaced).toBe(true);
      const foot = m.skeleton.joints.find(j => j.name === 'L_Foot')!.bindWorldPosition;
      expect(m.skeleton.ends.L_Foot[2]).toBeGreaterThan(foot[2] + 0.05);
    }
  });

  it('the six clips sample sanely with the runtime mixer; the build CPU-skinning floor verification is clean', () => {
    for (const id of replacedBodies) {
      const g = models[bodyModel(id)];
      expect(g.animations.map(a => a.name).sort(), id).toEqual(CLIPS);
      const root = g.scene.clone(true);
      const mixer = new THREE.AnimationMixer(root);
      const bone = (n: string) => root.getObjectByName(n)!;
      const H = (g.scene.userData.zombieBody as {heightM: number}).heightM;
      for (const clip of g.animations) {
        mixer.stopAllAction();
        const a = mixer.clipAction(clip); a.reset().play();
        for (const f of [0, 0.25, 0.5, 0.75, 0.999]) {
          mixer.setTime(f * clip.duration);
          root.updateMatrixWorld(true);
          const head = bone('Head').getWorldPosition(new THREE.Vector3()), hips = bone('Hips').getWorldPosition(new THREE.Vector3());
          expect([head.x, head.y, head.z, hips.y].every(Number.isFinite), `${id} ${clip.name}`).toBe(true);
          if (['Idle', 'Walk', 'Run', 'Attack', 'Hit'].includes(clip.name)) {
            expect(head.y, `${id} ${clip.name} upright`).toBeGreaterThan(0.75 * H);
            expect(hips.y, `${id} ${clip.name} hips`).toBeGreaterThan(0.38 * H);
          }
        }
        if (clip.name === 'Death') { mixer.setTime(clip.duration); root.updateMatrixWorld(true); expect(bone('Head').getWorldPosition(new THREE.Vector3()).y, `${id} death lies down`).toBeLessThan(0.45); }
      }
      const m = deriv<{verification: {cpuSkinningFloor: Record<string, Record<string, {minY?: number} | unknown>>}; clips: {name: string}[]}>(`zombie-body-${id}.json`);
      expect(m.clips.map(c => c.name).sort()).toEqual(CLIPS);
      let worst = Infinity;
      for (const c of Object.values(m.verification.cpuSkinningFloor)) for (const v of Object.values(c)) if (v && typeof v === 'object' && 'minY' in v && typeof (v as {minY: number}).minY === 'number') worst = Math.min(worst, (v as {minY: number}).minY);
      expect(worst, `${id} lowest skinned vertex over every clip / worn set`).toBeGreaterThan(-0.03);
    }
  });

  it('hit zones: measured radii in human ranges, runtime volumes derived from them; the calibration reference body matches', () => {
    for (const id of replacedBodies) {
      const hit = (models[bodyModel(id)].scene.userData.zombieBody as {hit: Record<string, number>}).hit;
      expect(hit.head).toBeGreaterThan(0.09); expect(hit.head).toBeLessThan(0.17);
      expect(hit.torso).toBeGreaterThan(0.1); expect(hit.torso).toBeLessThan(0.3);
      expect(hit.arm).toBeGreaterThan(0.04); expect(hit.arm).toBeLessThan(0.12);
      expect(hit.leg).toBeGreaterThan(0.06); expect(hit.leg).toBeLessThan(0.15);
      const app = lib.build({body: id, wear: {lower: lib.wearables.find(w => w.slot === 'lower' && lib.supports(id, w.id))!.id}});
      expect(app.hit.head).toBeCloseTo((hit.head + 0) * HIT_CALIBRATION.head, 5);
      expect(app.girth.torso).toBeCloseTo(hit.torso / REFERENCE_HIT.torso, 5);
    }
    // REFERENCE_HIT = the measured radii of the live calibration body (Last-shift)
    const ref = (models[bodyModel('lastshift')].scene.userData.zombieBody as {hit: Record<string, number>}).hit;
    for (const k of ['head', 'torso', 'arm', 'leg'] as const) expect(Math.abs(ref[k] - REFERENCE_HIT[k]) / REFERENCE_HIT[k], k).toBeLessThan(0.03);
  });
});

describe('Meshy T2.5 garments: per-body fits on the new topology', () => {
  it('every variant of a replaced garment / on a replaced body indexes that body exactly and passed the pose + motion gates', () => {
    const limits = wardrobe.fit07.gate.limits;
    let checked = 0;
    for (const w of lib.wearables) for (const b of lib.bodies) {
      if (!lib.supports(b.id, w.id) || !(replacedWear.includes(w.id) || replacedBodies.includes(b.id))) continue;
      const v = lib.variant(w.id, b.id)!;
      const ex = v.userData as {bodyGeometryHash: string; bodyTriangles: number; hideBodyTriangles: string; body: string; outfit: string};
      const be = models[b.model].scene.userData.zombieBody as {geometryHash: string; bodyTriangles: number};
      expect(ex.bodyGeometryHash, `${w.id}x${b.id}`).toBe(be.geometryHash);
      expect(ex.bodyTriangles).toBe(be.bodyTriangles);
      expect(atob(ex.hideBodyTriangles).length, `${w.id}x${b.id} mask size`).toBe(Math.ceil(be.bodyTriangles / 8));
      // skinned over the body's 18 joints, normalised
      const sw = v.geometry.getAttribute('skinWeight'), si = v.geometry.getAttribute('skinIndex');
      for (let i = 0; i < sw.count; i += 5) { let s = 0; for (let k = 0; k < 4; k++) { s += sw.getComponent(i, k); expect(si.getComponent(i, k)).toBeLessThan(18); } expect(Math.abs(s - 1)).toBeLessThan(0.01); }
      if (w.slot === 'upper' || w.slot === 'lower') {
        const g = wardrobe.fit07.gate.variants.find(x => x.body === b.id && x.wearable === w.id)!;
        expect(g?.pass, `${w.id}x${b.id} fit07 gate`).toBe(true);
        expect(g.bind).toBeLessThanOrEqual(limits.bind); expect(g.animated).toBeLessThanOrEqual(limits.animated); expect(g.extreme).toBeLessThanOrEqual(limits.extreme);
        const p = wardrobe.pairs.find(x => x.body === b.id && x.wearable === w.id);
        if (p?.motion) expect(p.motion.fraction, `${w.id}x${b.id} motion stretch`).toBeLessThanOrEqual(wardrobe.quality.maxFractionOver);
      }
      checked++;
    }
    console.log(`[t25 chars] garment variants on replaced bodies / of replaced garments checked: ${checked}`);
    expect(checked).toBeGreaterThan(10);
    // the replaced hoodie still fits the bodies it fitted before (incl. the replaced heavyset)
    for (const b of ['heavyset', 'lastshift']) expect(lib.supports(b, 'hoodie'), `hoodie on ${b}`).toBe(true);
    expect(lib.variant('hoodie', 'heavyset')!.name).toBe(outfitNodeName('hoodie', 'heavyset'));
  });

  it('the ragdoll builds and settles from every replaced body wearing its required pants (+ the replaced hoodie)', () => {
    const g = new Grid(48, 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 46 ? SOLID : FLOOR);
    const ph = new PhysicsSystem(null);
    ph.build({grid: g, props: [], trench: {floorY: -1.15}} as unknown as Parameters<PhysicsSystem['build']>[0]);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let n = 0;
    for (const id of replacedBodies) {
      const lower = lib.wearables.find(w => w.slot === 'lower' && lib.supports(id, w.id) && (!lib.supports(id, 'hoodie') || lib.compatible(id, lib.wearable('hoodie')!, w)))!;
      const look: ZombieLook = {body: id, wear: {lower: lower.id, ...(lib.supports(id, 'hoodie') ? {upper: 'hoodie'} : {})}};
      expect(lib.isValid(look), JSON.stringify(look)).toBe(true);
      const z = new ZombieActor(lib.build(look), {x: 6 + n * 4, z: 8, yaw: 0.2, type: 'shambler', area: 0}, rand);
      n++;
      for (let i = 0; i < 12; i++) { z.animate(1 / 60, 'Walk', 0.6); z.syncTransform(); z.updateVolumes(); }
      z.brain.damage(999, 0, 0);
      expect(ph.ragdoll(z, {dir: {x: 0, y: -0.1, z: -1}, point: {x: z.brain.x, y: 1.2, z: z.brain.z}, strength: 38})).toBe(true);
      for (let i = 0; i < 240; i++) ph.update(1 / 60);
      z.root.updateMatrixWorld(true);
      const ys: number[] = [];
      z.root.traverse(o => { if ((o as THREE.Bone).isBone) ys.push(o.getWorldPosition(new THREE.Vector3()).y); });
      expect(ys.every(Number.isFinite)).toBe(true);
      expect(Math.min(...ys)).toBeGreaterThan(-0.03);
      expect(z.bone('Head')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.55);
    }
    expect(ph.stats().ragdollsFailed).toBe(0);
  });
});
