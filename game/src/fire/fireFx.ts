// Task studio-flamethrower-fire-20261114-031614-01 (user: "convincing fire/smoke ... Fire clings to actual surfaces/props ... produces
// convincing smoke; reuse existing volumetrics where appropriate"): HOW THE FIRE LOOKS. fire/fireSystem.ts holds what burns (the stream,
// the clinging patches, burning props, burning bodies); this draws it, every frame, from that state — nothing here decides damage.
//
// LAYERS (five draws, all pooled rings: nothing allocates in play):
//  - FLAMES: one instanced sprite ring (additive). Each sprite is a flame LICK, not a disc: a teardrop mask broken up by two octaves of
//    scrolling noise and ERODED as it ages (the alpha threshold climbs: it tears into wisps and goes out), coloured by its own heat —
//    white-yellow where it is dense and young, orange, then deep red at the thinning tips. The stream (a jet from the lance that widens
//    to the stream cone and splashes along the surface it hits), the clinging patches (licks rising off the surface, tapering), burning
//    props (off their top and sides) and burning bodies all spawn into it; sparks are the same ring (tiny, hot, not eroded).
//  - SMOKE: a second sprite ring (normal blending): dark billows that rise off every fire's top, grow, tumble and thin out — lit
//    warm from below where they leave the flames, grey-brown above. Never green (green fog is the toxic gas: CLAUDE.md), no hazard.
//  - GLOW: instanced additive pools on the burning surface (floor, wall, ceiling, under a burning prop): the fire reads as ON it.
//  - SOOT: instanced dark marks the fire leaves on the surface (a bounded ring, fading over SOOT_SECONDS; never saved).
//  - VOLUMETRIC SMOKE + LIGHT (the existing atmosphere, render/volumetric.ts): the strongest fires near the player raise real smoke
//    plumes in the fog march (at most PLUMES of its 4 emitters), and ONE pooled fire light (a FlareLight: occluded by walls through the
//    atmosphere's window, like a flare's) lights the room and the smoke from the strongest fire, flickering. The light is created at
//    boot and stays in the scene at intensity 0 (the light set never changes: no recompiles). With the fog pass off the sprite smoke
//    and the light still show.
// All textures here are runtime DATA (noise): a dynamic effect (the texture rule's exemption), no authored art.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, PointsNodeMaterial} from 'three/webgpu';
import {Discard, Fn, attribute, cameraProjectionMatrix, cos, exp, float, instancedDynamicBufferAttribute, length, mix, positionView, select, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4} from 'three/tsl';
import {FlareLight} from '../world/flareLight';
import {FLAME} from './flamethrowerSpec';
import {patchRadius, patchStrength, type FireEnemy, type FirePatch, type FireSystem, type FireView} from './fireSystem';

// biome-ignore lint: loosely typed TSL nodes
type TNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const FIRE_FX = {
  flames: 768,
  smoke: 256,
  glows: 32,
  soot: 48,
  /** Seconds a soot mark stays (its last quarter fades). */
  sootSeconds: 80,
  /** Volumetric smoke plumes at once (of the atmosphere's 4 emitters: flares / lures keep the rest). */
  plumes: 2,
  /** Burning bodies drawn with flames at once. */
  bodies: 10,
  /** The fire light: warm orange, candela at a full fire, cutoff (m). */
  light: {color: 0xff7426, intensity: 15, distance: 13, decay: 2},
  /** The volumetric plume of a full fire (render/smoke.ts SmokeEmitterOptions): grey-brown, never green. */
  plume: {color: 0x5c554d, rate: 1.1, radius: 1.3, life: 5.5, density: 0.8},
} as const;

