// Task reactor-expansion-20261101 (lane BUNKER): the bunker's hero-prop renderer (world/reactor/bunkerModels.ts) in Node with stand-in
// GLTFs: one instanced mesh per model mesh and storey on the props' transforms (the blast door from its leaf anchor), nothing for a
// model the library did not load, the lazy keys a layout needs, and every REACTOR_X_KIT file served by the Reactor's library map.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {buildBunkerModels, bunkerModelOrigin} from '../src/world/reactor/bunkerModels';
import {BLAST_LEAF, BUNKER_MODELS, bunkerModelKeysFor} from '../src/gen/reactor/complex/bunkerKinds';
import {REACTOR_MODEL_FILES} from '../src/world/reactor/archAssets';
import {REACTOR_X_KIT} from '../src/assets/reactorExpansionKit.generated';
import type {PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';

const fakeGltf = (dims: readonly number[]): GLTF => {
  const scene = new THREE.Group();
  const geo = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
  geo.translate(0, dims[1] / 2, 0);
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
  return {scene} as unknown as GLTF;
};
const prop = (kind: PropPlacement['kind'], x: number, z: number, rot: number, variant = 0, level = 1): PropPlacement =>
  ({kind, x, z, y: -6, rot, area: 0, hx: 1, hz: 1, h: 1, blocksSight: false, variant, level});

describe('bunker hero models (lane BUNKER)', () => {
  it('instances each model on its placements per storey; the blast door from its leaf anchor only', () => {
    const props = [prop('bunkBed', 3, 4, Math.PI / 2), prop('bunkBed', 5, 4, Math.PI / 2), prop('radioConsole', 9, 2, 0), prop('blastDoor', 20, 10, Math.PI, 0), prop('blastDoor', 18, 11, 0, 1)];
    const layout = {props} as unknown as StationLayout;
    const models = Object.fromEntries(Object.values(BUNKER_MODELS).map(m => [m.model.key, fakeGltf(m.model.dims)]));
    const g = new THREE.Group();
    const st = buildBunkerModels(g, layout, models);
    expect(st.instances).toBe(4);
    expect(st.missing).toEqual([]);
    const ims = g.children as THREE.InstancedMesh[];
    expect(ims.map(m => m.name).sort()).toEqual(['reactor-bunker-blastDoor', 'reactor-bunker-bunkBed', 'reactor-bunker-radioConsole']);
    for (const m of ims) expect(m.userData.level).toBe(1);
    const bed = ims.find(m => m.name.endsWith('bunkBed'))!, mat = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    bed.getMatrixAt(1, mat); mat.decompose(p, q, s);
    expect([p.x, p.y, p.z].map(v => +v.toFixed(3))).toEqual([5, -6, 4]);
    const radio = ims.find(m => m.name.endsWith('radioConsole'))!;
    radio.getMatrixAt(0, mat); mat.decompose(p, q, s);
    expect(s.x).toBeCloseTo(BUNKER_MODELS.radioConsole.scale, 6);
    // blast door: the model origin = leaf centre - R(rot) . BLAST_LEAF.c (rot pi: (x, z) -> (-x, -z))
    const door = ims.find(m => m.name.endsWith('blastDoor'))!;
    expect(door.count).toBe(1);
    door.getMatrixAt(0, mat); mat.decompose(p, q, s);
    expect(p.x).toBeCloseTo(20 + BLAST_LEAF.c[0], 3);
    expect(p.z).toBeCloseTo(10 + BLAST_LEAF.c[1], 3);
    expect(bunkerModelOrigin(props[3])[0]).toBeCloseTo(20 + BLAST_LEAF.c[0], 6);
  });

  it('draws nothing (keeps collision) when a model is not loaded; lazy keys and the library file map', () => {
    const layout = {props: [prop('airFilterUnit', 1, 1, 0)]} as unknown as StationLayout;
    const g = new THREE.Group();
    expect(buildBunkerModels(g, layout, {}).missing).toEqual(['airFilterUnit']);
    expect(g.children.length).toBe(0);
    expect(bunkerModelKeysFor(layout)).toEqual([REACTOR_X_KIT.airFilter.key]);
    for (const m of Object.values(REACTOR_X_KIT)) expect(REACTOR_MODEL_FILES[m.key]).toEqual({url: m.url, bytes: m.bytes});
  });
});
