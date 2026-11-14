// Iteration 13 (LIGHTING): the baked station light field (world/lightField.ts) under three r186's WebGPURenderer.
//
// The WebGL build handed the field to three's light-probe-grid path and patched its ShaderChunks; node materials (WGSL on
// the WebGPU backend, GLSL on the WebGL2 fallback) ignore ShaderChunk, so the same decoding now lives here as TSL:
//  - LightFieldLight: ONE persistent scene "light" for the whole session (stationFieldLight()). Every lit node material
//    (Standard / Physical / Lambert / Phong / Toon) in a scene holding it gets the field per fragment through
//    LightFieldNode (registered with renderer.library.addLight by installLightFieldNode). Keeping a single instance keeps
//    the scene's light set (LightsNode cache key = light ids + castShadow) identical across stations, so newStation
//    reuses every node builder state / pipeline instead of rebuilding all lit materials.
//  - LightFieldNode: the isotropic part of the field -> context.irradiance (indirect diffuse; AO applies), the directional
//    part -> lightsNode.setupDirectLight (N.L diffuse + GGX specular), exactly as the WebGL patch fed RE_Direct.
//  - LF: GLOBAL texture / uniform nodes bound to the active station (bindLightField). Materials built before a station
//    exists compile against a zero placeholder (same format / filtering) and pick the real texture up when it is bound
//    (the sampled-texture binding follows the node's value; no rebuild — every render object re-reads it once after a swap,
//    render/bindingRefresh.ts).
//  - Shared TSL for other lanes: lfSlotAt / lfBandAt / lfFloorAt (decay floor grime, world-mapped grime, fog density
//    layer) and lightFieldSample (surfaces and the volumetric in-scattering). The CPU mirror is sampleField().
//  - Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): lightFieldSample is scaled by the RIDE MASK (RM below,
//    world/rideMask.ts): zero inside a ride tunnel's box, ramping in at its open face; the CPU mirror is sampleField() x rideMaskGain().
// Slot selection is the iteration-08 packed column texel (slice 0: band thresholds + slot ids, no per-slot loop), done with
// float arithmetic (no integer shifts: identical on WGSL and GLSL ES 3.0). Task office-seamless-20261029 (ENGINE): N storeys.
// An extended column (slice 0 A = band count 1..63) names its group texel (3 bands: two inner splits, three slot ids) from
// the coarse splits in R / G / B; the pick always issues that second fetch (a legacy column re-reads slice 0, a cached
// texel), so there is no branch around a texture read on either backend. Slot header heights use the bound field's
// per-slot range (LF.slotY; the global range for a legacy field: the same floats as before).

import * as THREE from 'three';
import {LightingNode, MeshBasicNodeMaterial, NodeMaterial, PhongLightingModel, PhysicalLightingModel, QuadMesh, RenderTarget, type Node, type NodeBuilder} from 'three/webgpu';
import {
  Fn, If, abs, cameraViewMatrix, clamp, float, floor, int, ivec2, ivec3, length, max, min, mix, mod, normalWorld, positionWorld, renderGroup,
  screenCoordinate, select, texture3D, textureLoad, uniform, uniformArray, vec2, vec3, vec4,
} from 'three/tsl';
import {AUX_LAYERS, AUX_SLOT_DEPTH, FIELD_EMAX, GROUP_BANDS, LAYERS, MAX_SLOTS, SLOT_DEPTH, configureFieldTexture, fieldDepth, slotRange, type LightFieldVolume} from './lightField';
import {RIDE_MASK, RIDE_MASK_SKIN} from './rideMask';
import {refreshTextureBindings} from '../render/bindingRefresh';

/** Zero field (1 x 1 column, one slot): what materials compile and sample against before a station is bound. */
const PLACEHOLDER = configureFieldTexture(new THREE.Data3DTexture(new Uint8Array(fieldDepth(1) * 4), 1, 1, fieldDepth(1)));
PLACEHOLDER.name = 'light-field-placeholder';

