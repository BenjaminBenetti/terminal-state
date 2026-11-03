// Task studio-beta-mall-lingerie-20261102-221554-01 (lane BODY): the three user-uploaded female zombie bodies (Meshy AI
// exports from langery-store-zombie-pack.zip: unrigged single-mesh T-pose, nude) as ORDINARY wardrobe bodies, rigged by the
// existing local pipeline (tools/asset-pipeline/zombie/build-wardrobe.mjs, LBS T -> A repose lib/repose-skin.mjs) and wearing
// REGULAR wardrobe garments refitted through the fit07 gate. Checks, on the REAL shipped derivatives:
//  - registration: ZOMBIE_BODIES ids / model keys / contract file names, additive weight, requires upper AND lower, nude;
//    the six existing bodies keep their registry data; provenance pins the user uploads (sha256), unapproved, raw not shipped;
//  - rig: the shared 18-joint hierarchy (identity bind rotations, inverse binds = joint positions), normalised 4-influence
//    weights bound to THIS mesh, every deforming bone used, 6 clips sampled sanely by the runtime mixer;
//  - budgets: <= 15 k triangles, 1024 colour + 256 metal-rough JPEG, no normal map; measured height 1.62-1.70 m;
//  - hit volumes: measured radii in human ranges, runtime volumes derived through the kept calibration;
//  - garments: >= 2 uppers (>= 1 light) and >= 1 lower fitted per body, exactly the shipped list, every upper / lower
//    variant passed the fit07 pose gate and the motion gate and indexes the body's exact geometry;
//  - never bare: selection always fills both slots, a bare / half look is invalid, build() completes it; pool share.
import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {readFileSync, existsSync, statSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {MODEL_FILES} from '../src/assets/manifest';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES, ZombieLookLibrary, pickZombieLook, outfitNodeName, HIT_CALIBRATION, REFERENCE_HIT, type ZombieLook} from '../src/ai/outfits';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const pub = (rel: string) => here('../public/' + rel);
const deriv = <T>(f: string): T => JSON.parse(readFileSync(pub('assets/derivatives/' + f), 'utf8')) as T;
const JOINTS: [string, string | null][] = [['Root', null], ['Hips', 'Root'], ['Spine', 'Hips'], ['Chest', 'Spine'], ['Neck', 'Chest'], ['Head', 'Neck'],
  ['L_UpperArm', 'Chest'], ['L_Forearm', 'L_UpperArm'], ['L_Hand', 'L_Forearm'], ['R_UpperArm', 'Chest'], ['R_Forearm', 'R_UpperArm'], ['R_Hand', 'R_Forearm'],
  ['L_Thigh', 'Hips'], ['L_Shin', 'L_Thigh'], ['L_Foot', 'L_Shin'], ['R_Thigh', 'Hips'], ['R_Shin', 'R_Thigh'], ['R_Foot', 'R_Shin']];
const CLIPS = ['Attack', 'Death', 'Hit', 'Idle', 'Run', 'Walk'];

/** The contract: ids, model keys, runtime files, the pinned user uploads and the shipped regular-garment fits. */
const PALE = [
  {id: 'paleGaze', file: 'pale-gaze', upload: 'Meshy_AI_Pale_Gaze_1102220630_texture.glb', sha256: '55e20c5678c74ae878cb9d4a10d1d62cc859a40070b8fdbb11151e8f8a49a7f4', heightM: 1.64},
  {id: 'paleRevenant', file: 'pale-revenant', upload: 'Meshy_AI_Pale_Revenant_1102220624_texture.glb', sha256: '8f1253920fe0460848d47fc7455b63d84c0fd0e71f3d6d269ba270fd28d48561', heightM: 1.66},
  {id: 'paleApparition', file: 'pale-apparition', upload: 'Meshy_AI_Pale_Apparition_1102220614_texture.glb', sha256: '732ce6c8ae264e0a570ea48c7e308cdf2f9fc423d389a8372a2f0d40e710731e', heightM: 1.67},
] as const;
/** Regular garments shipped per pale body (the compact subset of the gate-passing fits; wardrobe.config.mjs `wear`). */
const SHIPPED: Record<string, string[]> = {
  paleGaze: ['hoodie', 'sweater', 'jeans', 'cargo', 'beanie', 'cap'],
  paleRevenant: ['hoodie', 'flannel', 'slacks', 'jeans', 'cap', 'hardhat'],
  paleApparition: ['flannel', 'sweater', 'cargo', 'slacks', 'beanie', 'hardhat'],
};
/** Tops that would show the unclothed torso (open front / sleeveless) are never fitted to these bodies. */
const NOT_COVERING = ['coat', 'blazer', 'hivis'];
const EXISTING = ['lastshift', 'courier', 'agent', 'scavenger', 'heavyset', 'tall'];

