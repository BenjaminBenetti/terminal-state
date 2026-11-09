// Task studio-market-bar-20261108-225231-01 (lane SHELVES, the throw-up action; user: "A second timed beer makes player vomit, physical
// chunks like bullet casings."): THE FOOD CHUNKS — a bounded pool of small irregular chunks thrown from the player's mouth, integrated
// like the spent casings (physics/casings.ts CasingSystem: a CPU-cheap analytic integrator against the station statics — floors at every
// cell height, stair treads, walls, prop boxes, slab undersides — never a cannon body, never a broadphase pair).
//  - BOUNDED: VOMIT_CHUNKS.max live chunks (the oldest recycled when full), each VOMIT_CHUNKS.life seconds (shrinking away over the
//    last VOMIT_CHUNKS.fade); cleared with the station (physics/world.ts BodySource.clear), carried / moved by the elevator cab like the
//    casings (carry / relocate).
//  - PHYSICAL: gravity, a wet low bounce, wall / ceiling contacts, sliding friction; once it stops a chunk lies FLAT on the surface it
//    landed on (its lowest point on it: never floating, never sunk) and rests.
//  - A RUNTIME EFFECT ONLY: one InstancedMesh (one jittered low-poly lump, every instance its own non-uniform scale / turn and its own
//    colour from a small half-digested-food palette: instance colours, no texture). Never an item: no pickup, stack, loot, cargo, currency,
//    material or gore system ever sees a chunk.
import * as THREE from 'three';
import type {StaticQuery} from '../physics/staticQuery';

export const VOMIT_CHUNKS = {
  /** Most live chunks (the pool). */
  max: 64,
  /** Seconds a chunk lives, and the shrink-away at its end. */
  life: 30,
  fade: 2,
  /** Chunk size (m: the lump's half extent before its own scale). */
  size: [0.008, 0.017] as const,
  restitution: 0.18,
  /** Tangential speed kept per floor impact; wall bounce. */
  keep: 0.35,
  wall: 0.25,
  /** Sliding decay (1/s) on a surface; below this speed it rests (m/s). */
  slide: 9,
  rest: 0.025,
} as const;

/** The half-digested palette (runtime colours). */
const PALETTE = [0xc9a35f, 0xb8863f, 0xd8c08a, 0x9c7a3a, 0xa8a24a, 0xc7783c, 0x8f6b33, 0xd2b56e];
const G = 9.81;

interface Chunk {
  live: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  /** Render scale (m) per axis, the collision radius, the flat rest height above the surface (its lowest point on it). */
  scale: THREE.Vector3;
  r: number;
  restH: number;
  yaw: number;
  age: number;
  /** 0 airborne, 1 sliding on a surface, 2 at rest. */
  mode: 0 | 1 | 2;
  bounces: number;
  serial: number;
  color: THREE.Color;
}

const Y = new THREE.Vector3(0, 1, 0);
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tm = new THREE.Matrix4(), ts = new THREE.Vector3();

/** One irregular lump: an icosahedron with its corners pulled in by a fixed pattern (unit size, its lowest point at LUMP_MIN_Y). */
function lumpGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    tv.fromBufferAttribute(pos, i);
    // the same corner always moves the same way (the shape is fixed; instances vary by scale / turn / colour)
    const k = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(tv.x * 12.9898 + tv.y * 78.233 + tv.z * 37.719));
    tv.multiplyScalar(k);
    pos.setXYZ(i, tv.x, tv.y, tv.z);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

export class VomitChunks {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private readonly pool: Chunk[] = [];
  private serial = 0;
  private dirty = true;
  /** The lump's lowest point (unit geometry, its own frame). */
  private readonly minY: number;
  /** Deterministic jitter source (tests may replace it). */
  rand: () => number = Math.random;
  /** QA / tests. */
  readonly counts = {spawned: 0, recycled: 0, expired: 0, retired: 0};