/** Unbound band fallback (slot, floor, ceiling): the station floor at y 0, a 3.2 m storey. */
export const UNBOUND_BAND = [0, 0, 3.2] as const;

/** Per-slot header height range [lo, hi] (x, y; z / w unused), one vec4 per level slot (LF.slotY). */
const SLOT_Y = Array.from({length: MAX_SLOTS}, () => new THREE.Vector4(0, 1, 0, 0));

/**
 * The global light-field nodes. `tex` is the BASE texture node (its .value is swapped per station; every .load / .sample
 * clone references it). min/max = world bounds (x, y, z), dims = texture size (w, h, depth), levels = flicker-circuit
 * levels 0..2, slots = level slots in the texture, gain = output scale (LightFieldLight.intensity), bound = 0 / 1,
 * slotY = per-slot header height range (x = lo, y = hi; the bounds' y range in a legacy field).
 */
export const LF = {
  tex: texture3D(PLACEHOLDER),
  min: uniform(new THREE.Vector3(0, 0, 0)).setGroup(renderGroup),
  max: uniform(new THREE.Vector3(1, 1, 1)).setGroup(renderGroup),
  dims: uniform(new THREE.Vector3(1, 1, fieldDepth(1))).setGroup(renderGroup),
  levels: uniform(new THREE.Vector3(1, 1, 1)).setGroup(renderGroup),
  slots: uniform(1).setGroup(renderGroup),
  gain: uniform(1).setGroup(renderGroup),
  bound: uniform(0).setGroup(renderGroup),
  slotY: uniformArray(SLOT_Y, 'vec4').setGroup(renderGroup),
};

let active: LightFieldVolume | null = null;

/**
 * Bind a station's field to the global nodes (null: unbind -> placeholder, no field light, band fallback). Task
 * studio-death-retry-render-fix-20261114-044607-01: a changed texture also makes every render object re-read it at its next draw
 * (render/bindingRefresh.ts): three alone kept an unchanged object (the parked car's fuel cap / plugs on a same-station reload) on the
 * previous station's field, destroyed after the warm-up, and WebGPU then dropped the station's whole scene pass.
 */
export function bindLightField(v: LightFieldVolume | null): void {
  active = v;
  syncRideMask();
  if (LF.tex.value !== (v ? v.texture : PLACEHOLDER)) refreshTextureBindings();
  if (!v) {
    LF.tex.value = PLACEHOLDER;
    LF.min.value.set(0, 0, 0);
    LF.max.value.set(1, 1, 1);
    LF.dims.value.set(1, 1, fieldDepth(1));
    LF.levels.value.set(1, 1, 1);
    LF.slots.value = 1;
    LF.bound.value = 0;
    for (const q of SLOT_Y) q.set(0, 1, 0, 0);
    return;
  }
  LF.tex.value = v.texture;
  LF.min.value.copy(v.boundingBox.min);
  LF.max.value.copy(v.boundingBox.max);
  LF.dims.value.set(v.field.w, v.field.h, v.field.depth);
  LF.levels.value.copy(v.resolution);
  LF.slots.value = v.field.slots;
  LF.bound.value = 1;
  SLOT_Y.forEach((q, s) => { const [lo, hi] = slotRange(v.field, Math.min(s, v.field.slots - 1)); q.set(lo, hi, 0, 0); });
}

/** The per-slot header ranges currently bound (QA / tests: [lo, hi] per slot of the bound field). */
export function boundSlotRanges(): [number, number][] {
  return SLOT_Y.slice(0, Math.max(1, LF.slots.value as number)).map(q => [q.x, q.y]);
}

/** The station field currently bound to the TSL nodes (null before the first station / after dispose). */
export function activeLightField(): LightFieldVolume | null {
  return active;
}

