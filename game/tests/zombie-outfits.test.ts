// Lane W (iteration 06; rewritten from Lane Z iteration 05): slot-based zombie wardrobe on the REAL
// runtime GLBs (zombie-body-*.glb, outfit-*.glb) loaded with their JPEG textures stripped (no DOM
// image decoding in node). Checks the registry data, every fitted body x wearable pair, multi-slot
// combinations with layered masks, exact look counts (>= 48 once lower/head/face wearables ship),
// deterministic seeded selection rules, ragdolls per body and derivative provenance.

import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {ZOMBIE_BODIES, ZOMBIE_WEARABLES, ZombieLookLibrary, pickZombieLook, outfitNodeName, lookKey, SLOTS, type WardrobeSlot, type ZombieLook, type WearableDef} from '../src/ai/outfits';
import {ZombieActor} from '../src/ai/zombieActor';
import {PhysicsSystem} from '../src/physics/world';
import {Grid, FLOOR, SOLID} from '../src/gen/grid';
import {MODEL_FILES} from '../src/assets/manifest';

const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const fileOf = (model: string) => (MODEL_FILES as Record<string, {url: string} | undefined>)[model]?.url;
const abs = (url: string) => fileURLToPath(new URL('../public/' + url, import.meta.url));

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]); // iteration 06: NORMAL is quantized (KHR_mesh_quantization)
  const doc = await io.read(abs(url));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const popcount = (b64: string | undefined) => { if (!b64) return 0; let n = 0; for (const c of atob(b64)) { let v = c.charCodeAt(0); while (v) { n += v & 1; v >>= 1; } } return n; };
const unionCount = (list: (string | undefined)[], nTris: number) => {
  const bits = list.filter((s): s is string => !!s).map(s => Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  let n = 0;
  for (let t = 0; t < nTris; t++) if (bits.some(b => b[t >> 3] & (1 << (t & 7)))) n++;
  return n;
};

const models: Record<string, GLTF> = {};
let lib: ZombieLookLibrary;
const manifestBodies = ZOMBIE_BODIES.filter(b => fileOf(b.model));
const manifestWear = ZOMBIE_WEARABLES.filter(w => fileOf(w.model));
const hasNewSlots = manifestWear.some(w => w.slot !== 'upper');

beforeAll(async () => {
  for (const d of [...manifestBodies, ...manifestWear]) models[d.model] = await loadStripped(fileOf(d.model)!);
  lib = new ZombieLookLibrary(models);
}, 180000);

const variantExtras = (w: string, b: string) => {
  const def = ZOMBIE_WEARABLES.find(x => x.id === w)!;
  return models[def.model].scene.getObjectByName(outfitNodeName(w, b))!.userData as {slot?: WardrobeSlot; hiddenCount?: number; hideBodyTriangles?: string; hideWear?: Record<string, string>};
};
const fullTris = (b: string) => (models[ZOMBIE_BODIES.find(x => x.id === b)!.model].scene.getObjectByName('ZombieBody') as THREE.Mesh).geometry.index!.count / 3;
const wearTris = (w: string, b: string) => (models[ZOMBIE_WEARABLES.find(x => x.id === w)!.model].scene.getObjectByName(outfitNodeName(w, b)) as THREE.Mesh).geometry.index!.count / 3;

/** Shared structural checks for one built look; returns the body mesh. */
function checkBuilt(look: ZombieLook) {
  const app = lib.build(look);
  expect(app.look, lookKey(look)).toEqual(look);
  expect(app.animations.map(a => a.name).sort()).toEqual([...CLIPS].sort());
  const meshes: THREE.SkinnedMesh[] = [];
  app.root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const worn = Object.values(look.wear).filter(Boolean);
  expect(meshes.length).toBe(1 + worn.length);
  expect(app.meshes.length).toBe(1 + worn.length);
  const body = meshes.find(m => m.name === 'ZombieBody')!;
  expect(body.userData.slot).toBe('body');
  expect(body.skeleton.bones.map(b => b.name)).toEqual(JOINTS);
  for (const m of meshes) {
    // every wearable is bound to the SAME bone objects as the body (one skeleton drives all)
    expect(m.skeleton.bones.every((b, i) => b === body.skeleton.bones[i])).toBe(true);
    const g = m.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    expect(si.count).toBe(g.getAttribute('position').count);
    for (let i = 0; i < si.count; i += 7) {
      let s = 0;
      for (let k = 0; k < 4; k++) { expect(si.getComponent(i, k)).toBeLessThan(18); s += sw.getComponent(i, k); }
      expect(Math.abs(s - 1)).toBeLessThan(0.01);
    }
    const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);
    expect(box.min.y).toBeGreaterThan(-0.02);
    expect(box.max.y).toBeLessThan(2.1);
  }
  for (const {mesh, slot, wearable} of app.meshes) {
    expect(mesh.userData.slot).toBe(slot);
    if (slot !== 'body') expect(look.wear[slot]).toBe(wearable);
  }
  // body faces hidden = union of every worn wearable's mask
  const ids = Object.values(look.wear) as string[];
  expect(body.geometry.index!.count / 3).toBe(fullTris(look.body) - unionCount(ids.map(w => variantExtras(w, look.body).hideBodyTriangles), fullTris(look.body)));
  // each wearable: hidden where another worn wearable layers over it (hideWear)
  for (const {mesh, wearable} of app.meshes) {
    if (!wearable) continue;
    const over = ids.filter(o => o !== wearable).map(o => variantExtras(o, look.body).hideWear?.[wearable]);
    expect(mesh.geometry.index!.count / 3).toBe(wearTris(wearable, look.body) - unionCount(over, wearTris(wearable, look.body)));
  }
  return {app, body};
}

