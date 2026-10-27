// Lane W (iteration 06): slot-based wardrobe LOGIC on synthetic data (no asset files): selection
// rules (weights, required/covered slots, compatibility rules, coated = heavy upper, pools),
// availability (missing fitted variant, stale body hash, slot mismatch), exact look enumeration,
// mask unions (body + layered wearables), hit/girth bulk and ZombieActor mesh/material contract.

import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {
  WardrobeLibrary, pickZombieLook, wearablesCompatible, lookKey, outfitNodeName, DEFAULT_NONE_WEIGHTS,
  type ZombieBodyDef, type WearableDef, type WardrobeAvailability, type ZombieLook,
} from '../src/ai/wardrobe';
import {ZombieActor} from '../src/ai/zombieActor';

const JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'];
const b64 = (tris: number[], n = 8) => { const b = new Uint8Array(Math.ceil(n / 8)); for (const t of tris) b[t >> 3] |= 1 << (t & 7); return Buffer.from(b).toString('base64'); };

/** A tiny skinned "body": 8 triangles, 18 bones, everything weighted to Hips. */
function skinnedGeometry(nTris: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], si: number[] = [], sw: number[] = [];
  for (let t = 0; t < nTris; t++) for (let k = 0; k < 3; k++) { pos.push(t * 0.1 + k * 0.03, 1 + k * 0.05, 0); si.push(1, 0, 0, 0); sw.push(1, 0, 0, 0); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(Array.from({length: nTris * 3}, (_, i) => i));
  return g;
}
function fakeBody(id: string, hit = {head: 0.12, torso: 0.15, arm: 0.07, leg: 0.11}): GLTF {
  const scene = new THREE.Group();
  const bones = JOINTS.map(n => { const b = new THREE.Bone(); b.name = n; return b; });
  scene.add(bones[0]);
  for (const b of bones.slice(1)) bones[0].add(b);
  const mesh = new THREE.SkinnedMesh(skinnedGeometry(8), new THREE.MeshStandardMaterial());
  mesh.name = 'ZombieBody';
  scene.add(mesh);
  mesh.bind(new THREE.Skeleton(bones));
  scene.userData = {zombieBody: {id, heightM: 1.78, hit, bodyTriangles: 8, geometryHash: 'hash_' + id}};
  return {scene, animations: []} as unknown as GLTF;
}
type V = {hide?: number[]; bulk?: Record<string, number>; hideWear?: Record<string, number[]>; hash?: string};
function fakeWear(id: string, slot: string, variants: Record<string, V>, legacy = false): GLTF {
  const scene = new THREE.Group();
  for (const [body, v] of Object.entries(variants)) {
    const mesh = new THREE.SkinnedMesh(skinnedGeometry(8), new THREE.MeshStandardMaterial());
    mesh.name = outfitNodeName(id, body);
    mesh.userData = {outfit: id, slot, body, bodyTriangles: 8, bodyGeometryHash: v.hash ?? 'hash_' + body, hideBodyTriangles: v.hide ? b64(v.hide) : undefined, hiddenCount: v.hide?.length ?? 0,
      bulkM: v.bulk ?? {}, hideWear: v.hideWear ? Object.fromEntries(Object.entries(v.hideWear).map(([k, t]) => [k, b64(t)])) : undefined};
    scene.add(mesh);
  }
  scene.userData = legacy ? {zombieOutfit: {id}} : {zombieWearable: {id, slot, kind: 'garment'}};
  return {scene, animations: []} as unknown as GLTF;
}