/** Flicker-circuit levels of the bound field (call every frame; StationLighting.update does). */
export function setLightFieldLevels(l0: number, l1: number, l2: number): void {
  LF.levels.value.set(l0, l1, l2);
  syncRideMask(); // (task studio-perf-ao-train-continuity-20261110-022206-01, lane PORTAL: the ride mask rides on this per-frame sync)
}

// ---------------------------------------------------------------------------------------------
// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): the RIDE MASK (world/rideMask.ts) as uniforms.
// Plain render-group uniforms (the group LF already binds: no new uniform buffer in any stage — the march's fragment stage is at
// WebGPU's 12, tests/reactor-x-fog-webgpu-limits.test.ts), copied from RIDE_MASK when its version changes. Off = a zero-volume box
// at the origin: rideMaskAt reads exactly 1 and rideMaskInside false, so every program shades exactly as before. Turning the mask on /
// off or moving it changes uniform values only (no program change).

/** lo / hi = the box's corners; open = [open face x, fade m, 1 = has an open face, the box's bed (floor) y]; bed = [track-bed density multiplier, 0, 0, 0]. */
export const RM = {
  lo: uniform(new THREE.Vector3(0, 0, 0)).setGroup(renderGroup),
  hi: uniform(new THREE.Vector3(0, 0, 0)).setGroup(renderGroup),
  open: uniform(new THREE.Vector4(0, 4, 0, 0)).setGroup(renderGroup),
  bed: uniform(new THREE.Vector4(1.5, 0, 0, 0)).setGroup(renderGroup),
};
let rmVersion = -1;

/** Copy RIDE_MASK into RM when it changed (cheap: two compares; bindLightField / setLightFieldLevels call it). */
export function syncRideMask(): void {
  const m = RIDE_MASK;
  if (m.bedMult !== RM.bed.value.x) RM.bed.value.set(m.bedMult, 0, 0, 0); // (the bed medium changes per station, without a version)
  if (m.version === rmVersion) return;
  rmVersion = m.version;
  const b = m.box, open = m.on && Number.isFinite(m.openX);
  if (m.on) { RM.lo.value.set(b.x0, b.y0, b.z0); RM.hi.value.set(b.x1, b.y1, b.z1); } else { RM.lo.value.set(0, 0, 0); RM.hi.value.set(0, 0, 0); }
  RM.open.value.set(open ? m.openX : 0, m.fade, open ? 1 : 0, m.on ? b.y0 + RIDE_MASK_SKIN : 0);
}

/** Inside the ride mask's box (bool node; never while off). Mirror: rideMask.ts inRideMask. */
export function rideMaskInside(p: Node): Node {
  const P = n(p), lo = n(RM.lo), hi = n(RM.hi);
  return P.x.greaterThan(lo.x).and(P.x.lessThan(hi.x)).and(P.y.greaterThan(lo.y)).and(P.y.lessThan(hi.y)).and(P.z.greaterThan(lo.z)).and(P.z.lessThan(hi.z));
}

/** The light field's factor at world point p: 1 outside the box; inside 1 at its open face to 0 `fade` m in (0 without one). Mirror: rideMask.ts rideMaskGain. */
export function rideMaskAt(p: Node): Node {
  const P = n(p), o = n(RM.open);
  const ramp = n(clamp(float(1).sub(n(abs(n(P.x).sub(o.x))).div(max(o.y, 1e-3))), 0, 1)).mul(o.z).toVar();
  // (materialised like every select() here: the GLSL builder prints unparenthesised ternaries inside a uniformFlow context)
  return n(select(n(rideMaskInside(P)), ramp, float(1))).toVar();
}

// ---------------------------------------------------------------------------------------------
// TSL decoding (mirror of sampleField / fieldSlot in world/lightField.ts)

// TSL nodes are chained untyped here (three's TSL typings reject most mixed-type chains).
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;

/** World XZ size of one field texel. */
const texelSize = () => n(n(LF.max).xz).sub(n(LF.min).xz).div(n(LF.dims).xy);

