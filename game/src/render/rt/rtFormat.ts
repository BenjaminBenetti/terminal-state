// Task rt-flashlight-compute-20261115-233136 (lane BVH): the packed scene the traced flashlight bounce reads — the layout and the
// buffers render/rt/rtScene.ts fills, render/rt/rtTrace.ts (the CPU reference) and the GPU kernels traverse. Kept free of the scene
// code so a reader (the trace, a test, the GPU upload) imports only this.
//
// Every array is a stream of vec4<f32>; u32 fields are bit patterns written through a Uint32Array view of the same buffer.
//  - blasNodes (BVH_NODE_FLOATS a node: [min.xyz, A, max.xyz, B]): every BLAS concatenated, A rebased to GLOBAL indices
//    (leaf: A = first triangle in blasTris, B = count; interior: B = 0, A = left child node, right = A + 1).
//  - blasTris (BLAS_TRI_FLOATS a triangle: [v0.xyz, matSlot u32, v1.xyz, color u32, v2.xyz, flags u32], object space).
//  - tlas, regions at vec4 offsets given by `layout`:
//      static TLAS nodes (2 vec4 a node), dynamic TLAS nodes (fixed capacity): leaf A = first INSTANCE index (global: instance i
//        lives at vec4 layout.instances + RT_INSTANCE_VEC4 * i), B = count; interior A = left child, LOCAL to that tree; root = 0.
//      instances (RT_INSTANCE_VEC4 = 6 vec4 each): the static ones (indices 0 .. staticInstanceCount-1), then the dynamic region
//        (indices (dynamicInstances - instances) / 6 + k):
//        v0..v2 WORLD -> OBJECT affine rows (row r = [m_r0, m_r1, m_r2, m_r3]: p_obj = W [p_world, 1])
//        v3 [blasRoot u32 (GLOBAL node index), materialBase u32, flags u32, type u32]
//           flags: RT_INST_DISABLED (skip it), RT_INST_PROXY (an approximation: a character's capsule)
//           type:  RT_TYPE_MESH (a BLAS) or RT_TYPE_CAPSULE (an upright cylinder with flat caps, world space; W = identity)
//        v4 mesh: [tint r, g, b, 0] (InstancedMesh.instanceColor, linear; 1, 1, 1 without) / capsule: [x, z, radius, y0]
//        v5 mesh: 0 / capsule: [y1, 0, 0, 0]
//      materials (1 vec4 each): [albedo r, g, b (linear, diffuse-effective), flags u32 (RT_MAT_VERTEX_COLOR: x the tri's colour)]
//  Counts past a region's count are stale (never read). Capacities only grow until the scene is cleared.

export {BVH_NODE_FLOATS, BLAS_TRI_FLOATS, BVH_MAX_DEPTH, TRI_COLOR_NONE} from './bvh';

/** vec4 per instance record. */
export const RT_INSTANCE_VEC4 = 6;
/** Instance flags (v3.z). */
export const RT_INST_DISABLED = 1;
export const RT_INST_PROXY = 2;
/** Instance types (v3.w). */
export const RT_TYPE_MESH = 0;
export const RT_TYPE_CAPSULE = 1;
/** Material flag (materials[i].w): multiply by the triangle's vertex colour. */
export const RT_MAT_VERTEX_COLOR = 1;
/** Dirty vec4 ranges kept before they are merged into one. */
export const RT_DIRTY_MAX = 64;

/** Where the tlas regions are (vec4 offsets) and how full they are. */
export interface RtSceneLayout {
  staticNodes: number; staticNodeCount: number; staticNodeCap: number;
  dynamicNodes: number; dynamicNodeCap: number; dynamicNodeCount: number;
  instances: number; staticInstanceCount: number; staticInstanceCap: number;
  dynamicInstances: number; dynamicInstanceCap: number; dynamicInstanceCount: number;
  materials: number; materialCount: number; materialCap: number;
  /** The material index capsules use. */
  bodyMaterial: number;
  /** Size of `tlas` in vec4. */
  vec4Count: number;
}

