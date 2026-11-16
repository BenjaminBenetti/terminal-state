// Task rt-flashlight-compute-20261115-233136 (lane BVH): the CPU side of the traced flashlight bounce — a fast BVH2 builder over
// primitive boxes (binned SAH) and the per-geometry BLAS (bottom-level tree over a geometry's drawn triangles, object space).
//
// BINARY FORMATS (shared 1:1 with the GPU kernels; every array is a stream of vec4<f32>, u32 fields are bit patterns written through
// a Uint32Array view of the same buffer):
//  - node, 8 floats = 2 vec4: [minX, minY, minZ, A, maxX, maxY, maxZ, B]
//      leaf:     B = primitive count (1..maxLeaf), A = first primitive (index into the build's reordered primitive array)
//      interior: B = 0, A = left child node index, right child = A + 1 (children always adjacent)
//    the root is node 0; indices are LOCAL to the tree (render/rt/rtScene.ts rebases them when it packs trees together).
//  - BLAS triangle, 12 floats = 3 vec4 (object space): [v0.xyz, matSlot u32, v1.xyz, color u32, v2.xyz, flags u32]
//      matSlot: the material index of the triangle's geometry group (0 for a single material), clamped to materialCount - 1
//      color:   the triangle's mean vertex colour as RGBA8 LINEAR (r | g << 8 | b << 16 | a << 24) when the geometry has a `color`
//               attribute, else 0xFFFFFFFF
//      flags:   0 (reserved)
//    drawn = what three draws: the index (or not), the draw range, the groups (material arrays only), interleaved positions;
//    degenerate triangles (zero area, non-finite) are dropped.
//
// THE BUILDER (BvhBuilder): binned SAH (BVH_BINS bins on all three axes, traversal cost = intersection cost = 1), iterative over an
// explicit task stack, typed arrays only (no per-node allocation; a reused builder allocates nothing once its arrays are large
// enough), resumable: run(work) stops after about `work` primitive visits so a big tree is built across frames. A node splits when
// it holds more than maxLeaf primitives or when the SAH says a split is cheaper; the depth never exceeds BVH_MAX_DEPTH (a split that
// could not finish within it is replaced by a balanced median split), so a fixed GPU traversal stack of BVH_MAX_DEPTH entries holds.
// Node boxes are exact unions of the primitive boxes (f32 in, f32 out: no rounding), so a box always contains its primitives.
//
// THE BLAS CACHE: blasFor(geometry, ...) keeps one build per geometry (WeakMap: per session, shared by every station that draws the
// geometry), valid while its key holds (position attribute + version, index + version, draw range, groups, material count).

import * as THREE from 'three';

/** Floats per BVH node (2 vec4). */
export const BVH_NODE_FLOATS = 8;
/** Floats per BLAS triangle (3 vec4). */
export const BLAS_TRI_FLOATS = 12;
/** Most triangles per BLAS leaf / instances per TLAS leaf. */
export const BLAS_MAX_LEAF = 4;
export const TLAS_MAX_LEAF = 2;
/** SAH bins per axis. */
export const BVH_BINS = 12;
/** The deepest a leaf may lie (root = depth 0): a traversal stack of this many entries never overflows. */
export const BVH_MAX_DEPTH = 48;
/** The colour word of a triangle whose geometry has no vertex colours (opaque white). */
export const TRI_COLOR_NONE = 0xffffffff;

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
const MIN_SUB = 1.401298464324817e-45;

/** The largest f32 value <= v (conservative box minimum). */
export function f32Down(v: number): number {
  const f = Math.fround(v);
  if (f <= v) return f;
  if (f === 0) return -MIN_SUB;
  F32[0] = f;
  if (f > 0) U32[0]--; else U32[0]++;
  return F32[0];
}

/** The smallest f32 value >= v (conservative box maximum). */
export function f32Up(v: number): number {
  const f = Math.fround(v);
  if (f >= v) return f;
  if (f === 0) return MIN_SUB;
  F32[0] = f;
  if (f > 0) U32[0]++; else U32[0]--;
  return F32[0];
}

/** Levels a balanced median split needs below a node of n primitives before every leaf holds <= maxLeaf. */
function medianDepth(n: number, maxLeaf: number): number {
  let d = 0;
  while (n > maxLeaf) { n = (n + 1) >> 1; d++; }
  return d;
}

/** Half surface area of a box given as min / max. */
function halfArea(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  return dx * dy + dy * dz + dz * dx;
}

/**
 * A reusable, resumable BVH2 builder (see the file comment). begin() a build over `count` primitive boxes (6 floats each: min xyz,
 * max xyz; the array is read while the build runs), run() it until it returns true, then read nodes / nodeCount / order:
 * order[k] = the original index of the k-th primitive of the reordered array the leaves address.
 */
