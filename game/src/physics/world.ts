// Per-station physics: a cannon-es world for zombie ragdolls plus the casing integrator.
//
// Static collision is built LAZILY in 4 m chunks around simulating ragdolls only: each chunk's
// grid cells are greedy-merged into boxes by vertical profile (floor slab top y 0, track-bed slab
// top at the trench floor, full-height wall columns) plus that chunk's prop boxes. Chunks are added
// to the cannon world while a simulating ragdoll's pelvis is within ~3 m and removed afterwards, so
// the body count stays bounded however large the station is. With no simulating ragdolls the
// cannon world is not stepped at all.
//
// Fixed 1/60 s steps (max 3 substeps per frame, interpolated transforms for rendering); the game
// only calls update() while playing, so pause/menus freeze physics.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {CELL} from '../gen/grid';
import {StaticQuery, rampPieces, type StaticLayout} from './staticQuery';
import {GROUP_RAGDOLL, GROUP_STATIC, Ragdoll, RagdollJoint, type KillImpulse, type RagdollTarget} from './ragdoll';
import {CasingSystem, type CasingAudio, type CasingKind} from './casings';

export type {KillImpulse, RagdollTarget} from './ragdoll';
export type {CasingKind} from './casings';

export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 3;
export const MAX_SIMULATING_RAGDOLLS = 4;
const CHUNK = 8; // cells (4 m)
const ACTIVE_RADIUS = 3; // m around each simulating pelvis
const WALL_TOP = 9;

/** Seconds after a shotgun shot until the pump stroke throws the hull (not on the trigger pull). */
export const SHELL_EJECT_DELAY = 0.46; // end of the pump back-stroke (Sfx.shot schedules pump(0.42))

/**
 * Ejection ports in GRIP-RELATIVE model coordinates (the viewmodel holder frame; model faces -Z,
 * +X = right side of the gun), from the derivative anchors in public/assets/derivatives/props.json
 * and receiver cross-sections of rifle.glb / shotgun.glb: rifle port ~(0.036, 0.035, 0.08) on the
 * right of the receiver above the magazine well, shotgun port ~(0.027, 0.055, 0.06) on the
 * receiver's right side. Directions: right, up, slightly back.
 */
export const EJECTION_PORTS: Record<string, {pos: THREE.Vector3; dir: THREE.Vector3; kind: CasingKind}> = {
  rifle: {pos: new THREE.Vector3(0.0294, 0.1217, -0.1085), dir: new THREE.Vector3(1, 0.55, 0.22).normalize(), kind: 'rifle'},
  shotgun: {pos: new THREE.Vector3(0.0269, 0.0131, -0.1275), dir: new THREE.Vector3(1, 0.5, 0.12).normalize(), kind: 'shell'},
};

/** Killing-shot impulse (N·s). Rifle ~38; shotgun 22 + 85 x pellet fraction (full hit ~107). */
export function killImpulseStrength(weaponId: string, pelletsHit: number, pellets: number): number {
  if (pellets > 1 || weaponId === 'shotgun') return 22 + 85 * Math.min(1, pelletsHit / Math.max(1, pellets));
  return 38;
}

/** Provided by Viewmodel.ejectionPort (structural, keeps this module testable without assets). */
export interface EjectionPortSource {
  ejectionPort(main: THREE.PerspectiveCamera, itemId: string, pos: THREE.Vector3, dir: THREE.Vector3, outPos: THREE.Vector3, outDir: THREE.Vector3): boolean;
}

export interface PhysicsAudio extends CasingAudio {
  bodyFall?(x: number, y: number, z: number, strength: number): void;
}

export interface PhysicsStats {
  ragdollsActive: number;
  ragdollsFrozen: number;
  ragdollsFailed: number;
  casingsLive: number;
  bodies: number;
  staticBodies: number;
  /** Smoothed cannon step cost per frame (ms); 0 when idle. */
  stepMs: number;
  stepMsMax: number;
}

interface Chunk { bodies: CANNON.Body[]; active: boolean }

let warmedUp = false;
/**
 * One-off JIT warm-up of the solver / sphere-box / joint paths (~10 ms during the first station
 * build) so the first kill of a session does not hitch on cold cannon-es code.
 */