const fileOf = (model: string) => (MODEL_FILES as Record<string, {url: string; bytes: number} | undefined>)[model];
async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
interface BodyJson {
  status: {approved: boolean; gameReady: boolean}; provenance: string; origin: string; traits: {requires: string[]; nude: boolean};
  source: {sha256Verified: string; file: string; userUpload: {name: string; sha256: string; zip: {name: string; sha256: string}}};
  t25: {sourceReplaced: boolean; migration: string | null}; poseCorrection: {version: string; sides: Record<string, {armFromVerticalDegAfter: number}>; hair: {weldedHairVerticesWithArmWeights: number}; chestWallGuard: {rowsChanged: number}};
  outputs: {glb: {path: string; bytes: number; sha256: string}}; mesh: {triangles: number}; conventions: {facing: string};
  skeleton: {ends: Record<string, number[]>; joints: {name: string; bindWorldPosition: number[]}[]; estimation: {legs: {crotchY: number}; neck: {override?: {neckBaseY: number}}}};
  verification: {cpuSkinningFloor: Record<string, Record<string, unknown>>};
}
const wardrobe = deriv<{fit07: {gate: {limits: {bind: number; animated: number; extreme: number}; variants: {body: string; wearable: string; bind: number; animated: number; extreme: number; pass: boolean}[]}};
  pairs: {body: string; wearable: string; motion?: {fraction: number}}[]; quality: {maxFractionOver: number}; excluded: {body: string; wearable: string; rule: string; reason?: string}[]; bodies: Record<string, {glb: string; sha256: string}>}>('zombie-wardrobe.json');

const models: Record<string, GLTF> = {};
let lib: ZombieLookLibrary;
beforeAll(async () => {
  for (const d of [...ZOMBIE_BODIES, ...ZOMBIE_WEARABLES]) { const f = fileOf(d.model); if (f && existsSync(pub(f.url))) models[d.model] = await loadStripped(f.url); }
  lib = new ZombieLookLibrary(models);
}, 240000);

