// Task studio-baked-lighting-reflections-20261114-050258-01: the station's CACHED REFLECTION PROBES (world/reflectionProbes.ts) on
// metal and glass, as TSL — WGSL on the WebGPU backend, GLSL on the WebGL2 fallback.
//
//  - LightFieldReflectLight / LightFieldReflectNode: the station field light WITH reflections. A station built with probes puts
//    this light in the scene instead of the plain LightFieldLight (world/lightFieldNode.ts); a station without (Enhanced lighting off,
//    reflections off or unsupported, the Reactor) keeps the plain one — so with reflections off every material compiles to exactly
//    the program it always had, and no probe texture is ever bound. One instance per session of each (stable light sets).
//  - The node shades the field exactly as LightFieldNode does, then — only for a material that is metal or glass (reflectClass) —
//    adds the probes' radiance along the reflected ray to the lighting context's `radiance`. three's physical model does the rest:
//    Fresnel, the roughness / metalness response, the base colour of a metal, ambient occlusion. Nothing is added to the diffuse
//    light, and nothing at all to a rough dielectric (walls, floors, cloth, skin): no mirror floors, no extra ambient.
//  - REFL: GLOBAL texture / uniform nodes bound to the active station (bindReflectionProbes), like the field's LF. Materials compile
//    against zero placeholders of the same formats; a station swap changes values only (and makes every render object re-read its
//    texture bindings once: render/bindingRefresh.ts).
//  - Per reflective fragment: the level slot the field already picked, one filtered fetch of the four probe weights and one
//    unfiltered fetch of their ids, then per probe that really weighs in (one in a block's core, two along an edge, four at a corner):
//    its position / box (three texel loads), a box-projected lookup direction and two atlas samples (the two roughness levels).
//    A probe's light is scaled by the field's light at the surface (flicker, the ride mask, a dark side room).
//  - No uniform buffer is added in any stage (plain render-group uniforms: the group LF already binds); three sampled textures more
//    on a reflective material (atlas, meta, grid), none on any other.

import * as THREE from 'three';
import {PhysicalLightingModel, type Node, type NodeBuilder} from 'three/webgpu';
import {
  If, abs, cameraWorldMatrix, clamp, float, floor, int, ivec2, ivec3, materialOpacity, max, metalness, min, mix, mod, normalView, positionWorld, pow4,
  reflectView, renderGroup, roughness, select, step, texture, texture3D, uniform, vec2, vec3,
} from 'three/tsl';
import {LightFieldLight, LightFieldNode, type LightFieldSampleNodes, type NodeLibraryLike} from './lightFieldNode';
import {PROBE_COLS, PROBE_GUTTER, PROBE_LEVELS, PROBE_LEVEL_PER_ROUGHNESS, PROBE_RATIO_MAX, octEncode, probeAtlasLayout, probeBytes, probeTileOrigin, type BakedProbes} from './reflectionProbes';
import {CELL} from '../gen/grid';
import {refreshTextureBindings} from '../render/bindingRefresh';
import {reflectTagOf, type ReflectClass} from '../render/reflectTag';

// TSL nodes are chained untyped here (three's TSL typings reject most mixed-type chains).
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;
/** select(), materialised (inside a uniformFlow context the GLSL builder prints unparenthesised ternaries). */
const sel = (c: N, a: N, b: N): N => n(select(c, a, b)).toVar();

// ---------------------------------------------------------------------------------------------
// Textures