function warmUp(): void {
  warmedUp = true;
  const w = new CANNON.World({gravity: new CANNON.Vec3(0, -9.81, 0)});
  w.broadphase = new CANNON.SAPBroadphase(w);
  w.broadphase.useBoundingBoxes = true;
  const floor = new CANNON.Body({mass: 0, type: CANNON.Body.STATIC});
  floor.addShape(new CANNON.Box(new CANNON.Vec3(2, 0.5, 2)));
  floor.position.set(0, -0.5, 0);
  w.addBody(floor);
  const bodies: CANNON.Body[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new CANNON.Body({mass: 3});
    b.addShape(new CANNON.Sphere(0.08), new CANNON.Vec3(0, 0.1, 0));
    b.addShape(new CANNON.Sphere(0.08), new CANNON.Vec3(0, -0.1, 0));
    b.position.set(0.05 * i, 0.4 + i * 0.3, 0);
    w.addBody(b);
    bodies.push(b);
  }
  for (let i = 1; i < 3; i++) {
    const j = new RagdollJoint(bodies[i - 1], new CANNON.Vec3(0, 0.15, 0), bodies[i], new CANNON.Vec3(0, -0.15, 0));
    j.addLimit(new CANNON.Vec3(0, 1, 0), new CANNON.Vec3(0, 1, 0), 0.5);
    if (i === 2) j.setHinge(new CANNON.Vec3(1, 0, 0), new CANNON.Vec3(1, 0, 0));
    w.addConstraint(j);
  }
  for (let i = 0; i < 40; i++) { w.step(FIXED_DT); for (const c of w.constraints) (c as RagdollJoint).damp(FIXED_DT, 5); }
}

export class PhysicsSystem {
  world: CANNON.World | null = null;
  readonly casings = new CasingSystem();
  private query: StaticQuery | null = null;
  private readonly ragdollMat = new CANNON.Material('ragdoll');
  private readonly staticMat = new CANNON.Material('static');
  private ragdolls: Ragdoll[] = [];
  private frozen: Ragdoll[] = [];
  private failedCount = 0;
  private readonly chunks = new Map<number, Chunk>();
  private chunkTimer = 0;
  private time = 0;
  private stepMs = 0;
  private stepMsMax = 0;
  private pending: {t: number; weaponId: string; port: EjectionPortSource; camera: THREE.PerspectiveCamera; inherit: {vx: number; vy?: number; vz: number}}[] = [];
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly eyeTmp = new THREE.Vector3();

  constructor(scene: THREE.Object3D | null, public audio: PhysicsAudio | null = null) {
    if (scene) scene.add(this.casings.group);
    this.casings.audio = audio;
  }

  /** Build the world for a new station (disposes the previous one first). */
  build(layout: StaticLayout): void {
    this.dispose();
    this.query = new StaticQuery(layout);
    const w = new CANNON.World({gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true});
    w.broadphase = new CANNON.SAPBroadphase(w);
    // AABB pair tests: the default bounding-SPHERE test pairs every limb with every nearby 4 m
    // slab/wall box (~70 pairs per 4 ragdolls, ~2.7 ms/step of sphere-box narrowphase).
    w.broadphase.useBoundingBoxes = true;
    (w.solver as CANNON.GSSolver).iterations = 14; // with Ragdoll.preStep's fall clamp; ~0.2 ms/ragdoll/frame
    w.defaultContactMaterial.friction = 0.5;
    w.defaultContactMaterial.restitution = 0;
    w.addContactMaterial(new CANNON.ContactMaterial(this.ragdollMat, this.staticMat, {friction: 0.62, restitution: 0.02, contactEquationStiffness: 1e7, contactEquationRelaxation: 3}));
    w.addEventListener('preStep', () => { for (const r of this.ragdolls) r.preStep(FIXED_DT); });
    w.addEventListener('postStep', () => { for (const r of this.ragdolls) r.postStep(FIXED_DT); });
    this.world = w;
    if (!warmedUp) warmUp();
    this.casings.audio = this.audio;
    this.casings.setStatics(this.query);
  }

  /** Remove every body/constraint and casing; ragdoll corpses keep their frozen bone poses. */
  dispose(): void {
    const w = this.world;
    if (w) {
      for (const r of this.ragdolls) r.freeze();
      for (const c of w.constraints.slice()) w.removeConstraint(c);
      for (const b of w.bodies.slice()) w.removeBody(b);
    }
    this.ragdolls = [];
    this.frozen = [];
    this.failedCount = 0;
    this.chunks.clear();
    this.pending = [];
    this.world = null;
    this.query = null;
    this.casings.setStatics(null);
    this.stepMs = this.stepMsMax = 0;
  }

  // -------------------------------------------------------------------------------------------
  /**
   * Turn a freshly killed zombie into a simulated ragdoll from its current pose. Returns false if
   * the rig cannot be ragdolled (caller keeps the Death clip). Freezes the oldest simulating
   * ragdoll when MAX_SIMULATING_RAGDOLLS are already active.
   */
  ragdoll(target: RagdollTarget, impulse: KillImpulse | null): boolean {
    const w = this.world;
    if (!w) return false;
    while (this.ragdolls.length >= MAX_SIMULATING_RAGDOLLS) this.retire(this.ragdolls.reduce((a, b) => (b.startedAt < a.startedAt ? b : a)));
    let r: Ragdoll;
    try {
      r = new Ragdoll(target, impulse, {world: w, material: this.ragdollMat, statics: this.query, onFall: (x, y, z, s) => this.audio?.bodyFall?.(x, y, z, s)}, this.time);
    } catch (e) {
      console.warn('ragdoll unavailable:', e);
      return false;
    }
    this.ragdolls.push(r);
    this.refreshChunks();
    return true;
  }

