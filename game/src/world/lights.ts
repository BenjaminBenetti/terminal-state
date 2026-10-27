// Station lighting (iteration 05, Lane L). Every fixture's on/off/flicker/dying state is layout data and
// is rendered identically at any camera distance:
// - the whole station's illumination is baked once per station into a world-space light field
//   (world/lightField.ts) that every lit material samples (static world, props, zombies, items);
// - emissive tubes + soft glow cards show each fixture's state from afar (tubes/glow get a gentler fog
//   curve so working lights still read through the haze, fading out well before the far plane);
// - flickering/dying fixtures belong to one of three flicker circuits; the field, tubes and glow all
//   follow the circuit level, so no light is ever switched or reassigned by camera proximity;
// - the hemisphere is a constant dim ambient floor (no follow-the-player pumping);
// - the only real dynamic lights are the flashlight and muzzle flash (owned by game.ts).
// Iteration 04 and earlier used a pool of 3-8 PointLights reassigned every 0.2 s to the fixtures
// nearest the camera, and drove the hemisphere from the player's current area: pools of light popped
// on around the player and the whole scene brightened/darkened when crossing doorways.

import * as THREE from 'three';
import type {Area, LightProfile, StationLayout} from '../gen/station';
import type {Fixture} from './builder';
import {
  DEFAULT_FIELD, LightFieldVolume, bakeLightField, downsampleField, fixtureTint, groupLevel, installLightFieldShader, sampleField,
  type BakedField, type FieldParams, type FieldSample,
} from './lightField';
import {addShaderHook} from '../render/shaderHooks';

installLightFieldShader();

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

/** Real dynamic lights in the station scene, all owned by game.ts (flashlight, muzzle flash). */
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
  field: {w: number; h: number; layers: number; cellScale: number; bakeMs: number; bytes: number; working: number};
  fixtures: {total: number; broken: number; flicker: number; dying: number; dim: number};
  areas: Record<LightProfile, number>;
}

export interface StationLightingOptions {
  hemi?: THREE.HemisphereLight;
  /** Field bake parameters (defaults: DEFAULT_FIELD with MOOD gain/bounce). */
  params?: Partial<FieldParams>;
  /** Scene fog density used for the tube/glow fog curve. */
  fogDensity?: number;
  /** Camera far plane: glow cards are faded out before it (no far-plane pop). */
  far?: number;
  /** GPU MAX_3D_TEXTURE_SIZE (WebGL2 guarantees only 256): the field is downsampled to fit if needed. */
  max3DTextureSize?: number;
}

const tmpColor = new THREE.Color();

export class StationLighting {
  readonly field: BakedField;
  readonly volume: LightFieldVolume;
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
  private readonly glowUniforms: {uFogDensity: {value: number}; uFar: {value: number}; uIntensity: {value: number}};

