// Task studio-flamethrower-fire-20261114-031614-01 (lane ASSET): the Fuel Tank gear item's cooked model.
//  - the shipped file: its bytes are the provenance's and the release allowlist's; one mesh, one material, its own three PBR maps
//    (1024 / 512 / 1024 JPEG), no source names, hash-only provenance, a credits section;
//  - the gear convention: metres at real size, upright (0.62 m: the frame's top is the highest point), origin bottom-centre (resting on
//    y = 0, centred on x / z), the jerrycan toward -Z in the file; its bounds are the item's resting size (items/gear.ts GEAR_DIMS);
//  - registered as a gear model (gear/models.ts GEAR_MODEL_URL): the item template is the model at scale 1 turned to +Z, on the floor —
//    what the ground pickup, the stall display and the 3D icon show; a stand-in only while the file is missing.
// The model is the REAL cooked GLB (textures stripped for three: Node has no image decoder). No browser, no git history.
import {beforeAll, describe, expect, it} from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ImageUtils, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {FUEL_TANK_ID} from '../src/fire/flamethrowerSpec';
import {GEAR_ASSET, GEAR_MODEL_URL, gearIconView, gearItemModel, gearModelSource, registerGearModel} from '../src/gear/models';
import {GEAR_DIMS, GEAR_IDS, GEAR_ITEMS} from '../src/items/gear';
import {ITEMS, itemDims} from '../src/items/items';
import {isLazyModelWeapon} from '../src/weapons/lazyWeaponModels';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../public');
const REPO = path.resolve(HERE, '../..');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const ID = FUEL_TANK_ID;
const URL_REL = 'assets/models/gear-fuel-tank.glb', PROV_REL = 'assets/derivatives/gear-fuel-tank.json';
const file = path.join(PUBLIC, URL_REL);
const prov = JSON.parse(fs.readFileSync(path.join(PUBLIC, PROV_REL), 'utf8'));
const H_M = 0.62;

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

/** The file's vertex bounds, and the bounds of its vertices inside a y band. */
function measure(y0 = -Infinity, y1 = Infinity) {
  const pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION')!, v = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    if (v[1] < y0 || v[1] > y1) continue;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  }
  return {min, max, size: [0, 1, 2].map(k => max[k] - min[k])};
}

