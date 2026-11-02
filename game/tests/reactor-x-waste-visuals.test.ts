// Task reactor-expansion-20261101 (lane WASTE): the waste repository's runtime look (world/reactor/wasteVisuals.ts) on a REAL generated
// Reactor layout, in Node: the decor record becomes a bounded set of tagged InstancedMeshes over the Reactor's kit materials; loaded
// models (a stand-in GLTF here) are instanced per mesh at real size; missing models fall back to procedural stand-ins; the lazy model
// keys / files reference the lead's REACTOR_X_KIT waste set. No browser.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {generateReactorLevel} from '../src/gen/reactor/index';
import {buildWasteVisuals} from '../src/world/reactor/wasteVisuals';
import {WASTE_MODEL_FILES, WASTE_MODELS, wasteModelKeysFor} from '../src/world/reactor/wasteAssets';
import {REACTOR_X_KIT} from '../src/assets/reactorExpansionKit.generated';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const L = generateReactorLevel({levelSeed: 3});

const fakeGltf = (w: number, h: number, d: number): GLTF => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), new THREE.MeshStandardMaterial());
  scene.add(mesh);
  return {scene} as unknown as GLTF;
};

describe('Reactor waste repository (lane WASTE): runtime visuals', () => {
  it('references the lead\'s waste models (keys / files) for a layout with a repository, none without', () => {
    const keys = wasteModelKeysFor(L);
    for (const p of ['wasteDrum', 'storageCask'] as const) expect(keys).toContain(REACTOR_X_KIT[p].key);
    for (const p of ['wasteDrum', 'storageCask', 'deconShower', 'hotCellWindow'] as const) expect(WASTE_MODEL_FILES[REACTOR_X_KIT[p].key]?.url).toBe(REACTOR_X_KIT[p].url);
    expect(wasteModelKeysFor({})).toEqual([]);
  });

  it('builds procedural stand-ins without models: bounded, tagged, finite', () => {
    const g = new THREE.Group();
    const st = buildWasteVisuals(g, L, mats(), {})!;
    expect(st).toBeTruthy();
    expect(st.meshes).toBe(g.children.length);
    expect(st.meshes).toBeGreaterThan(5);
    expect(st.meshes).toBeLessThan(160);
    expect(st.procedural.wasteDrum).toBe(L.reactorWaste!.models.filter(m => m.piece === 'wasteDrum').length);
    const lv = L.reactorWaste!.level;
    const m = new THREE.Matrix4();
    for (const o of g.children) {
      const im = o as THREE.InstancedMesh;
      expect(im.userData.levels).toEqual([lv]);
      expect(im.matrixAutoUpdate).toBe(false);
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); expect(m.elements.every(Number.isFinite)).toBe(true); }
      expect(im.boundingSphere!.radius).toBeLessThan(40);
    }
    // inside the complex's bounds (+ the entrance frame's beacons over the landing edge)
    const b = L.reactorWaste!.bounds, box = new THREE.Box3().setFromObject(g);
    expect(box.min.x).toBeGreaterThan(b.x0 - 4); expect(box.max.x).toBeLessThan(b.x1 + 4);
    expect(box.min.z).toBeGreaterThan(b.z0 - 4); expect(box.max.z).toBeLessThan(b.z1 + 4);
  });

  it('instances loaded models at their placements (one InstancedMesh per model mesh and chunk), real size', () => {
    const models: Record<string, GLTF> = {};
    for (const k of Object.values(WASTE_MODELS)) models[k.key] = fakeGltf(k.dims[0], k.dims[1], k.dims[2]);
    const g = new THREE.Group();
    const st = buildWasteVisuals(g, L, mats(), models)!;
    const D = L.reactorWaste!;
    expect(st.models.wasteDrum).toBe(D.models.filter(m => m.piece === 'wasteDrum').length);
    expect(st.models.storageCask).toBe(D.models.filter(m => m.piece === 'storageCask').length);
    expect(st.models.fanHousing ?? 0).toBe(D.fans.length);
    expect(Object.keys(st.procedural).length).toBe(0);
    const drums = g.children.filter(o => o.name.startsWith('reactor-waste-model-wasteDrum')) as THREE.InstancedMesh[];
    expect(drums.reduce((s, q) => s + q.count, 0)).toBe(st.models.wasteDrum);
    // a cask's instance sits on the complex floor at real size
    const cask = g.children.find(o => o.name.startsWith('reactor-waste-model-storageCask')) as THREE.InstancedMesh;
    cask.computeBoundingBox();
    expect(cask.boundingBox!.max.y - cask.boundingBox!.min.y).toBeCloseTo(REACTOR_X_KIT.storageCask.dims[1], 1);
    expect(cask.boundingBox!.min.y).toBeCloseTo(L.levels[D.level].baseY, 2);
    expect(st.meshes).toBeLessThan(200);
  });
});