/** Texel column (float x, z, clamped) holding world XZ `pxz` for texel size `cell`. */
const columnOf = (pxz: N, cell: N) => clamp(floor(n(pxz).sub(n(LF.min).xz).div(cell)), vec2(0, 0), n(n(LF.dims).xy).sub(1));

/** One texel fetch at column `ci` (float vec2), slice `slice` (float). */
const fetch = (ci: N, slice: N | number) => n(LF.tex).load(ivec3(int(n(ci).x), int(n(ci).y), int(n(float(slice)).add(0.5))));

/**
 * Level slot (float) of column `ci` for height `py` (mirror of fieldSlot). Legacy column (slice 0 A >= 64): G / B = heights
 * between consecutive bands, A = band count << 6 | slot of band k in bits 2k. Extended column (A = band count 1..63):
 * R / G / B = the splits above bands 2 / 5 / 8 pick group g; group texel g = (split above band 3g, split above 3g + 1,
 * slot ids of bands 3g / 3g + 1 as low / high nibble, slot id of band 3g + 2). Two fetches; clamped to the texture's slots.
 */
function pickSlot(ci: N, py: N): N {
  const K = n(fetch(ci, 0)).toVar();
  const y0 = n(LF.min).y;
  const yr = n(n(LF.max).y).sub(y0).toVar();
  const pk = floor(n(K.a).mul(255).add(0.5)).toVar();
  const cnt = floor(n(pk).div(64)).toVar();
  // every select() is materialised (.toVar()): inside a uniformFlow context the GLSL builder prints unparenthesised ternaries
  const up1 = n(select(n(cnt).greaterThan(1).and(n(py).greaterThan(n(y0).add(n(K.g).mul(yr)))), float(1), float(0))).toVar();
  const up2 = n(select(n(cnt).greaterThan(2).and(n(py).greaterThan(n(y0).add(n(K.b).mul(yr)))), float(1), float(0))).toVar();
  const band = n(up1).add(up2);
  // 4^band as exact constants (exp2 is not guaranteed exact on every GPU: 4 - ulp would floor 4N / 4 to N - 1)
  const div4 = n(select(n(band).greaterThan(0.5), float(4), float(1))).toVar();
  const div = n(select(n(band).greaterThan(1.5), float(16), div4)).toVar();
  const legacy = n(mod(floor(n(pk).div(div)), 4)).toVar();
  // extended column: 1 when the column holds more than k bands and py lies above the split height v (unorm)
  const ext = n(select(n(cnt).lessThan(0.5).and(n(pk).greaterThan(0.5)), float(1), float(0))).toVar();
  const over = (v: N, k: N) => n(select(n(pk).greaterThan(k).and(n(py).greaterThan(n(y0).add(n(v).mul(yr)))), float(1), float(0))).toVar();
  const g = n(over(K.r, float(GROUP_BANDS)).add(over(K.g, float(2 * GROUP_BANDS))).add(over(K.b, float(3 * GROUP_BANDS)))).mul(ext).toVar();
  // group slice after the last slot (legacy: slice 0 again); clamped into the texture
  const gs = n(select(n(ext).greaterThan(0.5), float(1 + SLOT_DEPTH - AUX_SLOT_DEPTH).add(n(LF.slots).mul(AUX_SLOT_DEPTH)).add(g), float(0))).toVar();
  const G = n(fetch(ci, min(gs, n(n(LF.dims).z).sub(1)))).toVar();
  const k1 = n(g).mul(GROUP_BANDS).add(1).toVar();
  const j = n(over(G.r, k1)).add(over(G.g, n(k1).add(1))).toVar();
  const ids = floor(n(G.b).mul(255).add(0.5)).toVar();
  const hiId = floor(n(ids).div(16)).toVar();
  const loId = n(ids).sub(n(hiId).mul(16));
  const third = floor(n(G.a).mul(255).add(0.5));
  const pair = n(select(n(j).greaterThan(0.5), hiId, loId)).toVar();
  const extSlot = n(select(n(j).greaterThan(1.5), third, pair)).toVar();
  const slot = n(select(n(ext).greaterThan(0.5), extSlot, legacy)).toVar();
  return min(slot, n(LF.slots).sub(1));
}