describe('the Fuel Tank: the cooked file', () => {
  it('its bytes are the provenance\'s and the allowlist\'s; the provenance is hash-only; the credits name it', () => {
    const glb = fs.readFileSync(file), provBytes = fs.readFileSync(path.join(PUBLIC, PROV_REL));
    expect([prov.output.url, prov.output.bytes, prov.output.sha256]).toEqual([URL_REL, glb.length, sha(glb)]);
    const allow = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8')).files as {path: string; bytes: number; sha256: string}[];
    const entry = (p: string) => allow.find(f => f.path === p);
    expect(entry(URL_REL)).toEqual({path: URL_REL, bytes: glb.length, sha256: sha(glb)});
    expect(entry(PROV_REL)).toEqual({path: PROV_REL, bytes: provBytes.length, sha256: sha(provBytes)});
    const credits = fs.readFileSync(path.join(PUBLIC, 'assets/CREDITS.md'));
    expect(entry('assets/CREDITS.md')).toEqual({path: 'assets/CREDITS.md', bytes: credits.length, sha256: sha(credits)});
    const section = /<!-- BEGIN flamethrower-fuel-tank-model-20261114 [^>]*-->([\s\S]*?)<!-- END flamethrower-fuel-tank-model-20261114 -->/.exec(credits.toString())?.[1] ?? '';
    for (const text of [URL_REL, PROV_REL, 'tools/asset-pipeline/props/build-fuel-tank.mjs', prov.meshy.task, 'no licence or commercial clearance implied']) expect(section, text).toContain(text);
    // hashes and measurements only: no address, private path, generation text or source file name
    expect(provBytes.toString()).not.toMatch(/https?:|Signature|X-Amz|token=|reference\/|\/workspace|\/home\/|portal|prompt|_texture\.glb/i);
    expect([prov.schema, prov.id, prov.item, prov.task]).toEqual(['terminal-state-derivative-v1', 'gear-fuel-tank', `${ID} (items/gear.ts)`, 'studio-flamethrower-fire-20261114-031614-01']);
    expect(prov.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.conditioningImage.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect([prov.meshy.request.ai_model, prov.meshy.request.model_type, prov.meshy.billedCredits]).toEqual(['meshy-t2.5', 'smart-topology', 15]);
  });

  it('one mesh, one material with the model\'s own three maps (1024 / 512 / 1024 JPEG), every triangle kept, no source names', () => {
    const root = doc.getRoot();
    expect([root.listNodes().length, root.listMeshes().length, root.listMaterials().length, root.listTextures().length]).toEqual([1, 1, 1, 3]);
    const mat = root.listMaterials()[0];
    const size = (t: ReturnType<typeof mat.getBaseColorTexture>) => [ImageUtils.getSize(t!.getImage()!, t!.getMimeType()), t!.getMimeType()];
    expect([size(mat.getBaseColorTexture()), size(mat.getMetallicRoughnessTexture()), size(mat.getNormalTexture())])
      .toEqual([[[1024, 1024], 'image/jpeg'], [[512, 512], 'image/jpeg'], [[1024, 1024], 'image/jpeg']]);
    const recs = prov.textures as {slot: string; source: {size: number[]}; size: number[]}[];
    expect(recs.map(t => [t.slot, t.source.size[0], t.size[0]])).toEqual([['baseColor', 2048, 1024], ['metallicRoughness', 2048, 512], ['normal', 2048, 1024]]);
    const prim = root.listMeshes()[0].listPrimitives()[0];
    expect(prim.getIndices()!.getCount() / 3).toBe(prov.source.triangles); // no simplification, no repair
    expect([prov.output.triangles, prov.processing.ops]).toEqual([prov.source.triangles, []]);
    const names = [...root.listNodes(), ...root.listMeshes(), ...root.listScenes(), ...root.listMaterials(), ...root.listTextures()].map(o => o.getName());
    for (const n of names) expect(n).toMatch(/^gear-fuel-tank(-[A-Za-z]+)?$/);
    const glb = fs.readFileSync(file), json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
    expect(json.asset.generator).toBe('Terminal State tools/asset-pipeline/props/build-fuel-tank.mjs (glTF-Transform)');
    expect(glb.length).toBeLessThan(1.5e6);
  });

  it('the gear convention: real size, upright, origin bottom-centre, the jerrycan toward -Z; its bounds are the item\'s resting size', () => {
    const b = measure();
    expect(b.size[1]).toBeCloseTo(H_M, 3);
    expect(Math.abs(b.min[1])).toBeLessThan(1e-4); // resting on y = 0
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(1e-3); // centred on x / z
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(1e-3);
    expect(b.size.map(x => +x.toFixed(4))).toEqual(prov.output.dims);
    // upright: taller than it is wide or deep, and the pack frame carries the top
    expect(b.size[1]).toBeGreaterThan(b.size[0]);
    expect(b.size[1]).toBeGreaterThan(b.size[2]);
    expect(prov.measured.frame.bounds.max[1]).toBeCloseTo(H_M, 3);
    // front = -Z: above the belt the shoulder straps loop out behind the frame (+Z) farther than the can stands out in front of it
    const upper = measure(0.3, H_M);
    expect(upper.max[2]).toBeGreaterThan(0.15);
    expect(-upper.min[2]).toBeLessThan(0.14);
    expect(upper.max[2]).toBeGreaterThan(-upper.min[2] + 0.03);
    const can = prov.measured.jerrycan.bounds;
    expect((can.min[2] + can.max[2]) / 2).toBeLessThan(0); // the can sits on the -Z side of the model's centre
    // the item's resting size is these bounds (to the centimetre)
    const d = GEAR_DIMS[ID];
    expect([d.w, d.h, d.d, d.shape]).toEqual([+b.size[0].toFixed(2), +b.size[1].toFixed(2), +b.size[2].toFixed(2), 'box']);
    expect(itemDims(ID)).toEqual(d);
    // a pack frame the height of a torso carrying a slim can: the can's real size, the feet the belt keeps off the floor
    const cs = prov.measured.jerrycan.size as number[];
    expect(cs[0]).toBeGreaterThan(0.2); expect(cs[0]).toBeLessThan(0.3);
    expect(cs[1]).toBeGreaterThan(0.35); expect(cs[1]).toBeLessThan(0.5);
    expect(prov.measured.frameFeetAboveFloorM).toBeCloseTo(prov.measured.frame.bounds.min[1], 6);
    expect(prov.measured.frameFeetAboveFloorM).toBeLessThan(0.08); // (recorded: the hanging belt is the model's lowest part)
  });
});

describe('the Fuel Tank: a registered gear model', () => {
  it('a gear item with its own model file (not the office registry, not a lazily delivered weapon model)', () => {
    expect(GEAR_IDS).toContain(ID);
    expect([ITEMS[ID]?.kind, GEAR_ITEMS[ID]?.gear?.slot]).toEqual(['gear', 'backpack']);
    expect([GEAR_MODEL_URL[ID], GEAR_ASSET[ID], isLazyModelWeapon(ID)]).toEqual([URL_REL, undefined, false]);
    expect(fs.existsSync(path.join(PUBLIC, GEAR_MODEL_URL[ID]))).toBe(true);
    expect(gearIconView(ID)).toEqual(gearIconView('airtank_backpack')); // the upright packs' front three-quarter view
  });

  it('the item template is the model at scale 1, turned to +Z, standing on the floor at its resting size; a stand-in only without the file', () => {
    const standIn = new THREE.Box3().setFromObject(gearItemModel(ID));
    expect(gearModelSource(ID)).toMatch(/procedural/);
    expect(standIn.min.y).toBeGreaterThanOrEqual(-0.005);
    expect(standIn.max.y).toBeLessThan(0.7);
    expect(standIn.max.y).toBeGreaterThan(0.5); // (its own stand-in, not the grey default cube)
    registerGearModel(ID, gltf);
    try {
      const t = gearItemModel(ID);
      t.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(t), size = box.getSize(new THREE.Vector3()), d = GEAR_DIMS[ID];
      expect([+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)]).toEqual([d.w, d.h, d.d]);
      expect(size.y).toBeCloseTo(H_M, 3); // real size kept (never refitted)
      expect(Math.abs(box.min.y)).toBeLessThan(1e-4);
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(2e-3);
      expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(2e-3);
      // at runtime the can faces +Z (the item front): in the upper part the straps reach farther back (-Z) than the can comes forward
      let found: THREE.Mesh | null = null;
      t.traverse(o => { if ((o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
      const mesh = found as unknown as THREE.Mesh, pos = mesh.geometry.getAttribute('position'), v = new THREE.Vector3();
      let front = -Infinity, back = Infinity, tris = 0;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); if (v.y > 0.3) { front = Math.max(front, v.z); back = Math.min(back, v.z); } }
      t.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { tris += m.geometry.index!.count / 3; expect([m.castShadow, m.receiveShadow]).toEqual([false, true]); } });
      expect(-back).toBeGreaterThan(front + 0.03);
      expect(tris).toBe(prov.output.triangles);
      expect(gearModelSource(ID)).toBe(`${URL_REL} (Meshy T2.5 image-to-3D derivative)`);
    } finally {
      registerGearModel(ID, null);
    }
    expect(gearModelSource(ID)).toMatch(/procedural/);
  });
});
