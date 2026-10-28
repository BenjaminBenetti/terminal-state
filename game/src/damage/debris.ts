// Pooled physical debris (iteration 06, Lane D): chips of concrete / tile / plaster, glass shards,
// wood splinters, paint / laminate / cardboard flakes and flesh pieces that fly off a hit, fall,
// bounce and settle on the real station geometry (per-cell floor heights incl. track bed, stair
// treads, underpass and prop tops via physics/staticQuery.ts, the same queries as the casings),
// then shrink away. One InstancedMesh per piece shape (6 draw calls total), fixed-capacity rings
// (the oldest piece is recycled), no allocation per hit; per-frame spawn budget against storms.

import * as THREE from 'three';
import type {StaticQuery} from '../physics/staticQuery';
import type {DebrisShape} from './materials';

export const DEBRIS_CAPS: Readonly<Record<DebrisShape, number>> = {chunk: 150, shard: 80, glass: 110, splinter: 70, flake: 110, blob: 60};
export const DEBRIS_TOTAL_CAP = Object.values(DEBRIS_CAPS).reduce((a, b) => a + b, 0);
/** Pieces accepted per frame (a shotgun blast into tile + a shatter fit; beyond is dropped). */
export const DEBRIS_SPAWN_BUDGET = 90;
const FADE = 1.6;
const G = 9.81;

interface ShapeSpec { life: number; restitution: number; keep: number; flat: boolean; spin: number }
const SHAPES: Record<DebrisShape, ShapeSpec> = {
  chunk: {life: 32, restitution: 0.28, keep: 0.55, flat: false, spin: 16},
  shard: {life: 32, restitution: 0.22, keep: 0.5, flat: true, spin: 20},
  glass: {life: 40, restitution: 0.18, keep: 0.45, flat: true, spin: 24},
  splinter: {life: 34, restitution: 0.3, keep: 0.6, flat: true, spin: 14},
  flake: {life: 28, restitution: 0.12, keep: 0.4, flat: true, spin: 18},
  blob: {life: 22, restitution: 0.04, keep: 0.25, flat: true, spin: 8},
};

export interface DebrisSpawn {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Longest side (m). */
  size: number;
  color: THREE.Color;
  shape: DebrisShape;
  /** Lifetime override (s). */
  life?: number;
  /** Aspect override [x, y, z] multipliers (defaults per shape, jittered). */
  aspect?: [number, number, number];
}

/**
 * One debris piece (exported for iteration 07 physics chunks: a DRIVEN piece, mode 3, takes its pose
 * from a rigid body in physics/chunks.ts; when the body is retired the piece rests (mode 2) or flies
 * on ballistically (mode 0)).
 */
export interface Piece {
  live: boolean; serial: number; age: number; life: number;
  pos: THREE.Vector3; vel: THREE.Vector3; q: THREE.Quaternion; w: THREE.Vector3; scale: THREE.Vector3;
  /** 0 flying, 2 at rest, 3 driven by a rigid body. */
  mode: 0 | 2 | 3;
  /** Contact radius (smallest half extent) and half thickness along local Y (rest height). */
  r: number;
  hy: number;
}

/** Deterministic jittered unit geometry per shape (flat-shaded, ~1 m longest side). */
function geometry(shape: DebrisShape): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  const jitter = (geo: THREE.BufferGeometry, amt: number, seed: number) => {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    const offs = new Map<string, [number, number, number]>();
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < p.count; i++) {
      const k = key(p.getX(i), p.getY(i), p.getZ(i));
      let o = offs.get(k);
      if (!o) offs.set(k, (o = [r() * amt, r() * amt, r() * amt]));
      p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
    }
    return geo;
  };
  switch (shape) {
    case 'chunk': g = jitter(new THREE.IcosahedronGeometry(0.5, 0), 0.32, 11); break;
    case 'blob': g = jitter(new THREE.IcosahedronGeometry(0.5, 1), 0.22, 23); g.scale(1, 0.55, 0.85); break;
    case 'shard': case 'glass': {
      // irregular flat triangle-ish plate (a thin prism)
      g = new THREE.CylinderGeometry(0.55, 0.55, 1, 3, 1);
      g = jitter(g.toNonIndexed(), 0.25, shape === 'glass' ? 37 : 41);
      g.scale(1, shape === 'glass' ? 0.05 : 0.14, 1);
      break;
    }
    case 'splinter': g = jitter(new THREE.BoxGeometry(0.14, 0.07, 1, 1, 1, 2).toNonIndexed(), 0.06, 53); break;
    case 'flake': default: g = jitter(new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1).toNonIndexed(), 0.2, 67); g.scale(1, 0.06, 0.8); break;
  }
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function material(shape: DebrisShape): THREE.Material {
  switch (shape) {
    case 'glass': return new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide});
    case 'blob': return new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.38, metalness: 0});
    case 'splinter': return new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.85, metalness: 0});
    case 'flake': return new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide});
    default: return new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.92, metalness: 0});
  }
}