  private retire(r: Ragdoll): void {
    r.freeze();
    this.ragdolls = this.ragdolls.filter(x => x !== r);
    if (r.failed) this.failedCount++;
    this.frozen.push(r);
  }

  /**
   * Casing ejection for a shot: rifle brass immediately, the shotgun hull on the pump stroke
   * SHELL_EJECT_DELAY later (only if the shotgun is still the held item then).
   */
  onFire(weaponId: string, port: EjectionPortSource, camera: THREE.PerspectiveCamera, shooter: {vx: number; vy?: number; vz: number}): void {
    if (!EJECTION_PORTS[weaponId]) return;
    const delay = EJECTION_PORTS[weaponId].kind === 'shell' ? SHELL_EJECT_DELAY : 0;
    if (delay <= 0) this.ejectNow(weaponId, port, camera, shooter);
    else this.pending.push({t: delay, weaponId, port, camera, inherit: shooter});
  }

  private ejectNow(weaponId: string, port: EjectionPortSource, camera: THREE.PerspectiveCamera, shooter: {vx: number; vy?: number; vz: number}): void {
    const spec = EJECTION_PORTS[weaponId];
    if (!port.ejectionPort(camera, weaponId, spec.pos, spec.dir, this.tmpPos, this.tmpDir)) return;
    // Pull the port back toward the eye if it lies inside a wall/prop (player hugging cover).
    const q = this.query;
    if (q) {
      camera.getWorldPosition(this.eyeTmp);
      for (let i = 0; i < 6 && q.blocked(this.tmpPos.x, this.tmpPos.y, this.tmpPos.z, 0.012); i++) this.tmpPos.lerp(this.eyeTmp, 0.35);
    }
    this.casings.eject(this.tmpPos, this.tmpDir, spec.kind, {x: shooter.vx, y: shooter.vy ?? 0, z: shooter.vz});
  }

  // -------------------------------------------------------------------------------------------
  update(dt: number): void {
    this.time += dt;
    if (this.pending.length) {
      for (const p of this.pending) p.t -= dt;
      const due = this.pending.filter(p => p.t <= 0);
      this.pending = this.pending.filter(p => p.t > 0);
      for (const p of due) this.ejectNow(p.weaponId, p.port, p.camera, p.inherit);
    }
    this.casings.update(dt);
    const w = this.world;
    if (!w || !this.ragdolls.length) { this.stepMs *= 0.9; return; }
    const t0 = performance.now();
    this.chunkTimer -= dt;
    if (this.chunkTimer <= 0) this.refreshChunks();
    w.step(FIXED_DT, dt, MAX_SUBSTEPS);
    for (const r of this.ragdolls.slice()) {
      if (r.update(dt)) this.retire(r);
      else r.sync(true);
    }
    if (!this.ragdolls.length) this.refreshChunks();
    const ms = performance.now() - t0;
    this.stepMs += (ms - this.stepMs) * 0.1;
    this.stepMsMax = Math.max(this.stepMsMax * 0.995, ms);
  }

  // -------------------------------------------------------------------------------------------
  private chunkKey(cx: number, cy: number): number {
    return (cy + 4096) * 8192 + (cx + 4096);
  }