  constructor(private readonly scene: THREE.Scene, private readonly layout: StationLayout, private readonly fixtures: Fixture[],
    private readonly tubes: THREE.InstancedMesh | null, private readonly opts: StationLightingOptions = {}) {
    const params: FieldParams = {...DEFAULT_FIELD, gain: DEFAULT_FIELD.gain * MOOD.fixtureGain, bounce: MOOD.bounce, ...opts.params};
    const full = bakeLightField({grid: layout.grid, lights: layout.lights, trenchFloorY: layout.trench.floorY}, params);
    const max = opts.max3DTextureSize ?? 2048;
    const k = Math.max(1, Math.ceil(Math.max(full.w, full.h) / max));
    this.field = k > 1 ? downsampleField(full, k) : full;
    this.groups = this.field.groups;
    this.volume = new LightFieldVolume(this.field);
    scene.add(this.volume);
    if (opts.hemi) {
      opts.hemi.intensity = MOOD.ambient;
      opts.hemi.color.setHex(MOOD.hemiSky);
      opts.hemi.groundColor.setHex(MOOD.hemiGround);
    }
    for (let i = 0; i < fixtures.length; i++) if (this.groups[i] >= 0) this.animated.push(i);
    const fogDensity = opts.fogDensity ?? MOOD.fogDensity;
    if (tubes) {
      const m = tubes.material as THREE.MeshBasicMaterial;
      m.toneMapped = false;
      glowFog(m, MOOD.glowFog);
    }
    // Glow cards for every working fixture.
    this.glowIndex = new Int32Array(fixtures.length).fill(-1);
    this.glowUniforms = {uFogDensity: {value: fogDensity}, uFar: {value: opts.far ?? 70}, uIntensity: {value: MOOD.glow}};
    const working = fixtures.map((_, i) => i).filter(i => !fixtures[i].broken && fixtures[i].power > 0.01);
    if (working.length && MOOD.glow > 0) {
      const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMaterial(this.glowUniforms), working.length);
      const m4 = new THREE.Matrix4();
      working.forEach((fi, k) => {
        const f = fixtures[fi];
        this.glowIndex[fi] = k;
        im.setMatrixAt(k, m4.makeTranslation(f.x, f.y - 0.22, f.z));
        im.setColorAt(k, tmpColor.setRGB(0, 0, 0));
      });
      im.name = 'light-glow';
      im.renderOrder = 2;
      im.computeBoundingSphere();
      scene.add(im);
      this.glow = im;
    } else this.glow = null;
    for (let g = 0; g < 3; g++) this.levels[g] = groupLevel(g, 0);
    this.volume.setLevels(this.levels[0], this.levels[1], this.levels[2]);
    this.applyLevels(true);
  }

  dispose(scene: THREE.Scene = this.scene): void {
    scene.remove(this.volume);
    this.volume.dispose();
    if (this.glow) { scene.remove(this.glow); this.glow.geometry.dispose(); (this.glow.material as THREE.Material).dispose(); this.glow.dispose(); }
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
    this.volume.setLevels(this.levels[0], this.levels[1], this.levels[2]);
    this.applyLevels(false);
    if (cam) {
      const ai = this.layout.grid.areaAt(cam.x, cam.z);
      this.areaIndex = ai;
      const area: Area | undefined = this.layout.areas[ai >= 0 ? ai : this.layout.platform];
      this.profile = area?.lighting ?? 'lit';
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
      field: {w: this.field.w, h: this.field.h, layers: this.field.layers, cellScale: this.field.cellScale ?? 1, bakeMs: Math.round(st.ms), bytes: st.bytes, working: st.working},
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

/** Gentler fog for emissive tubes (they are light sources: they read further through the haze). */
export function glowFog(m: THREE.Material, factor: number): void {
  if (m.userData.glowFog === factor) return; // shared material: patch once
  m.userData.glowFog = factor;
  // Iteration 06: chained via render/shaderHooks.ts (keeps any earlier hook; the key joins the program cache key).
  addShaderHook(m, `glow-fog-${factor}`, sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment
      .replace('fogDensity * fogDensity * vFogDepth * vFogDepth', `fogDensity * fogDensity * vFogDepth * vFogDepth * ${(factor * factor).toFixed(4)}`));
  });
}

const GLOW_VERT = /* glsl */ `
uniform float uFogDensity;
uniform float uFar;
varying vec3 vColor;
varying vec2 vUv;
varying float vFade;
void main() {
	vec4 c = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	float dist = length( c.xyz );
	// Pull the card toward the camera so the ceiling does not slice it.
	c.xyz -= normalize( c.xyz ) * min( 0.6, dist * 0.25 );
	c.xy += position.xy * vec2( 1.5, 0.75 );
	gl_Position = projectionMatrix * c;
	vUv = uv;
	#ifdef USE_INSTANCING_COLOR
		vColor = instanceColor;
	#else
		vColor = vec3( 1.0 );
	#endif
	float fd = uFogDensity * ${MOOD.glowFog.toFixed(3)} * dist;
	vFade = exp( - fd * fd ) * smoothstep( 1.5, 5.0, dist ) * ( 1.0 - smoothstep( uFar * 0.75, uFar * 0.95, dist ) );
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec3 vColor;
varying vec2 vUv;
varying float vFade;
void main() {
	vec2 q = ( vUv - 0.5 ) * 2.0;
	float a = max( 0.0, exp( - dot( q, q ) * 3.0 ) - 0.05 );
	if ( a * vFade <= 0.0 ) discard;
	gl_FragColor = vec4( vColor * ( a * uIntensity * vFade ), 1.0 );
}`;

function glowMaterial(uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'light-glow', uniforms, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
  });
}
