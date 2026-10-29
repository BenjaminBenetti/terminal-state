// Iteration 13 (MAT-A): TSL building blocks of the surface materials under WebGPURenderer (node materials compile to WGSL
// on WebGPU and to GLSL on the renderer's WebGL2 backend). They replace the iteration-04..12 GLSL `onBeforeCompile`
// injections of world/materials.ts (world mapping), world/decay.ts (30-year decay) and world/builder.ts (sign atlas),
// which node materials ignore.
//
// Program sharing: the WebGL hooks gave every world-mapped material ONE shader program (per-material values were
// uniforms). Node materials key their programs by node identity, so every graph here is a module-level singleton and
// per-material values are material PROPERTIES read through `materialReference` (SurfaceNodeMaterial in materials.ts):
// materials with the same hook chain and the same map set share one program, as before.
//
// The station light field (LIGHTING lane, world/lightFieldNode.ts lfFloorAt / lfBandAt) gives the level band of a
// world point; unbound (no station) it returns the iteration-12 no-field values (floor 0, ceiling 3.2, slot 0), like the
// GLSL `#ifndef LF_FLOOR_AT` branch.

import * as THREE from 'three';
import {MaterialReferenceNode, type Node, type NodeBuilder, type NodeMaterial} from 'three/webgpu';
import {
  Fn, context, faceDirection, float, floor, fract, mat3, max, mix, modelWorldMatrix, normalLocal, normalView,
  positionView, positionWorld, select, uniformFlow, uv, varying, vec3, vec4, attribute,
} from 'three/tsl';
import {lfBandAt, lfFloorAt} from './lightFieldNode';

/**
 * Branch-free select (a ternary / WGSL select(), no if-block: uniform control flow), materialised into a variable.
 * three r186's GLSL backend prints uniform-flow selects as an UNPARENTHESISED ternary, so `select(c, a, b).mul(s)` would
 * compile to `c ? a : b * s` (scale on the else branch only); a variable keeps the expression intact on both backends.
 */
export function pick<T extends string>(cond: Node<'bool'>, a: Node<T>, b: Node<T>): Node<T> {
  return (uniformFlow(select(cond, a, b)) as unknown as {toVar(): unknown}).toVar() as Node<T>;
}

/**
 * materialReference that keeps reading the SOURCE material in override passes. three r186 draws shadow maps with
 * `scene.overrideMaterial` and still builds the source material's colorNode into it (for alpha); a plain
 * materialReference then resolves against the override material, which lacks our properties (uniform update crash:
 * updateVector3 of undefined). Falls back to renderer._currentSourceMaterial (set for exactly that draw).
 */
class SurfaceReferenceNode extends MaterialReferenceNode {
  updateReference(state: unknown): unknown {
    const st = state as {material?: Record<string, unknown> | null; renderer?: {_currentSourceMaterial?: unknown}};
    const self = this as unknown as {property: string; reference: unknown};
    let m: unknown = st.material ?? null;
    if (!m || (m as Record<string, unknown>)[self.property] === undefined) m = st.renderer?._currentSourceMaterial ?? m;
    self.reference = m;
    return m;
  }
}

/** A material property as a typed TSL uniform (per material, shared program; source material in override passes). */
export const matRef = <T extends string>(name: string, type: T): Node<T> => new SurfaceReferenceNode(name, type) as unknown as Node<T>;

/**
 * `full` in ordinary passes; `cheap` when building three's shadow-pass override material, which only reads the colour
 * stage's ALPHA (Renderer._getShadowNodes: colorNode.a). Keeps world mapping / decay maths out of every shadow shader.
 */
export function skipInShadowPass<T extends string>(full: Node<T>, cheap: Node<T>, type: T): Node<T> {
  return Fn((builder: NodeBuilder) => ((builder.material as {isShadowPassMaterial?: boolean} | null)?.isShadowPassMaterial ? cheap : full), type)() as unknown as Node<T>;
}

// ---------------------------------------------------------------------------------------------
// Station light field: level band of a world point (LIGHTING lane)

/** Floor height (m) of the level band holding world point `p` (lightFieldNode lfFloorAt; 0 unbound). */
export function lfFloorAtNode(p: Node<'vec3'>): Node<'float'> {
  return Fn(() => float(lfFloorAt(p) as Node<'float'>), 'float')() as unknown as Node<'float'>;
}

/** Level band holding world point `p` as one vec3 (slot, floor, ceiling) (lightFieldNode lfBandAt; 0 / 0 / 3.2 unbound). */
export function lfBandNode(p: Node<'vec3'>): Node<'vec3'> {
  return Fn(() => {
    const b = lfBandAt(p);
    return vec3(b.slot as Node<'float'>, b.floor as Node<'float'>, b.ceil as Node<'float'>);
  }, 'vec3')() as unknown as Node<'vec3'>;
}

