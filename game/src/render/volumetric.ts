// Iteration 06 (Lane F): depth-aware volumetric atmosphere (light haze, strongest in the flashlight).
//
// Frame (quality low/high, see ATMOSPHERE_QUALITY):
//   1. the station scene renders into `sceneRT` (MSAA like the canvas, + a depth texture). The target
//      is flagged like three's own WebXR targets (isXRRenderTarget) so every material tone-maps and
//      sRGB-encodes exactly as it does on the canvas (same programs, identical r5 pixels);
//      three renders the flashlight's spot shadow map during this pass;
//   2. raymarch at 1/2 (high) or 1/4 (low) resolution, capped pixel budget, 24 / 14 jittered steps:
//      reconstruct each pixel's surface from depth and integrate single in-scattering in FRONT of it
//      only - flashlight cone (shadow-mapped), baked fixture light field, muzzle pulse, iteration 12: scatter lights
//      (thrown flares) - over a medium with per-area / height / flow-advected patch-noise density + ground layer and the
//      smoke puffs (render/atmosphere.ts, render/smoke.ts). Iteration 12: two outputs (MRT) - in-scatter + view depth,
//      and the transmittance of the dense patches / smoke in front of the surface;
//   3. temporal accumulation (reprojected, neighbourhood-clamped, depth-rejected) at march resolution, both targets;
//   4. full-resolution composite onto the canvas: bilateral (depth-aware) upsample, scene x transmittance + in-scatter
//      in scene-linear space under three's ACES curve. game.ts then clears depth and draws the
//      viewmodel overlay on top, so the gun and the DOM HUD are never fogged.
// Quality 'off' (or unsupported float render targets, or a shader error) renders straight to the
// canvas as in r5, without the flashlight shadow map. The pass adds no lights and no objects to the
// station scene; its fullscreen triangle lives in a private scene.
//
// Iteration 12 (ATMOS) API for the light lane (design.md): addSmokeEmitter / clearSmoke, addScatterLight /
// removeScatterLight. Bounded (render/smoke.ts SMOKE_LIMITS); cleared on setStation (new station / retry) and dispose.

import * as THREE from 'three';
import type {StationLayout} from '../gen/station';
import {SOLID, type Grid} from '../gen/grid';
import type {LightFieldVolume} from '../world/lightField';
import {stationLevels} from '../world/levelGeometry';
import {
  ACES_IN, ACES_IN_INV, ACES_OUT, ACES_OUT_INV, ATMOSPHERE_QUALITY, NOISE_SIZE, SHADOW_NEAR, SHADOW_NORMAL_BIAS,
  atmosphereFor, buildDensityMap, buildFlowMap, buildNoiseVolume, densitySlot, marchSize, sampleFlowMap, shadowBiasFor,
  type AtmosphereParams, type AtmosphereQuality, type DensityMap, type FlowMap, type QualityPreset,
} from './atmosphere';
import {
  SMOKE_LIMITS, ScatterLights, SmokeField, VIS_RES, VIS_WINDOWS, computeVisWindow, windowStale,
  type SmokeEmitterOptions, type SmokeHandle, type VisLookup,
} from './smoke';
import {VF_COMPOSITE, VF_LIMITS, VF_MARCH, VF_MARK, VF_TEMPORAL, VF_VERTEX} from './volumetricShaders';

export interface AtmosphereLights {
  flashlight: THREE.SpotLight;
  muzzle?: THREE.PointLight | null;
}

export interface AtmosphereDebug {
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
  shadow: {enabled: boolean; mapSize: number; bias: number; normalBias: number; near: number; updating: boolean; casters: number; receivers: number};
  station: {bound: boolean; densityMap: [number, number] | null; field: boolean; flowMap: boolean; draft: number};
  params: Omit<AtmosphereParams, 'areaDensity'>;
  /** Iteration 12: smoke emitters / puffs and scatter lights in the march (bounded: SMOKE_LIMITS). */
  smoke: {emitters: number; puffs: number; limits: typeof SMOKE_LIMITS; stats: SmokeField['stats']; list: {id: number; emitting: boolean; puffs: number; x: number; y: number; z: number}[]};
  scatter: {lights: number; active: number; windows: number};
  /** gpu: volumetric passes (timer query, Chrome only); cpu: submission time of the volumetric passes / the scene pass. */
  ms: {gpu: number | null; cpu: number; cpuScene: number};
  frames: number;
}

const mat3 = (rowMajor: readonly number[]) => new THREE.Matrix3().set(...(rowMajor as [number, number, number, number, number, number, number, number, number]));

