// Task studio-flamethrower-fire-20261114-031614-01 (lane ACID-VFX; user: "Upgrade Acid Scrapper's big green circle into an organic
// convincing corrosive pool: reactive foam, bubbles, layered detail, irregular edges, NOT a generic disk. VISUAL ONLY"): what an acid
// pool DRAWS (weapons/grenades.ts owns the pool itself: where it is, how long it lasts, whom it burns — none of that is here).
//
// TWO draws per pool, both in fixed SLOTS made once (AcidPoolVisuals: one slot per pool the acid cap allows) and reused, so a burst in
// play creates no object, material or geometry, and the warm-up compiles the very meshes play shows (GrenadeSystem.warmPrototypes):
//  - the FILM: a flat fan whose rim vertices sit exactly on the pool's seeded outline (weapons/acidPoolShape.ts poolEdge — inside the
//    circle that hurts, never far from it) plus a strip out to that circle; its node material is weapons/acidPoolLook.ts poolLook over
//    TSL nodes (liquid body with depth and a slow swirl, edge foam and reaction blooms, etched floor, drying) — a lit standard
//    material: the torch and the station's lamps glint on the wet film, and a modest glow keeps it readable in the dark. Per pool it
//    reads plain uniforms only (age, drying, radius, tile offsets, ACID_LOOK.reactions reaction points) and the material's opacity
//    (= the pool's strength, as before); one shared 128 px noise tile (data, not art). No uniformArray;
//  - the BEADS: one InstancedMesh of small spheres — BUBBLES that swell, wobble and pop (varied size and life, more of them near the
//    edge and at the reaction points), pale FROTH beads clustering on the edge foam and the blooms, and tiny SPITS thrown up a few
//    centimetres by a popping bubble (and a short crown of them at the burst), falling back at once. Glossy and translucent (a rim-lit
//    dome), per-instance fade / paleness / glow in one instanced attribute.
// REACTIONS: react(x, z, amount) marks where the acid is working — an actor standing in it, a prop it is eating, the burst —
// and the foam, the churn and the bubbling gather there, fading in about a second. It is a look only: grenades.ts calls it from
// its burn code and nothing reads it back.
// Bounded and allocation-free per frame (typed arrays, fixed instance counts, a per-pool seeded generator: the same pool looks the same
// every time). Transparent, FrontSide, no depth write, no shadows, no lights; never a gas / haze / volume (the pool is a liquid).

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {
  add, attribute, clamp, cos, div, dot, exp, materialOpacity, max, min, mix, mul, normalView, normalize, positionLocal, positionViewDirection,
  pow, sin, smoothstep, sub, texture, transformNormalToView, uniform, vec2, vec3,
} from 'three/tsl';
import {mulberry32} from '../core/rng';
import {POOL_EDGE, poolShape, ringRadius} from './acidPoolShape';
import {ACID_LOOK, LOOK_TILE, linearRgb, lookState, poolLook, poolNoiseTile, type LookMath, type PoolLookState} from './acidPoolLook';

// biome-ignore lint: loosely typed TSL nodes
type TNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The film (and its beads) lie this far above the floor (m). */
export const POOL_LIFT = 0.012;

