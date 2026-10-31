// Runtime mesh splitting for loot holders (moved out of world/containers.ts in iteration 08, Lane I, so the
// openable-holder module world/openables.ts shares it): a GLB derivative is fitted to its prop footprint, copied
// into a triangle soup and partitioned along axis planes into buckets (body / door / lid / drawer front ...).
// The GLB files themselves are never modified; every piece is new runtime geometry.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {sampleSource} from '../assets/textureRelease'; // Task track3-eaton-centre-20261031 (lane PERF): exact paint after a mall image release

/** Triangle soup: 3 vertices per triangle, `stride` floats per vertex laid out as `attrs`. */
export interface Soup { attrs: {name: string; size: number; offset: number}[]; stride: number; data: Float32Array }

/** Copies a mesh geometry into a soup transformed by `m` (reads interleaved GLB data too). */
export function toSoup(src: THREE.BufferGeometry, m: THREE.Matrix4): Soup {
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const attrs: Soup['attrs'] = [];
  let stride = 0;
  for (const [name, a] of Object.entries(src.attributes)) { attrs.push({name, size: a.itemSize, offset: stride}); stride += a.itemSize; }
  const n = src.index ? src.index.count : src.attributes.position.count;
  const flip = m.determinant() < 0;
  const data = new Float32Array(n * stride);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const corner = flip && i % 3 ? (i % 3 === 1 ? i + 1 : i - 1) : i; // keep winding if mirrored
    const vi = src.index ? src.index.getX(corner) : corner;
    const o = i * stride;
    for (const at of attrs) {
      const a = src.attributes[at.name];
      for (let c = 0; c < at.size; c++) data[o + at.offset + c] = a.getComponent(vi, c);
      if (at.name === 'position') v.fromArray(data, o + at.offset).applyMatrix4(m).toArray(data, o + at.offset);
      else if (at.name === 'normal') v.fromArray(data, o + at.offset).applyMatrix3(nm).normalize().toArray(data, o + at.offset);
      else if (at.name === 'tangent') v.fromArray(data, o + at.offset).transformDirection(m).toArray(data, o + at.offset);
    }
  }
  return {attrs, stride, data};
}

export interface Plane { axis: 0 | 1 | 2; value: number }

/** Sutherland-Hodgman split of a convex polygon by an axis plane (attributes interpolated). */
function clipPoly(poly: Float32Array[], o: number, value: number, stride: number, nOff: number): Float32Array[][] {
  const below: Float32Array[] = [], above: Float32Array[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[o] - value, db = b[o] - value;
    (da < 0 ? below : above).push(a);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      const v = new Float32Array(stride);
      for (let k = 0; k < stride; k++) v[k] = a[k] + (b[k] - a[k]) * t;
      v[o] = value;
      if (nOff >= 0) { const l = Math.hypot(v[nOff], v[nOff + 1], v[nOff + 2]) || 1; v[nOff] /= l; v[nOff + 1] /= l; v[nOff + 2] /= l; }
      below.push(v);
      above.push(v);
    }
  }
  return [below, above].filter(p => p.length >= 3);
}

/**
 * Cuts every triangle along the axis planes, then sends each piece to bucket
 * classify(centroid, faceNormalZ, faceNormal) (-1 drops it). Exact cuts keep door/lid edges straight even
 * though the simplified meshes have large triangles spanning the seams.
 */
