// Iteration 13 (MAT-B): TSL / node-material helpers for the damage effects (craters, prop damage, zombie wounds), the
// WebGPURenderer replacement for the iteration-06 GLSL snippets (damage/glsl.ts, retired) and render/shaderHooks.ts
// clones. One TSL graph compiles to WGSL on the WebGPU backend and to GLSL on the renderer's WebGL 2 fallback.
//
//  - dmgHash / dmgNoise: the same value noise as the GLSL `dmgHash` / `dmgNoise` (emitted once as shader functions);
//  - dmgPerturb: three's perturbNormalArb (bump from screen-space height derivatives) under our own name;
//  - objectData(key, n): n vec4 of PER-OBJECT data read from `object.userData[key]` (a Float32Array) at every draw — the
//    same mechanism three's skinning uses for `skeleton.boneMatrices`. One shared node graph therefore serves every
//    damaged prop / wounded actor (no per-instance node build or shader compile, the old shared program cache); a mesh
//    without the data (a clone, a warm-up mesh) reads zeros = no damage;
//  - toNodeMaterial / cloneForDamage: own node-material copies (classic GLTF materials -> the matching node class; node
//    materials keep their factory / node-hook output nodes as the base of the damage stages);
//  - memoNode: one output node per (input node, variant) so clones of one source material share their graph.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, MeshLambertNodeMaterial, MeshPhongNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, ReferenceNode, type Node, type NodeMaterial} from 'three/webgpu';
import {Fn, abs, cross, dot, faceDirection, float, floor, fract, mix, normalize, sign, vec3} from 'three/tsl';

// biome-ignore lint: TSL graphs are built from loosely typed nodes (three's typings are per-node generic)
export type TNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** GLSL dmgHash: fract-based 3D hash. */
export const dmgHash = Fn(([pIn]: [TNode]) => {
  const p = fract(vec3(pIn).mul(0.3183099).add(0.1)).mul(17.0).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}).setLayout({name: 'dmgHash', type: 'float', inputs: [{name: 'p', type: 'vec3'}]}) as unknown as (p: TNode) => TNode;

/** GLSL dmgNoise: trilinear value noise of dmgHash (smoothstep fade). */
export const dmgNoise = Fn(([xIn]: [TNode]) => {
  const x = vec3(xIn).toVar();
  const i = floor(x).toVar();
  const f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2))).toVar();
  const h = (dx: number, dy: number, dz: number) => dmgHash(i.add(vec3(dx, dy, dz)));
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y),
    f.z,
  );
}).setLayout({name: 'dmgNoise', type: 'float', inputs: [{name: 'x', type: 'vec3'}]}) as unknown as (x: TNode) => TNode;

/**
 * perturbNormalArb (three bumpmap): view-space normal bumped by the screen-space height gradient `dHdxy`. Call at the top
 * level of a slot (derivatives), select the result where the bump applies.
 */
export function dmgPerturb(surfPos: TNode, surfNorm: TNode, dHdxy: TNode): TNode {
  const sx: TNode = normalize(surfPos.dFdx());
  const sy: TNode = normalize(surfPos.dFdy());
  const r1: TNode = cross(sy, surfNorm);
  const r2: TNode = cross(surfNorm, sx);
  const fDet: TNode = dot(sx, r1).mul(faceDirection);
  const grad = sign(fDet).mul(dHdxy.x.mul(r1).add(dHdxy.y.mul(r2)));
  return normalize(abs(fDet).mul(surfNorm).sub(grad));
}

// ---------------------------------------------------------------------------------------------
// Per-object data

const zeroCache = new Map<number, Float32Array>();

/** Reads `object.userData[key]` (Float32Array, count * 4 floats) per draw; zeros when absent / malformed. */
class ObjectDataNode extends (ReferenceNode as unknown as new (property: string, type: string, object: unknown, count: number) => {reference: unknown; element(i: TNode): TNode}) {
  // (not `length`: TSL's node proxy method-chains `length()`)
  constructor(readonly key: string, readonly vec4Count: number) {
    super(`userData.${key}`, 'vec4', null, vec4Count);
  }

  getValueFromReference(object: unknown = this.reference): Float32Array {
    const v = (object as {userData?: Record<string, unknown>} | null)?.userData?.[this.key];
    if (v instanceof Float32Array && v.length >= this.vec4Count * 4) return v;
    let z = zeroCache.get(this.vec4Count);
    if (!z) zeroCache.set(this.vec4Count, (z = new Float32Array(this.vec4Count * 4)));
    return z;
  }
}

