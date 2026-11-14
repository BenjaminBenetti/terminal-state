// Task studio-corpse-market-shop-20261114-031614-01 (lane ASSET): the corpse buyer's den assets — the floor chute and the barred booth
// (assets/corpseShopKit.generated.ts; tools/asset-pipeline/props/build-corpse-shop-kit.mjs) and the buyer actor (assets/
// corpseBuyer.generated.ts; tools/asset-pipeline/humans/build-corpse-buyer.mjs):
//  - every file on disk at its recorded bytes, allowlisted (tools/release/public-inputs.json path / bytes / sha256), credited, its
//    provenance hash-only (no URL / token / local path) and recording the paid Meshy tasks it came from;
//  - the kit records match the GLBs: real size, grounded, centred, Meshy's three maps kept, the measured rim / counter surfaces;
//  - the buyer parses into the market-human-cast.glb layout (one body 'cb', no wearables, the six healthy clips) and loads through the
//    UNCHANGED market/humanWardrobe.ts HumanWardrobe;
//  - all three are Market-only (assets/levelAssets.ts 'market-*'), never boot models.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {CORPSE_SHOP_KIT} from '../src/assets/corpseShopKit.generated';
import {CORPSE_BUYER_MODEL} from '../src/assets/corpseBuyer.generated';
import {CORPSE_DEN_KINDS, CORPSE_DEN_MODEL_FILES, CORPSE_DEN_MODEL_FOR, CORPSE_DEN_MODEL_OF, CORPSE_DEN_SCALE} from '../src/gen/market/v4/denKinds';
import {PROP_DEFS} from '../src/gen/props';
import {assetAllowedIn, levelOfAsset, selectLevelKeys} from '../src/assets/levelAssets';
import {MODEL_FILES} from '../src/assets/manifest';
import {HUMAN_CLIPS} from '../src/market/humanLooks';
import {HumanWardrobe} from '../src/market/humanWardrobe';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(GAME, 'public');
const REPO = path.resolve(GAME, '..');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const KIT_PROV = 'assets/derivatives/corpse-shop-kit-20261114.json';
const BUYER_PROV = 'assets/derivatives/market-corpse-buyer.json';
const MESHY = {chute: '01a1d826-0dcd-7428-8cc9-24b345c650fd', booth: '01a1d826-3014-7351-9515-7449b2050d0e', buyer: '01a1d825-e930-767a-ad6b-11cc65a6f728'};
const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const allow = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
const UNSAFE = /https?:|token=|Signature=|X-Amz|Key-Pair-Id|api[_-]?key=|Bearer |\/workspaces\/|\/home\//i;

/** Every triangle of a static GLB (node transforms applied), flat xyz x 3 per triangle. */
async function trianglesOf(url: string): Promise<{T: Float32Array; tris: number; doc: Awaited<ReturnType<NodeIO['read']>>}> {
  const doc = await io.read(path.join(PUB, url));
  const out: number[] = [];
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    const M = n.getWorldMatrix();
    for (const p of m.listPrimitives()) {
      const P = p.getAttribute('POSITION')!.getArray()!, I = p.getIndices()!.getArray()!;
      for (let k = 0; k < I.length; k++) { const i = I[k] * 3; out.push(M[0] * P[i] + M[4] * P[i + 1] + M[8] * P[i + 2] + M[12], M[1] * P[i] + M[5] * P[i + 1] + M[9] * P[i + 2] + M[13], M[2] * P[i] + M[6] * P[i + 1] + M[10] * P[i + 2] + M[14]); }
    }
  }
  return {T: Float32Array.from(out), tris: out.length / 9, doc};
}