export class BvhBuilder {
  /** Node stream (BVH_NODE_FLOATS a node; capacity may exceed nodeCount) and its u32 view. */
  nodes: Float32Array = new Float32Array(0);
  nodesU32: Uint32Array = new Uint32Array(0);
  nodeCount = 0;
  /** Reordered primitive indices (first `count` entries). */
  order: Uint32Array = new Uint32Array(0);
  count = 0;
  /** Deepest node of the last build (root = 0). */
  depth = 0;
  /** Median splits forced by the depth limit in the last build. */
  forcedMedians = 0;
  private bounds: Float32Array = new Float32Array(0);
  private cent: Float32Array = new Float32Array(0);
  /** Task stack: node, start, end, depth (Int32) + centroid box (6 floats) per entry. */
  private readonly stackI: Int32Array;
  private readonly stackC: Float32Array;
  private sp = 0;
  private readonly binN: Int32Array;
  private readonly binB: Float32Array;
  private readonly rArea: Float64Array;
  private readonly rCount: Int32Array;

  constructor(readonly maxLeaf: number, readonly bins = BVH_BINS, readonly depthLimit = BVH_MAX_DEPTH) {
    if (!(maxLeaf >= 1) || !(bins >= 2) || !(depthLimit >= 1)) throw new Error('BvhBuilder: bad parameters');
    this.stackI = new Int32Array((depthLimit + 2) * 4);
    this.stackC = new Float32Array((depthLimit + 2) * 6);
    this.binN = new Int32Array(3 * bins);
    this.binB = new Float32Array(3 * bins * 6);
    this.rArea = new Float64Array(bins);
    this.rCount = new Int32Array(bins);
  }

  /** True when the build begun last has finished. */
  get done(): boolean { return this.sp === 0; }

