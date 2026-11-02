// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): the lingerie store variants on the SHIPPED GLBs (CI-safe: no private
// raw sources needed). The six lingerie sets (outfit-lingerie-<design>.glb, tools/asset-pipeline/zombie/build-lingerie.mjs) fitted
// to the three pale female zombie bodies:
//  - registry: every design used, two per body, fitted only to the lingerie bodies, lazily loaded (not boot MODEL_FILES), exact
//    bytes, never part of the ordinary wardrobe registry / pool;
//  - files: OPAQUE materials (JPEG base colour, no alpha / blend / transmission), skinned variant nodes per fitted body with the
//    wardrobe extras + geometry-hash guard matching the body GLB, static display nodes sharing the material;
//  - wardrobe integration (three.js GLTFLoader + the real WardrobeLibrary): every fit builds with BOTH a top and a bottom, body
//    triangles under the cloth hidden; the ordinary library + pickZombieLook never yield a lingerie wearable;
//  - lingerieLook: deterministic by (seed, spawn index), only shipped fits, both slots, consecutive spawns vary;
//  - fit metrics through ALL six clips (CPU skinning of the shipped body + set, lib/lingerie-metrics.mjs): per-clip penetration,
//    hover, gap, visible body poke-through, exposed hidden triangles and chest / groin coverage within the limits.
import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {LINGERIE_SETS, LINGERIE_MODEL_FILES, LINGERIE_WEARABLES, LINGERIE_FITS, LINGERIE_BODY_IDS, LINGERIE_DISPLAYS, createLingerieLibrary, lingerieLook, isLingerieWearable} from '../src/ai/lingerie';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES, ZombieLookLibrary, pickZombieLook} from '../src/ai/outfits';
import {MODEL_FILES} from '../src/assets/manifest';
import type {ZombieType} from '../src/gen/stationTypes';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUB = path.join(ROOT, 'game/public');
const lib = async (f: string) => import(pathToFileURL(path.join(ROOT, 'tools/asset-pipeline/zombie/lib', f)).href);
const DESIGNS = ['green', 'purple', 'blush', 'black', 'red', 'ivory'];
const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);
const bodyDef = (id: string) => ZOMBIE_BODIES.find(b => b.id === id);
const bodyUrl = (id: string) => (MODEL_FILES as Record<string, {url: string} | undefined>)[bodyDef(id)?.model ?? `zombieBody_${id}`]?.url;