/** Header of `slot` at column `ci`: first slice (float), top layer index, band floor / ceiling (world y). */
function slotHeader(ci: N, slot: N): {base: N; top: N; floor: N; ceil: N} {
  const aux = min(slot, 1);
  const base = n(mix(float(1), float(1 + SLOT_DEPTH - AUX_SLOT_DEPTH).add(n(slot).mul(AUX_SLOT_DEPTH)), aux)).toVar();
  const top = mix(float(LAYERS - 1), float(AUX_LAYERS - 1), aux);
  const H = n(fetch(ci, base)).toVar();
  // the slot's own header range (legacy field: LF.min.y / LF.max.y, the iteration-08 maths)
  const R = n(n(LF.slotY).element(int(slot))).toVar();
  const yr = n(R.y).sub(R.x);
  return {base, top, floor: n(R.x).add(n(H.r).mul(yr)), ceil: n(R.x).add(n(H.g).mul(yr))};
}

const bound = () => n(LF.bound).greaterThan(0.5);

/** Level slot of the band holding world point p (0 when no field is bound). Two texel fetches. */
export function lfSlotAt(p: Node): Node {
  const P = n(p);
  const slot = pickSlot(columnOf(P.xz, texelSize()), P.y);
  return n(select(bound(), slot, float(0))).toVar();
}

/** Level band holding world point p: slot (float, = layout.levels index), band floor / ceiling (world y). */
export interface LightFieldBand { slot: Node; floor: Node; ceil: Node }

/**
 * Level band holding world point p (three texel fetches; declares vars: use inside a material / Fn stack). UNBOUND_BAND
 * ({slot 0, floor 0, ceil 3.2}) when no field is bound. Replaces the iteration-12 GLSL slot / band block (lfSlot / lfFl / lfCe).
 */
export function lfBandAt(p: Node): LightFieldBand {
  const P = n(p);
  const ci = n(columnOf(P.xz, texelSize())).toVar();
  const slot = n(pickSlot(ci, P.y)).toVar();
  const h = slotHeader(ci, slot);
  const on = bound();
  return {
    slot: n(select(on, slot, float(UNBOUND_BAND[0]))).toVar(),
    floor: n(select(on, h.floor, float(UNBOUND_BAND[1]))).toVar(),
    ceil: n(select(on, h.ceil, float(UNBOUND_BAND[2]))).toVar(),
  };
}

/** Floor height of the level band holding world point p (world-mapped / decay floor grime); 0 when unbound. */
export function lfFloorAt(p: Node): Node {
  return lfBandAt(p).floor;
}

export interface LightFieldSampleNodes {
  /** Isotropic irradiance (rgb): reaches every surface regardless of its normal. */
  amb: Node;
  /** Directional irradiance colour, applied with N.L along `dir`. */
  dirColor: Node;
  /** Unit WORLD direction toward the dominant light. */
  dir: Node;
  /** Level slot used, band floor / ceiling (world y). */
  slot: Node;
  floor: Node;
  ceil: Node;
}

/**
 * The field at world point `p` as TSL nodes (declares vars: call inside an Fn / material stack). `normal`: offset the
 * lookup along the surface normal like the shader always did (wall faces read the cell in front of them, never the rock
 * behind). `slot`: reuse an already picked level slot (the volumetric march picks one per step for density and field).
 * Mirrors sampleField(): slot by height, bilinear in XZ (texel centres = cell centres), linear between height layers, the
 * flicker circuits' shares scaled by LF.levels. Zero when no field is bound.
 */
