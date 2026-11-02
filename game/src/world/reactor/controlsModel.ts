// Task reactor-expansion-20261101 (lane CONTROLS): LOCAL MESH SEPARATION of a host model's moving control part (CLAUDE.md: deterministic
// processing of an approved model, no regeneration) — the coolant valve's rising-stem HANDWHEEL is the valve model's own wheel: its
// triangles (every vertex above HOST_FACES.coolantValve.wheel.cutY in model space) are split off the static valve body when lane
// ARCH instances the model (archMeshes.ts calls hostModelGeometry), and the restart turns THAT wheel (Meshy material, maps kept) while
// E is held, so no second, floating wheel is ever drawn. Compact copies (position / normal / uv), cached per source geometry.

import * as THREE from 'three';
import {HOST_FACES} from './controlsMount';

interface Split { body: THREE.BufferGeometry; wheel: THREE.BufferGeometry; wheelTris: number }
const splits = new WeakMap<THREE.BufferGeometry, Split | null>();

/** The part the restart turns: the separated wheel geometry, the model's material and the mesh's model-space matrix. */
export interface HostPart { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }
let valveWheel: HostPart | null = null;

/** archMeshes: a kit build starts (forget the last world's parts). */
export function beginHostParts(): void { valveWheel = null; }

/** The valve's handwheel separated by the last kit build (null: the model was not used — the restart draws a stand-in wheel). */
export function valveWheelPart(): HostPart | null { return valveWheel; }

/** Copies the triangles `keep` selects into a compact non-indexed-attribute geometry (position / normal / uv). */
function subset(geo: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const idx = geo.index;
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const n = a.itemSize, arr = new Float32Array(tris.length * 3 * n);
    let o = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      for (let c = 0; c < n; c++) arr[o++] = a.getComponent(v, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Splits a valve mesh geometry at the wheel cut (model space = `matrix` applied). Null when nothing / everything is above it. */
export function splitValveWheel(geo: THREE.BufferGeometry, matrix: THREE.Matrix4 = new THREE.Matrix4()): Split | null {
  if (splits.has(geo)) return splits.get(geo)!;
  const pos = geo.getAttribute('position');
  const cut = HOST_FACES.coolantValve.wheel.cutY;
  const n = (geo.index ? geo.index.count : pos.count) / 3;
  const wheel: number[] = [], body: number[] = [];
  const v = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    let above = true;
    for (let k = 0; k < 3 && above; k++) {
      const i = geo.index ? geo.index.getX(t * 3 + k) : t * 3 + k;
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      if (v.y <= cut) above = false;
    }
    (above ? wheel : body).push(t);
  }
  const res = wheel.length && body.length ? {body: subset(geo, body), wheel: subset(geo, wheel), wheelTris: wheel.length} : null;
  splits.set(geo, res);
  return res;
}

/** archMeshes: the geometry a delivered model mesh is instanced with (the valve: its static body; its wheel is kept for the restart). */
export function hostModelGeometry(piece: string, mesh: THREE.Mesh): THREE.BufferGeometry {
  if (piece !== 'coolantValve') return mesh.geometry;
  const sp = splitValveWheel(mesh.geometry, mesh.matrixWorld);
  if (!sp) return mesh.geometry;
  valveWheel = {geometry: sp.wheel, material: mesh.material, matrix: mesh.matrixWorld.clone()};
  return sp.body;
}
