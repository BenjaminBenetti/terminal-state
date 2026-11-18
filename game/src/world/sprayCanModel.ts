import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import {INK, type CanId} from '../items/sprayPaint';

export const SPRAY_MODEL = 'assets/models/spray-can.glb';
let master: THREE.Group | undefined;
let preload: Promise<void> | undefined;
export const sprayCanSource = () => master ? SPRAY_MODEL : 'fallback cylinder';
export async function preloadSprayCan(): Promise<void> {
  preload ??= new GLTFLoader().loadAsync(assetUrl(SPRAY_MODEL))
    .then(gltf => { master = gltf.scene; })
    .catch(error => console.warn('Spray can model unavailable', error));
  return preload;
}

export function sprayCanModel(id: CanId): THREE.Object3D {
  const enamel = new THREE.MeshStandardMaterial({color: INK[id], metalness: .16, roughness: .4});
  if (!master) return new THREE.Mesh(new THREE.CylinderGeometry(.042,.042,.219,16).translate(0,.1095,0), enamel);
  const root = master.clone(true);
  root.traverse(o => {
    const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    if (m.isMesh && m.material.name === 'Enamel') m.material = enamel;
  });
  return root;
}