/** The atmosphere's smoke / scatter API (render/volumetric.ts), every member optional. */
export interface FireSmokeHost {
  addSmokeEmitter?(o: {x: number; y: number; z: number; color: number; rate: number; radius: number; life: number; density?: number}): FirePlume | null | undefined | void;
  addScatterLight?(light: THREE.PointLight): unknown;
  removeScatterLight?(light: THREE.PointLight): unknown;
}
interface FirePlume { setPos?(x: number, y: number, z: number): void; stop?(fade?: number): void }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Tileable value-noise fbm in R / G (two fields) and a finer one in B: the flames' and smoke's break-up (deterministic data). */
export function fireNoiseTexture(n = 128): THREE.DataTexture {
  let a = 0x5f3759df;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const field = (cells: number): Float32Array => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x / n * cells, fy = y / n * cells, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[(j % cells) * cells + (i % cells)];
      out[y * n + x] = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    }
    return out;
  };
  const fbm = (cells: readonly number[]): Float32Array => {
    const out = new Float32Array(n * n);
    let w = 1, sum = 0;
    for (const c of cells) { const f = field(c); for (let i = 0; i < out.length; i++) out[i] += f[i] * w; sum += w; w *= 0.5; }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { out[i] /= sum; lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo); // (full 0..1 range: the erosion thresholds are absolute)
    return out;
  };
  const R = fbm([4, 8, 16, 32]), G = fbm([5, 10, 20, 40]), B = fbm([16, 32, 64]);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) { data[i * 4] = Math.round(R[i] * 255); data[i * 4 + 1] = Math.round(G[i] * 255); data[i * 4 + 2] = Math.round(B[i] * 255); data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.name = 'fire-noise';
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

interface FogUniforms { mode: TNode; density: TNode; near: TNode; far: TNode; color: TNode }

/**
 * One ring of instanced sprites (world/fx.ts Particles' draw: a THREE.Sprite with `count = cap` + PointsNodeMaterial, per-instance
 * dynamic attributes), with what fire needs on top: age (erosion, the heat ramp), rotation, a noise seed.
 *   aA = (size m, age 0..1, rotation rad, seed)      aB = flames: (heat, erode 0..1, -, alpha); smoke: (r, g, b, alpha)
 */
class FireSprites {
  readonly points: THREE.Sprite;
  private readonly pos: Float32Array; private readonly vel: Float32Array;
  private readonly a: Float32Array; private readonly b: Float32Array;
  private readonly life: Float32Array; private readonly max: Float32Array;
  /** Per particle: size growth m/s, upward acceleration m/s2, drag 1/s, spin rad/s, peak alpha, fade-in share of its life. */
  private readonly par: Float32Array;
  private readonly attrs: {pos: THREE.InstancedBufferAttribute; a: THREE.InstancedBufferAttribute; b: THREE.InstancedBufferAttribute};
  private next = 0;
  live = 0;

  constructor(readonly cap: number, readonly kind: 'flame' | 'smoke', noise: THREE.Texture) {
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3);
    this.a = new Float32Array(cap * 4); this.b = new Float32Array(cap * 4);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.par = new Float32Array(cap * 6);
    const attr = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.attrs = {pos: attr(this.pos, 3), a: attr(this.a, 4), b: attr(this.b, 4)};
    const flame = kind === 'flame';
    const fogU: FogUniforms = {mode: uniform(0), density: uniform(0), near: uniform(1), far: uniform(1000), color: uniform(new THREE.Color())};
    const mat = new PointsNodeMaterial({transparent: true, depthWrite: false, blending: flame ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true});
    mat.name = flame ? 'fire-flames' : 'fire-smoke';
    const aPos = instancedDynamicBufferAttribute(this.attrs.pos as never) as TNode;
    const aA = instancedDynamicBufferAttribute(this.attrs.a as never) as TNode;
    const aB = instancedDynamicBufferAttribute(this.attrs.b as never) as TNode;
    mat.positionNode = aPos;
    const depth = (positionView as TNode).z.negate();
    mat.sizeNode = select(aB.w.greaterThan(0), aA.x.mul((cameraProjectionMatrix as TNode).element(1).y).mul(depth.div(depth.max(0.05))), float(0));
    mat.fog = false; // (applied below: additive flames fade to black, smoke mixes toward the fog colour)
    mat.colorNode = Fn(() => {
      const p0 = (uv() as TNode).sub(0.5);
      const c = cos(aA.z), s = sin(aA.z);
      const p = vec2(p0.x.mul(c).sub(p0.y.mul(s)), p0.x.mul(s).add(p0.y.mul(c))) as TNode;
      const age = aA.y;
      const seed = vec2(aA.w, aA.w.mul(1.618)) as TNode;
      const d = (positionView as TNode).z.negate();
      const ff = select(fogU.mode.greaterThan(1.5), smoothstep(fogU.near, fogU.far, d), select(fogU.mode.greaterThan(0.5), exp(fogU.density.mul(fogU.density).mul(d).mul(d).negate()).oneMinus(), float(0)));
      if (flame) {
        // a lick: wide at the foot, drawn to a point at the top (the sprite's +y), broken up by noise that scrolls up through it
        const px = p.x.div(float(1).sub(p.y.add(0.5).mul(0.55)).max(0.2));
        const mask = float(1).sub(length(vec2(px, p.y.mul(0.94))).mul(2)).clamp(0, 1);
        const n1 = (texture(noise, p.mul(0.5).add(seed).add(vec2(0, age.mul(-0.5)))) as TNode).r;
        const n2 = (texture(noise, p.mul(1.25).add(seed.mul(2.3)).add(vec2(0, age.mul(-1.1)))) as TNode).g;
        const v = mask.mul(n1.mul(0.7).add(n2.mul(0.45)).add(0.42));
        // erosion: the threshold climbs with age (sparks: erode 0 — a plain hot dot)
        const thr = age.mul(0.66).mul(aB.y);
        const al = smoothstep(thr, thr.add(0.2), v).mul(aB.w);
        Discard(al.lessThan(0.004));
        const heat = v.sub(thr).mul(1.7).add(float(1).sub(age).mul(0.22)).mul(aB.x);
        const red = vec3(0.6, 0.07, 0.012), orange = vec3(1.0, 0.36, 0.05), yellow = vec3(1.0, 0.7, 0.2), white = vec3(1.0, 0.92, 0.7);
        const col = mix(mix(mix(red, orange, smoothstep(0.05, 0.42, heat)), yellow, smoothstep(0.4, 0.8, heat)), white, smoothstep(0.8, 1.25, heat)) as TNode;
        return vec4(col.mul(1.15).mul(ff.oneMinus()), al);
      }
      // smoke: a soft billow with darker folds, thinning from the rim inward as it ages
      const mask = float(1).sub(length(p).mul(2)).clamp(0, 1);
      const n1 = (texture(noise, p.mul(0.6).add(seed).add(vec2(0, age.mul(-0.18)))) as TNode).r;
      const n2 = (texture(noise, p.mul(1.5).add(seed.mul(1.9))) as TNode).b;
      const v = mask.mul(n1.mul(0.9).add(n2.mul(0.35)).add(0.35));
      const thr = age.mul(0.42);
      const al = smoothstep(thr, thr.add(0.34), v).mul(aB.w);
      Discard(al.lessThan(0.004));
      const col = (aB.rgb as TNode).mul(n2.mul(0.55).add(0.6));
      return vec4(mix(col, fogU.color, ff), al);
    })();
    this.points = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial);
    this.points.name = flame ? 'fire-flames' : 'fire-smoke';
    this.points.count = cap;
    this.points.frustumCulled = false;
    this.points.renderOrder = flame ? 4 : 3; // (smoke under the flames' glow; both over the world's decals)
    this.points.visible = false;
    this.points.raycast = () => {};
    this.points.onBeforeRender = (_r, scene) => {
      const f = scene.fog as (THREE.Fog | THREE.FogExp2 | null);
      const u = fogU as unknown as Record<keyof FogUniforms, {value: number | THREE.Color}>;
      if (f && (f as THREE.FogExp2).isFogExp2) { u.mode.value = 1; u.density.value = (f as THREE.FogExp2).density; }
      else if (f && (f as THREE.Fog).isFog) { u.mode.value = 2; u.near.value = (f as THREE.Fog).near; u.far.value = (f as THREE.Fog).far; }
      else u.mode.value = 0;
      if (f) (u.color.value as THREE.Color).copy(f.color);
    };
  }

  /** `b0..b2`: flames (heat, erode, 0); smoke (r, g, b). `grow` m/s, `lift` m/s2 upward, `drag` 1/s, `fadeIn` share of its life. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, b0: number, b1: number, b2: number, alpha: number, grow: number, lift: number, drag: number, spin: number, fadeIn = 0.12): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (this.life[i] <= 0) this.live++;
    const j = i * 3, k = i * 4, q = i * 6;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.a[k] = size; this.a[k + 1] = 0; this.a[k + 2] = this.kind === 'flame' ? rnd(-0.5, 0.5) : rnd(0, Math.PI * 2); this.a[k + 3] = Math.random() * 7;
    this.b[k] = b0; this.b[k + 1] = b1; this.b[k + 2] = b2; this.b[k + 3] = 0.0001;
    this.life[i] = this.max[i] = life;
    this.par[q] = grow; this.par[q + 1] = lift; this.par[q + 2] = drag; this.par[q + 3] = spin; this.par[q + 4] = alpha; this.par[q + 5] = fadeIn;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (this.live <= 0) { if (this.points.visible) this.points.visible = false; return; }
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 4;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.b[k + 3] = 0; continue; }
      live++;
      const j = i * 3, q = i * 6, dr = Math.max(0, 1 - this.par[q + 2] * dt);
      this.vel[j] *= dr; this.vel[j + 2] *= dr;
      this.vel[j + 1] = this.vel[j + 1] * dr + this.par[q + 1] * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const age = 1 - this.life[i] / this.max[i];
      this.a[k] = Math.max(0.01, this.a[k] + this.par[q] * dt);
      this.a[k + 1] = age;
      this.a[k + 2] += this.par[q + 3] * dt;
      this.b[k + 3] = this.par[q + 4] * Math.min(1, age / this.par[q + 5]) * Math.min(1, (1 - age) * 4);
    }
    this.live = live;
    this.attrs.pos.needsUpdate = this.attrs.a.needsUpdate = this.attrs.b.needsUpdate = true;
    if (live === 0) this.points.visible = false;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < this.cap; i++) this.b[i * 4 + 3] = 0;
    this.live = 0;
    this.attrs.b.needsUpdate = true;
    this.points.visible = false;
  }
}

const Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Instanced marks lying on surfaces: the fires' glow (additive, per-frame) or the soot they leave (a fading ring). */
class SurfaceMarks {
  readonly mesh: THREE.InstancedMesh;
  readonly fade: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4(); private readonly q = new THREE.Quaternion(); private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3(); private readonly s = new THREE.Vector3(); private readonly nrm = new THREE.Vector3();