describe('pale bodies: registration and provenance', () => {
  it('three ordinary bodies (contract ids / keys / files), additive weight, requires upper AND lower, nude; the six existing bodies unchanged', () => {
    expect(ZOMBIE_BODIES.map(b => b.id)).toEqual([...EXISTING, ...PALE.map(p => p.id)]);
    for (const b of ZOMBIE_BODIES.filter(x => EXISTING.includes(x.id))) { expect(b.weight, b.id).toBe(1); expect(b.nude, b.id).toBeUndefined(); }
    for (const p of PALE) {
      const b = ZOMBIE_BODIES.find(x => x.id === p.id)!;
      expect(b.model).toBe(`zombieBody_${p.id}`);
      expect(b.weight).toBe(0.5);
      expect(b.origin).toBe('uploaded');
      expect([...(b.requires ?? [])].sort()).toEqual(['lower', 'upper']);
      expect(b.nude).toBe(true);
      expect(b.covers ?? []).toEqual([]);
      const f = fileOf(b.model)!;
      expect(f.url).toBe(`assets/models/zombie-body-${p.file}-t25.glb`);
      expect(existsSync(pub(f.url))).toBe(true);
      expect(Math.abs(statSync(pub(f.url)).size - f.bytes) / f.bytes).toBeLessThan(0.05);
      expect(statSync(pub(f.url)).size).toBeLessThan(800_000); // compact (the raw uploads are 11-17 MB)
    }
  });

  it('provenance pins the user uploads (sha256), marks them unapproved, keeps the raw uploads out of the public tree', () => {
    for (const p of PALE) {
      const j = deriv<BodyJson>(`zombie-body-${p.file}.json`);
      expect(j.status).toMatchObject({approved: false, gameReady: false});
      expect(j.provenance).toBe('user-uploaded');
      expect(j.source.sha256Verified).toBe(p.sha256);
      expect(j.source.userUpload).toMatchObject({name: p.upload, sha256: p.sha256, zip: {name: 'langery-store-zombie-pack.zip'}});
      expect(j.source.file).not.toMatch(/^game\//);
      expect(j.t25.sourceReplaced).toBe(false);
      expect(j.traits).toMatchObject({requires: ['upper', 'lower'], nude: true});
      const glb = pub(fileOf(`zombieBody_${p.id}`)!.url);
      expect(j.outputs.glb.path).toBe(`game/public/${fileOf(`zombieBody_${p.id}`)!.url}`);
      expect(j.outputs.glb.sha256).toBe(createHash('sha256').update(readFileSync(glb)).digest('hex'));
      expect(wardrobe.bodies[p.id].sha256).toBe(j.outputs.glb.sha256);
      expect(JSON.stringify(j)).not.toMatch(/https?:\/\/|X-Amz|Signature=|api[_-]?key/i);
    }
    // no shipped public file is (or is named like) a raw upload
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, {withFileTypes: true})) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } };
    walk(pub(''));
    for (const f of files) {
      expect(f, 'raw upload name in public').not.toMatch(/Meshy_AI_Pale_/);
      expect([17841692, 17618868, 11656104], `${f} size`).not.toContain(statSync(f).size);
    }
  });
});

