// Station lighting (iteration 05, Lane L). Every fixture's on/off/flicker/dying state is layout data and
// is rendered identically at any camera distance:
// - the whole station's illumination is baked once per station into a world-space light field
//   (world/lightField.ts) that every lit material samples (static world, props, zombies, items);
// - emissive tubes + soft glow cards show each fixture's state from afar (tubes/glow get a gentler fog
//   curve so working lights still read through the haze, fading out well before the far plane);
// - flickering/dying fixtures belong to one of three flicker circuits; the field, tubes and glow all
//   follow the circuit level, so no light is ever switched or reassigned by camera proximity;
// - the hemisphere is a constant dim ambient floor (no follow-the-player pumping);
// - the only real dynamic lights are the flashlight and muzzle flash (owned by game.ts), plus the
//   iteration-12 body glow and the pooled flare lights (player/flashlight.ts, weapons/throwables.ts).
// Iteration 04 and earlier used a pool of 3-8 PointLights reassigned every 0.2 s to the fixtures
// nearest the camera, and drove the hemisphere from the player's current area: pools of light popped
// on around the player and the whole scene brightened/darkened when crossing doorways.
//
// Iteration 13 (LIGHTING): three r186 WebGPURenderer + TSL. The field is a lighting node on ONE persistent scene light
// (world/lightFieldNode.ts); tubes / glow cards are node materials. WebGPURenderer applies tone mapping as a frame output
// pass and ignores Material.toneMapped, so the iteration-12 "not tone mapped" tubes and glow cards pre-compensate with
// displayLinear() (inverse of three's ACES at the renderer exposure). The scene's light set never changes during a
// session (stable LightsNode cache key: no node / pipeline rebuild on new station, flare throw or flashlight toggle).