  /** Starts a build over `count` boxes of `bounds` (min xyz, max xyz each; finite, min <= max). */
  begin(bounds: Float32Array, count: number): void {
    if (bounds.length < count * 6) throw new Error('BvhBuilder.begin: bounds too short');
    this.bounds = bounds;
    this.count = count;
    this.nodeCount = 0;
    this.sp = 0;
    this.depth = 0;
    this.forcedMedians = 0;
    if (this.order.length < count) this.order = new Uint32Array(Math.max(count, this.order.length * 2));
    if (this.cent.length < count * 3) this.cent = new Float32Array(Math.max(count * 3, this.cent.length * 2));
    const nodeCap = Math.max(1, 2 * count - 1) * BVH_NODE_FLOATS;
    if (this.nodes.length < nodeCap) {
      this.nodes = new Float32Array(Math.max(nodeCap, this.nodes.length * 2));
      this.nodesU32 = new Uint32Array(this.nodes.buffer);
    }
    if (count === 0) return;
    const O = this.order, C = this.cent, Bd = bounds;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let p = 0; p < count; p++) {
      O[p] = p;
      const b = p * 6;
      const ax = Bd[b], ay = Bd[b + 1], az = Bd[b + 2], bx = Bd[b + 3], by = Bd[b + 4], bz = Bd[b + 5];
      if (ax < x0) x0 = ax; if (ay < y0) y0 = ay; if (az < z0) z0 = az;
      if (bx > x1) x1 = bx; if (by > y1) y1 = by; if (bz > z1) z1 = bz;
      C[p * 3] = (ax + bx) * 0.5; C[p * 3 + 1] = (ay + by) * 0.5; C[p * 3 + 2] = (az + bz) * 0.5;
      const fx = C[p * 3], fy = C[p * 3 + 1], fz = C[p * 3 + 2]; // (the stored f32 values are the ones binned)
      if (fx < cx0) cx0 = fx; if (fy < cy0) cy0 = fy; if (fz < cz0) cz0 = fz;
      if (fx > cx1) cx1 = fx; if (fy > cy1) cy1 = fy; if (fz > cz1) cz1 = fz;
    }
    const N = this.nodes, NU = this.nodesU32;
    N[0] = x0; N[1] = y0; N[2] = z0; N[4] = x1; N[5] = y1; N[6] = z1;
    NU[3] = 0; NU[7] = 0;
    this.nodeCount = 1;
    this.push(0, 0, count, 0, cx0, cy0, cz0, cx1, cy1, cz1);
  }

  private push(node: number, start: number, end: number, depth: number, cx0: number, cy0: number, cz0: number, cx1: number, cy1: number, cz1: number): void {
    const s = this.sp++, I = this.stackI, Cs = this.stackC;
    I[s * 4] = node; I[s * 4 + 1] = start; I[s * 4 + 2] = end; I[s * 4 + 3] = depth;
    Cs[s * 6] = cx0; Cs[s * 6 + 1] = cy0; Cs[s * 6 + 2] = cz0; Cs[s * 6 + 3] = cx1; Cs[s * 6 + 4] = cy1; Cs[s * 6 + 5] = cz1;
  }

  /** Runs the build for about `work` primitive visits (Infinity: to the end). True when it has finished. */
  run(work = Infinity): boolean {
    const ML = this.maxLeaf, NB = this.bins, O = this.order, C = this.cent, Bd = this.bounds;
    const binN = this.binN, binB = this.binB, rArea = this.rArea, rCount = this.rCount;
    const I = this.stackI, Cs = this.stackC;
    while (this.sp > 0) {
      if (work <= 0) return false;
      const s = --this.sp;
      const node = I[s * 4], start = I[s * 4 + 1], end = I[s * 4 + 2], depth = I[s * 4 + 3];
      const cmin0 = Cs[s * 6], cmin1 = Cs[s * 6 + 1], cmin2 = Cs[s * 6 + 2];
      const cmax0 = Cs[s * 6 + 3], cmax1 = Cs[s * 6 + 4], cmax2 = Cs[s * 6 + 5];
      const n = end - start;
      work -= 2 * n + 8;
      if (depth > this.depth) this.depth = depth;
      const N = this.nodes, NU = this.nodesU32, no = node * BVH_NODE_FLOATS;
      if (n === 1) { NU[no + 3] = start; NU[no + 7] = 1; continue; }

      // ---- binning (all axes with a centroid extent)
      const e0 = cmax0 - cmin0, e1 = cmax1 - cmin1, e2 = cmax2 - cmin2;
      const k0 = e0 > 0 ? (NB * (1 - 1e-6)) / e0 : 0, k1 = e1 > 0 ? (NB * (1 - 1e-6)) / e1 : 0, k2 = e2 > 0 ? (NB * (1 - 1e-6)) / e2 : 0;
      let bestAxis = -1, bestSplit = 0, bestCost = Infinity, bestNL = 0;
      if (k0 > 0 || k1 > 0 || k2 > 0) {
        binN.fill(0);
        for (let q = 0; q < 3 * NB; q++) {
          const o = q * 6;
          binB[o] = binB[o + 1] = binB[o + 2] = Infinity;
          binB[o + 3] = binB[o + 4] = binB[o + 5] = -Infinity;
        }
        for (let i = start; i < end; i++) {
          const p = O[i], c = p * 3, b = p * 6;
          const ax = Bd[b], ay = Bd[b + 1], az = Bd[b + 2], bx = Bd[b + 3], by = Bd[b + 4], bz = Bd[b + 5];
          if (k0 !== 0) {
            let bin = ((C[c] - cmin0) * k0) | 0;
            if (bin < 0) bin = 0; else if (bin >= NB) bin = NB - 1;
            const o = bin * 6;
            binN[bin]++;
            if (ax < binB[o]) binB[o] = ax; if (ay < binB[o + 1]) binB[o + 1] = ay; if (az < binB[o + 2]) binB[o + 2] = az;
            if (bx > binB[o + 3]) binB[o + 3] = bx; if (by > binB[o + 4]) binB[o + 4] = by; if (bz > binB[o + 5]) binB[o + 5] = bz;
          }
          if (k1 !== 0) {
            let bin = ((C[c + 1] - cmin1) * k1) | 0;
            if (bin < 0) bin = 0; else if (bin >= NB) bin = NB - 1;
            const q = NB + bin, o = q * 6;
            binN[q]++;
            if (ax < binB[o]) binB[o] = ax; if (ay < binB[o + 1]) binB[o + 1] = ay; if (az < binB[o + 2]) binB[o + 2] = az;
            if (bx > binB[o + 3]) binB[o + 3] = bx; if (by > binB[o + 4]) binB[o + 4] = by; if (bz > binB[o + 5]) binB[o + 5] = bz;
          }
          if (k2 !== 0) {
            let bin = ((C[c + 2] - cmin2) * k2) | 0;
            if (bin < 0) bin = 0; else if (bin >= NB) bin = NB - 1;
            const q = 2 * NB + bin, o = q * 6;
            binN[q]++;
            if (ax < binB[o]) binB[o] = ax; if (ay < binB[o + 1]) binB[o + 1] = ay; if (az < binB[o + 2]) binB[o + 2] = az;
            if (bx > binB[o + 3]) binB[o + 3] = bx; if (by > binB[o + 4]) binB[o + 4] = by; if (bz > binB[o + 5]) binB[o + 5] = bz;
          }
        }
        // ---- SAH sweep per axis
        for (let k = 0; k < 3; k++) {
          if ((k === 0 ? k0 : k === 1 ? k1 : k2) === 0) continue;
          let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, cnt = 0;
          for (let b = NB - 1; b >= 1; b--) {
            const q = k * NB + b, o = q * 6;
            if (binN[q] > 0) {
              if (binB[o] < x0) x0 = binB[o]; if (binB[o + 1] < y0) y0 = binB[o + 1]; if (binB[o + 2] < z0) z0 = binB[o + 2];
              if (binB[o + 3] > x1) x1 = binB[o + 3]; if (binB[o + 4] > y1) y1 = binB[o + 4]; if (binB[o + 5] > z1) z1 = binB[o + 5];
              cnt += binN[q];
            }
            rCount[b] = cnt;
            rArea[b] = cnt > 0 ? halfArea(x0, y0, z0, x1, y1, z1) : 0;
          }
          x0 = y0 = z0 = Infinity; x1 = y1 = z1 = -Infinity; cnt = 0;
          for (let b = 1; b < NB; b++) {
            const q = k * NB + b - 1, o = q * 6;
            if (binN[q] > 0) {
              if (binB[o] < x0) x0 = binB[o]; if (binB[o + 1] < y0) y0 = binB[o + 1]; if (binB[o + 2] < z0) z0 = binB[o + 2];
              if (binB[o + 3] > x1) x1 = binB[o + 3]; if (binB[o + 4] > y1) y1 = binB[o + 4]; if (binB[o + 5] > z1) z1 = binB[o + 5];
              cnt += binN[q];
            }
            const nr = rCount[b];
            if (cnt === 0 || nr === 0) continue;
            const cost = halfArea(x0, y0, z0, x1, y1, z1) * cnt + rArea[b] * nr;
            if (cost < bestCost) { bestCost = cost; bestAxis = k; bestSplit = b; bestNL = cnt; }
          }
        }
      }
      const area = halfArea(N[no], N[no + 1], N[no + 2], N[no + 4], N[no + 5], N[no + 6]);
      const splitCost = bestAxis >= 0 ? 1 + bestCost / (area > 0 ? area : 1e-30) : Infinity;
      // ---- a split: SAH when it keeps every leaf within the depth limit, else a balanced median split (a node within maxLeaf
      // that cannot split within the limit is a leaf; one above maxLeaf always can: every node keeps depth + medianDepth(n) <= limit)
      const sahOk = bestAxis >= 0 && depth + 1 + medianDepth(Math.max(bestNL, n - bestNL), ML) <= this.depthLimit;
      if (n <= ML && (n <= splitCost || !sahOk)) { NU[no + 3] = start; NU[no + 7] = n; continue; }
      const L = this.nodeCount, R = L + 1, lo = L * BVH_NODE_FLOATS, ro = R * BVH_NODE_FLOATS;
      this.nodeCount += 2;
      NU[no + 3] = L; NU[no + 7] = 0;
      NU[lo + 3] = 0; NU[lo + 7] = 0; NU[ro + 3] = 0; NU[ro + 7] = 0;
      let mid: number;
      let lc0 = Infinity, lc1 = Infinity, lc2 = Infinity, lc3 = -Infinity, lc4 = -Infinity, lc5 = -Infinity;
      let rc0 = Infinity, rc1 = Infinity, rc2 = Infinity, rc3 = -Infinity, rc4 = -Infinity, rc5 = -Infinity;
      if (sahOk) {
        const k = bestAxis, sc = k === 0 ? k0 : k === 1 ? k1 : k2, cm = k === 0 ? cmin0 : k === 1 ? cmin1 : cmin2;
        // children's boxes: the unions of their bins
        for (let side = 0; side < 2; side++) {
          let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
          const b0 = side === 0 ? 0 : bestSplit, b1 = side === 0 ? bestSplit : NB;
          for (let b = b0; b < b1; b++) {
            const q = k * NB + b, o = q * 6;
            if (binN[q] === 0) continue;
            if (binB[o] < x0) x0 = binB[o]; if (binB[o + 1] < y0) y0 = binB[o + 1]; if (binB[o + 2] < z0) z0 = binB[o + 2];
            if (binB[o + 3] > x1) x1 = binB[o + 3]; if (binB[o + 4] > y1) y1 = binB[o + 4]; if (binB[o + 5] > z1) z1 = binB[o + 5];
          }
          const co = side === 0 ? lo : ro;
          N[co] = x0; N[co + 1] = y0; N[co + 2] = z0; N[co + 4] = x1; N[co + 5] = y1; N[co + 6] = z1;
        }
        // in-place partition by the same bin rule, tracking each side's centroid box
        let i = start, j = end - 1;
        while (i <= j) {
          const p = O[i], c = p * 3;
          let bin = ((C[c + k] - cm) * sc) | 0;
          if (bin < 0) bin = 0; else if (bin >= NB) bin = NB - 1;
          const x = C[c], y = C[c + 1], z = C[c + 2];
          if (bin < bestSplit) {
            if (x < lc0) lc0 = x; if (y < lc1) lc1 = y; if (z < lc2) lc2 = z; if (x > lc3) lc3 = x; if (y > lc4) lc4 = y; if (z > lc5) lc5 = z;
            i++;
          } else {
            if (x < rc0) rc0 = x; if (y < rc1) rc1 = y; if (z < rc2) rc2 = z; if (x > rc3) rc3 = x; if (y > rc4) rc4 = y; if (z > rc5) rc5 = z;
            O[i] = O[j]; O[j] = p; j--;
          }
        }
        mid = i;
      } else {
        // balanced: sort the range by centroid along the widest centroid axis (rare: depth limit or identical centroids)
        this.forcedMedians++;
        const k = e0 >= e1 && e0 >= e2 ? 0 : e1 >= e2 ? 1 : 2;
        if (k === 0 ? e0 > 0 : k === 1 ? e1 > 0 : e2 > 0) O.subarray(start, end).sort((a, b) => C[a * 3 + k] - C[b * 3 + k]);
        mid = start + (n >> 1);
        for (let side = 0; side < 2; side++) {
          let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
          let c0 = Infinity, c1 = Infinity, c2 = Infinity, c3 = -Infinity, c4 = -Infinity, c5 = -Infinity;
          const i0 = side === 0 ? start : mid, i1 = side === 0 ? mid : end;
          for (let i = i0; i < i1; i++) {
            const p = O[i], b = p * 6, c = p * 3;
            if (Bd[b] < x0) x0 = Bd[b]; if (Bd[b + 1] < y0) y0 = Bd[b + 1]; if (Bd[b + 2] < z0) z0 = Bd[b + 2];
            if (Bd[b + 3] > x1) x1 = Bd[b + 3]; if (Bd[b + 4] > y1) y1 = Bd[b + 4]; if (Bd[b + 5] > z1) z1 = Bd[b + 5];
            const x = C[c], y = C[c + 1], z = C[c + 2];
            if (x < c0) c0 = x; if (y < c1) c1 = y; if (z < c2) c2 = z; if (x > c3) c3 = x; if (y > c4) c4 = y; if (z > c5) c5 = z;
          }
          const co = side === 0 ? lo : ro;
          N[co] = x0; N[co + 1] = y0; N[co + 2] = z0; N[co + 4] = x1; N[co + 5] = y1; N[co + 6] = z1;
          if (side === 0) { lc0 = c0; lc1 = c1; lc2 = c2; lc3 = c3; lc4 = c4; lc5 = c5; }
          else { rc0 = c0; rc1 = c1; rc2 = c2; rc3 = c3; rc4 = c4; rc5 = c5; }
        }
      }
      // right first, so the left child is built next (depth-first; the stack holds at most one entry per level)
      this.push(R, mid, end, depth + 1, rc0, rc1, rc2, rc3, rc4, rc5);
      this.push(L, start, mid, depth + 1, lc0, lc1, lc2, lc3, lc4, lc5);
    }
    return true;
  }
}