  constructor(readonly cap: number, glow: boolean, noise: THREE.Texture, time: TNode) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    const mat = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: glow ? -6 : -3,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending});
    mat.name = glow ? 'fire-glow' : 'fire-soot';
    const p = (uv() as TNode).sub(0.5), r = length(p).mul(2), fade = attribute('aFade', 'float') as TNode;
    if (glow) {
      // a hot pool on the surface: bright at the heart, breaking up toward the rim, crawling
      const n = (texture(noise, p.mul(0.9).add(vec2(time.mul(0.11), time.mul(-0.17)))) as TNode).r.mul(0.6).add((texture(noise, p.mul(2.1).add(vec2(time.mul(-0.2), time.mul(0.13)))) as TNode).g.mul(0.4));
      const core = float(1).sub(r).clamp(0, 1);
      const al = core.mul(core).mul(n.mul(1.1).add(0.35)).mul(fade);
      mat.colorNode = mix(vec3(1.0, 0.3, 0.04), vec3(1.0, 0.62, 0.16), core.mul(n).clamp(0, 1));
      mat.opacityNode = al.clamp(0, 1);
      mat.fog = false;
    } else {
      // soot: an irregular dark stain, densest in the middle
      const n = (texture(noise, p.mul(0.8)) as TNode).g.mul(0.65).add((texture(noise, p.mul(2.4)) as TNode).b.mul(0.35));
      const al = smoothstep(0.12, 0.62, float(1).sub(r).clamp(0, 1).mul(n.mul(1.25).add(0.35))).mul(0.8).mul(fade);
      mat.colorNode = vec3(0.012, 0.01, 0.009);
      mat.opacityNode = al.clamp(0, 1);
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = glow ? 'fire-glows' : 'fire-soot';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = glow ? 2 : 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
  }

  /** Instance i lies on the surface at (x, y, z) with outward normal n, `size` m across, turned `yaw` about the normal. */
  set(i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, yaw: number, fade: number, lift = 0.012): void {
    this.q.setFromUnitVectors(Z, this.nrm.set(nx, ny, nz));
    this.q.multiply(this.q2.setFromAxisAngle(Z, yaw));
    this.m.compose(this.v.set(x + nx * lift, y + ny * lift, z + nz * lift), this.q, this.s.set(size, size, 1));
    this.mesh.setMatrixAt(i, this.m);
    this.fade.setX(i, fade);
  }

  hide(i: number): void {
    this.mesh.setMatrixAt(i, ZERO);
    this.fade.setX(i, 0);
  }

  commit(any: boolean): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
    this.mesh.visible = any;
  }
}