  /** `statics`: the station's read-only collision (null between stations: nothing simulates, chunks are cleared with the station). */
  constructor(private statics: () => StaticQuery | null = () => null) {
    this.group.name = 'vomit-chunks';
    for (let i = 0; i < VOMIT_CHUNKS.max; i++) {
      this.pool.push({live: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1),
        r: 0.01, restH: 0.01, yaw: 0, age: 0, mode: 0, bounces: 0, serial: 0, color: new THREE.Color()});
    }
    const geo = lumpGeometry();
    this.minY = geo.boundingBox!.min.y;
    const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.42, metalness: 0}); // (wet; instance colours tint it)
    mat.name = 'vomit-chunk';
    this.mesh = new THREE.InstancedMesh(geo, mat, VOMIT_CHUNKS.max);
    this.mesh.name = 'vomit-chunks';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // (a few dozen tiny instances, like the casings: per-instance bounds are not tracked)
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(PALETTE[0])); // (allocates the instance colour buffer once)
    this.group.add(this.mesh);
  }

  /** BodySource: no cannon bodies ever (the integrator is analytic). */
  readonly awake = 0;
  activePoints(): void {}

  get live(): number {
    let n = 0;
    for (const c of this.pool) if (c.live) n++;
    return n;
  }

  /** QA / tests: the live chunks. */
  list(): {x: number; y: number; z: number; r: number; restH: number; mode: number; age: number; speed: number; bounces: number}[] {
    return this.pool.filter(c => c.live).map(c => ({x: c.pos.x, y: c.pos.y, z: c.pos.z, r: c.r, restH: c.restH, mode: c.mode, age: c.age, speed: c.vel.length(), bounces: c.bounces}));
  }

  /**
   * Throw one chunk from `origin` along `dir` (world) at about `speed` m/s, plus the thrower's velocity. Recycles the oldest chunk when the
   * pool is full; a spawn point inside solid geometry spawns nothing (false).
   */
  spawn(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, inherit?: {x: number; y: number; z: number}): boolean {
    let c = this.pool.find(p => !p.live);
    if (!c) { c = this.pool.reduce((a, b) => (b.serial < a.serial ? b : a)); this.counts.recycled++; }
    const R = this.rand, S = VOMIT_CHUNKS.size;
    const s = S[0] + (S[1] - S[0]) * R();
    c.scale.set(s * (0.75 + R() * 0.6), s * (0.55 + R() * 0.4), s * (0.75 + R() * 0.6));
    c.r = Math.max(c.scale.x, c.scale.y, c.scale.z);
    c.restH = -this.minY * c.scale.y;
    const q = this.statics();
    if (q && q.blocked(origin.x, origin.y, origin.z, c.r)) { c.live = false; return false; }
    c.live = true;
    c.age = 0;
    c.mode = 0;
    c.bounces = 0;
    c.serial = ++this.serial;
    c.pos.copy(origin);
    const d = tv.copy(dir).normalize();
    d.x += (R() - 0.5) * 0.5; d.y += (R() - 0.5) * 0.35; d.z += (R() - 0.5) * 0.5;
    d.normalize();
    c.vel.copy(d).multiplyScalar(speed * (0.7 + R() * 0.6));
    if (inherit) c.vel.add(tv2.set(inherit.x, inherit.y, inherit.z));
    c.q.setFromEuler(new THREE.Euler(R() * 6.283, R() * 6.283, R() * 6.283));
    c.w.set((R() - 0.5) * 22, (R() - 0.5) * 22, (R() - 0.5) * 22);
    c.yaw = R() * Math.PI * 2;
    c.color.setHex(PALETTE[Math.floor(R() * PALETTE.length) % PALETTE.length]).multiplyScalar(0.85 + R() * 0.3);
    this.counts.spawned++;
    this.dirty = true;
    return true;
  }

  /** BodySource: per frame (also while the physics world idles). */
  update(dt: number): void {
    let any = false;
    for (const c of this.pool) {
      if (!c.live) continue;
      any = true;
      c.age += dt;
      if (c.age >= VOMIT_CHUNKS.life) { c.live = false; this.dirty = true; this.counts.expired++; continue; }
      if (c.age > VOMIT_CHUNKS.life - VOMIT_CHUNKS.fade) this.dirty = true;
      if (c.mode === 2) continue;
      this.dirty = true;
      const steps = Math.max(1, Math.min(6, Math.ceil(c.vel.length() * dt / 0.03)));
      const h = dt / steps;
      for (let i = 0; i < steps && c.live && (c.mode as number) !== 2; i++) this.step(c, h);
    }
    if (any || this.dirty) this.flush();
  }

  private step(c: Chunk, h: number): void {
    const K = VOMIT_CHUNKS, q = this.statics();
    const ox = c.pos.x, oy = c.pos.y, oz = c.pos.z;
    if (c.mode === 0) c.vel.y -= G * h;
    c.pos.addScaledVector(c.vel, h);
    let ground = 0;
    if (q) {
      // sideways: walls, the platform face, prop sides (at the pre-step height: the vertical move is resolved below)
      if (q.blocked(c.pos.x, oy, c.pos.z, c.r)) {
        const bx = q.blocked(c.pos.x, oy, oz, c.r), bz = q.blocked(ox, oy, c.pos.z, c.r);
        if (bx || !bz) { c.pos.x = ox; c.vel.x *= -K.wall; c.vel.z *= 0.7; }
        if (bz || !bx) { c.pos.z = oz; c.vel.z *= -K.wall; c.vel.x *= 0.7; }
        if (q.blocked(c.pos.x, oy, c.pos.z, c.r)) { c.pos.x = ox; c.pos.z = oz; }
        c.bounces++;
        if (c.mode === 2) c.mode = 1;
      }
      const top = q.ceilAbove(c.pos.x, c.pos.z, oy);
      if (c.pos.y + c.r > top) { c.pos.y = top - c.r; if (c.vel.y > 0) c.vel.y = -c.vel.y * K.restitution; }
      ground = q.surfaceBelow(c.pos.x, c.pos.z, Math.max(oy, c.pos.y) - c.r + 0.01);
      if (ground === Infinity) { c.live = false; this.dirty = true; this.counts.retired++; return; } // (wedged in a wall: retire)
    }
    if (c.mode === 1) {
      if (c.pos.y - c.restH > ground + 0.02) c.mode = 0; // (slid off an edge: falls again)
      else c.pos.y = ground + c.restH;
    }
    if (c.mode === 0 && c.pos.y - c.r <= ground) this.land(c, ground);
    if (c.mode === 0) {
      const w = c.w.length();
      if (w > 1e-4) c.q.premultiply(tq.setFromAxisAngle(tv.copy(c.w).divideScalar(w), w * h));
      return;
    }
    // on a surface: settle flat (its own yaw only, its lowest point on the surface) and slide to a stop
    c.q.slerp(tq.setFromAxisAngle(Y, c.yaw), Math.min(1, h * 18));
    const k = Math.exp(-K.slide * h);
    c.vel.x *= k; c.vel.z *= k; c.vel.y = 0;
    if (Math.hypot(c.vel.x, c.vel.z) < K.rest) {
      c.vel.set(0, 0, 0);
      c.q.setFromAxisAngle(Y, c.yaw);
      c.pos.y = ground + c.restH;
      c.mode = 2;
    }
  }

  /** A floor contact: a wet, low bounce; slow enough, it stays on the surface. */
  private land(c: Chunk, ground: number): void {
    const K = VOMIT_CHUNKS;
    const vn = -c.vel.y;
    c.bounces++;
    c.vel.x *= K.keep; c.vel.z *= K.keep;
    c.w.multiplyScalar(0.4);
    if (vn * K.restitution < 0.35) { c.vel.y = 0; c.mode = 1; c.pos.y = ground + c.restH; return; }
    c.pos.y = ground + c.r;
    c.vel.y = vn * K.restitution;
  }

  /** Lane LIFT: resting chunks inside the moving elevator cab ride its dy. */
  carry(inside: (x: number, y: number, z: number) => boolean, dy: number): void {
    for (const c of this.pool) if (c.live && inside(c.pos.x, c.pos.y, c.pos.z)) { c.pos.y += dy; this.dirty = true; }
  }

  /** Lane LIFT: chunks in a doorway the landing doors shut on go to the nearer side. */
  relocate(move: (x: number, y: number, z: number) => [number, number] | null): void {
    for (const c of this.pool) {
      if (!c.live) continue;
      const to = move(c.pos.x, c.pos.y, c.pos.z);
      if (to) { c.pos.x = to[0]; c.pos.z = to[1]; this.dirty = true; }
    }
  }

  /** BodySource: the station goes (or a new one is built): every chunk goes. */
  clear(): void {
    for (const c of this.pool) c.live = false;
    this.dirty = true;
    this.flush();
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let n = 0;
    for (const c of this.pool) {
      if (!c.live) continue;
      const left = VOMIT_CHUNKS.life - c.age;
      const f = left < VOMIT_CHUNKS.fade ? Math.max(0.001, left / VOMIT_CHUNKS.fade) : 1;
      tm.compose(c.pos, c.q, ts.copy(c.scale).multiplyScalar(f));
      this.mesh.setMatrixAt(n, tm);
      this.mesh.setColorAt(n, c.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.clear();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
