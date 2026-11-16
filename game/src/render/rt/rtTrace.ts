// Task rt-flashlight-compute-20261115-233136 (lane BVH): the CPU REFERENCE traversal of the packed scene (render/rt/rtFormat.ts) —
// the specification the GPU kernels port line by line, and what the tests hold the BVH to (it must equal brute force). Plain and
// branch-light on purpose: fixed stacks, one loop per tree level, the same order of operations as the WGSL.
//
//  - Trees: the static TLAS, then the dynamic TLAS, sharing one best t (closest hit) — an empty tree (node count 0) is skipped.
//  - Box test (rtBox): slabs with the inverse direction (rtInv: 1 / d; a component with |d| < 1e-30 becomes +-1e30, the sign of d,
//    +0 -> +), clipped to [tmin, best]: tn = max(tmin, the three near planes), tf = min(best, the three far planes); INF when tn > tf,
//    else tn (the entry t).
//  - Traversal (both levels): test the root box first; a stack of (node, entry t); a popped entry whose entry t >= best is skipped;
//    a leaf tests its primitives; an interior node tests both children (A, A + 1) and pushes the hit ones, the FARTHER FIRST, so the
//    nearer is popped next. A stack of BVH_MAX_DEPTH + 2 entries never overflows (the builder's depth limit).
//  - Instances: DISABLED ones are skipped. A mesh transforms the ray into object space with W (v0..v2): o' = W [o, 1], d' = W3 d
//    (d' NOT normalized, so t is the same parameter in both spaces) and traverses its BLAS from blasRoot.
//  - Triangle: Moller-Trumbore, two-sided: e1 = v1 - v0, e2 = v2 - v0, p = d x e2, det = e1 . p, |det| < 1e-20 -> miss; s = o - v0,
//    u = (s . p) / det in [0, 1]; q = s x e1, v = (d . q) / det >= 0, u + v <= 1; t = (e2 . q) / det accepted when tmin < t < best.
//  - Capsule (world space, v4 = [x, z, r, y0], v5.x = y1): a ray whose ORIGIN is inside (dx^2 + dz^2 < r^2 about the axis and
//    y0 <= y <= y1) skips it; else the nearest of the side (near root only, when the horizontal direction is not ~0: a > 1e-12, with
//    its y within [y0, y1]) and the two flat caps (disc test: <= r^2), each with tmin < t < best.
//  - The hit: t, instance index, triangle (global index into blasTris; -1 for a capsule), the world normal — geometric, NOT face-
//    forwarded: mesh normalize(W3^T (e1 x e2)), capsule side ((p - axis) / r) with y 0, caps (0, -1, 0) bottom / (0, 1, 0) top —,
//    the albedo (material rgb x the triangle's vertex colour when the material's RT_MAT_VERTEX_COLOR flag is set x the instance
//    tint; a capsule: its material's rgb) and the instance flags.

import {BVH_MAX_DEPTH, BVH_NODE_FLOATS, BLAS_TRI_FLOATS, RT_INSTANCE_VEC4, RT_INST_DISABLED, RT_MAT_VERTEX_COLOR, RT_TYPE_CAPSULE, type RtSceneBuffers} from './rtFormat';

/** A ray hit (traceClosest). */
export interface RtHit {
  t: number;
  /** Instance index (vec4 offset layout.instances + 6 * instance). */
  instance: number;
  /** Global triangle index into blasTris; -1 for a capsule. */
  triangle: number;
  /** World normal: unit, geometric, not face-forwarded. */
  nx: number; ny: number; nz: number;
  /** Linear albedo. */
  r: number; g: number; b: number;
  /** The instance's flags (RT_INST_PROXY for a capsule). */
  flags: number;
}

export interface Vec3Like { readonly x: number; readonly y: number; readonly z: number }

export const newRtHit = (): RtHit => ({t: 0, instance: -1, triangle: -1, nx: 0, ny: 1, nz: 0, r: 0, g: 0, b: 0, flags: 0});