/** Tuning of the beads (sizes in m, times in s, rates per second at full strength). */
export const ACID_FX = {
  /** Instances per pool: bubbles, froth beads, spits. */
  count: {bubbles: 26, froth: 40, spits: 18},
  bubble: {size: [0.012, 0.042] as const, life: [0.55, 2.1] as const, rate: 8, reactRate: 11, edge: 0.55, squash: 0.72, wobble: 0.08, wobbleHz: [5, 9] as const, pop: 0.07},
  froth: {size: [0.005, 0.012] as const, life: [0.45, 1.3] as const, rate: 13, reactRate: 20, edge: 0.8},
  /** A popping bubble of at least minBubble throws perPop spits: up / sideways speed (m/s). */
  spit: {size: [0.004, 0.008] as const, up: [0.5, 1.1] as const, out: 0.28, perPop: [1, 3] as const, minBubble: 0.02},
  /** The burst: a crown of spits from the middle and a reaction there. */
  splash: {spits: 12, up: [0.9, 1.7] as const, out: [0.5, 1.5] as const, react: 1.4},
  /** Reaction points: merged within `merge` m, amount x e^(-decay t), dropped under `floor`; kept `inset` x the edge inside the film. */
  react: {merge: 0.28, decay: 2.2, floor: 0.02, inset: 0.93, spread: 0.13},
  gravity: 9.8,
  /** Spawns per kind per frame at most (a long frame never dumps a burst). */
  maxPerFrame: 4,
} as const;

const BEADS = ACID_FX.count.bubbles + ACID_FX.count.froth + ACID_FX.count.spits;
const FROTH0 = ACID_FX.count.bubbles, SPIT0 = ACID_FX.count.bubbles + ACID_FX.count.froth;
const TAU = Math.PI * 2;

/** poolLook's arithmetic over TSL nodes; `tile` samples the shared noise tile (one texture binding for all four samples). */
function nodeMath(tile: TNode): LookMath<TNode> {
  return {
    add: (a, b) => add(a, b), sub: (a, b) => sub(a, b), mul: (a, b) => mul(a, b), div: (a, b) => div(a, b),
    min: (a, b) => min(a, b), max: (a, b) => max(a, b),
    clamp: (x, lo, hi) => clamp(x, lo, hi), mix: (a, b, t) => mix(a, b, t), smoothstep: (lo, hi, x) => smoothstep(lo, hi, x),
    sin: x => sin(x), cos: x => cos(x), exp: x => exp(x), pow: (x, y) => pow(x, y),
    tile: (u, v) => { const s = tile.sample(vec2(u, v)); return {r: s.r, g: s.g, b: s.b, a: s.a}; },
  };
}

/** One film's uniforms: (age, drying, full radius, swirl rate), the tile offsets, the reaction points (x, z in m at full radius, amount). */
interface FilmUniforms { state: TNode; flow: TNode; react: TNode[] }

function filmMaterial(tile: THREE.Texture, body: number, u: FilmUniforms): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  mat.name = 'acid-pool';
  const o = poolLook(nodeMath(texture(tile)), {
    qx: (positionLocal as TNode).x, qz: (positionLocal as TNode).z, rim: attribute('aRim', 'float'),
    t: u.state.x, dry: u.state.y, k: (materialOpacity as TNode).div(ACID_LOOK.opacity), r: u.state.z, ox: u.flow.x, oz: u.flow.y, swirl: u.state.w,
    react: u.react.map(p => ({x: p.x, z: p.y, a: p.z})),
  });
  const P = (hex: number): TNode => vec3(...linearRgb(hex));
  mat.colorNode = P(ACID_LOOK.deep).mul(o.deep).add(P(body).mul(o.body)).add(P(ACID_LOOK.bright).mul(o.bright))
    .add(P(ACID_LOOK.foam).mul(o.foam)).add(P(ACID_LOOK.crust).mul(o.crust)).add(P(ACID_LOOK.etch).mul(o.etch));
  mat.opacityNode = o.alpha;
  mat.roughnessNode = o.rough;
  mat.emissiveNode = P(body).mul(o.glow).add(P(ACID_LOOK.bright).mul(o.hot));
  mat.normalNode = transformNormalToView(normalize(vec3(o.sx.negate(), 1, o.sz.negate())));
  return mat;
}

