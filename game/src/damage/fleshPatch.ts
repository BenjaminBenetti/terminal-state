// Iteration 07 (Lane K): tear a real piece off a skinned actor surface where it was shot.
//
// extractPatch() takes the triangles of ONE layer (the body skin or the worn garment the bullet
// entered first, damage/wounds.ts) around the wound centre in BIND (rest) space — facing the shot,
// within the patch radius, the connected piece containing the hit — and bakes their CURRENT skinned
// positions (three's SkinnedMesh.getVertexPosition: the same bone / bind-matrix maths as the GPU
// skinning shader, so it is exact for the animated or ragdolled pose of that frame) into a small,
// standalone chunk mesh: the original outer surface (same UVs, so the actor's own texture), an
// inner face offset inward by the material thickness (flesh ~1.5–3 cm, cloth ~4 mm) and side walls
// along the torn boundary. Vertex colours tint the inside (raw flesh / fabric back) and a bloody rim.
// The geometry is centred on its local box, whose frame is aligned with the patch normal (+Y = out),
// so physics/chunks.ts can give it a matching box collider. Masked body triangles (Lane W hides
// skin under garments) are never taken because the layer's current index is used.
// Pure three.js (no renderer): unit-tested in Node on synthetic skinned rigs.

import * as THREE from 'three';
import type {DamageClass} from './materials';

export interface PatchLayer {
  mesh: THREE.SkinnedMesh;
  cls: DamageClass;
}

export interface PatchOptions {
  /** Material thickness of the chunk (metres, world). */
  thickness: number;
  /** Max triangles taken (nearest first). */
  maxTris?: number;
  /** Minimum triangles for a real patch (else null: caller spawns a fallback fragment). */
  minTris?: number;
  /** Rest units per world metre (bind space may not be metres). */
  k?: number;
}

export interface PatchResult {
  /** Chunk-local geometry (non-indexed; position, normal, uv, color), centred on its box. */
  geometry: THREE.BufferGeometry;
  /** World pose of the chunk frame (box centre; +Y = outward surface normal). */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Box half extents in the chunk frame (collider; clamped to >= 4 mm). */
  half: THREE.Vector3;
  /** Outward surface normal (world). */
  normal: THREE.Vector3;
  /** Actor-surface triangles taken / outer area (m^2) / triangles in the chunk mesh. */
  tris: number;
  area: number;
  meshTris: number;
  /** Rest-space centroid of the taken triangles (the hole on the actor). */
  restCenter: THREE.Vector3;
  /** Rest-space radius covered by the taken triangles (rest units). */
  restRadius: number;
}

/** Interior tint (multiplied with the actor texture) per surface class. */
const INNER: Partial<Record<DamageClass, [number, number, number]>> = {
  flesh: [0.52, 0.1, 0.08], cloth: [0.62, 0.6, 0.56], rubber: [0.32, 0.32, 0.32], plastic: [0.82, 0.8, 0.76],
};
const RIM: Partial<Record<DamageClass, [number, number, number]>> = {
  flesh: [0.55, 0.16, 0.13], cloth: [0.62, 0.42, 0.38], rubber: [0.5, 0.4, 0.38], plastic: [0.9, 0.88, 0.85],
};

const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();

/** Union-find over triangle ids. */
function find(p: Int32Array, i: number): number {
  while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; }
  return i;
}

/**
 * Extract the patch around `restCenter` (layer geometry space) facing a shot travelling along
 * `restDir` (rest space, unit), radius `restRadius` (rest units). The actor's matrices must be
 * current (call root.updateMatrixWorld(true) first). Returns null when too few triangles qualify.
 */