interface Plume { h: FirePlume; x: number; y: number; z: number; idle: number }

/** What the frame needs from the Game besides the fire state. */
export interface FireFrame {
  /** The lance's muzzle in the world while the flamethrower is in the hands (null: not held). */
  muzzle: {x: number; y: number; z: number} | null;
  /** The pilot flame burns (held, a worn tank with fuel). */
  pilot: boolean;
  /** The camera (the light / plumes follow the fires nearest it). */
  eye: {x: number; y: number; z: number};
}

export class FireFx implements FireView {
  readonly group = new THREE.Group();
  readonly light: FlareLight;
  smoke: FireSmokeHost | null = null;
  private readonly noise = fireNoiseTexture();
  private readonly time = uniform(0);
  private readonly flames: FireSprites;
  private readonly puffs: FireSprites;
  private readonly glows: SurfaceMarks;
  private readonly soot: SurfaceMarks;
  /** Soot ring: birth clock per slot (0: free), the slot written next. */
  private readonly sootBorn = new Float32Array(FIRE_FX.soot);
  private sootNext = 0;
  private sootT = 0;
  private clock = 0;
  /** Fractional particles owed per source since the last frame (one accumulator per kind: a source's share is its rate x dt). */
  private readonly owed = new Map<object, {f: number; s: number; e: number}>();
  private streamOwed = 0; private splashOwed = 0; private pilotOwed = 0;
  private readonly plumes: Plume[] = [];
  private lit = false;
  private level = 0;
  private readonly lightAt = new THREE.Vector3();
  private readonly tv = new THREE.Vector3(); private readonly tu = new THREE.Vector3(); private readonly tw = new THREE.Vector3();
  /** QA / tests. */
  readonly counts = {flames: 0, smoke: 0, sparks: 0, soot: 0, bursts: 0, plumes: 0};

  constructor(parent: THREE.Object3D) {
    this.group.name = 'fire-fx';
    this.flames = new FireSprites(FIRE_FX.flames, 'flame', this.noise);
    this.puffs = new FireSprites(FIRE_FX.smoke, 'smoke', this.noise);
    this.glows = new SurfaceMarks(FIRE_FX.glows, true, this.noise, this.time);
    this.soot = new SurfaceMarks(FIRE_FX.soot, false, this.noise, this.time);
    this.group.add(this.soot.mesh, this.glows.mesh, this.puffs.points, this.flames.points);
    parent.add(this.group);
    const l = FIRE_FX.light;
    this.light = new FlareLight(l.color, 0, l.distance, l.decay);
    this.light.name = 'fire-light';
    this.light.castShadow = false;
    parent.add(this.light);
  }

  /** The station warm-up compiles these (hidden until something burns). */
  warmRoots(): THREE.Object3D[] {
    return [this.group];
  }

  get live(): {flames: number; smoke: number} {
    return {flames: this.flames.live, smoke: this.puffs.live};
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // FireView (the rules' cues)

  scorch(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number): void {
    const i = this.sootNext;
    this.sootNext = (this.sootNext + 1) % FIRE_FX.soot;
    this.sootBorn[i] = this.clock + 1e-3;
    this.soot.set(i, x, y, z, nx, ny, nz, r * 2.3, Math.random() * Math.PI * 2, 0, 0.006);
    this.soot.commit(true);
    this.counts.soot++;
  }

  burst(x: number, y: number, z: number, size: number): void {
    this.counts.bursts++;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.6, 2.2) * size;
      this.flame(x + Math.cos(a) * size * 0.3, y + rnd(-0.1, 0.25), z + Math.sin(a) * size * 0.3, Math.cos(a) * sp, rnd(1.2, 2.8), Math.sin(a) * sp, rnd(0.4, 0.75) * size, rnd(0.35, 0.65), 1, 1, 0.8, -0.2, 1.5, 2.5);
    }
    for (let i = 0; i < 12; i++) this.spark(x + rnd(-0.3, 0.3) * size, y + rnd(0, 0.3), z + rnd(-0.3, 0.3) * size, 2.2);
    for (let i = 0; i < 3; i++) this.puff(x + rnd(-0.2, 0.2), y + rnd(0.3, 0.6), z + rnd(-0.2, 0.2), 1, 1);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Spawners

