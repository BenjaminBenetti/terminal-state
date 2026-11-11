// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CHIPPER; user: "it grinds each body … with LOTS of blood spray"): the train
// chipper's BLOOD — fixed-capacity pools, ONE draw each (4 draws), created once and recycled oldest-first, nothing grows:
//  - DROPS: dark red droplets (an instanced icosahedron, streaked along their velocity): a PLUME thrown 0.4-1.2 m up out of the hopper
//    mouth and a JET out of the discharge spout's flange into the aisle — a steady base, with BURSTS at the fed body's lunges
//    (world/chipperView.ts lungeRate, sharpened: rate^3); gravity, the ceiling and the lining stop them; on the car floor they flatten
//    into specks for the rest of their short life;
//  - MIST: soft camera-facing puffs over the hopper and the spout — the game's own blood mist (world/fx.ts Particles: the alpha ring's
//    PointsNodeMaterial sprite quads with the soft disc texture, colour 0x5c1410), low opacity, growing and fading out;
//  - CHUNKS: a few small tumbling dark gobbets out of the hopper (pulp, not body parts);
//  - STAINS: glossy floor pools on the car floor in front of the machine, spreading over STAINS.growS and fading out at the end of
//    their bounded life (a deterministic runtime blob mask: a dynamic data texture, no authored art).
// The look follows the existing blood (world/fx.ts: droplet 0x4a0c08, mist 0x5c1410, its splats' dark red). Everything is TRAIN-LOCAL
// (the root is a child of the chipper's group on the train view's root): correct while the car moves. No per-frame / per-particle
// allocation (typed arrays + preallocated scratch), no HUD blood, deterministic (a seeded generator). The airborne pools are cleared on
// pause / ride (clearAirborne), everything at teardown (clear). The materials are warmed with the 'train-chipper' pool (hidden meshes).

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {attribute, materialOpacity} from 'three/tsl';
import {Particles, softDiscTexture} from './fx';

// biome-ignore lint: loosely typed TSL nodes
type TNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Tuning (one place). Rates are per second while grinding: `base + burst * pulse`, pulse = the body's lunge rate (0..1) ^ `pulse` (a
 * sharp peak at each lunge). Speeds in m/s, sizes in m.
 */
export const CHIPPER_FX = {
  /** Drops: radius range, life (s; a resting speck is extended by restS), streak length cap (x radius), the resting speck's spread (x radius). */
  drops: {cap: 768, size: [0.008, 0.02] as const, life: [1.0, 1.6] as const, restS: 0.7, streak: 3, speck: 0.9, color: 0x4a0a07, roughness: 0.4},
  /** The hopper plume: up speed (2.6-3.8 m/s rises 0.35-0.75 m; at a lunge peak + ~1.1 m/s: up to ~1.2 m), out toward the aisle, sideways. */
  plume: {vy: [2.6, 3.8] as const, vyBurst: 1.1, out: [0.1, 1.2] as const, side: 0.6},
  /** The spout jet: speed out into the aisle (+ burst), up / down, along the spout, sideways. */
  jet: {speed: [2.2, 3.2] as const, burst: 1.1, vy: [-0.2, 1.1] as const, along: 0.8, side: 0.35},
  /** Mist (world/fx.ts Particles): world size, life (s), growth (per s), opacity, rise (m/s^2 up), drag. */
  mist: {cap: 72, size: [0.14, 0.24] as const, life: [1.0, 1.7] as const, grow: 0.7, alpha: 0.28, rise: 0.06, drag: 2.2, color: 0x5c1410},
  chunks: {cap: 36, size: [0.012, 0.026] as const, life: [0.7, 1.2] as const, restS: 1.2, color: 0x2e0605},
  stains: {cap: 32, lifeS: 90, growS: 1.4, fadeS: 12, big: [0.32, 0.6] as const, small: [0.08, 0.2] as const, color: 0x3a0705, roughness: 0.16, opacity: 0.92},
  rate: {hopper: 110, hopperBurst: 260, outlet: 90, outletBurst: 160, mist: 10, mistBurst: 18, spoutMist: 4, chunks: 4.5, chunksBurst: 6, pool: 0.45},
  /** The burst's sharpness: pulse = lunge rate ^ this. */
  pulse: 3,
  /** A floor-landing drop leaves a small stain with this chance (scaled with the drop rate: the floor reads as before). */
  smallStain: 0.0045,
  /** At most this many spawns per emitter per frame (a long frame never dumps a burst). */
  maxPerFrame: 48,
  gravity: 9.8,
} as const;