const INF = Infinity;
/** Capsule surfaces. */
const SIDE = 0, BOTTOM = 1, TOP = 2;
const STACK = BVH_MAX_DEPTH + 2;

/** The inverse of a direction component (see the file comment). */
export function rtInv(d: number): number {
  return Math.abs(d) < 1e-30 ? (d < 0 ? -1e30 : 1e30) : 1 / d;
}

/** The slab test of the box of node `f` (float offset into `A`): the entry t, or INF (see the file comment). */
export function rtBox(A: Float32Array, f: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, tmin: number, tmax: number): number {
  const ax = (A[f] - ox) * ix, bx = (A[f + 4] - ox) * ix;
  const ay = (A[f + 1] - oy) * iy, by = (A[f + 5] - oy) * iy;
  const az = (A[f + 2] - oz) * iz, bz = (A[f + 6] - oz) * iz;
  const tn = Math.max(tmin, Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz));
  const tf = Math.min(tmax, Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz));
  return tn > tf ? INF : tn;
}

/** Moller-Trumbore, two-sided (see the file comment): t, or INF. `f` = float offset of the triangle in `T`. */
export function rtTriangle(T: Float32Array, f: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmin: number, tmax: number): number {
  const v0x = T[f], v0y = T[f + 1], v0z = T[f + 2];
  const e1x = T[f + 4] - v0x, e1y = T[f + 5] - v0y, e1z = T[f + 6] - v0z;
  const e2x = T[f + 8] - v0x, e2y = T[f + 9] - v0y, e2z = T[f + 10] - v0z;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-20) return INF;
  const inv = 1 / det;
  const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return INF;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return INF;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > tmin && t < tmax ? t : INF;
}

let capSurface = SIDE;

/** The capsule test (see the file comment): t, or INF; the surface hit goes to capSurface. `v` = float offset of the record. */
export function rtCapsule(I: Float32Array, v: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmin: number, tmax: number): number {
  const cx = I[v + 16], cz = I[v + 17], r = I[v + 18], y0 = I[v + 19], y1 = I[v + 20];
  const px = ox - cx, pz = oz - cz, r2 = r * r;
  const c = px * px + pz * pz - r2;
  if (c < 0 && oy >= y0 && oy <= y1) return INF; // (the origin is inside: skip it)
  let best = INF, surf = SIDE;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = px * dx + pz * dz, disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a, y = oy + dy * t;
      if (t > tmin && t < tmax && y >= y0 && y <= y1) { best = t; surf = SIDE; }
    }
  }
  if (dy !== 0) {
    const lim = Math.min(tmax, best);
    let t = (y0 - oy) / dy;
    if (t > tmin && t < lim) {
      const qx = px + dx * t, qz = pz + dz * t;
      if (qx * qx + qz * qz <= r2) { best = t; surf = BOTTOM; }
    }
    t = (y1 - oy) / dy;
    if (t > tmin && t < Math.min(tmax, best)) {
      const qx = px + dx * t, qz = pz + dz * t;
      if (qx * qx + qz * qz <= r2) { best = t; surf = TOP; }
    }
  }
  capSurface = surf;
  return best;
}

// fixed traversal stacks (TLAS, BLAS): node + entry t
const tlasNode = new Int32Array(STACK), tlasT = new Float64Array(STACK);
const blasNode = new Int32Array(STACK), blasT = new Float64Array(STACK);
// the closest hit found so far
let hitT = INF, hitInst = -1, hitTri = -1, hitSurf = SIDE;

