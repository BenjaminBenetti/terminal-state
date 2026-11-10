// Volumetric atmosphere pass (iteration 06, Lane F; iteration 13, FOG lane: a TSL RenderPipeline on WebGPURenderer).
//
// Frame (quality low / high, see ATMOSPHERE_QUALITY), one three r186 RenderPipeline (three/webgpu) per scene + camera:
//   1. scene pass: pass(scene, camera) renders the station into an HDR half-float target (MSAA like the canvas) with its
//      depth texture, LINEAR (WebGPURenderer tone-maps in the pipeline's output transform, once); three renders the
//      flashlight's spot shadow map during it;
//   2. fog pass (FogPassNode, a TempNode run once per frame after the scene pass): the half / quarter-res raymarch
//      (render/volumetricShaders.ts createMarchMaterial: world-anchored moving medium, smoke, in-scattering from the
//      flashlight cone + shadow map, the baked fixture light field, the muzzle flash and the flares, extinction), then the
//      reprojected temporal accumulation (ping-pong targets);
//   3. composite = the pipeline's output node: depth-aware upsample, scene x transmittance + in-scatter in linear HDR, then
//      the pipeline's output transform (ACES at renderer.toneMappingExposure + sRGB) to the canvas. CORE then composites the
//      viewmodel overlay on top (render/overlay.ts), never fogged.
// Quality 'off', a disabled pass, an unsupported backend or a failed fog shader render the station straight to the canvas
// (the renderer's own output pass tone-maps). The pass adds no lights or objects to the station scene.
// One TSL graph compiles to WGSL on the WebGPU backend and to GLSL on the WebGL2 fallback; `backend` says which one ran.
//
// Iteration 13 (FOG): the medium is persistent (pure function of world point, station seed and the station's fog clock =
// game time since the station started; pause freezes it), moves (constant world velocities: air drift, tunnel draft on the
// track beds, a faster wisp / warp field), and has clear / normal / dense areas (render/atmosphere.ts). Smoke / scatter API
// unchanged (render/smoke.ts): addSmokeEmitter / clearSmoke / addScatterLight / removeScatterLight.
//
// Task gasmask-breach-20261030 (lane GAS): breach gas layers. setStation allocates an R8 DataArrayTexture with the density
// map's w / h / slots (zero; before the warm-up, its id in the march key), so the first breach never builds a program.
// setGasLayer(slot, field, rect) quantises a storey's field (world/gas/field.ts, ticked by world/gas/system.ts from the frame
// hooks — never from this render path) into its layer and marks it; the next rendered frame uploads only the marked layers
// (DataArrayTexture.addLayerUpdate: both backends copy just those layers) and sets the `gasOn` gate.
//
// Task reactor-build-20261101 (lane AIR): THE REACTOR's depth gas strata. setStation keys the march program by layout.reactor (the
// depth term is compiled only there, before the warm-up: no runtime rebuild; every other level keeps the previous key / program);
// setDepthGas(table) — called by world/reactor/generators.ts only when the clearing changes — copies the strata table / rect /
// range into the march uniforms and sets the `depthOn` gate (closed once every stratum is clear).
// Task reactor-submit-roof-fog-20261102 (lane FOG): the table goes into the march's TABLE_N x 1 float data texture (u.depthTab; one
// tiny upload per clearing change), not a uniform array — the extra uniform buffer took the depth variant to 13 per fragment stage,
// over WebGPU's default 12: on WebGPU the Reactor's (and since the outdoor roof air, the Office's) volumetric pass failed outright.

import * as THREE from 'three';
import {NodeMaterial, NodeUpdateType, QuadMesh, RenderPipeline, RenderTarget, RendererUtils, TempNode, type PassNode, type WebGPURenderer} from 'three/webgpu';
import {pass, passTexture, texture} from 'three/tsl';
import type {StationLayout} from '../gen/station';
import {SOLID, type Grid} from '../gen/grid';
import {MAX_SLOTS, type LightFieldVolume} from '../world/lightField';
import {stationLevels} from '../world/levelGeometry';
import {
  ATMOSPHERE_QUALITY, NOISE_CHANNELS, NOISE_SIZE, SHADOW_NEAR, SHADOW_NORMAL_BIAS, atmosphereFor, buildAirMap, buildDensityMap,
  buildNoiseVolume, densityLayerRange, densitySlot, fieldOffsets, fogMotion, marchSize, mediumAt, mediumStats, noiseScales, sampleAirMap, shadowBiasFor,
  type AirMap, type AreaClass, type AtmosphereParams, type AtmosphereQuality, type DensityMap, type FogMotion, type MediumMaps,
  type QualityPreset,
} from './atmosphere';
import {
  SMOKE_LIMITS, ScatterLights, SmokeField, VIS_EMITTER_SPAN, VIS_RES, VIS_TEXEL, VIS_WINDOWS, computeVisWindow, computeVisWindowFan, windowStale,
  type SmokeEmitterOptions, type SmokeHandle, type VisLookup,
} from './smoke';
import {bindFlareVisibility, isFlareLight} from '../world/flareLight'; // Iteration 15
import {VF_LIMITS, VF_MARK, createCompositeNode, createFogUniforms, createMarchMaterial, createTemporalMaterial, type FogUniforms} from './volumetricShaders';
import {GAS} from '../world/gas/field'; // task gasmask-breach-20261030
import {REACTOR_GAS_LOOK, type DepthGasTable} from '../world/reactor/air'; // task reactor-build-20261101 (lane AIR)
// task reactor-expansion-20261101 (lane GASLIGHT): the toxic-gas visibility rule — the regional term's outdoor part (the Office roof deck,
// the Reactor's open pit top), the pit's light shafts, the in-engine fog fallback when the pass is off
import {PIT_SHAFTS, ROOF_GAS_LOOK, fallbackFog, officeRoofGas, type OutdoorGas, type ShaftSpec} from '../world/gaslightRules';
import {ROOF_FOG, roofAirOf} from '../world/roofAir';
import {RIDE_MASK} from '../world/rideMask'; // task studio-perf-ao-train-continuity-20261110-022206-01: the ride tunnel's medium (the CPU mirror)

/** Task gasmask-breach-20261030: the gas term's look (uniform values only; QA may edit them live). */
export interface GasLook { ext: number; scatter: number; emission: number; noise: number; tint: [number, number, number] }

/** Task reactor-build-20261101 (lane AIR): the Reactor depth gas's look (uniform values only; QA may edit them live). */
export interface DepthGasLook { ext: number; scatter: number; emission: number; wisps: number; sheets: number; sheetXZ: number; sheetY: number; tint: [number, number, number] }

export interface AtmosphereLights {
  flashlight: THREE.SpotLight;
  muzzle?: THREE.PointLight | null;
}

export type AtmosphereBackend = 'webgpu' | 'webgl2-fallback' | 'none';

export interface AtmosphereDebug {
  /** Iteration 13: the renderer backend the fog pass runs on (never inferred from navigator.gpu). */
  backend: AtmosphereBackend;
  requested: AtmosphereQuality;
  quality: AtmosphereQuality;
  enabled: boolean;
  active: boolean;
  supported: boolean;
  reason: string | null;
  failed: string | null;
  resolution: {full: [number, number]; march: [number, number]; scale: number};
  steps: number;
  temporal: boolean;
  msaa: number;
  shadow: {enabled: boolean; mapSize: number; bias: number; normalBias: number; near: number; updating: boolean; casters: number; receivers: number; sampled: boolean};
  station: {bound: boolean; densityMap: [number, number] | null; field: boolean; airMap: boolean; draft: number; seed: number | null};
  /** Iteration 13: the station fog clock (s since the station started; frozen while paused) and the medium's motion. */
  time: {fog: number; game: number; epoch: number | null};
  motion: {air: number[]; track: number[]; detail: number[]; speeds: {air: number; track: number; detail: number}} | null;
  /** Iteration 13: medium statistics at walking height (station mean sigma, clear / dense volume fractions, per area class). */
  density: {base: number; mean: number; clearFrac: number; denseFrac: number; byClass: Record<AreaClass | 'track', number>; areas: Record<AreaClass, number>} | null;
  params: Omit<AtmosphereParams, 'areaDensity' | 'classOdds'>;
  /** Smoke emitters / puffs and scatter lights in the march (bounded: SMOKE_LIMITS). */
  smoke: {emitters: number; puffs: number; limits: typeof SMOKE_LIMITS; stats: SmokeField['stats']; list: {id: number; emitting: boolean; puffs: number; x: number; y: number; z: number}[]};
  scatter: {lights: number; active: number; windows: number};
  /** cpu: submission time (ms) of the fog passes / the whole pipeline frame. */
  ms: {gpu: number | null; cpu: number; cpuScene: number};
  frames: number;
  /** Fog pass runs and material (re)builds (QA). */
  passes: {fog: number; marchBuilds: number};
}