interface V3 { x: number; y: number; z: number }

/** Where the blood comes from and where it lands (train-local). */
export interface ChipperFxFrame {
  /** The hopper mouth (rim centre) and its inner half extents (x / z). */
  hopper: V3; mouthHx: number; mouthHz: number;
  /** The wet outlet (the discharge spout's flange), the spout's direction and the unit direction out of the front (toward the aisle). */
  outlet: V3; spout: V3; front: V3;
  /** The car floor and ceiling (train-local y). */
  floorY: number; ceilY: number;
  /** The machine's footprint (no stain under it), the hopper's inner rect (spray falling back into it below the rim vanishes), the rim. */
  box: {x0: number; x1: number; z0: number; z1: number}; mouth: {x0: number; x1: number; z0: number; z1: number}; rimY: number;
  /** The interior's half width (spray stops at the lining). */
  halfWidth: number;
}

/** mulberry32: a tiny deterministic generator (the spray is reproducible in tests). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The stain's alpha mask: an irregular pool with a few satellite drops (a deterministic runtime data texture). */
function stainMask(): THREE.DataTexture {
  const n = 64, data = new Uint8Array(n * n * 4), r = rng(911);
  const blobs = [{x: 0, y: 0, r: 0.62}];
  for (let i = 0; i < 7; i++) { const a = r() * Math.PI * 2, d = 0.55 + r() * 0.3; blobs.push({x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.07 + r() * 0.12}); }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n * 2 - 1, v = (y + 0.5) / n * 2 - 1, ang = Math.atan2(v, u);
    const rim = 1 + 0.12 * Math.sin(3 * ang + 0.4) + 0.08 * Math.sin(5 * ang + 2.3) + 0.05 * Math.sin(9 * ang + 1.1);
    let a = 0;
    for (const b of blobs) {
      const d = Math.hypot(u - b.x, v - b.y) / (b.r * (b === blobs[0] ? rim : 1));
      a = Math.max(a, Math.min(1, (1 - d) / 0.18));
    }
    const i = (y * n + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.name = 'chipper-stain-mask';
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** One fixed ring of instanced bodies (positions / velocities / sizes / ages in typed arrays). */
class Ring {
  readonly pos: Float32Array; readonly vel: Float32Array; readonly size: Float32Array; readonly life: Float32Array; readonly max: Float32Array;
  /** 0 = flying, 1 = resting on the floor. */
  readonly rest: Uint8Array;
  /** Per-instance spin axis / rate (chunks) or yaw (stains). */
  readonly spin: Float32Array;
  next = 0;
  live = 0;
  constructor(readonly cap: number, readonly mesh: THREE.InstancedMesh, readonly fade: THREE.InstancedBufferAttribute | null) {
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3);
    this.size = new Float32Array(cap); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.rest = new Uint8Array(cap); this.spin = new Float32Array(cap * 4);
    const a = mesh.instanceMatrix.array as Float32Array;
    a.fill(0); // every instance starts collapsed (scale 0): nothing draws until spawned
    for (let i = 0; i < cap; i++) a[i * 16 + 15] = 1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = cap;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.raycast = () => {}; // never a hitscan / pick target
  }
  take(): number {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (this.life[i] <= 0) this.live++;
    return i;
  }
  /** Collapse instance i (scale 0). */
  hide(i: number): void {
    const a = this.mesh.instanceMatrix.array as Float32Array, o = i * 16;
    a[o] = a[o + 1] = a[o + 2] = a[o + 4] = a[o + 5] = a[o + 6] = a[o + 8] = a[o + 9] = a[o + 10] = 0;
    if (this.fade) this.fade.setX(i, 0);
  }
  clear(): void {
    for (let i = 0; i < this.cap; i++) { if (this.life[i] > 0) this.hide(i); this.life[i] = 0; this.rest[i] = 0; }
    this.live = 0;
    this.next = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.fade) this.fade.needsUpdate = true;
    this.mesh.visible = false;
  }
}