  private flame(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, heat: number, erode: number, alpha: number, grow: number, lift: number, drag: number): void {
    this.flames.spawn(x, y, z, vx, vy, vz, size, life, heat, erode, 0, alpha, grow, lift, drag, rnd(-1.2, 1.2), 0.1);
    this.counts.flames++;
  }

  private spark(x: number, y: number, z: number, speed: number): void {
    const a = Math.random() * Math.PI * 2, h = rnd(0.15, 0.7) * speed;
    this.flames.spawn(x, y, z, Math.cos(a) * h, rnd(0.8, 1.6) * speed, Math.sin(a) * h, rnd(0.03, 0.055), rnd(0.7, 1.5), 1.5, 0, 0, 1, -0.012, -1.6, 0.9, 0, 0.02);
    this.counts.sparks++;
  }

  /** A smoke billow leaving a fire of strength k: warm-lit where `glow` is high (just over the flames), grey-brown otherwise. */
  private puff(x: number, y: number, z: number, k: number, glow: number): void {
    const g = 0.5 * glow, d = rnd(0.085, 0.13);
    this.puffs.spawn(x, y, z, rnd(-0.18, 0.18), rnd(0.75, 1.25), rnd(-0.18, 0.18), rnd(0.5, 0.8), rnd(2.6, 4.2),
      d + 0.34 * g, d * 0.95 + 0.13 * g, d * 0.9 + 0.03 * g, rnd(0.34, 0.5) * (0.5 + 0.5 * k), rnd(0.35, 0.6), 0.12, 0.5, rnd(-0.5, 0.5), 0.18);
    this.counts.smoke++;
  }

  private share(key: object): {f: number; s: number; e: number} {
    let o = this.owed.get(key);
    if (!o) this.owed.set(key, (o = {f: Math.random(), s: Math.random(), e: Math.random()}));
    return o;
  }

  // ---------------------------------------------------------------------------------------------------------------------

  /** One frame: spawn from everything that burns, move the rings, lay the glow, age the soot, drive the light and the plumes. */
  frame(dt: number, sys: FireSystem, view: FireFrame): void {
    const step = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    (this.time as unknown as {value: number}).value = this.clock;
    const busy = sys.active || !!view.muzzle;
    if (busy && step > 0) {
      if (view.muzzle && sys.stream.on) this.jet(step, sys, view.muzzle);
      else { this.streamOwed = 0; this.splashOwed = 0; }
      if (view.muzzle && view.pilot && !sys.stream.on) this.pilot(step, sys, view.muzzle);
      for (const p of sys.patches) this.patch(step, p);
      for (const b of sys.burns) this.prop(step, b);
      let n = 0;
      for (const z of sys.alight.keys()) { if (z.nonGraphic || !z.brain.alive) continue; if (n++ >= FIRE_FX.bodies) break; this.body(step, z); }
      if (this.owed.size > 96) this.prune(sys);
    }
    this.flames.update(step);
    this.puffs.update(step);
    this.lay(sys);
    this.ageSoot(step);
    this.lightUp(step, sys, view.eye);
    this.plume(step, sys);
  }

  /** The stream: a jet of flame from the lance to where it stops, widening to the cone; it splashes along a surface it hits. */
  private jet(dt: number, sys: FireSystem, m: {x: number; y: number; z: number}): void {
    const s = sys.stream;
    // from the muzzle toward the point the aim ray reaches
    const tx = s.ox + s.dx * s.reach, ty = s.oy + s.dy * s.reach, tz = s.oz + s.dz * s.reach;
    const d = this.tv.set(tx - m.x, ty - m.y, tz - m.z), dist = d.length();
    if (dist < 0.05) return;
    d.multiplyScalar(1 / dist);
    // a basis across the jet
    const u = this.tu.set(d.z, 0, -d.x);
    if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
    u.normalize();
    const w = this.tw.crossVectors(d, u);
    const endSize = Math.max(0.5, (FLAME.radius0 + (FLAME.radius1 - FLAME.radius0) * (s.reach / FLAME.range)) * 2.3);
    this.streamOwed += dt * 150;
    while (this.streamOwed >= 1) {
      this.streamOwed -= 1;
      const sp = FLAME.speed * rnd(0.82, 1.08), life = Math.max(0.06, dist / sp);
      const ja = Math.random() * Math.PI * 2, jr = Math.sqrt(Math.random()) * 0.055;
      const vx = (d.x + (u.x * Math.cos(ja) + w.x * Math.sin(ja)) * jr) * sp, vy = (d.y + (u.y * Math.cos(ja) + w.y * Math.sin(ja)) * jr) * sp, vz = (d.z + (u.z * Math.cos(ja) + w.z * Math.sin(ja)) * jr) * sp;
      const lead = Math.random() * dt * sp; // (spread along this frame's travel: no beads at low frame rates)
      const size0 = rnd(0.1, 0.16);
      this.flame(m.x + d.x * lead, m.y + d.y * lead, m.z + d.z * lead, vx, vy, vz, size0, life, rnd(0.95, 1.2), 0.85, 0.62, (endSize * rnd(0.8, 1.15) - size0) / life, 0.9, 0);
    }
    if (s.kind !== 'none') {
      // the splash: flame running out along the surface from where the jet lands, and curling off it
      const n = this.tv.set(s.nx, s.ny, s.nz);
      const t1 = this.tu.set(n.y, -n.x, 0);
      if (t1.lengthSq() < 1e-4) t1.set(0, n.z, -n.y);
      t1.normalize();
      const t2 = this.tw.crossVectors(n, t1);
      this.splashOwed += dt * 55;
      while (this.splashOwed >= 1) {
        this.splashOwed -= 1;
        const a = Math.random() * Math.PI * 2, sp = rnd(1.6, 4.2), off = rnd(0.25, 1.1);
        const cx = Math.cos(a), cz = Math.sin(a);
        this.flame(tx + n.x * 0.08, ty + n.y * 0.08, tz + n.z * 0.08, (t1.x * cx + t2.x * cz) * sp + n.x * off, (t1.y * cx + t2.y * cz) * sp + n.y * off + 0.9, (t1.z * cx + t2.z * cz) * sp + n.z * off,
          rnd(0.32, 0.6), rnd(0.28, 0.5), rnd(0.9, 1.1), 1, 0.7, 0.5, 2.2, 3.2);
      }
      if (Math.random() < dt * 9) this.spark(tx + n.x * 0.1, ty + n.y * 0.1, tz + n.z * 0.1, 1.6);
      if (Math.random() < dt * 5) this.puff(tx + n.x * 0.3 + rnd(-0.2, 0.2), ty + 0.5, tz + n.z * 0.3 + rnd(-0.2, 0.2), 0.8, 1);
    }
  }