  /** Activate static chunks near simulating ragdolls; deactivate the rest. */
  private refreshChunks(): void {
    this.chunkTimer = 0.1;
    const w = this.world, q = this.query;
    if (!w || !q) return;
    const need = new Set<number>();
    const span = CHUNK * CELL;
    for (const r of this.ragdolls) {
      const p = r.pelvis.position;
      const x0 = Math.floor((p.x - ACTIVE_RADIUS) / span), x1 = Math.floor((p.x + ACTIVE_RADIUS) / span);
      const y0 = Math.floor((p.z - ACTIVE_RADIUS) / span), y1 = Math.floor((p.z + ACTIVE_RADIUS) / span);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) need.add(this.chunkKey(cx, cy));
    }
    for (const [k, c] of this.chunks) {
      if (c.active && !need.has(k)) { for (const b of c.bodies) w.removeBody(b); c.active = false; }
    }
    for (const k of need) {
      let c = this.chunks.get(k);
      if (!c) { c = {bodies: this.buildChunk(k), active: false}; this.chunks.set(k, c); }
      if (!c.active) { for (const b of c.bodies) w.addBody(b); c.active = true; }
    }
  }

  /** Greedy-merge one chunk's cells into boxes by vertical profile (floor height), plus stair treads and props. */
  private buildChunk(key: number): CANNON.Body[] {
    const q = this.query!;
    const cx0 = (key % 8192 - 4096) * CHUNK, cy0 = (Math.floor(key / 8192) - 4096) * CHUNK;
    const base = q.minFloor - 0.5;
    const used = new Uint8Array(CHUNK * CHUNK);
    const cls = (x: number, y: number) => q.cellClass(cx0 + x, cy0 + y);
    const bodies: CANNON.Body[] = [];
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const b = new CANNON.Body({mass: 0, type: CANNON.Body.STATIC, material: this.staticMat, collisionFilterGroup: GROUP_STATIC, collisionFilterMask: GROUP_RAGDOLL});
      b.addShape(new CANNON.Box(new CANNON.Vec3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)));
      b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      b.aabbNeedsUpdate = true;
      bodies.push(b);
    };
    for (let y = 0; y < CHUNK; y++) {
      for (let x = 0; x < CHUNK; x++) {
        if (used[y * CHUNK + x]) continue;
        const c = cls(x, y);
        let w = 1;
        while (x + w < CHUNK && !used[y * CHUNK + x + w] && cls(x + w, y) === c) w++;
        let h = 1;
        grow: while (y + h < CHUNK) {
          for (let i = 0; i < w; i++) if (used[(y + h) * CHUNK + x + i] || cls(x + i, y + h) !== c) break grow;
          h++;
        }
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) used[(y + j) * CHUNK + x + i] = 1;
        const X0 = (cx0 + x) * CELL, X1 = (cx0 + x + w) * CELL, Z0 = (cy0 + y) * CELL, Z1 = (cy0 + y + h) * CELL;
        if (c === 0) box(X0, X1, base - 0.1, WALL_TOP, Z0, Z1);
        else if (c > 0) box(X0, X1, base, q.cellFloor(cx0 + x, cy0 + y), Z0, Z1);
        // c === -1: stair ramp cells, solid steps below
      }
    }
    const span = CHUNK * CELL;
    // Stair steps (tread tops) whose centre lies in this chunk: ragdolls rest on the treads.
    for (const r of q.grid.ramps) {
      for (const p of rampPieces(r)) {
        const sm = (p.s0 + p.s1) / 2, am = (p.a0 + p.a1) / 2;
        const wx = r.axis === 'x' ? sm : am, wz = r.axis === 'x' ? am : sm;
        if (Math.floor(wx / span) !== cx0 / CHUNK || Math.floor(wz / span) !== cy0 / CHUNK) continue;
        if (r.axis === 'x') box(p.s0, p.s1, base, p.h, p.a0, p.a1);
        else box(p.a0, p.a1, base, p.h, p.s0, p.s1);
      }
    }
    for (const p of q.props) {
      if (Math.floor(p.x / span) !== cx0 / CHUNK || Math.floor(p.z / span) !== cy0 / CHUNK) continue;
      if (p.h <= 0.02 || p.hx <= 0 || p.hz <= 0) continue;
      box(p.x - p.hx, p.x + p.hx, p.y, p.y + p.h, p.z - p.hz, p.z + p.hz);
    }
    return bodies;
  }

  /**
   * Iteration 06 (Lane D): a prop box at (x, z) changed (broken crate / shattered glazing): drop the
   * cached static chunk there so it is rebuilt from the current prop boxes when next needed.
   */
  propsChanged(x: number, z: number): void {
    const span = CHUNK * CELL;
    const key = this.chunkKey(Math.floor(x / span), Math.floor(z / span));
    const c = this.chunks.get(key);
    if (!c) return;
    if (c.active && this.world) for (const b of c.bodies) this.world.removeBody(b);
    this.chunks.delete(key);
    if (c.active) this.refreshChunks();
  }

  // -------------------------------------------------------------------------------------------
  stats(): PhysicsStats {
    let staticBodies = 0;
    for (const c of this.chunks.values()) if (c.active) staticBodies += c.bodies.length;
    return {
      ragdollsActive: this.ragdolls.length,
      ragdollsFrozen: this.frozen.length,
      ragdollsFailed: this.failedCount,
      casingsLive: this.casings.live,
      bodies: this.world?.bodies.length ?? 0,
      staticBodies,
      stepMs: Math.round(this.stepMs * 1000) / 1000,
      stepMsMax: Math.round(this.stepMsMax * 1000) / 1000,
    };
  }

  /** QA: simulating ragdolls' pelvis positions. */
  debugRagdolls(): {x: number; y: number; z: number; age: number; frozen: boolean}[] {
    return [...this.ragdolls, ...this.frozen].map(r => ({x: r.pelvis.position.x, y: r.pelvis.position.y, z: r.pelvis.position.z, age: r.age, frozen: r.frozen}));
  }
}
