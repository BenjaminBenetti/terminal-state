// Task studio-flamethrower-fire-20261114-031614-01 (lane ASSET): the Flamethrower's cooked model and how it reaches the game.
//  - the shipped file: its bytes are the provenance's and the release allowlist's; one mesh, one material, its own three PBR maps
//    (2048 / 1024 / 1024 JPEG), no source names, hash-only provenance, a credits section;
//  - the registry the cook wrote (assets/flamethrowerModels.generated.ts) is what the file measures: 0.95 m, centred, the Muzzle at the
//    centre of the burner bell's mouth (the foremost point, on the lance's axis), the Grip behind it, the Fore handle between, the
//    gauge's top (Sight) the highest point;
//  - it is NOT a weapon-variety identity and in no find pool, but its model takes the same lazy route (weapons/lazyWeaponModels.ts):
//    nothing is fetched until a section can show it or a surface asks; one delivery hands it to the REAL held view, the REAL pickups
//    (stand-in -> the model in place, lying at its recorded size) and the icons; its warm prototype exists once it is resident;
//  - the held view: Viewmodel.muzzleWorld is the Muzzle marker of the copy in hand (the bell's mouth), muzzleDrawnWorld the same point
//    on its drawn screen spot; no aimed pose (a stream weapon); the hip pose in weapons/flamethrower.ts follows from the markers —
//    the lance points at the view axis ahead, the bell under the crosshair, the shoulder rest out of frame, nothing near the eye.
// The model is the REAL cooked GLB (textures stripped for three: Node has no image decoder). No browser, no git history.
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ImageUtils, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {FLAMETHROWER_MODEL as M} from '../src/assets/flamethrowerModels.generated';
import {WEAPON_VARIETY_MODELS} from '../src/assets/weaponVarietyModels.generated';
import {FLAMETHROWER_ID} from '../src/fire/flamethrowerSpec';
import {FLAMETHROWER_DIMS} from '../src/items/flamethrowerItems';
import {ITEMS, itemDef, itemDims} from '../src/items/items';
import {GUN_CATEGORIES, GUN_LEAVES, MELEE_LEAVES, WEAPON_POOL_VERSION, slotRows, varietyIdsIn, weaponLength, type SlotKind} from '../src/items/weaponVariety';
import {FLAMETHROWER_DEF} from '../src/weapons/flamethrower';
import {LAZY_EXTRA_WEAPON_IDS, LAZY_MODEL_WEAPON_IDS, isLazyModelWeapon, lazyWeaponIdsIn, lazyWeaponModelUrl} from '../src/weapons/lazyWeaponModels';
import {VARIETY_GUN_IDS, VARIETY_MELEE_IDS, VARIETY_WEAPON_IDS, VARIETY_WEAPONS, isVarietyWeapon} from '../src/weapons/varietyIds';
import {Viewmodel} from '../src/weapons/viewmodel';
import {WEAPONS} from '../src/weapons/weapons';
import {itemIconHtml} from '../src/ui/itemIcons';
import {PickupManager} from '../src/world/pickups';
import {WeaponVarietyDelivery, installWeaponVarietyDelivery} from '../src/world/weaponVarietyDelivery';
import {
  WEAPON_VARIETY_MODEL_STATS, ensureWeaponVarietyModels, resetWeaponVarietyModels, residentWeaponVarietyIds,
  setWeaponVarietyLoader, weaponVarietyGltf, weaponVarietyModelState, weaponVarietyModelUrl, weaponVarietyWarmRoots,
} from '../src/world/weaponVarietyModels';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
const REPO = path.resolve(HERE, '../..');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const ID = FLAMETHROWER_ID;
const PROV_REL = 'assets/derivatives/weapon-flamethrower.json';
const file = path.join(PUBLIC, M.url);
const prov = JSON.parse(fs.readFileSync(path.join(PUBLIC, PROV_REL), 'utf8'));
type V3 = readonly [number, number, number];

/** The shipped GLB as a document, and as a three.js load without its maps. */
let doc: Awaited<ReturnType<NodeIO['read']>>, gltf: GLTF;
beforeAll(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  doc = await io.read(file);
  const stripped = await io.read(file);
  for (const t of stripped.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(stripped);
  gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}, 120000);