export class ChipperFx {
  /** Train-local root (a child of the chipper's group). */
  readonly root = new THREE.Group();
  private readonly drops: Ring;
  /** The soft mist: the game's alpha particle ring (world/fx.ts), its own instance. */
  private readonly mist: Particles;
  private readonly mistTex: THREE.Texture;
  private readonly mistColor = new THREE.Color(CHIPPER_FX.mist.color);
  private readonly at = {x: 0, y: 0, z: 0};
  private readonly chunks: Ring;
  private readonly stains: Ring;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly mask: THREE.DataTexture;
  private readonly rand: () => number;
  private readonly acc = {hopper: 0, outlet: 0, mist: 0, spoutMist: 0, chunks: 0, pool: 0};
  private time = 0;
  // scratch (no per-frame allocation)
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly ax = new THREE.Vector3();
  /** Counters (QA / tests): spawns per pool. */
  readonly counts = {drops: 0, mist: 0, chunks: 0, stains: 0};

  constructor(seed = 0x5eed) {
    this.root.name = 'train-chipper-fx';
    this.rand = rng(seed);
    const F = CHIPPER_FX;
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, fade: boolean): Ring => {
      let fa: THREE.InstancedBufferAttribute | null = null;
      if (fade) {
        fa = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
        fa.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aFade', fa);
      }
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.name = name;
      this.geos.push(geo);
      this.mats.push(mat);
      this.root.add(mesh);
      return new Ring(cap, mesh, fa);
    };
    // droplets / chunks: wet, lit, opaque (they catch the car's lamps and the flashlight)
    const dropMat = new THREE.MeshStandardMaterial({name: 'chipper-blood-drops', color: F.drops.color, roughness: F.drops.roughness, metalness: 0});
    this.drops = inst(new THREE.IcosahedronGeometry(1, 1), dropMat, F.drops.cap, 'train-chipper-drops', false); // (smooth normals: a drop, not a gem)
    const chunkMat = new THREE.MeshStandardMaterial({name: 'chipper-blood-chunks', color: F.chunks.color, roughness: 0.45, metalness: 0});
    this.chunks = inst(new THREE.DodecahedronGeometry(1, 0), chunkMat, F.chunks.cap, 'train-chipper-chunks', false);
    // mist: the game's soft blood mist (camera-facing sprite quads, the soft disc, fog-aware; positions in this root's frame)
    this.mistTex = softDiscTexture();
    this.mist = new Particles(F.mist.cap, this.mistTex, false);
    this.mist.points.name = 'train-chipper-mist';
    this.root.add(this.mist.points);
    // stains: a glossy dark film on the floor, the blob mask in the alpha, per-instance fade
    this.mask = stainMask();
    const stainMat = new MeshStandardNodeMaterial({map: this.mask, color: F.stains.color, roughness: F.stains.roughness, metalness: 0, transparent: true, depthWrite: false,
      opacity: F.stains.opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
    stainMat.name = 'chipper-blood-stains';
    stainMat.opacityNode = (materialOpacity as TNode).mul(attribute('aFade', 'float'));
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2); // faces up (+Y)
    this.stains = inst(plane, stainMat as unknown as THREE.Material, F.stains.cap, 'train-chipper-stains', true);
    this.stains.mesh.renderOrder = 1;
  }

  private r(a: number, b: number): number { return a + (b - a) * this.rand(); }