/** The beads' material (shared by every slot): `aBead` = (fade, paleness, glow, -) per instance. */
function beadMaterial(body: number): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({transparent: true, depthWrite: false, side: THREE.FrontSide, metalness: 0});
  mat.name = 'acid-pool-bubbles';
  const a = attribute('aBead', 'vec4') as TNode;
  const P = (hex: number): TNode => vec3(...linearRgb(hex));
  // a thin glossy dome: clear in the middle, denser toward its silhouette; froth beads are milky all over
  const facing = clamp(dot(normalView, positionViewDirection), 0, 1) as TNode;
  const rimLit = pow(facing.oneMinus(), 2) as TNode;
  mat.colorNode = mix(mix(P(body), P(ACID_LOOK.bright), 0.5), P(ACID_LOOK.foam), a.y);
  mat.opacityNode = a.x.mul(mix(mix(0.3, 0.95, rimLit), 0.92, a.y));
  mat.roughnessNode = mix(0.06, 0.6, a.y);
  mat.emissiveNode = P(body).mul(a.z.mul(0.35).add(0.04)).mul(a.x);
  return mat;
}

/** The film's fan: centre, POOL_EDGE.segments rim vertices (moved per pool), the same number on the unit circle. `aRim` = 0 / 1 / 2. */
function filmGeometry(shared: {normal: THREE.BufferAttribute; rim: THREE.BufferAttribute; index: THREE.BufferAttribute}): THREE.BufferGeometry {
  const n = POOL_EDGE.segments, g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array((1 + 2 * n) * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU;
    pos.setXYZ(1 + i, Math.cos(a), 0, Math.sin(a));
    pos.setXYZ(1 + n + i, Math.cos(a), 0, Math.sin(a));
  }
  g.setAttribute('position', pos);
  g.setAttribute('normal', shared.normal);
  g.setAttribute('aRim', shared.rim);
  g.setIndex(shared.index);
  // (everything it can ever draw lies within the unit circle, whatever the pool's outline)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, 1));
  return g;
}

function filmShared(): {normal: THREE.BufferAttribute; rim: THREE.BufferAttribute; index: THREE.BufferAttribute} {
  const n = POOL_EDGE.segments, verts = 1 + 2 * n;
  const normal = new Float32Array(verts * 3), rim = new Float32Array(verts), index: number[] = [];
  for (let i = 0; i < verts; i++) { normal[i * 3 + 1] = 1; rim[i] = i === 0 ? 0 : i <= n ? 1 : 2; }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(0, 1 + j, 1 + i); // (faces up)
    index.push(1 + i, 1 + j, 1 + n + j, 1 + i, 1 + n + j, 1 + n + i);
  }
  return {normal: new THREE.BufferAttribute(normal, 3), rim: new THREE.BufferAttribute(rim, 1), index: new THREE.BufferAttribute(new Uint16Array(index), 1)};
}

/** One pool's two draws (a slot of AcidPoolVisuals). */
export class AcidPoolVisual {
  readonly mesh: THREE.Mesh;
  readonly bubbles: THREE.InstancedMesh;
  readonly mat: MeshStandardNodeMaterial;
  /** A pool is using this slot. */
  inUse = false;
  /** What the film's shader is fed (uniforms mirror it): tests and CPU previews read the same numbers (acidPoolLook.ts poolLookAt). */
  look: PoolLookState;
  /** Spawn / pop counters since place() (QA / tests). */
  readonly counts = {bubbles: 0, froth: 0, spits: 0, pops: 0, reacts: 0};
  private readonly u: FilmUniforms;
  private readonly bead: THREE.InstancedBufferAttribute;
  private rand: () => number = mulberry32(1);
  private reach = 0;
  // beads: unit position (x the reach) for bubbles / froth, metres for spits; velocity (spits); size, age, life, wobble phase / rate
  private readonly bx = new Float32Array(BEADS);
  private readonly by = new Float32Array(BEADS);
  private readonly bz = new Float32Array(BEADS);
  private readonly vx = new Float32Array(BEADS);
  private readonly vy = new Float32Array(BEADS);
  private readonly vz = new Float32Array(BEADS);
  private readonly size = new Float32Array(BEADS);
  private readonly age = new Float32Array(BEADS);
  private readonly life = new Float32Array(BEADS);
  private readonly wob = new Float32Array(BEADS * 2);
  private readonly next = [0, 0, 0];
  private readonly acc = [0, 0];