/** BLAS traversal from global node `root` (object-space ray): the closest triangle in (tmin, best) updates hitT / hitTri; true when one did. */
function traceBlas(buf: RtSceneBuffers, root: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmin: number, any: boolean): boolean {
  const N = buf.blasNodes, NU = buf.blasNodesU32, T = buf.blasTris;
  const ix = rtInv(dx), iy = rtInv(dy), iz = rtInv(dz);
  let found = false;
  const tr = rtBox(N, root * BVH_NODE_FLOATS, ox, oy, oz, ix, iy, iz, tmin, hitT);
  if (tr === INF) return false;
  let sp = 0;
  blasNode[sp] = root; blasT[sp] = tr; sp++;
  while (sp > 0) {
    sp--;
    if (blasT[sp] >= hitT) continue;
    const f = blasNode[sp] * BVH_NODE_FLOATS, count = NU[f + 7], a = NU[f + 3];
    if (count === 0) {
      const tl = rtBox(N, a * BVH_NODE_FLOATS, ox, oy, oz, ix, iy, iz, tmin, hitT);
      const tr2 = rtBox(N, (a + 1) * BVH_NODE_FLOATS, ox, oy, oz, ix, iy, iz, tmin, hitT);
      if (tl <= tr2) {
        if (tr2 !== INF) { blasNode[sp] = a + 1; blasT[sp] = tr2; sp++; }
        if (tl !== INF) { blasNode[sp] = a; blasT[sp] = tl; sp++; }
      } else {
        if (tl !== INF) { blasNode[sp] = a; blasT[sp] = tl; sp++; }
        blasNode[sp] = a + 1; blasT[sp] = tr2; sp++;
      }
      continue;
    }
    for (let k = a; k < a + count; k++) {
      const t = rtTriangle(T, k * BLAS_TRI_FLOATS, ox, oy, oz, dx, dy, dz, tmin, hitT);
      if (t !== INF) {
        hitT = t; hitTri = k; found = true;
        if (any) return true;
      }
    }
  }
  return found;
}

/** Both trees; the closest (or, `any`, the first) hit in (tmin, tmax) goes to hitT / hitInst / hitTri / hitSurf. */
function traceScene(buf: RtSceneBuffers, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmin: number, tmax: number, any: boolean): boolean {
  const L = buf.layout, A = buf.tlas, AU = buf.tlasU32;
  hitT = tmax; hitInst = -1; hitTri = -1; hitSurf = SIDE;
  const ix = rtInv(dx), iy = rtInv(dy), iz = rtInv(dz);
  for (let tree = 0; tree < 2; tree++) {
    const count = tree === 0 ? L.staticNodeCount : L.dynamicNodeCount;
    if (count === 0) continue;
    const base = (tree === 0 ? L.staticNodes : L.dynamicNodes) * 4;
    const tr = rtBox(A, base, ox, oy, oz, ix, iy, iz, tmin, hitT);
    if (tr === INF) continue;
    let sp = 0;
    tlasNode[sp] = 0; tlasT[sp] = tr; sp++;
    while (sp > 0) {
      sp--;
      if (tlasT[sp] >= hitT) continue;
      const f = base + tlasNode[sp] * BVH_NODE_FLOATS, n = AU[f + 7], a = AU[f + 3];
      if (n === 0) {
        const tl = rtBox(A, base + a * BVH_NODE_FLOATS, ox, oy, oz, ix, iy, iz, tmin, hitT);
        const tr2 = rtBox(A, base + (a + 1) * BVH_NODE_FLOATS, ox, oy, oz, ix, iy, iz, tmin, hitT);
        if (tl <= tr2) {
          if (tr2 !== INF) { tlasNode[sp] = a + 1; tlasT[sp] = tr2; sp++; }
          if (tl !== INF) { tlasNode[sp] = a; tlasT[sp] = tl; sp++; }
        } else {
          if (tl !== INF) { tlasNode[sp] = a; tlasT[sp] = tl; sp++; }
          tlasNode[sp] = a + 1; tlasT[sp] = tr2; sp++;
        }
        continue;
      }
      for (let k = a; k < a + n; k++) {
        const v = (L.instances + RT_INSTANCE_VEC4 * k) * 4;
        if (AU[v + 14] & RT_INST_DISABLED) continue;
        if (AU[v + 15] === RT_TYPE_CAPSULE) {
          const t = rtCapsule(A, v, ox, oy, oz, dx, dy, dz, tmin, hitT);
          if (t !== INF) {
            hitT = t; hitInst = k; hitTri = -1; hitSurf = capSurface;
            if (any) return true;
          }
          continue;
        }
        const qx = A[v] * ox + A[v + 1] * oy + A[v + 2] * oz + A[v + 3];
        const qy = A[v + 4] * ox + A[v + 5] * oy + A[v + 6] * oz + A[v + 7];
        const qz = A[v + 8] * ox + A[v + 9] * oy + A[v + 10] * oz + A[v + 11];
        const ex = A[v] * dx + A[v + 1] * dy + A[v + 2] * dz;
        const ey = A[v + 4] * dx + A[v + 5] * dy + A[v + 6] * dz;
        const ez = A[v + 8] * dx + A[v + 9] * dy + A[v + 10] * dz;
        if (traceBlas(buf, AU[v + 12], qx, qy, qz, ex, ey, ez, tmin, any)) {
          hitInst = k;
          if (any) return true;
        }
      }
    }
  }
  return hitInst >= 0;
}