export function lightFieldSample(p: Node, o: {normal?: Node; slot?: Node} = {}): LightFieldSampleNodes {
  const cell = n(texelSize()).toVar();
  const P = n(o.normal ? n(p).add(n(o.normal).mul(vec3(n(cell.x).mul(0.5), 0.2, n(cell.y).mul(0.5)))) : vec3(n(p))).toVar();
  const cxy = n(n(P.xz).sub(n(LF.min).xz).div(cell)).toVar();
  const ci = n(clamp(floor(cxy), vec2(0, 0), n(n(LF.dims).xy).sub(1))).toVar();
  const slot = n(o.slot ?? pickSlot(ci, P.y)).toVar();
  const h = slotHeader(ci, slot);
  const fl = n(h.floor).toVar(), ce = n(h.ceil).toVar();
  const rel = n(clamp(n(P.y).sub(fl).div(max(n(ce).sub(fl), 0.3)), 0, 1).mul(h.top)).toVar();
  const k0 = n(floor(rel)).toVar();
  const k1 = min(n(k0).add(1), h.top);
  const wk = n(rel).sub(k0);
  const uv = n(cxy).div(n(LF.dims).xy);
  const at = (slice: N) => n(n(LF.tex).sample(vec3(uv, n(slice).div(n(LF.dims).z))).level(0));
  const base = n(h.base);
  const a0 = at(base.add(1.5).add(n(k0).mul(2))).toVar();
  const a1 = at(base.add(1.5).add(n(k1).mul(2))).toVar();
  const b0 = at(base.add(2.5).add(n(k0).mul(2)));
  const b1 = at(base.add(2.5).add(n(k1).mul(2)));
  const fr = at(base.add(0.5));
  const dec = (v: N) => n(v).mul(v).mul(FIELD_EMAX);
  const T = n(mix(dec(a0.rgb), dec(a1.rgb), wk)).toVar();
  const rho = n(mix(a0.a, a1.a, wk)).toVar();
  const b = n(mix(b0, b1, wk)).toVar();
  const L = n(LF.levels);
  const m = max(0, float(1).sub(n(fr.b).mul(n(L.x).oneMinus())).sub(n(fr.a).mul(n(L.y).oneMinus())).sub(n(b.a).mul(n(L.z).oneMinus())));
  const on = n(select(bound(), float(1), float(0))).toVar();
  // (lane PORTAL: x the ride mask at the point itself — 1 outside its box, so the field is exactly as before there)
  const g = n(m).mul(n(LF.gain)).mul(on).mul(rideMaskAt(vec3(n(p)))).toVar();
  const d = n(n(b.rgb).mul(2).sub(1)).toVar();
  const dl = length(d);
  const dir = n(select(n(dl).greaterThan(1e-4), n(d).div(dl), vec3(0, 1, 0))).toVar();
  return {
    amb: n(T).mul(n(rho).oneMinus()).mul(g),
    dirColor: n(T).mul(rho).mul(g),
    dir, slot, floor: fl, ceil: ce,
  };
}

// ---------------------------------------------------------------------------------------------
// Scene light + lighting node

/** The station light field as a scene light (see module doc). `intensity` scales the whole field (QA / debug). */
export class LightFieldLight extends THREE.Light {
  readonly isLightFieldLight = true;
  constructor() {
    super(0xffffff, 1);
    (this as {type: string}).type = 'LightFieldLight';
    this.name = 'light-field';
    this.castShadow = false;
  }
}

let shared: LightFieldLight | null = null;
/** The single session-wide field light (stable id => stable light set). */
export function stationFieldLight(): LightFieldLight {
  return (shared ??= new LightFieldLight());
}

interface LightingBuilder extends NodeBuilder {
  context: NodeBuilder['context'] & {irradiance: Node & {addAssign(x: Node): Node}; lightingModel?: unknown};
  lightsNode: {setupDirectLight(builder: NodeBuilder, lightNode: Node, data: {lightDirection: Node; lightColor: Node}): void};
}

