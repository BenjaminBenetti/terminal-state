import {afterAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {SURFACE_TRUCK_SPEC} from '../src/world/surfaceTruckSpec';
import {buildCarView, setRoadWheels, setSkywaysCarModelsForTests} from '../src/world/skywaysCarModel';

const pub = (path: string) => fileURLToPath(new URL('../public/' + path, import.meta.url));
const bytes = readFileSync(pub('assets/models/surface-military-truck.glb'));
const provenance = JSON.parse(readFileSync(pub('assets/derivatives/surface-military-truck.json'), 'utf8'));
const doc = await new NodeIO().readBinary(bytes), root = doc.getRoot();
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function cast(yaw: number, pitch = 0) {
  const E = SURFACE_TRUCK_SPEC.eye, angle = yaw * Math.PI / 180, up = pitch * Math.PI / 180;
  const origin = new THREE.Vector3(E.x, E.y, E.z), dir = new THREE.Vector3(-Math.sin(angle) * Math.cos(up), Math.sin(up), -Math.cos(angle) * Math.cos(up));
  const ray = new THREE.Ray(origin, dir), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  let best = {part: 'none', distance: Infinity, point: [] as number[]};
  for (const name of ['surface-truck-body', 'surface-truck-glass']) {
    const node = root.listNodes().find(n => n.getName() === name)!, primitive = node.getMesh()!.listPrimitives()[0];
    const P = primitive.getAttribute('POSITION')!.getArray()!, I = primitive.getIndices()!.getArray()!;
    for (let i = 0; i < I.length; i += 3) {
      a.fromArray(P, I[i] * 3); b.fromArray(P, I[i + 1] * 3); c.fromArray(P, I[i + 2] * 3);
      if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
      const distance = hit.distanceTo(origin);
      if (distance > 0.001 && distance < best.distance) best = {part: name, distance, point: hit.toArray()};
    }
  }
  return best;
}

describe('supplied military truck runtime derivative', () => {
  it('keeps the private master out of runtime and retains all three authored PBR channels', () => {
    expect(provenance.master).toMatchObject({bytes: 144978172, sha256: '44d12d07e54e49530d74f6e528e40864e0e6e373caa8f93fd772d279e08f6b4a', private: true, immutable: true, notInGitCiRuntime: true});
    expect(bytes.length).toBe(provenance.output.bytes); expect(sha(bytes)).toBe(provenance.output.sha256);
    expect(provenance.derivative.triangles).toBeLessThan(150000); expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
    const painted = root.listMaterials().find(m => m.getName() !== 'glass')!;
    expect(painted.getBaseColorTexture()).not.toBeNull(); expect(painted.getNormalTexture()).not.toBeNull(); expect(painted.getMetallicRoughnessTexture()).not.toBeNull();
    expect(root.listTextures().map(t => sha(t.getImage()!))).toEqual(provenance.derivative.textureHashes);
  });
  it('the real seated eye sees through separate glass forward and through both side windows', () => {
    const report = [[0, 0], [15, 0], [-15, 0], [0, 10], [0, -10], [90, 0], [-90, 0]].map(([yaw, pitch]) => ({yaw, pitch, ...cast(yaw, pitch)}));
    expect(report.filter(r => r.part !== 'surface-truck-glass')).toEqual([]);
  });
  it('all eight wheel partitions turn at their real pivots with the same arcade controller inputs', () => {
    const scene = new THREE.Group();
    for (const node of root.listNodes()) {
      if (!node.getMesh()) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial());
      mesh.name = node.getName(); mesh.position.fromArray(node.getTranslation()); scene.add(mesh);
    }
    setSkywaysCarModelsForTests({car: {scene, animations: []} as unknown as GLTF, dash: null, seat: null});
    const view = buildCarView(SURFACE_TRUCK_SPEC); expect(view.roadWheels).toHaveLength(8);
    expect(view.cockpit.getObjectByName('surface-truck-cab-roof')).toBeDefined();
    setRoadWheels(view, 0.3, 0.52);
    expect(view.roadWheels!.slice(0, 4).map(w => w.steer.rotation.y)).toEqual([0.3, 0.3, 0.3, 0.3]);
    expect(view.roadWheels!.slice(4).map(w => w.steer.rotation.y)).toEqual([0, 0, 0, 0]);
    expect(view.roadWheels!.map(w => w.roll.rotation.x)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
  });
});
afterAll(() => setSkywaysCarModelsForTests({car: null, dash: null, seat: null}));