/** A finished tree: its own copies of the nodes (nodeCount of them) and the primitive order. */
export interface BvhResult {
  nodes: Float32Array;
  nodeCount: number;
  order: Uint32Array;
  depth: number;
}

/** Builds a whole tree at once (see BvhBuilder). */
export function buildBvh(bounds: Float32Array, count: number, maxLeaf: number, bins = BVH_BINS): BvhResult {
  const b = new BvhBuilder(maxLeaf, bins);
  b.begin(bounds, count);
  b.run(Infinity);
  return {nodes: b.nodes.slice(0, b.nodeCount * BVH_NODE_FLOATS), nodeCount: b.nodeCount, order: b.order.slice(0, count), depth: b.depth};
}

// ------------------------------------------------------------------------------------------------------------------------------
// BLAS

/** One geometry's bottom-level tree (object space; LOCAL node / triangle indices). */
export interface BlasBuild {
  /** BVH_NODE_FLOATS a node: leaf A = first triangle of `tris`, interior A = left child (both local). */
  readonly nodes: Float32Array;
  readonly nodeCount: number;
  /** BLAS_TRI_FLOATS a triangle, in leaf order. */
  readonly tris: Float32Array;
  readonly triCount: number;
  /** Degenerate triangles left out. */
  readonly dropped: number;
  readonly depth: number;
  /** Main-thread build time (ms). */
  readonly buildMs: number;
  /** What the build was made from (blasKeyMatches). */
  readonly key: BlasKey;
}