/** Per-fragment field lighting for every lit node material in a scene holding the LightFieldLight. */
export class LightFieldNode extends LightingNode {
  static get type(): string { return 'LightFieldNode'; }
  readonly isLightFieldNode = true;
  constructor(readonly light: LightFieldLight | null = null) {
    super();
  }
  setup(builder: NodeBuilder): null {
    const b = builder as LightingBuilder;
    // Surface lighting models only (Standard / Physical, Lambert / Phong, Toon), as the WebGL probe-grid path: three also
    // builds every light into MeshBasicNodeMaterial (BasicLightingModel ignores direct light and irradiance), shadow
    // catchers and volume materials, where the field would only cost a texture binding or sample the wrong point.
    if (!LightFieldNode.surfaceModel(b)) return null;
    const s = lightFieldSample(positionWorld, {normal: normalWorld});
    b.context.irradiance.addAssign(s.amb);
    const dirView = n(n(cameraViewMatrix).mul(vec4(n(s.dir), 0)).xyz).normalize();
    b.lightsNode.setupDirectLight(b, this, {lightDirection: dirView, lightColor: s.dirColor});
    return null;
  }
  /** Whether the builder's lighting model is a surface model that uses direct light + indirect irradiance. */
  static surfaceModel(b: NodeBuilder): boolean {
    const lm = (b as LightingBuilder).context.lightingModel;
    return lm instanceof PhysicalLightingModel || lm instanceof PhongLightingModel || !!(b.material as {isMeshToonNodeMaterial?: boolean} | null)?.isMeshToonNodeMaterial;
  }
}

export interface NodeLibraryLike { getLightNodeClass(light: unknown): unknown; addLight(node: unknown, light: unknown): void }

/** Register LightFieldNode for LightFieldLight in a WebGPURenderer's node library (idempotent). False without one. */
export function installLightFieldNode(renderer: {library?: unknown} | null | undefined): boolean {
  const lib = renderer?.library as NodeLibraryLike | undefined;
  if (!lib || typeof lib.addLight !== 'function' || typeof lib.getLightNodeClass !== 'function') return false;
  if (lib.getLightNodeClass(LightFieldLight) === LightFieldNode) return true;
  lib.addLight(LightFieldNode, LightFieldLight);
  return true;
}

// ---------------------------------------------------------------------------------------------
// QA: GPU readback of the TSL decode (browser parity check against the CPU mirror sampleField)

export interface FieldProbePoint { p: readonly [number, number, number]; n?: readonly [number, number, number] | null }
export interface FieldProbeValue { amb: [number, number, number]; dirColor: [number, number, number]; dir: [number, number, number] }

interface ProbeRenderer {
  getRenderTarget(): unknown;
  setRenderTarget(t: unknown): void;
  readRenderTargetPixelsAsync(t: RenderTarget, x: number, y: number, w: number, h: number): Promise<ArrayLike<number>>;
}

/**
 * Evaluate lightFieldSample (the exact TSL the lighting node uses, with the surface-normal offset) on the GPU for each
 * point against the CURRENTLY BOUND field and circuit levels, and read the results back (three N x 1 float targets:
 * isotropic rgb, directional rgb, direction). All three passes are submitted in one task, so the levels cannot change
 * between them. QA only (?qa=1): it compiles one extra pipeline.
 */