/** `?fog=off|low|high` session override (QA / slow renderers). */
export function fogOverrideFromUrl(search: string | undefined = (globalThis as {location?: Location}).location?.search): AtmosphereQuality | null {
  const v = search ? new URLSearchParams(search).get('fog') : null;
  return v === 'off' || v === 'low' || v === 'high' ? v : null;
}

/**
 * Flashlight spot shadow for a quality level (off: no shadow map at all). Iteration 13: the renderer's shadowMap stays
 * enabled (CORE); only the light's castShadow follows the quality (it is part of three's light hash, so lit materials
 * rebuild with / without the shadow). `renderer` is accepted for the iteration-12 signature and only checked.
 */
export function configureFlashlightShadow(light: THREE.SpotLight, q: AtmosphereQuality, renderer: {shadowMap?: {enabled: boolean; type: THREE.ShadowMapType}} | null): void {
  const on = q !== 'off';
  if (renderer?.shadowMap && on) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }
  light.castShadow = on;
  if (!on) return;
  const size = ATMOSPHERE_QUALITY[q].shadowMapSize;
  light.shadow.mapSize.set(size, size);
  light.shadow.camera.near = SHADOW_NEAR;
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = shadowBiasFor(size, light.angle);
  light.shadow.normalBias = SHADOW_NORMAL_BIAS;
  light.shadow.radius = 1;
}

function litOpaque(m: THREE.Material | null | undefined): boolean {
  if (!m || m.transparent || !m.visible || m.colorWrite === false || m.depthWrite === false) return false;
  const t = m as THREE.Material & {isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshToonMaterial?: boolean};
  return !!(t.isMeshStandardMaterial || t.isMeshLambertMaterial || t.isMeshPhongMaterial || t.isMeshToonMaterial);
}

/**
 * Flashlight shadow casters/receivers under `root`: opaque lit meshes cast; they receive when
 * `receive`. `structure`: single-sided architecture also casts from its lit side (shadowSide double).
 * Iteration 13 (FOG): skinned meshes (zombie bodies / clothing) cast but never RECEIVE the flashlight shadow: under
 * WebGPURenderer their thin, animated clothing self-shadowed into jagged streaks (MAT-B A/B, lanes/matb.notes); they still
 * block the beam and shadow the world behind them.
 */
export function markShadows(root: THREE.Object3D, receive: boolean, structure: boolean): {casters: number; receivers: number} {
  let casters = 0, receivers = 0;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats.length || !mats.every(litOpaque)) return;
    m.castShadow = true;
    const rec = receive && !(m as THREE.SkinnedMesh).isSkinnedMesh;
    m.receiveShadow = rec;
    casters++;
    if (rec) receivers++;
    if (structure) for (const x of mats) if (x.shadowSide === null && x.side === THREE.FrontSide) x.shadowSide = THREE.DoubleSide;
  });
  return {casters, receivers};
}