/** `?fog=off|low|high` session override (QA / slow renderers). */
export function fogOverrideFromUrl(search: string | undefined = (globalThis as {location?: Location}).location?.search): AtmosphereQuality | null {
  const v = search ? new URLSearchParams(search).get('fog') : null;
  return v === 'off' || v === 'low' || v === 'high' ? v : null;
}

/** Flashlight spot shadow for a quality level (off: no shadow map at all, as in r5). */
export function configureFlashlightShadow(light: THREE.SpotLight, q: AtmosphereQuality, renderer: THREE.WebGLRenderer | null): void {
  const on = q !== 'off';
  if (renderer) {
    renderer.shadowMap.enabled = on;
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
 */
export function markShadows(root: THREE.Object3D, receive: boolean, structure: boolean): {casters: number; receivers: number} {
  let casters = 0, receivers = 0;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats.length || !mats.every(litOpaque)) return;
    m.castShadow = true;
    m.receiveShadow = receive;
    casters++;
    if (receive) receivers++;
    if (structure) for (const x of mats) if (x.shadowSide === null && x.side === THREE.FrontSide) x.shadowSide = THREE.DoubleSide;
  });
  return {casters, receivers};
}

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** Optional GPU timing of the volumetric passes (EXT_disjoint_timer_query_webgl2; Chrome, not Firefox). */
class GpuTimer {
  private readonly ext: TimerExt | null;
  private query: WebGLQuery | null = null;
  private pending = false;
  ms: number | null = null;
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }
  begin(): boolean {
    if (!this.ext || this.pending) return false;
    this.query ??= this.gl.createQuery();
    if (!this.query) return false;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
    return true;
  }
  end(): void {
    if (!this.ext) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending = true;
  }
  poll(): void {
    if (!this.ext || !this.pending || !this.query) return;
    const gl = this.gl;
    if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) this.ms = Math.round((gl.getQueryParameter(this.query, gl.QUERY_RESULT) as number) / 1e4) / 100;
    this.pending = false;
  }
  dispose(): void {
    if (this.query) this.gl.deleteQuery(this.query);
    this.query = null;
  }
}

type ShaderErrorFn = (gl: WebGLRenderingContext, program: WebGLProgram, vs: WebGLShader, fs: WebGLShader) => void;

export class VolumetricAtmosphere {
  /** Tunables of the current station (atmosphereFor(layout)); may be edited live (QA). */
  params: AtmosphereParams = atmosphereFor(null);
  /** Volumetric pass on/off (QA before/after); the flashlight shadow follows the quality only. */
  enabled = true;
  /** Session override (?fog=, QA) that wins over the settings quality. */
  override: AtmosphereQuality | null = fogOverrideFromUrl();
  failed: string | null = null;
  readonly supported: boolean;
  readonly reason: string | null;
  requested: AtmosphereQuality;
  quality: AtmosphereQuality = 'off';
  densityMap: DensityMap | null = null;
  /** Iteration 12: per-storey drift map of the current station (render/atmosphere.ts buildFlowMap). */
  flowMap: FlowMap | null = null;
  readonly noise: THREE.Data3DTexture;
  readonly march: THREE.ShaderMaterial;
  readonly temporal: THREE.ShaderMaterial;
  readonly composite: THREE.ShaderMaterial;
  /** Iteration 12: smoke puffs and scatter lights (render/smoke.ts); use the methods below. */
  readonly smoke = new SmokeField();
  readonly scatter = new ScatterLights();
  private full: [number, number] = [1, 1];
  private low: [number, number] = [1, 1];
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private marchRT: THREE.WebGLRenderTarget | null = null;
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private histIndex = 0;
  private historyValid = false;
  private densityTex: THREE.DataArrayTexture | null = null;
  private flowTex: THREE.DataArrayTexture | null = null;
  private readonly visData = new Uint8Array(VIS_RES * VIS_RES * VIS_WINDOWS);
  readonly visTex: THREE.DataArrayTexture;
  /** Window layer of each scatter light / smoke emitter id (layers 0..3 lights, 4..7 emitters). */
  private readonly lightLayer = new Map<THREE.PointLight, number>();
  private readonly smokeLayer = new Map<number, number>();
  private readonly winState: {x0: number; z0: number; floor: number; ceil: number; ok: boolean}[] = Array.from({length: VIS_WINDOWS}, () => ({x0: 0, z0: 0, floor: -1e3, ceil: 1e3, ok: false}));
  private levelGrids: Grid[] = [];
  private lastTime = Number.NaN;
  private field: LightFieldVolume | null = null;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private frame = 0;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly timer: GpuTimer | null;
  private cpuMs = 0;
  private cpuSceneMs = 0;
  private casters = 0;
  private receivers = 0;
  private readonly prevShaderError: ShaderErrorFn | null = null;
  private readonly onShaderError: ShaderErrorFn | null = null;
  private disposed = false;
  private configured = false;