  /**
   * Spray for `dt` seconds of grinding. `lunge` (0..1): how hard the body is being pulled in right now (world/chipperView.ts lungeRate) —
   * its sharpened pulse bursts the plume, the jet and the mist at every lunge over a steady base; now and then a pool on the floor.
   */
  emit(dt: number, f: ChipperFxFrame, lunge = 0.5): void {
    const F = CHIPPER_FX, R = F.rate, A = this.acc, cap = F.maxPerFrame;
    const pulse = Math.pow(Math.max(0, Math.min(1, lunge)), F.pulse);
    const n = (key: keyof typeof A, rate: number): number => {
      A[key] += rate * Math.max(0, dt);
      const c = Math.min(cap, Math.floor(A[key]));
      A[key] -= c;
      if (A[key] > cap) A[key] = 0; // a hitch never queues a burst
      return c;
    };
    const P = F.plume, J = F.jet;
    for (let i = n('hopper', R.hopper + R.hopperBurst * pulse); i > 0; i--) {
      // the plume: up out of the mouth, leaning out toward the aisle; higher at a lunge
      const ox = this.r(-f.mouthHx, f.mouthHx) * 0.8, oz = this.r(-f.mouthHz, f.mouthHz) * 0.8, out = this.r(P.out[0], P.out[1]);
      this.drop(f.hopper.x + ox, f.hopper.y + 0.02, f.hopper.z + oz, this.r(-P.side, P.side) + f.front.x * out,
        this.r(P.vy[0], P.vy[1]) + P.vyBurst * pulse * this.r(0.5, 1), this.r(-P.side, P.side) * 0.7 + f.front.z * out);
    }
    for (let i = n('outlet', R.outlet + R.outletBurst * pulse); i > 0; i--) {
      // the leaking spout flange: a strong wet jet out into the aisle (and a little along the spout), pulsing with the lunges
      const sp = this.r(J.speed[0], J.speed[1]) + J.burst * pulse, al = this.r(0, J.along);
      this.drop(f.outlet.x + this.r(-0.03, 0.03), f.outlet.y + this.r(-0.03, 0.03), f.outlet.z + this.r(-0.03, 0.03),
        f.front.x * sp + f.spout.x * al + this.r(-J.side, J.side), this.r(J.vy[0], J.vy[1]), f.front.z * sp + f.spout.z * al + this.r(-J.side, J.side));
    }
    for (let i = n('mist', R.mist + R.mistBurst * pulse); i > 0; i--) this.puff(f.hopper.x + this.r(-0.12, 0.12), f.hopper.y + this.r(0.03, 0.25), f.hopper.z + this.r(-0.12, 0.12), f.front, 1);
    for (let i = n('spoutMist', R.spoutMist * (1 + pulse)); i > 0; i--) this.puff(f.outlet.x + f.front.x * 0.12, f.outlet.y + 0.02, f.outlet.z + f.front.z * 0.12, f.front, 0.7);
    for (let i = n('chunks', R.chunks + R.chunksBurst * pulse); i > 0; i--) {
      const out = this.r(0.2, 1.1);
      this.chunk(f.hopper.x + this.r(-0.1, 0.1), f.hopper.y + 0.03, f.hopper.z + this.r(-0.1, 0.1), this.r(-0.5, 0.5) + f.front.x * out, this.r(1.0, 2.2), this.r(-0.3, 0.3) + f.front.z * out);
    }
    for (let i = n('pool', R.pool); i > 0; i--) {
      // the pool under the outlet spreads into the aisle
      const d = this.r(0.05, 0.75);
      this.stain(f.outlet.x + f.front.x * d + this.r(-0.35, 0.35), f.floorY, f.box.z0 + f.front.z * d, this.r(F.stains.big[0], F.stains.big[1]), f);
    }
  }

  private drop(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const D = CHIPPER_FX.drops, R = this.drops, i = R.take();
    R.pos[i * 3] = x; R.pos[i * 3 + 1] = y; R.pos[i * 3 + 2] = z;
    R.vel[i * 3] = vx; R.vel[i * 3 + 1] = vy; R.vel[i * 3 + 2] = vz;
    R.size[i] = this.r(D.size[0], D.size[1]);
    R.life[i] = R.max[i] = this.r(D.life[0], D.life[1]);
    R.rest[i] = 0;
    R.mesh.visible = true;
    this.counts.drops++;
  }