const tv = new THREE.Vector3(), tq = new THREE.Quaternion(), tm = new THREE.Matrix4(), ts = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

class Pool {
  readonly mesh: THREE.InstancedMesh;
  readonly pieces: Piece[] = [];
  private dirty = true;
  constructor(readonly shape: DebrisShape, readonly cap: number) {
    this.mesh = new THREE.InstancedMesh(geometry(shape), material(shape), cap);
    this.mesh.name = `debris-${shape}`;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // pieces spread over a few metres; per-instance bounds are not tracked
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 0;
    for (let i = 0; i < cap; i++) this.pieces.push({live: false, serial: 0, age: 0, life: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), mode: 0, r: 0.01, hy: 0.01});
    this.colors = new Float32Array(cap * 3);
    const g = this.mesh.geometry;
    g.computeBoundingBox();
    g.boundingBox!.getSize(this.half).multiplyScalar(0.5);
  }
  /** Unit-geometry half extents (local axes). */
  readonly half = new THREE.Vector3();
  private readonly colors: Float32Array;
  live = 0;

  take(serial: number): {p: Piece; i: number} {
    let i = this.pieces.findIndex(p => !p.live);
    if (i < 0) { i = 0; for (let k = 1; k < this.pieces.length; k++) if (this.pieces[k].serial < this.pieces[i].serial) i = k; }
    const p = this.pieces[i];
    if (!p.live) this.live++;
    p.live = true;
    p.serial = serial;
    this.dirty = true;
    return {p, i};
  }

  setColor(i: number, c: THREE.Color): void {
    this.colors[i * 3] = c.r; this.colors[i * 3 + 1] = c.g; this.colors[i * 3 + 2] = c.b;
  }

  update(dt: number, q: StaticQuery | null, rand: () => number): void {
    if (!this.live && !this.dirty) return;
    const spec = SHAPES[this.shape];
    let live = 0;
    for (const p of this.pieces) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.life) { p.live = false; this.dirty = true; continue; }
      live++;
      if (p.age > p.life - FADE) this.dirty = true;
      if (p.mode === 2) continue;
      this.dirty = true;
      const steps = Math.max(1, Math.min(4, Math.ceil(p.vel.length() * dt / 0.05)));
      for (let s = 0; s < steps && p.mode === 0 && p.live; s++) step(p, dt / steps, spec, q, rand);
    }
    this.live = live;
    if (this.dirty) this.flush();
  }

  private flush(): void {
    this.dirty = false;
    let n = 0;
    const col = this.mesh.instanceColor!;
    const arr = col.array as Float32Array;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (!p.live) continue;
      const left = p.life - p.age;
      const k = left < FADE ? Math.max(0.001, left / FADE) : 1;
      tm.compose(p.pos, p.q, ts.copy(p.scale).multiplyScalar(k));
      this.mesh.setMatrixAt(n, tm);
      arr[n * 3] = this.colors[i * 3]; arr[n * 3 + 1] = this.colors[i * 3 + 1]; arr[n * 3 + 2] = this.colors[i * 3 + 2];
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    col.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.pieces) p.live = false;
    this.live = 0;
    this.dirty = true;
    this.flush();
  }
}

