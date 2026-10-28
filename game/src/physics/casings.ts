// Spent brass / shotgun hulls: a pooled, CPU-cheap custom integrator (not cannon bodies).
//
// Why custom: casings only ever need gravity, tumbling and contact with the static station
// (floor, track-bed trench, grid walls, prop boxes). Analytic tests against the grid/prop data are
// exact for that geometry, cost O(live casings) per frame, never add rigid bodies or broadphase
// pairs to the ragdoll world, and keep working when a station has no active ragdolls (the cannon
// world is not stepped at all then). Casings do not collide with corpses or each other.
//
// Rendering: one InstancedMesh per part (rifle brass; shotgun hull + brass head) with a shared
// 48-slot pool; the oldest casing is recycled when full. Casings lie on their side at rest and
// shrink away over the last 2 s of a 25 s lifetime.

import * as THREE from 'three';
import type {StaticQuery} from './staticQuery';

export type CasingKind = 'rifle' | 'shell';

export interface CasingAudio {
  casing?(x: number, y: number, z: number, speed: number, kind: 'rifle' | 'shell'): void;
}

export const MAX_CASINGS = 48;
export const CASING_LIFETIME = 25;
const FADE = 2;
const G = 9.81;

interface KindSpec {
  /** Lying radius (centre height at rest). */
  r: number;
  restitution: number;
  /** Fraction of tangential speed kept per floor impact. */
  keep: number;
  wall: number;
  /** Ground-mode decay (1/s) along the casing axis (slides) and across it (rolls). */
  slide: number;
  roll: number;
  spinMul: number;
}

const KIND: Record<CasingKind, KindSpec> = {
  // 5.56x45-like brass: ~45 mm long, 9.6 mm rim
  rifle: {r: 0.0048, restitution: 0.34, keep: 0.6, wall: 0.4, slide: 7, roll: 2.4, spinMul: 14},
  // 12 ga plastic hull with brass head: ~70 mm long, 21 mm diameter, deader bounce
  shell: {r: 0.0106, restitution: 0.26, keep: 0.55, wall: 0.3, slide: 8, roll: 3.2, spinMul: 8},
};

interface Casing {
  live: boolean;
  kind: CasingKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  age: number;
  /** 0 airborne, 1 sliding/rolling on a surface, 2 at rest. */
  mode: 0 | 1 | 2;
  sounds: number;
  bounces: number;
  serial: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const ID = new THREE.Quaternion();
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tm = new THREE.Matrix4(), ts = new THREE.Vector3();

function brassGeometry(): THREE.BufferGeometry {
  // bottlenecked rifle case profile (radius, height) around +Y, centred on its length
  const pts = [[0, 0], [0.0048, 0], [0.0048, 0.0012], [0.0042, 0.0016], [0.0047, 0.0022], [0.0045, 0.035], [0.0032, 0.0385], [0.0032, 0.0445], [0.0026, 0.0445]];
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y - 0.0222)), 8);
  return g;
}

export class CasingSystem {
  readonly group = new THREE.Group();
  private readonly pool: Casing[] = [];
  private readonly meshes: {kind: CasingKind; mesh: THREE.InstancedMesh}[] = [];
  private query: StaticQuery | null = null;
  private serial = 0;
  private soundGap = 0;
  private dirty = true;
  audio: CasingAudio | null = null;
  /** Deterministic jitter source (tests may replace it). */
  rand: () => number = Math.random;
  /** Count of impact sounds requested (QA/tests). */
  impactsPlayed = 0;