  /** The pilot flame at the burner while the lance is held and fuelled. */
  private pilot(dt: number, sys: FireSystem, m: {x: number; y: number; z: number}): void {
    this.pilotOwed += dt * 26;
    const s = sys.stream;
    while (this.pilotOwed >= 1) {
      this.pilotOwed -= 1;
      this.flame(m.x + rnd(-0.004, 0.004), m.y + rnd(-0.004, 0.004), m.z + rnd(-0.004, 0.004), s.dx * 0.25 + rnd(-0.03, 0.03), 0.3, s.dz * 0.25 + rnd(-0.03, 0.03), rnd(0.035, 0.05), rnd(0.1, 0.16), 0.75, 0.9, 0.7, -0.08, 0.4, 0);
    }
  }

  /** A clinging patch: licks rising off its surface (tapering as they climb), sparks, smoke from its top. */
  private patch(dt: number, p: FirePatch): void {
    const k = patchStrength(p);
    if (k <= 0.02) return;
    const o = this.share(p), r = patchRadius(p);
    const floor = p.face === 'floor', ceil = p.face === 'ceiling';
    // a basis in the surface
    const t1 = this.tu.set(p.ny, -p.nx, 0);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = this.tw.set(p.ny * t1.z - p.nz * t1.y, p.nz * t1.x - p.nx * t1.z, p.nx * t1.y - p.ny * t1.x);
    o.f += dt * (6 + 15 * k);
    while (o.f >= 1) {
      o.f -= 1;
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.85, ca = Math.cos(a) * d, sa = Math.sin(a) * d;
      const x = p.x + t1.x * ca + t2.x * sa + p.nx * 0.06, y = p.y + t1.y * ca + t2.y * sa + p.ny * 0.06, z = p.z + t1.z * ca + t2.z * sa + p.nz * 0.06;
      const edge = 1 - 0.45 * (d / Math.max(0.01, r)); // (taller in the middle)
      if (ceil) this.flame(x, y - 0.05, z, Math.cos(a) * rnd(0.5, 1.1), -0.05, Math.sin(a) * rnd(0.5, 1.1), rnd(0.3, 0.5) * (0.6 + 0.4 * k), rnd(0.4, 0.7), rnd(0.75, 1), 1, 0.75, 0.2, 0.3, 1.2);
      else this.flame(x, y + (floor ? 0.05 : 0), z, p.nx * 0.3 + rnd(-0.12, 0.12), rnd(0.9, 1.7) * (0.55 + 0.45 * k) * edge, p.nz * 0.3 + rnd(-0.12, 0.12),
        rnd(0.3, 0.52) * (0.6 + 0.4 * k), rnd(0.45, 0.85), rnd(0.8, 1.1), 1, 0.8, -0.22, 1.3, 0.6);
    }
    o.e += dt * 1.3 * k;
    while (o.e >= 1) { o.e -= 1; this.spark(p.x + rnd(-r, r) * 0.6, p.y + 0.15, p.z + rnd(-r, r) * 0.6, 1.3); }
    o.s += dt * (0.5 + 1.5 * k);
    while (o.s >= 1) { o.s -= 1; this.puff(p.x + p.nx * 0.2 + rnd(-r, r) * 0.45, p.y + (ceil ? -0.15 : rnd(0.55, 0.95) * (0.5 + 0.5 * k)), p.z + p.nz * 0.2 + rnd(-r, r) * 0.45, k, 1); }
  }