const BODIES: ZombieBodyDef[] = [
  {id: 'A', label: 'A', model: 'b_A', weight: 1, origin: 'generated'},
  {id: 'U', label: 'underwear', model: 'b_U', weight: 1, origin: 'generated', requires: ['lower'], tags: ['bald']},
  {id: 'S', label: 'masked', model: 'b_S', weight: 1, origin: 'reused', covers: ['head', 'face'], tags: ['hood']},
];
const WEAR: WearableDef[] = [
  {id: 'u1', slot: 'upper', label: 'jacket', model: 'w_u1', weight: 1, origin: 'generated'},
  {id: 'u2', slot: 'upper', label: 'long coat', model: 'w_u2', weight: 1, heavy: true, tags: ['long'], origin: 'generated'},
  {id: 'l1', slot: 'lower', label: 'pants', model: 'w_l1', weight: 1, origin: 'generated'},
  {id: 'h1', slot: 'head', label: 'cap', model: 'w_h1', weight: 1, tags: ['brimmed'], origin: 'generated'},
  {id: 'f1', slot: 'face', label: 'mask', model: 'w_f1', weight: 1, incompatibleWith: ['tag:brimmed'], origin: 'generated'},
];
function models(extra: Record<string, GLTF> = {}): Record<string, GLTF> {
  const all = {hide: [0]};
  return {
    b_A: fakeBody('A'), b_U: fakeBody('U'), b_S: fakeBody('S'),
    w_u1: fakeWear('u1', 'upper', {A: {hide: [0, 1], bulk: {torso: 0.03, arm: 0.01}, hideWear: {l1: [7]}}, U: {hide: [1]}, S: {hide: [1]}}),
    w_u2: fakeWear('u2', 'upper', {A: {hide: [1, 2], bulk: {torso: 0.04, arm: 0.02}}, U: {hide: [2]}, S: {hide: [2]}}),
    w_l1: fakeWear('l1', 'lower', {A: {hide: [3, 4], bulk: {leg: 0.02}}, U: {hide: [3]}, S: {hide: [3]}}),
    w_h1: fakeWear('h1', 'head', {A: {hide: [5]}, U: all, S: all}),
    w_f1: fakeWear('f1', 'face', {A: {hide: [6], bulk: {head: 0.02}}, U: all}),
    ...extra,
  };
}

describe('wardrobe rules (pure)', () => {
  it('compatibility is symmetric and understands ids and tags', () => {
    const [u1, u2, , h1, f1] = WEAR;
    expect(wearablesCompatible(h1, f1)).toBe(false);
    expect(wearablesCompatible(f1, h1)).toBe(false);
    expect(wearablesCompatible(u1, f1)).toBe(true);
    const byId: WearableDef = {...u1, id: 'x', incompatibleWith: ['u2']};
    expect(wearablesCompatible(byId, u2)).toBe(false);
    expect(wearablesCompatible(u2, byId)).toBe(false);
    expect(lookKey({body: 'A', wear: {lower: 'l1', upper: 'u1', face: 'f1'}})).toBe('A|upper=u1|lower=l1|face=f1');
  });

  it('selection: deterministic, rules honoured, masks a minority, pools override', () => {
    const lib = new WardrobeLibrary(models(), BODIES, WEAR);
    const av = lib.available;
    const run = (seed: number) => Array.from({length: 20}, (_, i) => pickZombieLook(seed, i, i % 3 ? 'shambler' : 'coated', av));
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    let face = 0, faceEligible = 0, n = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) for (let i = 0; i < 10; i++) {
      const type = i % 4 === 0 ? 'coated' : 'shambler';
      const l = pickZombieLook(seed * 104729, i, type, av);
      n++;
      expect(lib.isValid(l), JSON.stringify(l)).toBe(true);
      if (l.body === 'U') expect(l.wear.lower).toBe('l1');
      if (l.body === 'S') { expect(l.wear.head).toBeUndefined(); expect(l.wear.face).toBeUndefined(); }
      if (l.body !== 'S') faceEligible++;
      expect(!!(l.wear.head && l.wear.face)).toBe(false); // cap x mask rule
      if (type === 'coated') expect(l.wear.upper).toBe('u2'); else expect(l.wear.upper === 'u2').toBe(false);
      if (l.wear.face) face++;
      for (const w of Object.values(l.wear)) seen.add(`${l.body}|${w}`);
    }
    for (const p of lib.pairs()) expect(seen.has(`${p.body}|${p.wearable}`), `${p.body}|${p.wearable}`).toBe(true);
    // face: weight 1 vs none 6 (when not blocked by a cap) -> ~1/7 of eligible zombies
    expect(face / faceEligible).toBeLessThan(0.25);
    expect(face / n).toBeLessThan(0.25);
    expect(face).toBeGreaterThan(0);
    // pool: body weight 0 removes it; none weight 0 forces the slot when possible
    for (let i = 0; i < 50; i++) {
      const l = pickZombieLook(99, i, 'shambler', av, {bodies: {S: 0, U: 0}, none: {lower: 0}});
      expect(l.body).toBe('A');
      expect(l.wear.lower).toBe('l1');
    }
    expect(DEFAULT_NONE_WEIGHTS.face).toBeGreaterThan(DEFAULT_NONE_WEIGHTS.upper);
  });

  it('a body whose required slot cannot be filled is skipped; legacy availability still works', () => {
    const av: WardrobeAvailability = {bodies: BODIES, wearables: WEAR, outfits: WEAR.filter(w => w.slot === 'upper'), supports: (b, w) => !(b === 'U' && w === 'l1')};
    for (let i = 0; i < 60; i++) expect(pickZombieLook(5, i, 'shambler', av).body).not.toBe('U');
    const legacy = pickZombieLook(5, 1, 'coated', {bodies: BODIES.slice(0, 1), outfits: WEAR.filter(w => w.slot === 'upper')});
    expect(legacy).toEqual({body: 'A', wear: {upper: 'u2'}});
  });
});