import * as THREE from 'three';
import {MeshBasicNodeMaterial, type Node, type NodeBuilder, type NodeMaterial} from 'three/webgpu';
import {
  Fn, cameraProjectionMatrix, clamp, dot, exp, float, length, mat3, max, min, mix, modelViewMatrix, normalize, output, positionGeometry,
  positionLocal, positionView, renderGroup, smoothstep, sqrt, toneMappingExposure, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import type {Area, LightProfile, StationLayout} from '../gen/station';
import type {Fixture} from './builder';
import {
  DEFAULT_FIELD, LightFieldVolume, bakeLightField, downsampleField, fixtureTint, groupLevel, sampleField,
  type BakedField, type FieldParams, type FieldSample,
} from './lightField';
import {LF, activeLightField, bindLightField, installLightFieldNode, setLightFieldLevels, stationFieldLight, type LightFieldLight} from './lightFieldNode';
import {addNodeHook} from '../render/nodeHooks';
import {stationLevels} from './levelGeometry';
import {mallSkyField} from './mallSkylight'; // Task track3-eaton-centre-20261031 (lane ARCH): daylight through the mall's glass roof
import {CELL} from '../gen/grid';

/**
 * Mood tunables (the primary's knobs). r4 values in comments. Darker overall, deeper falloff between
 * fixtures, greener fluorescent / warmer sodium tints (TINT in lightField.ts), flashlight matters.
 */
export const MOOD = {
  /** ACES tone-mapping exposure (r4 1.0). */
  exposure: 0.78,
  /** Global ambient floor: constant hemisphere intensity (r4 0.6 lit / 0.27 dim / 0.15 dark, following the player). */
  ambient: 0.045,
  /** Output multiplier for every fixture in the baked field (1 = DEFAULT_FIELD.gain). */
  fixtureGain: 1,
  /** Bounce fill between pools, fraction of direct light (0 = black between fixtures). */
  bounce: DEFAULT_FIELD.bounce,
  /** FogExp2 density (r4 0.038) and colour (r4 0x0a0b0c): slightly green-black haze. */
  fogDensity: 0.043,
  fogColor: 0x090b0a,
  /** Flashlight candela (r4 34). */
  flashlight: 34,
  /** Hemisphere colours: grey-green "sky", near-black floor bounce. */
  hemiSky: 0x8f9c92,
  hemiGround: 0x1a1c1a,
  /** Glow card strength around working tubes (0 disables the glow cards). */
  glow: 0.2,
  /** Tubes and glow fog at this fraction of the scene fog density (they read further through the haze). */
  glowFog: 0.6,
} as const;

/** Real dynamic lights owned by game.ts (flashlight, muzzle flash); body glow + flare lights live in their systems. */
export const DYNAMIC_LIGHTS = 2;

export interface LightingDebug {
  areaIndex: number;
  areaType: string | null;
  /** Profile of the area the camera is in (debug/QA only; rendering never reads it). */
  profile: LightProfile;
  ambient: number;
  ambientTarget: number;
  /** Real dynamic lights besides the hemisphere (flashlight + muzzle). */
  poolSize: number;
  poolLit: number;
  circuits: [number, number, number];
  field: {w: number; h: number; layers: number; slots: number; cellScale: number; bakeMs: number; bytes: number; working: number; crossRays: number};
  /** Iteration 13: TSL light node registered in the renderer's node library / this station's field bound / light in the scene. */
  node: {registered: boolean; bound: boolean; inScene: boolean; max3D: number};
  fixtures: {total: number; broken: number; flicker: number; dying: number; dim: number};
  areas: Record<LightProfile, number>;
}

/** The parts of a WebGPURenderer StationLighting uses (node library, backend limits, tone mapping). */
export interface LightingRenderer {
  library?: unknown;
  backend?: unknown;
  toneMapping?: THREE.ToneMapping;
}

export interface StationLightingOptions {
  hemi?: THREE.HemisphereLight;
  /** Field bake parameters (defaults: DEFAULT_FIELD with MOOD gain/bounce). */
  params?: Partial<FieldParams>;
  /** Scene fog density used for the tube/glow fog curve before scene.fog is read (default MOOD.fogDensity). */
  fogDensity?: number;
  /** Camera far plane: glow cards are faded out before it (no far-plane pop). */
  far?: number;
  /** GPU 3D texture size limit (WebGL2 guarantees only 256): the field is downsampled to fit. Default: from `renderer`. */
  max3DTextureSize?: number;
  /** Iteration 08: GPU memory cap for the field (bytes); a larger bake is downsampled to fit. Default 32 MB. */
  maxFieldBytes?: number;
  /** Iteration 13: the (initialised) WebGPURenderer: registers the light-field node and reads the 3D texture limit. */
  renderer?: LightingRenderer | null;
}

/**
 * Largest 3D texture edge of an initialised WebGPURenderer: WebGPU device limit maxTextureDimension3D, or the WebGL2
 * backend's MAX_3D_TEXTURE_SIZE. `fallback` when unknown (no renderer / not initialised).
 */
export function max3DTextureSize(renderer: LightingRenderer | null | undefined, fallback = 2048): number {
  const b = renderer?.backend as {device?: {limits?: {maxTextureDimension3D?: number}}; gl?: WebGL2RenderingContext} | undefined;
  const lim = b?.device?.limits?.maxTextureDimension3D;
  if (typeof lim === 'number' && lim > 0) return lim;
  const gl = b?.gl;
  if (gl && typeof gl.getParameter === 'function') {
    const v = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number;
    if (typeof v === 'number' && v > 0) return v;
  }
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Display-referred colours under WebGPURenderer's output tone mapping

// TSL nodes are chained untyped here (three's TSL typings reject most mixed-type chains).
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;

/** three r186 TSL ACESFilmic (renderers apply it as the frame output pass; display/ToneMappingFunctions.js). */
const ACES_IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777);
const ACES_OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
const ACES_IN_INV = ACES_IN.clone().invert();
const ACES_OUT_INV = ACES_OUT.clone().invert();
/** Highest display value displayLinear aims for (ACES only approaches 1 asymptotically). */
export const DISPLAY_MAX = 0.985;
/** RRT/ODT fit as three's TSL writes it: a(v) / b(v), b(v) = 0.983729 v^2 + 0.983729 * 0.432951 v + 0.238081. */
const FIT = {a1: 0.0245786, a0: 0.000090537, b2: 0.983729, b1: 0.983729 * 0.432951, b0: 0.238081};

/** CPU mirror of three r186's TSL ACES output (linear rgb in, display-linear rgb out). */
export function acesDisplayCPU(c: readonly [number, number, number], exposure: number): [number, number, number] {
  const v = new THREE.Vector3(...c).multiplyScalar(exposure / 0.6).applyMatrix3(ACES_IN);
  const f = (x: number) => (x * (x + FIT.a1) - FIT.a0) / (x * x * FIT.b2 + x * FIT.b1 + FIT.b0);
  v.set(f(v.x), f(v.y), f(v.z)).applyMatrix3(ACES_OUT);
  const cl = (x: number) => Math.min(1, Math.max(0, x));
  return [cl(v.x), cl(v.y), cl(v.z)];
}

/** Inverse of the fit for one channel (y in [0, 1 / b2)). */
const fitInv = (y: number) => {
  const A = 1 - FIT.b2 * y, B = FIT.a1 - FIT.b1 * y, C = -(FIT.a0 + FIT.b0 * y);
  return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
};

/** CPU mirror of displayLinear: the scene-linear colour that ACES (at `exposure`) displays as `d` (clamped to DISPLAY_MAX). */
export function displayLinearCPU(d: readonly [number, number, number], exposure: number): [number, number, number] {
  const cl = (x: number) => Math.min(DISPLAY_MAX, Math.max(0, x));
  const y = new THREE.Vector3(cl(d[0]), cl(d[1]), cl(d[2])).applyMatrix3(ACES_OUT_INV);
  const yc = (x: number) => fitInv(Math.min(0.99, Math.max(0, x)));
  const v = new THREE.Vector3(yc(y.x), yc(y.y), yc(y.z)).applyMatrix3(ACES_IN_INV).multiplyScalar(0.6 / exposure);
  return [Math.max(0, v.x), Math.max(0, v.y), Math.max(0, v.z)];
}

const m3 = (m: THREE.Matrix3) => mat3(m);

/**
 * TSL: the scene-linear colour that the renderer's output tone mapping displays as `color` (display-linear, 0..1). Use it
 * where iteration 12 relied on `toneMapped: false` (emissive tubes, glow cards): with ACESFilmic it inverts three's TSL
 * ACES at renderer.toneMappingExposure; with no tone mapping it is the identity. Other curves: identity (logged).
 */
export const displayLinear = Fn(([color]: [Node], builder: NodeBuilder) => {
  const tm = (builder.renderer as unknown as {toneMapping?: THREE.ToneMapping}).toneMapping ?? THREE.NoToneMapping;
  if (tm !== THREE.ACESFilmicToneMapping) {
    if (tm !== THREE.NoToneMapping) console.warn('displayLinear: only ACESFilmic is inverted; colour passed through');
    return color;
  }
  const d = clamp(n(color).rgb, 0, DISPLAY_MAX);
  const y = clamp(n(m3(ACES_OUT_INV)).mul(d), 0, 0.99);
  const A = n(float(1)).sub(n(y).mul(FIT.b2));
  const B = n(float(FIT.a1)).sub(n(y).mul(FIT.b1));
  const C = n(n(y).mul(FIT.b0).add(FIT.a0)).negate();
  const v = n(B).negate().add(sqrt(max(n(B).mul(B).sub(n(A).mul(C).mul(4)), 0))).div(n(A).mul(2));
  return max(n(n(m3(ACES_IN_INV)).mul(v)).mul(0.6).div(toneMappingExposure), 0);
});

// ---------------------------------------------------------------------------------------------
// Glow fog: tubes and glow cards fog at a fraction of the scene fog density

/** Scene fog as seen by the glow-fog hooks (synced from scene.fog by StationLighting; density 0 = none). */
export const GLOW_FOG = {
  density: uniform(MOOD.fogDensity).setGroup(renderGroup),
  color: uniform(new THREE.Color(MOOD.fogColor)).setGroup(renderGroup),
};

/** Copy scene.fog (FogExp2) into GLOW_FOG; any other / no fog disables the analytic tube fog. */
export function syncGlowFog(fog: THREE.Fog | THREE.FogExp2 | null | undefined): void {
  const f = fog as THREE.FogExp2 | null | undefined;
  if (f && f.isFogExp2) {
    GLOW_FOG.density.value = f.density;
    (GLOW_FOG.color.value as THREE.Color).copy(f.color);
  } else GLOW_FOG.density.value = 0;
}

const isNodeMaterial = (m: THREE.Material | null | undefined): m is NodeMaterial => !!(m as {isNodeMaterial?: boolean} | null)?.isNodeMaterial;

/**
 * Gentler fog for emissive tubes (they are light sources: they read further through the haze). Node materials only:
 * material.fog = false and an 'output' hook (render/nodeHooks.ts, order 400) that mixes toward the scene fog colour with
 * exp2 density x factor (iteration 12: three's fog_fragment with density^2 x factor^2). Idempotent per material.
 */
export function glowFog(m: THREE.Material, factor: number): void {
  if (!isNodeMaterial(m)) { console.warn('glowFog: not a node material', m.type); return; }
  if (m.userData.glowFog === factor) return; // shared material: hook once
  m.userData.glowFog = factor;
  m.fog = false;
  addNodeHook(m, {
    key: 'glow-fog', stage: 'output', order: 400,
    fn: prev => {
      const c = n(prev ?? output);
      const dz = n(n(positionView).z).negate();
      const fd = n(GLOW_FOG.density).mul(factor).mul(dz);
      const f = n(float(1)).sub(exp(n(fd).mul(fd).negate()));
      return vec4(mix(c.rgb, GLOW_FOG.color, f), c.a);
    },
  });
}

/** Display `m` like iteration 12's `toneMapped: false` under WebGPURenderer's output tone mapping ('output' hook, 450). */
export function displayReferred(m: THREE.Material): void {
  if (!isNodeMaterial(m)) { console.warn('displayReferred: not a node material', m.type); return; }
  m.toneMapped = false; // documents intent (WebGPURenderer ignores it)
  if (m.userData.displayReferred) return;
  m.userData.displayReferred = true;
  addNodeHook(m, {key: 'display-referred', stage: 'output', order: 450, fn: prev => { const c = n(prev ?? output); return vec4(n(displayLinear(c.rgb)), c.a); }});
}

/** Node twin of a plain (WebGL-era) MeshBasicMaterial, cached per source (the tube material is shared across stations). */
const nodeTwins = new WeakMap<THREE.Material, MeshBasicNodeMaterial>();
function asNodeMaterial(m: THREE.Material): NodeMaterial {
  if (isNodeMaterial(m)) return m;
  let t = nodeTwins.get(m);
  if (!t) {
    const b = m as THREE.MeshBasicMaterial;
    t = new MeshBasicNodeMaterial({name: b.name || 'light-tubes', color: b.color, map: b.map ?? null, side: b.side, transparent: b.transparent, opacity: b.opacity});
    nodeTwins.set(m, t);
  }
  return t;
}

// ---------------------------------------------------------------------------------------------

const tmpColor = new THREE.Color();

export class StationLighting {
  readonly field: BakedField;
  readonly volume: LightFieldVolume;
  /** Iteration 13: the session's single light-field scene light (world/lightFieldNode.ts). */
  readonly fieldLight: LightFieldLight;
  /** Soft glow cards, one per working fixture (camera-facing, additive). */
  readonly glow: THREE.InstancedMesh | null;
  /** Kept for API compatibility: no pooled lights exist any more. */
  readonly lights: readonly THREE.Light[] = [];
  readonly levels: [number, number, number] = [1, 1, 1];
  profile: LightProfile = 'lit';
  areaIndex = -1;
  private t = 0;
  private readonly groups: Int8Array;
  private readonly glowIndex: Int32Array;
  private readonly animated: number[] = [];
  private readonly registered: boolean;
  private readonly max3D: number;

  constructor(private readonly scene: THREE.Scene, private readonly layout: StationLayout, private readonly fixtures: Fixture[],
    private readonly tubes: THREE.InstancedMesh | null, private readonly opts: StationLightingOptions = {}) {
    const params: FieldParams = {...DEFAULT_FIELD, gain: DEFAULT_FIELD.gain * MOOD.fixtureGain, bounce: MOOD.bounce, ...opts.params};
    // Iteration 08: one level slot per station level (upper deck / main / lower crossing).
    // Task track3-eaton-centre-20261031 (lane ARCH): + the mall's daylight through the glass roof ({} for every other level).
    const full = bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: layout.trench.floorY, levels: stationLevels(layout), ...mallSkyField(layout, CELL)}, params);
    const max = this.max3D = opts.max3DTextureSize ?? max3DTextureSize(opts.renderer);
    const budget = opts.maxFieldBytes ?? 32e6;
    const k = Math.max(1, Math.ceil(Math.max(full.w, full.h) / max), Math.ceil(Math.sqrt(full.stats.bytes / budget)));
    this.field = k > 1 ? downsampleField(full, k) : full;
    this.groups = this.field.groups;
    this.volume = new LightFieldVolume(this.field);
    // Iteration 13: TSL lighting node on the persistent field light; this station's texture on the global nodes.
    this.registered = installLightFieldNode(opts.renderer);
    this.fieldLight = stationFieldLight();
    scene.add(this.fieldLight);
    bindLightField(this.volume);
    if (opts.hemi) {
      opts.hemi.intensity = MOOD.ambient;
      opts.hemi.color.setHex(MOOD.hemiSky);
      opts.hemi.groundColor.setHex(MOOD.hemiGround);
    }
    for (let i = 0; i < fixtures.length; i++) if (this.groups[i] >= 0) this.animated.push(i);
    GLOW_FOG.density.value = opts.fogDensity ?? MOOD.fogDensity;
    if (scene.fog) syncGlowFog(scene.fog);
    if (tubes) {
      const m = asNodeMaterial(tubes.material as THREE.Material);
      if (tubes.material !== m) tubes.material = m;
      glowFog(m, MOOD.glowFog);
      displayReferred(m);
    }
    // Glow cards for every working fixture.
    this.glowIndex = new Int32Array(fixtures.length).fill(-1);
    const working = fixtures.map((_, i) => i).filter(i => !fixtures[i].broken && fixtures[i].power > 0.01);
    if (working.length && MOOD.glow > 0) {
      const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMaterial(opts.far ?? 70), working.length);
      const m4 = new THREE.Matrix4();
      working.forEach((fi, k) => {
        const f = fixtures[fi];
        this.glowIndex[fi] = k;
        im.setMatrixAt(k, m4.makeTranslation(f.x, f.y - 0.22, f.z));
        im.setColorAt(k, tmpColor.setRGB(0, 0, 0));
      });
      im.name = 'light-glow';
      im.renderOrder = 2;
      im.castShadow = im.receiveShadow = false;
      im.computeBoundingSphere();
      scene.add(im);
      this.glow = im;
    } else this.glow = null;
    for (let g = 0; g < 3; g++) this.levels[g] = groupLevel(g, 0);
    this.setFieldLevels();
    this.applyLevels(true);
  }

  /**
   * `retire` (iteration 14): when given, the GPU releases (field volume, glow mesh / material) are handed to it — the
   * scene removal stays immediate — so the game can run them after the next station's warm-up; else immediate.
   */
  dispose(scene: THREE.Scene = this.scene, retire?: (release: () => void) => void): void {
    if (this.fieldLight.parent === scene) scene.remove(this.fieldLight);
    if (activeLightField() === this.volume) bindLightField(null);
    const volume = this.volume, glow = this.glow;
    if (glow) scene.remove(glow);
    const release = () => {
      volume.dispose();
      if (glow) { glow.geometry.dispose(); (glow.material as THREE.Material).dispose(); glow.dispose(); }
    };
    if (retire) retire(release); else release();
  }

  /** Hemisphere intensity (constant ambient floor). */
  get ambient(): number {
    return this.opts.hemi?.intensity ?? MOOD.ambient;
  }

  /** Brightness 0..1 of fixture i right now (state x circuit level; never camera-dependent). */
  fixtureLevel(i: number): number {
    const f = this.fixtures[i];
    if (!f || f.broken) return 0;
    const g = this.groups[i];
    return g >= 0 ? this.levels[g] : 1;
  }

  /**
   * Advance the flicker circuits. `cam` is used ONLY to report which area the camera is in for QA/debug;
   * nothing that is rendered depends on it.
   */
  update(dt: number, cam?: THREE.Vector3): void {
    this.t += dt;
    for (let g = 0; g < 3; g++) this.levels[g] = groupLevel(g, this.t);
    this.setFieldLevels();
    this.applyLevels(false);
    syncGlowFog(this.scene.fog);
    if (cam) {
      const ai = cameraArea(this.layout, cam);
      this.areaIndex = ai;
      const area: Area | undefined = this.layout.areas[ai >= 0 ? ai : this.layout.platform];
      this.profile = area?.lighting ?? 'lit';
    }
  }

  /** Circuit levels -> the volume (volumetric pass) and the bound TSL field; field-light intensity -> its gain. */
  private setFieldLevels(): void {
    const [l0, l1, l2] = this.levels;
    this.volume.setLevels(l0, l1, l2);
    if (activeLightField() === this.volume) {
      setLightFieldLevels(l0, l1, l2);
      LF.gain.value = this.fieldLight.intensity;
    }
  }

  private applyLevels(all: boolean): void {
    const tubes = this.tubes, glow = this.glow;
    let tubesDirty = false, glowDirty = false;
    const list = all ? this.fixtures.map((_, i) => i) : this.animated;
    for (const i of list) {
      const f = this.fixtures[i];
      const lvl = this.fixtureLevel(i);
      if (!all && Math.abs(lvl - f.level) < 0.005) continue;
      f.level = lvl;
      const out = lvl * f.power;
      const [tr, tg, tb] = fixtureTint(f);
      const mx = Math.max(tr, tg, tb);
      if (tubes) {
        if (out <= 0.02) tmpColor.setRGB(0.035, 0.038, 0.04); // dead tube: dark grey glass
        else {
          const k = 0.12 + 0.88 * out;
          // Tubes look near-white; a third of the light colour shows through.
          tmpColor.setRGB(k * (0.65 + 0.35 * tr / mx), k * (0.65 + 0.35 * tg / mx), k * (0.65 + 0.35 * tb / mx));
        }
        tubes.setColorAt(i, tmpColor);
        tubesDirty = true;
      }
      const gi = this.glowIndex[i];
      if (glow && gi >= 0) {
        glow.setColorAt(gi, tmpColor.setRGB(tr / mx * out, tg / mx * out, tb / mx * out));
        glowDirty = true;
      }
    }
    if (tubesDirty && tubes?.instanceColor) tubes.instanceColor.needsUpdate = true;
    if (glowDirty && glow?.instanceColor) glow.instanceColor.needsUpdate = true;
  }

  /** Field sample at a world point (current circuit levels). */
  sample(x: number, y: number, z: number, normal?: readonly [number, number, number]): FieldSample {
    return sampleField(this.field, x, y, z, this.levels, normal);
  }

  /** 0..1 brightness for the first-person viewmodel (its own scene/lights), from the field at the eye. */
  viewLevel(eye: THREE.Vector3, flashlightOn: boolean): number {
    const s = this.sample(eye.x, eye.y, eye.z);
    const l = 0.2126 * (s.amb[0] + s.dirColor[0]) + 0.7152 * (s.amb[1] + s.dirColor[1]) + 0.0722 * (s.amb[2] + s.dirColor[2]);
    return Math.min(1, l * 0.32 + this.ambient * 0.4 + (flashlightOn ? 0.1 : 0));
  }

  /** QA/debug view of the lighting state. */
  debug(): LightingDebug {
    const areas: Record<LightProfile, number> = {lit: 0, dim: 0, dark: 0};
    for (const a of this.layout.areas) areas[a.lighting]++;
    const fx = this.fixtures;
    const area = this.areaIndex >= 0 ? this.layout.areas[this.areaIndex] : null;
    const st = this.field.stats;
    return {
      areaIndex: this.areaIndex,
      areaType: area?.type ?? null,
      profile: this.profile,
      ambient: Math.round(this.ambient * 1000) / 1000,
      ambientTarget: MOOD.ambient,
      poolSize: DYNAMIC_LIGHTS,
      poolLit: 0,
      circuits: [this.levels[0], this.levels[1], this.levels[2]],
      field: {w: this.field.w, h: this.field.h, layers: this.field.layers, slots: this.field.slots, cellScale: this.field.cellScale ?? 1, bakeMs: Math.round(st.ms), bytes: st.bytes, working: st.working, crossRays: st.crossRays},
      node: {registered: this.registered, bound: activeLightField() === this.volume, inScene: this.fieldLight.parent === this.scene, max3D: this.max3D},
      fixtures: {
        total: fx.length,
        broken: fx.filter(f => f.broken).length,
        flicker: fx.filter(f => !f.broken && f.flicker && !f.dying).length,
        dying: fx.filter(f => !f.broken && f.dying).length,
        dim: fx.filter(f => !f.broken && f.power < 0.8).length,
      },
      areas,
    };
  }
}