  constructor(tile: THREE.Texture, beadMat: THREE.Material, beadGeo: THREE.BufferGeometry, shared: ReturnType<typeof filmShared>, body: number) {
    this.u = {state: uniform(new THREE.Vector4()), flow: uniform(new THREE.Vector2()), react: Array.from({length: ACID_LOOK.reactions}, () => uniform(new THREE.Vector3()))};
    this.mat = filmMaterial(tile, body, this.u);
    this.mesh = new THREE.Mesh(filmGeometry(shared), this.mat as unknown as THREE.Material);
    this.mesh.name = 'acid-pool';
    this.mesh.renderOrder = 2;
    // the beads: this slot's own instanced attribute on the shared sphere
    const geo = new THREE.BufferGeometry();
    geo.setIndex(beadGeo.index);
    geo.setAttribute('position', beadGeo.getAttribute('position'));
    geo.setAttribute('normal', beadGeo.getAttribute('normal'));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.bead = new THREE.InstancedBufferAttribute(new Float32Array(BEADS * 4), 4);
    this.bead.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBead', this.bead);
    this.bubbles = new THREE.InstancedMesh(geo, beadMat, BEADS);
    this.bubbles.name = 'acid-pool-bubbles';
    // (drawn right after its film: same render order and the same sort depth — both sort by their geometry's centre at the pool's
    // position — so three falls back to creation order, the film first)
    this.bubbles.renderOrder = 2;
    this.bubbles.frustumCulled = false;
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [this.mesh, this.bubbles]) { m.visible = false; m.raycast = () => {}; m.castShadow = false; m.receiveShadow = false; }
    this.look = lookState(poolShape(0), 1);
    this.wipe();
  }

  /** Collapse every bead (scale 0) and forget the reactions. */
  private wipe(): void {
    const a = this.bubbles.instanceMatrix.array as Float32Array;
    a.fill(0);
    for (let i = 0; i < BEADS; i++) a[i * 16 + 15] = 1;
    (this.bead.array as Float32Array).fill(0);
    this.life.fill(0);
    this.age.fill(0);
    this.next[0] = this.next[1] = this.next[2] = 0;
    this.acc[0] = this.acc[1] = 0;
    this.look.react.fill(0);
    for (const r of this.u.react) (r.value as THREE.Vector3).set(0, 0, 0);
    this.bubbles.instanceMatrix.needsUpdate = true;
    this.bead.needsUpdate = true;
  }

  /**
   * A pool forms at (x, y, z) (y: the floor) with full radius `r`: this slot becomes its look — outline, flow and bead pattern all
   * from `seed`. Drawn from the next update() on.
   */
  place(x: number, y: number, z: number, r: number, seed: number): void {
    const shape = poolShape(seed);
    this.look = lookState(shape, r);
    this.rand = mulberry32((seed ^ 0x51f15e) >>> 0);
    this.wipe();
    const ring = this.look.ring, pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute, n = ring.length;
    for (let i = 0; i < n; i++) { const a = i / n * TAU; pos.setXYZ(1 + i, Math.cos(a) * ring[i], 0, Math.sin(a) * ring[i]); }
    pos.needsUpdate = true;
    (this.u.flow.value as THREE.Vector2).set(this.look.ox, this.look.oz);
    for (const m of [this.mesh, this.bubbles]) { m.position.set(x, y + POOL_LIFT, z); m.visible = true; }
    this.counts.bubbles = this.counts.froth = this.counts.spits = this.counts.pops = this.counts.reacts = 0;
    this.inUse = true;
    // the burst itself: the acid bites where it lands, and throws a short crown of spits
    const S = ACID_FX.splash;
    this.mark(0, 0, S.react);
    for (let i = 0; i < S.spits; i++) {
      const a = this.rand() * TAU, out = this.range(S.out);
      this.spit(0, 0, Math.cos(a) * out, this.range(S.up), Math.sin(a) * out);
    }
  }

  /** The pool is gone: nothing of it draws; the slot is free. */
  release(): void {
    this.inUse = false;
    this.mesh.visible = this.bubbles.visible = false;
    this.mat.opacity = 0;
    this.wipe();
  }

  private range(r: readonly [number, number]): number { return r[0] + (r[1] - r[0]) * this.rand(); }

  /**
   * The acid is working at world (x, z) (an actor's feet in the pool, a prop it eats): foam and bubbling gather there for about a
   * second (`amount` ~1: a body standing in it). Kept inside the film; a point near an existing one refreshes it. Look only.
   */
  react(x: number, z: number, amount: number): void {
    if (!this.inUse || !(amount > 0)) return;
    const reach = Math.max(1e-3, this.reach || this.look.r), full = this.look.r;
    // into the film's own frame at full radius (the film spreads as a whole: a point keeps its place in it)
    let qx = (x - this.mesh.position.x) / reach, qz = (z - this.mesh.position.z) / reach;
    const rho = Math.hypot(qx, qz), lim = ringRadius(this.look.ring, Math.atan2(qz, qx)) * ACID_FX.react.inset;
    if (rho > lim) { qx *= lim / rho; qz *= lim / rho; }
    this.mark(qx * full, qz * full, amount);
  }

  /** A reaction point at (mx, mz) metres from the centre (full-radius frame): refresh the one within reach, else take the weakest slot. */
  private mark(mx: number, mz: number, amount: number): void {
    const R = this.look.react, n = ACID_LOOK.reactions, merge2 = ACID_FX.react.merge * ACID_FX.react.merge;
    let weakest = 0, near = -1, nd = merge2;
    for (let i = 0; i < n; i++) {
      const a = R[i * 3 + 2];
      if (a < R[weakest * 3 + 2]) weakest = i;
      if (a <= 0) continue;
      const d = (R[i * 3] - mx) ** 2 + (R[i * 3 + 1] - mz) ** 2;
      if (d <= nd) { nd = d; near = i; }
    }
    this.counts.reacts++;
    if (near >= 0) {
      // (it follows whoever stands there: half way each call, the amount never below the call's)
      R[near * 3] += (mx - R[near * 3]) * 0.5;
      R[near * 3 + 1] += (mz - R[near * 3 + 1]) * 0.5;
      R[near * 3 + 2] = Math.max(R[near * 3 + 2], amount);
      return;
    }
    if (R[weakest * 3 + 2] >= amount) return;
    R[weakest * 3] = mx; R[weakest * 3 + 1] = mz; R[weakest * 3 + 2] = amount;
  }

  /** A spot for a new bubble / froth bead (unit frame): at a reaction point, in the edge band, or anywhere in the film. */
  private spot(edge: number, shrink: number, out: {x: number; z: number}): void {
    const R = this.look.react, n = ACID_LOOK.reactions, full = this.look.r;
    let w = 0;
    for (let i = 0; i < n; i++) w += R[i * 3 + 2];
    let x: number, z: number;
    if (this.rand() < w / (w + 1.2)) {
      // one of the reaction points, by its amount; scattered around it
      let pick = this.rand() * w, i = 0;
      for (; i < n - 1; i++) { pick -= R[i * 3 + 2]; if (pick <= 0) break; }
      const s = ACID_FX.react.spread * (0.6 + 0.8 * R[i * 3 + 2]);
      x = (R[i * 3] + (this.rand() + this.rand() + this.rand() - 1.5) * s * 1.6) / full;
      z = (R[i * 3 + 1] + (this.rand() + this.rand() + this.rand() - 1.5) * s * 1.6) / full;
    } else {
      const a = this.rand() * TAU, e = ringRadius(this.look.ring, a);
      const f = this.rand() < edge ? 0.78 + 0.19 * this.rand() : Math.sqrt(this.rand()) * 0.9;
      x = Math.cos(a) * e * f; z = Math.sin(a) * e * f;
    }
    // never outside the film (nor, while it dries, outside what is left of the liquid)
    const rho = Math.hypot(x, z), lim = ringRadius(this.look.ring, Math.atan2(z, x)) * 0.97 * shrink;
    if (rho > lim) { x *= lim / rho; z *= lim / rho; }
    out.x = x; out.z = z;
  }
  private readonly at = {x: 0, z: 0};

  private bubble(shrink: number, scale: number): void {
    const B = ACID_FX.bubble, i = this.next[0];
    this.next[0] = (i + 1) % ACID_FX.count.bubbles;
    this.spot(B.edge, shrink, this.at);
    this.bx[i] = this.at.x; this.bz[i] = this.at.z; this.by[i] = 0;
    // (mostly small ones, now and then a big blister)
    this.size[i] = (B.size[0] + (B.size[1] - B.size[0]) * this.rand() ** 1.8) * scale;
    this.life[i] = this.range(B.life);
    this.age[i] = 0;
    this.wob[i * 2] = this.rand() * TAU; this.wob[i * 2 + 1] = this.range(B.wobbleHz) * TAU;
    this.counts.bubbles++;
  }

  private frothBead(shrink: number, scale: number): void {
    const F = ACID_FX.froth, i = FROTH0 + this.next[1];
    this.next[1] = (this.next[1] + 1) % ACID_FX.count.froth;
    this.spot(F.edge, shrink, this.at);
    this.bx[i] = this.at.x; this.bz[i] = this.at.z; this.by[i] = 0;
    this.size[i] = this.range(F.size) * scale;
    this.life[i] = this.range(F.life);
    this.age[i] = 0;
    this.counts.froth++;
  }

  /** A spit from (mx, mz) metres from the centre, thrown at (vx, vy, vz). */
  private spit(mx: number, mz: number, vx: number, vy: number, vz: number): void {
    const i = SPIT0 + this.next[2];
    this.next[2] = (this.next[2] + 1) % ACID_FX.count.spits;
    this.bx[i] = mx; this.by[i] = 0.004; this.bz[i] = mz;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.size[i] = this.range(ACID_FX.spit.size);
    this.life[i] = 1; // (it ends when it falls back into the film)
    this.age[i] = 0;
    this.counts.spits++;
  }

  private hide(i: number): void {
    const a = this.bubbles.instanceMatrix.array as Float32Array, o = i * 16;
    a[o] = a[o + 5] = a[o + 10] = 0;
    (this.bead.array as Float32Array)[i * 4] = 0;
    this.life[i] = 0;
  }

  private put(i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, fade: number, pale: number, glow: number): void {
    const a = this.bubbles.instanceMatrix.array as Float32Array, o = i * 16, b = this.bead.array as Float32Array;
    a[o] = sx; a[o + 5] = sy; a[o + 10] = sz;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z;
    b[i * 4] = fade; b[i * 4 + 1] = pale; b[i * 4 + 2] = glow;
  }

  /**
   * One frame: the pool is `age` s old, its film reaches `reach` m now, its strength is `k` (0..1) and it is `dry` (0..1) of the way
   * through drying. `dt` advances the beads and the reactions (0: just redraw).
   */
  update(dt: number, age: number, reach: number, k: number, dry: number): void {
    const L = this.look, F = ACID_FX;
    this.reach = reach;
    L.t = age; L.k = k; L.dry = dry;
    this.mat.opacity = ACID_LOOK.opacity * k;
    this.mesh.scale.setScalar(reach);
    (this.u.state.value as THREE.Vector4).set(age, dry, L.r, L.swirl);
    // reactions fade
    const R = L.react, decay = Math.exp(-F.react.decay * dt);
    let work = 0;
    for (let i = 0; i < ACID_LOOK.reactions; i++) {
      let a = R[i * 3 + 2] * decay;
      if (a < F.react.floor) a = 0;
      R[i * 3 + 2] = a;
      work += a;
      (this.u.react[i].value as THREE.Vector3).set(R[i * 3], R[i * 3 + 1], a);
    }
    // new beads: fewer as the film thins, none on what has dried
    const live = k * (1 - dry) * (1 - dry), shrink = 1 - 0.6 * dry, scale = 0.45 + 0.55 * k;
    if (dt > 0 && live > 0) {
      const w = Math.min(work, 2.5);
      this.acc[0] += (F.bubble.rate + F.bubble.reactRate * w) * live * dt;
      this.acc[1] += (F.froth.rate + F.froth.reactRate * w) * live * dt;
      for (let n = Math.min(F.maxPerFrame, Math.floor(this.acc[0])); n > 0; n--) { this.acc[0]--; this.bubble(shrink, scale); }
      for (let n = Math.min(F.maxPerFrame, Math.floor(this.acc[1])); n > 0; n--) { this.acc[1]--; this.frothBead(shrink, scale); }
      if (this.acc[0] > F.maxPerFrame) this.acc[0] = 0;
      if (this.acc[1] > F.maxPerFrame) this.acc[1] = 0;
    }
    const fade = Math.min(1, k * 1.5);
    // bubbles: swell, wobble, pop (and spit)
    const B = F.bubble, S = F.spit;
    for (let i = 0; i < FROTH0; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i], left = this.life[i] - t;
      if (left <= 0) {
        const x = this.bx[i] * reach, z = this.bz[i] * reach, s = this.size[i];
        this.hide(i);
        this.counts.pops++;
        if (s >= S.minBubble) for (let n = Math.round(this.range(S.perPop)); n > 0; n--) {
          const a = this.rand() * TAU, out = this.rand() * S.out;
          this.spit(x, z, Math.cos(a) * out, this.range(S.up), Math.sin(a) * out);
        }
        continue;
      }
      const grow = Math.min(1, t / (this.life[i] * 0.75)), g = 1 - (1 - grow) * (1 - grow);
      const pop = left < B.pop ? 1 - left / B.pop : 0;
      const rad = this.size[i] * (0.25 + 0.75 * g) * (1 + 0.35 * pop);
      const w = B.wobble * g * Math.sin(this.wob[i * 2] + t * this.wob[i * 2 + 1]);
      const sy = rad * B.squash * (1 - 0.5 * w) * (1 - 0.8 * pop);
      this.put(i, this.bx[i] * reach, sy * 0.3, this.bz[i] * reach, rad * (1 + w), sy, rad * (1 - w), fade * (1 - pop), 0, 0.15 + 0.85 * pop);
    }
    // froth: small pale beads on the foam
    for (let i = FROTH0; i < SPIT0; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) { this.hide(i); continue; }
      const rad = this.size[i] * Math.min(1, u / 0.2);
      this.put(i, this.bx[i] * reach, rad * 0.35, this.bz[i] * reach, rad, rad * 0.8, rad, fade * Math.min(1, (1 - u) / 0.3), 1, 0);
    }
    // spits: up a few centimetres and back into the film
    for (let i = SPIT0; i < BEADS; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      this.vy[i] -= F.gravity * dt;
      this.bx[i] += this.vx[i] * dt; this.by[i] += this.vy[i] * dt; this.bz[i] += this.vz[i] * dt;
      if (this.by[i] <= 0 && this.vy[i] < 0) { this.hide(i); continue; }
      const s = this.size[i];
      this.put(i, this.bx[i], this.by[i], this.bz[i], s, s * (1 + Math.min(0.8, Math.abs(this.vy[i]) * 0.5)), s, fade, 0, 0.3);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
    this.bead.needsUpdate = true;
  }

  /** Live beads per kind and the reaction points in use (QA / tests). */
  stats(): {bubbles: number; froth: number; spits: number; reactions: number} {
    let b = 0, f = 0, s = 0, r = 0;
    for (let i = 0; i < BEADS; i++) if (this.life[i] > 0) { if (i < FROTH0) b++; else if (i < SPIT0) f++; else s++; }
    for (let i = 0; i < ACID_LOOK.reactions; i++) if (this.look.react[i * 3 + 2] > 0) r++;
    return {bubbles: b, froth: f, spits: s, reactions: r};
  }

  /** Every live bead: metres from the pool's centre (x, y above the film, z), radius, kind (QA / tests / CPU previews). */
  beads(): {kind: 'bubble' | 'froth' | 'spit'; x: number; y: number; z: number; r: number; fade: number}[] {
    const a = this.bubbles.instanceMatrix.array as Float32Array, b = this.bead.array as Float32Array, out = [];
    for (let i = 0; i < BEADS; i++) {
      if (this.life[i] <= 0 || a[i * 16] <= 0) continue;
      out.push({kind: i < FROTH0 ? 'bubble' as const : i < SPIT0 ? 'froth' as const : 'spit' as const, x: a[i * 16 + 12], y: a[i * 16 + 13], z: a[i * 16 + 14], r: a[i * 16], fade: b[i * 4]});
    }
    return out;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.bubbles.removeFromParent();
    this.mesh.geometry.dispose();
    this.bubbles.geometry.dispose();
    this.bubbles.dispose();
    this.mat.dispose();
  }
}