export interface ProbeOptions { mode?: 'sample' | 'const' | 'uniforms'; type?: 'float' | 'half'; clear?: boolean; depthBuffer?: boolean; base?: boolean }
export async function probeLightFieldGPU(renderer: ProbeRenderer, pts: readonly FieldProbePoint[], o: ProbeOptions = {}): Promise<{values: FieldProbeValue[]; levels: [number, number, number]; type: string; raw?: string; draws?: number[]}> {
  const {mode = 'sample', type = 'half', clear = true, depthBuffer = false, base = true} = o;
  const N = pts.length;
  const P = new Float32Array(N * 4), Nn = new Float32Array(N * 4);
  pts.forEach((q, i) => { P.set([q.p[0], q.p[1], q.p[2], 1], i * 4); if (q.n) Nn.set([q.n[0], q.n[1], q.n[2], 0], i * 4); });
  const dt = (d: Float32Array) => { const t = new THREE.DataTexture(d, N, 1, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
  const posT = dt(P), nrmT = dt(Nn);
  const row = uniform(0);
  const mat = base ? new NodeMaterial() : new MeshBasicNodeMaterial();
  mat.name = 'light-field-probe';
  mat.depthTest = mat.depthWrite = false;
  mat.blending = THREE.NoBlending;
  mat.fragmentNode = Fn(() => {
    const i = int(floor(n(screenCoordinate).x));
    // pipeline self-checks: 'const' = (pixel index, row, 7), 'uniforms' = the bound field's texture size / bound flag
    if (mode === 'const') return vec4(n(floor(n(screenCoordinate).x)), row, 7, 1);
    if (mode === 'uniforms') return vec4(n(n(LF.dims).x).add(n(LF.dims).y.mul(1000)), n(LF.dims).z, n(LF.bound).add(n(LF.gain).mul(10)), 1);
    const s = lightFieldSample(n(textureLoad(posT, ivec2(i, 0))).xyz, {normal: n(textureLoad(nrmT, ivec2(i, 0))).xyz});
    // If-assignments (built on the Fn stack), not select(): on the GLSL backend select() builds its branches isolated and
    // the field's vars inside them then have no stack ("can't access property addToStack", the 00:15Z browser probe)
    const out = vec4(n(s.dir), 1).toVar();
    If(n(row).lessThan(1.5), () => { out.assign(vec4(n(s.dirColor), 1)); });
    If(n(row).lessThan(0.5), () => { out.assign(vec4(n(s.amb), 1)); });
    return out;
  })();
  const quad = new QuadMesh(mat);
  const rts = [0, 1, 2].map(() => new RenderTarget(N, 1, {type: type === 'float' ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, samples: 0}));
  const r = renderer as ProbeRenderer & {autoClear?: boolean; clear?(c?: boolean, d?: boolean, s?: boolean): void; info?: {render?: {drawCalls?: number}}};
  const autoClear = r.autoClear;
  const draws: number[] = [];
  const prev = renderer.getRenderTarget();
  const levels = n(LF.levels).value.toArray() as [number, number, number];
  try {
    rts.forEach((rt, k) => {
      row.value = k;
      renderer.setRenderTarget(rt);
      if (clear && r.clear) r.clear(true, depthBuffer, false);
      const d0 = r.info?.render?.drawCalls ?? 0;
      quad.render(renderer as never);
      draws.push((r.info?.render?.drawCalls ?? 0) - d0);
    });
    renderer.setRenderTarget(prev);
    const out = await Promise.all(rts.map(rt => renderer.readRenderTargetPixelsAsync(rt, 0, 0, N, 1)));
    // half-float targets read back as raw 16-bit words
    const num = (a: ArrayLike<number>, j: number) => (a instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(a[j]) : Number(a[j]));
    const v = (k: number, i: number): [number, number, number] => [num(out[k], i * 4), num(out[k], i * 4 + 1), num(out[k], i * 4 + 2)];
    const raw = `${out[0]?.constructor?.name}[${out[0]?.length}]`;
    return {values: pts.map((_, i) => ({amb: v(0, i), dirColor: v(1, i), dir: v(2, i)})), levels, type, raw, draws};
  } finally {
    if (autoClear !== undefined) r.autoClear = autoClear;
    renderer.setRenderTarget(prev);
    for (const rt of rts) rt.dispose();
    posT.dispose(); nrmT.dispose(); mat.dispose();
  }
}