  constructor(private readonly renderer: THREE.WebGLRenderer | null, private readonly lights: AtmosphereLights, quality: AtmosphereQuality = 'high') {
    let supported = true, reason: string | null = null;
    if (renderer) {
      if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
        supported = false;
        reason = 'no float colour render targets (EXT_color_buffer_float / _half_float)';
      }
    }
    this.supported = supported;
    this.reason = reason;
    this.requested = quality;

    // Iteration 12: two-channel (RG8) noise tile: patch field + wisps (render/atmosphere.ts buildNoiseVolume).
    const noise = new THREE.Data3DTexture(buildNoiseVolume(), NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
    noise.format = THREE.RGFormat;
    noise.type = THREE.UnsignedByteType;
    noise.minFilter = noise.magFilter = THREE.LinearFilter;
    noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
    noise.generateMipmaps = false;
    noise.unpackAlignment = 1;
    noise.colorSpace = THREE.NoColorSpace;
    noise.needsUpdate = true;
    this.noise = noise;
    // Iteration 12: occlusion windows of the scatter lights / smoke emitters (R8 layers, render/smoke.ts).
    const vis = new THREE.DataArrayTexture(this.visData, VIS_RES, VIS_RES, VIS_WINDOWS);
    vis.format = THREE.RedFormat;
    vis.type = THREE.UnsignedByteType;
    vis.minFilter = vis.magFilter = THREE.LinearFilter;
    vis.wrapS = vis.wrapT = THREE.ClampToEdgeWrapping;
    vis.generateMipmaps = false;
    vis.unpackAlignment = 1;
    vis.colorSpace = THREE.NoColorSpace;
    vis.needsUpdate = true;
    this.visTex = vis;

    const V2 = () => new THREE.Vector2(1, 1), V3 = () => new THREE.Vector3(), V4 = () => new THREE.Vector4(), M4 = () => new THREE.Matrix4();
    const arr = (n: number) => Array.from({length: n}, V4);
    const pass = (name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, number> = {}, mrt = false) => new THREE.ShaderMaterial({
      name, vertexShader: VF_VERTEX, fragmentShader, uniforms, defines,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      ...(mrt ? {glslVersion: THREE.GLSL3} : {}),
    });
    this.march = pass('volumetric-march', VF_MARCH, {
      tDepth: {value: null}, uFullSize: {value: V2()}, uLowSize: {value: V2()}, uProjInv: {value: M4()}, uCamWorld: {value: M4()},
      uCamPos: {value: V3()}, uNear: {value: 0.05}, uFar: {value: 70}, uMaxDist: {value: 36}, uFrame: {value: 0}, uTime: {value: 0},
      uFogDensity: {value: 0}, uNearFade: {value: V2()}, uDensity: {value: 0}, uHeightFalloff: {value: 0}, uRefHeight: {value: 1.6},
      uNoiseScale: {value: V3()}, uNoiseAmount: {value: 0}, uWind: {value: V3()}, uCover: {value: V4()}, uGround: {value: V4()}, uFlow: {value: new THREE.Vector2(14, 0)},
      uExt: {value: V3()}, tNoise: {value: noise}, tDensityMap: {value: null}, tFlowMap: {value: null}, uMapSlots: {value: 1},
      uMapXform: {value: new THREE.Vector4(0, 0, 1, 1)}, uMapFloor: {value: new THREE.Vector2(0, 1)}, uPhase: {value: V3()},
      uFlashPos: {value: V3()}, uFlashDir: {value: new THREE.Vector3(0, 0, -1)}, uFlashCone: {value: new THREE.Vector2(1, 1)}, uFlashColor: {value: V3()},
      uFlashRange: {value: new THREE.Vector2(30, 1.2)}, tShadow: {value: null}, uShadowMatrix: {value: M4()}, uShadowBias: {value: 0}, uShadowOn: {value: 0},
      tField: {value: null}, uFieldMin: {value: V3()}, uFieldMax: {value: new THREE.Vector3(1, 1, 1)}, uFieldLevels: {value: new THREE.Vector3(1, 1, 1)}, uFieldGain: {value: 0},
      uMuzzlePos: {value: V3()}, uMuzzleColor: {value: V3()}, uMuzzleRange: {value: new THREE.Vector2(8, 2)},
      tVis: {value: vis}, uWin: {value: arr(VF_LIMITS.windows)}, uWinY: {value: arr(VF_LIMITS.windows)},
      uScatCount: {value: 0}, uScatPos: {value: arr(VF_LIMITS.scatter)}, uScatCol: {value: arr(VF_LIMITS.scatter)},
      uSmokeCount: {value: 0}, uSmokeBound: {value: arr(VF_LIMITS.smoke)}, uSmokeTint: {value: arr(VF_LIMITS.smoke)},
      uPuff: {value: arr(VF_LIMITS.puffs)}, uPuffD: {value: arr(VF_LIMITS.puffs / 4)},
    }, {VF_STEPS: 24}, true);
    this.temporal = pass('volumetric-temporal', VF_TEMPORAL, {
      tCurrent: {value: null}, tCurrentT: {value: null}, tHistory: {value: null}, tHistoryT: {value: null}, uLowSize: {value: V2()}, uProjInv: {value: M4()}, uCamWorld: {value: M4()},
      uPrevViewProj: {value: M4()}, uHistoryValid: {value: 0}, uBlend: {value: 0.85},
    }, {}, true);
    this.composite = pass('volumetric-composite', VF_COMPOSITE, {
      tScene: {value: null}, tDepth: {value: null}, tFog: {value: null}, tFogT: {value: null}, uFullSize: {value: V2()}, uLowSize: {value: V2()},
      uNear: {value: 0.05}, uFar: {value: 70}, uExposure: {value: 1}, uIntensity: {value: 1},
      uAcesIn: {value: mat3(ACES_IN)}, uAcesOut: {value: mat3(ACES_OUT)}, uAcesInInv: {value: mat3(ACES_IN_INV)}, uAcesOutInv: {value: mat3(ACES_OUT_INV)},
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo, this.march);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.timer = renderer ? new GpuTimer(renderer.getContext() as WebGL2RenderingContext) : null;
    if (renderer) {
      // A failing volumetric program must never leave the canvas black: flag it and fall back to the
      // direct path within the same frame (three calls this synchronously on the program's first use).
      const dbg = renderer.debug as {onShaderError: ShaderErrorFn | null};
      this.prevShaderError = dbg.onShaderError;
      const prev = this.prevShaderError;
      this.onShaderError = (gl, program, vs, fs) => {
        if ((gl.getShaderSource(fs) ?? '').includes(VF_MARK) || (gl.getShaderSource(vs) ?? '').includes(VF_MARK)) {
          this.failed = 'volumetric shader failed to compile/link; rendering without atmosphere';
        }
        if (prev) { prev(gl, program, vs, fs); return; }
        console.error('THREE.WebGLProgram: shader error', gl.getProgramInfoLog(program), '\nvertex:', gl.getShaderInfoLog(vs), '\nfragment:', gl.getShaderInfoLog(fs));
      };
      dbg.onShaderError = this.onShaderError;
    }
    this.setQuality(quality);
  }

  /** Preset of the current (non-off) quality. */
  get preset(): QualityPreset | null {
    return this.quality === 'off' ? null : ATMOSPHERE_QUALITY[this.quality];
  }

  /** The volumetric pass runs this frame (otherwise: direct r5 rendering). */
  get active(): boolean {
    return this.enabled && this.quality !== 'off' && !this.failed && this.supported && !!this.densityTex && !this.disposed;
  }

  /** Settings quality ('low' | 'high') or explicit 'off'; the session override wins. */
  setQuality(requested: AtmosphereQuality): void {
    this.requested = requested;
    const q: AtmosphereQuality = this.supported ? this.override ?? requested : 'off';
    if (q === this.quality && this.configured) return;
    this.configured = true;
    this.quality = q;
    configureFlashlightShadow(this.lights.flashlight, q, this.renderer);
    const p = this.preset;
    if (p && this.march.defines.VF_STEPS !== p.steps) {
      this.march.defines.VF_STEPS = p.steps;
      this.march.needsUpdate = true;
    }
    this.dropTargets(); // recreated lazily with the new MSAA / resolution
    this.setSize(this.full[0], this.full[1]);
  }

  /** Drawing-buffer size (renderer.getDrawingBufferSize). */
  setSize(w: number, h: number): void {
    this.full = [Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))];
    const p = this.preset;
    this.low = p ? marchSize(this.full[0], this.full[1], p) : [1, 1];
    this.sceneRT?.setSize(this.full[0], this.full[1]);
    this.marchRT?.setSize(this.low[0], this.low[1]);
    for (const h2 of this.history ?? []) h2.setSize(this.low[0], this.low[1]);
    this.historyValid = false;
  }

  /** New station: per-level tunables, density + flow maps (areas, floors, drift) and the baked light field. Drops smoke. */
  setStation(layout: StationLayout, field: LightFieldVolume | null): void {
    this.params = atmosphereFor(layout);
    this.densityMap = buildDensityMap(layout, this.params);
    this.flowMap = buildFlowMap(layout);
    this.levelGrids = stationLevels(layout).slice(0, 4).map(L => L.grid);
    this.densityTex?.dispose();
    this.flowTex?.dispose();
    const layerTex = (data: Uint8Array, w: number, h: number, n: number) => {
      const t = new THREE.DataArrayTexture(data, w, h, n);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.unpackAlignment = 1;
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    const m = this.densityMap;
    // Iteration 08: one layer per level slot (RGBA: multiplier, floor, ceiling, presence). Iteration 12: + drift layers.
    this.densityTex = layerTex(m.data, m.w, m.h, m.slots);
    this.flowTex = layerTex(this.flowMap.data, this.flowMap.w, this.flowMap.h, this.flowMap.slots);
    this.field = field;
    this.historyValid = false;
    this.casters = this.receivers = 0;
    // Iteration 12: smoke / scatter lights belong to the previous station (the light lane re-adds its flares' lights).
    this.clearSmoke();
    this.scatter.clear();
    this.lightLayer.clear();
    this.lastTime = Number.NaN;
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

  // --- Iteration 12 (ATMOS): smoke + scatter-light API (design.md; the light lane's thrown flares) -----------------------

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

  /** Storey band (local floor / ceiling) holding (x, y, z) from the density map, or null outside it. */
  bandAt(x: number, y: number, z: number): {floor: number; ceil: number; slot: number} | null {
    const m = this.densityMap;
    if (!m) return null;
    const cx = Math.floor(x / m.cell), cy = Math.floor(z / m.cell);
    if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return null;
    const slot = densitySlot(m, x, z, y);
    const o = ((slot * m.h + cy) * m.w + cx) * 4;
    return {floor: m.yMin + m.data[o + 1] / 255 * m.yRange, ceil: m.yMin + m.data[o + 2] / 255 * m.yRange, slot};
  }

  private openAt(x: number, y: number, z: number): boolean {
    const b = this.bandAt(x, y, z);
    const g = b ? this.levelGrids[b.slot] : null;
    if (!g) return true;
    const [cx, cy] = g.cellOf(x, z);
    return g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] !== SOLID;
  }

  /** Air drift at a point (m/s): the flow map + the station-wide drift (smoke puffs ride it). */
  private driftAt(x: number, y: number, z: number): readonly [number, number, number] {
    const f = this.flowMap, b = this.bandAt(x, y, z);
    const v = f && b ? sampleFlowMap(f, x, z, b.slot) : [0, 0, 0];
    const w = this.params.wind, d = f?.draft ?? 1;
    return [v[0] + w[0] * d, 0, v[1] + w[2]];
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
    const w = computeVisWindow({x, y: y + 0.25, z}, this.visLookup, this.visData.subarray(layer * n, (layer + 1) * n));
    this.winState[layer] = w ? {...w, ok: true} : {x0: 0, z0: 0, floor: -1e3, ceil: 1e3, ok: false};
    this.visTex.addLayerUpdate(layer);
    this.visTex.needsUpdate = true;
  }

  /** Smoke simulation + packing of puffs / scatter lights / windows into the march uniforms (each frame, `time` = game time). */
  private syncSmoke(time: number): void {
    const dt = Number.isFinite(this.lastTime) ? time - this.lastTime : 0;
    this.lastTime = time;
    if (dt > 0) this.smoke.step(dt);
    const u = this.march.uniforms, p = this.params;
    const win = u.uWin.value as THREE.Vector4[], winY = u.uWinY.value as THREE.Vector4[];
    const size = 1 / (VIS_RES * (this.densityMap?.cell ?? 0.5));
    const setWin = (k: number, layer: number) => {
      const w = this.winState[layer];
      if (w.ok) { win[k].set(w.x0, w.z0, size, layer); winY[k].set(w.floor, w.ceil, 0, 0); } else { win[k].set(0, 0, 1, -1); winY[k].set(-1e3, 1e3, 0, 0); }
    };
    // scatter lights
    const pos = u.uScatPos.value as THREE.Vector4[], col = u.uScatCol.value as THREE.Vector4[];
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
      setWin(n, layer);
      n++;
    }
    u.uScatCount.value = n;
    // smoke emitters with puffs
    const bound = u.uSmokeBound.value as THREE.Vector4[], tint = u.uSmokeTint.value as THREE.Vector4[];
    const puff = u.uPuff.value as THREE.Vector4[], dens = u.uPuffD.value as THREE.Vector4[];
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
      tint[m].set(e.tint[0], e.tint[1], e.tint[2], Math.min(e.puffs.length, VF_LIMITS.puffsPer));
      e.puffs.slice(0, VF_LIMITS.puffsPer).forEach((q, j) => {
        const i = m * VF_LIMITS.puffsPer + j;
        puff[i].set(q.x, q.y, q.z, q.r);
        dens[i >> 2].setComponent(i & 3, q.d);
      });
      setWin(VF_LIMITS.scatter + m, layer);
      m++;
    }
    u.uSmokeCount.value = m;
  }

  /**
   * Render the station scene to the canvas (with or without atmosphere). The caller clears depth and
   * draws the viewmodel overlay afterwards. `time` = game time (frozen in menus: the haze stops too).
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    const r = this.renderer;
    if (!r) return;
    const fl = this.lights.flashlight;
    // No shadow pass while the flashlight is off (the map is unused then).
    if (fl.castShadow) fl.shadow.autoUpdate = fl.intensity > 0 && fl.visible;
    // Iteration 12 (ATMOS): ...but the map must EXIST before anything samples it. With the light dark from the first frame
    // (title screen, a flat battery, the torch switched off) three never creates it and binds its never-uploaded placeholder
    // to every shadow sampler: WebGL 2 then rejects those draws (INVALID_OPERATION; measured in Firefox: the station and the
    // march did not draw at all). One forced update creates it; afterwards it simply goes stale while the light is off.
    if (fl.castShadow && !fl.shadow.map) fl.shadow.needsUpdate = true;
    if (!this.active) { this.syncSmoke(time); this.direct(scene, camera); return; }
    const t0 = performance.now();
    this.ensureTargets();
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    const t1 = performance.now();
    this.sync(scene, camera, time);
    const timing = this.timer?.begin() ?? false;
    const marchRT = this.marchRT!, history = this.history;
    this.draw(this.march, marchRT);
    let fog = marchRT.textures[0], fogT = marchRT.textures[1];
    if (history && !this.failed) {
      const dst = history[this.histIndex], src = history[1 - this.histIndex];
      this.temporal.uniforms.tHistory.value = src.textures[0];
      this.temporal.uniforms.tHistoryT.value = src.textures[1];
      this.draw(this.temporal, dst);
      fog = dst.textures[0];
      fogT = dst.textures[1];
      this.histIndex = 1 - this.histIndex;
      this.historyValid = true;
    }
    if (!this.failed) {
      this.composite.uniforms.tFog.value = fog;
      this.composite.uniforms.tFogT.value = fogT;
      this.draw(this.composite, null);
    }
    if (timing) this.timer!.end();
    this.timer?.poll();
    if (this.failed) {
      // One of our programs failed on first use: redo this frame directly, free the targets.
      this.direct(scene, camera);
      this.dropTargets();
      return;
    }
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevCamPos.setFromMatrixPosition(camera.matrixWorld);
    this.frame++;
    const t2 = performance.now();
    // Exponential moving averages (ms) of CPU submission time: scene pass / volumetric passes.
    this.cpuSceneMs += ((t1 - t0) - this.cpuSceneMs) * 0.1;
    this.cpuMs += ((t2 - t1) - this.cpuMs) * 0.1;
  }

  private direct(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer!;
    r.setRenderTarget(null);
    r.clear();
    r.render(scene, camera);
    this.historyValid = false;
  }

  private draw(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    const r = this.renderer!;
    this.quad.material = mat;
    r.setRenderTarget(target);
    r.render(this.quadScene, this.quadCam);
  }

  private ensureTargets(): void {
    const p = this.preset!;
    const [w, h] = this.full, [lw, lh] = this.low;
    if (!this.sceneRT) {
      const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      depth.format = THREE.DepthFormat;
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace, internalFormat: 'RGBA8',
        depthBuffer: true, stencilBuffer: false, depthTexture: depth, samples: p.msaa,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      });
      // Render like the canvas: three applies tone mapping + the target's (sRGB) output encoding in
      // every material for XR-flagged targets (the flag three's WebXRManager sets on its own plain
      // WebGLRenderTarget). Storage is plain RGBA8, so the encoded values are stored and read raw.
      (rt as THREE.WebGLRenderTarget & {isXRRenderTarget: boolean}).isXRRenderTarget = true;
      rt.texture.name = 'volumetric-scene';
      this.sceneRT = rt;
    }
    // Iteration 12: two colour attachments (in-scatter + depth, transmittance).
    const lowTarget = (name: string, filter: THREE.MagnificationTextureFilter) => {
      const rt = new THREE.WebGLRenderTarget(lw, lh, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false,
        minFilter: filter, magFilter: filter, generateMipmaps: false, count: 2,
      });
      rt.textures[0].name = name;
      rt.textures[1].name = `${name}-transmittance`;
      return rt;
    };
    this.marchRT ??= lowTarget('volumetric-march', THREE.NearestFilter);
    if (p.temporal && !this.history) {
      this.history = [lowTarget('volumetric-history-a', THREE.LinearFilter), lowTarget('volumetric-history-b', THREE.LinearFilter)];
      this.historyValid = false;
    }
  }

  /** Release the GPU targets (they are recreated on demand). */
  private dropTargets(): void {
    if (this.sceneRT) { this.sceneRT.depthTexture?.dispose(); this.sceneRT.dispose(); }
    this.marchRT?.dispose();
    for (const h of this.history ?? []) h.dispose();
    this.sceneRT = this.marchRT = null;
    this.history = null;
    this.historyValid = false;
  }

  /** Per-frame uniform sync (no scene changes; also used by tests without a GL context). */
  sync(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    const p = this.params, u = this.march.uniforms, [w, h] = this.full, [lw, lh] = this.low;
    camera.updateMatrixWorld();
    u.tDepth.value = this.sceneRT?.depthTexture ?? null;
    u.uFullSize.value.set(w, h);
    u.uLowSize.value.set(lw, lh);
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uMaxDist.value = Math.min(p.maxDistance, camera.far);
    u.uFrame.value = this.frame % 1024;
    u.uTime.value = time;
    const fog = scene.fog as THREE.FogExp2 | null;
    u.uFogDensity.value = fog && (fog as THREE.FogExp2).isFogExp2 ? fog.density : 0;
    u.uNearFade.value.set(p.nearFade[0], p.nearFade[1]);
    u.uDensity.value = p.density;
    u.uHeightFalloff.value = p.heightFalloff;
    u.uRefHeight.value = p.refHeight;
    // Iteration 12: anisotropic patch-noise scale, the rigid station drift (x along the seeded draft), coverage / ground /
    // flow / extinction tunables (render/atmosphere.ts mediumAt).
    const S = p.noiseScale, A = p.noiseAnisotropy, draft = this.flowMap?.draft ?? 1;
    u.uNoiseScale.value.set(S, S * A, S);
    u.uNoiseAmount.value = p.noiseAmount;
    u.uWind.value.set(p.wind[0] * draft * S, p.wind[1] * S * A, p.wind[2] * S);
    u.uCover.value.set(p.coverage, p.coverageSlope, p.coverageSoftness, p.clear);
    u.uGround.value.set(p.ground, p.groundHeight, p.groundVariation, 0);
    u.uFlow.value.set(Math.max(1, p.flowPeriod), p.detail);
    u.uExt.value.set(p.patchExtinction, p.smokeExtinction, p.smokeScatter);
    u.uPhase.value.set(p.anisotropy, p.backAnisotropy, p.backScatter);
    u.tNoise.value = this.noise;
    u.tDensityMap.value = this.densityTex;
    u.tFlowMap.value = this.flowTex;
    u.tVis.value = this.visTex;
    const m = this.densityMap;
    if (m) {
      u.uMapXform.value.set(0, 0, 1 / (m.w * m.cell), 1 / (m.h * m.cell));
      u.uMapFloor.value.set(m.yMin, m.yRange);
      u.uMapSlots.value = m.slots;
    }
    // Flashlight (camera-held spot; same cone/attenuation as its surface lighting).
    const fl = this.lights.flashlight;
    fl.updateWorldMatrix(true, false);
    fl.target.updateWorldMatrix(true, false);
    fl.getWorldPosition(u.uFlashPos.value);
    u.uFlashDir.value.copy(fl.target.getWorldPosition(this.tmp)).sub(u.uFlashPos.value).normalize();
    u.uFlashCone.value.set(Math.cos(fl.angle), Math.cos(fl.angle * (1 - fl.penumbra)));
    const fk = fl.visible && fl.intensity > 0 ? fl.intensity * p.flashlightScatter : 0;
    u.uFlashColor.value.set(fl.color.r * fk, fl.color.g * fk, fl.color.b * fk);
    u.uFlashRange.value.set(fl.distance, fl.decay);
    const smap = fl.castShadow ? fl.shadow.map?.depthTexture ?? null : null;
    u.tShadow.value = smap;
    u.uShadowMatrix.value.copy(fl.shadow.matrix);
    u.uShadowBias.value = fl.shadow.bias;
    u.uShadowOn.value = smap && fk > 0 ? 1 : 0;
    // Baked fixture field (iteration 05): texture, bounds and live flicker-circuit levels.
    const fv = this.field;
    u.tField.value = fv?.texture ?? null;
    if (fv) {
      u.uFieldMin.value.copy(fv.boundingBox.min);
      u.uFieldMax.value.copy(fv.boundingBox.max);
      u.uFieldLevels.value.copy(fv.resolution);
    }
    u.uFieldGain.value = fv ? p.fixtureScatter : 0;
    // Muzzle flash pulse.
    const mz = this.lights.muzzle;
    const mk = mz && mz.visible && mz.intensity > 0 ? mz.intensity * p.muzzleScatter : 0;
    if (mz && mk > 0) {
      mz.getWorldPosition(u.uMuzzlePos.value);
      u.uMuzzleRange.value.set(mz.distance, mz.decay);
    }
    u.uMuzzleColor.value.set(mz ? mz.color.r * mk : 0, mz ? mz.color.g * mk : 0, mz ? mz.color.b * mk : 0);
    // Iteration 12: smoke puffs + scatter lights + their occlusion windows.
    this.syncSmoke(time);
    // Temporal: camera cuts (teleport / respawn) drop the history.
    const camPos = u.uCamPos.value as THREE.Vector3;
    if (this.historyValid && camPos.distanceTo(this.prevCamPos) > 3) this.historyValid = false;
    const t = this.temporal.uniforms;
    t.tCurrent.value = this.marchRT?.textures[0] ?? null;
    t.tCurrentT.value = this.marchRT?.textures[1] ?? null;
    t.uLowSize.value.set(lw, lh);
    t.uProjInv.value.copy(camera.projectionMatrixInverse);
    t.uCamWorld.value.copy(camera.matrixWorld);
    t.uPrevViewProj.value.copy(this.prevViewProj);
    t.uHistoryValid.value = this.historyValid ? 1 : 0;
    const c = this.composite.uniforms;
    c.tScene.value = this.sceneRT?.texture ?? null;
    c.tDepth.value = this.sceneRT?.depthTexture ?? null;
    c.uFullSize.value.set(w, h);
    c.uLowSize.value.set(lw, lh);
    c.uNear.value = camera.near;
    c.uFar.value = camera.far;
    c.uExposure.value = this.renderer?.toneMappingExposure ?? 1;
    c.uIntensity.value = p.intensity;
  }

  debug(): AtmosphereDebug {
    const fl = this.lights.flashlight, p = this.preset;
    const {areaDensity: _ad, ...params} = this.params;
    void _ad;
    return {
      requested: this.requested, quality: this.quality, enabled: this.enabled, active: this.active, supported: this.supported,
      reason: this.reason, failed: this.failed,
      resolution: {full: [this.full[0], this.full[1]], march: [this.low[0], this.low[1]], scale: p ? Math.round(this.low[0] / this.full[0] * 1000) / 1000 : 0},
      steps: p?.steps ?? 0, temporal: !!p?.temporal, msaa: p?.msaa ?? 0,
      shadow: {
        enabled: fl.castShadow, mapSize: fl.shadow.mapSize.x, bias: fl.shadow.bias, normalBias: fl.shadow.normalBias, near: fl.shadow.camera.near,
        updating: fl.castShadow && fl.shadow.autoUpdate, casters: this.casters, receivers: this.receivers,
      },
      station: {bound: !!this.densityTex, densityMap: this.densityMap ? [this.densityMap.w, this.densityMap.h] : null, field: !!this.field, flowMap: !!this.flowTex, draft: this.flowMap?.draft ?? 0},
      params,
      smoke: {
        emitters: this.smoke.emitters.length, puffs: this.smoke.puffCount, limits: SMOKE_LIMITS, stats: {...this.smoke.stats},
        list: this.smoke.emitters.map(e => ({id: e.id, emitting: e.emitting, puffs: e.puffs.length, x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, z: Math.round(e.z * 100) / 100})),
      },
      scatter: {lights: this.scatter.list.length, active: this.march.uniforms.uScatCount.value as number, windows: this.winState.filter(w => w.ok).length},
      ms: {gpu: this.timer?.ms ?? null, cpu: Math.round(this.cpuMs * 100) / 100, cpuScene: Math.round(this.cpuSceneMs * 100) / 100},
      frames: this.frame,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dropTargets();
    this.densityTex?.dispose();
    this.densityTex = null;
    this.flowTex?.dispose();
    this.flowTex = null;
    this.noise.dispose();
    this.visTex.dispose();
    this.march.dispose();
    this.temporal.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
    this.quadScene.remove(this.quad);
    this.timer?.dispose();
    this.clearSmoke();
    this.scatter.clear();
    this.lightLayer.clear();
    if (this.renderer) {
      const dbg = this.renderer.debug as {onShaderError: ShaderErrorFn | null};
      if (dbg.onShaderError === this.onShaderError) dbg.onShaderError = this.prevShaderError;
    }
    this.field = null;
  }
}