export function extractPatch(layer: PatchLayer, restCenter: THREE.Vector3, restDir: THREE.Vector3, restRadius: number, opts: PatchOptions): PatchResult | null {
  const mesh = layer.mesh;
  const g = mesh.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  if (!pos) return null;
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  const idx = g.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vi = (t: number, c: number) => (idx ? idx.getX(t * 3 + c) : t * 3 + c);
  const R2 = restRadius * restRadius;
  const maxTris = opts.maxTris ?? 260, minTris = opts.minTris ?? 4;
  // 1. candidates: centroid within the radius, facing the shot (fallback: any facing)
  let cand: {t: number; d2: number}[] = [];
  const pass = (facing: boolean) => {
    cand = [];
    for (let t = 0; t < triCount; t++) {
      const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
      if (a === b || b === c || a === c) continue; // degenerated (cut) triangles
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 - restCenter.x;
      const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 - restCenter.y;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 - restCenter.z;
      const d2 = cx * cx + cy * cy + cz * cz;
      if (d2 > R2) continue;
      if (facing) {
        va.fromBufferAttribute(pos, a); vb.fromBufferAttribute(pos, b); vc.fromBufferAttribute(pos, c);
        e1.subVectors(vb, va); e2.subVectors(vc, va);
        const n = e1.cross(e2);
        if (n.dot(restDir) > 0.05 * n.length()) continue; // back side of a limb / far wall
      }
      cand.push({t, d2});
    }
  };
  pass(true);
  if (cand.length < minTris) pass(false);
  if (cand.length < minTris) return null;
  cand.sort((x, y) => x.d2 - y.d2);
  if (cand.length > maxTris * 2) cand.length = maxTris * 2;
  // 2. connected piece containing the triangle nearest the hit (welded positions: UV seams split vertices)
  const weld = new Map<string, number>();
  const key = (v: number) => {
    const k = `${Math.round(pos.getX(v) * 2000)},${Math.round(pos.getY(v) * 2000)},${Math.round(pos.getZ(v) * 2000)}`;
    let w = weld.get(k);
    if (w === undefined) weld.set(k, (w = weld.size));
    return w;
  };
  const n = cand.length;
  const wk = new Int32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) wk[i * 3 + c] = key(vi(cand[i].t, c));
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const owner = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const w = wk[i * 3 + c];
      const o = owner.get(w);
      if (o === undefined) owner.set(w, i);
      else { const ra = find(parent, i), rb = find(parent, o); if (ra !== rb) parent[ra] = rb; }
    }
  }
  const root = find(parent, 0);
  const keep: number[] = [];
  for (let i = 0; i < n && keep.length < maxTris; i++) if (find(parent, i) === root) keep.push(i);
  if (keep.length < minTris) return null;
  // 3. bake current skinned world positions of the used vertices
  mesh.updateWorldMatrix(true, false);
  const world = new Map<number, THREE.Vector3>();
  const restC = new THREE.Vector3();
  let restR = 0;
  const bake = (v: number): THREE.Vector3 => {
    let p = world.get(v);
    if (!p) {
      p = new THREE.Vector3();
      mesh.getVertexPosition(v, p);
      p.applyMatrix4(mesh.matrixWorld);
      world.set(v, p);
    }
    return p;
  };
  const C = new THREE.Vector3(), N = new THREE.Vector3();
  let area = 0;
  for (const i of keep) {
    const t = cand[i].t;
    const a = bake(vi(t, 0)), b = bake(vi(t, 1)), c = bake(vi(t, 2));
    e1.subVectors(b, a); e2.subVectors(c, a);
    const nn = e1.clone().cross(e2);
    const ar = nn.length() / 2;
    area += ar;
    N.add(nn); // area-weighted (|cross| = 2 * area)
    C.addScaledVector(va.copy(a).add(b).add(c).divideScalar(3), ar);
    for (let k = 0; k < 3; k++) {
      vb.fromBufferAttribute(pos, vi(t, k));
      restC.add(vb);
    }
  }
  if (area < 1e-7 || N.lengthSq() < 1e-14) return null;
  C.divideScalar(area);
  N.normalize();
  restC.divideScalar(keep.length * 3);
  for (const i of keep) for (let k = 0; k < 3; k++) restR = Math.max(restR, vb.fromBufferAttribute(pos, vi(cand[i].t, k)).distanceTo(restC));
  // 4. chunk frame: +Y = outward normal
  const X = Math.abs(N.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(N).normalize() : new THREE.Vector3(1, 0, 0).cross(N).normalize();
  const Z = new THREE.Vector3().crossVectors(X, N).normalize();
  const basis = new THREE.Matrix4().makeBasis(X, N, Z);
  const Q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const Qi = Q.clone().invert();
  const local = new Map<number, THREE.Vector3>();
  for (const [v, p] of world) local.set(v, p.clone().sub(C).applyQuaternion(Qi));
  let maxR = 0;
  for (const p of local.values()) maxR = Math.max(maxR, Math.hypot(p.x, p.z));
  const th = Math.max(0.003, opts.thickness);
  const inner = (p: THREE.Vector3) => new THREE.Vector3(p.x * 0.8, p.y - th, p.z * 0.8);
  // boundary edges (welded): used by exactly one kept triangle
  const edgeCount = new Map<string, number>();
  const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const i of keep) for (let c = 0; c < 3; c++) {
    const k = ekey(wk[i * 3 + c], wk[i * 3 + (c + 1) % 3]);
    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
  }
  const P: number[] = [], U: number[] = [], Col: number[] = [];
  const inC = INNER[layer.cls] ?? INNER.cloth!, rimC = RIM[layer.cls] ?? RIM.cloth!;
  const push = (p: THREE.Vector3, v: number, col: readonly number[]) => {
    P.push(p.x, p.y, p.z);
    if (uv) U.push(uv.getX(v), uv.getY(v)); else U.push(0, 0);
    Col.push(col[0], col[1], col[2]);
  };
  const outerCol = (p: THREE.Vector3): number[] => {
    // bloody / frayed rim toward the torn edge
    const f = maxR > 1e-5 ? THREE.MathUtils.smoothstep(Math.hypot(p.x, p.z) / maxR, 0.55, 1.0) : 0;
    return [1 + (rimC[0] - 1) * f, 1 + (rimC[1] - 1) * f, 1 + (rimC[2] - 1) * f];
  };
  const cen = new THREE.Vector3();
  for (const i of keep) {
    const t = cand[i].t;
    const ids = [vi(t, 0), vi(t, 1), vi(t, 2)];
    const L = ids.map(v => local.get(v)!);
    // outer face (original winding), inner face (reversed)
    for (let c = 0; c < 3; c++) push(L[c], ids[c], outerCol(L[c]));
    for (const c of [0, 2, 1]) push(inner(L[c]), ids[c], inC);
    cen.copy(L[0]).add(L[1]).add(L[2]).divideScalar(3);
    for (let c = 0; c < 3; c++) {
      const c2 = (c + 1) % 3;
      if (edgeCount.get(ekey(wk[i * 3 + c], wk[i * 3 + c2])) !== 1) continue;
      // side wall along a torn boundary edge, wound to face away from the triangle
      const a = L[c], b = L[c2], ai = inner(a), bi = inner(b);
      e1.subVectors(ai, a); e2.subVectors(bi, a);
      const nrm = e1.clone().cross(e2);
      const out = va.copy(a).add(b).multiplyScalar(0.5).sub(cen);
      const flip = nrm.dot(out) < 0;
      const quad: [THREE.Vector3, number][] = flip ? [[a, ids[c]], [bi, ids[c2]], [ai, ids[c]], [a, ids[c]], [b, ids[c2]], [bi, ids[c2]]]
        : [[a, ids[c]], [ai, ids[c]], [bi, ids[c2]], [a, ids[c]], [bi, ids[c2]], [b, ids[c2]]];
      for (const [p, v] of quad) push(p, v, inC);
    }
  }
  // 5. centre on the local box
  const box = new THREE.Box3();
  for (let i = 0; i < P.length; i += 3) box.expandByPoint(va.set(P[i], P[i + 1], P[i + 2]));
  const bc = box.getCenter(new THREE.Vector3());
  for (let i = 0; i < P.length; i += 3) { P[i] -= bc.x; P[i + 1] -= bc.y; P[i + 2] -= bc.z; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(Col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const size = box.getSize(new THREE.Vector3());
  const half = new THREE.Vector3(Math.max(0.004, size.x / 2), Math.max(0.004, size.y / 2), Math.max(0.004, size.z / 2));
  const position = C.clone().add(bc.clone().applyQuaternion(Q));
  void opts.k;
  return {geometry: geo, position, quaternion: Q, half, normal: N.clone(), tris: keep.length, area, meshTris: P.length / 9, restCenter: restC, restRadius: restR};
}

/** Cheap stand-in when a layer is too coarse around the hit: a jittered torn flap in the layer colour. */
export function fallbackFlap(size: number, thickness: number, color: THREE.Color, seed: number): THREE.BufferGeometry {
  let s = seed % 2147483647 || 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = new THREE.CylinderGeometry(size / 2, size / 2 * 0.85, Math.max(0.004, thickness), 7, 1).toNonIndexed();
  const p = g.attributes.position as THREE.BufferAttribute;
  const offs = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let o = offs.get(k);
    if (o === undefined) offs.set(k, (o = 0.7 + r() * 0.5));
    p.setXYZ(i, p.getX(i) * o, p.getY(i), p.getZ(i) * o);
  }
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