function step(p: Piece, h: number, spec: ShapeSpec, q: StaticQuery | null, rand: () => number): void {
  const ox = p.pos.x, oy = p.pos.y, oz = p.pos.z;
  p.vel.y -= G * h;
  p.vel.multiplyScalar(Math.max(0, 1 - 0.15 * h)); // air drag
  p.pos.addScaledVector(p.vel, h);
  const wl = p.w.length();
  if (wl > 1e-4) p.q.premultiply(tq.setFromAxisAngle(tv.copy(p.w).divideScalar(wl), wl * h));
  if (!q) {
    if (p.pos.y < p.r) floor(p, 0, spec, rand);
    return;
  }
  if (q.blocked(p.pos.x, oy, p.pos.z, p.r)) {
    const bx = q.blocked(p.pos.x, oy, oz, p.r), bz = q.blocked(ox, oy, p.pos.z, p.r);
    if (bx || !bz) { p.pos.x = ox; p.vel.x *= -0.35; }
    if (bz || !bx) { p.pos.z = oz; p.vel.z *= -0.35; }
    if (q.blocked(p.pos.x, oy, p.pos.z, p.r)) { p.pos.x = ox; p.pos.z = oz; p.vel.x = p.vel.z = 0; }
    p.w.multiplyScalar(0.6);
  }
  // iteration 08 (Lane B): the ceiling of the band the piece is in (slab undersides on stacked levels)
  const top = q.ceilAbove(p.pos.x, p.pos.z, oy);
  if (p.pos.y + p.r > top) { p.pos.y = top - p.r; if (p.vel.y > 0) p.vel.y *= -0.3; }
  const ground = q.surfaceBelow(p.pos.x, p.pos.z, Math.max(oy, p.pos.y) - p.r + 0.01);
  if (ground === Infinity) { p.age = p.life; return; } // wedged in a wall: retire
  if (p.pos.y - p.r <= ground) floor(p, ground, spec, rand);
}

function floor(p: Piece, ground: number, spec: ShapeSpec, rand: () => number): void {
  p.pos.y = ground + p.r;
  const vn = -p.vel.y;
  if (vn <= 0) return;
  p.vel.x *= spec.keep;
  p.vel.z *= spec.keep;
  p.vel.y = vn * spec.restitution;
  p.w.multiplyScalar(0.5).add(tv.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(vn * spec.spin * 0.4));
  if (p.vel.y < 0.5 && Math.hypot(p.vel.x, p.vel.z) < 0.6) {
    // settle: flat pieces lie down on their broad face, chunks keep their tumble pose
    p.vel.set(0, 0, 0);
    p.w.set(0, 0, 0);
    if (spec.flat) {
      const up = tv.copy(Y).applyQuaternion(p.q);
      tq.setFromUnitVectors(up, up.y >= 0 ? Y : ts.set(0, -1, 0));
      p.q.premultiply(tq);
      p.pos.y = ground + p.hy + 0.001;
    }
    p.mode = 2;
  }
}

export class DebrisSystem {
  readonly group = new THREE.Group();
  readonly pools: Record<DebrisShape, Pool>;
  private query: StaticQuery | null = null;
  private serial = 0;
  private budget = DEBRIS_SPAWN_BUDGET;
  /** Pieces requested / dropped by the per-frame budget (QA/tests). */
  spawned = 0;
  dropped = 0;
  rand: () => number = Math.random;

  constructor() {
    this.group.name = 'debris';
    this.pools = Object.fromEntries((Object.keys(DEBRIS_CAPS) as DebrisShape[]).map(s => [s, new Pool(s, DEBRIS_CAPS[s])])) as Record<DebrisShape, Pool>;
    for (const p of Object.values(this.pools)) this.group.add(p.mesh);
  }

  setStatics(q: StaticQuery | null): void {
    this.query = q;
    this.clear();
  }

  spawn(s: DebrisSpawn): boolean {
    return this.spawnPiece(s) !== null;
  }