export function partition(s: Soup, planes: Plane[], region: THREE.Box3, buckets: number, classify: (c: THREE.Vector3, nz: number, n: THREE.Vector3) => number): number[][] {
  const out: number[][] = Array.from({length: buckets}, () => []);
  const {stride, data} = s;
  const P = s.attrs.find(a => a.name === 'position')!.offset;
  const N = s.attrs.find(a => a.name === 'normal')?.offset ?? -1;
  const c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let base = 0; base < data.length; base += 3 * stride) {
    const tri = [0, 1, 2].map(k => data.subarray(base + k * stride, base + (k + 1) * stride));
    const [a, b, d] = tri;
    const ux = b[P] - a[P], uy = b[P + 1] - a[P + 1], uz = b[P + 2] - a[P + 2];
    const vx = d[P] - a[P], vy = d[P + 1] - a[P + 1], vz = d[P + 2] - a[P + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nzr = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nzr) || 1;
    const nz = nzr / nl;
    fn.set(nx / nl, ny / nl, nz);
    let polys: Float32Array[][] = [tri];
    // Only triangles touching the region of interest are cut; the rest are classified whole.
    const touches = Math.max(a[P], b[P], d[P]) >= region.min.x && Math.min(a[P], b[P], d[P]) <= region.max.x
      && Math.max(a[P + 1], b[P + 1], d[P + 1]) >= region.min.y && Math.min(a[P + 1], b[P + 1], d[P + 1]) <= region.max.y
      && Math.max(a[P + 2], b[P + 2], d[P + 2]) >= region.min.z && Math.min(a[P + 2], b[P + 2], d[P + 2]) <= region.max.z;
    for (const pl of touches ? planes : []) {
      const o = P + pl.axis;
      const lo = Math.min(a[o], b[o], d[o]), hi = Math.max(a[o], b[o], d[o]);
      if (!(lo < pl.value && hi > pl.value)) continue;
      polys = polys.flatMap(poly => clipPoly(poly, o, pl.value, stride, N));
    }
    for (const poly of polys) {
      c.set(0, 0, 0);
      for (const v of poly) c.set(c.x + v[P], c.y + v[P + 1], c.z + v[P + 2]);
      const bucket = classify(c.divideScalar(poly.length), nz, fn);
      if (bucket < 0) continue;
      const dst = out[bucket];
      for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) for (let k = 0; k < stride; k++) dst.push(v[k]);
    }
  }
  return out;
}

/** Non-indexed geometry from soup data, translated by -origin. */
export function soupGeometry(s: Soup, data: number[], origin?: THREE.Vector3): THREE.BufferGeometry {
  const n = data.length / s.stride;
  const g = new THREE.BufferGeometry();
  for (const at of s.attrs) {
    const arr = new Float32Array(n * at.size);
    for (let i = 0; i < n; i++) for (let c = 0; c < at.size; c++) arr[i * at.size + c] = data[i * s.stride + at.offset + c];
    if (at.name === 'position' && origin) for (let i = 0; i < n; i++) { arr[i * 3] -= origin.x; arr[i * 3 + 1] -= origin.y; arr[i * 3 + 2] -= origin.z; }
    g.setAttribute(at.name, new THREE.BufferAttribute(arr, at.size));
  }
  g.computeBoundingSphere();
  return g;
}

/**
 * Fitted meshes of a GLB: same fit as builder.addInstancedModel (footprint w/h/d, base at y=0). Task office-interactions-layout-20261030
 * (lane OPEN): `turn` half-turns the centred file about +Y first (the office / company files face -Z; world/officeProps.ts FLIP turns
 * them to the prop frame's +Z the same way), so a split office model lines up with the instanced one.
 */
export function fittedMeshes(gltf: GLTF, w: number, h: number, d: number, turn = false): {soup: Soup; mat: THREE.Material; name: string}[] {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fitM = new THREE.Matrix4().makeScale(w / size.x, h / size.y, d / size.z);
  if (turn) fitM.multiply(new THREE.Matrix4().makeRotationY(Math.PI)); // a half turn keeps the centred extents on their axes
  fitM.multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  const out: {soup: Soup; mat: THREE.Material; name: string}[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    out.push({soup: toSoup(mesh.geometry, new THREE.Matrix4().multiplyMatrices(fitM, mesh.matrixWorld)), mat, name: mesh.name});
  });
  return out;
}

export function boxGeo(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, origin?: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2 - (origin?.x ?? 0), (y0 + y1) / 2 - (origin?.y ?? 0), (z0 + z1) / 2 - (origin?.z ?? 0));
  return g;
}

/** Average base colour of a material (texture mean × colour factor, linear). Null if unknown. */
export function averageColor(mat: THREE.Material | undefined): THREE.Color | null {
  const m = mat as THREE.MeshStandardMaterial | undefined;
  if (!m || !m.isMeshStandardMaterial) return null;
  const base = m.color.clone();
  const img = m.map?.image as (CanvasImageSource & {width?: number}) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return base;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const ctx = c.getContext('2d', {willReadFrequently: true})!;
    ctx.drawImage(sampleSource(img, 24), 0, 0, 24, 24); // (lane PERF: the released image's exact 24² draw; else img itself)
    const px = ctx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      // Skip transparent and near-black texels (unused atlas background).
      if (px[i + 3] < 128 || px[i] + px[i + 1] + px[i + 2] < 15) continue;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    if (!n) return base;
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace).multiply(base);
  } catch {
    return base;
  }
}

export function firstMaterial(gltf: GLTF | undefined): THREE.Material | undefined {
  let out: THREE.Material | undefined;
  gltf?.scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!out && mesh.isMesh) out = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  });
  return out;
}