/** What a BLAS depends on. */
export interface BlasKey {
  readonly position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  readonly positionVersion: number;
  readonly index: THREE.BufferAttribute | null;
  readonly indexVersion: number;
  readonly drawStart: number;
  readonly drawCount: number;
  /** start, count, materialIndex per group (only when `useGroups`). */
  readonly groups: Int32Array | null;
  readonly materialCount: number;
  readonly useGroups: boolean;
}

type PosAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** The version of an attribute's data (an interleaved one's is its buffer's). */
export function attributeVersion(a: PosAttr | null | undefined): number {
  if (!a) return -1;
  return (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.version : (a as THREE.BufferAttribute).version;
}

/** True when `b` was built from `geometry` as it is now (with this material count / group use). */
export function blasKeyMatches(b: BlasBuild, geometry: THREE.BufferGeometry, materialCount: number, useGroups: boolean): boolean {
  const k = b.key, pos = geometry.attributes.position as PosAttr | undefined, idx = geometry.index;
  if (!pos || k.position !== pos || k.positionVersion !== attributeVersion(pos) || k.index !== idx || k.indexVersion !== (idx ? idx.version : -1)) return false;
  if (k.drawStart !== geometry.drawRange.start || k.drawCount !== geometry.drawRange.count) return false;
  if (k.useGroups !== useGroups || k.materialCount !== Math.max(1, materialCount)) return false;
  if (useGroups) {
    const g = geometry.groups, kg = k.groups;
    if (!kg || kg.length !== g.length * 3) return false;
    for (let i = 0; i < g.length; i++) if (kg[i * 3] !== g[i].start || kg[i * 3 + 1] !== g[i].count || kg[i * 3 + 2] !== (g[i].materialIndex ?? 0)) return false;
  }
  return true;
}

/** Linear [0, 1] -> byte. */
const byte = (v: number): number => (v > 0 ? (v < 1 ? Math.round(v * 255) : 255) : 0);

/**
 * A BLAS build as resumable work (one geometry): extract the drawn triangles, build the tree, write the records. run(work) returns
 * true when `result` is ready. `builder` (optional) is a shared BvhBuilder(BLAS_MAX_LEAF) reused across jobs (jobs that share one
 * must run one after the other).
 */
export class BlasJob {
  result: BlasBuild | null = null;
  private phase = 0;
  private readonly key: BlasKey;
  /** Draw ranges: first element, triangle count, material slot (3 per range). */
  private readonly ranges: number[] = [];
  private rangeAt = 0;
  private triAt = 0;
  private readonly candidates: number;
  private verts: Float32Array;
  private meta: Uint32Array;
  private bounds: Float32Array;
  private kept = 0;
  private dropped = 0;
  private ms = 0;
  private readonly builder: BvhBuilder;
  // position access
  private readonly pArr: ArrayLike<number> | null;
  private readonly pStride: number;
  private readonly pOff: number;
  private readonly cArr: ArrayLike<number> | null;
  private readonly cStride: number;
  private readonly cOff: number;
  private readonly cSize: number;
  private readonly colorAttr: PosAttr | null;
  private readonly idxArr: ArrayLike<number> | null;

  constructor(readonly geometry: THREE.BufferGeometry, materialCount: number, useGroups: boolean, builder?: BvhBuilder) {
    if (builder && builder.maxLeaf !== BLAS_MAX_LEAF) throw new Error('BlasJob: the builder must use BLAS_MAX_LEAF');
    this.builder = builder ?? new BvhBuilder(BLAS_MAX_LEAF);
    const pos = geometry.attributes.position as PosAttr | undefined;
    if (!pos) throw new Error('BlasJob: geometry without a position attribute');
    const idx = geometry.index;
    const mc = Math.max(1, materialCount | 0);
    const groups = useGroups ? new Int32Array(geometry.groups.length * 3) : null;
    if (groups) geometry.groups.forEach((g, i) => { groups[i * 3] = g.start; groups[i * 3 + 1] = g.count; groups[i * 3 + 2] = g.materialIndex ?? 0; });
    this.key = {position: pos, positionVersion: attributeVersion(pos), index: idx, indexVersion: idx ? idx.version : -1, drawStart: geometry.drawRange.start, drawCount: geometry.drawRange.count, groups, materialCount: mc, useGroups};
    // three's draw parameters: [max(rangeStart, groupStart), min(dataCount, rangeEnd, groupEnd)), whole triangles from there
    const dataCount = idx ? idx.count : pos.count;
    const rs = geometry.drawRange.start, re = geometry.drawRange.start + geometry.drawRange.count;
    const add = (gs: number, ge: number, slot: number): void => {
      const a = Math.max(rs, gs, 0), e = Math.min(dataCount, re, ge);
      const tris = Math.floor((e - a) / 3);
      if (tris > 0) this.ranges.push(a, tris, Math.min(mc - 1, Math.max(0, slot | 0)));
    };
    if (useGroups) for (const g of geometry.groups) add(g.start, g.start + g.count, g.materialIndex ?? 0);
    else add(0, Infinity, 0);
    let n = 0;
    for (let r = 0; r < this.ranges.length; r += 3) n += this.ranges[r + 1];
    this.candidates = n;
    this.verts = new Float32Array(n * 9);
    this.meta = new Uint32Array(n * 2);
    this.bounds = new Float32Array(n * 6);
    // fast paths: plain or interleaved f32 data, not normalized; anything else goes through getX/Y/Z
    const fast = (a: PosAttr): {arr: ArrayLike<number>; stride: number; off: number} | null => {
      if (a.normalized) return null;
      if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        const ia = a as THREE.InterleavedBufferAttribute;
        return ia.data.array instanceof Float32Array ? {arr: ia.data.array, stride: ia.data.stride, off: ia.offset} : null;
      }
      const ba = a as THREE.BufferAttribute;
      return ba.array instanceof Float32Array ? {arr: ba.array, stride: ba.itemSize, off: 0} : null;
    };
    const fp = fast(pos);
    this.pArr = fp ? fp.arr : null; this.pStride = fp ? fp.stride : 0; this.pOff = fp ? fp.off : 0;
    const col = (geometry.attributes.color as PosAttr | undefined) ?? null;
    this.colorAttr = col;
    const fc = col ? fast(col) : null;
    this.cArr = fc ? fc.arr : null; this.cStride = fc ? fc.stride : 0; this.cOff = fc ? fc.off : 0;
    this.cSize = col ? col.itemSize : 0;
    this.idxArr = idx ? idx.array : null;
  }

  /** Runs about `work` units (Infinity: to the end). True when `result` is ready. */
  run(work = Infinity): boolean {
    if (this.result) return true;
    const t0 = performance.now();
    if (this.phase === 0) { work = this.extract(work); if (this.phase === 0) { this.ms += performance.now() - t0; return false; } }
    if (this.phase === 1) {
      if (!this.builder.run(work)) { this.ms += performance.now() - t0; return false; }
      this.phase = 2;
    }
    this.finish(t0);
    return true;
  }

  private extract(work: number): number {
    const pos = this.key.position, P = this.pArr, ps = this.pStride, po = this.pOff, IX = this.idxArr;
    const V = this.verts, M = this.meta, Bd = this.bounds;
    const col = this.colorAttr, CA = this.cArr, cs = this.cStride, co = this.cOff, csz = this.cSize;
    const r = this.ranges;
    while (this.rangeAt < r.length) {
      const first = r[this.rangeAt], tris = r[this.rangeAt + 1], slot = r[this.rangeAt + 2];
      while (this.triAt < tris) {
        if (work <= 0) return work;
        work -= 4;
        const e = first + this.triAt * 3;
        this.triAt++;
        const i0 = IX ? IX[e] : e, i1 = IX ? IX[e + 1] : e + 1, i2 = IX ? IX[e + 2] : e + 2;
        const k = this.kept * 9;
        if (P) {
          let a = i0 * ps + po; V[k] = P[a]; V[k + 1] = P[a + 1]; V[k + 2] = P[a + 2];
          a = i1 * ps + po; V[k + 3] = P[a]; V[k + 4] = P[a + 1]; V[k + 5] = P[a + 2];
          a = i2 * ps + po; V[k + 6] = P[a]; V[k + 7] = P[a + 1]; V[k + 8] = P[a + 2];
        } else {
          V[k] = pos.getX(i0); V[k + 1] = pos.getY(i0); V[k + 2] = pos.getZ(i0);
          V[k + 3] = pos.getX(i1); V[k + 4] = pos.getY(i1); V[k + 5] = pos.getZ(i1);
          V[k + 6] = pos.getX(i2); V[k + 7] = pos.getY(i2); V[k + 8] = pos.getZ(i2);
        }
        // (f32 values from here: the record holds exactly these)
        const ax = V[k], ay = V[k + 1], az = V[k + 2], bx = V[k + 3], by = V[k + 4], bz = V[k + 5], cx = V[k + 6], cy = V[k + 7], cz = V[k + 8];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const n2 = nx * nx + ny * ny + nz * nz;
        const l1 = e1x * e1x + e1y * e1y + e1z * e1z, l2 = e2x * e2x + e2y * e2y + e2z * e2z;
        if (!(n2 > 1e-14 * l1 * l2) || !(n2 > 0) || !Number.isFinite(n2)) { this.dropped++; continue; }
        let color = TRI_COLOR_NONE;
        if (col) {
          let r0 = 0, g0 = 0, b0 = 0, a0 = 0;
          for (let v = 0; v < 3; v++) {
            const ii = v === 0 ? i0 : v === 1 ? i1 : i2;
            if (CA) {
              const a = ii * cs + co;
              r0 += CA[a]; g0 += CA[a + 1]; b0 += CA[a + 2]; a0 += csz >= 4 ? CA[a + 3] : 1;
            } else {
              r0 += col.getX(ii); g0 += col.getY(ii); b0 += col.getZ(ii); a0 += csz >= 4 ? col.getW(ii) : 1;
            }
          }
          color = (byte(r0 / 3) | (byte(g0 / 3) << 8) | (byte(b0 / 3) << 16) | (byte(a0 / 3) << 24)) >>> 0;
        }
        const t = this.kept;
        M[t * 2] = slot; M[t * 2 + 1] = color;
        const b = t * 6;
        Bd[b] = Math.min(ax, bx, cx); Bd[b + 1] = Math.min(ay, by, cy); Bd[b + 2] = Math.min(az, bz, cz);
        Bd[b + 3] = Math.max(ax, bx, cx); Bd[b + 4] = Math.max(ay, by, cy); Bd[b + 5] = Math.max(az, bz, cz);
        this.kept++;
      }
      this.rangeAt += 3;
      this.triAt = 0;
    }
    this.builder.begin(this.bounds, this.kept);
    this.phase = 1;
    return work;
  }

  private finish(t0: number): void {
    const B = this.builder, n = this.kept, O = B.order, V = this.verts, M = this.meta;
    const tris = new Float32Array(n * BLAS_TRI_FLOATS), TU = new Uint32Array(tris.buffer);
    for (let k = 0; k < n; k++) {
      const p = O[k], s = p * 9, d = k * BLAS_TRI_FLOATS;
      tris[d] = V[s]; tris[d + 1] = V[s + 1]; tris[d + 2] = V[s + 2]; TU[d + 3] = M[p * 2];
      tris[d + 4] = V[s + 3]; tris[d + 5] = V[s + 4]; tris[d + 6] = V[s + 5]; TU[d + 7] = M[p * 2 + 1];
      tris[d + 8] = V[s + 6]; tris[d + 9] = V[s + 7]; tris[d + 10] = V[s + 8]; TU[d + 11] = 0;
    }
    const nodes = B.nodes.slice(0, B.nodeCount * BVH_NODE_FLOATS);
    this.ms += performance.now() - t0;
    this.result = {nodes, nodeCount: B.nodeCount, tris, triCount: n, dropped: this.dropped, depth: B.depth, buildMs: this.ms, key: this.key};
    // (drop the scratch)
    this.verts = this.bounds = new Float32Array(0);
    this.meta = new Uint32Array(0);
  }

  /** Candidate triangles (drawn, before degenerate ones are dropped). */
  get triangles(): number { return this.candidates; }
}