  /** One soft mist puff (`k` scales its size), drifting out toward the aisle and rising. */
  private puff(x: number, y: number, z: number, front: V3, k: number): void {
    const M = CHIPPER_FX.mist, at = this.at;
    at.x = x; at.y = y; at.z = z;
    const out = this.r(0, 0.3);
    this.mist.spawn(at, front.x * out + this.r(-0.1, 0.1), this.r(0.1, 0.4), front.z * out + this.r(-0.1, 0.1), this.r(M.size[0], M.size[1]) * k,
      this.r(M.life[0], M.life[1]), this.mistColor, M.alpha, M.grow, -M.rise, M.drag);
    this.counts.mist++;
  }

  private chunk(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const C = CHIPPER_FX.chunks, R = this.chunks, i = R.take();
    R.pos[i * 3] = x; R.pos[i * 3 + 1] = y; R.pos[i * 3 + 2] = z;
    R.vel[i * 3] = vx; R.vel[i * 3 + 1] = vy; R.vel[i * 3 + 2] = vz;
    R.size[i] = this.r(C.size[0], C.size[1]);
    R.life[i] = R.max[i] = this.r(C.life[0], C.life[1]);
    R.rest[i] = 0;
    // a random spin axis (unit) and rate
    const ax = this.ax.set(this.r(-1, 1), this.r(-1, 1), this.r(-1, 1));
    if (ax.lengthSq() < 1e-4) ax.set(0, 1, 0);
    ax.normalize();
    R.spin[i * 4] = ax.x; R.spin[i * 4 + 1] = ax.y; R.spin[i * 4 + 2] = ax.z; R.spin[i * 4 + 3] = this.r(6, 16);
    R.mesh.visible = true;
    this.counts.chunks++;
  }

  /** A floor pool / speck at (x, floorY, z), `size` m across (never under the machine, never past the lining). */
  private stain(x: number, floorY: number, z: number, size: number, f: ChipperFxFrame): void {
    const b = f.box;
    if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return;
    const hw = f.halfWidth - size * 0.3;
    if (Math.abs(z) > hw) z = Math.sign(z) * hw;
    const R = this.stains, i = R.take();
    R.pos[i * 3] = x; R.pos[i * 3 + 1] = floorY + 0.002 + (i % 8) * 0.0002; R.pos[i * 3 + 2] = z;
    R.size[i] = size;
    R.life[i] = R.max[i] = CHIPPER_FX.stains.lifeS;
    R.spin[i * 4] = this.r(0, Math.PI * 2);
    R.mesh.visible = true;
    this.counts.stains++;
  }

