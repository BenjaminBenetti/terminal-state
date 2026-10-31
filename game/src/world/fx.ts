// Pooled hit feedback with bounded draw calls regardless of load:
//  - GPU point particles (2 draw calls): dust/debris/blood/smoke (alpha) + sparks/embers (additive)
//  - instanced, age-fading decals (<= 4 draw calls): bullet holes per surface + blood splats
//  - one LineSegments buffer for tracers (1 draw call)
// All pools are fixed-size rings: the oldest entry is recycled, nothing grows.
// Iteration 06 (Lane D): world / prop hits come through src/damage/system.ts, which adds persistent
// craters / per-instance prop damage and physical debris; impact() then only adds dust, sparks and
// small particle chips (decal: false where a persistent mark exists; glass / soft styles added).

import * as THREE from 'three';
import {LineBasicNodeMaterial, MeshLambertNodeMaterial, PointsNodeMaterial} from 'three/webgpu';
import {Discard, Fn, attribute, cameraProjectionMatrix, exp, float, instancedDynamicBufferAttribute, materialOpacity, mix, positionView, select, smoothstep, texture, uniform, uv, vec4} from 'three/tsl';
import {canvasTexture} from './canvasTextures';

export type FxSurface = 'concrete' | 'tile' | 'metal' | 'flesh' | 'wood' | 'glass' | 'soft';