describe('zombie wardrobe registry (real GLBs)', () => {
  it('registry data is consistent (ids, slots, rules, covers/requires)', () => {
    const ids = [...ZOMBIE_BODIES.map(b => b.id), ...ZOMBIE_WEARABLES.map(w => w.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const tags = new Set([...ZOMBIE_BODIES, ...ZOMBIE_WEARABLES].flatMap(d => d.tags ?? []));
    for (const w of ZOMBIE_WEARABLES) {
      expect(SLOTS).toContain(w.slot);
      expect(w.weight).toBeGreaterThanOrEqual(0);
      if (w.heavy) expect(w.slot).toBe('upper');
      expect(['generated', 'reused', 'derived']).toContain(w.origin);
      for (const r of w.incompatibleWith ?? []) expect(r.startsWith('tag:') ? tags.has(r.slice(4)) : ids.includes(r), `${w.id}: ${r}`).toBe(true);
    }
    for (const b of ZOMBIE_BODIES) {
      for (const s of [...(b.covers ?? []), ...(b.requires ?? [])]) expect(SLOTS).toContain(s);
      expect((b.covers ?? []).some(s => b.requires?.includes(s))).toBe(false);
    }
    expect(ZOMBIE_BODIES.find(b => b.id === 'scavenger')?.covers).toEqual(expect.arrayContaining(['head', 'face']));
  });

  it('every manifest body/wearable is a real file and available (no silent drops)', () => {
    for (const d of [...manifestBodies, ...manifestWear]) expect(existsSync(abs(fileOf(d.model)!))).toBe(true);
    const satisfiable = manifestBodies.filter(b => (b.requires ?? []).every(s => manifestWear.some(w => w.slot === s && lib.supports(b.id, w.id))));
    expect(lib.bodies.map(b => b.id)).toEqual(satisfiable.map(b => b.id));
    expect(lib.wearables.map(w => w.id)).toEqual(manifestWear.map(w => w.id));
    expect(manifestBodies.some(b => b.id === 'lastshift')).toBe(true);
    const excluded: string[] = [];
    for (const b of lib.bodies) for (const w of manifestWear) {
      if (b.covers?.includes(w.slot)) continue;
      if (!lib.supports(b.id, w.id)) excluded.push(`${b.id}x${w.id}`);
      else { const s = variantExtras(w.id, b.id).slot; if (s) expect(s).toBe(w.slot); }
    }
    console.log(`[wardrobe] bodies ${lib.bodies.map(b => b.id).join(',')}; wearables ${SLOTS.map(s => `${s}:${lib.wearables.filter(w => w.slot === s).map(w => w.id).join('/') || '-'}`).join(' ')}; pairs excluded by the build: ${excluded.join(', ') || 'none'}`);
  });

  it('every supported body x wearable pair builds: shared 18-joint skeleton, 6 clips, valid skin data, masked body', () => {
    for (const b of lib.bodies) {
      checkBuilt({body: b.id, wear: {}});
      for (const w of lib.wearables) {
        if (!lib.supports(b.id, w.id)) continue;
        const look: ZombieLook = {body: b.id, wear: {[w.slot]: w.id}};
        const {body} = checkBuilt(look);
        const ex = variantExtras(w.id, b.id);
        const hidden = popcount(ex.hideBodyTriangles), full = fullTris(b.id);
        if (ex.hiddenCount != null) expect(ex.hiddenCount).toBe(hidden);
        expect(body.geometry.index!.count / 3).toBe(full - hidden);
        if (w.slot === 'upper' || w.slot === 'lower') expect(hidden, `${b.id}x${w.id}`).toBeGreaterThan(0);
        expect(hidden, `${b.id}x${w.id}`).toBeLessThan(full * 0.6);
      }
    }
  });

  it('multi-slot combinations build with layered masks (upper x lower, head x face, upper x head, lower x face)', () => {
    let built = 0;
    const pairs: [WardrobeSlot, WardrobeSlot][] = [['upper', 'lower'], ['head', 'face'], ['upper', 'head'], ['lower', 'face']];
    for (const b of lib.bodies) for (const [sa, sb] of pairs) {
      const A = lib.wearables.filter(w => w.slot === sa && lib.supports(b.id, w.id)), B = lib.wearables.filter(w => w.slot === sb && lib.supports(b.id, w.id));
      for (const a of A) for (const c of B) {
        const look: ZombieLook = {body: b.id, wear: {[sa]: a.id, [sb]: c.id}};
        // a body that requires a slot is completed with its first fitted wearable there
        for (const r of b.requires ?? []) if (!look.wear[r]) look.wear[r] = lib.wearables.find(w => w.slot === r && lib.supports(b.id, w.id))!.id;
        if (!lib.isValid(look)) continue;
        checkBuilt(look);
        built++;
      }
    }
    // the fullest look per body (one of each slot) also builds
    for (const b of lib.bodies) {
      const full = lib.enumerateLooks({bodies: [b.id]}).sort((x, y) => Object.keys(y.wear).length - Object.keys(x.wear).length)[0];
      if (full) { checkBuilt(full); built++; }
    }
    console.log(`[wardrobe] multi-slot looks built and mask-checked: ${built}`);
    expect(built).toBeGreaterThan(0);
  });

  it('exact counts: >= 48 valid fitted looks and >= 48 fitted pairs once lower/head/face wearables ship', () => {
    const c = lib.countLooks();
    console.log(`[wardrobe counts] bodies ${c.bodies}; wearables per slot ${JSON.stringify(c.wearablesPerSlot)}; fitted pairs ${c.pairCount} ${JSON.stringify(c.pairsPerSlot)}; valid looks (>= 1 wearable, base looks excluded) ${c.validLooks} ${JSON.stringify(c.perBody)}`);
    if (hasNewSlots) {
      expect(c.validLooks).toBeGreaterThanOrEqual(48);
      expect(c.pairCount).toBeGreaterThanOrEqual(48);
    } else {
      console.log('[wardrobe counts] only iteration-05 upper wearables are in the manifest: asserting the legacy 24 pairs (>= 48 is asserted once lower/head/face wearables are registered)');
      expect(c.pairCount).toBe(24);
      expect(c.validLooks).toBe(24);
    }
    expect(lib.comboCount).toBe(c.pairCount);
  });

  it('seeded selection: deterministic, valid, rules honoured, masks a minority, every fitted pair reachable', () => {
    const avail = lib.available;
    const a = Array.from({length: 16}, (_, i) => pickZombieLook(12345, i, i % 3 ? 'shambler' : 'coated', avail));
    const b = Array.from({length: 16}, (_, i) => pickZombieLook(12345, i, i % 3 ? 'shambler' : 'coated', avail));
    expect(a).toEqual(b);
    expect(Array.from({length: 16}, (_, i) => pickZombieLook(54321, i, i % 3 ? 'shambler' : 'coated', avail))).not.toEqual(a);
    const seen = new Set<string>();
    let n = 0, face = 0, maskedBody = 0;
    for (let seed = 1; seed <= 400; seed++) for (let i = 0; i < 14; i++) {
      const type = i % 5 < 2 ? 'coated' : 'shambler';
      const l = pickZombieLook(seed * 7919, i, type, avail);
      n++;
      expect(lib.isValid(l) || Object.keys(l.wear).length === 0, lookKey(l)).toBe(true);
      const body = lib.bodies.find(x => x.id === l.body)!;
      for (const s of body.covers ?? []) expect(l.wear[s]).toBeUndefined();
      for (const s of body.requires ?? []) expect(l.wear[s]).toBeDefined();
      const up = lib.wearables.find(w => w.id === l.wear.upper) as WearableDef | undefined;
      const heavyFits = lib.wearables.some(w => w.heavy && lib.supports(l.body, w.id));
      if (type === 'coated' && heavyFits) expect(up?.heavy).toBe(true);
      if (type === 'shambler') expect(up?.heavy ?? false).toBe(false);
      if (l.wear.face) face++;
      if (l.wear.face || body.covers?.includes('face')) maskedBody++;
      for (const w of Object.values(l.wear)) seen.add(`${l.body}|${w}`);
    }
    for (const p of lib.pairs()) expect(seen.has(`${p.body}|${p.wearable}`), `${p.body}|${p.wearable}`).toBe(true);
    console.log(`[wardrobe selection] face-slot wearable on ${(100 * face / n).toFixed(1)}% of zombies; masked incl. built-in masks ${(100 * maskedBody / n).toFixed(1)}%`);
    if (lib.wearables.some(w => w.slot === 'face')) expect(face / n).toBeLessThan(0.25);
  });

  it('per-body bone lengths stay human and the ragdoll builds/settles from every body (+ heavy upper)', () => {
    const g = new Grid(64, 64); // 32 x 32 m at CELL 0.5 m
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) g.set(x, y, x < 2 || y < 2 || x >= 62 || y >= 62 ? SOLID : FLOOR);
    const ph = new PhysicsSystem(null);
    ph.build({grid: g, props: [], trench: {floorY: -1.15}} as unknown as Parameters<PhysicsSystem['build']>[0]);
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let n = 0;
    for (const b of lib.bodies) {
      const heavy = lib.wearables.find(w => w.heavy && lib.supports(b.id, w.id))?.id ?? null;
      const req: ZombieLook['wear'] = {};
      for (const r of b.requires ?? []) req[r] = lib.wearables.find(w => w.slot === r && lib.supports(b.id, w.id))!.id;
      for (const wear of [req, heavy ? {...req, upper: heavy} : null]) {
        if (!wear) continue;
        const app = lib.build({body: b.id, wear});
        const z = new ZombieActor(app, {x: 6 + (n % 5) * 5, z: 6 + Math.floor(n / 5) * 6, yaw: 0.3, type: wear.upper ? 'coated' : 'shambler', area: 0}, rand);
        n++;
        expect(z.hasRig).toBe(true);
        expect(z.meshes.length).toBe(1 + Object.keys(wear).length);
        expect(z.meshes.every(m => z.slotOf(m) !== null)).toBe(true);
        const len = (a: string, c: string) => z.bone(a)!.getWorldPosition(new THREE.Vector3()).distanceTo(z.bone(c)!.getWorldPosition(new THREE.Vector3())) / z.scale;
        const H = z.bone('Head')!.getWorldPosition(new THREE.Vector3()).y / z.scale;
        expect(H).toBeGreaterThan(1.35); expect(H).toBeLessThan(1.8);
        for (const [a, c, lo, hi] of [['L_Thigh', 'L_Shin', 0.3, 0.5], ['L_Shin', 'L_Foot', 0.3, 0.48], ['L_UpperArm', 'L_Forearm', 0.2, 0.36], ['L_Forearm', 'L_Hand', 0.18, 0.33], ['Hips', 'Neck', 0.45, 0.75]] as const) {
          const l = len(a, c);
          expect(l, `${b.id} ${a}`).toBeGreaterThan(lo); expect(l, `${b.id} ${a}`).toBeLessThan(hi);
        }
        for (let i = 0; i < 20; i++) { z.animate(1 / 60, 'Walk', 0.6); z.syncTransform(); z.updateVolumes(); }
        const torso = z.hitVolumes.find(v => v.part === 'torso')!;
        expect(torso.r).toBeGreaterThan(0.12); expect(torso.r).toBeLessThan(0.36);
        z.brain.damage(999, 0, 0);
        expect(ph.ragdoll(z, {dir: {x: 0, y: -0.1, z: -1}, point: {x: z.brain.x, y: 1.2, z: z.brain.z}, strength: 38})).toBe(true);
        for (let i = 0; i < 240; i++) ph.update(1 / 60);
        const ys: number[] = [];
        z.root.updateMatrixWorld(true);
        z.root.traverse(o => { if ((o as THREE.Bone).isBone) ys.push(o.getWorldPosition(new THREE.Vector3()).y); });
        expect(ys.every(Number.isFinite)).toBe(true);
        expect(Math.min(...ys)).toBeGreaterThan(-0.03);
        expect(z.bone('Head')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.55);
      }
    }
    expect(ph.stats().ragdollsFailed).toBe(0);
  });

  it('derivative provenance exists for every runtime file and is marked unapproved', () => {
    for (const d of [...manifestBodies.map(b => `zombie-body-${b.id}`), ...manifestWear.map(w => `outfit-${w.id}`)]) {
      const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../public/assets/derivatives/${d}.json`, import.meta.url)), 'utf8')) as {status: {approved: boolean; gameReady: boolean}; source: {sha256Verified: string}};
      expect(j.status.approved, d).toBe(false);
      expect(j.status.gameReady, d).toBe(false);
      expect(j.source.sha256Verified, d).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