  /** Advance every live particle `dt` seconds (gravity, floor, fade) and write the instance buffers. */
  update(dt: number, f: ChipperFxFrame): void {
    this.time += dt;
    const g = CHIPPER_FX.gravity;
    // --- drops (streaks in flight, flat specks at rest) ---
    {
      const R = this.drops, a = R.mesh.instanceMatrix.array as Float32Array;
      if (R.live > 0) {
        let live = 0;
        for (let i = 0; i < R.cap; i++) {
          if (R.life[i] <= 0) continue;
          R.life[i] -= dt;
          if (R.life[i] <= 0) { R.hide(i); continue; }
          const j = i * 3, o = i * 16, s = R.size[i];
          if (!R.rest[i]) {
            R.vel[j + 1] -= g * dt;
            R.pos[j] += R.vel[j] * dt; R.pos[j + 1] += R.vel[j + 1] * dt; R.pos[j + 2] += R.vel[j + 2] * dt;
            if (this.swallowed(R.pos, j, R.vel[j + 1], f)) { R.life[i] = 0; R.hide(i); continue; }
            this.lining(R.pos, R.vel, j, f);
            if (R.pos[j + 1] > f.ceilY - 0.02) { R.pos[j + 1] = f.ceilY - 0.02; R.vel[j + 1] = -Math.abs(R.vel[j + 1]) * 0.2; }
            if (R.pos[j + 1] <= f.floorY + 0.002) {
              R.pos[j + 1] = f.floorY + 0.002;
              R.rest[i] = 1;
              R.life[i] = Math.min(R.life[i] + CHIPPER_FX.drops.restS, CHIPPER_FX.drops.restS * 1.5);
              R.max[i] = Math.max(R.max[i], R.life[i]);
              if (this.rand() < CHIPPER_FX.smallStain) this.stain(R.pos[j], f.floorY, R.pos[j + 2], this.r(CHIPPER_FX.stains.small[0], CHIPPER_FX.stains.small[1]), f);
            }
          }
          if (R.rest[i]) {
            const k = Math.min(1, R.life[i] / 0.25), w = s * CHIPPER_FX.drops.speck * k; // shrink away at the end
            a[o] = w; a[o + 1] = 0; a[o + 2] = 0;
            a[o + 4] = 0; a[o + 5] = s * 0.18 * k; a[o + 6] = 0;
            a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = w;
          } else {
            // the icosahedron's Y along the velocity (a streak), X / Z perpendicular
            let vx = R.vel[j], vy = R.vel[j + 1], vz = R.vel[j + 2];
            const sp = Math.hypot(vx, vy, vz) || 1;
            vx /= sp; vy /= sp; vz /= sp;
            const st = s * (1 + Math.min(CHIPPER_FX.drops.streak, sp * 0.5));
            // b = normalize(v x up-ish), c = b x v
            let hx = 0, hy = 1, hz = 0;
            if (Math.abs(vy) > 0.9) { hx = 1; hy = 0; }
            let bx = vy * hz - vz * hy, by = vz * hx - vx * hz, bz = vx * hy - vy * hx;
            const bl = Math.hypot(bx, by, bz) || 1;
            bx /= bl; by /= bl; bz /= bl;
            const cx = by * vz - bz * vy, cy = bz * vx - bx * vz, cz = bx * vy - by * vx;
            a[o] = bx * s; a[o + 1] = by * s; a[o + 2] = bz * s;
            a[o + 4] = vx * st; a[o + 5] = vy * st; a[o + 6] = vz * st;
            a[o + 8] = cx * s; a[o + 9] = cy * s; a[o + 10] = cz * s;
          }
          a[o + 12] = R.pos[j]; a[o + 13] = R.pos[j + 1]; a[o + 14] = R.pos[j + 2]; a[o + 15] = 1;
          live++;
        }
        R.live = live;
        R.mesh.instanceMatrix.needsUpdate = true;
        if (!live) R.mesh.visible = false;
      }
    }
    // --- chunks (tumbling, resting, shrinking) ---
    {
      const R = this.chunks;
      if (R.live > 0) {
        let live = 0;
        for (let i = 0; i < R.cap; i++) {
          if (R.life[i] <= 0) continue;
          R.life[i] -= dt;
          if (R.life[i] <= 0) { R.hide(i); continue; }
          const j = i * 3;
          if (!R.rest[i]) {
            R.vel[j + 1] -= g * dt;
            R.pos[j] += R.vel[j] * dt; R.pos[j + 1] += R.vel[j + 1] * dt; R.pos[j + 2] += R.vel[j + 2] * dt;
            if (this.swallowed(R.pos, j, R.vel[j + 1], f)) { R.life[i] = 0; R.hide(i); continue; }
            this.lining(R.pos, R.vel, j, f);
            if (R.pos[j + 1] <= f.floorY + R.size[i] * 0.6) {
              R.pos[j + 1] = f.floorY + R.size[i] * 0.6;
              R.rest[i] = 1;
              R.life[i] = Math.min(R.life[i] + CHIPPER_FX.chunks.restS, CHIPPER_FX.chunks.restS * 1.5);
            }
          }
          const k = R.rest[i] ? Math.min(1, R.life[i] / 0.3) : 1;
          const spinT = R.rest[i] ? 0 : this.time * R.spin[i * 4 + 3];
          this.q.setFromAxisAngle(this.ax.set(R.spin[i * 4], R.spin[i * 4 + 1], R.spin[i * 4 + 2]), spinT + i);
          this.p.set(R.pos[j], R.pos[j + 1], R.pos[j + 2]);
          this.s.set(R.size[i] * k, R.size[i] * 0.7 * k, R.size[i] * 0.9 * k);
          R.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
          live++;
        }
        R.live = live;
        R.mesh.instanceMatrix.needsUpdate = true;
        if (!live) R.mesh.visible = false;
      }
    }
    // --- mist (the ring integrates its own drift / growth / fade) ---
    this.mist.update(dt);
    // --- stains (spreading, then fading at the end of their life) ---
    {
      const R = this.stains, S = CHIPPER_FX.stains;
      if (R.live > 0) {
        let live = 0;
        for (let i = 0; i < R.cap; i++) {
          if (R.life[i] <= 0) continue;
          R.life[i] -= dt;
          if (R.life[i] <= 0) { R.hide(i); continue; }
          const j = i * 3, age = R.max[i] - R.life[i];
          const grow = Math.min(1, 0.25 + 0.75 * age / S.growS), sz = R.size[i] * grow;
          this.q.setFromAxisAngle(this.ax.set(0, 1, 0), R.spin[i * 4]);
          this.p.set(R.pos[j], R.pos[j + 1], R.pos[j + 2]);
          this.s.set(sz, 1, sz * 0.85);
          R.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
          R.fade!.setX(i, Math.min(1, R.life[i] / S.fadeS));
          live++;
        }
        R.live = live;
        R.mesh.instanceMatrix.needsUpdate = true;
        R.fade!.needsUpdate = true;
        if (!live) R.mesh.visible = false;
      }
    }
  }