/**
 * The acid pools' looks: `slots` of them made up front under `parent` (hidden until a pool takes one). `body`: the film's base colour.
 * take() hands out a free slot; with every slot busy it makes one more (never in the game: the acid cap is the slot count).
 */
export class AcidPoolVisuals {
  readonly slots: AcidPoolVisual[] = [];
  private readonly tile: THREE.DataTexture;
  private readonly beadMat: MeshStandardNodeMaterial;
  private readonly beadGeo = new THREE.SphereGeometry(1, 10, 7);
  private readonly shared = filmShared();

  constructor(private readonly parent: THREE.Object3D, slots: number, private readonly body: number) {
    this.tile = new THREE.DataTexture(poolNoiseTile(), LOOK_TILE, LOOK_TILE, THREE.RGBAFormat);
    this.tile.name = 'acid-pool-noise';
    this.tile.wrapS = this.tile.wrapT = THREE.RepeatWrapping;
    this.tile.minFilter = THREE.LinearMipmapLinearFilter;
    this.tile.magFilter = THREE.LinearFilter;
    this.tile.generateMipmaps = true;
    this.tile.needsUpdate = true;
    this.beadMat = beadMaterial(body);
    for (let i = 0; i < slots; i++) this.grow();
  }

  private grow(): AcidPoolVisual {
    const v = new AcidPoolVisual(this.tile, this.beadMat as unknown as THREE.Material, this.beadGeo, this.shared, this.body);
    this.slots.push(v);
    this.parent.add(v.mesh, v.bubbles); // (the film first: see the beads' render order)
    return v;
  }

  /** A free slot (not yet placed). */
  take(): AcidPoolVisual {
    return this.slots.find(s => !s.inUse) ?? this.grow();
  }

  /** Every mesh a pool can ever draw (the warm-up's pool: hidden while free, the meshes themselves, never a parent group). */
  get meshes(): THREE.Object3D[] {
    return this.slots.flatMap(s => [s.mesh, s.bubbles]);
  }

  dispose(): void {
    for (const s of this.slots) s.dispose();
    this.slots.length = 0;
    this.beadMat.dispose();
    this.beadGeo.dispose();
    this.tile.dispose();
  }
}
