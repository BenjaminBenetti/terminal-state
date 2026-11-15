// Task track3-eaton-centre-20261031 (lane PERF): ATTRIBUTE INSTANCING — one shared GPU program per instanced material
// instead of one program per InstancedMesh.
//
// three r186's node builders put an InstancedMesh's matrices into a uniform buffer whenever `count * 64 B` fits the backend's
// uniform-block limit (WebGL 2: MAX_UNIFORM_BLOCK_SIZE, 16-64 KiB = up to 256-1024 instances; WebGPU: the binding-size
// limit). That block is declared `NodeBuffer_<node id> { mat4 buffer<node id>[count]; }` with a GLOBAL node id, so every
// InstancedMesh — and every render context it is drawn in (scene pass, flashlight shadow pass) — generates its own vertex
// shader and links its own GPU program (the WebGL backend caches programs by shader code). On a software rasterizer
// (Firefox + Mesa llvmpipe in the studio QA, and players without a GPU driver) every program is JIT-compiled into system RAM.
// The mall's start view on the pit platform sees all seven storeys through the atrium: ~740 small InstancedMeshes in view
// = ~740 unique programs in the main pass (+ up to ~700 in the shadow pass), against ~60 in the Office's start view
// (lanes/PERF.notes; tests/mall-budget.test.ts). Its load climbed past the studio's fixed 6.0 GiB guard.
//
// Above the limit three already streams the matrices as four instanced vec4 attributes (InstancedInterleavedBuffer): the same
// transform (mat4 from the same 16 floats), and identical shader code for every InstancedMesh with the same material, so they
// share one program. `setAttributeInstancing(true)` makes the builders take that path for EVERY InstancedMesh built while it
// is on (the limit reads 0 for instanced objects only: skinned meshes keep their uniform-buffer bone matrices). Instance
// matrix / colour updates, counts and culling behave as on the attribute path three already uses for big instance counts
// (light tubes, shelf filler); nothing about the drawn result changes.
//
// Scope: Game.buildSection turns it on for the mall (layout.mall) and off for every other level, so the Subway / Office build
// their render objects exactly as before (byte-identical shaders there). Render objects keep the path they were built with.

import {NodeBuilder} from 'three/webgpu';

/** Set on ONE builder: it takes the attribute path whatever the switch says (render/sharedInstancing.ts: a shared build). */
const FORCED = Symbol('attributeInstancing');

interface GeometryAttr { isInterleavedBufferAttribute?: boolean; data?: object }
interface InstancedHost { isInstancedMesh?: boolean; instanceColor?: unknown; geometry?: {attributes?: Record<string, GeometryAttr>} | null }
interface LimitHost { object?: InstancedHost | null; [FORCED]?: boolean }
type LimitFn = (this: LimitHost) => number;

/**
 * What one pipeline may bind: WebGPU's default limits (maxVertexBuffers / maxVertexAttributes — the game requests no higher ones, and
 * WebGL 2 guarantees 16 attributes).
 */
export const VERTEX_LIMITS = {buffers: 8, attributes: 16} as const;

/**
 * Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD): true when `object`'s geometry leaves room for the attribute
 * path's instance data — one more vertex buffer with four vec4 attributes for the matrices, and one buffer / attribute for instance
 * colours. Counted from the geometry's whole attribute list (a build may use fewer: the conservative side). The bullet-crater pool
 * (damage/craters.ts: position, normal, uv and five instanced attributes = 8 buffers) does NOT fit: on the attribute path its pipeline
 * would ask for 9 vertex buffers, which WebGPU rejects — such a pool keeps three's own choice (its matrices in a uniform buffer).
 */
export function instanceAttributesFit(object: unknown): boolean {
  const o = object as InstancedHost | null | undefined;
  const attrs = o?.geometry?.attributes;
  if (!attrs) return true;
  const buffers = new Set<object>();
  let attributes = 0;
  for (const name in attrs) {
    const a = attrs[name];
    if (!a) continue;
    attributes++;
    buffers.add(a.isInterleavedBufferAttribute === true && a.data ? a.data : a);
  }
  const colour = o.instanceColor ? 1 : 0;
  return buffers.size + 1 + colour <= VERTEX_LIMITS.buffers && attributes + 4 + colour <= VERTEX_LIMITS.attributes;
}

let attribute = false;
let installed: LimitFn | null = null;

/** Install the builder hook once (idempotent); the hook is inert while attribute instancing is off. */
function install(): void {
  if (installed) return;
  const proto = NodeBuilder.prototype as unknown as {getUniformBufferLimit: LimitFn};
  const inner = proto.getUniformBufferLimit;
  installed = inner;
  // three reads this limit for instance matrices (accessors/Instance.js), bone matrices (Skinning.js) and range() values; only an
  // InstancedMesh object is affected, and on it only the instance-matrix choice (no range() / skinning on instanced meshes here).
  proto.getUniformBufferLimit = function (this: LimitHost): number {
    // (lane LOAD: a pool with no room for the instance attributes keeps three's own choice — instanceAttributesFit)
    return (attribute || this[FORCED] === true) && this.object?.isInstancedMesh === true && instanceAttributesFit(this.object) ? 0 : inner.call(this);
  };
}

/**
 * Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD): this ONE builder takes the attribute path, switch on or off —
 * a build shared by every pool of a material (render/sharedInstancing.ts) must not hold a pool's instance count.
 */
export function forceAttributeInstancing(builder: object): void {
  install();
  (builder as LimitHost)[FORCED] = true;
}

/** Attribute instancing on / off for render objects built from now on (the mall: on; Subway / Office: off). */
export function setAttributeInstancing(on: boolean): void {
  install();
  attribute = on;
}

/** Whether InstancedMeshes built now take the shared attribute path (QA / tests). */
export function attributeInstancing(): boolean {
  return attribute;
}