  /** A burning prop: flames off its top and up its sides, sparks, heavy smoke; dying down as it collapses. */
  private prop(dt: number, b: {id: object; box: {min: {x: number; y: number; z: number}; max: {x: number; y: number; z: number}}; age: number; seconds: number}): void {
    const o = this.share(b.id), t = b.age / b.seconds;
    const up = Math.min(1, t * 5), down = 1 - Math.max(0, (t - 0.68) / 0.32) * 0.75; // (catches fast; sinks with the collapse)
    const w = b.box.max.x - b.box.min.x, dp = b.box.max.z - b.box.min.z, h = (b.box.max.y - b.box.min.y) * (t > 0.62 ? 1 - 0.9 * Math.min(1, (t - 0.62) / 0.38) : 1);
    const area = Math.max(0.1, w * dp);
    o.f += dt * Math.max(14, Math.min(48, 12 + 26 * area + 8 * h)) * up * down;
    while (o.f >= 1) {
      o.f -= 1;
      let x: number, y: number, z: number;
      if (Math.random() < 0.55) { x = rnd(b.box.min.x, b.box.max.x); z = rnd(b.box.min.z, b.box.max.z); y = b.box.min.y + h; }
      else {
        const side = Math.floor(Math.random() * 4);
        x = side === 0 ? b.box.min.x - 0.04 : side === 1 ? b.box.max.x + 0.04 : rnd(b.box.min.x, b.box.max.x);
        z = side === 2 ? b.box.min.z - 0.04 : side === 3 ? b.box.max.z + 0.04 : rnd(b.box.min.z, b.box.max.z);
        y = b.box.min.y + h * rnd(0.1, 0.95);
      }
      this.flame(x, y, z, rnd(-0.15, 0.15), rnd(1.1, 2.1), rnd(-0.15, 0.15), rnd(0.36, 0.7), rnd(0.5, 0.95), rnd(0.85, 1.15), 1, 0.82, -0.22, 1.5, 0.6);
    }
    o.e += dt * 3.5 * up * down;
    while (o.e >= 1) { o.e -= 1; this.spark(rnd(b.box.min.x, b.box.max.x), b.box.min.y + h, rnd(b.box.min.z, b.box.max.z), 1.7); }
    o.s += dt * 3.2 * up;
    while (o.s >= 1) { o.s -= 1; this.puff(rnd(b.box.min.x, b.box.max.x), b.box.min.y + h + rnd(0.5, 0.9), rnd(b.box.min.z, b.box.max.z), 1, 1); }
  }

  /** A burning body: flames about its trunk (never on a non-graphic body: the caller filters). */
  private body(dt: number, z: FireEnemy): void {
    const o = this.share(z), b = z.brain, r = b.stats.radius, h = b.stats.height ?? 1.7;
    o.f += dt * 11;
    while (o.f >= 1) {
      o.f -= 1;
      const a = Math.random() * Math.PI * 2, d = r * rnd(0.3, 0.9);
      this.flame(b.x + Math.cos(a) * d, b.y + h * rnd(0.3, 0.85), b.z + Math.sin(a) * d, rnd(-0.1, 0.1), rnd(0.9, 1.6), rnd(-0.1, 0.1), rnd(0.24, 0.42), rnd(0.32, 0.58), rnd(0.8, 1.05), 1, 0.78, -0.2, 1.2, 0.8);
    }
    o.s += dt * 0.9;
    while (o.s >= 1) { o.s -= 1; this.puff(b.x, b.y + h + 0.2, b.z, 0.6, 0.8); }
  }

  /** Spawn accumulators of sources that are gone. */
  private prune(sys: FireSystem): void {
    const keep = new Set<object>(sys.patches);
    for (const b of sys.burns) keep.add(b.id);
    for (const z of sys.alight.keys()) keep.add(z);
    for (const k of this.owed.keys()) if (!keep.has(k)) this.owed.delete(k);
  }

  /** The glow pools: one under / on every patch and under every burning prop. */
  private lay(sys: FireSystem): void {
    let i = 0;
    const cap = FIRE_FX.glows;
    for (const p of sys.patches) {
      if (i >= cap) break;
      const k = patchStrength(p);
      if (k <= 0.02) continue;
      const fl = 0.8 + 0.2 * Math.sin(this.clock * 9 + p.id * 1.7) * Math.sin(this.clock * 5.3 + p.id);
      this.glows.set(i++, p.x, p.y, p.z, p.nx, p.ny, p.nz, patchRadius(p) * 2.5, p.id * 2.4, Math.min(1, 0.25 + k) * fl);
    }
    for (const b of sys.burns) {
      if (i >= cap) break;
      const t = b.age / b.seconds, size = Math.max(b.box.max.x - b.box.min.x, b.box.max.z - b.box.min.z) * 1.5 + 0.7;
      this.glows.set(i++, b.base.x, b.base.y, b.base.z, 0, 1, 0, size, 0.7, Math.min(1, t * 4) * (0.85 + 0.15 * Math.sin(this.clock * 8)));
    }
    const any = i > 0;
    if (!any && !this.glows.mesh.visible) return;
    for (; i < cap; i++) this.glows.hide(i);
    this.glows.commit(any);
  }