describe('WardrobeLibrary on synthetic GLBs', () => {
  it('availability: excluded pairs, stale hashes and slot mismatches are unavailable; covers respected', () => {
    const m = models({
      w_l1: fakeWear('l1', 'lower', {A: {hide: [3]}, U: {hide: [3], hash: 'stale'}}), // U variant stale -> U cannot meet its requirement
      w_h1: fakeWear('h1', 'face', {A: {hide: [5]}}), // GLB says face, registry says head -> refused
    });
    const lib = new WardrobeLibrary(m, BODIES, WEAR);
    expect(lib.supports('A', 'l1')).toBe(true);
    expect(lib.supports('U', 'l1')).toBe(false);
    expect(lib.supports('S', 'l1')).toBe(false); // node missing = excluded by the build
    expect(lib.supports('A', 'h1')).toBe(false);
    expect(lib.bodies.map(b => b.id)).toEqual(['A', 'S']); // U dropped: required lower unavailable
    expect(lib.wearables.map(w => w.id)).toEqual(['u1', 'u2', 'l1', 'f1']);
    const lib2 = new WardrobeLibrary(models(), BODIES, WEAR);
    expect(lib2.supports('S', 'h1')).toBe(false); // covered by the body even though a node exists
    expect(lib2.supports('S', 'f1')).toBe(false);
    expect(lib2.isValid({body: 'S', wear: {head: 'h1'}})).toBe(false);
    expect(lib2.isValid({body: 'A', wear: {head: 'h1', face: 'f1'}})).toBe(false);
    expect(lib2.isValid({body: 'A', wear: {upper: 'l1'}})).toBe(false);
    expect(lib2.isValid({body: 'U', wear: {upper: 'u1'}})).toBe(false); // requires lower
    expect(lib2.isValid({body: 'U', wear: {upper: 'u1', lower: 'l1'}})).toBe(true);
    // legacy (iteration-05) wearable GLB without a slot = upper
    const lib3 = new WardrobeLibrary(models({w_u1: fakeWear('u1', 'upper', {A: {hide: [0]}}, true)}), BODIES, WEAR);
    expect(lib3.supports('A', 'u1')).toBe(true);
  });

  it('exact enumeration: 17 (A) + 9 (U) + 5 (S) = 31 valid looks, 13 fitted pairs', () => {
    const lib = new WardrobeLibrary(models(), BODIES, WEAR);
    const c = lib.countLooks();
    expect(c.perBody).toEqual({A: 17, U: 9, S: 5});
    expect(c.validLooks).toBe(31);
    expect(c.pairCount).toBe(13);
    expect(c.pairsPerSlot).toEqual({upper: 6, lower: 3, head: 2, face: 2});
    expect(c.wearablesPerSlot).toEqual({upper: 2, lower: 1, head: 1, face: 1});
    const looks = lib.enumerateLooks();
    expect(new Set(looks.map(lookKey)).size).toBe(31);
    for (const l of looks) expect(lib.isValid(l)).toBe(true);
  });

  it('build: union body mask, layered wearable mask, bulk -> hit/girth, mesh slot tags, shared skeleton', () => {
    const lib = new WardrobeLibrary(models(), BODIES, WEAR);
    const look: ZombieLook = {body: 'A', wear: {upper: 'u1', lower: 'l1', face: 'f1'}};
    const app = lib.build(look);
    expect(app.look).toEqual(look);
    const body = app.meshes.find(m => m.slot === 'body')!.mesh;
    expect(body.geometry.index!.count / 3).toBe(8 - 5); // hides 0,1 (u1) + 3,4 (l1) + 6 (f1)
    const lower = app.meshes.find(m => m.slot === 'lower')!.mesh;
    expect(lower.geometry.index!.count / 3).toBe(7); // u1 hides l1 triangle 7 (waistband under the hem)
    expect(app.meshes.find(m => m.slot === 'upper')!.mesh.geometry.index!.count / 3).toBe(8);
    expect(app.meshes.map(m => m.slot)).toEqual(['body', 'lower', 'upper', 'face']);
    for (const m of app.meshes) {
      expect(m.mesh.userData.slot).toBe(m.slot);
      expect(m.mesh.skeleton.bones.every((b, i) => b === body.skeleton.bones[i])).toBe(true);
    }
    // cached masked geometry shared between actors wearing the same set
    const again = lib.build(look);
    expect(again.meshes[0].mesh.geometry).toBe(body.geometry);
    expect(again.meshes[0].mesh).not.toBe(body);
    const base = lib.build({body: 'A', wear: {}});
    expect(app.hit.leg).toBeCloseTo(base.hit.leg + 0.02 * 0.913, 5);
    expect(app.hit.head).toBeCloseTo(base.hit.head + 0.02 * 1.126, 5);
    expect(app.hit.torso).toBeGreaterThan(base.hit.torso);
    expect(app.girth.leg).toBeGreaterThan(base.girth.leg);
    expect(app.heavy).toBe(false);
    expect(lib.build({body: 'A', wear: {upper: 'u2'}}).heavy).toBe(true);
    // incompatible / unsupported items are dropped, never half-built
    expect(lib.build({body: 'A', wear: {head: 'h1', face: 'f1'}}).look.wear).toEqual({head: 'h1'});
    expect(lib.build({body: 'S', wear: {head: 'h1', upper: 'u1'}}).look.wear).toEqual({upper: 'u1'});
  });

  it('ZombieActor exposes tagged meshes, clones materials per actor and flashes the CURRENT materials', () => {
    const lib = new WardrobeLibrary(models(), BODIES, WEAR);
    let s = 3;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const look: ZombieLook = {body: 'A', wear: {upper: 'u1', lower: 'l1'}};
    const z1 = new ZombieActor(lib.build(look), {x: 1, z: 1, yaw: 0, type: 'shambler', area: 0}, rand);
    const z2 = new ZombieActor(lib.build(look), {x: 2, z: 1, yaw: 0, type: 'shambler', area: 0}, rand);
    expect(z1.meshes.length).toBe(3);
    expect(z1.meshes.map(m => z1.slotOf(m)).sort()).toEqual(['body', 'lower', 'upper']);
    expect(z1.root.name).toBe('zombie-shambler-A|upper=u1|lower=l1');
    for (let i = 0; i < 3; i++) expect(z1.meshes[i].material).not.toBe(z2.meshes[i].material);
    // another system (damage wounds) replaces a material after construction
    const upper = z1.meshes.find(m => m.userData.slot === 'upper')!;
    const replaced = (upper.material as THREE.MeshStandardMaterial).clone();
    upper.material = replaced;
    z1.hitFlash = 1;
    z1.animate(1 / 60, 'Idle', 0);
    expect(replaced.emissive.r).toBeGreaterThan(0);
    expect((z2.meshes[0].material as THREE.MeshStandardMaterial).emissive.r).toBe(0);
    let disposed = 0;
    replaced.addEventListener('dispose', () => disposed++);
    z1.dispose();
    expect(disposed).toBe(1);
    expect(z1.slotOf(new THREE.Object3D())).toBeNull();
  });
});