describe('pale bodies: rig, clips, budgets', () => {
  it('shared 18-joint hierarchy, identity bind rotations, inverse binds at the joints, normalised weights bound to this mesh', async () => {
    for (const p of PALE) {
      const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
      const doc = await io.read(pub(fileOf(`zombieBody_${p.id}`)!.url));
      const node = doc.getRoot().listNodes().find(n => n.getName() === 'ZombieBody')!;
      const skin = node.getSkin()!, joints = skin.listJoints();
      expect(joints.map(j => j.getName()), p.id).toEqual(JOINTS.map(j => j[0]));
      for (const [i, [name, parent]] of JOINTS.entries()) {
        expect(joints[i].getRotation(), `${p.id} ${name}`).toEqual([0, 0, 0, 1]);
        expect(joints.find(q => q.listChildren().includes(joints[i]))?.getName() ?? null, `${p.id} ${name} parent`).toBe(parent);
      }
      const ibm = skin.getInverseBindMatrices()!.getArray()!;
      const world = (i: number): number[] => { const j = joints[i], t = j.getTranslation(); const par = joints.findIndex(q => q.listChildren().includes(j)); if (par < 0) return [...t]; const w = world(par); return [w[0] + t[0], w[1] + t[1], w[2] + t[2]]; };
      for (let i = 0; i < joints.length; i++) { const w = world(i); for (let k = 0; k < 3; k++) expect(-ibm[i * 16 + 12 + k]).toBeCloseTo(w[k], 4); }
      const prim = node.getMesh()!.listPrimitives()[0];
      const W = prim.getAttribute('WEIGHTS_0')!, J = prim.getAttribute('JOINTS_0')!, P = prim.getAttribute('POSITION')!;
      expect(W.getNormalized()).toBe(true);
      const w = W.getArray()!, ja = J.getArray()!, used = new Set<number>();
      let bad = 0;
      for (let v = 0; v < W.getCount(); v++) { let s = 0; for (let k = 0; k < 4; k++) { s += w[v * 4 + k]; expect(ja[v * 4 + k]).toBeLessThan(18); if (w[v * 4 + k] > 25) used.add(ja[v * 4 + k]); } if (s !== 255) bad++; }
      expect(bad, `${p.id} weights not normalised`).toBe(0);
      for (const n of JOINTS.map(j => j[0]).filter(n => n !== 'Root')) expect(used.has(JOINTS.findIndex(j => j[0] === n)), `${p.id} bone ${n} drives skin`).toBe(true);
      const ex = doc.getRoot().listScenes()[0].getExtras().zombieBody as {id: string; bodyTriangles: number; geometryHash: string; heightM: number; clips: string[]};
      expect(ex.id).toBe(p.id);
      const pos = P.getArray() as Float32Array, idx32 = Uint32Array.from(prim.getIndices()!.getArray()!);
      expect(idx32.length / 3).toBe(ex.bodyTriangles);
      expect(ex.bodyTriangles).toBeLessThanOrEqual(15000);
      expect(createHash('sha256').update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength)).update(Buffer.from(idx32.buffer)).digest('hex').slice(0, 16)).toBe(ex.geometryHash);
      // metres, +Y up, feet on the floor, measured height in the adult-female range, facing +Z
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
      expect(minY).toBeGreaterThan(-0.01); expect(minY).toBeLessThan(0.02);
      expect(maxY).toBeCloseTo(p.heightM, 2); expect(ex.heightM).toBeCloseTo(p.heightM, 3);
      expect(ex.heightM).toBeGreaterThanOrEqual(1.62); expect(ex.heightM).toBeLessThanOrEqual(1.7);
      // textures: the user's Meshy maps re-baked at the wardrobe body targets; no normal map
      const mat = prim.getMaterial()!;
      expect(mat.getBaseColorTexture()!.getSize()).toEqual([1024, 1024]);
      expect(mat.getMetallicRoughnessTexture()!.getSize()).toEqual([256, 256]);
      expect(mat.getNormalTexture()).toBeNull();
      const m = deriv<BodyJson>(`zombie-body-${p.file}.json`);
      expect(m.conventions.facing).toBe('+Z');
      expect(m.skeleton.ends.L_Foot[2]).toBeGreaterThan(m.skeleton.joints.find(j => j.name === 'L_Foot')!.bindWorldPosition[2] + 0.05);
      // the LBS repose reached the shared A-pose bind; no hair vertex follows the arms
      expect(m.poseCorrection.version).toBe('skin-1');
      for (const s of ['L', 'R']) expect(m.poseCorrection.sides[s].armFromVerticalDegAfter).toBeCloseTo(34, 0);
      expect(m.poseCorrection.hair.weldedHairVerticesWithArmWeights).toBe(0);
      expect(m.poseCorrection.chestWallGuard.rowsChanged).toBeGreaterThanOrEqual(0);
      // anatomical landmarks (fractions of the height): crotch from the midline, neck from the hair-aware throat profile
      expect(m.skeleton.estimation.legs.crotchY / p.heightM).toBeGreaterThan(0.38); expect(m.skeleton.estimation.legs.crotchY / p.heightM).toBeLessThan(0.5);
      expect(m.skeleton.estimation.neck.override!.neckBaseY / p.heightM).toBeGreaterThan(0.8); expect(m.skeleton.estimation.neck.override!.neckBaseY / p.heightM).toBeLessThan(0.86);
    }
  });

  it('the six clips sample sanely with the runtime mixer; the build CPU-skinning floor verification is clean', () => {
    for (const p of PALE) {
      const g = models[`zombieBody_${p.id}`];
      expect(g.animations.map(a => a.name).sort()).toEqual(CLIPS);
      const root = g.scene.clone(true), mixer = new THREE.AnimationMixer(root), bone = (n: string) => root.getObjectByName(n)!;
      for (const clip of g.animations) {
        mixer.stopAllAction();
        mixer.clipAction(clip).reset().play();
        for (const f of [0, 0.25, 0.5, 0.75, 0.999]) {
          mixer.setTime(f * clip.duration); root.updateMatrixWorld(true);
          const head = bone('Head').getWorldPosition(new THREE.Vector3()), hips = bone('Hips').getWorldPosition(new THREE.Vector3());
          expect([head.x, head.y, head.z, hips.y].every(Number.isFinite)).toBe(true);
          if (clip.name !== 'Death') {
            expect(head.y, `${p.id} ${clip.name} upright`).toBeGreaterThan((['Attack', 'Hit'].includes(clip.name) ? 0.6 : 0.75) * p.heightM);
            expect(hips.y, `${p.id} ${clip.name} hips`).toBeGreaterThan(0.38 * p.heightM);
          }
        }
        if (clip.name === 'Death') { mixer.setTime(clip.duration * 0.999); root.updateMatrixWorld(true); expect(bone('Head').getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.45); }
      }
      let worst = Infinity;
      for (const c of Object.values(deriv<BodyJson>(`zombie-body-${p.file}.json`).verification.cpuSkinningFloor)) for (const v of Object.values(c)) if (v && typeof v === 'object' && typeof (v as {minY?: number}).minY === 'number') worst = Math.min(worst, (v as {minY: number}).minY);
      expect(worst, `${p.id} lowest skinned vertex`).toBeGreaterThan(-0.03);
    }
  });

  it('hit volumes: measured radii in human ranges, runtime volumes derived through the kept calibration', () => {
    for (const p of PALE) {
      const hit = (models[`zombieBody_${p.id}`].scene.userData.zombieBody as {hit: Record<string, number>}).hit;
      expect(hit.head).toBeGreaterThan(0.09); expect(hit.head).toBeLessThan(0.17);
      expect(hit.torso).toBeGreaterThanOrEqual(0.1); expect(hit.torso).toBeLessThan(0.3);
      expect(hit.arm).toBeGreaterThanOrEqual(0.05); expect(hit.arm).toBeLessThan(0.12);
      expect(hit.leg).toBeGreaterThan(0.06); expect(hit.leg).toBeLessThan(0.15);
      const app = lib.build({body: p.id, wear: {}});
      const upper = app.meshes.find(m => m.slot === 'upper')!.wearable!, lower = app.meshes.find(m => m.slot === 'lower')!.wearable!;
      const bulk = (w: string) => (lib.variant(w, p.id)!.userData as {bulkM?: Record<string, number>}).bulkM ?? {};
      expect(app.hit.head).toBeCloseTo(hit.head * HIT_CALIBRATION.head, 5);
      expect(app.hit.torso).toBeCloseTo((hit.torso + (bulk(upper).torso ?? 0)) * HIT_CALIBRATION.torso, 5);
      expect(app.hit.leg).toBeCloseTo((hit.leg + (lib.wearable(upper)!.heavy ? 0.01 : 0) + (bulk(lower).leg ?? 0)) * HIT_CALIBRATION.leg, 5);
      expect(app.girth.torso).toBeGreaterThan(0); expect(app.girth.leg).toBeGreaterThan(0);
      // plausible gameplay volumes (no body loses its hit zones to a bad measurement)
      expect(app.hit.torso).toBeGreaterThan(0.13); expect(app.hit.head).toBeGreaterThan(0.1);
      expect(REFERENCE_HIT.torso * HIT_CALIBRATION.torso).toBeCloseTo(0.2, 2);
    }
  });
});