const deliveries: WeaponVarietyDelivery[] = [];
afterEach(() => {
  for (const d of deliveries.splice(0)) d.dispose();
  setWeaponVarietyLoader(null);
  resetWeaponVarietyModels();
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Flamethrower: the cooked file', () => {
  it('its bytes are the provenance\'s and the allowlist\'s; the provenance is hash-only; the credits name it', () => {
    const glb = fs.readFileSync(file), provBytes = fs.readFileSync(path.join(PUBLIC, PROV_REL));
    expect([prov.output.url, prov.output.bytes, prov.output.sha256]).toEqual([M.url, glb.length, sha(glb)]);
    const allow = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8')).files as {path: string; bytes: number; sha256: string}[];
    const entry = (p: string) => allow.find(f => f.path === p);
    expect(entry(M.url)).toEqual({path: M.url, bytes: glb.length, sha256: sha(glb)});
    expect(entry(PROV_REL)).toEqual({path: PROV_REL, bytes: provBytes.length, sha256: sha(provBytes)});
    const credits = fs.readFileSync(path.join(PUBLIC, 'assets/CREDITS.md'));
    expect(entry('assets/CREDITS.md')).toEqual({path: 'assets/CREDITS.md', bytes: credits.length, sha256: sha(credits)});
    const section = /<!-- BEGIN flamethrower-model-20261114 [^>]*-->([\s\S]*?)<!-- END flamethrower-model-20261114 -->/.exec(credits.toString())?.[1] ?? '';
    for (const text of [M.url, PROV_REL, 'tools/asset-pipeline/weapons/build-flamethrower.mjs', prov.meshy.task, 'no licence or commercial clearance implied']) expect(section, text).toContain(text);
    // hashes and measurements only: no address, private path, generation text or source file name
    expect(provBytes.toString()).not.toMatch(/https?:|Signature|X-Amz|token=|reference\/|\/workspace|\/home\/|portal|prompt|_texture\.glb/i);
    expect([prov.schema, prov.id, prov.itemId, prov.task]).toEqual(['terminal-state-derivative-v1', 'weapon-flamethrower', ID, 'studio-flamethrower-fire-20261114-031614-01']);
    expect(prov.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.conditioningImage.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect([prov.meshy.request.ai_model, prov.meshy.request.model_type, prov.meshy.billedCredits]).toEqual(['meshy-t2.5', 'smart-topology', 15]);
  });

  it('one mesh, one material with the model\'s own three maps (2048 / 1024 / 1024 JPEG), the four markers, no source names', () => {
    const root = doc.getRoot();
    expect(root.listMaterials().length).toBe(1);
    const mat = root.listMaterials()[0];
    const size = (t: ReturnType<typeof mat.getBaseColorTexture>) => [ImageUtils.getSize(t!.getImage()!, t!.getMimeType()), t!.getMimeType()];
    expect([size(mat.getBaseColorTexture()), size(mat.getMetallicRoughnessTexture()), size(mat.getNormalTexture())])
      .toEqual([[[2048, 2048], 'image/jpeg'], [[1024, 1024], 'image/jpeg'], [[1024, 1024], 'image/jpeg']]);
    expect(root.listTextures().length).toBe(3);
    // the maps are the source's own, slot for slot: the base colour byte for byte, the other two downsized
    const recs = prov.textures as {slot: string; sha256: string; source: {sha256: string; size: number[]}; size: number[]}[];
    expect(recs.map(t => [t.slot, t.source.size[0], t.size[0]])).toEqual([['baseColor', 2048, 2048], ['metallicRoughness', 2048, 1024], ['normal', 2048, 1024]]);
    expect(recs[0].sha256).toBe(recs[0].source.sha256);
    expect(sha(Buffer.from(mat.getBaseColorTexture()!.getImage()!))).toBe(recs[0].sha256);
    expect(root.listNodes().map(n => n.getName()).sort()).toEqual(['Fore', 'Grip', 'Muzzle', 'Sight', ID]);
    expect(root.listMeshes().map(m => m.getName())).toEqual([ID]);
    for (const n of root.listNodes()) if (!n.getMesh()) expect(n.listChildren().length).toBe(0); // empty marker nodes
    const names = [...root.listScenes(), ...root.listMaterials(), ...root.listTextures()].map(o => o.getName());
    for (const n of names) expect(n).toMatch(/^weapon-flamethrower(-[A-Za-z]+)?$/);
    const glb = fs.readFileSync(file), json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
    expect(json.asset.generator).toBe('Terminal State tools/asset-pipeline/weapons/build-flamethrower.mjs (glTF-Transform)');
    expect(glb.length).toBeLessThan(5e6);
  });

  it('the registry is what the file measures: 0.95 m long, centred, the triangle count, the markers where the nodes are', () => {
    const root = doc.getRoot(), prim = root.listMeshes()[0].listPrimitives()[0], pos = prim.getAttribute('POSITION')!;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); } }
    for (let k = 0; k < 3; k++) {
      expect(min[k]).toBeCloseTo(M.bounds.min[k], 4);
      expect(max[k]).toBeCloseTo(M.bounds.max[k], 4);
      expect(Math.abs(min[k] + max[k])).toBeLessThan(2e-4); // the bounding box is centred on the origin
    }
    expect(Math.abs(M.length - 0.95)).toBeLessThanOrEqual(0.01);
    expect(max[2] - min[2]).toBeCloseTo(M.length, 3);
    expect(prim.getIndices()!.getCount() / 3).toBe(M.tris);
    expect([M.itemId, M.kind, M.parts.length, weaponLength(ID), FLAMETHROWER_DEF.view.length]).toEqual([ID, 'gun', 0, M.length, M.length]);
    expect(Object.keys(M.markers).sort()).toEqual(['Fore', 'Grip', 'Muzzle', 'Sight']);
    for (const [name, p] of Object.entries(M.markers) as [string, V3][]) {
      const node = root.listNodes().find(n => n.getName() === name)!;
      expect(node.getWorldTranslation().map(x => +x.toFixed(5)), name).toEqual([...p]);
      for (let k = 0; k < 3; k++) { expect(p[k]).toBeGreaterThanOrEqual(M.bounds.min[k] - 1e-4); expect(p[k]).toBeLessThanOrEqual(M.bounds.max[k] + 1e-4); } // (bounds: 4 decimals)
    }
  });

  it('the Muzzle is the centre of the bell\'s round mouth, the foremost point; the Grip is behind it on the lance, the gauge on top', () => {
    const {Grip, Muzzle, Sight, Fore} = M.markers;
    expect(Math.abs(Muzzle[2] - M.bounds.min[2])).toBeLessThan(1e-4); // forward = -Z: nothing reaches farther
    // the rim: the vertices within 4 mm of the front face form a round ring about the Muzzle (the bell is ~125 mm across)
    const pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION')!, v = [0, 0, 0];
    const rim: number[][] = [];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); if (v[2] <= M.bounds.min[2] + 0.004) rim.push([v[0], v[1]]); }
    expect(rim.length).toBeGreaterThan(20);
    const radii = rim.map(p => Math.hypot(p[0] - Muzzle[0], p[1] - Muzzle[1]));
    expect(Math.min(...radii)).toBeGreaterThan(0.05);
    expect(Math.max(...radii)).toBeLessThan(0.068);
    const cx = (Math.min(...rim.map(p => p[0])) + Math.max(...rim.map(p => p[0]))) / 2, cy = (Math.min(...rim.map(p => p[1])) + Math.max(...rim.map(p => p[1]))) / 2;
    expect(Math.hypot(cx - Muzzle[0], cy - Muzzle[1])).toBeLessThan(0.001);
    // along the lance: Muzzle < Fore < Sight < Grip, all on its centre plane, the bell's centre on the axis through the grip
    expect(Muzzle[2]).toBeLessThan(Fore[2]);
    expect(Fore[2]).toBeLessThan(Sight[2]);
    expect(Sight[2]).toBeLessThan(Grip[2]);
    for (const p of [Grip, Muzzle, Sight, Fore]) expect(Math.abs(p[0])).toBeLessThan(0.005);
    expect(Math.abs(Muzzle[1] - Grip[1])).toBeLessThan(0.02);
    expect(Grip[2] - Muzzle[2]).toBeGreaterThan(0.7); // a long two-handed lance ahead of the firing hand
    expect(M.bounds.max[2] - Grip[2]).toBeGreaterThan(0.15); // the shoulder rest behind it
    expect(Math.abs(Sight[1] - M.bounds.max[1])).toBeLessThan(1e-4);
    expect(Fore[1]).toBeLessThan(Grip[1] - 0.04); // the front handle hangs under the lance
  });

  it('lying as a pickup it has its recorded size (items/flamethrowerItems.ts)', () => {
    const d = FLAMETHROWER_DIMS[ID], ext = prov.output.dims as number[]; // the cook's measured extents (x, y, z)
    expect([d.w, d.h, d.d, d.shape]).toEqual([ext[2], ext[0], ext[1], 'flat']); // on its side: length along X, thickness up
    for (let k = 0; k < 3; k++) expect(Math.abs(ext[k] - (M.bounds.max[k] - M.bounds.min[k]))).toBeLessThan(2e-4);
    expect(itemDims(ID)).toEqual(d);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Flamethrower: not a weapon-variety identity, never a find', () => {
  it('in no variety list, registry or pool; an ordinary weapon item with its own def', () => {
    expect([...VARIETY_WEAPON_IDS, ...VARIETY_GUN_IDS, ...VARIETY_MELEE_IDS] as string[]).not.toContain(ID);
    expect([isVarietyWeapon(ID), ID in VARIETY_WEAPONS, ID in WEAPON_VARIETY_MODELS]).toEqual([false, false, false]);
    expect([...varietyIdsIn([{itemId: ID}, {bag: [{itemId: ID}]}])]).toEqual([]);
    const leaves = [...GUN_LEAVES, ...MELEE_LEAVES, ...Object.values(GUN_CATEGORIES).flat()] as string[];
    expect(leaves.length).toBeGreaterThan(20);
    expect(leaves).not.toContain(ID);
    // every weapon slot kind's rows, in every pool version: the identities a find can become
    const kinds: SlotKind[] = ['weapon', 'gun', 'pistol', 'rifle', 'shotgun', 'melee'];
    for (let pool = 1; pool <= WEAPON_POOL_VERSION; pool++) for (const kind of kinds) {
      const rows = slotRows(kind, pool).map(r => r[0]);
      expect(rows.length, `${kind} v${pool}`).toBeGreaterThan(0);
      expect(rows, `${kind} v${pool}`).not.toContain(ID);
    }
    expect([ITEMS[ID]?.kind, ITEMS[ID]?.weaponId, WEAPONS[ID]]).toEqual(['weapon', ID, FLAMETHROWER_DEF]);
  });

  it('its model takes the lazy route: one more lazily delivered weapon, the same loader', () => {
    expect(LAZY_EXTRA_WEAPON_IDS).toEqual([ID]);
    expect(LAZY_MODEL_WEAPON_IDS).toEqual([...VARIETY_WEAPON_IDS, ID]);
    expect([isLazyModelWeapon(ID), isLazyModelWeapon('rifle'), isLazyModelWeapon('fuel_tank'), isLazyModelWeapon(null)]).toEqual([true, false, false, false]);
    expect([lazyWeaponModelUrl(ID), weaponVarietyModelUrl(ID), lazyWeaponModelUrl('rifle')]).toEqual([M.url, M.url, null]);
    for (const id of VARIETY_WEAPON_IDS) expect([isLazyModelWeapon(id), lazyWeaponModelUrl(id)]).toEqual([true, WEAPON_VARIETY_MODELS[id]!.url]);
    // the section preload's question: every variety id varietyIdsIn finds, + the Flamethrower, wherever it is carried or stored
    const held = [{hotbar: [{itemId: 'hornet'}, {itemId: ID, bag: [{itemId: 'crowbar'}]}]}, {lanes: {bags: [{stack: {itemId: 'backpack', bag: [{itemId: ID}]}}]}}, {itemId: 'pistol'}];
    expect([...lazyWeaponIdsIn(held)].sort()).toEqual([...varietyIdsIn(held), ID].sort());
    expect([...lazyWeaponIdsIn([{itemId: 'rifle'}, {itemId: 'fuel_tank'}, null, 'flamethrower'])]).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
/** The loader under test: the real cooked file, with a call log. */
function loader() {
  const calls: string[] = [];
  setWeaponVarietyLoader(async (id, url) => { calls.push(`${id} ${url}`); await sleep(1); return gltf; });
  return calls;
}
/** The delivery over the REAL held view and pickups, with a recording host. */
function world() {
  const viewmodel = new Viewmodel({} as never, {});
  const pickups = new PickupManager({});
  const log = {sync: 0, icons: [] as string[][], said: [] as string[]};
  const delivery = installWeaponVarietyDelivery({
    viewmodel: () => viewmodel, pickups: () => pickups, syncHeld: () => { log.sync++; },
    refreshIcons: async ids => { log.icons.push([...ids]); }, say: text => log.said.push(text), itemName: id => itemDef(id).short,
  });
  delivery.attach();
  deliveries.push(delivery);
  return {viewmodel, pickups, delivery, log};
}
const boxOf = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };

describe('the Flamethrower: lazy delivery to the held view, the pickups, the icons and the warm prototypes', () => {
  it('nothing is fetched for a player who never sees one; a section that holds one preloads it (once)', async () => {
    const calls = loader();
    expect(await ensureWeaponVarietyModels(lazyWeaponIdsIn([{hotbar: [{itemId: 'rifle'}, {itemId: 'pistol'}, {itemId: 'fuel_tank'}]}]))).toEqual([]);
    expect([calls, weaponVarietyModelState(ID), WEAPON_VARIETY_MODEL_STATS.fetched]).toEqual([[], 'idle', 0]);
    expect(await ensureWeaponVarietyModels(lazyWeaponIdsIn([{lockbox: [{itemId: ID}]}]))).toEqual([ID]);
    expect([calls, weaponVarietyModelState(ID), residentWeaponVarietyIds()]).toEqual([[`${ID} ${M.url}`], 'resident', [ID]]);
    expect(await ensureWeaponVarietyModels([ID])).toEqual([]);
    expect(calls.length).toBe(1);
  });

  it('in hand before its file arrived: asked for by the held view, shown the moment it arrives — the real model, pivoting at its Grip', async () => {
    const calls = loader();
    const w = world();
    w.viewmodel.setItem(ID);
    expect([calls.length, w.viewmodel.heldItem, w.viewmodel.wantedItem, weaponVarietyModelState(ID)]).toEqual([1, null, ID, 'loading']);
    await sleep(20);
    await w.delivery.settled();
    expect([w.viewmodel.heldItem, w.viewmodel.hasItem(ID), w.log.sync > 0, w.log.icons, w.log.said]).toEqual([ID, true, true, [[ID]], []]);
    const body = w.viewmodel.scene.getObjectByName(ID) as THREE.Mesh;
    expect(body.geometry.index!.count / 3).toBe(M.tris);
    // the copy in hand is one of the warm-up's roots (compiled on the loading screen when it is carried into a section)
    const holder = body.parent!.parent!;
    expect(w.viewmodel.warmRoots()).toContain(holder);
    expect(holder.visible).toBe(true);
  });

  it('a pickup shown before the file arrived trades its stand-in for the model in place: lying on its side at its recorded size', async () => {
    const calls = loader();
    const w = world();
    const stack = {uid: 7001, itemId: ID, count: 1};
    const p = w.pickups.add(stack as never, 2, 0, 3);
    expect([calls.length, p.obj.userData.awaitingModel, w.pickups.awaitingModels()]).toEqual([1, ID, {[ID]: 1}]);
    await sleep(20);
    await w.delivery.settled();
    expect([p.obj.userData.awaitingModel, w.pickups.awaitingModels(), p.stack]).toEqual([undefined, {}, stack]);
    const b = boxOf(p.obj), size = b.getSize(new THREE.Vector3()), d = FLAMETHROWER_DIMS[ID];
    expect([+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)]).toEqual([+d.w.toFixed(3), +d.h.toFixed(3), +d.d.toFixed(3)]);
    expect(b.min.y).toBeCloseTo(0, 5); // resting on the floor, not sunk or floating
    expect([(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2].map(x => +x.toFixed(4))).toEqual([2, 3]);
    // a pickup made once the model is resident is the model at once (no stand-in)
    const q = w.pickups.add({uid: 7002, itemId: ID, count: 1} as never, 0, 0, 0);
    expect(q.obj.userData.awaitingModel).toBeUndefined();
    let tris = 0;
    q.obj.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) tris += m.geometry.index!.count / 3; });
    expect(tris).toBe(M.tris);
  });

  it('an icon shown before the file arrived asks for it; the warm prototype exists once it is resident, never among the per-item pickup prototypes', async () => {
    const calls = loader();
    const w = world();
    expect(weaponVarietyWarmRoots().map(o => o.name)).toEqual([]);
    itemIconHtml(ID);
    itemIconHtml(ID);
    expect(calls.length).toBe(1); // (one shared fetch)
    await sleep(20);
    await w.delivery.settled();
    expect(w.log.icons).toEqual([[ID]]);
    const roots = weaponVarietyWarmRoots();
    expect(roots.map(o => o.name)).toEqual([`weapon-variety-warm-prototype-${ID}`]);
    let meshes = 0;
    roots[0].traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { meshes++; expect(m.visible).toBe(false); } });
    expect(meshes).toBe(1);
    expect(w.pickups.pickupPrototypes([ID]).meshes).toEqual([]); // its own pool's, like the variety weapons
    expect(weaponVarietyGltf(ID)!.scene.getObjectByName(ID)!.userData.shared).toBe(true); // a removed pickup never disposes the shared model
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Flamethrower: the held view', () => {
  const still = {moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0};
  const view = FLAMETHROWER_DEF.view;
  const rel = (a: V3, b: V3) => new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** A model point (relative to the Grip pivot) in viewmodel camera space at the settled hip pose of the def. */
  const atHip = (p: THREE.Vector3) => p.clone().applyEuler(new THREE.Euler(view.hipPitch, view.hipYaw, view.hipRoll)).add(new THREE.Vector3(...view.hip));
  function held() {
    const vm = new Viewmodel({} as never, {});
    vm.setAspect(16 / 9);
    expect(vm.addModel(ID, gltf)).toBe(true);
    vm.setItem(ID);
    for (let i = 0; i < 240; i++) vm.update(1 / 60, still);
    return vm;
  }
  /** The main camera somewhere in the world, looking somewhere (the game's 75 degree view). */
  function mainCamera(fov = 75) {
    const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 70);
    cam.position.set(12, 1.62, -7);
    cam.rotation.set(-0.2, 2.1, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    return cam;
  }

  it('muzzleWorld is the Muzzle marker of the copy in hand: the centre of the bell\'s mouth, out in front of the grip', () => {
    const vm = held(), main = mainCamera();
    const expected = atHip(rel(M.markers.Muzzle, M.markers.Grip)); // camera space: hip + R(hip angles) * (Muzzle - Grip)
    const got = main.worldToLocal(vm.muzzleWorld(main).clone());
    expect(got.distanceTo(expected)).toBeLessThan(1e-4);
    // ... which is where the held copy's own Muzzle node is
    vm.scene.updateMatrixWorld(true);
    const node = vm.scene.getObjectByName('Muzzle')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(vm.camera.matrixWorldInverse);
    expect(node.distanceTo(expected)).toBeLessThan(1e-4);
    expect(rel(M.markers.Muzzle, M.markers.Grip).length()).toBeGreaterThan(0.7);
    expect(got.z).toBeLessThan(-1); // more than a metre ahead of the eye
    // empty hands: the eye
    vm.setItem(null);
    expect(vm.muzzleWorld(main).distanceTo(main.position)).toBeLessThan(1e-9);
    expect(vm.muzzleDrawnWorld(main).distanceTo(main.position)).toBeLessThan(1e-9);
  });

  it('muzzleDrawnWorld is that point on the screen spot the bell is drawn at (the held view is narrower than the main one), at the same depth', () => {
    const vm = held();
    for (const fov of [75, 60, 90]) {
      const main = mainCamera(fov);
      const plain = main.worldToLocal(vm.muzzleWorld(main).clone()), drawn = main.worldToLocal(vm.muzzleDrawnWorld(main).clone());
      expect(drawn.z).toBeCloseTo(plain.z, 6);
      // same normalized screen position through the main camera as the muzzle has through the viewmodel camera
      const ndcMain = drawn.clone().applyMatrix4(main.projectionMatrix), ndcHeld = plain.clone().applyMatrix4(vm.camera.projectionMatrix);
      expect(ndcMain.x).toBeCloseTo(ndcHeld.x, 5);
      expect(ndcMain.y).toBeCloseTo(ndcHeld.y, 5);
    }
  });

  it('no aimed pose: asked to aim, a stream weapon stays at its hip pose (its Sight marker drives nothing)', () => {
    expect(FLAMETHROWER_DEF.stream).toBeDefined();
    expect(view.aim).toEqual(view.hip);
    const vm = held(), main = mainCamera();
    const hip = vm.muzzleWorld(main).clone();
    for (let i = 0; i < 240; i++) vm.update(1 / 60, {...still, aiming: true});
    expect(vm.muzzleWorld(main).distanceTo(hip)).toBeLessThan(1e-6);
  });

  it('the hip pose follows from the markers: the lance points at the view axis ahead, the bell under the crosshair, the rest out of frame', () => {
    const vm = held();
    const half = Math.tan(THREE.MathUtils.degToRad(vm.camera.fov) / 2), aspect = 16 / 9;
    /** Normalized screen position (x, y in -1 .. 1, +y up) of a viewmodel camera-space point. */
    const ndc = (p: THREE.Vector3) => [p.x / -p.z / half / aspect, p.y / -p.z / half];
    const G = M.markers.Grip, B = M.bounds;
    const grip = atHip(new THREE.Vector3()), muzzle = atHip(rel(M.markers.Muzzle, G)), sight = atHip(rel(M.markers.Sight, G)), fore = atHip(rel(M.markers.Fore, G));
    // the lance (model -Z through the Grip) crosses the view axis 2.5 m ahead of the eye: on screen it runs straight at the crosshair
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(view.hipPitch, view.hipYaw, view.hipRoll));
    const t = (-2.5 - grip.z) / dir.z, cross = grip.clone().addScaledVector(dir, t);
    expect(Math.hypot(cross.x, cross.y)).toBeLessThan(0.005);
    // the bell: a little right of and below the crosshair, never on it
    const m = ndc(muzzle), rim = 0.0625 / -muzzle.z / half;
    expect(m[0]).toBeGreaterThan(0.05);
    expect(m[0]).toBeLessThan(0.3);
    expect(m[1]).toBeGreaterThan(-0.45);
    expect(m[1] + rim).toBeLessThan(-0.08);
    // the valve body's gauge and the front handle's top are in the frame (also on a 4:3 screen); the firing hand's grip is below it
    for (const p of [sight]) { const s = ndc(p); expect(Math.abs(s[0]) * (16 / 9) / (4 / 3)).toBeLessThan(0.9); expect(s[1]).toBeGreaterThan(-0.9); expect(s[1]).toBeLessThan(0); }
    expect(ndc(fore)[1]).toBeGreaterThan(-1);
    expect(ndc(grip)[1]).toBeLessThan(-1);
    // the shoulder rest (every vertex behind the grip sleeve) stays under the bottom edge, and nothing comes near the eye (near plane 0.01 m)
    const pos = (gltf.scene.getObjectByName(ID) as THREE.Mesh).geometry.getAttribute('position'), v = new THREE.Vector3();
    let nearest = Infinity, behind = 0, highest = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const rear = v.z >= G[2] + 0.06, p = atHip(rel([v.x, v.y, v.z], G));
      nearest = Math.min(nearest, -p.z);
      if (rear) { behind++; highest = Math.max(highest, ndc(p)[1]); }
    }
    expect(behind).toBeGreaterThan(500);
    expect(highest).toBeLessThan(-1);
    expect(nearest).toBeGreaterThan(0.15);
    expect(B.max[2] - G[2]).toBeGreaterThan(0.2);
    // ... and the real held view is at that pose once it has settled
    vm.scene.updateMatrixWorld(true);
    const node = (name: string) => vm.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()).applyMatrix4(vm.camera.matrixWorldInverse);
    for (const [name, p] of [['Grip', grip], ['Muzzle', muzzle], ['Sight', sight], ['Fore', fore]] as const) expect(node(name).distanceTo(p), name).toBeLessThan(1e-4);
  });
});
