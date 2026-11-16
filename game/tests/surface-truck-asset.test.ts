// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the cooked Surface Run truck (assets/models/surface-military-truck.glb,
// tools/asset-pipeline/props/build-surface-truck.mjs) — its file facts against the generated anchors and the provenance (nodes, triangle
// budget, bytes, the three PBR maps, grounded / centred extent, wheel hubs, the provenance's source licence note and allowlist hashes),
// and the runtime view built from it in Node (textures stripped: Node has no image decoder): paint outside + a BackSide lining inside the
// cab / bed only, the cab glass material on the panes, the lamp lenses (glow only when on), the eight road wheels on their own nodes
// rolling / steering, the handmade cab and its steering wheel.
import {createHash} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {levelOfAsset} from '../src/assets/levelAssets';
import {cabGlassMaterial} from '../src/world/elevator';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {TRUCK_LAMPS, TRUCK_SPEC, TRUCK_WHEELS} from '../src/world/surface/truckSpec';
import {TRUCK_LENS_SANITY, buildTruckView, inLining, setTruckLamps, setTruckModelForTests, syncTruckView, truckDerived, type TruckView} from '../src/world/surface/truckModel';
import type {CarBody} from '../src/world/skywaysCarPhysics';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const GLB = here('../public/' + TRUCK_SPEC.url);
const PROV = here('../public/assets/derivatives/surface-military-truck.json');
const A = TRUCK_ANCHORS;

async function loadStripped(): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(GLB);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const triCount = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;

let gltf: GLTF;
beforeAll(async () => { gltf = await loadStripped(); });
afterAll(() => setTruckModelForTests(null));

describe('surface truck asset: the cooked file', () => {
  it('a Surface Run asset; nodes body / glass / wheel-0..7; the triangle budget and bytes as cooked; three PBR maps; one required extension', async () => {
    expect(levelOfAsset(TRUCK_SPEC.url)).toBe('surface');
    const bytes = statSync(GLB).size;
    expect(bytes).toBeLessThan(8 * 1024 * 1024);
    const names: string[] = [];
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) names.push(o.name); });
    expect(names.sort()).toEqual(['body', 'glass', ...TRUCK_WHEELS.map((_, i) => `wheel-${i}`)].sort());
    const tri = (n: string) => triCount(gltf.scene.getObjectByName(n) as THREE.Mesh);
    expect(tri('body')).toBe(A.bodyTris);
    expect(tri('glass')).toBe(A.glassTris);
    for (let i = 0; i < 8; i++) expect(tri(`wheel-${i}`)).toBe(A.wheelTris);
    const total = A.bodyTris + A.glassTris + 8 * A.wheelTris;
    expect(total).toBeLessThan(200_000);
    const doc = await new NodeIO().registerExtensions([KHRMeshQuantization]).read(GLB);
    const tex = doc.getRoot().listTextures();
    expect(tex).toHaveLength(3); // (base colour, metallic-roughness, normal: the master's maps re-encoded)
    expect(tex.every(t => t.getMimeType() === 'image/jpeg')).toBe(true);
    expect(doc.getRoot().listExtensionsUsed().map(e => e.extensionName)).toEqual(['KHR_mesh_quantization']);
    const prov = JSON.parse(readFileSync(PROV, 'utf8'));
    expect(prov.output).toMatchObject({url: TRUCK_SPEC.url, bytes, triangles: {total}});
    expect(prov.output.sha256).toBe(createHash('sha256').update(readFileSync(GLB)).digest('hex'));
    expect(prov.source.sha256).toBe('44d12d07e54e49530d74f6e528e40864e0e6e373caa8f93fd772d279e08f6b4a');
    expect(prov.source.licence).toMatch(/NOT verified/); // (no licence invented)
  });

  it('grounded, centred, the measured extent; each wheel node at its hub (its mesh centred on it, the anchors\' radius)', () => {
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeCloseTo(A.height, 2);
    expect(box.max.z - box.min.z).toBeCloseTo(A.length, 2);
    expect(box.max.x - box.min.x).toBeCloseTo(A.width, 2);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 2);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 2);
    TRUCK_WHEELS.forEach((w, i) => {
      const n = gltf.scene.getObjectByName(`wheel-${i}`) as THREE.Mesh;
      expect(n.position.x).toBeCloseTo(w.x, 2);
      expect(n.position.y).toBeCloseTo(w.y, 2);
      expect(n.position.z).toBeCloseTo(w.z, 2);
      n.geometry.computeBoundingBox();
      const b = n.geometry.boundingBox!;
      expect((b.max.y - b.min.y) / 2).toBeCloseTo(w.r, 1);
      expect(Math.abs((b.min.z + b.max.z) / 2)).toBeLessThan(0.05); // (the hub = the contact patch's middle; the tread is not quite round)
      expect(b.min.y + n.position.y).toBeCloseTo(0, 1); // (the tyre on the ground)
    });
  });
});

