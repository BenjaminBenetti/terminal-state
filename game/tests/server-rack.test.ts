// Task office-props-physics-scale-20261030 (lane RACK): the rebuilt server rack (office-server-rack-r2.glb, a LOCAL procedural rebuild,
// tools/asset-pipeline/props/build-server-rack-r2.mjs). User (#5): "Server rack model is messed up, the servers are missing or like its
// kinda just broken glass? ... it does kinda look like triangles going all wonk. There should be a mesh door you can look through, you
// should see distinct hardware in the rack, and some empty spots where loot might spawn."
//
// Covers: the file (materials: see-through BLEND perforated door, LED emissive atlas with blink classes, consistent winding, real-rack
// size), the runtime split (the door = exactly the door geometry, no cut faces; hinge on its right edge; the equipment stays in the
// body), the empty bays (every loot surface rests on a modelled shelf with its clearance free, inside the rails and the cavity), the
// blinking-LED material swap (world/rackLeds.ts) and the kind's footprint / placement data.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped, rowLayout} from './helpers/openablesFixture';
import {OFFICE_LOCAL_MODELS} from '../src/assets/officeAssets';
import {OFFICE_KIND_ASSET, OFFICE_PROP_DEFS, officeModelKey} from '../src/gen/office/kinds';
import {PROP_DEFS} from '../src/gen/props';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {fittedMeshes} from '../src/world/meshSplit';
import {OPENABLE_AUDIT, openableSpec} from '../src/world/openablesSpec';
import {RACK_LED_MATERIAL, rackLedMaterial} from '../src/world/rackLeds';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const RACK = OFFICE_LOCAL_MODELS['server-rack-r2'];
const KEY = officeModelKey('server-rack-r2');
const spec = openableSpec('serverRack')!;
const part = spec.parts[0];
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
let gltf: GLTF;
beforeAll(async () => { gltf = await loadStripped(RACK.url); }, 60000);