/** RG / R data textures for the medium maps (linear filtering, clamp, no mipmaps). */
function layerTexture(data: Uint8Array, w: number, h: number, n: number, format: THREE.PixelFormat): THREE.DataArrayTexture {
  const t = new THREE.DataArrayTexture(data, w, h, n);
  t.format = format;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** The per-frame fog pass inside the RenderPipeline: runs after the scene pass (it forces that order), once per frame. */
class FogPassNode extends TempNode {
  static get type(): string { return 'FogPassNode'; }
  readonly tex0: ReturnType<typeof passTexture>;
  readonly tex1: ReturnType<typeof passTexture>;
  constructor(private readonly owner: VolumetricAtmosphere, private readonly scenePass: PassNode, t0: THREE.Texture, t1: THREE.Texture) {
    super('vec4');
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.tex0 = passTexture(this as never, t0);
    this.tex1 = passTexture(this as never, t1);
  }
  updateBefore(frame: unknown): boolean | undefined {
    const f = frame as {renderer: WebGPURenderer; updateBeforeNode(n: unknown): void};
    f.updateBeforeNode(this.scenePass); // the scene (depth + shadow map) of THIS frame first; no-op when already done
    this.owner.runFog(f.renderer);
    return undefined;
  }
  setup(): never {
    return this.tex0 as never;
  }
}

interface WebGPUDeviceLike { pushErrorScope(f: string): void; popErrorScope(): Promise<{message: string} | null> }

let rendererState: unknown;

export class VolumetricAtmosphere {
  /** Tunables of the current station (atmosphereFor(layout)); may be edited live (QA). */
  params: AtmosphereParams = atmosphereFor(null);
  /** Volumetric pass on/off (QA before/after); the flashlight shadow follows the quality only. */
  enabled = true;
  /** Session override (?fog=, QA) that wins over the settings quality. */
  override: AtmosphereQuality | null = fogOverrideFromUrl();
  failed: string | null = null;
  supported = true;
  reason: string | null = null;
  requested: AtmosphereQuality;
  quality: AtmosphereQuality = 'off';
  densityMap: DensityMap | null = null;
  /** Iteration 13: where the tunnel draft carries the haze (render/atmosphere.ts buildAirMap). */
  airMap: AirMap | null = null;
  /** Iteration 13: the station's seeded fog motion. */
  motion: FogMotion | null = null;
  readonly noiseData: Uint8Array;
  readonly noise: THREE.Data3DTexture;
  /** Iteration 13: every TSL uniform of the passes (CPU objects; set by sync()). */
  readonly u: FogUniforms = createFogUniforms();
  /** Smoke puffs and scatter lights (render/smoke.ts); use the methods below. */
  readonly smoke = new SmokeField();
  readonly scatter = new ScatterLights();
  private full: [number, number] = [1, 1];
  private low: [number, number] = [1, 1];
  private densityTex: THREE.DataArrayTexture;
  private airTex: THREE.DataArrayTexture;
  private readonly placeholderDensity: THREE.DataArrayTexture;
  private readonly placeholderAir: THREE.DataArrayTexture;
  // task gasmask-breach-20261030: breach gas layers (R8, the density map's grid) + layers waiting for upload
  private gasTex: THREE.DataArrayTexture;
  private readonly placeholderGas: THREE.DataArrayTexture;
  private gasData: Uint8Array | null = null;
  private readonly gasDirty = new Set<number>();
  private gasAny = false;
  /** Task track1-siren-blightbelly-20261031 (lane BLIGHT): non-zero gas bytes (temporary puffs expire: the gate closes again). */
  private gasNonZero = 0;
  private gasUploads = 0;
  /** Task gasmask-breach-20261030: the gas term's look (sync copies it into the uniforms). */
  readonly gasLook: GasLook = {ext: GAS.EXT, scatter: GAS.SCATTER, emission: GAS.EMISSION, noise: GAS.NOISE, tint: [...GAS.TINT]};
  // task reactor-build-20261101 (lane AIR): the depth term is compiled for this station (layout.reactor), any stratum left, uploads
  private depthCompiled = false;
  private depthAny = false;
  private depthUploads = 0;
  // task reactor-expansion-20261101 (lane GASLIGHT): the regional term's outdoor part / the pit's shafts of this station (QA), the shaft
  // look (gain tunable live), the fallback's eye concentration and the scene fog it borrowed for one direct() frame
  private depthOutdoor: OutdoorGas | null = null;
  private depthShafts: ShaftSpec | null = null;
  readonly shaftLook = {gain: PIT_SHAFTS.gain as number, colour: [...PIT_SHAFTS.colour] as [number, number, number], fade: PIT_SHAFTS.fade as number};
  private gasFallbackC = 0;
  /** Task reactor-expansion-20261101 (lane GASLIGHT): frames the in-engine gas fog fallback drew (QA / tests). */
  gasFallbackFrames = 0;
  private readonly fogKeep = {color: new THREE.Color(), density: 0};
  /** Task reactor-build-20261101 (lane AIR): the depth gas's look (syncGas copies it into the uniforms). */
  readonly depthLook: DepthGasLook = {ext: REACTOR_GAS_LOOK.ext, scatter: REACTOR_GAS_LOOK.scatter, emission: REACTOR_GAS_LOOK.emission, wisps: REACTOR_GAS_LOOK.wisps,
    sheets: REACTOR_GAS_LOOK.sheets, sheetXZ: REACTOR_GAS_LOOK.sheetXZ, sheetY: REACTOR_GAS_LOOK.sheetY, tint: [...REACTOR_GAS_LOOK.tint]};
  private readonly visData = new Uint8Array(VIS_RES * VIS_RES * VIS_WINDOWS);
  readonly visTex: THREE.DataArrayTexture;
  private readonly lightLayer = new Map<THREE.PointLight, number>();
  private readonly smokeLayer = new Map<number, number>();
  private readonly winState: {x0: number; z0: number; texel: number; floor: number; ceil: number; ok: boolean}[] = Array.from({length: VIS_WINDOWS}, () => ({x0: 0, z0: 0, texel: 0.5, floor: -1e3, ceil: 1e3, ok: false}));
  private levelGrids: Grid[] = [];
  private lastFogTime = Number.NaN;
  private field: LightFieldVolume | null = null;
  private layout: StationLayout | null = null;
  /** Game time at which the current station's fog clock started (set on the first frame after setStation). */
  private epoch: number | null = null;
  private gameTime = 0;
  private statsCache: AtmosphereDebug['density'] = null;
  // pipeline / passes (created on the first active frame; rebuilt on scene / camera / MSAA change)
  private pipeline: RenderPipeline | null = null;
  private scenePass: PassNode | null = null;
  private fogNode: FogPassNode | null = null;
  private pipeKey = '';
  private pipeScene: THREE.Scene | null = null;
  private pipeCamera: THREE.Camera | null = null;
  private marchRT: RenderTarget | null = null;
  private history: [RenderTarget, RenderTarget] | null = null;
  private histIndex = 0;
  private historyValid = false;
  private marchMat: NodeMaterial | null = null;
  private marchKey = '';
  private temporalMat: NodeMaterial | null = null;
  private readonly hist0 = texture(new THREE.Texture());
  private readonly hist1 = texture(new THREE.Texture());
  private readonly quad = new QuadMesh(new NodeMaterial());
  private frame = 0;
  private readonly prevView = new THREE.Matrix4();
  private readonly prevProj = new THREE.Matrix4();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private cpuMs = 0;
  private cpuSceneMs = 0;
  private casters = 0;
  private receivers = 0;
  private fogRuns = 0;
  private marchBuilds = 0;
  private errorChecks = 0;
  private disposed = false;
  private configured = false;
  private attached = false;
  private prevShaderError: ((...a: unknown[]) => void) | null = null;
  private onShaderError: ((...a: unknown[]) => void) | null = null;

  constructor(private readonly renderer: WebGPURenderer | null, private readonly lights: AtmosphereLights, quality: AtmosphereQuality = 'high') {
    this.checkBackend();
    this.requested = quality;
    this.noiseData = buildNoiseVolume();
    const noise = new THREE.Data3DTexture(this.noiseData, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
    noise.format = NOISE_CHANNELS === 4 ? THREE.RGBAFormat : THREE.RGFormat;
    noise.type = THREE.UnsignedByteType;
    noise.minFilter = noise.magFilter = THREE.LinearFilter;
    noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
    noise.generateMipmaps = false;
    noise.unpackAlignment = 1;
    noise.colorSpace = THREE.NoColorSpace;
    noise.name = 'fog-noise';
    noise.needsUpdate = true;
    this.noise = noise;
    this.visTex = layerTexture(this.visData, VIS_RES, VIS_RES, VIS_WINDOWS, THREE.RedFormat);
    this.visTex.name = 'fog-vis-windows';
    bindFlareVisibility(this.visTex); // Iteration 15: flare surface light uses the same occlusion windows (world/flareLight.ts)
    this.placeholderDensity = layerTexture(new Uint8Array(4), 1, 1, 1, THREE.RGBAFormat);
    this.placeholderAir = layerTexture(new Uint8Array(1), 1, 1, 1, THREE.RedFormat);
    this.placeholderGas = layerTexture(new Uint8Array(1), 1, 1, 1, THREE.RedFormat);
    this.densityTex = this.placeholderDensity;
    this.airTex = this.placeholderAir;
    this.gasTex = this.placeholderGas;
    this.setQuality(quality);
  }

  /**
   * Support check against the renderer's ACTUAL backend (WebGPURenderer swaps in its WebGL2 backend during init() when
   * WebGPU is unavailable, so this runs again on the first frame after init): half-float colour targets are core in WebGPU;
   * the WebGL2 backend needs EXT_color_buffer_float / _half_float.
   */
  private checkBackend(): void {
    const b = this.renderer?.backend as unknown as {isWebGLBackend?: boolean; extensions?: {has(n: string): boolean}} | undefined;
    if (b?.isWebGLBackend && b.extensions && !b.extensions.has('EXT_color_buffer_float') && !b.extensions.has('EXT_color_buffer_half_float')) {
      this.supported = false;
      this.reason = 'no float colour render targets on the WebGL2 backend (EXT_color_buffer_float / _half_float)';
    } else {
      this.supported = true;
      this.reason = null;
    }
  }

  /**
   * After the renderer initialized: re-check support on the real backend and chain a WebGL2 shader-error handler in front of
   * the one already installed (CORE records errors into game.gpu): a failing fog program flags the module and the station
   * renders directly from the next frame on (never a black canvas, never a fake success). Idempotent.
   */
  private attach(): void {
    if (this.attached || !this.renderer || !(this.renderer as unknown as {initialized?: boolean}).initialized) return;
    this.attached = true;
    const was = this.supported;
    this.checkBackend();
    if (was !== this.supported) { this.configured = false; this.setQuality(this.requested); }
    const dbg = this.renderer.debug as unknown as {onShaderError: ((...a: unknown[]) => void) | null};
    this.prevShaderError = dbg.onShaderError ?? null;
    const prev = this.prevShaderError;
    this.onShaderError = (...a: unknown[]) => {
      const [gl, , vs, fs] = a as [WebGL2RenderingContext, unknown, WebGLShader, WebGLShader];
      const src = `${gl?.getShaderSource?.(fs) ?? ''}${gl?.getShaderSource?.(vs) ?? ''}`;
      if (Object.values(VF_MARK).some(m => src.includes(m))) this.failed = 'volumetric fog program failed to compile/link (WebGL2 backend); rendering without atmosphere';
      if (prev) prev(...a);
      else console.error('THREE.WebGLBackend: shader error', gl?.getShaderInfoLog?.(fs));
    };
    dbg.onShaderError = this.onShaderError;
  }

  /** Iteration 13: backend of the renderer the passes run on (from the initialized backend object). */
  get backend(): AtmosphereBackend {
    const b = this.renderer?.backend as unknown as {isWebGPUBackend?: boolean; isWebGLBackend?: boolean} | undefined;
    return b?.isWebGPUBackend ? 'webgpu' : b?.isWebGLBackend ? 'webgl2-fallback' : 'none';
  }

  /** Preset of the current (non-off) quality. */
  get preset(): QualityPreset | null {
    return this.quality === 'off' ? null : ATMOSPHERE_QUALITY[this.quality];
  }

  /** The volumetric pass runs this frame (otherwise: direct rendering). */
  get active(): boolean {
    return this.enabled && this.quality !== 'off' && !this.failed && this.supported && !!this.densityMap && !this.disposed && !!this.renderer;
  }

  /** Settings quality ('low' | 'high') or explicit 'off'; the session override wins. */
  setQuality(requested: AtmosphereQuality): void {
    this.requested = requested;
    const q: AtmosphereQuality = this.supported ? this.override ?? requested : 'off';
    if (q === this.quality && this.configured) return;
    this.configured = true;
    this.quality = q;
    configureFlashlightShadow(this.lights.flashlight, q, this.renderer as never);
    this.dropTargets(); // recreated lazily with the new MSAA / resolution / step count
    this.setSize(this.full[0], this.full[1]);
  }

  /** Drawing-buffer size (renderer.getDrawingBufferSize). */
  setSize(w: number, h: number): void {
    this.full = [Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))];
    const p = this.preset;
    this.low = p ? marchSize(this.full[0], this.full[1], p) : [1, 1];
    this.marchRT?.setSize(this.low[0], this.low[1]);
    for (const h2 of this.history ?? []) h2.setSize(this.low[0], this.low[1]);
    this.historyValid = false;
  }

  /** New station: per-level tunables, density + air maps, seeded motion, the baked light field; drops smoke; restarts the fog clock. */
  setStation(layout: StationLayout, field: LightFieldVolume | null): void {
    this.layout = layout;
    this.params = atmosphereFor(layout);
    this.densityMap = buildDensityMap(layout, this.params);
    this.airMap = buildAirMap(layout);
    this.motion = fogMotion(layout.seed, this.params);
    // Task office-seamless-20261029: every storey (the density map's layers = light-field slots; was capped at 4, so a flare
    // on storey 4+ had no occlusion window: no storey band, glow through the slabs).
    this.levelGrids = stationLevels(layout).slice(0, MAX_SLOTS).map(L => L.grid);
    if (this.densityTex !== this.placeholderDensity) this.densityTex.dispose();
    if (this.airTex !== this.placeholderAir) this.airTex.dispose();
    const m = this.densityMap;
    this.densityTex = layerTexture(m.data, m.w, m.h, m.slots, THREE.RGBAFormat);
    this.densityTex.name = 'fog-density-map';
    this.airTex = layerTexture(this.airMap.data, this.airMap.w, this.airMap.h, this.airMap.slots, THREE.RedFormat);
    this.airTex.name = 'fog-air-map';
    // task gasmask-breach-20261030: the station's (empty) gas layers, allocated now so the warm-up compiles the march with them
    if (this.gasTex !== this.placeholderGas) this.gasTex.dispose();
    this.gasData = new Uint8Array(m.w * m.h * m.slots);
    this.gasTex = layerTexture(this.gasData, m.w, m.h, m.slots, THREE.RedFormat);
    this.gasTex.name = 'fog-gas-map';
    this.gasDirty.clear();
    this.gasAny = false;
    this.gasNonZero = 0; // lane BLIGHT
    this.u.gasOn.value = 0;
    // task reactor-build-20261101 (lane AIR): the depth term exists for a reactor layout only (part of the march key: compiled by the warm-up)
    // task reactor-expansion-20261101 (lane GASLIGHT): ... and for the Office roof's outdoor toxic air (the same regional term, outdoor part
    // only: its exposure is world/roofAir.ts roofBlend x GAS.ROOF_OUTDOOR_C, drawn here by the identical ramp); each with its own look
    const roof = layout.reactor ? null : roofAirOf(layout);
    this.depthCompiled = !!layout.reactor || !!roof;
    this.depthAny = false;
    this.u.depthOn.value = 0;
    this.depthTable.fill(0);
    this.depthTableTex.needsUpdate = true; // (lane FOG) the table texture: zero until the runtime uploads
    this.applyDepthLook(roof ? ROOF_GAS_LOOK : REACTOR_GAS_LOOK);
    this.setOutdoor(null);
    this.setShafts(null);
    this.gasFallbackC = 0;
    if (roof) {
      const o = officeRoofGas(roof.foot, roof.baseY, ROOF_FOG.below, ROOF_FOG.above, GAS.ROOF_OUTDOOR_C);
      this.u.depthRect.value.set(o.rect.x0, o.rect.z0, o.rect.x1, o.rect.z1);
      this.u.depthRange.value.set(roof.baseY - 2, roof.baseY - 1, 1, 0); // no strata: the table (all 0) ends below the deck
      this.setOutdoor(o);
      this.depthAny = true;
      this.u.depthOn.value = 1;
    }
    this.field = field;
    this.epoch = null; // the fog clock restarts at the station's first frame
    this.statsCache = null;
    this.historyValid = false;
    this.casters = this.receivers = 0;
    this.marchKey = ''; // the march samples the new maps (texture objects changed)
    // smoke / scatter lights belong to the previous station (the light lane re-adds its flares' lights)
    this.clearSmoke();
    this.scatter.clear();
    this.lightLayer.clear();
    this.lastFogTime = Number.NaN;
    this.smoke.env = {
      band: (x, y, z) => this.bandAt(x, y, z),
      open: (x, y, z) => this.openAt(x, y, z),
      drift: (x, y, z) => this.driftAt(x, y, z),
    };
  }

  /** Mark flashlight shadow casters/receivers (call for the station structure, containers, zombies). */
  markShadows(root: THREE.Object3D, structure: boolean): void {
    const r = markShadows(root, this.params.surfaceShadows, structure);
    this.casters += r.casters;
    this.receivers += r.receivers;
  }

  // --- fog clock + density queries (iteration 13) ------------------------------------------------------------------

  /** The station fog clock for game time `time` (s since the station's first frame; game time freezes in menus). */
  fogTime(time = this.gameTime): number {
    return this.epoch === null ? 0 : Math.max(0, time - this.epoch);
  }

  private maps(): MediumMaps {
    return {map: this.densityMap, air: this.airMap, noise: this.noiseData, motion: this.motion};
  }

  /**
   * The world haze at (x, y, z) — exactly what the march integrates there (CPU mirror) — at the current fog time (or `t`).
   * Depends only on the point, the station and the fog clock: never on the camera, visited rooms or render history.
   */
  fogSample(x: number, y: number, z: number, t = this.fogTime()): {sigma: number; dense: number; detail: number; mult: number; slot: number; time: number} {
    if (!this.densityMap) return {sigma: 0, dense: 0, detail: 0, mult: 0, slot: 0, time: t};
    const s = mediumAt([x, y, z], this.maps(), this.params, t, undefined, RIDE_MASK); // (task studio-perf-ao-train-continuity-20261110-022206-01: the ride tunnel's plain bed medium, as the march)
    return {sigma: s.sigma, dense: s.dense, detail: s.detail, mult: s.mult, slot: s.slot, time: t};
  }

  // --- smoke + scatter-light API (iteration 12, unchanged) ----------------------------------------------------------

  /**
   * World-space smoke rising from (x, y, z): soft analytic puffs in the volumetric march, tinted by `color`, lit by the
   * station's lights, with their own extinction. Returns a handle: setPos / update({x, y, z, ...}) / stop(fade s). At most
   * SMOKE_LIMITS.emitters at once (a fifth evicts the oldest, preferring one already stopping) and puffsPerEmitter puffs each.
   */
  addSmokeEmitter(o: SmokeEmitterOptions): SmokeHandle {
    return this.smoke.add(o);
  }

  /** Drop every smoke emitter and puff at once (new station / retry); their handles go inert. */
  clearSmoke(): void {
    this.smoke.clear();
    this.smokeLayer.clear();
  }

  /**
   * In-scattering of a PointLight in the haze / smoke (the burning flare's red light): its colour x intensity, three's
   * distance attenuation to its cutoff, occlusion-windowed on its storey. False when SMOKE_LIMITS.scatterLights are in use.
   */
  addScatterLight(light: THREE.PointLight): boolean {
    if (!this.scatter.add(light)) return false;
    if (!this.lightLayer.has(light)) {
      const used = new Set(this.lightLayer.values());
      for (let l = 0; l < SMOKE_LIMITS.scatterLights; l++) if (!used.has(l)) { this.lightLayer.set(light, l); break; }
    }
    return true;
  }

  removeScatterLight(light: THREE.PointLight): boolean {
    this.lightLayer.delete(light);
    return this.scatter.remove(light);
  }

  // --- task gasmask-breach-20261030: breach gas layers ---------------------------------------------------------------

  /**
   * Write a storey's gas concentration (`field`: row-major `rect.w` x `rect.h` cells starting at grid cell rect.x0 / y0,
   * values 0..1) into density-map slot `slot` (= its layout.levels index). Uploaded with the next rendered frame (that layer
   * only). Cells outside `rect` keep their bytes (zero). Ignored without a station or for a slot the map does not have.
   */
  setGasLayer(slot: number, field: ArrayLike<number>, rect: {x0: number; y0: number; w: number; h: number}): void {
    const m = this.densityMap, data = this.gasData;
    if (!m || !data || slot < 0 || slot >= m.slots) return;
    const base = slot * m.w * m.h;
    let nz = this.gasNonZero; // lane BLIGHT: count non-zero bytes so the gate closes once every layer is clean again
    for (let y = 0; y < rect.h; y++) {
      const gy = rect.y0 + y;
      if (gy < 0 || gy >= m.h) continue;
      for (let x = 0; x < rect.w; x++) {
        const gx = rect.x0 + x;
        if (gx < 0 || gx >= m.w) continue;
        const v = field[y * rect.w + x];
        const b = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
        const o = base + gy * m.w + gx;
        if ((data[o] !== 0) !== (b !== 0)) nz += b ? 1 : -1;
        data[o] = b;
      }
    }
    this.gasNonZero = nz;
    this.gasAny = nz > 0;
    this.gasDirty.add(slot);
  }

  /** Task gasmask-breach-20261030 (QA): the gas layers' state. */
  gasDebug(): {on: boolean; map: [number, number, number] | null; pending: number[]; uploads: number; look: GasLook} {
    const m = this.densityMap;
    return {on: this.gasAny, map: m && this.gasData ? [m.w, m.h, m.slots] : null, pending: [...this.gasDirty], uploads: this.gasUploads, look: {...this.gasLook, tint: [...this.gasLook.tint]}};
  }

  /** Marked gas layers -> the texture's layer updates (next upload copies only them); the gate and the look's uniforms. */
  private syncGas(): void {
    const u = this.u, g = this.gasLook;
    if (this.gasDirty.size && this.gasTex !== this.placeholderGas) {
      for (const s of this.gasDirty) this.gasTex.addLayerUpdate(s);
      this.gasTex.needsUpdate = true;
      this.gasUploads += this.gasDirty.size;
    }
    this.gasDirty.clear();
    u.gasOn.value = this.gasAny ? 1 : 0;
    u.gasK.value.set(g.ext, g.scatter, g.emission, g.noise);
    (u.gasTint.value as THREE.Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
    if (this.depthCompiled) { // task reactor-build-20261101 (lane AIR): the depth gas gate + look (reactor layouts only)
      const d = this.depthLook;
      u.depthOn.value = this.depthAny ? 1 : 0;
      u.depthK.value.set(d.ext, d.scatter, d.emission, d.wisps);
      u.depthSheet.value.set(d.sheetXZ, d.sheetY, d.sheets, 0);
      (u.depthTint.value as THREE.Vector3).set(d.tint[0], d.tint[1], d.tint[2]);
      // (lane GASLIGHT) the shafts' colour x gain and fade (QA may edit shaftLook live)
      const sl = this.shaftLook;
      (u.shaftCol.value as THREE.Vector3).set(sl.colour[0] * sl.gain, sl.colour[1] * sl.gain, sl.colour[2] * sl.gain);
      u.shaftA.value.w = sl.fade;
    }
  }

  /**
   * Task reactor-build-20261101 (lane AIR): the Reactor's depth gas strata (world/reactor/air.ts renderTable): the table of c at
   * evenly spaced heights over [yLo, yHi] (already x (1 − cleared)) inside `rect` -> the march uniforms. Call only when the clearing
   * changed (a copy of TABLE_N floats, no allocation). Ignored on a station without the compiled term (no layout.reactor) or null.
   */
  setDepthGas(d: DepthGasTable | null): void {
    const u = this.u;
    if (!this.depthCompiled || !d) { this.depthAny = false; u.depthOn.value = 0; return; }
    const tab = this.depthTable; // (lane FOG) the march's table texture (uploaded with the next rendered frame)
    let any = false;
    for (let i = 0; i < tab.length; i++) { const v = i < d.table.length ? d.table[i] : 0; tab[i] = v; if (v > 0.002) any = true; }
    this.depthTableTex.needsUpdate = true;
    u.depthRect.value.set(d.rect.x0, d.rect.z0, d.rect.x1, d.rect.z1);
    const span = Math.max(1e-3, d.yHi - d.yLo);
    u.depthRange.value.set(d.yLo, d.yHi, 1 / span, 0);
    // task reactor-expansion-20261101 (lane GASLIGHT): the outdoor air above the open pit top keeps the term on after the strata clear
    this.setOutdoor(d.outdoor ?? null);
    this.setShafts(d.shafts ?? null);
    if (this.depthOutdoor && this.depthOutdoor.c > 0) any = true;
    this.depthAny = any;
    u.depthOn.value = any ? 1 : 0;
    this.depthUploads++;
  }

  /** Task reactor-submit-roof-fog-20261102 (lane FOG): the march's depth-table texture (u.depthTab's value; render/volumetricShaders.ts depthTableTexture). */
  get depthTableTex(): THREE.DataTexture {
    return (this.u.depthTab as unknown as {value: THREE.DataTexture}).value;
  }

  /** Task reactor-submit-roof-fog-20261102 (lane FOG): the strata table the march reads (TABLE_N floats; the texture's own data). */
  get depthTable(): Float32Array {
    return this.depthTableTex.image.data as Float32Array;
  }

  /** Task reactor-expansion-20261101 (lane GASLIGHT): the regional term's look (per station: the Reactor's strata, the Office roof air). */
  private applyDepthLook(l: {ext: number; scatter: number; emission: number; wisps: number; sheets: number; sheetXZ: number; sheetY: number; tint: readonly [number, number, number]}): void {
    const d = this.depthLook;
    d.ext = l.ext; d.scatter = l.scatter; d.emission = l.emission; d.wisps = l.wisps; d.sheets = l.sheets; d.sheetXZ = l.sheetXZ; d.sheetY = l.sheetY;
    d.tint = [l.tint[0], l.tint[1], l.tint[2]];
  }

  /** Task reactor-expansion-20261101 (lane GASLIGHT): the outdoor part's uniforms [y0, y1, c, vis] (null: none). */
  private setOutdoor(o: OutdoorGas | null): void {
    this.depthOutdoor = o;
    if (o && o.c > 0) this.u.depthOut.value.set(o.y0, Math.max(o.y1, o.y0 + 1e-3), o.c, o.vis);
    else this.u.depthOut.value.set(0, 1, 0, 1);
  }

  /**
   * Task reactor-expansion-20261101 (lane GASLIGHT): the pit's light-shaft uniforms (null: off). Task reactor-submit-roof-fog-20261102
   * (lane ROOF): through the roof's single opening disc (shaftHole), no beam stripes.
   */
  private setShafts(s: ShaftSpec | null): void {
    this.depthShafts = s;
    const u = this.u;
    if (!s) { u.shaftDir.value.set(0, -1, 0, 0); return; }
    const d = PIT_SHAFTS.dir, l = Math.hypot(d[0], d[1], d[2]) || 1;
    u.shaftDir.value.set(d[0] / l, d[1] / l, d[2] / l, 1);
    u.shaftRect.value.set(s.rect.x0, s.rect.z0, s.rect.x1, s.rect.z1);
    u.shaftA.value.set(s.roofY, 0, 0, this.shaftLook.fade);
    u.shaftB.value.set(0, 0, 0, PIT_SHAFTS.noiseScale);
    u.shaftC.value.set(PIT_SHAFTS.cover, PIT_SHAFTS.coverSoft, 0, 0);
    u.shaftHole.value.set(s.hole.x, s.hole.z, s.hole.r, Math.min(PIT_SHAFTS.rimSoft, s.hole.r));
  }

  /**
   * Task reactor-expansion-20261101 (lane GASLIGHT): the eye's gas concentration for the in-engine FALLBACK (world/gas/system.ts, every
   * frame): while the volumetric pass is off / unsupported / failed, direct() draws the frame with the scene's own FogExp2 tinted toward
   * the gas green and thickened by it (world/gaslightRules.ts fallbackFog), then restores the fog. No-op while the pass runs.
   */
  setGasFallback(c: number): void {
    this.gasFallbackC = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
  }

  /** Task reactor-build-20261101 (lane AIR, QA): the depth gas term's state. */
  depthDebug(): {compiled: boolean; on: boolean; uploads: number; range: number[]; rect: number[]; max: number; look: DepthGasLook; outdoor: OutdoorGas | null; shafts: ShaftSpec | null; fallback: number} {
    const u = this.u, r = u.depthRange.value as THREE.Vector4, q = u.depthRect.value as THREE.Vector4;
    return {compiled: this.depthCompiled, on: this.depthAny, uploads: this.depthUploads, range: [r.x, r.y], rect: [q.x, q.y, q.z, q.w],
      max: Math.max(0, ...this.depthTable), look: {...this.depthLook, tint: [...this.depthLook.tint]},
      outdoor: this.depthOutdoor, shafts: this.depthShafts, fallback: this.gasFallbackC}; // (lane GASLIGHT: + outdoor / shafts / fallback)
  }

  /** Storey band (local floor / ceiling) holding (x, y, z) from the density map, or null outside it. */
  bandAt(x: number, y: number, z: number): {floor: number; ceil: number; slot: number} | null {
    const m = this.densityMap;
    if (!m) return null;
    const cx = Math.floor(x / m.cell), cy = Math.floor(z / m.cell);
    if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return null;
    const slot = densitySlot(m, x, z, y);
    const o = ((slot * m.h + cy) * m.w + cx) * 4;
    const [y0, yr] = densityLayerRange(m, slot);
    return {floor: y0 + m.data[o + 1] / 255 * yr, ceil: y0 + m.data[o + 2] / 255 * yr, slot};
  }

  private openAt(x: number, y: number, z: number): boolean {
    const b = this.bandAt(x, y, z);
    const g = b ? this.levelGrids[b.slot] : null;
    if (!g) return true;
    const [cx, cy] = g.cellOf(x, z);
    return g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] !== SOLID;
  }

  /** Air drift at a point (m/s): the haze's own motion there (air drift, blended into the tunnel draft over track beds). */
  driftAt(x: number, y: number, z: number): readonly [number, number, number] {
    const mo = this.motion;
    if (!mo) return [0, 0, 0];
    const b = this.bandAt(x, y, z);
    const wt = this.airMap && b ? sampleAirMap(this.airMap, x, z, b.slot) : 0;
    return [mo.air[0] + (mo.track[0] - mo.air[0]) * wt, 0, mo.air[2] + (mo.track[2] - mo.air[2]) * wt];
  }

  private readonly visLookup: VisLookup = {
    grid: (x, y, z) => {
      const b = this.bandAt(x, y, z);
      const g = b ? this.levelGrids[b.slot] : null;
      return b && g ? {grid: g, floor: b.floor, ceil: b.ceil} : null;
    },
  };

  /** (Re)computes an occlusion window layer when its source moved; marks it for upload. */
  private refreshWindow(layer: number, st: {winX: number; winY: number; winZ: number; winT: number}, x: number, y: number, z: number, now: number): void {
    if (!windowStale(st, x, y, z, now)) return;
    st.winX = x; st.winY = y; st.winZ = z; st.winT = now;
    const n = VIS_RES * VIS_RES;
    // (task studio-general-armor-20261107-231448-01) scatter-light (flare) layers: 1 m texels (+-48 m); smoke emitter layers: 0.5 m, their central 24 m (as before)
    const scatterLayer = layer < SMOKE_LIMITS.scatterLights;
    const o = scatterLayer ? {texel: VIS_TEXEL.scatter} : {texel: VIS_TEXEL.emitter, span: VIS_EMITTER_SPAN};
    const dst = this.visData.subarray(layer * n, (layer + 1) * n), at = {x, y: y + 0.25, z};
    const w = scatterLayer ? computeVisWindowFan(at, this.visLookup, dst, o.texel) : computeVisWindow(at, this.visLookup, dst, o);
    this.winState[layer] = w ? {...w, ok: true} : {x0: 0, z0: 0, texel: o.texel, floor: -1e3, ceil: 1e3, ok: false};
    this.visTex.needsUpdate = true;
  }

  /** Smoke simulation + packing of puffs / scatter lights / windows into the march uniforms (each frame; `time` = fog time). */
  private syncSmoke(time: number): void {
    const dt = Number.isFinite(this.lastFogTime) ? time - this.lastFogTime : 0;
    this.lastFogTime = time;
    if (dt > 0) this.smoke.step(dt);
    const u = this.u, p = this.params;
    const win = u.win.array as THREE.Vector4[], winY = u.winY.array as THREE.Vector4[];
    // (the window's world size: VIS_RES texels of its own texel size — per layer since task studio-general-armor-20261107-231448-01)
    const sizeOf = (w: {texel: number}) => 1 / (VIS_RES * w.texel);
    const setWin = (k: number, layer: number) => {
      const w = this.winState[layer];
      if (w.ok) { win[k].set(w.x0, w.z0, sizeOf(w), layer); winY[k].set(w.floor, w.ceil, 0, 0); } else { win[k].set(0, 0, 1, -1); winY[k].set(-1e3, 1e3, 0, 0); }
    };
    const pos = u.scatPos.array as THREE.Vector4[], col = u.scatCol.array as THREE.Vector4[];
    let n = 0;
    for (const s of this.scatter.list) {
      const l = s.light;
      if (!l.visible || l.intensity <= 0 || n >= VF_LIMITS.scatter) continue;
      l.updateWorldMatrix(true, false);
      l.getWorldPosition(this.tmp);
      const layer = this.lightLayer.get(l) ?? n;
      if (this.densityMap) this.refreshWindow(layer, s, this.tmp.x, this.tmp.y, this.tmp.z, time);
      const k = l.intensity * p.scatterLightScatter;
      pos[n].set(this.tmp.x, this.tmp.y, this.tmp.z, l.distance);
      col[n].set(l.color.r * k, l.color.g * k, l.color.b * k, l.decay);
      // task reactor-expansion-20261101 (lane GASLIGHT): `userData.vfOpen` = a light in a big open volume (the Reactor core / coolant glow
      // in the pit): no occlusion window (it lights the haze and the gas strata everywhere within its distance cutoff, every storey)
      if (l.userData?.vfOpen) { win[n].set(0, 0, 1, -1); winY[n].set(-1e3, 1e3, 0, 0); } else setWin(n, layer);
      // Iteration 15: the same window occludes the flare's light on surfaces (no glow through walls / slabs)
      if (isFlareLight(l)) {
        const w = this.winState[layer];
        if (w.ok) { l.window.set(w.x0, w.z0, sizeOf(w), layer); l.band.set(w.floor, w.ceil); } else l.clearWindow();
      }
      n++;
    }
    for (let k = n; k < VF_LIMITS.scatter; k++) { pos[k].set(0, -1e4, 0, 0.01); col[k].set(0, 0, 0, 2); }
    u.scatCount.value = n;
    const bound = u.smokeBound.array as THREE.Vector4[], tint = u.smokeTint.array as THREE.Vector4[];
    const puff = u.puff.array as THREE.Vector4[], dens = u.puffD.array as number[];
    for (const id of [...this.smokeLayer.keys()]) if (!this.smoke.emitters.some(e => e.id === id)) this.smokeLayer.delete(id);
    let m = 0;
    for (const e of this.smoke.emitters) {
      const b = this.smoke.bound(e);
      if (!b || m >= VF_LIMITS.smoke) continue;
      let layer = this.smokeLayer.get(e.id);
      if (layer === undefined) {
        const used = new Set(this.smokeLayer.values());
        for (let l = SMOKE_LIMITS.scatterLights; l < VIS_WINDOWS; l++) if (!used.has(l)) { layer = l; break; }
        layer ??= SMOKE_LIMITS.scatterLights + m;
        this.smokeLayer.set(e.id, layer);
      }
      if (this.densityMap) this.refreshWindow(layer, e, e.x, e.y, e.z, time);
      bound[m].set(b[0], b[1], b[2], b[3]);
      const np = Math.min(e.puffs.length, VF_LIMITS.puffsPer);
      tint[m].set(e.tint[0], e.tint[1], e.tint[2], np);
      for (let j = 0; j < VF_LIMITS.puffsPer; j++) {
        const i = m * VF_LIMITS.puffsPer + j, q = e.puffs[j];
        if (j < np && q) { puff[i].set(q.x, q.y, q.z, q.r); dens[i] = q.d; } else { puff[i].set(0, -1e4, 0, 0.01); dens[i] = 0; }
      }
      setWin(VF_LIMITS.scatter + m, layer);
      m++;
    }
    for (let k = m; k < VF_LIMITS.smoke; k++) { bound[k].set(0, -1e4, 0, 0); tint[k].set(0, 0, 0, 0); }
    u.smokeCount.value = m;
  }

  // --- frame ---------------------------------------------------------------------------------------------------------

  /**
   * Render the station scene to the canvas (with or without atmosphere). CORE composites the viewmodel overlay afterwards.
   * `time` = game time (frozen in menus: the haze stops too); the fog clock starts at the station's first frame.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    const r = this.renderer;
    this.gameTime = time;
    if (this.densityMap && this.epoch === null) this.epoch = time;
    if (!r) return;
    this.attach();
    const fl = this.lights.flashlight;
    // No shadow pass while the flashlight is dark (the map is unused then; the march's beam term is zero).
    if (fl.castShadow) fl.shadow.autoUpdate = fl.intensity > 0 && fl.visible;
    if (fl.castShadow && !fl.shadow.map) fl.shadow.needsUpdate = true;
    if (!this.active) { this.syncSmoke(this.fogTime(time)); this.direct(scene, camera); return; }
    const t0 = performance.now();
    this.ensureTargets();
    this.ensurePipeline(scene, camera);
    this.sync(scene, camera, time);
    r.setRenderTarget(null); // the finished frame goes to the canvas (the pipeline's quad draws into the current target)
    this.pipeline!.render();
    if (this.failed) { this.direct(scene, camera); this.dropTargets(); return; }
    camera.updateMatrixWorld();
    this.prevView.copy(camera.matrixWorldInverse);
    this.prevProj.copy(camera.projectionMatrix);
    this.prevCamPos.setFromMatrixPosition(camera.matrixWorld);
    this.frame++;
    this.cpuMs += ((performance.now() - t0) - this.cpuMs) * 0.1;
  }

  /**
   * Iteration 14 (primary, render/warmup.ts): the render target the station is drawn into on the next frame — the
   * scene pass's own target (its pipeline built now, exactly as the first frame would) — or null when the frame
   * renders directly (off / unsupported / failed: three's framebuffer target). three keys node builds and pipelines
   * by that render context, so the warm-up compiles into it.
   */
  warmTarget(scene: THREE.Scene, camera: THREE.PerspectiveCamera): unknown {
    if (!this.renderer) return null;
    this.attach();
    if (!this.active) return null;
    this.ensureTargets();
    this.ensurePipeline(scene, camera);
    return (this.scenePass as unknown as {renderTarget: unknown}).renderTarget;
  }

  /** Iteration 14: forget the temporal history (the warm-up's hidden frames drew other geometry at this pose). */
  resetHistory(): void {
    this.historyValid = false;
  }

  private direct(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer!;
    r.setRenderTarget(null);
    this.withGasFog(scene, () => r.render(scene, camera)); // task reactor-expansion-20261101 (lane GASLIGHT): the in-engine gas fallback
    this.historyValid = false;
  }

  /**
   * Task reactor-expansion-20261101 (lane GASLIGHT): run a DIRECT draw (no volumetric pass: off / unsupported / failed / Game's bypass)
   * with the scene's FogExp2 tinted / thickened by the eye's gas (setGasFallback), restored right after — the gas stays visible as
   * in-engine fog on every material. No gas at the eye: the draw as is.
   */
  withGasFog(scene: THREE.Scene, draw: () => void): void {
    const fog = scene.fog as THREE.FogExp2 | null, gc = this.gasFallbackC;
    const borrow = gc > 0.005 && !!fog && fog.isFogExp2;
    if (borrow) this.borrowFog(fog!, gc);
    try {
      draw();
    } finally {
      if (borrow) { fog!.color.copy(this.fogKeep.color); fog!.density = this.fogKeep.density; }
    }
  }

  /** Task reactor-expansion-20261101 (lane GASLIGHT): FogExp2 tinted / thickened by the eye's gas (kept values restored after the draw). */
  private borrowFog(fog: THREE.FogExp2, c: number): void {
    this.fogKeep.color.copy(fog.color);
    this.fogKeep.density = fog.density;
    const f = fallbackFog(c, {color: [fog.color.r, fog.color.g, fog.color.b], density: fog.density});
    fog.color.setRGB(f.color[0], f.color[1], f.color[2]);
    fog.density = f.density;
    this.gasFallbackFrames++;
  }

  /** Low-res march / history targets (MRT: in-scatter + view depth, transmittance). */
  private ensureTargets(): void {
    const [lw, lh] = this.low;
    const make = (name: string, filter: THREE.MagnificationTextureFilter) => {
      const rt = new RenderTarget(lw, lh, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false,
        minFilter: filter, magFilter: filter, generateMipmaps: false, count: 2,
      });
      rt.textures[0].name = name;
      rt.textures[1].name = `${name}-transmittance`;
      return rt;
    };
    this.marchRT ??= make('volumetric-march', THREE.NearestFilter);
    if (this.preset?.temporal && !this.history) {
      this.history = [make('volumetric-history-a', THREE.LinearFilter), make('volumetric-history-b', THREE.LinearFilter)];
      this.historyValid = false;
      this.temporalMat?.dispose();
      this.temporalMat = null;
    }
  }

  /** The RenderPipeline for this scene + camera (scene pass -> fog pass -> composite + output transform). */
  private ensurePipeline(scene: THREE.Scene, camera: THREE.Camera): void {
    const msaa = this.preset?.msaa ?? 0;
    const key = `${msaa}|${this.history ? 't' : 'n'}`;
    if (this.pipeline && this.pipeScene === scene && this.pipeCamera === camera && this.pipeKey === key) return;
    this.disposePipeline();
    const r = this.renderer!;
    const scenePass = pass(scene, camera, {samples: msaa}) as unknown as PassNode;
    const color = (scenePass as unknown as {getTextureNode(n: string): unknown}).getTextureNode('output');
    const depth = (scenePass as unknown as {getTextureNode(n: string): unknown}).getTextureNode('depth');
    const src = this.history ? this.history[0] : this.marchRT!;
    this.fogNode = new FogPassNode(this, scenePass, src.textures[0], src.textures[1]);
    const out = createCompositeNode(this.u, color, depth, this.fogNode.tex0, this.fogNode.tex1);
    this.pipeline = new RenderPipeline(r, out as never);
    this.pipeline.outputColorTransform = true; // ACES (renderer.toneMappingExposure) + sRGB once, after the fog
    this.scenePass = scenePass;
    this.pipeScene = scene;
    this.pipeCamera = camera;
    this.pipeKey = key;
    this.marchKey = '';
  }

  /** The march material for the current inputs (steps, scene depth, maps, the flashlight's shadow map). */
  private ensureMarch(): NodeMaterial {
    const fl = this.lights.flashlight;
    const shadowTex = fl.castShadow ? (fl.shadow.map as unknown as {depthTexture?: THREE.Texture} | null)?.depthTexture ?? null : null;
    const depthTex = (this.scenePass as unknown as {getTexture(n: string): THREE.Texture}).getTexture('depth');
    const steps = this.preset?.steps ?? 24;
    // task reactor-build-20261101 (lane AIR): + the depth gas variant (a reactor layout only; every other key is unchanged)
    const key = `${steps}|${depthTex.id}|${shadowTex?.id ?? 'none'}|${this.densityTex.id}|${this.airTex.id}|${this.gasTex.id}${this.depthCompiled ? '|depth' : ''}`;
    if (this.marchMat && key === this.marchKey) return this.marchMat;
    this.marchMat?.dispose();
    this.marchMat = createMarchMaterial(this.u, {depth: depthTex, noise: this.noise, density: this.densityTex, air: this.airTex, vis: this.visTex, shadow: shadowTex, gas: this.gasTex}, this.depthCompiled ? {steps, depth: true} : {steps});
    this.marchKey = key;
    this.marchBuilds++;
    this.errorChecks = 3; // watch the next frames for WebGPU validation / compilation errors of the new program
    return this.marchMat;
  }

  /** Fog pass body (FogPassNode.updateBefore): march + temporal into the low-res targets, after this frame's scene pass. */
  runFog(renderer: WebGPURenderer): void {
    if (!this.marchRT || this.failed) return;
    rendererState = RendererUtils.resetRendererState(renderer, rendererState as never);
    const device = (renderer.backend as unknown as {device?: WebGPUDeviceLike}).device;
    let scoped = false;
    try {
      const fl = this.lights.flashlight;
      // the shadow matrix / map of THIS frame (three updated them in the scene pass)
      const u = this.u;
      u.shadowMatrix.value.copy(fl.shadow.matrix);
      u.shadowBias.value = fl.shadow.bias;
      const march = this.ensureMarch();
      // task reactor-submit-roof-fog-20261102 (lane FOG): open the error scope AFTER picking / (re)building the program, so a new program's
      // FIRST frame is watched too — three creates the pipeline layout there outside its own error scope (a rejected layout, like the
      // 13-uniform-buffer depth variant, now flags the pass failed -> the direct path at once, instead of depending on frame timing)
      scoped = !!device && this.errorChecks > 0;
      if (scoped) device!.pushErrorScope('validation');
      u.shadowOn.value = fl.castShadow && fl.shadow.map && (u.flashColor.value as THREE.Vector3).lengthSq() > 0 ? 1 : 0;
      renderer.setRenderTarget(this.marchRT);
      this.quad.material = march;
      this.quad.render(renderer);
      let out: RenderTarget = this.marchRT;
      if (this.history) {
        const dst = this.history[this.histIndex], src = this.history[1 - this.histIndex];
        this.temporalMat ??= createTemporalMaterial(u, this.marchRT.textures[0], this.marchRT.textures[1], this.hist0, this.hist1);
        this.hist0.value = src.textures[0];
        this.hist1.value = src.textures[1];
        u.historyValid.value = this.historyValid ? 1 : 0;
        renderer.setRenderTarget(dst);
        this.quad.material = this.temporalMat;
        this.quad.render(renderer);
        out = dst;
        this.histIndex = 1 - this.histIndex;
        this.historyValid = true;
      }
      if (this.fogNode) {
        (this.fogNode.tex0 as unknown as {value: THREE.Texture}).value = out.textures[0];
        (this.fogNode.tex1 as unknown as {value: THREE.Texture}).value = out.textures[1];
      }
      this.fogRuns++;
    } finally {
      RendererUtils.restoreRendererState(renderer, rendererState as never);
      if (scoped) {
        this.errorChecks--;
        device!.popErrorScope().then(err => {
          if (err && !this.failed) {
            this.failed = `volumetric fog pass rejected by WebGPU: ${err.message.slice(0, 300)}`;
            console.error(this.failed);
          }
        }).catch(() => {});
      }
    }
  }

  /** Release the GPU targets and pipeline (recreated on demand). */
  private dropTargets(): void {
    this.disposePipeline();
    this.marchRT?.dispose();
    for (const h of this.history ?? []) h.dispose();
    this.marchRT = null;
    this.history = null;
    this.historyValid = false;
    this.temporalMat?.dispose();
    this.temporalMat = null;
    this.marchMat?.dispose();
    this.marchMat = null;
    this.marchKey = '';
  }

  private disposePipeline(): void {
    this.pipeline?.dispose();
    (this.scenePass as unknown as {dispose?(): void} | null)?.dispose?.();
    (this.fogNode as unknown as {dispose?(): void} | null)?.dispose?.();
    this.pipeline = null;
    this.scenePass = null;
    this.fogNode = null;
    this.pipeScene = this.pipeCamera = null;
    this.pipeKey = '';
  }

  /** Per-frame uniform sync (no scene changes; also used by tests without a GPU). Nothing here reads visited areas. */
  sync(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    const p = this.params, u = this.u;
    this.gameTime = time;
    if (this.densityMap && this.epoch === null) this.epoch = time;
    const ft = this.fogTime(time);
    camera.updateMatrixWorld();
    if (this.renderer) {
      const db = this.renderer.getDrawingBufferSize(this.size);
      if (db.x > 0 && db.y > 0 && (db.x !== this.full[0] || db.y !== this.full[1])) this.setSize(db.x, db.y);
    }
    u.fullSize.value.set(this.full[0], this.full[1]);
    u.lowSize.value.set(this.low[0], this.low[1]);
    if (this.marchRT && (this.marchRT.width !== this.low[0] || this.marchRT.height !== this.low[1])) {
      this.marchRT.setSize(this.low[0], this.low[1]);
      for (const h2 of this.history ?? []) h2.setSize(this.low[0], this.low[1]);
      this.historyValid = false;
    }
    u.projInv.value.copy(camera.projectionMatrixInverse);
    u.camWorld.value.copy(camera.matrixWorld);
    (u.camPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    u.near.value = camera.near;
    u.far.value = camera.far;
    u.maxDist.value = Math.min(p.maxDistance, camera.far);
    u.frame.value = this.frame % 1024;
    const fog = scene.fog as THREE.FogExp2 | null;
    u.fogDensity.value = fog && fog.isFogExp2 ? fog.density : 0;
    u.nearFade.value.set(p.nearFade[0], p.nearFade[1]);
    // the medium: base, height profile, patch / wisp scales, the moving field offsets at the fog clock, coverage
    u.density.value = p.density;
    u.heightFalloff.value = p.heightFalloff;
    u.refHeight.value = p.refHeight;
    u.noiseAmount.value = p.noiseAmount;
    const s = noiseScales(p);
    u.scaleP.value.set(...s.patch);
    u.scaleD.value.set(...s.detail);
    if (this.motion) {
      const o = fieldOffsets(this.motion, p, ft);
      u.offAir.value.set(...o.air);
      u.offTrack.value.set(...o.track);
      u.offDet.value.set(...o.detail);
    }
    u.cover.value.set(p.coverage, p.coverageSlope, p.coverageSoftness, p.clear);
    u.peak.value = p.peak;
    u.pocketDense.value = p.pocketDense;
    u.detail.value = p.detail;
    u.ground.value.set(p.ground, p.groundHeight, p.groundVariation);
    // (task reactor-surface-redesign-credits-20261103) the Reactor's outdoor haze cap (read by reactor-variant programs only)
    if (p.skyCap) u.skyCap.value.set(p.skyCap.y0, Math.max(p.skyCap.y1, p.skyCap.y0 + 0.01), 0, 1); else u.skyCap.value.set(0, 1, 0, 0);
    u.warp.value = p.warp;
    u.ext.value.set(p.patchExtinction, p.smokeExtinction, p.smokeScatter);
    u.phase.value.set(p.anisotropy, p.backAnisotropy, p.backScatter);
    const m = this.densityMap;
    if (m) {
      u.mapXform.value.set(0, 0, 1 / (m.w * m.cell), 1 / (m.h * m.cell));
      u.mapFloor.value.set(m.yMin, m.yRange);
      u.mapSlots.value = m.slots;
      (u.mapFloors.array as THREE.Vector4[]).forEach((v, s) => { const [y0, yr] = densityLayerRange(m, Math.min(s, m.slots - 1)); v.set(y0, yr, 0, 0); });
    }
    // Flashlight (camera-held spot; same cone / attenuation as its surface lighting; battery flicker / off via intensity).
    const fl = this.lights.flashlight;
    fl.updateWorldMatrix(true, false);
    fl.target.updateWorldMatrix(true, false);
    fl.getWorldPosition(u.flashPos.value);
    u.flashDir.value.copy(fl.target.getWorldPosition(this.tmp)).sub(u.flashPos.value).normalize();
    u.flashCone.value.set(Math.cos(fl.angle), Math.cos(fl.angle * (1 - fl.penumbra)));
    const fk = fl.visible && fl.intensity > 0 ? fl.intensity * p.flashlightScatter : 0;
    u.flashColor.value.set(fl.color.r * fk, fl.color.g * fk, fl.color.b * fk);
    u.flashRange.value.set(fl.distance, fl.decay);
    u.shadowMatrix.value.copy(fl.shadow.matrix);
    u.shadowBias.value = fl.shadow.bias;
    u.shadowOn.value = fl.castShadow && fl.shadow.map && fk > 0 ? 1 : 0;
    // Baked fixture field (world/lightFieldNode.ts global nodes, bound by StationLighting): our gain only.
    u.fieldGain.value = this.field ? p.fixtureScatter : 0;
    // Muzzle flash pulse.
    const mz = this.lights.muzzle;
    const mk = mz && mz.visible && mz.intensity > 0 ? mz.intensity * p.muzzleScatter : 0;
    if (mz && mk > 0) {
      mz.getWorldPosition(u.muzzlePos.value);
      u.muzzleRange.value.set(mz.distance, mz.decay);
    }
    u.muzzleColor.value.set(mz ? mz.color.r * mk : 0, mz ? mz.color.g * mk : 0, mz ? mz.color.b * mk : 0);
    // smoke puffs + scatter lights + their occlusion windows (fog clock: frozen in menus)
    this.syncSmoke(ft);
    this.syncGas(); // task gasmask-breach-20261030

    // temporal: camera cuts (teleport / respawn) drop the history
    const camPos = u.camPos.value as THREE.Vector3;
    if (this.historyValid && camPos.distanceTo(this.prevCamPos) > 3) this.historyValid = false;
    u.prevView.value.copy(this.prevView);
    u.prevProj.value.copy(this.prevProj);
    u.historyValid.value = this.historyValid ? 1 : 0;
    u.intensity.value = p.intensity;
  }

  /** Medium statistics of the current station (lazy, cached; deterministic). */
  private densityStats(): AtmosphereDebug['density'] {
    if (this.statsCache || !this.layout || !this.densityMap) return this.statsCache;
    const s = mediumStats(this.layout, this.maps(), this.params, 0, 13);
    const areas: Record<AreaClass, number> = {clear: 0, normal: 0, dense: 0};
    for (const a of this.densityMap.areas ?? []) areas[a.cls]++;
    const r = (v: number) => Math.round(v * 1e5) / 1e5;
    this.statsCache = {
      base: this.params.density, mean: r(s.mean), clearFrac: Math.round(s.clearFrac * 1000) / 1000, denseFrac: Math.round(s.denseFrac * 1000) / 1000,
      byClass: Object.fromEntries(Object.entries(s.byClass).map(([k, v]) => [k, r(v)])) as Record<AreaClass | 'track', number>, areas,
    };
    return this.statsCache;
  }

  debug(): AtmosphereDebug {
    const fl = this.lights.flashlight, p = this.preset;
    const {areaDensity: _ad, classOdds: _co, ...params} = this.params;
    void _ad; void _co;
    const mo = this.motion;
    const sp = (v: number[]) => Math.round(Math.hypot(v[0], v[1], v[2]) * 1000) / 1000;
    const r3 = (v: number[]) => v.map(x => Math.round(x * 1000) / 1000);
    return {
      backend: this.backend,
      requested: this.requested, quality: this.quality, enabled: this.enabled, active: this.active, supported: this.supported,
      reason: this.reason, failed: this.failed,
      resolution: {full: [this.full[0], this.full[1]], march: [this.low[0], this.low[1]], scale: p ? Math.round(this.low[0] / this.full[0] * 1000) / 1000 : 0},
      steps: p?.steps ?? 0, temporal: !!p?.temporal, msaa: p?.msaa ?? 0,
      shadow: {
        enabled: fl.castShadow, mapSize: fl.shadow.mapSize.x, bias: fl.shadow.bias, normalBias: fl.shadow.normalBias, near: fl.shadow.camera.near,
        updating: fl.castShadow && fl.shadow.autoUpdate, casters: this.casters, receivers: this.receivers, sampled: this.marchKey.includes('|none|') === false && !!this.marchMat,
      },
      station: {bound: !!this.densityMap, densityMap: this.densityMap ? [this.densityMap.w, this.densityMap.h] : null, field: !!this.field, airMap: !!this.airMap, draft: mo?.draft ?? 0, seed: this.layout?.seed ?? null},
      time: {fog: Math.round(this.fogTime() * 1000) / 1000, game: Math.round(this.gameTime * 1000) / 1000, epoch: this.epoch},
      motion: mo ? {air: r3(mo.air), track: r3(mo.track), detail: r3(mo.detail), speeds: {air: sp(mo.air), track: sp(mo.track), detail: sp(mo.detail)}} : null,
      density: this.densityStats(),
      params,
      smoke: {
        emitters: this.smoke.emitters.length, puffs: this.smoke.puffCount, limits: SMOKE_LIMITS, stats: {...this.smoke.stats},
        list: this.smoke.emitters.map(e => ({id: e.id, emitting: e.emitting, puffs: e.puffs.length, x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, z: Math.round(e.z * 100) / 100})),
      },
      scatter: {lights: this.scatter.list.length, active: this.u.scatCount.value as number, windows: this.winState.filter(w => w.ok).length},
      ms: {gpu: null, cpu: Math.round(this.cpuMs * 100) / 100, cpuScene: Math.round(this.cpuSceneMs * 100) / 100},
      frames: this.frame,
      passes: {fog: this.fogRuns, marchBuilds: this.marchBuilds},
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dropTargets();
    if (this.densityTex !== this.placeholderDensity) this.densityTex.dispose();
    if (this.airTex !== this.placeholderAir) this.airTex.dispose();
    if (this.gasTex !== this.placeholderGas) this.gasTex.dispose();
    this.placeholderDensity.dispose();
    this.placeholderAir.dispose();
    this.placeholderGas.dispose();
    this.depthTableTex.dispose(); // (lane FOG)
    this.gasData = null;
    this.densityMap = null;
    this.noise.dispose();
    this.visTex.dispose();
    this.clearSmoke();
    this.scatter.clear();
    this.lightLayer.clear();
    if (this.renderer) {
      const dbg = this.renderer.debug as unknown as {onShaderError: ((...a: unknown[]) => void) | null};
      if (dbg.onShaderError === this.onShaderError) dbg.onShaderError = this.prevShaderError;
    }
    this.field = null;
  }
}