// ---------------------------------------------------------------------------------------------
// Value noise (world-space tone variation)

/** GLSL wmHash: fract-based 3D hash in [0, 1). */
export const wmHash = Fn(([p]: [Node<'vec3'>]) => {
  const q = fract(p.mul(0.3183099).add(0.1)).mul(17.0).toVar();
  return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
}).setLayout({name: 'wmHash', type: 'float', inputs: [{name: 'p', type: 'vec3'}]});

/** GLSL wmNoise: trilinear (smoothstep-faded) value noise over wmHash lattice values, in [0, 1). */
export const wmNoise = Fn(([x]: [Node<'vec3'>]) => {
  const i = floor(x).toVar();
  const f0 = fract(x);
  const f = f0.mul(f0).mul(f0.mul(-2.0).add(3.0)).toVar();
  const h = (dx: number, dy: number, dz: number) => wmHash(i.add(vec3(dx, dy, dz)));
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y), f.z);
}).setLayout({name: 'wmNoise', type: 'float', inputs: [{name: 'x', type: 'vec3'}]});

const fractJs = (v: number) => v - Math.floor(v);
/** CPU mirror of wmHash (tests). */
export function wmHashCpu(x: number, y: number, z: number): number {
  const a = fractJs(x * 0.3183099 + 0.1) * 17, b = fractJs(y * 0.3183099 + 0.1) * 17, c = fractJs(z * 0.3183099 + 0.1) * 17;
  return fractJs(a * b * c * (a + b + c));
}
/** CPU mirror of wmNoise (tests). */
export function wmNoiseCpu(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - ix), fy = s(y - iy), fz = s(z - iz);
  const h = (a: number, b: number, c: number) => wmHashCpu(ix + a, iy + b, iz + c);
  const m = (a: number, b: number, t: number) => a + (b - a) * t;
  return m(m(m(h(0, 0, 0), h(1, 0, 0), fx), m(h(0, 1, 0), h(1, 1, 0), fx), fy), m(m(h(0, 0, 1), h(1, 0, 1), fx), m(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}

// ---------------------------------------------------------------------------------------------
// World-space box mapping (materials.ts worldMapped)

/** Per-material world mapping: (1 / span u, 1 / span v, unused, topAlongZ 0 / 1). */
const wmMap = matRef('wmMap', 'vec4');

/**
 * Per VERTEX (as the iteration-04 GLSL, interpolated like vMapUv): the world position projected along the dominant axis
 * of the world normal (instance and model matrices applied), in texture repeats; z = |world normal|.y (vertical faces
 * get the floor grime). Vertical faces: u horizontal (world z on X faces, x on Z faces), v = world height. Tops / bottoms:
 * (x, z), or (z, x) with topAlongZ.
 */
const WM_VARYING = varying(Fn(() => {
  const p = positionWorld.toVar();
  const n = normalLocal.transformDirection(modelWorldMatrix).abs().toVar();
  const side = n.x.greaterThanEqual(n.y).and(n.x.greaterThanEqual(n.z));
  const top = n.y.greaterThanEqual(n.z);
  const st = pick(side, p.zy, pick(top, pick(wmMap.w.greaterThan(0.5), p.zx, p.xz), p.xy));
  return vec3(st.mul(wmMap.xy), n.y);
}, 'vec3')() as unknown as Node<'vec3'>, 'vWm');

/** World-mapped texture coordinate (before each texture's own transform). */
export const wmUv: Node<'vec2'> = WM_VARYING.xy;
/** |world normal|.y of the world-mapped surface (interpolated per vertex). */
export const wmUp: Node<'float'> = WM_VARYING.z;

/** CPU mirror of the world mapping (tests): world point + world normal -> texture coordinate. */
export function worldUvCpu(p: readonly [number, number, number], n: readonly [number, number, number], span: readonly [number, number], topAlongZ = false): [number, number] {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const ax = Math.abs(n[0] / l), ay = Math.abs(n[1] / l), az = Math.abs(n[2] / l);
  const st: [number, number] = ax >= ay && ax >= az ? [p[2], p[1]] : ay >= az ? (topAlongZ ? [p[2], p[0]] : [p[0], p[2]]) : [p[0], p[1]];
  return [st[0] / span[0], st[1] / span[1]];
}

/** The material map slots the iteration-04 GLSL re-mapped (vMapUv ... vAoMapUv). */
export const MAPPED_SLOTS = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap'] as const;
export type MappedSlot = (typeof MAPPED_SLOTS)[number];

/** True when texture node `tex` samples one of `slots` of the material being built (the default material maps). */
function samplesMaterialMap(tex: {value?: unknown}, builder: NodeBuilder, slots: readonly MappedSlot[]): boolean {
  const v = tex.value, m = builder.material as unknown as Record<string, unknown> | null;
  return !!v && !!m && slots.some(k => m[k] === v);
}

/**
 * A material context that samples its own maps (`slots`) at `coord` instead of the mesh uv. three's TextureNode asks
 * `context.getUV` for every texture without an explicit uv and still applies the texture's own transform (offset /
 * repeat), like `mapTransform * vec3(wmUv, 1)` in GLSL. Textures of other systems (explicit uvs) are untouched.
 * The normal map is built under a context that clears getUV (three Normal.js), so world-mapped normals use wmNormalNode.
 */
export function mapUvContext(coord: Node<'vec2'>, slots: readonly MappedSlot[] = MAPPED_SLOTS) {
  return context({getUV: (tex: {value?: unknown}, builder: NodeBuilder) => (samplesMaterialMap(tex, builder, slots) ? coord : null)});
}

/** The shared world-mapping context of every world-mapped material. */
export const WM_CONTEXT = mapUvContext(wmUv);

/**
 * Tangent-space normal map at the world-mapped coordinate, with the tangent frame from the screen derivatives of THAT
 * coordinate (three WebGL getTangentFrame( -vViewPosition, normal, vNormalMapUv ); three's TSL default derives it from
 * the mesh uv, which would rotate / flip the bumps on world-mapped faces). normalScale and DoubleSide faceDirection as
 * WebGL. Without a normal map: the geometry normal (three's default).
 */
export const WM_NORMAL = Fn((builder: NodeBuilder) => {
  const m = builder.material as unknown as THREE.MeshStandardMaterial;
  if (!m.normalMap) return normalView;
  const texel = matRef('normalMap', 'texture') as unknown as Node<'vec4'>;
  const n0 = texel.xyz.mul(2.0).sub(1.0);
  const mapN = vec3(n0.xy.mul(matRef('normalScale', 'vec2')), n0.z);
  const N = normalView;
  const q0 = positionView.dFdx(), q1 = positionView.dFdy();
  const st0 = wmUv.dFdx(), st1 = wmUv.dFdy();
  const q1perp = q1.cross(N), q0perp = N.cross(q0);
  const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
  const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  const det = max(T.dot(T), B.dot(B));
  const scale = pick(det.equal(0.0), float(0.0), det.inverseSqrt());
  const side = m.side === THREE.DoubleSide ? faceDirection : float(1);
  return mat3(T.mul(scale).mul(side), B.mul(scale).mul(side), N).mul(mapN).normalize();
}, 'vec3')().context({getUV: (tex: {value?: unknown}, builder: NodeBuilder) => (samplesMaterialMap(tex, builder, ['normalMap']) ? wmUv : null)});

/**
 * Iteration 08 sign atlas (builder.ts): instanced faces carry their atlas cell (aUvRect = u0, v0, w, h) and sample the
 * page at uv * rect.zw + rect.xy (then the map transform), as `vMapUv = mapTransform * (uv * aUvRect.zw + aUvRect.xy)`.
 */
export const SIGN_ATLAS_UV: Node<'vec2'> = varying(Fn(() => {
  const r = attribute('aUvRect', 'vec4') as unknown as Node<'vec4'>;
  return uv().mul(r.zw).add(r.xy);
}, 'vec2')() as unknown as Node<'vec2'>, 'vSignUv');
export const SIGN_ATLAS_CONTEXT = mapUvContext(SIGN_ATLAS_UV, ['map']);

// ---------------------------------------------------------------------------------------------
// Hook helpers

/**
 * Memoised hook stage function: the same previous node always yields the same node object, so materials with the same
 * hook chain share one program (node identity keys three's program cache) and re-applying hooks is stable.
 */
export function sharedStage(build: (prev: Node | null) => Node): (prev: Node | null) => Node {
  const byPrev = new WeakMap<Node, Node>();
  let fromBase: Node | null = null;
  return prev => {
    if (!prev) return (fromBase ??= build(null));
    let n = byPrev.get(prev);
    if (!n) byPrev.set(prev, (n = build(prev)));
    return n;
  };
}

/** vec4 of a colour-stage input (the material's default colour when the chain starts empty). */
export const asColor = (prev: Node | null, fallback: Node): Node<'vec4'> => vec4((prev ?? fallback) as Node<'vec4'>) as unknown as Node<'vec4'>;

/** True for NodeMaterials (three/webgpu); surface factories only make these. */
export const isNodeMaterial = (m: THREE.Material): m is NodeMaterial => (m as {isNodeMaterial?: boolean}).isNodeMaterial === true;