  /** A particle falling back into the hopper below its rim is swallowed (the rest of the machine is open frame: it falls through). */
  private swallowed(pos: Float32Array, j: number, vy: number, f: ChipperFxFrame): boolean {
    const b = f.mouth, x = pos[j], z = pos[j + 2];
    return vy < 0 && pos[j + 1] < f.rimY - 0.02 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
  }

  /** The car's side lining stops the spray (it runs down the wall). */
  private lining(pos: Float32Array, vel: Float32Array, j: number, f: ChipperFxFrame): void {
    const hw = f.halfWidth - 0.01;
    if (pos[j + 2] > hw) { pos[j + 2] = hw; vel[j + 2] = 0; vel[j] *= 0.3; }
    else if (pos[j + 2] < -hw) { pos[j + 2] = -hw; vel[j + 2] = 0; vel[j] *= 0.3; }
  }

  /** Live counts (QA / tests). */
  stats(): {drops: number; mist: number; chunks: number; stains: number} {
    return {drops: this.drops.live, mist: this.mist.live, chunks: this.chunks.live, stains: this.stains.live};
  }

  /** The pool sizes (fixed). */
  get caps(): {drops: number; mist: number; chunks: number; stains: number} {
    return {drops: this.drops.cap, mist: this.mist.cap, chunks: this.chunks.cap, stains: this.stains.cap};
  }

  /** The three pooled instanced meshes: drops, chunks, stains (tests / warm-up). */
  get meshes(): THREE.InstancedMesh[] {
    return [this.drops.mesh, this.chunks.mesh, this.stains.mesh];
  }

  /** The mist's one sprite draw (tests / warm-up). */
  get mistSprite(): THREE.Sprite {
    return this.mist.points;
  }

  /** The spray in the air goes (pause / ride); the floor stains stay (they lie in the car and fade on their own clock). */
  clearAirborne(): void {
    this.drops.clear(); this.mist.clear(); this.chunks.clear();
    this.acc.hopper = this.acc.outlet = this.acc.mist = this.acc.spoutMist = this.acc.chunks = this.acc.pool = 0;
  }

  /** Everything goes (teardown). */
  clear(): void {
    this.clearAirborne();
    this.stains.clear();
  }

  dispose(): void {
    this.clear();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    (this.mist.points.material as THREE.Material).dispose();
    this.mistTex.dispose();
    this.mask.dispose();
    this.root.removeFromParent();
  }
}