/** Iteration 06 (Lane D): per-hit overrides from the damage system (persistent marks replace decals). */
export interface ImpactOptions {
  /** Place the pooled bullet-hole decal (default true; false where a crater / shader mark exists). */
  decal?: boolean;
  /** Particle chip count override (the damage system spawns real physical debris instead). */
  chips?: number;
  /** Dust puff multiplier and colour override (sampled surface colour). */
  dust?: number;
  dustColor?: THREE.Color;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// biome-ignore lint: loosely typed TSL nodes
type TNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Iteration 13 (MAT-B): the particle ring as ONE instanced sprite draw on WebGPURenderer (was a GLSL ShaderMaterial on
 * THREE.Points: WebGPU — and three's WebGL 2 node backend — rasterise points at 1 px, so `gl_PointSize` cannot carry).
 * A THREE.Sprite with `count = cap` + PointsNodeMaterial draws a camera-facing quad per particle from per-instance
 * attributes. Same look as the GLSL: screen size = aSize * P[1][1] * (viewport height / 2) / depth (PointsNodeMaterial
 * supplies height / 2 / depth, sizeNode the aSize * P[1][1]), dead particles (alpha 0) collapse to nothing, the soft
 * disc texture x colour, alpha cut at 0.004, and the scene fog by view depth of the particle centre (exp2 or linear):
 * mixed toward the fog colour, or for the ADDITIVE ring faded to black (adding fog colour would brighten the haze).
 */
function particleMaterial(tex: THREE.Texture, additive: boolean, attrs: {pos: THREE.InstancedBufferAttribute; col: THREE.InstancedBufferAttribute; size: THREE.InstancedBufferAttribute; alpha: THREE.InstancedBufferAttribute}, fogU: ParticleFog): PointsNodeMaterial {
  const mat = new PointsNodeMaterial({transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true});
  mat.name = additive ? 'fx-particles-additive' : 'fx-particles';
  const aPos = instancedDynamicBufferAttribute(attrs.pos as never) as TNode;
  const aCol = instancedDynamicBufferAttribute(attrs.col as never) as TNode;
  const aSize = instancedDynamicBufferAttribute(attrs.size as never) as TNode;
  const aAlpha = instancedDynamicBufferAttribute(attrs.alpha as never) as TNode;
  mat.positionNode = aPos;
  // PointsNodeMaterial divides by the raw view depth; the GLSL clamped it at 5 cm (a puff crossing the eye never fills the screen)
  const depth = (positionView as TNode).z.negate();
  mat.sizeNode = select(aAlpha.greaterThan(0), aSize.mul((cameraProjectionMatrix as TNode).element(1).y).mul(depth.div(depth.max(0.05))), float(0));
  mat.fog = false; // applied below (additive rings fade to black instead of mixing toward the fog colour)
  mat.colorNode = Fn(() => {
    const t = texture(tex, uv()) as TNode;
    const a = t.a.mul(aAlpha);
    Discard(a.lessThan(0.004));
    const rgb = aCol.mul(t.rgb);
    const d = (positionView as TNode).z.negate();
    const ff = select(fogU.mode.greaterThan(1.5), smoothstep(fogU.near, fogU.far, d), select(fogU.mode.greaterThan(0.5), exp(fogU.density.mul(fogU.density).mul(d).mul(d).negate()).oneMinus(), float(0)));
    const fogged = additive ? rgb.mul(ff.oneMinus()) : mix(rgb, fogU.color, ff);
    return vec4(fogged, a);
  })();
  return mat;
}

/** Scene fog as seen by the particle shader (FogExp2: mode 1, density; Fog: mode 2, near / far). */
interface ParticleFog { mode: TNode; density: TNode; near: TNode; far: TNode; color: TNode }

/** Fixed-capacity point particle ring rendered in one draw call. */
class Particles {
  /** Iteration 13 (MAT-B): an instanced sprite (one quad per particle), not THREE.Points. */
  readonly points: THREE.Sprite;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly grow: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly a0: Float32Array;
  private readonly attrs: Record<'position' | 'aSize' | 'aAlpha' | 'aColor', THREE.InstancedBufferAttribute>;
  private next = 0;
  live = 0;

  constructor(readonly cap: number, tex: THREE.Texture, additive: boolean) {
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    const attr = (arr: Float32Array, n: number) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.attrs = {position: attr(this.pos, 3), aColor: attr(this.col, 3), aSize: attr(this.size, 1), aAlpha: attr(this.alpha, 1)};
    const fogU: ParticleFog = {mode: uniform(0), density: uniform(0), near: uniform(1), far: uniform(1000), color: uniform(new THREE.Color())};
    const mat = particleMaterial(tex, additive, {pos: this.attrs.position, col: this.attrs.aColor, size: this.attrs.aSize, alpha: this.attrs.aAlpha}, fogU);
    this.points = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial);
    this.points.name = additive ? 'fx-sparks' : 'fx-particles';
    this.points.count = cap;
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this.points.visible = false;
    this.points.raycast = () => {}; // never a hitscan / pick target (Sprite.raycast needs raycaster.camera)
    this.points.onBeforeRender = (_r, scene) => {
      const f = scene.fog as (THREE.Fog | THREE.FogExp2 | null);
      const u = fogU as unknown as Record<keyof ParticleFog, {value: number | THREE.Color}>;
      if (f && (f as THREE.FogExp2).isFogExp2) { u.mode.value = 1; u.density.value = (f as THREE.FogExp2).density; }
      else if (f && (f as THREE.Fog).isFog) { u.mode.value = 2; u.near.value = (f as THREE.Fog).near; u.far.value = (f as THREE.Fog).far; }
      else u.mode.value = 0;
      if (f) (u.color.value as THREE.Color).copy(f.color);
    };
  }

  spawn(p: THREE.Vector3, vx: number, vy: number, vz: number, size: number, life: number, color: THREE.Color, alpha: number, grow = 0, grav = 0, drag = 3): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (this.life[i] <= 0) this.live++;
    const j = i * 3;
    this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.col[j] = color.r; this.col[j + 1] = color.g; this.col[j + 2] = color.b;
    this.size[i] = size;
    this.life[i] = this.max[i] = life;
    this.grow[i] = grow;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.a0[i] = this.alpha[i] = alpha;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (this.live <= 0) { this.points.visible = false; return; }
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      live++;
      const j = i * 3, k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j] *= k; this.vel[j + 2] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      // settle debris/droplets on the floor plane instead of falling through it
      if (this.grav[i] > 1 && this.pos[j + 1] < 0.01 && this.pos[j + 1] > -0.3) { this.pos[j + 1] = 0.01; this.vel[j] *= 0.3; this.vel[j + 1] = 0; this.vel[j + 2] *= 0.3; }
      this.size[i] *= 1 + this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * Math.min(1, this.life[i] / this.max[i] * 1.6);
    }
    this.live = live;
    for (const a of Object.values(this.attrs)) a.needsUpdate = true;
    if (live === 0) this.points.visible = false;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.live = 0;
    this.attrs.aAlpha.needsUpdate = true;
    this.points.visible = false;
  }
}