  /**
   * Iteration 07 (Lane K): spawn a piece whose pose is DRIVEN by a rigid body (mode 3). Returns the
   * piece and its box half extents (world metres, local axes) for the body, or null (budget).
   */
  spawnDriven(s: DebrisSpawn): {piece: Piece; half: THREE.Vector3} | null {
    const p = this.spawnPiece(s);
    if (!p) return null;
    p.mode = 3;
    const pool = this.pools[s.shape];
    return {piece: p, half: new THREE.Vector3(p.scale.x * pool.half.x, p.scale.y * pool.half.y, p.scale.z * pool.half.z)};
  }

  /** Driven pieces live (QA). */
  driven(): number {
    let n = 0;
    for (const p of Object.values(this.pools)) for (const q of p.pieces) if (q.live && q.mode === 3) n++;
    return n;
  }

  private spawnPiece(s: DebrisSpawn): Piece | null {
    if (this.budget <= 0) { this.dropped++; return null; }
    this.budget--;
    this.spawned++;
    const pool = this.pools[s.shape];
    const {p, i} = pool.take(++this.serial);
    const R = this.rand;
    const spec = SHAPES[s.shape];
    p.age = 0;
    p.life = (s.life ?? spec.life) * (0.85 + R() * 0.3);
    p.mode = 0;
    p.pos.set(s.x, s.y, s.z);
    p.vel.set(s.vx, s.vy, s.vz);
    const a = s.aspect ?? (s.shape === 'chunk' ? [0.8 + R() * 0.4, 0.6 + R() * 0.5, 0.7 + R() * 0.5] : s.shape === 'splinter' ? [0.6 + R() * 0.8, 0.6 + R() * 0.6, 1] : [0.7 + R() * 0.5, 1, 0.6 + R() * 0.5]);
    p.scale.set(s.size * a[0], s.size * a[1], s.size * a[2]);
    const hx = p.scale.x * pool.half.x, hy = p.scale.y * pool.half.y, hz = p.scale.z * pool.half.z;
    p.hy = hy;
    p.r = Math.max(0.002, spec.flat ? Math.min(hx, hy, hz) : (hx + hy + hz) / 3 * 0.8);
    p.q.setFromAxisAngle(tv.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), R() * Math.PI * 2);
    p.w.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(spec.spin * 2);
    // never start inside a wall / prop (the hit point sits on its surface): nudge along the throw
    if (this.query?.insideSolid(p.pos.x, p.pos.y, p.pos.z)) p.pos.addScaledVector(tv.copy(p.vel).normalize(), 0.04);
    pool.setColor(i, s.color);
    return p;
  }

  update(dt: number): void {
    this.budget = DEBRIS_SPAWN_BUDGET;
    for (const p of Object.values(this.pools)) p.update(dt, this.query, this.rand);
  }

  get live(): number {
    let n = 0;
    for (const p of Object.values(this.pools)) n += p.live;
    return n;
  }

  /** Live pieces per shape (QA/tests). */
  liveByShape(): Record<DebrisShape, number> {
    return Object.fromEntries(Object.entries(this.pools).map(([k, p]) => [k, p.live])) as Record<DebrisShape, number>;
  }

  /** Resting pieces (settled on a surface). */
  resting(): number {
    let n = 0;
    for (const p of Object.values(this.pools)) for (const q of p.pieces) if (q.live && q.mode === 2) n++;
    return n;
  }

  /** QA: positions of live pieces (bounded list). */
  list(max = 40): {shape: DebrisShape; x: number; y: number; z: number; rest: boolean}[] {
    const out: {shape: DebrisShape; x: number; y: number; z: number; rest: boolean}[] = [];
    for (const [k, p] of Object.entries(this.pools)) for (const q of p.pieces) if (q.live && out.length < max) out.push({shape: k as DebrisShape, x: q.pos.x, y: q.pos.y, z: q.pos.z, rest: q.mode === 2});
    return out;
  }

  clear(): void {
    for (const p of Object.values(this.pools)) p.clear();
  }

  dispose(): void {
    for (const p of Object.values(this.pools)) { p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); p.mesh.dispose(); }
  }
}
