// Iteration 06 (Lane F): depth-aware volumetric atmosphere (light haze, strongest in the flashlight).
//
// Frame (quality low/high, see ATMOSPHERE_QUALITY):
//   1. the station scene renders into `sceneRT` (MSAA like the canvas, + a depth texture). The target
//      is flagged like three's own WebXR targets (isXRRenderTarget) so every material tone-maps and
//      sRGB-encodes exactly as it does on the canvas (same programs, identical r5 pixels);
//      three renders the flashlight's spot shadow map during this pass;
//   2. raymarch at 1/2 (high) or 1/4 (low) resolution, capped pixel budget, 24 / 14 jittered steps:
//      reconstruct each pixel's surface from depth and integrate single in-scattering in FRONT of it
//      only - flashlight cone (shadow-mapped), baked fixture light field, muzzle pulse - over a medium
//      with per-area / height / drifting-noise density (render/atmosphere.ts);
//   3. temporal accumulation (reprojected, neighbourhood-clamped, depth-rejected) at march resolution;
//   4. full-resolution composite onto the canvas: bilateral (depth-aware) upsample, in-scatter added
//      in scene-linear space under three's ACES curve. game.ts then clears depth and draws the
//      viewmodel overlay on top, so the gun and the DOM HUD are never fogged.
// Quality 'off' (or unsupported float render targets, or a shader error) renders straight to the
// canvas as in r5, without the flashlight shadow map. The pass adds no lights and no objects to the
// station scene; its fullscreen triangle lives in a private scene.