  private ageSoot(dt: number): void {
    this.sootT += dt;
    if (this.sootT < 0.5 || !this.soot.mesh.visible) return;
    this.sootT = 0;
    let any = false;
    for (let i = 0; i < FIRE_FX.soot; i++) {
      const born = this.sootBorn[i];
      if (born <= 0) continue;
      const age = this.clock - born;
      if (age >= FIRE_FX.sootSeconds) { this.sootBorn[i] = 0; this.soot.hide(i); continue; }
      any = true;
      // (it darkens in over the fire's first seconds — the flames hide it — and fades over its last quarter)
      this.soot.fade.setX(i, Math.min(1, age / 3) * Math.min(1, (FIRE_FX.sootSeconds - age) / (FIRE_FX.sootSeconds * 0.25)));
    }
    this.soot.commit(any);
  }

  /** The fire light sits over the strongest fire near the camera; its level follows the fire there, flickering. */
  private lightUp(dt: number, sys: FireSystem, eye: {x: number; y: number; z: number}): void {
    let best = 0, bx = 0, by = 0, bz = 0, total = 0;
    const consider = (x: number, y: number, z: number, level: number) => {
      const sc = level / (1 + 0.03 * ((x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2));
      if (sc > best) { best = sc; bx = x; by = y; bz = z; }
    };
    for (const p of sys.patches) { const k = patchStrength(p); if (k > 0.05) consider(p.x + p.nx * 0.4, p.y + p.ny * 0.4 + (p.face === 'ceiling' ? -0.2 : 0.35), p.z + p.nz * 0.4, k); }
    for (const b of sys.burns) consider(b.base.x, b.box.max.y + 0.3, b.base.z, 1.2);
    if (best > 0) {
      // (everything burning within 3.5 m of it adds to it, up to a ceiling)
      for (const p of sys.patches) if (Math.hypot(p.x - bx, p.y - by, p.z - bz) < 3.5) total += patchStrength(p);
      for (const b of sys.burns) if (Math.hypot(b.base.x - bx, b.base.y - by, b.base.z - bz) < 3.5) total += 1.2;
    }
    const target = best > 0 ? Math.min(1.7, 0.35 + 0.5 * total) : 0;
    if (best > 0) {
      // (a far jump: straight there while dark, else ease — the window the atmosphere computes follows the light)
      if (this.level < 0.05 || this.lightAt.distanceToSquared(this.tv.set(bx, by, bz)) > 36) this.lightAt.set(bx, by, bz);
      else this.lightAt.lerp(this.tv.set(bx, by, bz), Math.min(1, dt * 5));
      this.light.position.copy(this.lightAt);
    }
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 9 : 4));
    if (this.level < 0.01 && target === 0) {
      if (this.lit) { this.lit = false; this.light.intensity = 0; this.smoke?.removeScatterLight?.(this.light); this.light.clearWindow(); }
      this.level = 0;
      return;
    }
    if (!this.lit) { this.lit = true; this.smoke?.addScatterLight?.(this.light); }
    const fl = 0.86 + 0.09 * Math.sin(this.clock * 11.3) + 0.07 * Math.sin(this.clock * 23.7 + 1.3) + 0.05 * Math.sin(this.clock * 4.1);
    this.light.intensity = FIRE_FX.light.intensity * this.level * fl;
  }

  /** Real smoke in the fog march over the strongest fires (the atmosphere's emitters; at most FIRE_FX.plumes). */
  private plume(dt: number, sys: FireSystem): void {
    const host = this.smoke;
    for (const pl of this.plumes) pl.idle += dt;
    if (host?.addSmokeEmitter) {
      let used = 0;
      for (const v of sys.spots) {
        if (v.level < 0.45 || used >= FIRE_FX.plumes) continue;
        used++;
        let pl = this.plumes.find(q => Math.hypot(q.x - v.x, q.z - v.z) < 3 && Math.abs(q.y - v.y) < 2.5);
        if (!pl) {
          if (this.plumes.length >= FIRE_FX.plumes) continue;
          const c = FIRE_FX.plume;
          const h = host.addSmokeEmitter({x: v.x, y: v.y + 0.6, z: v.z, color: c.color, rate: c.rate, radius: c.radius, life: c.life, density: c.density});
          if (!h) continue;
          this.plumes.push((pl = {h, x: v.x, y: v.y, z: v.z, idle: 0}));
          this.counts.plumes++;
        } else if (Math.hypot(pl.x - v.x, pl.y - v.y, pl.z - v.z) > 0.5) { pl.x = v.x; pl.y = v.y; pl.z = v.z; pl.h.setPos?.(v.x, v.y + 0.6, v.z); }
        pl.idle = 0;
      }
    }
    for (let i = this.plumes.length - 1; i >= 0; i--) if (this.plumes[i].idle > 0.6) { this.plumes[i].h.stop?.(3); this.plumes.splice(i, 1); }
  }

  /** Everything gone at once (section teardown): rings emptied, glow / soot hidden, the light off, the plumes dropped. */
  clear(): void {
    this.flames.clear();
    this.puffs.clear();
    for (let i = 0; i < FIRE_FX.glows; i++) this.glows.hide(i);
    this.glows.commit(false);
    for (let i = 0; i < FIRE_FX.soot; i++) this.soot.hide(i);
    this.sootBorn.fill(0);
    this.soot.commit(false);
    this.owed.clear();
    this.streamOwed = this.splashOwed = this.pilotOwed = 0;
    for (const pl of this.plumes) pl.h.stop?.(0);
    this.plumes.length = 0;
    if (this.lit) { this.lit = false; this.smoke?.removeScatterLight?.(this.light); }
    this.light.intensity = 0;
    this.light.clearWindow();
    this.level = 0;
  }
}