/** Instanced decal ring with per-instance fade (age + oldest-before-recycle). */
class Decals {
  readonly mesh: THREE.InstancedMesh;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly born: Float32Array;
  private next = 0;
  used = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor(readonly cap: number, map: THREE.Texture, readonly lifetime: number, name: string) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    // Iteration 13 (MAT-B): node material; the per-instance fade multiplies the alpha (was GLSL `diffuseColor.a *= vFade`)
    const mat = new MeshLambertNodeMaterial({map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
    mat.name = `fx-decal-${name}`;
    mat.opacityNode = (materialOpacity as TNode).mul(attribute('aFade', 'float'));
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = `fx-decals-${name}`;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    this.born = new Float32Array(cap);
  }

  add(pos: THREE.Vector3, normal: THREE.Vector3, size: number, now: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.used = Math.min(this.cap, this.used + 1);
    this.q.setFromUnitVectors(Decals.Z, normal);
    this.q2.setFromAxisAngle(Decals.Z, Math.random() * Math.PI * 2);
    this.q.multiply(this.q2);
    this.s.set(size, size * rnd(0.8, 1.2), 1);
    this.m.compose(pos.clone().addScaledVector(normal, 0.003), this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.born[i] = now;
    this.fade.setX(i, 1);
    this.fade.needsUpdate = true;
    this.mesh.count = this.used;
    this.mesh.visible = true;
  }

  update(now: number): void {
    if (!this.used) return;
    const fadeSpan = this.lifetime * 0.25, oldest = this.used === this.cap ? this.next : 0, soft = Math.max(1, this.cap * 0.15);
    for (let i = 0; i < this.used; i++) {
      const age = now - this.born[i];
      const tf = Math.max(0, Math.min(1, (this.lifetime - age) / fadeSpan));
      const rank = (i - oldest + this.cap) % this.cap;
      const rf = this.used === this.cap ? Math.min(1, (rank + 1) / soft) : 1;
      this.fade.setX(i, Math.min(tf, rf));
    }
    this.fade.needsUpdate = true;
  }

  clear(): void {
    this.used = 0;
    this.next = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}

const C = (hex: number) => new THREE.Color(hex);
const STYLE: Record<Exclude<FxSurface, 'flesh'>, {dust: THREE.Color; chip: THREE.Color; dustN: number; chipN: number; sparks: number; decal: 'hole' | 'metal' | 'wood'; size: number}> = {
  // Iteration 06 (Lane D): glass (crushed glitter, no dust) and soft goods (fabric / card / packaging fibre puff).
  glass: {dust: C(0xdfe8ea), chip: C(0xe6eff0), dustN: 1, chipN: 6, sparks: 0, decal: 'metal', size: 0.035},
  soft: {dust: C(0xb9ae98), chip: C(0x8f7a5a), dustN: 3, chipN: 3, sparks: 0, decal: 'wood', size: 0.045},
  concrete: {dust: C(0xa69a86), chip: C(0x4a453d), dustN: 3, chipN: 5, sparks: 0, decal: 'hole', size: 0.065},
  tile: {dust: C(0xd8d4c8), chip: C(0xc9c6bb), dustN: 3, chipN: 5, sparks: 0, decal: 'hole', size: 0.055},
  metal: {dust: C(0x77736c), chip: C(0x3a3a3a), dustN: 1, chipN: 0, sparks: 7, decal: 'metal', size: 0.04},
  wood: {dust: C(0x8a6a48), chip: C(0x5a3e24), dustN: 2, chipN: 6, sparks: 0, decal: 'wood', size: 0.055},
};

export class Effects {
  readonly group = new THREE.Group();
  private readonly soft: Particles;
  private readonly glow: Particles;
  private readonly decals: Record<'hole' | 'metal' | 'wood' | 'blood', Decals>;
  private time = 0;
  private decalTick = 0;
  // tracers: one LineSegments ring with per-vertex alpha
  private readonly tracerCap = 24;
  private readonly tracerGeo = new THREE.BufferGeometry();
  private readonly tracerPos: Float32Array;
  private readonly tracerCol: Float32Array;
  private readonly tracerLife: Float32Array;
  private tracerNext = 0;
  private readonly tracerLines: THREE.LineSegments;
  private readonly tmp = new THREE.Vector3();
  private readonly blood = C(0x4a0c08);
  private readonly bloodMist = C(0x5c1410);
  private readonly smoke = C(0x9a958c);
  private readonly spark = C(0xffb75a);
  private readonly ember = C(0xff8a3a);

  constructor() {
    this.group.name = 'fx';
    const disc = (stops: [number, string][]) => canvasTexture(64, 64, 3, (ctx, w, h) => {
      const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);
    });
    const softTex = disc([[0, 'rgba(255,255,255,0.95)'], [0.45, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
    const glowTex = disc([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
    this.soft = new Particles(320, softTex, false);
    this.glow = new Particles(160, glowTex, true);
    this.group.add(this.soft.points, this.glow.points);

    const holeTex = (rim: string, core: string, cracks: string, seed: number) => canvasTexture(64, 64, seed, (ctx, w, h, rand) => {
      const gr = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      gr.addColorStop(0, core);
      gr.addColorStop(0.28, core);
      gr.addColorStop(0.42, rim);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = cracks;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2, r0 = w * 0.14, r1 = w * (0.28 + rand() * 0.18);
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
        ctx.lineTo(w / 2 + Math.cos(a + rand() * 0.3) * r1, h / 2 + Math.sin(a + rand() * 0.3) * r1);
        ctx.stroke();
      }
    });
    const bloodTex = canvasTexture(128, 128, 11, (ctx, w, h, rand) => {
      ctx.fillStyle = 'rgba(70,8,6,0.85)';
      for (let i = 0; i < 26; i++) {
        const a = rand() * Math.PI * 2, r = Math.pow(rand(), 1.8) * w * 0.4, s = (1 - r / (w * 0.4)) * w * 0.12 + 2;
        ctx.beginPath();
        ctx.ellipse(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, s, s * (0.5 + rand() * 0.5), a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(45,4,3,0.8)';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.16, 0, Math.PI * 2);
      ctx.fill();
    });
    this.decals = {
      hole: new Decals(96, holeTex('rgba(40,36,30,0.75)', 'rgba(8,7,6,0.97)', 'rgba(30,27,23,0.55)', 5), 150, 'hole'),
      metal: new Decals(40, holeTex('rgba(150,148,140,0.55)', 'rgba(20,20,22,0.95)', 'rgba(90,90,90,0.25)', 6), 150, 'metal'),
      wood: new Decals(40, holeTex('rgba(60,40,22,0.8)', 'rgba(14,9,5,0.97)', 'rgba(70,48,26,0.7)', 7), 150, 'wood'),
      blood: new Decals(40, bloodTex, 120, 'blood'),
    };
    for (const d of Object.values(this.decals)) this.group.add(d.mesh);

    this.tracerPos = new Float32Array(this.tracerCap * 6);
    this.tracerCol = new Float32Array(this.tracerCap * 8);
    this.tracerLife = new Float32Array(this.tracerCap);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 4).setUsage(THREE.DynamicDrawUsage));
    // Iteration 13 (MAT-B): node line material (per-vertex rgba: faint muzzle tail, bright head)
    this.tracerLines = new THREE.LineSegments(this.tracerGeo, new LineBasicNodeMaterial({vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}) as unknown as THREE.LineBasicMaterial);
    this.tracerLines.frustumCulled = false;
    this.tracerLines.visible = false;
    this.group.add(this.tracerLines);
  }

  /** Bullet impact on world geometry. `surface` may be a legacy boolean (true = metal). */
  impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: FxSurface | boolean = 'concrete', opts: ImpactOptions = {}): void {
    const s: FxSurface = surface === true ? 'metal' : surface === false ? 'concrete' : surface;
    if (s === 'flesh') { this.bodyHit(pos, normal.clone().negate()); return; }
    const st = STYLE[s];
    const n = normal, p = this.tmp.copy(pos).addScaledVector(n, 0.03);
    const dustN = Math.round(st.dustN * (opts.dust ?? 1)), dustC = opts.dustColor ?? st.dust;
    for (let i = 0; i < dustN; i++) {
      const v = n.clone().multiplyScalar(rnd(0.5, 1.2)).add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(0, 0.3), rnd(-0.3, 0.3)));
      this.soft.spawn(p, v.x, v.y, v.z, rnd(0.07, 0.13), rnd(0.5, 0.85), dustC, 0.55, 0.9, 0.15, 3);
    }
    const chipN = opts.chips ?? st.chipN;
    for (let i = 0; i < chipN; i++) {
      const v = n.clone().multiplyScalar(rnd(1.2, 3)).add(new THREE.Vector3(rnd(-1, 1), rnd(0, 1.4), rnd(-1, 1)));
      this.soft.spawn(p, v.x, v.y, v.z, rnd(0.008, 0.018), rnd(0.35, 0.7), st.chip, 0.95, 0, 9.8, 0.6);
    }
    if (st.sparks) {
      this.glow.spawn(p, 0, 0, 0, rnd(0.12, 0.18), 0.05, this.spark, 0.9);
      const k = st.sparks - 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < k; i++) {
        const v = n.clone().multiplyScalar(rnd(2, 5)).add(new THREE.Vector3(rnd(-2.5, 2.5), rnd(-0.5, 2.5), rnd(-2.5, 2.5)));
        this.glow.spawn(p, v.x, v.y, v.z, rnd(0.012, 0.022), rnd(0.12, 0.35), this.spark, 1, 0, 9.8, 0.4);
      }
    } else if (s !== 'glass' && s !== 'soft' && Math.random() < 0.35) this.glow.spawn(p, 0, 0, 0, 0.06, 0.035, this.ember, 0.35);
    if (opts.decal !== false) this.decals[st.decal].add(pos, n, st.size * rnd(0.85, 1.15), this.time);
  }

  /** Iteration 06 (Lane D): electrical sparks (a screen / panel dying), no decal. */
  sparks(pos: THREE.Vector3, normal: THREE.Vector3, n = 10): void {
    this.glow.spawn(pos, 0, 0, 0, rnd(0.14, 0.2), 0.06, this.spark, 0.9);
    for (let i = 0; i < n; i++) {
      const v = normal.clone().multiplyScalar(rnd(1, 3.5)).add(new THREE.Vector3(rnd(-2, 2), rnd(-0.5, 2.5), rnd(-2, 2)));
      this.glow.spawn(pos, v.x, v.y, v.z, rnd(0.01, 0.02), rnd(0.15, 0.5), this.spark, 1, 0, 9.8, 0.4);
    }
  }

  /** Blood spurt on a body hit: mist, droplets along the shot (+ a little back-spray), sometimes a floor splat. */
  bodyHit(pos: THREE.Vector3, dir: THREE.Vector3, floorY = 0): void {
    for (let i = 0; i < 2; i++) {
      const v = dir.clone().multiplyScalar(rnd(0.3, 0.7)).add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(0, 0.3), rnd(-0.3, 0.3)));
      this.soft.spawn(pos, v.x, v.y, v.z, rnd(0.1, 0.17), rnd(0.3, 0.45), this.bloodMist, 0.6, 1.4, 0.2, 3);
    }
    const drops = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < drops; i++) {
      const back = i < 2 ? -0.6 : 1;
      const v = dir.clone().multiplyScalar(back * rnd(0.8, 2.6)).add(new THREE.Vector3(rnd(-0.8, 0.8), rnd(0.2, 1.5), rnd(-0.8, 0.8)));
      this.soft.spawn(pos, v.x, v.y, v.z, rnd(0.014, 0.03), rnd(0.4, 0.75), this.blood, 0.95, 0, 9.8, 0.5);
    }
    if (Math.random() < 0.55) {
      const d = rnd(0.25, 0.9);
      const at = new THREE.Vector3(pos.x + dir.x * d + rnd(-0.15, 0.15), floorY + 0.002, pos.z + dir.z * d + rnd(-0.15, 0.15));
      this.decals.blood.add(at, new THREE.Vector3(0, 1, 0), rnd(0.22, 0.5), this.time);
    }
  }

  /** Muzzle smoke wisps (+ shotgun embers) at the barrel tip. */
  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, big: boolean): void {
    const n = big ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(rnd(0.3, big ? 1.2 : 0.7)).add(new THREE.Vector3(rnd(-0.08, 0.08), rnd(0.08, 0.25), rnd(-0.08, 0.08)));
      this.soft.spawn(pos, v.x, v.y, v.z, rnd(0.04, 0.07) * (big ? 1.4 : 1), rnd(0.6, 1.0), this.smoke, big ? 0.22 : 0.14, 2.6, -0.12, 2.2);
    }
    if (big) for (let i = 0; i < 4; i++) {
      const v = dir.clone().multiplyScalar(rnd(6, 12)).add(new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)));
      this.glow.spawn(pos, v.x, v.y, v.z, rnd(0.008, 0.014), rnd(0.08, 0.18), this.ember, 1, 0, 6, 0.6);
    }
  }

  /**
   * Task track1-siren-blightbelly-20261031 (lane BLIGHT): a Blightbelly pustule cluster popping — pus droplets spraying out
   * along `normal` (they fall) and a couple of slow, rising green mist puffs, in the existing soft-particle ring (no new
   * material: warmed with the 'effects' pool). `k` scales the counts (bounded: <= 3 mist + 8 droplets per call), `cloud`
   * adds the big slow belly cloud (<= 5 large puffs) once per burst.
   */
  blightBurst(pos: THREE.Vector3, normal: THREE.Vector3, k = 1, cloud = false): void {
    const mist = Math.min(3, Math.max(1, Math.round(2 * k))), drops = Math.min(8, Math.max(2, Math.round(6 * k)));
    for (let i = 0; i < mist; i++) {
      const v = normal.clone().multiplyScalar(rnd(0.3, 0.8)).add(new THREE.Vector3(rnd(-0.25, 0.25), rnd(0.05, 0.3), rnd(-0.25, 0.25)));
      this.soft.spawn(pos, v.x, v.y, v.z, rnd(0.18, 0.3), rnd(1.1, 1.7), this.blightMist, 0.32, 1.3, -0.08, 2.2);
    }
    for (let i = 0; i < drops; i++) {
      const v = normal.clone().multiplyScalar(rnd(1.4, 3.4)).add(new THREE.Vector3(rnd(-0.9, 0.9), rnd(0.3, 1.6), rnd(-0.9, 0.9)));
      this.soft.spawn(pos, v.x, v.y, v.z, rnd(0.014, 0.03), rnd(0.45, 0.85), this.blightPus, 0.95, 0, 9.8, 0.5);
    }
    if (cloud) for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rnd(-0.3, 0.3), sp = rnd(0.35, 0.8);
      this.soft.spawn(pos, Math.cos(a) * sp, rnd(0.05, 0.25), Math.sin(a) * sp, rnd(0.45, 0.7), rnd(2.2, 3.2), this.blightMist, 0.26, 0.9, -0.04, 1.4);
    }
  }
  private readonly blightMist = C(0x8a9a3e); // lane BLIGHT: sickly yellow-green (reads beside the green office gas)
  private readonly blightPus = C(0xc9c463);

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const i = this.tracerNext;
    this.tracerNext = (i + 1) % this.tracerCap;
    // only the far part of the path so it does not start inside the camera
    const s = from.clone().lerp(to, 0.12);
    this.tracerPos.set([s.x, s.y, s.z, to.x, to.y, to.z], i * 6);
    this.tracerLife[i] = 0.06;
    this.writeTracerAlpha(i, 1);
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.tracerLines.visible = true;
  }
  private writeTracerAlpha(i: number, a: number): void {
    // tail (muzzle side) faint, head bright warm
    this.tracerCol.set([1, 0.82, 0.55, 0.15 * a, 1, 0.9, 0.7, 0.7 * a], i * 8);
    (this.tracerGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.soft.update(dt);
    this.glow.update(dt);
    if (this.tracerLines.visible) {
      let any = false;
      for (let i = 0; i < this.tracerCap; i++) {
        if (this.tracerLife[i] <= 0) continue;
        this.tracerLife[i] -= dt;
        if (this.tracerLife[i] <= 0) { this.writeTracerAlpha(i, 0); this.tracerPos.fill(0, i * 6, i * 6 + 6); (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true; }
        else { any = true; this.writeTracerAlpha(i, this.tracerLife[i] / 0.06); }
      }
      if (!any) this.tracerLines.visible = false;
    }
    this.decalTick -= dt;
    if (this.decalTick <= 0) {
      this.decalTick = 0.25;
      for (const d of Object.values(this.decals)) d.update(this.time);
    }
  }

  /** Bounded pool usage (QA/debug). */
  stats(): {particles: number; sparks: number; decals: number; blood: number} {
    return {particles: this.soft.live, sparks: this.glow.live, decals: this.decals.hole.used + this.decals.metal.used + this.decals.wood.used, blood: this.decals.blood.used};
  }

  clear(): void {
    this.soft.clear();
    this.glow.clear();
    for (const d of Object.values(this.decals)) d.clear();
    this.tracerLife.fill(0);
    this.tracerPos.fill(0);
    this.tracerCol.fill(0);
    this.tracerLines.visible = false;
  }
}