/** Area of the level band the camera (eye) is in (debug/QA only). */
function cameraArea(layout: StationLayout, cam: THREE.Vector3): number {
  const g0 = layout.grid;
  const [cx, cy] = g0.cellOf(cam.x, cam.z);
  if (!g0.inBounds(cx, cy)) return -1;
  const i = cy * g0.w + cx;
  let best = -1, bestFloor = -Infinity;
  for (const L of stationLevels(layout)) {
    const g = L.grid, c = g.cells[i];
    if (c !== 1 && c !== 2) continue; // FLOOR / VOID
    const f = g.floorAt(cam.x, cam.z);
    if (f <= cam.y + 0.2 && f > bestFloor) { bestFloor = f; best = g.area[i]; }
  }
  return best;
}

/**
 * Soft additive glow card per working fixture (iteration 05 GLSL ShaderMaterial -> node material): a camera-facing
 * 1.5 x 0.75 m card pulled toward the camera so the ceiling never slices it, a gaussian falloff, the fixture's circuit
 * colour (instance colour), faded by the gentler glow fog, near the camera and before the far plane. Display-referred
 * (iteration 12 drew it un-tone-mapped).
 */
export function glowMaterial(far: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({name: 'light-glow', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false});
  m.toneMapped = false;
  // Card centre = the instance translation (the instanced position minus the raw corner).
  const centre = n(positionLocal).sub(positionGeometry);
  const c = n(n(modelViewMatrix).mul(vec4(centre, 1)).xyz);
  const dist = length(c);
  const pulled = n(c.sub(n(normalize(c)).mul(min(0.6, n(dist).mul(0.25))))).add(vec3(n(n(positionGeometry).xy).mul(vec2(1.5, 0.75)), 0));
  m.vertexNode = n(cameraProjectionMatrix).mul(vec4(pulled, 1));
  const fd = n(GLOW_FOG.density).mul(MOOD.glowFog).mul(dist);
  const farU = uniform(far);
  const fade = varying(n(exp(n(fd).mul(fd).negate())).mul(smoothstep(1.5, 5.0, dist)).mul(n(float(1)).sub(smoothstep(n(farU).mul(0.75), n(farU).mul(0.95), dist))));
  const q = n(n(uv()).sub(0.5)).mul(2);
  const a = max(0, n(exp(n(dot(q, q)).mul(-3))).sub(0.05));
  m.colorNode = vec4(vec3(n(a).mul(MOOD.glow).mul(fade)), 1); // x instance colour (NodeMaterial.setupDiffuseColor)
  m.outputNode = vec4(n(displayLinear(n(output).rgb)), 1);
  return m;
}