  constructor() {
    this.group.name = 'casings';
    for (let i = 0; i < MAX_CASINGS; i++) {
      this.pool.push({live: false, kind: 'rifle', pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), age: 0, mode: 0, sounds: 0, bounces: 0, serial: 0});
    }
    const brass = new THREE.MeshStandardMaterial({color: 0xc59a48, metalness: 0.65, roughness: 0.34, emissive: 0x140d04});
    const hullMat = new THREE.MeshStandardMaterial({color: 0x9e1f1a, metalness: 0.05, roughness: 0.55});
    const hull = new THREE.CylinderGeometry(0.0103, 0.0103, 0.054, 10, 1, false);
    hull.translate(0, 0.008, 0);
    const head = new THREE.CylinderGeometry(0.0108, 0.0108, 0.016, 10, 1, false);
    head.translate(0, -0.027, 0);
    const add = (kind: CasingKind, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_CASINGS);
      mesh.count = 0;
      mesh.frustumCulled = false; // 48 tiny instances; per-instance bounds are not tracked
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `casings-${kind}`;
      this.group.add(mesh);
      this.meshes.push({kind, mesh});
    };
    add('rifle', brassGeometry(), brass);
    add('shell', hull, hullMat);
    add('shell', head, brass);
  }

  setStatics(q: StaticQuery | null): void {
    this.query = q;
    this.clear();
  }

  clear(): void {
    for (const c of this.pool) c.live = false;
    this.dirty = true;
    this.flush();
  }

  get live(): number {
    let n = 0;
    for (const c of this.pool) if (c.live) n++;
    return n;
  }

  /** QA/tests: snapshot of live casings. */
  list(): {kind: CasingKind; x: number; y: number; z: number; mode: number; age: number; speed: number; bounces: number}[] {
    return this.pool.filter(c => c.live).map(c => ({kind: c.kind, x: c.pos.x, y: c.pos.y, z: c.pos.z, mode: c.mode, age: c.age, speed: c.vel.length(), bounces: c.bounces}));
  }

  /**
   * Spawn a casing at `origin` (world) leaving along `dir` (world, unit-ish), plus inherited
   * shooter velocity. Recycles the oldest casing when the pool is full.
   */
  eject(origin: THREE.Vector3, dir: THREE.Vector3, kind: CasingKind, inherit?: {x: number; y: number; z: number}, speed = kind === 'rifle' ? 2.7 : 2.0): void {
    let c = this.pool.find(p => !p.live);
    if (!c) c = this.pool.reduce((a, b) => (b.serial < a.serial ? b : a));
    const R = this.rand;
    c.live = true;
    c.kind = kind;
    c.age = 0;
    c.mode = 0;
    c.sounds = 0;
    c.bounces = 0;
    c.serial = ++this.serial;
    c.pos.copy(origin);
    // keep the spawn point out of walls/props (player hugging a wall): pull back toward the gun line
    // the caller pulls the port out of walls; a point still inside solid geometry spawns nothing
    const q = this.query;
    if (q && q.blocked(c.pos.x, c.pos.y, c.pos.z, KIND[kind].r)) { c.live = false; return; }
    const d = tv.copy(dir).normalize();
    // per-shot scatter: +-15% speed, ~8 deg direction jitter
    d.x += (R() - 0.5) * 0.28; d.y += (R() - 0.5) * 0.28; d.z += (R() - 0.5) * 0.28;
    d.normalize();
    c.vel.copy(d).multiplyScalar(speed * (0.85 + R() * 0.3));
    if (inherit) c.vel.add(tv2.set(inherit.x, inherit.y, inherit.z));
    // casing axis roughly along the barrel (perpendicular to the throw, horizontal), mouth first
    const axis = tv2.crossVectors(d, Y);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    c.q.setFromUnitVectors(Y, axis);
    // end-over-end tumble about the axis perpendicular to both throw and case axis, plus wobble
    const spin = (kind === 'rifle' ? 28 : 15) * (0.75 + R() * 0.5);
    c.w.crossVectors(axis, d).normalize().multiplyScalar(spin);
    c.w.x += (R() - 0.5) * 6; c.w.y += (R() - 0.5) * 6; c.w.z += (R() - 0.5) * 6;
    this.dirty = true;
  }

  private impact(c: Casing, speed: number): void {
    c.bounces++;
    if (!this.audio?.casing || c.sounds >= 3 || speed < 0.28 || this.soundGap > 0) return;
    c.sounds++;
    this.soundGap = 0.02;
    this.impactsPlayed++;
    this.audio.casing(c.pos.x, c.pos.y, c.pos.z, speed, c.kind);
  }

  update(dt: number): void {
    this.soundGap = Math.max(0, this.soundGap - dt);
    let any = false;
    for (const c of this.pool) {
      if (!c.live) continue;
      any = true;
      c.age += dt;
      if (c.age >= CASING_LIFETIME) { c.live = false; this.dirty = true; continue; }
      if (c.age > CASING_LIFETIME - FADE) this.dirty = true;
      if (c.mode === 2) continue;
      this.dirty = true;
      const steps = Math.max(1, Math.min(6, Math.ceil(c.vel.length() * dt / 0.04)));
      const h = dt / steps;
      for (let i = 0; i < steps && (c.mode as number) !== 2 && c.live; i++) this.step(c, h);
    }
    if (any || this.dirty) this.flush();
  }

  private step(c: Casing, h: number): void {
    const k = KIND[c.kind];
    const q = this.query;
    const ox = c.pos.x, oy = c.pos.y, oz = c.pos.z;
    if (c.mode === 0) c.vel.y -= G * h;
    c.pos.addScaledVector(c.vel, h);
    if (!q) {
      // no station (tests without statics): flat floor at y 0
      if (c.pos.y < k.r) this.floorContact(c, 0, k);
      this.spin(c, h, k);
      return;
    }
    // sideways: walls, the platform face, prop sides
    // (tested at the pre-step height: the vertical move is resolved against surfaceBelow below)
    if (q.blocked(c.pos.x, oy, c.pos.z, k.r)) {
      const bx = q.blocked(c.pos.x, oy, oz, k.r);
      const bz = q.blocked(ox, oy, c.pos.z, k.r);
      let hitSpeed = 0;
      if (bx || !bz) { c.pos.x = ox; hitSpeed = Math.max(hitSpeed, Math.abs(c.vel.x)); c.vel.x *= -k.wall; c.vel.z *= 0.8; }
      if (bz || !bx) { c.pos.z = oz; hitSpeed = Math.max(hitSpeed, Math.abs(c.vel.z)); c.vel.z *= -k.wall; c.vel.x *= 0.8; }
      if (q.blocked(c.pos.x, oy, c.pos.z, k.r)) { c.pos.x = ox; c.pos.z = oz; }
      c.w.multiplyScalar(0.7).add(tv.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(hitSpeed * k.spinMul));
      if (c.mode === 2) c.mode = 1;
      this.impact(c, hitSpeed);
    }
    // iteration 08: the ceiling of the band the casing is in (a slab underside on stacked levels)
    const top = q.ceilAbove(c.pos.x, c.pos.z, oy);
    if (c.pos.y + k.r > top) { c.pos.y = top - k.r; if (c.vel.y > 0) { this.impact(c, c.vel.y); c.vel.y = -c.vel.y * k.restitution; } }
    const ground = q.surfaceBelow(c.pos.x, c.pos.z, Math.max(oy, c.pos.y) - k.r + 0.01);
    if (ground === Infinity) { c.live = false; this.dirty = true; return; } // wedged in a wall: retire
    if (c.mode === 1) {
      if (c.pos.y - k.r > ground + 0.02) c.mode = 0; // rolled off an edge (platform lip, crate top)
      else c.pos.y = ground + k.r;
    }
    if (c.mode === 0 && c.pos.y - k.r <= ground) this.floorContact(c, ground, k);
    this.spin(c, h, k);
  }

  private floorContact(c: Casing, ground: number, k: KindSpec): void {
    c.pos.y = ground + k.r;
    const vn = -c.vel.y;
    if (vn <= 0) return;
    const tang = Math.hypot(c.vel.x, c.vel.z);
    this.impact(c, Math.hypot(vn, tang * 0.5));
    c.vel.x *= k.keep;
    c.vel.z *= k.keep;
    c.vel.y = vn * k.restitution;
    // random tumble from the strike; spin also bleeds speed
    c.w.multiplyScalar(0.55).add(tv.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(vn * k.spinMul * 2));
    if (c.vel.y < 0.45) { c.vel.y = 0; c.mode = 1; }
  }

  private spin(c: Casing, h: number, k: KindSpec): void {
    if (c.mode === 0) {
      const w = c.w.length();
      if (w > 1e-4) c.q.premultiply(tq.setFromAxisAngle(tv.copy(c.w).divideScalar(w), w * h));
      return;
    }
    // On a surface: lay the case on its side, slide along its axis, roll across it.
    const a = tv.set(0, 1, 0).applyQuaternion(c.q);
    const flat = tv2.set(a.x, 0, a.z);
    if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
    flat.normalize();
    c.q.premultiply(tq.setFromUnitVectors(a, flat).slerp(ID, Math.max(0, 1 - h * 14)));
    const along = c.vel.x * flat.x + c.vel.z * flat.z;
    const ax = c.vel.x - along * flat.x, az = c.vel.z - along * flat.z;
    const ka = Math.exp(-k.slide * h), kr = Math.exp(-k.roll * h);
    c.vel.x = along * ka * flat.x + ax * kr;
    c.vel.z = along * ka * flat.z + az * kr;
    c.vel.y = 0;
    // rolling about the case axis: omega = (up x v) . axis / r
    const roll = (az * flat.x - ax * flat.z) / k.r; // (Y x v) . flat
    c.q.premultiply(tq.setFromAxisAngle(flat, roll * h));
    c.w.set(0, 0, 0);
    if (Math.hypot(c.vel.x, c.vel.z) < 0.03) { c.vel.set(0, 0, 0); c.mode = 2; }
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const {kind, mesh} of this.meshes) {
      let n = 0;
      for (const c of this.pool) {
        if (!c.live || c.kind !== kind) continue;
        const left = CASING_LIFETIME - c.age;
        const s = left < FADE ? Math.max(0.001, left / FADE) : 1;
        tm.compose(c.pos, c.q, ts.set(s, s, s));
        mesh.setMatrixAt(n++, tm);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const {mesh} of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