/** Area (m2) of the up-facing horizontal triangles (normal y > 0.9) whose centroid passes `keep`. */
function upArea(T: Float32Array, keep: (x: number, y: number, z: number) => boolean): number {
  let a = 0;
  for (let t = 0; t < T.length; t += 9) {
    const ax = T[t + 3] - T[t], ay = T[t + 4] - T[t + 1], az = T[t + 5] - T[t + 2], bx = T[t + 6] - T[t], by = T[t + 7] - T[t + 1], bz = T[t + 8] - T[t + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz);
    if (!l || ny / l < 0.9) continue;
    if (keep((T[t] + T[t + 3] + T[t + 6]) / 3, (T[t + 1] + T[t + 4] + T[t + 7]) / 3, (T[t + 2] + T[t + 5] + T[t + 8]) / 3)) a += l / 2;
  }
  return a;
}

describe('corpse shop kit: the chute and the booth', () => {
  it('files on disk at the recorded bytes, allowlisted, Market-only, never boot models', () => {
    for (const m of Object.values(CORPSE_SHOP_KIT)) {
      const b = fs.readFileSync(path.join(PUB, m.url));
      expect(b.length, m.url).toBe(m.bytes);
      expect(allow.files.find(f => f.path === m.url), m.url).toEqual({path: m.url, bytes: b.length, sha256: sha(b)});
      expect(m.key).toMatch(/^market-corpse-/);
      expect(levelOfAsset(m.url)).toBe('market');
      expect(assetAllowedIn('market', m.url)).toBe(true);
      for (const lv of ['subway', 'office', 'mall', 'reactor', 'skyways', 'bunker']) expect(assetAllowedIn(lv, m.url), `${m.url} @ ${lv}`).toBe(false);
      expect(Object.values(MODEL_FILES).some(f => f.url === m.url)).toBe(false);
      expect(CORPSE_DEN_MODEL_FILES[m.key]).toEqual({url: m.url, bytes: m.bytes});
    }
  });

  it('the den kinds use the cooked models at their real size (PropDef box = model dims; MODEL_FOR = the lazy key)', () => {
    for (const k of CORPSE_DEN_KINDS) {
      const m = CORPSE_DEN_MODEL_OF[k], d = PROP_DEFS[k];
      expect(d.w).toBeCloseTo(m.dims[0], 3); expect(d.h).toBeCloseTo(m.dims[1], 3); expect(d.d).toBeCloseTo(m.dims[2], 3);
      expect(CORPSE_DEN_MODEL_FOR[k]).toBe(m.key);
    }
    expect(CORPSE_DEN_SCALE).toContain(`rim ${CORPSE_SHOP_KIT.chute.rimY} m`);
    expect(CORPSE_DEN_SCALE).toContain(`counter top ${CORPSE_SHOP_KIT.booth.counterY} m`);
  });

  it('records match the GLBs: real size, grounded, centred, Meshy\'s three maps kept, triangle counts', async () => {
    for (const m of Object.values(CORPSE_SHOP_KIT)) {
      const {doc, tris} = await trianglesOf(m.url);
      const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
      const dims = [0, 1, 2].map(i => b.max[i] - b.min[i]);
      for (let i = 0; i < 3; i++) expect(dims[i], `${m.url} dim ${i}`).toBeCloseTo(m.dims[i], 3);
      expect(Math.abs(b.min[1]), `${m.url} grounded`).toBeLessThan(1e-3);
      expect(Math.abs(b.min[0] + b.max[0]), `${m.url} centred x`).toBeLessThan(6e-3);
      expect(Math.abs(b.min[2] + b.max[2]), `${m.url} centred z`).toBeLessThan(6e-3);
      expect(tris).toBe(m.tris);
      const mats = doc.getRoot().listMaterials();
      expect(mats.length).toBe(1);
      expect(mats[0].getBaseColorTexture()?.getMimeType()).toBe('image/jpeg');
      expect(mats[0].getMetallicRoughnessTexture()).toBeTruthy();
      expect(mats[0].getNormalTexture()).toBeTruthy();
    }
  });

  it('the chute: ~1 m across, its rim knee high (the highest point of the front half), the open lid behind it', async () => {
    const c = CORPSE_SHOP_KIT.chute;
    expect(c.dims[0]).toBeCloseTo(1.0, 2);
    expect(c.rimY).toBeGreaterThanOrEqual(0.5); expect(c.rimY).toBeLessThanOrEqual(0.6);
    expect(c.dims[1]).toBeGreaterThan(c.rimY + 0.4); // the upright lid
    const {T} = await trianglesOf(c.url);
    let front = -Infinity, back = -Infinity;
    for (let i = 0; i < T.length; i += 3) { if (T[i + 2] > 0) front = Math.max(front, T[i + 1]); else back = Math.max(back, T[i + 1]); }
    expect(front).toBeCloseTo(c.rimY, 3);
    expect(back).toBeCloseTo(c.dims[1], 3);
  });

  it('the booth: a counter top at counter height in front of the bars, within the den\'s 2.3 x 0.5 m slot', async () => {
    const b = CORPSE_SHOP_KIT.booth;
    expect(b.dims[0]).toBeLessThanOrEqual(2.3 + 1e-6); expect(b.dims[2]).toBeLessThanOrEqual(0.5);
    expect(b.dims[1]).toBeGreaterThan(2.2); expect(b.dims[1]).toBeLessThan(2.6);
    expect(b.counterY).toBeGreaterThanOrEqual(0.89); expect(b.counterY).toBeLessThanOrEqual(1.0);
    expect(b.counterZ).toBeGreaterThan(0.05); expect(b.counterZ).toBeLessThanOrEqual(b.dims[2] / 2 + 1e-3);
    const {T} = await trianglesOf(b.url);
    // a broad up-facing surface on the customer side (z > 0) within a few cm of counterY, the full width of the counter
    expect(upArea(T, (x, y, z) => z > 0 && Math.abs(y - b.counterY) < 0.03)).toBeGreaterThan(0.2);
    // the barred screen: no broad horizontal surface between the counter and the header (the bars leave open gaps)
    expect(upArea(T, (x, y) => y > b.counterY + 0.3 && y < 1.8 && Math.abs(x) < 0.9)).toBeLessThan(0.1);
  });

  it('provenance: hash-only, allowlisted, records the paid Meshy tasks / reservations / Codex inputs and the kept maps', () => {
    const buf = fs.readFileSync(path.join(PUB, KIT_PROV));
    expect(allow.files.find(f => f.path === KIT_PROV)).toEqual({path: KIT_PROV, bytes: buf.length, sha256: sha(buf)});
    const text = buf.toString('utf8');
    expect(text).not.toMatch(UNSAFE);
    const rec = JSON.parse(text) as {task: string; models: {key: string; url: string; sha256: string; bytes: number; generation: {meshyTask: string; reservation: string; creditsBilled: number; codexInput: {sha256: string}; master: {sha256: string}}}[]};
    expect(rec.task).toBe('studio-corpse-market-shop-20261114-031614-01');
    for (const [k, task, res] of [['chute', MESHY.chute, 'R002'], ['booth', MESHY.booth, 'R003']] as const) {
      const m = CORPSE_SHOP_KIT[k], r = rec.models.find(x => x.url === m.url)!;
      expect(r.key).toBe(m.key);
      expect(r.sha256).toBe(sha(fs.readFileSync(path.join(PUB, m.url))));
      expect(r.generation.meshyTask).toBe(task);
      expect(r.generation.reservation).toBe(res);
      expect(r.generation.creditsBilled).toBe(15);
      expect(r.generation.codexInput.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.generation.master.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

async function loadStripped(rel: string): Promise<GLTF> {
  const doc = await io.read(path.join(PUB, rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

describe('the corpse buyer actor (market-human-cast layout, one body)', () => {
  let gltf: GLTF;
  beforeAll(async () => { gltf = await loadStripped(CORPSE_BUYER_MODEL.url); });

  it('file on disk at the recorded bytes, allowlisted with its provenance, Market-only, credited', () => {
    const glb = fs.readFileSync(path.join(PUB, CORPSE_BUYER_MODEL.url));
    expect(glb.length).toBe(CORPSE_BUYER_MODEL.bytes);
    expect(allow.files.find(f => f.path === CORPSE_BUYER_MODEL.url)).toEqual({path: CORPSE_BUYER_MODEL.url, bytes: glb.length, sha256: sha(glb)});
    const prov = fs.readFileSync(path.join(PUB, BUYER_PROV));
    expect(allow.files.find(f => f.path === BUYER_PROV)).toEqual({path: BUYER_PROV, bytes: prov.length, sha256: sha(prov)});
    expect(prov.toString('utf8')).not.toMatch(UNSAFE);
    const man = JSON.parse(prov.toString('utf8'));
    expect(man.outputs.glb).toMatchObject({path: CORPSE_BUYER_MODEL.url, bytes: glb.length, sha256: sha(glb)});
    expect(man.generation).toMatchObject({meshyTask: MESHY.buyer, reservation: 'R001', creditsBilled: 15});
    expect(man.status.approved).toBe(false);
    expect(levelOfAsset(CORPSE_BUYER_MODEL.url)).toBe('market');
    const files = {[CORPSE_BUYER_MODEL.key]: {url: CORPSE_BUYER_MODEL.url, bytes: CORPSE_BUYER_MODEL.bytes}};
    expect(selectLevelKeys('market', [CORPSE_BUYER_MODEL.key], files).foreign).toEqual([]);
    for (const lv of ['subway', 'office', 'mall', 'reactor', 'skyways', 'bunker']) {
      expect(assetAllowedIn(lv, CORPSE_BUYER_MODEL.url)).toBe(false);
      expect(selectLevelKeys(lv, [CORPSE_BUYER_MODEL.key], files).foreign).toEqual([CORPSE_BUYER_MODEL.key]);
    }
    expect(Object.values(MODEL_FILES).some(f => f.url === CORPSE_BUYER_MODEL.url)).toBe(false);
    const credits = fs.readFileSync(path.join(PUB, 'assets/CREDITS.md'), 'utf8');
    const sec = credits.slice(credits.indexOf('<!-- BEGIN corpse-shop-20261114'), credits.indexOf('<!-- END corpse-shop-20261114 -->'));
    for (const u of [CORPSE_BUYER_MODEL.url, CORPSE_SHOP_KIT.chute.url, CORPSE_SHOP_KIT.booth.url]) expect(sec).toContain(u);
    for (const t of Object.values(MESHY)) expect(sec).toContain(t);
    const cr = fs.readFileSync(path.join(PUB, 'assets/CREDITS.md'));
    expect(allow.files.find(f => f.path === 'assets/CREDITS.md')).toEqual({path: 'assets/CREDITS.md', bytes: cr.length, sha256: sha(cr)});
  });

  it('parses into the cast layout: one body cb, no wearables, the 18-joint skin, the six healthy clips', async () => {
    const cast = gltf.scene.userData.marketHumans as {bodies: {id: string; wear: string[]}[]; wearables: unknown[]; clips: string[]};
    expect(cast.bodies.map(b => ({id: b.id, wear: b.wear}))).toEqual([{id: 'cb', wear: []}]);
    expect(cast.wearables).toEqual([]);
    expect([...cast.clips].sort()).toEqual([...HUMAN_CLIPS].sort());
    expect(gltf.scene.getObjectByName('Human_cb')).toBeTruthy();
    const body = gltf.scene.getObjectByName('HumanBody_cb') as THREE.SkinnedMesh;
    expect(body.isSkinnedMesh).toBe(true);
    expect(body.skeleton.bones.map(b => b.name)).toEqual(JOINTS.map(j => `cb_${j}`));
    expect(body.userData.geometryHash).toMatch(/^[0-9a-f]+$/);
    expect(body.userData.heightM).toBeCloseTo(CORPSE_BUYER_MODEL.heightM, 3);
    expect(body.userData.clips.Walk.groundSpeed).toBeGreaterThan(1.1);
    expect(body.userData.clips.Walk.groundSpeed).toBeLessThan(1.5);
    expect(gltf.animations.map(a => a.name).sort()).toEqual(HUMAN_CLIPS.map(c => `cb:${c}`).sort());
    // Meshy's maps kept on the body (re-encoded): base colour 2048, metal-rough, normal
    const doc = await io.read(path.join(PUB, CORPSE_BUYER_MODEL.url));
    const mat = doc.getRoot().listMaterials().find(m => m.getName() === 'HumanBody_cb_Material')!;
    expect(mat.getBaseColorTexture()?.getSize()).toEqual([2048, 2048]);
    expect(mat.getMetallicRoughnessTexture()).toBeTruthy();
    expect(mat.getNormalTexture()).toBeTruthy();
    expect(doc.getRoot().listNodes().filter(n => n.getName().startsWith('Wear_'))).toEqual([]);
  });

  it('loads through the unchanged HumanWardrobe: build({body: cb}) gives the clothed body, its clips and a grounded 1.85 m stance', () => {
    const W = new HumanWardrobe(gltf);
    expect(W.bodies).toEqual(['cb']);
    expect(W.available.wear('cb')).toEqual([]);
    const app = W.build({body: 'cb', wear: {}, scale: 1});
    expect(app.look.body).toBe('cb');
    expect(app.meshes.length).toBe(1);
    expect(app.clips.size).toBe(HUMAN_CLIPS.length);
    expect(app.heightM).toBeCloseTo(1.85, 2);
    expect(app.walkSpeed).toBeGreaterThan(1.1);
    expect(app.prefix).toBe('cb_');
    // bind pose: the head joint high, the feet joints near the floor; Idle keeps the head upright and the hands below the chest
    app.root.updateMatrixWorld(true);
    const at = (j: string) => app.root.getObjectByName(`cb_${j}`)!.getWorldPosition(new THREE.Vector3());
    expect(at('Head').y).toBeGreaterThan(1.5);
    expect(at('L_Foot').y).toBeLessThan(0.15);
    const head0 = at('Head').y;
    const mixer = new THREE.AnimationMixer(app.root), act = mixer.clipAction(app.clips.get('Idle')!).play();
    for (let i = 0; i < 8; i++) {
      act.time = (i / 8) * app.clips.get('Idle')!.duration; mixer.update(0); app.root.updateMatrixWorld(true);
      expect(at('Head').y).toBeGreaterThan(head0 - 0.1);
      for (const h of ['L_Hand', 'R_Hand']) expect(at(h).y).toBeLessThan(at('Chest').y - 0.15);
    }
    mixer.stopAllAction();
    W.dispose();
  });

  it('the provenance records a grounded body in every clip and the motion-quality gate', () => {
    const man = JSON.parse(fs.readFileSync(path.join(PUB, BUYER_PROV), 'utf8'));
    for (const c of HUMAN_CLIPS) expect(Math.abs(man.verification.floorLowestSkinnedVertexM[c]), c).toBeLessThan(0.03);
    expect(man.verification.motionStretch.fractionOver).toBeLessThan(0.05);
    expect(man.honesty.sourceHadSkeleton).toBe(false);
  });
});

describe('scale-check resolves the den kinds at their runtime fit', () => {
  it('--kind corpseChute / corpseBooth -> the cooked model through MODEL_FOR', async () => {
    const tool = await import(pathToFileURL(path.join(REPO, 'tools/asset-pipeline/props/scale-check.mjs')).href) as {resolveKind(k: string): Promise<{file: string | null; path: string; fit?: {type: string}}>};
    for (const k of CORPSE_DEN_KINDS) {
      const r = await tool.resolveKind(k);
      expect(r.file && path.relative(PUB, r.file)).toBe(CORPSE_DEN_MODEL_OF[k].url);
      expect(r.path).toMatch(/MODEL_FOR/);
      expect(r.fit?.type).toBe('box');
    }
  }, 60_000);
});