export const emptyLayout = (): RtSceneLayout => ({
  staticNodes: 0, staticNodeCount: 0, staticNodeCap: 0, dynamicNodes: 0, dynamicNodeCap: 0, dynamicNodeCount: 0,
  instances: 0, staticInstanceCount: 0, staticInstanceCap: 0, dynamicInstances: 0, dynamicInstanceCap: 0, dynamicInstanceCount: 0,
  materials: 0, materialCount: 0, materialCap: 0, bodyMaterial: 0, vec4Count: 0,
});

/**
 * The packed scene. The arrays are replaced when they grow (read them from here each time); their lengths are capacities, the
 * counts say what is used. Upload protocol: blasVersion / layoutVersion bump on any change of the BLAS arrays / of the tlas offsets
 * or size; the dirty ranges say what changed since the last markUploaded() (blas: [start, end) in nodes / triangles; tlas: [start,
 * end) vec4 pairs in tlasDirty, tlasDirtyCount of them). A grown array is wholly dirty.
 */
export class RtSceneBuffers {
  blasNodes = new Float32Array(0);
  blasNodesU32 = new Uint32Array(0);
  blasNodeCount = 0;
  blasTris = new Float32Array(0);
  blasTrisU32 = new Uint32Array(0);
  blasTriCount = 0;
  tlas = new Float32Array(0);
  tlasU32 = new Uint32Array(0);
  readonly layout: RtSceneLayout = emptyLayout();
  blasVersion = 0;
  layoutVersion = 0;
  /** Bumps on every tlas write (any region). */
  tlasVersion = 0;
  /** Dirty BLAS spans since markUploaded (start > end: none). */
  blasDirtyNodeStart = Infinity;
  blasDirtyNodeEnd = 0;
  blasDirtyTriStart = Infinity;
  blasDirtyTriEnd = 0;
  /** Dirty tlas vec4 spans since markUploaded: [start, end) pairs. */
  readonly tlasDirty = new Uint32Array(2 * RT_DIRTY_MAX);
  tlasDirtyCount = 0;

  /** The consumer has uploaded everything: the dirty spans start over. */
  markUploaded(): void {
    this.blasDirtyNodeStart = this.blasDirtyTriStart = Infinity;
    this.blasDirtyNodeEnd = this.blasDirtyTriEnd = 0;
    this.tlasDirtyCount = 0;
  }

  /** Notes tlas vec4 [start, end) as changed (merged with an overlapping / touching span; too many spans become one). */
  dirtyTlas(start: number, end: number): void {
    if (!(end > start)) return;
    this.tlasVersion++;
    const D = this.tlasDirty;
    for (let i = 0; i < this.tlasDirtyCount; i++) {
      const a = D[i * 2], b = D[i * 2 + 1];
      if (start <= b && end >= a) { D[i * 2] = Math.min(a, start); D[i * 2 + 1] = Math.max(b, end); return; }
    }
    if (this.tlasDirtyCount === RT_DIRTY_MAX) {
      let a = start, b = end;
      for (let i = 0; i < this.tlasDirtyCount; i++) { a = Math.min(a, D[i * 2]); b = Math.max(b, D[i * 2 + 1]); }
      D[0] = a; D[1] = b; this.tlasDirtyCount = 1;
      return;
    }
    D[this.tlasDirtyCount * 2] = start; D[this.tlasDirtyCount * 2 + 1] = end;
    this.tlasDirtyCount++;
  }

  dirtyBlas(nodeStart: number, nodeEnd: number, triStart: number, triEnd: number): void {
    this.blasVersion++;
    if (nodeEnd > nodeStart) { this.blasDirtyNodeStart = Math.min(this.blasDirtyNodeStart, nodeStart); this.blasDirtyNodeEnd = Math.max(this.blasDirtyNodeEnd, nodeEnd); }
    if (triEnd > triStart) { this.blasDirtyTriStart = Math.min(this.blasDirtyTriStart, triStart); this.blasDirtyTriEnd = Math.max(this.blasDirtyTriEnd, triEnd); }
  }
}