function configureAtlas(t: THREE.DataTexture): THREE.DataTexture {
  t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
function configureMeta(t: THREE.DataTexture): THREE.DataTexture {
  t.format = THREE.RGBAFormat; t.type = THREE.FloatType;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
function configureGrid(t: THREE.Data3DTexture): THREE.Data3DTexture {
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

const PH_LAYOUT = probeAtlasLayout(4, 1);
const ATLAS_PH = configureAtlas(new THREE.DataTexture(new Uint16Array(PH_LAYOUT.width * PH_LAYOUT.height * 4), PH_LAYOUT.width, PH_LAYOUT.height));
ATLAS_PH.name = 'reflection-atlas-placeholder';
const META_PH = configureMeta(new THREE.DataTexture(new Float32Array(12), 1, 3));
META_PH.name = 'reflection-meta-placeholder';
const GRID_PH = configureGrid(new THREE.Data3DTexture(new Uint8Array(8), 1, 1, 2));
GRID_PH.name = 'reflection-grid-placeholder';

/** A 'metal' candidate's fragment looks the probes up when its metalness is above this, or its roughness below REFLECT_ROUGHNESS_MAX. */
export const REFLECT_METALNESS_MIN = 0.2;
export const REFLECT_ROUGHNESS_MAX = 0.45;

/** One station's probes on the GPU. */
export class ReflectionProbeVolume {
  readonly atlas: THREE.DataTexture;
  readonly meta: THREE.DataTexture;
  readonly grid: THREE.Data3DTexture;
  readonly bytes: number;
  constructor(readonly probes: BakedProbes) {
    const L = probes.layout;
    this.atlas = configureAtlas(new THREE.DataTexture(probes.atlas, L.width, L.height));
    this.atlas.name = 'reflection-atlas';
    this.meta = configureMeta(new THREE.DataTexture(probes.meta, Math.max(1, probes.count), 3));
    this.meta.name = 'reflection-meta';
    this.grid = configureGrid(new THREE.Data3DTexture(probes.grid, probes.gridW, probes.gridH, probes.gridDepth));
    this.grid.name = 'reflection-grid';
    this.bytes = probeBytes(probes);
  }
  dispose(): void {
    this.atlas.dispose(); this.meta.dispose(); this.grid.dispose();
  }
}

/**
 * The global reflection nodes. atlasInfo = atlas width, height (px), the sharpest tile's edge (px), probe tiles per row;
 * levelY = first texel row of each roughness level's band; gridInfo = grid width, height (cells), slices, metres per cell;
 * params.x = strength (0 while nothing is bound: the probes add nothing).
 */
export const REFL = {
  atlas: texture(ATLAS_PH),
  meta: texture(META_PH),
  grid: texture3D(GRID_PH),
  atlasInfo: uniform(new THREE.Vector4(PH_LAYOUT.width, PH_LAYOUT.height, PH_LAYOUT.tile, PROBE_COLS)).setGroup(renderGroup),
  levelY: uniform(new THREE.Vector4(...PH_LAYOUT.levelY)).setGroup(renderGroup),
  gridInfo: uniform(new THREE.Vector4(1, 1, 2, CELL)).setGroup(renderGroup),
  params: uniform(new THREE.Vector4(0, 0, 0, 0)).setGroup(renderGroup),
};

/** Overall reflection strength (1 = what the probes hold; QA / tuning). */
export const REFLECTION_TUNING = {strength: 1};

let active: ReflectionProbeVolume | null = null;

/** The probes currently bound (null: none). */
export function activeReflectionProbes(): ReflectionProbeVolume | null {
  return active;
}

/**
 * Bind a station's probes to the global nodes (null: unbind -> placeholders, strength 0). A changed texture makes every render
 * object re-read its bindings at its next draw (render/bindingRefresh.ts), exactly as the light field's swap does: bind the new
 * station's first, retire the old one's textures after.
 */
export function bindReflectionProbes(v: ReflectionProbeVolume | null): void {
  const atlas = v ? v.atlas : ATLAS_PH, meta = v ? v.meta : META_PH, grid = v ? v.grid : GRID_PH;
  if (REFL.atlas.value !== atlas || REFL.meta.value !== meta || REFL.grid.value !== grid) refreshTextureBindings();
  active = v;
  REFL.atlas.value = atlas; REFL.meta.value = meta; REFL.grid.value = grid;
  const L = v ? v.probes.layout : PH_LAYOUT;
  REFL.atlasInfo.value.set(L.width, L.height, L.tile, L.cols);
  REFL.levelY.value.set(L.levelY[0], L.levelY[1], L.levelY[2], L.levelY[3]);
  if (v) REFL.gridInfo.value.set(v.probes.gridW, v.probes.gridH, v.probes.gridDepth, CELL);
  else REFL.gridInfo.value.set(1, 1, 2, CELL);
  REFL.params.value.set(v && v.probes.count > 0 ? REFLECTION_TUNING.strength : 0, 0, 0, 0);
}

/** Re-apply REFLECTION_TUNING to the bound probes (QA / tuning). */
export function syncReflectionTuning(): void {
  if (active && active.probes.count > 0) REFL.params.value.x = REFLECTION_TUNING.strength;
}

// ---------------------------------------------------------------------------------------------
// Which materials reflect

export type {ReflectClass} from '../render/reflectTag';

/**
 * Whether a material shows the probes, and how. Decided while its program is built, so from nothing but what three's program cache
 * key holds (render/reflectTag.ts explains): two materials that share a program always get the same answer.
 *  - a TAG (tagReflect) wins: 'glass', 'metal' or 'none' — the station's glazing is tagged glass, its wall / floor / ceiling sets none;
 *  - never a skinned mesh (characters), never a non-standard material;
 *  - an untagged see-through material: 'none' (decals, particles, liquids: only tagged panes are glass);
 *  - 'metal': a metalness map (model materials) or a metalness that is not zero. This is a CANDIDATE: the shader then decides per
 *    fragment from the real metalness and roughness (LightFieldReflectNode), so a rough non-metal texel never pays for a lookup.
 * Everything else — walls, floors, ceilings, wood, cloth, plastic with no metalness — is 'none' and compiles exactly as without
 * reflections.
 */
export function reflectClass(material: THREE.Material | null | undefined, object?: THREE.Object3D | null): ReflectClass {
  if (!material) return 'none';
  const tag = reflectTagOf(material);
  if (tag) return tag;
  if ((object as {isSkinnedMesh?: boolean} | null | undefined)?.isSkinnedMesh) return 'none';
  const m = material as THREE.MeshStandardMaterial & {isMeshStandardNodeMaterial?: boolean};
  if (!m.isMeshStandardMaterial && !m.isMeshStandardNodeMaterial) return 'none';
  if (m.transparent) return 'none';
  return m.metalnessMap || m.metalness !== 0 ? 'metal' : 'none';
}

// ---------------------------------------------------------------------------------------------
// TSL

/** Octahedral (u, v) of a unit direction (world/reflectionProbes.ts octEncode). */
export function octUv(d: Node): Node {
  const D = n(d);
  const s = float(1).div(n(abs(D.x)).add(abs(D.y)).add(abs(D.z)));
  const p = n(n(D.xz).mul(s)).toVar();
  const sg = n(step(vec2(0, 0), p)).mul(2).sub(1);
  const folded = n(vec2(1, 1)).sub(abs(n(p).yx)).mul(sg);
  const q = sel(n(D.y).lessThan(0), folded, p);
  return n(q).mul(0.5).add(0.5);
}

const lumOf = (c: N): N => n(c).dot(vec3(0.2126, 0.7152, 0.0722));

/**
 * The probes' radiance at the shaded point along world direction `dir` for a surface of roughness `rough` (declares vars and
 * branches: call inside a material / lighting stack). `s` is the field sample of the same point (its slot and its light).
 */
export function probeRadiance(s: LightFieldSampleNodes, dir: Node, rough: Node): Node {
  const P = n(positionWorld), R = n(n(dir)).toVar();
  const gi = n(REFL.gridInfo), ai = n(REFL.atlasInfo), LY = n(REFL.levelY);
  const cxy = n(n(P.xz).div(gi.w)).toVar();
  const slot = n(s.slot);
  const W4 = n(n(REFL.grid).sample(vec3(n(cxy).div(gi.xy), n(slot).mul(2).add(0.5).div(gi.z))).level(0)).toVar();
  const ci = n(clamp(floor(cxy), vec2(0, 0), n(gi.xy).sub(1))).toVar();
  const ID = n(n(REFL.grid).load(ivec3(int(ci.x), int(ci.y), int(n(slot).mul(2).add(1.5))))).toVar();
  // the field's light at the surface (flicker circuits, ride mask and gain included)
  const local = n(lumOf(n(s.amb).add(s.dirColor))).toVar();
  const lv = n(clamp(n(rough).mul(PROBE_LEVEL_PER_ROUGHNESS), 0, PROBE_LEVELS - 1)).toVar();
  const l0 = n(floor(lv)).toVar(), l1 = n(min(n(l0).add(1), PROBE_LEVELS - 1)).toVar(), lf = n(lv).sub(l0);
  // tile edge and first row of a level (exact constants: the tiles are powers of two)
  const tileOf = (l: N): N => sel(n(l).lessThan(0.5), ai.z, sel(n(l).lessThan(1.5), n(ai.z).mul(0.5), sel(n(l).lessThan(2.5), n(ai.z).mul(0.25), n(ai.z).mul(0.125))));
  const rowOf = (l: N): N => sel(n(l).lessThan(0.5), LY.x, sel(n(l).lessThan(1.5), LY.y, sel(n(l).lessThan(2.5), LY.z, LY.w)));
  const t0 = tileOf(l0), t1 = tileOf(l1), y0 = rowOf(l0), y1 = rowOf(l1);
  // 1 / R with no division by zero
  const sg = n(step(vec3(0, 0, 0), R)).mul(2).sub(1);
  const rInv = n(sg).div(max(abs(R), vec3(1e-4, 1e-4, 1e-4))).toVar();
  const acc = n(vec3(0, 0, 0)).toVar();
  const ch = ['r', 'g', 'b', 'a'] as const;
  for (let c = 0; c < 4; c++) {
    const w = n(W4[ch[c]]), idf = n(floor(n(ID[ch[c]]).mul(255).add(0.5))).toVar();
    If(n(w).greaterThan(0.004).and(n(idf).greaterThan(0.5)), () => {
      const p = n(idf).sub(1).toVar(), pi = int(p);
      const M0 = n(n(REFL.meta).load(ivec2(pi, int(0)))).toVar();
      const B0 = n(n(REFL.meta).load(ivec2(pi, int(1))).xyz).toVar(), B1 = n(n(REFL.meta).load(ivec2(pi, int(2))).xyz).toVar();
      // box projection: where the reflected ray leaves the probe's box, seen from the probe
      const tm = n(max(n(B1).sub(P).mul(rInv), n(B0).sub(P).mul(rInv))).toVar();
      const t = max(min(tm.x, min(tm.y, tm.z)), 0);
      const inside = n(P.x).greaterThan(n(B0.x).sub(0.5)).and(n(P.x).lessThan(n(B1.x).add(0.5)))
        .and(n(P.y).greaterThan(n(B0.y).sub(0.5))).and(n(P.y).lessThan(n(B1.y).add(0.5)))
        .and(n(P.z).greaterThan(n(B0.z).sub(0.5))).and(n(P.z).lessThan(n(B1.z).add(0.5)));
      const D = sel(inside, n(n(P).add(n(R).mul(t)).sub(M0.xyz)).normalize(), R);
      const uv = n(octUv(D)).toVar();
      const col = n(mod(p, ai.w)).toVar(), row = n(floor(n(p).div(ai.w))).toVar();
      const at = (tile: N, y: N): N => {
        const cell = n(tile).add(2 * PROBE_GUTTER);
        const org = vec2(n(col).mul(cell).add(PROBE_GUTTER), n(y).add(n(row).mul(cell)).add(PROBE_GUTTER));
        return n(n(REFL.atlas).sample(n(org).add(n(uv).mul(tile)).div(ai.xy)).level(0)).rgb;
      };
      const C = mix(at(t0, y0), at(t1, y1), lf);
      const k = min(n(local).div(max(M0.w, 1e-3)), PROBE_RATIO_MAX);
      acc.addAssign(n(C).mul(n(w).mul(k)));
    });
  }
  const wsum = n(W4.r).add(W4.g).add(W4.b).add(W4.a);
  return n(acc).div(max(wsum, 0.05)).mul(n(REFL.params).x);
}

// ---------------------------------------------------------------------------------------------
// Scene light + lighting node

/** The station light field WITH reflection probes as a scene light (see module doc). */
export class LightFieldReflectLight extends LightFieldLight {
  readonly isLightFieldReflectLight = true;
  constructor() {
    super();
    (this as {type: string}).type = 'LightFieldReflectLight';
    this.name = 'light-field-reflect';
  }
}

let shared: LightFieldReflectLight | null = null;
/** The single session-wide reflecting field light (stable id => stable light set across stations that use it). */
export function stationReflectLight(): LightFieldReflectLight {
  return (shared ??= new LightFieldReflectLight());
}

interface ReflectBuilder extends NodeBuilder {
  context: NodeBuilder['context'] & {radiance?: Node & {addAssign(x: Node): Node}; lightingModel?: unknown};
}

/** The field for every lit material, plus the probes for metal and glass. */
export class LightFieldReflectNode extends LightFieldNode {
  static get type(): string { return 'LightFieldReflectNode'; }
  readonly isLightFieldReflectNode = true;
  setup(builder: NodeBuilder): null {
    const s = this.shade(builder);
    if (!s) return null;
    const b = builder as ReflectBuilder;
    if (!(b.context.lightingModel instanceof PhysicalLightingModel) || !b.context.radiance) return null;
    const cls = reflectClass(b.material as THREE.Material | null, b.object as THREE.Object3D | null);
    if (cls === 'none') return null;
    const rough = n(roughness);
    // three's own environment lookup direction: the mirror direction, pulled toward the normal as the surface gets rough
    const dir = n(mix(reflectView, normalView, pow4(rough))).normalize().transformDirection(cameraWorldMatrix);
    const rad = n(vec3(0, 0, 0)).toVar();
    if (cls === 'glass') {
      // a see-through pane: its reflection is not dimmed by how much it lets through (the blend multiplies by the opacity)
      rad.assign(n(probeRadiance(s, dir, rough)).div(clamp(materialOpacity, 0.25, 1)));
    } else {
      // a rough non-metal texel reflects next to nothing: no lookup there (the real, per-fragment metalness and roughness decide)
      If(n(metalness).greaterThan(REFLECT_METALNESS_MIN).or(n(rough).lessThan(REFLECT_ROUGHNESS_MAX)), () => { rad.assign(probeRadiance(s, dir, rough)); });
    }
    b.context.radiance.addAssign(rad);
    return null;
  }
}

/** Register LightFieldReflectNode for LightFieldReflectLight in a WebGPURenderer's node library (idempotent). False without one. */
export function installReflectNode(renderer: {library?: unknown} | null | undefined): boolean {
  const lib = renderer?.library as NodeLibraryLike | undefined;
  if (!lib || typeof lib.addLight !== 'function' || typeof lib.getLightNodeClass !== 'function') return false;
  if (lib.getLightNodeClass(LightFieldReflectLight) === LightFieldReflectNode) return true;
  lib.addLight(LightFieldReflectNode, LightFieldReflectLight);
  return true;
}

// ---------------------------------------------------------------------------------------------
// CPU mirror (tests, QA): what probeRadiance returns

const half = (h: number): number => THREE.DataUtils.fromHalfFloat(h);

/** Bilinear atlas sample of probe p at level l along unit direction d (rgb). */
export function sampleProbeLevel(B: BakedProbes, p: number, l: number, d: readonly [number, number, number]): [number, number, number] {
  const L = B.layout, t = L.levelTile[l], [ox, oy] = probeTileOrigin(L, p, l);
  const [u, v] = octEncode(d[0], d[1], d[2]);
  const x = ox + u * t - 0.5, y = oy + v * t - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const xx = Math.min(L.width - 1, Math.max(0, x0 + a)), yy = Math.min(L.height - 1, Math.max(0, y0 + b));
    const w = (a ? fx : 1 - fx) * (b ? fy : 1 - fy), o = (yy * L.width + xx) * 4;
    out[0] += w * half(B.atlas[o]); out[1] += w * half(B.atlas[o + 1]); out[2] += w * half(B.atlas[o + 2]);
  }
  return out;
}

/**
 * The probes' radiance at world point (x, y, z) of level slot `slot` along unit direction `dir` at roughness `rough`, for a local
 * field luminance `local` — the shader's maths on the CPU (bilinear weights, unfiltered ids, box projection, two levels).
 */
export function sampleProbes(B: BakedProbes, x: number, y: number, z: number, slot: number, dir: readonly [number, number, number], rough: number, local: number, strength = 1): [number, number, number] {
  const W = B.gridW, H = B.gridH, g = B.grid;
  const cx = x / CELL, cz = z / CELL;
  const u = cx - 0.5, v = cz - 0.5, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const w4 = [0, 0, 0, 0];
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const xx = Math.min(W - 1, Math.max(0, iu + a)), yy = Math.min(H - 1, Math.max(0, iv + b));
    const w = (a ? fu : 1 - fu) * (b ? fv : 1 - fv), o = (((slot * 2) * H + yy) * W + xx) * 4;
    for (let c = 0; c < 4; c++) w4[c] += w * g[o + c] / 255;
  }
  const ci = Math.min(W - 1, Math.max(0, Math.floor(cx))), cj = Math.min(H - 1, Math.max(0, Math.floor(cz)));
  const io = (((slot * 2 + 1) * H + cj) * W + ci) * 4;
  const lv = Math.min(PROBE_LEVELS - 1, Math.max(0, rough * PROBE_LEVEL_PER_ROUGHNESS)), l0 = Math.floor(lv), l1 = Math.min(l0 + 1, PROBE_LEVELS - 1), lf = lv - l0;
  const acc: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const id = g[io + c];
    if (!(w4[c] > 0.004) || id < 1) continue;
    const p = id - 1, n0 = B.count;
    const mx = B.meta[p * 4], my = B.meta[p * 4 + 1], mz = B.meta[p * 4 + 2], norm = B.meta[p * 4 + 3];
    const b0 = [B.meta[(n0 + p) * 4], B.meta[(n0 + p) * 4 + 1], B.meta[(n0 + p) * 4 + 2]], b1 = [B.meta[(2 * n0 + p) * 4], B.meta[(2 * n0 + p) * 4 + 1], B.meta[(2 * n0 + p) * 4 + 2]];
    const P = [x, y, z];
    let t = Infinity, inside = true;
    for (let a = 0; a < 3; a++) {
      const r = dir[a], inv = (r >= 0 ? 1 : -1) / Math.max(Math.abs(r), 1e-4);
      t = Math.min(t, Math.max((b1[a] - P[a]) * inv, (b0[a] - P[a]) * inv));
      if (!(P[a] > b0[a] - 0.5 && P[a] < b1[a] + 0.5)) inside = false;
    }
    t = Math.max(t, 0);
    let d: [number, number, number] = [dir[0], dir[1], dir[2]];
    if (inside) {
      const hx = x + dir[0] * t - mx, hy = y + dir[1] * t - my, hz = z + dir[2] * t - mz, hl = Math.hypot(hx, hy, hz) || 1;
      d = [hx / hl, hy / hl, hz / hl];
    }
    const a0 = sampleProbeLevel(B, p, l0, d), a1 = sampleProbeLevel(B, p, l1, d);
    const k = Math.min(local / Math.max(norm, 1e-3), PROBE_RATIO_MAX) * w4[c];
    for (let q = 0; q < 3; q++) acc[q] += (a0[q] + (a1[q] - a0[q]) * lf) * k;
  }
  const ws = Math.max(w4[0] + w4[1] + w4[2] + w4[3], 0.05);
  return [acc[0] / ws * strength, acc[1] / ws * strength, acc[2] / ws * strength];
}