import * as THREE from 'three';
import type {StationLayout} from '../gen/station';
import type {LightFieldVolume} from '../world/lightField';
import {
  ACES_IN, ACES_IN_INV, ACES_OUT, ACES_OUT_INV, ATMOSPHERE_QUALITY, NOISE_SIZE, SHADOW_NEAR, SHADOW_NORMAL_BIAS,
  atmosphereFor, buildDensityMap, buildNoiseVolume, marchSize, shadowBiasFor,
  type AtmosphereParams, type AtmosphereQuality, type DensityMap, type QualityPreset,
} from './atmosphere';
import {VF_COMPOSITE, VF_MARCH, VF_MARK, VF_TEMPORAL, VF_VERTEX} from './volumetricShaders';

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
  station: {bound: boolean; densityMap: [number, number] | null; field: boolean};
  params: Omit<AtmosphereParams, 'areaDensity'>;
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
  readonly noise: THREE.Data3DTexture;
  readonly march: THREE.ShaderMaterial;
  readonly temporal: THREE.ShaderMaterial;
  readonly composite: THREE.ShaderMaterial;
  private full: [number, number] = [1, 1];
  private low: [number, number] = [1, 1];
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private marchRT: THREE.WebGLRenderTarget | null = null;
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private histIndex = 0;
  private historyValid = false;
  private densityTex: THREE.DataArrayTexture | null = null;
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

    const noise = new THREE.Data3DTexture(buildNoiseVolume(), NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
    noise.format = THREE.RedFormat;
    noise.type = THREE.UnsignedByteType;
    noise.minFilter = noise.magFilter = THREE.LinearFilter;
    noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
    noise.generateMipmaps = false;
    noise.unpackAlignment = 1;
    noise.colorSpace = THREE.NoColorSpace;
    noise.needsUpdate = true;
    this.noise = noise;

    const V2 = () => new THREE.Vector2(1, 1), V3 = () => new THREE.Vector3(), M4 = () => new THREE.Matrix4();
    const pass = (name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, number> = {}) => new THREE.ShaderMaterial({
      name, vertexShader: VF_VERTEX, fragmentShader, uniforms, defines,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    this.march = pass('volumetric-march', VF_MARCH, {
      tDepth: {value: null}, uFullSize: {value: V2()}, uLowSize: {value: V2()}, uProjInv: {value: M4()}, uCamWorld: {value: M4()},
      uCamPos: {value: V3()}, uNear: {value: 0.05}, uFar: {value: 70}, uMaxDist: {value: 36}, uFrame: {value: 0}, uTime: {value: 0},
      uFogDensity: {value: 0}, uNearFade: {value: V2()}, uDensity: {value: 0}, uHeightFalloff: {value: 0}, uRefHeight: {value: 1.6},
      uNoiseScale: {value: 0.1}, uNoiseAmount: {value: 0}, uWind: {value: V3()}, tNoise: {value: noise}, tDensityMap: {value: null}, uMapSlots: {value: 1},
      uMapXform: {value: new THREE.Vector4(0, 0, 1, 1)}, uMapFloor: {value: new THREE.Vector2(0, 1)}, uPhase: {value: V3()},
      uFlashPos: {value: V3()}, uFlashDir: {value: new THREE.Vector3(0, 0, -1)}, uFlashCone: {value: new THREE.Vector2(1, 1)}, uFlashColor: {value: V3()},
      uFlashRange: {value: new THREE.Vector2(30, 1.2)}, tShadow: {value: null}, uShadowMatrix: {value: M4()}, uShadowBias: {value: 0}, uShadowOn: {value: 0},
      tField: {value: null}, uFieldMin: {value: V3()}, uFieldMax: {value: new THREE.Vector3(1, 1, 1)}, uFieldLevels: {value: new THREE.Vector3(1, 1, 1)}, uFieldGain: {value: 0},
      uMuzzlePos: {value: V3()}, uMuzzleColor: {value: V3()}, uMuzzleRange: {value: new THREE.Vector2(8, 2)},
    }, {VF_STEPS: 24});
    this.temporal = pass('volumetric-temporal', VF_TEMPORAL, {
      tCurrent: {value: null}, tHistory: {value: null}, uLowSize: {value: V2()}, uProjInv: {value: M4()}, uCamWorld: {value: M4()},
      uPrevViewProj: {value: M4()}, uHistoryValid: {value: 0}, uBlend: {value: 0.85},
    });
    this.composite = pass('volumetric-composite', VF_COMPOSITE, {
      tScene: {value: null}, tDepth: {value: null}, tFog: {value: null}, uFullSize: {value: V2()}, uLowSize: {value: V2()},
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

  /** New station: per-level tunables, density map (areas + floors) and the baked light field. */
  setStation(layout: StationLayout, field: LightFieldVolume | null): void {
    this.params = atmosphereFor(layout);
    this.densityMap = buildDensityMap(layout, this.params);
    this.densityTex?.dispose();
    const m = this.densityMap;
    // Iteration 08: one layer per level slot (RGBA: multiplier, floor, ceiling, presence).
    const t = new THREE.DataArrayTexture(m.data, m.w, m.h, m.slots);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    this.densityTex = t;
    this.field = field;
    this.historyValid = false;
    this.casters = this.receivers = 0;
  }

  /** Mark flashlight shadow casters/receivers (call for the station structure, containers, zombies). */
  markShadows(root: THREE.Object3D, structure: boolean): void {
    const r = markShadows(root, this.params.surfaceShadows, structure);
    this.casters += r.casters;
    this.receivers += r.receivers;
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
    if (!this.active) { this.direct(scene, camera); return; }
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
    let fog = marchRT.texture;
    if (history && !this.failed) {
      const dst = history[this.histIndex], src = history[1 - this.histIndex];
      this.temporal.uniforms.tHistory.value = src.texture;
      this.draw(this.temporal, dst);
      fog = dst.texture;
      this.histIndex = 1 - this.histIndex;
      this.historyValid = true;
    }
    if (!this.failed) {
      this.composite.uniforms.tFog.value = fog;
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
    const lowTarget = (name: string, filter: THREE.MagnificationTextureFilter) => {
      const rt = new THREE.WebGLRenderTarget(lw, lh, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false,
        minFilter: filter, magFilter: filter, generateMipmaps: false,
      });
      rt.texture.name = name;
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
    u.uNoiseScale.value = p.noiseScale;
    u.uNoiseAmount.value = p.noiseAmount;
    u.uWind.value.set(p.wind[0], p.wind[1], p.wind[2]).multiplyScalar(p.noiseScale);
    u.uPhase.value.set(p.anisotropy, p.backAnisotropy, p.backScatter);
    u.tNoise.value = this.noise;
    u.tDensityMap.value = this.densityTex;
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
    // Temporal: camera cuts (teleport / respawn) drop the history.
    const camPos = u.uCamPos.value as THREE.Vector3;
    if (this.historyValid && camPos.distanceTo(this.prevCamPos) > 3) this.historyValid = false;
    const t = this.temporal.uniforms;
    t.tCurrent.value = this.marchRT?.texture ?? null;
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
      station: {bound: !!this.densityTex, densityMap: this.densityMap ? [this.densityMap.w, this.densityMap.h] : null, field: !!this.field},
      params,
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
    this.noise.dispose();
    this.march.dispose();
    this.temporal.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
    this.quadScene.remove(this.quad);
    this.timer?.dispose();
    if (this.renderer) {
      const dbg = this.renderer.debug as {onShaderError: ShaderErrorFn | null};
      if (dbg.onShaderError === this.onShaderError) dbg.onShaderError = this.prevShaderError;
    }
    this.field = null;
  }
}