/**
 * The BLAS of `geometry` as three draws it with `materialCount` materials (groups only when `opts.groups`, default materialCount > 1:
 * three uses a geometry's groups only for a material ARRAY), built now (uncached).
 */
export function buildBlas(geometry: THREE.BufferGeometry, materialCount: number, opts: {groups?: boolean; builder?: BvhBuilder} = {}): BlasBuild {
  const job = new BlasJob(geometry, materialCount, opts.groups ?? materialCount > 1, opts.builder);
  job.run(Infinity);
  return job.result!;
}

const BLAS_CACHE = new WeakMap<THREE.BufferGeometry, BlasBuild[]>();
let cacheHits = 0, cacheMisses = 0;

/** A cached, still valid BLAS of `geometry` (null: none — build one with a BlasJob and blasStore it). */
export function blasCached(geometry: THREE.BufferGeometry, materialCount: number, useGroups: boolean): BlasBuild | null {
  const list = BLAS_CACHE.get(geometry);
  if (list) for (const b of list) if (blasKeyMatches(b, geometry, materialCount, useGroups)) { cacheHits++; return b; }
  cacheMisses++;
  return null;
}

/** Keeps `build` as `geometry`'s BLAS for its material count / group use (replacing an older one of the same kind). */
export function blasStore(geometry: THREE.BufferGeometry, build: BlasBuild): void {
  const list = BLAS_CACHE.get(geometry) ?? [];
  const i = list.findIndex(b => b.key.materialCount === build.key.materialCount && b.key.useGroups === build.key.useGroups);
  if (i >= 0) list[i] = build; else list.push(build);
  BLAS_CACHE.set(geometry, list);
}

/** The cached BLAS of `geometry`, built (and cached) now when there is none. */
export function blasFor(geometry: THREE.BufferGeometry, materialCount: number, useGroups = materialCount > 1, builder?: BvhBuilder): BlasBuild {
  const c = blasCached(geometry, materialCount, useGroups);
  if (c) return c;
  const b = buildBlas(geometry, materialCount, {groups: useGroups, builder});
  blasStore(geometry, b);
  return b;
}

/** Session cache counters (diagnostics). */
export function blasCacheStats(): {hits: number; misses: number} {
  return {hits: cacheHits, misses: cacheMisses};
}