async function loadStripped(file: string): Promise<GLTF> {
  const doc = await io().read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io().writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const models: Record<string, GLTF> = {};
beforeAll(async () => {
  for (const id of LINGERIE_BODY_IDS) { const u = bodyUrl(id); if (u) models[bodyDef(id)?.model ?? `zombieBody_${id}`] = await loadStripped(path.join(PUB, u)); }
  for (const s of LINGERIE_SETS) models[s.model] = await loadStripped(path.join(PUB, s.url));
}, 120_000);

describe('lingerie registry', () => {
  it('ships all six designs, each fitted to a pale body, two per body', () => {
    expect(LINGERIE_SETS.map(s => s.design).sort()).toEqual([...DESIGNS].sort());
    expect(LINGERIE_SETS.map(s => s.id)).toEqual(LINGERIE_SETS.map(s => `lingerie-${s.design}`));
    for (const s of LINGERIE_SETS) {
      expect(s.bodies.length, s.id).toBeGreaterThanOrEqual(1);
      for (const b of s.bodies) expect(LINGERIE_BODY_IDS as readonly string[]).toContain(b);
    }
    for (const b of LINGERIE_BODY_IDS) expect(LINGERIE_FITS.filter(f => f.body === b).length, b).toBeGreaterThanOrEqual(2);
  });

  it('is lazily loaded with exact bytes and never part of the ordinary wardrobe', () => {
    for (const [key, f] of Object.entries(LINGERIE_MODEL_FILES)) {
      expect(key).toMatch(/^outfit_lingerie_[a-z]+$/);
      expect(statSync(path.join(PUB, f.url)).size, f.url).toBe(f.bytes);
      expect((MODEL_FILES as Record<string, unknown>)[key], key).toBeUndefined();
    }
    for (const w of ZOMBIE_WEARABLES) expect(isLingerieWearable(w.id), w.id).toBe(false);
    expect(LINGERIE_WEARABLES.every(w => w.weight === 0)).toBe(true);
    expect(LINGERIE_WEARABLES.length).toBe(LINGERIE_SETS.length * 2);
    for (const s of LINGERIE_SETS) {
      expect(LINGERIE_WEARABLES.find(w => w.id === s.pieces.upper)?.slot).toBe('upper');
      expect(LINGERIE_WEARABLES.find(w => w.id === s.pieces.lower)?.slot).toBe('lower');
    }
  });

  it('records the per-clip fit metrics and provenance of every set (unapproved prototype)', () => {
    const S = JSON.parse(readFileSync(path.join(PUB, 'assets/derivatives/zombie-lingerie.json'), 'utf8'));
    expect(S.status).toMatchObject({approved: false, gameReady: false});
    expect(S.gate.failures).toEqual([]);
    for (const s of LINGERIE_SETS) {
      const j = JSON.parse(readFileSync(path.join(PUB, `assets/derivatives/outfit-lingerie-${s.design}.json`), 'utf8'));
      expect(j.source.raw.sha256Verified).toMatch(/^[0-9a-f]{64}$/);
      expect(j.outputs.glb.bytes).toBe(s.bytes);
      for (const b of s.bodies) expect(Object.keys(j.perBody[b].metrics.perClip).sort()).toEqual([...CLIPS].sort());
    }
  });
});

describe('lingerie GLBs', () => {
  it('use opaque materials only (JPEG base colour, no alpha / blend / transmission) and keep the Meshy metallic-roughness map', async () => {
    for (const s of LINGERIE_SETS) {
      const doc = await io().read(path.join(PUB, s.url));
      const mats = doc.getRoot().listMaterials();
      expect(mats.length, s.id).toBe(1);
      for (const m of mats) {
        expect(m.getAlphaMode()).toBe('OPAQUE');
        expect(m.getBaseColorFactor()[3]).toBe(1);
        expect(m.getBaseColorTexture()?.getMimeType()).toBe('image/jpeg');
        expect(m.getMetallicRoughnessTexture()?.getMimeType()).toBe('image/jpeg');
        expect(m.listExtensions().map(e => e.extensionName)).toEqual([]);
      }
      expect(doc.getRoot().listExtensionsUsed().map(e => e.extensionName)).toEqual(['KHR_mesh_quantization']);
    }
  });

  it('hold one skinned top + bottom per fitted body, guarded by the body geometry hash, plus static display nodes', () => {
    for (const s of LINGERIE_SETS) {
      const g = models[s.model];
      for (const b of s.bodies) {
        const body = models[bodyDef(b)?.model ?? `zombieBody_${b}`];
        expect(body, `${b} body model`).toBeTruthy();
        const be = body.scene.userData.zombieBody as {geometryHash: string; bodyTriangles: number};
        for (const [slot, w] of [['upper', s.pieces.upper], ['lower', s.pieces.lower]]) {
          const m = g.scene.getObjectByName(`Outfit_${w}__${b}`) as THREE.SkinnedMesh;
          expect(m?.isSkinnedMesh, `${w} x ${b}`).toBe(true);
          const ex = m.userData as {slot: string; body: string; bodyGeometryHash: string; bodyTriangles: number; hideBodyTriangles: string};
          expect(ex.slot).toBe(slot);
          expect(ex.body).toBe(b);
          expect(ex.bodyGeometryHash).toBe(be.geometryHash);
          expect(ex.bodyTriangles).toBe(be.bodyTriangles);
          expect(atob(ex.hideBodyTriangles).length).toBe(Math.ceil(be.bodyTriangles / 8));
          expect(m.skeleton.bones.length).toBe(18);
        }
      }
      const d = LINGERIE_DISPLAYS.find(x => x.set === s.id)!;
      const box = new THREE.Box3();
      g.scene.updateMatrixWorld(true);
      for (const n of [d.nodes.top, d.nodes.bottom]) {
        const m = g.scene.getObjectByName(n) as THREE.Mesh;
        expect(m?.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh, n).toBe(true);
        box.expandByObject(m);
      }
      expect(box.min.y).toBeCloseTo(0, 3);
      expect(Math.abs((box.min.x + box.max.x) / 2)).toBeLessThan(0.002);
      expect(box.max.y - box.min.y).toBeGreaterThan(0.3);
      expect(box.max.y - box.min.y).toBeLessThan(1.0);
    }
  });
});

describe('lingerie wardrobe integration', () => {
  it('builds every fit with both a top and a bottom on the pale body, hiding covered body triangles', () => {
    const L = createLingerieLibrary(models);
    expect(L.bodies.map(b => b.id).sort()).toEqual([...LINGERIE_BODY_IDS].sort());
    for (const f of LINGERIE_FITS) {
      const s = LINGERIE_SETS.find(x => x.id === f.set)!;
      const look = {body: f.body, wear: {upper: s.pieces.upper, lower: s.pieces.lower}};
      expect(L.isValid(look), `${f.set} x ${f.body}`).toBe(true);
      const app = L.build(look);
      expect(app.look).toEqual(look);
      expect(app.meshes.map(m => m.slot).sort()).toEqual(['body', 'lower', 'upper']);
      const body = app.meshes.find(m => m.slot === 'body')!.mesh, full = (models[bodyDef(f.body)?.model ?? `zombieBody_${f.body}`].scene.getObjectByName('ZombieBody') as THREE.Mesh).geometry.index!.count;
      expect(body.geometry.index!.count).toBeLessThan(full);
      for (const m of app.meshes) expect(m.mesh.skeleton).toBe(body.skeleton);
      // a lingerie top alone / bottom alone is never valid on these bodies (required both slots)
      expect(L.isValid({body: f.body, wear: {upper: s.pieces.upper}})).toBe(false);
      expect(L.isValid({body: f.body, wear: {lower: s.pieces.lower}})).toBe(false);
    }
  });

  it('never leaks into the ordinary pool: pickZombieLook on the ordinary library picks no lingerie', () => {
    const ord = new ZombieLookLibrary({...models});
    for (const w of ord.wearables) expect(isLingerieWearable(w.id), w.id).toBe(false);
    const types: ZombieType[] = ['shambler', 'coated'];
    for (let i = 0; i < 1500; i++) for (const t of types) {
      const l = pickZombieLook(1234 + (i % 7), i, t, ord.available);
      for (const id of Object.values(l.wear)) expect(isLingerieWearable(id), `${i} ${t} ${id}`).toBe(false);
    }
  });
});

describe('lingerieLook', () => {
  it('is deterministic by (seed, spawn index), uses only shipped fits and always both slots', () => {
    const fits = new Set(LINGERIE_FITS.map(f => `${f.set}@${f.body}`));
    for (const seed of [1, 42, 987654321, 0xdeadbeef]) for (let i = 0; i < 40; i++) {
      const a = lingerieLook(seed, i), b = lingerieLook(seed, i);
      expect(a).toEqual(b);
      expect(fits.has(`${a.set}@${a.body}`), `${seed}/${i}`).toBe(true);
      const s = LINGERIE_SETS.find(x => x.id === a.set)!;
      expect(a.wear).toEqual({upper: s.pieces.upper, lower: s.pieces.lower});
    }
  });

  it('varies over consecutive spawns (a store shows different sets) and honours the usable filter', () => {
    const seen = new Set<string>();
    for (let i = 0; i < LINGERIE_FITS.length; i++) seen.add(lingerieLook(777, i).set);
    expect(seen.size).toBe(new Set(LINGERIE_FITS.map(f => f.set)).size);
    const only = LINGERIE_FITS[0];
    for (let i = 0; i < 10; i++) expect(lingerieLook(5, i, l => l.set === only.set && l.body === only.body)).toMatchObject({set: only.set, body: only.body});
    const bodies = new Set<string>();
    for (let i = 0; i < 200; i++) bodies.add(lingerieLook(i, i).body);
    expect([...bodies].sort()).toEqual([...LINGERIE_BODY_IDS].sort());
  });
});

describe('lingerie fit through all six clips (shipped GLBs)', () => {
  it('stays within the penetration / gap / poke / coverage limits in every sampled frame of every clip', async () => {
    const {loadBody, validationPoses} = await lib('lingerie-body.mjs');
    const {measureSet, checkLimits, loadShippedFit} = await lib('lingerie-metrics.mjs');
    const report: string[] = [];
    for (const b of LINGERIE_BODY_IDS) {
      const u = bodyUrl(b);
      expect(u && existsSync(path.join(PUB, u)), `${b} body file`).toBeTruthy();
      const B = await loadBody(path.join(PUB, u!));
      const poses = validationPoses(B, {step: 0.2});
      expect([...new Set(poses.map((p: {clip: string}) => p.clip))].sort()).toEqual([...CLIPS].sort());
      for (const s of LINGERIE_SETS.filter(x => x.bodies.includes(b))) {
        const pieces = await loadShippedFit(path.join(PUB, s.url), b, B.names);
        expect(pieces.map((p: {name: string}) => p.name)).toEqual(['top', 'bottom']);
        const M = measureSet(B, pieces, {poses});
        const fails = checkLimits(M.summary);
        report.push(...fails.map((f: string) => `${s.id} x ${b}: ${f}`));
        for (const c of CLIPS) expect(M.summary[c], `${s.id} x ${b} ${c}`).toBeTruthy();
      }
    }
    expect(report).toEqual([]);
  }, 240_000);
});