describe('pale bodies: regular clothing fitted through the gate', () => {
  it('>= 2 uppers (>= 1 light) and >= 1 lower per body: exactly the shipped list; every variant passed the gates and indexes this body', () => {
    const limits = wardrobe.fit07.gate.limits;
    for (const p of PALE) {
      expect(lib.bodies.some(b => b.id === p.id), `${p.id} selectable`).toBe(true);
      const fitted = lib.wearables.filter(w => lib.supports(p.id, w.id));
      expect(fitted.map(w => w.id).sort(), p.id).toEqual([...SHIPPED[p.id]].sort());
      const uppers = fitted.filter(w => w.slot === 'upper'), lowers = fitted.filter(w => w.slot === 'lower');
      expect(uppers.length, `${p.id} uppers`).toBeGreaterThanOrEqual(2);
      expect(uppers.some(w => !w.heavy), `${p.id} light upper (shamblers)`).toBe(true);
      expect(lowers.length, `${p.id} lowers`).toBeGreaterThanOrEqual(1);
      const be = models[`zombieBody_${p.id}`].scene.userData.zombieBody as {geometryHash: string; bodyTriangles: number};
      for (const w of fitted) {
        const v = lib.variant(w.id, p.id)!;
        expect(v.name).toBe(outfitNodeName(w.id, p.id));
        const ex = v.userData as {bodyGeometryHash: string; bodyTriangles: number; hideBodyTriangles: string};
        expect(ex.bodyGeometryHash, `${w.id}x${p.id}`).toBe(be.geometryHash);
        expect(atob(ex.hideBodyTriangles).length).toBe(Math.ceil(be.bodyTriangles / 8));
        if (w.slot === 'upper' || w.slot === 'lower') {
          const g = wardrobe.fit07.gate.variants.find(x => x.body === p.id && x.wearable === w.id)!;
          expect(g?.pass, `${w.id}x${p.id} fit07 gate`).toBe(true);
          expect(g.bind).toBeLessThanOrEqual(limits.bind); expect(g.animated).toBeLessThanOrEqual(limits.animated); expect(g.extreme).toBeLessThanOrEqual(limits.extreme);
          const pr = wardrobe.pairs.find(x => x.body === p.id && x.wearable === w.id);
          expect(pr?.motion?.fraction ?? 0, `${w.id}x${p.id} motion stretch`).toBeLessThanOrEqual(wardrobe.quality.maxFractionOver);
        }
      }
      for (const id of NOT_COVERING) {
        expect(lib.supports(p.id, id), `${id} on unclothed ${p.id}`).toBe(false);
        expect(wardrobe.excluded.find(e => e.body === p.id && e.wearable === id)?.reason, `${id}x${p.id} reason`).toMatch(/coverage/);
      }
      // every regular wearable NOT shipped on this body is recorded with its reason (gate, or the compact subset)
      for (const w of ZOMBIE_WEARABLES.filter(x => fileOf(x.model) && !SHIPPED[p.id].includes(x.id))) expect(wardrobe.excluded.some(e => e.body === p.id && e.wearable === w.id), `${w.id}x${p.id} recorded`).toBe(true);
    }
  });

  it('never bare: a bare / half look is invalid, build() completes it, selection always fills both slots', () => {
    for (const p of PALE) {
      const up = lib.wearables.find(w => w.slot === 'upper' && lib.supports(p.id, w.id))!, lo = lib.wearables.find(w => w.slot === 'lower' && lib.supports(p.id, w.id) && lib.compatible(p.id, up, w))!;
      for (const wear of [{}, {upper: up.id}, {lower: lo.id}] as ZombieLook['wear'][]) {
        expect(lib.isValid({body: p.id, wear}), `${p.id} ${JSON.stringify(wear)}`).toBe(false);
        const app = lib.build({body: p.id, wear});
        expect(app.look.body).toBe(p.id);
        expect(app.look.wear.upper, `${p.id} built upper`).toBeDefined(); expect(app.look.wear.lower, `${p.id} built lower`).toBeDefined();
        expect(app.meshes.filter(m => m.slot === 'upper' || m.slot === 'lower').length).toBe(2);
        if (wear.upper) expect(app.look.wear.upper).toBe(wear.upper);
        if (wear.lower) expect(app.look.wear.lower).toBe(wear.lower);
      }
      expect(lib.isValid({body: p.id, wear: {upper: up.id, lower: lo.id}})).toBe(true);
    }
    const avail = lib.available;
    let n = 0, pale = 0;
    const perBody: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) for (let i = 0; i < 16; i++) {
      const l = pickZombieLook(seed * 7919, i, i % 5 < 2 ? 'coated' : 'shambler', avail);
      n++;
      perBody[l.body] = (perBody[l.body] ?? 0) + 1;
      if (!PALE.some(p => p.id === l.body)) continue;
      pale++;
      expect(l.wear.upper, `${l.body} upper (seed ${seed} #${i})`).toBeDefined();
      expect(l.wear.lower, `${l.body} lower (seed ${seed} #${i})`).toBeDefined();
      expect(lib.isValid(l)).toBe(true);
    }
    console.log(`[pale bodies] ordinary-pool share ${(100 * pale / n).toFixed(1)}% of ${n} picks; per body ${JSON.stringify(perBody)}`);
    // additive variety: weight 0.5 each next to six bodies of weight 1 -> 1.5 / 7.5 = 20 %
    expect(pale / n).toBeGreaterThan(0.16); expect(pale / n).toBeLessThan(0.24);
    for (const p of PALE) expect(perBody[p.id] ?? 0, p.id).toBeGreaterThan(n * 0.04);
  });
});