/** The closest hit of the ray o + t d, tmin < t < tmax (see the file comment), into `out`; null when it hits nothing. */
export function traceClosest(buf: RtSceneBuffers, o: Vec3Like, d: Vec3Like, tmin: number, tmax: number, out: RtHit = newRtHit()): RtHit | null {
  if (!traceScene(buf, o.x, o.y, o.z, d.x, d.y, d.z, tmin, tmax, false)) return null;
  const L = buf.layout, A = buf.tlas, AU = buf.tlasU32;
  const v = (L.instances + RT_INSTANCE_VEC4 * hitInst) * 4;
  out.t = hitT; out.instance = hitInst; out.triangle = hitTri; out.flags = AU[v + 14];
  const mat = (L.materials + AU[v + 13]) * 4;
  let nx: number, ny: number, nz: number;
  if (hitTri < 0) {
    // capsule
    if (hitSurf === SIDE) { nx = (o.x + d.x * hitT - A[v + 16]) / A[v + 18]; ny = 0; nz = (o.z + d.z * hitT - A[v + 17]) / A[v + 18]; }
    else { nx = 0; ny = hitSurf === TOP ? 1 : -1; nz = 0; }
    out.r = A[mat]; out.g = A[mat + 1]; out.b = A[mat + 2];
  } else {
    const T = buf.blasTris, TU = buf.blasTrisU32, f = hitTri * BLAS_TRI_FLOATS;
    const e1x = T[f + 4] - T[f], e1y = T[f + 5] - T[f + 1], e1z = T[f + 6] - T[f + 2];
    const e2x = T[f + 8] - T[f], e2y = T[f + 9] - T[f + 1], e2z = T[f + 10] - T[f + 2];
    const mx = e1y * e2z - e1z * e2y, my = e1z * e2x - e1x * e2z, mz = e1x * e2y - e1y * e2x;
    // W3^T n (W row r = A[v + 4r .. v + 4r + 2])
    nx = A[v] * mx + A[v + 4] * my + A[v + 8] * mz;
    ny = A[v + 1] * mx + A[v + 5] * my + A[v + 9] * mz;
    nz = A[v + 2] * mx + A[v + 6] * my + A[v + 10] * mz;
    const m = (L.materials + AU[v + 13] + TU[f + 3]) * 4;
    let r = A[m], g = A[m + 1], b = A[m + 2];
    if (AU[m + 3] & RT_MAT_VERTEX_COLOR) {
      const c = TU[f + 7];
      r *= (c & 255) / 255; g *= ((c >>> 8) & 255) / 255; b *= ((c >>> 16) & 255) / 255;
    }
    out.r = r * A[v + 16]; out.g = g * A[v + 17]; out.b = b * A[v + 18];
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  out.nx = nx / len; out.ny = ny / len; out.nz = nz / len;
  return out;
}

/** True when the ray o + t d hits anything with tmin < t < tmax (a shadow / visibility ray). */
export function traceAny(buf: RtSceneBuffers, o: Vec3Like, d: Vec3Like, tmin: number, tmax: number): boolean {
  return traceScene(buf, o.x, o.y, o.z, d.x, d.y, d.z, tmin, tmax, true);
}