describe('surface truck asset: the runtime view from the model', () => {
  it('paint FrontSide outside, a BackSide lining of the body\'s own triangles inside the cab / bed only, the cab glass material on the panes', () => {
    setTruckModelForTests(gltf);
    const v = buildTruckView(TRUCK_SPEC) as TruckView;
    expect(v.standIn).toBe(false);
    const meshes: THREE.Mesh[] = [];
    v.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const body = meshes.find(m => m.name === 'body')!, glass = meshes.find(m => m.name === 'glass')!, lining = meshes.find(m => m.name === 'surface-truck-lining')!;
    expect((body.material as THREE.Material).side).toBe(THREE.FrontSide);
    expect(body.userData.carPart).toBe('paint');
    expect(glass.material).toBe(cabGlassMaterial());
    expect(glass.userData.carPart).toBe('glass');
    expect(glass.castShadow).toBe(false);
    expect((lining.material as THREE.Material).side).toBe(THREE.BackSide);
    expect(lining.geometry.getAttribute('position')).toBe(body.geometry.getAttribute('position')); // (shared, never copied)
    const D = truckDerived(gltf);
    expect(D.liningTris).toBeGreaterThan(1000);
    expect(D.liningTris).toBeLessThan(A.bodyTris * 0.6);
    const P = body.geometry.getAttribute('position'), I = lining.geometry.index!;
    for (let t = 0; t < I.count; t += 3 * 97) {
      const c = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(P, I.getX(t + k))).reduce((a, b) => a.add(b)).divideScalar(3);
      expect(inLining(c.x, c.y, c.z)).toBe(true);
    }
  });

  it('the lamp lenses: the body\'s own headlamp triangles, dark until the lamps are on', () => {
    setTruckModelForTests(gltf);
    const v = buildTruckView(TRUCK_SPEC) as TruckView, D = truckDerived(gltf);
    expect(D.lens).not.toBeNull();
    expect(D.lens!.tris).toBeGreaterThanOrEqual(TRUCK_LENS_SANITY.minTris);
    expect(D.lens!.tris).toBeLessThanOrEqual(TRUCK_LENS_SANITY.maxTris);
    expect(v.lens).toBe(D.lens!.material);
    expect(v.lens!.emissiveIntensity).toBe(0);
    setTruckLamps(true, v.lens, null);
    expect(v.lens!.emissiveIntensity).toBe(TRUCK_LAMPS.lens.on);
    setTruckLamps(false, v.lens, null);
    expect(v.lens!.emissiveIntensity).toBe(0);
  });

  it('the eight road wheels are the model\'s own nodes: they roll by the distance, the two front axles steer; the steering wheel turns', () => {
    setTruckModelForTests(gltf);
    const v = buildTruckView(TRUCK_SPEC) as TruckView;
    expect(v.roadWheels.map(n => n.name)).toEqual(TRUCK_WHEELS.map((_, i) => `wheel-${i}`));
    const before = v.roadWheels.map(n => n.position.clone());
    const b = {steer: 0.3} as CarBody;
    syncTruckView(v, b, 1 / 60, 0.5);
    syncTruckView(v, b, 1 / 60, 0.5);
    v.roadWheels.forEach((n, i) => {
      expect(n.position.distanceTo(before[i])).toBe(0); // (they turn about their hubs; they never move)
      expect(n.rotation.x).toBeCloseTo(-1 / TRUCK_WHEELS[i].r, 9);
      const w = TRUCK_WHEELS[i];
      expect(n.rotation.y).toBeCloseTo(w.steer ? Math.atan(w.steer * Math.tan(0.3)) : 0, 9);
    });
    expect(v.wheel!.rotation.z).toBeGreaterThan(0);
    // reversing rolls them back
    syncTruckView(v, b, 1 / 60, -1);
    for (const n of v.roadWheels) expect(n.rotation.x).toBeCloseTo(0, 9);
    expect(v.cockpit.getObjectByName('surface-truck-steering-spin')).toBe(v.wheel);
  });
});