/** `count` vec4 of per-object data (`object.userData[key]`); `.element(i)` reads vec4 i. */
export function objectData(key: string, count: number): {element(i: TNode): TNode} {
  return new ObjectDataNode(key, count) as unknown as {element(i: TNode): TNode};
}

/** Writes a Matrix4 (column-major) into 4 consecutive vec4 of a data array starting at vec4 `at`. */
export function writeMat4(data: Float32Array, at: number, m: THREE.Matrix4): void {
  data.set(m.elements, at * 4);
}

// ---------------------------------------------------------------------------------------------
// Materials

type AnyMat = THREE.Material & Record<string, unknown>;
const NODE_CLASS: [string, new () => NodeMaterial][] = [
  ['isMeshPhysicalMaterial', MeshPhysicalNodeMaterial as unknown as new () => NodeMaterial],
  ['isMeshStandardMaterial', MeshStandardNodeMaterial as unknown as new () => NodeMaterial],
  ['isMeshLambertMaterial', MeshLambertNodeMaterial as unknown as new () => NodeMaterial],
  ['isMeshPhongMaterial', MeshPhongNodeMaterial as unknown as new () => NodeMaterial],
  ['isMeshBasicMaterial', MeshBasicNodeMaterial as unknown as new () => NodeMaterial],
];

/** True for lit standard-like materials (classic MeshStandardMaterial or any MeshStandard / Physical node material). */
export function isStandardLike(m: THREE.Material | null | undefined): boolean {
  const x = m as unknown as Record<string, unknown> | null | undefined;
  return !!x && !!(x.isMeshStandardMaterial || x.isMeshStandardNodeMaterial || x.isMeshPhysicalNodeMaterial);
}

/**
 * An OWN node-material copy of `src`:
 *  - node material: `clone()` (three copies its node slots by reference: the factory / earlier node-hook output becomes the
 *    base of later damage stages, so clones of one source share one graph) + alphaTest, which NodeMaterial.copy skips;
 *  - classic material (GLTF / canvas): a new node material of the matching class with every property copied the way
 *    three's own NodeLibrary.fromMaterial converts it, but with value objects (colours, vectors) deep-copied so the copy
 *    can be tinted / flashed without touching the source. Textures are shared.
 * Returns null for material types without a node counterpart (callers then leave the mesh undamaged).
 */
export function toNodeMaterial(src: THREE.Material): NodeMaterial | null {
  const s = src as AnyMat;
  if (s.isNodeMaterial) {
    const c = src.clone() as unknown as NodeMaterial;
    c.alphaTest = src.alphaTest;
    return c;
  }
  const entry = NODE_CLASS.find(([flag]) => s[flag] === true);
  if (!entry) return null;
  const n = new entry[1]() as unknown as AnyMat;
  for (const key in s) {
    // never the renderer's dispose listeners (`_listeners`) or identity fields; `_alphaTest` / physical `_clearcoat`... are copied
    if (/^(id|uuid|type|version|userData|isMaterial|_listeners)$/.test(key)) continue;
    const v = s[key];
    if (typeof v === 'function') continue;
    if (v && typeof v === 'object' && !(v as {isTexture?: boolean}).isTexture && typeof (v as {clone?: unknown}).clone === 'function' && !Array.isArray(v)) n[key] = (v as {clone(): unknown}).clone();
    else if (Array.isArray(v)) n[key] = v.map(e => (e && typeof e === 'object' && typeof (e as {clone?: unknown}).clone === 'function' ? (e as {clone(): unknown}).clone() : e));
    else n[key] = v;
  }
  n.userData = JSON.parse(JSON.stringify(src.userData ?? {}));
  n.name = src.name;
  (n as unknown as THREE.Material).needsUpdate = true;
  return n as unknown as NodeMaterial;
}

// ---------------------------------------------------------------------------------------------
// Memoized hook outputs: clones that share their base node share the damage node (one graph, one pipeline)

const NULL_KEY = {};
const memo = new WeakMap<object, Map<string, Node>>();

/** One node per (prev node or null, variant key): `make` runs once per pair. */
export function memoNode(prev: Node | null, variant: string, make: () => Node): Node {
  const k = (prev ?? NULL_KEY) as object;
  let m = memo.get(k);
  if (!m) memo.set(k, (m = new Map()));
  let n = m.get(variant);
  if (!n) m.set(variant, (n = make()));
  return n;
}