describe('the file: a real 42U rack, see-through door, LED atlas', () => {
  it('materials, size, winding, budget', async () => {
    const doc = await new NodeIO().read(path.join(PUB, RACK.url));
    const byName = new Map(doc.getRoot().listMaterials().map(m => [m.getName(), m]));
    expect([...byName.keys()].sort()).toEqual(['rack-back-mesh', 'rack-body', RACK_LED_MATERIAL, 'rack-door-mesh'].sort());
    // the front door insert is a see-through perforated sheet (blended, both sides), never an opaque slab
    expect(byName.get('rack-door-mesh')!.getAlphaMode()).toBe('BLEND');
    expect(byName.get('rack-door-mesh')!.getDoubleSided()).toBe(true);
    for (const n of ['rack-body', RACK_LED_MATERIAL, 'rack-back-mesh']) expect(byName.get(n)!.getAlphaMode(), n).toBe('OPAQUE');
    expect(byName.get(RACK_LED_MATERIAL)!.getEmissiveTexture()).toBeTruthy();
    // ~64 % of the perforated tile is open (alpha 0)
    const perf = await sharp(Buffer.from(byName.get('rack-door-mesh')!.getBaseColorTexture()!.getImage()!)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    let open = 0;
    for (let i = 3; i < perf.data.length; i += 4) if (perf.data[i] < 8) open++;
    expect(open / (perf.info.width * perf.info.height)).toBeGreaterThan(0.55);
    expect(open / (perf.info.width * perf.info.height)).toBeLessThan(0.72);
    // the LED atlas: a few hundred restrained dots, each with a blink class in alpha (steady / activity / heartbeat)
    const leds = await sharp(Buffer.from(byName.get(RACK_LED_MATERIAL)!.getEmissiveTexture()!.getImage()!)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    const classes = new Set<number>();
    let lit = 0;
    for (let i = 0; i < leds.data.length; i += 4) if (leds.data[i] + leds.data[i + 1] + leds.data[i + 2] > 120) { lit++; classes.add(leds.data[i + 3]); }
    expect([...classes].sort((a, b) => a - b)).toEqual(expect.arrayContaining([85, 170, 255]));
    expect(lit / (leds.info.width * leds.info.height)).toBeLessThan(0.05); // dots, not panels
    // consistent outward winding: every triangle's geometric normal agrees with its vertex normals
    let tris = 0, bad = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION')!, nrm = p.getAttribute('NORMAL')!, idx = p.getIndices()!;
      const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], n = [0, 0, 0];
      for (let i = 0; i < idx.getCount(); i += 3) {
        const [ia, ib, ic] = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
        pos.getElement(ia, a); pos.getElement(ib, b); pos.getElement(ic, c); nrm.getElement(ia, n);
        const g = new THREE.Vector3().crossVectors(new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
        if (g.lengthSq() < 1e-14) continue;
        tris++;
        if (g.normalize().dot(new THREE.Vector3(n[0], n[1], n[2])) < 0.5) bad++;
      }
    }
    expect(tris).toBeGreaterThan(2000);
    expect(bad).toBe(0);
    expect(RACK.tris).toBeLessThanOrEqual(4000);
  });

  it('the kind renders the rebuild at its real size (0.6 x 2.0 x 1.0 m, 1:1 fit), classified as an openable rack', () => {
    expect(OFFICE_KIND_ASSET.serverRack).toBe('server-rack-r2');
    expect(spec.model).toBe(KEY);
    expect([OFFICE_PROP_DEFS.serverRack.w, OFFICE_PROP_DEFS.serverRack.h, OFFICE_PROP_DEFS.serverRack.d]).toEqual([...RACK.dims.slice(0, 1), RACK.dims[1], RACK.dims[2]]);
    expect(PROP_DEFS.serverRack).toMatchObject({w: 0.6, h: 2, d: 1});
    expect(OPENABLE_AUDIT.find(e => e.kind === 'serverRack')).toMatchObject({cls: 'openable', role: 'storage'});
    expect(OPENABLE_AUDIT.find(e => e.kind === 'serverRack')!.how).toMatch(/perforated/);
  });
});

describe('the runtime split: door, hinge, equipment, empty bays', () => {
  const build = () => {
    const cm = new ContainerManager({[KEY]: gltf}, mats, () => new Inventory());
    cm.build(rowLayout(['serverRack'], {back: 3.5, seed: 5}));
    return cm.openList.find(h => h.kind === 'serverRack')!;
  };

  it('the door is exactly the door: whole triangles, its own materials, hinged on its right edge, swings clear of the carcass', () => {
    const h = build();
    const pm = h.open!.model.parts[0];
    expect(h.open!.model.source).toMatch(/runtime split/);
    expect(h.open!.model.source).not.toMatch(/dropped/); // nothing left in the opening to drop
    // door + its handle (faceplate swatches) + hinges; the perforated insert never stays in the body
    expect(pm.moving.map(q => (q.mat as THREE.Material).name).sort()).toEqual(['rack-body', 'rack-door-mesh', `${RACK_LED_MATERIAL}`].sort());
    expect(h.open!.model.body.some(q => (q.mat as THREE.Material).name === 'rack-door-mesh')).toBe(false);
    const b = pm.bounds;
    expect(b.min.x).toBeCloseTo(-0.298, 2); expect(b.max.x).toBeCloseTo(0.3, 2);
    expect(b.min.y).toBeCloseTo(0.075, 2); expect(b.max.y).toBeCloseTo(1.992, 2);
    expect(b.min.z).toBeGreaterThan(0.466); expect(b.max.z).toBeLessThanOrEqual(0.5 + 1e-6);
    // no triangle of the file was cut by the region box (exact cut planes only touch the door)
    const fileDoorTris = fittedMeshes(gltf, 0.6, 2, 1, true).reduce((n, {soup}) => {
      const P = soup.attrs.find(a => a.name === 'position')!.offset, s = soup.stride;
      for (let i = 0; i < soup.data.length; i += 3 * s) {
        const cz = (soup.data[i + P + 2] + soup.data[i + s + P + 2] + soup.data[i + 2 * s + P + 2]) / 3;
        if (cz > 0.466) n++;
      }
      return n;
    }, 0);
    expect(pm.moving.reduce((n, q) => n + q.geo.attributes.position.count / 3, 0)).toBe(fileDoorTris);
    // hinge line on the door's right edge, inside its thickness
    const mv = part.move as {pivot: readonly number[]; angle: number};
    expect(mv.pivot[0]).toBeGreaterThan(b.max.x - 0.012); expect(mv.pivot[0]).toBeLessThan(b.max.x);
    expect(mv.pivot[2]).toBeGreaterThan(b.min.z); expect(mv.pivot[2]).toBeLessThan(b.max.z);
    expect(mv.angle).toBeGreaterThan(0); // a right-hand hinge swings the free (left) edge out toward +Z
    // fully open (100 deg) the leaf stands out to the right of the hinge, in front of the rack: never inside the carcass (x < 0.285)
    const rot = new THREE.Matrix4().makeRotationY(mv.angle), piv = new THREE.Vector3(mv.pivot[0], mv.pivot[1], mv.pivot[2]);
    for (const s of pm.sweep) {
      const p = s.clone().applyMatrix4(rot).add(piv);
      expect(p.z, 'in front of the frame').toBeGreaterThan(0.44);
      expect(Math.hypot(p.x - piv.x, p.z - piv.z)).toBeLessThan(0.62);
    }
  });

  it('every loot surface rests on a modelled shelf (no floating loot), its clearance is free, inside the rails and the cavity', () => {
    expect(part.modelInterior && part.cavityHidden && part.glass).toBe(true);
    expect(part.surfaces.length).toBe(3);
    const meshes = fittedMeshes(gltf, 0.6, 2, 1, true).map(({soup, mat}) => {
      const g = new THREE.BufferGeometry();
      const P = soup.attrs.find(a => a.name === 'position')!.offset, n = soup.data.length / soup.stride;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = soup.data[i * soup.stride + P + k];
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
      m.name = (mat as THREE.Material).name;
      return m;
    });
    const rc = new THREE.Raycaster();
    const cav = part.cavity!;
    for (const s of part.surfaces) {
      expect(s.x0).toBeGreaterThan(-0.2255); expect(s.x1).toBeLessThan(0.2255); // between the 19-inch rails
      expect(s.z0).toBeGreaterThan(cav[2]); expect(s.z1).toBeLessThan(cav[5]);
      expect(s.y).toBeGreaterThan(cav[1]); expect(s.y + s.clear).toBeLessThan(cav[4]);
      for (const x of [s.x0, 0, s.x1]) for (const z of [s.z0, (s.z0 + s.z1) / 2, s.z1]) {
        rc.set(new THREE.Vector3(x, s.y + 0.02, z), new THREE.Vector3(0, -1, 0));
        rc.far = 0.05;
        const down = rc.intersectObjects(meshes, false)[0];
        expect(down, `shelf under (${x}, ${s.y}, ${z})`).toBeTruthy();
        expect(down.point.y).toBeCloseTo(s.y, 3);
        expect(down.object.name).toBe('rack-body');
        rc.set(new THREE.Vector3(x, s.y + 0.002, z), new THREE.Vector3(0, 1, 0));
        rc.far = 2;
        const up = rc.intersectObjects(meshes, false)[0];
        expect(up.point.y - s.y, `clearance above (${x}, ${s.y}, ${z})`).toBeGreaterThanOrEqual(s.clear);
      }
    }
  });

  it('the door opens fully in a free aisle and closes; the finite lots on the shelves never change', () => {
    const cm = new ContainerManager({[KEY]: gltf}, mats, () => new Inventory());
    cm.build(rowLayout(['serverRack', 'serverRack', 'serverRack'], {back: 3.5, seed: 5}));
    const settle = (s: number) => { for (let t = 0; t < s; t += 1 / 60) cm.update(1 / 60, t); };
    for (const h of cm.openList) {
      expect(h.surfaces.filter(s => s.part === 0).length).toBe(3);
      const before = JSON.stringify(h.state.lots);
      h.state.parts![0] = true;
      settle(0.7);
      const ps = h.open!.parts[0];
      expect(ps.t).toBe(1);
      expect(ps.amount).toBeGreaterThan((part.move as {angle: number}).angle * 0.8);
      h.state.parts![0] = false;
      settle(0.6);
      expect(h.open!.parts[0].t).toBe(0);
      expect(JSON.stringify(h.state.lots)).toBe(before);
    }
  });
});

describe('blinking LEDs (world/rackLeds.ts)', () => {
  it('the faceplate material becomes ONE cached node material with a time-driven emissive; every other material is untouched', () => {
    const src = new THREE.MeshStandardMaterial({name: RACK_LED_MATERIAL, emissiveMap: new THREE.Texture(), map: new THREE.Texture(), roughness: 0.55, metalness: 0.25});
    const a = rackLedMaterial(src), b = rackLedMaterial(src);
    expect(a).toBe(b);
    expect(a).not.toBe(src);
    expect((a as MeshStandardNodeMaterial).isNodeMaterial).toBe(true);
    expect((a as MeshStandardNodeMaterial).emissiveNode).toBeTruthy();
    expect((a as MeshStandardNodeMaterial).map).toBe(src.map);
    expect((a as MeshStandardNodeMaterial).roughness).toBe(0.55);
    const other = new THREE.MeshStandardMaterial({name: 'rack-body'});
    expect(rackLedMaterial(other)).toBe(other);
    // no texture (node tests strip them): left as it is
    const bare = new THREE.MeshStandardMaterial({name: RACK_LED_MATERIAL});
    expect(rackLedMaterial(bare)).toBe(bare);
    // the builder hook is in place: the split uses the swapped material for the body / door parts
    expect(fs.readFileSync(path.resolve(PUB, '../src/world/openables.ts'), 'utf8')).toMatch(/rackLedMaterial\(srcMat\)/);
  });
});
